/**
 * Vue 3D (T27, T28c) — adaptateur PUR entre le plan de la 2D et les volumes de la scène. Contrats :
 * ./test/contrat.ts (T27) et ./test/contrat-jumeau.ts (T28c). Ni React, ni three, ni réseau, ni
 * Date : testable sous Node, importable partout sans rien tirer de la 3D.
 *
 * Aucun calcul agronomique : les cultures et leurs périodes viennent du plan (`construirePlan`),
 * seule la disposition est calculée ici.
 *   - Ce qui est placé (T28a) est posé à sa vraie place : le repère de chaque zone est celui du
 *     moteur (`repereZone`), la planche est à `depuisRepereZone`, la serre à `coinsEmprise`.
 *     Mètres réels = mètres de scène (échelle 1) ; x_scène = x_ferme, z_scène = −y_ferme.
 *   - Ce qui n'est pas placé garde la disposition de T27 (socles rectangulaires, planches en
 *     colonnes, zones en rangées), à côté de la partie placée ; une planche non placée d'une zone
 *     placée est rangée dans cette zone (./disposition.ts).
 */
import { coinsEmprise, depuisRepereZone, repereZone, versRepereZone, type RepereZone } from '@planif/core';
import type { BatimentPlan, CleFamille, LigneEmplacementPlan, LigneZonePlan, Plan, PointPlan, SemainePlan } from '../plan/calculs.ts';
import { COULEUR_ESTOMPEE, COULEURS, FAMILLES } from '../../ui/jetons.ts';
import { rangerDansZone, type Conteneur, type RectZone, type Taille } from './disposition.ts';

/** Point du repère de la scène (x, z), en mètres. */
export interface PointScene {
  readonly x: number;
  readonly z: number;
}

export interface SocleScene {
  readonly id: string;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
  /** Radians (convention de three, comme `Boite.angle`) ; 0 hors zone abritée. */
  readonly angle: number;
  /** Sommets du contour en repère de scène (x, −y), ou nul (le socle est son rectangle). */
  readonly contour: readonly PointScene[] | null;
  /** Vrai si la zone a un repère (serre ou contour) : sa forme vient de la ferme, pas du rangement. */
  readonly placee: boolean;
  /** Bâtiment qui abrite la zone, ou nul. */
  readonly batimentId: string | null;
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
  /** Radians (convention de three) : `longueur` selon l'axe x local tourné de `angle`. */
  readonly angle: number;
  /** Vrai si la planche a un placement dans une zone placée. */
  readonly placee: boolean;
  readonly couleur: string;
  readonly cleFamille: CleFamille | null;
  readonly culture: string | null;
  readonly occupationId: string | null;
}

export type FormeBatiment = 'tunnel' | 'chapelles' | 'volume';

export interface BatimentScene {
  readonly id: string;
  readonly nom: string;
  readonly type: BatimentPlan['type'];
  readonly zoneId: string | null;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
  readonly hauteur: number;
  readonly angle: number;
  readonly forme: FormeBatiment;
  /** Positions des arceaux le long de l'axe z local, de −profondeur/2 à +profondeur/2 ; vide pour un volume. */
  readonly arceaux: readonly number[];
  /** Chapelles accolées (1 pour un tunnel et un volume). */
  readonly nefs: number;
  /** Opacité de la bâche (1 pour un volume). */
  readonly opacite: number;
  readonly couleur: string;
}

export interface Scene {
  readonly semaine: number;
  /** 'S14', recopié de plan.semaines. */
  readonly libelleSemaine: string;
  readonly socles: readonly SocleScene[];
  readonly volumes: readonly VolumeScene[];
  readonly batiments: readonly BatimentScene[];
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

// ── Serres et bâtiments (T28c) ───────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
/** Espacement visé entre deux arceaux (m). */
const PAS_ARCEAUX_M = 2;
/** Largeur visée d'une chapelle (m) ; une serre chapelle en compte autant qu'il en tient, entre 4 et 10 m chacune. */
const LARGEUR_NEF_M = 6;
const NEF_MAX_M = 10;
/** Opacité de la bâche : peu opaque, les cultures se voient à travers. */
export const OPACITE_BACHE = 0.15;
/** Écart (m) entre la partie placée et les zones non placées rangées à côté. */
const ECART_PARTIE_PLACEE = 10;

/** Couleur de chaque type de bâtiment : des jetons de l'appli. */
const COULEUR_BATIMENT: Readonly<Record<BatimentPlan['type'], string>> = {
  serre_tunnel: COULEURS.surface,
  serre_chapelle: COULEURS.surface,
  hangar: COULEURS.foretClair,
  magasin: COULEURS.orange,
  autre: COULEURS.trait,
};

/** Arceaux régulièrement espacés d'environ 2 m, des deux extrémités comprises (au moins 2). */
function positionsArceaux(profondeur: number): number[] {
  const n = Math.max(2, Math.round(profondeur / PAS_ARCEAUX_M) + 1);
  const pas = profondeur / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? profondeur / 2 : -profondeur / 2 + i * pas));
}

