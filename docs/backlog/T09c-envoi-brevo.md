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

## Note de mise en ligne (T23)

- La base Postgres de production doit être créée en locale UTF-8 (par exemple `C.UTF-8` ou `fr_FR.UTF-8`) : l'index unique des types d'intervention repose sur `lower(libelle)`, qui ne met en minuscules que l'ASCII en locale `C` pure.
- Les migrations 0019 à 0021 (T10h) réécrivent toute la table `evenement` dans une seule transaction (verrou exclusif, 23 s sur 446 000 lignes, journal re-téléchargé par les téléphones). Sans données en production, sans effet ; sinon, planifier une fenêtre de maintenance ou découper la reprise.
