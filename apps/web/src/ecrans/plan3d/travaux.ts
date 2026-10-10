/**
 * Vue 3D (T37) — les travaux du jour, numérotés sur les planches, pour les ouvriers (Q36).
 * Module pur, sans React ni three : mêmes tâches et même ordre que l'écran « Aujourd'hui » (ses
 * fonctions `lireJournee`, `calculerJournee` et `tachesDeLEcran`, jamais un second calcul).
 * Lecture seule : aucune écriture.
 */
import type { PorteDonnees } from '@planif/sync';
import {
  calculerJournee,
  capitale,
  codesEmplacements,
  jourDuTelephone,
  lireJournee,
  marquerEcriture,
  masquesDe,
  phraseDeTache,
  suivreMasques,
  TACHES_PAR_GROUPE,
  tachesDeLEcran,
  type Masques,
  type TacheJour,
} from '../aujourdhui/index.ts';
import { travailSuivant, type Travail3d } from './choix-travail.ts';

export { jourDuTelephone, masquesDe, suivreMasques, travailSuivant, type Travail3d };

/** Une pastille numérotée au-dessus d'une planche. */
export interface Pastille3d {
  readonly planche: string;
  readonly x: number;
  readonly z: number;
  /** Rangs des travaux de la planche, croissants. */
  readonly numeros: readonly number[];
  /** « 2 · 6 · 7 ». */
  readonly libelle: string;
}

export interface TravauxDuJour3d {
  readonly travaux: readonly Travail3d[];
  readonly pastilles: readonly Pastille3d[];
}

interface VolumeCherche {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly placee: boolean;
}

/** « Tunnel 2, T2-P01 · T2-P03 », ou « sans planche ». */
function lieuDe(t: TacheJour): string {
  const codes = codesEmplacements(t.tache.emplacements);
  const zone = t.tache.emplacements[0]?.zone;
  return codes === null ? 'sans planche' : zone === undefined || zone === '' ? codes : `${zone}, ${codes}`;
}

/**
 * Les travaux du jour (rang 1, 2, 3… dans l'ordre reçu, celui de `lireTachesDuJour`) et une pastille
 * par planche placée qui en porte au moins un : une tâche sur plusieurs planches placées a une
 * pastille sur chacune (T37b) ; le vol de la caméra va à la première. Un travail dont aucune planche
 * n'est placée est listé, sans pastille.
 */
export function travauxDuJour3d(taches: readonly TacheJour[], scene: { readonly volumes: readonly unknown[] }): TravauxDuJour3d {
  const placees = new Map<string, VolumeCherche>();
  for (const v of scene.volumes as readonly VolumeCherche[]) if (v.placee) placees.set(v.id, v);
  const parPlanche = new Map<string, number[]>();
  const travaux: Travail3d[] = taches.map((t, i) => {
    const rang = i + 1;
    let planche: string | null = null;
    for (const e of t.tache.emplacements) {
      if (!placees.has(e.id)) continue;
      planche ??= e.id;
      const numeros = parPlanche.get(e.id);
      if (numeros === undefined) parPlanche.set(e.id, [rang]);
      else if (numeros[numeros.length - 1] !== rang) numeros.push(rang);
    }
    return { rang, cle: t.cle, texte: `${String(rang)}. ${capitale(phraseDeTache(t))} — ${lieuDe(t)}`, planche, enRetard: t.tache.enRetard };
  });
  const pastilles: Pastille3d[] = [];
  for (const [planche, numeros] of parPlanche) {
    const v = placees.get(planche);
    if (v !== undefined) pastilles.push({ planche, x: v.x, z: v.z, numeros, libelle: numeros.join(' · ') });
  }
  return { travaux, pastilles };
}

/** Une lecture de la journée par la 3D : ses tâches dans l'ordre du moteur, et le numéro de la lecture (masques). */
export interface LectureTravaux {
  readonly taches: readonly TacheJour[];
  readonly numero: number;
}

/**
 * La tâche `cle` est-elle masquée pour une lecture de numéro `numero` ? Comme l'écran (cache.ts,
 * `estMasquee`) : écriture en cours, ou écriture finie après le début de la lecture (elle n'a pas pu la voir).
 */
function masqueePour(masques: Masques, numero: number, cle: string): boolean {
  const m = masques.get(cle);
  return m !== undefined && (m === 'attente' || numero < m);
}

/** Relit la journée, comme l'écran Aujourd'hui (mêmes fonctions). Lecture seule (aucune écriture en base). */
export async function lireTravaux(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date = new Date()): Promise<LectureTravaux> {
  // Le numéro de la lecture est pris à l'horloge des lectures et des écritures de l'écran (cache.ts), au début de la lecture.
  const numero = marquerEcriture();
  return { taches: calculerJournee(await lireJournee(porte, fermeId, aujourdhui, maintenant), aujourdhui).taches, numero };
}

/**
 * Les tâches telles que l'écran Aujourd'hui les dessine (T37b) : sans celles marquées faites et pas
 * encore relues (ses masques, lus à l'appel), en retard d'abord puis la semaine ; les cartes visibles
 * de chaque groupe (25 au plus) d'abord, puis celles cachées derrière « Voir les autres ». La carte
 * n° i de l'écran est donc la tâche n° i ici. `masques` : ceux de la ferme (`masquesDe`), au moment de l'appel.
 */
export function tachesVisibles(lecture: LectureTravaux, masques: Masques): TacheJour[] {
  const taches = tachesDeLEcran(masques.size === 0 ? lecture.taches : lecture.taches.filter((t) => !masqueePour(masques, lecture.numero, t.cle)));
  const retard = taches.filter((t) => t.tache.enRetard);
  const semaine = taches.filter((t) => !t.tache.enRetard);
  return [...retard.slice(0, TACHES_PAR_GROUPE), ...semaine.slice(0, TACHES_PAR_GROUPE), ...retard.slice(TACHES_PAR_GROUPE), ...semaine.slice(TACHES_PAR_GROUPE)];
}

/** Les tâches de l'écran Aujourd'hui pour `aujourdhui`, dans l'ordre de ses cartes. Lecture seule. */
export async function lireTachesDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date = new Date()): Promise<TacheJour[]> {
  const lecture = await lireTravaux(porte, fermeId, aujourdhui, maintenant);
  return tachesVisibles(lecture, masquesDe(porte, fermeId));
}
