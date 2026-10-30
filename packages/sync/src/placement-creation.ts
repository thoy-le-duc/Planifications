/**
 * T89 : zones, sous-zones et emplacements CRÉÉS par `porte.placer`, dans le même enregistrement que la serre qui les abrite
 * (placement.ts, chargé à la demande). Contrat : en-tête de placement-creation.test.ts.
 *
 * Rejoue avant d'écrire ce que le serveur refuserait (apps/api/src/sync/structure.ts, structure-lignes.ts) : lignes de la ferme
 * de la porte seulement (un identifiant déjà pris par une autre ferme est refusé, sa ligne n'est jamais touchée), zone parente et
 * zone d'un emplacement de la ferme et non supprimées, pas de boucle de zones, code d'emplacement unique dans sa zone (Q27, sans
 * casse ni espaces autour), placement validé par le cœur et refusé sans origine du plan, mêmes plafonds que le serveur. Une
 * suppression douce (l'annulation) est refusée tant que la ligne sert encore, comme au serveur. Le gérant est vérifié par
 * placement.ts, une fois par appel, avant tout changement.
 *
 * L'annulation rendue remet les valeurs d'avant ; annuler une création est une suppression douce, à l'instant de la porte.
 */
import { identifiantNormalise, instantNormalise, validerPlacement } from '@planif/core';
import type { ChangementPlacement, TransactionLocale, ValeursEmplacementCreation, ValeursZoneCreation } from './types.ts';

/** Ce que la porte sait d'elle-même (comme ContextePlacement de placement.ts). */
export interface ContexteCreation {
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

type Ligne = Readonly<Record<string, unknown>>;

/** Mêmes listes et plafonds que la base et le serveur (@planif/db, PLAFONDS_STRUCTURE). */
const TYPES_ABRI: readonly string[] = ['plein_champ', 'tunnel', 'serre', 'hors_sol'];
/** Une gouttière a des pains (T51) : elle ne se crée pas ici. */
const SORTES_CREEES: readonly string[] = ['planche', 'rang'];
const TEXTE_MAX = 200;
const LONGUEUR_MAX_M = 10_000;
const LARGEUR_MAX_M = 1_000;
const SURFACE_MAX_M2 = 10_000_000;

const COLONNES_ZONE = ['nom', 'zone_parente_id', 'type_abri', 'surface_m2', 'supprime_le'] as const;
const COLONNES_EMPLACEMENT = ['zone_id', 'code', 'sorte', 'longueur_m', 'largeur_m', 'placement', 'supprime_le'] as const;

function fautif(message: string): never {
  throw new Error(message);
}

const lire = <T>(tx: TransactionLocale, sql: string, parametres: readonly unknown[]): Promise<T[]> => tx.getAll<T>(sql, parametres);

/** Nom comparé comme la base (lower(btrim(code))). */
const enBase = (v: string): string => v.trim().toLowerCase();

/** Jour (AAAA-MM-JJ) de `instant` dans le fuseau de la ferme ; fuseau illisible : le jour UTC. */
function jourDansFuseau(instant: Date, fuseau: unknown): string {
  if (typeof fuseau === 'string' && fuseau !== '') {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
    } catch {
      // Fuseau inconnu du navigateur : le jour UTC.
    }
  }
  return instant.toISOString().slice(0, 10);
}

async function jourDeLaFerme(tx: TransactionLocale, ctx: ContexteCreation): Promise<string> {
  const [f] = await lire<{ fuseau_horaire: unknown }>(tx, 'SELECT fuseau_horaire FROM ferme WHERE id = ?', [ctx.fermeId]);
  return jourDansFuseau(ctx.maintenant(), f?.fuseau_horaire);
}

async function exigerOrigine(tx: TransactionLocale, ctx: ContexteCreation): Promise<void> {
  const [ferme] = await lire<{ o: unknown }>(tx, 'SELECT origine_plan AS o FROM ferme WHERE id = ?', [ctx.fermeId]);
  if (ferme === undefined || ferme.o === null) throw new Error('Posez d’abord le point de départ du plan de la ferme (son origine), avant d’y placer des éléments.');
}

