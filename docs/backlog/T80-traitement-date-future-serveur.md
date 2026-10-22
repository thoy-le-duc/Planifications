# T80 — Serveur : refuser un traitement daté dans le futur

**Objectif** : suite de la relecture de T79. Le téléphone refuse déjà un traitement phyto daté après aujourd'hui (`ecrireLotTraitement`), mais le serveur l'accepte : un téléphone pas à jour, mal réglé ou modifié peut encore inscrire au registre légal un traitement à une date future, avec un délai avant récolte calculé à partir de cette date.

**Dépend de** : T79
**Périmètre** : `apps/api/src/sync/**` (envoi d'un événement `traitement`), `apps/api/src/sync/messages.ts` (message de refus), tests, `docs/modele-donnees.md`
**Priorité** : moyenne. **Domaine critique** : oui (synchro, registre légal ; agents `-critique`).

## Règles

1. Le serveur refuse un événement `traitement` dont la date est après **le jour du serveur à Paris + 1 jour**. Ce jour de marge couvre un téléphone en avance d'un fuseau, ou une saisie juste après minuit.
   - Exemple : jour serveur 2026-10-22, date 2026-10-23 acceptée, date 2026-10-24 refusée.
2. Le refus suit le chemin des refus existants (T10i à T10k) : la saisie est refusée et le téléphone affiche un message sans jargon, par exemple « Traitement daté dans le futur (24/10/2026) : corrigez la date ». Les autres saisies du même envoi ne sont pas bloquées.
3. Une **correction** ou une **annulation** d'un traitement suit la même règle, sur la date du traitement corrigé.
4. Les traitements déjà en base ne sont pas réécrits.

## Critères d'acceptation

- [ ] Test d'intégration : date future de 2 jours refusée, avec son message ; date de demain acceptée ; date d'aujourd'hui acceptée.
- [ ] Test : correction vers une date future refusée.
- [ ] Le jour du serveur est injecté dans le test (pas d'horloge réelle), en chaîne `AAAA-MM-JJ`.
- [ ] `pnpm verif` passe.

## Hors périmètre

Les autres types d'événements (récolte, réalisé) : à décider avec Théophane si la même règle doit s'y appliquer.
