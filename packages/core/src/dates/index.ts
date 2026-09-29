/**
 * Dates calendaires du moteur : chaînes 'AAAA-MM-JJ' marquées, calculs en jours absolus entiers.
 *
 * Aucun objet `Date` ici : un jour de culture n'a pas de fuseau horaire. Toute l'arithmétique
 * passe par le « jour absolu » (nombre entier de jours depuis 1970-01-01, calendrier grégorien
 * proleptique), avec les algorithmes days_from_civil / civil_from_days de Howard Hinnant.
 * Toutes les divisions portent sur des entiers exacts (bien en deçà de 2^53).
 */

declare const marqueDateCalendaire: unique symbol;

/** Date calendaire 'AAAA-MM-JJ' vérifiée. S'obtient par `analyserDate` ou `estDateValide`. */
export type DateCalendaire = string & { readonly [marqueDateCalendaire]: 'DateCalendaire' };

/** Semaine ISO 8601 : l'année ISO peut différer de l'année civile autour du 1er janvier. */
export interface SemaineIso {
  readonly annee: number;
  readonly semaine: number;
}

export interface ErreurDate {
  readonly code: 'format_invalide' | 'date_inexistante';
  readonly saisie: string;
}

export type ResultatAnalyseDate =
  | { readonly ok: true; readonly date: DateCalendaire }
  | { readonly ok: false; readonly erreur: ErreurDate };

const ANNEE_MIN = 1;
const ANNEE_MAX = 9999;
const FORMAT_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** Division entière arrondie vers −∞ (a et b entiers, b > 0). */
function divEntiere(a: number, b: number): number {
  return (a - modulo(a, b)) / b;
}

