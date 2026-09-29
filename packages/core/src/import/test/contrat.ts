/**
 * Contrat de `packages/core/src/import` (T14, moteur d'import pur ; docs/backlog/T14-import-csv.md).
 * L'API que les tests attendent de `src/import/index.ts`, réexportée par `@planif/core`
 * (src/index.ts), et du lecteur Excel `src/import/xlsx.ts`, qui n'est PAS réexporté.
 *
 * Les modules sont chargés dynamiquement (`chargerImport`, `chargerXlsx`) : tant qu'ils n'existent
 * pas, les tests échouent sur « module introuvable » au lieu de casser le typage du dépôt. Une fois
 * écrits, ils doivent satisfaire ces types ; ils peuvent définir les leurs s'ils sont compatibles.
 *
 * ── Découpage (décision du chef d'équipe) ───────────────────────────────────────────────────
 *
 * Cette branche (T14) : le MOTEUR seul, pur, dans `packages/core/src/import/**` — lecture,
 * détection, correspondance des colonnes et des valeurs, normalisation, validation, aperçu (plan
 * d'import), modèle d'import. Ni base, ni réseau, ni horloge, ni écran : des valeurs en entrée, un
 * plan en sortie. RIEN n'est écrit : `preparerImport` rend ce qui SERAIT importé.
 * T14b : les écrans, l'écriture du plan dans la base locale en une opération annulable, `docs/import/`.
 *
 * Aucune fonction de ce module ne lève d'exception, quelle que soit l'entrée : résultats typés,
 * codes d'erreur stables (même style que `validerSaisie`, src/saisies). Toutes déterministes :
 * même entrée → même sortie, entrée jamais modifiée (les tests passent des objets gelés).
 *
 * Attention : `@planif/core` est compilé sans les types de Node ni du DOM (lib ES2023) : pas de
 * `TextDecoder` déclaré, pas de `Buffer`. Le décodage UTF-8 / Windows-1252 est écrit à la main
 * (ou `TextDecoder` retrouvé par `globalThis` avec un type local, au choix du développeur).
 *
 * ── Lecteur Excel (.xlsx) : décision testeur ────────────────────────────────────────────────
 *
 * Le cœur ne dépend d'aucune bibliothèque de tableur. Il déclare l'interface `LecteurClasseur`
 * et le reste du moteur ne travaille que sur des lignes de cellules (`LigneBrute[]`), qu'elles
 * viennent d'un CSV ou d'un classeur. L'implémentation est dans `src/import/xlsx.ts`, qui exporte
 * `lecteurXlsx: LecteurClasseur` et n'est importé NI par `src/import/index.ts` NI par
 * `src/index.ts` : l'appli le charge par `import()` au moment où l'on dépose un .xlsx, hors du
 * budget de démarrage (T14b branchera le chemin d'import, par exemple une entrée
 * `"./import-xlsx"` dans le package.json du cœur). Le choix de la bibliothèque revient au
 * développeur ; piste sans dépendance : `DecompressionStream('deflate-raw')` (navigateurs
 * récents et Node ≥ 18) pour le ZIP, et un petit lecteur XML des parties utiles ; sinon une
 * bibliothèque légère (fflate…). Tout ce qui est chargé doit rester pur (pas de réseau).
 *
 *   lecteurXlsx.lire(octets: Uint8Array): Promise<ResultatClasseur>
 *
 * Ne rejette jamais : octets qui ne sont pas un .xlsx (CSV, octets au hasard, fichier vide, ZIP
 * sans classeur) → `{ ok: false, code: 'classeur_illisible', message }` (message en français).
 * Sinon `{ ok: true, feuilles }` : les feuilles dans l'ordre du classeur (xl/workbook.xml), avec
 * leur nom. `lignes[i]` est la ligne Excel i + 1 (les lignes vides restent, pour que les numéros
 * de ligne soient ceux qu'on voit dans Excel) ; `lignes[i][j]` est la colonne j (A = 0).
 * Cellules : texte (chaînes partagées `t="s"` ET chaînes en ligne `t="inlineStr"`, Excel écrit
 * les premières, LibreOffice et openpyxl parfois les secondes) → `string` ; nombre → `number`
 * tel qu'écrit, y compris les DATES, rendues en numéro de série Excel (46461 = 2027-03-15) :
 * c'est `lireDate` qui les convertit, selon le champ ; booléen → 'VRAI' / 'FAUX' ; formule →
 * sa dernière valeur calculée, `null` s'il n'y en a pas ; cellule absente ou vide → `null`.
 * Cellules fusionnées : la valeur dans la première, `null` dans les autres. Les `null` en fin de
 * ligne et les lignes vides en fin de feuille peuvent être omis (les tests les ignorent).
 * Cellule date ISO `t="d"` (« 2027-03-15T00:00:00 », « 2027-03-15 ») → texte 'AAAA-MM-JJ' (heure
 * ignorée) ; contenu qui n'est pas une date ISO → le texte tel quel (`lireDate` le refusera).
 * Système de dates (relecture, point 6) : `<workbookPr date1904="1">` (ou "true") → chaque feuille
 * porte `systemeDates: 1904`, sinon 1900 ; les numéros de série restent tels qu'écrits, c'est
 * `lireDate` qui applique le système (voir `EntreeImport.systemeDates`).
 * Limites (relecture, points 1 et 2), toutes → `classeur_illisible`, jamais d'exception, en temps
 * linéaire et sans allocation démesurée (tas de 512 Mo dans les tests) :
 *   - au plus 5 000 000 de cases créées pour TOUT le classeur : chaque ligne créée compte pour une
 *     case (lignes vides de remplissage comprises), chaque cellule aussi (`null` de remplissage
 *     compris) ; le plafond se vérifie AVANT d'allouer (`<c r="XFD1">` sur 20 000 lignes, ou six
 *     feuilles réduites à `<row r="1048576">`, échouent en moins de 2 s) ;
 *   - une même partie ne peut pas être lue deux fois comme feuille (deux feuilles déclarées qui
 *     visent la même partie → classeur illisible) ;
 *   - une balise (de « < » à « > ») de plus de 64 Kio, ou dont un attribut n'est jamais refermé →
 *     illisible, en temps linéaire (1 Mo de « a » dans une balise : moins de 1 s) ;
 *   - (2e relecture) chaque chaîne partagée (`<si>` de xl/sharedStrings.xml, `<si/>` compris) compte
 *     aussi pour une case dans le plafond de 5 000 000 (9 millions de `<si/>` → illisible, < 2 s) ;
 *   - (2e relecture) une cellule de plus de 32 767 caractères une fois décodée (la limite d'Excel),
 *     chaîne partagée ou en ligne → illisible ; 32 767 passe ;
 *   - (3e relecture) de même pour TOUTE valeur de cellule, quel que soit son type : le texte d'un
 *     `<v>` de plus de 32 767 caractères (nombre, `t="e"`, `t="d"`, `t="b"`, `t="str"`) → illisible ;
 *   - (3e relecture) une référence numérique qui n'est pas un caractère XML (`&#0;`, `&#x0;`, une
 *     moitié de paire de substitution `&#xD800;` … `&#xDFFF;`, en décimal comme en hexadécimal)
 *     → illisible, jamais une moitié de paire ni un caractère nul dans une cellule.
 * Entités XML (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`, `&#233;`, `&#xE9;`) et échappements OOXML
 * (`_x0041_` → 'A', `_x005F_x0041_` → '_x0041_' : `_x005F_` échappe le soulignement) décodés dans
 * les textes et les attributs, en temps et en mémoire LINÉAIRES : une chaîne en ligne de 5 millions
 * de `&amp;` ou de 7 millions de `_x0041_` est refusée (plus de 32 767 caractères) en moins de 2 s,
 * tas de 512 Mo, sans exception.
 *
 * ── Lecture d'un CSV ────────────────────────────────────────────────────────────────────────
 *
 *   decoderTexte(octets: Uint8Array): TexteDecode
 * (2e relecture) BOM UTF-16 en tête (FF FE → 'utf-16le', FE FF → 'utf-16be' : export « Texte
 * Unicode » d'Excel) : décodé en UTF-16 (paires de substitution comprises), BOM retiré, `bom: true`.
 * Sans BOM, des octets nuls restent un fichier binaire (voir lireCsv).
 * (3e relecture) Une moitié de paire de substitution isolée (unité D800–DFFF sans sa moitié) ou un
 * octet final impair → U+FFFD, comme `TextDecoder`.
 * UTF-8 si les octets sont de l'UTF-8 valide (BOM EF BB BF retiré du texte, `bom: true`) ;
 * sinon Windows-1252 (exports Excel) : 0xE9 → 'é', 0x80 → '€', 0x92 → '’', 0x9C → 'œ',
 * (BOM UTF-8 suivi d'octets qui ne sont pas de l'UTF-8 : décodé en Windows-1252, BOM retiré du
 * texte, `bom: true`) ;
 * 0x8C → 'Œ' ; les cinq octets non définis (0x81, 0x8D, 0x8F, 0x90, 0x9D) → U+0081… comme le
 * WHATWG. ASCII pur → 'utf-8'. Vide → texte '' en 'utf-8'.
 * (3e relecture) Seul un BOM UTF (EF BB BF, FF FE, FE FF) est retiré : un fichier Windows-1252 qui
 * commence par 0xFF (« ÿ ») ou 0xFE (« þ ») garde ce caractère.
 * Décodeur natif et repli (3e relecture, point 4) : `TextDecoder` (retrouvé par `globalThis`) peut
 * servir ; le décodage écrit à la main sert quand `globalThis.TextDecoder` n'existe pas au moment
 * du premier décodage (le test le retire dans un fil isolé, avant de charger le module). Les deux
 * rendent EXACTEMENT le même résultat, cas limites compris (paires isolées, octet impair, UTF-8
 * invalide ou tronqué, BOM suivi de Windows-1252).
 *
 *   detecterSeparateur(texte: string): Separateur
 * ';', ',' ou tabulation : celui qui découpe les premières lignes (hors guillemets) en un même
 * nombre de champs > 1 ; à égalité, le plus fréquent dans l'en-tête ; aucun → ';'. Un fichier
 * ';' plein de virgules décimales (« 32,5 ») reste ';'.
 *
 *   lireCsv(octets: Uint8Array): CsvLu
 * decoderTexte puis detecterSeparateur, puis découpage RFC 4180 : champs entre guillemets
 * (séparateur, guillemets doublés et retours à la ligne gardés), fins de ligne CRLF, LF ou CR ;
 * la dernière fin de ligne ne crée pas de ligne vide ; une ligne `;;;;` donne des champs ''.
 * Guillemet non fermé : le reste du fichier est le dernier champ (pas d'exception).
 * Cellules d'un CSV : toujours des chaînes (vide = ''). `erreur: null`.
 * Fichier binaire déposé comme CSV (octets qui commencent par la signature ZIP `PK\x03\x04` — un
 * .xlsx renommé —, ou qui contiennent un octet nul hors UTF-16 avec BOM) → `erreur: { code:
 * 'fichier_binaire', message }` (message en français qui dit quoi faire), `lignes: []`. Jamais
 * d'exception.
 * (3e relecture) Avec un BOM UTF-16, le fichier est binaire si les octets qui suivent le BOM
 * commencent par la signature ZIP, ou si le texte décodé contient un caractère nul (U+0000) :
 * `fichier_binaire` aussi.
 * Limites (2e relecture, point 3), tas de 512 Mo dans les tests :
 *   - lignes vides de FIN de fichier (tous leurs champs vides ou faits d'espaces) : ni créées ni
 *     comptées. 5 Mo de « \n » seuls → `lignes: []`, `erreur: null` ; 20 Mo de « ; » seuls (une
 *     ligne vide) → de même ; 1 000 000 de lignes « ;;;;;; » après un vrai fichier → les lignes
 *     utiles avant sont rendues, rien d'autre. Une ligne vide AVANT une ligne utile reste (elle
 *     garde les numéros de ligne ; « ;; » y donne des champs '') ;
 *   - même plafond que le .xlsx : au plus 5 000 000 de cases, chaque ligne rendue compte pour une
 *     case et chacun de ses champs aussi ; au-delà → `erreur: { code: 'fichier_trop_grand',
 *     message }` (en français, dit de découper le fichier), `lignes: []`, en moins de 2 s et sans
 *     tout allouer (5 Mo de « \n » puis une ligne utile ; une ligne de 20 Mo de « ; » suivie d'une
 *     ligne utile). 1 000 000 de lignes « a;b » (3 millions de cases) passent ;
 *   - (3e relecture, point 2) au plus 1 048 576 lignes rendues (comme une feuille Excel, lignes
 *     vides d'avant une ligne utile comprises) ; au-delà → `fichier_trop_grand`, même si le plafond
 *     de cases n'est pas atteint (1 048 577 lignes « a ») ; 1 048 576 passent ;
 *   - (3e relecture, point 2) mémoire bornée : 1 000 000 de lignes « ab », 1 000 000 de lignes
 *     « a;b », et 1 000 000 de lignes vides AU MILIEU (suivies d'une ligne utile) sont lues avec un
 *     tas plafonné à 300 Mo.
 *
 * ── Détection ───────────────────────────────────────────────────────────────────────────────
 *
 *   detecterEntete(lignes: readonly LigneBrute[]): number | null
 * Indice (0 = première ligne) de la ligne d'en-tête : parmi les 20 premières lignes, celle qui a
 * le plus de cellules reconnues par le dictionnaire des synonymes (tous types confondus), la
 * première à égalité (une cellule de plus de 200 caractères n'est jamais reconnue, et se traite en
 * temps linéaire : 100 Kio en moins de 200 ms) ; si aucune cellule n'est reconnue, la première ligne qui a au moins deux
 * cellules texte non vides ; `null` si aucune (feuille vide). Une ligne de titre au-dessus des
 * en-têtes est ainsi sautée (classeur : en-tête en ligne Excel 3 → indice 2).
 *
 *   proposerType(entetes: readonly Cellule[]): TypeContenu | null
 * D'après les champs reconnus dans les en-têtes (dictionnaire de tous les types) :
 *   - 'series'      : espece ET au moins une date (date_semis, date_plantation,
 *                     date_debut_recolte, date_fin_recolte) ;
 *   - 'assolement'  : annee ET (zone ou emplacement) ET (famille ou espece), sans date ;
 *   - 'cultures'    : espece ET au moins un de famille, mode, duree_pepiniere_jours,
 *                     duree_avant_recolte_jours, fenetre_recolte_jours, rangs_par_planche,
 *                     ecartement_cm, poids_mille_graines_g — sans zone ni emplacement ;
 *   - 'parcellaire' : zone ou emplacement, sans espece ni famille ;
 *   - sinon null (l'utilisateur choisit).
 *
 * ── Correspondance des colonnes ─────────────────────────────────────────────────────────────
 *
 *   proposerCorrespondance(entetes: readonly Cellule[], type: TypeContenu): Correspondance
 * Une entrée par colonne, dans l'ordre : le champ de l'appli (parmi CHAMPS_IMPORT[type]) et
 * l'unité lue dans l'en-tête, ou `{ champ: null, unite: null }` (colonne ignorée). Un champ est
 * pris par une seule colonne (la première) ; une colonne vide ou inconnue est ignorée.
 * Comparaison insensible à la casse, aux espaces autour, aux accents, aux ligatures (œ → oe) et
 * à la ponctuation (« Long. » = « long » ; « Type d’abri » = « type d'abri » ; « longueur_m » =
 * « longueur m »). Préfixe de numéro ignoré en tête d'en-tête : « N° », « No », « Nº », « N. »,
 * « Num », « Numéro (de) », « # », collé ou non (« N° planche » = « N°planche » = « No. planche »
 * = « Numéro de planche » = « planche »). Texte final entre parenthèses ou crochets retiré avant
 * la comparaison (« Durée pépinière (j) » = « durée pépinière »). Unité aussi lue après « en »
 * (« Longueur en cm »), après « / » ou « par » (« Plants/m² ») et en suffixe de l'export T15
 * (« longueur_m », « poids_mille_graines_g »). En-tête de plus de 200 caractères : jamais reconnu.
 *
 * Unités dans l'en-tête (relecture, point 4). Une UNITÉ EXPLICITE est un de ces mots (casse,
 * accents et points ignorés) : m, cm, mm, km, g, kg, t, ha, a, m², m2, j, jour, jours, sem,
 * semaine, semaines, mois, an, ans, h, nb, nombre, graines, plants, pieds, pouces, l, €, eur,
 * euros, % ; et (2e relecture) les unités anglaises ft, feet, in, inch, inches, yd, lb, lbs, oz,
 * ac, acre, acres, week, weeks, wk, day, days, month, months. Une unité explicite ACCEPTÉE pour le champ donne `unite` ; une unité explicite qui
 * ne l'est pas → la colonne n'est PAS proposée (`{ champ: null, unite: null }`) : « Longueur
 * (kg) », « Écartement (pouces) », « Récolte (kg) », « Récolte (€) », « Semis (graines) »,
 * « Plantation (nb) », « Plants/m² », « Length (ft) », « Spacing (in) », « PMG (oz) », « Surface
 * (acres) », « Durée pépinière (months) » sont ignorées : jamais lues dans la mauvaise unité.
 * « en » devant l'unité entre parenthèses est permis : « Longueur (en cm) » → cm. Un autre texte entre parenthèses (« (nom) »,
 * « (JJ/MM/AAAA) ») est simplement retiré, `unite` null. Unités acceptées :
 *   longueur_m, largeur_m, ecartement_cm   m, cm → unite 'm' / 'cm'
 *   poids_mille_graines_g                  g, kg → unite 'g' / 'kg'
 *   surface_m2                             m², m2 → unite null (unité du champ) ;
 *                                          ha → unite 'ha' (décision testeur : courant chez les
 *                                          maraîchers ; valeur × 10 000, exacte : « 1,5 » → 15 000)
 *   durées en jours (duree_pepiniere_jours, duree_avant_recolte_jours, fenetre_recolte_jours)
 *                                          j, jour, jours, day, days → unite null (unité du champ) ;
 *                                          sem, semaine, semaines, week, weeks, wk → unite
 *                                          'semaine' (décision testeur : conversion simple,
 *                                          valeur × 7 ; le résultat doit rester entier : « 1,5 »
 *                                          semaine → 'nombre_invalide')
 *   dates (date_semis, date_plantation, date_debut_recolte, date_fin_recolte)
 *                                          (2e relecture) sem, semaine, semaines, week, weeks, wk
 *                                          → unite 'semaine' : « Semis (sem.) » est une date de
 *                                          semis donnée en numéros de semaine. Dans une telle
 *                                          colonne, un entier de 1 à 53 (nombre ou texte, « 14 »)
 *                                          est le numéro de semaine ISO de `anneeSaison` (lundi,
 *                                          comme « S14 ») ; un nombre à virgule ou une semaine qui
 *                                          n'existe pas → 'date_invalide' ; sans saison →
 *                                          'annee_manquante' ; les autres écritures (« S14 »,
 *                                          « 15/03/2027 ») se lisent comme d'habitude
 *   nombre_places, nombre_plants, rangs_par_planche
 *                                          nb, nombre → unite null
 *   tous les autres champs                 aucune
 *
 * Dictionnaire (au MINIMUM ces synonymes, après normalisation ; en ajouter est libre, sauf
 * « mètres », « lieu dit » et « semaine de … », que les tests du modèle d'import veulent
 * inconnus) :
 *   zone          zone, parcelle, ilot, bloc, field, plot, zone_id
 *   sous_zone     sous-zone, chapelle, sous-parcelle, section
 *   emplacement   planche, n° planche, numéro de planche, bed, rang, gouttière, emplacement, code
 *   sorte         sorte, type d'emplacement
 *   longueur_m    longueur, long, length, lg
 *   largeur_m     largeur, larg, width
 *   type_abri     abri, type d'abri, cover
 *   surface_m2    surface, superficie
 *   nombre_places nombre de places, nb places, places
 *   espece        culture, espèce, légume, crop, espece_id
 *   variete       variété, variety, cultivar, variete_id
 *   famille       famille, famille botanique, family, famille_id
 *   mode          mode, mode d'implantation, implantation
 *   duree_pepiniere_jours      durée pépinière, jours en pépinière
 *   duree_avant_recolte_jours  jours avant récolte, durée avant récolte, days to maturity
 *   fenetre_recolte_jours      fenêtre de récolte, durée de récolte, harvest window
 *   rangs_par_planche          rangs, rangs/planche, rangs par planche, nombre de rangs
 *   ecartement_cm              écartement, espacement, spacing
 *   poids_mille_graines_g      pmg, poids de mille graines, poids_mille_graines
 *   date_semis                 semis, date de semis, date semis, prevu_semis_pepiniere,
 *                              sowing, sowing date
 *   date_plantation            plantation, date de plantation, date plantation, prevu_mise_en_place,
 *                              planting, planting date
 *   date_debut_recolte         début récolte, début de récolte, récolte, prevu_debut_recolte,
 *                              harvest start
 *   date_fin_recolte           fin récolte, fin de récolte, prevu_fin_recolte, harvest end
 *   nombre_plants              nombre de plants, nb plants, plants
 *   annee                      année, saison, year
 * Aller-retour avec l'export T15 : les colonnes techniques (id, ferme_id, cree_le, modifie_le,
 * supprime_le, remplace, parametres, statut…) sont ignorées ; `zone_id` va dans zone,
 * `espece_id` dans espece (rapprochée par identifiant, voir `rapprocher`).
 *
 * ── Champs de l'appli par type (CHAMPS_IMPORT) ──────────────────────────────────────────────
 *
 *   parcellaire  zone*, sous_zone, emplacement, sorte, longueur_m, largeur_m, type_abri,
 *                surface_m2, nombre_places
 *   cultures     espece*, variete, famille, mode, duree_pepiniere_jours,
 *                duree_avant_recolte_jours, fenetre_recolte_jours, rangs_par_planche,
 *                ecartement_cm, poids_mille_graines_g
 *   series       espece*, variete, emplacement, date_semis, date_plantation,
 *                date_debut_recolte, date_fin_recolte, longueur_m, nombre_plants
 *                (au moins une des quatre dates : sinon 'champ_manquant', champ null)
 *   assolement   annee*, zone, emplacement, famille, espece
 *                (zone ou emplacement, et famille ou espece : sinon 'champ_manquant')
 * (* obligatoire : cellule vide → 'champ_manquant' sur ce champ.)
 * Nature et valeur normalisée de chaque champ (dans `LignePlan.valeurs`) :
 *   texte     zone, sous_zone, emplacement, variete → texte sans espaces autour
 *   choix     sorte → 'planche' | 'rang' | 'gouttiere' ; type_abri → 'plein_champ' | 'tunnel' |
 *             'serre' | 'hors_sol' ; mode → 'semis_direct' | 'plant_maison' | 'plant_achete'.
 *             Casse, accents et ponctuation ignorés ; au minimum : « plein champ », « open
 *             field », « tunnel », « serre », « greenhouse », « hors sol » ; « planche »,
 *             « rang », « gouttière » ; « semis direct », « plant maison », « plant acheté ».
 *             Autre valeur → 'valeur_inconnue' ; jamais une propriété héritée d'objet :
 *             « constructor », « __proto__ », « toString » → 'valeur_inconnue'
 *   mesure    longueur_m, largeur_m (en m) ; ecartement_cm (en cm) ; poids_mille_graines_g (en g)
 *             → `lireMesure` avec l'unité de l'en-tête par défaut ; ≤ 0 → 'hors_bornes'
 *   nombre    surface_m2 → `lireNombre` (× 10 000 si l'unité est 'ha') ; ≤ 0 → 'hors_bornes'
 *   entier    nombre_places, nombre_plants, rangs_par_planche (≥ 1), durées en jours (≥ 0 ; × 7 si
 *             l'unité est 'semaine'), annee (2000 à 2100) → nombre à virgule → 'nombre_invalide',
 *             hors bornes → 'hors_bornes'
 *   date      date_* → `lireDate` avec `anneeSaison`, `systemeDates` et l'ordre jour/mois de la
 *             colonne (voir « Plan d'import »); unite 'semaine' : numéros de semaine (voir « Unités »)
 *   référence espece → bibliotheque.especes, famille → bibliotheque.familles (`ReferenceImport`)
 * Longueur (2e relecture, point 2) : un texte, un choix ou une référence de plus de 200 caractères
 * (espaces autour retirés ; 200 passe) → erreur 'texte_trop_long' sur ce champ (comme
 * 'nombre_invalide' pour les nombres), pas de décision demandée pour cette valeur.
 * Cellule vide → null (champ facultatif) ; cellule absente (ligne plus courte que l'en-tête, fréquent
 * dans un classeur) = vide ; nombre dans un champ texte → son écriture ('3', '12.5'). Un champ
 * non associé est ABSENT de `valeurs`. Les valeurs d'une ligne en erreur ne sont pas garanties.
 *
 * ── Normalisation ───────────────────────────────────────────────────────────────────────────
 *
 * Limite commune (relecture, point 3) : `lireNombre`, `lireMesure` et `lireDate` travaillent en
 * temps linéaire (cellule de 100 Kio : moins de 200 ms) ; texte de plus de 200 caractères (espaces
 * autour retirés) → 'nombre_invalide' (nombre, mesure) ou 'date_invalide' (date).
 *
 *   lireNombre(c: Cellule): Lecture<number | null>
 * '' ou espaces ou null → null ; nombre fini tel quel ; texte : signe facultatif, chiffres,
 * virgule OU point décimal, espaces de milliers (espace, U+00A0, U+202F) tolérés :
 * '12,5' → 12.5, '12.5' → 12.5, ' 1 234,5 ' → 1234.5 ; autre chose ('abc', '1,2,3', '12,5 kg'
 * hors mesure, NaN, Infinity) → 'nombre_invalide'.
 *
 *   lireMesure(c: Cellule, cible: UniteMesure, parDefaut: UniteMesure | null): Lecture<number | null>
 * Nombre suivi facultativement d'une unité (« 30 m », « 30m », « 1500 cm », « 250 g »,
 * « 1,5 kg »), convertie vers `cible` ; sans unité dans la cellule, `parDefaut` (ou `cible` si
 * null). Conversion EXACTE en décimal (décalage de la virgule, pas de flottant intermédiaire) :
 * '32,5' cm → m = 0.325 ; '12,3' cm → m = 0.123 ; 25.5 m → cm = 2550 ; '1,2' kg → g = 1200.
 * Unité inconnue ou d'une autre grandeur (« 3 kg » vers m) → 'unite_inconnue' ; nombre illisible
 * → 'nombre_invalide'.
 *
 *   lireDate(c: Cellule, anneeSaison: number | null, options?: OptionsDate): Lecture<DateCalendaire | null>
 *   - 'JJ/MM/AAAA' (jour et mois sur 1 ou 2 chiffres) → 'AAAA-MM-JJ' ; 'MM/JJ/AAAA' si
 *     `options.ordre` vaut 'mm_jj' (défaut 'jj_mm') ;
 *   - 'AAAA-MM-JJ' ;
 *   - nombre = date Excel, système `options.systemeDates` (défaut 1900) :
 *     1900 : 60 est le 29/02/1900 qui n'existe pas (bogue de Lotus repris par Excel), 61 →
 *     1900-03-01, 46461 → 2027-03-15 ; 1904 : 0 → 1904-01-01, 44999 → 2027-03-15 ;
 *     partie décimale (heure) ignorée ; < 1 (1900) ou < 0 (1904) → 'date_invalide' ;
 *     PLAGE (relecture, point 5) : la date obtenue doit tomber dans les années [anneeSaison − 5,
 *     anneeSaison + 5] (2027 : du 2022-01-01 au 2032-12-31), ou en 1950 au plus tôt si
 *     `anneeSaison` est null ; sinon 'date_invalide' (un nombre qui n'est pas une date, une
 *     quantité dans la mauvaise colonne) ;
 *   - semaine : 'S14', 's14', 'S 14', 'sem 14', 'Sem. 14', 'semaine 14' → LUNDI de la semaine
 *     ISO 14 de `anneeSaison` (2027 → 2027-04-05) ; `anneeSaison` null → 'annee_manquante' ;
 *     semaine qui n'existe pas cette année-là (S53 en 2027, S0) → 'date_invalide' ;
 *   - date qui n'existe pas (31/02/2027) ou autre texte → 'date_invalide'.
 *
 * ── Correspondance des valeurs ──────────────────────────────────────────────────────────────
 *
 *   rapprocher(valeur: string, references: readonly Reference[]): Rapprochement
 * `exact` : la valeur normalisée (casse, accents, ponctuation, espaces) est égale au nom, à un
 * synonyme ou à l'identifiant d'une référence ; `propositions[0]` est alors cette référence,
 * score 1. Sinon `exact: false` et les références de score ≥ 0,5, par score décroissant puis par
 * nom, 5 au plus ; score dans [0, 1[, déterministe. Si tous les mots d'une référence sont dans
 * la valeur (« Batavia blonde » ⊃ « batavia »), son score est ≥ 0,7. Rien d'approchant → [].
 *
 * ── Plan d'import (validation et aperçu) ────────────────────────────────────────────────────
 *
 *   preparerImport(entree: EntreeImport): PlanImport
 * Lignes lues après `ligneEntete`. Ignorées (`ignorees`, avec le motif, REGROUPÉES EN PLAGES
 * (2e relecture, point 3) : des lignes qui se suivent avec le même motif forment une seule entrée
 * `{ debut, fin, motif }`, numéros comme `LignePlan.ligne`, `debut` = `fin` pour une ligne seule ;
 * `resume.ignorees` compte les LIGNES ; 1 000 000 de lignes vides → une entrée, en moins de 2 s) : ligne vide (toutes ses
 * cellules vides ou espaces) → 'vide' ; ligne de total → 'total' : seule la PREMIÈRE cellule non
 * vide parmi les colonnes associées à un champ est examinée ; elle commence par le mot « total »
 * ou « sous-total » (casse et accents ignorés), ou par « somme » à condition que le champ
 * emplacement de la ligne soit vide (ou non associé) — « Somme » est aussi un nom de lieu.
 * « Total à revoir » dans une colonne non associée (Notes) ne fait pas ignorer la ligne.
 * Les autres donnent chacune une `LignePlan`, dans l'ordre, avec `ligne` = son numéro dans le
 * fichier comme on le voit dans le tableur (première ligne = 1 : en-tête en 1 → données dès 2).
 * Hiérarchie du parcellaire (zone, sous_zone) : une cellule vide reprend la valeur de la ligne
 * au-dessus (cellules fusionnées) ; une nouvelle zone efface la sous-zone reprise.
 * `niveaux` (parcellaire seulement, sinon null) : nombre de niveaux associés parmi zone,
 * sous_zone, emplacement (1, 2 ou 3).
 * Dates JJ/MM ou MM/JJ, décidé PAR COLONNE sur toutes ses lignes de données : si une valeur
 * « a/b/AAAA » a a > 12 → JJ/MM ; sinon, si une valeur a b > 12 → MM/JJ ; sinon JJ/MM (défaut
 * français). Les deux à la fois : JJ/MM, et les valeurs impossibles en JJ/MM sont 'date_invalide'.
 * `systemeDates` (défaut 1900) : celui de la feuille du classeur, pour les numéros de série.
 * Règles de ligne (relecture) :
 *   - cellule non vide (hors espaces) au-delà de la largeur de l'en-tête (position de sa dernière
 *     cellule non vide + 1) → une erreur 'colonnes_en_trop', champ null, colonne = la première
 *     de ces cellules ;
 *   - séries : les dates présentes doivent se suivre, semis ≤ plantation ≤ début de récolte ≤ fin
 *     de récolte (égalité permise ; pas de bascule sur l'année suivante, question à Théophane) ;
 *     sinon UNE erreur 'dates_incoherentes', sur le premier champ (dans cet ordre) dont la date
 *     précède celle d'un champ précédent, colonne = la sienne.
 * Statut d'une ligne, par priorité :
 *   'erreur'    au moins une erreur ; `erreurs` les liste TOUTES (code, champ, colonne 0-based,
 *               message en français ≤ 200 caractères). Une ligne en erreur ne bloque pas les autres ;
 *   'a_decider' une référence (espece, famille) non exacte et sans choix : valeur
 *               `{ sorte: 'a_decider', valeur }` ; la décision est dans `decisions` ;
 *   'doublon'   même clé qu'une ligne précédente valide ou à décider (`doublonDe` = son numéro) ;
 *               clé : parcellaire (zone, sous_zone, emplacement) ; cultures (espece, variete,
 *               mode) ; séries toutes les valeurs ; assolement (annee, zone, emplacement,
 *               famille, espece) ; textes comparés normalisés ;
 *   'valide'.
 * `decisions` : une par (champ, valeur normalisée), dans l'ordre de première apparition, avec
 * les numéros de ligne concernés et les propositions de `rapprocher`.
 * `choix` (facultatif) : décisions déjà prises (écran, ou modèle d'import) ; valeur comparée
 * normalisée ; `existante` → `{ sorte: 'existante', id }`, `nouvelle` → `{ sorte: 'nouvelle', nom }`.
 * Un choix `existante` dont l'identifiant n'est pas (ou plus) dans la bibliothèque est écarté :
 * la valeur repasse « à décider » (décision demandée comme sans choix).
 * Temps linéaire (2e relecture, point 2) : une même chaîne de 1 Mo (chaîne partagée d'un classeur)
 * dans toutes les colonnes de 3 000 lignes → plan en moins de 2 s, tas de 512 Mo.
 * (3e relecture, point 1) Le texte nettoyé (espaces autour retirés) d'une cellule est calculé une
 * fois par CHAÎNE, pas une fois par cellule : un classeur de 100 000 lignes et 5 colonnes dont les
 * cellules sont trois chaînes partagées de 32 767 caractères (« a » puis 32 766 espaces, 32 767
 * espaces, « Total » puis des espaces) → plan (hors lecture du classeur) en moins de 2 s.
 * Champ en double (3e relecture, point 5) : une correspondance qui associe le même champ à
 * plusieurs colonnes n'est pas lue en silence (ni la première, ni la dernière) : chaque ligne du
 * plan (hors lignes ignorées) est en erreur 'champ_en_double' sur ce champ, colonne = la DEUXIÈME
 * colonne qui le porte ; une erreur par champ en double.
 * Messages : l'extrait de la cellule cité (40 caractères au plus) ne coupe jamais une paire de
 * substitution (émoji…) ; le message non plus.
 * Correspondance dont un champ obligatoire n'est associé à aucune colonne : chaque ligne est en
 * erreur 'champ_manquant' (colonne null).
 *
 * ── Modèle d'import ─────────────────────────────────────────────────────────────────────────
 *
 *   creerModele(entetes: readonly Cellule[], correspondance: Correspondance, choix: readonly ChoixValeur[]): ModeleImport
 *   serialiserModele(modele: ModeleImport): string          // JSON
 *   lireModele(texte: string): ModeleImport | null          // null si illisible, version ou champ inconnus,
 *                                                            // id de choix vide, nom de nouvelle
 *                                                            // valeur vide (espaces seuls compris),
 *                                                            // unité non acceptée
 *                                                            // pour le champ (ou sur une colonne ignorée),
 *                                                            // (3e relecture) même champ sur deux colonnes
 *   appliquerModele(modele: ModeleImport, entetes: readonly Cellule[]): Correspondance | null
 * Le modèle retient, par en-tête, le champ et l'unité validés, plus les choix de valeurs. Il
 * s'applique à un fichier de MÊME FORME : mêmes en-têtes normalisés, dans n'importe quel ordre ;
 * sinon null. lireModele(serialiserModele(m)) est égal à m.
 * (3e relecture) `appliquerModele` en temps linéaire, même avec beaucoup d'en-têtes identiques :
 * 400 000 colonnes à l'en-tête vide → moins de 1 s.
 *
 * ── Performance ─────────────────────────────────────────────────────────────────────────────
 *
 * Préparer l'import d'une ferme complète (jeu au volume de T07 passé par l'export T15, plus un
 * tableur de 30 000 séries en Windows-1252 à rapprocher) : moins de 15 s en Node (critère du
 * ticket : 60 s avec le CPU ralenti ×4).
 *
 * ── Bibliothèque ────────────────────────────────────────────────────────────────────────────
 *
 * FAMILLES_PAR_DEFAUT : familles botaniques fournies avec l'appli et leurs délais de retour par
 * défaut (années). PROVISOIRES, à valider par Théophane (voir le test familles.test.ts).
 */
