/**
 * Tests d'acceptation T23, côté cœur — règles d'un itinéraire et d'un type d'intervention écrits
 * par un téléphone (docs/backlog/T23-itineraires-synchro.md). Aucune base, aucun réseau.
 *
 * Contrat (entrées, sorties, codes) : ./test/contrat-itineraire.ts. Les tests côté serveur
 * (Postgres) sont dans apps/api/src/sync/itineraire.integration.test.ts.
 *
 * Exemple : la batavia de T02 (plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j),
 * avec deux travaux de T22 : grelinette 10 jours avant la mise en place (liste de départ) et un
 * « binage » propre à la ferme, tous les 14 jours de la mise en place au début de récolte.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerItineraires, listeDeDepart, type ModuleItineraires, type ResultatLigne } from './test/contrat-itineraire.ts';

let m: ModuleItineraires;

beforeAll(async () => {
  m = await chargerItineraires();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const ITINERAIRE = uuid(1);
const FERME = uuid(2);
const ESPECE = uuid(3);
const VARIETE = uuid(4);
const TYPE = uuid(5);

const GRELINETTE = { categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 };
const BINAGE = {
  categorie: 'entretien',
  type: 'binage',
  repere: 'mise_en_place',
  decalageJours: 0,
  repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
  outil: 'houe maraîchère',
  produit: null,
  tempsEstime: { minutes: 20, par: 'cent_metres' },
};

/** Paramètres complets de la batavia de T02 (T01, plant maison). */
const BATAVIA = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

/** Types permis de la ferme : la grelinette de la liste de départ et le binage de la ferme. */
const TYPES = [
  { categorie: 'travail_sol', type: 'grelinette' },
  { categorie: 'entretien', type: 'binage' },
];

function itineraire(autres: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITINERAIRE,
    ferme_id: FERME,
    espece_id: ESPECE,
    variete_id: VARIETE,
    nom: 'Batavia de printemps',
    mode: 'plant_maison',
    parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: [GRELINETTE, BINAGE] }),
    supprime_le: null,
    ...autres,
  };
}

function typeIntervention(autres: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: TYPE, ferme_id: FERME, categorie: 'entretien', libelle: 'binage', masque: 0, supprime_le: null, ...autres };
}

/** Copie de `o` sans la clé `cle`. */
const sans = (o: Readonly<Record<string, unknown>>, cle: string): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== cle));

const code = <T>(r: ResultatLigne<T>): string | null => (r.ok ? null : r.erreur.code);
const champ = <T>(r: ResultatLigne<T>): string | null => (r.ok ? null : r.erreur.champ);

// ── validerItineraire ───────────────────────────────────────────────────────────────────────

describe('validerItineraire : un itinéraire valide', () => {
  it('batavia de T02 avec deux travaux (type de la liste de départ et type de la ferme) : acceptée', () => {
    const r = m.validerItineraire(itineraire(), { typesIntervention: TYPES });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.valeur).toMatchObject({ id: ITINERAIRE, fermeId: FERME, especeId: ESPECE, varieteId: VARIETE, nom: 'Batavia de printemps', mode: 'plant_maison' });
    expect(r.valeur.parametres.dureeAvantRecolteJours).toBe(49);
  });

  it('les travaux prévus sont rendus normalisés par T22 (clés facultatives à null)', () => {
    const r = m.validerItineraire(itineraire(), { typesIntervention: TYPES });
    if (!r.ok) throw new Error(JSON.stringify(r.erreur));
    expect(r.valeur.parametres.travauxPrevus).toStrictEqual([
      { ...GRELINETTE, repetition: null, outil: null, produit: null, tempsEstime: null },
      BINAGE,
    ]);
  });

  it('parametres déjà en objet (pas en texte JSON) : accepté aussi', () => {
    expect(code(m.validerItineraire(itineraire({ parametres: { ...BATAVIA, travauxPrevus: [GRELINETTE] } }), { typesIntervention: TYPES }))).toBeNull();
  });

  it('sans travaux prévus (clé absente, itinéraire d’avant T22) : accepté', () => {
    expect(code(m.validerItineraire(itineraire({ parametres: JSON.stringify(BATAVIA) }), { typesIntervention: TYPES }))).toBeNull();
  });

  it('sans variété (variete_id nul) : accepté', () => {
    expect(code(m.validerItineraire(itineraire({ variete_id: null }), { typesIntervention: TYPES }))).toBeNull();
  });

  it('cree_le et modifie_le tolérées ; supprime_le en instant ISO : accepté (suppression douce)', () => {
    const r = m.validerItineraire(
      itineraire({ cree_le: '2026-09-30T08:00:00.000Z', modifie_le: '2026-09-30T08:00:00.000Z', supprime_le: '2026-10-01T06:30:00.000Z' }),
      { typesIntervention: TYPES },
    );
    expect(code(r)).toBeNull();
  });

  it('sans options : aucun contrôle de la liste des types (comme validerTravauxPrevus)', () => {
    const autre = { ...GRELINETTE, type: 'type inconnu de la ferme' };
    expect(code(m.validerItineraire(itineraire({ parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: [autre] }) })))).toBeNull();
  });
});

