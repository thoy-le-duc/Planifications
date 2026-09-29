/**
 * Contrat de `packages/core/src/export` (T15, docs/backlog/T15-export.md, puis T15b,
 * docs/backlog/T15b-export-leger.md) : l'API que les tests attendent de `src/export/index.ts`,
 * réexportée par `@planif/core` (src/index.ts).
 *
 * Le module est chargé dynamiquement (`chargerExport`) : tant qu'il n'existe pas, les tests
 * échouent sur « module introuvable » au lieu de casser le typage de tout le dépôt. Une fois le
 * module écrit, il doit satisfaire ces types ; il peut définir les siens s'ils sont compatibles.
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Principe 5 : le maraîcher récupère toutes les données de SA ferme, en un geste, hors ligne.
 * Tout est pur ici : ni base, ni réseau, ni horloge, ni PowerSync. L'entrée est neutre (les
 * lignes de chaque table, au format local de @planif/sync) ; la lecture de la base est dans
 * `exporterFerme` (@planif/sync, voir packages/sync/src/test/contrat-export.ts).
 *
 * Attention : `@planif/core` est compilé sans les types de Node ni du DOM (lib ES2023) :
 * pas de `Buffer`, et `TextEncoder` n'y est pas déclaré. D'où des fichiers en texte ici ;
 * `creerZip` (même module) encode lui-même en UTF-8. `construireExport` rend des fichiers que
 * `creerZip` prend tels quels : `await creerZip(construireExport(entree), { date })`.
 * `construireExport` reste la RÉFÉRENCE du contenu, en texte ; l'archive du téléphone se fait
 * par `construireArchive` (T15b, plus bas), qui produit les mêmes octets sans tenir les textes.
 *
 * ── Entrée ──────────────────────────────────────────────────────────────────────────────────
 *
 *   construireExport(entree: EntreeExport): FichierExport[]
 *
 * `entree.tables` : nom de table → lignes, telles que la base locale les rend (`SELECT *`) :
 * colonnes snake_case, valeurs texte, nombre ou null ; dates 'AAAA-MM-JJ', instants ISO,
 * jsonb et tableaux en texte JSON, booléens en 0/1. Tables absentes = vides. L'entrée peut
 * contenir PLUS que la ferme exportée (le téléphone garde toutes les fermes dont l'utilisateur
 * est membre) et plus que ce qui est exportable : c'est `construireExport` qui filtre.
 *
 * ── Ce qui est exporté (liste blanche : TABLES_EXPORTEES) ───────────────────────────────────
 *
 * `TABLES_EXPORTEES` décrit, pour chaque table exportée, chaque colonne (id compris, en
 * premier) : son type d'export et sa description en français (≥ 10 caractères, pour
 * LISEZMOI.txt). Ce sont exactement les tables et colonnes du schéma local de @planif/sync
 * (`TABLES_LOCALES` + `id`), SAUF la table `refus_synchro` (vérifié par
 * packages/sync/src/export.test.ts) :
 *   - `refus_synchro` : exclue en entier. Ce sont des incidents techniques de synchro propres
 *     à un utilisateur (et côté serveur, sa colonne `donnees` peut contenir une écriture
 *     refusée, d'une autre ferme par exemple), pas des données de la ferme.
 *   - Toute table ou colonne absente de TABLES_EXPORTEES est ignorée, même présente dans
 *     l'entrée : `email`, `donnees`, `jeton*`, `code_connexion`, `jeton_renouvellement`…
 *     Liste blanche, jamais liste noire : une colonne ajoutée plus tard à la base n'entre dans
 *     l'export qu'en l'ajoutant à TABLES_EXPORTEES, avec sa description.
 *
 * Types d'export (la base locale ne les distingue pas, TABLES_EXPORTEES les fixe) :
 *   'texte' | 'entier' | 'reel' | 'booleen' | 'date' | 'instant' | 'json'
 * (règle de correspondance exacte avec le schéma : packages/sync/src/export.test.ts).
 *
 * Filtrage par ferme (`fermeId`) :
 *   - `ferme` : la seule ligne dont `id` = fermeId ;
 *   - `utilisateur` : les lignes dont `id` est l'`utilisateur_id` d'une ligne `membre` de la
 *     ferme exportée (le téléphone n'a de toute façon que son propre compte, sans e-mail) ;
 *   - bibliothèque (`famille`, `espece`, `variete`, `itineraire`, `produit_phyto`, drapeau
 *     `bibliotheque: true`) : `ferme_id` = fermeId → avec les tables de la ferme ;
 *     `ferme_id` nul → bibliothèque de référence, À PART (dossier `bibliotheque/`, clé
 *     `bibliotheque` du JSON). Décision : incluse, parce que les séries et itinéraires de la
 *     ferme pointent vers ces espèces et familles : sans elles l'archive ne se lit pas seule.
 *     Toujours séparée, pour ne jamais la confondre avec ce que la ferme a saisi ;
 *   - toutes les autres : `ferme_id` = fermeId. Une autre ferme n'apparaît jamais.
 * Les lignes supprimées (`supprime_le` rempli) sont exportées, avec leur `supprime_le` : l'export
 * rend TOUTE la base de la ferme, même nombre de lignes par table ; LISEZMOI l'explique.
 * L'ordre des lignes est celui de l'entrée.
 *
 * ── Sortie : les fichiers de l'archive ──────────────────────────────────────────────────────
 *
 * Exactement ces fichiers, toujours (une table vide donne un CSV réduit à son en-tête) :
 *   - `ferme.json`
 *   - `LISEZMOI.txt`
 *   - `<table>.csv` pour chaque table de TABLES_EXPORTEES (lignes de la ferme) ;
 *   - `bibliotheque/<table>.csv` pour chaque table `bibliotheque: true` (lignes à ferme_id nul).
 *
 * ferme.json (UTF-8 sans BOM, JSON valide) :
 *   {
 *     "format": "planifications-export", "version": 1,
 *     "ferme_id": "<fermeId>", "genere_le": "<entree.genereLe>",
 *     "tables":       { "<table>": [ligne, …], … },   // toutes les tables exportées, même vides
 *     "bibliotheque": { "famille": [ligne, …], … }     // les 5 tables de bibliothèque, ferme_id nul
 *   }
 *   Chaque ligne a toutes les colonnes de TABLES_EXPORTEES (null si absente de l'entrée), rien
 *   d'autre. Valeurs selon le type : 'entier' et 'reel' → nombre JSON (point décimal, jamais de
 *   virgule) ; 'booleen' → true / false (0 → false, 1 → true ; toute autre
 *   valeur, 'true' ou 2 par exemple, est rendue brute : texte ou nombre tel quel, jamais
 *   convertie) ; 'json' → la valeur JSON décodée (objet, tableau…),
 *   ou le texte tel quel s'il n'est pas du JSON valide (jamais d'exception) ; 'texte', 'date',
 *   'instant' → texte tel quel. null reste null.
 *
 * CSV (un par table) — lisible directement par Excel en français :
 *   - UTF-8 AVEC BOM ('\uFEFF' en tête du texte), séparateur ';', fin de ligne '\r\n' après
 *     CHAQUE enregistrement (en-tête et dernière ligne compris) ;
 *   - première ligne : les noms de colonnes, dans l'ordre de TABLES_EXPORTEES (id en premier) ;
 *   - échappement RFC 4180 : un champ contenant ';', '"', '\n' ou '\r' est entouré de
 *     guillemets, ses guillemets doublés ; son contenu est gardé à l'identique (retours à la
 *     ligne compris). Un autre champ peut être entre guillemets ou non ;
 *   - null → champ vide ;
 *   - RÈGLE DES NOMBRES (décision testeur) : 'reel' et 'entier' avec la VIRGULE décimale,
 *     sans séparateur de milliers ni notation exponentielle pour les valeurs usuelles :
 *     12.5 → '12,5', -3.25 → '-3,25', 30 → '30', 0.1 → '0,1'. Raison : Excel en français lit
 *     « 12.5 » comme du texte (ou une date), « 12,5 » comme un nombre. Le JSON, lui, garde
 *     le point : c'est lui la référence pour une machine. Relecture fidèle :
 *     Number(champ.replace(',', '.')) === valeur d'origine ;
 *   - 'booleen' → 'oui' (1) / 'non' (0) ; toute autre valeur ('true', 2…) rendue brute
 *     ('true', '2') : une donnée inattendue se voit, elle n'est pas maquillée en « non » ; 'date' → 'AAAA-MM-JJ' (tel que stocké, Excel le reconnaît) ;
 *     'instant' → ISO tel que stocké ; 'json' → le texte JSON tel que stocké ; 'texte' → tel quel ;
 *   - FORMULES NEUTRALISÉES (T15b, décision testeur) : dans les CSV SEULEMENT, une cellule dont la
 *     valeur dans la base est un TEXTE (typeof 'string', quel que soit le type d'export de la
 *     colonne) et dont le rendu commence par '=', '+', '-', '@', tabulation ('\t') ou retour
 *     chariot ('\r') est préfixée d'une apostrophe « ' », pour qu'Excel ne l'exécute pas comme
 *     une formule : '=SOMME(A1)' → '\'=SOMME(A1)', '-3 plants' → '\'-3 plants'. L'apostrophe
 *     vient AVANT la protection RFC 4180 : '\r\nsuite' → '"\'\r\nsuite"'.
 *     Une valeur NOMBRE n'est jamais neutralisée : -3.25 → '-3,25', -7 → '-7', un booléen -1
 *     rendu brut → '-1' (un nombre négatif n'est pas une formule, et Excel doit le lire comme un
 *     nombre). Un texte qui commence par une espace n'est pas touché (' =1' reste ' =1'), ni
 *     un texte qui commence déjà par une apostrophe. ferme.json reste FIDÈLE (jamais
 *     d'apostrophe ajoutée) : c'est lui la référence exacte.
 *
 * LISEZMOI.txt (texte, en français) : une ligne « Ferme : <nom> » donne le NOM de la ferme
 * (celui de sa ligne `ferme` ; l'identifiant n'est pas sur cette ligne, sauf ferme absente ou
 * sans nom), puis explique le contenu et les conventions (ferme.json,
 * point-virgule, virgule décimale, dates AAAA-MM-JJ, oui/non, dossier bibliotheque/,
 * lignes supprimées, et (T15b) les formules neutralisées : le mot « apostrophe », le mot
 * « formule », et que ferme.json garde la valeur exacte), puis pour CHAQUE fichier CSV un bloc :
 *     ## <chemin du CSV>                       (ex. « ## zone.csv », « ## bibliotheque/famille.csv »)
 *     <une ou plusieurs lignes libres sur la table>
 *     - <colonne> : <description de la colonne>   (une ligne par colonne, toutes les colonnes)
 * Un bloc s'arrête au « ## » suivant ou à la fin du fichier. Le bloc de `utilisateur.csv` dit
 * « Votre compte (les collègues n'y sont pas encore). » : le téléphone ne connaît que le
 * compte de l'utilisateur connecté, l'export ne liste donc pas les autres membres.
 *
 *   nomArchive(nomFerme: string | null, jour: string): string
 * → 'planifications-<nom>-<jour>.zip' ; <nom> : nom de la ferme sans accents, ligatures
 *   dépliées (Œ/œ → oe, Æ/æ → ae : NFD ne les décompose pas), en minuscules,
 *   toute suite de caractères hors [a-z0-9] remplacée par un seul '-', sans '-' au début ni à
 *   la fin ; nom vide ou null → 'ferme'. <jour> : 'AAAA-MM-JJ' tel que donné.
 *   'Ferme de Benoît', '2026-09-29' → 'planifications-ferme-de-benoit-2026-09-29.zip' ;
 *   « Ferme d'Œuvre » → 'planifications-ferme-d-oeuvre-…', « Æ » → 'planifications-ae-…'.
 *
 *   creerZip(fichiers: readonly FichierZip[], options?: OptionsZip): Promise<Uint8Array>
 * (T15b : ASYNCHRONE, parce que la compression l'est dans le navigateur.) Archive ZIP valide
 * (APPNOTE PKWARE), pure : en-têtes locaux, répertoire central, fin de répertoire ; CRC-32 et
 * tailles exacts ; noms en UTF-8 avec le bit 11 des drapeaux (0x0800) ; chemins avec '/', sans
 * '/' initial, dans l'ordre donné ; aucune entrée de dossier obligatoire. Date et heure DOS de
 * chaque entrée : `options.date` ('AAAA-MM-JJ') à 00:00, 1980-01-01 par défaut. Deux chemins
 * identiques → promesse rejetée. Liste vide → archive vide valide (22 octets). Le bit 3
 * (descripteur de données après le contenu) est permis. Pas de ZIP64 (archive < 4 Gio).
 *   - Contenu d'un fichier (`FichierZip.contenu`) : un texte (encodé en UTF-8, BOM compris s'il
 *     y est), des octets (Uint8Array), ou une SUITE DE MORCEAUX (Iterable ou AsyncIterable de
 *     textes et d'octets, mêlés) concaténés dans l'ordre ; chaque morceau texte est encodé seul
 *     (le producteur coupe entre deux caractères, jamais au milieu d'une paire de substitution).
 *     Un texte se reconnaît par `typeof === 'string'`, des octets par `instanceof Uint8Array` ;
 *     tout le reste est une suite de morceaux, lue une seule fois, au moment d'écrire l'entrée.
 *   - Compression (décision testeur) : le cœur n'a ni Node ni DOM, il n'écrit pas deflate à la
 *     main ; la compression est INJECTÉE par `options.compresseur` (type `Compresseur`) :
 *     deflate brut (RFC 1951, sans en-tête zlib ni gzip), en flux : il reçoit les octets bruts
 *     d'UNE entrée morceau par morceau et rend les octets compressés morceau par morceau.
 *     Navigateur : `new CompressionStream('deflate-raw')` ; tests Node : `zlib.createDeflateRaw()`
 *     (packages/sync/src/test/zip.ts, `compresseurNode`). Un appel du compresseur par entrée.
 *     Avec un compresseur : TOUTES les entrées en méthode 8 (deflate). Sans : toutes en
 *     méthode 0 (stockées), comme en T15. Même entrée et même compresseur → mêmes octets.
 * Vérifiée en la relisant avec des implémentations indépendantes (node:zlib, `unzip -t`,
 * Python `zipfile`) : packages/sync/src/export.test.ts (le cœur est compilé sans types Node).
 *
 * ── Archive légère (T15b) ───────────────────────────────────────────────────────────────────
 *
 *   construireArchive(entree: EntreeExport, options: OptionsArchive): Promise<ArchiveConstruite>
 *
 * L'archive complète, telle que le téléphone l'enregistre : `octets` est un ZIP dont chaque
 * entrée, décompressée, a EXACTEMENT les octets UTF-8 du fichier de même chemin rendu par
 * `construireExport(entree)`, dans le même ordre (BOM EF BB BF en tête des CSV compris) ;
 * `lignes` est celui de `preparerExport` (chemin de CSV sans « .csv » → lignes de données).
 * `options.date` : date des entrées ; `options.compresseur` : voir `creerZip`.
 *
 * Mémoire (règle du ticket : au pic, pas plus de deux fois la taille de l'archive finale ;
 * T15 : ≈ 210 Mo au-dessus des lignes lues pour une archive de 37 Mo) : l'entrée (les lignes
 * de la base) est déjà en mémoire, elle n'est pas comptée ; ce que `construireArchive` AJOUTE,
 * mesuré en mémoire vivante (tas V8 + mémoire externe, après ramasse-miettes) à chaque appel
 * d'`avancement` et à la fin, archive tenue, reste sous 2 × taille de l'archive + 8 Mio de
 * marge (tampons de travail et bruit de mesure). Pour y tenir : BOM écrit en octets, chaque
 * fichier encodé et compressé morceau par morceau dès qu'il est produit (jamais un CSV ni
 * ferme.json entier en texte), ferme.json écrit table par table sans arbre d'objets.
 * Mesuré dans un processus isolé (`node --expose-gc`) : packages/sync/src/export-leger.test.ts.
 *
 * Écran jamais gelé (règle du ticket : aucune tâche de plus de 100 ms sur le fil principal,
 * CPU ralenti ×4) : `construireArchive` REND LA MAIN à la boucle d'événements (tâche : minuterie,
 * MessageChannel…, pas une simple micro-tâche) assez souvent pour qu'aucun calcul synchrone ne
 * dure plus de 25 ms sous Node (≈ 100 ms / 4) sur la ferme de T07, sans option particulière.
 * Le moyen est libre (le cœur n'a pas les types des minuteries : déclaration locale permise).
 * Web Worker non exigé (décision testeur) : la porte (base locale) vit sur le fil principal,
 * et envoyer 40 000 lignes à un Worker coûterait une copie de plus, elle-même longue.
 *
 * Mesure (relecture T15b, décision testeur) : la « tâche » est le TEMPS CPU du fil principal
 * entre deux tours d'une minuterie de 1 ms (`process.threadCpuUsage`, à défaut
 * `process.cpuUsage`), borné par le temps mural du même intervalle : min(mural, CPU). Une
 * préemption du processus par le système (machine chargée, autres tests en parallèle) allonge
 * le temps mural mais pas le temps CPU : elle ne compte plus. Un vrai calcul trop long, lui,
 * consomme du CPU et se voit à CHAQUE export : les trois exports mesurés restent tous sous 25 ms.
 *
 * Avancement : `options.avancement({ fait, total })` est appelé pendant la construction :
 * entiers, 0 ≤ fait ≤ total, `total` constant pendant un export et > 0, `fait` jamais en recul,
 * dernier appel avec fait === total, au moins un appel par fichier de l'archive et assez
 * souvent pour une barre qui avance (au moins 20 appels pour la ferme de T07). L'unité est
 * libre (lignes, octets…). Un `avancement` qui lève fait échouer l'export.
 *
 * ── Relecture T15b : annulation, source lue en entier, longue chaîne ────────────────────────
 *
 * Annulation (`options.signal`, dans `OptionsZip` ET `OptionsArchive`) : le maraîcher peut
 * arrêter un export qui dure. Type `SignalAnnulation` ci-dessous (le cœur n'a pas les types du
 * DOM ; un `AbortSignal` du navigateur ou de Node s'y range tel quel).
 *   - Signal déjà annulé à l'appel, ou annulé pendant : la promesse est REJETÉE, au plus tard
 *     200 ms après l'annulation, MÊME SI le compresseur ne rend plus jamais la main (flux
 *     CompressionStream bloqué, par exemple) et même si une source attend. Jamais d'archive
 *     rendue après une annulation.
 *   - Erreur de rejet : `signal.reason` (celle d'`AbortController.abort()` sans argument est
 *     une DOMException de nom 'AbortError') ; si `reason` est absente, une Error de nom
 *     'AbortError'. Les tests vérifient `erreur.name === 'AbortError'`.
 *   - Après l'annulation, plus aucun calcul de l'export : le cœur arrête de produire et de lire
 *     les sources (ce qui est déjà parti au compresseur peut finir ou non, c'est égal).
 *
 * Source lue en entier (`creerZip`) : si le compresseur s'arrête (fin de son flux de sortie)
 * sans avoir lu toute la source de l'entrée, l'archive n'est PAS écrite : promesse rejetée par
 * une Error dont le message contient « source non lue en entier » (et le chemin de l'entrée).
 * Sinon le CRC et la taille ne couvriraient qu'un début de fichier : archive valide mais
 * tronquée, sans que personne le voie.
 *
 * Longue chaîne en un morceau (`creerZip`) : un contenu texte d'un seul tenant (40 Mio de
 * caractères, par exemple) est découpé en interne en tranches d'environ 16 000 caractères,
 * chacune encodée puis passée au compresseur avant la suivante : jamais tous ses octets UTF-8
 * encodés d'un coup. Une coupure ne tombe jamais au milieu d'une paire de substitution (un
 * emoji reste un emoji, jamais deux U+FFFD). Mémoire vivante ajoutée au pic : au plus celle du
 * même texte donné en morceaux + 8 Mio. Mesuré dans un processus isolé :
 * packages/sync/src/export-leger.test.ts.
 */
