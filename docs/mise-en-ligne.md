# Mettre l'appli en ligne, pas à pas

Ce guide est pour Théophane. Il ne demande aucune connaissance de programmation : on clique, on copie, on colle. Prévoir **une heure**, un ordinateur (pas un téléphone) et la boîte mail de la ferme.

Le résultat : l'appli sur une adresse du type `https://appli-ferme.vercel.app`, avec ta vraie ferme, ton compte, et la synchro entre appareils. Tout est **gratuit** pendant la phase de développement (limites en fin de guide).

## Avant de commencer

- Ne donne **jamais** un mot de passe, une clé ou une adresse de base de données à Claude, dans un ticket, un message ou un fichier du dépôt. Tu les copies d'un site à un autre, et c'est tout.
- Le dépôt GitHub est **public jusqu'au 1er novembre** : tout ce qui y est écrit est lisible par n'importe qui. Raison de plus pour ne rien y mettre.
- Ne commence que lorsque Claude t'a dit que ce guide et la mise en place de Vercel (tickets T38a et T38b) sont **fusionnés dans `main`** : avant, le dépôt n'a pas encore le fichier `vercel.json` et l'étape 5 échouera.
- Garde un **gestionnaire de mots de passe** (ou, à défaut, un carnet papier) ouvert : plusieurs valeurs seront à recopier plus tard.
- Ordre à suivre : Neon, migrations, secret GitHub des migrations automatiques, PowerSync, secrets GitHub des règles de synchro automatiques, Brevo, Vercel, retour sur PowerSync, premier compte.

### Ce que tu vas manipuler

| Service | À quoi il sert | Où |
| --- | --- | --- |
| Neon | la base de données (tes cultures, ta ferme) | Francfort (UE) |
| PowerSync Cloud | la synchro entre téléphone et base | UE |
| Brevo | l'envoi du code à 6 chiffres par courriel | UE |
| Vercel | l'appli et l'API (Paris) | Paris |
| GitHub Codespaces | un petit terminal dans le navigateur, une seule fois, pour préparer la base | navigateur |
| GitHub Actions | applique seul les nouvelles migrations (étape 2 bis), puis déploie les règles de synchro (étape 3 bis), après chaque mise à jour | serveurs de GitHub |

### Les variables, en un coup d'œil

