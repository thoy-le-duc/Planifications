// @vitest-environment happy-dom
/**
 * T89, contre-relecture : pendant un « Enregistrer » (écriture en cours), « Ajouter » et « Placer la serre » sont bloqués, avec
 * la raison MESSAGES_ETAPES.occupe : une seconde fiche ne peut pas s'ajouter à un brouillon en train d'être écrit.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { MESSAGES_ETAPES } from './etapes.tsx';
import { deverrouiller } from './test/deverrouiller.ts';
import { ecrireFermePlacement, FERME, TRI_TUNNEL, UTILISATEUR, ZONE_TRI } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
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
  base?.fermer();
  base = null;
});

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const raison = (b: HTMLElement): string =>
  (b.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((i) => i !== '')
    .map((i) => texte(document.getElementById(i)))
    .join(' ');

describe('T89 : rien ne s’ajoute pendant un enregistrement', () => {
  it('« Ajouter » et « Placer la serre » sont désactivés, avec la raison « Enregistrement en cours », puis reviennent', async () => {
    const b = creerBaseMemoire(SCHEMA_LOCAL);
    base = b;
    await ecrireFermePlacement(b, { origine: true, triTunnel: true });
    b.recevoir('DELETE FROM batiment WHERE id = ?', [TRI_TUNNEL]);
    const reelle = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => new Date('2026-10-30T08:00:00.000Z') });
    let liberer: () => void = () => undefined;
    const porte: PorteDonnees = {
      ...reelle,
      placer: (c: readonly ChangementPlacement[]) =>
        new Promise<void>((r) => {
          liberer = r;
        }).then(() => reelle.placer(c)),
    };
    await act(async () => {
      racine.render(createElement(m.EditeurPlacement, { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true }));
      await Promise.resolve();
    });
    await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
    await deverrouiller();
    await attendre(() => document.querySelector(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_TRI}"]`) !== null, 'zones affichées');

    // Une serre au brouillon, puis « Enregistrer » qui reste en cours.
    await toucher(bouton('Ajouter'));
    await toucher(bouton('Serre ou tunnel'));
    await attendre(() => un('fiche-serre') !== null, 'fiche');
    await remplir(champ('Nom', un('fiche-serre') ?? document.body), 'Serre A');
    await toucher(bouton('Créer', un('fiche-serre') ?? document.body));
    await toucher(bouton('Enregistrer'));

    expect(desactive(bouton('Ajouter')), '« Ajouter » pendant l’écriture').toBe(true);
    expect(raison(bouton('Ajouter'))).toContain(MESSAGES_ETAPES.occupe);
    const zone = document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_TRI}"]`);
    if (zone !== null) await toucher(zone);
    expect(desactive(bouton('Placer la serre')), '« Placer la serre » pendant l’écriture').toBe(true);
    expect(raison(bouton('Placer la serre'))).toContain(MESSAGES_ETAPES.occupe);

    await act(async () => {
      liberer();
      await Promise.resolve();
    });
    await attendre(() => un(T.annuler) !== null, 'écriture terminée');
    expect(desactive(bouton('Ajouter'))).toBe(false);
  });
});
