/**
 * Tests d'acceptation T58 — état des serres (docs/backlog/T58-etat-serres.md, règles 1, 2 et 4) :
 * équipements par défaut selon le type d'abri, état courant d'après la suite des événements
 * (correction, annulation), serres encore ouvertes et rappel du soir à partir de 18 h.
 * Contrat : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerAbris, type EquipementAbri, type EvenementEtatAbri, type ModuleAbris, type Resultat, type ZoneAbri } from './test/contrat.ts';

let m: ModuleAbris;

beforeAll(async () => {
  m = await chargerAbris();
});

const uuid = (n: number): string => `0192f0c1-5858-7000-8000-${n.toString(16).padStart(12, '0')}`;
const SERRE_A = uuid(0xa1);
const SERRE_B = uuid(0xa2);
const TUNNEL = uuid(0xa3);
const CHAMP = uuid(0xa4);

const serre = (id: string, nom: string, equipementsAbri: readonly EquipementAbri[] | null = null): ZoneAbri => ({ id, nom, typeAbri: 'serre', equipementsAbri });
const ZONES: readonly ZoneAbri[] = [
  serre(SERRE_A, 'Serre 1'),
  serre(SERRE_B, 'Serre 2'),
  { id: TUNNEL, nom: 'Tunnel 3', typeAbri: 'tunnel', equipementsAbri: null },
  { id: CHAMP, nom: 'Plein champ', typeAbri: 'plein_champ', equipementsAbri: null },
];

let compteur = 0;
function ev(zoneId: string, equipement: EquipementAbri, actif: boolean, heureUtc: string, autres: Partial<EvenementEtatAbri> = {}): EvenementEtatAbri {
  compteur += 1;
  return { id: uuid(0x1000 + compteur), zoneId, equipement, actif, horodatage: `2026-10-22T${heureUtc}:00.000Z`, remplaceSorte: null, remplaceEvenementId: null, ...autres };
}

function valeur<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.message}`);
  return r.valeur;
}

function refuse<T>(r: Resultat<T>): void {
  expect(r.ok, 'aurait dû être refusé').toBe(false);
  if (r.ok) return;
  expect(r.message.trim().length).toBeGreaterThan(0);
  expect(r.message).not.toMatch(/\b(error|invalid|must|undefined|NaN|null)\b/i);
}

// ── Règle 1 : équipements par défaut, modifiables ───────────────────────────────────────────

describe('T58 : équipements déclarés par type d’abri', () => {
  it('l’ordre canonique compte cinq équipements', () => {
    expect(m.EQUIPEMENTS_ABRI).toEqual(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']);
  });

  it('tunnel : ouvrants latéraux, portes, voile ; serre : les cinq ; plein champ : rien', () => {
    expect(m.equipementsParDefaut('tunnel')).toEqual(['ouvrants_lateraux', 'portes', 'voile']);
    expect(m.equipementsParDefaut('serre')).toEqual(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']);
    expect(m.equipementsParDefaut('plein_champ')).toEqual([]);
  });

  it('zone sans liste à elle : la liste par défaut de son type ; la liste renvoyée est une copie', () => {
    expect(m.equipementsDeZone({ typeAbri: 'tunnel', equipementsAbri: null })).toEqual(['ouvrants_lateraux', 'portes', 'voile']);
    const a = m.equipementsParDefaut('serre');
    a.pop();
    expect(m.equipementsParDefaut('serre')).toHaveLength(5);
  });

  it('liste modifiée de la zone : elle remplace le défaut, rangée dans l’ordre canonique', () => {
    expect(m.equipementsDeZone({ typeAbri: 'serre', equipementsAbri: ['portes', 'chauffage'] })).toEqual(['portes', 'chauffage']);
    expect(m.equipementsDeZone({ typeAbri: 'serre', equipementsAbri: ['chauffage', 'portes'] })).toEqual(['portes', 'chauffage']);
    // Un tunnel avec chauffage déclaré, et une liste vide : « rien de déclaré », pas le défaut.
    expect(m.equipementsDeZone({ typeAbri: 'tunnel', equipementsAbri: ['ouvrants_lateraux', 'chauffage'] })).toEqual(['ouvrants_lateraux', 'chauffage']);
    expect(m.equipementsDeZone({ typeAbri: 'serre', equipementsAbri: [] })).toEqual([]);
  });

  it('validerEquipementsAbri : tableau ou texte JSON, ordre canonique, vide permis', () => {
    expect(valeur(m.validerEquipementsAbri(['voile', 'portes']))).toEqual(['portes', 'voile']);
    expect(valeur(m.validerEquipementsAbri('["chauffage","ouvrants_faitage"]'))).toEqual(['ouvrants_faitage', 'chauffage']);
    expect(valeur(m.validerEquipementsAbri([]))).toEqual([]);
  });

  it('validerEquipementsAbri : nom inconnu, doublon, pas un tableau, JSON illisible : refusés en français', () => {
    refuse(m.validerEquipementsAbri(['portes', 'arrosage']));
    refuse(m.validerEquipementsAbri(['portes', 'portes']));
    refuse(m.validerEquipementsAbri('portes'));
    refuse(m.validerEquipementsAbri({ portes: true }));
    refuse(m.validerEquipementsAbri('[portes'));
    refuse(m.validerEquipementsAbri([1]));
    refuse(m.validerEquipementsAbri(null));
  });

  it('libellés et phrases d’état', () => {
    expect(m.EQUIPEMENTS_ABRI.map((e) => m.libelleEquipement(e))).toEqual(['ouvrants latéraux', 'ouvrants de faîtage', 'portes', 'chauffage', 'voile']);
    expect([true, false].map((a) => m.phraseEtat('ouvrants_lateraux', a))).toEqual(['ouvrants latéraux ouverts', 'ouvrants latéraux fermés']);
    expect([true, false].map((a) => m.phraseEtat('ouvrants_faitage', a))).toEqual(['ouvrants de faîtage ouverts', 'ouvrants de faîtage fermés']);
    expect([true, false].map((a) => m.phraseEtat('portes', a))).toEqual(['portes ouvertes', 'portes fermées']);
    expect([true, false].map((a) => m.phraseEtat('chauffage', a))).toEqual(['chauffage allumé', 'chauffage éteint']);
    expect([true, false].map((a) => m.phraseEtat('voile', a))).toEqual(['voile posé', 'voile retiré']);
  });
});

// ── Règle 2 : état courant = dernier événement en vigueur ───────────────────────────────────

describe('T58 : état courant d’après la suite des événements', () => {
  it('aucun événement : état inconnu (null)', () => {
    expect(m.etatCourant([], SERRE_A, 'ouvrants_lateraux', '2026-10-22T12:00:00.000Z')).toBeNull();
  });

  it('« ouvrants latéraux ouverts, 9 h » : ouvert depuis 9 h, de 9 h à l’instant suivant ; inconnu avant', () => {
    const evts = [ev(SERRE_A, 'ouvrants_lateraux', true, '07:00')];
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_lateraux', '2026-10-22T07:00:00.000Z')).toEqual({ actif: true, depuis: evts[0]?.horodatage, evenementId: evts[0]?.id });
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_lateraux', '2026-10-22T14:30:00.000Z')?.actif).toBe(true);
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_lateraux', '2026-10-22T06:59:59.000Z')).toBeNull();
  });

  it('ouvert 9 h, fermé 12 h, rouvert 14 h : l’état dépend de l’heure demandée, dans le désordre aussi', () => {
    const evts = [ev(SERRE_A, 'ouvrants_lateraux', false, '10:00'), ev(SERRE_A, 'ouvrants_lateraux', true, '07:00'), ev(SERRE_A, 'ouvrants_lateraux', true, '12:00')];
    const a = (h: string) => m.etatCourant(evts, SERRE_A, 'ouvrants_lateraux', `2026-10-22T${h}:00.000Z`)?.actif;
    expect([a('08:00'), a('11:00'), a('12:30')]).toEqual([true, false, true]);
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_lateraux', '2026-10-22T11:00:00.000Z')?.depuis).toBe('2026-10-22T10:00:00.000Z');
  });

  it('même heure : le plus grand identifiant l’emporte (résultat stable)', () => {
    const a = ev(SERRE_A, 'portes', true, '08:00');
    const b = ev(SERRE_A, 'portes', false, '08:00');
    const attendu = a.id > b.id ? true : false;
    expect(m.etatCourant([a, b], SERRE_A, 'portes', '2026-10-22T09:00:00.000Z')?.actif).toBe(attendu);
    expect(m.etatCourant([b, a], SERRE_A, 'portes', '2026-10-22T09:00:00.000Z')?.actif).toBe(attendu);
  });

  it('chaque équipement et chaque serre a son état : les autres événements ne comptent pas', () => {
    const evts = [ev(SERRE_A, 'portes', true, '07:00'), ev(SERRE_A, 'ouvrants_lateraux', false, '08:00'), ev(SERRE_B, 'portes', false, '09:00')];
    const instant = '2026-10-22T10:00:00.000Z';
    expect(m.etatCourant(evts, SERRE_A, 'portes', instant)?.actif).toBe(true);
    expect(m.etatCourant(evts, SERRE_B, 'portes', instant)?.actif).toBe(false);
    expect(m.etatCourant(evts, SERRE_B, 'ouvrants_lateraux', instant)).toBeNull();
  });

  it('annulation : le dernier tap par erreur est annulé, l’état précédent revient', () => {
    const ouvert = ev(SERRE_A, 'ouvrants_lateraux', true, '06:00');
    const ferme = ev(SERRE_A, 'ouvrants_lateraux', false, '10:00');
    const annule = ev(SERRE_A, 'ouvrants_lateraux', false, '10:05', { remplaceSorte: 'annulation', remplaceEvenementId: ferme.id });
    const etat = m.etatCourant([ouvert, ferme, annule], SERRE_A, 'ouvrants_lateraux', '2026-10-22T11:00:00.000Z');
    expect(etat).toEqual({ actif: true, depuis: ouvert.horodatage, evenementId: ouvert.id });
  });

  it('annulation du seul événement : retour à l’état inconnu', () => {
    const ouvert = ev(SERRE_A, 'portes', true, '06:00');
    const annule = ev(SERRE_A, 'portes', true, '06:01', { remplaceSorte: 'annulation', remplaceEvenementId: ouvert.id });
    expect(m.etatCourant([ouvert, annule], SERRE_A, 'portes', '2026-10-22T12:00:00.000Z')).toBeNull();
  });

  it('correction : elle prend la place de l’original, à l’heure de l’original, même saisie plus tard', () => {
    const ouvert = ev(SERRE_A, 'ouvrants_faitage', true, '07:00');
    const ferme = ev(SERRE_A, 'ouvrants_faitage', false, '12:00');
    // À 15 h on s’aperçoit que le tap de 7 h était faux : la serre était fermée.
    const correction = ev(SERRE_A, 'ouvrants_faitage', false, '15:00', { remplaceSorte: 'correction', remplaceEvenementId: ouvert.id });
    const evts = [ouvert, ferme, correction];
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_faitage', '2026-10-22T09:00:00.000Z')).toEqual({ actif: false, depuis: ouvert.horodatage, evenementId: correction.id });
    // Une correction ne fait pas remonter l’original au-dessus du fermé de 12 h.
    expect(m.etatCourant(evts, SERRE_A, 'ouvrants_faitage', '2026-10-22T16:00:00.000Z')).toMatchObject({ actif: false, depuis: ferme.horodatage });
  });

  it('correction d’une correction, puis annulation de la chaîne : plus rien en vigueur', () => {
    const o = ev(SERRE_A, 'chauffage', true, '05:00');
    const c1 = ev(SERRE_A, 'chauffage', false, '05:30', { remplaceSorte: 'correction', remplaceEvenementId: o.id });
    const c2 = ev(SERRE_A, 'chauffage', true, '06:00', { remplaceSorte: 'correction', remplaceEvenementId: c1.id });
    expect(m.etatCourant([o, c1, c2], SERRE_A, 'chauffage', '2026-10-22T07:00:00.000Z')).toMatchObject({ actif: true, evenementId: c2.id });
    const a = ev(SERRE_A, 'chauffage', true, '06:30', { remplaceSorte: 'annulation', remplaceEvenementId: c2.id });
    expect(m.etatCourant([o, c1, c2, a], SERRE_A, 'chauffage', '2026-10-22T07:00:00.000Z')).toBeNull();
  });

  it('un événement saisi après l’instant demandé n’est pas connu à cet instant', () => {
    const ouvert = ev(SERRE_A, 'portes', true, '08:00');
    const annule = ev(SERRE_A, 'portes', true, '13:00', { remplaceSorte: 'annulation', remplaceEvenementId: ouvert.id });
    // À 10 h, d’après ce que l’on sait aujourd’hui (l’annulation de 13 h existe), il n’y a rien eu.
    expect(m.etatCourant([ouvert, annule], SERRE_A, 'portes', '2026-10-22T10:00:00.000Z')).toBeNull();
  });

  it('ne modifie pas les listes reçues', () => {
    const evts = Object.freeze([Object.freeze(ev(SERRE_A, 'portes', true, '08:00'))]);
    expect(() => m.etatCourant(evts, SERRE_A, 'portes', '2026-10-22T09:00:00.000Z')).not.toThrow();
  });
});

describe('T58 : état de chaque équipement déclaré d’une zone', () => {
  it('tunnel : trois équipements en ordre canonique, avec leur état', () => {
    const evts = [ev(TUNNEL, 'portes', true, '07:00'), ev(TUNNEL, 'voile', true, '06:00')];
    const zone = ZONES.find((z) => z.id === TUNNEL);
    if (zone === undefined) throw new Error('zone absente');
    const r = m.etatsDeLaZone(evts, zone, '2026-10-22T08:00:00.000Z');
    expect(r.map((x) => x.equipement)).toEqual(['ouvrants_lateraux', 'portes', 'voile']);
    expect(r.map((x) => x.etat?.actif ?? null)).toEqual([null, true, true]);
  });

  it('un événement sur un équipement non déclaré (chauffage d’un tunnel) est ignoré ; plein champ : rien', () => {
    const zone = ZONES.find((z) => z.id === TUNNEL);
    const champ = ZONES.find((z) => z.id === CHAMP);
    if (zone === undefined || champ === undefined) throw new Error('zone absente');
    const evts = [ev(TUNNEL, 'chauffage', true, '07:00'), ev(CHAMP, 'portes', true, '07:00')];
    expect(m.etatsDeLaZone(evts, zone, '2026-10-22T08:00:00.000Z').map((x) => x.equipement)).not.toContain('chauffage');
    expect(m.etatsDeLaZone(evts, champ, '2026-10-22T08:00:00.000Z')).toEqual([]);
  });

  it('liste modifiée : chauffage ajouté au tunnel, il apparaît', () => {
    const zone: ZoneAbri = { id: TUNNEL, nom: 'Tunnel 3', typeAbri: 'tunnel', equipementsAbri: ['ouvrants_lateraux', 'chauffage'] };
    const r = m.etatsDeLaZone([ev(TUNNEL, 'chauffage', true, '07:00')], zone, '2026-10-22T08:00:00.000Z');
    expect(r.map((x) => [x.equipement, x.etat?.actif ?? null])).toEqual([
      ['ouvrants_lateraux', null],
      ['chauffage', true],
    ]);
  });
});

// ── Règle 4 : serres encore ouvertes et rappel du soir ──────────────────────────────────────

describe('T58 : serres ouvertes', () => {
  it('ouvert si un ouvrant ou une porte est actif ; chauffage et voile n’ouvrent rien ; fermé en dernier : plus ouvert', () => {
    const evts = [
      ev(SERRE_A, 'ouvrants_lateraux', true, '07:00'),
      ev(SERRE_A, 'portes', true, '07:05'),
      ev(SERRE_B, 'chauffage', true, '05:00'),
      ev(SERRE_B, 'voile', true, '05:00'),
      ev(TUNNEL, 'portes', true, '07:00'),
      ev(TUNNEL, 'portes', false, '15:00'),
    ];
    const r = m.abrisOuverts(ZONES, evts, '2026-10-22T16:00:00.000Z');
    expect(r).toEqual([{ zoneId: SERRE_A, nom: 'Serre 1', ouverts: ['ouvrants_lateraux', 'portes'] }]);
  });

  it('tri par nom en ordre naturel, sans tenir compte de la casse : Serre 2 avant Serre 10, « abri » avant « Serre »', () => {
    const zones = [serre(uuid(1), 'Serre 10'), serre(uuid(2), 'Serre 2'), serre(uuid(3), 'abri nord')];
    const evts = zones.map((z) => ev(z.id, 'portes', true, '07:00'));
    expect(m.abrisOuverts(zones, evts, '2026-10-22T16:00:00.000Z').map((a) => a.nom)).toEqual(['abri nord', 'Serre 2', 'Serre 10']);
  });

  it('une porte ouverte sur un équipement non déclaré (liste modifiée sans portes) ne compte pas', () => {
    const zones = [serre(SERRE_A, 'Serre 1', ['chauffage', 'voile'])];
    expect(m.abrisOuverts(zones, [ev(SERRE_A, 'portes', true, '07:00')], '2026-10-22T16:00:00.000Z')).toEqual([]);
  });

  it('une ouverture annulée n’est plus ouverte', () => {
    const o = ev(SERRE_A, 'portes', true, '07:00');
    const a = ev(SERRE_A, 'portes', true, '07:02', { remplaceSorte: 'annulation', remplaceEvenementId: o.id });
    expect(m.abrisOuverts(ZONES, [o, a], '2026-10-22T16:00:00.000Z')).toEqual([]);
  });
});

describe('T58 : rappel du soir à partir de 18 h', () => {
  const FUSEAU = 'Europe/Paris';
  // Le 22 octobre 2026, la ferme est à l’heure d’été (UTC+2) : 18 h locales = 16 h UTC.
  const ouvertes = [ev(SERRE_A, 'ouvrants_lateraux', true, '07:00'), ev(SERRE_B, 'portes', true, '07:00')];

  it('« 2 serres encore ouvertes » à 18 h 00 précises', () => {
    const r = m.rappelDuSoir({ zones: ZONES, evenements: ouvertes, maintenant: '2026-10-22T16:00:00.000Z', fuseau: FUSEAU });
    expect(r?.nombre).toBe(2);
    expect(r?.phrase).toBe('2 serres encore ouvertes');
    expect(r?.zones.map((z) => z.nom)).toEqual(['Serre 1', 'Serre 2']);
  });

  it('17 h 59 : pas de rappel ; le matin non plus', () => {
    expect(m.rappelDuSoir({ zones: ZONES, evenements: ouvertes, maintenant: '2026-10-22T15:59:59.000Z', fuseau: FUSEAU })).toBeNull();
    expect(m.rappelDuSoir({ zones: ZONES, evenements: ouvertes, maintenant: '2026-10-22T08:00:00.000Z', fuseau: FUSEAU })).toBeNull();
  });

  it('l’heure est celle de la ferme, pas de l’appareil : en hiver (UTC+1), 17 h UTC = 18 h locales', () => {
    const hiver = [ev(SERRE_A, 'portes', true, '07:00')].map((e) => ({ ...e, horodatage: '2026-12-10T07:00:00.000Z' }));
    expect(m.rappelDuSoir({ zones: ZONES, evenements: hiver, maintenant: '2026-12-10T16:59:00.000Z', fuseau: FUSEAU })).toBeNull();
    expect(m.rappelDuSoir({ zones: ZONES, evenements: hiver, maintenant: '2026-12-10T17:00:00.000Z', fuseau: FUSEAU })?.phrase).toBe('1 serre encore ouverte');
  });

  it('23 h 30 : encore affiché ; tout fermé ou rien d’ouvert : pas de rappel', () => {
    expect(m.rappelDuSoir({ zones: ZONES, evenements: ouvertes, maintenant: '2026-10-22T21:30:00.000Z', fuseau: FUSEAU })?.nombre).toBe(2);
    const fermees = [...ouvertes, ev(SERRE_A, 'ouvrants_lateraux', false, '15:00'), ev(SERRE_B, 'portes', false, '15:10')];
    expect(m.rappelDuSoir({ zones: ZONES, evenements: fermees, maintenant: '2026-10-22T17:00:00.000Z', fuseau: FUSEAU })).toBeNull();
    expect(m.rappelDuSoir({ zones: ZONES, evenements: [], maintenant: '2026-10-22T17:00:00.000Z', fuseau: FUSEAU })).toBeNull();
  });

  it('une serre qu’on referme après 18 h sort du compte', () => {
    const evts = [...ouvertes, ev(SERRE_B, 'portes', false, '16:30')];
    const r = m.rappelDuSoir({ zones: ZONES, evenements: evts, maintenant: '2026-10-22T16:45:00.000Z', fuseau: FUSEAU });
    expect(r?.phrase).toBe('1 serre encore ouverte');
    expect(r?.zones.map((z) => z.zoneId)).toEqual([SERRE_A]);
  });
});
