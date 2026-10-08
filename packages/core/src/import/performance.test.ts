/**
 * Tests d'acceptation T14 — performance et aller-retour avec l'export T15.
 *
 * Critère du ticket : import d'une ferme complète (jeu de T07 exporté en tableur) en moins de
 * 60 s avec le CPU ralenti ×4, soit moins de 15 s ici, en Node. Le moteur prépare tout le plan :
 * lecture des octets, en-tête, type, correspondance, normalisation, rapprochement, doublons.
 * Deux jeux :
 *   - la ferme au volume de T07 passée par l'export T15 (emplacement.csv, serie.csv) ;
 *   - un tableur de 30 000 séries (le volume des événements de T07) en Windows-1252, en semaines,
 *     avec des cultures à rapprocher : le pire cas d'un fichier tapé à la main.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type Bibliotheque, type ModuleImport, type PlanImport, type TypeContenu } from './test/contrat.ts';
import { cp1252, ESPECES, FAMILLES, lireFixture, utf8 } from './test/fixtures.ts';
import { fermeComplete, VOLUMES } from './test/jeu-ferme.ts';
import { preparerExport } from '../export/index.ts';
import { mesurer } from '../test/mesurer.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

const BUDGET_MS = 15_000;

/** Tout le chemin d'un fichier, de ses octets au plan, avec le type et la correspondance proposés. */
function preparer(octets: Uint8Array, bibliotheque: Bibliotheque, anneeSaison: number | null): { type: TypeContenu | null; plan: PlanImport | null } {
  const { lignes } = m.lireCsv(octets);
  const ligneEntete = m.detecterEntete(lignes);
  if (ligneEntete === null) return { type: null, plan: null };
  const entetes = lignes[ligneEntete] ?? [];
  const type = m.proposerType(entetes);
  if (type === null) return { type, plan: null };
  const correspondance = m.proposerCorrespondance(entetes, type);
  return { type, plan: m.preparerImport({ lignes, ligneEntete, correspondance, bibliotheque, anneeSaison }) };
}

/** Tableur de séries tapé à la main : 30 000 lignes, Windows-1252, « ; », semaines, virgules. */
function tableurSeries(n: number): Uint8Array {
  const cultures = ['Laitue', 'Batavia blonde', 'Tomate', 'Tomates cerises', 'Carotte', 'Chou pommé', 'Poireau', 'Épinard', 'Radis', 'Courgette'];
  const lignes = ['Culture;Variété;Planche;Semis;Plantation;Début récolte;Longueur (m)'];
  for (let i = 0; i < n; i++) {
    const semaine = 8 + (i % 30);
    lignes.push(
      [
        cultures[i % cultures.length],
        `Variété ${String(i % 97)} « maison »`,
        `P${String(i % 400).padStart(3, '0')}`,
        `S${String(semaine)}`,
        `sem ${String(semaine + 4)}`,
        `Semaine ${String(semaine + 10)}`,
        `${String(10 + (i % 30))},${String(i % 10)}`,
      ].join(';'),
    );
  }
  return cp1252(`${lignes.join('\r\n')}\r\n`);
}

