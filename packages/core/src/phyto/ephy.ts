/**
 * Catalogue e-phy (T53) : la base publique des produits phytopharmaceutiques de l'Anses, réduite
 * à ce que la fiche produit de la ferme (T52) reprend. Pur : ni réseau, ni horloge.
 *
 * Exporté par `@planif/core/ephy` seulement, jamais par l'index du cœur : rien du catalogue au
 * démarrage de l'appli. Le catalogue est produit par `packages/db/src/ephy/extraire.ts`.
 *
 * Correspondance espèce → usage : une table courte et explicite (tomate, fraise, laitue, et les
 * cultures de la ferme de Théophane), sur les noms du catalogue de 2026 (T75). Aucune devinette :
 * une espèce inconnue ne correspond qu'à l'usage qui porte son nom. Le DAR n'est proposé que si tous les usages retenus sont d'accord ;
 * sinon l'utilisateur choisit l'usage (règle 2 du ticket).
 */

export interface DoseEphy {
  readonly valeur: number;
  readonly unite: string;
}

/** Un usage autorisé : culture × cible (et mode d'application), dose retenue, DAR en jours. */
export interface UsageEphy {
  readonly culture: string;
  readonly mode: string;
  readonly cible: string;
  readonly dose: DoseEphy | null;
  /** Délai avant récolte en jours ; null quand e-phy ne le donne pas en jours (stade BBCH, ou rien). */
  readonly dar: number | null;
}

export interface ProduitEphy {
  readonly amm: string;
  readonly nom: string;
  readonly autresNoms: readonly string[];
  readonly substances: readonly string[];
  /** Mention « Utilisable en agriculture biologique ». */
  readonly bio: boolean;
  readonly retire: boolean;
  /** 'AAAA-MM-JJ', ou null (autorisé, ou date de retrait absente). */
  readonly retireLe: string | null;
  readonly usages: readonly UsageEphy[];
}

export interface CatalogueEphy {
  readonly format: 1;
  readonly source: string;
  readonly licence: string;
  /** 'AAAA-MM-JJ' : date de la base e-phy publiée ; null pour le catalogue initial, vide. */
  readonly dateBase: string | null;
  readonly produits: readonly ProduitEphy[];
}

export const SOURCE_EPHY = 'E-Phy, Anses — « Données ouvertes du catalogue E-Phy », data.gouv.fr';
export const LICENCE_EPHY = 'Licence Ouverte 2.0 (Etalab)';

// ── Validation ───────────────────────────────────────────────────────────────────────────────

type Objet = Readonly<Record<string, unknown>>;
const estObjet = (x: unknown): x is Objet => typeof x === 'object' && x !== null && !Array.isArray(x);
const estTexte = (x: unknown): x is string => typeof x === 'string';
const estDate = (x: unknown): x is string => estTexte(x) && /^\d{4}-\d{2}-\d{2}$/.test(x);
const textes = (x: unknown): x is readonly string[] => Array.isArray(x) && x.every(estTexte);

function dose(x: unknown): DoseEphy | null | undefined {
  if (x === null) return null;
  if (!estObjet(x) || typeof x.valeur !== 'number' || !Number.isFinite(x.valeur) || !estTexte(x.unite)) return undefined;
  return { valeur: x.valeur, unite: x.unite };
}

function usage(x: unknown): UsageEphy | null {
  if (!estObjet(x) || !estTexte(x.culture) || !estTexte(x.mode) || !estTexte(x.cible)) return null;
  const d = dose(x.dose);
  if (d === undefined) return null;
  const dar = x.dar;
  if (dar !== null && (typeof dar !== 'number' || !Number.isInteger(dar) || dar < 0)) return null;
  return { culture: x.culture, mode: x.mode, cible: x.cible, dose: d, dar };
}

function produit(x: unknown): ProduitEphy | null {
  if (!estObjet(x) || !estTexte(x.amm) || !estTexte(x.nom) || !textes(x.autresNoms) || !textes(x.substances)) return null;
  if (typeof x.bio !== 'boolean' || typeof x.retire !== 'boolean' || !(x.retireLe === null || estDate(x.retireLe)) || !Array.isArray(x.usages)) return null;
  const usages: UsageEphy[] = [];
  for (const brut of x.usages as readonly unknown[]) {
    const u = usage(brut);
    if (u === null) return null;
    usages.push(u);
  }
  return { amm: x.amm, nom: x.nom, autresNoms: [...x.autresNoms], substances: [...x.substances], bio: x.bio, retire: x.retire, retireLe: x.retireLe, usages };
}

