/**
 * Entités du modèle de données v1 (docs/modele-donnees.md), en camelCase.
 *
 * Conventions :
 * - chaque ligne porte `id` et, sauf la ferme, `fermeId` (frontière de la synchro et de l'export) ;
 * - suppression douce : `supprimeLe` est renseigné au lieu d'effacer la ligne ;
 * - dates de culture en `DateCalendaire`, instants (horodatage d'une saisie) en `Instant` ;
 * - unités du modèle : mètres, jours, kilos ; pourcentages en entiers (voir T05) ;
 * - un champ facultatif vaut `null`, jamais `undefined`, pour un export JSON/CSV sans trou.
 */
import type { DateCalendaire } from '../dates/index.ts';
import type { Id, NomEntite } from './identifiants.ts';

// ---------------------------------------------------------------------------------------------
// Grandeurs (alias documentaires : l'unité est dans le nom du champ et ici)
// ---------------------------------------------------------------------------------------------

/** Instant UTC en millisecondes depuis l'époque Unix (horodatage d'une saisie, pas une date de culture). */
export type Instant = number;
/** Longueur en mètres. */
export type Metres = number;
/** Longueur en centimètres, entière (écartements, largeurs semées : calculs entiers de T05). */
export type Centimetres = number;
/** Surface en mètres carrés. */
export type MetresCarres = number;
/** Durée en jours entiers. */
export type Jours = number;
/** Durée en minutes entières. */
export type Minutes = number;
/** Durée en années entières (délais de retour de la rotation). */
export type Annees = number;
/** Pourcentage entier de 0 à 100 (germination, marge, perte). */
export type Pourcentage = number;
/** Masse en grammes. */
export type Grammes = number;

/** Unité de récolte et de stock. */
export type UniteRecolte = 'kg' | 'botte' | 'piece' | 'barquette';

/** Quantité accompagnée de son unité libre (dose d'engrais, de produit phyto : 'kg', 'L/ha'…). */
export interface Quantite {
  readonly valeur: number;
  readonly unite: string;
}

/** Identité d'une ligne rattachée à une ferme. */
interface IdentiteDeLigne<E extends NomEntite> {
  readonly id: Id<E>;
  readonly fermeId: Id<'Ferme'>;
}

/** Colonnes communes aux lignes modifiables d'une ferme (toutes sauf les événements). */
interface LigneDeFerme<E extends NomEntite> extends IdentiteDeLigne<E> {
  /** Suppression douce : instant de la suppression, `null` tant que la ligne est active. */
  readonly supprimeLe: Instant | null;
}

// ---------------------------------------------------------------------------------------------
// 1. Parcellaire
// ---------------------------------------------------------------------------------------------

export interface PositionGeographique {
  readonly latitude: number;
  readonly longitude: number;
}

/** Unités d'affichage de la ferme ; le stockage reste en mètres, jours et kilos. */
export interface UnitesFerme {
  readonly longueur: 'm';
  readonly masse: 'kg';
}

export interface Ferme {
  readonly id: Id<'Ferme'>;
  readonly nom: string;
  /** Fuseau IANA ('Europe/Paris') : sert à dater les saisies dans le jour local de la ferme. */
  readonly fuseauHoraire: string;
  /** Pour la météo. */
  readonly position: PositionGeographique | null;
  readonly unites: UnitesFerme;
  readonly supprimeLe: Instant | null;
}

export type TypeAbri = 'plein_champ' | 'tunnel' | 'serre' | 'hors_sol';

/** Tunnel, serre, îlot, verger ; une zone peut contenir des sous-zones (chapelles, sous-îlots). */
export interface Zone extends LigneDeFerme<'Zone'> {
  readonly nom: string;
  readonly zoneParenteId: Id<'Zone'> | null;
  readonly typeAbri: TypeAbri;
  readonly surfaceM2: MetresCarres | null;
}

export type SorteEmplacement = 'planche' | 'rang' | 'gouttiere';

interface EmplacementCommun extends LigneDeFerme<'Emplacement'> {
  readonly zoneId: Id<'Zone'>;
  /** Code court unique dans la ferme ('T2-P03') : c'est ce que la voix reconnaît. */
  readonly code: string;
  readonly longueurM: Metres;
  readonly largeurM: Metres | null;
  readonly actifDu: DateCalendaire;
  /** `null` tant que l'emplacement existe. */
  readonly actifAu: DateCalendaire | null;
  /** Anciens emplacements redessinés en celui-ci : garde l'historique de rotation. */
  readonly remplace: readonly Id<'Emplacement'>[];
}

