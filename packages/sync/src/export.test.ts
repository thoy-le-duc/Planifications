/**
 * Tests d'acceptation T15 — export complet depuis la base locale du téléphone
 * (docs/backlog/T15-export.md) — et T15b (docs/backlog/T15b-export-leger.md) : archive
 * compressée (deflate), écrite morceau par morceau, formules neutralisées. Mémoire et fil
 * principal jamais gelé : ./export-leger.test.ts (processus isolé).
 *
 * Contrats : src/test/contrat-export.ts (`exporterFerme`, temps) et
 * packages/core/src/export/test/contrat.ts (fichiers, CSV, JSON, ZIP). La base est le SQLite en
 * mémoire de T10 (src/test/base-memoire.ts), remplie au volume de la ferme de T07
 * (src/test/jeu-t07.ts). Les archives sont relues par une implémentation indépendante
 * (src/test/zip.ts : node:zlib, et `unzip` d'Info-ZIP).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEBUT_FORMULE, type Avancement, type EntreeExport, type LigneLocale, type ModuleExport, type TypeExport } from '../../core/src/export/test/contrat.ts';
import { lireCsv, objetsCsv } from '../../core/src/export/test/csv.ts';
import { SCHEMA_LOCAL, TABLES_LOCALES } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees } from './test/contrat.ts';
import { exigerExporterFerme, type ArchiveExport, type ModuleExportSync } from './test/contrat-export.ts';
import { remplirJeuT07, VOLUMES_T07, type JeuT07 } from './test/jeu-t07.ts';
import { compresseurNode, lireZip, texteZip, verifierAvecPython, verifierAvecUnzip, type EntreeZip } from './test/zip.ts';
import { creerPorte } from './porte.ts';
import type { Id } from '@planif/core';

/** Nom tenu dans une variable : le typage ne dépend pas de l'API pas encore écrite. */
const NOM_COEUR = '@planif/core';

async function exigerCoeur(): Promise<ModuleExport> {
  const coeur = (await import(/* @vite-ignore */ NOM_COEUR)) as Partial<ModuleExport>;
  if (typeof coeur.creerZip !== 'function' || typeof coeur.construireExport !== 'function' || coeur.TABLES_EXPORTEES === undefined) {
    throw new Error('@planif/core n’exporte pas encore creerZip, construireExport et TABLES_EXPORTEES (T15)');
  }
  return coeur as ModuleExport;
}

/** `construireArchive` de @planif/core (T15b), ou une erreur explicite tant qu'il n'existe pas. */
async function exigerConstruireArchive(): Promise<ModuleExport['construireArchive']> {
  const coeur = (await import(/* @vite-ignore */ NOM_COEUR)) as Partial<ModuleExport>;
  if (typeof coeur.construireArchive !== 'function') throw new Error('@planif/core n’exporte pas encore construireArchive (T15b)');
  return coeur.construireArchive;
}

/** Règles d'avancement du contrat (T15b) ; rend un message d'écart, ou null. */
function ecartAvancement(appels: readonly Avancement[]): string | null {
  if (appels.length === 0) return 'aucun appel';
  const total = appels[0]?.total ?? 0;
  if (!(total > 0)) return `total ${String(total)} (attendu > 0)`;
  let avant = 0;
  for (const [k, a] of appels.entries()) {
    if (!Number.isInteger(a.fait) || !Number.isInteger(a.total)) return `appel ${String(k)} : valeurs non entières`;
    if (a.total !== total) return `appel ${String(k)} : total ${String(a.total)} au lieu de ${String(total)}`;
    if (a.fait < avant) return `appel ${String(k)} : recul de ${String(avant)} à ${String(a.fait)}`;
    if (a.fait < 0 || a.fait > a.total) return `appel ${String(k)} : fait ${String(a.fait)} hors de 0..${String(a.total)}`;
    avant = a.fait;
  }
  const dernier = appels.at(-1);
  if (dernier?.fait !== dernier?.total) return `dernier appel ${String(dernier?.fait)} / ${String(dernier?.total)}`;
  return null;
}

