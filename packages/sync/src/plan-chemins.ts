/**
 * T61 : chemins, points du plan, lieux de rangement, places et outils écrits par `porte.placer`
 * (placement.ts, chargé à la demande). Contrat : en-tête de porte-plan-chemins.test.ts.
 *
 * Rejoue avant d'écrire ce que le serveur refuserait (apps/api/src/sync/plan-chemins.ts) : règles
 * du cœur (validerChemin, validerPointPlan, validerPlaceRangement, validerOutil), lignes de la
 * ferme de la porte seulement, références de la même ferme et non supprimées, place de l'outil
 * dans le lieu de l'outil, un lieu par bâtiment ou point, noms uniques (sans casse ni espaces
 * autour), aucun chemin ni point sans origine du plan. Le gérant est vérifié par placement.ts,
 * une fois par appel, avant tout changement.
 *
 * L'annulation rendue remet les valeurs d'avant, lues dans la base locale ; annuler une création
 * est une suppression douce.
 */
import { identifiantNormalise, instantNormalise, nomDeChemin, validerChemin, validerOutil, validerPlaceRangement, validerPointPlan } from '@planif/core';
import type { ChangementPlacement, PointPlacement, TransactionLocale } from './types.ts';

/** Ce que la porte sait d'elle-même (comme ContextePlacement de placement.ts). */
export interface ContextePlan {
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

export type SortePlan = 'chemin' | 'point_plan' | 'lieu_rangement' | 'place_rangement' | 'outil';
type ChangementPlan = Extract<ChangementPlacement, { readonly sorte: SortePlan }>;

/** Colonnes que `placer` écrit, par table (sans ferme_id ni horodatages techniques). */
const COLONNES: Readonly<Record<SortePlan, readonly string[]>> = {
  chemin: ['nom', 'points', 'largeur_m', 'supprime_le'],
  point_plan: ['nom', 'sorte', 'x_m', 'y_m', 'supprime_le'],
  lieu_rangement: ['batiment_id', 'point_plan_id', 'supprime_le'],
  place_rangement: ['lieu_rangement_id', 'nom', 'supprime_le'],
  outil: ['nom', 'lieu_rangement_id', 'place_rangement_id', 'supprime_le'],
};

/** Valeur de chaque colonne quand une création ne la donne pas. */
const DEFAUTS: Readonly<Record<string, null>> = { nom: null, supprime_le: null, batiment_id: null, point_plan_id: null, place_rangement_id: null };

const QUOI: Readonly<Record<SortePlan, string>> = {
  chemin: 'Chemin',
  point_plan: 'Point du plan',
  lieu_rangement: 'Lieu de rangement',
  place_rangement: 'Place de rangement',
  outil: 'Outil',
};

type Ligne = Readonly<Record<string, unknown>>;

function fautif(message: string): never {
  throw new Error(message);
}

const lire = <T>(tx: TransactionLocale, sql: string, parametres: readonly unknown[]): Promise<T[]> => tx.getAll<T>(sql, parametres);

/** Nom comparé comme la base (lower(btrim(nom))). */
const nomEnBase = (nom: string): string => nom.trim().toLowerCase();

/** Le tracé rangé (texte JSON) relu en points ; illisible : rejet, rien n'est écrit. */
function pointsLus(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return fautif('Le tracé du chemin enregistré est illisible : rien n’est modifié.');
  }
}

async function exigerOrigine(tx: TransactionLocale, ctx: ContextePlan): Promise<void> {
  const [ferme] = await lire<{ o: unknown }>(tx, 'SELECT origine_plan AS o FROM ferme WHERE id = ?', [ctx.fermeId]);
  if (ferme === undefined || ferme.o === null) throw new Error('Posez d’abord le point de départ du plan (son origine), avant d’y tracer un chemin ou d’y poser un point.');
}

/** Ligne `id` de la ferme de la porte, ou undefined si elle n'existe pas ; d'une autre ferme : rejet. */
async function ligneDeLaFerme(tx: TransactionLocale, ctx: ContextePlan, table: SortePlan, id: string): Promise<Ligne | undefined> {
  const [l] = await lire<Ligne>(tx, `SELECT ferme_id, ${COLONNES[table].join(', ')} FROM ${table} WHERE id = ?`, [id]);
  if (l !== undefined && l.ferme_id !== ctx.fermeId) throw new Error(`${QUOI[table]} introuvable dans cette ferme.`);
  return l;
}

