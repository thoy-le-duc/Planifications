// @vitest-environment happy-dom
/**
 * Tests d'acceptation T57 — les vannes dans l'éditeur de placement (docs/backlog/T57-vannes-
 * irrigation.md, règle 2) : une vanne se pose au doigt (ou au clavier) sur le plan, près de ses
 * planches ; sans placement, elle s'affiche en tête de sa première planche. Rien n'est écrit
 * pendant le geste ; « Enregistrer » = un appel à porte.placer, avec { sorte: 'vanne', id,
 * position: { x, y } } (repère de la ferme, mètres). Gérant seulement.
 *
 * DOM (en plus de ./test/contrat.ts) : un marqueur par vanne non supprimée qui a une place,
 * `data-testid="vanne"`, `data-id`, role="button", nommé « Vanne V12 », `data-x`, `data-y`
 * (repère de la ferme, arrondis au millimètre), `data-placee` 'oui' ou 'non' ; au moins 44 px de
 * côté au doigt. Flèches : 0,1 m (Maj : 1 m), comme une planche ; ni poignée ni rotation.
 *
 * Ferme du placement (./test/ferme-placement.ts, avec origine) : PC-01 (25 m) centrée en (120, 15),
 * cap 90° ; sa tête (bout de départ, à l'opposé du cap) est en (107,5 ; 15). V12 l'arrose.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, desactive, unTour } from '../itineraires/test/outils.ts';
import type { ModuleEditeur, ProprietesEditeurPlacement } from './test/contrat.ts';
import { ecrireFermePlacement, FERME, PLANCHE, UTILISATEUR } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-19T08:00:00.000Z');
const V12 = '0192f0c1-5757-7000-8000-0000000000a1';
const V13 = '0192f0c1-5757-7000-8000-0000000000a2';
const V14 = '0192f0c1-5757-7000-8000-0000000000a3';

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

interface Changement {
  readonly sorte: string;
  readonly id?: string;
  readonly position?: { readonly x: number; readonly y: number } | null;
}

let base: BaseMemoire;
let placements: (readonly Changement[])[];
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  placements = [];
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch interdit'))));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base.fermer();
});

async function ouvrir(role: 'gerant' | 'equipier' = 'gerant'): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, role });
  const vanne = (id: string, numero: number, x: number | null, y: number | null) => {
    base.recevoir(
      `INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, debit_litres_heure, adresse_modbus, placement_x_m, placement_y_m, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
      [id, FERME, numero, `V${String(numero)}`, x, y],
    );
  };
  vanne(V12, 12, null, null);
  vanne(V13, 13, 60, -5);
  vanne(V14, 14, null, null); // n'arrose rien, pas placée : pas de marqueur.
  base.recevoir(
    `INSERT INTO secteur_emplacement (id, ferme_id, secteur_irrigation_id, emplacement_id, du, au, cree_le, modifie_le, supprime_le)
     VALUES ('0192f0c1-5757-7000-8000-0000000000b1', ?, ?, ?, '2026-01-01', NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
    [FERME, V12, PLANCHE],
  );
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const porte: PorteDonnees = {
    ...reelle,
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  const proprietes: ProprietesEditeurPlacement = { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: false };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => marqueurs().length === 2, 'deux vannes affichées');
}

const marqueurs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="vanne"]')];
function marqueur(id: string): HTMLElement {
  const el = marqueurs().find((x) => x.dataset.id === id);
  if (el === undefined) throw new Error(`vanne ${id} absente`);
  return el;
}
const position = (el: HTMLElement): [number, number] => [Number(el.dataset.x), Number(el.dataset.y)];

async function touche(el: Element, key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    (el as HTMLElement).focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

describe('T57 : les vannes dans l’éditeur de placement', () => {
  it('V12 non placée s’affiche en tête de PC-01 ; V13 placée à sa position ; V14 (sans planche) n’est pas montrée', async () => {
    await ouvrir();
    expect(marqueur(V12).getAttribute('role')).toBe('button');
    expect(marqueur(V12).getAttribute('aria-label')).toBe('Vanne V12');
    expect(marqueur(V12).dataset.placee).toBe('non');
    const [x, y] = position(marqueur(V12));
    expect(Math.abs(x - 107.5)).toBeLessThan(0.01);
    expect(Math.abs(y - 15)).toBeLessThan(0.01);
    expect(marqueur(V13).dataset.placee).toBe('oui');
    expect(position(marqueur(V13))).toEqual([60, -5]);
  });

  it('déplacée au clavier (Maj+→ puis ↑) : rien n’est écrit avant « Enregistrer », puis UN appel à porte.placer', async () => {
    await ouvrir();
    await touche(marqueur(V12), 'ArrowRight', true);
    await touche(marqueur(V12), 'ArrowUp', true);
    const [x, y] = position(marqueur(V12));
    expect(Math.abs(x - 108.5)).toBeLessThan(0.01);
    expect(Math.abs(y - 16)).toBeLessThan(0.01);
    expect(placements).toEqual([]);
    expect(base.lireDirect<{ x: number | null }>('SELECT placement_x_m AS x FROM secteur_irrigation WHERE id = ?', [V12])[0]?.x).toBeNull();
    await act(async () => {
      bouton('Enregistrer').click();
      await Promise.resolve();
    });
    await attendre(() => placements.length === 1, 'porte.placer appelée');
    const changement = placements[0]?.find((c) => c.sorte === 'vanne');
    expect(changement?.id).toBe(V12);
    expect(Math.abs((changement?.position?.x ?? 0) - 108.5)).toBeLessThan(0.01);
    expect(Math.abs((changement?.position?.y ?? 0) - 16)).toBeLessThan(0.01);
    await attendre(() => base.lireDirect<{ x: number | null }>('SELECT placement_x_m AS x FROM secteur_irrigation WHERE id = ?', [V12])[0]?.x !== null, 'position écrite');
    await attendre(() => marqueur(V12).dataset.placee === 'oui', 'V12 placée');
  });

  it('l’équipier voit les vannes mais ne les déplace pas', async () => {
    await ouvrir('equipier');
    const avant = position(marqueur(V12));
    await touche(marqueur(V12), 'ArrowRight', true);
    expect(position(marqueur(V12))).toEqual(avant);
    expect(document.querySelector('[data-testid="barre-doigt"]')).toBeNull();
    expect(placements).toEqual([]);
    // « Enregistrer » n'existe pas en lecture seule.
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Enregistrer' && !desactive(b))).toBe(false);
  });
});