const TABLES_BIBLIOTHEQUE = new Set(['famille', 'espece', 'variete', 'itineraire', 'produit_phyto']);
const JOUR = '2026-09-29';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const encoder = new TextEncoder();

// ── ZIP ──────────────────────────────────────────────────────────────────────────────────────

describe('T15 : archive ZIP (creerZip de @planif/core)', () => {
  let coeur: ModuleExport;

  beforeAll(async () => {
    coeur = await exigerCoeur();
  });

  const binaire = Uint8Array.from({ length: 256 }, (_, i) => i);
  const FICHIERS = [
    { chemin: 'ferme.json', contenu: '{"format":"planifications-export","nombre":12.5}' },
    { chemin: 'LISEZMOI.txt', contenu: 'Données de la ferme — « exportées »\r\n' },
    { chemin: 'bibliotheque/famille.csv', contenu: '\uFEFFid;nom\r\n1;Solanacées\r\n' },
    { chemin: 'binaire.bin', contenu: binaire },
  ] as const;

  const octetsDe = (c: string | Uint8Array) => (typeof c === 'string' ? encoder.encode(c) : c);

  it('archive valide, relue par node:zlib : chemins dans l’ordre, contenus identiques, UTF-8 (BOM gardé)', async () => {
    const zip = await coeur.creerZip(FICHIERS, { date: JOUR });
    const entrees = lireZip(zip);
    expect(entrees.map((e) => e.chemin)).toEqual(FICHIERS.map((f) => f.chemin));
    FICHIERS.forEach((f, k) => {
      expect(entrees[k]?.contenu, f.chemin).toEqual(octetsDe(f.contenu));
      expect([0, 8], f.chemin).toContain(entrees[k]?.methode);
    });
    expect(entrees[2]?.contenu.subarray(0, 3)).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));
  });

  it('archive valide pour unzip (Info-ZIP) et Python zipfile : intégrité et liste des fichiers', async () => {
    const zip = await coeur.creerZip(FICHIERS, { date: JOUR });
    expect(verifierAvecUnzip(zip)).toEqual(FICHIERS.map((f) => f.chemin));
    expect(verifierAvecPython(zip)).toEqual(FICHIERS.map((f) => f.chemin));
  });

  it('noms en UTF-8 (bit 11 des drapeaux), accents compris', async () => {
    const entrees = lireZip(await coeur.creerZip([{ chemin: 'récoltes/été.csv', contenu: 'x' }, ...FICHIERS]));
    expect(entrees[0]?.chemin).toBe('récoltes/été.csv');
    for (const e of entrees) expect(e.drapeaux & 0x0800, e.chemin).toBe(0x0800);
  });

  it('date des entrées : celle donnée, 1980-01-01 par défaut', async () => {
    for (const e of lireZip(await coeur.creerZip(FICHIERS, { date: JOUR }))) expect(e.date, e.chemin).toBe(JOUR);
    for (const e of lireZip(await coeur.creerZip(FICHIERS))) expect(e.date, e.chemin).toBe('1980-01-01');
  });

  it('déterministe : même entrée, mêmes octets', async () => {
    expect(Buffer.compare(await coeur.creerZip(FICHIERS, { date: JOUR }), await coeur.creerZip(FICHIERS, { date: JOUR }))).toBe(0);
  });

  it('liste vide : archive vide valide de 22 octets ; chemin en double : promesse rejetée', async () => {
    const vide = await coeur.creerZip([]);
    expect(vide.length).toBe(22);
    expect(lireZip(vide)).toEqual([]);
    await expect(coeur.creerZip([FICHIERS[0], FICHIERS[0]])).rejects.toThrow();
  });

  it('gros fichier (8 Mo de CSV) : relu à l’identique', async () => {
    const gros = '\uFEFF' + 'id;note\r\n' + Array.from({ length: 200_000 }, (_, i) => `${String(i)};"ligne ""${String(i)}"" ; ok"\r\n`).join('');
    expect(gros.length).toBeGreaterThan(5_000_000);
    const zip = await coeur.creerZip([{ chemin: 'evenement.csv', contenu: gros }]);
    expect(texteZip(lireZip(zip), 'evenement.csv')).toBe(gros);
    expect(verifierAvecUnzip(zip)).toEqual(['evenement.csv']);
  });
});

