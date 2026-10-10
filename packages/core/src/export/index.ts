/**
 * Export complet de la ferme (T15, principe 5, puis T15b) : fichiers de l'archive (ferme.json,
 * CSV, LISEZMOI.txt), nom de l'archive, ZIP. Tout est pur : ni base, ni réseau. La lecture de la
 * base locale est dans `exporterFerme` (@planif/sync).
 *
 * Chaque fichier est PRODUIT par morceaux (générateurs plus bas) : `construireExport` les met bout
 * à bout en texte (la référence du contenu) ; `creerConstructeurArchive` (T15c) les passe au ZIP
 * table par table, au fil de la lecture de la base, qui les encode et les compresse aussitôt :
 * jamais un fichier entier en mémoire. `construireArchive` donne au constructeur une entrée déjà
 * en mémoire. Mêmes générateurs, donc mêmes octets.
 *
 * Contrat détaillé : ./test/contrat.ts.
 */
import { TABLES_EXPORTEES, type DescriptionTable, type TypeExport } from './tables.ts';
import { annulable, dateDos, EN_VOL, lancerEntree, partiesZip, verifierAnnulation, type Compressee, type Compresseur, type EntreeLancee, type MorceauZip, type SignalAnnulation } from './zip.ts';

export { TABLES_EXPORTEES, type DescriptionColonne, type DescriptionTable, type TypeExport } from './tables.ts';
export { annulable, creerZip, type Compresseur, type FichierZip, type MorceauZip, type OptionsZip, type SignalAnnulation } from './zip.ts';

export type ValeurLocale = string | number | null;
export type LigneLocale = Readonly<Record<string, ValeurLocale>>;

export interface EntreeExport {
  readonly fermeId: string;
  /** Instant ISO de l'export, recopié dans ferme.json (`genere_le`). */
  readonly genereLe: string;
  /** Lignes de chaque table, telles que la base locale les rend ; tables absentes = vides. */
  readonly tables: Readonly<Record<string, readonly LigneLocale[] | undefined>>;
}

export interface FichierExport {
  /** Chemin dans l'archive : 'ferme.json', 'LISEZMOI.txt', 'zone.csv', 'bibliotheque/famille.csv'… */
  readonly chemin: string;
  /** Texte du fichier (BOM compris pour les CSV). */
  readonly contenu: string;
}

export interface ExportPrepare {
  readonly fichiers: FichierExport[];
  /** Nombre de lignes de données de chaque CSV, par chemin sans « .csv » ('zone', 'bibliotheque/famille'). */
  readonly lignes: Readonly<Record<string, number>>;
}

/** Avancement de `construireArchive` : `fait` sur `total` (unité : lignes écrites, plus un par fichier). */
export interface Avancement {
  readonly fait: number;
  readonly total: number;
}

export interface OptionsArchive {
  /** 'AAAA-MM-JJ' : date des entrées du ZIP. */
  readonly date: string;
  /** Deflate brut injecté ; absent : archive stockée. */
  readonly compresseur?: Compresseur;
  /** Barre d'avancement ; une exception ici fait échouer l'export. */
  readonly avancement?: (a: Avancement) => void;
  /** Annulation : promesse rejetée (`signal.reason`, AbortError) dès l'annulation. */
  readonly signal?: SignalAnnulation;
}

export interface ArchiveConstruite {
  readonly octets: Uint8Array;
  /** Nombre de lignes de données de chaque CSV, par chemin sans « .csv ». */
  readonly lignes: Readonly<Record<string, number>>;
}

