/**
 * Cahier de fertilisation (T54) : produits fertilisants de la ferme et leur composition (NPK), unités
 * apportées (N, P₂O₅, K₂O), bilan par planche et par saison, apports prévus (travaux prévus des
 * séries), alerte « zone vulnérable nitrates » et lignes du cahier exporté. Pur : ni base, ni
 * réseau, ni horloge ; ne lève jamais. Contrat : ./test/contrat.ts.
 *
 * Dossier `npk/` (et non `fertilisation/`) : l'appli range ce module dans un morceau à part, dont
 * le nom de fichier s'écrit dans la table des dépendances du JavaScript de démarrage (l'export,
 * préchargé, le lit). « fertilisation-XXXXXXXX.js » faisait dépasser le budget de démarrage de
 * 4 octets compressés ; « npk-XXXXXXXX.js » tient dedans (mesuré : 72 906 sur 72 908).
 *
 * On MESURE ce qui a été apporté (règle 5) : aucune dose n'est conseillée ici.
 *
 * Teneur d'un produit : % de sa masse telle qu'apportée (kg, t) ; pour un liquide compté en L ou
 * m³, kg d'élément pour 100 L (densité prise à 1). Un solide compté en L ou m³ (densité inconnue) est
 * compté sans unités. Les teneurs ne sont pas figées dans l'apport :
 * corriger un produit après une analyse corrige son bilan passé, comme on l'attend d'un cahier.
 */
import { estDateValide, type DateCalendaire } from '../dates/index.ts';
import type { DetailIntervention, Id, Instant, Quantite, TravailPrevu } from '../domaine/index.ts';
import { enVigueurDesTraitements } from '../phyto/index.ts';
import { datesTravailPrevu } from '../planification/travaux.ts';
import { absent, colonnesConnues, echec, erreur, estObjet, id, lu, parmi, sansException, supprimeLe, type Lu, type Objet, type ResultatLigne } from '../saisies/lignes.ts';
import { texteInterdit, validerTravailPrevu } from '../saisies/travaux.ts';

// ── Produit fertilisant ──────────────────────────────────────────────────────────────────────

export type FormeFertilisant = 'solide' | 'liquide';
export type UniteFertilisant = 'kg' | 't' | 'L' | 'm3';
export const FORMES_FERTILISANT = ['solide', 'liquide'] as const satisfies readonly FormeFertilisant[];
export const UNITES_FERTILISANT = ['kg', 't', 'L', 'm3'] as const satisfies readonly UniteFertilisant[];

/** Plafond d'azote d'origine organique en zone vulnérable nitrates (kg N/ha/an). */
export const PLAFOND_AZOTE_ORGANIQUE_KG_HA = 170;

export const LIMITES_PRODUIT_FERTILISANT = {
  nomCaracteres: 200,
  sourceCaracteres: 300,
  teneurMax: 100,
} as const;

/** Produit fertilisant écrit par un téléphone, validé. */
export interface ProduitFertilisantEcrit {
  readonly id: Id<'ProduitFertilisant'>;
  readonly fermeId: Id<'Ferme'>;
  readonly nom: string;
  readonly forme: FormeFertilisant;
  readonly unite: UniteFertilisant;
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
  readonly organique: boolean;
  readonly utilisableEnBio: boolean;
  readonly source: string;
  readonly supprimeLe: Instant | null;
}

const COLONNES_PRODUIT: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'id',
  'ferme_id',
  'nom',
  'forme',
  'unite',
  'teneur_n',
  'teneur_p2o5',
  'teneur_k2o',
  'organique',
  'utilisable_en_bio',
  'source',
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

function teneur(v: unknown, champ: string, libelle: string): Lu<number | null> {
  if (absent(v)) return lu(null);
  if (typeof v !== 'number' || !Number.isFinite(v)) return echec(erreur('champ_invalide', champ, `${libelle} : nombre attendu (en %)`));
  if (v < 0 || v > LIMITES_PRODUIT_FERTILISANT.teneurMax) return echec(erreur('hors_bornes', champ, `${libelle} : de 0 à 100 %`));
  return lu(v);
}

