# T09b — Connexion : durcissement avant la mise en production

**Objectif** : fermer les points que la relecture sécurité de T09 a jugés acceptables sans production, mais pas au-delà.

**Dépend de** : T09
**Périmètre** : `apps/api/src/auth`, `apps/api/src/limites.ts`, `apps/web/src/connexion`, en-têtes HTTP de `apps/web`

## Règles

- **Déconnexion** : `POST /auth/deconnexion` révoque le jeton de renouvellement présenté (`revoque_le`) ; l'appli efface la session locale.
- **Rotation du jeton de renouvellement** : chaque renouvellement rend un nouveau jeton ; l'ancien reste valable 2 minutes (réponse perdue au champ) ; le rejeu d'un ancien jeton après ce délai révoque toute la famille.
- **Limite par adresse IP** sur `/auth/code` et `/auth/verifier`, derrière le proxy de production (en-tête de confiance configuré, jamais lu par défaut).
- **CSP stricte** servie avec l'appli : `script-src 'self'`, pas de script en ligne.
- **Déconnexion = base locale effacée** : sur un téléphone partagé, rien du compte précédent ne reste lisible (relecture T10, M9).
- **Écart d'horloge** : mesurer l'écart entre l'horloge du téléphone et l'`iat` du jeton reçu, et s'en servir pour décider du renouvellement. Aujourd'hui, un téléphone en retard de plus d'une heure sans écriture en attente réessaie la synchro avec un jeton périmé (le SDK PowerSync 2.3.0 n'appelle pas encore `invalidateCredentials`, relecture T10).
- **Utilisateur supprimé** : la garde relit `utilisateur.supprime_le`, pour qu'un jeton d'accès encore valable ne permette plus rien (relecture T10, M4).
- **Refus de `COURRIEL_CONSOLE`** déjà fait dans T09 ; brancher un vrai expéditeur (fournisseur hébergé en UE) qui réutilise `verifierEnTetes`.

## Critères d'acceptation

- [ ] Chaque règle a ses tests d'intégration (vraie base), y compris le rejeu après délai de grâce.
- [ ] L'appli continue de renouveler hors ligne puis en ligne sans perdre les écritures en attente.
- [ ] Budget de démarrage inchangé à ±2 Kio.

**Hors périmètre** : clé d'accès (empreinte ou visage), ticket séparé après T13.
