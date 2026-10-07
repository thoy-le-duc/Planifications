/**
 * T28s (Q31) : l'origine du plan d'une ferme (`ferme.origine_plan`), seule colonne de `ferme` que
 * le téléphone écrit, et les droits du placement réel. Contrat : en-tête de
 * structure-placement.integration.test.ts.
 *
 * - PATCH de `origine_plan` seulement (texte JSON {latitude, longitude}, ou nul). Toute autre
 *   colonne reçue : refusée, rien ne change. PUT et DELETE d'une ferme : 'table_interdite'
 *   (upload.ts).
 * - Ferme dont l'auteur n'est pas membre actif (voisine, membre retiré, invité) : refusée comme une
 *   ligne introuvable (T10d), sans ferme dans le refus.
 * - Gérant seulement (Q31). Un renvoi de la même valeur est accepté sans rien écrire, par tout
 *   membre (réponse perdue).
 * - Figée (décision du chef) : l'origine ne se pose, ne se modifie ni ne s'efface que si la ferme
 *   n'a AUCUN placement (bâtiment non supprimé, zone non supprimée avec contour, emplacement non
 *   supprimé placé) ; en retour, aucun placement sans origine (structure.ts). Les écritures plus
 *   haut dans le même lot comptent (même transaction) : origine puis bâtiment passe, l'annulation
 *   en ordre inverse (bâtiment supprimé, puis origine effacée) aussi.
 * - Écrite sous le verrou consultatif de la ferme (upload.ts) ; la ligne de la ferme est relue
 *   FOR NO KEY UPDATE (ne bloque pas les lignes qui la référencent), historique « Ferme ».
 */
import type { Id } from '@planif/core';
import { modification } from '@planif/db';
import { sql } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Contexte } from '../dependances.ts';
import {
  PRECISION_FERME_SEULE_ORIGINE,
  PRECISION_INTROUVABLE,
  PRECISION_ORIGINE_FIGEE,
  PRECISION_ORIGINE_INVALIDE,
  PRECISION_SEUL_LE_GERANT,
} from './messages.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

/** Texte JSON de l'origine reçu : au plus ce nombre de caractères, mesuré avant de le lire. */
const ORIGINE_CARACTERES_MAX = 200;

interface Origine {
  readonly latitude: number;
  readonly longitude: number;
}

const invalide = (precision: string, fermeId: string | null): Refus => ({ motif: 'ecriture_invalide', precision, fermeId });

const coordonnee = (v: unknown, borne: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -borne && v <= borne;

/** Origine reçue (texte JSON, ou nul) relue : {latitude, longitude} seulement, ou null ; undefined si illisible. */
function lireOrigine(v: unknown): Origine | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > ORIGINE_CARACTERES_MAX) return undefined;
  let lu: unknown;
  try {
    lu = JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
  if (typeof lu !== 'object' || lu === null || Array.isArray(lu)) return undefined;
  const { latitude, longitude } = lu as { latitude?: unknown; longitude?: unknown };
  return coordonnee(latitude, 90) && coordonnee(longitude, 180) ? { latitude, longitude } : undefined;
}

/**
 * Fermes de `fermes` (celles dont l'auteur est membre actif) où il est gérant, relues dans la
 * transaction du lot : le rôle est celui de chaque ferme visée, jamais celui d'une autre. Lignes
 * `membre` verrouillées (FOR SHARE) jusqu'à la fin du lot : le rôle ne change pas pendant qu'on écrit.
 */
export async function fermesGerees(tx: TransactionDb, utilisateurId: Id<'Utilisateur'>, fermes: ReadonlySet<string>): Promise<ReadonlySet<string>> {
  if (fermes.size === 0) return new Set();
  const r = await tx.execute<{ ferme_id: string }>(
    sql`SELECT ferme_id::text AS ferme_id FROM membre
        WHERE utilisateur_id = ${utilisateurId}::uuid AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL
          AND ferme_id = ANY(${sql.param([...fermes])}::uuid[])
        FOR SHARE`,
  );
  return new Set(r.rows.map((l) => l.ferme_id));
}

