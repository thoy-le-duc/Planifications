/**
 * Schéma PostgreSQL de référence (modèle v1, docs/modele-donnees.md), en Drizzle.
 *
 * - Une table par entité de T01, plus les comptes (T09 : utilisateur, membre, codes de connexion,
 *   jetons de renouvellement, section 8). Q10 : pas de tables Récolte,
 *   Intervention, Traitement : le détail est dans `evenement.detail` (jsonb), et trois vues SQL
 *   (migration personnalisée) les présentent en colonnes.
 * - Clés TypeScript en camelCase, colonnes en snake_case, noms explicites.
 * - Clés étrangères sans cascade (NO ACTION) : on ne perd jamais d'historique par effet de bord.
 * - Unions de T01 en `text` + CHECK (plus simple à faire évoluer qu'un enum Postgres, et
 *   PowerSync les réplique de toute façon en texte).
 * - Déclencheurs d'ajout seul, vues et publication PowerSync : migration SQL personnalisée
 *   (migrations/0001_*.sql), hors de ce fichier.
 */
import type {
  CategorieEspece,
  ChangementPropose,
  DateCalendaire,
  Evenement,
  Id,
  ModeItineraire,
  NomEntite,
  ParametresItineraire,
  PositionGeographique,
  Quantite,
  UniteRecolte,
  UnitesFerme,
  ValeursLigne,
} from '@planif/core';
import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CATEGORIES_ESPECE,
  CATEGORIES_INTERVENTION,
  ETAPES_REALISEES,
  MODES_ITINERAIRE,
  MOTIFS_MOUVEMENT,
  NATURES_OBSERVATION,
  NATURES_ASSOLEMENT,
  OPERATIONS_LIGNE,
  ROLES_MEMBRE,
  SORTES_EMPLACEMENT,
  SORTES_REMPLACEMENT,
  SOURCES_PROPOSITION,
  SOURCES_SAISIE,
  STATUTS_PROPOSITION,
  STATUTS_SERIE,
  TABLES_MODIFIABLES,
  TYPES_ABRI,
  TYPES_ANCRE,
  TYPES_EVENEMENT,
  UNITES_RECOLTE,
} from './valeurs.ts';

// ---------------------------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------------------------

/** Identifiant UUID v7, généré par le client : pas de défaut en base. */
const idDe = <E extends NomEntite>(nom: string) => uuid(nom).$type<Id<E>>();

/** Date calendaire 'AAAA-MM-JJ', jamais d'objet Date. */
const jour = (nom: string) => date(nom, { mode: 'string' }).$type<DateCalendaire>();

/** Instant (timestamptz). */
const instant = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'date' });

/** Longueur, surface, quantité : numeric, lu comme un nombre. */
const decimal = (nom: string) => numeric(nom, { mode: 'number' });

const creeLe = () => instant('cree_le').notNull().defaultNow();

/** Colonnes techniques d'une ligne modifiable : création, modification, suppression douce. */
const horodatages = () => ({
  creeLe: creeLe(),
  modifieLe: instant('modifie_le').notNull().defaultNow(),
  supprimeLe: instant('supprime_le'),
});

/** `ferme_id` obligatoire, vers la ferme. */
const fermeId = () =>
  idDe<'Ferme'>('ferme_id')
    .notNull()
    .references(() => ferme.id);

/** `ferme_id` nul autorisé : bibliothèque de référence partagée (famille, espèce…). */
const fermeIdBibliotheque = () => idDe<'Ferme'>('ferme_id').references(() => ferme.id);

/** `auteur_id` obligatoire, vers l'utilisateur qui a saisi (T09). */
const auteurId = () =>
  idDe<'Utilisateur'>('auteur_id')
    .notNull()
    .references(() => utilisateur.id);

/** `colonne IN ('a', 'b', …)`, valeurs écrites en clair dans la contrainte. */
function parmi(expression: AnyPgColumn | SQL, valeurs: readonly string[]): SQL {
  for (const v of valeurs) {
    if (!/^[A-Za-z_]+$/.test(v)) {
      throw new Error(`valeur d’union inattendue : ${v}`);
    }
  }
  return sql`${expression} IN (${sql.raw(valeurs.map((v) => `'${v}'`).join(', '))})`;
}

