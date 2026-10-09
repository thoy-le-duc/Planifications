# Mettre l'appli en ligne, pas à pas

Ce guide est pour Théophane. Il ne demande aucune connaissance de programmation : on clique, on copie, on colle. Prévoir **une heure**, un ordinateur (pas un téléphone) et la boîte mail de la ferme.

Le résultat : l'appli sur une adresse du type `https://appli-ferme.vercel.app`, avec ta vraie ferme, ton compte, et la synchro entre appareils. Tout est **gratuit** pendant la phase de développement (limites en fin de guide).

## Avant de commencer

- Ne donne **jamais** un mot de passe, une clé ou une adresse de base de données à Claude, dans un ticket, un message ou un fichier du dépôt. Tu les copies d'un site à un autre, et c'est tout.
- Le dépôt GitHub est **public jusqu'au 1er novembre** : tout ce qui y est écrit est lisible par n'importe qui. Raison de plus pour ne rien y mettre.
- Garde un **gestionnaire de mots de passe** (ou, à défaut, un carnet papier) ouvert : plusieurs valeurs seront à recopier plus tard.
- Ordre à suivre : Neon, migrations, PowerSync, Brevo, Vercel, retour sur PowerSync, premier compte.

### Ce que tu vas manipuler

| Service | À quoi il sert | Où |
| --- | --- | --- |
| Neon | la base de données (tes cultures, ta ferme) | Francfort (UE) |
| PowerSync Cloud | la synchro entre téléphone et base | UE |
| Brevo | l'envoi du code à 6 chiffres par courriel | UE |
| Vercel | l'appli et l'API (Paris) | Paris |
| GitHub Codespaces | un petit terminal dans le navigateur, une seule fois, pour préparer la base | navigateur |

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
15. Active l'interrupteur **Connection pooling** : l'adresse affichée contient maintenant `-pooler` dans son nom d'hôte. C'est l'adresse **pooled**.
16. Clique sur **Copy snippet** ou sur l'œil puis la copie, et colle-la dans ton gestionnaire de mots de passe sous le nom `Neon pooled`. Elle ressemble à `postgresql://neondb_owner:…@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
17. Désactive l'interrupteur **Connection pooling** : l'adresse perd le `-pooler`. C'est l'adresse **directe**.
18. Copie-la et enregistre-la sous le nom `Neon directe`.
19. Pourquoi deux adresses : l'appli en ligne utilise la **pooled** (elle supporte beaucoup de petites connexions). Les migrations et la synchro ont besoin de la **directe**.

Ces adresses contiennent ton mot de passe de base. Elles ne vont que dans ton gestionnaire, dans le terminal de l'étape 2, dans Vercel et dans PowerSync.

---

## Étape 2 — Migrations : créer les tables

Les « migrations » créent les tables vides de ta ferme dans Neon. On les lance une seule fois (et à chaque mise à jour qui en apporte de nouvelles).

**La voie que nous choisissons : GitHub Codespaces.** C'est un petit ordinateur prêté par GitHub, dans ton navigateur, qui a déjà tout ce qu'il faut. Rien à installer sur ton ordinateur, et on le supprime après. Le terminal reste chez toi : l'adresse de la base ne passe par aucune conversation et n'est écrite dans aucun fichier du dépôt.

*Pourquoi pas depuis ton ordinateur ?* Cela marche aussi, mais il faut y installer Node 22 et pnpm. Pour un non-développeur, Codespaces est plus court. Pourquoi pas la console Vercel ? Elle n'offre pas de terminal.

### Ouvrir le terminal

1. Ouvre le dépôt sur GitHub : https://github.com/thoy-le-duc/planifications
2. Clique sur le bouton vert **Code**, onglet **Codespaces**, puis **Create codespace on main**.
3. Ce que tu dois voir : au bout d'une à deux minutes, un éditeur de code dans le navigateur, avec une zone **Terminal** en bas. Si elle est cachée : menu **Terminal**, puis **New Terminal**.
4. Dans le terminal, écris `pnpm install` puis Entrée. Si le message est « pnpm : commande introuvable », écris d'abord `corepack enable` puis Entrée, et recommence `pnpm install`.
5. Ce que tu dois voir : une série de lignes, puis `Done in …`.

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
    ```

19. Clique sur **Run**.
20. Ce que tu dois voir : un message de réussite, sans ligne rouge. Si `role "powersync_role" already exists` : le rôle existe déjà, passe à la suite.

### Fermer Codespaces

21. Ferme l'onglet. Pour libérer ta réserve gratuite : sur https://github.com/codespaces, clique sur les trois points à côté de ton codespace, puis **Delete**. L'adresse de la base disparaît avec lui.

---

## Étape 3 — PowerSync Cloud : la synchro

1. Ouvre https://www.powersync.com et clique sur **Sign up** (ou **Dashboard**).
2. Crée ton compte.
3. Ce que tu dois voir : le tableau de bord PowerSync, avec un bouton pour créer un projet.
4. Clique sur **Create project**, nom : `planifications`. Environnement : **Development** est suffisant pour tester.
5. Crée une **instance** dans ce projet. Région : **Europe** (Irlande ou Francfort si le choix existe).
6. Ce que tu dois voir : un écran de configuration de l'instance, avec l'onglet de la **connexion à la base** (Database connections).

### Connexion à Neon

7. Ajoute une connexion **PostgreSQL**.
8. Remplis les champs à partir de l'adresse **directe** de Neon (`Neon directe`). Elle se lit ainsi : `postgresql://UTILISATEUR:MOT_DE_PASSE@HÔTE/BASE?sslmode=require`.
   - Host : l'hôte (par exemple `ep-xxxx.eu-central-1.aws.neon.tech`), **sans** `-pooler`.
   - Port : `5432`.
   - Database : `neondb`.
   - Username : `powersync_role`.
   - Password : celui de `Mot de passe powersync_role`.
   - SSL Mode : `verify-full`.
