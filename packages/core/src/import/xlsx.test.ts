/**
 * Tests d'acceptation T14 — lecteur Excel (.xlsx), chargé à part (src/import/xlsx.ts).
 * Contrat : ./test/contrat.ts, « Lecteur Excel ». Fichier : __fixtures__/series-titre.xlsx,
 * un vrai classeur (chaînes partagées dans la première feuille, chaînes en ligne dans la seconde,
 * titre fusionné, vraies dates Excel). Classeurs fabriqués dans le test (./test/classeur.ts) pour
 * le système de dates 1904, les cellules `t="d"` et les parties lues deux fois ; les classeurs
 * piégés (feuilles démesurées, balises géantes) sont dans robustesse.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { classeur, classeurSimple, feuilleXml } from './test/classeur.ts';
import { chargerXlsx, type LecteurClasseur, type ResultatClasseur } from './test/contrat.ts';
import { lireFixture, sansFinFeuille, utf8 } from './test/fixtures.ts';

let lecteur: LecteurClasseur;

beforeAll(async () => {
  lecteur = (await chargerXlsx()).lecteurXlsx;
});

describe('lecteurXlsx.lire', () => {
  it('feuilles dans l’ordre du classeur, avec leur nom ; lignes et colonnes comme dans Excel', async () => {
    const r = await lecteur.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(`classeur illisible : ${r.message}`);
    expect(r.feuilles.map((f) => f.nom)).toStrictEqual(['Séries 2027', 'Notes']);
    expect(sansFinFeuille(r.feuilles[0]?.lignes ?? [])).toStrictEqual([
      ['Plan de culture 2027 — Ferme de Benoît'],
      [],
      ['Culture', 'Variété', 'N° planche', 'Date semis', 'Date plantation', 'Début récolte', 'Fin récolte', 'Longueur'],
      ['Radis', 'Flamboyant 5', 'N3', 46461, null, 46496, 46517, 30],
      ['Épinard', "Géant d'hiver", 'N4', '15/03/2027', null, 46517, 46539, '1500 cm'],
      ['Tomate', 'Cœur de bœuf', 'TA2', null, 46517, 46583, null, 25.5],
      [],
      ['Total', null, null, null, null, null, null, 85.5],
    ]);
  });

  it('seconde feuille (chaînes en ligne)', async () => {
    const r = await lecteur.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(r.message);
    expect(sansFinFeuille(r.feuilles[1]?.lignes ?? [])).toStrictEqual([['Semences commandées chez Voltz'], [12]]);
  });

  it('classeur au système de dates 1900 (celui d’Excel sous Windows) : chaque feuille le dit', async () => {
    const r = await lecteur.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(r.message);
    expect(r.feuilles.map((f) => f.systemeDates)).toStrictEqual([1900, 1900]);
  });

  it('ce qui n’est pas un classeur : résultat en échec, jamais de rejet', async () => {
    const cas = [new Uint8Array(0), utf8('Zone;Planche\r\nT1;P1\r\n'), new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), await lireFixture('parcellaire-anglais.csv')];
    for (const octets of cas) {
      const r = await lecteur.lire(octets);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('classeur_illisible');
        expect(r.message.trim().length).toBeGreaterThan(5);
      }
    }
  });

  it('classeur tronqué : échec, pas d’exception', async () => {
    const octets = await lireFixture('series-titre.xlsx');
    const r = await lecteur.lire(octets.slice(0, Math.floor(octets.length / 2)));
    expect(r.ok).toBe(false);
  });

  it('ne modifie pas les octets reçus', async () => {
    const octets = await lireFixture('series-titre.xlsx');
    const copie = octets.slice();
    await lecteur.lire(octets);
    expect(octets).toStrictEqual(copie);
  });
});

function feuilles(r: ResultatClasseur) {
  if (!r.ok) throw new Error(`classeur illisible : ${r.message}`);
  return r.feuilles;
}

describe('lecteurXlsx.lire : système de dates 1904 (relecture, point 6)', () => {
  const LIGNE = '<row r="1"><c r="A1" t="inlineStr"><is><t>Plantation</t></is></c></row><row r="2"><c r="A2"><v>44999</v></c></row>';

  it.each([
    ['date1904="1"', 1904],
    ['date1904="true"', 1904],
    ['date1904="0"', 1900],
    ['date1904="false"', 1900],
    ['defaultThemeVersion="164011"', 1900],
    [undefined, 1900],
  ] as const)('<workbookPr %s> → %d ; les numéros de série restent tels qu’écrits', async (pr, systeme) => {
    const f = feuilles(await lecteur.lire(classeurSimple(LIGNE, pr)));
    expect(f).toHaveLength(1);
    expect(f[0]?.systemeDates).toBe(systeme);
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([['Plantation'], [44999]]);
  });
});

describe('lecteurXlsx.lire : cellules date ISO t="d"', () => {
  it('« 2027-03-15T00:00:00 » et « 2027-03-16 » → « AAAA-MM-JJ » ; autre contenu → texte tel quel', async () => {
    const xml = '<row r="1"><c r="A1" t="d"><v>2027-03-15T00:00:00</v></c><c r="B1" t="d"><v>2027-03-16</v></c><c r="C1" t="d"><v>2027-03-17T08:30:00.000</v></c><c r="D1" t="d"><v>bientôt</v></c></row>';
    const f = feuilles(await lecteur.lire(classeurSimple(xml)));
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([['2027-03-15', '2027-03-16', '2027-03-17', 'bientôt']]);
  });
});

describe('lecteurXlsx.lire : une partie n’est lue qu’une fois (relecture, point 1)', () => {
  it('deux feuilles qui visent la même partie → classeur_illisible', async () => {
    const r = await lecteur.lire(
      classeur({
        feuilles: [
          { nom: 'A', partie: 'worksheets/sheet1.xml' },
          { nom: 'B', partie: 'worksheets/sheet1.xml' },
        ],
        parties: { 'worksheets/sheet1.xml': feuilleXml('<row r="1"><c r="A1"><v>1</v></c></row>') },
      }),
    );
    expect(r).toMatchObject({ ok: false, code: 'classeur_illisible' });
  });

  it('deux feuilles sur deux parties distinctes : lues toutes les deux', async () => {
    const f = feuilles(
      await lecteur.lire(
        classeur({
          feuilles: [
            { nom: 'A', partie: 'worksheets/sheet1.xml' },
            { nom: 'B', partie: 'worksheets/sheet2.xml' },
          ],
          parties: {
            'worksheets/sheet1.xml': feuilleXml('<row r="1"><c r="A1"><v>1</v></c></row>'),
            'worksheets/sheet2.xml': feuilleXml('<row r="1"><c r="A1"><v>2</v></c></row>'),
          },
        }),
      ),
    );
    expect(f.map((x) => [x.nom, sansFinFeuille(x.lignes)])).toStrictEqual([
      ['A', [[1]]],
      ['B', [[2]]],
    ]);
  });
});
