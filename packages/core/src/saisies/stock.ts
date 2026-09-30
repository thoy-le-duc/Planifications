/**
 * Règles d'une saisie de stock (T10c) : article de stock et mouvement de stock écrits par un
 * téléphone. Pures, comme `validerSaisie` : ni base, ni réseau, ni horloge, ne lèvent jamais.
 * Le serveur (apps/api/src/sync/stock.ts) les applique à l'envoi ; le téléphone peut s'en servir
 * avant d'écrire (T13 : `mouvementAttendu` donne le mouvement inverse d'une annulation ou d'une
 * correction).
 *
 * Ce qui reste à l'appelant (base de données) : la ferme du jeton, l'appartenance de l'espèce, de
 * la variété, de l'article et de la récolte à la ferme, et la somme des mouvements déjà écrits
 * sur la chaîne d'une récolte.
 */
import { estDateValide } from '../dates/index.ts';
import type { ArticleStock, Id, MotifMouvementStock, MouvementStock, RemplacementEvenement, UniteRecolte } from '../domaine/index.ts';
import { PLAFONDS_PROVISOIRES, type CodeErreurSaisie, type ErreurSaisie } from './index.ts';

export type ResultatLigneStock<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

/**
 * Motifs qu'un téléphone peut saisir (décision 5 du chef, T10c) : la récolte seulement. Vente,
 * perte et ajustement n'ont pas encore d'écran ; ils s'ouvriront avec le ticket qui les saisira.
 */
export const MOTIFS_MOUVEMENT_SAISIS = ['recolte'] as const satisfies readonly MotifMouvementStock[];

/** Catégorie d'un article (texte libre : 'extra', 'cat. II'…) : longueur au plus. */
export const CATEGORIE_ARTICLE_CARACTERES = 100;

const MOTIFS: readonly MotifMouvementStock[] = ['recolte', 'vente', 'perte', 'ajustement'];
const UNITES: readonly UniteRecolte[] = ['kg', 'botte', 'piece', 'barquette'];

/** Colonnes d'une ligne `article_stock` reçue ; horodatages tolérés (remplis par le serveur). */
const COLONNES_ARTICLE = new Set(['id', 'ferme_id', 'espece_id', 'variete_id', 'unite', 'categorie', 'cree_le', 'modifie_le', 'supprime_le']);
/** Colonnes d'une ligne `mouvement_stock` reçue ; `cree_le` tolérée (remplie par le serveur). */
const COLONNES_MOUVEMENT = new Set(['id', 'ferme_id', 'article_stock_id', 'date', 'quantite', 'motif', 'recolte_id', 'cree_le']);

const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comparaison des quantités au millionième : 15,3 − 12,1 vaut 3,2000000000000006 en virgule
 * flottante, et doit égaler 3,2. Au plafond (100 000), 1e11 millionièmes restent des entiers exacts.
 */
const ECHELLE = 1_000_000;
const enMillioniemes = (q: number): number => Math.round(q * ECHELLE);

type Objet = Readonly<Record<string, unknown>>;
type Lu<T> = ResultatLigneStock<T>;

const erreur = (code: CodeErreurSaisie, champ: string | null, message: string): ErreurSaisie => ({ code, champ, message });
const echec = <T>(e: ErreurSaisie): Lu<T> => ({ ok: false, erreur: e });
const lu = <T>(valeur: T): Lu<T> => ({ ok: true, valeur });
const absent = (v: unknown): v is null | undefined => v === undefined || v === null;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const extrait = (texte: string): string => (texte.length > 40 ? `${texte.slice(0, 40)}…` : texte);
const parmi = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);

function id(v: unknown, champ: string, libelle: string, obligatoire: boolean): Lu<string | null> {
  if (absent(v)) return obligatoire ? echec(erreur('champ_manquant', champ, `${libelle} manquant`)) : lu(null);
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) return echec(erreur('champ_invalide', champ, `${libelle} : identifiant invalide`));
  return lu(v.toLowerCase());
}

function colonnesConnues(l: Objet, colonnes: ReadonlySet<string>): ErreurSaisie | null {
  const cle = Object.keys(l).find((c) => !colonnes.has(c));
  return cle === undefined ? null : erreur('colonne_inconnue', extrait(cle), `colonne inconnue : ${extrait(cle)}`);
}

/** Copie des propriétés propres (un niveau) : une valeur héritée par prototype est absente. */
const copiePropre = (o: Objet): Objet => Object.fromEntries(Object.keys(o).map((cle) => [cle, o[cle]]));

