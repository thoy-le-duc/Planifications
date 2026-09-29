/**
 * Archive ZIP (APPNOTE de PKWARE), asynchrone et pure (T15, puis T15b) : noms en UTF-8 (bit 11),
 * CRC-32 calculé pendant l'écriture, même entrée → mêmes octets.
 *
 * Chaque entrée est lue morceau par morceau (texte, octets, ou suite de morceaux), encodée en
 * UTF-8 par blocs de 64 Kio, et passée au compresseur s'il y en a un (deflate brut injecté :
 * `CompressionStream('deflate-raw')` dans le navigateur, node:zlib en test). Le cœur n'a ni Node
 * ni DOM (ni Buffer, ni TextEncoder) : l'UTF-8 est encodé ici.
 *
 * Seuls les octets de l'archive (compressés s'il y a un compresseur) sont gardés jusqu'à la fin ;
 * aucun texte entier ni aucun fichier brut entier n'est tenu.
 */

export type MorceauZip = string | Uint8Array;

export interface FichierZip {
  readonly chemin: string;
  /** Texte, octets, ou suite de morceaux (itérable synchrone ou asynchrone), lue une seule fois. */
  readonly contenu: MorceauZip | Iterable<MorceauZip> | AsyncIterable<MorceauZip>;
}

/** Deflate brut (RFC 1951) en flux : octets bruts d'une entrée → octets compressés. */
export type Compresseur = (brut: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;

export interface OptionsZip {
  /** 'AAAA-MM-JJ' : date DOS de chaque entrée, à 00:00 ; 1980-01-01 par défaut. */
  readonly date?: string;
  /** Absent : entrées stockées (méthode 0). Présent : toutes en deflate (méthode 8). */
  readonly compresseur?: Compresseur;
  /** Annulation : promesse rejetée (`signal.reason`, AbortError) dès l'annulation. */
  readonly signal?: SignalAnnulation;
}

/**
 * Signal d'annulation : le strict nécessaire d'un `AbortSignal`, décrit ici (le cœur n'a pas les
 * types du DOM ni de Node). Un `AbortSignal` s'y range tel quel.
 */
export interface SignalAnnulation {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', ecouteur: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', ecouteur: () => void): void;
}

/** Erreur d'une annulation : `signal.reason`, ou à défaut une Error de nom 'AbortError'. */
export function raisonAnnulation(signal: SignalAnnulation): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const e = new Error('export annulé');
  e.name = 'AbortError';
  return e;
}

/** Lève l'erreur d'annulation si le signal est annulé. */
export function verifierAnnulation(signal: SignalAnnulation | undefined): void {
  if (signal?.aborted === true) throw raisonAnnulation(signal);
}

/**
 * Promesse de `travail`, rejetée dès l'annulation du signal, même si `travail` ne se termine
 * jamais (compresseur bloqué, base qui ne répond pas). Déjà annulé : `travail` n'est pas lancé.
 */
export async function annulable<T>(signal: SignalAnnulation | undefined, travail: () => Promise<T>): Promise<T> {
  if (signal === undefined) return travail();
  verifierAnnulation(signal);
  let ecouteur: () => void = () => undefined;
  const annulation = new Promise<void>((ok) => {
    ecouteur = () => {
      ok();
    };
    signal.addEventListener('abort', ecouteur, { once: true });
  }).then((): never => {
    throw raisonAnnulation(signal);
  });
  try {
    const p = travail();
    p.catch(() => undefined); // après une annulation, son rejet éventuel n'est plus lu
    return await Promise.race([p, annulation]);
  } finally {
    signal.removeEventListener('abort', ecouteur);
  }
}

const EN_TETE_LOCAL = 30;
const EN_TETE_CENTRAL = 46;
const FIN_REPERTOIRE = 22;
/** Version 2.0 : suffisante pour deflate et le bit UTF-8. */
const VERSION = 20;
const DRAPEAU_UTF8 = 0x0800;
const MAX_32 = 0xffffffff;
/** Taille des blocs d'octets bruts passés au compresseur. */
const BLOC = 65_536;
/** Longue chaîne d'un seul tenant : encodée par tranches d'environ ce nombre de caractères. */
const TRANCHE_TEXTE = 16_000;
/** Octets plus courts que ça : recopiés dans le bloc courant plutôt que passés seuls. */
const PETITS_OCTETS = 4_096;
/** Entrées dont le compresseur finit encore pendant qu'on lit les suivantes (chacune tient un contexte deflate). */
const EN_VOL = 8;

let tableCrc: Int32Array | undefined;

