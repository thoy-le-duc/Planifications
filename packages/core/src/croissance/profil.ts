/**
 * Profil de croissance d'une espèce (T32a, Q32 option A) : constantes et règles du jsonb
 * `espece.profil_croissance`, que la base du téléphone et le serveur (apps/api) rejouent.
 *
 * Pures, sans exception quelle que soit l'entrée ; messages en français, sans nom technique.
 */
import type {
  AllureCroissance,
  CodeErreurCroissance,
  CycleAnnuel,
  DureeCroissance,
  FinDeCycle,
  FormePlant,
  ProfilCroissance,
  ResultatCroissance,
} from './types.ts';

export const FORMES_PLANT: readonly FormePlant[] = /* @__PURE__ */ Object.freeze([
  'erige-tuteure',
  'rosette',
  'touffe',
  'rampant',
  'buisson',
  'arbre-ou-liane',
  'bulbe-ou-racine',
] as const);
export const ALLURES: readonly AllureCroissance[] = /* @__PURE__ */ Object.freeze(['lineaire', 'en-s'] as const);
export const FINS_DE_CYCLE: readonly FinDeCycle[] = /* @__PURE__ */ Object.freeze(['conservee', 'baissee'] as const);

/** Hauteur maximale d'un profil, borne comprise (m) : un kiwi sur pergola reste bien en dessous. */
export const HAUTEUR_MAX_PROFIL_M = 6;
/** Durée maximale jusqu'à la hauteur maximale, en jours, borne comprise (deux ans). */
export const DUREE_MAX_JOURS = 730;
/** Longueur maximale du texte d'un profil, vérifiée avant de le lire. */
export const PROFIL_CARACTERES_MAX = 2048;
/** Mention d'une valeur par défaut sans référence, que Théophane corrige à la revue. */
export const MENTION_A_VERIFIER = 'valeur usuelle à vérifier';

const CLES_PROFIL = ['forme', 'hauteurMaxM', 'duree', 'allure', 'finDeCycle', 'cycleAnnuel'] as const;
/** Clés obligatoires, dans l'ordre où leur absence est signalée. */
const CLES_OBLIGATOIRES = ['forme', 'hauteurMaxM', 'duree', 'allure', 'finDeCycle'] as const;

/** Jours de chaque mois d'une année non bissextile. */
const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

type Brut = Readonly<Record<string, unknown>>;

const MESSAGES: Readonly<Record<CodeErreurCroissance, string>> = {
  trop_long: 'Le profil de croissance est trop long.',
  entree_invalide: 'Le profil de croissance est illisible.',
  champ_inconnu: 'Le profil de croissance contient une information inconnue.',
  champ_manquant: 'Il manque une information au profil de croissance.',
  forme_inconnue: 'La forme de la plante est inconnue.',
  hauteur_invalide: `La hauteur maximale doit être un nombre de mètres plus grand que zéro, ${String(HAUTEUR_MAX_PROFIL_M)} m au plus.`,
  duree_invalide: `La durée de croissance se donne en jours (1 à ${String(DUREE_MAX_JOURS)}) ou en part du cycle (plus de 0, 1 au plus).`,
  allure_inconnue: 'L’allure de la croissance est inconnue (droite ou en S).',
  fin_de_cycle_inconnue: 'La hauteur en fin de cycle est inconnue (conservée ou baissée).',
  cycle_annuel_invalide: 'Le cycle annuel demande un jour de débourrement avant le jour de repos, sous la forme mois-jour.',
};

function refus<T>(code: CodeErreurCroissance, champ: string | null): ResultatCroissance<T> {
  return { ok: false, erreur: { code, champ, message: MESSAGES[code] } };
}

const estObjet = (v: unknown): v is Brut => typeof v === 'object' && v !== null && !Array.isArray(v);
const propre = (o: Brut, cle: string): unknown => (Object.hasOwn(o, cle) ? o[cle] : undefined);
const parmi = <T extends string>(v: unknown, liste: readonly T[]): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
const memesCles = (o: Brut, cles: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === cles.length && cles.every((c) => Object.hasOwn(o, c));
};

