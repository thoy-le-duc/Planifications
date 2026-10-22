// @vitest-environment happy-dom
/**
 * Test d'acceptation T61 — de bout en bout dans l'appli : depuis la fiche du jour, le tap sur
 * « Grelinette — hangar, mur nord » ouvre l'onglet Planches (vue 3D) avec le lieu de rangement et
 * la planche surlignés (docs/backlog/T61-chemins-outils.md, critère « tap → les deux points
 * surlignés en 3D »). Banc d'App.onglet-transition.test.tsx : appli connectée, DOM simulé, écrans
 * en doubles.
 *
 * ── Contrat de câblage (App.tsx) ────────────────────────────────────────────────────────────
 *
 * L'écran Aujourd'hui reçoit la propriété `surMontrerRangement(cible)` (cible = { outilId, cle,
 * plancheId }). L'appel passe à l'onglet Planches et donne à l'écran Planches la propriété
 * `rangement` = { outilId, plancheId } (sans la clé de tâche) et `surFermerRangement()`, qui la
 * remet à nul. Quitter l'onglet Planches efface aussi `rangement` : y revenir à la main n'ouvre
 * plus la 3D. Sans appel, `rangement` est nul.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

interface ProprietesDouble {
  readonly surMontrerRangement?: (cible: { outilId: string; cle: string; plancheId: string | null }) => void;
  readonly rangement?: { outilId: string; plancheId: string | null } | null;
  readonly surFermerRangement?: () => void;
  readonly surOnglet?: (o: 'ferme' | 'planches') => void;
}

vi.mock('./ecrans/plan/index.ts', () => {
  function EcranPlanDouble(p: ProprietesDouble) {
    return (
      <section data-testid="planches-double" data-rangement={JSON.stringify(p.rangement ?? null)}>
        <button type="button" data-testid="fermer-rangement-double" onClick={() => p.surFermerRangement?.()}>
          Fermer le rangement
        </button>
        <button type="button" data-testid="bandeau-vers-ferme-double" onClick={() => p.surOnglet?.('ferme')}>
          Bandeau Démarrer : aller à la Ferme
        </button>
      </section>
    );
  }
  return { default: EcranPlanDouble, EcranPlan: EcranPlanDouble, MARQUE_PLAN_AFFICHE: 'planif:plan-affiche', jourDuTelephone: () => '2026-10-16', prechargerPlan: () => Promise.resolve() };
});

vi.mock('./ecrans/aujourdhui/index.ts', () => {
  function EcranAujourdhuiDouble(p: ProprietesDouble) {
    return (
      <section data-testid="aujourdhui-double" data-cable={p.surMontrerRangement === undefined ? 'non' : 'oui'}>
        <button
          type="button"
          data-testid="tap-outil-double"
          onClick={() => p.surMontrerRangement?.({ outilId: 'outil-1', cle: 'serie-1:travail:0:2026-10-16', plancheId: 'planche-1' })}
        >
          Grelinette — hangar, mur nord
        </button>
      </section>
    );
  }
  return { default: EcranAujourdhuiDouble };
});

vi.mock('./ecrans/ferme/EcranFerme.tsx', () => {
  function EcranFermeDouble() {
    return <h2 data-testid="ferme-double">Ferme (double)</h2>;
  }
  return { default: EcranFermeDouble, EcranFerme: EcranFermeDouble };
});

vi.mock('./donnees/precharger.ts', () => ({ prechargerFerme: () => Promise.resolve() }));

vi.mock('./donnees/effacer.ts', async (original) => {
  const reel = await original<typeof import('./donnees/effacer.ts')>();
  return { ...reel, baseLocaleExiste: () => Promise.resolve(false), effacerDonneesLocales: () => Promise.resolve() };
});

const { App } = await import('./App.tsx');

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';
const PRETE: EtatDonnees = { base: 'prete', ferme: null, synchro: 'synchronise', enAttente: 0 };

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  localStorage.setItem(CLE_SESSION, JSON.stringify({ utilisateurId: MOI, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
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

const un = (testid: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const rangement = (): unknown => JSON.parse(un('planches-double')?.getAttribute('data-rangement') ?? 'null');

function onglet(libelle: string): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  return b;
}

async function demarrer(): Promise<void> {
  banc.premier = { ...PRETE, base: 'ouverture' };
  act(() => {
    racine.render(<App />);
  });
  await attendre(() => un('aujourdhui-double') !== null, 'Aujourd’hui affiché');
}

describe('T61 : de la fiche du jour à la 3D, dans l’appli', () => {
  it('l’écran Aujourd’hui est câblé (surMontrerRangement fourni)', async () => {
    await demarrer();
    expect(un('aujourdhui-double')?.getAttribute('data-cable')).toBe('oui');
  });

  it('le tap sur l’outil ouvre l’onglet Planches avec la cible { outilId, plancheId }', async () => {
    await demarrer();
    act(() => {
      un('tap-outil-double')?.click();
    });
    await attendre(() => un('planches-double') !== null, 'onglet Planches affiché');
    expect(onglet('Planches').getAttribute('aria-current')).toBe('page');
    expect(rangement()).toEqual({ outilId: 'outil-1', plancheId: 'planche-1' });
  });

  it('« Fermer » côté Planches remet la cible à nul', async () => {
    await demarrer();
    act(() => {
      un('tap-outil-double')?.click();
    });
    await attendre(() => rangement() !== null, 'cible donnée');
    act(() => {
      un('fermer-rangement-double')?.click();
    });
    await attendre(() => rangement() === null, 'cible effacée');
  });

  it('quitter Planches puis y revenir à la main : plus de cible', async () => {
    await demarrer();
    act(() => {
      un('tap-outil-double')?.click();
    });
    await attendre(() => rangement() !== null, 'cible donnée');
    act(() => {
      onglet('Aujourd’hui').click();
    });
    await attendre(() => un('aujourdhui-double') !== null, 'retour à Aujourd’hui');
    act(() => {
      onglet('Planches').click();
    });
    await attendre(() => un('planches-double') !== null, 'Planches de nouveau');
    expect(rangement()).toBeNull();
  });

  it('le bandeau « Démarrer » change d’onglet pendant qu’un rangement est affiché : cible effacée, pas de réouverture au retour', async () => {
    await demarrer();
    act(() => {
      un('tap-outil-double')?.click();
    });
    await attendre(() => rangement() !== null, 'cible donnée');
    act(() => {
      un('bandeau-vers-ferme-double')?.click();
    });
    await attendre(() => un('ferme-double') !== null, 'onglet Ferme affiché');
    act(() => {
      onglet('Planches').click();
    });
    await attendre(() => un('planches-double') !== null, 'Planches de nouveau');
    expect(rangement(), 'la 3D ne se rouvre pas seule').toBeNull();
  });
});
