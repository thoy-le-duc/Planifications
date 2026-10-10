/**
 * Contrat de T32g, écran — « Personnaliser » une espèce de la bibliothèque commune dans l'écran
 * Itinéraires culturaux (docs/backlog/T32g-personnaliser-espece.md ; Q39), et la suite de la
 * relecture T32c sur « Enregistrer ». En plus de ./contrat.ts (T24) et ./contrat-croissance.ts
 * (T32c), qui restent valables. Types et constantes seuls.
 *
 * Tests : ../personnaliser-espece.test.tsx (DOM simulé, ferme des itinéraires de
 * ./ferme-itineraires.ts — la Batavia y est l'espèce de la bibliothèque, avec l'itinéraire
 * « Batavia » de la bibliothèque et « Batavia de la ferme » et ses séries — complétée d'une
 * tomate de la ferme sans profil et d'un équipier ; base mémoire de @planif/sync lue et écrite par
 * la porte). Porte : packages/sync/src/test/contrat-personnaliser.ts (`personnaliserEspece`).
 *
 * ── Bouton « Personnaliser » ─────────────────────────────────────────────────────────────────
 *
 * Gérant actif de la ferme (ligne locale `membre`) : dans le groupe data-testid="culture-itineraires"
 * d'une espèce de la BIBLIOTHÈQUE commune (ferme_id nul), un bouton dont le nom accessible
 * COMMENCE par « Personnaliser » (« Personnaliser », « Personnaliser Batavia »…), à côté de
 * « Croissance ». Il est dans le GROUPE, pas dans le réglage de croissance : le test T32c « aucune
 * écriture possible sur la ligne de la bibliothèque » touche tous les boutons actifs du réglage
 * d'une espèce de la bibliothèque et exige qu'aucune écriture n'ait lieu.
 * Pas de bouton « Personnaliser » sur une espèce de la ferme. Équipier (ou utilisateurId absent) :
 * aucun bouton « Personnaliser » nulle part dans l'écran.
 *
 * Un tap : la copie est écrite par la PORTE (`porte.personnaliserEspece`, une transaction, un
 * INSERT espece : rien d'autre ne change, les itinéraires et séries de la Batavia restent sur
 * l'espèce d'origine), PUIS le réglage de croissance de la COPIE s'ouvre (role="dialog",
 * data-testid="reglage-croissance", data-espece=<id de la copie>, nom accessible qui contient le
 * nom de l'espèce), en mode réglage (gérant, espèce de la ferme : champs actifs, voir
 * ./contrat-croissance.ts), même si la copie n'a pas encore d'itinéraire (donc pas de groupe).
 * Ce réglage dit en une phrase que les cultures existantes restent liées à l'espèce d'origine :
 * texte qui correspond à MOTIF_CULTURES_RESTENT (TEXTE_CULTURES_RESTENT proposé).
 *
 * Deuxième personnalisation de la même espèce : si le bouton est encore là et actif, un tap
 * n'écrit rien et montre un message role="alert" (dans l'écran) qui contient
 * « Batavia est déjà personnalisée » (le rejet de la porte) ; s'il est retiré ou désactivé, le
 * groupe le dit (texte qui contient « déjà personnalisée »).
 *
 * ── « Enregistrer » sans rien changer (suite de la relecture T32c) ────────────────────────────
 *
 * Sur une espèce de la ferme SANS profil réglé, « Enregistrer » sans rien changer n'écrit rien
 * (profil_croissance reste NULL : les corrections futures des valeurs par défaut s'y appliqueront
 * encore). Aucun ordre d'écriture, aucune transaction.
 */

/** Phrase proposée pour le réglage de la copie (Q39). */
export const TEXTE_CULTURES_RESTENT = 'Les cultures et itinéraires existants restent liés à l’espèce d’origine.';

/** Ce que les tests cherchent (apostrophe droite ou courbe, casse libre). */
export const MOTIF_CULTURES_RESTENT = /cultures[^.]*restent li[ée]e?s à l['’]espèce d['’]origine/i;
