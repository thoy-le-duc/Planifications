# T33b — Verrou e2e réentrant

**Objectif** : qu'un jeu e2e lancé à travers deux niveaux de verrou ne s'attende plus lui-même. Le 9 octobre, `bash scripts/verrou-e2e.sh pnpm e2e` à la racine a pris le verrou, puis `pnpm e2e` (qui passe par `apps/web`, lui-même sous verrou) a attendu ce même verrou : blocage de plus d'une heure de tous les autres e2e de la machine.

**Dépend de** : T33
**Périmètre** : `scripts/verrou-e2e.sh`, `apps/web/scripts/verrou-e2e.test.ts` (tests ajoutés seulement), `docs/boucle.md` (une ligne de consigne)

## Règles

- Le script pose `VERROU_E2E_TENU=1` dans l'environnement de la commande qu'il lance. S'il voit déjà cette variable, il lance la commande directement, sans prendre ni attendre le verrou, et renvoie son code tel quel.
- Rien d'autre ne change (délai, messages, code de sortie).
- `docs/boucle.md` : « lancer `pnpm e2e` ou `pnpm e2e:demo` tels quels ; ne jamais les envelopper dans `verrou-e2e.sh` ».

## Critères d'acceptation

- [ ] Test : `verrou-e2e.sh bash -c 'verrou-e2e.sh true'` se termine sans attendre (sous 2 s) avec le code 0, même avec un délai de test de 30 s.
- [ ] Test : la variable est bien posée pour la commande lancée.
- [ ] Les tests de T33 restent verts ; `pnpm verif` passe.