const BOM = '﻿';
const FIN = '\r\n';
const A_PROTEGER = /[;"\r\n]/;
/** Cellule texte qu'Excel prendrait pour une formule (T15b) : apostrophe devant, dans les CSV. */
const DEBUT_FORMULE = /^[=+\-@\t\r]/;
/** Longueur de texte à partir de laquelle un morceau de fichier est rendu. */
const MORCEAU = 32_768;

// ── Valeurs ──────────────────────────────────────────────────────────────────────────────────

/**
 * Champ CSV : virgule décimale, oui/non (0/1 seulement, toute autre valeur rendue brute), texte
 * qui ressemble à une formule neutralisé par une apostrophe, puis protection RFC 4180 si besoin.
 */
function champCsv(type: TypeExport, v: ValeurLocale | undefined): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (type === 'booleen' && (v === 0 || v === 1)) s = v === 1 ? 'oui' : 'non';
  else if (typeof v === 'number') {
    s = String(v);
    if (type === 'entier' || type === 'reel') s = s.replace('.', ',');
  } else s = DEBUT_FORMULE.test(v) ? `'${v}` : v;
  return A_PROTEGER.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Valeur de ferme.json : nombres tels quels (point décimal), booléens, JSON décodé. */
function valeurJson(type: TypeExport, v: ValeurLocale | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'booleen' && (v === 0 || v === 1)) return v === 1;
  if (type === 'json' && typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}

// ── Filtrage par ferme ───────────────────────────────────────────────────────────────────────

interface TableRepartie {
  readonly nom: string;
  readonly d: DescriptionTable;
  readonly ferme: readonly LigneLocale[];
  readonly bibliotheque: readonly LigneLocale[];
}

/** Lignes parcourues entre deux points où l'appelant peut rendre la main. */
const PAQUET_LIGNES = 1024;

/**
 * Lignes de la ferme et de la bibliothèque d'une table. Générateur : il s'arrête (`yield`) toutes
 * les `PAQUET_LIGNES` lignes, pour que `construireArchive` puisse rendre la main ; `construireExport`
 * le déroule d'une traite.
 */
function* repartir(nom: string, d: DescriptionTable, lignes: readonly LigneLocale[], fermeId: string, membres: ReadonlySet<unknown>): Generator<void, TableRepartie, undefined> {
  const ferme: LigneLocale[] = [];
  const bibliotheque: LigneLocale[] = [];
  for (let i = 0; i < lignes.length; i++) {
    if (i % PAQUET_LIGNES === PAQUET_LIGNES - 1) yield;
    const l = lignes[i];
    if (l === undefined) continue;
    if (nom === 'ferme') {
      if (l.id === fermeId) ferme.push(l);
    } else if (nom === 'utilisateur') {
      if (membres.has(l.id)) ferme.push(l);
    } else if (l.ferme_id === fermeId) ferme.push(l);
    else if (d.bibliotheque && l.ferme_id === null) bibliotheque.push(l);
  }
  return { nom, d, ferme, bibliotheque };
}

/** Compteur de lignes écrites, que les générateurs tiennent à jour (barre d'avancement). */
interface Compteur {
  lignes: number;
}

/** Un fichier de l'archive, à produire par morceaux. */
interface FichierPrevu {
  readonly chemin: string;
  /** CSV : BOM en tête (texte pour `construireExport`, octets pour `construireArchive`). */
  readonly bom: boolean;
  /** Nombre de lignes que `produire` comptera. */
  readonly lignes: number;
  readonly produire: (c: Compteur) => Generator<string, void, undefined>;
}

interface Plan {
  readonly fichiers: readonly FichierPrevu[];
  readonly lignes: Readonly<Record<string, number>>;
}

// ── Producteurs ──────────────────────────────────────────────────────────────────────────────

/** CSV d'une table, sans le BOM, en morceaux d'environ `MORCEAU` caractères. */
function* csv(d: DescriptionTable, lignes: readonly LigneLocale[], c: Compteur): Generator<string, void, undefined> {
  const colonnes = Object.entries(d.colonnes);
  const noms = colonnes.map(([n]) => n);
  const types = colonnes.map(([, x]) => x.type);
  const champs: string[] = new Array<string>(noms.length);
  let morceau = noms.join(';') + FIN;
  for (const l of lignes) {
    for (let k = 0; k < noms.length; k++) champs[k] = champCsv(types[k] ?? 'texte', l[noms[k] ?? '']);
    morceau += champs.join(';') + FIN;
    c.lignes++;
    if (morceau.length >= MORCEAU) {
      yield morceau;
      morceau = '';
    }
  }
  if (morceau !== '') yield morceau;
}

/** Une ligne de ferme.json, telle que JSON.stringify l'écrirait dans l'arbre entier. */
function ligneJson(noms: readonly string[], types: readonly TypeExport[], l: LigneLocale): string {
  const objet: Record<string, unknown> = {};
  for (let k = 0; k < noms.length; k++) {
    const nom = noms[k] ?? '';
    objet[nom] = valeurJson(types[k] ?? 'texte', l[nom]);
  }
  return JSON.stringify(objet);
}

/**
 * ferme.json écrit table par table et ligne par ligne, sans arbre d'objets : exactement le texte
 * de `JSON.stringify({ format, version, ferme_id, genere_le, tables, bibliotheque })`. Les tables
 * peuvent arriver une à une (construction au fil de la lecture, T15c) : l'écrivain garde le
 * morceau en cours d'une table à l'autre.
 */
class EcrivainJson {
  private morceau: string;

  constructor(fermeId: string, genereLe: string) {
    this.morceau = `{"format":"planifications-export","version":1,"ferme_id":${JSON.stringify(fermeId)},"genere_le":${JSON.stringify(genereLe)},"tables":{`;
  }

  /** Une table, `rang` : sa place dans sa section (« tables » ou « bibliotheque »). */
  *table(rang: number, nom: string, d: DescriptionTable, lignes: readonly LigneLocale[], c: Compteur): Generator<string, void, undefined> {
    const colonnes = Object.entries(d.colonnes);
    const noms = colonnes.map(([x]) => x);
    const types = colonnes.map(([, x]) => x.type);
    this.morceau += `${rang === 0 ? '' : ','}${JSON.stringify(nom)}:[`;
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      if (l === undefined) continue;
      this.morceau += (i === 0 ? '' : ',') + ligneJson(noms, types, l);
      c.lignes++;
      if (this.morceau.length >= MORCEAU) {
        yield this.morceau;
        this.morceau = '';
      }
    }
    this.morceau += ']';
  }

  /** Fin de la section « tables », début de « bibliotheque ». */
  bibliotheque(): void {
    this.morceau += '},"bibliotheque":{';
  }

  *fin(): Generator<string, void, undefined> {
    this.morceau += '}}';
    yield this.morceau;
    this.morceau = '';
  }
}

