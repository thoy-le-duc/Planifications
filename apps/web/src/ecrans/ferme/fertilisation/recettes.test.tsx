// @vitest-environment happy-dom
/**
 * Tests d'acceptation T56 — recettes de fertirrigation de la ferme (docs/backlog/T56-fertirrigation.md,
 * règle 1). Vrai écran dans un DOM simulé (happy-dom), porte sur la base mémoire de la ferme neuve,
 * hors ligne (fetch refusé). Contrat : ./test/contrat.ts (« Recettes de fertirrigation »).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coeur from '@planif/core';
import type { ModuleRecettesFertirrigation, ProprietesEcranFertilisation } from './test/contrat.ts';
import { ecrireJeu, ecrireNitrate, NITRATE } from './test/jeu.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { aBouton, attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModuleRecettesFertirrigation;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

type Valider = (l: unknown) => { readonly ok: true } | { readonly ok: false; readonly erreur: { readonly message: string } };
let validerRecette: Valider;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleRecettesFertirrigation;
  const c = coeur as unknown as Record<string, unknown>;
  if (typeof c.validerRecetteFertirrigation !== 'function') throw new Error('@planif/core n’exporte pas validerRecetteFertirrigation (T56)');
  validerRecette = c.validerRecetteFertirrigation as Valider;
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

const recettes = (): Ligne[] => lire(b, 'SELECT * FROM recette_fertirrigation WHERE ferme_id = ? ORDER BY nom, id', [FERME]);
const lignes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="recette-fertirrigation"]')];

function valide(l: Ligne | undefined): void {
  if (l === undefined) throw new Error('recette absente');
  const r = validerRecette({ ...l });
  expect(r.ok, r.ok ? '' : `validerRecetteFertirrigation refuse : ${r.erreur.message}`).toBe(true);
}

function sansDelete(): void {
  const interdits = b.base.ecritures.filter((sql) => /^\s*(DELETE|REPLACE|INSERT\s+OR\s+REPLACE)\b/i.test(sql) && /recette_fertirrigation/i.test(sql));
  expect(interdits, 'jamais de DELETE ni de REPLACE sur recette_fertirrigation').toEqual([]);
}

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesEcranFertilisation = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined };
  await act(async () => {
    racine.render(createElement(m.EcranRecettesFertirrigation, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Recettes de fertirrigation') !== undefined, 'dialogue « Recettes de fertirrigation »');
  return dialogueOuEchec('Recettes de fertirrigation');
}

async function nouvelleRecette(nom: string, taux: string): Promise<HTMLElement> {
  await attendre(() => aBouton('Nouvelle recette'), 'bouton « Nouvelle recette »');
  await toucher(bouton('Nouvelle recette'));
  const d = dialogueOuEchec('Nouvelle recette');
  await attendre(() => d.querySelector(`option[value="${NITRATE}"]`) !== null, 'engrais de la ferme proposés');
  await remplir(champ('Nom', d), nom);
  await remplir(champ('Taux d’injection (%)', d), taux);
  await remplir(liste('Engrais 1', d), NITRATE);
  await remplir(champ('Quantité 1', d), '10');
  return d;
}

describe('T56 : recettes de fertirrigation de la ferme', () => {
  it('ferme sans produit fertilisant : invite à les déclarer d’abord, pas de recette possible', async () => {
    await ecrireJeu(b, { produits: false });
    const d = await ouvrir();
    await attendre(() => texte(d).includes('Produits fertilisants'), 'message vers « Produits fertilisants »');
    expect(aBouton('Nouvelle recette')).toBe(false);
  });

  it('exemple du ticket : « Fraise floraison », 10 kg de nitrate de calcium pour 1 000 L de mère, injection 1 % ; une transaction, ligne acceptée par le serveur', async () => {
    await ecrireJeu(b);
    await ecrireNitrate(b);
    await ouvrir();
    const d = await nouvelleRecette('Fraise floraison', '1');
    await remplir(champ('EC cible (mS/cm)', d), '1,8');
    await remplir(champ('pH cible', d), '5,8');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => dialogue('Nouvelle recette') === undefined, 'dialogue refermé');
    expect(b.transactions()).toBe(1);
    const [r] = recettes();
    valide(r);
    expect(r).toMatchObject({ nom: 'Fraise floraison', taux_injection: 1, ec_cible: 1.8, ph_cible: 5.8, supprime_le: null });
    expect(JSON.parse(String(r?.engrais))).toEqual([{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'kg' } }]);
    await attendre(() => lignes().length === 1, 'recette affichée');
    expect(texte(lignes()[0])).toContain('Fraise floraison');
    expect(texte(lignes()[0])).toContain('Nitrate de calcium');
    expect(lignes()[0]?.dataset.recette).toBe(r?.id);
  });

  it('sans taux : quantités par m³ d’eau (pleine terre) ; acceptée', async () => {
    await ecrireJeu(b);
    await ecrireNitrate(b);
    await ouvrir();
    const d = await nouvelleRecette('Tomate pleine terre', '');
    await remplir(champ('Quantité 1', d), '0,1');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => recettes().length === 1, 'recette écrite');
    valide(recettes()[0]);
    expect(recettes()[0]).toMatchObject({ taux_injection: null, ec_cible: null, ph_cible: null });
    expect(JSON.parse(String(recettes()[0]?.engrais))).toEqual([{ produitFertilisantId: NITRATE, quantite: { valeur: 0.1, unite: 'kg' } }]);
  });

  it('nom vide ou quantité illisible : refusée avec un message, rien d’écrit', async () => {
    await ecrireJeu(b);
    await ecrireNitrate(b);
    await ouvrir();
    const d = await nouvelleRecette('  ', '1');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message pour le nom vide');
    await remplir(champ('Nom', d), 'Fraise floraison');
    await remplir(champ('Quantité 1', d), 'beaucoup');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message pour la quantité');
    expect(b.transactions()).toBe(0);
    expect(recettes()).toHaveLength(0);
  });

  it('modifier le taux, puis archiver : une transaction chacun, jamais de DELETE ; archivée à part, rétablissable', async () => {
    await ecrireJeu(b);
    await ecrireNitrate(b);
    await ouvrir();
    await toucher(bouton('Enregistrer', await nouvelleRecette('Fraise floraison', '1')));
    await attendre(() => lignes().length === 1, 'recette affichée');
    await toucher(bouton('Modifier Fraise floraison'));
    const mo = dialogueOuEchec('Modifier la recette');
    expect(champ('Taux d’injection (%)', mo).value).toBe('1');
    await remplir(champ('Taux d’injection (%)', mo), '1,5');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', mo));
    await attendre(() => recettes()[0]?.taux_injection === 1.5, 'taux modifié');
    expect(b.transactions()).toBe(1);
    valide(recettes()[0]);
    await attendre(() => dialogue('Modifier la recette') === undefined, 'dialogue refermé');
    await toucher(bouton('Modifier Fraise floraison'));
    b.remiseAZero();
    await toucher(bouton('Archiver la recette', dialogueOuEchec('Modifier la recette')));
    await attendre(() => recettes()[0]?.supprime_le !== null, 'recette archivée');
    expect(b.transactions()).toBe(1);
    await attendre(() => lignes().length === 0 && aBouton('Rétablir Fraise floraison'), 'archivée à part, rétablissable');
    sansDelete();
  });
});
