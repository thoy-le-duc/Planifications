/**
 * Saisie d'un traitement (T52) : lectures (cultures en place, produits utilisables) et écritures
 * par la porte, en ajout seul. Une saisie = UNE transaction ; la ligne est vérifiée par les
 * règles du serveur (`validerSaisie`) avant d'être écrite. Le DAR du produit est figé dans le
 * détail (`detailTraitement` du cœur). L'annulation (bandeau du dialogue, registre de la ferme)
 * est un événement de plus, vérifié dans la transaction : la saisie visée est encore en vigueur.
 */
import {
  detailTraitement,
  validerSaisie,
  type CultureConcernee,
  type DateCalendaire,
  type DetailTraitement,
  type Id,
  type ProduitPourTraitement,
  type Quantite,
} from '@planif/core';
import type { PorteDonnees, SaisieEvenement } from '@planif/sync';
import { chaineDe } from '@planif/sync/fait-unique';

/**
 * Annonce de la saisie à la journée suivie d'Aujourd'hui (annoncerSaisie de ../cache.ts) : le
 * changement qui suit ne relit que la culture touchée. Rend de quoi retirer l'annonce (échec).
 * Absente (registre de la ferme) : rien n'est annoncé.
 */
export type Annoncer = (culture: CultureConcernee) => () => void;

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class TraitementRefuse extends Error {}

export interface EmplacementTraite {
  readonly id: string;
  readonly code: string;
  /** Longueur occupée par la culture (m), à défaut celle de l'emplacement. */
  readonly longueurM: number;
  readonly largeurM: number | null;
}

export interface CultureEnPlace {
  readonly cible: CultureConcernee;
  readonly cibleId: string;
  readonly nom: string;
  readonly emplacements: readonly EmplacementTraite[];
}

export interface ProduitUtilisable extends ProduitPourTraitement {
  readonly bio: boolean;
}

/** Paramètres : ferme, jour, jour. */
const SQL_SERIES = `SELECT s.id AS cible, e.nom AS espece, v.nom AS variete FROM serie s
  JOIN espece e ON e.id = s.espece_id LEFT JOIN variete v ON v.id = s.variete_id
  WHERE s.ferme_id = ? AND s.supprime_le IS NULL AND s.statut IN ('prevue', 'en_cours')
    AND EXISTS (SELECT 1 FROM occupation o WHERE o.serie_id = s.id AND o.supprime_le IS NULL
      AND coalesce(o.reel_du, o.prevu_du) <= ? AND coalesce(o.reel_au, o.prevu_au) >= ?)`;

/** Paramètres : ferme, année, jour. */
const SQL_CAMPAGNES = `SELECT c.id AS cible, c.plantation_id AS plantation, e.nom AS espece, v.nom AS variete FROM campagne c
  JOIN plantation p ON p.id = c.plantation_id JOIN espece e ON e.id = p.espece_id LEFT JOIN variete v ON v.id = p.variete_id
  WHERE c.ferme_id = ? AND c.supprime_le IS NULL AND p.supprime_le IS NULL AND c.annee = ?
    AND (p.date_arrachage IS NULL OR p.date_arrachage > ?)`;

/** Paramètres : ferme, jour, jour, jour, jour. */
const SQL_EMPLACEMENTS = `SELECT o.serie_id, o.plantation_id, em.id, em.code, coalesce(o.longueur_m, em.longueur_m) AS longueur, em.largeur_m AS largeur
  FROM occupation o JOIN emplacement em ON em.id = o.emplacement_id
  WHERE o.ferme_id = ? AND o.supprime_le IS NULL AND em.supprime_le IS NULL
    AND coalesce(o.reel_du, o.prevu_du) <= ? AND coalesce(o.reel_au, o.prevu_au) >= ?
    AND em.actif_du <= ? AND (em.actif_au IS NULL OR em.actif_au > ?)`;

const SQL_PRODUITS = `SELECT id, nom_commercial, delai_avant_recolte_jours, dose_maximale, utilisable_en_bio FROM produit_phyto
  WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY nom_commercial, id`;

