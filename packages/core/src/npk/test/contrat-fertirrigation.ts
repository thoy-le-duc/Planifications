/**
 * Contrat de T56 dans le cœur — fertirrigation : recettes et apports par vanne, en hors-sol et en
 * pleine terre (docs/backlog/T56-fertirrigation.md, Q44). Tout est lu dans `@planif/core`
 * (src/index.ts). Pur : ni base, ni réseau, ni horloge ; ne lève jamais. Les tests chargent le
 * module par un chemin tenu dans une variable : leur typage ne dépend que de ce contrat.
 *
 * ## Recette (règle 1)
 *
 * Ligne `recette_fertirrigation` (format PowerSync, snake_case) : id, ferme_id (OBLIGATOIRE : pas
 * de bibliothèque commune), nom (1 à 200 caractères après trim), taux_injection (en %, de plus de
 * 0 à 100, ou null), engrais (texte JSON ou tableau : 1 à 20 engrais
 * `{ produitFertilisantId, quantite: { valeur, unite } }`, produit fertilisant de la ferme,
 * quantité strictement positive d'au plus 100 000, unité 'kg' ou 'L', un même produit une fois),
 * ec_cible (mS/cm, de 0 à 20, facultative), ph_cible (de 0 à 14, facultatif), cree_le,
 * modifie_le (tolérées), supprime_le (archivage). Colonne inconnue → 'colonne_inconnue'.
 *
 * Deux façons de doser, selon `taux_injection` :
 *   - taux donné : les quantités sont pour 1 000 L de SOLUTION MÈRE, injectée à ce taux dans
 *     l'eau (1 % = 10 L de mère par m³ d'eau) ;
 *   - taux null : les quantités sont par m³ d'EAU d'irrigation.
 * `validerRecetteFertirrigation(ligne)` → { ok, valeur: RecetteFertirrigationEcrite } ou
 * { ok: false, erreur }.
 *
 * ## Irrigation qui porte une recette (règle 2)
 *
 * Le détail d'un événement `irrigation` garde `secteurIrrigationId` et `dureeMinutes`, et peut
 * porter, tous facultatifs : `recetteFertirrigationId`, `volumeM3` (> 0, au plus 10 000),
 * `ecMesuree` (0 à 20), `phMesure` (0 à 14), `engrais` (doses injectées, FIGÉES à la saisie :
 * `{ produitFertilisantId, produit, quantite: { valeur, unite } }`, 1 à 20). Une recette exige
 * `volumeM3` et `engrais` ; `engrais` sans recette est incohérent ('incoherent'). Une irrigation
 * d'avant T56 reste valide telle quelle.
 *
 * - `volumeIrrigationM3(dureeMinutes, debitLitresHeure)` : durée × débit, en m³ au litre près ;
 *   débit absent → null.
 * - `dosesFertirrigation(recette, volumeM3)` : quantité de chaque engrais injectée =
 *   quantité × taux ÷ 100 × volume (taux donné), ou quantité × volume (par m³).
 * - `detailFertirrigation(e)` : le détail complet d'une irrigation avec recette (doses figées, nom
 *   de chaque produit), accepté par `validerSaisie`.
 *
 * ## Calcul (règle 3)
 *
 * - `unitesFertirrigation(doses, produits)` : kg de N, P₂O₅, K₂O apportés, avec les teneurs des
 *   produits fertilisants (T54, même règle : un solide compté en L est sans unités), au gramme.
 * - `repartitionAuProrata(kg, surfaces)` : part de chaque emplacement au prorata de sa surface,
 *   au gramme, la somme des parts égale au total ; kg/ha (identiques pour tous) au centième.
 *   Surface inconnue ou nulle → null.
 * - `bilanFertilisation` et `lignesCahierFertilisation` (T54) comptent aussi les irrigations EN
 *   VIGUEUR qui portent des engrais : un apport par engrais, catégorie 'fertirrigation', sur les
 *   emplacements que la vanne arrosait LE JOUR de l'irrigation (liens datés `secteur_emplacement`
 *   non supprimés, T57). Une irrigation sans recette ne compte rien.
 */
import type { Unites } from './contrat.ts';

export type { Unites } from './contrat.ts';

export interface QuantiteEngrais {
  readonly valeur: number;
  readonly unite: string;
}

export interface EngraisRecette {
  readonly produitFertilisantId: string;
  readonly quantite: QuantiteEngrais;
}

export interface RecetteFertirrigationEcrite {
  readonly id: string;
  readonly fermeId: string;
  readonly nom: string;
  readonly tauxInjection: number | null;
  readonly engrais: readonly EngraisRecette[];
  readonly ecCible: number | null;
  readonly phCible: number | null;
  readonly supprimeLe: string | null;
}

export interface DoseInjectee {
  readonly produitFertilisantId: string;
  readonly quantite: QuantiteEngrais;
}

export interface PartEmplacement {
  readonly emplacementId: string;
  readonly kg: Unites;
  readonly kgParHa: Unites;
}

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: { readonly code: string; readonly champ: string | null; readonly message: string } };

export type LigneLocale = Readonly<Record<string, string | number | null>>;

export interface ModuleFertirrigation {
  readonly LIMITES_RECETTE_FERTIRRIGATION: { readonly nomCaracteres: number; readonly engraisMax: number };
  validerRecetteFertirrigation(ligne: unknown): Resultat<RecetteFertirrigationEcrite>;
  volumeIrrigationM3(dureeMinutes: number, debitLitresHeure: number | null): number | null;
  dosesFertirrigation(recette: { readonly tauxInjection: number | null; readonly engrais: readonly EngraisRecette[] }, volumeM3: number): readonly DoseInjectee[];
  detailFertirrigation(e: {
    readonly secteurIrrigationId: string;
    readonly dureeMinutes: number;
    readonly recette: { readonly id: string; readonly tauxInjection: number | null; readonly engrais: readonly EngraisRecette[] };
    /** Nom de chaque produit, par id. */
    readonly noms: ReadonlyMap<string, string>;
    readonly volumeM3: number;
    readonly ecMesuree: number | null;
    readonly phMesure: number | null;
  }): Readonly<Record<string, unknown>>;
  unitesFertirrigation(doses: readonly DoseInjectee[], produits: readonly LigneLocale[]): Unites | null;
  repartitionAuProrata(kg: Unites, surfaces: readonly { readonly emplacementId: string; readonly surfaceM2: number | null }[]): readonly PartEmplacement[] | null;
  /** T54 : le cahier exporté (une ligne par apport réalisé en vigueur). */
  lignesCahierFertilisation(tables: Readonly<Record<string, readonly LigneLocale[] | undefined>>, fermeId: string): readonly Readonly<Record<string, string | number | null>>[];
  validerSaisie(entree: unknown): { readonly ok: boolean; readonly erreur?: { readonly code: string; readonly champ: string | null } };
}

const CHEMIN_COEUR = '../../index.ts';

export async function chargerFertirrigation(): Promise<ModuleFertirrigation> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as ModuleFertirrigation;
}
