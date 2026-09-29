/**
 * Archive ZIP (APPNOTE de PKWARE), synchrone et pure (T15) : entrées stockées sans compression,
 * noms en UTF-8 (bit 11), CRC-32 calculé pendant l'encodage, même entrée → mêmes octets.
 *
 * Le cœur n'a ni Node ni DOM (ni Buffer, ni TextEncoder) : l'UTF-8 est encodé ici, directement
 * dans l'archive finale, sans copie intermédiaire. Compression : ticket suivant.
 */

export interface FichierZip {
  readonly chemin: string;
  readonly contenu: string | Uint8Array;
}

export interface OptionsZip {
  /** 'AAAA-MM-JJ' : date DOS de chaque entrée, à 00:00 ; 1980-01-01 par défaut. */
  readonly date?: string;
}

const EN_TETE_LOCAL = 30;
const EN_TETE_CENTRAL = 46;
const FIN_REPERTOIRE = 22;
/** Version 2.0 : suffisante pour des entrées stockées et le bit UTF-8. */
const VERSION = 20;
const DRAPEAU_UTF8 = 0x0800;
const MAX_32 = 0xffffffff;

let tableCrc: Int32Array | undefined;

/** Table du CRC-32 (polynôme 0xEDB88320), calculée au premier export : rien au chargement du module. */
function crcTable(): Int32Array {
  if (tableCrc !== undefined) return tableCrc;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  tableCrc = t;
  return t;
}

/** Octets UTF-8 d'un texte ; une moitié de paire de substitution isolée compte pour U+FFFD. */
function longueurUtf8(texte: string): number {
  let n = texte.length;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length && (texte.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 2; // 4 octets pour 2 unités UTF-16
      i++;
    } else n += 2;
  }
  return n;
}

/**
 * Encode `texte` en UTF-8 dans `sortie` à partir de `debut`, comme TextEncoder (moitié de paire
 * de substitution isolée → U+FFFD), et rend le CRC-32 des octets écrits. Encodage et CRC dans
 * la même boucle : les octets sont lus pendant qu'ils sont encore en cache (mesuré : nettement
 * plus rapide que deux passes sur une archive de 37 Mio).
 */
