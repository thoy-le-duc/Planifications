/**
 * Séries et occupations écrites par le téléphone (T10e, écran de T12). Contrat : en-tête de
 * serie.integration.test.ts.
 *
 * Les règles d'une ligne sont celles du cœur (`validerSerie`, `validerOccupation`, @planif/core),
 * rejouées sur la ligne COMPLÈTE (pour un PATCH : ligne existante + colonnes reçues) ; les dates
 * prévues d'une série valent celles que le cœur calcule (principe 2). Ce fichier ajoute ce qui
 * demande la base : le renvoi identique, l'appartenance des références à la ferme, la cohérence
 * espèce ↔ variété ↔ itinéraire, la cohérence série ↔ occupations en fin de lot, et l'historique
 * (`modification`, écrit par le serveur seul).
 *
 * Le serveur ne croit jamais le téléphone : chaque identifiant reçu est relu en base (requêtes
 * paramétrées ; tables et colonnes sont des constantes de ce fichier), la ferme est filtrée dans
 * la requête même du verrou (T10d), et une ligne d'une autre ferme se comporte exactement comme
 * une ligne inexistante.
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou de chaque ferme touchée :
 * deux lots sur une même ferme passent l'un après l'autre, le second voit les écritures du premier.
 * Les lignes sont écrites depuis un objet JSON aux colonnes de la table
 * (`jsonb_populate_record`) : les types sont ceux de Postgres, et la comparaison d'un renvoi se
 * fait en SQL, colonne par colonne (jsonb, numeric, timestamptz comparés par valeur).
 */
import { validerOccupation, validerSerie, type Id, type Occupation, type Serie } from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import type { Refus } from './motifs.ts';
import { visibleParLaFerme, type TransactionDb } from './references.ts';

/** Tables de la planification ouvertes au téléphone (T10e). */
export const TABLES_SERIE = new Set(['serie', 'occupation']);

type TableSerie = 'serie' | 'occupation';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES: Readonly<Record<TableSerie, readonly string[]>> = {
  serie: [
    'id',
    'ferme_id',
    'saison_id',
    'espece_id',
    'variete_id',
    'itineraire_id',
    'parametres',
    'ancre_type',
    'ancre_date',
    'prevu_semis_pepiniere',
    'prevu_mise_en_place',
    'prevu_debut_recolte',
    'prevu_fin_recolte',
    'longueur_m',
    'nombre_plants',
    'statut',
    'rotation_acceptee',
    'supprime_le',
  ],
  occupation: [
    'id',
    'ferme_id',
    'emplacement_id',
    'serie_id',
    'plantation_id',
    'evenement_id',
    'longueur_m',
    'nombre_places',
    'position_m',
    'prevu_du',
    'prevu_au',
    'reel_du',
    'reel_au',
    'supprime_le',
  ],
};

const NOM_ENTITE: Readonly<Record<TableSerie, 'Serie' | 'Occupation'>> = { serie: 'Serie', occupation: 'Occupation' };

/** Écriture reçue sur `serie` ou `occupation` : id de l'écriture PowerSync et colonnes (sans confiance). */
export interface EcritureSerieRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly table: TableSerie;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

/**
 * Séries touchées par le lot, pour la vérification de fin de lot : série → index de la dernière
 * écriture qui l'a touchée (celle qui porte le refus).
 */
export type SeriesTouchees = Map<string, number>;

type Ligne = Readonly<Record<string, unknown>>;

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

const estTableSerie = (table: string): table is TableSerie => TABLES_SERIE.has(table);