Chaque variable est détaillée à l'étape où tu la poses. Ce tableau est la liste complète de ce que l'appli lit (un test du dépôt vérifie qu'elle est à jour).

| Variable | Quand | D'où vient la valeur |
| --- | --- | --- |
| `DATABASE_URL` | à poser (Vercel) | Neon, adresse « pooled » (étape 1) |
| `JWT_CLES_PRIVEES` | à poser (Vercel) | générée dans Codespaces (étape 2) |
| `JWT_EMETTEUR` | à poser (Vercel) | `https://<ton-adresse-vercel>/api` (étape 5) |
| `JWT_AUDIENCE` | à poser (Vercel) | `powersync-planif`, la même chose que dans PowerSync (étapes 3 et 5) |
| `SMTP_HOTE` | à poser (Vercel) | `smtp-relay.brevo.com` (étape 4) |
| `SMTP_EXPEDITEUR` | à poser (Vercel) | l'adresse d'envoi vérifiée chez Brevo (étape 4) |
| `SMTP_UTILISATEUR` | à poser (Vercel) | l'identifiant SMTP de Brevo (étape 4) |
| `SMTP_MOT_DE_PASSE` | à poser (Vercel) | la clé SMTP de Brevo (étape 4) |
| `PROXY_DE_CONFIANCE` | à poser (Vercel) | `1`, toujours (étape 5) |
| `SMTP_PORT` | facultative | rien : 587 par défaut, c'est le bon |
| `SMTP_SECURITE` | facultative | rien : `starttls` par défaut, c'est le bon |
| `CORS_ORIGINES` | facultative | rien : appli et API sont sur la même adresse |
| `VITE_API_URL` | construction (Vercel) | **vide** ou absente : l'appli appelle `/api` sur sa propre adresse (étape 5) |
| `VITE_POWERSYNC_URL` | construction (Vercel) | l'adresse de ton instance PowerSync (étapes 3 et 5) |
| `PORT` | ne pas poser | sert en local seulement, Vercel l'ignore |
| `COURRIEL_CONSOLE` | ne pas poser | sert en développement seulement : l'API refuse de démarrer avec |
| `VERCEL` | posée par Vercel | rien à faire |
| `NODE_ENV` | posée par Vercel | rien à faire |

---

## Étape 1 — Neon : la base de données

1. Ouvre https://neon.com et clique sur **Sign up**.
2. Connecte-toi avec ton compte GitHub (le plus simple) ou avec ton adresse mail.
3. Ce que tu dois voir : un écran « Create project » ou ton tableau de bord Neon vide.
4. Clique sur **Create project** (ou **New project**).
5. Nom du projet : `planifications`.
6. Région : choisis **Europe (Frankfurt)**, `aws-eu-central-1`. Ne prends pas une région américaine : tes données doivent rester en UE.
7. Version de Postgres : garde celle proposée par défaut (16 ou plus récente).
8. Clique sur **Create**.
9. Ce que tu dois voir : le tableau de bord du projet, avec un bouton **Connect**.

### Activer la réplication (nécessaire à la synchro)

10. Dans le projet, ouvre **Settings** (Paramètres), puis **Logical Replication**.
11. Clique sur **Enable**, puis confirme.
12. Ce que tu dois voir : un message disant que la réplication logique est activée. C'est définitif et sans danger pour ton projet : la base redémarre une fois, en quelques secondes.

### Copier les deux adresses de la base

13. Clique sur **Connect** en haut du tableau de bord.
14. Dans la fenêtre : rôle `neondb_owner`, base `neondb`. Ne change rien.
15. Vérifie que l'interrupteur **Connection pooling** est activé (il l'est en général par défaut) : l'adresse affichée contient maintenant `-pooler` dans son nom d'hôte. C'est l'adresse **pooled**.
16. Affiche la valeur (icône œil) puis copie-la avec le bouton de copie, et colle-la dans ton gestionnaire de mots de passe sous le nom `Neon pooled`. Elle ressemble à `postgresql://neondb_owner:…@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
17. Désactive l'interrupteur **Connection pooling** : l'adresse perd le `-pooler`. C'est l'adresse **directe**.
18. Copie-la et enregistre-la sous le nom `Neon directe`.
19. Pourquoi deux adresses : l'appli en ligne utilise la **pooled** (elle supporte beaucoup de petites connexions). Les migrations et la synchro ont besoin de la **directe**.

Ces adresses contiennent ton mot de passe de base. Elles ne vont que dans ton gestionnaire, dans le terminal de l'étape 2, dans le secret de l'environnement GitHub `production` (étape 2 bis), dans Vercel et dans PowerSync.

---

## Étape 2 — Migrations : créer les tables

Les « migrations » créent les tables vides de ta ferme dans Neon. On les lance ici **une seule fois**, à la première mise en ligne. Ensuite c'est **automatique** : après chaque mise à jour fusionnée dans `main`, GitHub applique lui-même les nouvelles migrations (étape 2 bis). Le terminal ne sert plus qu'**en secours**.

**La voie que nous choisissons : GitHub Codespaces.** C'est un petit ordinateur prêté par GitHub, dans ton navigateur, qui a déjà tout ce qu'il faut. Rien à installer sur ton ordinateur, et on le supprime après. Le terminal reste chez toi : l'adresse de la base ne passe par aucune conversation et n'est écrite dans aucun fichier du dépôt.

*Pourquoi pas depuis ton ordinateur ?* Cela marche aussi, mais il faut y installer Node 22 et pnpm. Pour un non-développeur, Codespaces est plus court. Pourquoi pas la console Vercel ? Elle n'offre pas de terminal.

### Ouvrir le terminal

1. Ouvre le dépôt sur GitHub : https://github.com/thoy-le-duc/Planifications
2. Clique sur le bouton vert **Code**, onglet **Codespaces**, puis **Create codespace on main**.
3. Ce que tu dois voir : au bout d'une à deux minutes, un éditeur de code dans le navigateur, avec une zone **Terminal** en bas. Si elle est cachée : menu **Terminal**, puis **New Terminal**.
4. Dans le terminal, écris `pnpm install` puis Entrée. Si le message est « pnpm : commande introuvable », écris d'abord `corepack enable` puis Entrée, et recommence `pnpm install`.
5. Ce que tu dois voir : une série de lignes, puis `Done in …`. Avant de continuer, écris `node -v` puis Entrée. Il doit afficher `v22.18` ou plus (v22.20, v24…). Si c'est plus ancien (v20…) : écris `nvm install 22 && nvm use 22`, puis refais `pnpm install`.

### Coller l'adresse sans la laisser traîner

6. Dans le terminal, écris cette ligne (elle ne contient pas ton secret) puis Entrée :

   ```
   read -rs -p "Adresse de la base : " DATABASE_URL && export DATABASE_URL
   ```

7. Ce que tu dois voir : `Adresse de la base :` et un curseur.
8. Colle l'adresse **directe** (`Neon directe`, sans `-pooler`), avec Ctrl+V (ou Cmd+V sur Mac). **Rien ne s'affiche, c'est normal** : la saisie est cachée. Appuie sur Entrée.

### Lancer les migrations

9. Écris cette ligne puis Entrée :

   ```
   pnpm --filter @planif/db migrer
   ```

10. Ce que tu dois voir : quelques secondes d'attente, puis la phrase **`Migrations appliquées.`**
11. Si tu vois `DATABASE_URL absente`, refais les points 6 à 8. Si tu vois une erreur de connexion, vérifie que tu as bien collé l'adresse entière.
12. Vérification facultative : dans Neon, menu **Tables** : une trentaine de tables sont apparues (`ferme`, `zone`, `membre`…).

### Générer la clé qui signe les connexions

13. Dans le même terminal, écris puis Entrée :

    ```
    pnpm --filter @planif/api cles
    ```

14. Ce que tu dois voir : **une seule longue ligne** qui commence par `{"keys":[{` et finit par `}]}`.
15. Sélectionne toute cette ligne à la souris, copie-la et colle-la dans ton gestionnaire sous le nom `JWT_CLES_PRIVEES`. C'est un secret : ne la montre à personne.

### Créer l'utilisateur de synchro dans Neon

PowerSync lit la base avec un compte à part, qui ne peut rien écrire. Cette partie se fait dans Neon, pas dans le terminal.

16. Dans Neon, menu **SQL Editor**.
17. Invente un mot de passe long (20 caractères ou plus, lettres et chiffres, sans apostrophe) et enregistre-le dans ton gestionnaire sous `Mot de passe powersync_role`.
18. Colle ceci dans l'éditeur, en remplaçant `MOT_DE_PASSE_ICI` par ce mot de passe (garde les apostrophes autour) :

    ```sql
    CREATE ROLE powersync_role WITH REPLICATION LOGIN PASSWORD 'MOT_DE_PASSE_ICI';
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
    REVOKE SELECT ON code_connexion, jeton_renouvellement FROM powersync_role;
    ```

    Les deux premières lignes sont celles de la documentation PowerSync (lecture seule). La dernière retire l'accès aux codes de connexion et aux jetons, que la synchro n'utilise jamais. Les droits de réplication suffisent pour le reste : la publication `powersync` a déjà été créée par les migrations.

19. Clique sur **Run**.
20. Ce que tu dois voir : un message de réussite, sans ligne rouge. Si `role "powersync_role" already exists` : le rôle existe déjà ; exécute seulement les trois dernières lignes.

### Fermer Codespaces

21. Ferme l'onglet. Pour libérer ta réserve gratuite : sur https://github.com/codespaces, clique sur les trois points à côté de ton codespace, puis **Delete**. L'adresse de la base disparaît avec lui.

---

## Étape 2 bis — Poser le secret DATABASE_URL_PRODUCTION : migrations automatiques

Une fois ce secret posé, plus besoin de Codespaces après chaque mise à jour : dès que la CI de `main` est verte, le workflow GitHub **Migrations de production** applique les nouvelles migrations sur Neon. Sans ce secret, il ne fait rien (il reste vert, avec le message « secret DATABASE_URL_PRODUCTION absent »).

Le secret est chiffré par GitHub : personne ne peut le relire, ni toi, ni Claude, ni les visiteurs du dépôt public. On le range dans un **environnement** nommé `production`, réservé à la branche `main` : il n'est donné qu'aux tâches qui tournent sur `main`, dans l'environnement `production`, jamais à une autre branche ni à une PR. (Un secret « de dépôt » ordinaire serait lisible par n'importe quelle branche poussée : c'est pour cela qu'on ne l'utilise pas.)

1. Ouvre https://github.com/thoy-le-duc/Planifications/settings/environments (ou, sur la page du dépôt : onglet **Settings**, menu de gauche **Environments**).
2. Clique sur **New environment**, écris `production`, puis **Configure environment**. Si `production` est déjà dans la liste (créé tout seul par un premier lancement du workflow), clique simplement dessus.
3. Rubrique **Deployment branches and tags** : choisis **Selected branches and tags**, puis **Add deployment branch or tag rule**, écris `main`, et **Add rule**. Ce que tu dois voir : une seule règle, `main`.
4. Facultatif : coche **Required reviewers** et ajoute-toi. Chaque migration attendra alors ton clic **Approve and deploy** dans l'onglet **Actions** (plus sûr, mais moins automatique). Puis **Save protection rules**.
5. Plus bas, rubrique **Environment secrets** : clique sur **Add environment secret**.
6. **Name** : écris exactement `DATABASE_URL_PRODUCTION`.
7. **Value** : colle l'adresse **directe** de Neon (`Neon directe`, celle **sans** `-pooler`), depuis ton gestionnaire.
8. Clique sur **Add secret**. Ce que tu dois voir : `DATABASE_URL_PRODUCTION` dans la liste **Environment secrets**, sans sa valeur.
9. Vérification : onglet **Actions**, à gauche **Migrations de production**, bouton **Run workflow**, branche `main`, puis **Run workflow**. Au bout d'une à deux minutes, la ligne passe au vert ; en l'ouvrant, l'étape « Migrations, ou arrêt propre si le secret est absent » se termine par **`Migrations appliquées.`**

Pour changer l'adresse (nouveau mot de passe Neon) : même page **Environments** → `production`, crayon à côté de `DATABASE_URL_PRODUCTION`, colle la nouvelle, **Update secret**.

---

## Étape 3 — PowerSync Cloud : la synchro

1. Ouvre https://www.powersync.com et clique sur **Sign up** (ou **Dashboard**).
2. Crée ton compte.
3. Ce que tu dois voir : le tableau de bord PowerSync, avec un bouton pour créer un projet.
4. Clique sur **Create project**, nom : `planifications`.
5. PowerSync crée tout seul deux instances, **Development** et **Production**. Prends **Development** pour l'instant (l'offre gratuite en autorise deux). Si PowerSync te propose une région, choisis **Europe** (Irlande ou Francfort) : tes données doivent rester en UE. Si aucune région n'est proposée, note-le et préviens Claude avant d'aller plus loin.
6. Ce que tu dois voir : l'écran de l'instance, avec une vue **Database Connection** dans le menu.

### Connexion à Neon

7. Ouvre **Database Connection** et choisis l'onglet **Postgres**.
8. Remplis les champs à partir de l'adresse **directe** de Neon (`Neon directe`). Elle se lit ainsi : `postgresql://UTILISATEUR:MOT_DE_PASSE@HÔTE/BASE?sslmode=require`.
   - Host : l'hôte (par exemple `ep-xxxx.eu-central-1.aws.neon.tech`), **sans** `-pooler`.
   - Port : `5432`.
   - Database : `neondb`.
   - Username : `powersync_role`.
   - Password : celui de `Mot de passe powersync_role`.
   - SSL Mode : `verify-full`.
