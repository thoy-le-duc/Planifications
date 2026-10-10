/**
 * T13i : « Fait » unique, une seule règle pour toutes les écritures. Un « Fait » (réalisé d'une
 * étape, intervention d'un travail prévu) ne s'écrit pas deux fois pour la même culture : la
 * vérification lit la base DANS la transaction d'écriture (`VerificationEcriture`), donc rien ne
 * s'intercale entre elle et l'écriture (deux taps, deux onglets, la voix et l'écran).
 *
 * T13j : construite par la porte seule (`preparerSaisie`, qui la rend avec l'ordre) pour tout
 * « Fait » nouveau ; `saisirEvenement` l'applique, `ecrireEnsemble` refuse un « Fait » préparé
 * sans vérificateur. L'écran Aujourd'hui passe celle que rend la porte. Sous-chemin `@planif/sync/fait-unique` :
 * ce module ne tire ni PowerSync ni la porte (l'écran l'importe sans alourdir le démarrage).
 *
 * « En vigueur » : la règle de la vue evenements_en_vigueur (@planif/db, T10g), en SQL (`chaines`) :
 * une chaîne de remplacements qui contient une annulation n'a rien en vigueur ; sinon sa correction
 * la plus récente (horodatage, puis id), à défaut l'original. La culture et le detail sont lus sur
 * la ligne en vigueur (une correction peut changer l'étape, voire la culture). Seules les lignes
 * de la ferme comptent (`origine_id` des lignes reçues du serveur compris).
 */
import type { VerificationEcriture } from './types.ts';

/**
 * T13n : clé SQL de l'ordre canonique des saisies (instant, id), pour `MAX` : l'instant
 * (`julianday` de SQLite, en millisecondes) sur 15 chiffres (ceux des années 0000 à 9999 en
 * comptent 15 ; illisible : que des zéros, le plus ancien), `|`, l'id. Largeur fixe : aucun
 * préfixe ne fausse l'ordre du texte. Même ordre que `comparerSaisies` (horodatage.ts, qui
 * explique la règle ; vérifié par horodatage-instant.test.ts). `colonneHorodatage` et
 * `colonneId` sont des noms de colonnes écrits par le code, jamais une valeur reçue.
 */
export const cleHorodatageSql = (colonneHorodatage: string, colonneId: string): string => {
  // Fuseau de Postgres sans deux-points (`+00`, `+0530`), en toute fin : complété en `±HH:MM`,
  // comme `fuseauComplet` (horodatage.ts).
  const h = `(CASE WHEN ${colonneHorodatage} GLOB '*[+-][0-9][0-9]' THEN ${colonneHorodatage} || ':00'
    WHEN ${colonneHorodatage} GLOB '*[+-][0-9][0-9][0-9][0-9]'
      THEN substr(${colonneHorodatage}, 1, length(${colonneHorodatage}) - 2) || ':' || substr(${colonneHorodatage}, -2)
    ELSE ${colonneHorodatage} END)`;
  return `printf('%015d', CASE WHEN ${h} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ]*'
    THEN CAST(round(julianday(${h}) * 86400000) AS INTEGER) END) || '|' || ${colonneId}`;
};

/** « Fait » déjà noté (réalisé ou intervention en vigueur) : rien n'est écrit. */
export class DejaFait extends Error {}

