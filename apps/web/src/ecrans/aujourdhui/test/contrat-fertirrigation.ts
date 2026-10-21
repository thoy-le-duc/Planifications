/**
 * Contrat de la saisie de fertirrigation (T56, docs/backlog/T56-fertirrigation.md, règles 2 et 4) :
 * la saisie d'irrigation de T57 (`../SaisieIrrigation.tsx`, chargée à la demande) porte aussi une
 * recette. L'écran Aujourd'hui y ajoute un second point d'entrée, le bouton « Fertirrigation », à
 * côté d'« Irrigation ».
 *
 * Propriété `fertirrigation` (défaut faux) : le dialogue s'appelle « Fertirrigation » et la
 * première recette non archivée (par nom) est choisie d'avance ; sinon « Irrigation », recette
 * « Sans engrais » d'avance (T57 inchangé).
 *
 *   - liste « Recette » : « Sans engrais », puis les recettes non archivées de la ferme par nom ;
 *   - recette choisie : champ « Volume (m³) » (virgule acceptée). Vide : volume = durée × débit de
 *     la vanne (`volumeIrrigationM3`) ; vanne sans débit et volume vide : message role="alert",
 *     rien d'écrit. Champs « EC mesurée » et « pH mesuré » facultatifs ;
 *   - « Enregistrer » : UN événement irrigation en une transaction, detail =
 *     `detailFertirrigation` du cœur (doses figées), accepté par `validerSaisie` ; statut
 *     « Fertirrigation notée : V12, Fraise floraison, 20 min » avec « Annuler ».
 *   - Trois taps au champ : « Fertirrigation », « 20 min », « Enregistrer » (vanne et recette
 *     choisies d'avance).
 *   - « Recopier la veille » : un bouton par irrigation EN VIGUEUR de la veille (ni annulée, ni
 *     annulation), nommé « Recopier : V12, Fraise floraison, 20 min » (« Recopier : V13, 20 min »
 *     sans recette) ; un tap écrit, en une transaction, la même irrigation (même détail) au jour
 *     du téléphone, annulable comme une saisie.
 * Aucun réseau : tout part avec la synchro.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType } from 'react';

export const CHEMIN_SAISIE_IRRIGATION = './SaisieIrrigation.tsx';

export interface ProprietesSaisieFertirrigation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly vanneId?: string | null;
  readonly surFermer: () => void;
  readonly aujourdhui?: () => string;
  readonly fertirrigation?: boolean;
}

export interface ModuleSaisieFertirrigation {
  readonly SaisieIrrigation: ComponentType<ProprietesSaisieFertirrigation>;
}
