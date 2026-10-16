# T39 — Créer sa ferme depuis l'appli (premier compte)

**Objectif** : relevé par Théophane le 2026-10-16, à la mise en ligne (étape 7 du guide). Un compte neuf, connecté, voit « Aucune ferme sur ce téléphone pour l'instant : le plan s'affichera après la première synchronisation » et ne peut rien faire : l'appli n'a **aucun écran pour créer une ferme**, alors que l'API sait le faire (`POST /fermes`, `apps/api/src/fermes.ts`) et que le guide (`docs/mise-en-ligne.md`, étape 7, points 6 à 8) promet « l'écran de création de la ferme ».

**Dépend de** : T09, T11
**Périmètre** : `apps/web/src/**` (App.tsx, donnees/, connexion/, un écran de création), `apps/web/e2e/**`, `docs/mise-en-ligne.md` si le parcours diffère du guide, `apps/web/budget.json` (justifié dans la PR)
**Priorité** : haute (bloque le premier usage réel).

## Règle

- Utilisateur connecté, base ouverte, **aucune ferme** (`base: 'sans-ferme'`) **et en ligne** : les onglets Aujourd'hui et Planches (et Ferme) proposent **« Créer ma ferme »** : nom de la ferme (obligatoire, 200 caractères au plus, mêmes règles que l'API), fuseau horaire par défaut `Europe/Paris` (pas de choix à l'écran en v1).
- Validation : `POST /fermes` (id UUID généré côté client, nom, fuseau) avec le jeton d'accès de la session (même client HTTP que le reste de l'API, renouvellement du jeton compris). Un seul envoi à la fois (bouton désactivé pendant l'envoi, double tap sans effet).
- Réussite : la ferme devient la ferme active dès que la synchro l'apporte (membre + ferme) ; d'ici là, un message clair (« Ferme créée, synchronisation… »). Elle est mémorisée comme ferme choisie.
- Échec : message en français, sans jargon (réseau absent, session expirée, nom refusé), et le nom saisi reste dans le champ.
- **Hors ligne** sans ferme : on ne propose pas un bouton qui échouera ; on dit qu'il faut du réseau pour créer la ferme la première fois.
- Un compte qui a déjà une ferme (ou qui a reçu une invitation acceptée) ne voit jamais cet écran.
- Budget de démarrage : l'écran est chargé à la demande, jamais au démarrage ; démarrage inchangé ou justifié.

## Critères d'acceptation

- [ ] Tests unitaires : formulaire (nom vide ou trop long refusé, double tap, envoi unique, erreurs réseau / 401 / 400 traduites, nom conservé), choix de l'écran selon `base` et réseau.
- [ ] Test : après réussite, la ferme créée devient active quand `membre` et `ferme` arrivent dans la base locale, et elle est mémorisée.
- [ ] e2e : compte neuf → « Créer ma ferme » → la ferme apparaît (sur la pile de synchro de `pnpm e2e:synchro` si possible, sinon avec la base locale simulée comme les autres e2e).
- [ ] `docs/mise-en-ligne.md` étape 7 décrit l'écran réel.
- [ ] `pnpm verif` passe ; démarrage dans le budget.