export type TypeExport = 'texte' | 'entier' | 'reel' | 'booleen' | 'date' | 'instant' | 'json';

export interface DescriptionColonne {
  readonly type: TypeExport;
  /** En français, pour LISEZMOI.txt. */
  readonly description: string;
}

export interface DescriptionTable {
  /** En français, pour LISEZMOI.txt. */
  readonly description: string;
  /** Table de la bibliothèque : les lignes à `ferme_id` nul vont dans `bibliotheque/`. */
  readonly bibliotheque: boolean;
  /** Colonnes exportées, dans l'ordre des CSV ; `id` en premier. */
  readonly colonnes: Readonly<Record<string, DescriptionColonne>>;
}

export type ValeurLocale = string | number | null;
export type LigneLocale = Readonly<Record<string, ValeurLocale>>;

export interface EntreeExport {
  readonly fermeId: string;
  /** Instant ISO de l'export, recopié dans ferme.json (`genere_le`). */
  readonly genereLe: string;
  readonly tables: Readonly<Record<string, readonly LigneLocale[] | undefined>>;
}

export interface FichierExport {
  /** Chemin dans l'archive : 'ferme.json', 'LISEZMOI.txt', 'zone.csv', 'bibliotheque/famille.csv'… */
  readonly chemin: string;
  /** Texte du fichier (BOM compris pour les CSV) ; un `FichierExport` est un `FichierZip`. */
  readonly contenu: string;
}

