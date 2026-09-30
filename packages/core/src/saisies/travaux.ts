/**
 * Règles d'un travail prévu d'itinéraire (T22) : pures, ne lèvent jamais, comme `validerSerie`.
 * Le serveur (T23) les rejoue à l'écriture d'un itinéraire, `validerSerie` sur l'instantané
 * d'une série ; l'écran des itinéraires (T24) s'en sert avant d'écrire. Contrat :
 * ../planification/test/contrat-travaux.ts.
 */
import type {
  CategorieIntervention,
  ModeItineraire,
  ProduitTravail,
  RepereTravail,
  TempsEstime,
  TravailPrevu,
} from '../domaine/index.ts';
import { PLAFONDS_PROVISOIRES, type CodeErreurSaisie, type ErreurSaisie } from './index.ts';

export type ResultatTravaux<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

/**
 * Plafonds d'un travail prévu, bornes comprises. Ils arrêtent une faute de frappe, pas une vraie
 * ferme ; et le pire itinéraire valide (`nombre` travaux, tous les champs remplis, textes au
 * plafond) tient dans l'instantané d'une série (PARAMETRES_SERIE_OCTETS, 8 192 octets) : un
 * itinéraire valide donne toujours une série que le serveur accepte.
 */
export const PLAFONDS_TRAVAUX = {
  /** Travaux prévus par itinéraire. */
  nombre: 12,
  /** Caractères (unités UTF-16) d'un type, d'un outil, d'un nom de produit ou d'une unité. */
  texte: 30,
  /** Décalage au repère, en jours, dans les deux sens (un an). */
  decalageJours: 365,
  /** Période d'une répétition, en jours. */
  tousLesJours: 60,
  /** Temps estimé, en minutes par 100 m ou par planche (10 h). */
  minutes: 600,
} as const;

export interface OptionsTravaux {
  /** Mode de l'itinéraire : un repère « semis en pépinière » n'existe qu'en plant maison. */
  readonly mode?: ModeItineraire;
  /** Types d'intervention de la ferme (T23) : le couple (catégorie, type) doit y être. */
  readonly typesIntervention?: readonly { readonly categorie: string; readonly type: string }[];
}

/** Repères dans l'ordre chronologique des étapes d'une série. */
export const REPERES_TRAVAIL = ['semis_pepiniere', 'mise_en_place', 'debut_recolte', 'fin_recolte'] as const satisfies readonly RepereTravail[];

const CATEGORIES = ['travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'] as const satisfies readonly CategorieIntervention[];
const PAR = ['cent_metres', 'planche'] as const satisfies readonly TempsEstime['par'][];

const CLES_TRAVAIL = ['categorie', 'type', 'repere', 'decalageJours', 'repetition', 'outil', 'produit', 'tempsEstime'];
const CLES_REPETITION = ['tousLesJours', 'repereFin'];
const CLES_PRODUIT = ['nom', 'quantite'];
const CLES_QUANTITE = ['valeur', 'unite'];
const CLES_TEMPS = ['minutes', 'par'];

/** Catégories dont l'intervention exige un produit et sa quantité (validerSaisie). */
export const CATEGORIES_AVEC_PRODUIT: readonly CategorieIntervention[] = ['fertilisation', 'amendement'];

/**
 * Caractères de contrôle et demi-paires de substitution : ils s'écrivent en JSON sur 6 octets
 * (\u0001), et casseraient la garantie des 8 192 octets de l'instantané. Aucun libellé n'en a besoin.
 */
function texteInterdit(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const suivant = v.charCodeAt(i + 1);
      if (!(suivant >= 0xdc00 && suivant <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

type Objet = Readonly<Record<string, unknown>>;
type Lu<T> = ResultatTravaux<T>;

const erreur = (code: CodeErreurSaisie, champ: string | null, message: string): ErreurSaisie => ({ code, champ, message });
const echec = <T>(e: ErreurSaisie): Lu<T> => ({ ok: false, erreur: e });
const lu = <T>(valeur: T): Lu<T> => ({ ok: true, valeur });
const absent = (v: unknown): v is null | undefined => v === undefined || v === null;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const parmi = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
const extrait = (texte: string): string => (texte.length > 40 ? `${texte.slice(0, 40)}…` : texte);
const copiePropre = (o: Objet): Objet => Object.fromEntries(Object.keys(o).map((cle) => [cle, o[cle]]));
const P = PLAFONDS_TRAVAUX;

function cleInconnue(o: Objet, permises: readonly string[], prefixe: string): ErreurSaisie | null {
  const cle = Object.keys(o).find((c) => !permises.includes(c));
  return cle === undefined ? null : erreur('cle_inconnue', `${prefixe}${extrait(cle)}`, `clé inconnue : ${extrait(cle)}`);
}

/** Texte non vide (après espaces), de `P.texte` caractères au plus. */
function texte(v: unknown, champ: string, libelle: string): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (typeof v !== 'string' || v.trim() === '') return echec(erreur('champ_invalide', champ, `${libelle} : texte non vide attendu`));
  if (v.length > P.texte) return echec(erreur('trop_long', champ, `${libelle} : ${String(P.texte)} caractères au plus`));
  if (texteInterdit(v)) return echec(erreur('champ_invalide', champ, `${libelle} : caractère invalide`));
  return lu(v);
}

function repere(v: unknown, champ: string, libelle: string): Lu<RepereTravail> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (!parmi(REPERES_TRAVAIL, v)) return echec(erreur('champ_invalide', champ, `${libelle} inconnu`));
  return lu(v);
}

/** Entier (un nombre, pas un texte) dans [min, max]. */
function entier(v: unknown, champ: string, libelle: string, min: number, max: number): Lu<number> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (typeof v !== 'number' || !Number.isInteger(v)) return echec(erreur('champ_invalide', champ, `${libelle} : nombre entier attendu`));
  if (v > max) return echec(erreur('plafond_depasse', champ, `${libelle} au-delà du plafond (${String(max)} au plus)`));
  if (v < min) return echec(erreur('hors_bornes', champ, `${libelle} : ${String(min)} au moins`));
  return lu(v);
}