export interface Planche extends EmplacementCommun {
  readonly sorte: 'planche';
}

export interface Rang extends EmplacementCommun {
  readonly sorte: 'rang';
}

/** Gouttière hors-sol : elle se remplit par places, pas par mètres. */
export interface Gouttiere extends EmplacementCommun {
  readonly sorte: 'gouttiere';
  readonly nombrePlaces: number;
}

export type Emplacement = Planche | Rang | Gouttiere;

/** Une vanne d'irrigation. */
export interface SecteurIrrigation extends LigneDeFerme<'SecteurIrrigation'> {
  readonly numeroVanne: number;
  readonly nom: string;
  /** Débit en litres par heure. */
  readonly debitLitresHeure: number | null;
  /** Adresse Modbus de la vanne (phase 3). */
  readonly adresseModbus: number | null;
}

/** Lien daté vanne ↔ emplacement, pour garder l'historique si le réseau change. */
export interface SecteurEmplacement extends LigneDeFerme<'SecteurEmplacement'> {
  readonly secteurIrrigationId: Id<'SecteurIrrigation'>;
  readonly emplacementId: Id<'Emplacement'>;
  readonly du: DateCalendaire;
  readonly au: DateCalendaire | null;
}

// ---------------------------------------------------------------------------------------------
// 2. Bibliothèque de cultures
// ---------------------------------------------------------------------------------------------

/** Famille botanique, avec ses délais de retour pour les alertes de rotation. */
export interface Famille extends LigneDeFerme<'Famille'> {
  readonly nom: string;
  readonly delaiRetourMinimalAns: Annees;
  readonly delaiRetourConseilleAns: Annees;
}

/** Délais de retour propres à une espèce : remplis ensemble ou pas du tout. */
export interface DelaisRetour {
  readonly minimalAns: Annees;
  readonly conseilleAns: Annees;
}

export type CategorieEspece = 'legume' | 'petit_fruit' | 'fruit' | 'fleur' | 'aromatique' | 'engrais_vert';

export interface Espece extends LigneDeFerme<'Espece'> {
  readonly nom: string;
  readonly familleId: Id<'Famille'>;
  readonly categorie: CategorieEspece;
  readonly perenne: boolean;
  readonly uniteRecolte: UniteRecolte;
  /** Remplacent ceux de la famille quand ils sont remplis (choux : 4 ans minimum, 6 conseillés) ; `null` : ceux de la famille s'appliquent. */
  readonly delaisRetour: DelaisRetour | null;
}

export interface Variete extends LigneDeFerme<'Variete'> {
  readonly especeId: Id<'Espece'>;
  readonly nom: string;
  readonly fournisseur: string | null;
  readonly poidsMilleGrainesG: Grammes | null;
  readonly tauxGermination: Pourcentage | null;
}

/** Semaine ISO de début et de fin de la période d'usage d'un itinéraire (peut chevaucher l'an). */
export interface PeriodeSemaines {
  readonly semaineDebut: number;
  readonly semaineFin: number;
}

export type FaconDensite = 'ecartement' | 'metre_lineaire' | 'volee';

/** Plants (ou mottes) posés à intervalle régulier sur chaque rang. */
export interface DensiteEcartement {
  readonly facon: 'ecartement';
  readonly rangsParPlanche: number;
  readonly ecartementSurRangCm: Centimetres;
}

/** Semis en ligne : graines par mètre de rang (la germination est déjà comptée). */
export interface DensiteMetreLineaire {
  readonly facon: 'metre_lineaire';
  readonly rangsParPlanche: number;
  readonly grainesParMetre: number;
}

/** Semis à la volée : dose sur la largeur semée. */
export interface DensiteVolee {
  readonly facon: 'volee';
  readonly largeurSemeeCm: Centimetres;
  readonly doseGParM2: Grammes;
}

export type Densite = DensiteEcartement | DensiteMetreLineaire | DensiteVolee;

export interface RendementAttendu {
  readonly par: 'metre' | 'plant';
  readonly quantite: number;
  readonly unite: UniteRecolte;
}

