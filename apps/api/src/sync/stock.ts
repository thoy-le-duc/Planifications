/**
 * Stock écrit par le téléphone (T10c) : `article_stock` (création seule) et `mouvement_stock`
 * (ajout seul). Contrat : en-tête de stock.integration.test.ts.
 *
 * Les règles d'une ligne sont celles du cœur (`validerArticleStock`, `validerMouvementStock`,
 * `verifierMouvementRecolte`, @planif/core) ; ce fichier ajoute ce qui demande la base : le
 * renvoi identique, l'appartenance des références à la ferme, la somme des mouvements de la
 * chaîne d'une récolte, et l'historique. Le serveur ne fait jamais confiance au téléphone :
 * chaque identifiant reçu est relu en base (requêtes paramétrées), et un refus ne dit rien d'une
 * autre ferme.
 *
 * Tout se fait dans la transaction du lot (upload.ts) : références verrouillées (FOR SHARE)
 * jusqu'à l'écriture ; les lignes écrites plus haut dans le même lot sont visibles.
 */
import {
  validerArticleStock,
  validerMouvementStock,
  verifierMouvementRecolte,
  type ArticleStock,
  type Id,
  type RemplacementEvenement,
} from '@planif/core';
import { articleStock, modification, mouvementStock } from '@planif/db';
import { sql } from 'drizzle-orm';
import type { Contexte } from '../dependances.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

