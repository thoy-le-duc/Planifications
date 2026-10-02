# T10n — Refus : annuler un archivage

**Objectif** : un tap de travers sur « Tout archiver » (avec des gants) ne fait rien perdre de vue.

**Dépend de** : T10l
**Périmètre** : `apps/web/src/ecrans/ferme/Refus.tsx`, `packages/sync/**` (porte), `apps/api/src/sync/archiver-refus.ts`

## Constat (relecture T10l)

Archiver est définitif pour l'utilisateur : le serveur refuse `archive_le = null` et aucun écran ne montre les archivés. Rien n'est supprimé, mais rien n'est récupérable depuis l'appli.

## Règles

- Après « Archiver » ou « Tout archiver », un bandeau « N refus archivés — Annuler » reste quelques secondes ; « Annuler » rend les refus visibles.
- Choix à faire dans le ticket : n'écrire qu'à la fin du bandeau (rien ne part tant qu'on peut annuler), ou permettre au serveur de remettre `archive_le` à nul pour ses propres refus. Préférer la première solution (aucune règle serveur nouvelle).

## Critères d'acceptation

- [x] Test : « Tout archiver » puis « Annuler » → les refus restent affichés et rien n'est écrit.
- [x] Test : sans « Annuler », l'archivage est écrit à la fin du bandeau, et aussi si l'on quitte l'onglet avant.
