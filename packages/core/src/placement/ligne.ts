/**
 * Placement d'une ligne (T28a, Q31) : emplacement dans sa zone, emprise d'un bâtiment, contour
 * d'une zone, colonnes snake_case telles que le téléphone les envoie. Règles rejouées par le
 * serveur (T28s). Séparé de ./validation.ts (contours) pour que l'éditeur de placement, qui ne
 * valide que des contours, ne charge pas ce code (budget de son morceau, T61).
 *
 * Pures, sans exception quelle que soit l'entrée ; messages en français.
 */
import {
  estNombre,
  orientationValide,
  PLAFONDS_BATIMENT,
  refus,
  tropLoin,
  TYPES_BATIMENT,
  validerContour,
  type EntreePlacementBatiment,
  type EntreePlacementEmplacement,
  type EntreePlacementZone,
  type PlacementBatiment,
  type PlacementEmplacement,
  type PlacementZone,
  type ResultatPlacement,
} from './validation.ts';

// ── Placement d'une ligne ────────────────────────────────────────────────────────────────────

const estNul = (v: unknown): boolean => v === null || v === undefined;

const LIBELLES: Readonly<Record<string, string>> = {
  placement_x_m: 'la position est-ouest',
  placement_y_m: 'la position nord-sud',
  orientation_deg: 'l’orientation',
  longueur_m: 'la longueur',
  largeur_m: 'la largeur',
  hauteur_m: 'la hauteur',
  centre_x_m: 'la position est-ouest du centre',
  centre_y_m: 'la position nord-sud du centre',
};
const libelle = (c: string): string => LIBELLES[c] ?? c;

const COLONNES_EMPLACEMENT = ['placement_x_m', 'placement_y_m', 'orientation_deg'] as const;

function validerEmplacement(ligne: Readonly<Record<string, unknown>>): ResultatPlacement<PlacementEmplacement> {
  const x = ligne.placement_x_m;
  const y = ligne.placement_y_m;
  const o = ligne.orientation_deg;
  const nuls = COLONNES_EMPLACEMENT.filter((c) => estNul(ligne[c]));
  if (nuls.length === COLONNES_EMPLACEMENT.length) {
    return { ok: true, valeur: { placement_x_m: null, placement_y_m: null, orientation_deg: null } };
  }
  const premierNul = nuls[0];
  if (premierNul !== undefined) {
    return refus('incomplet', premierNul, `Placement incomplet : il manque ${libelle(premierNul)}.`);
  }
  if (!estNombre(x)) return refus('coordonnee_invalide', 'placement_x_m', 'La position est-ouest doit être un nombre de mètres.');
  if (!estNombre(y)) return refus('coordonnee_invalide', 'placement_y_m', 'La position nord-sud doit être un nombre de mètres.');
  if (!orientationValide(o)) return refus('orientation_invalide', 'orientation_deg', 'L’orientation doit être comprise entre 0 et 360 degrés (360 exclu).');
  if (tropLoin(x, y)) return refus('trop_loin', 'placement_x_m', 'L’emplacement est à plus de 5 km du centre de sa zone.');
  return { ok: true, valeur: { placement_x_m: x, placement_y_m: y, orientation_deg: o } };
}

const DIMENSIONS = { longueur_m: 'La longueur', largeur_m: 'La largeur', hauteur_m: 'La hauteur' } as const;

const COLONNES_BATIMENT = ['longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg'] as const;