/** Reste toujours positif ou nul (a et b entiers, b > 0). */
function modulo(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

function joursDansMois(annee: number, mois: number): number {
  if (mois === 2) {
    return estBissextile(annee) ? 29 : 28;
  }
  return mois === 4 || mois === 6 || mois === 9 || mois === 11 ? 30 : 31;
}

/** days_from_civil (H. Hinnant) : jour absolu d'une date grégorienne supposée valide. */
function jourDepuisCivil(annee: number, mois: number, jour: number): number {
  const a = mois <= 2 ? annee - 1 : annee;
  const ere = divEntiere(a, 400);
  const anneeDansEre = a - ere * 400; // [0, 399]
  const moisDecale = mois > 2 ? mois - 3 : mois + 9; // mars = 0
  const jourDansAnnee = divEntiere(153 * moisDecale + 2, 5) + jour - 1; // [0, 365]
  const jourDansEre =
    anneeDansEre * 365 + divEntiere(anneeDansEre, 4) - divEntiere(anneeDansEre, 100) + jourDansAnnee;
  return ere * 146097 + jourDansEre - 719468;
}

interface Civil {
  readonly annee: number;
  readonly mois: number;
  readonly jour: number;
}

/** civil_from_days (H. Hinnant) : date grégorienne d'un jour absolu entier. */
function civilDepuisJour(n: number): Civil {
  const z = n + 719468;
  const ere = divEntiere(z, 146097);
  const jourDansEre = z - ere * 146097; // [0, 146096]
  const anneeDansEre = divEntiere(
    jourDansEre - divEntiere(jourDansEre, 1460) + divEntiere(jourDansEre, 36524) - divEntiere(jourDansEre, 146096),
    365,
  ); // [0, 399]
  const jourDansAnnee =
    jourDansEre - (365 * anneeDansEre + divEntiere(anneeDansEre, 4) - divEntiere(anneeDansEre, 100)); // [0, 365]
  const moisDecale = divEntiere(5 * jourDansAnnee + 2, 153); // [0, 11], mars = 0
  const jour = jourDansAnnee - divEntiere(153 * moisDecale + 2, 5) + 1;
  const mois = moisDecale < 10 ? moisDecale + 3 : moisDecale - 9;
  const annee = anneeDansEre + ere * 400 + (mois <= 2 ? 1 : 0);
  return { annee, mois, jour };
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

function formater(c: Civil): DateCalendaire {
  return `${String(c.annee).padStart(4, '0')}-${deuxChiffres(c.mois)}-${deuxChiffres(c.jour)}` as DateCalendaire;
}

/** Lundi = 0 … dimanche = 6. 1970-01-01 était un jeudi. */
function jourDeSemaine(n: number): number {
  return modulo(n + 3, 7);
}

function exigerEntier(n: number, nom: string): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${nom} doit être un nombre entier : ${String(n)}`);
  }
}

const JOUR_ABSOLU_MIN = jourDepuisCivil(ANNEE_MIN, 1, 1);
const JOUR_ABSOLU_MAX = jourDepuisCivil(ANNEE_MAX, 12, 31);

/**
 * Lit une date 'AAAA-MM-JJ' stricte (années 0001 à 9999). Ne lève jamais d'exception :
 * renvoie une erreur typée ('format_invalide' ou 'date_inexistante').
 */
export function analyserDate(saisie: string): ResultatAnalyseDate {
  const morceaux = FORMAT_DATE.exec(saisie);
  if (morceaux === null) {
    return { ok: false, erreur: { code: 'format_invalide', saisie } };
  }
  const annee = Number(morceaux[1]);
  const mois = Number(morceaux[2]);
  const jour = Number(morceaux[3]);
  if (
    annee < ANNEE_MIN ||
    mois < 1 ||
    mois > 12 ||
    jour < 1 ||
    jour > joursDansMois(annee, mois)
  ) {
    return { ok: false, erreur: { code: 'date_inexistante', saisie } };
  }
  return { ok: true, date: saisie as DateCalendaire };
}

/** Garde de type : vrai si la chaîne est une date 'AAAA-MM-JJ' qui existe. */
export function estDateValide(saisie: string): saisie is DateCalendaire {
  return analyserDate(saisie).ok;
}

/** Nombre entier de jours depuis 1970-01-01 (négatif avant). */
export function jourAbsolu(d: DateCalendaire): number {
  return jourDepuisCivil(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)));
}

/** Inverse de `jourAbsolu`. RangeError si n n'est pas entier ou sort des années 0001 à 9999. */
export function dateDepuisJourAbsolu(n: number): DateCalendaire {
  exigerEntier(n, 'le jour absolu');
  if (n < JOUR_ABSOLU_MIN || n > JOUR_ABSOLU_MAX) {
    throw new RangeError(`jour absolu hors des années 0001 à 9999 : ${String(n)}`);
  }
  return formater(civilDepuisJour(n));
}

/** Ajoute (ou retire, si n < 0) un nombre entier de jours. RangeError si n n'est pas entier. */
export function ajouterJours(d: DateCalendaire, n: number): DateCalendaire {
  exigerEntier(n, 'le nombre de jours');
  return dateDepuisJourAbsolu(jourAbsolu(d) + n);
}

/** Nombre de jours de a à b (b − a) : négatif si b est avant a. */
export function ecartEnJours(a: DateCalendaire, b: DateCalendaire): number {
  return jourAbsolu(b) - jourAbsolu(a);
}

function semaineIsoDuJour(n: number): SemaineIso {
  // La semaine ISO appartient à l'année de son jeudi.
  const jeudi = n - jourDeSemaine(n) + 3;
  const annee = civilDepuisJour(jeudi).annee;
  const semaine = divEntiere(jeudi - jourDepuisCivil(annee, 1, 1), 7) + 1;
  return { annee, semaine };
}

/** Semaine ISO 8601 d'une date : la semaine 1 contient le premier jeudi de l'année. */
export function semaineIso(d: DateCalendaire): SemaineIso {
  return semaineIsoDuJour(jourAbsolu(d));
}

/** Forme lisible 'AAAA-Sxx' : '2026-S53', '2027-S01'. */
export function formaterSemaineIso(s: SemaineIso): string {
  return `${String(s.annee).padStart(4, '0')}-S${deuxChiffres(s.semaine)}`;
}

function exigerAnnee(annee: number): void {
  exigerEntier(annee, "l'année");
  if (annee < ANNEE_MIN || annee > ANNEE_MAX) {
    throw new RangeError(`année hors de 0001 à 9999 : ${String(annee)}`);
  }
}

/** 52 ou 53 : le 28 décembre est toujours dans la dernière semaine ISO de l'année. */
export function nombreSemainesIso(annee: number): number {
  exigerAnnee(annee);
  return semaineIsoDuJour(jourDepuisCivil(annee, 12, 28)).semaine;
}

/**
 * Lundi de la semaine ISO demandée. RangeError si la semaine n'existe pas : c'est une erreur
 * de programmation, l'interface ne propose que des semaines existantes.
 */
export function lundiDeSemaine(annee: number, semaine: number): DateCalendaire {
  exigerAnnee(annee);
  exigerEntier(semaine, 'la semaine');
  if (semaine < 1 || semaine > nombreSemainesIso(annee)) {
    throw new RangeError(`la semaine ${String(semaine)} n'existe pas en ${String(annee)}`);
  }
  // Le 4 janvier est toujours en semaine 1.
  const quatreJanvier = jourDepuisCivil(annee, 1, 4);
  const lundiSemaine1 = quatreJanvier - jourDeSemaine(quatreJanvier);
  return dateDepuisJourAbsolu(lundiSemaine1 + 7 * (semaine - 1));
}
