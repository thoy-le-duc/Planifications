/**
 * Contrat de T54 côté écrans — produits fertilisants, cahier de fertilisation, fiche
 * « Fertilisation » d'une planche, saisie d'un apport (docs/backlog/T54-cahier-fertilisation.md).
 * Les tests importent les modules par un chemin tenu dans une variable : leur typage ne dépend que
 * de ce contrat.
 *
 * ## Modules attendus
 *
 * - `../index.ts` (src/ecrans/ferme/fertilisation/) : `EcranProduitsFertilisants` et
 *   `EcranCahierFertilisation`, chargés À LA DEMANDE depuis l'onglet Ferme (carte « Fertilisation »,
 *   lignes « Produits fertilisants » et « Cahier de fertilisation ») : ni dans le JavaScript de
 *   démarrage, ni dans les imports statiques de l'écran Ferme.
 * - `src/ecrans/aujourdhui/fertilisation/index.ts` : `SaisieFertilisation`, chargée au tap du
 *   bouton « Fertilisation » d'Aujourd'hui (morceau à part, comme la saisie d'un traitement).
 * Tous reçoivent la porte (jamais PowerSync) et marchent hors ligne.
 *
 * ## Produits fertilisants (dialogue « Produits fertilisants »)
 *
 * - Lignes [data-testid="produit-fertilisant"][data-produit=<id>] : produits NON archivés de la
 *   ferme (nom, teneurs « N 1 % · P₂O₅ – · K₂O – », unité), avec « Modifier <nom> ». Les archivés
 *   à part, avec « Rétablir <nom> ».
 * - Ferme sans aucun produit (même archivé) : bouton « Ajouter la liste de départ » : TOUS les
 *   produits de FERTILISANTS_DEPART écrits dans la ferme en UNE transaction, chacun accepté par
 *   validerProduitFertilisant. Le bouton disparaît ensuite.
 * - « Nouveau produit » : dialogue « Nouveau produit », champs « Nom », liste « Forme » (solide,
 *   liquide), liste « Unité » (kg, t, L, m3), « Azote N (%) », « Phosphore P₂O₅ (%) »,
 *   « Potasse K₂O (%) » (facultatifs, virgule acceptée), cases « Azote d’origine organique » et
 *   « Utilisable en bio », « Source » ; « Enregistrer ». Refus (règles du cœur) en role="alert",
 *   rien d'écrit.
 * - « Modifier <nom> » : dialogue « Modifier le produit », mêmes champs préremplis, « Enregistrer »
 *   et « Archiver le produit ». Une transaction par enregistrement ; jamais de DELETE.
 *
 * ## Cahier de fertilisation (dialogue « Cahier de fertilisation »)
 *
 * - Case « Zone vulnérable nitrates » : reflète `ferme.zone_vulnerable_nitrates` (0 par défaut) ;
 *   la toucher écrit la colonne (0/1) en UNE transaction.
 * - Période : la saison qui contient le jour, à défaut l'année civile (comme le registre phyto).
 * - Lignes [data-testid="bilan-planche"][data-emplacement=<id>] : une par planche qui a un apport
 *   réalisé dans la période (et, zone vulnérable cochée, un apport prévu), avec son code et ses
 *   unités en kg/ha (« 2 000 » pour 2 000 kg N/ha, espace fine ou insécable permise).
 *   Bouton « Fertilisation <code> » : ouvre la fiche de la planche.
 * - Zone vulnérable COCHÉE seulement : alertes [data-testid="alerte-azote"] (azote organique de
 *   l'année au-delà de 170 kg N/ha, réalisé, ou réalisé + prévu), non bloquantes, et, dans la
 *   fiche, la section [data-testid="plan-previsionnel"] (apports prévus). Décochée : ni l'un ni
 *   l'autre n'existe dans le DOM.
 *
 * ## Fiche « Fertilisation <code> » (dialogue)
 *
 * - Apports réalisés de la planche [data-testid="apport"] : date, produit, quantité, kg N/ha.
 *   « sans teneur » pour un apport compté sans unités.
 * - Totaux de la période (N, P₂O₅, K₂O kg/ha).
 *
 * ## Saisie d'un apport (dialogue « Fertilisation », depuis Aujourd'hui)
 *
 * - Planches actives de la ferme en boutons à cocher (aria-pressed), par leur code.
 * - Produits non archivés de la ferme en boutons (aria-pressed), par leur nom ; « Autre produit »
 *   (champ) pour un texte libre (sans bilan).
 * - « Quantité » (virgule acceptée), « Unité » (préremplie par celle du produit), radios
 *   « Fertilisation » / « Amendement ».
 * - « Enregistrer » : UNE transaction, un événement intervention accepté par validerSaisie, à la
 *   date du jour, sur les planches choisies, `detail.produitFertilisantId` = le produit choisi
 *   (null pour un texte libre). Rien n'est écrit sans planche, sans produit ou sans quantité
 *   (message en role="alert").
 */
import type { ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';

export interface ProprietesEcranFertilisation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** 'AAAA-MM-JJ' ; défaut : jour du téléphone. */
  readonly aujourdhui?: () => string;
  /** Horodatages ; défaut : new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModuleFertilisationFerme {
  readonly EcranProduitsFertilisants: (p: ProprietesEcranFertilisation) => ReactElement;
  readonly EcranCahierFertilisation: (p: ProprietesEcranFertilisation) => ReactElement;
}

export interface ProprietesSaisieFertilisation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly aujourdhui: string;
  readonly surFermer: () => void;
  readonly surEcrit?: () => void;
}

export interface ModuleSaisieFertilisation {
  readonly SaisieFertilisation: (p: ProprietesSaisieFertilisation) => ReactElement;
}