/** Le catalogue s'il a la forme attendue (format 1), sinon null. */
export function validerCatalogueEphy(x: unknown): CatalogueEphy | null {
  if (!estObjet(x) || x.format !== 1 || !estTexte(x.source) || !estTexte(x.licence) || !(x.dateBase === null || estDate(x.dateBase)) || !Array.isArray(x.produits)) return null;
  const produits: ProduitEphy[] = [];
  for (const brut of x.produits as readonly unknown[]) {
    const p = produit(brut);
    if (p === null) return null;
    produits.push(p);
  }
  return { format: 1, source: x.source, licence: x.licence, dateBase: x.dateBase, produits };
}

// ── Recherche ────────────────────────────────────────────────────────────────────────────────

/** Minuscules, sans accents, espaces simples. */
export function normaliserEphy(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un produit trouvé, avec l'usage qui l'a fait trouver quand c'est par une culture ou une cible (T84). */
export interface ResultatEphy {
  readonly produit: ProduitEphy;
  /** Premier usage (ordre du catalogue) qui répond à la recherche ; null si trouvé par nom, AMM ou substance seulement. */
  readonly usage: UsageEphy | null;
  /** Nombre d'autres usages qui répondent aussi à la recherche. */
  readonly usagesEnPlus: number;
}

interface UsageIndexe {
  readonly usage: UsageEphy;
  /** Culture e-phy normalisée (sans accents ni majuscules). */
  readonly culture: string;
  /** Clé de comparaison de la culture, celle des correspondances espèce → culture. */
  readonly cleCulture: string;
  readonly cible: string;
}

interface ProduitIndexe {
  readonly produit: ProduitEphy;
  /** Noms normalisés (nom et seconds noms). */
  readonly noms: readonly string[];
  /** Nom, seconds noms, AMM et substances normalisés, mis bout à bout. */
  readonly tout: string;
  readonly usages: readonly UsageIndexe[];
}

/** Produits indexés par tranches : l'index d'un catalogue est complet quand il a autant de produits que lui. */
const indexes = new WeakMap<CatalogueEphy, ProduitIndexe[]>();

/** Produits indexés par tranche : assez petite pour qu'une tranche tienne bien sous 50 ms à froid. */
export const TRANCHE_INDEX_EPHY = 50;

function indexerProduit(produit: ProduitEphy): ProduitIndexe {
  const noms = [produit.nom, ...produit.autresNoms].map(normaliserEphy);
  return {
    produit,
    noms,
    tout: [...noms, produit.amm, ...produit.substances.map(normaliserEphy)].join(' | '),
    usages: produit.usages.map((usage) => ({ usage, culture: normaliserEphy(usage.culture), cleCulture: cle(usage.culture), cible: normaliserEphy(usage.cible) })),
  };
}

/**
 * Indexe (normalise) au plus `taille` produits de plus du catalogue, et rend true quand l'index
 * est complet. L'appelant rend la main entre deux tranches : aucune tâche longue sur le fil
 * principal (T84). Le cœur n'a ni minuterie ni horloge : la tranche se compte en produits.
 */
export function indexerTrancheEphy(catalogue: CatalogueEphy, taille = TRANCHE_INDEX_EPHY): boolean {
  let index = indexes.get(catalogue);
  if (index === undefined) {
    index = [];
    indexes.set(catalogue, index);
  }
  const fin = Math.min(catalogue.produits.length, index.length + taille);
  for (let i = index.length; i < fin; i++) {
    const p = catalogue.produits[i];
    if (p !== undefined) index.push(indexerProduit(p));
  }
  return index.length >= catalogue.produits.length;
}

/** L'index complet ; termine d'un coup ce que les tranches n'ont pas fait (appel direct, sans écran). */
function indexer(catalogue: CatalogueEphy): readonly ProduitIndexe[] {
  while (!indexerTrancheEphy(catalogue, Number.MAX_SAFE_INTEGER));
  return indexes.get(catalogue) ?? [];
}

/** Un mot de la recherche, ou une suite de mots qui forme un nom d'espèce (« chou rouge »). */
interface Unite {
  readonly mot: string;
  /** Cultures e-phy précises pour cette espèce (clés de comparaison). */
  readonly precises: ReadonlySet<string>;
  /** Cultures génériques (« Cultures légumières ») : valables, mais après les précises. */
  readonly generiques: ReadonlySet<string>;
}

function unite(mot: string): Unite {
  const cultures = culturesEphyPourEspece(mot);
  const generique = cle(LEGUMIERES);
  const cles = cultures.map(cle);
  return { mot, precises: new Set(cles.filter((c) => c !== generique)), generiques: new Set(cles.filter((c) => c === generique)) };
}

/** Découpe la recherche : les suites de 3 puis 2 mots qui sont une espèce connue comptent pour un seul mot. */
function unites(mots: readonly string[]): Unite[] {
  const r: Unite[] = [];
  for (let i = 0; i < mots.length; ) {
    let pris = 1;
    for (const n of [3, 2]) {
      if (i + n <= mots.length && especeConnue(mots.slice(i, i + n).join(' '))) {
        pris = n;
        break;
      }
    }
    r.push(unite(mots.slice(i, i + pris).join(' ')));
    i += pris;
  }
  return r;
}

/** 0 : l'usage répond précisément à l'unité ; 1 : seulement par une culture générique ; null : ne répond pas. */
function rang(u: UsageIndexe, m: Unite): 0 | 1 | null {
  if (m.precises.has(u.cleCulture) || u.culture.includes(m.mot) || u.cible.includes(m.mot)) return 0;
  return m.generiques.has(u.cleCulture) ? 1 : null;
}

/** Note d'un usage pour les unités restantes (somme des rangs), null s'il ne répond pas à toutes. */
function note(u: UsageIndexe, restants: readonly Unite[]): number | null {
  let total = 0;
  for (const m of restants) {
    const r = rang(u, m);
    if (r === null) return null;
    total += r;
  }
  return total;
}

/**
 * Recherche e-phy (T53, T84). Chaque mot tapé (2 lettres au moins pour l'ensemble) correspond au
 * nom, à l'AMM ou à la substance du produit, qui vaut alors pour tous ses usages, ou à la culture
 * ou à la cible d'un usage ; les mots restants doivent tomber sur un MÊME usage. Une espèce, en
 * un ou plusieurs mots (« chou rouge »), est traduite en cultures e-phy (`culturesEphyPourEspece`).
 * Ordre : autorisés d'abord, puis usage précis avant usage générique (« Tomate - Aubergine » avant
 * « Cultures légumières »), puis nom qui commence par la recherche, puis alphabétique. L'usage
 * rendu est le plus précis de ceux qui répondent. `autres` : produits trouvés au-delà de `max`.
 */
export function rechercherEphy(catalogue: CatalogueEphy, texte: string, max = 8): { readonly resultats: ResultatEphy[]; readonly autres: number } {
  const t = normaliserEphy(texte);
  if (t.length < 2) return { resultats: [], autres: 0 };
  const mots = unites(t.split(' '));
  const trouves: { readonly r: ResultatEphy; readonly note: number; readonly debut: boolean }[] = [];
  for (const p of indexer(catalogue)) {
    const restants = mots.filter((m) => !p.tout.includes(m.mot));
    let r: ResultatEphy | null = null;
    let meilleure = 0;
    if (restants.length === 0) r = { produit: p.produit, usage: null, usagesEnPlus: 0 };
    else {
      let premier: UsageIndexe | null = null;
      let nb = 0;
      for (const u of p.usages) {
        const n = note(u, restants);
        if (n === null) continue;
        nb++;
        if (premier === null || n < meilleure) {
          premier = u;
          meilleure = n;
        }
      }
      if (premier !== null) r = { produit: p.produit, usage: premier.usage, usagesEnPlus: nb - 1 };
    }
    if (r !== null) trouves.push({ r, note: meilleure, debut: p.noms.some((n) => n.startsWith(t)) });
  }
  trouves.sort(
    (a, b) =>
      Number(a.r.produit.retire) - Number(b.r.produit.retire) ||
      a.note - b.note ||
      Number(b.debut) - Number(a.debut) ||
      a.r.produit.nom.localeCompare(b.r.produit.nom, 'fr'),
  );
  return { resultats: trouves.slice(0, max).map((x) => x.r), autres: Math.max(0, trouves.length - max) };
}

/** Les produits de `rechercherEphy` (au plus `max`), sans l'usage trouvé. */
export function chercherProduitsEphy(catalogue: CatalogueEphy, texte: string, max = 8): ProduitEphy[] {
  return rechercherEphy(catalogue, texte, max).resultats.map((r) => r.produit);
}

// ── Espèce → usage ───────────────────────────────────────────────────────────────────────────

const LEGUMIERES = 'Cultures légumières';
const TOMATE_AUBERGINE = 'Tomate - Aubergine';
const PEAU_COMESTIBLE = 'Cucurbitacées à peau comestible';
const PEAU_NON_COMESTIBLE = 'Cucurbitacées à peau non comestible';
const CHOUX = 'Choux';
const LAITUE = ['Laitue', LEGUMIERES] as const;
const POMMES = ['Choux pommés', CHOUX, LEGUMIERES] as const;
const FEUILLUS = ['Choux feuillus', CHOUX, LEGUMIERES] as const;
const INFLORESCENCE = ['Choux à inflorescence', CHOUX, LEGUMIERES] as const;
const NON_ECOSSES = ['Haricots et pois non écossés frais', LEGUMIERES] as const;
const COURGES = [PEAU_NON_COMESTIBLE, LEGUMIERES] as const;

/**
 * Formes de 2020 (base sur laquelle T53 a été écrit), absentes du catalogue de 2026 mais gardées au
 * cas où les noms changeraient encore. Seules exemptées du test de cohérence avec le catalogue réel.
 */
export const ANCIENNES_FORMES: readonly string[] = ['Tomate', 'Aubergine', 'Courgette', 'Concombre', 'Melon', 'Pastèque'];

/**
 * Espèces connues → cultures e-phy, la plus précise d'abord (T53, noms mis à jour par T75 sur le
 * catalogue du 2026-10-20). Clés écrites en clair : la comparaison ignore casse, accents, pluriel
 * et tirets. « Cultures légumières » seulement pour les légumes (ni fraise, ni fruits, ni fleurs).
 * Nom ambigu : la culture générique seulement (« Chou » → « Choux »), jamais une famille devinée.
 * Chaque nom visé existe dans le catalogue réel, sauf `ANCIENNES_FORMES` (test de cohérence).
 */
export const CORRESPONDANCES: Readonly<Record<string, readonly string[]>> = {
  // Solanacées
  Tomate: [TOMATE_AUBERGINE, 'Tomate', LEGUMIERES],
  Aubergine: [TOMATE_AUBERGINE, 'Aubergine', LEGUMIERES],
  Poivron: ['Poivron', LEGUMIERES],
  // Fraise, fruits, fleurs : pas de « Cultures légumières »
  Fraise: ['Fraisier'],
  Fraisier: ['Fraisier'],
  Kiwi: ['Kiwi'],
  Pivoine: ['Cultures florales et plantes vertes'],
  // Salades
  Laitue: LAITUE,
  Salade: LAITUE,
  Batavia: LAITUE,
  Romaine: LAITUE,
  'Feuille de chêne': LAITUE,
  Épinard: ['Epinard', LEGUMIERES],
  // Cucurbitacées
  Courgette: [PEAU_COMESTIBLE, 'Courgette', LEGUMIERES],
  Concombre: [PEAU_COMESTIBLE, 'Concombre', LEGUMIERES],
  Cornichon: [PEAU_COMESTIBLE, LEGUMIERES],
  Melon: [PEAU_NON_COMESTIBLE, 'Melon', LEGUMIERES],
  Pastèque: [PEAU_NON_COMESTIBLE, 'Pastèque', LEGUMIERES],
  'Melon d’eau': [PEAU_NON_COMESTIBLE, 'Pastèque', LEGUMIERES],
  Potimarron: COURGES,
  Potiron: COURGES,
  Courge: COURGES,
  'Courge butternut': COURGES,
  Butternut: COURGES,
  // Choux
  Chou: [CHOUX, LEGUMIERES],
  'Chou pommé': POMMES,
  'Chou cabus': POMMES,
  'Chou rouge': POMMES,
  'Chou de Milan': POMMES,
  'Chou de Bruxelles': POMMES,
  'Chou kale': FEUILLUS,
  Kale: FEUILLUS,
  'Chou chinois': FEUILLUS,
  Brocoli: INFLORESCENCE,
  'Chou-fleur': INFLORESCENCE,
  'Chou romanesco': INFLORESCENCE,
  'Chou-rave': ['Choux-raves', CHOUX, LEGUMIERES],
  // Légumineuses
  Haricot: ['Haricots', LEGUMIERES],
  'Haricot vert': NON_ECOSSES,
  'Haricot beurre': NON_ECOSSES,
  'Haricot mangetout': NON_ECOSSES,
  'Pois mangetout': NON_ECOSSES,
  // « Pois » seul : écossé ou mangetout ? Les deux familles, l'utilisateur tranche si leurs DAR diffèrent.
  Pois: ['Haricots et Pois écossés frais', 'Haricots et pois non écossés frais', LEGUMIERES],
  'Petit pois': ['Haricots et Pois écossés frais', LEGUMIERES],
  // Racines, bulbes, pérennes
  Carotte: ['Carotte', LEGUMIERES],
  Betterave: ['Betterave potagère', LEGUMIERES],
  'Betterave potagère': ['Betterave potagère', LEGUMIERES],
  Poireau: ['Poireau', LEGUMIERES],
  Oignon: ['Oignon', LEGUMIERES],
  Asperge: ['Asperge', LEGUMIERES],
};

/**
 * Repli « premier mot » (T53, encadré par T75) : seulement pour ces têtes, dont toute variété reste
 * dans la même culture (« Tomate cerise », « Batavia de printemps »). Pas « melon » (melon d'eau),
 * « chou » (famille à préciser), « salade » (salade de blé = mâche), « kiwi » (kiwi de Sibérie =
 * kiwaï), « asperge » (asperge des bois), « épinard » (épinard-fraise), « pois » (pois chiche).
 */
const TETES_SURES: readonly string[] = ['Tomate', 'Laitue', 'Batavia', 'Fraise', 'Fraisier', 'Poireau', 'Carotte', 'Oignon', 'Poivron', 'Courgette'];
/** Exceptions aux têtes sûres : une autre plante sous le même premier mot (aussi suivies d'un mot : « Tomate en arbre rouge »). */
const EXCEPTIONS_TETES: readonly string[] = ['Tomate en arbre', 'Tomate arbre'];

/** Clé de comparaison : normalisée, tirets en espaces, chaque mot sans « s » ni « x » final. */
const cle = (t: string): string =>
  normaliserEphy(t.replace(/-/g, ' '))
    .split(' ')
    .map((m) => (m.length > 3 ? m.replace(/[sx]$/, '') : m))
    .join(' ');

let parCle: ReadonlyMap<string, readonly string[]> | undefined;
let tetes: ReadonlySet<string> | undefined;
let exceptions: ReadonlySet<string> | undefined;

const estException = (k: string): boolean => [...(exceptions ?? [])].some((e) => k === e || k.startsWith(`${e} `));

function correspondances(): ReadonlyMap<string, readonly string[]> {
  parCle ??= new Map(Object.entries(CORRESPONDANCES).map(([k, v]) => [cle(k), v] as const));
  return parCle;
}

/** Le nom est exactement une espèce de la table (« chou rouge »), sans le repli « premier mot ». */
function especeConnue(nom: string): boolean {
  return correspondances().has(cle(nom));
}

/** Cultures e-phy qui couvrent l'espèce de la ferme ; espèce inconnue : son propre nom seulement. */
export function culturesEphyPourEspece(nomEspece: string): string[] {
  const table = correspondances();
  tetes ??= new Set(TETES_SURES.map(cle));
  exceptions ??= new Set(EXCEPTIONS_TETES.map(cle));
  const k = cle(nomEspece);
  const tete = k.split(' ')[0] ?? '';
  const connue = table.get(k) ?? (tetes.has(tete) && !estException(k) ? table.get(tete) : undefined);
  return connue === undefined ? [nomEspece.trim()] : [...connue];
}

/** Les usages du produit pour les espèces de la ferme, dans l'ordre du catalogue. */
export function usagesPourEspeces(produit: ProduitEphy, especes: readonly string[]): UsageEphy[] {
  const cultures = new Set(especes.flatMap(culturesEphyPourEspece).map(cle));
  return produit.usages.filter((u) => cultures.has(cle(u.culture)));
}

export interface PropositionUsage {
  readonly candidats: readonly UsageEphy[];
  /**
   * DAR commun à tous les candidats, sinon null (l'utilisateur choisit). Null aussi dès qu'une
   * espèce de la ferme n'a aucun usage (T76) : le DAR d'une culture ne vaut pas pour une autre.
   */
  readonly dar: number | null;
  /** Dose commune à tous les candidats (même valeur, même unité), sinon null ; même règle que le DAR. */
  readonly dose: DoseEphy | null;
}

/** DAR et dose communs aux usages retenus, sinon null (Q47 : un DAR absent n'est jamais deviné). */
function communs(candidats: readonly UsageEphy[]): { readonly dar: number | null; readonly dose: DoseEphy | null } {
  const [premier] = candidats;
  if (premier === undefined) return { dar: null, dose: null };
  const dar = premier.dar !== null && candidats.every((u) => u.dar === premier.dar) ? premier.dar : null;
  const d = premier.dose;
  const dose = d !== null && candidats.every((u) => u.dose !== null && u.dose.valeur === d.valeur && u.dose.unite === d.unite) ? d : null;
  return { dar, dose };
}

/** Espèces distinctes (casse, accents et espaces ignorés), dans l'ordre d'entrée ; les vides écartées. */
function especesDistinctes(especes: readonly string[]): string[] {
  const vues = new Set<string>();
  const r: string[] = [];
  for (const e of especes) {
    const k = normaliserEphy(e);
    if (k === '' || vues.has(k)) continue;
    vues.add(k);
    r.push(e.trim());
  }
  return r;
}

/** Usages par espèce de la ferme (fiche produit, T76) ; `usages` vide = non homologué sur cette espèce. */
export function usagesParEspece(produit: ProduitEphy, especes: readonly string[]): { readonly espece: string; readonly usages: readonly UsageEphy[] }[] {
  return especesDistinctes(especes).map((espece) => ({ espece, usages: usagesPourEspeces(produit, [espece]) }));
}

/**
 * Niveau ferme (fiche produit) : les usages des espèces de la ferme, et un DAR (et une dose)
 * seulement si CHAQUE espèce a au moins un usage et que tous concordent (T76).
 */
export function propositionUsage(produit: ProduitEphy, especes: readonly string[]): PropositionUsage {
  const candidats = usagesPourEspeces(produit, especes);
  const sansUsage = usagesParEspece(produit, especes).some((x) => x.usages.length === 0);
  if (sansUsage) return { candidats, dar: null, dose: null };
  return { candidats, ...communs(candidats) };
}

export interface PropositionUsageCulture extends PropositionUsage {
  /** Au moins un usage autorisé pour la culture traitée. */
  readonly homologue: boolean;
}

/**
 * La culture réellement traitée (saisie d'un traitement, T76) : ses usages seulement, jamais ceux
 * d'une autre culture de la ferme. DAR proposé si tous ses usages concordent en jours, sinon null
 * (le maraîcher choisit l'usage ou saisit le DAR).
 */
export function propositionUsagePourCulture(produit: ProduitEphy, espece: string): PropositionUsageCulture {
  const candidats = normaliserEphy(espece) === '' ? [] : usagesPourEspeces(produit, [espece]);
  return { homologue: candidats.length > 0, candidats, ...communs(candidats) };
}

export interface PropositionPourCulture extends PropositionUsageCulture {
  /** Série ou campagne. */
  readonly id: string;
  readonly espece: string;
}

/**
 * Plusieurs cultures traitées d'un même produit (T78) : la proposition T76 de chacune, dans l'ordre,
 * sans fusionner deux cultures de même espèce. Le DAR d'une culture ne déteint jamais sur une autre.
 */
export function propositionsPourCultures(produit: ProduitEphy, cultures: readonly { readonly id: string; readonly espece: string }[]): PropositionPourCulture[] {
  return cultures.map((c) => ({ id: c.id, espece: c.espece, ...propositionUsagePourCulture(produit, c.espece) }));
}
