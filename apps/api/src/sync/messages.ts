/**
 * Textes des refus de synchro (T10j) : ce que le téléphone affiche tel quel
 * (apps/web/src/ecrans/ferme/Refus.tsx), et le détail technique qui reste au journal du serveur.
 * Contrat : messages-refus.test.ts et messages-refus.integration.test.ts.
 *
 * - Un message par motif, stable ; celui de 'ecriture_invalide' est suivi de « : <précision>. ».
 * - Phrases simples en français, du point de vue du maraîcher : ni nom de table ou de colonne,
 *   ni code, ni seuil technique. Ce détail-là va au journal (`detail` d'un refus).
 * - Les erreurs du cœur (@planif/core) ne sont pas relayées telles quelles : elles sont traduites
 *   d'après leur code (et leur champ), leur code et leur champ vont au journal. Le message du cœur
 *   n'y va pas : il peut citer une valeur saisie (date, quantité, libellé).
 */
import type { CodeErreurCroissance, CodeErreurPlacement, CodeErreurSaisie, ErreurCroissance, ErreurPlacement, ErreurSaisie } from '@planif/core';
import type { MotifRefus, Refus } from './motifs.ts';

/** Explication affichée telle quelle sur le téléphone, par motif. */
export const MESSAGES: Readonly<Record<MotifRefus, string>> = {
  ferme_interdite: "Saisie non enregistrée : elle vise une ferme dont vous n'êtes pas (ou plus) membre.",
  auteur_invalide: "Saisie non enregistrée : elle porte le nom d'une autre personne que vous.",
  ajout_seul:
    'Un événement enregistré ne se modifie pas et ne se supprime pas : saisissez plutôt une correction ou une annulation.',
  table_interdite: 'Modification refusée : cette donnée ne se modifie pas depuis le téléphone.',
  ecriture_invalide: 'Saisie non enregistrée, données invalides',
  lot_trop_gros: 'Saisie non enregistrée : envoi trop volumineux. Ressaisissez-la.',
  recolte_annulee: 'Cette récolte a été annulée : elle ne se corrige plus. Pour la rétablir, saisissez une nouvelle récolte.',
};

/** Précision d'un refus 'ecriture_invalide' qui n'en a pas (ce que le serveur ne sait pas lire). */
const PRECISION_INCOMPRISE = "ce n'est pas une saisie que l'appli sait enregistrer";

/** Précisions communes aux séries et aux itinéraires (serie.ts, itineraire.ts). */
export const PRECISION_EXISTE_DEJA = "cette saisie existe déjà avec d'autres valeurs";
export const PRECISION_INTROUVABLE = 'la saisie à modifier est introuvable';
export const PRECISION_CREEE_SUPPRIMEE = 'une saisie ne se crée pas déjà supprimée';
export const PRECISION_CHANGE_DE_FERME = 'une saisie ne change pas de ferme';

/** T28s (Q31) : placer les éléments de la ferme (bâtiments, contours, planches, origine) est réservé au gérant. */
export const PRECISION_SEUL_LE_GERANT = 'seul le gérant peut placer les éléments de la ferme';
/** T32c (Q35) : régler le profil de croissance d'une espèce (le modifier, le créer, le remettre à nul) est réservé au gérant. */
export const PRECISION_SEUL_LE_GERANT_PROFIL = 'seul le gérant peut régler le profil de croissance';
/** T28s : l'origine du plan ne bouge plus dès qu'un élément est placé (Q31). */
export const PRECISION_ORIGINE_FIGEE =
  'le point de départ du plan ne se déplace ni ne s’efface tant que des éléments sont placés : retirez-les d’abord du plan';
/** T28s (décision du chef) : aucun placement tant que l'origine du plan n'est pas posée. */
export const PRECISION_SANS_ORIGINE = 'posez d’abord le point de départ du plan de la ferme, avant d’y placer des éléments';
export const PRECISION_ORIGINE_INVALIDE = 'le point de départ du plan doit avoir une latitude et une longitude valables';
export const PRECISION_FERME_SEULE_ORIGINE = 'de la ferme, seul le point de départ du plan se modifie ici';
export const PRECISION_ZONE_A_UN_CONTOUR = 'cette zone a ses propres contours : effacez-les avant de l’abriter sous un bâtiment';
export const PRECISION_ZONE_DEJA_ABRITEE = 'cette zone est déjà abritée par un autre bâtiment';
export const PRECISION_ZONE_ABRITEE_SUPPRIMEE = 'cette zone est abritée par un bâtiment : supprimez le bâtiment ou détachez-le de la zone d’abord';