describe('aller-retour avec l’export T15', () => {
  it('la fixture t15-emplacement.csv est bien ce que produit l’export aujourd’hui', async () => {
    const F = '0192f0c1-7a6e-7cc3-a000-000000000000';
    const Z1 = '0192f0c1-7a6e-7cc3-a000-000000000011';
    const Z2 = '0192f0c1-7a6e-7cc3-a000-000000000012';
    const h = { cree_le: '2026-09-01T06:00:00.000Z', modifie_le: '2026-09-01T06:00:00.000Z', supprime_le: null };
    const commun = { ferme_id: F, actif_du: '2026-01-01', actif_au: null, remplace: '[]', ...h };
    const emplacement = [
      { id: '0192f0c1-7a6e-7cc3-a000-000000000101', zone_id: Z1, code: 'T1-P01', sorte: 'planche', longueur_m: 30, largeur_m: 0.8, nombre_places: null, ...commun },
      { id: '0192f0c1-7a6e-7cc3-a000-000000000102', zone_id: Z1, code: 'T1-P02', sorte: 'planche', longueur_m: 25.5, largeur_m: 0.8, nombre_places: null, ...commun },
      { id: '0192f0c1-7a6e-7cc3-a000-000000000103', zone_id: Z2, code: 'HS-G01', sorte: 'gouttiere', longueur_m: 12, largeur_m: null, nombre_places: 96, ...commun },
    ];
    const exporte = preparerExport({ fermeId: F, genereLe: '2026-09-29T06:30:00.000Z', tables: { emplacement } }).fichiers.find((f) => f.chemin === 'emplacement.csv');
    expect(utf8(exporte?.contenu ?? '')).toStrictEqual(await lireFixture('t15-emplacement.csv'));
  });

  it('t15-emplacement.csv se relit entièrement : zone, code, sorte, longueurs, places', async () => {
    const { type, plan } = preparer(await lireFixture('t15-emplacement.csv'), { especes: [], familles: [] }, null);
    expect(type).toBe('parcellaire');
    expect(plan?.lignes).toStrictEqual([
      { ligne: 2, statut: 'valide', valeurs: { zone: '0192f0c1-7a6e-7cc3-a000-000000000011', emplacement: 'T1-P01', sorte: 'planche', longueur_m: 30, largeur_m: 0.8, nombre_places: null }, erreurs: [], doublonDe: null },
      { ligne: 3, statut: 'valide', valeurs: { zone: '0192f0c1-7a6e-7cc3-a000-000000000011', emplacement: 'T1-P02', sorte: 'planche', longueur_m: 25.5, largeur_m: 0.8, nombre_places: null }, erreurs: [], doublonDe: null },
      { ligne: 4, statut: 'valide', valeurs: { zone: '0192f0c1-7a6e-7cc3-a000-000000000012', emplacement: 'HS-G01', sorte: 'gouttiere', longueur_m: 12, largeur_m: null, nombre_places: 96 }, erreurs: [], doublonDe: null },
    ]);
  });
});

describe('performance : ferme complète en moins de 15 s', () => {
  it(
    'ferme au volume de T07 exportée par T15, puis 30 000 séries en Windows-1252',
    () => {
      const ferme = fermeComplete();
      const fichiers = preparerExport({ fermeId: ferme.fermeId, genereLe: '2026-09-29T06:30:00.000Z', tables: ferme.tables }).fichiers;
      const octetsDe = (chemin: string) => utf8(fichiers.find((f) => f.chemin === chemin)?.contenu ?? '');
      const emplacements = octetsDe('emplacement.csv');
      const series = octetsDe('serie.csv');
      const tableur = tableurSeries(30_000);
      const biblioFerme: Bibliotheque = { especes: ferme.especes, familles: FAMILLES };
      // Bibliothèque des tests, grossie de 200 fiches : le rapprochement parcourt toute la liste.
      const autres = Array.from({ length: 200 }, (_, i) => ({ id: `esp-autre-${String(i)}`, nom: `Plante ${String(i)}` }));
      const biblioTableur: Bibliotheque = { especes: [...ESPECES, ...autres], familles: FAMILLES };

      // Médiane de 5 préparations complètes après une d'échauffement, chacune en min(mural, CPU) (T31).
      const { mediane: duree, detail, resultat } = mesurer(
        () => ({
          p1: preparer(emplacements, biblioFerme, null),
          p2: preparer(series, biblioFerme, null),
          p3: preparer(tableur, biblioTableur, 2027),
        }),
        { echauffement: 1, mesures: 5, borneMs: BUDGET_MS },
      );
      const { p1, p2, p3 } = resultat;

      expect(p1.type).toBe('parcellaire');
      expect(p1.plan?.resume).toStrictEqual({ valides: VOLUMES.emplacements, erreurs: 0, aDecider: 0, doublons: 0, ignorees: 0 });

      expect(p2.type).toBe('series');
      const r2 = p2.plan?.resume;
      expect(r2?.erreurs).toBe(0);
      expect(r2?.aDecider).toBe(0);
      expect((r2?.valides ?? 0) + (r2?.doublons ?? 0)).toBe(VOLUMES.series);

      expect(p3.type).toBe('series');
      expect(p3.plan?.lignes).toHaveLength(30_000);
      expect(p3.plan?.resume.erreurs).toBe(0);
      // Trois noms à rapprocher (« Batavia blonde », « Tomates cerises », « Chou pommé ») : trois décisions, pas 9 000.
      expect(p3.plan?.decisions.map((d) => [d.valeur, d.lignes.length])).toStrictEqual([
        ['Batavia blonde', 3_000],
        ['Tomates cerises', 3_000],
        ['Chou pommé', 3_000],
      ]);

      expect(duree, `préparation : ${detail}`).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );
});
