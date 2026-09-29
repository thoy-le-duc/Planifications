/**
 * Lecture d'un CSV (T14) : décodage des octets (UTF-8 ou Windows-1252), détection du séparateur,
 * découpage RFC 4180. Le cœur n'a ni `TextDecoder` ni `Buffer` déclarés : décodage écrit ici.
 * Aucune fonction ne lève ; les octets reçus ne sont jamais modifiés.
 */
import type { CsvLu, Separateur, TexteDecode } from './types.ts';

/** Windows-1252, octets 0x80 à 0x9F ; les cinq non définis restent U+0081… (comme le WHATWG). */
const CP1252_80_9F = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

const TRANCHE = 8192;

/** Unités UTF-16 → texte, par tranches (pas de dépassement de pile sur un gros fichier). */
function texteDepuisUnites(unites: Uint16Array, longueur: number): string {
  const morceaux: string[] = [];
  for (let i = 0; i < longueur; i += TRANCHE) {
    morceaux.push(String.fromCharCode(...unites.subarray(i, Math.min(i + TRANCHE, longueur))));
  }
  return morceaux.join('');
}

const suite = (b: number | undefined): b is number => b !== undefined && (b & 0xc0) === 0x80;

/**
 * Décode `octets[debut, fin[` en UTF-8 strict (ni forme trop longue, ni moitié de paire de
 * substitution, ni point de code au-delà de U+10FFFF) ; `null` si ce n'est pas de l'UTF-8 valide.
 */
