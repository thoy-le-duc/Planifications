/**
 * Tests d'acceptation T58 (relecture) — vitesse de l'état courant des serres : 40 zones × 5
 * équipements sur 20 000 événements `etat_abri`, dont des corrections et des annulations, en moins
 * de 30 ms (médiane de mesures min(mural, CPU) après échauffement : mesurer(), T31). Le résultat
 * est contrôlé contre un oracle simple écrit ici, et un petit cas chiffré à la main.
 */
import { describe, expect, it } from 'vitest';
import { mesurer } from '../test/mesurer.ts';
import type { EquipementAbri } from '../domaine/entites.ts';
import { EQUIPEMENTS_ABRI, etatsDesZones, type EvenementEtatAbri, type ZoneAbri } from './index.ts';

const uuid = (n: number): string => `0192f0c1-5858-7000-8000-${n.toString(16).padStart(12, '0')}`;
const DEBUT = Date.parse('2026-09-01T00:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

describe('T58 : petit cas chiffré', () => {
  it('ouvert 7 h, fermé 12 h, fermeture annulée 12 h 05, faîtage ouvert 8 h corrigé en fermé à 15 h', () => {
    const z = uuid(1);
    const zone: ZoneAbri = { id: z, nom: 'Serre 1', typeAbri: 'serre', equipementsAbri: null };
    const e = (n: number, equipement: EquipementAbri, actif: boolean, h: string, remplace?: [('correction' | 'annulation'), string]): EvenementEtatAbri => ({
      id: uuid(100 + n),
      zoneId: z,
      equipement,
      actif,
      horodatage: `2026-10-22T${h}:00.000Z`,
      remplaceSorte: remplace?.[0] ?? null,
      remplaceEvenementId: remplace?.[1] ?? null,
    });
    const evts = [
      e(1, 'ouvrants_lateraux', true, '07:00'),
      e(2, 'ouvrants_lateraux', false, '12:00'),
      e(3, 'ouvrants_lateraux', false, '12:05', ['annulation', uuid(102)]),
      e(4, 'ouvrants_faitage', true, '08:00'),
      e(5, 'ouvrants_faitage', false, '15:00', ['correction', uuid(104)]),
    ];
    const etats = etatsDesZones(evts, [zone], '2026-10-22T16:00:00.000Z').get(z) ?? [];
    const parNom = Object.fromEntries(etats.map((x) => [x.equipement, x.etat]));
    expect(parNom.ouvrants_lateraux).toMatchObject({ actif: true, depuis: '2026-10-22T07:00:00.000Z' });
    expect(parNom.ouvrants_faitage).toMatchObject({ actif: false, depuis: '2026-10-22T08:00:00.000Z', evenementId: uuid(105) });
    expect(parNom.portes).toBeNull();
  });
});

describe('T58 : 40 zones × 5 équipements, 20 000 événements', () => {
  const zones: ZoneAbri[] = Array.from({ length: 40 }, (_, i) => ({ id: uuid(1 + i), nom: `Serre ${String(i + 1)}`, typeAbri: 'serre', equipementsAbri: null }));
  let graine = 58;
  const alea = (n: number): number => {
    graine = (graine * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor(graine / 65_536) % n;
  };

  // 18 000 changements, 1 000 corrections, 1 000 annulations ; horodatages tous différents.
  const evenements: EvenementEtatAbri[] = [];
  const originaux: EvenementEtatAbri[] = [];
  let rang = 0;
  const prochain = (): { id: string; horodatage: string } => {
    rang += 1;
    return { id: uuid(10_000 + rang), horodatage: iso(DEBUT + rang * 60_000) };
  };
  for (let i = 0; i < 18_000; i++) {
    const e: EvenementEtatAbri = { ...prochain(), zoneId: zones[alea(40)]?.id ?? '', equipement: EQUIPEMENTS_ABRI[alea(5)] ?? 'portes', actif: alea(2) === 1, remplaceSorte: null, remplaceEvenementId: null };
    originaux.push(e);
    evenements.push(e);
  }
  const corriges = new Map<string, EvenementEtatAbri>();
  const annules = new Set<string>();
  for (let i = 0; i < 1_000; i++) {
    const o = originaux[alea(18_000)];
    if (o === undefined) continue;
    const c: EvenementEtatAbri = { ...prochain(), zoneId: o.zoneId, equipement: o.equipement, actif: alea(2) === 1, remplaceSorte: 'correction', remplaceEvenementId: o.id };
    evenements.push(c);
    corriges.set(o.id, c);
  }
  for (let i = 0; i < 1_000; i++) {
    const o = originaux[alea(18_000)];
    if (o === undefined) continue;
    evenements.push({ ...prochain(), zoneId: o.zoneId, equipement: o.equipement, actif: o.actif, remplaceSorte: 'annulation', remplaceEvenementId: o.id });
    annules.add(o.id);
  }
  // Mélangés : l'ordre du journal ne doit pas compter.
  for (let i = evenements.length - 1; i > 0; i--) {
    const j = alea(i + 1);
    const echange = evenements.splice(j, 1, ...evenements.slice(i, i + 1));
    evenements.splice(i, 1, ...echange);
  }
  const INSTANT = iso(DEBUT + (rang + 10) * 60_000);

  /** Oracle : chaque changement annulé disparaît ; corrigé, il prend l'état de sa correction à son heure. */
  function oracle(): Map<string, boolean | null> {
    const dernier = new Map<string, { t: string; id: string; actif: boolean }>();
    for (const o of originaux) {
      if (annules.has(o.id)) continue;
      const etat = corriges.get(o.id)?.actif ?? o.actif;
      const cle = `${o.zoneId}|${o.equipement}`;
      const d = dernier.get(cle);
      if (d === undefined || o.horodatage > d.t) dernier.set(cle, { t: o.horodatage, id: o.id, actif: etat });
    }
    return new Map([...dernier].map(([k, v]) => [k, v.actif]));
  }

  it('moins de 30 ms en médiane, et le résultat est celui de l’oracle', () => {
    const { mediane, detail, resultat } = mesurer(() => etatsDesZones(evenements, zones, INSTANT), { echauffement: 3, mesures: 5, borneMs: 30 });
    expect(resultat.size).toBe(40);
    const attendu = oracle();
    let connus = 0;
    for (const [zoneId, etats] of resultat) {
      expect(etats.map((x) => x.equipement)).toEqual([...EQUIPEMENTS_ABRI]);
      for (const x of etats) {
        const voulu = attendu.get(`${zoneId}|${x.equipement}`);
        expect(x.etat?.actif ?? null, `${zoneId} ${x.equipement}`).toBe(voulu ?? null);
        if (x.etat !== null) connus += 1;
      }
    }
    expect(connus).toBeGreaterThan(190);
    expect(mediane, detail).toBeLessThan(30);
  });
});
