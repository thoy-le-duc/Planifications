/**
 * Outils communs aux règles des lignes écrites par un téléphone (serie.ts, itineraire.ts) :
 * lecture sans confiance d'une ligne au format PowerSync, identifiants, instants, JSON, et
 * paramètres d'un itinéraire (ceux que l'instantané d'une série copie). Purs, ne lèvent jamais.
 * Internes au cœur : non exportés par @planif/core (sauf les constantes reprises par serie.ts).
 */
import { estDateValide, type DateCalendaire } from '../dates/index.ts';
import { DISPOSITIONS_RANGS, type Instant, type ModeItineraire, type ParametresItineraire } from '../domaine/index.ts';
import type { CodeErreurSaisie, ErreurSaisie } from './index.ts';
import { octetsUtf8, texteJson } from './outils.ts';
import { validerTravauxPrevus, type OptionsTravaux } from './travaux.ts';

export type ResultatLigne<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

/** Octets UTF-8 au plus de l'instantané `parametres` en JSON (comme le détail d'un événement). */
export const PARAMETRES_SERIE_OCTETS = 8_192;

export const MODES = ['semis_direct', 'plant_maison', 'plant_achete'] as const satisfies readonly ModeItineraire[];

export const DATE_MIN = '2000-01-01';
export const DATE_MAX = '2100-12-31';
export const INSTANT_MIN = Date.UTC(2000, 0, 1);
export const INSTANT_MAX = Date.UTC(2100, 11, 31, 23, 59, 59, 999);

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instant ISO 8601 complet avec fuseau (supprime_le ; to_jsonb de Postgres rend '+00:00'). */
const MOTIF_INSTANT = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Ce que `lireParametres` vérifie en plus de l'instantané d'une série (itinéraire, T23). */
export interface OptionsParametres {
  /** Mode de la ligne (colonne `mode` d'un itinéraire) : `parametres.mode` doit le valoir. */
  readonly mode?: ModeItineraire;
  /** Types d'intervention permis pour les travaux prévus (ceux de la ferme). */
  readonly typesIntervention?: OptionsTravaux['typesIntervention'];
}

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

export type Objet = Readonly<Record<string, unknown>>;
export type Lu<T> = ResultatLigne<T>;

export const erreur = (code: CodeErreurSaisie, champ: string | null, message: string): ErreurSaisie => ({ code, champ, message });
export const echec = <T>(e: ErreurSaisie): Lu<T> => ({ ok: false, erreur: e });
export const lu = <T>(valeur: T): Lu<T> => ({ ok: true, valeur });
export const absent = (v: unknown): v is null | undefined => v === undefined || v === null;
export const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
export const parmi = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
export const extrait = (texte: string): string => (texte.length > 40 ? `${texte.slice(0, 40)}…` : texte);
/** Copie des propriétés propres (un niveau) : une valeur héritée par prototype est absente. */
export const copiePropre = (o: Objet): Objet => Object.fromEntries(Object.keys(o).map((cle) => [cle, o[cle]]));

/** Filet commun : entrée qui n'est pas un objet, accesseur qui lève, Proxy… jamais d'exception. */
export function sansException<T>(entree: unknown, lire: (l: Objet) => Lu<T>): Lu<T> {
  try {
    if (!estObjet(entree)) return echec(erreur('entree_invalide', null, 'ligne illisible : objet attendu'));
    return lire(copiePropre(entree));
  } catch {
    return echec(erreur('entree_invalide', null, 'ligne illisible'));
  }
}

export function colonnesConnues(l: Objet, colonnes: ReadonlySet<string>): ErreurSaisie | null {
  const cle = Object.keys(l).find((c) => !colonnes.has(c));
  return cle === undefined ? null : erreur('colonne_inconnue', extrait(cle), `colonne inconnue : ${extrait(cle)}`);
}

export function id(v: unknown, champ: string, libelle: string): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) return echec(erreur('champ_invalide', champ, `${libelle} : identifiant invalide`));
  return lu(v.toLowerCase());
}

export function idOuNul(v: unknown, champ: string, libelle: string): Lu<string | null> {
  return absent(v) ? lu(null) : id(v, champ, libelle);
}

export function valeurParmi<T extends string>(v: unknown, liste: readonly T[], champ: string, libelle: string): Lu<T> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (!parmi(liste, v)) return echec(erreur('champ_invalide', champ, `${libelle} inconnu`));
  return lu(v);
}

