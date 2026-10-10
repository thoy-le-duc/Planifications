# T11e — Planches : ouvrir la base plus tôt, maquette, marges de temps

**Objectif** : les règles de T11b qui demandent d'abord une mesure ou une maquette (découpage du 2026-10-10).

**Dépend de** : T11b
**Périmètre** : `apps/web/src/donnees/**`, `apps/web/src/ecrans/plan/**`, `apps/web/vite.config.ts`, `apps/web/e2e/**`

## Règles (reprises de T11b)

- **Ouvrir la base plus tôt** : lancer en parallèle dès la lecture de la session les étapes aujourd'hui enchaînées (`import(appli.ts)`, effacement en attente, `indexedDB.databases()`, `import(base-appli.ts)`, PowerSync, WASM) ; viser un premier tap sur Planches sous 300 ms même base non prête (Q19 : « ok pour l'instant », sans priorité).
- **Double téléchargement à la première visite** : mesurer si PowerSync et le WASM sont chargés une fois par la page et une fois par le précache ; l'éviter si c'est confirmé.
- **Écarts avec la maquette Plan** : puces de zone, surtitre « TUNNEL 2 · 6 PLANCHES · 30 M », carte d'alerte sous la légende.
- **Marge des temps** : profil sous CPU ×4 de « Planches » (jusqu'à 313 ms) et de la pire image au défilement (50,1 ms), puis corriger ce qui coûte ; aucun budget relevé.

## Critères d'acceptation

- [ ] Mesure avant/après chiffrée dans la PR pour chaque règle de performance.
- [ ] Un test par règle retenue ; dix passages de `plan.e2e.ts` sans dépassement.
- [ ] `pnpm verif` passe en entier.
