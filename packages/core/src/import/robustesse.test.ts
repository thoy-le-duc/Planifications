/**
 * Tests d'acceptation T14 — robustesse face aux fichiers piégés (relecture du chef d'équipe,
 * points bloquants 1 à 3 ; 2e relecture, points bloquants 1 à 3 et chaînes partagées).
 * Contrat : ./test/contrat.ts, « Lecteur Excel », « Lecture d'un CSV », « Plan d'import ».
 *
 * Chaque appel tourne dans un fil d'exécution à part (./test/isole.ts), tas plafonné à 512 Mo et
 * arrêté au-delà du délai : une implémentation fautive fait échouer le test (« delai »,
 * « memoire ») sans bloquer ni emporter la suite. La durée vérifiée est celle de l'appel seul.
 * Les classeurs sont fabriqués ici (./test/classeur.ts) : aucun gros fichier n'est commité.
 */
import { describe, expect, it } from 'vitest';
import { classeur, classeurSimple, feuilleXml } from './test/classeur.ts';
import { utf8 } from './test/fixtures.ts';
import { executerIsole, type Issue } from './test/isole.ts';

/** Marge pour démarrer le fil et charger le module (hors durée mesurée). */
const CHARGEMENT_MS = 3_000;
const DELAI_TEST_MS = 20_000;

async function lireIsole(octets: Uint8Array, budgetMs: number): Promise<Issue> {
  return executerIsole('xlsx', ['lecteurXlsx', 'lire'], [octets], { arretMs: budgetMs + CHARGEMENT_MS, memoireMo: 512 });
}

function attendreIllisible(r: Issue, budgetMs: number): void {
  expect(r).toMatchObject({ issue: 'resultat', valeur: { ok: false, code: 'classeur_illisible' } });
  if (r.issue === 'resultat') expect(r.dureeMs, `lecture en ${String(Math.round(r.dureeMs))} ms`).toBeLessThan(budgetMs);
}

