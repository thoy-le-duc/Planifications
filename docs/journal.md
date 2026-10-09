# Journal

Trois lignes par ticket terminé : fait, décidé, bloquant. Le plus récent en haut.

## 2026-10-09 — T28k : placer au doigt sur le téléphone

- **Fait** : le gérant édite le placement sur téléphone et tablette (`data-ecran`, `data-geste`) : un doigt sur l'élément choisi le déplace, ailleurs il déplace la carte, un tap choisit sans déplacer, deux doigts zooment et tournent l'élément choisi ; barre du bas (« Tourner −5° / +5° », « Nouveau bâtiment », « Enregistrer », « Annuler ») ; appui long sur un côté pour ajouter un sommet ; sommets et poignées à 44 px ; `touch-action: none`. « Modifier le plan » de la vue 3D est aussi au téléphone pour le gérant. Bandeau d'étapes visible en lecture seule, étapes à venir en `aria-disabled` avec leur raison ; doublons de messages retirés. Budget de l'éditeur 21,2 → 22,1 Kio (mesuré 20,9 → 21,8).
- **Décidé** : l'équipier reste en lecture seule. Trois tests existants (editeur, contours-editeur, suites) et le test 3D étroit (contrat-editeur, e2e vue-3d-editeur) figeaient « sur ordinateur » : adaptés en commits séparés cités à Q36. Le zoom à deux doigts suit l'écart en direct (un niveau par doublement), autour du centre de la vue.
- **Bloquant** : le test « deux doigts qui s'écartent… zooment d'un niveau » (doigt-editeur.test.tsx) attend `data-zoom` 20 depuis 19, or `data-zoom` est plafonné à `ZOOM_TUILES_MAX` = 19 (adresse-editeur.test.tsx : « data-zoom plafonné à 19 »). Les deux tests se contredisent ; décision du chef. Le texte de l'encart 3D pour l'équipier dit encore « depuis un ordinateur ».

## 2026-10-09 — T38b : guide de mise en ligne pas à pas

- **Fait** : `docs/mise-en-ligne.md` (Neon Francfort et adresse pooled, migrations, PowerSync Cloud UE, Brevo, Vercel « appli », premier compte, « Ce qui reste gratuit », « Que faire si… », rappels de sécurité). Le tableau des 18 variables est vérifié par `apps/api/src/guide-mise-en-ligne.test.ts` (relevé dans `config.ts`, `vercel.ts`, `vite.config.ts` et `import.meta.env.VITE_*`). Lien ajouté dans `CLAUDE.md`.
- **Décidé** : migrations depuis GitHub Codespaces avec l'adresse collée en saisie cachée (`read -rs`), codespace supprimé ensuite : rien à installer, aucun secret dans une conversation ni un fichier. Deux adresses Neon : pooled pour Vercel, directe pour les migrations et PowerSync (la réplication ne passe pas par le pooler). Utilisateur `powersync_role` en lecture avec REPLICATION, créé dans l'éditeur SQL de Neon. Audience `powersync-planif` (celle de `powersync/powersync.yaml`). Chiffres des offres gratuites donnés de mémoire et marqués « à vérifier sur le site ».
- **Bloquant** : le guide n'a pas été suivi sur de vrais comptes (libellés des écrans Neon, PowerSync, Brevo, Vercel à confirmer) ; la relecture à la lettre sur comptes fictifs reste à faire. Le chemin `/api/...` après la réécriture Vercel se vérifie au premier déploiement (étape 5, points 27 à 32).

## 2026-10-09 — T38a : l'API tourne aussi sur Vercel

- **Fait** : `apps/api/src/vercel.ts` sert la même application Hono sous `/api` (configuration lue au premier appel, 500 `configuration_invalide` sans secret, pool à connexions courtes : 3 au plus, fermées après 1 s) ; le débit de la synchro (120 envois par utilisateur et par minute glissante) passe de la mémoire à la base (`securite.debit_synchro`, migration 0031, une écriture atomique `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING`, lignes passées effacées au passage). Projet Vercel « appli » : `vercel.json` racine (cdg1, `pnpm build`, `apps/web/dist`, réécriture `/api/(.*)` avant la SPA, en-têtes de la démo) et fonction `api/[...route].js`. `vercel build` (CLI 63.1.0) réussi sans secret, la fonction construite répond à `/api/sante`.
- **Décidé** : la fonction réexporte un fichier unique rassemblé par esbuild (`pnpm build` → `apps/api/dist-vercel/fonction.mjs`) : le constructeur Node de Vercel compile chaque `.ts` sans réécrire nos imports `./x.ts` ni les `exports` en `.ts` des paquets du dépôt, la fonction ne se chargeait pas (essayé). `PROXY_DE_CONFIANCE=1` obligatoire sur Vercel, avertissement au journal si absente avec `VERCEL=1`. Migrations lancées à la main (`pnpm --filter @planif/db migrer`), pas pendant la construction. Démo intacte : son projet Vercel a pour racine `apps/web` et lit `apps/web/vercel.json`.
- **Bloquant** : rien dans le code. Pour T38b (guide) : créer le projet Vercel « appli » (racine du dépôt), Neon, PowerSync Cloud et Brevo, poser les variables listées dans la PR. Vercel prend Node 24 (`engines` `>=22.18`).

## 2026-10-09 — T28j : le placement se fait en étapes guidées

- **Fait** : l'éditeur de placement (mode édition) a en haut un bandeau de quatre pastilles numérotées (Trouver la ferme, Poser le point de départ, Ajouter une serre ou un bâtiment, Ajuster et tracer les zones), 4 colonnes au téléphone, l'étape en cours pleine orange, les faites cochées en vert forêt, couleurs par jetons. Dessous, une consigne (`aide-etape`) donne l'étape montrée et annonce la suivante. Les étapes se déduisent de l'état existant (origine, bâtiments lus ou au brouillon, pose en cours) : rien de stocké, une ferme déjà placée ouvre sur l'étape 4. Pendant la pose : « Touchez la photo où se trouve la serre » (« le bâtiment » hors serre). Tout bouton grisé a sa raison visible reliée par `aria-describedby` : « Posez d'abord le point de départ (étape 2) », rien à enregistrer, contour refusé, tracé ou pose en cours, enregistrement en cours, zoom limite, fiche du bâtiment incomplète. Code dans `etapes.tsx`.
- **Décidé** : tap sur une étape faite = `aria-current="step"` et sa consigne, sans écriture ; étape 1 = focus sur le champ d'adresse ; étape à venir = rien. Budget de l'éditeur `jsPlacementGzKio` 20 → 21,2 Kio (19,9 → 20,9 mesurés, +1,0 Kio, marge 0,3), dans un commit séparé avec `scripts/placement.test.ts` ; démarrage 71 Kio inchangé.
- **Bloquant** : rien.

## 2026-10-09 — T28h : chercher une adresse, voir large, plusieurs sites

- **Fait** : l'éditeur de placement a, en haut, un champ « Adresse, commune ou lieu-dit » en gros caractères (18 px, cibles de 52 px) : attente de 300 ms après la dernière frappe, une seule requête au géocodage de la Géoplateforme (la précédente abandonnée), 5 propositions au plus, un tap (ou Entrée : la première) déplace la vue au zoom du type de lieu (commune 13, lieu-dit 15, rue 17, numéro 18). Sans réseau, service muet ou réponse illisible : « Recherche d'adresse indisponible sans réseau ; déplacez la carte à la main » ; sans résultat : « Aucune adresse trouvée » ; l'éditeur reste utilisable. Zoom minimal 14 → 6, zoom de départ sans origine ni position 16 → 6 avec le champ entouré d'orange. « Aller à » (zones de premier niveau placées) et « Toute la ferme » (union des contours, 90 % de l'écran au plus) via `vueSurEmprise` (`sites.ts`). `data-centre` sur l'éditeur. Amorçage `?jeu=placement&origine=1&sites=2`. La recherche ne touche jamais `ferme.origine_plan` ni la base.
- **Décidé** : seul le texte tapé part vers l'IGN, rien n'est gardé ; CSP : `connect-src` gagne l'origine `https://data.geopf.fr`, rien d'autre. Zone placée : zoom 19. Le cadrage de la vue 3D est une caméra en perspective : pas réutilisable sur une carte à zoom entier, seule la mesure des mètres par pixel est partagée (`metresParPixel`). Budget de l'éditeur `jsPlacementGzKio` 18,5 → 20 Kio (morceau mesuré à 19,9 Kio, +1,4 Kio) : un morceau chargé au focus a été écarté (la lecture de la réponse à part ne gagne que 0,2 Kio et coûte des octets au démarrage ; la saisie avec minuteries factices ne tolère pas un chargement différé). Démarrage 71,0 / 71 Kio inchangé.
- **Bloquant** : rien. À aligner par le chef (tests que je n'ai pas le droit de modifier) : `scripts/placement.test.ts` fige encore `jsPlacementGzKio` à 18,5 et interdit « geopf » hors `img-src` (la CSP de T28h l'autorise dans `connect-src`).

## 2026-10-09 — T36 : la vue 3D ne charge plus tout le cœur

- **Fait** : `scene.ts` importe `@planif/core/placement` (et non la racine) et `morceauManuel` range `packages/core/src/croissance/` dans le morceau `croissance` (3,9 Kio). Vue 3D 226,3 → 202,8 Kio (la relecture T35a annonçait 202,6) ; démarrage 71,0 et éditeur de placement 18,5 inchangés. Plafond `jsVue3dGzKio` 227 → 203,3.
- **Décidé** : plafond = mesure + 0,5. Seule exception aux tests : les deux qui figeaient 227 (`cadrage.test.ts`, `placement.test.ts`) sont alignés sur 203,3 dans un commit à part, comme le demande le ticket. Les fichiers `*.test.ts` du dossier croissance restent hors du morceau.
- **Bloquant** : rien. Le vol de caméra T07 a échoué au hasard en e2e (aussi 3 fois sur 4 relancé seul : 700,6 ms contre 700, seuil relatif), il passe une fois sur quatre ; c'est T34, sans lien avec ce ticket.

## 2026-10-09 — T14f : l'import reconnaît une planche par sa zone et son code

- **Fait** : l'import compare un code de planche dans sa zone, comme le serveur depuis T10t (`lower(trim(code))`). Le contexte de l'import lit la zone de chaque planche dans la requête existante (`EmplacementConnu.zoneId`, planches retirées écartées). Le parcellaire repère les doublons par zone + code, contre la base et dans le fichier ; les séries gagnent une colonne « Zone » facultative ; séries et assolements désignent la planche de la zone + code, ou refusent la ligne avec « Code ambigu : « P3 » existe dans plusieurs zones. Ajoutez la zone. ». Vérifié : typage, lint, 4 299 tests unitaires, build, budgets (démarrage 71,0 / 71 Kio inchangé, 3D 226,4 / 226,5 Kio), e2e 83 passés + vol de caméra T07 passé à la relance (704 ms > 700 au 1er passage, T34), démo 11.
- **Décidé** (chef) : « P-3 », « P 3 », « P.3 » sont trois codes distincts ; toute planche dont `actif_au` est renseigné est écartée ; une zone désigne aussi ses sous-zones (code présent dans plusieurs → « Code ambigu », préciser la sous-zone). `correspondance.test.ts` mis à jour par le chef (champ `zone` des séries, commit ccaa501). Après relecture : doublon du parcellaire comparé sur l'id de la zone résolue (plus sur ses noms) ; deux planches en service de même code dans une zone → « Code ambigu » qui nomme la zone (jamais la première prise) ; code comparé avec le `trim()` de Postgres (espaces seulement) ; 7 tests de non-régression neufs.
- **Bloquant** : rien. À faire si possible : relire l'import sur un vrai fichier de Théophane avec des codes repris dans plusieurs zones.

## 2026-10-09 — T32d : jeunes plants visibles, plants découpés

- **Fait** : de près, une planche qui porte des plants devient une dalle de 3,1 cm (`hauteurDalle`, `EPAISSEUR_DALLE_PLANTS_M`) et les plants sont posés dessus : un plant de 5 cm se voit. De loin, la masse garde la hauteur du feuillage (T32b inchangé). La tomate (forme `erige-tuteure`) se dessine plant par plant, chacun avec son tuteur (un `InstancedMesh` de tuteurs partagé, 12 triangles, `BilanPlants.tuteurs`), au lieu d'un mur continu ; les autres formes gardent l'étirement de T32b. Budget 3D 226,1 → 226,3 Kio (plafond 226,5 inchangé, pas besoin des 228 de Q33) ; démarrage 71,0 et placement 18,5 inchangés.
- **Décidé** : l'épaisseur est 1/32 m (exactement représentable en flottant 32 bits, sinon le test de pose à 1e-9 près échoue de 7e-10) ; la couleur du filtre T27b reste sur la dalle fine, jamais sur un volume qui cache les plants ; `scene.ts` et `data-hauteurs-plants` inchangés.
- **Bloquant** : rien. Le vol de caméra T07 (≤ 700 ms) reste aléatoire (ticket T34).

## 2026-10-09 — T35a : rangs alignés ou en quinconce, et leur schéma

- **Fait** : densité « écartement » avec `disposition` facultative (`alignee` par défaut, `quinconce`), dans le jsonb `parametres` : aucune migration. `domaine/densite.ts` (`DispositionRangs`, `DISPOSITIONS_RANGS`, `dispositionDe`), validation dans `lireParametres` (itinéraire, série, serveur ; refus de synchro en français). Formulaire : deux gros boutons « Alignés » / « En quinconce » dès 2 rangs, schéma SVG vue de dessus mis à jour à chaque frappe (`SchemaRangs.tsx`, `schema-rangs.ts`). Import : colonne « Disposition des rangs » jusqu'à l'itinéraire créé. Vérifié : typage, lint, 4 266 tests unitaires, intégration Postgres (1 215), e2e 84 passés sans relance, démo 11 ; démarrage 71,0 / 71 Kio inchangé, 3D 226,3 / 226,5 Kio.
- **Décidé** : « Alignés » s'enregistre sans clé (une ligne d'avant T35a reste identique) ; un seul rang n'écrit pas de disposition ; largeur du schéma 1,2 m (l'itinéraire ne connaît pas la planche) ; schéma non dessiné au-delà de 24 rangs. Périmètre élargi à `apps/web/src/ecrans/import/construction.ts` (décision du chef), avec un test de construction.
- **Bloquant** : rien. À surveiller : le morceau commun du cœur (+0,5 Kio, validation et import) laisse 0,2 Kio de marge au budget 3D.

## 2026-10-09 — T32b : plants stylisés qui grandissent en 3D

- **Fait** : la vue 3D dessine des plants stylisés par planche (7 formes, un `InstancedMesh` chacune, 40 à 60 triangles par plant, plafonds 20 par planche et 200 au total), à la hauteur du jour de T32a ; de loin (plant de moins de 4 px) les instances sont retirées et la planche devient un volume à la hauteur du feuillage. Pergola du kiwi et gouttière surélevée du fraisier hors-sol (poteaux instanciés), mention « Hauteurs indicatives, réglables dans la fiche de l'espèce », attributs `data-plants`, `data-formes-plants`, `data-hauteurs-plants`, `data-semaine-plants`. Lecture seule des cultures à l'ouverture de la vue (`donnees-plants.ts`), rien dans le plan 2D ni le démarrage. Valeurs par défaut de Q33 dans le cœur : tomate 3 m, asperge sans fougère jusqu'à la fin de récolte (15 juin par défaut) puis 1,5 m, structure du kiwi au repos, surélévation du fraisier hors-sol. Budget 3D 218,7 → 225,8 Kio (plafond 226,5, Q33 : 228 au plus) ; démarrage 71,0 et placement 18,5 inchangés.
- **Décidé** : hors-sol = `zone.type_abri = 'hors_sol'` (ou sous-zone) ou emplacement `gouttiere`, aucune donnée nouvelle ; surélévation de la gouttière plutôt qu'une forme « hors-sol » (à confirmer). Asperge « fougère après récolte » reconnue par identité du profil par défaut (le type du profil et la base ne changent pas ; réglage par la ferme avec T32c). `@planif/core` déclare `sideEffects` sans `croissance/` pour que le morceau commun ne grossisse pas. Borne e2e de la ferme T07 relevée de 5 500 à 14 000 triangles (mesures dans la PR).
- **Bloquant** : trois tests à trancher par le chef (assertion fausse ou test figé), voir la PR : `profil.test.ts` (tomate 2 m), `vue-3d-plants.e2e.ts` (libellé « Tomate Cœur de bœuf »). Le vol de caméra T07 échoue parfois sur « durée ≤ 700 ms » (714 à 734 ms), aussi sans plants dessinés.