export function decoderUtf8(octets: Uint8Array, debut = 0, fin = octets.length): string | null {
  const unites = new Uint16Array(Math.max(0, fin - debut));
  let n = 0;
  let i = debut;
  while (i < fin) {
    const b = octets[i] ?? 0;
    if (b < 0x80) {
      unites[n++] = b;
      i++;
      continue;
    }
    if (b >= 0xc2 && b <= 0xdf) {
      const b1 = i + 1 < fin ? octets[i + 1] : undefined;
      if (!suite(b1)) return null;
      unites[n++] = ((b & 0x1f) << 6) | (b1 & 0x3f);
      i += 2;
      continue;
    }
    if (b >= 0xe0 && b <= 0xef) {
      const b1 = i + 1 < fin ? octets[i + 1] : undefined;
      const b2 = i + 2 < fin ? octets[i + 2] : undefined;
      if (!suite(b1) || !suite(b2)) return null;
      if (b === 0xe0 && b1 < 0xa0) return null; // forme trop longue
      if (b === 0xed && b1 > 0x9f) return null; // moitié de paire de substitution
      unites[n++] = ((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      i += 3;
      continue;
    }
    if (b >= 0xf0 && b <= 0xf4) {
      const b1 = i + 1 < fin ? octets[i + 1] : undefined;
      const b2 = i + 2 < fin ? octets[i + 2] : undefined;
      const b3 = i + 3 < fin ? octets[i + 3] : undefined;
      if (!suite(b1) || !suite(b2) || !suite(b3)) return null;
      if (b === 0xf0 && b1 < 0x90) return null;
      if (b === 0xf4 && b1 > 0x8f) return null;
      const point = (((b & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      unites[n++] = 0xd800 | (point >> 10);
      unites[n++] = 0xdc00 | (point & 0x3ff);
      i += 4;
      continue;
    }
    return null;
  }
  return texteDepuisUnites(unites, n);
}

function decoderCp1252(octets: Uint8Array): string {
  const unites = new Uint16Array(octets.length);
  for (let i = 0; i < octets.length; i++) {
    const b = octets[i] ?? 0;
    unites[i] = b >= 0x80 && b <= 0x9f ? (CP1252_80_9F[b - 0x80] ?? b) : b;
  }
  return texteDepuisUnites(unites, octets.length);
}

/** UTF-8 s'il est valide (BOM retiré et signalé), sinon Windows-1252 (exports Excel). */
export function decoderTexte(octets: Uint8Array): TexteDecode {
  const bom = octets.length >= 3 && octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf;
  const utf8 = decoderUtf8(octets, bom ? 3 : 0);
  if (utf8 !== null) return { texte: utf8, encodage: 'utf-8', bom };
  return { texte: decoderCp1252(octets), encodage: 'windows-1252', bom: false };
}

// ── Découpage ────────────────────────────────────────────────────────────────────────────────

const GUILLEMET = 0x22;
const LF = 0x0a;
const CR = 0x0d;

/** Fin du champ non protégé qui commence en `i` : séparateur, fin de ligne ou fin du texte. */
function finDeChamp(texte: string, i: number, sep: number): number {
  let k = i;
  const n = texte.length;
  while (k < n) {
    const c = texte.charCodeAt(k);
    if (c === sep || c === LF || c === CR) break;
    k++;
  }
  return k;
}

/**
 * Découpage RFC 4180, `max` lignes au plus : champs entre guillemets (séparateur, guillemets
 * doublés et retours à la ligne gardés), fins de ligne CRLF, LF ou CR ; la dernière fin de ligne
 * ne crée pas de ligne vide ; guillemet non fermé : le reste du texte est le dernier champ.
 */
function decouper(texte: string, sep: number, max: number): string[][] {
  const lignes: string[][] = [];
  const n = texte.length;
  let ligne: string[] = [];
  let i = 0;
  while (i < n && lignes.length < max) {
    let valeur: string;
    if (texte.charCodeAt(i) === GUILLEMET) {
      let protege = '';
      let j = i + 1;
      for (;;) {
        const k = texte.indexOf('"', j);
        if (k === -1) {
          protege += texte.slice(j);
          j = n;
          break;
        }
        protege += texte.slice(j, k);
        if (texte.charCodeAt(k + 1) === GUILLEMET) {
          protege += '"';
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      // Tolérance : ce qui suit le guillemet fermant jusqu'au séparateur est gardé tel quel.
      const k = finDeChamp(texte, j, sep);
      valeur = protege + texte.slice(j, k);
      i = k;
    } else {
      const k = finDeChamp(texte, i, sep);
      valeur = texte.slice(i, k);
      i = k;
    }
    ligne.push(valeur);
    if (i >= n) break;
    const c = texte.charCodeAt(i);
    if (c === sep) {
      i++;
      if (i >= n) ligne.push('');
      continue;
    }
    i += c === CR && texte.charCodeAt(i + 1) === LF ? 2 : 1;
    lignes.push(ligne);
    ligne = [];
  }
  if (ligne.length > 0 && lignes.length < max) lignes.push(ligne);
  return lignes;
}

const SEPARATEURS: readonly Separateur[] = [';', ',', '\t'];
const LIGNES_DETECTION = 20;

interface Candidat {
  readonly separateur: Separateur;
  readonly tous: boolean;
  readonly accord: number;
  readonly frequenceEntete: number;
}

function meilleur(a: Candidat, b: Candidat): Candidat {
  if (a.tous !== b.tous) return a.tous ? a : b;
  if (a.accord !== b.accord) return a.accord > b.accord ? a : b;
  if (a.frequenceEntete !== b.frequenceEntete) return a.frequenceEntete > b.frequenceEntete ? a : b;
  return a; // ordre de SEPARATEURS
}

/**
 * Le séparateur qui découpe les premières lignes (hors guillemets) en un même nombre de champs
 * supérieur à 1 ; à égalité, le plus fréquent dans l'en-tête ; aucun → ';'.
 */
export function detecterSeparateur(texte: string): Separateur {
  let choisi: Candidat | null = null;
  for (const separateur of SEPARATEURS) {
    const lignes = decouper(texte, separateur.charCodeAt(0), LIGNES_DETECTION).filter((l) => l.length > 1 || (l[0] ?? '').trim() !== '');
    if (lignes.length === 0) continue;
    const frequences = new Map<number, number>();
    for (const l of lignes) frequences.set(l.length, (frequences.get(l.length) ?? 0) + 1);
    let mode = 0;
    let accord = 0;
    for (const [nombre, fois] of frequences) {
      if (fois > accord || (fois === accord && nombre > mode)) {
        mode = nombre;
        accord = fois;
      }
    }
    if (mode <= 1) continue;
    const candidat: Candidat = { separateur, tous: accord === lignes.length, accord, frequenceEntete: (lignes[0]?.length ?? 1) - 1 };
    choisi = choisi === null ? candidat : meilleur(choisi, candidat);
  }
  return choisi?.separateur ?? ';';
}

/** Octets d'un CSV → lignes de chaînes (vide = ''), avec l'encodage et le séparateur détectés. */
export function lireCsv(octets: Uint8Array): CsvLu {
  const { texte, encodage, bom } = decoderTexte(octets);
  const separateur = detecterSeparateur(texte);
  const lignes = decouper(texte, separateur.charCodeAt(0), Number.POSITIVE_INFINITY);
  return { encodage, bom, separateur, lignes };
}
