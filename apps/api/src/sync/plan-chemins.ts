/**
 * Chemins, points du plan, lieux de rangement, places et outils écrits par le téléphone (T61,
 * Q44). Contrat : en-tête de plan-chemins.integration.test.ts. Même modèle que l'équipe
 * (equipe.ts) : règles de ligne du cœur (validerChemin, validerPointPlan, validerPlaceRangement,
 * validerOutil) rejouées sur la ligne COMPLÈTE (pour un PATCH : ligne existante + colonnes
 * reçues) ; ce fichier ajoute les droits, les références, l'origine du plan, le renvoi identique et
 * la ferme figée.
 *
 * - Droits : comme tout placement (Q31), le GÉRANT actif de la ferme seul (`gerees`, rôle relu
 *   dans la transaction du lot, upload.ts). Un équipier lit ces lignes par la synchro.
 * - Références (lignes actives seulement) : l'élément d'un lieu, le lieu d'une place ou d'un outil,
 *   la place d'un outil sont de LA MÊME ferme et non supprimés ; la place est celle du lieu de
 *   l'outil ; un lieu non supprimé par bâtiment et par point ; noms de place uniques dans leur lieu,
 *   noms d'outil uniques dans la ferme (sans casse ni espaces autour, comme les index de la base).
 * - Un lieu ne change pas d'élément, une place ne change pas de lieu : on retire, puis on recrée.
 * - Origine : aucun chemin ni point actif sans `ferme.origine_plan` ; un chemin ou un point actif
 *   la fige (structure-origine.ts). Le rangement n'a pas de position : pas d'origine demandée.
 * - `points` arrive en texte JSON (format de PowerSync), borné AVANT d'être lu : 16 384
 *   caractères au plus, un texte (jamais un tableau forgé).
 * - Pas d'historique dans `modification` (comme l'équipe) : ce sont des repères du plan, pas des
 *   données de culture. Rien ne s'efface : retirer = `supprime_le`.
 *
 * Les précisions des refus ne disent ni « chemin » ni « outil » : ce sont des noms de tables du
 * schéma, que le filet des messages (test/jargon.ts) interdit ; on dit « passage » et « matériel ».
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou consultatif de la ferme.
 */
import {
  identifiantNormalise,
  instantNormalise,
  nomDeChemin,
  validerChemin,
  validerOutil,
  validerPlaceRangement,
  validerPointPlan,
  type CodeErreurPlacement,
  type ErreurPlacement,
} from '@planif/core';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import {
  ID_GLISSE,
  PRECISION_CHANGE_DE_FERME,
  PRECISION_CREEE_SUPPRIMEE,
  PRECISION_EXISTE_DEJA,
  PRECISION_INTROUVABLE,
  PRECISION_SEUL_LE_GERANT,
  refusDuCoeur,
} from './messages.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLES_PLAN = ['chemin', 'point_plan', 'lieu_rangement', 'place_rangement', 'outil'] as const;
type TablePlan = (typeof TABLES_PLAN)[number];

export const estTablePlan = (table: string): table is TablePlan => (TABLES_PLAN as readonly string[]).includes(table);

/** Texte JSON du tracé reçu : au plus ce nombre de caractères, mesuré avant de le lire. */
export const POINTS_CARACTERES_MAX = 16_384;

