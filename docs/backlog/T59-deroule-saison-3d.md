# T59 — Jumeau 3D : dérouler la saison

**Objectif** : réponse à Q44. Le curseur de semaine existe : on veut **regarder la saison défiler**, voir les cultures pousser, être récoltées, arrachées et remplacées par la suivante, sans toucher l'écran.

**Dépend de** : T32 (croissance), T27 (curseur de semaine)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, tests
**Priorité** : basse (après les tickets du quotidien). **Modèle** : Opus (fluidité).

## Règles

1. Bouton **Lecture / Pause** à côté du curseur. Vitesse au choix : 1 semaine par seconde (par défaut) ou 4 semaines par seconde. Arrêt en fin de saison.
2. Pendant la lecture, la caméra reste libre ; aucun calcul de croissance ne se refait plus d'une fois par semaine affichée.
3. Les **successions** se voient : arrachage (les plants disparaissent), planche nue, mise en place de la culture suivante (jeunes plants).
4. Option « Prévu / Réalisé » : par défaut, les dates réelles remplacent les prévues (règle de T32a) ; « Prévu seul » montre le plan sans les écarts.
5. Fluidité : pas d'image au-delà de 50 ms en moyenne sur le téléphone de mesure (CPU ×4), mesurée en e2e.

## Critères d'acceptation

- [ ] Test : lecture de la semaine 10 à 14 → 4 changements de semaine, arrêt en fin de saison.
- [ ] Test : une planche avec deux séries successives montre l'arrachage, puis la nouvelle culture.
- [ ] e2e de fluidité ; budget `jsVue3dGzKio` respecté ; `pnpm verif` passe.
