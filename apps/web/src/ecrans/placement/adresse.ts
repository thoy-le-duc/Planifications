/**
 * Recherche d'adresse de l'éditeur de placement (T28h, Q35) : l'adresse du service de géocodage de la
 * Géoplateforme (IGN, sans clé, hébergé en France), la lecture de sa réponse GeoJSON et le zoom adapté
 * au type de résultat. Pur : ni React, ni DOM, ni réseau. Contrat : ./test/contrat-adresse.ts.
 *
 * Données du maraîcher : seul le texte tapé part dans la requête ; aucune adresse n'est enregistrée.
 */
import { ZOOM_MIN_VUE, ZOOM_TUILES_MAX } from './tuiles.ts';

export const URL_GEOCODAGE = 'https://data.geopf.fr/geocodage/search';
export const PROPOSITIONS_MAX = 5;
/** Attente après la dernière frappe avant d'interroger le service. */
export const DELAI_SAISIE_MS = 300;

export function urlRechercheAdresse(texte: string): string | null {
  const q = texte.trim();
  if (q === '') return null;
  return `${URL_GEOCODAGE}?${new URLSearchParams({ q, limit: String(PROPOSITIONS_MAX) }).toString()}`;
}

export interface PropositionAdresse {
  readonly libelle: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly type: string;
  readonly zoom: number;
}

/** Commune : vue large ; lieu-dit : quartier ; rue : vue de la parcelle ; numéro : parcelle de près. */
const ZOOM_PAR_TYPE: Readonly<Record<string, number>> = { municipality: 13, locality: 15, street: 17, housenumber: 18 };
const ZOOM_TYPE_INCONNU = 15;

export function zoomPourType(type: string): number {
  const zoom = Object.hasOwn(ZOOM_PAR_TYPE, type) ? (ZOOM_PAR_TYPE[type] ?? ZOOM_TYPE_INCONNU) : ZOOM_TYPE_INCONNU;
  return Math.min(ZOOM_TUILES_MAX, Math.max(ZOOM_MIN_VUE, zoom));
}

const estObjet = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null;
const finiDans = (v: unknown, borne: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= borne;

function proposition(feature: unknown): PropositionAdresse | null {
  if (!estObjet(feature) || !estObjet(feature.geometry) || !estObjet(feature.properties)) return null;
  const { coordinates } = feature.geometry;
  const { label, type } = feature.properties;
  if (!Array.isArray(coordinates) || typeof label !== 'string' || label.trim() === '') return null;
  const [longitude, latitude] = coordinates as unknown[];
  if (!finiDans(longitude, 180) || !finiDans(latitude, 90)) return null;
  const sorte = typeof type === 'string' ? type : '';
  return { libelle: label, latitude, longitude, type: sorte, zoom: zoomPourType(sorte) };
}

/** Au plus PROPOSITIONS_MAX propositions, dans l'ordre reçu ; toute autre forme de réponse donne []. */
export function analyserReponseAdresse(json: unknown): readonly PropositionAdresse[] {
  if (!estObjet(json) || !Array.isArray(json.features)) return [];
  const resultat: PropositionAdresse[] = [];
  for (const f of json.features as unknown[]) {
    const p = proposition(f);
    if (p !== null) resultat.push(p);
    if (resultat.length >= PROPOSITIONS_MAX) break;
  }
  return resultat;
}