function ecrireUtf8(texte: string, sortie: Uint8Array, debut: number): number {
  const t = crcTable();
  let crc = -1;
  let p = debut;
  const n = texte.length;
  for (let i = 0; i < n; i++) {
    let c = texte.charCodeAt(i);
    if (c < 0x80) {
      sortie[p++] = c;
      crc = (t[(crc ^ c) & 0xff] ?? 0) ^ (crc >>> 8);
      continue;
    }
    if (c < 0x800) {
      const o1 = 0xc0 | (c >> 6);
      const o2 = 0x80 | (c & 0x3f);
      sortie[p++] = o1;
      sortie[p++] = o2;
      crc = (t[(crc ^ o1) & 0xff] ?? 0) ^ (crc >>> 8);
      crc = (t[(crc ^ o2) & 0xff] ?? 0) ^ (crc >>> 8);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      const suivant = i + 1 < n ? texte.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && (suivant & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (suivant - 0xdc00);
        i++;
        const o1 = 0xf0 | (c >> 18);
        const o2 = 0x80 | ((c >> 12) & 0x3f);
        const o3 = 0x80 | ((c >> 6) & 0x3f);
        const o4 = 0x80 | (c & 0x3f);
        sortie[p++] = o1;
        sortie[p++] = o2;
        sortie[p++] = o3;
        sortie[p++] = o4;
        crc = (t[(crc ^ o1) & 0xff] ?? 0) ^ (crc >>> 8);
        crc = (t[(crc ^ o2) & 0xff] ?? 0) ^ (crc >>> 8);
        crc = (t[(crc ^ o3) & 0xff] ?? 0) ^ (crc >>> 8);
        crc = (t[(crc ^ o4) & 0xff] ?? 0) ^ (crc >>> 8);
        continue;
      }
      c = 0xfffd;
    }
    const o1 = 0xe0 | (c >> 12);
    const o2 = 0x80 | ((c >> 6) & 0x3f);
    const o3 = 0x80 | (c & 0x3f);
    sortie[p++] = o1;
    sortie[p++] = o2;
    sortie[p++] = o3;
    crc = (t[(crc ^ o1) & 0xff] ?? 0) ^ (crc >>> 8);
    crc = (t[(crc ^ o2) & 0xff] ?? 0) ^ (crc >>> 8);
    crc = (t[(crc ^ o3) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** Copie des octets déjà faits, et rend leur CRC-32. */
function copierOctets(source: Uint8Array, sortie: Uint8Array, debut: number): number {
  const t = crcTable();
  sortie.set(source, debut);
  let crc = -1;
  for (const o of source) crc = (t[(crc ^ o) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** Date DOS (jour à 00:00) : ((année − 1980) << 9) | (mois << 5) | jour. */
function dateDos(jour: string | undefined): number {
  if (jour === undefined) return (1 << 5) | 1;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  const annee = Number(m?.[1]);
  const mois = Number(m?.[2]);
  const j = Number(m?.[3]);
  if (m === null || annee < 1980 || annee > 2107 || mois < 1 || mois > 12 || j < 1 || j > 31) {
    throw new RangeError(`date d’archive invalide : ${jour} (attendu AAAA-MM-JJ, entre 1980 et 2107)`);
  }
  return ((annee - 1980) << 9) | (mois << 5) | j;
}

interface Entree {
  readonly nom: string;
  readonly longueurNom: number;
  readonly contenu: string | Uint8Array;
  readonly taille: number;
  crc: number;
  decalage: number;
}

/**
 * Construit une archive ZIP : en-têtes locaux, répertoire central, fin de répertoire.
 * Deux chemins identiques, ou une archive de plus de 4 Gio, lèvent une erreur.
 */
export function creerZip(fichiers: readonly FichierZip[], options: OptionsZip = {}): Uint8Array {
  const date = dateDos(options.date);
  if (fichiers.length > 0xffff) throw new RangeError('trop de fichiers pour une archive ZIP simple');

  const vus = new Set<string>();
  const entrees: Entree[] = [];
  let total = FIN_REPERTOIRE;
  for (const f of fichiers) {
    if (vus.has(f.chemin)) throw new Error(`chemin en double dans l’archive : ${f.chemin}`);
    vus.add(f.chemin);
    const longueurNom = longueurUtf8(f.chemin);
    if (longueurNom > 0xffff) throw new RangeError(`chemin trop long : ${f.chemin.slice(0, 40)}…`);
    const taille = typeof f.contenu === 'string' ? longueurUtf8(f.contenu) : f.contenu.length;
    entrees.push({ nom: f.chemin, longueurNom, contenu: f.contenu, taille, crc: 0, decalage: 0 });
    total += EN_TETE_LOCAL + EN_TETE_CENTRAL + 2 * longueurNom + taille;
  }
  if (total > MAX_32) throw new RangeError('archive de plus de 4 Gio : ZIP64 non pris en charge');

  const octets = new Uint8Array(total);
  const v = new DataView(octets.buffer);
  let p = 0;

  // Données : en-tête local, nom, contenu. Le CRC est connu après l'encodage : écrit ensuite.
  for (const e of entrees) {
    e.decalage = p;
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, VERSION, true);
    v.setUint16(p + 6, DRAPEAU_UTF8, true);
    v.setUint16(p + 8, 0, true); // stocké
    v.setUint16(p + 10, 0, true); // 00:00
    v.setUint16(p + 12, date, true);
    v.setUint32(p + 18, e.taille, true);
    v.setUint32(p + 22, e.taille, true);
    v.setUint16(p + 26, e.longueurNom, true);
    v.setUint16(p + 28, 0, true);
    ecrireUtf8(e.nom, octets, p + EN_TETE_LOCAL);
    const debut = p + EN_TETE_LOCAL + e.longueurNom;
    e.crc = typeof e.contenu === 'string' ? ecrireUtf8(e.contenu, octets, debut) : copierOctets(e.contenu, octets, debut);
    v.setUint32(p + 14, e.crc, true);
    p = debut + e.taille;
  }

  // Répertoire central.
  const debutCentral = p;
  for (const e of entrees) {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, VERSION, true); // créé par : MS-DOS, version 2.0
    v.setUint16(p + 6, VERSION, true);
    v.setUint16(p + 8, DRAPEAU_UTF8, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, 0, true);
    v.setUint16(p + 14, date, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.taille, true);
    v.setUint32(p + 24, e.taille, true);
    v.setUint16(p + 28, e.longueurNom, true);
    // extra, commentaire, disque, attributs internes et externes : 0 (octets déjà nuls).
    v.setUint32(p + 42, e.decalage, true);
    ecrireUtf8(e.nom, octets, p + EN_TETE_CENTRAL);
    p += EN_TETE_CENTRAL + e.longueurNom;
  }

  // Fin du répertoire central.
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entrees.length, true);
  v.setUint16(p + 10, entrees.length, true);
  v.setUint32(p + 12, p - debutCentral, true);
  v.setUint32(p + 16, debutCentral, true);
  return octets;
}
