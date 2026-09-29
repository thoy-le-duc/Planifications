/**
 * Tests d'acceptation T16 — polices hébergées avec l'appli (docs/backlog/T16-design.md).
 *
 * Contrat :
 *   - fichiers woff2 sous apps/web/public/polices/ (servis à /polices/…, même origine), sous-ensemble
 *     latin (français compris : é è à ç œ ’ « » ·), nommés par famille :
 *       archivo*.woff2                 (titres ; largeur 112 %, graisses 600 à 800)
 *       atkinson-hyperlegible*.woff2   (texte ; 400 et 700)
 *       ibm-plex-mono*.woff2           (codes de planche ; 500 et 600)
 *     chacun ≤ 120 Kio, l'ensemble ≤ 300 Kio (sous-ensemble, pas les polices complètes) ;
 *   - Archivo (relecture, point 8) : un seul fichier archivo*.woff2, ≤ 30 Kio (30 720 octets),
 *     réduit à ce que les titres emploient : axe de largeur figé à 112 % (plus d'axe wdth dans
 *     fvar, et OS/2 usWidthClass = 6, « semi-expanded » : 112,5 %), axe de graisse restreint
 *     (wght : minimum entre 600 et 700, maximum 800). Les intitulés de section passent en
 *     Atkinson Hyperlegible 700 majuscules (e2e/habillage.e2e.ts) : pas de second fichier Archivo ;
 *   - la licence SIL OFL des polices les accompagne (fichier OFL* ou LICEN[CS]E* dans le dossier) ;
 *   - @font-face (dans une feuille de style servie par l'appli) avec `font-display: swap`,
 *     `src: url(/polices/….woff2) format('woff2')` : vérifié dans le navigateur par
 *     e2e/polices.e2e.ts (document.fonts), comme la mise en cache par le service worker ;
 *   - aucune référence à Google Fonts (fonts.googleapis.com, fonts.gstatic.com) dans l'appli.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const RACINE_WEB = join(import.meta.dirname, '..', '..');
const DOSSIER_POLICES = join(RACINE_WEB, 'public', 'polices');

const FAMILLES = ['archivo', 'atkinson-hyperlegible', 'ibm-plex-mono'] as const;
const MAX_FICHIER_KIO = 120;
const MAX_TOTAL_KIO = 300;
const MAX_ARCHIVO_OCTETS = 30 * 1024;

function woff2(): string[] {
  if (!existsSync(DOSSIER_POLICES)) return [];
  return readdirSync(DOSSIER_POLICES).filter((n) => n.endsWith('.woff2'));
}

describe('polices hébergées (public/polices/)', () => {
  it('un woff2 au moins par famille : Archivo, Atkinson Hyperlegible, IBM Plex Mono', () => {
    const fichiers = woff2();
    for (const famille of FAMILLES) {
      expect(
        fichiers.filter((n) => new RegExp(`^${famille}[-.a-z0-9]*\\.woff2$`).test(n)),
        `public/polices/${famille}*.woff2`,
      ).not.toHaveLength(0);
    }
  });

  it('de vrais woff2 (signature wOF2), en sous-ensemble : ≤ 120 Kio chacun, ≤ 300 Kio en tout', () => {
    const fichiers = woff2();
    expect(fichiers.length).toBeGreaterThan(0);
    let total = 0;
    for (const nom of fichiers) {
      const octets = readFileSync(join(DOSSIER_POLICES, nom));
      expect(octets.subarray(0, 4).toString('latin1'), `${nom} : signature`).toBe('wOF2');
      const kio = octets.length / 1024;
      expect(kio, `${nom} : ${kio.toFixed(1)} Kio`).toBeLessThanOrEqual(MAX_FICHIER_KIO);
      total += kio;
    }
    expect(total, `total ${total.toFixed(1)} Kio`).toBeLessThanOrEqual(MAX_TOTAL_KIO);
  });

  it('la licence (SIL OFL) accompagne les polices', () => {
    const presents = existsSync(DOSSIER_POLICES) ? readdirSync(DOSSIER_POLICES) : [];
    expect(presents.some((n) => /^(OFL|LICEN[CS]E)/i.test(n))).toBe(true);
  });
});

// ── Lecture minimale d'un woff2 (spécification W3C WOFF 2.0, §5) : tables fvar et OS/2 ────────

/** Étiquettes connues du répertoire des tables (indice sur 6 bits ; 63 : étiquette écrite en clair). */
const ETIQUETTES_CONNUES = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const;

