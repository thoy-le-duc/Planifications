/**
 * Contrat de T32c, écran — le réglage du profil de croissance d'une espèce, dans l'écran
 * Itinéraires culturaux (docs/backlog/T32c-reglage-profils.md ; Q32, Q33, Q35, Q39). En plus de
 * ./contrat.ts (T24), qui reste valable. Types et constantes seuls.
 *
 * Tests : ../reglage-croissance.test.tsx (DOM simulé, ferme des itinéraires de ./ferme-itineraires.ts
 * complétée d'une tomate, d'une asperge et d'un équipier ; base mémoire de @planif/sync lue et
 * écrite par la porte). Hors de ces tests, à la charge du développeur et du chef : l'écran Ferme
 * passe `utilisateurId` (session.utilisateurId) à EcranItineraires ; le budget de 300 ms (e2e,
 * CPU ×4) de l'écran reste tenu ; le réglage n'entre pas dans le JavaScript de démarrage.
 *
 * ── Propriétés ───────────────────────────────────────────────────────────────────────────────
 *
 * EcranItineraires reçoit en plus `utilisateurId` (facultatif, pour ne pas casser les appels
 * existants) : l'utilisateur du téléphone, dont le rôle dans la ferme (ligne locale `membre`)
 * décide du mode. Absent : lecture seule.
 *
 * ── Entrée ───────────────────────────────────────────────────────────────────────────────────
 *
 * Dans chaque groupe data-testid="culture-itineraires" (une espèce, voir ./contrat.ts), un bouton
 * dont le nom accessible COMMENCE par « Croissance » (« Croissance », « Croissance de Tomate »…),
 * pour tout utilisateur et toute espèce (de la ferme ou de la bibliothèque) : le réglage sert aussi
 * à LIRE le profil. Il ouvre :
 *
 * ── Réglage (DOM) ────────────────────────────────────────────────────────────────────────────
 *
 * Racine role="dialog", data-testid="reglage-croissance", data-espece=<id>, nom accessible qui
 * contient le nom de l'espèce. Un bouton « Fermer » : ferme le réglage, n'écrit rien, l'écran
 * Itinéraires reste ouvert (surFermer de l'écran n'est pas appelé).
 *
 * Profil EFFECTIF montré : celui réglé par la ferme (`espece.profil_croissance`), sinon le profil
 * par défaut du cœur (`profilEffectif` de @planif/core : aucune valeur par défaut recopiée dans
 * l'écran).
 *
 * Gérant actif de la ferme (ligne locale `membre` : role 'gerant', etat 'accepte', non supprimée)
 * ET espèce de la ferme (ferme_id = la ferme) — mode réglage, champs larges (≥ 56 px, au pouce) :
 *   - <select> « Forme » : une <option> par forme de FORMES_PLANT (value = la forme, texte en
 *     français), valeur = forme effective ;
 *   - <input> dont le nom accessible commence par « Hauteur maximale » (en mètres ; saisie
 *     « 1,8 » ou « 1.8 » acceptée, donc un champ texte avec inputmode="decimal", pas
 *     type="number" qui efface « 1,8 » ; affichée avec la virgule ou le point, au choix) ;
 *   - <input> dont le nom accessible commence par « Durée » (jours jusqu'à la hauteur maximale,
 *     entier) — testé seulement sur des profils dont la durée est en jours (tomate, asperge) ;
 *   - la valeur par défaut affichée à côté de chacun : data-testid="defaut-forme",
 *     "defaut-hauteur" (texte qui contient la hauteur par défaut en mètres, écrite à la française :
 *     « 3 m », « 1,5 m »), "defaut-duree" (texte qui contient le nombre de jours) ;
 *   - un bouton « Enregistrer » : écrit par la PORTE (porte.reglerProfilCroissance, contrat
 *     packages/sync/src/test/contrat-profil.ts) le profil effectif dont forme, hauteur et durée
 *     sont remplacées par la saisie, TOUTES LES AUTRES CLÉS GARDÉES (allure, finDeCycle,
 *     cycleAnnuel, fougereApresRecolte de l'asperge) ; une seule transaction ;
 *   - valeur hors bornes (règles du cœur : hauteur > 0 et ≤ 6 m, durée entière > 0) : RIEN
 *     d'écrit, un message role="alert" dans le réglage, en français, qui nomme le champ
 *     (« hauteur », « durée ») — « Enregistrer » peut être désactivé ou montrer le message au tap ;
 *   - un bouton « Rétablir la valeur par défaut » quand la ferme a réglé le profil : UN tap, sans
 *     confirmation, écrit null (profil_croissance NULL) par la porte ; les champs montrent alors
 *     les valeurs par défaut. Sans profil réglé : absent ou désactivé.
 *
 * LECTURE SEULE — équipier (ou utilisateurId absent), ou gérant sur une espèce de la bibliothèque
 * commune (ferme_id nul) : les valeurs effectives restent lisibles (la hauteur en mètres,
 * « 1,8 m ») ; aucun <input> ni <select> modifiable dans le réglage (absents, ou disabled) ; ni
 * « Enregistrer », ni « Rétablir la valeur par défaut » actifs ; aucune écriture possible.
 *   - équipier : le réglage dit que seul le gérant règle le profil (texte qui contient « gérant ») ;
 *   - espèce de la bibliothèque : le réglage contient TEXTE_ESPECE_BIBLIOTHEQUE (le bouton
 *     « Personnaliser » vient avec T32g, Q39).
 *
 * Écritures : uniquement par la porte ; jamais d'écriture dans `modification`, jamais d'INSERT,
 * de DELETE ni de REPLACE sur `espece`, jamais d'autre colonne d'espèce que profil_croissance et
 * modifie_le.
 */
import type { ProprietesEcranItineraires } from './contrat.ts';

export interface ProprietesEcranItinerairesCroissance extends ProprietesEcranItineraires {
  /** Utilisateur du téléphone : son rôle dans la ferme décide du mode (réglage ou lecture). */
  readonly utilisateurId?: string;
}

/** Texte du réglage d'une espèce de la bibliothèque commune (Q39). */
export const TEXTE_ESPECE_BIBLIOTHEQUE = 'Espèce de la bibliothèque : personnalisez-la pour régler sa croissance';