describe('validerItineraire : refus', () => {
  it('type d’intervention absent de la liste de la ferme : refusé, champ parametres.travauxPrevus.1.type', () => {
    const r = m.validerItineraire(itineraire(), { typesIntervention: [TYPES[0] ?? { categorie: '', type: '' }] });
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('parametres.travauxPrevus.1.type');
  });

  it('bon libellé, mauvaise catégorie : refusé (le couple catégorie + libellé fait foi)', () => {
    const r = m.validerItineraire(itineraire(), { typesIntervention: [TYPES[0] ?? { categorie: '', type: '' }, { categorie: 'travail_sol', type: 'binage' }] });
    expect(champ(r)).toBe('parametres.travauxPrevus.1.type');
  });

  it('travail invalide selon T22 (décalage en texte) : refusé, champ préfixé', () => {
    const faux = { ...GRELINETTE, decalageJours: '-10' };
    const r = m.validerItineraire(itineraire({ parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: [faux] }) }), { typesIntervention: TYPES });
    expect(champ(r)).toBe('parametres.travauxPrevus.0.decalageJours');
  });

  it('repère « semis en pépinière » dans un itinéraire en semis direct : refusé (T22, repère du mode)', () => {
    const radis = { mode: 'semis_direct', dureeAvantRecolteJours: 28, fenetreRecolteJours: 7, periodeUsage: null, typeAbri: null };
    const travail = { ...GRELINETTE, repere: 'semis_pepiniere' };
    const r = m.validerItineraire(itineraire({ mode: 'semis_direct', parametres: JSON.stringify({ ...radis, travauxPrevus: [travail] }) }), {
      typesIntervention: TYPES,
    });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('parametres.travauxPrevus.0.repere');
  });

  it('travauxPrevus qui n’est pas une liste : refusé', () => {
    const r = m.validerItineraire(itineraire({ parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: { 0: GRELINETTE } }) }), { typesIntervention: TYPES });
    expect(r.ok).toBe(false);
    expect(champ(r)).toMatch(/^parametres\.travauxPrevus/);
  });

  it('colonne mode différente de parametres.mode : incoherent', () => {
    const r = m.validerItineraire(itineraire({ mode: 'plant_achete' }), { typesIntervention: TYPES });
    expect(code(r)).toBe('incoherent');
    expect(['mode', 'parametres.mode']).toContain(champ(r));
  });

  it('mode inconnu : refusé', () => {
    expect(m.validerItineraire(itineraire({ mode: 'hydroponie' }), { typesIntervention: TYPES }).ok).toBe(false);
  });

  it('durée en pépinière manquante en plant maison : refusée (mêmes règles que l’instantané d’une série)', () => {
    const sansPepiniere = sans(BATAVIA, 'dureePepiniereJours');
    const r = m.validerItineraire(itineraire({ parametres: JSON.stringify(sansPepiniere) }), { typesIntervention: TYPES });
    expect(champ(r)).toBe('parametres.dureePepiniereJours');
  });

  it('parametres de plus de PARAMETRES_SERIE_OCTETS octets : trop_volumineux (la série copiée serait refusée)', () => {
    const lourd = { ...BATAVIA, note: 'x'.repeat(m.PARAMETRES_SERIE_OCTETS) };
    expect(code(m.validerItineraire(itineraire({ parametres: JSON.stringify(lourd) }), { typesIntervention: TYPES }))).toBe('trop_volumineux');
  });

  it('parametres illisibles : json_illisible', () => {
    expect(code(m.validerItineraire(itineraire({ parametres: '{pas du json' }), { typesIntervention: TYPES }))).toBe('json_illisible');
  });

  it.each([
    ['ferme_id nul (écriture dans la bibliothèque commune)', { ferme_id: null }, 'ferme_id'],
    ['ferme_id qui n’est pas un UUID', { ferme_id: 'ferme-1' }, 'ferme_id'],
    ['espece_id manquant', { espece_id: null }, 'espece_id'],
    ['variete_id qui n’est pas un UUID', { variete_id: 'batavia' }, 'variete_id'],
    ['nom vide', { nom: '   ' }, 'nom'],
    ['nom démesuré', { nom: 'x'.repeat(10_000) }, 'nom'],
    ['nom avec un caractère de contrôle', { nom: 'Batavia\u0000' }, 'nom'],
    ['supprime_le qui n’est pas un instant', { supprime_le: 'hier' }, 'supprime_le'],
  ])('%s : refusé, champ %s', (_cas, autres, attendu) => {
    const r = m.validerItineraire(itineraire(autres), { typesIntervention: TYPES });
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(attendu);
  });

  it('nom de 60 caractères : accepté', () => {
    expect(code(m.validerItineraire(itineraire({ nom: 'B'.repeat(60) }), { typesIntervention: TYPES }))).toBeNull();
  });

  describe('décision 6 du chef : nom de 1 à 80 caractères, espaces de bord retirés', () => {
    it('80 caractères : accepté', () => {
      expect(code(m.validerItineraire(itineraire({ nom: 'B'.repeat(80) }), { typesIntervention: TYPES }))).toBeNull();
    });

    it('80 caractères entourés d’espaces : accepté', () => {
      expect(code(m.validerItineraire(itineraire({ nom: `  ${'B'.repeat(80)}  ` }), { typesIntervention: TYPES }))).toBeNull();
    });

    it('1 caractère : accepté', () => {
      expect(code(m.validerItineraire(itineraire({ nom: 'B' }), { typesIntervention: TYPES }))).toBeNull();
    });

    it.each([
      ['81 caractères', 'B'.repeat(81)],
      ['vide', ''],
      ['que des espaces', '   '],
    ])('nom de %s : refusé, champ nom', (_cas, nom) => {
      const r = m.validerItineraire(itineraire({ nom }), { typesIntervention: TYPES });
      expect(r.ok).toBe(false);
      expect(champ(r)).toBe('nom');
    });
  });

  it('colonne inconnue : colonne_inconnue', () => {
    expect(code(m.validerItineraire(itineraire({ saison_id: FERME }), { typesIntervention: TYPES }))).toBe('colonne_inconnue');
  });

  it.each([null, 'ligne', 42, [itineraire()]])('entrée %j : entree_invalide, sans lever', (entree) => {
    expect(code(m.validerItineraire(entree, { typesIntervention: TYPES }))).toBe('entree_invalide');
  });

  it('accesseur qui lève : refusé sans lever', () => {
    const piege = Object.defineProperty(itineraire(), 'nom', {
      enumerable: true,
      get() {
        throw new Error('piège');
      },
    });
    expect(() => m.validerItineraire(piege, { typesIntervention: TYPES })).not.toThrow();
    expect(m.validerItineraire(piege, { typesIntervention: TYPES }).ok).toBe(false);
  });
});

