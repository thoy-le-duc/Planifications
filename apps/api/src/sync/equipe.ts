/**
 * Équipe de la ferme et attribution des travaux du jour écrites par le téléphone (T60, Q44).
 * Contrat : en-tête de equipe.integration.test.ts. Même modèle que les produits phyto (phyto.ts) :
 * règles de ligne du cœur (`validerPersonne`, `validerAttribution`) rejouées sur la ligne
 * COMPLÈTE (pour un PATCH : ligne existante + colonnes reçues) ; ce fichier ajoute les droits, les
 * références, le renvoi identique et la ferme figée.
 *
 * Droits (règle 3, comme le profil de croissance de T32c) : le GÉRANT actif de la ferme seul
 * (`gerees`, rôle relu dans la transaction du lot, upload.ts). Un équipier lit l'équipe et ses
 * travaux par la synchro, il n'en écrit rien.
 *
 * Pas d'historique dans `modification` : ce sont des consignes du jour, pas des données de culture
 * (docs/modele-donnees.md, « Équipe et consignes »). Rien ne s'efface : retirer = `supprime_le`.
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou consultatif de la ferme.
 */
import { validerAttribution, validerPersonne, type AttributionEcrite, type PersonneEcrite } from '@planif/core';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import { ID_GLISSE, PRECISION_CHANGE_DE_FERME, PRECISION_CREEE_SUPPRIMEE, PRECISION_EXISTE_DEJA, PRECISION_INTROUVABLE, refusDuCoeur } from './messages.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLES_EQUIPE = ['personne', 'attribution'] as const;
type TableEquipe = (typeof TABLES_EQUIPE)[number];

export const estTableEquipe = (table: string): table is TableEquipe => (TABLES_EQUIPE as readonly string[]).includes(table);

/** Règle 3 : seul le gérant compose l'équipe et attribue les travaux. */
export const PRECISION_SEUL_LE_GERANT_EQUIPE = 'seul le gérant de la ferme compose l’équipe et attribue les travaux';
export const PRECISION_COMPTE_HORS_FERME = 'ce compte n’est pas celui d’un membre de la ferme';
export const PRECISION_COMPTE_DEJA_LIE = 'ce compte est déjà celui d’une autre personne de l’équipe';
export const PRECISION_PERSONNE_HORS_EQUIPE = 'cette personne n’est pas dans l’équipe de la ferme';
export const PRECISION_ATTRIBUTION_FIGEE = 'un travail attribué ne change ni de travail ni de personne : retirez-le, puis attribuez-le de nouveau';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES: Readonly<Record<TableEquipe, readonly string[]>> = {
  personne: ['id', 'ferme_id', 'prenom', 'membre_id', 'supprime_le'],
  attribution: ['id', 'ferme_id', 'personne_id', 'cle_tache', 'supprime_le'],
};

type Ligne = Readonly<Record<string, unknown>>;

export interface EcritureEquipeRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly table: TableEquipe;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

type Lue = { readonly table: 'personne'; readonly v: PersonneEcrite } | { readonly table: 'attribution'; readonly v: AttributionEcrite };

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

function lire(table: TableEquipe, entree: Ligne): { readonly ok: true; readonly lue: Lue } | { readonly ok: false; readonly refus: Refus } {
  if (table === 'personne') {
    const r = validerPersonne(entree);
    return r.ok ? { ok: true, lue: { table, v: r.valeur } } : { ok: false, refus: refusDuCoeur(r.erreur, null) };
  }
  const r = validerAttribution(entree);
  return r.ok ? { ok: true, lue: { table, v: r.valeur } } : { ok: false, refus: refusDuCoeur(r.erreur, null) };
}

const instant = (v: number | null): string | null => (v === null ? null : new Date(v).toISOString());

function ligneDe(l: Lue): Ligne {
  if (l.table === 'personne') {
    const p = l.v;
    return { id: p.id, ferme_id: p.fermeId, prenom: p.prenom, membre_id: p.membreId, supprime_le: instant(p.supprimeLe) };
  }
  const a = l.v;
  return { id: a.id, ferme_id: a.fermeId, personne_id: a.personneId, cle_tache: a.cleTache, supprime_le: instant(a.supprimeLe) };
}

function colonnes(table: TableEquipe, alias: string): SQL {
  return sql.join(
    COLONNES[table].map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

function enregistrement(table: TableEquipe, ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(ligne)}::jsonb) r`;
}

/** La ligne `id` a-t-elle exactement ces valeurs (horodatages ignorés) ? null si elle n'existe pas. */
async function identique(tx: TransactionDb, table: TableEquipe, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes(table, 'r')}) IS NOT DISTINCT FROM (${colonnes(table, 't')}) AS identique
        FROM ${sql.identifier(table)} t, ${enregistrement(table, ligne)} WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

async function existe(tx: TransactionDb, requete: SQL): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (${requete}) AS existe`);
  return r.rows[0]?.existe === true;
}

/**
 * Références de la ligne, dans sa ferme : le compte d'une personne est un membre actif de la
 * ferme, celui d'aucune autre personne active ; la personne d'une attribution est de l'équipe.
 */