import type { DateCalendaire } from '../../dates/index.ts';

export type { DateCalendaire };

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────

export type Cellule = string | number | null;
export type LigneBrute = readonly Cellule[];

export type SystemeDates = 1900 | 1904;

export interface Feuille {
  readonly nom: string;
  readonly lignes: readonly LigneBrute[];
  /** Système de dates du classeur (`<workbookPr date1904>`), pour les numéros de série. */
  readonly systemeDates: SystemeDates;
}

export type ResultatClasseur =
  | { readonly ok: true; readonly feuilles: readonly Feuille[] }
  | { readonly ok: false; readonly code: 'classeur_illisible'; readonly message: string };

export interface LecteurClasseur {
  lire(octets: Uint8Array): Promise<ResultatClasseur>;
}

export type Encodage = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';
export type Separateur = ';' | ',' | '\t';

export interface TexteDecode {
  readonly texte: string;
  readonly encodage: Encodage;
  readonly bom: boolean;
}

export interface CsvLu {
  readonly encodage: Encodage;
  readonly bom: boolean;
  readonly separateur: Separateur;
  readonly lignes: readonly (readonly string[])[];
  /** Fichier binaire (un .xlsx renommé, octets nuls) ou trop grand (plus de 5 000 000 de cases ou de 1 048 576 lignes) : `lignes` vide. */
  readonly erreur: { readonly code: 'fichier_binaire' | 'fichier_trop_grand'; readonly message: string } | null;
}