// ── ZIP compressé (T15b) ─────────────────────────────────────────────────────────────────────

describe('T15b : creerZip avec compresseur (deflate) et contenus en morceaux', () => {
  let coeur: ModuleExport;

  beforeAll(async () => {
    coeur = await exigerCoeur();
  });

  const FICHIERS = [
    { chemin: 'ferme.json', contenu: '{"format":"planifications-export","nombre":12.5}' },
    { chemin: 'LISEZMOI.txt', contenu: 'Données de la ferme — « exportées »\r\n'.repeat(50) },
    { chemin: 'bibliotheque/famille.csv', contenu: '\uFEFFid;nom\r\n1;Solanacées\r\n' },
    { chemin: 'vide.csv', contenu: '' },
    { chemin: 'binaire.bin', contenu: Uint8Array.from({ length: 256 }, (_, i) => i) },
  ] as const;
  const octetsDe = (c: string | Uint8Array) => (typeof c === 'string' ? encoder.encode(c) : c);

  it('toutes les entrées en méthode 8, relues à l’identique par node:zlib, unzip et Python', async () => {
    const zip = await coeur.creerZip(FICHIERS, { date: JOUR, compresseur: compresseurNode });
    const entrees = lireZip(zip);
    expect(entrees.map((e) => e.chemin)).toEqual(FICHIERS.map((f) => f.chemin));
    FICHIERS.forEach((f, k) => {
      expect(entrees[k]?.methode, f.chemin).toBe(8);
      expect(entrees[k]?.contenu, f.chemin).toEqual(octetsDe(f.contenu));
      expect(entrees[k]?.date, f.chemin).toBe(JOUR);
      expect((entrees[k]?.drapeaux ?? 0) & 0x0800, f.chemin).toBe(0x0800);
    });
    expect(verifierAvecUnzip(zip)).toEqual(FICHIERS.map((f) => f.chemin));
    expect(verifierAvecPython(zip)).toEqual(FICHIERS.map((f) => f.chemin));
  });

  it('sans compresseur : toutes stockées (méthode 0), comme en T15', async () => {
    for (const e of lireZip(await coeur.creerZip(FICHIERS, { date: JOUR }))) expect(e.methode, e.chemin).toBe(0);
  });

  it('gros CSV répétitif : l’archive compressée fait moins du cinquième de la stockée, relue à l’identique', async () => {
    const gros = '\uFEFF' + 'id;note\r\n' + Array.from({ length: 200_000 }, (_, i) => `${String(i)};"ligne ""${String(i)}"" ; ok"\r\n`).join('');
    const stockee = await coeur.creerZip([{ chemin: 'evenement.csv', contenu: gros }]);
    const compressee = await coeur.creerZip([{ chemin: 'evenement.csv', contenu: gros }], { compresseur: compresseurNode });
    expect(compressee.length).toBeLessThan(stockee.length / 5);
    expect(texteZip(lireZip(compressee), 'evenement.csv')).toBe(gros);
    expect(verifierAvecUnzip(compressee)).toEqual(['evenement.csv']);
  });

  it('déterministe avec compresseur ; liste vide : 22 octets', async () => {
    const a = await coeur.creerZip(FICHIERS, { date: JOUR, compresseur: compresseurNode });
    const b = await coeur.creerZip(FICHIERS, { date: JOUR, compresseur: compresseurNode });
    expect(Buffer.compare(a, b)).toBe(0);
    expect((await coeur.creerZip([], { compresseur: compresseurNode })).length).toBe(22);
  });

  it('contenu en morceaux (tableau, générateur, générateur asynchrone ; textes et octets mêlés) : concaténés dans l’ordre', async () => {
    const attendu = '\uFEFFid;nom\r\n1;Tunnel « nord »\r\n2;Fraise 🍓\r\n';
    const BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
    function* synchrone(): Generator<string | Uint8Array> {
      yield BOM;
      yield 'id;nom\r\n';
      yield '1;Tunnel « nord »\r\n';
      yield encoder.encode('2;Fraise 🍓\r\n');
    }
    async function* asynchrone(): AsyncGenerator<string | Uint8Array> {
      for (const m of synchrone()) {
        await Promise.resolve();
        yield m;
      }
    }
    const fichiers = [
      { chemin: 'tableau.csv', contenu: [BOM, 'id;nom\r\n', '1;Tunnel « nord »\r\n', '2;Fraise 🍓\r\n'] },
      { chemin: 'synchrone.csv', contenu: synchrone() },
      { chemin: 'asynchrone.csv', contenu: asynchrone() },
      { chemin: 'aucun-morceau.csv', contenu: [] },
    ];
    for (const compresseur of [undefined, compresseurNode]) {
      const f = fichiers.map((x) => ({ ...x, contenu: x.chemin === 'synchrone.csv' ? synchrone() : x.chemin === 'asynchrone.csv' ? asynchrone() : x.contenu }));
      const zip = await coeur.creerZip(f, compresseur === undefined ? { date: JOUR } : { date: JOUR, compresseur });
      const entrees = lireZip(zip);
      for (const chemin of ['tableau.csv', 'synchrone.csv', 'asynchrone.csv']) expect(texteZip(entrees, chemin), `${chemin} ${compresseur ? 'deflate' : 'stocké'}`).toBe(attendu);
      expect(texteZip(entrees, 'aucun-morceau.csv')).toBe('');
      expect(verifierAvecUnzip(zip)).toHaveLength(4);
    }
  });

  it('le compresseur est appelé une fois par entrée, avec les octets bruts de l’entrée', async () => {
    const vus: number[] = [];
    const espion: typeof compresseurNode = async function* (brut) {
      let n = 0;
      async function* compter(): AsyncGenerator<Uint8Array> {
        for await (const m of brut) {
          n += m.length;
          yield m;
        }
        vus.push(n);
      }
      yield* compresseurNode(compter());
    };
    await coeur.creerZip(FICHIERS, { compresseur: espion });
    expect(vus).toEqual(FICHIERS.map((f) => octetsDe(f.contenu).length));
  });
});

