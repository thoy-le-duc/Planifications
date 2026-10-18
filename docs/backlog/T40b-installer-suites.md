# T40b — Suites de T40 : le bouton d'installation revient après un refus

**Objectif** : relecture de T40 (PR #194). Sous Android, après un tap sur « Installer l'appli », l'invitation du navigateur est oubliée tout de suite : si le maraîcher refuse la fenêtre, la carte de l'onglet Ferme disparaît jusqu'au prochain `beforeinstallprompt`, que Chrome ne réémet pas toujours. `docs/mise-en-ligne.md` (étape 7, point 10) dit pourtant que la carte « reste là tant que l'appli n'est pas installée ».

**Dépend de** : T40
**Périmètre** : `apps/web/src/installation/**`, `apps/web/src/ecrans/ferme/**`, `apps/web/src/ecrans/aujourdhui/EcranAujourdhui.tsx` (commentaire seulement), `docs/mise-en-ligne.md`, tests
**Priorité** : normale, petit ticket sans risque (affichage).

## Règle

1. Après un refus (`userChoice.outcome === 'dismissed'`), la carte de l'onglet Ferme reste affichée. Comme l'invitation ne se réutilise pas, le bouton donne alors l'aide du navigateur (menu ⋮ → « Installer l'application ») jusqu'à ce qu'un nouveau `beforeinstallprompt` arrive, qui reprend la main.
2. Après acceptation (`accepted` ou `appinstalled`) : plus rien, comme aujourd'hui.
3. Le bandeau d'Aujourd'hui reste fermé après un tap sur « Installer » (inchangé).
4. Commentaire : le JSDoc « T13k : message des abandons » de `EcranAujourdhui.tsx` revient au-dessus de `MessageAbandon`.
5. `docs/mise-en-ligne.md` reste exact.

## Critères d'acceptation

- [x] Test : refus → carte toujours là, le tap montre l'aide Android ; nouvel `beforeinstallprompt` → le tap rouvre la fenêtre du navigateur.
- [x] Test : acceptation → carte cachée.
- [x] Démarrage dans le budget (71,2 Kio) ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, e2e `installation` verts.