function texte(v: unknown, quoi: string): string {
  const Quoi = `${quoi.charAt(0).toUpperCase()}${quoi.slice(1)}`;
  if (typeof v !== 'string' || v.trim() === '') return fautif(`Il manque ${quoi}.`);
  if (v.includes('\u0000')) return fautif(`${Quoi} contient un caractère interdit.`);
  if (v.length > TEXTE_MAX) return fautif(`${Quoi} est trop long (${String(TEXTE_MAX)} caractères au plus).`);
  return v;
}

function positif(v: unknown, max: number, message: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max) return fautif(message);
  return v;
}

/** Colonnes reçues : connues, suppression en instant ISO UTC (jamais à la création). */
function recues(valeurs: Ligne, colonnes: readonly string[], existante: Ligne | undefined, quoi: string): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(valeurs)) {
    if (!colonnes.includes(c)) throw new Error(`Ce changement (${quoi}) contient une information inconnue.`);
    if (c === 'supprime_le' && v !== null && v !== undefined) {
      if (existante === undefined) throw new Error(`${quoi.charAt(0).toUpperCase()}${quoi.slice(1)} : une création ne se fait pas déjà supprimée.`);
      r[c] = instantNormalise(v) ?? fautif('Date de suppression illisible : un instant complet avec son fuseau est attendu.');
    } else if (v !== undefined) {
      r[c] = v;
    }
  }
  return r;
}

/** Une zone active de la ferme de la porte ; sinon rejet. */
async function exigerZoneActive(tx: TransactionLocale, ctx: ContexteCreation, id: string, message: string): Promise<void> {
  const [z] = await lire<{ n: number }>(tx, 'SELECT 1 AS n FROM zone WHERE id = ? AND ferme_id = ? AND supprime_le IS NULL', [id, ctx.fermeId]);
  if (z === undefined) throw new Error(message);
}

/** La parente n'est ni la zone ni l'une de ses sous-zones (pas de boucle), comme le serveur. */
async function exigerSansBoucle(tx: TransactionLocale, ctx: ContexteCreation, zoneId: string, parenteId: string): Promise<void> {
  const zones = await lire<{ id: string; zone_parente_id: string | null }>(tx, 'SELECT id, zone_parente_id FROM zone WHERE ferme_id = ?', [ctx.fermeId]);
  const parente = new Map(zones.map((z) => [z.id, z.zone_parente_id]));
  let courante: string | null = parenteId;
  for (let k = 0; courante !== null && k <= zones.length; k++) {
    if (courante === zoneId) throw new Error('Une zone ne se range pas dans elle-même ni dans l’une de ses sous-zones.');
    courante = parente.get(courante) ?? null;
  }
}

/** Assolements non supprimés d'une saison pas terminée (fin ≥ jour de la ferme) dont `colonne` vaut `id`. */
async function assolementsEnCours(tx: TransactionLocale, ctx: ContexteCreation, colonne: 'zone_id' | 'emplacement_id', id: string): Promise<number> {
  const jour = await jourDeLaFerme(tx, ctx);
  const l = await lire(
    tx,
    `SELECT 1 AS n FROM assolement a JOIN saison s ON s.id = a.saison_id AND s.ferme_id = a.ferme_id
      WHERE a.ferme_id = ? AND a.${colonne} = ? AND a.supprime_le IS NULL AND s.fin >= ?`,
    [ctx.fermeId, id, jour],
  );
  return l.length;
}

