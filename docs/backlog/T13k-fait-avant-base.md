# T13k — Aujourd'hui : « Fait » accepté avant la base

**Objectif** : au lancement, un « Fait » tapé sur l'instantané (avant l'ouverture de la base) n'est jamais perdu ni ignoré.

**Dépend de** : T13g
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`

## Constat (relecture T13g)

Avant la base, les boutons sont inactifs : un tap entre ≈ 0,4 s et ≈ 1 s ne fait rien, sans message. Dessiner l'instantané retarde l'ouverture de la base de 200 à 270 ms (CPU ×4).

## Règles (Q26 acceptée le 2026-10-07)

- « Fait » actif dès l'instantané : la carte est masquée au tap, la file attend la porte, puis lecture ciblée et vérification `DejaFait` comme aujourd'hui.
- Si la vraie ferme diffère de la ferme montrée, les « Fait » en attente sont abandonnés avec un message, jamais écrits sur une autre ferme.

## Critères d'acceptation

- [ ] e2e grande ferme CPU ×4 : trois « Fait » tapés avant la base → trois réalisés, aucun perdu, aucun en double.
- [ ] Test : ferme montrée ≠ ferme réelle → rien n'est écrit, message affiché.
