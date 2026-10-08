/**
 * Contrat de T28b — éditeur de placement sur photo aérienne (docs/backlog/T28b-editeur-placement.md,
 * Q30, Q31 ; modèle : docs/modele-donnees.md, « 1 bis. Placement réel — v1.x »). Types seuls : les
 * tests chargent les modules par import dynamique (chemin tenu dans une variable), leur typage ne
 * dépend pas du code pas encore écrit.
 *
 * ── Modules attendus (apps/web/src/ecrans/placement/) ────────────────────────────────────────
 *
 * tuiles.ts — PUR (ModuleTuiles) : ni React, ni DOM, ni réseau, ni horloge, AUCUNE bibliothèque de
 *   carte. Tuiles WMTS de la Géoplateforme (Web Mercator, jeu de tuiles « PM »), passage repère
 *   local de la ferme (mètres, x est, y nord) ↔ pixels de l'écran. N'importe de @planif/core que
 *   `versLocal` / `versGeographique` (ou rien) : importable sous Node (e2e).
 *
 * gestes.ts — PUR (ModuleGestes) : glisser, pivoter, redimensionner, clavier, et passage d'une
 *   planche du repère de la ferme au repère de sa zone. Mêmes contraintes que tuiles.ts.
 *
 * index.ts — l'éditeur (ModuleEditeur), chargé par import dynamique SEULEMENT depuis l'écran
 *   Ferme : `import('../placement/index.ts')`, jamais d'import statique (vérifié par
 *   scripts/placement.test.ts). Il reçoit la porte (pas de src/donnees, pas de PowerSync) et
 *   n'écrit QUE par `porte.placer` (T28s) : ni `ecrire`, ni `ecrireEnsemble`, ni `fetch`.
 *
 * ── Fond : orthophoto IGN, WMTS sans clé ─────────────────────────────────────────────────────
 *
 * URL d'une tuile (requête KVP, paramètres dans n'importe quel ordre, AUCUNE clé ni `apikey`) :
 *   https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
 *     &LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM
 *     &TILEMATRIX={zoom}&TILEROW={ligne}&TILECOL={colonne}&FORMAT=image/jpeg
 * Web Mercator standard (celui d'OpenStreetMap, que le jeu « PM » de l'IGN suit) : au zoom z, le
 *   monde fait 256·2^z pixels de côté ; x = (lon + 180)/360 · 256·2^z ;
 *   y = (1/2 − ln((1 + sin φ)/(1 − sin φ)) / (4π)) · 256·2^z ; colonne = ⌊x/256⌋, ligne = ⌊y/256⌋.
 * Tuiles chargées par des <img> seulement (CSP : `img-src 'self' https://data.geopf.fr`,
 *   `connect-src` inchangé). Mention « © IGN » visible tant que la photo est affichée. Aucune mise
 *   en cache des tuiles dans ce ticket : sw.js ne cite pas data.geopf.fr.
 *
 * ── Vue (écran ↔ repère local) ───────────────────────────────────────────────────────────────
 *
 * Le nord est en haut, l'est à droite, sans rotation de la vue. Échelle uniforme :
 *   m/px = metresParPixel(origine.latitude, zoom) = 2π·R·cos φ0 / (256·2^zoom), R = 6 378 137 m.
 * Le point `centre` (repère local) est au milieu de l'écran (largeurPx/2, hauteurPx/2).
 * Une tuile est posée là où son coin nord-ouest tombe (Mercator → latitude, longitude →
 *   `versLocal(origine, …)` → écran) : un point géographique P est dessiné, sur la photo, à 1 px
 *   près de versEcran(versLocal(origine, P)), même à 3 km de l'origine. Au zoom de la vue au-delà
 *   de ZOOM_TUILES_MAX, les tuiles de ZOOM_TUILES_MAX sont agrandies.
 * Sans origine du plan, la vue prend `ferme.position` (position météo) comme origine provisoire.
 *   À l'ouverture : vue centrée sur le point (0, 0) de l'origine (ou de la position), zoom
 *   ZOOM_INITIAL.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Une tuile du jeu PM : zoom (TILEMATRIX), colonne (TILECOL), ligne (TILEROW). */
export interface Tuile {
  readonly zoom: number;
  readonly colonne: number;
  readonly ligne: number;
}

/** La tuile qui contient un point, et le pixel du point dans la tuile ([0, 256[). */
export interface TuileEtPixel extends Tuile {
  readonly px: number;
  readonly py: number;
}

