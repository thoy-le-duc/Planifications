// @vitest-environment happy-dom
/**
 * Tests d'acceptation T10i — la pastille des refus de synchro dans la coquille
 * (docs/backlog/T10i-refus-affiches.md ; contrat : src/ecrans/ferme/test/refus.ts, « Coquille »).
 *
 * Banc : celui de T13c (App.lancement.test.tsx) — l'appli entière, connectée, DOM simulé ; la
 * base « s'ouvre » tout de suite sur la ferme du jour (base mémoire, vraie porte de
 * @planif/sync) ; Planches est un double. Les refus arrivent comme par la synchro
 * (`base.recevoir`). Leurs dates sont relatives à l'heure du test : des refus « récents ».
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
import { AUTRE_UTILISATEUR, MESSAGES_SERVEUR, parametresRefus, SQL_INSERER_REFUS, type LigneRefusLocale } from './ecrans/ferme/test/refus.ts';

const banc = vi.hoisted((): { porte: PorteDonnees | null } => ({ porte: null }));

vi.mock('./donnees/appli.ts', () => ({
  ouvrirDonneesAppli(_utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
    const porte = banc.porte;
    if (porte === null) throw new Error('banc : porte absente');
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
  return {
    default: EcranPlanDouble,
    EcranPlan: EcranPlanDouble,
    MARQUE_PLAN_AFFICHE: 'planif:plan-affiche',
    jourDuTelephone: () => '2026-09-30',
    prechargerPlan: () => Promise.resolve(),
  };
});

vi.mock('./donnees/effacer.ts', async (original) => {
  const reel = await original<typeof import('./donnees/effacer.ts')>();
  return { ...reel, baseLocaleExiste: () => Promise.resolve(true), effacerDonneesLocales: () => Promise.resolve() };
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
  await ecrireFermeDuJour(base, jourLocal(new Date()));
  banc.porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
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
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  localStorage.clear();
  base.fermer();
  banc.porte = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Attend `condition` en temps réel (voir App.lancement.test.tsx). */
async function attendre(condition: () => boolean, message: string, delaiMs = 3_000): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await unTour();
  expect(condition(), message).toBe(true);
}

/** Laisse passer `ms` en temps réel (un refus qui arriverait ou une pastille qui reviendrait). */
async function laisserPasser(ms = 200): Promise<void> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) await unTour();
}

function onglet(libelle: string): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  return b;
}

const pastille = (): Element | null => onglet('Ferme').querySelector('[data-testid="pastille-refus"]');
const ongletDitRefus = (): boolean => /refus/i.test(`${onglet('Ferme').textContent} ${onglet('Ferme').getAttribute('aria-label') ?? ''}`);
const pastilleAllumee = (): boolean => pastille() !== null;
const refusAffiches = (): string[] => [...conteneur.querySelectorAll('[data-testid="refus"]')].map((e) => e.getAttribute('data-refus') ?? '');

let compteur = 0;
/** Refus de l'utilisateur, arrivé il y a `minutes` minutes (horloge du serveur). */
function refus(id: string, minutes: number, utilisateurId = UTILISATEUR): LigneRefusLocale {
  compteur++;
  return {
    id,
    utilisateur_id: utilisateurId,
    ferme_id: FERME,
    nom_table: 'evenement',
    ligne_id: `0192f0c1-1010-7000-c000-${compteur.toString(16).padStart(12, '0')}`,
    operation: 'PATCH',
    motif: 'ajout_seul',
    message: MESSAGES_SERVEUR.ajout_seul,
    cree_le: new Date(Date.now() - minutes * 60_000).toISOString(),
  };
}

function recevoir(...lignes: LigneRefusLocale[]): void {
  for (const l of lignes) base.recevoir(SQL_INSERER_REFUS, parametresRefus(l));
}

