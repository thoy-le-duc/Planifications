# T71 — Alléger la vue 3D : retrouver une marge durable

**Objectif** : la vue 3D est pile à son plafond (`jsVue3dGzKio` 207,9 Kio, ≈ 10 octets de marge). Les prochains tickets du jumeau (T58 serres, T59 déroulé de la saison, T61 chemins et outils) ne peuvent rien y ajouter. Comme T66 l'a fait pour le démarrage, il faut retrouver **au moins 4 Kio de marge** sous 207,9 Kio, sans rien retirer à l'utilisateur ni ralentir la 3D.

**Dépend de** : T66 (méthode), T55, T57
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/vite.config.ts` (découpage des morceaux), `apps/web/budget.json`, tests de budget, `docs/mesures/T71.md`
**Priorité** : haute (bloque T58, T59, T61). **Modèle** : Opus.

## Règles

1. Mesurer ce qui compose le morceau 3D (three, react-three-fiber, code de l'appli, préchargements) : octets gzip par module ; résultat dans `docs/mesures/T71.md`.
2. Sortir du morceau 3D ce qui n'est pas nécessaire au premier affichage de la vue : panneaux, fiches, filtres rarement ouverts, couches facultatives (vannes, DAR déjà à part), code mort, imports de three trop larges (préférer les imports ciblés), géométries ou matériaux en double.
3. Ne pas ralentir : temps e2e de la 3D (affichage après chargement du module, changement de semaine, vol de caméra, fluidité) inchangés.
4. Le plafond `jsVue3dGzKio` reste 207,9 Kio ; interdit de le relever ; marge mesurée ≥ 4 Kio.

## Critères d'acceptation

- [ ] Vue 3D ≤ 203,9 Kio mesurée ; plafond inchangé.
- [ ] e2e `vue-3d*` verts (en tenant compte des rouges déjà connus en WebGL logiciel local, à comparer avec main).
- [ ] `docs/mesures/T71.md` avant/après par module.
- [ ] `pnpm verif` passe.
