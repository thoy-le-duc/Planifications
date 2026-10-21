// @vitest-environment happy-dom
/**
 * Tests d'acceptation T72 — densité des engrais liquides, côté Ferme (docs/backlog/T72-densite-engrais-liquides.md,
 * règles 1, 3, 4, 5 et 6) : champ « Densité (kg/L) » de la fiche produit, mention « densité non
 * renseignée » dans le cahier, avertissement d'un solide en volume dans les recettes de fertirrigation.
 * Vrai écran dans un DOM simulé (happy-dom), ferme neuve + ./test/jeu.ts (jour 2026-10-19).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coeur from '@planif/core';
import type { ModuleFertilisationFerme, ModuleRecettesFertirrigation, ProprietesEcranFertilisation } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { aBouton, aChamp, attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../../itineraires/test/outils.ts';
import { ecrireApport, ecrireEngraisT72, ecrireJeu, LIQUIDE, LIQUIDE_SANS, POUDRE } from './test/jeu.ts';

const CHEMIN = './index.ts';
const SANS_DENSITE = 'densité non renseignée : 1 kg/L supposé';
const SOLIDE_EN_VOLUME = 'produit solide saisi en volume : pas d’unités comptées, saisissez en kg ou t';
let m: ModuleFertilisationFerme & ModuleRecettesFertirrigation;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

type Valider = (l: unknown) => { readonly ok: true } | { readonly ok: false; readonly erreur: { readonly message: string } };
let validerProduitFertilisant: Valider;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleFertilisationFerme & ModuleRecettesFertirrigation;
  validerProduitFertilisant = (coeur as unknown as Record<string, unknown>).validerProduitFertilisant as Valider;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
  vi.unstubAllGlobals();
});

const produits = (): Ligne[] => lire(b, 'SELECT * FROM produit_fertilisant WHERE ferme_id = ? ORDER BY nom, id', [FERME]);
const proprietes = (): ProprietesEcranFertilisation => ({ porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined });

async function rendre(ecran: 'EcranProduitsFertilisants' | 'EcranCahierFertilisation' | 'EcranRecettesFertirrigation', titre: string): Promise<HTMLElement> {
  await act(async () => {
    racine.render(createElement(m[ecran], proprietes()));
    await Promise.resolve();
  });
  await attendre(() => dialogue(titre) !== undefined, `dialogue « ${titre} »`);
  return dialogueOuEchec(titre);
}

function valide(l: Ligne | undefined): void {
  if (l === undefined) throw new Error('produit absent');
  const r = validerProduitFertilisant({ ...l });
  expect(r.ok, r.ok ? '' : `validerProduitFertilisant refuse : ${r.erreur.message}`).toBe(true);
}

describe('T72 : champ « Densité (kg/L) » de la fiche produit (règle 6)', () => {
  it('visible seulement pour la forme liquide, clavier décimal', async () => {
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    expect(aChamp('Densité (kg/L)', d), 'forme solide par défaut : pas de densité').toBe(false);
    await remplir(liste('Forme', d), 'liquide');
    expect(aChamp('Densité (kg/L)', d), 'forme liquide : densité').toBe(true);
    expect(champ('Densité (kg/L)', d).getAttribute('inputmode')).toBe('decimal');
    await remplir(liste('Forme', d), 'solide');
    expect(aChamp('Densité (kg/L)', d)).toBe(false);
  });

  it('liquide à 1,25 kg/L : une transaction, densite_kg_par_l = 1.25, ligne acceptée par le serveur', async () => {
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Engrais liquide azoté');
    await remplir(liste('Forme', d), 'liquide');
    await remplir(liste('Unité', d), 'L');
    await remplir(champ('Azote N (%)', d), '10');
    await remplir(champ('Densité (kg/L)', d), '1,25');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => dialogue('Nouveau produit') === undefined, 'dialogue refermé');
    expect(b.transactions()).toBe(1);
    expect(produits()[0]).toMatchObject({ forme: 'liquide', unite: 'L', teneur_n: 10, densite_kg_par_l: 1.25 });
    valide(produits()[0]);
  });

  it('liquide sans densité : accepté, densité vide (null)', async () => {
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Vinasse');
    await remplir(liste('Forme', d), 'liquide');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => produits().length === 1, 'produit écrit');
    expect(produits()[0]?.densite_kg_par_l).toBeNull();
    valide(produits()[0]);
  });

  it.each(['0,4', '2,6', '0', '1,2,3', 'lourd'])('densité « %s » : refusée en français, rien d’écrit', async (saisie) => {
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Erreur');
    await remplir(liste('Forme', d), 'liquide');
    await remplir(champ('Densité (kg/L)', d), saisie);
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message de refus');
    expect(texte(d.querySelector('[role="alert"]'))).toContain('densité : de 0,5 à 2,5 kg/L');
    expect(b.transactions()).toBe(0);
    expect(produits()).toHaveLength(0);
  });

  it('fiche d’un liquide existant : densité préremplie à la virgule, modifiable, puis retirée', async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await attendre(() => document.querySelector('[data-produit]') !== null, 'produits affichés');
    const ligne = document.querySelector<HTMLElement>(`[data-produit="${LIQUIDE}"]`);
    expect(texte(ligne), 'la liste montre la densité').toContain('1,25 kg/L');
    await toucher(bouton('Modifier Engrais liquide azoté'));
    const mo = dialogueOuEchec('Modifier le produit');
    expect(champ('Densité (kg/L)', mo).value).toBe('1,25');
    await remplir(champ('Densité (kg/L)', mo), '1,3');
    await toucher(bouton('Enregistrer', mo));
    await attendre(() => produits().find((p) => p.id === LIQUIDE)?.densite_kg_par_l === 1.3, 'densité modifiée');
    await attendre(() => dialogue('Modifier le produit') === undefined, 'dialogue refermé');
    await toucher(bouton('Modifier Engrais liquide azoté'));
    const mo2 = dialogueOuEchec('Modifier le produit');
    await remplir(champ('Densité (kg/L)', mo2), '');
    await toucher(bouton('Enregistrer', mo2));
    await attendre(() => produits().find((p) => p.id === LIQUIDE)?.densite_kg_par_l === null, 'densité retirée');
  });

  it('repasser en solide vide la densité : la ligne reste acceptée par le serveur', async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
    await rendre('EcranProduitsFertilisants', 'Produits fertilisants');
    await attendre(() => document.querySelector('[data-produit]') !== null, 'produits affichés');
    await toucher(bouton('Modifier Engrais liquide azoté'));
    const mo = dialogueOuEchec('Modifier le produit');
    await remplir(liste('Forme', mo), 'solide');
    await remplir(liste('Unité', mo), 'kg');
    await toucher(bouton('Enregistrer', mo));
    await attendre(() => produits().find((p) => p.id === LIQUIDE)?.forme === 'solide', 'passé en solide');
    const p = produits().find((x) => x.id === LIQUIDE);
    expect(p?.densite_kg_par_l).toBeNull();
    valide(p);
  });
});

describe('T72 : cahier de fertilisation, densité des liquides (règles 2 et 3)', () => {
  const apports = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="apport"]')];
  const sansEspaces = (t: string): string => t.replace(/[\s  ]/g, '');

  async function ficheP1(): Promise<void> {
    await rendre('EcranCahierFertilisation', 'Cahier de fertilisation');
    await attendre(() => document.querySelector('[data-testid="bilan-planche"]') !== null, 'ligne de P1');
    await toucher(bouton('Fertilisation P1'));
    dialogueOuEchec('Fertilisation P1');
  }

  it('100 L du liquide de densité 1,25 sur P1 (100 m²) : 12,5 kg N, soit 1 250 kg N/ha, sans mention de densité', async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
    await ecrireApport(b, { date: '2026-03-10', produitId: LIQUIDE, produit: 'Engrais liquide azoté', quantite: 100, unite: 'L' });
    await ficheP1();
    expect(apports()).toHaveLength(1);
    expect(sansEspaces(texte(apports()[0]))).toContain('N1250');
    expect(texte(apports()[0])).not.toContain('densité non renseignée');
  });

  it('même apport, densité non renseignée : 1 kg/L supposé (10 kg N, 1 000 kg N/ha), la mention s’affiche', async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
    await ecrireApport(b, { date: '2026-03-10', produitId: LIQUIDE_SANS, produit: 'Engrais liquide sans densité', quantite: 100, unite: 'L' });
    await ficheP1();
    expect(sansEspaces(texte(apports()[0]))).toContain('N1000');
    expect(texte(apports()[0])).toContain(SANS_DENSITE);
  });

  it('liquide en kg : aucune densité à supposer, pas de mention', async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
    await ecrireApport(b, { date: '2026-03-10', produitId: LIQUIDE_SANS, produit: 'Engrais liquide sans densité', quantite: 100, unite: 'kg' });
    await ficheP1();
    expect(texte(apports()[0])).not.toContain('densité non renseignée');
  });
});

describe('T72 : recettes de fertirrigation, engrais en volume (règle 5)', () => {
  async function ouvrirNouvelle(): Promise<HTMLElement> {
    await rendre('EcranRecettesFertirrigation', 'Recettes de fertirrigation');
    await attendre(() => aBouton('Nouvelle recette'), 'bouton « Nouvelle recette »');
    await toucher(bouton('Nouvelle recette'));
    const d = dialogueOuEchec('Nouvelle recette');
    await attendre(() => d.querySelector(`option[value="${LIQUIDE}"]`) !== null, 'engrais de la ferme proposés');
    return d;
  }

  beforeEach(async () => {
    await ecrireJeu(b, { produits: false });
    await ecrireEngraisT72(b);
  });

  it('engrais liquide sans densité en L : « densité non renseignée : 1 kg/L supposé » ; avec densité ou en kg : rien', async () => {
    const d = await ouvrirNouvelle();
    await remplir(liste('Engrais 1', d), LIQUIDE_SANS);
    await remplir(liste('Unité 1', d), 'L');
    expect(texte(d)).toContain(SANS_DENSITE);
    await remplir(liste('Unité 1', d), 'kg');
    expect(texte(d)).not.toContain(SANS_DENSITE);
    await remplir(liste('Unité 1', d), 'L');
    await remplir(liste('Engrais 1', d), LIQUIDE);
    expect(texte(d)).not.toContain(SANS_DENSITE);
  });

  it('engrais solide en L : avertissement visible, la recette s’enregistre quand même', async () => {
    const d = await ouvrirNouvelle();
    await remplir(champ('Nom', d), 'Poudre en volume');
    await remplir(liste('Engrais 1', d), POUDRE);
    await remplir(champ('Quantité 1', d), '5');
    expect(texte(d)).not.toContain(SOLIDE_EN_VOLUME);
    await remplir(liste('Unité 1', d), 'L');
    expect(texte(d)).toContain(SOLIDE_EN_VOLUME);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => lire(b, 'SELECT * FROM recette_fertirrigation WHERE ferme_id = ?', [FERME]).length === 1, 'recette écrite');
    const [r] = lire(b, 'SELECT * FROM recette_fertirrigation WHERE ferme_id = ?', [FERME]);
    expect(JSON.parse(String(r?.engrais))).toEqual([{ produitFertilisantId: POUDRE, quantite: { valeur: 5, unite: 'L' } }]);
  });
});
