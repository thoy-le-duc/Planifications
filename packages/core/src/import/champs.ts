/**
 * Champs de l'appli par type de contenu, dictionnaire des synonymes d'en-têtes, détection de la
 * ligne d'en-tête et du type de contenu, correspondance des colonnes proposée (T14).
 */
import { cle, texteCellule } from './normalisation.ts';
import type { Cellule, CleChamp, ColonneAssociee, Correspondance, DefinitionChamp, LigneBrute, TypeContenu, UniteColonne } from './types.ts';

const champ = (cleChamp: CleChamp, libelle: string, obligatoire = false): DefinitionChamp => ({ cle: cleChamp, libelle, obligatoire });

/**
 * Champs de l'appli que chaque type de contenu peut remplir (* obligatoire). Construit dans une
 * fonction marquée pure : tant que rien ne le lit, le bundler le retire du démarrage.
 */
export const CHAMPS_IMPORT: Readonly<Record<TypeContenu, readonly DefinitionChamp[]>> = /* @__PURE__ */ (() => ({
  parcellaire: [
    champ('zone', 'Zone', true),
    champ('sous_zone', 'Sous-zone'),
    champ('emplacement', 'Emplacement (planche, rang, gouttière)'),
    champ('sorte', 'Sorte d’emplacement'),
    champ('longueur_m', 'Longueur'),
    champ('largeur_m', 'Largeur'),
    champ('type_abri', 'Type d’abri'),
    champ('surface_m2', 'Surface (m²)'),
    champ('nombre_places', 'Nombre de places'),
  ],
  cultures: [
    champ('espece', 'Culture', true),
    champ('variete', 'Variété'),
    champ('famille', 'Famille botanique'),
    champ('mode', 'Mode d’implantation'),
    champ('duree_pepiniere_jours', 'Durée en pépinière (jours)'),
    champ('duree_avant_recolte_jours', 'Jours avant récolte'),
    champ('fenetre_recolte_jours', 'Fenêtre de récolte (jours)'),
    champ('rangs_par_planche', 'Rangs par planche'),
    champ('ecartement_cm', 'Écartement'),
    champ('disposition', 'Disposition des rangs'),
    champ('poids_mille_graines_g', 'Poids de mille graines'),
  ],
  series: [
    champ('espece', 'Culture', true),
    champ('variete', 'Variété'),
    champ('emplacement', 'Emplacement'),
    champ('date_semis', 'Date de semis'),
    champ('date_plantation', 'Date de plantation'),
    champ('date_debut_recolte', 'Début de récolte'),
    champ('date_fin_recolte', 'Fin de récolte'),
    champ('longueur_m', 'Longueur'),
    champ('nombre_plants', 'Nombre de plants'),
  ],
  assolement: [champ('annee', 'Année', true), champ('zone', 'Zone'), champ('emplacement', 'Emplacement'), champ('famille', 'Famille botanique'), champ('espece', 'Culture')],
}))();

/**
 * Synonymes des en-têtes, comparés par `cle`. « Mètres », « Lieu-dit » et « Semaine de … »
 * restent volontairement inconnus (trop ambigus : c'est à l'utilisateur de les associer).
 * Les suffixes d'unité de l'export T15 (« longueur_m », « poids_mille_graines_g ») sont lus à part.
 */
