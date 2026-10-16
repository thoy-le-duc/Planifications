// @vitest-environment happy-dom
/**
 * Tests d'acceptation T39 — la coquille propose « Créer ma ferme » quand la base est ouverte
 * sans aucune ferme (docs/backlog/T39-creer-sa-ferme.md).
 *
 * Contrat : base 'sans-ferme' → l'écran de création (src/ecrans/creer-ferme/EcranCreerFerme.tsx,
 * chargé à la demande, [data-testid="creer-ferme"]) sur les onglets Aujourd'hui et Planches, et
 * en tête de l'onglet Ferme (l'export et la déconnexion restent dessous). Il reçoit l'état de la
 * synchro de la coquille. Base 'ouverture', 'echec' ou 'prete' : jamais cet écran (un compte qui
 * a déjà une ferme ne le voit pas). Quand la ferme arrive (base 'prete'), l'écran de la ferme
 * prend sa place, sans rechargement.
 *
 * Banc : l'appli entière, connectée, DOM simulé (comme App.refus.test.tsx) ; l'ouverture de la
 * base est un double qui publie les états qu'on lui donne ; Planches et Aujourd'hui sont des
 * doubles.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync';
import { CLE_SESSION } from './connexion/session.ts';
import type { EtatDonnees, PoigneeDonnees } from './donnees/etat-appli.ts';

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
const FERME = '0192f0c1-13f1-7000-8000-0000000000f9';
const SANS_FERME: EtatDonnees = { base: 'sans-ferme', ferme: null, synchro: 'synchronise', enAttente: 0 };

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

async function laisserPasser(ms = 200): Promise<void> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) await unTour();
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

const creation = () => conteneur.querySelector<HTMLElement>('[data-testid="creer-ferme"]');
const boutonCreer = () => [...conteneur.querySelectorAll('button')].find((b) => b.textContent.includes('Créer ma ferme')) ?? null;

async function demarrer(premier: EtatDonnees): Promise<void> {
  banc.premier = premier;
  act(() => {
    racine.render(<App />);
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === premier.base, `base ${premier.base}`);
}

describe('T39 — « Créer ma ferme » dans la coquille', () => {
  it('sans ferme, en ligne : proposé sur Aujourd’hui, Planches et Ferme', async () => {
    await demarrer(SANS_FERME);
    await attendre(() => boutonCreer() !== null, 'Aujourd’hui propose « Créer ma ferme »');
    expect(creation()?.getAttribute('data-etat')).toBe('formulaire');

    aller('Planches');
    await attendre(() => boutonCreer() !== null, 'Planches propose « Créer ma ferme »');

    aller('Ferme');
    await attendre(() => boutonCreer() !== null, 'Ferme propose « Créer ma ferme »');
    // L'écran Ferme reste dessous : la déconnexion est toujours possible.
    await attendre(() => [...conteneur.querySelectorAll('button')].some((b) => b.textContent.includes('Se déconnecter')), 'Se déconnecter toujours là');
  });

  it('l’écran reçoit l’état de la synchro : première synchro pas finie → pas de bouton', async () => {
    await demarrer({ ...SANS_FERME, synchro: 'connexion' });
    await attendre(() => creation() !== null, 'écran de création');
    expect(creation()?.getAttribute('data-etat')).toBe('premiere-synchro');
    expect(boutonCreer()).toBeNull();
    act(() => {
      banc.surEtat?.({ ...SANS_FERME, synchro: 'synchronise' });
    });
    await attendre(() => boutonCreer() !== null, 'formulaire après la première synchro');
  });

  it.each(['ouverture', 'echec'] as const)('base « %s » : jamais l’écran de création', async (base) => {
    await demarrer({ ...SANS_FERME, base });
    await laisserPasser();
    expect(creation()).toBeNull();
    aller('Planches');
    await laisserPasser();
    expect(creation()).toBeNull();
  });

  it('ferme déjà là (base prête) : jamais l’écran de création', async () => {
    await demarrer({ base: 'prete', ferme: { porte: {} as PorteDonnees, fermeId: FERME }, synchro: 'synchronise', enAttente: 0 });
    await attendre(() => conteneur.querySelector('[data-testid="aujourdhui-double"]') !== null, 'Aujourd’hui');
    await laisserPasser();
    expect(creation()).toBeNull();
  });

  it('la ferme arrive par la synchro : l’écran de la ferme prend la place, sans rechargement', async () => {
    await demarrer(SANS_FERME);
    await attendre(() => creation() !== null, 'écran de création');
    act(() => {
      banc.surEtat?.({ base: 'prete', ferme: { porte: {} as PorteDonnees, fermeId: FERME }, synchro: 'synchronise', enAttente: 0 });
    });
    await attendre(() => conteneur.querySelector('[data-testid="aujourdhui-double"]') !== null, 'Aujourd’hui de la ferme');
    expect(creation()).toBeNull();
  });
});
