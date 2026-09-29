/**
 * Classeurs .xlsx fabriqués dans les tests (T14) : archive ZIP sans compression (méthode 0, CRC
 * exacts), classeur minimal (xl/workbook.xml, ses relations, les feuilles). Sert aux cas piégés
 * (feuilles démesurées, balises géantes, partie lue deux fois) et au système de dates 1904 : rien
 * de gros n'est commité, tout est généré à l'exécution.
 */
import { utf8 } from './fixtures.ts';

// ── ZIP ──────────────────────────────────────────────────────────────────────────────────────

let tableCrc: Uint32Array | undefined;

function crc32(octets: Uint8Array): number {
  if (tableCrc === undefined) {
    tableCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tableCrc[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of octets) crc = (tableCrc[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Ecrivain {
  private readonly morceaux: Uint8Array[] = [];
  longueur = 0;

  u16(n: number): void {
    this.octets(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.octets(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  octets(o: Uint8Array): void {
    this.morceaux.push(o);
    this.longueur += o.length;
  }

  resultat(): Uint8Array {
    const sortie = new Uint8Array(this.longueur);
    let p = 0;
    for (const m of this.morceaux) {
      sortie.set(m, p);
      p += m.length;
    }
    return sortie;
  }
}

/** Archive ZIP, parties stockées sans compression, dans l'ordre donné. */
export function zip(parties: readonly (readonly [string, string | Uint8Array])[]): Uint8Array {
  const w = new Ecrivain();
  const centrales: { nom: Uint8Array; crc: number; taille: number; position: number }[] = [];
  for (const [chemin, contenu] of parties) {
    const nom = utf8(chemin);
    const donnees = typeof contenu === 'string' ? utf8(contenu) : contenu;
    const crc = crc32(donnees);
    const position = w.longueur;
    w.u32(0x04034b50);
    w.u16(20); // version
    w.u16(0x0800); // drapeaux : noms en UTF-8
    w.u16(0); // méthode : stockée
    w.u16(0); // heure
    w.u16(0x21); // date
    w.u32(crc);
    w.u32(donnees.length);
    w.u32(donnees.length);
    w.u16(nom.length);
    w.u16(0);
    w.octets(nom);
    w.octets(donnees);
    centrales.push({ nom, crc, taille: donnees.length, position });
  }
  const debutRepertoire = w.longueur;
  for (const c of centrales) {
    w.u32(0x02014b50);
    w.u16(20);
    w.u16(20);
    w.u16(0x0800);
    w.u16(0);
    w.u16(0);
    w.u16(0x21);
    w.u32(c.crc);
    w.u32(c.taille);
    w.u32(c.taille);
    w.u16(c.nom.length);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(c.position);
    w.octets(c.nom);
  }
  const tailleRepertoire = w.longueur - debutRepertoire;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(centrales.length);
  w.u16(centrales.length);
  w.u32(tailleRepertoire);
  w.u32(debutRepertoire);
  w.u16(0);
  return w.resultat();
}

// ── Classeur ─────────────────────────────────────────────────────────────────────────────────

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE_FEUILLE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const TYPE_CLASSEUR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Partie de feuille : `lignes` est le contenu de <sheetData> (des <row>…</row>). */
export function feuilleXml(lignes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}"><sheetData>${lignes}</sheetData></worksheet>`;
}

export interface OptionsClasseur {
  /** Attributs de <workbookPr> (ex. `date1904="1"`) ; absent : pas de balise workbookPr. */
  readonly workbookPr?: string;
  /** Feuilles déclarées dans l'ordre : nom et partie visée (chemin sous xl/, ex. worksheets/sheet1.xml). */
  readonly feuilles: readonly { readonly nom: string; readonly partie: string }[];
  /** Contenu de chaque partie de feuille, par chemin sous xl/. */
  readonly parties: Readonly<Record<string, string>>;
}

/** Classeur .xlsx minimal : une relation (rId1, rId2…) par feuille déclarée, même si deux visent la même partie. */
export function classeur(options: OptionsClasseur): Uint8Array {
  const pr = options.workbookPr === undefined ? '' : `<workbookPr ${options.workbookPr}/>`;
  const feuilles = options.feuilles.map((f, i) => `<sheet name="${f.nom}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('');
  const liens = options.feuilles.map((f, i) => `<Relationship Id="rId${String(i + 1)}" Type="${TYPE_FEUILLE}" Target="${f.partie}"/>`).join('');
  const parties: [string, string][] = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${TYPE_CLASSEUR}" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${NS_R}">${pr}<sheets>${feuilles}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${liens}</Relationships>`],
  ];
  for (const [chemin, contenu] of Object.entries(options.parties)) parties.push([`xl/${chemin}`, contenu]);
  return zip(parties);
}

/** Classeur d'une seule feuille « Feuil1 » dont <sheetData> contient `lignes`. */
export function classeurSimple(lignes: string, workbookPr?: string): Uint8Array {
  const base = { feuilles: [{ nom: 'Feuil1', partie: 'worksheets/sheet1.xml' }], parties: { 'worksheets/sheet1.xml': feuilleXml(lignes) } };
  return classeur(workbookPr === undefined ? base : { ...base, workbookPr });
}
