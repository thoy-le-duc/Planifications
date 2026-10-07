# Importer ses fichiers

Vous avez déjà vos planches, vos cultures ou votre plan de culture dans un tableur ? Inutile de tout ressaisir : l'appli lit votre fichier tel qu'il est, et c'est elle qui s'adapte à vos colonnes.

## Où ?

Onglet **Ferme**, carte « Mes données », ligne **Importer un tableur**. Tout se fait sur le téléphone, même sans réseau : la synchronisation enverra l'import quand le réseau reviendra.

## Quels fichiers ?

- **CSV** (séparateur `;`, `,` ou tabulation), y compris les exports d'Excel en Windows-1252 avec des virgules décimales.
- **Excel** (`.xlsx`) : la première feuille non vide est lue. Une ligne de titre au-dessus des en-têtes ne gêne pas.

Un fichier contient une seule sorte de données. Importez-les dans cet ordre, chaque fichier s'appuyant sur le précédent :

1. **Parcellaire** : zones, sous-zones (chapelles…), planches, rangs ou gouttières, avec leur longueur.
2. **Cultures et itinéraires** : vos cultures, leur famille botanique, le mode d'implantation et les durées.
3. **Séries** : ce qui est prévu, culture par culture et planche par planche, avec les dates.
4. **Assolement passé** : ce qui a poussé où, les années passées (pour les rotations).

## Les cinq étapes

1. **Déposer le fichier.** Touchez « Choisir un fichier ». Les imports récents de la ferme sont listés en dessous.
2. **Dire ce qu'il contient.** L'appli propose un choix d'après les en-têtes ; vérifiez-le. Vérifiez l'année de la saison si vos dates sont écrites en semaines (S14, sem 14 ; l'appli propose l'année en cours, ou la suivante à partir de septembre) : une série semée en S40 et plantée en S2 passe d'elle-même à l'année suivante.
3. **Faire correspondre les colonnes.** Chaque colonne du fichier est associée à un champ de l'appli, ou ignorée. Les en-têtes courants sont reconnus (« Planche », « N° planche », « Bed », « Long. (m) »…). Corrigez d'un geste ce qui ne va pas. Un parcellaire sans colonne de zone est rangé dans une « Zone par défaut » que vous nommez ; une zone de la ferme de même nom est reprise, jamais recréée.
4. **Faire correspondre les valeurs.** Une culture que l'appli ne connaît pas (« Salade du jardin ») vous est proposée avec la culture la plus proche ; choisissez-en une autre ou créez-la. Cette étape n'apparaît que s'il y a quelque chose à décider.
5. **Vérifier l'aperçu.** Rien n'est encore écrit. L'aperçu compte les lignes à importer, les lignes en erreur avec leur motif et la cellule en cause, les doublons (dans le fichier, ou déjà dans la ferme : ils ne sont pas réécrits) et les lignes à vérifier (« plantation en 2028 »). Touchez **Importer**.

Une planche inconnue de la ferme met la ligne de série en erreur : importez d'abord le parcellaire.

## Le modèle d'import

Quand vous importez, la correspondance validée (colonnes et choix de valeurs) devient le **modèle** de la ferme. Le fichier suivant de même forme, même avec ses colonnes dans un autre ordre, s'importe sans rien reprendre : l'appli le signale par « Correspondance reprise de votre dernier fichier ».

## Annuler

Juste après l'import, ou plus tard depuis « Imports récents », **Annuler cet import** retire tout ce qu'il a créé, et seulement cela : vos planches et cultures d'avant ne bougent pas. Le modèle d'import, lui, est gardé.

## Gros fichiers

Une ferme complète (plusieurs milliers de séries) s'importe en moins d'une minute. Au-delà de 500 écritures, l'import part en plusieurs envois : l'aperçu l'indique (« import en 7 envois »). Le serveur accepte ou refuse chaque envoi à part ; un envoi refusé apparaît dans « Saisies refusées » de l'onglet Ferme, et « Annuler cet import » retire tout.

Un fichier qui nomme plus de 2 000 cultures différentes est refusé : c'est presque toujours une mauvaise colonne choisie pour « Culture ».

## Bon à savoir

- Lignes vides et lignes de total sont ignorées.
- Nombres à virgule ou à point ; unités reconnues dans l'en-tête ou la cellule (m, cm, kg, g).
- Dates : `JJ/MM/AAAA`, `AAAA-MM-JJ`, date Excel, ou semaine (`S14`).
- Une série sans longueur, sans nombre de plants et sans planche est comptée pour 1 m : complétez-la ensuite.
- Vos données restent les vôtres : l'export de la ferme (même carte « Mes données ») ressort tout en JSON et CSV.
