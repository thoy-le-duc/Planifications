# T10v — Refus : pas de nom de culture d'une autre ferme dans le résumé

**Objectif** : un refus de synchro ne montre jamais le nom d'une culture qui n'appartient pas à la ferme de la ligne refusée, même quand l'écriture a été forgée (Q25 : rien d'une ferme ne reste chez quelqu'un qui n'en fait plus partie).

**Constat** (relecture de T10u) : dans `apps/api/src/sync/upload.ts` (`modificationRefusee`, l. ~413-424), un PATCH sur `evenement` dont les données portent `ferme_id: B` et `serie_id` d'une série de B, sur une ligne inexistante ou de la ferme A, produit un refus rangé sous la ferme NULL ou A. Dans `apps/api/src/sync/resume.ts` (`resumerSaisies`, l. ~125-133), le résumé compare la ferme de la série à `ferme_id` des données reçues (B, forgé), et non à la ferme de la ligne refusée : le nom de la culture de B est donc écrit dans `saisie_culture` d'un refus qui n'est pas de B. Après avoir quitté B, ce nom resterait sur le téléphone. L'appli légitime ne déclenche pas ce chemin.

**Dépend de** : T10u (fait), T10k (fait)
**Périmètre** : `apps/api/src/sync/**`

## Règles

- `saisie_culture` n'est renseigné que si la ferme du refus (`fermeId`) est non nulle et égale à `fermeDesDonnees(e)`, et que l'utilisateur en est membre accepté au moment du lot (règle T10k inchangée).
- Dans tous les autres cas, `saisie_culture` est NULL. Les autres champs du résumé (type, date, quantité, unité) ne changent pas.
- Aucune autre donnée d'une autre ferme n'entre dans le refus ni dans son résumé.

## Critères d'acceptation

- [ ] Test d'intégration : un PATCH forgé sur un id inexistant, avec `ferme_id` de la ferme B (dont l'utilisateur est membre) et `serie_id` d'une série de B, produit un refus sans ferme (`ferme_id` NULL) dont `saisie_culture` est NULL.
- [ ] Test d'intégration : un PATCH forgé sur une ligne de la ferme A (dont l'utilisateur est membre, comme B) avec `ferme_id` B et `serie_id` d'une série de B produit un refus rangé sous A dont `saisie_culture` est NULL.
- [ ] Test témoin inchangé : un refus d'un événement de la ferme B, pour un membre de B, garde la culture de B (`resume-refus.integration.test.ts`).
- [ ] Test : après retrait de l'adhésion à B, le refus de la ferme A ne contient plus rien de B (vérifié par la synchro de T10u).
- [ ] Aucun test existant modifié pour passer ; `pnpm verif` passe en entier.
- [ ] Relecture jusqu'à zéro faille d'isolement entre fermes (modèle Opus, voir `docs/boucle.md`).

## Hors périmètre

- Changer le motif du refus (`ajout_seul`, `table_interdite`) ou ses messages.
- Modifier la synchro PowerSync (`powersync/`) ou le téléphone.
- Résumer d'autres tables que `evenement`.