function lireDuree(v: unknown): DureeCroissance | null {
  if (!estObjet(v)) return null;
  const en = propre(v, 'en');
  if (en === 'jours' && memesCles(v, ['en', 'jours'])) {
    const jours = propre(v, 'jours');
    return typeof jours === 'number' && Number.isInteger(jours) && jours >= 1 && jours <= DUREE_MAX_JOURS ? { en: 'jours', jours } : null;
  }
  if (en === 'fraction_cycle' && memesCles(v, ['en', 'fraction'])) {
    const fraction = propre(v, 'fraction');
    return typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1 ? { en: 'fraction_cycle', fraction } : null;
  }
  return null;
}

/** 'MM-JJ' d'un jour qui existe dans une année non bissextile (pas de 02-29). */
export function estJourDeLAnnee(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d\d-\d\d$/.test(v)) return false;
  const mois = Number(v.slice(0, 2));
  const jour = Number(v.slice(3, 5));
  const max = JOURS_PAR_MOIS[mois - 1];
  return max !== undefined && jour >= 1 && jour <= max;
}

/** Cycle annuel lu (null : absent), ou undefined s'il est hors règle. */
function lireCycle(v: unknown): CycleAnnuel | null | undefined {
  if (v === undefined || v === null) return null;
  if (!estObjet(v) || !memesCles(v, ['debourrement', 'repos'])) return undefined;
  const debourrement = propre(v, 'debourrement');
  const repos = propre(v, 'repos');
  if (!estJourDeLAnnee(debourrement) || !estJourDeLAnnee(repos) || debourrement >= repos) return undefined;
  return { debourrement, repos };
}

function valider(entree: unknown): ResultatCroissance<ProfilCroissance | null> {
  if (entree === null || entree === undefined) return { ok: true, valeur: null };
  let v: unknown = entree;
  if (typeof entree === 'string') {
    if (entree.length > PROFIL_CARACTERES_MAX) return refus('trop_long', null);
    try {
      v = JSON.parse(entree) as unknown;
    } catch {
      return refus('entree_invalide', null);
    }
  }
  if (!estObjet(v)) return refus('entree_invalide', null);
  const o = v;
  const inconnue = Object.keys(o).find((c) => !(CLES_PROFIL as readonly string[]).includes(c));
  if (inconnue !== undefined) return refus('champ_inconnu', inconnue);
  const manquante = CLES_OBLIGATOIRES.find((c) => propre(o, c) === undefined);
  if (manquante !== undefined) return refus('champ_manquant', manquante);

  const forme = propre(o, 'forme');
  if (!parmi(forme, FORMES_PLANT)) return refus('forme_inconnue', 'forme');
  const hauteurMaxM = propre(o, 'hauteurMaxM');
  if (typeof hauteurMaxM !== 'number' || !Number.isFinite(hauteurMaxM) || hauteurMaxM <= 0 || hauteurMaxM > HAUTEUR_MAX_PROFIL_M) {
    return refus('hauteur_invalide', 'hauteurMaxM');
  }
  const duree = lireDuree(propre(o, 'duree'));
  if (duree === null) return refus('duree_invalide', 'duree');
  const allure = propre(o, 'allure');
  if (!parmi(allure, ALLURES)) return refus('allure_inconnue', 'allure');
  const finDeCycle = propre(o, 'finDeCycle');
  if (!parmi(finDeCycle, FINS_DE_CYCLE)) return refus('fin_de_cycle_inconnue', 'finDeCycle');
  const cycleAnnuel = lireCycle(propre(o, 'cycleAnnuel'));
  if (cycleAnnuel === undefined) return refus('cycle_annuel_invalide', 'cycleAnnuel');
  return { ok: true, valeur: { forme, hauteurMaxM, duree, allure, finDeCycle, cycleAnnuel } };
}

/**
 * Profil reçu (objet, texte du téléphone, ou nul) relu selon les règles du profil : la valeur
 * (null = profil par défaut), ou la première règle violée, dans l'ordre documenté dans
 * test/contrat.ts. Ne lève jamais.
 */
export function validerProfilCroissance(entree: unknown): ResultatCroissance<ProfilCroissance | null> {
  try {
    return valider(entree);
  } catch {
    return refus('entree_invalide', null);
  }
}
