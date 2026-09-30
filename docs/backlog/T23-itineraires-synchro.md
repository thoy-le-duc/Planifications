# T23 — Synchro : le serveur accepte les itinéraires et les types d'intervention des téléphones

**Objectif** : une ferme crée ou modifie ses itinéraires et ses types d'intervention depuis l'appli, même hors ligne, sans jamais toucher à la bibliothèque commune ni à une autre ferme.

**Dépend de** : T10e, T22
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**`, le banc `e2e:synchro`

## Règles

- **Table des types d'intervention de la ferme** (constat T22 : elle n'existe pas, le type est un texte libre dans l'événement) : créer la table, une migration générée, la descente par la synchro, et une liste de départ (modèle de données, section 5).

- `itineraire` et le type d'intervention s'ouvrent à l'écriture, sur le modèle de T10e :
  - PUT, PATCH, suppression douce ; DELETE refusé ;
  - ferme du jeton seulement ;
  - l'historique `modification` est écrit par le serveur.
- **Bibliothèque commune** (`ferme_id` nul) : en lecture seule. Pour l'adapter, on la duplique dans la ferme.
- Les travaux prévus sont validés par le cœur (T22) : repères, décalages, répétitions et temps plausibles, et type d'intervention de la ferme.
- **Tout ou rien** : l'itinéraire et, le cas échéant, les séries à venir mises à jour avec lui (T24) s'écrivent en une seule transaction.

## Critères d'acceptation

- [ ] Un test d'intégration par règle, dont l'écriture dans la bibliothèque commune (refusée) et celle d'une autre ferme (refusée).
- [ ] e2e à deux téléphones : un itinéraire créé hors ligne sur A arrive chez B.

## Décisions du chef (après les tests)

1. **Périmètre élargi** à ce qu'exige la table : `packages/db`, `packages/sync/src/schema.ts` et `powersync/sync-config.yaml`, `packages/core/src/domaine`, `packages/core/src/export/tables.ts` (la table part dans l'export complet), la page de diagnostic du banc `e2e:synchro`.
2. **Liste de départ = lignes à `ferme_id` nul** insérées par migration, en lecture seule comme la bibliothèque. Masquer un type de départ pour une ferme est laissé à T24 (à concevoir avec l'écran).
3. **« Utilisé »** = présent dans les travaux d'un itinéraire non supprimé de la ferme ; séries et événements ne bloquent pas.
4. **Un type masqué reste valide** pour le serveur ; un type supprimé est refusé.
5. **Les itinéraires désignent un type par son libellé**, donc :
   - renommer un type utilisé, ou changer sa catégorie, est refusé (`ecriture_invalide`) : on en crée un autre et on masque l'ancien ;
   - (catégorie, libellé) est unique parmi les types non supprimés d'une ferme, y compris face à la liste de départ.
6. **Nom d'un itinéraire** : 1 à 80 caractères après suppression des espaces de bord.
7. **Motifs** : `ferme_id` nul en PUT, ou PATCH de `ferme_id` (vers une autre ferme ou NULL) → `ecriture_invalide`.

## Décisions du chef (après la relecture)

8. **Espèce d'un itinéraire figée** : un PATCH qui change `espece_id` d'un itinéraire est refusé (`ecriture_invalide`) ; pour une autre espèce, on duplique. `variete_id` peut changer, mais seulement vers une variété de la même espèce (ou null).
9. **Supprimer un itinéraire utilisé par une série est accepté** : la série garde son instantané. En conséquence, dans `serie.ts` (T10e), le refus « itinéraire supprimé » ne s'applique qu'à la création d'une série ou quand son `itineraire_id` change ; un PATCH d'une série qui ne touche pas `itineraire_id` passe même si son itinéraire a été supprimé depuis.
10. **Libellés normalisés** : le libellé d'un type d'intervention et le `type` d'un travail prévu sont rognés (espaces de bord, y compris insécables) et passés en NFC avant validation et stockage ; les caractères de contrôle et de largeur nulle (U+200B à U+200D, U+2060, U+FEFF) sont refusés.
11. **Unicité insensible à la casse** : (catégorie, libellé) est unique sans tenir compte de la casse parmi les types actifs de la ferme et de la liste de départ (« Grelinette » est un doublon de « grelinette »). La référence d'un travail prévu à un type reste exacte après normalisation.
