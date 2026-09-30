/**
 * Règles d'une série et de ses occupations écrites par un téléphone (T10e, écran de T12). Pures,
 * comme `validerSaisie` (T10b) et `validerArticleStock` (T10c) : ni base, ni réseau, ni horloge,
 * ne lèvent jamais. Le serveur (apps/api/src/sync/serie.ts) les rejoue à chaque PUT et à chaque
 * PATCH, sur la ligne complète ; le téléphone peut s'en servir avant d'écrire.
 *
 * Principe 2 : les dates prévues ne sont jamais crues sur parole. Elles doivent valoir exactement
 * celles que `calculerDatesSerie` (T02) tire des paramètres et de l'ancre.
 *
 * Ce qui reste à l'appelant (base de données) : la ferme du jeton, l'appartenance des références
 * (saison, espèce, variété, itinéraire, emplacement, série) à la ferme, la cohérence espèce ↔
 * variété ↔ itinéraire, et la cohérence de toutes les occupations d'une série en fin de lot.
 */
import type {
  AncreSerie,
  Id,
  Occupation,
  ParametresItineraire,
  PlaceOccupee,
  RotationAcceptee,
  Serie,
  StatutSerie,
  TailleSerie,
  TypeAncreSerie,
} from '../domaine/index.ts';
import { calculerDatesSerie, ETAPES_SERIE, type DatesSerie } from '../planification/dates-serie.ts';
import type { ErreurSaisie } from './index.ts';
import {
  absent,
  colonnesConnues,
  copiePropre,
  date,
  DATE_MAX,
  DATE_MIN,
  dateOuNul,
  echec,
  erreur,
  estObjet,
  extrait,
  id,
  idOuNul,
  INSTANT_MAX,
  INSTANT_MIN,
  json,
  lireParametres,
  lu,
  sansException,
  supprimeLe,
  valeurParmi,
  type Lu,
  type Objet,
} from './lignes.ts';

export { PARAMETRES_SERIE_OCTETS } from './lignes.ts';

export type ResultatLigneSerie<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

/**
 * Plafonds d'une série et d'une occupation, bornes comprises, validés par Théophane (Q21,
 * 2026-09-30) : 10 000 m de planche et 1 000 000 de plants. Ils arrêtent une faute de frappe
 * (1e308 m), pas une grande série.
 */
export const PLAFONDS_SERIE = {
  /** longueur_m d'une série ou d'une occupation. */
  longueurM: 10_000,
  /** nombre_plants d'une série, nombre_places d'une occupation. */
  nombrePlants: 1_000_000,
} as const;

/** Délai de retour au plus d'une alerte de rotation acceptée, en années. */
export const DELAI_ROTATION_MAX_ANS = 100;

const ANCRES = ['semis', 'plantation', 'debut_recolte'] as const satisfies readonly TypeAncreSerie[];
const STATUTS = ['prevue', 'en_cours', 'terminee', 'abandonnee'] as const satisfies readonly StatutSerie[];

/** Colonnes d'une ligne `serie` reçue ; horodatages tolérés (remplis par le serveur). */
const COLONNES_SERIE = new Set([
  'id',
  'ferme_id',
  'saison_id',
  'espece_id',
  'variete_id',
  'itineraire_id',
  'parametres',
  'ancre_type',
  'ancre_date',
  'prevu_semis_pepiniere',
  'prevu_mise_en_place',
  'prevu_debut_recolte',
  'prevu_fin_recolte',
  'longueur_m',
  'nombre_plants',
  'statut',
  'rotation_acceptee',
  'cree_le',
  'modifie_le',
  'supprime_le',
]);

/** Colonnes d'une ligne `occupation` reçue ; horodatages tolérés (remplis par le serveur). */
const COLONNES_OCCUPATION = new Set([
  'id',
  'ferme_id',
  'emplacement_id',
  'serie_id',
  'plantation_id',
  'evenement_id',
  'longueur_m',
  'nombre_places',
  'position_m',
  'prevu_du',
  'prevu_au',
  'reel_du',
  'reel_au',
  'cree_le',
  'modifie_le',
  'supprime_le',
]);

