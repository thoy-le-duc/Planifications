# T09c — Envoi des codes de connexion par Brevo

**Objectif** : les codes de connexion partent par Brevo, hébergé en UE (Q14), dès que Théophane a créé le compte.

**Dépend de** : T09b
**Périmètre** : `apps/api/src/auth/courriel.ts`, documentation de déploiement

## À faire par Théophane (hors code)

- Créer le compte Brevo et accepter le contrat de sous-traitance RGPD.
- Choisir le domaine d'envoi et ajouter les enregistrements SPF, DKIM et DMARC donnés par Brevo.
- Ranger les identifiants SMTP dans les secrets de production (jamais dans le dépôt ni dans une session Claude).

## Côté code

- Configuration SMTP de Brevo documentée (hôte, port, TLS), vérifiée au démarrage de l'API.
- Message du code en français, texte brut et HTML sobre, expéditeur au nom de l'appli.
- Test : l'envoi passe par le transport configuré ; en l'absence de configuration, seul le mode console de développement démarre.
