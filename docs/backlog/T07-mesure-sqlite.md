# T07 — Mesure : SQLite PowerSync sur téléphone simulé

**Objectif** : prouver tôt que la base locale tient le budget de 300 ms avec le volume d'une vraie ferme, et choisir entre les tables par défaut de PowerSync (vues sur du JSON) et les « raw tables ».

**Dépend de** : —
**Périmètre** : `apps/web/src/mesures/**` (dont le générateur de ferme, autonome pour ne pas attendre T01), `apps/web/e2e/mesure-sqlite.e2e.ts`, `docs/mesures/sqlite.md`

## Contenu

- Générateur déterministe (graine fixe) d'une ferme réaliste : 30 zones, 400 emplacements, 3 000 séries et occupations sur 5 ans, 30 000 événements.
- Page de mesure (hors navigation normale) qui ouvre la base PowerSync en local (sans serveur), charge le jeu généré, puis chronomètre :
  1. ouverture de la base, appli déjà en cache ;
  2. requête de la vue 2D : occupations d'une saison avec emplacement, zone et famille (jointures) ;
  3. requête du semainier d'une semaine ;
  4. insertion d'un événement.
- Les deux variantes (vues JSON, raw tables) mesurées avec le même jeu.

## Critères d'acceptation

- [ ] Test Playwright avec CPU ralenti ×4 qui enchaîne les quatre mesures pour chaque variante et les écrit dans le rapport.
- [ ] `docs/mesures/sqlite.md` : tableau des temps, variante recommandée, et poids du WASM ajouté au cache.
- [ ] Si ouverture + requête 2D dépasse 300 ms dans les deux variantes : le ticket s'arrête là et le problème est écrit dans `docs/questions.md` avec des pistes chiffrées. Pas de contournement silencieux.
- [ ] Le budget de poids du démarrage (`pnpm budget`) reste respecté : le WASM se charge en arrière-plan.

**Hors périmètre** : serveur PowerSync, schéma définitif (T08), interface utilisateur.
