/**
 * T77 — la vue 3D ne se dit « prête » (attribut data-etat="pret", lu par les e2e et par l'écran)
 * qu'une fois la couche des plants chargée ET posée (ou en échec : la vue reste utilisable sans
 * plants ; ou sans base à lire : pas de couche à attendre).
 *
 * `etatDeLaCouche` dit où en est la couche (porte et ferme absentes → 'sans', chargement en cours →
 * 'attendue', module et cultures arrivés → 'chargee', lecture ou import en échec → 'echec') ;
 * `vueEstPrete` combine la première image dessinée, cet état et la pose des plants.
 */
import { describe, expect, it } from 'vitest';
import { etatDeLaCouche, vueEstPrete, type EtatCouche } from './pret-3d.ts';

describe('T77 : état de la couche des plants', () => {
  it('sans base ou sans ferme : aucune couche à attendre', () => {
    expect(etatDeLaCouche({ aUneBase: false, chargee: false, echec: false })).toBe('sans');
  });
  it('base présente, rien d’arrivé : on attend', () => {
    expect(etatDeLaCouche({ aUneBase: true, chargee: false, echec: false })).toBe('attendue');
  });
  it('couche arrivée : chargée', () => {
    expect(etatDeLaCouche({ aUneBase: true, chargee: true, echec: false })).toBe('chargee');
  });
  it('échec : la vue continue sans plants', () => {
    expect(etatDeLaCouche({ aUneBase: true, chargee: false, echec: true })).toBe('echec');
  });
  it('un plan relu après un échec qui réussit : chargée prime sur l’échec', () => {
    expect(etatDeLaCouche({ aUneBase: true, chargee: true, echec: true })).toBe('chargee');
  });
});

describe('T77 : « prête » attend la couche des plants', () => {
  const prete = (premiereImage: boolean, couche: EtatCouche, plantsPoses: boolean) => vueEstPrete({ premiereImage, couche, plantsPoses });

  it('jamais prête avant la première image', () => {
    for (const couche of ['sans', 'attendue', 'chargee', 'echec'] as const) expect(prete(false, couche, true), couche).toBe(false);
  });
  it('couche attendue : pas prête, même après la première image', () => {
    expect(prete(true, 'attendue', false)).toBe(false);
  });
  it('couche chargée mais plants pas encore posés : pas prête', () => {
    expect(prete(true, 'chargee', false)).toBe(false);
  });
  it('couche chargée et plants posés : prête', () => {
    expect(prete(true, 'chargee', true)).toBe(true);
  });
  it('échec de la couche : prête quand même, sans plants', () => {
    expect(prete(true, 'echec', false)).toBe(true);
  });
  it('sans couche à attendre : prête dès la première image', () => {
    expect(prete(true, 'sans', false)).toBe(true);
  });
});
