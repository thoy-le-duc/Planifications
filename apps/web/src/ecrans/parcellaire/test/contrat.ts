/**
 * Contrat de T49 — « Ma ferme : saisons, zones, planches » (docs/backlog/T49-demarrer-sa-ferme.md).
 * Les tests importent les modules par un chemin tenu dans une variable : leur typage ne dépend
 * que de ce contrat.
 *
 * ## Modules attendus
 *
 * - `../regles.ts` (pur : ni porte, ni horloge, ni DOM) : ModuleRegles ci-dessous. Mêmes règles
 *   que le serveur (apps/api/src/sync/structure-lignes.ts : noms non vides de 200 caractères au
 *   plus, saison dans l'ordre, dates de 1900 à 2100, longueurs et largeurs > 0 et plafonnées,
 *   gouttière ⇔ nombre de places) et code unique dans sa zone sans tenir compte de la casse ni
 *   des espaces autour, parmi les emplacements non supprimés et en service (Q27).
 * - `../index.ts` : `EcranParcellaire` (et en défaut), chargé à la demande depuis l'onglet Ferme.
 *
 * ## Écran (DOM)
 *
 * Dialogue « Ma ferme » ; régions « Saisons » et « Zones et planches ».
 * - Sans saison : bouton « Créer la saison AAAA » (année du jour) : un tap écrit la saison
 *   « AAAA », du 1er janvier au 31 décembre, sans autre geste.
 * - « Nouvelle saison » / « Modifier la saison <nom> » : dialogue « Nouvelle saison » /
 *   « Modifier la saison », champs « Nom », « Début », « Fin » (type date), « Enregistrer »,
 *   « Fermer » ; « Supprimer la saison » en modification. Un refus s'affiche (role="alert")
 *   dans le dialogue, rien n'est écrit.
 * - Lignes : [data-testid="saison"][data-saison=<id>], [data-testid="zone"][data-zone=<id>]
 *   (bouton « Ouvrir <nom> »), [data-testid="planche"][data-emplacement=<id>] (bouton
 *   « Modifier <code> »).
 * - « Nouvelle zone » / « Modifier la zone » : champs « Nom », listes « Type d’abri »
 *   (plein_champ, tunnel, serre, hors_sol) et « Dans la zone » ('' : aucune) ; « Supprimer la
 *   zone » en modification.
 * - Dialogue de la zone (son nom) : « Modifier la zone », champs « Nombre de planches »,
 *   « Préfixe du code », « Longueur (m) », « Largeur (m) » (virgule acceptée), bouton
 *   « Ajouter les planches » : une transaction, codes <préfixe>1…<préfixe>n, à la suite des
 *   codes déjà pris dans la zone.
 * - Dialogue « Modifier <code> » : « Code », liste « Sorte » (planche, rang, gouttiere),
 *   « Longueur (m) », « Largeur (m) », « Nombre de places » (gouttière), « Enregistrer »,
 *   « Mettre hors service » / « Remettre en service », « Supprimer la planche ».
 * - Chaque enregistrement : bandeau [data-testid="saisie-annulable"] avec « Annuler » (10 s),
 *   qui défait en une transaction (création : suppression douce).
 * - « Importer un tableur » appelle `surImporter`.
 */
import type { ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';

export type Verdict<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly champ: string; readonly message: string };

export interface SaisieSaison {
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

export interface SaisieZone {
  readonly nom: string;
  readonly typeAbri: string;
  readonly parenteId: string | null;
}

export interface SaisieLot {
  readonly nombre: string;
  readonly prefixe: string;
  readonly longueur: string;
  readonly largeur: string;
}

export interface LotVerifie {
  readonly codes: readonly string[];
  readonly longueurM: number;
  readonly largeurM: number;
}

export interface SaisieEmplacement {
  readonly code: string;
  readonly sorte: string;
  readonly longueur: string;
  readonly largeur: string;
  readonly nombrePlaces: string;
}

export interface EmplacementVerifie {
  readonly code: string;
  readonly sorte: 'planche' | 'rang' | 'gouttiere';
  readonly longueurM: number;
  readonly largeurM: number | null;
  readonly nombrePlaces: number | null;
}

export interface ModuleRegles {
  /** Saison proposée : l'année du jour, ou la première année suivante dont le nom n'est pas pris. */
  saisonProposee(aujourdhui: string, nomsPris: readonly string[]): SaisieSaison;
  verifierSaison(s: SaisieSaison): Verdict<SaisieSaison>;
  verifierZone(z: SaisieZone): Verdict<SaisieZone>;
  /** Codes d'un lot : <préfixe><n>, n à la suite du plus grand numéro déjà pris avec ce préfixe. */
  codesDuLot(prefixe: string, nombre: number, codesPris: readonly string[]): string[];
  verifierLot(l: SaisieLot, codesPris: readonly string[]): Verdict<LotVerifie>;
  /** `codesPris` : codes des AUTRES emplacements en service de la zone. */
  verifierEmplacement(e: SaisieEmplacement, codesPris: readonly string[]): Verdict<EmplacementVerifie>;
  /** « 0,8 » → 0.8 ; texte vide ou illisible → null. */
  lireNombre(texte: string): number | null;
}

export interface ProprietesEcranParcellaire {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly section?: 'saisons' | 'zones';
  readonly surFermer: () => void;
  readonly surImporter?: () => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

export interface ModuleParcellaire {
  readonly EcranParcellaire: (p: ProprietesEcranParcellaire) => ReactElement;
}
