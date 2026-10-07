/**
 * Parcellaire et catalogue de la ferme écrits par le téléphone (T10s : import hors ligne de T14b,
 * écrans de structure) : zone, emplacement, saison, assolement (toujours d'une ferme) ; famille,
 * espèce, variété pour les lignes de la ferme seulement. Contrat : en-tête de
 * structure.integration.test.ts. Même modèle que les séries (serie.ts) et les itinéraires
 * (itineraire.ts).
 *
 * Les règles d'une ligne (structure-lignes.ts) sont rejouées sur la ligne COMPLÈTE (pour un
 * PATCH : ligne existante + colonnes reçues). Ce fichier ajoute ce qui demande la base : le renvoi
 * identique, l'appartenance des références (à la ferme seule, ou à la ferme ou à la bibliothèque
 * commune), ce qui sert encore une ligne qu'on supprime, et l'historique (`modification`, écrit
 * par le serveur seul).
 *
 * Droits : ceux des séries (serie.ts) : tout membre actif de la ferme, gérant ou équipier
 * (`fermesDeLUtilisateur`, relu en base à chaque lot). Un membre retiré ou un invité qui n'a pas
 * encore accepté n'écrit rien ('ferme_interdite').
 *
 * T28s (Q31) : le placement réel est réservé au GÉRANT de la ferme de la ligne (rôle relu dans la
 * transaction du lot) : créer, modifier ou supprimer un bâtiment ; poser, redessiner ou effacer le
 * contour d'une zone ; placer, déplacer ou ranger un emplacement. Un renvoi identique est accepté
 * avant ce contrôle (rien n'est écrit) ; supprimer une zone ou un emplacement placés, ou les
 * modifier sans toucher au placement, reste ouvert à tout membre actif. Les règles du cœur
 * (validerPlacement, validerContour) sont rejouées sur la ligne complète (structure-lignes.ts) ;
 * ici s'ajoute ce que la base seule sait : zone d'un bâtiment de la ferme, non supprimée, sans
 * contour et sans autre bâtiment ; contour refusé sur une zone abritée ; une zone abritée ne se
 * supprime pas tant que son bâtiment n'est pas supprimé ou détaché. L'origine du plan :
 * structure-origine.ts.
 *
 * Bibliothèque commune (ferme_id nul) : en lecture seule. Un PUT à ferme_id nul est refusé par
 * les règles de la ligne ; une telle ligne se comporte, pour un PATCH, exactement comme une ligne
 * inexistante (la requête du verrou ne voit que les fermes de l'utilisateur), et un PUT sur son id
 * est refusé (même id, autres valeurs). Une ligne d'une autre ferme : de même (T10d). Une ligne ne
 * change jamais de ferme.
 *
 * Un PUT qui reprend l'id d'une ligne d'une autre ferme (ou de la bibliothèque) est refusé « cette
 * saisie existe déjà avec d'autres valeurs », comme pour les séries (serie.ts) : la réponse dit
 * seulement qu'un tel identifiant existe (UUID v7 tiré au hasard, rien de sa ferme ni de ses valeurs).
 *
 * Plafonds (structure-lignes.ts) : les règles sont rejouées sur la ligne complète, si bien qu'une
 * ligne existante qui en dépasse un (écrite avant eux, ou directement en base) ne peut plus être
 * modifiée depuis le téléphone tant qu'on ne ramène pas la valeur sous le plafond dans le même envoi.
 *
 * Une plantation retient sa place et son espèce tant qu'elle est en place : sans date d'arrachage,
 * ou arrachage prévu après la date du jour (fuseau de la ferme).
 *
 * Le serveur ne croit jamais le téléphone : chaque identifiant reçu est relu en base (requêtes
 * paramétrées ; tables et colonnes sont des constantes de ce fichier), la ferme est filtrée dans
 * la requête même du verrou (FOR SHARE, FOR UPDATE), et tout se fait dans la transaction du lot
 * (upload.ts), sous le verrou consultatif de chaque ferme touchée : une ligne écrite plus haut
 * dans le même lot se référence (import), et ce qui occupe un emplacement ne change pas pendant
 * qu'on vérifie qu'il est libre (séries et occupations s'écrivent sous le même verrou).
 */
