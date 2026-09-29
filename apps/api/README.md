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
| `CORS_ORIGINES` | Origines autorisées à appeler l'API depuis un navigateur, séparées par des virgules (`https://app.planif.fr,http://localhost:4174`). Origines exactes, sans `/` final ; aucune par défaut (même origine seulement) |

Aucune valeur secrète par défaut : une variable obligatoire absente arrête le démarrage. Il n'y a pas encore de service d'envoi d'e-mail réel : sans `COURRIEL_CONSOLE=1`, l'API refuse de démarrer.

## Connexion (Q9)

Code à 6 chiffres reçu par e-mail, pas de mot de passe.

| Route | Rôle |
| --- | --- |
| `POST /auth/code` | Envoie un code (10 min, 5 tentatives, usage unique). Au plus un envoi par minute, cinq par heure et dix par 24 h glissantes par adresse (429 + `Retry-After`). Un nouveau code invalide le précédent. Même réponse que le compte existe ou non |
| `POST /auth/verifier` | Code → jeton d'accès + jeton de renouvellement. Crée le compte à la première connexion, et vaut acceptation des invitations en attente. À partir de 10 échecs pour une adresse sur 24 h glissantes, tous codes confondus, toute vérification reçoit la même 401 `code_invalide`, même avec le bon code |
| `POST /auth/renouveler` | Jeton de renouvellement → nouveau jeton d'accès, **sans** jeton d'accès valide : les écritures faites hors ligne partent au retour du réseau |
| `GET /.well-known/jwks.json` | Clés publiques, pour PowerSync |
| `GET /moi`, `POST /fermes`, `GET`/`PATCH /fermes/:id`, `POST /fermes/:id/membres` | Protégées par `Authorization: Bearer` |

- **Jeton d'accès** : JWT RS256, 1 heure, claims `sub`, `iss`, `aud`, `iat`, `exp` seulement. Jamais la liste des fermes : les droits sont relus en base à chaque requête (`fermesDeLUtilisateur`, `roleDansLaFerme` de `@planif/db`). Un membre retiré perd l'accès tout de suite.
- **Jeton de renouvellement** : 256 bits aléatoires, opaque. Échéance glissante de 90 jours (la session tient donc au moins 30 jours hors ligne), plafonnée à 365 jours après la connexion. Pas de rotation stricte : le même jeton reste valable après usage, pour qu'une réponse perdue sur un réseau faible ne déconnecte pas.
- **Isolement** : pour une ferme dont on n'est pas membre actif (ou inexistante, ou id invalide), toute route `/fermes/:id…` répond 404 `ferme_introuvable` et n'écrit rien. Un utilisateur supprimé n'est membre actif de rien. Le renommage et l'invitation sont réservés au gérant (403 sinon).
- **Nom de ferme** : refusé (400 `requete_invalide`) s'il contient un caractère de contrôle ou de format (`/[\p{Cc}\p{Cf}]/u`) : il finit dans le sujet des e-mails d'invitation.
- **Invitation** : réponse `{ email, role }`, sans identifiant, identique que le compte existe ou non. L'invité reste « invité » (`membre.etat = 'invite'`), sans accès à la ferme, jusqu'à sa prochaine connexion réussie ; un membre retiré puis réinvité aussi. Au plus 20 invitations par gérant et par heure glissante, toutes fermes confondues (429 + `Retry-After`).
- **Courriel** : `verifierEnTetes` refuse un retour à la ligne dans le destinataire ou le sujet ; tout expéditeur l'appelle avant d'envoyer.

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
- **Déconnexion et révocation par l'API** : `jeton_renouvellement.revoque_le` est déjà respecté au renouvellement, mais aucune route ne le remplit.
- **Rôle applicatif** Postgres limité à `INSERT`/`SELECT` sur le journal (`evenement`, `mouvement_stock`), et **contrôle des références entre fermes**.
- **Service d'envoi d'e-mail réel** (l'interface `ExpediteurCourriel` est prête).
