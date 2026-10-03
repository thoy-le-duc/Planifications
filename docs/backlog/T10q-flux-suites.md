# T10q — Réponses en flux : HTTP/1.0 et erreur au premier octet

**Objectif** : un export en flux coupé ne passe jamais pour complet, même derrière un proxy, et une erreur avant tout octet donne un 500 que le téléphone sait afficher.

**Dépend de** : T10p
**Périmètre** : `apps/api/src/serveur.ts`, `apps/api/README.md` (déploiement)

## Constat (relecture T10p)

- En HTTP/1.0 (défaut de nginx vers l'amont), sans Content-Length ni morceaux, la fin du corps n'est marquée que par la fermeture : une réponse coupée ressemble à une réponse complète.
- Quand le flux est enveloppé, les en-têtes 200 partent avant le premier morceau : une erreur avant tout octet donne « 200 puis coupure » au lieu d'un 500.
- Le 400 et le 504 de `surErreur` ne sont pas testés directement ; `surErreur` pourrait lever sur une erreur piégée (accesseur `constructor`).

## Critères d'acceptation

- [x] Test : une requête HTTP/1.0 qui demande une réponse en flux ne la reçoit pas en flux (réponse en mémoire ou refus explicite) ; la doc de déploiement impose HTTP/1.1 vers l'amont.
- [x] Test : un flux qui échoue avant son premier morceau donne un 500 propre.
- [x] Tests : 400 (requête illisible) et 504 (délai) de `surErreur` ; `surErreur` ne lève jamais.