// ── Liste blanche contre le schéma local ─────────────────────────────────────────────────────

/** Type d'export attendu d'une colonne du schéma local (règle du contrat de @planif/core). */
function typeAttendu(colonne: string, typeLocal: 'texte' | 'entier' | 'reel'): TypeExport {
  const JSON_ = new Set(['position', 'unites', 'parametres', 'rendement_prevu', 'dose_maximale', 'changements', 'avant', 'apres', 'detail', 'emplacement_ids', 'photos', 'remplace']);
  const DATES = new Set(['actif_du', 'actif_au', 'ancre_date', 'du', 'au', 'date', 'date_arrachage', 'date_plantation', 'debut', 'fin', 'debut_recolte_prevu', 'fin_recolte_prevue', 'prevu_du', 'prevu_au', 'reel_du', 'reel_au', 'prevu_debut_recolte', 'prevu_fin_recolte', 'prevu_mise_en_place', 'prevu_semis_pepiniere']);
  const INSTANTS = new Set(['cree_le', 'modifie_le', 'supprime_le', 'decide_le', 'horodatage', 'invite_le']);
  const BOOLEENS = new Set(['perenne', 'utilisable_en_bio']);
  if (BOOLEENS.has(colonne)) return 'booleen';
  if (typeLocal === 'entier') return 'entier';
  if (typeLocal === 'reel') return 'reel';
  if (JSON_.has(colonne)) return 'json';
  if (DATES.has(colonne)) return 'date';
  if (INSTANTS.has(colonne)) return 'instant';
  return 'texte';
}

