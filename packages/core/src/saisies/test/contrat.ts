/**
 * Contrat de `packages/core/src/saisies` (T10b) : l'API que les tests attendent de
 * `src/saisies/index.ts`, réexportée par `@planif/core` (src/index.ts).
 *
 * Le module est chargé dynamiquement (`chargerSaisies`) : tant qu'il n'existe pas, les tests
 * échouent sur « module introuvable » au lieu de casser le typage de tout le dépôt. Une fois le
 * module écrit, il doit satisfaire ces types ; il peut définir ses propres types du moment qu'ils
 * sont compatibles.
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * UNE SEULE définition des règles d'une saisie (événement du journal de terrain), pure : ni base,
 * ni réseau, ni horloge. Le serveur l'appelle à l'envoi (apps/api/src/sync/evenement.ts, qui n'a
 * plus de règles propres) ; le téléphone l'appellera avant d'écrire (T13).
 * Ce qui reste dans l'API : l'appartenance à la ferme des références (série, emplacement,
 * secteur, produit phyto, événement remplacé), la ferme et l'auteur comparés au jeton. Ici, une
 * référence n'est qu'un UUID bien formé (8-4-4-4-12 hexadécimal, casse libre, rendu en minuscules).
 *
 * ── Entrée ──────────────────────────────────────────────────────────────────────────────────
 *
 *   validerSaisie(entree: unknown): ResultatSaisie
 *
 * `entree` est la ligne `evenement` telle que PowerSync la stocke sur le téléphone et l'envoie à
 * POST /sync/upload, AVEC son `id` : colonnes snake_case, valeurs texte, nombre ou null ;
 * `detail`, `emplacement_ids` et `photos` en texte JSON OU déjà en valeur (objet, tableau).
 *
 *   id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id,
 *   emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail
 *   + cree_le : tolérée et ignorée (remplie par le serveur).
 *
 * Toute autre colonne → 'colonne_inconnue'. `entree` qui n'est pas un objet → 'entree_invalide'.
 * Jamais d'exception, quelle que soit l'entrée (JSON illisible, imbriqué sur 100 000 niveaux,
 * clé de 10 000 caractères…) : toujours un résultat.
 *
 * ── Sortie ──────────────────────────────────────────────────────────────────────────────────
 *
 * Saisie acceptée → l'`Evenement` de T01 (camelCase) : ids en minuscules, `horodatage` en
 * `Instant` (ms UTC), `culture` et `remplaceEvenement` regroupés, `note` null si absente,
 * `emplacementIds` et `photos` [] si absents ou null, `detail` = objet lu.
 *
 * Saisie refusée → `ErreurSaisie` : un `code` stable (ci-dessous), le `champ` en cause
 * (nom de colonne reçu, ou 'detail.<clé>' / 'detail.dose.valeur'… pour le détail), et un
 * `message` en français lisible par le maraîcher, de 200 caractères au plus (un nom de clé
 * reçu de 10 000 caractères est tronqué). La première règle violée suffit.
 *
 * ── Règles (reprises de T10, evenement.ts) ──────────────────────────────────────────────────
 *
 *   id, ferme_id, auteur_id          UUID obligatoires                     champ_manquant / champ_invalide
 *   type                             realise | recolte | intervention | irrigation | traitement | observation
 *   date                             'AAAA-MM-JJ' existante, dans [2000-01-01, 2100-12-31]  champ_invalide / hors_bornes
 *   horodatage                       ISO 8601 complet AVEC fuseau (Z ou ±hh:mm), instant dans
 *                                    [2000-01-01T00:00:00.000Z, 2100-12-31T23:59:59.999Z]  champ_invalide / hors_bornes
 *   source                           tap | voix | agent | photo | import
 *   serie_id, campagne_id            UUID ou null ; pas les deux              incoherent
 *   note                             texte ou null, ≤ 4 000 caractères       trop_long
 *   emplacement_ids                  tableau d'UUID, ≤ 200, sans doublon (casse ignorée)  trop_nombreux / doublon
 *   photos                           tableau de textes, ≤ 20, ≤ 2 000 caractères chacune  trop_nombreux / trop_long
 *   remplace_sorte, remplace_evenement_id   correction | annulation, et l'UUID : les deux ou aucun ;
 *                                    jamais l'événement lui-même (casse ignorée)  incoherent
 *   detail                           objet ; ≤ 8 192 octets UTF-8 de JSON.stringify  trop_volumineux ;
 *                                    uniquement les clés du Detail* de T01 du type  cle_inconnue
 *   texte JSON illisible, ou valeur impossible à relire/réécrire (trop imbriquée)  json_illisible
 *
 * Détail par type (clés autorisées) :
 *   recolte       quantite (> 0), unite (kg | botte | piece | barquette), categorie (texte ou null)
 *   realise       etape (semis_pepiniere | semis_direct | plantation | arrachage), quantiteReelle (nombre ≥ 0 ou null)
 *   intervention  categorie (travail_sol | couverture | fertilisation | amendement | entretien),
 *                 type (texte non vide), outil (texte ou null) ;
 *                 + couverture : dureeOccupationJours (nombre ≥ 0 ou null)
 *                 + fertilisation, amendement : produit (texte non vide), quantite { valeur ≥ 0, unite texte } obligatoires
 *   irrigation    secteurIrrigationId (UUID), dureeMinutes (≥ 0)
 *   traitement    produitPhytoId (UUID), dose { valeur ≥ 0, unite texte }, surfaceTraiteeM2 (≥ 0),
 *                 cible (texte), operateur (texte), recolteAutoriseeLe ('AAAA-MM-JJ' existante)
 *   observation   nature (ravageur | maladie | stade | autre), gravite (faible | moyenne | forte | null)
 *   Un objet quantite/dose n'a que les clés valeur et unite. Un nombre est un number fini
 *   (pas de texte « 12 », pas de NaN ni d'Infinity).
 *
 * NOUVEAU par rapport à T10 (le type Evenement de T01 l'exigeait, ni l'API ni la base ne le
 * vérifiaient) : gravite dans sa liste, cible et operateur en texte, quantite.unite en texte,
 * quantiteReelle / dureeOccupationJours / quantite.valeur d'engrais ≥ 0.
 *
 * ── Plafonds métier (PROVISOIRES, à valider par Théophane : docs/questions.md) ──────────────
 *
 * `PLAFONDS_PROVISOIRES` borne chaque quantité (borne comprise) ; au-delà → 'plafond_depasse'.
 * Aujourd'hui une quantité de 1e308 est acceptée. Les tests lisent les valeurs dans la constante :
 * les changer ne demande de modifier que le test qui les fige (« valeurs proposées »).
 */