describe('lecteurXlsx : plafond de 5 millions de cases pour tout le classeur', () => {
  it(
    '<c r="XFD…"> sur 20 000 lignes (327 millions de cases à remplir) → classeur_illisible, vite et sans exploser la mémoire',
    async () => {
      const lignes: string[] = [];
      for (let i = 1; i <= 20_000; i++) lignes.push(`<row r="${String(i)}"><c r="XFD${String(i)}"><v>1</v></c></row>`);
      attendreIllisible(await lireIsole(classeurSimple(lignes.join('')), 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );

  it(
    'six feuilles distinctes réduites à <row r="1048576"> (6,3 millions de lignes) → classeur_illisible',
    async () => {
      const feuilles = Array.from({ length: 6 }, (_, i) => ({ nom: `F${String(i + 1)}`, partie: `worksheets/sheet${String(i + 1)}.xml` }));
      const parties = Object.fromEntries(feuilles.map((f) => [f.partie, feuilleXml('<row r="1048576"><c r="A1048576"><v>1</v></c></row>')]));
      attendreIllisible(await lireIsole(classeur({ feuilles, parties }), 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );

  it(
    'une même partie <row r="1048576"> déclarée par 60 feuilles → classeur_illisible (une partie n’est lue qu’une fois)',
    async () => {
      const feuilles = Array.from({ length: 60 }, (_, i) => ({ nom: `F${String(i + 1)}`, partie: 'worksheets/sheet1.xml' }));
      const parties = { 'worksheets/sheet1.xml': feuilleXml('<row r="1048576"><c r="A1048576"><v>1</v></c></row>') };
      attendreIllisible(await lireIsole(classeur({ feuilles, parties }), 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('lecteurXlsx : balises géantes ou non terminées → classeur_illisible en temps linéaire', () => {
  const MO = 1024 * 1024;
  const ligne = (balise: string) => `<row r="1">${balise}</row>`;

  it.each([
    ['<c r="A1" + 1 Mo de « a », sans fin', `<c r="A1" ${'a'.repeat(MO)}`],
    ['<c r="A1" + 1 Mo de « a » puis />', `<c r="A1" ${'a'.repeat(MO)}/>`],
    ['attribut jamais refermé (guillemet ouvert sur 1 Mo)', `<c r="${'a'.repeat(MO)}/><v>1</v></c>`],
    ['balise de 70 Kio aux attributs bien formés', `<c r="A1" t="inlineStr" x="${'a'.repeat(70 * 1024)}"><is><t>ok</t></is></c>`],
  ])(
    '%s',
    async (_cas, balise) => {
      attendreIllisible(await lireIsole(classeurSimple(ligne(balise)), 1_000), 1_000);
    },
    DELAI_TEST_MS,
  );
});

describe('temps linéaire sur une cellule de 100 Kio (moins de 200 ms par appel)', () => {
  const KIO = 1024;
  const BUDGET_MS = 200;

  async function appeler(chemin: string, args: readonly unknown[]): Promise<Issue> {
    return executerIsole('import', [chemin], args, { arretMs: BUDGET_MS + CHARGEMENT_MS, memoireMo: 256 });
  }

  function attendre(r: Issue, valeur: unknown): void {
    expect(r).toMatchObject({ issue: 'resultat' });
    if (r.issue !== 'resultat') return;
    expect(r.valeur).toStrictEqual(valeur);
    expect(r.dureeMs, `appel en ${String(Math.round(r.dureeMs))} ms`).toBeLessThan(BUDGET_MS);
  }

  const invalide = { ok: false, code: 'nombre_invalide' };

  it.each([
    ['lettres puis « ! »', `${'a'.repeat(100 * KIO)}!`],
    ['espaces entre deux chiffres', `1${' '.repeat(100 * KIO)}1`],
    ['chiffres puis une unité', `${'1'.repeat(100 * KIO)} m`],
    ['« 1 » répété puis une unité', `${'1 '.repeat(50 * KIO)}m`],
  ])(
    'lireMesure : %s → nombre_invalide',
    async (_cas, cellule) => {
      attendre(await appeler('lireMesure', [cellule, 'm', null]), invalide);
    },
    DELAI_TEST_MS,
  );

  it.each([
    ['« 1 » répété puis une lettre', `${'1 '.repeat(50 * KIO)}x`],
    ['groupes de milliers sans fin', `1${' 234'.repeat(25 * KIO)}`],
    ['100 Kio de chiffres', '1'.repeat(100 * KIO)],
  ])(
    'lireNombre : %s → nombre_invalide',
    async (_cas, cellule) => {
      attendre(await appeler('lireNombre', [cellule]), invalide);
    },
    DELAI_TEST_MS,
  );

  /** Parenthèse jamais refermée après 100 Kio d'espaces : piège classique des expressions en « \s*(…)$ ». */
  const geant = `a${' '.repeat(100 * KIO)}(x`;

  it(
    'detecterEntete : une cellule géante sur la première ligne ne compte pas',
    async () => {
      attendre(await appeler('detecterEntete', [[[geant, 'Truc'], ['Zone', 'Planche'], ['T1', 'P1']]]), 1);
    },
    DELAI_TEST_MS,
  );

  it(
    'proposerCorrespondance : en-tête géant ignoré, les autres reconnus',
    async () => {
      attendre(await appeler('proposerCorrespondance', [[geant, 'Planche'], 'parcellaire']), {
        type: 'parcellaire',
        colonnes: [
          { champ: null, unite: null },
          { champ: 'emplacement', unite: null },
        ],
      });
    },
    DELAI_TEST_MS,
  );

  it(
    'proposerType : en-tête géant ignoré',
    async () => {
      attendre(await appeler('proposerType', [[geant, 'Zone']]), 'parcellaire');
    },
    DELAI_TEST_MS,
  );

  it(
    'en-tête de 100 Kio qui se réduirait à « planche » : pas de correspondance (plus de 200 caractères)',
    async () => {
      attendre(await appeler('proposerCorrespondance', [[`Planche${' .'.repeat(50 * KIO)}`], 'parcellaire']), {
        type: 'parcellaire',
        colonnes: [{ champ: null, unite: null }],
      });
    },
    DELAI_TEST_MS,
  );
});

// ── 2e relecture ─────────────────────────────────────────────────────────────────────────────

/** Durée de l'appel mesurée dans le fil, sous le budget. */
function attendreDuree(r: Issue, budgetMs: number): void {
  if (r.issue === 'resultat') expect(r.dureeMs, `appel en ${String(Math.round(r.dureeMs))} ms`).toBeLessThan(budgetMs);
}

describe('lecteurXlsx : entités XML et échappements OOXML décodés en temps et mémoire linéaires (2e relecture, point 1)', () => {
  const chaineEnLigne = (texte: string) => classeurSimple(`<row r="1"><c r="A1" t="inlineStr"><is><t>${texte}</t></is></c></row>`);

  it(
    'chaîne en ligne de 5 millions de « &amp; » (plus de 32 767 caractères) → classeur_illisible, < 2 s, tas de 512 Mo',
    async () => {
      attendreIllisible(await lireIsole(chaineEnLigne('&amp;'.repeat(5_000_000)), 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );

  it(
    'chaîne en ligne de 7 millions de « _x0041_ » → classeur_illisible, < 2 s, tas de 512 Mo',
    async () => {
      attendreIllisible(await lireIsole(chaineEnLigne('_x0041_'.repeat(7_000_000)), 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );

  it(
    'chaîne partagée de 5 millions de « &#233; » → classeur_illisible, < 2 s',
    async () => {
      const octets = classeur({
        feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
        parties: {
          'worksheets/sheet1.xml': feuilleXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'),
          'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${'&#233;'.repeat(5_000_000)}</t></si></sst>`,
        },
      });
      attendreIllisible(await lireIsole(octets, 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('lecteurXlsx : les chaînes partagées comptent dans le plafond de 5 millions de cases (2e relecture)', () => {
  it(
    '9 millions de <si/> pour une feuille d’une case → classeur_illisible, < 2 s',
    async () => {
      const octets = classeur({
        feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
        parties: {
          'worksheets/sheet1.xml': feuilleXml('<row r="1"><c r="A1"><v>1</v></c></row>'),
          'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${'<si/>'.repeat(9_000_000)}</sst>`,
        },
      });
      attendreIllisible(await lireIsole(octets, 2_000), 2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('plan d’import en temps linéaire : une même chaîne de 1 Mo dans 3 000 lignes (2e relecture, point 2)', () => {
  const MO = 1024 * 1024;
  const trop = (champ: string, colonne: number) => ['texte_trop_long', champ, colonne] as const;
  const nombre = (champ: string, colonne: number) => ['nombre_invalide', champ, colonne] as const;
  const date = (champ: string, colonne: number) => ['date_invalide', champ, colonne] as const;

  it.each([
    [
      'parcellaire',
      ['Zone', 'Chapelle', 'Planche', 'Sorte', 'Longueur', 'Largeur', 'Abri', 'Surface', 'Nombre de places'],
      [trop('zone', 0), trop('sous_zone', 1), trop('emplacement', 2), trop('sorte', 3), nombre('longueur_m', 4), nombre('largeur_m', 5), trop('type_abri', 6), nombre('surface_m2', 7), nombre('nombre_places', 8)],
    ],
    [
      'cultures',
      ['Culture', 'Variété', 'Famille', 'Mode', 'Durée pépinière', 'Jours avant récolte', 'Fenêtre de récolte', 'Rangs', 'Écartement', 'PMG'],
      [
        trop('espece', 0),
        trop('variete', 1),
        trop('famille', 2),
        trop('mode', 3),
        nombre('duree_pepiniere_jours', 4),
        nombre('duree_avant_recolte_jours', 5),
        nombre('fenetre_recolte_jours', 6),
        nombre('rangs_par_planche', 7),
        nombre('ecartement_cm', 8),
        nombre('poids_mille_graines_g', 9),
      ],
    ],
    [
      'series',
      ['Culture', 'Variété', 'Planche', 'Semis', 'Plantation', 'Début récolte', 'Fin récolte', 'Longueur', 'Nombre de plants'],
      [
        trop('espece', 0),
        trop('variete', 1),
        trop('emplacement', 2),
        date('date_semis', 3),
        date('date_plantation', 4),
        date('date_debut_recolte', 5),
        date('date_fin_recolte', 6),
        nombre('longueur_m', 7),
        nombre('nombre_plants', 8),
      ],
    ],
    ['assolement', ['Année', 'Zone', 'Planche', 'Famille', 'Culture'], [nombre('annee', 0), trop('zone', 1), trop('emplacement', 2), trop('famille', 3), trop('espece', 4)]],
  ] as const)(
    '%s : chaque ligne en erreur, texte_trop_long sur les textes, choix et références, aucune décision, < 2 s',
    async (type, entetes, erreurs) => {
      const r = await executerIsole('scenarios', ['planChaineLongue'], [type, entetes, MO, 3_000], { arretMs: 2_000 + CHARGEMENT_MS, memoireMo: 512 });
      expect(r).toMatchObject({ issue: 'resultat' });
      if (r.issue !== 'resultat') return;
      expect(r.valeur).toMatchObject({
        nombreLignes: 3_000,
        resume: { valides: 0, erreurs: 3_000, aDecider: 0, doublons: 0, ignorees: 0 },
        nombreDecisions: 0,
        erreursPremiere: erreurs,
        erreursDerniere: erreurs,
      });
      expect((r.valeur as { messageLePlusLong: number }).messageLePlusLong).toBeLessThanOrEqual(200);
      attendreDuree(r, 2_000);
    },
    DELAI_TEST_MS,
  );

  it(
    'classeur : chaîne partagée de 32 767 caractères (la limite d’Excel) dans 3 000 lignes → lue, puis plan en erreur, < 2 s en tout',
    async () => {
      const lignes = ['<row r="1"><c r="A1" t="inlineStr"><is><t>Zone</t></is></c><c r="B1" t="inlineStr"><is><t>Planche</t></is></c></row>'];
      for (let i = 2; i <= 3_001; i++) lignes.push(`<row r="${String(i)}"><c r="A${String(i)}" t="s"><v>0</v></c><c r="B${String(i)}" t="s"><v>0</v></c></row>`);
      const octets = classeur({
        feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
        parties: {
          'worksheets/sheet1.xml': feuilleXml(lignes.join('')),
          'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${'a'.repeat(32_767)}</t></si></sst>`,
        },
      });
      const r = await executerIsole('scenarios', ['planClasseur'], [octets, 'parcellaire'], { arretMs: 2_000 + CHARGEMENT_MS, memoireMo: 512 });
      expect(r).toMatchObject({
        issue: 'resultat',
        valeur: { nombreLignes: 3_000, resume: { erreurs: 3_000 }, erreursPremiere: [trop('zone', 0), trop('emplacement', 1)], erreursDerniere: [trop('zone', 0), trop('emplacement', 1)] },
      });
      attendreDuree(r, 2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('lignes ignorées regroupées en plages (2e relecture, point 3)', () => {
  it(
    '1 000 000 de lignes vides entre deux planches → une seule plage, < 2 s ; les totaux qui se suivent → une plage',
    async () => {
      const r = await executerIsole('scenarios', ['planLignesVides'], [1_000_000], { arretMs: 2_000 + CHARGEMENT_MS, memoireMo: 512 });
      expect(r).toMatchObject({
        issue: 'resultat',
        valeur: {
          ignorees: [
            { debut: 3, fin: 1_000_002, motif: 'vide' },
            { debut: 1_000_004, fin: 1_000_005, motif: 'total' },
          ],
          resume: { valides: 2, erreurs: 0, aDecider: 0, doublons: 0, ignorees: 1_000_002 },
          lignes: [2, 1_000_003],
        },
      });
      attendreDuree(r, 2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('lireCsv : plafond de 5 millions de cases, lignes vides de fin non créées (2e relecture, point 3)', () => {
  const MO = 1024 * 1024;

  async function lireCsvIsole(texte: string): Promise<Issue> {
    return executerIsole('scenarios', ['resumerCsv'], [utf8(texte)], { arretMs: 2_000 + CHARGEMENT_MS, memoireMo: 512 });
  }

  function attendreCsv(r: Issue, valeur: unknown): void {
    expect(r).toMatchObject({ issue: 'resultat', valeur });
    attendreDuree(r, 2_000);
  }

  it(
    '5 Mo de « \\n » seuls → aucune ligne, pas d’erreur',
    async () => {
      attendreCsv(await lireCsvIsole('\n'.repeat(5 * MO)), { erreur: null, nombreLignes: 0 });
    },
    DELAI_TEST_MS,
  );

  it(
    '20 Mo de « ; » seuls (une ligne vide) → aucune ligne, pas d’erreur',
    async () => {
      attendreCsv(await lireCsvIsole(';'.repeat(20 * MO)), { erreur: null, nombreLignes: 0 });
    },
    DELAI_TEST_MS,
  );

  it(
    '5 Mo de « \\n » puis une ligne utile (plus de 5 millions de cases) → fichier_trop_grand',
    async () => {
      attendreCsv(await lireCsvIsole(`${'\n'.repeat(5 * MO)}Zone;Planche\nT1;P1\n`), { erreur: 'fichier_trop_grand', nombreLignes: 0 });
    },
    DELAI_TEST_MS,
  );

  it(
    'une ligne de 20 Mo de « ; » suivie d’une ligne utile → fichier_trop_grand',
    async () => {
      attendreCsv(await lireCsvIsole(`Zone;Planche\n${';'.repeat(20 * MO)}\nT1;P1\n`), { erreur: 'fichier_trop_grand', nombreLignes: 0 });
    },
    DELAI_TEST_MS,
  );

  it(
    '1 000 000 de lignes « ;;;;;; » à la fin d’un vrai fichier → les lignes utiles, rien d’autre',
    async () => {
      const texte = `Zone;Chapelle;Planche;Longueur;Largeur;Abri;Notes\r\nT1;C1;P1;30;0,8;tunnel;\r\nT1;C1;P2;30;0,8;tunnel;ok\r\n${';;;;;;\r\n'.repeat(1_000_000)}`;
      attendreCsv(await lireCsvIsole(texte), {
        erreur: null,
        nombreLignes: 3,
        debut: [
          ['Zone', 'Chapelle', 'Planche', 'Longueur', 'Largeur', 'Abri', 'Notes'],
          ['T1', 'C1', 'P1', '30', '0,8', 'tunnel', ''],
          ['T1', 'C1', 'P2', '30', '0,8', 'tunnel', 'ok'],
        ],
      });
    },
    DELAI_TEST_MS,
  );

  it(
    '1 000 000 de lignes « a;b » (3 millions de cases) → lues',
    async () => {
      attendreCsv(await lireCsvIsole('a;b\n'.repeat(1_000_000)), { erreur: null, nombreLignes: 1_000_000 });
    },
    DELAI_TEST_MS,
  );
});

// ── 3e relecture ─────────────────────────────────────────────────────────────────────────────

describe('plan d’import : texte nettoyé une fois par chaîne, pas une fois par cellule (3e relecture, point 1)', () => {
  const SST = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const LIGNES = 100_000;
  const COLONNES = ['A', 'B', 'C', 'D', 'E'] as const;

  it(
    'classeur de 100 000 lignes × 5 colonnes de chaînes partagées de 32 767 caractères (« a » + espaces, espaces, « Total » + espaces) → plan en < 2 s',
    async () => {
      // Chaînes partagées : 0 = « a » + 32 766 espaces, 1 = 32 767 espaces, 2 = « Total » + espaces.
      const chaines = [`a${' '.repeat(32_766)}`, ' '.repeat(32_767), `Total${' '.repeat(32_762)}`];
      // Ligne Excel r (2 à 100 001) : r % 3 = 0 → planche « a » (zone a, planche a, le reste vide) ;
      // r % 3 = 1 → ligne vide (espaces seuls) ; r % 3 = 2 → ligne de total.
      const motif = (r: number): readonly number[] => (r % 3 === 0 ? [0, 1, 0, 1, 1] : r % 3 === 1 ? [1, 1, 1, 1, 1] : [2, 1, 0, 1, 1]);
      const entetes = ['Zone', 'Chapelle', 'Planche', 'Longueur', 'Abri'];
      const xml = [`<row r="1">${entetes.map((e, j) => `<c r="${COLONNES[j] ?? 'A'}1" t="inlineStr"><is><t>${e}</t></is></c>`).join('')}</row>`];
      let donnees = 0;
      let ignorees = 0;
      for (let r = 2; r <= LIGNES + 1; r++) {
        const m = motif(r);
        if (r % 3 === 0) donnees++;
        else ignorees++;
        xml.push(`<row r="${String(r)}">${m.map((s, j) => `<c r="${COLONNES[j] ?? 'A'}${String(r)}" t="s"><v>${String(s)}</v></c>`).join('')}</row>`);
      }
      const octets = classeur({
        feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
        parties: {
          'worksheets/sheet1.xml': feuilleXml(xml.join('')),
          'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${SST}">${chaines.map((c) => `<si><t xml:space="preserve">${c}</t></si>`).join('')}</sst>`,
        },
      });
      const r = await executerIsole('scenarios', ['planClasseur'], [octets, 'parcellaire'], { arretMs: 15_000, memoireMo: 512 });
      expect(r).toMatchObject({
        issue: 'resultat',
        valeur: {
          champs: ['zone', 'sous_zone', 'emplacement', 'longueur_m', 'type_abri'],
          nombreLignes: donnees,
          resume: { valides: 1, erreurs: 0, aDecider: 0, doublons: donnees - 1, ignorees },
          erreursPremiere: [],
          erreursDerniere: [],
        },
      });
      if (r.issue !== 'resultat') return;
      const duree = (r.valeur as { dureePlanMs: number }).dureePlanMs;
      expect(duree, `plan en ${String(Math.round(duree))} ms`).toBeLessThan(2_000);
    },
    DELAI_TEST_MS,
  );
});

describe('lireCsv : au plus 1 048 576 lignes, mémoire bornée (3e relecture, point 2)', () => {
  /** Tas plafonné à 300 Mo : lire sans dépasser, c'est un pic de mémoire sous 300 Mo. */
  async function lireCsvIsole(texte: string, memoireMo: number): Promise<Issue> {
    return executerIsole('scenarios', ['resumerCsv'], [utf8(texte)], { arretMs: 4_000 + CHARGEMENT_MS, memoireMo });
  }

  it(
    '1 048 577 lignes « a » (2,1 millions de cases seulement) → fichier_trop_grand',
    async () => {
      const r = await lireCsvIsole('a\n'.repeat(1_048_577), 512);
      expect(r).toMatchObject({ issue: 'resultat', valeur: { erreur: 'fichier_trop_grand', nombreLignes: 0 } });
    },
    DELAI_TEST_MS,
  );

  it(
    '1 048 576 lignes vides puis une ligne utile (1 048 577 lignes rendues) → fichier_trop_grand',
    async () => {
      const r = await lireCsvIsole(`${'\n'.repeat(1_048_576)}a;b\n`, 512);
      expect(r).toMatchObject({ issue: 'resultat', valeur: { erreur: 'fichier_trop_grand', nombreLignes: 0 } });
    },
    DELAI_TEST_MS,
  );

  it(
    '1 048 576 lignes « a » (la limite d’Excel) → lues',
    async () => {
      const r = await lireCsvIsole('a\n'.repeat(1_048_576), 512);
      expect(r).toMatchObject({ issue: 'resultat', valeur: { erreur: null, nombreLignes: 1_048_576 } });
    },
    DELAI_TEST_MS,
  );

  it.each([
    ['1 000 000 de lignes « ab »', 'ab\n'.repeat(1_000_000), 1_000_000, [['ab'], ['ab'], ['ab']]],
    ['1 000 000 de lignes « a;b »', 'a;b\n'.repeat(1_000_000), 1_000_000, [['a', 'b'], ['a', 'b'], ['a', 'b']]],
    ['1 000 000 de lignes vides au milieu, puis une ligne utile', `Zone;Planche\n${'\n'.repeat(1_000_000)}T1;P1\n`, 1_000_002, [['Zone', 'Planche'], [''], ['']]],
  ] as const)(
    '%s → lues avec un tas plafonné à 300 Mo',
    async (_cas, texte, nombreLignes, debut) => {
      const r = await lireCsvIsole(texte, 300);
      expect(r).toMatchObject({ issue: 'resultat', valeur: { erreur: null, nombreLignes, debut } });
    },
    DELAI_TEST_MS,
  );
});

describe('appliquerModele en temps linéaire (3e relecture)', () => {
  it(
    '400 000 colonnes à l’en-tête vide → correspondance rendue en < 1 s',
    async () => {
      const n = 400_000;
      const entetes: string[] = Array.from({ length: n }, () => '');
      const modele = { version: 1, type: 'parcellaire', colonnes: entetes.map(() => ({ entete: '', champ: null, unite: null })), choix: [] };
      const r = await executerIsole('import', ['appliquerModele'], [modele, entetes], { arretMs: 1_000 + CHARGEMENT_MS, memoireMo: 512 });
      expect(r).toMatchObject({ issue: 'resultat' });
      if (r.issue !== 'resultat') return;
      const c = r.valeur as { type: string; colonnes: readonly unknown[] };
      expect(c.type).toBe('parcellaire');
      expect(c.colonnes).toHaveLength(n);
      expect(c.colonnes[n - 1]).toStrictEqual({ champ: null, unite: null });
      attendreDuree(r, 1_000);
    },
    DELAI_TEST_MS,
  );
});
