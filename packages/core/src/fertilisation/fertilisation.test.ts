/**
 * Tests d'acceptation T54 — composition des fertilisants, bilan par planche, zone vulnérable
 * (docs/backlog/T54-cahier-fertilisation.md, règles 1, 2, 3, 6). Contrat : ./test/contrat.ts.
 * Aucune base, aucun réseau, aucune horloge.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerFertilisation, type BilanEmplacement, type LigneLocale, type ModuleFertilisation, type Tables } from './test/contrat.ts';

let m: ModuleFertilisation;
let coeur: { validerSaisie(entree: unknown): { readonly ok: boolean; readonly erreur?: { readonly code: string } } };

beforeAll(async () => {
  m = await chargerFertilisation();
  coeur = await import('../index.ts');
});

const uuid = (n: number): string => `0192f0c1-5454-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const VOISINE = uuid(2);
const AUTEUR = uuid(3);
const P1 = uuid(0x10);
const P2 = uuid(0x11);
const SANS_LARGEUR = uuid(0x12);
const COMPOST = uuid(0x20);
const CORNE = uuid(0x21);
const SANS_TENEUR = uuid(0x22);
const ENGRAIS_MINERAL = uuid(0x23);
const SERIE = uuid(0x30);
const CREE = '2027-01-01T08:00:00.000Z';

const produit = (id: string, nom: string, t: { n?: number | null; p?: number | null; k?: number | null; organique?: boolean; unite?: string; ferme?: string; supprime?: string | null } = {}): LigneLocale => ({
  id,
  ferme_id: t.ferme ?? FERME,
  nom,
  forme: 'solide',
  unite: t.unite ?? 't',
  teneur_n: t.n ?? null,
  teneur_p2o5: t.p ?? null,
  teneur_k2o: t.k ?? null,
  organique: t.organique === false ? 0 : 1,
  utilisable_en_bio: 1,
  source: '',
  cree_le: CREE,
  modifie_le: CREE,
  supprime_le: t.supprime ?? null,
});

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

let n = 0;
interface Apport {
  readonly id?: string;
  readonly date: string;
  readonly emplacements?: readonly string[];
  readonly categorie?: 'fertilisation' | 'amendement';
  readonly type?: string;
  readonly produit: string;
  readonly produitId?: string | null;
  readonly quantite: number;
  readonly unite?: string;
  readonly ferme?: string;
  readonly remplace?: { sorte: 'correction' | 'annulation'; id: string };
  readonly serie?: string | null;
  readonly occurrenceVisee?: string | null;
}
function apport(a: Apport): LigneLocale {
  n++;
  const id = a.id ?? uuid(0x1000 + n);
  const detail: Record<string, unknown> = {
    categorie: a.categorie ?? 'amendement',
    type: a.type ?? 'compost',
    outil: null,
    produit: a.produit,
    quantite: { valeur: a.quantite, unite: a.unite ?? 't' },
  };
  if (a.produitId !== undefined) detail.produitFertilisantId = a.produitId;
  if (a.occurrenceVisee !== undefined) detail.occurrenceVisee = a.occurrenceVisee;
  return {
    id,
    ferme_id: a.ferme ?? FERME,
    type: 'intervention',
    date: a.date,
    horodatage: `${a.date}T08:${String(n % 60).padStart(2, '0')}:00.000Z`,
    auteur_id: AUTEUR,
    source: 'tap',
    serie_id: a.serie ?? null,
    campagne_id: null,
    emplacement_ids: JSON.stringify(a.emplacements ?? [P1]),
    note: null,
    photos: '[]',
    remplace_sorte: a.remplace?.sorte ?? null,
    remplace_evenement_id: a.remplace?.id ?? null,
    detail: JSON.stringify(detail),
    cree_le: CREE,
    origine_id: id,
  };
}

/** P1 : 50 m × 2 m = 100 m² ; P2 : 25 m × 0,8 m = 20 m². */
function tables(evenements: readonly LigneLocale[], autres: Partial<Record<string, LigneLocale[]>> = {}): Tables {
  return {
    evenement: evenements,
    produit_fertilisant: [
      produit(COMPOST, 'Compost de déchets verts', { n: 1 }),
      produit(CORNE, 'Corne broyée', { n: 13, unite: 'kg' }),
      produit(SANS_TENEUR, 'Fumier du voisin'),
      produit(ENGRAIS_MINERAL, 'Ammonitrate', { n: 33.5, organique: false, unite: 'kg' }),
    ],
    emplacement: [emplacement(P1, 'P1', 50, 2), emplacement(P2, 'P2', 25, 0.8), emplacement(SANS_LARGEUR, 'G1', 30, null)],
    saison: [{ id: uuid(0x40), ferme_id: FERME, nom: 'Saison 2027', debut: '2027-01-01', fin: '2027-12-31', supprime_le: null }],
    ...autres,
  };
}

