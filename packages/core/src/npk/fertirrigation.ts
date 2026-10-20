/**
 * Fertirrigation (T56, docs/backlog/T56-fertirrigation.md, Q44) : recettes de la ferme (engrais
 * solubles, taux d'injection ou quantités par m³ d'eau, EC et pH cibles), volume d'une irrigation,
 * doses injectées, détail de l'événement, répartition au prorata des surfaces. En hors-sol comme
 * en pleine terre : seule la vanne compte. Pur : ni base, ni réseau, ni horloge ; ne lève jamais.
 * Contrat : ./test/contrat-fertirrigation.ts.
 *
 * Les unités N, P₂O₅, K₂O apportées viennent des teneurs des produits fertilisants, par la règle de
 * T54 (./index.ts : `unitesFertirrigation`, et le bilan qui compte les fertirrigations) : rien
 * n'est recalculé ici.
 *
 * Deux façons de doser une recette :
 *   - `tauxInjection` donné : quantités pour 1 000 L de SOLUTION MÈRE, injectée à ce taux (1 % =
 *     10 L de mère par m³ d'eau) : dose = quantité × taux ÷ 100 × volume ;
 *   - `tauxInjection` null : quantités par m³ d'EAU : dose = quantité × volume.
 */
import type { Id, Instant } from '../domaine/index.ts';
import { absent, colonnesConnues, echec, erreur, estObjet, extrait, id, lu, sansException, supprimeLe, type Lu, type Objet, type ResultatLigne } from '../saisies/lignes.ts';
import { texteInterdit } from '../saisies/travaux.ts';
import type { Unites } from './index.ts';

export const LIMITES_RECETTE_FERTIRRIGATION = {
  nomCaracteres: 200,
  engraisMax: 20,
  /** Quantité d'un engrais au plus (kg ou L, pour 1 000 L de mère ou par m³). */
  quantiteMax: 100_000,
  tauxMax: 100,
  ecMax: 20,
  phMax: 14,
} as const;

export type UniteEngrais = 'kg' | 'L';
export const UNITES_ENGRAIS = ['kg', 'L'] as const satisfies readonly UniteEngrais[];

export interface QuantiteEngrais {
  readonly valeur: number;
  readonly unite: UniteEngrais;
}

/** Un engrais d'une recette et sa quantité (pour 1 000 L de mère, ou par m³ d'eau). */
export interface EngraisRecette {
  readonly produitFertilisantId: Id<'ProduitFertilisant'>;
  readonly quantite: QuantiteEngrais;
}

/** Recette écrite par un téléphone, validée. */
export interface RecetteFertirrigationEcrite {
  readonly id: Id<'RecetteFertirrigation'>;
  readonly fermeId: Id<'Ferme'>;
  readonly nom: string;
  /** % de solution mère injectée dans l'eau ; null : quantités par m³ d'eau. */
  readonly tauxInjection: number | null;
  readonly engrais: readonly EngraisRecette[];
  readonly ecCible: number | null;
  readonly phCible: number | null;
  readonly supprimeLe: Instant | null;
}

const COLONNES_RECETTE: ReadonlySet<string> = /* @__PURE__ */ new Set(['id', 'ferme_id', 'nom', 'taux_injection', 'engrais', 'ec_cible', 'ph_cible', 'cree_le', 'modifie_le', 'supprime_le']);

const L = LIMITES_RECETTE_FERTIRRIGATION;

function nom(v: unknown): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', 'nom', 'nom de la recette manquant'));
  if (typeof v !== 'string') return echec(erreur('champ_invalide', 'nom', 'nom de la recette : texte attendu'));
  const t = v.trim();
  if (t === '') return echec(erreur('champ_manquant', 'nom', 'nom de la recette manquant'));
  if (t.length > L.nomCaracteres) return echec(erreur('trop_long', 'nom', `nom de la recette : ${String(L.nomCaracteres)} caractères au plus`));
  if (texteInterdit(t)) return echec(erreur('champ_invalide', 'nom', 'nom de la recette : caractère invalide'));
  return lu(t);
}

/** Nombre facultatif borné ; `strict` : la borne basse est exclue. */
function borne(v: unknown, champ: string, libelle: string, min: number, max: number, strict: boolean): Lu<number | null> {
  if (absent(v)) return lu(null);
  if (typeof v !== 'number' || !Number.isFinite(v)) return echec(erreur('champ_invalide', champ, `${libelle} : nombre attendu`));
  if ((strict ? v <= min : v < min) || v > max) return echec(erreur('hors_bornes', champ, `${libelle} : de ${String(min)} à ${String(max)}`));
  return lu(v);
}

