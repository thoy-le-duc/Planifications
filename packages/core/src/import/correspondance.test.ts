/**
 * Tests d'acceptation T14 — type de contenu proposé et correspondance des colonnes
 * (dictionnaire de synonymes, unités dans l'en-tête). Contrat : ./test/contrat.ts.
 *
 * Critère du ticket : au moins quatre fichiers du jeu correspondent ENTIÈREMENT sans correction.
 * Ici, six : parcellaire anglais, parcellaire à trois niveaux, séries en semaines, classeur
 * Excel à ligne de titre, cultures et itinéraires, assolement passé (et l'export T15).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, chargerXlsx, type Cellule, type CleChamp, type ColonneAssociee, type ModuleImport, type TypeContenu, type UniteColonne } from './test/contrat.ts';
import { lireFixture, type NomFixture } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

const col = (champ: CleChamp | null, unite: UniteColonne | null = null): ColonneAssociee => ({ champ, unite });
const IGNOREE = col(null);

async function entetesCsv(nom: NomFixture): Promise<readonly Cellule[]> {
  const lignes = m.lireCsv(await lireFixture(nom)).lignes;
  const i = m.detecterEntete(lignes);
  if (i === null) throw new Error(`pas d’en-tête dans ${nom}`);
  return lignes[i] ?? [];
}

async function entetesXlsx(): Promise<readonly Cellule[]> {
  const { lecteurXlsx } = await chargerXlsx();
  const r = await lecteurXlsx.lire(await lireFixture('series-titre.xlsx'));
  if (!r.ok) throw new Error(r.message);
  const lignes = r.feuilles[0]?.lignes ?? [];
  const i = m.detecterEntete(lignes);
  if (i === null) throw new Error('pas d’en-tête dans le classeur');
  return lignes[i] ?? [];
}

describe('CHAMPS_IMPORT : les champs de l’appli par type de contenu', () => {
  const ATTENDUS: Record<TypeContenu, { champs: CleChamp[]; obligatoires: CleChamp[] }> = {
    parcellaire: {
      champs: ['zone', 'sous_zone', 'emplacement', 'sorte', 'longueur_m', 'largeur_m', 'type_abri', 'surface_m2', 'nombre_places'],
      obligatoires: ['zone'],
    },
    cultures: {
      champs: ['espece', 'variete', 'famille', 'mode', 'duree_pepiniere_jours', 'duree_avant_recolte_jours', 'fenetre_recolte_jours', 'rangs_par_planche', 'ecartement_cm', 'poids_mille_graines_g'],
      obligatoires: ['espece'],
    },
    series: {
      champs: ['espece', 'variete', 'emplacement', 'date_semis', 'date_plantation', 'date_debut_recolte', 'date_fin_recolte', 'longueur_m', 'nombre_plants'],
      obligatoires: ['espece'],
    },
    assolement: { champs: ['annee', 'zone', 'emplacement', 'famille', 'espece'], obligatoires: ['annee'] },
  };

  it.each(Object.keys(ATTENDUS) as TypeContenu[])('%s : champs, obligatoires, libellés en français', (type) => {
    const defs = m.CHAMPS_IMPORT[type];
    expect([...defs.map((d) => d.cle)].sort()).toStrictEqual([...ATTENDUS[type].champs].sort());
    expect(defs.filter((d) => d.obligatoire).map((d) => d.cle)).toStrictEqual(ATTENDUS[type].obligatoires);
    for (const d of defs) expect(d.libelle.trim().length, d.cle).toBeGreaterThan(2);
  });
});

describe('proposerType : ce que contient le fichier, d’après les en-têtes', () => {
  it.each([
    ['parcellaire-anglais.csv', 'parcellaire'],
    ['parcellaire-3-niveaux-cp1252.csv', 'parcellaire'],
    ['t15-emplacement.csv', 'parcellaire'],
    ['series-semaines.tsv', 'series'],
    ['series-anglais.csv', 'series'],
    ['cultures-itineraires.csv', 'cultures'],
    ['assolement-passe.csv', 'assolement'],
  ] as const)('%s → %s', async (nom, type) => {
    expect(m.proposerType(await entetesCsv(nom))).toBe(type);
  });

  it('classeur Excel à ligne de titre → séries', async () => {
    expect(m.proposerType(await entetesXlsx())).toBe('series');
  });

  it('rien de décisif (culture et planche, sans date ni année) → null : l’utilisateur choisit', async () => {
    expect(m.proposerType(await entetesCsv('modele-a.csv'))).toBeNull();
  });

  it('en-têtes inconnus ou vides → null', () => {
    expect(m.proposerType(['Truc', 'Machin'])).toBeNull();
    expect(m.proposerType([])).toBeNull();
  });

  it('une seule colonne de zones → parcellaire à un niveau', () => {
    expect(m.proposerType(['Parcelle', 'Surface (m²)', 'Abri'])).toBe('parcellaire');
  });
});

describe('proposerCorrespondance : synonymes insensibles à la casse, aux accents et à la ponctuation', () => {
  it.each([
    ['Planche', 'emplacement', null],
    ['PLANCHE', 'emplacement', null],
    ['  planche ', 'emplacement', null],
    ['N° planche', 'emplacement', null],
    ['N°planche', 'emplacement', null],
    ['No. planche', 'emplacement', null],
    ['Numéro de planche', 'emplacement', null],
    ['Bed', 'emplacement', null],
    ['Longueur', 'longueur_m', null],
    ['Longueur (m)', 'longueur_m', 'm'],
    ['Longueur (cm)', 'longueur_m', 'cm'],
    ['LONGUEUR [M]', 'longueur_m', 'm'],
    ['Longueur en cm', 'longueur_m', 'cm'],
    ['longueur_m', 'longueur_m', 'm'],
    ['Long.', 'longueur_m', null],
    ['Long. (m)', 'longueur_m', 'm'],
    ['Length (m)', 'longueur_m', 'm'],
    ['Larg. (cm)', 'largeur_m', 'cm'],
    ['Îlot', 'zone', null],
    ['ilot', 'zone', null],
    ['Chapelle', 'sous_zone', null],
    ['Sous-zone', 'sous_zone', null],
    ['Type d’abri', 'type_abri', null],
    ["Type d'abri", 'type_abri', null],
    ['Gouttière', 'emplacement', null],
  ] as const)('« %s » → %s (unité %s)', (entete, champ, unite) => {
    expect(m.proposerCorrespondance([entete], 'parcellaire').colonnes).toStrictEqual([col(champ, unite)]);
  });

  it.each([
    ['Culture', 'espece'],
    ['Espèce', 'espece'],
    ['ESPECE', 'espece'],
    ['Légume', 'espece'],
    ['Variété', 'variete'],
    ['Famille botanique', 'famille'],
    ['Écartement (cm)', 'ecartement_cm'],
    ['PMG (g)', 'poids_mille_graines_g'],
    ['Poids de mille graines (g)', 'poids_mille_graines_g'],
    ['Rangs/planche', 'rangs_par_planche'],
    ['Durée pépinière (j)', 'duree_pepiniere_jours'],
    ['Jours avant récolte', 'duree_avant_recolte_jours'],
  ] as const)('cultures : « %s » → %s', (entete, champ) => {
    expect(m.proposerCorrespondance([entete], 'cultures').colonnes[0]?.champ).toBe(champ);
  });

  it('unités : cm et g lues dans l’en-tête des mesures ; pas d’unité pour une durée en jours', () => {
    expect(m.proposerCorrespondance(['Écartement (m)', 'PMG (kg)', 'Durée pépinière (j)'], 'cultures').colonnes).toStrictEqual([
      col('ecartement_cm', 'm'),
      col('poids_mille_graines_g', 'kg'),
      col('duree_pepiniere_jours', null),
    ]);
  });

  // Relecture, point 4 : ce test attendait col('longueur_m', null) (unité fausse oubliée, colonne
  // gardée). Une unité explicite qui ne va pas au champ dit que la colonne n'est pas ce champ :
  // elle n'est plus proposée, l'utilisateur l'associe lui-même s'il le veut.
  it('unité d’une autre grandeur que le champ → colonne non proposée', () => {
    expect(m.proposerCorrespondance(['Longueur (kg)'], 'parcellaire').colonnes).toStrictEqual([IGNOREE]);
  });

  it('seuls les champs du type choisi : « Culture » est ignorée dans un parcellaire', () => {
    expect(m.proposerCorrespondance(['Planche', 'Culture'], 'parcellaire').colonnes).toStrictEqual([col('emplacement'), IGNOREE]);
  });

  it('un champ n’est pris qu’une fois (la première colonne) ; colonne vide ou inconnue ignorée', () => {
    expect(m.proposerCorrespondance(['Planche', 'Bed', '', null, 'Remarques'], 'parcellaire').colonnes).toStrictEqual([col('emplacement'), IGNOREE, IGNOREE, IGNOREE, IGNOREE]);
  });

  it('« Mètres », « Lieu-dit » et « Semaine de plantation » ne sont pas reconnus (modèle d’import)', () => {
    expect(m.proposerCorrespondance(['Mètres', 'Lieu-dit', 'Semaine de plantation'], 'series').colonnes).toStrictEqual([IGNOREE, IGNOREE, IGNOREE]);
  });
});

describe('unités explicites dans l’en-tête (relecture, point 4)', () => {
  it.each([
    ['Surface (ha)', 'parcellaire', col('surface_m2', 'ha')],
    ['Surface (m²)', 'parcellaire', col('surface_m2')],
    ['Surface (m2)', 'parcellaire', col('surface_m2')],
    ['Superficie en ha', 'parcellaire', col('surface_m2', 'ha')],
    ['Surface (kg)', 'parcellaire', IGNOREE],
    ['Longueur (pouces)', 'parcellaire', IGNOREE],
    ['Largeur (ha)', 'parcellaire', IGNOREE],
    ['Durée pépinière (semaines)', 'cultures', col('duree_pepiniere_jours', 'semaine')],
    ['Durée pépinière (sem.)', 'cultures', col('duree_pepiniere_jours', 'semaine')],
    ['Fenêtre de récolte (semaines)', 'cultures', col('fenetre_recolte_jours', 'semaine')],
    ['Jours avant récolte (jours)', 'cultures', col('duree_avant_recolte_jours')],
    ['Durée pépinière (mois)', 'cultures', IGNOREE],
    ['Écartement (pouces)', 'cultures', IGNOREE],
    ['PMG (€)', 'cultures', IGNOREE],
    ['Rangs (m)', 'cultures', IGNOREE],
    ['Récolte (kg)', 'series', IGNOREE],
    ['Récolte (€)', 'series', IGNOREE],
    ['Semis (graines)', 'series', IGNOREE],
    ['Plantation (nb)', 'series', IGNOREE],
    ['Plants/m²', 'series', IGNOREE],
    ['Plants par m²', 'series', IGNOREE],
    ['Nombre de plants (nb)', 'series', col('nombre_plants')],
    ['Date de semis (JJ/MM/AAAA)', 'series', col('date_semis')],
    ['Culture (nom)', 'series', col('espece')],
    ['Année (%)', 'assolement', IGNOREE],
  ] as [string, TypeContenu, ColonneAssociee][])('« %s » (%s)', (entete, type, attendu) => {
    expect(m.proposerCorrespondance([entete], type).colonnes).toStrictEqual([attendu]);
  });

  it('une colonne non proposée ne compte pas pour le type : « Récolte (kg) » n’est pas une date', () => {
    expect(m.proposerType(['Culture', 'Planche', 'Récolte (kg)'])).toBeNull();
    expect(m.proposerType(['Culture', 'Planche', 'Récolte'])).toBe('series');
  });
});

describe('en-têtes anglais des dates', () => {
  it.each([
    ['Sowing date', 'date_semis'],
    ['Sowing', 'date_semis'],
    ['Planting date', 'date_plantation'],
    ['Planting', 'date_plantation'],
    ['Harvest start', 'date_debut_recolte'],
    ['Harvest end', 'date_fin_recolte'],
  ] as const)('« %s » → %s', (entete, champ) => {
    expect(m.proposerCorrespondance([entete], 'series').colonnes).toStrictEqual([col(champ)]);
  });
});

describe('en-têtes de plus de 200 caractères (relecture, point 3)', () => {
  it('200 caractères : reconnu ; 201 : jamais reconnu, même s’il se réduit à un synonyme', () => {
    expect(m.proposerCorrespondance([`Planche${'.'.repeat(193)}`], 'parcellaire').colonnes).toStrictEqual([col('emplacement')]);
    expect(m.proposerCorrespondance([`Planche${'.'.repeat(194)}`], 'parcellaire').colonnes).toStrictEqual([IGNOREE]);
    expect(m.proposerType([`Zone${'.'.repeat(197)}`])).toBeNull();
  });

  it('detecterEntete ne compte pas un en-tête trop long', () => {
    expect(m.detecterEntete([[`Zone${'.'.repeat(197)}`, `Planche${'.'.repeat(194)}`], ['Parcelle', 'Truc']])).toBe(1);
  });
});

describe('fichiers du jeu de test qui correspondent entièrement, sans correction', () => {
  const CAS: [NomFixture, TypeContenu, ColonneAssociee[]][] = [
    ['parcellaire-anglais.csv', 'parcellaire', [col('zone'), col('emplacement'), col('longueur_m', 'm'), col('largeur_m', 'm'), col('type_abri')]],
    [
      'parcellaire-3-niveaux-cp1252.csv',
      'parcellaire',
      [col('zone'), col('sous_zone'), col('emplacement'), col('longueur_m', 'm'), col('largeur_m', 'cm'), col('type_abri')],
    ],
    [
      'series-semaines.tsv',
      'series',
      [col('espece'), col('variete'), col('emplacement'), col('date_semis'), col('date_plantation'), col('date_debut_recolte'), col('longueur_m', 'm')],
    ],
    [
      'cultures-itineraires.csv',
      'cultures',
      [
        col('espece'),
        col('famille'),
        col('mode'),
        col('duree_pepiniere_jours'),
        col('duree_avant_recolte_jours'),
        col('fenetre_recolte_jours'),
        col('rangs_par_planche'),
        col('ecartement_cm', 'cm'),
        col('poids_mille_graines_g', 'g'),
      ],
    ],
    ['assolement-passe.csv', 'assolement', [IGNOREE, col('annee'), col('famille'), col('emplacement'), col('espece'), IGNOREE, IGNOREE]],
    [
      'series-anglais.csv',
      'series',
      [col('espece'), col('variete'), col('emplacement'), col('date_semis'), col('date_plantation'), col('date_debut_recolte'), col('date_fin_recolte')],
    ],
    [
      't15-emplacement.csv',
      'parcellaire',
      [
        IGNOREE, // id
        IGNOREE, // ferme_id
        col('zone'), // zone_id
        col('emplacement'), // code
        col('sorte'),
        col('longueur_m', 'm'),
        col('largeur_m', 'm'),
        col('nombre_places'),
        IGNOREE, // actif_du
        IGNOREE, // actif_au
        IGNOREE, // remplace
        IGNOREE, // cree_le
        IGNOREE, // modifie_le
        IGNOREE, // supprime_le
      ],
    ],
  ];

  it.each(CAS)('%s (%s)', async (nom, type, colonnes) => {
    expect(m.proposerCorrespondance(await entetesCsv(nom), type)).toStrictEqual({ type, colonnes });
  });

  it('series-titre.xlsx : ligne de titre sautée, longueur sans unité', async () => {
    expect(m.proposerCorrespondance(await entetesXlsx(), 'series')).toStrictEqual({
      type: 'series',
      colonnes: [
        col('espece'),
        col('variete'),
        col('emplacement'),
        col('date_semis'),
        col('date_plantation'),
        col('date_debut_recolte'),
        col('date_fin_recolte'),
        col('longueur_m'),
      ],
    });
  });

  it('modele-a.csv demande une correction : trois colonnes inconnues', async () => {
    expect(m.proposerCorrespondance(await entetesCsv('modele-a.csv'), 'series').colonnes).toStrictEqual([IGNOREE, col('emplacement'), col('espece'), IGNOREE, IGNOREE]);
  });

  it('export T15 des séries : colonnes prévues reconnues, colonnes techniques ignorées', () => {
    const entetes = [
      'id',
      'ferme_id',
      'saison_id',
      'espece_id',
      'variete_id',
      'itineraire_id',
      'parametres',
      'ancre_type',
      'ancre_date',
      'prevu_semis_pepiniere',
      'prevu_mise_en_place',
      'prevu_debut_recolte',
      'prevu_fin_recolte',
      'longueur_m',
      'nombre_plants',
      'statut',
      'cree_le',
      'modifie_le',
      'supprime_le',
    ];
    expect(m.proposerType(entetes)).toBe('series');
    expect(m.proposerCorrespondance(entetes, 'series').colonnes).toStrictEqual([
      IGNOREE,
      IGNOREE,
      IGNOREE,
      col('espece'),
      col('variete'),
      IGNOREE,
      IGNOREE,
      IGNOREE,
      IGNOREE,
      col('date_semis'),
      col('date_plantation'),
      col('date_debut_recolte'),
      col('date_fin_recolte'),
      col('longueur_m', 'm'),
      col('nombre_plants'),
      IGNOREE,
      IGNOREE,
      IGNOREE,
      IGNOREE,
    ]);
  });
});