const bilanDe = (b: { parEmplacement: readonly BilanEmplacement[] }, emplacementId: string): BilanEmplacement | undefined => b.parEmplacement.find((x) => x.emplacementId === emplacementId);

describe('T54 : calcul des unités apportées (règle 3)', () => {
  it('exemple du ticket : 2 t de compost à 1 % N sur 100 m² → 20 kg N, soit 2 000 kg N/ha', () => {
    const kg = m.unitesApport({ valeur: 2, unite: 't' }, { teneurN: 1, teneurP2o5: null, teneurK2o: null });
    expect(kg).toEqual({ n: 20, p2o5: null, k2o: null });
    expect(kg === null ? null : m.parHectare(kg, 100)).toEqual({ n: 2000, p2o5: null, k2o: null });
  });

  it('teneur absente : aucune unité (null), l’apport reste compté ailleurs', () => {
    expect(m.unitesApport({ valeur: 2, unite: 't' }, { teneurN: null, teneurP2o5: null, teneurK2o: null })).toBeNull();
  });

  it.each([
    [{ valeur: 500, unite: 'kg' }, 500],
    [{ valeur: 2, unite: 't' }, 2000],
    [{ valeur: 2, unite: ' T ' }, 2000],
    [{ valeur: 300, unite: 'L' }, 300],
    [{ valeur: 1.5, unite: 'm3' }, 1500],
    [{ valeur: 1.5, unite: 'm³' }, 1500],
  ])('quantité %o → %d kg', (q, kg) => {
    expect(m.quantiteEnKg(q)).toBe(kg);
  });

  it('unité non convertible (« brouette ») : null, pas d’unités', () => {
    expect(m.quantiteEnKg({ valeur: 3, unite: 'brouette' })).toBeNull();
    expect(m.unitesApport({ valeur: 3, unite: 'brouette' }, { teneurN: 1, teneurP2o5: null, teneurK2o: null })).toBeNull();
  });

  it('N, P₂O₅ et K₂O, arrondis au centième', () => {
    expect(m.unitesApport({ valeur: 0.3, unite: 't' }, { teneurN: 0.55, teneurP2o5: 0.25, teneurK2o: 0.8 })).toEqual({ n: 1.65, p2o5: 0.75, k2o: 2.4 });
    expect(m.parHectare({ n: 0.1, p2o5: 0.2, k2o: null }, 3)).toEqual({ n: 333.33, p2o5: 666.67, k2o: null });
  });

  it('surface inconnue ou nulle : pas de kg/ha', () => {
    expect(m.parHectare({ n: 20, p2o5: null, k2o: null }, null)).toBeNull();
    expect(m.parHectare({ n: 20, p2o5: null, k2o: null }, 0)).toBeNull();
  });
});

