/**
 * Contrat de T28j — le parcours guidé de l'éditeur de placement (docs/backlog/T28j-parcours-guide-placement.md,
 * Q36). Lu par etapes-editeur.test.tsx. Le DOM décrit ici s'ajoute à celui de ./contrat.ts, sans le changer.
 *
 * ── Bandeau d'étapes ─────────────────────────────────────────────────────────────────────────
 * `etapes-placement` : le bandeau, en haut de l'éditeur, présent en mode édition (gérant), toujours
 *   visible. Il contient QUATRE `etape-placement`, dans l'ordre 1 à 4 :
 *   data-etape = '1' | '2' | '3' | '4' ;
 *   data-etat  = 'faite' | 'en-cours' | 'a-venir' ; une seule étape 'en-cours' à la fois ;
 *   le texte contient le titre de l'étape (TITRES_ETAPES) ;
 *   chaque étape est un bouton (<button> ou role="button") : on peut y revenir d'un tap.
 *   Une étape 'faite' est cochée (le texte ou l'état le montre, pas testé plus finement).
 *
 * ── Quelle étape est en cours ────────────────────────────────────────────────────────────────
 *   - ferme sans origine du plan : 1 en cours, 2 à 4 à venir (même si ferme.position existe) ;
 *   - origine posée, aucun bâtiment : 1 et 2 faites, 3 en cours, 4 à venir ;
 *   - un bâtiment posé (même seulement au brouillon, pas encore enregistré) : 1 à 3 faites, 4 en cours ;
 *   - ferme déjà placée à l'ouverture (origine et bâtiments) : 1 à 3 faites, 4 en cours ;
 *   - pendant la pose (formulaire « Nouveau bâtiment » validé, en attente du tap sur la photo) :
 *     l'étape 3 est en cours.
 *
 * ── Revenir à une étape ──────────────────────────────────────────────────────────────────────
 *   Un tap sur une étape 'faite' : cette étape prend aria-current="step" (et elle seule), et le
 *   bloc `aide-etape` (role="status" non requis) affiche la consigne de cette étape : son texte
 *   contient le titre de l'étape. `data-etat` ne change PAS (c'est l'avancement réel). Un tap sur
 *   l'étape en cours rend aria-current="step" à l'étape en cours. Sans tap, aria-current="step"
 *   est sur l'étape en cours. Cas particulier : le tap sur l'étape 1 met le focus sur le champ de
 *   recherche d'adresse (T28h). Revenir ne modifie rien dans la ferme : aucun appel à porte.placer.
 *
 * ── Boutons grisés ───────────────────────────────────────────────────────────────────────────
 *   Tout bouton désactivé de l'éditeur (hors « Fermer » pendant une écriture) a un aria-describedby
 *   qui désigne un élément au texte non vide, la raison. Pour « Nouveau bâtiment » sans origine :
 *   la raison est MESSAGES_ETAPES.raisonSansOrigine. Une fois l'origine posée, le bouton est actif.
 *
 * ── Pose ─────────────────────────────────────────────────────────────────────────────────────
 *   `message-pose` (role="status") : affiché pendant la pose seulement, contient
 *   MESSAGES_ETAPES.poseSerre pour une serre (type serre_tunnel). Le message actuel
 *   « Touchez la photo pour poser « nom » » peut rester à côté.
 */
import type { ReactElement } from 'react';

export type { ReactElement };

export const TESTID_ETAPES = {
  bandeau: 'etapes-placement',
  etape: 'etape-placement',
  aide: 'aide-etape',
  messagePose: 'message-pose',
} as const;

export type EtatEtape = 'faite' | 'en-cours' | 'a-venir';

export const TITRES_ETAPES = {
  1: 'Trouver la ferme',
  2: 'Poser le point de départ',
  3: 'Ajouter une serre ou un bâtiment',
  4: 'Ajuster et tracer les zones',
} as const;

export const MESSAGES_ETAPES = {
  /** Motif tolérant sur l'apostrophe (’ ou '). */
  raisonSansOrigine: /Posez d.abord le point de départ \(étape 2\)/,
  poseSerre: 'Touchez la photo où se trouve la serre',
} as const;