export const PRECISION_PLAN_SANS_ORIGINE = 'posez d’abord l’origine du plan de la ferme (son point de départ), avant d’y tracer un passage ou d’y poser un repère';
export const PRECISION_TRACE_ILLISIBLE = 'le tracé du passage est illisible : une liste de repères en mètres est attendue';
export const PRECISION_TRACE_TROP_LONG = 'le tracé du passage est trop long';
export const PRECISION_TRACE_TROP_COURT = 'un passage tracé relie au moins un point de départ et un point d’arrivée';
export const PRECISION_TRACE_TROP_D_ETAPES = 'un passage tracé compte 200 étapes au plus, point de départ compris';
export const PRECISION_TRACE_COORDONNEES = 'chaque étape du tracé a des coordonnées en mètres';
export const PRECISION_TRACE_TROP_LOIN = 'une étape du tracé est trop loin de l’origine du plan (5 km au plus)';
export const PRECISION_TRACE_CONFONDU = 'deux étapes qui se suivent dans le tracé sont au même endroit';
export const PRECISION_LARGEUR_PASSAGE = 'la largeur du passage doit être un nombre de mètres plus grand que zéro';
export const PRECISION_LARGEUR_PASSAGE_MAX = 'la largeur du passage dépasse le maximum permis (20 m)';
export const PRECISION_NOM_PASSAGE = 'le nom du passage a de 1 à 80 caractères, ou pas de nom du tout';
export const PRECISION_REPERE_NOM = 'un repère du plan a un nom, de 80 caractères au plus';
export const PRECISION_REPERE_SORTE = 'la sorte d’un repère du plan est inconnue : point d’eau ou autre repère';
export const PRECISION_REPERE_POSITION = 'la position du repère doit être un nombre de mètres';
export const PRECISION_REPERE_TROP_LOIN = 'le repère est trop loin de l’origine du plan (5 km au plus)';
export const PRECISION_PLACE_NOM = 'une place de rangement a un nom, de 60 caractères au plus';
export const PRECISION_MATERIEL_NOM = 'le matériel rangé a un nom, de 80 caractères au plus';
export const PRECISION_MATERIEL_SANS_LIEU = 'un matériel se range toujours quelque part : choisissez son lieu de rangement';
export const PRECISION_PLACE_ILLISIBLE = 'la place de rangement choisie est illisible';
export const PRECISION_LIEU_UN_ELEMENT = 'un lieu de rangement est un bâtiment ou un repère du plan, l’un des deux';
export const PRECISION_LIEU_DEJA = 'ce bâtiment ou ce repère est déjà un lieu de rangement';
export const PRECISION_LIEU_FIGE = 'un lieu de rangement ne change pas de bâtiment ni de repère : retirez-le, puis créez-en un autre';
export const PRECISION_ELEMENT_INTROUVABLE = 'le bâtiment ou le repère choisi est introuvable dans la ferme, ou retiré';
export const PRECISION_LIEU_INTROUVABLE = 'le lieu de rangement choisi est introuvable dans la ferme, ou retiré';
export const PRECISION_PLACE_INTROUVABLE = 'la place de rangement choisie est introuvable dans la ferme, ou retirée';
export const PRECISION_PLACE_HORS_LIEU = 'cette place n’est pas dans le lieu de rangement choisi';
export const PRECISION_PLACE_FIGEE = 'une place ne change pas de lieu de rangement : retirez-la, puis créez-en une autre';
export const PRECISION_PLACE_DEJA = 'ce nom de place est déjà pris dans ce lieu de rangement';
export const PRECISION_MATERIEL_DEJA = 'un matériel de ce nom existe déjà dans la ferme';
export const PRECISION_INFORMATION_INCONNUE = "la saisie contient une information que l'appli ne connaît pas";
export const PRECISION_SUPPRESSION_ILLISIBLE = 'la date de suppression est illisible';
export const PRECISION_REFERENCE_ILLISIBLE = 'un élément choisi est illisible';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES: Readonly<Record<TablePlan, readonly string[]>> = {
  chemin: ['id', 'ferme_id', 'nom', 'points', 'largeur_m', 'supprime_le'],
  point_plan: ['id', 'ferme_id', 'nom', 'sorte', 'x_m', 'y_m', 'supprime_le'],
  lieu_rangement: ['id', 'ferme_id', 'batiment_id', 'point_plan_id', 'supprime_le'],
  place_rangement: ['id', 'ferme_id', 'lieu_rangement_id', 'nom', 'supprime_le'],
  outil: ['id', 'ferme_id', 'nom', 'lieu_rangement_id', 'place_rangement_id', 'supprime_le'],
};

/** Horodatages techniques tolérés dans les données reçues, ignorés (remplis par le serveur). */
const TOLEREES = new Set(['cree_le', 'modifie_le']);
const REFERENCES = new Set(['batiment_id', 'point_plan_id', 'lieu_rangement_id', 'place_rangement_id']);

type Ligne = Readonly<Record<string, unknown>>;

