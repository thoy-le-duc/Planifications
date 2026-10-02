# T25 — Démo en ligne (Vercel)

**Objectif** : Théophane (et quiconque a le lien) essaie l'appli sur son téléphone, sans compte ni serveur, avec une ferme fictive déjà remplie ; chaque PR a sa propre adresse de démo.

**Dépend de** : aucun (demande de Théophane du 2026-10-02 : « on le fait sur Vercel » ; projet Vercel relié au dépôt, dossier racine `apps/web`, configuré par lui).
**Périmètre** : `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/vercel.json`, `apps/web/src/demo/**` (nouveau), `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (point d'entrée du mode démo seulement), `apps/web/scripts/**`, `apps/web/e2e/demo.e2e.ts`.

## Règles

- Un troisième build, `pnpm --filter @planif/web build:demo` → `apps/web/dist-demo/` (`vite build --mode demo`). Les builds de production (`dist/`) et des essais (`dist-essais/`) ne changent pas.
- En démo :
  - pas d'écran de connexion : un utilisateur et une ferme fictifs, d'identifiants fixes, propres à la démo ;
  - au premier lancement (base vide), la base locale est remplie avec les jeux de test existants (ferme du jour, plan, itinéraires, quelques refus), datés par rapport au jour du téléphone ;
  - la synchro n'est jamais branchée et aucune requête ne part vers l'API ni PowerSync ; les saisies restent dans le téléphone ;
  - un bandeau discret « Démo — données fictives » et un bouton « Réinitialiser la démo » qui efface la base locale et la remplit à nouveau (avec confirmation).
- Hors ligne et installable comme la vraie appli (service worker, précache).
- Le build de production n'embarque **rien** de la démo (ni jeux de test, ni bandeau) : vérifié par un test sur `dist/`. Le JS de démarrage de la production reste sous le budget, non relevé.
- `apps/web/vercel.json` : commande de build de la démo, dossier `dist-demo`, en-têtes (`sw.js` jamais mis en cache, fichiers `assets/` immuables), réécriture des routes vers `index.html`.

## Critères d'acceptation

- [x] Test : `dist-demo/` contient le mode démo ; `dist/` n'en contient aucune trace (bandeau, jeux, identifiants de démo).
- [x] e2e sur `dist-demo/` : premier lancement → Aujourd'hui affiche des tâches de la ferme fictive, sans écran de connexion ; aucune requête réseau hors de l'origine, et aucune vers `/api` ni PowerSync.
- [x] e2e : « Fait » sur une tâche, rechargement → la tâche reste faite ; « Réinitialiser » → elle revient.
- [x] e2e : rechargement hors ligne → la démo s'ouvre.
- [x] `vercel.json` valide (test qui le lit : commande, dossier de sortie, en-têtes).

## Hors périmètre

- Déployer l'API ou la synchro (hébergement en UE, ticket à venir).
- Toute donnée réelle.
