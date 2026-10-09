/**
 * Calculs de l'écran des itinéraires (T24) : de la ligne lue à la saisie du formulaire, et de la
 * saisie à la ligne écrite. Aucune règle agronomique ici : les dates viennent du cœur
 * (calculerDatesSerie, datesTravailPrevu, lundiDeSemaine), la validité d'une ligne aussi
 * (validerItineraire, validerTypeIntervention). Ce module ne fait que traduire des champs de
 * formulaire en paramètres, et l'inverse. Contrat : ./test/contrat.ts.
 */
import {
  ajouterJours,
  calculerDatesSerie,
  CATEGORIES_AVEC_PRODUIT,
  datesTravailPrevu,
  lundiDeSemaine,
  semaineIso,
  validerItineraire,
  type AncreSerie,
  type CategorieIntervention,
  type DateCalendaire,
  type DatesSerie,
  type DispositionRangs,
  type FaconDensite,
  type ModeItineraire,
  type ParametresDatesSerie,
  type RepereTravail,
  type TravailPrevu,
} from '@planif/core';

export type Valeur = string | number | null;
export type Ligne = Readonly<Record<string, Valeur>>;
type Objet = Record<string, unknown>;

// ── Lignes lues ──────────────────────────────────────────────────────────────────────────────

export interface EspeceLue {
  readonly id: string;
  readonly nom: string;
}

export interface ItineraireLu {
  readonly id: string;
  /** null : bibliothèque commune (lecture seule). */
  readonly fermeId: string | null;
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly nom: string;
  readonly mode: string;
  readonly parametresTexte: string;
  /** Paramètres relus (objet), ou null s'ils sont illisibles. */
  readonly parametres: Readonly<Objet> | null;
}

export interface TypeLu {
  readonly id: string;
  /** null : liste de départ (lecture seule). */
  readonly fermeId: string | null;
  readonly categorie: CategorieIntervention;
  readonly libelle: string;
  readonly masque: boolean;
}

export const CATEGORIES: readonly { readonly valeur: CategorieIntervention; readonly libelle: string }[] = [
  { valeur: 'travail_sol', libelle: 'Travail du sol' },
  { valeur: 'couverture', libelle: 'Couverture' },
  { valeur: 'fertilisation', libelle: 'Fertilisation' },
  { valeur: 'amendement', libelle: 'Amendement' },
  { valeur: 'entretien', libelle: 'Entretien' },
];

const estCategorie = (v: unknown): v is CategorieIntervention => CATEGORIES.some((c) => c.valeur === v);

const texte = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);

export function objetJson(v: unknown): Objet | null {
  if (typeof v !== 'string') return null;
  try {
    const r = JSON.parse(v) as unknown;
    return estObjet(r) ? r : null;
  } catch {
    return null;
  }
}

export function versItineraire(l: Readonly<Record<string, unknown>>): ItineraireLu {
  const parametresTexte = texte(l.parametres);
  return {
    id: texte(l.id),
    fermeId: texteOuNul(l.ferme_id),
    especeId: texte(l.espece_id),
    varieteId: texteOuNul(l.variete_id),
    nom: texte(l.nom),
    mode: texte(l.mode),
    parametresTexte,
    parametres: objetJson(parametresTexte),
  };
}

export function versEspece(l: Readonly<Record<string, unknown>>): EspeceLue {
  return { id: texte(l.id), nom: texte(l.nom) };
}

/** Type lu, ou null si sa catégorie est inconnue (ligne d'une version future : ignorée). */
export function versType(l: Readonly<Record<string, unknown>>): TypeLu | null {
  if (!estCategorie(l.categorie)) return null;
  return { id: texte(l.id), fermeId: texteOuNul(l.ferme_id), categorie: l.categorie, libelle: texte(l.libelle), masque: l.masque === 1 || l.masque === true };
}

const collateur = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export const comparerNoms = (a: string, b: string): number => collateur.compare(a, b);

/** Couple (catégorie, libellé) : la référence exacte d'un travail à son type. */
export const cleType = (categorie: string, libelle: string): string => `${categorie}\u0000${libelle}`;