export interface EcriturePlanRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly table: TablePlan;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

const invalide = (precision: string, fermeId: string | null, detail?: string): Refus => ({ motif: 'ecriture_invalide', precision, fermeId, ...(detail === undefined ? {} : { detail }) });

type Lue = { readonly ok: true; readonly ligne: Ligne } | { readonly ok: false; readonly refus: Refus };
const refuse = (precision: string, fermeId: string | null, detail?: string): Lue => ({ ok: false, refus: invalide(precision, fermeId, detail) });

/** Précision d'une règle du tracé ou de la largeur d'un chemin (validerChemin). */
const PRECISIONS_TRACE: Readonly<Partial<Record<CodeErreurPlacement, string>>> = {
  entree_invalide: PRECISION_TRACE_ILLISIBLE,
  trop_peu_de_sommets: PRECISION_TRACE_TROP_COURT,
  trop_de_sommets: PRECISION_TRACE_TROP_D_ETAPES,
  coordonnee_invalide: PRECISION_TRACE_COORDONNEES,
  trop_loin: PRECISION_TRACE_TROP_LOIN,
  sommets_confondus: PRECISION_TRACE_CONFONDU,
  dimension_invalide: PRECISION_LARGEUR_PASSAGE,
  plafond_depasse: PRECISION_LARGEUR_PASSAGE_MAX,
};

function precisionDuPlan(table: TablePlan, e: ErreurPlacement): string {
  if (table === 'chemin') return PRECISIONS_TRACE[e.code] ?? PRECISION_TRACE_ILLISIBLE;
  if (table === 'point_plan') {
    if (e.champ === 'nom') return PRECISION_REPERE_NOM;
    if (e.champ === 'sorte') return PRECISION_REPERE_SORTE;
    return e.code === 'trop_loin' ? PRECISION_REPERE_TROP_LOIN : PRECISION_REPERE_POSITION;
  }
  if (table === 'place_rangement') return PRECISION_PLACE_NOM;
  if (e.champ === 'lieu_rangement_id') return PRECISION_MATERIEL_SANS_LIEU;
  return e.champ === 'nom' ? PRECISION_MATERIEL_NOM : PRECISION_PLACE_ILLISIBLE;
}

const detailDuPlan = (e: ErreurPlacement): string => `plan ${e.code} champ ${e.champ ?? '-'}`;

