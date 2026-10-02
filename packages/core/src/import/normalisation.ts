/**
 * Normalisation des cellules (T14) : clé de comparaison des textes, nombres à virgule ou à point,
 * mesures avec unité, dates (JJ/MM/AAAA, AAAA-MM-JJ, date Excel, semaine). Rien ne lève.
 */
import { analyserDate, dateDepuisJourAbsolu, jourAbsolu, lundiDeSemaine, nombreSemainesIso, type DateCalendaire } from '../dates/index.ts';
import type { Cellule, Lecture, OptionsDate, UniteMesure } from './types.ts';

const MARQUES = /[̀-ͯ]/g;
const HORS_MOT = /[^a-z0-9]+/g;

/**
 * Clé de comparaison : casse, accents, ligatures (œ → oe) et ponctuation ignorés, espaces
 * resserrés. « Type d’abri » et « type d'abri » → « type d abri » ; « longueur_m » → « longueur m ».
 */
export function cle(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(MARQUES, '')
    .toLowerCase()
    .replaceAll('œ', 'oe')
    .replaceAll('æ', 'ae')
    .replaceAll('ß', 'ss')
    .replace(HORS_MOT, ' ')
    .trim();
}

/** Texte d'une cellule (nombre → son écriture), sans espaces autour ; `null` si vide. */
export function texteCellule(c: Cellule | undefined): string | null {
  if (c === null || c === undefined) return null;
  const t = typeof c === 'number' ? String(c) : c.trim();
  return t === '' ? null : t;
}

/**
 * Longueur au-delà de laquelle une cellule (espaces autour retirés) n'est ni un nombre, ni une
 * mesure, ni une date : rien d'utile ne s'écrit sur plus de 200 caractères, et la borne garantit
 * un temps de lecture linéaire quoi qu'il y ait dans la cellule.
 */
export const LONGUEUR_MAX_CELLULE = 200;

const ok = <T>(valeur: T): Lecture<T> => ({ ok: true, valeur });
const ko = <T>(code: 'nombre_invalide' | 'unite_inconnue' | 'date_invalide' | 'annee_manquante'): Lecture<T> => ({ ok: false, code });

const NOMBRE_SIMPLE = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
const NOMBRE_MILLIERS = /^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/;

/** Écriture décimale d'un texte de nombre (point décimal, sans espaces), ou `null`. */
function decimal(texte: string): string | null {
  const t = texte.trim();
  if (NOMBRE_SIMPLE.test(t)) return t.replace(',', '.');
  if (NOMBRE_MILLIERS.test(t)) return t.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  return null;
}

const sansMoinsZero = (n: number): number => (n === 0 ? 0 : n);

/** Nombre à virgule ou à point, espaces de milliers tolérés ; vide → null. */
export function lireNombre(c: Cellule): Lecture<number | null> {
  if (c === null) return ok(null);
  if (typeof c === 'number') return Number.isFinite(c) ? ok(sansMoinsZero(c)) : ko('nombre_invalide');
  const t = c.trim();
  if (t === '') return ok(null);
  if (t.length > LONGUEUR_MAX_CELLULE) return ko('nombre_invalide');
  const d = decimal(t);
  if (d === null) return ko('nombre_invalide');
  const n = Number(d);
  return Number.isFinite(n) ? ok(sansMoinsZero(n)) : ko('nombre_invalide');
}

// ── Mesures ──────────────────────────────────────────────────────────────────────────────────

/** Puissance de dix de chaque unité dans sa grandeur (longueur en m, masse en g). */
const UNITES: Readonly<Record<UniteMesure, { readonly grandeur: 'longueur' | 'masse'; readonly exposant: number }>> = {
  m: { grandeur: 'longueur', exposant: 0 },
  cm: { grandeur: 'longueur', exposant: -2 },
  kg: { grandeur: 'masse', exposant: 3 },
  g: { grandeur: 'masse', exposant: 0 },
};

export function estUnite(u: string): u is UniteMesure {
  return u === 'm' || u === 'cm' || u === 'kg' || u === 'g';
}

export function grandeur(u: UniteMesure): 'longueur' | 'masse' {
  return UNITES[u].grandeur;
}

/**
 * Décale la virgule de `decalage` rangs dans l'écriture décimale `ecriture` : la conversion reste
 * exacte (« 32,5 » cm → « 32.5e-2 » m, lu comme 0,325 sans calcul en virgule flottante).
 */
function decaler(ecriture: string, decalage: number): number {
  if (decalage === 0) return Number(ecriture);
  const e = ecriture.toLowerCase().indexOf('e');
  if (e === -1) return Number(`${ecriture}e${String(decalage)}`);
  return Number(`${ecriture.slice(0, e)}e${String(Number(ecriture.slice(e + 1)) + decalage)}`);
}

