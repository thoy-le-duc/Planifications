# T83 — Tunnel posé aux mesures de Théophane : 40 m × 9,60 m

**Objectif** : réponse de Théophane à Q50 (2026-10-23) : « la taille type des tunnels, 40 mètres de long sur 9 m 60 ». « Placer la serre » (T81) propose aujourd'hui 30 m × 8 m quand la ferme n'a encore aucun tunnel : le premier tunnel se pose donc toujours à la mauvaise taille.

**Dépend de** : T81
**Périmètre** : `apps/web/src/ecrans/placement/serre-zone.ts`, tests de `apps/web/src/ecrans/placement/**`
**Priorité** : haute (le placement réel de la ferme attend). **Domaine critique** : non (aucune table, aucun droit, aucune synchro touchés).

## Règles

1. Zone **tunnel** sans bâtiment, ferme sans aucune serre tunnel : « Placer la serre » propose **40 m × 9,6 m** (au lieu de 30 × 8).
2. Zone **serre** (serre chapelle), ferme sans serre chapelle : 30 m × 8 m, inchangé (les grandes serres font l'objet d'une question à part, Q54).
3. Inchangé : dès que la ferme a un bâtiment du même type, ce sont les mesures du dernier qui sont proposées (T81, règle 2).

## Critères d'acceptation

- [ ] Test : ferme sans bâtiment, zone tunnel → 40 m × 9,6 m proposés.
- [ ] Test : ferme sans bâtiment, zone serre → 30 m × 8 m proposés.
- [ ] Test : ferme avec un tunnel de 50 × 8 → 50 × 8 proposés pour le suivant.
- [ ] Les tests de T81 qui attendaient 30 × 8 pour un tunnel sont mis à jour, et la PR le justifie (changement voulu par Théophane, Q50).
- [ ] `pnpm verif` passe.

## Hors périmètre

Grandes serres découpées en zones d'irrigation (Q54). Rangement des planches dans la serre (Q54).
