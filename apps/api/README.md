# @planif/api

API Hono sur Node. Depuis T09 : comptes, fermes et jetons (contrat : en-tête de `src/auth/auth.integration.test.ts`). Depuis T10 : réception des écritures faites hors ligne, `POST /sync/upload` (contrat : en-tête de `src/sync/upload.integration.test.ts`).

## Démarrer

```sh
export DATABASE_URL=postgres://planif:planif@localhost:5432/planif
export JWT_CLES_PRIVEES="$(pnpm --silent --filter @planif/api cles)"
export JWT_EMETTEUR=http://localhost:3000 JWT_AUDIENCE=powersync-planif
COURRIEL_CONSOLE=1 pnpm --filter @planif/api dev
```

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | Postgres, migrations de `@planif/db` appliquées |
| `JWT_CLES_PRIVEES` | JWKS de clés privées RS256 ; la première signe, les suivantes vérifient seulement |
| `JWT_EMETTEUR`, `JWT_AUDIENCE` | Claims `iss` et `aud` (l'audience est celle configurée dans PowerSync) |
| `PORT` | 3000 par défaut |
| `COURRIEL_CONSOLE` | `1` : les e-mails (et donc les codes) s'écrivent dans la console. Développement seulement : refusé si `NODE_ENV=production` |
| `SMTP_HOTE` | Relais SMTP du fournisseur d'e-mail (T09b). Sans lui ni `COURRIEL_CONSOLE=1`, l'API refuse de démarrer |
| `SMTP_SECURITE` | `tls` (port 465), `starttls` (défaut, port 587 : STARTTLS obligatoire, rien ne part en clair) ou `aucune` (en clair : refusé sauf si `NODE_ENV=development` exactement ; absente, `test`, `staging`… → refus) |
| `SMTP_PORT` | Défaut selon `SMTP_SECURITE` |
| `SMTP_EXPEDITEUR` | En-tête From, ex. `Planifications <connexion@planif.fr>` (obligatoire avec `SMTP_HOTE`) |
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | Identifiants du relais, les deux ou aucun ; le mot de passe n'apparaît dans aucun message d'erreur |
| `PROXY_DE_CONFIANCE` | `1` derrière **exactement un** proxy de confiance (celui de production) : l'adresse du client est la **dernière** valeur de `X-Forwarded-For` (celle que ce proxy ajoute) ; si elle n'est pas une adresse IP valide, c'est l'adresse de la socket qui compte. Derrière deux proxys chaînés, la dernière valeur serait celle du premier proxy : ne pas l'utiliser ainsi. Absente ou `0` : adresse de la socket, en-têtes ignorés. Toute autre valeur est refusée |
| `CORS_ORIGINES` | Origines autorisées à appeler l'API depuis un navigateur, séparées par des virgules (`https://app.planif.fr,http://localhost:4174`). Origines exactes, sans `/` final ; aucune par défaut (même origine seulement) |

Aucune valeur secrète par défaut : une variable obligatoire absente arrête le démarrage.

**Envoi d'e-mail (T09b)** : relais SMTP générique (nodemailer), que proposent tous les fournisseurs hébergés en UE. Le choix du fournisseur (contrat, DPA, domaine d'envoi avec SPF, DKIM, DMARC) reste à faire par Théophane ; le code ne dépend que des variables `SMTP_*`.

## Connexion (Q9)

Code à 6 chiffres reçu par e-mail, pas de mot de passe.