/** Paramètres propres aux pérennes (asperges, kiwis, pivoines, fraisiers conservés). */
export interface ParametresPerenne {
  readonly anneesAvantPremiereRecolte: Annees;
  readonly periodeRecolteAnnuelle: PeriodeSemaines;
  readonly rendementParPlantParAn: RendementAttendu | null;
}

export type ModeItineraire = 'semis_direct' | 'plant_maison' | 'plant_achete';

/** Repère d'un travail prévu : une étape de la série (T22). */
export type RepereTravail = 'semis_pepiniere' | 'mise_en_place' | 'debut_recolte' | 'fin_recolte';

/** Temps de travail estimé d'un travail prévu : minutes par 100 m de planche ou par planche. */
export interface TempsEstime {
  readonly minutes: Minutes;
  readonly par: 'cent_metres' | 'planche';
}

/** Produit d'un travail de fertilisation ou d'amendement, et sa quantité. */
export interface ProduitTravail {
  readonly nom: string;
  readonly quantite: Quantite;
}

/**
 * Travail prévu d'un itinéraire (T22) : « grelinette 10 jours avant la mise en place » vaut
 * repère `mise_en_place`, décalage −10. Répété tous les N jours jusqu'au repère de fin
 * (compris) quand `repetition` est donnée. Le produit est obligatoire en fertilisation et en
 * amendement, absent ailleurs (comme `DetailIntervention`).
 */
export interface TravailPrevu {
  readonly categorie: CategorieIntervention;
  /** Libellé du type d'intervention de la ferme, le même texte que `DetailIntervention.type`. */
  readonly type: string;
  readonly repere: RepereTravail;
  readonly decalageJours: number;
  readonly repetition: { readonly tousLesJours: Jours; readonly repereFin: RepereTravail } | null;
  readonly outil: string | null;
  readonly produit: ProduitTravail | null;
  readonly tempsEstime: TempsEstime | null;
}

/** Paramètres copiés tels quels dans l'instantané d'une série. */
interface ParametresCommuns {
  readonly periodeUsage: PeriodeSemaines | null;
  readonly typeAbri: TypeAbri | null;
  /** Comptée depuis la mise en place (semis direct ou plantation). */
  readonly dureeAvantRecolteJours: Jours;
  readonly fenetreRecolteJours: Jours;
  readonly margeSecurite: Pourcentage;
  readonly rendementAttendu: RendementAttendu | null;
  readonly perenne: ParametresPerenne | null;
  /** Travaux prévus (T22) ; absente dans les itinéraires et séries d'avant T22 : aucun travail. */
  readonly travauxPrevus?: readonly TravailPrevu[];
}

/** Semis direct : toutes les façons de compter la densité sont possibles. */
export interface ParametresSemisDirect extends ParametresCommuns {
  readonly mode: 'semis_direct';
  readonly densite: Densite;
  /**
   * Graines par poquet : ne sert qu'au semis direct à l'écartement (T05) ; `null` pour les
   * autres façons de compter, où la densité donne déjà les graines.
   */
  readonly grainesParPoquet: number | null;
}

/** Plant élevé à la ferme en pépinière, en mottes. */
export interface ParametresPlantMaison extends ParametresCommuns {
  readonly mode: 'plant_maison';
  /** Des mottes se posent à l'écartement : pas de dose à la volée sur un plant maison. */
  readonly densite: DensiteEcartement;
  readonly dureePepiniereJours: Jours;
  readonly grainesParMotte: number;
  readonly plantsParMotte: number;
  readonly pertePepiniere: Pourcentage;
  readonly alveolesParPlaque: number | null;
}

/** Plant acheté : pas de pépinière à la ferme. */
export interface ParametresPlantAchete extends ParametresCommuns {
  readonly mode: 'plant_achete';
  readonly densite: DensiteEcartement;
}

/** Paramètres techniques d'un itinéraire, discriminés par le mode : ce que la série fige. */
export type ParametresItineraire = ParametresSemisDirect | ParametresPlantMaison | ParametresPlantAchete;

interface IdentiteItineraire extends LigneDeFerme<'Itineraire'> {
  readonly especeId: Id<'Espece'>;
  readonly varieteId: Id<'Variete'> | null;
  readonly nom: string;
}

/** Itinéraire technique : modèle de conduite d'une espèce. */
export type Itineraire = IdentiteItineraire & ParametresItineraire;

// ---------------------------------------------------------------------------------------------
// 3. Planification
// ---------------------------------------------------------------------------------------------

