# T88 — Une serre découpée en zones : chapelles × tronçons (modèle, base, calcul)

**Objectif** : demande de Théophane (2026-10-28), règle universelle pour toutes les fermes. Une serre ou un tunnel est un **contenant découpé en zones**, chacune avec sa vanne :
- tunnel Manon : 3 chapelles de 9,6 m sur 40 m, une zone par chapelle (Manon 1, 2, 3) ;
- serre à légumes : 6 chapelles de 9,6 m de large ; dans la longueur, 3 tronçons de 40 m séparés par 2 allées de 4,40 m ; une zone par chapelle et par tronçon, soit 18 zones « en ligne de 6 ».

Les dimensions changent d'une ferme à l'autre, la forme reste la même : **une grille de chapelles (dans la largeur) × tronçons (dans la longueur), avec des allées entre les tronçons**. T86 ne sait faire que des bandes sur toute la longueur (1 tronçon) ; ce ticket généralise.

**Dépend de** : T86
**Périmètre** : `packages/db/` (migration, schéma, valeurs), `apps/api/` (validation des écritures de bâtiment), `powersync/` (colonnes synchronisées), `packages/sync/` si les types y sont décrits, `packages/core/src/placement/**` (calcul pur des cases, à partir de `bandes.ts`), `apps/web/src/ecrans/plan/calculs.ts` et `apps/web/src/ecrans/plan3d/**` (lecture des cases à la place des bandes), tests
**Priorité** : haute (chantier du plan). **Domaine critique** : **oui** (base, synchro).

## Règles

1. Trois colonnes nouvelles sur `batiment`, facultatives : `nb_chapelles` (entier 1 à 100), `nb_troncons` (entier 1 à 50), `largeur_allee_m` (numérique ≥ 0, au millimètre). Nulles = comportement de T86 (une bande par sous-zone, un seul tronçon). La base refuse des valeurs hors bornes, et une grille qui ne tient pas : `nb_troncons × longueur_troncon` doit rester > 0, soit `longueur − (nb_troncons − 1) × largeur_allee_m > 0`.
2. Dimensions dérivées, jamais stockées : **largeur d'une chapelle** = largeur du bâtiment ÷ `nb_chapelles` ; **longueur d'un tronçon** = (longueur − (`nb_troncons` − 1) × `largeur_allee_m`) ÷ `nb_troncons`. Arrondi au millimètre.
3. **Case** (chapelle c de 1 à C, tronçon t de 1 à T), dans le repère du bâtiment (même repère que les bandes de T86 : x dans la largeur, y dans la longueur, origine au centre) : chapelle 1 côté x négatif, tronçon 1 côté y négatif.
4. **Les sous-zones remplissent les cases dans l'ordre naturel de leurs noms**, tronçon par tronçon : tronçon 1 chapelles 1 à C, puis tronçon 2… (pas de colonne sur `zone`). Plus de sous-zones que de cases : les surnuméraires ne sont dans aucune case, avertissement « 2 zones n'ont pas de place dans la serre ». Moins : cases vides dessinées vides.
5. Plan 2D, éditeur et 3D lisent les cases à la place des bandes (une case = limite au sol + nom de sa sous-zone). « Ranger les planches dans les bandes » (T86) range dans les cases, même règle.
6. Écriture et synchro : colonnes ajoutées aux règles PowerSync et à la validation de l'API, isolement par ferme inchangé ; export complet (JSON + CSV) inclut les trois colonnes.

## Exemples chiffrés (tests du cœur)

- Serre à légumes : bâtiment 57,6 × 128,8 m, 6 chapelles, 3 tronçons, allée 4,40 m → chapelle 9,6 m, tronçon 40 m. Centres en x : −24 ; −14,4 ; −4,8 ; 4,8 ; 14,4 ; 24. Centres en y : −44,4 ; 0 ; 44,4 (allées de −24,4 à −20 et de 20 à 24,4).
- Tunnel Manon : 28,8 × 40 m, 3 chapelles, 1 tronçon → mêmes bandes que T86 (centres −9,6 ; 0 ; 9,6).
- Colonnes nulles avec 3 sous-zones → identique à T86.
- 19 sous-zones dans 18 cases → la 19e (ordre naturel) sans case, avertissement.

## Critères d'acceptation

- [ ] Tests de base : migration aller, colonnes nulles acceptées, bornes refusées, grille impossible refusée.
- [ ] Tests API et règles PowerSync : les colonnes s'écrivent et se synchronisent, uniquement pour la ferme du compte.
- [ ] Tests cœur : les quatre exemples chiffrés.
- [ ] Test d'écran : serre à légumes avec 18 sous-zones → 18 cases nommées dans l'éditeur ; « Ranger les planches » range dans les cases.
- [ ] 3D : cases visibles (limite au sol et nom), budget tenu.
- [ ] Export complet : colonnes présentes. `pnpm verif` passe.

## Hors périmètre

Écran de création (T89). Chapelles de largeurs différentes, une zone sur plusieurs chapelles, allées entre chapelles : seulement sur exemple de Théophane.
