/**
 * Schéma local du téléphone (T10) : les tables que les règles de synchro (powersync/
 * sync-config.yaml) envoient, avec les noms et colonnes de Postgres (snake_case).
 *
 * Tables « JSON » de PowerSync : chaque ligne est gardée en JSON, une vue du même nom en extrait
 * les colonnes. Types SQLite : texte (uuid, dates 'AAAA-MM-JJ', instants ISO, jsonb et tableaux
 * en texte JSON), entier (entiers, booléens 0/1), réel (numeric).
 *
 * Jamais ici : les tables de secrets (code_connexion, jeton_renouvellement), l'e-mail des
 * utilisateurs, les données reçues d'un refus (`donnees`) : seul en descend le court résumé
 * calculé par le serveur (colonnes saisie_*, T10k). `schema.test.ts` vérifie l'accord avec le
 * schéma Postgres de @planif/db.
 */
import { column, Schema, Table } from '@powersync/common';

type TypeLocal = 'texte' | 'entier' | 'reel';
const T = 'texte';

/** Colonnes de chaque table, hors `id`. */
export const TABLES_LOCALES = {
  article_stock: { ferme_id: T, espece_id: T, variete_id: T, unite: T, categorie: T, cree_le: T, modifie_le: T, supprime_le: T },
  assolement: { ferme_id: T, saison_id: T, zone_id: T, emplacement_id: T, famille_id: T, espece_id: T, nature: T, source_import: T, cree_le: T, modifie_le: T, supprime_le: T },
  campagne: { ferme_id: T, plantation_id: T, annee: 'entier', debut_recolte_prevu: T, fin_recolte_prevue: T, rendement_prevu: T, cree_le: T, modifie_le: T, supprime_le: T },
  emplacement: { ferme_id: T, zone_id: T, code: T, sorte: T, longueur_m: 'reel', largeur_m: 'reel', nombre_places: 'entier', actif_du: T, actif_au: T, remplace: T, cree_le: T, modifie_le: T, supprime_le: T },
  espece: { ferme_id: T, famille_id: T, nom: T, categorie: T, perenne: 'entier', unite_recolte: T, delai_retour_minimal_ans: 'entier', delai_retour_conseille_ans: 'entier', cree_le: T, modifie_le: T, supprime_le: T },
  evenement: { ferme_id: T, type: T, date: T, horodatage: T, auteur_id: T, source: T, serie_id: T, campagne_id: T, emplacement_ids: T, note: T, photos: T, remplace_sorte: T, remplace_evenement_id: T, detail: T, cree_le: T, origine_id: T },
  famille: { ferme_id: T, nom: T, delai_retour_minimal_ans: 'entier', delai_retour_conseille_ans: 'entier', cree_le: T, modifie_le: T, supprime_le: T },
  ferme: { nom: T, fuseau_horaire: T, position: T, unites: T, cree_le: T, modifie_le: T, supprime_le: T },
  itineraire: { ferme_id: T, espece_id: T, variete_id: T, nom: T, mode: T, parametres: T, cree_le: T, modifie_le: T, supprime_le: T },
  membre: { utilisateur_id: T, ferme_id: T, role: T, cree_le: T, modifie_le: T, supprime_le: T, etat: T, invite_par: T, invite_le: T },
  modification: { ferme_id: T, nom_table: T, ligne_id: T, auteur_id: T, horodatage: T, operation: T, avant: T, apres: T, proposition_id: T, cree_le: T, modifie_le: T, supprime_le: T },
  mouvement_stock: { ferme_id: T, article_stock_id: T, date: T, quantite: 'reel', motif: T, recolte_id: T, cree_le: T },
  occupation: { ferme_id: T, emplacement_id: T, serie_id: T, plantation_id: T, evenement_id: T, longueur_m: 'reel', nombre_places: 'entier', position_m: 'reel', prevu_du: T, prevu_au: T, reel_du: T, reel_au: T, cree_le: T, modifie_le: T, supprime_le: T },
  plantation: { ferme_id: T, espece_id: T, variete_id: T, date_plantation: T, nombre_plants: 'entier', date_arrachage: T, cree_le: T, modifie_le: T, supprime_le: T },
  produit_phyto: { ferme_id: T, nom_commercial: T, numero_amm: T, substance_active: T, delai_avant_recolte_jours: 'entier', utilisable_en_bio: 'entier', dose_maximale: T, cree_le: T, modifie_le: T, supprime_le: T },
  proposition: { ferme_id: T, source: T, auteur_id: T, statut: T, decide_le: T, changements: T, cree_le: T, modifie_le: T, supprime_le: T },
  refus_synchro: { utilisateur_id: T, ferme_id: T, nom_table: T, ligne_id: T, operation: T, motif: T, message: T, cree_le: T, saisie_type: T, saisie_culture: T, saisie_date: T, saisie_quantite: 'reel', saisie_unite: T },
  saison: { ferme_id: T, nom: T, debut: T, fin: T, cree_le: T, modifie_le: T, supprime_le: T },
  secteur_emplacement: { ferme_id: T, secteur_irrigation_id: T, emplacement_id: T, du: T, au: T, cree_le: T, modifie_le: T, supprime_le: T },
  secteur_irrigation: { ferme_id: T, numero_vanne: 'entier', nom: T, debit_litres_heure: 'reel', adresse_modbus: 'entier', cree_le: T, modifie_le: T, supprime_le: T },
  serie: { ferme_id: T, saison_id: T, espece_id: T, variete_id: T, itineraire_id: T, parametres: T, ancre_type: T, ancre_date: T, prevu_semis_pepiniere: T, prevu_mise_en_place: T, prevu_debut_recolte: T, prevu_fin_recolte: T, longueur_m: 'reel', nombre_plants: 'entier', statut: T, rotation_acceptee: T, cree_le: T, modifie_le: T, supprime_le: T },
  type_intervention: { ferme_id: T, categorie: T, libelle: T, masque: 'entier', cree_le: T, modifie_le: T, supprime_le: T },
  utilisateur: { nom: T, cree_le: T, modifie_le: T, supprime_le: T },
  variete: { ferme_id: T, espece_id: T, nom: T, fournisseur: T, poids_mille_graines_g: 'reel', taux_germination: 'entier', cree_le: T, modifie_le: T, supprime_le: T },
  zone: { ferme_id: T, nom: T, zone_parente_id: T, type_abri: T, surface_m2: 'reel', cree_le: T, modifie_le: T, supprime_le: T },
} as const satisfies Readonly<Record<string, Readonly<Record<string, TypeLocal>>>>;