/**
 * Chaînes de remplacement du journal local, en tête d'une requête (`WITH RECURSIVE …`). Une ligne
 * reçue du serveur porte l'origine de sa chaîne (`origine_id`, tenue par la base, T10h) : elle est
 * lue telle quelle. Seules les saisies locales pas encore synchronisées (sans `origine_id`)
 * montent, par l'identifiant, jusqu'au premier parent qui la porte ou jusqu'à l'origine (une
 * chaîne de 1 000 corrections ne se remonte pas). Un parent absent de la base locale sert de clé
 * de chaîne, comme dans `enVigueur` (calculs.ts). T13m : la montée ne passe jamais par une ligne
 * d'une autre ferme (`ferme`, portée par chaque maillon) : pour la ferme, une telle ligne est
 * absente. Profondeur bornée : un cycle (données corrompues) n'atteint aucune origine, ses
 * maillons et ce qui y remonte ne sont pas dans `remplacement` : rien n'y est en vigueur.
 *   - `remplacement` : chaque correction ou annulation, avec l'origine de sa chaîne (le dernier
 *     maillon de sa montée : fini, ou dont le parent est une origine ou absent) ;
 *   - `chaine` : par origine, la clé (instant|id, `cleHorodatageSql`, T13n : l'horodatage comparé
 *     comme un instant, jamais comme du texte) de sa correction la plus récente et son
 *     `id` (colonne nue de SQLite : celle de la ligne du MAX), le nombre de ses annulations et
 *     de ses corrections.
 * `depart` filtre les remplacements dont on part ; `avant` : CTE placées avant
 * (`nom(…) AS (…),`), que `depart` peut lire.
 *
 * T13b : les remplacements se lisent par l'index `remplacement` (`>= ''` : toute valeur non
 * nulle, comme `IS NOT NULL`, que SQLite ne cherche pas dans un index d'expression), qui porte
 * aussi la ferme, l'origine, la sorte et l'horodatage. La ferme est écartée de l'index
 * ferme_date (`+`) : sinon SQLite parcourrait tout le journal de la ferme.
 */
export const chaines = (depart: string, avant = '') => `WITH RECURSIVE ${avant}montee(id, sorte, horodatage, origine, fini, profondeur, ferme) AS (
    SELECT id, remplace_sorte, horodatage, coalesce(origine_id, remplace_evenement_id), origine_id IS NOT NULL, 0, ferme_id FROM evenement
    WHERE ${depart}
    UNION ALL
    SELECT m.id, m.sorte, m.horodatage, coalesce(p.origine_id, p.remplace_evenement_id), p.origine_id IS NOT NULL, m.profondeur + 1, m.ferme
    FROM montee m JOIN evenement p ON p.id = m.origine AND +p.ferme_id = m.ferme
    WHERE NOT m.fini AND (p.origine_id IS NOT NULL OR p.remplace_evenement_id IS NOT NULL) AND m.profondeur < 1000
  ),
  remplacement AS (
    SELECT m.id, m.sorte, m.horodatage, m.origine FROM montee m
    WHERE m.fini OR NOT EXISTS (SELECT 1 FROM evenement p
      WHERE p.id = m.origine AND +p.ferme_id = m.ferme AND (p.origine_id IS NOT NULL OR p.remplace_evenement_id IS NOT NULL))
  ),
  chaine AS (
    SELECT origine, MAX(CASE WHEN sorte = 'correction' THEN ${cleHorodatageSql('horodatage', 'id')} END) AS cle, id,
      SUM(sorte = 'annulation') AS annulations, SUM(sorte = 'correction') AS corrections
    FROM remplacement GROUP BY origine
  )
`;

/**
 * Les chaînes de TOUTE la ferme (un paramètre : la ferme). Sert à la journée (calculs.ts de
 * l'écran Aujourd'hui), qui les lit une fois pour tout le journal.
 */
export const CHAINES = chaines(`remplace_evenement_id >= '' AND +ferme_id = ?`);

export type ColonneCulture = 'serie_id' | 'campagne_id';

/**
 * T13i : « déjà fait ? » restreint à la culture visée (T13h recalculait les chaînes de toute la
 * ferme). Les candidats sont les lignes de la culture (son index) du type et du detail voulus,
 * originales ou corrections ; leurs chaînes, et elles seules, sont reconstituées :
 *   - `candidat` : les candidats ; sans candidat, rien d'autre n'est lu ;
 *   - `haut` : leurs ancêtres (montée par origine_id, sinon remplace_evenement_id), racine
 *     comprise ; en UNION, chaque ancêtre une seule fois (un cycle de données corrompues s'arrête) ;
 *   - `membre` : ces ancêtres ; les remplacements de la culture ; ceux dont origine_id est l'un de
 *     ces ancêtres (une annulation reçue du serveur dont le maillon intermédiaire manque ici, même
 *     dans une autre culture : index `remplacement`, qui porte origine_id) ; et tout ce qui
 *     descend d'eux par remplace_evenement_id (même index) : une correction qui a changé de
 *     culture reste dans la chaîne ;
 *   - `chaines` sur ces seuls membres, puis la règle « en vigueur » sur les candidats.
 * Paramètres : culture, ferme, type, puis chemin JSON et valeur par clé du detail, puis les ids
 * écartés des candidats en tableau JSON (T13j : les « Fait » que la transaction vient d'écrire)
 * (candidats) ; culture, ferme (remplacements de la culture) ; ferme (branche origine_id) ; ferme
 * (départ des chaînes).
 */
