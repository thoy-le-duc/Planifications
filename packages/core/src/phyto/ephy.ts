/**
 * Catalogue e-phy (T53) : la base publique des produits phytopharmaceutiques de l'Anses, réduite
 * à ce que la fiche produit de la ferme (T52) reprend. Pur : ni réseau, ni horloge.
 *
 * Exporté par `@planif/core/ephy` seulement, jamais par l'index du cœur : rien du catalogue au
 * démarrage de l'appli. Le catalogue est produit par `packages/db/src/ephy/extraire.ts`.
 *
 * Correspondance espèce → usage : une table courte et explicite (tomate, fraise, laitue, et les
 * cultures de la ferme de Théophane). Aucune devinette : une espèce inconnue ne correspond qu'à
 * l'usage qui porte son nom. Le DAR n'est proposé que si tous les usages retenus sont d'accord ;
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

/** Produits qui contiennent chaque mot tapé (nom, seconds noms, AMM, substances) ; 2 lettres au moins. */
export function chercherProduitsEphy(catalogue: CatalogueEphy, texte: string, max = 8): ProduitEphy[] {
  const t = normaliserEphy(texte);
  if (t.length < 2) return [];
  const mots = t.split(' ');
  const trouves: { readonly p: ProduitEphy; readonly debut: boolean }[] = [];
  for (const p of catalogue.produits) {
    const noms = [p.nom, ...p.autresNoms].map(normaliserEphy);
    const tout = [...noms, p.amm, ...p.substances.map(normaliserEphy)].join(' | ');
    if (mots.every((m) => tout.includes(m))) trouves.push({ p, debut: noms.some((n) => n.startsWith(t)) });
  }
  trouves.sort((a, b) => Number(a.p.retire) - Number(b.p.retire) || Number(b.debut) - Number(a.debut) || a.p.nom.localeCompare(b.p.nom, 'fr'));
  return trouves.slice(0, max).map((x) => x.p);
}

// ── Espèce → usage ───────────────────────────────────────────────────────────────────────────

const LEGUMIERES = 'Cultures légumières';

/**
 * Espèces connues (clé normalisée, au singulier) → cultures e-phy, la plus précise d'abord.
 * « Cultures légumières » seulement pour les légumes (pas la fraise, ni les fruits, ni les fleurs).
 */
const CORRESPONDANCES: Readonly<Record<string, readonly string[]>> = {
  tomate: ['Tomate', LEGUMIERES],
  fraise: ['Fraisier'],
  fraisier: ['Fraisier'],
  laitue: ['Laitue', LEGUMIERES],
  salade: ['Laitue', LEGUMIERES],
  batavia: ['Laitue', LEGUMIERES],
  romaine: ['Laitue', LEGUMIERES],
  'feuille de chene': ['Laitue', LEGUMIERES],
  kiwi: ['Kiwi'],
  pivoine: ['Cultures florales et plantes vertes'],
  asperge: ['Asperge', LEGUMIERES],
  melon: ['Melon', LEGUMIERES],
  concombre: ['Concombre', LEGUMIERES],
  poivron: ['Poivron', LEGUMIERES],
  carotte: ['Carotte', LEGUMIERES],
  poireau: ['Poireau', LEGUMIERES],
  oignon: ['Oignon', LEGUMIERES],
  chou: ['Choux', LEGUMIERES],
  haricot: ['Haricots', LEGUMIERES],
  epinard: ['Epinard', LEGUMIERES],
  'betterave potagere': ['Betterave potagère', LEGUMIERES],
};

/** Clé de comparaison : normalisée, chaque mot sans « s » ni « x » final. */
const cle = (t: string): string =>
  normaliserEphy(t)
    .split(' ')
    .map((m) => (m.length > 3 ? m.replace(/[sx]$/, '') : m))
    .join(' ');

/** Cultures e-phy qui couvrent l'espèce de la ferme ; espèce inconnue : son propre nom seulement. */
export function culturesEphyPourEspece(nomEspece: string): string[] {
  const k = cle(nomEspece);
  const connue = CORRESPONDANCES[k] ?? CORRESPONDANCES[k.split(' ')[0] ?? ''];
  return connue === undefined ? [nomEspece.trim()] : [...connue];
}

/** Les usages du produit pour les espèces de la ferme, dans l'ordre du catalogue. */
export function usagesPourEspeces(produit: ProduitEphy, especes: readonly string[]): UsageEphy[] {
  const cultures = new Set(especes.flatMap(culturesEphyPourEspece).map(cle));
  return produit.usages.filter((u) => cultures.has(cle(u.culture)));
}

export interface PropositionUsage {
  readonly candidats: readonly UsageEphy[];
  /** DAR commun à tous les candidats, sinon null (l'utilisateur choisit). */
  readonly dar: number | null;
  /** Dose commune à tous les candidats (même valeur, même unité), sinon null. */
  readonly dose: DoseEphy | null;
}

export function propositionUsage(produit: ProduitEphy, especes: readonly string[]): PropositionUsage {
  const candidats = usagesPourEspeces(produit, especes);
  const [premier] = candidats;
  if (premier === undefined) return { candidats, dar: null, dose: null };
  const dar = premier.dar !== null && candidats.every((u) => u.dar === premier.dar) ? premier.dar : null;
  const d = premier.dose;
  const dose = d !== null && candidats.every((u) => u.dose !== null && u.dose.valeur === d.valeur && u.dose.unite === d.unite) ? d : null;
  return { candidats, dar, dose };
}