export interface VueCarte {
  /** Origine du repère local (origine du plan, ou position météo en attendant). */
  readonly origine: Position;
  /** Point du repère local affiché au milieu de l'écran. */
  readonly centre: Point;
  /** Zoom entier de la vue (≥ 1). */
  readonly zoom: number;
  readonly largeurPx: number;
  readonly hauteurPx: number;
}

/** Une tuile à dessiner : son coin nord-ouest (x, y) et sa taille à l'écran, en pixels. */
export interface TuileVisible extends Tuile {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

export interface ModuleTuiles {
  /** 'https://data.geopf.fr/wmts' */
  readonly URL_WMTS: string;
  /** 'ORTHOIMAGERY.ORTHOPHOTOS' */
  readonly COUCHE_ORTHO: string;
  /** 'PM' */
  readonly JEU_TUILES: string;
  /** 256 */
  readonly TAILLE_TUILE_PX: number;
  /** Zoom le plus fin demandé à la Géoplateforme : 19. */
  readonly ZOOM_TUILES_MAX: number;
  /** Zoom de la vue à l'ouverture de l'éditeur : 19. */
  readonly ZOOM_INITIAL: number;
  /** '© IGN' */
  readonly MENTION_IGN: string;
  /** Pixel du point dans le monde Web Mercator au zoom donné (256·2^zoom de côté). */
  pixelMonde(position: Position, zoom: number): Point;
  tuileDe(position: Position, zoom: number): TuileEtPixel;
  urlTuile(tuile: Tuile): string;
  /** Mètres au sol par pixel de l'écran à cette latitude et ce zoom. */
  metresParPixel(latitude: number, zoom: number): number;
  versEcran(vue: VueCarte, point: Point): Point;
  depuisEcran(vue: VueCarte, pixel: Point): Point;
  /**
   * Les tuiles qui recouvrent l'écran (au zoom min(vue.zoom, ZOOM_TUILES_MAX)) : chaque pixel de
   * l'écran est dans au moins une tuile ; aucune tuile en double ; aucune entièrement hors écran.
   */
  tuilesVisibles(vue: VueCarte): TuileVisible[];
}

// ── Gestes ───────────────────────────────────────────────────────────────────────────────────

/**
 * Un rectangle posé dans le repère de la ferme : bâtiment, ou planche ramenée dans le repère de
 * la ferme. Axe de la longueur au cap `orientationDeg` (sens horaire depuis le nord, [0, 360[),
 * largeur à sa droite (cap + 90°), comme `coinsEmprise` de @planif/core.
 */
export interface RectanglePlace {
  readonly centre: Point;
  readonly orientationDeg: number;
  readonly longueurM: number;
  readonly largeurM: number;
}

/**
 * Côté d'un rectangle tiré par sa poignée, dans le repère du rectangle : 'avant' = bout de la
 * longueur vers le cap (+y'), 'arriere' = bout opposé (−y'), 'droite' = côté +x' (cap + 90°),
 * 'gauche' = côté −x'.
 */
export type Cote = 'avant' | 'arriere' | 'droite' | 'gauche';

export interface Touche {
  readonly key: string;
  readonly shiftKey: boolean;
}

export interface ModuleGestes {
  /** Plus petite longueur ou largeur qu'un redimensionnement laisse : 0,5 m. */
  readonly DIMENSION_MIN_M: number;
  /** Translation de (vers − de) ; orientation et dimensions inchangées. */
  glisser(r: RectanglePlace, de: Point, vers: Point): RectanglePlace;
  /**
   * L'axe de la longueur pointe vers le pointeur : cap du centre au pointeur, arrondi au degré
   * (`maj` : aux 15°), ramené dans [0, 360[ (360 → 0). Pointeur sur le centre : inchangé.
   * Centre et dimensions inchangés.
   */
  pivoter(r: RectanglePlace, pointeur: Point, maj: boolean): RectanglePlace;
  /**
   * Le côté `cote` vient sous le pointeur (projeté sur l'axe du côté), le côté opposé ne bouge
   * pas : la dimension change, le centre glisse de la moitié du changement le long de l'axe.
   * Dimension au moins DIMENSION_MIN_M (le côté opposé reste fixe). Orientation inchangée.
   */
  redimensionner(r: RectanglePlace, cote: Cote, pointeur: Point): RectanglePlace;
  /**
   * Clavier (repère de la ferme, nord en haut) : flèches = 0,1 m (Maj : 1 m) — droite → est
   * (+x), gauche → ouest, haut → nord (+y), bas → sud ; ']' = +1°, '[' = −1° (ramené dans
   * [0, 360[). Toute autre touche : null (l'éditeur la laisse passer).
   */
  appliquerTouche(r: RectanglePlace, touche: Touche): RectanglePlace | null;
  /**
   * Planche : rectangle du repère de la ferme → placement dans le repère de sa zone
   * (`versRepereZone` de @planif/core pour le centre ; orientation relative à celle de la zone,
   * ramenée dans [0, 360[). C'est ce que l'éditeur passe à porte.placer (sorte 'emplacement').
   */
  versPlacementPlanche(repere: { readonly centre: Point; readonly orientationDeg: number }, r: RectanglePlace): { x: number; y: number; orientation_deg: number };
  /** Inverse : placement d'une planche dans sa zone → centre et cap dans le repère de la ferme. */
  depuisPlacementPlanche(
    repere: { readonly centre: Point; readonly orientationDeg: number },
    placement: { readonly x: number; readonly y: number; readonly orientation_deg: number },
  ): { centre: Point; orientationDeg: number };
}

// ── Éditeur ──────────────────────────────────────────────────────────────────────────────────

export interface ProprietesEditeurPlacement {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Utilisateur de la session : son rôle se lit dans la table locale `membre`. */
  readonly utilisateurId: string;
  readonly surFermer: () => void;
  /** Écran assez grand pour éditer. Défaut : matchMedia('(min-width: 1024px)'). */
  readonly ordinateur?: boolean;
  /** Réseau. Défaut : navigator.onLine, suivi par les événements online / offline. */
  readonly enLigne?: boolean;
  /** Durée d'affichage du bouton « Annuler » après un enregistrement. Défaut : DELAI_ANNULATION_MS. */
  readonly delaiAnnulationMs?: number;
  /** Identifiant d'un nouveau bâtiment (UUID v7). Défaut : générateur de @planif/core. */
  readonly nouvelId?: () => string;
}

export interface ModuleEditeur {
  readonly EditeurPlacement: (p: ProprietesEditeurPlacement) => ReactElement;
  readonly default: (p: ProprietesEditeurPlacement) => ReactElement;
  /** Entre 3 000 et 15 000 ms (« quelques secondes »). */
  readonly DELAI_ANNULATION_MS: number;
}

/** Messages exacts (contenus dans le texte affiché). */
export const MESSAGES_PLACEMENT = {
  seulGerant: 'Seul le gérant peut placer les éléments de la ferme',
  horsLigne: 'Photo aérienne indisponible hors ligne',
  ordinateur: 'à faire sur ordinateur',
  contourRemplace: 'Le contour de la zone sera remplacé par la serre',
} as const;

/** Nom de l'entrée dans l'onglet Ferme (bouton). */
export const ENTREE_PLACEMENT = 'Placer sur la photo aérienne';

/**
 * ── DOM de l'éditeur (data-testid), lu par editeur.test.tsx et e2e/placement.e2e.ts ──────────
 *
 * `editeur-placement` : racine (role="dialog", nom accessible commençant par « Placement »).
 *   data-mode   = 'edition' (gérant actif sur ordinateur) | 'lecture' (équipier, ou téléphone) ;
 *   data-fond   = 'photo' | 'neutre' ;
 *   data-zoom   = zoom des tuiles affichées (entier) ;
 *   data-origine = 'latitude,longitude' de l'origine du plan enregistrée, '' sans origine.
 *   Contient un bouton « Fermer » (ou « Retour ») qui appelle surFermer.
 * `fond-photo` : les tuiles, des <img data-testid="tuile"> dont src = urlTuile(...) ; présent
 *   seulement en ligne. Une tuile qui ne se charge pas (événement error) fait passer en
 *   fond neutre. `mention-ign` : texte « © IGN », visible avec la photo.
 * `fond-neutre` : quadrillage (1 carreau = 10 m) et message MESSAGES_PLACEMENT.horsLigne ; aucune
 *   tuile demandée. L'édition marche pareil.
 * `plan-placement` : la surface de dessin (SVG ou div) ; un clic (pointerdown + pointerup au même
 *   endroit) y pose le point de départ ou le nouveau bâtiment.
 * `origine-absente` : message (role="status") quand la ferme n'a pas d'origine, qui contient
 *   « point de départ » ; en mode édition, un bouton « Utiliser la position de la ferme »
 *   (si ferme.position existe). Sans origine : « Nouveau bâtiment » désactivé, rien d'autre ne
 *   s'écrit (Q31 : aucun placement sans point de départ).
 *   Un clic sur le plan (ou le bouton) ouvre une confirmation (role="alertdialog" ou "dialog",
 *   texte « point de départ ») ; « Confirmer » écrit porte.placer([{ sorte: 'origine', … }]) —
 *   lieu cliqué (versGeographique de l'origine provisoire), ou la position de la ferme telle quelle.
 * `batiment` : un par bâtiment non supprimé de la ferme ; role="button", tabindex 0, nom
 *   accessible contenant son nom ; data-id ; data-x, data-y (centre, m), data-orientation (°),
 *   data-longueur, data-largeur (m) : valeurs AFFICHÉES (brouillon compris). aria-pressed="true"
 *   quand il est sélectionné (clic ou focus clavier).
 * `planche` : une par planche placée (lecture des positions ; data-id).
 * `zone-contour` : contour d'une zone, lecture seule (data-id).
 * Poignées de l'élément sélectionné, en mode édition seulement : `poignee-rotation`, et
 *   `poignee-cote` × 4 (data-cote = 'avant' | 'arriere' | 'droite' | 'gauche').
 * `panneau-placement` : champs <input type="number"> du sélectionné, noms accessibles
 *   « x (m) », « y (m) », « Orientation (°) », « Longueur (m) », « Largeur (m) », « Hauteur (m) »,
 *   et une liste <select> « Zone abritée » (option '' = aucune). Une saisie (événement change)
 *   modifie le brouillon. En lecture : champs désactivés (disabled ou readonly).
 * Boutons (mode édition seulement) : « Nouveau bâtiment » (formulaire role="dialog" nommé
 *   « Nouveau bâtiment » : liste « Type » dont les valeurs d'option sont les codes de
 *   TYPES_BATIMENT, champs « Nom », « Longueur (m) », « Largeur (m) », « Hauteur (m) », bouton
 *   « Poser » ; le clic suivant sur le plan pose le centre, orientation 0, sans zone ; le
 *   bâtiment est alors un brouillon sélectionné, rien n'est écrit),
 *   « Enregistrer » (désactivé sans brouillon) : UN tap = UN appel porte.placer avec tous les
 *   changements du brouillon ; puis `annuler-placement` (bouton « Annuler ») pendant
 *   delaiAnnulationMs : il appelle porte.placer(annulation rendue). Ctrl+Z (ou Cmd+Z) annule le
 *   dernier enregistrement de la session non encore annulé, puis le précédent (pile).
 * Pendant un geste (glisser, pivoter, flèches, champs), RIEN n'est écrit.
 * Rejet de la porte : message role="alert" qui contient le message de la porte ; brouillon gardé.
 * Zone abritée qui a un contour : confirmation (texte MESSAGES_PLACEMENT.contourRemplace) ;
 *   « Confirmer » met au brouillon [{ sorte: 'zone', id, contour: null }, puis le bâtiment avec
 *   zone_id], écrits dans cet ordre en un seul appel.
 * Lecture seule (data-mode 'lecture') : aucune poignée, ni « Enregistrer », ni « Nouveau
 *   bâtiment », ni « Utiliser la position de la ferme » ; un clic sur le plan n'ouvre rien ;
 *   les touches ne changent rien. Message role="status" : équipier → MESSAGES_PLACEMENT.seulGerant ;
 *   téléphone → MESSAGES_PLACEMENT.ordinateur.
 */
export const TESTID_PLACEMENT = {
  editeur: 'editeur-placement',
  fondPhoto: 'fond-photo',
  tuile: 'tuile',
  mentionIgn: 'mention-ign',
  fondNeutre: 'fond-neutre',
  plan: 'plan-placement',
  origineAbsente: 'origine-absente',
  batiment: 'batiment',
  planche: 'planche',
  zoneContour: 'zone-contour',
  poigneeRotation: 'poignee-rotation',
  poigneeCote: 'poignee-cote',
  panneau: 'panneau-placement',
  annuler: 'annuler-placement',
} as const;

/** Budget dédié du morceau de l'éditeur (apps/web/budget.json) : bornes de vraisemblance. */
export const BORNES_BUDGET_PLACEMENT_KIO = { min: 4, max: 40 } as const;
