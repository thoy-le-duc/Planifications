/**
 * Tests d'acceptation T14 — modèle d'import : la correspondance validée (colonnes et valeurs) se
 * sérialise, et le fichier suivant de même forme se prépare sans rien reprendre.
 * Contrat : ./test/contrat.ts. Fichiers : modele-a.csv et modele-b.csv (mêmes en-têtes, autre ordre).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type Cellule, type ChoixValeur, type Correspondance, type ModeleImport, type ModuleImport } from './test/contrat.ts';
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
    modele = m.creerModele(entetes, correspondance, choix);
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
  ])('%s → null', (_cas, texte) => {
    expect(m.lireModele(texte)).toBeNull();
  });
});
