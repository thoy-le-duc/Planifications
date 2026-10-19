/**
 * Délai avant récolte dans Aujourd'hui (T52, règle 4) : les traitements qui peuvent encore
 * interdire une récolte, suivis par la porte (une saisie d'ici ou d'un autre téléphone s'y voit),
 * et le texte de l'alerte d'une récolte. Le calcul est celui du cœur (`interdictionRecolte`,
 * `texteInterdiction`) : rien n'est réécrit ici.
 *
 * Lecture bornée : les traitements des DAR_MAX_JOURS + 1 derniers jours (un traitement plus
 * ancien n'interdit plus rien : le DAR d'un produit ne dépasse pas DAR_MAX_JOURS), plus toutes
 * leurs corrections et annulations, pour que la chaîne en vigueur soit juste.
 */
import { ajouterJours, DAR_MAX_JOURS, interdictionRecolte, texteInterdiction, type DateCalendaire, type TraitementLu } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Traitements lus, et nom commercial de leur produit. */
export interface TraitementsDar {
  readonly traitements: readonly TraitementLu[];
  readonly noms: ReadonlyMap<string, string>;
}

export const AUCUN_TRAITEMENT: TraitementsDar = { traitements: [], noms: new Map() };

const COLONNES = `e.id, e.date, e.horodatage, e.emplacement_ids, e.remplace_sorte, e.remplace_evenement_id,
  json_extract(e.detail, '$.produitPhytoId') AS produit, json_extract(e.detail, '$.recolteAutoriseeLe') AS autorisee,
  p.nom_commercial AS nom`;
const JOINTURE = `LEFT JOIN produit_phyto p ON p.id = lower(json_extract(e.detail, '$.produitPhytoId'))`;

/** Paramètres : ferme, depuis, ferme, depuis. */
const SQL_TRAITEMENTS = `SELECT ${COLONNES} FROM evenement e ${JOINTURE}
  WHERE e.ferme_id = ? AND e.date >= ? AND e.type = 'traitement' AND json_valid(e.detail)
  UNION ALL
  SELECT ${COLONNES} FROM evenement e ${JOINTURE}
  WHERE e.remplace_evenement_id IS NOT NULL AND e.ferme_id = ? AND e.date < ? AND e.type = 'traitement' AND json_valid(e.detail)`;

interface LigneDar {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly emplacement_ids: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly produit: unknown;
  readonly autorisee: unknown;
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

function lus(lignes: readonly LigneDar[]): TraitementsDar {
  const traitements: TraitementLu[] = [];
  const noms = new Map<string, string>();
  for (const l of lignes) {
    if (typeof l.produit !== 'string' || typeof l.autorisee !== 'string') continue;
    const produit = l.produit.toLowerCase();
    if (l.nom !== null) noms.set(produit, l.nom);
    traitements.push({
      id: l.id,
      date: l.date,
      horodatage: l.horodatage,
      emplacementIds: emplacements(l.emplacement_ids),
      remplaceSorte: l.remplace_sorte === 'correction' || l.remplace_sorte === 'annulation' ? l.remplace_sorte : null,
      remplaceEvenementId: l.remplace_evenement_id,
      produitPhytoId: produit,
      recolteAutoriseeLe: l.autorisee,
    });
  }
  return { traitements, noms };
}

/** Suit les traitements de la ferme qui peuvent interdire une récolte le `aujourdhui` ou après. */
export function suivreTraitements(porte: PorteDonnees, fermeId: string, aujourdhui: string, rappel: (t: TraitementsDar) => void): () => void {
  const depuis = ajouterJours(aujourdhui as DateCalendaire, -(DAR_MAX_JOURS + 1));
  return porte.surveiller<LigneDar>({ sql: SQL_TRAITEMENTS, parametres: [fermeId, depuis, fermeId, depuis], tables: ['evenement', 'produit_phyto'] }, (lignes) => {
    rappel(lus(lignes));
  });
}

/** L'alerte d'une récolte le `date` sur ces emplacements, ou null si elle est permise. */
export function alerteRecolte(t: TraitementsDar, emplacementIds: readonly string[], date: string): string | null {
  const i = interdictionRecolte(t.traitements, emplacementIds, date);
  return i === null ? null : texteInterdiction(i, t.noms.get(i.produitPhytoId) ?? 'produit inconnu');
}