function oui(v: unknown, champ: string, libelle: string): Lu<boolean> {
  if (v === 0 || v === false) return lu(false);
  if (v === 1 || v === true) return lu(true);
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} : oui ou non attendu`));
  return echec(erreur('champ_invalide', champ, `${libelle} : 0 ou 1 attendu`));
}

function lireProduit(l: Objet): Lu<ProduitFertilisantEcrit> {
  const inconnue = colonnesConnues(l, COLONNES_PRODUIT);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant du produit');
  if (!identifiant.ok) return identifiant;
  // Pas de bibliothèque commune : la liste de départ est copiée dans la ferme.
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const nom = texte(l.nom, 'nom', 'nom du produit', { max: LIMITES_PRODUIT_FERTILISANT.nomCaracteres, nonVide: true });
  if (!nom.ok) return nom;
  if (!parmi(FORMES_FERTILISANT, l.forme)) return echec(erreur(absent(l.forme) ? 'champ_manquant' : 'champ_invalide', 'forme', 'forme : solide ou liquide'));
  if (!parmi(UNITES_FERTILISANT, l.unite)) return echec(erreur(absent(l.unite) ? 'champ_manquant' : 'champ_invalide', 'unite', 'unité : kg, t, L ou m3'));
  const n = teneur(l.teneur_n, 'teneur_n', 'teneur en azote');
  if (!n.ok) return n;
  const p = teneur(l.teneur_p2o5, 'teneur_p2o5', 'teneur en phosphore');
  if (!p.ok) return p;
  const k = teneur(l.teneur_k2o, 'teneur_k2o', 'teneur en potasse');
  if (!k.ok) return k;
  const organique = oui(l.organique, 'organique', 'azote d’origine organique');
  if (!organique.ok) return organique;
  const bio = oui(l.utilisable_en_bio, 'utilisable_en_bio', 'utilisable en bio');
  if (!bio.ok) return bio;
  const source = texte(l.source, 'source', 'source', { max: LIMITES_PRODUIT_FERTILISANT.sourceCaracteres, nonVide: false });
  if (!source.ok) return source;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'ProduitFertilisant'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    nom: nom.valeur,
    forme: l.forme,
    unite: l.unite,
    teneurN: n.valeur,
    teneurP2o5: p.valeur,
    teneurK2o: k.valeur,
    organique: organique.valeur,
    utilisableEnBio: bio.valeur,
    source: source.valeur,
    supprimeLe: suppression.valeur,
  });
}

/**
 * Valide une ligne `produit_fertilisant` (format PowerSync, avec son `id` ; booléens en 0 / 1 ou
 * booléen) et la rend validée, ou renvoie la première règle violée.
 */
export function validerProduitFertilisant(entree: unknown): ResultatLigne<ProduitFertilisantEcrit> {
  return sansException(entree, lireProduit);
}

// ── Liste de départ ──────────────────────────────────────────────────────────────────────────

export interface ProduitDeDepart {
  readonly nom: string;
  readonly forme: FormeFertilisant;
  readonly unite: UniteFertilisant;
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
  readonly organique: boolean;
  readonly utilisableEnBio: boolean;
  readonly source: string;
}

/**
 * Sources publiques, seules utilisées (aucun contenu payant) :
 *  - DRAAF : DRAAF Auvergne-Rhône-Alpes, « Fiche technique 19 : composition des effluents, Kéq et
 *    APLSH », mise à jour du 15/07/2025 (azote total en kg/t, d'après CORPEN, IPT 2005, ITAVI 2015,
 *    Chambre d'agriculture Rhône-Alpes ; pour les engrais utilisables en bio, d'après le « Guide
 *    des matières organiques », tome 2, ITAB, 2e édition, 2001). Ne donne que l'azote : P₂O₅ et
 *    K₂O sont laissés vides plutôt que pris ailleurs sans source sûre.
 *  Teneur en % = kg N par tonne ÷ 10.
 * Laissés SANS teneur (doute) : le compost de déchets verts (la fiche renvoie à l'analyse du lot)
 * et la vinasse (la valeur de la fiche, 3 kg N/t, paraît être dans une autre unité).
 */
const DRAAF = 'DRAAF Auvergne-Rhône-Alpes, fiche technique 19 « Composition des effluents », mise à jour 15/07/2025';
const DRAAF_ITAB = `${DRAAF}, d’après ITAB, Guide des matières organiques, tome 2, 2001`;

export const FERTILISANTS_DEPART: readonly ProduitDeDepart[] = [
  {
    nom: 'Compost de déchets verts',
    forme: 'solide',
    unite: 't',
    teneurN: null,
    teneurP2o5: null,
    teneurK2o: null,
    organique: true,
    utilisableEnBio: true,
    source: `${DRAAF} : « cf. analyse », teneur à saisir d’après l’analyse du lot`,
  },
  { nom: 'Fumier de bovin', forme: 'solide', unite: 't', teneurN: 0.55, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF} : 5,5 kg N/t` },
  { nom: 'Compost de fumier de bovin', forme: 'solide', unite: 't', teneurN: 0.8, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF} : 8 kg N/t` },
  { nom: 'Fumier de cheval', forme: 'solide', unite: 't', teneurN: 0.62, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF} : 6,2 kg N/t` },
  { nom: 'Corne broyée', forme: 'solide', unite: 'kg', teneurN: 12.2, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF_ITAB} : cornes et onglons, 122 kg N/t` },
  { nom: 'Farine de plumes', forme: 'solide', unite: 'kg', teneurN: 10.1, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF_ITAB} : 101 kg N/t` },
  { nom: 'Sang séché', forme: 'solide', unite: 'kg', teneurN: 11.4, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF_ITAB} : farine de sang, 114 kg N/t` },
  { nom: 'Guano', forme: 'solide', unite: 'kg', teneurN: 16, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF_ITAB} : 160 kg N/t` },
  { nom: 'Tourteau de ricin', forme: 'solide', unite: 'kg', teneurN: 5.7, teneurP2o5: null, teneurK2o: null, organique: true, utilisableEnBio: true, source: `${DRAAF_ITAB} : 57 kg N/t` },
  {
    nom: 'Vinasse de betterave',
    forme: 'liquide',
    unite: 'L',
    teneurN: null,
    teneurP2o5: null,
    teneurK2o: null,
    organique: true,
    utilisableEnBio: true,
    source: `${DRAAF_ITAB} : valeur citée douteuse, teneur à saisir d’après l’étiquette`,
  },
];

