/**
 * Contrat de T54 dans le cœur — cahier de fertilisation (docs/backlog/T54-cahier-fertilisation.md).
 * Tout est lu dans `@planif/core` (src/index.ts) ; le fichier qui le définit est libre
 * (`fertilisation/index.ts` par exemple). Pur : ni base, ni réseau, ni horloge ; ne lève jamais.
 * Les tests chargent le module par un chemin tenu dans une variable : leur typage ne dépend que
 * de ce contrat.
 *
 * ## Produit fertilisant de la ferme (règle 1)
 *
 * Ligne `produit_fertilisant` (format PowerSync, snake_case) : id, ferme_id (OBLIGATOIRE : pas de
 * bibliothèque commune, la liste de départ est copiée dans la ferme), nom (1 à 200 caractères,
 * après trim), forme ('solide' | 'liquide'), unite ('kg' | 't' | 'L' | 'm3'), teneur_n,
 * teneur_p2o5, teneur_k2o (en %, facultatives : null, ou nombre fini de 0 à 100), organique (0/1
 * ou booléen : azote d'origine organique, pour le plafond de la zone vulnérable),
 * utilisable_en_bio (0/1 ou booléen), source (texte de 300 caractères au plus, vide permis),
 * cree_le, modifie_le (tolérées), supprime_le (archivage). Clé inconnue → 'cle_inconnue'.
 * `validerProduitFertilisant(ligne)` → { ok, valeur: ProduitFertilisantEcrit } ou { ok: false, erreur }.
 *
 * Teneur : % de la masse du produit tel qu'apporté (kg et t) ; pour un liquide compté en L ou m³,
 * kg d'élément pour 100 L (densité prise à 1 : la teneur se saisit en conséquence).
 *
 * ## Liste de départ (règle 1)
 *
 * `FERTILISANTS_DEPART` : produits proposés à une ferme qui n'en a encore aucun ; chacun passe
 * `validerProduitFertilisant` (avec un id et une ferme), a une `source` non vide (document public
 * cité, avec sa date) et ses teneurs moyennes, ou null quand la source n'en donne pas de sûre.
 * Contient au moins un compost de déchets verts, un fumier de bovin, de la corne broyée et de la
 * vinasse (liste du ticket).
 *
 * ## Calcul (règle 3)
 *
 * - `quantiteEnKg(q)` : 'kg' → valeur ; 't' → ×1 000 ; 'L' → valeur (densité 1) ; 'm3' ou 'm³' →
 *   ×1 000. Unité comparée sans casse ni espaces autour. Autre unité (« brouette ») → null.
 * - `unitesApport(q, teneurs)` : kg de N, P₂O₅, K₂O = quantité en kg × teneur ÷ 100 ; teneur
 *   absente → null pour cet élément ; quantité non convertible, ou aucune teneur → null.
 * - `parHectare(u, surfaceM2)` : kg ÷ surface × 10 000 ; surface nulle, absente ou ≤ 0 → null.
 *   Exemple du ticket : 2 t de compost à 1 % N sur 100 m² → 20 kg N, soit 2 000 kg N/ha.
 * - Nombres arrondis au centième (pas de 0,30000000000000004).
 *
 * ## Saisie d'un apport (règle 2)
 *
 * `detailApport(categorie, produit, quantite)` : le détail d'une intervention « fertilisation »
 * (type 'engrais') ou « amendement » (type 'amendement'), avec `produit` = le nom, `quantite`, et
 * `produitFertilisantId` = l'id du produit de la ferme (null pour un texte libre). Accepté par
 * `validerSaisie`. `validerSaisie` accepte aussi `detail.produitFertilisantId` absent (saisies
 * d'avant T54) ou null, refuse un id qui n'est pas un UUID ('champ_invalide').
 *
 * ## Bilan (règle 3)
 *
 * `bilanFertilisation(tables, fermeId)` lit les lignes locales : evenement, produit_fertilisant,
 * emplacement, saison, serie, occupation. Les autres fermes sont ignorées.
 *
 * - **Apports réalisés** : événements « intervention » de catégorie fertilisation ou amendement, EN
 *   VIGUEUR (sans les annulés, la correction la plus récente d'une chaîne). Produit : celui de
 *   `produitFertilisantId` (de la ferme, même archivé) ; à défaut, le produit de la ferme dont le
 *   nom est égal au texte saisi (sans casse ni espaces autour ; un seul possible, les non archivés
 *   d'abord) ; sinon aucun (texte libre : apport compté, sans unités).
 * - Surface d'un apport : somme longueur × largeur de ses emplacements ; un emplacement sans
 *   largeur (ou introuvable) → surface inconnue (null), kg comptés, kg/ha null.
 * - **Apports prévus** : occurrences des travaux prévus fertilisation / amendement
 *   (`serie.parametres.travauxPrevus`, dates `datesTravailPrevu` sur les dates prévues de la série)
 *   des séries prévues ou en cours non supprimées, sur les emplacements de leurs occupations non
 *   supprimées, sauf celles déjà soldées par une intervention en vigueur de la même série, même
 *   catégorie et même type dont `occurrenceVisee` est à cette date ou après. Produit trouvé par
 *   son nom, comme ci-dessus.
 * - `parEmplacement` : une entrée par (emplacement, période) qui a au moins un apport réalisé ou
 *   prévu ; période = nom de la saison de la ferme qui contient la date (la plus récente si
 *   plusieurs), à défaut l'année 'AAAA'. `realise` et `prevu` : sommes des kg/ha (N, P₂O₅, K₂O,
 *   et N des produits organiques), nombre d'apports, nombre d'apports « sans unités » (kg/ha null).
 *
 * ## Zone vulnérable nitrates (règle 6)
 *
 * `alertesAzoteOrganique(bilan, plafond = 170)` : par emplacement et par ANNÉE CIVILE, N organique
 * réalisé (kg/ha) et prévu ; alerte 'realise' si le réalisé dépasse strictement le plafond,
 * 'prevu' si seul réalisé + prévu le dépasse. Rien sinon. L'option de la ferme
 * (`ferme.zone_vulnerable_nitrates`) décide si l'écran montre plan et alertes : le calcul ne la lit pas.
 *
 * ## Cahier (règle 4)
 *
 * `COLONNES_CAHIER_FERTILISATION` et `cahier-fertilisation.csv` dans l'export : une ligne par
 * apport RÉALISÉ en vigueur de la ferme, dans l'ordre des dates.
 */
