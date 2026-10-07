/**
 * Cadrage et vol de la caméra de la vue 3D (T29, Q30) : fonctions pures, des nombres en entrée et
 * en sortie. Ni React, ni three, ni DOM, ni horloge : le module est importable sous Node, ne
 * pèse rien au démarrage, et se teste sans navigateur. Contrat : ./test/contrat-camera.ts.
 *
 * Repère de la scène (celui de scene.ts) : x vers la droite, y vers le haut, z vers l'avant du
 * plan ; le sol est y = 0. Distances en mètres de scène, angles en radians, sauf `champVertical`
 * (degrés, comme le `fov` de three).
 */
import type { Scene } from './scene.ts';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Parallélépipède aligné sur les axes, tourné de `angle` autour de la verticale de son centre (convention de three). */
export interface Boite {
  readonly min: Point3;
  readonly max: Point3;
  readonly angle?: number;
}

export interface Pose {
  readonly position: Point3;
  readonly cible: Point3;
}

/** Vecteur horizontal qui va de la cible vers la caméra. */
export interface Direction {
  readonly x: number;
  readonly z: number;
}

export type CibleVol = { readonly sorte: 'ferme' } | { readonly sorte: 'zone'; readonly id: string } | { readonly sorte: 'planche'; readonly id: string };

export interface Vol {
  readonly depart: Pose;
  readonly arrivee: Pose;
  readonly dureeMs: number;
}

/** Durée maximale d'un vol (ms). */
export const DUREE_VOL_MAX_MS = 600;
/** Part de l'écran laissée libre autour de la boîte cadrée. */
export const MARGE_CADRAGE = 0.1;
/** Plongée de la caméra sur la cible (degrés). */
export const PLONGEE_DEGRES = 45;
/** Distance minimale de la caméra à sa cible (m) : une planche minuscule ne colle pas la caméra au sol. */
export const DISTANCE_MIN_M = 3;

/** Durée d'un vol : un socle de 250 ms, plus 4 ms par mètre parcouru, plafonnée. */
const DUREE_BASE_MS = 250;
const MS_PAR_METRE = 4;
/** Profondeur minimale d'un coin devant la caméra (m), pour qu'aucun ne passe derrière. */
const PROFONDEUR_MIN_M = 1e-3;

