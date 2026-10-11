# Mesure : Planches avant T11e (ouvrir la base plus tôt, double téléchargement, marges, maquette)

Mesure du 2026-10-10, avant toute correction. Le test de mesure est `apps/web/e2e/t11e-mesures.e2e.ts`. `pnpm e2e` l'ignore ; pour le relancer, construire d'abord avec `pnpm build:essais`, puis :

```sh
cd apps/web && MESURES_T11E=1 E2E_PORT_APPLI=4407 bash ../../scripts/verrou-e2e.sh npx playwright test e2e/t11e-mesures.e2e.ts
```

Les tests d'acceptation sont `e2e/plan-performances.e2e.ts`, `e2e/plan-premiere-visite.e2e.ts` et `e2e/plan-maquette.e2e.ts`.

## En bref

| Règle | Mesure avant | Règle tenue ? | Test |
| --- | --- | --- | --- |
| Premier tap sur Planches dans la première seconde | **571 à 694 ms** (médiane 633 ms) | non | échoue (budget 300 ms) |
| Double téléchargement de PowerSync et du WASM | **0 octet en double** (2,35 Mo reçus une fois) | oui | garde, passe |
| Planches, base prête | **62 à 164 ms** (médiane 83 à 124 ms), 313 ms vu une fois sous charge (T11b) | oui, avec de la marge | garde, passe (10 taps, chacun < 300 ms) |
| Pire image au défilement | 1re exécution du test : 33 à 50 ms, 0 passage saccadé ; 2e : **2 passages à 66,7 ms** | une fois sur deux | rouge par intermittence (au plus 1 passage saccadé sur 10) |
| Maquette Plan : puces, surtitre, carte d'alerte | **absents** de l'écran | non | échoue (4 tests sur 5) |

## Conditions

- Chromium headless (Playwright 1.63), profil Pixel 7. Conteneur de développement à 4 cœurs Xeon 2,1 GHz, sans autre e2e en parallèle. **Ce n'est pas un vrai téléphone.**
- CPU ralenti ×4 (`Emulation.setCPUThrottlingRate`). Comme pour T07, ce ralentissement ne touche que le fil principal de la page, pas le worker où tourne SQLite.
- Build des essais (`dist-essais`), ferme de T07 (30 zones, 400 planches, 3 000 occupations) amorcée par `/diagnostic/amorcer.html`. Appli servie par le service worker, **hors ligne**, sauf pour la mesure 2.
- Temps en ms depuis le début de la navigation (`performance.now()`), 5 répétitions, chacune après un rechargement hors ligne.

## 1. Ouvrir la base plus tôt

### Chronologie du lancement, base de T07, sans tap

Ce sont les instants de début et de fin, en ms. La répétition 1 est à froid, juste après l'installation.

| Étape | Rép. 1 | Rép. 2 | Rép. 3 | Rép. 4 | Rép. 5 |
| --- | --- | --- | --- | --- | --- |
| `index.js` (démarrage) | 74→80 | 69→77 | 65→71 | 56→62 | 84→90 |
| écran Aujourd'hui (morceau) | 242→249 | 148→155 | 111→120 | 109→116 | 203→208 |
| **marque `app-prete`** | 249 | 153 | 121 | 114 | 210 |
| `import(appli.ts)` + `effacer.ts` (et morceau Planches) | 256→268 | 160→166 | 128→138 | 116→125 | 212→228 |
| `indexedDB.databases()` (appel → réponse) | 375→454 | 224→268 | 275→331 | 199→215 | 267→304 |
| `import(base-appli.ts)` (PowerSync) | 458→462 | 271→276 | 334→342 | 216→223 | 307→312 |
| `new Worker` (PowerSync) | 478 | 294 | 360 | 273 | 326 |
| worker → VFS → wa-sqlite → **WASM** reçu | 571 | 357 | 445 | 314 | 369 |
| **`data-base="prete"`** | **884** | **619** | **666** | **564** | **606** |

Ce qu'on lit dans ce tableau :

