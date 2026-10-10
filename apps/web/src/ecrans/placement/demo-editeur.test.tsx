// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28i — l'éditeur de placement dans la démo : l'invitation « Essayez : ajoutez
 * une serre et posez-la sur la photo » (propriété `invitationDemo`), le fond neutre sans erreur hors
 * ligne, la photo et la recherche d'adresse en ligne. Hors démo (propriété absente), aucune
 * invitation : le texte n'existe pas dans l'appli de production. Contrat : ../../demo/test/contrat-placement.ts.
 * Parcours dans un vrai navigateur : e2e/demo-placement.e2e.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre } from '../itineraires/test/outils.ts';
import { TESTID_DEMO_PLACEMENT, TEXTE_INVITATION } from '../../demo/test/contrat-placement.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { NOM_CHAMP_ADRESSE } from './test/contrat-adresse.ts';
import { ecrireFermePlacement, FERME, UTILISATEUR, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-10T08:00:00.000Z');

type ProprietesDemo = ProprietesEditeurPlacement & { readonly invitationDemo?: boolean };

let m: ModuleEditeur;
let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
let erreursConsole: MockInstance<(...args: unknown[]) => void>;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch non prévu par ce test'))));
  erreursConsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  erreursConsole.mockRestore();
  base?.fermer();
  base = null;
});

async function ouvrir(demo: boolean | undefined, options: OptionsFermePlacement & { enLigne?: boolean; ordinateur?: boolean } = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, options);
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const proprietes: ProprietesDemo = {
    porte,
    fermeId: FERME,
    utilisateurId: UTILISATEUR,
    surFermer: () => undefined,
    ordinateur: options.ordinateur ?? true,
    enLigne: options.enLigne ?? true,
    ...(demo === undefined ? {} : { invitationDemo: demo }),
  };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement as (p: ProprietesDemo) => ReturnType<ModuleEditeur['EditeurPlacement']>, proprietes));
    await Promise.resolve();
  });
  await attendre(() => document.querySelector(`[data-testid="${T.editeur}"]`)?.getAttribute('data-mode') !== undefined, 'éditeur affiché');
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
const invitations = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${TESTID_DEMO_PLACEMENT.invitation}"]`)];

describe('T28i : invitation dans l’éditeur de la démo', () => {
  it('invitationDemo : « Essayez : ajoutez une serre et posez-la sur la photo », une seule fois, dans l’éditeur', async () => {
    await ouvrir(true, { origine: true });
    expect(invitations()).toHaveLength(1);
    expect(invitations()[0]?.textContent).toContain(TEXTE_INVITATION);
    expect(editeur()?.contains(invitations()[0] ?? null), 'l’invitation est dans l’éditeur').toBe(true);
  });

  it('invitationDemo : visible aussi au téléphone et sans point de départ', async () => {
    await ouvrir(true, { ordinateur: false });
    expect(invitations()).toHaveLength(1);
    expect(invitations()[0]?.textContent).toContain(TEXTE_INVITATION);
  });

  it('hors démo (propriété absente ou fausse) : aucune invitation', async () => {
    await ouvrir(undefined, { origine: true });
    expect(invitations()).toHaveLength(0);
    expect(editeur()?.textContent ?? '').not.toContain('Essayez');
  });

  it('hors démo, propriété fausse : aucune invitation', async () => {
    await ouvrir(false, { origine: true });
    expect(invitations()).toHaveLength(0);
  });
});

describe('T28i : fond de l’éditeur dans la démo', () => {
  it('en ligne : photo (tuiles), « © IGN », recherche d’adresse proposée', async () => {
    await ouvrir(true, { origine: true, enLigne: true });
    expect(editeur()?.getAttribute('data-fond')).toBe('photo');
    expect(document.querySelectorAll(`[data-testid="${T.tuile}"]`).length).toBeGreaterThan(0);
    expect(document.querySelector(`[data-testid="${T.mentionIgn}"]`)?.textContent).toContain('© IGN');
    expect(document.querySelector(`input[aria-label="${NOM_CHAMP_ADRESSE}"], [data-testid="recherche-adresse"]`)).not.toBeNull();
  });

  it('hors ligne : fond neutre et message, aucune tuile, aucune erreur, invitation toujours là', async () => {
    await ouvrir(true, { origine: true, enLigne: false });
    expect(editeur()?.getAttribute('data-fond')).toBe('neutre');
    expect(editeur()?.textContent).toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(document.querySelectorAll(`[data-testid="${T.tuile}"]`)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(erreursConsole).not.toHaveBeenCalled();
    expect(invitations()).toHaveLength(1);
  });
});