| Route | Rôle |
| --- | --- |
| `POST /auth/code` | Envoie un code (10 min, 5 tentatives, usage unique). Adresse avec `, ; : < > ( ) [ ] " \`, un caractère de contrôle, de format (`\p{Cf}`) ou combinant, une forme que NFKC change (pleine chasse, ligature, exposant, signe kelvin…) un blanc braille (U+2800), un point final de domaine ou mal placé (consécutifs, en tête de partie locale ou de domaine, juste avant `@`), vérifiée avant la normalisation et de nouveau après (« İ » en minuscules laisse un combinant ; de même pour `/auth/verifier` et l'invitation) : 400 `email_invalide`, rien d'envoyé. Au plus un envoi par minute, cinq par heure et dix par 24 h glissantes par adresse (429 + `Retry-After`). Un nouveau code invalide le précédent. Même réponse que le compte existe ou non |
| `POST /auth/verifier` | Code → jeton d'accès + jeton de renouvellement. Crée le compte à la première connexion, et vaut acceptation des invitations en attente. Adresse avec séparateur ou caractère de contrôle : 400 `requete_invalide`. À partir de 10 échecs pour une adresse sur 24 h glissantes, tous codes confondus, toute vérification reçoit la même 401 `code_invalide`, même avec le bon code |
| `POST /auth/renouveler` | Jeton de renouvellement → nouveau jeton d'accès **et nouveau jeton de renouvellement** (rotation, T09b), **sans** jeton d'accès valide : les écritures faites hors ligne partent au retour du réseau |
| `POST /auth/deconnexion` | Jeton de renouvellement → 204. Révoque toute la session (T09b). Sans jeton d'accès. Jeton inconnu, révoqué ou expiré : 204 aussi |
| `GET /.well-known/jwks.json` | Clés publiques, pour PowerSync |
| `GET /moi`, `POST /fermes`, `GET`/`PATCH /fermes/:id`, `POST /fermes/:id/membres` | Protégées par `Authorization: Bearer` |

- **Jeton d'accès** : JWT RS256, 1 heure, claims `sub`, `iss`, `aud`, `iat`, `exp` seulement. Jamais la liste des fermes : les droits sont relus en base à chaque requête (`fermesDeLUtilisateur`, `roleDansLaFerme` de `@planif/db`). Un membre retiré perd l'accès tout de suite.
- **Jeton de renouvellement** : 256 bits aléatoires, opaque. Échéance glissante de 90 jours (la session tient donc au moins 30 jours hors ligne), plafonnée à 365 jours après la connexion pour toute la session.
- **Rotation (T09b), règle « successeur jamais utilisé »** : chaque renouvellement rend un jeton neuf, de la même famille (la connexion), dont `parent_id` désigne le jeton présenté. Un jeton déjà utilisé reste acceptable **7 jours** au plus après son premier usage **tant qu'aucun de ses successeurs n'a servi** (réponse perdue au champ, renouvellements simultanés) : il rend un jeton neuf, et ses successeurs inutilisés sont remplacés (`remplace_le`), sans que la famille soit révoquée pour autant. **Présenter un jeton remplacé** prouve deux détenteurs (le téléphone et un voleur qui a rejoué l'ancien) : refusé, et **toute la famille** est révoquée, le dernier jeton rendu compris (personne ne présente un jeton perdu). Dès qu'un successeur a servi, ou au-delà de 7 jours, ou si le jeton déjà utilisé n'a aucun successeur connu (aucune ligne dont `parent_id` le désigne : session d'avant la migration 0011), le présenter est un rejeu (jeton volé ou copié) : refusé, et **toute la famille** est révoquée ; l'utilisateur se reconnecte par code. Les autres sessions du compte ne sont pas touchées. Vérification et émission se font sous un verrou consultatif par famille (`pg_advisory_xact_lock`), pris après lecture de la ligne, qui est relue dessous : un renouvellement lancé en même temps qu'un rejeu ou une déconnexion ne rend jamais un jeton valable. Le téléphone ne présente donc jamais deux fois le même jeton : ses renouvellements passent un par un entre onglets, sous `navigator.locks` (`planif-renouvellement`), et relisent la session rangée ; si un autre onglet vient de renouveler, son jeton d'accès encore valable est repris sans appel réseau.
- **Limite connue, sans `navigator.locks`** : sur un navigateur ancien, ou une page servie en http hors `localhost` (contexte non sécurisé, où `navigator.locks` n'existe pas), les renouvellements ne sont sérialisés que dans chaque onglet. Deux onglets qui renouvellent au même moment peuvent alors présenter le même jeton après que l'un a déjà servi : la famille est révoquée et il faut se reconnecter par code. Jamais le cas en production (https) sur un navigateur récent. Une requête de renouvellement sans réponse est abandonnée au bout de 10 s (`DELAI_RENOUVELLEMENT_MS`, apps/web/src/donnees/jeton.ts) : le verrou est libéré et l'ancien jeton gardé.
- **Purge des jetons** : à chaque renouvellement, les jetons expirés ou révoqués depuis plus de **90 jours** sont effacés (tous comptes confondus).
- **Déconnexion (T09b)** : révoque toute la famille. Limite acceptée : un jeton d'accès déjà émis reste valable jusqu'à son expiration (1 heure au plus) ; PowerSync et l'API l'acceptent jusque-là. L'appli efface de son côté la session et la base locale, même sans réseau ; s'il reste des saisies pas encore envoyées, elle demande confirmation d'abord (page de diagnostic). Base ouverte dans un autre onglet : l'effacement est noté en attente et repris au démarrage et sur l'écran de connexion, jusqu'à réussite.
- **Utilisateur supprimé (T09b)** : la garde relit `utilisateur` à chaque requête ; supprimé ou inexistant, toute route protégée répond 401 `non_authentifie`, même avec un jeton d'accès encore valable.
- **Limite par adresse IP (T09b)** : au plus 30 `POST /auth/code` et 60 `POST /auth/verifier` (réussis ou non) par IP et par heure glissante (429 + `Retry-After`), en plus des limites par adresse e-mail. Comptée en base (plusieurs processus, redémarrage). Adresse : celle de la socket, ou derrière `PROXY_DE_CONFIANCE=1` (exactement un proxy de confiance) la dernière valeur de `X-Forwarded-For` si c'est une adresse IP valide (`net.isIP`), sinon la socket. Une adresse **IPv6 compte par son préfixe /64** (un client en a des milliards), quelle que soit son écriture ; `::ffff:a.b.c.d` compte comme `a.b.c.d`.
- **Conservation des adresses IP (données personnelles)** : table `securite.demande_ip` (adresse, action, instant), hors de la publication PowerSync. Une adresse IPv6 y est rangée réduite à son /64. Les lignes de plus de **24 heures** sont effacées à chaque demande, acceptée ou refusée (429), sans tâche planifiée : aucune adresse n'est gardée plus d'une journée au-delà de la dernière activité.
- **Isolement** : pour une ferme dont on n'est pas membre actif (ou inexistante, ou id invalide), toute route `/fermes/:id…` répond 404 `ferme_introuvable` et n'écrit rien. Un utilisateur supprimé n'est membre actif de rien. Le renommage et l'invitation sont réservés au gérant (403 sinon).
- **Nom de ferme** : refusé (400 `requete_invalide`) s'il contient un caractère de contrôle ou de format (`/[\p{Cc}\p{Cf}]/u`) : il finit dans le sujet des e-mails d'invitation.
- **Invitation** : réponse `{ email, role }`, sans identifiant, identique que le compte existe ou non. L'invité reste « invité » (`membre.etat = 'invite'`), sans accès à la ferme, jusqu'à sa prochaine connexion réussie ; un membre retiré puis réinvité aussi. Au plus 20 invitations par gérant et par heure glissante, toutes fermes confondues (429 + `Retry-After`).
- **Courriel** : `verifierEnTetes` refuse un retour à la ligne dans le destinataire ou le sujet ; tout expéditeur l'appelle avant d'envoyer (`expediteurSmtp` avant même d'ouvrir la connexion). `expediteurSmtp` passe le destinataire sans l'analyser (objet `{ name: '', address }` et enveloppe explicite) : un seul `RCPT TO`, jamais une adresse tierce glissée dans une liste ou un nom d'affichage.

### Empreintes des secrets

La base ne contient jamais un code ni un jeton en clair.

- **Code à 6 chiffres** : SHA-256 avec un sel aléatoire de 16 octets par code (`sel.empreinte`), comparé en temps constant (`timingSafeEqual`). Aucune empreinte rapide, salée ou HMAC, ne protège un million de valeurs possibles d'un calcul hors ligne : la vraie défense est la durée de vie de 10 minutes, les 5 tentatives et l'usage unique. Le sel empêche seulement que deux codes identiques se reconnaissent.
- **Jeton de renouvellement** : SHA-256 sans sel. Avec 256 bits d'entropie, un sel n'apporte rien, et l'empreinte doit rester déterministe pour retrouver la ligne par l'index unique `jeton_hache`. Comme la recherche porte sur l'empreinte et non sur le jeton, elle ne renseigne pas un attaquant par son temps de réponse.
- **Pourquoi pas HMAC** : il faudrait un secret serveur de plus, à faire tourner sans invalider les sessions de 90 jours, pour aucun gain réel sur ces deux cas.

### Rotation des clés

1. `pnpm --filter @planif/api cles cle-2027-01` génère une clé ; la placer **en tête** de `JWT_CLES_PRIVEES`, redéployer. Elle signe, l'ancienne vérifie encore.
2. Une heure plus tard (durée de vie d'un jeton d'accès), retirer l'ancienne clé. Les sessions ne tombent pas : le jeton de renouvellement ne dépend pas des clés.

## Synchro (T10)

Le téléphone écrit dans sa base locale (PowerSync), puis sa file d'écritures part à `POST /sync/upload` au retour du réseau. Architecture : `docs/choix-synchro.md` ; règles de ce que chaque téléphone reçoit : `powersync/sync-config.yaml`.

| Réponse | Quand |
| --- | --- |
| 200 `{ refus: [{ table, id, motif }] }` | Lot traité : chaque écriture est acceptée ou refusée **à part** (un refus ne bloque ni les autres, ni la file du téléphone) |
| 400 `requete_invalide` | Corps sans tableau `ecritures` |
| 401 `non_authentifie` | Jeton absent ou invalide (garde de T09) |
| 5xx | Panne passagère (base injoignable) : PowerSync renverra le lot |

Règles appliquées à chaque écriture (T10 : la table `evenement`, les autres tables suivront avec leurs écrans) :

| Motif | Règle |
| --- | --- |
| `table_interdite` | Le téléphone n'écrit que `evenement` : ni `membre`, ni `utilisateur`, ni l'historique, ni les secrets |
| `ferme_interdite` | L'utilisateur doit être membre actif de la ferme de l'écriture (`fermesDeLUtilisateur`, relu à chaque lot) |
| `auteur_invalide` | `auteur_id` = utilisateur du jeton |
| `ajout_seul` | Ni PATCH ni DELETE sur un événement ; un PUT sur un id existant n'est accepté que s'il est identique (renvoi d'un lot dont la réponse s'est perdue : rien n'est écrit deux fois) |
| `ecriture_invalide` | Données relues contre le modèle (`src/sync/evenement.ts`), puis par les CHECK et clés de la base |

Une création acceptée écrit l'événement **et** sa ligne `modification` (`apres` = la ligne en JSON) dans une seule transaction. Un refus s'enregistre dans `refus_synchro` avec un message en français, qui redescend sur le téléphone de son seul auteur.

### Lancer la synchro en local

```sh
docker compose up -d --wait postgres
export DATABASE_URL=postgres://planif:planif@localhost:5432/planif
pnpm --filter @planif/db migrer
export JWT_CLES_PRIVEES="$(pnpm --silent --filter @planif/api cles)"
export JWT_EMETTEUR=http://localhost:3000 JWT_AUDIENCE=powersync-planif CORS_ORIGINES=http://localhost:5173
COURRIEL_CONSOLE=1 pnpm --filter @planif/api dev          # dans un autre terminal
docker compose up -d --wait powersync                    # lit le JWKS de l'API sur host.docker.internal:3000
VITE_API_URL=http://localhost:3000 VITE_POWERSYNC_URL=http://localhost:8080 pnpm --filter @planif/web dev
```

Puis, une fois connecté dans l'appli : `http://localhost:5173/diagnostic/synchro.html?ferme=<id de la ferme>`. Le test de bout en bout fait tout cela seul : `pnpm e2e:synchro` (racine).

## Tickets suivants

Décision du chef d'équipe, rien de tout ça dans T09 :

- **Clé d'accès (WebAuthn)**, en option pour se connecter par empreinte ou visage (Q9).
- **Rôle applicatif** Postgres limité à `INSERT`/`SELECT` sur le journal (`evenement`, `mouvement_stock`), et **contrôle des références entre fermes**.
- **Choix du fournisseur d'e-mail** (Théophane) : l'expéditeur SMTP est prêt (T09b).

## Appli web : CSP (T09b)

`dist/index.html`, et aussi `dist/diagnostic/synchro.html` et `dist/mesures/sqlite.html`, portent une balise `<meta http-equiv="Content-Security-Policy">` posée au build (`apps/web/scripts/csp.ts`) : `script-src 'self' 'wasm-unsafe-eval'`, aucun script en ligne, `connect-src` limité à l'appli, l'API et PowerSync. Une balise ne peut pas porter `frame-ancestors` : à la mise en production, l'hébergeur devra ajouter l'en-tête HTTP `Content-Security-Policy: frame-ancestors 'none'` (contre l'inclusion de l'appli dans une page piégée).