- Rien ne part avant la marque `app-prete`. `import(appli.ts)` attend le premier rendu de la coquille, dans un `useEffect` de `App.tsx`, donc 110 à 250 ms après la navigation.
- Entre la fin de `appli.ts` et l'appel de `indexedDB.databases()`, il se passe **16 à 137 ms**. `effacementEnCours` est pourtant immédiat. Ce temps est celui du fil principal, occupé par le rendu d'Aujourd'hui (instantané) et le chargement du morceau Planches.
- `databases()` met 16 à 79 ms à répondre.
- Les étapes sont strictement enchaînées : `appli.ts`, puis `databases()`, puis `base-appli.ts`, puis le worker, puis le WASM. Le WASM est servi en 5 à 8 ms par le service worker.
- **Du WASM reçu à la base prête : 250 à 310 ms.** C'est le plus gros poste. Il couvre l'initialisation de SQLite dans le worker, l'ouverture d'IndexedDB, le schéma et la ferme active.

**Gain possible en parallélisant** : lancer `import(appli.ts)`, `databases()` et `import(base-appli.ts)` dès la lecture de la session (`main.tsx`) plutôt qu'après le premier rendu, et précharger le worker. Cela avancerait la base prête d'environ **100 à 250 ms**, vers 450 à 650 ms. Cela ne suffit pas pour la règle (voir plus bas).

### Premier tap sur Planches dans la première seconde, base pas encore prête

Le temps mesuré va du `pointerdown` à la marque `planif:plan-affiche`.

| Tap | Rép. 1 | Rép. 2 | Rép. 3 | Rép. 4 | Rép. 5 |
| --- | --- | --- | --- | --- | --- |
| dès `app-prete` (tap à 376–547 ms) | 633 | 694 | 571 | 621 | 663 |
| vers 560–620 ms | 493 | 457 | 463 | 377 | 436 |

Le premier tap dès `app-prete` vaut **médiane 633 ms** pour un budget de 300 ms. La première mesure (`t11e-mesures`) donnait 576 à 675 ms. Q19 parlait de 0,7 à 0,8 s.

Ce qui coûte, après la base prête :

- **Entre la base prête et le plan dessiné, il faut encore 290 à 420 ms.** Pendant ce temps, l'appli lit le début du plan (12 emplacements et leurs occupations), et la journée d'Aujourd'hui est relue en même temps. Elle attend au plus 400 ms le début du plan (`ATTENTE_PLAN_MAX_MS`).
- Même avec une base prête dès 0 ms, un tap à 400 ms afficherait le plan vers 700 ms.

**Conclusion** : ouvrir la base plus tôt est utile (−100 à −250 ms), mais **la règle des 300 ms « même base non prête » ne se tient qu'en affichant le plan sans attendre la base**. Ce serait un instantané du début du plan, gardé sur le téléphone comme celui d'Aujourd'hui (T13d/T13g) : par utilisateur et par ferme, jamais montré à un autre, effacé à la déconnexion. Il serait ensuite remplacé par le plan relu.

Périmètre : `App.tsx` ne monte l'écran Planches que si `donnees.ferme !== null`, sinon il affiche « Ouverture des données… ». Il faudra donc toucher `App.tsx`, et `main.tsx` pour l'ouverture anticipée. Ces deux fichiers sont **hors du périmètre du ticket** (`src/donnees/**`, `src/ecrans/plan/**`). C'est au chef de trancher.

## 2. Double téléchargement à la première visite

Deux cas ont été mesurés, chacun dans un contexte de navigateur neuf. La base est amorcée, le cache HTTP vidé, le CPU ralenti ×4. Les relevés réseau couvrent la page, ses workers et le service worker.

- **A**, session et base déjà là : la page ouvre la base tout de suite, et le service worker précache au repos.
- **B**, connexion pendant l'installation : la page se recharge connectée dès que l'enregistrement du service worker est lancé.

| Fichier (`assets/sqlite/`) | Page | Précache |
| --- | --- | --- |
| `wa-sqlite-async-*.wasm` | 2 256 849 o | **0 o** (200, cache HTTP) |
| `base-appli-*.js` (PowerSync) | 39 895 o | 0 o |
| `wa-sqlite-async-*.js` | 20 688 o | 0 o |
| `IDBBatchAtomicVFS-*.js` | 4 085 o | 0 o |
| `FacadeVFS-*.js` | 1 940 o | 0 o |
| `worker-*.js` | (taille non relevée) | 0 o |
| `preparation.worker-*.js` | non chargé | 27 274 o |

Les chiffres sont identiques dans les cas A et B : **2 350 731 octets reçus du réseau, 0 octet en double.**

Pourquoi il n'y a pas de doublon :