export interface Saison extends LigneDeFerme<'Saison'> {
  /** « 2027 ». */
  readonly nom: string;
  readonly debut: DateCalendaire;
  readonly fin: DateCalendaire;
}

export type TypeAncreSerie = 'semis' | 'plantation' | 'debut_recolte';

/** Date fixée par le maraîcher ; les autres dates de la série s'en déduisent (T02). */
export type AncreSerie =
  | { readonly type: 'semis'; readonly date: DateCalendaire }
  | { readonly type: 'plantation'; readonly date: DateCalendaire }
  | { readonly type: 'debut_recolte'; readonly date: DateCalendaire };

/**
 * Dates prévues calculées par le moteur (T02). Une étape sans objet est absente, pas `null` :
 * `semisPepiniere` n'existe qu'en plant maison. Le `null` n'apparaît qu'au bord du stockage (T08).
 */
export interface DatesPrevuesSerie {
  readonly semisPepiniere?: DateCalendaire;
  readonly miseEnPlace: DateCalendaire;
  readonly debutRecolte: DateCalendaire;
  readonly finRecolte: DateCalendaire;
}

/** Taille d'une série : longueur d'emplacement ou nombre de plants. */
export type TailleSerie =
  | { readonly unite: 'longueur'; readonly longueurM: Metres }
  | { readonly unite: 'plants'; readonly nombrePlants: number };

export type StatutSerie = 'prevue' | 'en_cours' | 'terminee' | 'abandonnee';

/**
 * Alerte rouge de rotation (T04) acceptée par le maraîcher (T12, T10e) : la famille en cause, le
 * délai de retour qui n'est pas respecté, et l'instant de la décision. En base : jsonb
 * `serie.rotation_acceptee`, `{ famille, delai_ans, le }` (le : instant ISO).
 */
export interface RotationAcceptee {
  readonly familleId: Id<'Famille'>;
  readonly delaiAns: Annees;
  readonly le: Instant;
}

export interface Serie extends LigneDeFerme<'Serie'> {
  /** Saison de la mise en place. */
  readonly saisonId: Id<'Saison'>;
  readonly especeId: Id<'Espece'>;
  readonly varieteId: Id<'Variete'> | null;
  readonly itineraireId: Id<'Itineraire'>;
  /** Paramètres figés à la création : modifier l'itinéraire ne réécrit jamais une série passée. */
  readonly parametres: ParametresItineraire;
  readonly ancre: AncreSerie;
  readonly datesPrevues: DatesPrevuesSerie;
  readonly taille: TailleSerie;
  readonly statut: StatutSerie;
  /** Alerte rouge de rotation acceptée ; clé absente quand il n'y en a pas (T10e). */
  readonly rotationAcceptee?: RotationAcceptee;
}

/** Culture pluriannuelle (kiwis, asperges, pivoines, fraisiers conservés). */
export interface Plantation extends LigneDeFerme<'Plantation'> {
  readonly especeId: Id<'Espece'>;
  readonly varieteId: Id<'Variete'> | null;
  readonly datePlantation: DateCalendaire;
  readonly nombrePlants: number;
  /** `null` tant que la plantation est en place. */
  readonly dateArrachage: DateCalendaire | null;
}

/** Une année de production d'une plantation. */
export interface Campagne extends LigneDeFerme<'Campagne'> {
  readonly plantationId: Id<'Plantation'>;
  readonly annee: number;
  readonly debutRecoltePrevu: DateCalendaire | null;
  readonly finRecoltePrevue: DateCalendaire | null;
  readonly rendementPrevu: { readonly quantite: number; readonly unite: UniteRecolte } | null;
}

/** Ce qui occupe l'emplacement. */
export type OccupantEmplacement =
  | { readonly sorte: 'serie'; readonly serieId: Id<'Serie'> }
  | { readonly sorte: 'plantation'; readonly plantationId: Id<'Plantation'> }
  /** Couverture longue (bâche, occultation, solarisation) : elle réserve l'emplacement. */
  | { readonly sorte: 'couverture'; readonly evenementId: Id<'Evenement'> };

/** Place prise : mètres sur une planche ou un rang, places dans une gouttière. */
export type PlaceOccupee =
  | { readonly unite: 'longueur'; readonly longueurM: Metres }
  | { readonly unite: 'places'; readonly nombrePlaces: number };