function* fermeJson(entree: EntreeExport, tables: readonly TableRepartie[], c: Compteur): Generator<string, void, undefined> {
  const e = new EcrivainJson(entree.fermeId, entree.genereLe);
  for (let n = 0; n < tables.length; n++) {
    const t = tables[n];
    if (t !== undefined) yield* e.table(n, t.nom, t.d, t.ferme, c);
  }
  e.bibliotheque();
  const biblio = tables.filter((t) => t.d.bibliotheque);
  for (let n = 0; n < biblio.length; n++) {
    const t = biblio[n];
    if (t !== undefined) yield* e.table(n, t.nom, t.d, t.bibliotheque, c);
  }
  yield* e.fin();
}

/** `nomFerme` : nom de la ligne `ferme` ; l'identifiant sert seulement si la ferme est absente ou sans nom. */
function lisezmoi(nomFerme: string, genereLe: string): string {
  const l: string[] = [
    'Export complet de votre ferme — Planifications',
    '',
    `Ferme : ${nomFerme}`,
    `Généré le : ${genereLe} (UTC)`,
    '',
    'Cette archive contient toutes les données de votre ferme, telles qu’elles sont sur le téléphone.',
    'Elles vous appartiennent : vous pouvez les ouvrir, les copier et les garder sans condition.',
    '',
    'Contenu :',
    '- ferme.json : toutes les données en un seul fichier JSON (UTF-8), pour un autre logiciel.',
    '  Les nombres y ont un point décimal, les oui/non y sont true/false, les colonnes JSON y sont décodées.',
    '- un fichier CSV par table (zone.csv, serie.csv, evenement.csv…), à ouvrir dans Excel ou LibreOffice.',
    '- dossier bibliotheque/ : la bibliothèque de référence commune (familles, espèces, variétés,',
    '  itinéraires, produits phyto) utilisée par votre ferme. Ce n’est pas une saisie de la ferme ;',
    '  les fiches créées ou adaptées par la ferme sont, elles, dans les CSV principaux.',
    '',
    'Conventions des CSV :',
    '- encodage UTF-8 avec BOM, séparateur point-virgule (;), une ligne d’en-tête avec le nom des colonnes ;',
    '- nombres avec la virgule décimale (12,5), sans séparateur de milliers ;',
    '- dates au format AAAA-MM-JJ ; dates et heures au format ISO 8601 en UTC (2026-09-29T06:30:00.000Z) ;',
    '- oui / non pour les cases à cocher ; champ vide quand la valeur est absente ;',
    '- un texte contenant un point-virgule, un guillemet ou un retour à la ligne est entre guillemets,',
    '  ses guillemets doublés ;',
    '- les colonnes JSON (détails, paramètres) sont gardées en texte JSON.',
    '',
    'Formules : un texte qui commence par =, +, -, @, une tabulation ou un retour à la ligne',
    "(par exemple une note « =SOMME(A1) » ou « -3 plants ») est précédé d’une apostrophe (') dans",
    'les CSV, pour qu’Excel ne l’exécute pas comme une formule. Les nombres négatifs ne sont pas',
    'touchés. ferme.json garde la valeur exacte, sans apostrophe.',
    '',
    'Lignes supprimées : une ligne supprimée dans l’appli reste dans l’export, avec sa date de',
    'suppression dans la colonne supprime_le. Pour ne garder que les lignes actives, filtrez les',
    'lignes dont supprime_le est vide.',
    '',
    'Les identifiants (colonne id et colonnes en _id) relient les tables entre elles.',
    '',
    'Description de chaque fichier CSV et de chaque colonne :',
  ];
  const bloc = (chemin: string, d: DescriptionTable, remarque: string | null) => {
    l.push('', `## ${chemin}`, d.description);
    if (remarque !== null) l.push(remarque);
    for (const [col, c] of Object.entries(d.colonnes)) l.push(`- ${col} : ${c.description}`);
  };
  const biblio: [string, DescriptionTable][] = [];
  for (const [nom, d] of Object.entries(TABLES_EXPORTEES)) {
    const remarque = d.bibliotheque
      ? 'Fiches propres à la ferme ; la référence commune est dans bibliotheque/.'
      : nom === 'utilisateur'
        ? 'Votre compte (les collègues n’y sont pas encore).'
        : null;
    bloc(`${nom}.csv`, d, remarque);
    if (d.bibliotheque) biblio.push([nom, d]);
  }
  for (const [nom, d] of biblio) bloc(`bibliotheque/${nom}.csv`, d, 'Bibliothèque de référence commune (ferme_id vide).');
  return l.join(FIN) + FIN;
}