import type { Evenement } from '../../domaine/index.ts';

export type CodeErreurSaisie =
  /** L'entrée n'est pas un objet. */
  | 'entree_invalide'
  | 'colonne_inconnue'
  /** Colonne ou clé obligatoire absente ou null. */
  | 'champ_manquant'
  /** Mauvais type, valeur hors liste, format invalide (UUID, date, horodatage), nombre négatif. */
  | 'champ_invalide'
  /** Date ou horodatage hors de [2000, 2100]. */
  | 'hors_bornes'
  /** Note ou adresse de photo trop longue. */
  | 'trop_long'
  /** Trop de photos ou d'emplacements. */
  | 'trop_nombreux'
  /** Emplacement en double. */
  | 'doublon'
  /** Série ET campagne ; remplacement incomplet ; événement qui se remplace lui-même. */
  | 'incoherent'
  /** Texte JSON illisible, ou valeur trop imbriquée pour être relue ou réécrite. */
  | 'json_illisible'
  /** Détail de plus de 8 192 octets UTF-8. */
  | 'trop_volumineux'
  /** Clé hors du Detail* du type. */
  | 'cle_inconnue'
  /** Quantité au-delà de PLAFONDS_PROVISOIRES. */
  | 'plafond_depasse';

export interface ErreurSaisie {
  readonly code: CodeErreurSaisie;
  /** Colonne reçue ('date', 'emplacement_ids'…) ou chemin dans le détail ('detail.quantite', 'detail.dose.valeur'). */
  readonly champ: string | null;
  /** Explication en français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatSaisie =
  | { readonly ok: true; readonly saisie: Evenement }
  | { readonly ok: false; readonly erreur: ErreurSaisie };

export interface LimitesSaisie {
  readonly noteCaracteres: number;
  readonly photos: number;
  readonly photoCaracteres: number;
  readonly emplacements: number;
  readonly detailOctets: number;
}

/** Plafonds par saisie, bornes comprises (unités entre parenthèses). */
export interface PlafondsSaisie {
  /** recolte.quantite, quelle que soit l'unité (kg, botte, pièce, barquette). */
  readonly recolteQuantite: number;
  /** realise.quantiteReelle (graines ou plants). */
  readonly realiseQuantite: number;
  /** intervention fertilisation / amendement : quantite.valeur (unité libre, kg en pratique). */
  readonly interventionQuantite: number;
  /** intervention couverture : dureeOccupationJours (jours). */
  readonly couvertureJours: number;
  /** irrigation.dureeMinutes (minutes). */
  readonly irrigationMinutes: number;
  /** traitement.dose.valeur (unité libre : L/ha, kg/ha, g/hl…). */
  readonly traitementDose: number;
  /** traitement.surfaceTraiteeM2 (m²). */
  readonly traitementSurfaceM2: number;
}

export interface ModuleSaisies {
  validerSaisie(entree: unknown): ResultatSaisie;
  readonly LIMITES_SAISIE: LimitesSaisie;
  readonly PLAFONDS_PROVISOIRES: PlafondsSaisie;
}

/** Chemins tenus dans des variables : TypeScript ne résout pas un module avant qu'il existe. */
const CHEMIN_MODULE = '../index.ts';
const CHEMIN_COEUR = '../../index.ts';

export async function chargerSaisies(): Promise<ModuleSaisies> {
  return (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleSaisies;
}

/** `@planif/core` tel que le serveur et le téléphone l'importent. */
export async function chargerCoeur(): Promise<Partial<ModuleSaisies>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleSaisies>;
}
