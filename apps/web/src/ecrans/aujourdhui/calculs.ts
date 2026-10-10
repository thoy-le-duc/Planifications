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
  estDateValide,
  semaineIso,
  semainier,
  validerTravauxPrevus,
  type CampagneSemainier,
  type CategorieIntervention,
  type CultureConcernee,
  type DateCalendaire,
  type DatesPrevuesSerie,
  type EmplacementConcerne,
  type EtapeRealisee,
  type EtapeSerie,
  type Id,
  type InterventionRealisee,
  type ModeItineraire,
  type SerieSemainier,
  type StatutSerie,
  type TacheSemainier,
  type TailleSerie,
  type TravailPrevu,
  type UniteRecolte,
} from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import { CHAINES } from '@planif/sync/fait-unique';
import { comparerSaisies, instantHorodatage } from '@planif/sync/horodatage';
import { cleFamille } from '../plan/calculs.ts';

// ── Types ────────────────────────────────────────────────────────────────────────────────────

/**
 * Bandes de couleur de l'écran Aujourd'hui (T16) : quatre familles seulement. Les autres (T27b : 12
 * familles de plus et « autre » pour le plan et la vue 3D) restent sans bande ici, comme avant.
 */
export type BandeFamille = 'salades' | 'solanacees' | 'cruciferes' | 'racines';

function bandeFamille(nomFamille: string | null): BandeFamille | null {
  const cle = cleFamille(nomFamille);
  return cle === 'salades' || cle === 'solanacees' || cle === 'cruciferes' || cle === 'racines' ? cle : null;
}

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
  readonly famille: BandeFamille | null;
  /** Emplacements des occupations non supprimées, triés (zone, code). */
  readonly emplacements: readonly EmplacementConcerne[];
}

export type DetailLu =
  | { readonly type: 'realise'; readonly etape: EtapeRealisee; readonly quantiteReelle: number | null }
  | { readonly type: 'recolte'; readonly quantite: number; readonly unite: UniteRecolte; readonly categorie: string | null }
  /** T22 : intervention (travail du sol, entretien…) ; le détail complet est relu pour l'annuler. */
  | { readonly type: 'intervention'; readonly categorie: CategorieIntervention; readonly libelle: string };

/** Événement du journal (réalisé, récolte ou intervention), lu tel quel. */
export interface EvenementLu {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly serieId: string | null;
  readonly campagneId: string | null;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
  readonly detail: DetailLu;
}

