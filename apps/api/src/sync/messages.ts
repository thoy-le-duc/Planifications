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
import type { CodeErreurSaisie, ErreurSaisie } from '@planif/core';
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

/** Un `id` glissé dans les données (l'id est celui de l'écriture) : refusé comme une colonne inconnue du cœur. */
export const ID_GLISSE: ErreurSaisie = { code: 'colonne_inconnue', champ: 'id', message: 'colonne inconnue : id' };
