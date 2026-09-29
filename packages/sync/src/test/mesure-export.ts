/**
 * Mesures de T15b dans un processus Node isolé (lancé par ../export-leger.test.ts) :
 *
 *   node --expose-gc --no-warnings src/test/mesure-export.ts
 *
 * Isolé parce que la mémoire d'un fil de vitest mêle celle des autres tests, et que le
 * ramasse-miettes forcé (`gc()`, drapeau --expose-gc) n'existe qu'au lancement de Node.
 * Écrit sur la sortie standard UNE ligne JSON (`ResultatMesures`) ; toute erreur y est rendue
 * dans `erreur` (module pas encore écrit, par exemple), pour que le test l'affiche.
 *
 * Méthode (voir le contrat, packages/core/src/export/test/contrat.ts, « Archive légère ») :
 *   - mémoire vivante = tas V8 + mémoire externe (octets des Uint8Array, tampons de zlib),
 *     relevée après deux `gc()` complets : seul ce qui est encore tenu compte, pas les déchets
 *     que le ramasse-miettes reprendrait de toute façon ;
 *   - relevée à CHAQUE appel d'`avancement` et à la fin (archive tenue) ; pic = plus grand
 *     relevé − relevé d'avant l'appel. Les appels d'avancement sont les points de passage entre
 *     deux morceaux : un texte ou des octets gardés d'un morceau à l'autre s'y voient ;
 *   - plus longue tâche = plus grand écart entre deux tours d'une minuterie de 1 ms pendant
 *     l'export (aucun `gc()` forcé dans ces tours-là), sur trois exports de suite.
 */
import { SCHEMA_LOCAL } from '../schema.ts';
import { creerPorte } from '../porte.ts';
import type { EntreeExport, LigneLocale, ModuleExport } from '../../../core/src/export/test/contrat.ts';
import { creerBaseMemoire } from './base-memoire.ts';
import { exigerExporterFerme } from './contrat-export.ts';
import { remplirJeuT07 } from './jeu-t07.ts';
import { compresseurNode } from './zip.ts';
import type { Id } from '@planif/core';

export interface MesureMemoire {
  /** Taille de l'archive finale, en octets. */
  readonly taille: number;
  /** Mémoire vivante ajoutée au pic, en octets (au-dessus du relevé d'avant l'appel). */
  readonly pic: number;
  /** Nombre d'appels d'avancement (autant de relevés). */
  readonly appels: number;
}

export interface MesureTache {
  /** Plus long écart entre deux tours de la boucle d'événements, en ms. */
  readonly plusLongue: number;
  /** Durée de l'export, en ms. */
  readonly duree: number;
}

export interface ResultatMesures {
  readonly erreur?: string;
  /** `construireArchive` sur l'entrée de T07 déjà en mémoire (compresseurNode). */
  readonly archive?: MesureMemoire;
  /** Trois exports de suite par `construireArchive`, sans relevé de mémoire. */
  readonly taches?: readonly MesureTache[];
  /** `exporterFerme` depuis la base (compresseur par défaut), lecture comprise. */
  readonly ferme?: MesureMemoire & {
    /** Mémoire vivante des lignes lues (toutes les tables exportées, SELECT *), en octets. */
    readonly lignesLues: number;
  };
}

const JOUR = '2026-09-29';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
const NOM_COEUR = '@planif/core';

function ramasser(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error('lancer Node avec --expose-gc');
  gc();
  gc();
}

/** Mémoire vivante, après ramasse-miettes : tas V8 + mémoire externe. */
function vivante(): number {
  ramasser();
  const m = process.memoryUsage();
  return m.heapUsed + m.external;
}

const pause = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** Plus long écart entre deux tours d'une minuterie de 1 ms pendant `f`. */
async function plusLongueTache(f: () => Promise<unknown>): Promise<MesureTache> {
  let dernier = performance.now();
  let plusLongue = 0;
  const minuterie = setInterval(() => {
    const t = performance.now();
    plusLongue = Math.max(plusLongue, t - dernier);
    dernier = t;
  }, 1);
  const debut = performance.now();
  try {
    await f();
  } finally {
    clearInterval(minuterie);
  }
  const fin = performance.now();
  return { plusLongue: Math.max(plusLongue, fin - dernier), duree: fin - debut };
}