/** Types permis dans les travaux (règle du serveur) : tous les types lus, masqués compris. */
export const typesPermis = (types: readonly TypeLu[]): { categorie: string; type: string }[] => types.map((t) => ({ categorie: t.categorie, type: t.libelle }));

/** Couples (catégorie, libellé) cités par les travaux prévus des itinéraires de la ferme (non supprimés). */
export function typesUtilises(itineraires: readonly ItineraireLu[]): ReadonlySet<string> {
  const r = new Set<string>();
  for (const i of itineraires) {
    if (i.fermeId === null) continue;
    const travaux = i.parametres?.travauxPrevus;
    if (!Array.isArray(travaux)) continue;
    for (const t of travaux as unknown[]) if (estObjet(t) && typeof t.categorie === 'string' && typeof t.type === 'string') r.add(cleType(t.categorie, t.type));
  }
  return r;
}

// ── Dates lisibles ───────────────────────────────────────────────────────────────────────────

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 3 mai 2027 ». */
export function dateLisible(d: string): string {
  const [a, m, j] = d.split('-');
  return `${String(Number(j))} ${MOIS[Number(m) - 1] ?? ''} ${a ?? ''}`;
}

/** « 3 mai ». */
export function dateCourte(d: string): string {
  const [, m, j] = d.split('-');
  return `${String(Number(j))} ${MOIS[Number(m) - 1] ?? ''}`;
}

// ── Saisie du formulaire ─────────────────────────────────────────────────────────────────────

export type Sens = 'avant' | 'apres';
export type Par = 'cent_metres' | 'planche';

export interface SaisieTravail {
  /** Clé de rendu, stable. */
  readonly cle: number;
  readonly categorie: CategorieIntervention | null;
  /** Libellé exact du type (null : pas encore choisi). */
  readonly type: string | null;
  readonly jours: string;
  readonly sens: Sens;
  readonly repere: RepereTravail;
  readonly repeter: boolean;
  readonly periode: string;
  readonly repereFin: RepereTravail;
  readonly minutes: string;
  readonly par: Par;
  readonly outil: string;
  readonly produit: string;
  readonly quantite: string;
  readonly unite: string;
}

export interface Saisie {
  readonly nom: string;
  readonly especeId: string;
  readonly mode: ModeItineraire;
  readonly pepiniere: string;
  readonly avantRecolte: string;
  readonly recolte: string;
  readonly facon: FaconDensite;
  readonly rangs: string;
  readonly ecartement: string;
  /** T35a : rangs alignés (défaut, densité sans clé) ou en quinconce. */
  readonly disposition: DispositionRangs;
  readonly grainesParMetre: string;
  readonly largeur: string;
  readonly dose: string;
  readonly travaux: readonly SaisieTravail[];
}

const MODES: readonly ModeItineraire[] = ['semis_direct', 'plant_maison', 'plant_achete'];
const FACONS: readonly FaconDensite[] = ['ecartement', 'metre_lineaire', 'volee'];
export const REPERES: readonly { readonly valeur: RepereTravail; readonly libelle: string }[] = [
  { valeur: 'semis_pepiniere', libelle: 'semis en pépinière' },
  { valeur: 'mise_en_place', libelle: 'mise en place' },
  { valeur: 'debut_recolte', libelle: 'début de récolte' },
  { valeur: 'fin_recolte', libelle: 'fin de récolte' },
];
const estRepere = (v: unknown): v is RepereTravail => REPERES.some((r) => r.valeur === v);

const nombreTexte = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v).replace('.', ',') : '');

let prochaineCle = 1;
export const nouvelleCle = (): number => prochaineCle++;

