/**
 * Vue 3D (T59, Q44) — les plants de la semaine affichée pendant le déroulé de la saison, selon
 * l'option de dates. Module PUR, dans la couche des plants chargée à la demande (./couche-plants.ts) :
 * il n'alourdit pas le morceau 3D. Aucun calcul de croissance ici : `cultureAu` et `plantsDePlanche`
 * (moteur de T32a) font le travail. Contrat et exemples : ./test/contrat-deroule.ts.
 *
 *   - « realise » (par défaut) : la date réelle remplace la prévue (règle de T32a) ; la culture de
 *     la planche est celle de la scène (barres du plan, qui suivent le réel) ;
 *   - « prevu » (« Prévu seul ») : dates réelles ignorées ; la culture d'une planche est, parmi ses
 *     occupations annuelles, celle dont la période prévue couvre le plus de jours de la semaine.
 *
 * Successions : après l'arrachage, le moteur ne rend plus de plant (planche nue), puis la culture
 * suivante part de sa mise en place (jeunes plants).
 */
import type { DateCalendaire } from '@planif/core';
import type { DatesCroissance } from '@planif/core/croissance';
import type { Plan } from '../plan/calculs.ts';
import { cultureAu, type CultureLue, type CulturesLues } from './donnees-plants.ts';
import { plantsDePlanche, type PlantsPlanche } from './plants.ts';
import type { Scene } from './scene.ts';

export type ModeDates = 'realise' | 'prevu';
export const MODE_DATES_PAR_DEFAUT: ModeDates = 'realise';

export interface EntreePlantsSemaine {
  readonly scene: Scene;
  /** Occupations de chaque planche, dans l'ordre du plan (`occupationsParPlanche`). */
  readonly occupations: ReadonlyMap<string, readonly string[]>;
  readonly cultures: CulturesLues;
  /** Lundi de la semaine affichée. */
  readonly jour: DateCalendaire;
  readonly mode: ModeDates;
}

/** Les occupations de chaque planche, dans l'ordre de ses barres (celui du plan). */
export function occupationsParPlanche(plan: Plan): ReadonlyMap<string, readonly string[]> {
  const m = new Map<string, readonly string[]>();
  for (const l of plan.lignes) if (l.sorte === 'emplacement') m.set(l.id, l.barres.map((b) => b.occupationId));
  return m;
}

const MS_JOUR = 86_400_000;
/** Jour absolu d'une date 'AAAA-MM-JJ', en temps universel : aucun fuseau local. */
function jourAbsolu(d: DateCalendaire): number {
  const [a, mo, j] = d.split('-').map(Number);
  return Math.round(Date.UTC(a ?? 0, (mo ?? 1) - 1, j ?? 1) / MS_JOUR);
}

/** Les dates prévues seules : les réelles sont effacées. */
const prevuesSeules = (dates: DatesCroissance): DatesCroissance => ({
  miseEnPlace: { prevue: dates.miseEnPlace.prevue, reelle: null },
  debutRecolte: { prevue: dates.debutRecolte.prevue, reelle: null },
  finRecolte: { prevue: dates.finRecolte.prevue, reelle: null },
  arrachage: { prevue: dates.arrachage.prevue, reelle: null },
});

/** Jours de la semaine [lundi, lundi + 7[ que couvre la période prévue [mise en place, arrachage[ ; 0 sans mise en place prévue. */
function joursPrevusDansLaSemaine(c: CultureLue, lundi: number): number {
  const mise = c.annuelle?.miseEnPlace.prevue ?? null;
  if (mise === null) return 0;
  const arrachage = c.annuelle?.arrachage.prevue ?? null;
  const debut = jourAbsolu(mise);
  const fin = arrachage === null ? Number.POSITIVE_INFINITY : jourAbsolu(arrachage);
  return Math.max(0, Math.min(lundi + 7, fin) - Math.max(lundi, debut));
}

