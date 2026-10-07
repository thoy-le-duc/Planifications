/**
 * Vue 3D (T27) — ce que l'écran Planches en connaît sans la charger : la marque du module,
 * le test de WebGL et l'import dynamique du morceau 3D. Aucun import de three ni de fiber ici :
 * ce fichier va avec l'écran Planches, la 3D n'est téléchargée qu'au tap sur « Voir en 3D ».
 */

/**
 * Marque de performance : le morceau 3D est chargé et prêt (à chaque ouverture), lue par
 * e2e/vue-3d.e2e.ts. Les deux autres (« affichée », « semaine ») sont posées par la vue
 * (./Vue3d.tsx) : rien de ce fichier n'est importé par le morceau 3D, qui sinon ferait de l'écran
 * Planches un morceau à exports partagés (un objet d'espace de noms de plus au démarrage).
 */
export const MARQUE_MODULE_3D = 'planif:vue-3d-module';

/** Le morceau 3D (three, fiber), chargé à la demande seulement. */
export const chargerVue3d = () => import('./index.ts');

/**
 * WebGL utilisable sur cet appareil : un contexte se crée (puis est rendu aussitôt). Sans lui,
 * la 3D n'est pas téléchargée du tout et l'écran reste en 2D, avec un message.
 */
export function webglDisponible(): boolean {
  try {
    const toile = document.createElement('canvas');
    const contexte = toile.getContext('webgl2') ?? toile.getContext('webgl');
    if (contexte === null) return false;
    contexte.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
