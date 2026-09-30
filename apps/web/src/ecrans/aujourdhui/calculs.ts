/**
 * Écran « Aujourd'hui » (T13) : lecture de la base locale et calculs, sans React. Contrat :
 * ./test/contrat.ts.
 *
 * Les tâches viennent du semainier de T06 (`semainier`, @planif/core) : aucune règle de date
 * n'est réécrite ici. Ce fichier ne fait que joindre les lignes locales (séries, campagnes,
 * emplacements, journal) au format que le moteur attend, et tirer du journal ce qui est « en
 * vigueur » (même règle que la vue evenements_en_vigueur de @planif/db).
 */
import {
  ajouterJours,
  appliquerRealises,
  semaineIso,
  semainier,
  type CampagneSemainier,
  type CultureConcernee,
  type DateCalendaire,
  type DatesPrevuesSerie,
  type EmplacementConcerne,
  type EtapeRealisee,
  type EtapeSerie,
  type Id,
  type ModeItineraire,
  type RealisesSerie,
  type SerieSemainier,
  type StatutSerie,
  type TacheSemainier,
  type TailleSerie,
  type UniteRecolte,
} from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import { cleFamille, type CleFamille } from '../plan/calculs.ts';

// ── Types ────────────────────────────────────────────────────────────────────────────────────

/** Série ou campagne, telle que l'écran la montre et l'écrit. */
export interface Culture {
  readonly cible: CultureConcernee;
  /** Id de la série ou de la campagne (data-cle, data-cible). */
  readonly cibleId: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  /** Nom de l'espèce (« Chou pointu »). */
  readonly espece: string;
  readonly variete: string | null;
  /** espece.unite_recolte : l'unité préremplie de la récolte. */
  readonly unite: UniteRecolte;
  readonly famille: CleFamille | null;
  /** Emplacements des occupations non supprimées, triés (zone, code). */
  readonly emplacements: readonly EmplacementConcerne[];
}

export type DetailLu =
  | { readonly type: 'realise'; readonly etape: EtapeRealisee; readonly quantiteReelle: number | null }
  | { readonly type: 'recolte'; readonly quantite: number; readonly unite: UniteRecolte; readonly categorie: string | null };

/** Événement du journal (réalisé ou récolte), lu tel quel. */
export interface EvenementLu {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly serieId: string | null;
  readonly campagneId: string | null;
  readonly emplacementIds: readonly string[];
  readonly note: string | null;
  readonly photos: readonly string[];
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
  readonly detail: DetailLu;
}

export interface TacheJour {
  /** `<id de la série ou campagne>:<étape>`. */
  readonly cle: string;
  readonly tache: TacheSemainier;
  readonly culture: Culture;
}

export interface EntreeHistorique {
  readonly evenement: EvenementLu;
  readonly culture: Culture | null;
}

export interface DerniereRecolte {
  readonly date: string;
  readonly quantite: number;
  readonly unite: UniteRecolte;
}

export interface Journee {
  readonly aujourdhui: string;
  readonly semaine: number;
  /** Semainier de la semaine, en retard d'abord (ordre du moteur). */
  readonly taches: readonly TacheJour[];
  /** Récoltes en cours : proposées à la première étape de la récolte. */
  readonly recoltesEnCours: readonly Culture[];
  /** Saisies en vigueur récentes, la plus récente d'abord. */
  readonly historique: readonly EntreeHistorique[];
  readonly cultures: ReadonlyMap<string, Culture>;
  /** Dernière récolte en vigueur de chaque culture (id de série ou de campagne). */
  readonly dernieresRecoltes: ReadonlyMap<string, DerniereRecolte>;
}

/** Jours couverts par l'historique (contrat : au moins 7). */
export const JOURS_HISTORIQUE = 7;

/** Tables dont l'écran dépend : un changement (saisie, synchro) le fait relire. */
export const TABLES_AUJOURDHUI = ['serie', 'campagne', 'plantation', 'occupation', 'emplacement', 'zone', 'espece', 'variete', 'famille', 'evenement'] as const;

// ── Lecture des lignes ───────────────────────────────────────────────────────────────────────

type Valeur = string | number | null | undefined;
type Ligne = Readonly<Record<string, Valeur>>;

const texte = (v: Valeur): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const texteOuNul = (v: Valeur): string | null => (v === null || v === undefined || v === '' ? null : texte(v));
const nombreOuNul = (v: Valeur): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

