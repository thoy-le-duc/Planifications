/**
 * Tests d'acceptation T14 — modèle d'import : la correspondance validée (colonnes et valeurs) se
 * sérialise, et le fichier suivant de même forme se prépare sans rien reprendre.
 * Contrat : ./test/contrat.ts. Fichiers : modele-a.csv et modele-b.csv (mêmes en-têtes, autre ordre).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type Cellule, type ChoixValeur, type CleChamp, type ColonneAssociee, type Correspondance, type ModeleImport, type ModuleImport, type TypeContenu, type UniteColonne } from './test/contrat.ts';
import { BIBLIOTHEQUE, lireFixture } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

const existante = (id: string) => ({ sorte: 'existante', id }) as const;

/** Premier fichier : l'utilisateur corrige deux colonnes et décide d'une valeur. */
async function preparerPremier(): Promise<{ entetes: readonly Cellule[]; correspondance: Correspondance; choix: ChoixValeur[] }> {
  const lignes = m.lireCsv(await lireFixture('modele-a.csv')).lignes;
  const entetes = lignes[0] ?? [];
  const proposee = m.proposerCorrespondance(entetes, 'series');
  // Proposé : Lieu-dit ignoré, Planche, Culture, puis deux colonnes inconnues.
  expect(proposee.colonnes.map((c) => c.champ)).toStrictEqual([null, 'emplacement', 'espece', null, null]);
  const correspondance: Correspondance = {
    type: 'series',
    colonnes: [proposee.colonnes[0] ?? { champ: null, unite: null }, { champ: 'emplacement', unite: null }, { champ: 'espece', unite: null }, { champ: 'date_plantation', unite: null }, { champ: 'longueur_m', unite: 'm' }],
  };
  const plan = m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027 });
  // « Salade du jardin » n'est pas exacte : décision demandée, laitue proposée.
  expect(plan.decisions.map((d) => d.valeur)).toStrictEqual(['Salade du jardin']);
  expect(plan.decisions[0]?.propositions[0]?.id).toBe('esp-laitue');
  const choix: ChoixValeur[] = [{ champ: 'espece', valeur: 'Salade du jardin', decision: existante('esp-laitue') }];
  const valide = m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027, choix });
  expect(valide.resume).toStrictEqual({ valides: 2, erreurs: 0, aDecider: 0, doublons: 0, ignorees: 0 });
  return { entetes, correspondance, choix };
}

