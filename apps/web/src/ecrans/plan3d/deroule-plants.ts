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
import type { BarrePlan, Plan } from '../plan/calculs.ts';
import { FAMILLES } from '../../ui/jetons.ts';
import { cultureAu, type CultureLue, type CulturesLues } from './donnees-plants.ts';
import { plantsDePlanche, type PlantsPlanche } from './plants.ts';
import { COULEUR_NEUTRE, type Scene, type VolumeScene } from './scene.ts';

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

/**
 * L'occupation montrée sur une planche : celle de la scène en « realise » ; en « prevu », l'occupation
 * annuelle prévue de la semaine (une planche sans série, ou dont la scène montre une pérenne, garde
 * celle de la scène). `lundi` : jour absolu du lundi de la semaine.
 */
function occupationSelonMode(v: VolumeScene, ids: readonly string[], cultures: CulturesLues, lundi: number, mode: ModeDates): string | null {
  const id = v.occupationId;
  if (mode === 'realise' || !aDesAnnuelles(ids, cultures)) return id;
  const scenePerenne = id !== null && (cultures.parOccupation.get(id)?.perenne ?? null) !== null;
  return scenePerenne ? id : occupationPrevue(ids, cultures, lundi);
}

/** Un élément par volume de la scène, dans le même ordre ; nul quand la planche est nue. */
export function plantsDeLaSemaine(e: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] {
  const { scene, occupations, cultures, jour, mode } = e;
  const lundi = mode === 'prevu' ? jourAbsolu(jour) : 0;
  return scene.volumes.map((v) => {
    const id = occupationSelonMode(v, occupations.get(v.id) ?? [], cultures, lundi, mode);
    const lue = id === null ? undefined : cultures.parOccupation.get(id);
    if (lue === undefined) return null;
    const c = mode === 'prevu' && lue.annuelle !== null ? { ...lue, annuelle: prevuesSeules(lue.annuelle) } : lue;
    return plantsDePlanche({ volume: v, culture: cultureAu(c, jour), jour, horsSol: cultures.horsSol.has(v.id) });
  });
}

/** Les barres de chaque planche du plan, par occupation, calculées une fois par plan. */
const barresDuPlan = new WeakMap<Plan, ReadonlyMap<string, BarrePlan>>();
function barresDe(plan: Plan): ReadonlyMap<string, BarrePlan> {
  let m = barresDuPlan.get(plan);
  if (m === undefined) {
    const n = new Map<string, BarrePlan>();
    for (const l of plan.lignes) if (l.sorte === 'emplacement') for (const b of l.barres) n.set(b.occupationId, b);
    m = n;
    barresDuPlan.set(plan, m);
  }
  return m;
}

/**
 * La scène selon l'option de dates : en « realise », la scène telle quelle ; en « prevu », chaque
 * planche prend la culture (couleur, nom, occupation) que ses plants montrent (`plantsDeLaSemaine`) :
 * nue si rien n'est prévu cette semaine. Planches, liste texte et plants ne se contredisent pas.
 * Géométrie, socles et bâtiments inchangés (mêmes références).
 */
export function sceneSelonMode(scene: Scene, plan: Plan, occupations: ReadonlyMap<string, readonly string[]>, cultures: CulturesLues, jour: DateCalendaire, mode: ModeDates): Scene {
  if (mode === 'realise') return scene;
  const lundi = jourAbsolu(jour);
  const barres = barresDe(plan);
  return {
    ...scene,
    volumes: scene.volumes.map((v) => {
      const id = occupationSelonMode(v, occupations.get(v.id) ?? [], cultures, lundi, mode);
      if (id === v.occupationId) return v;
      const b = id === null ? undefined : barres.get(id);
      if (b === undefined) return { ...v, couleur: COULEUR_NEUTRE, cleFamille: null, culture: null, occupationId: null };
      return { ...v, couleur: b.cleFamille === null ? COULEUR_NEUTRE : FAMILLES[b.cleFamille].bande, cleFamille: b.cleFamille, culture: b.libelle, occupationId: b.occupationId };
    }),
  };
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
  #directs = 0;

  /** Calculs faits par `preparer` (lu par les tests). */
  get calculs(): number {
    return this.#calculs;
  }

  /** Tous les calculs de plants : préparés d'avance et faits sur place par `plantsPour`. */
  get total(): number {
    return this.#calculs + this.#directs;
  }

  /** Les plants préparés pour cette entrée, ou nul, SANS les oublier : sans effet, donc sûr dans un rendu. */
  consulter(entree: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] | null {
    return this.#entree !== null && this.#plants !== null && concordent(this.#entree, entree) ? this.#plants : null;
  }

  /** Les plants de l'entrée : ceux préparés s'ils concordent, sinon calculés sur place (et comptés). */
  plantsPour(entree: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] {
    const pret = this.consulter(entree);
    if (pret !== null) return pret;
    this.#directs += 1;
    return plantsDeLaSemaine(entree);
  }

  preparer(entree: EntreePlantsSemaine): void {
    if (this.#entree !== null && concordent(this.#entree, entree)) return;
    this.#plants = plantsDeLaSemaine(entree);
    this.#entree = entree;
    this.#calculs += 1;
  }

  /** Les plants préparés pour cette entrée, ou nul ; repris, ils sont oubliés. */
  prendre(entree: EntreePlantsSemaine): readonly (PlantsPlanche | null)[] | null {
    const pret = this.consulter(entree);
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
