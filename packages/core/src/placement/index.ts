/**
 * Placement réel (T28a, Q30-Q31 ; docs/modele-donnees.md, v1.x) : repère local de la ferme,
 * repère des zones, emprise des bâtiments, et règles d'un placement (rejouées par le serveur,
 * T28s). Pur : ni base, ni réseau, ni horloge.
 *
 * Les types `PointLocal`, `Degres`, `TypeBatiment` viennent du domaine (domaine/entites.ts).
 */
export {
  RAYON_TERRESTRE_M,
  coinsEmprise,
  depuisRepereZone,
  repereZone,
  versGeographique,
  versLocal,
  versRepereZone,
  type Coins,
  type RepereZone,
} from './repere.ts';
export {
  AIRE_MIN_M2,
  CONTOUR_SOMMETS_MAX,
  CONTOUR_SOMMETS_MIN,
  DISTANCE_MAX_ORIGINE_M,
  PLAFONDS_BATIMENT,
  TYPES_BATIMENT,
  validerContour,
  validerPlacement,
  type CodeErreurPlacement,
  type EntreePlacementBatiment,
  type EntreePlacementEmplacement,
  type EntreePlacementZone,
  type ErreurPlacement,
  type PlacementBatiment,
  type PlacementEmplacement,
  type PlacementZone,
  type ResultatPlacement,
} from './validation.ts';
// T61 : chemins, points du plan (point d'eau, repère) et rangement des outils.
export {
  CHEMIN_POINTS_MAX,
  CHEMIN_POINTS_MIN,
  NOM_CHEMIN_MAX,
  NOM_OUTIL_MAX,
  NOM_PLACE_RANGEMENT_MAX,
  NOM_POINT_PLAN_MAX,
  PLAFOND_LARGEUR_CHEMIN_M,
  SORTES_POINT_PLAN,
  libelleRangement,
  nomComparable,
  nomDeChemin,
  trouverOutil,
  validerChemin,
  validerOutil,
  validerPlaceRangement,
  validerPointPlan,
  type CheminValide,
  type OutilValide,
  type PlaceRangementValide,
  type PointPlanValide,
  type SortePointPlan,
} from './chemins.ts';