describe('T15 : TABLES_EXPORTEES suit le schéma local (powersync/sync-config.yaml)', () => {
  it('toutes les tables synchronisées sauf refus_synchro, toutes leurs colonnes, id en premier', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const locales = Object.keys(TABLES_LOCALES).filter((t) => t !== 'refus_synchro');
    expect(Object.keys(TABLES_EXPORTEES).sort()).toEqual(locales.sort());
    for (const table of locales) {
      const colonnes = Object.keys(TABLES_EXPORTEES[table]?.colonnes ?? {});
      expect(colonnes[0], table).toBe('id');
      expect([...colonnes].sort(), table).toEqual(['id', ...Object.keys(TABLES_LOCALES[table as keyof typeof TABLES_LOCALES])].sort());
    }
  });

  it('type d’export de chaque colonne : booléens, nombres, JSON, dates, instants, texte', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    for (const [table, colonnes] of Object.entries(TABLES_LOCALES)) {
      if (table === 'refus_synchro') continue;
      expect(TABLES_EXPORTEES[table]?.colonnes.id?.type, `${table}.id`).toBe('texte');
      for (const [col, typeLocal] of Object.entries(colonnes as Readonly<Record<string, 'texte' | 'entier' | 'reel'>>)) {
        expect(TABLES_EXPORTEES[table]?.colonnes[col]?.type, `${table}.${col}`).toBe(typeAttendu(col, typeLocal));
      }
    }
  });
});

// ── exporterFerme sur la ferme de T07 ────────────────────────────────────────────────────────

/**
 * Temps CPU du processus, en ms (T19).
 *
 * `exporterFerme` ne calcule pas que sur le fil du test : la compression par défaut
 * (`CompressionStream` de Node) confie le deflate à node:zlib, sur les fils de libuv, en
 * parallèle ; le ramasse-miettes aussi a ses fils. Le temps CPU du fil seul
 * (`process.threadCpuUsage`) oublierait toute la compression. On prend celui du PROCESSUS
 * (`process.cpuUsage`, tous fils) : vitest lance chaque fichier de test dans son propre
 * processus (pool `forks`, par défaut) et, pendant le `beforeAll`, seul l'export y calcule.
 */
function cpuMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}

interface FermeJson {
  tables: Record<string, unknown[]>;
  bibliotheque: Record<string, unknown[]>;
}