/** Retirer une zone : ni bâtiment qui l'abrite, ni emplacement, ni sous-zone, ni assolement d'une saison en cours (règle du serveur). */
async function exigerZoneLibre(tx: TransactionLocale, ctx: ContexteCreation, id: string): Promise<void> {
  const abritee = await lire(tx, 'SELECT 1 AS n FROM batiment WHERE zone_id = ? AND ferme_id = ? AND supprime_le IS NULL', [id, ctx.fermeId]);
  if (abritee.length > 0) throw new Error('Cette zone est abritée par un bâtiment : retirez d’abord le bâtiment.');
  const pleine = await lire(
    tx,
    `SELECT 1 AS n WHERE EXISTS (SELECT 1 FROM emplacement WHERE zone_id = ? AND ferme_id = ? AND supprime_le IS NULL)
        OR EXISTS (SELECT 1 FROM zone WHERE zone_parente_id = ? AND ferme_id = ? AND supprime_le IS NULL)`,
    [id, ctx.fermeId, id, ctx.fermeId],
  );
  if (pleine.length > 0) throw new Error('Cette zone contient encore des emplacements ou des sous-zones : retirez-les d’abord.');
  if ((await assolementsEnCours(tx, ctx, 'zone_id', id)) > 0) throw new Error('Cette zone est encore prévue dans le plan d’une saison en cours ou à venir.');
}

/** Retirer un emplacement : aucune occupation d'une série active ou d'une plantation en place, aucun assolement en cours. */
async function exigerEmplacementLibre(tx: TransactionLocale, ctx: ContexteCreation, id: string): Promise<void> {
  const jour = await jourDeLaFerme(tx, ctx);
  const occupe = await lire(
    tx,
    `SELECT 1 AS n FROM occupation o
       LEFT JOIN serie s ON s.id = o.serie_id AND s.ferme_id = o.ferme_id
       LEFT JOIN plantation p ON p.id = o.plantation_id AND p.ferme_id = o.ferme_id
      WHERE o.emplacement_id = ? AND o.ferme_id = ? AND o.supprime_le IS NULL
        AND ((s.id IS NOT NULL AND s.supprime_le IS NULL AND s.statut IN ('prevue', 'en_cours'))
          OR (p.id IS NOT NULL AND p.supprime_le IS NULL AND (p.date_arrachage IS NULL OR p.date_arrachage > ?)))`,
    [id, ctx.fermeId, jour],
  );
  if (occupe.length > 0) throw new Error('Cet emplacement est occupé par une culture prévue, en cours ou en place : libérez-le avant de le retirer.');
  if ((await assolementsEnCours(tx, ctx, 'emplacement_id', id)) > 0) throw new Error('Cet emplacement est encore prévu dans le plan d’une saison en cours ou à venir.');
}

