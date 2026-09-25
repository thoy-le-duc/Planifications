/**
 * T07 — page de mesure de la base locale PowerSync (hors navigation normale).
 *
 * URL : `/mesures/sqlite.html?variante=json|raw`. Options de comparaison, hors test : `&vfs=opfs`
 * (OPFSCoopSyncVFS au lieu d'IndexedDB) et `&fil=page` (SQLite sur le fil principal au lieu du
 * worker : le ralentissement CPU de Chrome DevTools ne s'applique qu'au fil principal, voir
 * `docs/mesures/sqlite.md`). Deux étapes, séparées par un rechargement de la page pour
 * que l'ouverture mesurée soit une vraie réouverture (nouveau worker, WASM relu depuis le cache) :
 *
 * 1. `etape` absente : base vide propre à la variante, chargement du jeu `genererFerme(GRAINE)`
 *    par lots dans des transactions (non chronométré), fermeture, rechargement avec `etape=mesure`.
 * 2. `etape=mesure` : ouverture, requête 2D, semainier, insertion, chronométrés avec
 *    `performance.now()`. Le résultat est posé dans `window.__mesuresSqlite` et affiché.
 *
 * Aucun serveur PowerSync : `connect()` n'est jamais appelé.
 */
import { PowerSyncDatabase, WASQLiteVFS, type CommonPowerSyncDatabase } from '@powersync/web';
import { genererFerme, type FermeGeneree } from './generateur.ts';
import { colonnes, creerSchema, ddlRaw, descriptionRaw, NOMS_TABLES, type NomTable, type Variante } from './schema-sqlite.ts';

const GRAINE = 42;
/** Lignes par transaction d'écriture pendant le chargement. */
const TAILLE_LOT = 2000;
/** Saison affichée par la vue 2D et semaine du semainier (lundi → dimanche). */
const SAISON_2D = { debut: '2024-01-01', fin: '2024-12-31' };
const SEMAINE = { debut: '2024-06-10', fin: '2024-06-16' };

type ChoixVfs = 'idb' | 'opfs';
/** Où tourne SQLite : worker dédié (défaut du SDK) ou fil principal de la page (comparaison). */
type Fil = 'worker' | 'page';

interface Mesures {
  variante: Variante;
  graine: number;
  vfs: ChoixVfs;
  fil: Fil;
  ouvertureMs: number;
  requete2dMs: number;
  semainierMs: number;
  insertionMs: number;
  lignes2d: number;
  lignesSemainier: number;
  /** Temps écoulé entre le début de la navigation et le lancement de l'ouverture (chargement du JS de la page). */
  pagePreteMs: number;
  /** Durée du chargement du jeu (non chronométré par le ticket, donné pour information). */
  chargementMs: number | null;
  /** Boucle de calcul fixe sur le fil principal : vérifie que le ralentissement CPU est bien actif. */
  etalonCpuMs: number;
}

type Resultat = Mesures | { variante: string; erreur: string };

declare global {
  interface Window {
    __mesuresSqlite?: Resultat;
  }
}

const CLE_CHARGEMENT = 'mesures-sqlite:chargementMs';

interface Parametres {
  variante: Variante;
  vfs: ChoixVfs;
  fil: Fil;
  etape: 'charge' | 'mesure';
}

function lireParametres(): Parametres {
  const params = new URLSearchParams(location.search);
  const variante = params.get('variante');
  if (variante !== 'json' && variante !== 'raw') throw new Error(`variante inconnue : ${String(variante)} (json ou raw)`);
  const vfs = params.get('vfs') === 'opfs' ? 'opfs' : 'idb';
  const fil = params.get('fil') === 'page' ? 'page' : 'worker';
  return { variante, vfs, fil, etape: params.get('etape') === 'mesure' ? 'mesure' : 'charge' };
}

function nomFichier(variante: Variante, vfs: ChoixVfs): string {
  return `mesure-${variante}-${vfs}.sqlite`;
}