/** Filtre l'entrée et prévoit les fichiers de l'archive, dans l'ordre : rien n'est encore écrit. */
function* planifier(entree: EntreeExport): Generator<void, Plan, undefined> {
  const { fermeId, genereLe } = entree;
  const membres = new Set<unknown>();
  for (const m of entree.tables.membre ?? []) if (m.ferme_id === fermeId) membres.add(m.utilisateur_id);

  const tables: TableRepartie[] = [];
  for (const [nom, d] of Object.entries(TABLES_EXPORTEES)) tables.push(yield* repartir(nom, d, entree.tables[nom] ?? [], fermeId, membres));
  const lignes: Record<string, number> = {};
  const csvFerme: FichierPrevu[] = [];
  const csvBiblio: FichierPrevu[] = [];
  let toutes = 0;
  for (const t of tables) {
    lignes[t.nom] = t.ferme.length;
    csvFerme.push({ chemin: `${t.nom}.csv`, bom: true, lignes: t.ferme.length, produire: (c) => csv(t.d, t.ferme, c) });
    toutes += t.ferme.length;
    if (t.d.bibliotheque) {
      lignes[`bibliotheque/${t.nom}`] = t.bibliotheque.length;
      csvBiblio.push({ chemin: `bibliotheque/${t.nom}.csv`, bom: true, lignes: t.bibliotheque.length, produire: (c) => csv(t.d, t.bibliotheque, c) });
      toutes += t.bibliotheque.length;
    }
  }

  const nomFerme = entree.tables.ferme?.find((l) => l.id === fermeId)?.nom;
  const titre = typeof nomFerme === 'string' && nomFerme.trim() !== '' ? nomFerme : fermeId;
  const fichiers: FichierPrevu[] = [
    { chemin: 'ferme.json', bom: false, lignes: toutes, produire: (c) => fermeJson(entree, tables, c) },
    {
      chemin: 'LISEZMOI.txt',
      bom: false,
      lignes: 0,
      produire: function* () {
        yield lisezmoi(titre, genereLe);
      },
    },
    ...csvFerme,
    ...csvBiblio,
  ];
  return { fichiers, lignes };
}

/** Déroule un générateur d'une traite. */
function derouler<T>(g: Generator<void, T, undefined>): T {
  for (;;) {
    const r = g.next();
    if (r.done === true) return r.value;
  }
}

/** Texte entier d'un fichier prévu (référence, en mémoire). */
function texte(f: FichierPrevu): string {
  const c: Compteur = { lignes: 0 };
  return (f.bom ? BOM : '') + [...f.produire(c)].join('');
}

/** Fichiers de l'archive (en texte) et nombre de lignes par CSV. */
export function preparerExport(entree: EntreeExport): ExportPrepare {
  const plan = derouler(planifier(entree));
  return { fichiers: plan.fichiers.map((f) => ({ chemin: f.chemin, contenu: texte(f) })), lignes: plan.lignes };
}

/** Fichiers de l'archive : ferme.json, LISEZMOI.txt, un CSV par table, bibliotheque/. La référence du contenu. */
export function construireExport(entree: EntreeExport): FichierExport[] {
  return preparerExport(entree).fichiers;
}

// ── Archive légère (T15b) ────────────────────────────────────────────────────────────────────