## 2026-10-08 — T28g : l'éditeur rend le focus à la fermeture

- **Fait** : à la fermeture de l'éditeur, le focus revient sur « Modifier le plan » de la 3D (celui du moment : encart ou barre d'outils), à défaut sur la toile `toile-3d` ; dans l'onglet Ferme, sur « Placer sur la photo aérienne ». L'encart `encart-placement` est en `role="status"` (sans focus) et cite la zone après « Aller à <zone> ». Tests `placement` verts (198) ; `pnpm verif` complet vert (4 133 tests unitaires ; e2e 83 + 10 passés, sans relance) ; budgets inchangés (démarrage 71,0 / 71 Kio, 3D 218,7 / 220, placement 18,5 / 18,5).
- **Décidé** : écarts de libellés tranchés : le bouton d'origine de la 3D est « Modifier le plan » (`modifier-plan`), pas « Ouvrir l'éditeur » (qui n'existe pas) ; repli résolu à la fermeture (pas de ref périmée). Mécanisme comme T28e : drapeau posé à la fermeture, focus dans un effet après le rendu, pas de setTimeout. Pas d'annonce sur ferme déjà placée (hors périmètre).
- **Bloquant** : rien.

## 2026-10-08 — T33 : un seul jeu e2e à la fois

- **Fait** : `scripts/verrou-e2e.sh` (flock sur `${TMPDIR:-/tmp}/planifications-e2e.lock`, message « en attente d'un autre jeu e2e » tout de suite, délai maximal 1 800 s, code de sortie de la commande renvoyé tel quel) branché sur `e2e` et `e2e:demo` (`apps/web`) et sur `e2e:synchro` (racine). `pnpm verif` complet vert (3 924 tests unitaires ; e2e 83 + 10 passés, sans relance). Test manuel : le second jeu affiche l'attente, puis démarre après la fin du premier.
- **Décidé** : une seule prise de verrou, dans `apps/web` ; les `e2e` racine passent par le filtre, donc pas de double prise. Le descripteur du verrou est fermé pour la commande (`9>&-`) : aucun processus enfant ne le garde. Aucun seuil, `budget.json` ni `*.e2e.ts` modifiés.
- **Bloquant** : flock n'existe pas tel quel sur macOS : le script s'y arrête avec un message clair, sans lancer le jeu. La boucle tourne sous Linux, mais un poste macOS aurait besoin d'un autre verrou (`lockf` ou `mkdir`).

## 2026-10-08 — T32a : croissance des cultures, profils et calcul (moteur)

- **Fait** : moteur pur `packages/core/src/croissance` (aucun import hors du cœur, ni réseau, ni IA, ni horloge) : `validerProfilCroissance` (règles et ordre du contrat, ne lève jamais), `croissanceA` (annuelles : levée, croissance, pleine production, fin, la date réelle remplace la prévue, aucune fin inventée sans date de fin), `croissancePerenneA` (débourrement, pleine végétation, repos sur la campagne de l'année ; sans cycle annuel, touffe haute fixe), 44 profils par défaut (synonymes « Salade », « Fraise », « Chou »…) et un profil générique, `profilEffectif` (réglage de la ferme, sinon défaut). Colonne `espece.profil_croissance` (jsonb nul = défaut, CHECK « nul ou objet », migration 0030 générée par drizzle-kit après la 0029 de T10t, aucune ligne réécrite), schéma du téléphone (texte JSON), flux `espece` inchangés (`SELECT *`), export JSON + CSV décrit dans LISEZMOI.txt, validation par le cœur côté serveur (hors bornes : tout l'envoi refusé, précision en français). Modèle de données v1.x (section « 2 bis. Croissance des cultures ») et `packages/db/README.md` à jour. Le moteur n'entre pas au démarrage (71 Kio inchangés).
- **Décidé** (chef) : régler le profil d'une espèce de sa ferme suit les droits ordinaires d'une espèce (tout membre actif) ; la bibliothèque commune et une autre ferme ne se règlent pas. Toutes les valeurs par défaut portent « valeur usuelle à vérifier » (aucune référence publiée vérifiée). **À relire par Théophane, les dix plus visibles** : tomate 2 m tuteurée, 90 jours ; concombre 2 m palissé, 70 jours ; poivron 0,7 m buisson, 90 jours ; aubergine 0,9 m buisson, 90 jours ; courgette 0,6 m buisson, 50 jours ; salade (laitue) 0,25 m rosette, 0,9 du cycle ; chou (pommé) 0,4 m rosette, 0,8 du cycle ; carotte 0,3 m, 0,7 du cycle ; fraisier 0,25 m, 45 jours, débourrement 1er mars, repos 30 novembre ; asperge 1,5 m en fougère, 100 jours, débourrement 1er avril, repos 15 novembre. Points signalés à la relecture du chef, à revoir avec Théophane : asperge (la fougère ne devrait monter qu'après la fin de la récolte des turions, pas dès le 1er avril) ; kiwi ligneux (la structure reste visible au repos, à traiter dans T32b) ; fraisier hors-sol (gouttière surélevée, à traiter dans T32b) ; tomate de serre à 2 m peut-être basse. Le module ne s'exécute pas au chargement (constantes `@__PURE__`, index des noms construit au premier appel) : il n'est plus dans le morceau commun de @planif/core, la vue 3D reste à 218,4 Kio comme sur `main`. Un test existant modifié, à valider par le chef : `packages/sync/src/export.test.ts` (T15) tient à la main la liste des colonnes exportées en JSON et contredisait le test T32a qui exige `profil_croissance` en JSON ; la colonne y est ajoutée, rien d'autre (commit à part).
- **Bloquant** : rien. L'écriture du profil sur le téléphone (porte) vient avec l'écran de réglage (T32c) ; « réglé sur un téléphone, retrouvé sur l'autre » de bout en bout relève alors d'e2e:synchro. À aligner : le ticket T32c dit « gérant seulement pour la bibliothèque de la ferme », alors que le serveur laisse tout membre régler une espèce de sa ferme (décision du chef pour T32a). `pnpm verif` vert : 5 530 tests unitaires et d'intégration contre Postgres, 77 e2e plus un relancé seul (« réouverture hors ligne sous 300 ms » à 313 ms pendant qu'un autre Chromium tournait sur la machine, 218 ms seul), 9 e2e de la démo ; JavaScript de démarrage 71,0 Kio inchangé.

## 2026-10-08 — T28f : l'éditeur de placement se trouve depuis la vue 3D

- **Fait** : bouton « Modifier le plan » dans la vue 3D (gérant, écran de 1024 px ou plus, suivi en direct) ; encart « Placez votre ferme sur la photo aérienne » quand rien n'est placé (`fermeSansPlacement`, pur), ou « Le gérant place la ferme depuis un ordinateur » sans bouton ; l'éditeur s'ouvre par-dessus la 3D, qui montre le placement enregistré au retour ; la démo l'ouvre telle quelle (fond neutre hors ligne), aucun changement dans `demo/`. Page d'amorçage : `saison=1`, `origine=1`, `role=equipier`. La carte de l'onglet Ferme cite la 3D.
- **Décidé** : un seul chargement paresseux de l'éditeur, exporté d'EcranFerme (`chargerPlacement`) et réutilisé par EcranPlan en import dynamique au tap : un import statique aurait embarqué l'écran Ferme dans le morceau Planches. Le rôle de gérant est lu par EcranPlan (nouvelle prop `utilisateurId`, passée par App). Budgets inchangés.
- **Bloquant** : rien.

## 2026-10-08 — T10t : parcellaire et catalogue, suites de la relecture de T10s

- **Fait** : dans `apps/api/src/sync/structure.ts`, suppression douce refusée (`ecriture_invalide`, rien du lot écrit) tant que des lignes actives de la ferme en dépendent, avec le compte dans le message (« 2 assolements », « 1 variété et 2 itinéraires ») : zone et emplacement, par les assolements actifs d'une saison non terminée ; saison, par tout assolement actif de son plan ; espèce, par ses variétés et itinéraires actifs et les assolements actifs d'une saison non terminée. Changer la famille d'une espèce est refusé tant que de tels assolements la désignent. Q27 : index unique partiel `emplacement_zone_code_actif_idx` sur `(ferme_id, zone_id, lower(trim(code))) WHERE supprime_le IS NULL` (migration 0029 générée par drizzle-kit, sans retouche, aucune ligne réécrite) et refus propre d'un doublon dans la même zone (« ce code existe déjà dans cette zone »), jamais un 500. Les 84 tests de `structure-suites.integration.test.ts` passent sans modification ; tests d'intégration de `apps/api` et `packages/db` verts.
- **Décidé** (chef) : refus, pas de cascade. Une saison est terminée quand sa fin est strictement avant la date du jour à Paris (heure du serveur) ; les assolements d'une saison terminée sont l'historique : ils restent actifs, rattachés à la ligne supprimée, et n'empêchent rien ; une saison reste retenue par son plan, passée ou non. La famille est copiée dans l'assolement, l'historique n'est pas réécrit. Code unique par zone, sans casse ni espaces autour, gardé tel que saisi. Relecture du chef : un assolement qui change de saison revérifie toutes ses références (failles A et C : un assolement passé sur une ligne supprimée, ou d'une espèce changée de famille, ne revient pas tel quel dans le plan) ; décision B, prolonger une saison terminée est refusé tant que son plan désigne une zone, un emplacement ou une espèce supprimés, ou une espèce changée de famille (le message compte ces assolements) ; décision D, une planche retirée (`actif_au` renseigné) ne réserve plus son code : index et contrôle du serveur ne portent que sur les emplacements non supprimés et en service (migration 0029 régénérée, pas encore fusionnée), et remettre en service une planche dont le code a été repris est refusé ; échanger deux codes passe par un code temporaire. Contre-relecture : une famille est retenue par les assolements actifs d'une saison non terminée qui la désignent, même sans espèce (F1, message qui compte) ; prolonger une saison terminée est aussi refusé si son plan désigne une famille supprimée (F2). Accepté pour l'instant : une planche dont le retrait est daté dans le futur libère son code dès aujourd'hui. Un test de T10s (`structure.integration.test.ts`, « série terminée, son espèce supprimée… ») supprimait une espèce qui avait encore un itinéraire actif, désormais refusé : l'itinéraire est supprimé dans le même envoi, juste avant l'espèce (un itinéraire supprimé ne bloque pas la série réactivée, décision 9 de T23) ; ce que le test vérifie (série réactivée sur une espèce supprimée refusée) est inchangé.
- **Bloquant** : rien. Risque connu : un import fait hors ligne qui recoupe une planche créée ailleurs dans la même zone, pas encore reçue par le téléphone, est refusé en entier (proprement, avec le message). L'import compare encore les codes sur toute la ferme (un « P3 » d'un autre tunnel y est vu comme un doublon) : ticket de suite à créer, « import : codes de planche comparés par zone ». La migration 0029 échouerait sur une base qui a déjà deux emplacements actifs de même code dans une même zone (aucune ligne réécrite, décision du chef) : à vérifier avant de la passer sur une base réelle (requête de vérification dans `packages/db/README.md`). La migration 0029 a été régénérée sous le même nom (index limité aux planches en service) : vérifier qu'aucun environnement durable (préproduction, démo avec base) n'avait appliqué la première version, sinon elle n'y serait pas rejouée. `pnpm verif` complet vert après la relecture (5 253 tests dont l'intégration contre Postgres, 78 e2e, 9 e2e de la démo) ; au premier passage, deux e2e de fluidité 3D sans rapport avaient échoué sous la charge d'un autre Chromium lancé en parallèle sur la machine.

## 2026-10-08 — T28e : l'éditeur de placement se tient au clavier et dit ce qui se passe

- **Fait** : en mode pose, Entrée ou le bouton « Poser au centre de la vue » pose le bâtiment au centre de la vue (brouillon, sélectionné) ; longueur et largeur du panneau bornées à 0,5 m ; message « Le brouillon en cours a été abandonné : la ferme active a changé. » ; la confirmation d'abri dit que les planches suivront la serre ; une tuile en erreur est redemandée après 4 s (3 relances au plus, une à la fois), sans attendre « en ligne ». Relecture de T28d : le focus ne saute plus sur « Tracer le contour » après un tracé abandonné, zone absente (le drapeau n'est levé que si la zone du tracé est affichée, et retombe dans `selectionner` / `choisirZoneListe`). Aucun calcul changé ; démarrage JS inchangé.
- **Décidé** : `ZOOM_DEPART_SANS_POSITION` = 16 (proposition : trois niveaux sous le zoom 19, environ 2 m par pixel, de quoi retrouver sa commune ; dès que le point de départ est posé, la vue passe au zoom 19 autour du point cliqué). `DELAI_RELANCE_TUILE_MS` = 4 000, `ESSAIS_TUILE_MAX` = 3 (le retour « en ligne » remet les essais à zéro).

## 2026-10-08 — T10v : un refus ne porte plus le nom d'une culture d'une autre ferme