/** Table du CRC-32 (polynôme 0xEDB88320), calculée au premier export : rien au chargement du module. */
function crcTable(): Int32Array {
  if (tableCrc !== undefined) return tableCrc;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  tableCrc = t;
  return t;
}

/** CRC-32 en cours (non final) mis à jour avec `octets`. */
function crcSuite(crc: number, octets: Uint8Array): number {
  const t = crcTable();
  let c = crc;
  for (const o of octets) c = (t[(c ^ o) & 0xff] ?? 0) ^ (c >>> 8);
  return c;
}

/**
 * Encodeur UTF-8 par blocs, comme TextEncoder (moitié de paire de substitution isolée → U+FFFD).
 * Les blocs pleins attendent dans `prets` que l'appelant les prenne.
 */
class Encodeur {
  private bloc = new Uint8Array(BLOC);
  private p = 0;
  readonly prets: Uint8Array[] = [];

  private pousser(): void {
    if (this.p === 0) return;
    this.prets.push(this.bloc.subarray(0, this.p));
    this.bloc = new Uint8Array(BLOC);
    this.p = 0;
  }

  texte(texte: string): void {
    const n = texte.length;
    const limite = BLOC - 4;
    let bloc = this.bloc;
    let p = this.p;
    for (let i = 0; i < n; i++) {
      if (p > limite) {
        this.p = p;
        this.pousser();
        bloc = this.bloc;
        p = 0;
      }
      let c = texte.charCodeAt(i);
      if (c < 0x80) {
        bloc[p++] = c;
        continue;
      }
      if (c < 0x800) {
        bloc[p++] = 0xc0 | (c >> 6);
        bloc[p++] = 0x80 | (c & 0x3f);
        continue;
      }
      if (c >= 0xd800 && c <= 0xdfff) {
        const suivant = i + 1 < n ? texte.charCodeAt(i + 1) : 0;
        if (c <= 0xdbff && (suivant & 0xfc00) === 0xdc00) {
          c = 0x10000 + ((c - 0xd800) << 10) + (suivant - 0xdc00);
          i++;
          bloc[p++] = 0xf0 | (c >> 18);
          bloc[p++] = 0x80 | ((c >> 12) & 0x3f);
          bloc[p++] = 0x80 | ((c >> 6) & 0x3f);
          bloc[p++] = 0x80 | (c & 0x3f);
          continue;
        }
        c = 0xfffd;
      }
      bloc[p++] = 0xe0 | (c >> 12);
      bloc[p++] = 0x80 | ((c >> 6) & 0x3f);
      bloc[p++] = 0x80 | (c & 0x3f);
    }
    this.p = p;
  }

  octets(octets: Uint8Array): void {
    if (octets.length <= PETITS_OCTETS) {
      if (this.p + octets.length > BLOC) this.pousser();
      this.bloc.set(octets, this.p);
      this.p += octets.length;
      return;
    }
    this.pousser();
    this.prets.push(octets);
  }

  /** Dernier bloc, recopié à sa taille s'il est petit (il peut rester tenu jusqu'à la fin de l'archive). */
  fin(): void {
    if (this.p === 0) return;
    this.prets.push(this.p < BLOC / 2 ? this.bloc.slice(0, this.p) : this.bloc.subarray(0, this.p));
    this.bloc = new Uint8Array(0);
    this.p = 0;
  }
}

function concatener(parties: readonly Uint8Array[], taille: number): Uint8Array {
  const sortie = new Uint8Array(taille);
  let p = 0;
  for (const b of parties) {
    sortie.set(b, p);
    p += b.length;
  }
  return sortie;
}

/** Octets UTF-8 d'un texte court (noms de fichiers). */
function utf8(texte: string): Uint8Array {
  const e = new Encodeur();
  e.texte(texte);
  e.fin();
  return concatener(
    e.prets,
    e.prets.reduce((n, b) => n + b.length, 0),
  );
}

/** Date DOS (jour à 00:00) : ((année − 1980) << 9) | (mois << 5) | jour. */
function dateDos(jour: string | undefined): number {
  if (jour === undefined) return (1 << 5) | 1;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  const annee = Number(m?.[1]);
  const mois = Number(m?.[2]);
  const j = Number(m?.[3]);
  if (m === null || annee < 1980 || annee > 2107 || mois < 1 || mois > 12 || j < 1 || j > 31) {
    throw new RangeError(`date d’archive invalide : ${jour} (attendu AAAA-MM-JJ, entre 1980 et 2107)`);
  }
  return ((annee - 1980) << 9) | (mois << 5) | j;
}

