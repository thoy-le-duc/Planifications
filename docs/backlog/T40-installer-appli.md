# T40 — Installer l'appli sur le téléphone (web app)

**Objectif** : demande de Théophane (2026-10-17) : « rajoute quelque chose pour installer l'app au téléphone en web app ». Aujourd'hui il faut connaître le menu du navigateur (« Ajouter à l'écran d'accueil »). L'appli doit le proposer elle-même, sur Android comme sur iPhone, et l'icône installée doit être propre.

**Dépend de** : T16 (design), T20 (service worker)
**Périmètre** : `apps/web/index.html`, `apps/web/vite.config.ts` (manifeste), `apps/web/public/` (icônes), `apps/web/src/**` (bouton et bandeau), `apps/web/e2e/**`, `apps/web/budget.json` (justifié dans la PR), `docs/mise-en-ligne.md` (étape 7, point 10)
**Priorité** : haute (demande directe, premier usage réel).

## Règle

- **Installable partout** : manifeste avec icônes PNG 192 et 512 (dont une `maskable`), `id`, `scope`, `start_url` ; `apple-touch-icon` PNG 180 et métas iOS (`apple-mobile-web-app-capable`, titre court) ; icônes générées depuis `icone.svg`, nettes sur fond clair et sombre.
- **Android / Chrome** : l'événement `beforeinstallprompt` est retenu ; l'appli montre « Installer l'appli » qui ouvre la fenêtre d'installation du navigateur, en un tap.
- **iPhone / Safari** (pas d'API) : le même bouton ouvre une courte aide illustrée : « Touchez Partager, puis Sur l'écran d'accueil ».
- **Où** : une carte « Installer sur ce téléphone » dans l'onglet Ferme, toujours accessible ; et un bandeau discret, une seule fois, sur Aujourd'hui (fermable, ne revient pas après fermeture, jamais pendant une saisie).
- **Jamais proposé** si l'appli tourne déjà installée (`display-mode: standalone`, `navigator.standalone`), ni sur ordinateur sans possibilité d'installer, ni dans la démo si cela gêne ses tests.
- **Vitesse** : rien qui ralentisse le démarrage ; le code d'aide est chargé à la demande. Retenir `beforeinstallprompt` tôt peut coûter quelques octets au démarrage : compenser ou relever le budget en le justifiant.

## Critères d'acceptation

- [ ] Test : manifeste conforme (icônes 192/512/maskable présentes et servies, `display: standalone`), `apple-touch-icon` présent.
- [ ] Test : `beforeinstallprompt` retenu → bouton visible → tap → `prompt()` appelé une fois ; après installation (`appinstalled`) le bouton disparaît.
- [ ] Test : Safari iOS simulé → aide « Partager → Sur l'écran d'accueil ».
- [ ] Test : appli déjà installée → ni carte ni bandeau ; bandeau fermé → ne revient pas.
- [ ] e2e : critères d'installabilité de Chromium (manifeste valide, service worker) vérifiés.
- [ ] `docs/mise-en-ligne.md` décrit le bouton. `pnpm verif` passe.