9. Clique sur **Test Connection**.
10. Ce que tu dois voir : un message de réussite (ou une coche verte). Si ça échoue : l'adresse utilisée contient encore `-pooler`, ou la réplication n'est pas activée (étape 1, points 10 à 12).
11. Clique sur **Save Connection**. La mise en place peut prendre quelques minutes.

### Règles de synchro

12. Dans le dépôt GitHub, ouvre le fichier `powersync/sync-config.yaml` et clique sur **Raw** ou sur le bouton de copie. Copie **tout** le contenu.
13. Dans PowerSync, ouvre la vue **Sync Streams** (l'éditeur de règles).
14. Efface ce qui s'y trouve et colle le contenu copié.
15. Clique sur **Deploy** (PowerSync vérifie les règles avant de les mettre en service).
16. Ce que tu dois voir : « Valid » ou « Deployed » sans erreur. Si une erreur parle d'une table introuvable : les migrations (étape 2) n'ont pas été lancées sur cette base.

Ce copier-coller ne se fait qu'**une fois**, à la création de l'instance. Ensuite, c'est l'étape 3 bis qui s'en charge à chaque mise à jour : ne modifie plus les règles dans cet éditeur, le prochain déploiement automatique les remplacerait par celles du dépôt.

### Noter l'adresse de l'instance

17. Clique sur **Connect** dans la barre du haut : la fenêtre affiche l'**adresse** de l'instance (Instance URL). Copie-la. Elle ressemble à `https://xxxxxxxx.powersync.journeyapps.com`.
18. Enregistre-la sous `VITE_POWERSYNC_URL`.

### Authentification (à finir à l'étape 6)

19. La vue **Client Auth** (adresse des clés publiques et audience) se remplit une fois l'appli en ligne : on y revient à l'étape 6. Rien à faire ici.

---

## Étape 3 bis — Poser les secrets PowerSync : règles de synchro automatiques

Quand un ticket change les règles de synchro (`powersync/sync-config.yaml`), il faut les redéployer sur PowerSync, sinon les nouvelles données ne descendent sur aucun téléphone, sans aucune erreur visible (c'est arrivé le 20 octobre avec l'équipe et les produits fertilisants). Une fois ces deux secrets posés, plus de copier-coller : après chaque **Migrations de production** réussi, le workflow GitHub **Règles de synchro PowerSync** fait vérifier les règles par PowerSync, puis les déploie. Si PowerSync les refuse, le workflow passe au **rouge** et rien n'est déployé. Sans ces secrets, il ne fait rien (il reste vert, avec le message « secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID absents »).

Il utilise l'outil officiel de PowerSync, sa CLI (paquet `powersync@0.10.2`, figé dans le dépôt avec toutes ses dépendances, dossier `scripts/powersync-cli` ; voir https://docs.powersync.com/tools/cli et https://github.com/powersync-ja/powersync-cli), avec sa commande `deploy sync-config` : elle ne touche qu'aux règles, jamais à la connexion à Neon ni à l'authentification réglées à l'étape 3. Il lui faut deux secrets et deux variables :

- `POWERSYNC_ADMIN_TOKEN` : un **jeton d'accès personnel** PowerSync (Personal Access Token). Il permet d'administrer ton compte PowerSync, comme un mot de passe.
- `POWERSYNC_INSTANCE_ID` : l'**identifiant de l'instance** dont tu as collé les règles à l'étape 3 (celle de `VITE_POWERSYNC_URL`), 24 caractères, chiffres et lettres de `a` à `f`.
- `POWERSYNC_ORG_ID` et `POWERSYNC_PROJECT_ID` : l'**organisation** et le **projet** de cette instance, 24 caractères chacun. Ce ne sont pas des secrets (ils se lisent dans l'adresse de ton navigateur), donc des **variables** GitHub. Sans eux, la CLI doit les deviner à partir de l'instance, et au moindre échec elle répond « Instance … was not found or is not accessible with the current token » sans dire pourquoi : c'est ce qui est arrivé au premier essai.

