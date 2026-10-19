// @vitest-environment happy-dom
/**
 * Tests d'acceptation T57 — les vannes dans la vue 3D, composant (plan3d/Vannes3d.tsx) : repères
 * numérotés, tap → planches de la vanne mises en évidence et fiche, filtre « Irrigation », et
 * l'irrigation saisie HORS LIGNE depuis le repère (base mémoire du téléphone, aucun réseau).
 * Le composant n'importe pas three : la vue le pose sur sa toile. Contrat : ./test/contrat-vannes.ts.
 */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, dialogueOuEchec, liste, nomAccessible, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireFermeVannes, FERME, P3, P4, P5, PC1, PC2, UTILISATEUR, VANNE_12, VANNE_13 } from '../parcellaire/test/ferme-vannes.ts';
import { TESTID_IRRIGATION } from '../aujourdhui/test/contrat-irrigation.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';
import { CHEMIN_COMPOSANT_VANNES_3D, TESTID_VANNES_3D as T, type EtatVannes3d, type ModuleComposantVannes3d } from './test/contrat-vannes.ts';

const AUJOURDHUI = '2026-10-19';
const MAINTENANT = new Date('2026-10-19T07:00:00.000Z');

let m: ModuleComposantVannes3d;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_COMPOSANT_VANNES_3D)) as ModuleComposantVannes3d;
});

const vol = (id: string, code: string, x: number): VolumeScene => ({ id, code, zoneId: 'z', x, z: 0, longueur: 30, largeur: 0.8, hauteur: 0.3, angle: 0, placee: true, couleur: '#336633', cleFamille: null, culture: 'Fraise', occupationId: null });
const VOLUMES: readonly VolumeScene[] = [vol(P3, 'P3', 0), vol(P4, 'P4', 2), vol(P5, 'P5', 4), vol(PC1, 'PC-01', 40), vol(PC2, 'PC-02', 42)];
const SCENE: Scene = { semaine: 0, libelleSemaine: 'S43', socles: [], batiments: [], volumes: VOLUMES };

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;
let etats: EtatVannes3d[];
let espionFetch: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  etats = [];
  espionFetch = vi.fn(() => Promise.reject(new Error('hors ligne')));
  vi.stubGlobal('fetch', espionFetch);
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, { vannes: true });
  // V12 irriguée hier, V13 il y a une semaine.
  const irrigation = (id: string, vanne: string, date: string, horodatage: string) => {
    base.recevoir(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le, origine_id)
       VALUES (?, ?, 'irrigation', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', NULL, NULL, ?, ?, NULL)`,
      [id, FERME, date, horodatage, UTILISATEUR, JSON.stringify({ secteurIrrigationId: vanne, dureeMinutes: 20 }), horodatage],
    );
  };
  irrigation('0192f0c1-5757-7000-8000-0000000000e1', VANNE_12, '2026-10-18', '2026-10-18T05:00:00.000Z');
  irrigation('0192f0c1-5757-7000-8000-0000000000e2', VANNE_13, '2026-10-12', '2026-10-12T05:00:00.000Z');
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base.fermer();
});

