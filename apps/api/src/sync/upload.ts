/**
 * POST /sync/upload (T10) : la file d'écritures faites hors ligne sur le téléphone, envoyée par
 * le connecteur PowerSync (uploadData) au retour du réseau. Contrat : en-tête de
 * upload.integration.test.ts.
 *
 * - Chaque écriture est traitée à part, dans sa propre transaction : un refus ne bloque ni les
 *   autres écritures du lot, ni la file du téléphone.
 * - T10c : un lot qui contient une écriture de stock (article_stock, mouvement_stock ; stock.ts)
 *   est UNE saisie : il s'écrit en une seule transaction, tout ou rien. Si une écriture est
 *   refusée, rien n'est écrit, et chaque écriture du lot figure dans les refus (la fautive avec
 *   son motif) : rien ne disparaît du téléphone en silence. Contrat : stock.integration.test.ts.
 * - Un refus métier répond 200 (une 4xx bloquerait la file de PowerSync) et s'enregistre dans
 *   `refus_synchro`, qui redescend sur le téléphone de son auteur par la synchro.
 * - Une panne (base injoignable…) lève : 500, PowerSync renverra le lot. Jamais de refus
 *   « ferme_interdite » parce que la base ne répond pas.
 * - Un même lot renvoyé ne crée rien en double : l'id (UUID v7 du téléphone) fait foi, et un
 *   PUT identique à la ligne existante est accepté sans rien écrire ; un refus déjà enregistré
 *   n'est pas recopié (contrainte refus_synchro_sans_doublon).
 * - Rien de ce que le téléphone envoie ne donne un 500 : textes du refus nettoyés (U+0000) et
 *   tronqués, données trop grosses non conservées, erreur de données de la base = refus.
 * - Limites (T10d) : plus de 500 écritures ou corps de plus de 5 Mio → 200, chaque écriture
 *   refusée 'lot_trop_gros' (avant toute autre règle), rien d'écrit : la file PowerSync avance
 *   toujours. Au-delà de 32 Mio (limite dure) → 413, sans lire plus loin. Tailles de
 *   l'événement dans evenement.ts.
 * - T10d : une ligne d'une autre ferme (référence, PATCH, DELETE) se comporte exactement comme
 *   une ligne inexistante ; seul un ferme_id étranger déclaré par l'écriture elle-même donne
 *   'ferme_interdite'.
 */
import { ECRITURES_MAX_PAR_LOT, type Id } from '@planif/core';
import {
  evenement,
  fermesDeLUtilisateur,
  modification,
  OPERATIONS_SYNCHRO,
  refusSynchro,
  type LigneEvenement,
  type OperationSynchro,
} from '@planif/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { garde, type VariablesAuthentifiees } from '../auth/garde.ts';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import { lireEvenement } from './evenement.ts';
import type { MotifRefus, Refus } from './motifs.ts';
import { verifierCorrection, verifierReferences, type TransactionDb } from './references.ts';
import { ecrireArticle, ecrireMouvement } from './stock.ts';

export type { MotifRefus } from './motifs.ts';

interface Env {
  Variables: VariablesAuthentifiees;
}

/** Explication affichée telle quelle sur le téléphone. */
const MESSAGES: Readonly<Record<MotifRefus, string>> = {
  ferme_interdite: "Saisie non enregistrée : elle vise une ferme dont vous n'êtes pas (ou plus) membre.",
  auteur_invalide: "Saisie non enregistrée : elle porte le nom d'une autre personne que vous.",
  ajout_seul:
    'Un événement enregistré ne se modifie pas et ne se supprime pas : saisissez plutôt une correction ou une annulation.',
  table_interdite: 'Modification refusée : cette donnée ne se modifie pas depuis le téléphone.',
  ecriture_invalide: 'Saisie non enregistrée, données invalides',
  lot_trop_gros:
    'Saisie non enregistrée : envoi trop volumineux (plus de 500 saisies ou de 5 Mio en une fois). Ressaisissez-la.',
};

