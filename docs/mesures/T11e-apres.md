# Mesure : Planches après T11e (maquette, marges de temps)

Mesure du 2026-10-11, après les corrections, dans les mêmes conditions que [`T11e-avant.md`](T11e-avant.md) : Chromium headless (Playwright 1.63), profil Pixel 7, CPU ralenti ×4, build des essais, ferme de T07 (30 zones, 400 planches, 3 000 occupations), hors ligne. Conteneur de développement, **pas un vrai téléphone**. Relancé par :

```sh
cd apps/web && MESURES_T11E=1 E2E_PORT_APPLI=4407 npx playwright test e2e/t11e-mesures.e2e.ts
```

## En bref

| Règle | Avant | Après | Test |
| --- | --- | --- | --- |
| « Planches », base prête (10 taps du test) | médiane 83 à 94 ms, pire 152 ms | **médiane 30 ms**, pire 52 ms | garde, passe |
| « Planches », base prête (mesure, 5 taps) | 104 à 164 ms (médiane 124) | **25 à 54 ms** (médiane 31) | — |
| Mise en page forcée dans la tâche du tap | 33 à 45 ms par tap (`get scrollTop`) | **0** | — |
| Défilement, 10 passages (test d'acceptation) | 1re exécution 0 saccadé ; 2e **2 saccadés** (rouge) | 3 exécutions : **1, 1, 1 saccadé**, 1 à 2 intervalles fautifs (vert) | passe |
| Double téléchargement (PowerSync + WASM) | 0 octet en double | 0 octet en double (2 350 733 o reçus une fois) | garde, passe |
| Premier tap dans la première seconde | médiane 633 ms | 505 à 589 ms (inchangé, sorti dans **T11g**) | retiré de T11e |
| Maquette : puces, surtitre, carte d'alerte | absents | présents | 6 tests sur 6 |

Aucun budget relevé : démarrage 71,1 Kio (budget 71,1), vue 3D 207,8 (207,9), éditeur de placement 20,3 (20,6). Tout le nouveau code est dans le morceau de l'écran Planches.

## Ce qui a changé et pourquoi

### « Planches » : la mise en page forcée a disparu

Le profil d'avant attribuait 33 à 45 ms par tap à une mise en page forcée : `fenetre()` lisait `scrollTop` et `clientHeight`, et l'effet de la semaine courante lisait `clientWidth` puis écrivait `scrollLeft`, juste après l'insertion des lignes.

- La position verticale est mémorisée dans l'événement de défilement, la taille de la vue par un `ResizeObserver` (et gardée d'une ouverture à l'autre). Tant qu'elle n'est pas mesurée, on prend `screen.height`, qui la majore : `window.innerHeight` forçait aussi la mise en page (vu au premier essai, 40 ms par tap dans la fonction de fenêtre).
- La semaine courante et la puce active sont placées dans la **première observation d'un `ResizeObserver`**, qui arrive après la mise en page et avant la peinture de la même image : pas de saut visible, rien de forcé. Un premier essai en `requestAnimationFrame` forçait encore 43 à 49 ms (lecture de `offsetLeft` avant la mise en page de l'image).
- Au premier rendu, la fenêtre de lignes est vide ; l'effet la remplit aussitôt, avant la peinture.

Après : dans l'image du tap, le script de React prend 16 à 54 ms, la mise en page 49 à 69 ms, une seule fois, à sa place normale. Du tap à la marque `planif:plan-affiche` : 25 à 54 ms.

### Défilement : moins de nœuds recréés

- Chaque ligne visible garde sa place (clé React) tant qu'elle reste dans la fenêtre ; la ligne qui entre reprend le nœud de celle qui sort (`attribuerPlaces`, `zones.ts`). Les barres d'une ligne sont clées par position. L'ordre des lignes dans le DOM reste celui du plan (lecteurs d'écran, tabulation) : React déplace le nœud réutilisé au lieu de le recréer.
- Profil cumulé des 10 passages : `removeChild` 1,1 s → 0,51 s ; `setAttribute` 0,6 s → 0,56 s ; `createElement` sort du haut du profil, `appendChild` (déplacement) 0,60 s.
- Ce qui reste : quelques images de 54 à 101 ms **sans aucun script** (rendu, rastérisation logicielle du conteneur), une ou deux par série de 10 passages. Elles ne viennent pas du code de l'écran.

Test d'acceptation, trois exécutions (au plus 1 passage saccadé sur 10, au plus 2 intervalles fautifs) :

| Exécution | Pire intervalle par passage (ms) | Saccadés | Fautifs |
| --- | --- | --- | --- |
| 1 | 33,4 · 33,4 · 50,0 · 33,4 · 33,4 · 16,8 · 66,6 · 33,4 · 33,4 · 33,3 | 1 | 1 |
| 2 | 33,4 · 33,4 · 33,4 · 66,7 · 33,4 · 50,0 · 33,4 · 33,4 · 33,4 · 33,4 | 1 | 1 |
| 3 (avant le dernier correctif) | 33,4 · 33,4 · 49,9 · 33,4 · 50,0 · 33,4 · 33,3 · 33,4 · 33,4 · 66,7 | 1 | 1 |

La marge reste mince (1 passage saccadé, limite à 2) : c'est le rendu du conteneur, pas le script.

`plan.e2e.ts`, dix passages (`--repeat-each=10`) : **10 sur 10**.

### Premier tap dans la première seconde : sorti dans T11g

Inchangé ici (505 à 589 ms du tap au plan, base prête vers 570 à 704 ms). Décision du chef : il faut montrer un instantané du plan avant la base, ce qui touche `App.tsx`, `main.tsx` et le budget de démarrage. Le test est recopié dans [`docs/backlog/T11g-plan-avant-base.md`](../backlog/T11g-plan-avant-base.md).

### Double téléchargement

Rien à corriger : 0 octet en double dans les cas A et B. La mesure 2 de `t11e-mesures.e2e.ts` échoue parfois sur `request.response: Worker closed` (une requête d'un worker fermé, lue après coup par l'outil de mesure) ; relancée, elle passe. Le test de garde `plan-premiere-visite.e2e.ts` n'a pas ce défaut et passe.
