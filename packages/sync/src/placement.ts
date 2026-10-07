/**
 * T28s : la seule écriture du placement réel sur la base locale (`porte.placer`), chargée à la
 * demande (l'éditeur du plan, T28b, n'est pas au démarrage de l'appli). Contrat : en-tête de
 * porte-placement.test.ts.
 *
 * Elle rejoue avant d'écrire ce que le serveur refuserait (apps/api/src/sync/structure.ts,
 * structure-origine.ts), pour qu'un placement fait hors ligne ne soit pas refusé au retour du
 * réseau : gérant actif de la ferme de la porte (Q31), règles du cœur (validerPlacement,
 * validerContour), lignes de la ferme de la porte seulement, zone abritée sans contour, un
 * bâtiment par zone, origine figée dès qu'un placement existe. Tout se lit et s'écrit dans UNE
 * transaction locale : un seul envoi, que le serveur accepte ou refuse en entier.
 *
 * L'annulation rendue remet les valeurs lues dans la base locale au moment de l'écriture, dans
 * l'ordre inverse ; annuler une création est une suppression douce (le serveur n'accepte pas de
 * DELETE). Les messages de rejet sont en français (ceux du cœur pour ses règles).
 */
import { TAILLE_MAX_PAR_LOT, TYPES_BATIMENT, validerPlacement } from '@planif/core';
import type { BaseLocale, ChangementPlacement, PointPlacement, TransactionLocale, ValeursBatiment } from './types.ts';

export const SEUL_LE_GERANT = 'Seul le gérant peut placer les éléments de la ferme.';

/** Ce que la porte sait d'elle-même. */
export interface ContextePlacement {
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant: () => Date;
}

/** Colonnes d'un bâtiment que `placer` écrit. */
const COLONNES_BATIMENT = ['nom', 'type', 'longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg', 'zone_id', 'supprime_le'] as const;
type ColonneBatiment = (typeof COLONNES_BATIMENT)[number];
const estColonneBatiment = (c: string): c is ColonneBatiment => (COLONNES_BATIMENT as readonly string[]).includes(c);

/** Longueur au plus d'un nom (comme une cellule d'import, et le serveur). */
const NOM_CARACTERES_MAX = 200;

type LigneBatiment = Readonly<Record<ColonneBatiment | 'ferme_id', unknown>>;

const lire = <T>(tx: TransactionLocale, sql: string, parametres: readonly unknown[]): Promise<T[]> => tx.getAll<T>(sql, parametres);

/** Le texte JSON d'une colonne locale (jsonb), relu ; null si nul. Illisible : rejet, rien n'est écrit. */
function texteJson(v: unknown, quoi: string): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    throw new Error(`${quoi} enregistré est illisible : rien n’est modifié.`);
  }
}

/** L'utilisateur de la porte est-il gérant actif de sa ferme (ligne `membre` locale) ? Sinon rejet. */
async function verifierGerant(tx: TransactionLocale, ctx: ContextePlacement): Promise<void> {
  let lignes: unknown[];
  try {
    lignes = await lire(
      tx,
      `SELECT 1 AS n FROM membre WHERE utilisateur_id = ? AND ferme_id = ? AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL`,
      [ctx.utilisateurId, ctx.fermeId],
    );
  } catch {
    // Table des membres absente : on ne sait pas qui est gérant, rien n'est écrit.
    lignes = [];
  }
  if (lignes.length === 0) throw new Error(SEUL_LE_GERANT);
}

/** Zone que le bâtiment `id` peut abriter : de la ferme, non supprimée, sans contour, sans autre bâtiment. */
async function verifierZoneAbritee(tx: TransactionLocale, ctx: ContextePlacement, zoneId: string, batimentId: string): Promise<void> {
  const [zone] = await lire<{ ferme_id: unknown; contour: unknown; supprime_le: unknown }>(tx, 'SELECT ferme_id, contour, supprime_le FROM zone WHERE id = ?', [zoneId]);
  if (zone?.ferme_id !== ctx.fermeId) throw new Error('Zone introuvable dans cette ferme.');
  if (zone.supprime_le !== null) throw new Error('Cette zone est supprimée.');
  if (zone.contour !== null) throw new Error('Cette zone a son propre contour : effacez-le avant de l’abriter sous un bâtiment.');
  const autre = await lire(tx, 'SELECT 1 AS n FROM batiment WHERE zone_id = ? AND ferme_id = ? AND supprime_le IS NULL AND id <> ?', [zoneId, ctx.fermeId, batimentId]);
  if (autre.length > 0) throw new Error('Cette zone est déjà abritée par un autre bâtiment.');
}

