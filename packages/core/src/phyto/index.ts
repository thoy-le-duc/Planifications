/**
 * Traitements phyto (T52) : délai avant récolte (DAR), dose maximale, produits de la ferme et
 * registre. Pur : ni base, ni réseau, ni horloge ; ne lève jamais (sauf `dateRecolteAutorisee`
 * sur un DAR qui n'est pas un entier, que `validerProduitPhyto` refuse avant). Contrat :
 * ./test/contrat.ts.
 *
 * Le DAR est FIGÉ dans l'événement (`detail.recolteAutoriseeLe`, calculé par `detailTraitement`
 * au moment de la saisie) : l'interdiction de récolte et le registre se lisent dans les
 * traitements en vigueur, jamais dans le produit, que la ferme peut modifier ensuite.
 */
import { ajouterJours, estDateValide, type DateCalendaire } from '../dates/index.ts';
import type { DetailTraitement, Id, Instant, Quantite } from '../domaine/index.ts';
import { texteInterdit } from '../saisies/travaux.ts';
import { absent, colonnesConnues, echec, erreur, estObjet, extrait, id, json, lu, sansException, supprimeLe, type Lu, type Objet, type ResultatLigne } from '../saisies/lignes.ts';

// ── DAR ──────────────────────────────────────────────────────────────────────────────────────

/** DAR maximal accepté pour un produit (un an) : au-delà, une faute de frappe. */
export const DAR_MAX_JOURS = 365;

/** Premier jour où la récolte est permise : le jour du traitement + le DAR. */
export function dateRecolteAutorisee(date: DateCalendaire, delaiAvantRecolteJours: number): DateCalendaire {
  return ajouterJours(date, delaiAvantRecolteJours);
}

/** Produit tel que la saisie d'un traitement le lit. */
export interface ProduitPourTraitement {
  readonly id: string;
  readonly nomCommercial: string;
  readonly delaiAvantRecolteJours: number;
  readonly doseMaximale: Quantite | null;
}

export interface SaisieTraitement {
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  /** Facultatif : '' quand personne n'est nommé. */
  readonly operateur: string | null;
}

/** Le détail d'un traitement fait le `date` avec `produit`, DAR figé. */
export function detailTraitement(produit: ProduitPourTraitement, saisie: SaisieTraitement, date: DateCalendaire): DetailTraitement {
  return {
    produitPhytoId: produit.id as Id<'ProduitPhyto'>,
    dose: { valeur: saisie.dose.valeur, unite: saisie.dose.unite.trim() },
    surfaceTraiteeM2: saisie.surfaceTraiteeM2,
    cible: saisie.cible.trim(),
    operateur: (saisie.operateur ?? '').trim(),
    recolteAutoriseeLe: dateRecolteAutorisee(date, produit.delaiAvantRecolteJours),
  };
}

// ── Dose maximale ────────────────────────────────────────────────────────────────────────────

/** « 2,5 » : virgule décimale, sans zéros inutiles. */
function nombre(n: number): string {
  return String(n).replace('.', ',');
}

const memeUnite = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Dose au-dessus de la dose maximale déclarée (même unité) : un avertissement ; sinon null. Jamais un refus. */
export function avertissementDose(dose: Quantite, doseMaximale: Quantite | null): string | null {
  if (doseMaximale === null || !memeUnite(dose.unite, doseMaximale.unite) || !(dose.valeur > doseMaximale.valeur)) return null;
  return `Dose au-dessus de la dose maximale déclarée pour ce produit (${nombre(doseMaximale.valeur)} ${doseMaximale.unite.trim()}). Vérifiez avant de traiter.`;
}

// ── Surface ──────────────────────────────────────────────────────────────────────────────────

/** Somme des longueur × largeur (m²), au centième ; un emplacement sans largeur ne compte pas. */
export function surfaceEmplacements(emplacements: readonly { readonly longueurM: number; readonly largeurM: number | null }[]): number {
  // En dix-millièmes de m² entiers, puis arrondi au centième : pas de 0,04000000000000001.
  let total = 0;
  for (const e of emplacements) {
    if (e.largeurM === null || !Number.isFinite(e.largeurM) || !Number.isFinite(e.longueurM)) continue;
    total += Math.round(e.longueurM * e.largeurM * 10_000);
  }
  return Math.round(total / 100) / 100;
}

