# T36 — Alléger la vue 3D : ne plus charger tout le cœur

**Objectif** : redonner de la marge à la vue 3D avant les fruits et signaux de récolte (T32e). Relecture de T35a (9 octobre) : l'écran 3D charge le morceau commun de `@planif/core` (24,5 Kio compressés) pour deux fonctions seulement, via `scene.ts` (import depuis la racine `@planif/core`) et `@planif/core/croissance`. Essai dans une copie jetable : 226,3 → **202,6 Kio**, démarrage (71,0) et éditeur de placement (18,5) inchangés.

**Dépend de** : T32d, T35a (fusionnés, pour mesurer sur la base finale)
**Périmètre** : `apps/web/vite.config.ts` (`morceauManuel`), `apps/web/src/ecrans/plan3d/scene.ts` (imports), `apps/web/src/ecrans/plan3d/scene.test.ts` (l'assertion qui exige l'import depuis la racine `@planif/core`), `apps/web/budget.json`.

## Règles

- `morceauManuel` range `packages/core/src/croissance/` dans un morceau à lui ; `scene.ts` importe depuis `@planif/core/placement` (ou le sous-chemin exact), pas depuis la racine. L'un sans l'autre ne suffit pas (mesuré : 226,4 Kio).
- `scene.test.ts:277` exige aujourd'hui l'import depuis `@planif/core` : ce test est modifié **dans un commit à part**, justifié par ce ticket (la règle qu'il protège — pas de calcul de placement dupliqué dans l'écran — est gardée : l'import doit venir du cœur, par son sous-chemin).
- Plafond `jsVue3dGzKio` redescendu au plus juste (mesure + 0,5 Kio). Démarrage et éditeur de placement inchangés, vérifiés.
- Aucun changement de comportement : tous les tests 3D, e2e 3D et démo verts.

## Critères d'acceptation

- [ ] `pnpm budget` : vue 3D ≤ 205 Kio, démarrage 71 Kio, placement 18,5 Kio.
- [ ] `scene.test.ts` : l'import vient d'un sous-chemin de `@planif/core` (commit à part, justifié).
- [ ] `pnpm verif` passe en entier.