// ── Calcul des unités ────────────────────────────────────────────────────────────────────────

export interface Teneurs {
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
}

/** kg d'élément (N, P₂O₅, K₂O) ou kg/ha ; null : teneur absente. */
export interface Unites {
  readonly n: number | null;
  readonly p2o5: number | null;
  readonly k2o: number | null;
}

/** Au centième, sans 0,30000000000000004 (demi vers le haut). */
const centieme = (x: number): number => Math.round((x + Number.EPSILON * Math.abs(x)) * 100) / 100;

/** Quantité en kg (L : densité 1 ; m³ : 1 000 L) ; unité inconnue → null. */
export function quantiteEnKg(q: Quantite): number | null {
  if (!Number.isFinite(q.valeur)) return null;
  const u = q.unite.trim().toLowerCase();
  if (u === 'kg' || u === 'l') return q.valeur;
  if (u === 't' || u === 'm3' || u === 'm³') return q.valeur * 1000;
  return null;
}

const estVolume = (q: Quantite): boolean => ['l', 'm3', 'm³'].includes(q.unite.trim().toLowerCase());

function brutes(q: Quantite, t: Teneurs): Unites | null {
  const kg = quantiteEnKg(q);
  if (kg === null || (t.teneurN === null && t.teneurP2o5 === null && t.teneurK2o === null)) return null;
  const de = (x: number | null): number | null => (x === null ? null : (kg * x) / 100);
  return { n: de(t.teneurN), p2o5: de(t.teneurP2o5), k2o: de(t.teneurK2o) };
}

function hectareBrut(u: Unites, surfaceM2: number | null): Unites | null {
  if (surfaceM2 === null || !Number.isFinite(surfaceM2) || surfaceM2 <= 0) return null;
  const de = (x: number | null): number | null => (x === null ? null : (x * 10_000) / surfaceM2);
  return { n: de(u.n), p2o5: de(u.p2o5), k2o: de(u.k2o) };
}

const auCentieme = (u: Unites | null): Unites | null => (u === null ? null : { n: u.n === null ? null : centieme(u.n), p2o5: u.p2o5 === null ? null : centieme(u.p2o5), k2o: u.k2o === null ? null : centieme(u.k2o) });

/** kg de N, P₂O₅, K₂O apportés (au centième) ; null : quantité non convertible ou aucune teneur. */
export function unitesApport(q: Quantite, t: Teneurs): Unites | null {
  return auCentieme(brutes(q, t));
}

/** kg/ha (au centième) ; surface absente ou ≤ 0 → null. */
export function parHectare(u: Unites, surfaceM2: number | null): Unites | null {
  return auCentieme(hectareBrut(u, surfaceM2));
}

// ── Saisie d'un apport ───────────────────────────────────────────────────────────────────────

/** Détail de l'intervention d'un apport : produit de la ferme (id) ou texte libre (id null). */
export function detailApport(categorie: 'fertilisation' | 'amendement', produit: { readonly id: string | null; readonly nom: string }, quantite: Quantite): DetailIntervention {
  const commun = {
    type: categorie === 'fertilisation' ? 'engrais' : 'amendement',
    outil: null,
    produit: produit.nom.trim(),
    quantite: { valeur: quantite.valeur, unite: quantite.unite.trim() },
    produitFertilisantId: produit.id === null ? null : (produit.id.toLowerCase() as Id<'ProduitFertilisant'>),
  };
  return categorie === 'fertilisation' ? { ...commun, categorie: 'fertilisation' } : { ...commun, categorie: 'amendement' };
}

// ── Bilan ────────────────────────────────────────────────────────────────────────────────────

export type ValeurFertilisation = string | number | null;
export type LigneLocaleFertilisation = Readonly<Record<string, ValeurFertilisation>>;
type Tables = Readonly<Record<string, readonly LigneLocaleFertilisation[] | undefined>>;