const UNITES: readonly UniteRecolte[] = ['kg', 'botte', 'piece', 'barquette'];
const MODES: readonly ModeItineraire[] = ['semis_direct', 'plant_maison', 'plant_achete'];
const ETAPES: readonly EtapeRealisee[] = ['semis_pepiniere', 'semis_direct', 'plantation', 'arrachage'];

function unite(v: Valeur): UniteRecolte {
  const u = texte(v);
  return (UNITES as readonly string[]).includes(u) ? (u as UniteRecolte) : 'kg';
}

function jsonOuNul(v: Valeur): unknown {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

const estObjet = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

function listeTextes(v: Valeur): string[] {
  const l = jsonOuNul(v);
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
}

function detailLu(type: string, v: Valeur): DetailLu | null {
  const d = jsonOuNul(v);
  if (!estObjet(d)) return null;
  if (type === 'realise') {
    const etape = d.etape;
    if (typeof etape !== 'string' || !(ETAPES as readonly string[]).includes(etape)) return null;
    return { type, etape: etape as EtapeRealisee, quantiteReelle: typeof d.quantiteReelle === 'number' ? d.quantiteReelle : null };
  }
  if (type === 'recolte') {
    if (typeof d.quantite !== 'number') return null;
    return { type, quantite: d.quantite, unite: unite(typeof d.unite === 'string' ? d.unite : null), categorie: typeof d.categorie === 'string' ? d.categorie : null };
  }
  return null;
}

function evenementLu(l: Ligne): EvenementLu | null {
  const detail = detailLu(texte(l.type), l.detail);
  if (detail === null) return null;
  const sorte = texteOuNul(l.remplace_sorte);
  return {
    id: texte(l.id),
    date: texte(l.date),
    horodatage: texte(l.horodatage),
    serieId: texteOuNul(l.serie_id),
    campagneId: texteOuNul(l.campagne_id),
    emplacementIds: listeTextes(l.emplacement_ids),
    note: texteOuNul(l.note),
    photos: listeTextes(l.photos),
    remplaceSorte: sorte === 'correction' || sorte === 'annulation' ? sorte : null,
    remplaceEvenementId: texteOuNul(l.remplace_evenement_id),
    detail,
  };
}

/**
 * Événements en vigueur (vue evenements_en_vigueur de @planif/db) : ni les annulations, ni un
 * événement annulé ou corrigé ; d'une correction, seule la plus récente (horodatage, puis id)
 * reste, et aucune si l'événement corrigé est annulé.
 */
export function enVigueur(evenements: readonly EvenementLu[]): EvenementLu[] {
  const remplaces = new Set<string>();
  const parCible = new Map<string, EvenementLu[]>();
  for (const e of evenements) {
    if (e.remplaceEvenementId === null) continue;
    remplaces.add(e.remplaceEvenementId);
    const freres = parCible.get(e.remplaceEvenementId);
    if (freres === undefined) parCible.set(e.remplaceEvenementId, [e]);
    else freres.push(e);
  }
  const plusRecent = (a: EvenementLu, b: EvenementLu) => a.horodatage > b.horodatage || (a.horodatage === b.horodatage && a.id > b.id);
  return evenements.filter((e) => {
    if (e.remplaceSorte === 'annulation' || remplaces.has(e.id)) return false;
    if (e.remplaceSorte !== 'correction' || e.remplaceEvenementId === null) return true;
    const freres = parCible.get(e.remplaceEvenementId) ?? [];
    return !freres.some((s) => s !== e && (s.remplaceSorte === 'annulation' || plusRecent(s, e)));
  });
}

// ── Requêtes ─────────────────────────────────────────────────────────────────────────────────

const SERIES_ACTIVES = `SELECT id FROM serie WHERE ferme_id = ? AND supprime_le IS NULL AND statut IN ('prevue', 'en_cours')`;
const CAMPAGNES_ACTIVES = `SELECT id FROM campagne WHERE ferme_id = ? AND supprime_le IS NULL AND (fin_recolte_prevue IS NULL OR fin_recolte_prevue >= ?)`;
const RECENTS = (colonne: 'serie_id' | 'campagne_id') =>
  `SELECT ${colonne} FROM evenement WHERE ferme_id = ? AND ${colonne} IS NOT NULL AND (date >= ? OR horodatage >= ?)`;

const SQL_SERIES = `SELECT s.id, s.statut, s.parametres, s.prevu_semis_pepiniere, s.prevu_mise_en_place, s.prevu_debut_recolte,
    s.prevu_fin_recolte, s.longueur_m, s.nombre_plants, s.espece_id, s.variete_id,
    e.nom AS espece, e.unite_recolte, f.nom AS famille, v.nom AS variete
  FROM serie s
  LEFT JOIN espece e ON e.id = s.espece_id
  LEFT JOIN famille f ON f.id = e.famille_id
  LEFT JOIN variete v ON v.id = s.variete_id
  WHERE s.ferme_id = ? AND s.supprime_le IS NULL
    AND (s.statut IN ('prevue', 'en_cours') OR s.id IN (${RECENTS('serie_id')}))`;

const SQL_CAMPAGNES = `SELECT c.id, c.debut_recolte_prevu, c.fin_recolte_prevue, p.id AS plantation_id, p.nombre_plants,
    p.date_arrachage, p.espece_id, p.variete_id, e.nom AS espece, e.unite_recolte, f.nom AS famille, v.nom AS variete
  FROM campagne c
  JOIN plantation p ON p.id = c.plantation_id
  LEFT JOIN espece e ON e.id = p.espece_id
  LEFT JOIN famille f ON f.id = e.famille_id
  LEFT JOIN variete v ON v.id = p.variete_id
  WHERE c.ferme_id = ? AND c.supprime_le IS NULL AND p.supprime_le IS NULL
    AND (c.fin_recolte_prevue IS NULL OR c.fin_recolte_prevue >= ? OR c.id IN (${RECENTS('campagne_id')}))`;

const SQL_OCCUPATIONS = `SELECT o.serie_id, o.plantation_id, em.id AS emplacement_id, em.code, z.nom AS zone
  FROM occupation o
  JOIN emplacement em ON em.id = o.emplacement_id
  LEFT JOIN zone z ON z.id = em.zone_id
  WHERE o.ferme_id = ? AND o.supprime_le IS NULL
    AND (o.serie_id IN (${SERIES_ACTIVES}) OR o.serie_id IN (${RECENTS('serie_id')})
      OR o.plantation_id IN (SELECT plantation_id FROM campagne WHERE id IN (${CAMPAGNES_ACTIVES}) OR id IN (${RECENTS('campagne_id')})))`;

const SQL_EVENEMENTS = `SELECT id, type, date, horodatage, serie_id, campagne_id, emplacement_ids, note, photos,
    remplace_sorte, remplace_evenement_id, detail
  FROM evenement
  WHERE ferme_id = ? AND type IN ('realise', 'recolte')
    AND (date >= ? OR horodatage >= ? OR serie_id IN (${SERIES_ACTIVES}) OR campagne_id IN (${CAMPAGNES_ACTIVES}))`;

export interface LignesJournee {
  readonly series: readonly Ligne[];
  readonly campagnes: readonly Ligne[];
  readonly occupations: readonly Ligne[];
  readonly evenements: readonly Ligne[];
}

/** Bornes de l'historique : date du journal, et instant de saisie (7 jours avant maintenant). */
export function bornesHistorique(aujourdhui: string, maintenant: Date): { readonly depuis: string; readonly horodatageDepuis: string } {
  return {
    depuis: ajouterJours(aujourdhui as DateCalendaire, -JOURS_HISTORIQUE),
    horodatageDepuis: new Date(maintenant.getTime() - JOURS_HISTORIQUE * 86_400_000).toISOString(),
  };
}

/** Lit ce dont la journée a besoin : quatre requêtes en parallèle, bornées aux cultures actives. */
export async function lireJournee(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date): Promise<LignesJournee> {
  const { depuis, horodatageDepuis } = bornesHistorique(aujourdhui, maintenant);
  const recents = [fermeId, depuis, horodatageDepuis];
  const [series, campagnes, occupations, evenements] = await Promise.all([
    porte.lire<Ligne>(SQL_SERIES, [fermeId, ...recents]),
    porte.lire<Ligne>(SQL_CAMPAGNES, [fermeId, aujourdhui, ...recents]),
    porte.lire<Ligne>(SQL_OCCUPATIONS, [fermeId, fermeId, ...recents, fermeId, aujourdhui, ...recents]),
    porte.lire<Ligne>(SQL_EVENEMENTS, [fermeId, depuis, horodatageDepuis, fermeId, fermeId, aujourdhui]),
  ]);
  return { series, campagnes, occupations, evenements };
}

// ── Calcul de la journée ─────────────────────────────────────────────────────────────────────

const COLLATEUR = new Intl.Collator('fr', { numeric: true });

function trierEmplacements(l: EmplacementConcerne[]): EmplacementConcerne[] {
  return l.sort((a, b) => COLLATEUR.compare(a.zone, b.zone) || COLLATEUR.compare(a.code, b.code));
}

function ajouterA<K, V>(m: Map<K, V[]>, cle: K, v: V): void {
  const l = m.get(cle);
  if (l === undefined) m.set(cle, [v]);
  else l.push(v);
}

/** Étape du semainier que réalise un réalisé du journal. */
function etapeSerie(etape: EtapeRealisee): EtapeSerie {
  switch (etape) {
    case 'semis_pepiniere':
      return 'semisPepiniere';
    case 'semis_direct':
    case 'plantation':
      return 'miseEnPlace';
    case 'arrachage':
      return 'finRecolte';
  }
}

function plusTot(a: DateCalendaire | undefined, b: string): DateCalendaire {
  return a === undefined || b < a ? (b as DateCalendaire) : a;
}

interface SerieLue {
  readonly semainier: SerieSemainier | null;
  readonly active: boolean;
  readonly finPrevue: string | null;
}

function modeDe(parametres: Valeur): ModeItineraire | null {
  const p = jsonOuNul(parametres);
  const mode = estObjet(p) ? p.mode : null;
  return typeof mode === 'string' && (MODES as readonly string[]).includes(mode) ? (mode as ModeItineraire) : null;
}

/** Calcule la journée depuis les lignes lues. Pure. */
export function calculerJournee(lignes: LignesJournee, aujourdhui: string, maintenant: Date): Journee {
  const J = aujourdhui as DateCalendaire;
  const { depuis, horodatageDepuis } = bornesHistorique(aujourdhui, maintenant);

  const parSerie = new Map<string, EmplacementConcerne[]>();
  const parPlantation = new Map<string, EmplacementConcerne[]>();
  for (const o of lignes.occupations) {
    const e: EmplacementConcerne = { id: texte(o.emplacement_id) as Id<'Emplacement'>, code: texte(o.code), zone: texte(o.zone) };
    const serieId = texteOuNul(o.serie_id);
    const plantationId = texteOuNul(o.plantation_id);
    const cible = serieId !== null ? parSerie : parPlantation;
    const cle = serieId ?? plantationId;
    if (cle === null) continue;
    // Deux occupations d'une culture sur le même emplacement : une seule fois.
    if (!(cible.get(cle) ?? []).some((x) => x.id === e.id)) ajouterA(cible, cle, e);
  }

  const cultures = new Map<string, Culture>();
  const series = new Map<string, SerieLue>();
  for (const s of lignes.series) {
    const id = texte(s.id);
    const emplacements = trierEmplacements(parSerie.get(id) ?? []);
    cultures.set(id, {
      cible: { sorte: 'serie', serieId: id as Id<'Serie'> },
      cibleId: id,
      especeId: texte(s.espece_id),
      varieteId: texteOuNul(s.variete_id),
      espece: texte(s.espece) || 'Culture',
      variete: texteOuNul(s.variete),
      unite: unite(s.unite_recolte),
      famille: cleFamille(texteOuNul(s.famille)),
      emplacements,
    });
    const statut = texte(s.statut) as StatutSerie;
    const active = statut === 'prevue' || statut === 'en_cours';
    const mode = modeDe(s.parametres);
    const miseEnPlace = texteOuNul(s.prevu_mise_en_place);
    const debutRecolte = texteOuNul(s.prevu_debut_recolte);
    const finRecolte = texteOuNul(s.prevu_fin_recolte);
    const semis = texteOuNul(s.prevu_semis_pepiniere);
    let pourSemainier: SerieSemainier | null = null;
    if (active && mode !== null && miseEnPlace !== null && debutRecolte !== null && finRecolte !== null) {
      const datesPrevues: DatesPrevuesSerie = {
        ...(semis !== null && mode === 'plant_maison' ? { semisPepiniere: semis as DateCalendaire } : {}),
        miseEnPlace: miseEnPlace as DateCalendaire,
        debutRecolte: debutRecolte as DateCalendaire,
        finRecolte: finRecolte as DateCalendaire,
      };
      const longueur = nombreOuNul(s.longueur_m);
      const taille: TailleSerie = longueur !== null ? { unite: 'longueur', longueurM: longueur } : { unite: 'plants', nombrePlants: nombreOuNul(s.nombre_plants) ?? 0 };
      pourSemainier = {
        id: id as Id<'Serie'>,
        statut,
        mode,
        culture: texte(s.espece) || 'Culture',
        variete: texteOuNul(s.variete),
        datesPrevues,
        taille,
        emplacements,
      };
    }
    series.set(id, { semainier: pourSemainier, active, finPrevue: finRecolte });
  }

  const campagnes: { readonly semainier: CampagneSemainier; readonly arrachee: boolean }[] = [];
  for (const c of lignes.campagnes) {
    const id = texte(c.id);
    const emplacements = trierEmplacements(parPlantation.get(texte(c.plantation_id)) ?? []);
    const culture: Culture = {
      cible: { sorte: 'campagne', campagneId: id as Id<'Campagne'> },
      cibleId: id,
      especeId: texte(c.espece_id),
      varieteId: texteOuNul(c.variete_id),
      espece: texte(c.espece) || 'Culture',
      variete: texteOuNul(c.variete),
      unite: unite(c.unite_recolte),
      famille: cleFamille(texteOuNul(c.famille)),
      emplacements,
    };
    cultures.set(id, culture);
    const arrachage = texteOuNul(c.date_arrachage);
    campagnes.push({
      arrachee: arrachage !== null && arrachage <= aujourdhui,
      semainier: {
        id: id as Id<'Campagne'>,
        culture: culture.espece,
        variete: culture.variete,
        debutRecoltePrevu: texteOuNul(c.debut_recolte_prevu) as DateCalendaire | null,
        finRecoltePrevue: texteOuNul(c.fin_recolte_prevue) as DateCalendaire | null,
        nombrePlants: nombreOuNul(c.nombre_plants) ?? 0,
        emplacements,
      },
    });
  }

  // Journal en vigueur : réalisés des séries et des campagnes, historique, dernières récoltes.
  const lus: EvenementLu[] = [];
  for (const l of lignes.evenements) {
    const e = evenementLu(l);
    if (e !== null) lus.push(e);
  }
  const vigueur = enVigueur(lus);
  const realisesSeries = new Map<Id<'Serie'>, Partial<Record<EtapeSerie, DateCalendaire>>>();
  const realisesCampagnes = new Map<Id<'Campagne'>, DateCalendaire>();
  const dernieresRecoltes = new Map<string, DerniereRecolte>();
  for (const e of vigueur) {
    if (e.serieId !== null) {
      const id = e.serieId as Id<'Serie'>;
      const r = realisesSeries.get(id) ?? {};
      const etape: EtapeSerie = e.detail.type === 'realise' ? etapeSerie(e.detail.etape) : 'debutRecolte';
      r[etape] = plusTot(r[etape], e.date);
      realisesSeries.set(id, r);
    } else if (e.campagneId !== null && e.detail.type === 'recolte') {
      const id = e.campagneId as Id<'Campagne'>;
      realisesCampagnes.set(id, plusTot(realisesCampagnes.get(id), e.date));
    }
    const cible = e.serieId ?? e.campagneId;
    if (e.detail.type === 'recolte' && cible !== null) {
      const avant = dernieresRecoltes.get(cible);
      if (avant === undefined || e.date >= avant.date) dernieresRecoltes.set(cible, { date: e.date, quantite: e.detail.quantite, unite: e.detail.unite });
    }
  }
  const realises = { series: realisesSeries as ReadonlyMap<Id<'Serie'>, RealisesSerie>, campagnes: realisesCampagnes };

  // Semainier de la semaine (T06), dans l'ordre du moteur.
  const actives = [...series.values()].map((s) => s.semainier).filter((s): s is SerieSemainier => s !== null);
  const semaine = semaineIso(J);
  const brutes = semainier(
    semaine,
    actives,
    campagnes.filter((c) => !c.arrachee).map((c) => c.semainier),
    realises,
    J,
  );
  const taches: TacheJour[] = [];
  for (const t of brutes) {
    const cibleId = t.cible.sorte === 'serie' ? t.cible.serieId : t.cible.campagneId;
    const culture = cultures.get(cibleId);
    if (culture !== undefined) taches.push({ cle: `${cibleId}:${t.etape}`, tache: t, culture });
  }

  // Récoltes en cours : la fenêtre de récolte contient aujourd'hui.
  const recoltesEnCours: Culture[] = [];
  for (const s of actives) {
    const r = realises.series.get(s.id);
    if (r?.finRecolte !== undefined) continue;
    const debut = r === undefined ? s.datesPrevues.debutRecolte : appliquerRealises(s.datesPrevues, r).debutRecolte;
    const culture = cultures.get(s.id);
    if (culture !== undefined && debut <= J && J <= s.datesPrevues.finRecolte) recoltesEnCours.push(culture);
  }
  for (const c of campagnes) {
    const { debutRecoltePrevu: debut, finRecoltePrevue: fin, id } = c.semainier;
    const culture = cultures.get(id);
    if (!c.arrachee && culture !== undefined && debut !== null && debut <= J && (fin === null || J <= fin)) recoltesEnCours.push(culture);
  }
  recoltesEnCours.sort((a, b) => COLLATEUR.compare(a.espece, b.espece) || COLLATEUR.compare(a.emplacements[0]?.code ?? '', b.emplacements[0]?.code ?? ''));

  const historique: EntreeHistorique[] = vigueur
    .filter((e) => e.date >= depuis || e.horodatage >= horodatageDepuis)
    .sort((a, b) => (a.horodatage === b.horodatage ? (a.id < b.id ? 1 : -1) : a.horodatage < b.horodatage ? 1 : -1))
    .map((evenement) => ({ evenement, culture: cultures.get(evenement.serieId ?? evenement.campagneId ?? '') ?? null }));

  return { aujourdhui, semaine: semaine.semaine, taches, recoltesEnCours, historique, cultures, dernieresRecoltes };
}

// ── Textes ───────────────────────────────────────────────────────────────────────────────────

/** 12.5 → « 12,5 » (écriture la plus courte, virgule française). */
export function nombreFrancais(n: number): string {
  return String(n).replace('.', ',');
}

const UNITES_AFFICHEES: Readonly<Record<UniteRecolte, readonly [string, string]>> = {
  kg: ['kg', 'kg'],
  botte: ['botte', 'bottes'],
  piece: ['pièce', 'pièces'],
  barquette: ['barquette', 'barquettes'],
};

/** « 12 kg », « 1 botte », « 3 barquettes ». */
export function quantiteAvecUnite(quantite: number, u: UniteRecolte): string {
  const [un, plusieurs] = UNITES_AFFICHEES[u];
  return `${nombreFrancais(quantite)} ${quantite >= 2 ? plusieurs : un}`;
}

/** « Tomate Cœur de bœuf ». */
export function nomCulture(c: Culture): string {
  return c.variete === null ? c.espece : `${c.espece} ${c.variete}`;
}

/** Codes des emplacements : « T2-P03 », « T2-P03 · T2-P04 », « T2-P03 +3 ». */
export function codesEmplacements(emplacements: readonly EmplacementConcerne[]): string | null {
  if (emplacements.length === 0) return null;
  if (emplacements.length <= 2) return emplacements.map((e) => e.code).join(' · ');
  return `${emplacements[0]?.code ?? ''} +${String(emplacements.length - 1)}`;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** « 23 sept. », sans objet Date. */
export function dateCourte(date: string): string {
  const [, m, j] = date.split('-');
  return `${String(Number(j))} ${MOIS_COURTS[Number(m) - 1] ?? ''}`;
}

/** Quand, par rapport à aujourd'hui : « aujourd'hui », « hier », « demain », « jeudi 1er oct. », « 23 sept. ». */
export function quand(date: string, aujourdhui: string): string {
  const ecart = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000);
  if (ecart === 0) return 'aujourd’hui';
  if (ecart === -1) return 'hier';
  if (ecart === 1) return 'demain';
  if (ecart > 1 && ecart < 7) {
    const jourSemaine = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    return `${JOURS[jourSemaine] ?? ''} ${dateCourte(date)}`;
  }
  return `le ${dateCourte(date)}`;
}

/** Verbe de l'étape, pour la carte : « Planter », « Semer »… */
export const VERBES: Readonly<Record<TacheSemainier['etape'], string>> = {
  semis_pepiniere: 'Semer en pépinière',
  semis_direct: 'Semer',
  plantation: 'Planter',
  arrachage: 'Arracher',
  debut_recolte: 'Récolter',
};

/** Nom de l'étape réalisée, pour l'historique. */
export const ETAPES_FAITES: Readonly<Record<EtapeRealisee, string>> = {
  semis_pepiniere: 'Semis en pépinière',
  semis_direct: 'Semis',
  plantation: 'Plantation',
  arrachage: 'Arrachage',
};