function lireEngrais(v: unknown): Lu<EngraisRecette[]> {
  if (absent(v)) return echec(erreur('champ_manquant', 'engrais', 'engrais de la recette manquants'));
  let valeur: unknown = v;
  if (typeof v === 'string') {
    try {
      valeur = JSON.parse(v) as unknown;
    } catch {
      return echec(erreur('json_illisible', 'engrais', 'engrais : texte JSON illisible'));
    }
  }
  if (!Array.isArray(valeur)) return echec(erreur('champ_invalide', 'engrais', 'engrais : liste attendue'));
  const liste = valeur as readonly unknown[];
  if (liste.length === 0) return echec(erreur('champ_manquant', 'engrais', 'ajoutez au moins un engrais à la recette'));
  if (liste.length > L.engraisMax) return echec(erreur('trop_nombreux', 'engrais', `${String(L.engraisMax)} engrais au plus par recette`));
  const lus: EngraisRecette[] = [];
  const vus = new Set<string>();
  for (const [i, e] of liste.entries()) {
    const champ = `engrais[${String(i)}]`;
    if (!estObjet(e)) return echec(erreur('champ_invalide', champ, 'engrais : objet attendu'));
    const cle = Object.keys(e).find((c) => c !== 'produitFertilisantId' && c !== 'quantite');
    if (cle !== undefined) return echec(erreur('cle_inconnue', `${champ}.${extrait(cle)}`, `clé inconnue dans un engrais : ${extrait(cle)}`));
    const produit = id(e.produitFertilisantId, `${champ}.produitFertilisantId`, 'engrais');
    if (!produit.ok) return produit;
    if (vus.has(produit.valeur)) return echec(erreur('doublon', `${champ}.produitFertilisantId`, 'un même engrais deux fois dans la recette'));
    vus.add(produit.valeur);
    const q = e.quantite;
    if (!estObjet(q)) return echec(erreur(absent(q) ? 'champ_manquant' : 'champ_invalide', `${champ}.quantite`, 'quantité de l’engrais : valeur et unité attendues'));
    const cleQ = Object.keys(q).find((c) => c !== 'valeur' && c !== 'unite');
    if (cleQ !== undefined) return echec(erreur('cle_inconnue', `${champ}.quantite.${extrait(cleQ)}`, `clé inconnue dans une quantité : ${extrait(cleQ)}`));
    const valeurQ = q.valeur;
    if (typeof valeurQ !== 'number' || !Number.isFinite(valeurQ) || valeurQ <= 0 || valeurQ > L.quantiteMax) {
      return echec(erreur('hors_bornes', `${champ}.quantite.valeur`, `quantité de l’engrais : plus de 0, au plus ${String(L.quantiteMax)}`));
    }
    const unite = q.unite;
    if (unite !== 'kg' && unite !== 'L') return echec(erreur('champ_invalide', `${champ}.quantite.unite`, 'unité de l’engrais : kg ou L'));
    lus.push({ produitFertilisantId: produit.valeur as Id<'ProduitFertilisant'>, quantite: { valeur: valeurQ, unite } });
  }
  return lu(lus);
}

function lireRecette(l: Objet): Lu<RecetteFertirrigationEcrite> {
  const inconnue = colonnesConnues(l, COLONNES_RECETTE);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant de la recette');
  if (!identifiant.ok) return identifiant;
  // Pas de bibliothèque commune : une recette est toujours d'une ferme.
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const n = nom(l.nom);
  if (!n.ok) return n;
  const taux = borne(l.taux_injection, 'taux_injection', 'taux d’injection (%)', 0, L.tauxMax, true);
  if (!taux.ok) return taux;
  const engrais = lireEngrais(l.engrais);
  if (!engrais.ok) return engrais;
  const ec = borne(l.ec_cible, 'ec_cible', 'EC cible (mS/cm)', 0, L.ecMax, false);
  if (!ec.ok) return ec;
  const ph = borne(l.ph_cible, 'ph_cible', 'pH cible', 0, L.phMax, false);
  if (!ph.ok) return ph;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'RecetteFertirrigation'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    nom: n.valeur,
    tauxInjection: taux.valeur,
    engrais: engrais.valeur,
    ecCible: ec.valeur,
    phCible: ph.valeur,
    supprimeLe: suppression.valeur,
  });
}

/**
 * Valide une ligne `recette_fertirrigation` (format PowerSync, avec son `id` ; `engrais` en texte
 * JSON ou en tableau) et la rend validée, ou renvoie la première règle violée.
 */
export function validerRecetteFertirrigation(entree: unknown): ResultatLigne<RecetteFertirrigationEcrite> {
  return sansException(entree, lireRecette);
}

// ── Volume et doses ──────────────────────────────────────────────────────────────────────────

/** Arrondi à 10^-chiffres, sans 0,30000000000000004 (demi vers le haut). */
const arrondi = (x: number, chiffres: number): number => {
  const f = 10 ** chiffres;
  return Math.round((x + Number.EPSILON * Math.abs(x)) * f) / f;
};

/** Volume d'eau (m³, au litre près) = durée × débit ; débit absent ou invalide → null. */
export function volumeIrrigationM3(dureeMinutes: number, debitLitresHeure: number | null): number | null {
  if (debitLitresHeure === null || !Number.isFinite(debitLitresHeure) || debitLitresHeure <= 0 || !Number.isFinite(dureeMinutes) || dureeMinutes <= 0) return null;
  return Math.round((debitLitresHeure * dureeMinutes) / 60) / 1000;
}

