/**
 * Relecture d'une archive ZIP pour les tests de T15 et T15b, indépendante du code de production :
 * répertoire central, en-têtes locaux, CRC-32 et décompression par `node:zlib`, et contrôles
 * croisés par l'outil `unzip` d'Info-ZIP et par le module `zipfile` de Python (présents sur
 * ubuntu-latest et dans le conteneur). Aucune dépendance ajoutée.
 *
 * Aussi `compresseurNode` (T15b) : le `Compresseur` que les tests injectent dans `creerZip` et
 * `construireArchive` (deflate brut en flux par node:zlib), comme l'appli injecte
 * `CompressionStream('deflate-raw')`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32, createDeflateRaw, inflateRawSync } from 'node:zlib';
import type { Compresseur } from '../../../core/src/export/test/contrat.ts';

/** Deflate brut (RFC 1951) en flux, par node:zlib : octets bruts d'une entrée → octets compressés. */
export const compresseurNode: Compresseur = async function* (brut) {
  for await (const morceau of Readable.from(brut).pipe(createDeflateRaw()) as AsyncIterable<Buffer>) {
    yield new Uint8Array(morceau.buffer, morceau.byteOffset, morceau.byteLength);
  }
};

export interface EntreeZip {
  readonly chemin: string;
  readonly methode: number;
  readonly drapeaux: number;
  /** Date DOS décodée, 'AAAA-MM-JJ'. */
  readonly date: string;
  readonly contenu: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;

function erreur(message: string): never {
  throw new Error(`ZIP invalide : ${message}`);
}

/** Lit toute l'archive et vérifie sa cohérence ; lève une erreur « ZIP invalide : … » sinon. */
export function lireZip(octets: Uint8Array): EntreeZip[] {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const u16 = (p: number) => v.getUint16(p, true);
  const u32 = (p: number) => v.getUint32(p, true);

  let fin = -1;
  for (let p = octets.length - 22; p >= Math.max(0, octets.length - 22 - 0xffff); p--) {
    if (u32(p) === SIG_FIN) {
      fin = p;
      break;
    }
  }
  if (fin < 0) erreur('fin du répertoire central introuvable');
  const nombre = u16(fin + 10);
  if (u16(fin + 8) !== nombre) erreur('nombre d’entrées incohérent');
  const tailleCentral = u32(fin + 12);
  const debutCentral = u32(fin + 16);
  if (debutCentral + tailleCentral !== fin) erreur('répertoire central mal placé');
  if (fin + 22 + u16(fin + 20) !== octets.length) erreur('octets après la fin de l’archive');

  const decodeur = new TextDecoder('utf-8', { fatal: true });
  const entrees: EntreeZip[] = [];
  let p = debutCentral;
  for (let i = 0; i < nombre; i++) {
    if (u32(p) !== SIG_CENTRAL) erreur(`entrée centrale ${String(i)} sans signature`);
    const drapeaux = u16(p + 8);
    const methode = u16(p + 10);
    const heureDos = u16(p + 12);
    const dateDos = u16(p + 14);
    const crc = u32(p + 16);
    const tailleComp = u32(p + 20);
    const taille = u32(p + 24);
    const lNom = u16(p + 28);
    const lExtra = u16(p + 30);
    const lComm = u16(p + 32);
    const local = u32(p + 42);
    const chemin = decodeur.decode(octets.subarray(p + 46, p + 46 + lNom));
    p += 46 + lNom + lExtra + lComm;

    if (u32(local) !== SIG_LOCAL) erreur(`${chemin} : en-tête local introuvable`);
    if (u16(local + 6) !== drapeaux || u16(local + 8) !== methode) erreur(`${chemin} : en-tête local différent du central`);
    if (u16(local + 10) !== heureDos || u16(local + 12) !== dateDos) erreur(`${chemin} : date locale différente`);
    const lNomLocal = u16(local + 26);
    if (decodeur.decode(octets.subarray(local + 30, local + 30 + lNomLocal)) !== chemin) erreur(`${chemin} : nom local différent`);
    if ((drapeaux & 0x08) === 0 && (u32(local + 14) !== crc || u32(local + 18) !== tailleComp || u32(local + 22) !== taille)) {
      erreur(`${chemin} : CRC ou tailles locales différents du central`);
    }
    const debut = local + 30 + lNomLocal + u16(local + 28);
    const brut = octets.subarray(debut, debut + tailleComp);
    let contenu: Uint8Array;
    if (methode === 0) contenu = brut;
    else if (methode === 8) contenu = new Uint8Array(inflateRawSync(brut));
    else erreur(`${chemin} : méthode ${String(methode)} non prévue (0 ou 8)`);
    if (contenu.length !== taille) erreur(`${chemin} : taille ${String(contenu.length)} au lieu de ${String(taille)}`);
    if (crc32(contenu) >>> 0 !== crc) erreur(`${chemin} : CRC-32 faux`);

    const date = `${String(1980 + (dateDos >> 9)).padStart(4, '0')}-${String((dateDos >> 5) & 0x0f).padStart(2, '0')}-${String(dateDos & 0x1f).padStart(2, '0')}`;
    entrees.push({ chemin, methode, drapeaux, date, contenu });
  }
  if (p !== fin) erreur('taille du répertoire central incohérente');
  return entrees;
}

/** Contenu d'une entrée décodé en UTF-8 (BOM gardé). */
export function texteZip(entrees: readonly EntreeZip[], chemin: string): string {
  const e = entrees.find((x) => x.chemin === chemin);
  if (e === undefined) throw new Error(`absent de l'archive : ${chemin}`);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(e.contenu);
}

/**
 * Contrôle croisé par Info-ZIP : `unzip -t` (intégrité, CRC) puis `unzip -Z1` (liste des noms).
 * Rend la liste des noms vue par unzip.
 */
export function verifierAvecUnzip(octets: Uint8Array): string[] {
  const dossier = mkdtempSync(join(tmpdir(), 'planif-t15-zip-'));
  try {
    const fichier = join(dossier, 'archive.zip');
    writeFileSync(fichier, octets);
    execFileSync('unzip', ['-tq', fichier], { stdio: 'pipe' });
    const liste = execFileSync('unzip', ['-Z1', fichier], { encoding: 'utf8', stdio: 'pipe' });
    return liste.split('\n').filter((l) => l !== '');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/**
 * Contrôle croisé par Python : `zipfile.ZipFile(...).testzip()` (relit et vérifie le CRC de
 * chaque entrée). Rend la liste des noms vue par Python ; lève une erreur si une entrée est
 * mauvaise.
 */
export function verifierAvecPython(octets: Uint8Array): string[] {
  const dossier = mkdtempSync(join(tmpdir(), 'planif-t15b-zip-'));
  try {
    const fichier = join(dossier, 'archive.zip');
    writeFileSync(fichier, octets);
    const script = [
      'import json, sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      '    mauvais = z.testzip()',
      '    if mauvais is not None: sys.exit("entrée corrompue : " + mauvais)',
      '    print(json.dumps(z.namelist()))',
    ].join('\n');
    const sortie = execFileSync('python3', ['-c', script, fichier], { encoding: 'utf8', stdio: 'pipe' });
    return JSON.parse(sortie) as string[];
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}
