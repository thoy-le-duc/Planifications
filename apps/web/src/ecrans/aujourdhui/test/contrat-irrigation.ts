/**
 * Contrat de la saisie d'irrigation (T57, docs/backlog/T57-vannes-irrigation.md, règle 4) :
 * « Irrigation » (vanne, durée) depuis l'écran Aujourd'hui ou depuis le repère d'une vanne dans la
 * vue 3D, hors ligne. Fichier à part, chargé à la demande : `../SaisieIrrigation.tsx` (export
 * `SaisieIrrigation`). L'écran Aujourd'hui n'y ajoute qu'un point d'entrée : le bouton
 * « Irrigation » de sa barre d'actions.
 *
 * Dialogue modal `data-testid="saisie-irrigation"`, nommé « Irrigation » :
 *   - liste « Vanne » : les vannes non supprimées de la ferme, par numéro (texte = nom) ; la vanne
 *     donnée (`vanneId`) est choisie d'avance ;
 *   - champ « Durée (min) » (pavé numérique) et boutons rapides « 10 min », « 20 min », « 30 min »,
 *     « 1 h » qui le remplissent ;
 *   - « Enregistrer » : UN événement `irrigation` dans le journal du téléphone, en une transaction
 *     (date = jour du téléphone, source 'tap', sans culture ni emplacement, detail
 *     { secteurIrrigationId, dureeMinutes }), accepté par `validerSaisie` du cœur ; durée vide,
 *     nulle, non entière ou de plus de 24 h : message `role="alert"`, rien n'est écrit ;
 *   - une fois écrite : `data-testid="irrigation-enregistree"` (role="status") « Irrigation notée :
 *     V12, 20 min » avec « Annuler », qui écrit l'annulation (même type, même détail,
 *     remplace_sorte 'annulation') ; « Fermer » ferme le dialogue (`surFermer`).
 * Aucun réseau : tout part avec la synchro.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType } from 'react';

/** Relatif aux tests qui l'importent (aujourdhui/*.test.tsx), pas à ce fichier. */
export const CHEMIN_SAISIE_IRRIGATION = './SaisieIrrigation.tsx';

export interface ProprietesSaisieIrrigation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Vanne choisie d'avance (repère 3D), ou nulle. */
  readonly vanneId?: string | null;
  readonly surFermer: () => void;
  readonly aujourdhui?: () => string;
}

export interface ModuleSaisieIrrigation {
  readonly SaisieIrrigation: ComponentType<ProprietesSaisieIrrigation>;
}

export const TESTID_IRRIGATION = {
  saisie: 'saisie-irrigation',
  enregistree: 'irrigation-enregistree',
} as const;
