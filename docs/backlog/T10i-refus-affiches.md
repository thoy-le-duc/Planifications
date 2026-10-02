# T10i — Les refus de synchro s'affichent sur le téléphone

**Objectif** : quand le serveur refuse une saisie, le maraîcher le voit, comprend pourquoi en une phrase, et sait quoi faire. Aujourd'hui, la table locale `refus_synchro` se remplit, mais aucun écran ne la montre (critère de T10 jamais coché).

**Dépend de** : T10, T10f
**Périmètre** : `apps/web/src/ecrans/ferme/**` (ou un bandeau de la coquille), `packages/sync/src/porte.ts` (lecture des refus, déjà présente)

## Règles

- Un signal discret dans la coquille quand un refus récent n'a pas été vu ; le détail dans l'onglet Ferme.
- Chaque refus : ce qui était saisi (type, culture, date), le motif en français (messages de `apps/api/src/sync/upload.ts`), et quoi faire.
- La ligne récapitulative d'un lot trop gros (`table: 'lot'`, T10f) est montrée de façon compréhensible.
- La file d'envoi n'est jamais bloquée par un refus (déjà vrai, à garder).

## Décisions (chef, 2026-10-02)

- Le téléphone ne connaît de la saisie refusée que sa table, l'opération, le motif, le message et la date : la carte montre le type de saisie en français, la date du refus, le message du serveur et quoi faire. Montrer la culture ou la quantité demande un résumé synchronisé par le serveur : T10j.
- Pastille sans limite d'âge, comparée par refus déjà vus (jamais par l'heure du téléphone), mémoire par utilisateur effacée à la déconnexion.
- 20 refus, puis « voir plus » ; pas d'archivage (T10j).

## Critères d'acceptation

- [x] Test : un refus reçu s'affiche avec son motif en français ; la file continue.
- [x] Test : la ligne `lot` s'affiche en une phrase compréhensible.
- [x] e2e : l'onglet Ferme reste sous 300 ms avec 100 refus.
