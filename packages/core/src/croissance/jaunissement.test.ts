/** T32e : jaunissement du feuillage en fin de récolte (0 hors fin, croissant ensuite, 1 au plus). */
import { describe, expect, it } from 'vitest';
import { ajouterJours, type DateCalendaire } from '../dates/index.ts';
import { JOURS_FIN_RECOLTE, jaunissementA, jaunissementPerenneA } from './index.ts';
import type { DatesCroissance, EntreePerenne } from './types.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const repere = (p: string | null) => ({ prevue: p === null ? null : d(p), reelle: null });
const COURGETTE: DatesCroissance = { miseEnPlace: repere('2027-05-15'), debutRecolte: repere('2027-07-01'), finRecolte: repere('2027-09-01'), arrachage: repere('2027-10-15') };
const F = d('2027-09-01');

describe('T32e : jaunissement', () => {
  it('0 avant la fin de récolte, > 0 dès son premier jour, croissant, 1 à la fin de la fenêtre et après', () => {
    expect(jaunissementA(COURGETTE, ajouterJours(F, -JOURS_FIN_RECOLTE - 1))).toBe(0);
    let precedent = 0;
    for (let k = JOURS_FIN_RECOLTE; k >= -20; k -= 1) {
      const j = jaunissementA(COURGETTE, ajouterJours(F, -k));
      expect(j).toBeGreaterThan(precedent - 1e-12);
      expect(j).toBeLessThanOrEqual(1);
      if (k === JOURS_FIN_RECOLTE) expect(j).toBeGreaterThan(0);
      precedent = j;
    }
    expect(jaunissementA(COURGETTE, F)).toBe(1);
  });

  it('0 après l’arrachage et sans fin de récolte connue', () => {
    expect(jaunissementA(COURGETTE, d('2027-10-15'))).toBe(0);
    expect(jaunissementA({ ...COURGETTE, finRecolte: repere(null) }, d('2027-09-20'))).toBe(0);
  });

  it('pérenne : jaunit sur la fin de sa campagne, rien hors campagne', () => {
    const fraise: EntreePerenne = { plantation: { datePlantation: d('2024-03-01'), dateArrachage: null }, campagne: { annee: 2027, debutRecolte: d('2027-05-10'), finRecolte: d('2027-06-30') } };
    expect(jaunissementPerenneA(fraise, d('2027-06-01'))).toBe(0);
    expect(jaunissementPerenneA(fraise, d('2027-06-25'))).toBeGreaterThan(0);
    expect(jaunissementPerenneA(fraise, d('2028-06-25'))).toBe(0);
  });
});
