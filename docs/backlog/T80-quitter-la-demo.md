# T80 — Démo : pouvoir en sortir et retrouver la vraie appli

**Objectif** : demande de Théophane (2026-10-21) : sur son ordinateur, il arrive sur la version de démonstration (ferme fictive, sans connexion) et ne voit aucun « Se déconnecter » ni moyen d'atteindre sa vraie ferme.

**Dépend de** : T25b
**Périmètre** : `apps/web/src/demo/**`, `apps/web/src/ecrans/ferme/EcranFerme.tsx` (bouton démo seulement), `apps/web/e2e/demo.e2e.ts`, `apps/web/vite.config.ts` (variable de construction), tests, `docs/mise-en-ligne.md`
**Priorité** : haute (bloque l'usage sur ordinateur). **Domaine critique** : non (agent `developpeur`).

## Règles

1. Dans l'onglet Ferme de la démo, à la place de l'absence de « Se déconnecter », un bouton **« Quitter la démo »** ouvre l'adresse de la vraie appli (variable de construction `VITE_URL_APPLI_REELLE`, adresse publique, jamais un secret). Variable absente : le bouton n'apparaît pas et le bandeau « Démo — données fictives » le dit.
2. Le bandeau de démo affiche aussi le lien « Ouvrir la vraie appli » sur tous les onglets.
3. La production n'embarque rien de la démo (test existant sur `dist/` inchangé).
4. `docs/mise-en-ligne.md` : où poser `VITE_URL_APPLI_REELLE` dans le projet Vercel de la démo (nom de la variable et valeur à saisir par Théophane, pas de valeur dans le dépôt).
5. Si l'ordinateur garde la démo installée comme appli, le guide dit comment la désinstaller.

## Critères d'acceptation

- [ ] e2e sur `dist-demo/` : le bouton « Quitter la démo » mène à l'adresse donnée ; sans la variable, pas de bouton.
- [ ] `dist/` ne contient aucune trace du bouton ni de la variable.
- [ ] `pnpm verif` passe.