export type MorceauZip = string | Uint8Array;

export interface FichierZip {
  readonly chemin: string;
  readonly contenu: MorceauZip | Iterable<MorceauZip> | AsyncIterable<MorceauZip>;
}

/** Deflate brut (RFC 1951) en flux : octets bruts d'une entrée → octets compressés. */
export type Compresseur = (brut: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;

/**
 * Signal d'annulation (relecture T15b) : le strict nécessaire d'un `AbortSignal`, que le cœur
 * (sans types du DOM ni de Node) décrit lui-même. Un `AbortSignal` s'y range tel quel.
 */
export interface SignalAnnulation {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', ecouteur: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', ecouteur: () => void): void;
}

export interface OptionsZip {
  /** 'AAAA-MM-JJ' : date DOS de chaque entrée, à 00:00 ; 1980-01-01 par défaut. */
  readonly date?: string;
  /** Absent : entrées stockées (méthode 0). Présent : toutes en deflate (méthode 8). */
  readonly compresseur?: Compresseur;
  /** Relecture T15b : annulation ; promesse rejetée (AbortError) dans les 200 ms. */
  readonly signal?: SignalAnnulation;
}

export interface Avancement {
  readonly fait: number;
  readonly total: number;
}

export interface OptionsArchive {
  readonly date: string;
  readonly compresseur?: Compresseur;
  readonly avancement?: (a: Avancement) => void;
  /** Relecture T15b : annulation ; promesse rejetée (AbortError) dans les 200 ms. */
  readonly signal?: SignalAnnulation;
}

