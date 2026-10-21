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
import { jourDuTelephone } from '../jour.ts';

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
  /** Espèce de la série ou de la plantation : l'usage e-phy de la culture traitée en dépend (T76). */
  readonly espece: string;
  readonly emplacements: readonly EmplacementTraite[];
}

export interface ProduitUtilisable extends ProduitPourTraitement {
  readonly bio: boolean;
  /** N° AMM de la fiche ('' si aucun) : le produit vient d'e-phy si le catalogue le connaît (T76). */
  readonly numeroAmm: string;
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

const SQL_PRODUITS = `SELECT id, nom_commercial, numero_amm, delai_avant_recolte_jours, dose_maximale, utilisable_en_bio FROM produit_phyto
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
    ...series.map((s) => ({ cible: { sorte: 'serie' as const, serieId: s.cible as Id<'Serie'> }, cibleId: s.cible, nom: nomDe(s.espece, s.variete), espece: s.espece, emplacements: de('serie_id', s.cible) })),
    ...campagnes.map((c) => ({
      cible: { sorte: 'campagne' as const, campagneId: c.cible as Id<'Campagne'> },
      cibleId: c.cible,
      nom: nomDe(c.espece, c.variete),
      espece: c.espece,
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
  const lignes = await porte.lire<{ id: string; nom_commercial: string; numero_amm: string | null; delai_avant_recolte_jours: number; dose_maximale: string | null; utilisable_en_bio: number }>(SQL_PRODUITS, [fermeId]);
  return lignes.map((l) => ({
    id: l.id,
    nomCommercial: l.nom_commercial,
    delaiAvantRecolteJours: l.delai_avant_recolte_jours,
    doseMaximale: quantite(l.dose_maximale),
    bio: l.utilisable_en_bio === 1,
    numeroAmm: (l.numero_amm ?? '').trim(),
  }));
}

export interface SaisieDuTraitement {
  readonly culture: CultureConcernee | null;
  readonly emplacementIds: readonly string[];
  /** Son `delaiAvantRecolteJours` est le DAR figé : celui du champ de la saisie (T76), pas forcément celui de la fiche. */
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

type Verification = NonNullable<Parameters<PorteDonnees['ecrireEnsemble']>[1]>;

/**
 * Écrit les saisies en UNE transaction, chacune vérifiée par les règles du serveur avant ; tout ou rien.
 * `verifier` reçoit la ferme des lignes préparées et rend la vérification lue DANS la transaction.
 */
async function ecrire(porte: PorteDonnees, saisies: readonly SaisieEvenement[], annoncer: Annoncer | undefined, verifier?: (fermeId: string) => Verification): Promise<string[]> {
  if (saisies.length === 0) throw new TraitementRefuse('aucune culture à traiter');
  const preparees = saisies.map((saisie) => {
    const e = porte.preparerSaisie(saisie);
    const r = validerSaisie(e.ligne);
    if (!r.ok) throw new TraitementRefuse(r.erreur.message);
    return e;
  });
  const retraits = annoncer === undefined ? [] : saisies.flatMap((saisie) => (saisie.culture === null ? [] : [annoncer(saisie.culture)]));
  try {
    const ferme = preparees[0]?.ligne.ferme_id ?? '';
    await porte.ecrireEnsemble(
      preparees.map((e) => e.ordre),
      verifier?.(ferme),
    );
  } catch (erreur) {
    for (const retirer of retraits) retirer();
    throw erreur;
  }
  return preparees.map((e) => e.id);
}

function saisieDe(s: SaisieDuTraitement): { readonly saisie: SaisieEvenement; readonly recolteAutoriseeLe: string } {
  const detail = detailTraitement(s.produit, { dose: s.dose, surfaceTraiteeM2: s.surfaceTraiteeM2, cible: s.cible, operateur: s.operateur }, s.date as DateCalendaire);
  return {
    saisie: {
      type: 'traitement',
      date: s.date as DateCalendaire,
      source: 'tap',
      culture: s.culture,
      emplacementIds: s.emplacementIds as Id<'Emplacement'>[],
      note: null,
      photos: [],
      remplaceEvenement: null,
      detail,
    },
    recolteAutoriseeLe: detail.recolteAutoriseeLe,
  };
}

/** Écrit le traitement, DAR du produit figé ; rend son id et sa date de récolte autorisée. */
export async function ecrireTraitement(porte: PorteDonnees, s: SaisieDuTraitement, annoncer?: Annoncer): Promise<TraitementEcrit> {
  const [ecrit] = await ecrireLotTraitement(porte, [s], annoncer);
  if (ecrit === undefined) throw new TraitementRefuse('traitement non écrit');
  return ecrit;
}

/**
 * Un même produit sur plusieurs cultures (T78) : UN événement `traitement` par saisie (une par
 * culture, avec ses emplacements et SON DAR figé), dans l'ordre, en UNE transaction. Tout ou rien :
 * une saisie refusée par les règles du serveur, ou un lot vide → TraitementRefuse, rien d'écrit.
 */
export async function ecrireLotTraitement(porte: PorteDonnees, saisies: readonly SaisieDuTraitement[], annoncer?: Annoncer, aujourdhui: string = jourDuTelephone()): Promise<TraitementEcrit[]> {
  const lot = saisies.map(saisieDe);
  const ids = await ecrire(
    porte,
    lot.map((l) => l.saisie),
    annoncer,
    (fermeId) => async (lire) => {
      // Relecture : un emplacement supprimé, ou actif ni à la date du traitement ni aujourd'hui (le formulaire
      // propose ceux d'aujourd'hui, un traitement se note après coup), refuse tout le lot.
      for (const s of saisies) {
        if (s.emplacementIds.length === 0) continue;
        const actifs = await lire<{ id: string }>(
          `SELECT id FROM emplacement WHERE id IN (${s.emplacementIds.map(() => '?').join(', ')}) AND ferme_id = ? AND supprime_le IS NULL
            AND ((actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)) OR (actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)))`,
          [...s.emplacementIds, fermeId, s.date, s.date, aujourdhui, aujourdhui],
        );
        const vus = new Set(actifs.map((a) => a.id.toLowerCase()));
        if (s.emplacementIds.some((e) => !vus.has(e.toLowerCase()))) {
          throw new TraitementRefuse('un emplacement traité a été supprimé ou n’est actif ni à la date du traitement ni aujourd’hui ; rien n’a été enregistré, rouvrez la saisie');
        }
      }
    },
  );
  return lot.map((l, i) => ({ id: ids[i] ?? '', recolteAutoriseeLe: l.recolteAutoriseeLe }));
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

interface LigneTraitement {
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string | null;
  readonly note: string | null;
  readonly photos: string | null;
  readonly detail: string;
}

/** L'annulation du traitement `id` de la ferme : même détail, même culture, ses emplacements encore actifs le `jour`. */
async function annulationDe(porte: PorteDonnees, fermeId: string, id: string, jour: string): Promise<SaisieEvenement> {
  const l = (await porte.lire<LigneTraitement>(SQL_TRAITEMENT, [id, fermeId]))[0];
  if (l === undefined) throw new TraitementPlusEnVigueur('ce traitement n’est plus sur ce téléphone');
  const ids = textes(l.emplacement_ids);
  const actifs =
    ids.length === 0
      ? []
      : await porte.lire<{ id: string }>(
          `SELECT id FROM emplacement WHERE id IN (${ids.map(() => '?').join(', ')}) AND ferme_id = ? AND supprime_le IS NULL AND actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)`,
          [...ids, fermeId, jour, jour],
        );
  const garder = new Set(actifs.map((a) => a.id.toLowerCase()));
  const culture: CultureConcernee | null =
    l.serie_id !== null ? { sorte: 'serie', serieId: l.serie_id as Id<'Serie'> } : l.campagne_id !== null ? { sorte: 'campagne', campagneId: l.campagne_id as Id<'Campagne'> } : null;
  return {
    type: 'traitement',
    date: l.date as DateCalendaire,
    source: 'tap',
    culture,
    emplacementIds: ids.filter((e) => garder.has(e.toLowerCase())) as Id<'Emplacement'>[],
    note: l.note,
    photos: textes(l.photos),
    remplaceEvenement: { sorte: 'annulation', evenementId: id as Id<'Evenement'> },
    detail: JSON.parse(l.detail) as DetailTraitement,
  };
}

/**
 * Annule le traitement `id` (en vigueur) : un événement d'annulation, même détail, même culture,
 * ses emplacements encore actifs le `jour`. Vérifié dans la transaction : `id` est toujours la
 * ligne en vigueur de sa chaîne (sinon TraitementPlusEnVigueur, rien d'écrit).
 */
export async function annulerTraitement(porte: PorteDonnees, fermeId: string, id: string, jour: string, annoncer?: Annoncer): Promise<string> {
  const [annulation] = await annulerLotTraitement(porte, fermeId, [id], jour, annoncer);
  if (annulation === undefined) throw new TraitementPlusEnVigueur('ce traitement n’a pas pu être annulé');
  return annulation;
}

/**
 * Annule tous les traitements `ids` d'un lot (T78) en UNE transaction : une annulation chacun, comme
 * `annulerTraitement`. Tout ou rien : un seul qui n'est plus en vigueur (déjà annulé ou corrigé) ou
 * qui n'est pas de la ferme `fermeId` → TraitementPlusEnVigueur, aucune annulation écrite. Rend les
 * ids des annulations, dans l'ordre de `ids`.
 */
export async function annulerLotTraitement(porte: PorteDonnees, fermeId: string, ids: readonly string[], jour: string, annoncer?: Annoncer): Promise<string[]> {
  if (new Set(ids.map((i) => i.toLowerCase())).size !== ids.length) throw new TraitementRefuse('le même traitement figure deux fois dans le lot');
  const annulations: SaisieEvenement[] = [];
  for (const id of ids) annulations.push(await annulationDe(porte, fermeId, id, jour));
  return ecrire(porte, annulations, annoncer, () => async (lire) => {
    for (const id of ids) {
      const c = await chaineDe(lire, fermeId, id);
      if (c.annulee || c.enVigueur !== id) throw new TraitementPlusEnVigueur('ce traitement a déjà été annulé ou corrigé');
    }
  });
}
