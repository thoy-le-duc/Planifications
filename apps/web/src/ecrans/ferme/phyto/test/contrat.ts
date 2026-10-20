/**
 * Contrat de T52 côté écrans de la ferme — produits phyto et registre (docs/backlog/T52-registre-phyto.md,
 * règles 1 et 6). Les tests importent le module par un chemin tenu dans une variable : leur
 * typage ne dépend que de ce contrat.
 *
 * ## Module attendu
 *
 * `../index.ts` : `EcranProduitsPhyto` et `EcranRegistrePhyto`, chargés À LA DEMANDE depuis
 * l'onglet Ferme (carte « Traitements phyto », lignes « Produits phyto » et « Registre phyto ») :
 * ni dans le JavaScript de démarrage, ni dans les imports statiques de l'écran Ferme. Reçoivent
 * la porte (jamais PowerSync). Tout marche hors ligne.
 *
 * ## Produits phyto (dialogue « Produits phyto »)
 *
 * - Lignes [data-testid="produit-phyto"][data-produit=<id>] : les produits NON archivés de la
 *   ferme (nom, AMM, DAR, « bio »), avec un bouton « Modifier <nom commercial> ». Les produits
 *   archivés sont à part (« Archivés »), avec « Rétablir <nom commercial> ».
 * - « Nouveau produit » : dialogue « Nouveau produit », champs « Nom commercial », « N° AMM »,
 *   « Substance active », « Délai avant récolte (jours) », case « Utilisable en bio », « Dose
 *   maximale » (facultative, virgule acceptée), « Unité de la dose » ; « Enregistrer »,
 *   « Fermer ». Un refus (règles de validerProduitPhyto) s'affiche en role="alert" dans le
 *   dialogue, rien n'est écrit.
 * - « Modifier <nom> » : dialogue « Modifier le produit », mêmes champs préremplis,
 *   « Enregistrer » et « Archiver le produit ».
 * - Chaque enregistrement est UNE transaction locale ; la ligne écrite est acceptée par
 *   validerProduitPhyto (règle du serveur). Jamais de DELETE : archiver pose supprime_le.
 *
 * ## Registre phyto (dialogue « Registre phyto »)
 *
 * - Les traitements EN VIGUEUR de la saison (celle qui contient le jour ; à défaut l'année
 *   civile), du plus récent au plus ancien : lignes [data-testid="ligne-registre"]
 *   [data-evenement=<id>] avec date, produit, AMM, dose, surface, emplacements, culture, cible,
 *   opérateur et « Récolte autorisée le JJ/MM ».
 * - Filtre : radios « Tous », « Bio uniquement », « Non bio » (produit utilisable en bio ou non).
 * - « Annuler ce traitement » (par ligne) : confirmation (role="alertdialog" « Annuler ce
 *   traitement ? », bouton « Annuler le traitement »), puis un événement d'annulation (ajout
 *   seul, accepté par validerSaisie) : la ligne quitte le registre, l'emplacement redevient libre.
 */
import type { ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';

export interface ProprietesEcranPhyto {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** 'AAAA-MM-JJ' ; défaut : jour du téléphone. */
  readonly aujourdhui?: () => string;
  /** Horodatages ; défaut : new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModulePhyto {
  readonly EcranProduitsPhyto: (p: ProprietesEcranPhyto) => ReactElement;
  readonly EcranRegistrePhyto: (p: ProprietesEcranPhyto) => ReactElement;
}