/** Lettre d'une unité écrite dans une cellule : a-z, A-Z, lettres latines accentuées, µ. */
function lettreUnite(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 0xc0 && code <= 0xff) || code === 0xb5;
}

/** Espaces (ceux de `trim`, les plus courants) entre le nombre et l'unité. */
function espace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0xa0 || code === 0x202f || code === 0x2009 || code === 0x0a || code === 0x0d;
}

/**
 * Nombre suivi facultativement d'une unité, converti exactement vers `cible` ; sans unité dans
 * la cellule, `parDefaut` (ou `cible`). Unité inconnue ou d'une autre grandeur → unite_inconnue.
 */
export function lireMesure(c: Cellule, cible: UniteMesure, parDefaut: UniteMesure | null): Lecture<number | null> {
  if (c === null) return ok(null);
  let ecriture: string;
  let unite: string = parDefaut ?? cible;
  if (typeof c === 'number') {
    if (!Number.isFinite(c)) return ko('nombre_invalide');
    ecriture = String(c);
  } else {
    const t = c.trim();
    if (t === '') return ok(null);
    if (t.length > LONGUEUR_MAX_CELLULE) return ko('nombre_invalide');
    // Unité balayée depuis la fin : lettres, puis espaces ; le reste est le nombre.
    let fin = t.length;
    while (fin > 0 && lettreUnite(t.charCodeAt(fin - 1))) fin--;
    let nombre = t;
    if (fin < t.length) {
      unite = t.slice(fin).toLowerCase();
      let k = fin;
      while (k > 0 && espace(t.charCodeAt(k - 1))) k--;
      nombre = t.slice(0, k);
      if (nombre === '') return ko('nombre_invalide');
    }
    const d = decimal(nombre);
    if (d === null) return ko('nombre_invalide');
    ecriture = d;
  }
  if (!estUnite(unite)) return ko('unite_inconnue');
  const depart = UNITES[unite];
  const arrivee = UNITES[cible];
  if (depart.grandeur !== arrivee.grandeur) return ko('unite_inconnue');
  const n = decaler(ecriture, depart.exposant - arrivee.exposant);
  return Number.isFinite(n) ? ok(sansMoinsZero(n)) : ko('nombre_invalide');
}