describe('modèle d’import', () => {
  let modele: ModeleImport;

  beforeAll(async () => {
    const { entetes, correspondance, choix } = await preparerPremier();
    const r = m.creerModele(entetes, correspondance, choix);
    if (!r.ok) throw new Error(`modèle refusé : ${r.message}`);
    modele = r.modele;
  });

  it('retient le type, chaque en-tête avec son champ et son unité, et les choix de valeurs', () => {
    expect(modele).toStrictEqual({
      version: 1,
      type: 'series',
      colonnes: [
        { entete: 'Lieu-dit', champ: null, unite: null },
        { entete: 'Planche', champ: 'emplacement', unite: null },
        { entete: 'Culture', champ: 'espece', unite: null },
        { entete: 'Semaine de plantation', champ: 'date_plantation', unite: null },
        { entete: 'Mètres', champ: 'longueur_m', unite: 'm' },
      ],
      choix: [{ champ: 'espece', valeur: 'Salade du jardin', decision: existante('esp-laitue') }],
    });
  });

  it('se sérialise en JSON et se relit à l’identique', () => {
    const texte = m.serialiserModele(modele);
    expect(() => JSON.parse(texte) as unknown).not.toThrow();
    expect(m.lireModele(texte)).toStrictEqual(modele);
  });

  it('le second fichier de même forme (colonnes dans un autre ordre) se prépare sans rien reprendre', async () => {
    const relu = m.lireModele(m.serialiserModele(modele));
    if (relu === null) throw new Error('modèle illisible');
    const lignes = m.lireCsv(await lireFixture('modele-b.csv')).lignes;
    const correspondance = m.appliquerModele(relu, lignes[0] ?? []);
    expect(correspondance).toStrictEqual({
      type: 'series',
      colonnes: [
        { champ: 'emplacement', unite: null },
        { champ: null, unite: null },
        { champ: 'espece', unite: null },
        { champ: 'longueur_m', unite: 'm' },
        { champ: 'date_plantation', unite: null },
      ],
    });
    if (correspondance === null) return;
    const plan = m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027, choix: relu.choix });
    expect(plan.decisions).toStrictEqual([]);
    expect(plan.lignes).toStrictEqual([
      { ligne: 2, statut: 'valide', valeurs: { emplacement: 'GP3', espece: existante('esp-laitue'), longueur_m: 35, date_plantation: '2027-04-26' }, erreurs: [], doublonDe: null },
      { ligne: 3, statut: 'valide', valeurs: { emplacement: 'GP4', espece: existante('esp-poireau'), longueur_m: 40, date_plantation: '2027-05-31' }, erreurs: [], doublonDe: null },
      { ligne: 4, statut: 'valide', valeurs: { emplacement: 'GP5', espece: existante('esp-laitue'), longueur_m: 20, date_plantation: '2027-07-26' }, erreurs: [], doublonDe: null },
    ]);
  });

  it('même forme malgré la casse, les accents et la ponctuation des en-têtes', () => {
    expect(m.appliquerModele(modele, ['PLANCHE', 'lieu dit', 'culture', 'metres', 'Semaine de plantation'])).not.toBeNull();
  });

  it('autre forme (colonne en plus, en moins ou différente) → null', () => {
    expect(m.appliquerModele(modele, ['Planche', 'Lieu-dit', 'Culture', 'Mètres', 'Semaine de plantation', 'Note'])).toBeNull();
    expect(m.appliquerModele(modele, ['Planche', 'Lieu-dit', 'Culture', 'Mètres'])).toBeNull();
    expect(m.appliquerModele(modele, ['Field', 'Bed', 'Length (m)', 'Width (m)', 'Cover'])).toBeNull();
  });
});

