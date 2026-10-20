/**
 * Tests d'acceptation T52 — délai avant récolte, dose maximale, produits de la ferme, registre
 * (docs/backlog/T52-registre-phyto.md, règles 1, 3, 5 et 6). Contrat : ./test/contrat.ts.
 * Aucune base, aucun réseau, aucune horloge.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DateCalendaire } from '../dates/index.ts';
import { chargerPhyto, type LigneLocale, type ModulePhyto, type TraitementLu } from './test/contrat.ts';

let m: ModulePhyto;
let coeur: { validerSaisie(entree: unknown): { readonly ok: boolean } };

beforeAll(async () => {
  m = await chargerPhyto();
  coeur = await import('../index.ts');
});

const uuid = (n: number): string => `0192f0c1-5252-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const AUTRE_FERME = uuid(2);
const P01 = uuid(0x10);
const P02 = uuid(0x11);
const P03 = uuid(0x12);
const BOUILLIE = uuid(0x20);
const SPINOSAD = uuid(0x21);
const d = (s: string) => s as DateCalendaire;

const BOUILLIE_PRODUIT = { id: BOUILLIE, nomCommercial: 'Bouillie bordelaise', delaiAvantRecolteJours: 3, doseMaximale: { valeur: 3, unite: 'L/ha' } };

let horo = 0;
function traitement(n: number, date: string, recolteAutoriseeLe: string, emplacements: readonly string[] = [P01], autre: Partial<TraitementLu> = {}): TraitementLu {
  horo++;
  return {
    id: uuid(0x100 + n),
    date,
    horodatage: `2027-05-${String(10 + Math.floor(horo / 60)).padStart(2, '0')}T08:${String(horo % 60).padStart(2, '0')}:00.000Z`,
    emplacementIds: emplacements,
    remplaceSorte: null,
    remplaceEvenementId: null,
    produitPhytoId: BOUILLIE,
    recolteAutoriseeLe,
    ...autre,
  };
}

describe('T52 : date de récolte autorisée (DAR)', () => {
  it('DAR 3 j, traitement le 10/05 → récolte autorisée le 13/05', () => {
    expect(m.dateRecolteAutorisee(d('2027-05-10'), 3)).toBe('2027-05-13');
  });

  it('calendrier : fin de mois, fin d’année, année bissextile ; DAR 0 = le jour même', () => {
    expect(m.dateRecolteAutorisee(d('2027-05-30'), 3)).toBe('2027-06-02');
    expect(m.dateRecolteAutorisee(d('2027-12-30'), 7)).toBe('2028-01-06');
    expect(m.dateRecolteAutorisee(d('2028-02-27'), 3)).toBe('2028-03-01');
    expect(m.dateRecolteAutorisee(d('2027-05-10'), 0)).toBe('2027-05-10');
  });

  it('detailTraitement fige le DAR du produit dans le détail : changer le produit après coup ne change rien', () => {
    const saisie = { dose: { valeur: 2.5, unite: 'L/ha' }, surfaceTraiteeM2: 54, cible: '  mildiou ', operateur: null };
    const detail = m.detailTraitement(BOUILLIE_PRODUIT, saisie, d('2027-05-10'));
    expect(detail).toEqual({
      produitPhytoId: BOUILLIE,
      dose: { valeur: 2.5, unite: 'L/ha' },
      surfaceTraiteeM2: 54,
      cible: 'mildiou',
      operateur: '',
      recolteAutoriseeLe: '2027-05-13',
    });
    // Le produit passe à 21 jours : le détail déjà calculé garde sa date.
    const modifie = { ...BOUILLIE_PRODUIT, delaiAvantRecolteJours: 21 };
    const autre = m.detailTraitement(modifie, saisie, d('2027-05-10'));
    expect(autre.recolteAutoriseeLe).toBe('2027-05-31');
    expect(detail.recolteAutoriseeLe).toBe('2027-05-13');
    // L'interdiction se lit dans l'événement, jamais dans le produit.
    const t = traitement(1, '2027-05-10', detail.recolteAutoriseeLe);
    expect(m.interdictionRecolte([t], [P01], '2027-05-20')).toBeNull();
    expect(m.interdictionRecolte([t], [P01], '2027-05-12')?.recolteAutoriseeLe).toBe('2027-05-13');
  });

  it('le détail calculé est une saisie que le serveur accepte (validerSaisie)', () => {
    const detail = m.detailTraitement(BOUILLIE_PRODUIT, { dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: 'Théo' }, d('2027-05-10'));
    const r = coeur.validerSaisie({
      id: uuid(0x900),
      ferme_id: FERME,
      type: 'traitement',
      date: '2027-05-10',
      horodatage: '2027-05-10T08:00:00.000Z',
      auteur_id: uuid(0x901),
      source: 'tap',
      serie_id: null,
      campagne_id: null,
      emplacement_ids: JSON.stringify([P01]),
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify(detail),
    });
    expect(r.ok).toBe(true);
  });
});

describe('T52 : récolte interdite sous DAR', () => {
  it('interdite du jour du traitement (compris) à la date autorisée (exclue)', () => {
    const t = traitement(1, '2027-05-10', '2027-05-13');
    expect(m.interdictionRecolte([t], [P01], '2027-05-09')).toBeNull();
    for (const jour of ['2027-05-10', '2027-05-11', '2027-05-12']) {
      expect(m.interdictionRecolte([t], [P01], jour), jour).toEqual({
        evenementId: t.id,
        produitPhytoId: BOUILLIE,
        dateTraitement: '2027-05-10',
        recolteAutoriseeLe: '2027-05-13',
      });
    }
    expect(m.interdictionRecolte([t], [P01], '2027-05-13')).toBeNull();
    // Un autre emplacement n'est pas concerné ; casse des identifiants ignorée.
    expect(m.interdictionRecolte([t], [P02], '2027-05-11')).toBeNull();
    expect(m.interdictionRecolte([t], [P02, P01.toUpperCase()], '2027-05-11')?.evenementId).toBe(t.id);
    expect(m.interdictionRecolte([], [P01], '2027-05-11')).toBeNull();
    expect(m.interdictionRecolte([t], [], '2027-05-11')).toBeNull();
  });

  it('deux traitements sur un même emplacement : la date la plus tardive l’emporte', () => {
    const long = traitement(1, '2027-05-08', '2027-05-29', [P01, P02], { produitPhytoId: SPINOSAD });
    const court = traitement(2, '2027-05-10', '2027-05-13', [P01]);
    for (const ordre of [
      [long, court],
      [court, long],
    ]) {
      expect(m.interdictionRecolte(ordre, [P01], '2027-05-11')?.evenementId).toBe(long.id);
      expect(m.interdictionRecolte(ordre, [P01], '2027-05-20')?.recolteAutoriseeLe).toBe('2027-05-29');
    }
    // Plusieurs emplacements demandés : la plus tardive de tous.
    expect(m.interdictionRecolte([court, long], [P03, P02], '2027-05-11')?.evenementId).toBe(long.id);
  });

  it('annulation → l’emplacement redevient libre', () => {
    const t = traitement(1, '2027-05-10', '2027-05-13');
    const annulation = traitement(2, '2027-05-10', '2027-05-13', [P01], { remplaceSorte: 'annulation', remplaceEvenementId: t.id });
    expect(m.interdictionRecolte([t, annulation], [P01], '2027-05-11')).toBeNull();
    expect(m.interdictionRecolte([annulation, t], [P01], '2027-05-11')).toBeNull();
  });

  it('correction → recalcul : seule la correction la plus récente compte ; correction annulée → plus rien', () => {
    const t = traitement(1, '2027-05-10', '2027-05-13');
    const correction = traitement(2, '2027-05-10', '2027-05-31', [P01], { remplaceSorte: 'correction', remplaceEvenementId: t.id });
    expect(m.interdictionRecolte([t, correction], [P01], '2027-05-20')?.evenementId).toBe(correction.id);
    // Correction qui retire l'emplacement : il redevient libre.
    const ailleurs = traitement(3, '2027-05-10', '2027-05-31', [P02], { remplaceSorte: 'correction', remplaceEvenementId: correction.id });
    expect(m.interdictionRecolte([t, correction, ailleurs], [P01], '2027-05-11')).toBeNull();
    expect(m.interdictionRecolte([t, correction, ailleurs], [P02], '2027-05-11')?.evenementId).toBe(ailleurs.id);
    const annulation = traitement(4, '2027-05-10', '2027-05-31', [P02], { remplaceSorte: 'annulation', remplaceEvenementId: ailleurs.id });
    expect(m.interdictionRecolte([t, correction, ailleurs, annulation], [P02], '2027-05-11')).toBeNull();
    expect(m.interdictionRecolte([t, correction, ailleurs, annulation], [P01], '2027-05-11')).toBeNull();
  });

  it('correction dont l’origine n’est pas dans la liste lue : la correction compte', () => {
    const correction = traitement(2, '2027-05-10', '2027-05-31', [P01], { remplaceSorte: 'correction', remplaceEvenementId: uuid(0x777) });
    expect(m.interdictionRecolte([correction], [P01], '2027-05-20')?.evenementId).toBe(correction.id);
  });

  it('relecture : culture sans emplacement (kiwis, campagne sans occupation) — le traitement de la culture interdit sa récolte', () => {
    const CAMPAGNE = uuid(0x30);
    const t = traitement(1, '2027-05-10', '2027-05-13', [], { cultureId: CAMPAGNE });
    expect(m.interdictionRecolte([t], [], '2027-05-11', CAMPAGNE.toUpperCase())?.evenementId).toBe(t.id);
    expect(m.interdictionRecolte([t], [], '2027-05-13', CAMPAGNE)).toBeNull();
    // Une autre culture sur d'autres emplacements n'est pas concernée.
    expect(m.interdictionRecolte([t], [P02], '2027-05-11', uuid(0x31))).toBeNull();
    // Sur ses emplacements, la culture voisine reste interdite (traitement d'une autre série).
    const surP01 = traitement(2, '2027-05-10', '2027-05-13', [P01], { cultureId: uuid(0x31) });
    expect(m.interdictionRecolte([surP01], [P01], '2027-05-11', CAMPAGNE)?.evenementId).toBe(surP01.id);
  });

  it('texte de l’alerte : « Récolte interdite jusqu’au JJ/MM (Produit, traité le JJ/MM) »', () => {
    const i = m.interdictionRecolte([traitement(1, '2027-05-10', '2027-05-13')], [P01], '2027-05-11');
    if (i === null) throw new Error('interdiction attendue');
    expect(m.texteInterdiction(i, 'Bouillie bordelaise')).toBe('Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)');
  });
});

describe('T52 : dose au-dessus du maximum déclaré', () => {
  it('avertissement, jamais un refus', () => {
    const texte = m.avertissementDose({ valeur: 4, unite: 'L/ha' }, { valeur: 3, unite: 'L/ha' });
    expect(texte).not.toBeNull();
    expect(texte).toMatch(/3 L\/ha/);
    expect(m.avertissementDose({ valeur: 4, unite: ' l/HA ' }, { valeur: 3, unite: 'L/ha' })).not.toBeNull();
    // Le serveur accepte la saisie quand même.
    const r = coeur.validerSaisie({
      id: uuid(0x902),
      ferme_id: FERME,
      type: 'traitement',
      date: '2027-05-10',
      horodatage: '2027-05-10T08:00:00.000Z',
      auteur_id: uuid(0x901),
      source: 'tap',
      serie_id: null,
      campagne_id: null,
      emplacement_ids: JSON.stringify([P01]),
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify(m.detailTraitement(BOUILLIE_PRODUIT, { dose: { valeur: 4, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: null }, d('2027-05-10'))),
    });
    expect(r.ok).toBe(true);
  });

  it('rien sans dose maximale, à la dose maximale ou en dessous, ou dans une autre unité', () => {
    expect(m.avertissementDose({ valeur: 4, unite: 'L/ha' }, null)).toBeNull();
    expect(m.avertissementDose({ valeur: 3, unite: 'L/ha' }, { valeur: 3, unite: 'L/ha' })).toBeNull();
    expect(m.avertissementDose({ valeur: 0.2, unite: 'L/ha' }, { valeur: 3, unite: 'L/ha' })).toBeNull();
    expect(m.avertissementDose({ valeur: 400, unite: 'g/hl' }, { valeur: 3, unite: 'L/ha' })).toBeNull();
  });
});

describe('T52 : surface traitée depuis les emplacements', () => {
  it('somme des longueur × largeur, au centième ; sans largeur : ne compte pas', () => {
    expect(m.surfaceEmplacements([{ longueurM: 30, largeurM: 0.8 }, { longueurM: 25, largeurM: 1.2 }])).toBe(54);
    expect(m.surfaceEmplacements([{ longueurM: 0.1, largeurM: 0.2 }, { longueurM: 0.2, largeurM: 0.1 }])).toBe(0.04);
    expect(m.surfaceEmplacements([{ longueurM: 30, largeurM: null }])).toBe(0);
    expect(m.surfaceEmplacements([])).toBe(0);
  });
});

describe('T52 : produit phyto de la ferme (validerProduitPhyto)', () => {
  const ligne = (autres: Record<string, unknown> = {}): Record<string, unknown> => {
    const l: Record<string, unknown> = {
      id: BOUILLIE,
      ferme_id: FERME,
      nom_commercial: 'Bouillie bordelaise RSR',
      numero_amm: '9300417',
      substance_active: 'cuivre (sulfate)',
      delai_avant_recolte_jours: 3,
      utilisable_en_bio: 1,
      dose_maximale: JSON.stringify({ valeur: 3, unite: 'L/ha' }),
      cree_le: '2027-05-01T08:00:00.000Z',
      modifie_le: '2027-05-01T08:00:00.000Z',
      supprime_le: null,
    };
    for (const [c, v] of Object.entries(autres)) {
      if (v === undefined) Reflect.deleteProperty(l, c);
      else l[c] = v;
    }
    return l;
  };

  it('ligne complète acceptée, lue en camelCase', () => {
    const r = m.validerProduitPhyto(ligne());
    expect(r.ok ? r.valeur : r.erreur).toEqual({
      id: BOUILLIE,
      fermeId: FERME,
      nomCommercial: 'Bouillie bordelaise RSR',
      numeroAmm: '9300417',
      substanceActive: 'cuivre (sulfate)',
      delaiAvantRecolteJours: 3,
      utilisableEnBio: true,
      doseMaximale: { valeur: 3, unite: 'L/ha' },
      supprimeLe: null,
    });
  });

  it.each([
    [{ dose_maximale: null }],
    [{ dose_maximale: { valeur: 0.5, unite: 'kg/ha' } }],
    [{ numero_amm: '' }],
    [{ substance_active: '' }],
    [{ utilisable_en_bio: false }],
    [{ utilisable_en_bio: 0 }],
    [{ delai_avant_recolte_jours: 0 }],
    [{ delai_avant_recolte_jours: 365 }],
    [{ supprime_le: '2027-06-01T08:00:00.000Z' }],
    [{ cree_le: undefined, modifie_le: undefined }],
  ])('accepté : %j', (autres) => {
    const r = m.validerProduitPhyto(ligne(autres));
    expect(r.ok ? null : r.erreur).toBeNull();
  });

  it.each([
    [{ ferme_id: null }, 'ferme_id'],
    [{ id: 'bouillie' }, 'id'],
    [{ nom_commercial: '   ' }, 'nom_commercial'],
    [{ nom_commercial: undefined }, 'nom_commercial'],
    [{ nom_commercial: 'x'.repeat(201) }, 'nom_commercial'],
    [{ numero_amm: 'x'.repeat(41) }, 'numero_amm'],
    [{ numero_amm: 12 }, 'numero_amm'],
    [{ substance_active: 'x'.repeat(201) }, 'substance_active'],
    [{ delai_avant_recolte_jours: -1 }, 'delai_avant_recolte_jours'],
    [{ delai_avant_recolte_jours: 1.5 }, 'delai_avant_recolte_jours'],
    [{ delai_avant_recolte_jours: 366 }, 'delai_avant_recolte_jours'],
    [{ delai_avant_recolte_jours: '3' }, 'delai_avant_recolte_jours'],
    [{ delai_avant_recolte_jours: undefined }, 'delai_avant_recolte_jours'],
    [{ utilisable_en_bio: 2 }, 'utilisable_en_bio'],
    [{ dose_maximale: JSON.stringify({ valeur: 0, unite: 'L/ha' }) }, 'dose_maximale'],
    [{ dose_maximale: JSON.stringify({ valeur: -1, unite: 'L/ha' }) }, 'dose_maximale'],
    [{ dose_maximale: JSON.stringify({ valeur: 3, unite: ' ' }) }, 'dose_maximale'],
    [{ dose_maximale: '{illisible' }, 'dose_maximale'],
    [{ dose_maximale: JSON.stringify({ valeur: 3, unite: 'L/ha', x: 1 }) }, 'dose_maximale'],
    [{ supprime_le: 'hier' }, 'supprime_le'],
    [{ couleur: 'bleu' }, 'couleur'],
  ])('refusé : %j (%s)', (autres, champ) => {
    const r = m.validerProduitPhyto(ligne(autres));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.champ?.startsWith(champ), `${String(r.erreur.champ)} : ${r.erreur.message}`).toBe(true);
    expect(r.erreur.message.length).toBeGreaterThan(5);
  });

  it('ne lève jamais (entrée qui n’est pas un objet)', () => {
    for (const x of [null, 3, 'texte', [1]]) expect(m.validerProduitPhyto(x).ok).toBe(false);
  });
});

describe('T52 : registre phyto', () => {
  const evenement = (id: string, date: string, horodatage: string, autres: Record<string, unknown> = {}, detail: Record<string, unknown> = {}): LigneLocale => ({
    id,
    ferme_id: FERME,
    type: 'traitement',
    date,
    horodatage,
    auteur_id: uuid(0x901),
    source: 'tap',
    serie_id: SERIE,
    campagne_id: null,
    emplacement_ids: JSON.stringify([P02, P01]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2.5, unite: 'L/ha' }, surfaceTraiteeM2: 54, cible: 'mildiou', operateur: 'Théo', recolteAutoriseeLe: '2027-05-13', ...detail }),
    ...(autres as Record<string, string | number | null>),
  });
  const SERIE = uuid(0x30);
  const CAMPAGNE = uuid(0x31);
  const PLANTATION = uuid(0x32);
  const TOMATE = uuid(0x40);
  const FRAISE = uuid(0x41);
  const COEUR = uuid(0x50);
  const T1 = uuid(0x200);
  const T2 = uuid(0x201);
  const T3 = uuid(0x202);
  const T3_ANNULE = uuid(0x203);
  const T4 = uuid(0x204);
  const T4_CORRIGE = uuid(0x205);

  function tables(): Record<string, LigneLocale[]> {
    return {
      evenement: [
        evenement(T2, '2027-05-12', '2027-05-12T08:00:00.000Z', { serie_id: null, campagne_id: CAMPAGNE, emplacement_ids: JSON.stringify([P03]) }, { produitPhytoId: SPINOSAD, operateur: '', recolteAutoriseeLe: '2027-05-15' }),
        evenement(T1, '2027-05-10', '2027-05-10T08:00:00.000Z'),
        evenement(T3, '2027-05-11', '2027-05-11T08:00:00.000Z'),
        evenement(T3_ANNULE, '2027-05-11', '2027-05-11T09:00:00.000Z', { remplace_sorte: 'annulation', remplace_evenement_id: T3 }),
        evenement(T4, '2027-05-11', '2027-05-11T10:00:00.000Z'),
        evenement(T4_CORRIGE, '2027-05-11', '2027-05-11T11:00:00.000Z', { remplace_sorte: 'correction', remplace_evenement_id: T4, serie_id: null, emplacement_ids: '[]' }, { cible: 'oïdium', dose: { valeur: 1.5, unite: 'L/ha' } }),
        // Autres types et autre ferme : jamais dans le registre.
        { ...evenement(uuid(0x206), '2027-05-10', '2027-05-10T07:00:00.000Z'), type: 'recolte', detail: JSON.stringify({ quantite: 3, unite: 'kg', categorie: null }) },
        { ...evenement(uuid(0x207), '2027-05-10', '2027-05-10T07:00:00.000Z'), ferme_id: AUTRE_FERME },
      ],
      produit_phyto: [
        { id: BOUILLIE, ferme_id: FERME, nom_commercial: 'Bouillie bordelaise RSR', numero_amm: '9300417', substance_active: 'cuivre', delai_avant_recolte_jours: 21, utilisable_en_bio: 1, dose_maximale: null, supprime_le: '2027-06-01T08:00:00.000Z' },
        { id: SPINOSAD, ferme_id: null, nom_commercial: 'Success 4', numero_amm: '2010513', substance_active: 'spinosad', delai_avant_recolte_jours: 3, utilisable_en_bio: 0, dose_maximale: null, supprime_le: null },
      ],
      emplacement: [
        { id: P01, ferme_id: FERME, code: 'T2-P01' },
        { id: P02, ferme_id: FERME, code: 'T1-P04' },
        { id: P03, ferme_id: FERME, code: 'S1-G01' },
      ],
      serie: [{ id: SERIE, ferme_id: FERME, espece_id: TOMATE, variete_id: COEUR }],
      campagne: [{ id: CAMPAGNE, ferme_id: FERME, plantation_id: PLANTATION }],
      plantation: [{ id: PLANTATION, ferme_id: FERME, espece_id: FRAISE, variete_id: null }],
      espece: [
        { id: TOMATE, ferme_id: null, nom: 'Tomate' },
        { id: FRAISE, ferme_id: FERME, nom: 'Fraise' },
      ],
      variete: [{ id: COEUR, ferme_id: FERME, nom: 'Cœur de bœuf' }],
    };
  }

  it('une ligne par traitement en vigueur, sans les annulés ni les remplacés, dans l’ordre des dates', () => {
    const lignes = m.lignesRegistrePhyto(tables(), FERME);
    expect(lignes.map((l) => l.evenementId)).toEqual([T1, T4_CORRIGE, T2]);
  });

  it('colonnes : produit (même archivé), AMM, bio, dose, surface, emplacements, culture, cible, opérateur, récolte autorisée', () => {
    const [t1, t4, t2] = m.lignesRegistrePhyto(tables(), FERME);
    expect(t1).toEqual({
      evenementId: T1,
      date: '2027-05-10',
      produit: 'Bouillie bordelaise RSR',
      amm: '9300417',
      substanceActive: 'cuivre',
      bio: true,
      dose: 2.5,
      uniteDose: 'L/ha',
      surfaceTraiteeM2: 54,
      emplacements: 'T1-P04, T2-P01',
      culture: 'Tomate Cœur de bœuf',
      cible: 'mildiou',
      operateur: 'Théo',
      // Le DAR figé dans l'événement (3 j), pas celui du produit modifié depuis (21 j).
      recolteAutoriseeLe: '2027-05-13',
    });
    expect(t4).toMatchObject({ cible: 'oïdium', dose: 1.5, culture: '', emplacements: '' });
    expect(t2).toMatchObject({ produit: 'Success 4', amm: '2010513', bio: false, culture: 'Fraise', emplacements: 'S1-G01', operateur: '', recolteAutoriseeLe: '2027-05-15' });
  });

  it('colonnes du CSV en français', () => {
    expect(m.COLONNES_REGISTRE_PHYTO.length).toBeGreaterThanOrEqual(12);
    for (const c of ['date', 'produit', 'amm', 'dose', 'surface_traitee_m2', 'emplacements', 'culture', 'cible', 'operateur', 'recolte_autorisee_le']) {
      expect(m.COLONNES_REGISTRE_PHYTO).toContain(c);
    }
  });
});