export interface ApportCalcule {
  /** null pour un apport prévu. */
  readonly evenementId: string | null;
  readonly date: string;
  readonly prevu: boolean;
  readonly categorie: 'fertilisation' | 'amendement';
  readonly produit: string;
  readonly produitId: string | null;
  readonly quantite: number;
  readonly unite: string;
  readonly emplacementIds: readonly string[];
  readonly surfaceM2: number | null;
  readonly organique: boolean;
  readonly bio: boolean;
  readonly kg: Unites | null;
  readonly kgParHa: Unites | null;
  readonly serieId: string | null;
  readonly campagneId: string | null;
}

export interface TotalFertilisation {
  readonly n: number;
  readonly p2o5: number;
  readonly k2o: number;
  readonly nOrganique: number;
  readonly apports: number;
  readonly sansUnites: number;
}

export interface BilanEmplacement {
  readonly emplacementId: string;
  readonly periode: string;
  readonly realise: TotalFertilisation;
  readonly prevu: TotalFertilisation;
}

export interface BilanFertilisation {
  readonly apports: readonly ApportCalcule[];
  readonly prevus: readonly ApportCalcule[];
  readonly parEmplacement: readonly BilanEmplacement[];
}

/** Tables lues par le cahier exporté (le bilan lit aussi `occupation`, pour les apports prévus). */
export const TABLES_CAHIER_FERTILISATION = ['evenement', 'produit_fertilisant', 'emplacement', 'saison', 'serie', 'campagne', 'plantation', 'espece', 'variete'] as const;

