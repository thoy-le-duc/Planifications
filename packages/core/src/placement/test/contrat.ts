/**
 * Contrat de `packages/core/src/placement` (T28a, docs/backlog/T28a-placement-modele.md ; Q30,
 * Q31 de docs/questions.md) : l'API que les tests attendent de `src/placement/index.ts`,
 * réexportée par `@planif/core` (src/index.ts : `export * from './placement/index.ts'`).
 *
 * Le module est chargé dynamiquement (`chargerPlacement`) : tant qu'il n'existe pas, les tests
 * échouent sur « n'exporte pas encore » au lieu de casser le typage de tout le dépôt.
 * `../types.test.ts` vérifie, lui, statiquement que le module écrit satisfait `ModulePlacement`.
 *
 * Tout est pur : ni base, ni réseau, ni horloge. Aucun arrondi dans les sorties (les tests
 * comparent à 1 mm ou mieux) ; aucune exception, quelle que soit l'entrée des validations.
 *
 * ── Repère local de la ferme ────────────────────────────────────────────────────────────────
 *
 * Mètres ; x vers l'est, y vers le nord ; origine = `ferme.origine_plan` (latitude, longitude
 * en degrés décimaux, WGS 84). Orientation : degrés, sens horaire depuis le nord (cap), dans
 * [0, 360[.
 *
 *   versLocal(origine, point: PositionGeographique): PointLocal
 *   versGeographique(origine, point: PointLocal): PositionGeographique
 *
 * Projection locale équirectangulaire, R = RAYON_TERRESTRE_M = 6 378 137 m, φ0 = latitude de
 * l'origine (en radians) :
 *   x = R · (λ − λ0) · cos φ0      y = R · (φ − φ0)          (angles en radians)
 * et son inverse exact. Exemple chiffré (origine 44° N, 1,5° E) :
 *   versLocal({44, 1.5}, {latitude: 44.00089831528412, longitude: 1.5012488052012367})
 *     ≈ {x: 100, y: 100} (au millimètre).
 *
 * ── Repère d'un rectangle (bâtiment) et d'une zone ──────────────────────────────────────────
 *
 * Un repère = un centre (PointLocal, dans le repère de la ferme) et une orientation θ (cap de
 * l'axe de la LONGUEUR). Dans le repère d'une zone ou d'un bâtiment, l'axe y' suit la
 * longueur (cap θ), l'axe x' est à sa droite (cap θ + 90°) :
 *   ey = (sin θ, cos θ)      ex = (cos θ, −sin θ)
 *   depuisRepereZone(r, p') = r.centre + p'.x · ex + p'.y · ey
 *   versRepereZone(r, p)    = l'inverse exact.
 * À θ = 0, le repère d'une zone est celui de la ferme translaté. Exemple du ticket : planche à
 * (2, 0) dans une serre centrée en (50, 30), tournée de 90° → (50, 28) dans la ferme.
 *
 *   coinsEmprise(centre, longueurM, largeurM, orientationDeg): [PointLocal × 4]
 * Les 4 coins, dans le repère de la ferme, dans CET ordre (antihoraire) : les points du repère
 * du rectangle (−l/2, −L/2), (+l/2, −L/2), (+l/2, +L/2), (−l/2, +L/2), passés par
 * `depuisRepereZone` (l = largeur, L = longueur).
 *
 *   repereZone(zone: { contour }, batiment?: { centre, orientationDeg } | null): RepereZone | null
 *   - bâtiment donné (zone abritée) : son centre et son orientation, tels quels ;
 *   - sinon contour non nul : centre = CENTROÏDE DE SURFACE du polygone (formule du lacet, pas
 *     la moyenne des sommets) ; orientation = cap du plus long côté (côté i = sommet i → sommet
 *     i+1, le dernier revenant au premier), RAMENÉ DANS [0, 180[ (un côté n'a pas de sens : cap
 *     β et β + 180 donnent la même orientation ; 180 → 0). À égalité de longueur (à 1e-9 m
 *     près), le premier côté dans l'ordre des sommets ;
 *   - ni l'un ni l'autre : null (zone pas placée).
 *
 * ── validerContour(entree: unknown): ResultatPlacement<readonly PointLocal[]> ──────────────
 *
 * Entrée : un tableau de sommets `{x, y}` (mètres locaux), NON fermé (le premier sommet n'est
 * pas répété à la fin). Règles, vérifiées DANS CET ORDRE (la première violée est rendue) :
 *   1. tableau attendu                                              → 'entree_invalide'
 *   2. au moins 3 sommets (CONTOUR_SOMMETS_MIN)                     → 'trop_peu_de_sommets'
 *   3. au plus 200 sommets (CONTOUR_SOMMETS_MAX)                    → 'trop_de_sommets'
 *   4. chaque sommet est un objet dont x et y sont des nombres finis → 'coordonnee_invalide'
 *   5. chaque sommet à DISTANCE_MAX_ORIGINE_M = 5 000 m au plus de l'origine (0, 0), borne
 *      comprise                                                     → 'trop_loin'
 *   6. pas deux sommets consécutifs confondus (à moins de 1 mm, dernier → premier compris)
 *                                                                   → 'sommets_confondus'
 *   7. polygone non auto-intersectant : deux côtés NON ADJACENTS n'ont aucun point commun
 *      (croisement ou simple contact)                               → 'auto_intersection'
 *   8. aire (formule du lacet, valeur absolue) > AIRE_MIN_M2 = 0,1 m² → 'aire_nulle'
 * Valide : `valeur` = les sommets `{x, y}` (seulement ces deux clés), en sens ANTIHORAIRE
 * (aire signée > 0). Un contour déjà antihoraire est rendu à l'identique (mêmes sommets, même
 * ordre) ; un contour horaire est rendu inversé (permutation circulaire libre de l'ordre
 * inverse).
 *
 * ── validerPlacement(entree): ResultatPlacement<…> ──────────────────────────────────────────
 *
 * Les règles que le serveur rejouera (T28s), sur les COLONNES de la ligne (snake_case, telles
 * que le téléphone les envoie) ; `champ` de l'erreur = nom de la colonne. Valeurs `unknown` :
 * un nombre est un `number` fini (un texte « 12 » est refusé). Ordre des règles : celui des
 * listes ci-dessous, colonnes dans l'ordre donné.
 *
 * table 'emplacement' : placement_x_m, placement_y_m, orientation_deg (repère de la zone).
 *   - tout ou rien : les trois nulles (ou absentes) → valide, tout à null (rangement
 *     automatique) ; certaines seulement             → 'incomplet' (champ : la première
 *     colonne nulle)
 *   - placement_x_m, placement_y_m nombres finis      → 'coordonnee_invalide'
 *   - orientation_deg nombre fini dans [0, 360[       → 'orientation_invalide'
 *   - √(x² + y²) ≤ 5 000 m                            → 'trop_loin' (champ placement_x_m)
 *
 * table 'batiment' : longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg.
 *   - toutes obligatoires (un bâtiment est toujours placé) → 'incomplet'
 *   - centre_x_m, centre_y_m nombres finis            → 'coordonnee_invalide'
 *   - longueur_m, largeur_m, hauteur_m nombres finis > 0 → 'dimension_invalide'
 *   - plafonds, bornes comprises (PLAFONDS_BATIMENT) : longueur 500 m, largeur 200 m,
 *     hauteur 30 m                                    → 'plafond_depasse'
 *   - orientation_deg nombre fini dans [0, 360[       → 'orientation_invalide'
 *   - centre à 5 000 m au plus de l'origine           → 'trop_loin' (champ centre_x_m)
 *
 * table 'zone' : contour (tableau de sommets, ou son texte JSON tel que le téléphone le garde),
 * plus `abritee` : un bâtiment non supprimé abrite la zone (le serveur le lit en base).
 *   - abritée : contour nul obligatoire (sa forme est le rectangle du bâtiment)
 *                                                     → 'zone_abritee_avec_contour' (champ contour)
 *   - contour nul ou absent → valide, `{ contour: null }` (zone pas placée)
 *   - texte JSON illisible                            → 'entree_invalide'
 *   - sinon `validerContour` : son erreur, champ 'contour' ; valide → contour antihoraire.
 *
 * Messages : en français, non vides, 200 caractères au plus.
 */
