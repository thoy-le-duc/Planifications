/**
 * Vue 3D (T27) — adaptateur PUR entre le plan de la 2D et les volumes de la scène. Contrat :
 * ./test/contrat.ts. Ni React, ni three, ni réseau, ni Date : testable sous Node, importable
 * partout sans rien tirer de la 3D.
 *
 * Aucun calcul agronomique : les cultures et leurs périodes viennent du plan (`construirePlan`),
 * seule la disposition des volumes est calculée ici. La forme réelle de la ferme est hors
 * périmètre (T27) : chaque zone est un socle rectangulaire, ses planches y sont rangées en
 * colonnes, et les zones sont rangées en rangées, sans chevauchement.
 */
import type { CleFamille, LigneEmplacementPlan, LigneZonePlan, Plan, SemainePlan } from '../plan/calculs.ts';
import { COULEUR_ESTOMPEE, COULEURS, FAMILLES } from '../../ui/jetons.ts';

export interface SocleScene {
  readonly id: string;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
}

export interface VolumeScene {
  /** Identifiant de l'emplacement. */
  readonly id: string;
  readonly code: string;
  readonly zoneId: string;
  readonly x: number;
  readonly z: number;
  readonly longueur: number;
  readonly largeur: number;
  readonly hauteur: number;
  readonly couleur: string;
  readonly cleFamille: CleFamille | null;
  readonly culture: string | null;
  readonly occupationId: string | null;
}

export interface Scene {
  readonly semaine: number;
  /** 'S14', recopié de plan.semaines. */
  readonly libelleSemaine: string;
  readonly socles: readonly SocleScene[];
  readonly volumes: readonly VolumeScene[];
}

/** Planche vide (ou barre sans famille, plan écrit à la main) : le trait des maquettes, discret. */
export const COULEUR_NEUTRE: string = COULEURS.trait;

/** Largeur supposée (m) d'une planche dont la largeur n'est pas renseignée. */
export const LARGEUR_PAR_DEFAUT_M = 0.8;

/** Mètres de scène par mètre réel : un seul facteur pour toute la scène. */
const ECHELLE = 1;
/** Hauteur d'une planche (m de scène), la même pour toutes. */
const HAUTEUR = 0.3 * ECHELLE;
/** Passe-pied entre deux planches, et entre deux colonnes de planches d'une zone. */
const ALLEE = 0.5 * ECHELLE;
/** Bord du socle autour des planches. */
const BORD = 1 * ECHELLE;
/** Chemin entre deux socles. */
const CHEMIN = 3 * ECHELLE;
/** Côté du socle d'une zone sans planche. */
const COTE_ZONE_VIDE = 4 * ECHELLE;

interface Place {
  readonly ligne: LigneEmplacementPlan;
  readonly longueur: number;
  readonly largeur: number;
  /** Coin (x, z) dans le socle, depuis son bord. */
  readonly x: number;
  readonly z: number;
}

interface ZoneRangee {
  readonly zone: LigneZonePlan;
  readonly largeur: number;
  readonly profondeur: number;
  readonly places: readonly Place[];
}

/**
 * Planches d'une zone en colonnes : chaque planche dans sa longueur selon x, empilées selon z ;
 * une colonne se ferme quand elle dépasse la profondeur visée (zone à peu près carrée).
 */
function rangerZone(zone: LigneZonePlan, planches: readonly LigneEmplacementPlan[]): ZoneRangee {
  if (planches.length === 0) return { zone, largeur: COTE_ZONE_VIDE, profondeur: COTE_ZONE_VIDE, places: [] };
  const tailles = planches.map((ligne) => ({
    ligne,
    longueur: ligne.longueurM * ECHELLE,
    largeur: (ligne.largeurM ?? LARGEUR_PAR_DEFAUT_M) * ECHELLE,
  }));
  const aire = tailles.reduce((s, t) => s + (t.longueur + ALLEE) * (t.largeur + ALLEE), 0);
  const profondeurVisee = Math.max(Math.sqrt(aire), ...tailles.map((t) => t.largeur));

  const places: Place[] = [];
  let x = 0;
  let z = 0;
  let longueurColonne = 0;
  let profondeur = 0;
  for (const t of tailles) {
    if (z > 0 && z + t.largeur > profondeurVisee) {
      x += longueurColonne + ALLEE;
      z = 0;
      longueurColonne = 0;
    }
    places.push({ ...t, x, z });
    longueurColonne = Math.max(longueurColonne, t.longueur);
    profondeur = Math.max(profondeur, z + t.largeur);
    z += t.largeur + ALLEE;
  }
  return { zone, largeur: x + longueurColonne + 2 * BORD, profondeur: profondeur + 2 * BORD, places };
}