Les deux premiers sont des secrets de GitHub, les deux autres des variables de GitHub, pas des variables de l'appli : aucun ne va dans Vercel ni dans le tableau « Les variables, en un coup d'œil ».

Comme à l'étape 2 bis, tous vont dans l'environnement GitHub `production`, réservé à `main`, jamais « de dépôt ».

### Créer le jeton PowerSync

1. Ouvre https://dashboard.powersync.com/account/access-tokens (ou, dans le tableau de bord PowerSync, les réglages de ton compte, rubrique des jetons d'accès).
2. Crée un jeton. Nom : `github-regles-planifications`. Si PowerSync propose une durée de validité, prends la plus longue et **note la date d'expiration** dans ton gestionnaire : à cette date, le workflow passera au rouge et il faudra recommencer ces points 1 à 3 puis 9.
3. Copie le jeton tout de suite (PowerSync ne le remontre pas) et range-le dans ton gestionnaire sous `Jeton PowerSync GitHub`.

### Relever l'identifiant de l'instance

4. Dans le tableau de bord PowerSync, ouvre ton projet `planifications`, puis l'instance de l'étape 3.
5. Relève son identifiant (Instance ID) : 24 caractères, chiffres et lettres de `a` à `f`, par exemple `0123456789abcdef01234567` (celui-ci est inventé). Ce n'est pas un secret au sens strict, mais on le range avec le jeton. Si tu ne le trouves pas, demande à Claude **sans** lui donner le jeton : il te dira où cliquer.
5 bis. Les trois identifiants se lisent d'un coup dans l'adresse du tableau de bord quand l'instance est ouverte : `https://dashboard.powersync.com/org/<ORG>/project/<PROJET>/<INSTANCE>/`. Le premier bloc de 24 caractères après `/org/` est l'organisation, celui après `/project/` le projet, le suivant l'instance. Relève-les un par un, sans espace.

### Poser les deux secrets dans GitHub

6. Ouvre https://github.com/thoy-le-duc/Planifications/settings/environments et clique sur `production` (créé à l'étape 2 bis ; sinon, refais-en les points 2 et 3 : environnement `production`, règle de branche `main` seule).
7. Rubrique **Environment secrets** : clique sur **Add environment secret**, **Name** : écris exactement `POWERSYNC_ADMIN_TOKEN`, **Value** : colle le jeton, sans espace avant ni après, puis **Add secret**.
8. Encore **Add environment secret** : **Name** `POWERSYNC_INSTANCE_ID`, **Value** : l'identifiant de l'instance, puis **Add secret**. Ce que tu dois voir : `POWERSYNC_ADMIN_TOKEN` et `POWERSYNC_INSTANCE_ID` dans la liste **Environment secrets**, sans leur valeur.
8 bis. Même page, rubrique **Environment variables** : clique sur **Add environment variable**, **Name** : `POWERSYNC_ORG_ID`, **Value** : l'organisation relevée au point 5 bis, puis **Add variable**. Encore **Add environment variable** : **Name** `POWERSYNC_PROJECT_ID`, **Value** : le projet, puis **Add variable**. Ce que tu dois voir : les deux noms dans **Environment variables**, avec leur valeur (c'est normal, elles ne sont pas secrètes). Pose les deux ou aucune : le script refuse d'en avoir un seul.
9. Vérification : onglet **Actions**, vérifie d'abord que le dernier **Migrations de production** est vert (lancer les règles avant les migrations peut viser une table pas encore créée). Puis, à gauche, **Règles de synchro PowerSync**, bouton **Run workflow**, branche `main`, puis **Run workflow**. Au bout d'une à trois minutes, la ligne passe au vert. En l'ouvrant : l'étape « Valider les règles de synchro, ou arrêt propre si les secrets sont absents » se termine par **`Règles de synchro valides.`**, puis l'étape « Déployer les règles de synchro, ou arrêt propre si les secrets sont absents » par **`Règles de synchro déployées.`**

Si l'étape de validation est rouge avec « mal formé » ou « absent », c'est le secret nommé qui est à recoller (crayon à côté du secret, **Update secret**). Le message ne montre jamais sa valeur. « Instance … was not found or is not accessible with the current token » : le jeton a été créé sous une autre organisation que celle de l'instance (vérifie, en haut du tableau de bord, que tu étais dans la bonne organisation en le créant), il a été révoqué ou il a expiré (points 1 à 3 et 7), ou l'un des identifiants est faux (points 5 bis et 8 bis). Le message ne montre jamais le jeton.

---

## Étape 4 — Brevo : l'envoi du code par courriel

1. Ouvre https://www.brevo.com et clique sur **Sign up free**.
2. Crée le compte avec l'adresse de la ferme, confirme le courriel reçu, remplis le profil demandé (adresse de la ferme, activité).
3. Ce que tu dois voir : le tableau de bord Brevo.

### Vérifier l'adresse qui enverra les codes