/** T35a : disposition des rangs inconnue dans la densité d'un itinéraire ou d'une série. */
export const PRECISION_DISPOSITION_RANGS = 'la disposition des rangs se choisit entre alignés et en quinconce';

/** Message enregistré dans refus_synchro : seul 'ecriture_invalide' porte une précision. */
export function messageRefus(refus: Refus): string {
  if (refus.motif !== 'ecriture_invalide') return MESSAGES[refus.motif];
  return `${MESSAGES.ecriture_invalide} : ${refus.precision ?? PRECISION_INCOMPRISE}.`;
}

/** Précision affichée pour une erreur du cœur, par code. */
const PRECISIONS_DU_COEUR: Readonly<Record<CodeErreurSaisie, string>> = {
  entree_invalide: PRECISION_INCOMPRISE,
  colonne_inconnue: "la saisie contient une information que l'appli ne connaît pas",
  cle_inconnue: "la saisie contient une information que l'appli ne connaît pas",
  champ_manquant: 'une information obligatoire manque',
  champ_invalide: "une information n'a pas la bonne forme",
  hors_bornes: 'une valeur sort des limites possibles',
  trop_long: 'un texte est trop long',
  trop_nombreux: 'la saisie contient trop d’éléments',
  doublon: 'un élément y figure deux fois',
  incoherent: 'des informations se contredisent',
  json_illisible: 'une information est illisible',
  trop_volumineux: 'la saisie est trop volumineuse',
  plafond_depasse: 'une valeur dépasse le maximum permis',
};

/**
 * Nom en français d'un champ du cœur (colonne reçue ou clé du détail), pour dire où est le
 * problème. Un champ absent d'ici n'est pas nommé.
 */
const LIBELLES_DES_CHAMPS: Readonly<Record<string, string>> = {
  ferme_id: 'ferme',
  type: 'type',
  date: 'date',
  horodatage: 'heure de la saisie',
  auteur_id: 'auteur',
  source: 'origine de la saisie',
  serie_id: 'série',
  campagne_id: 'campagne',
  emplacement_ids: 'emplacements',
  emplacement_id: 'emplacement',
  note: 'note',
  photos: 'photos',
  remplace_sorte: 'correction ou annulation',
  remplace_evenement_id: 'correction ou annulation',
  detail: 'détail de la saisie',
  espece_id: 'espèce',
  variete_id: 'variété',
  unite: 'unité',
  categorie: 'catégorie',
  supprime_le: 'suppression',
  article_stock_id: 'article du stock',
  quantite: 'quantité',
  motif: 'sorte de mouvement de stock',
  recolte_id: 'récolte liée',
  saison_id: 'saison',
  itineraire_id: 'itinéraire',
  parametres: 'paramètres de culture',
  mode: 'mode de culture',
  ancre_type: 'date de référence',
  ancre_date: 'date de référence',
  prevu_semis_pepiniere: 'dates prévues',
  prevu_mise_en_place: 'dates prévues',
  prevu_debut_recolte: 'dates prévues',
  prevu_fin_recolte: 'dates prévues',
  prevu_du: 'dates prévues',
  prevu_au: 'dates prévues',
  reel_du: 'dates réelles',
  reel_au: 'dates réelles',
  longueur_m: 'longueur',
  nombre_plants: 'nombre de plants',
  nombre_places: 'nombre de places',
  position_m: 'position',
  statut: 'statut',
  rotation_acceptee: 'décision de rotation',
  plantation_id: 'plantation',
  evenement_id: 'couverture',
  nom: 'nom',
  libelle: 'nom du type',
  masque: 'affichage',
  dose: 'dose',
  produit: 'produit',
  delai_ans: 'délai de retour',
  travauxPrevus: 'travaux prévus',
  tempsEstime: 'temps estimé',
  repetition: 'répétition',
  occurrenceVisee: 'occurrence visée',
  // T10s : parcellaire et catalogue de la ferme (structure-lignes.ts).
  zone_parente_id: 'zone parente',
  zone_id: 'zone',
  type_abri: "type d'abri",
  surface_m2: 'surface',
  code: 'code',
  sorte: 'sorte',
  largeur_m: 'largeur',
  actif_du: "période d'activité",
  actif_au: "période d'activité",
  remplace: 'emplacements remplacés',
  famille_id: 'famille',
  perenne: 'pérenne',
  unite_recolte: 'unité de récolte',
  delai_retour_minimal_ans: 'délais de retour',
  delai_retour_conseille_ans: 'délais de retour',
  fournisseur: 'fournisseur',
  poids_mille_graines_g: 'poids de mille graines',
  taux_germination: 'taux de germination',
  debut: 'dates de la saison',
  fin: 'dates de la saison',
  nature: "nature de l'assolement",
  source_import: "origine de l'import",
  // T28s : placement réel (structure-lignes.ts).
  contour: 'contours de la zone',
  placement_x_m: 'position',
  placement_y_m: 'position',
  orientation_deg: 'orientation',
  hauteur_m: 'hauteur',
  centre_x_m: 'position',
  centre_y_m: 'position',
  origine_plan: 'point de départ du plan',
  // T32a : profil de croissance d'une espèce (structure-lignes.ts).
  profil_croissance: 'profil de croissance',
};