/** Tracé reçu (texte JSON, borné avant lecture) ou relu de la base (tableau jsonb) ; undefined si illisible. */
function lirePoints(v: unknown, recu: boolean): unknown {
  if (!recu) return v;
  if (typeof v !== 'string' || v.length > POINTS_CARACTERES_MAX) return undefined;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * La ligne complète (existante + reçue), validée et au format de la base, ou le refus. `recues` :
 * colonnes données par le téléphone (le tracé y est un texte JSON).
 */
function lire(table: TablePlan, l: Ligne, recues: ReadonlySet<string>, fermeId: string): Lue {
  const base = { id: l.id, ferme_id: fermeId, supprime_le: l.supprime_le ?? null };
  switch (table) {
    case 'chemin': {
      const nom = nomDeChemin(l.nom);
      if (nom === undefined) return refuse(PRECISION_NOM_PASSAGE, fermeId);
      const recu = recues.has('points');
      if (recu && typeof l.points === 'string' && l.points.length > POINTS_CARACTERES_MAX) return refuse(PRECISION_TRACE_TROP_LONG, fermeId, 'plan points trop long');
      const points = lirePoints(l.points, recu);
      if (points === undefined) return refuse(PRECISION_TRACE_ILLISIBLE, fermeId, 'plan points illisible');
      const r = validerChemin({ points, largeur_m: l.largeur_m });
      if (!r.ok) return refuse(precisionDuPlan(table, r.erreur), fermeId, detailDuPlan(r.erreur));
      return { ok: true, ligne: { ...base, nom, points: r.valeur.points, largeur_m: r.valeur.largeur_m } };
    }
    case 'point_plan': {
      const r = validerPointPlan(l);
      if (!r.ok) return refuse(precisionDuPlan(table, r.erreur), fermeId, detailDuPlan(r.erreur));
      return { ok: true, ligne: { ...base, ...r.valeur } };
    }
    case 'lieu_rangement': {
      const b = l.batiment_id ?? null;
      const p = l.point_plan_id ?? null;
      if ((b === null) === (p === null)) return refuse(PRECISION_LIEU_UN_ELEMENT, fermeId);
      return { ok: true, ligne: { ...base, batiment_id: b, point_plan_id: p } };
    }
    case 'place_rangement': {
      const r = validerPlaceRangement(l);
      if (!r.ok) return refuse(precisionDuPlan(table, r.erreur), fermeId, detailDuPlan(r.erreur));
      const lieu = l.lieu_rangement_id ?? null;
      if (lieu === null) return refuse(PRECISION_LIEU_INTROUVABLE, fermeId);
      return { ok: true, ligne: { ...base, lieu_rangement_id: lieu, nom: r.valeur.nom } };
    }
    case 'outil': {
      const r = validerOutil(l);
      if (!r.ok) return refuse(precisionDuPlan(table, r.erreur), fermeId, detailDuPlan(r.erreur));
      return { ok: true, ligne: { ...base, ...r.valeur } };
    }
  }
  return refuse(PRECISION_INFORMATION_INCONNUE, fermeId);
}

/** Données reçues relues : colonnes connues seulement, références et instant normalisés ; ou le refus. */
function donneesRecues(table: TablePlan, donnees: Ligne, fermeId: string | null): { readonly ok: true; readonly valeurs: Ligne } | { readonly ok: false; readonly refus: Refus } {
  const valeurs: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(donnees)) {
    if (TOLEREES.has(c)) continue;
    if (c === 'id') return { ok: false, refus: refusDuCoeur(ID_GLISSE, fermeId) };
    if (!COLONNES[table].includes(c)) return { ok: false, refus: invalide(PRECISION_INFORMATION_INCONNUE, fermeId, `plan colonne inconnue ${c.slice(0, 60)}`) };
    if (c === 'supprime_le' && v !== null) {
      const instant = instantNormalise(v);
      if (instant === null) return { ok: false, refus: invalide(PRECISION_SUPPRESSION_ILLISIBLE, fermeId) };
      valeurs[c] = instant;
    } else if (REFERENCES.has(c) && v !== null && v !== undefined) {
      const ident = identifiantNormalise(v);
      if (ident === null) return { ok: false, refus: invalide(PRECISION_REFERENCE_ILLISIBLE, fermeId) };
      valeurs[c] = ident;
    } else {
      valeurs[c] = v;
    }
  }
  return { ok: true, valeurs };
}

function colonnes(table: TablePlan, alias: string): SQL {
  return sql.join(
    COLONNES[table].map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

function enregistrement(table: TablePlan, ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(ligne)}::jsonb) r`;
}

/** La ligne `id` a-t-elle exactement ces valeurs (horodatages techniques ignorés) ? null si elle n'existe pas. */
async function identique(tx: TransactionDb, table: TablePlan, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes(table, 'r')}) IS NOT DISTINCT FROM (${colonnes(table, 't')}) AS identique
        FROM ${sql.identifier(table)} t, ${enregistrement(table, ligne)} WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

async function existe(tx: TransactionDb, requete: SQL): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (${requete}) AS existe`);
  return r.rows[0]?.existe === true;
}

/** Ligne active (non supprimée) de la ferme, verrouillée jusqu'à la fin du lot ; ses colonnes, ou null. */
async function active(tx: TransactionDb, table: 'batiment' | 'point_plan' | 'lieu_rangement' | 'place_rangement', id: unknown, fermeId: string): Promise<Ligne | null> {
  if (typeof id !== 'string' || !estUuid(id)) return null;
  const r = await tx.execute<{ l: Ligne }>(
    sql`SELECT to_jsonb(t) AS l FROM ${sql.identifier(table)} t
        WHERE t.id = ${id}::uuid AND t.ferme_id = ${fermeId}::uuid AND t.supprime_le IS NULL FOR SHARE`,
  );
  return r.rows[0]?.l ?? null;
}