// ── Traitements en vigueur, interdiction de récolte ──────────────────────────────────────────

/** Événement de type traitement, tel que lu de la base locale. */
export interface TraitementLu {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly emplacementIds: readonly string[];
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
  readonly produitPhytoId: string;
  readonly recolteAutoriseeLe: string;
}

/** Ce que la résolution des chaînes lit d'un événement. */
interface Maillon {
  readonly id: string;
  readonly horodatage: string;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
}

const instant = (h: string): number => {
  const t = Date.parse(h);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** a est-il plus récent que b (horodatage, puis id) ? */
const plusRecent = (a: Maillon, b: Maillon): boolean => {
  const ta = instant(a.horodatage);
  const tb = instant(b.horodatage);
  return ta !== tb ? ta > tb : a.id > b.id;
};

/**
 * Événements en vigueur (même règle que la vue evenements_en_vigueur, T10g) : chaque chaîne
 * (l'origine, ses corrections, leurs annulations) qui contient une annulation n'a plus rien en
 * vigueur ; sinon la correction la plus récente (horodatage, puis id), à défaut l'origine. Un
 * parent absent de la liste : son id sert de clé de chaîne. Un cycle (données corrompues) n'a
 * rien en vigueur.
 */
export function enVigueurDesTraitements<E extends Maillon>(evenements: readonly E[]): E[] {
  const parId = new Map(evenements.map((e) => [e.id.toLowerCase(), e]));
  const origines = new Map<string, string | null>();
  const origineDe = (e: E): string | null => {
    const chemin: string[] = [];
    const vus = new Set<string>();
    let courant: E = e;
    let origine: string | null | undefined;
    for (;;) {
      const cle = courant.id.toLowerCase();
      origine = origines.get(cle);
      if (origine !== undefined) break;
      chemin.push(cle);
      vus.add(cle);
      const parentId = courant.remplaceEvenementId?.toLowerCase() ?? null;
      const parent = parentId === null ? undefined : parId.get(parentId);
      if (parent === undefined) {
        origine = parentId ?? cle;
        break;
      }
      if (vus.has(parent.id.toLowerCase())) {
        origine = null;
        break;
      }
      courant = parent;
    }
    for (const c of chemin) origines.set(c, origine);
    return origine;
  };
  const chaines = new Map<string, { annulee: boolean; correction: E | null; origine: E | null }>();
  for (const e of evenements) {
    const o = origineDe(e);
    if (o === null) continue;
    const c = chaines.get(o) ?? { annulee: false, correction: null, origine: null };
    if (e.remplaceSorte === 'annulation') c.annulee = true;
    else if (e.remplaceSorte === 'correction') {
      if (c.correction === null || plusRecent(e, c.correction)) c.correction = e;
    } else c.origine = e;
    chaines.set(o, c);
  }
  const resultat: E[] = [];
  for (const c of chaines.values()) {
    if (c.annulee) continue;
    const e = c.correction ?? c.origine;
    if (e !== null) resultat.push(e);
  }
  return resultat;
}

export interface InterdictionRecolte {
  readonly evenementId: string;
  readonly produitPhytoId: string;
  /** Date du traitement. */
  readonly dateTraitement: string;
  /** Premier jour où la récolte est permise. */
  readonly recolteAutoriseeLe: string;
}

/**
 * Traitement en vigueur qui interdit la récolte le `date` sur l'un des `emplacementIds` (du jour
 * du traitement compris à recolteAutoriseeLe exclue) ; s'il y en a plusieurs, celui dont la date
 * autorisée est la plus tardive. null si la récolte est permise.
 */
export function interdictionRecolte(traitements: readonly TraitementLu[], emplacementIds: readonly string[], date: string): InterdictionRecolte | null {
  if (emplacementIds.length === 0 || traitements.length === 0) return null;
  const vises = new Set(emplacementIds.map((e) => e.toLowerCase()));
  let meilleur: TraitementLu | null = null;
  for (const t of enVigueurDesTraitements(traitements)) {
    if (!(t.date <= date && date < t.recolteAutoriseeLe)) continue;
    if (!t.emplacementIds.some((e) => vises.has(e.toLowerCase()))) continue;
    if (meilleur === null || t.recolteAutoriseeLe > meilleur.recolteAutoriseeLe || (t.recolteAutoriseeLe === meilleur.recolteAutoriseeLe && t.id > meilleur.id)) meilleur = t;
  }
  return meilleur === null ? null : { evenementId: meilleur.id, produitPhytoId: meilleur.produitPhytoId, dateTraitement: meilleur.date, recolteAutoriseeLe: meilleur.recolteAutoriseeLe };
}

/** 'AAAA-MM-JJ' → 'JJ/MM'. */
export function jourMois(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05) ». */
export function texteInterdiction(interdiction: InterdictionRecolte, nomProduit: string): string {
  return `Récolte interdite jusqu’au ${jourMois(interdiction.recolteAutoriseeLe)} (${nomProduit}, traité le ${jourMois(interdiction.dateTraitement)})`;
}

// ── Produit phyto de la ferme ────────────────────────────────────────────────────────────────

/** Produit phyto écrit par un téléphone, validé. */
export interface ProduitPhytoEcrit {
  readonly id: Id<'ProduitPhyto'>;
  readonly fermeId: Id<'Ferme'>;
  readonly nomCommercial: string;
  readonly numeroAmm: string;
  readonly substanceActive: string;
  readonly delaiAvantRecolteJours: number;
  readonly utilisableEnBio: boolean;
  readonly doseMaximale: Quantite | null;
  readonly supprimeLe: Instant | null;
}

export const LIMITES_PRODUIT_PHYTO = {
  nomCaracteres: 200,
  ammCaracteres: 40,
  substanceCaracteres: 200,
  uniteCaracteres: 20,
  /** Comme traitement.dose.valeur (PLAFONDS_SAISIES). */
  doseMaximale: 100_000,
} as const;

const COLONNES_PRODUIT: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'id',
  'ferme_id',
  'nom_commercial',
  'numero_amm',
  'substance_active',
  'delai_avant_recolte_jours',
  'utilisable_en_bio',
  'dose_maximale',
  'cree_le',
  'modifie_le',
  'supprime_le',
]);


