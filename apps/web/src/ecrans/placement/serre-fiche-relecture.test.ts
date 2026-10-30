/**
 * T89, relecture critique (points 1 et 3) : une zone qui a des planches directes et aucune sous-zone ne se place pas sur plusieurs
 * cases (ses planches seraient en double) ; plusieurs fiches avant un seul « Enregistrer » : le total du brouillon compte contre 500.
 */
import { describe, expect, it } from 'vitest';
import { defautsSerre, type FicheSerre } from '@planif/core/placement';
import { raisonFiche, type ContexteFiche } from './serre-fiche.tsx';
import type { EmplacementEnService, Zone } from './donnees.ts';

const fiche = (ecart: Partial<FicheSerre> = {}): FicheSerre => ({ ...defautsSerre(), nom: 'Serre', prefixeZones: 'Serre', ...ecart });
const contexte = (ecart: Partial<ContexteFiche> = {}): ContexteFiche => ({ zones: [], batiments: [], emplacements: [], zoneId: null, centre: { x: 0, y: 0 }, nouvelId: () => 'id', ...ecart });
const zone: Zone = { id: 'z', nom: 'Tunnel 1', contour: null, parenteId: null, typeAbri: 'tunnel' };
const planche: EmplacementEnService = { id: 'p', zoneId: 'z', code: 'P1', longueurM: 30, largeurM: 0.75, placement: null };

describe('T89 : zone à planches directes sans sous-zone', () => {
  it('plus d’une case : refusé, avec un message qui dit quoi faire', () => {
    expect(raisonFiche(fiche({ nbChapelles: 2 }), contexte({ zones: [zone], emplacements: [planche], zoneId: 'z' }))).toMatch(/déjà des planches.*Parcellaire.*une seule case/);
  });

  it('une seule case : permis (ses planches sont reprises) ; sans planche, plusieurs cases : permis', () => {
    expect(raisonFiche(fiche(), contexte({ zones: [zone], emplacements: [planche], zoneId: 'z' }))).toBeNull();
    expect(raisonFiche(fiche({ nbChapelles: 2 }), contexte({ zones: [zone], zoneId: 'z' }))).toBeNull();
  });
});

describe('T89 : plusieurs fiches avant un seul « Enregistrer »', () => {
  it('les changements déjà au brouillon comptent : 164 + 340 > 500, refusé', () => {
    const legumes = fiche({ nbChapelles: 6, nbTroncons: 3 });
    expect(raisonFiche(legumes, contexte())).toBeNull();
    expect(raisonFiche(legumes, contexte({ deja: 340 }))).toMatch(/504 écritures.*500 au plus/);
    expect(raisonFiche(legumes, contexte({ deja: 336 }))).toBeNull();
  });
});
