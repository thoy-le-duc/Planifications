/**
 * Contrat de T32f — suites de la récolte visible (docs/backlog/T32f-recolte-suites.md ; Q38 : « balise
 * pâle jusqu'au bout »). Complète test/contrat-recolte.ts (T32e), dont ce qui suit RÉVISE trois points ;
 * le reste de T32e ne change pas (BORNES_DEMO inchangé, un seul maillage de fruits, un seul de balises).
 * Le calcul des phases est dans le cœur (packages/core/src/croissance/test/contrat-recolte.ts et
 * recolte-suites.test.ts) : ici, l'adaptateur, le rendu et la liste.
 *
 * ── Ce que T32f révise de T32e ───────────────────────────────────────────────────────────────
 *
 *   1. Balise (Q38). Une planche porte une balise en phase 'a-recolter' ET en phase 'fin-de-recolte'
 *      (tant que la plante est en place : après l'arrachage `plantsDePlanche` rend null, donc plus de
 *      balise), si les filtres T27b ne l'estompent pas. `aBalise` et `planchesARecolter` (./recolte.ts)
 *      suivent : `planchesARecolter` rend les ids des planches 'a-recolter' ou 'fin-de-recolte', non
 *      estompées, dans l'ordre de la scène. Donc :
 *        bilan.balises = mesh.count = planchesARecolter(plants, filtree).length ;
 *        data-planches-a-recolter = data-balises = ce même nombre ;
 *        « N planches à récolter » (phrasePlanchesARecolter, inchangée) compte les planches en fin de récolte.
 *   2. Couleur. La balise 'a-recolter' garde COULEUR_BALISE_RECOLTE_3D ; la balise 'fin-de-recolte' prend
 *      un NOUVEAU jeton de src/ui/jetons.ts, COULEUR_BALISE_FIN_RECOLTE_3D : plus pâle (moins saturée ou
 *      plus claire en HSL que la balise vive), différente de la balise vive, du feuillage, de
 *      COULEUR_ESTOMPEE et de la couleur mûre de chaque fruit. Taille, position et nombre de triangles
 *      de la balise ne changent pas ; fruits : toujours aucun en fin de récolte (T32e).
 *   3. Liste. La ligne d'une planche en fin de récolte dit « dernières récoltes » (au lieu de « fin de
 *      récolte »), data-recolte="fin-de-recolte" inchangé. La phrase de la mention vient de
 *      mentionRecolte (./recolte.ts) :
 *        mentionRecolte(phase: PhaseRecolte3d): string | null
 *          'fruits-en-formation' → 'récolte proche' ; 'a-recolter' → 'à récolter' ;
 *          'fin-de-recolte' → 'dernières récoltes' ; 'aucune' → null.
 *
 * ── Pérennes (adaptateur ./donnees-plants.ts) ────────────────────────────────────────────────
 *
 *   La culture d'une pérenne à une date (cultureAu) donne au cœur la campagne qui contient le jour, ou
 *   celle qui commence dans les 28 jours, quelle que soit son année de rattachement : on ne cherche plus
 *   « la campagne de l'année du jour ». Les tests passent par construireCultures → cultureAu →
 *   plantsDePlanche (la forme interne de `CultureDePlanche` peut changer) et lisent `recolte.phase`.
 *
 * ── Vue 3D (DOM) et e2e ──────────────────────────────────────────────────────────────────────
 *
 *   Aucun attribut nouveau : data-planches-a-recolter, data-balises, data-fruits, resume-recolte-3d et
 *   data-recolte (T32e) ; la ligne « dernières récoltes » est lue dans le texte de element-liste-3d.
 *   e2e/vue-3d-recolte-ferme-t07.e2e.ts : grande ferme de T07, zoom serré en pleine récolte, BORNES_FERME_T07.
 */
export type PhaseRecolte3d = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte';

export interface ModuleRecolteSuites {
  mentionRecolte(phase: PhaseRecolte3d): string | null;
}

/** Jeton de couleur attendu dans src/ui/jetons.ts (hexadécimal #RRGGBB). */
export const JETON_BALISE_FIN_RECOLTE = 'COULEUR_BALISE_FIN_RECOLTE_3D';

export const MENTION_DERNIERES_RECOLTES = 'dernières récoltes';