function ouvrir({ variante, vfs, fil }: Parametres): CommonPowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: creerSchema(variante),
    database: {
      dbFilename: nomFichier(variante, vfs),
      vfs: vfs === 'opfs' ? WASQLiteVFS.OPFSCoopSyncVFS : WASQLiteVFS.IDBBatchAtomicVFS,
      // Worker dédié plutôt que SharedWorker : c'est le défaut du SDK sur Android et iOS.
      enableMultiTabs: false,
      useWebWorker: fil === 'worker',
    },
  });
}

/** Repart d'une base vide : supprime le fichier de la variante dans IndexedDB ou OPFS. */
async function effacerBase(variante: Variante, vfs: ChoixVfs): Promise<void> {
  const nom = nomFichier(variante, vfs);
  if (vfs === 'idb') {
    await new Promise<void>((resolve, reject) => {
      const requete = indexedDB.deleteDatabase(nom);
      requete.onsuccess = () => {
        resolve();
      };
      requete.onerror = () => {
        reject(requete.error ?? new Error('suppression IndexedDB impossible'));
      };
      requete.onblocked = () => {
        reject(new Error('suppression IndexedDB bloquée par une autre connexion'));
      };
    });
    return;
  }
  const racine = await navigator.storage.getDirectory();
  for await (const entree of racine.keys()) {
    if (entree.startsWith(nom)) await racine.removeEntry(entree, { recursive: true });
  }
}

type Ligne = Record<string, string | number | null>;

function lignes(ferme: FermeGeneree, table: NomTable): readonly Ligne[] {
  const parTable: Record<NomTable, readonly object[]> = {
    famille: ferme.familles,
    zone: ferme.zones,
    emplacement: ferme.emplacements,
    saison: ferme.saisons,
    serie: ferme.series,
    occupation: ferme.occupations,
    evenement: ferme.evenements,
  };
  return parTable[table] as readonly Ligne[];
}

async function charger(db: CommonPowerSyncDatabase, variante: Variante, ferme: FermeGeneree): Promise<void> {
  if (variante === 'raw') {
    await db.writeTransaction(async (tx) => {
      for (const ordre of ddlRaw()) await tx.execute(ordre);
      // Déclencheurs qui versent les écritures locales dans la file d'envoi, comme les vues JSON.
      for (const nom of NOMS_TABLES) {
        for (const ecriture of ['INSERT', 'UPDATE', 'DELETE']) {
          await tx.execute('SELECT powersync_create_raw_table_crud_trigger(?, ?, ?)', [
            descriptionRaw(nom),
            `${nom}_crud_${ecriture.toLowerCase()}`,
            ecriture,
          ]);
        }
      }
    });
  }
  for (const table of NOMS_TABLES) {
    const cols = ['id', ...colonnes(table)];
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const toutes = lignes(ferme, table);
    for (let debut = 0; debut < toutes.length; debut += TAILLE_LOT) {
      const lot = toutes.slice(debut, debut + TAILLE_LOT).map((l) => cols.map((c) => l[c] ?? null));
      await db.writeTransaction(async (tx) => {
        await tx.executeBatch(sql, lot);
      });
    }
  }
}

const SQL_2D = `
  SELECT o.id, o.du, o.au, e.code, e.longueur_m, z.nom AS zone, s.espece, f.nom AS famille
  FROM occupation o
  JOIN emplacement e ON e.id = o.emplacement_id
  JOIN zone z ON z.id = e.zone_id
  JOIN serie s ON s.id = o.serie_id
  JOIN famille f ON f.id = s.famille_id
  WHERE o.au >= ? AND o.du <= ?
  ORDER BY z.nom, e.code, o.du`;

const SQL_SEMAINIER = `
  SELECT 'evenement' AS nature, ev.id, ev.type, ev.date AS jour, s.espece, e.code
  FROM evenement ev
  LEFT JOIN serie s ON s.id = ev.serie_id
  LEFT JOIN emplacement e ON e.id = ev.emplacement_id
  WHERE ev.date BETWEEN ?1 AND ?2
  UNION ALL
  SELECT 'mise_en_place', o.id, 'occupation', o.du, s.espece, e.code
  FROM occupation o JOIN serie s ON s.id = o.serie_id JOIN emplacement e ON e.id = o.emplacement_id
  WHERE o.du BETWEEN ?1 AND ?2
  UNION ALL
  SELECT 'fin', o.id, 'occupation', o.au, s.espece, e.code
  FROM occupation o JOIN serie s ON s.id = o.serie_id JOIN emplacement e ON e.id = o.emplacement_id
  WHERE o.au BETWEEN ?1 AND ?2
  ORDER BY jour, nature`;