import { validerPlacement, type Id } from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import {
  ID_GLISSE,
  PRECISION_CHANGE_DE_FERME,
  PRECISION_CREEE_SUPPRIMEE,
  PRECISION_EXISTE_DEJA,
  PRECISION_INTROUVABLE,
  PRECISION_SANS_ORIGINE,
  PRECISION_SEUL_LE_GERANT,
  PRECISION_ZONE_A_UN_CONTOUR,
  PRECISION_ZONE_ABRITEE_SUPPRIMEE,
  PRECISION_ZONE_DEJA_ABRITEE,
  refusDuCoeur,
  refusDuPlacement,
} from './messages.ts';
import type { Refus } from './motifs.ts';
import { visibleParLaFerme, type TransactionDb } from './references.ts';
import {
  COLONNES_PLACEMENT_EMPLACEMENT,
  COLONNES_STRUCTURE,
  validerStructure,
  type Ligne,
  type ResultatStructure,
  type TableEcrite,
} from './structure-lignes.ts';

export { estTableStructure, TABLES_STRUCTURE } from './structure-lignes.ts';

const NOM_ENTITE: Readonly<Record<TableEcrite, 'Zone' | 'Emplacement' | 'Famille' | 'Espece' | 'Variete' | 'Saison' | 'Assolement' | 'Batiment'>> = {
  zone: 'Zone',
  emplacement: 'Emplacement',
  famille: 'Famille',
  espece: 'Espece',
  variete: 'Variete',
  saison: 'Saison',
  assolement: 'Assolement',
  batiment: 'Batiment',
};

/** Statuts d'une série qui occupe encore sa place et sa culture (décision du chef). */
const STATUTS_ACTIFS = sql`('prevue', 'en_cours')`;
/** Profondeur au plus de l'arbre des zones parcouru pour refuser une boucle (garde-fou). */
const PROFONDEUR_MAX_ZONES = 100;

/** Écriture reçue sur une table de structure : id de l'écriture PowerSync et colonnes (sans confiance). */
export interface EcritureStructureRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly table: TableEcrite;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

/** Refus d'une ligne que les règles de la ligne n'acceptent pas : règle du placement (T28s) ou du cœur. */
function refusDeLigne(v: Extract<ResultatStructure, { ok: false }>, fermeId: string | null): Refus {
  return v.placement === undefined ? refusDuCoeur(v.erreur, fermeId) : refusDuPlacement(v.placement, fermeId);
}

/** Deux valeurs de placement (nombres, contours) égales, quelle que soit leur provenance (reçue, ou to_jsonb de Postgres). */
const memeValeur = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * La ligne `l` (validée) touche-t-elle au placement réel par rapport à `avant` (null : création) ?
 * Q31 : réservé au gérant. Un bâtiment est toujours placé : le créer, le modifier ou le supprimer
 * touche au placement. Une zone : son contour change (créée avec un contour, contour posé, redessiné
 * ou effacé). Un emplacement : sa position ou son orientation change. Supprimer une zone ou un
 * emplacement placés, ou les modifier sans toucher à leur placement, reste ouvert à tout membre (T10s).
 */
function touchePlacement(table: TableEcrite, l: Ligne, avant: Ligne | null): boolean {
  switch (table) {
    case 'batiment':
      return true;
    case 'zone':
      return !memeValeur(l.contour, avant?.contour);
    case 'emplacement':
      return COLONNES_PLACEMENT_EMPLACEMENT.some((c) => !memeValeur(l[c], avant?.[c]));
    default:
      return false;
  }
}

