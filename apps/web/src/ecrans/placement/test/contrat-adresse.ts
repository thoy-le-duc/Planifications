/**
 * Contrat de T28h — chercher une adresse, voir large, plusieurs sites (docs/backlog/T28h-adresse-recul-sites.md, Q35).
 * Lu par adresse.test.ts, adresse-editeur.test.tsx, ../../../scripts/csp-adresse.test.ts et
 * ../../../e2e/placement-adresse.e2e.ts. Les modules sont chargés par chemin dynamique : les tests
 * typent avant que le code n'existe.
 *
 * ── ./adresse.ts (pur : ni React, ni DOM, ni réseau) ──────────────────────────────────────────
 *   URL_GEOCODAGE      = 'https://data.geopf.fr/geocodage/search'
 *   PROPOSITIONS_MAX   = 5
 *   DELAI_SAISIE_MS    = 300
 *   urlRechercheAdresse(texte): string | null
 *       `${URL_GEOCODAGE}?q=<texte rogné>&limit=5` ; null si le texte rogné est vide. Aucune
 *       autre clé n'est nécessaire (service public, sans clé d'API).
 *   analyserReponseAdresse(json: unknown): PropositionAdresse[]
 *       GeoJSON de la Géoplateforme : features[i].geometry.coordinates = [LONGITUDE, latitude],
 *       features[i].properties = { label, type } avec type ∈ housenumber | street | locality |
 *       municipality. Au plus PROPOSITIONS_MAX, dans l'ordre reçu ; une feature sans libellé, sans
 *       coordonnées numériques finies ou hors du globe est ignorée ; toute autre forme → [].
 *       Ne lève jamais.
 *   zoomPourType(type: string): entier dans [ZOOM_MIN_VUE, ZOOM_TUILES_MAX], croissant avec la
 *       précision : municipality ≤ 13 < locality < street (≥ 17) ≤ housenumber (≥ 18). Type inconnu :
 *       un entier de la même plage, sans lever.
 *
 * ── ./tuiles.ts ───────────────────────────────────────────────────────────────────────────────
 *   ZOOM_MIN_VUE = 6 (zoom minimal de l'éditeur, boutons et molette) ;
 *   ZOOM_DEPART_SANS_POSITION = 6 ; ZOOM_INITIAL (19) et ZOOM_TUILES_MAX (19) inchangés.
 *
 * ── ./sites.ts (pur) ──────────────────────────────────────────────────────────────────────────
 *   vueSurEmprise(emprise, ecran, latitude): { centre: Point; zoom: number }
 *       emprise = { minX, maxX, minY, maxY } en mètres du repère local ; ecran = { largeurPx, hauteurPx } ;
 *       latitude de l'origine (pour les m/px). centre = milieu de l'emprise ; zoom = le plus grand
 *       entier dans [ZOOM_MIN_VUE, ZOOM_TUILES_MAX] pour lequel l'emprise occupe au plus 90 % de la
 *       largeur ET 90 % de la hauteur ; si même ZOOM_MIN_VUE ne suffit pas : ZOOM_MIN_VUE. Une emprise
 *       réduite à un point : ZOOM_TUILES_MAX.
 *
 * ── DOM de l'éditeur (en plus de contrat.ts) ──────────────────────────────────────────────────
 * Tous modes (gérant, équipier, téléphone), en haut de l'éditeur :
 *   `recherche-adresse` : <input> de nom accessible « Adresse, commune ou lieu-dit ». Grosse police
 *       (gants). data-mis-en-avant="true" quand la ferme n'a NI origine du plan NI position (départ
 *       à ZOOM_DEPART_SANS_POSITION), sinon absent ou "false".
 *   `propositions-adresse` : liste (présente seulement quand il y a des propositions), un
 *       `proposition-adresse` par résultat (role="option" ou bouton), data-type, data-latitude,
 *       data-longitude, texte = libellé. Un tap centre la carte et ferme la liste.
 *       Entrée dans le champ prend la première proposition.
 *   `message-adresse` : role="status", seulement quand il y a quelque chose à dire :
 *       MESSAGES_ADRESSE.indisponible (hors ligne, réseau en échec, service muet : HTTP non 2xx,
 *       réponse illisible) ou MESSAGES_ADRESSE.aucun (réponse sans résultat). Jamais de role="alert",
 *       jamais d'erreur levée ; l'éditeur reste utilisable. Une requête abandonnée par la frappe
 *       suivante n'affiche rien.
 *   Requête : fetch(urlRechercheAdresse(texte), { signal }) — signal d'un AbortController, abandonné
 *       dès qu'une nouvelle requête part ou que le champ est vidé ; 300 ms (DELAI_SAISIE_MS) après la
 *       dernière frappe ; jamais en hors ligne (props.enLigne === false) ; une seule à la fois.
 *   `aller-a` : <select> de nom accessible « Aller à » : première option value '' (invite), puis une
 *       option par zone de PREMIER niveau (zone_parente_id null) PLACÉE (contour non nul), value = id
 *       de la zone, texte = son nom, ordre de la base. Choisir une zone centre la vue sur le milieu de
 *       l'emprise de son contour et zoome avec vueSurEmprise.
 *   `toute-la-ferme` : bouton « Toute la ferme » ; cadre l'union des contours des zones de la liste
 *       « Aller à » (vueSurEmprise). Absent ou désactivé s'il n'y a aucune zone placée.
 *   `editeur-placement` gagne data-centre = 'latitude,longitude' du milieu de l'écran (5 décimales
 *       au moins). Ni la recherche ni « Aller à » ne changent data-origine, ni n'écrivent
 *       (porte.placer jamais appelé).
 */