const SYNONYMES: Readonly<Record<CleChamp, readonly string[]>> = {
  zone: ['zone', 'parcelle', 'ilot', 'bloc', 'field', 'plot', 'zone_id', 'secteur'],
  sous_zone: ['sous-zone', 'chapelle', 'sous-parcelle', 'section', 'sous_zone'],
  emplacement: ['planche', 'n° planche', 'numéro de planche', 'bed', 'rang', 'gouttière', 'emplacement', 'code', 'emplacement_id'],
  sorte: ['sorte', "type d'emplacement"],
  longueur_m: ['longueur', 'long', 'length', 'lg'],
  largeur_m: ['largeur', 'larg', 'width'],
  type_abri: ['abri', "type d'abri", 'cover', 'type_abri'],
  surface_m2: ['surface', 'superficie', 'surface_m2'],
  nombre_places: ['nombre de places', 'nb places', 'places', 'nombre_places'],
  espece: ['culture', 'espèce', 'légume', 'crop', 'espece_id'],
  variete: ['variété', 'variety', 'cultivar', 'variete_id'],
  famille: ['famille', 'famille botanique', 'family', 'famille_id'],
  mode: ['mode', "mode d'implantation", 'implantation'],
  duree_pepiniere_jours: ['durée pépinière', 'durée de pépinière', 'jours en pépinière', 'duree_pepiniere_jours'],
  duree_avant_recolte_jours: ['jours avant récolte', 'durée avant récolte', 'days to maturity', 'duree_avant_recolte_jours'],
  fenetre_recolte_jours: ['fenêtre de récolte', 'durée de récolte', 'harvest window', 'fenetre_recolte_jours'],
  rangs_par_planche: ['rangs', 'rangs/planche', 'rangs par planche', 'nombre de rangs', 'nb rangs', 'rangs_par_planche'],
  ecartement_cm: ['écartement', 'espacement', 'spacing'],
  disposition: ['disposition', 'disposition des rangs'],
  poids_mille_graines_g: ['pmg', 'poids de mille graines', 'poids_mille_graines'],
  date_semis: ['semis', 'date de semis', 'date semis', 'prevu_semis_pepiniere', 'sowing', 'sowing date'],
  date_plantation: ['plantation', 'date de plantation', 'date plantation', 'prevu_mise_en_place', 'planting', 'planting date', 'transplanting'],
  date_debut_recolte: ['début récolte', 'début de récolte', 'récolte', 'prevu_debut_recolte', 'harvest start', 'first harvest'],
  date_fin_recolte: ['fin récolte', 'fin de récolte', 'prevu_fin_recolte', 'harvest end', 'last harvest'],
  nombre_plants: ['nombre de plants', 'nb plants', 'plants', 'nombre_plants'],
  annee: ['année', 'saison', 'year'],
};

/** Longueur au-delà de laquelle un en-tête n'est jamais reconnu (temps linéaire garanti). */
const LONGUEUR_MAX_ENTETE = 200;

/**
 * Unités explicites qu'un en-tête peut porter (liste fermée), par écriture normalisée (casse,
 * accents et points ignorés) → unité canonique. Une unité connue qui ne va pas au champ dit que
 * la colonne n'est pas ce champ : elle n'est pas proposée.
 */
const UNITES_CONNUES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ['m', 'm'],
  ['cm', 'cm'],
  ['mm', 'mm'],
  ['km', 'km'],
  ['g', 'g'],
  ['kg', 'kg'],
  ['t', 't'],
  ['ha', 'ha'],
  ['a', 'a'],
  ['m²', 'm2'],
  ['m2', 'm2'],
  ['j', 'jour'],
  ['jour', 'jour'],
  ['jours', 'jour'],
  ['sem', 'semaine'],
  ['semaine', 'semaine'],
  ['semaines', 'semaine'],
  ['mois', 'mois'],
  ['an', 'an'],
  ['ans', 'an'],
  ['h', 'h'],
  ['nb', 'nb'],
  ['nombre', 'nb'],
  ['graines', 'graines'],
  ['plants', 'plants'],
  ['pieds', 'pieds'],
  ['pouces', 'pouces'],
  ['l', 'l'],
  ['€', 'eur'],
  ['eur', 'eur'],
  ['euros', 'eur'],
  ['%', '%'],
  // Unités anglaises (2e relecture) : les durées en jours ou semaines sont lues ; les autres
  // (pieds, pouces, livres, onces, acres, mois) font ignorer la colonne, jamais mal convertie.
  ['day', 'jour'],
  ['days', 'jour'],
  ['week', 'semaine'],
  ['weeks', 'semaine'],
  ['wk', 'semaine'],
  ['month', 'mois'],
  ['months', 'mois'],
  ['ft', 'ft'],
  ['feet', 'ft'],
  ['in', 'in'],
  ['inch', 'in'],
  ['inches', 'in'],
  ['yd', 'yd'],
  ['lb', 'lb'],
  ['lbs', 'lb'],
  ['oz', 'oz'],
  ['ac', 'acre'],
  ['acre', 'acre'],
  ['acres', 'acre'],
]);

/** Unités qu'un simple espace suffit à détacher du nom (« Longueur m ») : les seules sans ambiguïté. */
const UNITES_SUFFIXE_NU: ReadonlySet<string> = /* @__PURE__ */ new Set(['m', 'cm', 'kg', 'g']);

const MARQUES = /[\u0300-\u036f]/g;

/** Unité canonique d'un texte d'en-tête, ou `null` si ce n'est pas une unité connue. */
function uniteConnue(texte: string): string | null {
  const u = texte.normalize('NFD').replace(MARQUES, '').toLowerCase().replaceAll('.', '').trim();
  return UNITES_CONNUES.get(u) ?? null;
}

/** Unité entre parenthèses, « en » permis devant : « (cm) », « (en cm) ». */
function uniteEntreParentheses(dedans: string): string | null {
  const directe = uniteConnue(dedans);
  if (directe !== null) return directe;
  const t = dedans.trimStart();
  const debut = t.slice(0, 3).toLowerCase();
  return debut === 'en ' || debut === 'en\t' ? uniteConnue(t.slice(3)) : null;
}