describe('T54 : produits fertilisants de la ferme (règle 1)', () => {
  const ligne = (autres: Record<string, unknown> = {}) => ({ ...produit(COMPOST, 'Compost de déchets verts', { n: 1, p: 0.4, k: 0.8 }), source: 'Chambre d’agriculture, 2024', ...autres });

  it('ligne complète acceptée, lue en valeurs typées', () => {
    const r = m.validerProduitFertilisant(ligne());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur).toMatchObject({ id: COMPOST, fermeId: FERME, nom: 'Compost de déchets verts', forme: 'solide', unite: 't', teneurN: 1, teneurP2o5: 0.4, teneurK2o: 0.8, organique: true, utilisableEnBio: true, supprimeLe: null });
  });

  it('teneurs facultatives : nulles acceptées', () => {
    expect(m.validerProduitFertilisant(ligne({ teneur_n: null, teneur_p2o5: null, teneur_k2o: null })).ok).toBe(true);
  });

  it.each([
    ['nom vide', { nom: '  ' }, 'nom'],
    ['nom trop long', { nom: 'x'.repeat(201) }, 'nom'],
    ['forme inconnue', { forme: 'gazeuse' }, 'forme'],
    ['unité inconnue', { unite: 'brouette' }, 'unite'],
    ['teneur négative', { teneur_n: -1 }, 'teneur_n'],
    ['teneur au-delà de 100 %', { teneur_k2o: 101 }, 'teneur_k2o'],
    ['teneur en texte', { teneur_p2o5: '1' }, 'teneur_p2o5'],
    ['organique hors 0/1', { organique: 2 }, 'organique'],
    ['bio hors 0/1', { utilisable_en_bio: 'oui' }, 'utilisable_en_bio'],
    ['source trop longue', { source: 'x'.repeat(301) }, 'source'],
    ['sans ferme (pas de bibliothèque commune)', { ferme_id: null }, 'ferme_id'],
  ])('%s : refusé', (_nom, autres, champ) => {
    const r = m.validerProduitFertilisant(ligne(autres));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.champ).toBe(champ);
  });

  it('colonne inconnue : refusée', () => {
    const r = m.validerProduitFertilisant(ligne({ dose_conseillee: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur.code).toBe('cle_inconnue');
  });

  it('liste de départ : chaque produit est valide, sourcé, et la liste du ticket y est', () => {
    expect(m.FERTILISANTS_DEPART.length).toBeGreaterThanOrEqual(4);
    for (const [i, p] of m.FERTILISANTS_DEPART.entries()) {
      const r = m.validerProduitFertilisant({
        id: uuid(0x2000 + i),
        ferme_id: FERME,
        nom: p.nom,
        forme: p.forme,
        unite: p.unite,
        teneur_n: p.teneurN,
        teneur_p2o5: p.teneurP2o5,
        teneur_k2o: p.teneurK2o,
        organique: p.organique,
        utilisable_en_bio: p.utilisableEnBio,
        source: p.source,
        supprime_le: null,
      });
      expect(r.ok, `${p.nom} : ${r.ok ? '' : r.erreur.message}`).toBe(true);
      expect(p.source.trim(), `${p.nom} : source citée`).not.toBe('');
      // Une source datée (année).
      expect(p.source, `${p.nom} : source datée`).toMatch(/\b(19|20)\d{2}\b/);
    }
    const noms = m.FERTILISANTS_DEPART.map((p) => p.nom.toLowerCase());
    for (const attendu of ['compost de déchets verts', 'fumier de bovin', 'corne broyée', 'vinasse']) {
      expect(noms.some((x) => x.includes(attendu)), attendu).toBe(true);
    }
  });
});

describe('T54 : saisie d’un apport (règle 2)', () => {
  const ligneEvenement = (detail: unknown) => ({ ...apport({ date: '2027-03-10', produit: 'x', quantite: 1 }), detail: JSON.stringify(detail) });

  it('detailApport : produit de la ferme, accepté par validerSaisie', () => {
    const d = m.detailApport('amendement', { id: COMPOST, nom: 'Compost de déchets verts' }, { valeur: 2, unite: 't' });
    expect(d).toMatchObject({ categorie: 'amendement', produit: 'Compost de déchets verts', quantite: { valeur: 2, unite: 't' }, produitFertilisantId: COMPOST });
    expect(coeur.validerSaisie(ligneEvenement(d)).ok).toBe(true);
  });

  it('detailApport : texte libre (sans produit de la ferme) accepté, sans id', () => {
    const d = m.detailApport('fertilisation', { id: null, nom: 'Purin maison' }, { valeur: 20, unite: 'L' });
    expect(d).toMatchObject({ categorie: 'fertilisation', produit: 'Purin maison', produitFertilisantId: null });
    expect(coeur.validerSaisie(ligneEvenement(d)).ok).toBe(true);
  });

  it('validerSaisie : une intervention d’avant T54 (sans produitFertilisantId) reste acceptée', () => {
    expect(coeur.validerSaisie(ligneEvenement({ categorie: 'amendement', type: 'compost', outil: null, produit: 'compost', quantite: { valeur: 1, unite: 't' } })).ok).toBe(true);
  });

  it('validerSaisie : produitFertilisantId qui n’est pas un UUID → refusé', () => {
    const r = coeur.validerSaisie(ligneEvenement({ categorie: 'amendement', type: 'compost', outil: null, produit: 'compost', quantite: { valeur: 1, unite: 't' }, produitFertilisantId: 'compost' }));
    expect(r.ok).toBe(false);
    expect(r.erreur?.code).toBe('champ_invalide');
  });

  it('validerSaisie : produitFertilisantId sur une autre catégorie → refusé', () => {
    const r = coeur.validerSaisie(ligneEvenement({ categorie: 'entretien', type: 'désherbage', outil: null, produitFertilisantId: COMPOST }));
    expect(r.ok).toBe(false);
  });
});

