/**
 * Contrat de T37b — la 3D au téléphone : fluidité de près, filtres, suites de T37
 * (docs/backlog/T37b-3d-telephone-suites.md, Q36). Complète ./contrat-travaux.ts (T37) et
 * ./contrat-recolte.ts (T32e), qui ne changent pas. Types et constantes seulement : les tests
 * chargent les modules par import dynamique (chemin tenu dans une variable).
 *
 * ── 1. Un seul maillage pour les poteaux, les tuteurs, les fruits et les balises ───────────────
 *
 * Depuis T32e, tuteurs, fruits et balises partagent UN InstancedMesh (une double pyramide de 1 m).
 * T37b y ajoute les poteaux (pieds de gouttière, pergola du kiwi) : « deux boîtes d'un mètre qui
 * ne diffèrent que par l'échelle et la couleur d'instance ». Dans la scène que dessine
 * `<Plants>` (Plants.tsx), le nombre d'InstancedMesh est donc :
 *     (nombre de formes de plants présentes) + 1
 * (un par forme présente, plus UN maillage d'accessoires), jamais + 2. Ce maillage porte tous les
 * accessoires, sans recouvrement de rangs : son `count` = tuteurs + poteaux + fruits + balises.
 * Les poteaux restent comptés par `nbPoteaux` (kiwi : un par plant ; gouttière : `piedsDeGouttiere`).
 * Le test lit la scène three de fiber (createRoot, rendu à la demande) : aucun WebGL.
 *
 * ── 2. Enveloppe de triangles (plants-rendu.ts, plants.ts) ─────────────────────────────────────
 *
 * Au lieu du seul plafond PLANTS_MAX_TOTAL (180 plants), `RenduPlants.choisirDetail` tient une
 * ENVELOPPE DE TRIANGLES pour les plants en détail : somme, sur les planches choisies, de
 * `nombre × TRIANGLES_PAR_FORME[forme]`. Les planches les plus proches de la caméra passent
 * d'abord ; une planche qui ne tient plus dans le reste de l'enveloppe n'est pas dessinée en détail
 * (elle reste une masse). Constantes nommées, EXPORTÉES de ./plants.ts :
 *     ENVELOPPE_TRIANGLES_PLANTS         écran large (ordinateur, ≥ LARGEUR_ECRAN_ETROIT_PX)
 *     ENVELOPPE_TRIANGLES_PLANTS_ETROIT  écran étroit (téléphone), strictement plus basse
 *     LARGEUR_ECRAN_ETROIT_PX            en dessous de cette largeur de toile (px), l'écran est étroit
 * `choisirDetail(scene, plants, x, y, z, hauteurPx, largeurPx?)` : 7e paramètre optionnel, la
 * largeur de la toile en px ; absent, l'écran est large. Valeurs : voir BORNES_ENVELOPPE ci-dessous
 * (le test n'impose que des bornes, le développeur mesure les valeurs). PLANTS_MAX_TOTAL reste
 * exporté (les tests existants le lisent) et reste un plafond du nombre de plants.
 *
 * ── 3. Bouton « Filtres » au téléphone (Vue3d.tsx, e2e) ────────────────────────────────────────
 *
 * Sous 1024 px de large, le panneau `panneau-3d` (légende, filtres T27b, zones, cultures, liste des
 * planches `liste-3d`) est replié derrière un bouton « Filtres » (data-testid `filtres-bouton-3d`,
 * nom accessible « Filtres », aria-expanded, aria-controls = id du panneau, zone tactile ≥ 48 px).
 * Replié : le panneau n'est pas visible (hidden), mais la liste des planches reste dans le DOM
 * (l'alternative texte de la toile). Ouvert par un tap : légende, filtres et liste des planches
 * sont visibles. RIEN n'est retiré : mêmes cases, mêmes boutons, mêmes planches qu'au bureau.
 * Sur ordinateur (≥ 1024 px) : le panneau est affiché sans bouton « Filtres ».
 *
 * ── 4. Mêmes travaux que l'écran Aujourd'hui ───────────────────────────────────────────────────
 *
 * `lireTachesDuJour(porte, fermeId, aujourdhui, maintenant?)` (plan3d/travaux.ts) rend les tâches
 * telles que l'écran Aujourd'hui les DESSINE à l'ouverture, dans le même ordre et avec les mêmes
 * numéros :
 *   - les tâches cochées (« Marquer fait ») dont l'écriture est en attente ou dont la journée
 *     affichée ne les a pas encore relues sont MASQUÉES à l'écran (cache.ts : masquesDe,
 *     estMasquee) : elles disparaissent aussi de la 3D, au même instant ;
 *   - les 25 premières tâches de chaque groupe (en retard, puis la semaine) que l'écran montre
 *     avant « Voir les autres » gardent le même rang à l'écran et dans la 3D : le rang d'une tâche
 *     dessinée est sa position (à partir de 1) parmi les cartes de l'écran. Le développeur choisit
 *     si la 3D s'arrête là ou ajoute les tâches cachées derrière (rangs suivants) : le test n'impose
 *     que l'identité des rangs des cartes dessinées.
 * La vue relit les travaux quand les masques changent (suivreMasques) et quand le plan change.
 *
 * ── 5. Panneau des travaux : annonce et erreur (PanneauTravaux.tsx) ────────────────────────────
 *
 * `PanneauTravaux3d` gagne une propriété `erreur?: boolean` (vrai : la lecture des travaux a
 * échoué). Et il porte une zone d'annonce (data-testid `travail-annonce-3d`) :
 *   - `aria-live="polite"`, présente dès le premier rendu (une zone vivante insérée avec son texte
 *     n'est pas annoncée), dans le panneau, visible même replié ;
 *   - son texte est vide tant que `actif` est null ; sinon il contient le `texte` du travail actif
 *     (« 2. Repiquer salades — Tunnel 2, T2-P04 »), éventuellement précédé ou suivi d'une position
 *     (« 1 sur 3 ») : le test ne lit que la présence du `texte` ;
 *   - elle change quand « Suivant » change le travail actif.
 * Erreur : `erreur` vrai → un message `role="alert"` (data-testid `travaux-erreur-3d`) au texte
 * TEXTE_ERREUR_TRAVAUX ; il est affiché même sans travaux (le panneau, sinon vide, ne se tait
 * plus) ; `erreur` faux ou absent : aucun message. Dans la vue, `data-travaux-erreur="oui"` sur
 * la toile quand la lecture échoue ('non' sinon).
 *
 * ── 6. Pastilles (travaux.ts, Pastilles.tsx) ───────────────────────────────────────────────────
 *
 * Une tâche sur plusieurs planches placées → une pastille sur CHACUNE (au lieu de la première
 * seulement) : le numéro de la tâche figure dans `numeros` de chaque planche. `Travail3d.planche`
 * reste la première planche placée (le vol de la caméra y va). `Pastille3d` et `data-pastilles`
 * ne changent pas de forme. `placerPastilles(couche, camera, largeur, hauteur, pastilles)`
 * n'écrit AUCUN style quand ni la caméra ni la taille de la toile n'ont changé depuis son dernier
 * appel pour les mêmes pastilles (ni visibility, ni transform) : la mise en page n'est pas
 * relancée à chaque image. Dès que la caméra bouge, les styles sont réécrits.
 *
 * ── 7. Démo, donnée d'origine ──────────────────────────────────────────────────────────────────
 *
 * Les fraises de la démo sont en retard de DIX jours (`apps/web/src/demo/remplir.ts`), comme avant
 * T37. L'e2e `vue-3d-fraises-pres.e2e.ts` suppose cette donnée (il la vérifie avant de mesurer),
 * va par « Suivant » jusqu'à la gouttière de fraises, vue de près, et tient BORNES_DEMO.
 */

