/**
 * Lecture d'un CSV (T14) : décodage des octets (UTF-16 avec BOM, UTF-8 ou Windows-1252), détection
 * du séparateur, découpage RFC 4180, plafond de 5 millions de cases. Le cœur n'a ni `TextDecoder`
 * ni `Buffer` déclarés : `TextDecoder` est retrouvé par `globalThis` (type local), avec un décodage
 * écrit ici quand il manque.
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

// ── TextDecoder natif, s'il existe (type local : le cœur n'a pas les types du DOM) ─────────────

interface DecodeurNatif {
  decode(octets: Uint8Array): string;
}
type ConstructeurDecodeur = new (etiquette: string, options: { readonly fatal: boolean; readonly ignoreBOM: boolean }) => DecodeurNatif;

const decodeurs = new Map<string, DecodeurNatif | null>();

/**
 * Décodeur natif (bien plus rapide que la boucle écrite ici), `fatal` pour UTF-8 : une séquence
 * invalide lève, et la lecture repasse en Windows-1252. `null` s'il n'existe pas : boucles ci-dessous.
 */
function decodeurNatif(etiquette: 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be'): DecodeurNatif | null {
  let d = decodeurs.get(etiquette);
  if (d !== undefined) return d;
  d = null;
  const C = (globalThis as { readonly TextDecoder?: ConstructeurDecodeur }).TextDecoder;
  if (C !== undefined) {
    try {
      // `ignoreBOM` pour les seules étiquettes UTF (le BOM est retiré ici) : sur Windows-1252,
      // certains moteurs prennent 0xFF en tête pour un BOM et perdent le « ÿ ».
      d = new C(etiquette, { fatal: etiquette === 'utf-8', ignoreBOM: etiquette !== 'windows-1252' });
    } catch {
      d = null;
    }
  }
  decodeurs.set(etiquette, d);
  return d;
}

function decoderNatif(etiquette: 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be', octets: Uint8Array): string | null | undefined {
  const d = decodeurNatif(etiquette);
  if (d === null) return undefined;
  try {
    return d.decode(octets);
  } catch {
    return null;
  }
}

const suite = (b: number | undefined): b is number => b !== undefined && (b & 0xc0) === 0x80;

/**
 * Décode `octets[debut, fin[` en UTF-8 strict (ni forme trop longue, ni moitié de paire de
 * substitution, ni point de code au-delà de U+10FFFF) ; `null` si ce n'est pas de l'UTF-8 valide.
 */
export function decoderUtf8(octets: Uint8Array, debut = 0, fin = octets.length): string | null {
  const natif = decoderNatif('utf-8', octets.subarray(debut, Math.max(debut, fin)));
  if (natif !== undefined) return natif;
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

function decoderCp1252(octets: Uint8Array, debut: number): string {
  const natif = decoderNatif('windows-1252', octets.subarray(debut));
  if (typeof natif === 'string') return natif;
  const n = Math.max(0, octets.length - debut);
  const unites = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const b = octets[debut + i] ?? 0;
    unites[i] = b >= 0x80 && b <= 0x9f ? (CP1252_80_9F[b - 0x80] ?? b) : b;
  }
  return texteDepuisUnites(unites, n);
}

/**
 * UTF-16 (petit- ou gros-boutiste) à partir de `debut` ; une moitié de paire de substitution
 * isolée ou un octet final impair → U+FFFD, un seul pour une moitié haute finale suivie d'un
 * octet impair (norme WHATWG, comme `TextDecoder`).
 */
function decoderUtf16(octets: Uint8Array, debut: number, petit: boolean): string {
  const natif = decoderNatif(petit ? 'utf-16le' : 'utf-16be', octets.subarray(debut));
  if (typeof natif === 'string') return natif;
  const n = Math.max(0, octets.length - debut);
  const paires = n >> 1;
  const unites = new Uint16Array(paires + (n & 1));
  const unite = (i: number): number => {
    const a = octets[debut + 2 * i] ?? 0;
    const b = octets[debut + 2 * i + 1] ?? 0;
    return petit ? a | (b << 8) : (a << 8) | b;
  };
  for (let i = 0; i < paires; i++) {
    const u = unite(i);
    if (u >= 0xd800 && u <= 0xdbff && i + 1 < paires) {
      const v = unite(i + 1);
      if (v >= 0xdc00 && v <= 0xdfff) {
        unites[i] = u;
        unites[i + 1] = v;
        i++;
        continue;
      }
    }
    unites[i] = u >= 0xd800 && u <= 0xdfff ? 0xfffd : u;
  }
  // Norme WHATWG : en fin de fichier, une moitié haute en attente et un octet impair donnent
  // ENSEMBLE un seul U+FFFD (celui de la moitié haute, déjà écrit).
  if ((n & 1) === 0) return texteDepuisUnites(unites, paires);
  // Une moitié haute en dernière position n'a jamais de moitié basse : toujours en attente.
  const derniere = paires > 0 ? unite(paires - 1) : 0;
  if (derniere >= 0xd800 && derniere <= 0xdbff) return texteDepuisUnites(unites, paires);
  unites[paires] = 0xfffd;
  return texteDepuisUnites(unites, paires + 1);
}

