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
 *
 * ── Lecture d'un CSV ────────────────────────────────────────────────────────────────────────
 *
 *   decoderTexte(octets: Uint8Array): TexteDecode
 * UTF-8 si les octets sont de l'UTF-8 valide (BOM EF BB BF retiré du texte, `bom: true`) ;
 * sinon Windows-1252 (exports Excel) : 0xE9 → 'é', 0x80 → '€', 0x92 → '’', 0x9C → 'œ',
 * 0x8C → 'Œ' ; les cinq octets non définis (0x81, 0x8D, 0x8F, 0x90, 0x9D) → U+0081… comme le
 * WHATWG. ASCII pur → 'utf-8'. Vide → texte '' en 'utf-8'.
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
 * Cellules d'un CSV : toujours des chaînes (vide = '').
 *
 * ── Détection ───────────────────────────────────────────────────────────────────────────────
 *
 *   detecterEntete(lignes: readonly LigneBrute[]): number | null
 * Indice (0 = première ligne) de la ligne d'en-tête : parmi les 20 premières lignes, celle qui a
 * le plus de cellules reconnues par le dictionnaire des synonymes (tous types confondus), la
 * première à égalité ; si aucune cellule n'est reconnue, la première ligne qui a au moins deux
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
 * la comparaison (« Durée pépinière (j) » = « durée pépinière ») ; c'est une UNITÉ s'il vaut m,
 * cm, kg ou g (casse ignorée : « [M] »). Unité aussi reconnue après « en » (« Longueur en cm »)
 * et en suffixe de l'export T15 (« longueur_m », « poids_mille_graines_g »). Une unité qui n'est
 * pas de la grandeur du champ (« Longueur (kg) »), ou un champ qui n'est pas une mesure :
 * unite null. Pas d'unité → null (celle du champ s'appliquera).
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
 *   date_semis                 semis, date de semis, date semis, prevu_semis_pepiniere
 *   date_plantation            plantation, date de plantation, date plantation, prevu_mise_en_place
 *   date_debut_recolte         début récolte, début de récolte, récolte, prevu_debut_recolte
 *   date_fin_recolte           fin récolte, fin de récolte, prevu_fin_recolte
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
 *             Autre valeur → 'valeur_inconnue'
 *   mesure    longueur_m, largeur_m (en m) ; ecartement_cm (en cm) ; poids_mille_graines_g (en g)
 *             → `lireMesure` avec l'unité de l'en-tête par défaut ; ≤ 0 → 'hors_bornes'
 *   nombre    surface_m2 → `lireNombre` ; ≤ 0 → 'hors_bornes'
 *   entier    nombre_places, nombre_plants, rangs_par_planche (≥ 1), durées en jours (≥ 0),
 *             annee (2000 à 2100) → nombre à virgule → 'nombre_invalide', hors bornes → 'hors_bornes'
 *   date      date_* → `lireDate` avec `anneeSaison`
 *   référence espece → bibliotheque.especes, famille → bibliotheque.familles (`ReferenceImport`)
 * Cellule vide → null (champ facultatif) ; cellule absente (ligne plus courte que l'en-tête, fréquent
 * dans un classeur) = vide ; nombre dans un champ texte → son écriture ('3', '12.5'). Un champ
 * non associé est ABSENT de `valeurs`. Les valeurs d'une ligne en erreur ne sont pas garanties.
 *
 * ── Normalisation ───────────────────────────────────────────────────────────────────────────
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
 *   lireDate(c: Cellule, anneeSaison: number | null): Lecture<DateCalendaire | null>
 *   - 'JJ/MM/AAAA' (jour et mois sur 1 ou 2 chiffres) → 'AAAA-MM-JJ' ;
 *   - 'AAAA-MM-JJ' ;
 *   - nombre = date Excel (système 1900) : 1 → 1900-01-01, 59 → 1900-02-28, 60 → le 29/02/1900
 *     qui n'existe pas (bogue de Lotus repris par Excel) → 'date_invalide', 61 → 1900-03-01,
 *     46461 → 2027-03-15 ; partie décimale (heure) ignorée ; < 1 → 'date_invalide' ;
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
 * Lignes lues après `ligneEntete`. Ignorées (`ignorees`, avec le motif) : ligne vide (toutes ses
 * cellules vides ou espaces) → 'vide' ; ligne de total (une cellule texte qui commence par le mot
 * « total », « sous-total » ou « somme », casse et accents ignorés) → 'total'.
 * Les autres donnent chacune une `LignePlan`, dans l'ordre, avec `ligne` = son numéro dans le
 * fichier comme on le voit dans le tableur (première ligne = 1 : en-tête en 1 → données dès 2).
 * Hiérarchie du parcellaire (zone, sous_zone) : une cellule vide reprend la valeur de la ligne
 * au-dessus (cellules fusionnées) ; une nouvelle zone efface la sous-zone reprise.
 * `niveaux` (parcellaire seulement, sinon null) : nombre de niveaux associés parmi zone,
 * sous_zone, emplacement (1, 2 ou 3).
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
 * Correspondance dont un champ obligatoire n'est associé à aucune colonne : chaque ligne est en
 * erreur 'champ_manquant' (colonne null).
 *
 * ── Modèle d'import ─────────────────────────────────────────────────────────────────────────
 *
 *   creerModele(entetes: readonly Cellule[], correspondance: Correspondance, choix: readonly ChoixValeur[]): ModeleImport
 *   serialiserModele(modele: ModeleImport): string          // JSON
 *   lireModele(texte: string): ModeleImport | null          // null si illisible, version ou champ inconnus
 *   appliquerModele(modele: ModeleImport, entetes: readonly Cellule[]): Correspondance | null
 * Le modèle retient, par en-tête, le champ et l'unité validés, plus les choix de valeurs. Il
 * s'applique à un fichier de MÊME FORME : mêmes en-têtes normalisés, dans n'importe quel ordre ;
 * sinon null. lireModele(serialiserModele(m)) est égal à m.
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

export interface Feuille {
  readonly nom: string;
  readonly lignes: readonly LigneBrute[];
}

export type ResultatClasseur =
  | { readonly ok: true; readonly feuilles: readonly Feuille[] }
  | { readonly ok: false; readonly code: 'classeur_illisible'; readonly message: string };

export interface LecteurClasseur {
  lire(octets: Uint8Array): Promise<ResultatClasseur>;
}

export type Encodage = 'utf-8' | 'windows-1252';
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

export interface DefinitionChamp {
  readonly cle: CleChamp;
  /** En français, pour l'écran de correspondance. */
  readonly libelle: string;
  readonly obligatoire: boolean;
}

export interface ColonneAssociee {
  readonly champ: CleChamp | null;
  readonly unite: UniteMesure | null;
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
  | 'hors_bornes';

export type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly code: CodeErreurImport };

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
  /** Année de la saison, pour les dates en semaines. */
  readonly anneeSaison: number | null;
  readonly choix?: readonly ChoixValeur[];
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
  readonly ignorees: readonly { readonly ligne: number; readonly motif: 'vide' | 'total' }[];
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
  readonly colonnes: readonly { readonly entete: string; readonly champ: CleChamp | null; readonly unite: UniteMesure | null }[];
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
  lireDate(c: Cellule, anneeSaison: number | null): Lecture<DateCalendaire | null>;
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