describe('T15 : exporterFerme, depuis la base locale, ferme de T07', () => {
  let exporterFerme: ModuleExportSync['exporterFerme'];
  let base: BaseMemoire;
  let jeu: JeuT07;
  let porte: PorteDonnees;
  let archive: ArchiveExport;
  let entrees: EntreeZip[];
  /**
   * Durée du premier export (à froid), en ms, comptée en temps CPU (T19) : min(mural, CPU du
   * processus). Machine chargée (autres tests, autre équipe) : le système préempte le
   * processus, le temps mural s'allonge mais pas le temps CPU, qui ne compte que le calcul de
   * l'export ; la mesure ne bouge plus. Un export vraiment plus lent consomme plus de CPU ET
   * de temps mural : il se voit toujours. Le min écarte le CPU des fils parallèles (zlib,
   * ramasse-miettes) qui se chevauchent, ou d'autres fichiers si vitest passait en pool
   * `threads` : jamais plus indulgent que l'ancienne mesure murale.
   */
  let duree: number;
  /** Temps mural du même export, en ms, pour information seulement. */
  let dureeMurale: number;
  /** Appels d'avancement du premier export (T15b). */
  const appels: Avancement[] = [];

  beforeAll(async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    jeu = await remplirJeuT07(base);
    porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    exporterFerme = await exigerExporterFerme();
    const debut = performance.now();
    const debutCpu = cpuMs();
    archive = await exporterFerme(porte, {
      fermeId: jeu.principale.fermeId,
      genereLe: GENERE_LE,
      jour: JOUR,
      avancement: (a) => {
        appels.push({ fait: a.fait, total: a.total });
      },
    });
    const cpu = cpuMs() - debutCpu;
    dureeMurale = performance.now() - debut;
    duree = Math.min(dureeMurale, cpu);
    entrees = lireZip(archive.octets);
  }, 60_000);

  afterAll(() => {
    base.fermer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Nombre de lignes de la ferme principale dans la base, par chemin de CSV sans extension. */
  function comptesBase(tables: readonly string[]): Record<string, number> {
    const f = jeu.principale.fermeId;
    const compter = (sql: string, p: readonly unknown[]) => base.lireDirect<{ n: number }>(sql, p)[0]?.n ?? -1;
    const r: Record<string, number> = {};
    for (const t of tables) {
      if (t === 'ferme') r[t] = compter('SELECT COUNT(*) AS n FROM ferme WHERE id = ?', [f]);
      else if (t === 'utilisateur') r[t] = compter('SELECT COUNT(*) AS n FROM utilisateur WHERE id IN (SELECT utilisateur_id FROM membre WHERE ferme_id = ?)', [f]);
      else r[t] = compter(`SELECT COUNT(*) AS n FROM ${t} WHERE ferme_id = ?`, [f]);
      if (TABLES_BIBLIOTHEQUE.has(t)) r[`bibliotheque/${t}`] = compter(`SELECT COUNT(*) AS n FROM ${t} WHERE ferme_id IS NULL`, []);
    }
    return r;
  }

  it('temps : premier export complet (à froid) en moins de 2,5 s de calcul sous Node (≈ 10 s CPU ralenti ×4, voir contrat-export.ts ; min(mural, CPU), T19)', () => {
    console.info(
      `T15 : export de la ferme de T07 en ${duree.toFixed(0)} ms de calcul (mural ${dureeMurale.toFixed(0)} ms), archive de ${(archive.octets.length / 1_048_576).toFixed(1)} Mio`,
    );
    expect(duree).toBeLessThan(2500);
  });

  it('le jeu a bien le volume de T07', () => {
    const c = comptesBase(['zone', 'emplacement', 'saison', 'serie', 'occupation', 'evenement']);
    expect(c).toMatchObject({
      zone: VOLUMES_T07.zones,
      emplacement: VOLUMES_T07.emplacements,
      saison: VOLUMES_T07.saisons,
      serie: VOLUMES_T07.series,
      occupation: VOLUMES_T07.series,
      evenement: VOLUMES_T07.evenements,
    });
  });

  it('archive valide (node:zlib et unzip) avec tous les fichiers attendus', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const attendus = [
      'ferme.json',
      'LISEZMOI.txt',
      ...Object.keys(TABLES_EXPORTEES).map((t) => `${t}.csv`),
      ...[...TABLES_BIBLIOTHEQUE].map((t) => `bibliotheque/${t}.csv`),
    ].sort();
    expect(entrees.map((e) => e.chemin).sort()).toEqual(attendus);
    expect(verifierAvecUnzip(archive.octets).sort()).toEqual(attendus);
    expect(verifierAvecPython(archive.octets).sort()).toEqual(attendus);
  });

  it('T15b : archive compressée par défaut (deflate, CompressionStream de Node) : toutes les entrées en méthode 8, moins de 8 Mo', () => {
    console.info(`T15b : archive de la ferme de T07 : ${(archive.octets.length / 1_000_000).toFixed(2)} Mo (T15 : ≈ 38,6 Mo stockée)`);
    for (const e of entrees) expect(e.methode, e.chemin).toBe(8);
    expect(archive.octets.length).toBeLessThan(8_000_000);
  });

  /** Entrée de construireExport telle que la base la rend : toutes les lignes, triées par id. */
  async function entreeDeLaBase(): Promise<EntreeExport> {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const tables: Record<string, LigneLocale[]> = {};
    for (const t of Object.keys(TABLES_EXPORTEES)) tables[t] = base.lireDirect<LigneLocale>(`SELECT * FROM "${t}" ORDER BY id`, []);
    return { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, tables };
  }

  it('T15b : même contenu que la référence construireExport, octet pour octet, dans le même ordre', async () => {
    const coeur = await exigerCoeur();
    const reference = coeur.construireExport(await entreeDeLaBase());
    expect(entrees.map((e) => e.chemin)).toEqual(reference.map((f) => f.chemin));
    for (const f of reference) {
      const e = entrees.find((x) => x.chemin === f.chemin);
      expect(e !== undefined && Buffer.compare(e.contenu, encoder.encode(f.contenu)) === 0, f.chemin).toBe(true);
    }
  }, 60_000);

  it('T15b : seules les cellules texte qui ressemblent à une formule changent (evenement.csv contre la base)', () => {
    const csv = objetsCsv(lireCsv(texteZip(entrees, 'evenement.csv')));
    const base_ = base.lireDirect<{ note: string | null }>('SELECT note FROM evenement WHERE ferme_id = ? ORDER BY id', [jeu.principale.fermeId]);
    expect(csv).toHaveLength(base_.length);
    let neutralisees = 0;
    csv.forEach((l, k) => {
      const note = base_[k]?.note;
      if (typeof note !== 'string') {
        expect(l.note, `ligne ${String(k + 1)}`).toBe('');
        return;
      }
      if (DEBUT_FORMULE.test(note)) {
        neutralisees++;
        expect(l.note, `ligne ${String(k + 1)}`).toBe(`'${note}`);
      } else expect(l.note, `ligne ${String(k + 1)}`).toBe(note);
    });
    expect(neutralisees, 'le jeu de T07 contient des notes « =SOMME… », « -3 plants »…').toBeGreaterThan(1000);
  });

  it('T15b : avancement de l’export (barre de l’écran) : fait jamais en recul, total constant, fini à 100 %', () => {
    expect(ecartAvancement(appels)).toBeNull();
    expect(appels.length).toBeGreaterThanOrEqual(20);
  });

  it('T15b : construireArchive sur l’entrée de T07 : mêmes octets décompressés que construireExport, mêmes lignes, avancement', async () => {
    const construireArchive = await exigerConstruireArchive();
    const coeur = await exigerCoeur();
    const entree = await entreeDeLaBase();
    const suivis: Avancement[] = [];
    const r = await construireArchive(entree, { date: JOUR, compresseur: compresseurNode, avancement: (a) => suivis.push({ fait: a.fait, total: a.total }) });
    const lues = lireZip(r.octets);
    const reference = coeur.construireExport(entree);
    expect(lues.map((e) => e.chemin)).toEqual(reference.map((f) => f.chemin));
    for (const f of reference) {
      const e = lues.find((x) => x.chemin === f.chemin);
      expect(e?.methode, f.chemin).toBe(8);
      expect(e !== undefined && Buffer.compare(e.contenu, encoder.encode(f.contenu)) === 0, f.chemin).toBe(true);
    }
    expect(r.lignes).toEqual(archive.lignes);
    expect(ecartAvancement(suivis)).toBeNull();
    expect(suivis.length).toBeGreaterThanOrEqual(Math.max(20, reference.length));
  }, 60_000);

  it('T15b : un avancement qui lève fait échouer l’export', async () => {
    // Pas de `rejects` : en cas d'échec, vitest afficherait l'archive entière (des Mio d'octets).
    const issue = await exporterFerme(porte, {
      fermeId: jeu.principale.fermeId,
      genereLe: GENERE_LE,
      jour: JOUR,
      avancement: () => {
        throw new Error('barre cassée');
      },
    }).then(
      () => 'export réussi malgré l’avancement qui lève',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(issue).toBe('barre cassée');
  }, 60_000);

  it('relecture : même nombre de lignes par table dans les CSV, le JSON et `lignes` que dans la base', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const attendu = comptesBase(Object.keys(TABLES_EXPORTEES));
    const json = JSON.parse(texteZip(entrees, 'ferme.json')) as FermeJson;
    for (const [cle, n] of Object.entries(attendu)) {
      expect(lireCsv(texteZip(entrees, `${cle}.csv`)).lignes, `${cle}.csv`).toHaveLength(n);
      const tableau = cle.startsWith('bibliotheque/') ? json.bibliotheque[cle.slice('bibliotheque/'.length)] : json.tables[cle];
      expect(tableau, `ferme.json ${cle}`).toHaveLength(n);
    }
    expect(archive.lignes).toEqual(attendu);
    expect(attendu.evenement).toBe(VOLUMES_T07.evenements);
  });

  it('aucun identifiant de la ferme voisine, ni du refus de synchro, dans aucun fichier', () => {
    const vus = new Set<string>();
    for (const e of entrees) for (const id of texteZip(entrees, e.chemin).match(UUID) ?? []) vus.add(id);
    expect(vus.has(jeu.principale.fermeId)).toBe(true);
    expect(jeu.voisine.ids.length).toBeGreaterThan(500);
    const fuites = jeu.voisine.ids.filter((id) => vus.has(id));
    expect(fuites, 'identifiants de la ferme voisine exportés').toEqual([]);
    expect(vus.has(jeu.refusId)).toBe(false);
    const tout = entrees.map((e) => texteZip(entrees, e.chemin)).join('\n');
    expect(tout).not.toContain('Ferme voisine');
  });

  it('nom du fichier : planifications-<ferme>-<jour>.zip', () => {
    expect(archive.nomFichier).toBe('planifications-ferme-de-benoit-2026-09-29.zip');
  });

  it('hors ligne : aucun appel réseau, aucune écriture, lecture par porte.lire seulement, jamais refus_synchro', async () => {
    const reseau = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', reseau);
    const ecrituresAvant = base.ecritures.length;
    const requetes: string[] = [];
    const interdit = (nom: string) => () => {
      throw new Error(`exporterFerme ne doit pas appeler porte.${nom}`);
    };
    const porteLectureSeule: PorteDonnees = {
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        requetes.push(sql);
        return porte.lire<T>(sql, parametres);
      },
      ecrire: interdit('ecrire'),
      surveiller: interdit('surveiller'),
      saisirEvenement: interdit('saisirEvenement'),
      surveillerRefus: interdit('surveillerRefus'),
    };
    const resultat = await exporterFerme(porteLectureSeule, { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, jour: JOUR });
    expect(reseau).not.toHaveBeenCalled();
    expect(base.ecritures.length).toBe(ecrituresAvant);
    expect(requetes.some((sql) => /refus_synchro/i.test(sql))).toBe(false);
    const { TABLES_EXPORTEES } = await exigerCoeur();
    for (const table of Object.keys(TABLES_EXPORTEES)) {
      expect(requetes.some((sql) => new RegExp(`\\bFROM\\s+"?${table}"?(\\s|$)`, 'i').test(sql)), `lecture de ${table}`).toBe(true);
    }
    // Même archive qu'à la première lecture (comparaison d'octets rapide : l'archive fait des Mio).
    expect(Buffer.compare(resultat.octets, archive.octets), 'archive identique').toBe(0);
  }, 60_000);

  it('ferme absente de la base : archive quand même, nom par défaut, bibliothèque de référence seule', async () => {
    const inconnue = '0192f0c1-7a6e-7cc3-f000-000000000001';
    const r = await exporterFerme(porte, { fermeId: inconnue, genereLe: GENERE_LE, jour: JOUR });
    expect(r.nomFichier).toBe('planifications-ferme-2026-09-29.zip');
    expect(verifierAvecUnzip(r.octets).length).toBeGreaterThan(20);
    expect(r.lignes.evenement).toBe(0);
    expect(r.lignes.ferme).toBe(0);
    expect(r.lignes['bibliotheque/famille']).toBeGreaterThan(0);
    lireZip(r.octets);
  }, 60_000);
});
