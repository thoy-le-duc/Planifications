# T65 — Bandeau « Démarrer votre ferme » : repliable partout, ne cache jamais l'écran

**Objectif** : retour de Théophane (2026-10-20) : « la liste dépliante des quatre étapes à faire quand on ouvre la ferme nous empêchait de voir en dessous ; je ne sais plus où j'ai cliqué, je n'ai plus ce problème, mais il va rester dans l'appli ». T50 n'a replié le bandeau que sur Planches. Dans Aujourd'hui (et partout où il s'affiche), il reste complet et peut occuper tout l'écran du téléphone. Le maraîcher ne doit jamais avoir à deviner où taper pour retrouver son écran.

**Dépend de** : T49 (bandeau), T50 (repli sur Planches)
**Périmètre** : `apps/web/src/ecrans/demarrer/**`, `apps/web/src/ecrans/aujourdhui/**` (affichage du bandeau seulement), `apps/web/src/ecrans/plan/**` (cohérence avec T50), tests, e2e
**Priorité** : haute (première impression d'une ferme neuve). **Modèle** : Opus (budget de démarrage à ~12 octets de marge).

## Règles

1. Partout, le bandeau a deux états : **replié** (une ligne : « Démarrer votre ferme · 3/4 · prochaine étape : … », bouton de l'étape et bouton « Voir les étapes ») et **déplié** (les 4 étapes), avec un bouton « Replier » bien visible (≥ 44 px).
2. Par défaut **replié** sur téléphone (largeur < 600 px), déplié sur ordinateur. Le choix de l'utilisateur est retenu par ferme (stockage local), et survit au rechargement.
3. Déplié, le bandeau ne dépasse jamais **40 % de la hauteur de l'écran** : au-delà, sa liste défile à l'intérieur. Le contenu de l'écran (cartes d'Aujourd'hui, plan) reste visible et atteignable au doigt.
4. Le bandeau disparaît toujours dès la première série (règle de T49, inchangée).
5. Budgets : aucun relèvement ; rien de nouveau dans le chemin de démarrage si possible (le bandeau est déjà chargé avec Aujourd'hui).

## Critères d'acceptation

- [ ] e2e téléphone (390×844 et 360×800, toucher) sur une ferme neuve, Aujourd'hui puis Planches : le bandeau est replié à l'ouverture, au moins une carte ou le plan visible sans défiler ; « Voir les étapes » déplie, « Replier » replie ; le choix survit au rechargement.
- [ ] Test : déplié, hauteur ≤ 40 % de l'écran, liste défilante à l'intérieur.
- [ ] Ordinateur : déplié par défaut, rien ne déborde.
- [ ] Budgets inchangés ; `pnpm verif` passe.
