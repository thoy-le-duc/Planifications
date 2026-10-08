# T32a — Croissance des cultures : profils et calcul (moteur)

**Objectif** : calculer, pour une occupation et une date, la hauteur de la culture et son stade, d'après un profil de croissance par espèce (Q32). Base du jumeau numérique « avancement dans le temps ». Code pur, déterministe, testé : le LLM n'intervient pas (principe 2).

**Dépend de** : T03 (occupations), T02 (dates de série)
**Périmètre** : `packages/core/src/croissance/**` (nouveau), `packages/core/src/index.ts` (export), migration PostgreSQL et schéma de la base du téléphone (colonne `profil_croissance`), synchro et export, `docs/modele-donnees.md` (v1.x, section « Croissance »)

## Règles

- **Entrées** : dates de l'occupation (mise en place, début et fin de récolte, arrachage ; réelles si présentes, sinon prévues), profil de l'espèce, date du jour du curseur. Sortie : `{ stade, hauteurM, fraction }`.
- **Profil** : forme (`erige-tuteure`, `rosette`, `touffe`, `rampant`, `buisson`, `arbre-ou-liane`, `bulbe-ou-racine`, à ajuster en revue) ; hauteur maximale (m) ; durée jusqu'à la hauteur maximale, en jours depuis la mise en place **ou** en fraction du cycle (mise en place → fin de récolte), l'un des deux ; allure de la courbe (linéaire ou en S, constante nommée) ; hauteur finale conservée ou baissée en fin de cycle (la tomate reste haute jusqu'à l'arrachage).
- **Stades** : avant mise en place (rien), levée (de la mise en place à une fraction fixée de la hauteur), croissance, pleine production (de la hauteur maximale ou du début de récolte à la fin de récolte), fin (après la fin de récolte, jusqu'à l'arrachage), puis rien. Les bornes sont des constantes nommées et testées.
- **Pérennes** (kiwi, asperge, pivoine, fraisier conservé) : cycle annuel simple validé (Q32) : débourrement, pleine végétation, repos, sur les dates de la campagne de l'année ; tailles et âge de la plantation hors périmètre.
- **Valeurs par défaut** pour **toutes** les espèces de la bibliothèque commune (liste lue dans la base de référence, pas recopiée à la main dans le test). Ordres de grandeur de départ : tomate tuteurée 2 m, salade 0,25 m, carotte 0,3 m, courgette 0,6 m (buisson), fraise 0,25 m, asperge 1,5 m en fougère. Chaque valeur a une source ou la mention « valeur usuelle à vérifier » ; Théophane corrige à la revue. Espèce inconnue : profil générique documenté.
- **Pas de décision agronomique** : ce n'est pas une prévision de rendement ni de date de récolte ; la hauteur est une illustration. Le texte le dit là où elle s'affiche (T32b).
- **Réglage par la ferme, stockage à valider** : le ticket propose, sans l'imposer, entre (A) un champ `profil_croissance` (jsonb, nul = défaut) sur l'espèce de la ferme, qui suit la copie de la bibliothèque et la synchro existante, et (B) une table de profils par ferme. Recommandation : A, parce que l'espèce de la ferme est déjà copiée, synchronisée, exportée et réglable, et qu'une table de plus alourdit synchro et export. **À faire valider par Théophane avant toute migration** (question dans `docs/questions.md` si Q32 ne suffit pas). Tant que ce n'est pas tranché, le moteur reçoit un profil en argument et ne lit rien en base.- **Réglage par la ferme, stockage validé (Q32, option A)** : champ `profil_croissance` (jsonb, nul = profil par défaut) sur l'espèce de la ferme. Fait partie du ticket : migration (CHECK : nul ou objet jsonb), colonne dans la base du téléphone, synchro descendante et montante avec les bornes validées par le cœur, colonne dans l'export (JSON et CSV, décrite dans LISEZMOI.txt), complément du modèle de données v1.x. Le moteur reçoit le profil en argument ; l'adaptateur lit le champ, sinon le défaut.

## Critères d'acceptation

- [x] Tests : tomate plantée le 1er mai, arrachée le 15 octobre → hauteur 0 avant le 1er mai, croissante jusqu'à 2 m à la date de hauteur maximale, 2 m jusqu'à l'arrachage, rien après ; stades attendus aux dates de bord (jour de mise en place, de début et de fin de récolte, d'arrachage).
- [x] Tests : durée en jours et durée en fraction du cycle donnent la même hauteur quand elles désignent le même jour ; fraction hors [0, 1] refusée.
- [x] Tests : date du curseur avant, pendant, après ; occupation sans date de fin → pas de fin de cycle inventée (hauteur maximale tenue).
- [x] Tests : date réelle présente → elle remplace la date prévue.
- [x] Test : toute espèce de la bibliothèque commune a un profil valide (hauteur > 0 et ≤ 6 m, durée > 0, forme connue, source ou mention renseignée).
- [x] Tests : pérenne → repousse chaque année sur la campagne ; hors campagne, pas de feuillage.
- [x] Propriété : hauteur monotone croissante jusqu'à la hauteur maximale, jamais négative, jamais au-dessus du maximum.
- [x] Migration, synchro et export : profil réglé écrit sur un téléphone, retrouvé sur l'autre et dans l'export ; profil hors bornes refusé par le serveur ; ferme sans profil inchangée. (Serveur, base, flux et export testés ; l'écriture sur le téléphone par la porte vient avec l'écran de réglage, T32c.)
- [x] `pnpm verif` passe en entier. Aucun `any`, aucun accès réseau ni IA dans le paquet.

## Risques

- Les valeurs par défaut sont des ordres de grandeur : ne pas les présenter comme des mesures. Théophane les corrige ; la revue du ticket en liste les dix plus visibles (tomate, concombre, poivron, aubergine, courgette, salade, chou, carotte, fraise, asperge).
- Pérennes : une campagne ne couvre pas toujours une repousse nette ; si les dates manquent, le profil retombe sur « touffe haute fixe » plutôt que d'inventer.
- Migration : colonne nulle, aucune ferme existante ne change ; la porte du téléphone et le serveur rejouent la même validation.

**Hors périmètre** : affichage 3D (T32b), écran de réglage (T32c), prévision de rendement, modèle de croissance à partir de la météo (degrés-jours).
