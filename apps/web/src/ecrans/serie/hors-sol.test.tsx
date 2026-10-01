// @vitest-environment happy-dom
/**
 * Tests d'acceptation T04b — le formulaire de série (T12) n'affiche aucune alerte de rotation sur
 * un emplacement hors-sol (Q17). Même harnais que ./ecran.test.tsx (ferme du plan, base mémoire,
 * DOM simulé), dans un fichier à part pour ne pas croiser le travail de T12b sur ce formulaire.
 *
 * Jeu : celui de T04 dans la ferme du plan, Brassicacées sur toute la chapelle C3 en 2023 ;
 * des choux plantés sur C3-P02 en 2026 donnent une alerte rouge (écart 3 < 4). Ici, la chapelle
 * C3 passe en abri `hors_sol` (zone.type_abri) avant d'ouvrir le formulaire : plus d'alerte.
 *
 * Le formulaire ne propose que des planches (pas de gouttières) : le cas hors-sol testable à
 * l'écran est donc celui d'une planche dont la zone a l'abri `hors_sol`. Le cas « gouttière » est
 * couvert dans le cœur (packages/core/src/planification/rotation-hors-sol.test.ts).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DepartSerie, ModuleSerie } from './test/contrat.ts';
import { EMPLACEMENT, ESPECE, FERME, SAISON, VARIETE, ZONE } from './test/ferme-serie.ts';
import { aChamp, attendre, AUJOURDHUI, champ, creerBanc, dialogue, dialogueOuEchec, MAINTENANT, remplir, toucher, unTour, type Banc } from './test/outils.ts';

/** Chemin tenu dans une variable, comme ./ecran.test.tsx. */
const CHEMIN_SERIE = './index.ts';

let module: ModuleSerie;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_SERIE)) as ModuleSerie;
});

let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

const NOM_CREATION = 'Nouvelle série';

const formulaire = (): HTMLElement => dialogueOuEchec(NOM_CREATION);
const alertes = (): HTMLElement[] => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="alerte-rotation"]')];
const datesAffichees = (): number => formulaire().querySelectorAll('[data-testid="date-serie"]').length;

/** Ouvre le formulaire de création sur C3-P02, semaine 2026-W42, et y choisit le chou Filderkraut. */
async function chouxSurC3P02En2026(): Promise<void> {
  const depart: DepartSerie = { sorte: 'creation', emplacementId: EMPLACEMENT.c3p02, semaine: '2026-W42', saisonId: SAISON.s2026 };
  await act(async () => {
    racine.render(
      <module.FormulaireSerie porte={b.porte} fermeId={FERME} depart={depart} surFermer={() => undefined} aujourdhui={() => AUJOURDHUI} maintenant={() => MAINTENANT} />,
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(NOM_CREATION) !== undefined, `formulaire « ${NOM_CREATION} »`);
  await attendre(() => aChamp('Culture', formulaire()), 'champ « Culture »');
  await remplir(champ('Culture', formulaire()), 'chou');
  const choix = () =>
    [...formulaire().querySelectorAll<HTMLElement>('[data-testid="choix-culture"]')].find(
      (c) => c.dataset.espece === ESPECE.chou && (c.dataset.variete ?? '') === VARIETE.filderkraut,
    );
  await attendre(() => choix() !== undefined, 'choix « Chou Filderkraut »');
  const c = choix();
  if (c === undefined) throw new Error('choix du chou absent');
  await toucher(c);
  await attendre(() => datesAffichees() > 0, 'dates de la série affichées');
}

describe('T04b : formulaire de série, pas d’alerte de rotation sur le hors-sol', () => {
  it('témoin : chapelle C3 sous serre, choux sur C3-P02 en 2026 → alerte rouge (le jeu de T04)', async () => {
    await chouxSurC3P02En2026();
    await attendre(() => alertes()[0]?.dataset.niveau === 'rouge', 'alerte rouge sur C3-P02');
  });

  it('chapelle C3 passée en abri hors_sol : aucune alerte sur C3-P02, malgré les Brassicacées de 2023', async () => {
    await b.base.execute('UPDATE zone SET type_abri = ? WHERE id = ?', ['hors_sol', ZONE.c3]);
    await chouxSurC3P02En2026();
    // Laisse au formulaire le temps de lire la bibliothèque et de calculer ses alertes.
    for (let k = 0; k < 20; k++) await unTour();
    expect(alertes(), 'aucune alerte de rotation sur une planche hors-sol').toEqual([]);
  });
});
