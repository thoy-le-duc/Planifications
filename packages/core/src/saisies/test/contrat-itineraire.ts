/**
 * Contrat de T23 dans le cœur : les règles d'un itinéraire et d'un type d'intervention écrits
 * par un téléphone (`validerItineraire`, `validerTypeIntervention`). Tout est lu dans
 * `@planif/core` (src/index.ts), tel que le serveur (T23) et l'écran des itinéraires (T24)
 * l'importent : le fichier qui les définit est libre, du moment qu'il est sous `src/saisies/`.
 *
 * Le module est chargé dynamiquement (`chargerItineraires`) : tant que les fonctions n'existent
 * pas, les tests échouent sur un message clair au lieu de casser le typage de tout le dépôt.
 * Une fois écrites, elles doivent satisfaire ces types (ou des types compatibles).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * UNE SEULE définition des règles, pure (ni base, ni réseau, ni horloge, ne lève jamais), comme
 * `validerSerie` (T10e) et `validerTravauxPrevus` (T22). Le serveur les rejoue à chaque PUT et à
 * chaque PATCH, sur la ligne COMPLÈTE (ligne existante + colonnes du PATCH). Ce qui reste à
 * l'appelant : la ferme du jeton, l'appartenance de l'espèce et de la variété à la ferme ou à la
 * bibliothèque, et la liste des types d'intervention de la ferme (lue en base).
 *
 * ── validerItineraire(entree: unknown, options?: { typesIntervention? }) ───────────────────
 *
 * `entree` : la ligne `itineraire` au format PowerSync, AVEC son `id` (snake_case ; `parametres`
 * en texte JSON OU déjà en objet) :
 *
 *   id, ferme_id, espece_id, variete_id, nom, mode, parametres
 *   + cree_le, modifie_le (tolérées, remplies par le serveur), supprime_le (null ou instant ISO).
 *
 * Toute autre colonne → 'colonne_inconnue'. Entrée qui n'est pas un objet → 'entree_invalide'.
 *
 *   id, ferme_id, espece_id   UUID obligatoires. `ferme_id` nul (la bibliothèque commune) →
 *                             refusé : le téléphone n'écrit jamais dans la bibliothèque.
 *   variete_id                UUID ou null.
 *   nom                       texte non vide (après espaces), sans caractère de contrôle, de
 *                             longueur raisonnable (60 caractères acceptés, 10 000 refusés).
 *   mode                      semis_direct | plant_maison | plant_achete.
 *   parametres                les ParametresItineraire de T01, LISIBLES, mêmes règles que
 *                             l'instantané d'une série (validerSerie) : objet JSON d'au plus
 *                             PARAMETRES_SERIE_OCTETS octets (sinon la série copiée serait
 *                             refusée), `mode` connu, durées entières ≥ 0 (pépinière en plant
 *                             maison) ; ET `parametres.mode` = la colonne `mode` (sinon
 *                             'incoherent', champ 'parametres.mode' ou 'mode').
 *   parametres.travauxPrevus  facultatif (absent = aucun travail) ; sinon validé par
 *                             `validerTravauxPrevus` de T22 avec le mode de l'itinéraire ET
 *                             `options.typesIntervention` : champ de l'erreur préfixé par
 *                             'parametres.travauxPrevus.' (ex. 'parametres.travauxPrevus.0.type').
 *
 * `options.typesIntervention` : les couples (catégorie, libellé) permis, que le serveur lit en
 * base (types de la ferme non supprimés, plus la liste de départ). Absente : aucun contrôle de
 * liste (comme validerTravauxPrevus).
 *
 * Acceptée → `{ ok: true, valeur }` : au moins les champs de ItineraireLu (camelCase), les
 * travaux prévus normalisés par T22 (clés facultatives à null).
 *
 * ── validerTypeIntervention(entree: unknown) ────────────────────────────────────────────────
 *
 * `entree` : la ligne `type_intervention` au format PowerSync, avec son `id` :
 *
 *   id, ferme_id, categorie, libelle, masque
 *   + cree_le, modifie_le (tolérées), supprime_le (null ou instant ISO).
 *
 *   id, ferme_id   UUID obligatoires (ferme_id nul : refusé, la liste de départ est en lecture seule).
 *   categorie      travail_sol | couverture | fertilisation | amendement | entretien
 *                  (CategorieIntervention de T01) → sinon 'champ_invalide', champ 'categorie'.
 *   libelle        texte non vide, au plus PLAFONDS_TRAVAUX.texte caractères (30 : le libellé
 *                  est recopié tel quel dans `TravailPrevu.type` et `DetailIntervention.type`),
 *                  sans caractère de contrôle. Trop long → 'trop_long'.
 *   masque         booléen ; le téléphone (SQLite) l'envoie en entier 0 / 1 : 0, 1, false, true
 *                  acceptés ; absent ou null → false ; autre chose → 'champ_invalide'.
 *
 * Acceptée → `valeur` : TypeInterventionLu (masque rendu en booléen).
 *
 * ── Liste de départ ─────────────────────────────────────────────────────────────────────────
 *
 * Les types proposés au départ sont `TYPES_INTERVENTION_PAR_DEFAUT` de T01 (déjà exportée) :
 * modèle de données, section 5. En base, ce sont les lignes de `type_intervention` à `ferme_id`
 * nul (bibliothèque commune, en lecture seule), une par couple (catégorie, libellé).
 */