function texte(v: unknown, champ: string, libelle: string, o: { readonly max: number; readonly nonVide: boolean }): Lu<string> {
  if (absent(v)) return o.nonVide ? echec(erreur('champ_manquant', champ, `${libelle} manquant`)) : lu('');
  if (typeof v !== 'string') return echec(erreur('champ_invalide', champ, `${libelle} : texte attendu`));
  const t = v.trim();
  if (o.nonVide && t === '') return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (t.length > o.max) return echec(erreur('trop_long', champ, `${libelle} : ${String(o.max)} caractères au plus`));
  if (texteInterdit(t)) return echec(erreur('champ_invalide', champ, `${libelle} : caractère invalide`));
  return lu(t);
}

function dar(v: unknown): Lu<number> {
  const champ = 'delai_avant_recolte_jours';
  if (absent(v)) return echec(erreur('champ_manquant', champ, 'délai avant récolte manquant'));
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    return echec(erreur('champ_invalide', champ, 'délai avant récolte : nombre entier de jours, positif ou nul, attendu'));
  }
  if (v > DAR_MAX_JOURS) return echec(erreur('hors_bornes', champ, `délai avant récolte : ${String(DAR_MAX_JOURS)} jours au plus`));
  return lu(v);
}

function bio(v: unknown): Lu<boolean> {
  if (v === 0 || v === false) return lu(false);
  if (v === 1 || v === true) return lu(true);
  if (absent(v)) return echec(erreur('champ_manquant', 'utilisable_en_bio', 'utilisable en bio : oui ou non attendu'));
  return echec(erreur('champ_invalide', 'utilisable_en_bio', 'utilisable en bio : 0 ou 1 attendu'));
}