/** Colonnes prévues d'une série, dans l'ordre des étapes de T02 (la première fausse est signalée). */
const COLONNES_DATES: Readonly<Record<(typeof ETAPES_SERIE)[number], string>> = {
  semisPepiniere: 'prevu_semis_pepiniere',
  miseEnPlace: 'prevu_mise_en_place',
  debutRecolte: 'prevu_debut_recolte',
  finRecolte: 'prevu_fin_recolte',
};

const CLES_ROTATION = ['famille', 'delai_ans', 'le'];


/** Instant de la décision de rotation : la forme exacte de `toISOString`, rangée telle quelle. */
const MOTIF_INSTANT_CANONIQUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface RegleTaille {
  readonly libelle: string;
  readonly plafond: number;
  readonly entier: boolean;
}

/** Nombre (pas un texte), fini, > 0, entier si demandé, ≤ plafond. */
function taille(v: unknown, champ: string, r: RegleTaille): Lu<number> {
  if (typeof v !== 'number' || !Number.isFinite(v)) return echec(erreur('champ_invalide', champ, `${r.libelle} : nombre attendu`));
  if (r.entier && !Number.isInteger(v)) return echec(erreur('champ_invalide', champ, `${r.libelle} : nombre entier attendu`));
  if (v <= 0) return echec(erreur('champ_invalide', champ, `${r.libelle} : nombre positif attendu`));
  if (v > r.plafond) return echec(erreur('plafond_depasse', champ, `${r.libelle} au-delà du plafond (${String(r.plafond)} au plus)`));
  return lu(v);
}

/** Exactement l'une des deux colonnes : la première (`a`) ou la seconde (`b`). */
function uneDesDeux(l: Objet, a: string, b: string, libelle: string): Lu<'a' | 'b'> {
  const avecA = !absent(l[a]);
  const avecB = !absent(l[b]);
  if (avecA && avecB) return echec(erreur('incoherent', b, `${libelle} : ${a} ou ${b}, pas les deux`));
  if (!avecA && !avecB) return echec(erreur('champ_manquant', null, `${libelle} manquante (${a} ou ${b})`));
  return lu(avecA ? 'a' : 'b');
}

/** Dates de T02 depuis les paramètres et l'ancre, bornées à [2000, 2100] ; jamais d'exception. */
function datesCalculees(parametres: ParametresItineraire, ancre: AncreSerie): Lu<DatesSerie> {
  if (ancre.type === 'semis' && parametres.mode === 'plant_achete') {
    return echec(erreur('incoherent', 'ancre_type', "un plant acheté n'a pas de semis à la ferme : ancrer sur la plantation ou la récolte"));
  }
  let dates: DatesSerie;
  try {
    dates = calculerDatesSerie(parametres, ancre);
  } catch {
    return echec(erreur('hors_bornes', 'parametres', 'durées démesurées : dates hors de 2000 … 2100'));
  }
  for (const etape of ETAPES_SERIE) {
    const d = dates[etape];
    if (d !== undefined && (d < DATE_MIN || d > DATE_MAX)) {
      return echec(erreur('hors_bornes', 'parametres', `durées démesurées : dates hors de ${DATE_MIN} … ${DATE_MAX}`));
    }
  }
  return lu(dates);
}

/** Les dates prévues reçues valent exactement celles du cœur ; sinon la première fausse. */
function verifierDatesPrevues(l: Objet, attendues: DatesSerie): ErreurSaisie | null {
  for (const etape of ETAPES_SERIE) {
    const colonne = COLONNES_DATES[etape];
    const attendue = attendues[etape] ?? null;
    const recue = l[colonne] ?? null;
    if (recue !== attendue) {
      const detail = attendue === null ? 'sans objet pour ce mode de culture (vide attendu)' : `${attendue} attendu`;
      return erreur('incoherent', colonne, `${colonne} : pas la date calculée depuis l'ancre (${detail})`);
    }
  }
  return null;
}