const chaine = (v: ValeurFertilisation | undefined): string => (typeof v === 'string' ? v : '');
const minuscule = (v: ValeurFertilisation | undefined): string | null => (typeof v === 'string' && v !== '' ? v.toLowerCase() : null);
const nombreOuNul = (v: ValeurFertilisation | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lireJson(v: ValeurFertilisation | undefined): unknown {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

const nomNormalise = (nom: string): string => nom.trim().toLowerCase();

interface Produit {
  readonly id: string;
  readonly nom: string;
  readonly teneurs: Teneurs;
  readonly liquide: boolean;
  readonly organique: boolean;
  readonly bio: boolean;
  readonly archive: boolean;
}

interface Contexte {
  readonly produits: ReadonlyMap<string, Produit>;
  readonly parNom: ReadonlyMap<string, Produit | null>;
  readonly emplacements: ReadonlyMap<string, LigneLocaleFertilisation>;
}

function lignesDeLaFerme(tables: Tables, nom: string, fermeId: string): LigneLocaleFertilisation[] {
  return (tables[nom] ?? []).filter((l) => typeof l.id === 'string' && l.ferme_id === fermeId);
}

function contexte(tables: Tables, fermeId: string): Contexte {
  const produits = new Map<string, Produit>();
  for (const l of lignesDeLaFerme(tables, 'produit_fertilisant', fermeId)) {
    const p: Produit = {
      id: chaine(l.id).toLowerCase(),
      nom: chaine(l.nom),
      teneurs: { teneurN: nombreOuNul(l.teneur_n), teneurP2o5: nombreOuNul(l.teneur_p2o5), teneurK2o: nombreOuNul(l.teneur_k2o) },
      liquide: l.forme === 'liquide',
      organique: l.organique === 1,
      bio: l.utilisable_en_bio === 1,
      archive: l.supprime_le !== null && l.supprime_le !== undefined,
    };
    produits.set(p.id, p);
  }
  // Par nom : un seul produit par nom, les non archivés d'abord ; deux du même nom → aucun (null).
  const parNom = new Map<string, Produit | null>();
  for (const archives of [false, true]) {
    const vus = new Map<string, Produit | null>();
    for (const p of produits.values()) {
      if (p.archive !== archives) continue;
      const cle = nomNormalise(p.nom);
      vus.set(cle, vus.has(cle) ? null : p);
    }
    for (const [cle, p] of vus) if (!parNom.has(cle)) parNom.set(cle, p);
  }
  const emplacements = new Map<string, LigneLocaleFertilisation>();
  for (const l of lignesDeLaFerme(tables, 'emplacement', fermeId)) emplacements.set(chaine(l.id).toLowerCase(), l);
  return { produits, parNom, emplacements };
}

function produitDe(ctx: Contexte, produitId: string | null, nom: string): Produit | null {
  if (produitId !== null) return ctx.produits.get(produitId) ?? null;
  return ctx.parNom.get(nomNormalise(nom)) ?? null;
}

/** Somme longueur × largeur (m², au centième) ; un emplacement sans largeur ou introuvable → null. */
function surface(ctx: Contexte, ids: readonly string[]): number | null {
  if (ids.length === 0) return null;
  let total = 0;
  for (const e of ids) {
    const l = ctx.emplacements.get(e);
    const longueur = nombreOuNul(l?.longueur_m);
    const largeur = nombreOuNul(l?.largeur_m);
    if (longueur === null || largeur === null) return null;
    total += Math.round(longueur * largeur * 10_000);
  }
  return Math.round(total / 100) / 100;
}

function calcule(
  ctx: Contexte,
  a: {
    readonly evenementId: string | null;
    readonly date: string;
    readonly categorie: 'fertilisation' | 'amendement';
    readonly produitId: string | null;
    readonly nom: string;
    readonly quantite: Quantite;
    readonly emplacementIds: readonly string[];
    readonly serieId: string | null;
    readonly campagneId: string | null;
  },
): ApportCalcule {
  const p = produitDe(ctx, a.produitId, a.nom);
  const s = surface(ctx, a.emplacementIds);
  // Arrondi une seule fois, à la fin : les kg/ha partent des kg exacts. Un solide compté en volume
  // (L, m³ : compost, fumier) n'a pas de densité connue : sans unités plutôt qu'un azote faux.
  const kg = p === null || (!p.liquide && estVolume(a.quantite)) ? null : brutes(a.quantite, p.teneurs);
  return {
    evenementId: a.evenementId,
    date: a.date,
    prevu: a.evenementId === null,
    categorie: a.categorie,
    produit: p?.nom ?? a.nom,
    produitId: p?.id ?? null,
    quantite: a.quantite.valeur,
    unite: a.quantite.unite,
    emplacementIds: a.emplacementIds,
    surfaceM2: s,
    organique: p?.organique ?? false,
    bio: p?.bio ?? false,
    kg: auCentieme(kg),
    kgParHa: kg === null ? null : auCentieme(hectareBrut(kg, s)),
    serieId: a.serieId,
    campagneId: a.campagneId,
  };
}

interface InterventionLue {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
  readonly categorie: string;
  readonly type: string;
  readonly occurrenceVisee: string | null;
  readonly produit: string;
  readonly produitId: string | null;
  readonly quantite: Quantite | null;
  readonly emplacementIds: readonly string[];
  readonly serieId: string | null;
  readonly campagneId: string | null;
}

function interventionDeLigne(l: LigneLocaleFertilisation): InterventionLue | null {
  if (l.type !== 'intervention' || typeof l.id !== 'string') return null;
  const d = lireJson(l.detail);
  if (!estObjet(d)) return null;
  const date = chaine(l.date);
  if (!estDateValide(date)) return null;
  const q = estObjet(d.quantite) ? d.quantite : null;
  const quantite = q !== null && typeof q.valeur === 'number' && Number.isFinite(q.valeur) && typeof q.unite === 'string' ? { valeur: q.valeur, unite: q.unite } : null;
  const emplacements = lireJson(l.emplacement_ids);
  const sorte = l.remplace_sorte === 'correction' || l.remplace_sorte === 'annulation' ? l.remplace_sorte : null;
  return {
    id: l.id.toLowerCase(),
    date,
    horodatage: chaine(l.horodatage),
    remplaceSorte: sorte,
    remplaceEvenementId: minuscule(l.remplace_evenement_id),
    categorie: typeof d.categorie === 'string' ? d.categorie : '',
    type: typeof d.type === 'string' ? d.type : '',
    occurrenceVisee: typeof d.occurrenceVisee === 'string' && estDateValide(d.occurrenceVisee) ? d.occurrenceVisee : null,
    produit: typeof d.produit === 'string' ? d.produit : '',
    produitId: typeof d.produitFertilisantId === 'string' ? d.produitFertilisantId.toLowerCase() : null,
    quantite,
    emplacementIds: Array.isArray(emplacements) ? emplacements.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()) : [],
    serieId: minuscule(l.serie_id),
    campagneId: minuscule(l.campagne_id),
  };
}

const estApport = (c: string): c is 'fertilisation' | 'amendement' => c === 'fertilisation' || c === 'amendement';
const parDate = (a: ApportCalcule, b: ApportCalcule): number => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.evenementId ?? '') < (b.evenementId ?? '') ? -1 : 1);

/**
 * Lignes parcourues entre deux arrêts (`yield`) des générateurs : l'export (T63) rend la main au
 * fil à ces arrêts ; les écrans les déroulent d'une traite. Comme le registre phyto.
 */
const PAQUET = 256;

function deroule<T>(g: Generator<void, T, undefined>): T {
  for (;;) {
    const r = g.next();
    if (r.done === true) return r.value;
  }
}

/** Interventions en vigueur de la ferme (toutes catégories : elles soldent aussi les travaux prévus). */
function* interventionsEnVigueur(tables: Tables, fermeId: string): Generator<void, InterventionLue[], undefined> {
  const lues: InterventionLue[] = [];
  let k = 0;
  for (const l of tables.evenement ?? []) {
    if (k++ % PAQUET === PAQUET - 1) yield;
    if (l.ferme_id !== fermeId) continue;
    const i = interventionDeLigne(l);
    if (i !== null) lues.push(i);
  }
  return enVigueurDesTraitements(lues);
}