describe('lireModele : jamais d’exception, null si le texte n’est pas un modèle valide', () => {
  const valide = JSON.stringify({
    version: 1,
    type: 'parcellaire',
    colonnes: [{ entete: 'Zone', champ: 'zone', unite: null }],
    choix: [],
  });

  it('un modèle valide écrit à la main se relit', () => {
    expect(m.lireModele(valide)).toStrictEqual({ version: 1, type: 'parcellaire', colonnes: [{ entete: 'Zone', champ: 'zone', unite: null }], choix: [] });
  });

  it.each([
    ['pas du JSON', 'pas du json'],
    ['vide', ''],
    ['null', 'null'],
    ['tableau', '[]'],
    ['objet vide', '{}'],
    ['version inconnue', valide.replace('"version":1', '"version":2')],
    ['type inconnu', valide.replace('parcellaire', 'recettes')],
    ['champ inconnu', valide.replace('"champ":"zone"', '"champ":"prix"')],
    ['champ d’un autre type', valide.replace('"champ":"zone"', '"champ":"espece"')],
    ['unité inconnue', valide.replace('"unite":null', '"unite":"pouce"')],
    ['imbriqué sur 100 000 niveaux', '['.repeat(100_000)],
    ['unité sur un champ qui n’est pas une mesure', valide.replace('"unite":null', '"unite":"m"')],
    ['unité sur une colonne ignorée', valide.replace('"champ":"zone","unite":null', '"champ":null,"unite":"cm"')],
    ['hectares sur un champ texte', valide.replace('"unite":null', '"unite":"ha"')],
    ['unité d’une autre grandeur', JSON.stringify({ version: 1, type: 'parcellaire', colonnes: [{ entete: 'Longueur', champ: 'longueur_m', unite: 'kg' }], choix: [] })],
    ['semaines sur une surface', JSON.stringify({ version: 1, type: 'parcellaire', colonnes: [{ entete: 'Surface', champ: 'surface_m2', unite: 'semaine' }], choix: [] })],
    [
      'nouvelle culture au nom vide (2e relecture)',
      JSON.stringify({ version: 1, type: 'series', colonnes: [{ entete: 'Culture', champ: 'espece', unite: null }], choix: [{ champ: 'espece', valeur: 'Salade', decision: { sorte: 'nouvelle', nom: '' } }] }),
    ],
    [
      'nouvelle famille au nom fait d’espaces (2e relecture)',
      JSON.stringify({ version: 1, type: 'cultures', colonnes: [{ entete: 'Famille', champ: 'famille', unite: null }], choix: [{ champ: 'famille', valeur: 'Solanées', decision: { sorte: 'nouvelle', nom: '   ' } }] }),
    ],
    ['semaines sur une longueur', JSON.stringify({ version: 1, type: 'parcellaire', colonnes: [{ entete: 'Longueur', champ: 'longueur_m', unite: 'semaine' }], choix: [] })],
    [
      'identifiant de choix vide',
      JSON.stringify({ version: 1, type: 'series', colonnes: [{ entete: 'Culture', champ: 'espece', unite: null }], choix: [{ champ: 'espece', valeur: 'Salade', decision: { sorte: 'existante', id: '' } }] }),
    ],
  ])('%s → null', (_cas, texte) => {
    expect(m.lireModele(texte)).toBeNull();
  });

  it('unités de conversion acceptées sur leur champ : hectares (surface), semaines (durées)', () => {
    const parcellaire = { version: 1, type: 'parcellaire', colonnes: [{ entete: 'Surface (ha)', champ: 'surface_m2', unite: 'ha' }], choix: [] };
    const cultures = { version: 1, type: 'cultures', colonnes: [{ entete: 'Durée pépinière (semaines)', champ: 'duree_pepiniere_jours', unite: 'semaine' }], choix: [] };
    expect(m.lireModele(JSON.stringify(parcellaire))).toStrictEqual(parcellaire);
    expect(m.lireModele(JSON.stringify(cultures))).toStrictEqual(cultures);
  });

  it('semaines acceptées sur une date (« Semis (sem.) », 2e relecture) ; nouvelle valeur au nom non vide acceptée', () => {
    const series = {
      version: 1,
      type: 'series',
      colonnes: [
        { entete: 'Culture', champ: 'espece', unite: null },
        { entete: 'Semis (sem.)', champ: 'date_semis', unite: 'semaine' },
      ],
      choix: [{ champ: 'espece', valeur: 'Salade', decision: { sorte: 'nouvelle', nom: 'Salade' } }],
    };
    expect(m.lireModele(JSON.stringify(series))).toStrictEqual(series);
  });
});

// ── 3e relecture ─────────────────────────────────────────────────────────────────────────────

describe('lireModele : un champ sur deux colonnes → null (3e relecture, point 5)', () => {
  it.each([
    [
      'deux colonnes sur emplacement',
      {
        version: 1,
        type: 'parcellaire',
        colonnes: [
          { entete: 'Zone', champ: 'zone', unite: null },
          { entete: 'Planche', champ: 'emplacement', unite: null },
          { entete: 'N° planche', champ: 'emplacement', unite: null },
        ],
        choix: [],
      },
    ],
    [
      'deux colonnes sur la longueur, en unités différentes',
      {
        version: 1,
        type: 'series',
        colonnes: [
          { entete: 'Culture', champ: 'espece', unite: null },
          { entete: 'Longueur (m)', champ: 'longueur_m', unite: 'm' },
          { entete: 'Longueur (cm)', champ: 'longueur_m', unite: 'cm' },
        ],
        choix: [],
      },
    ],
  ])('%s', (_cas, modele) => {
    expect(m.lireModele(JSON.stringify(modele))).toBeNull();
  });

  it('plusieurs colonnes ignorées (champ null) restent permises', () => {
    const modele = {
      version: 1,
      type: 'parcellaire',
      colonnes: [
        { entete: 'Zone', champ: 'zone', unite: null },
        { entete: 'Notes', champ: null, unite: null },
        { entete: 'Id', champ: null, unite: null },
      ],
      choix: [],
    };
    expect(m.lireModele(JSON.stringify(modele))).toStrictEqual(modele);
  });
});

