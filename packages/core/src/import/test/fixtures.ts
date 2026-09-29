/**
 * Outils des tests de T14 : lecture des fichiers de `__fixtures__/`, encodage de textes en octets
 * (UTF-8, Windows-1252), bibliothèque de référence des tests.
 *
 * `@planif/core` est compilé sans les types de Node : `node:fs`, `node:url` et `TextEncoder` sont
 * retrouvés dynamiquement, avec un type local.
 */
import type { Bibliotheque, Cellule, LigneBrute, Reference } from './contrat.ts';

interface Fs {
  readFileSync(chemin: string): Uint8Array;
}
interface Url {
  fileURLToPath(url: string): string;
}

const MODULE_FS = 'node:fs';
const MODULE_URL = 'node:url';

/** Liste des fichiers du jeu de test (le ticket en demande au moins six de formes différentes). */
export const FIXTURES = [
  'parcellaire-anglais.csv',
  'parcellaire-3-niveaux-cp1252.csv',
  'series-semaines.tsv',
  'series-titre.xlsx',
  'cultures-itineraires.csv',
  'assolement-passe.csv',
  'modele-a.csv',
  'modele-b.csv',
  't15-emplacement.csv',
] as const;

export type NomFixture = (typeof FIXTURES)[number];

/** Octets d'un fichier de `__fixtures__/`, tels qu'ils sont sur le disque. */
export async function lireFixture(nom: NomFixture): Promise<Uint8Array> {
  const fs = (await import(/* @vite-ignore */ MODULE_FS)) as Fs;
  const url = (await import(/* @vite-ignore */ MODULE_URL)) as Url;
  const ici = url.fileURLToPath((import.meta as { readonly url: string }).url);
  const dossier = ici.replace(/test[\\/]fixtures\.ts$/, '__fixtures__/');
  return new Uint8Array(fs.readFileSync(dossier + nom));
}

interface Encodeur {
  encode(texte: string): Uint8Array;
}

/** UTF-8 (sans BOM ; ajouter '\uFEFF' au texte pour en mettre un). */
export function utf8(texte: string): Uint8Array {
  const { TextEncoder } = globalThis as unknown as { TextEncoder: new () => Encodeur };
  return new TextEncoder().encode(texte);
}

/** Octets Windows-1252 propres à la plage 0x80–0x9F (le reste de Latin-1 est identique). */
const CP1252: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

/** Windows-1252 ; lève si un caractère n'y existe pas (erreur du test, pas du code testé). */
export function cp1252(texte: string): Uint8Array {
  const octets = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i] ?? '';
    const code = c.charCodeAt(0);
    const special = CP1252[c];
    if (special !== undefined) octets[i] = special;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) octets[i] = code;
    else throw new Error(`caractère absent de Windows-1252 : ${c}`);
  }
  return octets;
}

/** Retire les `null` et '' de fin de ligne (le lecteur peut les omettre ou non). */
export function sansFin(ligne: LigneBrute): Cellule[] {
  const l = [...ligne];
  while (l.length > 0 && (l[l.length - 1] === null || l[l.length - 1] === '')) l.pop();
  return l;
}

/** Retire les lignes vides de fin de feuille et les cellules vides de fin de ligne. */
export function sansFinFeuille(lignes: readonly LigneBrute[]): Cellule[][] {
  const l = lignes.map(sansFin);
  while (l.length > 0 && (l[l.length - 1] ?? []).length === 0) l.pop();
  return l;
}

// ── Bibliothèque des tests ───────────────────────────────────────────────────────────────────

const esp = (id: string, nom: string, synonymes?: readonly string[]): Reference =>
  synonymes === undefined ? { id, nom } : { id, nom, synonymes };

export const ESPECES: readonly Reference[] = [
  esp('esp-laitue', 'Laitue', ['salade']),
  esp('esp-batavia', 'Batavia'),
  esp('esp-tomate', 'Tomate'),
  esp('esp-carotte', 'Carotte'),
  esp('esp-poireau', 'Poireau'),
  esp('esp-radis', 'Radis'),
  esp('esp-epinard', 'Épinard'),
  esp('esp-chou', 'Chou'),
  esp('esp-courgette', 'Courgette'),
  esp('esp-betterave', 'Betterave'),
  esp('esp-fraisier', 'Fraisier', ['fraise']),
  esp('esp-pivoine', 'Pivoine'),
];

export const FAMILLES: readonly Reference[] = [
  esp('fam-alliacees', 'Alliacées'),
  esp('fam-amaranthacees', 'Amaranthacées'),
  esp('fam-apiacees', 'Apiacées'),
  esp('fam-asteracees', 'Astéracées'),
  esp('fam-brassicacees', 'Brassicacées'),
  esp('fam-cucurbitacees', 'Cucurbitacées'),
  esp('fam-solanacees', 'Solanacées'),
];

export const BIBLIOTHEQUE: Bibliotheque = { especes: ESPECES, familles: FAMILLES };

/** Gèle en profondeur (objets et tableaux) : une fonction qui modifie son entrée lève alors. */
export function geler<T>(valeur: T): T {
  if (typeof valeur === 'object' && valeur !== null && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}
