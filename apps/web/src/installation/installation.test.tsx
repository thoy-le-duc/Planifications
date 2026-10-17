// @vitest-environment happy-dom
/**
 * Tests d'acceptation T40 — proposer l'installation de l'appli (docs/backlog/T40-installer-appli.md).
 *
 * ── Contrat ──
 *   - `src/installation/capture.ts` : module à effet, importé par src/main.tsx (JavaScript de
 *     démarrage). Il écoute `beforeinstallprompt` sur window dès le chargement, appelle
 *     `preventDefault()` et range l'événement dans `window.__planifInvitation` (rien d'autre au
 *     démarrage : quelques octets).
 *   - `src/installation/CarteInstallation.tsx`, export `CarteInstallation` (sans propriétés) : une
 *     section « Installer sur ce téléphone » (aria-label) avec un bouton « Installer l’appli »,
 *     montrée seulement si l'appli peut s'installer :
 *       · invitation retenue (Android / Chrome) : un tap appelle `prompt()` une fois ; après
 *         `appinstalled`, la carte disparaît ;
 *       · iPhone / iPad (Safari, pas d'API) : un tap ouvre une aide (role="dialog", chargée à la
 *         demande) qui dit « Partager » puis « Sur l’écran d’accueil », et se ferme ;
 *       · jamais si l'appli tourne déjà installée (`(display-mode: standalone)` ou
 *         `navigator.standalone === true`), ni sans moyen d'installer (ordinateur, autre navigateur).
 *   - `src/installation/BandeauInstallation.tsx`, export `BandeauInstallation({ enSaisie })` : un
 *     bandeau discret (data-testid="bandeau-installation") avec le même bouton « Installer l’appli »
 *     et un bouton « Fermer » (nom accessible commençant par « Fermer ») ; mêmes conditions que la
 *     carte, plus : jamais pendant une saisie (`enSaisie` vrai), et une fois fermé (ou une fois
 *     l'installation demandée), il ne revient plus sur ce téléphone (localStorage).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('T40 : capture de beforeinstallprompt au démarrage', () => {
  it('l’événement est retenu (preventDefault) et rangé dans window.__planifInvitation', () => {
    const e = invitation();
    window.dispatchEvent(e);
    expect(e.defaultPrevented, 'pas de mini-barre du navigateur : l’appli propose elle-même').toBe(true);
    expect((window as unknown as { __planifInvitation?: Event }).__planifInvitation).toBe(e);
  });

  it('main.tsx importe la capture (JavaScript de démarrage)', () => {
    // Chemin par le dossier du test : sous happy-dom, `URL` n'est pas celui de Node (fileURLToPath le refuse).
    const main = readFileSync(join(import.meta.dirname, '..', 'main.tsx'), 'utf8');
    expect(main).toMatch(/import\s+'\.\/installation\/capture\.ts'/);
  });
});

describe('T40 : Android / Chrome, invitation retenue', () => {
  it('invitation retenue AVANT la carte → bouton visible → tap → prompt() une fois ; appinstalled → la carte disparaît', async () => {
    const e = invitation();
    window.dispatchEvent(e);
    await rendre(createElement(carte.CarteInstallation));
    expect(sectionCarte(), 'carte « Installer sur ce téléphone »').not.toBeNull();
    const b = boutonInstaller(sectionCarte());
    expect(b, 'bouton « Installer l’appli »').toBeDefined();
    await act(async () => {
      b?.click();
      await Promise.resolve();
    });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    // Un second tap ne rappelle pas prompt() sur la même invitation (le navigateur le refuserait).
    const encore = boutonInstaller(sectionCarte());
    await act(async () => {
      encore?.click();
      await Promise.resolve();
    });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await emettre(new Event('appinstalled'));
    await attendre(() => sectionCarte() === null, 'carte disparue après appinstalled');
  });

  it('invitation arrivée APRÈS l’affichage : la carte apparaît', async () => {
    await rendre(createElement(carte.CarteInstallation));
    expect(sectionCarte(), 'Android sans invitation : rien à proposer').toBeNull();
    await emettre(invitation());
    await attendre(() => boutonInstaller(sectionCarte()) !== undefined, 'carte et bouton après beforeinstallprompt');
  });

  it('ordinateur sans invitation : ni carte ni bandeau', async () => {
    surNavigateur(UA_ORDINATEUR);
    await rendre(
      createElement('div', null, createElement(carte.CarteInstallation), createElement(bandeauM.BandeauInstallation, { enSaisie: false })),
    );
    expect(sectionCarte()).toBeNull();
    expect(leBandeau()).toBeNull();
  });
});

describe('T40 : iPhone / Safari (pas d’API)', () => {
  it('le bouton ouvre l’aide « Partager → Sur l’écran d’accueil », qui se ferme', async () => {
    surNavigateur(UA_IPHONE, { standaloneIos: false });
    await rendre(createElement(carte.CarteInstallation));
    const b = boutonInstaller(sectionCarte());
    expect(b, 'bouton « Installer l’appli » sur iPhone').toBeDefined();
    await act(async () => {
      b?.click();
      await Promise.resolve();
    });
    await attendre(() => aide() !== null, 'aide ouverte (chargée à la demande)');
    const texte = aide()?.textContent ?? '';
    expect(texte).toMatch(/Partager/);
    expect(texte).toMatch(/Sur l[’']écran d[’']accueil/);
    const fermer = boutonFermer(aide()) ?? [...(aide()?.querySelectorAll('button') ?? [])].at(-1);
    await act(async () => {
      fermer?.click();
      await Promise.resolve();
    });
    await attendre(() => aide() === null, 'aide fermée');
  });

  it('iPad (iPadOS se dit Mac, écran tactile) : même aide', async () => {
    surNavigateur(UA_IPHONE.replace('iPhone; CPU iPhone OS 18_5 like Mac OS X', 'Macintosh; Intel Mac OS X 10_15_7'), {
      standaloneIos: false,
      pointsTactiles: 5,
      plateforme: 'MacIntel',
    });
    await rendre(createElement(carte.CarteInstallation));
    expect(boutonInstaller(sectionCarte())).toBeDefined();
  });
});

describe('T40 : appli déjà installée → ni carte ni bandeau', () => {
  it('Android, display-mode standalone, même avec une invitation', async () => {
    standalone = true;
    window.dispatchEvent(invitation());
    await rendre(
      createElement('div', null, createElement(carte.CarteInstallation), createElement(bandeauM.BandeauInstallation, { enSaisie: false })),
    );
    expect(sectionCarte()).toBeNull();
    expect(leBandeau()).toBeNull();
  });

  it('iPhone, navigator.standalone', async () => {
    surNavigateur(UA_IPHONE, { standaloneIos: true });
    await rendre(
      createElement('div', null, createElement(carte.CarteInstallation), createElement(bandeauM.BandeauInstallation, { enSaisie: false })),
    );
    expect(sectionCarte()).toBeNull();
    expect(leBandeau()).toBeNull();
  });
});

describe('T40 : bandeau d’Aujourd’hui', () => {
  it('visible avec une invitation ; jamais pendant une saisie', async () => {
    window.dispatchEvent(invitation());
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: true }));
    expect(leBandeau(), 'saisie en cours : pas de bandeau').toBeNull();
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: false }));
    expect(leBandeau(), 'au repos : bandeau').not.toBeNull();
    expect(boutonInstaller(leBandeau())).toBeDefined();
  });

  it('fermé → ne revient pas, même après rechargement de l’appli', async () => {
    window.dispatchEvent(invitation());
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: false }));
    const fermer = boutonFermer(leBandeau());
    expect(fermer, 'bouton « Fermer »').toBeDefined();
    await act(async () => {
      fermer?.click();
      await Promise.resolve();
    });
    expect(leBandeau()).toBeNull();
    act(() => {
      racine.unmount();
    });
    // Rechargement de l'appli : modules neufs, nouvelle invitation, même téléphone (localStorage).
    vi.resetModules();
    Reflect.deleteProperty(window, '__planifInvitation');
    await import('./capture.ts');
    const neuf = (await import('./BandeauInstallation.tsx')) as unknown as ModuleBandeau;
    window.dispatchEvent(invitation());
    racine = createRoot(conteneur);
    await rendre(createElement(neuf.BandeauInstallation, { enSaisie: false }));
    expect(leBandeau(), 'bandeau fermé une fois : plus jamais').toBeNull();
  });

  it('installer depuis le bandeau : prompt() une fois, puis le bandeau ne revient plus', async () => {
    const e = invitation('dismissed');
    window.dispatchEvent(e);
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: false }));
    const b = boutonInstaller(leBandeau());
    await act(async () => {
      b?.click();
      await Promise.resolve();
    });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await attendre(() => leBandeau() === null, 'bandeau retiré après la demande d’installation');
    window.dispatchEvent(invitation());
    await rendre(createElement(bandeauM.BandeauInstallation, { enSaisie: false }));
    expect(leBandeau()).toBeNull();
  });
});