// ── 4e relecture (T14c) ──────────────────────────────────────────────────────────────────────

/** Gèle en profondeur : `creerModele` ne doit rien modifier de ce qu'on lui passe. */
function geler<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) geler(x);
    Object.freeze(v);
  }
  return v;
}

describe('creerModele : un champ sur deux colonnes est refusé, sans lever (T14c)', () => {
  const col = (champ: CleChamp | null, unite: UniteColonne | null = null): ColonneAssociee => ({ champ, unite });

  it('deux colonnes sur emplacement → champ_en_double, colonne = la deuxième ; message en français', () => {
    const entetes = geler(['Zone', 'Planche', 'Notes', 'N° planche']);
    const correspondance = geler<Correspondance>({ type: 'parcellaire', colonnes: [col('zone'), col('emplacement'), col(null), col('emplacement')] });
    const r = m.creerModele(entetes, correspondance, []);
    expect(r).toMatchObject({ ok: false, code: 'champ_en_double', champ: 'emplacement', colonne: 3 });
    if (!r.ok) expect(r.message.trim().length).toBeGreaterThan(5);
  });

  it('deux colonnes sur la longueur en unités différentes → champ_en_double', () => {
    const correspondance = geler<Correspondance>({ type: 'series', colonnes: [col('espece'), col('longueur_m', 'm'), col('longueur_m', 'cm')] });
    expect(m.creerModele(geler(['Culture', 'Longueur (m)', 'Longueur (cm)']), correspondance, [])).toMatchObject({ ok: false, code: 'champ_en_double', champ: 'longueur_m', colonne: 2 });
  });

  it('trois colonnes sur le même champ : colonne = la deuxième', () => {
    const correspondance = geler<Correspondance>({ type: 'cultures', colonnes: [col('espece'), col('espece'), col('espece')] });
    expect(m.creerModele(geler(['a', 'b', 'c']), correspondance, [])).toMatchObject({ ok: false, code: 'champ_en_double', champ: 'espece', colonne: 1 });
  });

  it('plusieurs colonnes ignorées restent permises ; le modèle créé se relit', () => {
    const correspondance = geler<Correspondance>({ type: 'parcellaire', colonnes: [col('zone'), col(null), col(null)] });
    const r = m.creerModele(geler(['Zone', 'Notes', 'Id']), correspondance, []);
    expect(r).toStrictEqual({
      ok: true,
      modele: {
        version: 1,
        type: 'parcellaire',
        colonnes: [
          { entete: 'Zone', champ: 'zone', unite: null },
          { entete: 'Notes', champ: null, unite: null },
          { entete: 'Id', champ: null, unite: null },
        ],
        choix: [],
      },
    });
    if (r.ok) expect(m.lireModele(m.serialiserModele(r.modele))).toStrictEqual(r.modele);
  });

  it('le champ en double au-delà des en-têtes ne compte pas (la colonne n’existe pas dans le fichier)', () => {
    const correspondance = geler<Correspondance>({ type: 'parcellaire', colonnes: [col('zone'), col('emplacement'), col('emplacement')] });
    expect(m.creerModele(geler(['Zone', 'Planche']), correspondance, [])).toMatchObject({ ok: true });
  });

  it.each([
    ['champ d’un autre type', { type: 'parcellaire', colonnes: [col('zone'), col('espece')] }, 'champ_inconnu', 'espece', 1],
    ['unité sur un champ texte', { type: 'parcellaire', colonnes: [col('zone', 'm')] }, 'unite_refusee', 'zone', 0],
    ['unité sur une colonne ignorée', { type: 'parcellaire', colonnes: [col('zone'), col(null, 'cm')] }, 'unite_refusee', null, 1],
    ['unité d’une autre grandeur', { type: 'parcellaire', colonnes: [col('zone'), col('longueur_m', 'kg')] }, 'unite_refusee', 'longueur_m', 1],
  ] as const)('%s → %s', (_cas, correspondance, code, champ, colonne) => {
    const r = m.creerModele(geler(['A', 'B']), geler<Correspondance>(correspondance), []);
    expect(r).toMatchObject({ ok: false, code, champ, colonne });
  });

  it.each([
    ['identifiant vide', { champ: 'espece', valeur: 'Salade', decision: { sorte: 'existante', id: '' } }],
    ['nom nouveau fait d’espaces', { champ: 'famille', valeur: 'Solanées', decision: { sorte: 'nouvelle', nom: '   ' } }],
  ] as const)('choix : %s → choix_invalide', (_cas, choix) => {
    const correspondance = geler<Correspondance>({ type: 'cultures', colonnes: [col('espece'), col('famille')] });
    expect(m.creerModele(geler(['Culture', 'Famille']), correspondance, geler([choix]))).toMatchObject({ ok: false, code: 'choix_invalide', champ: choix.champ, colonne: null });
  });
});

