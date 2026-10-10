/**
 * Contrat de T32c, écran — la fiche de l'espèce et le réglage de son profil de croissance
 * (docs/backlog/T32c-reglage-profils.md ; Q32, Q33, Q35). Types et constantes seuls : les tests
 * chargent le module par import dynamique (chemin tenu dans une variable), leur typage ne dépend
 * pas du code pas encore écrit.
 *
 * Tests : ../fiche-espece.test.tsx (DOM simulé, base mémoire de @planif/sync lue et écrite par la
 * porte). Hors de ces tests, à la charge du développeur et du chef : l'ENTRÉE vers la fiche (la
 * vue 3D dit « Hauteurs indicatives, réglables dans la fiche de l'espèce » ; aucun écran des
 * espèces n'existe encore), le chargement à la demande (jamais dans le JavaScript de démarrage) et
 * le budget de 300 ms (e2e, CPU ×4) comme les autres écrans.
 *
 * ── Module attendu ───────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/bibliotheque/index.ts : `FicheEspece` (aussi en export par défaut) et
 * `MARQUE_FICHE_ESPECE_AFFICHEE` (= MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE). Il reçoit la porte :
 * il n'importe ni PowerSync ni src/donnees.
 *
 * ── Écran (DOM) ──────────────────────────────────────────────────────────────────────────────
 *
 * Racine role="dialog", aria-modal="true", data-testid="fiche-espece", nom accessible qui
 * COMMENCE par le nom de l'espèce (« Tomate », « Asperge »…). Un bouton « Fermer » (appelle
 * surFermer, n'écrit rien). Marque de performance posée une fois par ouverture, quand le profil
 * est dessiné.
 *
 * Région nommée « Croissance » (role="region" ou <section aria-label>). Profil EFFECTIF montré :
 * celui réglé par la ferme (`espece.profil_croissance`), sinon le profil par défaut du cœur
 * (`profilEffectif` de @planif/core : aucune valeur par défaut recopiée dans l'écran).
 *
 * Gérant actif de la ferme (ligne locale `membre` : role 'gerant', etat 'accepte', non supprimée)
 * ET espèce de la ferme (ferme_id = la ferme) — mode réglage :
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
 *     d'écrit, un message role="alert" dans la fiche, en français, qui nomme le champ (« hauteur »,
 *     « durée ») — « Enregistrer » peut être désactivé ou montrer le message au tap ;
 *   - un bouton « Rétablir la valeur par défaut » quand la ferme a réglé le profil : UN tap, sans
 *     confirmation, écrit null (profil_croissance NULL) par la porte ; les champs montrent alors
 *     les valeurs par défaut. Sans profil réglé : absent ou désactivé.
 *
 * Équipier (ou gérant sur une espèce de la bibliothèque commune, ferme_id nul) — LECTURE SEULE :
 *   les valeurs effectives restent lisibles (la hauteur en mètres, « 1,8 m ») ; aucun <input> ni
 *   <select> modifiable dans la région (absents, ou disabled) ; ni « Enregistrer », ni
 *   « Rétablir la valeur par défaut » actifs ; aucune écriture possible. Pour un équipier, la
 *   région dit que seul le gérant règle le profil (texte qui contient « gérant »).
 *
 * Écritures : uniquement par la porte ; jamais d'écriture dans `modification`, jamais d'INSERT,
 * de DELETE ni de REPLACE sur `espece`, jamais d'autre colonne d'espèce que profil_croissance et
 * modifie_le.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

export interface ProprietesFicheEspece {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Utilisateur du téléphone : son rôle dans la ferme décide du mode (réglage ou lecture). */
  readonly utilisateurId: string;
  readonly especeId: string;
  readonly surFermer: () => void;
  /** Horloge ; par défaut () => new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModuleFicheEspece {
  readonly FicheEspece: (p: ProprietesFicheEspece) => ReactElement;
  readonly default: (p: ProprietesFicheEspece) => ReactElement;
  readonly MARQUE_FICHE_ESPECE_AFFICHEE: string;
}

/** Marque posée quand la fiche (le profil) est dessinée. */
export const MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE = 'planif:fiche-espece-affichee';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_MODULE = '../index.ts';

/** Le module, ou une erreur claire qui nomme ce qui manque. */
export async function chargerFicheEspece(): Promise<ModuleFicheEspece> {
  let m: Partial<ModuleFicheEspece>;
  try {
    m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as Partial<ModuleFicheEspece>;
  } catch (e) {
    throw new Error(`apps/web/src/ecrans/bibliotheque/index.ts n’existe pas encore (T32c) : ${String(e)}`, { cause: e });
  }
  const manquants = (['FicheEspece', 'default', 'MARQUE_FICHE_ESPECE_AFFICHEE'] as const).filter((n) => m[n] === undefined);
  if (manquants.length > 0) throw new Error(`la fiche de l’espèce n’exporte pas encore : ${manquants.join(', ')} (T32c)`);
  return m as ModuleFicheEspece;
}