/** Culture en place la semaine `i` : la barre qui couvre le plus de jours de [7i, 7i + 7[. */
function cultureDeLaSemaine(ligne: LigneEmplacementPlan, i: number): Pick<VolumeScene, 'couleur' | 'cleFamille' | 'culture' | 'occupationId'> {
  const debut = 7 * i;
  const fin = debut + 7;
  let meilleure: LigneEmplacementPlan['barres'][number] | null = null;
  let jours = 0;
  for (const b of ligne.barres) {
    const commun = Math.min(fin, b.finJour) - Math.max(debut, b.debutJour);
    if (commun > jours) {
      meilleure = b;
      jours = commun;
    }
  }
  if (meilleure === null) return { couleur: COULEUR_NEUTRE, cleFamille: null, culture: null, occupationId: null };
  return {
    couleur: meilleure.cleFamille === null ? COULEUR_NEUTRE : FAMILLES[meilleure.cleFamille].bande,
    cleFamille: meilleure.cleFamille,
    culture: meilleure.libelle,
    occupationId: meilleure.occupationId,
  };
}

/** Volumes et socles de la semaine d'indice `semaine` (colonne de la 2D). */
export function versScene(plan: Plan, semaine: number): Scene {
  const semaines: readonly SemainePlan[] = plan.semaines;
  if (!Number.isInteger(semaine) || semaine < 0 || semaine >= semaines.length) {
    throw new RangeError(`semaine ${String(semaine)} hors du plan (0 à ${String(semaines.length - 1)})`);
  }
  const libelleSemaine = semaines[semaine]?.libelle ?? '';

  // Zones dans l'ordre du plan, chacune avec ses planches (celles des chapelles comprises).
  const zones: LigneZonePlan[] = [];
  const planchesPar = new Map<string, LigneEmplacementPlan[]>();
  for (const l of plan.lignes) {
    if (l.sorte === 'zone') {
      zones.push(l);
      if (!planchesPar.has(l.id)) planchesPar.set(l.id, []);
    } else if (l.sorte === 'emplacement') {
      const liste = planchesPar.get(l.zoneId);
      if (liste === undefined) planchesPar.set(l.zoneId, [l]);
      else liste.push(l);
    }
  }
  const rangees = zones.map((z) => rangerZone(z, planchesPar.get(z.id) ?? []));

  // Zones en rangées, de gauche à droite, à peu près aussi larges que profondes au total.
  const aire = rangees.reduce((s, r) => s + (r.largeur + CHEMIN) * (r.profondeur + CHEMIN), 0);
  const largeurVisee = Math.max(Math.sqrt(aire) * 1.4, ...rangees.map((r) => r.largeur), 0);
  const coins: { x: number; z: number }[] = [];
  let x = 0;
  let z = 0;
  let profondeurRangee = 0;
  let largeurTotale = 0;
  for (const r of rangees) {
    if (x > 0 && x + r.largeur > largeurVisee) {
      x = 0;
      z += profondeurRangee + CHEMIN;
      profondeurRangee = 0;
    }
    coins.push({ x, z });
    largeurTotale = Math.max(largeurTotale, x + r.largeur);
    profondeurRangee = Math.max(profondeurRangee, r.profondeur);
    x += r.largeur + CHEMIN;
  }
  // La ferme centrée sur l'origine.
  const dx = -largeurTotale / 2;
  const dz = -(z + profondeurRangee) / 2;

  const socles: SocleScene[] = [];
  const volumesPar = new Map<string, VolumeScene>();
  rangees.forEach((r, k) => {
    const coin = coins[k] ?? { x: 0, z: 0 };
    const gauche = coin.x + dx;
    const haut = coin.z + dz;
    socles.push({ id: r.zone.id, nom: r.zone.nom, x: gauche + r.largeur / 2, z: haut + r.profondeur / 2, largeur: r.largeur, profondeur: r.profondeur });
    for (const p of r.places) {
      volumesPar.set(p.ligne.id, {
        id: p.ligne.id,
        code: p.ligne.code,
        zoneId: p.ligne.zoneId,
        x: gauche + BORD + p.x + p.longueur / 2,
        z: haut + BORD + p.z + p.largeur / 2,
        longueur: p.longueur,
        largeur: p.largeur,
        hauteur: HAUTEUR,
        ...cultureDeLaSemaine(p.ligne, semaine),
      });
    }
  });

  // Volumes dans l'ordre du plan.
  const volumes: VolumeScene[] = [];
  for (const l of plan.lignes) {
    if (l.sorte !== 'emplacement') continue;
    const v = volumesPar.get(l.id);
    if (v !== undefined) volumes.push(v);
  }
  return { semaine, libelleSemaine, socles, volumes };
}

