/**
 * Tests d'acceptation T85 — la parcelle d'une zone dessinée depuis ses planches
 * (docs/backlog/T85-parcelle-depuis-planches.md, règle 3). Pur : mètres, aucun repère de la ferme.
 *
 * Repère du résultat : origine au centre du rectangle, x vers l'est (largeur), y vers le nord
 * (longueur). Les planches sont côte à côte, P1 contre le bord ouest, toutes alignées en bout sud.
 *
 * Exemple chiffré à la main : 3 planches de 30 m × 0,75 m, passe-pied 45 cm.
 *   largeur = 3 × 0,75 + 2 × 0,45 = 3,15 m ; longueur = 30 m ;
 *   bord ouest à −1,575 m : centre de P1 = −1,575 + 0,375 = −1,2 m ;
 *   P2 = −1,2 + 0,75 + 0,45 = 0 m ; P3 = +1,2 m ; y = −15 + 30 / 2 = 0 m.
 */
import { describe, expect, it } from 'vitest';
import { LARGEUR_PLANCHE_PAR_DEFAUT_M, PASSE_PIED_MAX_CM, PASSE_PIED_PAR_DEFAUT_CM, parcelleDepuisPlanches, type PlancheDeParcelle } from '@planif/core/placement';

const planche = (code: string, longueurM: number, largeurM: number | null, id = `id-${code}`): PlancheDeParcelle => ({ id, code, longueurM, largeurM });

describe('T85 : constantes', () => {
  it('passe-pied de départ 45 cm, plafond 500 cm, largeur par défaut 0,80 m', () => {
    expect(PASSE_PIED_PAR_DEFAUT_CM).toBe(45);
    expect(PASSE_PIED_MAX_CM).toBe(500);
    expect(LARGEUR_PLANCHE_PAR_DEFAUT_M).toBe(0.8);
  });
});

describe('T85 : parcelleDepuisPlanches', () => {
  it('exemple chiffré : 3 planches de 30 × 0,75 m, passe-pied 45 cm → 30 × 3,15 m, centres à −1,2 ; 0 ; +1,2 m', () => {
    const p = parcelleDepuisPlanches([planche('P1', 30, 0.75), planche('P2', 30, 0.75), planche('P3', 30, 0.75)], 45);
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.longueurM).toBe(30);
    expect(p.largeurM).toBe(3.15);
    expect(p.planches.map((x) => x.code)).toEqual(['P1', 'P2', 'P3']);
    expect(p.planches.map((x) => x.centre.x)).toEqual([-1.2, 0, 1.2]);
    expect(p.planches.map((x) => x.centre.y)).toEqual([0, 0, 0]);
    expect(p.planches.map((x) => x.longueurM)).toEqual([30, 30, 30]);
    expect(p.planches.map((x) => x.largeurM)).toEqual([0.75, 0.75, 0.75]);
  });

  it('ordre naturel des codes : P10 après P9, sans tenir compte de la casse', () => {
    const p = parcelleDepuisPlanches([planche('P10', 5, 1), planche('p2', 5, 1), planche('P9', 5, 1), planche('P1', 5, 1)], 0);
    expect(p?.planches.map((x) => x.code)).toEqual(['P1', 'p2', 'P9', 'P10']);
    expect(p?.planches.map((x) => x.centre.x)).toEqual([-1.5, -0.5, 0.5, 1.5]);
  });

  it('codes égaux à la casse près : l’identifiant tranche, le résultat ne dépend pas de l’ordre d’entrée', () => {
    const a = parcelleDepuisPlanches([planche('P1', 5, 1, 'b'), planche('p1', 5, 1, 'a')], 0);
    const b = parcelleDepuisPlanches([planche('p1', 5, 1, 'a'), planche('P1', 5, 1, 'b')], 0);
    expect(a?.planches.map((x) => x.id)).toEqual(['a', 'b']);
    expect(b).toEqual(a);
  });

  it('une planche sans largeur (nulle ou zéro) compte pour 0,80 m', () => {
    const p = parcelleDepuisPlanches([planche('P1', 20, null), planche('P2', 20, 0), planche('P3', 20, 0.5)], 10);
    expect(p?.largeurM).toBe(2.3);
    expect(p?.planches.map((x) => x.largeurM)).toEqual([0.8, 0.8, 0.5]);
    // 0,8 + 0,8 + 0,5 = 2,1 m et 2 passe-pieds de 0,1 m : 2,3 m ; bord ouest −1,15 m.
    expect(p?.planches.map((x) => x.centre.x)).toEqual([-0.75, 0.15, 0.9]);
  });

  it('longueurs différentes : le rectangle prend la plus longue, toutes les planches sont alignées en bout sud', () => {
    const p = parcelleDepuisPlanches([planche('P1', 10, 1), planche('P2', 30, 1), planche('P3', 20, 1)], 0);
    expect(p?.longueurM).toBe(30);
    expect(p?.planches.map((x) => x.centre.y)).toEqual([-10, 0, -5]);
    // Le bout sud de chacune est le bord sud du rectangle : y − longueur / 2 = −15.
    for (const x of p?.planches ?? []) expect(x.centre.y - x.longueurM / 2).toBe(-15);
  });

  it('passe-pied 0 : planches jointives, largeur = somme des largeurs', () => {
    const p = parcelleDepuisPlanches([planche('P1', 12, 0.75), planche('P2', 12, 0.75)], 0);
    expect(p?.largeurM).toBe(1.5);
    expect(p?.planches.map((x) => x.centre.x)).toEqual([-0.375, 0.375]);
  });

  it('une seule planche : le rectangle a ses mesures, centre sur l’axe', () => {
    const p = parcelleDepuisPlanches([planche('P1', 25, 0.8)], 45);
    expect(p?.longueurM).toBe(25);
    expect(p?.largeurM).toBe(0.8);
    expect(p?.planches[0]?.centre).toEqual({ x: 0, y: 0 });
  });

  it('arrondi au millimètre', () => {
    const p = parcelleDepuisPlanches([planche('P1', 10.0004, 0.7333), planche('P2', 10, 0.7333), planche('P3', 10, 0.7333)], 33);
    expect(p?.longueurM).toBe(10);
    expect(p?.largeurM).toBe(2.86);
    for (const x of p?.planches ?? []) {
      expect(Math.round(x.centre.x * 1000)).toBeCloseTo(x.centre.x * 1000, 6);
      expect(Math.round(x.centre.y * 1000)).toBeCloseTo(x.centre.y * 1000, 6);
    }
  });

  it('aucune planche, passe-pied hors 0 à 500 cm ou non entier, longueur nulle : pas de parcelle', () => {
    expect(parcelleDepuisPlanches([], 45)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 10, 1)], -1)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 10, 1)], 501)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 10, 1)], 12.5)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 10, 1)], Number.NaN)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 0, 1)], 45)).toBeNull();
    expect(parcelleDepuisPlanches([planche('P1', 10, 1)], 500)).not.toBeNull();
  });

  it('ne modifie pas ses arguments', () => {
    const entree = [planche('P2', 5, 1), planche('P1', 5, 1)];
    const copie = entree.map((p) => ({ ...p }));
    parcelleDepuisPlanches(entree, 45);
    expect(entree).toEqual(copie);
  });
});
