// @vitest-environment happy-dom
/**
 * Tests d'acceptation T54 — saisie d'un apport depuis Aujourd'hui, choix du produit au doigt
 * (docs/backlog/T54-cahier-fertilisation.md, règle 2). Vrai écran dans un DOM simulé (happy-dom),
 * ferme neuve + ../ferme/fertilisation/test/jeu.ts (jour 2026-10-19). Contrat :
 * ../ferme/fertilisation/test/contrat.ts (« Saisie d'un apport »).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { validerSaisie } from '@planif/core';
import type { ModuleSaisieFertilisation, ProprietesSaisieFertilisation } from '../ferme/fertilisation/test/contrat.ts';
import { FERME } from '../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, type Banc, type Ligne } from '../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, radio, remplir, toucher } from '../itineraires/test/outils.ts';
import { COMPOST, ecrireJeu, P1, P2 } from '../ferme/fertilisation/test/jeu.ts';

const CHEMIN = './fertilisation/index.ts';
let m: ModuleSaisieFertilisation;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let fermee = false;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleSaisieFertilisation;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  await ecrireJeu(b);
  fermee = false;
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

const apports = (): Ligne[] => lire(b, "SELECT * FROM evenement WHERE ferme_id = ? AND type = 'intervention' ORDER BY horodatage, id", [FERME]);
const presse = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true';

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesSaisieFertilisation = {
    porte: b.porte,
    fermeId: FERME,
    aujourdhui: AUJOURDHUI,
    surFermer: () => {
      fermee = true;
    },
  };
  await act(async () => {
    racine.render(createElement(m.SaisieFertilisation, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Fertilisation') !== undefined && dialogueOuEchec('Fertilisation').querySelector('[aria-pressed]') !== null, 'dialogue « Fertilisation » prêt');
  return dialogueOuEchec('Fertilisation');
}

function accepte(l: Ligne | undefined): Record<string, unknown> {
  if (l === undefined) throw new Error('apport absent');
  const r = validerSaisie({ ...l });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse : ${r.erreur.message}`).toBe(true);
  return JSON.parse(String(l.detail)) as Record<string, unknown>;
}

describe('T54 : saisie d’un apport, choix du produit au doigt', () => {
  it('planche, produit, quantité au doigt : un apport en une transaction, qui désigne le produit de la ferme', async () => {
    const d = await ouvrir();
    await toucher(bouton('P1', d));
    expect(presse(bouton('P1', d))).toBe(true);
    await toucher(bouton('Compost de déchets verts', d));
    expect(presse(bouton('Compost de déchets verts', d))).toBe(true);
    // Unité préremplie par celle du produit (t).
    expect(champ('Unité', d).value).toBe('t');
    await remplir(champ('Quantité', d), '2');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => apports().length === 1, 'apport écrit');
    expect(b.transactions()).toBe(1);
    const [a] = apports();
    const detail = accepte(a);
    expect(a).toMatchObject({ date: AUJOURDHUI, source: 'tap' });
    expect(JSON.parse(String(a?.emplacement_ids))).toEqual([P1]);
    expect(detail).toMatchObject({ produit: 'Compost de déchets verts', produitFertilisantId: COMPOST, quantite: { valeur: 2, unite: 't' } });
    expect(['fertilisation', 'amendement']).toContain(detail.categorie);
  });

  it('deux planches et « Fertilisation » : catégorie choisie, virgule acceptée', async () => {
    const d = await ouvrir();
    await toucher(bouton('P1', d));
    await toucher(bouton('P2', d));
    await toucher(bouton('Corne broyée', d));
    await toucher(radio('Fertilisation', d));
    await remplir(champ('Quantité', d), '1,5');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => apports().length === 1, 'apport écrit');
    const [a] = apports();
    const detail = accepte(a);
    expect(new Set(JSON.parse(String(a?.emplacement_ids)) as string[])).toEqual(new Set([P1, P2]));
    expect(detail).toMatchObject({ categorie: 'fertilisation', produit: 'Corne broyée', quantite: { valeur: 1.5, unite: 'kg' } });
  });

  it('texte libre (« Autre produit ») : accepté, sans produit de la ferme', async () => {
    const d = await ouvrir();
    await toucher(bouton('P1', d));
    await remplir(champ('Autre produit', d), 'Purin d’ortie');
    await remplir(champ('Quantité', d), '20');
    await remplir(champ('Unité', d), 'L');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => apports().length === 1, 'apport écrit');
    const detail = accepte(apports()[0]);
    expect(detail).toMatchObject({ produit: 'Purin d’ortie', produitFertilisantId: null, quantite: { valeur: 20, unite: 'L' } });
  });

  it('sans planche, sans produit ou sans quantité : rien d’écrit, un message', async () => {
    const d = await ouvrir();
    await toucher(bouton('Compost de déchets verts', d));
    await remplir(champ('Quantité', d), '2');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message sans planche');
    expect(b.transactions()).toBe(0);
    expect(apports()).toHaveLength(0);
    expect(fermee).toBe(false);
  });
});