export interface TacheJour {
  /** `<id de la série ou campagne>:<étape>`, ou `<id de la série>:travail:<indice>:<date prévue>` (T22 : une clé par occurrence affichée). */
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
  /** Dernière récolte en vigueur de chaque culture (id de série ou de campagne), sur l'historique. */
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
const CATEGORIES: readonly CategorieIntervention[] = ['travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'];

function categorie(v: Valeur): CategorieIntervention | null {
  const c = texte(v);
  return (CATEGORIES as readonly string[]).includes(c) ? (c as CategorieIntervention) : null;
}

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

/** Liste de textes d'une colonne JSON (emplacement_ids, photos). */
export function listeTextes(v: Valeur): string[] {
  const l = jsonOuNul(v);
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Détail lu par la requête (json_extract dans la base : aucun JSON.parse ici, le journal d'une
 * grande ferme compte des milliers de lignes).
 */
function detailLu(l: Ligne): DetailLu | null {
  if (l.type === 'realise') {
    const etape = texte(l.etape);
    if (!(ETAPES as readonly string[]).includes(etape)) return null;
    return { type: 'realise', etape: etape as EtapeRealisee, quantiteReelle: typeof l.quantite_reelle === 'number' ? l.quantite_reelle : null };
  }
  if (l.type === 'recolte') {
    if (typeof l.quantite !== 'number') return null;
    return { type: 'recolte', quantite: l.quantite, unite: unite(l.unite), categorie: texteOuNul(l.categorie) };
  }
  if (l.type === 'intervention') {
    const c = categorie(l.categorie);
    const libelle = texte(l.type_intervention);
    if (c === null || libelle.trim() === '') return null;
    return { type: 'intervention', categorie: c, libelle };
  }
  return null;
}

/**
 * Une ligne du journal telle que l'écran la lit : le detail en colonnes (`CHAMPS_DETAIL`). T13m :
 * les écritures relisent une saisie par la même lecture (`COLONNES_DETAIL`, puis `evenementLu`).
 */
export type LigneJournal = Ligne;

export function evenementLu(l: Ligne): EvenementLu | null {
  const detail = detailLu(l);
  if (detail === null) return null;
  const sorte = texteOuNul(l.remplace_sorte);
  return {
    id: texte(l.id),
    date: texte(l.date),
    horodatage: texte(l.horodatage),
    serieId: texteOuNul(l.serie_id),
    campagneId: texteOuNul(l.campagne_id),
    remplaceSorte: sorte === 'correction' || sorte === 'annulation' ? sorte : null,
    remplaceEvenementId: texteOuNul(l.remplace_evenement_id),
    detail,
  };
}

/** Ce que `enVigueur` lit d'un événement : sa place dans sa chaîne de remplacements. */
export type MaillonChaine = Pick<EvenementLu, 'id' | 'horodatage' | 'remplaceSorte' | 'remplaceEvenementId'>;

/**
 * Événements en vigueur (vue evenements_en_vigueur de @planif/db, T10g) : on regroupe chaque
 * événement avec sa chaîne (l'origine, ses corrections, les corrections de ses corrections, et
 * toutes leurs annulations). Une chaîne qui contient une annulation n'a plus rien en vigueur ;
 * sinon une seule saisie reste : la correction la plus récente de TOUTE la chaîne (horodatage,
 * puis id le plus grand), à défaut l'origine. Même règle que `lireChaine` du serveur, même quand
 * la chaîne se ramifie. Un parent absent de la liste (origine plus ancienne que l'historique lu) :
 * son id sert de clé de chaîne, pour que deux corrections d'une même origine absente se
 * départagent quand même. Sur des chaînes complètes, même résultat que `EN_VIGUEUR` (SQL), dont
 * la journée se sert : l'historique ne lit qu'une fenêtre, la base juge sur tout le journal.
 * T13m : un cycle (données corrompues) n'a rien en vigueur, ni ce qui y remonte, comme `chaines` ;
 * l'équivalence avec `chaines` et `chaineDe` est vérifiée par comparaison aléatoire
 * (chaine-unique.test.ts).
 */
export function enVigueur<E extends MaillonChaine>(evenements: readonly E[]): E[] {
  const parId = new Map(evenements.map((e) => [e.id, e]));
  /** Origine de chaque événement déjà monté ; null : cycle (données corrompues), rien en vigueur. */
  const origines = new Map<string, string | null>();
  const origineDe = (e: E): string | null => {
    const connue = origines.get(e.id);
    if (connue !== undefined) return connue;
    // Montée jusqu'au plus haut connu ; `vus` détecte un cycle : comme `chaines` (CHAINES), aucune
    // origine n'est atteinte, ni pour le cycle ni pour ce qui y remonte.
    const chemin: string[] = [];
    const vus = new Set<string>();
    let courant = e;
    let origine: string | null | undefined;
    for (;;) {
      origine = origines.get(courant.id);
      if (origine !== undefined) break;
      chemin.push(courant.id);
      vus.add(courant.id);
      const parent = courant.remplaceEvenementId === null ? undefined : parId.get(courant.remplaceEvenementId);
      if (parent === undefined) {
        // Parent absent de la liste : son id sert de clé de chaîne.
        origine = courant.remplaceEvenementId ?? courant.id;
        break;
      }
      if (vus.has(parent.id)) {
        origine = null;
        break;
      }
      courant = parent;
    }
    for (const id of chemin) origines.set(id, origine);
    return origine;
  };
  // T13n : (instant, id), l'horodatage lu comme un instant quel que soit son format.
  const plusRecent = (a: E, b: E) => comparerSaisies(a, b) > 0;
  const annulees = new Set<string>();
  /** Par chaîne : la correction la plus récente, sinon l'origine (la première sans remplacement vue). */
  const retenue = new Map<string, E>();
  for (const e of evenements) {
    const o = origineDe(e);
    if (o === null) continue;
    if (e.remplaceSorte === 'annulation') {
      annulees.add(o);
      continue;
    }
    const actuelle = retenue.get(o);
    if (actuelle === undefined) {
      retenue.set(o, e);
    } else if (e.remplaceSorte === 'correction' && (actuelle.remplaceSorte !== 'correction' || plusRecent(e, actuelle))) {
      retenue.set(o, e);
    }
  }
  return evenements.filter((e) => {
    const o = origineDe(e);
    return o !== null && !annulees.has(o) && retenue.get(o) === e;
  });
}

// ── Requêtes ─────────────────────────────────────────────────────────────────────────────────
//
// T13b : la base locale de PowerSync range chaque ligne en JSON (`ps_data__<table>.data`) ; lire
// une colonne de la vue, c'est extraire du JSON. Le coût d'une lecture est donc surtout le nombre
// de lignes dont on ouvre le JSON (et, sur le téléphone, les pages de la base à lire). D'où :
//   - chaque requête part d'un index (jamais de parcours de tout le journal de la ferme), qui
//     porte si possible les colonnes lues : SQLite les y prend sans ouvrir la ligne ;
//   - les petites tables (espèces, variétés, emplacements, zones) sont lues une fois et jointes
//     ici, pas une fois par série ou par occupation ;
//   - les chaînes de remplacement (`CHAINES`) sont calculées une seule fois par journée ;
//   - les listes d'identifiants (séries actives, chaînes) passent en un paramètre JSON (`DANS`) ;
//   - un detail qui n'est pas du JSON écarte sa ligne (`json_valid`) : json_extract lèverait, et
//     toute la journée avec lui.

/**
 * Séries que le semainier peut planifier : prévues ou en cours (index ferme_statut : les séries
 * terminées des saisons passées ne sont pas lues), avec un mode d'itinéraire valide, vérifié par
 * `lireJournee` (`parametresDe`) : sans lui, pas de dates d'étapes, `calculerJournee` les
 * écarterait.
 */
const FILTRE_SERIES_ACTIVES = `s.statut IN ('prevue', 'en_cours')`;
/** Liste d'identifiants passée en UN paramètre (tableau JSON) : `x IN (${DANS})`. */
const DANS = 'SELECT value FROM json_each(?)';
/** Tableau JSON d'identifiants, sans doublon ni vide, pour `DANS`. */
const listeJson = (ids: Iterable<string>): string => JSON.stringify([...new Set(ids)].filter((x) => x !== ''));

/**
 * Séries, l'instantané `parametres` en texte (lu une fois par texte : `parametresDe`), sans
 * jointure (l'espèce, la famille et la variété sont lues à part : `lireNoms`) ; `filtre`
 * sur l'alias `s`.
 */
const sqlSeries = (filtre: string) => `SELECT s.id, s.statut, s.parametres, s.prevu_semis_pepiniere,
    s.prevu_mise_en_place, s.prevu_debut_recolte, s.prevu_fin_recolte, s.longueur_m, s.nombre_plants, s.espece_id, s.variete_id
  FROM serie s
  WHERE s.ferme_id = ? AND s.supprime_le IS NULL AND ${filtre}`;

/**
 * Isolement entre fermes (T13c) : espèces, familles, variétés, emplacements et zones sont lus
 * par identifiant, et seulement ceux de la ferme affichée. Une ligne d'une autre ferme présente
 * dans la base locale (utilisateur membre de deux fermes), référencée par erreur, ne prête jamais
 * son nom à la journée : la culture s'affiche alors sans (« Culture », sans variété, sans
 * famille, sans cet emplacement).
 */

/** Espèces des séries lues (liste JSON, puis la ferme), avec le nom de leur famille. */
const SQL_ESPECES = `SELECT e.id, e.nom, e.unite_recolte, f.nom AS famille FROM espece e
  LEFT JOIN famille f ON f.id = e.famille_id AND f.ferme_id = e.ferme_id
  WHERE e.id IN (${DANS}) AND e.ferme_id = ?`;
const SQL_VARIETES = `SELECT id, nom FROM variete WHERE id IN (${DANS}) AND ferme_id = ?`;

/**
 * Campagnes jointes à leur plantation ; `filtre` sur l'alias `c`. Une campagne dont la
 * plantation est d'une autre ferme est masquée (décision du chef, T13c) : elle n'en reprend ni
 * le nombre de plants ni la date d'arrachage.
 */
const sqlCampagnes = (filtre: string) => `SELECT c.id, c.debut_recolte_prevu, c.fin_recolte_prevue, p.id AS plantation_id, p.nombre_plants,
    p.date_arrachage, p.espece_id, p.variete_id, e.nom AS espece, e.unite_recolte, f.nom AS famille, v.nom AS variete
  FROM campagne c
  JOIN plantation p ON p.id = c.plantation_id AND p.ferme_id = c.ferme_id
  LEFT JOIN espece e ON e.id = p.espece_id AND e.ferme_id = c.ferme_id
  LEFT JOIN famille f ON f.id = e.famille_id AND f.ferme_id = c.ferme_id
  LEFT JOIN variete v ON v.id = p.variete_id AND v.ferme_id = c.ferme_id
  WHERE c.ferme_id = ? AND c.supprime_le IS NULL AND p.supprime_le IS NULL AND ${filtre}`;

/** Occupations non supprimées des séries et des plantations données (deux listes JSON). */
const SQL_OCCUPATIONS = `SELECT o.serie_id, o.plantation_id, o.emplacement_id FROM occupation o
  WHERE o.ferme_id = ? AND o.supprime_le IS NULL AND (o.serie_id IN (${DANS}) OR o.plantation_id IN (${DANS}))`;

/**
 * Emplacements occupés (liste JSON, puis la ferme), avec leur zone. Seuls les emplacements actifs
 * le jour donné (deux derniers paramètres) : jamais un emplacement supprimé ou retiré recopié
 * dans une saisie (le serveur le refuserait).
 */
const SQL_EMPLACEMENTS = `SELECT em.id, em.code, z.nom AS zone FROM emplacement em
  LEFT JOIN zone z ON z.id = em.zone_id AND z.ferme_id = em.ferme_id
  WHERE em.id IN (${DANS}) AND em.ferme_id = ? AND em.supprime_le IS NULL AND em.actif_du <= ? AND (em.actif_au IS NULL OR em.actif_au > ?)`;


/**
 * Les chaînes, lues UNE fois par journée (avant T13b, chaque requête du journal les recalculait) :
 * l'origine de chaque chaîne remplacée, et l'id de la correction gagnante (la plus grande clé
 * horodatage|id) de chaque chaîne sans annulation, en deux tableaux JSON que `EN_VIGUEUR` relit
 * (`json_each`). L'id plutôt que la clé : la clé contient l'id, désigner la gagnante par son id
 * revient au même, et le journal n'a pas à ouvrir chaque correction pour en lire l'horodatage.
 */
const SQL_CHAINES = `${CHAINES}SELECT json_group_array(origine) AS origines,
    json_group_array(id) FILTER (WHERE annulations = 0 AND cle IS NOT NULL) AS gagnants
  FROM chaine`;

/**
 * Règle « en vigueur » de la vue evenements_en_vigueur (@planif/db, T10g décision 4), en SQL, pour
 * l'alias `e`, sur les chaînes de `SQL_CHAINES` (deux paramètres : origines, gagnants) : la même
 * que `enVigueur`, sur tout le journal local. Une chaîne qui contient une annulation n'a rien en
 * vigueur ; sinon une seule saisie : la correction la plus récente de TOUTE la chaîne
 * (horodatage, puis id), à défaut l'origine (jamais remplacée). Le semainier (premières dates,
 * interventions) et l'historique s'en servent tous deux.
 */
const EN_VIGUEUR = `((e.remplace_sorte IS NULL AND e.id NOT IN (SELECT value FROM json_each(?)))
    OR (e.remplace_sorte = 'correction' AND e.id IN (SELECT value FROM json_each(?))))`;

/**
 * Réalisés des cultures actives, agrégés dans la base (première date par culture, par type et par
 * étape) : le journal d'une grande ferme compte des dizaines de milliers de lignes, seules
 * quelques-unes par culture arrivent jusqu'à la page. L'étape n'est lue que pour un réalisé.
 * Filtrées par la ferme, comme tout le journal : un événement d'une autre ferme posé sur une
 * culture de celle-ci ne compte jamais (isolement entre fermes).
 *
 * Séries (liste JSON, puis la ferme) : par l'index `serie` (série, ferme, type, date, sorte,
 * detail), qui porte tout ce que la requête lit, ferme comprise, sauf l'id (`EN_VIGUEUR`). Les récoltes à part, regroupées par la seule
 * série dans l'ordre de l'index, sans tri ; un événement vise au plus une culture
 * (`au_plus_une_culture`) : pas de campagne à regrouper.
 */
const SQL_REALISES_SERIES = `SELECT e.serie_id, 'recolte' AS type, NULL AS etape, MIN(e.date) AS date
  FROM evenement e
  WHERE e.serie_id IN (${DANS}) AND e.ferme_id = ? AND e.type = 'recolte' AND json_valid(e.detail) AND ${EN_VIGUEUR}
  GROUP BY e.serie_id
  UNION ALL
  SELECT e.serie_id, 'realise' AS type, json_extract(e.detail, '$.etape') AS etape, MIN(e.date) AS date
  FROM evenement e
  WHERE e.serie_id IN (${DANS}) AND e.ferme_id = ? AND e.type = 'realise' AND json_valid(e.detail) AND ${EN_VIGUEUR}
  GROUP BY e.serie_id, etape`;
/**
 * Campagnes (liste JSON, séries actives, puis la ferme) : par l'index `campagne` (la ferme lue
 * dans la ligne, écartée de l'index ferme_date par `+` : quelques centaines de récoltes) ; une
 * saisie d'une série active y est déjà comptée.
 */
const SQL_REALISES_CAMPAGNES = `SELECT e.serie_id, e.campagne_id, e.type,
    CASE e.type WHEN 'realise' THEN json_extract(e.detail, '$.etape') END AS etape, MIN(e.date) AS date
  FROM evenement e
  WHERE e.campagne_id IN (${DANS}) AND (e.serie_id IS NULL OR e.serie_id NOT IN (${DANS})) AND +e.ferme_id = ?
    AND e.type IN ('realise', 'recolte') AND json_valid(e.detail) AND ${EN_VIGUEUR}
  GROUP BY e.serie_id, e.campagne_id, e.type, etape`;

/**
 * T22 : interventions en vigueur des séries actives (ni annulées, ni remplacées par une
 * correction, ni les annulations elles-mêmes) : elles soldent les travaux prévus du semainier.
 * Liste JSON des séries, puis la ferme (index `serie`).
 */
const SQL_INTERVENTIONS = `SELECT e.serie_id, e.date, json_extract(e.detail, '$.categorie') AS categorie,
    json_extract(e.detail, '$.type') AS type_intervention,
    json_extract(e.detail, '$.occurrenceVisee') AS occurrence_visee
  FROM evenement e
  WHERE e.serie_id IN (${DANS}) AND e.ferme_id = ? AND e.type = 'intervention' AND json_valid(e.detail) AND ${EN_VIGUEUR}`;

/** Champs du detail lus pour l'historique : chemin JSON, colonne de la ligne. */
const CHAMPS_DETAIL = [
  ['etape', 'etape'],
  ['quantiteReelle', 'quantite_reelle'],
  ['quantite', 'quantite'],
  ['unite', 'unite'],
  ['categorie', 'categorie'],
  ['type', 'type_intervention'],
] as const;

/** Les champs du detail en colonnes, un `json_extract` chacun, pour `evenementLu` (une ligne seule). */
export const COLONNES_DETAIL = CHAMPS_DETAIL.map(([chemin, colonne]) => `json_extract(detail, '$.${chemin}') AS ${colonne}`).join(', ');

/**
 * Valeur d'un champ lu par une extraction à plusieurs chemins (tableau JSON), rendue comme
 * `json_extract` l'aurait rendue seule : booléen en 1 / 0, objet ou tableau en texte JSON.
 */
function valeurExtraite(v: unknown): Valeur {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' || typeof v === 'number') return v;
  return JSON.stringify(v);
}

/**
 * Saisies récentes (historique, dernières récoltes), en vigueur ou non, avec `en_vigueur` (0 / 1)
 * jugé sur toute la chaîne, y compris ses saisies plus anciennes que la fenêtre (T10h) : une
 * récolte dont l'origine et une correction sont hors de la fenêtre, et l'annulation dedans, est
 * bien annulée. Par la date du journal OU par l'instant de saisie : deux recherches indexées
 * réunies par UNION (un OR empêcherait les index) ; la seconde ne garde que les saisies d'une date
 * plus ancienne (lue dans l'index ferme_horodatage) : les deux parties sont disjointes. Les
 * champs du detail sont extraits en un appel (`CHAMPS_DETAIL`), puis rangés en colonnes ici.
 * T13q : la borne d'instant passée au SQL est élargie (`borneSql`), le texte de l'horodatage ne
 * se compare pas comme un instant ; `dansLaFenetre` trie ensuite les lignes par l'instant.
 */
const sqlRecents = (partie: string) => `SELECT e.id, e.type, e.date, e.horodatage, e.serie_id, e.campagne_id, e.remplace_sorte, e.remplace_evenement_id,
    json_extract(e.detail, ${CHAMPS_DETAIL.map(([chemin]) => `'$.${chemin}'`).join(', ')}) AS detail,
    ${EN_VIGUEUR} AS en_vigueur
  FROM evenement e
  WHERE ${partie} AND e.type IN ('realise', 'recolte', 'intervention') AND json_valid(e.detail)`;
const SQL_RECENTS = `${sqlRecents('e.ferme_id = ? AND e.date >= ?')}
  UNION ALL
  ${sqlRecents('e.ferme_id = ? AND e.horodatage >= ? AND (e.date < ? OR e.date IS NULL)')}`;

export interface LignesJournee {
  /** Séries (sans leurs noms : `especes`, `varietes`). */
  readonly series: readonly Ligne[];
  /** Espèces des séries (id, nom, unite_recolte, famille : nom de la famille). */
  readonly especes: readonly Ligne[];
  /** Variétés des séries (id, nom). */
  readonly varietes: readonly Ligne[];
  readonly campagnes: readonly Ligne[];
  readonly occupations: readonly Ligne[];
  /** Première date par culture, type et étape, parmi les événements en vigueur. */
  readonly realises: readonly Ligne[];
  /** T22 : interventions en vigueur des séries actives (série, date, catégorie, type, occurrence visée T22b). */
  readonly interventions: readonly Ligne[];
  /** Événements récents (bornesHistorique), tels quels, avec `en_vigueur` (0 / 1, toute la chaîne). */
  readonly recents: readonly Ligne[];
  /** Ce qu'il faut pour relire ensuite quelques cultures seulement (`lireCultures`, T13c). */
  readonly contexte: ContexteLecture;
}

/** Contexte d'une lecture complète de la journée, repris par les relectures incrémentales. */
export interface ContexteLecture {
  readonly fermeId: string;
  readonly aujourdhui: string;
  /** Chaînes du journal (`SQL_CHAINES`) : origines et gagnants, deux tableaux JSON pour `EN_VIGUEUR`. */
  readonly vigueur: readonly [string, string];
  /** Séries actives (celles dont les réalisés et interventions sont lus), en tableau JSON. */
  readonly jsonSeries: string;
  readonly series: ReadonlySet<string>;
  /** Campagnes en cours (celles dont les réalisés sont lus). */
  readonly campagnes: ReadonlySet<string>;
}

/** Bornes de l'historique : date du journal, et instant de saisie (7 jours avant maintenant). */
export function bornesHistorique(aujourdhui: string, maintenant: Date): { readonly depuis: string; readonly horodatageDepuis: string } {
  return {
    depuis: ajouterJours(aujourdhui as DateCalendaire, -JOURS_HISTORIQUE),
    horodatageDepuis: new Date(maintenant.getTime() - JOURS_HISTORIQUE * 86_400_000).toISOString(),
  };
}

/**
 * T13q : borne d'instant de la fenêtre élargie pour le SQL, qui compare le texte de l'horodatage
 * (comparer l'instant y ferait perdre l'index ferme_horodatage) : la veille du jour de la borne,
 * `AAAA-MM-JJ`. Toute forme canonique (jour valide, comme l'écrivent toISOString et Postgres) d'un instant postérieur à la borne commence par un jour au
 * plus un jour plus tôt (fuseau de −14:59 au plus), donc ne s'écrit pas avant ce texte. Les lignes
 * en trop sont écartées ensuite par `dansLaFenetre`, à l'instant près.
 */
const borneSql = (horodatageDepuis: string): string => ajouterJours(horodatageDepuis.slice(0, 10) as DateCalendaire, -1);

/** Lecture abandonnée entre deux requêtes : plus aucun écran ne l'attend. */
export class LectureAbandonnee extends Error {}

/** Ligne de `SQL_RECENTS`, les champs du detail rangés en colonnes (etape, quantite…). */
function ligneRecente(l: Ligne): Ligne {
  const champs = jsonOuNul(l.detail);
  const valeurs = Array.isArray(champs) ? champs : [];
  const ligne: Record<string, Valeur> = {
    id: l.id,
    type: l.type,
    date: l.date,
    horodatage: l.horodatage,
    serie_id: l.serie_id,
    campagne_id: l.campagne_id,
    remplace_sorte: l.remplace_sorte,
    remplace_evenement_id: l.remplace_evenement_id,
    en_vigueur: l.en_vigueur,
  };
  for (const [i, [, colonne]] of CHAMPS_DETAIL.entries()) ligne[colonne] = valeurExtraite(valeurs[i]);
  return ligne;
}

type Lire = (sql: string, parametres: readonly unknown[]) => Promise<Ligne[]>;

interface Noms {
  readonly especes: readonly Ligne[];
  readonly varietes: readonly Ligne[];
}

/** Espèces (avec leur famille) et variétés des séries lues par `sqlSeries`. */
async function lireNoms(lire: Lire, fermeId: string, series: readonly Ligne[]): Promise<Noms> {
  if (series.length === 0) return { especes: [], varietes: [] };
  const especes = await lire(SQL_ESPECES, [listeJson(series.map((s) => texte(s.espece_id))), fermeId]);
  const idsVarietes = series.map((s) => texte(s.variete_id)).filter((x) => x !== '');
  const varietes = idsVarietes.length === 0 ? [] : await lire(SQL_VARIETES, [listeJson(idsVarietes), fermeId]);
  return { especes, varietes };
}

/** Emplacements actifs occupés par ces séries et plantations : lignes (serie_id, plantation_id, emplacement_id, code, zone). */
async function lireOccupations(lire: Lire, fermeId: string, series: readonly string[], plantations: readonly string[], aujourdhui: string): Promise<Ligne[]> {
  if (series.length === 0 && plantations.length === 0) return [];
  const occupations = await lire(SQL_OCCUPATIONS, [fermeId, listeJson(series), listeJson(plantations)]);
  if (occupations.length === 0) return [];
  const emplacements = await lire(SQL_EMPLACEMENTS, [listeJson(occupations.map((o) => texte(o.emplacement_id))), fermeId, aujourdhui, aujourdhui]);
  const parId = new Map(emplacements.map((em) => [texte(em.id), em]));
  const lignes: Ligne[] = [];
  for (const o of occupations) {
    const em = parId.get(texte(o.emplacement_id));
    if (em !== undefined) lignes.push({ serie_id: o.serie_id, plantation_id: o.plantation_id, emplacement_id: em.id, code: em.code, zone: em.zone });
  }
  return lignes;
}

/**
 * Lit ce dont la journée a besoin, bornée aux cultures actives. Une requête à la fois (la base
 * n'en sert qu'une à la fois de toute façon) : entre deux, `continuer()` dit si un écran attend
 * encore la journée ; sinon la lecture s'arrête (LectureAbandonnee) et laisse la base à l'écran
 * affiché (le plan d'une grande ferme se lit en plusieurs secondes).
 */
export async function lireJournee(
  porte: PorteDonnees,
  fermeId: string,
  aujourdhui: string,
  maintenant: Date,
  continuer: () => boolean = () => true,
): Promise<LignesJournee> {
  const bornes = bornesHistorique(aujourdhui, maintenant);
  const { depuis } = bornes;
  const lire: Lire = async (sql, parametres) => {
    if (!continuer()) throw new LectureAbandonnee();
    return porte.lire<Ligne>(sql, parametres);
  };
  const series = (await lire(sqlSeries(FILTRE_SERIES_ACTIVES), [fermeId])).filter((s) => parametresDe(texte(s.id), s.parametres).mode !== null);
  const noms = await lireNoms(lire, fermeId, series);
  const campagnes = await lire(sqlCampagnes('(c.fin_recolte_prevue IS NULL OR c.fin_recolte_prevue >= ?)'), [fermeId, aujourdhui]);
  const idsSeries = series.map((s) => texte(s.id));
  const idsCampagnes = campagnes.map((c) => texte(c.id));
  const occupations = await lireOccupations(lire, fermeId, idsSeries, campagnes.map((c) => texte(c.plantation_id)), aujourdhui);

  const vigueur = await lireChaines(lire, fermeId);
  const jsonSeries = listeJson(idsSeries);
  const contexte: ContexteLecture = { fermeId, aujourdhui, vigueur, jsonSeries, series: new Set(idsSeries), campagnes: new Set(idsCampagnes) };
  const realises = [
    ...(await lire(SQL_REALISES_SERIES, [jsonSeries, fermeId, ...vigueur, jsonSeries, fermeId, ...vigueur])),
    ...(idsCampagnes.length === 0 ? [] : await lire(SQL_REALISES_CAMPAGNES, [listeJson(idsCampagnes), jsonSeries, fermeId, ...vigueur])),
  ];
  const interventions = await lire(SQL_INTERVENTIONS, [jsonSeries, fermeId, ...vigueur]);
  const recents = (await lire(SQL_RECENTS, [...vigueur, fermeId, depuis, ...vigueur, fermeId, borneSql(bornes.horodatageDepuis), depuis]))
    .filter((l) => dansLaFenetre(l, bornes))
    .map(ligneRecente);
  // Historique : les cultures terminées ou passées qu'il nomme, lues en plus (rarement).
  const connues = new Set([...idsSeries, ...idsCampagnes]);
  const autresSeries = [...new Set(recents.map((l) => texte(l.serie_id)).filter((x) => x !== '' && !connues.has(x)))];
  const autresCampagnes = [...new Set(recents.map((l) => texte(l.campagne_id)).filter((x) => x !== '' && !connues.has(x)))];
  if (autresSeries.length === 0 && autresCampagnes.length === 0) return { series, ...noms, campagnes, occupations, realises, interventions, recents, contexte };
  const s2 = autresSeries.length === 0 ? [] : await lire(sqlSeries(`s.id IN (${DANS})`), [fermeId, listeJson(autresSeries)]);
  const noms2 = await lireNoms(lire, fermeId, s2);
  const c2 = autresCampagnes.length === 0 ? [] : await lire(sqlCampagnes(`c.id IN (${DANS})`), [fermeId, listeJson(autresCampagnes)]);
  const o2 = await lireOccupations(lire, fermeId, autresSeries, c2.map((l) => texte(l.plantation_id)), aujourdhui);
  return {
    series: [...series, ...s2],
    especes: [...noms.especes, ...noms2.especes],
    varietes: [...noms.varietes, ...noms2.varietes],
    campagnes: [...campagnes, ...c2],
    occupations: [...occupations, ...o2],
    realises,
    interventions,
    recents,
    contexte,
  };
}

/** Chaînes du journal : [origines, gagnants] en JSON, pour `EN_VIGUEUR`. */
async function lireChaines(lire: Lire, fermeId: string): Promise<readonly [string, string]> {
  const [chaines] = await lire(SQL_CHAINES, [fermeId]);
  return [texte(chaines?.origines) || '[]', texte(chaines?.gagnants) || '[]'];
}

/**
 * Saisies récentes de quelques séries (`colonne` = 'serie_id') ou campagnes ('campagne_id') : la
 * même fenêtre et les mêmes colonnes que `SQL_RECENTS`, par l'index de la culture (`serie`,
 * `campagne`) au lieu de celui de la date. Paramètres : comme `SQL_RECENTS`, la liste JSON des
 * cultures avant la ferme dans chaque partie.
 */
const sqlRecentsDe = (colonne: 'serie_id' | 'campagne_id') => `${sqlRecents(`e.${colonne} IN (${DANS}) AND +e.ferme_id = ? AND +e.date >= ?`)}
  UNION ALL
  ${sqlRecents(`e.${colonne} IN (${DANS}) AND +e.ferme_id = ? AND +e.horodatage >= ? AND (+e.date < ? OR e.date IS NULL)`)}`;
const SQL_RECENTS_SERIES = sqlRecentsDe('serie_id');
const SQL_RECENTS_CAMPAGNES = sqlRecentsDe('campagne_id');

/** Lignes du journal de quelques cultures, relues après une saisie (T13c). */
export interface LignesCultures {
  /** Séries et campagnes relues : toutes leurs lignes ci-dessous remplacent les anciennes. */
  readonly series: readonly string[];
  readonly campagnes: readonly string[];
  /** Chaînes du journal, relues si une saisie remplace une autre (correction, annulation). */
  readonly vigueur: readonly [string, string];
  readonly realises: readonly Ligne[];
  readonly interventions: readonly Ligne[];
  readonly recents: readonly Ligne[];
  /** Fenêtre de l'historique à l'instant de cette lecture. */
  readonly bornes: ReturnType<typeof bornesHistorique>;
}

/**
 * Relit le journal de quelques cultures seulement, après une saisie sur elles (T13c) : leurs
 * réalisés, interventions et saisies récentes, par les mêmes requêtes que `lireJournee` bornées à
 * ces cultures. Les chaînes du journal ne sont relues que si `chaines` (une saisie en remplace
 * une autre) : un « Fait » ou une récolte ouvre une chaîne nouvelle, en vigueur, sans toucher
 * aux autres. Séries, campagnes, emplacements et noms ne changent pas par une saisie : ils ne
 * sont pas relus. Une lecture à la fois, comme `lireJournee` (`continuer`).
 */
export async function lireCultures(
  porte: PorteDonnees,
  contexte: ContexteLecture,
  cultures: { readonly series: readonly string[]; readonly campagnes: readonly string[] },
  chaines: boolean,
  maintenant: Date,
  continuer: () => boolean = () => true,
): Promise<LignesCultures> {
  const { fermeId } = contexte;
  const bornes = bornesHistorique(contexte.aujourdhui, maintenant);
  const lire: Lire = async (sql, parametres) => {
    if (!continuer()) throw new LectureAbandonnee();
    return porte.lire<Ligne>(sql, parametres);
  };
  const vigueur = chaines ? await lireChaines(lire, fermeId) : contexte.vigueur;
  const { depuis } = bornes;
  const actives = listeJson(cultures.series.filter((id) => contexte.series.has(id)));
  const campagnesEnCours = listeJson(cultures.campagnes.filter((id) => contexte.campagnes.has(id)));
  const realises: Ligne[] = [];
  const interventions: Ligne[] = [];
  const recents: Ligne[] = [];
  if (actives !== '[]') {
    realises.push(...(await lire(SQL_REALISES_SERIES, [actives, fermeId, ...vigueur, actives, fermeId, ...vigueur])));
    interventions.push(...(await lire(SQL_INTERVENTIONS, [actives, fermeId, ...vigueur])));
  }
  if (campagnesEnCours !== '[]') realises.push(...(await lire(SQL_REALISES_CAMPAGNES, [campagnesEnCours, contexte.jsonSeries, fermeId, ...vigueur])));
  for (const [sql, ids] of [
    [SQL_RECENTS_SERIES, cultures.series],
    [SQL_RECENTS_CAMPAGNES, cultures.campagnes],
  ] as const) {
    if (ids.length === 0) continue;
    const json = listeJson(ids);
    const lignes = await lire(sql, [...vigueur, json, fermeId, depuis, ...vigueur, json, fermeId, borneSql(bornes.horodatageDepuis), depuis]);
    recents.push(...lignes.filter((l) => dansLaFenetre(l, bornes)).map(ligneRecente));
  }
  return { series: cultures.series, campagnes: cultures.campagnes, vigueur, realises, interventions, recents, bornes };
}

/**
 * Journal d'une culture (paramètres : liste JSON, la ferme) : de quoi juger ses chaînes de
 * remplacement (`enVigueur`), par l'index de la culture. Un remplacement garde la culture de la
 * saisie qu'il remplace (contrat T13) : la chaîne entière est là.
 */
const sqlJournalDe = (colonne: 'serie_id' | 'campagne_id') => `SELECT id, horodatage, remplace_sorte, remplace_evenement_id FROM evenement
  WHERE ${colonne} IN (${DANS}) AND +ferme_id = ?`;

/**
 * Chaînes d'une culture, au format de `SQL_CHAINES` ([origines, gagnants] en JSON, pour
 * `EN_VIGUEUR`), jugées par `enVigueur` sur son seul journal : origines = saisies d'origine qui ne
 * sont plus en vigueur ; gagnants = corrections en vigueur. Sur les événements de la culture,
 * `EN_VIGUEUR` rend alors exactement `enVigueur`.
 */
function chainesDeCulture(lignes: readonly Ligne[]): readonly [string, string] {
  const maillons: MaillonChaine[] = lignes.map((l) => {
    const sorte = texteOuNul(l.remplace_sorte);
    return {
      id: texte(l.id),
      horodatage: texte(l.horodatage),
      remplaceSorte: sorte === 'correction' || sorte === 'annulation' ? sorte : null,
      remplaceEvenementId: texteOuNul(l.remplace_evenement_id),
    };
  });
  const vigueur = new Set(enVigueur(maillons).map((e) => e.id));
  const origines = maillons.filter((e) => e.remplaceSorte === null && !vigueur.has(e.id)).map((e) => e.id);
  const gagnants = maillons.filter((e) => e.remplaceSorte === 'correction' && vigueur.has(e.id)).map((e) => e.id);
  return [JSON.stringify(origines), JSON.stringify(gagnants)];
}

/**
 * T13d, lecture ciblée : la tâche `cle` telle que la journée relue la calculerait, en ne lisant
 * que sa culture (série ou campagne, ses noms, ses emplacements actifs, son journal). Sert au
 * « Fait » touché sur l'instantané, avant que la journée relue n'arrive : rien n'est écrit depuis
 * l'instantané. Rend null quand la journée relue n'aurait plus cette tâche (faite ailleurs,
 * culture retirée, semaine passée). Même calcul que la journée (`calculerJournee`), sur une
 * journée réduite à cette culture : le semainier d'une culture ne dépend pas des autres.
 */
export async function lireTacheCiblee(porte: PorteDonnees, fermeId: string, aujourdhui: string, cle: string): Promise<TacheJour | null> {
  const cibleId = cle.split(':')[0] ?? '';
  if (cibleId === '') return null;
  const lire: Lire = (sql, parametres) => porte.lire<Ligne>(sql, parametres);
  const ids = listeJson([cibleId]);
  const series = (await lire(sqlSeries(`s.id IN (${DANS}) AND ${FILTRE_SERIES_ACTIVES}`), [fermeId, ids])).filter(
    (s) => parametresDe(texte(s.id), s.parametres).mode !== null,
  );
  const campagnes =
    series.length > 0 ? [] : await lire(sqlCampagnes(`c.id IN (${DANS}) AND (c.fin_recolte_prevue IS NULL OR c.fin_recolte_prevue >= ?)`), [fermeId, ids, aujourdhui]);
  if (series.length === 0 && campagnes.length === 0) return null;
  const idsSeries = series.map((s) => texte(s.id));
  const idsCampagnes = campagnes.map((c) => texte(c.id));
  const noms = await lireNoms(lire, fermeId, series);
  const occupations = await lireOccupations(lire, fermeId, idsSeries, campagnes.map((c) => texte(c.plantation_id)), aujourdhui);
  const vigueur = chainesDeCulture(await lire(sqlJournalDe(series.length > 0 ? 'serie_id' : 'campagne_id'), [ids, fermeId]));
  const jsonSeries = listeJson(idsSeries);
  const realises =
    series.length > 0
      ? await lire(SQL_REALISES_SERIES, [jsonSeries, fermeId, ...vigueur, jsonSeries, fermeId, ...vigueur])
      : await lire(SQL_REALISES_CAMPAGNES, [listeJson(idsCampagnes), jsonSeries, fermeId, ...vigueur]);
  const interventions = series.length > 0 ? await lire(SQL_INTERVENTIONS, [jsonSeries, fermeId, ...vigueur]) : [];
  const contexte: ContexteLecture = { fermeId, aujourdhui, vigueur, jsonSeries, series: new Set(idsSeries), campagnes: new Set(idsCampagnes) };
  const journee = calculerJournee({ series, ...noms, campagnes, occupations, realises, interventions, recents: [], contexte }, aujourdhui);
  return journee.taches.find((t) => t.cle === cle) ?? null;
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

function modeDe(mode: Valeur): ModeItineraire | null {
  return typeof mode === 'string' && (MODES as readonly string[]).includes(mode) ? (mode as ModeItineraire) : null;
}

const AUCUN_TRAVAIL: readonly TravailPrevu[] = [];

interface ParametresLus {
  readonly mode: ModeItineraire | null;
  /** Travaux prévus de l'instantané, validés par le cœur pour ce mode ; aucun sans mode. */
  readonly travaux: readonly TravailPrevu[];
}

const SANS_PARAMETRES: ParametresLus = { mode: null, travaux: AUCUN_TRAVAIL };

/**
 * Instantanés déjà lus, par texte JSON, et le dernier lu de chaque série : relire la journée
 * (après une saisie, une synchro) ne relit ni ne revalide l'instantané d'une série qui n'a pas
 * changé. Par série d'abord : comparer deux textes égaux coûte moins que hacher un long texte.
 */
const parametresLus = new Map<string, ParametresLus>();
const parametresParSerie = new Map<string, { readonly texte: string; readonly lus: ParametresLus }>();

/**
 * Mode et travaux prévus de l'instantané d'une série (`serie.parametres`, texte JSON). Un
 * instantané illisible ne fait pas tomber l'écran : la série n'a alors pas de mode (le semainier
 * ne la planifie pas), ou des travaux illisibles, aucun travail affiché.
 */
function parametresDe(serieId: string, v: Valeur): ParametresLus {
  if (typeof v !== 'string') return SANS_PARAMETRES;
  const dernier = parametresParSerie.get(serieId);
  if (dernier?.texte === v) return dernier.lus;
  let lus = parametresLus.get(v);
  if (lus === undefined) {
    lus = SANS_PARAMETRES;
    const p = jsonOuNul(v);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      const { mode: m, travauxPrevus } = p as { readonly mode?: unknown; readonly travauxPrevus?: unknown };
      const mode = modeDe(typeof m === 'string' ? m : null);
      if (mode !== null) {
        const r = travauxPrevus === undefined || travauxPrevus === null ? null : validerTravauxPrevus(travauxPrevus, { mode });
        lus = { mode, travaux: r?.ok === true ? r.valeur : AUCUN_TRAVAIL };
      }
    }
    if (parametresLus.size >= 2_000) parametresLus.clear();
    parametresLus.set(v, lus);
  }
  if (parametresParSerie.size >= 20_000) parametresParSerie.clear();
  parametresParSerie.set(serieId, { texte: v, lus });
  return lus;
}

interface CampagneLue {
  readonly semainier: CampagneSemainier;
  readonly arrachee: boolean;
}

/**
 * Ce que la journée tire des lignes qu'une saisie ne change pas (séries, campagnes, emplacements,
 * noms) : gardé tel quel d'une relecture incrémentale à l'autre (T13c).
 */
interface Socle {
  readonly aujourdhui: string;
  readonly jour: DateCalendaire;
  readonly semaine: ReturnType<typeof semaineIso>;
  readonly cultures: ReadonlyMap<string, Culture>;
  readonly series: ReadonlyMap<string, SerieLue>;
  readonly campagnes: ReadonlyMap<string, CampagneLue>;
  /** Séries que le semainier planifie, dans l'ordre de lecture. */
  readonly actives: readonly SerieSemainier[];
  /** Campagnes, dans l'ordre de lecture. */
  readonly listeCampagnes: readonly CampagneLue[];
  /**
   * Rang de chaque culture dans l'ordre de lecture (séries actives, puis campagnes) : départage
   * final des récoltes en cours, comme le tri stable de la liste lue dans cet ordre.
   */
  readonly rangs: ReadonlyMap<string, number>;
}

/** Réalisés (premières dates) et interventions en vigueur, au format du semainier. */
interface RealisesLus {
  readonly series: Map<Id<'Serie'>, Partial<Record<EtapeSerie, DateCalendaire>>>;
  readonly campagnes: Map<Id<'Campagne'>, DateCalendaire>;
  readonly interventions: Map<Id<'Serie'>, InterventionRealisee[]>;
}

/**
 * Journée calculée et ce qu'il faut pour la recalculer culture par culture après une saisie
 * (`recalculerCultures`, T13c), sans relire ni recalculer le reste de la ferme.
 */
export interface EtatJournee {
  readonly journee: Journee;
  readonly contexte: ContexteLecture;
  readonly socle: Socle;
  readonly realises: RealisesLus;
  /** Lignes de `SQL_RECENTS` (toutes cultures), pour vérifier la fenêtre de l'historique. */
  readonly recents: readonly Ligne[];
}

function socleDe(lignes: LignesJournee, aujourdhui: string): Socle {
  const J = aujourdhui as DateCalendaire;
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

  const especes = new Map(lignes.especes.map((e) => [texte(e.id), e]));
  const varietes = new Map(lignes.varietes.map((v) => [texte(v.id), v]));
  const cultures = new Map<string, Culture>();
  const series = new Map<string, SerieLue>();
  for (const s of lignes.series) {
    const id = texte(s.id);
    const espece = especes.get(texte(s.espece_id));
    const nomEspece = texte(espece?.nom) || 'Culture';
    const variete = texteOuNul(varietes.get(texte(s.variete_id))?.nom);
    const emplacements = trierEmplacements(parSerie.get(id) ?? []);
    cultures.set(id, {
      cible: { sorte: 'serie', serieId: id as Id<'Serie'> },
      cibleId: id,
      especeId: texte(s.espece_id),
      varieteId: texteOuNul(s.variete_id),
      espece: nomEspece,
      variete,
      unite: unite(espece?.unite_recolte),
      famille: bandeFamille(texteOuNul(espece?.famille)),
      emplacements,
    });
    const statut = texte(s.statut) as StatutSerie;
    const active = statut === 'prevue' || statut === 'en_cours';
    const { mode, travaux: travauxPrevus } = parametresDe(id, s.parametres);
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
        culture: nomEspece,
        variete,
        datesPrevues,
        taille,
        emplacements,
        ...(travauxPrevus.length > 0 ? { travauxPrevus } : {}),
      };
    }
    series.set(id, { semainier: pourSemainier, active, finPrevue: finRecolte });
  }