/** Colonnes de `table`, préfixées par `alias`, séparées par des virgules. */
function colonnes(table: TableSerie, alias: string): SQL {
  return sql.join(
    COLONNES[table].map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

const iso = (instant: number | null): string | null => (instant === null ? null : new Date(instant).toISOString());

/** Ligne `serie` aux colonnes de Postgres, depuis la série validée par le cœur. */
function ligneSerie(s: Serie): Ligne {
  const r = s.rotationAcceptee;
  return {
    id: s.id,
    ferme_id: s.fermeId,
    saison_id: s.saisonId,
    espece_id: s.especeId,
    variete_id: s.varieteId,
    itineraire_id: s.itineraireId,
    parametres: s.parametres,
    ancre_type: s.ancre.type,
    ancre_date: s.ancre.date,
    prevu_semis_pepiniere: s.datesPrevues.semisPepiniere ?? null,
    prevu_mise_en_place: s.datesPrevues.miseEnPlace,
    prevu_debut_recolte: s.datesPrevues.debutRecolte,
    prevu_fin_recolte: s.datesPrevues.finRecolte,
    longueur_m: s.taille.unite === 'longueur' ? s.taille.longueurM : null,
    nombre_plants: s.taille.unite === 'plants' ? s.taille.nombrePlants : null,
    statut: s.statut,
    rotation_acceptee: r === undefined ? null : { famille: r.familleId, delai_ans: r.delaiAns, le: iso(r.le) },
    supprime_le: iso(s.supprimeLe),
  };
}

/** Ligne `occupation` aux colonnes de Postgres, depuis l'occupation validée par le cœur. */
function ligneOccupation(o: Occupation): Ligne {
  return {
    id: o.id,
    ferme_id: o.fermeId,
    emplacement_id: o.emplacementId,
    serie_id: o.occupant.sorte === 'serie' ? o.occupant.serieId : null,
    plantation_id: null,
    evenement_id: null,
    longueur_m: o.place.unite === 'longueur' ? o.place.longueurM : null,
    nombre_places: o.place.unite === 'places' ? o.place.nombrePlaces : null,
    position_m: o.positionM,
    prevu_du: o.prevuDu,
    prevu_au: o.prevuAu,
    reel_du: o.reel?.du ?? null,
    reel_au: o.reel?.au ?? null,
    supprime_le: iso(o.supprimeLe),
  };
}

/** `jsonb_populate_record` de `ligne` sur le type ligne de `table`, sous l'alias r. */
function enregistrement(table: TableSerie, ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(ligne)}::jsonb) r`;
}

/**
 * La ligne `id` existe-t-elle avec exactement ces valeurs (horodatages de création et de
 * modification ignorés) ? null si elle n'existe pas. Sans filtre de ferme : une ligne d'une autre
 * ferme n'est jamais identique (ferme_id diffère), et rien de ses valeurs n'est rendu.
 */
async function identique(tx: TransactionDb, table: TableSerie, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes(table, 'r')}) IS NOT DISTINCT FROM (${colonnes(table, 't')}) AS identique
        FROM ${sql.identifier(table)} t, ${enregistrement(table, ligne)}
        WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

/**
 * Ligne `table` d'identifiant `id`, visible par la ferme (la sienne ; ou la bibliothèque commune
 * si `bibliotheque`), verrouillée (FOR SHARE) ; undefined si elle n'existe pas OU si elle est
 * d'une autre ferme (T10d). `extra` : colonnes lues en plus (constantes de ce fichier).
 */
async function reference(
  tx: TransactionDb,
  table: 'saison' | 'espece' | 'variete' | 'itineraire' | 'emplacement' | 'famille',
  id: string,
  fermeId: string,
  bibliotheque: boolean,
  extra: SQL = sql``,
): Promise<{ readonly supprimee: boolean; readonly espece_id?: string } | undefined> {
  const r = await tx.execute<{ supprimee: boolean; espece_id?: string }>(
    sql`SELECT supprime_le IS NOT NULL AS supprimee ${extra}
        FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ${visibleParLaFerme(fermeId, bibliotheque)} FOR SHARE`,
  );
  return r.rows[0];
}

/** Ce qu'un PATCH change dans les références d'une série (tout, pour une création). */
interface Changements {
  readonly saison: boolean;
  readonly culture: boolean;
  /**
   * La série est créée ou change d'itinéraire : l'itinéraire doit être actif. Sinon (décision 9
   * du chef, T23), un itinéraire supprimé depuis ne bloque pas la série, qui garde son instantané.
   */
  readonly itineraire: boolean;
  readonly rotation: boolean;
}

/**
 * Références d'une série : saison de la ferme ; espèce, variété et itinéraire de la ferme ou de
 * la bibliothèque, non supprimés, la variété et l'itinéraire de l'espèce de la série (décision 5
 * du chef) ; famille de la décision de rotation visible par la ferme.
 */
async function verifierReferencesSerie(tx: TransactionDb, s: Serie, c: Changements): Promise<Refus | null> {
  const f = s.fermeId;
  if (c.saison) {
    const saison = await reference(tx, 'saison', s.saisonId, f, false);
    if (saison === undefined) return invalide('saison introuvable', f);
    if (saison.supprimee) return invalide('saison supprimée', f);
  }
  if (c.culture) {
    const espece = await reference(tx, 'espece', s.especeId, f, true);
    if (espece === undefined) return invalide('espèce introuvable', f);
    if (espece.supprimee) return invalide('espèce supprimée', f);
    if (s.varieteId !== null) {
      const variete = await reference(tx, 'variete', s.varieteId, f, true, sql`, espece_id::text AS espece_id`);
      if (variete === undefined) return invalide('variété introuvable', f);
      if (variete.supprimee) return invalide('variété supprimée', f);
      if (variete.espece_id !== s.especeId) return invalide("variété d'une autre espèce que celle de la série", f);
    }
    const itineraire = await reference(tx, 'itineraire', s.itineraireId, f, true, sql`, espece_id::text AS espece_id`);
    if (itineraire === undefined) return invalide('itinéraire introuvable', f);
    if (itineraire.supprimee && c.itineraire) return invalide('itinéraire supprimé', f);
    if (itineraire.espece_id !== s.especeId) return invalide("itinéraire d'une autre espèce que celle de la série", f);
  }
  if (c.rotation && s.rotationAcceptee !== undefined) {
    const famille = await reference(tx, 'famille', s.rotationAcceptee.familleId, f, true);
    if (famille === undefined) return invalide('famille de la décision de rotation introuvable', f);
  }
  return null;
}

/**
 * Série `serieId` de la ferme, verrouillée (FOR SHARE), validée par le cœur ; ou le refus
 * (introuvable ou d'une autre ferme : même réponse).
 */
async function serieDeLaFerme(tx: TransactionDb, serieId: string, fermeId: string): Promise<{ readonly serie: Serie } | { readonly refus: Refus }> {
  const r = await tx.execute<{ l: Ligne }>(
    sql`SELECT to_jsonb(s) AS l FROM serie s WHERE s.id = ${serieId}::uuid AND s.ferme_id = ${fermeId}::uuid FOR SHARE`,
  );
  const ligne = r.rows[0]?.l;
  if (ligne === undefined) return { refus: invalide('série introuvable', fermeId) };
  const lecture = validerSerie(ligne);
  if (!lecture.ok) return { refus: invalide(`série illisible : ${lecture.erreur.message}`, fermeId) };
  return { serie: lecture.valeur };
}

/** Ligne validée par le cœur (colonnes de Postgres) et la série qu'elle touche ; ou le refus. */
type Validee = { readonly ligne: Ligne; readonly valeur: Serie | Occupation; readonly serieId: string } | { readonly refus: Refus };

/**
 * Règles du cœur sur la ligne complète. Une occupation est validée avec sa série telle qu'elle est
 * à ce point du lot, sans ses dates : celles-ci se vérifient en fin de lot (decision 1 du chef),
 * une fois la série et toutes ses occupations écrites, quel que soit leur ordre dans le lot.
 */
async function valider(tx: TransactionDb, table: TableSerie, entree: Ligne, fermeId: string): Promise<Validee> {
  if (table === 'serie') {
    const lecture = validerSerie(entree);
    if (!lecture.ok) return { refus: invalide(lecture.erreur.message, fermeId) };
    return { ligne: ligneSerie(lecture.valeur), valeur: lecture.valeur, serieId: lecture.valeur.id };
  }
  const serieId = entree.serie_id;
  if (!estUuid(serieId)) return { refus: invalide('série : identifiant manquant ou invalide', fermeId) };
  const serie = await serieDeLaFerme(tx, serieId.toLowerCase(), fermeId);
  if ('refus' in serie) return serie;
  const lecture = validerOccupation(entree, serie.serie, { datesDeLaSerie: false });
  if (!lecture.ok) return { refus: invalide(lecture.erreur.message, fermeId) };
  return { ligne: ligneOccupation(lecture.valeur), valeur: lecture.valeur, serieId: serie.serie.id };
}

/** Ligne d'historique de `ligneId` (après écriture) ; `avant` : texte JSON de la ligne d'avant. */
async function historiser(
  tx: TransactionDb,
  ctx: Contexte,
  table: TableSerie,
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
    ligneId: ligneId as Id<'Serie'>,
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

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureSerieRecue,
  fermeDonnee: string | null,
  auteurId: Id<'Utilisateur'>,
  touchees: SeriesTouchees,
  index: number,
): Promise<Refus | null> {
  if (fermeDonnee === null) return invalide('ferme : identifiant manquant ou invalide', null);
  const fermeId = fermeDonnee;
  const validee = await valider(tx, e.table, { ...e.donnees, id: e.id }, fermeId);
  if ('refus' in validee) return validee.refus;
  const { ligne, valeur, serieId } = validee;
  // Décision 6 du chef : une ligne se crée active.
  if (valeur.supprimeLe !== null) return invalide('une ligne se crée active (supprime_le vide)', fermeId);

  const existante = await identique(tx, e.table, ligne, valeur.id);
  if (existante !== null) {
    // Décision 4 du chef : même id, autres valeurs (ou ligne d'une autre ferme) → ecriture_invalide.
    return existante ? null : invalide('déjà enregistrée avec d’autres valeurs : une modification passe par PATCH', fermeId);
  }

  if (e.table === 'serie') {
    const refus = await verifierReferencesSerie(tx, valeur as Serie, { saison: true, culture: true, itineraire: true, rotation: true });
    if (refus !== null) return refus;
  } else {
    const refus = await verifierEmplacement(tx, valeur as Occupation);
    if (refus !== null) return refus;
  }

  const maintenant = ctx.maintenant();
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO ${sql.identifier(e.table)} (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)}
        ON CONFLICT (id) DO NOTHING
        RETURNING id::text AS id`,
  );
  if (ecrite.rows.length === 0) {
    // Écrite entre-temps par un envoi concurrent : même règle que le renvoi.
    return (await identique(tx, e.table, ligne, valeur.id)) === true ? null : invalide('déjà enregistrée avec d’autres valeurs', fermeId);
  }
  await historiser(tx, ctx, e.table, valeur.id, fermeId, auteurId, maintenant, 'creation', null);
  touchees.set(serieId, index);
  return null;
}