/** Corps HTTP au plus (au-delà : 200, chaque écriture refusée 'lot_trop_gros', rien d'écrit). */
export const TAILLE_MAX_CORPS = 5 * 1_048_576;
/** Limite dure du corps HTTP (au-delà : 413, le serveur cesse de lire ; rien d'écrit, aucun refus). */
export const TAILLE_MAX_CORPS_DURE = 32 * 1_048_576;
/** Écritures par lot au plus (au-delà : 'lot_trop_gros' comme un corps trop gros) : la même constante que la porte du téléphone. */
export { ECRITURES_MAX_PAR_LOT } from '@planif/core';
/** Longueur au plus de nom_table, ligne_id et message dans refus_synchro. */
const LONGUEUR_MAX_TEXTE_REFUS = 200;
/** `donnees` conservées dans refus_synchro jusqu'à cette taille (octets UTF-8 du JSON). */
const TAILLE_MAX_DONNEES_REFUS = 16 * 1_024;

/** Refus écrits par requête (lot trop gros : 500 écritures et plus, ou quelques-unes très lourdes). */
const REFUS_PAR_REQUETE = 100;

/** Tables du stock (T10c) : un lot qui en écrit une est accepté ou refusé en entier. */
const TABLES_STOCK = new Set(['article_stock', 'mouvement_stock']);
/** Tables que le téléphone écrit (T10 : le journal ; T10c : le stock ; les autres suivront avec leurs écrans). */
const TABLES_ECRITES = new Set(['evenement', ...TABLES_STOCK]);
/** Tables en ajout seul : ni modification ni suppression (sinon : création seule, 'table_interdite'). */
const TABLES_AJOUT_SEUL = new Set(['evenement', 'mouvement_stock']);

/** Précision du refus des autres écritures d'une saisie refusée en entier. */
const PRECISION_SAISIE_REFUSEE = 'saisie refusée en entier, une autre de ses écritures est refusée';

/** Écriture telle que reçue, lue sans confiance. */
interface EcritureRecue {
  readonly op: OperationSynchro | null;
  readonly table: string;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>> | null;
  /** `donnees` présent mais pas un objet. */
  readonly donneesIllisibles: boolean;
}

function lireEcriture(brut: unknown): EcritureRecue {
  const o = typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const op = (OPERATIONS_SYNCHRO as readonly unknown[]).includes(o.op) ? (o.op as OperationSynchro) : null;
  const d = o.donnees;
  const objet = typeof d === 'object' && d !== null && !Array.isArray(d);
  return {
    op,
    table: typeof o.table === 'string' ? o.table : '',
    id: typeof o.id === 'string' ? o.id : '',
    donnees: objet ? (d as Record<string, unknown>) : null,
    donneesIllisibles: d !== undefined && d !== null && !objet,
  };
}