- vite-plugin-pwa donne une révision nulle aux fichiers hachés. Workbox les précache donc sans `cache: 'reload'`.
- Le cache HTTP du navigateur rend au précache ce que la page vient de recevoir. Avec `vite preview`, qui envoie `Cache-Control: no-cache`, c'est au plus une revalidation (304, sans corps). Avec Vercel, qui envoie `max-age=31536000, immutable` pour `/assets/`, il n'y a aucune requête.

**Règle déjà tenue** : rien à corriger. Le test `plan-premiere-visite.e2e.ts` est une garde. Il échouera si un réglage fait recevoir deux fois ces 2,3 Mo : révision ajoutée aux fichiers, en-têtes de cache, cache vidé entre la page et le précache.

Limite : sur un téléphone dont le cache HTTP est plein, le navigateur peut évincer le WASM de 2,2 Mo avant la fin du précache. Ce n'est pas mesurable ici.

## 3. Marges des temps

### « Planches », base prête : 313 ms en T11b

| Série | Valeurs (ms) | Médiane |
| --- | --- | --- |
| mesure, profileur actif (5 taps) | 124, 104, 117, 164, 137 | 124 |
| test d'acceptation (10 taps) | 103, 91, 82, 84, 87, 88, 106, 98, 101, 109 | 94 |
| test d'acceptation, 2e exécution | 81, 77, 83, 62, 81, 99, 152, 84, 103, 115 | 83 |

Sans charge, il reste plus de 130 ms de marge. Les 313 ms de T11b n'ont pas été reproduits : ils venaient d'une machine chargée.

Ce qui coûte, d'après les images longues (Long Animation Frames) :

- Une image longue de **66 à 96 ms** pendant le tap, dans une tâche de React (`MessagePort.onmessage`, ordonnanceur).
- Dans cette image, **37 à 44 ms de mise en page forcée**. Le profil CPU l'attribue à `get scrollTop` : 165 ms sur 5 taps, environ 33 ms par tap. La cause est la lecture de `scrollTop` et `clientHeight` dans `fenetre()` et dans le `useLayoutEffect` qui place la semaine courante (`clientWidth`, `scrollLeft`), juste après l'insertion des lignes.
- Cette mise en page aurait lieu de toute façon avant la peinture. La forcer plus tôt ne la rend pas plus chère. On la réduit en allégeant ce qui est mis en page : moins d'éléments par ligne et par barre, `contain` sur les lignes, en-tête des semaines.
- La lecture du plan complet après l'affichage coûte aussi, dans la page, 40 à 60 ms de traitement des résultats de PowerSync (`base-appli` : `getAll`, `next`, fonction anonyme). La journée d'Aujourd'hui en coûte 15 à 30.

### Défilement : pire image de 50,1 ms en T11b

Le test d'acceptation, sans profileur, fait 10 passages à 40 px par image, plan complet lu :

- pire intervalle par passage : 50,1 · 50,0 · 50,0 · 33,4 · 33,4 · 50,0 · 50,0 · 33,4 · 33,3 · 49,9 ms ;
- **0 passage saccadé, 0 intervalle au-delà de 2 images perdues.**

Seconde exécution du même test : 50,0 · 33,4 · 33,4 · **66,7** · 33,4 · 33,4 · 33,4 · **66,6** · 33,4 · 33,3 ms, soit **2 passages saccadés sur 10** et 2 intervalles fautifs. Le test échoue, puisqu'il tolère au plus 1 passage saccadé. La règle « dix passages sans dépassement » n'est donc tenue qu'une fois sur deux : la marge manque.

La mesure faite avec le profileur CPU actif, qui ajoute sa propre charge, donnait 2 passages saccadés sur 10 (133 et 66,7 ms). Deux causes y apparaissent :

- un message de PowerSync traité **123 ms** dans la page (`base-appli`, `MessagePort.onmessage`), au début du premier passage, quand le plan complet arrive ;
- des images dont le **rendu** (style, mise en page, peinture) prend 39 à 62 ms, avec peu de script.

Le profil cumulé du défilement montre `removeChild` (1,1 s sur 10 passages), `setAttribute` (0,6 s) et `createElement`. C'est le renouvellement des lignes virtualisées à chaque pas de 40 px.

**Règle tenue une fois sur deux** : le test est rouge par intermittence aujourd'hui. Pistes :

- garder les éléments des lignes plutôt que les recréer (clés stables par position) ;
- `contain: layout paint` sur les lignes ;
- découper le traitement du plan complet pour qu'il n'arrive pas en une seule tâche de 120 ms.

