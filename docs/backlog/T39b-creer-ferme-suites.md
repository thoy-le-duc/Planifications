# T39b — Suites de T39 : jamais deux fermes, jamais d'attente muette

**Objectif** : remarques de la relecture de T39 (PR #192).

**Dépend de** : T39
**Périmètre** : `apps/web/src/ecrans/creer-ferme/**`, `apps/web/src/App.tsx`, `apps/web/src/connexion/deconnexion.ts`, `apps/web/src/donnees/ferme-memorisee.ts`, tests et e2e associés
**Priorité** : haute (premier usage réel).

## Règle

1. **Id de la ferme en cours d'envoi gardé sur le téléphone** (par utilisateur, avant le `POST /fermes`) et réutilisé après un rechargement : une réponse perdue suivie d'un rechargement ne crée jamais une seconde ferme (le 409 reste une réussite). Effacé quand la ferme est arrivée, et à la déconnexion.
2. **Attente bornée** : « Première synchronisation en cours… » ou « Ferme créée, synchronisation… » qui dure plus de 30 s dit franchement que la synchronisation ne répond pas (réseau, service) et propose de réessayer, sans écran muet.
3. **Clé `planif.ferme-creee.<id>` effacée** dès que la base passe à `prete` (la ferme est arrivée).
4. **Synchro en `session-expiree`** : l'écran le dit avant la saisie (se reconnecter), sans proposer un formulaire voué à l'échec.

## Critères d'acceptation

- [x] Test : réponse du POST perdue, rechargement, nouvel essai : même id envoyé, une seule ferme.
- [x] Test : attente de plus de 30 s : message franc et bouton « Réessayer ».
- [x] Test : la clé `ferme-creee` disparaît au passage à `prete`, et à la déconnexion (comme l'id en cours).
- [x] Test : `session-expiree` : pas de formulaire, message de reconnexion.
- [x] `pnpm verif` passe ; démarrage dans le budget (72 806 octets).
