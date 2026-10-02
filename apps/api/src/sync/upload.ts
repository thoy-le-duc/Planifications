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
 * - T10e : une série et ses occupations (serie.ts) se créent (PUT) et se modifient (PATCH, la
 *   suppression douce comprise) ; un lot qui en contient est tout ou rien comme le stock, et la
 *   cohérence série ↔ occupations se vérifie en fin de lot. Contrat : serie.integration.test.ts.
 * - T23 : un itinéraire et un type d'intervention (itineraire.ts) se créent et se modifient de même,
 *   tout ou rien avec les séries du même lot ; la bibliothèque commune reste en lecture seule.
 *   Contrat : itineraire.integration.test.ts.
 * - Un refus métier répond 200 (une 4xx bloquerait la file de PowerSync) et s'enregistre dans
 *   `refus_synchro`, qui redescend sur le téléphone de son auteur par la synchro.
 * - Une panne (base injoignable…) lève : 500, PowerSync renverra le lot. Jamais de refus
 *   « ferme_interdite » parce que la base ne répond pas.
 * - Un même lot renvoyé ne crée rien en double : l'id (UUID v7 du téléphone) fait foi, et un
 *   PUT identique à la ligne existante est accepté sans rien écrire ; un refus déjà enregistré
 *   n'est pas recopié (contrainte refus_synchro_sans_doublon).
 * - Rien de ce que le téléphone envoie ne donne un 500 : textes du refus nettoyés (U+0000) et
 *   tronqués, données trop grosses non conservées, erreur de données de la base = refus.
 * - Limites (T10d, T10f) : plus de 500 écritures ou corps de plus de 6 Mio → 200, refus
 *   'lot_trop_gros' (avant toute autre règle), rien d'écrit : la file PowerSync avance toujours.
 *   Un refus par écriture plausible (dédupliqué), une seule ligne récapitulative pour le reste :
 *   un envoi forgé ne se multiplie pas en milliers de refus (relecture de sécurité).
 *   Au-delà de 8 Mio ou de 2 000 écritures (limites dures) → 413, sans lire plus loin, aucun
 *   refus enregistré. Tailles de l'événement dans evenement.ts.
 * - T10d : une ligne d'une autre ferme (référence, PATCH, DELETE) se comporte exactement comme
 *   une ligne inexistante ; seul un ferme_id étranger déclaré par l'écriture elle-même donne
 *   'ferme_interdite'.
 * - T10f : au plus ENVOIS_MAX_PAR_MINUTE envois par utilisateur et par minute glissante ; au-delà,
 *   429 avec Retry-After, rien d'écrit ni de refus enregistré. Contrat : debit.integration.test.ts.
 * - T10g (Q20) : une récolte annulée ne se corrige plus, et une annulation ne s'annule pas
 *   ('recolte_annulee') ; une correction plus ancienne que celle en vigueur (heure du téléphone,
 *   puis id) est refusée ; le serveur écrit lui-même l'écart de stock d'un remplacement
 *   (references.ts, stock.ts). Contrat : recoltes-annulees.integration.test.ts.
 * - T10k : le refus d'un événement porte un court résumé de la saisie (type, culture de la ferme
 *   de l'événement, jour, quantité et unité ; jamais la note), calculé par resume.ts ; aucun pour
 *   les autres tables ni pour un lot trop gros. Contrat : resume-refus.integration.test.ts.
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
import { creerLimiteMemoire } from '../limites.ts';
import { validerEvenement } from './evenement.ts';
import { messageRefus, refusDuCoeur } from './messages.ts';
import type { MotifRefus, Refus } from './motifs.ts';
import { verifierCorrection, verifierReferences, verifierRemplacementRecolte, type TransactionDb } from './references.ts';
import { ecrireItineraire, estTableItineraire, TABLES_ITINERAIRE } from './itineraire.ts';
import { ecrireSerie, fermesDesLignesVisees, TABLES_SERIE, verifierFinDeLot, type SeriesTouchees } from './serie.ts';
import { RESUME_VIDE, resumerSaisies, type ResumeSaisie } from './resume.ts';
import { completerStock, ecrireArticle, ecrireMouvement, type RemplacementEcrit } from './stock.ts';