import type { DetailIntervention, Quantite } from '../../domaine/index.ts';

export type LigneLocale = Readonly<Record<string, string | number | null>>;
export type Tables = Readonly<Record<string, readonly LigneLocale[] | undefined>>;

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: { readonly code: string; readonly champ: string | null; readonly message: string } };

export interface ProduitFertilisantEcrit {
  readonly id: string;
  readonly fermeId: string;
  readonly nom: string;
  readonly forme: 'solide' | 'liquide';
  readonly unite: 'kg' | 't' | 'L' | 'm3';
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
  readonly organique: boolean;
  readonly utilisableEnBio: boolean;
  readonly source: string;
  readonly supprimeLe: string | null;
}

export interface ProduitDeDepart {
  readonly nom: string;
  readonly forme: 'solide' | 'liquide';
  readonly unite: 'kg' | 't' | 'L' | 'm3';
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
  readonly organique: boolean;
  readonly utilisableEnBio: boolean;
  readonly source: string;
}

export interface Teneurs {
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
}

export interface Unites {
  readonly n: number | null;
  readonly p2o5: number | null;
  readonly k2o: number | null;
}

export interface ApportCalcule {
  /** null pour un apport prévu. */
  readonly evenementId: string | null;
  readonly date: string;
  readonly prevu: boolean;
  readonly categorie: 'fertilisation' | 'amendement';
  /** Nom du produit de la ferme, à défaut le texte saisi. */
  readonly produit: string;
  readonly produitId: string | null;
  readonly quantite: number;
  readonly unite: string;
  readonly emplacementIds: readonly string[];
  readonly surfaceM2: number | null;
  readonly organique: boolean;
  /** null : sans unités (produit inconnu, sans teneur, unité non convertible). */
  readonly kg: Unites | null;
  readonly kgParHa: Unites | null;
}

export interface TotalFertilisation {
  readonly n: number;
  readonly p2o5: number;
  readonly k2o: number;
  readonly nOrganique: number;
  readonly apports: number;
  readonly sansUnites: number;
}

export interface BilanEmplacement {
  readonly emplacementId: string;
  readonly periode: string;
  readonly realise: TotalFertilisation;
  readonly prevu: TotalFertilisation;
}

export interface BilanFertilisation {
  readonly apports: readonly ApportCalcule[];
  readonly prevus: readonly ApportCalcule[];
  readonly parEmplacement: readonly BilanEmplacement[];
}

export interface AlerteAzote {
  readonly emplacementId: string;
  readonly annee: string;
  readonly realiseKgHa: number;
  readonly prevuKgHa: number;
  readonly sorte: 'realise' | 'prevu';
}

export interface ModuleFertilisation {
  validerProduitFertilisant(entree: unknown): Resultat<ProduitFertilisantEcrit>;
  readonly FERTILISANTS_DEPART: readonly ProduitDeDepart[];
  readonly PLAFOND_AZOTE_ORGANIQUE_KG_HA: number;
  quantiteEnKg(q: Quantite): number | null;
  unitesApport(q: Quantite, t: Teneurs): Unites | null;
  parHectare(u: Unites, surfaceM2: number | null): Unites | null;
  detailApport(categorie: 'fertilisation' | 'amendement', produit: { readonly id: string | null; readonly nom: string }, quantite: Quantite): DetailIntervention;
  bilanFertilisation(tables: Tables, fermeId: string): BilanFertilisation;
  alertesAzoteOrganique(bilan: BilanFertilisation, plafond?: number): AlerteAzote[];
  readonly COLONNES_CAHIER_FERTILISATION: readonly string[];
}

const CHEMIN_COEUR = '../../index.ts';

export async function chargerFertilisation(): Promise<ModuleFertilisation> {
  const m = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleFertilisation>;
  const noms = [
    'validerProduitFertilisant',
    'FERTILISANTS_DEPART',
    'PLAFOND_AZOTE_ORGANIQUE_KG_HA',
    'quantiteEnKg',
    'unitesApport',
    'parHectare',
    'detailApport',
    'bilanFertilisation',
    'alertesAzoteOrganique',
    'COLONNES_CAHIER_FERTILISATION',
  ] as const;
  const absents = noms.filter((n) => m[n] === undefined);
  if (absents.length > 0) throw new Error(`@planif/core n’exporte pas encore : ${absents.join(', ')} (T54)`);
  return m as ModuleFertilisation;
}
