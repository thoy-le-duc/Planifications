/**
 * La fiche « Serre ou tunnel » (T89) : valeurs par défaut, résumé calculé, type du bâtiment et noms des zones. Calcul pur, au
 * millimètre (mètres et centimètres entiers comparés en millimètres : pas d'erreur de virgule flottante). Les valeurs par défaut
 * restent à confirmer par Théophane (Q55) ; seules elles en dépendent.
 */
import { GRILLE_SERRE } from './cases.ts';
import { PASSE_PIED_MAX_CM } from './parcelle.ts';
import { PLAFONDS_BATIMENT } from './validation.ts';

export interface PlanchesDeSerre {
  /** Planches par zone (une zone = une case de la serre). */
  readonly nombre: number;
  readonly largeurCm: number;
  readonly longueurM: number;
  readonly passePiedCm: number;
}

export interface FicheSerre {
  readonly nom: string;
  readonly largeurChapelleM: number;
  readonly nbChapelles: number;
  readonly longueurTronconM: number;
  readonly nbTroncons: number;
  readonly largeurAlleeM: number;
  /** Préfixe des zones (« Serre à légumes » → « Serre à légumes 1 », « 2 »…). */
  readonly prefixeZones: string;
  readonly planches: PlanchesDeSerre;
}

/** Mesures d'une serre précédente, reprises comme valeurs par défaut. */
export type MesuresSerre = Pick<FicheSerre, 'largeurChapelleM' | 'nbChapelles' | 'longueurTronconM' | 'nbTroncons' | 'largeurAlleeM'> & {
  readonly planches?: PlanchesDeSerre;
};

export interface ResumeSerre {
  readonly largeurM: number;
  readonly longueurM: number;
  readonly nbZones: number;
  readonly nbPlanches: number;
  /** « 57,6 × 128,8 m, 18 zones, 144 planches ». */
  readonly texte: string;
}

/** Valeurs par défaut sans serre précédente (Q55, à confirmer). */
export const DEFAUTS_SERRE = {
  largeurChapelleM: 9.6,
  nbChapelles: 1,
  longueurTronconM: 40,
  nbTroncons: 1,
  largeurAlleeM: 4.4,
  plancheLargeurCm: 75,
  passePiedCm: 45,
  /** Longueur des planches = longueur du tronçon − 2 m (un mètre de passage à chaque bout). */
  retraitPlancheM: 2,
} as const;

/** Plafond du nombre de planches par zone saisi dans la fiche. */
export const PLANCHES_PAR_ZONE_MAX = 200;

/** Au millimètre ; `+ 0` efface le zéro négatif. */
const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const enMm = (v: number): number => Math.round(v * 1000);

/**
 * Le plus grand n tel que n × largeur + (n − 1) × passe-pied ≤ largeur de chapelle, comparé en millimètres entiers ; 0 si même une
 * planche n'entre pas (ou si une mesure n'est pas un nombre positif).
 */
export function nombrePlanchesParDefaut(largeurChapelleM: number, largeurPlancheCm: number, passePiedCm: number): number {
  const chapelle = enMm(largeurChapelleM);
  const planche = Math.round(largeurPlancheCm * 10);
  const passePied = Math.max(0, Math.round(passePiedCm * 10));
  if (!Number.isFinite(chapelle) || !Number.isFinite(planche) || !Number.isFinite(passePied) || planche <= 0 || chapelle < planche) return 0;
  return Math.floor((chapelle + passePied) / (planche + passePied));
}

function planchesPour(largeurChapelleM: number, longueurTronconM: number): PlanchesDeSerre {
  return {
    nombre: nombrePlanchesParDefaut(largeurChapelleM, DEFAUTS_SERRE.plancheLargeurCm, DEFAUTS_SERRE.passePiedCm),
    largeurCm: DEFAUTS_SERRE.plancheLargeurCm,
    longueurM: Math.max(0, mm(longueurTronconM - DEFAUTS_SERRE.retraitPlancheM)),
    passePiedCm: DEFAUTS_SERRE.passePiedCm,
  };
}

/** Les valeurs de départ de la fiche : celles de la dernière serre créée sur la ferme, sinon DEFAUTS_SERRE. Nom et préfixe vides. */
export function defautsSerre(derniere?: MesuresSerre | null): FicheSerre {
  const m: MesuresSerre = derniere ?? DEFAUTS_SERRE;
  return {
    nom: '',
    largeurChapelleM: m.largeurChapelleM,
    nbChapelles: m.nbChapelles,
    longueurTronconM: m.longueurTronconM,
    nbTroncons: m.nbTroncons,
    largeurAlleeM: m.largeurAlleeM,
    prefixeZones: '',
    planches: derniere?.planches ?? planchesPour(m.largeurChapelleM, m.longueurTronconM),
  };
}

