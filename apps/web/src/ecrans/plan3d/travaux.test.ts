/**
 * Tests d'acceptation T37 — les travaux du jour dans la vue 3D : l'adaptateur pur (travaux.ts) sur
 * la « ferme du jour » AVEC travaux de l'écran Aujourd'hui (../aujourdhui/test/ferme-du-jour.ts,
 * aujourd'hui = 2026-09-30). Contrat : ./test/contrat-travaux.ts. Les travaux viennent des
 * fonctions de l'écran Aujourd'hui (lireJournee, calculerJournee, tachesDeLEcran), jamais d'un
 * second calcul. Le panneau et l'ordre dessiné sont dans ./travaux-panneau.test.tsx et
 * ./travaux-ordre.test.tsx.
 *
 * Planches de la ferme du jour, tâches attendues (ordre de l'écran, attendu.taches) :
 *   1 carotte semis direct  PC-P01 (volume non placé)   6 compost            T2-P01 (placé)
 *   2 grelinette            T2-P01 (placé)               7 batavia plantation T2-P01 (placé)
 *   3 fraise début récolte  S1-G01 (absente)             8 radis semis direct T2-P05 (absente)
 *   4 chou plantation       T2-P03 (placé)               9 palissage          T2-P07 (placé)
 *   5 désherbage            T2-P07 (placé)
 */
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { creerBaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, lireJournee, type TacheJour } from '../aujourdhui/calculs.ts';
import { cleTache, CAMPAGNE, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { VolumeScene } from './scene.ts';
import type { ModuleTravaux3d, ModuleVuesAujourdhui, TravauxDuJour3d } from './test/contrat-travaux.ts';

const CHEMIN_TRAVAUX = './travaux.ts';
const CHEMIN_VUES = '../aujourdhui/vues.ts';
const AUJOURDHUI = '2026-09-30';

let m: ModuleTravaux3d;
let vues: ModuleVuesAujourdhui;
let ferme: FermeDuJour;
let taches: readonly TacheJour[];

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux3d;
  vues = (await import(/* @vite-ignore */ CHEMIN_VUES)) as ModuleVuesAujourdhui;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  const lignes = await lireJournee(creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> }), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`));
  taches = calculerJournee(lignes, AUJOURDHUI).taches;
  base.fermer();
});

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

/** Scène à la main : T2-P01, T2-P03, T2-P07 placées ; PC-P01 présente mais non placée ; T2-P05 et S1-G01 absentes. */
const SCENE = {
  semaine: 40,
  libelleSemaine: 'S40',
  socles: [],
  batiments: [],
  volumes: [
    volume(EMPLACEMENT.t2p01, 'T2-P01', 1, true),
    volume(EMPLACEMENT.t2p03, 'T2-P03', 2, true),
    volume(EMPLACEMENT.t2p07, 'T2-P07', 3, true),
    volume(EMPLACEMENT.pcp01, 'PC-P01', 4, false),
  ],
};

function ou<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('valeur absente');
  return v;
}
const cleDe = (nom: string): string => ferme.attendu.cles[nom] ?? '';
const norme = (s: string): string => s.replace(/\s+/g, ' ').trim();
const rangDe = (cle: string): number => ferme.attendu.taches.indexOf(cle) + 1;
const tachesDe = (...cles: string[]): TacheJour[] => cles.map((c) => ou(taches.find((t) => t.cle === c)));

describe('T37 : la source des travaux du jour est celle de l’écran Aujourd’hui', () => {
  it('la journée relue donne les neuf tâches de la ferme du jour, dans l’ordre du moteur', () => {
    expect(taches.map((t) => t.cle)).toEqual(ferme.attendu.taches);
  });

  it('tachesDeLEcran : en retard d’abord, puis la semaine, ordre relatif conservé, entrée intacte', () => {
    const melange = [...taches].reverse();
    const copie = [...melange];
    const rendu = vues.tachesDeLEcran(melange);
    expect(melange).toEqual(copie);
    expect(rendu.map((t) => t.cle)).toEqual(ferme.attendu.taches.filter((c) => (ferme.attendu.retards[c] ?? 0) > 0).reverse().concat(ferme.attendu.taches.filter((c) => (ferme.attendu.retards[c] ?? 0) === 0).reverse()));
    // Sur l'ordre du moteur, c'est l'ordre de l'écran.
    expect(vues.tachesDeLEcran(taches).map((t) => t.cle)).toEqual(ferme.attendu.taches);
  });

  it('sans limite de nombre (l’écran en cache après 25 par groupe, la 3D les montre toutes)', () => {
    const beaucoup = Array.from({ length: 60 }, () => ou(taches[0]));
    expect(vues.tachesDeLEcran(beaucoup)).toHaveLength(60);
  });
});

describe('T37 : travauxDuJour3d', () => {
  it('trois travaux sur deux planches → deux pastilles, numéros dans l’ordre de l’écran Aujourd’hui', () => {
    const trois = tachesDe(cleDe('grelinette'), cleDe('desherbage'), cleDe('compost')); // ordre du moteur : J−12, J−6, J−3
    const r = m.travauxDuJour3d(trois, SCENE, AUJOURDHUI);
    expect(r.travaux.map((t) => t.cle)).toEqual([cleDe('grelinette'), cleDe('desherbage'), cleDe('compost')]);
    expect(r.travaux.map((t) => t.rang)).toEqual([1, 2, 3]);
    expect(r.pastilles).toHaveLength(2);
    const [premiere, seconde] = r.pastilles;
    expect(premiere).toMatchObject({ planche: EMPLACEMENT.t2p01, numeros: [1, 3], libelle: '1 · 3', x: 1, z: 2 });
    expect(seconde).toMatchObject({ planche: EMPLACEMENT.t2p07, numeros: [2], libelle: '2', x: 3, z: 6 });
  });

  it('toute la ferme du jour : numéros = rangs de l’écran, une pastille par planche placée', () => {
    const r = m.travauxDuJour3d(taches, SCENE, AUJOURDHUI);
    expect(r.travaux.map((t) => t.cle)).toEqual(ferme.attendu.taches);
    expect(r.pastilles.map((p) => [p.planche, p.numeros])).toEqual([
      [EMPLACEMENT.t2p01, [rangDe(cleDe('grelinette')), rangDe(cleDe('compost')), rangDe(cleTache(SERIE.batavia, 'plantation'))]],
      [EMPLACEMENT.t2p03, [rangDe(cleTache(SERIE.chou, 'plantation'))]],
      [EMPLACEMENT.t2p07, [rangDe(cleDe('desherbage')), rangDe(cleDe('palissage'))]],
    ]);
    expect(r.pastilles.map((p) => p.numeros[0])).toEqual([...r.pastilles.map((p) => p.numeros[0])].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('un travail sans planche placée est listé, sans pastille (planche absente de la scène, ou non placée)', () => {
    const r = m.travauxDuJour3d(taches, SCENE, AUJOURDHUI);
    expect(r.travaux).toHaveLength(9);
    const sans = (cle: string) => r.travaux.find((t) => t.cle === cle);
    for (const cle of [cleTache(SERIE.carotte, 'semis_direct'), cleTache(CAMPAGNE.fraise, 'debut_recolte'), cleTache(SERIE.radis, 'semis_direct')]) {
      expect(sans(cle)?.planche, cle).toBeNull();
    }
    expect(sans(cleTache(SERIE.chou, 'plantation'))?.planche).toBe(EMPLACEMENT.t2p03);
    const numerosEnPastille = r.pastilles.flatMap((p) => p.numeros);
    for (const t of r.travaux.filter((x) => x.planche === null)) expect(numerosEnPastille).not.toContain(t.rang);
    expect(r.pastilles.map((p) => p.planche)).not.toContain(EMPLACEMENT.pcp01);
  });

  it('scène sans aucune planche placée : tout est listé, aucune pastille', () => {
    const r = m.travauxDuJour3d(taches, { ...SCENE, volumes: SCENE.volumes.map((v) => ({ ...v, placee: false })) }, AUJOURDHUI);
    expect(r.travaux).toHaveLength(9);
    expect(r.pastilles).toEqual([]);
  });

  it('aucune tâche : rien', () => {
    expect(m.travauxDuJour3d([], SCENE, AUJOURDHUI)).toEqual({ travaux: [], pastilles: [] });
  });

  it('textes : « <rang>. <phrase de la carte> — <zone>, <code> »', () => {
    const r = m.travauxDuJour3d(taches, SCENE, AUJOURDHUI);
    const texte = (cle: string) => norme(r.travaux.find((t) => t.cle === cle)?.texte ?? '');
    expect(texte(cleTache(SERIE.chou, 'plantation'))).toBe(`${String(rangDe(cleTache(SERIE.chou, 'plantation')))}. Planter chou pointu — Tunnel 2, T2-P03`);
    expect(texte(cleDe('grelinette'))).toBe(`${String(rangDe(cleDe('grelinette')))}. Grelinette batavia — Tunnel 2, T2-P01`);
    expect(texte(cleDe('desherbage'))).toBe(`${String(rangDe(cleDe('desherbage')))}. Désherbage tomate — Tunnel 2, T2-P07`);
    expect(texte(cleTache(CAMPAGNE.fraise, 'debut_recolte'))).toBe(`${String(rangDe(cleTache(CAMPAGNE.fraise, 'debut_recolte')))}. Récolter fraise — Serre 1, S1-G01`);
    expect(texte(cleTache(SERIE.carotte, 'semis_direct'))).toBe('1. Semer carotte — Plein champ, PC-P01');
  });

  it('pure : mêmes entrées, même sortie, entrées intactes', () => {
    const entree = [...taches];
    const copie = [...entree];
    const scene = JSON.parse(JSON.stringify(SCENE)) as typeof SCENE;
    const a: TravauxDuJour3d = m.travauxDuJour3d(entree, SCENE, AUJOURDHUI);
    const b: TravauxDuJour3d = m.travauxDuJour3d(entree, SCENE, AUJOURDHUI);
    expect(a).toEqual(b);
    expect(entree).toEqual(copie);
    expect(SCENE).toEqual(scene);
  });
});

describe('T37 : travailSuivant', () => {
  const travaux = (planches: (string | null)[]) => planches.map((planche, i) => ({ rang: i + 1, cle: `c${String(i)}`, texte: `${String(i + 1)}. x`, planche, enRetard: false }));

  it('du premier avec planche quand rien n’est choisi, puis dans l’ordre, puis retour au premier', () => {
    const t = travaux(['a', 'b', 'c']);
    expect(m.travailSuivant(t, null)).toBe(1);
    expect(m.travailSuivant(t, 1)).toBe(2);
    expect(m.travailSuivant(t, 2)).toBe(3);
    expect(m.travailSuivant(t, 3)).toBe(1);
  });

  it('saute les travaux sans planche', () => {
    const t = travaux([null, 'a', null, 'b', null]);
    expect(m.travailSuivant(t, null)).toBe(2);
    expect(m.travailSuivant(t, 2)).toBe(4);
    expect(m.travailSuivant(t, 4)).toBe(2);
  });

  it('un seul travail avec planche : il reste le même', () => {
    expect(m.travailSuivant(travaux([null, 'a']), 2)).toBe(2);
  });

  it('aucun travail avec planche, ou aucun travail : null ; un rang inconnu repart du premier', () => {
    expect(m.travailSuivant(travaux([null, null]), null)).toBeNull();
    expect(m.travailSuivant([], null)).toBeNull();
    expect(m.travailSuivant(travaux(['a', 'b']), 99)).toBe(1);
  });
});

describe('T37 : lireTachesDuJour (lecture seule, les fonctions de l’écran Aujourd’hui)', () => {
  it('rend les tâches de l’écran, dans son ordre, sans rien écrire', async () => {
    const base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
    let transactions = 0;
    const compteuse = {
      getAll: base.getAll.bind(base),
      execute: (sql: string, p?: unknown[]) => {
        transactions++;
        return base.execute(sql, p);
      },
      writeTransaction: <T,>(fn: Parameters<typeof base.writeTransaction<T>>[0]) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: base.onChange.bind(base),
    };
    const porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    const ecrituresAvant = base.ecritures.length;
    const lues = await m.lireTachesDuJour(porte, FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`));
    expect(lues.map((t) => t.cle)).toEqual(ferme.attendu.taches);
    expect(transactions, 'aucune écriture').toBe(0);
    expect(base.ecritures.length, 'aucune instruction d’écriture').toBe(ecrituresAvant);
    base.fermer();
  });
});
