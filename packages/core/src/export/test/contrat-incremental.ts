/**
 * Contrat de la construction incrémentale de l'archive (T15c, docs/backlog/T15c-export-rapide.md) :
 * l'API que les tests attendent de `src/export/index.ts`, réexportée par `@planif/core`.
 *
 *   creerConstructeurArchive(options: OptionsConstructeurArchive): ConstructeurArchive
 *
 * Le téléphone lit la base table par table (≈ 6 s sur la ferme de T07) ; il ne doit plus
 * attendre la fin de la lecture pour construire l'archive. Il donne chaque table au
 * constructeur dès qu'elle est lue :
 *
 *   const c = creerConstructeurArchive({ fermeId, genereLe, date, compresseur, avancement, signal });
 *   for (const nom of Object.keys(TABLES_EXPORTEES)) await c.ajouterTable(nom, await lire(nom));
 *   const { octets, lignes } = await c.terminer();
 *
 * Règles :
 *   - `ajouterTable` est appelé au plus une fois par table, dans l'ordre de TABLES_EXPORTEES
 *     (`membre` précède `utilisateur`). Une table jamais ajoutée est vide. Les lignes sont celles
 *     que la base rend, filtrées ou non : le constructeur refiltre comme `construireArchive`.
 *   - Archive identique au bit près à celle de `construireArchive(entree, options)` sur la même
 *     entrée et le même compresseur : mêmes octets, même `lignes`.
 *   - Au fil de la lecture : une table ajoutée est déjà prise en charge (son CSV est produit et
 *     envoyé au compresseur) sans attendre `terminer()`.
 *   - `signal` (options) : annulation entre deux appels, promesse rejetée (`signal.reason`),
 *     plus aucun calcul ni appel au compresseur ensuite (mêmes règles que `construireArchive`).
 *   - `avancement` : mêmes règles que `construireArchive` (entiers, jamais en recul, 0 ≤ fait ≤
 *     total) ; le dernier appel, fait par `terminer()`, a fait = total.
 */
import type { ArchiveConstruite, EntreeExport, LigneLocale, ModuleExport, OptionsArchive } from './contrat.ts';

export interface OptionsConstructeurArchive extends OptionsArchive {
  readonly fermeId: string;
  /** Instant ISO de l'export (ferme.json `genere_le`). */
  readonly genereLe: string;
}

export interface ConstructeurArchive {
  /** Donne les lignes d'une table, au fil de la lecture. */
  ajouterTable(nom: string, lignes: readonly LigneLocale[]): Promise<void>;
  /** Fin de la lecture : rend l'archive complète. */
  terminer(): Promise<ArchiveConstruite>;
}

export interface ModuleExportIncremental extends ModuleExport {
  creerConstructeurArchive(options: OptionsConstructeurArchive): ConstructeurArchive;
}

const CHEMIN_COEUR = '../index.ts';

/** `creerConstructeurArchive`, ou une erreur explicite tant qu'il n'existe pas. */
export async function exigerConstructeur(): Promise<ModuleExportIncremental> {
  const m = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleExportIncremental>;
  if (typeof m.creerConstructeurArchive !== 'function') throw new Error('@planif/core n’exporte pas encore creerConstructeurArchive (T15c)');
  return m as ModuleExportIncremental;
}

/** Donne à un constructeur toutes les tables d'une entrée, dans l'ordre de TABLES_EXPORTEES. */
export async function remplir(m: ModuleExportIncremental, c: ConstructeurArchive, entree: EntreeExport): Promise<void> {
  for (const nom of Object.keys(m.TABLES_EXPORTEES)) await c.ajouterTable(nom, entree.tables[nom] ?? []);
}
