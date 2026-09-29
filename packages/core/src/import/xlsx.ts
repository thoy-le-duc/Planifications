/**
 * Lecteur de classeur Excel (.xlsx) du moteur d'import (T14), sans dépendance : archive ZIP lue
 * ici, parties compressées décompressées par `DecompressionStream('deflate-raw')` (navigateurs
 * récents, Node ≥ 18), petit lecteur XML pour les seules parties utiles (classeur, relations,
 * chaînes partagées, feuilles).
 *
 * N'est importé NI par `./index.ts` NI par `src/index.ts` : l'appli le charge par `import()` au
 * dépôt d'un .xlsx, hors du JavaScript de démarrage. Contrat : ./test/contrat.ts.
 *
 * Ne rejette jamais : tout ce qui n'est pas un classeur lisible → `classeur_illisible`. Protégé
 * contre les archives piégées : au plus 50 Mo décompressés en tout (bombe de décompression),
 * tailles et positions vérifiées contre la longueur réelle des octets.
 */
import { decoderUtf8 } from './texte.ts';
import type { Cellule, Feuille, LecteurClasseur, ResultatClasseur } from './types.ts';

/** Plafond des octets décompressés, toutes parties comprises. */
const PLAFOND_DECOMPRESSE = 50 * 1024 * 1024;
/** Limites d'Excel : au-delà, la référence de cellule est fausse. */
const LIGNES_MAX = 1_048_576;
const COLONNES_MAX = 16_384;

class Illisible extends Error {}

// ── Flux de décompression (types locaux : le cœur n'a pas les types du DOM) ──────────────────

interface LectureFlux {
  readonly done: boolean;
  readonly value?: Uint8Array;
}
interface LecteurFlux {
  read(): Promise<LectureFlux>;
  cancel(): Promise<void>;
}
interface EcrivainFlux {
  write(morceau: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface FluxDecompression {
  readonly readable: { getReader(): LecteurFlux };
  readonly writable: { getWriter(): EcrivainFlux };
}
type ConstructeurDecompression = new (format: 'deflate-raw') => FluxDecompression;

function constructeurDecompression(): ConstructeurDecompression {
  const c = (globalThis as { readonly DecompressionStream?: ConstructeurDecompression }).DecompressionStream;
  if (c === undefined) throw new Illisible('décompression indisponible sur cet appareil');
  return c;
}

const ignorer = (): void => undefined;

/** Décompresse (deflate brut) sans dépasser `plafond` octets ; au-delà, abandon. */
async function inflater(compresse: Uint8Array, plafond: number): Promise<Uint8Array> {
  const flux = new (constructeurDecompression())('deflate-raw');
  const ecrivain = flux.writable.getWriter();
  const lecteur = flux.readable.getReader();
  // Écriture sans attendre (la lecture fait avancer le flux) ; ses erreurs ressortent à la lecture.
  ecrivain.write(compresse).then(() => ecrivain.close(), ignorer).catch(ignorer);
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.length;
      if (total > plafond) throw new Illisible('partie trop grande une fois décompressée');
      morceaux.push(value);
    }
  } catch (e) {
    lecteur.cancel().catch(ignorer);
    throw e instanceof Illisible ? e : new Illisible('données compressées invalides');
  }
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) {
    sortie.set(m, position);
    position += m.length;
  }
  return sortie;
}

// ── Archive ZIP ──────────────────────────────────────────────────────────────────────────────

interface EntreeZip {
  readonly methode: number;
  readonly drapeaux: number;
  readonly tailleCompressee: number;
  readonly tailleDecompressee: number;
  readonly positionEnTete: number;
}

const SIGNATURE_FIN = 0x06054b50;
const SIGNATURE_CENTRALE = 0x02014b50;
const SIGNATURE_LOCALE = 0x04034b50;

class Archive {
  readonly entrees = new Map<string, EntreeZip>();
  private decompresse = 0;
  private readonly octets: Uint8Array;

  constructor(octets: Uint8Array) {
    this.octets = octets;
    const fin = this.trouverFin();
    const nombre = this.u16(fin + 10);
    const taille = this.u32(fin + 12);
    let p = this.u32(fin + 16);
    if (p + taille > fin) throw new Illisible('répertoire de l’archive incohérent');
    for (let i = 0; i < nombre; i++) {
      if (this.u32(p) !== SIGNATURE_CENTRALE) throw new Illisible('répertoire de l’archive abîmé');
      const drapeaux = this.u16(p + 8);
      const methode = this.u16(p + 10);
      const tailleCompressee = this.u32(p + 20);
      const tailleDecompressee = this.u32(p + 24);
      const longueurNom = this.u16(p + 28);
      const longueurExtra = this.u16(p + 30);
      const longueurCommentaire = this.u16(p + 32);
      const positionEnTete = this.u32(p + 42);
      const nom = this.texte(p + 46, longueurNom);
      this.entrees.set(nom.replace(/^\/+/, ''), { methode, drapeaux, tailleCompressee, tailleDecompressee, positionEnTete });
      p += 46 + longueurNom + longueurExtra + longueurCommentaire;
    }
  }