/** Écriture PUT reçue : id de l'écriture PowerSync et colonnes (lues sans confiance). */
export interface PutRecu {
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

/** Ligne référencée : sa ferme (null : bibliothèque commune), si elle est supprimée, et son espèce (variété). */
type LigneReference = {
  readonly ferme_id: string | null;
  readonly supprimee: boolean;
  readonly espece_id?: string;
};

/** Profondeur au plus d'une chaîne de corrections (garde-fou : le journal n'a pas de cycle). */
const PROFONDEUR_MAX_CHAINE = 1_000;

/** Colonnes reçues + id de l'écriture ; un `id` glissé dans les données est refusé (colonne inconnue). */
function avecId(e: PutRecu): Readonly<Record<string, unknown>> | { readonly idGlisse: true } {
  return Object.hasOwn(e.donnees, 'id') ? { idGlisse: true } : { ...e.donnees, id: e.id };
}

const invalide = (precision: string, fermeId: string): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

/**
 * Ligne `table` d'identifiant `id`, verrouillée (FOR SHARE) jusqu'à la fin de la transaction ;
 * `extra` : colonnes lues en plus. Table et colonnes sont des constantes de ce fichier, l'id un
 * paramètre.
 */
async function lireReference(
  tx: TransactionDb,
  table: 'espece' | 'variete' | 'article_stock',
  id: string,
  extra: ReturnType<typeof sql> = sql``,
): Promise<LigneReference | undefined> {
  const r = await tx.execute<LigneReference>(
    sql`SELECT ferme_id::text AS ferme_id, supprime_le IS NOT NULL AS supprimee ${extra}
        FROM ${sql.identifier(table)} WHERE id = ${id}::uuid FOR SHARE`,
  );
  return r.rows[0];
}

/** Ligne d'historique de la création de `ligneId`, dans la même transaction (comme un événement, T10). */
async function historiser(
  tx: TransactionDb,
  ctx: Contexte,
  table: 'article_stock' | 'mouvement_stock',
  ligneId: string,
  fermeId: Id<'Ferme'>,
  auteurId: Id<'Utilisateur'>,
  maintenant: Date,
): Promise<void> {
  await tx.insert(modification).values({
    id: ctx.nouvelId(),
    fermeId,
    nomTable: table === 'article_stock' ? 'ArticleStock' : 'MouvementStock',
    ligneId,
    auteurId,
    horodatage: maintenant,
    operation: 'creation',
    avant: null,
    // La ligne écrite, telle que Postgres la rend en JSON (colonnes snake_case).
    apres: sql`(SELECT to_jsonb(l) FROM ${sql.identifier(table)} l WHERE l.id = ${ligneId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
}

// ── article_stock ────────────────────────────────────────────────────────────────────────────

/** L'article `a.id` existe-t-il déjà avec exactement ces valeurs (horodatages ignorés) ? null s'il n'existe pas. */
async function articleIdentique(tx: TransactionDb, a: ArticleStock): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (ferme_id = ${a.fermeId}::uuid
               AND espece_id = ${a.especeId}::uuid
               AND variete_id IS NOT DISTINCT FROM ${a.varieteId}::uuid
               AND unite = ${a.unite}
               AND categorie IS NOT DISTINCT FROM ${a.categorie}::text
               AND supprime_le IS NULL) AS identique
        FROM article_stock WHERE id = ${a.id}::uuid`,
  );
  const ligne = r.rows[0];
  return ligne === undefined ? null : ligne.identique;
}

/** Espèce et variété visibles par la ferme (la sienne ou la bibliothèque), non supprimées. */
async function verifierEspece(tx: TransactionDb, a: ArticleStock): Promise<Refus | null> {
  const espece = await lireReference(tx, 'espece', a.especeId);
  if (espece === undefined) return invalide('espèce introuvable', a.fermeId);
  if (espece.ferme_id !== null && espece.ferme_id !== a.fermeId) return { motif: 'ferme_interdite', precision: "espèce d'une autre ferme", fermeId: a.fermeId };
  if (espece.supprimee) return invalide('espèce supprimée', a.fermeId);
  if (a.varieteId === null) return null;
  const variete = await lireReference(tx, 'variete', a.varieteId, sql`, espece_id::text AS espece_id`);
  if (variete === undefined) return invalide('variété introuvable', a.fermeId);
  if (variete.ferme_id !== null && variete.ferme_id !== a.fermeId) return { motif: 'ferme_interdite', precision: "variété d'une autre ferme", fermeId: a.fermeId };
  if (variete.supprimee) return invalide('variété supprimée', a.fermeId);
  if (variete.espece_id !== a.especeId) return invalide("variété d'une autre espèce", a.fermeId);
  return null;
}

/**
 * PUT sur `article_stock` : création seule. Renvoi identique accepté sans rien écrire ; même id
 * avec d'autres valeurs : 'table_interdite' (un article ne se modifie pas depuis le téléphone).
 */
export async function ecrireArticle(tx: TransactionDb, ctx: Contexte, e: PutRecu, fermeId: string, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const ligne = avecId(e);
  if ('idGlisse' in ligne) return invalide('colonne inconnue : id', fermeId);
  const lecture = validerArticleStock(ligne);
  if (!lecture.ok) return invalide(lecture.erreur.message, fermeId);
  const a = lecture.valeur;

  const existant = await articleIdentique(tx, a);
  if (existant !== null) return existant ? null : { motif: 'table_interdite', fermeId: a.fermeId };

  const refus = await verifierEspece(tx, a);
  if (refus !== null) return refus;

  const maintenant = ctx.maintenant();
  const [ecrit] = await tx
    .insert(articleStock)
    .values({ ...a, supprimeLe: null, creeLe: maintenant, modifieLe: maintenant })
    .onConflictDoNothing({ target: articleStock.id })
    .returning({ id: articleStock.id });
  if (ecrit === undefined) {
    // Écrit entre-temps par un envoi concurrent : même règle que le renvoi.
    return (await articleIdentique(tx, a)) === true ? null : { motif: 'table_interdite', fermeId: a.fermeId };
  }
  await historiser(tx, ctx, 'article_stock', a.id, a.fermeId, auteurId, maintenant);
  return null;
}

// ── mouvement_stock ──────────────────────────────────────────────────────────────────────────

interface MouvementLu {
  readonly id: string;
  readonly fermeId: Id<'Ferme'>;
  readonly articleStockId: string;
  readonly date: string;
  readonly quantite: number;
  readonly recolteId: string;
}

/** Le mouvement `m.id` existe-t-il déjà avec exactement ces valeurs ? null s'il n'existe pas. */
async function mouvementIdentique(tx: TransactionDb, m: MouvementLu): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (ferme_id = ${m.fermeId}::uuid
               AND article_stock_id = ${m.articleStockId}::uuid
               AND date = ${m.date}::date
               AND quantite = ${String(m.quantite)}::numeric
               AND motif = 'recolte'
               AND recolte_id IS NOT DISTINCT FROM ${m.recolteId}::uuid) AS identique
        FROM mouvement_stock WHERE id = ${m.id}::uuid`,
  );
  const ligne = r.rows[0];
  return ligne === undefined ? null : ligne.identique;
}

type RecolteVisee = {
  readonly ferme_id: string;
  readonly type: string;
  readonly remplace_sorte: RemplacementEvenement['sorte'] | null;
  /** detail.quantite (nombre pour une récolte : CHECK de la base et règles du cœur). */
  readonly quantite: number | null;
};

/**
 * Somme des mouvements déjà écrits sur `articleId` pour toute la chaîne de la récolte `recolteId`
 * (l'origine, ses corrections et leurs annulations). Verrou transactionnel sur la récolte
 * d'origine d'abord : deux lots qui annulent ou corrigent la même récolte passent l'un après
 * l'autre, et le second voit le mouvement du premier.
 */
async function sommeDeLaChaine(tx: TransactionDb, recolteId: string, articleId: string): Promise<number> {
  const racine = await tx.execute<{ id: string }>(
    sql`WITH RECURSIVE montee(id, parent, profondeur) AS (
          SELECT id, remplace_evenement_id, 0 FROM evenement WHERE id = ${recolteId}::uuid
          UNION ALL
          SELECT e.id, e.remplace_evenement_id, m.profondeur + 1
          FROM evenement e JOIN montee m ON e.id = m.parent
          WHERE m.profondeur < ${PROFONDEUR_MAX_CHAINE}
        )
        SELECT id::text AS id FROM montee WHERE parent IS NULL`,
  );
  const origine = racine.rows[0]?.id ?? recolteId;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chaine-recolte:${origine}`}, 0))`);
  const somme = await tx.execute<{ somme: number }>(
    sql`WITH RECURSIVE chaine(id) AS (
          SELECT ${origine}::uuid
          UNION
          SELECT e.id FROM evenement e JOIN chaine c ON e.remplace_evenement_id = c.id
        )
        SELECT coalesce(sum(m.quantite), 0)::float8 AS somme
        FROM mouvement_stock m
        WHERE m.recolte_id IN (SELECT id FROM chaine) AND m.article_stock_id = ${articleId}::uuid`,
  );
  return somme.rows[0]?.somme ?? 0;
}

/** Article et récolte visés, dans la ferme du mouvement ; puis le mouvement borné (décision 3). */
async function verifierMouvement(tx: TransactionDb, m: MouvementLu): Promise<Refus | null> {
  const article = await lireReference(tx, 'article_stock', m.articleStockId);
  if (article === undefined) return invalide('article de stock introuvable', m.fermeId);
  if (article.ferme_id !== m.fermeId) return { motif: 'ferme_interdite', precision: "article d'une autre ferme", fermeId: m.fermeId };
  if (article.supprimee) return invalide('article de stock supprimé', m.fermeId);

  const r = await tx.execute<RecolteVisee>(
    sql`SELECT ferme_id::text AS ferme_id, type, remplace_sorte,
               CASE WHEN jsonb_typeof(detail -> 'quantite') = 'number' THEN (detail ->> 'quantite')::float8 END AS quantite
        FROM evenement WHERE id = ${m.recolteId}::uuid FOR SHARE`,
  );
  const recolte = r.rows[0];
  if (recolte === undefined) return invalide('récolte liée introuvable', m.fermeId);
  if (recolte.ferme_id !== m.fermeId) return { motif: 'ferme_interdite', precision: "récolte d'une autre ferme", fermeId: m.fermeId };
  if (recolte.type !== 'recolte' || recolte.quantite === null) return invalide("l'événement lié n'est pas une récolte", m.fermeId);

  const somme = recolte.remplace_sorte === null ? 0 : await sommeDeLaChaine(tx, m.recolteId, m.articleStockId);
  const erreur = verifierMouvementRecolte(m.quantite, { remplaceSorte: recolte.remplace_sorte, quantite: recolte.quantite }, somme);
  return erreur === null ? null : invalide(erreur.message, m.fermeId);
}

/**
 * PUT sur `mouvement_stock` : ajout seul. Renvoi identique accepté sans rien écrire (vérifié
 * avant la règle du mouvement borné, que le mouvement déjà écrit fausserait) ; même id avec
 * d'autres valeurs : 'ajout_seul'.
 */
export async function ecrireMouvement(tx: TransactionDb, ctx: Contexte, e: PutRecu, fermeId: string, auteurId: Id<'Utilisateur'>): Promise<Refus | null> {
  const ligne = avecId(e);
  if ('idGlisse' in ligne) return invalide('colonne inconnue : id', fermeId);
  const lecture = validerMouvementStock(ligne);
  if (!lecture.ok) return invalide(lecture.erreur.message, fermeId);
  const v = lecture.valeur;
  const m: MouvementLu = {
    id: v.id,
    fermeId: v.fermeId,
    articleStockId: v.articleStockId,
    date: v.date,
    quantite: v.quantite,
    recolteId: v.recolteId,
  };

  const existant = await mouvementIdentique(tx, m);
  if (existant !== null) return existant ? null : { motif: 'ajout_seul', fermeId: m.fermeId };

  const refus = await verifierMouvement(tx, m);
  if (refus !== null) return refus;

  const maintenant = ctx.maintenant();
  const [ecrit] = await tx
    .insert(mouvementStock)
    .values({
      id: v.id,
      fermeId: v.fermeId,
      articleStockId: v.articleStockId,
      date: v.date,
      quantite: v.quantite,
      motif: 'recolte',
      recolteId: v.recolteId,
      creeLe: maintenant,
    })
    .onConflictDoNothing({ target: mouvementStock.id })
    .returning({ id: mouvementStock.id });
  if (ecrit === undefined) return (await mouvementIdentique(tx, m)) === true ? null : { motif: 'ajout_seul', fermeId: m.fermeId };
  await historiser(tx, ctx, 'mouvement_stock', m.id, m.fermeId, auteurId, maintenant);
  return null;
}
