// @vitest-environment happy-dom
/**
 * T85, relecture : si le morceau « zone » (panneau de la zone, formulaire du bâtiment) ne se charge pas,
 * l'éditeur le dit (role="alert") et demande de recharger la page, au lieu de laisser disparaître le panneau sans un mot.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre } from '../itineraires/test/outils.ts';
import type { ModuleEditeur } from './test/contrat.ts';
import { ecrireFermePlacement, FERME, UTILISATEUR } from './test/ferme-placement.ts';

vi.mock('./zone-ecran.tsx', () => {
  throw new Error('chargement impossible (test)');
});

let m: ModuleEditeur;
beforeAll(async () => {
  m = await import(/* @vite-ignore */ './index.ts');
});

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base?.fermer();
  vi.restoreAllMocks();
});

describe('T85 : morceau « zone » indisponible', () => {
  it('l’éditeur s’ouvre, dit qu’une partie n’a pas pu se charger et demande de recharger la page', async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermePlacement(base, { origine: true });
    const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => new Date('2026-10-26T08:00:00.000Z') });
    await act(async () => {
      racine.render(createElement(m.EditeurPlacement, { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true }));
      await Promise.resolve();
    });
    await attendre(() => document.querySelector('[role="alert"]')?.textContent.includes('n’a pas pu se charger') === true, 'message visible');
    expect(document.querySelector('[data-testid="editeur-placement"]')?.getAttribute('data-mode')).toBe('edition');
  });
});