/** `n` × 10^`exposant`, exact en décimal (« 0,0123 » ha → 123 m², sans flottant intermédiaire). */
export function multiplierPuissanceDix(n: number, exposant: number): number {
  return sansMoinsZero(decaler(String(n), exposant));
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────

const JOUR_MOIS_ANNEE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const ANNEE_MOIS_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const SEMAINE = /^(?:s|sem|semaine)\.?\s*(\d{1,2})$/i;
/** 9999-12-31 en numéro de série Excel (système 1900) : au-delà, ce n'est pas une date. */
const SERIE_MAX = 2_958_465;
/** Écart entre les deux systèmes : 1904-01-01 est le 1462 du système 1900. */
const DECALAGE_1904 = 1462;
/** Sans année de saison, un numéro de série d'avant 1950 est une quantité, pas une date. */
const ANNEE_MIN_SANS_SAISON = 1950;
/** Plage autour de l'année de la saison (en années). */
const ECART_SAISON = 5;

let jour1900: number | undefined;

/**
 * Numéro de série Excel → date. Système 1900 : 60 est le 29/02/1900 qui n'existe pas (bogue de
 * Lotus repris par Excel) ; système 1904 : 0 est le 1904-01-01. Partie décimale (heure) ignorée.
 */
function dateExcel(n: number, systeme: 1900 | 1904): Lecture<DateCalendaire | null> {
  if (!Number.isFinite(n)) return ko('date_invalide');
  const serie = Math.floor(n);
  jour1900 ??= jourAbsolu('1899-12-31' as DateCalendaire);
  if (systeme === 1904) {
    if (serie < 0 || serie > SERIE_MAX - DECALAGE_1904) return ko('date_invalide');
    return ok(dateDepuisJourAbsolu(jour1900 + serie + DECALAGE_1904 - 1));
  }
  if (serie < 1 || serie === 60 || serie > SERIE_MAX) return ko('date_invalide');
  return ok(dateDepuisJourAbsolu(jour1900 + (serie < 60 ? serie : serie - 1)));
}

/** La date d'un numéro de série doit tomber près de la saison (ou après 1950 sans saison). */
function dansLaPlage(date: DateCalendaire, anneeSaison: number | null): boolean {
  const annee = Number(date.slice(0, 4));
  if (anneeSaison === null) return annee >= ANNEE_MIN_SANS_SAISON;
  return annee >= anneeSaison - ECART_SAISON && annee <= anneeSaison + ECART_SAISON;
}

const deux = (s: string): string => s.padStart(2, '0');

/**
 * Les deux premiers nombres d'une date « a/b/AAAA » (sans décider lequel est le jour), ou `null`
 * si la cellule n'est pas écrite ainsi. Sert à choisir l'ordre JJ/MM ou MM/JJ d'une colonne.
 */
export function premiersNombresDate(c: Cellule | undefined): readonly [number, number] | null {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (t.length > LONGUEUR_MAX_CELLULE) return null;
  const m = JOUR_MOIS_ANNEE.exec(t);
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

function dateTexte(saisie: string): Lecture<DateCalendaire | null> {
  const r = analyserDate(saisie);
  return r.ok ? ok(r.date) : ko('date_invalide');
}

/**
 * Date d'une cellule : 'JJ/MM/AAAA' (ou 'MM/JJ/AAAA' selon `options.ordre`), 'AAAA-MM-JJ',
 * numéro de série Excel (système `options.systemeDates`, dans la plage de la saison), ou semaine
 * ('S14', 'sem 14', 'Semaine 14') → lundi de la semaine ISO de `anneeSaison`.
 */
export function lireDate(c: Cellule, anneeSaison: number | null, options: OptionsDate = {}): Lecture<DateCalendaire | null> {
  if (c === null) return ok(null);
  if (typeof c === 'number') {
    const r = dateExcel(c, options.systemeDates ?? 1900);
    if (!r.ok || r.valeur === null) return r;
    return dansLaPlage(r.valeur, anneeSaison) ? r : ko('date_invalide');
  }
  const t = c.trim();
  if (t === '') return ok(null);
  if (t.length > LONGUEUR_MAX_CELLULE) return ko('date_invalide');
  const jma = JOUR_MOIS_ANNEE.exec(t);
  if (jma !== null) {
    const [a, b] = options.ordre === 'mm_jj' ? [jma[2], jma[1]] : [jma[1], jma[2]];
    return dateTexte(`${jma[3] ?? ''}-${deux(b ?? '')}-${deux(a ?? '')}`);
  }
  if (ANNEE_MOIS_JOUR.test(t)) return dateTexte(t);
  const semaine = SEMAINE.exec(t);
  if (semaine !== null) {
    if (anneeSaison === null) return ko('annee_manquante');
    if (!Number.isInteger(anneeSaison) || anneeSaison < 1 || anneeSaison > 9999) return ko('date_invalide');
    const s = Number(semaine[1]);
    if (s < 1 || s > nombreSemainesIso(anneeSaison)) return ko('date_invalide');
    return ok(lundiDeSemaine(anneeSaison, s));
  }
  return ko('date_invalide');
}

/**
 * Date d'une colonne en numéros de semaine (« Semis (sem.) ») : un entier de 1 à 53 (nombre ou
 * texte, « 14 ») est le lundi de la semaine ISO de `anneeSaison`, comme « S14 » ; un nombre à
 * virgule ou une semaine qui n'existe pas → 'date_invalide' ; sans saison → 'annee_manquante'.
 * Toute autre écriture (« S14 », « 15/03/2027 ») se lit comme d'habitude (`lireDate`).
 */
export function lireDateSemaine(c: Cellule, anneeSaison: number | null, options: OptionsDate = {}): Lecture<DateCalendaire | null> {
  const n = lireNombre(c);
  if (!n.ok) return lireDate(c, anneeSaison, options);
  if (n.valeur === null) return ok(null);
  if (!Number.isInteger(n.valeur)) return ko('date_invalide');
  if (anneeSaison === null) return ko('annee_manquante');
  if (!Number.isInteger(anneeSaison) || anneeSaison < 1 || anneeSaison > 9999) return ko('date_invalide');
  if (n.valeur < 1 || n.valeur > nombreSemainesIso(anneeSaison)) return ko('date_invalide');
  return ok(lundiDeSemaine(anneeSaison, n.valeur));
}

/**
 * Numéro de semaine d'une date écrite en semaine : « S14 », « sem 14 », ou un entier nu dans une
 * colonne en semaines (`enSemaines`). `null` pour toute autre écriture (date complète, série Excel).
 * À n'appeler que sur une cellule déjà lue sans erreur par `lireDate` / `lireDateSemaine`.
 */
export function numeroSemaine(c: Cellule, enSemaines: boolean): number | null {
  if (typeof c === 'string') {
    const m = SEMAINE.exec(c.trim());
    if (m !== null) return Number(m[1]);
  }
  if (!enSemaines) return null;
  const n = lireNombre(c);
  return n.ok && n.valeur !== null && Number.isInteger(n.valeur) ? n.valeur : null;
}