9. Clique sur **Test connection**.
10. Ce que tu dois voir : « Connection successful » (ou une coche verte). Si ça échoue : l'adresse utilisée contient encore `-pooler`, ou la réplication n'est pas activée (étape 1, points 10 à 12).
11. Clique sur **Save** (ou **Deploy**).

### Règles de synchro

12. Dans le dépôt GitHub, ouvre le fichier `powersync/sync-config.yaml` et clique sur **Raw** ou sur le bouton de copie. Copie **tout** le contenu.
13. Dans PowerSync, ouvre l'éditeur de règles (**Sync Streams** ou **Sync Rules**).
14. Efface ce qui s'y trouve et colle le contenu copié.
15. Clique sur **Validate**, puis **Deploy**.
16. Ce que tu dois voir : « Valid » ou « Deployed » sans erreur. Si une erreur parle d'une table introuvable : les migrations (étape 2) n'ont pas été lancées sur cette base.

### Noter l'adresse de l'instance

17. En haut de l'instance, copie son **adresse** (Instance URL). Elle ressemble à `https://xxxxxxxx.powersync.journeyapps.com`.
18. Enregistre-la sous `VITE_POWERSYNC_URL`.

### Authentification (à finir après l'étape 5)

19. Ouvre l'onglet **Client Auth** de l'instance.
20. Audience : écris `powersync-planif` (en toutes lettres, avec le tiret) et enregistre.
21. L'adresse des clés publiques (JWKS URI) ne peut être remplie qu'une fois l'appli en ligne : on y revient à l'étape 6.

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