4. Menu en haut à droite (ton nom), **Senders, Domains & Dedicated IPs**, onglet **Senders**.
5. Clique sur **Add a sender**.
6. Nom : `Planifications`. Adresse : une adresse de la ferme que tu peux lire (par exemple `contact@tonnomdedomaine.fr`).
7. Brevo envoie un code de vérification à cette adresse. Ouvre ce courriel et saisis le code dans Brevo.
8. Ce que tu dois voir : l'adresse dans la liste, marquée **Verified** (ou « Active »).
9. Enregistre-la sous `SMTP_EXPEDITEUR`.
10. Bon à savoir : avec une adresse gratuite (Gmail…), les codes peuvent atterrir dans les indésirables. Avec une adresse de ton propre nom de domaine, il vaut mieux valider le **domaine** (onglet **Domains**, Brevo indique les lignes à ajouter chez ton hébergeur de domaine). Pour un premier essai, l'adresse suffit.

### Créer la clé SMTP

11. Menu à droite, **SMTP & API**, onglet **SMTP**.
12. Ce que tu dois voir : un serveur `smtp-relay.brevo.com`, un port `587`, et un **identifiant** (une adresse du type `abc123@smtp-brevo.com`).
13. Enregistre l'identifiant sous `SMTP_UTILISATEUR`.
14. Clique sur **Generate a new SMTP key**, nom : `planifications`.
15. Brevo affiche la clé **une seule fois**. Copie-la tout de suite et enregistre-la sous `SMTP_MOT_DE_PASSE`.
16. Si Brevo demande d'activer l'envoi par SMTP (compte neuf), suis le bouton qu'il propose ou écris à son support : cela peut prendre un jour ouvré.

---

## Étape 5 — Vercel : l'appli et l'API

1. Ouvre https://vercel.com et clique sur **Sign Up**, puis **Continue with GitHub**.
2. Autorise Vercel à lire ton dépôt `planifications` (l'accès à ce seul dépôt suffit).
3. Ce que tu dois voir : ton tableau de bord Vercel. Tu y as peut-être déjà un projet pour la démo : **ne le touche pas**.
4. Clique sur **Add New…** puis **Project**.
5. Dans la liste de tes dépôts GitHub, cherche `planifications` et clique sur **Import**.
6. **Project Name** : `appli` (si le nom est déjà pris, mets `appli-ferme`).
7. **Framework Preset** : `Other`.
8. **Root Directory** : laisse `./` (la **racine du dépôt**, surtout pas `apps/web`, qui est celle de la démo).
9. Ne change pas les commandes de construction : elles sont déjà dans le fichier `vercel.json` du dépôt.
10. Ouvre la section **Environment Variables**.

### Les variables, une par une

Pour chaque ligne : écris le nom **exactement** comme ci-dessous (majuscules, tirets bas), colle la valeur, clique sur **Add**. Laisse les trois environnements cochés (Production, Preview, Development) ou garde au moins **Production**.

11. `DATABASE_URL` : colle l'adresse **pooled** de Neon (`Neon pooled`, celle avec `-pooler` et `sslmode=require`).
12. `JWT_CLES_PRIVEES` : colle la longue ligne `{"keys":[…]}` de l'étape 2.
13. `JWT_EMETTEUR` : `https://appli.vercel.app/api` en remplaçant `appli` par le nom de projet choisi au point 6. On le vérifie au point 25.
14. `JWT_AUDIENCE` : `powersync-planif`
15. `SMTP_HOTE` : `smtp-relay.brevo.com`
16. `SMTP_EXPEDITEUR` : l'adresse vérifiée chez Brevo (étape 4, point 9). Pour un nom lisible : `Planifications <contact@tonnomdedomaine.fr>`.
17. `SMTP_UTILISATEUR` : l'identifiant SMTP de Brevo (étape 4, point 13).
18. `SMTP_MOT_DE_PASSE` : la clé SMTP de Brevo (étape 4, point 15).
19. `PROXY_DE_CONFIANCE` : `1` (le chiffre un). **Obligatoire** : sans elle, la limite de tentatives de connexion se trompe d'adresse.
20. `VITE_POWERSYNC_URL` : l'adresse de ton instance PowerSync (étape 3, point 18).
21. `VITE_API_URL` : **ne la crée pas**, ou crée-la vide. L'appli appelle alors `/api` sur sa propre adresse.
22. Ne crée **pas** `PORT`, `COURRIEL_CONSOLE`, `CORS_ORIGINES`, `SMTP_PORT` ni `SMTP_SECURITE`.

### Déployer

23. Clique sur **Deploy**.
24. Ce que tu dois voir : un écran de construction qui défile (2 à 4 minutes), puis des confettis et « Congratulations ». Si la construction échoue, ouvre le détail rouge et passe à « Que faire si… ».
25. Menu du projet, **Settings**, puis **Domains** : note l'adresse de production (par exemple `https://appli-ferme.vercel.app`). Si elle n'est pas celle que tu as écrite dans `JWT_EMETTEUR`, corrige cette variable (**Settings**, **Environment Variables**, trois points, **Edit**) puis **Deployments**, trois points sur le dernier déploiement, **Redeploy**.
26. Pour la suite, appelons cette adresse `https://<appli>`.

### Vérifier le premier déploiement

27. Dans le navigateur, ouvre `https://<appli>/api/sante`.
28. Ce que tu dois voir : une courte ligne qui contient `"ok":true`.
29. Si tu vois plutôt une page de l'appli, une page 404 ou une erreur, l'adresse `/api/...` n'arrive pas à la fonction : ouvre le projet Vercel, onglet **Logs**, et note le message. Voir « Que faire si… ».
30. Si tu vois `{"erreur":"configuration_invalide"}` : une variable manque ou est mal écrite. L'onglet **Logs** de Vercel donne le **nom** de la variable fautive (jamais sa valeur).
31. Ouvre `https://<appli>/api/.well-known/jwks.json`.
32. Ce que tu dois voir : un texte qui commence par `{"keys":[` avec des champs `kty`, `n`, `e`, `kid`. Il ne doit **pas** contenir de champ `d` : c'est la partie publique de la clé.

---

## Étape 6 — Retour sur PowerSync : donner l'adresse des clés

1. Retourne dans PowerSync, instance **Development** du projet `planifications`, vue **Client Auth**.
2. **JWKS URI** : `https://<appli>/api/.well-known/jwks.json` (la même adresse que celle ouverte au point 31). Ne colle pas les clés elles-mêmes, seulement l'adresse.
3. **Audience** : `powersync-planif` (en toutes lettres, avec le tiret). La documentation de PowerSync ne donne pas le nom exact du champ : cherche « Audience » ou « custom audience » dans cette vue. Sans audience personnalisée, PowerSync refuserait les jetons de l'API.
4. Clique sur **Save and Deploy**.
5. Ce que tu dois voir : la configuration enregistrée, sans erreur.

---

## Étape 7 — Ton premier compte

1. Ouvre `https://<appli>` dans le navigateur (de préférence sur ton téléphone, pour la suite).
2. Ce que tu dois voir : l'écran de connexion qui demande une adresse courriel.
3. Saisis ton adresse et valide.
4. Ouvre ta boîte mail : un message de `Planifications` contient un **code à 6 chiffres**. Compte jusqu'à une minute. Regarde dans les indésirables.
5. Saisis le code dans l'appli.
6. Ce que tu dois voir : l'onglet **Aujourd'hui** avec « Aucune ferme sur ce compte pour l'instant », un champ **Nom de la ferme** et un bouton **Créer ma ferme**. Le même écran est proposé dans les onglets **Planches** et **Ferme** (dans **Ferme**, l'export et « Se déconnecter » restent dessous).
   - Si tu lis « Première synchronisation en cours… » : l'appli vérifie d'abord que ton compte n'a pas déjà une ferme. Le formulaire apparaît dès que c'est fait (quelques secondes). S'il n'apparaît pas, voir « La synchro ne part pas » plus bas.
   - Si tu lis « Pas de réseau » : la première création demande du réseau. Le formulaire revient tout seul quand le téléphone capte.
