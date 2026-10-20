/**
 * Contrat de T60 dans le cœur — l'équipe de la ferme et l'attribution des travaux du jour
 * (docs/backlog/T60-consignes-par-ouvrier.md, règles 1, 2, 4 et 6). Tout est lu dans
 * `@planif/core` (src/index.ts), tel que le serveur (apps/api/src/sync/equipe.ts), l'écran
 * Aujourd'hui (attribution, « Mes travaux », fiche du jour) et la vue 3D l'importent. Le fichier
 * qui les définit est libre (src/equipe/ conseillé).
 *
 * Le module est chargé dynamiquement (`chargerEquipe`) : tant que les fonctions n'existent pas,
 * les tests échouent sur un message clair au lieu de casser le typage du dépôt.
 *
 * ── Modèle (docs/modele-donnees.md, « Équipe et consignes ») ────────────────────────────────
 *
 * `personne` : une personne de l'équipe de la ferme, avec un prénom affiché ; `membre_id`
 * facultatif (un ouvrier sans compte n'en a pas, règle 1). `attribution` : « ce travail du jour
 * est pour cette personne », une ligne par (travail, personne) ; le travail est désigné par la
 * clé de la tâche de l'écran Aujourd'hui (`TacheJour.cle` : `<série ou campagne>:<étape>` ou
 * `<série>:travail:<indice>:<date prévue>`), stable d'un jour à l'autre tant que la tâche n'est
 * pas faite. Retirer une attribution = suppression douce (`supprime_le`), rétablir = la remettre
 * à nul : rien ne s'efface, tout s'annule.
 *
 * ── validerPersonne(entree) / validerAttribution(entree) ────────────────────────────────────
 *
 * Ligne au format PowerSync (avec `id` ; `cree_le`, `modifie_le` tolérées), rendue validée, ou
 * la première règle violée (ErreurSaisie : code, champ, message ; jamais d'exception) :
 *   personne    : id, ferme_id (UUID, obligatoires), prenom (texte, espaces de bord retirés,
 *                 1 à LIMITES_EQUIPE.prenomCaracteres caractères), membre_id (UUID ou nul),
 *                 supprime_le (nul ou instant ISO). → { id, fermeId, prenom, membreId, supprimeLe }
 *   attribution : id, ferme_id, personne_id (UUID, obligatoires), cle_tache (texte non vide,
 *                 LIMITES_EQUIPE.cleTacheCaracteres caractères au plus, sans espace de bord),
 *                 supprime_le. → { id, fermeId, personneId, cleTache, supprimeLe }
 * Colonne inconnue → 'colonne_inconnue'. Identifiants rendus en minuscules.
 *
 * ── personnesParTache(attributions) ─────────────────────────────────────────────────────────
 *
 * `attributions` : lignes lues (AttributionLue : id, cleTache, personneId, supprimee). Rend,
 * pour chaque clé qui a au moins une attribution ACTIVE, les personnes (ids en minuscules, sans
 * doublon, triées). Une clé sans attribution active n'y figure pas.
 *
 * ── estPourPersonne(parTache, cle, personneId) / travauxDe(taches, parTache, personneId) ────
 *
 * Règle 4 (« Mes travaux ») : un travail est pour une personne s'il lui est attribué, OU s'il
 * n'est attribué à personne (un travail non attribué est visible de tous). `travauxDe` garde,
 * dans l'ordre reçu, les tâches (objets avec `cle`) qui sont pour la personne. Casse des ids
 * ignorée.
 *
 * ── planAttribution(existantes, voulues) ────────────────────────────────────────────────────
 *
 * Règle 2 : les écritures qui donnent à chaque clé de `voulues` exactement ses personnes (une
 * liste vide retire tout). Les clés absentes de `voulues` ne changent pas. Pour chaque clé :
 *   - personne voulue sans attribution active : une attribution supprimée (cette clé, cette
 *     personne) est RÉTABLIE (`retablir` : son id, la plus petite si plusieurs) ; sinon une
 *     attribution est CRÉÉE (`creer` : { cleTache, personneId }) ;
 *   - attribution active d'une personne non voulue : RETIRÉE (`retirer` : son id ; toutes, si
 *     elle a des doublons) ;
 *   - déjà comme voulu : rien.
 * Ordre stable : clés dans l'ordre de `voulues`, personnes dans l'ordre donné. Annuler une
 * attribution = `planAttribution` vers l'état d'avant (les personnes de `personnesParTache`
 * d'avant, liste vide pour une clé qui n'en avait pas).
 */
import type { ErreurSaisie } from '../../saisies/index.ts';

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

export interface PersonneEcrite {
  readonly id: string;
  readonly fermeId: string;
  readonly prenom: string;
  readonly membreId: string | null;
  readonly supprimeLe: number | null;
}

export interface AttributionEcrite {
  readonly id: string;
  readonly fermeId: string;
  readonly personneId: string;
  readonly cleTache: string;
  readonly supprimeLe: number | null;
}

export interface AttributionLue {
  readonly id: string;
  readonly cleTache: string;
  readonly personneId: string;
  readonly supprimee: boolean;
}

export interface PlanAttribution {
  readonly creer: readonly { readonly cleTache: string; readonly personneId: string }[];
  readonly retablir: readonly string[];
  readonly retirer: readonly string[];
}

export interface ModuleEquipe {
  readonly LIMITES_EQUIPE: { readonly prenomCaracteres: number; readonly cleTacheCaracteres: number };
  validerPersonne(entree: unknown): Resultat<PersonneEcrite>;
  validerAttribution(entree: unknown): Resultat<AttributionEcrite>;
  personnesParTache(attributions: readonly AttributionLue[]): ReadonlyMap<string, readonly string[]>;
  estPourPersonne(parTache: ReadonlyMap<string, readonly string[]>, cle: string, personneId: string): boolean;
  travauxDe<T extends { readonly cle: string }>(taches: readonly T[], parTache: ReadonlyMap<string, readonly string[]>, personneId: string): T[];
  planAttribution(existantes: readonly AttributionLue[], voulues: ReadonlyMap<string, readonly string[]>): PlanAttribution;
}

const CHEMIN_COEUR = '../../index.ts';

export async function chargerEquipe(): Promise<ModuleEquipe> {
  const m = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleEquipe>;
  const noms = ['LIMITES_EQUIPE', 'validerPersonne', 'validerAttribution', 'personnesParTache', 'estPourPersonne', 'travauxDe', 'planAttribution'] as const;
  const absents = noms.filter((n) => m[n] === undefined);
  if (absents.length > 0) throw new Error(`@planif/core n’exporte pas encore : ${absents.join(', ')} (T60)`);
  return m as ModuleEquipe;
}
