/**
 * Correspondance des valeurs (T14) : une culture ou une famille écrite dans le fichier est
 * rapprochée de la bibliothèque. Exacte (nom, synonyme ou identifiant, par `cle`) ou proposée
 * avec un score déterministe dans [0,5 ; 1[.
 */
import { cle } from './normalisation.ts';
import type { PropositionValeur, Rapprochement, Reference } from './types.ts';

const SEUIL = 0.5;
const MAX_PROPOSITIONS = 5;
const SCORE_MAX_APPROCHE = 0.99;

/** Mot ramené au singulier grossièrement (« carottes » → « carotte », « poireaux » → « poireau »). */
function radical(mot: string): string {
  return mot.length > 3 && (mot.endsWith('s') || mot.endsWith('x')) ? mot.slice(0, -1) : mot;
}

function mots(k: string): string[] {
  return k.split(' ').filter((m) => m !== '').map(radical);
}

/** Bigrammes (avec leur nombre) d'une clé sans espaces. */
function bigrammes(k: string): Map<string, number> {
  const s = k.replaceAll(' ', '');
  const b = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s.slice(i, i + 2);
    b.set(g, (b.get(g) ?? 0) + 1);
  }
  return b;
}

function totalBigrammes(b: ReadonlyMap<string, number>): number {
  let n = 0;
  for (const v of b.values()) n += v;
  return n;
}

interface Valeur {
  readonly cle: string;
  readonly mots: ReadonlySet<string>;
  readonly bigrammes: ReadonlyMap<string, number>;
  readonly total: number;
}

/** Score d'un nom de la bibliothèque pour la valeur : inclusion de tous ses mots, sinon Dice. */
function score(v: Valeur, nom: string): number {
  const k = cle(nom);
  if (k === '') return 0;
  let s = 0;
  const m = mots(k);
  if (m.length > 0 && m.every((x) => v.mots.has(x))) {
    s = 0.7 + 0.29 * Math.min(1, k.length / v.cle.length);
  }
  const b = bigrammes(k);
  const total = totalBigrammes(b);
  if (total > 0 && v.total > 0) {
    let communs = 0;
    for (const [g, n] of b) communs += Math.min(n, v.bigrammes.get(g) ?? 0);
    s = Math.max(s, (0.95 * 2 * communs) / (total + v.total));
  }
  return Math.min(SCORE_MAX_APPROCHE, Math.round(s * 1000) / 1000);
}

/** Exacte si la valeur normalisée égale un nom, un synonyme ou un identifiant ; sinon propositions. */
export function rapprocher(valeur: string, references: readonly Reference[]): Rapprochement {
  const k = cle(valeur);
  if (k === '') return { exact: false, propositions: [] };
  for (const r of references) {
    if (cle(r.nom) === k || cle(r.id) === k || (r.synonymes ?? []).some((s) => cle(s) === k)) {
      return { exact: true, propositions: [{ id: r.id, nom: r.nom, score: 1 }] };
    }
  }
  const b = bigrammes(k);
  const v: Valeur = { cle: k, mots: new Set(mots(k)), bigrammes: b, total: totalBigrammes(b) };
  const propositions: PropositionValeur[] = [];
  for (const r of references) {
    let meilleur = score(v, r.nom);
    for (const s of r.synonymes ?? []) meilleur = Math.max(meilleur, score(v, s));
    if (meilleur >= SEUIL) propositions.push({ id: r.id, nom: r.nom, score: meilleur });
  }
  propositions.sort((a, b2) => b2.score - a.score || (a.nom < b2.nom ? -1 : a.nom > b2.nom ? 1 : a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0));
  return { exact: false, propositions: propositions.slice(0, MAX_PROPOSITIONS) };
}
