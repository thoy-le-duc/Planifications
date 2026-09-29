/**
 * Contrat de l'export côté téléphone (T15, docs/backlog/T15-export.md, puis T15b,
 * docs/backlog/T15b-export-leger.md) : ce que les tests
 * attendent de `@planif/sync` (src/index.ts) en plus du contrat de T10 (./contrat.ts).
 * Partie pure (fichiers, CSV, JSON, ZIP) : packages/core/src/export/test/contrat.ts.
 *
 * Chargé dynamiquement (`chargerExportSync`) : tant que `exporterFerme` n'existe pas, les tests
 * échouent sur son absence au lieu de casser le typage du dépôt.
 *
 * ── exporterFerme ───────────────────────────────────────────────────────────────────────────
 *
 *   exporterFerme(porte: PorteDonnees, options: OptionsExportFerme): Promise<ArchiveExport>
 *
 * Construit l'archive complète de la ferme `options.fermeId` sur le téléphone, depuis la base
 * locale : hors ligne, sans aucun réseau (ni fetch, ni PowerSync, ni API).
 *   - Lecture UNIQUEMENT par `porte.lire` : jamais `ecrire`, `saisirEvenement`, `surveiller`.
 *     Un `SELECT` par table exportée (`TABLES_EXPORTEES` de @planif/core), dont la clause
 *     `FROM` nomme la table directement (`FROM zone`, `FROM "zone"`) ; un filtre SQL
 *     (`WHERE ferme_id = ? OR ferme_id IS NULL`) est permis, pas obligatoire : c'est
 *     `construireExport` qui garantit le filtrage. `ORDER BY id` conseillé (archive stable).
 *   - Jamais de lecture de `refus_synchro` (exclue de l'export) : la table n'apparaît dans
 *     aucune requête.
 *   - Puis (T15b) `construireArchive({ fermeId, genereLe, tables }, { date: jour, compresseur,
 *     avancement })` de @planif/core : l'archive légère, compressée, écrite morceau par morceau
 *     (plus jamais `construireExport` + `creerZip`, qui tiennent tous les textes à la fois).
 *     Contenu de chaque entrée : exactement celui de `construireExport` (formules neutralisées
 *     comprises, voir packages/core/src/export/test/contrat.ts).
 *   - Compression (T15b) : `options.compresseur` s'il est donné ; sinon, par défaut, un
 *     compresseur construit sur `CompressionStream('deflate-raw')` du fil courant (navigateur,
 *     et Node 22, qui l'a en global) ; seulement s'il n'existe pas, archive stockée. Toutes les
 *     entrées de l'archive de T07 sont donc en deflate (méthode 8), relues par node:zlib,
 *     `unzip -t` et Python `zipfile`, et l'archive fait moins de 8 Mo (37 Mo stockée en T15).
 *   - Avancement (T15b) : `options.avancement`, s'il est donné, reçoit les appels de
 *     `construireArchive` (mêmes règles : entiers, `fait` jamais en recul, `total` constant,
 *     dernier appel fait === total). La lecture de la base peut y compter (le total est alors
 *     connu dès le départ et reste constant). C'est la barre d'avancement de l'écran.
 *   - Mémoire (T15b) : au pic, ce qu'`exporterFerme` ajoute au-dessus de la mémoire d'avant
 *     l'appel reste sous (taille des lignes lues) + 2 × taille de l'archive + 8 Mio : les
 *     lignes lues sont l'entrée, inévitables ; tout le reste suit la règle de `construireArchive`.
 *     Mesuré dans un processus isolé : src/export-leger.test.ts.
 *   - `nomFichier` = `nomArchive(<nom de la ligne ferme exportée>, options.jour)` ; ferme absente
 *     de la base → nom null → 'planifications-ferme-<jour>.zip'.
 *   - `lignes` : pour chaque CSV de l'archive, son chemin sans « .csv » ('zone',
 *     'bibliotheque/famille') → nombre de lignes de données. Sert à l'écran (« 30 000
 *     événements exportés ») et aux tests.
 *
 * Temps (inchangé en T15b, compression comprise) : moins de 10 s sur un téléphone Android milieu de gamme (CPU ralenti ×4) pour la ferme
 * de T07. L'écran n'est pas encore atteignable dans l'appli sans synchro réelle (aucune porte
 * ouverte après connexion), donc pas d'e2e Playwright : export.test.ts mesure `exporterFerme`
 * sous Node, sur le volume de T07 dans la base mémoire, avec un seuil de 2,5 s (≈ 10 s / 4 :
 * le ralentissement ×4 de Chromium appliqué à l'envers). Lecture SQLite comprise ; elle est
 * plus rapide sous node:sqlite que sous wa-sqlite, d'où une marge qui reste à mesurer sur
 * téléphone quand l'écran sera branché (e2e dans le style de apps/web/e2e/mesure-sqlite.e2e.ts).
 *
 * Empaquetage : l'écran d'export importe `exporterFerme` de @planif/sync (point d'entrée ou
 * sous-chemin dédié, au choix du développeur) ; ce chemin n'entraîne aucun module de
 * `@powersync/*` dans le morceau de l'écran, même indirectement (le schéma local, schema.ts,
 * importe `@powersync/common`). Vérifié par
 * apps/web/src/ecrans/export/empaquetage.test.ts (empaquetage Vite en mémoire).
 */
import type { Avancement, Compresseur } from '../../../core/src/export/test/contrat.ts';
import type { PorteDonnees } from './contrat.ts';

export type { Avancement, Compresseur };

export interface OptionsExportFerme {
  readonly fermeId: string;
  /** Instant ISO de l'export (ferme.json `genere_le`). */
  readonly genereLe: string;
  /** Jour de l'export, 'AAAA-MM-JJ' : nom du fichier et date des entrées du ZIP. */
  readonly jour: string;
  /** T15b : deflate brut injecté ; défaut : CompressionStream('deflate-raw') s'il existe. */
  readonly compresseur?: Compresseur;
  /** T15b : barre d'avancement. */
  readonly avancement?: (a: Avancement) => void;
}

export interface ArchiveExport {
  readonly nomFichier: string;
  /** L'archive ZIP complète. */
  readonly octets: Uint8Array;
  readonly lignes: Readonly<Record<string, number>>;
}

export interface ModuleExportSync {
  exporterFerme(porte: PorteDonnees, options: OptionsExportFerme): Promise<ArchiveExport>;
}

const CHEMIN_MODULE = '../index.ts';

export async function chargerExportSync(): Promise<Partial<ModuleExportSync>> {
  return (await import(/* @vite-ignore */ CHEMIN_MODULE)) as Partial<ModuleExportSync>;
}

/** Rend `exporterFerme`, ou lève une erreur explicite tant qu'il n'existe pas. */
export async function exigerExporterFerme(): Promise<ModuleExportSync['exporterFerme']> {
  const m = await chargerExportSync();
  if (typeof m.exporterFerme !== 'function') throw new Error('@planif/sync n’exporte pas encore exporterFerme (T15)');
  return m.exporterFerme;
}