/**
 * Intervalle de dates semi-ouvert [du, au[ : `au` est le jour où l'emplacement se libère, il
 * n'est pas compris dedans. `au` vide tant que la fin n'est pas connue.
 */
export interface IntervalleDates {
  readonly du: DateCalendaire;
  readonly au: DateCalendaire | null;
}

/**
 * Occupation datée d'un emplacement : la ligne de temps des planches. Les dates prévues sont
 * recalculées par le moteur, jamais saisies à la main.
 */
export interface Occupation extends LigneDeFerme<'Occupation'> {
  readonly emplacementId: Id<'Emplacement'>;
  readonly occupant: OccupantEmplacement;
  readonly place: PlaceOccupee;
  /** Début sur la planche, en mètres depuis son origine (facultatif). */
  readonly positionM: Metres | null;
  readonly prevuDu: DateCalendaire;
  readonly prevuAu: DateCalendaire;
  readonly reel: IntervalleDates | null;
}

/** Où l'assolement s'applique : une zone (y compris une chapelle) ou un emplacement. */
export type CibleAssolement =
  | { readonly sorte: 'zone'; readonly zoneId: Id<'Zone'> }
  | { readonly sorte: 'emplacement'; readonly emplacementId: Id<'Emplacement'> };

export type NatureAssolement = 'prevu' | 'passe_saisi' | 'passe_importe';

interface AssolementCommun extends LigneDeFerme<'Assolement'> {
  readonly saisonId: Id<'Saison'>;
  readonly cible: CibleAssolement;
  /** Famille concernée : toujours connue, c'est elle qui porte les délais de retour. */
  readonly familleId: Id<'Famille'>;
  /** Espèce qui précise la famille, quand elle a ses propres délais. */
  readonly especeId: Id<'Espece'> | null;
}

/** Enregistré, jamais effacé. */
export type Assolement =
  | (AssolementCommun & { readonly nature: 'prevu' })
  | (AssolementCommun & { readonly nature: 'passe_saisi' })
  | (AssolementCommun & {
      readonly nature: 'passe_importe';
      /** Nom du fichier ou de l'outil d'origine de l'import. */
      readonly sourceImport: string | null;
    });

// ---------------------------------------------------------------------------------------------
// 5. Journal de terrain
// ---------------------------------------------------------------------------------------------

export type TypeEvenement = 'realise' | 'recolte' | 'intervention' | 'irrigation' | 'traitement' | 'observation';

export type SourceSaisie = 'tap' | 'voix' | 'agent' | 'photo' | 'import';

/** Série ou campagne concernée par un événement. */
export type CultureConcernee =
  | { readonly sorte: 'serie'; readonly serieId: Id<'Serie'> }
  | { readonly sorte: 'campagne'; readonly campagneId: Id<'Campagne'> };

/** Un événement qui en remplace un précédent, sans jamais le modifier. */
export interface RemplacementEvenement {
  readonly sorte: 'correction' | 'annulation';
  readonly evenementId: Id<'Evenement'>;
}

/**
 * Colonnes communes des événements. Les événements sont en ajout seul : un événement ne se
 * modifie ni ne se supprime ; il est corrigé ou annulé par un nouvel événement qui le désigne
 * (`remplaceEvenement`). C'est ce qui rend la synchro hors ligne sans conflit sur le journal.
 * Ils n'ont donc pas de `supprimeLe`.
 */
interface EvenementCommun extends IdentiteDeLigne<'Evenement'> {
  /**
   * Jour où l'action a eu lieu au champ. Par défaut, le jour local de la ferme au moment de la
   * saisie ; il peut être antérieur (récolte saisie le lendemain).
   */
  readonly date: DateCalendaire;
  /** Instant de la saisie. */
  readonly horodatage: Instant;
  readonly auteurId: Id<'Utilisateur'>;
  readonly source: SourceSaisie;
  readonly culture: CultureConcernee | null;
  readonly emplacementIds: readonly Id<'Emplacement'>[];
  readonly note: string | null;
  /** Références des photos, gardées sur le téléphone jusqu'au retour du réseau. */
  readonly photos: readonly string[];
  /** Événement précédent que celui-ci corrige ou annule ; `null` pour une saisie nouvelle. */
  readonly remplaceEvenement: RemplacementEvenement | null;
}