7. Saisis le nom de ta ferme (200 caractères au plus) et touche **Créer ma ferme**. Le fuseau horaire est Europe/Paris. Pour le changer, il n'y a pas encore d'écran : demande-le à Claude.
8. Ce que tu dois voir : « Ferme créée, synchronisation… », puis, au bout de quelques secondes, ta ferme vide (sans les données de la démo) dans l'onglet **Aujourd'hui**. Tu en es le gérant. Si un message s'affiche à la place (« Pas de réseau », « Votre session a expiré », « Ce nom de ferme n'est pas accepté »), ce que tu as tapé reste dans le champ : corrige ou réessaie.
9. Pour vérifier la synchro : ajoute une zone ou une planche (étape 8, ci-dessous), puis ouvre l'appli sur un autre appareil avec la même adresse courriel. Au bout de quelques secondes, la zone doit apparaître.
10. Installe l'appli sur le téléphone : elle aura son icône sur l'écran d'accueil, s'ouvrira en plein écran, comme une application, et marchera aussi sans réseau. L'appli le propose elle-même :
    - **Android (Chrome)** : un bandeau « Installer l'appli » apparaît en bas de l'onglet **Aujourd'hui** (jamais pendant une saisie), et la carte **Installer sur ce téléphone** reste dans l'onglet **Ferme**. Touche **Installer l'appli**, puis **Installer** dans la fenêtre du navigateur. Le bouton n'apparaît qu'une fois que Chrome juge l'appli installable : si tu ne le vois pas à la première visite, recharge la page au bout de quelques secondes. Si tu refuses la fenêtre du navigateur, la carte reste : le bouton te rappelle alors le geste du navigateur (menu **⋮**, puis **Installer l'application**).
    - **iPhone (Safari)** : le même bouton ouvre une courte aide : touche **Partager** (le carré avec une flèche, en bas de Safari), puis **Sur l'écran d'accueil**, et **Ajouter**.
    - Une fois l'appli installée et ouverte depuis son icône, la carte et le bandeau ne s'affichent plus. Le bandeau fermé d'un tap (ou après un tap sur « Installer l'appli ») ne revient pas ; la carte de l'onglet **Ferme** reste là tant que l'appli n'est pas installée.

Il n'y a pas de mot de passe : à chaque nouvelle connexion, un nouveau code arrive par courriel.

---

## Étape 8 — Démarrer sa ferme

Une ferme neuve est vide : ni saison, ni planche, ni série. L'appli le dit et guide, sans tableur, même hors ligne. Compte une vingtaine de minutes pour une première saison utilisable.

1. Ouvre l'onglet **Aujourd'hui**. Ce que tu dois voir : en haut, la carte **Démarrer votre ferme** avec quatre étapes (1. Créer la saison, 2. Ajouter zones et planches, 3. Choisir vos itinéraires, 4. Planifier une première série) et « 0/4 ». La même carte est en haut de l'onglet **Planches**. Chaque étape se coche toute seule quand elle est faite.
   - Tu as déjà un tableur (Elzéard, Excel, CSV) ? Touche **Importer un tableur** en bas de la carte : l'import remplit saisons, zones, planches et séries d'un coup. Tu peux ensuite reprendre ici les étapes qui manquent.