// ── Champs et correspondance ─────────────────────────────────────────────────────────────────

export type TypeContenu = 'parcellaire' | 'cultures' | 'series' | 'assolement';

export type CleChamp =
  | 'zone'
  | 'sous_zone'
  | 'emplacement'
  | 'sorte'
  | 'longueur_m'
  | 'largeur_m'
  | 'type_abri'
  | 'surface_m2'
  | 'nombre_places'
  | 'espece'
  | 'variete'
  | 'famille'
  | 'mode'
  | 'duree_pepiniere_jours'
  | 'duree_avant_recolte_jours'
  | 'fenetre_recolte_jours'
  | 'rangs_par_planche'
  | 'ecartement_cm'
  | 'poids_mille_graines_g'
  | 'date_semis'
  | 'date_plantation'
  | 'date_debut_recolte'
  | 'date_fin_recolte'
  | 'nombre_plants'
  | 'annee';

export type UniteMesure = 'm' | 'cm' | 'kg' | 'g';
/** Unité lue dans un en-tête : une mesure, ou une conversion (hectares, semaines). */
export type UniteColonne = UniteMesure | 'ha' | 'semaine';

export interface DefinitionChamp {
  readonly cle: CleChamp;
  /** En français, pour l'écran de correspondance. */
  readonly libelle: string;
  readonly obligatoire: boolean;
}

