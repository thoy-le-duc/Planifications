# T13d — Aujourd'hui : ouverture à froid sous 1 s sur une grande ferme

**Objectif** : sur la grande ferme de T13b (3 000 séries en cours), l'écran Aujourd'hui s'affiche en moins de 1 s au lancement à froid, CPU ×4.

**Dépend de** : T13b, T13c (Aujourd'hui n'attend plus Planches)
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/src/App.tsx`

## Constat (T13b)

- Les requêtes de la journée sont allégées : 854 ms → environ 120 ms sous Node, à résultats identiques.
- Dans le navigateur, CPU ×4, à froid : environ 5,3 s (8,8 s avant). Le coût restant est la première lecture des pages SQLite (vues JSON de PowerSync), avec un rapport navigateur/Node de ×45 à ×100. S'y ajoutent environ 750 ms d'attente de Planches (T13c).
- Le tap depuis Planches est déjà à 30 ms, grâce au cache de l'écran.
- Les requêtes seules ne tiendront pas 1 s.

## Piste recommandée (chef, 2026-10-01)

**Instantané de la journée** :
- au lancement, afficher tout de suite la dernière journée calculée, gardée sur le téléphone ;
- relire la base en arrière-plan, puis remplacer l'instantané ;
- l'instantané est daté : s'il date d'un autre jour, ou d'une autre ferme ou d'un autre utilisateur, il n'est pas montré ;
- toute saisie depuis l'instantané passe par la relecture. Rien n'est écrit depuis l'instantané, qui sert à l'affichage seulement.

Autre piste, plus lourde, non retenue pour l'instant : les tables « raw » de PowerSync (colonnes SQLite réelles au lieu de vues JSON). Elle changerait tout le schéma local et la synchro.

Piste complémentaire du développeur de T13b : sur le serveur, `origine_id` vaut l'id pour tout événement qui ne remplace rien. Avec `origine_id` dans l'index de la série et `coalesce(e.origine_id, e.id)` dans `EN_VIGUEUR`, les lignes synchronisées ne toucheraient plus les pages du journal. Le jeu de la grande ferme doit d'abord porter `origine_id` comme les vraies données.

## Critères d'acceptation

- [ ] Grand jeu de T13b, CPU ×4 : Aujourd'hui affiché en moins de 1 s à froid (médiane de 5), mesure e2e redevenue bloquante.
- [ ] Un instantané d'un autre jour, d'une autre ferme ou d'un autre utilisateur n'est jamais montré (tests).
- [ ] « Fait » depuis l'instantané : la saisie part bien, et la journée relue la confirme (test).
