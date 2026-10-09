/**
 * Contrat de T28e — suites de relecture de l'éditeur de placement (docs/backlog/T28e-editeur-suites.md).
 * Complète ./contrat.ts (T28b) et ./contrat-contours.ts (T28d), qui restent valables en entier.
 *
 * ── Constantes (modules purs) ────────────────────────────────────────────────────────────────
 *
 * tuiles.ts exporte :
 *   ZOOM_DEPART_SANS_POSITION : entier, ZOOM_INITIAL − 2 au plus (donc 17 au plus) et 6 au moins
 *     (le plus petit zoom de l'éditeur depuis T28h, Q35). Zoom de la vue à l'ouverture quand la ferme n'a NI origine
 *     du plan NI position. ZOOM_INITIAL (19) reste le zoom de départ dans tous les autres cas.
 *   DELAI_RELANCE_TUILE_MS : entier, 5 000 au plus (et 500 au moins) : délai entre l'échec d'une
 *     tuile et sa nouvelle demande.
 *   ESSAIS_TUILE_MAX : entier de 1 à 10 : nombre de nouvelles demandes d'une même tuile après
 *     son premier échec (donc 1 + ESSAIS_TUILE_MAX demandes au plus par tuile et par session).
 *
 * ── Écran ────────────────────────────────────────────────────────────────────────────────────
 *
 * Zoom de départ : `editeur-placement` a data-zoom = String(ZOOM_DEPART_SANS_POSITION) à
 *   l'ouverture d'une ferme sans origine ni position ; String(ZOOM_INITIAL) si la ferme a une
 *   position (sans origine) ou une origine.
 *
 * Mode pose (après « Poser » dans le formulaire « Nouveau bâtiment », avant le clic sur le plan) :
 *   - un bouton « Poser au centre de la vue » (nom accessible exact) est proposé, à côté du message
 *     « Touchez la photo… » ; il n'existe pas hors du mode pose ni en lecture seule ;
 *   - Entrée (keydown sur le plan ou sur l'éditeur, focus ni dans un champ ni sur un bouton) fait
 *     la même chose que le bouton ;
 *   - effet : le bâtiment est posé au CENTRE DE LA VUE (point affiché au milieu du plan, vue
 *     déplacée comprise), orientation 0, sans zone, avec le nom, le type et les dimensions du
 *     formulaire ; il devient le bâtiment sélectionné (aria-pressed="true") ; le mode pose se
 *     termine ; rien n'est écrit (brouillon, comme le clic sur le plan).
 *   - Entrée hors du mode pose ne pose rien.
 *
 * Panneau : une saisie de « Longueur (m) » ou « Largeur (m) » inférieure à DIMENSION_MIN_M (0,5)
 *   — 0,2, 0, ou négative — donne 0,5 : data-longueur / data-largeur du bâtiment, valeur du champ
 *   et valeur écrite par « Enregistrer ».
 *
 * Brouillon abandonné : quand fermeId ou la porte change sans démonter l'éditeur (T28b, B1) ET
 *   qu'un brouillon était ouvert (« Enregistrer » actif), un message role="status" (ou "alert")
 *   dont le texte contient MESSAGES_SUITES.brouillonAbandonne s'affiche dans l'éditeur de la
 *   nouvelle ferme. Sans brouillon ouvert, pas de message.
 *
 * Confirmation d'abri (zone qui a un contour) : le texte contient MESSAGES_PLACEMENT.contourRemplace
 *   ET MESSAGES_SUITES.planchesSuivent.
 *
 * Tuiles en erreur (images <img data-testid="tuile">, horloge simulée) :
 *   - une tuile dont l'événement `error` est reçu est masquée comme avant (T28b), puis, au bout de
 *     DELAI_RELANCE_TUILE_MS exactement (pas avant), redemandée : un NOUVEL élément <img> (même
 *     src) est monté. Aucun événement « online » n'est nécessaire ;
 *   - une tuile qui échoue toujours est redemandée au plus ESSAIS_TUILE_MAX fois, une relance à
 *     la fois (plusieurs `error` pour un même montage ne programment qu'une relance) ;
 *   - le message MESSAGES_PLACEMENT.indisponible (toutes les tuiles ont échoué, en ligne) disparaît
 *     dès qu'une tuile redemandée se charge ; MESSAGES_PLACEMENT.horsLigne ne s'affiche que hors ligne.
 *
 * T28d, relecture : abandonner un tracé (Échap) quand la zone n'est plus affichée ne laisse pas
 *   de focus « en attente » : le focus ne saute pas plus tard sur « Tracer le contour ».
 * brouillon.ts : sa copie locale ECRITURES_MAX_PAR_LOT est égale à celle de @planif/sync (500).
 */

/** Messages exacts de T28e (contenus dans le texte affiché). */
export const MESSAGES_SUITES = {
  brouillonAbandonne: 'Le brouillon en cours a été abandonné : la ferme active a changé.',
  planchesSuivent: 'Les planches de la zone suivront la serre.',
} as const;

export const BOUTON_POSER_AU_CENTRE = 'Poser au centre de la vue';

export interface ConstantesSuites {
  readonly ZOOM_DEPART_SANS_POSITION: number;
  readonly DELAI_RELANCE_TUILE_MS: number;
  readonly ESSAIS_TUILE_MAX: number;
}