function* apportsRealises(ctx: Contexte, interventions: readonly InterventionLue[]): Generator<void, ApportCalcule[], undefined> {
  const apports: ApportCalcule[] = [];
  let k = 0;
  for (const i of interventions) {
    if (k++ % PAQUET === PAQUET - 1) yield;
    if (!estApport(i.categorie) || i.quantite === null) continue;
    apports.push(calcule(ctx, { evenementId: i.id, date: i.date, categorie: i.categorie, produitId: i.produitId, nom: i.produit, quantite: i.quantite, emplacementIds: i.emplacementIds, serieId: i.serieId, campagneId: i.campagneId }));
  }
  return apports.sort(parDate);
}

function dateOuAbsente(v: ValeurFertilisation | undefined): DateCalendaire | undefined {
  return typeof v === 'string' && estDateValide(v) ? v : undefined;
}

function travauxDe(parametres: ValeurFertilisation | undefined): TravailPrevu[] {
  const p = lireJson(parametres);
  if (!estObjet(p) || !Array.isArray(p.travauxPrevus)) return [];
  const r: TravailPrevu[] = [];
  for (const t of p.travauxPrevus as unknown[]) {
    const v = validerTravailPrevu(t);
    if (v.ok && estApport(v.valeur.categorie) && v.valeur.produit !== null) r.push(v.valeur);
  }
  return r;
}

/** Apports prévus des séries prévues ou en cours, non soldés par une intervention en vigueur. */
function apportsPrevus(ctx: Contexte, tables: Tables, fermeId: string, interventions: readonly InterventionLue[]): ApportCalcule[] {
  const emplacementsDe = new Map<string, Set<string>>();
  for (const o of lignesDeLaFerme(tables, 'occupation', fermeId)) {
    const serie = minuscule(o.serie_id);
    const e = minuscule(o.emplacement_id);
    if (serie === null || e === null || (o.supprime_le !== null && o.supprime_le !== undefined)) continue;
    let s = emplacementsDe.get(serie);
    if (s === undefined) emplacementsDe.set(serie, (s = new Set()));
    s.add(e);
  }
  const prevus: ApportCalcule[] = [];
  for (const s of lignesDeLaFerme(tables, 'serie', fermeId)) {
    if ((s.supprime_le !== null && s.supprime_le !== undefined) || (s.statut !== 'prevue' && s.statut !== 'en_cours')) continue;
    const serieId = chaine(s.id).toLowerCase();
    const miseEnPlace = dateOuAbsente(s.prevu_mise_en_place);
    const debutRecolte = dateOuAbsente(s.prevu_debut_recolte);
    const finRecolte = dateOuAbsente(s.prevu_fin_recolte);
    if (miseEnPlace === undefined || debutRecolte === undefined || finRecolte === undefined) continue;
    const semis = dateOuAbsente(s.prevu_semis_pepiniere);
    const dates = semis === undefined ? { miseEnPlace, debutRecolte, finRecolte } : { semisPepiniere: semis, miseEnPlace, debutRecolte, finRecolte };
    const emplacements = [...(emplacementsDe.get(serieId) ?? [])].sort();
    for (const t of travauxDe(s.parametres)) {
      const produit = t.produit;
      if (produit === null || !estApport(t.categorie)) continue;
      // Occurrences soldées : jusqu'à la plus tardive visée par une intervention de ce travail.
      let solde = '';
      for (const i of interventions) {
        if (i.serieId === serieId && i.categorie === t.categorie && i.type === t.type && i.occurrenceVisee !== null && i.occurrenceVisee > solde) solde = i.occurrenceVisee;
      }
      for (const date of datesTravailPrevu(t, dates)) {
        if (date <= solde) continue;
        prevus.push(calcule(ctx, { evenementId: null, date, categorie: t.categorie, produitId: null, nom: produit.nom, quantite: produit.quantite, emplacementIds: emplacements, serieId, campagneId: null }));
      }
    }
  }
  return prevus.sort(parDate);
}

interface Saison {
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
  readonly id: string;
}

function saisonsDe(tables: Tables, fermeId: string): Saison[] {
  return lignesDeLaFerme(tables, 'saison', fermeId)
    .filter((s) => s.supprime_le === null || s.supprime_le === undefined)
    .map((s) => ({ nom: chaine(s.nom), debut: chaine(s.debut), fin: chaine(s.fin), id: chaine(s.id) }))
    .filter((s) => estDateValide(s.debut) && estDateValide(s.fin));
}

/** Nom de la saison qui contient la date (la plus récente), à défaut l'année 'AAAA'. */
export function periodeDe(saisons: readonly { readonly nom: string; readonly debut: string; readonly fin: string; readonly id?: string }[], date: string): string {
  let meilleure: (typeof saisons)[number] | null = null;
  for (const s of saisons) {
    if (s.debut > date || s.fin < date) continue;
    if (meilleure === null || s.debut > meilleure.debut || (s.debut === meilleure.debut && (s.id ?? '') > (meilleure.id ?? ''))) meilleure = s;
  }
  return meilleure?.nom ?? date.slice(0, 4);
}