/** Nombre de chapelles accolées : de 4 à 10 m chacune dès que la serre fait au moins 4 m de large. */
function nombreDeNefs(largeur: number): number {
  let n = Math.max(1, Math.round(largeur / LARGEUR_NEF_M));
  while (largeur / n > NEF_MAX_M) n += 1;
  return n;
}

function versBatimentScene(b: BatimentPlan): BatimentScene {
  const forme: FormeBatiment = b.type === 'serre_tunnel' ? 'tunnel' : b.type === 'serre_chapelle' ? 'chapelles' : 'volume';
  return {
    id: b.id,
    nom: b.nom,
    type: b.type,
    zoneId: b.zoneId,
    x: b.centre.x,
    z: -b.centre.y,
    largeur: b.largeurM,
    profondeur: b.longueurM,
    hauteur: b.hauteurM,
    angle: -b.orientationDeg * RAD,
    forme,
    arceaux: forme === 'volume' ? [] : positionsArceaux(b.longueurM),
    nefs: forme === 'chapelles' ? nombreDeNefs(b.largeurM) : 1,
    opacite: forme === 'volume' ? 1 : OPACITE_BACHE,
    couleur: COULEUR_BATIMENT[b.type],
  };
}

// ── Géométrie de la partie placée ────────────────────────────────────────────────────────────

interface Boite2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Coins d'un rectangle de scène : `ex` selon son x local, `ez` selon son z local, tourné de `angle`. */
export function coinsRectScene(cx: number, cz: number, ex: number, ez: number, angle: number): PointScene[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx = 0, sz = 0]) => {
    const dx = (sx * ex) / 2;
    const dz = (sz * ez) / 2;
    return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c };
  });
}

function etendre(boite: Boite2 | null, points: readonly PointScene[]): Boite2 | null {
  let b = boite;
  for (const p of points) {
    b = b === null ? { x0: p.x, x1: p.x, z0: p.z, z1: p.z } : { x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) };
  }
  return b;
}

/** Cap (degrés, [0, 360[) → angle de rotation d'un rectangle dont la LONGUEUR est selon x local (planche). */
const angleDePlanche = (capDeg: number): number => Math.PI / 2 - capDeg * RAD;

const mod360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Placement complet d'une planche (les trois valeurs numériques), sinon nul : un placement partiel n'en est pas un. */
function placementValide(l: LigneEmplacementPlan): { x: number; y: number; orientationDeg: number } | null {
  const p: Partial<Record<'x' | 'y' | 'orientationDeg', unknown>> | null | undefined = l.placement;
  if (p === null || p === undefined) return null;
  const { x, y, orientationDeg } = p;
  return typeof x === 'number' && typeof y === 'number' && typeof orientationDeg === 'number' && Number.isFinite(x + y + orientationDeg) ? { x, y, orientationDeg } : null;
}

/** Une zone qui a un repère : serre ou contour (la serre prime). */
interface ZonePlacee {
  readonly repere: RepereZone;
  readonly batiment: BatimentPlan | null;
  readonly contour: readonly PointPlan[] | null;
}

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

