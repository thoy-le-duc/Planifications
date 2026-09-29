/**
 * Tests d'acceptation T10b — règles d'une saisie dans le cœur (docs/backlog/T10b-regles-saisies-coeur.md).
 *
 * Contrat de l'API (validerSaisie, codes d'erreur, format d'entrée et de sortie, plafonds) :
 * voir ./test/contrat.ts. Aucune base, aucun réseau : des valeurs en entrée, un résultat en sortie.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerCoeur, chargerSaisies, type CodeErreurSaisie, type ModuleSaisies, type ResultatSaisie } from './test/contrat.ts';

let m: ModuleSaisies;

beforeAll(async () => {
  m = await chargerSaisies();
});

// ── Données d'exemple ────────────────────────────────────────────────────────────────────────

/** UUID bien formé, distinct pour chaque n. */
const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const ID = uuid(1);
const FERME = uuid(2);
const AUTEUR = uuid(3);
const SERIE = uuid(4);
const CAMPAGNE = uuid(5);
const EMPLACEMENT = uuid(6);
const SECTEUR = uuid(7);
const PHYTO = uuid(8);
const AUTRE_EVENEMENT = uuid(9);

type Detail = Record<string, unknown>;

const DETAILS: Readonly<Record<string, Detail>> = {
  recolte: { quantite: 12.5, unite: 'kg', categorie: null },
  realise: { etape: 'plantation', quantiteReelle: null },
  travail_sol: { categorie: 'travail_sol', type: 'grelinette', outil: null },
  couverture: { categorie: 'couverture', type: 'paillage', outil: null, dureeOccupationJours: 60 },
  fertilisation: { categorie: 'fertilisation', type: 'engrais', outil: null, produit: 'Orgamine', quantite: { valeur: 50, unite: 'kg' } },
  amendement: { categorie: 'amendement', type: 'compost', outil: 'épandeur', produit: 'compost vert', quantite: { valeur: 2_000, unite: 'kg' } },
  entretien: { categorie: 'entretien', type: 'désherbage', outil: 'houe' },
  irrigation: { secteurIrrigationId: SECTEUR, dureeMinutes: 30 },
  traitement: {
    produitPhytoId: PHYTO,
    dose: { valeur: 2, unite: 'L/ha' },
    surfaceTraiteeM2: 100,
    cible: 'mildiou',
    operateur: 'Théo',
    recolteAutoriseeLe: '2026-10-22',
  },
  observation: { nature: 'ravageur', gravite: 'forte' },
};

/** Type d'événement d'un exemple de DETAILS (les catégories d'intervention sont des interventions). */
const typeDe = (exemple: string): string => (exemple in { recolte: 1, realise: 1, irrigation: 1, traitement: 1, observation: 1 } ? exemple : 'intervention');

/** Détail d'un exemple, avec des clés remplacées ; `undefined` retire la clé. */
function detail(exemple: string, changements: Detail = {}): Detail {
  const d: Detail = { ...DETAILS[exemple] };
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === undefined) Reflect.deleteProperty(d, cle);
    else d[cle] = valeur;
  }
  return d;
}

/**
 * Ligne `evenement` telle que le téléphone l'envoie (format PowerSync : texte JSON pour detail,
 * emplacement_ids et photos). `undefined` dans `autres` retire la colonne.
 */