/** Une ligne active (non supprimée) de la ferme de la porte, dans `table` ; sinon rejet avec `message`. */
async function exigerActive(tx: TransactionLocale, ctx: ContextePlan, table: string, id: unknown, message: string): Promise<Ligne> {
  const ident = identifiantNormalise(id) ?? fautif(message);
  const [l] = await lire<Ligne>(tx, `SELECT * FROM ${table} WHERE id = ? AND ferme_id = ? AND supprime_le IS NULL`, [ident, ctx.fermeId]);
  return l ?? fautif(message);
}

/** Identifiant facultatif reçu, en minuscules ; null si nul ; rejet s'il est illisible. */
function identifiantOuNul(v: unknown, message: string): string | null {
  if (v === null || v === undefined) return null;
  return identifiantNormalise(v) ?? fautif(message);
}

/** Colonnes reçues relues au format rangé ; rejet d'une colonne inconnue ou d'un format illisible. */
function recues(table: SortePlan, valeurs: Ligne, existante: Ligne | undefined): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(valeurs)) {
    if (!COLONNES[table].includes(c)) throw new Error(`Ce changement (${QUOI[table].toLowerCase()}) contient une information inconnue.`);
    if (c === 'supprime_le' && v !== null) {
      if (existante === undefined) throw new Error(`${QUOI[table]} : une création ne se fait pas déjà supprimée.`);
      r[c] = instantNormalise(v) ?? fautif('Date de suppression illisible : un instant complet avec son fuseau est attendu.');
    } else if (c === 'batiment_id' || c === 'point_plan_id' || c === 'lieu_rangement_id' || c === 'place_rangement_id') {
      r[c] = identifiantOuNul(v, 'Référence illisible : rien n’est écrit.');
    } else {
      r[c] = v;
    }
  }
  return r;
}

/** La ligne complète (existante + reçue) validée, au format rangé dans la base locale. */
async function ligneValidee(tx: TransactionLocale, ctx: ContextePlan, table: SortePlan, id: string, ligne: Ligne, existante: Ligne | undefined): Promise<Ligne> {
  const active = ligne.supprime_le === null;
  switch (table) {
    case 'chemin': {
      const nom = nomDeChemin(ligne.nom);
      if (nom === undefined) throw new Error('Le nom du chemin a de 1 à 80 caractères, ou pas de nom.');
      const r = validerChemin({ points: pointsLus(ligne.points), largeur_m: ligne.largeur_m });
      if (!r.ok) throw new Error(r.erreur.message);
      if (active) await exigerOrigine(tx, ctx);
      return { nom, points: JSON.stringify(r.valeur.points), largeur_m: r.valeur.largeur_m, supprime_le: ligne.supprime_le };
    }
    case 'point_plan': {
      const r = validerPointPlan(ligne);
      if (!r.ok) throw new Error(r.erreur.message);
      if (active) await exigerOrigine(tx, ctx);
      return { ...r.valeur, supprime_le: ligne.supprime_le };
    }
    case 'lieu_rangement': {
      const batiment = ligne.batiment_id;
      const point = ligne.point_plan_id;
      if ((batiment === null) === (point === null)) throw new Error('Un lieu de rangement est un bâtiment ou un point du plan, l’un des deux.');
      if (existante !== undefined && (existante.batiment_id !== batiment || existante.point_plan_id !== point)) {
        throw new Error('Un lieu de rangement ne change pas de bâtiment ni de point : retirez-le, puis créez-en un autre.');
      }
      if (active) {
        const [colonne, table_, element] = batiment !== null ? (['batiment_id', 'batiment', batiment] as const) : (['point_plan_id', 'point_plan', point] as const);
        await exigerActive(tx, ctx, table_, element, batiment !== null ? 'Bâtiment introuvable dans cette ferme.' : 'Point du plan introuvable dans cette ferme.');
        const autre = await lire(tx, `SELECT 1 AS n FROM lieu_rangement WHERE ${colonne} = ? AND ferme_id = ? AND supprime_le IS NULL AND id <> ?`, [element, ctx.fermeId, id]);
        if (autre.length > 0) throw new Error('Cet élément est déjà un lieu de rangement.');
      }
      return { batiment_id: batiment, point_plan_id: point, supprime_le: ligne.supprime_le };
    }
    case 'place_rangement': {
      const r = validerPlaceRangement(ligne);
      if (!r.ok) throw new Error(r.erreur.message);
      const lieu = ligne.lieu_rangement_id;
      if (typeof lieu !== 'string') throw new Error('Une place est toujours dans un lieu de rangement.');
      if (existante !== undefined && existante.lieu_rangement_id !== lieu) throw new Error('Une place ne change pas de lieu de rangement.');
      if (active) {
        await exigerActive(tx, ctx, 'lieu_rangement', lieu, 'Lieu de rangement introuvable dans cette ferme.');
        const places = await lire<{ nom: unknown }>(tx, 'SELECT nom FROM place_rangement WHERE lieu_rangement_id = ? AND ferme_id = ? AND supprime_le IS NULL AND id <> ?', [lieu, ctx.fermeId, id]);
        if (places.some((p) => typeof p.nom === 'string' && nomEnBase(p.nom) === nomEnBase(r.valeur.nom))) throw new Error('Ce nom de place est déjà pris dans ce lieu de rangement.');
      }
      return { lieu_rangement_id: lieu, nom: r.valeur.nom, supprime_le: ligne.supprime_le };
    }
    case 'outil': {
      const r = validerOutil(ligne);
      if (!r.ok) throw new Error(r.erreur.message);
      const { lieu_rangement_id: lieu, place_rangement_id: place } = r.valeur;
      if (active) {
        await exigerActive(tx, ctx, 'lieu_rangement', lieu, 'Lieu de rangement introuvable dans cette ferme.');
        if (place !== null) {
          const p = await exigerActive(tx, ctx, 'place_rangement', place, 'Place de rangement introuvable dans cette ferme.');
          if (p.lieu_rangement_id !== lieu) throw new Error('Cette place n’est pas dans le lieu de rangement de l’outil.');
        }
        const outils = await lire<{ nom: unknown }>(tx, 'SELECT nom FROM outil WHERE ferme_id = ? AND supprime_le IS NULL AND id <> ?', [ctx.fermeId, id]);
        if (outils.some((o) => typeof o.nom === 'string' && nomEnBase(o.nom) === nomEnBase(r.valeur.nom))) throw new Error('Un outil de ce nom existe déjà dans la ferme.');
      }
      return { ...r.valeur, supprime_le: ligne.supprime_le };
    }
  }
  return fautif('Changement inconnu.');
}