/** Filet commun : entrée qui n'est pas un objet, accesseur qui lève, Proxy… jamais d'exception. */
function sansException<T>(entree: unknown, lire: (l: Objet) => Lu<T>): Lu<T> {
  try {
    if (!estObjet(entree)) return echec(erreur('entree_invalide', null, 'ligne illisible : objet attendu'));
    return lire(copiePropre(entree));
  } catch {
    return echec(erreur('entree_invalide', null, 'ligne illisible'));
  }
}

// ── article_stock ────────────────────────────────────────────────────────────────────────────

/**
 * Article de stock créé par un téléphone (ligne au format PowerSync, avec son `id`) : espèce
 * obligatoire, variété facultative, unité de récolte, catégorie libre et courte. Un article naît
 * actif : `supprime_le` non nul est refusé.
 */
export function validerArticleStock(entree: unknown): ResultatLigneStock<ArticleStock> {
  return sansException(entree, (l) => {
    const inconnue = colonnesConnues(l, COLONNES_ARTICLE);
    if (inconnue !== null) return echec(inconnue);
    const identifiant = id(l.id, 'id', "identifiant de l'article", true);
    if (!identifiant.ok) return identifiant;
    const ferme = id(l.ferme_id, 'ferme_id', 'ferme', true);
    if (!ferme.ok) return ferme;
    const espece = id(l.espece_id, 'espece_id', 'espèce', true);
    if (!espece.ok) return espece;
    const variete = id(l.variete_id, 'variete_id', 'variété', false);
    if (!variete.ok) return variete;
    if (absent(l.unite)) return echec(erreur('champ_manquant', 'unite', 'unité manquante'));
    if (!parmi(UNITES, l.unite)) return echec(erreur('champ_invalide', 'unite', 'unité inconnue (kg, botte, piece, barquette)'));
    const categorie = l.categorie;
    if (!absent(categorie) && typeof categorie !== 'string') return echec(erreur('champ_invalide', 'categorie', 'catégorie : texte attendu'));
    if (typeof categorie === 'string' && categorie.length > CATEGORIE_ARTICLE_CARACTERES) {
      return echec(erreur('trop_long', 'categorie', `catégorie trop longue (${String(CATEGORIE_ARTICLE_CARACTERES)} caractères au plus)`));
    }
    if (!absent(l.supprime_le)) return echec(erreur('incoherent', 'supprime_le', 'un article se crée actif (supprime_le vide)'));
    return lu({
      id: identifiant.valeur as Id<'ArticleStock'>,
      fermeId: ferme.valeur as Id<'Ferme'>,
      especeId: espece.valeur as Id<'Espece'>,
      varieteId: variete.valeur as Id<'Variete'> | null,
      unite: l.unite,
      categorie: categorie ?? null,
      supprimeLe: null,
    });
  });
}

// ── mouvement_stock ──────────────────────────────────────────────────────────────────────────

/**
 * Mouvement de stock saisi sur un téléphone (ligne au format PowerSync, avec son `id`) :
 * quantité (nombre, fini, non nul, |quantité| ≤ plafond provisoire des récoltes), date
 * 'AAAA-MM-JJ' dans [2000-01-01, 2100-12-31], motif `recolte` seulement (décision 5) et donc
 * `recolte_id` obligatoire. Le sens et la valeur exacte d'un mouvement rattaché à une
 * annulation ou une correction : `verifierMouvementRecolte`.
 */
