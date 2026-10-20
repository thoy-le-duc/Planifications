/**
 * Tests d'acceptation T69 — délai avant récolte par planche traitée (docs/backlog/T69-dar-par-planche.md,
 * réponse de Théophane à Q46 : « on peut récolter les autres »). Contrat : ./test/contrat.ts
 * (interdictionRecolte, texteInterdiction). Aucune base, aucun réseau, aucune horloge.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerPhyto, type ModulePhyto, type TraitementLu } from './test/contrat.ts';

let m: ModulePhyto;
beforeAll(async () => {
  m = await chargerPhyto();
});

const uuid = (n: number): string => `0192f0c1-6969-7000-8000-${n.toString(16).padStart(12, '0')}`;
const [P1, P2, P3, P4, P5] = [1, 2, 3, 4, 5].map((n) => uuid(0x10 + n)) as [string, string, string, string, string];
const PLANCHES = [P1, P2, P3, P4, P5];
const TOMATES = uuid(0x30);
const KIWIS = uuid(0x31);
const VOISINE = uuid(0x32);
const BOUILLIE = uuid(0x20);
const SOUFRE = uuid(0x21);

function traitement(n: number, emplacements: readonly string[], cultureId: string | null, recolteAutoriseeLe = '2027-05-13', produit = BOUILLIE): TraitementLu {
  return {
    id: uuid(0x100 + n),
    date: '2027-05-10',
    horodatage: `2027-05-10T08:${String(n).padStart(2, '0')}:00.000Z`,
    emplacementIds: emplacements,
    remplaceSorte: null,
    remplaceEvenementId: null,
    produitPhytoId: produit,
    recolteAutoriseeLe,
    cultureId,
  };
}

/** Tomates sur 5 planches, traitées sur P3 et P4 seulement (Bouillie, DAR jusqu'au 13/05). */
const SUR_P3_P4 = traitement(1, [P3, P4], TOMATES);