const sqlDejaFait = (colonne: ColonneCulture, nombreCles: number) => {
  const filtre = `e.${colonne} = ? AND +e.ferme_id = ? AND e.type = ? AND json_valid(e.detail)
    AND ${Array.from({ length: nombreCles }, () => 'json_extract(e.detail, ?) = ?').join(' AND ')}`;
  const avant = `candidat(id, sorte) AS (
    SELECT e.id, e.remplace_sorte FROM evenement e WHERE ${filtre} AND (e.remplace_sorte IS NULL OR e.remplace_sorte = 'correction')
      AND e.id NOT IN (SELECT value FROM json_each(?))
  ),
  haut(id, origine, fini) AS (
    SELECT p.id, coalesce(p.origine_id, p.remplace_evenement_id), p.origine_id IS NOT NULL FROM evenement p WHERE p.id IN (SELECT id FROM candidat)
    UNION
    SELECT p.id, coalesce(p.origine_id, p.remplace_evenement_id), p.origine_id IS NOT NULL
    FROM haut h JOIN evenement p ON p.id = h.origine
    WHERE NOT h.fini AND h.origine IS NOT NULL
  ),
  membre(id) AS (
    SELECT id FROM haut
    UNION SELECT origine FROM haut WHERE origine IS NOT NULL
    UNION SELECT e.id FROM evenement e WHERE e.${colonne} = ? AND +e.ferme_id = ? AND e.remplace_sorte IS NOT NULL
    UNION SELECT e.id FROM evenement e
      WHERE e.remplace_evenement_id >= '' AND +e.ferme_id = ? AND e.origine_id IN (SELECT id FROM haut UNION SELECT origine FROM haut)
    UNION SELECT e.id FROM evenement e JOIN membre m ON e.remplace_evenement_id = m.id
  ),
  `;
  return `${chaines(`id IN (SELECT id FROM membre) AND remplace_evenement_id >= '' AND +ferme_id = ?`, avant)}SELECT 1 FROM candidat c
  WHERE (c.sorte IS NULL AND c.id NOT IN (SELECT origine FROM chaine))
    OR (c.sorte = 'correction' AND c.id IN (SELECT id FROM chaine WHERE annulations = 0 AND cle IS NOT NULL))
  LIMIT 1`;
};

/** Le « Fait » à vérifier : culture visée, type d'événement, valeurs attendues du detail. */
export interface FaitVise {
  readonly fermeId: string;
  readonly colonne: ColonneCulture;
  readonly cibleId: string;
  readonly type: string;
  /** Champ du detail → valeur attendue (ex. `{ etape: 'plantation' }`). */
  readonly detail: Readonly<Record<string, string>>;
}

/** Nom de champ du detail admis par `pasDejaFait`. */
const NOM_DE_CHAMP = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Vérification AVANT l'écriture, à passer à `ecrireEnsemble` : lève DejaFait si un « Fait »
 * identique est déjà en vigueur pour la culture.
 */
export function pasDejaFait(fait: FaitVise): VerificationEcriture {
  return dejaFaitHors(fait, []);
}

/**
 * T13j : contrôle APRÈS l'écriture, dans la même transaction : le « Fait » vient d'être écrit
 * (lignes `ecrits`, écartées des candidats) ; aucun autre identique ne doit être en vigueur, déjà
 * là ou écrit par la même transaction (une correction comprise). Lève DejaFait sinon : la
 * transaction est annulée. Écarter les lignes écrites garde le cas courant aussi rapide que la
 * vérification d'avant l'écriture : sans autre candidat, rien d'autre n'est lu.
 */
