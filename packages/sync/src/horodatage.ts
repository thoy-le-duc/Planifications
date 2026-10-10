/**
 * T13n : horodatages comparés comme des instants, jamais comme du texte. Les lignes locales sont
 * horodatées par `toISOString` (`2026-10-01T10:00:00.000Z`), celles reçues du serveur peuvent
 * l'être autrement (espace au lieu de `T`, fractions absentes ou plus courtes, `+00:00` au lieu
 * de `Z`) : comparer le texte élirait parfois la plus ancienne.
 *
 * Une seule règle, deux écritures qui donnent exactement le même ordre :
 *   - en JavaScript : `instantHorodatage`, `comparerSaisies` (enVigueur, historique de l'écran) ;
 *   - en SQL : `cleHorodatageSql` (fait-unique.ts, les chaînes), par `julianday` de SQLite. Elle
 *     est rangée là pour que l'éditeur de placement, qui charge fait-unique.ts, ne charge pas la
 *     lecture JavaScript (budget de son morceau).
 * `instantHorodatage` reproduit la lecture de SQLite (3.51 et plus : Node et wa-sqlite) des
 * formes admises : l'instant est le « jour julien » de SQLite en millisecondes (entier). L'égalité
 * avec `julianday` est vérifiée par horodatage-instant.test.ts sur une base node:sqlite.
 *
 * Formes admises (gardées par le même filtre des deux côtés) : `AAAA-MM-JJ`, puis `T` ou une
 * espace, puis éventuellement `HH:MM[:SS[.fraction]]` et un fuseau (`Z`, `±HH:MM` ; `±HH` et
 * `±HHMM` en toute fin, format de Postgres, complétés en `±HH:MM`). Sans fuseau,
 * l'heure est en UTC (comme SQLite, jamais l'heure locale du téléphone). Horodatage illisible :
 * instant 0, plus ancien que tout horodatage lisible ; l'id départage. Jamais d'erreur.
 */

/** Espaces que SQLite saute (`sqlite3Isspace`). */
const ESPACE = '[ \\t\\n\\v\\f\\r]';

/**
 * Forme admise. Le 11e caractère est `T` ou une espace (filtre `GLOB` du SQL), puis SQLite saute
 * toutes les espaces et `T`. Chiffres ASCII seulement, comme SQLite.
 */
const FORME = new RegExp(
  `^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ][ \\t\\n\\v\\f\\rT]*` +
    `(?:([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]+))?)?${ESPACE}*(?:[Zz]|([+-])([0-9]{2}):([0-9]{2}))?${ESPACE}*)?$`,
);

/** Jour julien en millisecondes admis par SQLite (`validJulianDay`). */
const JULIEN_MAX = 464_269_060_799_999;

/** Division entière de C (vers zéro). */
const div = (a: number, b: number): number => Math.trunc(a / b);

/**
 * Fuseau sans deux-points (format texte de Postgres : `+00`, ou `+0530`) complété en `±HH:MM`,
 * que SQLite seul ne lit pas. Seulement en toute fin du texte, comme le `GLOB` de
 * `cleHorodatageSql` (fait-unique.ts), qui fait la même chose avant `julianday`.
 */
function fuseauComplet(h: string): string {
  if (/[+-][0-9]{2}$/.test(h)) return `${h}:00`;
  if (/[+-][0-9]{4}$/.test(h)) return `${h.slice(0, -2)}:${h.slice(-2)}`;
  return h;
}

/**
 * Instant d'un horodatage : le jour julien de SQLite en millisecondes (`julianday(h) * 86400000`),
 * 0 s'il est illisible (absent, autre type, autre forme, valeur hors bornes).
 */
export function instantHorodatage(h: unknown): number {
  if (typeof h !== 'string') return 0;
  const m = FORME.exec(fuseauComplet(h));
  if (m === null) return 0;
  const [, a, mo, j, hh, mi, ss, fraction, signe, fh, fm] = m;
  let annee = Number(a);
  let mois = Number(mo);
  const jour = Number(j);
  const [heure, minute, seconde] = [Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0)];
  const [fuseauH, fuseauM] = [Number(fh ?? 0), Number(fm ?? 0)];
  // Bornes de SQLite (getDigits) : hors d'elles, la date est illisible.
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || heure > 24 || minute > 59 || seconde > 59 || fuseauH > 14 || fuseauM > 59) return 0;
  // computeJD de SQLite, à l'identique (divisions entières de C).
  if (mois <= 2) {
    annee -= 1;
    mois += 12;
  }
  const A = div(annee, 100);
  const B = 2 - A + div(A, 4);
  const X1 = div(36525 * (annee + 4716), 100);
  const X2 = div(306001 * (mois + 1), 10000);
  let instant = Math.trunc((X1 + X2 + jour + B - 1524.5) * 86_400_000);
  if (hh !== undefined) {
    // parseHhMmSs de SQLite : fraction en flottant, plafonnée à 0,999, arrondie à la milliseconde.
    let ms = 0;
    if (fraction !== undefined) {
      let echelle = 1;
      for (let i = 0; i < fraction.length; i++) {
        ms = ms * 10 + fraction.charCodeAt(i) - 48;
        echelle *= 10;
      }
      ms /= echelle;
      if (ms > 0.999) ms = 0.999;
    }
    instant += heure * 3_600_000 + minute * 60_000 + Math.trunc((seconde + ms) * 1000 + 0.5);
  }
  if (signe !== undefined) instant -= (signe === '-' ? -1 : 1) * (fuseauM + fuseauH * 60) * 60_000;
  return instant >= 0 && instant <= JULIEN_MAX ? instant : 0;
}

/** Ce que l'ordre canonique lit d'une saisie. */
export interface Horodatee {
  readonly id: string;
  readonly horodatage: string;
}

/**
 * Ordre canonique des saisies : (instant, id). Positif si `a` est plus récente que `b`, négatif
 * si plus ancienne, 0 pour la même ligne. Même ordre que `cleHorodatageSql`.
 */
export function comparerSaisies(a: Horodatee, b: Horodatee): number {
  const ia = instantHorodatage(a.horodatage);
  const ib = instantHorodatage(b.horodatage);
  if (ia !== ib) return ia > ib ? 1 : -1;
  return a.id === b.id ? 0 : a.id > b.id ? 1 : -1;
}
