/**
 * Calculs du formulaire d'une série (T12). Fonctions pures : ni React, ni porte, ni objet Date.
 * Contrat : ./test/contrat.ts.
 *
 * Dates (T02, calculerDatesSerie), besoins (T05, besoinsSerie), conflits (T03, detecterConflits)
 * et alertes de rotation (T04, alertesRotation) viennent de @planif/core : ce fichier ne fait que
 * préparer leurs entrées (conversion au bord) et mettre leurs sorties en mots.
 */
import {
  alertesRotation,
  besoinsSerie,
  calculerDatesSerie,
  detecterConflits,
  lundiDeSemaine,
  nombreSemainesIso,
  semaineIso,
  type AlerteRotation,
  type Assolement,
  type DateCalendaire,
  type DatesSerie,
  type DelaisRetour,
  type Emplacement,
  type HierarchieParcellaire,
  type HistoriqueRotation,
  type Id,
  type ItineraireBesoins,
  type Occupation,
  type ParametresItineraire,
  type SorteConflit,
  type TypeAncreSerie,
} from '@planif/core';
import { NOMS_CONFLITS } from '../plan/calculs.ts';

// ── Bibliothèque lue (./donnees.ts) ──────────────────────────────────────────────────────────

export interface EspeceLue {
  readonly id: string;
  readonly nom: string;
  readonly familleId: string;
  readonly delais: DelaisRetour | null;
}

export interface VarieteLue {
  readonly id: string;
  readonly especeId: string;
  readonly nom: string;
  /** Poids de mille graines en grammes, null si inconnu. */
  readonly pmgG: number | null;
  /** Taux de germination en %, null si inconnu. */
  readonly germination: number | null;
}

export interface FamilleLue {
  readonly id: string;
  readonly nom: string;
  readonly minimalAns: number;
  readonly conseilleAns: number;
}

export interface ItineraireLu {
  readonly id: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly nom: string;
  /** L'instantané tel qu'il est rangé (texte JSON) : la série le recopie sans y toucher. */
  readonly parametresTexte: string;
}

export interface PlancheLue {
  readonly id: string;
  readonly code: string;
  readonly zoneId: string;
  readonly nomZone: string;
  readonly longueurM: number;
  /** Planche proposée dans « Ajouter une planche » (active, non supprimée). */
  readonly proposee: boolean;
  readonly emplacement: Emplacement;
}

export interface OccupationLue {
  readonly occupation: Occupation;
  readonly serieId: string | null;
  /** « Batavia Grenobloise », « Fraise »… */
  readonly libelle: string;
}

export interface SaisonLue {
  readonly id: string;
  readonly debut: string;
  readonly fin: string;
}

export interface Bibliotheque {
  readonly especes: readonly EspeceLue[];
  readonly varietes: readonly VarieteLue[];
  readonly familles: ReadonlyMap<string, FamilleLue>;
  readonly itineraires: readonly ItineraireLu[];
  /** Toutes les planches de la ferme (non supprimées), triées par code. */
  readonly planches: readonly PlancheLue[];
  readonly zones: ReadonlyMap<string, string>;
  readonly saisons: readonly SaisonLue[];
  /** Occupations non supprimées, par emplacement. */
  readonly occupationsPar: ReadonlyMap<string, readonly OccupationLue[]>;
  readonly historique: HistoriqueRotation;
  readonly hierarchie: HierarchieParcellaire;
}

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

const COLLATEUR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export const comparerNoms = (a: string, b: string): number => COLLATEUR.compare(a, b);

/** Sans accents ni casse : « Mâche » → 'mache'. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const deux = (n: number) => String(n).padStart(2, '0');

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** '2027-03-08' → '8 mars'. */
export function dateCourte(date: string): string {
  const [, m, j] = date.split('-');
  return `${String(Number(j))} ${MOIS_COURTS[Number(m) - 1] ?? ''}`;
}

