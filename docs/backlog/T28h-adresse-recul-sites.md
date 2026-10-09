# T28h — Éditeur de placement : chercher une adresse, voir large, plusieurs sites

**Objectif** (Q35) : qu'un maraîcher trouve sa ferme sur la photo aérienne sans se perdre, quelle que soit sa taille, même répartie sur plusieurs sites. « Pour positionner le lieu, ce serait pas mal de pouvoir taper l'adresse ; là on est complètement paumé. » C'est la porte d'entrée d'un nouveau client (pas de fichier à importer : il construit sa ferme dans l'éditeur).

**Dépend de** : T28b, T28e, T28g (faits)
**Périmètre** : `apps/web/src/ecrans/placement/**`, éventuellement `apps/web/index.html` ou la configuration du service worker si une politique de contenu doit autoriser le service de géocodage, tests associés

## Règles

- **Recherche d'adresse** : un champ « Adresse, commune ou lieu-dit » en haut de l'éditeur. Service de géocodage de l'IGN (Géoplateforme, `https://data.geopf.fr/geocodage/search?q=…&limit=5`, gratuit, sans clé, hébergé en France), même fournisseur que la photo aérienne. Au plus 5 propositions ; un tap centre la carte sur le lieu à un zoom adapté (commune : vue large ; adresse : vue de la parcelle). Saisie : attente de 300 ms après la dernière frappe, une seule requête à la fois, la précédente abandonnée.
- **Hors ligne ou service muet** : message clair (« Recherche d'adresse indisponible sans réseau ; déplacez la carte à la main ») ; l'éditeur reste utilisable. Aucune adresse n'est enregistrée ni envoyée ailleurs que dans la requête de recherche ; le dire dans la PR (données du maraîcher).
- **Recul** : zoom minimal ramené de 14 à **6** (vue d'une région) ; zoom de départ sans position connue : la France entière ou presque (zoom 6), avec le champ d'adresse mis en avant ; zoom de départ avec origine connue : inchangé. Au-delà de la limite des tuiles (19), comportement actuel.
- **Plusieurs sites** : une liste « Aller à » des zones de premier niveau déjà placées (chacune peut être un site distinct, à des kilomètres) et « Toute la ferme » qui cadre l'ensemble des zones placées ; même logique que les boutons de la vue 3D (T28c), sans calcul dupliqué.
- **Origine du plan** (T28s) : inchangée. La recherche d'adresse ne la pose ni ne la déplace ; elle déplace seulement la vue. Le premier placement continue de poser l'origine.
- Téléphone et gants : champ et propositions en gros caractères ; clavier « Entrée » prend la première proposition.
- Budget de l'éditeur (`jsPlacementGzKio` 18,5 Kio, saturé) : tenu, ou hausse chiffrée et justifiée dans la PR (la recherche peut vivre dans un petit morceau chargé au premier tap dans le champ).

## Critères d'acceptation

- [ ] Test : saisie « Moissac » → une requête (pas une par frappe), propositions affichées ; tap → vue centrée sur les coordonnées rendues, zoom adapté au type de résultat.
- [ ] Test : hors ligne → message, aucune erreur, carte toujours déplaçable.
- [ ] Test : zoom minimal 6 atteint au bouton et au pincement ; ferme sans origine → départ à 6 avec le champ en avant.
- [ ] Test : deux zones de premier niveau placées à 20 km l'une de l'autre → « Aller à » centre chacune ; « Toute la ferme » cadre les deux.
- [ ] Test : la recherche ne modifie jamais `ferme.origine_plan`.
- [ ] e2e (ordinateur, réseau simulé par Playwright, aucune requête réelle à l'IGN dans les tests) : recherche → sélection → la carte montre le lieu.
- [ ] `pnpm verif` passe en entier ; démarrage inchangé ; budget de l'éditeur tenu ou hausse justifiée.

## Risques

- La 3D d'une ferme sur deux sites éloignés : la vue d'ensemble rapetisse tout. Hors périmètre ici, à signaler dans la PR si constaté.
- Disponibilité du service IGN : la recherche est un confort, jamais un passage obligé.

**Hors périmètre** : enregistrer l'adresse de la ferme, saisie de plusieurs origines, cadastre.
