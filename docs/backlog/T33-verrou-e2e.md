# T33 — Un seul jeu e2e à la fois sur la machine

**Objectif** : que deux worktrees ne lancent plus leurs e2e en même temps sur la même machine. Plusieurs Chromium sous SwiftShader se disputent le processeur : les e2e de fluidité 3D et de temps échouent au hasard (constaté plusieurs fois le 8 octobre). Le plancher de T29b n'est mesuré qu'au début, donc un échec de charge fait perdre du temps à la boucle sans rien prouver.

**Dépend de** : rien
**Périmètre** : `package.json` racine (`e2e`, `e2e:demo`, `e2e:synchro`), `apps/web/package.json` (`e2e`, `e2e:demo`), `scripts/verrou-e2e.sh` (nouveau, petit). Aucun seuil, aucune borne de test, aucun fichier de test.

## Règles

- **Verrou machine** : `flock` sur un fichier nommé `planifications-e2e.lock` dans le dossier temporaire du système (`${TMPDIR:-/tmp}`). Le même fichier pour toutes les copies du dépôt, donc pour tous les worktrees.
- **Message d'attente** : si le verrou est déjà pris, le script affiche tout de suite « en attente d'un autre jeu e2e » puis attend.
- **Délai maximal** : 30 minutes (constante nommée dans le script). Au-delà, le script s'arrête avec un message clair et un code de sortie non nul ; il ne lance pas le jeu sans verrou.
- **Une seule place** : le verrou est pris dans `apps/web/package.json` (`e2e`, `e2e:demo`) et dans `e2e:synchro` à la racine. Les `e2e` racine passent par le filtre et héritent du verrou : pas de double prise, donc pas d'interblocage.
- **Libération** : le verrou tombe à la fin du jeu, réussi ou non (fin du processus).
- **Hors périmètre du verrou** : `pnpm verif` ne prend pas le verrou lui-même ; chacun de ses e2e le prend à son tour.
- Aucun seuil de temps ni aucune borne ne change.

## Critères d'acceptation

- [ ] Test manuel scripté (dans la PR) : deux `pnpm e2e` lancés dans deux worktrees ; le second affiche « en attente d'un autre jeu e2e » et ne démarre qu'après la fin du premier.
- [ ] Test : `verrou-e2e.sh` avec un verrou tenu par un autre processus et un délai de 2 secondes (variable d'environnement de test) → message d'attente, puis sortie non nulle avec le message de délai dépassé.
- [ ] Test : sans concurrence, le script exécute la commande et renvoie son code de sortie tel quel (0 et 1 testés).
- [ ] `pnpm verif` passe en entier ; aucun seuil modifié (vérifié par `git diff` : pas de changement dans les `*.e2e.ts` ni dans `budget.json`).
- [ ] Le script fonctionne sur la machine Linux de la boucle ; la PR note que `flock` n'existe pas tel quel sur macOS.

## Risques

- `flock` absent : le script l'annonce et s'arrête (pas de jeu sans verrou). La boucle tourne sous Linux, donc le risque est faible.
- Un processus tué brutalement libère le verrou (le système le relâche avec le descripteur) : pas de verrou orphelin à nettoyer.

**Hors périmètre** : exécuter les e2e en série dans le même worktree, réduire le nombre de Chromium, changer les seuils de fluidité, paralléliser la CI.