/** La ligne `l` (validée) est-elle un placement en vigueur (bâtiment, contour, emplacement placé, non supprimés) ? */
function estPlacee(table: TableEcrite, l: Ligne): boolean {
  if (l.supprime_le !== null) return false;
  switch (table) {
    case 'batiment':
      return true;
    case 'zone':
      return l.contour !== null;
    case 'emplacement':
      return l.placement_x_m !== null;
    default:
      return false;
  }
}

/**
 * Droits et origine du placement : refus (Q31) si `l` touche au placement et que l'auteur n'est
 * pas gérant de sa ferme ; puis (décision du chef, T28s) aucun placement tant que l'origine du plan
 * de la ferme est nulle (relue dans la transaction : une origine posée plus haut dans le lot compte).
 * Supprimer, effacer ou ranger reste permis sans origine.
 */
async function droitsDuPlacement(
  tx: TransactionDb,
  table: TableEcrite,
  l: Ligne,
  avant: Ligne | null,
  fermeId: string,
  gerees: ReadonlySet<string>,
): Promise<Refus | null> {
  if (!touchePlacement(table, l, avant)) return null;
  if (!gerees.has(fermeId)) return invalide(PRECISION_SEUL_LE_GERANT, fermeId);
  if (!estPlacee(table, l)) return null;
  const sansOrigine = await existe(tx, sql`SELECT 1 FROM ferme f WHERE f.id = ${fermeId}::uuid AND f.origine_plan IS NULL`);
  return sansOrigine ? invalide(PRECISION_SANS_ORIGINE, fermeId) : null;
}

/** Colonnes de `table`, préfixées par `alias`, séparées par des virgules. */
function colonnes(table: TableEcrite, alias: string): SQL {
  return sql.join(
    COLONNES_STRUCTURE[table].map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

/** `jsonb_populate_record` de `ligne` sur le type ligne de `table`, sous l'alias r. */
function enregistrement(table: TableEcrite, ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(ligne)}::jsonb) r`;
}

/**
 * La ligne `id` existe-t-elle avec exactement ces valeurs (horodatages de création et de
 * modification ignorés) ? null si elle n'existe pas. Sans filtre de ferme : une ligne d'une autre
 * ferme ou de la bibliothèque n'est jamais identique (ferme_id diffère), et rien de ses valeurs
 * n'est rendu.
 */
async function identique(tx: TransactionDb, table: TableEcrite, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes(table, 'r')}) IS NOT DISTINCT FROM (${colonnes(table, 't')}) AS identique
        FROM ${sql.identifier(table)} t, ${enregistrement(table, ligne)}
        WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

/** La ligne `id` existe-t-elle dans la ferme `fermeId` ? */
async function deLaFerme(tx: TransactionDb, table: TableEcrite, id: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid) AS existe`,
  );
  return r.rows[0]?.existe === true;
}

/**
 * Ligne `table` d'identifiant `id`, visible par la ferme (la sienne ; ou la bibliothèque commune
 * si `bibliotheque`), verrouillée (FOR SHARE) ; undefined si elle n'existe pas OU si elle est
 * d'une autre ferme (T10d), même une autre ferme du même utilisateur.
 */
async function reference(
  tx: TransactionDb,
  table: 'zone' | 'emplacement' | 'famille' | 'espece' | 'saison',
  id: string,
  fermeId: string,
  bibliotheque: boolean,
): Promise<{ readonly supprimee: boolean; readonly famille_id: string | null } | undefined> {
  const famille = table === 'espece' ? sql`famille_id::text` : sql`NULL::text`;
  const r = await tx.execute<{ supprimee: boolean; famille_id: string | null }>(
    sql`SELECT supprime_le IS NOT NULL AS supprimee, ${famille} AS famille_id
        FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ${visibleParLaFerme(fermeId, bibliotheque)} FOR SHARE`,
  );
  return r.rows[0];
}

