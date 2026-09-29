/**
 * Export complet de la ferme (T15, principe 5, puis T15b) : fichiers de l'archive (ferme.json,
 * CSV, LISEZMOI.txt), nom de l'archive, ZIP. Tout est pur : ni base, ni réseau. La lecture de la
 * base locale est dans `exporterFerme` (@planif/sync).
 *
 * Chaque fichier est PRODUIT par morceaux (générateurs plus bas) : `construireExport` les met bout
 * à bout en texte (la référence du contenu) ; `construireArchive` les passe un par un au ZIP, qui
 * les encode et les compresse aussitôt : jamais un fichier entier en mémoire. Mêmes générateurs,
 * donc mêmes octets.
 *
 * Contrat détaillé : ./test/contrat.ts.
 */
import { TABLES_EXPORTEES, type DescriptionTable, type TypeExport } from './tables.ts';
import { annulable, creerZip, verifierAnnulation, type Compresseur, type FichierZip, type MorceauZip, type SignalAnnulation } from './zip.ts';

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
 * de `JSON.stringify({ format, version, ferme_id, genere_le, tables, bibliotheque })`.
 */
function* fermeJson(entree: EntreeExport, tables: readonly TableRepartie[], c: Compteur): Generator<string, void, undefined> {
  let morceau = `{"format":"planifications-export","version":1,"ferme_id":${JSON.stringify(entree.fermeId)},"genere_le":${JSON.stringify(entree.genereLe)},"tables":{`;
  const ecrire = function* (cle: 'ferme' | 'bibliotheque', liste: readonly TableRepartie[]): Generator<string, void, undefined> {
    for (let n = 0; n < liste.length; n++) {
      const t = liste[n];
      if (t === undefined) continue;
      const colonnes = Object.entries(t.d.colonnes);
      const noms = colonnes.map(([x]) => x);
      const types = colonnes.map(([, x]) => x.type);
      morceau += `${n === 0 ? '' : ','}${JSON.stringify(t.nom)}:[`;
      const lignes = t[cle];
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        if (l === undefined) continue;
        morceau += (i === 0 ? '' : ',') + ligneJson(noms, types, l);
        c.lignes++;
        if (morceau.length >= MORCEAU) {
          yield morceau;
          morceau = '';
        }
      }
      morceau += ']';
    }
  };
  yield* ecrire('ferme', tables);
  morceau += '},"bibliotheque":{';
  yield* ecrire(
    'bibliotheque',
    tables.filter((t) => t.d.bibliotheque),
  );
  morceau += '}}';
  yield morceau;
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
  readonly MessageChannel?: new () => { readonly port1: Port; readonly port2: Port };
  readonly setTimeout?: (f: () => void, ms: number) => unknown;
}

/**
 * Rend la main à la boucle d'événements (une vraie tâche, pas une micro-tâche) : MessageChannel
 * s'il existe (sans le délai minimal de 4 ms des minuteries imbriquées), sinon setTimeout.
 * Le cœur n'a pas les types du DOM ni de Node : ils sont décrits ici, au minimum.
 */
function creerRendeur(): { rendre: () => Promise<void>; fermer: () => void } {
  const g = globalThis as unknown as Minuteries;
  if (g.MessageChannel !== undefined) {
    const canal = new g.MessageChannel();
    const enAttente: (() => void)[] = [];
    canal.port1.onmessage = () => {
      enAttente.shift()?.();
    };
    return {
      rendre: () =>
        new Promise<void>((ok) => {
          enAttente.push(ok);
          canal.port2.postMessage(0);
        }),
      fermer: () => {
        canal.port1.onmessage = null;
        canal.port1.close();
        canal.port2.close();
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

/**
 * L'archive complète, légère : chaque fichier est produit, encodé et compressé morceau par
 * morceau (BOM en octets, ferme.json table par table), en rendant la main régulièrement.
 * Mêmes octets décompressés que `construireExport`.
 */
export async function construireArchive(entree: EntreeExport, options: OptionsArchive): Promise<ArchiveConstruite> {
  const { signal } = options;
  verifierAnnulation(signal);
  const rendeur = creerRendeur();
  let tranche = Date.now();
  const peutEtreRendre = async () => {
    verifierAnnulation(signal);
    if (Date.now() - tranche < TRANCHE_MS) return;
    await rendeur.rendre();
    tranche = Date.now();
    verifierAnnulation(signal);
  };
  try {
    // Annulé : rejet immédiat, même si le compresseur ne rend plus la main ; le canal est fermé.
    return await annulable(signal, () => archiver(entree, options, peutEtreRendre));
  } finally {
    rendeur.fermer();
  }
}

async function archiver(entree: EntreeExport, options: OptionsArchive, peutEtreRendre: () => Promise<void>): Promise<ArchiveConstruite> {
  const plans = planifier(entree);
  let etape = plans.next();
  while (etape.done !== true) {
    await peutEtreRendre();
    etape = plans.next();
  }
  const plan = etape.value;
  const total = plan.fichiers.reduce((n, f) => n + f.lignes + 1, 0);
  const pas = Math.max(1, Math.floor(total / 60));
  let fait = 0;
  let signale = -1;
  // Dans un objet : l'échec est posé depuis des fermetures, TypeScript ne le suit pas sur une variable.
  const arret: { echec: { readonly erreur: unknown } | undefined } = { echec: undefined };
  const arrete = () => arret.echec !== undefined;
  const { avancement } = options;
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

  async function* flux(f: FichierPrevu): AsyncGenerator<MorceauZip, void, undefined> {
    if (arrete()) return;
    if (f.bom) yield Uint8Array.from(BOM_OCTETS);
    const c: Compteur = { lignes: 0 };
    let compte = 0;
    for (const morceau of f.produire(c)) {
      yield morceau;
      fait += c.lignes - compte;
      compte = c.lignes;
      if (fait - signale >= pas) signaler();
      await peutEtreRendre();
      if (arrete()) return;
    }
    fait += c.lignes - compte + 1;
    signaler();
  }

  signaler();
  const fichiers: FichierZip[] = plan.fichiers.map((f) => ({ chemin: f.chemin, contenu: flux(f) }));
  const octets = await creerZip(fichiers, {
    date: options.date,
    ...(options.compresseur === undefined ? {} : { compresseur: options.compresseur }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (arret.echec !== undefined) throw arret.echec.erreur;
  return { octets, lignes: plan.lignes };
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
