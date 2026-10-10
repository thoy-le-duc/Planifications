// @vitest-environment happy-dom
/**
 * Relecture T15e (B2) — un export en arrière-plan ne survit pas à un changement de ferme active
 * (Q25 : rien d'une ferme ne sort chez quelqu'un qui n'en fait plus partie).
 *   - export de la ferme A en cours, l'appli publie la porte de la ferme B (adhésion retirée,
 *     ferme supprimée : suivreFermeActive) → export annulé, aucun téléchargement ensuite ;
 *   - la porte de la ferme A republiée (même ferme, nouvel objet) → l'export continue et se
 *     télécharge, une fois.
 * Même banc que App.export-arriere-plan.test.tsx ; le double de ./donnees/appli.ts garde
 * `surEtat` pour publier un nouvel état en cours de test.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { CLE_SESSION } from './connexion/session.ts';
import type { EtatDonnees, PoigneeDonnees } from './donnees/etat-appli.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './ecrans/aujourdhui/test/ferme-du-jour.ts';

interface Banc {
  porte: PorteDonnees | null;
  surEtat: ((e: EtatDonnees) => void) | null;
}
const banc = vi.hoisted((): Banc => ({ porte: null, surEtat: null }));

vi.mock('./donnees/appli.ts', () => ({
  ouvrirDonneesAppli(_utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
    const porte = banc.porte;
    if (porte === null) throw new Error('banc : porte absente');
    banc.surEtat = surEtat;
    setTimeout(() => {
      surEtat({ base: 'prete', ferme: { porte, fermeId: FERME }, synchro: 'hors-ligne', enAttente: 0 });
    }, 0);
    return { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };
  },
}));

vi.mock('./ecrans/plan/index.ts', () => {
  function EcranPlanDouble() {
    return <h2 data-testid="planches-double">Plan des planches (double)</h2>;
  }
  return { default: EcranPlanDouble, EcranPlan: EcranPlanDouble, MARQUE_PLAN_AFFICHE: 'planif:plan-affiche', jourDuTelephone: () => '2026-09-30', prechargerPlan: () => Promise.resolve() };
});

vi.mock('./ecrans/aujourdhui/index.ts', () => {
  function EcranAujourdhuiDouble() {
    return <h2 data-testid="aujourdhui-double">Aujourd’hui (double)</h2>;
  }
  return {
    default: EcranAujourdhuiDouble,
    EcranAujourdhui: EcranAujourdhuiDouble,
    MARQUE_AUJOURDHUI_AFFICHE: 'planif:aujourdhui-affiche',
    jourDuTelephone: () => '2026-09-30',
    prechargerJournee: () => Promise.resolve(),
  };
});

const { App } = await import('./App.tsx');

const FERME_B = '0192f0c1-7a6e-7cc3-a000-0000000000bb';

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;
const lectures = { appels: 0, permis: 0 };
let clics: HTMLAnchorElement[];
const createObjectURLReel = URL.createObjectURL.bind(URL);
const revokeReel = URL.revokeObjectURL.bind(URL);

function porteControlee(reelle: PorteDonnees): PorteDonnees {
  return {
    ...reelle,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]) => {
      lectures.appels++;
      while (lectures.permis <= 0) await new Promise((r) => setTimeout(r, 1));
      if (Number.isFinite(lectures.permis)) lectures.permis--;
      return reelle.lire<T>(sql, parametres);
    },
  };
}

function porteDe(fermeId: string): PorteDonnees {
  return porteControlee(creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> }));
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, jourLocal(new Date()));
  banc.porte = porteDe(FERME);
  banc.surEtat = null;
  lectures.appels = 0;
  lectures.permis = 0;
  clics = [];
  URL.createObjectURL = () => 'blob:planif-test';
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download')) clics.push(this);
  });
  localStorage.setItem(
    CLE_SESSION,
    JSON.stringify({ utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
});

afterEach(() => {
  lectures.permis = Number.POSITIVE_INFINITY;
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  localStorage.clear();
  base.fermer();
  banc.porte = null;
  banc.surEtat = null;
  URL.createObjectURL = createObjectURLReel;
  URL.revokeObjectURL = revokeReel;
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

async function laisserPasser(ms = 150): Promise<void> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) await unTour();
}

async function aller(libelle: string): Promise<void> {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="export-bandeau"]');
const boutonExporter = (): HTMLButtonElement | undefined =>
  [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => /exporter toute ma ferme|export en cours/i.test(b.textContent));

async function lancerExportPuisAujourdhui(): Promise<void> {
  await act(async () => {
    racine.render(<App />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === 'prete', 'base « prête »');
  await aller('Ferme');
  await attendre(() => boutonExporter() !== undefined && !boutonExporter()?.disabled, 'bouton d’export actif');
  await act(async () => {
    boutonExporter()?.click();
    await Promise.resolve();
  });
  await attendre(() => lectures.appels > 0, 'l’export a commencé à lire la base');
  await aller('Aujourd’hui');
  await attendre(() => bandeau() !== null, 'bandeau « Export en cours »');
}

async function publier(porte: PorteDonnees, fermeId: string): Promise<void> {
  const surEtat = banc.surEtat;
  if (surEtat === null) throw new Error('banc : surEtat absent');
  await act(async () => {
    surEtat({ base: 'prete', ferme: { porte, fermeId }, synchro: 'hors-ligne', enAttente: 0 });
    await Promise.resolve();
  });
  await unTour();
}

describe('T15e (relecture B2) : export en arrière-plan et ferme active', () => {
  it('une autre ferme devient active pendant l’export : export annulé, aucun téléchargement', async () => {
    await lancerExportPuisAujourdhui();
    await publier(porteDe(FERME_B), FERME_B);
    await attendre(() => !(bandeau()?.textContent ?? '').includes('Export en cours'), 'bandeau « en cours » retiré');
    lectures.permis = Number.POSITIVE_INFINITY;
    await laisserPasser(400);
    expect(clics, 'rien de la ferme A ne sort après le changement de ferme').toHaveLength(0);
  });

  it('la porte de la même ferme est republiée : l’export continue et se télécharge une fois', async () => {
    await lancerExportPuisAujourdhui();
    await publier(porteDe(FERME), FERME);
    expect(bandeau()?.textContent ?? '').toMatch(/Export en cours/);
    lectures.permis = Number.POSITIVE_INFINITY;
    await attendre(() => clics.length > 0, 'archive téléchargée');
    await laisserPasser();
    expect(clics).toHaveLength(1);
  });
});
