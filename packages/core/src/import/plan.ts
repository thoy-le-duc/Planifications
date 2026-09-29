/**
 * Plan d'import (T14) : validation et aperçu de ce qui SERAIT importé, sans rien écrire.
 * Lignes valides, en erreur (toutes les erreurs, avec le motif), à décider, doublons ; lignes
 * vides et de total ignorées ; hiérarchie du parcellaire reprise des cellules fusionnées.
 */
import { CHAMPS_IMPORT } from './champs.ts';
import { cle, lireDate, lireMesure, lireNombre, texteCellule } from './normalisation.ts';
import { rapprocher } from './rapprochement.ts';
import type {
  Bibliotheque,
  Cellule,
  ChampReference,
  CleChamp,
  CodeErreurImport,
  DecisionPrise,
  DecisionValeur,
  EntreeImport,
  ErreurImport,
  LigneBrute,
  LigneIgnoree,
  LignePlan,
  PlanImport,
  PropositionValeur,
  ReferenceImport,
  StatutLigne,
  UniteMesure,
  ValeurImport,
} from './types.ts';

// ── Nature des champs ────────────────────────────────────────────────────────────────────────

type Nature =
  | { readonly sorte: 'texte' }
  | { readonly sorte: 'choix'; readonly valeurs: Readonly<Record<string, string>>; readonly attendus: string }
  | { readonly sorte: 'mesure'; readonly unite: UniteMesure }
  | { readonly sorte: 'nombre' }
  | { readonly sorte: 'entier'; readonly min: number; readonly max: number | null }
  | { readonly sorte: 'date' }
  | { readonly sorte: 'reference'; readonly champ: ChampReference };

/** Valeurs acceptées des champs à choix, par clé normalisée (`cle`). */
const SORTES: Readonly<Record<string, string>> = {
  planche: 'planche',
  bed: 'planche',
  rang: 'rang',
  row: 'rang',
  gouttiere: 'gouttiere',
  gutter: 'gouttiere',
};
const ABRIS: Readonly<Record<string, string>> = {
  'plein champ': 'plein_champ',
  'open field': 'plein_champ',
  champ: 'plein_champ',
  exterieur: 'plein_champ',
  tunnel: 'tunnel',
  serre: 'serre',
  greenhouse: 'serre',
  'hors sol': 'hors_sol',
  hydroponie: 'hors_sol',
};
const MODES: Readonly<Record<string, string>> = {
  'semis direct': 'semis_direct',
  'plant maison': 'plant_maison',
  'plant achete': 'plant_achete',
};

const TEXTE: Nature = { sorte: 'texte' };
const DATE: Nature = { sorte: 'date' };
const JOURS: Nature = { sorte: 'entier', min: 0, max: 3650 };
const AU_MOINS_UN: Nature = { sorte: 'entier', min: 1, max: null };

const NATURES: Readonly<Record<CleChamp, Nature>> = {
  zone: TEXTE,
  sous_zone: TEXTE,
  emplacement: TEXTE,
  variete: TEXTE,
  sorte: { sorte: 'choix', valeurs: SORTES, attendus: 'planche, rang ou gouttière' },
  type_abri: { sorte: 'choix', valeurs: ABRIS, attendus: 'plein champ, tunnel, serre ou hors sol' },
  mode: { sorte: 'choix', valeurs: MODES, attendus: 'semis direct, plant maison ou plant acheté' },
  longueur_m: { sorte: 'mesure', unite: 'm' },
  largeur_m: { sorte: 'mesure', unite: 'm' },
  ecartement_cm: { sorte: 'mesure', unite: 'cm' },
  poids_mille_graines_g: { sorte: 'mesure', unite: 'g' },
  surface_m2: { sorte: 'nombre' },
  nombre_places: AU_MOINS_UN,
  nombre_plants: AU_MOINS_UN,
  rangs_par_planche: AU_MOINS_UN,
  duree_pepiniere_jours: JOURS,
  duree_avant_recolte_jours: JOURS,
  fenetre_recolte_jours: JOURS,
  annee: { sorte: 'entier', min: 2000, max: 2100 },
  date_semis: DATE,
  date_plantation: DATE,
  date_debut_recolte: DATE,
  date_fin_recolte: DATE,
  espece: { sorte: 'reference', champ: 'espece' },
  famille: { sorte: 'reference', champ: 'famille' },
};

const DATES: readonly CleChamp[] = ['date_semis', 'date_plantation', 'date_debut_recolte', 'date_fin_recolte'];

