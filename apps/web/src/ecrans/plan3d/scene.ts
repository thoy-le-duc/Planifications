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
 *   - T91 : la scène ne contient QUE ce qui est placé. Une zone sans contour ni serre n'y est plus (plus
 *     de grille inventée) : elle est listée dans `aPlacer`. Une planche non placée d'une zone placée
 *     est rangée dans cette zone (./disposition.ts). Une planche d'une sous-zone hors serre est lue dans
 *     le repère de la sous-zone si elle a un contour, sinon dans celui de la racine (comme l'éditeur).
 */
import { coinsEmprise, depuisRepereZone, repereZone, versRepereZone, type RepereZone } from '@planif/core/placement';
import type { BatimentPlan, CheminPlan, CleFamille, LigneEmplacementPlan, LigneZonePlan, Plan, PointPlan, SemainePlan } from '../plan/calculs.ts';
import { COULEUR_ESTOMPEE, COULEURS, FAMILLES } from '../../ui/jetons.ts';
import { bandesDesSerres, type BandeScene } from './bandes-scene.ts';

export type { BandeScene };
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
  /** T91 : pour le socle d'une sous-zone avec contour, la zone racine ; absent pour une zone racine. */
  readonly racineId?: string;
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
  /** T58 : ouvrants, porte, chauffage et voile d'un abri, posés par ./abris.ts ; absent : rien d'ouvert. */
  readonly ouvertures?: OuverturesBatiment;
}

/** T58 : ce qui se dessine d'un abri — vrai si l'équipement est déclaré et actif. */
export interface OuverturesBatiment {
  readonly lateraux: boolean;
  readonly faitage: boolean;
  readonly portes: boolean;
  readonly chauffage: boolean;
  readonly voile: boolean;
}

export interface Scene {
  readonly semaine: number;
  /** 'S14', recopié de plan.semaines. */
  readonly libelleSemaine: string;
  readonly socles: readonly SocleScene[];
  readonly volumes: readonly VolumeScene[];
  readonly batiments: readonly BatimentScene[];
  /** T91 : les zones sans contour ni serre, absentes de la scène (dans l'ordre du plan) ; versScene le rend toujours (vide : rien à placer). */
  readonly aPlacer?: readonly ZoneAPlacer[];
  /** T61 : chemins posés au sol, en bandes plates ; versScene le rend toujours (vide sans chemin). */
  readonly chemins?: readonly CheminScene[];
  /** T86 : les bandes des serres qui abritent une zone à sous-zones ; absent : aucune. */
  readonly bandes?: readonly BandeScene[];
}

/** T91 : une zone qui n'est pas dans la scène faute de contour et de serre. */
export interface ZoneAPlacer {
  readonly id: string;
  readonly nom: string;
}

/** T61 : une bande d'un chemin, rectangle de la famille des bâtiments (longueur selon z local, angle = −cap). */
export interface SegmentScene {
  readonly cx: number;
  readonly cz: number;
  readonly longueur: number;
  readonly angle: number;
}

export interface CheminScene {
  readonly id: string;
  readonly nom: string | null;
  readonly largeur: number;
  /** Épaisseur de la bande, posée au sol (quelques centimètres). */
  readonly epaisseur: number;
  readonly segments: readonly SegmentScene[];
}

/** T61 : une étiquette à la demande (nom d'un chemin ou d'un bâtiment), en repère de scène. */
export interface EtiquetteScene {
  readonly id: string;
  readonly sorte: 'chemin' | 'batiment' | 'bande';
  readonly nom: string;
  readonly x: number;
  readonly z: number;
}

/** Épaisseur d'une bande de chemin : posée au sol, au-dessus du terrain sans masquer les planches. */
export const EPAISSEUR_CHEMIN_M = 0.02;

/** Planche vide (ou barre sans famille, plan écrit à la main) : le trait des maquettes, discret. */
export const COULEUR_NEUTRE: string = COULEURS.trait;

/** Largeur supposée (m) d'une planche dont la largeur n'est pas renseignée. */
export const LARGEUR_PAR_DEFAUT_M = 0.8;