/** Ce que la base seule sait : origine du plan, références, unicités. Seulement pour une ligne active. */
async function verifierEnBase(tx: TransactionDb, table: TablePlan, l: Ligne, fermeId: string): Promise<Refus | null> {
  if (l.supprime_le !== null) return null;
  const id = String(l.id);
  switch (table) {
    case 'chemin':
    case 'point_plan': {
      const sansOrigine = await existe(tx, sql`SELECT 1 FROM ferme f WHERE f.id = ${fermeId}::uuid AND f.origine_plan IS NULL`);
      return sansOrigine ? invalide(PRECISION_PLAN_SANS_ORIGINE, fermeId) : null;
    }
    case 'lieu_rangement': {
      const surBatiment = l.batiment_id !== null;
      const element = surBatiment ? l.batiment_id : l.point_plan_id;
      if ((await active(tx, surBatiment ? 'batiment' : 'point_plan', element, fermeId)) === null) return invalide(PRECISION_ELEMENT_INTROUVABLE, fermeId);
      const colonne = sql.identifier(surBatiment ? 'batiment_id' : 'point_plan_id');
      const deja = await existe(tx, sql`SELECT 1 FROM lieu_rangement WHERE ${colonne} = ${String(element)}::uuid AND supprime_le IS NULL AND id <> ${id}::uuid`);
      return deja ? invalide(PRECISION_LIEU_DEJA, fermeId) : null;
    }
    case 'place_rangement': {
      if ((await active(tx, 'lieu_rangement', l.lieu_rangement_id, fermeId)) === null) return invalide(PRECISION_LIEU_INTROUVABLE, fermeId);
      const deja = await existe(
        tx,
        sql`SELECT 1 FROM place_rangement WHERE lieu_rangement_id = ${String(l.lieu_rangement_id)}::uuid AND supprime_le IS NULL
            AND id <> ${id}::uuid AND lower(btrim(nom)) = lower(btrim(${String(l.nom)}))`,
      );
      return deja ? invalide(PRECISION_PLACE_DEJA, fermeId) : null;
    }
    case 'outil': {
      if ((await active(tx, 'lieu_rangement', l.lieu_rangement_id, fermeId)) === null) return invalide(PRECISION_LIEU_INTROUVABLE, fermeId);
      if (l.place_rangement_id !== null) {
        const place = await active(tx, 'place_rangement', l.place_rangement_id, fermeId);
        if (place === null) return invalide(PRECISION_PLACE_INTROUVABLE, fermeId);
        if (place.lieu_rangement_id !== l.lieu_rangement_id) return invalide(PRECISION_PLACE_HORS_LIEU, fermeId);
      }
      const deja = await existe(
        tx,
        sql`SELECT 1 FROM outil WHERE ferme_id = ${fermeId}::uuid AND supprime_le IS NULL
            AND id <> ${id}::uuid AND lower(btrim(nom)) = lower(btrim(${String(l.nom)}))`,
      );
      return deja ? invalide(PRECISION_MATERIEL_DEJA, fermeId) : null;
    }
  }
  return null;
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcriturePlanRecue, fermeDonnee: string | null, gerees: ReadonlySet<string>): Promise<Refus | null> {
  // La ferme a été vérifiée parmi celles de l'auteur (upload.ts) ; absente ou illisible : refus.
  if (fermeDonnee === null) return invalide(PRECISION_INFORMATION_INCONNUE, null, 'plan ferme manquante');
  if (!gerees.has(fermeDonnee)) return invalide(PRECISION_SEUL_LE_GERANT, fermeDonnee);
  const recues = donneesRecues(e.table, e.donnees, fermeDonnee);
  if (!recues.ok) return recues.refus;
  const id = e.id.toLowerCase();
  const lecture = lire(e.table, { ...recues.valeurs, id }, new Set(Object.keys(recues.valeurs)), fermeDonnee);
  if (!lecture.ok) return lecture.refus;
  const ligne = lecture.ligne;
  if (ligne.supprime_le !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, fermeDonnee);
  const existante = await identique(tx, e.table, ligne, id);
  if (existante !== null) return existante ? null : invalide(PRECISION_EXISTE_DEJA, null);
  const refus = await verifierEnBase(tx, e.table, ligne, fermeDonnee);
  if (refus !== null) return refus;
  const maintenant = ctx.maintenant();
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO ${sql.identifier(e.table)} (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)}
        ON CONFLICT (id) DO NOTHING RETURNING id::text AS id`,
  );
  if (ecrite.rows.length === 0) return (await identique(tx, e.table, ligne, id)) === true ? null : invalide(PRECISION_EXISTE_DEJA, null);
  return null;
}

/** PATCH : modification d'une ligne de la ferme (retrait et rétablissement compris). */
async function modifier(tx: TransactionDb, ctx: Contexte, e: EcriturePlanRecue, fermes: ReadonlySet<string>, gerees: ReadonlySet<string>): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : une ligne d'une autre ferme n'est ni lue ni verrouillée (T10d).
  const r = await tx.execute<{ l: Ligne }>(
    sql`SELECT to_jsonb(t) AS l FROM ${sql.identifier(e.table)} t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[]) FOR UPDATE`,
  );
  const avant = r.rows[0]?.l;
  if (avant === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const fermeId = String(avant.ferme_id);
  if (!gerees.has(fermeId)) return invalide(PRECISION_SEUL_LE_GERANT, fermeId);
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) return invalide(PRECISION_CHANGE_DE_FERME, fermeId);
  const recues = donneesRecues(e.table, e.donnees, fermeId);
  if (!recues.ok) return recues.refus;
  const v = recues.valeurs;
  if (e.table === 'lieu_rangement' && ['batiment_id', 'point_plan_id'].some((c) => Object.hasOwn(v, c) && (v[c] ?? null) !== avant[c])) {
    return invalide(PRECISION_LIEU_FIGE, fermeId);
  }
  if (e.table === 'place_rangement' && Object.hasOwn(v, 'lieu_rangement_id') && v.lieu_rangement_id !== avant.lieu_rangement_id) {
    return invalide(PRECISION_PLACE_FIGEE, fermeId);
  }

  const lecture = lire(e.table, { ...avant, ...v, id: avant.id }, new Set(Object.keys(v)), fermeId);
  if (!lecture.ok) return lecture.refus;
  const ligne = lecture.ligne;
  if ((await identique(tx, e.table, ligne, String(avant.id))) === true) return null;
  const refus = await verifierEnBase(tx, e.table, ligne, fermeId);
  if (refus !== null) return refus;
  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE ${sql.identifier(e.table)} t SET (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)})
        WHERE t.id = ${String(avant.id)}::uuid`,
  );
  return null;
}

