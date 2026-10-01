# T09c — Envoi des codes de connexion par Brevo

**Objectif** : les codes de connexion partent par Brevo, hébergé en UE (Q14), dès que Théophane a créé le compte.

**Dépend de** : T09b
**Périmètre** : `apps/api/src/auth/courriel.ts`, documentation de déploiement

## À faire par Théophane (hors code)

- Créer le compte Brevo et accepter le contrat de sous-traitance RGPD.
- Choisir le domaine d'envoi et ajouter les enregistrements SPF, DKIM et DMARC donnés par Brevo.
- Ranger les identifiants SMTP dans les secrets de production (jamais dans le dépôt ni dans une session Claude) : `SMTP_HOTE=smtp-relay.brevo.com`, `SMTP_PORT=587`, STARTTLS, `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` (clé SMTP, 12 caractères au moins), `SMTP_EXPEDITEUR` (une seule adresse, le nom « Planifications » est ajouté si absent). Détail dans l'en-tête de `apps/api/src/config.ts`.
- **Désactiver le suivi des ouvertures et des clics** dans les réglages transactionnels de Brevo : sinon Brevo ajoute un pixel de suivi au message HTML, sans consentement (CNIL). Contrôler sur un premier vrai envoi.

## Côté code

- Configuration SMTP de Brevo documentée (hôte, port, TLS), vérifiée au démarrage de l'API.
- Message du code en français, texte brut et HTML sobre, expéditeur au nom de l'appli.
- Test : l'envoi passe par le transport configuré ; en l'absence de configuration, seul le mode console de développement démarre.

## Décisions (chef, 2026-10-01)

- Configuration incomplète : l'API refuse de démarrer. Relais injoignable : l'API démarre quand même (la synchro ne dépend jamais de Brevo), la vérification part en tâche de fond et un avertissement s'écrit dans le journal.
- Le mode console (codes écrits dans le journal) n'existe qu'avec `NODE_ENV=development` exactement.
- Une erreur d'envoi ne recopie jamais la réponse du serveur : seulement le relais, l'étape, le code et le numéro de réponse (« code EAUTH, réponse 535 »). Aucune forme du mot de passe ni adresse refusée dans les journaux.
- Un échec d'envoi répond 503 `envoi_impossible` (500 avant), sur le code de connexion comme sur l'invitation.
- L'invitation reste en texte seul.
- Périmètre élargi : `courriel-smtp.ts`, `demarrage.ts`, `index.ts`, `app.ts`, `routes.ts`, `config.ts`.

## Note de mise en ligne (T23)

- La base Postgres de production doit être créée en locale UTF-8 (par exemple `C.UTF-8` ou `fr_FR.UTF-8`) : l'index unique des types d'intervention repose sur `lower(libelle)`, qui ne met en minuscules que l'ASCII en locale `C` pure.
- Les migrations 0019 à 0021 (T10h) réécrivent toute la table `evenement` dans une seule transaction (verrou exclusif, 23 s sur 446 000 lignes, journal re-téléchargé par les téléphones). Sans données en production, sans effet ; sinon, planifier une fenêtre de maintenance ou découper la reprise.
- Node en production : la version de `.node-version` (22), comme la CI. Le délai de lecture du corps de T10f s'appuie sur un mécanisme interne de Node ; avant de changer de version majeure, relancer `apps/api/src/serveur.test.ts` et `serveur-relecture.test.ts` sur cette version.
