/**
 * Contrat de T32e — la récolte se voit dans la vue 3D (docs/backlog/T32e-recolte-visible.md ;
 * Q34, Q35). Complète les contrats de T32b/T32d (plants.test.ts, plants-rendu.test.ts,
 * plants-fins.test.ts), qui ne changent pas. Le calcul de l'état de récolte est dans le cœur
 * (packages/core/src/croissance/test/contrat-recolte.ts) : ici, l'adaptateur et le rendu.
 *
 * ── ./plants.ts (adaptateur pur) ─────────────────────────────────────────────────────────────
 *
 *   FRUITS_MAX_PAR_PLANT: number     entier dans [1, 8]
 *   FRUITS_MAX_TOTAL: number         entier dans [PLANTS_MAX_TOTAL, 1000] : plafond des fruits dessinés pour toute la scène
 *   PlantsPlanche gagne, calculés par le cœur (recolteA / recoltePerenneA, jamais ici) :
 *     recolte: EtatRecolte                    = recolteA(dates, jour) (annuelle) ou recoltePerenneA(entree, jour) (pérenne)
 *     typeFruit: TypeFruit                    'allonge' | 'rond' | 'generique' (typeDeFruit(espece), ./recolte.ts)
 *     fruitsParPlant: number                  0 hors 'fruits-en-formation' et 'a-recolter' ; sinon entier dans [1, FRUITS_MAX_PAR_PLANT]
 *     tailleFruitM: number                    0 sans fruit ; sinon > 0, STRICTEMENT croissante avec la maturité
 *                                              (la longueur du plus grand axe du fruit, m), au plus TAILLE_FRUIT_MAX_M (0,3 m)
 *     jaunissement: number                    dans [0, 1] : 0 hors 'fin-de-recolte', > 0 en 'fin-de-recolte', ne décroît pas ensuite
 *   (plantsDePlanche rend toujours null après l'arrachage : T32b, inchangé.)
 *
 * ── ./recolte.ts (nouveau module, pur : ni React, ni three) ──────────────────────────────────
 *
 *   typeDeFruit(espece: string): TypeFruit
 *       Courgette → 'allonge' ; Tomate, Fraise, Fraisier → 'rond' ; toute autre espèce → 'generique'
 *       (casse et accents ignorés : « courgette » = « Courgette »).
 *   planchesARecolter(plants: readonly (PlantsPlanche | null)[], filtree: SceneFiltree): readonly string[]
 *       ids des planches dont la phase est 'a-recolter' ET qui ne sont pas estompées par les filtres
 *       T27b (`filtree.volumes[i].estompe`), dans l'ordre de la scène ; les null sont ignorés.
 *   phrasePlanchesARecolter(n: number): string
 *       0 → « Aucune planche à récolter » ; 1 → « 1 planche à récolter » ; n ≥ 2 → « n planches à récolter ».
 *
 * ── ./plants-rendu.ts (RenduPlants) ──────────────────────────────────────────────────────────
 *
 *   lierFruits(m: InstancedMesh | null): void      UN SEUL InstancedMesh pour tous les fruits (garde-fous T29b : un seul appel de dessin de plus)
 *   lierBalises(m: InstancedMesh | null): void     UN SEUL InstancedMesh pour toutes les balises
 *   geometrieFruit(): BufferGeometry               partagée (le même objet à chaque appel), attribut `color`, ≤ 80 triangles,
 *                                                  plus grand sens = 1 m (l'échelle de l'instance donne la taille en m)
 *   geometrieBalise(): BufferGeometry              partagée (le même objet à chaque appel), attribut `color`, ≤ 80 triangles
 *   BilanPlants gagne : fruits: number (instances de fruit posées), balises: number (instances de balise posées)
 *   poser(scene, filtree, plants) :
 *     Fruits (planches EN DÉTAIL seulement, comme les plants ; de loin le compte tombe à 0) :
 *       - une planche en 'fruits-en-formation' ou 'a-recolter' pose, par plant, fruitsParPlant fruits ; jamais pour
 *         'aucune' ni 'fin-de-recolte' ; jamais plus de FRUITS_MAX_TOTAL pour la scène (mesh.count = bilan.fruits) ;
 *       - chaque fruit est dans le rectangle de sa planche, posé entre la dalle (hauteurDalle + surélévation) et le haut du plant ;
 *       - taille d'une instance = plus grand axe de son échelle = tailleFruitM de sa planche ; elle grandit avec la maturité ;
 *       - forme : 'allonge' → plus grand axe ≥ 2 × plus petit ; 'rond' → plus grand axe ≤ 1,3 × plus petit ;
 *       - couleur d'instance : une couleur « en formation » et une couleur « mûre » à 'a-recolter' (jetons de src/ui/jetons.ts
 *         attendus : COULEUR_FRUIT_VERT_3D, COULEUR_COURGETTE_MURE_3D, COULEUR_TOMATE_MURE_3D, COULEUR_FRAISE_MURE_3D,
 *         COULEUR_FRUIT_GENERIQUE_MUR_3D), distinctes entre elles et du feuillage ; planche estompée par un filtre : la couleur
 *         du filtre (comme le feuillage), sans couleur vive.
 *     Balises (TOUTES les planches 'a-recolter' non estompées, en détail ou non : visibles en vue d'ensemble, Q35) :
 *       - bilan.balises = mesh.count = planchesARecolter(plants, filtree).length ;
 *       - une par planche, au-dessus d'elle : centre dans l'emprise de la planche, y au-dessus de hauteurDeMasse(base, p) ;
 *       - lisible de loin : plus grand axe de l'échelle ≥ TAILLE_BALISE_MIN_M (0,5 m) ;
 *       - couleur vive (jeton COULEUR_BALISE_RECOLTE_3D), différente du feuillage et de COULEUR_ESTOMPEE ;
 *       - planche filtrée (T27b) : PAS de balise (estompée sans signal criard).
 *   Toujours tournée vers la caméra ou lisible sous tous les angles : non vérifiable sans WebGL, relu en revue
 *   (géométrie symétrique de révolution, ou orientation de la caméra à chaque image).
 *
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d-recolte.e2e.ts ─────────────────────────────────
 *
 *   toile-3d gagne : data-planches-a-recolter = planchesARecolter(...).length pour la semaine affichée (non estompées) ;
 *                    data-fruits = bilan.fruits ; data-balises = bilan.balises (= data-planches-a-recolter).
 *   element-liste-3d gagne : data-recolte = la phase ('aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte') ;
 *                    le texte d'une planche 'a-recolter' contient « à récolter ».
 *   resume-recolte-3d (nouveau data-testid, dans le panneau, visible) : le texte est EXACTEMENT
 *                    phrasePlanchesARecolter(data-planches-a-recolter) ; role="status" (annoncé quand la semaine change).
 *   Le nom accessible de la toile (aria-label) se termine par ou contient la même phrase.
 *   Garde-fous T29b : BORNES_DEMO (e2e/fluidite-3d.ts) NE CHANGE PAS ; si fruits et balises ne tiennent pas dans les
 *   appels de dessin, regrouper des géométries (poteaux, tuteurs, fruits en un seul maillage) plutôt que relever la borne.
 */
export type TypeFruit = 'allonge' | 'rond' | 'generique';

export const TESTID_3D_RECOLTE = {
  resume: 'resume-recolte-3d',
} as const;

/** Phases de récolte (le cœur les définit ; recopiées ici : le cœur n'existe pas encore, le typage ne doit pas en dépendre). */
export type PhaseRecolte3d = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte';

/** Plus petite balise lisible de loin (échelle du plus grand axe, m de scène). */
export const TAILLE_BALISE_MIN_M = 0.5;
/** Un fruit ne dépasse jamais cette longueur (m). */
export const TAILLE_FRUIT_MAX_M = 0.3;
