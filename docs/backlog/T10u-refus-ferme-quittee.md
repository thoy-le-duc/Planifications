# T10u — Refus d'une ferme quittée effacés du téléphone

**Objectif** : quand quelqu'un quitte une ferme (ou en est retiré), plus rien de cette ferme ne reste sur son téléphone, refus de synchro compris (Q25).

**Dépend de** : T10k
**Périmètre** : `apps/web/src/donnees/**`, `packages/sync/**` (refus), `apps/web/src/connexion/**`

## Règles

- À la perte de l'adhésion (détectée par la synchro), les refus de synchro liés à cette ferme sont effacés de la base locale, avec leur résumé (noms de cultures…).
- Les refus restent hors de l'export complet (règle T15, confirmée le 2026-10-07).

## Critères d'acceptation

- [x] Test : un membre retiré d'une ferme ne voit plus aucun refus de cette ferme, même hors ligne au moment du retrait (effacé à la prochaine synchro).
- [x] Test : les refus d'une autre ferme dont il reste membre ne bougent pas.