/** Unités acceptées par champ : unité canonique → unité rendue (`null` : celle du champ). */
const LONGUEUR: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([
  ['m', 'm'],
  ['cm', 'cm'],
]);
const MASSE: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([
  ['g', 'g'],
  ['kg', 'kg'],
]);
const SURFACE: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([
  ['m2', null],
  ['ha', 'ha'],
]);
const DUREE: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([
  ['jour', null],
  ['semaine', 'semaine'],
]);
/** Dates données en numéros de semaine (« Semis (sem.) »). */
const DATE_SEMAINE: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([['semaine', 'semaine']]);
const COMPTAGE: ReadonlyMap<string, UniteColonne | null> = /* @__PURE__ */ new Map([['nb', null]]);

const UNITES_CHAMP: Partial<Record<CleChamp, ReadonlyMap<string, UniteColonne | null>>> = {
  longueur_m: LONGUEUR,
  largeur_m: LONGUEUR,
  ecartement_cm: LONGUEUR,
  poids_mille_graines_g: MASSE,
  surface_m2: SURFACE,
  duree_pepiniere_jours: DUREE,
  duree_avant_recolte_jours: DUREE,
  fenetre_recolte_jours: DUREE,
  nombre_places: COMPTAGE,
  nombre_plants: COMPTAGE,
  rangs_par_planche: COMPTAGE,
  date_semis: DATE_SEMAINE,
  date_plantation: DATE_SEMAINE,
  date_debut_recolte: DATE_SEMAINE,
  date_fin_recolte: DATE_SEMAINE,
};

/** Une unité de colonne (modèle d'import, correspondance) est-elle acceptée pour ce champ ? */
export function uniteAcceptee(champ: CleChamp, unite: UniteColonne): boolean {
  const permises = UNITES_CHAMP[champ];
  if (permises === undefined) return false;
  for (const u of permises.values()) if (u === unite) return true;
  return false;
}

let dictionnaire: Map<string, CleChamp> | undefined;

/** Clé normalisée → champ ; construit au premier usage (rien au chargement du module). */
function synonymes(): Map<string, CleChamp> {
  if (dictionnaire !== undefined) return dictionnaire;
  const d = new Map<string, CleChamp>();
  for (const [c, liste] of Object.entries(SYNONYMES) as [CleChamp, readonly string[]][]) {
    for (const s of liste) d.set(cle(s), c);
  }
  dictionnaire = d;
  return d;
}

const PREFIXE_NUMERO = /^(?:n|no|nr|num|numero)(?: (?:de|du|d))? (.+)$/;

function sansPrefixe(k: string): string {
  return PREFIXE_NUMERO.exec(k)?.[1] ?? k;
}

function chercher(k: string): CleChamp | undefined {
  if (k === '') return undefined;
  const d = synonymes();
  return d.get(k) ?? d.get(sansPrefixe(k));
}

/**
 * Texte final entre parenthèses ou crochets (« Durée (j) ») : ce qui précède et ce qui est
 * dedans ; `null` s'il n'y en a pas. Un seul parcours depuis la fin.
 */
function parenthesesFinales(t: string): { readonly avant: string; readonly dedans: string } | null {
  const fin = t.length - 1;
  const dernier = t[fin];
  if (dernier !== ')' && dernier !== ']') return null;
  for (let i = fin - 1; i >= 0; i--) {
    const c = t[i];
    if (c === '(' || c === '[') return { avant: t.slice(0, i), dedans: t.slice(i + 1, fin) };
    if (c === ')' || c === ']') return null;
  }
  return null;
}

const estEspace = (c: string | undefined): boolean => c?.trim() === '';

/**
 * Unité en fin d'en-tête hors parenthèses : après « / » (« Plants/m² »), « en » ou « par »
 * (« Longueur en cm »), en suffixe de l'export T15 (« poids_mille_graines_g »), ou après un
 * simple espace pour m, cm, kg, g. Rend la clé de ce qui précède et l'unité canonique.
 */
function uniteFinale(t: string): { readonly base: string; readonly unite: string } | null {
  let i = t.length;
  while (i > 0) {
    const c = t[i - 1];
    if (c === '/' || c === '_' || estEspace(c)) break;
    i--;
  }
  if (i === 0) return null;
  const unite = uniteConnue(t.slice(i));
  if (unite === null) return null;
  let j = i;
  while (j > 0 && estEspace(t[j - 1])) j--;
  const lien = t[j - 1];
  if (lien === '/' || lien === '_') return { base: cle(t.slice(0, j - 1)), unite };
  const k = cle(t.slice(0, j));
  if (k.endsWith(' en')) return { base: k.slice(0, -3), unite };
  if (k.endsWith(' par')) return { base: k.slice(0, -4), unite };
  return UNITES_SUFFIXE_NU.has(unite) ? { base: k, unite } : null;
}

