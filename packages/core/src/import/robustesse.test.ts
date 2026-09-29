/**
 * Tests d'acceptation T14 — robustesse face aux fichiers piégés (relecture du chef d'équipe,
 * points bloquants 1 à 3). Contrat : ./test/contrat.ts, « Lecteur Excel » et « Limites ».
 *
 * Chaque appel tourne dans un fil d'exécution à part (./test/isole.ts), tas plafonné à 512 Mo et
 * arrêté au-delà du délai : une implémentation fautive fait échouer le test (« delai »,
 * « memoire ») sans bloquer ni emporter la suite. La durée vérifiée est celle de l'appel seul.
 * Les classeurs sont fabriqués ici (./test/classeur.ts) : aucun gros fichier n'est commité.
 */
import { describe, expect, it } from 'vitest';
import { classeur, classeurSimple, feuilleXml } from './test/classeur.ts';
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