/** Mètres de scène par mètre réel : un seul facteur pour toute la scène. */
const ECHELLE = 1;
/** Hauteur d'une planche (m de scène), la même pour toutes. */
const HAUTEUR = 0.3 * ECHELLE;

// ── Serres et bâtiments (T28c) ───────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
/** Espacement visé entre deux arceaux (m). */
const PAS_ARCEAUX_M = 2;
/** Largeur visée d'une chapelle (m) ; une serre chapelle en compte autant qu'il en tient, entre 4 et 10 m chacune. */
const LARGEUR_NEF_M = 6;
const NEF_MAX_M = 10;
/** Opacité de la bâche : peu opaque, les cultures se voient à travers. */
export const OPACITE_BACHE = 0.15;

/** Couleur de chaque type de bâtiment : des jetons de l'appli. */
const COULEUR_BATIMENT: Readonly<Record<BatimentPlan['type'], string>> = {
  serre_tunnel: COULEURS.surface,
  serre_chapelle: COULEURS.surface,
  hangar: COULEURS.foretClair,
  // T61 : local et chambre froide se distinguent du hangar (et l'un de l'autre).
  local: COULEURS.secondaire,
  chambre_froide: COULEURS.surForetDoux,
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

/** T61 : un segment par paire de points qui se suivent ; milieu en repère de scène (x, −y), angle = −cap. */
function versCheminScene(c: CheminPlan): CheminScene {
  const segments: SegmentScene[] = [];
  for (let i = 1; i < c.points.length; i++) {
    const a = c.points[i - 1];
    const b = c.points[i];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    segments.push({ cx: (a.x + b.x) / 2, cz: -(a.y + b.y) / 2, longueur: Math.hypot(dx, dy), angle: -Math.atan2(dx, dy) });
  }
  return { id: c.id, nom: c.nom, largeur: c.largeurM, epaisseur: EPAISSEUR_CHEMIN_M, segments };
}

/**
 * T61 : étiquettes à la demande : les chemins nommés (au milieu de leur plus long segment, le
 * premier à égalité), puis les bâtiments (à leur centre), dans l'ordre de la scène ; un nom blanc n'en a pas.
 */
export function etiquettesScene(scene: Pick<Scene, 'chemins' | 'batiments' | 'bandes'>): EtiquetteScene[] {
  const r: EtiquetteScene[] = [];
  for (const c of scene.chemins ?? []) {
    const nom = c.nom?.trim() ?? '';
    const s = c.segments.reduce<SegmentScene | undefined>((m, x) => (m === undefined || x.longueur > m.longueur ? x : m), undefined);
    if (nom !== '' && s !== undefined) r.push({ id: c.id, sorte: 'chemin', nom, x: s.cx, z: s.cz });
  }
  for (const b of scene.batiments) if (b.nom.trim() !== '') r.push({ id: b.id, sorte: 'batiment', nom: b.nom.trim(), x: b.x, z: b.z });
  // T86 : le nom de chaque bande, à son centre.
  for (const b of scene.bandes ?? []) if (b.nom.trim() !== '') r.push({ id: b.id, sorte: 'bande', nom: b.nom.trim(), x: b.x, z: b.z });
  return r;
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

/** Une zone qui a un repère : racine avec serre ou contour (la serre prime), ou (T91) sous-zone avec contour hors serre. */
interface Porteur {
  readonly id: string;
  readonly nom: string;
  /** La racine d'une sous-zone ; nul pour une racine. */
  readonly racineId: string | null;
  readonly repere: RepereZone;
  readonly batiment: BatimentPlan | null;
  readonly contour: readonly PointPlan[] | null;
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

/** T59 : les planches du plan par id, calculées une fois par plan. */
const planchesDuPlan = new WeakMap<Plan, ReadonlyMap<string, LigneEmplacementPlan>>();
function planchesDe(plan: Plan): ReadonlyMap<string, LigneEmplacementPlan> {
  let m = planchesDuPlan.get(plan);
  if (m === undefined) {
    const n = new Map<string, LigneEmplacementPlan>();
    for (const l of plan.lignes) if (l.sorte === 'emplacement') n.set(l.id, l);
    m = n;
    planchesDuPlan.set(plan, m);
  }
  return m;
}

/**
 * T59 : la scène de la semaine `semaine`, à partir d'une scène du même plan (`base`, celle de
 * `versScene(plan, s)` pour n'importe quelle semaine `s`) : la géométrie ne dépend pas de la semaine,
 * seules les cultures changent. Même résultat que `versScene(plan, semaine)`, sans refaire les
 * placements ni les rangements : c'est ce qui rend la lecture de la saison fluide. Les socles et les
 * bâtiments sont ceux de `base` (mêmes références).
 */
export function sceneDeLaSemaine(base: Scene, plan: Plan, semaine: number): Scene {
  const semaines: readonly SemainePlan[] = plan.semaines;
  if (!Number.isInteger(semaine) || semaine < 0 || semaine >= semaines.length) {
    throw new RangeError(`semaine ${String(semaine)} hors du plan (0 à ${String(semaines.length - 1)})`);
  }
  const planches = planchesDe(plan);
  return {
    ...base,
    semaine,
    libelleSemaine: semaines[semaine]?.libelle ?? '',
    volumes: base.volumes.map((v) => {
      const l = planches.get(v.id);
      return l === undefined ? v : { ...v, ...cultureDeLaSemaine(l, semaine) };
    }),
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

  // Bâtiments, dans l'ordre du plan ; une zone n'a qu'une serre (la première l'emporte).
  const batimentsPlan = plan.batiments ?? [];
  const batiments = batimentsPlan.map(versBatimentScene);
  const batimentDeZone = new Map<string, BatimentPlan>();
  for (const b of batimentsPlan) if (b.zoneId !== null && !batimentDeZone.has(b.zoneId)) batimentDeZone.set(b.zoneId, b);

  // Un porteur = une zone qui a un repère (celui du moteur de T28a) : une racine avec serre ou contour, ou (T91) une
  // sous-zone avec contour hors serre. Les autres racines ne sont pas dans la scène : elles sont « à placer ».
  const sousZones = plan.sousZones ?? [];
  const sousZonePar = new Map(sousZones.map((s) => [s.id, s]));
  const racineDe = (id: string): string => {
    let courant = id;
    for (let i = 0; i <= sousZones.length; i++) {
      const parent = sousZonePar.get(courant)?.parenteId;
      if (parent === undefined) break;
      courant = parent;
    }
    return courant;
  };
  const porteurs = new Map<string, Porteur>();
  for (const z of zones) {
    const batiment = batimentDeZone.get(z.id) ?? null;
    const contour = batiment === null ? (z.contour ?? null) : null;
    const repere = repereZone({ contour }, batiment === null ? undefined : { centre: batiment.centre, orientationDeg: batiment.orientationDeg });
    if (repere !== null) porteurs.set(z.id, { id: z.id, nom: z.nom, racineId: null, repere, batiment, contour });
  }
  for (const sz of sousZones) {
    const racineId = racineDe(sz.id);
    if (batimentDeZone.has(racineId)) continue; // Sous-zone d'une serre : une bande ou une case, son contour est ignoré.
    const contour = sz.contour ?? null;
    const repere = repereZone({ contour });
    if (repere !== null) porteurs.set(sz.id, { id: sz.id, nom: sz.nom, racineId, repere, batiment: null, contour });
  }
  /** Qui porte la planche : sa sous-zone si elle a un contour (hors serre), sinon sa racine (T91, règle 3). */
  const porteurDe = (l: LigneEmplacementPlan): Porteur | undefined => {
    const directe = l.zoneDirecteId ?? l.zoneId;
    return (directe === l.zoneId ? undefined : porteurs.get(directe)) ?? porteurs.get(l.zoneId);
  };

  const socles = new Map<string, SocleScene>();
  const volumesPar = new Map<string, VolumeScene>();

  // T61 : les chemins sont placés aussi (repère de la ferme).
  const chemins = (plan.chemins ?? []).map(versCheminScene);

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

  // Les planches de chaque porteur, dans l'ordre du plan.
  const planchesDuPorteur = new Map<string, LigneEmplacementPlan[]>();
  const sansPorteur = new Set<string>();
  for (const z of zones) {
    for (const l of planchesPar.get(z.id) ?? []) {
      const porteur = porteurDe(l);
      if (porteur === undefined) {
        sansPorteur.add(z.id);
        continue;
      }
      const liste = planchesDuPorteur.get(porteur.id);
      if (liste === undefined) planchesDuPorteur.set(porteur.id, [l]);
      else liste.push(l);
    }
  }

  const socleDe = (info: Porteur): SocleScene | null => {
    const { batiment, contour } = info;
    if (batiment !== null) {
      return { id: info.id, nom: info.nom, x: batiment.centre.x, z: -batiment.centre.y, largeur: batiment.largeurM, profondeur: batiment.longueurM, angle: -batiment.orientationDeg * RAD, contour: null, placee: true, batimentId: batiment.id };
    }
    const points = (contour ?? []).map((p) => ({ x: p.x, z: -p.y }));
    const boite = etendre(null, points);
    if (boite === null) return null;
    return {
      id: info.id,
      nom: info.nom,
      x: (boite.x0 + boite.x1) / 2,
      z: (boite.z0 + boite.z1) / 2,
      largeur: boite.x1 - boite.x0,
      profondeur: boite.z1 - boite.z0,
      angle: 0,
      contour: points,
      placee: true,
      batimentId: null,
      ...(info.racineId === null ? {} : { racineId: info.racineId }),
    };
  };

  for (const info of porteurs.values()) {
    const { repere, batiment, contour } = info;
    const socle = socleDe(info);
    if (socle === null) continue;
    socles.set(info.id, socle);

    // Planches placées : dans le repère du porteur, tournées avec lui.
    const planches = planchesDuPorteur.get(info.id) ?? [];
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

  // T91 : les racines sans repère sont « à placer » (ordre du plan), sauf celles dont toutes les planches sont déjà dans une sous-zone placée.
  const toutesPlacees = (id: string): boolean => (planchesPar.get(id)?.length ?? 0) > 0 && !sansPorteur.has(id);
  const aPlacer: ZoneAPlacer[] = zones.filter((z) => !porteurs.has(z.id) && !toutesPlacees(z.id)).map((z) => ({ id: z.id, nom: z.nom }));

  // Socles : les racines dans l'ordre du plan, puis les sous-zones avec contour (ordre du plan).
  const sortieSocles: SocleScene[] = [];
  for (const zone of zones) {
    const s = socles.get(zone.id);
    if (s !== undefined) sortieSocles.push(s);
  }
  for (const sz of sousZones) {
    const s = socles.get(sz.id);
    if (s !== undefined) sortieSocles.push(s);
  }
  const volumes: VolumeScene[] = [];
  for (const l of plan.lignes) {
    if (l.sorte !== 'emplacement') continue;
    const v = volumesPar.get(l.id);
    if (v !== undefined) volumes.push(v);
  }
  // T86 : une bande par sous-zone directe d'une zone abritée par une serre (même sans planche).
  const bandes = bandesDesSerres(batimentDeZone, plan.sousZones ?? []);
  return { semaine, libelleSemaine, socles: sortieSocles, volumes, batiments, aPlacer, chemins, ...(bandes.length === 0 ? {} : { bandes }) };
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
  /** T55 : sous délai avant récolte à la date montrée (posé par ./dar3d.ts, `marquerDar`). */
  readonly dar?: boolean;
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
    // T91 : le filtre par zone se fait sur les zones racines (le volume porte sa racine) : pas sur les socles de sous-zones.
    zones: scene.socles.filter((s) => s.racineId === undefined).map((s) => ({ id: s.id, nom: s.nom })),
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
