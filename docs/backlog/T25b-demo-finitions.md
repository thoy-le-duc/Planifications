# T25b — Démo : pas de déconnexion ni d'état de synchro

**Objectif** : un visiteur de la démo ne tombe jamais sur un écran sans issue.

**Dépend de** : T25
**Périmètre** : `apps/web/src/demo/**`, `apps/web/src/App.tsx`, `apps/web/src/ecrans/ferme/EcranFerme.tsx`

## Constat (relecture T25)

- « Se déconnecter » reste visible dans l'onglet Ferme : en démo, il efface la ferme fictive et montre un écran de connexion qui ne peut pas aboutir (requêtes refusées).
- L'en-tête affiche « Hors ligne » et un décompte « à envoyer » qui grossit : en démo, rien n'est jamais envoyé.

## Critères d'acceptation

- [ ] e2e démo : pas de bouton « Se déconnecter » ; l'en-tête dit « Démo » au lieu de l'état de synchro.
- [ ] Le build de production ne change pas (JS de démarrage sous le budget, non relevé).