function saisieTravail(t: Objet): SaisieTravail {
  const decalage = typeof t.decalageJours === 'number' ? t.decalageJours : 0;
  const repetition = estObjet(t.repetition) ? t.repetition : null;
  const temps = estObjet(t.tempsEstime) ? t.tempsEstime : null;
  const produit = estObjet(t.produit) ? t.produit : null;
  const quantite = produit !== null && estObjet(produit.quantite) ? produit.quantite : null;
  const repere = estRepere(t.repere) ? t.repere : 'mise_en_place';
  return {
    cle: nouvelleCle(),
    categorie: estCategorie(t.categorie) ? t.categorie : null,
    type: typeof t.type === 'string' ? t.type : null,
    jours: String(Math.abs(decalage)),
    sens: decalage < 0 ? 'avant' : 'apres',
    repere,
    repeter: repetition !== null,
    periode: repetition === null ? '7' : nombreTexte(repetition.tousLesJours),
    repereFin: repetition !== null && estRepere(repetition.repereFin) ? repetition.repereFin : repereFinParDefaut(repere),
    minutes: temps === null ? '' : nombreTexte(temps.minutes),
    par: temps !== null && temps.par === 'planche' ? 'planche' : 'cent_metres',
    outil: typeof t.outil === 'string' ? t.outil : '',
    produit: produit !== null && typeof produit.nom === 'string' ? produit.nom : '',
    quantite: quantite === null ? '' : nombreTexte(quantite.valeur),
    unite: quantite !== null && typeof quantite.unite === 'string' ? quantite.unite : '',
  };
}

export function repereFinParDefaut(repere: RepereTravail): RepereTravail {
  return repere === 'semis_pepiniere' || repere === 'mise_en_place' ? 'debut_recolte' : 'fin_recolte';
}

/** Nouveau travail : sans type, 0 jour après la mise en place, sans répétition ni temps. */
export function nouveauTravail(): SaisieTravail {
  return {
    cle: nouvelleCle(),
    categorie: null,
    type: null,
    jours: '0',
    sens: 'apres',
    repere: 'mise_en_place',
    repeter: false,
    periode: '7',
    repereFin: 'debut_recolte',
    minutes: '',
    par: 'cent_metres',
    outil: '',
    produit: '',
    quantite: '',
    unite: '',
  };
}

/** Paramètres d'un nouvel itinéraire (contrat : « Nouvel itinéraire »). */
export const PARAMETRES_NOUVEAUX: Readonly<Objet> = {
  mode: 'plant_maison',
  periodeUsage: null,
  typeAbri: null,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

/** Saisie tirée des paramètres d'un itinéraire. */
export function saisieDepuis(parametres: Readonly<Objet>, nom: string, especeId: string): Saisie {
  const mode = MODES.find((m) => m === parametres.mode) ?? 'plant_maison';
  const densite = estObjet(parametres.densite) ? parametres.densite : {};
  const facon = FACONS.find((f) => f === densite.facon) ?? 'ecartement';
  const travaux = Array.isArray(parametres.travauxPrevus) ? (parametres.travauxPrevus as unknown[]).filter(estObjet).map(saisieTravail) : [];
  return {
    nom,
    especeId,
    mode,
    pepiniere: nombreTexte(parametres.dureePepiniereJours),
    avantRecolte: nombreTexte(parametres.dureeAvantRecolteJours),
    recolte: nombreTexte(parametres.fenetreRecolteJours),
    facon: mode === 'semis_direct' ? facon : 'ecartement',
    rangs: nombreTexte(densite.rangsParPlanche),
    ecartement: nombreTexte(densite.ecartementSurRangCm),
    disposition: densite.disposition === 'quinconce' ? 'quinconce' : 'alignee',
    grainesParMetre: nombreTexte(densite.grainesParMetre),
    largeur: nombreTexte(densite.largeurSemeeCm),
    dose: nombreTexte(densite.doseGParM2),
    travaux,
  };
}

/** Nom de la copie d'un itinéraire de la bibliothèque, 80 caractères au plus. */
export function nomAdapte(nom: string): string {
  const suffixe = ' (ma ferme)';
  const base = nom.trim();
  return base.length + suffixe.length <= 80 ? `${base}${suffixe}` : `${base.slice(0, 80 - suffixe.length).trimEnd()}${suffixe}`;
}

// ── Lecture des champs ───────────────────────────────────────────────────────────────────────

type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly message: string };
const ok = <T>(valeur: T): Lecture<T> => ({ ok: true, valeur });
const manque = <T>(message: string): Lecture<T> => ({ ok: false, message });

/** Entier strictement positif (ou ≥ 0 avec `zero`). */
export function lireEntier(v: string, zero = false): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && (zero ? n >= 0 : n > 0) ? n : null;
}