/** Fil principal : au plus ce temps de calcul d'affilée avant de rendre la main (≈ 32 ms CPU ralenti ×4). */
const TRANCHE_MS = 8;

interface Port {
  onmessage: ((e: unknown) => void) | null;
  postMessage(m: unknown): void;
  close(): void;
}
interface Minuteries {
  readonly setImmediate?: (f: () => void) => unknown;
  readonly MessageChannel?: new () => { readonly port1: Port; readonly port2: Port };
  readonly setTimeout?: (f: () => void, ms: number) => unknown;
}

/**
 * Rend la main à la boucle d'événements (une vraie tâche, pas une micro-tâche), sans le délai
 * minimal de 4 ms des minuteries imbriquées :
 *   - setImmediate s'il existe (Node) : la boucle fait un tour complet, minuteries comprises.
 *     Surtout pas MessageChannel sous Node : un port y traite jusqu'à 1 000 messages d'affilée
 *     dans un seul rappel (node_messaging.cc), sans laisser passer les minuteries ni les
 *     entrées-sorties ; les tranches de 8 ms s'y enchaînaient en un seul long calcul (T19 :
 *     jusqu'à 31 ms de CPU entre deux tours de la boucle) ;
 *   - sinon MessageChannel (navigateur) : un message par tâche ;
 *   - sinon setTimeout.
 * Le cœur n'a pas les types du DOM ni de Node : ils sont décrits ici, au minimum.
 */
function creerRendeur(): { rendre: () => Promise<void>; fermer: () => void } {
  const g = globalThis as unknown as Minuteries;
  const immediat = g.setImmediate;
  if (immediat !== undefined) {
    return {
      rendre: () =>
        new Promise<void>((ok) => {
          immediat(ok);
        }),
      fermer: () => undefined,
    };
  }
  if (g.MessageChannel !== undefined) {
    const canal = new g.MessageChannel();
    const enAttente: (() => void)[] = [];
    let ferme = false;
    canal.port1.onmessage = () => {
      enAttente.shift()?.();
    };
    return {
      // Canal fermé (export fini, annulé ou en échec) : plus rien n'attend un message qui ne viendra pas.
      rendre: () =>
        ferme
          ? Promise.resolve()
          : new Promise<void>((ok) => {
              enAttente.push(ok);
              canal.port2.postMessage(0);
            }),
      fermer: () => {
        if (ferme) return;
        ferme = true;
        canal.port1.onmessage = null;
        canal.port1.close();
        canal.port2.close();
        for (const ok of enAttente.splice(0)) ok();
      },
    };
  }
  const minuterie = g.setTimeout;
  return {
    rendre: () =>
      new Promise<void>((ok) => {
        if (minuterie === undefined) ok();
        else minuterie(ok, 0);
      }),
    fermer: () => undefined,
  };
}

const BOM_OCTETS = [0xef, 0xbb, 0xbf] as const;

// ── Construction au fil de la lecture (T15c) ─────────────────────────────────────────────────

export interface OptionsConstructeurArchive extends OptionsArchive {
  readonly fermeId: string;
  /** Instant ISO de l'export (ferme.json `genere_le`). */
  readonly genereLe: string;
}

/**
 * Archive construite table par table, au fil de la lecture de la base (T15c) : chaque table
 * donnée est aussitôt filtrée, écrite (son CSV, sa part de ferme.json) et envoyée au compresseur.
 */
export interface ConstructeurArchive {
  /**
   * Lignes d'une table, telles que la base les rend : au plus une fois par table, dans l'ordre de
   * TABLES_EXPORTEES ; une table sautée est vide. Les appels sont traités l'un après l'autre, dans
   * l'ordre où ils sont faits ; la promesse est tenue quand la table est entièrement écrite.
   */
  ajouterTable(nom: string, lignes: readonly LigneLocale[]): Promise<void>;
  /** Fin de la lecture (les tables jamais données sont vides) : l'archive complète. */
  terminer(): Promise<ArchiveConstruite>;
}

interface Attente<T> {
  readonly promesse: Promise<T>;
  readonly tenir: (v: T) => void;
}

function attente<T>(): Attente<T> {
  let tenir: (v: T) => void = () => undefined;
  const promesse = new Promise<T>((ok) => {
    tenir = ok;
  });
  return { promesse, tenir };
}

/** Table filtrée, remise à l'écrivain de ferme.json avec le compteur de sa part de la barre. */
interface TableRemise {
  readonly t: TableRepartie;
  readonly compteur: Compteur;
}

