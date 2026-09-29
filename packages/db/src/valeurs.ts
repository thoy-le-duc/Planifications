/**
 * Valeurs permises des unions de T01, contrôlées en base par des CHECK.
 *
 * Chaque liste est vérifiée à la compilation contre le type de `@planif/core` : une valeur
 * ajoutée au domaine sans être ajoutée ici fait échouer `pnpm typecheck`.
 */
import type {
  CategorieEspece,
  CategorieIntervention,
  EtapeRealisee,
  ModeItineraire,
  NatureObservation,
  Modification,
  MotifMouvementStock,
  NatureAssolement,
  OperationLigne,
  Proposition,
  RemplacementEvenement,
  SorteEmplacement,
  SourceSaisie,
  StatutProposition,
  StatutSerie,
  TypeAbri,
  TypeAncreSerie,
  TypeEvenement,
  UniteRecolte,
} from '@planif/core';

/** Liste non vide sans valeur manquante : `Manquantes` doit être `never`. */
type Complete<T extends string, L extends readonly T[]> = [Exclude<T, L[number]>] extends [never]
  ? L
  : { readonly valeursManquantes: Exclude<T, L[number]> };

function toutes<T extends string>() {
  return <const L extends readonly [T, ...T[]]>(liste: L & Complete<T, L>): L => liste;
}

export const TYPES_ABRI = toutes<TypeAbri>()(['plein_champ', 'tunnel', 'serre', 'hors_sol']);
export const SORTES_EMPLACEMENT = toutes<SorteEmplacement>()(['planche', 'rang', 'gouttiere']);
export const CATEGORIES_ESPECE = toutes<CategorieEspece>()([
  'legume',
  'petit_fruit',
  'fruit',
  'fleur',
  'aromatique',
  'engrais_vert',
]);
export const UNITES_RECOLTE = toutes<UniteRecolte>()(['kg', 'botte', 'piece', 'barquette']);
export const MODES_ITINERAIRE = toutes<ModeItineraire>()(['semis_direct', 'plant_maison', 'plant_achete']);
export const TYPES_ANCRE = toutes<TypeAncreSerie>()(['semis', 'plantation', 'debut_recolte']);
export const STATUTS_SERIE = toutes<StatutSerie>()(['prevue', 'en_cours', 'terminee', 'abandonnee']);
export const NATURES_ASSOLEMENT = toutes<NatureAssolement>()(['prevu', 'passe_saisi', 'passe_importe']);
export const TYPES_EVENEMENT = toutes<TypeEvenement>()([
  'realise',
  'recolte',
  'intervention',
  'irrigation',
  'traitement',
  'observation',
]);
export const SOURCES_SAISIE = toutes<SourceSaisie>()(['tap', 'voix', 'agent', 'photo', 'import']);
export const SORTES_REMPLACEMENT = toutes<RemplacementEvenement['sorte']>()(['correction', 'annulation']);
export const ETAPES_REALISEES = toutes<EtapeRealisee>()(['semis_pepiniere', 'semis_direct', 'plantation', 'arrachage']);
export const NATURES_OBSERVATION = toutes<NatureObservation>()(['ravageur', 'maladie', 'stade', 'autre']);
export const CATEGORIES_INTERVENTION = toutes<CategorieIntervention>()([
  'travail_sol',
  'couverture',
  'fertilisation',
  'amendement',
  'entretien',
]);
export const MOTIFS_MOUVEMENT = toutes<MotifMouvementStock>()(['recolte', 'vente', 'perte', 'ajustement']);
export const SOURCES_PROPOSITION = toutes<Proposition['source']>()(['voix', 'agent', 'photo']);
export const STATUTS_PROPOSITION = toutes<StatutProposition>()(['en_attente', 'validee', 'rejetee']);
export const OPERATIONS_LIGNE = toutes<OperationLigne>()(['creation', 'modification', 'suppression']);
/** Tables visées par le journal des modifications : les noms d'entité de T01, tels quels. */
export const TABLES_MODIFIABLES = toutes<Modification['table']>()([
  'Ferme',
  'Zone',
  'Emplacement',
  'SecteurIrrigation',
  'SecteurEmplacement',
  'Famille',
  'Espece',
  'Variete',
  'Itineraire',
  'Saison',
  'Serie',
  'Plantation',
  'Campagne',
  'Occupation',
  'Assolement',
  'Evenement',
  'ArticleStock',
  'MouvementStock',
  'ProduitPhyto',
  'Proposition',
]);

/** Rôle d'un membre dans une ferme (T09). Pas d'union dans T01 : la liste fait foi. */
export const ROLES_MEMBRE = ['gerant', 'equipier'] as const;
export type RoleMembre = (typeof ROLES_MEMBRE)[number];

/**
 * État d'un membre (T09, relecture sécurité) : « invite » tant que l'invité n'a pas réussi une
 * connexion après son invitation, « accepte » ensuite. Seul un membre accepté est membre actif.
 */
export const ETATS_MEMBRE = ['invite', 'accepte'] as const;
export type EtatMembre = (typeof ETATS_MEMBRE)[number];

/** Opérations de la file d'écritures de PowerSync (`CrudEntry.op`), reçues par POST /sync/upload (T10). */
export const OPERATIONS_SYNCHRO = ['PUT', 'PATCH', 'DELETE'] as const;
export type OperationSynchro = (typeof OPERATIONS_SYNCHRO)[number];
