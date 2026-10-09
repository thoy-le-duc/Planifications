/**
 * Vue 3D (T37) — les travaux du jour, numérotés sur les planches, pour les ouvriers (Q36).
 * Module pur, sans React ni three : mêmes tâches et même ordre que l'écran « Aujourd'hui » (ses
 * fonctions `lireJournee`, `calculerJournee` et `tachesDeLEcran`, jamais un second calcul).
 * Lecture seule : aucune écriture.
 */
import type { PorteDonnees } from '@planif/sync';
import { calculerJournee, capitale, codesEmplacements, jourDuTelephone, lireJournee, phraseDeTache, tachesDeLEcran, type TacheJour } from '../aujourdhui/index.ts';
import { travailSuivant, type Travail3d } from './choix-travail.ts';

export { jourDuTelephone, travailSuivant, type Travail3d };

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
 * Les travaux du jour (rang 1, 2, 3… dans l'ordre reçu) et une pastille par planche placée qui en
 * porte au moins un. Un travail dont aucune planche n'est placée est listé, sans pastille.
 */
export function travauxDuJour3d(taches: readonly TacheJour[], scene: { readonly volumes: readonly unknown[] }): TravauxDuJour3d {
  const placees = new Map<string, VolumeCherche>();
  for (const v of scene.volumes as readonly VolumeCherche[]) if (v.placee) placees.set(v.id, v);
  const travaux: Travail3d[] = taches.map((t, i) => {
    const rang = i + 1;
    const planche = t.tache.emplacements.find((e) => placees.has(e.id))?.id ?? null;
    return { rang, cle: t.cle, texte: `${String(rang)}. ${capitale(phraseDeTache(t))} — ${lieuDe(t)}`, planche, enRetard: t.tache.enRetard };
  });
  const parPlanche = new Map<string, number[]>();
  for (const t of travaux) {
    if (t.planche === null) continue;
    const numeros = parPlanche.get(t.planche);
    if (numeros === undefined) parPlanche.set(t.planche, [t.rang]);
    else numeros.push(t.rang);
  }
  const pastilles: Pastille3d[] = [];
  for (const [planche, numeros] of parPlanche) {
    const v = placees.get(planche);
    if (v !== undefined) pastilles.push({ planche, x: v.x, z: v.z, numeros, libelle: numeros.join(' · ') });
  }
  return { travaux, pastilles };
}

/** Les tâches de l'écran Aujourd'hui pour `aujourdhui`, dans son ordre. Lecture seule. */
export async function lireTachesDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date = new Date()): Promise<TacheJour[]> {
  return tachesDeLEcran(calculerJournee(await lireJournee(porte, fermeId, aujourdhui, maintenant), aujourdhui).taches);
}