export function validerMouvementStock(entree: unknown): ResultatLigneStock<MouvementStock & { readonly motif: 'recolte' }> {
  return sansException(entree, (l) => {
    const inconnue = colonnesConnues(l, COLONNES_MOUVEMENT);
    if (inconnue !== null) return echec(inconnue);
    const identifiant = id(l.id, 'id', "identifiant du mouvement", true);
    if (!identifiant.ok) return identifiant;
    const ferme = id(l.ferme_id, 'ferme_id', 'ferme', true);
    if (!ferme.ok) return ferme;
    const article = id(l.article_stock_id, 'article_stock_id', 'article de stock', true);
    if (!article.ok) return article;

    const date = l.date;
    if (absent(date)) return echec(erreur('champ_manquant', 'date', 'date manquante'));
    if (typeof date !== 'string' || !estDateValide(date)) return echec(erreur('champ_invalide', 'date', 'date invalide (AAAA-MM-JJ)'));
    if (date < DATE_MIN || date > DATE_MAX) return echec(erreur('hors_bornes', 'date', `date hors de ${DATE_MIN} … ${DATE_MAX}`));

    const quantite = l.quantite;
    if (absent(quantite)) return echec(erreur('champ_manquant', 'quantite', 'quantité manquante'));
    if (typeof quantite !== 'number' || !Number.isFinite(quantite)) return echec(erreur('champ_invalide', 'quantite', 'quantité : nombre attendu'));
    if (quantite === 0) return echec(erreur('champ_invalide', 'quantite', 'quantité nulle'));
    const plafond = PLAFONDS_PROVISOIRES.recolteQuantite;
    if (Math.abs(quantite) > plafond) {
      return echec(erreur('plafond_depasse', 'quantite', `quantité au-delà du plafond (${String(plafond)} au plus, dans un sens ou dans l'autre)`));
    }

    if (absent(l.motif)) return echec(erreur('champ_manquant', 'motif', 'motif manquant'));
    if (!parmi(MOTIFS, l.motif)) return echec(erreur('champ_invalide', 'motif', 'motif inconnu'));
    if (!parmi(MOTIFS_MOUVEMENT_SAISIS, l.motif)) {
      return echec(erreur('champ_invalide', 'motif', `motif ${l.motif} : pas encore saisissable depuis un téléphone`));
    }
    const recolte = id(l.recolte_id, 'recolte_id', 'récolte liée', true);
    if (!recolte.ok) return recolte;

    return lu({
      id: identifiant.valeur as Id<'MouvementStock'>,
      fermeId: ferme.valeur as Id<'Ferme'>,
      articleStockId: article.valeur as Id<'ArticleStock'>,
      date: date,
      quantite,
      motif: 'recolte' as const,
      recolteId: recolte.valeur as Id<'Evenement'>,
      // Le journal des mouvements est en ajout seul : jamais supprimé (pas de colonne en base).
      supprimeLe: null,
    });
  });
}

/** L'événement de récolte auquel un mouvement est rattaché (`recolte_id`). */
export interface RecolteLiee {
  /** null : la récolte d'origine ; sinon l'annulation ou la correction d'une récolte. */
  readonly remplaceSorte: RemplacementEvenement['sorte'] | null;
  /** `detail.quantite` de l'événement (la nouvelle quantité, pour une correction). */
  readonly quantite: number;
}

/**
 * Mouvement exact attendu pour un événement qui remplace une récolte (décision 3 du chef) ;
 * null pour la récolte d'origine (entrée positive, bornée par le plafond seulement).
 *
 * `sommeChaine` : somme des mouvements déjà écrits, sur l'article du mouvement, pour toute la
 * chaîne de la récolte (l'origine, ses corrections et leurs annulations). C'est la quantité en
 * vigueur en stock pour cette récolte.
 *   - annulation : −sommeChaine (annuler retire tout, corrections comprises) ;
 *   - correction : nouvelle quantité − sommeChaine.
 * Arrondi au millionième (voir ECHELLE).
 */
export function mouvementAttendu(recolte: RecolteLiee, sommeChaine: number): number | null {
  if (recolte.remplaceSorte === null) return null;
  const somme = enMillioniemes(sommeChaine);
  const attendu = recolte.remplaceSorte === 'annulation' ? -somme : enMillioniemes(recolte.quantite) - somme;
  // `+ 0` : jamais de −0 (annulation d'une chaîne vide).
  return attendu / ECHELLE + 0;
}

/**
 * Le mouvement de motif `recolte` est-il cohérent avec la récolte qu'il vise ? null si oui,
 * sinon la règle violée (message en français) :
 *   - rattaché à la récolte d'origine : entrée positive seulement (on ne vide pas le stock par
 *     une fausse récolte) ;
 *   - rattaché à une annulation ou une correction : exactement `mouvementAttendu`.
 */
export function verifierMouvementRecolte(quantite: number, recolte: RecolteLiee, sommeChaine: number): ErreurSaisie | null {
  const attendu = mouvementAttendu(recolte, sommeChaine);
  if (attendu === null) {
    return quantite > 0
      ? null
      : erreur('incoherent', 'quantite', 'sortie de stock rattachée à une récolte : seule une annulation ou une correction retire du stock');
  }
  if (enMillioniemes(quantite) === enMillioniemes(attendu)) return null;
  const sorte = recolte.remplaceSorte === 'annulation' ? "l'annulation" : 'la correction';
  return erreur('incoherent', 'quantite', `mouvement de ${sorte} : ${String(attendu)} attendu sur cet article`);
}