// ── rotation_acceptee ────────────────────────────────────────────────────────────────────────

function lireRotation(v: unknown): Lu<RotationAcceptee | null> {
  const champ = 'rotation_acceptee';
  if (absent(v)) return lu(null);
  const valeur = json(v, champ, 'décision de rotation');
  if (!valeur.ok) return valeur;
  if (absent(valeur.valeur)) return lu(null);
  if (!estObjet(valeur.valeur)) return echec(erreur('champ_invalide', champ, 'décision de rotation : objet attendu'));
  const r = copiePropre(valeur.valeur);
  const cle = Object.keys(r).find((c) => !CLES_ROTATION.includes(c));
  if (cle !== undefined) return echec(erreur('cle_inconnue', `${champ}.${extrait(cle)}`, `clé inconnue dans la décision de rotation : ${extrait(cle)}`));

  const famille = id(r.famille, `${champ}.famille`, 'famille botanique');
  if (!famille.ok) return famille;

  const delai = r.delai_ans;
  if (absent(delai)) return echec(erreur('champ_manquant', `${champ}.delai_ans`, 'délai de retour manquant'));
  if (typeof delai !== 'number' || !Number.isInteger(delai)) {
    return echec(erreur('champ_invalide', `${champ}.delai_ans`, "délai de retour : nombre entier d'années attendu"));
  }
  if (delai < 0 || delai > DELAI_ROTATION_MAX_ANS) {
    return echec(erreur('hors_bornes', `${champ}.delai_ans`, `délai de retour hors de 0 … ${String(DELAI_ROTATION_MAX_ANS)} ans`));
  }

  const le = r.le;
  if (absent(le)) return echec(erreur('champ_manquant', `${champ}.le`, 'instant de la décision manquant'));
  const instant = typeof le === 'string' && MOTIF_INSTANT_CANONIQUE.test(le) ? Date.parse(le) : Number.NaN;
  // Aller-retour exact : écarte le 30 février et 24:00, que Date.parse accepterait en les décalant.
  if (Number.isNaN(instant) || new Date(instant).toISOString() !== le) {
    return echec(erreur('champ_invalide', `${champ}.le`, "instant de la décision : 'AAAA-MM-JJTHH:MM:SS.sssZ' attendu"));
  }
  if (instant < INSTANT_MIN || instant > INSTANT_MAX) return echec(erreur('hors_bornes', `${champ}.le`, 'instant de la décision hors de 2000 … 2100'));
  return lu({ familleId: famille.valeur as Id<'Famille'>, delaiAns: delai, le: instant });
}

// ── serie ────────────────────────────────────────────────────────────────────────────────────