describe('T69 : un traitement qui désigne des planches n’interdit que ces planches', () => {
  it('5 planches, 2 traitées : récolte sur une non traitée permise, sur une traitée interdite', () => {
    for (const p of [P1, P2, P5]) expect(m.interdictionRecolte([SUR_P3_P4], [p], '2027-05-11', TOMATES), p).toBeNull();
    for (const p of [P3, P4]) {
      expect(m.interdictionRecolte([SUR_P3_P4], [p], '2027-05-11', TOMATES), p).toEqual({
        evenementId: SUR_P3_P4.id,
        produitPhytoId: BOUILLIE,
        dateTraitement: '2027-05-10',
        recolteAutoriseeLe: '2027-05-13',
      });
    }
    // Plusieurs planches non traitées : permises ensemble.
    expect(m.interdictionRecolte([SUR_P3_P4], [P1, P2, P5], '2027-05-11', TOMATES)).toBeNull();
    // Le délai écoulé, les planches traitées redeviennent libres.
    expect(m.interdictionRecolte([SUR_P3_P4], [P3], '2027-05-13', TOMATES)).toBeNull();
  });

  it('planche traitée seule : toute la récolte est interdite, pas de liste de planches', () => {
    const i = m.interdictionRecolte([SUR_P3_P4], [P3], '2027-05-11', TOMATES);
    expect(i?.planches).toBeUndefined();
    if (i === null) throw new Error('interdiction attendue');
    expect(m.texteInterdiction(i, 'Bouillie bordelaise')).toBe('Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)');
    // Les deux planches traitées ensemble : toute la récolte est interdite aussi.
    expect(m.interdictionRecolte([SUR_P3_P4], [P4, P3], '2027-05-11', TOMATES)?.planches).toBeUndefined();
  });

  it('récolte sur toutes les planches : interdite, et l’interdiction nomme les planches traitées (ordre demandé, casse ignorée)', () => {
    const i = m.interdictionRecolte([SUR_P3_P4], PLANCHES.map((p) => p.toUpperCase()), '2027-05-11', TOMATES);
    expect(i?.evenementId).toBe(SUR_P3_P4.id);
    expect(i?.planches?.map((p) => p.toLowerCase())).toEqual([P3, P4]);
    // Ordre des planches demandées.
    expect(m.interdictionRecolte([SUR_P3_P4], [P5, P4, P2, P3], '2027-05-11', TOMATES)?.planches?.map((p) => p.toLowerCase())).toEqual([P4, P3]);
  });

  it('récolte de la culture sans planche, culture en partie traitée : interdite, l’interdiction nomme les planches', () => {
    const i = m.interdictionRecolte([SUR_P3_P4], [], '2027-05-11', TOMATES);
    expect(i).toEqual({
      evenementId: SUR_P3_P4.id,
      produitPhytoId: BOUILLIE,
      dateTraitement: '2027-05-10',
      recolteAutoriseeLe: '2027-05-13',
      planches: [P3, P4],
    });
    if (i === null) throw new Error('interdiction attendue');
    expect(m.texteInterdiction(i, 'Bouillie bordelaise', ['P3', 'P4'])).toBe('Récolte interdite sur P3, P4 jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)');
    expect(m.interdictionRecolte([SUR_P3_P4], [], '2027-05-13', TOMATES)).toBeNull();
    // Une autre culture, sans planche, n'est pas concernée.
    expect(m.interdictionRecolte([SUR_P3_P4], [], '2027-05-11', VOISINE)).toBeNull();
  });

  it('deux traitements sur des planches différentes : leurs planches s’ajoutent, sans doublon ; la date la plus tardive l’emporte', () => {
    const p3 = traitement(1, [P3], TOMATES, '2027-05-13');
    const p4 = traitement(2, [P4, P4.toUpperCase()], TOMATES, '2027-05-20', SOUFRE);
    for (const ordre of [
      [p3, p4],
      [p4, p3],
    ]) {
      const toutes = m.interdictionRecolte(ordre, PLANCHES, '2027-05-11', TOMATES);
      expect(toutes?.evenementId).toBe(p4.id);
      expect(toutes?.recolteAutoriseeLe).toBe('2027-05-20');
      expect(toutes?.planches?.map((p) => p.toLowerCase())).toEqual([P3, P4]);
      const sans = m.interdictionRecolte(ordre, [], '2027-05-11', TOMATES);
      expect(sans?.evenementId).toBe(p4.id);
      expect([...(sans?.planches ?? [])].map((p) => p.toLowerCase()).sort()).toEqual([P3, P4].sort());
      expect(m.interdictionRecolte(ordre, [P1], '2027-05-11', TOMATES)).toBeNull();
    }
    // P3 libre le 13/05, P4 encore interdit : la récolte sur toutes les planches nomme P4 seul.
    expect(m.interdictionRecolte([p3, p4], PLANCHES, '2027-05-14', TOMATES)?.planches).toEqual([P4]);
  });

  it('traitement annulé : la culture redevient libre, planches comprises', () => {
    const annulation = { ...traitement(9, [P3, P4], TOMATES), remplaceSorte: 'annulation' as const, remplaceEvenementId: SUR_P3_P4.id };
    expect(m.interdictionRecolte([SUR_P3_P4, annulation], [], '2027-05-11', TOMATES)).toBeNull();
    expect(m.interdictionRecolte([SUR_P3_P4, annulation], PLANCHES, '2027-05-11', TOMATES)).toBeNull();
  });
});

describe('T69 : un traitement sans planche interdit toute la culture', () => {
  const SANS_PLANCHE = traitement(3, [], KIWIS);

  it('kiwis traités sans rang : toute la culture interdite, avec ou sans planche demandée', () => {
    const i = m.interdictionRecolte([SANS_PLANCHE], [], '2027-05-11', KIWIS);
    expect(i?.evenementId).toBe(SANS_PLANCHE.id);
    expect(i?.planches).toBeUndefined();
    expect(m.interdictionRecolte([SANS_PLANCHE], [P1], '2027-05-11', KIWIS)?.planches).toBeUndefined();
    expect(m.interdictionRecolte([SANS_PLANCHE], [P1], '2027-05-11', KIWIS)?.evenementId).toBe(SANS_PLANCHE.id);
    if (i === null) throw new Error('interdiction attendue');
    expect(m.texteInterdiction(i, 'Bouillie bordelaise')).toBe('Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)');
    // Une autre culture n'est pas concernée ; le délai écoulé, plus rien.
    expect(m.interdictionRecolte([SANS_PLANCHE], [P1], '2027-05-11', TOMATES)).toBeNull();
    expect(m.interdictionRecolte([SANS_PLANCHE], [], '2027-05-13', KIWIS)).toBeNull();
  });

  it('les deux à la fois : le traitement sans planche bloque toute la culture, la date la plus tardive l’emporte', () => {
    const surP3 = traitement(4, [P3], TOMATES, '2027-05-20');
    const toute = traitement(5, [], TOMATES, '2027-05-13');
    // Sur P1 (non traitée), seul le traitement sans planche compte : toute la culture.
    const p1 = m.interdictionRecolte([surP3, toute], [P1], '2027-05-11', TOMATES);
    expect(p1?.evenementId).toBe(toute.id);
    expect(p1?.planches).toBeUndefined();
    // Sur P3, la date la plus tardive (P3, 20/05).
    expect(m.interdictionRecolte([surP3, toute], [P3], '2027-05-11', TOMATES)?.recolteAutoriseeLe).toBe('2027-05-20');
  });
});

