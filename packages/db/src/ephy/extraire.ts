/**
 * Extraction du catalogue e-phy (T53) : lit les fichiers CSV publiés par l'Anses sur data.gouv.fr
 * (« Données ouvertes du catalogue E-Phy », archive decisionamm-intrant-format-CSV, Licence
 * Ouverte 2.0) et produit le catalogue réduit que l'appli sert en fichier statique
 * (apps/web/public/ephy/catalogue.json). Lancé par le workflow « Catalogue e-phy » ou à la main
 * (./cli.ts), jamais par l'appli.
 *
 * Format lu (vérifié sur la version d'octobre 2020, voir le ticket) : séparateur « ; », champs
 * entre guillemets possibles (guillemets doublés), CRLF, UTF-8 avec ou sans BOM (ou Windows-1252),
 * listes séparées par « | », dates JJ/MM/AAAA, nombres à point. Les colonnes sont repérées par leur
 * nom (sans casse, accents, préfixe « (produit) » ni « _ ») ; une colonne attendue absente lève
 * `ErreurFormatEphy`, qui la nomme.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { LICENCE_EPHY, SOURCE_EPHY, type CatalogueEphy, type DoseEphy, type ProduitEphy, type UsageEphy } from '@planif/core/ephy';

/** Format inattendu (fichier ou colonne absente) : le message dit quoi et où. */
export class ErreurFormatEphy extends Error {}

/** Un produit retiré reste dans le catalogue ce nombre d'années après son retrait (stocks, registre). */
export const RETRAIT_GARDE_ANS = 3;

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────

/** UTF-8 (BOM retiré), sinon Windows-1252 (l'autre variante publiée). */
export function decoderCsv(octets: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

/** CSV « ; » : guillemets, guillemets doublés, retours à la ligne dans un champ, CRLF. */
export function lireCsv(texte: string, separateur = ';'): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let entreGuillemets = false;
  const t = texte.startsWith('\uFEFF') ? texte.slice(1) : texte;
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (entreGuillemets) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          champ += '"';
          i++;
        } else entreGuillemets = false;
      } else champ += c;
    } else if (c === '"' && champ === '') entreGuillemets = true;
    else if (c === separateur) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
    } else champ += c;
  }
  if (champ !== '' || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((v) => v.trim() !== ''));
}

/** Nom de colonne comparable : sans préfixe « (produit) », casse, accents, « _ », apostrophe courbe. */
function cleColonne(nom: string): string {
  return nom
    .replace(/^\uFEFF/, '')
    .replace(/^\s*\([^)]*\)\s*/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type Table<C extends string> = Readonly<Record<C, number>>;

/** Index des colonnes attendues ; `facultatives` peuvent manquer (-1). */
function colonnes<C extends string>(fichier: string, enTete: readonly string[], attendues: Readonly<Record<C, string>>, facultatives: readonly NoInfer<C>[] = []): Table<C> {
  const lues = enTete.map(cleColonne);
  const index = {} as Record<C, number>;
  for (const cleAttendue of Object.keys(attendues) as C[]) {
    const nom = attendues[cleAttendue];
    const i = lues.indexOf(cleColonne(nom));
    if (i < 0 && !facultatives.includes(cleAttendue)) {
      throw new ErreurFormatEphy(`Colonne « ${nom} » introuvable dans ${fichier} (colonnes lues : ${enTete.map((c) => c.trim()).join(' ; ')}). Le format publié par l’Anses a changé : adapter packages/db/src/ephy/extraire.ts.`);
    }
    index[cleAttendue] = i;
  }
  return index;
}

const PRODUITS = {
  type: 'type produit',
  amm: 'numero AMM',
  nom: 'nom produit',
  autresNoms: 'seconds noms commerciaux',
  mentions: 'mentions autorisees',
  substances: 'Substances actives',
  etat: 'Etat d’autorisation',
  retrait: 'Date de retrait du produit',
} as const;

const USAGES = {
  amm: 'numero AMM',
  identifiant: 'identifiant usage',
  etat: 'etat usage',
  dose: 'dose retenue',
  unite: 'dose retenue unite',
  dar: 'delai avant recolte jour',
} as const;

// ── Valeurs ──────────────────────────────────────────────────────────────────────────────────

const normal = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const liste = (t: string): string[] =>
  t
    .split('|')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x !== '');

