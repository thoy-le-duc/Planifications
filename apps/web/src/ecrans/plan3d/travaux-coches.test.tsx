// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37b — « mêmes travaux que l'écran Aujourd'hui », tâches cochées : une
 * tâche marquée faite dont l'écriture est encore en attente (ou que la journée affichée n'a pas
 * relue) disparaît de l'écran Aujourd'hui (cache.ts : les masques) ; elle disparaît AUSSI de la
 * 3D. Contrat : ./test/contrat-telephone.ts (section 4).
 *
 * Banc comme gestes-pendant-file.test.tsx (T13l) : ferme du jour AVEC travaux, aujourd'hui =
 * 2026-09-30, écritures (`porte.ecrireEnsemble`) retenues à volonté ; les lectures restent libres.
 * On compare `lireTachesDuJour` aux cartes que l'écran DESSINE (data-cle des `tache`).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_LOCAL, type PorteDonnees, type creerPorte as CreerPorte } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from '../aujourdhui/test/contrat.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { ModuleTravaux3d } from './test/contrat-travaux.ts';

const CHEMIN_ECRAN = '../aujourdhui/index.ts';
const CHEMIN_TRAVAUX = './travaux.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date(`${AUJOURDHUI}T09:00:00Z`);

const CAROTTE = cleTache(SERIE.carotte, 'semis_direct');
const CHOU = cleTache(SERIE.chou, 'plantation');

let ecran: ModuleEcranAujourdhui;
let travaux: ModuleTravaux3d;
/** Chargée après `vi.resetModules()`, comme l'écran et la 3D : une seule instance de @planif/sync et du cache. */
let creerPorte: typeof CreerPorte;
let base: BaseMemoire;
let ferme: FermeDuJour;
let conteneur: HTMLDivElement;
let racine: Root;

interface PorteTest {
  readonly porte: PorteDonnees;
  readonly retenir: () => void;
  readonly liberer: () => void;
}

function nouvellePorte(): PorteTest {
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  let barriere: Promise<void> | null = null;
  let ouvrir: () => void = () => undefined;
  const porte: PorteDonnees = {
    ...vraie,
    ecrireEnsemble: async (ordres, verifier) => {
      if (barriere !== null) await barriere;
      return vraie.ecrireEnsemble(ordres, verifier);
    },
  };
  return {
    porte,
    retenir: () => {
      barriere = new Promise<void>((r) => {
        ouvrir = r;
      });
    },
    liberer: () => {
      barriere = null;
      ouvrir();
    },
  };
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  vi.resetModules();
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
  travaux = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux3d;
  ({ creerPorte } = await import('@planif/sync'));
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, nombre = 400): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

const inactif = (b: HTMLElement): boolean => (b instanceof HTMLButtonElement && b.disabled) || b.getAttribute('aria-disabled') === 'true';
const cartes = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const boutonFaitDe = (carte: HTMLElement): HTMLButtonElement | undefined => [...carte.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.getAttribute('aria-label') ?? x.textContent).trim().startsWith('Marquer fait'));
/** Les tâches que l'écran montre : les cartes dessinées, sauf celle dont « Marquer fait » est inactif (une carte masquée est retirée ou inactive). */
const cleDeLEcran = (): string[] =>
  cartes()
    .filter((c) => {
      const b = boutonFaitDe(c);
      return b === undefined || !inactif(b);
    })
    .map((c) => c.dataset.cle ?? '');

async function rendre(porte: PorteDonnees): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => cleDeLEcran().length === ferme.attendu.taches.length, 'journée relue dessinée');
}

async function cocher(cle: string): Promise<void> {
  const carte = cartes().find((c) => c.dataset.cle === cle);
  const b = carte === undefined ? undefined : boutonFaitDe(carte);
  if (b === undefined) throw new Error(`« Marquer fait » de ${cle} absent`);
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const lues = async (porte: PorteDonnees): Promise<string[]> => (await travaux.lireTachesDuJour(porte, FERME, AUJOURDHUI, MAINTENANT)).map((t) => t.cle);

describe('T37b : tâche cochée et pas encore relue', () => {
  it('banc : sans geste, la 3D et l’écran ont les mêmes tâches', async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    expect(await lues(p.porte)).toEqual(cleDeLEcran());
    expect(await lues(p.porte)).toEqual(ferme.attendu.taches);
  });

  it('cochée, écriture en attente : disparue de l’écran ET de la 3D, les autres gardent l’ordre de l’écran', async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    p.retenir();
    await cocher(CAROTTE);
    expect(cleDeLEcran(), 'la carotte a quitté l’écran dès le tap').not.toContain(CAROTTE);
    const troisD = await lues(p.porte);
    expect(troisD, 'la carotte a quitté la 3D').not.toContain(CAROTTE);
    expect(troisD, 'mêmes tâches, même ordre que l’écran').toEqual(cleDeLEcran());
    expect(troisD).toEqual(ferme.attendu.taches.filter((c) => c !== CAROTTE));
  });

  it('les numéros de la 3D suivent l’écran : la carotte (rang 1) partie, le rang 1 est la tâche suivante de l’écran', async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    p.retenir();
    await cocher(CAROTTE);
    const taches = await travaux.lireTachesDuJour(p.porte, FERME, AUJOURDHUI, MAINTENANT);
    const r = travaux.travauxDuJour3d(taches, { volumes: [] }, AUJOURDHUI);
    expect(r.travaux.map((t) => t.rang)).toEqual(r.travaux.map((_, i) => i + 1));
    expect(r.travaux.map((t) => t.cle)).toEqual(cleDeLEcran());
  });

  it('deux tâches cochées à la suite, écritures en attente : toutes deux absentes des deux côtés', async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    p.retenir();
    await cocher(CAROTTE);
    await cocher(CHOU);
    const troisD = await lues(p.porte);
    expect(troisD).not.toContain(CAROTTE);
    expect(troisD).not.toContain(CHOU);
    expect(troisD).toEqual(cleDeLEcran());
  });

  it('une fois l’écriture finie : toujours absente des deux côtés, et les deux listes restent identiques', async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    p.retenir();
    await cocher(CAROTTE);
    p.liberer();
    await attendre(() => base.lireDirect<{ n: number }>("SELECT count(*) AS n FROM evenement WHERE type = 'realise' AND serie_id = ?", [SERIE.carotte])[0]?.n === 1, 'le réalisé de la carotte est écrit');
    for (let k = 0; k < 40; k += 1) await unTour();
    const troisD = await lues(p.porte);
    expect(troisD).not.toContain(CAROTTE);
    expect(troisD).toEqual(cleDeLEcran());
  });
});
