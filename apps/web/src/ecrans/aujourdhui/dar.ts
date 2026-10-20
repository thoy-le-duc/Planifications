/**
 * Délai avant récolte dans Aujourd'hui (T52, règle 4) : les traitements qui peuvent encore
 * interdire une récolte, suivis par la porte (une saisie d'ici ou d'un autre téléphone s'y voit),
 * et le texte de l'alerte d'une récolte. Le calcul est celui du cœur (`interdictionRecolte`,
 * `texteInterdiction`) : rien n'est réécrit ici.
 *
 * Lecture bornée : les traitements des DAR_MAX_JOURS + 1 derniers jours (un traitement plus
 * ancien n'interdit plus rien : le DAR d'un produit ne dépasse pas DAR_MAX_JOURS), plus toutes
 * leurs corrections et annulations, pour que la chaîne en vigueur soit juste.
 *
 * Relecture paresseuse : la lecture parcourt le journal de l'année ; refaite à chaque écriture
 * du journal (chaque « Fait »), elle disputait la base à la relecture de la journée (e2e de la
 * grande ferme). Elle est donc refaite tout de suite après un traitement saisi ici (`relire`),
 * et sinon (synchro, autre onglet) une fois le journal calme, au repos.
 */
import { ajouterJours, DAR_MAX_JOURS, interdictionRecolte, texteInterdiction, type DateCalendaire, type TraitementLu } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Traitements lus, et nom commercial de leur produit. */
export interface TraitementsDar {
  readonly traitements: readonly TraitementLu[];
  readonly noms: ReadonlyMap<string, string>;
}

export const AUCUN_TRAITEMENT: TraitementsDar = { traitements: [], noms: new Map() };

const COLONNES = `e.id, e.date, e.horodatage, e.emplacement_ids, e.remplace_sorte, e.remplace_evenement_id, e.serie_id, e.campagne_id,
  json_extract(e.detail, '$.produitPhytoId') AS produit, json_extract(e.detail, '$.recolteAutoriseeLe') AS autorisee,
  p.nom_commercial AS nom`;
const JOINTURE = `LEFT JOIN produit_phyto p ON p.id = lower(json_extract(e.detail, '$.produitPhytoId'))`;

/**
 * Paramètres : ferme, depuis, ferme, depuis. Les deux parties lisent l'index local ferme_type
 * (ferme_id, type, date) : seuls les traitements sont parcourus, jamais tout le journal.
 */
export const SQL_TRAITEMENTS = `SELECT ${COLONNES} FROM evenement e ${JOINTURE}
  WHERE e.ferme_id = ? AND e.type = 'traitement' AND e.date >= ? AND json_valid(e.detail)
  UNION ALL
  SELECT ${COLONNES} FROM evenement e ${JOINTURE}
  WHERE e.ferme_id = ? AND e.type = 'traitement' AND e.date < ? AND e.remplace_evenement_id IS NOT NULL AND json_valid(e.detail)`;

interface LigneDar {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly emplacement_ids: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
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
      cultureId: l.serie_id ?? l.campagne_id,
    });
  }
  return { traitements, noms };
}

/**
 * Lecture unique des traitements qui peuvent interdire une récolte le `aujourdhui` (même requête
 * que le suivi) : la récolte validée avant que le suivi ait rendu sa première lecture.
 */
export async function lireTraitements(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<TraitementsDar> {
  const depuis = ajouterJours(aujourdhui as DateCalendaire, -(DAR_MAX_JOURS + 1));
  return lus(await porte.lire<LigneDar>(SQL_TRAITEMENTS, [fermeId, depuis, fermeId, depuis]));
}

/** Calme du journal attendu avant de relire après un changement venu d'ailleurs. */
export const ATTENTE_RELECTURE_MS = 1_500;

export interface SuiviTraitements {
  /** Relit tout de suite (un traitement vient d'être saisi ou annulé sur ce téléphone). */
  readonly relire: () => void;
  readonly arreter: () => void;
}

/** Suit les traitements de la ferme qui peuvent interdire une récolte le `aujourdhui` ou après. */
export function suivreTraitements(porte: PorteDonnees, fermeId: string, aujourdhui: string, rappel: (t: TraitementsDar) => void): SuiviTraitements {
  const depuis = ajouterJours(aujourdhui as DateCalendaire, -(DAR_MAX_JOURS + 1));
  let actif = true;
  let numero = 0;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const g = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  const lire = () => {
    if (minuterie !== null) clearTimeout(minuterie);
    minuterie = null;
    const n = ++numero;
    porte.lire<LigneDar>(SQL_TRAITEMENTS, [fermeId, depuis, fermeId, depuis]).then(
      (lignes) => {
        if (actif && n === numero) rappel(lus(lignes));
      },
      (e: unknown) => {
        console.error('Traitements illisibles', e);
      },
    );
  };
  const plusTard = () => {
    if (minuterie !== null) clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      minuterie = null;
      if (g.requestIdleCallback === undefined) lire();
      else g.requestIdleCallback(lire, { timeout: 2_000 });
    }, ATTENTE_RELECTURE_MS);
  };
  // Requête vide : seul le signal de changement sert (la vraie lecture est différée).
  let premiere = true;
  const fin = porte.surveiller({ sql: 'SELECT 1 AS signal', tables: ['evenement', 'produit_phyto'] }, () => {
    if (premiere) {
      premiere = false;
      lire();
    } else plusTard();
  });
  return {
    relire: lire,
    arreter: () => {
      actif = false;
      if (minuterie !== null) clearTimeout(minuterie);
      fin();
    },
  };
}

/**
 * L'alerte d'une récolte le `date` sur ces emplacements ou sur la culture `cultureId` (série ou
 * campagne : une culture sans emplacement), ou null si elle est permise.
 */
export function alerteRecolte(t: TraitementsDar, emplacementIds: readonly string[], date: string, cultureId: string | null = null): string | null {
  const i = interdictionRecolte(t.traitements, emplacementIds, date, cultureId);
  return i === null ? null : texteInterdiction(i, t.noms.get(i.produitPhytoId) ?? 'produit inconnu');
}
