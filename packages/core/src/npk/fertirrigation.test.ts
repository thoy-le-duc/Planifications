/**
 * Tests d'acceptation T56 — fertirrigation : recettes, doses injectées, unités apportées, répartition
 * au prorata des surfaces, versement dans le bilan et le cahier de T54
 * (docs/backlog/T56-fertirrigation.md, règles 1 à 3). Contrat : ./test/contrat-fertirrigation.ts.
 * Aucune base, aucun réseau, aucune horloge.
 *
 * Exemple chiffré du ticket : 10 kg de nitrate de calcium (15,5 % N) pour 1 000 L de solution
 * mère, injection à 1 %, 2 m³ d'eau. À 1 %, 2 m³ d'eau reçoivent 20 L de mère, soit 0,2 kg de
 * nitrate et 0,031 kg N : le « 0,31 kg N » du ticket est d'un facteur 10 trop fort (il
 * correspond à une injection de 10 %). Le test garde les entrées du ticket avec le calcul juste
 * (0,031), et vérifie 0,31 kg N à 10 % (relevé dans le journal).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerFertirrigation, type LigneLocale, type ModuleFertirrigation } from './test/contrat-fertirrigation.ts';
import { chargerFertilisation, type ModuleFertilisation, type Tables } from './test/contrat.ts';

let m: ModuleFertirrigation;
let f: ModuleFertilisation;

beforeAll(async () => {
  m = await chargerFertirrigation();
  f = await chargerFertilisation();
});

const uuid = (n: number): string => `0192f0c1-5656-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const VOISINE = uuid(2);
const AUTEUR = uuid(3);
const NITRATE = uuid(0x10);
const POTASSE = uuid(0x11);
const SOLIDE_EN_L = uuid(0x12);
const RECETTE = uuid(0x20);
const VANNE = uuid(0x30);
const AUTRE_VANNE = uuid(0x31);
const P50 = uuid(0x40);
const P150 = uuid(0x41);
const TARDIVE = uuid(0x42);
const FINIE = uuid(0x43);
const OUBLIEE = uuid(0x44);
const CREE = '2027-01-01T08:00:00.000Z';

const produit = (id: string, nom: string, t: { n?: number | null; k?: number | null; forme?: string; unite?: string; organique?: boolean; ferme?: string } = {}): LigneLocale => ({
  id,
  ferme_id: t.ferme ?? FERME,
  nom,
  forme: t.forme ?? 'solide',
  unite: t.unite ?? 'kg',
  teneur_n: t.n ?? null,
  teneur_p2o5: null,
  teneur_k2o: t.k ?? null,
  organique: t.organique === true ? 1 : 0,
  utilisable_en_bio: 0,
  source: 'étiquette',
  cree_le: CREE,
  modifie_le: CREE,
  supprime_le: null,
});

const PRODUITS: readonly LigneLocale[] = [
  produit(NITRATE, 'Nitrate de calcium', { n: 15.5 }),
  produit(POTASSE, 'Nitrate de potassium', { n: 13, k: 46 }),
  produit(SOLIDE_EN_L, 'Sulfate de magnésie', { n: null, k: null }),
];

const DIX_KG_NITRATE = [{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'kg' } }] as const;

const recette = (autres: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: RECETTE,
  ferme_id: FERME,
  nom: 'Fraise floraison',
  taux_injection: 1,
  engrais: JSON.stringify(DIX_KG_NITRATE),
  ec_cible: 1.8,
  ph_cible: 5.8,
  cree_le: CREE,
  modifie_le: CREE,
  supprime_le: null,
  ...autres,
});

describe('T56 : recette de fertirrigation (règle 1)', () => {
  it('recette complète acceptée, lue en valeurs typées', () => {
    const r = m.validerRecetteFertirrigation(recette());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur).toEqual({ id: RECETTE, fermeId: FERME, nom: 'Fraise floraison', tauxInjection: 1, engrais: DIX_KG_NITRATE, ecCible: 1.8, phCible: 5.8, supprimeLe: null });
  });

  it('quantités par m³ d’eau (sans taux), EC et pH facultatifs : acceptée ; engrais en tableau accepté', () => {
    const r = m.validerRecetteFertirrigation(recette({ taux_injection: null, ec_cible: null, ph_cible: null, engrais: [...DIX_KG_NITRATE] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur).toMatchObject({ tauxInjection: null, ecCible: null, phCible: null });
  });

  it.each([
    ['nom vide', { nom: '  ' }, 'nom'],
    ['nom trop long', { nom: 'x'.repeat(201) }, 'nom'],
    ['sans ferme (pas de bibliothèque commune)', { ferme_id: null }, 'ferme_id'],
    ['taux nul', { taux_injection: 0 }, 'taux_injection'],
    ['taux au-delà de 100 %', { taux_injection: 101 }, 'taux_injection'],
    ['taux en texte', { taux_injection: '1' }, 'taux_injection'],
    ['aucun engrais', { engrais: '[]' }, 'engrais'],
    ['engrais illisible', { engrais: '{pas du json' }, 'engrais'],
    ['engrais sans produit', { engrais: JSON.stringify([{ quantite: { valeur: 10, unite: 'kg' } }]) }, 'engrais'],
    ['quantité nulle', { engrais: JSON.stringify([{ produitFertilisantId: NITRATE, quantite: { valeur: 0, unite: 'kg' } }]) }, 'engrais'],
    ['unité inconnue', { engrais: JSON.stringify([{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'brouette' } }]) }, 'engrais'],
    ['clé inconnue dans un engrais', { engrais: JSON.stringify([{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'kg' }, dose: 3 }]) }, 'engrais'],
    ['même produit deux fois', { engrais: JSON.stringify([...DIX_KG_NITRATE, ...DIX_KG_NITRATE]) }, 'engrais'],
    ['EC négative', { ec_cible: -1 }, 'ec_cible'],
    ['EC au-delà de 20', { ec_cible: 21 }, 'ec_cible'],
    ['pH au-delà de 14', { ph_cible: 15 }, 'ph_cible'],
  ])('%s : refusée', (_nom, autres, champ) => {
    const r = m.validerRecetteFertirrigation(recette(autres));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.champ ?? '').toContain(champ);
  });

  it('plus de 20 engrais : refusée', () => {
    const engrais = Array.from({ length: m.LIMITES_RECETTE_FERTIRRIGATION.engraisMax + 1 }, (_, i) => ({ produitFertilisantId: uuid(0x100 + i), quantite: { valeur: 1, unite: 'kg' } }));
    expect(m.validerRecetteFertirrigation(recette({ engrais: JSON.stringify(engrais) })).ok).toBe(false);
  });

  it('colonne inconnue : refusée (colonne_inconnue) ; entrée illisible : refusée sans lever', () => {
    const r = m.validerRecetteFertirrigation(recette({ dose_conseillee: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur.code).toBe('colonne_inconnue');
    expect(m.validerRecetteFertirrigation(null).ok).toBe(false);
    expect(m.validerRecetteFertirrigation('recette').ok).toBe(false);
  });
});

describe('T56 : volume et doses injectées (règles 2 et 3)', () => {
  it('volume = durée × débit, au litre : 20 min à 6 000 L/h → 2 m³ ; 20 min à 850 L/h → 0,283 m³', () => {
    expect(m.volumeIrrigationM3(20, 6000)).toBe(2);
    expect(m.volumeIrrigationM3(20, 850)).toBe(0.283);
  });

  it('vanne sans débit : volume inconnu (null), à saisir', () => {
    expect(m.volumeIrrigationM3(20, null)).toBeNull();
  });

  it('exemple du ticket : 10 kg pour 1 000 L de mère, injection 1 %, 2 m³ → 0,2 kg de nitrate injecté', () => {
    expect(m.dosesFertirrigation({ tauxInjection: 1, engrais: DIX_KG_NITRATE }, 2)).toEqual([{ produitFertilisantId: NITRATE, quantite: { valeur: 0.2, unite: 'kg' } }]);
  });

  it('quantités par m³ d’eau (sans taux) : 0,1 kg/m³ × 2 m³ → 0,2 kg', () => {
    expect(m.dosesFertirrigation({ tauxInjection: null, engrais: [{ produitFertilisantId: NITRATE, quantite: { valeur: 0.1, unite: 'kg' } }] }, 2)).toEqual([
      { produitFertilisantId: NITRATE, quantite: { valeur: 0.2, unite: 'kg' } },
    ]);
  });

  it('pas de 0,30000000000000004 : 3 engrais, 0,3 m³', () => {
    const doses = m.dosesFertirrigation({ tauxInjection: 1, engrais: [{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'kg' } }] }, 0.3);
    expect(doses[0]?.quantite.valeur).toBe(0.03);
  });
});

describe('T56 : unités apportées, avec les teneurs de T54 (règle 3)', () => {
  it('exemple du ticket (1 %, 2 m³) : 0,031 kg N (le ticket écrit 0,31 : facteur 10, voir l’en-tête)', () => {
    const doses = m.dosesFertirrigation({ tauxInjection: 1, engrais: DIX_KG_NITRATE }, 2);
    expect(m.unitesFertirrigation(doses, PRODUITS)).toEqual({ n: 0.031, p2o5: null, k2o: null });
  });

  it('même recette injectée à 10 % : 2 kg de nitrate, 0,31 kg N', () => {
    const doses = m.dosesFertirrigation({ tauxInjection: 10, engrais: DIX_KG_NITRATE }, 2);
    expect(m.unitesFertirrigation(doses, PRODUITS)).toEqual({ n: 0.31, p2o5: null, k2o: null });
  });

  it('plusieurs engrais : N et K₂O s’additionnent', () => {
    const doses = [
      { produitFertilisantId: NITRATE, quantite: { valeur: 0.2, unite: 'kg' } },
      { produitFertilisantId: POTASSE, quantite: { valeur: 0.1, unite: 'kg' } },
    ];
    // N : 0,2 × 15,5 % + 0,1 × 13 % = 0,031 + 0,013 ; K₂O : 0,1 × 46 % = 0,046.
    expect(m.unitesFertirrigation(doses, PRODUITS)).toEqual({ n: 0.044, p2o5: null, k2o: 0.046 });
  });

  it('produit sans teneur, inconnu ou d’une autre ferme : aucune unité (null)', () => {
    expect(m.unitesFertirrigation([{ produitFertilisantId: SOLIDE_EN_L, quantite: { valeur: 1, unite: 'kg' } }], PRODUITS)).toBeNull();
    expect(m.unitesFertirrigation([{ produitFertilisantId: uuid(0x99), quantite: { valeur: 1, unite: 'kg' } }], PRODUITS)).toBeNull();
  });

  it('solide compté en L (densité inconnue, règle de T54) : sans unités', () => {
    expect(m.unitesFertirrigation([{ produitFertilisantId: NITRATE, quantite: { valeur: 1, unite: 'L' } }], PRODUITS)).toBeNull();
  });
});

describe('T56 : répartition au prorata des surfaces (règle 3)', () => {
  it('0,031 kg N sur 50 et 150 m² : 0,008 et 0,023 kg (somme exacte), 1,55 kg N/ha chacun', () => {
    const parts = m.repartitionAuProrata({ n: 0.031, p2o5: null, k2o: null }, [
      { emplacementId: P50, surfaceM2: 50 },
      { emplacementId: P150, surfaceM2: 150 },
    ]);
    expect(parts).toEqual([
      { emplacementId: P50, kg: { n: 0.008, p2o5: null, k2o: null }, kgParHa: { n: 1.55, p2o5: null, k2o: null } },
      { emplacementId: P150, kg: { n: 0.023, p2o5: null, k2o: null }, kgParHa: { n: 1.55, p2o5: null, k2o: null } },
    ]);
  });

  it('0,31 kg N (injection 10 %) sur 50 et 150 m² : un quart, trois quarts ; 15,5 kg N/ha', () => {
    const parts = m.repartitionAuProrata({ n: 0.31, p2o5: null, k2o: null }, [
      { emplacementId: P50, surfaceM2: 50 },
      { emplacementId: P150, surfaceM2: 150 },
    ]);
    const n = (parts ?? []).map((p) => p.kg.n ?? 0);
    expect(n.reduce((a, b) => a + b, 0)).toBeCloseTo(0.31, 9);
    expect(n[0]).toBeCloseTo(0.0775, 3);
    expect(n[1]).toBeCloseTo(0.2325, 3);
    expect((parts ?? []).map((p) => p.kgParHa.n)).toEqual([15.5, 15.5]);
  });

  it('surface inconnue ou nulle : pas de répartition (null)', () => {
    expect(m.repartitionAuProrata({ n: 0.031, p2o5: null, k2o: null }, [{ emplacementId: P50, surfaceM2: null }])).toBeNull();
    expect(m.repartitionAuProrata({ n: 0.031, p2o5: null, k2o: null }, [{ emplacementId: P50, surfaceM2: 0 }])).toBeNull();
    expect(m.repartitionAuProrata({ n: 0.031, p2o5: null, k2o: null }, [])).toBeNull();
  });
});

// ── Saisie d'une irrigation qui porte une recette (règle 2) ─────────────────────────────────

let k = 0;
function irrigation(detail: Record<string, unknown>, a: { date?: string; ferme?: string; id?: string; remplace?: { sorte: 'annulation' | 'correction'; id: string } } = {}): LigneLocale {
  k++;
  const id = a.id ?? uuid(0x1000 + k);
  const date = a.date ?? '2027-05-10';
  return {
    id,
    ferme_id: a.ferme ?? FERME,
    type: 'irrigation',
    date,
    horodatage: `${date}T07:${String(k % 60).padStart(2, '0')}:00.000Z`,
    auteur_id: AUTEUR,
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: a.remplace?.sorte ?? null,
    remplace_evenement_id: a.remplace?.id ?? null,
    detail: JSON.stringify(detail),
    cree_le: CREE,
    origine_id: id,
  };
}

const NOMS = new Map([[NITRATE, 'Nitrate de calcium']]);
const detailTicket = (autres: { secteur?: string; ec?: number | null; ph?: number | null } = {}) =>
  m.detailFertirrigation({
    secteurIrrigationId: autres.secteur ?? VANNE,
    dureeMinutes: 20,
    recette: { id: RECETTE, tauxInjection: 1, engrais: DIX_KG_NITRATE },
    noms: NOMS,
    volumeM3: 2,
    ecMesuree: autres.ec ?? null,
    phMesure: autres.ph ?? null,
  });

describe('T56 : détail d’une irrigation avec recette (règle 2)', () => {
  it('doses figées dans le détail, nom de chaque produit ; EC et pH absents quand non relevés', () => {
    expect(detailTicket()).toEqual({
      secteurIrrigationId: VANNE,
      dureeMinutes: 20,
      recetteFertirrigationId: RECETTE,
      volumeM3: 2,
      engrais: [{ produitFertilisantId: NITRATE, produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' } }],
    });
    expect(detailTicket({ ec: 1.9, ph: 5.9 })).toMatchObject({ ecMesuree: 1.9, phMesure: 5.9 });
  });

  it('accepté par validerSaisie (règles du serveur) ; une irrigation d’avant T56 aussi', () => {
    expect(m.validerSaisie(irrigation(detailTicket({ ec: 1.9, ph: 5.9 }))).ok).toBe(true);
    expect(m.validerSaisie(irrigation({ secteurIrrigationId: VANNE, dureeMinutes: 20 })).ok).toBe(true);
    expect(m.validerSaisie(irrigation({ secteurIrrigationId: VANNE, dureeMinutes: 20, volumeM3: 1.5 })).ok).toBe(true);
  });

  const sans = (cle: string): Record<string, unknown> => Object.fromEntries(Object.entries(detailTicket()).filter(([c]) => c !== cle));

  it.each([
    ['recette sans volume', () => sans('volumeM3'), 'detail.volumeM3'],
    ['recette sans engrais', () => sans('engrais'), 'detail.engrais'],
    ['engrais sans recette', () => sans('recetteFertirrigationId'), 'detail.engrais'],
    ['recette illisible', () => ({ ...detailTicket(), recetteFertirrigationId: 'R1' }), 'detail.recetteFertirrigationId'],
    ['volume nul', () => ({ ...detailTicket(), volumeM3: 0 }), 'detail.volumeM3'],
    ['volume au-delà de 10 000 m³', () => ({ ...detailTicket(), volumeM3: 10_001 }), 'detail.volumeM3'],
    ['EC au-delà de 20', () => ({ ...detailTicket(), ecMesuree: 25 }), 'detail.ecMesuree'],
    ['pH au-delà de 14', () => ({ ...detailTicket(), phMesure: 15 }), 'detail.phMesure'],
    ['engrais vide', () => ({ ...detailTicket(), engrais: [] }), 'detail.engrais'],
    ['dose négative', () => ({ ...detailTicket(), engrais: [{ produitFertilisantId: NITRATE, produit: 'Nitrate de calcium', quantite: { valeur: -1, unite: 'kg' } }] }), 'detail.engrais'],
    ['clé inconnue dans une dose', () => ({ ...detailTicket(), engrais: [{ produitFertilisantId: NITRATE, produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' }, x: 1 }] }), 'detail.engrais'],
  ])('%s : refusée', (_nom, detail, champ) => {
    const r = m.validerSaisie(irrigation(detail()));
    expect(r.ok).toBe(false);
    expect(r.erreur?.champ ?? '').toContain(champ);
  });
});

// ── Bilan et cahier de T54 (règle 3) ─────────────────────────────────────────────────────────

const emplacement = (id: string, code: string, longueur: number, largeur: number | null, ferme = FERME): LigneLocale => ({
  id,
  ferme_id: ferme,
  zone_id: uuid(0x50),
  code,
  sorte: 'planche',
  longueur_m: longueur,
  largeur_m: largeur,
  actif_du: '2026-01-01',
  actif_au: null,
  supprime_le: null,
});

let l = 0;
const lien = (secteur: string, e: string, du: string, au: string | null, supprime: string | null = null): LigneLocale => ({
  id: uuid(0x2000 + l++),
  ferme_id: FERME,
  secteur_irrigation_id: secteur,
  emplacement_id: e,
  du,
  au,
  cree_le: CREE,
  modifie_le: CREE,
  supprime_le: supprime,
});

/**
 * La vanne arrose P50 (25 × 2 = 50 m²) et P150 (75 × 2 = 150 m²) depuis le 1er janvier 2027 ; elle
 * arrosera TARDIVE à partir du 1er juin, a arrosé FINIE jusqu'au 30 avril, et un lien supprimé
 * vers OUBLIEE ne compte pas.
 */