interface Suivi {
  crc: number;
  taille: number;
  /** Source lue jusqu'au bout (et pas seulement abandonnée par le compresseur). */
  lue: boolean;
}

/** Tranches d'environ `TRANCHE_TEXTE` caractères, jamais coupées au milieu d'une paire de substitution. */
function* tranches(texte: string): Generator<string> {
  const n = texte.length;
  if (n <= TRANCHE_TEXTE) {
    yield texte;
    return;
  }
  let i = 0;
  while (i < n) {
    let j = Math.min(i + TRANCHE_TEXTE, n);
    if (j < n) {
      const c = texte.charCodeAt(j - 1);
      if (c >= 0xd800 && c <= 0xdbff) j--;
    }
    yield texte.slice(i, j);
    i = j;
  }
}

/**
 * Octets bruts d'une entrée, par blocs ; CRC-32 et taille tenus dans `suivi` au fil de la lecture.
 * `fin` est appelé quand la source est épuisée (ou abandonnée).
 */
async function* blocsBruts(contenu: FichierZip['contenu'], suivi: Suivi, signal: SignalAnnulation | undefined, fin: () => void): AsyncGenerator<Uint8Array> {
  try {
    const morceaux: Iterable<MorceauZip> | AsyncIterable<MorceauZip> = typeof contenu === 'string' || contenu instanceof Uint8Array ? [contenu] : contenu;
    const e = new Encodeur();
    const rendre = function* (): Generator<Uint8Array> {
      for (const b of e.prets) {
        suivi.crc = crcSuite(suivi.crc, b);
        suivi.taille += b.length;
        yield b;
      }
      e.prets.length = 0;
    };
    for await (const m of morceaux) {
      verifierAnnulation(signal);
      if (typeof m === 'string') {
        for (const t of tranches(m)) {
          verifierAnnulation(signal);
          e.texte(t);
          if (e.prets.length > 0) yield* rendre();
        }
      } else {
        e.octets(m);
        if (e.prets.length > 0) yield* rendre();
      }
    }
    e.fin();
    yield* rendre();
    suivi.lue = true;
  } finally {
    fin();
  }
}

/** Un morceau gardé jusqu'à la fin : recopié s'il n'occupe qu'une petite part de son tampon. */
function garder(m: Uint8Array): Uint8Array {
  return m.byteLength * 2 < m.buffer.byteLength ? m.slice() : m;
}

interface Compressee {
  readonly donnees: readonly Uint8Array[];
  readonly tailleComp: number;
}

/** Octets d'une entrée tels qu'ils iront dans l'archive (compressés ou non). */
async function collecter(sortie: AsyncIterable<Uint8Array>): Promise<Compressee> {
  const donnees: Uint8Array[] = [];
  let tailleComp = 0;
  for await (const m of sortie) {
    if (m.length === 0) continue;
    donnees.push(garder(m));
    tailleComp += m.length;
  }
  return { donnees, tailleComp };
}

interface Centrale {
  readonly nom: Uint8Array;
  readonly crc: number;
  readonly tailleComp: number;
  readonly taille: number;
  readonly decalage: number;
}

/**
 * Construit une archive ZIP : en-têtes locaux, répertoire central, fin de répertoire.
 * Deux chemins identiques, une archive de plus de 4 Gio, une source que le compresseur n'a pas
 * lue en entier, ou une annulation (`options.signal`) : promesse rejetée.
 */
export async function creerZip(fichiers: readonly FichierZip[], options: OptionsZip = {}): Promise<Uint8Array> {
  return annulable(options.signal, () => construireZip(fichiers, options));
}

