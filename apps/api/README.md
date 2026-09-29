# @planif/api

API Hono sur Node. Depuis T09 : comptes, fermes et jetons. Le contrat exact est l'en-tête de `src/auth/auth.integration.test.ts`.

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

Aucune valeur secrète par défaut : une variable obligatoire absente arrête le démarrage. Il n'y a pas encore de service d'envoi d'e-mail réel : sans `COURRIEL_CONSOLE=1`, l'API refuse de démarrer.

## Connexion (Q9)

Code à 6 chiffres reçu par e-mail, pas de mot de passe.

| Route | Rôle |
| --- | --- |
| `POST /auth/code` | Envoie un code (10 min, 5 tentatives, usage unique). Au plus un envoi par minute, cinq par heure et dix par 24 h glissantes par adresse (429 + `Retry-After`). Un nouveau code invalide le précédent. Même réponse que le compte existe ou non |
| `POST /auth/verifier` | Code → jeton d'accès + jeton de renouvellement. Crée le compte à la première connexion. À partir de 10 échecs pour une adresse sur 24 h glissantes, tous codes confondus, toute vérification reçoit la même 401 `code_invalide`, même avec le bon code |
| `POST /auth/renouveler` | Jeton de renouvellement → nouveau jeton d'accès, **sans** jeton d'accès valide : les écritures faites hors ligne partent au retour du réseau |
| `GET /.well-known/jwks.json` | Clés publiques, pour PowerSync |
| `GET /moi`, `POST /fermes`, `GET`/`PATCH /fermes/:id`, `POST /fermes/:id/membres` | Protégées par `Authorization: Bearer` |

- **Jeton d'accès** : JWT RS256, 1 heure, claims `sub`, `iss`, `aud`, `iat`, `exp` seulement. Jamais la liste des fermes : les droits sont relus en base à chaque requête (`fermesDeLUtilisateur`, `roleDansLaFerme` de `@planif/db`). Un membre retiré perd l'accès tout de suite.
- **Jeton de renouvellement** : 256 bits aléatoires, opaque. Échéance glissante de 90 jours (la session tient donc au moins 30 jours hors ligne), plafonnée à 365 jours après la connexion. Pas de rotation stricte : le même jeton reste valable après usage, pour qu'une réponse perdue sur un réseau faible ne déconnecte pas.
- **Isolement** : pour une ferme dont on n'est pas membre actif (ou inexistante, ou id invalide), toute route `/fermes/:id…` répond 404 `ferme_introuvable` et n'écrit rien. Le renommage et l'invitation sont réservés au gérant (403 sinon).

### Empreintes des secrets

La base ne contient jamais un code ni un jeton en clair.

- **Code à 6 chiffres** : SHA-256 avec un sel aléatoire de 16 octets par code (`sel.empreinte`), comparé en temps constant (`timingSafeEqual`). Aucune empreinte rapide, salée ou HMAC, ne protège un million de valeurs possibles d'un calcul hors ligne : la vraie défense est la durée de vie de 10 minutes, les 5 tentatives et l'usage unique. Le sel empêche seulement que deux codes identiques se reconnaissent.
- **Jeton de renouvellement** : SHA-256 sans sel. Avec 256 bits d'entropie, un sel n'apporte rien, et l'empreinte doit rester déterministe pour retrouver la ligne par l'index unique `jeton_hache`. Comme la recherche porte sur l'empreinte et non sur le jeton, elle ne renseigne pas un attaquant par son temps de réponse.
- **Pourquoi pas HMAC** : il faudrait un secret serveur de plus, à faire tourner sans invalider les sessions de 90 jours, pour aucun gain réel sur ces deux cas.

### Rotation des clés

1. `pnpm --filter @planif/api cles cle-2027-01` génère une clé ; la placer **en tête** de `JWT_CLES_PRIVEES`, redéployer. Elle signe, l'ancienne vérifie encore.
2. Une heure plus tard (durée de vie d'un jeton d'accès), retirer l'ancienne clé. Les sessions ne tombent pas : le jeton de renouvellement ne dépend pas des clés.

## Tickets suivants

Décision du chef d'équipe, rien de tout ça dans T09 :

- **Clé d'accès (WebAuthn)**, en option pour se connecter par empreinte ou visage (Q9).
- **Déconnexion et révocation par l'API** : `jeton_renouvellement.revoque_le` est déjà respecté au renouvellement, mais aucune route ne le remplit.
- **Rôle applicatif** Postgres limité à `INSERT`/`SELECT` sur le journal (`evenement`, `mouvement_stock`), et **contrôle des références entre fermes**.
- **Service d'envoi d'e-mail réel** (l'interface `ExpediteurCourriel` est prête).
