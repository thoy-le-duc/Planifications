/**
 * Tests d'acceptation T86 — les sous-zones d'une serre se dessinent en bandes, et leurs planches s'y
 * rangent (docs/backlog/T86-sous-zones-dans-serre.md, règles 1, 4 et 6). Pur : mètres, repère de la serre.
 *
 * Repère de la serre : origine au centre, x selon la largeur (vers l'est quand la serre est au cap 0°),
 * y selon la longueur. Les bandes traversent la serre de bout en bout, côte à côte dans la largeur :
 * Manon 1 à l'ouest (x négatif), Manon 3 à l'est.
 *
 * Exemple chiffré à la main : tri-tunnel de 40 × 28,8 m, trois sous-zones.
 *   bande = 28,8 / 3 = 9,6 m de large, 40 m de long ; centres à x = −9,6 ; 0 ; +9,6 m, y = 0.
 * Quatre planches de 38 × 0,75 m, passe-pied 45 cm, dans la bande 2 (centre x = 0) :
 *   bloc = 4 × 0,75 + 3 × 0,45 = 4,35 m de large, bord ouest à −2,175 m ;
 *   centres à −2,175 + 0,375 = −1,8 ; −0,6 ; +0,6 ; +1,8 m ; y = −19 + 38 / 2 = 0 (bloc centré dans la bande).
 * Neuf planches : bloc = 9 × 0,75 + 8 × 0,45 = 10,35 m > 9,6 m ; bord ouest à −5,175 m, la première
 *   (centre −4,8 m, bord −5,175 m) et la dernière (centre +4,8 m, bord +5,175 m) dépassent de la bande
 *   (±4,8 m) ; les sept autres tiennent.
 */
import { describe, expect, it } from 'vitest';
import { bandesDeSerre, rangerDansBande, type BandeSerre, type PlancheDeParcelle } from '@planif/core/placement';

const sz = (nom: string, id = `id-${nom}`) => ({ id, nom });
const TRI = { longueurM: 40, largeurM: 28.8 };
const planche = (code: string, longueurM = 38, largeurM: number | null = 0.75): PlancheDeParcelle => ({ id: `id-${code}`, code, longueurM, largeurM });