async function placerBatiment(tx: TransactionLocale, ctx: ContextePlacement, id: string, valeurs: ValeursBatiment): Promise<ChangementPlacement> {
  const colonnes = Object.keys(valeurs);
  if (colonnes.some((c) => !estColonneBatiment(c))) throw new Error('Ce changement du bâtiment contient une information inconnue.');
  const [existant] = await lire<LigneBatiment>(tx, `SELECT ferme_id, ${COLONNES_BATIMENT.join(', ')} FROM batiment WHERE id = ?`, [id]);
  if (existant !== undefined && existant.ferme_id !== ctx.fermeId) throw new Error('Bâtiment introuvable dans cette ferme.');

  const ligne: Readonly<Record<string, unknown>> = { zone_id: null, supprime_le: null, ...existant, ...valeurs };
  if (typeof ligne.nom !== 'string' || ligne.nom.trim() === '') throw new Error('Il manque le nom du bâtiment.');
  if (ligne.nom.length > NOM_CARACTERES_MAX) throw new Error('Le nom du bâtiment est trop long.');
  if (typeof ligne.type !== 'string' || !(TYPES_BATIMENT as readonly string[]).includes(ligne.type)) throw new Error('Type de bâtiment inconnu.');
  const r = validerPlacement({ table: 'batiment', ligne });
  if (!r.ok) throw new Error(r.erreur.message);
  const supprime = ligne.supprime_le;
  if (supprime !== null && (typeof supprime !== 'string' || !Number.isFinite(Date.parse(supprime)))) throw new Error('Date de suppression illisible.');
  const zone = ligne.zone_id;
  if (zone !== null && typeof zone !== 'string') throw new Error('Zone introuvable dans cette ferme.');
  const zoneChange = existant?.zone_id !== zone || existant.supprime_le !== null;
  if (zone !== null && supprime === null && zoneChange) await verifierZoneAbritee(tx, ctx, zone, id);

  const instant = ctx.maintenant().toISOString();
  if (existant === undefined) {
    const valeursLigne = COLONNES_BATIMENT.map((c) => ligne[c] ?? null);
    await tx.execute(
      `INSERT INTO batiment (id, ferme_id, ${COLONNES_BATIMENT.join(', ')}, cree_le, modifie_le) VALUES (?, ?, ${COLONNES_BATIMENT.map(() => '?').join(', ')}, ?, ?)`,
      [id, ctx.fermeId, ...valeursLigne, instant, instant],
    );
    // Annuler une création : suppression douce, à l'instant de la porte.
    return { sorte: 'batiment', id, valeurs: { supprime_le: instant } };
  }
  const modifiees = colonnes.filter(estColonneBatiment);
  if (modifiees.length > 0) {
    await tx.execute(`UPDATE batiment SET ${modifiees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [
      ...modifiees.map((c) => ligne[c] ?? null),
      instant,
      id,
    ]);
  }
  return { sorte: 'batiment', id, valeurs: Object.fromEntries(modifiees.map((c) => [c, existant[c] ?? null])) };
}

async function placerZone(tx: TransactionLocale, ctx: ContextePlacement, id: string, contour: readonly PointPlacement[] | null): Promise<ChangementPlacement> {
  const [zone] = await lire<{ ferme_id: unknown; contour: unknown; supprime_le: unknown }>(tx, 'SELECT ferme_id, contour, supprime_le FROM zone WHERE id = ?', [id]);
  if (zone?.ferme_id !== ctx.fermeId) throw new Error('Zone introuvable dans cette ferme.');
  const avant = texteJson(zone.contour, 'Le contour');
  let texte: string | null = null;
  if (contour !== null) {
    if (zone.supprime_le !== null) throw new Error('Cette zone est supprimée.');
    const abritee = await lire(tx, 'SELECT 1 AS n FROM batiment WHERE zone_id = ? AND ferme_id = ? AND supprime_le IS NULL', [id, ctx.fermeId]);
    const r = validerPlacement({ table: 'zone', ligne: { contour }, abritee: abritee.length > 0 });
    if (!r.ok) throw new Error(r.erreur.message);
    // Sens antihoraire, x et y seulement : la forme que le serveur range.
    texte = JSON.stringify(r.valeur.contour);
  }
  await tx.execute('UPDATE zone SET contour = ?, modifie_le = ? WHERE id = ?', [texte, ctx.maintenant().toISOString(), id]);
  return { sorte: 'zone', id, contour: Array.isArray(avant) ? (avant as PointPlacement[]) : null };
}

async function placerEmplacement(
  tx: TransactionLocale,
  ctx: ContextePlacement,
  id: string,
  placement: { readonly x: number; readonly y: number; readonly orientation_deg: number } | null,
): Promise<ChangementPlacement> {
  const [e] = await lire<{ ferme_id: unknown; x: unknown; y: unknown; o: unknown }>(
    tx,
    'SELECT ferme_id, placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = ?',
    [id],
  );
  if (e?.ferme_id !== ctx.fermeId) throw new Error('Emplacement introuvable dans cette ferme.');
  const ligne = { placement_x_m: placement?.x ?? null, placement_y_m: placement?.y ?? null, orientation_deg: placement?.orientation_deg ?? null };
  const r = validerPlacement({ table: 'emplacement', ligne });
  if (!r.ok) throw new Error(r.erreur.message);
  await tx.execute('UPDATE emplacement SET placement_x_m = ?, placement_y_m = ?, orientation_deg = ?, modifie_le = ? WHERE id = ?', [
    r.valeur.placement_x_m,
    r.valeur.placement_y_m,
    r.valeur.orientation_deg,
    ctx.maintenant().toISOString(),
    id,
  ]);
  const place = typeof e.x === 'number' && typeof e.y === 'number' && typeof e.o === 'number';
  return { sorte: 'emplacement', id, placement: place ? { x: e.x as number, y: e.y as number, orientation_deg: e.o as number } : null };
}

const coordonnee = (v: unknown, borne: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -borne && v <= borne;

async function placerOrigine(
  tx: TransactionLocale,
  ctx: ContextePlacement,
  origine: { readonly latitude: number; readonly longitude: number } | null,
): Promise<ChangementPlacement> {
  if (origine !== null && !(coordonnee(origine.latitude, 90) && coordonnee(origine.longitude, 180))) {
    throw new Error('Le point de départ du plan doit avoir une latitude (de -90 à 90°) et une longitude (de -180 à 180°).');
  }
  const [ferme] = await lire<{ o: unknown }>(tx, 'SELECT origine_plan AS o FROM ferme WHERE id = ?', [ctx.fermeId]);
  if (ferme === undefined) throw new Error('Ferme introuvable.');
  const lu = texteJson(ferme.o, 'Le point de départ du plan');
  const avant =
    typeof lu === 'object' && lu !== null && coordonnee((lu as { latitude?: unknown }).latitude, 90) && coordonnee((lu as { longitude?: unknown }).longitude, 180)
      ? { latitude: (lu as { latitude: number }).latitude, longitude: (lu as { longitude: number }).longitude }
      : null;
  const deplacee = avant !== null && origine !== null && (avant.latitude !== origine.latitude || avant.longitude !== origine.longitude);
  if (deplacee) {
    const [p] = await lire<{ existe: number }>(
      tx,
      `SELECT (EXISTS (SELECT 1 FROM batiment WHERE ferme_id = ? AND supprime_le IS NULL)
            OR EXISTS (SELECT 1 FROM zone WHERE ferme_id = ? AND supprime_le IS NULL AND contour IS NOT NULL)
            OR EXISTS (SELECT 1 FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND placement_x_m IS NOT NULL)) AS existe`,
      [ctx.fermeId, ctx.fermeId, ctx.fermeId],
    );
    if (p?.existe === 1) throw new Error('Le point de départ du plan ne se déplace plus une fois des éléments placés.');
  }
  // Seule l'origine change : le serveur refuse toute autre colonne de la ferme.
  await tx.execute('UPDATE ferme SET origine_plan = ? WHERE id = ?', [origine === null ? null : JSON.stringify({ latitude: origine.latitude, longitude: origine.longitude }), ctx.fermeId]);
  return { sorte: 'origine', origine: avant };
}

function appliquer(tx: TransactionLocale, ctx: ContextePlacement, c: ChangementPlacement): Promise<ChangementPlacement> {
  switch (c.sorte) {
    case 'batiment':
      return placerBatiment(tx, ctx, c.id, c.valeurs);
    case 'zone':
      return placerZone(tx, ctx, c.id, c.contour);
    case 'emplacement':
      return placerEmplacement(tx, ctx, c.id, c.placement);
    case 'origine':
      return placerOrigine(tx, ctx, c.origine);
  }
  return Promise.reject(new Error('Changement de placement inconnu.'));
}

/**
 * Écrit `changements` (non vide, ECRITURES_MAX_PAR_LOT au plus : vérifié par la porte) en UNE
 * transaction locale ; rend l'annulation. Un rejet n'écrit rien.
 */
export async function ecrirePlacement(base: BaseLocale, ctx: ContextePlacement, changements: readonly ChangementPlacement[]): Promise<ChangementPlacement[]> {
  // Comme ecrireEnsemble : un envoi trop lourd serait refusé par le serveur, rejet avant d'ouvrir quoi que ce soit.
  if (new TextEncoder().encode(JSON.stringify(changements)).length > TAILLE_MAX_PAR_LOT) throw new Error('Trop de changements à la fois : placez-les en plusieurs fois.');
  return base.writeTransaction(async (tx) => {
    await verifierGerant(tx, ctx);
    const annulation: ChangementPlacement[] = [];
    for (const c of changements) annulation.unshift(await appliquer(tx, ctx, c));
    return annulation;
  });
}
