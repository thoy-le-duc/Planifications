# T53 — Produits phyto : chercher dans la base publique e-phy

**Objectif** : ne pas recopier à la main l'AMM, la substance et le DAR. La base **e-phy de l'ANSES** est publiée en données ouvertes (data.gouv.fr, Licence Ouverte 2.0, citer la source). On en tire un catalogue de recherche : taper « Success » ou « soufre » propose les produits autorisés ; un tap remplit la fiche du produit de la ferme (T52), modifiable.

**Dépend de** : T52
**Périmètre** : `packages/db` (outil d'extraction et données du catalogue), `apps/web/src/ecrans/ferme/**` (recherche), tests, `docs/modele-donnees.md`
**Priorité** : moyenne. **Modèle** : Opus (volume de données, poids).

## Règles

1. Un script sous `packages/db` lit le fichier e-phy publié (téléchargé à la main, jamais à l'exécution de l'appli) et produit un catalogue réduit : nom commercial, AMM, substances, mention bio (« utilisable en agriculture biologique »), état (autorisé / retiré), et les **usages** (culture × cible) avec dose et DAR.
2. Le DAR dépend de l'usage : à la sélection, l'appli propose l'usage qui correspond à l'espèce de la série (correspondance d'espèces simple et testée), sinon demande de choisir. Le DAR retenu va dans la fiche de la ferme.
3. Le catalogue se charge **à la demande** (pas dans le JavaScript de démarrage) et marche hors ligne une fois chargé. Budget de poids à fixer dans la PR, avec justification.
4. Produits retirés : affichés avec la mention « retiré le JJ/MM/AAAA », sélection déconseillée.
5. Source et date de la base affichées sous la recherche.

## Critères d'acceptation

- [ ] Tests de l'extraction sur un petit extrait figé (fixtures) : produit, usages, DAR, mention bio, retrait.
- [ ] Test : correspondance espèce → usage (tomate, fraise, laitue au moins).
- [ ] Test d'écran : recherche au doigt, sélection → fiche remplie et modifiable.
- [ ] Budget de démarrage inchangé ; `pnpm verif` passe.