type ConstruireArchive = ModuleExport['construireArchive'];

/** Mémoire vivante de ce que `f` rend, tant qu'on le tient. */
function memoireDe(f: () => EntreeExport): number {
  const avant = vivante();
  const tenue = f();
  const n = vivante() - avant;
  if (Object.keys(tenue.tables).length === 0) throw new Error('aucune table lue'); // tient `tenue` jusqu'au relevé
  return n;
}

/** 1 et 2 : `construireArchive` sur une entrée déjà en mémoire (tenue par l'appelant, non comptée). */
async function mesurerArchive(construireArchive: ConstruireArchive, entree: EntreeExport): Promise<{ archive: MesureMemoire; taches: MesureTache[] }> {
  await construireArchive(entree, { date: JOUR, compresseur: compresseurNode }); // échauffement (JIT, tables)
  await pause(50); // laisse zlib relâcher ses tampons
  const avant = vivante();
  let pic = 0;
  let appels = 0;
  const r = await construireArchive(entree, {
    date: JOUR,
    compresseur: compresseurNode,
    avancement: () => {
      appels++;
      pic = Math.max(pic, vivante());
    },
  });
  pic = Math.max(pic, vivante());
  const archive: MesureMemoire = { taille: r.octets.length, pic: pic - avant, appels };

  // Plus longue tâche, trois exports de suite (sans gc forcé).
  const taches: MesureTache[] = [];
  for (let k = 0; k < 3; k++) {
    taches.push(await plusLongueTache(() => construireArchive(entree, { date: JOUR, compresseur: compresseurNode, avancement: () => undefined })));
  }
  return { archive, taches };
}

async function mesurer(): Promise<ResultatMesures> {
  const coeur = (await import(/* @vite-ignore */ NOM_COEUR)) as Partial<ModuleExport>;
  const construireArchive = coeur.construireArchive;
  const tablesExportees = coeur.TABLES_EXPORTEES;
  if (typeof construireArchive !== 'function' || tablesExportees === undefined) {
    return { erreur: '@planif/core n’exporte pas encore construireArchive (T15b)' };
  }
  const exporterFerme = await exigerExporterFerme();

  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const fermeId = jeu.principale.fermeId;
    const lireEntree = (): EntreeExport => {
      const tables: Record<string, LigneLocale[]> = {};
      for (const t of Object.keys(tablesExportees)) tables[t] = base.lireDirect<LigneLocale>(`SELECT * FROM "${t}" ORDER BY id`, []);
      return { fermeId, genereLe: GENERE_LE, tables };
    };

    // 1 et 2. L'entrée n'est tenue que pendant l'appel : relâchée ensuite.
    const { archive, taches } = await mesurerArchive(construireArchive, lireEntree());

    // 3. exporterFerme : lecture de la base comprise, compresseur par défaut.
    await pause(50);
    const lignesLues = memoireDe(lireEntree);

    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> });
    return { archive, taches, ferme: await mesurerFerme(exporterFerme, porte, fermeId, lignesLues) };
  } finally {
    base.fermer();
  }
}

async function mesurerFerme(
  exporterFerme: Awaited<ReturnType<typeof exigerExporterFerme>>,
  porte: ReturnType<typeof creerPorte>,
  fermeId: string,
  lignesLues: number,
): Promise<NonNullable<ResultatMesures['ferme']>> {
  await pause(50);
  const avant = vivante();
  let pic = 0;
  let appels = 0;
  const a = await exporterFerme(porte, {
    fermeId,
    genereLe: GENERE_LE,
    jour: JOUR,
    avancement: () => {
      appels++;
      pic = Math.max(pic, vivante());
    },
  });
  pic = Math.max(pic, vivante());
  return { taille: a.octets.length, pic: pic - avant, appels, lignesLues };
}

let resultat: ResultatMesures;
try {
  resultat = await mesurer();
} catch (e: unknown) {
  resultat = { erreur: e instanceof Error ? `${e.name} : ${e.message}` : String(e) };
}
process.stdout.write(`${JSON.stringify(resultat)}\n`);
