# T38a — Mise en ligne gratuite : l'API sur Vercel

**Objectif** (Q37) : que Théophane utilise l'appli avec sa vraie ferme et son compte, gratuitement pendant le développement. L'API Hono tourne aujourd'hui comme serveur Node (`apps/api/src/index.ts`) ; elle doit aussi tourner en fonctions Vercel (région Paris), branchée sur PostgreSQL (Neon, UE), PowerSync Cloud (UE) et Brevo.

**Dépend de** : T09c (envoi Brevo), T10 (synchro)
**Périmètre** : `apps/api/**` (point d'entrée Vercel, configuration par variables d'environnement), un projet Vercel « appli » distinct de la démo (`vercel.json` ou dossier dédié), `packages/db` (commande de migration utilisable en déploiement), `apps/web` (adresse de l'API et de PowerSync lues à la construction)

## Règles

- **Même application Hono** pour Node et Vercel : un point d'entrée Vercel minimal (`hono/vercel` ou équivalent) ; aucune logique dupliquée. Région des fonctions : `cdg1` (Paris).
- **Aucun état en mémoire** qui doive survivre d'une requête à l'autre : limites d'envoi, codes, tentatives, sessions déjà en base (vérifier) ; si un état vit en mémoire, il passe en base ou le ticket le signale.
- **Pool PostgreSQL adapté au serverless** (connexions courtes ; adresse « pooled » de Neon) ; une requête ne garde pas de connexion ouverte au-delà de sa fin.
- **Secrets** uniquement par variables d'environnement du projet Vercel (base, clés JWT, PowerSync, Brevo) ; aucun secret dans le dépôt, les journaux ou les réponses ; démarrage refusé avec un message clair si une variable manque (le code le fait déjà en Node : le garder).
- **Migrations** : une commande `pnpm --filter @planif/db migrer` lancée par Théophane (ou par la construction Vercel si c'est sûr et idempotent), documentée dans T38b.
- **Appli** : construite avec l'adresse de l'API (`/api` même origine si possible, pour éviter le CORS) et de PowerSync ; la politique de contenu suit (`connect-src`).
- **Démo inchangée** (projet Vercel existant).
- Gratuit : rien qui dépasse les offres gratuites (fonctions courtes, pas de tâche planifiée payante).

## Critères d'acceptation

- [ ] Test : le point d'entrée Vercel répond à `/api/sante` (ou la route de santé existante) avec la même application que Node.
- [ ] Test : variable manquante → erreur claire au premier appel, sans secret dans le message.
- [ ] Test d'intégration Postgres : deux appels successifs indépendants (comme deux fonctions froides) gardent les limites d'envoi de codes (aucun état en mémoire).
- [ ] `vercel build` local (ou équivalent documenté) réussit pour le projet appli, sans secret réel.
- [ ] `pnpm verif` passe en entier ; démo inchangée.

**Hors périmètre** : nom de domaine, sauvegardes payantes, supervision, mise à l'échelle.