function distance3(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Les boîtes ───────────────────────────────────────────────────────────────────────────────

/** Emprise au sol et hauteur cumulées des éléments d'une cible ; `vide` tant que rien n'a été ajouté. */
interface Cumul {
  vide: boolean;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  hauteur: number;
}

function ajouter(c: Cumul, x0: number, x1: number, z0: number, z1: number, hauteur: number): void {
  c.x0 = c.vide ? x0 : Math.min(c.x0, x0);
  c.x1 = c.vide ? x1 : Math.max(c.x1, x1);
  c.z0 = c.vide ? z0 : Math.min(c.z0, z0);
  c.z1 = c.vide ? z1 : Math.max(c.z1, z1);
  c.hauteur = Math.max(c.hauteur, hauteur);
  c.vide = false;
}

/** La boîte à cadrer : toute la ferme, une zone (son socle et ses planches) ou une planche. `null` : rien à cadrer. */
export function boiteDe(scene: Scene, cible: CibleVol): Boite | null {
  const c: Cumul = { vide: true, x0: 0, x1: 0, z0: 0, z1: 0, hauteur: 0 };
  const ajouterSocle = (s: Scene['socles'][number]): void => {
    ajouter(c, s.x - s.largeur / 2, s.x + s.largeur / 2, s.z - s.profondeur / 2, s.z + s.profondeur / 2, 0);
  };
  const ajouterVolume = (v: Scene['volumes'][number]): void => {
    ajouter(c, v.x - v.longueur / 2, v.x + v.longueur / 2, v.z - v.largeur / 2, v.z + v.largeur / 2, v.hauteur);
  };
  if (cible.sorte === 'ferme') {
    scene.socles.forEach(ajouterSocle);
    scene.volumes.forEach(ajouterVolume);
  } else if (cible.sorte === 'zone') {
    const socle = scene.socles.find((s) => s.id === cible.id);
    if (socle === undefined) throw new RangeError(`zone inconnue : ${cible.id}`);
    ajouterSocle(socle);
    scene.volumes.filter((v) => v.zoneId === cible.id).forEach(ajouterVolume);
  } else {
    const volume = scene.volumes.find((v) => v.id === cible.id);
    if (volume === undefined) throw new RangeError(`planche inconnue : ${cible.id}`);
    ajouterVolume(volume);
  }
  if (c.vide) return null;
  return { min: { x: c.x0, y: 0, z: c.z0 }, max: { x: c.x1, y: c.hauteur, z: c.z1 } };
}

// ── Le cadrage ───────────────────────────────────────────────────────────────────────────────

/**
 * La pose qui garde la boîte entière à l'écran avec `MARGE_CADRAGE` de marge, vue à
 * `PLONGEE_DEGRES` de plongée, du côté de `direction`. La distance est la plus courte qui fait
 * tenir les 8 coins : pour chaque coin, la profondeur voulue se résout en une formule fermée
 * (la position latérale d'un coin ne dépend pas du recul le long de la ligne de visée).
 */
export function cadrage(boite: Boite, champVertical: number, rapportEcran: number, direction: Direction): Pose {
  if (!(champVertical > 0 && champVertical < 180)) throw new RangeError(`champ vertical invalide : ${String(champVertical)}`);
  if (!(rapportEcran > 0) || !Number.isFinite(rapportEcran)) throw new RangeError(`rapport d'écran invalide : ${String(rapportEcran)}`);
  const { min, max } = boite;
  if (!(min.x <= max.x && min.y <= max.y && min.z <= max.z)) throw new RangeError('boîte à l’envers (min > max)');
  const norme = Math.hypot(direction.x, direction.z);
  if (!(norme > 0) || !Number.isFinite(norme)) throw new RangeError('direction nulle ou infinie');

  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cz = (min.z + max.z) / 2;
  const angle = boite.angle ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Repère de la caméra : v = de la cible vers la caméra (unitaire), r = droite de l'écran, h = haut de l'écran.
  const ux = direction.x / norme;
  const uz = direction.z / norme;
  const plongee = (PLONGEE_DEGRES * Math.PI) / 180;
  const vx = ux * Math.cos(plongee);
  const vy = Math.sin(plongee);
  const vz = uz * Math.cos(plongee);
  const rx = uz;
  const rz = -ux;
  // h = r × avant (avant = −v), au signe près : seules les valeurs absolues servent.
  const hx = rz * vy;
  const hy = rx * vz - rz * vx;
  const hz = -rx * vy;

  const t = Math.tan((champVertical * Math.PI) / 360);
  const utile = 1 - MARGE_CADRAGE;
  let recul = DISTANCE_MIN_M;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const dx = x - cx;
        const dz = z - cz;
        const px = dx * cos + dz * sin;
        const py = y - cy;
        const pz = -dx * sin + dz * cos;
        const versCamera = px * vx + py * vy + pz * vz;
        const lateral = Math.abs(px * rx + pz * rz) / (utile * t * rapportEcran);
        const vertical = Math.abs(px * hx + py * hy + pz * hz) / (utile * t);
        recul = Math.max(recul, versCamera + Math.max(lateral, vertical, PROFONDEUR_MIN_M));
      }
    }
  }
  return {
    position: { x: cx + recul * vx, y: cy + recul * vy, z: cz + recul * vz },
    cible: { x: cx, y: cy, z: cz },
  };
}

// ── Le vol ───────────────────────────────────────────────────────────────────────────────────

/** Un vol de `depart` à `arrivee` : 0 ms (saut direct) si le mouvement est réduit, sinon 600 ms au plus. */
export function demarrerVol(depart: Pose, arrivee: Pose, mouvementReduit: boolean): Vol {
  if (mouvementReduit) return { depart, arrivee, dureeMs: 0 };
  const course = Math.max(distance3(depart.position, arrivee.position), distance3(depart.cible, arrivee.cible));
  const dureeMs = Math.min(DUREE_VOL_MAX_MS, DUREE_BASE_MS + MS_PAR_METRE * course);
  return { depart, arrivee, dureeMs };
}

function entre(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function entrePoints(a: Point3, b: Point3, p: number): Point3 {
  return { x: entre(a.x, b.x, p), y: entre(a.y, b.y, p), z: entre(a.z, b.z, p) };
}

/** La pose `ecouleMs` après le début du vol : départ et arrivée exacts, adoucis aux deux bouts (3t² − 2t³). */
export function poseAu(vol: Vol, ecouleMs: number): Pose {
  if (ecouleMs <= 0 && vol.dureeMs > 0) return vol.depart;
  if (vol.dureeMs <= 0 || ecouleMs >= vol.dureeMs) return vol.arrivee;
  const t = ecouleMs / vol.dureeMs;
  const p = t * t * (3 - 2 * t);
  return { position: entrePoints(vol.depart.position, vol.arrivee.position, p), cible: entrePoints(vol.depart.cible, vol.arrivee.cible, p) };
}
