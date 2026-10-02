/**
 * T10k : court résumé de la saisie refusée (docs/backlog/T10k-refus-saisie.md), rangé dans les
 * colonnes saisie_* de refus_synchro et seul, avec le motif, à descendre sur le téléphone de
 * l'auteur. Contrat : en-tête de resume-refus.integration.test.ts.
 *
 * - Seulement ce que le téléphone a envoyé, lu sans confiance : un type connu, un jour valide,
 *   et pour une récolte une quantité finie et une unité de récolte. Jamais la note ni aucun autre
 *   texte libre reçu ; un champ illisible reste NULL, jamais un 500.
 * - La culture (« Espèce » ou « Espèce Variété ») est LUE EN BASE, et seulement si la série ou la
 *   campagne désignée appartient à la ferme de l'événement ET que l'utilisateur est membre accepté
 *   de cette ferme au moment du lot (décision du chef, règle la plus stricte) : jamais le nom d'une
 *   culture d'une autre ferme, même désignée par un id valide.
 * - Une série (ou campagne) supprimée de sa propre ferme garde son nom dans le résumé : voulu,
 *   pour que le maraîcher reconnaisse la saisie refusée.
 * - Quantité d'une récolte : seulement un nombre fini, positif ou nul et au plus QUANTITE_MAX_RESUME.
 */
import { estDateValide, type DateCalendaire, type TypeEvenement, type UniteRecolte } from '@planif/core';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { estUuid } from '../auth/jetons.ts';

/** Longueur au plus de la culture du résumé (unités UTF-16, comme `String.length`). */
export const LONGUEUR_MAX_CULTURE = 80;
/** Quantité au plus du résumé (incluse) ; au-delà, ou négative, elle n'est pas résumée. */
export const QUANTITE_MAX_RESUME = 1_000_000;

const TYPES: readonly TypeEvenement[] = ['realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'];
const UNITES: readonly UniteRecolte[] = ['kg', 'botte', 'piece', 'barquette'];

/** Résumé tel qu'il s'écrit dans refus_synchro (clés du schéma Drizzle). */
export interface ResumeSaisie {
  readonly saisieType: TypeEvenement | null;
  readonly saisieCulture: string | null;
  readonly saisieDate: DateCalendaire | null;
  readonly saisieQuantite: number | null;
  readonly saisieUnite: UniteRecolte | null;
}

export const RESUME_VIDE: ResumeSaisie = { saisieType: null, saisieCulture: null, saisieDate: null, saisieQuantite: null, saisieUnite: null };

/** Ce qu'il faut lire en base pour la culture d'un événement refusé. */
interface Designation {
  readonly ferme: string;
  readonly serie: string | null;
  readonly campagne: string | null;
}

const uuidOuNul = (v: unknown): string | null => (estUuid(v) ? v.toLowerCase() : null);

function parmi<T extends string>(liste: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (liste as readonly string[]).includes(v) ? (v as T) : null;
}