export function faitUnique(fait: FaitVise, ecrits: readonly string[]): VerificationEcriture {
  return dejaFaitHors(fait, ecrits);
}

/** Clé d'un « Fait » : deux « Fait » de même clé sont le même travail sur la même culture. */
export const cleFait = (f: FaitVise): string =>
  JSON.stringify([f.fermeId, f.colonne, f.cibleId, f.type, Object.entries(f.detail).sort(([a], [b]) => (a < b ? -1 : 1))]);

/**
 * T13j : le « Fait » que porte une ligne d'événement (format local), ou undefined. Un « Fait » :
 * ligne originale (`remplace_sorte` nulle, comme les candidats de la vérification) sur une
 * culture, et
 *   - un réalisé : son étape ;
 *   - une intervention qui solde un travail prévu (`occurrenceVisee` renseignée) : libellé,
 *     catégorie, occurrence visée — la règle de l'écran (ni l'outil, ni le produit, ni la date).
 * Seule définition du « Fait » : la porte s'en sert pour `preparerSaisie` et pour contrôler les
 * lignes écrites, quel que soit le chemin.
 */
export function faitDeLigne(ligne: Readonly<Record<'ferme_id' | 'type' | 'serie_id' | 'campagne_id' | 'remplace_sorte' | 'detail', unknown>>): FaitVise | undefined {
  if (ligne.remplace_sorte !== null || typeof ligne.ferme_id !== 'string') return undefined;
  const serie = typeof ligne.serie_id === 'string';
  const cibleId = serie ? ligne.serie_id : ligne.campagne_id;
  if (typeof cibleId !== 'string' || typeof ligne.detail !== 'string') return undefined;
  let d: unknown;
  try {
    d = JSON.parse(ligne.detail);
  } catch {
    return undefined;
  }
  if (typeof d !== 'object' || d === null) return undefined;
  const champ = (nom: string): string | undefined => {
    const v: unknown = (d as Record<string, unknown>)[nom];
    return typeof v === 'string' ? v : undefined;
  };
  let detail: Readonly<Record<string, string>>;
  const etape = champ('etape');
  const [type, categorie, occurrenceVisee] = [champ('type'), champ('categorie'), champ('occurrenceVisee')];
  if (ligne.type === 'realise' && etape !== undefined) detail = { etape };
  else if (ligne.type === 'intervention' && type !== undefined && categorie !== undefined && occurrenceVisee !== undefined) {
    detail = { type, categorie, occurrenceVisee };
  } else return undefined;
  return { fermeId: ligne.ferme_id, colonne: serie ? 'serie_id' : 'campagne_id', cibleId, type: ligne.type, detail };
}

/** Lève DejaFait si un « Fait » identique, hors des lignes `exclus`, est en vigueur pour la culture. */
function dejaFaitHors(fait: FaitVise, exclus: readonly string[]): VerificationEcriture {
  const cles = Object.keys(fait.detail);
  // Une clé est un NOM de champ, passée en paramètre (chemin JSON entre guillemets), jamais
  // recopiée dans le SQL. Sans clé, la vérification ne viserait rien : refus explicite.
  if (cles.length === 0) throw new Error('vérification « déjà fait » : detail vide, aucun champ à comparer');
  // Nom de champ simple seulement : un caractère spécial (\, guillemet…) donnerait un chemin
  // JSON qui ne trouve rien, et laisserait passer un doublon sans bruit.
  const cleRefusee = cles.find((c) => !NOM_DE_CHAMP.test(c));
  if (cleRefusee !== undefined) throw new Error(`vérification « déjà fait » : nom de champ refusé : ${JSON.stringify(cleRefusee)}`);
  const sql = sqlDejaFait(fait.colonne, cles.length);
  const filtre = [fait.cibleId, fait.fermeId, fait.type, ...cles.flatMap((c) => [`$."${c}"`, fait.detail[c]])];
  return async (lire) => {
    const deja = await lire(sql, [...filtre, JSON.stringify(exclus), fait.cibleId, fait.fermeId, fait.fermeId, fait.fermeId]);
    if (deja.length > 0) throw new DejaFait('déjà fait');
  };
}

