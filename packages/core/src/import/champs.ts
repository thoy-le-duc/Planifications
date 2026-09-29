/**
 * Champs de l'appli par type de contenu, dictionnaire des synonymes d'en-têtes, détection de la
 * ligne d'en-tête et du type de contenu, correspondance des colonnes proposée (T14).
 */
import { cle, estUnite, grandeur, texteCellule } from './normalisation.ts';
import type { Cellule, CleChamp, ColonneAssociee, Correspondance, DefinitionChamp, LigneBrute, TypeContenu, UniteMesure } from './types.ts';

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
  poids_mille_graines_g: ['pmg', 'poids de mille graines', 'poids_mille_graines'],
  date_semis: ['semis', 'date de semis', 'date semis', 'prevu_semis_pepiniere'],
  date_plantation: ['plantation', 'date de plantation', 'date plantation', 'prevu_mise_en_place'],
  date_debut_recolte: ['début récolte', 'début de récolte', 'récolte', 'prevu_debut_recolte'],
  date_fin_recolte: ['fin récolte', 'fin de récolte', 'prevu_fin_recolte'],
  nombre_plants: ['nombre de plants', 'nb plants', 'plants', 'nombre_plants'],
  annee: ['année', 'saison', 'year'],
};

/** Champs mesurés : l'unité de l'en-tête ne vaut que si elle est de leur grandeur. */
const GRANDEUR_CHAMP: Partial<Record<CleChamp, 'longueur' | 'masse'>> = {
  longueur_m: 'longueur',
  largeur_m: 'longueur',
  ecartement_cm: 'longueur',
  poids_mille_graines_g: 'masse',
};

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

const ENTRE_PARENTHESES = /\s*[([]([^()[\]]*)[)\]]\s*$/;
const UNITE_APRES_EN = /^(.+) en (m|cm|kg|g)$/;
const UNITE_SUFFIXE = /^(.+) (m|cm|kg|g)$/;
const PREFIXE_NUMERO = /^(?:n|no|nr|num|numero)(?: (?:de|du|d))? (.+)$/;

export interface EnteteReconnu {
  readonly champ: CleChamp;
  readonly unite: UniteMesure | null;
}

/** Champ (tous types confondus) et unité d'un en-tête, ou `null` s'il n'est pas reconnu. */
export function reconnaitreEntete(entete: Cellule | undefined): EnteteReconnu | null {
  const brut = texteCellule(entete);
  if (brut === null) return null;
  const d = synonymes();
  let texte = brut;
  let unite: string | null = null;
  const parentheses = ENTRE_PARENTHESES.exec(texte);
  if (parentheses !== null) {
    texte = texte.slice(0, parentheses.index);
    unite = cle(parentheses[1] ?? '');
  }
  let k = cle(texte);
  if (k === '') return null;
  if (unite === null) {
    const en = UNITE_APRES_EN.exec(k) ?? UNITE_SUFFIXE.exec(k);
    const base = en?.[1];
    if (en !== null && base !== undefined && (d.has(base) || d.has(sansPrefixe(base)))) {
      k = base;
      unite = en[2] ?? null;
    }
  }
  const c = d.get(k) ?? d.get(sansPrefixe(k));
  if (c === undefined) return null;
  const g = GRANDEUR_CHAMP[c];
  const u = unite !== null && estUnite(unite) && g !== undefined && grandeur(unite) === g ? unite : null;
  return { champ: c, unite: u };
}

function sansPrefixe(k: string): string {
  return PREFIXE_NUMERO.exec(k)?.[1] ?? k;
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
