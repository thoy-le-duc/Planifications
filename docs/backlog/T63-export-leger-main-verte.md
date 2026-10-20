# T63 — Main verte : le registre phyto de l'export rend la main au fil

**Objectif** : la CI de `main` repasse au vert sur `packages/sync/src/export-leger.test.ts` (T15b, « fil jamais gelé »), sans relever le seuil de 25 ms et sans toucher au test. Règle « main verte » de `docs/boucle.md` (T20).

**Dépend de** : T15b, T52
**Périmètre** : `packages/core/src/phyto/index.ts`, `packages/core/src/export/index.ts`, `docs/journal.md`

## Constat (CI de main, a1bd62f, fusion de T57)

- Plus longues tâches de `construireArchive` (ferme de T07) : 23,9, **26,1** et 14,5 ms de CPU, pour un seuil de 25 ms. La PR #214 (T62) échoue sur le même test.
- Profil : sur main comme sur ff2c5b8 (T60, verte), la plus longue tâche est le **registre phyto** de T52 (`registre-phyto.csv`). Il est calculé d'un bloc à la fin de l'export : lecture du détail JSON des 4 425 traitements, chaînes en vigueur, tri, lignes. Ce bloc dure ≈ 8 ms de CPU sous Node et s'ajoute à une tranche de 8 ms presque pleine.
- T60 (tables `personne`, `attribution`) et T57 (deux colonnes de `vanne`) n'ajoutent rien de mesurable : leurs tables sont vides dans la ferme de T07.

## Règles

- Le registre phyto se calcule **par paquets**, en générateur, comme `repartir` pour les tables. L'export rend la main entre deux paquets (`peutEtreRendre`).
- Une seule règle du registre : `lignesRegistrePhyto` (écran Registre) déroule le même générateur d'une traite. Elle rend les mêmes lignes, dans le même ordre.
- Seuil de 25 ms, test et budgets inchangés.

## Critères d'acceptation

- [ ] `export-leger.test.ts` passe 10 fois sur 10 en local.
- [ ] Plus longue tâche mesurée (10 passages de `mesure-export.ts`) nettement sous le seuil, et le registre n'en est plus la cause au profil.
- [ ] `pnpm typecheck`, `pnpm lint`, tests de `packages/core` et `packages/sync` verts, sans test modifié.
- [ ] `pnpm build:essais` et `pnpm budget` OK, sans budget relevé. E2e `export*` verts.
