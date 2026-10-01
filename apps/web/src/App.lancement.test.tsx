// @vitest-environment happy-dom
/**
 * Test d'acceptation T13c — au lancement, Aujourd'hui (écran d'accueil) n'attend pas le
 * préchargement de Planches.
 *
 * Banc : l'appli entière (App), connectée (session rangée), dans un DOM simulé. Deux doubles :
 *   - ./donnees/appli.ts : la base « s'ouvre » tout de suite sur la ferme du jour
 *     (src/ecrans/aujourdhui/test/ferme-du-jour.ts), base mémoire, porte de @planif/sync ;
 *   - ./ecrans/plan/index.ts : l'écran Planches est un simple titre, et son préchargement
 *     (`prechargerPlan`) ne se termine JAMAIS (grande ferme, base occupée, téléphone lent).
 * L'écran Aujourd'hui est le vrai (src/ecrans/aujourdhui), sur la vraie base mémoire.
 *
 * Attendu : les tâches du jour s'affichent quand même. Avant T13c, App.tsx fait attendre la
 * journée derrière le plan (`prechargerJournee(…, plan)`), et l'écran ouvert attend cette
 * lecture : « Lecture des tâches… » pour toujours.
 *
 * Témoins : Planches reste accessible (le tap affiche son écran) ; et avec un préchargement de
 * Planches qui se termine, les tâches s'affichent (le banc lui-même marche).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { CLE_SESSION } from './connexion/session.ts';
import type { EtatDonnees, PoigneeDonnees } from './donnees/etat-appli.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './ecrans/aujourdhui/test/ferme-du-jour.ts';

/** État partagé avec les doubles (vi.mock est remonté en tête du fichier). */
interface Banc {
  porte: PorteDonnees | null;
  /** Préchargement de Planches : 'jamais' (ne se termine pas) ou 'tout-de-suite'. */
  plan: 'jamais' | 'tout-de-suite';
  appelsPlan: number;
}
const banc = vi.hoisted((): Banc => ({ porte: null, plan: 'jamais', appelsPlan: 0 }));

vi.mock('./donnees/appli.ts', () => ({
  ouvrirDonneesAppli(_utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
    const porte = banc.porte;
    if (porte === null) throw new Error('banc : porte absente');
    setTimeout(() => {
      surEtat({
        base: 'prete',
        ferme: { porte, fermeId: FERME },
        synchro: 'hors-ligne',
        enAttente: 0,
      });
    }, 0);
    return {
      compterEnAttente: () => Promise.resolve(0),
      fermer: () => Promise.resolve(),
    };
  },
}));

vi.mock('./ecrans/plan/index.ts', () => {
  function EcranPlanDouble() {
    return <h2 data-testid="planches-double">Plan des planches (double)</h2>;
  }
  return {
    default: EcranPlanDouble,
    EcranPlan: EcranPlanDouble,
    MARQUE_PLAN_AFFICHE: 'planif:plan-affiche',
    jourDuTelephone: () => '2026-09-30',
    prechargerPlan: () => {
      banc.appelsPlan++;
      return banc.plan === 'jamais' ? new Promise<void>(() => undefined) : Promise.resolve();
    },
  };
});

const { App } = await import('./App.tsx');

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  // L'écran lit le jour du téléphone (App ne lui en donne pas) : la ferme est datée de ce jour.
  await ecrireFermeDuJour(base, jourLocal(new Date()));
  banc.porte = creerPorte(base, {
    utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
    fermeId: FERME as Id<'Ferme'>,
  });
  banc.appelsPlan = 0;
  localStorage.setItem(
    CLE_SESSION,
    JSON.stringify({
      utilisateurId: UTILISATEUR,
      email: 'theophane@ferme.fr',
      jetonAcces: 'aaa.bbb.ccc',
      jetonRenouvellement: 'r'.repeat(43),
    }),
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
  base.fermer();
  banc.porte = null;
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Attend `condition` en temps RÉEL (jusqu'à `delaiMs`), tour après tour (act + setTimeout 0).
 * Un nombre de tours ne suffit pas : sur une machine rapide, 300 tours durent ≈ 300 ms, moins
 * que l'attente du plan que App.tsx accorde à la journée au lancement (ATTENTE_PLAN_MAX_MS,
 * 400 ms, T13c) ; le test échouerait alors avant que la journée ne passe.
 */
async function attendre(condition: () => boolean, message: string, delaiMs = 3_000): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await unTour();
  expect(condition(), message).toBe(true);
}

const taches = (): Element[] => [...conteneur.querySelectorAll('[data-testid="tache"]')];
const ecranAujourdhui = (): Element | null => conteneur.querySelector('[data-testid="aujourdhui"]');

function onglet(libelle: string): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  return b;
}

async function lancer(): Promise<void> {
  await act(async () => {
    racine.render(<App />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === 'prete', 'base « prête »');
  await attendre(() => ecranAujourdhui() !== null, 'écran Aujourd’hui monté');
}

describe('T13c : au lancement, Aujourd’hui n’attend pas le préchargement de Planches', () => {
  it('préchargement de Planches qui ne se termine jamais : les tâches du jour s’affichent quand même', async () => {
    banc.plan = 'jamais';
    await lancer();
    await attendre(() => banc.appelsPlan > 0, 'le préchargement de Planches est bien lancé (et reste en cours)');
    await attendre(() => taches().length > 0, `tâches affichées malgré Planches en cours (écran : « ${(ecranAujourdhui()?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120)} »)`);
  });

  it('témoin : Planches reste accessible pendant que son préchargement est en cours', async () => {
    banc.plan = 'jamais';
    await lancer();
    await act(async () => {
      onglet('Planches').click();
      await Promise.resolve();
    });
    await attendre(() => conteneur.querySelector('[data-testid="planches-double"]') !== null, 'écran Planches affiché au tap');
  });

  it('témoin du banc : préchargement de Planches terminé, les tâches s’affichent', async () => {
    banc.plan = 'tout-de-suite';
    await lancer();
    await attendre(() => taches().length > 0, 'tâches affichées');
  });
});
