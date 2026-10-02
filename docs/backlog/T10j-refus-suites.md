# T10j — Refus de synchro : messages simples, saisie reconnaissable, archivage

**Objectif** : un refus se comprend sans jargon et se rattache à la saisie concernée ; la liste ne grossit pas sans fin.

**Dépend de** : T10i
**Périmètre** : `apps/api/src/sync/**` (messages, résumé du refus), règles de synchro (`sync-config.yaml`), `apps/web/src/ecrans/ferme/Refus.tsx`

## Constat (relecture T10i)

- Certains messages du serveur sont techniques et s'affichent tels quels : « données invalides : colonne inconnue : id », « refusée par une règle de la base », « (plus de 500 saisies ou de 6 Mio…) ».
- Le téléphone ne sait pas quelle saisie a été refusée (culture, quantité, date de la saisie) : la table `refus_synchro` ne porte que la table, l'opération, le motif et le message.
- Aucun moyen d'archiver un refus vu : la liste ne fait que grandir.

## Règles

- Messages du serveur en français simple, sans nom de colonne ni de table ; le détail technique reste dans le journal du serveur.
- Un court résumé non sensible de la saisie refusée (type, culture, date de la saisie, quantité) accompagne le refus, pour l'afficher sur la carte.
- Archiver un refus vu (ou tous) ; les refus archivés ne s'affichent plus.

## Critères d'acceptation

- [ ] Aucun message de refus ne contient de nom de colonne, de table ou de code.
- [ ] La carte d'un refus de récolte montre la culture, la date et la quantité saisies.
- [ ] Archiver un refus le retire de la liste, sur tous les téléphones de l'utilisateur.
