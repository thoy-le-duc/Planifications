// @vitest-environment happy-dom
/**
 * Tests d'acceptation T11f — écritures en cours au changement d'onglet (suite de la relecture T11b).
 *
 * T11b posait data-saisie-en-cours sur la racine d'Aujourd'hui pendant une écriture : un « Fait »
 * qui s'écrit encore quand on quitte l'onglet (écran démonté) n'est plus marqué nulle part, et un
 * morceau introuvable rechargerait la page au milieu de l'écriture. Règle T11f : chaque écriture
 * d'Aujourd'hui compte dans le compteur global (src/donnees/ecritures-en-cours.ts, contrat dans
 * son test) du début à la fin de l'écriture, que l'écran soit encore affiché ou non ; et
 * `saisieEnCours()` le lit. Scénario : « Fait » en cours d'écriture (lectures de la porte
 * retenues), changement d'onglet (Aujourd'hui démonté), morceau introuvable → pas de rechargement
 * avant la fin de l'écriture ; l'écriture finie → un seul rechargement.
 * Banc : la ferme du jour (./test/ferme-du-jour.ts), porte retenable comme saisie-en-cours.test.tsx.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { EVENEMENT_MORCEAU_INTROUVABLE, saisieEnCours, surveillerMorceauIntrouvable } from '../../rechargement.ts';
import { EcranAujourdhui } from './index.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

interface ModuleEcrituresEnCours {
  ecrituresEnCours(): number;
}

const CHEMIN_COMPTEUR = '../../donnees/ecritures-en-cours.ts';
const AUJOURDHUI = '2026-09-30';
const CAROTTE = cleTache(SERIE.carotte, 'semis_direct');

let compteur: ModuleEcrituresEnCours;
let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;
let monte = false;
let liberer: () => void = () => undefined;
let barriere: Promise<void> | null = null;
let arreter: (() => void) | null = null;

beforeAll(async () => {
  compteur = (await import(/* @vite-ignore */ CHEMIN_COMPTEUR)) as ModuleEcrituresEnCours;
});

function porteRetenable(): PorteDonnees {
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  return {
    ...vraie,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => {
      if (barriere !== null) await barriere;
      return vraie.lire<T>(sql, parametres);
    },
    ecrireEnsemble: async (ordres, verifier) => {
      if (barriere !== null) await barriere;
      return vraie.ecrireEnsemble(ordres, verifier);
    },
    saisirEvenement: async (saisie) => {
      if (barriere !== null) await barriere;
      return vraie.saisirEvenement(saisie);
    },
  };
}

function retenir(): void {
  barriere = new Promise<void>((r) => {
    liberer = r;
  });
}

function relacher(): void {
  barriere = null;
  liberer();
}

function demonter(): void {
  if (!monte) return;
  monte = false;
  act(() => {
    racine.unmount();
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  monte = true;
});

afterEach(async () => {
  arreter?.();
  arreter = null;
  relacher();
  demonter();
  // Laisse finir l'écriture relâchée avant de fermer la base.
  for (let k = 0; k < 400 && compteur.ecrituresEnCours() > 0; k++) await new Promise((r) => setTimeout(r, 0));
  conteneur.remove();
  base.fermer();
});

async function attendre(condition: () => boolean, message: string, essais = 400): Promise<void> {
  for (let k = 0; k < essais && !condition(); k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(condition(), message).toBe(true);
}

/** Laisse passer du temps réel (plusieurs sondages du rechargement). */
async function patienter(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const racineEcran = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="aujourdhui"]');
const boutonFait = (cle: string): HTMLButtonElement | undefined =>
  [...(conteneur.querySelector(`[data-testid="tache"][data-cle="${cle}"]`)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) =>
    (b.getAttribute('aria-label') ?? b.textContent).trim().startsWith('Marquer fait'),
  );

function stockageMemoire(): Pick<Storage, 'getItem' | 'setItem'> {
  const donnees = new Map<string, string>();
  return {
    getItem: (k) => donnees.get(k) ?? null,
    setItem: (k, v) => {
      donnees.set(k, v);
    },
  };
}

describe('T11f : « Fait » en cours d’écriture, changement d’onglet, morceau introuvable', () => {
  it('pas de rechargement avant la fin de l’écriture, même Aujourd’hui démonté ; un seul après', async () => {
    await act(async () => {
      racine.render(<EcranAujourdhui porte={porteRetenable()} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    await attendre(() => boutonFait(CAROTTE) !== undefined, 'carte de la carotte');
    expect(compteur.ecrituresEnCours(), 'au repos : aucune écriture en cours').toBe(0);

    // « Fait » : les lectures et écritures de la porte sont retenues, l'écriture reste en cours.
    retenir();
    const b = boutonFait(CAROTTE);
    await act(async () => {
      b?.click();
      await Promise.resolve();
    });
    await attendre(() => racineEcran()?.dataset.saisieEnCours === 'oui', 'écriture en cours (racine marquée, T11b)');
    expect(compteur.ecrituresEnCours(), 'le « Fait » compte dans le compteur global').toBeGreaterThan(0);

    // Changement d'onglet : Aujourd'hui est démonté, l'écriture continue.
    demonter();
    expect(racineEcran(), 'Aujourd’hui démonté').toBeNull();
    expect(compteur.ecrituresEnCours(), 'écran démonté : l’écriture compte toujours').toBeGreaterThan(0);
    expect(saisieEnCours(document), 'écran démonté : saisie toujours en cours pour rechargement.ts').toBe(true);

    // Morceau introuvable (l'onglet suivant n'est plus sur le serveur).
    const recharger = vi.fn();
    arreter = surveillerMorceauIntrouvable({ recharger, stockage: stockageMemoire(), sondageMs: 5 });
    const e = new Event(EVENEMENT_MORCEAU_INTROUVABLE, { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented, 'pas de rechargement immédiat').toBe(false);
    await patienter(100);
    expect(recharger, 'aucun rechargement pendant l’écriture').not.toHaveBeenCalled();

    // L'écriture finit : compteur à zéro, puis un seul rechargement.
    relacher();
    await attendre(() => compteur.ecrituresEnCours() === 0, 'écriture finie : compteur à zéro');
    await attendre(() => recharger.mock.calls.length > 0, 'rechargé une fois l’écriture finie');
    await patienter(50);
    expect(recharger, 'une seule fois').toHaveBeenCalledTimes(1);
  });
});