/**
 * Écriture sur l'une des cinq tables (PUT ou PATCH), dans la transaction du lot : null si
 * acceptée, sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi
 * celles de l'utilisateur pour un PUT) ; `gerees` : fermes dont l'auteur est gérant actif.
 */
export function ecrirePlan(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcriturePlanRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  gerees: ReadonlySet<string>,
): Promise<Refus | null> {
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, gerees);
  return creer(tx, ctx, e, fermeDonnee, gerees);
}

/** Fermes des lignes visées par un PATCH (parmi celles de l'utilisateur), pour le verrou du lot. */
export async function fermesDesLignesPlan(
  tx: TransactionDb,
  ecritures: readonly { readonly op: string | null; readonly table: string; readonly id: string }[],
  fermes: ReadonlySet<string>,
): Promise<string[]> {
  const trouvees = new Set<string>();
  for (const table of TABLES_PLAN) {
    const ids = [...new Set(ecritures.filter((e) => e.table === table && e.op === 'PATCH' && estUuid(e.id)).map((e) => e.id.toLowerCase()))];
    if (ids.length === 0) continue;
    const r = await tx.execute<{ ferme_id: string }>(
      sql`SELECT DISTINCT ferme_id::text AS ferme_id FROM ${sql.identifier(table)}
          WHERE id = ANY(${sql.param(ids)}::uuid[]) AND ferme_id = ANY(${sql.param([...fermes])}::uuid[])`,
    );
    for (const l of r.rows) trouvees.add(l.ferme_id);
  }
  return [...trouvees];
}