/** `detail` reçu en texte JSON ou en objet ; null s'il est illisible. */
function lireDetail(v: unknown): Readonly<Record<string, unknown>> | null {
  let d: unknown = v;
  if (typeof v === 'string') {
    try {
      d = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
}

/**
 * Nom de culture affichable : sans caractère de contrôle ni de format (supprimés), séparateurs de
 * ligne et espaces répétés ramenés à une espace, bords retirés, LONGUEUR_MAX_CULTURE au plus
 * (coupé sur un caractère entier, « … » en fin) ; null s'il ne reste rien.
 */
export function nettoyerCulture(brut: string): string | null {
  const propre = brut
    .replace(/[\t\n\v\f\r\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (propre === '') return null;
  if (propre.length <= LONGUEUR_MAX_CULTURE) return propre;
  let coupe = '';
  for (const c of propre) {
    if (coupe.length + c.length > LONGUEUR_MAX_CULTURE - 1) break;
    coupe += c;
  }
  const fin = coupe.trimEnd();
  return fin === '' ? null : `${fin}…`;
}

/** Résumé sans la culture (lue en base ensuite) : ce que le téléphone a envoyé, lu sans confiance. */
function resumeRecu(donnees: Readonly<Record<string, unknown>>): ResumeSaisie {
  const type = parmi(TYPES, donnees.type);
  const date = typeof donnees.date === 'string' && estDateValide(donnees.date) ? donnees.date : null;
  if (type !== 'recolte') return { ...RESUME_VIDE, saisieType: type, saisieDate: date };
  const detail = lireDetail(donnees.detail);
  const quantite = detail?.quantite;
  return {
    ...RESUME_VIDE,
    saisieType: type,
    saisieDate: date,
    saisieQuantite: typeof quantite === 'number' && Number.isFinite(quantite) && quantite >= 0 && quantite <= QUANTITE_MAX_RESUME ? quantite : null,
    saisieUnite: parmi(UNITES, detail?.unite),
  };
}

/** Écriture refusée dont on résume la saisie. */
export interface EcritureAResumer {
  readonly table: string;
  readonly donnees: Readonly<Record<string, unknown>> | null;
}

/**
 * Résumés des écritures `ecritures` (même ordre) : un événement seulement (les autres tables, et
 * des données absentes, donnent RESUME_VIDE). `fermes` : fermes dont l'utilisateur est membre
 * accepté au moment du lot. Une seule lecture en base pour tout le paquet.
 */
export async function resumerSaisies(
  db: Pick<NodePgDatabase, 'execute'>,
  ecritures: readonly EcritureAResumer[],
  fermes: ReadonlySet<string>,
): Promise<ResumeSaisie[]> {
  const recus = ecritures.map((e) => (e.table === 'evenement' && e.donnees !== null ? resumeRecu(e.donnees) : RESUME_VIDE));
  const designations = ecritures.map((e): Designation | null => {
    if (e.table !== 'evenement' || e.donnees === null) return null;
    const ferme = uuidOuNul(e.donnees.ferme_id);
    if (ferme === null || !fermes.has(ferme)) return null;
    const serie = uuidOuNul(e.donnees.serie_id);
    const campagne = uuidOuNul(e.donnees.campagne_id);
    return serie === null && campagne === null ? null : { ferme, serie, campagne };
  });
  const series = [...new Set(designations.flatMap((d) => d?.serie ?? []))];
  const campagnes = [...new Set(designations.flatMap((d) => d?.campagne ?? []))];
  if (series.length === 0 && campagnes.length === 0) return recus;

  // Seulement dans les fermes de l'utilisateur ; la ferme de chaque ligne est comparée ensuite à
  // celle de l'événement.
  const { rows } = await db.execute<{ sorte: 'serie' | 'campagne'; id: string; ferme_id: string; espece: string; variete: string | null }>(sql`
    SELECT 'serie' AS sorte, s.id::text AS id, s.ferme_id::text AS ferme_id, es.nom AS espece, v.nom AS variete
    FROM serie s
    JOIN espece es ON es.id = s.espece_id
    LEFT JOIN variete v ON v.id = s.variete_id
    WHERE s.id = ANY(${sql.param(series)}::uuid[]) AND s.ferme_id = ANY(${sql.param([...fermes])}::uuid[])
    UNION ALL
    SELECT 'campagne', c.id::text, c.ferme_id::text, es.nom, v.nom
    FROM campagne c
    JOIN plantation p ON p.id = c.plantation_id AND p.ferme_id = c.ferme_id
    JOIN espece es ON es.id = p.espece_id
    LEFT JOIN variete v ON v.id = p.variete_id
    WHERE c.id = ANY(${sql.param(campagnes)}::uuid[]) AND c.ferme_id = ANY(${sql.param([...fermes])}::uuid[])`);
  const cultures = new Map<string, (typeof rows)[number]>(rows.map((r) => [`${r.sorte}:${r.id}`, r]));

  return recus.map((resume, i) => {
    const d = designations[i] ?? null;
    if (d === null) return resume;
    // La série d'abord, sinon la plantation de la campagne ; toujours de la ferme de l'événement.
    const deLaFerme = (cle: string) => {
      const l = cultures.get(cle);
      return l?.ferme_id === d.ferme ? l : undefined;
    };
    const ligne = (d.serie === null ? undefined : deLaFerme(`serie:${d.serie}`)) ?? (d.campagne === null ? undefined : deLaFerme(`campagne:${d.campagne}`));
    if (ligne === undefined) return resume;
    const nom = ligne.variete === null ? ligne.espece : `${ligne.espece} ${ligne.variete}`;
    return { ...resume, saisieCulture: nettoyerCulture(nom) };
  });
}