/** Lecture d'une vérification : `chaineDe` sert dans la transaction d'écriture comme hors d'elle. */
export type Lire = Parameters<VerificationEcriture>[0];

/** La chaîne d'une saisie : annulée (rien en vigueur), sinon sa ligne en vigueur. */
export interface ChaineDe {
  readonly annulee: boolean;
  readonly enVigueur: string | null;
}

/**
 * T13m : origine de la chaîne de la ligne `id` (paramètres : id, ferme, id, ferme), par la montée
 * de `chaines` partie de cette seule ligne. `origine` nulle pour un remplacement : cycle ou montée
 * trop longue (rien en vigueur). Aucune ligne : `id` absent de la ferme.
 */
const SQL_ORIGINE_DE = `${chaines(`id = ? AND remplace_evenement_id >= '' AND +ferme_id = ?`)}SELECT e.remplace_sorte AS sorte,
    e.origine_id AS origine_recue, (SELECT origine FROM remplacement) AS origine
  FROM evenement e WHERE e.id = ? AND +e.ferme_id = ?`;

/**
 * T13m : la chaîne de l'origine `o` (paramètres : o, ferme, o, ferme, ferme, o), par `chaines`
 * partie de ses seuls membres possibles : `o`, les remplacements reçus qui la portent en
 * `origine_id`, et ce qui descend d'eux par remplace_evenement_id (index `remplacement`). Toute
 * ligne dont la montée aboutit à `o` en fait partie ; `chaines` les juge, la chaîne de `o` est
 * lue à la fin (un membre dont la montée aboutit ailleurs n'y compte pas).
 */
const SQL_CHAINE_DE_L_ORIGINE = `${chaines(
  `id IN (SELECT id FROM membre) AND remplace_evenement_id >= '' AND +ferme_id = ?`,
  `membre(id) AS (
    SELECT ?
    UNION SELECT e.id FROM evenement e WHERE e.remplace_evenement_id >= '' AND +e.ferme_id = ? AND e.origine_id = ?
    UNION SELECT e.id FROM evenement e JOIN membre m ON e.remplace_evenement_id = m.id WHERE +e.ferme_id = ?
  ),
  `,
)}SELECT annulations, cle, id FROM chaine WHERE origine = ?`;

/**
 * T13m : la chaîne de remplacements de la ligne `id` de la ferme, selon la règle de `chaines`
 * (la seule) : la journée la lit pour toute la ferme (`CHAINES`), les écritures pour une saisie.
 * Chaîne qui contient une annulation, cycle, origine dont `origine_id` désigne une autre ligne
 * (données corrompues) : `annulee`, rien en vigueur (le sens sûr : refus plutôt qu'écriture) ;
 * sinon la correction la plus récente (instant, puis id ; T13n : un horodatage illisible ou nul
 * vaut l'instant 0, il n'annule plus la chaîne), à défaut l'origine. Ligne absente de la ferme : ni annulée,
 * ni rien en vigueur.
 */
export async function chaineDe(lire: Lire, fermeId: string, id: string): Promise<ChaineDe> {
  const ligne = (await lire<{ sorte: string | null; origine_recue: string | null; origine: string | null }>(SQL_ORIGINE_DE, [id, fermeId, id, fermeId]))[0];
  if (ligne === undefined) return { annulee: false, enVigueur: null };
  // Une origine reçue porte son propre id en origine_id ; tout autre (données corrompues) : refus.
  if (ligne.sorte === null && ligne.origine_recue !== null && ligne.origine_recue !== id) return { annulee: true, enVigueur: null };
  const origine = ligne.sorte === null ? id : ligne.origine;
  if (origine === null) return { annulee: true, enVigueur: null };
  const c = (
    await lire<{ annulations: number; cle: string | null; id: string | null }>(SQL_CHAINE_DE_L_ORIGINE, [origine, fermeId, origine, fermeId, fermeId, origine])
  )[0];
  if (c === undefined) return { annulee: false, enVigueur: origine };
  // Annulation (ou chaîne sans clé, par sécurité) : rien en vigueur (comme EN_VIGUEUR).
  if (c.annulations > 0 || c.cle === null) return { annulee: true, enVigueur: null };
  return { annulee: false, enVigueur: c.id };
}
