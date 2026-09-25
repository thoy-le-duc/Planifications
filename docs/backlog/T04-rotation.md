# T04 — Alertes de rotation

**Objectif** : empêcher de remettre une culture trop tôt au même endroit, en tenant compte de plusieurs années d'historique, y compris celles d'avant l'appli.

**Dépend de** : T03
**Périmètre** : `packages/core/src/planification/rotation.ts` et ses tests

## Règles métier

- Délais applicables à une culture prévue : ceux de son **espèce** s'ils sont remplis, sinon ceux de sa **famille** (délai minimal et délai conseillé, en années).
- Historique pris en compte pour un emplacement E : les occupations passées sur E et sur les emplacements que E remplace (lien « remplace », de proche en proche), plus les lignes d'assolement **passé** (saisi ou importé) posées sur E, sur sa chapelle ou sur sa zone (tous les niveaux au-dessus de E).
- Une ligne d'historique compte si elle est de la **même famille** que la culture prévue.
- Écart = année de mise en place prévue − année de la ligne d'historique (année de fin d'occupation, ou saison de l'assolement).
- Alerte **rouge** si écart < délai minimal ; **orange** si délai minimal ≤ écart < délai conseillé ; rien sinon. Chaque alerte cite la ligne d'historique en cause (culture, année, emplacement ou zone).
- L'assolement **prévu** n'entre pas dans ce calcul.

Exemple de référence : choux (espèce : minimal 4 ans, conseillé 6 ans ; famille brassicacées). Assolement passé : brassicacées sur toute la chapelle C3 en 2023. Choux prévus sur la planche C3-P02 :

| Année prévue | Écart | Alerte |
| --- | --- | --- |
| 2026 | 3 | rouge |
| 2027 | 4 | orange |
| 2028 | 5 | orange |
| 2029 | 6 | aucune |

## Critères d'acceptation

- [ ] `alertesRotation(culturePrevue, emplacement, anneeMiseEnPlace, historique, hierarchie)` pure, sans accès aux données.
- [ ] Le tableau ci-dessus en test.
- [ ] Tests : délais de la famille utilisés quand l'espèce n'en a pas ; radis (brassicacée) en 2025 sur C3-P02 déclenche l'alerte pour des choux en 2027 ; ligne posée sur une autre chapelle ignorée ; historique hérité d'une planche redessinée via « remplace » ; assolement prévu ignoré ; plusieurs lignes en cause renvoyées en une seule alerte, la plus grave d'abord.

**Hors périmètre** : délais par défaut de la bibliothèque (ils viendront avec l'import, T14), interface.