/** Le repère « semis en pépinière » n'existe qu'en plant maison. */
function repereDuMode(r: RepereTravail, mode: ModeItineraire | undefined, champ: string): ErreurSaisie | null {
  if (mode === undefined || mode === 'plant_maison' || r !== 'semis_pepiniere') return null;
  return erreur('incoherent', champ, 'pas de semis en pépinière dans cet itinéraire (plant maison seulement)');
}

type Repetition = TravailPrevu['repetition'];

function lireRepetition(v: unknown, debut: RepereTravail, decalage: number, mode: ModeItineraire | undefined): Lu<Repetition> {
  if (absent(v)) return lu(null);
  if (!estObjet(v)) return echec(erreur('champ_invalide', 'repetition', 'répétition : objet attendu'));
  const r = copiePropre(v);
  const inconnue = cleInconnue(r, CLES_REPETITION, 'repetition.');
  if (inconnue !== null) return echec(inconnue);
  const n = entier(r.tousLesJours, 'repetition.tousLesJours', 'période de répétition', 1, P.tousLesJours);
  if (!n.ok) return n;
  const fin = repere(r.repereFin, 'repetition.repereFin', 'repère de fin');
  if (!fin.ok) return fin;
  const rangDebut = REPERES_TRAVAIL.indexOf(debut);
  const rangFin = REPERES_TRAVAIL.indexOf(fin.valeur);
  if (rangFin < rangDebut || (rangFin === rangDebut && decalage > 0)) {
    return echec(erreur('incoherent', 'repetition.repereFin', 'la répétition finirait avant de commencer'));
  }
  const duMode = repereDuMode(fin.valeur, mode, 'repetition.repereFin');
  if (duMode !== null) return echec(duMode);
  return lu({ tousLesJours: n.valeur, repereFin: fin.valeur });
}

function lireProduit(v: unknown, categorie: CategorieIntervention): Lu<ProduitTravail | null> {
  const avecProduit = CATEGORIES_AVEC_PRODUIT.includes(categorie);
  if (absent(v)) return avecProduit ? echec(erreur('champ_manquant', 'produit', 'produit manquant (fertilisation et amendement)')) : lu(null);
  if (!avecProduit) return echec(erreur('incoherent', 'produit', 'un produit ne va qu’avec une fertilisation ou un amendement'));
  if (!estObjet(v)) return echec(erreur('champ_invalide', 'produit', 'produit : nom et quantité attendus'));
  const p = copiePropre(v);
  const inconnue = cleInconnue(p, CLES_PRODUIT, 'produit.');
  if (inconnue !== null) return echec(inconnue);
  const nom = texte(p.nom, 'produit.nom', 'nom du produit');
  if (!nom.ok) return nom;
  if (absent(p.quantite)) return echec(erreur('champ_manquant', 'produit.quantite', 'quantité manquante'));
  if (!estObjet(p.quantite)) return echec(erreur('champ_invalide', 'produit.quantite', 'quantité : valeur et unité attendues'));
  const q = copiePropre(p.quantite);
  const inconnueQ = cleInconnue(q, CLES_QUANTITE, 'produit.quantite.');
  if (inconnueQ !== null) return echec(inconnueQ);
  const valeur = q.valeur;
  if (absent(valeur)) return echec(erreur('champ_manquant', 'produit.quantite.valeur', 'quantité manquante'));
  if (typeof valeur !== 'number' || !Number.isFinite(valeur) || valeur <= 0) {
    return echec(erreur('champ_invalide', 'produit.quantite.valeur', 'quantité : nombre positif attendu'));
  }
  // Même plafond que la quantité d'une intervention : « Fait » l'écrit telle quelle.
  if (valeur > PLAFONDS_PROVISOIRES.interventionQuantite) {
    return echec(erreur('plafond_depasse', 'produit.quantite.valeur', `quantité au-delà du plafond (${String(PLAFONDS_PROVISOIRES.interventionQuantite)} au plus)`));
  }
  const unite = texte(q.unite, 'produit.quantite.unite', 'unité');
  if (!unite.ok) return unite;
  return lu({ nom: nom.valeur, quantite: { valeur, unite: unite.valeur } });
}