const VIDE: TotalFertilisation = { n: 0, p2o5: 0, k2o: 0, nOrganique: 0, apports: 0, sansUnites: 0 };

function ajouter(t: TotalFertilisation, a: ApportCalcule): TotalFertilisation {
  const u = a.kgParHa;
  return {
    n: t.n + (u?.n ?? 0),
    p2o5: t.p2o5 + (u?.p2o5 ?? 0),
    k2o: t.k2o + (u?.k2o ?? 0),
    nOrganique: t.nOrganique + (a.organique ? (u?.n ?? 0) : 0),
    apports: t.apports + 1,
    sansUnites: t.sansUnites + (u === null ? 1 : 0),
  };
}

const arrondi = (t: TotalFertilisation): TotalFertilisation => ({ ...t, n: centieme(t.n), p2o5: centieme(t.p2o5), k2o: centieme(t.k2o), nOrganique: centieme(t.nOrganique) });

/**
 * Bilan de la ferme : apports réalisés en vigueur, apports prévus, et par (emplacement, période)
 * les sommes des kg/ha. Les autres fermes sont ignorées.
 */
export function bilanFertilisation(tables: Tables, fermeId: string): BilanFertilisation {
  const ctx = contexte(tables, fermeId);
  const interventions = deroule(interventionsEnVigueur(tables, fermeId));
  const apports = deroule(apportsRealises(ctx, interventions));
  const prevus = apportsPrevus(ctx, tables, fermeId, interventions);
  const saisons = saisonsDe(tables, fermeId);
  const cles = new Map<string, { emplacementId: string; periode: string; realise: TotalFertilisation; prevu: TotalFertilisation }>();
  for (const a of [...apports, ...prevus]) {
    const periode = periodeDe(saisons, a.date);
    for (const e of new Set(a.emplacementIds)) {
      const cle = `${e}\u0000${periode}`;
      const b = cles.get(cle) ?? { emplacementId: e, periode, realise: VIDE, prevu: VIDE };
      if (a.prevu) b.prevu = ajouter(b.prevu, a);
      else b.realise = ajouter(b.realise, a);
      cles.set(cle, b);
    }
  }
  const parEmplacement = [...cles.values()]
    .map((b) => ({ emplacementId: b.emplacementId, periode: b.periode, realise: arrondi(b.realise), prevu: arrondi(b.prevu) }))
    .sort((a, b) => (a.emplacementId !== b.emplacementId ? (a.emplacementId < b.emplacementId ? -1 : 1) : a.periode < b.periode ? -1 : a.periode > b.periode ? 1 : 0));
  return { apports, prevus, parEmplacement };
}

// ── Zone vulnérable nitrates ─────────────────────────────────────────────────────────────────

export interface AlerteAzote {
  readonly emplacementId: string;
  readonly annee: string;
  readonly realiseKgHa: number;
  readonly prevuKgHa: number;
  readonly sorte: 'realise' | 'prevu';
}

/**
 * Azote d'origine organique par emplacement et par année civile, réalisé et prévu : alerte
 * 'realise' au-delà du plafond, 'prevu' si seul réalisé + prévu le dépasse. Non bloquante.
 */
export function alertesAzoteOrganique(bilan: BilanFertilisation, plafond: number = PLAFOND_AZOTE_ORGANIQUE_KG_HA): AlerteAzote[] {
  const parCle = new Map<string, { emplacementId: string; annee: string; realise: number; prevu: number }>();
  for (const a of [...bilan.apports, ...bilan.prevus]) {
    const n = a.organique ? (a.kgParHa?.n ?? 0) : 0;
    if (n === 0) continue;
    const annee = a.date.slice(0, 4);
    for (const e of new Set(a.emplacementIds)) {
      const cle = `${e}\u0000${annee}`;
      const c = parCle.get(cle) ?? { emplacementId: e, annee, realise: 0, prevu: 0 };
      if (a.prevu) c.prevu += n;
      else c.realise += n;
      parCle.set(cle, c);
    }
  }
  const alertes: AlerteAzote[] = [];
  for (const c of parCle.values()) {
    const realise = centieme(c.realise);
    const prevu = centieme(c.prevu);
    const sorte = realise > plafond ? 'realise' : centieme(realise + prevu) > plafond ? 'prevu' : null;
    if (sorte !== null) alertes.push({ emplacementId: c.emplacementId, annee: c.annee, realiseKgHa: realise, prevuKgHa: prevu, sorte });
  }
  return alertes.sort((a, b) => (a.annee !== b.annee ? (a.annee < b.annee ? -1 : 1) : a.emplacementId < b.emplacementId ? -1 : a.emplacementId > b.emplacementId ? 1 : 0));
}