export type { MotifRefus } from './motifs.ts';

interface Env {
  Variables: VariablesAuthentifiees;
}

/**
 * Corps HTTP au plus (au-delà : 200, chaque écriture refusée 'lot_trop_gros', rien d'écrit). La
 * porte du téléphone s'arrête à 5 Mio d'ordres (TAILLE_MAX_PAR_LOT) ; le corps envoyé peut peser
 * plus (PowerSync y range toutes les colonnes de la ligne) : 6 Mio laissent la marge (T10f).
 */
export const TAILLE_MAX_CORPS = 6 * 1_048_576;
/** Limite dure du corps HTTP (au-delà : 413, le serveur cesse de lire ; rien d'écrit, aucun refus). */
export const TAILLE_MAX_CORPS_DURE = 8 * 1_048_576;
/**
 * Limite dure du nombre d'écritures (au-delà : 413, rien d'écrit, aucun refus). Un vrai téléphone
 * n'en envoie jamais plus de ECRITURES_MAX_PAR_LOT (la porte) : seul un envoi forgé l'atteint.
 */
export const ECRITURES_MAX_DURES = 2_000;
/** Écritures par lot au plus (au-delà : 'lot_trop_gros' comme un corps trop gros) : la même constante que la porte du téléphone. */
export { ECRITURES_MAX_PAR_LOT } from '@planif/core';
/**
 * Envois au plus par utilisateur et par minute glissante (T10f). Un téléphone normal n'en fait que
 * quelques-uns ; en vidant une longue file au retour du réseau, il est ralenti, jamais bloqué
 * (429 : PowerSync renvoie plus tard). Compté en mémoire, par processus d'API.
 */
export const ENVOIS_MAX_PAR_MINUTE = 120;
const MINUTE = 60_000;
/** Longueur au plus de nom_table, ligne_id et message dans refus_synchro. */
const LONGUEUR_MAX_TEXTE_REFUS = 200;
/** `donnees` conservées dans refus_synchro jusqu'à cette taille (octets UTF-8 du JSON). */
const TAILLE_MAX_DONNEES_REFUS = 16 * 1_024;

/** Refus écrits par requête (lot trop gros : 500 écritures et plus, ou quelques-unes très lourdes). */
const REFUS_PAR_REQUETE = 100;

/** Tables du stock (T10c) : un lot qui en écrit une est accepté ou refusé en entier. */
const TABLES_STOCK = new Set(['article_stock', 'mouvement_stock']);
/**
 * Tables d'une saisie tout ou rien (T10c : le stock ; T10e : une série et ses occupations ; T23 :
 * les itinéraires et les types d'intervention) : un lot qui en écrit une est accepté ou refusé en
 * entier, sous le verrou de chaque ferme touchée.
 */
const TABLES_TOUT_OU_RIEN = new Set([...TABLES_STOCK, ...TABLES_SERIE, ...TABLES_ITINERAIRE]);
/** Tables que le téléphone écrit (T10 : le journal ; T10c : le stock ; T10e : les séries ; T23 : les itinéraires ; les autres suivront avec leurs écrans). */
const TABLES_ECRITES = new Set(['evenement', ...TABLES_TOUT_OU_RIEN]);
/** Tables en ajout seul : ni modification ni suppression (sinon : création seule, 'table_interdite'). */
const TABLES_AJOUT_SEUL = new Set(['evenement', 'mouvement_stock']);

/** Précision du refus des autres écritures d'une saisie refusée en entier. */
const PRECISION_SAISIE_REFUSEE = 'une autre partie de cette saisie est refusée, rien n’a été enregistré';

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