/** Nombre décimal strictement positif ; virgule ou point. */
export function lireDecimal(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function entierRequis(v: string, libelle: string): Lecture<number> {
  const n = lireEntier(v);
  return n === null ? manque(`${libelle} : un nombre de jours entier, plus grand que 0.`) : ok(n);
}

function decimalRequis(v: string, libelle: string): Lecture<number> {
  const n = lireDecimal(v);
  return n === null ? manque(`${libelle} : un nombre plus grand que 0.`) : ok(n);
}

/** Durées de la saisie, telles que le cœur les lit ; null si l'une manque. */
export function dureesDe(s: Saisie): ParametresDatesSerie | null {
  const avant = lireEntier(s.avantRecolte);
  const fenetre = lireEntier(s.recolte);
  if (avant === null || fenetre === null) return null;
  if (s.mode === 'plant_maison') {
    const pepiniere = lireEntier(s.pepiniere);
    return pepiniere === null ? null : { mode: 'plant_maison', dureePepiniereJours: pepiniere, dureeAvantRecolteJours: avant, fenetreRecolteJours: fenetre };
  }
  return { mode: s.mode, dureeAvantRecolteJours: avant, fenetreRecolteJours: fenetre };
}

const CLES_DU_MODE = ['dureePepiniereJours', 'grainesParMotte', 'plantsParMotte', 'pertePepiniere', 'alveolesParPlaque', 'grainesParPoquet'];

function densiteDe(s: Saisie): Lecture<Objet> {
  const facon = s.mode === 'semis_direct' ? s.facon : 'ecartement';
  if (facon === 'volee') {
    const largeur = decimalRequis(s.largeur, 'Largeur semée');
    if (!largeur.ok) return largeur;
    const dose = decimalRequis(s.dose, 'Dose');
    if (!dose.ok) return dose;
    return ok({ facon, largeurSemeeCm: largeur.valeur, doseGParM2: dose.valeur });
  }
  const rangs = lireEntier(s.rangs);
  if (rangs === null) return manque('Rangs par planche : un nombre entier, plus grand que 0.');
  if (facon === 'metre_lineaire') {
    const graines = decimalRequis(s.grainesParMetre, 'Graines par mètre');
    if (!graines.ok) return graines;
    return ok({ facon, rangsParPlanche: rangs, grainesParMetre: graines.valeur });
  }
  const ecartement = decimalRequis(s.ecartement, 'Écartement sur le rang');
  if (!ecartement.ok) return ecartement;
  // T35a : seul le quinconce s'écrit (alignés = densité sans clé, comme avant T35a) ; un seul
  // rang n'a pas de disposition.
  const disposition = s.disposition === 'quinconce' && rangs > 1 ? { disposition: s.disposition } : {};
  return ok({ facon, rangsParPlanche: rangs, ecartementSurRangCm: ecartement.valeur, ...disposition });
}

/** Travail prévu tiré de la saisie (sans contrôle de la liste des types), ou ce qui manque. */
export function travailDe(t: SaisieTravail, numero: number): Lecture<TravailPrevu> {
  const prefixe = `Travail ${String(numero)}`;
  if (t.categorie === null || t.type === null) return manque(`${prefixe} : choisis son type.`);
  const jours = lireEntier(t.jours, true);
  if (jours === null) return manque(`${prefixe} : un nombre de jours entier (0 ou plus).`);
  let repetition: TravailPrevu['repetition'] = null;
  if (t.repeter) {
    const periode = lireEntier(t.periode);
    if (periode === null) return manque(`${prefixe} : une période de répétition en jours entiers.`);
    repetition = { tousLesJours: periode, repereFin: t.repereFin };
  }
  let tempsEstime: TravailPrevu['tempsEstime'] = null;
  if (t.minutes.trim() !== '') {
    const minutes = lireEntier(t.minutes);
    if (minutes === null) return manque(`${prefixe} : un temps estimé en minutes entières.`);
    tempsEstime = { minutes, par: t.par };
  }
  let produit: TravailPrevu['produit'] = null;
  if (CATEGORIES_AVEC_PRODUIT.includes(t.categorie)) {
    const nom = t.produit.trim();
    const valeur = lireDecimal(t.quantite);
    const unite = t.unite.trim();
    if (nom === '' || valeur === null || unite === '') return manque(`${prefixe} : produit, quantité et unité sont demandés.`);
    produit = { nom, quantite: { valeur, unite } };
  }
  const outil = t.outil.trim();
  return ok({
    categorie: t.categorie,
    type: t.type,
    repere: t.repere,
    decalageJours: t.sens === 'avant' && jours > 0 ? -jours : jours,
    repetition,
    outil: outil === '' ? null : outil,
    produit,
    tempsEstime,
  });
}

/**
 * Paramètres de la saisie : ceux de `base` (l'itinéraire d'origine), clés non montrées gardées
 * telles quelles, avec les champs du formulaire. Changer de mode retire les clés de l'ancien mode
 * et pose celles du nouveau (reprises de `base` si c'est son mode).
 */
export function parametresDe(base: Readonly<Objet>, s: Saisie): Lecture<Objet> {
  const durees = dureesDe(s);
  if (durees === null) {
    if (s.mode === 'plant_maison' && lireEntier(s.pepiniere) === null) return manque('Pépinière : un nombre de jours entier, plus grand que 0.');
    const a = entierRequis(s.avantRecolte, 'Avant récolte');
    if (!a.ok) return a;
    const r = entierRequis(s.recolte, 'Récolte');
    return manque(r.ok ? 'Durées incomplètes.' : r.message);
  }
  const densite = densiteDe(s);
  if (!densite.ok) return densite;
  const travaux: TravailPrevu[] = [];
  for (const [i, t] of s.travaux.entries()) {
    const lu = travailDe(t, i + 1);
    if (!lu.ok) return lu;
    travaux.push(lu.valeur);
  }
  const p: Objet = {};
  for (const [cle, v] of Object.entries(base)) if (!CLES_DU_MODE.includes(cle)) p[cle] = v;
  const memeMode = base.mode === s.mode;
  p.mode = s.mode;
  p.dureeAvantRecolteJours = durees.dureeAvantRecolteJours;
  p.fenetreRecolteJours = durees.fenetreRecolteJours;
  p.densite = densite.valeur;
  if (durees.mode === 'plant_maison') {
    p.dureePepiniereJours = durees.dureePepiniereJours;
    p.grainesParMotte = memeMode && base.grainesParMotte !== undefined ? base.grainesParMotte : 1;
    p.plantsParMotte = memeMode && base.plantsParMotte !== undefined ? base.plantsParMotte : 1;
    p.pertePepiniere = memeMode && base.pertePepiniere !== undefined ? base.pertePepiniere : 0;
    p.alveolesParPlaque = memeMode && base.alveolesParPlaque !== undefined ? base.alveolesParPlaque : null;
  } else if (durees.mode === 'semis_direct') {
    const gardee = memeMode && typeof base.grainesParPoquet === 'number' ? base.grainesParPoquet : 1;
    p.grainesParPoquet = s.facon === 'ecartement' ? gardee : null;
  }
  if (travaux.length > 0 || 'travauxPrevus' in base) p.travauxPrevus = travaux;
  return ok(p);
}

/** Ligne `itineraire` complète (format local), validée par le cœur avec la liste des types ; ou ce qui ne va pas. */
export function ligneValidee(l: Ligne, types: readonly TypeLu[]): Lecture<Ligne> {
  const r = validerItineraire({ ...l }, { typesIntervention: typesPermis(types) });
  if (!r.ok) return manque(`Pas encore enregistrable : ${r.erreur.message}.`);
  // Rangé tel que le cœur le relit : travaux prévus normalisés (clés facultatives à null).
  return ok({ ...l, nom: r.valeur.nom, parametres: JSON.stringify(r.valeur.parametres) });
}

/** Paramètres normalisés d'une ligne (sans contrôle de la liste des types), pour comparer. */
export function parametresNormalises(l: Ligne): unknown {
  const r = validerItineraire({ ...l });
  return r.ok ? r.valeur.parametres : objetJson(l.parametres);
}

/** Égalité de deux valeurs JSON, sans tenir compte de l'ordre des clés. */
export function egauxJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => egauxJson(x, b[i]));
  if (estObjet(a) && estObjet(b)) {
    const ca = Object.keys(a);
    const cb = Object.keys(b);
    return ca.length === cb.length && ca.every((c) => c in b && egauxJson(a[c], b[c]));
  }
  return false;
}

