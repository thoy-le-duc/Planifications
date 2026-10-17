// @vitest-environment happy-dom
/**
 * Tests d'acceptation T40 — la carte « Installer sur ce téléphone » dans l'onglet Ferme
 * (docs/backlog/T40-installer-appli.md). Comportement détaillé : src/installation/installation.test.tsx.
 *
 * ── Contrat ──
 *   - L'écran Ferme montre la carte (section aria-label « Installer sur ce téléphone », bouton
 *     « Installer l’appli ») quand une invitation `beforeinstallprompt` est retenue
 *     (src/installation/capture.ts) ; un tap appelle `prompt()` une fois.
 *   - Appli déjà installée (display-mode standalone) : pas de carte.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { PoigneeDonnees } from '../../donnees/etat-appli.ts';

vi.mock('../../donnees/effacer.ts', async (original) => ({
  ...(await original<typeof import('../../donnees/effacer.ts')>()),
  baseLocaleExiste: () => Promise.resolve(true),
}));

interface ModuleEcranFerme {
  readonly default: (props: {
    session: SessionConnexion;
    baseLocale: PoigneeDonnees;
    surDeconnecte: (e: string | null) => void;
    etatBase: 'ouverture' | 'sans-ferme' | 'prete' | 'echec';
  }) => ReturnType<typeof createElement>;
}

const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

let m: ModuleEcranFerme;
let conteneur: HTMLDivElement;
let racine: Root;
let standalone = false;

function invitation(): Event & { prompt: ReturnType<typeof vi.fn> } {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
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
  m = await import('./EcranFerme.tsx');
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function rendre(): Promise<void> {
  const porte = { surveillerRefus: (rappel: (r: never[]) => void) => (rappel([]), () => undefined), archiverRefus: () => Promise.resolve() } as unknown as PorteDonnees;
  const baseLocale: PoigneeDonnees = { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };
  await act(async () => {
    racine.render(
      createElement(
        ContexteFerme,
        { value: { porte, fermeId: '0192f0c1-7a6e-7cc3-a000-000000000001' } },
        createElement(m.default, { session: SESSION, baseLocale, surDeconnecte: () => undefined, etatBase: 'prete' }),
      ),
    );
    await Promise.resolve();
  });
  for (let k = 0; k < 5; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const carte = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('section[aria-label="Installer sur ce téléphone"]');
const bouton = (): HTMLButtonElement | undefined =>
  [...(carte()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => /^Installer l[’']appli$/.test((b.getAttribute('aria-label') ?? b.textContent).trim()));

describe('T40 : onglet Ferme, carte « Installer sur ce téléphone »', () => {
  it('invitation retenue : carte et bouton ; tap → prompt() une fois', async () => {
    const e = invitation();
    window.dispatchEvent(e);
    await rendre();
    expect(carte(), 'carte dans l’onglet Ferme').not.toBeNull();
    await act(async () => {
      bouton()?.click();
      await Promise.resolve();
    });
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it('appli déjà installée : pas de carte', async () => {
    standalone = true;
    window.dispatchEvent(invitation());
    await rendre();
    expect(conteneur.querySelector('section[aria-label="Apparence"]'), 'écran Ferme dessiné').not.toBeNull();
    expect(carte()).toBeNull();
  });
});
