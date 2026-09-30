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
 * tailles et positions vérifiées contre la longueur réelle des octets ; au plus 5 millions de
 * cases créées pour tout le classeur (vérifié avant d'allouer), chaînes partagées comprises ;
 * chaque partie lue une fois ; balises de 64 Kio au plus, lues en un seul passage (temps
 * linéaire) ; entités XML et échappements OOXML décodés en un balayage, cellule de 32 767
 * caractères au plus une fois décodée (la limite d'Excel).
 */
import { decoderUtf8 } from './texte.ts';
import type { Cellule, Feuille, LecteurClasseur, LigneBrute, ResultatClasseur, SystemeDates } from './types.ts';

/** Plafond des octets décompressés, toutes parties comprises. */
const PLAFOND_DECOMPRESSE = 50 * 1024 * 1024;
/** Plafond des cases créées (lignes, y compris de remplissage, et cellules) pour tout le classeur. */
const PLAFOND_CASES = 5_000_000;
/** Taille maximale d'une balise, de « < » à « > ». */
const BALISE_MAX = 64 * 1024;
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
  /** Parties déjà lues : une partie ne se lit qu'une fois (pas de feuille démultipliée). */
  private readonly lues = new Set<string>();
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
    if (this.lues.has(nom)) throw new Illisible(`partie lue deux fois : ${nom}`);
    this.lues.add(nom);
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
    if (controleInterdit(t)) throw new Illisible(`caractère interdit en XML : ${nom}`);
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

/** Limite d'Excel : une cellule contient au plus 32 767 caractères. */
const CELLULE_MAX = 32_767;
/**
 * Texte brut d'une cellule avant les échappements OOXML : « _x0041_ » (7 caractères) donne un
 * caractère, donc au-delà de 7 × 32 767 caractères la cellule dépasse sûrement la limite.
 */
const TEXTE_MAX = 7 * CELLULE_MAX;

const ENTITES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

const chiffre = (c: number): boolean => c >= 0x30 && c <= 0x39;
const hexa = (c: number): boolean => chiffre(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const lettre = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
/** Caractère de contrôle C0 interdit en XML 1.0 : tous sauf tabulation, LF et CR (et le nul compris). */
const controle = (c: number): boolean => c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;
const moitieHaute = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const moitieBasse = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** Vrai si le texte contient, tel quel, un caractère de contrôle interdit en XML 1.0. */
function controleInterdit(t: string): boolean {
  for (let i = 0; i < t.length; i++) if (controle(t.charCodeAt(i))) return true;
  return false;
}

/** Assemble les morceaux décodés en vérifiant la longueur au fur et à mesure. */
class Sortie {
  private readonly morceaux: string[] = [];
  private longueur = 0;
  private readonly plafond: number;

  constructor(plafond: number) {
    this.plafond = plafond;
  }

  ajouter(t: string): void {
    if (t === '') return;
    this.longueur += t.length;
    if (this.longueur > this.plafond) throw new Illisible('cellule de plus de 32 767 caractères');
    this.morceaux.push(t);
  }

  texte(): string {
    return this.morceaux.length === 1 ? (this.morceaux[0] ?? '') : this.morceaux.join('');
  }
}

/**
 * Entités XML (« &amp; », « &#233; », « &#xE9; ») décodées en un seul balayage (`indexOf`),
 * au plus `plafond` caractères produits (au-delà : illisible, sans aller plus loin). Une entité
 * inconnue ou invalide reste telle quelle.
 */
function decoderEntites(t: string, plafond: number): string {
  let amp = t.indexOf('&');
  if (amp === -1) {
    if (t.length > plafond) throw new Illisible('cellule de plus de 32 767 caractères');
    return t;
  }
  const sortie = new Sortie(plafond);
  let i = 0;
  const n = t.length;
  while (amp !== -1) {
    // Nom ou numéro de l'entité : un seul passage sur des caractères qui ne sont pas « & ».
    let j = amp + 1;
    let remplacement: string | undefined;
    if (t.charCodeAt(j) === 0x23) {
      const x = t.charCodeAt(j + 1) === 0x78 || t.charCodeAt(j + 1) === 0x58;
      j += x ? 2 : 1;
      const debut = j;
      while (j < n && (x ? hexa(t.charCodeAt(j)) : chiffre(t.charCodeAt(j)))) j++;
      if (j > debut && t.charCodeAt(j) === 0x3b) {
        const code = Number.parseInt(t.slice(debut, j), x ? 16 : 10);
        // Pas un caractère XML : nul, ou moitié de paire de substitution (même écrite en deux
        // références) → illisible, jamais un caractère nul ni une paire cassée dans une cellule.
        // Contrôles C0 (hors tabulation, LF, CR) : interdits en XML 1.0, même en référence.
        if (controle(code) || (code >= 0xd800 && code <= 0xdfff)) throw new Illisible('référence à un caractère interdit en XML');
        if (Number.isInteger(code) && code <= 0x10ffff) remplacement = String.fromCodePoint(code);
      }
    } else {
      const debut = j;
      while (j < n && lettre(t.charCodeAt(j))) j++;
      if (j > debut && t.charCodeAt(j) === 0x3b) remplacement = ENTITES.get(t.slice(debut, j));
    }
    if (remplacement !== undefined) {
      sortie.ajouter(t.slice(i, amp));
      sortie.ajouter(remplacement);
      i = j + 1;
    }
    amp = t.indexOf('&', remplacement === undefined ? amp + 1 : i);
  }
  sortie.ajouter(t.slice(i));
  return sortie.texte();
}

/**
 * Échappements OOXML (« _x000D_ » → retour chariot, « _x005F_ » → « _ ») décodés en un seul
 * balayage (`indexOf`) ; plus de 32 767 caractères produits → illisible. Chaque échappement note
 * une unité UTF-16 : une paire complète (« _xD83D__xDE00_ ») est recomposée, un nul ou une moitié
 * de paire seule → illisible, un autre contrôle C0 (hors tabulation, LF, CR) → une espace.
 */
function decoderOoxml(t: string): string {
  let p = t.indexOf('_x');
  if (p === -1) {
    if (t.length > CELLULE_MAX) throw new Illisible('cellule de plus de 32 767 caractères');
    return t;
  }
  const sortie = new Sortie(CELLULE_MAX);
  let i = 0;
  while (p !== -1) {
    const code = uniteOoxml(t, p);
    if (code === -1) {
      p = t.indexOf('_x', p + 1);
      continue;
    }
    sortie.ajouter(t.slice(i, p));
    i = p + 7;
    if (moitieHaute(code)) {
      // Une unité UTF-16 par échappement : une paire complète s'écrit en deux échappements.
      const basse = uniteOoxml(t, i);
      if (!moitieBasse(basse)) throw new Illisible('moitié de paire de substitution seule');
      sortie.ajouter(String.fromCharCode(code, basse));
      i += 7;
    } else if (code === 0 || moitieBasse(code)) {
      throw new Illisible('échappement vers un caractère interdit en XML');
    } else {
      // Contrôle collé depuis Word ou PowerPoint : remplacé par une espace (décision du chef).
      sortie.ajouter(controle(code) ? ' ' : String.fromCharCode(code));
    }
    p = t.indexOf('_x', i);
  }
  sortie.ajouter(t.slice(i));
  return sortie.texte();
}

/** Unité UTF-16 de l'échappement « _xHHHH_ » qui commence en `p`, ou -1 s'il n'y en a pas. */
function uniteOoxml(t: string, p: number): number {
  if (p + 6 >= t.length || t.charCodeAt(p) !== 0x5f || t.charCodeAt(p + 1) !== 0x78 || t.charCodeAt(p + 6) !== 0x5f) return -1;
  for (let k = p + 2; k < p + 6; k++) if (!hexa(t.charCodeAt(k))) return -1;
  return Number.parseInt(t.slice(p + 2, p + 6), 16);
}

/** Nom local (sans préfixe d'espace de noms). */
const local = (nom: string): string => nom.slice(nom.indexOf(':') + 1);

const GUILLEMET = 0x22;
const APOSTROPHE = 0x27;
const SUPERIEUR = 0x3e;

/** Espace XML (espace, tabulation, retours à la ligne). */
const blanc = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * Fin (position du « > ») de la balise qui commence en `lt`, guillemets respectés ; au-delà de
 * 64 Kio, ou sans fin, le XML est illisible. Un seul passage, borné par la taille maximale.
 */
function finDeBalise(xml: string, lt: number): number {
  const limite = Math.min(xml.length, lt + BALISE_MAX);
  let i = lt + 1;
  while (i < limite) {
    const c = xml.charCodeAt(i);
    if (c === SUPERIEUR) return i;
    if (c === GUILLEMET || c === APOSTROPHE) {
      const f = xml.indexOf(c === GUILLEMET ? '"' : "'", i + 1);
      if (f === -1 || f >= limite) break;
      i = f + 1;
      continue;
    }
    i++;
  }
  throw new Illisible(limite < xml.length ? 'balise démesurée' : 'XML abîmé');
}

/** Attributs d'une balise (`corps` après le nom), lus caractère par caractère. */
function lireAttributs(corps: string, depuis: number): Map<string, string> {
  const attributs = new Map<string, string>();
  const n = corps.length;
  let i = depuis;
  for (;;) {
    while (i < n && blanc(corps.charCodeAt(i))) i++;
    if (i >= n) return attributs;
    const debutNom = i;
    while (i < n) {
      const c = corps.charCodeAt(i);
      if (blanc(c) || c === 0x3d) break; // « = »
      i++;
    }
    const nom = corps.slice(debutNom, i);
    while (i < n && blanc(corps.charCodeAt(i))) i++;
    if (corps.charCodeAt(i) !== 0x3d) continue; // nom sans valeur : ignoré
    i++;
    while (i < n && blanc(corps.charCodeAt(i))) i++;
    const q = corps.charCodeAt(i);
    if (q !== GUILLEMET && q !== APOSTROPHE) throw new Illisible('attribut XML sans guillemets');
    const f = corps.indexOf(q === GUILLEMET ? '"' : "'", i + 1);
    if (f === -1) throw new Illisible('attribut XML jamais refermé');
    attributs.set(nom, decoderEntites(corps.slice(i + 1, f), BALISE_MAX));
    i = f + 1;
  }
}

/** Attributs d'une balise qui n'en a pas (partagé, jamais modifié). */
const SANS_ATTRIBUT: Attributs = new Map<string, string>();

/** Parcours d'un XML : balises (nom local), attributs (noms tels quels), texte décodé. */
function parcourir(xml: string, r: Rappels): void {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      r.texte(decoderEntites(xml.slice(i), TEXTE_MAX));
      break;
    }
    if (lt > i) r.texte(decoderEntites(xml.slice(i, lt), TEXTE_MAX));
    if (xml.startsWith('<!--', lt)) {
      const f = xml.indexOf('-->', lt + 4);
      if (f === -1) throw new Illisible('XML abîmé');
      i = f + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const f = xml.indexOf(']]>', lt + 9);
      if (f === -1) throw new Illisible('XML abîmé');
      if (f - lt - 9 > TEXTE_MAX) throw new Illisible('cellule de plus de 32 767 caractères');
      r.texte(xml.slice(lt + 9, f));
      i = f + 3;
      continue;
    }
    const gt = finDeBalise(xml, lt);
    i = gt + 1;
    const premier = xml.charCodeAt(lt + 1);
    if (premier === 0x3f || premier === 0x21) continue; // « ? », « ! »
    if (premier === 0x2f) {
      r.fermer(local(xml.slice(lt + 2, gt).trim()));
      continue;
    }
    // Positions plutôt que morceaux : une balise sans attribut n'alloue que son nom.
    const vide = gt > lt + 1 && xml.charCodeAt(gt - 1) === 0x2f;
    const finCorps = vide ? gt - 1 : gt;
    let espace = lt + 1;
    while (espace < finCorps && !blanc(xml.charCodeAt(espace))) espace++;
    const nom = local(xml.slice(lt + 1, espace));
    r.ouvrir(nom, espace < finCorps ? lireAttributs(xml.slice(espace, finCorps), 0) : SANS_ATTRIBUT, vide);
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

/**
 * Texte brut d'une cellule, morceau par morceau ; plus de `TEXTE_MAX` caractères avant les
 * échappements OOXML → illisible (la cellule dépasserait la limite d'Excel).
 */
class TexteCellule {
  private morceaux: string[] = [];
  private longueur = 0;

  ajouter(t: string): void {
    this.longueur += t.length;
    if (this.longueur > TEXTE_MAX) throw new Illisible('cellule de plus de 32 767 caractères');
    this.morceaux.push(t);
  }

  /** Texte décodé (échappements OOXML), puis remise à zéro. */
  vider(): string {
    if (this.morceaux.length === 0) return '';
    const t = this.morceaux.length === 1 ? (this.morceaux[0] ?? '') : this.morceaux.join('');
    this.morceaux = [];
    this.longueur = 0;
    return decoderOoxml(t);
  }
}

/** Chaînes partagées : chacune (`<si/>` compris) compte pour une case dans le plafond. */
function lireChainesPartagees(xml: string, budget: Budget): string[] {
  const chaines: string[] = [];
  const courante = new TexteCellule();
  let dansSi = false;
  let dansT = false;
  let phonetique = 0;
  parcourir(xml, {
    ouvrir(nom, _a, vide) {
      if (nom === 'si') {
        depenser(budget, 1);
        dansSi = true;
        courante.vider();
      } else if (nom === 'rPh') phonetique++;
      else if (nom === 't' && !vide) dansT = true;
    },
    fermer(nom) {
      if (nom === 'si' && dansSi) {
        chaines.push(courante.vider());
        dansSi = false;
      } else if (nom === 'rPh') phonetique--;
      else if (nom === 't') dansT = false;
    },
    texte(t) {
      if (dansT && phonetique === 0 && dansSi) courante.ajouter(t);
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

/** Cases encore permises pour tout le classeur ; dépenser au-delà rend le classeur illisible. */
interface Budget {
  restant: number;
}

function depenser(budget: Budget, cases: number): void {
  if (cases <= 0) return;
  if (cases > budget.restant) throw new Illisible('classeur trop grand (plus de 5 millions de cases)');
  budget.restant -= cases;
}

/** Ligne vide de remplissage, partagée (rien n'y est jamais écrit). */
const LIGNE_VIDE: LigneBrute = Object.freeze([]);

const DATE_ISO = /^\d{4}-\d{2}-\d{2}(?:T|$)/;

function lireFeuille(xml: string, chaines: readonly string[], budget: Budget): LigneBrute[] {
  const lignes: LigneBrute[] = [];
  let ligne: Cellule[] | null = null;
  /** Ouvre la ligne `numero` (1 = première) : lignes vides de remplissage, puis la ligne elle-même. */
  const ouvrirLigne = (numero: number): Cellule[] => {
    depenser(budget, numero - lignes.length);
    while (lignes.length < numero - 1) lignes.push(LIGNE_VIDE);
    const nouvelle: Cellule[] = [];
    lignes.push(nouvelle);
    return nouvelle;
  };
  let numeroLigne = 0;
  let colonne = -1;
  let typeCellule = 'n';
  let valeur: string | null = null;
  let enLigne: string[] | null = null;
  let tampon: string[] | null = null;
  /** Caractères bruts lus dans la cellule courante (toutes ses balises `<t>` ou `<v>`). */
  let longueurCellule = 0;
  let phonetique = 0;

  /** Valeur d'un `<v>` (nombre, booléen, date, erreur) : 32 767 caractères au plus, comme tout texte de cellule. */
  const bornee = (v: string): string => {
    if (v.length > CELLULE_MAX) throw new Illisible('cellule de plus de 32 767 caractères');
    return v;
  };
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
        return valeur === null ? null : bornee(valeur).trim() === '1' ? 'VRAI' : 'FAUX';
      case 'd':
        // Date ISO « 2027-03-15T00:00:00 » → « 2027-03-15 » ; autre contenu tel quel.
        if (valeur === null) return null;
        return DATE_ISO.test(bornee(valeur)) ? valeur.slice(0, 10) : valeur;
      case 'e':
        return valeur === null ? null : bornee(valeur);
      default: {
        if (valeur === null || bornee(valeur).trim() === '') return null;
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
          ligne = ouvrirLigne(numeroLigne);
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
          longueurCellule = 0;
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
            if (numeroLigne > LIGNES_MAX) throw new Illisible('trop de lignes');
            ligne = ouvrirLigne(numeroLigne);
          }
          const v = cellule();
          if (v !== null) {
            depenser(budget, colonne + 1 - ligne.length);
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
      if (tampon === null) return;
      longueurCellule += t.length;
      if (longueurCellule > TEXTE_MAX) throw new Illisible('cellule de plus de 32 767 caractères');
      tampon.push(t);
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
  let systemeDates: SystemeDates = 1900;
  parcourir(await archive.lireTexte(classeur), {
    ouvrir(nom, a) {
      if (nom === 'workbookPr') {
        const d = (a.get('date1904') ?? '').trim().toLowerCase();
        if (d === '1' || d === 'true') systemeDates = 1904;
        return;
      }
      if (nom !== 'sheet') return;
      const id = attribut(a, 'id');
      const chemin = id === undefined ? undefined : liens.id.get(id);
      if (chemin !== undefined) feuillesDeclarees.push({ nom: a.get('name') ?? '', chemin });
    },
    fermer: ignorer,
    texte: ignorer,
  });
  if (feuillesDeclarees.length === 0) throw new Illisible('classeur sans feuille');
  const parties = new Set<string>();
  for (const f of feuillesDeclarees) {
    if (parties.has(f.chemin)) throw new Illisible('deux feuilles sur la même partie');
    parties.add(f.chemin);
  }

  const cheminChaines = liens.type.get('sharedStrings') ?? resoudre(dossierDe(classeur), 'sharedStrings.xml');
  const budget: Budget = { restant: PLAFOND_CASES };
  const chaines = archive.a(cheminChaines) ? lireChainesPartagees(await archive.lireTexte(cheminChaines), budget) : [];
  const feuilles: Feuille[] = [];
  for (const f of feuillesDeclarees) {
    if (!archive.a(f.chemin)) throw new Illisible(`feuille absente : ${f.nom}`);
    feuilles.push({ nom: f.nom, lignes: lireFeuille(await archive.lireTexte(f.chemin), chaines, budget), systemeDates });
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