/** Référence obligatoirement active : null si elle l'est, sinon le refus (« <libellé> introuvable » ou « … supprimé(e) »). */
async function active(
  tx: TransactionDb,
  table: 'zone' | 'emplacement' | 'famille' | 'espece' | 'saison',
  id: string,
  fermeId: string,
  bibliotheque: boolean,
  libelle: string,
  supprimee: string,
): Promise<Refus | null> {
  const l = await reference(tx, table, id, fermeId, bibliotheque);
  if (l === undefined) return invalide(`${libelle} introuvable`, fermeId);
  return l.supprimee ? invalide(supprimee, fermeId) : null;
}

/** Une requête EXISTS paramétrée (constantes de ce fichier et paramètres) : vrai si elle trouve. */
async function existe(tx: TransactionDb, requete: SQL): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (${requete}) AS existe`);
  return r.rows[0]?.existe === true;
}

/** `parente` est-elle `zoneId` ou l'une de ses sous-zones (dans la ferme) ? Une zone ne se range pas dans sa propre descendance. */
async function boucleDeZones(tx: TransactionDb, zoneId: string, parente: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ boucle: boolean }>(
    sql`WITH RECURSIVE ancetres(id, profondeur) AS (
          SELECT ${parente}::uuid, 0
          UNION ALL
          SELECT z.zone_parente_id, a.profondeur + 1 FROM zone z JOIN ancetres a ON z.id = a.id
          WHERE z.ferme_id = ${fermeId}::uuid AND z.zone_parente_id IS NOT NULL AND a.profondeur < ${PROFONDEUR_MAX_ZONES}
        )
        SELECT EXISTS (SELECT 1 FROM ancetres WHERE id = ${zoneId}::uuid) AS boucle`,
  );
  return r.rows[0]?.boucle === true;
}

/** Séries prévues ou en cours, non supprimées, de la ferme, dont `colonne` vaut `id`. */
const seriesActives = (colonne: 'espece_id' | 'variete_id' | 'saison_id', id: string, fermeId: string): SQL =>
  sql`SELECT 1 FROM serie s WHERE s.${sql.identifier(colonne)} = ${id}::uuid AND s.ferme_id = ${fermeId}::uuid
        AND s.supprime_le IS NULL AND s.statut IN ${STATUTS_ACTIFS}`;

/**
 * Plantation `p` encore en place : sans date d'arrachage, ou arrachage prévu après la date du jour
 * (relecture T10s), le jour étant celui du fuseau de la ferme à l'heure du serveur (`maintenant`).
 */
const enPlace = (fermeId: string, maintenant: Date): SQL =>
  sql`(p.date_arrachage IS NULL OR p.date_arrachage > (${maintenant}::timestamptz AT TIME ZONE (SELECT f.fuseau_horaire FROM ferme f WHERE f.id = ${fermeId}::uuid))::date)`;

/** Plantations en place, non supprimées, de la ferme, dont `colonne` vaut `id`. */
const plantationsEnPlace = (colonne: 'espece_id' | 'variete_id', id: string, fermeId: string, maintenant: Date): SQL =>
  sql`SELECT 1 FROM plantation p WHERE p.${sql.identifier(colonne)} = ${id}::uuid AND p.ferme_id = ${fermeId}::uuid
        AND p.supprime_le IS NULL AND ${enPlace(fermeId, maintenant)}`;

/** Un bâtiment non supprimé de la ferme abrite-t-il la zone `zoneId` ? */
function abritee(tx: TransactionDb, zoneId: string, fermeId: string): Promise<boolean> {
  return existe(tx, sql`SELECT 1 FROM batiment b WHERE b.zone_id = ${zoneId}::uuid AND b.ferme_id = ${fermeId}::uuid AND b.supprime_le IS NULL`);
}

/**
 * Zone abritée par le bâtiment `l` (T28s, Q31) : de la ferme, non supprimée (verrouillée FOR SHARE,
 * comme le fait le déclencheur de la base avant de lire son contour), sans contour, et pas déjà
 * abritée par un autre bâtiment non supprimé. null si tout va bien.
 */
async function verifierZoneAbritee(tx: TransactionDb, zoneId: string, batimentId: string, fermeId: string): Promise<Refus | null> {
  const r = await tx.execute<{ supprimee: boolean; a_contour: boolean }>(
    sql`SELECT supprime_le IS NOT NULL AS supprimee, contour IS NOT NULL AS a_contour
        FROM zone WHERE id = ${zoneId}::uuid AND ${visibleParLaFerme(fermeId, false)} FOR SHARE`,
  );
  const zone = r.rows[0];
  if (zone === undefined) return invalide('zone introuvable', fermeId);
  if (zone.supprimee) return invalide('zone supprimée', fermeId);
  if (zone.a_contour) return invalide(PRECISION_ZONE_A_UN_CONTOUR, fermeId);
  const autre = await existe(
    tx,
    sql`SELECT 1 FROM batiment b WHERE b.zone_id = ${zoneId}::uuid AND b.ferme_id = ${fermeId}::uuid AND b.supprime_le IS NULL AND b.id <> ${batimentId}::uuid`,
  );
  return autre ? invalide(PRECISION_ZONE_DEJA_ABRITEE, fermeId) : null;
}

/**
 * Suppression douce (décisions du chef) : refusée tant que la ligne sert encore. null si elle est
 * libre, sinon le refus qui dit pourquoi.
 */
async function verifierLibre(tx: TransactionDb, table: TableEcrite, id: string, fermeId: string, maintenant: Date): Promise<Refus | null> {
  switch (table) {
    case 'emplacement': {
      // Occupation non supprimée d'une série active ou d'une plantation en place ; une occupation
      // supprimée plus haut dans le même lot ne compte plus.
      const occupe = await existe(
        tx,
        sql`SELECT 1 FROM occupation o
            LEFT JOIN serie s ON s.id = o.serie_id AND s.ferme_id = o.ferme_id
            LEFT JOIN plantation p ON p.id = o.plantation_id AND p.ferme_id = o.ferme_id
            WHERE o.emplacement_id = ${id}::uuid AND o.ferme_id = ${fermeId}::uuid AND o.supprime_le IS NULL
              AND ((s.id IS NOT NULL AND s.supprime_le IS NULL AND s.statut IN ${STATUTS_ACTIFS})
                OR (p.id IS NOT NULL AND p.supprime_le IS NULL AND ${enPlace(fermeId, maintenant)}))`,
      );
      return occupe ? invalide('cet emplacement est occupé par une culture prévue, en cours ou en place : libérez-le avant de le supprimer', fermeId) : null;
    }
    case 'zone': {
      // T28s (relecture T28a n°2) : une zone abritée par un bâtiment non supprimé ne se supprime pas ;
      // un bâtiment supprimé ou détaché plus haut dans le même lot ne l'abrite plus.
      if (await abritee(tx, id, fermeId)) return invalide(PRECISION_ZONE_ABRITEE_SUPPRIMEE, fermeId);
      const pleine =
        (await existe(tx, sql`SELECT 1 FROM emplacement e WHERE e.zone_id = ${id}::uuid AND e.ferme_id = ${fermeId}::uuid AND e.supprime_le IS NULL`)) ||
        (await existe(tx, sql`SELECT 1 FROM zone z WHERE z.zone_parente_id = ${id}::uuid AND z.ferme_id = ${fermeId}::uuid AND z.supprime_le IS NULL`));
      return pleine ? invalide('cette zone contient encore des emplacements ou des sous-zones : supprimez-les d’abord', fermeId) : null;
    }
    case 'espece': {
      const utilisee = (await existe(tx, seriesActives('espece_id', id, fermeId))) || (await existe(tx, plantationsEnPlace('espece_id', id, fermeId, maintenant)));
      return utilisee ? invalide('cette espèce est cultivée dans une série prévue ou en cours, ou une plantation en place', fermeId) : null;
    }
    case 'variete': {
      const utilisee = (await existe(tx, seriesActives('variete_id', id, fermeId))) || (await existe(tx, plantationsEnPlace('variete_id', id, fermeId, maintenant)));
      return utilisee ? invalide('cette variété est cultivée dans une série prévue ou en cours, ou une plantation en place', fermeId) : null;
    }
    case 'famille': {
      const utilisee = await existe(tx, sql`SELECT 1 FROM espece e WHERE e.famille_id = ${id}::uuid AND e.ferme_id = ${fermeId}::uuid AND e.supprime_le IS NULL`);
      return utilisee ? invalide('cette famille contient encore des espèces de la ferme : supprimez-les ou rangez-les ailleurs d’abord', fermeId) : null;
    }
    case 'saison': {
      const utilisee = await existe(tx, seriesActives('saison_id', id, fermeId));
      return utilisee ? invalide('cette saison contient encore des séries prévues ou en cours', fermeId) : null;
    }
    case 'assolement':
    case 'batiment':
      // Supprimer le bâtiment d'une zone : la zone et ses planches restent, la zone redevient « pas placée ».
      return null;
  }
}

/**
 * Références de la ligne validée, relues en base : à la création, à un rétablissement, ou quand
 * la colonne change (une référence supprimée depuis ne bloque pas une modification sans rapport).
 * Ensuite, une suppression douce exige une ligne libre. null si tout va bien.
 */
async function verifierEnBase(tx: TransactionDb, table: TableEcrite, l: Ligne, avant: Ligne | null, maintenant: Date): Promise<Refus | null> {
  const f = String(l.ferme_id);
  const retablie = avant?.supprime_le != null && l.supprime_le === null;
  const change = (c: string): boolean => avant === null || retablie || JSON.stringify(l[c] ?? null) !== JSON.stringify(avant[c] ?? null);
  const valeur = (c: string): string | null => {
    const x = l[c];
    return typeof x === 'string' ? x : null;
  };
  const verifier = async (
    c: string,
    cible: 'zone' | 'emplacement' | 'famille' | 'espece' | 'saison',
    bibliotheque: boolean,
    libelle: string,
    supprimee: string,
  ): Promise<Refus | null> => {
    const id = valeur(c);
    return id === null || !change(c) ? null : active(tx, cible, id, f, bibliotheque, libelle, supprimee);
  };

  let refus: Refus | null = null;
  switch (table) {
    case 'zone': {
      refus = await verifier('zone_parente_id', 'zone', false, 'zone parente', 'zone parente supprimée');
      const parente = valeur('zone_parente_id');
      if (refus === null && avant !== null && parente !== null && change('zone_parente_id') && (await boucleDeZones(tx, String(l.id), parente, f))) {
        refus = invalide('une zone ne se range pas dans l’une de ses sous-zones', f);
      }
      if (refus === null && l.contour !== null && change('contour')) {
        // T28s : la règle complète du cœur, avec ce que la base seule sait (un bâtiment abrite la zone).
        const v = validerPlacement({ table: 'zone', ligne: l, abritee: await abritee(tx, String(l.id), f) });
        if (!v.ok) refus = refusDuPlacement(v.erreur, f);
      }
      break;
    }
    case 'batiment': {
      const zone = valeur('zone_id');
      if (zone !== null && l.supprime_le === null && change('zone_id')) refus = await verifierZoneAbritee(tx, zone, String(l.id), f);
      break;
    }
    case 'emplacement': {
      refus = await verifier('zone_id', 'zone', false, 'zone', 'zone supprimée');
      const remplace = Array.isArray(l.remplace) ? (l.remplace as string[]) : [];
      if (refus === null && remplace.length > 0 && change('remplace')) {
        // Un emplacement remplacé est souvent supprimé (planches redessinées) : seule son appartenance à la ferme compte.
        const r = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM (
                SELECT id FROM emplacement WHERE id = ANY(${sql.param(remplace)}::uuid[]) AND ferme_id = ${f}::uuid FOR SHARE
              ) t`,
        );
        if (r.rows[0]?.n !== remplace.length) refus = invalide('emplacement remplacé introuvable', f);
      }
      break;
    }
    case 'espece':
      refus = await verifier('famille_id', 'famille', true, 'famille', 'famille supprimée');
      break;
    case 'variete':
      refus = await verifier('espece_id', 'espece', true, 'espèce', 'espèce supprimée');
      break;
    case 'assolement': {
      refus =
        (await verifier('saison_id', 'saison', false, 'saison', 'saison supprimée')) ??
        (await verifier('zone_id', 'zone', false, 'zone', 'zone supprimée')) ??
        (await verifier('emplacement_id', 'emplacement', false, 'emplacement', 'emplacement supprimé')) ??
        (await verifier('famille_id', 'famille', true, 'famille', 'famille supprimée'));
      const espece = valeur('espece_id');
      if (refus === null && espece !== null && (change('espece_id') || change('famille_id'))) {
        const e = await reference(tx, 'espece', espece, f, true);
        if (e === undefined) refus = invalide('espèce introuvable', f);
        else if (e.supprimee) refus = invalide('espèce supprimée', f);
        else if (e.famille_id !== l.famille_id) refus = invalide('l’espèce n’est pas de cette famille', f);
      }
      break;
    }
    case 'famille':
    case 'saison':
      break;
  }
  if (refus !== null) return refus;
  const suppression = avant !== null && avant.supprime_le == null && l.supprime_le !== null;
  return suppression ? verifierLibre(tx, table, String(l.id), f, maintenant) : null;
}

