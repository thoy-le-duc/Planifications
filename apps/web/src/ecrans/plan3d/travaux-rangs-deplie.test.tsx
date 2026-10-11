// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37c — « mêmes travaux que l'écran Aujourd'hui », liste dépliée. Au-delà de
 * 25 tâches en retard, « Voir les autres » ajoute des cartes à l'écran : la 3D doit suivre l'état
 * de l'écran, replié ou déplié, pour que la carte n° i soit toujours le travail n° i.
 *   - replié (à l'ouverture) : 25 en retard, puis 25 de la semaine (déjà vrai en T37b : garde) ;
 *   - déplié (après « Voir les autres ») : tout le retard, puis toute la semaine.
 * Le test ne dit pas comment la 3D apprend l'état : il lit les travaux par `lireTachesDuJour`,
 * dans le même contexte que l'écran, avant puis après le tap sur « Voir les autres ».
 * Les deux tests se suivent dans cet ordre (l'état déplié reste, comme les masques de cache.ts).
 *
 * Banc : la grande ferme de T13b (3 000 séries, des centaines de tâches en retard et d'autres dans
 * la semaine), base au format PowerSync, aujourd'hui = 2026-09-30.
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
const PAR_GROUPE = 25;

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
const attendre = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Laisse l'écran dessiner toutes ses cartes (le premier dessin n'en pose que quelques-unes). */
async function laisserDessiner(minimum: number): Promise<string[]> {
  for (let k = 0; k < 600 && cartes().length < minimum; k += 1) await attendre(5);
  let derniere = -1;
  for (let k = 0; k < 200 && cartes().length !== derniere; k += 1) {
    derniere = cartes().length;
    await attendre(20);
  }
  return cartes();
}

async function ouvrirEcran(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME_GRANDE} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
}

describe('T37c : la 3D suit l’état replié ou déplié de l’écran Aujourd’hui', () => {
  it('replié : la carte n° i de l’écran est le travail n° i de la 3D (garde de T37b)', async () => {
    await ouvrirEcran();
    const dessinees = await laisserDessiner(PAR_GROUPE + 1);
    const taches = await travaux.lireTachesDuJour(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const r = travaux.travauxDuJour3d(taches, { volumes: [] }, AUJOURDHUI);
    const retard = r.travaux.filter((t) => t.enRetard).length;
    expect(retard, 'banc : plus de 30 tâches en retard').toBeGreaterThan(30);
    expect(dessinees.length, 'replié : 25 en retard + 25 de la semaine').toBe(2 * PAR_GROUPE);
    expect(conteneur.querySelector('button.auj-bouton-secondaire')?.textContent, '« Voir les autres » est proposé').toMatch(/^Voir les \d+ autres/);
    dessinees.forEach((cle, i) => {
      expect(r.travaux[i]?.cle, `la carte n° ${String(i + 1)} de l’écran est le travail n° ${String(i + 1)} de la 3D`).toBe(cle);
    });
  }, 120_000);

  it('déplié (« Voir les autres ») : toutes les cartes de l’écran gardent leur numéro dans la 3D', async () => {
    await ouvrirEcran();
    const repliees = await laisserDessiner(PAR_GROUPE + 1);
    const bouton = [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Voir les \d+ autres/.test(b.textContent));
    expect(bouton, '« Voir les autres » est proposé').toBeDefined();
    await act(async () => {
      bouton?.click();
      await Promise.resolve();
    });
    const dessinees = await laisserDessiner(repliees.length + 1);
    expect(dessinees.length, 'déplié : plus de cartes qu’avant').toBeGreaterThan(repliees.length);

    const taches = await travaux.lireTachesDuJour(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const r = travaux.travauxDuJour3d(taches, { volumes: [] }, AUJOURDHUI);
    expect(r.travaux.length).toBeGreaterThanOrEqual(dessinees.length);
    dessinees.forEach((cle, i) => {
      const t = r.travaux[i];
      expect(t?.cle, `déplié : la carte n° ${String(i + 1)} de l’écran est le travail n° ${String(i + 1)} de la 3D`).toBe(cle);
      expect(t?.rang).toBe(i + 1);
    });
    // Tout le retard d'abord, puis toute la semaine (l'ordre de l'écran déplié).
    const premierDeLaSemaine = r.travaux.findIndex((t) => !t.enRetard);
    expect(premierDeLaSemaine, 'tout le retard avant la semaine').toBeGreaterThan(PAR_GROUPE);
    expect(r.travaux.slice(premierDeLaSemaine).every((t) => !t.enRetard)).toBe(true);
  }, 120_000);
});
