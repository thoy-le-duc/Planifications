// @vitest-environment happy-dom
/**
 * T11b, relecture B2 — Aujourd'hui dit au DOM qu'une saisie est en cours (data-saisie-en-cours,
 * lu par src/rechargement.ts : pas de rechargement de la page après une mise à jour pendant ce
 * temps) :
 *   - sur sa racine, tant qu'une écriture tourne ou attend (file, lecture ciblée, base) ;
 *   - sur le bandeau « Annuler », tant qu'il est affiché.
 * Banc : la ferme du jour (./test/ferme-du-jour.ts) ; les lectures de la porte peuvent être
 * et écritures de la porte peuvent être retenues, ce qui garde un « Fait » en cours d'écriture.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { saisieEnCours } from '../../rechargement.ts';
import { EcranAujourdhui } from './index.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const CAROTTE = cleTache(SERIE.carotte, 'semis_direct');

let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;
let liberer: () => void = () => undefined;
let barriere: Promise<void> | null = null;

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

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  relacher();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  for (let k = 0; k < 400 && !condition(); k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(condition(), message).toBe(true);
}

const racineEcran = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="aujourdhui"]');
const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
const boutonFait = (cle: string): HTMLButtonElement | undefined =>
  [...(conteneur.querySelector(`[data-testid="tache"][data-cle="${cle}"]`)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) =>
    (b.getAttribute('aria-label') ?? b.textContent).trim().startsWith('Marquer fait'),
  );

describe('T11b : Aujourd’hui marque ses écritures en cours et son bandeau « Annuler »', () => {
  it('« Fait » en cours d’écriture : racine marquée ; écriture finie : racine libre, bandeau marqué', async () => {
    await act(async () => {
      racine.render(<EcranAujourdhui porte={porteRetenable()} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    await attendre(() => boutonFait(CAROTTE) !== undefined, 'carte de la carotte');
    expect(racineEcran()?.dataset.saisieEnCours, 'au repos : pas de marqueur').toBeUndefined();
    expect(saisieEnCours(document)).toBe(false);

    // Les lectures sont retenues : le « Fait » reste en cours (lecture ciblée avant l'écriture).
    retenir();
    const b = boutonFait(CAROTTE);
    await act(async () => {
      b?.click();
      await Promise.resolve();
    });
    await attendre(() => racineEcran()?.dataset.saisieEnCours === 'oui', 'racine marquée pendant l’écriture');
    expect(saisieEnCours(document), 'saisie en cours vue par rechargement.ts').toBe(true);

    relacher();
    await attendre(() => racineEcran()?.dataset.saisieEnCours === undefined, 'racine libre une fois l’écriture finie');
    await attendre(() => bandeau() !== null, 'bandeau « Annuler » affiché');
    expect(bandeau()?.dataset.saisieEnCours, 'bandeau annulable marqué').toBe('oui');
    expect(saisieEnCours(document)).toBe(true);
  });
});