export type EtapeRealisee = 'semis_pepiniere' | 'semis_direct' | 'plantation' | 'arrachage';

export interface DetailRealise {
  readonly etape: EtapeRealisee;
  /** Quantité réelle, si elle diffère du prévu. */
  readonly quantiteReelle: number | null;
}

export interface DetailRecolte {
  readonly quantite: number;
  readonly unite: UniteRecolte;
  /** Calibre, catégorie I ou II… sans liste imposée. */
  readonly categorie: string | null;
}

export type CategorieIntervention = 'travail_sol' | 'couverture' | 'fertilisation' | 'amendement' | 'entretien';

/**
 * Types d'intervention proposés au départ ; chaque ferme peut les modifier, d'où un `type`
 * libre dans le détail. Fertilisation et amendement forment un seul groupe dans le modèle :
 * ils sont séparés ici pour le cahier de fertilisation.
 */
export const TYPES_INTERVENTION_PAR_DEFAUT = {
  travail_sol: [
    'labour',
    'décompactage',
    'grelinette',
    'rotobêche',
    'herse',
    'buttage',
    'préparation de planche',
    'faux semis',
  ],
  couverture: ['paillage', 'bâchage ou occultation', 'solarisation'],
  fertilisation: ['engrais'],
  amendement: ['compost', 'fumier'],
  entretien: ['désherbage', 'taille', 'palissage', 'effeuillage', 'éclaircissage', 'autre'],
} as const satisfies Readonly<Record<CategorieIntervention, readonly string[]>>;

/**
 * Type d'intervention (T23, modèle de données section 5) : la liste de choix d'une catégorie.
 * Les lignes à `fermeId` nul (en base) forment la liste de départ, en lecture seule ; une ferme
 * y ajoute les siens. Les travaux prévus et les interventions recopient son `libelle` (texte
 * libre de `TravailPrevu.type` et `DetailIntervention.type`) : un type déjà utilisé ne se
 * supprime pas, il se masque (il disparaît des listes de choix, les travaux qui l'utilisent restent).
 */
export interface TypeIntervention extends LigneDeFerme<'TypeIntervention'> {
  readonly categorie: CategorieIntervention;
  readonly libelle: string;
  readonly masque: boolean;
}

interface InterventionCommune {
  /** Libellé du type ('grelinette', 'compost'…), modifiable par la ferme. */
  readonly type: string;
  readonly outil: string | null;
}

export type DetailIntervention =
  | (InterventionCommune & { readonly categorie: 'travail_sol' })
  | (InterventionCommune & {
      readonly categorie: 'couverture';
      /** Durée d'occupation d'une bâche : une couverture longue crée une occupation. */
      readonly dureeOccupationJours: Jours | null;
    })
  | (InterventionCommune & {
      readonly categorie: 'fertilisation';
      readonly produit: string;
      readonly quantite: Quantite;
    })
  | (InterventionCommune & {
      readonly categorie: 'amendement';
      readonly produit: string;
      readonly quantite: Quantite;
    })
  | (InterventionCommune & { readonly categorie: 'entretien' });

export interface DetailIrrigation {
  readonly secteurIrrigationId: Id<'SecteurIrrigation'>;
  readonly dureeMinutes: Minutes;
}

export interface DetailTraitement {
  readonly produitPhytoId: Id<'ProduitPhyto'>;
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: MetresCarres;
  /** Ravageur ou maladie visé. */
  readonly cible: string;
  readonly operateur: string;
  /** Calculée avec le délai avant récolte du produit. */
  readonly recolteAutoriseeLe: DateCalendaire;
}

export type NatureObservation = 'ravageur' | 'maladie' | 'stade' | 'autre';

export interface DetailObservation {
  readonly nature: NatureObservation;
  readonly gravite: 'faible' | 'moyenne' | 'forte' | null;
}

/** Toute saisie au champ ; le `type` choisit le détail. */
export type Evenement =
  | (EvenementCommun & { readonly type: 'realise'; readonly detail: DetailRealise })
  | (EvenementCommun & { readonly type: 'recolte'; readonly detail: DetailRecolte })
  | (EvenementCommun & { readonly type: 'intervention'; readonly detail: DetailIntervention })
  | (EvenementCommun & { readonly type: 'irrigation'; readonly detail: DetailIrrigation })
  | (EvenementCommun & { readonly type: 'traitement'; readonly detail: DetailTraitement })
  | (EvenementCommun & { readonly type: 'observation'; readonly detail: DetailObservation });

