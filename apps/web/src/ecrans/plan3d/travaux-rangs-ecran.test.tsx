// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37b — « mêmes travaux que l'écran Aujourd'hui », numéros au-delà de 25
 * tâches. L'écran ne dessine que 25 tâches par groupe (en retard, puis la semaine) avant « Voir
 * les autres » ; la 3D montrait toutes les tâches, donc la première tâche de la semaine y portait
 * le numéro 26 + (nombre de tâches en retard au-delà de 25), pas celui de sa carte. Règle :
 * le rang d'une tâche dessinée par l'écran est le même dans la 3D (sa position, à partir de 1,
 * parmi les cartes). Contrat : ./test/contrat-telephone.ts (section 4).
 *
 * Banc : la grande ferme de T13b (3 000 séries, des centaines de tâches en retard et d'autres
 * dans la semaine), base au format PowerSync, aujourd'hui = 2026-09-30.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from '../aujourdhui/test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, UTILISATEUR_GRANDE } from '../aujourdhui/test/grande-ferme.ts';
import type { ModuleEcranAujourdhui } from '../aujourdhui/test/contrat.ts';
import type { ModuleTravaux3d } from './test/contrat-travaux.ts';

const CHEMIN_ECRAN = '../aujourdhui/index.ts';
const CHEMIN_TRAVAUX = './travaux.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date(`${AUJOURDHUI}T10:00:00.000Z`);
const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

let ecran: ModuleEcranAujourdhui;
let travaux: ModuleTravaux3d;
let base: BasePowerSync;
let porte: PorteDonnees;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA);
  await ecrireGrandeFerme(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>, fermeId: FERME_GRANDE as Id<'Ferme'> });
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
  travaux = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux3d;
}, 120_000);

afterAll(() => {
  base.fermer();
});

beforeEach(() => {
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
});

const cartes = (): string[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')].map((t) => t.dataset.cle ?? '');

describe('T37b : grande ferme, au-delà de 25 tâches', () => {
  it('les cartes de l’écran ont le même rang dans la 3D (position à partir de 1)', async () => {
    await act(async () => {
      racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME_GRANDE} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    for (let k = 0; k < 600 && cartes().length < 26; k += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    // Laisse les dernières cartes se dessiner (le premier dessin n'en pose que quelques-unes).
    let derniere = -1;
    for (let k = 0; k < 200 && cartes().length !== derniere; k += 1) {
      derniere = cartes().length;
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    const dessinees = cartes();
    expect(dessinees.length, 'l’écran dessine plus de 25 tâches (25 en retard, 25 de la semaine)').toBeGreaterThan(25);

    const taches = await travaux.lireTachesDuJour(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const r = travaux.travauxDuJour3d(taches, { volumes: [] }, AUJOURDHUI);
    expect(r.travaux.length).toBeGreaterThanOrEqual(dessinees.length);
    dessinees.forEach((cle, i) => {
      const t = r.travaux[i];
      expect(t?.cle, `la carte n° ${String(i + 1)} de l’écran est le travail n° ${String(i + 1)} de la 3D`).toBe(cle);
      expect(t?.rang).toBe(i + 1);
    });
  }, 120_000);

  it('les numéros de la 3D sont toujours 1, 2, 3… sans trou ni doublon', async () => {
    const taches = await travaux.lireTachesDuJour(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const r = travaux.travauxDuJour3d(taches, { volumes: [] }, AUJOURDHUI);
    expect(r.travaux.map((t) => t.rang)).toEqual(r.travaux.map((_, i) => i + 1));
    expect(new Set(r.travaux.map((t) => t.cle)).size, 'pas de doublon').toBe(r.travaux.length);
  }, 120_000);
});