## 4. Maquette Plan

La maquette existe dans le dépôt : `docs/maquettes/Plan.dc.html`, validée par Théophane le 2026-09-29 (Q16, `docs/maquettes/LISEZMOI.md`). Elle montre, pour un téléphone de 390 × 844 :

- **surtitre** « TUNNEL 2 · 6 PLANCHES · 30 M » : IBM Plex Mono 13 px, `#B9D3C2`, dans l'en-tête vert, avec « Hors ligne OK » à droite ;
- **puces de zone** « Tunnel 2 » (active, fond clair), « Tunnel 1 », « Plein champ » : 14 px gras, rayon 999 px, padding de 8 × 14 px, soit environ 36 px de haut ;
- **carte d'alerte** sous la légende : bord gauche orange de 8 px (`#E0701F`), « T2-P03 · CHOU POINTU FILDERKRAUT » (mono 13 px, `#9A4A0F`), « Plantation prévue le 12 avril, pas encore faite » (18 px gras), puis « Récolte décalée au 28 juin si plantée cette semaine. Calcul du moteur, pas de l'IA. » (15 px).

Aucun de ces trois éléments n'existe dans `src/ecrans/plan/EcranPlan.tsx`. Le surtitre de l'en-tête (`EnTete`, `App.tsx`) n'est posé que pour Aujourd'hui.

La maquette ne montre qu'une zone de 6 planches et ne dit pas tout. **Points tranchés par le testeur dans `plan-maquette.e2e.ts`, à confirmer par le chef :**

1. **Les puces naviguent, elles ne filtrent pas.** Toucher une puce amène la zone en haut du plan, et la puce active suit la première ligne visible. Filtrer casserait `plan.e2e.ts`, qui parcourt les 400 planches. Avec 30 zones (jeu de T07), la rangée défile d'elle-même. Les puces sont dans l'ordre du plan, et non dans celui de la maquette (Tunnel 2, Tunnel 1, Plein champ), qui n'est qu'un exemple.
2. **Les cibles des puces font au moins 44 px**, contre environ 36 px dans la maquette, pour les gants (principe du projet).
3. **« 30 M » est le total des longueurs des planches de la zone** (mètres de planche), au format français, au plus une décimale. Il pourrait aussi s'agir de la longueur commune des planches. Le jeu de T07 mélange les longueurs (15 à 50 m) : la question est à poser à Théophane si le chef doute.
4. **La carte d'alerte porte sur une culture prévue dont la date de début est passée sans réel.** Le test accepte n'importe laquelle de ces cultures ; l'ordre de choix (la plus récente, la plus ancienne ?) reste à décider. La phrase « Récolte décalée au … si plantée cette semaine » demande un calcul du moteur qui n'existe pas encore. Elle est hors du test et fait l'objet d'un ticket de suite proposé.
5. Le surtitre peut vivre dans l'écran Planches, au-dessus du plan, plutôt que dans l'en-tête de la coquille : `App.tsx` est hors du périmètre. Le test n'exige que « au-dessus du plan ».

## Ce qui est faisable sans relever le budget de démarrage

Il reste 2 octets de marge sur le démarrage : 72 804 octets pour une limite de 72 806.

- **Maquette** : les puces, le surtitre et la carte vivent dans le morceau de l'écran Planches, qui est chargé à la demande. Aucun coût au démarrage.
- **Marges des temps** : les corrections se font dans `ecrans/plan/`. Aucun coût au démarrage.
- **Double téléchargement** : rien à faire.
- **Premier tap sous 300 ms** : il faut changer `App.tsx` (monter Planches avant la base, avec un instantané) et sans doute `main.tsx` (ouverture anticipée). Ces deux fichiers sont dans le JavaScript de démarrage. Quelques dizaines d'octets compressés de plus y sont presque certains, donc il faudra soit les compenser, soit relever le budget avec justification.
  - Pour compenser, une piste : déplacer la lecture de l'instantané et la logique de « préparation » (`prechargerPlan`, `prechargerJournee`, `ATTENTE_PLAN_MAX_MS`) de `App.tsx` vers `donnees/appli.ts`, qui est chargé à la demande.
  - Ouvrir la base plus tôt seule se fait à coût presque nul : l'`import()` part de `main.tsx` au lieu de l'effet. Mais elle ne gagne que 100 à 250 ms et ne tient pas la règle.
