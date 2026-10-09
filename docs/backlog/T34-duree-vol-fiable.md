# T34 — Durée des vols de caméra mesurée de façon fiable

**Objectif** : que l'e2e « la caméra vole vers une zone, grande ferme de T07 » cesse d'échouer au hasard. Mesuré le 9 octobre (WebGL logiciel, 10 passages en série, verrou e2e) : 3 échecs sur 10 avant T32b comme après, durées moyennes identiques (498 et 500 ms), pires vols entre 705 et 728 ms pour une borne fixe de 700 ms (600 ms de vol + 100 ms de marge d'image). Les plants de T32b n'y sont pour rien ; la marge fixe est trop juste face à la gigue du rendu logiciel.

**Dépend de** : T29b (plancher mesuré), T33 (verrou e2e)
**Périmètre** : `apps/web/e2e/vue-3d-camera.e2e.ts` (mesure de la durée), `apps/web/e2e/fluidite-3d.ts` (aide commune si utile). Aucun code de l'appli.

## Règles

- **Même principe que T29b** : la marge au-delà de `DUREE_VOL_MAX_MS` (600 ms, inchangé) n'est plus une constante de 100 ms mais se déduit d'un intervalle d'image mesuré sur la machine au début du test (par exemple deux intervalles du plancher), bornée en haut (constante nommée, au plus 200 ms) pour qu'un vrai ralentissement échoue toujours.
- **Le test échoue toujours si** la durée dépasse 600 ms + 2 intervalles mesurés, ou si le plancher mesuré dépasse la limite de T29b (machine trop lente : échec explicite, pas de tolérance cachée).
- `DUREE_VOL_MAX_MS` (contrat de l'appli), `IMAGES_PERDUES_MAX`, `PASSAGES_SACCADES_ECHEC`, `RAFALES_TOTAL_MAX` inchangés.
- Le message d'échec donne la durée, le plancher mesuré et la marge appliquée.

## Critères d'acceptation

- [ ] Test : la marge calculée est bornée (plancher très lent → marge plafonnée, plancher absent → échec explicite).
- [ ] 10 passages en série du test T07 sur la machine de la boucle : 0 échec ; journal des durées, du plancher et de la marge joint à la PR.
- [ ] Un vol artificiellement ralenti (durée d'animation doublée dans une copie locale, non commitée) échoue toujours : preuve dans la PR.
- [ ] `pnpm verif` passe en entier.

## Risques

- Masquer une vraie régression : la borne haute de la marge et l'essai du vol ralenti l'empêchent.

**Hors périmètre** : changer la durée des vols dans l'appli, les garde-fous de fluidité de T29b.