async function chronometrer<T>(action: () => Promise<T>): Promise<[T, number]> {
  const debut = performance.now();
  const valeur = await action();
  return [valeur, performance.now() - debut];
}

async function etapeChargement(params: Parametres): Promise<void> {
  const { variante, vfs } = params;
  afficher(`Variante ${variante} (${vfs}) : préparation d'une base vide et chargement du jeu…`);
  await effacerBase(variante, vfs);
  const ferme = genererFerme(GRAINE);
  const db = ouvrir(params);
  const [, chargementMs] = await chronometrer(async () => {
    await db.init();
    await charger(db, variante, ferme);
  });
  await db.close();
  try {
    sessionStorage.setItem(CLE_CHARGEMENT, String(chargementMs));
  } catch {
    // Stockage indisponible : la durée de chargement ne sera simplement pas reportée.
  }
  const url = new URL(location.href);
  url.searchParams.set('etape', 'mesure');
  location.replace(url);
}

/** Boucle de calcul déterministe, pour comparer la vitesse du fil principal d'un passage à l'autre. */
let puitsEtalon = 0;
function etalonCpu(): number {
  const debut = performance.now();
  let x = puitsEtalon;
  for (let i = 0; i < 5_000_000; i++) x = (x + Math.imul(i, 2654435761)) >>> 0;
  puitsEtalon = x;
  return performance.now() - debut;
}

async function etapeMesure(params: Parametres): Promise<Mesures> {
  const { variante, vfs, fil } = params;
  const pagePreteMs = performance.now();
  const [db, ouvertureMs] = await chronometrer(async () => {
    const base = ouvrir(params);
    await base.init();
    return base;
  });
  const [lignes2d, requete2dMs] = await chronometrer(() => db.getAll(SQL_2D, [SAISON_2D.debut, SAISON_2D.fin]));
  const [semainier, semainierMs] = await chronometrer(() => db.getAll(SQL_SEMAINIER, [SEMAINE.debut, SEMAINE.fin]));
  const [, insertionMs] = await chronometrer(() =>
    db.execute('INSERT INTO evenement (id, type, date, serie_id, emplacement_id) VALUES (?, ?, ?, ?, ?)', [
      crypto.randomUUID(),
      'observation',
      '2024-06-12',
      'serie-1500',
      null,
    ]),
  );
  await db.close();

  let chargementMs: number | null;
  try {
    const brut = sessionStorage.getItem(CLE_CHARGEMENT);
    chargementMs = brut === null ? null : Number(brut);
  } catch {
    chargementMs = null;
  }
  return {
    variante,
    graine: GRAINE,
    vfs,
    fil,
    ouvertureMs,
    requete2dMs,
    semainierMs,
    insertionMs,
    lignes2d: lignes2d.length,
    lignesSemainier: semainier.length,
    pagePreteMs,
    chargementMs,
    etalonCpuMs: etalonCpu(),
  };
}

function afficher(texte: string): void {
  const sortie = document.getElementById('sortie');
  if (sortie) sortie.textContent = texte;
}

async function principal(): Promise<void> {
  let variante = new URLSearchParams(location.search).get('variante') ?? '';
  try {
    const params = lireParametres();
    variante = params.variante;
    if (params.etape === 'charge') {
      await etapeChargement(params);
      return;
    }
    const mesures = await etapeMesure(params);
    window.__mesuresSqlite = mesures;
    afficher(JSON.stringify(mesures, null, 2));
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    window.__mesuresSqlite = { variante, erreur: message };
    afficher(`Erreur : ${message}`);
  }
}

void principal();