async function construireZip(fichiers: readonly FichierZip[], options: OptionsZip): Promise<Uint8Array> {
  const date = dateDos(options.date);
  if (fichiers.length > 0xffff) throw new RangeError('trop de fichiers pour une archive ZIP simple');
  const vus = new Set<string>();
  for (const f of fichiers) {
    if (vus.has(f.chemin)) throw new Error(`chemin en double dans l’archive : ${f.chemin}`);
    vus.add(f.chemin);
  }
  const { compresseur, signal } = options;
  const methode = compresseur === undefined ? 0 : 8;

  // Entrées en chaîne : dès que la source d'une entrée est lue, la suivante commence, pendant que
  // le compresseur finit la précédente (sa dernière étape est asynchrone : sans ce recouvrement,
  // chaque entrée attendrait la sienne). Les sources restent lues une à une, dans l'ordre.
  const travaux: Promise<Compressee>[] = [];
  const suivis: Suivi[] = [];
  const noms: Uint8Array[] = [];
  for (const f of fichiers) {
    const nom = utf8(f.chemin);
    if (nom.length > 0xffff) throw new RangeError(`chemin trop long : ${f.chemin.slice(0, 40)}…`);
    noms.push(nom);
    verifierAnnulation(signal);
    const suivi: Suivi = { crc: -1, taille: 0, lue: false };
    suivis.push(suivi);
    let sourceLue: () => void = () => undefined;
    const finSource = new Promise<void>((ok) => {
      sourceLue = ok;
    });
    const brut = blocsBruts(f.contenu, suivi, signal, () => {
      sourceLue();
    });
    // Sans cette vérification, un compresseur qui s'arrête tôt donnerait une entrée valide mais
    // tronquée (CRC et taille d'un début de fichier seulement).
    const travail = collecter(compresseur === undefined ? brut : compresseur(brut)).then((c) => {
      if (!suivi.lue) throw new Error(`source non lue en entier par le compresseur : ${f.chemin}`);
      return c;
    });
    travail.catch(() => undefined); // rejet lu plus bas ; évite un rejet « non traité » entre-temps
    travaux.push(travail);
    await Promise.race([finSource, travail]);
    const ancien = travaux.length > EN_VOL ? travaux[travaux.length - 1 - EN_VOL] : undefined;
    if (ancien !== undefined) await ancien;
  }
  const compressees = await Promise.all(travaux);
  verifierAnnulation(signal);

  const parties: Uint8Array[] = [];
  const centrales: Centrale[] = [];
  let p = 0;
  compressees.forEach(({ donnees, tailleComp }, k) => {
    const nom = noms[k] ?? new Uint8Array(0);
    const suivi = suivis[k] ?? { crc: -1, taille: 0, lue: true };
    const crc = (suivi.crc ^ -1) >>> 0;
    if (suivi.taille > MAX_32 || p + EN_TETE_LOCAL + nom.length + tailleComp > MAX_32) {
      throw new RangeError('archive de plus de 4 Gio : ZIP64 non pris en charge');
    }
    const local = new Uint8Array(EN_TETE_LOCAL + nom.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, VERSION, true);
    v.setUint16(6, DRAPEAU_UTF8, true);
    v.setUint16(8, methode, true);
    v.setUint16(10, 0, true); // 00:00
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, tailleComp, true);
    v.setUint32(22, suivi.taille, true);
    v.setUint16(26, nom.length, true);
    v.setUint16(28, 0, true);
    local.set(nom, EN_TETE_LOCAL);
    parties.push(local);
    for (const d of donnees) parties.push(d);
    centrales.push({ nom, crc, tailleComp, taille: suivi.taille, decalage: p });
    p += local.length + tailleComp;
  });
  compressees.length = 0;

  // Répertoire central et fin de répertoire.
  const tailleCentral = centrales.reduce((n, c) => n + EN_TETE_CENTRAL + c.nom.length, 0);
  if (p + tailleCentral + FIN_REPERTOIRE > MAX_32) throw new RangeError('archive de plus de 4 Gio : ZIP64 non pris en charge');
  const central = new Uint8Array(tailleCentral + FIN_REPERTOIRE);
  const v = new DataView(central.buffer);
  let q = 0;
  for (const c of centrales) {
    v.setUint32(q, 0x02014b50, true);
    v.setUint16(q + 4, VERSION, true); // créé par : MS-DOS, version 2.0
    v.setUint16(q + 6, VERSION, true);
    v.setUint16(q + 8, DRAPEAU_UTF8, true);
    v.setUint16(q + 10, methode, true);
    v.setUint16(q + 12, 0, true);
    v.setUint16(q + 14, date, true);
    v.setUint32(q + 16, c.crc, true);
    v.setUint32(q + 20, c.tailleComp, true);
    v.setUint32(q + 24, c.taille, true);
    v.setUint16(q + 28, c.nom.length, true);
    // extra, commentaire, disque, attributs internes et externes : 0 (octets déjà nuls).
    v.setUint32(q + 42, c.decalage, true);
    central.set(c.nom, q + EN_TETE_CENTRAL);
    q += EN_TETE_CENTRAL + c.nom.length;
  }
  v.setUint32(q, 0x06054b50, true);
  v.setUint16(q + 8, centrales.length, true);
  v.setUint16(q + 10, centrales.length, true);
  v.setUint32(q + 12, tailleCentral, true);
  v.setUint32(q + 16, p, true);
  parties.push(central);

  const octets = concatener(parties, p + central.length);
  parties.length = 0;
  return octets;
}
