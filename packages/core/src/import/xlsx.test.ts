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

describe('lecteurXlsx.lire : entités XML, échappements OOXML, cellules de plus de 32 767 caractères (2e relecture, point 1)', () => {
  const SST = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const enLigne = (texte: string) => `<c r="A1" t="inlineStr"><is><t>${texte}</t></is></c>`;

  /** Première cellule d'un classeur dont A1 est une chaîne en ligne, B1 la chaîne partagée 0. */
  function avecChaines(ligne: string, chaine: string): Uint8Array {
    return classeur({
      feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
      parties: {
        'worksheets/sheet1.xml': feuilleXml(`<row r="1">${ligne}</row>`),
        'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${SST}"><si><t>${chaine}</t></si></sst>`,
      },
    });
  }

  it('entités nommées et numériques (décimales, hexadécimales), dans une chaîne en ligne et une chaîne partagée', async () => {
    const texte = 'Pois &amp; f&#232;ves &#xE9;t&#xe9; &lt;b&gt; &quot;x&quot; &apos;y&apos; &#x1F331;';
    const f = feuilles(await lecteur.lire(avecChaines(`${enLigne(texte)}<c r="B1" t="s"><v>0</v></c>`, texte)));
    const attendu = 'Pois & fèves été <b> "x" \'y\' 🌱';
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([[attendu, attendu]]);
  });

  it('échappements OOXML : « _x0041_ » → « A », « _x000D_ » → retour chariot, « _x005F_x0041_ » → « _x0041_ »', async () => {
    const texte = 'Planche_x0020_B_x0041__x000D_ fin _x005F_x0041_';
    const f = feuilles(await lecteur.lire(avecChaines(`${enLigne(texte)}<c r="B1" t="s"><v>0</v></c>`, texte)));
    const attendu = 'Planche BA\r fin _x0041_';
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([[attendu, attendu]]);
  });

  it('32 767 caractères (la limite d’Excel) : lu ; 32 768 : classeur_illisible, en ligne comme partagée', async () => {
    const limite = 'a'.repeat(32_767);
    const f = feuilles(await lecteur.lire(avecChaines(`${enLigne(limite)}<c r="B1" t="s"><v>0</v></c>`, limite)));
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([[limite, limite]]);
    const trop = `${limite}a`;
    expect(await lecteur.lire(avecChaines(enLigne(trop), 'ok'))).toMatchObject({ ok: false, code: 'classeur_illisible' });
    expect(await lecteur.lire(avecChaines('<c r="B1" t="s"><v>0</v></c>', trop))).toMatchObject({ ok: false, code: 'classeur_illisible' });
  });

  it('la limite porte sur le texte décodé : 32 767 « &amp; » passent (« & » × 32 767), 32 768 non', async () => {
    const f = feuilles(await lecteur.lire(avecChaines(enLigne('&amp;'.repeat(32_767)), 'ok')));
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([['&'.repeat(32_767)]]);
    expect(await lecteur.lire(avecChaines(enLigne('&amp;'.repeat(32_768)), 'ok'))).toMatchObject({ ok: false, code: 'classeur_illisible' });
    expect(await lecteur.lire(avecChaines(enLigne('_x0041_'.repeat(32_768)), 'ok'))).toMatchObject({ ok: false, code: 'classeur_illisible' });
  });
});

// ── 3e relecture ─────────────────────────────────────────────────────────────────────────────

describe('lecteurXlsx.lire : toute valeur de cellule de plus de 32 767 caractères → classeur_illisible (3e relecture, point 3)', () => {
  const unique = (cellule: string) => classeurSimple(`<row r="1">${cellule}</row>`);
  const TROP = 32_768;

  it.each([
    ['nombre (sans type)', `<c r="A1"><v>${'1'.repeat(TROP)}</v></c>`],
    ['nombre t="n"', `<c r="A1" t="n"><v>${'1'.repeat(TROP)}</v></c>`],
    ['erreur t="e"', `<c r="A1" t="e"><v>#${'N'.repeat(TROP)}</v></c>`],
    ['date t="d"', `<c r="A1" t="d"><v>${'x'.repeat(TROP)}</v></c>`],
    ['booléen t="b"', `<c r="A1" t="b"><v>${'1'.repeat(TROP)}</v></c>`],
    ['texte de formule t="str"', `<c r="A1" t="str"><f>A2</f><v>${'x'.repeat(TROP)}</v></c>`],
  ])('%s', async (_cas, cellule) => {
    expect(await lecteur.lire(unique(cellule))).toMatchObject({ ok: false, code: 'classeur_illisible' });
  });

  it('date t="d" de 32 767 caractères qui n’est pas une date : lue, texte tel quel', async () => {
    const texte = 'x'.repeat(32_767);
    const f = feuilles(await lecteur.lire(unique(`<c r="A1" t="d"><v>${texte}</v></c>`)));
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([[texte]]);
  });
});

describe('lecteurXlsx.lire : références numériques qui ne sont pas des caractères XML → classeur_illisible (3e relecture)', () => {
  const SST = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const enLigne = (texte: string) => classeurSimple(`<row r="1"><c r="A1" t="inlineStr"><is><t>${texte}</t></is></c></row>`);
  const partagee = (texte: string) =>
    classeur({
      feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }],
      parties: {
        'worksheets/sheet1.xml': feuilleXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'),
        'sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${SST}"><si><t>${texte}</t></si></sst>`,
      },
    });

  it.each([
    ['&#0;', 'a&#0;b'],
    ['&#x0;', 'a&#x0;b'],
    ['&#xD800; (moitié haute isolée)', 'a&#xD800;b'],
    ['&#xDFFF; (moitié basse isolée)', 'a&#xDFFF;b'],
    ['&#55296; (D800 en décimal)', 'a&#55296;b'],
    ['&#xD83D;&#xDE00; (paire écrite en deux références)', '&#xD83D;&#xDE00;'],
  ])('%s, en ligne comme partagée', async (_cas, texte) => {
    expect(await lecteur.lire(enLigne(texte))).toMatchObject({ ok: false, code: 'classeur_illisible' });
    expect(await lecteur.lire(partagee(texte))).toMatchObject({ ok: false, code: 'classeur_illisible' });
  });

  it('&#x1F600; (émoji en une seule référence) reste lu', async () => {
    const f = feuilles(await lecteur.lire(enLigne('a&#x1F600;b')));
    expect(sansFinFeuille(f[0]?.lignes ?? [])).toStrictEqual([['a😀b']]);
  });
});
