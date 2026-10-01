# T10i — Les refus de synchro s'affichent sur le téléphone

**Objectif** : quand le serveur refuse une saisie, le maraîcher le voit, comprend pourquoi en une phrase, et sait quoi faire. Aujourd'hui, la table locale `refus_synchro` se remplit, mais aucun écran ne la montre (critère de T10 jamais coché).

**Dépend de** : T10, T10f
**Périmètre** : `apps/web/src/ecrans/ferme/**` (ou un bandeau de la coquille), `packages/sync/src/porte.ts` (lecture des refus, déjà présente)

## Règles

- Un signal discret dans la coquille quand un refus récent n'a pas été vu ; le détail dans l'onglet Ferme.
- Chaque refus : ce qui était saisi (type, culture, date), le motif en français (messages de `apps/api/src/sync/upload.ts`), et quoi faire.
- La ligne récapitulative d'un lot trop gros (`table: 'lot'`, T10f) est montrée de façon compréhensible.
- La file d'envoi n'est jamais bloquée par un refus (déjà vrai, à garder).

## Critères d'acceptation

- [ ] Test : un refus reçu s'affiche avec son motif en français ; la file continue.
- [ ] Test : la ligne `lot` s'affiche en une phrase compréhensible.
- [ ] e2e : l'onglet Ferme reste sous 300 ms avec 100 refus.
