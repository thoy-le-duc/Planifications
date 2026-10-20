/**
 * Produits phyto de la ferme écrits par le téléphone (T52, écran « Produits phyto »). Contrat :
 * en-tête de phyto.integration.test.ts. Même modèle que les types d'intervention (itineraire.ts) :
 * règles de ligne du cœur (`validerProduitPhyto`) rejouées sur la ligne COMPLÈTE (pour un PATCH :
 * ligne existante + colonnes reçues) ; ce fichier ajoute le renvoi identique, la ferme figée et
 * l'historique (`modification`, écrit par le serveur seul).
 *
 * Bibliothèque commune (ferme_id nul) : en lecture seule. Un PATCH sur un de ses produits, ou sur
 * celui d'une autre ferme, se comporte exactement comme sur un id inexistant (T10d). Archiver =
 * suppression douce (`supprime_le`) : les traitements passés gardent leur produit ; l'écran de
 * saisie ne le propose plus, mais le serveur accepte encore un traitement qui le vise (fait hors
 * ligne avant l'archivage, correction, annulation : references.ts).
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou consultatif de la ferme.
 */
import { validerProduitPhyto, type Id, type ProduitPhytoEcrit } from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import { ID_GLISSE, PRECISION_CHANGE_DE_FERME, PRECISION_CREEE_SUPPRIMEE, PRECISION_EXISTE_DEJA, PRECISION_INTROUVABLE, refusDuCoeur } from './messages.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLE_PHYTO = 'produit_phyto';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES = ['id', 'ferme_id', 'nom_commercial', 'numero_amm', 'substance_active', 'delai_avant_recolte_jours', 'utilisable_en_bio', 'dose_maximale', 'supprime_le'] as const;

type Ligne = Readonly<Record<string, unknown>>;

export interface EcriturePhytoRecue {
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

function ligneDe(p: ProduitPhytoEcrit): Ligne {
  return {
    id: p.id,
    ferme_id: p.fermeId,
    nom_commercial: p.nomCommercial,
    numero_amm: p.numeroAmm,
    substance_active: p.substanceActive,
    delai_avant_recolte_jours: p.delaiAvantRecolteJours,
    utilisable_en_bio: p.utilisableEnBio,
    dose_maximale: p.doseMaximale,
    supprime_le: p.supprimeLe === null ? null : new Date(p.supprimeLe).toISOString(),
  };
}

function enregistrement(ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::produit_phyto, ${JSON.stringify(ligne)}::jsonb) r`;
}

/** La ligne `id` a-t-elle exactement ces valeurs (horodatages ignorés) ? null si elle n'existe pas. */
async function identique(tx: TransactionDb, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes('r')}) IS NOT DISTINCT FROM (${colonnes('t')}) AS identique
        FROM produit_phyto t, ${enregistrement(ligne)} WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

async function deLaFerme(tx: TransactionDb, id: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM produit_phyto WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid) AS existe`);
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
    nomTable: 'ProduitPhyto',
    ligneId: ligneId as Id<'ProduitPhyto'>,
    auteurId,
    horodatage: maintenant,
    operation,
    avant: avant === null ? null : sql`${avant}::jsonb`,
    apres: sql`(SELECT to_jsonb(l) FROM produit_phyto l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcriturePhytoRecue, fermeDonnee: string | null, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const lecture = validerProduitPhyto({ ...e.donnees, id: e.id });
  if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeDonnee);
  const p = lecture.valeur;
  if (p.supprimeLe !== null) return invalide(PRECISION_CREEE_SUPPRIMEE, p.fermeId);
  const ligne = ligneDe(p);
  const existante = await identique(tx, ligne, p.id);
  if (existante !== null) {
    if (existante) return null;
    return invalide(PRECISION_EXISTE_DEJA, (await deLaFerme(tx, p.id, p.fermeId)) ? p.fermeId : null);
  }
  const maintenant = ctx.maintenant();
  const ecrite = await tx.execute<{ id: string }>(
    sql`INSERT INTO produit_phyto (${sql.join(
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

/** PATCH : modification d'un produit de la ferme (archivage et rétablissement compris). */
async function modifier(tx: TransactionDb, ctx: Contexte, e: EcriturePhytoRecue, fermes: ReadonlySet<string>, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : un produit d'une autre ferme ou de la bibliothèque n'est ni lu ni verrouillé.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM produit_phyto t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[]) FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) return invalide(PRECISION_CHANGE_DE_FERME, fermeId);

  const lecture = validerProduitPhyto({ ...avant, ...e.donnees, id: avant.id });
  if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeId);
  const ligne = ligneDe(lecture.valeur);
  if ((await identique(tx, ligne, lecture.valeur.id)) === true) return null;

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE produit_phyto t SET (${sql.join(
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
 * Écriture sur `produit_phyto` (PUT ou PATCH), dans la transaction du lot : null si acceptée,
 * sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi celles de
 * l'utilisateur pour un PUT).
 */
export async function ecrireProduitPhyto(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcriturePhytoRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, auteurId);
  return creer(tx, ctx, e, fermeDonnee, auteurId);
}
