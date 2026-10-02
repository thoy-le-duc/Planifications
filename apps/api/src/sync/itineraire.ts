/**
 * Itinéraires et types d'intervention écrits par le téléphone (T23, écran de T24). Contrat :
 * en-tête de itineraire.integration.test.ts. Même modèle que les séries (serie.ts, T10e).
 *
 * Les règles d'une ligne sont celles du cœur (`validerItineraire`, `validerTypeIntervention`,
 * @planif/core), rejouées sur la ligne COMPLÈTE (pour un PATCH : ligne existante + colonnes
 * reçues). Ce fichier ajoute ce qui demande la base : le renvoi identique, l'appartenance de
 * l'espèce et de la variété à la ferme ou à la bibliothèque, les types d'intervention permis dans
 * les travaux prévus, l'unicité (catégorie, libellé) d'un type, ce qui l'utilise, et
 * l'historique (`modification`, écrit par le serveur seul).
 *
 * Bibliothèque commune et liste de départ (ferme_id nul) : en lecture seule. Le téléphone ne les
 * lit que par la synchro ; ici, une telle ligne se comporte, pour un PATCH, exactement comme une
 * ligne inexistante (la requête du verrou ne voit que les fermes de l'utilisateur), et un PUT sur
 * son id est refusé (même id, autres valeurs). Une ligne d'une autre ferme : de même (T10d).
 *
 * Le serveur ne croit jamais le téléphone : chaque identifiant reçu est relu en base (requêtes
 * paramétrées ; tables et colonnes sont des constantes de ce fichier), la ferme est filtrée dans
 * la requête même du verrou (FOR SHARE, FOR UPDATE), et tout se fait dans la transaction du lot
 * (upload.ts), sous le verrou consultatif de chaque ferme touchée.
 */
import {
  validerItineraire,
  validerTypeIntervention,
  type Id,
  type ItineraireEcrit,
  type TypeInterventionEcrit,
} from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import {
  detailDuCoeur,
  ID_GLISSE,
  PRECISION_CHANGE_DE_FERME,
  PRECISION_CREEE_SUPPRIMEE,
  PRECISION_INTROUVABLE,
  PRECISION_EXISTE_DEJA,
  refusDuCoeur,
} from './messages.ts';
import type { Refus } from './motifs.ts';
import { visibleParLaFerme, type TransactionDb } from './references.ts';

/** Tables des itinéraires ouvertes au téléphone (T23). */
export const TABLES_ITINERAIRE = new Set(['itineraire', 'type_intervention']);

type TableItineraire = 'itineraire' | 'type_intervention';

export const estTableItineraire = (table: string): table is TableItineraire => TABLES_ITINERAIRE.has(table);

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES: Readonly<Record<TableItineraire, readonly string[]>> = {
  itineraire: ['id', 'ferme_id', 'espece_id', 'variete_id', 'nom', 'mode', 'parametres', 'supprime_le'],
  type_intervention: ['id', 'ferme_id', 'categorie', 'libelle', 'masque', 'supprime_le'],
};

const NOM_ENTITE: Readonly<Record<TableItineraire, 'Itineraire' | 'TypeIntervention'>> = {
  itineraire: 'Itineraire',
  type_intervention: 'TypeIntervention',
};

/** Écriture reçue sur `itineraire` ou `type_intervention` : id de l'écriture PowerSync et colonnes (sans confiance). */
export interface EcritureItineraireRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly table: TableItineraire;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

type Ligne = Readonly<Record<string, unknown>>;

/** Couple (catégorie, libellé) d'un type d'intervention, tel que les travaux prévus le désignent. */
interface Couple {
  readonly categorie: string;
  readonly type: string;
}

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

const iso = (instant: number | null): string | null => (instant === null ? null : new Date(instant).toISOString());

/** Colonnes de `table`, préfixées par `alias`, séparées par des virgules. */
function colonnes(table: TableItineraire, alias: string): SQL {
  return sql.join(
    COLONNES[table].map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

function ligneItineraire(i: ItineraireEcrit): Ligne {
  return {
    id: i.id,
    ferme_id: i.fermeId,
    espece_id: i.especeId,
    variete_id: i.varieteId,
    nom: i.nom,
    mode: i.mode,
    parametres: i.parametres,
    supprime_le: iso(i.supprimeLe),
  };
}

function ligneType(t: TypeInterventionEcrit): Ligne {
  return {
    id: t.id,
    ferme_id: t.fermeId,
    categorie: t.categorie,
    libelle: t.libelle,
    masque: t.masque,
    supprime_le: iso(t.supprimeLe),
  };
}

/** `jsonb_populate_record` de `ligne` sur le type ligne de `table`, sous l'alias r. */
function enregistrement(table: TableItineraire, ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(ligne)}::jsonb) r`;
}

/**
 * La ligne `id` existe-t-elle avec exactement ces valeurs (horodatages de création et de
 * modification ignorés) ? null si elle n'existe pas. Sans filtre de ferme : une ligne d'une autre
 * ferme ou de la bibliothèque n'est jamais identique (ferme_id diffère), et rien de ses valeurs
 * n'est rendu.
 */
async function identique(tx: TransactionDb, table: TableItineraire, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes(table, 'r')}) IS NOT DISTINCT FROM (${colonnes(table, 't')}) AS identique
        FROM ${sql.identifier(table)} t, ${enregistrement(table, ligne)}
        WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

/** La ligne `id` existe-t-elle dans la ferme `fermeId` ? */
async function deLaFerme(tx: TransactionDb, table: TableItineraire, id: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid) AS existe`,
  );
  return r.rows[0]?.existe === true;
}