1. Retourne dans PowerSync, instance `planifications`, onglet **Client Auth**.
2. **JWKS URI** : `https://<appli>/api/.well-known/jwks.json` (la même adresse que celle ouverte au point 31).
3. **Audience** : `powersync-planif` (déjà saisie à l'étape 3).
4. Enregistre, puis **Deploy** si le bouton est proposé.
5. Ce que tu dois voir : la configuration enregistrée, sans erreur.

---

## Étape 7 — Ton premier compte

1. Ouvre `https://<appli>` dans le navigateur (de préférence sur ton téléphone, pour la suite).
2. Ce que tu dois voir : l'écran de connexion qui demande une adresse courriel.
3. Saisis ton adresse et valide.
4. Ouvre ta boîte mail : un message de `Planifications` contient un **code à 6 chiffres**. Compte jusqu'à une minute. Regarde dans les indésirables.
5. Saisis le code dans l'appli.
6. Ce que tu dois voir : l'écran de création de la ferme.
7. Saisis le nom de ta ferme et valide.
8. Ce que tu dois voir : ta ferme vide, sans les données de la démo.
9. Pour vérifier la synchro : ajoute une zone ou une planche, puis ouvre l'appli sur un autre appareil avec la même adresse courriel. Au bout de quelques secondes, la zone doit apparaître.
10. Sur le téléphone, utilise « Ajouter à l'écran d'accueil » : l'appli se comporte alors comme une application, et marche aussi sans réseau.

Il n'y a pas de mot de passe : à chaque nouvelle connexion, un nouveau code arrive par courriel.

Tes données t'appartiennent : l'export complet (JSON et CSV) se fait en un clic depuis l'appli, à tout moment.

---

## Ce qui reste gratuit et ses limites

**Les chiffres ci-dessous sont indicatifs, de mémoire : à vérifier sur le site de chaque service avant de compter dessus.** Les offres gratuites changent régulièrement.

| Service | Ce qui est gratuit | Limite à surveiller | Où vérifier |
| --- | --- | --- | --- |
| Neon (Free) | un petit projet, quelques centaines de Mo de stockage, de quoi tourner quelques dizaines d'heures de calcul par mois (à vérifier sur le site) | la base s'endort après quelques minutes sans usage : la première requête après une pause prend une à deux secondes de plus | https://neon.com/pricing |
| PowerSync Cloud (Free) | une instance de développement, quelques Go synchronisés par mois et quelques dizaines de connexions simultanées (à vérifier sur le site) | l'instance peut être mise en pause après une période sans activité : la réactiver depuis le tableau de bord | https://www.powersync.com/pricing |
| Brevo (Free) | environ 300 courriels par jour (à vérifier sur le site) | un code de connexion = un courriel : très largement suffisant pour une ferme | https://www.brevo.com/pricing/ |
| Vercel (Hobby) | hébergement de l'appli et des fonctions, quota mensuel de trafic et de temps de calcul (à vérifier sur le site) | l'offre Hobby est réservée à un usage **non commercial** : parfait pour tester, à revoir pour vendre le service | https://vercel.com/pricing |
| GitHub Codespaces | quelques dizaines d'heures par mois pour un compte personnel (à vérifier sur le site) | supprime le codespace après usage (étape 2, point 21) | https://github.com/features/codespaces |

Tant que tu es seul à tester avec ta ferme, tu n'approcheras aucune de ces limites. Si un service t'écrit qu'un quota est presque atteint, note-le et préviens Claude : on verra alors pour une offre payante (« on verra pour du sérieux plus tard »).

---

## Que faire si…

**Je ne reçois pas le code à 6 chiffres.**
1. Regarde les indésirables, puis attends deux minutes.
2. Dans Brevo, menu **Transactional**, puis **Logs** : le message y est-il ? S'il est « Blocked » ou « Rejected », l'adresse d'envoi n'est pas vérifiée (étape 4, points 4 à 8).
3. S'il n'y a aucune ligne dans Brevo : dans Vercel, onglet **Logs**, cherche un message d'envoi en échec. Vérifie `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` (la clé SMTP, pas le mot de passe de ton compte Brevo) et `SMTP_EXPEDITEUR`.
4. Après toute correction d'une variable : **Deployments**, trois points, **Redeploy**.

**La synchro ne part pas (rien n'apparaît sur l'autre appareil).**
1. Dans PowerSync, l'instance est-elle en marche (pastille verte) et la connexion à la base valide ? Sinon refais l'étape 3, points 7 à 11.
2. Y a-t-il une erreur dans les règles (étape 3, points 12 à 16) ?
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

**Les migrations échouent (étape 2).**
1. `DATABASE_URL absente` : refais la saisie cachée (points 6 à 8).
2. Erreur de connexion ou d'authentification : tu as peut-être collé l'adresse pooled ou une adresse tronquée ; recopie l'adresse **directe**.
3. Tu peux relancer la commande sans risque : les migrations déjà passées ne sont pas rejouées.

**J'ai collé un secret au mauvais endroit (conversation, ticket, fichier du dépôt).**
1. Considère-le comme perdu et change-le tout de suite : mot de passe Neon (**Roles**, trois points, **Reset password**), clé SMTP Brevo (supprime-la et crée-en une autre), clés de signature (génère-en une nouvelle à l'étape 2).
2. Mets la nouvelle valeur dans Vercel et **Redeploy**. Un changement de `JWT_CLES_PRIVEES` déconnecte tout le monde : on se reconnecte avec un nouveau code.
3. Un secret écrit dans le dépôt **public** reste visible dans l'historique même effacé : ne compte que sur le remplacement.

---

## Rappels de sécurité

- **Jamais** de mot de passe, de clé ni d'adresse de base de données dans une conversation avec Claude, dans un ticket, dans une PR ou dans un fichier du dépôt. Claude n'en a jamais besoin : il te dit où cliquer, tu colles toi-même.
- Le dépôt est **public jusqu'au 1er novembre** : tout y est lisible. Les secrets restent chez Vercel, Neon, PowerSync et Brevo, et dans ton gestionnaire de mots de passe.
- Le terminal de l'étape 2 ne garde pas l'adresse de la base (saisie cachée, codespace supprimé ensuite).
- La clé `JWT_CLES_PRIVEES` signe les connexions : qui la possède peut se faire passer pour n'importe qui. Elle ne sort que de ton terminal vers Vercel.
- L'utilisateur `powersync_role` ne peut que **lire** la base. S'il fuite, change son mot de passe dans Neon et dans PowerSync.
- L'adresse `https://<appli>/api/.well-known/jwks.json` est publique par nature : elle ne contient que la partie publique des clés.
- Après le 1er novembre, ce guide reste valable : on pourra rendre le dépôt privé sans rien changer à ce qui est en ligne (Vercel garde son accès).