const nomDe = (espece: string, variete: string | null) => (variete === null || variete === '' ? espece : `${espece} ${variete}`);

/** Cultures en place le `jour` : séries prévues ou en cours dont une occupation le couvre, campagnes de l'année. */
export async function lireCulturesEnPlace(porte: PorteDonnees, fermeId: string, jour: string): Promise<CultureEnPlace[]> {
  const [series, campagnes, emplacements] = await Promise.all([
    porte.lire<{ cible: string; espece: string; variete: string | null }>(SQL_SERIES, [fermeId, jour, jour]),
    porte.lire<{ cible: string; plantation: string; espece: string; variete: string | null }>(SQL_CAMPAGNES, [fermeId, Number(jour.slice(0, 4)), jour]),
    porte.lire<{ serie_id: string | null; plantation_id: string | null; id: string; code: string; longueur: number | null; largeur: number | null }>(SQL_EMPLACEMENTS, [
      fermeId,
      jour,
      jour,
      jour,
      jour,
    ]),
  ]);
  const de = (cle: 'serie_id' | 'plantation_id', id: string): EmplacementTraite[] => {
    const vus = new Map<string, EmplacementTraite>();
    for (const e of emplacements) {
      if (e[cle] !== id || vus.has(e.id)) continue;
      vus.set(e.id, { id: e.id, code: e.code, longueurM: e.longueur ?? 0, largeurM: e.largeur });
    }
    return [...vus.values()].sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  };
  const cultures: CultureEnPlace[] = [
    ...series.map((s) => ({ cible: { sorte: 'serie' as const, serieId: s.cible as Id<'Serie'> }, cibleId: s.cible, nom: nomDe(s.espece, s.variete), emplacements: de('serie_id', s.cible) })),
    ...campagnes.map((c) => ({
      cible: { sorte: 'campagne' as const, campagneId: c.cible as Id<'Campagne'> },
      cibleId: c.cible,
      nom: nomDe(c.espece, c.variete),
      emplacements: de('plantation_id', c.plantation),
    })),
  ];
  return cultures.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.cibleId.localeCompare(b.cibleId));
}

function quantite(v: unknown): Quantite | null {
  if (typeof v !== 'string') return null;
  try {
    const q = JSON.parse(v) as { valeur?: unknown; unite?: unknown } | null;
    return q !== null && typeof q.valeur === 'number' && typeof q.unite === 'string' ? { valeur: q.valeur, unite: q.unite } : null;
  } catch {
    return null;
  }
}

/** Produits non archivés de la ferme et de la bibliothèque commune. */
export async function lireProduitsUtilisables(porte: PorteDonnees, fermeId: string): Promise<ProduitUtilisable[]> {
  const lignes = await porte.lire<{ id: string; nom_commercial: string; delai_avant_recolte_jours: number; dose_maximale: string | null; utilisable_en_bio: number }>(SQL_PRODUITS, [fermeId]);
  return lignes.map((l) => ({
    id: l.id,
    nomCommercial: l.nom_commercial,
    delaiAvantRecolteJours: l.delai_avant_recolte_jours,
    doseMaximale: quantite(l.dose_maximale),
    bio: l.utilisable_en_bio === 1,
  }));
}

export interface SaisieDuTraitement {
  readonly culture: CultureConcernee | null;
  readonly emplacementIds: readonly string[];
  readonly produit: ProduitPourTraitement;
  readonly date: string;
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  readonly operateur: string;
}

export interface TraitementEcrit {
  readonly id: string;
  readonly recolteAutoriseeLe: string;
}

async function ecrire(porte: PorteDonnees, saisie: SaisieEvenement, annoncer: Annoncer | undefined, verifier?: Parameters<PorteDonnees['ecrireEnsemble']>[1]): Promise<string> {
  const e = porte.preparerSaisie(saisie);
  const r = validerSaisie(e.ligne);
  if (!r.ok) throw new TraitementRefuse(r.erreur.message);
  const retirer = saisie.culture === null || annoncer === undefined ? () => undefined : annoncer(saisie.culture);
  try {
    await porte.ecrireEnsemble([e.ordre], verifier);
  } catch (erreur) {
    retirer();
    throw erreur;
  }
  return e.id;
}

