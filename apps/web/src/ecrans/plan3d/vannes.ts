/**
 * Vue 3D (T57) — les vannes d'irrigation, partie pure : le repère de chaque vanne dans la scène,
 * la coloration des planches (filtre « Irrigation », planches de la vanne choisie) et la phrase de
 * sa fiche. Ni React, ni three : chargé à la demande avec ./Vannes3d.tsx, à part du morceau 3D.
 * Contrat : ./test/contrat-vannes.ts.
 *
 * Aucune règle réécrite : ce qu'une vanne arrose et la classe d'une irrigation viennent du cœur
 * (`@planif/core/irrigation`) ; seule la disposition (où poser le repère) est calculée ici.
 */
import { classeIrrigation, emplacementsArroses, type ClasseIrrigation, type Irrigation, type LienVanne } from '@planif/core/irrigation';
import { COULEUR_ESTOMPEE, COULEURS_IRRIGATION_3D } from '../../ui/jetons.ts';
import type { SceneFiltree, VolumeScene } from './scene.ts';

export type { ClasseIrrigation };

/** Une vanne lue dans la base : position sur le plan (repère de la ferme), ou nulle. */
export interface VanneLue {
  readonly id: string;
  readonly numero: number;
  readonly nom: string;
  readonly x: number | null;
  readonly y: number | null;
}

/** Le repère d'une vanne dans la scène, et les planches qu'elle arrose aujourd'hui. */
export interface Repere3d {
  readonly id: string;
  readonly numero: number;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly planches: readonly string[];
  readonly codes: readonly string[];
}

type VolumeVanne = Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'longueur' | 'angle'>;

const comparerCodes = (a: string, b: string): number => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

/**
 * Un repère par vanne qui a une place, triés par numéro : sa position si elle est placée
 * (x, −y), sinon la tête de sa première planche (plus petit code), au bout de départ, à l'opposé
 * de son cap.
 */
export function reperesVannes(vannes: readonly VanneLue[], liens: readonly LienVanne[], volumes: readonly VolumeVanne[], jour: string): Repere3d[] {
  const parId = new Map(volumes.map((v) => [v.id, v]));
  const reperes: Repere3d[] = [];
  for (const vanne of [...vannes].sort((a, b) => a.numero - b.numero || (a.id < b.id ? -1 : 1))) {
    const arrosees = emplacementsArroses(liens, vanne.id, jour)
      .flatMap((id) => {
        const v = parId.get(id);
        return v === undefined ? [] : [v];
      })
      .sort((a, b) => comparerCodes(a.code, b.code));
    const planches = arrosees.map((v) => v.id);
    const codes = arrosees.map((v) => v.code);
    if (vanne.x !== null && vanne.y !== null) {
      reperes.push({ id: vanne.id, numero: vanne.numero, nom: vanne.nom, x: vanne.x, z: -vanne.y, planches, codes });
      continue;
    }
    const premiere = arrosees[0];
    if (premiere === undefined) continue;
    const demi = premiere.longueur / 2;
    reperes.push({
      id: vanne.id,
      numero: vanne.numero,
      nom: vanne.nom,
      x: premiere.x - Math.cos(premiere.angle) * demi,
      z: premiere.z + Math.sin(premiere.angle) * demi,
      planches,
      codes,
    });
  }
  return reperes;
}

/** Classe de la dernière irrigation de chaque planche de la scène. */
export function classesIrrigation(volumes: readonly Pick<VolumeScene, 'id'>[], dernieres: ReadonlyMap<string, Pick<Irrigation, 'date'>>, aujourdhui: string): Map<string, ClasseIrrigation> {
  return new Map(volumes.map((v) => [v.id, classeIrrigation(dernieres.get(v.id)?.date ?? null, aujourdhui)]));
}

/**
 * Couleurs du filtre « Irrigation » (ui/jetons.ts) : bleu franc (aujourd'hui), bleu clair (hier),
 * sable (plus ancienne), gris (jamais).
 */
export const COULEURS_IRRIGATION: Readonly<Record<ClasseIrrigation, string>> = COULEURS_IRRIGATION_3D;

/** Ne change que `couleur` et `estompe` des volumes : filtre « Irrigation », planches de la vanne choisie. */
export function colorer(filtree: SceneFiltree, options: { readonly irrigation: ReadonlyMap<string, ClasseIrrigation> | null; readonly evidence: ReadonlySet<string> | null }): SceneFiltree {
  const { irrigation, evidence } = options;
  if (irrigation === null && evidence === null) return filtree;
  return {
    ...filtree,
    volumes: filtree.volumes.map((v) => {
      if (evidence !== null && !evidence.has(v.id)) return { ...v, estompe: true, couleur: COULEUR_ESTOMPEE };
      if (irrigation === null) return v;
      return { ...v, estompe: false, couleur: COULEURS_IRRIGATION[irrigation.get(v.id) ?? 'jamais'] };
    }),
  };
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] as const;
const deux = (n: number): string => String(n).padStart(2, '0');

/** « 20 min », « 1 h », « 1 h 30 ». */
function duree(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${deux(m)}`;
}

/** « aujourd’hui 7 h », « hier 18 h 30 », « le 12 octobre 7 h » (heure locale du téléphone). */
function quand(i: Pick<Irrigation, 'date' | 'horodatage'>, aujourdhui: string): string {
  const d = new Date(i.horodatage);
  const heure = Number.isNaN(d.getTime()) ? '' : d.getMinutes() === 0 ? ` ${String(d.getHours())} h` : ` ${String(d.getHours())} h ${deux(d.getMinutes())}`;
  const classe = classeIrrigation(i.date, aujourdhui);
  if (classe === 'aujourdhui') return `aujourd’hui${heure}`;
  if (classe === 'hier') return `hier${heure}`;
  const mois = MOIS[Number(i.date.slice(5, 7)) - 1] ?? '';
  return `le ${String(Number(i.date.slice(8, 10)))} ${mois}${heure}`;
}

/** « V12 — arrose P3, P4, P5 — dernière irrigation : aujourd’hui 7 h, 20 min ». */
export function phraseVanne(repere: Pick<Repere3d, 'nom' | 'codes'>, derniere: Pick<Irrigation, 'date' | 'horodatage' | 'dureeMinutes'> | null, aujourdhui: string): string {
  const arrose = repere.codes.length === 0 ? 'n’arrose aucune planche' : `arrose ${repere.codes.join(', ')}`;
  const irrigation = derniere === null ? 'aucune' : `${quand(derniere, aujourdhui)}, ${duree(derniere.dureeMinutes)}`;
  return `${repere.nom} — ${arrose} — dernière irrigation : ${irrigation}`;
}
