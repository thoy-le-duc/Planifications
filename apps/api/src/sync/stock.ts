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
 *
 * T10d : la ferme est filtrée dans la requête même du verrou. Une ligne d'une autre ferme n'est
 * ni lue ni verrouillée, et se comporte exactement comme une ligne inexistante.
 */
import {
  validerArticleStock,
  mouvementAttendu,
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
import { lireMaillons, maillonEnVigueur, PROFONDEUR_MAX_CHAINE, visibleParLaFerme, type TransactionDb } from './references.ts';

/** Écriture PUT reçue : id de l'écriture PowerSync et colonnes (lues sans confiance). */
export interface PutRecu {
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

/** Ligne référencée, visible par la ferme : si elle est supprimée, et son espèce (variété). */
interface LigneReference {
  readonly supprimee: boolean;
  /** Colonnes lues en plus (`extra`) : espèce d'une variété ou d'un article, unité d'un article. */
  readonly espece_id?: string;
  readonly unite?: string;
}

/** Colonnes reçues + id de l'écriture ; un `id` glissé dans les données est refusé (colonne inconnue). */
function avecId(e: PutRecu): Readonly<Record<string, unknown>> | { readonly idGlisse: true } {
  return Object.hasOwn(e.donnees, 'id') ? { idGlisse: true } : { ...e.donnees, id: e.id };
}

const invalide = (precision: string, fermeId: string): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

/**
 * Ligne `table` d'identifiant `id` visible par la ferme `fermeId` (la sienne, ou la bibliothèque
 * commune : ferme_id nul), verrouillée (FOR SHARE) jusqu'à la fin de la transaction ; undefined
 * si elle n'existe pas OU si elle est d'une autre ferme (T10d : filtre et verrou dans la même
 * requête, la ligne d'une autre ferme n'est jamais verrouillée). `extra` : colonnes lues en plus.
 * Table et colonnes sont des constantes de ce fichier, id et ferme des paramètres.
 */
async function lireReference(
  tx: TransactionDb,
  table: 'espece' | 'variete' | 'article_stock',
  id: string,
  fermeId: string,
  extra: ReturnType<typeof sql> = sql``,
): Promise<LigneReference | undefined> {
  const r = await tx.execute<{ supprimee: boolean; espece_id?: string; unite?: string }>(
    sql`SELECT supprime_le IS NOT NULL AS supprimee ${extra}
        FROM ${sql.identifier(table)} WHERE id = ${id}::uuid AND ${visibleParLaFerme(fermeId, table !== 'article_stock')} FOR SHARE`,
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
  const espece = await lireReference(tx, 'espece', a.especeId, a.fermeId);
  if (espece === undefined) return invalide('espèce introuvable', a.fermeId);
  if (espece.supprimee) return invalide('espèce supprimée', a.fermeId);
  if (a.varieteId === null) return null;
  const variete = await lireReference(tx, 'variete', a.varieteId, a.fermeId, sql`, espece_id::text AS espece_id`);
  if (variete === undefined) return invalide('variété introuvable', a.fermeId);
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

/**
 * Le mouvement `m.id` existe-t-il déjà avec exactement ces valeurs ? null s'il n'existe pas.
 * Rattaché à une correction ou une annulation, la quantité n'est pas comparée (décision 6 de
 * T10g : le serveur a écrit son propre écart, le téléphone renvoie le sien).
 */
async function mouvementIdentique(tx: TransactionDb, m: MouvementLu): Promise<boolean | null> {
  const r = await tx.execute<{ identique: boolean }>(
    sql`SELECT (ferme_id = ${m.fermeId}::uuid
               AND article_stock_id = ${m.articleStockId}::uuid
               AND date = ${m.date}::date
               -- T10g, décision 6 : sur un remplacement, la quantité écrite est celle du serveur ;
               -- le renvoi porte celle du téléphone, elle n'est pas comparée.
               AND (quantite = ${String(m.quantite)}::numeric
                    OR EXISTS (SELECT 1 FROM evenement r WHERE r.id = mouvement_stock.recolte_id AND r.remplace_sorte IS NOT NULL))
               AND motif = 'recolte'
               AND recolte_id IS NOT DISTINCT FROM ${m.recolteId}::uuid) AS identique
        FROM mouvement_stock WHERE id = ${m.id}::uuid`,
  );
  const ligne = r.rows[0];
  return ligne === undefined ? null : ligne.identique;
}

interface RecolteVisee {
  readonly type: string;
  readonly remplace_sorte: RemplacementEvenement['sorte'] | null;
  /** detail.quantite (nombre pour une récolte : CHECK de la base et règles du cœur). */
  readonly quantite: number | null;
  readonly unite: string | null;
  /** Espèce de la série ou de la campagne de la récolte, null sans culture. */
  readonly espece_id: string | null;
}

/** Ce que la base sait de la chaîne d'une récolte (l'origine, ses corrections, leurs annulations). */
interface Chaine {
  /** Somme des mouvements de la chaîne, par article. */
  readonly sommes: ReadonlyMap<string, number>;
  /** detail.quantite du maillon en vigueur (`maillonEnVigueur`) ; 0 si la chaîne est annulée. */
  readonly quantiteEnVigueur: number;
  readonly annulee: boolean;
}

/**
 * Chaîne de la récolte `recolteId`, ou null si elle dépasse PROFONDEUR_MAX_CHAINE niveaux
 * (refusée : jamais de somme partielle). Appelée sous le verrou de la ferme (upload.ts) : deux
 * lots qui touchent le stock d'une même ferme passent l'un après l'autre, et le second voit les
 * mouvements du premier.
 */
async function lireChaine(tx: TransactionDb, recolteId: string, fermeId: string): Promise<Chaine | null> {
  const maillons = await lireMaillons(tx, recolteId, fermeId);
  if (maillons === null) return null;
  const sommes = await tx.execute<{ article: string; somme: number }>(
    sql`SELECT article_stock_id::text AS article, sum(quantite)::float8 AS somme FROM mouvement_stock
        WHERE recolte_id = ANY(${sql.param(maillons.map((l) => l.id))}::uuid[]) GROUP BY article_stock_id`,
  );
  return {
    sommes: new Map(sommes.rows.map((r) => [r.article, r.somme])),
    quantiteEnVigueur: maillonEnVigueur(maillons)?.quantite ?? 0,
    annulee: maillons.some((l) => l.remplace_sorte === 'annulation'),
  };
}

/**
 * Article et récolte visés, dans la ferme du mouvement ; un seul article par chaîne, de l'unité
 * et de l'espèce de la récolte (B2) ; puis la quantité à écrire :
 *   - rattaché à la récolte d'origine : celle reçue, bornée (décision 3, B1) ;
 *   - rattaché à une correction ou une annulation (T10g, décision 6) : l'écart calculé ici, sous
 *     le verrou de la ferme, et non celui du téléphone (calculé sur sa chaîne locale, peut-être en
 *     retard) : quantité en vigueur de toute la chaîne (0 si elle est annulée) − somme des
 *     mouvements déjà écrits de la chaîne sur l'article (`mouvementAttendu`). Le stock de la
 *     chaîne vaut alors toujours la quantité en vigueur : jamais plus (non-inflation, T10c/T10d),
 *     jamais moins. Écart nul (annulation redondante, correction qui n'est pas en vigueur) :
 *     refusé, rien à reporter au stock (T10d).
 */
async function verifierMouvement(tx: TransactionDb, m: MouvementLu): Promise<{ readonly refus: Refus } | { readonly quantite: number }> {
  const refuser = (precision: string) => ({ refus: invalide(precision, m.fermeId) });
  const article = await lireReference(tx, 'article_stock', m.articleStockId, m.fermeId, sql`, unite, espece_id::text AS espece_id`);
  if (article === undefined) return refuser('article de stock introuvable');
  if (article.supprimee) return refuser('article de stock supprimé');

  // Ferme dans la requête du verrou (T10d) : la récolte d'une autre ferme n'est ni lue ni verrouillée.
  const r = await tx.execute<{
    type: string;
    remplace_sorte: RecolteVisee['remplace_sorte'];
    quantite: number | null;
    unite: string | null;
    espece_id: string | null;
  }>(
    sql`SELECT e.type, e.remplace_sorte,
               CASE WHEN jsonb_typeof(e.detail -> 'quantite') = 'number' THEN (e.detail ->> 'quantite')::float8 END AS quantite,
               e.detail ->> 'unite' AS unite,
               coalesce(s.espece_id, p.espece_id)::text AS espece_id
        FROM evenement e
        LEFT JOIN serie s ON s.id = e.serie_id
        LEFT JOIN campagne c ON c.id = e.campagne_id
        LEFT JOIN plantation p ON p.id = c.plantation_id
        WHERE e.id = ${m.recolteId}::uuid AND e.ferme_id = ${m.fermeId}::uuid FOR SHARE OF e`,
  );
  const recolte: RecolteVisee | undefined = r.rows[0];
  if (recolte === undefined) return refuser('récolte liée introuvable');
  if (recolte.type !== 'recolte' || recolte.quantite === null) return refuser("l'événement lié n'est pas une récolte");

  const chaine = await lireChaine(tx, m.recolteId, m.fermeId);
  if (chaine === null) return refuser(`chaîne de corrections trop longue (${String(PROFONDEUR_MAX_CHAINE)} au plus)`);

  // B2 : un seul article par chaîne ; le premier est de l'unité et de l'espèce de la récolte.
  const articlesDeLaChaine = [...chaine.sommes.keys()];
  if (articlesDeLaChaine.length > 0) {
    if (!articlesDeLaChaine.includes(m.articleStockId)) return refuser("la récolte est déjà en stock sur un autre article");
  } else {
    if (article.unite !== recolte.unite) return refuser("article d'une autre unité que la récolte");
    if (recolte.espece_id !== null && article.espece_id !== recolte.espece_id) return refuser("article d'une autre espèce que la culture récoltée");
  }

  const somme = chaine.sommes.get(m.articleStockId) ?? 0;
  if (recolte.remplace_sorte === null) {
    const erreur = verifierMouvementRecolte(m.quantite, { remplaceSorte: null, quantite: recolte.quantite }, somme, {
      quantiteEnVigueur: chaine.quantiteEnVigueur,
      annulee: chaine.annulee,
    });
    return erreur === null ? { quantite: m.quantite } : refuser(erreur.message);
  }
  const ecart = mouvementAttendu({ remplaceSorte: recolte.remplace_sorte, quantite: chaine.annulee ? 0 : chaine.quantiteEnVigueur }, somme) ?? 0;
  if (ecart === 0) return refuser('rien à reporter au stock : il vaut déjà la quantité en vigueur de la récolte');
  return { quantite: ecart };
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

  const verifie = await verifierMouvement(tx, m);
  if ('refus' in verifie) return verifie.refus;

  const maintenant = ctx.maintenant();
  const [ecrit] = await tx
    .insert(mouvementStock)
    .values({
      id: v.id,
      fermeId: v.fermeId,
      articleStockId: v.articleStockId,
      date: v.date,
      quantite: verifie.quantite,
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