describe('T54 : bilan par planche et par saison (règle 3)', () => {
  it('2 t de compost à 1 % N sur P1 (100 m²) : 20 kg N, 2 000 kg N/ha dans la saison', () => {
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 2 })]), FERME);
    expect(b.apports).toHaveLength(1);
    expect(b.apports[0]).toMatchObject({ produit: 'Compost de déchets verts', produitId: COMPOST, surfaceM2: 100, kg: { n: 20, p2o5: null, k2o: null }, kgParHa: { n: 2000, p2o5: null, k2o: null }, organique: true, prevu: false });
    expect(bilanDe(b, P1)).toEqual({
      emplacementId: P1,
      periode: 'Saison 2027',
      realise: { n: 2000, p2o5: 0, k2o: 0, nOrganique: 2000, apports: 1, sansUnites: 0 },
      prevu: { n: 0, p2o5: 0, k2o: 0, nOrganique: 0, apports: 0, sansUnites: 0 },
    });
  });

  it('teneur absente : apport compté sans unités', () => {
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Fumier du voisin', produitId: SANS_TENEUR, quantite: 3 })]), FERME);
    expect(b.apports[0]).toMatchObject({ kg: null, kgParHa: null });
    expect(bilanDe(b, P1)?.realise).toEqual({ n: 0, p2o5: 0, k2o: 0, nOrganique: 0, apports: 1, sansUnites: 1 });
  });

  it('texte libre sans produit de la ferme : compté, sans unités ; nom égal à un produit : ce produit', () => {
    const b = m.bilanFertilisation(
      tables([apport({ date: '2027-03-10', produit: 'purin d’ortie', quantite: 1 }), apport({ date: '2027-03-11', produit: '  corne BROYÉE ', categorie: 'fertilisation', type: 'engrais', quantite: 10, unite: 'kg' })]),
      FERME,
    );
    expect(b.apports.find((a) => a.date === '2027-03-10')).toMatchObject({ produitId: null, kg: null });
    // 10 kg × 13 % = 1,3 kg N sur 100 m² → 130 kg N/ha.
    expect(b.apports.find((a) => a.date === '2027-03-11')).toMatchObject({ produitId: CORNE, kg: { n: 1.3 }, kgParHa: { n: 130 } });
    expect(bilanDe(b, P1)?.realise).toMatchObject({ n: 130, apports: 2, sansUnites: 1 });
  });

  it('plusieurs emplacements : la surface est leur somme, chacun reçoit la même dose par hectare', () => {
    // 1,2 t × 1 % = 12 kg N sur 120 m² → 1 000 kg N/ha sur P1 et sur P2.
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 1.2, emplacements: [P1, P2] })]), FERME);
    expect(b.apports[0]).toMatchObject({ surfaceM2: 120, kg: { n: 12 }, kgParHa: { n: 1000 } });
    expect(bilanDe(b, P1)?.realise.n).toBe(1000);
    expect(bilanDe(b, P2)?.realise.n).toBe(1000);
  });

  it('emplacement sans largeur : kg comptés, kg/ha inconnus', () => {
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 1, emplacements: [SANS_LARGEUR] })]), FERME);
    expect(b.apports[0]).toMatchObject({ surfaceM2: null, kg: { n: 10 }, kgParHa: null });
    expect(bilanDe(b, SANS_LARGEUR)?.realise).toMatchObject({ n: 0, apports: 1, sansUnites: 1 });
  });

  it('annulé : ne compte pas ; corrigé : seule la correction compte ; autre ferme : ignorée', () => {
    const annule = apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 5 });
    const corrige = apport({ date: '2027-03-12', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 5 });
    const b = m.bilanFertilisation(
      tables([
        annule,
        apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 5, remplace: { sorte: 'annulation', id: String(annule.id) } }),
        corrige,
        apport({ date: '2027-03-12', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 1, remplace: { sorte: 'correction', id: String(corrige.id) } }),
        apport({ date: '2027-03-12', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 9, ferme: VOISINE }),
      ]),
      FERME,
    );
    expect(b.apports).toHaveLength(1);
    expect(bilanDe(b, P1)?.realise).toMatchObject({ n: 1000, apports: 1 });
  });

  it('période : la saison de la ferme qui contient la date, à défaut l’année', () => {
    const b = m.bilanFertilisation(
      tables([apport({ date: '2027-03-10', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 1 }), apport({ date: '2028-02-01', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 1 })]),
      FERME,
    );
    expect(b.parEmplacement.filter((x) => x.emplacementId === P1).map((x) => x.periode).sort()).toEqual(['2028', 'Saison 2027']);
  });

  it('azote organique à part : un engrais minéral compte dans N, pas dans N organique', () => {
    // 3 kg × 33,5 % = 1,005 kg N sur 100 m² → 100,5 kg N/ha.
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Ammonitrate', produitId: ENGRAIS_MINERAL, categorie: 'fertilisation', type: 'engrais', quantite: 3, unite: 'kg' })]), FERME);
    expect(bilanDe(b, P1)?.realise).toMatchObject({ n: 100.5, nOrganique: 0 });
  });
});

