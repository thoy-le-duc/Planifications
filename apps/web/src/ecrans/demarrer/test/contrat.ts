/**
 * Contrat de T49 — parcours guidé « Démarrer votre ferme » et états vides
 * (docs/backlog/T49-demarrer-sa-ferme.md, règles 4 et 5).
 *
 * ## Modules attendus
 *
 * - `../etapes.ts` (pur, sans React) : `etapesDemarrage`, et la demande de navigation entre
 *   écrans (`demander`, `prendreDemande`) : l'écran qui guide note où aller, puis change d'onglet
 *   (`surOnglet`, donné par App) ; l'écran d'arrivée prend la demande à son ouverture (une fois).
 * - `../BandeauDemarrer.tsx` : `BandeauDemarrer` (région « Démarrer votre ferme »,
 *   data-testid="demarrer-ferme"), lu par la porte et tenu à jour (requête surveillée).
 *
 * ## Étapes (dans l'ordre)
 *
 * 1. `saison` : une saison non supprimée → cible 'saisons'
 * 2. `planches` : un emplacement non supprimé, en service → cible 'zones'
 * 3. `itineraires` : un itinéraire non supprimé DE LA FERME → cible 'itineraires'
 * 4. `serie` : une série non supprimée → cible 'serie'
 * Le bandeau est visible tant qu'il n'y a aucune série. Chaque étape est un bouton
 * [data-testid="etape-demarrage"][data-etape=<clé>][data-faite="oui"|"non"] qui appelle
 * `surAller(<cible>)` ; « Importer un tableur » appelle `surAller('import')`.
 *
 * ## Écrans
 *
 * Aujourd'hui et Planches reçoivent `surOnglet` (App) ; sans lui, ni bandeau ni bouton des
 * états vides (comme avant T49). Avec lui :
 * - Planches sans saison : « Aucune saison… » et bouton « Créer la saison » (→ 'saisons') ;
 *   avec saison, sans planche : « Aucune planche… » et « Ajouter des planches » (→ 'zones').
 *   L'étape 4 (ou une demande 'serie' prise à l'ouverture) ouvre le formulaire « Nouvelle série ».
 * - Aujourd'hui sans série : « Aucune série… » et un bouton vers la prochaine étape à faire
 *   (« Créer la saison », « Ajouter des planches » ou « Planifier une série »).
 * - Ferme : une demande 'saisons' ou 'zones' ouvre « Ma ferme », 'itineraires' « Mes
 *   itinéraires », 'import' « Importer un tableur ».
 */
import type { ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';

export type CibleDemarrage = 'saisons' | 'zones' | 'itineraires' | 'serie' | 'import';
export type CleEtape = 'saison' | 'planches' | 'itineraires' | 'serie';

export interface ComptesDemarrage {
  readonly saisons: number;
  readonly planches: number;
  readonly itineraires: number;
  readonly series: number;
}

export interface EtapeDemarrage {
  readonly cle: CleEtape;
  readonly cible: CibleDemarrage;
  readonly faite: boolean;
  readonly titre: string;
}

export interface EtatDemarrage {
  readonly etapes: readonly EtapeDemarrage[];
  readonly visible: boolean;
  /** Première étape pas faite, ou null. */
  readonly prochaine: EtapeDemarrage | null;
}

export interface ModuleEtapes {
  etapesDemarrage(c: ComptesDemarrage): EtatDemarrage;
  demander(c: CibleDemarrage): void;
  /** Prend la demande en attente si c'est l'une de `cibles` (elle est alors oubliée), sinon null. */
  prendreDemande(...cibles: readonly CibleDemarrage[]): CibleDemarrage | null;
}

export interface ModuleBandeau {
  readonly BandeauDemarrer: (p: { readonly porte: PorteDonnees; readonly fermeId: string; readonly surAller: (c: CibleDemarrage) => void }) => ReactElement | null;
}