const MOTIF_UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** Valeur jsonb numérique qui vérifie `comparaison` ; faux (jamais d'erreur) sinon. */
function nombre(valeur: SQL, comparaison: '> 0' | '>= 0'): SQL {
  return sql`(CASE WHEN jsonb_typeof(${valeur}) = 'number' THEN (${valeur})::numeric ${sql.raw(comparaison)} ELSE false END)`;
}

/** Valeur jsonb absente, nulle, ou du type donné. */
function typeOuNul(valeur: SQL, type: 'string' | 'number'): SQL {
  return sql`coalesce(jsonb_typeof(${valeur}), 'null') IN ('null', ${sql.raw(`'${type}'`)})`;
}

/** Nom de contrainte CHECK préfixé par la table. */
const verif = (table: string, nom: string, condition: SQL) => check(`${table}_${nom}`, condition);

// ---------------------------------------------------------------------------------------------
// 1. Parcellaire
// ---------------------------------------------------------------------------------------------

export const ferme = pgTable('ferme', {
  id: idDe<'Ferme'>('id').primaryKey(),
  nom: text('nom').notNull(),
  fuseauHoraire: text('fuseau_horaire').notNull(),
  position: jsonb('position').$type<PositionGeographique>(),
  unites: jsonb('unites')
    .$type<UnitesFerme>()
    .notNull()
    .default(sql`'{"longueur": "m", "masse": "kg"}'::jsonb`),
  ...horodatages(),
});

export const zone = pgTable(
  'zone',
  {
    id: idDe<'Zone'>('id').primaryKey(),
    fermeId: fermeId(),
    nom: text('nom').notNull(),
    zoneParenteId: idDe<'Zone'>('zone_parente_id').references((): AnyPgColumn => zone.id),
    typeAbri: text('type_abri', { enum: TYPES_ABRI }).notNull(),
    surfaceM2: decimal('surface_m2'),
    ...horodatages(),
  },
  (t) => [
    verif('zone', 'type_abri', parmi(t.typeAbri, TYPES_ABRI)),
    verif('zone', 'surface_positive', sql`${t.surfaceM2} IS NULL OR ${t.surfaceM2} > 0`),
    verif('zone', 'pas_sa_propre_parente', sql`${t.zoneParenteId} IS DISTINCT FROM ${t.id}`),
  ],
);

export const emplacement = pgTable(
  'emplacement',
  {
    id: idDe<'Emplacement'>('id').primaryKey(),
    fermeId: fermeId(),
    zoneId: idDe<'Zone'>('zone_id')
      .notNull()
      .references(() => zone.id),
    code: text('code').notNull(),
    sorte: text('sorte', { enum: SORTES_EMPLACEMENT }).notNull(),
    longueurM: decimal('longueur_m').notNull(),
    largeurM: decimal('largeur_m'),
    /** Gouttière seulement. */
    nombrePlaces: integer('nombre_places'),
    actifDu: jour('actif_du').notNull(),
    actifAu: jour('actif_au'),
    /** Anciens emplacements redessinés en celui-ci (tableau d'UUID, sans clé étrangère). */
    remplace: uuid('remplace')
      .array()
      .$type<readonly Id<'Emplacement'>[]>()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    ...horodatages(),
  },
  (t) => [
    verif('emplacement', 'sorte', parmi(t.sorte, SORTES_EMPLACEMENT)),
    verif('emplacement', 'longueur_positive', sql`${t.longueurM} > 0`),
    verif('emplacement', 'largeur_positive', sql`${t.largeurM} IS NULL OR ${t.largeurM} > 0`),
    verif(
      'emplacement',
      'places_de_gouttiere',
      sql`(${t.sorte} = 'gouttiere') = (${t.nombrePlaces} IS NOT NULL) AND (${t.nombrePlaces} IS NULL OR ${t.nombrePlaces} > 0)`,
    ),
    verif('emplacement', 'periode_active', sql`${t.actifAu} IS NULL OR ${t.actifAu} >= ${t.actifDu}`),
    /** Reconnaissance vocale : « planche 3 du tunnel 2 » → code. */
    index('emplacement_ferme_code_idx').on(t.fermeId, t.code),
    index('emplacement_zone_idx').on(t.zoneId),
  ],
);

/** Une vanne d'irrigation. */
export const secteurIrrigation = pgTable(
  'secteur_irrigation',
  {
    id: idDe<'SecteurIrrigation'>('id').primaryKey(),
    fermeId: fermeId(),
    numeroVanne: integer('numero_vanne').notNull(),
    nom: text('nom').notNull(),
    debitLitresHeure: decimal('debit_litres_heure'),
    adresseModbus: integer('adresse_modbus'),
    ...horodatages(),
  },
  (t) => [
    verif('secteur_irrigation', 'debit_positif', sql`${t.debitLitresHeure} IS NULL OR ${t.debitLitresHeure} > 0`),
  ],
);

export const secteurEmplacement = pgTable(
  'secteur_emplacement',
  {
    id: idDe<'SecteurEmplacement'>('id').primaryKey(),
    fermeId: fermeId(),
    secteurIrrigationId: idDe<'SecteurIrrigation'>('secteur_irrigation_id')
      .notNull()
      .references(() => secteurIrrigation.id),
    emplacementId: idDe<'Emplacement'>('emplacement_id')
      .notNull()
      .references(() => emplacement.id),
    du: jour('du').notNull(),
    au: jour('au'),
    ...horodatages(),
  },
  (t) => [
    verif('secteur_emplacement', 'periode', sql`${t.au} IS NULL OR ${t.au} >= ${t.du}`),
    index('secteur_emplacement_secteur_idx').on(t.secteurIrrigationId),
    index('secteur_emplacement_emplacement_idx').on(t.emplacementId),
  ],
);

// ---------------------------------------------------------------------------------------------
// 2. Bibliothèque de cultures (ferme_id nul : bibliothèque de référence partagée)
// ---------------------------------------------------------------------------------------------

export const famille = pgTable(
  'famille',
  {
    id: idDe<'Famille'>('id').primaryKey(),
    fermeId: fermeIdBibliotheque(),
    nom: text('nom').notNull(),
    delaiRetourMinimalAns: integer('delai_retour_minimal_ans').notNull(),
    delaiRetourConseilleAns: integer('delai_retour_conseille_ans').notNull(),
    ...horodatages(),
  },
  (t) => [
    verif(
      'famille',
      'delais_retour',
      sql`${t.delaiRetourMinimalAns} >= 0 AND ${t.delaiRetourConseilleAns} >= ${t.delaiRetourMinimalAns}`,
    ),
  ],
);

export const espece = pgTable(
  'espece',
  {
    id: idDe<'Espece'>('id').primaryKey(),
    fermeId: fermeIdBibliotheque(),
    familleId: idDe<'Famille'>('famille_id')
      .notNull()
      .references(() => famille.id),
    nom: text('nom').notNull(),
    categorie: text('categorie', { enum: CATEGORIES_ESPECE }).$type<CategorieEspece>().notNull(),
    perenne: boolean('perenne').notNull(),
    uniteRecolte: text('unite_recolte', { enum: UNITES_RECOLTE }).$type<UniteRecolte>().notNull(),
    /** Délais propres à l'espèce : remplis ensemble ou pas du tout. */
    delaiRetourMinimalAns: integer('delai_retour_minimal_ans'),
    delaiRetourConseilleAns: integer('delai_retour_conseille_ans'),
    ...horodatages(),
  },
  (t) => [
    verif('espece', 'categorie', parmi(t.categorie, CATEGORIES_ESPECE)),
    verif('espece', 'unite_recolte', parmi(t.uniteRecolte, UNITES_RECOLTE)),
    verif(
      'espece',
      'delais_retour',
      sql`(${t.delaiRetourMinimalAns} IS NULL AND ${t.delaiRetourConseilleAns} IS NULL)
        OR (${t.delaiRetourMinimalAns} >= 0 AND ${t.delaiRetourConseilleAns} >= ${t.delaiRetourMinimalAns})`,
    ),
    index('espece_famille_idx').on(t.familleId),
  ],
);

export const variete = pgTable(
  'variete',
  {
    id: idDe<'Variete'>('id').primaryKey(),
    fermeId: fermeIdBibliotheque(),
    especeId: idDe<'Espece'>('espece_id')
      .notNull()
      .references(() => espece.id),
    nom: text('nom').notNull(),
    fournisseur: text('fournisseur'),
    poidsMilleGrainesG: decimal('poids_mille_graines_g'),
    tauxGermination: integer('taux_germination'),
    ...horodatages(),
  },
  (t) => [
    verif('variete', 'pmg_positif', sql`${t.poidsMilleGrainesG} IS NULL OR ${t.poidsMilleGrainesG} > 0`),
    verif(
      'variete',
      'taux_germination',
      sql`${t.tauxGermination} IS NULL OR ${t.tauxGermination} BETWEEN 0 AND 100`,
    ),
    index('variete_espece_idx').on(t.especeId),
  ],
);

export const itineraire = pgTable(
  'itineraire',
  {
    id: idDe<'Itineraire'>('id').primaryKey(),
    fermeId: fermeIdBibliotheque(),
    especeId: idDe<'Espece'>('espece_id')
      .notNull()
      .references(() => espece.id),
    varieteId: idDe<'Variete'>('variete_id').references(() => variete.id),
    nom: text('nom').notNull(),
    mode: text('mode', { enum: MODES_ITINERAIRE }).$type<ModeItineraire>().notNull(),
    /** ParametresItineraire de T01, tel quel (le mode y est répété). */
    parametres: jsonb('parametres').$type<ParametresItineraire>().notNull(),
    ...horodatages(),
  },
  (t) => [
    verif('itineraire', 'mode', parmi(t.mode, MODES_ITINERAIRE)),
    verif('itineraire', 'parametres_du_mode', sql`${t.parametres} ->> 'mode' = ${t.mode}`),
    index('itineraire_espece_idx').on(t.especeId),
  ],
);

// ---------------------------------------------------------------------------------------------
// 3. Planification
// ---------------------------------------------------------------------------------------------

export const saison = pgTable(
  'saison',
  {
    id: idDe<'Saison'>('id').primaryKey(),
    fermeId: fermeId(),
    nom: text('nom').notNull(),
    debut: jour('debut').notNull(),
    fin: jour('fin').notNull(),
    ...horodatages(),
  },
  (t) => [verif('saison', 'periode', sql`${t.fin} >= ${t.debut}`)],
);

export const serie = pgTable(
  'serie',
  {
    id: idDe<'Serie'>('id').primaryKey(),
    fermeId: fermeId(),
    saisonId: idDe<'Saison'>('saison_id')
      .notNull()
      .references(() => saison.id),
    especeId: idDe<'Espece'>('espece_id')
      .notNull()
      .references(() => espece.id),
    varieteId: idDe<'Variete'>('variete_id').references(() => variete.id),
    itineraireId: idDe<'Itineraire'>('itineraire_id')
      .notNull()
      .references(() => itineraire.id),
    /** Instantané des paramètres de l'itinéraire à la création. */
    parametres: jsonb('parametres').$type<ParametresItineraire>().notNull(),
    ancreType: text('ancre_type', { enum: TYPES_ANCRE }).notNull(),
    ancreDate: jour('ancre_date').notNull(),
    /** NULL hors plant maison (pas de pépinière). */
    prevuSemisPepiniere: jour('prevu_semis_pepiniere'),
    prevuMiseEnPlace: jour('prevu_mise_en_place').notNull(),
    prevuDebutRecolte: jour('prevu_debut_recolte').notNull(),
    prevuFinRecolte: jour('prevu_fin_recolte').notNull(),
    /** Taille : exactement une des deux. */
    longueurM: decimal('longueur_m'),
    nombrePlants: integer('nombre_plants'),
    statut: text('statut', { enum: STATUTS_SERIE }).notNull(),
    ...horodatages(),
  },
  (t) => [
    verif('serie', 'ancre_type', parmi(t.ancreType, TYPES_ANCRE)),
    verif('serie', 'statut', parmi(t.statut, STATUTS_SERIE)),
    verif('serie', 'parametres', sql`jsonb_typeof(${t.parametres}) = 'object'`),
    verif('serie', 'une_taille', sql`num_nonnulls(${t.longueurM}, ${t.nombrePlants}) = 1`),
    verif(
      'serie',
      'taille_positive',
      sql`(${t.longueurM} IS NULL OR ${t.longueurM} > 0) AND (${t.nombrePlants} IS NULL OR ${t.nombrePlants} > 0)`,
    ),
    verif(
      'serie',
      'ordre_des_dates',
      sql`${t.prevuFinRecolte} >= ${t.prevuDebutRecolte} AND ${t.prevuDebutRecolte} >= ${t.prevuMiseEnPlace}
        AND (${t.prevuSemisPepiniere} IS NULL OR ${t.prevuMiseEnPlace} >= ${t.prevuSemisPepiniere})`,
    ),
    // Semainier : semis, plantations et récoltes de la semaine, par ferme.
    index('serie_semainier_semis_idx').on(t.fermeId, t.prevuSemisPepiniere),
    index('serie_semainier_mise_en_place_idx').on(t.fermeId, t.prevuMiseEnPlace),
    index('serie_semainier_recolte_idx').on(t.fermeId, t.prevuDebutRecolte, t.prevuFinRecolte),
    index('serie_saison_idx').on(t.saisonId),
  ],
);

/** Culture pluriannuelle (kiwis, asperges, pivoines, fraisiers conservés). */
export const plantation = pgTable(
  'plantation',
  {
    id: idDe<'Plantation'>('id').primaryKey(),
    fermeId: fermeId(),
    especeId: idDe<'Espece'>('espece_id')
      .notNull()
      .references(() => espece.id),
    varieteId: idDe<'Variete'>('variete_id').references(() => variete.id),
    datePlantation: jour('date_plantation').notNull(),
    nombrePlants: integer('nombre_plants').notNull(),
    dateArrachage: jour('date_arrachage'),
    ...horodatages(),
  },
  (t) => [
    verif('plantation', 'nombre_plants_positif', sql`${t.nombrePlants} > 0`),
    verif(
      'plantation',
      'arrachage_apres_plantation',
      sql`${t.dateArrachage} IS NULL OR ${t.dateArrachage} >= ${t.datePlantation}`,
    ),
  ],
);

/** Une année de production d'une plantation. */
export const campagne = pgTable(
  'campagne',
  {
    id: idDe<'Campagne'>('id').primaryKey(),
    fermeId: fermeId(),
    plantationId: idDe<'Plantation'>('plantation_id')
      .notNull()
      .references(() => plantation.id),
    annee: integer('annee').notNull(),
    debutRecoltePrevu: jour('debut_recolte_prevu'),
    finRecoltePrevue: jour('fin_recolte_prevue'),
    rendementPrevu: jsonb('rendement_prevu').$type<{ readonly quantite: number; readonly unite: UniteRecolte }>(),
    ...horodatages(),
  },
  (t) => [
    verif(
      'campagne',
      'recolte_prevue',
      sql`${t.finRecoltePrevue} IS NULL OR ${t.debutRecoltePrevu} IS NULL OR ${t.finRecoltePrevue} >= ${t.debutRecoltePrevu}`,
    ),
    /** Une campagne par an et par plantation, parmi les lignes non supprimées. */
    uniqueIndex('campagne_plantation_annee_idx')
      .on(t.plantationId, t.annee)
      .where(sql`${t.supprimeLe} IS NULL`),
  ],
);

/** Occupation datée d'un emplacement : la ligne de temps des planches. */
export const occupation = pgTable(
  'occupation',
  {
    id: idDe<'Occupation'>('id').primaryKey(),
    fermeId: fermeId(),
    emplacementId: idDe<'Emplacement'>('emplacement_id')
      .notNull()
      .references(() => emplacement.id),
    /** Occupant : exactement un des trois. */
    serieId: idDe<'Serie'>('serie_id').references(() => serie.id),
    plantationId: idDe<'Plantation'>('plantation_id').references(() => plantation.id),
    /** Couverture longue (bâche, occultation, solarisation). */
    evenementId: idDe<'Evenement'>('evenement_id').references((): AnyPgColumn => evenement.id),
    /** Place : exactement une des deux. */
    longueurM: decimal('longueur_m'),
    nombrePlaces: integer('nombre_places'),
    positionM: decimal('position_m'),
    prevuDu: jour('prevu_du').notNull(),
    prevuAu: jour('prevu_au').notNull(),
    /** Réel : [reel_du, reel_au[, reel_au NULL tant que la fin n'est pas connue. */
    reelDu: jour('reel_du'),
    reelAu: jour('reel_au'),
    ...horodatages(),
  },
  (t) => [
    verif(
      'occupation',
      'un_occupant',
      sql`num_nonnulls(${t.serieId}, ${t.plantationId}, ${t.evenementId}) = 1`,
    ),
    verif('occupation', 'une_place', sql`num_nonnulls(${t.longueurM}, ${t.nombrePlaces}) = 1`),
    verif(
      'occupation',
      'place_positive',
      sql`(${t.longueurM} IS NULL OR ${t.longueurM} > 0) AND (${t.nombrePlaces} IS NULL OR ${t.nombrePlaces} > 0)`,
    ),
    verif('occupation', 'position_positive', sql`${t.positionM} IS NULL OR ${t.positionM} >= 0`),
    verif('occupation', 'periode_prevue', sql`${t.prevuAu} >= ${t.prevuDu}`),
    verif(
      'occupation',
      'periode_reelle',
      sql`(${t.reelDu} IS NOT NULL OR ${t.reelAu} IS NULL) AND (${t.reelAu} IS NULL OR ${t.reelAu} >= ${t.reelDu})`,
    ),
    // Vue 2D planches × semaines : occupations d'un emplacement sur une période.
    index('occupation_vue_2d_idx').on(t.emplacementId, t.prevuDu, t.prevuAu),
    index('occupation_serie_idx').on(t.serieId),
    index('occupation_plantation_idx').on(t.plantationId),
  ],
);

/** Assolement enregistré : jamais effacé physiquement. */
export const assolement = pgTable(
  'assolement',
  {
    id: idDe<'Assolement'>('id').primaryKey(),
    fermeId: fermeId(),
    saisonId: idDe<'Saison'>('saison_id')
      .notNull()
      .references(() => saison.id),
    /** Cible : exactement une des deux. */
    zoneId: idDe<'Zone'>('zone_id').references(() => zone.id),
    emplacementId: idDe<'Emplacement'>('emplacement_id').references(() => emplacement.id),
    familleId: idDe<'Famille'>('famille_id')
      .notNull()
      .references(() => famille.id),
    especeId: idDe<'Espece'>('espece_id').references(() => espece.id),
    nature: text('nature', { enum: NATURES_ASSOLEMENT }).notNull(),
    /** Seulement pour un assolement importé. */
    sourceImport: text('source_import'),
    ...horodatages(),
  },
  (t) => [
    verif('assolement', 'nature', parmi(t.nature, NATURES_ASSOLEMENT)),
    verif('assolement', 'une_cible', sql`num_nonnulls(${t.zoneId}, ${t.emplacementId}) = 1`),
    verif(
      'assolement',
      'source_import',
      sql`${t.sourceImport} IS NULL OR ${t.nature} = 'passe_importe'`,
    ),
    index('assolement_zone_idx').on(t.zoneId),
    index('assolement_emplacement_idx').on(t.emplacementId),
  ],
);

// ---------------------------------------------------------------------------------------------
// 5. Journal de terrain (ajout seul : voir la migration personnalisée)
// ---------------------------------------------------------------------------------------------

/**
 * Toute saisie au champ. Ajout seul : ni mise à jour ni suppression (déclencheur), donc ni
 * `modifie_le` ni `supprime_le`. Un événement se corrige ou s'annule par un nouvel événement
 * qui le désigne (`remplace_evenement_id`).
 */
export const evenement = pgTable(
  'evenement',
  {
    id: idDe<'Evenement'>('id').primaryKey(),
    fermeId: fermeId(),
    type: text('type', { enum: TYPES_EVENEMENT }).notNull(),
    date: jour('date').notNull(),
    horodatage: instant('horodatage').notNull(),
    auteurId: auteurId(),
    source: text('source', { enum: SOURCES_SAISIE }).notNull(),
    /** Culture : au plus une des deux. */
    serieId: idDe<'Serie'>('serie_id').references(() => serie.id),
    campagneId: idDe<'Campagne'>('campagne_id').references(() => campagne.id),
    emplacementIds: uuid('emplacement_ids')
      .array()
      .$type<readonly Id<'Emplacement'>[]>()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    note: text('note'),
    photos: text('photos').array().$type<readonly string[]>().notNull().default(sql`'{}'::text[]`),
    remplaceSorte: text('remplace_sorte', { enum: SORTES_REMPLACEMENT }),
    /** Même ferme garantie par la clé étrangère composée ci-dessous ; même type par déclencheur. */
    remplaceEvenementId: idDe<'Evenement'>('remplace_evenement_id'),
    /** Le Detail* de T01 tel quel (clés camelCase), choisi par `type`. */
    detail: jsonb('detail').$type<Evenement['detail']>().notNull(),
    creeLe: creeLe(),
  },
  (t) => [
    verif('evenement', 'type', parmi(t.type, TYPES_EVENEMENT)),
    verif('evenement', 'source', parmi(t.source, SOURCES_SAISIE)),
    verif('evenement', 'remplace_sorte', sql`${t.remplaceSorte} IS NULL OR ${parmi(t.remplaceSorte, SORTES_REMPLACEMENT)}`),
    verif('evenement', 'au_plus_une_culture', sql`num_nonnulls(${t.serieId}, ${t.campagneId}) <= 1`),
    verif(
      'evenement',
      'remplacement_complet',
      sql`(${t.remplaceSorte} IS NULL) = (${t.remplaceEvenementId} IS NULL)`,
    ),
    verif('evenement', 'ne_se_remplace_pas', sql`${t.remplaceEvenementId} IS DISTINCT FROM ${t.id}`),
    verif('evenement', 'detail_objet', sql`jsonb_typeof(${t.detail}) = 'object'`),
    // Les CASE garantissent l'ordre d'évaluation : pas de conversion d'une valeur non numérique.
    // Détail jsonb : un champ absent, une date impossible ou une valeur non numérique est
    // refusé (23514). `IS TRUE` : une condition inconnue (champ absent → NULL) refuse aussi.
    // Les CASE garantissent qu'aucune conversion ne s'applique à une valeur non numérique.
    verif(
      'evenement',
      'detail_recolte',
      sql`${t.type} <> 'recolte' OR (${nombre(sql`${t.detail} -> 'quantite'`, '> 0')}
        AND ${parmi(sql`${t.detail} ->> 'unite'`, UNITES_RECOLTE)}
        AND ${typeOuNul(sql`${t.detail} -> 'categorie'`, 'string')}) IS TRUE`,
    ),
    verif(
      'evenement',
      'detail_realise',
      sql`${t.type} <> 'realise' OR (${parmi(sql`${t.detail} ->> 'etape'`, ETAPES_REALISEES)}
        AND ${typeOuNul(sql`${t.detail} -> 'quantiteReelle'`, 'number')}) IS TRUE`,
    ),
    verif(
      'evenement',
      'detail_intervention',
      sql`${t.type} <> 'intervention' OR (${parmi(sql`${t.detail} ->> 'categorie'`, CATEGORIES_INTERVENTION)}
        AND jsonb_typeof(${t.detail} -> 'type') = 'string'
        AND ${typeOuNul(sql`${t.detail} -> 'outil'`, 'string')}
        AND ${typeOuNul(sql`${t.detail} -> 'dureeOccupationJours'`, 'number')}
        AND ${typeOuNul(sql`${t.detail} -> 'quantite' -> 'valeur'`, 'number')}
        AND (${t.detail} ->> 'categorie' NOT IN ('fertilisation', 'amendement')
          OR (jsonb_typeof(${t.detail} -> 'quantite' -> 'valeur') = 'number'
            AND jsonb_typeof(${t.detail} -> 'produit') = 'string'))) IS TRUE`,
    ),
    verif(
      'evenement',
      'detail_irrigation',
      sql`${t.type} <> 'irrigation' OR ((${t.detail} ->> 'secteurIrrigationId') ~ ${sql.raw(`'${MOTIF_UUID}'`)}
        AND ${nombre(sql`${t.detail} -> 'dureeMinutes'`, '>= 0')}) IS TRUE`,
    ),
    verif(
      'evenement',
      'detail_traitement',
      sql`${t.type} <> 'traitement' OR ((${t.detail} ->> 'produitPhytoId') ~ ${sql.raw(`'${MOTIF_UUID}'`)}
        AND est_date_calendaire(${t.detail} ->> 'recolteAutoriseeLe')
        AND ${nombre(sql`${t.detail} -> 'dose' -> 'valeur'`, '>= 0')}
        AND jsonb_typeof(${t.detail} -> 'dose' -> 'unite') = 'string'
        AND ${nombre(sql`${t.detail} -> 'surfaceTraiteeM2'`, '>= 0')}) IS TRUE`,
    ),
    verif(
      'evenement',
      'detail_observation',
      sql`${t.type} <> 'observation' OR (${parmi(sql`${t.detail} ->> 'nature'`, NATURES_OBSERVATION)}) IS TRUE`,
    ),
    /** Cible de la clé étrangère composée : un remplacement vise un événement de la même ferme. */
    unique('evenement_ferme_id_id_unique').on(t.fermeId, t.id),
    foreignKey({
      name: 'evenement_remplace_meme_ferme_fk',
      columns: [t.fermeId, t.remplaceEvenementId],
      foreignColumns: [t.fermeId, t.id],
    }),
    index('evenement_ferme_date_idx').on(t.fermeId, t.date),
    index('evenement_serie_idx').on(t.serieId),
    index('evenement_campagne_idx').on(t.campagneId),
    index('evenement_remplace_idx').on(t.remplaceEvenementId),
  ],
);

// ---------------------------------------------------------------------------------------------
// 6. Stocks et registre phyto
// ---------------------------------------------------------------------------------------------

export const articleStock = pgTable(
  'article_stock',
  {
    id: idDe<'ArticleStock'>('id').primaryKey(),
    fermeId: fermeId(),
    especeId: idDe<'Espece'>('espece_id')
      .notNull()
      .references(() => espece.id),
    varieteId: idDe<'Variete'>('variete_id').references(() => variete.id),
    unite: text('unite', { enum: UNITES_RECOLTE }).$type<UniteRecolte>().notNull(),
    categorie: text('categorie'),
    ...horodatages(),
  },
  (t) => [verif('article_stock', 'unite', parmi(t.unite, UNITES_RECOLTE))],
);

/**
 * Mouvement de stock, en ajout seul comme les événements (déclencheur) : ni `modifie_le` ni
 * `supprime_le`. Le stock est la somme des mouvements.
 */
export const mouvementStock = pgTable(
  'mouvement_stock',
  {
    id: idDe<'MouvementStock'>('id').primaryKey(),
    fermeId: fermeId(),
    articleStockId: idDe<'ArticleStock'>('article_stock_id')
      .notNull()
      .references(() => articleStock.id),
    date: jour('date').notNull(),
    /** Positive en entrée, négative en sortie. */
    quantite: decimal('quantite').notNull(),
    motif: text('motif', { enum: MOTIFS_MOUVEMENT }).notNull(),
    /** Événement de récolte à l'origine de l'entrée : si et seulement si motif = 'recolte'. */
    recolteId: idDe<'Evenement'>('recolte_id').references(() => evenement.id),
    creeLe: creeLe(),
  },
  (t) => [
    verif('mouvement_stock', 'motif', parmi(t.motif, MOTIFS_MOUVEMENT)),
    verif('mouvement_stock', 'quantite_non_nulle', sql`${t.quantite} <> 0`),
    verif('mouvement_stock', 'recolte_liee', sql`(${t.motif} = 'recolte') = (${t.recolteId} IS NOT NULL)`),
    index('mouvement_stock_article_idx').on(t.articleStockId),
    index('mouvement_stock_recolte_idx').on(t.recolteId),
  ],
);

export const produitPhyto = pgTable(
  'produit_phyto',
  {
    id: idDe<'ProduitPhyto'>('id').primaryKey(),
    fermeId: fermeIdBibliotheque(),
    nomCommercial: text('nom_commercial').notNull(),
    numeroAmm: text('numero_amm').notNull(),
    substanceActive: text('substance_active').notNull(),
    delaiAvantRecolteJours: integer('delai_avant_recolte_jours').notNull(),
    utilisableEnBio: boolean('utilisable_en_bio').notNull(),
    doseMaximale: jsonb('dose_maximale').$type<Quantite>(),
    ...horodatages(),
  },
  (t) => [verif('produit_phyto', 'delai_avant_recolte', sql`${t.delaiAvantRecolteJours} >= 0`)],
);

// ---------------------------------------------------------------------------------------------
// 7. Validation et historique
// ---------------------------------------------------------------------------------------------

/** Ce qui vient de la voix, de l'agent ou d'une photo, avant le tap de validation. */
export const proposition = pgTable(
  'proposition',
  {
    id: idDe<'Proposition'>('id').primaryKey(),
    fermeId: fermeId(),
    source: text('source', { enum: SOURCES_PROPOSITION }).notNull(),
    auteurId: auteurId(),
    statut: text('statut', { enum: STATUTS_PROPOSITION }).notNull(),
    decideLe: instant('decide_le'),
    changements: jsonb('changements').$type<readonly ChangementPropose[]>().notNull(),
    ...horodatages(),
  },
  (t) => [
    verif('proposition', 'source', parmi(t.source, SOURCES_PROPOSITION)),
    verif('proposition', 'statut', parmi(t.statut, STATUTS_PROPOSITION)),
    verif('proposition', 'decision', sql`(${t.statut} = 'en_attente') = (${t.decideLe} IS NULL)`),
    verif('proposition', 'changements', sql`jsonb_typeof(${t.changements}) = 'array'`),
  ],
);

/** Journal des modifications : qui, quand, avant, après, et la proposition d'origine. */
export const modification = pgTable(
  'modification',
  {
    id: idDe<'Modification'>('id').primaryKey(),
    fermeId: fermeId(),
    /** Nom d'entité de T01 ('Serie', 'Emplacement'…). */
    nomTable: text('nom_table', { enum: TABLES_MODIFIABLES }).notNull(),
    /** Id de la ligne visée, sans clé étrangère (elle dépend de la table). */
    ligneId: uuid('ligne_id').notNull(),
    auteurId: auteurId(),
    horodatage: instant('horodatage').notNull(),
    operation: text('operation', { enum: OPERATIONS_LIGNE }).notNull(),
    avant: jsonb('avant').$type<ValeursLigne>(),
    apres: jsonb('apres').$type<ValeursLigne>(),
    propositionId: idDe<'Proposition'>('proposition_id').references(() => proposition.id),
    ...horodatages(),
  },
  (t) => [
    verif('modification', 'nom_table', parmi(t.nomTable, TABLES_MODIFIABLES)),
    verif('modification', 'operation', parmi(t.operation, OPERATIONS_LIGNE)),
    index('modification_ligne_idx').on(t.nomTable, t.ligneId),
    index('modification_proposition_idx').on(t.propositionId),
  ],
);

// ---------------------------------------------------------------------------------------------
// 8. Comptes (T09)
// ---------------------------------------------------------------------------------------------

/**
 * Personne qui se connecte. Pas de mot de passe (Q9) : code à 6 chiffres par e-mail.
 * L'e-mail est stocké en minuscules (l'API normalise, la base refuse le reste) : l'unicité ne se
 * contourne pas par la casse. Publiée vers PowerSync (nom de l'auteur d'une saisie).
 */
export const utilisateur = pgTable(
  'utilisateur',
  {
    id: idDe<'Utilisateur'>('id').primaryKey(),
    email: text('email').notNull().unique(),
    nom: text('nom'),
    ...horodatages(),
  },
  (t) => [verif('utilisateur', 'email_minuscules', sql`${t.email} = lower(${t.email})`)],
);

/**
 * Appartenance d'un utilisateur à une ferme, avec son rôle. Un membre retiré l'est en douceur
 * (`supprime_le`) : il perd l'accès. Publiée : les règles de synchro PowerSync (T10) la lisent.
 */
export const membre = pgTable(
  'membre',
  {
    id: uuid('id').primaryKey(),
    utilisateurId: idDe<'Utilisateur'>('utilisateur_id')
      .notNull()
      .references(() => utilisateur.id),
    fermeId: fermeId(),
    role: text('role', { enum: ROLES_MEMBRE }).notNull(),
    ...horodatages(),
  },
  (t) => [
    verif('membre', 'role', parmi(t.role, ROLES_MEMBRE)),
    unique('membre_utilisateur_ferme_unique').on(t.utilisateurId, t.fermeId),
    index('membre_ferme_idx').on(t.fermeId),
  ],
);

/**
 * Code de connexion à usage unique, stocké haché (jamais en clair). En base plutôt qu'en mémoire :
 * plusieurs processus d'API, redémarrage sans perte, limite de fréquence calculée sur ces lignes.
 * Pas de clé vers `utilisateur` : un code précède la création du compte. NON publiée.
 */
export const codeConnexion = pgTable(
  'code_connexion',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    codeHache: text('code_hache').notNull(),
    expireLe: instant('expire_le').notNull(),
    tentatives: integer('tentatives').notNull().default(0),
    utiliseLe: instant('utilise_le'),
    creeLe: creeLe(),
  },
  (t) => [
    verif('code_connexion', 'tentatives', sql`${t.tentatives} >= 0`),
    index('code_connexion_email_cree_idx').on(t.email, t.creeLe),
  ],
);

/**
 * Jeton de renouvellement (long, opaque), stocké haché : révocable (téléphone perdu). NON publiée.
 */
export const jetonRenouvellement = pgTable(
  'jeton_renouvellement',
  {
    id: uuid('id').primaryKey(),
    utilisateurId: idDe<'Utilisateur'>('utilisateur_id')
      .notNull()
      .references(() => utilisateur.id),
    jetonHache: text('jeton_hache').notNull().unique(),
    expireLe: instant('expire_le').notNull(),
    revoqueLe: instant('revoque_le'),
    creeLe: creeLe(),
  },
  (t) => [index('jeton_renouvellement_utilisateur_idx').on(t.utilisateurId)],
);