/** Crée (ou, pour une annulation, modifie) une zone de la ferme de la porte ; rend son annulation. */
export async function placerZoneCreation(tx: TransactionLocale, ctx: ContexteCreation, id: string, valeurs: ValeursZoneCreation): Promise<ChangementPlacement> {
  const [existante] = await lire<Ligne>(tx, `SELECT ferme_id, ${COLONNES_ZONE.join(', ')} FROM zone WHERE id = ?`, [id]);
  if (existante !== undefined && existante.ferme_id !== ctx.fermeId) throw new Error('Zone introuvable dans cette ferme.');
  const donnees = recues(valeurs as Ligne, COLONNES_ZONE, existante, 'zone');
  if (donnees.zone_parente_id !== undefined && donnees.zone_parente_id !== null) {
    donnees.zone_parente_id = identifiantNormalise(donnees.zone_parente_id) ?? fautif('Zone parente introuvable dans cette ferme.');
  }
  const ligne: Ligne = { zone_parente_id: null, type_abri: 'plein_champ', surface_m2: null, supprime_le: null, ...existante, ...donnees };
  const nom = texte(ligne.nom, 'le nom de la zone');
  const typeAbri = ligne.type_abri ?? 'plein_champ';
  if (typeof typeAbri !== 'string' || !TYPES_ABRI.includes(typeAbri)) throw new Error('Type d’abri inconnu.');
  const surface = ligne.surface_m2 === null ? null : positif(ligne.surface_m2, SURFACE_MAX_M2, 'La surface de la zone doit être un nombre de m² plus grand que 0.');
  const parente = ligne.zone_parente_id;
  if (parente !== null && typeof parente !== 'string') throw new Error('Zone parente introuvable dans cette ferme.');
  const active = ligne.supprime_le === null;
  const retablie = existante !== undefined && existante.supprime_le !== null && active;
  if (active && parente !== null && (existante === undefined || retablie || existante.zone_parente_id !== parente)) {
    if (parente === id) throw new Error('Une zone ne se range pas dans elle-même ni dans l’une de ses sous-zones.');
    await exigerZoneActive(tx, ctx, parente, 'Zone parente introuvable dans cette ferme, ou supprimée.');
    await exigerSansBoucle(tx, ctx, id, parente);
  }
  if (!active && existante?.supprime_le === null) await exigerZoneLibre(tx, ctx, id);

  const instant = ctx.maintenant().toISOString();
  if (existante === undefined) {
    await tx.execute(
      `INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, equipements_abri, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      [id, ctx.fermeId, nom, parente, typeAbri, surface, instant, instant],
    );
    return { sorte: 'zone_creation', id, valeurs: { supprime_le: instant } };
  }
  const rangee: Ligne = { nom, zone_parente_id: parente, type_abri: typeAbri, surface_m2: surface, supprime_le: ligne.supprime_le };
  const modifiees = COLONNES_ZONE.filter((c) => Object.hasOwn(donnees, c));
  if (modifiees.length > 0) {
    await tx.execute(`UPDATE zone SET ${modifiees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`, [
      ...modifiees.map((c) => rangee[c] ?? null),
      instant,
      id,
      ctx.fermeId,
    ]);
  }
  return { sorte: 'zone_creation', id, valeurs: Object.fromEntries(modifiees.map((c) => [c, existante[c] ?? null])) };
}

type PlacementRecu = { readonly x: number; readonly y: number; readonly orientation_deg: number } | null;

/** Crée (ou, pour une annulation, modifie) un emplacement de la ferme de la porte ; rend son annulation. */
export async function placerEmplacementCreation(
  tx: TransactionLocale,
  ctx: ContexteCreation,
  id: string,
  valeurs: ValeursEmplacementCreation,
): Promise<ChangementPlacement> {
  const [existante] = await lire<Ligne>(
    tx,
    `SELECT ferme_id, zone_id, code, sorte, longueur_m, largeur_m, placement_x_m, placement_y_m, orientation_deg, actif_au, supprime_le FROM emplacement WHERE id = ?`,
    [id],
  );
  if (existante !== undefined && existante.ferme_id !== ctx.fermeId) throw new Error('Emplacement introuvable dans cette ferme.');
  const donnees = recues(valeurs as Ligne, COLONNES_EMPLACEMENT, existante, 'emplacement');
  if (donnees.zone_id !== undefined) donnees.zone_id = identifiantNormalise(donnees.zone_id) ?? fautif('Zone introuvable dans cette ferme.');
  const placementAvant: PlacementRecu =
    typeof existante?.placement_x_m === 'number' && typeof existante.placement_y_m === 'number' && typeof existante.orientation_deg === 'number'
      ? { x: existante.placement_x_m, y: existante.placement_y_m, orientation_deg: existante.orientation_deg }
      : null;
  const ligne: Ligne = { sorte: 'planche', largeur_m: null, placement: null, supprime_le: null, ...existante, ...(existante === undefined ? {} : { placement: placementAvant }), ...donnees };
  const zone = typeof ligne.zone_id === 'string' ? ligne.zone_id : fautif('Il manque la zone de l’emplacement.');
  const code = texte(ligne.code, 'le code de l’emplacement');
  const sorte = ligne.sorte;
  if (typeof sorte !== 'string' || !SORTES_CREEES.includes(sorte)) throw new Error('Sorte d’emplacement inconnue : une planche ou un rang.');
  const longueur = positif(ligne.longueur_m, LONGUEUR_MAX_M, `La longueur de l’emplacement doit être un nombre de mètres de plus de 0 à ${String(LONGUEUR_MAX_M)}.`);
  const largeur = ligne.largeur_m === null ? null : positif(ligne.largeur_m, LARGEUR_MAX_M, `La largeur de l’emplacement doit être un nombre de mètres de plus de 0 à ${String(LARGEUR_MAX_M)}.`);
  const p: unknown = ligne.placement ?? null;
  if (p !== null && typeof p !== 'object') throw new Error('Placement de l’emplacement illisible.');
  const lu = (p ?? {}) as { readonly x?: unknown; readonly y?: unknown; readonly orientation_deg?: unknown };
  const r = validerPlacement({ table: 'emplacement', ligne: { placement_x_m: lu.x ?? null, placement_y_m: lu.y ?? null, orientation_deg: lu.orientation_deg ?? null } });
  if (!r.ok) throw new Error(r.erreur.message);
  const active = ligne.supprime_le === null;
  const retabli = existante !== undefined && existante.supprime_le !== null && active;
  if (active) {
    if (r.valeur.placement_x_m !== null) await exigerOrigine(tx, ctx);
    if (existante === undefined || retabli || existante.zone_id !== zone) await exigerZoneActive(tx, ctx, zone, 'Zone de l’emplacement introuvable dans cette ferme, ou supprimée.');
    const enService = existante === undefined || existante.actif_au === null;
    if (enService && (existante === undefined || retabli || existante.zone_id !== zone || existante.code !== code)) {
      const codes = await lire<{ code: unknown }>(
        tx,
        'SELECT code FROM emplacement WHERE ferme_id = ? AND zone_id = ? AND supprime_le IS NULL AND actif_au IS NULL AND id <> ?',
        [ctx.fermeId, zone, id],
      );
      if (codes.some((c) => typeof c.code === 'string' && enBase(c.code) === enBase(code))) throw new Error(`Le code « ${code.trim()} » existe déjà dans cette zone.`);
    }
  }
  if (!active && existante?.supprime_le === null) await exigerEmplacementLibre(tx, ctx, id);

  const instant = ctx.maintenant().toISOString();
  if (existante === undefined) {
    await tx.execute(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, nombre_pains, actif_du, actif_au, remplace,
         placement_x_m, placement_y_m, orientation_deg, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, '[]', ?, ?, ?, ?, ?, NULL)`,
      [id, ctx.fermeId, zone, code, sorte, longueur, largeur, await jourDeLaFerme(tx, ctx), r.valeur.placement_x_m, r.valeur.placement_y_m, r.valeur.orientation_deg, instant, instant],
    );
    return { sorte: 'emplacement_creation', id, valeurs: { supprime_le: instant } };
  }
  const rangee: Ligne = {
    zone_id: zone,
    code,
    sorte,
    longueur_m: longueur,
    largeur_m: largeur,
    placement_x_m: r.valeur.placement_x_m,
    placement_y_m: r.valeur.placement_y_m,
    orientation_deg: r.valeur.orientation_deg,
    supprime_le: ligne.supprime_le,
  };
  const modifiees = COLONNES_EMPLACEMENT.filter((c) => Object.hasOwn(donnees, c));
  const colonnes = modifiees.flatMap((c) => (c === 'placement' ? ['placement_x_m', 'placement_y_m', 'orientation_deg'] : [c]));
  if (colonnes.length > 0) {
    await tx.execute(`UPDATE emplacement SET ${colonnes.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`, [
      ...colonnes.map((c) => rangee[c] ?? null),
      instant,
      id,
      ctx.fermeId,
    ]);
  }
  const avant: Record<string, unknown> = Object.fromEntries(modifiees.map((c) => [c, c === 'placement' ? placementAvant : (existante[c] ?? null)]));
  return { sorte: 'emplacement_creation', id, valeurs: avant };
}