/** Emplacement d'une occupation : de la ferme, non supprimé. */
async function verifierEmplacement(tx: TransactionDb, o: Occupation): Promise<Refus | null> {
  const emplacement = await reference(tx, 'emplacement', o.emplacementId, o.fermeId, false);
  if (emplacement === undefined) return invalide('emplacement introuvable', o.fermeId);
  if (emplacement.supprimee) return invalide('emplacement supprimé', o.fermeId);
  return null;
}

/**
 * PATCH : modification d'une ligne de la ferme (suppression douce, rétablissement compris). Ligne
 * introuvable ou d'une autre ferme : même refus, sans ferme (T10d). Un PATCH qui ne change rien
 * est accepté sans rien écrire (renvoi après une réponse perdue).
 */
async function modifier(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureSerieRecue,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
  touchees: SeriesTouchees,
  index: number,
): Promise<Refus | null> {
  if (!estUuid(e.id)) return invalide('ligne introuvable', null);
  // Ferme dans la requête du verrou : une ligne d'une autre ferme n'est ni lue ni verrouillée.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM ${sql.identifier(e.table)} t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[])
        FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide('ligne introuvable', null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);
  // Relecture de sécurité (décision 1) : seule une occupation de série se modifie depuis le
  // téléphone, quoi que contienne le PATCH (une plantation ou une couverture ne devient pas une série).
  if (e.table === 'occupation' && (avant.serie_id == null || avant.plantation_id != null || avant.evenement_id != null)) {
    return invalide("cette occupation n'est pas celle d'une série : elle ne se modifie pas depuis le téléphone", fermeId);
  }

  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) {
    if (estUuid(fermeDemandee) && !fermes.has(fermeDemandee.toLowerCase())) return { motif: 'ferme_interdite', fermeId: fermeDemandee.toLowerCase() };
    return invalide('une ligne ne change pas de ferme', fermeId);
  }

  const validee = await valider(tx, e.table, { ...avant, ...e.donnees, id: avant.id }, fermeId);
  if ('refus' in validee) return validee.refus;
  const { ligne, valeur, serieId } = validee;

  if ((await identique(tx, e.table, ligne, valeur.id)) === true) return null;

  // Rétablissement (décision 2) : toutes les références sont revérifiées, comme si elles changeaient.
  const retablie = avant.supprime_le != null && valeur.supprimeLe === null;
  const change = (colonne: string): boolean => retablie || JSON.stringify(ligne[colonne] ?? null) !== JSON.stringify(avant[colonne] ?? null);
  if (e.table === 'serie') {
    const refus = await verifierReferencesSerie(tx, valeur as Serie, {
      saison: change('saison_id'),
      culture: change('espece_id') || change('variete_id') || change('itineraire_id'),
      // Rétablissement compris : seul un changement réel d'itinéraire exige un itinéraire actif.
      itineraire: JSON.stringify(ligne.itineraire_id ?? null) !== JSON.stringify(avant.itineraire_id ?? null),
      rotation: change('rotation_acceptee'),
    });
    if (refus !== null) return refus;
  } else if (change('emplacement_id')) {
    const refus = await verifierEmplacement(tx, valeur as Occupation);
    if (refus !== null) return refus;
  }

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE ${sql.identifier(e.table)} t SET (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)})
        WHERE t.id = ${valeur.id}::uuid`,
  );
  const suppression = avant.supprime_le === null && valeur.supprimeLe !== null;
  await historiser(tx, ctx, e.table, valeur.id, fermeId, auteurId, maintenant, suppression ? 'suppression' : 'modification', existante.texte);
  touchees.set(serieId, index);
  // Une occupation déplacée vers une autre série laisse l'ancienne à revérifier aussi.
  if (e.table === 'occupation' && typeof avant.serie_id === 'string') touchees.set(avant.serie_id, index);
  return null;
}

/**
 * Écriture sur `serie` ou `occupation` (PUT ou PATCH), dans la transaction du lot : null si
 * acceptée, sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi
 * celles de l'utilisateur pour un PUT).
 */
export async function ecrireSerie(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureSerieRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
  touchees: SeriesTouchees,
  index: number,
): Promise<Refus | null> {
  // Un id glissé dans les données : colonne inconnue (l'id est celui de l'écriture).
  if (Object.hasOwn(e.donnees, 'id')) return invalide('colonne inconnue : id', fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, auteurId, touchees, index);
  return creer(tx, ctx, e, fermeDonnee, auteurId, touchees, index);
}

/**
 * Fermes des lignes existantes visées par les PATCH du lot, parmi celles de l'utilisateur : à
 * verrouiller avant toute écriture (le verrou d'une ferme qui n'est pas la sienne n'est jamais
 * pris). La ferme d'une ligne ne change jamais (PATCH de ferme_id refusé) : la lire avant le
 * verrou est sûr.
 */
export async function fermesDesLignesVisees(
  tx: TransactionDb,
  ecritures: readonly { readonly op: string | null; readonly table: string; readonly id: string }[],
  fermes: ReadonlySet<string>,
): Promise<string[]> {
  const trouvees = new Set<string>();
  // T23 : les itinéraires et les types d'intervention se modifient aussi, sous le même verrou.
  for (const table of ['serie', 'occupation', 'itineraire', 'type_intervention'] as const) {
    const ids = [...new Set(ecritures.filter((e) => e.table === table && e.op === 'PATCH' && estUuid(e.id)).map((e) => e.id.toLowerCase()))];
    if (ids.length === 0) continue;
    const r = await tx.execute<{ ferme_id: string }>(
      sql`SELECT DISTINCT ferme_id::text AS ferme_id FROM ${sql.identifier(table)}
          WHERE id = ANY(${sql.param(ids)}::uuid[]) AND ferme_id = ANY(${sql.param([...fermes])}::uuid[])`,
    );
    for (const l of r.rows) trouvees.add(l.ferme_id);
  }
  return [...trouvees];
}

/**
 * Fin de lot (décision 1 du chef) : chaque occupation active d'une série touchée garde les dates
 * de sa série (de la mise en place à la fin de récolte, `validerOccupation` du cœur), et une série
 * supprimée n'a plus d'occupation active. null si tout est cohérent, sinon l'index de l'écriture
 * à qui le refus revient (la dernière qui a touché la série) et le refus.
 */
export async function verifierFinDeLot(
  tx: TransactionDb,
  touchees: SeriesTouchees,
  fermes: ReadonlySet<string>,
): Promise<{ readonly index: number; readonly refus: Refus } | null> {
  for (const [serieId, index] of [...touchees.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const r = await tx.execute<{ l: Ligne }>(
      sql`SELECT to_jsonb(s) AS l FROM serie s WHERE s.id = ${serieId}::uuid AND s.ferme_id = ANY(${sql.param([...fermes])}::uuid[])`,
    );
    const ligne = r.rows[0]?.l;
    if (ligne === undefined) return { index, refus: invalide('série introuvable', null) };
    const fermeId = String(ligne.ferme_id);
    const serie = validerSerie(ligne);
    if (!serie.ok) return { index, refus: invalide(`série illisible : ${serie.erreur.message}`, fermeId) };
    const occupations = await tx.execute<{ l: Ligne }>(
      // Décision 3 : seulement les occupations de la ferme de la série.
      sql`SELECT to_jsonb(o) AS l FROM occupation o
          WHERE o.serie_id = ${serieId}::uuid AND o.ferme_id = ${fermeId}::uuid AND o.supprime_le IS NULL ORDER BY o.id`,
    );
    if (occupations.rows.length > 0 && serie.valeur.supprimeLe !== null) {
      return { index, refus: invalide('série supprimée alors qu’une de ses occupations reste active', fermeId) };
    }
    for (const o of occupations.rows) {
      const lecture = validerOccupation(o.l, serie.valeur);
      if (!lecture.ok) return { index, refus: invalide(`occupation incohérente avec sa série : ${lecture.erreur.message}`, fermeId) };
    }
  }
  return null;
}

export { estTableSerie };