export interface ColonneAssociee {
  readonly champ: CleChamp | null;
  readonly unite: UniteColonne | null;
}

export interface Correspondance {
  readonly type: TypeContenu;
  /** Une entrée par colonne du fichier, dans l'ordre. */
  readonly colonnes: readonly ColonneAssociee[];
}

// ── Normalisation ────────────────────────────────────────────────────────────────────────────

export type CodeErreurImport =
  | 'nombre_invalide'
  | 'unite_inconnue'
  | 'date_invalide'
  | 'annee_manquante'
  | 'champ_manquant'
  | 'valeur_inconnue'
  | 'hors_bornes'
  | 'dates_incoherentes'
  | 'colonnes_en_trop'
  | 'texte_trop_long'
  /** (3e relecture) Correspondance qui associe le même champ à plusieurs colonnes. */
  | 'champ_en_double';

export type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly code: CodeErreurImport };

export interface OptionsDate {
  /** 'JJ/MM/AAAA' (défaut) ou 'MM/JJ/AAAA'. */
  readonly ordre?: 'jj_mm' | 'mm_jj';
  /** Système des numéros de série Excel (défaut 1900). */
  readonly systemeDates?: SystemeDates;
}

// ── Valeurs ──────────────────────────────────────────────────────────────────────────────────