export interface ArchiveConstruite {
  readonly octets: Uint8Array;
  /** Nombre de lignes de données de chaque CSV, par chemin sans « .csv ». */
  readonly lignes: Readonly<Record<string, number>>;
}

export interface ModuleExport {
  readonly TABLES_EXPORTEES: Readonly<Record<string, DescriptionTable>>;
  construireExport(entree: EntreeExport): FichierExport[];
  construireArchive(entree: EntreeExport, options: OptionsArchive): Promise<ArchiveConstruite>;
  nomArchive(nomFerme: string | null, jour: string): string;
  creerZip(fichiers: readonly FichierZip[], options?: OptionsZip): Promise<Uint8Array>;
}

/** Caractères qui font d'une cellule texte une formule pour Excel (T15b). */
export const DEBUT_FORMULE = /^[=+\-@\t\r]/;

/** Tables exportées attendues : celles du schéma local, sans `refus_synchro`. */
export const TABLES_ATTENDUES = [
  'article_stock',
  'assolement',
  'campagne',
  'emplacement',
  'espece',
  'evenement',
  'famille',
  'ferme',
  'itineraire',
  'membre',
  'modification',
  'mouvement_stock',
  'occupation',
  'plantation',
  'produit_phyto',
  'proposition',
  'saison',
  'secteur_emplacement',
  'secteur_irrigation',
  'serie',
  'utilisateur',
  'variete',
  'zone',
] as const;

export const TABLES_BIBLIOTHEQUE = ['famille', 'espece', 'variete', 'itineraire', 'produit_phyto'] as const;

/** Chemins tenus dans des variables : TypeScript ne résout pas les modules avant qu'ils existent. */
const CHEMIN_MODULE = '../index.ts';
const CHEMIN_COEUR = '../../index.ts';

export async function chargerExport(): Promise<ModuleExport> {
  return (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleExport;
}

/** `@planif/core` tel que @planif/sync et l'appli l'importent. */
export async function chargerCoeur(): Promise<Partial<ModuleExport>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleExport>;
}
