/**
 * Tests d'acceptation T58 (contre-relecture) — chaînes de corrections et d'annulations de l'état
 * des serres :
 *   - oracle écrit ici, indépendant du cœur, sur des journaux tirés au hasard avec beaucoup
 *     d'horodatages ÉGAUX et des chaînes à plusieurs niveaux (correction d'une correction,
 *     annulation d'une correction), journal mélangé ;
 *   - correction dont l'original manque au journal : état et `depuis` ne dépendent pas de l'ordre
 *     des événements ; `depuis` = le plus ancien horodatage de la chaîne PRÉSENTE.
 *
 * Règles de l'oracle (celles de la vue evenements_en_vigueur, T10g, et de contrat.ts) :
 *   - une chaîne = l'original et tout ce qui le remplace, de proche en proche ; une annulation
 *     n'importe où dans la chaîne la retire en entier ;
 *   - sinon le maillon en vigueur est la correction la plus récente (heure, puis id), à défaut
 *     l'original ; il porte `actif` ; la chaîne vaut à l'heure de son ORIGINAL ;
 *   - entre deux chaînes : l'heure la plus récente l'emporte ; à heure égale, le plus grand id
 *     d'ORIGINAL (l'identité de la chaîne ne dépend pas de ses corrections) ;
 *   - `evenementId` rendu = le maillon en vigueur.
 */
import { describe, expect, it } from 'vitest';
import { EQUIPEMENTS_ABRI, etatCourant, etatsDesZones, type EvenementEtatAbri, type ZoneAbri } from './index.ts';
import type { EquipementAbri } from '../domaine/entites.ts';

const uuid = (n: number): string => `0192f0c1-5858-7000-8000-${n.toString(16).padStart(12, '0')}`;
const base = Date.parse('2026-10-22T05:00:00.000Z');
const iso = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();