/** Erreur de pg, éventuellement enveloppée par Drizzle (`cause`) : son code SQLSTATE et les noms qu'elle donne. */
interface ErreurSql {
  readonly code: string;
  readonly constraint?: unknown;
  readonly table?: unknown;
  readonly column?: unknown;
}

function erreurSql(erreur: unknown): ErreurSql | null {
  let e: unknown = erreur;
  for (let i = 0; i < 5 && typeof e === 'object' && e !== null; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return e as ErreurSql;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Détail d'une erreur de la base pour le journal : code SQLSTATE, et contrainte, table, colonne
 * quand pg les donne. Jamais le message de pg, qui peut citer la valeur refusée.
 */
function detailSql(erreur: unknown): string {
  const e = erreurSql(erreur);
  if (e === null) return 'base';
  const noms = (['constraint', 'table', 'column'] as const).flatMap((k) => {
    const nom = e[k];
    return typeof nom === 'string' ? [`${k} ${nom}`] : [];
  });
  return ['SQLSTATE', e.code, ...noms].join(' ');
}

/**
 * Données refusées par la base (22 : donnée invalide, 23 : contrainte, 54 : limite dépassée) : un
 * refus, pas une panne. Le reste (connexion, table absente…) est une panne : 500, PowerSync
 * renverra le lot, rien n'est perdu.
 */
function refusParLaBase(erreur: unknown): boolean {
  const code = erreurSql(erreur)?.code ?? null;
  return code !== null && (code.startsWith('22') || code.startsWith('23') || code.startsWith('54'));
}

/** Texte reçu, rangeable dans une colonne text : sans U+0000 (refusé par Postgres), tronqué. */
function texteRefus(texte: string): string {
  return texte.replaceAll('\u0000', '\uFFFD').slice(0, LONGUEUR_MAX_TEXTE_REFUS);
}

/** Longueur au plus d'une entrée du journal du serveur. */
const LONGUEUR_MAX_LIGNE_JOURNAL = 1_000;

/**
 * Entrée du journal sur UNE ligne, toujours : la table, l'id et le détail (nom de clé reçu…)
 * viennent du téléphone. Caractères de contrôle et séparateurs de ligne (U+0085, U+2028, U+2029)
 * remplacés, entrée tronquée.
 */
function ligneDeJournal(texte: string): string {
  return texte.slice(0, LONGUEUR_MAX_LIGNE_JOURNAL).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?');
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

/**
 * PUT d'un événement qui en remplace un autre, correction ou annulation, de toute catégorie (lu
 * sans confiance : il ne sert qu'au verrou). T10h, décision 2 : chaque remplacement verrouille la
 * ligne de sa chaîne (interne.chaine_evenement) jusqu'à la fin de la transaction ; sous le verrou
 * de ferme, deux lots qui remplacent dans les mêmes chaînes en ordre croisé ne s'interbloquent pas.
 */
function remplacement(e: EcritureRecue): boolean {
  return e.op === 'PUT' && e.table === 'evenement' && typeof e.donnees?.remplace_evenement_id === 'string';
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
 * Lot trop gros (T10d) : écritures plausibles (table écrite par le téléphone, id UUID, opération
 * connue), dédupliquées par (table, id, opération), et nombre des autres.
 *
 * Limite acceptée (décision du chef) : la contrainte refus_synchro_sans_doublon porte sur
 * (utilisateur, ligne, opération, motif), sans la table. Deux écritures plausibles de même id et
 * même opération sur deux tables n'y font qu'une ligne ; les UUID ne se partagent pas entre
 * tables en usage normal.
 */
function trierLotTropGros(ecritures: readonly EcritureRecue[]): { plausibles: EcritureRecue[]; autres: number } {
  const vues = new Set<string>();
  const plausibles: EcritureRecue[] = [];
  for (const e of ecritures) {
    if (e.op === null || !TABLES_ECRITES.has(e.table) || !estUuid(e.id)) continue;
    const cle = `${e.table}|${e.id}|${e.op}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    plausibles.push(e);
  }
  return { plausibles, autres: ecritures.length - plausibles.length };
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
  // Par utilisateur authentifié (pas par jeton ni par adresse), propre à cette application.
  const debit = creerLimiteMemoire(ctx.envoisMaxParMinute, MINUTE);

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
  async function ecrireEvenement(
    tx: TransactionDb,
    l: LigneEvenement,
    auteurId: Id<'Utilisateur'>,
    remplacements: RemplacementEcrit[],
    index: number,
  ): Promise<Refus | null> {
    const maintenant = ctx.maintenant();
    const refusReference = (await verifierReferences(tx, l)) ?? (await verifierCorrection(tx, l)) ?? (await verifierRemplacementRecolte(tx, l));
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
    // T10g, décision 8 : son stock est complété en fin de lot si le téléphone n'a pas envoyé de mouvement.
    if (l.type === 'recolte' && l.remplaceSorte !== null) remplacements.push({ id: l.id, fermeId: l.fermeId, date: l.date, sorte: l.remplaceSorte, index });
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

  /**
   * Une écriture, dans la transaction `tx` : null si acceptée, sinon le refus. `touchees` : séries
   * touchées par le lot (T10e), vérifiées en fin de lot ; `index` : rang de l'écriture dans le lot.
   */
  async function traiter(
    tx: TransactionDb,
    e: EcritureRecue,
    utilisateurId: Id<'Utilisateur'>,
    fermes: ReadonlySet<string>,
    touchees: SeriesTouchees,
    index: number,
    remplacements: RemplacementEcrit[],
  ): Promise<Refus | null> {
    const fermeDonnee = fermeDesDonnees(e);
    // e.table est lue ensuite comme nom de table SQL : seulement l'une de ces constantes.
    if (!TABLES_ECRITES.has(e.table)) return { motif: 'table_interdite', fermeId: fermeDonnee };
    if (e.op === null || e.id === '' || e.donneesIllisibles) {
      const detail = e.op === null ? 'opération inconnue' : e.id === '' ? 'id manquant' : 'données qui ne sont pas un objet';
      // Sans précision : « ce n'est pas une saisie que l'appli sait enregistrer » (messages.ts).
      return { motif: 'ecriture_invalide', detail, fermeId: fermeDonnee };
    }
    if (e.op === 'PATCH' && (e.table === 'serie' || e.table === 'occupation')) {
      // T10e : une série et ses occupations se modifient (suppression douce comprise).
      return ecrireSerie(tx, ctx, { op: 'PATCH', table: e.table, id: e.id, donnees: e.donnees ?? {} }, fermeDonnee, fermes, utilisateurId, touchees, index);
    }
    if (e.op === 'PATCH' && estTableItineraire(e.table)) {
      // T23 : un itinéraire et un type d'intervention se modifient (suppression douce et masque compris).
      return ecrireItineraire(tx, ctx, { op: 'PATCH', table: e.table, id: e.id, donnees: e.donnees ?? {} }, fermeDonnee, fermes, utilisateurId);
    }
    if (e.op !== 'PUT') return modificationRefusee(tx, e, fermes);

    if (fermeDonnee !== null && !fermes.has(fermeDonnee)) return { motif: 'ferme_interdite', fermeId: fermeDonnee };
    const donnees = e.donnees ?? {};
    if (e.table === 'evenement') {
      const auteur = donnees.auteur_id;
      if (estUuid(auteur) && auteur.toLowerCase() !== utilisateurId) return { motif: 'auteur_invalide', fermeId: fermeDonnee };
      const lecture = validerEvenement(e.id, donnees);
      if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeDonnee);
      return ecrireEvenement(tx, lecture.valeur, utilisateurId, remplacements, index);
    }
    if (e.table === 'serie' || e.table === 'occupation') {
      return ecrireSerie(tx, ctx, { op: 'PUT', table: e.table, id: e.id, donnees }, fermeDonnee, fermes, utilisateurId, touchees, index);
    }
    if (estTableItineraire(e.table)) return ecrireItineraire(tx, ctx, { op: 'PUT', table: e.table, id: e.id, donnees }, fermeDonnee, fermes, utilisateurId);
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
    const touchees: SeriesTouchees = new Map();
    const remplacements: RemplacementEcrit[] = [];
    try {
      await db.transaction(async (tx) => {
        // Un seul verrou par ferme visée (relecture T10c, T10e), pris avant toute écriture, fermes
        // triées : deux lots qui touchent le stock ou les séries d'une même ferme passent l'un
        // après l'autre (le second voit les écritures du premier), sans interblocage. Seulement
        // les fermes de l'utilisateur : personne ne bloque une autre ferme. La ferme d'un PATCH
        // est celle de la ligne existante (ses données ne la portent pas forcément).
        // T10g : un remplacement de récolte (correction, annulation) se vérifie sur sa chaîne ; sous
        // le même verrou, deux corrections concurrentes de la même ferme passent l'une après l'autre.
        // T10h (décision 2) : tout remplacement, quelle que soit sa catégorie, prend ce verrou.
        const tout = ecritures.filter((e) => TABLES_TOUT_OU_RIEN.has(e.table));
        const declarees = [...tout, ...ecritures.filter(remplacement)]
          .map(fermeDesDonnees)
          .filter((f): f is string => f !== null && fermes.has(f));
        const verrous = [...new Set([...declarees, ...(await fermesDesLignesVisees(tx, tout, fermes))])].sort();
        for (const ferme of verrous) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ferme:${ferme}`}, 0))`);
        for (const [i, e] of ecritures.entries()) {
          courante = i;
          const refus = await traiter(tx, e, utilisateurId, fermes, touchees, i, remplacements);
          if (refus !== null) throw new RefusDansLot(i, refus);
        }
        // T10g, décision 8 : écart de stock des remplacements de récolte envoyés sans mouvement.
        for (const r of remplacements) {
          const refus = await completerStock(tx, ctx, r, utilisateurId);
          if (refus !== null) throw new RefusDansLot(r.index, refus);
        }
        // T10e, décision 1 : la cohérence série ↔ occupations se vérifie une fois tout le lot écrit.
        const incoherence = await verifierFinDeLot(tx, touchees, fermes);
        if (incoherence !== null) throw new RefusDansLot(incoherence.index, incoherence.refus);
      });
      return null;
    } catch (erreur) {
      if (erreur instanceof RefusDansLot) return { index: erreur.index, refus: erreur.refus };
      // Dernier recours : une donnée que la base refuse est un refus, jamais un 500.
      if (!refusParLaBase(erreur)) throw erreur;
      const e = ecritures[courante];
      return {
        index: courante,
        refus: {
          motif: 'ecriture_invalide',
          precision: 'une valeur saisie n’est pas acceptée',
          detail: detailSql(erreur),
          fermeId: e === undefined ? null : fermeDesDonnees(e),
        },
      };
    }
  }

  /** Ligne de refus_synchro pour l'écriture `e`. */
  function ligneRefus(e: EcritureRecue, utilisateurId: Id<'Utilisateur'>, fermes: ReadonlySet<string>, refus: Refus, resume: ResumeSaisie) {
    const message = messageRefus(refus);
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
      // T10k : le court résumé de la saisie (resume.ts), seul à descendre avec le motif.
      ...resume,
      creeLe: ctx.maintenant(),
    };
    return ligne;
  }

  /**
   * Une ligne au journal du serveur pour un refus qui porte un détail technique : motif, table et
   * id de l'écriture, détail (jamais de donnée de la saisie). Un journal en panne ne bloque pas la synchro.
   */
  function journaliser(e: EcritureRecue, refus: Refus): void {
    try {
      ctx.journal(ligneDeJournal(`[synchro] refus ${refus.motif} ${texteRefus(e.table)} ${texteRefus(e.id)} : ${refus.detail ?? '-'}`));
    } catch {
      // Sortie d'erreur fermée… : le refus s'enregistre quand même.
    }
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
      const paquet = refus.slice(debut, debut + REFUS_PAR_REQUETE);
      // T10k : pas de résumé pour un lot trop gros (refusé avant toute lecture, rien de plus à lire).
      const aResumer = paquet.map(([e, r]) => (r.motif === 'lot_trop_gros' ? { table: e.table, donnees: null } : e));
      const resumes = await resumerSaisies(db, aResumer, fermes);
      const lignes = paquet.map(([e, r], i) => ligneRefus(e, utilisateurId, fermes, r, resumes[i] ?? RESUME_VIDE));
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
    // T10f : avant de lire le corps, pour que toute requête compte (un corps invalide aussi).
    // Rien d'écrit, aucun refus : la file du téléphone renverra la même transaction.
    const attente = debit.enregistrer(c.get('utilisateurId'), ctx.maintenant().getTime());
    if (attente !== null) {
      c.header('Retry-After', String(Math.min(attente, 60)));
      return c.json({ erreur: 'trop_de_requetes' }, 429);
    }
    const octets = await lireCorpsBorne(c.req.raw, TAILLE_MAX_CORPS_DURE);
    if (octets === null) return c.json({ erreur: 'corps_trop_volumineux' }, 413);
    const corps = lireJson(octets);
    const brutes = corps?.ecritures;
    if (!Array.isArray(brutes)) return c.json({ erreur: 'requete_invalide' }, 400);
    // Compté avant tout travail par écriture : un envoi forgé ne coûte ni lecture ni refus.
    if (brutes.length > ECRITURES_MAX_DURES) return c.json({ erreur: 'corps_trop_volumineux' }, 413);

    const utilisateurId = c.get('utilisateurId');
    // Droits relus en base à chaque lot (un membre retiré perd l'accès tout de suite).
    const fermes = new Set<string>(await fermesDeLUtilisateur(db, utilisateurId));
    const ecritures = (brutes as unknown[]).map(lireEcriture);
    const refus: { table: string; id: string; motif: MotifRefus }[] = [];
    const refuser = async (liste: readonly (readonly [EcritureRecue, Refus])[]): Promise<void> => {
      // T10j : le détail technique d'un refus va au journal, avant la réponse ; jamais au téléphone.
      for (const [e, r] of liste) if (r.detail !== undefined) journaliser(e, r);
      await enregistrerRefus(liste, utilisateurId, fermes);
      for (const [e, r] of liste) refus.push({ table: e.table, id: e.id, motif: r.motif });
    };

    if (ecritures.length > ECRITURES_MAX_PAR_LOT || octets.byteLength > TAILLE_MAX_CORPS) {
      // T10d : lot trop gros, avant toute autre règle. Rien d'écrit (200 : la file PowerSync
      // avance). Chaque écriture plausible a son refus, rien ne disparaît du téléphone en silence ;
      // le reste tient en une ligne récapitulative (pas d'amplification).
      const { plausibles, autres } = trierLotTropGros(ecritures);
      const liste: (readonly [EcritureRecue, Refus])[] = plausibles.map((e) => [e, { motif: 'lot_trop_gros', fermeId: fermeDesDonnees(e) }] as const);
      if (autres > 0) {
        const recapitulatif: EcritureRecue = { op: null, table: 'lot', id: ctx.nouvelId(), donnees: null, donneesIllisibles: false };
        // Le message reste celui du motif ; le compte va au journal.
        const detail = `${String(autres)} autres écritures illisibles, en double ou hors des tables permises`;
        liste.push([recapitulatif, { motif: 'lot_trop_gros', detail, fermeId: null }]);
      }
      await refuser(liste);
      return c.json({ refus });
    }

    if (ecritures.some((e) => TABLES_TOUT_OU_RIEN.has(e.table))) {
      // T10c, T10e : une saisie de stock ou une série, tout ou rien. Chaque écriture d'un lot refusé a son refus.
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