function doseMaximale(v: unknown): Lu<Quantite | null> {
  const champ = 'dose_maximale';
  if (absent(v)) return lu(null);
  const lue = json(v, champ, 'dose maximale');
  if (!lue.ok) return lue;
  const d = lue.valeur;
  if (d === null) return lu(null);
  if (!estObjet(d)) return echec(erreur('champ_invalide', champ, 'dose maximale : valeur et unité attendues'));
  const cle = Object.keys(d).find((c) => c !== 'valeur' && c !== 'unite');
  if (cle !== undefined) return echec(erreur('cle_inconnue', `${champ}.${extrait(cle)}`, `clé inconnue dans la dose maximale : ${extrait(cle)}`));
  const valeur = d.valeur;
  if (typeof valeur !== 'number' || !Number.isFinite(valeur) || valeur <= 0) {
    return echec(erreur('champ_invalide', `${champ}.valeur`, 'dose maximale : nombre positif attendu'));
  }
  if (valeur > LIMITES_PRODUIT_PHYTO.doseMaximale) {
    return echec(erreur('plafond_depasse', `${champ}.valeur`, `dose maximale au-delà du plafond (${String(LIMITES_PRODUIT_PHYTO.doseMaximale)} au plus)`));
  }
  const unite = texte(d.unite, `${champ}.unite`, 'unité de la dose maximale', { max: LIMITES_PRODUIT_PHYTO.uniteCaracteres, nonVide: true });
  if (!unite.ok) return unite;
  return lu({ valeur, unite: unite.valeur });
}

function lireProduit(l: Objet): Lu<ProduitPhytoEcrit> {
  const inconnue = colonnesConnues(l, COLONNES_PRODUIT);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant du produit');
  if (!identifiant.ok) return identifiant;
  // ferme_id nul = la bibliothèque commune : le téléphone n'y écrit jamais.
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const nom = texte(l.nom_commercial, 'nom_commercial', 'nom commercial', { max: LIMITES_PRODUIT_PHYTO.nomCaracteres, nonVide: true });
  if (!nom.ok) return nom;
  const amm = texte(l.numero_amm, 'numero_amm', 'numéro AMM', { max: LIMITES_PRODUIT_PHYTO.ammCaracteres, nonVide: false });
  if (!amm.ok) return amm;
  const substance = texte(l.substance_active, 'substance_active', 'substance active', { max: LIMITES_PRODUIT_PHYTO.substanceCaracteres, nonVide: false });
  if (!substance.ok) return substance;
  const delai = dar(l.delai_avant_recolte_jours);
  if (!delai.ok) return delai;
  const b = bio(l.utilisable_en_bio);
  if (!b.ok) return b;
  const dose = doseMaximale(l.dose_maximale);
  if (!dose.ok) return dose;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'ProduitPhyto'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    nomCommercial: nom.valeur,
    numeroAmm: amm.valeur,
    substanceActive: substance.valeur,
    delaiAvantRecolteJours: delai.valeur,
    utilisableEnBio: b.valeur,
    doseMaximale: dose.valeur,
    supprimeLe: suppression.valeur,
  });
}

/**
 * Valide une ligne `produit_phyto` (format PowerSync, avec son `id` ; `dose_maximale` en texte
 * JSON ou en objet ; `utilisable_en_bio` en 0 / 1 ou booléen) et la rend validée, ou renvoie la
 * première règle violée.
 */
export function validerProduitPhyto(entree: unknown): ResultatLigne<ProduitPhytoEcrit> {
  return sansException(entree, lireProduit);
}

// ── Registre ─────────────────────────────────────────────────────────────────────────────────

export type ValeurRegistre = string | number | null;
export type LigneLocaleRegistre = Readonly<Record<string, ValeurRegistre>>;