  const listeCampagnes: CampagneLue[] = [];
  const campagnes = new Map<string, CampagneLue>();
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
      famille: bandeFamille(texteOuNul(c.famille)),
      emplacements,
    };
    cultures.set(id, culture);
    const arrachage = texteOuNul(c.date_arrachage);
    const lue: CampagneLue = {
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
    };
    listeCampagnes.push(lue);
    campagnes.set(id, lue);
  }

  const actives = [...series.values()].map((s) => s.semainier).filter((s): s is SerieSemainier => s !== null);
  const rangs = new Map<string, number>();
  for (const [i, s] of actives.entries()) if (!rangs.has(s.id)) rangs.set(s.id, i);
  for (const [i, c] of listeCampagnes.entries()) if (!rangs.has(c.semainier.id)) rangs.set(c.semainier.id, actives.length + i);
  return { aujourdhui, jour: J, semaine: semaineIso(J), cultures, series, campagnes, actives, listeCampagnes, rangs };
}

/** Ajoute des lignes de réalisés (`SQL_REALISES_*`) aux réalisés lus. */
function ajouterRealises(realises: RealisesLus, lignes: readonly Ligne[]): void {
  for (const l of lignes) {
    const date = texte(l.date);
    const serieId = texteOuNul(l.serie_id);
    const campagneId = texteOuNul(l.campagne_id);
    if (serieId !== null) {
      const etapeRealisee = texte(l.etape);
      let etape: EtapeSerie | null = null;
      if (l.type === 'recolte') etape = 'debutRecolte';
      else if ((ETAPES as readonly string[]).includes(etapeRealisee)) etape = etapeSerie(etapeRealisee as EtapeRealisee);
      if (etape === null) continue;
      const r = realises.series.get(serieId as Id<'Serie'>) ?? {};
      r[etape] = plusTot(r[etape], date);
      realises.series.set(serieId as Id<'Serie'>, r);
    } else if (campagneId !== null && l.type === 'recolte') {
      realises.campagnes.set(campagneId as Id<'Campagne'>, plusTot(realises.campagnes.get(campagneId as Id<'Campagne'>), date));
    }
  }
}

