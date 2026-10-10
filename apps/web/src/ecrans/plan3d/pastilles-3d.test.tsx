// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37b — les pastilles numérotées des travaux du jour :
 *   - une tâche qui vise plusieurs planches a une pastille sur CHACUNE (travaux.ts) ;
 *   - `placerPastilles` (Pastilles.tsx) n'écrit aucun style quand la caméra et la toile n'ont pas
 *     bougé (la mise en page n'est pas relancée à chaque image).
 * Contrat : ./test/contrat-telephone.ts (section 6). Les tests de T37 (travaux.test.ts) ne changent pas.
 * Sur la ferme du jour AVEC travaux (aujourd'hui = 2026-09-30), comme travaux.test.ts.
 */
import { PerspectiveCamera } from 'three';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { creerBaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, lireJournee, type TacheJour } from '../aujourdhui/calculs.ts';
import { EMPLACEMENT, ecrireFermeDuJour, FERME, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { PastilleDessinee } from './Pastilles.tsx';
import type { VolumeScene } from './scene.ts';
import type { ModuleTravaux3d } from './test/contrat-travaux.ts';

const CHEMIN_TRAVAUX = './travaux.ts';
const CHEMIN_PASTILLES = './Pastilles.tsx';
const AUJOURDHUI = '2026-09-30';

interface ModulePastilles {
  placerPastilles(couche: HTMLElement, camera: PerspectiveCamera, largeur: number, hauteur: number, pastilles: readonly PastilleDessinee[]): void;
}

let m: ModuleTravaux3d;
let p: ModulePastilles;
let ferme: FermeDuJour;
let taches: readonly TacheJour[];

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux3d;
  p = (await import(/* @vite-ignore */ CHEMIN_PASTILLES)) as ModulePastilles;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  const lignes = await lireJournee(creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> }), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`));
  taches = calculerJournee(lignes, AUJOURDHUI).taches;
  base.fermer();
});

function ou<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('valeur absente');
  return v;
}
const volume = (id: string, code: string, x: number, placee: boolean): VolumeScene => ({
  id,
  code,
  zoneId: 'zone',
  x,
  z: 2 * x,
  longueur: 12,
  largeur: 0.8,
  hauteur: 0.3,
  angle: 0,
  placee,
  couleur: '#888888',
  cleFamille: null,
  culture: null,
  occupationId: null,
});
const SCENE = {
  semaine: 40,
  libelleSemaine: 'S40',
  socles: [],
  batiments: [],
  volumes: [volume(EMPLACEMENT.t2p01, 'T2-P01', 1, true), volume(EMPLACEMENT.t2p03, 'T2-P03', 2, true), volume(EMPLACEMENT.t2p07, 'T2-P07', 3, true), volume(EMPLACEMENT.pcp01, 'PC-P01', 4, false)],
};

/** Les emplacements d'une tâche de la ferme du jour, relevés tels que l'écran les porte. */
const emplacementsDe = (cle: string): TacheJour['tache']['emplacements'] => ou(taches.find((t) => t.cle === cle)).tache.emplacements;

/** La première tâche, posée sur plusieurs planches à la fois (T2-P01, T2-P03 et T2-P07). */
function surPlusieursPlanches(): { readonly tache: TacheJour; readonly cles: readonly string[] } {
  const cleGrelinette = ou(ferme.attendu.cles.grelinette);
  const cleChou = ou(ferme.attendu.taches.find((c) => c.endsWith(':plantation') && emplacementsDe(c).some((e) => e.id === EMPLACEMENT.t2p03)));
  const cleDesherbage = ou(ferme.attendu.cles.desherbage);
  const origine = ou(taches.find((t) => t.cle === cleGrelinette));
  const emplacements = [
    ...emplacementsDe(cleGrelinette).filter((e) => e.id === EMPLACEMENT.t2p01),
    ...emplacementsDe(cleChou).filter((e) => e.id === EMPLACEMENT.t2p03),
    ...emplacementsDe(cleDesherbage).filter((e) => e.id === EMPLACEMENT.t2p07),
  ];
  expect(emplacements.map((e) => e.id), 'banc : trois planches placées').toEqual([EMPLACEMENT.t2p01, EMPLACEMENT.t2p03, EMPLACEMENT.t2p07]);
  return { tache: { ...origine, tache: { ...origine.tache, emplacements } }, cles: [cleGrelinette, cleChou, cleDesherbage] };
}

describe('T37b : une tâche sur plusieurs planches a une pastille sur chacune', () => {
  it('trois planches placées → trois pastilles, qui portent toutes le numéro de la tâche', () => {
    const { tache } = surPlusieursPlanches();
    const r = m.travauxDuJour3d([tache], SCENE, AUJOURDHUI);
    expect(r.travaux).toHaveLength(1);
    expect(r.pastilles.map((x) => x.planche).sort()).toEqual([EMPLACEMENT.t2p01, EMPLACEMENT.t2p03, EMPLACEMENT.t2p07].sort());
    for (const x of r.pastilles) {
      expect(x.numeros, `planche ${x.planche}`).toEqual([1]);
      expect(x.libelle).toBe('1');
    }
    // Chaque pastille est posée sur sa planche.
    for (const x of r.pastilles) {
      const v = ou(SCENE.volumes.find((s) => s.id === x.planche));
      expect([x.x, x.z]).toEqual([v.x, v.z]);
    }
  });

  it('le vol de la caméra va toujours à la première planche placée de la tâche', () => {
    const { tache } = surPlusieursPlanches();
    expect(ou(m.travauxDuJour3d([tache], SCENE, AUJOURDHUI).travaux[0]).planche).toBe(EMPLACEMENT.t2p01);
  });

  it('une planche non placée ou absente de la scène n’a pas de pastille, les autres en ont une', () => {
    const { tache } = surPlusieursPlanches();
    const sansLaDeuxieme = { ...SCENE, volumes: SCENE.volumes.map((v) => (v.id === EMPLACEMENT.t2p03 ? { ...v, placee: false } : v)) };
    const r = m.travauxDuJour3d([tache], sansLaDeuxieme, AUJOURDHUI);
    expect(r.pastilles.map((x) => x.planche).sort()).toEqual([EMPLACEMENT.t2p01, EMPLACEMENT.t2p07].sort());
  });

  it('les numéros d’une planche réunissent les tâches qui la visent seule et celles qui visent plusieurs planches, croissants', () => {
    const { tache } = surPlusieursPlanches();
    const seule = ou(taches.find((t) => t.cle === ou(ferme.attendu.cles.compost))); // T2-P01 seule
    const r = m.travauxDuJour3d([seule, tache], SCENE, AUJOURDHUI);
    const surP01 = r.pastilles.find((x) => x.planche === EMPLACEMENT.t2p01);
    expect(surP01?.numeros).toEqual([1, 2]);
    expect(surP01?.libelle).toBe('1 · 2');
    expect(r.pastilles.find((x) => x.planche === EMPLACEMENT.t2p03)?.numeros).toEqual([2]);
  });

  it('un travail sur une seule planche ne change pas (une pastille, comme en T37)', () => {
    const seule = ou(taches.find((t) => t.cle === ou(ferme.attendu.cles.compost)));
    const r = m.travauxDuJour3d([seule], SCENE, AUJOURDHUI);
    expect(r.pastilles.map((x) => [x.planche, x.numeros])).toEqual([[EMPLACEMENT.t2p01, [1]]]);
  });
});

// ── Pas de réécriture de style quand la caméra ne bouge pas ──────────────────────────────────

function couche(n: number): { readonly element: HTMLDivElement; readonly ecritures: () => number } {
  const element = document.createElement('div');
  let ecritures = 0;
  for (let i = 0; i < n; i += 1) {
    const span = document.createElement('span');
    const style = span.style;
    Object.defineProperty(span, 'style', {
      value: new Proxy(style, {
        set(cible, cle, valeur) {
          ecritures += 1;
          return Reflect.set(cible, cle, valeur);
        },
      }),
    });
    element.append(span);
  }
  return { element, ecritures: () => ecritures };
}

function pastilles(): PastilleDessinee[] {
  const r = m.travauxDuJour3d([ou(taches.find((t) => t.cle === ou(ferme.attendu.cles.grelinette))), ou(taches.find((t) => t.cle === ou(ferme.attendu.cles.desherbage)))], SCENE, AUJOURDHUI);
  return r.pastilles.map((pastille) => ({ pastille, retard: false }));
}

function camera(x: number): PerspectiveCamera {
  const c = new PerspectiveCamera(40, 390 / 600, 0.1, 2000);
  c.position.set(x, 12, 14);
  c.lookAt(2, 0, 4);
  c.updateMatrixWorld();
  return c;
}

describe('T37b : placerPastilles ne réécrit pas le style quand rien ne bouge', () => {
  it('banc : deux pastilles, et le premier appel écrit leur place', () => {
    const liste = pastilles();
    expect(liste).toHaveLength(2);
    const c = couche(liste.length);
    p.placerPastilles(c.element, camera(0), 390, 600, liste);
    expect(c.ecritures()).toBeGreaterThan(0);
  });

  it('même caméra, même toile, mêmes pastilles : aucune écriture, image après image', () => {
    const liste = pastilles();
    const c = couche(liste.length);
    const cam = camera(0);
    p.placerPastilles(c.element, cam, 390, 600, liste);
    const apres = c.ecritures();
    for (let i = 0; i < 5; i += 1) p.placerPastilles(c.element, cam, 390, 600, liste);
    expect(c.ecritures(), 'écritures de style supplémentaires').toBe(apres);
  });

  it('la caméra bouge : les pastilles sont replacées', () => {
    const liste = pastilles();
    const c = couche(liste.length);
    const cam = camera(0);
    p.placerPastilles(c.element, cam, 390, 600, liste);
    const avant = c.ecritures();
    cam.position.x += 3;
    cam.lookAt(2, 0, 4);
    p.placerPastilles(c.element, cam, 390, 600, liste);
    expect(c.ecritures()).toBeGreaterThan(avant);
  });

  it('la toile change de taille (rotation du téléphone) : les pastilles sont replacées', () => {
    const liste = pastilles();
    const c = couche(liste.length);
    const cam = camera(0);
    p.placerPastilles(c.element, cam, 390, 600, liste);
    const avant = c.ecritures();
    p.placerPastilles(c.element, cam, 600, 390, liste);
    expect(c.ecritures()).toBeGreaterThan(avant);
  });

  it('de nouvelles pastilles (autre jeu de travaux) sont posées même si la caméra n’a pas bougé', () => {
    const liste = pastilles();
    const c = couche(liste.length);
    const cam = camera(0);
    p.placerPastilles(c.element, cam, 390, 600, liste);
    const avant = c.ecritures();
    p.placerPastilles(c.element, cam, 390, 600, [...liste].reverse());
    expect(c.ecritures()).toBeGreaterThan(avant);
  });
});