/** Clé de doublon par type ; `null` : toutes les valeurs (séries). */
const CLES_DOUBLON: Readonly<Record<PlanImport['type'], readonly CleChamp[] | null>> = {
  parcellaire: ['zone', 'sous_zone', 'emplacement'],
  cultures: ['espece', 'variete', 'mode'],
  series: null,
  assolement: ['annee', 'zone', 'emplacement', 'famille', 'espece'],
};

// ── Messages ─────────────────────────────────────────────────────────────────────────────────

function extrait(c: Cellule | undefined): string {
  const t = c === null || c === undefined ? '' : String(c).trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

function libelle(type: PlanImport['type'], c: CleChamp | null): string {
  if (c === null) return '';
  return CHAMPS_IMPORT[type].find((d) => d.cle === c)?.libelle ?? c;
}

function message(code: CodeErreurImport, nomChamp: string, cellule: Cellule | undefined, detail = ''): string {
  const v = `« ${extrait(cellule)} »`;
  const m = (() => {
    switch (code) {
      case 'nombre_invalide':
        return `${nomChamp} : ${v} n’est pas un nombre${detail}.`;
      case 'unite_inconnue':
        return `${nomChamp} : unité non reconnue dans ${v} (m, cm, kg ou g).`;
      case 'date_invalide':
        return `${nomChamp} : ${v} n’est pas une date valide (JJ/MM/AAAA, AAAA-MM-JJ ou semaine S14).`;
      case 'annee_manquante':
        return `${nomChamp} : ${v} est une semaine ; indiquez l’année de la saison.`;
      case 'champ_manquant':
        return detail !== '' ? detail : `${nomChamp} : valeur obligatoire manquante.`;
      case 'valeur_inconnue':
        return `${nomChamp} : ${v} n’est pas une valeur reconnue${detail}.`;
      case 'hors_bornes':
        return `${nomChamp} : ${v} est hors des limites${detail}.`;
    }
  })();
  return m.length > 200 ? `${m.slice(0, 199)}…` : m;
}

// ── Lecture d'une cellule ────────────────────────────────────────────────────────────────────

type Lu = { readonly ok: true; readonly valeur: ValeurImport } | { readonly ok: false; readonly code: CodeErreurImport; readonly detail?: string };

interface Contexte {
  readonly anneeSaison: number | null;
  readonly unite: UniteMesure | null;
  readonly referencer: (champ: ChampReference, texte: string) => ReferenceImport;
}

function lireCellule(nature: Nature, c: Cellule, ctx: Contexte): Lu {
  switch (nature.sorte) {
    case 'texte':
      return { ok: true, valeur: texteCellule(c) };
    case 'choix': {
      const t = texteCellule(c);
      if (t === null) return { ok: true, valeur: null };
      const v = nature.valeurs[cle(t)];
      return v === undefined ? { ok: false, code: 'valeur_inconnue', detail: ` (attendu : ${nature.attendus})` } : { ok: true, valeur: v };
    }
    case 'mesure': {
      const r = lireMesure(c, nature.unite, ctx.unite);
      if (!r.ok) return r;
      if (r.valeur !== null && r.valeur <= 0) return { ok: false, code: 'hors_bornes', detail: ' : elle doit être positive' };
      return r;
    }
    case 'nombre': {
      const r = lireNombre(c);
      if (!r.ok) return r;
      if (r.valeur !== null && r.valeur <= 0) return { ok: false, code: 'hors_bornes', detail: ' : il doit être positif' };
      return r;
    }
    case 'entier': {
      const r = lireNombre(c);
      if (!r.ok) return r;
      if (r.valeur === null) return r;
      if (!Number.isInteger(r.valeur)) return { ok: false, code: 'nombre_invalide', detail: ' entier' };
      if (r.valeur < nature.min || (nature.max !== null && r.valeur > nature.max)) {
        const borne = nature.max === null ? `au moins ${String(nature.min)}` : `de ${String(nature.min)} à ${String(nature.max)}`;
        return { ok: false, code: 'hors_bornes', detail: ` (${borne})` };
      }
      return r;
    }
    case 'date':
      return lireDate(c, ctx.anneeSaison);
    case 'reference': {
      const t = texteCellule(c);
      return { ok: true, valeur: t === null ? null : ctx.referencer(nature.champ, t) };
    }
  }
}

// ── Lignes ignorées ──────────────────────────────────────────────────────────────────────────

const TOTAL = /^(?:total|sous total|somme)(?: |$)/;

function motifIgnoree(ligne: LigneBrute): 'vide' | 'total' | null {
  let vide = true;
  for (const c of ligne) {
    if (c === null) continue;
    if (typeof c === 'number') {
      vide = false;
      continue;
    }
    if (c.trim() === '') continue;
    vide = false;
    if (TOTAL.test(cle(c))) return 'total';
  }
  return vide ? 'vide' : null;
}

// ── Doublons ─────────────────────────────────────────────────────────────────────────────────

function cleValeur(v: ValeurImport | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return cle(v);
  switch (v.sorte) {
    case 'existante':
      return `e:${v.id}`;
    case 'nouvelle':
      return `n:${cle(v.nom)}`;
    case 'a_decider':
      return `d:${cle(v.valeur)}`;
  }
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

interface DecisionEnCours {
  readonly champ: ChampReference;
  readonly valeur: string;
  readonly lignes: number[];
  readonly propositions: readonly PropositionValeur[];
}

function entierBorne(n: number, defaut: number): number {
  return Number.isFinite(n) ? Math.max(-1, Math.floor(n)) : defaut;
}

/** Prépare l'import : ce qui SERAIT importé, ligne par ligne. Pur, ne lève pas, n'écrit rien. */
export function preparerImport(entree: EntreeImport): PlanImport {
  const { correspondance, bibliotheque, anneeSaison } = entree;
  const type = correspondance.type;
  const definitions = CHAMPS_IMPORT[type];
  const permis = new Set<CleChamp>(definitions.map((d) => d.cle));

  // Colonnes associées : un champ du type par colonne, la première seulement.
  const colonnes: { readonly indice: number; readonly champ: CleChamp; readonly unite: UniteMesure | null }[] = [];
  const colonneDe = new Map<CleChamp, number>();
  correspondance.colonnes.forEach((a, indice) => {
    if (a.champ === null || !permis.has(a.champ) || colonneDe.has(a.champ)) return;
    colonneDe.set(a.champ, indice);
    colonnes.push({ indice, champ: a.champ, unite: a.unite });
  });
  const obligatoires = definitions.filter((d) => d.obligatoire).map((d) => d.cle);
  const nonAssocies = obligatoires.filter((c) => !colonneDe.has(c));

  // Décisions déjà prises, et rapprochements mis en cache par valeur normalisée.
  const choix = new Map<string, DecisionPrise>();
  for (const ch of entree.choix ?? []) {
    const k = `${ch.champ}\u0001${cle(ch.valeur)}`;
    if (!choix.has(k)) choix.set(k, ch.decision.sorte === 'existante' ? { sorte: 'existante', id: ch.decision.id } : { sorte: 'nouvelle', nom: ch.decision.nom });
  }
  const references = (champ: ChampReference): Bibliotheque[keyof Bibliotheque] => (champ === 'espece' ? bibliotheque.especes : bibliotheque.familles);
  const cache = new Map<string, ReferenceImport | { readonly aDecider: true; readonly propositions: readonly PropositionValeur[] }>();
  const decisions = new Map<string, DecisionEnCours>();
  let numeroCourant = 0;
  const referencer = (champ: ChampReference, texte: string): ReferenceImport => {
    const k = `${champ}\u0001${cle(texte)}`;
    let r = cache.get(k);
    if (r === undefined) {
      const decidee = choix.get(k);
      if (decidee !== undefined) r = decidee;
      else {
        const rap = rapprocher(texte, references(champ));
        const premiere = rap.propositions[0];
        r = rap.exact && premiere !== undefined ? { sorte: 'existante', id: premiere.id } : { aDecider: true, propositions: rap.propositions };
      }
      cache.set(k, r);
    }
    if ('sorte' in r) return r;
    let d = decisions.get(k);
    if (d === undefined) {
      d = { champ, valeur: texte, lignes: [], propositions: r.propositions };
      decisions.set(k, d);
    }
    if (d.lignes[d.lignes.length - 1] !== numeroCourant) d.lignes.push(numeroCourant);
    return { sorte: 'a_decider', valeur: texte };
  };

  const lignes: LignePlan[] = [];
  const ignorees: LigneIgnoree[] = [];
  const vues = new Map<string, number>();
  const cleDoublon = CLES_DOUBLON[type];
  const hierarchie = type === 'parcellaire';
  const colZone = colonneDe.get('zone');
  const colSousZone = colonneDe.get('sous_zone');
  let zoneReprise: string | null = null;
  let sousZoneReprise: string | null = null;

  const debut = entierBorne(entree.ligneEntete, -1) + 1;
  for (let i = Math.max(0, debut); i < entree.lignes.length; i++) {
    const brute = entree.lignes[i] ?? [];
    const numero = i + 1;
    const motif = motifIgnoree(brute);
    if (motif !== null) {
      ignorees.push({ ligne: numero, motif });
      continue;
    }
    numeroCourant = numero;

    // Hiérarchie : cellule vide = valeur de la ligne au-dessus ; nouvelle zone = sous-zone effacée.
    const remplacees = new Map<number, Cellule>();
    if (hierarchie && colZone !== undefined) {
      const z = texteCellule(brute[colZone]);
      if (z === null) {
        if (zoneReprise !== null) remplacees.set(colZone, zoneReprise);
      } else {
        if (zoneReprise === null || cle(z) !== cle(zoneReprise)) sousZoneReprise = null;
        zoneReprise = z;
      }
    }
    if (hierarchie && colSousZone !== undefined) {
      const s = texteCellule(brute[colSousZone]);
      if (s === null) {
        if (sousZoneReprise !== null) remplacees.set(colSousZone, sousZoneReprise);
      } else sousZoneReprise = s;
    }

    const valeurs: Partial<Record<CleChamp, ValeurImport>> = {};
    const erreurs: ErreurImport[] = [];
    for (const c of nonAssocies) {
      erreurs.push({ code: 'champ_manquant', champ: c, colonne: null, message: `${libelle(type, c)} : aucune colonne du fichier n’y est associée.` });
    }
    const ctxBase = { anneeSaison, referencer };
    for (const col of colonnes) {
      const cellule = remplacees.get(col.indice) ?? brute[col.indice] ?? null;
      const lu = lireCellule(NATURES[col.champ], cellule, { ...ctxBase, unite: col.unite });
      const nom = libelle(type, col.champ);
      if (!lu.ok) {
        erreurs.push({ code: lu.code, champ: col.champ, colonne: col.indice, message: message(lu.code, nom, cellule, lu.detail) });
        continue;
      }
      valeurs[col.champ] = lu.valeur;
      if (lu.valeur === null && obligatoires.includes(col.champ)) {
        erreurs.push({ code: 'champ_manquant', champ: col.champ, colonne: col.indice, message: message('champ_manquant', nom, cellule) });
      }
    }

    // Règles de ligne : une date au moins pour une série ; un lieu et une culture pour l'assolement.
    const vide = (c: CleChamp) => (valeurs[c] ?? null) === null && !erreurs.some((e) => e.champ === c);
    if (type === 'series' && DATES.every(vide)) {
      erreurs.push({ code: 'champ_manquant', champ: null, colonne: null, message: 'Il faut au moins une date : semis, plantation, début ou fin de récolte.' });
    }
    if (type === 'assolement') {
      if (vide('zone') && vide('emplacement')) {
        erreurs.push({ code: 'champ_manquant', champ: null, colonne: null, message: 'Il faut une zone ou un emplacement.' });
      }
      if (vide('famille') && vide('espece')) {
        erreurs.push({ code: 'champ_manquant', champ: null, colonne: null, message: 'Il faut une famille ou une culture.' });
      }
    }

    let statut: StatutLigne;
    let doublonDe: number | null = null;
    if (erreurs.length > 0) statut = 'erreur';
    else {
      const aDecider = Object.values(valeurs).some((v) => typeof v === 'object' && v !== null && v.sorte === 'a_decider');
      const champsCle = cleDoublon ?? colonnes.map((c) => c.champ);
      const k = champsCle.map((c) => cleValeur(valeurs[c])).join('\u0001');
      const premiere = vues.get(k);
      if (premiere === undefined) vues.set(k, numero);
      if (aDecider) statut = 'a_decider';
      else if (premiere !== undefined) {
        statut = 'doublon';
        doublonDe = premiere;
      } else statut = 'valide';
    }
    lignes.push({ ligne: numero, statut, valeurs, erreurs, doublonDe });
  }

  let niveaux: PlanImport['niveaux'] = null;
  if (hierarchie) {
    const n = (['zone', 'sous_zone', 'emplacement'] as const).filter((c) => colonneDe.has(c)).length;
    niveaux = n === 1 || n === 2 || n === 3 ? n : null;
  }

  const compter = (s: StatutLigne) => lignes.reduce((n, l) => (l.statut === s ? n + 1 : n), 0);
  const listeDecisions: DecisionValeur[] = [...decisions.values()].map((d) => ({ champ: d.champ, valeur: d.valeur, lignes: d.lignes, propositions: d.propositions }));
  return {
    type,
    lignes,
    ignorees,
    decisions: listeDecisions,
    niveaux,
    resume: { valides: compter('valide'), erreurs: compter('erreur'), aDecider: compter('a_decider'), doublons: compter('doublon'), ignorees: ignorees.length },
  };
}