- **Fait** : dans `apps/api/src/sync/upload.ts` (`enregistrerRefus`), le résumé ne reçoit `ferme_id` que si la ferme du refus (après le filtre M1) est non nulle, égale à `fermeDesDonnees(e)` (insensible à la casse) et dont l'utilisateur est membre accepté ; sinon le `ferme_id` forgé est retiré et `saisie_culture` est NULL (type, date, quantité, unité inchangés). Les 26 tests de `resume-refus-hors-ferme.integration.test.ts` passent sans modification ; témoin T10k inchangé.
- **Décidé** : correction côté `upload.ts` seulement, `resume.ts` garde son contrat (commentaires précisés, ainsi que l'en-tête de `resume-refus.integration.test.ts`, sans assertion touchée).
- **Bloquant** : rien.

## 2026-10-08 — T29c : le vol de caméra ne coûte pas plus que la navigation

- **Fait** : mesure seule, aucun code changé. Une navigation continue coûte autant qu'un vol (médiane 38–39 ms sous rendu logiciel) ; l'écart vu en T29b venait du glissé de l'e2e, rythmé par Playwright. Même travail par image (1 rendu, 2 appels de dessin, ~0,6 ms de JS) ; sans dessin, 18–25 ms : le coût est SwiftShader.
- **Décidé** : pas de baisse de résolution pendant le vol (changerait l'image pour un défaut propre à la machine de test). Les garde-fous stables de T29b font foi ; le critère « 5 lancements sur 5 » n'est pas un arbitre fiable sur cette machine.
- **Bloquant** : rien. Ticket clos sur constat.

## 2026-10-08 — T29b : fluidité des vols, le coût était le dessin, pas le code

- **Fait** : mesure par image (sous SwiftShader, 1280 × 800) : JavaScript de la vue < 1 ms (médiane 0,3 à 0,5 ms) ; une toile qui ne fait que « clear » coûte déjà 18 à 24 ms de swap ; ferme T07 : 2 appels de dessin, 5 100 triangles ; jumeau T07 placé : 7 appels, 77 634 triangles, intervalles de 83 à 100 ms. Allègement sans changement visible (captures de la démo comparées) : `geometriePlanche()` (5 faces, 10 triangles, sans le dessous) ; arceau à tube de 3 côtés et 8 segments (140 → 48 triangles, 504 arceaux dans le jumeau T07) ; bâche et bouts à 10 segments. Jumeau T07 placé : 77 634 → 29 506 triangles, 7 appels inchangés, intervalles fautifs 0 à 2 sur 270 en e2e (3 lancements), démo 16 084 triangles avant.
- **Décidé** (chef, sur proposition du testeur) : le test de fluidité ne juge plus un seul chiffre sensible à la charge : garde-fous stables (JavaScript par image, appels de dessin, triangles) et intervalle fautif relatif au plancher mesuré dans le même lancement (max(58,3 ms ; 2 × plancher)). Seuils de nombre inchangés. Sol laissé en MeshLambert : le passer en MeshBasic aplatit l'éclairage, l'aspect change.
- **Bloquant** : critère « au plus 1 vol saccadé sur 5 » non tenu : cinq lancements à machine libre de `vue-3d-camera.e2e.ts` ont donné 0, 1, 2, 2, 1 vol saccadé sur 5 (tous verts, échec à 4), soit 3 lancements sur 5 conformes. Pendant un vol les intervalles font environ 50 ms contre 17 à 33 ms en navigation : un coût propre au vol reste à trouver (ticket de suite). Aussi, un aléa sur l'e2e « 5 vols » de la grande ferme T07 (échec à 1 lancement sur 3, bruit du rendu logiciel : 2 appels et 4 300 triangles seulement, rien à alléger côté dessin).

## 2026-10-08 — T10u : les refus d'une ferme quittée disparaissent du téléphone

- **Fait** : dans `powersync/sync-config.yaml`, le flux `refus_synchro` ne sert plus à son auteur que les refus sans ferme (`ferme_id` nul) ou d'une ferme dont il est membre actif (`fermes_actives`). À la perte de l'adhésion, la synchro retire du téléphone les refus de cette ferme, résumé compris (noms de cultures…), même si le téléphone était hors ligne au retrait ; les refus d'une autre ferme dont il reste membre ne bougent pas. Prouvé contre le vrai PowerSync 1.26.1 (`refus-ferme-quittee.integration.test.ts`, `regles-synchro.integration.test.ts`). Les refus restent hors de l'export (T15).
- **Décidé** (chef) : périmètre élargi à `powersync/` : c'est la synchro qui efface, pas le téléphone (un DELETE local partirait au serveur, qui le refuserait en `table_interdite`, et PowerSync remettrait la ligne). Un membre réintégré retrouve ses refus (légitime). Aucun test modifié ; aucun code du téléphone ni du schéma local à changer.
- **Bloquant** : rien.

## 2026-10-08 — T31 : les tests de temps n’échouent plus au hasard

- **Fait** : helper `packages/core/src/test/mesurer.ts` (échauffement, puis médiane de 7 mesures, chacune en min(mural, CPU du processus), version synchrone et asynchrone, avec son test ; si la médiane dépasse la borne, jusqu'à 3 manches, la meilleure gardée). Appliqué aux tests de temps qui mesuraient en mural seul ou une fois : `travaux` (×2), `conflits`, `semainier`, `import/performance`, `plan/calculs`. Les bornes (60, 50, 50, 30 ms, 15 s, 80 ms) sont inchangées.
- **Décidé** : le minimum de 5 d'avant échouait quand toute la rafale était ralentie. La médiane sur le temps de calcul (CPU) ne comptait plus la préemption, mais échouait encore 2 fois sur 5 sous 4 processus saturants (le CPU gonfle aussi) : d'où les manches refaites. Un code vraiment lent reste lent à chaque manche. Laissés tels quels : délais d'annulation (mural voulu), tests déjà sur le CPU (T19) ou en médiane de 5 avec échauffement sur la base.
- **Bloquant** : rien.

## 2026-10-08 — T28d : le gérant trace le vrai contour de ses zones de plein champ

- **Fait** : dans l'éditeur de placement, liste des zones (consultable par tous) ; zone sans serre et sans contour : « Tracer le contour », un clic par sommet, fermeture sur le premier sommet ou Entrée, Échap ou « Renoncer au tracé » pour abandonner. Zone avec contour : sommets à glisser, clic sur un côté = sommet au milieu, clic droit ou Suppr = retrait (jamais sous 3, message), au clavier Tab de sommet en sommet, flèches 0,1 m (Maj 1 m), Inser ; liste des sommets (x, y) éditable dans le panneau. Contour refusé par `validerContour` (côtés croisés, plus de 200 sommets…) : en rouge avec le message exact, « Enregistrer » inactif. Zone abritée : message, pas de contour. Même brouillon, même « Enregistrer » (un seul `porte.placer`), même « Annuler » et Ctrl+Z, même remise à zéro au changement de ferme que T28b ; gérant sur ordinateur seulement. Gestes dans `contours.ts` (pur).
- **Décidé** (chef) : quand le contour d'une zone change, ses planches placées gardent position et cap absolus sur le terrain : leur placement est recalculé dans le repère du nouveau contour (`replacerPlanches`), affiché ainsi dès le geste et écrit dans le même `porte.placer` que le contour ; l'annulation remet tout. Au brouillon, le placement d'une planche reste exprimé dans le repère du contour de la base, ce qui garde un contour modifié plusieurs fois sans dérive. Budget `jsPlacementGzKio` relevé de 15,5 à 18,5 Kio : le morceau mesure 17,4 Kio (14,2 avant T28d) ; il porte désormais `validerContour` du cœur, le tracé, les sommets, le panneau de zone et le recalcul des planches. JS de démarrage inchangé (71 Kio).
- **Relecture du chef** : quand le contour d'une zone change, TOUS ses emplacements placés sont replacés (planches, rangs, gouttières, largeur nulle comprise), par une lecture dédiée sans filtre de sorte ni de dimensions ; l'affichage reste limité aux planches. Ordre d'écriture : contours effacés, bâtiments, contours posés ou changés, emplacements (détacher une serre puis tracer sa zone passe en un seul appel). Les planches d'une zone détachée de sa serre prennent le repère du nouveau contour (leur placement relatif est gardé). Plus de 500 changements : « Enregistrer » désactivé avec un message clair, rien d'écrit. Après Échap, « Renoncer au tracé » ou la fermeture du tracé, le focus clavier revient à « Tracer le contour » ou au premier sommet.
- **Bloquant** : rien. Hors périmètre, comme prévu : trous dans une zone, aimantation sur les bords de la photo, import d'un contour cadastral.

## 2026-10-08 — T28c : le jumeau 3D, la ferme à sa vraie place

- **Fait** : la vue 3D pose zones, planches et bâtiments à leur place et leur orientation réelles (repère de zone du moteur de T28a : `repereZone`, `depuisRepereZone`, `coinsEmprise`). Serres tunnel : arceaux tous les 2 m environ (un seul arceau instancié) et bâche translucide (opacité 0,15, sans écriture de profondeur) où l'on voit les cultures ; serres à chapelles accolées (4 à 10 m chacune) ; hangar, magasin, autre en murs et toit aux couleurs des jetons. Sol des zones extrudé depuis leur polygone (un L reste un L), en une seule géométrie. Zone ou planche sans placement : rangement de T27 à l'est de la partie placée ; planche non placée d'une zone placée : rangée dans la zone, alignée sur elle. Le plan 2D porte contours, placements et bâtiments (champs facultatifs, rien ne change sans placement). Clic sur une serre : vol vers sa zone ; bâtiment sans zone : vol vers lui. Liste texte des bâtiments. La ferme de démo est placée (4 serres, magasin, hangar, champ en L, une planche rangée automatiquement).
- **Décidé** : orientation d'une planche relative à sa zone ; z = −y ; nefs de 4 à 10 m ; la serre prime sur un contour ; placement partiel = non placé (arbitrages du testeur, acceptés par le chef). Budget 3D relevé de 200 à 220 Kio (`budget.json`, jsVue3dGzKio) : 217,2 Kio mesurés, dont 24,3 Kio du morceau `@planif/core` (désormais importé par la scène, mais déjà chargé par l'écran Planches : aucun octet de plus à télécharger) et 8 Kio de code du jumeau (de 184,8 à 192,9 hors cœur). JS de démarrage inchangé (71,0/71). Mesures SwiftShader, grande ferme T07 placée (12 serres, 14 contours, 252 arceaux et plus) : affichage 150 à 200 ms, semaine 43 à 47 ms en médiane (138 ms une fois, sous charge d’un autre e2e en parallèle ; relancé seul : 47 ms), 0 à 2 passages saccadés sur 5. Idée pour plus tard : photo aérienne au sol (hors périmètre).
- **Bloquant** : rien. Deux tests de T27/T29 devenus faux avec le contrat de T28c (clés d'un volume, budget 3D) ont été corrigés par le chef (6602b10). Vue de départ cadrée comme « Vue d'ensemble » ; arceaux et toits plus clairs que le sol (jetons) ; zones de la démo renommées « Serre M1 » et « Serre fraises ».
- **Décidé (cadrage)** : la boîte axée d'une ferme tournée est bien plus grande qu'elle (57 × 119 m pour la démo) ; le cadrage dessus la laissait à 30 % de la largeur. La vue d'ouverture est maintenant `meilleureVueDeFerme(pointsDeFerme(scène), champ, rapport, AZIMUT_DEPART)` : coins réels, cible recentrée à l'écran, meilleur de 16 azimuts (celui de départ à 2 % près) ; la ferme de démo remplit environ 80 % de la toile. « Vue d'ensemble » revient exactement à cette vue (décision du chef, e2e T29 adapté). Budget 3D : 218,1 Kio sur 220.

## 2026-10-08 — T28b : le gérant place ses serres sur la photo aérienne

- **Fait** : onglet Ferme, « Placer sur la photo aérienne » ouvre l'éditeur (chargé à la demande) : orthophoto IGN de la Géoplateforme par tuiles WMTS sans clé (« © IGN »), serres, bâtiments, planches et contours de zones à l'échelle. Glisser pour déplacer, poignée ronde pour pivoter (1°, Maj = 15°), poignées de côté pour la longueur et la largeur ; au clavier, flèches 0,1 m (Maj 1 m), `[` `]` 1°, et des champs x, y, orientation, longueur, largeur, hauteur, zone abritée. Nouveau bâtiment (type, nom, dimensions, puis un clic), point de départ au clic ou à la position de la ferme avec confirmation. Rien n'est écrit pendant le geste : « Enregistrer » fait un seul `porte.placer` pour tout le brouillon, « Annuler » reste 8 s, Ctrl+Z défait les enregistrements de la session. Sans réseau (ou si une tuile échoue) : quadrillage de 10 m et message, l'édition marche pareil. Équipier ou téléphone : lecture seule, sans poignée ni bouton d'écriture, avec le message. `tuiles.ts` et `gestes.ts` sont purs ; CSP : seulement `img-src https://data.geopf.fr` en plus. Budget : JS de démarrage inchangé (71,0/71 Kio), nouveau budget `jsPlacementGzKio` à 15,5 Kio pour un morceau mesuré à 14,2 Kio (+9 %).
- **Décidé** : le chef a accepté les choix du testeur (un seul `porte.placer` par « Enregistrer », côté opposé fixe à la poignée, orientation d'une planche relative à sa zone, zoom 19 à l'ouverture). Les planches se déplacent et pivotent aussi (placement écrit dans le repère de leur zone) ; leurs dimensions ne changent pas ici. Importer `@planif/core` par sa racine tirait tout le cœur (24 Kio gzip de plus) dans le morceau de l'éditeur : l'éditeur prend le repère, les règles du placement et les identifiants par deux sous-chemins du paquet (`@planif/core/placement`, `@planif/core/identifiants`, dans `packages/core/package.json`, comme `./import-xlsx`), regroupés dans `placement/coeur.ts`. Au clavier français, `[` et `]` passent par AltGr : le geste accepte Ctrl+Alt. Le bouton « Annuler » disparaît pendant une écriture et ne revient qu'une fois la nouvelle écriture relue (sans cela, l'e2e rechargeait la page avant la fin de la seconde écriture) ; un geste fait pendant une écriture reste au brouillon.
- **Relecture du chef** : si la ferme active change sans démontage, l'éditeur repart de zéro (brouillon, pile Ctrl+Z, « Annuler », vue, lectures : clé par ferme et par porte, plus `key={fermeId}` dans l'écran Ferme) et rien de A n'est écrit dans B. « Fermer » est grisé pendant une écriture. Écriture réussie mais relecture en échec : message « Enregistré… » distinct d'un refus, « Annuler » reste proposé. Annulation refusée : l'enregistrement reste dans la pile, Ctrl+Z réessaie. Une tuile en erreur est masquée seule ; fond neutre seulement hors ligne (« indisponible hors ligne ») ou si toutes les tuiles échouent (« indisponible pour le moment ») ; tuiles demandées seulement une fois les données de la ferme lues. L'ancien « fond neutre dès la première tuile en erreur » et sa remise à zéro au retour du réseau sont remplacés par ce comportement.
- **Bloquant** : rien. Hors périmètre, comme prévu : contours de zones (T28d), cache des tuiles hors ligne, import d'un plan cadastral.

## 2026-10-07 — T29 : la caméra vole vers une zone

- **Fait** : cliquer une zone ou une planche dans la scène, ou « Aller à <zone> » dans le groupe Zones (Entrée au clavier), envoie la caméra se poser sur la zone en 600 ms au plus, vue de biais à 45°, du même côté qu'avant, boîte entière à l'écran avec 10 % de marge ; « Vue d'ensemble » cadre toute la ferme. Un nouveau clic en plein vol repart de la pose atteinte ; `prefers-reduced-motion` donne un saut direct (relu à chaque vol). Calcul pur et testé (`cadrage.ts`, `pointage.ts`) ; la boucle d'images ne tourne que pendant le vol. JS de démarrage inchangé (71,0/71), 3D 184,8 Kio sur 200. Vols mesurés (SwiftShader) : au plus 3 images perdues d'affilée, 2 intervalles fautifs sur 5 vols.
- **Décidé** : un clic sur une planche cadre sa zone (la sélection d'une planche seule est hors périmètre) ; le clic est trouvé par un rayon contre les boîtes (planches telles que dessinées, socles), sans passer par le raycaster de three ; après un vol, le glissé et la molette tournent autour de la zone atteinte ; un glissé ou une touche en plein vol reprend la main là où la caméra est ; sous 4 px de déplacement, un appui reste un clic.
- **Bloquant** : rien. Le test clavier de l'e2e a été corrigé par le testeur (bf08169). Fluidité des vols mesurée sous SwiftShader : très variable d'une exécution à l'autre (de 0 à 4 vols saccadés sur 5, échec à 4, avant comme après les retouches) ; après les retouches (écritures de `data-*` allégées), 0 sur 5 dans `pnpm verif`, 1 à 4 sur 5 en exécutions isolées sous charge, donc la marge reste mince. Baisser la définition pendant le vol (réglage du pixel) a été essayé et abandonné : il allonge le premier vol au-delà de 700 ms sans gain mesurable.

## 2026-10-07 — T28s : le gérant place sa ferme, le serveur l'accepte

- **Fait** : le serveur accepte le placement réel venu d'un appareil, hors ligne compris : bâtiments (création, déplacement, suppression douce), contours des zones, position des planches, point de départ du plan. Mêmes règles du cœur rejouées avant d'écrire, contour borné en taille avant d'être lu, tout ou rien avec le reste de l'envoi, sous le verrou de la ferme, historique. Seul le gérant place (Q31) ; une autre ferme est toujours introuvable. Côté appareil, `porte.placer` écrit en une transaction et rend de quoi annuler ; chargée à la demande, le JS de démarrage ne grossit pas (72 666 octets gzip contre 72 664 avant le ticket, écart de compression ; affiché 71,0/71 Kio).
- **Décidé** (chef) : refus de droits en « données invalides » avec un message précis ; renvoi identique d'un équipier accepté sans rien écrire ; supprimer une zone placée sans bâtiment reste ouvert à tout membre ; aucun placement sans origine, et l'origine ne se pose, ne bouge ni ne s'efface tant qu'un placement existe, jugé dans l'ordre de l'envoi (serveur et porte, tests mis à jour par le testeur) ; une zone abritée ne se supprime pas tant que son bâtiment n'est pas supprimé ou détaché. Relecture : rétablir une ligne placée (zone avec contour, planche placée, bâtiment) et changer la zone d'une planche placée sont réservés au gérant et exigent l'origine ; la suppression reste ouverte à tout membre ; la porte refuse les mêmes formats que le serveur (identifiant UUID ramené en minuscules, suppression en instant complet avec fuseau, pas de 30 février, nom sans caractère nul, bâtiment jamais créé supprimé), validateurs partagés dans le cœur ; rôle du gérant verrouillé (FOR SHARE) pendant le lot. Cinq fausses portes de tests web complétées d'une ligne (`placer`), comme en T10l, sans assertion changée.
- **Bloquant** : rien. Une ferme qui a des placements écrits avant T28s sans origine ne peut plus poser son origine sans les retirer (aucune en production aujourd'hui). e2e:synchro non lancé (Docker absent).

## 2026-10-07 — T27b : vue 3D, filtres et couleurs lisibles

- **Fait** : une couleur par famille de la bibliothèque commune (16) plus « autre », en clair et en sombre, partagée par le plan 2D et la vue 3D ; courgette, asperge et fraise ne sont plus grises comme le vide, la planche vide est à plat. Panneau à côté de la scène (jamais dessus) : légende-filtre des familles de la semaine, filtres par zone et par culture, tout / rien ; ce qui est décoché est estompé, pas retiré, y compris dans la liste texte. Changement de filtre : médiane 12 ms, géométrie intacte ; JS de démarrage inchangé (71,0/71), 3D 182 Kio sur 200.
- **Décidé** : palette de 17 familles, ΔE CIE76 minimum 33 en clair et 22 en sombre (seuils des tests : 10 et 20), aucune famille regroupée ; filtre culture sur le libellé de la barre, variété comprise, pour cette version ; l'écran Aujourd'hui garde ses 4 bandes (`bandeFamille`) pour ne pas changer sa référence figée.
- **Bloquant** : rien. Deux tests de durée ont dépassé d'un cheveu sous charge (export 51 ms pour 50, test de perf du cœur 65 ms pour 60) et passent à la relance : à surveiller.

## 2026-10-07 — T28a : la ferme peut enregistrer où sont ses zones, planches et bâtiments

- **Fait** : repère local de la ferme (mètres, x à l'est, y au nord, origine `ferme.origine_plan` distincte de la position météo), contour libre des zones, planches placées dans le repère de leur zone, nouvelle table `batiment` (serres, hangar, magasin, rectangles orientés). Calcul pur et testé dans `packages/core/src/placement` (projection locale au centimètre à 5 km, repère de zone, contrôle des contours et des placements, messages en français) ; base (colonnes nulles, contraintes, une serre par zone, zone abritée sans contour même sous écritures concurrentes), synchro de `batiment` par ferme, export `batiment.csv` et nouvelles colonnes. Rien ne change pour une ferme qui ne place rien ; JS de démarrage inchangé (70,9/71 Kio).
- **Décidé** : modèle v1.x validé (Q31) et décrit dans `modele-donnees.md`. La base ne rejoue que les bornes simples ; la géométrie (auto-intersection, aire, sens) et la règle « gérant seulement » restent au serveur (T28s). D'ici là, le téléphone ne peut écrire aucun placement (refusé par le serveur). Tests anciens complétés pour les nouveaux champs (objets de test, export de T15), sans assertion changée sur le fond. Relecture : une faille de concurrence (verrou de la zone conditionnel) corrigée et testée.
- **Bloquant** : rien. Reporté à T28s : suppression d'une zone abritée ou de sa serre ; acceptation des placements par le serveur.

## 2026-10-07 — T27 : prototype de vue 3D

- **Fait** : bouton « Voir en 3D » sur Planches (ordinateur seulement, ≥ 1024 px) : planches et cultures en relief, couleur par famille, curseur de semaine, liste texte à côté. Chargée à la demande (181 Kio, nouveau budget dédié 200 Kio), JS de démarrage inchangé (71,0/71). Affichage 85 ms, changement de semaine 19 ms, aucune saccade (SwiftShader). Repli 2D avec message si pas de WebGL, erreur, ou lenteur.
- **Décidé** : three + fiber sans drei ni `<Canvas>` (245 Kio sinon) ; greffon d'interop dans `vite.config.ts` pour garder le démarrage sous 71 Kio ; antialiasing coupé. Théophane l'a vu : filtres, jumeau numérique sur photo aérienne (formes libres, gérant seulement), vol caméra → T27b, T28a, T28s, T28b, T28c, T28d, T29 (Q30, Q31).
- **Bloquant** : rien. 12 familles sur 16 sans couleur (grises comme le vide) → T27b. Le test e2e « contour rogné » de l'export (T15c) a échoué une fois sous charge et passe seul : à surveiller.

## 2026-10-07 — T13k : « Fait » accepté dès l'affichage d'Aujourd'hui

- **Fait** : au lancement, « Fait » répond dès l'instantané (≈ 0,3 s), sans attendre la base : la tâche disparaît au tap, le « Fait » attend en file et s'écrit dès que la base est prête, avec la même vérification « déjà fait ». Si la ferme ou le compte change entre-temps, rien n'est écrit et un message le dit ; si l'appli est fermée trop tôt, un message prévient au lancement suivant (« n'ont peut-être pas été enregistrés : vérifiez la liste »).
- **Décidé** : réponse de Théophane à Q26. Les tests de T13g qui exigeaient « Fait » inactif avant la base ont été adaptés (commit séparé, justifié par Q26). « Annuler » sur un « Fait » encore en attente l'écrit puis l'annule (règle T13l). Le message d'abandon peut s'afficher à un autre compte, sans aucun nom de culture. Relecture : aucun bloquant, isolement tenu.
- **Bloquant** : rien. Limite : changer d'onglet avant l'ouverture de la base abandonne les « Fait » en attente (signalé au retour).

## 2026-10-07 — T14b : importer ses fichiers en quelques gestes

- **Fait** : écran d'import depuis l'onglet Ferme (« Importer un tableur ») : déposer, dire ce que c'est, faire correspondre colonnes et valeurs, aperçu, importer. Lecteur Excel et préparation dans un Web Worker, chargés à la demande ; parcellaire, cultures, assolements et séries ; écriture par lots de 500 (limites de la synchro), une série toujours avec ses planches ; modèle d'import gardé par ferme ; « Annuler cet import » lot par lot, refusé en clair si une ligne importée sert déjà. Ferme complète (T07) en 9 à 11 s, CPU ×4, aucune tâche longue ; JS de démarrage inchangé.
- **Décidé** : rien d'inventé en douce : toute valeur par défaut (densité, marge, délais de retour, abri, longueur, pépinière…) est montrée « à vérifier » à l'aperçu ; créer une culture demande sa catégorie, si elle est pérenne et son unité. Séries dans T14b (sinon les critères tombaient) ; saison proposée = année suivante à partir de septembre ; zones reprises par nom. Relecture en deux passages : deux bloquants (valeurs inventées, annulation qui pouvait dire « annulé » à tort) corrigés et testés.
- **Bloquant** : rien. Suites : T14e (refus du serveur visible dans l'historique de l'import, historique en IndexedDB, dates déduites à montrer). La redescente sur un second téléphone reste à vérifier en e2e:synchro.

## 2026-10-07 — T13m : une seule règle « chaîne d'une saisie »

- **Fait** : la règle qui dit si une saisie est annulée et quelle version est en vigueur n'existe plus qu'à un endroit : `chaineDe` (dans `@planif/sync/fait-unique`) réutilise `chaines`, que lisent la journée et le « déjà fait » ; l'écran (`enVigueur`) s'y aligne. `ecritures.ts` n'a plus sa copie ; une saisie relue pour être annulée est lue comme à l'écran. Au passage, la montée d'une chaîne ne traverse plus une ligne d'une autre ferme (correctif d'isolement).
- **Décidé** : sur des données corrompues (cycle, maillon manquant d'une annulation reçue, origine incohérente), la chaîne est tenue pour annulée : refus plutôt qu'écriture. Relecture : 18 000 journaux comparés (≈ 200 000 appels), aucune différence entre écran, journée et écritures ; seul écart avec l'ancienne règle, dans le sens sûr. Index et budget JS inchangés.
- **Bloquant** : rien. À surveiller : la recherche des annulations reçues par `origine_id` parcourt l'index des remplacements (déjà le cas avant) ; à mesurer sur la grande ferme.
## 2026-10-07 — T15c : l'export complet en moins de 10 secondes

- **Fait** : l'archive est construite table par table pendant la lecture (`creerConstructeurArchive`), CRC-32 et encodage accélérés, worker de compression rangé à part et toujours précaché, repli sur le fil principal s'il ne se charge pas, contre-pression vers le worker, chien de garde de 15 s et une nouvelle tentative si le worker tombe. Ferme de T07, CPU ×4 : 7,3 à 8,6 s (avant 11,5 à 15,4 s), aucune tâche longue. La borne de l'e2e revient à 10 s.
- **Décidé** : archive identique au bit près (vérifiée par le relecteur sur 3 360 archives et le CRC sur toutes les longueurs jusqu'à 300 000 octets). Testeur et relecteur sur Sonnet (ticket sans stock ni synchro). JS de démarrage inchangé.
- **Bloquant** : rien. Q28 posée (changer d'onglet arrête l'export sans le dire). Suites dans T15d (contre-pression de la lecture, barre par sauts).
## 2026-10-07 — T10s : le serveur accepte le parcellaire et le catalogue de la ferme

- **Fait** : zones, emplacements, saisons, assolements et familles/espèces/variétés propres à la ferme passent maintenant la synchro au lieu d'être refusés (prérequis de l'import T14b). Isolement strict : jamais une autre ferme ni la bibliothèque commune, références relues sous la ferme, pas de changement de ferme, tout ou rien par lot, suppression douce refusée tant qu'une ligne sert (planche occupée, espèce utilisée, zone non vide…). Règles en français, plafonds contre les fautes de frappe. 859 tests d'intégration verts.
- **Décidé** : mêmes droits que les séries (gérant et équipier). Relecture de sécurité en deux passages : aucune faille d'isolement ; elle a fait ajouter les tests manquants et fermé un contournement (réactiver une série terminée sur une planche supprimée). Postgres lancé localement pour les tests (pas de Docker).
- **Bloquant** : rien. Q27 posée (deux planches avec le même code). Suites : T10t (tests positifs, lignes laissées actives après une suppression, unicité du code) ; la redescente sur un second téléphone sera vérifiée par l'e2e de l'import.

## 2026-10-07 — T13o : « Fait » unique contrôlé d'après le journal d'envoi

- **Fait** : la porte relit aussi les lignes touchées par une modification (via le journal d'envoi de PowerSync, `ps_crud`) : un UPDATE qui transformerait une ligne en « Fait » déjà fait est refusé, comme un rowid réutilisé après une suppression ; un « Fait » et sa correction écrits ensemble ne sont plus refusés à tort. Le brief interdit tout accès SQL brut à l'agent et au serveur MCP.
- **Décidé** : le relecteur a vérifié la lecture de `ps_crud` sur le vrai moteur PowerSync (pas seulement le double de test) : format conforme, refus et acceptations attendus. Refus sur la grande ferme ≈ 3 à 6 ms. JS de démarrage inchangé.
- **Bloquant** : rien. Limites connues : UPDATE ou DELETE+INSERT directs dans les tables internes de PowerSync ; un UPDATE d'un « Fait » qui a déjà un double reçu de la synchro serait refusé (aucun chemin de l'appli ne modifie un événement).

## 2026-10-03 — T13j : « Fait » unique sur tous les chemins d'écriture

- **Fait** : la porte contrôle, dans la même transaction et d'après les lignes réellement écrites, chaque « Fait » nouveau (réalisé, ou intervention qui solde un travail prévu) quel que soit le chemin : `saisirEvenement`, `preparerSaisie` + `ecrireEnsemble`, SQL brut. Deux « Fait » identiques dans un même ensemble, un vérificateur vide ou une copie d'ordre ne passent plus. `preparerSaisie` rend la vérification ; l'écran l'utilise. Refus sur la grande ferme en 6 à 7 ms (CPU normal).
- **Décidé** : relecture en deux passages ; le premier a trouvé qu'un vérificateur quelconque ouvrait la porte à tous les « Fait » d'un ensemble (le chemin de la future voix et de l'agent) : remplacé par un contrôle des lignes écrites (rowid). Pas d'index `origine_id` (sous 50 ms). Relecture après « Fait » en e2e CPU ×4 : 300 à 350 ms (budget 500). JS de démarrage 70,9/71 Kio.
- **Bloquant** : rien. Suite : T13o (contrôle d'après le journal d'envoi `ps_crud`, pour couvrir aussi un UPDATE ; jamais d'accès SQL brut pour l'agent).

## 2026-10-03 — T13l : aucun geste ignoré pendant que les « Fait » s'écrivent

- **Fait** : « Annuler » (bandeau et historique) passe dans la file, après la saisie qu'il annule ; le bandeau d'un « Fait » en file paraît dès le tap ; « Enregistrer » et « Valider » sont inactifs pendant la file avec la raison affichée. Une correction ou une annulation vérifie dans la même transaction que la chaîne de la saisie n'est pas déjà annulée (et, pour une correction, qu'elle vise la version en vigueur) : sinon un avis « déjà annulée ou corrigée ailleurs », rien n'est écrit, le stock reste juste. Annuler une saisie corrigée annule toute la chaîne. La déconnexion efface les clés de ferme de l'utilisateur ; l'instantané n'est montré qu'à l'utilisateur de la session.
- **Décidé** : trois passages de relecture (annulation et stock : zéro faille). Le 2e a trouvé un faux refus et un stock qui pouvait revivre sur une chaîne annulée ailleurs ; corrigés, puis vérifiés par ≈ 80 000 comparaisons aléatoires avec la règle de référence. JS de démarrage 70,9/71 Kio, non relevé.
- **Bloquant** : rien. Suites : T13m (une seule règle « chaîne d'une saisie », aujourd'hui recopiée dans ecritures.ts), T13n (horodatages comparés comme des dates).

## 2026-10-03 — T13g : Aujourd'hui s'affiche avant la base, « Fait » en file

- **Fait** : au lancement, l'instantané d'Aujourd'hui s'affiche avant l'ouverture de la base, en lecture seule (≈ 0,4 s au lieu de ≈ 0,8 s, grande ferme, CPU ×4), pour la dernière ferme montrée à cet utilisateur seulement. Les « Fait » tapés à la suite passent dans une file : chacun disparaît au tap, s'écrit dans l'ordre avec sa vérification « déjà fait » ; aucun n'est perdu, aucun en double, y compris hors lancement.
- **Décidé** : la ferme montrée est mémorisée sous une clé à part, pour ne pas écraser le choix de ferme de l'utilisateur. Le petit module est rangé avec `identifiants` (`vite.config.ts`). JS de démarrage 70,9/71 Kio, non relevé. Relecture : isolement entre fermes sans faille, aucun bloquant.
- **Bloquant** : rien, mais la base s'ouvre ≈ 0,2 s plus tard (≈ 1 s) : on voit les tâches plus tôt, on peut taper un peu plus tard. Q26 posée (accepter « Fait » avant la base, T13k). Suite T13l : « Annuler » ignoré sans message pendant la file.

## 2026-10-03 — T13i : « Fait » unique, partagé avec la voix et l'agent

- **Fait** : la vérification « déjà fait » vit maintenant dans `@planif/sync` (`fait-unique.ts`), seule implémentation, appelée par `porte.saisirEvenement` (future voix, futur agent) et par l'écran Aujourd'hui, dans la même transaction que l'écriture. Le calcul des chaînes est restreint à la culture visée : refus sur la grande ferme en ≈ 5 ms au lieu de ≈ 30 ms.
- **Décidé** : relecture en deux passages, avec une comparaison aléatoire de l'ancienne et de la nouvelle règle (0 divergence, maillons manquants et cycles compris). Corrigé dans le ticket : un refus à tort quand un maillon manque, un coût doublé sur les chaînes pathologiques, les clés du détail passées en paramètre (plus d'injection possible) et limitées aux noms simples. Le petit morceau partagé est rangé avec `identifiants` (`vite.config.ts`) : JS de démarrage 70,9/71 Kio, 1 octet de moins qu'avant.
- **Bloquant** : rien. Suite : T13j (les autres chemins d'écriture, l'intervention qui solde un travail prévu, l'index `origine_id` à mesurer).

## 2026-10-03 — T10o : l'archivage d'un refus vérifié entre deux téléphones

- **Fait** : nouveau test de bout en bout (`e2e-synchro/refus-archives.e2e.ts`) avec la vraie synchro : le téléphone A archive un refus, la carte disparaît chez B ; en base, `archive_le` est rempli à l'instant envoyé ; l'envoi part après le délai d'annulation de 5 s et ne porte que `archive_le` ; un refus témoin reste intact.
- **Décidé** : B est un second téléphone du même utilisateur (un refus ne descend qu'à son auteur) ; le test passe par le vrai écran Ferme, pas la page de diagnostic. Relecture : aucun bloquant ; délai mesuré au départ de la requête, temps du test porté à 180 s.
- **Bloquant** : rien. Docker absent du conteneur : le test n'a tourné qu'en CI. Le délai de 5 s est recopié dans le test (Refus.tsx charge une feuille CSS) ; les deux navigateurs partagent une session.

## 2026-10-03 — T25b : la démo sans impasse

- **Fait** : dans la démo, plus de bouton « Se déconnecter », l'en-tête dit « Démo » au lieu de l'état de synchro, et une réinitialisation faite dans un autre onglet recharge la page au lieu de montrer un écran de connexion sans issue.
- **Décidé** : le mode démo est lu au build (`import.meta.env.MODE`) : la vraie appli n'embarque aucun octet de ces changements (JS de démarrage 70,9/71 Kio, inchangé). Relecture : aucun bloquant, la variante sans coût proposée par le relecteur est retenue.
- **Bloquant** : rien.

## 2026-10-03 — T10r : une réponse en flux n'attend pas sans fin

- **Fait** : une réponse en flux dont la source ne produit rien en 60 s est coupée proprement (504, source annulée, une ligne au journal), en HTTP/1.1 comme en HTTP/1.0 ; le délai ne s'applique plus après le premier morceau ; minuteur toujours nettoyé.
- **Décidé** : le « plafond exact » en HTTP/1.0 est abandonné : l'obtenir aurait affaibli les garanties de T10q (annulation de la source, lecture bornée) ; une réponse d'exactement 32 Mio qui ne se ferme que plus tard reçoit 505, limite documentée. Relecture : aucun bloquant.
- **Bloquant** : rien. Une source qui cale après son premier morceau attend tant que le client reste connecté (assumé ; délai entre morceaux si un vrai export le demande).
## 2026-10-03 — T26 : un banc de synchro qui ne tombe plus tout seul

- **Fait** : le test de synchro de bout en bout utilise des ports hors de la plage que Linux prête au hasard aux connexions sortantes (15432, 18080, 13100, 14174) ; Postgres n'est déclaré prêt que quand il écoute vraiment en TCP ; les migrations réessaient sur une connexion refusée ou coupée, jamais sur une erreur SQL.
- **Décidé** : causes trouvées dans les journaux de CI (port 58080 pris le 3 octobre, connexion coupée par le serveur temporaire d'initialisation de Postgres) ; ticket ouvert par le chef pour que `main` ne passe plus au rouge pour des raisons étrangères au code. Relecture : aucun bloquant, quatre codes d'erreur et des commentaires ajoutés.
- **Bloquant** : rien. Le banc complet n'a pu être vérifié qu'en CI (pas de Docker dans le conteneur de la boucle).

## 2026-10-03 — T13h : « Fait » unique vérifié au moment d'écrire

- **Fait** : avant d'écrire un « Fait » (étape ou travail), l'appli vérifie dans la même transaction qu'aucun réalisé en vigueur n'existe déjà pour cette culture ; sinon rien n'est écrit et un avis dit « Déjà notée ». Deux onglets ouverts ne peuvent plus écrire deux fois la même tâche (verrou d'écriture SQLite).
- **Décidé** : « en vigueur » suit exactement la règle de l'écran (correction la plus récente, annulations, même ferme) ; un travail est identifié par son libellé, sa catégorie et son occurrence. Relecture : 2 bloquants (correction venue d'ailleurs, travaux de même libellé) corrigés, contre-relecture sans bloquant ; trois anciens tests qui court-circuitaient la vérification corrigés.
- **Bloquant** : rien. Suite : T13i (même vérification pour la voix et l'agent ; coût du refus sur une très grande ferme).

## 2026-10-03 — T10q : réponses en flux sûres derrière un proxy

- **Fait** : en HTTP/1.0 (proxy mal réglé), une réponse en flux est lue en mémoire et envoyée avec sa taille exacte, plafonnée à 32 Mio (au-delà : 505) ; en HTTP/1.1, un flux qui échoue avant son premier morceau donne un 500 propre ; un téléphone qui coupe annule la lecture des données ; plus aucune erreur piégée ne peut faire arriver son message au téléphone (fuite trouvée par le testeur, fermée).
- **Décidé** : le README de l'API exige un proxy en HTTP/1.1 ; l'envoi en mémoire n'est qu'un filet de secours. Relecture : 3 bloquants (source non annulée au départ du client, pas de plafond, double annonce de taille) corrigés, contre-relecture sans bloquant.
- **Bloquant** : rien. Suite : T10r (délai jusqu'au premier morceau d'une réponse en flux).
## 2026-10-03 — T13f : plus aucun « Fait » en double sur Aujourd'hui

- **Fait** : les tâches marquées faites restent masquées même si l'on change d'onglet, de ferme ou de jour avant que l'écran ait relu la culture ; une synchro d'une autre culture ne fait plus réapparaître une tâche faite ; « Annuler » ne fait plus réapparaître les autres tâches faites de la même culture. Dans chacun de ces cas, un second « Fait » n'écrit rien.
- **Décidé** : masques gardés dans le cache par ferme (plus par écran ni par jour), levés seulement par une relecture plus récente que l'écriture ; chaque culture garde la date de sa dernière relecture. Relecture : 2 bloquants (« Annuler » et passage de minuit) corrigés, contre-relecture sans bloquant.
- **Bloquant** : rien. Suite : T13h (vérifier en base, au moment d'écrire, qu'un réalisé n'existe pas déjà : protège aussi la voix, l'agent et deux onglets).

## 2026-10-02 — T18 : mode sombre

- **Fait** : l'appli suit le réglage clair/sombre du téléphone sur tous les écrans, avec un choix « Comme le téléphone / Clair / Sombre » dans l'onglet Ferme (Apparence) ; thème sombre « forêt de nuit » (fond vert-noir, en-tête vert profond, boutons sauge), contraste AA vérifié par test sur toutes les paires des deux thèmes ; aucun éclair clair au lancement (petit script bloquant compatible CSP, dans le précache) ; barre du navigateur à la couleur de l'en-tête ; captures de chaque écran dans les deux thèmes.
- **Décidé** : thème clair conseillé en plein soleil (ligne d'aide) ; l'enregistrement du service worker est chargé juste après le premier affichage pour faire de la place au démarrage (JS de démarrage 70,9/71 Kio, non relevé : le prochain ajout au démarrage devra trouver sa place) ; une paire de contraste impossible et absente de l'écran retirée du contrat. Relecture : 2 bloquants (compte à rebours invisible en sombre, captures manquantes) corrigés, contre-relecture sans bloquant.
- **Bloquant** : rien. L'écran de lancement de l'appli installée reste clair (le manifeste ne connaît pas le thème sombre).

## 2026-10-02 — T10p : erreurs d'envoi en flux sans fuite

- **Fait** : une réponse en flux qui échoue en cours d'envoi est journalisée proprement (une ligne, sans message ni donnée), la connexion est coupée pour qu'un export tronqué ne passe jamais pour complet, rien ne part sur la console ni vers le client ; une erreur levée avant toute réponse donne un 500 et une ligne propre ; un téléphone qui coupe n'est pas journalisé comme une erreur.
- **Décidé** : jamais `hono/streaming` (il ferme proprement un flux en échec) : test statique et règle en tête de `serveur.ts` ; positions de pile seulement si le journal est bien à sa place dans le dépôt (`racineDepuisModule`). Relecture : aucun bloquant, sept retouches, contre-relecture sans bloquant.
- **Bloquant** : rien. Suite : T10q (HTTP/1.0 derrière un proxy, 500 propre avant le premier octet, tests 400/504).
## 2026-10-02 — T10n : annuler un archivage de refus

- **Fait** : après « Archiver » ou « Tout archiver », les refus sortent tout de suite de la liste et un bandeau « N refus archivés — Annuler » reste 5 s ; rien n'est écrit tant qu'on peut annuler ; l'archivage part à la fin du délai, ou tout de suite si l'on quitte l'onglet, ferme l'appli ou se déconnecte.
- **Décidé** : aucune règle serveur nouvelle (le serveur ne désarchive toujours pas) ; si la base devient indisponible pendant le délai, rien n'est écrit et les refus réapparaissent avec un message. Une relecture, aucun bloquant, cinq retouches faites (déconnexion, compte du bandeau, annonce aux lecteurs d'écran, animations réduites).
- **Bloquant** : rien. Deux tests de T10l ajustés (ils lisent la base après le délai d'annulation), justifiés dans la PR.

## 2026-10-02 — T10m : journal du serveur sans donnée saisie

- **Fait** : un seul journal pour toute l'API (`apps/api/src/journal.ts`), nettoyé ligne par ligne (contrôles, caractères invisibles et de sens d'écriture, demi-caractères) ; une erreur inattendue est décrite par sa classe, un code vérifié et des positions de pile relatives au dépôt, jamais par son message ; le journal cite le motif de route (`/fermes/:id`), jamais le chemin reçu ; erreurs de fond (base, rejets, exceptions) branchées sur ce journal.
- **Décidé** : un rejet de promesse orphelin est journalisé sans arrêter l'API (sinon un client pourrait la faire redémarrer en boucle) ; une exception non rattrapée l'arrête (code 1). Relecture jusqu'à zéro faille : 3 bloquants puis un cas théorique, tous fermés avec les tests écrits d'abord.
- **Bloquant** : rien. Suite : T10p (erreur d'envoi en flux de `@hono/node-server`, non atteignable aujourd'hui).
## 2026-10-02 — T25 : démo en ligne sur Vercel

- **Fait** : build `demo` (`pnpm build:demo`, `apps/web/dist-demo/`) publié par Vercel à chaque fusion et à chaque PR : ferme fictive remplie au premier lancement (tâches du jour, plan, itinéraires, quelques refus) datée du jour du téléphone, sans connexion ni serveur, hors ligne, bandeau « Démo — données fictives » et « Réinitialiser la démo » avec confirmation ; `apps/web/vercel.json` (build, cache, réécritures).
- **Décidé** : rien de la démo n'entre dans le build de production (garde au build et test sur `dist/`), JS de démarrage inchangé à 70,8 Kio ; la démo n'écrase jamais la session d'un vrai compte ; aucun appel réseau (synchro jamais branchée, `fetch` bloqué hors origine). Une relecture, aucun bloquant, quatre retouches faites.
- **Bloquant** : rien. Suite : T25b (masquer « Se déconnecter » et l'état de synchro dans la démo). Côté Vercel : Root Directory `apps/web`, Node 22.

## 2026-10-02 — T10l : archiver un refus vu

- **Fait** : bouton « Archiver » sur chaque refus et « Tout archiver (N) » sous la liste dès deux refus ; un refus archivé disparaît sur tous les téléphones de l'utilisateur (colonne `archive_le`, migration 0024, flux PowerSync) ; le serveur n'accepte que la date d'archivage, sur ses propres refus, et refuse un instant impossible ou hors bornes.
- **Décidé** : rien n'est supprimé ; les refus restent hors de l'export complet comme décidé en T15 (critère du ticket reformulé, à confirmer par Théophane) ; la première date d'archivage est gardée ; le refus d'un autre répond comme un id inconnu. Une relecture, aucun bloquant, neuf retouches faites.
- **Bloquant** : rien. Au déploiement, redéployer les règles PowerSync avec la migration 0024. Suites : T10n (annuler un archivage), T10o (archivage vérifié entre deux téléphones réels).

## 2026-10-02 — T13d : Aujourd'hui s'ouvre en moins d'une seconde

- **Fait** : au lancement, Aujourd'hui affiche tout de suite la dernière journée gardée sur le téléphone, puis la remplace par la journée relue ; sur la grande ferme (3 000 séries), CPU ×4, l'ouverture à froid passe de 5,8 s à 0,6–0,8 s. « Fait » depuis cette journée gardée relit d'abord la tâche : rien n'est écrit si elle a été faite ailleurs ou a changé, et un message le dit.
- **Décidé** : instantané par utilisateur, jamais montré d'un autre jour, d'une autre ferme ou d'un autre utilisateur, effacé à la déconnexion, limité à ce que l'écran affiche (≈ 21 Ko). Une relecture, rien de bloquant ; trois retouches faites (écriture différente de l'affichage, message « déjà notée », session vérifiée avant d'écrire).
- **Bloquant** : rien. Suite : T13g (afficher avant la base pour plus de marge, « Fait » en file au lancement). Le JS de démarrage reste à 70,8 Kio pour 71.

## 2026-10-02 — T10k : la saisie refusée reconnaissable

- **Fait** : la carte d'un refus montre maintenant la saisie concernée — « Récolte · Tomate Cœur de bœuf · saisie du 28 sept. · 12,5 kg » ; le serveur calcule ce court résumé (type, culture, date, quantité, unité), sans jamais la note ni les données brutes, et il descend au seul téléphone de l'auteur.
- **Décidé** : culture montrée seulement si la culture est de la ferme de la saisie et que l'utilisateur en est membre ; quantité plafonnée à 1 000 000 ; migration additive (5 colonnes). Une relecture centrée sur l'isolement : rien de bloquant, tests ajoutés pour figer la règle.
- **Bloquant** : question Q25 à Théophane (effacer les refus d'une ferme qu'on a quittée ?).

## 2026-10-02 — T10j : des refus de synchro sans jargon

- **Fait** : tous les messages de refus renvoyés au téléphone sont en français simple (« cette saisie existe déjà avec d'autres valeurs », « une information obligatoire manque (quantité) »…), sans nom de colonne, de table, de code ni de seuil technique ; les erreurs du moteur sont traduites par l'API ; le détail technique part dans un journal du serveur, une ligne par refus. Un filet de tests lit tous les textes du serveur et refuse le jargon.
- **Décidé** : le journal ne garde que des codes (motif, champ, SQLSTATE), jamais une valeur saisie ; la synchro décide exactement comme avant (vérifié chemin par chemin). Découpage : T10k (saisie reconnaissable), T10l (archivage). Deux relectures : une injection de fausses lignes dans le journal par un nom de champ piégé (bloquant), corrigée et testée.
- **Bloquant** : rien. Suite : T10m (même règle de journal pour les erreurs inattendues de l'API).

## 2026-10-02 — T13e : plus de « Fait » en double sur une relecture tardive

- **Fait** : une relecture de la journée lue avant l'écriture d'un « Fait » et livrée après ne fait plus réapparaître la tâche ; un second tap n'écrit plus de deuxième réalisé ; une annulation venue d'un autre téléphone rend toujours « Fait » possible.
- **Décidé** : chaque lecture porte le numéro de son départ, chaque « Fait » celui de la fin de son écriture ; le masque tient tant que la journée affichée est plus ancienne que l'écriture. Ticket sans risque : testeur, développeur et relecteur sur le modèle léger ; une relecture, rien de bloquant.
- **Bloquant** : rien. Suite : T13f (changement d'onglet juste après « Fait », relecture partielle ; cas rares, déjà possibles avant).

## 2026-10-02 — T10i : les refus de synchro s'affichent sur le téléphone

- **Fait** : l'onglet Ferme montre chaque saisie refusée par le serveur (type de saisie, date, motif en français, quoi faire), du plus récent au plus ancien, 20 puis « voir plus » ; un envoi trop gros a sa propre phrase ; une pastille orange sur l'onglet Ferme signale un refus pas encore vu. 100 refus : onglet affiché en ~100 ms. Jusqu'ici, un refus passait inaperçu.
- **Décidé** : la pastille compare les refus déjà vus (pas l'heure du téléphone), mémoire par utilisateur effacée à la déconnexion ; phrase d'action propre au stock. Une relecture, rien de bloquant, petits points corrigés au même tour.
- **Bloquant** : rien. Suite : T10j (messages du serveur sans jargon, culture et quantité de la saisie refusée, archivage). Attention : le JS de démarrage est à 70,8 Kio pour 71 ; le prochain ticket qui touche la coquille devra en libérer.
## 2026-10-02 — T14d : import d'une saison à cheval sur deux années

- **Fait** : à l'import d'un tableur, une série semée en S40 et plantée en S2 est comprise comme plantée l'année suivante (Q18) ; la ligne reste valide et l'aperçu porte un avertissement « plantation en 2028 » ; une ligne qui s'étalerait sur plus d'un an, ou qui retombe deux fois, reste en erreur.
- **Décidé** : bascule seulement pour les dates en semaines ; l'année affichée est celle de la semaine (S1 qui commence fin décembre) ; un test existant qui affirmait le contraire de Q18 a été inversé. Ticket sans risque : testeur, développeur et relecteur sur le modèle léger.
- **Bloquant** : rien. L'avertissement n'est pas encore affiché à l'écran : c'est dans T14b (l'écran d'import).

## 2026-10-01 — T13c : Aujourd'hui, relecture rapide et suites

- **Fait** : après une saisie, seule la culture touchée est relue : 799 → ~210 ms sur la grande ferme (CPU ×4), journée identique à une relecture complète (empreintes, nombreux cas limites) ; Aujourd'hui n'attend plus Planches que 400 ms au plus au lancement ; « Fait » redevient possible après une annulation venue d'ailleurs ; le focus reste sur l'entrée corrigée après « Changer la date », sans jamais être repris ensuite ; emplacements, zones, espèces, familles, variétés et plantations d'une autre ferme n'apparaissent plus.
- **Décidé** : attente bornée à 400 ms (sinon Planches dépasse son budget) ; relecture complète de sécurité 4 s après la dernière saisie ; dernière récolte à date égale = dernière saisie ; campagne sur une plantation d'une autre ferme masquée. Deux relectures : un focus volé à chaque relecture (bloquant) corrigé et testé.
- **Bloquant** : rien. Suite : T13e (« Fait » en double sur une relecture tardive, rare, déjà possible avant).

## 2026-10-01 — T10f : la synchro protégée des abus

- **Fait** : la porte du téléphone refuse une transaction de plus de 5 Mio avant d'écrire ; le serveur limite chaque utilisateur à 120 envois par minute (429, la file reprend plus tard, rien de perdu) ; un client muet est coupé après 10 s sans données, des en-têtes incomplets après 15 s, sans gêner un téléphone lent mais régulier.
- **Décidé** : marge de 1 Mio au serveur (6 Mio) pour le format d'envoi de PowerSync ; durée totale de 300 s ; compteur par processus en v1 ; l'affichage des refus sur le téléphone, jamais construit, devient T10i. Deux relectures de sécurité : la première a trouvé deux failles du nouveau délai (connexions jamais fermées, requêtes longues coupées sans réponse), corrigées et testées ; la contre-relecture les confirme closes (16 scénarios sur sockets brutes).
- **Bloquant** : rien. Pour la mise en ligne : production sur la version de Node de `.node-version`, comme la CI.

## 2026-10-01 — T09c : codes de connexion par Brevo, côté code

- **Fait** : le code de connexion part en texte et en HTML sobre (sans image ni lien), expéditeur « Planifications » ; la connexion au relais Brevo est vérifiée au démarrage, en tâche de fond ; configuration Brevo documentée dans `config.ts`. Trois relectures de sécurité : aucune forme du mot de passe SMTP ni du texte du serveur n'atteint plus les journaux, le mode console (codes en clair) n'existe qu'en développement, l'adresse d'expéditeur et la longueur du mot de passe sont contrôlées.
- **Décidé** : une panne de Brevo n'empêche jamais l'API ni la synchro de démarrer ; un échec d'envoi répond 503 ; l'invitation reste en texte.
- **Bloquant** : la mise en ligne attend Théophane : compte Brevo, domaine d'envoi (SPF, DKIM, DMARC), identifiants dans les secrets de production, suivi des ouvertures désactivé.

## 2026-10-01 — T13b : Aujourd'hui rapide sur une grande ferme

- **Fait** : sur une ferme de 3 000 séries en cours (~50 000 saisies), la lecture de la journée passe de 854 ms à environ 120 ms (stockage du téléphone simulé), à résultats identiques ; nouveaux index locaux, requêtes allégées, règle « en vigueur » calculée une fois ; une saisie au `detail` corrompu n'empêche plus l'écran de s'afficher ; une date d'occurrence invalide est ignorée. Au tap : 30 ms. À froid, CPU ×4 : 8,8 s → 5,3 s.
- **Décidé** : le budget de 1 s à froid n'est pas tenable par les requêtes seules (lecture à froid des pages SQLite dans le navigateur) : il part dans T13d (instantané de la journée au lancement) ; la lecture sous Node garde un garde-fou de 250 ms. Découpage : T13c reprend la relecture après saisie (884 ms), le lancement sans attendre Planches, le masque, le focus. Une relecture a trouvé un filtre de ferme retiré (isolement) : remis et testé, contre-relecture sans faille.
- **Bloquant** : rien. À savoir : les index ajoutent environ un tiers à la place de la base locale et allongent la première synchro.

## 2026-10-01 — T24d : « Annuler » bloqué, le maraîcher est prévenu

- **Fait** : après « Annuler » dans « Mes itinéraires », l'appli relit les lignes défaites (une requête par table) ; une ligne qu'une synchro arrivée entre la lecture et l'écriture a empêchée de revenir est comptée, et l'écran affiche « modifié entre-temps sur un autre téléphone, gardé tel quel (n lignes) » au lieu de laisser croire que tout est défait.
- **Décidé** : relecture hors transaction, pour l'affichage seulement (avec PowerSync, la synchro attend les écritures locales : fenêtre quasi nulle) ; une ligne que la synchro a remise exactement comme avant n'est pas comptée, rien n'est perdu ; une relecture impossible ne fait pas passer l'annulation pour un échec. Une relecture, rien de bloquant, petits points corrigés.
- **Bloquant** : rien.

## 2026-10-01 — T10h : « en vigueur » rapide et aligné partout

- **Fait** :
  - La base tient elle-même l'origine de chaque saisie (`origine_id`) et un résumé par chaîne de corrections (schéma `interne`, non synchronisé), à l'aide de déclencheurs.
  - La vue « en vigueur » passe de 4,2 s à moins de 2 ms pour une saisie, et à environ 36 ms pour une ferme de 10 000 saisies sur 200 000.
  - Le téléphone applique la même règle dans le semainier et l'historique : une récolte annulée dont l'origine est ancienne n'apparaît plus.
  - Une chaîne de 1 000 corrections se lit en 15 ms.
- **Décidé** :
  - Un parent dont l'origine est illisible est refusé (23503) plutôt que deviné.
  - Le verrou de ferme vaut pour toute correction ou annulation, et plus seulement pour les récoltes.
  - Deux relectures strictes (stock) ; la règle est confirmée sur des milliers de cas tirés au hasard, ainsi que sur la reprise de 446 000 saisies.
- **Bloquant** : rien. À retenir pour la mise en ligne : la migration réécrit toute la table des saisies (23 s sur 446 000 lignes), note dans T09c.

## 2026-10-01 — T24c : « Annuler » des itinéraires sûr face aux types changés ailleurs

- **Fait** : « Annuler » dans « Mes itinéraires » relit les types d'intervention au moment d'annuler. Il ne remet jamais un type supprimé ailleurs, ne défait pas un renommage devenu impossible (nouveau libellé utilisé ou ancien recréé) et n'écrase plus une valeur reçue entre sa lecture et son écriture, grâce à une condition dans chaque UPDATE, qui vérifie aussi la série d'une occupation.
- **Décidé** : un itinéraire laissé n'empêche pas ses séries d'être défaites, puisque le serveur ne relie pas l'instantané au texte de l'itinéraire. La condition dans le WHERE a été préférée à une transaction de lecture, que la porte ne permet pas.
- **Bloquant** : rien. Suite dans T24d : prévenir quand l'annulation est bloquée en silence (fenêtre de quelques millisecondes).

## 2026-10-01 — T11d : la mesure du défilement du plan est fiable

- **Fait** : la fluidité du défilement de Planches se mesure sur 5 passages, en images perdues à 60 Hz (au plus 2 d'affilée). Le test échoue si 4 passages sur 5 saccadent ou si le total des à-coups dépasse 6. Un témoin volontairement saccadé (60 ms bloquées chaque seconde) échoue à chaque fois. 19 exécutions sous charge sans échec.
- **Décidé** : la limite n'est pas relevée. L'arrondi à l'image la plus proche place la frontière vers 58 ms au lieu de 50 pile, ce qui supprime les échecs à 50,1 ms. Ticket de test sans risque, relu avec le modèle léger (règle de sobriété).
- **Bloquant** : rien. Sous une charge extrême (machine saturée), toutes les mesures de temps échouent, celles de T20 comprises : c'est attendu.

## 2026-10-01 — T24b : « Annuler » des itinéraires sûr face à une série supprimée ailleurs

- **Fait** : « Annuler » dans « Mes itinéraires » vérifie, pour chaque série touchée, l'état d'après annulation comme la fin de lot du serveur, même quand la ligne série n'est pas ramenée. Plus aucune occupation n'est réactivée sous une série supprimée ailleurs.
- **Décidé** : la vérification `etatSerieValide` est partagée entre le formulaire de série et l'écran des itinéraires (`apps/web/src/donnees/etat-serie.ts`), chargée à la demande.
- **Bloquant** : rien. Suites dans T24c, des défauts antérieurs vus en relecture : types d'intervention changés ailleurs pendant les 10 s d'annulation, et course entre lecture et écriture.

## 2026-10-01 — T12b : sélecteur de semaine et annulation sûre dans le formulaire de série

- **Fait** :
  - Sélecteur de semaine maison, qui marche aussi sur iPhone : flèches « Semaine précédente / suivante » et grille des 52 ou 53 semaines de l'année, libellé « S22 · 31 mai 2027 », cibles de 56 px.
  - L'ancre importée hors lundi est gardée ; la variété supprimée est gardée ; la décision de rotation périmée est effacée.
  - « Annuler » ne défait que ce qu'on a écrit, et seulement si le résultat sera accepté par le serveur. Sinon la série reste telle quelle, avec le message « modifié entre-temps ».
  - Mesures : formulaire en 98 ms, recalcul en 1 ms (CPU ×4).
- **Décidé** :
  - Règle générale de l'annulation (décision 10) : avant d'écrire, l'état après annulation est vérifié comme la fin de lot du serveur (références, rétablissement, emplacements, occupations sous série supprimée).
  - Si l'itinéraire change sur une série dont la variété a été supprimée, la variété est retirée et l'appli le dit.
- **Bloquant** : rien. Suites : T24b (le même trou d'annulation dans « Mes itinéraires ») et T11d (le test de défilement du plan échoue au hasard pile à 50 ms).

## 2026-10-01 — T04b : pas d'alerte de rotation sur le hors-sol

- **Fait** : plus aucune alerte de rotation sur une gouttière ni sur un emplacement d'une zone hors-sol (Q17). Une culture passée sur du hors-sol ne compte plus dans l'historique d'une planche de pleine terre, même par le lien « remplace ». Le formulaire de série transmet la sorte et l'abri au moteur.
- **Décidé** : on regarde l'abri de la zone directe de l'emplacement. Une zone inconnue garde l'alerte, sauf sur une gouttière. Sans sorte ni abri, l'emplacement est traité comme de la pleine terre. Le serveur ne recalcule pas la rotation, il n'y a rien à aligner.
- **Bloquant** : rien. Le test de fluidité du plan (T11) a encore échoué une fois sous charge (66,7 ms pour 50) ; à surveiller.

## 2026-09-30 — T24 : l'écran « Mes itinéraires »

- **Fait** :
  - Onglet Ferme, carte « Ma façon de cultiver » : liste des itinéraires par culture. Ceux de la bibliothèque se consultent, et « Adapter pour ma ferme » en fait une copie modifiable.
  - Formulaire : mode, durées, densité et travaux prévus (type, X jours avant ou après un repère, répétition, temps estimé), avec aperçu des dates en direct. Un travail qui ne tombe jamais est signalé.
  - Modifier un itinéraire propose « Appliquer aux N séries à venir » ; les séries commencées ou passées ne bougent jamais. Tout s'écrit en une transaction, et « Annuler » reste possible 10 s.
  - Types d'intervention de la ferme : ajouter, renommer, masquer, avec les doublons refusés avant l'envoi.
  - Mesures : écran en 82 ms, formulaire en 25 ms, aperçu en 10 ms (CPU ×4).
- **Décidé** :
  - « Annuler » ne défait que ce que l'écriture a changé : une ligne modifiée entre-temps sur un autre téléphone reste telle quelle, avec un message.
  - Une série avec un travail déjà fait n'est plus « à venir ».
  - Au-delà de 500 écritures, on propose « Itinéraire seul ».
- **Bloquant** : rien. Masquer un type de la liste de départ pour une seule ferme reste à concevoir.
## 2026-09-30 — T10g : récoltes annulées, correction la plus récente, stock tenu par le serveur

- **Fait** :
  - Une récolte annulée ne se corrige plus : le serveur refuse avec « saisissez une nouvelle récolte » (Q20), et elle disparaît de l'historique du téléphone.
  - Entre deux corrections hors ligne, la plus récente (heure du téléphone) gagne partout : serveur, vue en base et téléphone.
  - Le serveur calcule et écrit lui-même l'écart de stock de chaque correction ou annulation, même sans mouvement du téléphone. Le stock suit toujours la quantité en vigueur.
  - Plafonds de saisie définitifs (Q13).
- **Décidé** :
  - Une correction plus ancienne que celle en vigueur est refusée.
  - Un écart nul est accepté sans écriture.
  - Le mouvement créé par le serveur a un identifiant déterministe. S'il a été réservé d'avance par un autre mouvement, le lot est refusé.
  - Trois relectures ont fermé trois failles de stock : correction sans mouvement, écart nul, id réservé.
- **Bloquant** : rien. Suites dans T10h : la vue « en vigueur » est lente sur un gros journal (4 s sur 200 000 saisies), et la règle du semainier reste à aligner, avant tout export lu côté serveur.

## 2026-09-30 — T23 : le serveur accepte les itinéraires et les types d'intervention

- **Fait** :
  - Nouvelle table des types d'intervention de la ferme, avec une liste de départ commune de 20 types. Elle descend sur les téléphones et part dans l'export complet.
  - Les itinéraires et les types créés ou modifiés au téléphone, même hors ligne, arrivent au serveur. Un lot est accepté ou refusé en entier, avec les séries. Le serveur écrit l'historique.
  - Scénario vérifié à deux téléphones.
- **Décidé** :
  - La bibliothèque commune est en lecture seule : on la duplique pour l'adapter.
  - Un type utilisé se masque, ne se supprime pas et ne se renomme pas.
  - Les noms de type sont nettoyés (espaces de bord, accents unifiés, caractères invisibles refusés) et uniques sans tenir compte des majuscules.
  - L'espèce d'un itinéraire est figée.
  - Supprimer un itinéraire utilisé est permis : la série garde sa copie.
- **Bloquant** : rien. À retenir pour la mise en ligne : la base de production doit être créée en locale UTF-8, sinon l'unicité sans majuscules ne vaut que pour l'ASCII.

## 2026-09-30 — T22b : « Fait » sur un travail en retard solde la bonne occurrence

- **Fait** : « Marquer fait » sur une carte de travail écrit la date de cette carte (`occurrenceVisee`) dans l'intervention. Elle solde cette occurrence et les précédentes, jamais la suivante (Q24). Le désherbage du 31 reste à faire quand on rattrape celui du 17.
- **Décidé** : champ facultatif, permis seulement sur une intervention. Les anciennes saisies gardent la règle de T22 (occurrence la plus proche). Aucune migration.
- **Bloquant** : rien. Noté pour T13b : un détail d'événement qui n'est pas du JSON fait échouer toute la lecture d'Aujourd'hui (défaut antérieur).

## 2026-09-30 — T12 : planifier une série depuis le plan

- **Fait** :
  - Un appui long sur une case vide du plan, ou le bouton « Nouvelle série », ouvre le formulaire, prérempli avec la planche et la semaine.
  - Culture, itinéraire proposé selon la saison, ancre (semis, plantation ou récolte), planches et longueurs. Dates, besoins, conflits et rotation se recalculent en direct par le moteur, en 1 ms.
  - L'alerte de rotation rouge demande une confirmation.
  - « Annuler » est possible 10 s, puis depuis l'historique.
  - La batavia se planifie en 6 gestes, et le formulaire s'affiche en 111 ms hors ligne (CPU ×4).
- **Décidé** :
  - « Fermer » plutôt que « Annuler » sur le formulaire.
  - Annuler une entrée ancienne de l'historique défait aussi les plus récentes, après avertissement.
  - Une entrée d'historique illisible ne s'annule pas.
  - Planches seulement pour l'instant, sans gouttières.
- **Bloquant** : rien. Suites dans T12b : sélecteur de semaine sur iPhone, décision de rotation périmée, bandeau face à un autre téléphone.
## 2026-09-30 — T22 : les travaux prévus des itinéraires

- **Fait** :
  - Le cœur calcule les travaux prévus d'un itinéraire : travail du sol, amendement, désherbage, palissage… Chacun est placé à X jours d'une étape repère.
  - Un travail peut se répéter (tous les N jours jusqu'à un repère) et porter un temps estimé facultatif.
  - Les travaux s'affichent dans Aujourd'hui, mêlés aux étapes. « Marquer fait » écrit une intervention en un geste, annulable 10 s, et une pastille montre la charge de la semaine (« 1 h 24 de travail »).
- **Décidé** :
  - Un travail prévu avant son repère, jamais saisi, disparaît dès que le repère est fait (Q23, par défaut).
  - Le produit est obligatoire en fertilisation et en amendement.
  - Plafonds : 12 travaux par itinéraire (instantané de 8 Kio, revérifié après normalisation) et 1 000 dates par travail.
  - La table des types d'intervention part dans T23.
- **Bloquant** : rien. À trancher : Q23 (confirmer), Q24 (« Fait » sur un travail en retard).

## 2026-09-30 — T10e : le serveur accepte les séries des téléphones

- **Fait** : une série et ses occupations, créées, modifiées, supprimées ou rétablies au téléphone, même hors ligne, arrivent au serveur.
  - Le serveur recalcule lui-même les dates, et une série est acceptée ou refusée avec ses occupations.
  - Il écrit l'historique (avant et après exacts).
  - Il garde la décision prise sur une alerte de rotation rouge (`rotation_acceptee`).
  - Plafonds : 10 000 m et 1 000 000 de plants (Q21).
- **Décidé** :
  - la variété et l'itinéraire doivent être de l'espèce de la série ;
  - une série ne peut pas être créée déjà supprimée ;
  - une mise en place hors saison ou une longueur plus grande que la planche restent acceptées : ce sont des alertes affichées, pas des refus ;
  - les occupations de plantation pérenne ne se modifient pas depuis le téléphone, tant que les pérennes n'ont pas leur ticket.
- **Bloquant** : aucun. La relecture de sécurité a trouvé un bloquant, corrigé : un PATCH pouvait transformer l'occupation d'une plantation en occupation de série. T12 (le plan de culture) est débloqué.

## 2026-09-30 — T10d : suites de la sécurité du stock

- **Fait** :
  - une correction de récolte garde la série et l'unité d'origine ;
  - le serveur ne laisse plus deviner qu'une ligne d'une autre ferme existe, ni par ses réponses ni par ses délais ;
  - un envoi trop gros ne bloque plus la file et ne peut plus remplir la base de refus (limites dures : 2 000 écritures, 8 Mio) ;
  - les quantités de stock sont gardées avec 6 décimales exactes (migration 0012).
- **Décidé** :
  - pour corriger une récolte saisie sur la mauvaise série ou dans la mauvaise unité, on l'annule puis on la ressaisit ;
  - reprendre l'identifiant d'une ligne d'une autre ferme reste détectable, ce qui est une limite structurelle acceptée ;
  - la correction antidatée attend Q20.
- **Bloquant** : aucun. Deux relectures de sécurité, dont un bloquant trouvé et corrigé : l'amplification des refus. Suites dans T10f : débit, délais, poids des transactions.

## 2026-09-30 — T11c : pages de test hors du site en production

- **Fait** : le site mis en ligne (`pnpm build`) ne contient plus que l'appli. La page de diagnostic de synchro, qui écrivait dans une vraie ferme, la page d'amorçage (42 000 lignes chez le visiteur) et la page de mesure n'existent plus que dans le build des essais (`dist-essais/`), qui sert aux tests e2e. Le démarrage passe de 70,7 à 70,2 Kio, puisque le code de test n'est plus embarqué.
- **Décidé** :
  - le build de production n'accepte qu'une seule page, l'appli : toute autre page fait échouer le build ;
  - le build des essais recopie l'appli à l'identique (vérifié octet pour octet, `sw.js` compris), puis ajoute les pages de test à côté ;
  - il reconstruit toujours la production d'abord et ne peut jamais écraser `dist/`.
- **Bloquant** : aucun. Le jour où l'on mettra en ligne : publier `apps/web/dist` seulement.

## 2026-09-30 — T13 : saisie au champ, hors ligne

- **Fait** : l'écran Aujourd'hui, écran d'accueil de l'appli :
  - le semainier, avec les tâches en retard d'abord ;
  - « Fait » en un geste ;
  - la récolte en trois gestes (culture, pavé numérique géant avec virgule, unité préremplie) ;
  - « Annuler » pendant 10 s, puis depuis l'historique ;
  - des cibles de 56 px ou plus.
  Chaque saisie s'écrit en une seule transaction avec son mouvement de stock, et le vrai serveur les accepte toutes, en ligne comme hors ligne (vérifié par la relecture).
- **Décidé** :
  - le pavé a une touche virgule (deux décimales), à la place du micro de la maquette ;
  - une saisie dont la culture est retirée ne se corrige plus depuis le téléphone ;
  - le jour est relu à chaque saisie, pour ne plus écrire la date de la veille ;
  - l'historique est toujours visible, limité à 20 saisies ;
  - « SEMAINE 40 » a quitté l'en-tête pour tenir le budget de démarrage (70,8 Kio sur 71).
- **Bloquant** : aucun. Le budget de démarrage est presque plein. La grande ferme reste lente : ticket T13b.

## 2026-09-30 — T16b : export branché dans l'onglet Ferme

- **Fait** : « Exporter toute ma ferme » lance vraiment l'export, hors ligne compris, avec une barre d'avancement et « Annuler ». L'écran ne se fige plus (plus longue tâche : 0 ms, contre 0,2 s avant) grâce à une lecture par pages et une compression dans un worker. Se déconnecter en plein export arrête l'export avant d'effacer les données : aucune archive ne sort après.
- **Décidé** : borne provisoire de 15 s du tap au téléchargement (mesuré 11,5 à 13,3 s, 15,4 s une fois sous forte charge). La lecture de la base prend à elle seule environ 6 s. T15c ramènera sous 10 s en construisant l'archive pendant la lecture. Bouton désactivé, avec une explication, quand les données ne sont pas prêtes.
- **Bloquant** : aucun. La borne de 15 s reste juste sous forte charge : à surveiller en CI jusqu'à T15c.

## 2026-09-30 — T10c : le serveur accepte le stock des téléphones

- **Fait** : une récolte saisie hors ligne arrive au serveur avec son mouvement de stock, et son annulation aussi. Testé à deux téléphones : 12 kg notés puis annulés sur l'un, stock inchangé chez l'autre. Les règles du serveur :
  - ajout seul, jamais d'écriture pour une autre ferme ;
  - une saisie est acceptée ou refusée en entier ;
  - une annulation retire exactement ce que la chaîne de la récolte avait ajouté, et une correction exactement la différence ;
  - un seul article par récolte, de la même espèce et de la même unité ;
  - quantités à 6 décimales au plus.
- **Décidé** : pour l'instant, un téléphone n'envoie que des récoltes au stock (ni vente, ni perte, ni ajustement). Un verrou par ferme évite les interblocages. Deux relectures de sécurité, deux défauts bloquants corrigés : une récolte pouvait gonfler le stock, et une correction en créer sur un autre article.
- **Bloquant** : aucun. Question Q20 (corriger une récolte annulée, deux téléphones qui corrigent la même récolte). Suites dans T10d. T11b devient prioritaire : la page de diagnostic de synchro écrit dans une vraie ferme.

## 2026-09-30 — T20 : main verte

- **Fait** : la CI de main était rouge sur des mesures de temps. L'appli ne précharge plus ses fichiers hors ligne pendant son premier affichage : le service worker s'enregistre après, au repos. Les mesures d'écran prennent la médiane de 5 essais ; les budgets n'ont pas bougé (réouverture hors ligne 205 à 257 ms, Planches 169 à 215 ms). Un test instable de l'onglet Ferme est corrigé (6 échecs sur 30, puis 15 sur 15).
- **Décidé** : la première réouverture, plus lente, compte dans la médiane, sans chauffe cachée. Le port des tests e2e est réglable (E2E_PORT_APPLI), pour que deux équipes testent en même temps.
- **Bloquant** : aucun. Suites dans T11b (rechargement si un fichier a disparu après une mise à jour, garde-fou à 1,5 fois le budget).

## 2026-09-30 — T11 : vue 2D des planches et base locale

- **Fait** : écran Planches (planches × semaines, réel plein et prévu hachuré, semaine en cours, conflits en libellés courts avec détail au toucher, saison au choix, barres de 44 px au doigt). La base du téléphone s'ouvre dans l'appli après la connexion et reste lisible hors ligne ; elle est effacée à la déconnexion. Relecture : un changement de données ne ramène plus le plan en haut. Ferme de 42 000 lignes : Planches en 0,1 à 0,3 s une fois la base ouverte, défilement fluide.
- **Décidé** : les fichiers de SQLite (2,8 Mio) sont mis en cache après le premier affichage, pour le hors-ligne ; budget de démarrage relevé à 71 Kio (contexte de la base et indicateur de synchro) ; trois tests adaptés (l'export ne compte que ce qu'il ajoute, SQLite ne compte que les requêtes de la page, taille exacte du jeu d'essai).
- **Bloquant** : aucun. Question Q19 (premier tap avant l'ouverture de la base : 0,7 à 0,8 s) ; suites dans T11b (ouvrir la base plus tôt, pages de diagnostic hors production, marges de temps).

## 2026-09-30 — T19 : tests de temps robustes sous charge

- **Fait** : les tests de temps de l'export et de l'import mesurent le calcul (min du temps mural et du temps CPU du processus) ; ils passent dix fois sur dix avec quatre cœurs occupés, et un export deux fois plus lent échoue toujours. L'export rend la main par `setImmediate` sous Node (la cause du « fil gelé » sous charge) ; rien ne change dans le navigateur, vérifié sur Chromium.
- **Décidé** : une attente sans calcul ne se voit plus dans les tests Node, elle sera couverte par l'e2e de l'écran d'export (T16b) ; délai de 60 s sur la relecture de l'export, qui dépassait les 5 s par défaut sous charge.
- **Bloquant** : aucun. Budgets encore lâches (`construireArchive` 2,5 s, import visant le quadratique) : à resserrer plus tard si besoin.

## 2026-09-30 — T14c : suites de la relecture de l'import

- **Fait** : caractères de contrôle collés dans Excel remplacés par une espace (le classeur reste lisible), vrais caractères interdits refusés ; `creerModele` ne crée plus jamais un modèle illisible ; décodage UTF-16 identique au navigateur ; 400 000 lignes à 5 erreurs tiennent sous 350 Mo (plus de 700 avant), en 3,6 s au lieu de 7.
- **Décidé** : les messages d'erreur ne recopient plus la cellule (l'écran d'import l'affichera à côté) ; les tests de mémoire passent par un processus plafonné quand l'environnement impose un gros tas (ils ne vérifiaient rien dans le conteneur de la boucle).
- **Bloquant** : aucun. Suites dans T14b (garde à l'exécution des modèles relus, rapprochement de très nombreuses cultures) ; test de temps de l'export fragile sous charge : T19.

## 2026-09-29 — T16 : identité visuelle

- **Fait** : jetons de design (une seule source, CSS généré), polices hébergées avec l'appli (86 Kio, hors ligne, aucune requête vers Google), composants (boutons, cartes de tâche, en-tête, barre de navigation à 4 onglets, alerte, confirmation), écran de connexion fidèle à la maquette, coquille, écran Ferme (export et déconnexion). Contraste AA vérifié par test, focus clavier visible, lisible zoomé à 200 %.
- **Décidé** : deux couleurs des maquettes légèrement foncées pour la lisibilité (gris tertiaire #606D64, bande salades #2670CC) ; Archivo réduite à la largeur 112 % (22 Kio) ; budget de démarrage abaissé à 70 Kio (69,8 mesurés) ; l'export sera branché avec T11 (T16b).
- **Bloquant** : aucun. Marge de poids très faible (0,2 Kio) avant T11 et T13 : ces tickets devront justifier toute hausse. Réouverture hors ligne : 251 ms sur l'écran de connexion, 170 ms connecté (limite 300).

## 2026-09-29 — T15b : export compressé, léger et sans formules

- **Fait** : archive ZIP compressée (ferme d'exemple : 38,6 Mo → 2 Mo, envoyable par e-mail), fabriquée fichier par fichier (3 Mo de mémoire au pic au lieu d'environ 210 Mo), écran jamais gelé avec barre d'avancement et bouton « Annuler », formules Excel neutralisées dans les CSV (apostrophe devant `=`, `+`, `-`, `@`), `ferme.json` fidèle.
- **Décidé** : pas de Web Worker (le calcul rend la main toutes les 8 ms) ; compression injectée (CompressionStream dans le navigateur) ; test de fluidité mesuré en temps de calcul pour ne plus échouer sur une machine chargée ; vérifié dans LibreOffice qu'aucune formule neutralisée ne s'exécute.
- **Bloquant** : aucun. L'écran d'export sera accessible depuis l'onglet Ferme avec T16.

## 2026-09-29 — T14 : moteur d'import de tableur

- **Fait** : moteur pur dans `packages/core/src/import` : lecture CSV (UTF-8, Windows-1252, UTF-16, séparateur détecté) et Excel (.xlsx lu sans bibliothèque), en-tête et type de contenu devinés, colonnes reconnues par synonymes français et anglais avec unités (m, cm, ha, kg, g, semaines), dates (JJ/MM ou MM/JJ par colonne, Excel 1900 et 1904, semaines), cultures rapprochées de la bibliothèque, aperçu ligne par ligne sans rien écrire, modèle d'import réutilisable. Ferme complète plus 30 000 séries préparées en moins d'une seconde.
- **Décidé** : ticket découpé (écrans dans T14b, après le design) ; quatre passages de relecture pour que des fichiers piégés ou énormes ne puissent ni geler ni faire planter l'onglet (plafonds de cases, de lignes, de taille de cellule) ; toute unité inconnue ou étrangère fait ignorer la colonne plutôt que de lire une mauvaise valeur.
- **Bloquant** : aucun. Q17 (délais de retour par famille) et Q18 (saison à cheval) en attente ; derniers écarts mineurs dans T14c.

## 2026-09-29 — T09b : connexion durcie avant la mise en production

- **Fait** : déconnexion qui efface le téléphone (même hors ligne, même avec un autre onglet ouvert, avec confirmation s'il reste des saisies non envoyées) ; rotation du jeton de renouvellement avec détection de vol (tout jeton remplacé ou rejoué coupe la session) tout en tolérant une réponse perdue au champ ; limite par IP (IPv6 par /64, conservation 24 h) ; CSP stricte sur les trois pages ; garde qui refuse un compte supprimé ; écart d'horloge du téléphone corrigé et gardé ; expéditeur SMTP (nodemailer) ; adresses piégées refusées.
- **Décidé** : trois passages de relecture sécurité (deux bloquants corrigés : un voleur pouvait garder la session ; un effacement différé pouvait supprimer des saisies après reconnexion) ; renouvellement sérialisé entre onglets par `navigator.locks` ; jeton d'accès valable jusqu'à 1 h après déconnexion (limite documentée).
- **Bloquant** : aucun. Q14 (fournisseur d'e-mail) et Q15 (seuil par IP au magasin) en attente. Budget de démarrage à 70,9 Kio sur 90 : à regagner dans le ticket design.

## 2026-09-29 — T15 : export complet JSON + CSV

- **Fait** : bouton « Exporter toute ma ferme » qui fabrique sur le téléphone, même hors ligne, une archive ZIP : `ferme.json` complet, un CSV par table lisible dans Excel (`;`, virgule décimale, BOM), la bibliothèque de référence, et un LISEZMOI qui décrit chaque colonne en français. Ferme d'exemple (30 000 saisies) exportée en moins d'une seconde.
- **Décidé** : liste blanche colonne par colonne (jamais d'e-mail d'autrui, de jeton ni de refus de synchro) ; lignes supprimées exportées avec leur date ; archive non compressée pour cette version (37 Mo pour la ferme d'exemple).
- **Bloquant** : aucun. Le bouton n'est relié à aucun menu tant que les écrans ne sont pas habillés (maquettes à valider). Compression, mémoire (environ 200 Mo au pic), écran figé environ 3 s sur téléphone lent et formules Excel : ticket T15b.

## 2026-09-29 — T10b : règles des saisies dans le cœur

- **Fait** : `validerSaisie` dans `packages/core/src/saisies`, pure et qui ne lève jamais (210 tests) ; le serveur l'appelle à chaque envoi et n'a plus de règles propres. Nouveaux refus : gravité hors liste, cible ou opérateur absents, quantités négatives, durées non entières, horodatage sur un jour inexistant, plafonds des quantités.
- **Décidé** : plafonds provisoires en attendant Théophane (Q13) ; 300 000 saisies aléatoires comparées à l'ancienne version, aucune saisie refusée avant n'est acceptée maintenant ; environ 7 µs par saisie.
- **Bloquant** : aucun. Q13 (plafonds) en attente ; l'opérateur d'un traitement peut encore être vide (à décider pour le registre phyto).

## 2026-09-29 — T10 : synchro de bout en bout

- **Fait** : service PowerSync 1.26.1 auto-hébergé (docker-compose, CI), flux par ferme (membres acceptés seulement, jamais d'e-mail d'autrui ni de secret), `POST /sync/upload` qui vérifie ferme, auteur et chaque référence (série, planche, vanne, produit phyto) avant d'écrire avec son historique, refus motivés qui redescendent sur le téléphone sans bloquer la file, porte `@planif/sync`, reprise sur jeton expiré et état « session expirée ». Test de bout en bout : deux navigateurs, saisie hors ligne, arrivée chez le collègue.
- **Décidé** : l'historique est écrit par le serveur ; un refus n'est visible que par son auteur ; limites de taille (note 4 000 caractères, 20 photos, détail 8 Kio, lot 500, corps 5 Mio) ; une planche citée deux fois est refusée ; image PowerSync figée. Trois passages de relecture (un bloquant corrigé : références vers une autre ferme).
- **Bloquant** : aucun. Reporté : règles des saisies à déplacer dans le cœur (T10b) ; effacement de la base à la déconnexion et écart d'horloge (T09b) ; noms des collègues non synchronisés tant que le nom peut contenir l'e-mail.

## 2026-09-29 — T09 : comptes, fermes et jetons

- **Fait** : connexion par code à 6 chiffres envoyé par e-mail (sans mot de passe), jetons RS256 d'une heure et renouvellement glissant de 90 jours plafonné à 365, fermes et rôles gérant/équipier, invitation par e-mail, isolement entre fermes (404). Après relecture sécurité : 10 échecs de code par adresse et par 24 h, 10 envois par 24 h, noms de ferme sans caractères de contrôle, invitation « en attente » jusqu'à la connexion de l'invité, 20 invitations par heure, compte supprimé coupé immédiatement, `COURRIEL_CONSOLE` interdit en production.
- **Décidé** : l'invitation s'accepte par la connexion (pas d'écran d'acceptation) ; les échecs se comptent sur les codes existants, sans nouvelle table ; déconnexion, rotation du jeton, limite par IP, CSP et vrai service d'e-mail regroupés dans T09b.
- **Bloquant** : aucun. L'écran de connexion est fonctionnel mais brut ; il prendra l'habillage des maquettes une fois validées par Théophane.

## 2026-09-29 — Boucle : T06b et T08 fusionnés, Q9 posée

- **Fait** : T06b (une ligne en retard par série) et T08 (schéma PostgreSQL) testés, relus, fusionnés automatiquement avec la CI verte ; question Q9 posée pour T09.
- **Décidé** : recommandation d'un code à 6 chiffres par e-mail, clé d'accès en option, pas de mot de passe.
- **Bloquant** : T09 attend la réponse à Q9 ; T10 à T15 attendent T09.

## 2026-09-29 — T08 : schéma PostgreSQL et migrations

- **Fait** : paquet `@planif/db` (Drizzle) : 21 tables, clés étrangères sans cascade, journal en ajout seul protégé par déclencheurs, vues `recoltes`, `interventions`, `traitements` (version en vigueur seulement), publication `powersync`, docker-compose Postgres 17 en réplication logique, CI avec un vrai Postgres et contrôle de dérive schéma/migrations ; 536 tests avec la base.
- **Décidé** : un événement + détail (Q10), modèle v1 mis à jour ; six écarts au modèle documentés dans `packages/db/README.md` ; une saisie mal formée est refusée à l'écriture pour ne jamais casser le registre phyto.
- **Bloquant** : aucun pour T08 ; T09 (comptes) attend Q9 (méthode de connexion) et devra créer un rôle applicatif sans droit de modifier le journal.
## 2026-09-29 — T06b : une seule ligne en retard par série

- **Fait** : le semainier ne liste plus qu'une ligne en retard par série, la plus ancienne étape non faite ; les étapes de la semaine restent listées ; exemple du ticket juste (84 j puis 56 j) ; 487 tests, 3 000 séries en 4 ms.
- **Décidé** : deux tests de T06 mis à jour pour Q12, sans changer les jours de retard attendus ; la règle Q11 s'applique avant.
- **Bloquant** : aucun ; relecture sans point bloquant, fusion automatique si la CI est verte.
## 2026-09-29 — Boucle : fusion automatique

- **Fait** : `docs/boucle.md` et le message de la routine mis à jour : la boucle fusionne elle-même ses PR quand la CI est verte et que la relecture n'a rien laissé de bloquant.
- **Décidé** : fusion par GitHub uniquement (méthode « merge »), jamais de push direct sur `main` ; les PR empilées sont redirigées vers `main` puis fusionnées à leur tour.
- **Bloquant** : aucun.

## 2026-09-29 — Réponses de Théophane et fusion de T01 à T07

- **Fait** : T01 à T07 fusionnés dans `main` sur accord de Théophane ; réponses consignées pour Q8 (300 ms courant, 500 ms au lancement à froid), Q10 (événement + détail), Q11 (étape antérieure comptée comme faite) et Q12 (une ligne en retard par série).
- **Décidé** : T08 redevient « à faire » ; nouveau ticket T06b pour la règle des retards du semainier.
- **Bloquant** : aucun ; la prochaine fenêtre peut prendre T06b et T08 en parallèle.

## 2026-09-26 — T04 : alertes de rotation

- **Fait** : `alertesRotation` : délais de l'espèce sinon de la famille, historique des occupations de la planche et des planches qu'elle remplace, assolement passé sur la planche, sa chapelle et ses zones ; alerte rouge ou orange qui cite chaque ligne en cause ; tableau du ticket juste ; 58 tests.
- **Décidé** : au-delà du ticket, les zones des planches remplacées comptent aussi (même sol : mieux vaut une alerte en trop qu'une manquée) ; une série peut s'exclure elle-même du calcul ; année d'un assolement = année de fin de sa saison.
- **Bloquant** : aucun ; T08 (schéma Postgres) reporté tant que les écarts de modèle de T01 (#1) ne sont pas validés.

## 2026-09-25 — T03 : occupations et conflits de place

- **Fait** : occupations d'une série (réel prioritaire, pépinière exclue), d'une plantation pérenne (sans fin tant qu'elle n'est pas arrachée) et d'une couverture ; `detecterConflits` par balayage du temps : chevauchement, surcharge, dépassement de l'emplacement, emplacement inactif, période invalide ; exemple du ticket juste ; 3 000 occupations en 5 à 11 ms.
- **Décidé** : intervalles semi-ouverts (arracher et replanter le même jour ne fait pas de conflit) ; longueurs comparées en centimètres entiers ; une donnée incohérente donne un conflit visible plutôt qu'une erreur qui ferait planter l'écran.
- **Bloquant** : aucun ; la période d'une occupation doit toujours se lire par `periodeOccupation` (T04, T06, T11).
## 2026-09-25 — T06 : semainier

- **Fait** : `semainier(semaine, series, campagnes, realises, dateDuJour)` : semis, plantation, début de récolte, arrachage et campagnes de pérennes, dates recalées par les réalisés, tâches en retard avec leurs jours de retard, ordre stable ; exemples du ticket justes ; 3 000 séries en 4 ms.
- **Décidé** : une étape antérieure non saisie compte comme faite dès qu'une étape postérieure est réalisée (provisoire) ; l'arrachage passe avant le semis sur la même planche le même jour ; un réalisé incohérent est ignoré au lieu de faire planter l'écran.
- **Bloquant** : aucun ; deux questions dans la PR : la règle provisoire, et faut-il limiter les tâches en retard (une ligne par série) ?

## 2026-09-25 — T02 : dates d'une série, rebours et décalage

- **Fait** : `calculerDatesSerie` (ancre sur le semis, la mise en place ou le début de récolte), `appliquerRealises` (la suite glisse de l'écart du dernier réalisé), `calculerDatesCampagne` pour les pérennes (années sans récolte, semaines ISO, semaine 53 ramenée à 52) ; 52 tests dont une propriété sur 500 cas.
- **Décidé** : un seul type de dates prévues, semis pépinière absent plutôt que `null` (T01 corrigé dans la PR #1) ; une plantation faite pendant la période de récolte saute la campagne de l'année.
- **Bloquant** : aucun ; une question pour T06 dans la PR (un semis non saisi avant une plantation réalisée compte-t-il comme fait ?).
## 2026-09-25 — T05 : besoins en semences et en plants

- **Fait** : `besoinsSerie` pour les trois façons de compter (écartement, mètre linéaire, volée) et les trois modes (semis direct, plant maison, plant acheté), `besoinsSaison` par variété et semaine ISO avec plaques par format ; calcul entièrement en entiers (bigint), les sept cas du ticket justes ; 50 tests.
- **Décidé** : entrée du calcul en unités entières (cm, %, mg) ; la conversion depuis les types de T01 (grammes, mètres) se fera dans T12 ; plaques additionnées série par série, car on ne partage pas une plaque entre deux semis.
- **Bloquant** : aucun ; à trancher plus tard : les types de T01 en grammes et mètres, une série sans variété, un plafond de marge.

## 2026-09-25 — T01 : types du domaine et dates calendaires

- **Fait** : dates `AAAA-MM-JJ` calculées en jours absolus entiers, sans objet `Date` (semaines ISO, écarts, ajouts, analyse sans exception), vérifiées sous quatre fuseaux ; les 21 entités du modèle v1 typées avec unions discriminées ; identifiants UUID v7 monotones à horloge et aléa injectés ; 163 tests.
- **Décidé** : événements en ajout seul (correction ou annulation par un nouvel événement) ; récolte, intervention et traitement rangés dans le détail de l'événement plutôt qu'en tables séparées ; sept petits écarts au modèle listés dans la PR.
- **Bloquant** : aucun ; les écarts au modèle attendent l'avis de Théophane dans la PR.
## 2026-09-25 — T07 : mesure SQLite PowerSync sur téléphone simulé

- **Fait** : générateur déterministe d'une ferme (400 planches, 3 000 séries, 30 000 événements) et page de mesure hors navigation ; ouverture + vue 2D (CPU ×4) : 340 à 420 ms en tables JSON, 240 à 320 ms en tables brutes, 426 ms quand SQLite est lui aussi ralenti ; rapport dans `docs/mesures/sqlite.md`.
- **Décidé** : tables brutes recommandées ; le ralentissement ×4 de Chrome n'atteint pas le worker SQLite, donc les chiffres sont un minimum ; rien de SQLite n'entre dans le démarrage ni dans le précache.
- **Bloquant** : budget de 300 ms non tenu au premier écran après un lancement à froid ; question Q8 posée à Théophane, T07 « à préciser » et T10 en attente.
## 2026-09-26 — Boucle : plus de ticket éligible

- **Fait** : aucune PR n'a de retour ni de CI rouge ; question Q10 posée pour débloquer T08 (schéma Postgres).
- **Décidé** : T08 passe « à préciser » : il dépend du choix de modèle de T01 (événement + détail ou tables séparées), sinon tout le schéma risque d'être refait.
- **Bloquant** : relecture des 7 PR ouvertes (la #1 d'abord) et réponses à Q8, Q10 et aux questions des PR #2 et #6.

## 2026-09-25 — Phase 0 terminée : lancement de la boucle en équipe

- **Fait** : organisation en équipe dans `docs/boucle.md` (chef d'équipe, testeur, développeur, relecteur) ; branche `main` créée à partir de l'état validé ; routine toutes les 5 heures.
- **Décidé** : rôles séparés pour que les tests restent l'arbitre ; deux tickets indépendants en parallèle au plus, chacun dans sa copie de travail.
- **Bloquant** : Q8 (méthode de connexion) avant T09 ; Théophane doit choisir `main` comme branche par défaut dans les réglages GitHub.

## 2026-09-25 — Phase 0 : environnement de la boucle

- **Fait** : hook de démarrage des sessions web (dépendances, Chromium), validé depuis zéro avec lint et test ; procédure de la boucle et message de la routine dans `docs/boucle.md`.
- **Décidé** : la boucle tourne dans des sessions Claude Code on the web neuves (environnement « Planification », isolé, sans secret) ; une branche et une PR par ticket, empilées quand une dépendance est encore en revue.
- **Bloquant** : feu vert de Théophane pour créer `main` et programmer la routine toutes les 5 heures.

## 2026-09-25 — Phase 0 : besoins en semences adaptables

- **Fait** : T05 étendu à trois façons de compter la densité, mottes à plusieurs plants, perte en pépinière et plaques, avec sept cas chiffrés ; itinéraire du modèle complété.
- **Décidé** : Q7 validée dans le principe seulement ; plutôt que figer une formule, l'itinéraire choisit sa façon de compter.
- **Bloquant** : Q8 (connexion) avant T09 ; lancement de la boucle (branche `main`, routine toutes les 5 heures) à valider.

## 2026-09-25 — Phase 0 : import générique

- **Fait** : T14 réécrit en import de n'importe quel tableur (correspondance des colonnes et des valeurs, modèle d'import réutilisable, six formes de fichiers en test).
- **Décidé** : l'appli s'adapte au tableur de chaque ferme ; la proposition de correspondance par IA viendra en phase 2 ; T14 ne dépend plus des fichiers des Jardins de Garonne.
- **Bloquant** : Q7 (formules de semences) avant T05 ; Q8 (connexion) avant T09.

## 2026-09-25 — Phase 0 : backlog de la phase 1

- **Fait** : PowerSync validé (Q5) ; 15 tickets dans `docs/backlog/` (moteur T01–T06, mesure SQLite T07, serveur et synchro T08–T10, écrans T11–T13, import et export T14–T15), avec exemples chiffrés vérifiés.
- **Décidé** : dates en chaînes `AAAA-MM-JJ` sans fuseau ; quantités en entiers jusqu'à l'arrondi ; arracher et replanter le même jour n'est pas un conflit ; T07 en priorité car c'est le plus gros risque sur le budget de 300 ms.
- **Bloquant** : T09 (méthode de connexion) et T14 (fichiers réels) à préciser ; environnement isolé de la boucle et branche `main` à mettre en place.

## 2026-09-25 — Phase 0 : recommandation du moteur de synchro

- **Fait** : comparaison de PowerSync, Electric, d'une synchro maison et de neuf autres options, dans `docs/choix-synchro.md`, sources ouvertes ; affirmations clés revérifiées (rachat d'Electric, file d'écritures et licence PowerSync).
- **Décidé** : recommandation PowerSync auto-hébergé en UE, derrière `packages/sync` ; les écritures passent par notre API qui rejoue `packages/core`.
- **Bloquant** : validation du choix par Théophane (Q5) avant de créer `packages/db` et `packages/sync`.

## 2026-09-25 — Phase 0 : squelette du monorepo et CI

- **Fait** : monorepo pnpm (`packages/core`, `apps/web`, `apps/api`, `apps/mcp`), TypeScript 6.0 strict, ESLint strict sans `any`, Vitest, PWA hors ligne, CI GitHub Actions avec budgets de poids (90 Kio gzip) et de temps (réouverture hors ligne < 300 ms, CPU ralenti ×4).
- **Décidé** : Node exécute le TypeScript directement (pas de compilation pour l'API et le MCP) ; TypeScript 6.0 et non 7.0, car typescript-eslint ne gère pas encore la 7 ; `packages/db` attend le choix du moteur de synchro.
- **Bloquant** : aucun ; le dépôt n'a pas encore de branche `main`.

## 2026-09-25 — Phase 0 : modèle corrigé (chapelles, assolement enregistré)

- **Fait** : sous-zones (chapelles), table d'assolement multi-niveaux et pluriannuelle, délais de retour minimal et conseillé, lien de remplacement entre emplacements.
- **Décidé** : l'assolement passé se saisit ou s'importe sans recréer de séries, pour que les alertes de rotation marchent dès le premier jour.
- **Bloquant** : validation finale du modèle (Q4 bis) ; comparaison des moteurs de synchro lancée en parallèle.

## 2026-09-25 — Phase 0 : modèle de données v1 proposé

- **Fait** : questions Q1 à Q3 posées et validées (découpage, série, saisies au champ) ; modèle v1 rédigé dans `docs/modele-donnees.md` avec deux schémas.
- **Décidé** : occupations datées comme ligne de temps des planches ; série et plantation/campagne séparées ; propositions IA dans une file d'attente avant toute écriture ; stock = somme de mouvements ; événements en ajout seul.
- **Bloquant** : validation du modèle par Théophane (Q4) avant le choix du moteur de synchro.

## 2026-09-25 — Phase 0 : brief copié dans le dépôt

- **Fait** : brief copié dans `CLAUDE.md` (esprit, principes, méthode) et `docs/brief.md` (le reste) ; dossiers `docs/backlog/` et `docs/questions.md` créés.
- **Décidé** : les questions sur le modèle de données sont posées une par une ; les réponses sont consignées dans `docs/questions.md`.
- **Bloquant** : le modèle de données attend les réponses de Théophane sur le parcellaire, les séries et la saisie au champ.