/** Ligne d'historique de `ligneId` (après écriture) ; `avant` : texte JSON de la ligne d'avant. */
async function historiser(
  tx: TransactionDb,
  ctx: Contexte,
  table: TableEcrite,
  ligneId: string,
  fermeId: string,
  auteurId: Id<'Utilisateur'>,
  maintenant: Date,
  operation: 'creation' | 'modification' | 'suppression',
  avant: string | null,
): Promise<void> {
  await tx.insert(modification).values({
    id: ctx.nouvelId(),
    fermeId: fermeId as Id<'Ferme'>,
    nomTable: NOM_ENTITE[table],
    ligneId,
    auteurId,
    horodatage: maintenant,
    operation,
    // Texte rendu par Postgres, relu tel quel : aucune valeur ne passe par un nombre JavaScript.
    avant: avant === null ? null : sql`${avant}::jsonb`,
    // La ligne écrite, telle que Postgres la rend en JSON (colonnes snake_case).
    apres: sql`(SELECT to_jsonb(l) FROM ${sql.identifier(table)} l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

/** INSERT de la ligne validée, depuis l'objet JSON aux colonnes de la table. true si écrite. */
async function inserer(tx: TransactionDb, table: TableEcrite, ligne: Ligne, maintenant: Date): Promise<boolean> {
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO ${sql.identifier(table)} (${sql.join(
      COLONNES_STRUCTURE[table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes(table, 'r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(table, ligne)}
        ON CONFLICT (id) DO NOTHING
        RETURNING id::text AS id`,
  );
  return ecrite.rows.length > 0;
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureStructureRecue,
  fermeDonnee: string | null,
  gerees: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  const v = validerStructure(e.table, { ...e.donnees, id: e.id });
  if (!v.ok) return refusDeLigne(v, fermeDonnee);
  const ligne = v.ligne;
  const id = String(ligne.id);
  // ferme_id lu par les règles de la ligne (UUID non nul), déjà vérifié parmi les fermes de l'utilisateur (upload.ts).
  const fermeId = String(ligne.ferme_id);
  // Comme une série (T10e) : une ligne se crée active.
  if (ligne.supprime_le !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, fermeId);

  const existante = await identique(tx, e.table, ligne, id);
  if (existante !== null) {
    // Même id, autres valeurs, ou ligne d'une autre ferme ou de la bibliothèque : refusé. Le refus
    // ne porte la ferme que si la ligne existante est la sienne (rien sur une autre ferme).
    if (existante) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, e.table, id, fermeId)) ? fermeId : null);
  }

  const maintenant = ctx.maintenant();
  const refus = (await droitsDuPlacement(tx, e.table, ligne, null, fermeId, gerees)) ?? (await verifierEnBase(tx, e.table, ligne, null, maintenant));
  if (refus !== null) return refus;

  if (!(await inserer(tx, e.table, ligne, maintenant))) {
    // Écrite entre-temps par un envoi concurrent : même règle que le renvoi.
    if ((await identique(tx, e.table, ligne, id)) === true) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, e.table, id, fermeId)) ? fermeId : null);
  }
  await historiser(tx, ctx, e.table, id, fermeId, auteurId, maintenant, 'creation', null);
  return null;
}