function lireSerie(l: Objet): Lu<Serie> {
  const inconnue = colonnesConnues(l, COLONNES_SERIE);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant de la série');
  if (!identifiant.ok) return identifiant;
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const saison = id(l.saison_id, 'saison_id', 'saison');
  if (!saison.ok) return saison;
  const espece = id(l.espece_id, 'espece_id', 'espèce');
  if (!espece.ok) return espece;
  const variete = idOuNul(l.variete_id, 'variete_id', 'variété');
  if (!variete.ok) return variete;
  const itineraire = id(l.itineraire_id, 'itineraire_id', 'itinéraire');
  if (!itineraire.ok) return itineraire;

  const parametres = lireParametres(l.parametres);
  if (!parametres.ok) return parametres;
  const ancreType = valeurParmi(l.ancre_type, ANCRES, 'ancre_type', "type d'ancre");
  if (!ancreType.ok) return ancreType;
  const ancreDate = date(l.ancre_date, 'ancre_date', "date d'ancre");
  if (!ancreDate.ok) return ancreDate;
  const statut = valeurParmi(l.statut, STATUTS, 'statut', 'statut');
  if (!statut.ok) return statut;

  const unite = uneDesDeux(l, 'longueur_m', 'nombre_plants', 'taille de la série');
  if (!unite.ok) return unite;
  let tailleSerie: TailleSerie;
  if (unite.valeur === 'a') {
    const n = taille(l.longueur_m, 'longueur_m', { libelle: 'longueur', plafond: PLAFONDS_SERIE.longueurM, entier: false });
    if (!n.ok) return n;
    tailleSerie = { unite: 'longueur', longueurM: n.valeur };
  } else {
    const n = taille(l.nombre_plants, 'nombre_plants', { libelle: 'nombre de plants', plafond: PLAFONDS_SERIE.nombrePlants, entier: true });
    if (!n.ok) return n;
    tailleSerie = { unite: 'plants', nombrePlants: n.valeur };
  }

  const ancre = { type: ancreType.valeur, date: ancreDate.valeur } as AncreSerie;
  const dates = datesCalculees(parametres.valeur, ancre);
  if (!dates.ok) return dates;
  const faussee = verifierDatesPrevues(l, dates.valeur);
  if (faussee !== null) return echec(faussee);

  const rotation = lireRotation(l.rotation_acceptee);
  if (!rotation.ok) return rotation;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;

  return lu({
    id: identifiant.valeur as Id<'Serie'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    supprimeLe: suppression.valeur,
    saisonId: saison.valeur as Id<'Saison'>,
    especeId: espece.valeur as Id<'Espece'>,
    varieteId: variete.valeur as Id<'Variete'> | null,
    itineraireId: itineraire.valeur as Id<'Itineraire'>,
    parametres: parametres.valeur,
    ancre,
    datesPrevues: dates.valeur,
    taille: tailleSerie,
    statut: statut.valeur,
    ...(rotation.valeur === null ? {} : { rotationAcceptee: rotation.valeur }),
  });
}

/**
 * Valide une ligne `serie` (format PowerSync, avec son `id` ; `parametres` et
 * `rotation_acceptee` en texte JSON ou en objet) et la rend en `Serie` de T01, ou renvoie la
 * première règle violée. Contrat : ./test/contrat-serie.ts.
 */
export function validerSerie(entree: unknown): ResultatLigneSerie<Serie> {
  return sansException(entree, lireSerie);
}

// ── occupation ───────────────────────────────────────────────────────────────────────────────

export interface OptionsOccupation {
  /**
   * Vérifier que prevu_du et prevu_au valent la mise en place et la fin de récolte de la série
   * (par défaut). Le serveur s'en passe écriture par écriture, et le vérifie en fin de lot, une
   * fois la série et toutes ses occupations écrites (décision 1 du chef, T10e).
   */
  readonly datesDeLaSerie?: boolean;
}