// ---------------------------------------------------------------------------------------------
// 6. Stocks et registre phyto
// ---------------------------------------------------------------------------------------------

/** Ce qui se compte en chambre froide ou au magasin. */
export interface ArticleStock extends LigneDeFerme<'ArticleStock'> {
  readonly especeId: Id<'Espece'>;
  readonly varieteId: Id<'Variete'> | null;
  readonly unite: UniteRecolte;
  readonly categorie: string | null;
}

export type MotifMouvementStock = 'recolte' | 'vente' | 'perte' | 'ajustement';

interface MouvementStockCommun extends LigneDeFerme<'MouvementStock'> {
  readonly articleStockId: Id<'ArticleStock'>;
  readonly date: DateCalendaire;
  /** Positive en entrée, négative en sortie. Le stock est la somme des mouvements. */
  readonly quantite: number;
}

export type MouvementStock =
  | (MouvementStockCommun & {
      readonly motif: 'recolte';
      /** Événement de récolte validé qui a créé l'entrée en stock. */
      readonly recolteId: Id<'Evenement'>;
    })
  | (MouvementStockCommun & { readonly motif: 'vente' | 'perte' | 'ajustement' });

export interface ProduitPhyto extends LigneDeFerme<'ProduitPhyto'> {
  readonly nomCommercial: string;
  readonly numeroAmm: string;
  readonly substanceActive: string;
  readonly delaiAvantRecolteJours: Jours;
  readonly utilisableEnBio: boolean;
  readonly doseMaximale: Quantite | null;
}

// ---------------------------------------------------------------------------------------------
// 7. Validation et historique
// ---------------------------------------------------------------------------------------------

export type OperationLigne = 'creation' | 'modification' | 'suppression';

/** Valeurs d'une ligne, telles qu'exportées (clés en camelCase). */
export type ValeursLigne = Readonly<Record<string, unknown>>;

/**
 * Tables des données de la ferme, que l'on peut créer, modifier ou supprimer. Le journal de
 * validation (propositions, modifications) et les comptes n'en font pas partie.
 */
export type TableDeFerme = Exclude<NomEntite, 'Modification' | 'Proposition' | 'Utilisateur'>;

/** Ligne visée : la table et l'Id de la même entité, liés par le typage. */
export type ReferenceLigne<T extends NomEntite = TableDeFerme> = {
  readonly [N in T]: { readonly table: N; readonly ligneId: Id<N> };
}[T];

/** Un changement proposé, pas encore appliqué. */
export type ChangementPropose = ReferenceLigne & {
  readonly operation: OperationLigne;
  /** Valeurs à écrire ; `null` pour une suppression. */
  readonly valeurs: ValeursLigne | null;
};

export type StatutProposition = 'en_attente' | 'validee' | 'rejetee';

interface PropositionCommune extends LigneDeFerme<'Proposition'> {
  readonly source: 'voix' | 'agent' | 'photo';
  readonly auteurId: Id<'Utilisateur'>;
  readonly creeLe: Instant;
  readonly changements: readonly ChangementPropose[];
}

/**
 * Tout ce qui vient de la voix, de l'agent ou d'une photo : rien n'est écrit avant le tap de
 * validation. `decideLe` n'existe qu'une fois la proposition validée ou rejetée.
 */
export type Proposition =
  | (PropositionCommune & { readonly statut: 'en_attente'; readonly decideLe: null })
  | (PropositionCommune & {
      readonly statut: 'validee';
      /** Instant de la validation. */
      readonly decideLe: Instant;
    })
  | (PropositionCommune & {
      readonly statut: 'rejetee';
      /** Instant du rejet. */
      readonly decideLe: Instant;
    });

/**
 * Journal des modifications : qui, quand, avant, après, et la proposition d'origine.
 * Il couvre les tables de la ferme et les propositions (validation, rejet).
 */
export type Modification = LigneDeFerme<'Modification'> &
  ReferenceLigne<TableDeFerme | 'Proposition'> & {
    readonly auteurId: Id<'Utilisateur'>;
    readonly horodatage: Instant;
    readonly operation: OperationLigne;
    readonly avant: ValeursLigne | null;
    readonly apres: ValeursLigne | null;
    readonly propositionId: Id<'Proposition'> | null;
  };
