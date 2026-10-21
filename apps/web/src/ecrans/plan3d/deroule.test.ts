/**
 * Tests d'acceptation T59 — lecture de la saison dans la vue 3D : semaine affichée selon le temps
 * écoulé, vitesse 1 ou 4 semaines par seconde, arrêt en fin de saison, un seul rappel par semaine.
 * Contrat : ./test/contrat-deroule.ts. Horloge simulée : ni navigateur, ni `Date`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { HorlogeDeroule, ModuleDeroule } from './test/contrat-deroule.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN = './deroule.ts';
let m: ModuleDeroule;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleDeroule;
});

/** Horloge simulée : le temps n'avance que par `avancer`, qui déclenche les rappels échus dans l'ordre. */
function horlogeSimulee(): HorlogeDeroule & { avancer(ms: number): void; enAttente(): number; programmes: number } {
  let t = 5_000;
  let suivant = 0;
  const minuteries = new Map<number, { quand: number; rappel: () => void }>();
  const h = {
    programmes: 0,
    maintenant: () => t,
    programmer(rappel: () => void, delaiMs: number): () => void {
      const id = suivant++;
      h.programmes += 1;
      minuteries.set(id, { quand: t + Math.max(0, delaiMs), rappel });
      return () => {
        minuteries.delete(id);
      };
    },
    avancer(ms: number): void {
      const fin = t + ms;
      for (;;) {
        const echues = [...minuteries.entries()].filter(([, x]) => x.quand <= fin).sort((a, b) => a[1].quand - b[1].quand || a[0] - b[0]);
        const premiere = echues[0];
        if (premiere === undefined) break;
        minuteries.delete(premiere[0]);
        t = Math.max(t, premiere[1].quand);
        premiere[1].rappel();
      }
      t = fin;
    },
    enAttente: () => minuteries.size,
  };
  return h;
}

describe('T59 : semaine affichée pendant la lecture (pur)', () => {
  it('vitesse par défaut : 1 semaine par seconde ; vitesses offertes : 1 et 4', () => {
    expect(m.VITESSE_DEROULE_PAR_DEFAUT).toBe(1);
    expect(m.VITESSES_DEROULE).toEqual([1, 4]);
  });

  it('de la semaine 10 à 14 à 1 semaine par seconde : 11 à 1 s, 14 à 4 s, puis arrêt', () => {
    const l = m.demarrerLecture(10, 15, 1_000, 1);
    expect(l).not.toBeNull();
    if (l === null) return;
    expect(m.semaineDeLecture(l, 1_000)).toEqual({ semaine: 10, finie: false });
    expect(m.semaineDeLecture(l, 1_999)).toEqual({ semaine: 10, finie: false });
    expect(m.semaineDeLecture(l, 2_000)).toEqual({ semaine: 11, finie: false });
    expect(m.semaineDeLecture(l, 4_500)).toEqual({ semaine: 13, finie: false });
    expect(m.semaineDeLecture(l, 5_000)).toEqual({ semaine: 14, finie: true });
    expect(m.semaineDeLecture(l, 60_000)).toEqual({ semaine: 14, finie: true });
  });

  it('à 4 semaines par seconde : une semaine tous les 250 ms, fin de saison en 1 s', () => {
    const l = m.demarrerLecture(10, 15, 0, 4);
    if (l === null) throw new Error('lecture attendue');
    expect(m.semaineDeLecture(l, 249).semaine).toBe(10);
    expect(m.semaineDeLecture(l, 250).semaine).toBe(11);
    expect(m.semaineDeLecture(l, 750).semaine).toBe(13);
    expect(m.semaineDeLecture(l, 1_000)).toEqual({ semaine: 14, finie: true });
  });

  it('délai avant la semaine suivante : jusqu’à la prochaine frontière, null une fois la saison finie', () => {
    const l = m.demarrerLecture(10, 15, 0, 1);
    if (l === null) throw new Error('lecture attendue');
    expect(m.delaiAvantSemaineSuivante(l, 0)).toBe(1_000);
    expect(m.delaiAvantSemaineSuivante(l, 1_300)).toBe(700);
    expect(m.delaiAvantSemaineSuivante(l, 3_999)).toBe(1);
    expect(m.delaiAvantSemaineSuivante(l, 4_000)).toBeNull();
    const rapide = m.demarrerLecture(0, 15, 0, 4);
    if (rapide === null) throw new Error('lecture attendue');
    expect(m.delaiAvantSemaineSuivante(rapide, 100)).toBe(150);
  });

  it('démarrer sur la dernière semaine repart de la première', () => {
    const l = m.demarrerLecture(14, 15, 0, 1);
    expect(l?.semaineDepart).toBe(0);
    expect(l?.derniere).toBe(14);
  });

  it('semaine de départ hors bornes ramenée dans le plan ; plan d’une semaine ou vide : pas de lecture', () => {
    expect(m.demarrerLecture(-3, 15, 0, 1)?.semaineDepart).toBe(0);
    expect(m.demarrerLecture(2.7, 15, 0, 1)?.semaineDepart).toBe(2);
    expect(m.demarrerLecture(0, 1, 0, 1)).toBeNull();
    expect(m.demarrerLecture(0, 0, 0, 1)).toBeNull();
  });

  it('horloge qui recule (ou départ dans le futur) : la semaine de départ, jamais avant', () => {
    const l = m.demarrerLecture(10, 15, 1_000, 1);
    if (l === null) throw new Error('lecture attendue');
    expect(m.semaineDeLecture(l, 0)).toEqual({ semaine: 10, finie: false });
  });

  it('changer de vitesse en cours de lecture garde la semaine affichée et repart de là', () => {
    const l = m.demarrerLecture(10, 15, 0, 1);
    if (l === null) throw new Error('lecture attendue');
    const l4 = m.changerVitesseLecture(l, 4, 1_500);
    expect(m.semaineDeLecture(l4, 1_500).semaine).toBe(11);
    expect(m.semaineDeLecture(l4, 1_749).semaine).toBe(11);
    expect(m.semaineDeLecture(l4, 1_750).semaine).toBe(12);
    expect(m.semaineDeLecture(l4, 2_250)).toEqual({ semaine: 14, finie: true });
  });
});

