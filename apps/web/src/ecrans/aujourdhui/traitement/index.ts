/**
 * Saisie d'un traitement phyto (T52), depuis Aujourd'hui. À charger par import dynamique
 * seulement (EcranAujourdhui) : hors du JavaScript de démarrage et du morceau d'Aujourd'hui.
 * L'annulation sert aussi au registre de la ferme (../../ferme/phyto/).
 */
export { SaisieTraitement, SaisieTraitement as default, type ProprietesSaisieTraitement } from './SaisieTraitement.tsx';
export { annulerTraitement, TraitementPlusEnVigueur } from './donnees.ts';
