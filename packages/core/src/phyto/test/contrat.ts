/**
 * Contrat de T52 dans le cœur — traitements phyto : délai avant récolte (DAR), dose maximale,
 * produits de la ferme, registre (docs/backlog/T52-registre-phyto.md). Tout est lu dans
 * `@planif/core` (src/index.ts), tel que le serveur (apps/api/src/sync/phyto.ts), l'écran
 * Aujourd'hui (saisie, alerte), les écrans de la ferme (produits, registre) et l'export
 * l'importent. Le fichier qui les définit est libre (src/phyto/ conseillé).
 *
 * Le module est chargé dynamiquement (`chargerPhyto`) : tant que les fonctions n'existent pas,
 * les tests échouent sur un message clair au lieu de casser le typage du dépôt.
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Principe 2 : le calcul des dates est du code déterministe et testé. Rien ici ne lit une base,
 * le réseau ni l'horloge ; rien ne lève.
 *
 * ── dateRecolteAutorisee(date, delaiAvantRecolteJours) ──────────────────────────────────────
 *
 * `date` + DAR jours (calendrier, sans fuseau). DAR 3 j, traité le 2027-05-10 → '2027-05-13'.
 * DAR 0 : le jour même.
 *
 * ── detailTraitement(produit, saisie, date) ─────────────────────────────────────────────────
 *
 * Le DetailTraitement de T01 d'un traitement fait le `date` avec `produit` : produitPhytoId =
 * produit.id, recolteAutoriseeLe = dateRecolteAutorisee(date, produit.delaiAvantRecolteJours),
 * dose, surfaceTraiteeM2, cible et operateur de la saisie (cible et opérateur : espaces de bord
 * retirés ; opérateur facultatif → ''). Le DAR est FIGÉ dans le détail : changer le produit
 * ensuite ne change pas un traitement passé.
 *
 * ── avertissementDose(dose, doseMaximale) ───────────────────────────────────────────────────
 *
 * Dose au-dessus de la dose maximale déclarée, dans la même unité (casse et espaces de bord
 * ignorés) → un texte d'avertissement en français qui cite la dose maximale (« 3 L/ha »).
 * Sinon (dose maximale absente, dose ≤ max, unités différentes) → null. Jamais un refus :
 * validerSaisie accepte la saisie.
 *
 * ── interdictionRecolte(traitements, emplacementIds, date) ──────────────────────────────────
 *
 * `traitements` : événements de type traitement tels que lus (TraitementLu), corrections et
 * annulations comprises. Seuls comptent les traitements EN VIGUEUR : une chaîne (l'origine, ses
 * corrections, leurs annulations, remontées par remplaceEvenementId) qui contient une annulation
 * n'a plus rien en vigueur ; sinon la correction la plus récente (horodatage, puis id), à défaut
 * l'origine (même règle que la vue evenements_en_vigueur). Un traitement en vigueur interdit la
 * récolte sur ses emplacements du jour du traitement (compris) à recolteAutoriseeLe (exclu).
 * Rend, parmi les traitements en vigueur qui touchent l'un des `emplacementIds` (casse
 * ignorée) et interdisent la récolte le `date`, celui dont recolteAutoriseeLe est la plus
 * tardive ; null si aucun.
 *
 * ── texteInterdiction(interdiction, nomProduit) ─────────────────────────────────────────────
 *
 * « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05) » : jusqu'au =
 * recolteAutoriseeLe, traité le = date du traitement, JJ/MM.
 *
 * ── surfaceEmplacements(emplacements) ───────────────────────────────────────────────────────
 *
 * Somme des longueur × largeur (m²), arrondie au centième ; un emplacement sans largeur ne
 * compte pas. 30 m × 0,8 m + 25 m × 1,2 m = 54.
 *
 * ── validerProduitPhyto(entree) ─────────────────────────────────────────────────────────────
 *
 * Ligne `produit_phyto` au format PowerSync, avec son `id` : id, ferme_id, nom_commercial,
 * numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale
 * (texte JSON ou objet { valeur, unite }, ou null), + cree_le, modifie_le (tolérées),
 * supprime_le (null ou instant ISO). Autre colonne → 'colonne_inconnue'.
 *
 *   id, ferme_id                UUID obligatoires (ferme_id nul : la bibliothèque, refusé).
 *   nom_commercial              texte non vide, 200 caractères au plus (espaces de bord retirés).
 *   numero_amm                  texte, 40 caractères au plus ('' permis : produit sans AMM).
 *   substance_active            texte, 200 caractères au plus ('' permis).
 *   delai_avant_recolte_jours   entier de 0 à 365.
 *   utilisable_en_bio           0 / 1 ou booléen.
 *   dose_maximale               null, ou valeur > 0 (100 000 au plus) et unité non vide (20
 *                               caractères au plus).
 *
 * ── lignesRegistrePhyto(tables, fermeId) ────────────────────────────────────────────────────
 *
 * Le registre phyto, une ligne par traitement EN VIGUEUR de la ferme (sans les annulés, ni les
 * traitements remplacés par une correction), dans l'ordre (date, horodatage, id). `tables` :
 * les lignes de la base locale (format de l'export : snake_case, JSON en texte) des tables
 * evenement, produit_phyto (de la ferme et de la bibliothèque), emplacement, serie, campagne,
 * plantation, espece, variete ; les autres fermes sont ignorées. Colonnes (LigneRegistre) :
 * date, produit (nom commercial), amm, substanceActive, bio (booléen), dose, uniteDose,
 * surfaceTraiteeM2, emplacements (codes, triés, séparés par « , »), culture (« Espèce » ou
 * « Espèce Variété », '' sans culture), cible, operateur, recolteAutoriseeLe, evenementId.
 *
 * ── Export (src/export) ─────────────────────────────────────────────────────────────────────
 *
 * L'archive gagne `registre-phyto.csv` (BOM, « ; », virgule décimale, comme les autres CSV),
 * en-tête : COLONNES_REGISTRE_PHYTO (noms en français), une ligne par ligne du registre.
 */
