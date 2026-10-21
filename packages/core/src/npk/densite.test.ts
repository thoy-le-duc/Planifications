/**
 * Tests d'acceptation T72 — densité des engrais liquides (docs/backlog/T72-densite-engrais-liquides.md).
 * Un liquide compté en L ou m³ pèse volume × densité (kg/L) ; sans densité, 1 kg/L comme avant.
 * Valable pour les apports de T54 et les doses de fertirrigation de T56. Aucune base, aucun réseau.
 *
 * Exemple du ticket : liquide de densité 1,25, 100 L à 10 % N → 125 kg × 10 % = 12,5 kg N.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerFertirrigation, type ModuleFertirrigation } from './test/contrat-fertirrigation.ts';
import { chargerFertilisation, type LigneLocale, type ModuleFertilisation, type Tables } from './test/contrat.ts';

let m: ModuleFertilisation;
let fert: ModuleFertirrigation;

beforeAll(async () => {
  m = await chargerFertilisation();
  fert = await chargerFertirrigation();
});

const uuid = (n: number): string => `0192f0c1-7272-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const AUTEUR = uuid(3);
const LIQUIDE_DENSE = uuid(0x10);
const LIQUIDE_SANS = uuid(0x11);
const SOLIDE = uuid(0x12);
const P1 = uuid(0x20);
const VANNE = uuid(0x30);
const RECETTE = uuid(0x31);
const CREE = '2027-01-01T08:00:00.000Z';

const ligneProduit = (autres: Record<string, string | number | null> = {}): LigneLocale => ({
  id: LIQUIDE_DENSE,
  ferme_id: FERME,
  nom: 'Engrais liquide azoté',
  forme: 'liquide',
  unite: 'L',
  teneur_n: 10,
  teneur_p2o5: null,
  teneur_k2o: null,
  organique: 0,
  utilisable_en_bio: 0,
  source: 'étiquette',
  densite_kg_par_l: 1.25,
  cree_le: CREE,
  modifie_le: CREE,
  supprime_le: null,
  ...autres,
});

const PRODUITS: readonly LigneLocale[] = [
  ligneProduit(),
  ligneProduit({ id: LIQUIDE_SANS, nom: 'Engrais liquide sans densité', densite_kg_par_l: null }),
  ligneProduit({ id: SOLIDE, nom: 'Engrais en poudre', forme: 'solide', unite: 'kg', densite_kg_par_l: null }),
];

const N10 = { teneurN: 10, teneurP2o5: null, teneurK2o: null } as const;

describe('T72 : densité d’un produit fertilisant (règle 1)', () => {
  it('densité 1,25 sur un liquide : acceptée et lue', () => {
    const r = m.validerProduitFertilisant(ligneProduit());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.densiteKgParL).toBe(1.25);
  });

  it('densité absente ou null : acceptée, lue null (produits d’avant T72)', () => {
    const sans = Object.fromEntries(Object.entries(ligneProduit()).filter(([c]) => c !== 'densite_kg_par_l'));
    for (const l of [sans, ligneProduit({ densite_kg_par_l: null })]) {
      const r = m.validerProduitFertilisant(l);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.valeur.densiteKgParL).toBeNull();
    }
  });

  it('bornes 0,5 et 2,5 incluses', () => {
    expect(m.LIMITES_PRODUIT_FERTILISANT).toMatchObject({ densiteMin: 0.5, densiteMax: 2.5 });
    for (const d of [0.5, 2.5]) expect(m.validerProduitFertilisant(ligneProduit({ densite_kg_par_l: d })).ok).toBe(true);
  });

  it.each([0.49, 2.51, 0, -1, 12])('densité %s : refusée hors_bornes, message en français', (d) => {
    const r = m.validerProduitFertilisant(ligneProduit({ densite_kg_par_l: d }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur).toMatchObject({ code: 'hors_bornes', champ: 'densite_kg_par_l' });
    expect(r.erreur.message).toBe('densité : de 0,5 à 2,5 kg/L');
  });

  it.each([['texte', '1,25'], ['non fini', Number.NaN], ['infini', Number.POSITIVE_INFINITY]])('densité %s : refusée champ_invalide', (_nom, d) => {
    const r = m.validerProduitFertilisant(ligneProduit({ densite_kg_par_l: d as number }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatchObject({ code: 'champ_invalide', champ: 'densite_kg_par_l' });
  });

  it('densité sur un produit solide : refusée (incoherent), la densité ne sert qu’aux liquides', () => {
    const r = m.validerProduitFertilisant(ligneProduit({ forme: 'solide', unite: 'kg' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreur).toMatchObject({ code: 'incoherent', champ: 'densite_kg_par_l' });
      expect(r.erreur.message).toContain('liquide');
    }
  });
});

describe('T72 : kg et unités d’un liquide en volume (règle 2)', () => {
  it('exemple du ticket : 100 L à 10 % N, densité 1,25 → 125 kg → 12,5 kg N', () => {
    expect(m.quantiteEnKg({ valeur: 100, unite: 'L' }, 1.25)).toBe(125);
    expect(m.unitesApport({ valeur: 100, unite: 'L' }, N10, 1.25)).toEqual({ n: 12.5, p2o5: null, k2o: null });
  });

  it('m³ : 2 m³ à 1,25 → 2 500 kg → 250 kg N', () => {
    expect(m.quantiteEnKg({ valeur: 2, unite: 'm3' }, 1.25)).toBe(2500);
    expect(m.quantiteEnKg({ valeur: 2, unite: 'm³' }, 1.25)).toBe(2500);
    expect(m.unitesApport({ valeur: 2, unite: 'm3' }, N10, 1.25)).toEqual({ n: 250, p2o5: null, k2o: null });
  });

  it('sans densité (absente ou null) : 1 kg/L, comme avant', () => {
    expect(m.quantiteEnKg({ valeur: 100, unite: 'L' })).toBe(100);
    expect(m.quantiteEnKg({ valeur: 100, unite: 'L' }, null)).toBe(100);
    expect(m.quantiteEnKg({ valeur: 2, unite: 'm3' })).toBe(2000);
    expect(m.unitesApport({ valeur: 100, unite: 'L' }, N10)).toEqual({ n: 10, p2o5: null, k2o: null });
  });

  it('kg et t ne dépendent pas de la densité', () => {
    expect(m.quantiteEnKg({ valeur: 100, unite: 'kg' }, 1.25)).toBe(100);
    expect(m.quantiteEnKg({ valeur: 2, unite: 't' }, 1.25)).toBe(2000);
  });

  it('unité inconnue : null, même avec une densité', () => {
    expect(m.quantiteEnKg({ valeur: 3, unite: 'bidon' }, 1.25)).toBeNull();
  });
});

// ── Bilan : apports (T54) ─────────────────────────────────────────────────────────────────────

let n = 0;
function apport(produitId: string | null, nom: string, quantite: number, unite: string): LigneLocale {
  n++;
  const id = uuid(0x1000 + n);
  return {
    id,
    ferme_id: FERME,
    type: 'intervention',
    date: '2027-05-10',
    horodatage: `2027-05-10T08:${String(n % 60).padStart(2, '0')}:00.000Z`,
    auteur_id: AUTEUR,
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: JSON.stringify([P1]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ categorie: 'fertilisation', type: 'engrais', outil: null, produit: nom, quantite: { valeur: quantite, unite }, produitFertilisantId: produitId }),
    cree_le: CREE,
    origine_id: id,
  };
}

const emplacement: LigneLocale = { id: P1, ferme_id: FERME, zone_id: uuid(0x50), code: 'P1', sorte: 'planche', longueur_m: 50, largeur_m: 2, actif_du: '2026-01-01', actif_au: null, supprime_le: null };
const saison: LigneLocale = { id: uuid(0x60), ferme_id: FERME, nom: 'Saison 2027', debut: '2027-01-01', fin: '2027-12-31', supprime_le: null };

const tables = (evenements: readonly LigneLocale[], autres: Partial<Record<string, LigneLocale[]>> = {}): Tables => ({
  evenement: evenements,
  produit_fertilisant: PRODUITS,
  emplacement: [emplacement],
  saison: [saison],
  ...autres,
});

describe('T72 : densité dans le bilan et le cahier (règles 2 et 3)', () => {
  it('100 L du liquide de densité 1,25 sur 100 m² : 12,5 kg N, 1 250 kg N/ha, pas de mention de densité', () => {
    const b = m.bilanFertilisation(tables([apport(LIQUIDE_DENSE, 'Engrais liquide azoté', 100, 'L')]), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 12.5, p2o5: null, k2o: null });
    expect(b.apports[0]?.kgParHa).toEqual({ n: 1250, p2o5: null, k2o: null });
    expect(b.apports[0]?.densiteSupposee).toBe(false);
  });

  it('même apport en m³ : 0,1 m³ = 100 L → 12,5 kg N', () => {
    const b = m.bilanFertilisation(tables([apport(LIQUIDE_DENSE, 'Engrais liquide azoté', 0.1, 'm3')]), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 12.5, p2o5: null, k2o: null });
  });

  it('liquide sans densité en L : comportement d’avant (1 kg/L, 10 kg N), signalé « densité supposée »', () => {
    const b = m.bilanFertilisation(tables([apport(LIQUIDE_SANS, 'Engrais liquide sans densité', 100, 'L')]), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 10, p2o5: null, k2o: null });
    expect(b.apports[0]?.densiteSupposee).toBe(true);
  });

  it('liquide sans densité mais en kg : rien à supposer, pas de mention', () => {
    const b = m.bilanFertilisation(tables([apport(LIQUIDE_SANS, 'Engrais liquide sans densité', 100, 'kg')]), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 10, p2o5: null, k2o: null });
    expect(b.apports[0]?.densiteSupposee).toBe(false);
  });

  it('solide saisi en L : toujours sans unités (valeur gardée), pas de mention de densité', () => {
    const b = m.bilanFertilisation(tables([apport(SOLIDE, 'Engrais en poudre', 20, 'L')]), FERME);
    expect(b.apports).toHaveLength(1);
    expect(b.apports[0]).toMatchObject({ quantite: 20, unite: 'L', kg: null, densiteSupposee: false });
    expect(b.parEmplacement[0]?.realise.sansUnites).toBe(1);
  });

  it('texte libre ou produit inconnu en L : sans unités, pas de mention de densité', () => {
    const b = m.bilanFertilisation(tables([apport(null, 'Purin maison', 30, 'L')]), FERME);
    expect(b.apports[0]).toMatchObject({ kg: null, densiteSupposee: false });
  });

  it('une densité hors bornes dans une ligne locale illisible est ignorée : 1 kg/L supposé', () => {
    const b = m.bilanFertilisation(tables([apport(LIQUIDE_DENSE, 'Engrais liquide azoté', 100, 'L')], { produit_fertilisant: [ligneProduit({ densite_kg_par_l: 9 })] }), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 10, p2o5: null, k2o: null });
    expect(b.apports[0]?.densiteSupposee).toBe(true);
  });

  it('corriger la densité du produit corrige le bilan passé (comme les teneurs)', () => {
    const e = [apport(LIQUIDE_DENSE, 'Engrais liquide azoté', 100, 'L')];
    const avant = m.bilanFertilisation(tables(e, { produit_fertilisant: [ligneProduit({ densite_kg_par_l: null })] }), FERME);
    const apres = m.bilanFertilisation(tables(e), FERME);
    expect(avant.apports[0]?.kg?.n).toBe(10);
    expect(apres.apports[0]?.kg?.n).toBe(12.5);
  });
});

// ── Fertirrigation (T56) ──────────────────────────────────────────────────────────────────────

describe('T72 : densité dans la fertirrigation (règle 5)', () => {
  it('unitesFertirrigation : 100 L du liquide de densité 1,25 → 12,5 kg N ; sans densité 10 kg N', () => {
    expect(fert.unitesFertirrigation([{ produitFertilisantId: LIQUIDE_DENSE, quantite: { valeur: 100, unite: 'L' } }], PRODUITS)).toEqual({ n: 12.5, p2o5: null, k2o: null });
    expect(fert.unitesFertirrigation([{ produitFertilisantId: LIQUIDE_SANS, quantite: { valeur: 100, unite: 'L' } }], PRODUITS)).toEqual({ n: 10, p2o5: null, k2o: null });
  });

  it('solide en L dans une dose : toujours sans unités', () => {
    expect(fert.unitesFertirrigation([{ produitFertilisantId: SOLIDE, quantite: { valeur: 5, unite: 'L' } }], PRODUITS)).toBeNull();
  });

  const irrigation = (produitId: string, nom: string): LigneLocale => {
    const detail = fert.detailFertirrigation({
      secteurIrrigationId: VANNE,
      dureeMinutes: 20,
      recette: { id: RECETTE, tauxInjection: null, engrais: [{ produitFertilisantId: produitId, quantite: { valeur: 50, unite: 'L' } }] },
      noms: new Map([[produitId, nom]]),
      volumeM3: 2,
      ecMesuree: null,
      phMesure: null,
    });
    n++;
    const id = uuid(0x2000 + n);
    return {
      id,
      ferme_id: FERME,
      type: 'irrigation',
      date: '2027-05-10',
      horodatage: `2027-05-10T07:${String(n % 60).padStart(2, '0')}:00.000Z`,
      auteur_id: AUTEUR,
      source: 'tap',
      serie_id: null,
      campagne_id: null,
      emplacement_ids: '[]',
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify(detail),
      cree_le: CREE,
      origine_id: id,
    };
  };
  const lien: LigneLocale = { id: uuid(0x70), ferme_id: FERME, secteur_irrigation_id: VANNE, emplacement_id: P1, du: '2027-01-01', au: null, cree_le: CREE, modifie_le: CREE, supprime_le: null };

  it('recette de 50 L par m³, 2 m³ → 100 L de produit : bilan 12,5 kg N sur la planche (densité 1,25)', () => {
    const b = m.bilanFertilisation(tables([irrigation(LIQUIDE_DENSE, 'Engrais liquide azoté')], { secteur_emplacement: [lien] }), FERME);
    expect(b.apports).toHaveLength(1);
    expect(b.apports[0]).toMatchObject({ categorie: 'fertirrigation', quantite: 100, unite: 'L', densiteSupposee: false });
    expect(b.apports[0]?.kg).toEqual({ n: 12.5, p2o5: null, k2o: null });
    expect(b.apports[0]?.kgParHa).toEqual({ n: 1250, p2o5: null, k2o: null });
  });

  it('même fertirrigation, produit sans densité : 10 kg N (comme avant), « densité supposée »', () => {
    const b = m.bilanFertilisation(tables([irrigation(LIQUIDE_SANS, 'Engrais liquide sans densité')], { secteur_emplacement: [lien] }), FERME);
    expect(b.apports[0]?.kg).toEqual({ n: 10, p2o5: null, k2o: null });
    expect(b.apports[0]?.densiteSupposee).toBe(true);
  });
});