async function rendre(): Promise<void> {
  const couche = createRef<HTMLDivElement>();
  await act(async () => {
    racine.render(
      createElement(m.Vannes3d, {
        porte,
        fermeId: FERME,
        volumes: VOLUMES,
        couche,
        surEtat: (e: EtatVannes3d) => {
          etats.push(e);
        },
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => reperes().length > 0, 'repères affichés');
  expect(couche.current?.dataset.testid).toBe(T.couche);
}

const reperes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.repere}"]`)];
const repere = (vanne: string): HTMLElement => {
  const r = reperes().find((x) => x.dataset.vanne === vanne);
  if (r === undefined) throw new Error(`repère ${vanne} absent`);
  return r;
};
const dernier = (): EtatVannes3d => {
  const e = etats.at(-1);
  if (e === undefined) throw new Error('surEtat jamais appelé');
  return e;
};
const couleurs = (e: EtatVannes3d) => e.colorer(appliquerFiltres(SCENE, FILTRES_TOUT)).volumes.map((v) => [v.id, v.estompe]);

describe('T57 : repères des vannes dans la 3D', () => {
  it('un repère numéroté par vanne qui a une place (V12, V13 ; V14 n’arrose rien), dans l’ordre transmis à la vue', async () => {
    await rendre();
    expect(reperes().map((r) => texte(r))).toEqual(['V12', 'V13']);
    expect(reperes().map((r) => nomAccessible(r))).toEqual(['Vanne V12', 'Vanne V13']);
    expect(reperes().every((r) => r.tagName === 'BUTTON')).toBe(true);
    // V12 en tête de P3 (centre 0, longueur 30) : (−15, 0) ; V13 en tête de PC-01 : (25, 0).
    expect(dernier().reperes.map((r) => [r.pastille.x, r.pastille.z])).toEqual([
      [-15, 0],
      [25, 0],
    ]);
    expect(dernier().evidence).toBeNull();
    expect(dernier().irrigation).toBe(false);
  });

  it('tap sur V12 : ses planches P3 et P4 en évidence, les autres estompées, fiche « V12 — arrose P3, P4 — dernière irrigation : hier… »', async () => {
    await rendre();
    await toucher(repere(VANNE_12));
    expect(repere(VANNE_12).getAttribute('aria-pressed')).toBe('true');
    expect([...(dernier().evidence ?? [])].sort()).toEqual([P3, P4].sort());
    expect(couleurs(dernier())).toEqual([
      [P3, false],
      [P4, false],
      [P5, true],
      [PC1, true],
      [PC2, true],
    ]);
    const fiche = document.querySelector<HTMLElement>(`[data-testid="${T.fiche}"]`);
    expect(fiche?.getAttribute('role')).toBe('dialog');
    expect(texte(fiche)).toMatch(/^V12 — arrose P3, P4 — dernière irrigation : hier \d+ h( \d\d)?, 20 min/);
    // Second tap : plus rien en évidence.
    await toucher(repere(VANNE_12));
    expect(dernier().evidence).toBeNull();
    expect(document.querySelector(`[data-testid="${T.fiche}"]`)).toBeNull();
  });

  it('filtre « Irrigation » : la légende s’affiche, les planches se colorent (aucune estompée)', async () => {
    await rendre();
    const filtre = document.querySelector<HTMLElement>(`[data-testid="${T.filtre}"]`);
    expect(filtre?.getAttribute('aria-pressed')).toBe('false');
    if (filtre === null) throw new Error('filtre absent');
    await toucher(filtre);
    expect(filtre.getAttribute('aria-pressed')).toBe('true');
    expect(dernier().irrigation).toBe(true);
    const legende = document.querySelector<HTMLElement>(`[data-testid="${T.legende}"]`);
    for (const mot of ['Aujourd’hui', 'Hier', 'Plus ancienne', 'Jamais']) expect(texte(legende)).toContain(mot);
    const avant = appliquerFiltres(SCENE, FILTRES_TOUT);
    const colore = dernier().colorer(avant).volumes;
    // P3, P4 : hier ; PC-01 : plus ancienne ; P5, PC-02 : jamais. Hier ≠ plus ancienne ≠ jamais.
    const c = Object.fromEntries(colore.map((v) => [v.id, v.couleur]));
    expect(c[P3]).toBe(c[P4]);
    expect(c[P5]).toBe(c[PC2]);
    expect(new Set([c[P3], c[PC1], c[P5]]).size).toBe(3);
    expect(colore.every((v) => !v.estompe)).toBe(true);
  });
});

describe('T57 : irrigation saisie hors ligne depuis le repère', () => {
  it('repère V13 → « Irrigation » → 30 min → Enregistrer : un événement dans la base du téléphone, PC-01 passe à « aujourd’hui »', async () => {
    await rendre();
    await toucher(repere(VANNE_13));
    await toucher(bouton('Irrigation', document.querySelector<HTMLElement>(`[data-testid="${T.fiche}"]`) ?? document));
    await attendre(() => document.querySelector(`[data-testid="${TESTID_IRRIGATION.saisie}"]`) !== null, 'saisie d’irrigation ouverte');
    const saisie = dialogueOuEchec('Irrigation');
    expect(liste('Vanne', saisie).value).toBe(VANNE_13);
    await toucher(bouton('30 min', saisie));
    expect(champ('Durée (min)', saisie).value).toBe('30');
    transactions = 0;
    await toucher(bouton('Enregistrer', saisie));
    await attendre(() => document.querySelector(`[data-testid="${TESTID_IRRIGATION.enregistree}"]`) !== null, 'irrigation notée');
    expect(transactions).toBe(1);
    expect(espionFetch).not.toHaveBeenCalled();
    const ecrits = base.lireDirect<Record<string, string | null>>(`SELECT * FROM evenement WHERE type = 'irrigation' AND date = ?`, [AUJOURDHUI]);
    expect(ecrits).toHaveLength(1);
    const e = ecrits[0] ?? {};
    expect(JSON.parse(String(e.detail))).toEqual({ secteurIrrigationId: VANNE_13, dureeMinutes: 30 });
    expect(e.source).toBe('tap');
    expect(validerSaisie({ ...e }).ok).toBe(true);
    expect(texte(document.querySelector(`[data-testid="${TESTID_IRRIGATION.enregistree}"]`))).toContain('Irrigation notée : V13, 30 min');
    // La 3D suit la base : PC-01 est irriguée aujourd'hui (filtre « Irrigation »).
    const filtre = document.querySelector<HTMLElement>(`[data-testid="${T.filtre}"]`);
    if (filtre === null) throw new Error('filtre absent');
    await toucher(filtre);
    await attendre(() => {
      const c = Object.fromEntries(dernier().colorer(appliquerFiltres(SCENE, FILTRES_TOUT)).volumes.map((v) => [v.id, v.couleur]));
      return c[PC1] !== c[P3] && c[PC1] !== c[P5];
    }, 'PC-01 colorée « aujourd’hui »');
  });
});
