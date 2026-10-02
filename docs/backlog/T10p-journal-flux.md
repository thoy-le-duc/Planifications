# T10p — Journal du serveur : erreurs d'envoi en flux

**Objectif** : même règle que T10m pour la dernière sortie brute du serveur.

**Dépend de** : T10m
**Périmètre** : `apps/api/src/index.ts`, `apps/api/src/serveur.ts`

## Constat (contre-relecture T10m)

`@hono/node-server` (`handleResponseError`) écrit l'erreur brute avec `console.error` et renvoie `Error: <message>` au client quand l'envoi d'un corps en flux échoue. Aucune réponse de l'API n'est en flux aujourd'hui : non atteignable, mais le premier export ou téléchargement en flux l'ouvrira.

## Critères d'acceptation

- [ ] Test : une réponse en flux qui échoue en cours d'envoi ne fait apparaître ni le message dans le journal, ni `Error:` au client.

## Aussi (dernière vérification T10m)

- Si l'API est un jour regroupée en un seul fichier et que la racine calculée par `journal.ts` vaut `/`, ne garder aucune position de pile (test).
