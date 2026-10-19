# T54 — Cahier de fertilisation : composition des engrais et bilan par planche

**Objectif** : demande de Théophane (2026-10-19). Les apports (compost, fumier, engrais) se saisissent déjà comme interventions « fertilisation » ou « amendement » avec produit et quantité, et figurent dans les travaux prévus. Il manque : la **composition** des produits (N, P₂O₅, K₂O en %), le **bilan** des unités apportées par planche et par saison, et le **cahier de fertilisation** exportable (exigé en zone vulnérable nitrates, utile au contrôle bio).

**Dépend de** : T22 (travaux prévus), T10 (journal), T15 (export) ; réponse à Q44 (points 1 et 2)
**Périmètre** : `packages/core` (calcul du bilan), `packages/db` (produits fertilisants, migration), `apps/api/src/sync/**`, `apps/web/src/ecrans/ferme/**`, `apps/web/src/ecrans/aujourdhui/**` (choix du produit dans la saisie), `apps/web/src/ecrans/export/**`, tests, `docs/modele-donnees.md`
**Priorité** : moyenne, après T52. **Modèle** : Opus (migration, synchro).

## Règles

1. **Produits fertilisants de la ferme** : nom, forme (solide/liquide), unité (kg, t, L, m³), teneurs N, P₂O₅, K₂O en % (facultatives), utilisable en bio. Liste de départ modifiable (compost de déchets verts, fumier de bovin, corne broyée, vinasse…) avec teneurs **moyennes citées de sources publiques**.
2. La saisie d'une fertilisation propose les produits de la ferme ; le texte libre actuel reste accepté (sans bilan).
3. **Bilan** (cœur, testé) : unités N/P/K = quantité × teneur, ramenées en kg/ha et totalisées par emplacement et par saison. Seuls les apports réalisés comptent ; les prévus s'affichent à part.
4. Vue « Fertilisation » sur la fiche d'une planche et cahier dans l'onglet Ferme ; export `cahier-fertilisation.csv`.
5. Aucune préconisation de dose par l'IA ni par le code dans ce ticket : on mesure ce qui a été apporté.

## Critères d'acceptation

- [ ] Tests cœur : 2 t de compost à 1 % N sur 100 m² → 20 kg N, soit 2 000 kg N/ha ; teneur absente → apport compté sans unités.
- [ ] Migration testée en intégration, rejouable ; interventions existantes intactes.
- [ ] Tests d'écran : choix du produit au doigt ; bilan affiché sur la planche.
- [ ] Export : `cahier-fertilisation.csv` ; `pnpm verif` passe.
