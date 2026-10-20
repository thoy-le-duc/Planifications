/**
 * Vue 3D (T55, règle 3) — les traitements phyto du jour, ajoutés aux travaux numérotés
 * (./travaux.ts). Chargé à la demande par ./travaux.ts : le morceau du cœur qui juge les chaînes
 * (`enVigueurDesTraitements`) ne s'ajoute ainsi ni au morceau 3D ni à ce que la vue précharge avec
 * ses travaux (budget `jsVue3dGzKio`).
 *
 * Lecture propre, courte : les traitements datés du jour (index ferme_type) et ce qui les remplace
 * (index remplacement). La lecture de l'écran Aujourd'hui (../aujourdhui/dar.ts) parcourt un an de
 * traitements et toutes leurs corrections : lancée avec les travaux, elle les retardait sur la grande
 * ferme, qui redessinait alors la vue au repos (e2e vue-3d-jumeau).
 */
import { enVigueurDesTraitements, type TraitementLu } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Un traitement phyto du jour, travail numéroté de la 3D. */
export interface TraitementDuJour3d {
  /** « traitement:<id de l'événement> ». */
  readonly cle: string;
  readonly traitement: {
    readonly id: string;
    /** Nom commercial du produit (« produit inconnu » à défaut). */
    readonly produit: string;
    readonly emplacementIds: readonly string[];
  };
}

/**
 * Paramètres : ferme, jour, ferme. Les traitements datés du jour, puis, de proche en proche par
 * l'index remplacement, les corrections et annulations qui les remplacent (une correction qui
 * change la date en fait partie) ; la ferme et le type sont revérifiés à la fin.
 *
 * T68 : revérifiés hors index (`+`) : chaque maillon se relit par sa clé. Sans cela, SQLite partait
 * de l'index ferme_type et relisait tous les traitements de la ferme (4 331 sur la grande ferme,
 * jusqu'à 2,8 s dans le navigateur) ; la base, occupée, retardait la 3D (e2e vue-3d-jumeau).
 */
export const SQL_TRAITEMENTS_DU_JOUR = `WITH RECURSIVE chaine(id) AS (
    SELECT id FROM evenement WHERE ferme_id = ? AND type = 'traitement' AND date = ?
    UNION
    SELECT e.id FROM chaine c JOIN evenement e ON e.remplace_evenement_id = c.id
  )
  SELECT e.id, e.date, e.horodatage, e.emplacement_ids, e.remplace_sorte, e.remplace_evenement_id,
    json_extract(e.detail, '$.produitPhytoId') AS produit, p.nom_commercial AS nom
  FROM chaine c JOIN evenement e ON e.id = c.id
  LEFT JOIN produit_phyto p ON p.id = lower(json_extract(e.detail, '$.produitPhytoId'))
  WHERE +e.ferme_id = ? AND +e.type = 'traitement' AND json_valid(e.detail)`;

interface Ligne {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly emplacement_ids: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly produit: unknown;
  readonly nom: string | null;
}

function emplacements(v: string | null): string[] {
  if (v === null) return [];
  try {
    const l: unknown = JSON.parse(v);
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Les traitements en vigueur datés du `aujourdhui` (un traitement est un événement du journal : déjà fait ou noté pour aujourd'hui), dans l'ordre de leur saisie. */
export async function lireTraitementsDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<TraitementDuJour3d[]> {
  const lignes = await porte.lire<Ligne>(SQL_TRAITEMENTS_DU_JOUR, [fermeId, aujourdhui, fermeId]);
  const noms = new Map<string, string>();
  const lus: TraitementLu[] = [];
  for (const l of lignes) {
    if (typeof l.produit !== 'string') continue;
    const produit = l.produit.toLowerCase();
    if (l.nom !== null) noms.set(produit, l.nom);
    lus.push({
      id: l.id,
      date: l.date,
      horodatage: l.horodatage,
      emplacementIds: emplacements(l.emplacement_ids),
      remplaceSorte: l.remplace_sorte === 'correction' || l.remplace_sorte === 'annulation' ? l.remplace_sorte : null,
      remplaceEvenementId: l.remplace_evenement_id,
      produitPhytoId: produit,
      // Sans objet ici (le DAR n'est pas jugé) : seules les chaînes comptent.
      recolteAutoriseeLe: '',
    });
  }
  return enVigueurDesTraitements(lus)
    .filter((t) => t.date === aujourdhui)
    .sort((a, b) => (a.horodatage !== b.horodatage ? (a.horodatage < b.horodatage ? -1 : 1) : a.id < b.id ? -1 : 1))
    .map((t) => ({ cle: `traitement:${t.id}`, traitement: { id: t.id, produit: noms.get(t.produitPhytoId) ?? 'produit inconnu', emplacementIds: t.emplacementIds } }));
}
