/**
 * Vue 3D (T55, règle 3) — les traitements phyto du jour, ajoutés aux travaux numérotés
 * (./travaux.ts). Chargé à la demande par ./travaux.ts : les chaînes en vigueur se jugent par le
 * cœur (`enVigueurDesTraitements`), dont le morceau ne s'ajoute ainsi ni au morceau 3D ni à la
 * liste de ce que la vue précharge avec ses travaux (budget `jsVue3dGzKio`).
 */
import { ajouterJours, DAR_MAX_JOURS, enVigueurDesTraitements, type DateCalendaire } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Un traitement phyto du jour, travail numéroté de la 3D. */
export interface TraitementDuJour3d {
  /** « traitement:<id de l'événement> ». */
  readonly cle: string;
  readonly traitement: {
    readonly id: string;
    /** Nom commercial du produit (« produit inconnu » à défaut). */
    readonly produit: string;
    readonly emplacementIds: readonly string[];
  };
}

/**
 * Les traitements en vigueur datés du `aujourdhui` (prévus pour aujourd'hui ou déjà faits : un
 * traitement est un événement du journal), dans l'ordre de leur saisie. Lus par ../aujourdhui/dar.ts,
 * la lecture de l'écran Aujourd'hui.
 */
export async function lireTraitementsDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<TraitementDuJour3d[]> {
  // Par import dynamique, comme l'écran : un module à la fois importé et chargé à la demande
  // ajoutait au démarrage l'assistant des objets d'espace de noms.
  const { lireTraitements } = await import('../aujourdhui/dar.ts');
  // `lireTraitements` lit depuis DAR_MAX_JOURS + 1 jours avant la date donnée (plus les corrections
  // et annulations plus anciennes) : décalée d'autant, la lecture part d'aujourd'hui, sans parcourir
  // l'année de traitements d'une grande ferme pendant que la 3D lit ses travaux.
  const lus = await lireTraitements(porte, fermeId, ajouterJours(aujourdhui as DateCalendaire, DAR_MAX_JOURS + 1));
  return enVigueurDesTraitements(lus.traitements)
    .filter((t) => t.date === aujourdhui)
    .sort((a, b) => (a.horodatage !== b.horodatage ? (a.horodatage < b.horodatage ? -1 : 1) : a.id < b.id ? -1 : 1))
    .map((t) => ({ cle: `traitement:${t.id}`, traitement: { id: t.id, produit: lus.noms.get(t.produitPhytoId) ?? 'produit inconnu', emplacementIds: t.emplacementIds } }));
}
