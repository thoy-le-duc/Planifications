/**
 * Écrans phyto de la ferme (T52) : produits phyto et registre. À charger par import dynamique
 * seulement, depuis l'écran Ferme : hors du JavaScript de démarrage et du morceau Ferme.
 * N'importe ni PowerSync ni src/donnees : les écrans reçoivent la porte. Contrat : ./test/contrat.ts.
 */
export { EcranProduitsPhyto } from './EcranProduitsPhyto.tsx';
export { EcranRegistrePhyto } from './EcranRegistrePhyto.tsx';
