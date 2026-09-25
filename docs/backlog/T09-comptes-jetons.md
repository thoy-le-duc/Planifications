# T09 — Comptes, fermes et jetons

**Objectif** : que Théophane et son équipe se connectent à leur ferme, et que chaque téléphone ne reçoive que les données de sa ferme.

**Dépend de** : T08
**Périmètre** : `apps/api/src/auth/**`, `packages/db` (tables `utilisateur`, `membre`), `apps/web/src/connexion/**`

**Statut : à préciser.** Méthode de connexion à choisir avec Théophane (voir `docs/questions.md`) : code reçu par e-mail, lien magique, clé d'accès (passkey) ou mot de passe. Ne pas coder avant la réponse.

## Règles

- Un utilisateur est membre d'une ou plusieurs fermes, avec un rôle (`gerant`, `equipier`).
- L'API émet des jetons JWT signés, exposés en JWKS pour le service PowerSync ; le jeton porte l'identifiant de l'utilisateur, jamais la liste des fermes (lue côté serveur).
- La session reste valable hors ligne au moins 30 jours sur le téléphone ; les écritures faites hors ligne partent au retour du réseau même si le jeton a expiré entre-temps (renouvellement puis envoi).

## Critères d'acceptation

- [ ] Création de compte et de ferme, invitation d'un équipier.
- [ ] Endpoint JWKS et rotation des clés testés.
- [ ] Tests : un utilisateur ne peut ni lire ni écrire les données d'une ferme dont il n'est pas membre (API et règles de synchro).
- [ ] Connexion utilisable avec des gants : un seul champ, gros boutons, pas de saisie répétée.

**Hors périmètre** : facturation, rôles fins, gestion d'équipe et temps de travaux.