// ── validerTypeIntervention ─────────────────────────────────────────────────────────────────

describe('validerTypeIntervention', () => {
  it('« binage » en entretien, masque 0 (entier SQLite) : accepté, masque rendu en booléen', () => {
    expect(m.validerTypeIntervention(typeIntervention())).toStrictEqual({
      ok: true,
      valeur: expect.objectContaining({ id: TYPE, fermeId: FERME, categorie: 'entretien', libelle: 'binage', masque: false }) as unknown,
    });
  });

  it.each([
    [1, true],
    [true, true],
    [false, false],
    [null, false],
  ])('masque %j → %j', (masque, attendu) => {
    const r = m.validerTypeIntervention(typeIntervention({ masque }));
    expect(r.ok && r.valeur.masque).toBe(attendu);
  });

  it('masque absent : false', () => {
    const r = m.validerTypeIntervention(sans(typeIntervention(), 'masque'));
    expect(r.ok && r.valeur.masque).toBe(false);
  });

  it.each(['travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'])('catégorie %s : acceptée', (categorie) => {
    expect(code(m.validerTypeIntervention(typeIntervention({ categorie })))).toBeNull();
  });

  it('libellé de PLAFONDS_TRAVAUX.texte caractères : accepté ; un de plus : trop_long', () => {
    const n = m.PLAFONDS_TRAVAUX.texte;
    expect(code(m.validerTypeIntervention(typeIntervention({ libelle: 'b'.repeat(n) })))).toBeNull();
    const r = m.validerTypeIntervention(typeIntervention({ libelle: 'b'.repeat(n + 1) }));
    expect(code(r)).toBe('trop_long');
    expect(champ(r)).toBe('libelle');
  });

  it.each([
    ['catégorie inconnue', { categorie: 'recolte' }, 'categorie'],
    ['catégorie manquante', { categorie: null }, 'categorie'],
    ['libellé vide', { libelle: '  ' }, 'libelle'],
    ['libellé manquant', { libelle: null }, 'libelle'],
    ['libellé avec un caractère de contrôle', { libelle: 'bin\u0007age' }, 'libelle'],
    ['masque en texte', { masque: 'oui' }, 'masque'],
    ['masque 2', { masque: 2 }, 'masque'],
    ['ferme_id nul (liste de départ, lecture seule)', { ferme_id: null }, 'ferme_id'],
    ['id qui n’est pas un UUID', { id: 'binage' }, 'id'],
    ['supprime_le qui n’est pas un instant', { supprime_le: 'hier' }, 'supprime_le'],
  ])('%s : refusé, champ %s', (_cas, autres, attendu) => {
    const r = m.validerTypeIntervention(typeIntervention(autres));
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(attendu);
  });

  it('colonne inconnue : colonne_inconnue', () => {
    expect(code(m.validerTypeIntervention(typeIntervention({ couleur: 'vert' })))).toBe('colonne_inconnue');
  });

  it.each([null, 'binage', 7])('entrée %j : entree_invalide, sans lever', (entree) => {
    expect(code(m.validerTypeIntervention(entree))).toBe('entree_invalide');
  });
});

