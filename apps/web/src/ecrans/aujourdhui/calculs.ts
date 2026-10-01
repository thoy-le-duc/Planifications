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
  type RealisesSerie,
  type SerieSemainier,
  type StatutSerie,
  type TacheSemainier,
  type TailleSerie,
  type TravailPrevu,
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

function evenementLu(l: Ligne): EvenementLu | null {
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
 */
export function enVigueur(evenements: readonly EvenementLu[]): EvenementLu[] {
  const parId = new Map(evenements.map((e) => [e.id, e]));
  const origines = new Map<string, string>();
  const origineDe = (e: EvenementLu): string => {
    const connue = origines.get(e.id);
    if (connue !== undefined) return connue;
    // Montée jusqu'au plus haut connu ; `vus` protège d'un cycle (données corrompues).
    const chemin: string[] = [];
    const vus = new Set<string>();
    let courant = e;
    for (;;) {
      if (origines.has(courant.id)) break;
      chemin.push(courant.id);
      vus.add(courant.id);
      const parent = courant.remplaceEvenementId === null ? undefined : parId.get(courant.remplaceEvenementId);
      if (parent === undefined || vus.has(parent.id)) break;
      courant = parent;
    }
    let origine = origines.get(courant.id);
    if (origine === undefined) {
      const parent = courant.remplaceEvenementId;
      origine = parent !== null && !parId.has(parent) ? parent : courant.id;
    }
    for (const id of chemin) origines.set(id, origine);
    return origine;
  };
  const plusRecent = (a: EvenementLu, b: EvenementLu) => a.horodatage > b.horodatage || (a.horodatage === b.horodatage && a.id > b.id);
  const annulees = new Set<string>();
  /** Par chaîne : la correction la plus récente, sinon l'origine (la première sans remplacement vue). */
  const retenue = new Map<string, EvenementLu>();
  for (const e of evenements) {
    const o = origineDe(e);
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
    return !annulees.has(o) && retenue.get(o) === e;
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

/** Espèces des séries lues, avec le nom de leur famille. */
const SQL_ESPECES = `SELECT e.id, e.nom, e.unite_recolte, f.nom AS famille FROM espece e LEFT JOIN famille f ON f.id = e.famille_id WHERE e.id IN (${DANS})`;
const SQL_VARIETES = `SELECT id, nom FROM variete WHERE id IN (${DANS})`;

/** Campagnes jointes à leur plantation ; `filtre` sur l'alias `c`. */
const sqlCampagnes = (filtre: string) => `SELECT c.id, c.debut_recolte_prevu, c.fin_recolte_prevue, p.id AS plantation_id, p.nombre_plants,
    p.date_arrachage, p.espece_id, p.variete_id, e.nom AS espece, e.unite_recolte, f.nom AS famille, v.nom AS variete
  FROM campagne c
  JOIN plantation p ON p.id = c.plantation_id
  LEFT JOIN espece e ON e.id = p.espece_id
  LEFT JOIN famille f ON f.id = e.famille_id
  LEFT JOIN variete v ON v.id = p.variete_id
  WHERE c.ferme_id = ? AND c.supprime_le IS NULL AND p.supprime_le IS NULL AND ${filtre}`;

/** Occupations non supprimées des séries et des plantations données (deux listes JSON). */
const SQL_OCCUPATIONS = `SELECT o.serie_id, o.plantation_id, o.emplacement_id FROM occupation o
  WHERE o.ferme_id = ? AND o.supprime_le IS NULL AND (o.serie_id IN (${DANS}) OR o.plantation_id IN (${DANS}))`;

/**
 * Emplacements occupés, avec leur zone. Seuls les emplacements actifs le jour donné (deux
 * derniers paramètres) : jamais un emplacement supprimé ou retiré recopié dans une saisie (le
 * serveur le refuserait).
 */
const SQL_EMPLACEMENTS = `SELECT em.id, em.code, z.nom AS zone FROM emplacement em LEFT JOIN zone z ON z.id = em.zone_id
  WHERE em.id IN (${DANS}) AND em.supprime_le IS NULL AND em.actif_du <= ? AND (em.actif_au IS NULL OR em.actif_au > ?)`;

/**
 * Chaînes du journal local (paramètre : la ferme). Une ligne reçue du serveur porte l'origine de
 * sa chaîne (`origine_id`, tenue par la base, T10h) : elle est lue telle quelle. Seules les
 * saisies locales pas encore synchronisées (sans `origine_id`) montent, par l'identifiant,
 * jusqu'au premier parent qui la porte ou jusqu'à l'origine (décision 3 du chef : une chaîne de
 * 1 000 corrections ne se remonte pas). Un parent absent de la base locale sert de clé de chaîne,
 * comme dans `enVigueur`. Profondeur bornée (données corrompues : jamais de boucle sans fin).
 *   - `remplacement` : chaque correction ou annulation, avec l'origine de sa chaîne (le dernier
 *     maillon de sa montée : fini, ou dont le parent est une origine ou absent) ;
 *   - `chaine` : par origine, la clé (horodatage|id) de sa correction la plus récente et son
 *     `id` (colonne nue de SQLite : celle de la ligne du MAX), le nombre de ses annulations et
 *     de ses corrections.
 *
 * T13b : les remplacements se lisent par l'index `remplacement` (`>= ''` : toute valeur non
 * nulle, comme `IS NOT NULL`, que SQLite ne cherche pas dans un index d'expression), qui porte
 * aussi la ferme, l'origine, la sorte et l'horodatage : aucune ligne du journal n'est ouverte,
 * sauf les parents des saisies locales. La ferme est écartée de l'index ferme_date (`+`) :
 * sinon SQLite parcourrait tout le journal de la ferme.
 */
const CHAINES = `WITH RECURSIVE montee(id, sorte, horodatage, origine, fini, profondeur) AS (
    SELECT id, remplace_sorte, horodatage, coalesce(origine_id, remplace_evenement_id), origine_id IS NOT NULL, 0 FROM evenement
    WHERE remplace_evenement_id >= '' AND +ferme_id = ?
    UNION ALL
    SELECT m.id, m.sorte, m.horodatage, coalesce(p.origine_id, p.remplace_evenement_id), p.origine_id IS NOT NULL, m.profondeur + 1
    FROM montee m JOIN evenement p ON p.id = m.origine
    WHERE NOT m.fini AND (p.origine_id IS NOT NULL OR p.remplace_evenement_id IS NOT NULL) AND m.profondeur < 1000
  ),
  remplacement AS (
    SELECT m.id, m.sorte, m.horodatage, m.origine FROM montee m
    WHERE m.fini OR NOT EXISTS (SELECT 1 FROM evenement p WHERE p.id = m.origine AND (p.origine_id IS NOT NULL OR p.remplace_evenement_id IS NOT NULL))
  ),
  chaine AS (
    SELECT origine, MAX(CASE WHEN sorte = 'correction' THEN horodatage || '|' || id END) AS cle, id,
      SUM(sorte = 'annulation') AS annulations, SUM(sorte = 'correction') AS corrections
    FROM remplacement GROUP BY origine
  )
`;

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
}

/** Bornes de l'historique : date du journal, et instant de saisie (7 jours avant maintenant). */
export function bornesHistorique(aujourdhui: string, maintenant: Date): { readonly depuis: string; readonly horodatageDepuis: string } {
  return {
    depuis: ajouterJours(aujourdhui as DateCalendaire, -JOURS_HISTORIQUE),
    horodatageDepuis: new Date(maintenant.getTime() - JOURS_HISTORIQUE * 86_400_000).toISOString(),
  };
}

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
async function lireNoms(lire: Lire, series: readonly Ligne[]): Promise<Noms> {
  if (series.length === 0) return { especes: [], varietes: [] };
  const especes = await lire(SQL_ESPECES, [listeJson(series.map((s) => texte(s.espece_id)))]);
  const idsVarietes = series.map((s) => texte(s.variete_id)).filter((x) => x !== '');
  const varietes = idsVarietes.length === 0 ? [] : await lire(SQL_VARIETES, [listeJson(idsVarietes)]);
  return { especes, varietes };
}

/** Emplacements actifs occupés par ces séries et plantations : lignes (serie_id, plantation_id, emplacement_id, code, zone). */
async function lireOccupations(lire: Lire, fermeId: string, series: readonly string[], plantations: readonly string[], aujourdhui: string): Promise<Ligne[]> {
  if (series.length === 0 && plantations.length === 0) return [];
  const occupations = await lire(SQL_OCCUPATIONS, [fermeId, listeJson(series), listeJson(plantations)]);
  if (occupations.length === 0) return [];
  const emplacements = await lire(SQL_EMPLACEMENTS, [listeJson(occupations.map((o) => texte(o.emplacement_id))), aujourdhui, aujourdhui]);
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
  const { depuis, horodatageDepuis } = bornesHistorique(aujourdhui, maintenant);
  const lire: Lire = async (sql, parametres) => {
    if (!continuer()) throw new LectureAbandonnee();
    return porte.lire<Ligne>(sql, parametres);
  };
  const series = (await lire(sqlSeries(FILTRE_SERIES_ACTIVES), [fermeId])).filter((s) => parametresDe(texte(s.id), s.parametres).mode !== null);
  const noms = await lireNoms(lire, series);
  const campagnes = await lire(sqlCampagnes('(c.fin_recolte_prevue IS NULL OR c.fin_recolte_prevue >= ?)'), [fermeId, aujourdhui]);
  const idsSeries = series.map((s) => texte(s.id));
  const idsCampagnes = campagnes.map((c) => texte(c.id));
  const occupations = await lireOccupations(lire, fermeId, idsSeries, campagnes.map((c) => texte(c.plantation_id)), aujourdhui);

  const [chaines] = await lire(SQL_CHAINES, [fermeId]);
  const vigueur = [texte(chaines?.origines) || '[]', texte(chaines?.gagnants) || '[]'];
  const jsonSeries = listeJson(idsSeries);
  const realises = [
    ...(await lire(SQL_REALISES_SERIES, [jsonSeries, fermeId, ...vigueur, jsonSeries, fermeId, ...vigueur])),
    ...(idsCampagnes.length === 0 ? [] : await lire(SQL_REALISES_CAMPAGNES, [listeJson(idsCampagnes), jsonSeries, fermeId, ...vigueur])),
  ];
  const interventions = await lire(SQL_INTERVENTIONS, [jsonSeries, fermeId, ...vigueur]);
  const recents = (await lire(SQL_RECENTS, [...vigueur, fermeId, depuis, ...vigueur, fermeId, horodatageDepuis, depuis])).map(ligneRecente);
  // Historique : les cultures terminées ou passées qu'il nomme, lues en plus (rarement).
  const connues = new Set([...idsSeries, ...idsCampagnes]);
  const autresSeries = [...new Set(recents.map((l) => texte(l.serie_id)).filter((x) => x !== '' && !connues.has(x)))];
  const autresCampagnes = [...new Set(recents.map((l) => texte(l.campagne_id)).filter((x) => x !== '' && !connues.has(x)))];
  if (autresSeries.length === 0 && autresCampagnes.length === 0) return { series, ...noms, campagnes, occupations, realises, interventions, recents };
  const s2 = autresSeries.length === 0 ? [] : await lire(sqlSeries(`s.id IN (${DANS})`), [fermeId, listeJson(autresSeries)]);
  const noms2 = await lireNoms(lire, s2);
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
  };
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

/** Calcule la journée depuis les lignes lues. Pure. */
export function calculerJournee(lignes: LignesJournee, aujourdhui: string): Journee {
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
      famille: cleFamille(texteOuNul(espece?.famille)),
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

  // Réalisés des séries et des campagnes (agrégés dans la base).
  const realisesSeries = new Map<Id<'Serie'>, Partial<Record<EtapeSerie, DateCalendaire>>>();
  const realisesCampagnes = new Map<Id<'Campagne'>, DateCalendaire>();
  for (const l of lignes.realises) {
    const date = texte(l.date);
    const serieId = texteOuNul(l.serie_id);
    const campagneId = texteOuNul(l.campagne_id);
    if (serieId !== null) {
      const etapeRealisee = texte(l.etape);
      let etape: EtapeSerie | null = null;
      if (l.type === 'recolte') etape = 'debutRecolte';
      else if ((ETAPES as readonly string[]).includes(etapeRealisee)) etape = etapeSerie(etapeRealisee as EtapeRealisee);
      if (etape === null) continue;
      const r = realisesSeries.get(serieId as Id<'Serie'>) ?? {};
      r[etape] = plusTot(r[etape], date);
      realisesSeries.set(serieId as Id<'Serie'>, r);
    } else if (campagneId !== null && l.type === 'recolte') {
      realisesCampagnes.set(campagneId as Id<'Campagne'>, plusTot(realisesCampagnes.get(campagneId as Id<'Campagne'>), date));
    }
  }
  // T22 : interventions en vigueur, par série (elles soldent les travaux prévus).
  const interventions = new Map<Id<'Serie'>, InterventionRealisee[]>();
  for (const l of lignes.interventions) {
    const serieId = texteOuNul(l.serie_id);
    const c = categorie(l.categorie);
    const date = texte(l.date);
    if (serieId === null || c === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // T22b : l'occurrence visée par « Fait » (null si absente, ou si ce n'est pas une date qui
    // existe, comme '2026-02-31' : saisie libre, soldée par sa date réelle).
    const visee = texteOuNul(l.occurrence_visee);
    const occurrenceVisee = visee !== null && estDateValide(visee) ? visee : null;
    ajouterA(interventions, serieId as Id<'Serie'>, { date: date as DateCalendaire, categorie: c, type: texte(l.type_intervention), occurrenceVisee });
  }
  const realises = {
    series: realisesSeries as ReadonlyMap<Id<'Serie'>, RealisesSerie>,
    campagnes: realisesCampagnes,
    interventions: interventions as ReadonlyMap<Id<'Serie'>, readonly InterventionRealisee[]>,
  };

  // Saisies récentes en vigueur (règle jugée par la base sur toute la chaîne, comme le
  // semainier) : historique et dernières récoltes.
  const vigueur: EvenementLu[] = [];
  for (const l of lignes.recents) {
    const e = l.en_vigueur === 1 ? evenementLu(l) : null;
    if (e !== null) vigueur.push(e);
  }
  const dernieresRecoltes = new Map<string, DerniereRecolte>();
  for (const e of vigueur) {
    const cible = e.serieId ?? e.campagneId;
    if (e.detail.type === 'recolte' && cible !== null) {
      const avant = dernieresRecoltes.get(cible);
      if (avant === undefined || e.date >= avant.date) dernieresRecoltes.set(cible, { date: e.date, quantite: e.detail.quantite, unite: e.detail.unite });
    }
  }

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
    if (culture === undefined) continue;
    const cle = t.etape === 'travail' ? `${cibleId}:travail:${String(t.travail.indice)}:${t.datePrevue}` : `${cibleId}:${t.etape}`;
    taches.push({ cle, tache: t, culture });
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

/** Nom de l'étape réalisée, pour l'historique. */
export const ETAPES_FAITES: Readonly<Record<EtapeRealisee, string>> = {
  semis_pepiniere: 'Semis en pépinière',
  semis_direct: 'Semis',
  plantation: 'Plantation',
  arrachage: 'Arrachage',
};
