# T15b — Export : archive compressée, légère en mémoire et sans formules

**Objectif** : un export qui s'envoie par e-mail et ne fait ni geler ni saturer un téléphone d'entrée de gamme.

**Dépend de** : T15
**Périmètre** : `packages/core/src/export/**`, `packages/sync/src/export*.ts`, `apps/web/src/ecrans/export/**`

## Règles

- **Compression** : ZIP compressé (deflate) ; la ferme d'exemple (T07) passe d'environ 37 Mo à environ 5 Mo.
- **Mémoire** : au pic, pas plus de deux fois la taille de l'archive finale. Aujourd'hui environ 200 Mo pour 37 Mo (relecture T15) :
  - écrire le BOM en octets dans l'archive, pas dans les chaînes ;
  - encoder chaque fichier dès qu'il est produit et relâcher sa chaîne ;
  - écrire `ferme.json` table par table, sans construire l'arbre d'objets.
- **Écran jamais gelé** : export dans un Web Worker, ou au minimum rendre la main entre deux tables ; une barre d'avancement.
- **Formules Excel** : dans les CSV seulement, une cellule qui commence par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée d'une apostrophe, pour qu'Excel ne l'exécute pas. `ferme.json` reste fidèle. Le LISEZMOI l'explique.

## Critères d'acceptation

- [ ] Archive T07 relue par `unzip -t` et Python `zipfile` ; même contenu qu'avant, hormis les cellules neutralisées.
- [ ] Mémoire au pic mesurée en test et sous le plafond.
- [ ] Aucune tâche de plus de 100 ms sur le fil principal pendant l'export (CPU ralenti ×4).
- [ ] Temps total d'export T07 toujours sous 2,5 s en Node.

**Hors périmètre** : réimport de l'archive, exports réglementaires.