// ── Liste de départ ─────────────────────────────────────────────────────────────────────────

describe('liste de départ (modèle de données, section 5)', () => {
  it('chaque type de départ est un type d’intervention valide (catégorie connue, libellé dans le plafond)', () => {
    const liste = listeDeDepart(m);
    expect(liste.length).toBeGreaterThanOrEqual(20);
    for (const [i, t] of liste.entries()) {
      const r = m.validerTypeIntervention({ id: uuid(100 + i), ferme_id: FERME, categorie: t.categorie, libelle: t.libelle, masque: 0, supprime_le: null });
      expect(r.ok, `${t.categorie} / ${t.libelle}`).toBe(true);
    }
  });

  it('un itinéraire qui n’utilise que la liste de départ passe avec elle pour seule liste', () => {
    const types = listeDeDepart(m).map((t) => ({ categorie: t.categorie, type: t.libelle }));
    const compost = {
      categorie: 'amendement',
      type: 'compost',
      repere: 'mise_en_place',
      decalageJours: -21,
      produit: { nom: 'compost de déchets verts', quantite: { valeur: 3, unite: 'kg/m²' } },
    };
    const r = m.validerItineraire(itineraire({ parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: [GRELINETTE, compost] }) }), { typesIntervention: types });
    expect(code(r)).toBeNull();
  });
});
