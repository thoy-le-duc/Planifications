// @vitest-environment happy-dom
/**
 * Tests d'acceptation T91 (règle 2) — l'éditeur s'ouvre sur une zone : `zoneInitiale` la choisit
 * d'emblée (comme un tap sur sa ligne de la liste) et, pour le gérant, `modificationInitiale` ouvre
 * directement en modification (« Modifier le plan » déjà tapé). Sans ces propriétés, rien ne change :
 * éditeur verrouillé, aucune zone choisie (T87). Un équipier reste en lecture, même avec la propriété.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre } from '../itineraires/test/outils.ts';
import { EditeurPlacement } from './index.ts';
import { ecrireFermePlacement, FERME, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL } from './test/ferme-placement.ts';

const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire;
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
  base.fermer();
});

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="editeur-placement"]');
const choix = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="zone-choix"][data-id="${id}"]`);

async function ouvrir(proprietes: { zoneInitiale?: string; modificationInitiale?: boolean }, role: 'gerant' | 'equipier' = 'gerant'): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, role });
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  await act(async () => {
    racine.render(createElement(EditeurPlacement, { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true, ...proprietes }));
    await Promise.resolve();
  });
  await attendre(() => (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await attendre(() => choix(ZONE_TUNNEL) !== null, 'liste des zones affichée');
}

describe('T91 : l’éditeur s’ouvre sur une zone', () => {
  it('sans propriété : verrouillé, aucune zone choisie', async () => {
    await ouvrir({});
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(choix(ZONE_TUNNEL)?.getAttribute('aria-pressed')).toBe('false');
  });

  it('zoneInitiale : la zone est choisie d’emblée', async () => {
    await ouvrir({ zoneInitiale: ZONE_TUNNEL });
    expect(choix(ZONE_TUNNEL)?.getAttribute('aria-pressed')).toBe('true');
    expect(choix(ZONE_CHAMP)?.getAttribute('aria-pressed')).toBe('false');
  });

  it('gérant avec modificationInitiale : ouvert en modification', async () => {
    await ouvrir({ zoneInitiale: ZONE_TUNNEL, modificationInitiale: true });
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    expect(choix(ZONE_TUNNEL)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('équipier : reste en lecture, la zone est quand même choisie', async () => {
    await ouvrir({ zoneInitiale: ZONE_TUNNEL, modificationInitiale: true }, 'equipier');
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(choix(ZONE_TUNNEL)?.getAttribute('aria-pressed')).toBe('true');
  });
});