import type { ReactElement } from 'react';

export type TypeResultat = 'housenumber' | 'street' | 'locality' | 'municipality';

export interface PropositionAdresse {
  readonly libelle: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly type: string;
  readonly zoom: number;
}

export interface ModuleAdresse {
  readonly URL_GEOCODAGE: string;
  readonly PROPOSITIONS_MAX: number;
  readonly DELAI_SAISIE_MS: number;
  urlRechercheAdresse(texte: string): string | null;
  analyserReponseAdresse(json: unknown): readonly PropositionAdresse[];
  zoomPourType(type: string): number;
}

export interface Emprise {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface ModuleSites {
  vueSurEmprise(emprise: Emprise, ecran: { readonly largeurPx: number; readonly hauteurPx: number }, latitude: number): { readonly centre: { readonly x: number; readonly y: number }; readonly zoom: number };
}

export interface ModuleTuilesT28h {
  readonly ZOOM_MIN_VUE: number;
  readonly ZOOM_DEPART_SANS_POSITION: number;
  readonly ZOOM_INITIAL: number;
  readonly ZOOM_TUILES_MAX: number;
}

export type { ReactElement };

export const MESSAGES_ADRESSE = {
  indisponible: 'Recherche d’adresse indisponible sans réseau ; déplacez la carte à la main',
  aucun: 'Aucune adresse trouvée',
} as const;
/** Motif tolérant sur l'apostrophe (’ ou '). */
export const MOTIF_INDISPONIBLE = /Recherche d.adresse indisponible sans réseau ; déplacez la carte à la main/;

export const NOM_CHAMP_ADRESSE = 'Adresse, commune ou lieu-dit';

export const TESTID_ADRESSE = {
  champ: 'recherche-adresse',
  propositions: 'propositions-adresse',
  proposition: 'proposition-adresse',
  message: 'message-adresse',
  allerA: 'aller-a',
  toutelaFerme: 'toute-la-ferme',
} as const;

/** Réponse type de la Géoplateforme (GeoJSON), coordonnées [longitude, latitude]. */
export function reponseGeocodage(features: readonly { readonly label: string; readonly type: string; readonly longitude: number; readonly latitude: number }[]): unknown {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
      properties: { label: f.label, type: f.type, score: 0.9 },
    })),
  };
}

export const MOISSAC = { label: 'Moissac', type: 'municipality', longitude: 1.0868, latitude: 44.1043 } as const;
export const RUE_MOISSAC = { label: 'Rue de la République 82200 Moissac', type: 'street', longitude: 1.0889, latitude: 44.1039 } as const;
export const NUMERO_MOISSAC = { label: '12 Rue de la République 82200 Moissac', type: 'housenumber', longitude: 1.0891, latitude: 44.1037 } as const;
