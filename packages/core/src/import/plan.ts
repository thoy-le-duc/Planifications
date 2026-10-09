/**
 * Plan d'import (T14) : validation et aperçu de ce qui SERAIT importé, sans rien écrire.
 * Lignes valides, en erreur (toutes les erreurs, avec le motif), à décider, doublons ; lignes
 * vides et de total ignorées ; hiérarchie du parcellaire reprise des cellules fusionnées.
 */
import { CHAMPS_IMPORT } from './champs.ts';
import { LONGUEUR_MAX_CELLULE, cle, lireDate, lireDateSemaine, lireMesure, lireNombre, multiplierPuissanceDix, numeroSemaine, premiersNombresDate, texteCellule } from './normalisation.ts';
import { jourAbsolu, lundiDeSemaine, nombreSemainesIso, type DateCalendaire } from '../dates/index.ts';
import { rapprocher } from './rapprochement.ts';
import type {
  AvertissementImport,
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
  LignePlan,
  PlanImport,
  PropositionValeur,
  ReferenceImport,
  OptionsDate,
  StatutLigne,
  SystemeDates,
  UniteColonne,
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
/** T35a : disposition des rangs. Vide → null (la densité reste sans disposition : alignée). */
const DISPOSITIONS: Readonly<Record<string, string>> = {
  quinconce: 'quinconce',
  'en quinconce': 'quinconce',
  aligne: 'alignee',
  alignee: 'alignee',
  alignes: 'alignee',
  alignees: 'alignee',
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
  disposition: { sorte: 'choix', valeurs: DISPOSITIONS, attendus: 'alignés ou quinconce' },
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

/** `t` coupé à `n` caractères au plus (points de suspension compris), sans couper de paire de substitution. */
function couper(t: string, n: number): string {
  if (t.length <= n) return t;
  let fin = n - 1;
  const derniere = t.charCodeAt(fin - 1);
  if (derniere >= 0xd800 && derniere <= 0xdbff) fin--;
  return `${t.slice(0, fin)}…`;
}

function libelle(type: PlanImport['type'], c: CleChamp | null): string {
  if (c === null) return '';
  return CHAMPS_IMPORT[type].find((d) => d.cle === c)?.libelle ?? c;
}

/**
 * Message d'une erreur. Il ne cite pas la cellule (T14c) : elle se relit dans
 * `lignes[ligne - 1][colonne]`, et une même erreur peut ainsi être partagée par toutes les lignes
 * (400 000 lignes à 5 erreurs tiennent dans 512 Mo). Seul l'ordre des dates cite les deux dates.
 */
function message(code: CodeErreurImport, nomChamp: string, detail = ''): string {
  const m = (() => {
    switch (code) {
      case 'nombre_invalide':
        return `${nomChamp} : la valeur n’est pas un nombre${detail}.`;
      case 'unite_inconnue':
        return `${nomChamp} : unité non reconnue (m, cm, kg ou g).`;
      case 'date_invalide':
        return `${nomChamp} : la valeur n’est pas une date valide (JJ/MM/AAAA, AAAA-MM-JJ ou semaine S14).`;
      case 'annee_manquante':
        return `${nomChamp} : la valeur est une semaine ; indiquez l’année de la saison.`;
      case 'champ_manquant':
        return detail !== '' ? detail : `${nomChamp} : valeur obligatoire manquante.`;
      case 'valeur_inconnue':
        return `${nomChamp} : valeur non reconnue${detail}.`;
      case 'hors_bornes':
        return `${nomChamp} : valeur hors des limites${detail}.`;
      case 'dates_incoherentes':
        return `${nomChamp} : ${detail} ; les dates d’une série doivent se suivre (semis, plantation, début puis fin de récolte).`;
      case 'colonnes_en_trop':
        return `Cellule hors des colonnes de l’en-tête (colonne ${detail}) : ajoutez-lui un en-tête ou effacez-la.`;
      case 'texte_trop_long':
        return `${nomChamp} : texte trop long (${String(LONGUEUR_MAX_CELLULE)} caractères au plus).`;
      case 'champ_en_double':
        return `${nomChamp} : associé à plusieurs colonnes (${detail}) ; n’en gardez qu’une dans la correspondance.`;
    }
  })();
  return couper(m, 200);
}

/**
 * Erreurs d'un plan, partagées : une même erreur (code, champ, colonne, détail) est un seul objet
 * gelé pour toutes les lignes qui l'ont.
 */
function erreursPartagees(type: PlanImport['type']): (code: CodeErreurImport, champ: CleChamp | null, colonne: number | null, detail?: string) => ErreurImport {
  const memoire = new Map<string, ErreurImport>();
  return (code, champ, colonne, detail = '') => {
    const k = `${code}\u0001${champ ?? ''}\u0001${colonne === null ? '' : String(colonne)}\u0001${detail}`;
    let e = memoire.get(k);
    if (e === undefined) {
      e = Object.freeze({ code, champ, colonne, message: message(code, libelle(type, champ), detail) });
      memoire.set(k, e);
    }
    return e;
  };
}

/** Lettre de colonne du tableur : 0 → A, 26 → AA. */
function lettreColonne(i: number): string {
  let n = i + 1;
  let t = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    t = String.fromCharCode(65 + r) + t;
    n = Math.floor((n - 1) / 26);
  }
  return t;
}

// ── Lecture d'une cellule ────────────────────────────────────────────────────────────────────

type Lu = { readonly ok: true; readonly valeur: ValeurImport } | { readonly ok: false; readonly code: CodeErreurImport; readonly detail?: string };

interface Contexte {
  readonly anneeSaison: number | null;
  readonly unite: UniteColonne | null;
  readonly optionsDate: OptionsDate;
  readonly referencer: (champ: ChampReference, texte: string) => ReferenceImport;
}

/** Texte, choix ou référence de plus de 200 caractères (espaces autour retirés) : refusé, jamais normalisé. */
const TROP_LONG: Lu = { ok: false, code: 'texte_trop_long' };
const tropLong = (t: string | null): boolean => t !== null && t.length > LONGUEUR_MAX_CELLULE;

function lireCellule(nature: Nature, c: Cellule, ctx: Contexte): Lu {
  switch (nature.sorte) {
    case 'texte': {
      const t = texteCellule(c);
      return tropLong(t) ? TROP_LONG : { ok: true, valeur: t };
    }
    case 'choix': {
      const t = texteCellule(c);
      if (t === null) return { ok: true, valeur: null };
      if (tropLong(t)) return TROP_LONG;
      const k = cle(t);
      // Jamais une propriété héritée (« constructor », « __proto__ »…).
      const v = Object.hasOwn(nature.valeurs, k) ? nature.valeurs[k] : undefined;
      return v === undefined ? { ok: false, code: 'valeur_inconnue', detail: ` (attendu : ${nature.attendus})` } : { ok: true, valeur: v };
    }
    case 'mesure': {
      const r = lireMesure(c, nature.unite, uniteMesure(ctx.unite));
      if (!r.ok) return r;
      if (r.valeur !== null && r.valeur <= 0) return { ok: false, code: 'hors_bornes', detail: ' : elle doit être positive' };
      return r;
    }
    case 'nombre': {
      const lu = lireNombre(c);
      if (!lu.ok) return lu;
      // Hectares → m², exact (« 1,5 » → 15 000).
      const r = lu.valeur !== null && ctx.unite === 'ha' ? { ok: true as const, valeur: multiplierPuissanceDix(lu.valeur, 4) } : lu;
      if (r.valeur !== null && r.valeur <= 0) return { ok: false, code: 'hors_bornes', detail: ' : il doit être positif' };
      return r;
    }
    case 'entier': {
      const lu = lireNombre(c);
      if (!lu.ok) return lu;
      if (lu.valeur === null) return lu;
      // Semaines → jours : le résultat doit rester un nombre entier de jours.
      const r = { ok: true as const, valeur: ctx.unite === 'semaine' ? lu.valeur * 7 : lu.valeur };
      if (!Number.isInteger(r.valeur)) return { ok: false, code: 'nombre_invalide', detail: ' entier' };
      if (r.valeur < nature.min || (nature.max !== null && r.valeur > nature.max)) {
        const borne = nature.max === null ? `au moins ${String(nature.min)}` : `de ${String(nature.min)} à ${String(nature.max)}`;
        return { ok: false, code: 'hors_bornes', detail: ` (${borne})` };
      }
      return r;
    }
    case 'date':
      return ctx.unite === 'semaine' ? lireDateSemaine(c, ctx.anneeSaison, ctx.optionsDate) : lireDate(c, ctx.anneeSaison, ctx.optionsDate);
    case 'reference': {
      const t = texteCellule(c);
      if (tropLong(t)) return TROP_LONG;
      return { ok: true, valeur: t === null ? null : ctx.referencer(nature.champ, t) };
    }
  }
}

function uniteMesure(u: UniteColonne | null): UniteMesure | null {
  return u === 'm' || u === 'cm' || u === 'kg' || u === 'g' ? u : null;
}

// ── Lignes ignorées ──────────────────────────────────────────────────────────────────────────

const TOTAL = /^(?:total|sous total)(?: |$)/;
const SOMME = /^somme(?: |$)/;

const celluleVide = (c: Cellule | undefined): boolean => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');

/**
 * 'vide' : toutes les cellules vides ; 'total' : la première cellule non vide des colonnes
 * associées commence par « total » ou « sous-total », ou par « somme » si l'emplacement est vide
 * (« Somme » est aussi un nom de lieu).
 */
function motifIgnoree(ligne: LigneBrute, associees: readonly number[], colEmplacement: number | undefined): 'vide' | 'total' | null {
  if (ligne.every(celluleVide)) return 'vide';
  for (const i of associees) {
    const t = texteCellule(ligne[i]);
    if (t === null) continue;
    if (typeof ligne[i] === 'number') return null;
    const k = cle(t.length > 200 ? t.slice(0, 200) : t);
    if (TOTAL.test(k)) return 'total';
    if (SOMME.test(k) && (colEmplacement === undefined || texteCellule(ligne[colEmplacement]) === null)) return 'total';
    return null;
  }
  return null;
}

// ── Ordre des dates ──────────────────────────────────────────────────────────────────────────

/**
 * JJ/MM ou MM/JJ, décidé par colonne sur toutes ses lignes : une valeur « a/b/AAAA » avec a > 12
 * → JJ/MM ; sinon une avec b > 12 → MM/JJ ; sinon JJ/MM (défaut français).
 */
function ordreColonne(lignes: readonly LigneBrute[], debut: number, colonne: number, nettoyer: (c: Cellule | undefined) => Cellule): 'jj_mm' | 'mm_jj' {
  let mmJj = false;
  for (let i = debut; i < lignes.length; i++) {
    const n = premiersNombresDate(nettoyer(lignes[i]?.[colonne]));
    if (n === null) continue;
    if (n[0] > 12) return 'jj_mm';
    if (n[1] > 12) mmJj = true;
  }
  return mmJj ? 'mm_jj' : 'jj_mm';
}

/** Largeur de l'en-tête : position de sa dernière cellule non vide + 1 ; `null` sans en-tête. */
function largeurEntete(entete: LigneBrute | undefined): number | null {
  if (entete === undefined) return null;
  for (let i = entete.length - 1; i >= 0; i--) if (!celluleVide(entete[i])) return i + 1;
  return 0;
}

// ── Doublons ─────────────────────────────────────────────────────────────────────────────────

function cleValeur(v: ValeurImport | undefined, k: (t: string) => string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return k(v);
  switch (v.sorte) {
    case 'existante':
      return `e:${v.id}`;
    case 'nouvelle':
      return `n:${k(v.nom)}`;
    case 'a_decider':
      return `d:${k(v.valeur)}`;
  }
}

/**
 * `cle` mémorisée pour un plan : une même chaîne (chaîne partagée d'un classeur répétée sur des
 * milliers de lignes) n'est normalisée qu'une fois, le temps reste linéaire.
 */
function cleMemorisee(): (t: string) => string {
  const memoire = new Map<string, string>();
  return (t) => {
    let k = memoire.get(t);
    if (k === undefined) {
      k = cle(t);
      memoire.set(t, k);
    }
    return k;
  };
}

/**
 * Cellule sans espaces autour, mémorisée par chaîne pour un plan (3e relecture, point 1) : une
 * chaîne partagée de 32 767 caractères répétée sur 100 000 lignes n'est nettoyée qu'une fois.
 * Toutes les lectures retirent ces espaces : le résultat ne change pas, seul le temps baisse.
 */
const NETTOYAGE_SANS_MEMOIRE = 256;

function nettoyageMemorise(): (c: Cellule | undefined) => Cellule {
  const memoire = new Map<string, string>();
  return (c) => {
    if (c === undefined) return null;
    // Chaîne courte : la nettoyer coûte moins que la retenir (400 000 lignes aux valeurs toutes
    // différentes ne remplissent pas la mémoire, T14c).
    if (typeof c !== 'string' || c.length <= NETTOYAGE_SANS_MEMOIRE) return typeof c === 'string' ? c.trim() : c;
    let t = memoire.get(c);
    if (t === undefined) {
      t = c.trim();
      memoire.set(c, t);
    }
    return t;
  };
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

interface DecisionEnCours {
  readonly champ: ChampReference;
  readonly valeur: string;
  readonly lignes: number[];
  readonly propositions: readonly PropositionValeur[];
}

/**
 * Premier champ date (semis, plantation, début, fin de récolte) qui précède la date d'un champ
 * précédent ; `null` si les dates présentes se suivent (égalité permise).
 */
function datesDansLeDesordre(
  valeurs: Partial<Record<CleChamp, ValeurImport>>,
): { readonly champ: CleChamp; readonly date: string; readonly precedent: CleChamp; readonly datePrecedente: string } | null {
  let plusTard: { readonly champ: CleChamp; readonly date: string } | null = null;
  for (const c of DATES) {
    const v = valeurs[c];
    if (typeof v !== 'string') continue;
    if (plusTard !== null && v < plusTard.date) return { champ: c, date: v, precedent: plusTard.champ, datePrecedente: plusTard.date };
    if (plusTard === null || v > plusTard.date) plusTard = { champ: c, date: v };
  }
  return null;
}

/** Écart maximal (en jours) entre la première et la dernière date d'une ligne qui change d'année. */
const ECART_MAX_JOURS = 364;

/**
 * Dates données en semaines (T14d, Q18) : une semaine qui retombe avant la date précédente passe à
 * l'année suivante, une seule fois. Corrige `valeurs` en place et renvoie les champs concernés ;
 * `depassement` est la première date plus de 364 jours après la première de la ligne. Une
 * deuxième retombée n'est pas corrigée : l'ordre des dates la signale.
 */
function passerALAnneeSuivante(
  valeurs: Partial<Record<CleChamp, ValeurImport>>,
  semaines: ReadonlyMap<CleChamp, number>,
  anneeSaison: number | null,
): { readonly changees: readonly CleChamp[]; readonly depassement: CleChamp | null } {
  const changees: CleChamp[] = [];
  let depassement: CleChamp | null = null;
  let decalage = 0;
  let precedente: string | null = null;
  let premiere: DateCalendaire | null = null;
  for (const c of DATES) {
    let v = valeurs[c];
    if (typeof v !== 'string') continue;
    const semaine = semaines.get(c);
    if (semaine !== undefined && anneeSaison !== null) {
      const lundi = (annee: number): DateCalendaire | null => (semaine <= nombreSemainesIso(annee) ? lundiDeSemaine(annee, semaine) : null);
      let date = lundi(anneeSaison + decalage);
      if (decalage === 0 && date !== null && precedente !== null && date < precedente) {
        const suivante = lundi(anneeSaison + 1);
        if (suivante !== null) {
          decalage = 1;
          date = suivante;
          changees.push(c);
        }
      }
      if (date !== null) {
        v = date;
        valeurs[c] = date;
      }
    }
    precedente = v;
    premiere ??= v as DateCalendaire;
    if (decalage === 1 && depassement === null && jourAbsolu(v as DateCalendaire) - jourAbsolu(premiere) > ECART_MAX_JOURS) depassement = c;
  }
  return { changees, depassement };
}

function entierBorne(n: number, defaut: number): number {
  return Number.isFinite(n) ? Math.max(-1, Math.floor(n)) : defaut;
}

/** Prépare l'import : ce qui SERAIT importé, ligne par ligne. Pur, ne lève pas, n'écrit rien. */
export function preparerImport(entree: EntreeImport): PlanImport {
  const { correspondance, bibliotheque, anneeSaison } = entree;
  const cleDe = cleMemorisee();
  const nettoyer = nettoyageMemorise();
  const erreur = erreursPartagees(correspondance.type);
  const systemeDates: SystemeDates = entree.systemeDates === 1904 ? 1904 : 1900;
  const type = correspondance.type;
  const definitions = CHAMPS_IMPORT[type];
  const permis = new Set<CleChamp>(definitions.map((d) => d.cle));

  // Colonnes associées, par champ du type. Un champ sur plusieurs colonnes n'est lu sur aucune :
  // chaque ligne est en erreur 'champ_en_double' (colonne = la deuxième qui le porte).
  const indicesDe = new Map<CleChamp, { readonly indices: number[]; readonly unite: UniteColonne | null }>();
  correspondance.colonnes.forEach((a, indice) => {
    if (a.champ === null || !permis.has(a.champ)) return;
    const deja = indicesDe.get(a.champ);
    if (deja === undefined) indicesDe.set(a.champ, { indices: [indice], unite: a.unite });
    else deja.indices.push(indice);
  });
  const colonnes: { readonly indice: number; readonly champ: CleChamp; readonly unite: UniteColonne | null }[] = [];
  const colonneDe = new Map<CleChamp, number>();
  const enDouble: { readonly champ: CleChamp; readonly indices: readonly number[] }[] = [];
  for (const [champ, { indices, unite }] of indicesDe) {
    const [premier, deuxieme] = indices;
    if (premier === undefined) continue;
    colonneDe.set(champ, premier);
    if (deuxieme === undefined) colonnes.push({ indice: premier, champ, unite });
    else enDouble.push({ champ, indices });
  }
  colonnes.sort((a, b) => a.indice - b.indice);
  const obligatoires = definitions.filter((d) => d.obligatoire).map((d) => d.cle);
  const nonAssocies = obligatoires.filter((c) => !colonneDe.has(c));

  // Décisions déjà prises, et rapprochements mis en cache par valeur normalisée.
  // Un choix `existante` dont l'identifiant n'est plus dans la bibliothèque est écarté : la valeur
  // repasse « à décider ».
  const references = (champ: ChampReference): Bibliotheque[keyof Bibliotheque] => (champ === 'espece' ? bibliotheque.especes : bibliotheque.familles);
  const ids: Readonly<Record<ChampReference, ReadonlySet<string>>> = {
    espece: new Set(bibliotheque.especes.map((e) => e.id)),
    famille: new Set(bibliotheque.familles.map((f) => f.id)),
  };
  const choix = new Map<string, DecisionPrise>();
  for (const ch of entree.choix ?? []) {
    const k = `${ch.champ}\u0001${cle(ch.valeur)}`;
    if (choix.has(k)) continue;
    if (ch.decision.sorte === 'existante') {
      if (ids[ch.champ].has(ch.decision.id)) choix.set(k, { sorte: 'existante', id: ch.decision.id });
    } else choix.set(k, { sorte: 'nouvelle', nom: ch.decision.nom });
  }
  const cache = new Map<string, ReferenceImport | { readonly aDecider: true; readonly propositions: readonly PropositionValeur[] }>();
  const decisions = new Map<string, DecisionEnCours>();
  let numeroCourant = 0;
  const referencer = (champ: ChampReference, texte: string): ReferenceImport => {
    const k = `${champ}\u0001${cleDe(texte)}`;
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
  const ignorees: { readonly debut: number; fin: number; readonly motif: 'vide' | 'total' }[] = [];
  let nombreIgnorees = 0;
  const vues = new Map<string, number>();
  const cleDoublon = CLES_DOUBLON[type];
  const hierarchie = type === 'parcellaire';
  const colZone = colonneDe.get('zone');
  const colSousZone = colonneDe.get('sous_zone');
  let zoneReprise: string | null = null;
  let sousZoneReprise: string | null = null;

  const ligneEntete = entierBorne(entree.ligneEntete, -1);
  const debut = Math.max(0, ligneEntete + 1);
  const largeur = ligneEntete >= 0 ? largeurEntete(entree.lignes[ligneEntete]) : null;
  const associees = [...indicesDe.values()].flatMap((d) => d.indices).sort((a, b) => a - b);
  const colEmplacement = colonneDe.get('emplacement');
  const optionsDates = new Map<number, OptionsDate>();
  for (const col of colonnes) {
    if (NATURES[col.champ].sorte === 'date') optionsDates.set(col.indice, { ordre: ordreColonne(entree.lignes, debut, col.indice, nettoyer), systemeDates });
  }
  const optionsParDefaut: OptionsDate = { systemeDates };
  // Erreurs de la correspondance, les mêmes pour chaque ligne.
  const erreursDeCorrespondance: readonly ErreurImport[] = [
    ...nonAssocies.map((c) => erreur('champ_manquant', c, null, `${libelle(type, c)} : aucune colonne du fichier n’y est associée.`)),
    ...enDouble.map((d) => erreur('champ_en_double', d.champ, d.indices[1] ?? null, d.indices.map(lettreColonne).join(', '))),
  ];

  for (let i = debut; i < entree.lignes.length; i++) {
    // Cellules nettoyées une fois par chaîne (toutes les lectures retirent les espaces autour).
    const brute = (entree.lignes[i] ?? []).map(nettoyer);
    const numero = i + 1;
    const motif = motifIgnoree(brute, associees, colEmplacement);
    if (motif !== null) {
      // Plages : une ligne qui suit la précédente ignorée, avec le même motif, l'allonge.
      nombreIgnorees++;
      const derniere = ignorees[ignorees.length - 1];
      if (derniere?.motif === motif && derniere.fin === numero - 1) derniere.fin = numero;
      else ignorees.push({ debut: numero, fin: numero, motif });
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
        if (zoneReprise === null || cleDe(z) !== cleDe(zoneReprise)) sousZoneReprise = null;
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
    const erreurs: ErreurImport[] = [...erreursDeCorrespondance];
    const ctxBase = { anneeSaison, referencer };
    const semaines = new Map<CleChamp, number>();
    for (const col of colonnes) {
      const cellule = remplacees.get(col.indice) ?? brute[col.indice] ?? null;
      const lu = lireCellule(NATURES[col.champ], cellule, { ...ctxBase, unite: col.unite, optionsDate: optionsDates.get(col.indice) ?? optionsParDefaut });
      if (!lu.ok) {
        erreurs.push(erreur(lu.code, col.champ, col.indice, lu.detail));
        continue;
      }
      valeurs[col.champ] = lu.valeur;
      if (typeof lu.valeur === 'string' && DATES.includes(col.champ)) {
        const semaine = numeroSemaine(cellule, col.unite === 'semaine');
        if (semaine !== null) semaines.set(col.champ, semaine);
      }
      if (lu.valeur === null && obligatoires.includes(col.champ)) erreurs.push(erreur('champ_manquant', col.champ, col.indice));
    }

    // Règles de ligne : une date au moins pour une série, dans l'ordre ; un lieu et une culture
    // pour l'assolement ; rien au-delà des colonnes de l'en-tête.
    const vide = (c: CleChamp) => (valeurs[c] ?? null) === null && !erreurs.some((e) => e.champ === c);
    if (type === 'series' && DATES.every(vide)) {
      erreurs.push(erreur('champ_manquant', null, null, 'Il faut au moins une date : semis, plantation, début ou fin de récolte.'));
    }
    let avertissements: AvertissementImport[] = [];
    if (type === 'series') {
      // Semaines qui retombent avant la précédente : année suivante, signalée (T14d).
      const { changees, depassement } = passerALAnneeSuivante(valeurs, semaines, anneeSaison);
      // L'année est celle de la semaine (saison + 1), pas l'année civile de son lundi.
      const annee = (anneeSaison ?? 0) + 1;
      avertissements = changees.map((champ) => ({
        code: 'annee_suivante',
        champ,
        colonne: colonneDe.get(champ) ?? null,
        annee,
        message: `${libelle(type, champ).toLowerCase().replace(/^date de /, '')} en ${String(annee)}`,
      }));
      if (depassement !== null) {
        erreurs.push(erreur('dates_incoherentes', depassement, colonneDe.get(depassement) ?? null, 'plus d’un an entre la première et la dernière date'));
      }
      const desordre = datesDansLeDesordre(valeurs);
      if (desordre !== null) {
        const colonne = colonneDe.get(desordre.champ) ?? null;
        erreurs.push(erreur('dates_incoherentes', desordre.champ, colonne, `${desordre.date} précède ${libelle(type, desordre.precedent).toLowerCase()} (${desordre.datePrecedente})`));
      }
    }
    if (type === 'assolement') {
      if (vide('zone') && vide('emplacement')) {
        erreurs.push(erreur('champ_manquant', null, null, 'Il faut une zone ou un emplacement.'));
      }
      if (vide('famille') && vide('espece')) {
        erreurs.push(erreur('champ_manquant', null, null, 'Il faut une famille ou une culture.'));
      }
    }

    if (largeur !== null) {
      for (let j = largeur; j < brute.length; j++) {
        if (celluleVide(brute[j])) continue;
        erreurs.push(erreur('colonnes_en_trop', null, j, lettreColonne(j)));
        break;
      }
    }

    let statut: StatutLigne;
    let doublonDe: number | null = null;
    if (erreurs.length > 0) statut = 'erreur';
    else {
      const aDecider = Object.values(valeurs).some((v) => typeof v === 'object' && v !== null && v.sorte === 'a_decider');
      const champsCle = cleDoublon ?? colonnes.map((c) => c.champ);
      const k = champsCle.map((c) => cleValeur(valeurs[c], cleDe)).join('\u0001');
      const premiere = vues.get(k);
      if (premiere === undefined) vues.set(k, numero);
      if (aDecider) statut = 'a_decider';
      else if (premiere !== undefined) {
        statut = 'doublon';
        doublonDe = premiere;
      } else statut = 'valide';
    }
    lignes.push(erreurs.length === 0 && avertissements.length > 0 ? { ligne: numero, statut, valeurs, erreurs, doublonDe, avertissements } : { ligne: numero, statut, valeurs, erreurs, doublonDe });
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
    resume: { valides: compter('valide'), erreurs: compter('erreur'), aDecider: compter('a_decider'), doublons: compter('doublon'), ignorees: nombreIgnorees },
  };
}
