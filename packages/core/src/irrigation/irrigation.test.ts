/**
 * Tests d'acceptation T57 — règles des vannes d'irrigation (docs/backlog/T57-vannes-irrigation.md) :
 * création de 60 vannes en lot aux codes uniques, lien daté vanne ↔ emplacements dont l'historique
 * est gardé quand le réseau change, une vanne qui arrose deux zones, dernière irrigation par
 * planche et sa classe (aujourd'hui, hier, plus ancienne). Contrat : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerIrrigation, type Irrigation, type LienVanne, type ModuleIrrigation, type Resultat } from './test/contrat.ts';

let m: ModuleIrrigation;

beforeAll(async () => {
  m = await chargerIrrigation();
});

function valeur<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.message}`);
  return r.valeur;
}

function refuse<T>(r: Resultat<T>, motif?: RegExp): void {
  expect(r.ok, 'aurait dû être refusé').toBe(false);
  if (r.ok) return;
  expect(r.message.trim().length).toBeGreaterThan(0);
  expect(r.message).not.toMatch(/\b(error|invalid|must|undefined|NaN|null)\b/i);
  if (motif !== undefined) expect(r.message).toMatch(motif);
}

// ── Création en lot ──────────────────────────────────────────────────────────────────────────

describe('T57 : 60 vannes en lot, codes uniques', () => {
  it('« 60 vannes, V1 à V60 » : numéros 1 à 60, noms V1 à V60, tous différents', () => {
    const lot = valeur(m.vannesDuLot({ nombre: 60, prefixe: 'V' }, []));
    expect(lot).toHaveLength(60);
    expect(lot.map((v) => v.numeroVanne)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(lot[0]).toEqual({ numeroVanne: 1, nom: 'V1' });
    expect(lot[59]).toEqual({ numeroVanne: 60, nom: 'V60' });
    expect(new Set(lot.map((v) => v.numeroVanne)).size).toBe(60);
    expect(new Set(lot.map((v) => v.nom)).size).toBe(60);
  });

  it('un second lot continue après les numéros pris : V61 à V65', () => {
    const pris = Array.from({ length: 60 }, (_, i) => i + 1);
    const lot = valeur(m.vannesDuLot({ nombre: 5, prefixe: 'V' }, pris));
    expect(lot.map((v) => v.nom)).toEqual(['V61', 'V62', 'V63', 'V64', 'V65']);
  });

  it('les trous sont comblés d’abord, jamais un numéro pris', () => {
    const lot = valeur(m.vannesDuLot({ nombre: 5, prefixe: ' V ' }, [3, 7, 1]));
    expect(lot.map((v) => v.numeroVanne)).toEqual([2, 4, 5, 6, 8]);
    expect(lot.map((v) => v.nom)).toEqual(['V2', 'V4', 'V5', 'V6', 'V8']);
  });

  it('préfixe vide : « Vanne 1 », « Vanne 2 »', () => {
    expect(valeur(m.vannesDuLot({ nombre: 2, prefixe: '  ' }, [])).map((v) => v.nom)).toEqual(['Vanne 1', 'Vanne 2']);
  });

  it('nombre hors bornes ou non entier, préfixe trop long, numéros épuisés : refusés', () => {
    refuse(m.vannesDuLot({ nombre: 0, prefixe: 'V' }, []));
    refuse(m.vannesDuLot({ nombre: 201, prefixe: 'V' }, []));
    refuse(m.vannesDuLot({ nombre: 2.5, prefixe: 'V' }, []));
    refuse(m.vannesDuLot({ nombre: Number.NaN, prefixe: 'V' }, []));
    refuse(m.vannesDuLot({ nombre: 3, prefixe: 'x'.repeat(21) }, []));
    refuse(m.vannesDuLot({ nombre: 2, prefixe: 'V' }, Array.from({ length: m.PLAFONDS_VANNES.numeroMax - 1 }, (_, i) => i + 1)));
  });
});

describe('T57 : une vanne seule', () => {
  it('numéro libre, nom nettoyé, débit facultatif', () => {
    expect(valeur(m.validerVanne({ numeroVanne: 12, nom: '  Fraises serre 2 ', debitLitresHeure: 850.5 }, [1, 2]))).toEqual({
      numeroVanne: 12,
      nom: 'Fraises serre 2',
      debitLitresHeure: 850.5,
    });
    expect(valeur(m.validerVanne({ numeroVanne: 1, nom: 'V1', debitLitresHeure: null }, [])).debitLitresHeure).toBeNull();
  });

  it('numéro déjà pris : refusé, le message le dit', () => {
    refuse(m.validerVanne({ numeroVanne: 12, nom: 'V12', debitLitresHeure: null }, [11, 12]), /existe déjà/);
  });

  it('numéro, nom ou débit invalides : refusés', () => {
    refuse(m.validerVanne({ numeroVanne: 0, nom: 'V0', debitLitresHeure: null }, []));
    refuse(m.validerVanne({ numeroVanne: 10_000, nom: 'V', debitLitresHeure: null }, []));
    refuse(m.validerVanne({ numeroVanne: 1.5, nom: 'V', debitLitresHeure: null }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: '   ', debitLitresHeure: null }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: 'x'.repeat(201), debitLitresHeure: null }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: 'V3', debitLitresHeure: 0 }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: 'V3', debitLitresHeure: -5 }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: 'V3', debitLitresHeure: Number.POSITIVE_INFINITY }, []));
    refuse(m.validerVanne({ numeroVanne: 3, nom: 'V3', debitLitresHeure: 1_000_001 }, []));
  });

  it('position : les deux ou aucune, finie, à 5 km au plus de l’origine', () => {
    expect(valeur(m.validerPositionVanne(null, null))).toBeNull();
    expect(valeur(m.validerPositionVanne(120.5, -14))).toEqual({ x: 120.5, y: -14 });
    refuse(m.validerPositionVanne(12, null));
    refuse(m.validerPositionVanne(null, 3));
    refuse(m.validerPositionVanne(Number.NaN, 3));
    refuse(m.validerPositionVanne('12', 3));
    refuse(m.validerPositionVanne(4_000, 4_000));
  });
});

// ── Liens datés ──────────────────────────────────────────────────────────────────────────────

const V12 = 'vanne-12';
const V13 = 'vanne-13';
const lien = (id: string, secteurId: string, emplacementId: string, du: string, au: string | null = null): LienVanne => ({ id, secteurId, emplacementId, du, au });

describe('T57 : lien daté vanne ↔ emplacements, historique gardé', () => {
  const liens: readonly LienVanne[] = [
    lien('l1', V12, 'P3', '2026-01-01'),
    lien('l2', V12, 'P4', '2026-01-01', '2026-06-30'),
    lien('l3', V12, 'P5', '2026-07-01'),
    lien('l4', V13, 'P6', '2026-01-01'),
  ];

  it('un lien est actif de du à au, bornes comprises', () => {
    expect(m.lienActifLe(lien('x', V12, 'P1', '2026-03-01', '2026-03-31'), '2026-03-01')).toBe(true);
    expect(m.lienActifLe(lien('x', V12, 'P1', '2026-03-01', '2026-03-31'), '2026-03-31')).toBe(true);
    expect(m.lienActifLe(lien('x', V12, 'P1', '2026-03-01', '2026-03-31'), '2026-04-01')).toBe(false);
    expect(m.lienActifLe(lien('x', V12, 'P1', '2026-03-01', null), '2026-02-28')).toBe(false);
    expect(m.lienActifLe(lien('x', V12, 'P1', '2026-03-01', null), '2030-01-01')).toBe(true);
  });

  it('ce qu’une vanne arrose dépend du jour : P3 et P4 en mai, P3 et P5 en octobre', () => {
    expect(m.emplacementsArroses(liens, V12, '2026-05-10')).toEqual(['P3', 'P4']);
    expect(m.emplacementsArroses(liens, V12, '2026-10-19')).toEqual(['P3', 'P5']);
    expect(m.emplacementsArroses(liens, V13, '2026-10-19')).toEqual(['P6']);
    expect(m.emplacementsArroses(liens, 'inconnue', '2026-10-19')).toEqual([]);
  });

  it('changer le réseau : le lien retiré est fermé la veille (son passé reste), le nouveau part du jour', () => {
    const c = m.changerLiens(liens, V12, ['P5', 'P7'], '2026-10-19');
    expect(c).toEqual({ fermer: [{ id: 'l1', au: '2026-10-18' }], supprimer: [], creer: ['P7'] });
  });

  it('rien à changer : rien n’est écrit', () => {
    expect(m.changerLiens(liens, V12, ['P3', 'P5'], '2026-10-19')).toEqual({ fermer: [], supprimer: [], creer: [] });
    expect(m.changerLiens(liens, V12, ['P5', 'P3'], '2026-10-19')).toEqual({ fermer: [], supprimer: [], creer: [] });
  });

  it('un lien créé le jour même et retiré aussitôt n’a pas de passé : il est supprimé, pas fermé', () => {
    const avec = [...liens, lien('l5', V12, 'P8', '2026-10-19')];
    expect(m.changerLiens(avec, V12, ['P3', 'P5'], '2026-10-19')).toEqual({ fermer: [], supprimer: ['l5'], creer: [] });
    const futur = [...liens, lien('l6', V12, 'P9', '2026-11-01')];
    expect(m.changerLiens(futur, V12, ['P3', 'P5'], '2026-10-19')).toEqual({ fermer: [], supprimer: ['l6'], creer: [] });
  });

  it('un emplacement revenu dans le réseau a un lien neuf ; l’ancien, fini, reste tel quel', () => {
    const c = m.changerLiens(liens, V12, ['P3', 'P4', 'P5'], '2026-10-19');
    expect(c).toEqual({ fermer: [], supprimer: [], creer: ['P4'] });
  });

  it('les liens des autres vannes ne sont jamais touchés', () => {
    const c = m.changerLiens(liens, V12, [], '2026-10-19');
    expect(c.fermer.map((f) => f.id).sort()).toEqual(['l1', 'l3']);
    expect(c.fermer.every((f) => f.au === '2026-10-18')).toBe(true);
    expect(c.supprimer).toEqual([]);
    expect(c.creer).toEqual([]);
  });

  it('veille du 1er mars 2028 (année bissextile) : 29 février', () => {
    const c = m.changerLiens([lien('a', V12, 'P1', '2027-01-01')], V12, [], '2028-03-01');
    expect(c.fermer).toEqual([{ id: 'a', au: '2028-02-29' }]);
  });
});

describe('T57 : une vanne qui arrose deux zones', () => {
  // V20 arrose T2-P01 et T2-P02 (Tunnel 2) et PC-01 (Plein champ).
  const liens = [lien('a', 'V20', 'T2-P01', '2026-01-01'), lien('b', 'V20', 'T2-P02', '2026-01-01'), lien('c', 'V20', 'PC-01', '2026-01-01')];

  it('elle arrose les trois planches, des deux zones', () => {
    expect(m.emplacementsArroses(liens, 'V20', '2026-10-19')).toEqual(['T2-P01', 'T2-P02', 'PC-01']);
  });

  it('une irrigation de la vanne compte pour chacune de ses planches, dans les deux zones', () => {
    const irr: Irrigation = { id: 'e1', secteurId: 'V20', date: '2026-10-19', horodatage: '2026-10-19T05:00:00.000Z', dureeMinutes: 20 };
    const d = m.dernieresIrrigations([irr], liens);
    expect([...d.keys()].sort()).toEqual(['PC-01', 'T2-P01', 'T2-P02']);
    for (const e of d.values()) expect(e).toEqual(irr);
  });

  it('la cocher dans une seule zone à partir d’aujourd’hui garde l’autre zone dans l’historique', () => {
    expect(m.changerLiens(liens, 'V20', ['PC-01'], '2026-10-19')).toEqual({
      fermer: [
        { id: 'a', au: '2026-10-18' },
        { id: 'b', au: '2026-10-18' },
      ],
      supprimer: [],
      creer: [],
    });
  });
});

// ── Dernière irrigation ──────────────────────────────────────────────────────────────────────

describe('T57 : dernière irrigation de chaque planche', () => {
  const liens = [lien('l1', V12, 'P3', '2026-01-01'), lien('l2', V12, 'P4', '2026-01-01', '2026-10-17'), lien('l3', V12, 'P5', '2026-10-18'), lien('l4', V13, 'P3', '2026-01-01')];
  const irr = (id: string, secteurId: string, date: string, heure: string, dureeMinutes = 20): Irrigation => ({ id, secteurId, date, horodatage: `${date}T${heure}:00.000Z`, dureeMinutes });

  it('la plus récente gagne (date, puis heure, puis id), toutes vannes confondues', () => {
    const d = m.dernieresIrrigations([irr('a', V12, '2026-10-18', '06:00'), irr('b', V13, '2026-10-19', '05:00', 30), irr('c', V12, '2026-10-19', '04:00')], liens);
    expect(d.get('P3')?.id).toBe('b');
    expect(d.get('P5')?.id).toBe('c');
  });

  it('une irrigation ne compte que pour les planches arrosées CE jour-là', () => {
    const d = m.dernieresIrrigations([irr('ancienne', V12, '2026-10-10', '06:00'), irr('neuve', V12, '2026-10-19', '06:00')], liens);
    // P4 n'était plus arrosée le 19 : sa dernière irrigation reste celle du 10.
    expect(d.get('P4')?.id).toBe('ancienne');
    // P5 n'était pas encore arrosée le 10.
    expect(d.get('P5')?.id).toBe('neuve');
    expect(d.has('P6')).toBe(false);
  });

  it('derniereIrrigationDe : la plus récente de la vanne, nulle sans irrigation', () => {
    const toutes = [irr('a', V12, '2026-10-18', '06:00'), irr('b', V12, '2026-10-18', '07:00'), irr('c', V13, '2026-10-19', '05:00')];
    expect(m.derniereIrrigationDe(toutes, V12)?.id).toBe('b');
    expect(m.derniereIrrigationDe(toutes, 'inconnue')).toBeNull();
  });

  it('classe : aujourd’hui, hier, plus ancienne, jamais', () => {
    expect(m.classeIrrigation('2026-10-19', '2026-10-19')).toBe('aujourdhui');
    expect(m.classeIrrigation('2026-10-18', '2026-10-19')).toBe('hier');
    expect(m.classeIrrigation('2026-10-17', '2026-10-19')).toBe('ancienne');
    expect(m.classeIrrigation('2025-12-31', '2026-01-01')).toBe('hier');
    expect(m.classeIrrigation(null, '2026-10-19')).toBe('jamais');
    expect(m.classeIrrigation('2026-10-20', '2026-10-19')).toBe('aujourdhui');
  });
});