function lireTemps(v: unknown): Lu<TempsEstime | null> {
  if (absent(v)) return lu(null);
  if (!estObjet(v)) return echec(erreur('champ_invalide', 'tempsEstime', 'temps estimé : minutes et unité attendues'));
  const t = copiePropre(v);
  const inconnue = cleInconnue(t, CLES_TEMPS, 'tempsEstime.');
  if (inconnue !== null) return echec(inconnue);
  const minutes = entier(t.minutes, 'tempsEstime.minutes', 'temps estimé', 1, P.minutes);
  if (!minutes.ok) return minutes;
  if (absent(t.par)) return echec(erreur('champ_manquant', 'tempsEstime.par', 'unité du temps estimé manquante'));
  if (!parmi(PAR, t.par)) return echec(erreur('champ_invalide', 'tempsEstime.par', 'temps estimé : par 100 m ou par planche'));
  return lu({ minutes: minutes.valeur, par: t.par });
}

function lireTravail(v: Objet, options: OptionsTravaux): Lu<TravailPrevu> {
  const inconnue = cleInconnue(v, CLES_TRAVAIL, '');
  if (inconnue !== null) return echec(inconnue);
  if (absent(v.categorie)) return echec(erreur('champ_manquant', 'categorie', 'catégorie manquante'));
  if (!parmi(CATEGORIES, v.categorie)) return echec(erreur('champ_invalide', 'categorie', 'catégorie inconnue'));
  const categorie = v.categorie;
  const type = texte(v.type, 'type', "type d'intervention");
  if (!type.ok) return type;
  const types = options.typesIntervention;
  if (types !== undefined && !types.some((t) => t.categorie === categorie && t.type === type.valeur)) {
    return echec(erreur('champ_invalide', 'type', `« ${extrait(type.valeur)} » n’est pas un type d’intervention de la ferme dans cette catégorie`));
  }
  const r = repere(v.repere, 'repere', 'repère');
  if (!r.ok) return r;
  const duMode = repereDuMode(r.valeur, options.mode, 'repere');
  if (duMode !== null) return echec(duMode);
  const decalage = entier(v.decalageJours, 'decalageJours', 'décalage en jours', -P.decalageJours, P.decalageJours);
  if (!decalage.ok) return decalage;
  const repetition = lireRepetition(v.repetition, r.valeur, decalage.valeur, options.mode);
  if (!repetition.ok) return repetition;
  let outil: string | null = null;
  if (!absent(v.outil)) {
    const o = texte(v.outil, 'outil', 'outil');
    if (!o.ok) return o;
    outil = o.valeur;
  }
  const produit = lireProduit(v.produit, categorie);
  if (!produit.ok) return produit;
  const temps = lireTemps(v.tempsEstime);
  if (!temps.ok) return temps;
  return lu({
    categorie,
    type: type.valeur,
    repere: r.valeur,
    decalageJours: decalage.valeur,
    repetition: repetition.valeur,
    outil,
    produit: produit.valeur,
    tempsEstime: temps.valeur,
  });
}

/** Filet : accesseur qui lève, Proxy… jamais d'exception. */
function sansException<T>(lire: () => Lu<T>): Lu<T> {
  try {
    return lire();
  } catch {
    return echec(erreur('entree_invalide', null, 'travail prévu illisible'));
  }
}

/**
 * Valide un travail prévu et le rend normalisé (toutes les clés, `null` pour les facultatives
 * absentes), ou renvoie la première règle violée.
 */
export function validerTravailPrevu(entree: unknown, options: OptionsTravaux = {}): ResultatTravaux<TravailPrevu> {
  return sansException(() => (estObjet(entree) ? lireTravail(copiePropre(entree), options) : echec(erreur('entree_invalide', null, 'travail prévu : objet attendu'))));
}

/**
 * Valide la liste des travaux prévus d'un itinéraire (ou d'un instantané de série) : un tableau
 * d'au plus `PLAFONDS_TRAVAUX.nombre` travaux ; le champ d'une erreur est préfixé par l'indice.
 */
export function validerTravauxPrevus(entree: unknown, options: OptionsTravaux = {}): ResultatTravaux<readonly TravailPrevu[]> {
  return sansException(() => {
    if (!Array.isArray(entree)) return echec(erreur('champ_invalide', null, 'travaux prévus : liste attendue'));
    const liste: readonly unknown[] = entree;
    if (liste.length > P.nombre) return echec(erreur('trop_nombreux', null, `${String(P.nombre)} travaux prévus au plus par itinéraire`));
    const valeur: TravailPrevu[] = [];
    for (const [i, t] of liste.entries()) {
      const r = validerTravailPrevu(t, options);
      if (!r.ok) {
        const champ = r.erreur.champ === null ? String(i) : `${String(i)}.${r.erreur.champ}`;
        return echec({ ...r.erreur, champ });
      }
      valeur.push(r.valeur);
    }
    return lu(valeur);
  });
}
