# T41 — Bibliothèque commune de départ : familles, espèces, itinéraires

**Objectif** : demande de Théophane (2026-10-17, Q43) : « on les met en base dans l'app, après les gens peuvent se les adapter ». Aujourd'hui la bibliothèque commune (lignes `ferme_id` nul, déjà synchronisées par `powersync/sync-config.yaml` et déjà affichées en lecture seule par l'écran Itinéraires) est **vide** : une ferme neuve n'a ni famille, ni espèce, ni itinéraire.

Données : `packages/db/bibliotheque/depart.json` (10 familles, 35 espèces, 46 itinéraires), construites à partir de **sources publiques citées** (semenciers, ITAB, GRAB, chambres d'agriculture). **Jamais** de contenu de la Masterclass de l'Institut Jardinier-Maraîcher (contenu payant ; décision Q43 : base libre). Valeurs usuelles « à vérifier », que chaque ferme adapte.

**Dépend de** : T24 (écran Itinéraires), T32g (Personnaliser une espèce)
**Périmètre** : `packages/db/**` (migration de données, conversion du JSON vers `ParametresItineraire`), `packages/core` si une validation manque, `apps/web/src/ecrans/itineraires/**`, `apps/api/src/sync/**` si nécessaire, tests, `docs/modele-donnees.md`
**Priorité** : haute (premier usage réel).

## Règle

- **Migration de données idempotente** (ids UUID fixes, dérivés du nom), qui insère familles, espèces et itinéraires de la bibliothèque (`ferme_id` NULL). Chaque itinéraire est validé par le cœur (`validerItineraire`) avant d'entrer dans la migration : un test échoue si une ligne du JSON est refusée. Rejouable sans doublon ; une mise à jour future des valeurs passe par une nouvelle migration.
- **Conversion** : le JSON suit les noms du modèle ; convertir `rendementAttendu` (`kg` par mètre ou par plant) vers `RendementAttendu` du cœur, `densite` vers `Densite` (écartement / mètre linéaire / volée, disposition), `periodeUsage` vers `PeriodeSemaines`, `margeSecuritePct` et `pertePepinierePct` vers `Pourcentage`. Les sources et la note « à vérifier » restent dans le JSON du dépôt (pas en base) ; le nom de l'itinéraire suffit à l'écran.
- **« Adapter à ma ferme »** sur un itinéraire de la bibliothèque (écran Itinéraires, vue de lecture) : crée une copie de la ferme (même paramètres, espèce de la ferme si elle a été personnalisée, sinon l'espèce de la bibliothèque), ouvre le formulaire sur la copie. Écriture locale, synchronisée, annulable comme les autres écritures de l'écran.
- Une série peut être créée directement depuis un itinéraire de la bibliothèque (si ce n'est pas déjà le cas, le permettre : l'instantané des paramètres est copié dans la série).
- Rien ne change pour une ferme qui a déjà ses propres lignes.

## Critères d'acceptation

- [x] Test : chaque itinéraire du JSON passe `validerItineraire` après conversion ; familles et espèces cohérentes (toute espèce a sa famille, tout itinéraire son espèce).
- [x] Test d'intégration Postgres : migration appliquée deux fois → mêmes lignes, `ferme_id` NULL ; une ferme neuve les reçoit par la synchro (e2e:synchro si possible).
- [x] Test : « Adapter à ma ferme » crée une copie de la ferme avec les mêmes paramètres, modifiable, et la bibliothèque reste intacte.
- [x] Test : une série créée depuis un itinéraire de la bibliothèque a les bons paramètres.
- [x] `docs/modele-donnees.md` décrit la bibliothèque de départ et sa provenance. `pnpm verif` passe.
