/**
 * Écrans de fertilisation de la ferme (T54) : produits fertilisants et cahier de fertilisation
 * (avec la fiche « Fertilisation » de chaque planche). À charger par import dynamique seulement,
 * depuis l'écran Ferme : hors du JavaScript de démarrage et du morceau Ferme. N'importe ni
 * PowerSync ni src/donnees : les écrans reçoivent la porte. Contrat : ./test/contrat.ts.
 */
export { EcranProduitsFertilisants } from './EcranProduitsFertilisants.tsx';
export { EcranCahierFertilisation } from './EcranCahierFertilisation.tsx';
// T56 : recettes de fertirrigation (même morceau, chargé à la demande).
export { EcranRecettesFertirrigation } from './EcranRecettesFertirrigation.tsx';
