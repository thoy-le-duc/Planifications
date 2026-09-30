/**
 * Lectures de l'écran des itinéraires (T24), toutes par la porte : itinéraires, espèces et types
 * d'intervention de la ferme et de la bibliothèque (surveillés : l'écran suit ses propres
 * écritures et la synchro), et les séries à venir d'un itinéraire.
 */
import type { PorteDonnees, RequeteSurveillee } from '@planif/sync';
import { versEspece, versItineraire, versType, type EspeceLue, type ItineraireLu, type TypeLu } from './calculs.ts';

export function requeteItineraires(fermeId: string): RequeteSurveillee<ItineraireLu> {
  return {
    sql: 'SELECT id, ferme_id, espece_id, variete_id, nom, mode, parametres FROM itineraire WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
    parametres: [fermeId],
    tables: ['itineraire'],
    convertir: versItineraire,
  };
}

export function requeteEspeces(fermeId: string): RequeteSurveillee<EspeceLue> {
  return {
    sql: 'SELECT id, nom FROM espece WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
    parametres: [fermeId],
    tables: ['espece'],
    convertir: versEspece,
  };
}

export function requeteTypes(fermeId: string): RequeteSurveillee<TypeLu | null> {
  return {
    sql: 'SELECT id, ferme_id, categorie, libelle, masque FROM type_intervention WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
    parametres: [fermeId],
    tables: ['type_intervention'],
    convertir: versType,
  };
}

/**
 * Règle « en vigueur » de l'écran Aujourd'hui (vue evenements_en_vigueur de @planif/db), pour
 * l'alias `ev` : ni une annulation, ni un événement annulé ou corrigé ; une correction seulement
 * si c'est la plus récente de son événement et qu'il n'est pas annulé.
 */
const EN_VIGUEUR = `(ev.remplace_sorte IS NULL OR ev.remplace_sorte <> 'annulation')
    AND ev.id NOT IN (SELECT remplace_evenement_id FROM evenement WHERE ferme_id = ? AND remplace_evenement_id IS NOT NULL)
    AND (ev.remplace_sorte IS NULL OR (
      ev.remplace_evenement_id NOT IN (SELECT remplace_evenement_id FROM evenement WHERE ferme_id = ? AND remplace_sorte = 'annulation')
      AND (ev.remplace_evenement_id, ev.horodatage || '|' || ev.id) IN (
        SELECT remplace_evenement_id, MAX(horodatage || '|' || id) FROM evenement
        WHERE ferme_id = ? AND remplace_sorte = 'correction' GROUP BY remplace_evenement_id)))`;

/**
 * Condition « à venir » d'une série d'alias `s` (décisions 10 et 11) : non supprimée, prévue,
 * première date prévue (semis en pépinière, sinon mise en place) pas passée, et aucun réalisé,
 * aucune récolte ni aucune intervention en vigueur. Paramètres : `parametresAVenir`.
 */
export const conditionAVenir = (s: string): string => `${s}.supprime_le IS NULL AND ${s}.statut = 'prevue'
    AND COALESCE(${s}.prevu_semis_pepiniere, ${s}.prevu_mise_en_place) >= ?
    AND NOT EXISTS (
      SELECT 1 FROM evenement ev
      WHERE ev.ferme_id = ? AND ev.serie_id = ${s}.id AND ev.type IN ('realise', 'recolte', 'intervention') AND ${EN_VIGUEUR})`;

export const parametresAVenir = (fermeId: string, aujourdhui: string): string[] => [aujourdhui, fermeId, fermeId, fermeId, fermeId];

/** Séries À VENIR d'un itinéraire, par mise en place. */
const SQL_A_VENIR = `SELECT s.id, s.prevu_mise_en_place, e.nom AS nom_espece,
    (SELECT group_concat(code, ', ') FROM (
      SELECT em.code AS code FROM occupation o JOIN emplacement em ON em.id = o.emplacement_id
      WHERE o.serie_id = s.id AND o.supprime_le IS NULL ORDER BY em.code)) AS codes,
    (SELECT COUNT(*) FROM occupation o2 WHERE o2.serie_id = s.id AND o2.supprime_le IS NULL) AS nb_occupations
  FROM serie s
  LEFT JOIN espece e ON e.id = s.espece_id
  WHERE s.ferme_id = ? AND s.itineraire_id = ? AND ${conditionAVenir('s')}
  ORDER BY s.prevu_mise_en_place, s.id`;

export interface SerieAVenir {
  readonly id: string;
  readonly miseEnPlace: string;
  readonly culture: string;
  readonly planches: string;
  /** Occupations actives : chacune est une écriture de plus (plafond du lot, décision 12). */
  readonly occupations: number;
}

export async function lireSeriesAVenir(porte: PorteDonnees, fermeId: string, itineraireId: string, aujourdhui: string): Promise<SerieAVenir[]> {
  const lignes = await porte.lire<Readonly<Record<string, unknown>>>(SQL_A_VENIR, [fermeId, itineraireId, ...parametresAVenir(fermeId, aujourdhui)]);
  return lignes.map((l) => ({
    id: String(l.id),
    miseEnPlace: typeof l.prevu_mise_en_place === 'string' ? l.prevu_mise_en_place : '',
    culture: typeof l.nom_espece === 'string' ? l.nom_espece : 'Culture',
    planches: typeof l.codes === 'string' ? l.codes : '',
    occupations: typeof l.nb_occupations === 'number' ? l.nb_occupations : 0,
  }));
}