function lireOccupation(l: Objet, serie: Serie, options: OptionsOccupation): Lu<Occupation> {
  const inconnue = colonnesConnues(l, COLONNES_OCCUPATION);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', "identifiant de l'occupation");
  if (!identifiant.ok) return identifiant;
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const emplacement = id(l.emplacement_id, 'emplacement_id', 'emplacement');
  if (!emplacement.ok) return emplacement;
  const serieId = id(l.serie_id, 'serie_id', 'série');
  if (!serieId.ok) return serieId;
  // Une occupation de série : les plantations pérennes et les couvertures viendront avec leur ticket.
  if (!absent(l.plantation_id)) return echec(erreur('incoherent', 'plantation_id', 'une occupation de série ne désigne pas de plantation'));
  if (!absent(l.evenement_id)) return echec(erreur('incoherent', 'evenement_id', 'une occupation de série ne désigne pas de couverture'));
  if (serieId.valeur !== serie.id) return echec(erreur('incoherent', 'serie_id', "pas la série de l'occupation"));
  if (ferme.valeur !== serie.fermeId) return echec(erreur('incoherent', 'ferme_id', "l'occupation n'est pas de la ferme de sa série"));

  const unite = uneDesDeux(l, 'longueur_m', 'nombre_places', "place de l'occupation");
  if (!unite.ok) return unite;
  let place: PlaceOccupee;
  if (unite.valeur === 'a') {
    const n = taille(l.longueur_m, 'longueur_m', { libelle: 'longueur', plafond: PLAFONDS_SERIE.longueurM, entier: false });
    if (!n.ok) return n;
    place = { unite: 'longueur', longueurM: n.valeur };
  } else {
    const n = taille(l.nombre_places, 'nombre_places', { libelle: 'nombre de places', plafond: PLAFONDS_SERIE.nombrePlants, entier: true });
    if (!n.ok) return n;
    place = { unite: 'places', nombrePlaces: n.valeur };
  }
  const position = l.position_m;
  if (!absent(position) && (typeof position !== 'number' || !Number.isFinite(position) || position < 0)) {
    return echec(erreur('champ_invalide', 'position_m', 'position : nombre positif ou nul attendu'));
  }
  if (typeof position === 'number' && position > PLAFONDS_SERIE.longueurM) {
    return echec(erreur('plafond_depasse', 'position_m', `position au-delà du plafond (${String(PLAFONDS_SERIE.longueurM)} au plus)`));
  }

  const prevuDu = date(l.prevu_du, 'prevu_du', 'début prévu');
  if (!prevuDu.ok) return prevuDu;
  const prevuAu = date(l.prevu_au, 'prevu_au', 'fin prévue');
  if (!prevuAu.ok) return prevuAu;
  if (options.datesDeLaSerie !== false) {
    const { miseEnPlace, finRecolte } = serie.datesPrevues;
    if (prevuDu.valeur !== miseEnPlace) return echec(erreur('incoherent', 'prevu_du', `début prévu : la mise en place de la série (${miseEnPlace}) attendue`));
    if (prevuAu.valeur !== finRecolte) return echec(erreur('incoherent', 'prevu_au', `fin prévue : la fin de récolte de la série (${finRecolte}) attendue`));
  } else if (prevuAu.valeur < prevuDu.valeur) {
    return echec(erreur('incoherent', 'prevu_au', 'fin prévue avant le début'));
  }

  const reelDu = dateOuNul(l.reel_du, 'reel_du', 'début réel');
  if (!reelDu.ok) return reelDu;
  const reelAu = dateOuNul(l.reel_au, 'reel_au', 'fin réelle');
  if (!reelAu.ok) return reelAu;
  if (reelAu.valeur !== null && reelDu.valeur === null) return echec(erreur('incoherent', 'reel_au', 'fin réelle sans début réel'));
  if (reelAu.valeur !== null && reelDu.valeur !== null && reelAu.valeur < reelDu.valeur) {
    return echec(erreur('incoherent', 'reel_au', 'fin réelle avant le début réel'));
  }
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;

  return lu({
    id: identifiant.valeur as Id<'Occupation'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    supprimeLe: suppression.valeur,
    emplacementId: emplacement.valeur as Id<'Emplacement'>,
    occupant: { sorte: 'serie', serieId: serie.id },
    place,
    positionM: typeof position === 'number' ? position : null,
    prevuDu: prevuDu.valeur,
    prevuAu: prevuAu.valeur,
    reel: reelDu.valeur === null ? null : { du: reelDu.valeur, au: reelAu.valeur },
  });
}

/**
 * Valide une ligne `occupation` (format PowerSync, avec son `id`) d'une série, `serie` telle
 * que `validerSerie` l'a rendue, et la rend en `Occupation` de T01, ou renvoie la première règle
 * violée. Contrat : ./test/contrat-serie.ts.
 */
export function validerOccupation(entree: unknown, serie: Serie, options: OptionsOccupation = {}): ResultatLigneSerie<Occupation> {
  return sansException(entree, (l) => lireOccupation(l, serie, options));
}
