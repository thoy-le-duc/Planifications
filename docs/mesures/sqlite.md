# Mesure : SQLite PowerSync sur téléphone simulé (T07)

Mesure du 2026-09-25. Page `/mesures/sqlite.html`, test `apps/web/e2e/mesure-sqlite.e2e.ts`.

## En bref

- **Variante recommandée : raw tables.** La requête de la vue 2D y est deux fois plus rapide que sur les vues JSON (73 ms contre 161 ms), le reste est égal.
- **Le budget de 300 ms (ouverture + requête 2D) n'est pas tenu de façon fiable.** Dans les conditions du test, les raw tables passent de justesse (médiane 293 ms, de 243 à 318 ms ; 415 ms pendant `pnpm verif`), et les vues JSON dépassent (372 ms).
- **Le test sous-estime le vrai coût.** Le ralentissement CPU ×4 de Chrome ne touche que le fil principal de la page, pas le worker où tourne SQLite. Quand SQLite tourne lui aussi sous le ralentissement, les deux variantes dépassent : 426 ms en raw, 566 ms en JSON.
- **Pistes chiffrées :**
  - OPFS au lieu d'IndexedDB : raw passe à 237 ms (worker non ralenti) ;
  - ouvrir la base au lancement, pendant l'affichage de l'appli : il ne reste que la requête sur le budget d'un écran, de 53 à 162 ms.

## Conditions