/** Valeur d'avant d'une colonne, telle que l'appelant la donne (le tracé en tableau de points). */
function valeurRendue(colonne: string, v: unknown): unknown {
  if (colonne !== 'points') return v ?? null;
  const p = pointsLus(v);
  return Array.isArray(p) ? (p as PointPlacement[]) : null;
}

/** Écrit un changement d'un élément du plan ou du rangement ; rend son annulation. */
export async function placerElementPlan(tx: TransactionLocale, ctx: ContextePlan, id: string, c: ChangementPlan): Promise<ChangementPlacement> {
  const table = c.sorte;
  const valeurs = c.valeurs as Ligne;
  const existante = await ligneDeLaFerme(tx, ctx, table, id);
  const donnees = recues(table, valeurs, existante);
  const ligne = await ligneValidee(tx, ctx, table, id, { ...DEFAUTS, ...existante, ...donnees }, existante);
  const colonnes = COLONNES[table];
  const instant = ctx.maintenant().toISOString();
  if (existante === undefined) {
    await tx.execute(
      `INSERT INTO ${table} (id, ferme_id, ${colonnes.join(', ')}, cree_le, modifie_le) VALUES (?, ?, ${colonnes.map(() => '?').join(', ')}, ?, ?)`,
      [id, ctx.fermeId, ...colonnes.map((col) => ligne[col] ?? null), instant, instant],
    );
    // Annuler une création : suppression douce, à l'instant de la porte.
    return { sorte: table, id, valeurs: { supprime_le: instant } };
  }
  const modifiees = colonnes.filter((col) => Object.hasOwn(valeurs, col));
  if (modifiees.length > 0) {
    await tx.execute(`UPDATE ${table} SET ${modifiees.map((col) => `${col} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...modifiees.map((col) => ligne[col] ?? null), instant, id]);
  }
  return { sorte: table, id, valeurs: Object.fromEntries(modifiees.map((col) => [col, valeurRendue(col, existante[col])])) };
}