  private borne(position: number, longueur: number): void {
    if (position < 0 || position + longueur > this.octets.length) throw new Illisible('archive tronquée');
  }

  private u16(p: number): number {
    this.borne(p, 2);
    return (this.octets[p] ?? 0) | ((this.octets[p + 1] ?? 0) << 8);
  }

  private u32(p: number): number {
    this.borne(p, 4);
    return ((this.octets[p] ?? 0) | ((this.octets[p + 1] ?? 0) << 8) | ((this.octets[p + 2] ?? 0) << 16) | ((this.octets[p + 3] ?? 0) << 24)) >>> 0;
  }

  private texte(p: number, n: number): string {
    this.borne(p, n);
    return decoderUtf8(this.octets, p, p + n) ?? '';
  }

  /** Fin du répertoire central : cherchée depuis la fin (commentaire de 64 Kio au plus). */
  private trouverFin(): number {
    const min = Math.max(0, this.octets.length - 22 - 0xffff);
    for (let p = this.octets.length - 22; p >= min; p--) {
      if (this.u32(p) === SIGNATURE_FIN) return p;
    }
    throw new Illisible('ce n’est pas une archive ZIP');
  }

  a(nom: string): boolean {
    return this.entrees.has(nom);
  }

  /** Octets décompressés d'une partie ; plafond global contre les bombes de décompression. */
  async lire(nom: string): Promise<Uint8Array> {
    const e = this.entrees.get(nom);
    if (e === undefined) throw new Illisible(`partie absente : ${nom}`);
    if (e.drapeaux & 0x1) throw new Illisible('classeur chiffré');
    if (this.u32(e.positionEnTete) !== SIGNATURE_LOCALE) throw new Illisible('archive abîmée');
    const debut = e.positionEnTete + 30 + this.u16(e.positionEnTete + 26) + this.u16(e.positionEnTete + 28);
    this.borne(debut, e.tailleCompressee);
    const reste = PLAFOND_DECOMPRESSE - this.decompresse;
    if (e.tailleDecompressee > reste) throw new Illisible('classeur trop grand une fois décompressé');
    // Copie : le flux de décompression ne touche jamais aux octets reçus.
    const compresse = this.octets.slice(debut, debut + e.tailleCompressee);
    let sortie: Uint8Array;
    if (e.methode === 0) sortie = compresse;
    else if (e.methode === 8) sortie = await inflater(compresse, e.tailleDecompressee); // jamais plus que la taille annoncée
    else throw new Illisible('méthode de compression non prise en charge');
    if (sortie.length !== e.tailleDecompressee) throw new Illisible('partie abîmée');
    this.decompresse += sortie.length;
    return sortie;
  }

  async lireTexte(nom: string): Promise<string> {
    const octets = await this.lire(nom);
    const bom = octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf;
    const t = decoderUtf8(octets, bom ? 3 : 0);
    if (t === null) throw new Illisible(`texte illisible : ${nom}`);
    return t;
  }
}

// ── XML ──────────────────────────────────────────────────────────────────────────────────────

type Attributs = ReadonlyMap<string, string>;

interface Rappels {
  ouvrir(nom: string, attributs: Attributs, vide: boolean): void;
  fermer(nom: string): void;
  texte(t: string): void;
}

const ENTITES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decoderEntites(t: string): string {
  if (!t.includes('&')) return t;
  return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (tout, e: string) => {
    if (e.startsWith('#')) {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[e] ?? tout;
  });
}

/** Nom local (sans préfixe d'espace de noms). */
const local = (nom: string): string => nom.slice(nom.indexOf(':') + 1);

const ATTRIBUT = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parcours d'un XML : balises (nom local), attributs (noms tels quels), texte décodé. */
function parcourir(xml: string, r: Rappels): void {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      r.texte(decoderEntites(xml.slice(i)));
      break;
    }
    if (lt > i) r.texte(decoderEntites(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const f = xml.indexOf('-->', lt + 4);
      if (f === -1) throw new Illisible('XML abîmé');
      i = f + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const f = xml.indexOf(']]>', lt + 9);
      if (f === -1) throw new Illisible('XML abîmé');
      r.texte(xml.slice(lt + 9, f));
      i = f + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) throw new Illisible('XML abîmé');
    const contenu = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (contenu.startsWith('?') || contenu.startsWith('!')) continue;
    if (contenu.startsWith('/')) {
      r.fermer(local(contenu.slice(1).trim()));
      continue;
    }
    const vide = contenu.endsWith('/');
    const corps = vide ? contenu.slice(0, -1) : contenu;
    const espace = corps.search(/\s/);
    const nom = local(espace === -1 ? corps : corps.slice(0, espace));
    const attributs = new Map<string, string>();
    if (espace !== -1) {
      for (const m of corps.slice(espace).matchAll(ATTRIBUT)) attributs.set(m[1] ?? '', decoderEntites(m[2] ?? m[3] ?? ''));
    }
    r.ouvrir(nom, attributs, vide);
    if (vide) r.fermer(nom);
  }
}

