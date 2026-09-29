/**
 * Export complet de la ferme depuis la base locale du téléphone (T15, principe 5) : hors ligne,
 * lecture seule par la porte, aucun réseau. Le format de l'archive est dans @planif/core.
 */
import { creerZip, nomArchive, preparerExport, TABLES_EXPORTEES, type LigneLocale } from '@planif/core';
import type { PorteDonnees } from './types.ts';

export interface OptionsExportFerme {
  readonly fermeId: string;
  /** Instant ISO de l'export (ferme.json `genere_le`). */
  readonly genereLe: string;
  /** Jour de l'export, 'AAAA-MM-JJ' : nom du fichier et date des entrées du ZIP. */
  readonly jour: string;
}

export interface ArchiveExport {
  readonly nomFichier: string;
  /** L'archive ZIP complète. */
  readonly octets: Uint8Array;
  /** Nombre de lignes de chaque CSV, par chemin sans « .csv » ('zone', 'bibliotheque/famille'). */
  readonly lignes: Readonly<Record<string, number>>;
}

/**
 * Lecture d'une table : seulement les colonnes de la liste blanche, et seulement les lignes
 * qui peuvent être de la ferme (ou de la bibliothèque de référence). `preparerExport` refiltre.
 */
function requete(table: string, colonnes: readonly string[]): { sql: string; parametres: number } {
  const select = `SELECT ${colonnes.map((c) => `"${c}"`).join(', ')} FROM "${table}"`;
  if (table === 'ferme') return { sql: `${select} WHERE id = ?`, parametres: 1 };
  if (table === 'utilisateur') return { sql: `${select} WHERE id IN (SELECT utilisateur_id FROM "membre" WHERE ferme_id = ?) ORDER BY id`, parametres: 1 };
  if (colonnes.includes('ferme_id')) return { sql: `${select} WHERE ferme_id = ? OR ferme_id IS NULL ORDER BY id`, parametres: 1 };
  return { sql: `${select} ORDER BY id`, parametres: 0 };
}

/** Construit l'archive ZIP de la ferme, depuis la base locale seulement. */
export async function exporterFerme(porte: PorteDonnees, options: OptionsExportFerme): Promise<ArchiveExport> {
  const { fermeId, genereLe, jour } = options;
  const noms = Object.keys(TABLES_EXPORTEES);
  const lues = await Promise.all(
    noms.map((table) => {
      const { sql, parametres } = requete(table, Object.keys(TABLES_EXPORTEES[table]?.colonnes ?? {}));
      return porte.lire<LigneLocale>(sql, parametres === 1 ? [fermeId] : []);
    }),
  );
  const tables: Record<string, readonly LigneLocale[]> = {};
  noms.forEach((table, k) => {
    tables[table] = lues[k] ?? [];
  });

  const { fichiers, lignes } = preparerExport({ fermeId, genereLe, tables });
  const ferme = tables.ferme?.find((l) => l.id === fermeId);
  const nom = typeof ferme?.nom === 'string' ? ferme.nom : null;
  return { nomFichier: nomArchive(nom, jour), octets: creerZip(fichiers, { date: jour }), lignes };
}