/** Écrit le traitement, DAR du produit figé ; rend son id et sa date de récolte autorisée. */
export async function ecrireTraitement(porte: PorteDonnees, s: SaisieDuTraitement, annoncer?: Annoncer): Promise<TraitementEcrit> {
  const detail = detailTraitement(s.produit, { dose: s.dose, surfaceTraiteeM2: s.surfaceTraiteeM2, cible: s.cible, operateur: s.operateur }, s.date as DateCalendaire);
  const saisie: SaisieEvenement = {
    type: 'traitement',
    date: s.date as DateCalendaire,
    source: 'tap',
    culture: s.culture,
    emplacementIds: s.emplacementIds as Id<'Emplacement'>[],
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail,
  };
  const id = await ecrire(porte, saisie, annoncer);
  return { id, recolteAutoriseeLe: detail.recolteAutoriseeLe };
}

/** La saisie visée n'est plus en vigueur (déjà annulée ou corrigée, ici ou ailleurs) : rien n'est écrit. */
export class TraitementPlusEnVigueur extends Error {}

const SQL_TRAITEMENT = `SELECT date, serie_id, campagne_id, emplacement_ids, note, photos, detail FROM evenement
  WHERE id = ? AND ferme_id = ? AND type = 'traitement' AND json_valid(detail)`;

function textes(v: string | null): string[] {
  if (v === null) return [];
  try {
    const l: unknown = JSON.parse(v);
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Annule le traitement `id` (en vigueur) : un événement d'annulation, même détail, même culture,
 * ses emplacements encore actifs le `jour`. Vérifié dans la transaction : `id` est toujours la
 * ligne en vigueur de sa chaîne (sinon TraitementPlusEnVigueur, rien d'écrit).
 */
export async function annulerTraitement(porte: PorteDonnees, fermeId: string, id: string, jour: string, annoncer?: Annoncer): Promise<string> {
  const l = (
    await porte.lire<{ date: string; serie_id: string | null; campagne_id: string | null; emplacement_ids: string | null; note: string | null; photos: string | null; detail: string }>(SQL_TRAITEMENT, [
      id,
      fermeId,
    ])
  )[0];
  if (l === undefined) throw new TraitementPlusEnVigueur('ce traitement n’est plus sur ce téléphone');
  const ids = textes(l.emplacement_ids);
  const actifs =
    ids.length === 0
      ? []
      : await porte.lire<{ id: string }>(
          `SELECT id FROM emplacement WHERE id IN (${ids.map(() => '?').join(', ')}) AND supprime_le IS NULL AND actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)`,
          [...ids, jour, jour],
        );
  const garder = new Set(actifs.map((a) => a.id.toLowerCase()));
  const culture: CultureConcernee | null =
    l.serie_id !== null ? { sorte: 'serie', serieId: l.serie_id as Id<'Serie'> } : l.campagne_id !== null ? { sorte: 'campagne', campagneId: l.campagne_id as Id<'Campagne'> } : null;
  return ecrire(
    porte,
    {
      type: 'traitement',
      date: l.date as DateCalendaire,
      source: 'tap',
      culture,
      emplacementIds: ids.filter((e) => garder.has(e.toLowerCase())) as Id<'Emplacement'>[],
      note: l.note,
      photos: textes(l.photos),
      remplaceEvenement: { sorte: 'annulation', evenementId: id as Id<'Evenement'> },
      detail: JSON.parse(l.detail) as DetailTraitement,
    },
    annoncer,
    async (lire) => {
      const c = await chaineDe(lire, fermeId, id);
      if (c.annulee || c.enVigueur !== id) throw new TraitementPlusEnVigueur('ce traitement a déjà été annulé ou corrigé');
    },
  );
}