// ── Filtres (T27b) ───────────────────────────────────────────────────────────────────────────

export { COULEUR_ESTOMPEE };

/** Hauteur (m de scène) d'une planche vide : à ras du sol, une culture ne s'y confond pas. */
const HAUTEUR_VIDE = 0.05 * ECHELLE;

export type DimensionFiltre = 'familles' | 'cultures' | 'zones';

/**
 * Trois dimensions. `null` = tout est coché ; un ensemble = seules ces valeurs le sont (vide :
 * rien). Familles : clés de famille ; cultures : libellé de la barre ; zones : id de la zone.
 */
export interface FiltresScene {
  readonly familles: ReadonlySet<string> | null;
  readonly cultures: ReadonlySet<string> | null;
  readonly zones: ReadonlySet<string> | null;
}

export interface VolumeFiltre extends VolumeScene {
  readonly estompe: boolean;
  /** Hauteur à dessiner : `hauteur` pour une culture, plus basse pour une planche vide. */
  readonly hauteurRendue: number;
}

export interface SceneFiltree extends Omit<Scene, 'volumes'> {
  readonly volumes: readonly VolumeFiltre[];
}

export interface OptionsFiltres {
  readonly familles: readonly string[];
  readonly cultures: readonly string[];
  readonly zones: readonly Pick<SocleScene, 'id' | 'nom'>[];
}

export const FILTRES_TOUT: FiltresScene = { familles: null, cultures: null, zones: null };
export const FILTRES_RIEN: FiltresScene = { familles: new Set<string>(), cultures: new Set<string>(), zones: new Set<string>() };

/** Les clés de famille dans l'ordre de la légende (celui de FAMILLES). */
const ORDRE_FAMILLES: readonly string[] = Object.keys(FAMILLES);

/** Ce que la légende et les cases proposent pour la semaine affichée. */
export function optionsFiltres(scene: Scene): OptionsFiltres {
  const familles = new Set<string>();
  const cultures = new Set<string>();
  for (const v of scene.volumes) {
    if (v.culture === null) continue;
    familles.add(v.cleFamille ?? 'autre');
    cultures.add(v.culture);
  }
  return {
    familles: ORDRE_FAMILLES.filter((cle) => familles.has(cle)),
    cultures: [...cultures].sort((a, b) => a.localeCompare(b, 'fr')),
    zones: scene.socles.map((s) => ({ id: s.id, nom: s.nom })),
  };
}

/** Vrai si le volume n'est pas coché sur au moins une dimension. Une planche vide n'a ni famille ni culture. */
export function estompe(volume: VolumeScene, filtres: FiltresScene): boolean {
  if (filtres.zones !== null && !filtres.zones.has(volume.zoneId)) return true;
  if (volume.culture === null) return filtres.familles !== null || filtres.cultures !== null;
  if (filtres.familles !== null && !filtres.familles.has(volume.cleFamille ?? 'autre')) return true;
  return filtres.cultures !== null && !filtres.cultures.has(volume.culture);
}

/** Hauteur à dessiner : la hauteur d'une culture, à ras du sol pour une planche vide (filtre ou pas). */
export function hauteurRendue(volume: VolumeScene): number {
  return volume.culture === null ? HAUTEUR_VIDE : volume.hauteur;
}

/** Mêmes socles et volumes que `scene` ; seules la couleur des volumes décochés et la hauteur des vides changent. */
export function appliquerFiltres(scene: Scene, filtres: FiltresScene): SceneFiltree {
  return {
    ...scene,
    volumes: scene.volumes.map((v) => {
      const estompee = estompe(v, filtres);
      return { ...v, estompe: estompee, couleur: estompee ? COULEUR_ESTOMPEE : v.couleur, hauteurRendue: hauteurRendue(v) };
    }),
  };
}

/** Coche la valeur si elle était décochée, la décoche sinon ; tout l'univers coché = `null`. */
export function basculerFiltre(filtres: FiltresScene, dimension: DimensionFiltre, valeur: string, valeursPossibles: readonly string[]): FiltresScene {
  const actuel = filtres[dimension];
  const suivant = new Set<string>(actuel ?? valeursPossibles);
  if (!suivant.delete(valeur)) suivant.add(valeur);
  const complet = valeursPossibles.every((v) => suivant.has(v));
  return { ...filtres, [dimension]: complet ? null : suivant };
}

export function cocherTout(filtres: FiltresScene, dimension: DimensionFiltre): FiltresScene {
  return { ...filtres, [dimension]: null };
}

export function cocherRien(filtres: FiltresScene, dimension: DimensionFiltre): FiltresScene {
  return { ...filtres, [dimension]: new Set<string>() };
}