describe('T54 : apports prévus, issus des travaux prévus (règles 3 et 6)', () => {
  const serie = (travaux: readonly unknown[]): LigneLocale => ({
    id: SERIE,
    ferme_id: FERME,
    saison_id: uuid(0x40),
    espece_id: uuid(0x60),
    variete_id: null,
    itineraire_id: null,
    parametres: JSON.stringify({ travauxPrevus: travaux }),
    prevu_semis_pepiniere: null,
    prevu_mise_en_place: '2027-04-20',
    prevu_debut_recolte: '2027-06-01',
    prevu_fin_recolte: '2027-07-01',
    statut: 'prevue',
    supprime_le: null,
  });
  const compostAvantPlantation = { categorie: 'amendement', type: 'compost', repere: 'mise_en_place', decalageJours: -10, repetition: null, outil: null, produit: { nom: 'Compost de déchets verts', quantite: { valeur: 1, unite: 't' } }, tempsEstime: null };
  const occupation: LigneLocale = { id: uuid(0x70), ferme_id: FERME, emplacement_id: P1, serie_id: SERIE, plantation_id: null, prevu_du: '2027-04-20', prevu_au: '2027-07-01', supprime_le: null };

  it('un travail prévu non fait : un apport prévu (à part), qui ne compte pas dans le réalisé', () => {
    const b = m.bilanFertilisation(tables([], { serie: [serie([compostAvantPlantation])], occupation: [occupation] }), FERME);
    expect(b.apports).toHaveLength(0);
    expect(b.prevus).toHaveLength(1);
    expect(b.prevus[0]).toMatchObject({ evenementId: null, prevu: true, date: '2027-04-10', produitId: COMPOST, emplacementIds: [P1], kgParHa: { n: 1000 } });
    expect(bilanDe(b, P1)).toMatchObject({ realise: { n: 0, apports: 0 }, prevu: { n: 1000, nOrganique: 1000, apports: 1 } });
  });

  it('le travail fait (intervention qui solde l’occurrence) : plus de prévu, un réalisé', () => {
    const fait = apport({ date: '2027-04-11', produit: 'Compost de déchets verts', quantite: 1, serie: SERIE, occurrenceVisee: '2027-04-10' });
    const b = m.bilanFertilisation(tables([fait], { serie: [serie([compostAvantPlantation])], occupation: [occupation] }), FERME);
    expect(b.prevus).toHaveLength(0);
    expect(b.apports).toHaveLength(1);
  });

  it('série abandonnée ou supprimée : rien de prévu', () => {
    expect(m.bilanFertilisation(tables([], { serie: [{ ...serie([compostAvantPlantation]), statut: 'abandonnee' }], occupation: [occupation] }), FERME).prevus).toHaveLength(0);
    expect(m.bilanFertilisation(tables([], { serie: [{ ...serie([compostAvantPlantation]), supprime_le: CREE }], occupation: [occupation] }), FERME).prevus).toHaveLength(0);
  });
});