/** Fermes visées par les PATCH de `ferme` du lot, parmi celles de l'auteur : à verrouiller (upload.ts). */
export function fermesDesOrigines(ecritures: readonly { readonly op: string | null; readonly table: string; readonly id: string }[], fermes: ReadonlySet<string>): string[] {
  return ecritures
    .filter((e) => e.table === 'ferme' && e.op === 'PATCH' && estUuid(e.id))
    .map((e) => e.id.toLowerCase())
    .filter((f) => fermes.has(f));
}

/** La ferme a-t-elle un placement (bâtiment, zone avec contour, emplacement placé, non supprimés) ? */
async function aUnPlacement(tx: TransactionDb, fermeId: string): Promise<boolean> {
  const r = await tx.execute<{ existe: boolean }>(
    sql`SELECT (
          EXISTS (SELECT 1 FROM batiment WHERE ferme_id = ${fermeId}::uuid AND supprime_le IS NULL)
          OR EXISTS (SELECT 1 FROM zone WHERE ferme_id = ${fermeId}::uuid AND supprime_le IS NULL AND contour IS NOT NULL)
          OR EXISTS (SELECT 1 FROM emplacement WHERE ferme_id = ${fermeId}::uuid AND supprime_le IS NULL AND placement_x_m IS NOT NULL)
        ) AS existe`,
  );
  return r.rows[0]?.existe === true;
}

/** PATCH de `ferme` (origine du plan seulement), dans la transaction du lot : null si accepté, sinon le refus. */
export async function ecrireOrigine(
  tx: TransactionDb,
  ctx: Contexte,
  e: { readonly id: string; readonly donnees: Readonly<Record<string, unknown>> },
  fermes: ReadonlySet<string>,
  gerees: ReadonlySet<string>,
  auteurId: Id<'Utilisateur'>,
): Promise<Refus | null> {
  const fermeId = estUuid(e.id) ? e.id.toLowerCase() : null;
  // Ferme dont l'auteur n'est pas membre actif : comme une ligne introuvable (T10d), sans rien lire.
  if (fermeId === null || !fermes.has(fermeId)) return invalide(PRECISION_INTROUVABLE, null);
  if (Object.keys(e.donnees).some((c) => c !== 'origine_plan')) return invalide(PRECISION_FERME_SEULE_ORIGINE, fermeId);
  if (!Object.hasOwn(e.donnees, 'origine_plan')) return null;
  const origine = lireOrigine(e.donnees.origine_plan);
  if (origine === undefined) return invalide(PRECISION_ORIGINE_INVALIDE, fermeId);

  const r = await tx.execute<{ origine: Origine | null; texte: string }>(
    sql`SELECT origine_plan AS origine, to_jsonb(f)::text AS texte FROM ferme f
        WHERE f.id = ${fermeId}::uuid FOR NO KEY UPDATE`,
  );
  const existante = r.rows[0];
  if (existante === undefined) return invalide(PRECISION_INTROUVABLE, null);
  const avant = existante.origine;
  // Renvoi de la même valeur (réponse perdue) : accepté, rien d'écrit.
  if (avant === null ? origine === null : origine !== null && avant.latitude === origine.latitude && avant.longitude === origine.longitude) return null;
  if (!gerees.has(fermeId)) return invalide(PRECISION_SEUL_LE_GERANT, fermeId);
  if (await aUnPlacement(tx, fermeId)) return invalide(PRECISION_ORIGINE_FIGEE, fermeId);

  const maintenant = ctx.maintenant();
  await tx.execute(
    sql`UPDATE ferme SET origine_plan = ${origine === null ? null : JSON.stringify(origine)}::jsonb, modifie_le = ${maintenant}::timestamptz
        WHERE id = ${fermeId}::uuid`,
  );
  await tx.insert(modification).values({
    id: ctx.nouvelId(),
    fermeId: fermeId as Id<'Ferme'>,
    nomTable: 'Ferme',
    ligneId: fermeId,
    auteurId,
    horodatage: maintenant,
    operation: 'modification',
    avant: sql`${existante.texte}::jsonb`,
    apres: sql`(SELECT to_jsonb(f) FROM ferme f WHERE f.id = ${fermeId}::uuid)`,
    propositionId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
  return null;
}
