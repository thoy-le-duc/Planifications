/**
 * Contrat de l'écran « Vannes » (T57, docs/backlog/T57-vannes-irrigation.md, règle 1) : onglet
 * Ferme → « Saisons, zones et planches » → « Vannes ». Module `../vannes/index.ts`, chargé à la
 * demande depuis l'écran du parcellaire (bouton « Vannes »), qui reçoit la porte (ni PowerSync,
 * ni src/donnees).
 *
 * ── Écran ───────────────────────────────────────────────────────────────────────────────────
 *
 * Dialogue modal `data-testid="ecran-vannes"`, nommé « Vannes d’irrigation » ; quand la ferme est
 * lue, un élément `data-testid="vannes-pret"`.
 *   - « Ajouter des vannes » : champs « Nombre de vannes » et « Préfixe du nom » (« V » par défaut),
 *     un aperçu (« V1 à V60 »), bouton « Ajouter les vannes ». Le lot (règle du cœur
 *     `vannesDuLot`, numéros libres les plus petits) s'écrit en UNE transaction ; chaque ligne est
 *     acceptée par la règle de ligne du serveur (`validerStructure('secteur_irrigation')`).
 *   - Liste : une ligne `data-testid="vanne"` par vanne non supprimée, triée par numéro,
 *     `data-vanne` = id, `data-numero` ; un bouton « Modifier V12 » (nom de la vanne) l'ouvre ;
 *     le texte dit combien de planches elle arrose aujourd'hui (« 2 planches », « aucune planche »).
 *   - Fiche d'une vanne (dialogue « V12 ») : champs « Numéro », « Nom », « Débit (L/h) » ;
 *     une case à cocher par planche en service, `data-testid="planche-arrosee"`,
 *     `data-emplacement` = id, nommée « Tunnel 2 P3 » (zone puis code), cochée si la vanne
 *     l'arrose aujourd'hui ; « Enregistrer » écrit la vanne (si elle change) ET ses liens (règle
 *     du cœur `changerLiens` au jour du téléphone : lien retiré fermé la veille, nouveau lien du
 *     jour) en UNE transaction ; « Supprimer la vanne » (refusé tant qu'elle arrose : décocher
 *     d'abord) ; « Fermer ». Erreur (numéro déjà pris…) : `role="alert"`, rien n'est écrit.
 *   - Après chaque enregistrement : bandeau `data-testid="saisie-annulable"` avec « Annuler »
 *     (10 s), qui remet tout comme avant en une transaction (liens fermés rouverts, liens créés
 *     supprimés en douceur, vannes créées supprimées en douceur).
 * Jamais de DELETE : une suppression pose `supprime_le`. Hors ligne : tout passe par la base du
 * téléphone.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType } from 'react';

/** Relatif aux tests qui l'importent (parcellaire/*.test.tsx), pas à ce fichier. */
export const CHEMIN_VANNES = './vannes/index.ts';

export interface ProprietesEcranVannes {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

export interface ModuleVannes {
  readonly EcranVannes: ComponentType<ProprietesEcranVannes>;
}

export const TESTID_VANNES = {
  ecran: 'ecran-vannes',
  pret: 'vannes-pret',
  vanne: 'vanne',
  plancheArrosee: 'planche-arrosee',
  annulable: 'saisie-annulable',
} as const;
