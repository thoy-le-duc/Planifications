/**
 * T59 (relecture) — un léger retard du minuteur (fil principal occupé un instant) ne fait sauter
 * aucune semaine : les semaines manquées passent une à une, vite ; un gros retard (onglet en
 * arrière-plan, plus d'une seconde) va droit à la semaine du moment.
 */
import { describe, expect, it } from 'vitest';
import { DELAI_RATTRAPAGE_MS, piloterLecture, RETARD_RATTRAPE_MAX_MS, type HorlogeDeroule } from './deroule.ts';

/** Horloge simulée : un seul minuteur en attente ; `tirer` le déclenche (il n'est alors plus en attente). */
function horloge(): HorlogeDeroule & { t: number; suivant: { rappel: () => void; delai: number } | null; tirer(): void } {
  const h = {
    t: 0,
    suivant: null as { rappel: () => void; delai: number } | null,
    maintenant: () => h.t,
    tirer: () => {
      const s = h.suivant;
      h.suivant = null;
      s?.rappel();
    },
    programmer: (rappel: () => void, delai: number) => {
      h.suivant = { rappel, delai };
      return () => {
        h.suivant = null;
      };
    },
  };
  return h;
}

describe('T59 : rattrapage d’un léger retard', () => {
  it('retard de 300 ms à 4 semaines par seconde : 11 puis 12, aucune semaine sautée, puis le rythme reprend', () => {
    const h = horloge();
    const semaines: number[] = [];
    piloterLecture({ horloge: h, semaine: 10, nbSemaines: 20, vitesse: 4, surSemaine: (s) => semaines.push(s), surFin: () => undefined });
    // Le rappel prévu à 250 ms ne vient qu'à 550 ms (la semaine du moment serait 12).
    h.t = 550;
    h.tirer();
    expect(semaines).toEqual([11]);
    expect(h.suivant?.delai).toBe(DELAI_RATTRAPAGE_MS);
    h.t = 550 + DELAI_RATTRAPAGE_MS;
    h.tirer();
    expect(semaines).toEqual([11, 12]);
    // Rattrapé : prochaine échéance normale (13 à 750 ms).
    expect(h.suivant?.delai).toBe(750 - h.t);
  });

  it('léger retard sur la fin de saison : la dernière semaine passe aussi, puis arrêt', () => {
    const h = horloge();
    const semaines: number[] = [];
    let fins = 0;
    piloterLecture({ horloge: h, semaine: 12, nbSemaines: 15, vitesse: 4, surSemaine: (s) => semaines.push(s), surFin: () => (fins += 1) });
    h.t = 900;
    for (let i = 0; i < 5 && h.suivant !== null; i += 1) {
      h.tirer();
      h.t += DELAI_RATTRAPAGE_MS;
    }
    expect(semaines).toEqual([13, 14]);
    expect(fins).toBe(1);
    expect(h.suivant).toBeNull();
  });

  it('retard d’au moins une seconde : droit à la semaine du moment', () => {
    const h = horloge();
    const semaines: number[] = [];
    piloterLecture({ horloge: h, semaine: 0, nbSemaines: 20, vitesse: 4, surSemaine: (s) => semaines.push(s), surFin: () => undefined });
    h.t = 250 + RETARD_RATTRAPE_MAX_MS;
    h.tirer();
    expect(semaines).toEqual([5]);
  });
});
