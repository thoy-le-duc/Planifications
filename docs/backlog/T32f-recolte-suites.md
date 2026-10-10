# T32f — Récolte visible : suites de la relecture T32e

**Objectif** : que chaque culture récoltable soit signalée correctement dans la 3D, même les récoltes courtes et les pérennes d'hiver.

**Dépend de** : T32e
**Périmètre** : `packages/core/src/croissance/recolte.ts` et ses tests, `apps/web/src/ecrans/plan3d/**` (données des plants, balise), e2e 3D

## Constat (relecture T32e)

1. **Récolte courte jamais « à récolter »** : si la fenêtre de récolte dure 14 jours ou moins (début ≥ fin − 14), la phase passe directement de « fruits en formation » à « fin de récolte » : un radis ou une salade récoltés sur 10 jours n'ont jamais de balise.
2. **Balise pendant la fin de récolte** : elle disparaît sur les 14 derniers jours alors que la planche est encore récoltable (Q38, en attente).
3. **Pérennes à cheval sur deux années** : la campagne est cherchée par l'année du jour : la formation avant un début de récolte en janvier n'est pas vue en décembre, et une campagne qui finit l'année suivante est coupée au 31 décembre.
4. **Pérenne après la fin** : retour à « aucune » (feuillage non jauni), alors qu'une annuelle reste en « fin de récolte » jusqu'à l'arrachage.
5. **Zoom serré en pleine récolte** : jusqu'à 4 800 triangles de fruits en plus ; aucune mesure e2e dans ce cas.

## Règles

- La fin de récolte ne commence jamais avant la moitié de la fenêtre : début de la fin = max(F − 14, B + ⌈(F − B) / 2⌉). Toute récolte ouverte a donc au moins un jour « à récolter ».
- Balise pendant la fin de récolte : selon la réponse à Q38 (si oui : une teinte plus pâle, jeton dans `ui/jetons.ts`, et la planche reste comptée dans « N planches à récolter »).
- Pérennes : la campagne qui contient le jour, ou celle qui commence dans les 28 jours, quelle que soit son année de rattachement.
- Garde-fous T29b tenus ; aucun budget relevé.

## Critères d'acceptation

- [ ] Test du cœur : récolte de 10 jours → au moins un jour « à récolter », puis « fin de récolte » ; fenêtre de 60 jours → inchangée par rapport à T32e.
- [ ] Test du cœur : fraise d'hiver (récolte du 10 janvier au 20 mars), le 20 décembre → « fruits en formation ».
- [ ] Test du cœur : campagne du 1er décembre au 15 février → « à récolter » le 10 janvier.
- [ ] Selon Q38 : test 3D de la balise en fin de récolte.
- [ ] e2e : zoom serré sur une zone en pleine récolte de la grande ferme T07, bornes `BORNES_FERME_T07` tenues.
- [ ] `pnpm verif` passe en entier.