// ── Aperçu ───────────────────────────────────────────────────────────────────────────────────

/**
 * Date d'ancre de la série d'exemple : le lundi de la semaine ISO de début de la période d'usage
 * (cette année s'il n'est pas passé, sinon l'an prochain) ; sans période, le premier lundi
 * strictement après aujourd'hui.
 */
export function dateExemple(periodeUsage: unknown, aujourdhui: string): DateCalendaire {
  const jour = aujourdhui as DateCalendaire;
  const semaine = estObjet(periodeUsage) ? periodeUsage.semaineDebut : undefined;
  if (typeof semaine === 'number' && Number.isInteger(semaine)) {
    const annee = Number(aujourdhui.slice(0, 4));
    for (const a of [annee, annee + 1, annee + 2]) {
      try {
        const lundi = lundiDeSemaine(a, semaine);
        if (lundi >= jour) return lundi;
      } catch {
        // Semaine 53 d'une année qui n'en a que 52 : l'année suivante.
      }
    }
  }
  const s = semaineIso(jour);
  return ajouterJours(lundiDeSemaine(s.annee, s.semaine), 7);
}

export interface Apercu {
  readonly ancre: AncreSerie;
  /** Dates de la série d'exemple, ou null si une durée manque. */
  readonly dates: DatesSerie | null;
  /** Par travail (même indice que la saisie) : ses dates, ou null s'il n'a pas de type ou qu'un champ manque. */
  readonly travaux: readonly (readonly DateCalendaire[] | null)[];
}

