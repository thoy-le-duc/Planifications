/**
 * Règles d'un itinéraire et d'un type d'intervention écrits par un téléphone (T23, écran de T24).
 * Pures, comme `validerSerie` (T10e) et `validerTravauxPrevus` (T22) : ni base, ni réseau, ni
 * horloge, ne lèvent jamais. Le serveur (apps/api/src/sync/itineraire.ts) les rejoue à chaque PUT
 * et à chaque PATCH, sur la ligne complète ; le téléphone peut s'en servir avant d'écrire.
 * Contrat : ./test/contrat-itineraire.ts.
 *
 * Ce qui reste à l'appelant (base de données) : la ferme du jeton, l'appartenance de l'espèce et
 * de la variété à la ferme ou à la bibliothèque, la liste des types d'intervention de la ferme
 * (`options.typesIntervention`), l'unicité d'un type et ce qui l'utilise.
 */
import type { CategorieIntervention, Id, Instant, ModeItineraire, ParametresItineraire } from '../domaine/index.ts';
import {
  absent,
  colonnesConnues,
  echec,
  erreur,
  id,
  idOuNul,
  lireParametres,
  lu,
  MODES,
  sansException,
  supprimeLe,
  valeurParmi,
  type Lu,
  type Objet,
  type ResultatLigne,
} from './lignes.ts';
import { PLAFONDS_TRAVAUX, texteInterdit, type OptionsTravaux } from './travaux.ts';

export type ResultatLigneItineraire<T> = ResultatLigne<T>;

/** Caractères au plus du nom d'un itinéraire, espaces de bord retirés (décision 6 du chef, T23). */
export const NOM_ITINERAIRE_CARACTERES = 80;

export interface OptionsItineraire {
  /**
   * Couples (catégorie, libellé) permis dans les travaux prévus : les types non supprimés de la
   * ferme (masqués compris) et la liste de départ. Absente : aucun contrôle de liste.
   */
  readonly typesIntervention?: OptionsTravaux['typesIntervention'];
}

/** Itinéraire écrit par un téléphone, validé. */
export interface ItineraireEcrit {
  readonly id: Id<'Itineraire'>;
  readonly fermeId: Id<'Ferme'>;
  readonly especeId: Id<'Espece'>;
  readonly varieteId: Id<'Variete'> | null;
  /** Espaces de bord retirés. */
  readonly nom: string;
  readonly mode: ModeItineraire;
  /** Paramètres relus, travaux prévus normalisés par T22 (clés facultatives à null). */
  readonly parametres: ParametresItineraire;
  readonly supprimeLe: Instant | null;
}

/** Type d'intervention écrit par un téléphone, validé. */
export interface TypeInterventionEcrit {
  readonly id: Id<'TypeIntervention'>;
  readonly fermeId: Id<'Ferme'>;
  readonly categorie: CategorieIntervention;
  readonly libelle: string;
  readonly masque: boolean;
  readonly supprimeLe: Instant | null;
}

const CATEGORIES = ['travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'] as const satisfies readonly CategorieIntervention[];

/** Colonnes d'une ligne `itineraire` reçue ; horodatages tolérés (remplis par le serveur). */
const COLONNES_ITINERAIRE = new Set(['id', 'ferme_id', 'espece_id', 'variete_id', 'nom', 'mode', 'parametres', 'cree_le', 'modifie_le', 'supprime_le']);

/** Colonnes d'une ligne `type_intervention` reçue ; horodatages tolérés (remplis par le serveur). */
const COLONNES_TYPE = new Set(['id', 'ferme_id', 'categorie', 'libelle', 'masque', 'cree_le', 'modifie_le', 'supprime_le']);

/** Nom d'un itinéraire : texte sans caractère de contrôle, de 1 à 80 caractères une fois les espaces de bord retirés. */
function nom(v: unknown): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', 'nom', 'nom manquant'));
  if (typeof v !== 'string') return echec(erreur('champ_invalide', 'nom', 'nom : texte attendu'));
  const n = v.trim();
  if (n === '') return echec(erreur('champ_invalide', 'nom', 'nom vide'));
  if (n.length > NOM_ITINERAIRE_CARACTERES) {
    return echec(erreur('trop_long', 'nom', `nom : ${String(NOM_ITINERAIRE_CARACTERES)} caractères au plus`));
  }
  if (texteInterdit(n)) return echec(erreur('champ_invalide', 'nom', 'nom : caractère invalide'));
  return lu(n);
}

