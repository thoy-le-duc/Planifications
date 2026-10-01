/**
 * Vérification commune de l'état d'une série après une annulation (T12b décision 10, T24b),
 * partagée par l'écran d'une série (`defaireSerie`) et celui des itinéraires (`ramener`).
 * Importé directement par les deux écrans (chargés à la demande), jamais par l'index de
 * `donnees/` : rien ne s'ajoute au JavaScript de démarrage.
 */
import { validerOccupation, validerSerie } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

type Valeur = string | number | null;
type Ligne = Readonly<Record<string, Valeur>>;

/** Une série et ses occupations (toutes, supprimées comprises), lignes locales. */
export interface EtatSerie {
  readonly serie: Ligne;
  readonly occupations: readonly Ligne[];
}

/** Une ligne de `table` existe sur ce téléphone et n'est pas supprimée. */
async function vivante(porte: PorteDonnees, table: 'espece' | 'variete' | 'itineraire' | 'saison' | 'emplacement', id: Valeur): Promise<boolean> {
  if (id === null) return false;
  const l = await porte.lire<Ligne>(`SELECT id FROM ${table} WHERE id = ? AND supprime_le IS NULL`, [id]);
  return l.length > 0;
}

/**
 * L'état d'une série après une écriture (`apres`), à partir de l'état actuel (`avant`), vérifié
 * comme le serveur (apps/api/src/sync/serie.ts : `modifier`, `verifierReferencesSerie`,
 * `verifierEmplacement`, fin de lot ; décision 10 de T12b) :
 *   - la série passe validerSerie ;
 *   - références : un rétablissement (supprime_le non nul → nul) compte comme un changement de
 *     toutes (B5). Saison changée : elle vit. Espèce, variété ou itinéraire changé : l'espèce et la
 *     variété vivent, l'itinéraire existe, et vit s'il change vraiment (inchangées, une variété
 *     supprimée depuis reste acceptée, N2) ;
 *   - aucune occupation active sous une série supprimée ;
 *   - chaque occupation active passe validerOccupation avec la série d'après, et son emplacement
 *     vit si elle en change ou redevient active (B6).
 */
export async function etatSerieValide(porte: PorteDonnees, avant: EtatSerie, apres: EtatSerie): Promise<boolean> {
  const r = validerSerie({ ...apres.serie });
  if (!r.ok) return false;
  const actives = apres.occupations.filter((o) => o.supprime_le === null);
  if (r.valeur.supprimeLe !== null) return actives.length === 0;
  if (!actives.every((o) => validerOccupation({ ...o }, r.valeur, { datesDeLaSerie: true }).ok)) return false;

  const s = apres.serie;
  const retablie = (avant.serie.supprime_le ?? null) !== null;
  const change = (c: string) => retablie || (s[c] ?? null) !== (avant.serie[c] ?? null);
  const verifications: Promise<boolean>[] = [];
  if (change('saison_id')) verifications.push(vivante(porte, 'saison', s.saison_id ?? null));
  if (change('espece_id') || change('variete_id') || change('itineraire_id')) {
    verifications.push(vivante(porte, 'espece', s.espece_id ?? null));
    if ((s.variete_id ?? null) !== null) verifications.push(vivante(porte, 'variete', s.variete_id ?? null));
    const itineraireChange = (s.itineraire_id ?? null) !== (avant.serie.itineraire_id ?? null);
    verifications.push(
      itineraireChange
        ? vivante(porte, 'itineraire', s.itineraire_id ?? null)
        : porte.lire<Ligne>('SELECT id FROM itineraire WHERE id = ?', [s.itineraire_id ?? null]).then((l) => l.length > 0),
    );
  }
  for (const o of actives) {
    const avantO = avant.occupations.find((x) => x.id === o.id);
    const redevient = avantO?.supprime_le !== null;
    if (redevient || o.emplacement_id !== avantO.emplacement_id) verifications.push(vivante(porte, 'emplacement', o.emplacement_id ?? null));
  }
  return (await Promise.all(verifications)).every(Boolean);
}