describe('creerModele : un modèle créé est toujours relisible (propriété, correspondances générées, T14c)', () => {
  /** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes cas à chaque exécution. */
  function generateur(graine: number): () => number {
    let a = graine >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  const TYPES: readonly TypeContenu[] = ['parcellaire', 'cultures', 'series', 'assolement'];
  const TOUS_CHAMPS: readonly CleChamp[] = [
    'zone', 'sous_zone', 'emplacement', 'sorte', 'longueur_m', 'largeur_m', 'type_abri', 'surface_m2', 'nombre_places', 'espece', 'variete', 'famille', 'mode',
    'duree_pepiniere_jours', 'duree_avant_recolte_jours', 'fenetre_recolte_jours', 'rangs_par_planche', 'ecartement_cm', 'poids_mille_graines_g', 'date_semis',
    'date_plantation', 'date_debut_recolte', 'date_fin_recolte', 'nombre_plants', 'annee',
  ];
  const UNITES: readonly UniteColonne[] = ['m', 'cm', 'kg', 'g', 'ha', 'semaine'];
  const ENTETES: readonly Cellule[] = ['Planche', ' Longueur (m) ', '', '   ', null, 12, 3.5, 'É', 'Culture', 'Culture', 'N° planche', '🌱 Semis', '\uD800', 'a"b\\c', '__proto__'];
  const CODES = ['champ_en_double', 'champ_inconnu', 'unite_refusee', 'choix_invalide'];

  function cas(alea: () => number): { entetes: Cellule[]; correspondance: Correspondance; choix: ChoixValeur[] } {
    const pris = <T>(liste: readonly T[]): T => liste[Math.floor(alea() * liste.length)] as T;
    const type = pris(TYPES);
    const duType = m.CHAMPS_IMPORT[type].map((d) => d.cle);
    const n = Math.floor(alea() * 7);
    const entetes = Array.from({ length: n }, () => pris(ENTETES));
    const longueur = Math.max(0, n + Math.floor(alea() * 3) - 1);
    const colonnes = Array.from({ length: longueur }, (): ColonneAssociee => {
      const x = alea();
      // Surtout des champs du type (doublons fréquents), parfois un champ d'un autre type ou ignoré.
      const champ = x < 0.2 ? null : x < 0.9 ? pris(duType) : pris(TOUS_CHAMPS);
      const unite = alea() < 0.6 ? null : pris(UNITES);
      return { champ, unite };
    });
    const choix = Array.from({ length: Math.floor(alea() * 3) }, (): ChoixValeur => {
      const champ = alea() < 0.5 ? 'espece' : 'famille';
      const valeur = pris(['Salade', '', '  laitue ', 'Solanées']);
      const y = alea();
      const decision = y < 0.45 ? { sorte: 'existante' as const, id: pris(['esp-laitue', 'fam-1', '', ' ']) } : { sorte: 'nouvelle' as const, nom: pris(['Salade', '', '   ', 'Poireau']) };
      return { champ, valeur, decision };
    });
    return { entetes, correspondance: { type, colonnes }, choix };
  }

  /** Le modèle tel que `creerModele` le construit (contrat) : une colonne par en-tête, choix recopiés. */
  function modeleAttendu(entetes: readonly Cellule[], correspondance: Correspondance, choix: readonly ChoixValeur[]): ModeleImport {
    return {
      version: 1,
      type: correspondance.type,
      colonnes: entetes.map((e, i) => ({ entete: e === null ? '' : typeof e === 'number' ? String(e) : e, champ: correspondance.colonnes[i]?.champ ?? null, unite: correspondance.colonnes[i]?.unite ?? null })),
      choix: choix.map((c) => ({ champ: c.champ, valeur: c.valeur, decision: c.decision.sorte === 'existante' ? { sorte: 'existante', id: c.decision.id } : { sorte: 'nouvelle', nom: c.decision.nom } })),
    };
  }

  it('2 000 correspondances générées : jamais d’exception ; ok ⇔ relisible ; un modèle créé se relit à l’identique', () => {
    const alea = generateur(20260930);
    let acceptes = 0;
    let refuses = 0;
    let doublons = 0;
    for (let k = 0; k < 2_000; k++) {
      const { entetes, correspondance, choix } = cas(alea);
      const trace = JSON.stringify({ entetes, correspondance, choix });
      const r = m.creerModele(geler(entetes), geler(correspondance), geler(choix));
      const naif = modeleAttendu(entetes, correspondance, choix);
      const relisible = m.lireModele(JSON.stringify(naif)) !== null;
      if (r.ok) {
        acceptes++;
        // Espaces autour des en-têtes : `texteCellule` peut les retirer ; on compare donc au modèle relu.
        const relu = m.lireModele(m.serialiserModele(r.modele));
        expect(relu, `relisible : ${trace}`).toStrictEqual(r.modele);
        expect(r.modele.colonnes.map((c) => [c.champ, c.unite]), trace).toStrictEqual(naif.colonnes.map((c) => [c.champ, c.unite]));
        expect(r.modele.choix, trace).toStrictEqual(naif.choix);
        expect(relisible, `accepté alors que lireModele refuserait : ${trace}`).toBe(true);
      } else {
        refuses++;
        expect(CODES, trace).toContain(r.code);
        expect(r.message.trim().length, trace).toBeGreaterThan(5);
        expect(relisible, `refusé (${r.code}) alors que lireModele accepterait : ${trace}`).toBe(false);
        const champs = naif.colonnes.map((c) => c.champ).filter((c) => c !== null);
        if (r.code === 'champ_en_double') {
          doublons++;
          expect(champs.filter((c) => c === r.champ).length, trace).toBeGreaterThan(1);
          expect(naif.colonnes.findIndex((c, i) => c.champ === r.champ && naif.colonnes.findIndex((d) => d.champ === r.champ) < i), trace).toBe(r.colonne);
        }
      }
    }
    // Le générateur couvre bien les deux issues, et des doublons.
    expect(acceptes).toBeGreaterThan(100);
    expect(refuses).toBeGreaterThan(100);
    expect(doublons).toBeGreaterThan(20);
  });
});