- Chromium 141 headless (Playwright), profil Pixel 7, conteneur de développement au CPU partagé. **Pas un vrai téléphone.**
- CPU ralenti ×4 par `Emulation.setCPUThrottlingRate`, le profil « mobile milieu de gamme » de Lighthouse.
- `@powersync/web` 2.4.1, base locale sans serveur (`connect()` n'est jamais appelé), worker dédié (`enableMultiTabs: false`, déjà le défaut du SDK sur Android).
- VFS par défaut du SDK : `IDBBatchAtomicVFS` (IndexedDB), qui charge le WASM « async » (asyncify). OPFS (`OPFSCoopSyncVFS`) est mesuré à part pour comparer.
- Jeu `genererFerme(42)` : 30 zones, 400 emplacements, 5 saisons (2022 à 2026), 3 000 séries, 3 000 occupations et 30 000 événements.
- Chargement en lots de 2 000 lignes par `writeTransaction` (non chronométré) : environ 6 à 8 s en IndexedDB avec worker, 12 s en OPFS.
- La page se recharge ensuite. La mesure part donc d'une page neuve : nouveau worker, WASM relu depuis le cache HTTP, base fermée puis rouverte.
- Chaque passage a son propre contexte de navigateur, donc un stockage vide. Médiane de 5 passages par configuration.

Les quatre temps sont mesurés avec `performance.now()` dans la page, aller-retour vers le worker compris :

1. **Ouverture** : `new PowerSyncDatabase(...)` puis `init()`. Cela comprend le démarrage du worker, le WASM, l'ouverture du fichier et la vérification du schéma.
2. **Requête 2D** : les occupations qui chevauchent la saison 2024, jointes à l'emplacement, la zone, la série et la famille, triées par zone, planche et date. Elle ramène 674 lignes.
3. **Semainier** : pour la semaine du 10 au 16 juin 2024, les événements, les mises en place et les fins d'occupation, avec l'espèce et la planche. Elle ramène 170 lignes.
4. **Insertion** d'un événement, déclencheur de la file d'envoi compris.

## Résultats (ms, médiane de 5 passages, CPU ×4)

### Configuration de l'appli, celle du test : worker + IndexedDB

Seul le fil principal est ralenti, pas le worker : ces chiffres sont **optimistes**.

| Variante | Ouverture | Requête 2D | Ouverture + 2D | Semainier | Insertion |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON (vues PowerSync) | 225 | 161 | **372** (333 à 750) | 103 | 30 |
| Raw tables | 219 | 73 | **293** (243 à 318) | 66 | 34 |

Pendant `pnpm verif`, avec la machine plus chargée, on a relevé en un seul passage : JSON 287 + 195 = 482 ms, raw 301 + 114 = 415 ms.

### SQLite aussi ralenti : fil principal (`&fil=page`) + IndexedDB

Cette configuration met SQLite sur le fil principal, donc sous le ralentissement ×4. C'est **l'estimation la plus proche d'un téléphone lent**. Elle est un peu pessimiste pour les requêtes : tout se joue sur un seul fil. Elle économise en revanche le démarrage du worker.

| Variante | Ouverture | Requête 2D | Ouverture + 2D | Semainier | Insertion |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 313 | 253 | **566** (545 à 658) | 182 | 44 |
| Raw tables | 290 | 162 | **426** (416 à 461) | 139 | 46 |

### Piste : OPFS (`&vfs=opfs`, `OPFSCoopSyncVFS`) + worker

Mêmes conditions que le test, donc optimiste aussi.

| Variante | Ouverture | Requête 2D | Ouverture + 2D | Semainier | Insertion |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 186 | 80 | **264** (251 à 337) | 49 | 54 |
| Raw tables | 181 | 53 | **237** (205 à 260) | 47 | 48 |

### Repère sans ralentissement (CPU ×1, 3 passages)

| Configuration | Ouverture | Requête 2D |
| --- | ---: | ---: |
| JSON, worker, IndexedDB | 174 | 94 |
| Raw, worker, IndexedDB | 151 | 81 |
| JSON, fil principal, IndexedDB | 106 | 72 |
| Raw, fil principal, IndexedDB | 62 | 49 |

Avec le worker, les temps changent peu entre ×1 et ×4 (JSON : 174 → 225 ms à l'ouverture). Sur le fil principal, ils triplent ou quadruplent. C'est la preuve que le ralentissement ne s'applique pas au worker. La boucle d'étalonnage de la page (`etalonCpuMs`, de 13 à 17 ms à ×4 contre 4 à 7 ms à ×1) montre que le ralentissement reste bien actif après le rechargement.

## Variante recommandée : raw tables

- **Requête 2D divisée par deux** (161 → 73 ms, et 253 → 162 ms quand SQLite est ralenti), **semainier −25 à −35 %**. Une vue JSON extrait chaque colonne avec `json_extract` à chaque ligne et à chaque jointure. Une raw table lit la colonne directement.
- **Ouverture et insertion au même niveau.** Le déclencheur `powersync_create_raw_table_crud_trigger` alimente la file d'envoi comme les vues JSON.
- **Vraies tables** : types `STRICT`, index choisis librement (composés, sur expression), contraintes locales possibles.
- **Coût** :
  - on écrit nous-mêmes le `CREATE TABLE`, les index et les déclencheurs, et on les fait évoluer à chaque changement de schéma (migrations locales à prévoir dans T08 et T10) ;
  - les raw tables ne sont pas compatibles avec les « High Performance Diffs » du SDK JS.

  `docs/choix-synchro.md` prévoyait déjà ce passage « pour les tables les plus lues ».

Détail de la variante raw dans le code (`apps/web/src/mesures/schema-sqlite.ts`) :

- `Schema.withRawTables({ <table>: { schema: {} } })`, avec les instructions de synchro déduites de la table ;
- `CREATE TABLE IF NOT EXISTS ... STRICT` et `CREATE INDEX` exécutés par nous ;
- trois déclencheurs par table (INSERT, UPDATE, DELETE) générés par `powersync_create_raw_table_crud_trigger`.

Index des deux variantes :

- `emplacement(zone_id)` ;
- `serie(saison_id)`, `serie(famille_id)` ;
- `occupation(serie_id)`, `occupation(emplacement_id)`, `occupation(du)`, `occupation(au)` ;
- `evenement(date)`, `evenement(serie_id)`, `evenement(emplacement_id)`.

## Poids du WASM et du code SQLite

Aujourd'hui, **rien de SQLite n'entre dans le cache du service worker.** La page de mesure et le code SQLite sont rangés dans `assets/mesures/` et `assets/sqlite/`, exclus du précache. Le précache de l'appli reste à 6 entrées (215,6 Kio). La seule nouveauté est `modulepreload-polyfill` (0,4 Kio gzip), que Vite sépare dès qu'il y a deux pages HTML. Le budget de démarrage est inchangé : 66,7 Kio gzip sur 90.

Quand l'appli utilisera la base (T10), voici ce qu'il faudra ajouter au cache, fichiers réellement chargés par la page :

| Fichier | IndexedDB (défaut) brut / gzip | OPFS brut / gzip |
| --- | ---: | ---: |
| WASM SQLite + PowerSync | `wa-sqlite-async.wasm` : 2 204 / **760** Kio | `wa-sqlite.wasm` : 1 082 / **498** Kio |
| Code d'appui de wa-sqlite | 62,3 / 20,1 Kio | 58,6 / 19,0 Kio |
| Worker PowerSync | 76,4 / 23,1 Kio | 76,4 / 23,1 Kio |
| VFS (+ FacadeVFS 6,2 / 1,9) | 12,8 / 4,0 Kio | 7,5 / 2,4 Kio |
| **Total dans le cache** | **2 362 Kio brut, 809 Kio gzip** | **1 231 Kio brut, 545 Kio gzip** |

À cela s'ajoute la bibliothèque PowerSync côté page : au plus 36,7 Kio gzip, chargée en arrière-plan. Ce chiffre est celui du module de mesure, qui contient aussi le générateur.

Points d'attention pour T10 :

- **Le WASM « async » d'IndexedDB (2,2 Mio) dépasse la limite par défaut de Workbox** (`maximumFileSizeToCacheInBytes`, 2 Mio). Il faudra la relever pour ce fichier, sinon il ne sera pas précaché.
- **Ne précacher que les fichiers du VFS choisi.** Le build produit aussi les variantes chiffrées (`mc-wa-sqlite*`) et le code du mode sans worker, soit 7,7 Mio en tout dans `assets/sqlite/`.
- **OPFS divise le poids du WASM par 1,5 en gzip** : il se passe d'asyncify.

## Limites de la mesure

- **Le worker n'est pas ralenti** par le ×4 de Chrome : le test donne une borne basse. La mesure `&fil=page` donne une estimation plus dure mais imparfaite. Seul un vrai téléphone Android milieu de gamme tranchera. La page peut s'ouvrir telle quelle sur le téléphone de Théophane : `/mesures/sqlite.html?variante=raw`, puis `&vfs=opfs`.
- **Bruit important.** Le conteneur a un CPU partagé : la requête 2D JSON a varié de 124 à 425 ms d'un passage à l'autre. Les médianes sur 5 passages restent fragiles à ±50 ms près.
- **WASM relu depuis le cache HTTP** du serveur de prévisualisation, pas depuis le service worker. Chaque contexte neuf recompile le WASM.
- **Jeu synthétique et schéma simplifié** : pas de `ferme_id`, pas de suppression douce, pas d'itinéraire. Le schéma définitif (T08) ajoutera des colonnes et des filtres.
- **File d'envoi pleine** : le jeu est chargé par des écritures locales, donc `ps_crud` contient environ 36 000 entrées dans les deux variantes. Une base remplie par la synchro n'en aurait pas. L'effet attendu est nul sur les lectures.
- **Une seule insertion**, mesurée isolément, sans écran ni React autour.

## Pistes si le budget est confirmé trop juste

1. **Raw tables** (recommandé) : −88 ms sur la requête 2D en configuration de l'appli, −91 ms quand SQLite est ralenti.
2. **OPFS (`OPFSCoopSyncVFS`)** :
   - gain : ouverture −38 ms, requête 2D −20 ms en raw, soit 237 ms au total, et WASM de 498 Kio gzip au lieu de 760 ;
   - coût : chargement initial deux fois plus lent (12 s contre 6 s pour la ferme entière) et OPFS à valider sur Safari iOS.
3. **Ouvrir la base une fois, au lancement, en parallèle de l'affichage de l'appli**, et la garder ouverte :
   - l'appli s'affiche en 72 à 153 ms, et l'ouverture (180 à 300 ms) se fait pendant ce temps ;
   - un écran courant ne paie plus que sa requête, de 53 à 162 ms selon la configuration ;
   - seul le tout premier écran après un lancement à froid reste au-delà de 300 ms.
4. **Requête 2D plus étroite** : ne lire que les planches visibles (une zone compte 13 à 14 planches sur 400), au lieu des 674 occupations de la saison. Non mesuré.