/** Ligne validée par le cœur (colonnes de Postgres) ; ou le refus. */
type Validee =
  | { readonly table: 'itineraire'; readonly ligne: Ligne; readonly valeur: ItineraireEcrit }
  | { readonly table: 'type_intervention'; readonly ligne: Ligne; readonly valeur: TypeInterventionEcrit }
  | { readonly refus: Refus };

/** Règles du cœur sur la ligne complète, sans la liste des types (vérifiée à part, en base). */
function valider(table: TableItineraire, entree: Ligne, fermeId: string | null): Validee {
  if (table === 'itineraire') {
    const lecture = validerItineraire(entree);
    if (!lecture.ok) return { refus: refusDuCoeur(lecture.erreur, fermeId) };
    return { table, ligne: ligneItineraire(lecture.valeur), valeur: lecture.valeur };
  }
  const lecture = validerTypeIntervention(entree);
  if (!lecture.ok) return { refus: refusDuCoeur(lecture.erreur, fermeId) };
  return { table, ligne: ligneType(lecture.valeur), valeur: lecture.valeur };
}

/**
 * Ligne `table` d'identifiant `id`, de la ferme ou de la bibliothèque commune, verrouillée
 * (FOR SHARE) ; undefined si elle n'existe pas OU si elle est d'une autre ferme (T10d).
 */
async function reference(
  tx: TransactionDb,
  table: 'espece' | 'variete',
  id: string,
  fermeId: string,
): Promise<{ readonly supprimee: boolean; readonly espece_id: string | null } | undefined> {
  const especeId = table === 'variete' ? sql`espece_id::text` : sql`NULL::text`;
  const r = await tx.execute<{ supprimee: boolean; espece_id: string | null }>(
    sql`SELECT supprime_le IS NOT NULL AS supprimee, ${especeId} AS espece_id
        FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ${visibleParLaFerme(fermeId, true)} FOR SHARE`,
  );
  return r.rows[0];
}

/** Espèce et variété d'un itinéraire : de la ferme ou de la bibliothèque, non supprimées, la variété de l'espèce. */
async function verifierCulture(tx: TransactionDb, i: ItineraireEcrit): Promise<Refus | null> {
  const f = i.fermeId;
  const espece = await reference(tx, 'espece', i.especeId, f);
  if (espece === undefined) return invalide('espèce introuvable', f);
  if (espece.supprimee) return invalide('espèce supprimée', f);
  if (i.varieteId !== null) {
    const variete = await reference(tx, 'variete', i.varieteId, f);
    if (variete === undefined) return invalide('variété introuvable', f);
    if (variete.supprimee) return invalide('variété supprimée', f);
    if (variete.espece_id !== i.especeId) return invalide("variété d'une autre espèce que celle de l'itinéraire", f);
  }
  return null;
}

/**
 * Travaux prévus d'un itinéraire : chaque couple (catégorie, type) est un type d'intervention non
 * supprimé (masqué compris) de la ferme de l'itinéraire ou de la liste de départ. Les types
 * trouvés sont lus, filtrés par ferme, et verrouillés (FOR SHARE) ; un type d'une autre ferme
 * n'est pas lu et donne le même refus qu'un type inexistant. Le refus lui-même vient du cœur
 * (champ `parametres.travauxPrevus.N.type`), rejoué avec la liste lue.
 */