/** « 01/02/2016 » → « 2016-02-01 » ; vide ou illisible → null. */
function dateIso(t: string): string | null {
  const v = t.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (fr !== null) return `${fr[3] ?? ''}-${fr[2] ?? ''}-${fr[1] ?? ''}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function nombre(t: string): number | null {
  const v = t.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** « spinosad (Spinosad) 480.0 g/L » → « spinosad 480 g/L » (nom anglais retiré, « .0 » retiré, virgule). */
function substance(t: string): string {
  return t
    .replace(/\s*\([^()]*\)/, '')
    .replace(/(\d+)\.0+(?!\d)/g, '$1')
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function dose(valeur: string, unite: string): DoseEphy | null {
  const v = nombre(valeur);
  const u = unite.trim();
  return v === null || v <= 0 || u === '' ? null : { valeur: v, unite: u };
}

function dar(t: string): number | null {
  const v = t.trim();
  return /^\d+(\.0+)?$/.test(v) ? Number.parseInt(v, 10) : null;
}

function usageDe(identifiant: string, d: DoseEphy | null, jours: number | null): UsageEphy | null {
  const parties = identifiant.split('*').map((p) => p.replace(/\s+/g, ' ').trim());
  const culture = parties[0] ?? '';
  if (culture === '' || parties.length < 2) return null;
  return { culture, mode: parties.slice(1, -1).join(' * '), cible: parties[parties.length - 1] ?? '', dose: d, dar: jours };
}

// ── Catalogue ────────────────────────────────────────────────────────────────────────────────

export interface EntreeExtraction {
  /** Contenu du fichier `produits` (déjà décodé). */
  readonly produits: string;
  /** Contenu du fichier `produits_usages` (déjà décodé). */
  readonly usages: string;
  /** 'AAAA-MM-JJ' : date de la base publiée. */
  readonly dateBase: string;
  readonly retraitGardeAns?: number;
}

interface Brouillon {
  readonly produit: Omit<ProduitEphy, 'usages'>;
  readonly usages: UsageEphy[];
  readonly vus: Set<string>;
}

export function extraireCatalogue(e: EntreeExtraction): CatalogueEphy {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dateBase)) throw new ErreurFormatEphy(`Date de la base illisible : « ${e.dateBase} » (attendu AAAA-MM-JJ).`);
  const garde = e.retraitGardeAns ?? RETRAIT_GARDE_ANS;
  const limiteRetrait = `${String(Number(e.dateBase.slice(0, 4)) - garde).padStart(4, '0')}${e.dateBase.slice(4)}`;

  const [enTeteP = [], ...lignesP] = lireCsv(e.produits);
  const cp = colonnes('produits', enTeteP, PRODUITS, ['type', 'autresNoms']);
  const brouillons = new Map<string, Brouillon>();
  const lire = (l: readonly string[], i: number): string => (i < 0 ? '' : (l[i] ?? ''));
  for (const l of lignesP) {
    const amm = lire(l, cp.amm).trim();
    if (amm === '' || brouillons.has(amm)) continue;
    if (cp.type >= 0 && normal(lire(l, cp.type)) !== 'ppp') continue;
    const etat = normal(lire(l, cp.etat));
    const retire = etat.startsWith('retir');
    if (!retire && !etat.startsWith('autoris')) continue;
    const retireLe = retire ? dateIso(lire(l, cp.retrait)) : null;
    if (retire && (retireLe === null || retireLe < limiteRetrait)) continue;
    const mentions = liste(lire(l, cp.mentions)).map(normal);
    brouillons.set(amm, {
      produit: {
        amm,
        nom: lire(l, cp.nom).replace(/\s+/g, ' ').trim(),
        autresNoms: liste(lire(l, cp.autresNoms)),
        substances: [...new Set(liste(lire(l, cp.substances)).map(substance))],
        bio: mentions.includes('utilisable en agriculture biologique'),
        retire,
        retireLe,
      },
      usages: [],
      vus: new Set(),
    });
  }

  const [enTeteU = [], ...lignesU] = lireCsv(e.usages);
  const cu = colonnes('produits_usages', enTeteU, USAGES);
  for (const l of lignesU) {
    const b = brouillons.get(lire(l, cu.amm).trim());
    if (b === undefined) continue;
    if (!b.produit.retire && !normal(lire(l, cu.etat)).startsWith('autoris')) continue;
    const u = usageDe(lire(l, cu.identifiant), dose(lire(l, cu.dose), lire(l, cu.unite)), dar(lire(l, cu.dar)));
    if (u === null) continue;
    const cle = JSON.stringify(u);
    if (b.vus.has(cle)) continue;
    b.vus.add(cle);
    b.usages.push(u);
  }

  const produits = [...brouillons.values()]
    .map((b): ProduitEphy => ({ ...b.produit, usages: b.usages }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.amm.localeCompare(b.amm));
  return { format: 1, source: SOURCE_EPHY, licence: LICENCE_EPHY, dateBase: e.dateBase, produits };
}

// ── Fichiers ─────────────────────────────────────────────────────────────────────────────────

const SUFFIXE = /[_-](v\d+|utf-?8|windows-?1252|cp-?1252|latin-?1|iso-?8859-?1)$/;

function racineNom(nom: string): string {
  let r = basename(nom).toLowerCase().replace(/\.csv$/, '');
  for (let avant = ''; avant !== r; ) {
    avant = r;
    r = r.replace(SUFFIXE, '');
  }
  return r;
}

/** Repère `produits` et `produits_usages` parmi les fichiers de l'archive (UTF-8 préféré). */
export function trouverFichiers(noms: readonly string[]): { readonly produits: string; readonly usages: string } {
  const choisir = (racine: string): string => {
    const candidats = noms.filter((n) => racineNom(n) === racine).sort((a, b) => Number(/utf-?8/i.test(b)) - Number(/utf-?8/i.test(a)));
    const [premier] = candidats;
    if (premier === undefined) throw new ErreurFormatEphy(`Fichier « ${racine} » (.csv) introuvable dans l’archive e-phy (fichiers lus : ${noms.join(', ') || 'aucun'}).`);
    return premier;
  };
  return { produits: choisir('produits'), usages: choisir('produits_usages') };
}

/** Lit le dossier décompressé de l'archive, écrit le catalogue (JSON compact). */
export function ecrireCatalogue(dossier: string, sortie: string, dateBase: string): { readonly produits: number; readonly usages: number; readonly octets: number } {
  const noms = readdirSync(dossier, { recursive: true, encoding: 'utf8' }).filter((n) => n.toLowerCase().endsWith('.csv'));
  const f = trouverFichiers(noms);
  const c = extraireCatalogue({
    produits: decoderCsv(readFileSync(join(dossier, f.produits))),
    usages: decoderCsv(readFileSync(join(dossier, f.usages))),
    dateBase,
  });
  const json = `${JSON.stringify(c)}\n`;
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, json);
  return { produits: c.produits.length, usages: c.produits.reduce((n, p) => n + p.usages.length, 0), octets: Buffer.byteLength(json) };
}