describe('T59 : pilote de la lecture (horloge simulée)', () => {
  it('lecture de la semaine 10 à 14 : 4 changements de semaine, arrêt en fin de saison', () => {
    const h = horlogeSimulee();
    const semaines: number[] = [];
    let fins = 0;
    const p = m.piloterLecture({ horloge: h, semaine: 10, nbSemaines: 15, vitesse: 1, surSemaine: (s) => semaines.push(s), surFin: () => (fins += 1) });
    expect(p).not.toBeNull();
    h.avancer(3_500);
    expect(semaines).toEqual([11, 12, 13]);
    expect(fins).toBe(0);
    h.avancer(10_000);
    expect(semaines, '4 changements de semaine').toEqual([11, 12, 13, 14]);
    expect(fins, 'arrêt en fin de saison').toBe(1);
    expect(h.enAttente(), 'plus aucun rappel après la fin').toBe(0);
  });

  it('un seul rappel programmé par semaine (pas de boucle à chaque image)', () => {
    const h = horlogeSimulee();
    m.piloterLecture({ horloge: h, semaine: 10, nbSemaines: 15, vitesse: 1, surSemaine: () => undefined, surFin: () => undefined });
    h.avancer(20_000);
    expect(h.programmes).toBeLessThanOrEqual(4);
  });

  it('à 4 semaines par seconde : la fin de saison en 1 s', () => {
    const h = horlogeSimulee();
    const semaines: number[] = [];
    let fins = 0;
    m.piloterLecture({ horloge: h, semaine: 10, nbSemaines: 15, vitesse: 4, surSemaine: (s) => semaines.push(s), surFin: () => (fins += 1) });
    h.avancer(999);
    expect(semaines).toEqual([11, 12, 13]);
    h.avancer(1);
    expect(semaines).toEqual([11, 12, 13, 14]);
    expect(fins).toBe(1);
  });

  it('rappel en retard (onglet occupé) : saute à la semaine du moment, jamais deux fois la même', () => {
    let t = 0;
    const file: { rappel: (() => void) | null } = { rappel: null };
    const h: HorlogeDeroule = {
      maintenant: () => t,
      programmer: (rappel) => {
        file.rappel = rappel;
        return () => {
          file.rappel = null;
        };
      },
    };
    const semaines: number[] = [];
    m.piloterLecture({ horloge: h, semaine: 0, nbSemaines: 10, vitesse: 1, surSemaine: (s) => semaines.push(s), surFin: () => undefined });
    // Le rappel prévu à 1 s ne vient qu'à 3,2 s.
    t = 3_200;
    file.rappel?.();
    // Rappel parasite au même instant : rien de neuf.
    file.rappel?.();
    expect(semaines).toEqual([3]);
  });

  it('pause : plus aucune semaine annoncée ni rappel en attente', () => {
    const h = horlogeSimulee();
    const semaines: number[] = [];
    let fins = 0;
    const p = m.piloterLecture({ horloge: h, semaine: 10, nbSemaines: 15, vitesse: 1, surSemaine: (s) => semaines.push(s), surFin: () => (fins += 1) });
    h.avancer(1_500);
    p?.arreter();
    h.avancer(10_000);
    expect(semaines).toEqual([11]);
    expect(fins).toBe(0);
    expect(h.enAttente()).toBe(0);
  });

  it('changer de vitesse en cours : reprend de la semaine affichée au nouveau rythme', () => {
    const h = horlogeSimulee();
    const semaines: number[] = [];
    const p = m.piloterLecture({ horloge: h, semaine: 0, nbSemaines: 10, vitesse: 1, surSemaine: (s) => semaines.push(s), surFin: () => undefined });
    h.avancer(1_500);
    p?.changerVitesse(4);
    h.avancer(500);
    expect(semaines).toEqual([1, 2, 3]);
  });

  it('plan d’une semaine : pas de lecture', () => {
    const h = horlogeSimulee();
    expect(m.piloterLecture({ horloge: h, semaine: 0, nbSemaines: 1, vitesse: 1, surSemaine: () => undefined, surFin: () => undefined })).toBeNull();
  });
});