async function verifierTypes(tx: TransactionDb, entree: Ligne, i: ItineraireEcrit): Promise<Refus | null> {
  const travaux = i.parametres.travauxPrevus ?? [];
  if (travaux.length === 0) return null;
  const couples = [...new Map(travaux.map((t) => [`${t.categorie}\u0000${t.type}`, { categorie: t.categorie, type: t.type }])).values()];
  const r = await tx.execute<{ categorie: string; libelle: string }>(
    sql`SELECT categorie, libelle FROM type_intervention
        WHERE supprime_le IS NULL AND ${visibleParLaFerme(i.fermeId, true)}
          AND (categorie, libelle) IN (
            SELECT * FROM unnest(${sql.param(couples.map((c) => c.categorie))}::text[], ${sql.param(couples.map((c) => c.type))}::text[])
          )
        ORDER BY id
        FOR SHARE`,
  );
  const permis: Couple[] = r.rows.map((l) => ({ categorie: l.categorie, type: l.libelle }));
  const lecture = validerItineraire(entree, { typesIntervention: permis });
  // La seule règle ajoutée par la liste des types : un travail prévu d'un type inconnu de la ferme.
  return lecture.ok ? null : { ...invalide('un travail prévu vise un type d’intervention que la ferme n’a pas', i.fermeId), detail: detailDuCoeur(lecture.erreur) };
}

/**
 * Le type (catégorie, libellé) est-il utilisé, c'est-à-dire présent dans les travaux prévus d'un
 * itinéraire non supprimé de la ferme (décision 3 du chef) ? Les itinéraires de la ferme ne
 * s'écrivent que sous le verrou de la ferme, pris par le lot : la réponse tient jusqu'à la fin.
 */
async function utilise(tx: TransactionDb, fermeId: string, categorie: string, libelle: string): Promise<boolean> {
  const r = await tx.execute<{ utilise: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM itineraire i, jsonb_array_elements(coalesce(i.parametres -> 'travauxPrevus', '[]'::jsonb)) t
          WHERE i.ferme_id = ${fermeId}::uuid AND i.supprime_le IS NULL
            AND t ->> 'categorie' = ${categorie} AND t ->> 'type' = ${libelle}
        ) AS utilise`,
  );
  return r.rows[0]?.utilise === true;
}

/**
 * Décisions 5 et 11 du chef : (catégorie, libellé) est unique, sans tenir compte de la casse,
 * parmi les types non supprimés de la ferme et de la liste de départ (le même lower() que l'index
 * unique). Un type supprimé n'est pas contrôlé (il ne compte pas).
 */
async function verifierUnicite(tx: TransactionDb, t: TypeInterventionEcrit): Promise<Refus | null> {
  if (t.supprimeLe !== null) return null;
  const r = await tx.execute<{ existe: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM type_intervention
          WHERE id <> ${t.id}::uuid AND supprime_le IS NULL AND ${visibleParLaFerme(t.fermeId, true)}
            AND categorie = ${t.categorie} AND lower(libelle) = lower(${t.libelle})
        ) AS existe`,
  );
  return r.rows[0]?.existe === true ? invalide('ce type d’intervention existe déjà dans cette catégorie', t.fermeId) : null;
}

