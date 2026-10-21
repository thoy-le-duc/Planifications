// @vitest-environment happy-dom
/**
 * Tests d'acceptation T61 — un tap sur la consigne « Grelinette — hangar, mur nord » surligne en
 * 3D les deux points, le lieu de rangement et la planche, SANS calcul de chemin (docs/backlog/
 * T61-chemins-outils.md, règles 3 et 4 ; critère « tap → les deux points surlignés en 3D »).
 * Module pur (plan3d/rangement.ts) et composant (plan3d/Rangement3d.tsx), sur la base mémoire du
 * téléphone, sans réseau. Contrat : ./test/contrat-rangement.ts.
 */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, texte, toucher } from '../itineraires/test/outils.ts';
import type { VolumeScene } from './scene.ts';
import {
  CHEMIN_COMPOSANT_RANGEMENT_3D,
  CHEMIN_RANGEMENT_3D,
  TESTID_RANGEMENT_3D as T,
  type EntreeRangement,
  type EtatRangement3d,
  type ModuleComposantRangement3d,
  type ModuleRangement3d,
  type ProprietesRangement3d,
} from './test/contrat-rangement.ts';

const id = (n: number) => `0192f0c1-6161-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = id(0x1);
const AUTRE_FERME = id(0x2);
const UTILISATEUR = id(0x3);
const HANGAR = id(0x10);
const LIEU_HANGAR = id(0x11);
const PLACE_MUR_NORD = id(0x12);
const GRELINETTE = id(0x13);
const POINT_ABRI = id(0x14);
const LIEU_ABRI = id(0x15);
const ARROSOIR = id(0x16);
const CAVE = id(0x20);
const LIEU_CAVE = id(0x21);
const OUTIL_VOISIN = id(0x22);
const BETE = id(0x23);
const LIEU_RETIRE = id(0x24);
const P1 = id(0x31);
const P3 = id(0x32);
const PC1 = id(0x33);
const HORO = '2026-10-21T06:00:00.000Z';

/** Charge un module du ticket ; absent, l'échec dit ce qui manque (T61) au lieu d'une erreur d'import. */
async function charger<T>(chemin: string, export_: string): Promise<T> {
  let module: Record<string, unknown>;
  try {
    module = (await import(/* @vite-ignore */ chemin)) as Record<string, unknown>;
  } catch {
    throw new Error(`${chemin} n’existe pas encore (T61)`);
  }
  if (module[export_] === undefined) throw new Error(`${chemin} n’exporte pas encore ${export_} (T61)`);
  return module as T;
}

let m: ModuleRangement3d;
let c: ModuleComposantRangement3d;
beforeAll(async () => {
  m = await charger<ModuleRangement3d>(CHEMIN_RANGEMENT_3D, 'pointsRangement');
  c = await charger<ModuleComposantRangement3d>(CHEMIN_COMPOSANT_RANGEMENT_3D, 'Rangement3d');
});

const vol = (vid: string, code: string, x: number, z: number, placee = true): VolumeScene => ({ id: vid, code, zoneId: 'z', x, z, longueur: 30, largeur: 0.8, hauteur: 0.3, angle: 0, placee, couleur: '#336633', cleFamille: null, culture: null, occupationId: null });
const VOLUMES: readonly VolumeScene[] = [vol(P1, 'T2-P01', 12, -4), vol(P3, 'T2-P03', 14, -4), vol(PC1, 'PC-01', 60, -20, false)];

describe('T61 : pointsRangement, deux points et rien d’autre', () => {
  const ENTREE: EntreeRangement = {
    lieu: { batiment_id: HANGAR, point_plan_id: null },
    batiments: [{ id: HANGAR, nom: 'hangar', centre_x_m: -10, centre_y_m: 15 }],
    pointsPlan: [{ id: POINT_ABRI, nom: 'Abri du verger', x_m: 80, y_m: 10 }],
    volumes: VOLUMES,
    plancheId: P1,
  };

  it('hangar en (−10, 15) et planche T2-P01 : points de la scène (x, −y), les deux seulement', () => {
    const r = m.pointsRangement(ENTREE);
    expect(r).toEqual({ lieu: { nom: 'hangar', x: -10, z: -15 }, planche: { id: P1, code: 'T2-P01', x: 12, z: -4 } });
    expect(Object.keys(r ?? {}).sort(), 'aucun trajet : le plus court chemin n’est pas dans ce ticket').toEqual(['lieu', 'planche']);
  });

  it('lieu sur un point du plan : sa position (x_m, −y_m) et son nom', () => {
    const r = m.pointsRangement({ ...ENTREE, lieu: { batiment_id: null, point_plan_id: POINT_ABRI } });
    expect(r?.lieu).toEqual({ nom: 'Abri du verger', x: 80, z: -10 });
  });

  it('sans planche, ou planche inconnue de la scène, ou non placée : le lieu seul (planche nulle)', () => {
    expect(m.pointsRangement({ ...ENTREE, plancheId: null })?.planche).toBeNull();
    expect(m.pointsRangement({ ...ENTREE, plancheId: id(0x99) })?.planche).toBeNull();
    expect(m.pointsRangement({ ...ENTREE, plancheId: PC1 })?.planche).toBeNull();
    expect(m.pointsRangement({ ...ENTREE, plancheId: PC1 })?.lieu.nom).toBe('hangar');
  });

  it('lieu dont le bâtiment ou le point est inconnu : rien à montrer (null)', () => {
    expect(m.pointsRangement({ ...ENTREE, lieu: { batiment_id: id(0x98), point_plan_id: null } })).toBeNull();
    expect(m.pointsRangement({ ...ENTREE, lieu: { batiment_id: null, point_plan_id: null } })).toBeNull();
  });
});

describe('T61 : le composant surligne les deux points', () => {
  let base: BaseMemoire;
  let porte: PorteDonnees;
  let conteneur: HTMLDivElement;
  let racine: Root;
  let etats: EtatRangement3d[];
  let espionFetch: ReturnType<typeof vi.fn>;
  let transactions: number;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    conteneur = document.createElement('div');
    document.body.append(conteneur);
    racine = createRoot(conteneur);
    etats = [];
    transactions = 0;
    espionFetch = vi.fn(() => Promise.reject(new Error('hors ligne')));
    vi.stubGlobal('fetch', espionFetch);
    base = creerBaseMemoire(SCHEMA_LOCAL);
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    const batiment = (b: string, f: string, nom: string, x: number, y: number) => { r(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'hangar', 20, 12, 6, ?, ?, 0, NULL, ?, ?, NULL)`, [b, f, nom, x, y, HORO, HORO]); };
    batiment(HANGAR, FERME, 'hangar', -10, 15);
    batiment(CAVE, AUTRE_FERME, 'cave', 500, 500);
    r(`INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Abri du verger', 'repere', 80, 10, ?, ?, NULL)`, [POINT_ABRI, FERME, HORO, HORO]);
    const lieu = (l: string, f: string, b: string | null, p: string | null, supprime: string | null = null) => { r(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id, point_plan_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?)`, [l, f, b, p, HORO, HORO, supprime]); };
    lieu(LIEU_HANGAR, FERME, HANGAR, null);
    lieu(LIEU_ABRI, FERME, null, POINT_ABRI);
    lieu(LIEU_CAVE, AUTRE_FERME, CAVE, null);
    lieu(LIEU_RETIRE, FERME, HANGAR, null, HORO);
    r(`INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'mur nord', ?, ?, NULL)`, [PLACE_MUR_NORD, FERME, LIEU_HANGAR, HORO, HORO]);
    const outil = (o: string, f: string, nom: string, l: string, place: string | null, supprime: string | null = null) => { r(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, place_rangement_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [o, f, nom, l, place, HORO, HORO, supprime]); };
    outil(GRELINETTE, FERME, 'Grelinette', LIEU_HANGAR, PLACE_MUR_NORD);
    outil(ARROSOIR, FERME, 'Arrosoir', LIEU_ABRI, null);
    outil(OUTIL_VOISIN, AUTRE_FERME, 'Grelinette', LIEU_CAVE, null);
    outil(BETE, FERME, 'Bêche', LIEU_RETIRE, null);
    const compteuse = {
      getAll: (sql: string, p?: readonly unknown[]) => base.getAll(sql, p),
      execute: (sql: string, p?: readonly unknown[]) => base.execute(sql, p),
      writeTransaction: <T,>(fn: Parameters<BaseMemoire['writeTransaction']>[0]) => {
        transactions++;
        return base.writeTransaction(fn) as Promise<T>;
      },
      onChange: base.onChange.bind(base),
    };
    porte = creerPorte(compteuse as unknown as BaseMemoire, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  });

  afterEach(() => {
    act(() => {
      racine.unmount();
    });
    conteneur.remove();
    vi.unstubAllGlobals();
    base.fermer();
  });

  async function rendre(cible: ProprietesRangement3d['cible'], surFermer?: () => void): Promise<void> {
    const couche = createRef<HTMLDivElement>();
    await act(async () => {
      racine.render(
        createElement(c.Rangement3d, {
          porte,
          fermeId: FERME,
          volumes: VOLUMES,
          couche,
          cible,
          surEtat: (e: EtatRangement3d) => {
            etats.push(e);
          },
          ...(surFermer === undefined ? {} : { surFermer }),
        }),
      );
      await Promise.resolve();
    });
  }

  const reperes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.repere}"]`)];
  const dernier = (): EtatRangement3d => {
    const e = etats.at(-1);
    if (e === undefined) throw new Error('surEtat jamais appelé');
    return e;
  };
  const nom = (el: Element): string => el.getAttribute('aria-label') ?? texte(el);

  it('Grelinette (hangar, mur nord) pour la planche T2-P01 : deux repères surlignés, le lieu puis la planche, aux bons points', async () => {
    await rendre({ outilId: GRELINETTE, plancheId: P1 });
    await attendre(() => reperes().length === 2, 'deux repères');
    expect(document.querySelector(`[data-testid="${T.couche}"]`)).not.toBeNull();
    expect(reperes().map((r) => r.dataset.sorte)).toEqual(['lieu', 'planche']);
    expect(reperes().every((r) => r.dataset.surligne === 'oui')).toBe(true);
    expect(reperes().map((r) => nom(r))).toEqual(['Grelinette : hangar, mur nord', 'Planche T2-P01']);
    expect(reperes().map((r) => [Number(r.dataset.x), Number(r.dataset.z)])).toEqual([
      [-10, -15],
      [12, -4],
    ]);
  });

  it('l’état rendu à la vue : les deux points dans l’ordre, la planche en évidence, aucune clé de trajet', async () => {
    await rendre({ outilId: GRELINETTE, plancheId: P1 });
    await attendre(() => etats.length > 0 && dernier().points.length === 2, 'état à deux points');
    expect(dernier().points.map((p) => [p.pastille.x, p.pastille.z])).toEqual([
      [-10, -15],
      [12, -4],
    ]);
    expect([...(dernier().evidence ?? [])]).toEqual([P1]);
    const cles = Object.keys(dernier()).sort();
    expect(cles).toEqual(['colorer', 'evidence', 'points']);
  });

  it('un lieu sur un point du plan (Arrosoir à l’abri du verger, sans place)', async () => {
    await rendre({ outilId: ARROSOIR, plancheId: P3 });
    await attendre(() => reperes().length === 2, 'deux repères');
    expect(reperes().map((r) => nom(r))[0]).toBe('Arrosoir : Abri du verger');
    expect([Number(reperes()[0]?.dataset.x), Number(reperes()[0]?.dataset.z)]).toEqual([80, -10]);
    expect([...(dernier().evidence ?? [])]).toEqual([P3]);
  });

  it('planche non placée (PC-01) : le lieu seul est surligné, un message le dit', async () => {
    await rendre({ outilId: GRELINETTE, plancheId: PC1 });
    await attendre(() => reperes().length === 1, 'le lieu seul');
    expect(reperes()[0]?.dataset.sorte).toBe('lieu');
    const message = document.querySelector('[role="status"]');
    expect(texte(message)).toMatch(/placée/i);
  });

  it('sans planche (travail sans emplacement) : le lieu seul, sans message d’erreur', async () => {
    await rendre({ outilId: GRELINETTE, plancheId: null });
    await attendre(() => reperes().length === 1, 'le lieu seul');
    expect(dernier().evidence === null || dernier().evidence?.size === 0).toBe(true);
  });

  it.each([
    ['sans cible', null],
    ['outil d’une autre ferme', { outilId: OUTIL_VOISIN, plancheId: P1 }],
    ['outil inconnu', { outilId: id(0x97), plancheId: P1 }],
    ['outil dont le lieu est retiré', { outilId: BETE, plancheId: P1 }],
  ])('%s : rien n’est dessiné, état vide', async (_cas, cible) => {
    await rendre(cible);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
    expect(reperes()).toEqual([]);
    expect(etats.length).toBeGreaterThan(0);
    expect(dernier().points).toEqual([]);
    expect(dernier().evidence).toBeNull();
    expect(document.body.textContent).not.toContain('cave');
  });

  it('« Fermer » appelle surFermer ; le parent qui retire la cible efface repères et évidence', async () => {
    const surFermer = vi.fn();
    await rendre({ outilId: GRELINETTE, plancheId: P1 }, surFermer);
    await attendre(() => reperes().length === 2, 'deux repères');
    const fermer = document.querySelector<HTMLElement>(`[data-testid="${T.fermer}"]`);
    if (fermer === null) throw new Error('bouton Fermer absent');
    await toucher(fermer);
    expect(surFermer).toHaveBeenCalledTimes(1);
    await rendre(null, surFermer);
    await attendre(() => reperes().length === 0, 'repères retirés');
    expect(dernier().evidence).toBeNull();
  });

  it('hors ligne : aucun appel réseau, aucune écriture', async () => {
    await rendre({ outilId: GRELINETTE, plancheId: P1 });
    await attendre(() => reperes().length === 2, 'deux repères');
    expect(espionFetch).not.toHaveBeenCalled();
    expect(transactions).toBe(0);
  });
});
