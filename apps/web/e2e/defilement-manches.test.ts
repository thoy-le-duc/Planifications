/**
 * T62 — défilement de Planches mesuré en manches (plan-performances.e2e.ts).
 *
 * Constat (docs/mesures/T62.md) : les intervalles fautifs du défilement viennent surtout de la
 * machine (fil principal sans CPU, compositeur ou processus GPU en attente, jusqu'à 350 ms) et,
 * plus rarement, d'une image de rendu qui croise un ramasse-miettes. Un à-coup de l'appli, lui,
 * se reproduit d'un passage à l'autre (T11d). D'où : si une manche de 10 passages échoue, une
 * les manches suivantes sont mesurées, jusqu'à MANCHES_DEFILEMENT_MAX en tout, avec les MÊMES
 * seuils (jugerDefilement), et doivent TOUTES être fluides : une seule manche fautive est tolérée.
 * Relecture T62 : « la première fluide sur trois » (règle de T31 pour les tests unitaires, où un
 * code lent l'est à chaque manche) laissait passer un à-coup de l'appli intermittent, qui ne
 * touche qu'une manche sur trois, 26 fois sur 27.
 *
 * Contrat (apps/web/e2e/outils.ts) :
 *   MANCHES_DEFILEMENT_MAX = 3
 *   mesurerEnManches(manche: (n) => Promise<VerdictDefilement>, mancheMax?)
 *     → { fluide, manchesFautives, retenu: VerdictDefilement, manches: readonly VerdictDefilement[] }
 *   Échec : `retenu` est une manche fautive (les vérifications de seuils du test échouent sur elle).
 */
import { describe, expect, it } from 'vitest';
import { jugerDefilement, MANCHES_DEFILEMENT_MAX, mesurerEnManches, type PassageDefilement, type VerdictDefilement } from './outils.ts';

const IMAGE = 1000 / 60;
/** Mêmes seuils que plan-performances.e2e.ts : 2 images perdues, échec à 2 passages saccadés, plus de 2 fautifs. */
const juger = (passages: readonly PassageDefilement[]): VerdictDefilement => jugerDefilement(passages, 2, 2, 2);

/** Un passage de 300 images à 60 Hz, avec des intervalles de `fautif` ms aux positions données. */
function passage(fautifs: readonly number[] = [], fautif = 100): PassageDefilement {
  const intervalles = Array.from({ length: 300 }, () => IMAGE);
  for (const i of fautifs) intervalles[i] = fautif;
  return { intervalles };
}

/** Une manche de 10 passages ; `saccades` : indices des passages qui ont une image de 100 ms. */
const manche = (saccades: readonly number[] = []): VerdictDefilement => juger(Array.from({ length: 10 }, (_, i) => passage(saccades.includes(i) ? [150] : [])));

/** Une appli qui gèle 100 ms toutes les secondes : chaque passage en souffre (témoin de plan.e2e.ts). */
const saccadeReguliere = (): VerdictDefilement => juger(Array.from({ length: 10 }, () => passage([40, 100, 160, 220, 280])));

describe('T62 : défilement mesuré en manches, seuils inchangés', () => {
  it('trois manches au plus', () => {
    expect(MANCHES_DEFILEMENT_MAX).toBe(3);
  });

  it('première manche fluide : une seule manche mesurée', async () => {
    let n = 0;
    const r = await mesurerEnManches(() => {
      n += 1;
      return Promise.resolve(manche([3]));
    });
    expect(n).toBe(1);
    expect(r.manches).toHaveLength(1);
    expect(r.fluide).toBe(true);
    expect(r.manchesFautives).toBe(0);
    expect(r.retenu.fluide).toBe(true);
  });

  it('une rafale de la machine dans la première manche : passe si les DEUX manches rejouées sont fluides', async () => {
    const suite = [manche([0, 4, 7]), manche([]), manche([5])];
    const r = await mesurerEnManches((i) => Promise.resolve(suite[i] ?? manche()));
    expect(r.manches).toHaveLength(3);
    expect(r.manches[0]?.fluide).toBe(false);
    expect(r.fluide).toBe(true);
    expect(r.manchesFautives).toBe(1);
    expect(r.retenu).toBe(r.manches[2]);
    expect(r.retenu.fluide).toBe(true);
  });

  it('une deuxième manche fautive fait échouer aussitôt, sans troisième manche', async () => {
    let n = 0;
    const suite = [manche([0, 4]), manche([1, 9]), manche([])];
    const r = await mesurerEnManches((i) => {
      n += 1;
      return Promise.resolve(suite[i] ?? manche());
    });
    expect(n).toBe(2);
    expect(r.fluide).toBe(false);
    expect(r.manchesFautives).toBe(2);
    expect(r.retenu.fluide).toBe(false);
  });

  it('un à-coup intermittent de l’appli (une manche sur deux) échoue même si une manche rejouée est fluide', async () => {
    const suite = [manche([2, 6]), manche([]), manche([3, 8])];
    const r = await mesurerEnManches((i) => Promise.resolve(suite[i] ?? manche()));
    expect(r.manches).toHaveLength(3);
    expect(r.fluide).toBe(false);
    expect(r.manchesFautives).toBe(2);
    // Le verdict retenu est une manche fautive : les vérifications de seuils du test échouent.
    expect(r.retenu.fluide).toBe(false);
    expect(r.retenu.passagesSaccades).toBe(2);
  });

  it('un à-coup régulier de l’appli échoue dès la deuxième manche', async () => {
    const r = await mesurerEnManches(() => Promise.resolve(saccadeReguliere()));
    expect(r.manches).toHaveLength(2);
    expect(r.manches.every((m) => !m.fluide)).toBe(true);
    expect(r.fluide).toBe(false);
    expect(r.retenu.fluide).toBe(false);
    expect(r.retenu.passagesSaccades).toBe(10);
  });

  it('échec : la moins mauvaise des manches fautives est retenue (passages saccadés, puis fautifs)', async () => {
    const suite = [manche([0, 1, 2, 3]), manche([5, 6])];
    const r = await mesurerEnManches((i) => Promise.resolve(suite[i] ?? manche()));
    expect(r.manches).toHaveLength(2);
    expect(r.retenu).toBe(r.manches[1]);
    expect(r.retenu.fluide).toBe(false);
  });

  it('les seuils restent ceux de la manche : deux passages saccadés sur 10 échouent toujours', async () => {
    const r = await mesurerEnManches(() => Promise.resolve(manche([2, 8])), 1);
    expect(r.fluide).toBe(false);
    expect(r.retenu.fluide).toBe(false);
    expect(r.retenu.passagesSaccades).toBe(2);
  });

  it('une seule manche permise : une manche fautive échoue, rien n’est rejoué', async () => {
    const suite = [manche([0, 4, 7]), manche([])];
    const r = await mesurerEnManches((i) => Promise.resolve(suite[i] ?? manche()), 1);
    expect(r.manches).toHaveLength(1);
    expect(r.fluide).toBe(false);
  });

  it('refuse moins d’une manche', async () => {
    await expect(mesurerEnManches(() => Promise.resolve(manche()), 0)).rejects.toThrow(/manche/);
  });
});
