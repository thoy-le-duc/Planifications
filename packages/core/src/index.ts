/** Version du modèle de données validé (docs/modele-donnees.md). */
export const VERSION_MODELE_DONNEES = 1;

export * from './dates/index.ts';
export * from './domaine/index.ts';
export * from './saisies/index.ts';
export * from './saisies/stock.ts';
export * from './saisies/serie.ts';
export * from './saisies/itineraire.ts';
// Formats communs du serveur et de la porte (T28s) : identifiant, instant de suppression.
export { identifiantNormalise, instantNormalise } from './saisies/formats.ts';
export * from './export/index.ts';
export * from './import/index.ts';
// Placement réel (T28a) : repère local, repère des zones, règles d'un placement.
export * from './placement/index.ts';

// Planification (T03), exposée pour la vue 2D (T11) : conflits de place et période effective
// d'une occupation. Les écrans montrent ce que ce moteur trouve, sans réécrire de règle.
export { detecterConflits, type Conflit, type SorteConflit } from './planification/conflits.ts';
export { DATE_SANS_FIN, periodeOccupation, type PeriodeOccupation } from './planification/occupations.ts';

// Semainier (T06), exposé pour l'écran Aujourd'hui (T13) : les tâches de la semaine viennent de
// ce moteur, jamais d'une règle réécrite dans l'écran. `appliquerRealises` recale le début de
// récolte d'une série par ses réalisés (récoltes en cours).
export {
  semainier,
  type CampagneSemainier,
  type EmplacementConcerne,
  type EtapeTache,
  type InterventionRealisee,
  type RealisesSemainier,
  type SerieSemainier,
  type TacheEtape,
  type TacheSemainier,
  type TacheTravail,
  type TravailDeTache,
} from './planification/semainier.ts';

// Travaux prévus des itinéraires (T22) : dates, temps estimé, charge de la semaine, instantané
// d'une série (planification/travaux.ts) et leurs règles d'écriture (saisies/travaux.ts), pour
// le serveur (T23), l'écran des itinéraires (T24) et l'écran Aujourd'hui.
export { chargeSemaine, datesTravailPrevu, instantaneItineraire, tempsEstimeMinutes } from './planification/travaux.ts';
export {
  CATEGORIES_AVEC_PRODUIT,
  PLAFONDS_TRAVAUX,
  REPERES_TRAVAIL,
  validerTravailPrevu,
  validerTravauxPrevus,
  type OptionsTravaux,
  type ResultatTravaux,
} from './saisies/travaux.ts';
export {
  appliquerRealises,
  calculerDatesSerie,
  type DatesSerie,
  type EtapeSerie,
  type ParametresDatesSerie,
  type RealisesSerie,
} from './planification/dates-serie.ts';

// Plan de culture (T12) : dates (T02), besoins en semences et en plants (T05) et alertes de
// rotation (T04) viennent du moteur, jamais d'une règle réécrite dans l'écran. Les règles d'une
// série écrite par le téléphone (validerSerie, validerOccupation) sont celles que le serveur
// rejoue (T10e, saisies/serie.ts).
export {
  besoinsSerie,
  type BesoinsSerie,
  type ItineraireBesoins,
} from './planification/besoins.ts';
export {
  alertesRotation,
  type AlerteRotation,
  type CulturePrevue,
  type HierarchieParcellaire,
  type HistoriqueRotation,
  type LigneEnCause,
  type NiveauAlerteRotation,
  type OccupationHistorique,
  type SourceLigneRotation,
} from './planification/rotation.ts';
