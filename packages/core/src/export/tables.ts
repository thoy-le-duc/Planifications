/**
 * Liste blanche de l'export (T15) : chaque table et chaque colonne qui sort de la base locale,
 * avec son type d'export et sa description en français (LISEZMOI.txt).
 *
 * Ce sont les tables du schéma local de @planif/sync (`TABLES_LOCALES` + `id`), sans
 * `refus_synchro` : packages/sync/src/export.test.ts vérifie l'accord. Une colonne ajoutée à la
 * base n'entre dans l'export qu'en l'ajoutant ici, avec sa description.
 */

export type TypeExport = 'texte' | 'entier' | 'reel' | 'booleen' | 'date' | 'instant' | 'json';

export interface DescriptionColonne {
  readonly type: TypeExport;
  /** En français, pour LISEZMOI.txt. */
  readonly description: string;
}

export interface DescriptionTable {
  /** En français, pour LISEZMOI.txt. */
  readonly description: string;
  /** Table de la bibliothèque : les lignes à `ferme_id` nul vont dans `bibliotheque/`. */
  readonly bibliotheque: boolean;
  /** Colonnes exportées, dans l'ordre des CSV ; `id` en premier. */
  readonly colonnes: Readonly<Record<string, DescriptionColonne>>;
}

const texte = (description: string): DescriptionColonne => ({ type: 'texte', description });
const entier = (description: string): DescriptionColonne => ({ type: 'entier', description });
const reel = (description: string): DescriptionColonne => ({ type: 'reel', description });
const booleen = (description: string): DescriptionColonne => ({ type: 'booleen', description });
const date = (description: string): DescriptionColonne => ({ type: 'date', description });
const instant = (description: string): DescriptionColonne => ({ type: 'instant', description });
const json = (description: string): DescriptionColonne => ({ type: 'json', description });

/**
 * Construit dans une fonction marquée pure : tant que rien ne lit la liste, le bundler la retire
 * du JavaScript de démarrage (l'appli importe @planif/core dès l'ouverture).
 */
