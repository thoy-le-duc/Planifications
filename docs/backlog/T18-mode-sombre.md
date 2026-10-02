# T18 — Mode sombre

**Objectif** : l'appli suit le réglage clair/sombre du téléphone, pour tous les écrans à la fois, sans perdre la lisibilité.

**Dépend de** : T16
**Périmètre** : `apps/web/src/ui/**` (jetons sombres), écrans existants

## Règles

- Jetons sombres dans `jetons.ts` (même source unique), appliqués par `prefers-color-scheme` ; contraste AA vérifié par test pour les deux thèmes.
- En plein soleil, le thème clair reste le défaut conseillé ; un réglage dans l'onglet Ferme permet de forcer clair ou sombre.

## Critères d'acceptation

- [x] Captures e2e de chaque écran dans les deux thèmes.
- [x] Test de contraste sur toutes les paires des deux thèmes.

**Hors périmètre** : thème à fort contraste (plus tard si besoin).
