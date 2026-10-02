# T10j — Refus de synchro : messages sans jargon

**Objectif** : chaque message de refus se comprend sans jargon technique.

**Dépend de** : T10i
**Périmètre** : `apps/api/src/sync/**` (messages des refus), `apps/web/src/ecrans/ferme/Refus.tsx` si un texte y dépend du message

## Constat (relecture T10i)

- Certains messages du serveur sont techniques et s'affichent tels quels : « données invalides : colonne inconnue : id », « refusée par une règle de la base », « (plus de 500 saisies ou de 6 Mio…) ».
- Le téléphone ne sait pas quelle saisie a été refusée (culture, quantité, date de la saisie) : la table `refus_synchro` ne porte que la table, l'opération, le motif et le message.
- Aucun moyen d'archiver un refus vu : la liste ne fait que grandir.

## Découpage (chef, 2026-10-02)

Le ticket d'origine mêlait trois sujets. T10j garde les messages ; T10k (saisie reconnaissable) et T10l (archivage) les reprennent.

## Règles

- Messages du serveur en français simple, sans nom de colonne, de table, de code ni de seuil technique (« 500 saisies ou 6 Mio ») ; le détail technique reste dans le journal du serveur.
- Chaque motif garde un message propre et stable (le téléphone l'affiche tel quel).

## Critères d'acceptation

- [ ] Test : aucun message de refus renvoyé au téléphone ne contient de nom de colonne, de table, de code de motif ni de détail technique (tous les motifs et toutes les précisions).
- [ ] Le détail technique d'un refus reste disponible côté serveur (journal), sans fuite de données personnelles.
