/**
 * Constantes de l'import (T14b), partagées par l'écran, l'historique et le moteur sans que l'écran
 * charge le moteur (il tourne dans le Web Worker).
 */
import type { CategorieEspece, UniteRecolte } from '@planif/core';

/** Nombre de valeurs distinctes (espèces + familles) au-delà duquel on ne rapproche plus (relecture de T14c). */
export const PLAFOND_VALEURS_A_RAPPROCHER = 2_000;

/** Ordre d'annulation : ce qui se rapporte à une ligne avant elle (le serveur refuse de supprimer ce qui sert encore). */
export const ORDRE_ANNULATION = ['assolement', 'occupation', 'serie', 'itineraire', 'variete', 'espece', 'famille', 'emplacement', 'zone', 'saison'] as const;

const nombre = new Intl.NumberFormat('fr-FR');

/** « 2 001 » : nombre écrit à la française (espace fine insécable). */
export const enFrancais = (n: number): string => nombre.format(n);

/** Catégories d'une culture créée (liste fermée du schéma, packages/db). */
export const CATEGORIES_CULTURE = [
  { valeur: 'legume', libelle: 'Légume' },
  { valeur: 'petit_fruit', libelle: 'Petit fruit' },
  { valeur: 'fruit', libelle: 'Fruit' },
  { valeur: 'fleur', libelle: 'Fleur' },
  { valeur: 'aromatique', libelle: 'Aromatique' },
  { valeur: 'engrais_vert', libelle: 'Engrais vert' },
] as const satisfies readonly { readonly valeur: CategorieEspece; readonly libelle: string }[];

/** Unités de récolte d'une culture créée (liste fermée du schéma). */
export const UNITES_CULTURE = [
  { valeur: 'kg', libelle: 'Kilo (kg)' },
  { valeur: 'botte', libelle: 'Botte' },
  { valeur: 'piece', libelle: 'Pièce' },
  { valeur: 'barquette', libelle: 'Barquette' },
] as const satisfies readonly { readonly valeur: UniteRecolte; readonly libelle: string }[];
