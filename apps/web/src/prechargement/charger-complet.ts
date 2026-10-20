/**
 * T66 — chargement de l'aide de préchargement complète (./complet.ts, son propre morceau), une
 * fois ; nouvel essai après un échec. Module à part de ./aide.ts : Vite enveloppe aussi cet
 * `import()` dans l'aide de préchargement, qu'il ne peut pas déclarer dans son propre module.
 * Sans dépendance, l'import part tel quel.
 *
 * L'aide complète a son morceau, et non celui de l'aiguillage : les pages de mesure et de
 * diagnostic s'en servent aussi, sans rien atteindre des écrans de l'appli (ni du service worker).
 */
import type { precharger } from './complet.ts';

let enCours: Promise<typeof precharger> | null = null;

export function chargerComplet(): Promise<typeof precharger> {
  return (enCours ??= import('./complet.ts').then(
    (m) => m.precharger,
    (erreur: unknown) => {
      enCours = null;
      throw erreur;
    },
  ));
}