const virgule = (v: number): string => String(v).replace('.', ',');
const compter = (n: number, mot: string): string => `${String(n)} ${mot}${n >= 2 ? 's' : ''}`;

/** Les dimensions totales de la serre, ses zones et ses planches ; le texte du résumé de la fiche. */
export function resumeSerre(f: FicheSerre): ResumeSerre {
  const largeurM = mm(f.nbChapelles * f.largeurChapelleM);
  const longueurM = mm(f.nbTroncons * f.longueurTronconM + Math.max(0, f.nbTroncons - 1) * f.largeurAlleeM);
  const nbZones = f.nbChapelles * f.nbTroncons;
  const nbPlanches = nbZones * f.planches.nombre;
  const texte = `${virgule(largeurM)} × ${virgule(longueurM)} m, ${compter(nbZones, 'zone')}, ${compter(nbPlanches, 'planche')}`;
  return { largeurM, longueurM, nbZones, nbPlanches, texte };
}

/** Une chapelle : tunnel ; plusieurs : serre à chapelles. */
export const typeDeSerre = (nbChapelles: number): 'serre_tunnel' | 'serre_chapelle' => (nbChapelles === 1 ? 'serre_tunnel' : 'serre_chapelle');

/** « Serre à légumes 1 » à « Serre à légumes n ». */
export const nomsDesZones = (prefixe: string, n: number): string[] => Array.from({ length: Math.max(0, n) }, (_x, i) => `${prefixe.trim()} ${String(i + 1)}`);

const positif = (v: number): boolean => Number.isFinite(v) && v > 0;
const entierDans = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;

/**
 * Pourquoi la fiche ne peut pas créer la serre, ou null si elle le peut. Mêmes bornes que la base et le serveur (grille T88,
 * plafonds d'un bâtiment, passe-pied de T85), plus une allée plus étroite qu'un tronçon (au-delà, c'est une erreur de saisie).
 */
export function erreurFicheSerre(f: FicheSerre): string | null {
  if (f.nom.trim() === '') return 'Donnez un nom à la serre.';
  if (!positif(f.largeurChapelleM)) return 'La largeur d’une chapelle doit être un nombre de mètres plus grand que 0.';
  if (!entierDans(f.nbChapelles, 1, GRILLE_SERRE.chapellesMax)) return `Le nombre de chapelles est un nombre entier de 1 à ${String(GRILLE_SERRE.chapellesMax)}.`;
  if (!positif(f.longueurTronconM)) return 'La longueur d’un tronçon doit être un nombre de mètres plus grand que 0.';
  if (!entierDans(f.nbTroncons, 1, GRILLE_SERRE.tronconsMax)) return `Le nombre de tronçons est un nombre entier de 1 à ${String(GRILLE_SERRE.tronconsMax)}.`;
  if (f.nbTroncons > 1) {
    if (!Number.isFinite(f.largeurAlleeM) || f.largeurAlleeM < 0) return 'L’allée entre tronçons doit être un nombre de mètres, 0 ou plus.';
    if (enMm(f.largeurAlleeM) >= enMm(f.longueurTronconM)) return 'L’allée entre tronçons est plus large qu’un tronçon : vérifiez la saisie.';
  }
  const r = resumeSerre(f);
  if (r.longueurM > PLAFONDS_BATIMENT.longueurM) return `La serre ferait ${virgule(r.longueurM)} m de long : ${String(PLAFONDS_BATIMENT.longueurM)} m au plus.`;
  if (r.largeurM > PLAFONDS_BATIMENT.largeurM) return `La serre ferait ${virgule(r.largeurM)} m de large : ${String(PLAFONDS_BATIMENT.largeurM)} m au plus.`;
  if (f.prefixeZones.trim() === '') return 'Donnez le préfixe du nom des zones.';
  const p = f.planches;
  if (!entierDans(p.nombre, 0, PLANCHES_PAR_ZONE_MAX)) return `Le nombre de planches par zone est un nombre entier de 0 à ${String(PLANCHES_PAR_ZONE_MAX)}.`;
  if (p.nombre > 0) {
    if (!positif(p.largeurCm)) return 'La largeur des planches doit être un nombre de centimètres plus grand que 0.';
    if (!positif(p.longueurM)) return 'La longueur des planches doit être un nombre de mètres plus grand que 0.';
    if (enMm(p.longueurM) > enMm(f.longueurTronconM)) return 'Les planches sont plus longues qu’un tronçon de la serre.';
    if (!entierDans(p.passePiedCm, 0, PASSE_PIED_MAX_CM)) return `Le passe-pied est un nombre entier de centimètres, de 0 à ${String(PASSE_PIED_MAX_CM)}.`;
  }
  return null;
}