/**
 * Part de la barre d'avancement de chaque table (lignes écrites dans son CSV et dans ferme.json) ;
 * la fin (bibliothèque de ferme.json, puis compression des dernières entrées) en a une de plus.
 * Le total est connu dès le départ, sans savoir combien de lignes chaque table aura.
 */
const PART = 1_000;

export function creerConstructeurArchive(options: OptionsConstructeurArchive): ConstructeurArchive {
  const { fermeId, genereLe, compresseur, avancement, signal } = options;
  const date = dateDos(options.date);
  const methode: 0 | 8 = compresseur === undefined ? 0 : 8;
  const noms = Object.keys(TABLES_EXPORTEES);
  const nTables = noms.length;
  const nBiblio = noms.filter((n) => TABLES_EXPORTEES[n]?.bibliotheque === true).length;
  // Place de chaque entrée dans l'archive : ferme.json, LISEZMOI.txt, les CSV des tables, bibliotheque/.
  const entrees: (EntreeLancee | undefined)[] = Array.from({ length: 2 + nTables + nBiblio }, () => undefined);
  const lignes: Record<string, number> = {};
  const membres = new Set<unknown>();
  const bibliotheques: TableRepartie[] = [];
  let nomFerme: unknown;
  /** Tables remises une à une à l'écrivain de ferme.json, puis la fin (bibliothèque) ; null : abandon. */
  const remises: (Attente<TableRemise | null> | undefined)[] = Array.from({ length: nTables }, () => attente<TableRemise | null>());
  const remiseFin = attente<Compteur | null>();
  /** Tables entièrement écrites dans ferme.json. */
  const ecrites = Array.from({ length: nTables }, () => attente<undefined>());
  let json: EntreeLancee | undefined;
  /** Entrées CSV dans l'ordre où elles sont lancées (EN_VOL au plus en cours de compression). */
  const enVol: EntreeLancee[] = [];
  let suivante = 0;
  let file: Promise<unknown> = Promise.resolve();
  let finie = false;

  // Dans un objet : l'échec est posé depuis des fermetures, TypeScript ne le suit pas sur une variable.
  const arret: { echec: { readonly erreur: unknown } | undefined } = { echec: undefined };
  /**
   * Source à arrêter (échec ou annulation). Une source annulée s'arrête sans lever : le compresseur
   * finit son entrée sans erreur (un flux Node coupé par une erreur de sa source la lève hors de
   * toute promesse), plus rien n'est écrit, et l'archive n'est jamais rendue.
   */
  const aArreter = () => arret.echec !== undefined || signal?.aborted === true;
  const verifierArret = () => {
    verifierAnnulation(signal);
    if (arret.echec !== undefined) throw arret.echec.erreur;
  };

  // Fil principal : au plus TRANCHE_MS de calcul d'affilée, même quand plusieurs fichiers s'écrivent en même temps.
  const rendeur = creerRendeur();
  let tranche = Date.now();
  const rendreSiLongtemps = async () => {
    if (Date.now() - tranche < TRANCHE_MS) return;
    await rendeur.rendre();
    tranche = Date.now();
  };
  const peutEtreRendre = async () => {
    verifierAnnulation(signal);
    await rendreSiLongtemps();
    verifierAnnulation(signal);
  };
  const liberer = () => {
    rendeur.fermer();
    signal?.removeEventListener('abort', liberer);
    for (const r of remises) r?.tenir(null);
    remiseFin.tenir(null);
  };
  signal?.addEventListener('abort', liberer, { once: true });

  // Avancement : entiers, jamais en recul, total constant.
  const total = (nTables + 1) * PART;
  const pas = Math.max(1, Math.floor(total / 200));
  let fait = 0;
  let signale = -1;
  let part: { rang: number; compteur: Compteur; lignes: number; entreesFinies: number } = { rang: 0, compteur: { lignes: 0 }, lignes: 0, entreesFinies: 0 };
  const signaler = () => {
    if (avancement === undefined || arret.echec !== undefined || fait === signale) return;
    signale = fait;
    try {
      avancement({ fait, total });
    } catch (erreur: unknown) {
      // Arrêter la production proprement (le compresseur finit son entrée), puis échouer.
      arret.echec = { erreur };
    }
  };
  const avancer = (force: boolean) => {
    const ecrit = Math.min(part.compteur.lignes, part.lignes);
    const proportion = (n: number, sur: number, poids: number) => (sur === 0 ? poids : Math.floor((poids * n) / sur));
    const dans =
      part.rang < nTables
        ? proportion(ecrit, part.lignes, PART)
        : proportion(ecrit, part.lignes, PART / 2) + proportion(part.entreesFinies, entrees.length, PART / 2);
    fait = Math.max(fait, Math.min(total, part.rang * PART + Math.min(PART, dans)));
    if (force ? fait !== signale : fait - signale >= pas) signaler();
  };
  const ouvrirPart = (rang: number, nLignes: number): Compteur => {
    const compteur: Compteur = { lignes: 0 };
    part = { rang, compteur, lignes: nLignes, entreesFinies: 0 };
    avancer(true);
    return compteur;
  };

  /** Un fichier produit morceau par morceau (BOM en octets), en rendant la main entre deux morceaux. */
  async function* flux(bom: boolean, produire: Iterable<string>): AsyncGenerator<MorceauZip, void, undefined> {
    if (aArreter()) return;
    if (bom) yield Uint8Array.from(BOM_OCTETS);
    for (const morceau of produire) {
      yield morceau;
      avancer(false);
      await rendreSiLongtemps();
      if (aArreter()) return;
    }
  }

  /** ferme.json : ouvert dès la première table, écrit table par table à mesure qu'elles arrivent. */
  async function* sourceJson(): AsyncGenerator<MorceauZip, void, undefined> {
    const e = new EcrivainJson(fermeId, genereLe);
    for (let k = 0; k < nTables; k++) {
      const r = await remises[k]?.promesse;
      // Table prise : la promesse tenue ne la garde plus en mémoire jusqu'à la fin de l'archive
      // (T15d : moins de tas vivant, des ramasse-miettes plus courts sur le fil principal).
      remises[k] = undefined;
      if (r === null || r === undefined || aArreter()) return;
      yield* flux(false, e.table(k, r.t.nom, r.t.d, r.t.ferme, r.compteur));
      ecrites[k]?.tenir(undefined);
    }
    const compteur = await remiseFin.promesse;
    if (compteur === null || aArreter()) return;
    e.bibliotheque();
    for (let n = 0; n < bibliotheques.length; n++) {
      const t = bibliotheques[n];
      if (t !== undefined) yield* flux(false, e.table(n, t.nom, t.d, t.bibliotheque, compteur));
    }
    yield* flux(false, e.fin());
  }

  const demarrerJson = (): EntreeLancee => {
    json ??= entrees[0] = lancerEntree({ chemin: 'ferme.json', contenu: sourceJson() }, compresseur, undefined);
    return json;
  };

  /** Lance une entrée CSV (ou LISEZMOI.txt) à sa place dans l'archive, EN_VOL au plus en cours de compression. */
  const lancer = async (place: number, chemin: string, contenu: AsyncIterable<MorceauZip>): Promise<EntreeLancee> => {
    const ancien = enVol.length >= EN_VOL ? enVol[enVol.length - EN_VOL] : undefined;
    if (ancien !== undefined) await ancien.travail;
    verifierArret();
    // Sans le signal : la source s'arrête d'elle-même à l'annulation (voir `aArreter`).
    const e = lancerEntree({ chemin, contenu }, compresseur, undefined);
    entrees[place] = e;
    enVol.push(e);
    return e;
  };

  /**
   * Promesse attendue plus tard : son rejet est lu par l'appelant, jamais « non traité » si
   * l'appelant échoue avant de l'attendre.
   */
  const plusTard = <T>(p: Promise<T>): Promise<T> => {
    p.catch(() => undefined);
    return p;
  };
  /** Source lue en entier par le compresseur (ou son échec). */
  const lue = (e: EntreeLancee) => plusTard(Promise.race([e.sourceFinie, e.travail]));

  async function traiter(k: number, brutes: readonly LigneLocale[]): Promise<void> {
    verifierArret();
    const nom = noms[k] ?? '';
    const d = TABLES_EXPORTEES[nom];
    if (d === undefined) throw new Error(`table inconnue de l’export : ${nom}`);
    const repartition = repartir(nom, d, brutes, fermeId, membres);
    let etape = repartition.next();
    while (etape.done !== true) {
      await peutEtreRendre();
      etape = repartition.next();
    }
    const t = etape.value;
    if (nom === 'membre') for (const m of t.ferme) membres.add(m.utilisateur_id);
    if (nom === 'ferme') nomFerme = t.ferme[0]?.nom;
    lignes[nom] = t.ferme.length;
    if (d.bibliotheque) {
      lignes[`bibliotheque/${nom}`] = t.bibliotheque.length;
      // Seules ses lignes de bibliothèque servent encore (fin de ferme.json) : pas celles de la ferme.
      bibliotheques.push({ ...t, ferme: [] });
    }
    const compteur = ouvrirPart(k, 2 * t.ferme.length + (d.bibliotheque ? t.bibliotheque.length : 0));
    verifierArret();
    const j = demarrerJson();
    remises[k]?.tenir({ t, compteur });
    const attendues: Promise<unknown>[] = [plusTard(Promise.race([ecrites[k]?.promesse, j.travail]))];
    attendues.push(lue(await lancer(2 + k, `${nom}.csv`, flux(true, csv(d, t.ferme, compteur)))));
    if (d.bibliotheque) {
      const place = 2 + nTables + bibliotheques.length - 1;
      attendues.push(lue(await lancer(place, `bibliotheque/${nom}.csv`, flux(true, csv(d, t.bibliotheque, compteur)))));
    }
    await Promise.all(attendues);
    verifierArret();
    compteur.lignes = part.lignes;
    avancer(true);
  }

  async function finir(): Promise<ArchiveConstruite> {
    while (suivante < nTables) await traiter(suivante++, []);
    verifierArret();
    const j = demarrerJson();
    const compteur = ouvrirPart(
      nTables,
      bibliotheques.reduce((n, t) => n + t.bibliotheque.length, 0),
    );
    remiseFin.tenir(compteur);
    const titre = typeof nomFerme === 'string' && nomFerme.trim() !== '' ? nomFerme : fermeId;
    const l = await lancer(
      1,
      'LISEZMOI.txt',
      flux(
        false,
        (function* () {
          yield lisezmoi(titre, genereLe);
        })(),
      ),
    );
    await Promise.all([lue(j), lue(l)]);
    verifierArret();
    const compressees: Compressee[] = [];
    for (const e of entrees) {
      if (e === undefined) throw new Error('entrée de l’archive jamais lancée');
      compressees.push(await e.travail);
      part.entreesFinies++;
      avancer(true);
    }
    verifierArret();
    // Copie finale par tranches (T15d) : d'un seul tenant, avec la création du Blob qui suit, elle
    // faisait la dernière tâche de l'export, la plus longue (≈ 37 à 51 ms, CPU ×4, ferme de T07).
    const { parties, taille } = partiesZip(entrees as EntreeLancee[], compressees, date, methode);
    const octets = new Uint8Array(taille);
    let p = 0;
    for (const b of parties) {
      octets.set(b, p);
      p += b.length;
      await peutEtreRendre();
    }
    parties.length = 0;
    verifierArret();
    return { octets, lignes };
  }

  /** Les appels passent l'un après l'autre ; le premier échec arrête le constructeur. */
  const enFile = <T>(travail: () => Promise<T>): Promise<T> => {
    const p = file.then(async () => {
      verifierArret();
      if (finie) throw new Error('archive déjà terminée');
      try {
        return await travail();
      } catch (erreur: unknown) {
        arret.echec ??= { erreur };
        liberer();
        throw erreur;
      }
    });
    file = p.catch(() => undefined);
    // Annulé : rejet immédiat, même si le compresseur ne rend plus la main.
    return annulable(signal, () => p);
  };

  return {
    ajouterTable: (nom, lignesTable) =>
      enFile(async () => {
        const k = noms.indexOf(nom);
        if (k < 0) throw new Error(`table inconnue de l’export : ${nom}`);
        if (k < suivante) throw new Error(`table ${nom} donnée deux fois, ou hors de l’ordre de TABLES_EXPORTEES`);
        while (suivante < k) await traiter(suivante++, []);
        suivante++;
        await traiter(k, lignesTable);
      }),
    terminer: () =>
      enFile(async () => {
        const archive = await finir();
        finie = true;
        liberer();
        return archive;
      }),
  };
}

/**
 * L'archive complète, légère : l'entrée donnée table par table au constructeur (une seule
 * implémentation, celle de la construction au fil de la lecture). Mêmes octets décompressés que
 * `construireExport`.
 */
export async function construireArchive(entree: EntreeExport, options: OptionsArchive): Promise<ArchiveConstruite> {
  verifierAnnulation(options.signal);
  const c = creerConstructeurArchive({ ...options, fermeId: entree.fermeId, genereLe: entree.genereLe });
  for (const nom of Object.keys(TABLES_EXPORTEES)) await c.ajouterTable(nom, entree.tables[nom] ?? []);
  return c.terminer();
}

/** 'planifications-<nom de la ferme sans accents>-<AAAA-MM-JJ>.zip'. */
export function nomArchive(nomFerme: string | null, jour: string): string {
  const nom = (nomFerme ?? '')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `planifications-${nom === '' ? 'ferme' : nom}-${jour}.zip`;
}