export type NomTableLocale = keyof typeof TABLES_LOCALES;

/** Index des lectures les plus courantes (journal par date, vue 2D, refus). */
const INDEX: Partial<Record<NomTableLocale, Record<string, string[]>>> = {
  evenement: {
    ferme_date: ['ferme_id', 'date'],
    ferme_horodatage: ['ferme_id', 'horodatage', 'date'],
    serie: ['serie_id', 'ferme_id', 'type', 'date', 'remplace_sorte', 'detail'],
    campagne: ['campagne_id'],
    remplacement: ['remplace_evenement_id', 'ferme_id', 'origine_id', 'remplace_sorte', 'horodatage'],
  },
  mouvement_stock: { recolte: ['recolte_id'] },
  occupation: {
    emplacement: ['emplacement_id', 'prevu_du'],
    ferme_culture: ['ferme_id', 'serie_id', 'plantation_id', 'emplacement_id', 'supprime_le'],
  },
  serie: { ferme_statut: ['ferme_id', 'statut'] },
  refus_synchro: { utilisateur: ['utilisateur_id', 'cree_le'] },
};

const COLONNE = { texte: column.text, entier: column.integer, reel: column.real } as const;

function table(nom: NomTableLocale): Table {
  const colonnes = Object.fromEntries(
    Object.entries(TABLES_LOCALES[nom] as Readonly<Record<string, TypeLocal>>).map(([c, t]) => [c, COLONNE[t]]),
  );
  return new Table(colonnes, { indexes: INDEX[nom] ?? {} });
}

/** Schéma PowerSync de la base locale. */
export const SCHEMA_LOCAL = new Schema(
  Object.fromEntries((Object.keys(TABLES_LOCALES) as NomTableLocale[]).map((nom) => [nom, table(nom)])),
);
