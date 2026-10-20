# T66 — Alléger le démarrage : revenir sous 71,2 Kio avec de la marge

**Objectif** : le JavaScript de démarrage a perdu toute marge. T54 a dû relever le plafond de 71,2 à 71,3 Kio, pour le seul **nom haché** d'un morceau chargé à la demande (`npk-XXXXXXXX.js`) inscrit dans la table des dépendances de l'entrée parce que l'export, préchargé, importe le cœur en statique. Chaque ticket coûte désormais des heures pour quelques octets. Il faut retrouver une marge durable (≥ 1 Kio) et revenir au plafond de 71,2 Kio, sans rien retirer à l'utilisateur.

**Dépend de** : T54 (fusionné)
**Périmètre** : `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/vite.config.ts`, chargements à la demande (`apps/web/src/**`), `apps/web/budget.json`, `scripts/**` (mesure), tests de budget, `docs/mesures/T66.md`
**Priorité** : haute. **Modèle** : Opus (performance, empaquetage).

## Règles

1. Mesurer d'abord ce qui compose le JavaScript de démarrage (morceau d'entrée et ses dépendances statiques, table des préchargements de Vite) : octets par module et par entrée de la table. Résultat dans `docs/mesures/T66.md`.
2. Retirer du démarrage ce qui n'y sert pas : préchargements que le démarrage n'utilise pas, dépendances statiques qui peuvent devenir dynamiques (export, phyto, npk, irrigation…), code mort. Le premier affichage d'Aujourd'hui et de Planches ne doit pas ralentir (budgets de temps e2e inchangés).
3. Ramener `jsInitialGzKio` à **71,2** dans `budget.json` (et les tests qui l'épinglent), avec **au moins 1 Kio de marge** mesurée. Idem, si possible sans risque, une marge pour `jsVue3dGzKio` (≈ 10 octets aujourd'hui).
4. Interdit : relever un budget, retirer une fonction, desserrer un test de temps.

## Critères d'acceptation

- [ ] Démarrage ≤ 70,2 Kio mesuré, plafond remis à 71,2 Kio.
- [ ] Temps e2e d'Aujourd'hui, Planches, démarrage et hors ligne inchangés (verts).
- [ ] `docs/mesures/T66.md` : avant/après par module.
- [ ] `pnpm verif` passe.