function lireItineraire(l: Objet, options: OptionsItineraire): Lu<ItineraireEcrit> {
  const inconnue = colonnesConnues(l, COLONNES_ITINERAIRE);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', "identifiant de l'itinéraire");
  if (!identifiant.ok) return identifiant;
  // ferme_id nul = la bibliothèque commune : le téléphone n'y écrit jamais.
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const espece = id(l.espece_id, 'espece_id', 'espèce');
  if (!espece.ok) return espece;
  const variete = idOuNul(l.variete_id, 'variete_id', 'variété');
  if (!variete.ok) return variete;
  const n = nom(l.nom);
  if (!n.ok) return n;
  const mode = valeurParmi(l.mode, MODES, 'mode', 'mode de culture');
  if (!mode.ok) return mode;
  const types = options.typesIntervention;
  const parametres = lireParametres(l.parametres, types === undefined ? { mode: mode.valeur } : { mode: mode.valeur, typesIntervention: types });
  if (!parametres.ok) return parametres;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'Itineraire'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    especeId: espece.valeur as Id<'Espece'>,
    varieteId: variete.valeur as Id<'Variete'> | null,
    nom: n.valeur,
    mode: mode.valeur,
    parametres: parametres.valeur,
    supprimeLe: suppression.valeur,
  });
}

/**
 * Valide une ligne `itineraire` (format PowerSync, avec son `id` ; `parametres` en texte JSON ou
 * en objet) et la rend validée, ou renvoie la première règle violée.
 */
export function validerItineraire(entree: unknown, options: OptionsItineraire = {}): ResultatLigneItineraire<ItineraireEcrit> {
  return sansException(entree, (l) => lireItineraire(l, options));
}

/** Libellé d'un type : texte non vide, de PLAFONDS_TRAVAUX.texte caractères au plus (recopié dans les travaux). */
function libelle(v: unknown): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', 'libelle', 'libellé manquant'));
  if (typeof v !== 'string' || v.trim() === '') return echec(erreur('champ_invalide', 'libelle', 'libellé : texte non vide attendu'));
  if (v.length > PLAFONDS_TRAVAUX.texte) return echec(erreur('trop_long', 'libelle', `libellé : ${String(PLAFONDS_TRAVAUX.texte)} caractères au plus`));
  if (texteInterdit(v)) return echec(erreur('champ_invalide', 'libelle', 'libellé : caractère invalide'));
  return lu(v);
}

/** Booléen ; le téléphone (SQLite) l'envoie en entier 0 / 1. Absent : false. */
function masque(v: unknown): Lu<boolean> {
  if (absent(v) || v === 0 || v === false) return lu(false);
  if (v === 1 || v === true) return lu(true);
  return echec(erreur('champ_invalide', 'masque', 'masque : 0 ou 1 attendu'));
}

function lireTypeIntervention(l: Objet): Lu<TypeInterventionEcrit> {
  const inconnue = colonnesConnues(l, COLONNES_TYPE);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', "identifiant du type d'intervention");
  if (!identifiant.ok) return identifiant;
  // ferme_id nul = la liste de départ : en lecture seule.
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const categorie = valeurParmi(l.categorie, CATEGORIES, 'categorie', "catégorie d'intervention");
  if (!categorie.ok) return categorie;
  const texte = libelle(l.libelle);
  if (!texte.ok) return texte;
  const m = masque(l.masque);
  if (!m.ok) return m;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'TypeIntervention'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    categorie: categorie.valeur,
    libelle: texte.valeur,
    masque: m.valeur,
    supprimeLe: suppression.valeur,
  });
}

/**
 * Valide une ligne `type_intervention` (format PowerSync, avec son `id` ; `masque` en entier 0 / 1
 * ou en booléen) et la rend validée, ou renvoie la première règle violée.
 */
export function validerTypeIntervention(entree: unknown): ResultatLigneItineraire<TypeInterventionEcrit> {
  return sansException(entree, lireTypeIntervention);
}
