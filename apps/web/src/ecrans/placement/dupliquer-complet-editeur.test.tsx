// @vitest-environment happy-dom
/**
 * T90 (relecture) : la copie reprend TOUS les emplacements, placés ou non, de toutes sortes (docs/backlog/T90-dupliquer.md, règle 2),
 * lus en base par la fiche. Ferme de test : « Tri-tunnel » (3 sous-zones « Manon 1 » à « Manon 3 » et une planche directe « T-1 », 8
 * planches non placées) abrité par un bâtiment sans grille, plus un rang « R1 » non placé dans « Manon 1 » : 4 zones, 9 emplacements, 1 bâtiment
 * par copie, soit 14 changements.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { BOUTONS_SERRE as B } from './test/contrat-serre.ts';
import { BOUTONS_DUPLICATION as BD, TESTID_DUPLICATION as TD } from './test/contrat-dupliquer.ts';
import { deverrouiller } from './test/deverrouiller.ts';
import { ecrireFermePlacement, FERME, MANON, TRI_TUNNEL, UTILISATEUR } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-30T08:00:00.000Z');
const HORO = '2026-01-01T08:00:00.000Z';

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

type Ligne = Readonly<Record<string, string | number | null>>;
let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
const placements: (readonly ChangementPlacement[])[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  placements.length = 0;
});
afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base?.fermer();
  base = null;
});

const lignes = (sql: string, p: readonly unknown[] = []): Ligne[] => base?.lireDirect<Ligne>(sql, p) ?? [];
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

async function ouvrir(): Promise<void> {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  base = b;
  await ecrireFermePlacement(b, { origine: true, triTunnel: true });
  b.recevoir(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, remplace, placement_x_m, placement_y_m, orientation_deg, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'R1', 'rang', 12, NULL, NULL, '2020-01-01', NULL, '[]', NULL, NULL, NULL, ?, ?, NULL)`,
    ['0192f0c1-28b0-7000-8000-0000000000a9', FERME, MANON[0], HORO, HORO],
  );
  const reelle = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const porte: PorteDonnees = {
    ...reelle,
    placer: (c) => {
      placements.push(structuredClone(c));
      return reelle.placer(c);
    },
  };
  const proprietes: ProprietesEditeurPlacement = { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
  await attendre(() => document.querySelector(`[data-testid="${T.batiment}"][data-id="${TRI_TUNNEL}"]`) !== null, 'tri-tunnel affiché');
}

async function dupliquerLeTunnel(): Promise<void> {
  const el = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${TRI_TUNNEL}"]`);
  await act(async () => {
    el?.focus();
    el?.dispatchEvent(new FocusEvent('focus'));
    el?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
  const panneau = un(T.panneau) ?? document.body;
  await toucher(bouton(BD.dupliquer, panneau));
  await attendre(() => un(TD.fiche) !== null, 'fiche « Dupliquer »');
  await toucher(bouton(BD.dupliquer, un(TD.fiche) ?? document.body));
}

describe('T90 : la copie reprend tous les emplacements, placés ou non', () => {
  it('le résumé et le brouillon comptent les 9 emplacements non placés (dont un rang), rien n’est écrit', async () => {
    await ouvrir();
    await dupliquerLeTunnel();
    expect(un('brouillon-serre')?.getAttribute('data-emplacements')).toBe('9');
    expect(placements).toEqual([]);
  });

  it('« Enregistrer » : un seul appel de 14 changements, 9 emplacement_creation, les 9 restent non placés, sorte et codes gardés', async () => {
    await ouvrir();
    await dupliquerLeTunnel();
    await toucher(bouton(B.enregistrer));
    await attendre(() => placements.length === 1 && lignes("SELECT id FROM batiment WHERE nom = 'Tri-tunnel 2'").length === 1, 'copie écrite');
    expect(placements[0]).toHaveLength(14);
    const copie = lignes("SELECT id FROM zone WHERE nom = 'Tri-tunnel 2' AND supprime_le IS NULL")[0];
    expect(copie).toBeDefined();
    const toutes = lignes(
      `SELECT e.code, e.sorte, e.longueur_m, e.largeur_m, e.placement_x_m AS x, z.nom AS zone FROM emplacement e JOIN zone z ON z.id = e.zone_id
        WHERE e.supprime_le IS NULL AND (z.id = ? OR z.zone_parente_id = ?) ORDER BY e.code`,
      [String(copie?.id), String(copie?.id)],
    );
    expect(toutes.map((e) => e.code)).toEqual(['M1-1', 'M1-2', 'M2-1', 'M2-2', 'M2-3', 'M2-4', 'M3-1', 'R1', 'T-1']);
    expect(toutes.every((e) => e.x === null)).toBe(true);
    expect(toutes.find((e) => e.code === 'R1')).toMatchObject({ sorte: 'rang', longueur_m: 12, largeur_m: null, zone: 'Manon 4' });
    expect(toutes.find((e) => e.code === 'M2-3')).toMatchObject({ sorte: 'planche', longueur_m: 38, largeur_m: 0.75, zone: 'Manon 5' });
    expect(toutes.find((e) => e.code === 'T-1')?.zone).toBe('Tri-tunnel 2');
  });
});
