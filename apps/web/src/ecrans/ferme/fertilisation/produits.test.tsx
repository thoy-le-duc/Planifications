// @vitest-environment happy-dom
/**
 * Tests d'acceptation T54 — produits fertilisants de la ferme (docs/backlog/T54-cahier-fertilisation.md,
 * règle 1). Vrai écran dans un DOM simulé (happy-dom), porte sur la base mémoire de la ferme neuve.
 * Contrat : ./test/contrat.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coeur from '@planif/core';
import type { ModuleFertilisationFerme, ProprietesEcranFertilisation } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { aBouton, attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModuleFertilisationFerme;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

type Valider = (l: unknown) => { readonly ok: true } | { readonly ok: false; readonly erreur: { readonly message: string } };
let validerProduitFertilisant: Valider;
let depart: readonly { readonly nom: string }[];

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleFertilisationFerme;
  const c = coeur as unknown as Record<string, unknown>;
  if (typeof c.validerProduitFertilisant !== 'function' || !Array.isArray(c.FERTILISANTS_DEPART)) throw new Error('@planif/core n’exporte pas validerProduitFertilisant ni FERTILISANTS_DEPART (T54)');
  validerProduitFertilisant = c.validerProduitFertilisant as Valider;
  depart = c.FERTILISANTS_DEPART as readonly { readonly nom: string }[];
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
const lignes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="produit-fertilisant"]')];

function valide(l: Ligne | undefined): void {
  if (l === undefined) throw new Error('produit absent');
  const r = validerProduitFertilisant({ ...l });
  expect(r.ok, r.ok ? '' : `validerProduitFertilisant refuse : ${r.erreur.message}`).toBe(true);
}

function sansDelete(): void {
  const interdits = b.base.ecritures.filter((sql) => /^\s*(DELETE|REPLACE|INSERT\s+OR\s+REPLACE)\b/i.test(sql) && /produit_fertilisant/i.test(sql));
  expect(interdits, 'jamais de DELETE ni de REPLACE sur produit_fertilisant').toEqual([]);
}

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesEcranFertilisation = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined };
  await act(async () => {
    racine.render(createElement(m.EcranProduitsFertilisants, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Produits fertilisants') !== undefined, 'dialogue « Produits fertilisants »');
  return dialogueOuEchec('Produits fertilisants');
}

describe('T54 : produits fertilisants de la ferme', () => {
  it('ferme sans produit : « Ajouter la liste de départ » écrit toute la liste en une transaction, produits valides', async () => {
    await ouvrir();
    await attendre(() => aBouton('Ajouter la liste de départ'), 'bouton « Ajouter la liste de départ »');
    b.remiseAZero();
    await toucher(bouton('Ajouter la liste de départ'));
    await attendre(() => produits().length === depart.length, 'liste de départ écrite');
    expect(b.transactions()).toBe(1);
    for (const p of produits()) valide(p);
    expect(produits().map((p) => p.nom).sort()).toEqual(depart.map((p) => p.nom).sort());
    await attendre(() => lignes().length === depart.length, 'produits affichés');
    expect(aBouton('Ajouter la liste de départ'), 'le bouton disparaît').toBe(false);
    sansDelete();
  });

  it('nouveau produit : une transaction, teneurs à la virgule, ligne acceptée par le serveur', async () => {
    await ouvrir();
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Compost maison');
    await remplir(liste('Unité', d), 't');
    await remplir(champ('Azote N (%)', d), '1,2');
    await remplir(champ('Potasse K₂O (%)', d), '0,9');
    await toucher(champ('Azote d’origine organique', d));
    await remplir(champ('Source', d), 'analyse du 12/03/2026');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => dialogue('Nouveau produit') === undefined, 'dialogue refermé');
    expect(b.transactions()).toBe(1);
    const [p] = produits();
    valide(p);
    expect(p).toMatchObject({ nom: 'Compost maison', unite: 't', teneur_n: 1.2, teneur_p2o5: null, teneur_k2o: 0.9, organique: 1, source: 'analyse du 12/03/2026', supprime_le: null });
    await attendre(() => lignes().length === 1, 'produit affiché');
    expect(texte(lignes()[0])).toContain('Compost maison');
    expect(lignes()[0]?.dataset.produit).toBe(p?.id);
  });

  it('teneur au-delà de 100 % : refusée avec un message, rien d’écrit', async () => {
    await ouvrir();
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Erreur');
    await remplir(champ('Azote N (%)', d), '130');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message de refus');
    expect(b.transactions()).toBe(0);
    expect(produits()).toHaveLength(0);
  });

  it('modifier la teneur (analyse reçue), puis archiver : une transaction chacun, jamais de DELETE', async () => {
    await ouvrir();
    await toucher(bouton('Nouveau produit'));
    const d = dialogueOuEchec('Nouveau produit');
    await remplir(champ('Nom', d), 'Fumier de bovin');
    await remplir(champ('Azote N (%)', d), '0,55');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => lignes().length === 1, 'produit affiché');
    await toucher(bouton('Modifier Fumier de bovin'));
    const mo = dialogueOuEchec('Modifier le produit');
    expect(champ('Azote N (%)', mo).value).toMatch(/^0[,.]55$/);
    await remplir(champ('Azote N (%)', mo), '0,6');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', mo));
    await attendre(() => produits()[0]?.teneur_n === 0.6, 'teneur modifiée');
    expect(b.transactions()).toBe(1);
    valide(produits()[0]);
    await attendre(() => dialogue('Modifier le produit') === undefined, 'dialogue refermé');
    await toucher(bouton('Modifier Fumier de bovin'));
    b.remiseAZero();
    await toucher(bouton('Archiver le produit', dialogueOuEchec('Modifier le produit')));
    await attendre(() => produits()[0]?.supprime_le !== null, 'produit archivé');
    expect(b.transactions()).toBe(1);
    await attendre(() => lignes().length === 0 && aBouton('Rétablir Fumier de bovin'), 'archivé à part, rétablissable');
    // Une ferme qui a déjà eu un produit ne se voit plus proposer la liste de départ.
    expect(aBouton('Ajouter la liste de départ')).toBe(false);
    sansDelete();
  });
});
