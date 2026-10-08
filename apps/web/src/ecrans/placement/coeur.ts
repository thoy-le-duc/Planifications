/**
 * Ce que l'éditeur de placement (T28b) prend du cœur, par sous-chemins du paquet : le point
 * d'entrée racine de @planif/core tire tout le cœur (dates, planification…) dans le morceau de
 * l'éditeur, alors que le repère local et les règles du placement n'en ont pas besoin (même
 * raison que "./import-xlsx"). Les types, eux, ne coûtent rien.
 */
export { depuisRepereZone, RAYON_TERRESTRE_M, repereZone, TYPES_BATIMENT, validerContour, versGeographique, versLocal, versRepereZone, type RepereZone } from '@planif/core/placement';
export type { TypeBatiment } from '@planif/core';
