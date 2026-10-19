/**
 * Règles de « Ma ferme » (T49) : saisons, zones, planches saisies à la main. Pures : ni porte, ni
 * horloge, ni DOM. Ce sont celles que le serveur rejoue à la synchro (apps/api/src/sync/
 * structure-lignes.ts, T10s : noms non vides de 200 caractères au plus, saison dans l'ordre,
 * dates de 1900 à 2100, longueur > 0 et ≤ 10 km, largeur > 0 et ≤ 1 000 m, gouttière ⇔ nombre
 * de places) et le code unique dans sa zone, sans casse ni espaces autour, parmi les emplacements
 * en service (Q27). Une saisie refusée l'est ici, avec un message clair, avant toute écriture.
 */
import { estDateValide } from '@planif/core';

export type Verdict<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly champ: string; readonly message: string };

const refus = (champ: string, message: string) => ({ ok: false as const, champ, message });

/** Plafonds du serveur (PLAFONDS_STRUCTURE). */
export const PLAFONDS = { texte: 200, longueurM: 10_000, largeurM: 1_000, nombrePlaces: 1_000_000 } as const;
/** Planches au plus par geste « Ajouter des planches » (une transaction, un envoi). */
export const PLANCHES_PAR_LOT_MAX = 200;
const DATE_MIN = '1900-01-01';
const DATE_MAX = '2100-12-31';

export const TYPES_ABRI = ['plein_champ', 'tunnel', 'serre', 'hors_sol'] as const;
export type TypeAbri = (typeof TYPES_ABRI)[number];
export const LIBELLES_ABRI: Readonly<Record<TypeAbri, string>> = { plein_champ: 'Plein champ', tunnel: 'Tunnel', serre: 'Serre', hors_sol: 'Hors-sol' };

export const SORTES = ['planche', 'rang', 'gouttiere'] as const;
export type Sorte = (typeof SORTES)[number];
export const LIBELLES_SORTE: Readonly<Record<Sorte, string>> = { planche: 'Planche', rang: 'Rang', gouttiere: 'Gouttière' };

/** Code rapproché comme l'index unique du serveur : lower(trim(code)). */
export const cleCode = (code: string): string => code.trim().toLowerCase();