/** Encodage UTF-16 annoncé par un BOM (FF FE, FE FF : export « Texte Unicode » d'Excel), ou `null`. */
function bomUtf16(octets: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (octets.length < 2) return null;
  if (octets[0] === 0xff && octets[1] === 0xfe) return 'utf-16le';
  if (octets[0] === 0xfe && octets[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * UTF-16 si un BOM UTF-16 l'annonce ; sinon UTF-8 s'il est valide, sinon Windows-1252 (exports
 * Excel). Le BOM est retiré du texte et signalé (un BOM UTF-8 suivi d'octets Windows-1252 arrive
 * après un copier-coller).
 */
export function decoderTexte(octets: Uint8Array): TexteDecode {
  const utf16 = bomUtf16(octets);
  if (utf16 !== null) return { texte: decoderUtf16(octets, 2, utf16 === 'utf-16le'), encodage: utf16, bom: true };
  const bom = octets.length >= 3 && octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf;
  const debut = bom ? 3 : 0;
  const utf8 = decoderUtf8(octets, debut);
  if (utf8 !== null) return { texte: utf8, encodage: 'utf-8', bom };
  return { texte: decoderCp1252(octets, debut), encodage: 'windows-1252', bom };
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

/** Une ligne lue : position qui la suit, nombre de champs, tous vides (ou espaces) ?, champs gardés. */
interface LigneLue {
  readonly fin: number;
  readonly nombre: number;
  readonly vide: boolean;
  /** Les champs, ou `null` s'ils sont plus de `garder` (comptés, pas gardés). */
  readonly champs: string[] | null;
}

/**
 * Lit la ligne qui commence en `i` (< longueur du texte), RFC 4180 : champs entre guillemets
 * (séparateur, guillemets doublés et retours à la ligne gardés), fin de ligne CRLF, LF ou CR ;
 * guillemet non fermé : le reste du texte est le dernier champ. Garde au plus `garder` champs :
 * au-delà, ils sont seulement comptés (une ligne démesurée n'est jamais allouée).
 */
function lireLigne(texte: string, depart: number, sep: number, garder: number): LigneLue {
  const n = texte.length;
  // Premier champ gardé à part : une ligne d'un seul champ devient `[valeur]`, tableau à la
  // taille exacte ; au-delà, le tableau est recopié à sa taille exacte en fin de ligne.
  let premier = '';
  let champs = null as string[] | null;
  let nombre = 0;
  let vide = true;
  let trop = false as boolean;
  let i = depart;
  const ajouter = (valeur: string): void => {
    nombre++;
    if (vide && valeur.trim() !== '') vide = false;
    if (trop) return;
    if (nombre > garder) {
      trop = true;
      champs = null;
    } else if (nombre === 1) premier = valeur;
    else if (champs === null) champs = [premier, valeur];
    else champs.push(valeur);
  };
  for (;;) {
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
      valeur = i === k ? '' : texte.slice(i, k);
      i = k;
    }
    ajouter(valeur);
    if (i >= n) break;
    const c = texte.charCodeAt(i);
    if (c === sep) {
      i++;
      if (i >= n) {
        ajouter('');
        break;
      }
      continue;
    }
    i += c === CR && texte.charCodeAt(i + 1) === LF ? 2 : 1;
    break;
  }
  const gardes = trop ? null : champs === null ? [premier] : champs.slice();
  return { fin: i, nombre, vide, champs: gardes };
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
    // Nombre de champs des premières lignes (hors ligne d'un seul champ vide), sans les garder.
    const nombres: number[] = [];
    const sep = separateur.charCodeAt(0);
    for (let i = 0, lues = 0; i < texte.length && lues < LIGNES_DETECTION; lues++) {
      const l = lireLigne(texte, i, sep, 0);
      i = l.fin;
      if (l.nombre > 1 || !l.vide) nombres.push(l.nombre);
    }
    if (nombres.length === 0) continue;
    const frequences = new Map<number, number>();
    for (const l of nombres) frequences.set(l, (frequences.get(l) ?? 0) + 1);
    let mode = 0;
    let accord = 0;
    for (const [nombre, fois] of frequences) {
      if (fois > accord || (fois === accord && nombre > mode)) {
        mode = nombre;
        accord = fois;
      }
    }
    if (mode <= 1) continue;
    const candidat: Candidat = { separateur, tous: accord === nombres.length, accord, frequenceEntete: (nombres[0] ?? 1) - 1 };
    choisi = choisi === null ? candidat : meilleur(choisi, candidat);
  }
  return choisi?.separateur ?? ';';
}

/** Signature ZIP (un .xlsx renommé en .csv) à partir de `debut`. */
function estZip(octets: Uint8Array, debut: number): boolean {
  return octets[debut] === 0x50 && octets[debut + 1] === 0x4b && octets[debut + 2] === 0x03 && octets[debut + 3] === 0x04;
}

/** Signature ZIP ou octet nul (fichier binaire). */
function estBinaire(octets: Uint8Array): boolean {
  return estZip(octets, 0) || octets.includes(0);
}

const refus = (code: 'fichier_binaire' | 'fichier_trop_grand', message: string, lu?: TexteDecode, separateur?: Separateur): CsvLu => ({
  encodage: lu?.encodage ?? 'utf-8',
  bom: lu?.bom ?? false,
  separateur: separateur ?? ';',
  lignes: [],
  erreur: { code, message },
});

const MESSAGE_BINAIRE =
  'Ce fichier n’est pas un texte CSV (c’est peut-être un classeur Excel renommé) : déposez le fichier .xlsx tel quel, ou enregistrez-le en CSV depuis le tableur.';
const MESSAGE_TROP_GRAND =
  'Ce fichier est trop grand (plus de 5 millions de cases ou de 1 048 576 lignes) : découpez-le en plusieurs fichiers plus petits et importez-les l’un après l’autre.';

/** Plafond des cases d'un CSV (même que le .xlsx) : chaque ligne rendue compte pour une case, chacun de ses champs aussi. */
const PLAFOND_CASES = 5_000_000;
/** Plafond des lignes rendues (comme une feuille Excel), lignes vides d'avant une ligne utile comprises. */
const PLAFOND_LIGNES = 1_048_576;

/**
 * Octets d'un CSV → lignes de chaînes (vide = ''), avec l'encodage et le séparateur détectés.
 * Les lignes vides (champs vides ou espaces) de fin de fichier ne sont ni créées ni comptées ;
 * celles d'avant une ligne utile restent (elles gardent les numéros de ligne). Au-delà de
 * 5 000 000 de cases ou de 1 048 576 lignes → `fichier_trop_grand`, sans tout allouer.
 */
export function lireCsv(octets: Uint8Array): CsvLu {
  const utf16 = bomUtf16(octets) !== null;
  if (utf16 ? estZip(octets, 2) : estBinaire(octets)) return refus('fichier_binaire', MESSAGE_BINAIRE);
  const lu = decoderTexte(octets);
  // Avec un BOM UTF-16, un caractère nul décodé trahit un contenu binaire.
  if (utf16 && lu.texte.includes('\u0000')) return refus('fichier_binaire', MESSAGE_BINAIRE);
  const { texte, encodage, bom } = lu;
  const separateur = detecterSeparateur(texte);
  const sep = separateur.charCodeAt(0);
  const lignes: string[][] = [];
  let cases = 0;
  // Lignes vides en attente : rendues seulement si une ligne utile les suit (relues alors).
  let attenteDebut = -1;
  let attenteCases = 0;
  let attenteLignes = 0;
  let i = 0;
  while (i < texte.length) {
    const debut = i;
    const l = lireLigne(texte, i, sep, Math.max(0, PLAFOND_CASES - cases - attenteCases - 1));
    i = l.fin;
    if (l.vide) {
      if (attenteDebut < 0) attenteDebut = debut;
      attenteCases += 1 + l.nombre;
      attenteLignes++;
      continue;
    }
    if (l.champs === null || cases + attenteCases + 1 + l.nombre > PLAFOND_CASES || lignes.length + attenteLignes + 1 > PLAFOND_LIGNES) return refus('fichier_trop_grand', MESSAGE_TROP_GRAND, lu, separateur);
    for (let j = attenteDebut; attenteDebut >= 0 && j < debut; ) {
      const v = lireLigne(texte, j, sep, Number.POSITIVE_INFINITY);
      j = v.fin;
      lignes.push(v.champs ?? []);
    }
    cases += attenteCases + 1 + l.nombre;
    attenteDebut = -1;
    attenteCases = 0;
    attenteLignes = 0;
    lignes.push(l.champs);
  }
  return { encodage, bom, separateur, lignes, erreur: null };
}