import type { PositionGeographique } from '../../domaine/entites.ts';

export type { PositionGeographique };

/** Point du repère local de la ferme (ou d'une zone), en mètres. */
export interface PointLocal {
  readonly x: number;
  readonly y: number;
}

export interface RepereZone {
  readonly centre: PointLocal;
  /** Cap de l'axe de la longueur, degrés, sens horaire depuis le nord. */
  readonly orientationDeg: number;
}

export type Coins = readonly [PointLocal, PointLocal, PointLocal, PointLocal];

export type CodeErreurPlacement =
  | 'entree_invalide'
  | 'trop_peu_de_sommets'
  | 'trop_de_sommets'
  | 'coordonnee_invalide'
  | 'trop_loin'
  | 'sommets_confondus'
  | 'auto_intersection'
  | 'aire_nulle'
  | 'incomplet'
  | 'orientation_invalide'
  | 'dimension_invalide'
  | 'plafond_depasse'
  | 'zone_abritee_avec_contour';

export interface ErreurPlacement {
  readonly code: CodeErreurPlacement;
  /** Colonne en cause ('orientation_deg', 'contour'…), ou null. */
  readonly champ: string | null;
  /** En français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatPlacement<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurPlacement };

export interface EntreePlacementEmplacement {
  readonly table: 'emplacement';
  readonly ligne: Readonly<Record<string, unknown>>;
}
export interface EntreePlacementBatiment {
  readonly table: 'batiment';
  readonly ligne: Readonly<Record<string, unknown>>;
}
export interface EntreePlacementZone {
  readonly table: 'zone';
  readonly ligne: Readonly<Record<string, unknown>>;
  readonly abritee: boolean;
}

export interface PlacementEmplacement {
  readonly placement_x_m: number | null;
  readonly placement_y_m: number | null;
  readonly orientation_deg: number | null;
}
export interface PlacementBatiment {
  readonly longueur_m: number;
  readonly largeur_m: number;
  readonly hauteur_m: number;
  readonly centre_x_m: number;
  readonly centre_y_m: number;
  readonly orientation_deg: number;
}
export interface PlacementZone {
  readonly contour: readonly PointLocal[] | null;
}

export type TypeBatiment = 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre';

export interface ModulePlacement {
  readonly RAYON_TERRESTRE_M: number;
  readonly DISTANCE_MAX_ORIGINE_M: number;
  readonly CONTOUR_SOMMETS_MIN: number;
  readonly CONTOUR_SOMMETS_MAX: number;
  readonly AIRE_MIN_M2: number;
  readonly PLAFONDS_BATIMENT: { readonly longueurM: number; readonly largeurM: number; readonly hauteurM: number };
  readonly TYPES_BATIMENT: readonly TypeBatiment[];

  versLocal(origine: PositionGeographique, point: PositionGeographique): PointLocal;
  versGeographique(origine: PositionGeographique, point: PointLocal): PositionGeographique;

  coinsEmprise(centre: PointLocal, longueurM: number, largeurM: number, orientationDeg: number): Coins;
  repereZone(
    zone: { readonly contour: readonly PointLocal[] | null },
    batiment?: { readonly centre: PointLocal; readonly orientationDeg: number } | null,
  ): RepereZone | null;
  versRepereZone(repere: RepereZone, point: PointLocal): PointLocal;
  depuisRepereZone(repere: RepereZone, point: PointLocal): PointLocal;

  validerContour(entree: unknown): ResultatPlacement<readonly PointLocal[]>;
  validerPlacement(entree: EntreePlacementEmplacement): ResultatPlacement<PlacementEmplacement>;
  validerPlacement(entree: EntreePlacementBatiment): ResultatPlacement<PlacementBatiment>;
  validerPlacement(entree: EntreePlacementZone): ResultatPlacement<PlacementZone>;
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export async function chargerCoeurPlacement(): Promise<Partial<ModulePlacement>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModulePlacement>;
}

export const ATTENDUS = [
  'RAYON_TERRESTRE_M',
  'DISTANCE_MAX_ORIGINE_M',
  'CONTOUR_SOMMETS_MIN',
  'CONTOUR_SOMMETS_MAX',
  'AIRE_MIN_M2',
  'PLAFONDS_BATIMENT',
  'TYPES_BATIMENT',
  'versLocal',
  'versGeographique',
  'coinsEmprise',
  'repereZone',
  'versRepereZone',
  'depuisRepereZone',
  'validerContour',
  'validerPlacement',
] as const satisfies readonly (keyof ModulePlacement)[];

/** Le module complet, ou une erreur claire qui nomme les exports manquants. */
export async function chargerPlacement(): Promise<ModulePlacement> {
  const m = await chargerCoeurPlacement();
  const manquants = ATTENDUS.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T28a)`);
  return m as ModulePlacement;
}

// ── Aides de test ────────────────────────────────────────────────────────────────────────────

/** Aire signée (formule du lacet) : > 0 en sens antihoraire. */
export function aireSignee(points: readonly PointLocal[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) throw new Error('sommet manquant');
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Rotation horaire de `deg` degrés autour de l'origine (un cap β devient β + deg). */
export function tourner(p: PointLocal, deg: number): PointLocal {
  const t = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(t) + p.y * Math.sin(t), y: -p.x * Math.sin(t) + p.y * Math.cos(t) };
}

/** Polygone régulier convexe antihoraire de `n` sommets, rayon `r` m, centré en (cx, cy). */
export function polygoneRegulier(n: number, r = 50, cx = 0, cy = 0): PointLocal[] {
  return Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
}
