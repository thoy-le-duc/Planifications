/**
 * Contrat de `packages/core/src/export` (T15, docs/backlog/T15-export.md) : l'API que les tests
 * attendent de `src/export/index.ts`, réexportée par `@planif/core` (src/index.ts).
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
 * `creerZip` prend tels quels : `creerZip(construireExport(entree), { date })`.
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
 *   virgule) ; 'booleen' → true / false ; 'json' → la valeur JSON décodée (objet, tableau…),
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
 *   - 'booleen' → 'oui' / 'non' ; 'date' → 'AAAA-MM-JJ' (tel que stocké, Excel le reconnaît) ;
 *     'instant' → ISO tel que stocké ; 'json' → le texte JSON tel que stocké ; 'texte' → tel quel.
 *
 * LISEZMOI.txt (texte, en français) : explique le contenu et les conventions (ferme.json,
 * point-virgule, virgule décimale, dates AAAA-MM-JJ, oui/non, dossier bibliotheque/,
 * lignes supprimées), puis pour CHAQUE fichier CSV un bloc :
 *     ## <chemin du CSV>                       (ex. « ## zone.csv », « ## bibliotheque/famille.csv »)
 *     <une ou plusieurs lignes libres sur la table>
 *     - <colonne> : <description de la colonne>   (une ligne par colonne, toutes les colonnes)
 * Un bloc s'arrête au « ## » suivant ou à la fin du fichier.
 *
 *   nomArchive(nomFerme: string | null, jour: string): string
 * → 'planifications-<nom>-<jour>.zip' ; <nom> : nom de la ferme sans accents, en minuscules,
 *   toute suite de caractères hors [a-z0-9] remplacée par un seul '-', sans '-' au début ni à
 *   la fin ; nom vide ou null → 'ferme'. <jour> : 'AAAA-MM-JJ' tel que donné.
 *   'Ferme de Benoît', '2026-09-29' → 'planifications-ferme-de-benoit-2026-09-29.zip'.
 *
 *   creerZip(fichiers: readonly FichierZip[], options?: { date?: string }): Uint8Array
 * Archive ZIP valide (APPNOTE PKWARE), synchrone et pure : en-têtes locaux, répertoire central,
 * fin de répertoire ; méthode 0 (stockée) ou 8 (deflate), au choix du développeur ; CRC-32 et
 * tailles exacts ; noms en UTF-8 avec le bit 11 des drapeaux (0x0800) ; chemins avec '/',
 * sans '/' initial, dans l'ordre donné ; aucune entrée de dossier obligatoire. Un contenu
 * texte est encodé en UTF-8 (BOM compris s'il est dans le texte). Date et heure DOS de chaque
 * entrée : `options.date` ('AAAA-MM-JJ') à 00:00, 1980-01-01 par défaut : même entrée → mêmes
 * octets. Deux chemins identiques → exception. Liste vide → archive vide valide (22 octets).
 * Vérifiée en la relisant avec une implémentation indépendante (node:zlib, et `unzip -t`) :
 * packages/sync/src/export.test.ts (le cœur est compilé sans types Node).
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

export interface FichierZip {
  readonly chemin: string;
  readonly contenu: string | Uint8Array;
}

export interface ModuleExport {
  readonly TABLES_EXPORTEES: Readonly<Record<string, DescriptionTable>>;
  construireExport(entree: EntreeExport): FichierExport[];
  nomArchive(nomFerme: string | null, jour: string): string;
  creerZip(fichiers: readonly FichierZip[], options?: { readonly date?: string }): Uint8Array;
}

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