function alea(graine: number): (n: number) => number {
  let g = graine;
  return (n) => {
    g = (g * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor(g / 65_536) % n;
  };
}

function melanger<T>(liste: readonly T[], tirer: (n: number) => number): T[] {
  const r = [...liste];
  for (let i = r.length - 1; i > 0; i--) {
    const j = tirer(i + 1);
    const a = r[i] as T;
    r[i] = r[j] as T;
    r[j] = a;
  }
  return r;
}

interface Attendu {
  readonly actif: boolean;
  readonly depuis: string;
  readonly evenementId: string;
}

function oracle(evenements: readonly EvenementEtatAbri[], zoneId: string, equipement: EquipementAbri, instant: string): Attendu | null {
  const parId = new Map(evenements.map((e) => [e.id, e]));
  const racine = (e: EvenementEtatAbri): EvenementEtatAbri => {
    let c = e;
    while (c.remplaceEvenementId !== null) {
      const p = parId.get(c.remplaceEvenementId);
      if (p === undefined) break;
      c = p;
    }
    return c;
  };
  const chaines = new Map<string, EvenementEtatAbri[]>();
  for (const e of evenements) {
    const r = racine(e).id;
    chaines.set(r, [...(chaines.get(r) ?? []), e]);
  }
  let meilleur: { t: string; racineId: string; r: Attendu } | null = null;
  for (const [racineId, membres] of chaines) {
    const original = parId.get(racineId);
    if (original?.zoneId !== zoneId || original.equipement !== equipement) continue;
    if (membres.some((m) => m.remplaceSorte === 'annulation')) continue;
    const corrections = membres.filter((m) => m.remplaceSorte === 'correction').sort((a, b) => (a.horodatage < b.horodatage ? -1 : a.horodatage > b.horodatage ? 1 : a.id < b.id ? -1 : 1));
    const vigueur = corrections.at(-1) ?? original;
    if (original.horodatage > instant) continue;
    const candidat = { t: original.horodatage, racineId, r: { actif: vigueur.actif, depuis: original.horodatage, evenementId: vigueur.id } };
    if (meilleur === null || candidat.t > meilleur.t || (candidat.t === meilleur.t && candidat.racineId > meilleur.racineId)) meilleur = candidat;
  }
  return meilleur?.r ?? null;
}

/** Journal tiré au hasard : peu d'instants distincts (beaucoup d'égalités), chaînes jusqu'à plusieurs niveaux. */
function journal(graine: number, originauxEgaux: boolean): EvenementEtatAbri[] {
  const tirer = alea(graine);
  const evenements: EvenementEtatAbri[] = [];
  let n = 0;
  const instants = [0, 30, 30, 60, 60, 60, 90, 120];
  const nouveau = (zoneId: string, equipement: EquipementAbri, sorte: 'correction' | 'annulation' | null, cible: string | null): EvenementEtatAbri => {
    n += 1;
    // Originaux à horodatages tous différents, ou (originauxEgaux) tirés parmi 6 instants seulement.
    const minutes = sorte === null && !originauxEgaux ? n * 7 : (instants[tirer(instants.length)] ?? 0);
    return { id: uuid(1000 + tirer(5000) * 10 + (n % 10)), zoneId, equipement, actif: tirer(2) === 1, horodatage: iso(minutes), remplaceSorte: sorte, remplaceEvenementId: cible };
  };
  const ids = new Set<string>();
  const ajouter = (e: EvenementEtatAbri): void => {
    if (ids.has(e.id)) return;
    ids.add(e.id);
    evenements.push(e);
  };
  for (let i = 0; i < 40; i++) ajouter(nouveau(uuid(1 + tirer(2)), EQUIPEMENTS_ABRI[tirer(2)] ?? 'portes', null, null));
  for (let i = 0; i < 40; i++) {
    const cible = evenements[tirer(evenements.length)];
    if (cible === undefined) continue;
    const sorte = tirer(5) === 0 ? 'annulation' : 'correction';
    ajouter(nouveau(cible.zoneId, cible.equipement, sorte, cible.id));
  }
  return evenements;
}

const ZONES: readonly ZoneAbri[] = [1, 2].map((i) => ({ id: uuid(i), nom: `Serre ${String(i)}`, typeAbri: 'serre', equipementsAbri: null }));

function verifier(graine: number, originauxEgaux: boolean): void {
  const evenements = journal(graine, originauxEgaux);
  expect(evenements.some((e) => e.remplaceSorte === 'correction' && evenements.some((p) => p.id === e.remplaceEvenementId && p.remplaceSorte === 'correction')), 'le jeu contient des corrections de corrections').toBe(true);
  expect(evenements.some((e) => e.remplaceSorte === 'annulation' && evenements.some((p) => p.id === e.remplaceEvenementId && p.remplaceSorte === 'correction')), 'le jeu contient des annulations de corrections').toBe(true);
  const tirer = alea(graine + 1);
  const instants = originauxEgaux ? [-10, 0, 30, 59, 60, 90, 200] : [-10, 0, 100, 150, 201, 280, 400];
  for (const ordre of [evenements, melanger(evenements, tirer), melanger(evenements, tirer)]) {
    for (const minutes of instants) {
      const instant = iso(minutes);
      const etats = etatsDesZones(ordre, ZONES, instant);
      for (const zone of ZONES) {
        for (const { equipement, etat } of etats.get(zone.id) ?? []) {
          const voulu = oracle(evenements, zone.id, equipement, instant);
          expect(etat, `${zone.nom} ${equipement} à ${instant}`).toEqual(voulu);
          expect(etatCourant(ordre, zone.id, equipement, instant)).toEqual(voulu);
        }
      }
    }
  }
}

describe('T58 : oracle sur des chaînes à plusieurs niveaux (originaux à heures différentes, corrections à heures égales)', () => {
  it.each([1, 2, 3, 58, 2026, 31_415])('graine %i : heures d’originaux distinctes : résultat de l’oracle, quel que soit l’ordre', (graine) => {
    verifier(graine, false);
  });
});

describe('T58 : oracle avec des originaux à horodatages ÉGAUX (à égalité, le plus grand id d’original l’emporte)', () => {
  it.each([1, 2, 3, 58, 2026, 31_415])('graine %i : heures d’originaux égales : résultat de l’oracle, quel que soit l’ordre', (graine) => {
    verifier(graine, true);
  });
});

describe('T58 : correction dont l’original manque au journal', () => {
  const Z = uuid(1);
  const ABSENT = uuid(9_999);
  const e = (n: number, minutes: number, actif: boolean, sorte: 'correction' | 'annulation', cible: string): EvenementEtatAbri => ({
    id: uuid(n),
    zoneId: Z,
    equipement: 'portes',
    actif,
    horodatage: iso(minutes),
    remplaceSorte: sorte,
    remplaceEvenementId: cible,
  });
  const etat = (evts: readonly EvenementEtatAbri[], minutes = 300) => etatCourant(evts, Z, 'portes', iso(minutes));

  function memeResultatDansTousLesOrdres(evts: readonly EvenementEtatAbri[], attendu: Attendu | null): void {
    const tirer = alea(7);
    expect(etat(evts)).toEqual(attendu);
    for (let i = 0; i < 12; i++) expect(etat(melanger(evts, tirer)), `mélange ${String(i)}`).toEqual(attendu);
    expect(etat([...evts].reverse())).toEqual(attendu);
  }

  it('deux corrections de l’original absent : l’état est celui de la plus récente, `depuis` le plus ancien horodatage de la chaîne', () => {
    const tardive = e(1, 10, true, 'correction', ABSENT);
    const precoce = e(2, 8, false, 'correction', ABSENT);
    memeResultatDansTousLesOrdres([tardive, precoce], { actif: true, depuis: iso(8), evenementId: tardive.id });
  });

  it('trois corrections de l’original absent, dans tous les ordres', () => {
    const a = e(1, 20, true, 'correction', ABSENT);
    const b = e(2, 5, false, 'correction', ABSENT);
    const c = e(3, 12, false, 'correction', ABSENT);
    memeResultatDansTousLesOrdres([a, b, c], { actif: true, depuis: iso(5), evenementId: a.id });
  });

  it('correction d’une correction, original absent : `depuis` est le plus ancien des maillons présents, même s’il corrige le plus récent', () => {
    const c1 = e(1, 10, true, 'correction', ABSENT);
    const c2 = e(2, 9, false, 'correction', c1.id);
    // La plus récente des corrections est c1 ; la chaîne présente commence avec c2.
    memeResultatDansTousLesOrdres([c1, c2], { actif: true, depuis: iso(9), evenementId: c1.id });
  });

  it('même heure pour deux corrections de l’absent : le plus grand identifiant l’emporte, dans tous les ordres', () => {
    const a = e(1, 10, true, 'correction', ABSENT);
    const b = e(2, 10, false, 'correction', ABSENT);
    memeResultatDansTousLesOrdres([a, b], { actif: false, depuis: iso(10), evenementId: b.id });
  });

  it('annulation de l’original absent : toute la chaîne disparaît, dans tous les ordres', () => {
    const c = e(1, 10, true, 'correction', ABSENT);
    const a = e(2, 11, true, 'annulation', ABSENT);
    memeResultatDansTousLesOrdres([c, a], null);
  });

  it('avant l’heure du plus ancien maillon présent : état inconnu', () => {
    const tardive = e(1, 10, true, 'correction', ABSENT);
    const precoce = e(2, 8, false, 'correction', ABSENT);
    expect(etat([tardive, precoce], 7)).toBeNull();
    expect(etat([precoce, tardive], 8)).toMatchObject({ depuis: iso(8) });
  });

  it('la chaîne de l’absent rivalise avec un événement ordinaire : le plus récent des deux, dans tous les ordres', () => {
    const ordinaire: EvenementEtatAbri = { id: uuid(50), zoneId: Z, equipement: 'portes', actif: false, horodatage: iso(9), remplaceSorte: null, remplaceEvenementId: null };
    const tardive = e(1, 10, true, 'correction', ABSENT);
    const precoce = e(2, 8, false, 'correction', ABSENT);
    // La chaîne vaut dès 8 h, l'événement ordinaire à 9 h : le dernier en date est l'ordinaire.
    memeResultatDansTousLesOrdres([ordinaire, tardive, precoce], { actif: false, depuis: iso(9), evenementId: ordinaire.id });
  });
});
