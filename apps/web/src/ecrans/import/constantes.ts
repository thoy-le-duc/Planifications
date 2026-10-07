/**
 * Constantes de l'import (T14b), partagées par l'écran, l'historique et le moteur sans que l'écran
 * charge le moteur (il tourne dans le Web Worker).
 */

/** Nombre de valeurs distinctes (espèces + familles) au-delà duquel on ne rapproche plus (relecture de T14c). */
export const PLAFOND_VALEURS_A_RAPPROCHER = 2_000;

/** Ordre d'annulation : ce qui se rapporte à une ligne avant elle (le serveur refuse de supprimer ce qui sert encore). */
export const ORDRE_ANNULATION = ['assolement', 'occupation', 'serie', 'itineraire', 'variete', 'espece', 'famille', 'emplacement', 'zone', 'saison'] as const;

const nombre = new Intl.NumberFormat('fr-FR');

/** « 2 001 » : nombre écrit à la française (espace fine insécable). */
export const enFrancais = (n: number): string => nombre.format(n);