/** Une ligne du registre phyto : un traitement en vigueur. */
export interface LigneRegistre {
  readonly evenementId: string;
  readonly date: string;
  /** Nom commercial du produit (même archivé). */
  readonly produit: string;
  readonly amm: string;
  readonly substanceActive: string;
  readonly bio: boolean;
  readonly dose: number;
  readonly uniteDose: string;
  readonly surfaceTraiteeM2: number;
  /** Codes des emplacements, triés, séparés par « , ». */
  readonly emplacements: string;
  /** « Espèce » ou « Espèce Variété » ; '' sans culture. */
  readonly culture: string;
  readonly cible: string;
  readonly operateur: string;
  readonly recolteAutoriseeLe: string;
}

/** Colonnes de registre-phyto.csv, en français, dans l'ordre. */
export const COLONNES_REGISTRE_PHYTO = [
  'date',
  'produit',
  'amm',
  'substance_active',
  'bio',
  'dose',
  'unite_dose',
  'surface_traitee_m2',
  'emplacements',
  'culture',
  'cible',
  'operateur',
  'recolte_autorisee_le',
] as const;

/** Tables lues par le registre. */
export const TABLES_REGISTRE_PHYTO = ['evenement', 'produit_phyto', 'emplacement', 'serie', 'campagne', 'plantation', 'espece', 'variete'] as const;

const chaine = (v: ValeurRegistre | undefined): string => (typeof v === 'string' ? v : '');
const chaineOuNul = (v: ValeurRegistre | undefined): string | null => (typeof v === 'string' && v !== '' ? v.toLowerCase() : null);