function ligne(exemple = 'recolte', autres: Record<string, unknown> = {}, d: Detail = detail(exemple)): Record<string, unknown> {
  const l: Record<string, unknown> = {
    id: ID,
    ferme_id: FERME,
    type: typeDe(exemple),
    date: '2026-10-01',
    horodatage: '2026-10-01T05:58:00.000Z',
    auteur_id: AUTEUR,
    source: 'tap',
    serie_id: SERIE,
    campagne_id: null,
    emplacement_ids: JSON.stringify([EMPLACEMENT]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify(d),
  };
  for (const [cle, valeur] of Object.entries(autres)) {
    if (valeur === undefined) Reflect.deleteProperty(l, cle);
    else l[cle] = valeur;
  }
  return l;
}

function valider(entree: unknown): ResultatSaisie {
  let r: ResultatSaisie | undefined;
  expect(() => (r = m.validerSaisie(entree)), 'validerSaisie ne lève jamais').not.toThrow();
  if (r === undefined) throw new Error('aucun résultat');
  return r;
}

function accepte(entree: unknown): void {
  const r = valider(entree);
  expect(r.ok ? null : r.erreur, 'saisie acceptée').toBeNull();
}

/** Refus avec ce code (ou l'un de ces codes) et ce champ ; message en français, 200 caractères au plus. */
function refuse(entree: unknown, code: CodeErreurSaisie | readonly CodeErreurSaisie[], champ?: string | null): void {
  const r = valider(entree);
  expect(r.ok, 'saisie refusée').toBe(false);
  if (r.ok) return;
  const codes: readonly CodeErreurSaisie[] = typeof code === 'string' ? [code] : code;
  expect(codes, `code reçu : ${r.erreur.code} (${r.erreur.message})`).toContain(r.erreur.code);
  if (champ !== undefined) expect(r.erreur.champ).toBe(champ);
  expect(r.erreur.message.trim().length).toBeGreaterThan(5);
  expect(r.erreur.message.length).toBeLessThanOrEqual(200);
}

/** Valeur imbriquée sur `niveaux` niveaux, construite sans récursion. */
function imbrique(niveaux: number): Detail {
  const racine: Detail = {};
  let courant = racine;
  for (let i = 0; i < niveaux; i++) {
    const suivant: Detail = {};
    courant.a = suivant;
    courant = suivant;
  }
  return racine;
}

// ── Module ───────────────────────────────────────────────────────────────────────────────────

describe('module', () => {
  it('@planif/core exporte validerSaisie, LIMITES_SAISIE et PLAFONDS_PROVISOIRES', async () => {
    const coeur = await chargerCoeur();
    expect(typeof coeur.validerSaisie).toBe('function');
    expect(coeur.LIMITES_SAISIE).toBeDefined();
    expect(coeur.PLAFONDS_PROVISOIRES).toBeDefined();
  });

  it('limites de T10', () => {
    expect(m.LIMITES_SAISIE).toEqual({
      noteCaracteres: 4_000,
      photos: 20,
      photoCaracteres: 2_000,
      emplacements: 200,
      detailOctets: 8_192,
    });
  });
});

// ── Saisies acceptées ────────────────────────────────────────────────────────────────────────

describe('saisie acceptée : Evenement de T01', () => {
  it('récolte complète : ids en minuscules, horodatage avec fuseau en Instant, culture et détail', () => {
    const r = valider(
      ligne(
        'recolte',
        {
          id: ID.toUpperCase(),
          ferme_id: FERME.toUpperCase(),
          auteur_id: AUTEUR.toUpperCase(),
          serie_id: SERIE.toUpperCase(),
          emplacement_ids: JSON.stringify([EMPLACEMENT.toUpperCase()]),
          horodatage: '2026-10-01T08:00:00+02:00',
          source: 'voix',
          note: 'rang du fond',
          photos: JSON.stringify(['photo-1.jpg']),
        },
        { quantite: 12.5, unite: 'kg', categorie: 'I' },
      ),
    );
    expect(r).toEqual({
      ok: true,
      saisie: {
        id: ID,
        fermeId: FERME,
        type: 'recolte',
        date: '2026-10-01',
        horodatage: Date.UTC(2026, 9, 1, 6, 0, 0),
        auteurId: AUTEUR,
        source: 'voix',
        culture: { sorte: 'serie', serieId: SERIE },
        emplacementIds: [EMPLACEMENT],
        note: 'rang du fond',
        photos: ['photo-1.jpg'],
        remplaceEvenement: null,
        detail: { quantite: 12.5, unite: 'kg', categorie: 'I' },
      },
    });
  });

  it('campagne, remplacement, sans note ni emplacements ni photos', () => {
    const r = valider(
      ligne('observation', {
        serie_id: null,
        campagne_id: CAMPAGNE,
        remplace_sorte: 'correction',
        remplace_evenement_id: AUTRE_EVENEMENT,
        note: undefined,
        emplacement_ids: undefined,
        photos: null,
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      saisie: {
        type: 'observation',
        culture: { sorte: 'campagne', campagneId: CAMPAGNE },
        remplaceEvenement: { sorte: 'correction', evenementId: AUTRE_EVENEMENT },
        note: null,
        emplacementIds: [],
        photos: [],
        detail: { nature: 'ravageur', gravite: 'forte' },
      },
    });
  });

  it('sans série ni campagne : culture null', () => {
    expect(valider(ligne('irrigation', { serie_id: null, campagne_id: undefined }))).toMatchObject({ ok: true, saisie: { culture: null } });
  });

  it.each(Object.keys(DETAILS))('%s : détail valide accepté tel quel', (exemple) => {
    const r = valider(ligne(exemple));
    expect(r).toMatchObject({ ok: true, saisie: { type: typeDe(exemple), detail: DETAILS[exemple] } });
  });

  it('detail, emplacement_ids et photos déjà en valeur (pas en texte JSON) : même résultat', () => {
    const texte = valider(ligne('traitement', { photos: JSON.stringify(['a.jpg']) }));
    const valeurs = valider(ligne('traitement', { detail: DETAILS.traitement, emplacement_ids: [EMPLACEMENT], photos: ['a.jpg'] }));
    expect(valeurs).toEqual(texte);
    expect(valeurs.ok).toBe(true);
  });

  it('cree_le (remplie par le serveur) est tolérée et ignorée', () => {
    const avec = valider(ligne('recolte', { cree_le: '2026-10-01T06:00:00.000Z' }));
    expect(avec).toEqual(valider(ligne('recolte')));
    expect(avec.ok).toBe(true);
  });

  it('pure : même entrée, même résultat ; entrée gelée acceptée et jamais modifiée', () => {
    const entree = ligne('fertilisation', { detail: DETAILS.fertilisation, emplacement_ids: [EMPLACEMENT.toUpperCase()] });
    const copie: unknown = JSON.parse(JSON.stringify(entree));
    const geler = (v: unknown): void => {
      if (typeof v === 'object' && v !== null) {
        Object.freeze(v);
        Object.values(v).forEach(geler);
      }
    };
    geler(entree);
    const a = valider(entree);
    expect(a.ok).toBe(true);
    expect(valider(entree)).toEqual(a);
    expect(entree).toEqual(copie);
  });
});

// ── Colonnes communes ────────────────────────────────────────────────────────────────────────

describe('colonnes', () => {
  it.each([null, undefined, 42, 'evenement', [], [ligne()]])('entrée %j : entree_invalide', (entree) => {
    refuse(entree, 'entree_invalide', null);
  });

  it('colonne inconnue refusée, avec son nom', () => {
    refuse(ligne('recolte', { quantite: 12 }), 'colonne_inconnue', 'quantite');
  });

  it('colonne inconnue de 10 000 caractères : message de 200 caractères au plus', () => {
    refuse(ligne('recolte', { ['x'.repeat(10_000)]: 1 }), 'colonne_inconnue');
  });

  it.each([
    ['id', 'champ_manquant', undefined],
    ['id', 'champ_invalide', 'evenement-1'],
    ['ferme_id', 'champ_manquant', undefined],
    ['ferme_id', 'champ_manquant', null],
    ['ferme_id', 'champ_invalide', 'ferme'],
    ['auteur_id', 'champ_manquant', null],
    ['auteur_id', 'champ_invalide', `${AUTEUR}0`],
    ['type', 'champ_manquant', undefined],
    ['type', 'champ_invalide', 'vente'],
    ['source', 'champ_manquant', null],
    ['source', 'champ_invalide', 'clavier'],
    ['serie_id', 'champ_invalide', 'serie-4'],
    ['campagne_id', 'champ_invalide', 42],
  ] as const)('%s = %j : %s', (colonne, code, valeur) => {
    refuse(ligne('recolte', { [colonne]: valeur }), code, colonne);
  });

  it('série et campagne à la fois : incoherent', () => {
    refuse(ligne('recolte', { campagne_id: CAMPAGNE }), 'incoherent');
  });
});

describe('date', () => {
  it.each(['2000-01-01', '2100-12-31', '2024-02-29', '2026-10-01'])('%s acceptée', (date) => {
    accepte(ligne('recolte', { date }));
  });

  it.each(['2026-02-30', '2025-02-29', '2026-2-3', '01/10/2026', '2026-10-01T00:00:00Z', 20261001])('%j : champ_invalide', (date) => {
    refuse(ligne('recolte', { date }), 'champ_invalide', 'date');
  });

  it('absente : champ_manquant', () => {
    refuse(ligne('recolte', { date: undefined }), 'champ_manquant', 'date');
  });

  it.each(['1999-12-31', '2101-01-01', '0001-01-01', '9999-12-31'])('%s : hors_bornes', (date) => {
    refuse(ligne('recolte', { date }), 'hors_bornes', 'date');
  });
});

describe('horodatage', () => {
  it.each([
    ['2026-10-01T06:00:00Z', Date.UTC(2026, 9, 1, 6)],
    ['2026-10-01T06:00:00.123Z', Date.UTC(2026, 9, 1, 6, 0, 0, 123)],
    ['2026-10-01T08:00:00+02:00', Date.UTC(2026, 9, 1, 6)],
    ['2026-10-01T01:30:00-04:30', Date.UTC(2026, 9, 1, 6)],
    ['2000-01-01T00:00:00.000Z', Date.UTC(2000, 0, 1)],
    ['2100-12-31T23:59:59.999Z', Date.UTC(2100, 11, 31, 23, 59, 59, 999)],
  ])('%s → Instant %i', (horodatage, instant) => {
    expect(valider(ligne('recolte', { horodatage }))).toMatchObject({ ok: true, saisie: { horodatage: instant } });
  });

  it.each([
    '2026-10-01T06:00:00', // sans fuseau : ambigu
    '2026-10-01',
    '2026-10-01 06:00:00Z',
    'hier matin',
    '2026-13-01T06:00:00Z',
    '2026-10-01T06:60:00Z',
    // Nouveau : Date.parse accepte ce jour inexistant (il devient le 2 mars) ; T10 l'acceptait.
    '2026-02-30T06:00:00Z',
    Date.UTC(2026, 9, 1, 6),
  ])('%j : champ_invalide', (horodatage) => {
    refuse(ligne('recolte', { horodatage }), 'champ_invalide', 'horodatage');
  });

  it('absent : champ_manquant', () => {
    refuse(ligne('recolte', { horodatage: undefined }), 'champ_manquant', 'horodatage');
  });

  it.each([
    '1999-12-31T23:59:59.999Z',
    '2101-01-01T00:00:00Z',
    // Le 1er janvier 2000 à Paris, 0 h 30, c'est encore 1999 en UTC.
    '2000-01-01T00:30:00+01:00',
    '2100-12-31T23:30:00-01:00',
  ])('%s : hors_bornes', (horodatage) => {
    refuse(ligne('recolte', { horodatage }), 'hors_bornes', 'horodatage');
  });
});

describe('note', () => {
  it('4 000 caractères acceptés, 4 001 refusés', () => {
    accepte(ligne('recolte', { note: 'n'.repeat(4_000) }));
    refuse(ligne('recolte', { note: 'n'.repeat(4_001) }), 'trop_long', 'note');
  });

  it('pas un texte : champ_invalide', () => {
    refuse(ligne('recolte', { note: 12 }), 'champ_invalide', 'note');
  });
});

describe('emplacements', () => {
  const emplacements = (n: number): string => JSON.stringify(Array.from({ length: n }, (_, i) => uuid(1_000 + i)));

  it('200 acceptés, 201 refusés', () => {
    accepte(ligne('recolte', { emplacement_ids: emplacements(200) }));
    refuse(ligne('recolte', { emplacement_ids: emplacements(201) }), 'trop_nombreux', 'emplacement_ids');
  });

  it('70 000 emplacements : refus, sans lever', () => {
    refuse(ligne('recolte', { emplacement_ids: emplacements(70_000) }), 'trop_nombreux', 'emplacement_ids');
  });

  it('doublon, même à la casse près : refusé', () => {
    refuse(ligne('recolte', { emplacement_ids: JSON.stringify([EMPLACEMENT, EMPLACEMENT]) }), 'doublon', 'emplacement_ids');
    refuse(ligne('recolte', { emplacement_ids: JSON.stringify([EMPLACEMENT.toUpperCase(), EMPLACEMENT]) }), 'doublon', 'emplacement_ids');
  });

  it.each([
    ['UUID mal formé', JSON.stringify(['planche-3'])],
    ['nombre', JSON.stringify([3])],
    ['objet au lieu d’un tableau', JSON.stringify({ a: EMPLACEMENT })],
    ['texte seul', JSON.stringify(EMPLACEMENT)],
  ])('%s : champ_invalide', (_cas, emplacementIds) => {
    refuse(ligne('recolte', { emplacement_ids: emplacementIds }), 'champ_invalide', 'emplacement_ids');
  });

  it('texte JSON illisible : json_illisible', () => {
    refuse(ligne('recolte', { emplacement_ids: '[' }), 'json_illisible', 'emplacement_ids');
  });

  it('texte JSON imbriqué sur 100 000 niveaux : refus, sans lever', () => {
    refuse(ligne('recolte', { emplacement_ids: `${'['.repeat(100_000)}${']'.repeat(100_000)}` }), ['json_illisible', 'champ_invalide'], 'emplacement_ids');
  });
});

describe('photos', () => {
  const photos = (n: number, taille = 10): string => JSON.stringify(Array.from({ length: n }, (_, i) => String(i).padEnd(taille, 'p')));

  it('20 acceptées, 21 refusées', () => {
    accepte(ligne('recolte', { photos: photos(20) }));
    refuse(ligne('recolte', { photos: photos(21) }), 'trop_nombreux', 'photos');
  });

  it('adresse de 2 000 caractères acceptée, 2 001 refusée', () => {
    accepte(ligne('recolte', { photos: photos(1, 2_000) }));
    refuse(ligne('recolte', { photos: photos(1, 2_001) }), 'trop_long', 'photos');
  });

  it.each([JSON.stringify([1]), JSON.stringify([null]), JSON.stringify({ p: 'a.jpg' })])('%s : champ_invalide', (valeur) => {
    refuse(ligne('recolte', { photos: valeur }), 'champ_invalide', 'photos');
  });

  it('texte JSON illisible : json_illisible', () => {
    refuse(ligne('recolte', { photos: '["a.jpg"' }), 'json_illisible', 'photos');
  });
});

describe('remplacement', () => {
  it.each(['correction', 'annulation'])('%s avec l’événement remplacé : accepté', (sorte) => {
    accepte(ligne('recolte', { remplace_sorte: sorte, remplace_evenement_id: AUTRE_EVENEMENT }));
  });

  it('sorte inconnue : champ_invalide', () => {
    refuse(ligne('recolte', { remplace_sorte: 'suppression', remplace_evenement_id: AUTRE_EVENEMENT }), 'champ_invalide', 'remplace_sorte');
  });

  it('identifiant mal formé : champ_invalide', () => {
    refuse(ligne('recolte', { remplace_sorte: 'correction', remplace_evenement_id: 'e-9' }), 'champ_invalide', 'remplace_evenement_id');
  });

  it('sorte sans événement, ou événement sans sorte : incoherent', () => {
    refuse(ligne('recolte', { remplace_sorte: 'correction' }), 'incoherent');
    refuse(ligne('recolte', { remplace_evenement_id: AUTRE_EVENEMENT }), 'incoherent');
  });

  it('un événement ne se remplace pas lui-même, même à la casse près : incoherent', () => {
    refuse(ligne('recolte', { remplace_sorte: 'annulation', remplace_evenement_id: ID.toUpperCase() }), 'incoherent');
  });
});

// ── Détail ───────────────────────────────────────────────────────────────────────────────────

describe('détail : forme et taille', () => {
  it('absent ou null : champ_manquant', () => {
    refuse(ligne('recolte', { detail: undefined }), 'champ_manquant', 'detail');
    refuse(ligne('recolte', { detail: null }), 'champ_manquant', 'detail');
  });

  it.each([JSON.stringify([1, 2]), JSON.stringify('récolte'), JSON.stringify(12), [DETAILS.recolte]])('%j : champ_invalide', (d) => {
    refuse(ligne('recolte', { detail: d }), 'champ_invalide', 'detail');
  });

  it('texte JSON illisible : json_illisible', () => {
    refuse(ligne('recolte', { detail: '{"quantite": 12' }), 'json_illisible', 'detail');
  });

  it('8 192 octets UTF-8 acceptés, 8 193 refusés', () => {
    const vide = JSON.stringify({ quantite: 1, unite: 'kg', categorie: '' }).length;
    accepte(ligne('recolte', {}, { quantite: 1, unite: 'kg', categorie: 'c'.repeat(8_192 - vide) }));
    refuse(ligne('recolte', {}, { quantite: 1, unite: 'kg', categorie: 'c'.repeat(8_193 - vide) }), 'trop_volumineux', 'detail');
  });

  it('la taille se compte en octets, pas en caractères (é = 2 octets)', () => {
    refuse(ligne('recolte', {}, { quantite: 1, unite: 'kg', categorie: 'é'.repeat(4_100) }), 'trop_volumineux', 'detail');
  });

  it('texte JSON imbriqué sur 100 000 niveaux : refus, sans lever', () => {
    refuse(ligne('recolte', { detail: `${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}` }), ['json_illisible', 'trop_volumineux'], 'detail');
  });

  it('objet imbriqué sur 100 000 niveaux (déjà en valeur) : refus, sans lever', () => {
    refuse(ligne('recolte', { detail: { quantite: 1, unite: 'kg', categorie: imbrique(100_000) } }), ['json_illisible', 'trop_volumineux', 'champ_invalide']);
  });
});

describe('détail : clés autorisées (Detail* de T01)', () => {
  it.each([
    ['recolte', { pirate: 1 }, 'pirate'],
    ['realise', { quantite: 3 }, 'quantite'],
    ['observation', { serieId: SERIE }, 'serieId'],
    ['irrigation', { commentaire: 'x' }, 'commentaire'],
    ['traitement', { quantite: { valeur: 1, unite: 'kg' } }, 'quantite'],
    // Chaque catégorie d'intervention n'a que ses propres clés.
    ['travail_sol', { produit: 'compost' }, 'produit'],
    ['entretien', { dureeOccupationJours: 3 }, 'dureeOccupationJours'],
    ['couverture', { quantite: { valeur: 1, unite: 'kg' } }, 'quantite'],
    ['fertilisation', { dureeOccupationJours: 3 }, 'dureeOccupationJours'],
  ])('%s + %j : cle_inconnue', (exemple, ajout, cle) => {
    refuse(ligne(exemple, {}, detail(exemple, ajout)), 'cle_inconnue', `detail.${cle}`);
  });

  it('quantite et dose n’ont que valeur et unite', () => {
    refuse(
      ligne('fertilisation', {}, detail('fertilisation', { quantite: { valeur: 50, unite: 'kg', prix: 3 } })),
      'cle_inconnue',
      'detail.quantite.prix',
    );
    refuse(ligne('traitement', {}, detail('traitement', { dose: { valeur: 2, unite: 'L/ha', x: 1 } })), 'cle_inconnue', 'detail.dose.x');
  });

  it('clé inconnue de 5 000 caractères (détail sous 8 Kio) : message de 200 caractères au plus', () => {
    refuse(ligne('recolte', {}, detail('recolte', { ['k'.repeat(5_000)]: 1 })), 'cle_inconnue');
  });
});

describe('détail : valeurs par type', () => {
  const NON_FINIS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each([
    // récolte
    ['recolte', { quantite: 0 }, 'champ_invalide', 'detail.quantite'],
    ['recolte', { quantite: -1 }, 'champ_invalide', 'detail.quantite'],
    ['recolte', { quantite: '12' }, 'champ_invalide', 'detail.quantite'],
    ['recolte', { quantite: undefined }, 'champ_manquant', 'detail.quantite'],
    ['recolte', { quantite: null }, 'champ_manquant', 'detail.quantite'],
    ['recolte', { unite: 'tonne' }, 'champ_invalide', 'detail.unite'],
    ['recolte', { unite: undefined }, 'champ_manquant', 'detail.unite'],
    ['recolte', { categorie: 3 }, 'champ_invalide', 'detail.categorie'],
    // réalisé
    ['realise', { etape: 'recolte' }, 'champ_invalide', 'detail.etape'],
    ['realise', { etape: undefined }, 'champ_manquant', 'detail.etape'],
    ['realise', { quantiteReelle: '10' }, 'champ_invalide', 'detail.quantiteReelle'],
    ['realise', { quantiteReelle: -1 }, 'champ_invalide', 'detail.quantiteReelle'],
    // intervention
    ['travail_sol', { categorie: 'labour' }, 'champ_invalide', 'detail.categorie'],
    ['travail_sol', { categorie: undefined }, 'champ_manquant', 'detail.categorie'],
    ['travail_sol', { type: undefined }, 'champ_manquant', 'detail.type'],
    ['travail_sol', { type: '   ' }, 'champ_manquant', 'detail.type'],
    ['travail_sol', { type: 4 }, 'champ_invalide', 'detail.type'],
    ['travail_sol', { outil: 3 }, 'champ_invalide', 'detail.outil'],
    ['couverture', { dureeOccupationJours: '60' }, 'champ_invalide', 'detail.dureeOccupationJours'],
    ['couverture', { dureeOccupationJours: -1 }, 'champ_invalide', 'detail.dureeOccupationJours'],
    ['fertilisation', { produit: undefined }, 'champ_manquant', 'detail.produit'],
    ['fertilisation', { produit: '' }, 'champ_manquant', 'detail.produit'],
    ['fertilisation', { quantite: undefined }, 'champ_manquant', 'detail.quantite'],
    ['fertilisation', { quantite: 50 }, 'champ_invalide', 'detail.quantite'],
    ['fertilisation', { quantite: { valeur: '50', unite: 'kg' } }, 'champ_invalide', 'detail.quantite.valeur'],
    ['fertilisation', { quantite: { valeur: -5, unite: 'kg' } }, 'champ_invalide', 'detail.quantite.valeur'],
    ['fertilisation', { quantite: { valeur: 50 } }, 'champ_manquant', 'detail.quantite.unite'],
    ['fertilisation', { quantite: { valeur: 50, unite: 3 } }, 'champ_invalide', 'detail.quantite.unite'],
    ['amendement', { produit: undefined }, 'champ_manquant', 'detail.produit'],
    ['amendement', { quantite: { unite: 'kg' } }, 'champ_manquant', 'detail.quantite.valeur'],
    // irrigation
    ['irrigation', { secteurIrrigationId: undefined }, 'champ_manquant', 'detail.secteurIrrigationId'],
    ['irrigation', { secteurIrrigationId: 'secteur-3' }, 'champ_invalide', 'detail.secteurIrrigationId'],
    ['irrigation', { dureeMinutes: -1 }, 'champ_invalide', 'detail.dureeMinutes'],
    ['irrigation', { dureeMinutes: '30' }, 'champ_invalide', 'detail.dureeMinutes'],
    ['irrigation', { dureeMinutes: undefined }, 'champ_manquant', 'detail.dureeMinutes'],
    // traitement
    ['traitement', { produitPhytoId: 'bouillie bordelaise' }, 'champ_invalide', 'detail.produitPhytoId'],
    ['traitement', { produitPhytoId: undefined }, 'champ_manquant', 'detail.produitPhytoId'],
    ['traitement', { dose: undefined }, 'champ_manquant', 'detail.dose'],
    ['traitement', { dose: 2 }, 'champ_invalide', 'detail.dose'],
    ['traitement', { dose: { valeur: -1, unite: 'L/ha' } }, 'champ_invalide', 'detail.dose.valeur'],
    ['traitement', { dose: { valeur: 2 } }, 'champ_manquant', 'detail.dose.unite'],
    ['traitement', { surfaceTraiteeM2: -1 }, 'champ_invalide', 'detail.surfaceTraiteeM2'],
    ['traitement', { surfaceTraiteeM2: undefined }, 'champ_manquant', 'detail.surfaceTraiteeM2'],
    ['traitement', { cible: 3 }, 'champ_invalide', 'detail.cible'],
    ['traitement', { cible: undefined }, 'champ_manquant', 'detail.cible'],
    ['traitement', { operateur: undefined }, 'champ_manquant', 'detail.operateur'],
    ['traitement', { recolteAutoriseeLe: '2026-02-30' }, 'champ_invalide', 'detail.recolteAutoriseeLe'],
    ['traitement', { recolteAutoriseeLe: undefined }, 'champ_manquant', 'detail.recolteAutoriseeLe'],
    // observation
    ['observation', { nature: 'insecte' }, 'champ_invalide', 'detail.nature'],
    ['observation', { nature: undefined }, 'champ_manquant', 'detail.nature'],
    ['observation', { gravite: 'enorme' }, 'champ_invalide', 'detail.gravite'],
  ] as const)('%s %j : %s (%s)', (exemple, changements, code, champ) => {
    refuse(ligne(exemple, {}, detail(exemple, changements)), code, champ);
  });

  it.each([
    ['recolte', { categorie: undefined }],
    ['realise', { quantiteReelle: 1_200 }],
    ['realise', { quantiteReelle: undefined }],
    ['travail_sol', { outil: undefined }],
    ['couverture', { dureeOccupationJours: null }],
    ['irrigation', { dureeMinutes: 0 }],
    ['traitement', { dose: { valeur: 0, unite: 'L/ha' }, surfaceTraiteeM2: 0 }],
    ['observation', { gravite: null }],
    ['observation', { gravite: undefined }],
    ['observation', { gravite: 'faible' }],
  ] as const)('%s %j : accepté', (exemple, changements) => {
    accepte(ligne(exemple, {}, detail(exemple, changements)));
  });

  it.each(NON_FINIS)('nombre non fini (%s) en valeur : champ_invalide', (n) => {
    refuse(ligne('recolte', { detail: detail('recolte', { quantite: n }) }), 'champ_invalide', 'detail.quantite');
    refuse(ligne('irrigation', { detail: detail('irrigation', { dureeMinutes: n }) }), 'champ_invalide', 'detail.dureeMinutes');
  });
});

// ── Plafonds métier provisoires ──────────────────────────────────────────────────────────────

describe('plafonds provisoires (à valider par Théophane, docs/questions.md)', () => {
  it('valeurs proposées — à changer ici seulement si Théophane en décide d’autres', () => {
    expect(m.PLAFONDS_PROVISOIRES).toEqual({
      recolteQuantite: 100_000,
      realiseQuantite: 10_000_000,
      interventionQuantite: 1_000_000,
      couvertureJours: 1_095,
      irrigationMinutes: 1_440,
      traitementDose: 100_000,
      traitementSurfaceM2: 100_000,
    });
  });

  /** [plafond, exemple, détail portant la valeur v, champ en cause] */
  const CAS: readonly (readonly [string, string, (v: number) => Detail, string])[] = [
    ['recolteQuantite', 'recolte', (v) => detail('recolte', { quantite: v }), 'detail.quantite'],
    ['recolteQuantite', 'recolte', (v) => detail('recolte', { quantite: v, unite: 'piece' }), 'detail.quantite'],
    ['realiseQuantite', 'realise', (v) => detail('realise', { quantiteReelle: v }), 'detail.quantiteReelle'],
    ['interventionQuantite', 'fertilisation', (v) => detail('fertilisation', { quantite: { valeur: v, unite: 'kg' } }), 'detail.quantite.valeur'],
    ['interventionQuantite', 'amendement', (v) => detail('amendement', { quantite: { valeur: v, unite: 'kg' } }), 'detail.quantite.valeur'],
    ['couvertureJours', 'couverture', (v) => detail('couverture', { dureeOccupationJours: v }), 'detail.dureeOccupationJours'],
    ['irrigationMinutes', 'irrigation', (v) => detail('irrigation', { dureeMinutes: v }), 'detail.dureeMinutes'],
    ['traitementDose', 'traitement', (v) => detail('traitement', { dose: { valeur: v, unite: 'L/ha' } }), 'detail.dose.valeur'],
    ['traitementSurfaceM2', 'traitement', (v) => detail('traitement', { surfaceTraiteeM2: v }), 'detail.surfaceTraiteeM2'],
  ];

  const plafond = (nom: string): number => {
    const v: unknown = (m.PLAFONDS_PROVISOIRES as unknown as Record<string, unknown>)[nom];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`plafond ${nom} absent ou invalide`);
    return v;
  };

  it.each(CAS)('%s (%s) : le plafond est accepté (borne comprise)', (nom, exemple, fabriquer) => {
    accepte(ligne(exemple, {}, fabriquer(plafond(nom))));
  });

  it.each(CAS)('%s (%s) : au-delà, plafond_depasse', (nom, exemple, fabriquer, champ) => {
    refuse(ligne(exemple, {}, fabriquer(plafond(nom) + 0.5)), 'plafond_depasse', champ);
  });

  it.each(CAS)('%s (%s) : 1e308 refusé (accepté par T10)', (_nom, exemple, fabriquer, champ) => {
    refuse(ligne(exemple, {}, fabriquer(1e308)), 'plafond_depasse', champ);
  });
});