/** Date 'AAAA-MM-JJ' existante, dans [2000-01-01, 2100-12-31]. */
export function date(v: unknown, champ: string, libelle: string): Lu<DateCalendaire> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquante`));
  if (typeof v !== 'string' || !estDateValide(v)) return echec(erreur('champ_invalide', champ, `${libelle} invalide (AAAA-MM-JJ)`));
  if (v < DATE_MIN || v > DATE_MAX) return echec(erreur('hors_bornes', champ, `${libelle} hors de ${DATE_MIN} … ${DATE_MAX}`));
  return lu(v);
}

export function dateOuNul(v: unknown, champ: string, libelle: string): Lu<DateCalendaire | null> {
  return absent(v) ? lu(null) : date(v, champ, libelle);
}

/** Instant de la suppression douce : null, ou instant ISO avec fuseau dans [2000, 2100]. */
export function supprimeLe(v: unknown): Lu<Instant | null> {
  if (absent(v)) return lu(null);
  const jour = typeof v === 'string' ? MOTIF_INSTANT.exec(v)?.[1] : undefined;
  const instant = typeof v === 'string' && jour !== undefined && estDateValide(jour) ? Date.parse(v) : Number.NaN;
  if (Number.isNaN(instant)) return echec(erreur('champ_invalide', 'supprime_le', 'supprime_le : instant ISO 8601 avec fuseau attendu'));
  if (instant < INSTANT_MIN || instant > INSTANT_MAX) return echec(erreur('hors_bornes', 'supprime_le', 'supprime_le hors de 2000 … 2100'));
  return lu(instant);
}

/** Texte JSON (format de PowerSync) ou déjà la valeur. */
export function json(v: unknown, champ: string, libelle: string): Lu<unknown> {
  if (typeof v !== 'string') return lu(v);
  try {
    return lu(JSON.parse(v) as unknown);
  } catch {
    return echec(erreur('json_illisible', champ, `${libelle} : texte JSON illisible`));
  }
}

// ── parametres ───────────────────────────────────────────────────────────────────────────────

function dureeJours(p: Objet, cle: string, libelle: string): ErreurSaisie | null {
  const champ = `parametres.${cle}`;
  const v = p[cle];
  if (absent(v)) return erreur('champ_manquant', champ, `${libelle} manquante`);
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    return erreur('champ_invalide', champ, `${libelle} : nombre entier de jours, positif ou nul, attendu`);
  }
  return null;
}

/**
 * T35a : la disposition des rangs de la densité, si elle est donnée, vaut 'alignee' ou
 * 'quinconce'. Absente, rien n'est ajouté (alignée par défaut, aucune ligne réécrite).
 */
function disposition(densite: unknown): ErreurSaisie | null {
  if (!estObjet(densite) || densite.disposition === undefined) return null;
  if (parmi(DISPOSITIONS_RANGS, densite.disposition)) return null;
  return erreur('champ_invalide', 'parametres.densite.disposition', 'disposition des rangs inconnue : « alignee » (rangs alignés) ou « quinconce » attendue');
}

/**
 * L'instantané de l'itinéraire, lisible : un objet JSON de 8 192 octets au plus, avec ce que le
 * calcul des dates lit. Les autres clés (densité, marge…) sont gardées telles quelles : elles
 * appartiennent à l'itinéraire copié, pas aux dates.
 */
export function lireParametres(v: unknown, options: OptionsParametres = {}): Lu<ParametresItineraire> {
  if (absent(v)) return echec(erreur('champ_manquant', 'parametres', 'paramètres manquants'));
  const valeur = json(v, 'parametres', 'paramètres');
  if (!valeur.ok) return valeur;
  if (!estObjet(valeur.valeur)) return echec(erreur('champ_invalide', 'parametres', 'paramètres : objet attendu'));
  const p = copiePropre(valeur.valeur);
  const ecrit = texteJson(p);
  if ('echec' in ecrit) return echec(erreur('json_illisible', 'parametres', 'paramètres illisibles (valeur non JSON ou trop imbriquée)'));
  if (ecrit.texte.length > PARAMETRES_SERIE_OCTETS || octetsUtf8(ecrit.texte) > PARAMETRES_SERIE_OCTETS) {
    return echec(erreur('trop_volumineux', 'parametres', `paramètres trop volumineux (${String(PARAMETRES_SERIE_OCTETS)} octets au plus)`));
  }
  if (absent(p.mode)) return echec(erreur('champ_manquant', 'parametres.mode', 'mode de culture manquant'));
  if (!parmi(MODES, p.mode)) return echec(erreur('champ_invalide', 'parametres.mode', 'mode de culture inconnu'));
  if (options.mode !== undefined && p.mode !== options.mode) {
    return echec(erreur('incoherent', 'parametres.mode', 'le mode des paramètres diffère de celui de la ligne'));
  }
  const e =
    (p.mode === 'plant_maison' ? dureeJours(p, 'dureePepiniereJours', 'durée en pépinière') : null) ??
    dureeJours(p, 'dureeAvantRecolteJours', 'durée avant récolte') ??
    dureeJours(p, 'fenetreRecolteJours', 'fenêtre de récolte');
  if (e !== null) return echec(e);
  const d = disposition(p.densite);
  if (d !== null) return echec(d);
  // Relu depuis le texte : une copie JSON pure, sans valeur non sérialisable (undefined…).
  const relus = JSON.parse(ecrit.texte) as Record<string, unknown>;
  // T22 : les travaux prévus, validés avec le mode des paramètres. Sans liste de types pour
  // l'instantané d'une série (elle garde les types copiés, même masqués ensuite par la ferme) ;
  // avec celle de la ferme pour un itinéraire (T23).
  if (relus.travauxPrevus !== undefined) {
    const types = options.typesIntervention;
    const travaux = validerTravauxPrevus(relus.travauxPrevus, types === undefined ? { mode: p.mode } : { mode: p.mode, typesIntervention: types });
    if (!travaux.ok) {
      const champ = travaux.erreur.champ === null ? 'parametres.travauxPrevus' : `parametres.travauxPrevus.${travaux.erreur.champ}`;
      return echec({ ...travaux.erreur, champ });
    }
    relus.travauxPrevus = travaux.valeur;
    // La normalisation complète les clés facultatives à null : l'instantané rangé doit encore
    // tenir dans la limite (sinon le serveur rangerait plus de PARAMETRES_SERIE_OCTETS).
    if (octetsUtf8(JSON.stringify(relus)) > PARAMETRES_SERIE_OCTETS) {
      return echec(erreur('trop_volumineux', 'parametres', `paramètres trop volumineux une fois complétés (${String(PARAMETRES_SERIE_OCTETS)} octets au plus)`));
    }
  }
  return lu(relus as unknown as ParametresItineraire);
}

