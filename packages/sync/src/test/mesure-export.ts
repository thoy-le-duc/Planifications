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
 *   - plus longue tâche (relecture T15b) = plus grand min(temps mural, temps CPU du fil
 *     principal) entre deux tours d'une minuterie de 1 ms pendant l'export (aucun `gc()` forcé
 *     dans ces tours-là), sur trois exports de suite. Le temps CPU (`process.threadCpuUsage`, à
 *     défaut `process.cpuUsage`) ne compte pas le temps où le système a préempté le processus :
 *     une machine chargée n'allonge plus la mesure, un vrai calcul trop long, si. Le temps mural
 *     seul est gardé pour information (`plusLongueMurale`) ;
 *   - longue chaîne (relecture T15b) : `creerZip` d'un texte de 40 Mio de caractères, donné en
 *     un seul morceau puis en morceaux de ≈ 16 000 caractères ; mémoire relevée par un
 *     compresseur espion (node:zlib) tous les 16 blocs reçus, et à la fin.
 */
import { SCHEMA_LOCAL } from '../schema.ts';
import { creerPorte } from '../porte.ts';
import type { Compresseur, EntreeExport, LigneLocale, ModuleExport } from '../../../core/src/export/test/contrat.ts';
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
  /** Plus long calcul entre deux tours de la boucle d'événements : max de min(mural, CPU du fil), en ms. */
  readonly plusLongue: number;
  /** Plus long écart MURAL entre deux tours (préemption par le système comprise), en ms ; pour information. */
  readonly plusLongueMurale: number;
  /** Durée MURALE de l'export, en ms ; pour information (T19). */
  readonly duree: number;
  /**
   * Durée de calcul de l'export (T19), en ms : min(mural, temps CPU du PROCESSUS). Le processus
   * (ce script) ne fait que l'export pendant la mesure ; son temps CPU compte aussi les fils de
   * node:zlib (compresseurNode) et du ramasse-miettes, que le CPU du fil seul oublierait. Une
   * machine chargée allonge le temps mural, pas le temps CPU ; le min écarte le CPU des fils
   * parallèles qui se chevauchent (jamais plus que le temps réellement attendu).
   */
  readonly calcul: number;
}

export interface ResultatMesures {
  readonly erreur?: string;
  /** Relecture T15b : `creerZip` d'un texte de 40 Mio, en un morceau puis en morceaux (compresseurNode). */
  readonly chaine?: { readonly unMorceau: MesureMemoire; readonly morceaux: MesureMemoire };
  readonly erreurChaine?: string;
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

/** Temps CPU en ms : du fil principal seul si Node le sait (≥ 22.19 / 23.9), sinon du processus. */
const cpuMs: () => number = (() => {
  const p = process as { threadCpuUsage?: () => NodeJS.CpuUsage };
  const lire = p.threadCpuUsage?.bind(process) ?? (() => process.cpuUsage());
  return () => {
    const u = lire();
    return (u.user + u.system) / 1000;
  };
})();

/** Temps CPU du processus entier (tous fils : zlib, ramasse-miettes), en ms. */
function cpuProcessusMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}

/**
 * Plus long calcul entre deux tours d'une minuterie de 1 ms pendant `f` : pour chaque intervalle,
 * min(temps mural, temps CPU). Préempté par le système : mural long, CPU court → ne compte pas.
 * Calcul synchrone long : mural et CPU longs tous les deux → compte.
 */
async function plusLongueTache(f: () => Promise<unknown>): Promise<MesureTache> {
  let dernier = performance.now();
  let dernierCpu = cpuMs();
  let plusLongue = 0;
  let plusLongueMurale = 0;
  const releve = () => {
    const t = performance.now();
    const c = cpuMs();
    plusLongue = Math.max(plusLongue, Math.min(t - dernier, c - dernierCpu));
    plusLongueMurale = Math.max(plusLongueMurale, t - dernier);
    dernier = t;
    dernierCpu = c;
  };
  const minuterie = setInterval(releve, 1);
  const debut = performance.now();
  const debutCpu = cpuProcessusMs();
  try {
    await f();
  } finally {
    clearInterval(minuterie);
  }
  releve();
  const cpu = cpuProcessusMs() - debutCpu;
  const duree = performance.now() - debut;
  return { plusLongue, plusLongueMurale, duree, calcul: Math.min(duree, cpu) };
}

/** 40 Mio de caractères de CSV, en morceaux d'environ 16 000 caractères (des lignes entières). */
function texteLongEnMorceaux(): string[] {
  const cible = 40 * 1_048_576;
  const morceaux: string[] = [];
  let courant: string[] = [];
  let tailleCourant = 0;
  let total = 0;
  for (let i = 0; total < cible; i++) {
    const l = `${String(i)};${String((i * 7919) % 100_003)};note « ${String(i % 97)} »\r\n`;
    courant.push(l);
    tailleCourant += l.length;
    total += l.length;
    if (tailleCourant >= 16_000) {
      morceaux.push(courant.join(''));
      courant = [];
      tailleCourant = 0;
    }
  }
  if (courant.length > 0) morceaux.push(courant.join(''));
  return morceaux;
}

/** Mémoire ajoutée au pic par `creerZip` d'une seule entrée (relevés par un compresseur espion). */
async function memoireZip(creerZip: ModuleExport['creerZip'], contenu: string | readonly string[]): Promise<MesureMemoire> {
  await pause(50);
  const avant = vivante();
  let pic = 0;
  let appels = 0;
  let blocs = 0;
  const espion: Compresseur = (brut) =>
    compresseurNode(
      (async function* () {
        for await (const b of brut) {
          if (blocs++ % 16 === 0) {
            appels++;
            pic = Math.max(pic, vivante());
          }
          yield b;
        }
      })(),
    );
  const zip = await creerZip([{ chemin: 'long.csv', contenu }], { compresseur: espion });
  pic = Math.max(pic, vivante());
  return { taille: zip.length, pic: pic - avant, appels };
}

/** Longue chaîne : en morceaux d'abord (référence), puis la même en un seul morceau. */
async function mesurerChaine(creerZip: ModuleExport['creerZip']): Promise<NonNullable<ResultatMesures['chaine']>> {
  const morceaux = texteLongEnMorceaux();
  await creerZip([{ chemin: 'echauffement.csv', contenu: morceaux.slice(0, 50) }], { compresseur: compresseurNode });
  const enMorceaux = await memoireZip(creerZip, morceaux);
  const unMorceau = await memoireZip(creerZip, morceaux.join(''));
  return { unMorceau, morceaux: enMorceaux };
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
  // Longue chaîne d'abord, avant que la ferme de T07 n'occupe le tas ; son échec n'empêche pas le reste.
  let chaine: Pick<ResultatMesures, 'chaine' | 'erreurChaine'>;
  try {
    if (typeof coeur.creerZip !== 'function') throw new Error('@planif/core n’exporte pas creerZip');
    chaine = { chaine: await mesurerChaine(coeur.creerZip) };
  } catch (e: unknown) {
    chaine = { erreurChaine: e instanceof Error ? `${e.name} : ${e.message}` : String(e) };
  }
  const construireArchive = coeur.construireArchive;
  const tablesExportees = coeur.TABLES_EXPORTEES;
  if (typeof construireArchive !== 'function' || tablesExportees === undefined) {
    return { ...chaine, erreur: '@planif/core n’exporte pas encore construireArchive (T15b)' };
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
    return { ...chaine, archive, taches, ferme: await mesurerFerme(exporterFerme, porte, fermeId, lignesLues) };
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