/** Code SQLSTATE d'une erreur de pg, éventuellement enveloppée par Drizzle (`cause`). */
function codeSql(erreur: unknown): string | null {
  let e: unknown = erreur;
  for (let i = 0; i < 5 && typeof e === 'object' && e !== null; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Données refusées par la base (22 : donnée invalide, 23 : contrainte, 54 : limite dépassée) : un
 * refus, pas une panne. Le reste (connexion, table absente…) est une panne : 500, PowerSync
 * renverra le lot, rien n'est perdu.
 */
function refusParLaBase(erreur: unknown): boolean {
  const code = codeSql(erreur);
  return code !== null && (code.startsWith('22') || code.startsWith('23') || code.startsWith('54'));
}

/** Texte reçu, rangeable dans une colonne text : sans U+0000 (refusé par Postgres), tronqué. */
function texteRefus(texte: string): string {
  return texte.replaceAll('\u0000', '\uFFFD').slice(0, LONGUEUR_MAX_TEXTE_REFUS);
}

/**
 * JSON.stringify qui ne lève jamais (relecture T10, R2) : une valeur imbriquée sur des dizaines
 * de milliers de niveaux dépasse la pile (RangeError). null si la valeur ne s'écrit pas.
 */
function jsonSansErreur(valeur: unknown): string | null {
  try {
    const texte: unknown = JSON.stringify(valeur);
    return typeof texte === 'string' ? texte : null;
  } catch {
    return null;
  }
}

/** `donnees` conservées dans le refus, ou null si trop grosses ou impossibles à ranger en jsonb. */
function donneesRefus(donnees: Readonly<Record<string, unknown>> | null): Readonly<Record<string, unknown>> | null {
  if (donnees === null) return null;
  const json = jsonSansErreur(donnees);
  if (json === null || json.includes('\\u0000')) return null;
  return new TextEncoder().encode(json).length > TAILLE_MAX_DONNEES_REFUS ? null : donnees;
}

/** `colonne = valeur`, ou `colonne IS NULL`. */
function pareil(colonne: AnyPgColumn, valeur: unknown): SQL {
  return valeur === null ? isNull(colonne) : eq(colonne, valeur);
}

/** Ferme nommée par les données reçues (non vérifiée), ou null. */
function fermeDesDonnees(e: EcritureRecue): string | null {
  return estUuid(e.donnees?.ferme_id) ? e.donnees.ferme_id.toLowerCase() : null;
}

/** Levée dans la transaction d'un lot pour l'annuler : l'écriture `index` est refusée. */
class RefusDansLot extends Error {
  readonly index: number;
  readonly refus: Refus;

  constructor(index: number, refus: Refus) {
    super('écriture refusée : transaction annulée');
    this.index = index;
    this.refus = refus;
  }
}

/**
 * Corps de la requête, lu au plus jusqu'à `max` octets : null au-delà (413). Refusé dès
 * l'en-tête Content-Length s'il annonce plus ; sinon le flux est lu morceau par morceau et
 * abandonné dès qu'il dépasse `max` : jamais tout un corps énorme en mémoire.
 */
async function lireCorpsBorne(requete: Request, max: number): Promise<Uint8Array | null> {
  const annonce = requete.headers.get('content-length');
  if (annonce !== null && /^\d+$/.test(annonce.trim()) && Number(annonce.trim()) > max) return null;
  if (requete.body === null) return new Uint8Array(0);
  // Le corps d'une Request est un flux d'octets (Uint8Array), typé ReadableStream<any> par la bibliothèque DOM.
  const lecteur = (requete.body as ReadableStream<Uint8Array>).getReader();
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.byteLength;
    if (taille > max) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(taille);
  let position = 0;
  for (const m of morceaux) {
    octets.set(m, position);
    position += m.byteLength;
  }
  return octets;
}

/** Objet JSON lu dans `octets` (UTF-8), ou null (illisible, tableau, valeur simple). */
function lireJson(octets: Uint8Array): Record<string, unknown> | null {
  try {
    const corps: unknown = JSON.parse(new TextDecoder().decode(octets));
    return typeof corps === 'object' && corps !== null && !Array.isArray(corps) ? (corps as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function routesSynchro(ctx: Contexte): Hono<Env> {
  const { db } = ctx;
  const routes = new Hono<Env>();
  routes.use('/sync/*', garde(ctx));

  /** La ligne existante `id` a-t-elle exactement ces valeurs ? (renvoi d'un lot déjà écrit) */
  async function identique(tx: TransactionDb, l: LigneEvenement): Promise<boolean> {
    const e = evenement;
    const lignes = await tx
      .select({ id: e.id })
      .from(e)
      .where(
        and(
          eq(e.id, l.id),
          eq(e.fermeId, l.fermeId),
          eq(e.type, l.type),
          eq(e.date, l.date),
          eq(e.horodatage, l.horodatage),
          eq(e.auteurId, l.auteurId),
          eq(e.source, l.source),
          pareil(e.serieId, l.serieId),
          pareil(e.campagneId, l.campagneId),
          sql`to_jsonb(${e.emplacementIds}) = ${JSON.stringify(l.emplacementIds)}::jsonb`,
          pareil(e.note, l.note),
          sql`to_jsonb(${e.photos}) = ${JSON.stringify(l.photos)}::jsonb`,
          pareil(e.remplaceSorte, l.remplaceSorte),
          pareil(e.remplaceEvenementId, l.remplaceEvenementId),
          sql`${e.detail} = ${JSON.stringify(l.detail)}::jsonb`,
        ),
      );
    return lignes.length === 1;
  }

  /**
   * Écrit l'événement et sa ligne d'historique, dans la transaction de l'appelant, après avoir
   * vérifié ses références (B1), gardées verrouillées jusqu'à la fin de la transaction.
   */
  async function ecrireEvenement(tx: TransactionDb, l: LigneEvenement, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
    const maintenant = ctx.maintenant();
    const refusReference = (await verifierReferences(tx, l)) ?? (await verifierCorrection(tx, l));
    if (refusReference !== null) return { ...refusReference, fermeId: l.fermeId };
    const [ecrit] = await tx
      .insert(evenement)
      .values({ ...l, creeLe: maintenant })
      .onConflictDoNothing({ target: evenement.id })
      .returning({ id: evenement.id });
    if (ecrit === undefined) {
      // L'id existe déjà : renvoi identique (réponse perdue) ou tentative de réécriture.
      return (await identique(tx, l)) ? null : { motif: 'ajout_seul', fermeId: l.fermeId };
    }
    await tx.insert(modification).values({
      id: ctx.nouvelId(),
      fermeId: l.fermeId,
      nomTable: 'Evenement',
      ligneId: l.id,
      auteurId,
      horodatage: maintenant,
      operation: 'creation',
      avant: null,
      // La ligne écrite, telle que Postgres la rend en JSON (colonnes snake_case).
      apres: sql`(SELECT to_jsonb(e) FROM evenement e WHERE e.id = ${l.id})`,
      propositionId: null,
      creeLe: maintenant,
      modifieLe: maintenant,
    });
    return null;
  }

  /**
   * PATCH ou DELETE : refusé (ajout seul, ou création seule pour un article). La ferme du refus
   * est celle de la ligne, lue seulement parmi les fermes de l'utilisateur (T10d) : une ligne
   * d'une autre ferme répond exactement comme un id inexistant (même motif, ferme nulle).
   */
  async function modificationRefusee(tx: TransactionDb, e: EcritureRecue, fermes: ReadonlySet<string>): Promise<Refus> {
    const [existant] = estUuid(e.id)
      ? (
          await tx.execute<{ ferme_id: string }>(
            sql`SELECT ferme_id::text AS ferme_id FROM ${sql.identifier(e.table)}
                WHERE id = ${e.id.toLowerCase()}::uuid AND ferme_id = ANY(${sql.param([...fermes])}::uuid[])`,
          )
        ).rows
      : [];
    return { motif: TABLES_AJOUT_SEUL.has(e.table) ? 'ajout_seul' : 'table_interdite', fermeId: existant?.ferme_id ?? null };
  }

  /** Une écriture, dans la transaction `tx` : null si acceptée, sinon le refus. */
  async function traiter(tx: TransactionDb, e: EcritureRecue, utilisateurId: Id<'Utilisateur'>, fermes: ReadonlySet<string>): Promise<Refus | null> {
    const fermeDonnee = fermeDesDonnees(e);
    // e.table est lue ensuite comme nom de table SQL : seulement l'une de ces constantes.
    if (!TABLES_ECRITES.has(e.table)) return { motif: 'table_interdite', fermeId: fermeDonnee };
    if (e.op === null || e.id === '' || e.donneesIllisibles) {
      return { motif: 'ecriture_invalide', precision: 'écriture mal formée', fermeId: fermeDonnee };
    }
    if (e.op !== 'PUT') return modificationRefusee(tx, e, fermes);

    if (fermeDonnee !== null && !fermes.has(fermeDonnee)) return { motif: 'ferme_interdite', fermeId: fermeDonnee };
    const donnees = e.donnees ?? {};
    if (e.table === 'evenement') {
      const auteur = donnees.auteur_id;
      if (estUuid(auteur) && auteur.toLowerCase() !== utilisateurId) return { motif: 'auteur_invalide', fermeId: fermeDonnee };
      const lecture = lireEvenement(e.id, donnees);
      if (!lecture.ok) return { motif: 'ecriture_invalide', precision: lecture.raison, fermeId: fermeDonnee };
      return ecrireEvenement(tx, lecture.valeur, utilisateurId);
    }
    // Stock : la ferme, validée par le cœur, est forcément celle de fermeDonnee (UUID de la ferme du jeton).
    const ferme = fermeDonnee ?? '';
    const put = { id: e.id, donnees };
    return e.table === 'article_stock' ? ecrireArticle(tx, ctx, put, ferme, utilisateurId) : ecrireMouvement(tx, ctx, put, ferme, utilisateurId);
  }

  /**
   * Écrit `ecritures` en UNE transaction, tout ou rien : null si toutes sont acceptées, sinon la
   * première refusée (et rien n'est écrit). Une donnée refusée par la base est un refus de
   * l'écriture en cours ; une panne lève (500, PowerSync renverra le lot).
   */
  async function ecrireEnsemble(
    ecritures: readonly EcritureRecue[],
    utilisateurId: Id<'Utilisateur'>,
    fermes: ReadonlySet<string>,
  ): Promise<{ readonly index: number; readonly refus: Refus } | null> {
    let courante = 0;
    // Verrou du stock de chaque ferme visée (relecture T10c) : un seul verrou par ferme, pris
    // avant toute écriture, fermes triées. Deux lots qui touchent le stock d'une même ferme
    // passent l'un après l'autre (le second voit les mouvements du premier), sans interblocage.
    // Seulement les fermes de l'utilisateur : personne ne bloque le stock d'une autre ferme.
    const verrous = [
      ...new Set(ecritures.filter((e) => TABLES_STOCK.has(e.table)).map(fermeDesDonnees).filter((f): f is string => f !== null && fermes.has(f))),
    ].sort();
    try {
      await db.transaction(async (tx) => {
        for (const ferme of verrous) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`stock:${ferme}`}, 0))`);
        for (const [i, e] of ecritures.entries()) {
          courante = i;
          const refus = await traiter(tx, e, utilisateurId, fermes);
          if (refus !== null) throw new RefusDansLot(i, refus);
        }
      });
      return null;
    } catch (erreur) {
      if (erreur instanceof RefusDansLot) return { index: erreur.index, refus: erreur.refus };
      // Dernier recours : une donnée que la base refuse est un refus, jamais un 500.
      if (!refusParLaBase(erreur)) throw erreur;
      const e = ecritures[courante];
      return {
        index: courante,
        refus: { motif: 'ecriture_invalide', precision: 'refusée par une règle de la base', fermeId: e === undefined ? null : fermeDesDonnees(e) },
      };
    }
  }

  /** Ligne de refus_synchro pour l'écriture `e`. */
  function ligneRefus(e: EcritureRecue, utilisateurId: Id<'Utilisateur'>, fermes: ReadonlySet<string>, refus: Refus) {
    const message = refus.precision === undefined ? MESSAGES[refus.motif] : `${MESSAGES[refus.motif]} : ${refus.precision}.`;
    const fermeVisee = refus.fermeId ?? null;
    const ligne = {
      id: ctx.nouvelId(),
      utilisateurId,
      // M1 : la ligne descend sur le téléphone de l'auteur ; pas d'id d'une ferme qui n'est pas la sienne.
      fermeId: (fermeVisee !== null && fermes.has(fermeVisee) ? fermeVisee : null) as Id<'Ferme'> | null,
      nomTable: texteRefus(e.table),
      ligneId: texteRefus(e.id),
      // Opération illisible : enregistrée comme une création, le motif dit le reste.
      operation: e.op ?? 'PUT',
      motif: refus.motif,
      message: texteRefus(message),
      donnees: donneesRefus(e.donnees),
      creeLe: ctx.maintenant(),
    };
    return ligne;
  }

  /**
   * Enregistre les refus, par paquets d'une requête (au plus une ligne par utilisateur, ligne,
   * opération et motif : les doublons, même dans un paquet, sont ignorés).
   */
  async function enregistrerRefus(
    refus: readonly (readonly [EcritureRecue, Refus])[],
    utilisateurId: Id<'Utilisateur'>,
    fermes: ReadonlySet<string>,
  ): Promise<void> {
    for (let debut = 0; debut < refus.length; debut += REFUS_PAR_REQUETE) {
      const lignes = refus.slice(debut, debut + REFUS_PAR_REQUETE).map(([e, r]) => ligneRefus(e, utilisateurId, fermes, r));
      try {
        await db.insert(refusSynchro).values(lignes).onConflictDoNothing();
      } catch (erreur) {
        // Dernier recours : des données que jsonb refuse ne bloquent pas la file, les refus sont gardés sans elles.
        if (!refusParLaBase(erreur)) throw erreur;
        await db
          .insert(refusSynchro)
          .values(lignes.map((l) => ({ ...l, donnees: null })))
          .onConflictDoNothing();
      }
    }
  }

  routes.post('/sync/upload', async (c) => {
    const octets = await lireCorpsBorne(c.req.raw, TAILLE_MAX_CORPS_DURE);
    if (octets === null) return c.json({ erreur: 'corps_trop_volumineux' }, 413);
    const corps = lireJson(octets);
    const brutes = corps?.ecritures;
    if (!Array.isArray(brutes)) return c.json({ erreur: 'requete_invalide' }, 400);

    const utilisateurId = c.get('utilisateurId');
    // Droits relus en base à chaque lot (un membre retiré perd l'accès tout de suite).
    const fermes = new Set<string>(await fermesDeLUtilisateur(db, utilisateurId));
    const ecritures = (brutes as unknown[]).map(lireEcriture);
    const refus: { table: string; id: string; motif: MotifRefus }[] = [];
    const refuser = async (liste: readonly (readonly [EcritureRecue, Refus])[]): Promise<void> => {
      await enregistrerRefus(liste, utilisateurId, fermes);
      for (const [e, r] of liste) refus.push({ table: e.table, id: e.id, motif: r.motif });
    };

    if (ecritures.length > ECRITURES_MAX_PAR_LOT || octets.byteLength > TAILLE_MAX_CORPS) {
      // T10d : lot trop gros, avant toute autre règle. Rien d'écrit ; chaque écriture a son refus
      // (200 : la file PowerSync avance, rien ne disparaît du téléphone en silence).
      await refuser(ecritures.map((e) => [e, { motif: 'lot_trop_gros', fermeId: fermeDesDonnees(e) }] as const));
      return c.json({ refus });
    }

    if (ecritures.some((e) => TABLES_STOCK.has(e.table))) {
      // T10c : une saisie de stock, tout ou rien. Chaque écriture d'un lot refusé a son refus.
      const echec = await ecrireEnsemble(ecritures, utilisateurId, fermes);
      if (echec !== null) {
        await refuser(
          ecritures.map(
            (e, i) =>
              [e, i === echec.index ? echec.refus : { motif: 'ecriture_invalide', precision: PRECISION_SAISIE_REFUSEE, fermeId: fermeDesDonnees(e) }] as const,
          ),
        );
      }
    } else {
      // T10 : chaque écriture à part, un refus ne bloque pas les autres.
      for (const e of ecritures) {
        const echec = await ecrireEnsemble([e], utilisateurId, fermes);
        if (echec !== null) await refuser([[e, echec.refus]]);
      }
    }
    return c.json({ refus });
  });

  return routes;
}