/**
 * PATCH : modification d'une ligne de la ferme (suppression douce et rétablissement compris).
 * Ligne introuvable, d'une autre ferme ou de la bibliothèque : même refus, sans ferme (T10d). Un
 * PATCH qui ne change rien est accepté sans rien écrire (renvoi après une réponse perdue).
 */
async function modifier(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureStructureRecue,
  fermes: ReadonlySet<string>,
  gerees: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : une ligne d'une autre ferme ou de la bibliothèque (ferme_id
  // nul) n'est ni lue ni verrouillée.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM ${sql.identifier(e.table)} t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[])
        FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);

  // Une ligne ne change pas de ferme (ni vers une autre, ni vers la bibliothèque).
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) {
    if (estUuid(fermeDemandee) && !fermes.has(fermeDemandee.toLowerCase())) return { motif: 'ferme_interdite', fermeId: fermeDemandee.toLowerCase() };
    return invalide(PRECISION_CHANGE_DE_FERME, fermeId);
  }

  // Seules les colonnes écrites par le téléphone sont reprises de la ligne existante (les autres
  // restent en base, intactes), et une colonne inconnue REÇUE est toujours refusée. Le contour
  // existant (jsonb, rendu en tableau) est remis en texte JSON, la seule forme qu'un contour reçu
  // peut avoir (structure-lignes.ts) : un tableau forgé dans les données reste refusé.
  const colonnesEcrites = new Set(COLONNES_STRUCTURE[e.table]);
  const base = Object.fromEntries(
    Object.entries(avant)
      .filter(([c]) => colonnesEcrites.has(c))
      .map(([c, x]) => [c, c === 'contour' && x !== null ? JSON.stringify(x) : x]),
  );
  const v = validerStructure(e.table, { ...base, ...e.donnees, id: avant.id });
  if (!v.ok) return refusDeLigne(v, fermeId);
  const ligne = v.ligne;
  const id = String(ligne.id);

  if ((await identique(tx, e.table, ligne, id)) === true) return null;

  const maintenant = ctx.maintenant();
  const refus = (await droitsDuPlacement(tx, e.table, ligne, avant, fermeId, gerees)) ?? (await verifierEnBase(tx, e.table, ligne, avant, maintenant));
  if (refus !== null) return refus;

  await tx.execute(
    sql`UPDATE ${sql.identifier(e.table)} t SET (${sql.join(
      COLONNES_STRUCTURE[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)})
        WHERE t.id = ${id}::uuid`,
  );
  const suppression = avant.supprime_le == null && ligne.supprime_le !== null;
  await historiser(tx, ctx, e.table, id, fermeId, auteurId, maintenant, suppression ? 'suppression' : 'modification', existante.texte);
  return null;
}

/**
 * Écriture sur une table de structure (PUT ou PATCH), dans la transaction du lot : null si
 * acceptée, sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi
 * celles de l'utilisateur pour un PUT). `gerees` : fermes dont l'auteur est gérant actif, relues
 * en base pour ce lot (T28s, Q31 : seul le gérant place).
 */
export async function ecrireStructure(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureStructureRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  gerees: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  // Un id glissé dans les données : colonne inconnue (l'id est celui de l'écriture).
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, gerees, auteurId);
  return creer(tx, ctx, e, fermeDonnee, gerees, auteurId);
}