/** Aperçu calculé par le cœur pour la série d'exemple. */
export function apercu(s: Saisie, periodeUsage: unknown, aujourdhui: string): Apercu {
  const ancre: AncreSerie = { type: s.mode === 'semis_direct' ? 'semis' : 'plantation', date: dateExemple(periodeUsage, aujourdhui) };
  const durees = dureesDe(s);
  let dates: DatesSerie | null = null;
  if (durees !== null) {
    try {
      dates = calculerDatesSerie(durees, ancre);
    } catch {
      dates = null;
    }
  }
  const travaux = s.travaux.map((t) => {
    if (dates === null || t.categorie === null || t.type === null) return null;
    const jours = lireEntier(t.jours, true);
    if (jours === null) return null;
    const periode = t.repeter ? lireEntier(t.periode) : null;
    if (t.repeter && periode === null) return null;
    const travail: TravailPrevu = {
      categorie: t.categorie,
      type: t.type,
      repere: t.repere,
      decalageJours: t.sens === 'avant' ? -jours : jours,
      repetition: periode === null ? null : { tousLesJours: periode, repereFin: t.repereFin },
      outil: null,
      produit: null,
      tempsEstime: null,
    };
    return datesTravailPrevu(travail, dates);
  });
  return { ancre, dates, travaux };
}

/** Résumé d'un itinéraire pour la liste : « Plant maison · pépinière 28 j · récolte à 49 j · 2 travaux ». */
export function resumeItineraire(i: ItineraireLu): string {
  const p = i.parametres;
  if (p === null) return 'Paramètres illisibles';
  const morceaux: string[] = [LIBELLES_MODES[MODES.find((m) => m === p.mode) ?? 'plant_maison']];
  if (typeof p.dureePepiniereJours === 'number' && p.mode === 'plant_maison') morceaux.push(`pépinière ${String(p.dureePepiniereJours)} j`);
  if (typeof p.dureeAvantRecolteJours === 'number') morceaux.push(`récolte à ${String(p.dureeAvantRecolteJours)} j`);
  const n = Array.isArray(p.travauxPrevus) ? p.travauxPrevus.length : 0;
  morceaux.push(n === 0 ? 'aucun travail' : n === 1 ? '1 travail' : `${String(n)} travaux`);
  return morceaux.join(' · ');
}

export const LIBELLES_MODES: Readonly<Record<ModeItineraire, string>> = {
  semis_direct: 'Semis direct',
  plant_maison: 'Plant maison',
  plant_achete: 'Plant acheté',
};