async function lancer(): Promise<void> {
  await act(async () => {
    racine.render(<App />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === 'prete', 'base « prête »');
}

/** Relance l'appli (nouvelle racine), même base, même localStorage. */
async function relancer(): Promise<void> {
  act(() => {
    racine.unmount();
  });
  racine = createRoot(conteneur);
  await lancer();
}

async function taper(libelle: string): Promise<void> {
  await act(async () => {
    onglet(libelle).click();
    await Promise.resolve();
  });
}

describe('T10i : pastille des refus sur l’onglet Ferme', () => {
  it('aucun refus : ni pastille, ni « refus » dans l’onglet', async () => {
    await lancer();
    await laisserPasser();
    expect(pastilleAllumee()).toBe(false);
    expect(ongletDitRefus()).toBe(false);
  });

  it('un refus récent pas encore vu : pastille sur l’onglet Ferme, et l’onglet le dit', async () => {
    recevoir(refus('r-1', 10));
    await lancer();
    await attendre(pastilleAllumee, 'pastille data-testid="pastille-refus" dans le bouton de l’onglet Ferme');
    expect(ongletDitRefus(), 'texte ou aria-label de l’onglet : contient « refus »').toBe(true);
  });

  it('un refus qui arrive pendant qu’on est sur Aujourd’hui allume la pastille', async () => {
    await lancer();
    await laisserPasser();
    expect(pastilleAllumee()).toBe(false);
    recevoir(refus('r-1', 1));
    await attendre(pastilleAllumee, 'pastille allumée à l’arrivée du refus');
  });

  it('les refus d’un autre utilisateur ne l’allument jamais', async () => {
    recevoir(refus('r-autre', 5, AUTRE_UTILISATEUR));
    await lancer();
    await laisserPasser();
    recevoir(refus('r-autre-2', 1, AUTRE_UTILISATEUR));
    await laisserPasser();
    expect(pastilleAllumee()).toBe(false);
    expect(ongletDitRefus()).toBe(false);
  });

  it('ouvrir l’onglet Ferme l’éteint ; elle ne revient ni en changeant d’onglet, ni en relançant l’appli', async () => {
    recevoir(refus('r-1', 10));
    await lancer();
    await attendre(pastilleAllumee, 'pastille allumée au lancement');

    await taper('Ferme');
    await attendre(() => refusAffiches().includes('r-1'), 'le refus est affiché dans l’onglet Ferme');
    await attendre(() => !pastilleAllumee(), 'pastille éteinte une fois l’onglet Ferme ouvert');

    await taper('Aujourd');
    await laisserPasser();
    expect(pastilleAllumee(), 'retour sur Aujourd’hui : toujours éteinte').toBe(false);

    await relancer();
    await laisserPasser();
    expect(pastilleAllumee(), 'appli relancée : l’état « vu » est gardé sur le téléphone').toBe(false);
    expect(ongletDitRefus()).toBe(false);
  });

  it('un nouveau refus la rallume, même daté (horloge du serveur) d’avant l’ouverture de l’onglet', async () => {
    recevoir(refus('r-1', 10));
    await lancer();
    await attendre(pastilleAllumee, 'pastille allumée au lancement');
    await taper('Ferme');
    await attendre(() => refusAffiches().includes('r-1'), 'le refus est affiché');
    await attendre(() => !pastilleAllumee(), 'pastille éteinte');
    await taper('Aujourd');

    // Le serveur retarde de 5 minutes sur le téléphone : ce refus, arrivé APRÈS l'ouverture de
    // l'onglet, porte une heure antérieure à cette ouverture.
    recevoir(refus('r-2', 5));
    await attendre(pastilleAllumee, 'pastille rallumée par le nouveau refus');

    await relancer();
    await attendre(pastilleAllumee, 'toujours allumée après relance : le nouveau refus n’a pas été vu');
  });

  it('localStorage qui lève sur les refus vus (lecture et écriture) : l’appli ne plante pas, la pastille s’affiche', async () => {
    // Seules les clés des refus vus lèvent : la session, elle, reste lisible. localStorage
    // remplacé (vi.stubGlobal, retiré après le test) : un espion posé sur l'objet de happy-dom ne
    // se retire pas proprement, et ses méthodes ne passent pas par Storage.prototype.
    const reel = localStorage;
    const appels: string[] = [];
    const casse = (cle: string, quoi: string): void => {
      if (cle.startsWith('planif.refus-vus.')) {
        appels.push(quoi);
        throw new Error('stockage indisponible');
      }
    };
    vi.stubGlobal('localStorage', {
      getItem: (cle: string) => {
        casse(cle, 'lecture');
        return reel.getItem(cle);
      },
      setItem: (cle: string, valeur: string) => {
        casse(cle, 'écriture');
        reel.setItem(cle, valeur);
      },
      removeItem: (cle: string) => {
        reel.removeItem(cle);
      },
      clear: () => {
        reel.clear();
      },
      key: (i: number) => reel.key(i),
      get length() {
        return reel.length;
      },
    } satisfies Storage);
    recevoir(refus('r-1', 10));
    await lancer();
    await attendre(pastilleAllumee, 'pastille allumée malgré le stockage indisponible');
    await taper('Ferme');
    await attendre(() => refusAffiches().includes('r-1'), 'l’onglet Ferme s’ouvre et montre le refus');
    await taper('Aujourd');
    await laisserPasser();
    expect(conteneur.querySelector('[data-testid="app"]'), 'l’appli est toujours là').not.toBeNull();
    // Le banc a bien servi : l'appli a tenté de lire et d'écrire les refus vus.
    expect(appels).toContain('lecture');
    expect(appels).toContain('écriture');
  });

  it('autre utilisateur sur le même téléphone : les refus vus du premier n’éteignent pas la pastille du second', async () => {
    recevoir(refus('r-1', 10));
    await lancer();
    await attendre(pastilleAllumee, 'pastille de A allumée');
    await taper('Ferme');
    await attendre(() => refusAffiches().includes('r-1'), 'A voit son refus');
    await attendre(() => !pastilleAllumee(), 'pastille de A éteinte');

    // B se connecte : sa base à lui, un refus de MÊME identifiant (le pire cas pour « vu »).
    act(() => {
      racine.unmount();
    });
    const baseB = creerBaseMemoire(SCHEMA_LOCAL);
    try {
      await ecrireFermeDuJour(baseB, jourLocal(new Date()));
      baseB.recevoir(SQL_INSERER_REFUS, parametresRefus({ ...refus('r-1', 10), utilisateur_id: AUTRE_UTILISATEUR }));
      banc.porte = creerPorte(baseB, { utilisateurId: AUTRE_UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
      localStorage.setItem(
        CLE_SESSION,
        JSON.stringify({ utilisateurId: AUTRE_UTILISATEUR, email: 'b@ferme.fr', jetonAcces: 'bbb.ccc.ddd', jetonRenouvellement: 's'.repeat(43) }),
      );
      racine = createRoot(conteneur);
      await lancer();
      await attendre(pastilleAllumee, 'pastille de B allumée : les refus vus de A ne comptent pas pour B');
    } finally {
      act(() => {
        racine.unmount();
      });
      racine = createRoot(conteneur);
      baseB.fermer();
    }
  });

  it('un refus qui arrive pendant que l’onglet Ferme est ouvert est vu : pas de pastille en le quittant', async () => {
    await lancer();
    await taper('Ferme');
    await laisserPasser();
    recevoir(refus('r-1', 1));
    await attendre(() => refusAffiches().includes('r-1'), 'le refus arrivé s’affiche dans l’onglet ouvert');
    await laisserPasser();
    await taper('Aujourd');
    await laisserPasser();
    expect(pastilleAllumee()).toBe(false);
  });
});
