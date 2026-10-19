// @vitest-environment happy-dom
/**
 * Test d'acceptation T47 (docs/backlog/T47-export-tache-longue.md, docs/mesures/T47.md) — le
 * changement d'onglet se dessine en transition.
 *
 * Mesuré (20 passages, CPU ×4) : au retour sur l'onglet Ferme pendant un export, le tap faisait
 * une tâche de 55 à 57 ms (rendu synchrone de l'écran du nouvel onglet, commit et mise en page
 * d'un bloc). Contrat : le choix d'un onglet dans la barre de navigation passe par
 * `startTransition` (rendu par tranches, interruptible) ; l'écran demandé s'affiche ensuite.
 *
 * Banc : celui d'App.creer-ferme.test.tsx (appli connectée, DOM simulé, écrans en doubles), avec
 * `startTransition` de React espionné.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLE_SESSION } from './connexion/session.ts';
import type { EtatDonnees, PoigneeDonnees } from './donnees/etat-appli.ts';


const transitions = vi.hoisted(() => ({ n: 0 }));
vi.mock('react', async (original) => {
  const reel = await original<typeof import('react')>();
  return {
    ...reel,
    startTransition: (f: () => void) => {
      transitions.n++;
      reel.startTransition(f);
    },
  };
});

const banc = vi.hoisted((): { surEtat: ((e: EtatDonnees) => void) | null; premier: EtatDonnees | null } => ({ surEtat: null, premier: null }));

vi.mock('./donnees/appli.ts', () => ({
  ouvrirDonneesAppli(_utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
    banc.surEtat = surEtat;
    const premier = banc.premier;
    if (premier !== null) {
      setTimeout(() => {
        surEtat(premier);
      }, 0);
    }
    return { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };
  },
}));

vi.mock('./ecrans/plan/index.ts', () => {
  function EcranPlanDouble() {
    return <h2 data-testid="planches-double">Plan des planches (double)</h2>;
  }
  return { default: EcranPlanDouble, EcranPlan: EcranPlanDouble, MARQUE_PLAN_AFFICHE: 'planif:plan-affiche', jourDuTelephone: () => '2026-10-16', prechargerPlan: () => Promise.resolve() };
});

vi.mock('./ecrans/aujourdhui/index.ts', () => {
  function EcranAujourdhuiDouble() {
    return <h2 data-testid="aujourdhui-double">Aujourd’hui (double)</h2>;
  }
  return { default: EcranAujourdhuiDouble };
});

vi.mock('./donnees/precharger.ts', () => ({ prechargerFerme: () => Promise.resolve() }));

vi.mock('./donnees/effacer.ts', async (original) => {
  const reel = await original<typeof import('./donnees/effacer.ts')>();
  return { ...reel, baseLocaleExiste: () => Promise.resolve(false), effacerDonneesLocales: () => Promise.resolve() };
});

const { App } = await import('./App.tsx');

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  localStorage.setItem(CLE_SESSION, JSON.stringify({ utilisateurId: MOI, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  localStorage.clear();
  banc.surEtat = null;
  banc.premier = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, delaiMs = 3_000): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await unTour();
  expect(condition(), message).toBe(true);
}

function onglet(libelle: string): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  return b;
}

function aller(libelle: string): void {
  act(() => {
    onglet(libelle).click();
  });
}

async function demarrer(premier: EtatDonnees): Promise<void> {
  banc.premier = premier;
  act(() => {
    racine.render(<App />);
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === premier.base, `base ${premier.base}`);
}

const PRETE: EtatDonnees = { base: 'prete', ferme: null, synchro: 'synchronise', enAttente: 0 };

describe('T47 : changement d’onglet en transition', () => {
  it('toucher « Planches » puis « Aujourd’hui » : chaque choix passe par startTransition, l’écran suit', async () => {
    await demarrer({ ...PRETE, base: 'ouverture' });
    await attendre(() => conteneur.querySelector('[data-testid="aujourdhui-double"]') !== null, 'Aujourd’hui affiché');
    const avant = transitions.n;
    aller('Planches');
    await attendre(() => conteneur.querySelector('[data-testid="planches-double"]') !== null, 'Planches affiché');
    expect(transitions.n - avant, 'choix de Planches en transition').toBeGreaterThanOrEqual(1);
    const ensuite = transitions.n;
    aller('Aujourd’hui');
    await attendre(() => conteneur.querySelector('[data-testid="aujourdhui-double"]') !== null, 'Aujourd’hui de nouveau');
    expect(transitions.n - ensuite, 'choix d’Aujourd’hui en transition').toBeGreaterThanOrEqual(1);
    expect(onglet('Aujourd’hui').getAttribute('aria-current')).toBe('page');
  });
});