export interface EnteteReconnu {
  readonly champ: CleChamp;
  readonly unite: UniteColonne | null;
}

/**
 * Champ (tous types confondus) et unité d'un en-tête, ou `null` s'il n'est pas reconnu : texte
 * de plus de 200 caractères, synonyme inconnu, ou unité explicite qui ne va pas au champ.
 */
export function reconnaitreEntete(entete: Cellule | undefined): EnteteReconnu | null {
  const brut = texteCellule(entete);
  if (brut === null || brut.length > LONGUEUR_MAX_ENTETE) return null;
  let texte = brut;
  let explicite: string | null = null;
  const parentheses = parenthesesFinales(texte);
  if (parentheses !== null) {
    texte = parentheses.avant;
    explicite = uniteEntreParentheses(parentheses.dedans);
  }
  let c = chercher(cle(texte));
  if (c === undefined && explicite === null) {
    const finale = uniteFinale(texte.trim());
    if (finale !== null) {
      c = chercher(finale.base);
      explicite = finale.unite;
    }
  }
  if (c === undefined) return null;
  if (explicite === null) return { champ: c, unite: null };
  const permises = UNITES_CHAMP[c];
  if (permises?.has(explicite) !== true) return null;
  return { champ: c, unite: permises.get(explicite) ?? null };
}

const LIGNES_ENTETE = 20;

/**
 * Ligne d'en-tête parmi les 20 premières : celle qui a le plus de cellules reconnues (la première
 * à égalité) ; sinon la première qui a au moins deux textes non vides ; `null` si aucune.
 */
export function detecterEntete(lignes: readonly LigneBrute[]): number | null {
  const n = Math.min(lignes.length, LIGNES_ENTETE);
  let meilleure = -1;
  let meilleurScore = 0;
  for (let i = 0; i < n; i++) {
    let score = 0;
    for (const c of lignes[i] ?? []) if (typeof c === 'string' && reconnaitreEntete(c) !== null) score++;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleure = i;
    }
  }
  if (meilleure >= 0) return meilleure;
  for (let i = 0; i < n; i++) {
    let textes = 0;
    for (const c of lignes[i] ?? []) if (typeof c === 'string' && c.trim() !== '') textes++;
    if (textes >= 2) return i;
  }
  return null;
}

const DATES: readonly CleChamp[] = ['date_semis', 'date_plantation', 'date_debut_recolte', 'date_fin_recolte'];
const DESCRIPTION_CULTURE: readonly CleChamp[] = [
  'famille',
  'mode',
  'duree_pepiniere_jours',
  'duree_avant_recolte_jours',
  'fenetre_recolte_jours',
  'rangs_par_planche',
  'ecartement_cm',
  'poids_mille_graines_g',
];

/** Type de contenu d'après les champs reconnus dans les en-têtes ; `null` : l'utilisateur choisit. */
export function proposerType(entetes: readonly Cellule[]): TypeContenu | null {
  const vus = new Set<CleChamp>();
  for (const e of entetes) {
    const r = reconnaitreEntete(e);
    if (r !== null) vus.add(r.champ);
  }
  const date = DATES.some((c) => vus.has(c));
  const lieu = vus.has('zone') || vus.has('emplacement');
  const espece = vus.has('espece');
  const famille = vus.has('famille');
  if (espece && date) return 'series';
  if (vus.has('annee') && lieu && (famille || espece) && !date) return 'assolement';
  if (espece && !lieu && DESCRIPTION_CULTURE.some((c) => vus.has(c))) return 'cultures';
  if (lieu && !espece && !famille) return 'parcellaire';
  return null;
}

const IGNOREE: ColonneAssociee = { champ: null, unite: null };

/** Correspondance proposée : un champ du type par colonne reconnue (la première seulement). */
export function proposerCorrespondance(entetes: readonly Cellule[], type: TypeContenu): Correspondance {
  const permis = new Set<CleChamp>(CHAMPS_IMPORT[type].map((d) => d.cle));
  const pris = new Set<CleChamp>();
  const colonnes = entetes.map((e): ColonneAssociee => {
    const r = reconnaitreEntete(e);
    if (r === null || !permis.has(r.champ) || pris.has(r.champ)) return IGNOREE;
    pris.add(r.champ);
    return { champ: r.champ, unite: r.unite };
  });
  return { type, colonnes };
}