describe('T69 (relecture) : corrections, planche partagée, bornes de dates', () => {
  it('correction qui change les planches : seules les planches de la correction restent interdites', () => {
    const correction = { ...traitement(10, [P5], TOMATES), remplaceSorte: 'correction' as const, remplaceEvenementId: SUR_P3_P4.id };
    const t = [SUR_P3_P4, correction];
    for (const p of [P3, P4]) expect(m.interdictionRecolte(t, [p], '2027-05-11', TOMATES), p).toBeNull();
    expect(m.interdictionRecolte(t, [P5], '2027-05-11', TOMATES)?.evenementId).toBe(correction.id);
    expect(m.interdictionRecolte(t, PLANCHES, '2027-05-11', TOMATES)?.planches).toEqual([P5]);
    expect(m.interdictionRecolte(t, [], '2027-05-11', TOMATES)?.planches).toEqual([P5]);
  });

  it('correction qui retire toutes les planches : toute la culture devient interdite ; l’inverse libère les autres planches', () => {
    const versToute = { ...traitement(11, [], TOMATES), remplaceSorte: 'correction' as const, remplaceEvenementId: SUR_P3_P4.id };
    const i = m.interdictionRecolte([SUR_P3_P4, versToute], [P1], '2027-05-11', TOMATES);
    expect(i?.evenementId).toBe(versToute.id);
    expect(i?.planches).toBeUndefined();
    const toute = traitement(12, [], TOMATES);
    const versP3 = { ...traitement(13, [P3], TOMATES), remplaceSorte: 'correction' as const, remplaceEvenementId: toute.id };
    expect(m.interdictionRecolte([toute, versP3], [P1], '2027-05-11', TOMATES)).toBeNull();
    expect(m.interdictionRecolte([toute, versP3], [P3], '2027-05-11', TOMATES)?.evenementId).toBe(versP3.id);
    // La correction annulée : plus rien en vigueur dans la chaîne.
    const annulation = { ...traitement(14, [P3], TOMATES), remplaceSorte: 'annulation' as const, remplaceEvenementId: versP3.id };
    expect(m.interdictionRecolte([toute, versP3, annulation], [P3], '2027-05-11', TOMATES)).toBeNull();
    expect(m.interdictionRecolte([toute, versP3, annulation], [], '2027-05-11', TOMATES)).toBeNull();
  });

  it('planche partagée par deux cultures : la planche traitée l’est pour les deux ; un traitement sans planche ne touche que sa culture', () => {
    // Tomates traitées sur P3 ; la voisine (salade) occupe P3 et P1.
    expect(m.interdictionRecolte([SUR_P3_P4], [P3], '2027-05-11', VOISINE)?.evenementId).toBe(SUR_P3_P4.id);
    expect(m.interdictionRecolte([SUR_P3_P4], [P3, P1], '2027-05-11', VOISINE)?.planches).toEqual([P3]);
    expect(m.interdictionRecolte([SUR_P3_P4], [P1], '2027-05-11', VOISINE)).toBeNull();
    const toute = traitement(15, [], TOMATES);
    expect(m.interdictionRecolte([toute], [P3], '2027-05-11', VOISINE)).toBeNull();
    expect(m.interdictionRecolte([toute], [P3], '2027-05-11', TOMATES)?.evenementId).toBe(toute.id);
  });

  it('bornes : interdite du jour du traitement à la veille de la date autorisée, permise ce jour-là (J + DAR inclus)', () => {
    for (const [jour, interdite] of [
      ['2027-05-09', false],
      ['2027-05-10', true],
      ['2027-05-12', true],
      ['2027-05-13', false],
    ] as const) {
      expect(m.interdictionRecolte([SUR_P3_P4], [P3], jour, TOMATES) !== null, jour).toBe(interdite);
      expect(m.interdictionRecolte([SUR_P3_P4], [], jour, TOMATES) !== null, `${jour}, culture`).toBe(interdite);
    }
  });
});
