# T51 — Hors-sol : gouttières en pains, trous par pain selon la variété

**Objectif** : retour de Théophane (2026-10-19). Le « nombre de places » d'une gouttière (T49, modèle §1) est faux dès qu'on change de variété : le nombre de plants dépend **du nombre de pains** sur la gouttière (en général 1 pain = 1 m) **et des trous par pain, qui dépendent de la variété** (Gariguette 12, Manon ou Dream 10). Et un trou peut recevoir **plusieurs graines** (haricots semés derrière les fraises dans les mêmes pains). Il veut « simple et universel ».

**Dépend de** : T49 (parcellaire), T05 (besoins en semences), T12 (séries), T43 (densité)
**Périmètre** : `packages/core` (densité et calcul des plants et des besoins), `packages/db` (colonne ou clé jsonb, migration si besoin), `apps/api/src/sync/**` (validation), `apps/web/src/ecrans/parcellaire/**`, `apps/web/src/ecrans/itineraires/**`, `apps/web/src/ecrans/serie/**`, tests, `docs/modele-donnees.md`
**Priorité** : haute (hors-sol = cœur de la ferme de Théophane).

## Règle (modèle universel « contenants »)

1. **Emplacement de sorte gouttière** : « nombre de pains » (contenants : pains, sacs, pots) remplace « nombre de places ». Par défaut = longueur arrondie (1 pain par mètre), modifiable. Les gouttières existantes : nombre de pains = ancien nombre de places / 12 arrondi ? **Non** — reprendre l'ancien nombre de places comme nombre de **trous** n'a pas de sens : migration = nombre de pains = longueur arrondie, l'ancien nombre de places est conservé en lecture (champ obsolète) jusqu'à décision de Théophane.
2. **Nouvelle façon de compter la densité dans l'itinéraire : « en contenants »** (hors-sol) : trous par contenant (ex. 12) et, par trou, soit plants par trou (plant maison/acheté, défaut 1), soit graines par trou (semis direct, ex. 3 pour des haricots). Utilisable sur une gouttière ; sur une planche, refusée avec un message clair.
3. **Calcul** : plants (ou poquets) d'une série = Σ sur ses gouttières de (pains × trous par pain) ; graines = poquets × graines par trou (puis germination et marge comme T05). Les autres façons de compter (écartement, mètre linéaire, volée) ne changent pas.
4. **Bibliothèque** : ajouter un itinéraire « Fraise hors-sol en gouttière » (trous par pain 12 par défaut, à adapter par variété ; sources publiques) par une nouvelle migration de bibliothèque (T41b).
5. **Écrans** : création/modification de gouttière (« Nombre de pains », aide « 1 pain ≈ 1 m ») ; itinéraire (« Trous par pain », « Plants par trou » ou « Graines par trou ») ; série : nombre de plants calculé affiché ; au doigt.

## Critères d'acceptation

- [ ] Tests cœur : 2 gouttières de 30 pains, 12 trous, 1 plant → 720 plants ; 10 trous → 600 ; semis direct 3 graines par trou, germination 80 %, marge 10 % → graines attendues.
- [ ] Test : densité « en contenants » refusée sur une planche (message en français).
- [ ] Tests serveur : nouvelle densité acceptée et validée comme le cœur ; gouttière avec nombre de pains.
- [ ] Tests d'écran : saisie au doigt des pains et des trous ; nombre de plants calculé dans la série.
- [ ] Migration(s) testée(s) en intégration, rejouables ; aucune ligne de ferme cassée.
- [ ] `pnpm verif` passe.
