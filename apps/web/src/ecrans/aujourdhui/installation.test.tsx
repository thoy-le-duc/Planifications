// @vitest-environment happy-dom
/**
 * Tests d'acceptation T40 — le bandeau d'installation sur Aujourd'hui (docs/backlog/T40-installer-appli.md).
 * Comportement détaillé du bandeau : src/installation/installation.test.tsx.
 *
 * ── Contrat ──
 *   - Invitation `beforeinstallprompt` retenue (src/installation/capture.ts) : l'écran Aujourd'hui
 *     montre le bandeau (data-testid="bandeau-installation").
 *   - Jamais pendant une saisie : dialogue « Noter une récolte » ouvert, bandeau « Annuler »
 *     affiché, écriture en cours. Le dialogue refermé, le bandeau revient (tant qu'il n'a pas été
 *     fermé).
 *   - Appli déjà installée : pas de bandeau.
 *
 * Banc : la ferme du jour (./test/ferme-du-jour.ts), base mémoire.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';

interface ModuleAujourdhui {
  readonly EcranAujourdhui: (p: { porte: unknown; fermeId: string; aujourdhui: () => string }) => ReturnType<typeof createElement>;
}

let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;
let ecran: ModuleAujourdhui;
let standalone = false;

function invitation(): Event {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return e;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  Reflect.deleteProperty(window, '__planifInvitation');
  localStorage.clear();
  standalone = false;
  window.matchMedia = ((requete: string) =>
    ({
      matches: standalone && requete.includes('standalone'),
      media: requete,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }) as unknown as MediaQueryList);
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    configurable: true,
  });
  await import('../../installation/capture.ts');
  ecran = (await import('./index.ts')) as unknown as ModuleAujourdhui;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  for (let k = 0; k < 400 && !condition(); k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(condition(), message).toBe(true);
}

async function rendre(): Promise<void> {
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  await act(async () => {
    racine.render(createElement(ecran.EcranAujourdhui, { porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI }));
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="tache"]') !== null, 'tâches dessinées');
}

const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="bandeau-installation"]');
const boutonNommé = (re: RegExp): HTMLButtonElement | undefined =>
  [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test((b.getAttribute('aria-label') ?? b.textContent).trim()));

describe('T40 : bandeau d’installation sur Aujourd’hui', () => {
  it('invitation retenue : bandeau ; dialogue de récolte ouvert : pas de bandeau ; refermé : il revient', async () => {
    window.dispatchEvent(invitation());
    await rendre();
    await attendre(() => bandeau() !== null, 'bandeau d’installation affiché');

    await act(async () => {
      boutonNommé(/Noter une récolte/)?.click();
      await Promise.resolve();
    });
    await attendre(() => conteneur.querySelector('[role="dialog"]') !== null, 'dialogue de récolte ouvert');
    expect(bandeau(), 'jamais pendant une saisie').toBeNull();

    await act(async () => {
      boutonNommé(/^Retour$/)?.click();
      await Promise.resolve();
    });
    await attendre(() => conteneur.querySelector('[role="dialog"]') === null, 'dialogue refermé');
    await attendre(() => bandeau() !== null, 'bandeau revenu, jamais fermé');
  });

  it('appli déjà installée : pas de bandeau', async () => {
    standalone = true;
    window.dispatchEvent(invitation());
    await rendre();
    for (let k = 0; k < 5; k++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(bandeau()).toBeNull();
  });
});
