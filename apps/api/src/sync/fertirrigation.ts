/**
 * Recettes de fertirrigation de la ferme écrites par le téléphone (T56, écran « Recettes de
 * fertirrigation »). Contrat : en-tête de fertirrigation.integration.test.ts. Même modèle que les
 * produits fertilisants (fertilisation.ts, T54) : règles de ligne du cœur
 * (`validerRecetteFertirrigation`) rejouées sur la ligne COMPLÈTE (pour un PATCH : ligne existante
 * + colonnes reçues) ; ce fichier ajoute le renvoi identique, la ferme figée, les engrais de la
 * ferme et l'historique (`modification`, écrit par le serveur seul).
 *
 * Un PATCH sur la recette d'une autre ferme se comporte exactement comme sur un id inexistant
 * (T10d). Archiver = suppression douce : les irrigations passées gardent leurs doses (figées dans
 * leur détail) ; le serveur accepte encore une irrigation qui la vise (references.ts).
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou consultatif de la ferme.
 */
import { validerRecetteFertirrigation, type Id, type RecetteFertirrigationEcrite } from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import { ID_GLISSE, PRECISION_CHANGE_DE_FERME, PRECISION_CREEE_SUPPRIMEE, PRECISION_EXISTE_DEJA, PRECISION_INTROUVABLE, refusDuCoeur } from './messages.ts';

/** Un engrais de la recette n'est pas un produit fertilisant de la ferme. */
export const PRECISION_ENGRAIS_INTROUVABLE = 'un produit de la recette est introuvable parmi les produits fertilisants de la ferme';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLE_RECETTE = 'recette_fertirrigation';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES = ['id', 'ferme_id', 'nom', 'taux_injection', 'engrais', 'ec_cible', 'ph_cible', 'supprime_le'] as const;

type Ligne = Readonly<Record<string, unknown>>;

export interface EcritureRecetteRecue {
  readonly op: 'PUT' | 'PATCH';
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

function colonnes(alias: string): SQL {
  return sql.join(
    COLONNES.map((c) => sql`${sql.identifier(alias)}.${sql.identifier(c)}`),
    sql`, `,
  );
}

function ligneDe(r: RecetteFertirrigationEcrite): Ligne {
  return {
    id: r.id,
    ferme_id: r.fermeId,
    nom: r.nom,
    taux_injection: r.tauxInjection,
    engrais: r.engrais,
    ec_cible: r.ecCible,
    ph_cible: r.phCible,
    supprime_le: r.supprimeLe === null ? null : new Date(r.supprimeLe).toISOString(),
  };
}

/**
 * Chaque engrais désigne un produit fertilisant DE LA FERME (archivé compris : une recette se
 * garde quand un produit s'archive). Un produit d'une autre ferme se comporte comme un inexistant.
 */
async function engraisDeLaFerme(tx: TransactionDb, r: RecetteFertirrigationEcrite): Promise<boolean> {
  const ids = [...new Set(r.engrais.map((e) => e.produitFertilisantId.toLowerCase()))];
  const t = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM (SELECT id FROM produit_fertilisant WHERE id = ANY(${sql.param(ids)}::uuid[]) AND ferme_id = ${r.fermeId}::uuid FOR SHARE) p`,
  );
  return t.rows[0]?.n === ids.length;
}

function enregistrement(ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::recette_fertirrigation, ${JSON.stringify(ligne)}::jsonb) r`;
}

/** La ligne `id` a-t-elle exactement ces valeurs (horodatages ignorés) ? null si elle n'existe pas. */
async function identique(tx: TransactionDb, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes('r')}) IS NOT DISTINCT FROM (${colonnes('t')}) AS identique
        FROM recette_fertirrigation t, ${enregistrement(ligne)} WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

async function deLaFerme(tx: TransactionDb, id: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM recette_fertirrigation WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid) AS existe`);
  return r.rows[0]?.existe === true;
}

async function historiser(
  tx: TransactionDb,
  ctx: Contexte,
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
    nomTable: 'RecetteFertirrigation',
    ligneId: ligneId as Id<'RecetteFertirrigation'>,
    auteurId,
    horodatage: maintenant,
    operation,
    avant: avant === null ? null : sql`${avant}::jsonb`,
    apres: sql`(SELECT to_jsonb(l) FROM recette_fertirrigation l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcritureRecetteRecue, fermeDonnee: string | null, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const lecture = validerRecetteFertirrigation({ ...e.donnees, id: e.id });
  if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeDonnee);
  const p = lecture.valeur;
  if (p.supprimeLe !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, p.fermeId);
  if (!(await engraisDeLaFerme(tx, p))) return invalide(PRECISION_ENGRAIS_INTROUVABLE, p.fermeId);
  const ligne = ligneDe(p);
  const existante = await identique(tx, ligne, p.id);
  if (existante !== null) {
    if (existante) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, p.id, p.fermeId)) ? p.fermeId : null);
  }
  const maintenant = ctx.maintenant();
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO recette_fertirrigation (${sql.join(
      COLONNES.map((c) => sql.identifier(c)),
      sql`, `,
    )}, cree_le, modifie_le)
        SELECT ${colonnes('r')}, ${maintenant}::timestamptz, ${maintenant}::timestamptz FROM ${enregistrement(ligne)}
        ON CONFLICT (id) DO NOTHING RETURNING id::text AS id`,
  );
  if (ecrite.rows.length === 0) {
    if ((await identique(tx, ligne, p.id)) === true) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, p.id, p.fermeId)) ? p.fermeId : null);
  }
  await historiser(tx, ctx, p.id, p.fermeId, auteurId, maintenant, 'creation', null);
  return null;
}

/** PATCH : modification d'un produit de la ferme (teneurs après analyse, archivage, rétablissement). */
async function modifier(tx: TransactionDb, ctx: Contexte, e: EcritureRecetteRecue, fermes: ReadonlySet<string>, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : un produit d'une autre ferme n'est ni lu ni verrouillé.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM recette_fertirrigation t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[]) FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) return invalide(PRECISION_CHANGE_DE_FERME, fermeId);

  const lecture = validerRecetteFertirrigation({ ...avant, ...e.donnees, id: avant.id });
  if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeId);
  const ligne = ligneDe(lecture.valeur);
  if ((await identique(tx, ligne, lecture.valeur.id)) === true) return null;
  if (!(await engraisDeLaFerme(tx, lecture.valeur))) return invalide(PRECISION_ENGRAIS_INTROUVABLE, fermeId);

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE recette_fertirrigation t SET (${sql.join(
      COLONNES.map((c) => sql.identifier(c)),
      sql`, `,
    )}, modifie_le) = (SELECT ${colonnes('r')}, ${maintenant}::timestamptz FROM ${enregistrement(ligne)})
        WHERE t.id = ${lecture.valeur.id}::uuid`,
  );
  const suppression = avant.supprime_le == null && lecture.valeur.supprimeLe !== null;
  await historiser(tx, ctx, lecture.valeur.id, fermeId, auteurId, maintenant, suppression ? 'suppression' : 'modification', existante.texte);
  return null;
}

/**
 * Écriture sur `recette_fertirrigation` (PUT ou PATCH), dans la transaction du lot : null si acceptée,
 * sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi celles de
 * l'utilisateur pour un PUT).
 */
export async function ecrireRecetteFertirrigation(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureRecetteRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, auteurId);
  return creer(tx, ctx, e, fermeDonnee, auteurId);
}