async function verifierReferences(tx: TransactionDb, l: Lue): Promise<Refus | null> {
  const fermeId = l.v.fermeId;
  if (l.table === 'personne') {
    const membre = l.v.membreId;
    if (membre === null || l.v.supprimeLe !== null) return null;
    const duMembre = await existe(tx, sql`SELECT 1 FROM membre WHERE id = ${membre}::uuid AND ferme_id = ${fermeId}::uuid AND supprime_le IS NULL`);
    if (!duMembre) return invalide(PRECISION_COMPTE_HORS_FERME, fermeId);
    const dejaLie = await existe(tx, sql`SELECT 1 FROM personne WHERE membre_id = ${membre}::uuid AND supprime_le IS NULL AND id <> ${l.v.id}::uuid`);
    return dejaLie ? invalide(PRECISION_COMPTE_DEJA_LIE, fermeId) : null;
  }
  const deLEquipe = await existe(tx, sql`SELECT 1 FROM personne WHERE id = ${l.v.personneId}::uuid AND ferme_id = ${fermeId}::uuid`);
  return deLEquipe ? null : invalide(PRECISION_PERSONNE_HORS_EQUIPE, fermeId);
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcritureEquipeRecue, fermeDonnee: string | null, gerees: ReadonlySet<string>): Promise<Refus | null> {
  const lecture = lire(e.table, { ...e.donnees, id: e.id });
  if (!lecture.ok) return { ...lecture.refus, fermeId: fermeDonnee };
  const l = lecture.lue;
  const fermeId = l.v.fermeId;
  if (!gerees.has(fermeId)) return invalide(PRECISION_SEUL_LE_GERANT_EQUIPE, fermeId);
  if (l.v.supprimeLe !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, fermeId);
  const ligne = ligneDe(l);
  const existante = await identique(tx, e.table, ligne, l.v.id);
  if (existante !== null) return existante ? null : invalide(PRECISION_EXISTE_DEJA, null);
  const refus = await verifierReferences(tx, l);
  if (refus !== null) return refus;
  const maintenant = ctx.maintenant();
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO ${sql.identifier(e.table)} (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)}
        ON CONFLICT (id) DO NOTHING RETURNING id::text AS id`,
  );
  if (ecrite.rows.length === 0) return (await identique(tx, e.table, ligne, l.v.id)) === true ? null : invalide(PRECISION_EXISTE_DEJA, null);
  return null;
}

/** PATCH : modification d'une ligne de la ferme (retrait et rétablissement compris). */
async function modifier(tx: TransactionDb, ctx: Contexte, e: EcritureEquipeRecue, fermes: ReadonlySet<string>, gerees: ReadonlySet<string>): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : une ligne d'une autre ferme n'est ni lue ni verrouillée (T10d).
  const r = await tx.execute<{ l: Ligne }>(
    sql`SELECT to_jsonb(t) AS l FROM ${sql.identifier(e.table)} t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[]) FOR UPDATE`,
  );
  const avant = r.rows[0]?.l;
  if (avant === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const fermeId = String(avant.ferme_id);
  if (!gerees.has(fermeId)) return invalide(PRECISION_SEUL_LE_GERANT_EQUIPE, fermeId);
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) return invalide(PRECISION_CHANGE_DE_FERME, fermeId);

  const lecture = lire(e.table, { ...avant, ...e.donnees, id: avant.id });
  if (!lecture.ok) return { ...lecture.refus, fermeId };
  const l = lecture.lue;
  if (l.table === 'attribution' && (l.v.personneId !== String(avant.personne_id).toLowerCase() || l.v.cleTache !== avant.cle_tache)) {
    return invalide(PRECISION_ATTRIBUTION_FIGEE, fermeId);
  }
  const ligne = ligneDe(l);
  if ((await identique(tx, e.table, ligne, l.v.id)) === true) return null;
  const refus = await verifierReferences(tx, l);
  if (refus !== null) return refus;
  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE ${sql.identifier(e.table)} t SET (${sql.join(
      COLONNES[e.table].map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes(e.table, 'r')}, ${maintenant}::timestamptz FROM ${enregistrement(e.table, ligne)})
        WHERE t.id = ${l.v.id}::uuid`,
  );
  return null;
}

/**
 * Écriture sur `personne` ou `attribution` (PUT ou PATCH), dans la transaction du lot : null si
 * acceptée, sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi
 * celles de l'utilisateur pour un PUT) ; `gerees` : fermes dont l'auteur est gérant actif.
 */
export async function ecrireEquipe(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureEquipeRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  gerees: ReadonlySet<string>,
): Promise<Refus | null> {
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, gerees);
  return creer(tx, ctx, e, fermeDonnee, gerees);
}

/** Fermes des lignes de l'équipe visées par un PATCH (parmi celles de l'utilisateur), pour le verrou du lot. */
export async function fermesDesLignesEquipe(
  tx: TransactionDb,
  ecritures: readonly { readonly op: string | null; readonly table: string; readonly id: string }[],
  fermes: ReadonlySet<string>,
): Promise<string[]> {
  const trouvees = new Set<string>();
  for (const table of TABLES_EQUIPE) {
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