/** « 0,8 » → 0.8 ; texte vide ou illisible → null. */
export function lireNombre(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

function nom(texte: string, quoi: string): Verdict<string> {
  const n = texte.trim();
  if (n === '') return refus('nom', `Donnez un nom à ${quoi}.`);
  if (texte.includes('\u0000')) return refus('nom', 'Ce nom contient un caractère interdit : retapez-le.');
  if (n.length > PLAFONDS.texte) return refus('nom', `Nom : ${String(PLAFONDS.texte)} caractères au plus.`);
  return { ok: true, valeur: n };
}

// ── Saisons ──────────────────────────────────────────────────────────────────────────────────

export interface SaisieSaison {
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

/** Saison proposée : l'année du jour, ou la première année suivante dont le nom n'est pas pris. */
export function saisonProposee(aujourdhui: string, nomsPris: readonly string[]): SaisieSaison {
  const pris = new Set(nomsPris.map((x) => x.trim()));
  let annee = Number(aujourdhui.slice(0, 4));
  if (!Number.isInteger(annee)) annee = new Date().getFullYear();
  while (pris.has(String(annee))) annee++;
  return { nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31` };
}

function date(v: string, champ: string, libelle: string): Verdict<string> {
  if (!estDateValide(v)) return refus(champ, `${libelle} : date invalide.`);
  if (v < DATE_MIN || v > DATE_MAX) return refus(champ, `${libelle} : entre 1900 et 2100.`);
  return { ok: true, valeur: v };
}

export function verifierSaison(s: SaisieSaison): Verdict<SaisieSaison> {
  const n = nom(s.nom, 'la saison');
  if (!n.ok) return n;
  const debut = date(s.debut, 'debut', 'Début');
  if (!debut.ok) return debut;
  const fin = date(s.fin, 'fin', 'Fin');
  if (!fin.ok) return fin;
  if (fin.valeur < debut.valeur) return refus('fin', 'La saison finit avant de commencer : vérifiez les dates.');
  return { ok: true, valeur: { nom: n.valeur, debut: debut.valeur, fin: fin.valeur } };
}

// ── Zones ────────────────────────────────────────────────────────────────────────────────────

export interface SaisieZone {
  readonly nom: string;
  readonly typeAbri: string;
  readonly parenteId: string | null;
}

export function verifierZone(z: SaisieZone): Verdict<SaisieZone & { readonly typeAbri: TypeAbri }> {
  const n = nom(z.nom, 'la zone');
  if (!n.ok) return n;
  const type = TYPES_ABRI.find((t) => t === z.typeAbri);
  if (type === undefined) return refus('typeAbri', 'Choisissez le type d’abri : plein champ, tunnel, serre ou hors-sol.');
  return { ok: true, valeur: { nom: n.valeur, typeAbri: type, parenteId: z.parenteId } };
}

// ── Planches ─────────────────────────────────────────────────────────────────────────────────

function mesure(texte: string, champ: string, libelle: string, max: number): Verdict<number> {
  const n = lireNombre(texte);
  if (n === null || n <= 0) return refus(champ, `${libelle} : un nombre de mètres plus grand que 0.`);
  if (n > max) return refus(champ, `${libelle} : au plus ${fmt(max)} m.`);
  return { ok: true, valeur: n };
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Codes d'un lot : <préfixe><n>, n à la suite du plus grand numéro déjà pris avec ce préfixe. */
export function codesDuLot(prefixe: string, nombre: number, codesPris: readonly string[]): string[] {
  const p = prefixe.trim();
  const motif = new RegExp(`^${echapper(p.toLowerCase())}(\\d+)$`);
  let max = 0;
  for (const c of codesPris) {
    const m = motif.exec(cleCode(c));
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: nombre }, (_, i) => `${p}${String(max + i + 1)}`);
}

export interface SaisieLot {
  readonly nombre: string;
  readonly prefixe: string;
  readonly longueur: string;
  readonly largeur: string;
}

export interface LotVerifie {
  readonly codes: readonly string[];
  readonly longueurM: number;
  readonly largeurM: number;
}

export function verifierLot(l: SaisieLot, codesPris: readonly string[]): Verdict<LotVerifie> {
  const nombre = lireNombre(l.nombre);
  if (nombre === null || !Number.isInteger(nombre) || nombre < 1 || nombre > PLANCHES_PAR_LOT_MAX) {
    return refus('nombre', `Nombre de planches : de 1 à ${String(PLANCHES_PAR_LOT_MAX)}.`);
  }
  if (l.prefixe.includes('\u0000')) return refus('prefixe', 'Ce préfixe contient un caractère interdit : retapez-le.');
  const longueur = mesure(l.longueur, 'longueur', 'Longueur', PLAFONDS.longueurM);
  if (!longueur.ok) return longueur;
  const largeur = mesure(l.largeur, 'largeur', 'Largeur', PLAFONDS.largeurM);
  if (!largeur.ok) return largeur;
  const codes = codesDuLot(l.prefixe, nombre, codesPris);
  if (codes.some((c) => c.length > PLAFONDS.texte)) return refus('prefixe', `Code : ${String(PLAFONDS.texte)} caractères au plus, numéro compris.`);
  return { ok: true, valeur: { codes, longueurM: longueur.valeur, largeurM: largeur.valeur } };
}

export interface SaisieEmplacement {
  readonly code: string;
  readonly sorte: string;
  readonly longueur: string;
  readonly largeur: string;
  readonly nombrePlaces: string;
}

export interface EmplacementVerifie {
  readonly code: string;
  readonly sorte: Sorte;
  readonly longueurM: number;
  readonly largeurM: number | null;
  readonly nombrePlaces: number | null;
}

/** `codesPris` : codes des AUTRES emplacements en service de la zone. */
export function verifierEmplacement(e: SaisieEmplacement, codesPris: readonly string[]): Verdict<EmplacementVerifie> {
  const code = e.code.trim();
  if (code === '') return refus('code', 'Donnez un code à la planche (P3, T2-P03…).');
  if (e.code.includes('\u0000')) return refus('code', 'Ce code contient un caractère interdit : retapez-le.');
  if (code.length > PLAFONDS.texte) return refus('code', `Code : ${String(PLAFONDS.texte)} caractères au plus.`);
  const cle = cleCode(code);
  if (codesPris.some((c) => cleCode(c) === cle)) return refus('code', `Le code « ${code} » existe déjà dans cette zone : choisissez-en un autre.`);
  const sorte = SORTES.find((s) => s === e.sorte);
  if (sorte === undefined) return refus('sorte', 'Choisissez : planche, rang ou gouttière.');
  const longueur = mesure(e.longueur, 'longueur', 'Longueur', PLAFONDS.longueurM);
  if (!longueur.ok) return longueur;
  let largeurM: number | null = null;
  if (e.largeur.trim() !== '') {
    const largeur = mesure(e.largeur, 'largeur', 'Largeur', PLAFONDS.largeurM);
    if (!largeur.ok) return largeur;
    largeurM = largeur.valeur;
  }
  let nombrePlaces: number | null = null;
  if (sorte === 'gouttiere') {
    const n = lireNombre(e.nombrePlaces);
    if (n === null || !Number.isInteger(n) || n < 1 || n > PLAFONDS.nombrePlaces) return refus('nombrePlaces', 'Nombre de places : obligatoire pour une gouttière, un nombre entier.');
    nombrePlaces = n;
  } else if (e.nombrePlaces.trim() !== '') {
    return refus('nombrePlaces', 'Nombre de places : seulement pour une gouttière.');
  }
  return { ok: true, valeur: { code, sorte, longueurM: longueur.valeur, largeurM, nombrePlaces } };
}
