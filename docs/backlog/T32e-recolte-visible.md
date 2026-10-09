# T32e — Jumeau 3D : la récolte se voit

**Objectif** (Q34) : voir d'un coup d'œil ce qui est à récolter. Les fruits apparaissent et grossissent (courgette, fraise, tomate…), une planche à récolter se signale même en vue d'ensemble, et les plants jaunissent ou se dégarnissent en fin de récolte. « Il faut que ce soit visuellement impactant. »

**Dépend de** : T32d
**Périmètre** : `packages/core/src/croissance/**` (stade de récolte, calcul pur et testé), `apps/web/src/ecrans/plan3d/**`, e2e 3D, `apps/web/budget.json` (voir Budget)

## Règles

- **Le code calcule** (principe 2) : le cœur rend, pour une occupation et une semaine, un état de récolte : `aucune`, `fruits en formation` (avec une maturité de 0 à 1), `à récolter`, `fin de récolte`. Il se déduit des dates de l'occupation (début et fin de récolte prévues, réelles si saisies) et du profil de croissance ; rien n'est inventé sans date. Les récoltes saisies (T10) peuvent l'affiner si c'est simple ; sinon, le dire dans la PR.
- **Fruits** : une petite forme instanciée par type (allongée verte pour la courgette, ronde rouge pour la tomate et la fraise, autre forme générique), qui grossit avec la maturité et prend sa couleur mûre à « à récolter ». Couleurs dans `src/ui/jetons.ts`. Plafond de fruits par plant et au total (constantes nommées).
- **Planche « à récolter »** (Q35) : une **balise au-dessus de la planche** (panier ou pastille de couleur vive, instanciée, toujours tournée vers la caméra ou lisible sous tous les angles), visible en vue d'ensemble ; la liste des zones et l'alternative texte le mentionnent (« 3 planches à récolter »).
- **Fin de récolte** : feuillage qui jaunit ou s'éclaircit sur les dernières semaines de la fenêtre.
- Pérennes : la fraise (et toute pérenne à récolte annuelle) suit sa période de récolte annuelle.
- Garde-fous T29b tenus ; rendu à la demande ; aucun seuil de fluidité touché.
- **Budget** : vue 3D ≤ 228 Kio (Q33) ; si c'est impossible, constat chiffré et question, sans relever.

## Critères d'acceptation

- [ ] Tests du cœur : courgette avant la récolte → `aucune` ; une semaine avant le début → `fruits en formation` (maturité entre 0 et 1, croissante) ; pendant la fenêtre → `à récolter` ; dernières semaines → `fin de récolte` ; après arrachage → `aucune` ; sans date de récolte → `aucune`.
- [ ] Tests 3D : fruits présents seulement en formation ou à récolter, nombre plafonné, taille croissante avec la maturité ; planche « à récolter » signalée ; planche filtrée T27b estompée sans signal criard.
- [ ] e2e (démo) : à une semaine de récolte de courgettes, `data-planches-a-recolter` > 0 et le texte annonce le nombre.
- [ ] Captures : courgettes et fraises avant, pendant et en fin de récolte, et une vue d'ensemble montrant les planches à récolter.
- [ ] `pnpm verif` passe en entier ; budgets tenus.

**Hors périmètre** : saisie de récolte depuis la 3D, prévision de rendement, animation continue.