export type CodeErreur =
  | 'entree_invalide'
  | 'colonne_inconnue'
  | 'champ_manquant'
  | 'champ_invalide'
  | 'hors_bornes'
  | 'trop_long'
  | 'trop_nombreux'
  | 'doublon'
  | 'incoherent'
  | 'json_illisible'
  | 'trop_volumineux'
  | 'cle_inconnue'
  | 'plafond_depasse';

export interface ErreurLigne {
  readonly code: CodeErreur;
  readonly champ: string | null;
  readonly message: string;
}

export type ResultatLigne<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurLigne };

export interface TypePermis {
  readonly categorie: string;
  readonly type: string;
}

export interface OptionsItineraire {
  readonly typesIntervention?: readonly TypePermis[];
}

/** Ce que les tests lisent de l'itinéraire rendu. */
export interface ItineraireLu {
  readonly id: string;
  readonly fermeId: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly nom: string;
  readonly mode: string;
  readonly parametres: Readonly<Record<string, unknown>>;
}

/** Ce que les tests lisent du type d'intervention rendu. */
export interface TypeInterventionLu {
  readonly id: string;
  readonly fermeId: string;
  readonly categorie: string;
  readonly libelle: string;
  readonly masque: boolean;
}

/** `@planif/core` tel que T23 (le serveur) et T24 (l'écran) l'importent. */
export interface ModuleItineraires {
  validerItineraire(entree: unknown, options?: OptionsItineraire): ResultatLigne<ItineraireLu>;
  validerTypeIntervention(entree: unknown): ResultatLigne<TypeInterventionLu>;
  readonly TYPES_INTERVENTION_PAR_DEFAUT: Readonly<Record<string, readonly string[]>>;
  readonly PARAMETRES_SERIE_OCTETS: number;
  readonly PLAFONDS_TRAVAUX: { readonly texte: number };
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export async function chargerCoeurItineraires(): Promise<Partial<ModuleItineraires>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleItineraires>;
}

/** Le module complet, ou une erreur claire qui nomme les exports manquants. */
export async function chargerItineraires(): Promise<ModuleItineraires> {
  const m = await chargerCoeurItineraires();
  const attendus = ['validerItineraire', 'validerTypeIntervention', 'TYPES_INTERVENTION_PAR_DEFAUT', 'PARAMETRES_SERIE_OCTETS', 'PLAFONDS_TRAVAUX'] as const;
  const manquants = attendus.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T23)`);
  return m as ModuleItineraires;
}

/** Liste de départ à plat : un couple (catégorie, libellé) par type proposé. */
export function listeDeDepart(m: Pick<ModuleItineraires, 'TYPES_INTERVENTION_PAR_DEFAUT'>): { categorie: string; libelle: string }[] {
  return Object.entries(m.TYPES_INTERVENTION_PAR_DEFAUT).flatMap(([categorie, libelles]) => libelles.map((libelle) => ({ categorie, libelle })));
}