describe('T54 : zone vulnérable, plafond de 170 kg N/ha d’azote organique (règle 6)', () => {
  // Corne broyée à 13 % N, en kg, sur P1 (100 m²) : 10 kg → 1,3 kg N → 130 kg N/ha.
  const corne = (date: string, kg: number) => apport({ date, produit: 'Corne broyée', produitId: CORNE, categorie: 'fertilisation', type: 'engrais', quantite: kg, unite: 'kg' });

  it('plafond par défaut : 170 kg N/ha', () => {
    expect(m.PLAFOND_AZOTE_ORGANIQUE_KG_HA).toBe(170);
  });

  it('180 kg N/ha organique réalisés sur l’année, en deux apports : une alerte', () => {
    // Corne : 10 kg × 13 % = 1,3 kg N → 130 kg N/ha ; compost : 0,05 t × 1 % = 0,5 kg N → 50 kg N/ha.
    const b = m.bilanFertilisation(tables([corne('2027-03-10', 10), apport({ date: '2027-09-01', produit: 'Compost de déchets verts', produitId: COMPOST, quantite: 0.05 })]), FERME);
    expect(bilanDe(b, P1)?.realise.nOrganique).toBe(180);
    expect(m.alertesAzoteOrganique(b)).toEqual([{ emplacementId: P1, annee: '2027', realiseKgHa: 180, prevuKgHa: 0, sorte: 'realise' }]);
  });

  it('180 → alerte ; 160 → rien ; 170 tout juste → rien', () => {
    // Produit organique à 1 % N, en kg, sur P1 (100 m²) : x kg → x ÷ 100 kg N → x kg N/ha.
    const t = (kgN: number) =>
      tables([apport({ date: '2027-03-10', produit: 'Fientes', produitId: uuid(0x24), categorie: 'fertilisation', type: 'engrais', quantite: kgN, unite: 'kg' })], {
        produit_fertilisant: [produit(uuid(0x24), 'Fientes', { n: 1, unite: 'kg' })],
      });
    expect(m.alertesAzoteOrganique(m.bilanFertilisation(t(180), FERME))).toEqual([{ emplacementId: P1, annee: '2027', realiseKgHa: 180, prevuKgHa: 0, sorte: 'realise' }]);
    expect(m.alertesAzoteOrganique(m.bilanFertilisation(t(160), FERME))).toEqual([]);
    expect(m.alertesAzoteOrganique(m.bilanFertilisation(t(170), FERME)), '170 tout juste : pas au-delà').toEqual([]);
  });

  it('l’azote minéral ne compte pas dans le plafond', () => {
    const b = m.bilanFertilisation(tables([apport({ date: '2027-03-10', produit: 'Ammonitrate', produitId: ENGRAIS_MINERAL, categorie: 'fertilisation', type: 'engrais', quantite: 10, unite: 'kg' })]), FERME);
    expect(bilanDe(b, P1)?.realise.n).toBe(335);
    expect(m.alertesAzoteOrganique(b)).toEqual([]);
  });

  it('par année civile : 100 en 2027 et 100 en 2028 → rien', () => {
    const b = m.bilanFertilisation(tables([corne('2027-12-30', 100 / 13), corne('2028-01-02', 100 / 13)]), FERME);
    expect(m.alertesAzoteOrganique(b)).toEqual([]);
  });

  it('réalisé sous le plafond mais réalisé + prévu au-delà : alerte « prévu »', () => {
    const serie: LigneLocale = {
      id: SERIE,
      ferme_id: FERME,
      saison_id: uuid(0x40),
      espece_id: uuid(0x60),
      variete_id: null,
      itineraire_id: null,
      parametres: JSON.stringify({
        travauxPrevus: [{ categorie: 'amendement', type: 'compost', repere: 'mise_en_place', decalageJours: -10, repetition: null, outil: null, produit: { nom: 'Compost de déchets verts', quantite: { valeur: 0.1, unite: 't' } }, tempsEstime: null }],
      }),
      prevu_semis_pepiniere: null,
      prevu_mise_en_place: '2027-04-20',
      prevu_debut_recolte: '2027-06-01',
      prevu_fin_recolte: '2027-07-01',
      statut: 'en_cours',
      supprime_le: null,
    };
    const occ: LigneLocale = { id: uuid(0x70), ferme_id: FERME, emplacement_id: P1, serie_id: SERIE, plantation_id: null, prevu_du: '2027-04-20', prevu_au: '2027-07-01', supprime_le: null };
    // Réalisé : 130 ; prévu : 0,1 t × 1 % = 1 kg N sur 100 m² = 100 kg N/ha.
    const b = m.bilanFertilisation(tables([corne('2027-03-10', 10)], { serie: [serie], occupation: [occ] }), FERME);
    expect(m.alertesAzoteOrganique(b)).toEqual([{ emplacementId: P1, annee: '2027', realiseKgHa: 130, prevuKgHa: 100, sorte: 'prevu' }]);
  });
});