/** Libellé du champ (le plus précis connu, du dernier segment au premier), ou null. */
function libelleDuChamp(champ: string | null): string | null {
  if (champ === null) return null;
  const segments = champ.split('.').map((s) => s.replace(/\[\d+\]$/u, ''));
  for (const s of segments.reverse()) {
    if (Object.hasOwn(LIBELLES_DES_CHAMPS, s)) return LIBELLES_DES_CHAMPS[s] ?? null;
  }
  return null;
}

/** Précision affichée pour une erreur du cœur : d'après son code, et son champ s'il se nomme. */
export function precisionDuCoeur(erreur: ErreurSaisie): string {
  const texte = PRECISIONS_DU_COEUR[erreur.code];
  // Le champ d'une colonne ou d'une clé inconnue est le nom reçu : jamais affiché.
  if (erreur.code === 'colonne_inconnue' || erreur.code === 'cle_inconnue') return texte;
  if (erreur.champ === 'parametres.densite.disposition') return PRECISION_DISPOSITION_RANGS;
  const libelle = libelleDuChamp(erreur.champ);
  return libelle === null ? texte : `${texte} (${libelle})`;
}

/** Détail pour le journal : code et champ de l'erreur du cœur (pas son message, qui peut citer une valeur saisie). */
export function detailDuCoeur(erreur: ErreurSaisie): string {
  return `cœur ${erreur.code} champ ${erreur.champ ?? '-'}`;
}

/** Refus 'ecriture_invalide' d'une erreur du cœur : précision traduite, détail au journal. */
export function refusDuCoeur(erreur: ErreurSaisie, fermeId: string | null): Refus {
  return { motif: 'ecriture_invalide', precision: precisionDuCoeur(erreur), detail: detailDuCoeur(erreur), fermeId };
}

/** Ce qui manque à un placement incomplet (champ d'une erreur du placement), en français. */
const MANQUE_AU_PLACEMENT: Readonly<Record<string, string>> = {
  placement_x_m: 'la position est-ouest',
  placement_y_m: 'la position nord-sud',
  orientation_deg: 'l’orientation',
  longueur_m: 'la longueur',
  largeur_m: 'la largeur',
  hauteur_m: 'la hauteur',
  centre_x_m: 'la position est-ouest du centre',
  centre_y_m: 'la position nord-sud du centre',
};

/** Dimensions d'un bâtiment (champ d'une erreur du placement), en français. */
const DIMENSIONS: Readonly<Record<string, string>> = { longueur_m: 'la longueur', largeur_m: 'la largeur', hauteur_m: 'la hauteur' };

/**
 * T28s : précision affichée pour une règle du placement réel (validerPlacement, validerContour du
 * cœur), d'après son code et son champ. Comme pour les autres erreurs du cœur, son message n'est
 * pas relayé : il est réécrit ici sans nom de colonne ni seuil technique.
 */
