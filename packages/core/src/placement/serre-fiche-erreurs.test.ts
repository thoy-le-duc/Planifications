/** T89 : ce qui empêche la fiche « Serre ou tunnel » de créer la serre (erreurFicheSerre). */
import { describe, expect, it } from 'vitest';
import { defautsSerre, erreurFicheSerre, type FicheSerre } from './serre-fiche.ts';

const fiche = (ecart: Partial<FicheSerre> = {}): FicheSerre => ({ ...defautsSerre(), nom: 'Serre à légumes', prefixeZones: 'Serre à légumes', ...ecart });
const planches = (ecart: Partial<FicheSerre['planches']>): Partial<FicheSerre> => ({ planches: { ...defautsSerre().planches, ...ecart } });

describe('T89 : erreurFicheSerre', () => {
  it('les valeurs par défaut, avec un nom, sont valides ; la serre à légumes aussi', () => {
    expect(erreurFicheSerre(fiche())).toBeNull();
    expect(erreurFicheSerre(fiche({ nbChapelles: 6, nbTroncons: 3 }))).toBeNull();
  });

  it.each<[string, Partial<FicheSerre>, RegExp]>([
    ['nom vide', { nom: '  ' }, /nom/],
    ['préfixe vide', { prefixeZones: '' }, /préfixe/],
    ['chapelle nulle', { largeurChapelleM: 0 }, /chapelle/],
    ['chapelle illisible', { largeurChapelleM: Number.NaN }, /chapelle/],
    ['0 chapelle', { nbChapelles: 0 }, /chapelles/],
    ['2,5 chapelles', { nbChapelles: 2.5 }, /chapelles/],
    ['101 chapelles', { nbChapelles: 101 }, /chapelles/],
    ['tronçon négatif', { longueurTronconM: -3 }, /tronçon/],
    ['0 tronçon', { nbTroncons: 0 }, /tronçons/],
    ['51 tronçons', { nbTroncons: 51 }, /tronçons/],
    ['allée négative', { nbTroncons: 2, largeurAlleeM: -1 }, /allée/i],
    ['allée plus large qu’un tronçon', { nbTroncons: 2, largeurAlleeM: 80 }, /allée/i],
    ['trop longue (13 tronçons de 40 m)', { nbTroncons: 13, largeurAlleeM: 0 }, /500 m/],
    ['trop large (21 chapelles de 9,6 m)', { nbChapelles: 21 }, /200 m/],
    ['planches : nombre non entier', planches({ nombre: 1.5 }), /planches par zone/],
    ['planches : largeur nulle', planches({ largeurCm: 0 }), /largeur des planches/],
    ['planches : longueur nulle', planches({ longueurM: 0 }), /longueur des planches/],
    ['planches plus longues que le tronçon', planches({ longueurM: 41 }), /plus longues/],
    ['passe-pied non entier', planches({ passePiedCm: 4.5 }), /passe-pied/i],
  ])('%s : refusé', (_cas, ecart, motif) => {
    expect(erreurFicheSerre(fiche(ecart))).toMatch(motif);
  });

  it('un seul tronçon : l’allée n’est pas contrôlée (elle n’est pas affichée)', () => {
    expect(erreurFicheSerre(fiche({ nbTroncons: 1, largeurAlleeM: -5 }))).toBeNull();
  });

  it('zéro planche par zone : les mesures des planches ne sont pas contrôlées', () => {
    expect(erreurFicheSerre(fiche(planches({ nombre: 0, largeurCm: 0, longueurM: 0 })))).toBeNull();
  });
});