/** « Prévu seul » : l'occupation annuelle prévue la semaine du lundi `lundi` ; null s'il n'y en a pas. */
function occupationPrevue(ids: readonly string[], cultures: CulturesLues, lundi: number): string | null {
  let meilleure: string | null = null;
  let jours = 0;
  for (const id of ids) {
    const c = cultures.parOccupation.get(id);
    if (c?.annuelle === null || c?.annuelle === undefined) continue;
    const n = joursPrevusDansLaSemaine(c, lundi);
    if (n > jours) {
      meilleure = id;
      jours = n;
    }
  }
  return meilleure;
}

/** Une planche porte-t-elle une occupation annuelle (série) parmi les siennes ? */
const aDesAnnuelles = (ids: readonly string[], cultures: CulturesLues): boolean => ids.some((id) => (cultures.parOccupation.get(id)?.annuelle ?? null) !== null);

/** Un élément par volume de la scène, dans le même ordre ; nul quand la planche est nue. */
export function plantsDeLaSemaine(e: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] {
  const { scene, occupations, cultures, jour, mode } = e;
  const lundi = mode === 'prevu' ? jourAbsolu(jour) : 0;
  return scene.volumes.map((v) => {
    let id = v.occupationId;
    if (mode === 'prevu') {
      const ids = occupations.get(v.id) ?? [];
      // Une planche sans série (pérenne seule, ou rien) garde l'occupation de la scène.
      if (aDesAnnuelles(ids, cultures)) {
        const scenePerenne = id !== null && (cultures.parOccupation.get(id)?.perenne ?? null) !== null;
        if (!scenePerenne) id = occupationPrevue(ids, cultures, lundi);
      }
    }
    const lue = id === null ? undefined : cultures.parOccupation.get(id);
    if (lue === undefined) return null;
    const c = mode === 'prevu' && lue.annuelle !== null ? { ...lue, annuelle: prevuesSeules(lue.annuelle) } : lue;
    return plantsDePlanche({ volume: v, culture: cultureAu(c, jour), jour, horsSol: cultures.horsSol.has(v.id) });
  });
}

/**
 * T59 : les plants de la semaine SUIVANTE, calculés d'avance pendant la lecture (quand le navigateur
 * est au repos), puis repris tels quels quand cette semaine s'affiche : le changement de semaine ne
 * paie plus le calcul de croissance. Chaque semaine n'est toujours calculée qu'une fois. Une seule
 * semaine d'avance est gardée ; reprise, elle est oubliée. Elle ne sert que si tout concorde : même
 * géométrie (socles de la scène), même semaine, mêmes occupations, cultures, jour et option de dates.
 */
export class AvancePlants {
  #entree: EntreePlantsSemaine | null = null;
  #plants: readonly (PlantsPlanche | null)[] | null = null;
  #calculs = 0;

  /** Calculs faits par `preparer` (lu par les tests). */
  get calculs(): number {
    return this.#calculs;
  }

  preparer(entree: EntreePlantsSemaine): void {
    if (this.#entree !== null && concordent(this.#entree, entree)) return;
    this.#plants = plantsDeLaSemaine(entree);
    this.#entree = entree;
    this.#calculs += 1;
  }

  /** Les plants préparés pour cette entrée, ou nul ; repris, ils sont oubliés. */
  prendre(entree: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] | null {
    const pret = this.#entree !== null && this.#plants !== null && concordent(this.#entree, entree) ? this.#plants : null;
    if (pret !== null) {
      this.#entree = null;
      this.#plants = null;
    }
    return pret;
  }
}

const concordent = (a: EntreePlantsSemaine, b: EntreePlantsSemaine): boolean =>
  a.scene.socles === b.scene.socles &&
  a.scene.semaine === b.scene.semaine &&
  a.scene.volumes.length === b.scene.volumes.length &&
  a.occupations === b.occupations &&
  a.cultures === b.cultures &&
  a.jour === b.jour &&
  a.mode === b.mode;