export function precisionDuPlacement(erreur: ErreurPlacement): string {
  const champ = erreur.champ ?? '';
  const precisions: Readonly<Record<CodeErreurPlacement, string>> = {
    entree_invalide: 'les contours de la zone sont illisibles : une liste de sommets est attendue',
    trop_peu_de_sommets: 'les contours d’une zone ont 3 sommets au moins',
    trop_de_sommets: 'les contours d’une zone ont 200 sommets au plus',
    coordonnee_invalide:
      champ === 'contour' ? 'un sommet des contours de la zone n’a pas de coordonnées en mètres' : 'la position doit être un nombre de mètres',
    trop_loin:
      champ === 'contour'
        ? 'un sommet des contours de la zone est à plus de 5 km de l’origine du plan'
        : champ === 'centre_x_m'
          ? 'le bâtiment est à plus de 5 km de l’origine du plan'
          : 'l’emplacement est à plus de 5 km du centre de sa zone',
    sommets_confondus: 'deux sommets qui se suivent sont confondus : ne répétez pas le premier sommet à la fin des contours',
    auto_intersection: 'les contours de la zone se recoupent : deux côtés se croisent ou se touchent',
    aire_nulle: 'la surface de la zone est nulle ou trop petite',
    incomplet: `placement incomplet : il manque ${MANQUE_AU_PLACEMENT[champ] ?? 'une information'}`,
    orientation_invalide: 'l’orientation doit être comprise entre 0 et 360 degrés, 360 exclu',
    dimension_invalide: `${DIMENSIONS[champ] ?? 'chaque dimension'} du bâtiment doit être un nombre de mètres plus grand que zéro`,
    plafond_depasse: `${DIMENSIONS[champ] ?? 'une dimension'} du bâtiment dépasse le maximum permis`,
    zone_abritee_avec_contour: 'cette zone est abritée par un bâtiment : elle prend sa forme et n’a pas de contours à elle',
  };
  return precisions[erreur.code];
}

/** Refus 'ecriture_invalide' d'une règle du placement : précision traduite, code et champ au journal. */
export function refusDuPlacement(erreur: ErreurPlacement, fermeId: string | null): Refus {
  return { motif: 'ecriture_invalide', precision: precisionDuPlacement(erreur), detail: `placement ${erreur.code} champ ${erreur.champ ?? '-'}`, fermeId };
}

/**
 * T32a : précision affichée pour une règle du profil de croissance (validerProfilCroissance du
 * cœur), d'après son code. Comme pour le placement, le message du cœur n'est pas relayé.
 */
const PRECISIONS_DU_PROFIL: Readonly<Record<CodeErreurCroissance, string>> = {
  trop_long: 'le profil de croissance de cette culture est trop long',
  entree_invalide: 'le profil de croissance de cette culture est illisible',
  champ_inconnu: "le profil de croissance contient une information que l'appli ne connaît pas",
  champ_manquant: 'il manque une information au profil de croissance (forme, hauteur, durée, allure ou fin de cycle)',
  forme_inconnue: 'la forme de la plante du profil de croissance est inconnue',
  hauteur_invalide: 'la hauteur maximale de la culture doit être plus grande que zéro et ne pas dépasser 6 mètres',
  duree_invalide: 'la durée de croissance se donne en jours, de 1 à 730, ou en part du cycle, plus de 0 et 1 au plus',
  allure_inconnue: 'l’allure de la croissance est inconnue : droite ou en S',
  fin_de_cycle_inconnue: 'la hauteur en fin de cycle est inconnue : conservée ou baissée',
  cycle_annuel_invalide: 'le cycle annuel demande un jour de débourrement avant le jour de repos, dans la même année',
};

export function precisionDuProfil(erreur: ErreurCroissance): string {
  return PRECISIONS_DU_PROFIL[erreur.code];
}

/** Refus 'ecriture_invalide' d'une règle du profil de croissance : précision traduite, code et champ au journal. */
export function refusDuProfil(erreur: ErreurCroissance, fermeId: string | null): Refus {
  return { motif: 'ecriture_invalide', precision: precisionDuProfil(erreur), detail: `croissance ${erreur.code} champ ${erreur.champ ?? '-'}`, fermeId };
}

/** Un `id` glissé dans les données (l'id est celui de l'écriture) : refusé comme une colonne inconnue du cœur. */
export const ID_GLISSE: ErreurSaisie = { code: 'colonne_inconnue', champ: 'id', message: 'colonne inconnue : id' };
