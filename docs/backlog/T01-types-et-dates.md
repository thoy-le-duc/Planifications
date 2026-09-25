# T01 — Types du domaine et dates calendaires

**Objectif** : poser en TypeScript les entités du modèle v1 et les fonctions de dates dont tout le moteur dépend, sans aucun piège de fuseau horaire.

**Dépend de** : —
**Périmètre** : `packages/core/src/domaine/**`, `packages/core/src/dates/**`, `packages/core/src/index.ts`

## Règles métier

- Une date calendaire est une chaîne `AAAA-MM-JJ` (type marqué `DateCalendaire`), jamais un `Date` JavaScript.
- Les calculs se font en « jour absolu » (nombre entier de jours depuis 1970-01-01), sans fuseau.
- Semaine ISO 8601 : la semaine 1 contient le premier jeudi de l'année ; la semaine commence le lundi.
- Les identifiants sont des UUID v7 (type marqué `Id<'Serie'>`, etc.) ; la génération est injectable pour les tests.

## Critères d'acceptation

- [ ] Types pour chaque entité de `docs/modele-donnees.md` (Ferme, Zone avec zone parente, Emplacement avec « remplace », Secteur d'irrigation, Famille, Espèce, Variété, Itinéraire, Saison, Série, Plantation, Campagne, Occupation, Assolement, Événement et ses détails, Article et mouvement de stock, Produit phyto, Proposition, Modification).
- [ ] Unions discriminées pour les variantes (sorte d'emplacement, type d'événement, mode d'itinéraire, ancre de série, nature d'assolement) ; `switch` exhaustifs vérifiés par le typage.
- [ ] `ajouterJours`, `ecartEnJours`, `semaineIso`, `lundiDeSemaine`, `estDateValide`, `analyserDate` (renvoie une erreur typée, ne lève pas d'exception).
- [ ] Tests :
  - `semaineIso('2026-12-31')` = 2026-S53 ; `semaineIso('2027-01-01')` = 2026-S53 ; `semaineIso('2027-01-03')` = 2026-S53 ; `semaineIso('2027-01-04')` = 2027-S01 ; `semaineIso('2024-12-30')` = 2025-S01 ; `semaineIso('2026-01-01')` = 2026-S01.
  - `lundiDeSemaine(2027, 22)` = `2027-05-31`.
  - `ecartEnJours('2024-02-28', '2024-03-01')` = 2 (année bissextile).
  - `ajouterJours('2027-04-05', -28)` = `2027-03-08`.
  - `analyserDate('2027-02-30')` renvoie une erreur.
  - Les résultats ne changent pas quand la variable d'environnement `TZ` vaut `Pacific/Kiritimati` ou `America/Los_Angeles`.

**Hors périmètre** : stockage, validation des saisies utilisateur, interface.
