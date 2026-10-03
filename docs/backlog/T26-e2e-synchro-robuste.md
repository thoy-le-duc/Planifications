# T26 — Synchro de bout en bout : un banc qui ne tombe plus tout seul

**Objectif** : la CI ne passe plus au rouge pour des raisons étrangères au code (trois incidents sur `pnpm e2e:synchro` les 1er–3 octobre).

**Dépend de** : aucun
**Périmètre** : `scripts/e2e-synchro.ts`, `docker-compose.yml`, `packages/db/src/migrer.ts` (et `migrations.ts` si besoin), `apps/web/e2e-synchro/banc.test.ts` ou tests voisins, `.github/workflows/ci.yml`

## Constat

- **Port déjà pris** (PR #65, main 01d733d) : `failed to bind host port 0.0.0.0:58080 … address already in use`. Les ports par défaut du banc (55432, 58080) sont dans la plage des ports éphémères de Linux (32768–60999) : une connexion sortante quelconque peut les occuper à ce moment-là.
- **Connexion coupée pendant les migrations** (PR #83) : `Connection terminated unexpectedly`. Le contrôle de santé de Postgres (`pg_isready` sans `-h`, par la socket Unix) passe déjà sur le serveur temporaire que l'image démarre pendant l'initialisation (`docker-entrypoint-initdb.d`) ; les migrations s'y connectent, puis ce serveur s'arrête.

## Règles

- Ports par défaut du banc hors de la plage éphémère (en dessous de 32768) et distincts des ports courants (5432, 8080, 3000).
- Contrôle de santé de Postgres par TCP (`pg_isready -h 127.0.0.1 …`) : le serveur temporaire d'initialisation n'écoute pas en TCP.
- `migrer` réessaie la connexion quelques fois (ex. 10 essais, 500 ms d'écart) sur une erreur de connexion (refusée, coupée), jamais sur une erreur de migration.

## Critères d'acceptation

- [x] Test : les ports par défaut de `scripts/e2e-synchro.ts` sont < 32768 et ne valent ni 5432, 8080 ni 3000.
- [x] Test : le contrôle de santé de `docker-compose.yml` passe par TCP.
- [x] Test : la migration réessaie sur une connexion refusée ou coupée, et échoue tout de suite sur une erreur SQL.
- [x] CI verte (le banc tourne en CI).