describe('T86 : bandesDeSerre', () => {
  it('exemple chiffré : tri-tunnel 40 × 28,8 m, trois sous-zones → trois bandes de 40 × 9,6 m, centres à −9,6 ; 0 ; +9,6 m', () => {
    const bandes = bandesDeSerre(TRI, [sz('Manon 1'), sz('Manon 2'), sz('Manon 3')]);
    expect(bandes.map((b) => b.nom)).toEqual(['Manon 1', 'Manon 2', 'Manon 3']);
    expect(bandes.map((b) => b.largeurM)).toEqual([9.6, 9.6, 9.6]);
    expect(bandes.map((b) => b.longueurM)).toEqual([40, 40, 40]);
    expect(bandes.map((b) => b.centre.x)).toEqual([-9.6, 0, 9.6]);
    expect(bandes.map((b) => b.centre.y)).toEqual([0, 0, 0]);
    expect(bandes.map((b) => [b.rang, b.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('ordre naturel des noms : Manon 10 après Manon 9, casse ignorée, quel que soit l’ordre donné', () => {
    const bandes = bandesDeSerre(TRI, [sz('Manon 10'), sz('manon 2'), sz('Manon 9'), sz('Manon 1')]);
    expect(bandes.map((b) => b.nom)).toEqual(['Manon 1', 'manon 2', 'Manon 9', 'Manon 10']);
  });

  it('noms égaux : l’identifiant tranche (résultat stable)', () => {
    const bandes = bandesDeSerre(TRI, [sz('Manon', 'b'), sz('Manon', 'a')]);
    expect(bandes.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('une seule sous-zone : une bande sur toute la largeur', () => {
    const [b] = bandesDeSerre(TRI, [sz('Manon 1')]);
    expect(b).toMatchObject({ largeurM: 28.8, longueurM: 40, rang: 1, total: 1, centre: { x: 0, y: 0 } });
  });

  it('arrondi au millimètre : 10 m en trois bandes → 3,333 m de large, centres −3,333 ; 0 ; 3,333 m', () => {
    const bandes = bandesDeSerre({ longueurM: 20, largeurM: 10 }, [sz('A'), sz('B'), sz('C')]);
    expect(bandes.map((b) => b.largeurM)).toEqual([3.333, 3.333, 3.333]);
    expect(bandes.map((b) => b.centre.x)).toEqual([-3.333, 0, 3.333]);
  });

  it('aucune sous-zone, ou serre sans dimensions : aucune bande', () => {
    expect(bandesDeSerre(TRI, [])).toEqual([]);
    expect(bandesDeSerre({ longueurM: 0, largeurM: 28.8 }, [sz('Manon 1')])).toEqual([]);
    expect(bandesDeSerre({ longueurM: 40, largeurM: Number.NaN }, [sz('Manon 1')])).toEqual([]);
  });

  it('n’altère pas ses arguments', () => {
    const entree = [sz('Manon 2'), sz('Manon 1')];
    const copie = entree.map((z) => ({ ...z }));
    bandesDeSerre(TRI, entree);
    expect(entree).toEqual(copie);
  });
});

describe('T86 : rangerDansBande', () => {
  const bandes = bandesDeSerre(TRI, [sz('Manon 1'), sz('Manon 2'), sz('Manon 3')]);
  const bande = (k: number): BandeSerre => {
    const b = bandes[k];
    if (b === undefined) throw new Error('bande absente');
    return b;
  };

  it('exemple chiffré : 4 planches de 38 × 0,75 m dans la bande 2 → centres −1,8 ; −0,6 ; +0,6 ; +1,8 m, y = 0, rien ne dépasse', () => {
    const r = rangerDansBande(bande(1), [planche('P1'), planche('P2'), planche('P3'), planche('P4')], 45);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.planches.map((p) => p.code)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(r.planches.map((p) => p.centre.x)).toEqual([-1.8, -0.6, 0.6, 1.8]);
    expect(r.planches.map((p) => p.centre.y)).toEqual([0, 0, 0, 0]);
    expect(r.planches.map((p) => [p.longueurM, p.largeurM])).toEqual([[38, 0.75], [38, 0.75], [38, 0.75], [38, 0.75]]);
    expect(r.depassent).toEqual([]);
  });

  it('dans la bande 1 : les mêmes planches, décalées du centre de la bande (−9,6 m)', () => {
    const r = rangerDansBande(bande(0), [planche('P1'), planche('P2')], 45);
    // bloc = 2 × 0,75 + 0,45 = 1,95 m ; centres −0,6 et +0,6 m dans la bande
    expect(r?.planches.map((p) => p.centre.x)).toEqual([-10.2, -9]);
  });

  it('ordre naturel des codes : P10 après P9 ; passe-pied 0 ; largeur inconnue = 0,80 m', () => {
    const r = rangerDansBande(bande(2), [planche('P10', 38, null), planche('P9', 38, null)], 0);
    expect(r?.planches.map((p) => p.code)).toEqual(['P9', 'P10']);
    // bloc = 1,6 m, bord ouest à 9,6 − 0,8 = 8,8 m : centres 9,2 et 10 m
    expect(r?.planches.map((p) => p.centre.x)).toEqual([9.2, 10]);
    expect(r?.planches.map((p) => p.largeurM)).toEqual([0.8, 0.8]);
  });

  it('9 planches : le bloc fait 10,35 m pour 9,6 m de bande, la première et la dernière dépassent', () => {
    const neuf = Array.from({ length: 9 }, (_, i) => planche(`P${String(i + 1)}`));
    const r = rangerDansBande(bande(1), neuf, 45);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.planches).toHaveLength(9);
    expect(r.depassent).toEqual(['id-P1', 'id-P9']);
  });

  it('une planche plus longue que la serre dépasse (42 m pour 40 m)', () => {
    const r = rangerDansBande(bande(1), [planche('P1', 42), planche('P2')], 45);
    expect(r?.depassent).toContain('id-P1');
  });

  it('une planche tout juste dans la bande ne dépasse pas (tolérance d’un millimètre)', () => {
    // une planche de 9,6 m de large exactement, comme la bande
    const r = rangerDansBande(bande(1), [planche('P1', 38, 9.6)], 45);
    expect(r?.depassent).toEqual([]);
  });

  it('aucune planche, passe-pied hors bornes, longueur invalide : null', () => {
    expect(rangerDansBande(bande(1), [], 45)).toBeNull();
    expect(rangerDansBande(bande(1), [planche('P1')], 501)).toBeNull();
    expect(rangerDansBande(bande(1), [planche('P1')], -1)).toBeNull();
    expect(rangerDansBande(bande(1), [planche('P1', 0)], 45)).toBeNull();
  });
});