/** Ligne d'historique de `ligneId` (après écriture) ; `avant` : texte JSON de la ligne d'avant. */
async function historiser(
  tx: TransactionDb,
  ctx: Contexte,
  table: TableItineraire,
  ligneId: string,
  fermeId: string,
  auteurId: Id<'Utilisateur'>,
  maintenant: Date,
  operation: 'creation' | 'modification' | 'suppression',
  avant: string | null,
): Promise<void> {
  await tx.insert(modification).values({
    id: ctx.nouvelId(),
    fermeId: fermeId as Id<'Ferme'>,
    nomTable: NOM_ENTITE[table],
    ligneId: ligneId as Id<'Itineraire'>,
    auteurId,
    horodatage: maintenant,
    operation,
    // Texte rendu par Postgres, relu tel quel : aucune valeur ne passe par un nombre JavaScript.
    avant: avant === null ? null : sql`${avant}::jsonb`,
    // La ligne écrite, telle que Postgres la rend en JSON (colonnes snake_case).
    apres: sql`(SELECT to_jsonb(l) FROM ${sql.identifier(table)} l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

/**
 * Règles qui demandent la base, sur la ligne validée (création, ou PATCH : `avant` est la ligne
 * existante, `retablie` si le PATCH la rétablit). null si tout va bien.
 */
async function verifierEnBase(tx: TransactionDb, v: Exclude<Validee, { refus: Refus }>, entree: Ligne, avant: Ligne | null): Promise<Refus | null> {
  if (v.table === 'itineraire') {
    const i = v.valeur;
    // Décision 8 du chef : l'espèce d'un itinéraire est figée (pour une autre espèce, on duplique).
    if (avant !== null && avant.espece_id !== i.especeId) return invalide("l'espèce d'un itinéraire ne change pas : dupliquez-le", i.fermeId);
    const retablie = avant?.supprime_le != null && i.supprimeLe === null;
    const cultureChange = avant === null || retablie || avant.espece_id !== i.especeId || (avant.variete_id ?? null) !== i.varieteId;
    if (cultureChange) {
      const refus = await verifierCulture(tx, i);
      if (refus !== null) return refus;
    }
    // Un itinéraire actif n'utilise que des types existants (un type utilisé ne se supprime pas).
    return i.supprimeLe === null ? verifierTypes(tx, entree, i) : null;
  }
  const t = v.valeur;
  if (avant !== null) {
    const categorie = String(avant.categorie);
    const libelle = String(avant.libelle);
    const renomme = categorie !== t.categorie || libelle !== t.libelle;
    const supprime = avant.supprime_le == null && t.supprimeLe !== null;
    if ((renomme || supprime) && (await utilise(tx, t.fermeId, categorie, libelle))) {
      return invalide(
        supprime
          ? 'type d’intervention utilisé par un itinéraire : masquez-le plutôt que de le supprimer'
          : 'type d’intervention utilisé par un itinéraire : il ne se renomme pas, créez-en un autre et masquez celui-ci',
        t.fermeId,
      );
    }
  }
  return verifierUnicite(tx, t);
}

/** INSERT de la ligne validée, depuis l'objet JSON aux colonnes de la table. true si écrite. */
async function inserer(tx: TransactionDb, table: TableItineraire, ligne: Ligne, maintenant: Date): Promise<boolean> {
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO ${sql.identifier(table)} (${sql.join(
      COLONNES[table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes(table, 'r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(table, ligne)}
        ON CONFLICT (id) DO NOTHING
        RETURNING id::text AS id`,
  );
  return ecrite.rows.length > 0;
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcritureItineraireRecue, fermeDonnee: string | null, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const entree: Ligne = { ...e.donnees, id: e.id };
  const v = valider(e.table, entree, fermeDonnee);
  if ('refus' in v) return v.refus;
  const fermeId = v.valeur.fermeId;
  // Comme une série (T10e) : une ligne se crée active.
  if (v.valeur.supprimeLe !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, fermeId);

  const existante = await identique(tx, e.table, v.ligne, v.valeur.id);
  if (existante !== null) {
    // Même id, autres valeurs, ou ligne d'une autre ferme ou de la bibliothèque : refusé. Le
    // refus ne porte la ferme que si la ligne existante est la sienne (rien sur une autre ferme).
    if (existante) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, e.table, v.valeur.id, fermeId)) ? fermeId : null);
  }

  const refus = await verifierEnBase(tx, v, entree, null);
  if (refus !== null) return refus;

  const maintenant = ctx.maintenant();
  if (!(await inserer(tx, e.table, v.ligne, maintenant))) {
    // Écrite entre-temps par un envoi concurrent : même règle que le renvoi.
    if ((await identique(tx, e.table, v.ligne, v.valeur.id)) === true) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, e.table, v.valeur.id, fermeId)) ? fermeId : null);
  }
  await historiser(tx, ctx, e.table, v.valeur.id, fermeId, auteurId, maintenant, 'creation', null);
  return null;
}

/**
 * PATCH : modification d'une ligne de la ferme (suppression douce, rétablissement et masque
 * compris). Ligne introuvable, d'une autre ferme ou de la bibliothèque : même refus, sans ferme
 * (T10d). Un PATCH qui ne change rien est accepté sans rien écrire (renvoi après une réponse perdue).
 */
async function modifier(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureItineraireRecue,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : une ligne d'une autre ferme ou de la bibliothèque (ferme_id
  // nul) n'est ni lue ni verrouillée.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM ${sql.identifier(e.table)} t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[])
        FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);

  // Décision 7 du chef : une ligne ne change pas de ferme (ni vers une autre, ni vers la bibliothèque).
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) {
    return invalide(PRECISION_CHANGE_DE_FERME, fermeId);
  }

  const entree: Ligne = { ...avant, ...e.donnees, id: avant.id };
  const v = valider(e.table, entree, fermeId);
  if ('refus' in v) return v.refus;

  if ((await identique(tx, e.table, v.ligne, v.valeur.id)) === true) return null;

  const refus = await verifierEnBase(tx, v, entree, avant);
  if (refus !== null) return refus;

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE ${sql.identifier(e.table)} t SET (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz FROM ${enregistrement(e.table, v.ligne)})
        WHERE t.id = ${v.valeur.id}::uuid`,
  );
  const suppression = avant.supprime_le == null && v.valeur.supprimeLe !== null;
  await historiser(tx, ctx, e.table, v.valeur.id, fermeId, auteurId, maintenant, suppression ? 'suppression' : 'modification', existante.texte);
  return null;
}

/**
 * Écriture sur `itineraire` ou `type_intervention` (PUT ou PATCH), dans la transaction du lot :
 * null si acceptée, sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà
 * vérifiée parmi celles de l'utilisateur pour un PUT).
 */
export async function ecrireItineraire(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureItineraireRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  // Un id glissé dans les données : colonne inconnue (l'id est celui de l'écriture).
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, auteurId);
  return creer(tx, ctx, e, fermeDonnee, auteurId);
}