export interface Reference {
  readonly id: string;
  readonly nom: string;
  readonly synonymes?: readonly string[];
}

export interface Proposition {
  readonly id: string;
  readonly nom: string;
  readonly score: number;
}

export interface Rapprochement {
  readonly exact: boolean;
  readonly propositions: readonly Proposition[];
}

export type ReferenceImport =
  | { readonly sorte: 'existante'; readonly id: string }
  | { readonly sorte: 'nouvelle'; readonly nom: string }
  | { readonly sorte: 'a_decider'; readonly valeur: string };

export interface ChoixValeur {
  readonly champ: 'espece' | 'famille';
  readonly valeur: string;
  readonly decision: { readonly sorte: 'existante'; readonly id: string } | { readonly sorte: 'nouvelle'; readonly nom: string };
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

export interface Bibliotheque {
  readonly especes: readonly Reference[];
  readonly familles: readonly Reference[];
}

export interface EntreeImport {
  /** Toutes les lignes de la feuille, en-tête compris (et ce qui le précède). */
  readonly lignes: readonly LigneBrute[];
  readonly ligneEntete: number;
  readonly correspondance: Correspondance;
  readonly bibliotheque: Bibliotheque;
  /** Année de la saison, pour les dates en semaines et la plage des numéros de série. */
  readonly anneeSaison: number | null;
  readonly choix?: readonly ChoixValeur[];
  /** Système de dates de la feuille (classeur) ; défaut 1900. */
  readonly systemeDates?: SystemeDates;
}

export type ValeurImport = string | number | ReferenceImport | null;

export interface ErreurImport {
  readonly code: CodeErreurImport;
  readonly champ: CleChamp | null;
  readonly colonne: number | null;
  readonly message: string;
}

export type StatutLigne = 'valide' | 'erreur' | 'a_decider' | 'doublon';

export interface LignePlan {
  readonly ligne: number;
  readonly statut: StatutLigne;
  readonly valeurs: Readonly<Partial<Record<CleChamp, ValeurImport>>>;
  readonly erreurs: readonly ErreurImport[];
  readonly doublonDe: number | null;
}

export interface DecisionValeur {
  readonly champ: 'espece' | 'famille';
  /** Valeur telle qu'écrite à sa première apparition (sans espaces autour). */
  readonly valeur: string;
  readonly lignes: readonly number[];
  readonly propositions: readonly Proposition[];
}

export interface PlanImport {
  readonly type: TypeContenu;
  readonly lignes: readonly LignePlan[];
  /** Plages de lignes ignorées qui se suivent avec le même motif (`debut` ≤ `fin`, bornes comprises). */
  readonly ignorees: readonly { readonly debut: number; readonly fin: number; readonly motif: 'vide' | 'total' }[];
  readonly decisions: readonly DecisionValeur[];
  readonly niveaux: 1 | 2 | 3 | null;
  readonly resume: {
    readonly valides: number;
    readonly erreurs: number;
    readonly aDecider: number;
    readonly doublons: number;
    readonly ignorees: number;
  };
}

// ── Modèle d'import ──────────────────────────────────────────────────────────────────────────

export interface ModeleImport {
  readonly version: 1;
  readonly type: TypeContenu;
  /** Par en-tête du fichier (tel qu'écrit), le champ et l'unité validés. */
  readonly colonnes: readonly { readonly entete: string; readonly champ: CleChamp | null; readonly unite: UniteColonne | null }[];
  readonly choix: readonly ChoixValeur[];
}

// ── Bibliothèque ─────────────────────────────────────────────────────────────────────────────

export interface FamilleParDefaut {
  readonly nom: string;
  readonly delaiRetourMinimalAns: number;
  readonly delaiRetourConseilleAns: number;
}

// ── Modules ──────────────────────────────────────────────────────────────────────────────────

export interface ModuleImport {
  decoderTexte(octets: Uint8Array): TexteDecode;
  detecterSeparateur(texte: string): Separateur;
  lireCsv(octets: Uint8Array): CsvLu;
  detecterEntete(lignes: readonly LigneBrute[]): number | null;
  proposerType(entetes: readonly Cellule[]): TypeContenu | null;
  proposerCorrespondance(entetes: readonly Cellule[], type: TypeContenu): Correspondance;
  readonly CHAMPS_IMPORT: Readonly<Record<TypeContenu, readonly DefinitionChamp[]>>;
  lireNombre(c: Cellule): Lecture<number | null>;
  lireMesure(c: Cellule, cible: UniteMesure, parDefaut: UniteMesure | null): Lecture<number | null>;
  lireDate(c: Cellule, anneeSaison: number | null, options?: OptionsDate): Lecture<DateCalendaire | null>;
  rapprocher(valeur: string, references: readonly Reference[]): Rapprochement;
  preparerImport(entree: EntreeImport): PlanImport;
  creerModele(entetes: readonly Cellule[], correspondance: Correspondance, choix: readonly ChoixValeur[]): ModeleImport;
  serialiserModele(modele: ModeleImport): string;
  lireModele(texte: string): ModeleImport | null;
  appliquerModele(modele: ModeleImport, entetes: readonly Cellule[]): Correspondance | null;
  readonly FAMILLES_PAR_DEFAUT: readonly FamilleParDefaut[];
}

export interface ModuleXlsx {
  readonly lecteurXlsx: LecteurClasseur;
}

/** Chemins tenus dans des variables : TypeScript ne résout pas les modules avant qu'ils existent. */
const CHEMIN_MODULE = '../index.ts';
const CHEMIN_XLSX = '../xlsx.ts';
const CHEMIN_COEUR = '../../index.ts';

export async function chargerImport(): Promise<ModuleImport> {
  return (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleImport;
}

export async function chargerXlsx(): Promise<ModuleXlsx> {
  return (await import(/* @vite-ignore */ CHEMIN_XLSX)) as ModuleXlsx;
}

/** `@planif/core` tel que l'appli l'importe. */
export async function chargerCoeur(): Promise<Partial<ModuleImport> & Partial<ModuleXlsx>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleImport> & Partial<ModuleXlsx>;
}
