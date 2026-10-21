/**
 * Produits fertilisants de la ferme écrits par le téléphone (T54, écran « Produits fertilisants »).
 * Contrat : en-tête de fertilisation.integration.test.ts. Même modèle que les produits phyto
 * (phyto.ts, T52) : règles de ligne du cœur (`validerProduitFertilisant`) rejouées sur la ligne
 * COMPLÈTE (pour un PATCH : ligne existante + colonnes reçues) ; ce fichier ajoute le renvoi
 * identique, la ferme figée et l'historique (`modification`, écrit par le serveur seul).
 *
 * Pas de bibliothèque commune : la liste de départ est copiée dans la ferme par le téléphone. Un
 * PATCH sur le produit d'une autre ferme se comporte exactement comme sur un id inexistant (T10d).
 * Archiver = suppression douce (`supprime_le`) : les apports passés gardent leur produit ; le
 * serveur accepte encore un apport qui le vise (fait hors ligne avant l'archivage : references.ts).
 *
 * Tout se fait dans la transaction du lot (upload.ts), sous le verrou consultatif de la ferme.
 */
import { validerProduitFertilisant, type Id, type ProduitFertilisantEcrit } from '@planif/core';
import { modification } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import { ID_GLISSE, PRECISION_CHANGE_DE_FERME, PRECISION_CREEE_SUPPRIMEE, PRECISION_EXISTE_DEJA, PRECISION_INTROUVABLE, refusDuCoeur } from './messages.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLE_FERTILISANT = 'produit_fertilisant';

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
const COLONNES = ['id', 'ferme_id', 'nom', 'forme', 'unite', 'teneur_n', 'teneur_p2o5', 'teneur_k2o', 'organique', 'utilisable_en_bio', 'source', 'densite_kg_par_l', 'supprime_le'] as const;

type Ligne = Readonly<Record<string, unknown>>;

export interface EcritureFertilisantRecue {
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

function ligneDe(p: ProduitFertilisantEcrit): Ligne {
  return {
    id: p.id,
    ferme_id: p.fermeId,
    nom: p.nom,
    forme: p.forme,
    unite: p.unite,
    teneur_n: p.teneurN,
    teneur_p2o5: p.teneurP2o5,
    teneur_k2o: p.teneurK2o,
    organique: p.organique,
    utilisable_en_bio: p.utilisableEnBio,
    source: p.source,
    densite_kg_par_l: p.densiteKgParL,
    supprime_le: p.supprimeLe === null ? null : new Date(p.supprimeLe).toISOString(),
  };
}

function enregistrement(ligne: Ligne): SQL {
  return sql`jsonb_populate_record(NULL::produit_fertilisant, ${JSON.stringify(ligne)}::jsonb) r`;
}

/** La ligne `id` a-t-elle exactement ces valeurs (horodatages ignorés) ? null si elle n'existe pas. */
async function identique(tx: TransactionDb, ligne: Ligne, id: string): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (${colonnes('r')}) IS NOT DISTINCT FROM (${colonnes('t')}) AS identique
        FROM produit_fertilisant t, ${enregistrement(ligne)} WHERE t.id = ${id}::uuid`,
  );
  const l = r.rows[0];
  return l === undefined ? null : l.identique;
}

async function deLaFerme(tx: TransactionDb, id: string, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM produit_fertilisant WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid) AS existe`);
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
    nomTable: 'ProduitFertilisant',
    ligneId: ligneId as Id<'ProduitFertilisant'>,
    auteurId,
    horodatage: maintenant,
    operation,
    avant: avant === null ? null : sql`${avant}::jsonb`,
    apres: sql`(SELECT to_jsonb(l) FROM produit_fertilisant l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

/** PUT : création. Renvoi identique accepté sans rien écrire ; même id, autres valeurs : refusé. */
async function creer(tx: TransactionDb, ctx: Contexte, e: EcritureFertilisantRecue, fermeDonnee: string | null, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const lecture = validerProduitFertilisant({ ...e.donnees, id: e.id });
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
    sql`INSERT INTO produit_fertilisant (${sql.join(
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
async function modifier(tx: TransactionDb, ctx: Contexte, e: EcritureFertilisantRecue, fermes: ReadonlySet<string>, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  if (!estUuid(e.id) || fermes.size === 0) return invalide(PRECISION_INTROUVABLE, null);
  // Ferme dans la requête du verrou : un produit d'une autre ferme n'est ni lu ni verrouillé.
  const r = await tx.execute<{ l: Ligne; texte: string }>(
    sql`SELECT to_jsonb(t) AS l, to_jsonb(t)::text AS texte FROM produit_fertilisant t
        WHERE t.id = ${e.id.toLowerCase()}::uuid AND t.ferme_id = ANY(${sql.param([...fermes])}::uuid[]) FOR UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.l;
  const fermeId = String(avant.ferme_id);
  const fermeDemandee = e.donnees.ferme_id;
  if (fermeDemandee !== undefined && (typeof fermeDemandee !== 'string' || fermeDemandee.toLowerCase() !== fermeId)) return invalide(PRECISION_CHANGE_DE_FERME, fermeId);

  const lecture = validerProduitFertilisant({ ...avant, ...e.donnees, id: avant.id });
  if (!lecture.ok) return refusDuCoeur(lecture.erreur, fermeId);
  const ligne = ligneDe(lecture.valeur);
  if ((await identique(tx, ligne, lecture.valeur.id)) === true) return null;

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE produit_fertilisant t SET (${sql.join(
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
 * Écriture sur `produit_fertilisant` (PUT ou PATCH), dans la transaction du lot : null si acceptée,
 * sinon le refus. `fermeDonnee` : ferme déclarée par les données (déjà vérifiée parmi celles de
 * l'utilisateur pour un PUT).
 */
export async function ecrireProduitFertilisant(
  tx: TransactionDb,
  ctx: Contexte,
  e: EcritureFertilisantRecue,
  fermeDonnee: string | null,
  fermes: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  if (Object.hasOwn(e.donnees, 'id')) return refusDuCoeur(ID_GLISSE, fermeDonnee);
  if (e.op === 'PATCH') return modifier(tx, ctx, e, fermes, auteurId);
  return creer(tx, ctx, e, fermeDonnee, auteurId);
}