/** Attribut par nom local (« r:id » → « id » s'il n'y a pas d'« id » sans préfixe). */
function attribut(a: Attributs, nom: string): string | undefined {
  const direct = a.get(nom);
  if (direct !== undefined) return direct;
  for (const [k, v] of a) if (local(k) === nom) return v;
  return undefined;
}

/** Échappements OOXML « _x000D_ » dans les chaînes. */
function decoderOoxml(t: string): string {
  return t.includes('_x') ? t.replace(/_x([0-9a-fA-F]{4})_/g, (_tout, h: string) => String.fromCharCode(Number.parseInt(h, 16))) : t;
}

// ── Parties du classeur ──────────────────────────────────────────────────────────────────────

/** Chemin cible d'une relation, depuis le dossier de la partie source. */
function resoudre(dossier: string, cible: string): string {
  const morceaux = cible.startsWith('/') ? [] : dossier.split('/').filter((m) => m !== '');
  for (const m of cible.split('/')) {
    if (m === '' || m === '.') continue;
    if (m === '..') morceaux.pop();
    else morceaux.push(m);
  }
  return morceaux.join('/');
}

const dossierDe = (chemin: string): string => chemin.slice(0, chemin.lastIndexOf('/') + 1);
const relationsDe = (chemin: string): string => `${dossierDe(chemin)}_rels/${chemin.slice(chemin.lastIndexOf('/') + 1)}.rels`;

async function relations(archive: Archive, source: string): Promise<{ readonly id: Map<string, string>; readonly type: Map<string, string> }> {
  const id = new Map<string, string>();
  const type = new Map<string, string>();
  const chemin = source === '' ? '_rels/.rels' : relationsDe(source);
  if (!archive.a(chemin)) return { id, type };
  parcourir(await archive.lireTexte(chemin), {
    ouvrir(nom, a) {
      if (nom !== 'Relationship') return;
      const cible = a.get('Target');
      if (cible === undefined || a.get('TargetMode') === 'External') return;
      const chemin = resoudre(dossierDe(source), cible);
      const i = a.get('Id');
      if (i !== undefined) id.set(i, chemin);
      const t = a.get('Type');
      if (t !== undefined) type.set(t.slice(t.lastIndexOf('/') + 1), chemin);
    },
    fermer: ignorer,
    texte: ignorer,
  });
  return { id, type };
}

function lireChainesPartagees(xml: string): string[] {
  const chaines: string[] = [];
  let courante: string[] | null = null;
  let dansT = false;
  let phonetique = 0;
  parcourir(xml, {
    ouvrir(nom, _a, vide) {
      if (nom === 'si') courante = [];
      else if (nom === 'rPh') phonetique++;
      else if (nom === 't' && !vide) dansT = true;
    },
    fermer(nom) {
      if (nom === 'si' && courante !== null) {
        chaines.push(decoderOoxml(courante.join('')));
        courante = null;
      } else if (nom === 'rPh') phonetique--;
      else if (nom === 't') dansT = false;
    },
    texte(t) {
      if (dansT && phonetique === 0 && courante !== null) courante.push(t);
    },
  });
  return chaines;
}

/** « B12 » → colonne 1 (A = 0) ; `null` si la référence n'en est pas une. */
function colonneDe(reference: string): number | null {
  let c = 0;
  let i = 0;
  for (; i < reference.length; i++) {
    const code = reference.charCodeAt(i);
    const lettre = code >= 97 && code <= 122 ? code - 32 : code;
    if (lettre < 65 || lettre > 90) break;
    c = c * 26 + (lettre - 64);
  }
  if (i === 0 || i > 3) return null;
  return c - 1;
}