const largeurDe = (l: LigneEmplacementPlan): number => (l.largeurM ?? LARGEUR_PAR_DEFAUT_M) * ECHELLE;

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

  // Bâtiments, dans l'ordre du plan ; une zone n'a qu'une serre (la première l'emporte).
  const batimentsPlan = plan.batiments ?? [];
  const batiments = batimentsPlan.map(versBatimentScene);
  const batimentDeZone = new Map<string, BatimentPlan>();
  for (const b of batimentsPlan) if (b.zoneId !== null && !batimentDeZone.has(b.zoneId)) batimentDeZone.set(b.zoneId, b);

  // Repère de chaque zone placée (celui du moteur de T28a) ; les autres sont rangées comme en T27.
  const placees = new Map<string, ZonePlacee>();
  for (const z of zones) {
    const batiment = batimentDeZone.get(z.id) ?? null;
    const contour = batiment === null ? (z.contour ?? null) : null;
    const repere = repereZone({ contour }, batiment === null ? undefined : { centre: batiment.centre, orientationDeg: batiment.orientationDeg });
    if (repere !== null) placees.set(z.id, { repere, batiment, contour });
  }

  const socles = new Map<string, SocleScene>();
  const volumesPar = new Map<string, VolumeScene>();
  /** Emprise de tout ce qui est placé (socles, bâtiments, planches) : les zones non placées se rangent à côté. */
  let emprise: Boite2 | null = null;

  for (const b of batimentsPlan) emprise = etendre(emprise, coinsEmprise(b.centre, b.longueurM, b.largeurM, b.orientationDeg).map((p) => ({ x: p.x, z: -p.y })));

  const volumeDe = (l: LigneEmplacementPlan, x: number, z: number, angle: number, placee: boolean): VolumeScene => ({
    id: l.id,
    code: l.code,
    zoneId: l.zoneId,
    x,
    z,
    longueur: l.longueurM * ECHELLE,
    largeur: largeurDe(l),
    hauteur: HAUTEUR,
    angle,
    placee,
    ...cultureDeLaSemaine(l, semaine),
  });

  for (const z of zones) {
    const info = placees.get(z.id);
    if (info === undefined) continue;
    const { repere, batiment, contour } = info;
    let socle: SocleScene;
    if (batiment !== null) {
      socle = { id: z.id, nom: z.nom, x: batiment.centre.x, z: -batiment.centre.y, largeur: batiment.largeurM, profondeur: batiment.longueurM, angle: -batiment.orientationDeg * RAD, contour: null, placee: true, batimentId: batiment.id };
    } else {
      const points = (contour ?? []).map((p) => ({ x: p.x, z: -p.y }));
      const boite = etendre(null, points);
      if (boite === null) continue;
      socle = { id: z.id, nom: z.nom, x: (boite.x0 + boite.x1) / 2, z: (boite.z0 + boite.z1) / 2, largeur: boite.x1 - boite.x0, profondeur: boite.z1 - boite.z0, angle: 0, contour: points, placee: true, batimentId: null };
      emprise = etendre(emprise, points);
    }
    socles.set(z.id, socle);

    // Planches placées : dans le repère de la zone, tournées avec elle.
    const planches = planchesPar.get(z.id) ?? [];
    const deja: RectZone[] = [];
    const aRanger: LigneEmplacementPlan[] = [];
    for (const l of planches) {
      const p = placementValide(l);
      if (p === null) {
        aRanger.push(l);
        continue;
      }
      const centre = depuisRepereZone(repere, { x: p.x, y: p.y });
      const cap = mod360(repere.orientationDeg + p.orientationDeg);
      const v = volumeDe(l, centre.x, -centre.y, angleDePlanche(cap), true);
      volumesPar.set(l.id, v);
      deja.push({ x: p.x, y: p.y, longueur: v.longueur, largeur: v.largeur, capDeg: p.orientationDeg });
    }

    // Les autres : rangées dans la zone, alignées sur son axe, sans toucher aux premières.
    if (aRanger.length > 0) {
      const demi = batiment !== null ? { demiX: batiment.largeurM / 2, demiY: batiment.longueurM / 2 } : null;
      const conteneur: Conteneur =
        demi !== null
          ? { sorte: 'rectangle', ...demi }
          : { sorte: 'polygone', points: (contour ?? []).map((p) => versRepereZone(repere, p)) };
      const tailles: Taille[] = aRanger.map((l) => ({ longueur: l.longueurM * ECHELLE, largeur: largeurDe(l) }));
      const rangees = rangerDansZone(conteneur, deja, tailles);
      aRanger.forEach((l, k) => {
        const r = rangees[k];
        if (r === undefined) return;
        const centre = depuisRepereZone(repere, { x: r.x, y: r.y });
        volumesPar.set(l.id, volumeDe(l, centre.x, -centre.y, angleDePlanche(mod360(repere.orientationDeg + r.capDeg)), false));
      });
    }
  }
  // Ce qui est posé (planches comprises, au cas où l'une déborderait) est dans l'emprise.
  for (const v of volumesPar.values()) emprise = etendre(emprise, coinsRectScene(v.x, v.z, v.longueur, v.largeur, v.angle));
  for (const s of socles.values()) if (s.contour === null) emprise = etendre(emprise, coinsRectScene(s.x, s.z, s.largeur, s.profondeur, s.angle));

  // Zones non placées : disposition de T27, centrée sur l'origine s'il n'y a rien de placé, sinon à l'est de la partie placée.
  const aRanger = zones.filter((z) => !placees.has(z.id));
  const rangees = aRanger.map((z) => rangerZone(z, planchesPar.get(z.id) ?? []));
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
  const dx = emprise === null ? -largeurTotale / 2 : emprise.x1 + ECART_PARTIE_PLACEE;
  const dz = emprise === null ? -(z + profondeurRangee) / 2 : emprise.z0;

  rangees.forEach((r, k) => {
    const coin = coins[k] ?? { x: 0, z: 0 };
    const gauche = coin.x + dx;
    const haut = coin.z + dz;
    socles.set(r.zone.id, { id: r.zone.id, nom: r.zone.nom, x: gauche + r.largeur / 2, z: haut + r.profondeur / 2, largeur: r.largeur, profondeur: r.profondeur, angle: 0, contour: null, placee: false, batimentId: null });
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
        angle: 0,
        placee: false,
        ...cultureDeLaSemaine(p.ligne, semaine),
      });
    }
  });

  // Socles dans l'ordre du plan, volumes dans l'ordre du plan.
  const sortieSocles: SocleScene[] = [];
  for (const zone of zones) {
    const s = socles.get(zone.id);
    if (s !== undefined) sortieSocles.push(s);
  }
  const volumes: VolumeScene[] = [];
  for (const l of plan.lignes) {
    if (l.sorte !== 'emplacement') continue;
    const v = volumesPar.get(l.id);
    if (v !== undefined) volumes.push(v);
  }
  return { semaine, libelleSemaine, socles: sortieSocles, volumes, batiments };
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
