// @vitest-environment happy-dom
/**
 * Tests d'acceptation T40b — le bouton d'installation revient après un refus
 * (docs/backlog/T40b-installer-suites.md). Mêmes contrats que T40 (installation.test.tsx).
 *   - refus (`userChoice.outcome === 'dismissed'`) : la carte reste ; le tap ouvre une aide
 *     Android (role="dialog", « ⋮ » puis « Installer l’application ») ; un nouvel
 *     `beforeinstallprompt` reprend la main (le tap rouvre la fenêtre du navigateur) ;
 *   - acceptation (`accepted`, ou `appinstalled`) : la carte disparaît ;
 *   - bandeau d'Aujourd'hui : reste fermé après un tap sur « Installer ».
 */
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Invitation extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface ModuleCarte {
  readonly CarteInstallation: () => ReactNode;
}
interface ModuleBandeau {
  readonly BandeauInstallation: (p: { readonly enSaisie: boolean }) => ReactNode;
}

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const UA_ORDINATEUR = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

let conteneur: HTMLDivElement;
let racine: Root;
let carte: ModuleCarte;
let bandeauM: ModuleBandeau;
let standalone = false;

function surNavigateur(ua: string, options: { readonly standaloneIos?: boolean; readonly pointsTactiles?: number; readonly plateforme?: string } = {}): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: options.pointsTactiles ?? (ua === UA_ORDINATEUR ? 0 : 5), configurable: true });
  Object.defineProperty(navigator, 'platform', { value: options.plateforme ?? (ua === UA_IPHONE ? 'iPhone' : 'Linux armv8l'), configurable: true });
  if (options.standaloneIos === undefined) Reflect.deleteProperty(navigator, 'standalone');
  else Object.defineProperty(navigator, 'standalone', { value: options.standaloneIos, configurable: true });
}

function invitation(issue: 'accepted' | 'dismissed' = 'accepted'): Invitation {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Invitation;
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome: issue, platform: 'web' });
  return e;
}

async function rendre(element: ReactElement): Promise<void> {
  await act(async () => {
    racine.render(element);
    await Promise.resolve();
  });
}

async function attendre(condition: () => boolean, message: string): Promise<void> {
  for (let k = 0; k < 200 && !condition(); k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(condition(), message).toBe(true);
}

async function emettre(e: Event): Promise<void> {
  await act(async () => {
    window.dispatchEvent(e);
    await Promise.resolve();
  });
}

const sectionCarte = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('section[aria-label="Installer sur ce téléphone"]');
const leBandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="bandeau-installation"]');
const boutonInstaller = (dans: ParentNode | null = conteneur): HTMLButtonElement | undefined =>
  [...(dans?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => /^Installer l[’']appli$/.test((b.getAttribute('aria-label') ?? b.textContent).trim()));
const boutonFermer = (dans: ParentNode | null): HTMLButtonElement | undefined =>
  [...(dans?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => (b.getAttribute('aria-label') ?? b.textContent).trim().startsWith('Fermer'));
const aide = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

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
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  surNavigateur(UA_ANDROID);
  await import('./capture.ts');
  carte = await import('./CarteInstallation.tsx');
  bandeauM = await import('./BandeauInstallation.tsx');
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  document.body.innerHTML = '';
});

async function toucher(b: HTMLButtonElement | undefined): Promise<void> {
  expect(b, 'bouton « Installer l’appli »').toBeDefined();
  await act(async () => {
    b?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('T40b : refus de la fenêtre du navigateur', () => {
  it('refus → carte toujours là, le tap montre l’aide Android ; nouvel beforeinstallprompt → le tap rouvre la fenêtre', async () => {
    const premiere = invitation('dismissed');
    window.dispatchEvent(premiere);
    await rendre(createElement(carte.CarteInstallation));
    await toucher(boutonInstaller(sectionCarte()));
    expect(premiere.prompt).toHaveBeenCalledTimes(1);
    await attendre(() => sectionCarte() !== null && boutonInstaller(sectionCarte()) !== undefined, 'carte et bouton toujours là après le refus');
    expect(aide(), 'pas d’aide avant le tap').toBeNull();

    await toucher(boutonInstaller(sectionCarte()));
    expect(premiere.prompt, 'une invitation ne sert qu’une fois').toHaveBeenCalledTimes(1);
    await attendre(() => aide() !== null, 'aide Android ouverte');
    const texte = aide()?.textContent ?? '';
    expect(texte).toMatch(/⋮/);
    expect(texte).toMatch(/Installer l[’']application/);
    const fermer = boutonFermer(aide()) ?? [...(aide()?.querySelectorAll('button') ?? [])].at(-1);
    await act(async () => {
      fermer?.click();
      await Promise.resolve();
    });
    await attendre(() => aide() === null, 'aide fermée');
    expect(sectionCarte(), 'la carte reste après l’aide').not.toBeNull();

    const seconde = invitation('accepted');
    await emettre(seconde);
    await toucher(boutonInstaller(sectionCarte()));
    expect(seconde.prompt, 'nouvelle invitation : la fenêtre du navigateur rouvre').toHaveBeenCalledTimes(1);
    expect(aide(), 'pas d’aide quand l’invitation a la main').toBeNull();
  });

  it('refus puis appinstalled → la carte disparaît', async () => {
    window.dispatchEvent(invitation('dismissed'));
    await rendre(createElement(carte.CarteInstallation));
    await toucher(boutonInstaller(sectionCarte()));
    await attendre(() => sectionCarte() !== null, 'carte après refus');
    await emettre(new Event('appinstalled'));
    await attendre(() => sectionCarte() === null, 'carte disparue');
  });

  it('bandeau : refus → reste fermé, ne revient pas', async () => {
    window.dispatchEvent(invitation('dismissed'));
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: false }));
    await toucher(boutonInstaller(leBandeau()));
    await attendre(() => leBandeau() === null, 'bandeau retiré');
    await emettre(invitation('dismissed'));
    expect(leBandeau()).toBeNull();
  });
});

describe('T40b : acceptation', () => {
  it('accepted (sans appinstalled) → carte cachée', async () => {
    const e = invitation('accepted');
    window.dispatchEvent(e);
    await rendre(createElement(carte.CarteInstallation));
    await toucher(boutonInstaller(sectionCarte()));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await attendre(() => sectionCarte() === null, 'carte cachée après acceptation');
    expect(aide()).toBeNull();
  });
});
