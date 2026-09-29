/**
 * Tests d'acceptation T14 — lecture d'un fichier et détection (encodage, séparateur, en-tête).
 * Contrat : ./test/contrat.ts. Fichiers : ./__fixtures__/.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerCoeur, chargerImport, type ModuleImport } from './test/contrat.ts';
import { cp1252, lireFixture, utf16, utf8 } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

describe('@planif/core réexporte le moteur d’import', () => {
  it('les fonctions du moteur et FAMILLES_PAR_DEFAUT sont dans @planif/core', async () => {
    const coeur = await chargerCoeur();
    for (const nom of ['lireCsv', 'detecterEntete', 'proposerType', 'proposerCorrespondance', 'preparerImport', 'rapprocher', 'lireDate', 'creerModele', 'appliquerModele'] as const) {
      expect(typeof coeur[nom], nom).toBe('function');
    }
    expect(Array.isArray(coeur.FAMILLES_PAR_DEFAUT)).toBe(true);
  });

  it('le lecteur Excel n’est PAS dans @planif/core ni dans le module d’import : il se charge à part', async () => {
    const coeur = await chargerCoeur();
    expect('lecteurXlsx' in coeur).toBe(false);
    expect('lecteurXlsx' in m).toBe(false);
  });
});

describe('decoderTexte : encodage', () => {
  it('UTF-8 avec BOM : BOM retiré, signalé', () => {
    expect(m.decoderTexte(utf8('\uFEFFZone;Planche\r\n'))).toStrictEqual({ texte: 'Zone;Planche\r\n', encodage: 'utf-8', bom: true });
  });

  it('UTF-8 sans BOM avec accents', () => {
    expect(m.decoderTexte(utf8('Variété;Début récolte'))).toStrictEqual({ texte: 'Variété;Début récolte', encodage: 'utf-8', bom: false });
  });

  it('Windows-1252 : « é » en 0xE9, €, ’, œ, Œ', () => {
    const octets = new Uint8Array([0x50, 0x72, 0xe9, 0x3b, 0x80, 0x3b, 0x92, 0x3b, 0x9c, 0x3b, 0x8c]);
    expect(m.decoderTexte(octets)).toStrictEqual({ texte: 'Pré;€;’;œ;Œ', encodage: 'windows-1252', bom: false });
  });

  it('Windows-1252 : octets non définis rendus tels quels (U+0081…), comme le WHATWG', () => {
    expect(m.decoderTexte(new Uint8Array([0x41, 0x81, 0x8d, 0x8f, 0x90, 0x9d])).texte).toBe('A\u0081\u008d\u008f\u0090\u009d');
  });

  it('BOM UTF-8 suivi d’octets Windows-1252 : décodé en Windows-1252, BOM retiré du texte', () => {
    const octets = new Uint8Array([0xef, 0xbb, 0xbf, 0x50, 0x72, 0xe9, 0x3b, 0x80]);
    expect(m.decoderTexte(octets)).toStrictEqual({ texte: 'Pré;€', encodage: 'windows-1252', bom: true });
  });

  it('ASCII pur → utf-8 ; vide → texte vide', () => {
    expect(m.decoderTexte(utf8('a;b')).encodage).toBe('utf-8');
    expect(m.decoderTexte(new Uint8Array(0))).toStrictEqual({ texte: '', encodage: 'utf-8', bom: false });
  });

  it('le fichier Excel Windows-1252 du jeu de test est reconnu comme tel', async () => {
    const d = m.decoderTexte(await lireFixture('parcellaire-3-niveaux-cp1252.csv'));
    expect(d.encodage).toBe('windows-1252');
    expect(d.texte).toContain('N° planche');
    expect(d.texte).toContain('Îlot Pré-Clos');
  });
});

describe('decoderTexte et lireCsv : UTF-16 avec BOM, l’export « Texte Unicode » d’Excel (2e relecture)', () => {
  const TEXTE = 'Zone\tPlanche\tNote\r\nPré-Clos\tP1\tsemis 🌱\r\nŒillets\tP2\t\r\n';

  it.each([
    ['le', 'utf-16le'],
    ['be', 'utf-16be'],
  ] as const)('UTF-16 %s : décodé, paires de substitution comprises, BOM retiré', (ordre, encodage) => {
    expect(m.decoderTexte(utf16(TEXTE, ordre))).toStrictEqual({ texte: TEXTE, encodage, bom: true });
  });

  it.each([
    ['le', 'utf-16le'],
    ['be', 'utf-16be'],
  ] as const)('lireCsv en UTF-16 %s : tabulations, pas un fichier binaire malgré les octets nuls', (ordre, encodage) => {
    expect(m.lireCsv(utf16(TEXTE, ordre))).toStrictEqual({
      encodage,
      bom: true,
      separateur: '\t',
      lignes: [
        ['Zone', 'Planche', 'Note'],
        ['Pré-Clos', 'P1', 'semis 🌱'],
        ['Œillets', 'P2', ''],
      ],
      erreur: null,
    });
  });
});

describe('detecterSeparateur', () => {
  it('point-virgule, même avec des virgules décimales partout', () => {
    expect(m.detecterSeparateur('Zone;Long. (m);Larg. (m)\r\nA;32,5;0,8\r\nB;12,25;1,2\r\n')).toBe(';');
  });

  it('virgule, même avec des champs entre guillemets qui contiennent des virgules', () => {
    expect(m.detecterSeparateur('Planche,Culture,Note\n"N1","Tomate","rouge, ronde"\nN2,Chou,\n')).toBe(',');
  });

  it('tabulation', () => {
    expect(m.detecterSeparateur('Culture\tPlanche\tSemis\nLaitue\tN1\tS10\n')).toBe('\t');
  });

  it('une seule colonne → point-virgule', () => {
    expect(m.detecterSeparateur('Planche\nN1\nN2\n')).toBe(';');
  });
});

describe('lireCsv', () => {
  it('RFC 4180 : guillemets, guillemets doublés, séparateur et retour à la ligne dans un champ', () => {
    const csv = m.lireCsv(utf8('Planche;Note\r\nN1;"a;b ""c""\r\nsuite"\r\nN2;\r\n'));
    expect(csv.separateur).toBe(';');
    expect(csv.lignes).toStrictEqual([
      ['Planche', 'Note'],
      ['N1', 'a;b "c"\r\nsuite'],
      ['N2', ''],
    ]);
  });

  it('fins de ligne LF, CR ou CRLF ; pas de ligne vide ajoutée par la dernière fin de ligne', () => {
    expect(m.lireCsv(utf8('a;b\nc;d\n')).lignes).toStrictEqual([['a', 'b'], ['c', 'd']]);
    expect(m.lireCsv(utf8('a;b\rc;d')).lignes).toStrictEqual([['a', 'b'], ['c', 'd']]);
    expect(m.lireCsv(utf8('a;b\r\nc;d\r\n')).lignes).toStrictEqual([['a', 'b'], ['c', 'd']]);
  });

  it('une ligne « ;;; » donne des champs vides, gardée (c’est le plan qui l’ignore)', () => {
    expect(m.lireCsv(utf8('a;b;c\r\n;;\r\nd;e;f\r\n')).lignes).toStrictEqual([['a', 'b', 'c'], ['', '', ''], ['d', 'e', 'f']]);
  });

  it('lignes vides en fin de fichier (champs vides ou espaces) : ni créées ni rendues (2e relecture, point 3)', () => {
    expect(m.lireCsv(utf8('a;b;c\r\n;;\r\nd;e;f\r\n;;\r\n  ; ;\r\n\r\n;;')).lignes).toStrictEqual([['a', 'b', 'c'], ['', '', ''], ['d', 'e', 'f']]);
    expect(m.lireCsv(utf8('\n\n\n')).lignes).toStrictEqual([]);
  });

  it('guillemet jamais fermé : pas d’exception, le reste est le dernier champ', () => {
    const csv = m.lireCsv(utf8('a;b\r\nc;"d\r\ne;f\r\n'));
    expect(csv.lignes[0]).toStrictEqual(['a', 'b']);
    expect(csv.lignes[1]?.[0]).toBe('c');
    expect(csv.lignes[1]?.[1]).toContain('d');
  });

  it('parcellaire en Windows-1252, « ; », virgules décimales, CRLF', async () => {
    const csv = m.lireCsv(await lireFixture('parcellaire-3-niveaux-cp1252.csv'));
    expect(csv).toMatchObject({ encodage: 'windows-1252', bom: false, separateur: ';' });
    expect(csv.lignes).toHaveLength(9);
    expect(csv.lignes[0]).toStrictEqual(['Zone', 'Chapelle', 'N° planche', 'Long. (m)', 'Larg. (cm)', 'Abri']);
    expect(csv.lignes[1]).toStrictEqual(['Serre multichapelle', 'Chapelle 1', 'C1-P1', '32,5', '80', 'serre']);
    expect(csv.lignes[6]).toStrictEqual(['Îlot Pré-Clos', '', 'PC-01', '48', '120', 'plein champ']);
  });

  it('séries en UTF-8 avec BOM et tabulations', async () => {
    const csv = m.lireCsv(await lireFixture('series-semaines.tsv'));
    expect(csv).toMatchObject({ encodage: 'utf-8', bom: true, separateur: '\t' });
    expect(csv.lignes[0]).toStrictEqual(['Culture', 'Variété', 'Planche', 'Semis', 'Plantation', 'Début récolte', 'Longueur (m)']);
    expect(csv.lignes[3]).toStrictEqual(['Tomate', 'Cœur de bœuf', 'TA1', '', 'S18', 'S28', '25,5']);
  });

  it('en-têtes anglais, virgule, UTF-8 sans BOM, fins de ligne LF', async () => {
    const csv = m.lireCsv(await lireFixture('parcellaire-anglais.csv'));
    expect(csv).toMatchObject({ encodage: 'utf-8', bom: false, separateur: ',' });
    expect(csv.lignes).toHaveLength(5);
    expect(csv.lignes[3]).toStrictEqual(['Tunnel A', 'TA1', '25.5', '1.2', 'tunnel']);
  });

  it('assolement : virgule, champs entre guillemets contenant des virgules', async () => {
    const csv = m.lireCsv(await lireFixture('assolement-passe.csv'));
    expect(csv.separateur).toBe(',');
    expect(csv.lignes[1]).toStrictEqual(['Bonne année, peu de maladies', '2024', 'Solanacées', 'TA1', 'Tomate', '420', '']);
    expect(csv.lignes[2]?.[6]).toBe('hernie, à surveiller');
  });

  it('export T15 : BOM, « ; », 14 colonnes', async () => {
    const csv = m.lireCsv(await lireFixture('t15-emplacement.csv'));
    expect(csv).toMatchObject({ encodage: 'utf-8', bom: true, separateur: ';' });
    expect(csv.lignes[0]?.[0]).toBe('id');
    expect(csv.lignes.every((l) => l.length === 14)).toBe(true);
  });

  it('fichier texte : pas d’erreur', async () => {
    expect(m.lireCsv(utf8('a;b\r\nc;d\r\n')).erreur).toBeNull();
    expect(m.lireCsv(await lireFixture('parcellaire-3-niveaux-cp1252.csv')).erreur).toBeNull();
    expect(m.lireCsv(new Uint8Array(0)).erreur).toBeNull();
  });

  it('classeur .xlsx déposé comme CSV (signature ZIP) → fichier_binaire, aucune ligne', async () => {
    for (const octets of [await lireFixture('series-titre.xlsx'), new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x41, 0x3b, 0x42])]) {
      const csv = m.lireCsv(octets);
      expect(csv.erreur?.code).toBe('fichier_binaire');
      expect(csv.erreur?.message.trim().length).toBeGreaterThan(10);
      expect(csv.lignes).toStrictEqual([]);
    }
  });

  it('octet nul (fichier binaire, UTF-16…) → fichier_binaire, aucune ligne', () => {
    const csv = m.lireCsv(new Uint8Array([0x5a, 0x6f, 0x6e, 0x65, 0x3b, 0x00, 0x50, 0x0d, 0x0a]));
    expect(csv.erreur?.code).toBe('fichier_binaire');
    expect(csv.lignes).toStrictEqual([]);
  });

  it('même octets → même résultat ; ne lève jamais sur des octets au hasard', () => {
    let graine = 42;
    const octets = new Uint8Array(4_000).map(() => {
      graine = (graine * 1_103_515_245 + 12_345) % 2_147_483_648;
      return graine % 256;
    });
    expect(() => m.lireCsv(octets)).not.toThrow();
    expect(m.lireCsv(octets)).toStrictEqual(m.lireCsv(octets));
  });
});

describe('detecterEntete : sauter la ligne de titre', () => {
  it('en-tête en première ligne', async () => {
    for (const nom of ['parcellaire-anglais.csv', 'parcellaire-3-niveaux-cp1252.csv', 'series-semaines.tsv', 'cultures-itineraires.csv', 'assolement-passe.csv', 'modele-a.csv', 't15-emplacement.csv'] as const) {
      expect(m.detecterEntete(m.lireCsv(await lireFixture(nom)).lignes), nom).toBe(0);
    }
  });

  it('titre et ligne vide au-dessus des en-têtes → en-tête en troisième ligne', () => {
    const lignes = [
      ['Plan de culture 2027 — Ferme de Benoît', null, null],
      [],
      ['Culture', 'N° planche', 'Date semis'],
      ['Radis', 'N3', 46461],
    ];
    expect(m.detecterEntete(lignes)).toBe(2);
  });

  it('titre en Windows-1252 au-dessus d’un CSV', () => {
    const lignes = m.lireCsv(cp1252('Parcellaire de la ferme – mars 2027;;\r\n;;\r\nZone;Planche;Longueur\r\nT1;P1;30\r\n')).lignes;
    expect(m.detecterEntete(lignes)).toBe(2);
  });

  it('aucun en-tête reconnu : la première ligne d’au moins deux textes', () => {
    expect(m.detecterEntete([['Mon fichier'], ['Truc', 'Machin'], ['1', '2']])).toBe(1);
  });

  it('feuille vide → null', () => {
    expect(m.detecterEntete([])).toBeNull();
    expect(m.detecterEntete([[], [null, ''], ['']])).toBeNull();
  });
});