/** Tables décompressées d'un woff2 (une seule police, pas de collection), par étiquette. */
function tablesWoff2(octets: Buffer): Map<string, Buffer> {
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const o = octets.readUInt8(p++);
      v = v * 128 + (o & 0x7f);
      if ((o & 0x80) === 0) return v;
    }
    throw new Error('UIntBase128 invalide');
  };
  const repertoire: { etiquette: string; longueur: number }[] = [];
  for (let t = 0, n = octets.readUInt16BE(12); t < n; t++) {
    const drapeaux = octets.readUInt8(p++);
    const indice = drapeaux & 0x3f;
    let etiquette: string;
    if (indice === 63) {
      etiquette = octets.subarray(p, p + 4).toString('latin1');
      p += 4;
    } else etiquette = ETIQUETTES_CONNUES[indice] ?? '????';
    const version = (drapeaux >> 6) & 3;
    const origine = base128();
    // glyf et loca : transformées en version 0 ; les autres, en version non nulle.
    const transformee = etiquette === 'glyf' || etiquette === 'loca' ? version === 0 : version !== 0;
    repertoire.push({ etiquette, longueur: transformee ? base128() : origine });
  }
  const flux = brotliDecompressSync(octets.subarray(p, p + octets.readUInt32BE(20)));
  const tables = new Map<string, Buffer>();
  let decalage = 0;
  for (const { etiquette, longueur } of repertoire) {
    tables.set(etiquette, flux.subarray(decalage, decalage + longueur));
    decalage += longueur;
  }
  return tables;
}

interface Axe {
  readonly etiquette: string;
  readonly min: number;
  readonly defaut: number;
  readonly max: number;
}

/** Axes de variation (table fvar) ; [] pour une police statique. */
function axes(tables: Map<string, Buffer>): Axe[] {
  const f = tables.get('fvar');
  if (f === undefined) return [];
  const debut = f.readUInt16BE(4);
  const taille = f.readUInt16BE(10);
  const fixe = (o: number) => f.readInt32BE(o) / 65536;
  return Array.from({ length: f.readUInt16BE(8) }, (_, i) => {
    const o = debut + i * taille;
    return { etiquette: f.subarray(o, o + 4).toString('latin1'), min: fixe(o + 4), defaut: fixe(o + 8), max: fixe(o + 12) };
  });
}

describe('Archivo : un seul fichier léger, largeur 112 %, graisses 600 à 800 (relecture, point 8)', () => {
  const archivo = woff2().filter((n) => /^archivo[-.a-z0-9]*\.woff2$/.test(n));

  it('un seul fichier archivo*.woff2, ≤ 30 Kio', () => {
    expect(archivo).toHaveLength(1);
    for (const nom of archivo) {
      const octets = statSync(join(DOSSIER_POLICES, nom)).size;
      expect(octets, `${nom} : ${(octets / 1024).toFixed(1)} Kio`).toBeLessThanOrEqual(MAX_ARCHIVO_OCTETS);
    }
  });

  it('largeur figée à 112 % (plus d’axe wdth, usWidthClass 6), graisse de 600–700 à 800', () => {
    expect(archivo).toHaveLength(1);
    for (const nom of archivo) {
      const tables = tablesWoff2(readFileSync(join(DOSSIER_POLICES, nom)));
      const lus = axes(tables);
      expect(lus.map((a) => a.etiquette), `${nom} : axes`).not.toContain('wdth');
      const os2 = tables.get('OS/2');
      expect(os2, `${nom} : table OS/2`).toBeDefined();
      expect(os2?.readUInt16BE(6), `${nom} : usWidthClass`).toBe(6);
      const graisse = lus.find((a) => a.etiquette === 'wght');
      expect(graisse, `${nom} : axe wght (700 et 800 dans un seul fichier)`).toBeDefined();
      expect(graisse?.min ?? 0, `${nom} : graisse minimale`).toBeGreaterThanOrEqual(600);
      expect(graisse?.min ?? 1000, `${nom} : graisse minimale`).toBeLessThanOrEqual(700);
      expect(graisse?.max, `${nom} : graisse maximale`).toBe(800);
    }
  });
});

function fichiers(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    if (!/\.(tsx?|css|html|json|webmanifest)$/.test(nom) || /\.test\.tsx?$/.test(nom)) return [];
    return [chemin];
  });
}

describe('aucune police tierce', () => {
  it('ni fonts.googleapis.com ni fonts.gstatic.com dans index.html, src/ et public/', () => {
    const tous = [join(RACINE_WEB, 'index.html'), ...fichiers(join(RACINE_WEB, 'src')), ...fichiers(join(RACINE_WEB, 'public'))];
    const fautes = tous.filter((f) => /fonts\.(googleapis|gstatic)\.com/i.test(readFileSync(f, 'utf8'))).map((f) => relative(RACINE_WEB, f));
    expect(fautes).toEqual([]);
  });
});