/** Phrase du panneau quand la lecture des travaux échoue. */
export const TEXTE_ERREUR_TRAVAUX = 'Impossible de lire les travaux du jour';

export const TESTID_TELEPHONE = {
  annonce: 'travail-annonce-3d',
  erreur: 'travaux-erreur-3d',
  filtres: 'filtres-bouton-3d',
  panneauFiltres: 'panneau-3d',
  legende: 'legende-3d',
  liste: 'liste-3d',
  elementListe: 'element-liste-3d',
} as const;

/** Bornes que le test impose aux constantes de l'enveloppe (le développeur mesure la valeur exacte). */
export const BORNES_ENVELOPPE = {
  /** Écran large : au plus la ferme T07 permet (14 000 triangles de bornes, 4 300 pour le reste de la scène). */
  largeMax: 9_600,
  /** La toile d'un téléphone (Pixel 7 : 412 px) est étroite ; un ordinateur (1024 px) ne l'est pas. */
  seuilEtroitMin: 413,
  seuilEtroitMax: 1_023,
} as const;

/** Ce que plants.ts exporte de plus (T37b). */
export interface ModuleEnveloppe {
  readonly ENVELOPPE_TRIANGLES_PLANTS: number;
  readonly ENVELOPPE_TRIANGLES_PLANTS_ETROIT: number;
  readonly LARGEUR_ECRAN_ETROIT_PX: number;
}

/** Hauteur minimale d'une zone tactile (px). */
export const HAUTEUR_TACTILE_MIN_PX = 48;