/** T22 : ajoute des interventions en vigueur (`SQL_INTERVENTIONS`), par série (elles soldent les travaux prévus). */
function ajouterInterventions(realises: RealisesLus, lignes: readonly Ligne[]): void {
  for (const l of lignes) {
    const serieId = texteOuNul(l.serie_id);
    const c = categorie(l.categorie);
    const date = texte(l.date);
    if (serieId === null || c === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // T22b : l'occurrence visée par « Fait » (null si absente, ou si ce n'est pas une date qui
    // existe, comme '2026-02-31' : saisie libre, soldée par sa date réelle).
    const visee = texteOuNul(l.occurrence_visee);
    const occurrenceVisee = visee !== null && estDateValide(visee) ? visee : null;
    ajouterA(realises.interventions, serieId as Id<'Serie'>, { date: date as DateCalendaire, categorie: c, type: texte(l.type_intervention), occurrenceVisee });
  }
}

/** Tâches du semainier (T06) de ces séries et campagnes, dans l'ordre du moteur. */
function tachesDe(socle: Socle, realises: RealisesLus, series: readonly SerieSemainier[], campagnes: readonly CampagneLue[]): TacheJour[] {
  const brutes = semainier(
    socle.semaine,
    series,
    campagnes.filter((c) => !c.arrachee).map((c) => c.semainier),
    realises,
    socle.jour,
  );
  const taches: TacheJour[] = [];
  for (const t of brutes) {
    const cibleId = t.cible.sorte === 'serie' ? t.cible.serieId : t.cible.campagneId;
    const culture = socle.cultures.get(cibleId);
    if (culture === undefined) continue;
    const cle = t.etape === 'travail' ? `${cibleId}:travail:${String(t.travail.indice)}:${t.datePrevue}` : `${cibleId}:${t.etape}`;
    taches.push({ cle, tache: t, culture });
  }
  return taches;
}

/** Tâches du semainier de ces cultures seules (séries actives, campagnes). */
function tachesDesCultures(socle: Socle, realises: RealisesLus, cibles: Iterable<string>): TacheJour[] {
  const series: SerieSemainier[] = [];
  const campagnes: CampagneLue[] = [];
  for (const id of cibles) {
    const s = socle.series.get(id)?.semainier;
    if (s !== undefined && s !== null) series.push(s);
    const c = socle.campagnes.get(id);
    if (c !== undefined) campagnes.push(c);
  }
  return tachesDe(socle, realises, series, campagnes);
}

/**
 * La tâche `x` vient-elle avant la tâche `y` (de deux cultures différentes) dans l'ordre du
 * semainier ? Le moteur en est seul juge : son ordre ne dépend jamais de l'ordre d'entrée, on lui
 * demande donc les tâches de ces deux cultures seules. Aucune règle de tri réécrite ici.
 */
function vientAvant(socle: Socle, realises: RealisesLus, x: TacheJour, y: TacheJour): boolean {
  const cles = tachesDesCultures(socle, realises, [x.culture.cibleId, y.culture.cibleId]).map((t) => t.cle);
  return cles.indexOf(x.cle) < cles.indexOf(y.cle);
}

/** Insère `x` à sa place dans `liste`, triée par `avant` (recherche dichotomique). */
function inserer<T>(liste: T[], x: T, avant: (a: T, b: T) => boolean): void {
  let bas = 0;
  let haut = liste.length;
  while (bas < haut) {
    const milieu = (bas + haut) >>> 1;
    const m = liste[milieu] as T;
    if (avant(x, m)) haut = milieu;
    else bas = milieu + 1;
  }
  liste.splice(bas, 0, x);
}

/** Culture en récolte aujourd'hui (la fenêtre de récolte contient aujourd'hui), ou null. */
function enRecolte(socle: Socle, realises: RealisesLus, id: string): Culture | null {
  const J = socle.jour;
  const culture = socle.cultures.get(id);
  if (culture === undefined) return null;
  const s = socle.series.get(id)?.semainier;
  if (s !== undefined && s !== null) {
    const r = realises.series.get(s.id);
    if (r?.finRecolte !== undefined) return null;
    const debut = r === undefined ? s.datesPrevues.debutRecolte : appliquerRealises(s.datesPrevues, r).debutRecolte;
    return debut <= J && J <= s.datesPrevues.finRecolte ? culture : null;
  }
  const c = socle.campagnes.get(id);
  if (c === undefined) return null;
  const { debutRecoltePrevu: debut, finRecoltePrevue: fin } = c.semainier;
  return !c.arrachee && debut !== null && debut <= J && (fin === null || J <= fin) ? culture : null;
}

/** Ordre des récoltes en cours : espèce, premier emplacement, puis ordre de lecture. */
function comparerRecoltes(socle: Socle, a: Culture, b: Culture): number {
  return (
    COLLATEUR.compare(a.espece, b.espece) ||
    COLLATEUR.compare(a.emplacements[0]?.code ?? '', b.emplacements[0]?.code ?? '') ||
    (socle.rangs.get(a.cibleId) ?? 0) - (socle.rangs.get(b.cibleId) ?? 0)
  );
}

/**
 * Ordre de l'historique : la saisie la plus récente d'abord (instant de l'horodatage, puis id ;
 * T13n : jamais le texte de l'horodatage, dont le format varie).
 */
function avantDansHistorique(a: EvenementLu, b: EvenementLu): boolean {
  return comparerSaisies(a, b) > 0;
}

/** Saisies en vigueur parmi ces lignes récentes (règle jugée par la base sur toute la chaîne). */
function vigueurDe(recents: readonly Ligne[]): EvenementLu[] {
  const vigueur: EvenementLu[] = [];
  for (const l of recents) {
    const e = l.en_vigueur === 1 ? evenementLu(l) : null;
    if (e !== null) vigueur.push(e);
  }
  return vigueur;
}

/**
 * Dernière récolte en vigueur de chaque culture : la plus récente par date ; à date égale, la
 * dernière saisie (horodatage, puis id). Ne dépend pas de l'ordre des lignes (T13c).
 */
function ajouterDernieresRecoltes(dernieres: Map<string, DerniereRecolte>, vigueur: readonly EvenementLu[]): void {
  const retenues = new Map<string, EvenementLu>();
  for (const e of vigueur) {
    const cible = e.serieId ?? e.campagneId;
    if (e.detail.type !== 'recolte' || cible === null) continue;
    const avant = retenues.get(cible);
    if (avant === undefined || e.date > avant.date || (e.date === avant.date && !avantDansHistorique(avant, e))) retenues.set(cible, e);
  }
  for (const [cible, e] of retenues) {
    if (e.detail.type === 'recolte') dernieres.set(cible, { date: e.date, quantite: e.detail.quantite, unite: e.detail.unite });
  }
}

/** Calcule la journée depuis les lignes lues, et l'état qui permet de la recalculer ensuite. Pure. */
export function calculerEtat(lignes: LignesJournee, aujourdhui: string): EtatJournee {
  const socle = socleDe(lignes, aujourdhui);

  // Réalisés des séries et des campagnes (agrégés dans la base), interventions en vigueur.
  const realises: RealisesLus = { series: new Map(), campagnes: new Map(), interventions: new Map() };
  ajouterRealises(realises, lignes.realises);
  ajouterInterventions(realises, lignes.interventions);

  // Saisies récentes en vigueur (règle jugée par la base sur toute la chaîne, comme le
  // semainier) : historique et dernières récoltes.
  const vigueur = vigueurDe(lignes.recents);
  const dernieresRecoltes = new Map<string, DerniereRecolte>();
  ajouterDernieresRecoltes(dernieresRecoltes, vigueur);

  // Semainier de la semaine (T06), dans l'ordre du moteur.
  const taches = tachesDe(socle, realises, socle.actives, socle.listeCampagnes);

  // Récoltes en cours : la fenêtre de récolte contient aujourd'hui.
  const recoltesEnCours: Culture[] = [];
  for (const s of socle.actives) {
    const c = enRecolte(socle, realises, s.id);
    if (c !== null) recoltesEnCours.push(c);
  }
  for (const c of socle.listeCampagnes) {
    const culture = enRecolte(socle, realises, c.semainier.id);
    if (culture !== null) recoltesEnCours.push(culture);
  }
  recoltesEnCours.sort((a, b) => comparerRecoltes(socle, a, b));

  const historique: EntreeHistorique[] = vigueur
    .sort((a, b) => comparerSaisies(b, a))
    .map((evenement) => ({ evenement, culture: socle.cultures.get(evenement.serieId ?? evenement.campagneId ?? '') ?? null }));

  return {
    journee: { aujourdhui, semaine: socle.semaine.semaine, taches, recoltesEnCours, historique, cultures: socle.cultures, dernieresRecoltes },
    contexte: lignes.contexte,
    socle,
    realises,
    recents: lignes.recents,
  };
}

/** Calcule la journée depuis les lignes lues. Pure. */
export function calculerJournee(lignes: LignesJournee, aujourdhui: string): Journee {
  return calculerEtat(lignes, aujourdhui).journee;
}

/**
 * La ligne récente est-elle dans la fenêtre de l'historique ? Règle de `SQL_RECENTS`, l'horodatage
 * comparé à la borne comme un instant (T13q : `instantHorodatage`, jamais le texte ; illisible =
 * instant 0, hors de la fenêtre).
 */
function dansLaFenetre(l: Ligne, bornes: ReturnType<typeof bornesHistorique>): boolean {
  const date = typeof l.date === 'string' ? l.date : null;
  if (date !== null && date >= bornes.depuis) return true;
  return instantHorodatage(l.horodatage) >= instantHorodatage(bornes.horodatageDepuis) && (date === null || date < bornes.depuis);
}

/**
 * Recalcule la journée après une saisie sur quelques cultures (T13c) : seules leurs lignes du
 * journal ont été relues (`lireCultures`) ; le reste de la journée est repris de `etat`, les
 * tâches et saisies de ces cultures remises à leur place (ordre du moteur, de l'historique). Même
 * résultat qu'un `calculerEtat` sur une relecture complète.
 *
 * Rend null quand ce n'est pas sûr (culture inconnue de la journée, saisie sortie de la fenêtre
 * de l'historique depuis la dernière lecture complète) : il faut alors tout relire.
 */
export function recalculerCultures(etat: EtatJournee, lues: LignesCultures): EtatJournee | null {
  const { socle } = etat;
  const cibles = new Set([...lues.series, ...lues.campagnes]);
  for (const id of cibles) if (!socle.cultures.has(id)) return null;
  const series = new Set(lues.series);
  const campagnes = new Set(lues.campagnes);
  const deLaCulture = (l: Ligne) => series.has(texte(l.serie_id)) || campagnes.has(texte(l.campagne_id));

  // Les autres saisies récentes doivent rester dans la fenêtre (elle glisse avec l'heure).
  const recents: Ligne[] = [];
  for (const l of etat.recents) {
    if (deLaCulture(l)) continue;
    if (!dansLaFenetre(l, lues.bornes)) return null;
    recents.push(l);
  }
  recents.push(...lues.recents);

  const realises: RealisesLus = {
    series: new Map(etat.realises.series),
    campagnes: new Map(etat.realises.campagnes),
    interventions: new Map(etat.realises.interventions),
  };
  for (const id of series) {
    realises.series.delete(id as Id<'Serie'>);
    realises.interventions.delete(id as Id<'Serie'>);
  }
  for (const id of campagnes) realises.campagnes.delete(id as Id<'Campagne'>);
  ajouterRealises(realises, lues.realises);
  ajouterInterventions(realises, lues.interventions);

  const j = etat.journee;
  const taches = j.taches.filter((t) => !cibles.has(t.culture.cibleId));
  for (const t of tachesDesCultures(socle, realises, cibles)) inserer(taches, t, (a, b) => vientAvant(socle, realises, a, b));

  const recoltesEnCours = j.recoltesEnCours.filter((c) => !cibles.has(c.cibleId));
  for (const id of cibles) {
    const c = enRecolte(socle, realises, id);
    if (c !== null) inserer(recoltesEnCours, c, (a, b) => comparerRecoltes(socle, a, b) < 0);
  }

  const vigueur = vigueurDe(lues.recents);
  const historique = j.historique.filter((h) => !cibles.has(h.evenement.serieId ?? h.evenement.campagneId ?? ''));
  for (const evenement of vigueur) {
    inserer(historique, { evenement, culture: socle.cultures.get(evenement.serieId ?? evenement.campagneId ?? '') ?? null }, (a, b) => avantDansHistorique(a.evenement, b.evenement));
  }
  const dernieresRecoltes = new Map(j.dernieresRecoltes);
  for (const id of cibles) dernieresRecoltes.delete(id);
  ajouterDernieresRecoltes(dernieresRecoltes, vigueur);

  return {
    journee: { aujourdhui: j.aujourdhui, semaine: j.semaine, taches, recoltesEnCours, historique, cultures: socle.cultures, dernieresRecoltes },
    contexte: { ...etat.contexte, vigueur: lues.vigueur },
    socle,
    realises,
    recents,
  };
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

/** Durée en minutes : « 6 min », « 1 h », « 1 h 05 ». */
export function texteDuree(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m).padStart(2, '0')}`;
}

/** Pastille de charge de la semaine : « 1 h 24 de travail ». */
export function texteCharge(minutes: number): string {
  return `${texteDuree(minutes)} de travail`;
}

/** Catégorie d'intervention, en surtitre d'une tâche de travail (T22). */
export const LIBELLES_CATEGORIES: Readonly<Record<CategorieIntervention, string>> = {
  travail_sol: 'Travail du sol',
  couverture: 'Couverture',
  fertilisation: 'Fertilisation',
  amendement: 'Amendement',
  entretien: 'Entretien',
};

/** « grelinette » → « Grelinette » (le libellé de la ferme, première lettre en capitale). */
export function capitale(t: string): string {
  return t === '' ? t : `${t.charAt(0).toLocaleUpperCase('fr')}${t.slice(1)}`;
}

/** Verbe de l'étape, pour la carte : « Planter », « Semer »… */
export const VERBES: Readonly<Record<Exclude<TacheSemainier['etape'], 'travail'>, string>> = {
  semis_pepiniere: 'Semer en pépinière',
  semis_direct: 'Semer',
  plantation: 'Planter',
  arrachage: 'Arracher',
  debut_recolte: 'Récolter',
};

/**
 * Ordre des tâches de l'écran : celles en retard d'abord, puis les autres, l'ordre relatif de
 * chaque groupe conservé (ordre du moteur). Sans plafond : l'écran borne chaque groupe après coup
 * (T13d), la vue 3D (T37) les montre toutes. L'entrée n'est jamais modifiée.
 */
export function tachesDeLEcran(taches: readonly TacheJour[]): TacheJour[] {
  return [...taches.filter((t) => t.tache.enRetard), ...taches.filter((t) => !t.tache.enRetard)];
}

/** La tâche en une phrase, en minuscules : « planter chou pointu », « grelinette batavia ». */
export function phraseDeTache(t: TacheJour): string {
  const { tache, culture } = t;
  const quoi = tache.etape === 'travail' ? tache.travail.type : VERBES[tache.etape].toLowerCase();
  return `${quoi} ${culture.espece.toLowerCase()}`;
}

/** Nom de l'étape réalisée, pour l'historique. */
export const ETAPES_FAITES: Readonly<Record<EtapeRealisee, string>> = {
  semis_pepiniere: 'Semis en pépinière',
  semis_direct: 'Semis',
  plantation: 'Plantation',
  arrachage: 'Arrachage',
};