function tablesFerme(evenements: readonly LigneLocale[]): Tables {
  return {
    evenement: evenements,
    produit_fertilisant: [...PRODUITS],
    emplacement: [emplacement(P50, 'P50', 25, 2), emplacement(P150, 'P150', 75, 2), emplacement(TARDIVE, 'P7', 10, 1), emplacement(FINIE, 'P8', 10, 1), emplacement(OUBLIEE, 'P9', 10, 1)],
    secteur_emplacement: [
      lien(VANNE, P50, '2027-01-01', null),
      lien(VANNE, P150, '2027-01-01', null),
      lien(VANNE, TARDIVE, '2027-06-01', null),
      lien(VANNE, FINIE, '2027-01-01', '2027-04-30'),
      lien(VANNE, OUBLIEE, '2027-01-01', null, '2027-02-01T08:00:00.000Z'),
    ],
    saison: [{ id: uuid(0x60), ferme_id: FERME, nom: 'Saison 2027', debut: '2027-01-01', fin: '2027-12-31', supprime_le: null }],
  };
}

describe('T56 : la fertirrigation dans le bilan de T54 (règle 3)', () => {
  it('exemple du ticket : un apport « fertirrigation » sur les planches de la vanne ce jour-là, 1,55 kg N/ha chacune', () => {
    const fertirrigation = irrigation(detailTicket());
    const b = f.bilanFertilisation(tablesFerme([fertirrigation]), FERME);
    expect(b.apports).toHaveLength(1);
    const a = b.apports[0];
    expect(a).toMatchObject({ evenementId: fertirrigation.id, date: '2027-05-10', prevu: false, categorie: 'fertirrigation', produit: 'Nitrate de calcium', produitId: NITRATE, quantite: 0.2, unite: 'kg', surfaceM2: 200 });
    expect([...(a?.emplacementIds ?? [])].sort()).toEqual([P50, P150].sort());
    expect(a?.kgParHa).toEqual({ n: 1.55, p2o5: null, k2o: null });
    const parPlanche = Object.fromEntries(b.parEmplacement.map((x) => [x.emplacementId, x.realise.n]));
    expect(parPlanche).toEqual({ [P50]: 1.55, [P150]: 1.55 });
  });

  it('irrigation sans recette : aucun apport compté', () => {
    const b = f.bilanFertilisation(tablesFerme([irrigation({ secteurIrrigationId: VANNE, dureeMinutes: 20 }), irrigation({ secteurIrrigationId: VANNE, dureeMinutes: 20, volumeM3: 2 })]), FERME);
    expect(b.apports).toEqual([]);
    expect(b.parEmplacement).toEqual([]);
  });

  it('fertirrigation annulée : rien ; autre ferme : rien ; vanne qui n’arrose rien : apport sans kg/ha', () => {
    const annulee = irrigation(detailTicket());
    const annulation = irrigation(detailTicket(), { remplace: { sorte: 'annulation', id: String(annulee.id) } });
    const voisine = irrigation(detailTicket(), { ferme: VOISINE });
    expect(f.bilanFertilisation(tablesFerme([annulee, annulation, voisine]), FERME).apports).toEqual([]);
    const seule = f.bilanFertilisation(tablesFerme([irrigation(detailTicket({ secteur: AUTRE_VANNE }))]), FERME);
    expect(seule.apports).toHaveLength(1);
    expect(seule.apports[0]?.emplacementIds).toEqual([]);
    expect(seule.apports[0]?.kgParHa).toBeNull();
  });

  it('liens datés : une fertirrigation de mars compte FINIE, pas TARDIVE (changer le réseau ne réécrit pas le passé)', () => {
    const mars = irrigation(detailTicket(), { date: '2027-03-10' });
    const juin = irrigation(detailTicket(), { date: '2027-06-10' });
    const b = f.bilanFertilisation(tablesFerme([mars, juin]), FERME);
    const emplacementsDe = (id: unknown) => [...(b.apports.find((a) => a.evenementId === id)?.emplacementIds ?? [])].sort();
    expect(emplacementsDe(mars.id)).toEqual([P50, P150, FINIE].sort());
    expect(emplacementsDe(juin.id)).toEqual([P50, P150, TARDIVE].sort());
  });

  it('teneur corrigée après coup : le bilan suit (règle de T54), les doses restent celles de la saisie', () => {
    const t = tablesFerme([irrigation(detailTicket())]);
    const corrigee: Tables = { ...t, produit_fertilisant: [produit(NITRATE, 'Nitrate de calcium', { n: 15 })] };
    expect(f.bilanFertilisation(corrigee, FERME).apports[0]).toMatchObject({ quantite: 0.2, kgParHa: { n: 1.5, p2o5: null, k2o: null } });
  });
});

describe('T56 : la fertirrigation dans le cahier exporté (règle 3)', () => {
  it('une ligne par engrais, catégorie « fertirrigation », sur les planches de la vanne', () => {
    const lignes = m.lignesCahierFertilisation(tablesFerme([irrigation(detailTicket()), irrigation({ secteurIrrigationId: VANNE, dureeMinutes: 20 })]), FERME);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      date: '2027-05-10',
      saison: 'Saison 2027',
      emplacements: 'P50, P150',
      surface_m2: 200,
      categorie: 'fertirrigation',
      produit: 'Nitrate de calcium',
      quantite: 0.2,
      unite: 'kg',
      n_kg_ha: 1.55,
      k2o_kg: null,
    });
  });
});
