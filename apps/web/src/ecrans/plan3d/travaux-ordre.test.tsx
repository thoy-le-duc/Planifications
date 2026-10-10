// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37 — « même source, même ordre » : l'ordre des travaux de la 3D est
 * l'ordre des cartes que l'écran Aujourd'hui DESSINE (data-cle des `tache`), sur la ferme du jour
 * avec travaux (aujourd'hui = 2026-09-30).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from '../aujourdhui/test/contrat.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { ModuleTravaux3d } from './test/contrat-travaux.ts';

const CHEMIN_ECRAN = '../aujourdhui/index.ts';
const CHEMIN_TRAVAUX = './travaux.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;
let travaux: ModuleTravaux3d;
let base: BaseMemoire;
let porte: PorteDonnees;
let ferme: FermeDuJour;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
  travaux = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux3d;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
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

it('les travaux de la 3D sont dans l’ordre des cartes dessinées par l’écran Aujourd’hui', async () => {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  const cartes = (): string[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')].map((t) => t.dataset.cle ?? '');
  for (let k = 0; k < 200 && cartes().length === 0; k++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const dessinees = cartes();
  expect(dessinees.length, 'l’écran affiche les tâches').toBe(ferme.attendu.taches.length);

  const lues = await travaux.lireTachesDuJour(porte, FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`));
  expect(lues.map((t) => t.cle)).toEqual(dessinees);
  const scene = { semaine: 40, libelleSemaine: 'S40', socles: [], volumes: [], batiments: [] };
  expect(travaux.travauxDuJour3d(lues, scene, AUJOURDHUI).travaux.map((t) => t.cle)).toEqual(dessinees);
});