2. Touche **1. Créer la saison**. L'onglet **Ferme** s'ouvre sur **Ma ferme**. Touche **Créer la saison 2026** (l'année en cours) : la saison va du 1er janvier au 31 décembre. Pour d'autres dates, touche la saison, change **Début** ou **Fin**, puis **Enregistrer**. **Nouvelle saison** en ajoute une autre (2027 est proposée).
3. Toujours dans **Ma ferme**, touche **Nouvelle zone** : un nom (« Tunnel 1 », « Champ du bas »), le type d'abri (plein champ, tunnel, serre, hors-sol), et, pour une chapelle ou un sous-îlot, **Dans la zone** (la zone qui la contient). **Enregistrer**.
4. Touche la zone pour l'ouvrir, puis, dans **Ajouter des planches** : le nombre (10), le préfixe du code (« P », ou « T1-P »), la longueur et la largeur en mètres (30 et 0,8 ; la virgule marche). L'appli affiche les codes qu'elle va créer (« P1 à P10 ») ; touche **Ajouter les planches**. Ajouter de nouveau continue la numérotation (P11…). Deux zones peuvent avoir chacune leur « P1 ».
5. Une planche se corrige en la touchant : code, sorte (planche, rang, gouttière avec son nombre de places), longueur, largeur. **Mettre hors service** la retire des nouvelles séries sans effacer son historique ; **Supprimer la planche** n'est possible que si aucune culture ne l'occupe. Une zone ou une saison ne se supprime que vide : l'appli dit ce qui la retient (« 2 planches », « 1 série »).
6. Chaque enregistrement affiche un bandeau vert **Annuler** pendant 10 secondes : un tap défait tout le geste (les 10 planches d'un coup, par exemple).
7. Reviens à **Aujourd'hui** : les étapes 1 et 2 sont cochées. L'étape 3 (**Choisir vos itinéraires**) est facultative : la bibliothèque propose déjà des itinéraires, et **Mes itinéraires** permet de les adapter à ta façon de cultiver.
8. Touche **4. Planifier une première série** : l'onglet **Planches** s'ouvre sur **Nouvelle série**. Choisis la culture, garde l'itinéraire proposé, ajoute une planche, **Planifier la série**. Ce que tu dois voir : la série sur le plan des planches, ses travaux dans **Aujourd'hui**, et la carte **Démarrer votre ferme** disparaît.
   - Tant qu'il manque une saison ou des planches, **Planches** et **Aujourd'hui** le disent avec un bouton qui mène à ce qui manque.

Tout ce que tu crées ici se synchronise tout seul dès que le téléphone capte ; un équipier peut le faire aussi.

Tes données t'appartiennent : l'export complet (JSON et CSV) se fait en un clic depuis l'appli, à tout moment.

---

## Ce qui reste gratuit et ses limites

**Chiffres relevés sur les sites officiels en octobre 2026.** Les offres gratuites changent : revérifie la page indiquée avant de compter dessus.

| Service | Ce qui est gratuit | Limite à surveiller | Où vérifier |
| --- | --- | --- | --- |
| Neon (Free) | 1 Go de stockage par projet, 100 heures de calcul (CU-heures) par projet, 5 Go de transfert sortant | le calcul s'endort après 5 minutes sans usage (la première requête après une pause prend une à deux secondes de plus). Si le plafond d'heures est atteint, la base s'arrête jusqu'au mois suivant | https://neon.com/pricing |
| PowerSync Cloud (Free) | 2 instances, 2 Go synchronisés par mois, 500 Mo hébergés, 50 clients connectés en même temps au maximum | une instance sans activité est désactivée après une à deux semaines (la page est contradictoire) : la réactiver depuis le tableau de bord. Assistance par la communauté seulement | https://www.powersync.com/pricing |
| Brevo (Free) | 300 courriels par jour | un code de connexion = un courriel : très largement suffisant pour une ferme | https://www.brevo.com/free-smtp-server |
| Vercel (Hobby) | 1 million d'appels de fonction, 100 Go de transfert, 4 heures de calcul actif par mois, 100 déploiements par jour | usage **non commercial** uniquement (confirmé par Vercel) : parfait pour tester, à revoir pour vendre le service. Les journaux (Logs) ne sont gardés qu'**une heure** : regarde-les tout de suite après une erreur | https://vercel.com/docs/plans/hobby |
| GitHub Codespaces | 120 heures-cœur par mois (soit 60 heures sur la petite machine à 2 cœurs) et 15 Go-mois de stockage, compte GitHub gratuit | supprime le codespace après usage (étape 2, point 21) | https://docs.github.com/en/billing/concepts/product-billing/github-codespaces |

Tant que tu es seul à tester avec ta ferme, tu n'approcheras aucune de ces limites. Si un service t'écrit qu'un quota est presque atteint, note-le et préviens Claude : on verra alors pour une offre payante (« on verra pour du sérieux plus tard »).

---

## Que faire si…

**Je ne reçois pas le code à 6 chiffres.**
1. Regarde les indésirables, puis attends deux minutes.
2. Dans Brevo, menu **Transactional**, puis **Logs** : le message y est-il ? S'il est « Blocked » ou « Rejected », l'adresse d'envoi n'est pas vérifiée (étape 4, points 4 à 8).
3. S'il n'y a aucune ligne dans Brevo : dans Vercel, onglet **Logs** (journaux gardés une heure seulement : refais une demande de code juste avant), cherche un message d'envoi en échec. Vérifie `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` (la clé SMTP, pas le mot de passe de ton compte Brevo) et `SMTP_EXPEDITEUR`.
4. Après toute correction d'une variable : **Deployments**, trois points, **Redeploy**.

**La synchro ne part pas (rien n'apparaît sur l'autre appareil).**
1. Dans PowerSync, l'instance est-elle en marche (pastille verte) et la connexion à la base valide ? Sinon refais l'étape 3, points 7 à 11.
2. Y a-t-il une erreur dans les règles ? Onglet **Actions** de GitHub, **Règles de synchro PowerSync** : le dernier passage est-il vert, et a-t-il vraiment déployé (« Règles de synchro déployées. ») et non seulement constaté l'absence des secrets (étape 3 bis) ?
3. L'adresse des clés (étape 6) est-elle exacte ? Ouvre-la toi-même dans le navigateur : elle doit afficher des clés.
4. `VITE_POWERSYNC_URL` est-elle bien posée dans Vercel ? Une variable `VITE_…` n'agit qu'au moment de la construction : après l'avoir changée, il faut **Redeploy**.
5. `JWT_AUDIENCE` (Vercel) et l'audience de PowerSync doivent être identiques : `powersync-planif`.

**`/api/sante` répond une erreur ou une page de l'appli.**
1. Vercel, onglet **Deployments** : le dernier déploiement est-il « Ready » ?
2. Vercel, **Settings**, **General** : **Root Directory** doit être la racine du dépôt (vide ou `./`), pas `apps/web`.
3. Vercel, onglet **Logs** (filtre Functions) : y a-t-il une fonction `api/[...route]` ? Si non, note la construction : le fichier `vercel.json` n'a pas été pris en compte.
4. Ouvre `/api/nexiste` : tu dois voir une réponse 404 **de l'API** (un petit texte), pas la page de l'appli. Si c'est la page de l'appli, la réécriture vers la fonction ne passe pas ; dis-le à Claude avec l'adresse exacte.
5. Si l'API répond mais avec un chemin décalé (la fonction ne reconnaît pas `/api/sante`), c'est le point que ce premier déploiement devait vérifier : note l'adresse testée et le texte reçu et transmets-les à Claude. Ne bricole pas la configuration.

**La fonction est en erreur (`configuration_invalide`, erreur 500).**
1. Vercel, onglet **Logs** : le message donne le **nom** de la variable qui manque ou est mal écrite.
2. Corrige-la (**Settings**, **Environment Variables**) puis **Redeploy**.
3. Cas fréquents : `JWT_CLES_PRIVEES` coupée en collant (elle doit tenir en une ligne qui finit par `}]}`), `SMTP_MOT_DE_PASSE` trop courte (moins de 12 caractères : ce n'est pas la bonne clé), `PROXY_DE_CONFIANCE` autre chose que `1` ou `0`.
4. Un avertissement qui parle de `PROXY_DE_CONFIANCE` absente : pose-la à `1`.

**La construction échoue sur Vercel.**
1. Ouvre le déploiement en rouge, descends tout en bas du journal et copie les dix dernières lignes (sans variable ni adresse de base).
2. Transmets-les à Claude, avec le nom du projet. Cela vient presque toujours du code, pas de toi.

**Le workflow « Migrations de production » est rouge (onglet Actions).**
1. Ouvre-le : l'étape « Migrations, ou arrêt propre si le secret est absent » donne le code et le message de l'erreur (jamais l'adresse, l'hôte ni l'utilisateur). Rien d'autre n'a été tenté.
2. Erreur de connexion ou d'authentification : le secret contient peut-être l'adresse pooled, une adresse tronquée ou un ancien mot de passe ; remplace-le (étape 2 bis), puis **Re-run jobs**.
3. Autre erreur : transmets-la à Claude (le message, sans adresse). En attendant, l'appli continue de tourner sur l'ancienne version des tables.

**Le workflow « Règles de synchro PowerSync » est rouge (onglet Actions).**
1. Ouvre-le. « mal formé » ou « absent » : recolle le secret nommé (étape 3 bis, points 7 et 8), puis **Re-run jobs**.
2. « Instance … was not found or is not accessible with the current token » : jeton créé sous une autre organisation, révoqué ou expiré ; crée-en un autre dans la bonne organisation (étape 3 bis, points 1 à 3) et remplace `POWERSYNC_ADMIN_TOKEN`. Vérifie aussi les variables `POWERSYNC_ORG_ID` et `POWERSYNC_PROJECT_ID` (points 5 bis et 8 bis).
3. Règles refusées par PowerSync (validation en échec) : rien n'a été déployé, les téléphones gardent les anciennes règles. Transmets le message à Claude : cela vient du code, pas de toi.

**Les migrations échouent (étape 2, à la main en secours).**
1. `DATABASE_URL absente` : refais la saisie cachée (points 6 à 8).
2. Erreur de connexion ou d'authentification : tu as peut-être collé l'adresse pooled ou une adresse tronquée ; recopie l'adresse **directe**.
3. Tu peux relancer la commande sans risque : les migrations déjà passées ne sont pas rejouées.

**J'ai collé un secret au mauvais endroit (conversation, ticket, fichier du dépôt).**
1. Considère-le comme perdu et change-le tout de suite : mot de passe Neon (**Roles**, trois points, **Reset password**), clé SMTP Brevo (supprime-la et crée-en une autre), clés de signature (génère-en une nouvelle à l'étape 2). Après un nouveau mot de passe Neon, remplace aussi le secret `DATABASE_URL_PRODUCTION` (étape 2 bis). Un jeton PowerSync : révoque-le sur https://dashboard.powersync.com/account/access-tokens, crée-en un autre et remplace `POWERSYNC_ADMIN_TOKEN` (étape 3 bis).
2. Mets la nouvelle valeur dans Vercel et **Redeploy**. Un changement de `JWT_CLES_PRIVEES` déconnecte tout le monde : on se reconnecte avec un nouveau code.
3. Un secret écrit dans le dépôt **public** reste visible dans l'historique même effacé : ne compte que sur le remplacement.

---

## Rappels de sécurité

- **Jamais** de mot de passe, de clé ni d'adresse de base de données dans une conversation avec Claude, dans un ticket, dans une PR ou dans un fichier du dépôt. Claude n'en a jamais besoin : il te dit où cliquer, tu colles toi-même.
- Le dépôt est **public jusqu'au 1er novembre** : tout y est lisible. Les secrets restent chez Vercel, Neon, PowerSync et Brevo, et dans ton gestionnaire de mots de passe.
- Le terminal de l'étape 2 ne garde pas l'adresse de la base (saisie cachée, codespace supprimé ensuite).
- Le secret `DATABASE_URL_PRODUCTION` (étape 2 bis) est un secret de l'environnement `production`, réservé à `main` : il n'est donné qu'aux tâches qui tournent sur `main`, dans cet environnement (le workflow **Migrations de production**, lancé après une CI verte de `main` ou à la main) ; jamais à une autre branche, à une PR ni à une copie (fork) du dépôt. GitHub masque sa valeur dans les journaux, et `migrer` n'affiche en cas d'erreur ni l'adresse, ni l'hôte, ni l'utilisateur.
- Les secrets `POWERSYNC_ADMIN_TOKEN` et `POWERSYNC_INSTANCE_ID` (étape 3 bis) sont rangés de la même façon, dans l'environnement `production` : seul le workflow **Règles de synchro PowerSync** les reçoit, sur `main`. Le jeton donne la main sur tout ton compte PowerSync (toutes les instances) : ne le colle nulle part ailleurs, et révoque-le au moindre doute. Le script qui l'utilise ne l'affiche jamais, et GitHub le masque dans les journaux.
- La clé `JWT_CLES_PRIVEES` signe les connexions : qui la possède peut se faire passer pour n'importe qui. Elle ne sort que de ton terminal vers Vercel.
- L'utilisateur `powersync_role` ne peut que **lire** la base. S'il fuite, change son mot de passe dans Neon et dans PowerSync.
- L'adresse `https://<appli>/api/.well-known/jwks.json` est publique par nature : elle ne contient que la partie publique des clés.
- Après le 1er novembre, ce guide reste valable : on pourra rendre le dépôt privé sans rien changer à ce qui est en ligne (Vercel garde son accès).