import type { DateCalendaire } from '../../dates/index.ts';
import type { DetailTraitement, Quantite } from '../../domaine/index.ts';

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: { readonly code: string; readonly champ: string | null; readonly message: string } };

export interface ProduitPourTraitement {
  readonly id: string;
  readonly nomCommercial: string;
  readonly delaiAvantRecolteJours: number;
  readonly doseMaximale: Quantite | null;
}

export interface SaisieTraitement {
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  readonly operateur: string | null;
}

/** Événement de type traitement, tel que lu de la base locale (camelCase). */
export interface TraitementLu {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly emplacementIds: readonly string[];
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
  readonly produitPhytoId: string;
  readonly recolteAutoriseeLe: string;
}

export interface InterdictionRecolte {
  readonly evenementId: string;
  readonly produitPhytoId: string;
  /** Date du traitement. */
  readonly dateTraitement: string;
  /** Premier jour où la récolte est permise. */
  readonly recolteAutoriseeLe: string;
}

export interface ProduitPhytoEcrit {
  readonly id: string;
  readonly fermeId: string;
  readonly nomCommercial: string;
  readonly numeroAmm: string;
  readonly substanceActive: string;
  readonly delaiAvantRecolteJours: number;
  readonly utilisableEnBio: boolean;
  readonly doseMaximale: Quantite | null;
  readonly supprimeLe: number | null;
}

export interface LigneRegistre {
  readonly evenementId: string;
  readonly date: string;
  readonly produit: string;
  readonly amm: string;
  readonly substanceActive: string;
  readonly bio: boolean;
  readonly dose: number;
  readonly uniteDose: string;
  readonly surfaceTraiteeM2: number;
  readonly emplacements: string;
  readonly culture: string;
  readonly cible: string;
  readonly operateur: string;
  readonly recolteAutoriseeLe: string;
}

export type LigneLocale = Readonly<Record<string, string | number | null>>;

export interface ModulePhyto {
  dateRecolteAutorisee(date: DateCalendaire, delaiAvantRecolteJours: number): DateCalendaire;
  detailTraitement(produit: ProduitPourTraitement, saisie: SaisieTraitement, date: DateCalendaire): DetailTraitement;
  avertissementDose(dose: Quantite, doseMaximale: Quantite | null): string | null;
  interdictionRecolte(traitements: readonly TraitementLu[], emplacementIds: readonly string[], date: string): InterdictionRecolte | null;
  texteInterdiction(interdiction: InterdictionRecolte, nomProduit: string): string;
  surfaceEmplacements(emplacements: readonly { readonly longueurM: number; readonly largeurM: number | null }[]): number;
  validerProduitPhyto(entree: unknown): Resultat<ProduitPhytoEcrit>;
  lignesRegistrePhyto(tables: Readonly<Record<string, readonly LigneLocale[] | undefined>>, fermeId: string): LigneRegistre[];
  readonly COLONNES_REGISTRE_PHYTO: readonly string[];
}

const CHEMIN_COEUR = '../../index.ts';

export async function chargerPhyto(): Promise<ModulePhyto> {
  const m = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModulePhyto>;
  const noms = [
    'dateRecolteAutorisee',
    'detailTraitement',
    'avertissementDose',
    'interdictionRecolte',
    'texteInterdiction',
    'surfaceEmplacements',
    'validerProduitPhyto',
    'lignesRegistrePhyto',
    'COLONNES_REGISTRE_PHYTO',
  ] as const;
  const absents = noms.filter((n) => m[n] === undefined);
  if (absents.length > 0) throw new Error(`@planif/core n’exporte pas encore : ${absents.join(', ')} (T52)`);
  return m as ModulePhyto;
}