// ── Cahier ───────────────────────────────────────────────────────────────────────────────────

/** Colonnes de cahier-fertilisation.csv, en français, dans l'ordre. */
export const COLONNES_CAHIER_FERTILISATION = [
  'date',
  'saison',
  'emplacements',
  'surface_m2',
  'culture',
  'categorie',
  'produit',
  'quantite',
  'unite',
  'organique',
  'bio',
  'n_kg',
  'p2o5_kg',
  'k2o_kg',
  'n_kg_ha',
  'p2o5_kg_ha',
  'k2o_kg_ha',
] as const;

/** Une ligne du cahier au format des lignes locales (oui / non en 1 / 0, comme les CSV de l'export). */
export type LigneCahier = Readonly<Record<(typeof COLONNES_CAHIER_FERTILISATION)[number], ValeurFertilisation>>;

/** Lignes d'une table, de la ferme (et de la bibliothèque si `bibliotheque`), par id en minuscules. */
function parId(tables: Tables, nom: string, fermeId: string, bibliotheque: boolean): Map<string, LigneLocaleFertilisation> {
  const m = new Map<string, LigneLocaleFertilisation>();
  for (const l of tables[nom] ?? []) {
    if (typeof l.id !== 'string') continue;
    if (l.ferme_id === fermeId || (bibliotheque && (l.ferme_id === null || l.ferme_id === undefined))) m.set(l.id.toLowerCase(), l);
  }
  return m;
}

/** Le cahier de la ferme : une ligne par apport RÉALISÉ en vigueur, dans l'ordre des dates. */
export function lignesCahierFertilisation(tables: Tables, fermeId: string): LigneCahier[] {
  return deroule(lignesCahierFertilisationParPaquets(tables, fermeId));
}

/** `lignesCahierFertilisation` par paquets (T63) : l'export rend la main au fil entre deux paquets. */
export function* lignesCahierFertilisationParPaquets(tables: Tables, fermeId: string): Generator<void, LigneCahier[], undefined> {
  const ctx = contexte(tables, fermeId);
  const apports = yield* apportsRealises(ctx, yield* interventionsEnVigueur(tables, fermeId));
  if (apports.length === 0) return [];
  const saisons = saisonsDe(tables, fermeId);
  const emplacements = parId(tables, 'emplacement', fermeId, false);
  const series = parId(tables, 'serie', fermeId, false);
  const campagnes = parId(tables, 'campagne', fermeId, false);
  const plantations = parId(tables, 'plantation', fermeId, false);
  const especes = parId(tables, 'espece', fermeId, true);
  const varietes = parId(tables, 'variete', fermeId, true);
  const nomCulture = (especeId: ValeurFertilisation | undefined, varieteId: ValeurFertilisation | undefined): string => {
    const espece = chaine(especes.get(chaine(especeId).toLowerCase())?.nom);
    const variete = typeof varieteId === 'string' ? chaine(varietes.get(varieteId.toLowerCase())?.nom) : '';
    return [espece, variete].filter((x) => x !== '').join(' ');
  };
  const culture = (a: ApportCalcule): string => {
    if (a.serieId !== null) {
      const s = series.get(a.serieId);
      return s === undefined ? '' : nomCulture(s.espece_id, s.variete_id);
    }
    if (a.campagneId !== null) {
      const c = campagnes.get(a.campagneId);
      const p = c === undefined ? undefined : plantations.get(chaine(c.plantation_id).toLowerCase());
      return p === undefined ? '' : nomCulture(p.espece_id, p.variete_id);
    }
    return '';
  };
  const lignes: LigneCahier[] = [];
  for (const [k, a] of apports.entries()) {
    if (k % PAQUET === PAQUET - 1) yield;
    lignes.push({
    date: a.date,
    saison: periodeDe(saisons, a.date),
    emplacements: a.emplacementIds
      .map((e) => chaine(emplacements.get(e)?.code))
      .filter((c) => c !== '')
      .sort((x, y) => x.localeCompare(y, 'fr', { numeric: true }))
      .join(', '),
    surface_m2: a.surfaceM2,
    culture: culture(a),
    categorie: a.categorie,
    produit: a.produit,
    quantite: a.quantite,
    unite: a.unite,
    organique: a.produitId === null ? null : a.organique ? 1 : 0,
    bio: a.produitId === null ? null : a.bio ? 1 : 0,
    n_kg: a.kg?.n ?? null,
    p2o5_kg: a.kg?.p2o5 ?? null,
    k2o_kg: a.kg?.k2o ?? null,
    n_kg_ha: a.kgParHa?.n ?? null,
    p2o5_kg_ha: a.kgParHa?.p2o5 ?? null,
    k2o_kg_ha: a.kgParHa?.k2o ?? null,
    });
  }
  return lignes;
}