/** Semaine ISO d'une date, au format d'un <input type="week"> : '2027-W14'. */
export function semaineDe(date: string): string {
  const s = semaineIso(date as DateCalendaire);
  return `${String(s.annee)}-W${deux(s.semaine)}`;
}

/** 'AAAA-Www' → lundi de cette semaine, ou null si la valeur n'est pas une semaine qui existe. */
export function lundiDe(semaine: string): DateCalendaire | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(semaine);
  if (m === null) return null;
  const annee = Number(m[1]);
  const numero = Number(m[2]);
  if (annee < 2000 || annee > 2100 || numero < 1 || numero > nombreSemainesIso(annee)) return null;
  return lundiDeSemaine(annee, numero);
}

/** Numéro de semaine ISO de 'AAAA-Www', ou null. */
function numeroSemaine(semaine: string): number | null {
  const m = /^\d{4}-W(\d{2})$/.exec(semaine);
  return m === null ? null : Number(m[1]);
}

/** « S10 · 8 mars ». */
export function libelleDate(date: string): string {
  return `S${deux(semaineIso(date as DateCalendaire).semaine)} · ${dateCourte(date)}`;
}

const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const nombreLisible = (n: number): string => NOMBRE.format(n);

/** Saisie d'une longueur (« 12,5 ») → mètres, ou null si ce n'est pas un nombre. */
export function lireLongueur(saisie: string): number | null {
  const t = saisie.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Somme de longueurs en mètres, au centimètre près (pas de 0,30000000000000004). */
export function sommeLongueurs(longueurs: readonly number[]): number {
  return longueurs.reduce((s, l) => s + Math.round(l * 100), 0) / 100;
}

/** Objet JSON lu depuis un texte, ou null. */
export function objetJson(texte: string | null): Readonly<Record<string, unknown>> | null {
  if (texte === null) return null;
  try {
    const v = JSON.parse(texte) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Culture ──────────────────────────────────────────────────────────────────────────────────

export interface ChoixCulture {
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly nomEspece: string;
  readonly nomVariete: string | null;
}

export const libelleCulture = (c: Pick<ChoixCulture, 'nomEspece' | 'nomVariete'>): string =>
  c.nomVariete === null ? c.nomEspece : `${c.nomEspece} ${c.nomVariete}`;

/** Toutes les cultures de la bibliothèque : chaque espèce seule, puis avec chacune de ses variétés. */
export function culturesDe(bib: Bibliotheque): ChoixCulture[] {
  const r: ChoixCulture[] = [];
  const especes = [...bib.especes].sort((a, b) => comparerNoms(a.nom, b.nom));
  for (const e of especes) {
    r.push({ especeId: e.id, varieteId: null, nomEspece: e.nom, nomVariete: null });
    const varietes = bib.varietes.filter((v) => v.especeId === e.id).sort((a, b) => comparerNoms(a.nom, b.nom));
    for (const v of varietes) r.push({ especeId: e.id, varieteId: v.id, nomEspece: e.nom, nomVariete: v.nom });
  }
  return r;
}

const mots = (texte: string): string[] => normaliser(texte).split(/[^\p{L}\p{N}]+/u).filter((m) => m !== '');

/** Chaque mot tapé commence un mot de « espèce variété », sans accents ni casse. */
export function chercherCultures(cultures: readonly ChoixCulture[], recherche: string): ChoixCulture[] {
  const tapes = mots(recherche);
  if (tapes.length === 0) return [];
  return cultures.filter((c) => {
    const siens = mots(libelleCulture(c));
    return tapes.every((t) => siens.some((m) => m.startsWith(t)));
  });
}

// ── Itinéraire ───────────────────────────────────────────────────────────────────────────────

/** Itinéraires de la culture : ceux de la variété d'abord, puis ceux de l'espèce, par nom. */
export function itinerairesDe(bib: Bibliotheque, culture: Pick<ChoixCulture, 'especeId' | 'varieteId'>): ItineraireLu[] {
  return bib.itineraires
    .filter((i) => i.especeId === culture.especeId && (i.varieteId === null || i.varieteId === culture.varieteId))
    .sort((a, b) => (a.varieteId === null ? 1 : 0) - (b.varieteId === null ? 1 : 0) || comparerNoms(a.nom, b.nom) || (a.id < b.id ? -1 : 1));
}

/** La semaine `numero` est-elle dans la période d'usage (qui peut chevaucher l'an) ? */
function dansPeriode(parametres: Readonly<Record<string, unknown>> | null, numero: number): boolean {
  const p = parametres?.periodeUsage;
  if (typeof p !== 'object' || p === null) return false;
  const { semaineDebut: d, semaineFin: f } = p as Record<string, unknown>;
  if (typeof d !== 'number' || typeof f !== 'number') return false;
  return d <= f ? d <= numero && numero <= f : numero >= d || numero <= f;
}

/**
 * Itinéraire proposé au choix de la culture : le premier dont la période d'usage contient la
 * semaine visée ; à défaut, le premier.
 */
export function itinerairePropose(itineraires: readonly ItineraireLu[], semaine: string): ItineraireLu | null {
  const numero = numeroSemaine(semaine);
  const dedans = numero === null ? undefined : itineraires.find((i) => dansPeriode(objetJson(i.parametresTexte), numero));
  return dedans ?? itineraires[0] ?? null;
}

/** Mode de culture d'un instantané, ou null s'il est illisible. */
export function modeDe(parametres: Readonly<Record<string, unknown>> | null): ParametresItineraire['mode'] | null {
  const m = parametres?.mode;
  return m === 'semis_direct' || m === 'plant_maison' || m === 'plant_achete' ? m : null;
}

/** Ancre proposée au choix de la culture : la plantation, sauf en semis direct. */
export const ancreParDefaut = (mode: ParametresItineraire['mode'] | null): TypeAncreSerie => (mode === 'semis_direct' ? 'semis' : 'plantation');

/** Étape de T02 qui porte l'ancre. */
export function etapeDeLAncre(ancre: TypeAncreSerie, mode: ParametresItineraire['mode'] | null): keyof DatesSerie {
  if (ancre === 'debut_recolte') return 'debutRecolte';
  if (ancre === 'semis' && mode === 'plant_maison') return 'semisPepiniere';
  return 'miseEnPlace';
}

// ── Calcul complet ───────────────────────────────────────────────────────────────────────────

export interface EmplacementSaisi {
  readonly id: string;
  /** Texte du champ, en mètres. */
  readonly longueur: string;
}

export interface Saisie {
  readonly culture: ChoixCulture | null;
  readonly itineraireId: string | null;
  /** Instantané recopié (texte JSON de l'itinéraire, ou celui de la série en modification). */
  readonly parametresTexte: string | null;
  readonly ancre: TypeAncreSerie;
  /** 'AAAA-Www'. */
  readonly semaine: string;
  readonly emplacements: readonly EmplacementSaisi[];
}

export interface ContexteCalcul {
  readonly bib: Bibliotheque;
  /** Occupations de la série modifiée : ni en conflit avec elle-même, ni dans sa rotation. */
  readonly exclure: ReadonlySet<string>;
}

export interface BesoinAffiche {
  readonly cle: string;
  readonly valeur: number;
  readonly texte: string;
}

export interface ConflitAffiche {
  readonly sorte: SorteConflit;
  readonly emplacementId: string;
  readonly texte: string;
}

export interface AlerteAffichee {
  readonly niveau: 'rouge' | 'orange';
  readonly emplacementId: string;
  readonly code: string;
  readonly nomFamille: string;
  readonly annee: number;
  readonly lieu: string;
  readonly alerte: AlerteRotation;
}

export interface Calcul {
  readonly ancreDate: DateCalendaire | null;
  readonly dates: DatesSerie | null;
  readonly longueurTotale: number;
  readonly besoins: readonly BesoinAffiche[];
  readonly conflits: readonly ConflitAffiche[];
  readonly alertes: readonly AlerteAffichee[];
  /** Saison qui contient la mise en place, ou null. */
  readonly saisonId: string | null;
  /** Ce qui manque pour enregistrer, ou null si tout est là. */
  readonly manque: string | null;
}

const LIBELLES_BESOINS: Readonly<Record<string, (n: string) => string>> = {
  mottesEnPlace: (n) => `${n} mottes en place`,
  plants: (n) => `${n} plants`,
  plantsACommander: (n) => `${n} plants à commander`,
  mottesAPlanter: (n) => `${n} mottes à planter`,
  mottesASemer: (n) => `${n} mottes à semer`,
  graines: (n) => `${n} graines`,
  plaques: (n) => `${n} plaques`,
};

function texteBesoin(cle: string, valeur: number, alveoles: number | null): string {
  if (cle === 'poidsDg') return `≈ ${nombreLisible(valeur / 10)} g de semences`;
  if (cle === 'plaques' && alveoles !== null) return `${nombreLisible(valeur)} plaques de ${String(alveoles)}`;
  const f = LIBELLES_BESOINS[cle];
  return f === undefined ? `${nombreLisible(valeur)} ${cle}` : f(nombreLisible(valeur));
}

const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Entrée de T05 depuis l'instantané et la variété (conversion au bord : mg, cm, %). */
export function entreeBesoins(p: Readonly<Record<string, unknown>>, variete: VarieteLue | undefined): ItineraireBesoins | null {
  const germination = variete?.germination ?? 100;
  const pmgMg = variete?.pmgG === null || variete?.pmgG === undefined ? null : Math.round(variete.pmgG * 1000);
  const q = p as unknown as ParametresItineraire;
  switch (q.mode) {
    case 'plant_maison':
      return {
        mode: 'plant_maison',
        densite: q.densite,
        grainesParMotte: q.grainesParMotte,
        plantsParMotte: q.plantsParMotte,
        germination,
        pertePepiniere: q.pertePepiniere,
        alveolesParPlaque: q.alveolesParPlaque,
        margeSecurite: q.margeSecurite,
        pmgMg,
      };
    case 'plant_achete':
      return { mode: 'plant_achete', densite: q.densite, margeSecurite: q.margeSecurite };
    case 'semis_direct': {
      const d = q.densite;
      if (d.facon === 'ecartement') {
        return { mode: 'semis_direct', facon: 'ecartement', densite: d, grainesParPoquet: q.grainesParPoquet ?? 1, germination, margeSecurite: q.margeSecurite, pmgMg };
      }
      if (d.facon === 'metre_lineaire') return { mode: 'semis_direct', facon: 'metre_lineaire', densite: d, margeSecurite: q.margeSecurite, pmgMg };
      return {
        mode: 'semis_direct',
        facon: 'volee',
        densite: { facon: 'volee', largeurSemeeCm: d.largeurSemeeCm, doseMgParM2: Math.round(d.doseGParM2 * 1000) },
        margeSecurite: q.margeSecurite,
      };
    }
    default:
      return null;
  }
}

function besoins(p: Readonly<Record<string, unknown>>, variete: VarieteLue | undefined, longueurM: number): BesoinAffiche[] {
  const entree = entreeBesoins(p, variete);
  if (entree === null || longueurM <= 0) return [];
  let r: Readonly<Record<string, unknown>>;
  try {
    r = besoinsSerie(entree, Math.round(longueurM * 100)) as unknown as Readonly<Record<string, unknown>>;
  } catch {
    return [];
  }
  const alveoles = nombreOuNul(p.alveolesParPlaque);
  const liste: BesoinAffiche[] = [];
  for (const [cle, v] of Object.entries(r)) {
    if (cle === 'mode' || cle === 'facon' || typeof v !== 'number') continue;
    liste.push({ cle, valeur: v, texte: texteBesoin(cle, v, alveoles) });
  }
  return liste;
}

function dates(p: Readonly<Record<string, unknown>>, ancre: TypeAncreSerie, date: DateCalendaire): DatesSerie | null {
  const mode = modeDe(p);
  if (mode === null || (ancre === 'semis' && mode === 'plant_achete')) return null;
  try {
    return calculerDatesSerie(p as unknown as ParametresItineraire, { type: ancre, date });
  } catch {
    return null;
  }
}

/** Occupation proposée sur une planche, telle que T03 la compare aux autres. */
function occupationProposee(planche: PlancheLue, longueurM: number, d: DatesSerie): Occupation {
  return {
    id: `proposee-${planche.id}` as Id<'Occupation'>,
    fermeId: planche.emplacement.fermeId,
    supprimeLe: null,
    emplacementId: planche.emplacement.id,
    occupant: { sorte: 'serie', serieId: 'proposee' as Id<'Serie'> },
    place: { unite: 'longueur', longueurM },
    positionM: null,
    prevuDu: d.miseEnPlace,
    prevuAu: d.finRecolte,
    reel: null,
  };
}

function conflitsSur(ctx: ContexteCalcul, planche: PlancheLue, longueurM: number, d: DatesSerie): ConflitAffiche[] {
  const autres = (ctx.bib.occupationsPar.get(planche.id) ?? []).filter((o) => !ctx.exclure.has(o.occupation.id));
  const proposee = occupationProposee(planche, longueurM, d);
  const trouves = detecterConflits(planche.emplacement, [...autres.map((o) => o.occupation), proposee]);
  const libelles = new Map(autres.map((o) => [o.occupation.id as string, o.libelle]));
  return trouves
    .filter((c) => c.occupations.includes(proposee.id))
    .map((c) => {
      const cultures = c.occupations.filter((id) => id !== proposee.id).map((id) => libelles.get(id) ?? 'Culture');
      const avec = cultures.length === 0 ? '' : ` : ${[...new Set(cultures)].join(', ')}`;
      return { sorte: c.sorte, emplacementId: planche.id, texte: `${NOMS_CONFLITS[c.sorte]} sur ${planche.code}${avec}` };
    });
}

function alertesSur(ctx: ContexteCalcul, culture: ChoixCulture, planche: PlancheLue, annee: number): AlerteAffichee[] {
  const espece = ctx.bib.especes.find((e) => e.id === culture.especeId);
  if (espece === undefined) return [];
  const famille = ctx.bib.familles.get(espece.familleId);
  const prevue = {
    espece: { id: espece.id as Id<'Espece'>, familleId: espece.familleId as Id<'Famille'>, delaisRetour: espece.delais },
    famille:
      famille === undefined
        ? null
        : { id: famille.id as Id<'Famille'>, delaiRetourMinimalAns: famille.minimalAns, delaiRetourConseilleAns: famille.conseilleAns },
  };
  const emplacement = ctx.bib.hierarchie.emplacements.find((e) => e.id === planche.id) ?? {
    id: planche.id as Id<'Emplacement'>,
    zoneId: planche.zoneId as Id<'Zone'>,
    remplace: [],
    sorte: planche.emplacement.sorte,
  };
  let trouvees: readonly AlerteRotation[];
  try {
    trouvees = alertesRotation(prevue, emplacement, annee, ctx.bib.historique, ctx.bib.hierarchie, ctx.exclure as ReadonlySet<Id<'Occupation'>>);
  } catch {
    return [];
  }
  return trouvees.flatMap((a) => {
    const premiere = a.lignes[0];
    if (premiere === undefined) return [];
    const lieu =
      premiere.lieu.sorte === 'zone'
        ? (ctx.bib.zones.get(premiere.lieu.zoneId) ?? 'une zone')
        : (ctx.bib.planches.find((p) => p.id === (premiere.lieu.sorte === 'emplacement' ? premiere.lieu.emplacementId : ''))?.code ?? 'un emplacement');
    return [
      {
        niveau: a.niveau,
        emplacementId: planche.id,
        code: planche.code,
        nomFamille: ctx.bib.familles.get(premiere.culture.familleId)?.nom ?? famille?.nom ?? 'Même famille',
        annee: premiere.annee,
        lieu,
        alerte: a,
      },
    ];
  });
}

/** Tout ce que le formulaire affiche, recalculé à chaque changement de champ. */
export function calculer(ctx: ContexteCalcul, s: Saisie): Calcul {
  const parametres = objetJson(s.parametresTexte);
  const ancreDate = lundiDe(s.semaine);
  const d = parametres === null || ancreDate === null ? null : dates(parametres, s.ancre, ancreDate);
  const longueurs = s.emplacements.map((e) => lireLongueur(e.longueur));
  const valides = longueurs.every((l): l is number => l !== null && l > 0 && l <= 10_000);
  const longueurTotale = sommeLongueurs(longueurs.map((l) => (l !== null && l > 0 ? l : 0)));
  const variete = s.culture?.varieteId == null ? undefined : ctx.bib.varietes.find((v) => v.id === s.culture?.varieteId);

  const conflits: ConflitAffiche[] = [];
  const alertes: AlerteAffichee[] = [];
  if (d !== null) {
    const annee = Number(d.miseEnPlace.slice(0, 4));
    s.emplacements.forEach((e, i) => {
      const planche = ctx.bib.planches.find((p) => p.id === e.id);
      if (planche === undefined) return;
      const l = longueurs[i];
      if (l !== null && l !== undefined && l > 0) conflits.push(...conflitsSur(ctx, planche, l, d));
      if (s.culture !== null) alertes.push(...alertesSur(ctx, s.culture, planche, annee));
    });
  }

  const saison = d === null ? undefined : ctx.bib.saisons.find((x) => x.debut <= d.miseEnPlace && d.miseEnPlace <= x.fin);
  const manque =
    s.culture === null
      ? 'Choisis une culture.'
      : s.itineraireId === null || parametres === null
        ? 'Choisis un itinéraire.'
        : ancreDate === null
          ? 'Choisis une semaine.'
          : d === null
            ? 'Cet itinéraire ne permet pas cette ancre.'
            : s.emplacements.length === 0
              ? 'Ajoute une planche.'
              : !valides
                ? 'Donne une longueur à chaque planche.'
                : null;
  return {
    ancreDate,
    dates: d,
    longueurTotale,
    besoins: parametres === null || s.culture === null ? [] : besoins(parametres, variete, longueurTotale),
    conflits,
    alertes,
    saisonId: saison?.id ?? null,
    manque,
  };
}

/** Assolement local → Assolement de T01 (null si illisible). */
export function versAssolement(l: Readonly<Record<string, string | number | null>>): Assolement | null {
  const zone = typeof l.zone_id === 'string' ? l.zone_id : null;
  const emplacement = typeof l.emplacement_id === 'string' ? l.emplacement_id : null;
  const nature = l.nature;
  if (nature !== 'prevu' && nature !== 'passe_saisi' && nature !== 'passe_importe') return null;
  const cible = zone !== null ? { sorte: 'zone' as const, zoneId: zone as Id<'Zone'> } : emplacement !== null ? { sorte: 'emplacement' as const, emplacementId: emplacement as Id<'Emplacement'> } : null;
  if (cible === null || typeof l.famille_id !== 'string') return null;
  return {
    id: String(l.id) as Id<'Assolement'>,
    fermeId: String(l.ferme_id) as Id<'Ferme'>,
    supprimeLe: null,
    saisonId: String(l.saison_id) as Id<'Saison'>,
    cible,
    familleId: l.famille_id as Id<'Famille'>,
    especeId: typeof l.espece_id === 'string' ? (l.espece_id as Id<'Espece'>) : null,
    nature,
  } as Assolement;
}
