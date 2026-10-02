// @vitest-environment happy-dom
/**
 * Tests d'acceptation T18 — le réglage « Apparence » de l'onglet Ferme (docs/backlog/T18-mode-sombre.md).
 *
 * ── Contrat (ecrans/ferme/EcranFerme.tsx ; logique dans ui/theme.ts, voir ui/theme.test.ts) ──
 *   - Une section « Apparence » (intitulé h2, comme « Mes données ») avec trois choix exclusifs,
 *     de rôle radio (<input type="radio"> ou role="radio"), dans un groupe (role="radiogroup" ou
 *     <fieldset>) nommé « Apparence » : « Comme le téléphone » (défaut), « Clair », « Sombre ».
 *   - Un seul est coché (checked ou aria-checked="true") : celui du stockage (clé planif.theme),
 *     « Comme le téléphone » si rien ou valeur inconnue.
 *   - Un tap sur un choix : document.documentElement.dataset.theme vaut 'clair' ou 'sombre' (absent
 *     pour « Comme le téléphone »), le choix est mémorisé dans localStorage 'planif.theme'
 *     (supprimé pour « Comme le téléphone »), et le choix coché change.
 *   - Cibles d'au moins 56 px : vérifié dans le vrai navigateur (e2e/theme.e2e.ts).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const CHEMIN_MODULE = './EcranFerme.tsx';
const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};
const CHOIX = ['Comme le téléphone', 'Clair', 'Sombre'] as const;

let m: ModuleEcranFerme;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranFerme;
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#1F4D3A">';
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

function choix(nom: string): HTMLElement {
  const trouves = [...conteneur.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]')].filter((e) => {
    const etiquette = e.getAttribute('aria-label') ?? (e instanceof HTMLInputElement ? (e.labels?.[0]?.textContent ?? '') : e.textContent);
    return etiquette.trim() === nom;
  });
  expect(trouves, `un seul choix « ${nom} »`).toHaveLength(1);
  const [premier] = trouves;
  if (premier === undefined) throw new Error(`choix « ${nom} » introuvable`);
  return premier;
}

function coche(e: HTMLElement): boolean {
  return e instanceof HTMLInputElement ? e.checked : e.getAttribute('aria-checked') === 'true';
}

function cochesNoms(): string[] {
  return CHOIX.filter((nom) => coche(choix(nom)));
}

async function toucher(nom: string): Promise<void> {
  await act(async () => {
    choix(nom).click();
    await Promise.resolve();
  });
}

describe('T18 : « Apparence » dans l’onglet Ferme', () => {
  it('une section « Apparence » avec un groupe nommé et trois choix, « Comme le téléphone » coché par défaut', async () => {
    await rendre();
    expect(conteneur.textContent).toMatch(/Apparence/);
    const groupe = [...conteneur.querySelectorAll('[role="radiogroup"], fieldset')].find((g) => (g.getAttribute('aria-label') ?? g.querySelector('legend')?.textContent ?? '').trim() === 'Apparence' || g.getAttribute('aria-labelledby') !== null);
    expect(groupe, 'groupe de choix nommé « Apparence »').toBeDefined();
    for (const nom of CHOIX) choix(nom);
    expect(cochesNoms()).toEqual(['Comme le téléphone']);
  });

  it('le choix mémorisé est coché à l’ouverture ; valeur inconnue → « Comme le téléphone »', async () => {
    localStorage.setItem('planif.theme', 'sombre');
    await rendre();
    expect(cochesNoms()).toEqual(['Sombre']);
    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    localStorage.setItem('planif.theme', 'noir');
    await rendre();
    expect(cochesNoms()).toEqual(['Comme le téléphone']);
  });

  it('« Sombre » : data-theme="sombre", mémorisé, coché seul', async () => {
    await rendre();
    await toucher('Sombre');
    expect(document.documentElement.dataset.theme).toBe('sombre');
    expect(localStorage.getItem('planif.theme')).toBe('sombre');
    expect(cochesNoms()).toEqual(['Sombre']);
  });

  it('« Clair » puis « Comme le téléphone » : data-theme="clair", puis attribut et mémoire retirés', async () => {
    await rendre();
    await toucher('Clair');
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(localStorage.getItem('planif.theme')).toBe('clair');
    expect(cochesNoms()).toEqual(['Clair']);
    await toucher('Comme le téléphone');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('planif.theme')).toBeNull();
    expect(cochesNoms()).toEqual(['Comme le téléphone']);
  });

  it('stockage qui lève : le choix s’applique quand même, sans erreur', async () => {
    const erreurs = vi.spyOn(console, 'error');
    await rendre();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    await toucher('Sombre');
    expect(document.documentElement.dataset.theme).toBe('sombre');
    expect(erreurs).not.toHaveBeenCalled();
  });
});