function validerBatiment(ligne: Readonly<Record<string, unknown>>): ResultatPlacement<PlacementBatiment> {
  // T61 : un type donné est l'une des sortes connues (absent : la ligne ne porte que le placement).
  const type = ligne.type;
  if (!estNul(type) && !(TYPES_BATIMENT as readonly unknown[]).includes(type)) {
    return refus('entree_invalide', 'type', 'Type de bâtiment inconnu.');
  }
  const manquante = COLONNES_BATIMENT.find((c) => estNul(ligne[c]));
  if (manquante !== undefined) {
    return refus('incomplet', manquante, `Un bâtiment est toujours placé : il manque ${libelle(manquante)}.`);
  }
  const cx = ligne.centre_x_m;
  const cy = ligne.centre_y_m;
  if (!estNombre(cx)) return refus('coordonnee_invalide', 'centre_x_m', 'La position est-ouest du centre doit être un nombre de mètres.');
  if (!estNombre(cy)) return refus('coordonnee_invalide', 'centre_y_m', 'La position nord-sud du centre doit être un nombre de mètres.');
  const dimensions = [
    ['longueur_m', PLAFONDS_BATIMENT.longueurM],
    ['largeur_m', PLAFONDS_BATIMENT.largeurM],
    ['hauteur_m', PLAFONDS_BATIMENT.hauteurM],
  ] as const;
  const valeurs: number[] = [];
  for (const [c] of dimensions) {
    const v = ligne[c];
    if (!estNombre(v) || v <= 0) {
      return refus('dimension_invalide', c, `${DIMENSIONS[c]} doit être un nombre de mètres plus grand que zéro.`);
    }
    valeurs.push(v);
  }
  for (let i = 0; i < dimensions.length; i++) {
    const d = dimensions[i];
    const v = valeurs[i];
    if (d !== undefined && v !== undefined && v > d[1]) {
      return refus('plafond_depasse', d[0], `${DIMENSIONS[d[0]]} dépasse ${String(d[1])} m.`);
    }
  }
  const o = ligne.orientation_deg;
  if (!orientationValide(o)) return refus('orientation_invalide', 'orientation_deg', 'L’orientation doit être comprise entre 0 et 360 degrés (360 exclu).');
  if (tropLoin(cx, cy)) return refus('trop_loin', 'centre_x_m', 'Le bâtiment est à plus de 5 km de l’origine du plan.');
  const [longueur, largeur, hauteur] = valeurs;
  if (longueur === undefined || largeur === undefined || hauteur === undefined) {
    return refus('dimension_invalide', 'longueur_m', 'Les dimensions du bâtiment sont illisibles.');
  }
  return {
    ok: true,
    valeur: { longueur_m: longueur, largeur_m: largeur, hauteur_m: hauteur, centre_x_m: cx, centre_y_m: cy, orientation_deg: o },
  };
}

function validerZone(ligne: Readonly<Record<string, unknown>>, abritee: boolean): ResultatPlacement<PlacementZone> {
  let contour: unknown = ligne.contour;
  if (estNul(contour)) return { ok: true, valeur: { contour: null } };
  if (abritee) {
    return refus(
      'zone_abritee_avec_contour',
      'contour',
      'Cette zone est abritée par un bâtiment : sa forme est celle du bâtiment, elle n’a pas de contour à elle.',
    );
  }
  if (typeof contour === 'string') {
    try {
      contour = JSON.parse(contour);
    } catch {
      return refus('entree_invalide', 'contour', 'Le contour est illisible.');
    }
  }
  const r = validerContour(contour);
  if (!r.ok) return refus(r.erreur.code, 'contour', r.erreur.message);
  return { ok: true, valeur: { contour: r.valeur } };
}

/**
 * Placement d'une ligne (colonnes snake_case telles que le téléphone les envoie) ; `champ` de
 * l'erreur = nom de la colonne. Voir docs/modele-donnees.md, v1.x.
 */
export function validerPlacement(entree: EntreePlacementEmplacement): ResultatPlacement<PlacementEmplacement>;
export function validerPlacement(entree: EntreePlacementBatiment): ResultatPlacement<PlacementBatiment>;
export function validerPlacement(entree: EntreePlacementZone): ResultatPlacement<PlacementZone>;
export function validerPlacement(
  entree: EntreePlacementEmplacement | EntreePlacementBatiment | EntreePlacementZone,
): ResultatPlacement<PlacementEmplacement | PlacementBatiment | PlacementZone> {
  try {
    switch (entree.table) {
      case 'emplacement':
        return validerEmplacement(entree.ligne);
      case 'batiment':
        return validerBatiment(entree.ligne);
      case 'zone':
        return validerZone(entree.ligne, entree.abritee);
    }
    return refus('entree_invalide', null, 'Table inconnue pour un placement.');
  } catch {
    // Ligne hostile (accesseur qui lève…) : refusée, jamais d'exception.
    return refus('entree_invalide', null, 'La ligne est illisible.');
  }
}