/** Un engrais injecté par une irrigation et sa quantité. */
export interface DoseInjectee {
  readonly produitFertilisantId: Id<'ProduitFertilisant'>;
  readonly quantite: QuantiteEngrais;
}

/** Quantité de chaque engrais injectée dans `volumeM3` d'eau (au milligramme près). */
export function dosesFertirrigation(recette: { readonly tauxInjection: number | null; readonly engrais: readonly EngraisRecette[] }, volumeM3: number): DoseInjectee[] {
  const t = recette.tauxInjection;
  return recette.engrais.map((e) => ({
    produitFertilisantId: e.produitFertilisantId,
    quantite: { valeur: arrondi(t === null ? e.quantite.valeur * volumeM3 : (e.quantite.valeur * t * volumeM3) / 100, 6), unite: e.quantite.unite },
  }));
}

export interface SaisieFertirrigation {
  readonly secteurIrrigationId: string;
  readonly dureeMinutes: number;
  readonly recette: { readonly id: string; readonly tauxInjection: number | null; readonly engrais: readonly EngraisRecette[] };
  /** Nom de chaque produit fertilisant, par id. */
  readonly noms: ReadonlyMap<string, string>;
  readonly volumeM3: number;
  readonly ecMesuree: number | null;
  readonly phMesure: number | null;
}

/** Détail d'une irrigation qui porte une recette : doses figées à la saisie, nom de chaque produit. */
export function detailFertirrigation(e: SaisieFertirrigation): {
  readonly secteurIrrigationId: Id<'SecteurIrrigation'>;
  readonly dureeMinutes: number;
  readonly recetteFertirrigationId: Id<'RecetteFertirrigation'>;
  readonly volumeM3: number;
  readonly ecMesuree?: number;
  readonly phMesure?: number;
  readonly engrais: readonly { readonly produitFertilisantId: Id<'ProduitFertilisant'>; readonly produit: string; readonly quantite: QuantiteEngrais }[];
} {
  return {
    secteurIrrigationId: e.secteurIrrigationId.toLowerCase() as Id<'SecteurIrrigation'>,
    dureeMinutes: e.dureeMinutes,
    recetteFertirrigationId: e.recette.id.toLowerCase() as Id<'RecetteFertirrigation'>,
    volumeM3: e.volumeM3,
    ...(e.ecMesuree === null ? {} : { ecMesuree: e.ecMesuree }),
    ...(e.phMesure === null ? {} : { phMesure: e.phMesure }),
    engrais: dosesFertirrigation(e.recette, e.volumeM3).map((d) => {
      const nom = (e.noms.get(d.produitFertilisantId) ?? '').trim();
      return { produitFertilisantId: d.produitFertilisantId, produit: nom === '' ? 'produit fertilisant' : nom, quantite: d.quantite };
    }),
  };
}

// ── Répartition au prorata des surfaces ──────────────────────────────────────────────────────

export interface PartEmplacement {
  readonly emplacementId: string;
  readonly kg: Unites;
  readonly kgParHa: Unites;
}

/** `total` en parts entières proportionnelles aux poids, de somme exacte (plus forts restes). */
function parts(total: number, poids: readonly number[], somme: number): number[] {
  const brutes = poids.map((p) => (total * p) / somme);
  const entieres = brutes.map((b) => Math.floor(b));
  let reste = total - entieres.reduce((a, b) => a + b, 0);
  const ordre = brutes.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of ordre) {
    if (reste <= 0) break;
    entieres[i] = (entieres[i] ?? 0) + 1;
    reste--;
  }
  return entieres;
}

/**
 * Part de chaque emplacement au prorata de sa surface : kg au gramme (la somme des parts égale le
 * total), kg/ha au centième (les mêmes pour tous). Une surface inconnue ou nulle → null.
 */
export function repartitionAuProrata(kg: Unites, surfaces: readonly { readonly emplacementId: string; readonly surfaceM2: number | null }[]): PartEmplacement[] | null {
  if (surfaces.length === 0) return null;
  const poids: number[] = [];
  for (const s of surfaces) {
    if (s.surfaceM2 === null || !Number.isFinite(s.surfaceM2) || s.surfaceM2 <= 0) return null;
    poids.push(Math.round(s.surfaceM2 * 10_000));
  }
  const somme = poids.reduce((a, b) => a + b, 0);
  const surfaceTotale = somme / 10_000;
  const partsDe = (x: number | null): (number | null)[] => (x === null ? poids.map(() => null) : parts(Math.round(arrondi(x, 3) * 1000), poids, somme).map((g) => g / 1000));
  const parHa = (x: number | null): number | null => (x === null ? null : arrondi((x * 10_000) / surfaceTotale, 2));
  const n = partsDe(kg.n);
  const p = partsDe(kg.p2o5);
  const k = partsDe(kg.k2o);
  const kgParHa: Unites = { n: parHa(kg.n), p2o5: parHa(kg.p2o5), k2o: parHa(kg.k2o) };
  return surfaces.map((s, i) => ({ emplacementId: s.emplacementId, kg: { n: n[i] ?? null, p2o5: p[i] ?? null, k2o: k[i] ?? null }, kgParHa }));
}
