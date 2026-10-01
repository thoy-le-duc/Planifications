/**
 * Test d'acceptation T13c — relecture de la journée après une saisie, sur la grande ferme.
 *
 * Banc : comme grande-ferme.test.ts, la base du téléphone telle que PowerSync la range
 * (./test/base-powersync.ts) sous node:sqlite, remplie de la grande ferme (./test/grande-ferme.ts :
 * 3 000 séries actives, ≈ 51 000 événements), aujourd'hui = 2026-09-30.
 *
 * Mesure : l'écran suit la journée (`suivreJournee`, ./cache.ts) ; « Fait » sur une tâche
 * (`marquerFait`, ./ecritures.ts, une transaction par la porte) ; temps jusqu'à la journée relue
 * remise à l'écran (le rappel de `suivreJournee`, calcul compris), où la tâche faite n'est plus.
 * Cinq saisies sur cinq tâches différentes, médiane ; une saisie de chauffe avant.
 *
 * Garde-fou : voir BUDGET_RELECTURE_MS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { suivreJournee } from './cache.ts';
import type { Journee, TacheJour } from './calculs.ts';
import { marquerFait } from './ecritures.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';
const REPETITIONS = 5;

/**
 * Garde-fou (T13c), à défaut de pouvoir mesurer le téléphone ici. Mesuré sur ce banc avant
 * T13c : 130 / 136 / 183 / 186 / 161 ms puis 137 / 190 / 138 / 140 / 147 ms (médianes 161 et
 * 140 ms) : la relecture relit TOUTE la journée (`lireJournee`, ≈ 120 ms, T13b) et la recalcule
 * entièrement. Dans le navigateur, CPU ×4, la même relecture mesurait ≈ 884 ms (T13b, e2e) :
 * un rapport navigateur/Node d'environ 6, qui donnerait ≈ 83 ms sous Node pour les 500 ms du
 * ticket. Décision du chef (T13c) : 100 ms, car ce rapport ne vient que d'une seule mesure ;
 * l'e2e à 500 ms (aujourdhui-grande-ferme.e2e.ts) reste l'arbitre du critère. Ce test-ci dit
 * tout de suite, sans navigateur, si la relecture a été allégée.
 */
const BUDGET_RELECTURE_MS = 100;

const mediane = (valeurs: readonly number[]): number => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;

let base: BasePowerSync;
let porte: PorteDonnees;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireGrandeFerme(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>, fermeId: FERME_GRANDE as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

/** Suit la journée ; `prochaine(condition)` attend la prochaine journée remise qui la remplit. */
function suivre(): { readonly prochaine: (condition: (j: Journee) => boolean) => Promise<Journee>; readonly arreter: () => void; derniere: () => Journee | null } {
  let derniere: Journee | null = null;
  let attente: { condition: (j: Journee) => boolean; tenir: (j: Journee) => void } | null = null;
  const arreter = suivreJournee(
    porte,
    FERME_GRANDE,
    AUJOURDHUI,
    (j) => {
      derniere = j;
      const a = attente;
      if (a?.condition(j) === true) {
        attente = null;
        a.tenir(j);
      }
    },
    (e) => {
      throw e;
    },
  );
  return {
    prochaine: (condition) =>
      new Promise<Journee>((tenir) => {
        if (derniere !== null && condition(derniere)) tenir(derniere);
        else attente = { condition, tenir };
      }),
    arreter,
    derniere: () => derniere,
  };
}

/** Prochaine tâche qu'un « Fait » solde (pas un début de récolte, pas un travail). */
function tacheAFaire(j: Journee, dejaFaites: ReadonlySet<string>): TacheJour {
  const t = j.taches.find((x) => x.tache.etape !== 'debut_recolte' && x.tache.etape !== 'travail' && !dejaFaites.has(x.cle));
  if (t === undefined) throw new Error('aucune tâche à marquer faite');
  return t;
}

describe('T13c : relecture après une saisie sur la grande ferme', { timeout: 120_000 }, () => {
  it(`« Fait » → journée relue remise à l’écran en moins de ${String(BUDGET_RELECTURE_MS)} ms (médiane de ${String(REPETITIONS)}, après une saisie de chauffe)`, async () => {
    const suivi = suivre();
    try {
      let journee = await suivi.prochaine(() => true);
      const faites = new Set<string>();
      const serie: number[] = [];
      for (let k = 0; k <= REPETITIONS; k++) {
        const t = tacheAFaire(journee, faites);
        faites.add(t.cle);
        if (t.tache.etape === 'debut_recolte' || t.tache.etape === 'travail') throw new Error('tâche inattendue');
        const etape = t.tache.etape;
        const t0 = performance.now();
        await marquerFait({ porte, fermeId: FERME_GRANDE, aujourdhui: AUJOURDHUI }, t.culture, etape);
        journee = await suivi.prochaine((j) => !j.taches.some((x) => x.cle === t.cle));
        const ms = Math.round(performance.now() - t0);
        if (k > 0) serie.push(ms);
      }
      console.log(`T13c, relecture après « Fait » sur la grande ferme : ${serie.join(' / ')} ms (médiane ${String(mediane(serie))} ms)`);
      expect(mediane(serie), `relecture après « Fait » : ${serie.join(' / ')} ms`).toBeLessThan(BUDGET_RELECTURE_MS);
    } finally {
      suivi.arreter();
    }
  });
});
