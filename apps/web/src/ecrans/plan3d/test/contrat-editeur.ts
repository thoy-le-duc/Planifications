/**
 * Contrat de T28f — trouver et ouvrir l'éditeur de placement depuis la vue 3D
 * (docs/backlog/T28f-trouver-editeur.md, Q32). Lu par ../invitation.test.ts, e2e/vue-3d-editeur.e2e.ts
 * et scripts/placement.test.ts.
 *
 * ── Module pur : apps/web/src/ecrans/plan3d/invitation.ts ────────────────────────────────────
 *   fermeSansPlacement(plan: PlanJumeau): boolean
 * Vrai quand rien de la ferme n'est placé : AUCUNE zone avec contour (`contour` non nul et non
 * vide), AUCUN bâtiment (`plan.batiments` absent ou vide), AUCUNE planche positionnée
 * (`placement` non nul sur une ligne d'emplacement). Un seul de ces éléments suffit pour que ce
 * soit faux. Pure : l'entrée n'est pas modifiée ; ni React, ni three, ni Date. Une ferme sans
 * zone ni planche du tout (plan vide) est sans placement.
 *
 * ── Vue 3D (DOM) ─────────────────────────────────────────────────────────────────────────────
 * Condition : gérant de la ferme (rôle `gerant`, comme l'éditeur, T28b), QUELLE QUE SOIT la largeur
 * de l'écran (Q36, T28k : le gérant place aussi au téléphone ; avant, 1024 px ou plus seulement).
 *
 * `modifier-plan` : bouton « Modifier le plan », DANS `vue-3d` (donc visible pendant que la 3D est
 *   ouverte), au plus un dans toute la page. Un tap ouvre l'éditeur de placement (`editeur-placement`,
 *   le même composant que la carte « Plan de la ferme » de l'onglet Ferme, chargé par le même import
 *   dynamique) par-dessus la vue ; la 3D reste montée dessous. « Fermer » dans l'éditeur ramène sur
 *   la vue 3D (`vue-3d` toujours là, `data-etat="pret"`), qui montre alors le placement enregistré
 *   (`toile-3d` : `data-batiments`, `data-placees` relus de la base ; la liste des bâtiments aussi).
 *   Non gérant : le bouton n'existe pas (count 0, pas seulement caché). Écran étroit : le gérant l'a (T28k).
 * `encart-placement` : encart (dans `vue-3d`) affiché si et seulement si `fermeSansPlacement(plan)`.
 *   Gérant (tout écran) : il contient le texte « Placez votre ferme sur la photo aérienne » ET le
 *   bouton `modifier-plan` (c'est le même bouton, pas un second). Sinon : il contient le texte
 *   « Le gérant place la ferme depuis un ordinateur », sans bouton. Dès qu'un bâtiment, une zone à
 *   contour ou une planche est placé, l'encart disparaît (après le retour de l'éditeur).
 *   Dans une ferme déjà placée, le bouton `modifier-plan` reste (barre d'outils de la vue), sans encart.
 *
 * ── Onglet Ferme ─────────────────────────────────────────────────────────────────────────────
 * La carte « Plan de la ferme » garde son bouton « Placer sur la photo aérienne » (ENTREE_PLACEMENT,
 * tests de T28b inchangés) ; son détail cite la 3D et « Modifier le plan ».
 *
 * ── Amorçage (page /diagnostic/amorcer.html, src/donnees/amorcer.ts) ────────────────────────
 * `?jeu=placement` accepte trois paramètres de plus (absents : comportement actuel, rien ne change) :
 *   `saison=1`   → option `saison` de ferme-placement.ts (une saison 2026, donc un plan et « Voir en 3D ») ;
 *   `origine=1`  → option `origine` (origine, contour de Plein champ, PC-01 placée, Hangar, Serre M1) ;
 *   `role=equipier` → option `role` (l'utilisateur est équipier, pas gérant).
 * La ferme sans placement est donc `?jeu=placement&saison=1`, la ferme placée `…&origine=1`.
 *
 * ── Démo (pnpm e2e:demo) ─────────────────────────────────────────────────────────────────────
 * Rôle gérant, ferme fictive déjà placée (T28c) : « Modifier le plan » est dans la 3D, ouvre l'éditeur,
 * hors réseau (service worker aux commandes, réseau coupé) : `data-fond="neutre"`, `fond-neutre` avec
 * « Photo aérienne indisponible hors ligne », aucune tuile demandée, un bâtiment peut être posé et
 * enregistré, et le retour montre un bâtiment de plus dans la 3D. Aucune requête hors de l'origine.
 *
 * ── Poids ────────────────────────────────────────────────────────────────────────────────────
 * JavaScript de démarrage inchangé (71 Kio, budget.json intact) ; le morceau de l'éditeur ne contient
 * rien de three, le morceau 3D rien de l'orthophoto (data.geopf.fr) : l'éditeur reste chargé au tap.
 */
import type { PlanJumeau } from './contrat-jumeau.ts';

export interface ModuleInvitation {
  fermeSansPlacement(plan: PlanJumeau): boolean;
}

export const TESTID_3D_EDITEUR = {
  modifierPlan: 'modifier-plan',
  encart: 'encart-placement',
} as const;

export const TEXTES_3D_EDITEUR = {
  bouton: 'Modifier le plan',
  invitation: 'Placez votre ferme sur la photo aérienne',
  pasGerant: 'Le gérant place la ferme depuis un ordinateur',
} as const;