function lireJson(v: ValeurRegistre | undefined): unknown {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

/** Traitement lu d'une ligne locale, avec son détail complet ; null si illisible. */
interface TraitementRegistre extends TraitementLu {
  readonly serieId: string | null;
  readonly campagneId: string | null;
  readonly dose: number;
  readonly uniteDose: string;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  readonly operateur: string;
}

/** Une ligne `evenement` de type traitement, lue sans confiance (format de la base locale). */
export function traitementDeLigne(l: LigneLocaleRegistre): TraitementRegistre | null {
  if (l.type !== 'traitement' || typeof l.id !== 'string') return null;
  const d = lireJson(l.detail);
  if (!estObjet(d)) return null;
  const dose = estObjet(d.dose) ? d.dose : {};
  const date = chaine(l.date);
  const autorisee = typeof d.recolteAutoriseeLe === 'string' ? d.recolteAutoriseeLe : '';
  if (!estDateValide(date) || !estDateValide(autorisee) || typeof d.produitPhytoId !== 'string') return null;
  const emplacements = lireJson(l.emplacement_ids);
  const sorte = l.remplace_sorte === 'correction' || l.remplace_sorte === 'annulation' ? l.remplace_sorte : null;
  return {
    id: l.id,
    date,
    horodatage: chaine(l.horodatage),
    emplacementIds: Array.isArray(emplacements) ? emplacements.filter((e): e is string => typeof e === 'string') : [],
    remplaceSorte: sorte,
    remplaceEvenementId: chaineOuNul(l.remplace_evenement_id),
    produitPhytoId: d.produitPhytoId.toLowerCase(),
    recolteAutoriseeLe: autorisee,
    serieId: chaineOuNul(l.serie_id),
    campagneId: chaineOuNul(l.campagne_id),
    dose: typeof dose.valeur === 'number' ? dose.valeur : 0,
    uniteDose: typeof dose.unite === 'string' ? dose.unite : '',
    surfaceTraiteeM2: typeof d.surfaceTraiteeM2 === 'number' ? d.surfaceTraiteeM2 : 0,
    cible: typeof d.cible === 'string' ? d.cible : '',
    operateur: typeof d.operateur === 'string' ? d.operateur : '',
  };
}

type Tables = Readonly<Record<string, readonly LigneLocaleRegistre[] | undefined>>;

/** Lignes d'une table, de la ferme (et de la bibliothèque si `bibliotheque`), par id en minuscules. */
function parId(tables: Tables, nom: string, fermeId: string, bibliotheque: boolean): Map<string, LigneLocaleRegistre> {
  const m = new Map<string, LigneLocaleRegistre>();
  for (const l of tables[nom] ?? []) {
    if (typeof l.id !== 'string') continue;
    const f = l.ferme_id;
    if (f === fermeId || (bibliotheque && (f === null || f === undefined))) m.set(l.id.toLowerCase(), l);
  }
  return m;
}

/** Traitements de la ferme lus des lignes locales (avant la résolution des chaînes). */
export function traitementsDeLaFerme(evenements: readonly LigneLocaleRegistre[], fermeId: string): TraitementRegistre[] {
  const r: TraitementRegistre[] = [];
  for (const l of evenements) {
    if (l.ferme_id !== fermeId || l.type !== 'traitement') continue;
    const t = traitementDeLigne(l);
    if (t !== null) r.push(t);
  }
  return r;
}

/**
 * Le registre phyto de la ferme : une ligne par traitement EN VIGUEUR (sans les annulés ni les
 * remplacés), dans l'ordre (date, horodatage, id). Les autres fermes sont ignorées.
 */
export function lignesRegistrePhyto(tables: Tables, fermeId: string): LigneRegistre[] {
  const traitements = enVigueurDesTraitements(traitementsDeLaFerme(tables.evenement ?? [], fermeId));
  if (traitements.length === 0) return [];
  const produits = parId(tables, 'produit_phyto', fermeId, true);
  const emplacements = parId(tables, 'emplacement', fermeId, false);
  const series = parId(tables, 'serie', fermeId, false);
  const campagnes = parId(tables, 'campagne', fermeId, false);
  const plantations = parId(tables, 'plantation', fermeId, false);
  const especes = parId(tables, 'espece', fermeId, true);
  const varietes = parId(tables, 'variete', fermeId, true);
  const nomCulture = (especeId: ValeurRegistre | undefined, varieteId: ValeurRegistre | undefined): string => {
    const espece = chaine(especes.get(chaine(especeId).toLowerCase())?.nom);
    const variete = typeof varieteId === 'string' ? chaine(varietes.get(varieteId.toLowerCase())?.nom) : '';
    return [espece, variete].filter((x) => x !== '').join(' ');
  };
  const culture = (t: TraitementRegistre): string => {
    if (t.serieId !== null) {
      const s = series.get(t.serieId);
      return s === undefined ? '' : nomCulture(s.espece_id, s.variete_id);
    }
    if (t.campagneId !== null) {
      const c = campagnes.get(t.campagneId);
      const p = c === undefined ? undefined : plantations.get(chaine(c.plantation_id).toLowerCase());
      return p === undefined ? '' : nomCulture(p.espece_id, p.variete_id);
    }
    return '';
  };
  const tries = [...traitements].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.horodatage !== b.horodatage ? (a.horodatage < b.horodatage ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return tries.map((t) => {
    const p = produits.get(t.produitPhytoId);
    const codes = t.emplacementIds
      .map((e) => chaine(emplacements.get(e.toLowerCase())?.code))
      .filter((c) => c !== '')
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    return {
      evenementId: t.id,
      date: t.date,
      produit: chaine(p?.nom_commercial),
      amm: chaine(p?.numero_amm),
      substanceActive: chaine(p?.substance_active),
      bio: p?.utilisable_en_bio === 1,
      dose: t.dose,
      uniteDose: t.uniteDose,
      surfaceTraiteeM2: t.surfaceTraiteeM2,
      emplacements: codes.join(', '),
      culture: culture(t),
      cible: t.cible,
      operateur: t.operateur,
      recolteAutoriseeLe: t.recolteAutoriseeLe,
    };
  });
}

/** Une ligne du registre au format des CSV de l'export (bio en 0 / 1). */
export function ligneCsvRegistre(l: LigneRegistre): Readonly<Record<(typeof COLONNES_REGISTRE_PHYTO)[number], ValeurRegistre>> {
  return {
    date: l.date,
    produit: l.produit,
    amm: l.amm,
    substance_active: l.substanceActive,
    bio: l.bio ? 1 : 0,
    dose: l.dose,
    unite_dose: l.uniteDose,
    surface_traitee_m2: l.surfaceTraiteeM2,
    emplacements: l.emplacements,
    culture: l.culture,
    cible: l.cible,
    operateur: l.operateur,
    recolte_autorisee_le: l.recolteAutoriseeLe,
  };
}