function lireFeuille(xml: string, chaines: readonly string[]): Cellule[][] {
  const lignes: Cellule[][] = [];
  let ligne: Cellule[] | null = null;
  let numeroLigne = 0;
  let colonne = -1;
  let typeCellule = 'n';
  let valeur: string | null = null;
  let enLigne: string[] | null = null;
  let tampon: string[] | null = null;
  let phonetique = 0;

  const cellule = (): Cellule => {
    switch (typeCellule) {
      case 's': {
        if (valeur === null) return null;
        return chaines[Number.parseInt(valeur, 10)] ?? null;
      }
      case 'inlineStr':
        return enLigne === null ? null : decoderOoxml(enLigne.join(''));
      case 'str':
        return valeur === null ? null : decoderOoxml(valeur);
      case 'b':
        return valeur === null ? null : valeur.trim() === '1' ? 'VRAI' : 'FAUX';
      case 'e':
      case 'd':
        return valeur;
      default: {
        if (valeur === null || valeur.trim() === '') return null;
        const n = Number(valeur);
        return Number.isFinite(n) ? n : valeur;
      }
    }
  };

  parcourir(xml, {
    ouvrir(nom, a, vide) {
      switch (nom) {
        case 'row': {
          const r = Number.parseInt(a.get('r') ?? '', 10);
          numeroLigne = Number.isInteger(r) && r > numeroLigne && r <= LIGNES_MAX ? r : numeroLigne + 1;
          if (numeroLigne > LIGNES_MAX) throw new Illisible('trop de lignes');
          while (lignes.length < numeroLigne) lignes.push([]);
          ligne = lignes[numeroLigne - 1] ?? null;
          colonne = -1;
          return;
        }
        case 'c': {
          const ref = a.get('r');
          const c = ref === undefined ? null : colonneDe(ref);
          colonne = c !== null && c > colonne ? c : colonne + 1;
          if (colonne >= COLONNES_MAX) throw new Illisible('trop de colonnes');
          typeCellule = a.get('t') ?? 'n';
          valeur = null;
          enLigne = null;
          return;
        }
        case 'v':
          if (!vide) tampon = [];
          return;
        case 'is':
          enLigne = [];
          return;
        case 'rPh':
          phonetique++;
          return;
        case 't':
          if (!vide && enLigne !== null) tampon = [];
          return;
        default:
          return;
      }
    },
    fermer(nom) {
      switch (nom) {
        case 'v':
          valeur = tampon === null ? null : tampon.join('');
          tampon = null;
          return;
        case 't':
          if (tampon !== null && enLigne !== null && phonetique === 0) enLigne.push(tampon.join(''));
          tampon = null;
          return;
        case 'rPh':
          phonetique--;
          return;
        case 'c': {
          if (ligne === null) {
            numeroLigne++;
            while (lignes.length < numeroLigne) lignes.push([]);
            ligne = lignes[numeroLigne - 1] ?? null;
          }
          const v = cellule();
          if (ligne !== null && v !== null) {
            while (ligne.length < colonne) ligne.push(null);
            ligne[colonne] = v;
          }
          typeCellule = 'n';
          valeur = null;
          enLigne = null;
          return;
        }
        case 'row':
          ligne = null;
          return;
        default:
          return;
      }
    },
    texte(t) {
      if (tampon !== null) tampon.push(t);
    },
  });
  return lignes;
}

async function lireClasseur(octets: Uint8Array): Promise<Feuille[]> {
  const archive = new Archive(octets);
  const racine = await relations(archive, '');
  const classeur = racine.type.get('officeDocument') ?? 'xl/workbook.xml';
  if (!archive.a(classeur)) throw new Illisible('archive sans classeur Excel');
  const liens = await relations(archive, classeur);

  const feuillesDeclarees: { readonly nom: string; readonly chemin: string }[] = [];
  parcourir(await archive.lireTexte(classeur), {
    ouvrir(nom, a) {
      if (nom !== 'sheet') return;
      const id = attribut(a, 'id');
      const chemin = id === undefined ? undefined : liens.id.get(id);
      if (chemin !== undefined) feuillesDeclarees.push({ nom: a.get('name') ?? '', chemin });
    },
    fermer: ignorer,
    texte: ignorer,
  });
  if (feuillesDeclarees.length === 0) throw new Illisible('classeur sans feuille');

  const cheminChaines = liens.type.get('sharedStrings') ?? resoudre(dossierDe(classeur), 'sharedStrings.xml');
  const chaines = archive.a(cheminChaines) ? lireChainesPartagees(await archive.lireTexte(cheminChaines)) : [];

  const feuilles: Feuille[] = [];
  for (const f of feuillesDeclarees) {
    if (!archive.a(f.chemin)) throw new Illisible(`feuille absente : ${f.nom}`);
    feuilles.push({ nom: f.nom, lignes: lireFeuille(await archive.lireTexte(f.chemin), chaines) });
  }
  return feuilles;
}

/** Lecteur des classeurs .xlsx : ne rejette jamais. */
export const lecteurXlsx: LecteurClasseur = {
  async lire(octets: Uint8Array): Promise<ResultatClasseur> {
    try {
      return { ok: true, feuilles: await lireClasseur(octets) };
    } catch (e) {
      const detail = e instanceof Illisible ? ` (${e.message})` : '';
      return { ok: false, code: 'classeur_illisible', message: `Ce fichier n’est pas un classeur Excel lisible${detail}.` };
    }
  },
};