export const TABLES_EXPORTEES: Readonly<Record<string, DescriptionTable>> = /* @__PURE__ */ (() => {
  const ID = texte('identifiant unique de la ligne (UUID)');
  const FERME_ID = texte('identifiant de la ferme (vide dans bibliotheque/ : fiche de référence commune)');
  const CREE_LE = instant('date et heure de création de la ligne (UTC)');
  const MODIFIE_LE = instant('date et heure de la dernière modification (UTC)');
  const SUPPRIME_LE = instant('date et heure de suppression (UTC) ; vide si la ligne est active');
  const HORODATAGE = { cree_le: CREE_LE, modifie_le: MODIFIE_LE, supprime_le: SUPPRIME_LE } as const;

  function table(description: string, colonnes: Readonly<Record<string, DescriptionColonne>>, bibliotheque = false): DescriptionTable {
    return { description, bibliotheque, colonnes: { id: ID, ...colonnes } };
  }

  return {
    article_stock: table('Articles de stock : ce qui se compte en chambre froide ou au magasin.', {
      ferme_id: FERME_ID,
      espece_id: texte('espèce de l’article (voir espece.csv)'),
      variete_id: texte('variété de l’article, facultative (voir variete.csv)'),
      unite: texte('unité de comptage : kg, botte, pièce, barquette…'),
      categorie: texte('catégorie commerciale de l’article (facultative)'),
      ...HORODATAGE,
    }),
    assolement: table('Assolement enregistré : ce qui était prévu ou cultivé sur une zone ou un emplacement pour une saison.', {
      ferme_id: FERME_ID,
      saison_id: texte('saison concernée (voir saison.csv)'),
      zone_id: texte('zone concernée, si la cible est une zone (voir zone.csv)'),
      emplacement_id: texte('emplacement concerné, si la cible est une planche ou un rang (voir emplacement.csv)'),
      famille_id: texte('famille botanique cultivée (voir famille.csv)'),
      espece_id: texte('espèce cultivée (voir espece.csv)'),
      nature: texte('nature de l’enregistrement : prévu, passé saisi ou passé importé'),
      source_import: texte('origine de l’import pour un assolement passé importé'),
      ...HORODATAGE,
    }),
    campagne: table('Campagnes annuelles des plantations pérennes : récoltes et rendement prévus de l’année.', {
      ferme_id: FERME_ID,
      plantation_id: texte('plantation pérenne concernée (voir plantation.csv)'),
      annee: entier('année de la campagne'),
      debut_recolte_prevu: date('début de récolte prévu (AAAA-MM-JJ)'),
      fin_recolte_prevue: date('fin de récolte prévue (AAAA-MM-JJ)'),
      rendement_prevu: json('rendement prévu de l’année (quantité et unité, en JSON)'),
      ...HORODATAGE,
    }),
    emplacement: table('Emplacements de culture : planches, rangs et gouttières de chaque zone.', {
      ferme_id: FERME_ID,
      zone_id: texte('zone qui contient l’emplacement (voir zone.csv)'),
      code: texte('code court unique dans la ferme, par exemple T2-P03'),
      sorte: texte('sorte d’emplacement : planche, rang ou gouttière'),
      longueur_m: reel('longueur en mètres'),
      largeur_m: reel('largeur en mètres'),
      nombre_places: entier('nombre de places (gouttières, hors-sol)'),
      actif_du: date('premier jour d’utilisation (AAAA-MM-JJ)'),
      actif_au: date('dernier jour d’utilisation (AAAA-MM-JJ) ; vide si toujours en service'),
      remplace: json('identifiants des anciens emplacements que celui-ci remplace (liste JSON)'),
      ...HORODATAGE,
    }),
    espece: table(
      'Espèces cultivées : légumes, fruits, fleurs, aromatiques, engrais verts.',
      {
        ferme_id: FERME_ID,
        famille_id: texte('famille botanique de l’espèce (voir famille.csv)'),
        nom: texte('nom de l’espèce'),
        categorie: texte('catégorie : légume, petit fruit, fruit, fleur, aromatique, engrais vert'),
        perenne: booleen('culture pérenne : oui ou non'),
        unite_recolte: texte('unité de récolte par défaut : kg, botte, pièce, barquette'),
        delai_retour_minimal_ans: entier('délai minimal avant de revenir sur la même parcelle, en années (remplace celui de la famille)'),
        delai_retour_conseille_ans: entier('délai conseillé avant de revenir sur la même parcelle, en années (remplace celui de la famille)'),
        ...HORODATAGE,
      },
      true,
    ),
    evenement: table('Journal de terrain : tout ce qui a été fait ou observé (réalisés, récoltes, interventions, irrigations, traitements, observations).', {
      ferme_id: FERME_ID,
      type: texte('type d’événement : réalisé, récolte, intervention, irrigation, traitement, observation'),
      date: date('jour de l’événement (AAAA-MM-JJ)'),
      horodatage: instant('date et heure de la saisie (UTC)'),
      auteur_id: texte('personne qui a saisi l’événement (voir utilisateur.csv)'),
      source: texte('origine de la saisie : tap, voix, agent, photo, import'),
      serie_id: texte('série concernée (voir serie.csv)'),
      campagne_id: texte('campagne concernée (voir campagne.csv)'),
      emplacement_ids: json('emplacements concernés (liste JSON d’identifiants, voir emplacement.csv)'),
      note: texte('note libre'),
      photos: json('photos jointes (liste JSON)'),
      remplace_sorte: texte('si l’événement en corrige ou en annule un autre : correction ou annulation'),
      remplace_evenement_id: texte('événement corrigé ou annulé par celui-ci'),
      detail: json('détails propres au type (quantité récoltée, produit, dose, durée…), en JSON'),
      cree_le: CREE_LE,
    }),
    famille: table(
      'Familles botaniques, pour les règles de rotation.',
      {
        ferme_id: FERME_ID,
        nom: texte('nom de la famille botanique'),
        delai_retour_minimal_ans: entier('délai minimal avant de revenir sur la même parcelle, en années'),
        delai_retour_conseille_ans: entier('délai conseillé avant de revenir sur la même parcelle, en années'),
        ...HORODATAGE,
      },
      true,
    ),
    ferme: table('La ferme exportée.', {
      nom: texte('nom de la ferme'),
      fuseau_horaire: texte('fuseau horaire de la ferme, par exemple Europe/Paris'),
      position: json('position géographique de la ferme (pour la météo), en JSON'),
      unites: json('unités préférées de la ferme, en JSON'),
      ...HORODATAGE,
    }),
    itineraire: table(
      'Itinéraires techniques : comment conduire une espèce ou une variété (durées, densités, rendements).',
      {
        ferme_id: FERME_ID,
        espece_id: texte('espèce concernée (voir espece.csv)'),
        variete_id: texte('variété concernée, facultative (voir variete.csv)'),
        nom: texte('nom de l’itinéraire'),
        mode: texte('mode de mise en place : semis direct, plant maison, plant acheté'),
        parametres: json('paramètres de l’itinéraire (durées, densité, pertes, rendement), en JSON'),
        ...HORODATAGE,
      },
      true,
    ),
    membre: table('Membres de la ferme et leur rôle.', {
      utilisateur_id: texte('personne membre (voir utilisateur.csv)'),
      ferme_id: FERME_ID,
      role: texte('rôle dans la ferme'),
      ...HORODATAGE,
      etat: texte('état de l’adhésion : invité, actif…'),
      invite_par: texte('personne qui a envoyé l’invitation (voir utilisateur.csv)'),
      invite_le: instant('date et heure de l’invitation (UTC)'),
    }),
    modification: table('Historique des modifications : qui a changé quoi, et quand.', {
      ferme_id: FERME_ID,
      nom_table: texte('table modifiée'),
      ligne_id: texte('identifiant de la ligne modifiée'),
      auteur_id: texte('auteur de la modification (voir utilisateur.csv)'),
      horodatage: instant('date et heure de la modification (UTC)'),
      operation: texte('opération : création, modification ou suppression'),
      avant: json('valeurs avant la modification, en JSON'),
      apres: json('valeurs après la modification, en JSON'),
      proposition_id: texte('proposition validée à l’origine du changement (voir proposition.csv)'),
      ...HORODATAGE,
    }),
    mouvement_stock: table('Mouvements de stock : entrées et sorties de chaque article.', {
      ferme_id: FERME_ID,
      article_stock_id: texte('article concerné (voir article_stock.csv)'),
      date: date('jour du mouvement (AAAA-MM-JJ)'),
      quantite: reel('quantité, positive pour une entrée, négative pour une sortie'),
      motif: texte('motif : récolte, vente, perte, ajustement'),
      recolte_id: texte('récolte à l’origine de l’entrée (voir evenement.csv)'),
      cree_le: CREE_LE,
    }),
    occupation: table('Occupations des emplacements : quelle série ou plantation occupe quelle planche, et quand.', {
      ferme_id: FERME_ID,
      emplacement_id: texte('emplacement occupé (voir emplacement.csv)'),
      serie_id: texte('série qui occupe l’emplacement (voir serie.csv)'),
      plantation_id: texte('plantation pérenne qui occupe l’emplacement (voir plantation.csv)'),
      evenement_id: texte('événement à l’origine de l’occupation (voir evenement.csv)'),
      longueur_m: reel('longueur occupée en mètres'),
      nombre_places: entier('nombre de places occupées'),
      position_m: reel('position sur la planche en mètres depuis son début (facultative)'),
      prevu_du: date('début d’occupation prévu (AAAA-MM-JJ)'),
      prevu_au: date('fin d’occupation prévue (AAAA-MM-JJ)'),
      reel_du: date('début d’occupation réel (AAAA-MM-JJ)'),
      reel_au: date('fin d’occupation réelle (AAAA-MM-JJ)'),
      ...HORODATAGE,
    }),
    plantation: table('Plantations pérennes : kiwis, asperges, pivoines, fraisiers conservés plusieurs années.', {
      ferme_id: FERME_ID,
      espece_id: texte('espèce plantée (voir espece.csv)'),
      variete_id: texte('variété plantée (voir variete.csv)'),
      date_plantation: date('jour de plantation (AAAA-MM-JJ)'),
      nombre_plants: entier('nombre de plants'),
      date_arrachage: date('jour d’arrachage (AAAA-MM-JJ) ; vide tant que la plantation est en place'),
      ...HORODATAGE,
    }),
    produit_phyto: table(
      'Produits phytosanitaires, pour le registre des traitements.',
      {
        ferme_id: FERME_ID,
        nom_commercial: texte('nom commercial du produit'),
        numero_amm: texte('numéro d’autorisation de mise sur le marché (AMM)'),
        substance_active: texte('substance active du produit'),
        delai_avant_recolte_jours: entier('délai avant récolte, en jours'),
        utilisable_en_bio: booleen('utilisable en agriculture biologique : oui ou non'),
        dose_maximale: json('dose maximale autorisée (valeur et unité), en JSON'),
        ...HORODATAGE,
      },
      true,
    ),
    proposition: table('Propositions de l’assistant (voix, agent, photo) et la décision prise.', {
      ferme_id: FERME_ID,
      source: texte('origine de la proposition : voix, agent, photo…'),
      auteur_id: texte('personne à l’origine de la proposition (voir utilisateur.csv)'),
      statut: texte('statut : en attente, validée ou refusée'),
      decide_le: instant('date et heure de la décision (UTC)'),
      changements: json('changements proposés, en JSON'),
      ...HORODATAGE,
    }),
    saison: table('Saisons de culture.', {
      ferme_id: FERME_ID,
      nom: texte('nom de la saison, par exemple 2027'),
      debut: date('premier jour de la saison (AAAA-MM-JJ)'),
      fin: date('dernier jour de la saison (AAAA-MM-JJ)'),
      ...HORODATAGE,
    }),
    secteur_emplacement: table('Emplacements arrosés par chaque secteur d’irrigation, avec leurs dates.', {
      ferme_id: FERME_ID,
      secteur_irrigation_id: texte('secteur d’irrigation (voir secteur_irrigation.csv)'),
      emplacement_id: texte('emplacement arrosé (voir emplacement.csv)'),
      du: date('premier jour du rattachement (AAAA-MM-JJ)'),
      au: date('dernier jour du rattachement (AAAA-MM-JJ) ; vide si toujours en cours'),
      ...HORODATAGE,
    }),
    secteur_irrigation: table('Secteurs d’irrigation : une ligne par vanne.', {
      ferme_id: FERME_ID,
      numero_vanne: entier('numéro de la vanne'),
      nom: texte('nom du secteur'),
      debit_litres_heure: reel('débit en litres par heure (facultatif)'),
      adresse_modbus: entier('adresse Modbus de la vanne (facultative)'),
      ...HORODATAGE,
    }),
    serie: table('Séries de culture planifiées : espèce, dates prévues, longueur ou nombre de plants.', {
      ferme_id: FERME_ID,
      saison_id: texte('saison de la mise en place (voir saison.csv)'),
      espece_id: texte('espèce cultivée (voir espece.csv)'),
      variete_id: texte('variété cultivée (voir variete.csv)'),
      itineraire_id: texte('itinéraire technique suivi (voir itineraire.csv)'),
      parametres: json('paramètres de l’itinéraire figés à la création de la série, en JSON'),
      ancre_type: texte('date de référence de la série : semis, plantation ou début de récolte'),
      ancre_date: date('date de référence de la série (AAAA-MM-JJ)'),
      prevu_semis_pepiniere: date('semis en pépinière prévu (AAAA-MM-JJ)'),
      prevu_mise_en_place: date('mise en place prévue (AAAA-MM-JJ)'),
      prevu_debut_recolte: date('début de récolte prévu (AAAA-MM-JJ)'),
      prevu_fin_recolte: date('fin de récolte prévue (AAAA-MM-JJ)'),
      longueur_m: reel('longueur totale en mètres'),
      nombre_plants: entier('nombre de plants'),
      statut: texte('statut de la série : prévue, en cours, terminée…'),
      // Texte JSON tel que le téléphone le garde (règle de type par nom de colonne de T15).
      rotation_acceptee: texte('alerte rouge de rotation acceptée, en JSON : famille en cause, délai de retour (ans), instant de la décision'),
      ...HORODATAGE,
    }),
    utilisateur: table('Personnes membres de la ferme (sans adresse e-mail).', {
      nom: texte('nom de la personne'),
      ...HORODATAGE,
    }),
    variete: table(
      'Variétés de chaque espèce.',
      {
        ferme_id: FERME_ID,
        espece_id: texte('espèce de la variété (voir espece.csv)'),
        nom: texte('nom de la variété'),
        fournisseur: texte('fournisseur des semences ou des plants'),
        poids_mille_graines_g: reel('poids de mille graines, en grammes'),
        taux_germination: entier('taux de germination, en pourcentage'),
        ...HORODATAGE,
      },
      true,
    ),
    zone: table('Zones de la ferme : tunnels, serres, îlots, verger.', {
      ferme_id: FERME_ID,
      nom: texte('nom de la zone'),
      zone_parente_id: texte('zone qui contient celle-ci, facultative (voir zone.csv)'),
      type_abri: texte('type d’abri : plein champ, tunnel, serre, hors-sol'),
      surface_m2: reel('surface en mètres carrés'),
      ...HORODATAGE,
    }),
  };
})();
