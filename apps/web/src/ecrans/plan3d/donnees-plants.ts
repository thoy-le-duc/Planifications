/**
 * Vue 3D (T32b) — ce que la 3D lit en plus du plan pour dessiner les plants, en LECTURE seule :
 * l'espèce et son profil de croissance, les dates de l'occupation (mise en place, récolte,
 * arrachage), l'écartement de l'itinéraire, les campagnes des pérennes, et ce qui est hors-sol
 * (zone `hors_sol` ou gouttière). Lu une fois à l'ouverture de la vue, hors du plan de la 2D : ni
 * l'écran Planches ni le démarrage n'en portent le coût. Aucune écriture, aucun champ nouveau.
 */
import type { DateCalendaire } from '@planif/core';
import { campagneEnCours, profilEffectif, type DatesCroissance, type EntreePerenne, type ProfilCroissance } from '@planif/core/croissance';
import type { PorteDonnees } from '@planif/sync';
import type { LigneLocale } from '../plan/calculs.ts';
import type { CultureDePlanche } from './plants.ts';

/** Écartement supposé (m) quand l'itinéraire n'en donne pas (semis à la volée, paramètres illisibles). */
export const ECARTEMENT_PAR_DEFAUT_M = 0.3;
/** Bornes de l'écartement lu : ni nul, ni plus large qu'une serre. */
const ECARTEMENT_MIN_M = 0.05;
const ECARTEMENT_MAX_M = 6;

interface Campagne {
  readonly debut: DateCalendaire | null;
  readonly fin: DateCalendaire | null;
}

/** Une culture lue : de quoi fabriquer la `CultureDePlanche` de n'importe quelle semaine. */
export interface CultureLue {
  readonly espece: string;
  readonly profil: ProfilCroissance;
  readonly ecartementM: number;
  readonly annuelle: DatesCroissance | null;
  readonly perenne: { readonly datePlantation: DateCalendaire; readonly dateArrachage: DateCalendaire | null; readonly campagnes: ReadonlyMap<number, Campagne> } | null;
}

export interface CulturesLues {
  /** Par occupation. */
  readonly parOccupation: ReadonlyMap<string, CultureLue>;
  /** Emplacements hors-sol : dans une zone `hors_sol` (ou sous elle), ou gouttières. */
  readonly horsSol: ReadonlySet<string>;
}

export interface LignesPlants {
  readonly occupations: readonly LigneLocale[];
  readonly campagnes: readonly LigneLocale[];
  readonly zones: readonly LigneLocale[];
  readonly emplacements: readonly LigneLocale[];
}

const texteOuNul = (v: string | number | null | undefined): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const dateOuNulle = (v: string | number | null | undefined): DateCalendaire | null => texteOuNul(v) as DateCalendaire | null;

/** Écartement (m) des plants d'après les paramètres figés de la série (texte JSON de l'itinéraire). */
export function ecartementDe(parametres: string | number | null | undefined): number {
  if (typeof parametres !== 'string') return ECARTEMENT_PAR_DEFAUT_M;
  try {
    const densite = (JSON.parse(parametres) as { densite?: { facon?: unknown; ecartementSurRangCm?: unknown; grainesParMetre?: unknown } } | null)?.densite;
    const m = densite?.facon === 'ecartement' && typeof densite.ecartementSurRangCm === 'number' ? densite.ecartementSurRangCm / 100 : densite?.facon === 'metre_lineaire' && typeof densite.grainesParMetre === 'number' && densite.grainesParMetre > 0 ? 1 / densite.grainesParMetre : ECARTEMENT_PAR_DEFAUT_M;
    return Number.isFinite(m) ? Math.min(ECARTEMENT_MAX_M, Math.max(ECARTEMENT_MIN_M, m)) : ECARTEMENT_PAR_DEFAUT_M;
  } catch {
    return ECARTEMENT_PAR_DEFAUT_M;
  }
}

/** Les lignes lues → cultures par occupation et emplacements hors-sol. Pur. */
export function construireCultures(lignes: LignesPlants): CulturesLues {
  const campagnes = new Map<string, Map<number, Campagne>>();
  for (const c of lignes.campagnes) {
    const plantation = texteOuNul(c.plantation_id);
    if (plantation === null) continue;
    const parAnnee = campagnes.get(plantation) ?? new Map<number, Campagne>();
    parAnnee.set(Number(c.annee), { debut: dateOuNulle(c.debut_recolte_prevu), fin: dateOuNulle(c.fin_recolte_prevue) });
    campagnes.set(plantation, parAnnee);
  }
  const parOccupation = new Map<string, CultureLue>();
  for (const o of lignes.occupations) {
    const nom = texteOuNul(o.e_nom);
    if (nom === null) continue;
    const base = { espece: nom, profil: profilEffectif({ nom, profilCroissance: o.e_profil }) };
    const plantation = texteOuNul(o.plantation_id);
    if (plantation !== null) {
      const datePlantation = dateOuNulle(o.p_plantation);
      if (datePlantation === null) continue;
      parOccupation.set(String(o.id), { ...base, ecartementM: ECARTEMENT_PAR_DEFAUT_M, annuelle: null, perenne: { datePlantation, dateArrachage: dateOuNulle(o.p_arrachage), campagnes: campagnes.get(plantation) ?? new Map<number, Campagne>() } });
      continue;
    }
    parOccupation.set(String(o.id), {
      ...base,
      ecartementM: ecartementDe(o.s_parametres),
      annuelle: {
        miseEnPlace: { prevue: dateOuNulle(o.s_mise_en_place) ?? dateOuNulle(o.prevu_du), reelle: dateOuNulle(o.reel_du) },
        debutRecolte: { prevue: dateOuNulle(o.s_debut_recolte), reelle: null },
        finRecolte: { prevue: dateOuNulle(o.s_fin_recolte), reelle: null },
        arrachage: { prevue: dateOuNulle(o.prevu_au), reelle: dateOuNulle(o.reel_au) },
      },
      perenne: null,
    });
  }

  const zonesHorsSol = new Set<string>();
  const parentes = new Map<string, string | null>();
  for (const z of lignes.zones) {
    parentes.set(String(z.id), texteOuNul(z.zone_parente_id));
    if (z.type_abri === 'hors_sol') zonesHorsSol.add(String(z.id));
  }
  const dansHorsSol = (zoneId: string): boolean => {
    for (let courante: string | null = zoneId, pas = 0; courante !== null && pas < 32; courante = parentes.get(courante) ?? null, pas += 1) {
      if (zonesHorsSol.has(courante)) return true;
    }
    return false;
  };
  const horsSol = new Set<string>();
  for (const e of lignes.emplacements) if (e.sorte === 'gouttiere' || dansHorsSol(String(e.zone_id))) horsSol.add(String(e.id));
  return { parOccupation, horsSol };
}

/**
 * La campagne d'une pérenne au jour `jour` (T32f) : celle qui contient le jour, ou, à défaut, celle qui
 * commence dans les 28 jours, quelle que soit son année de rattachement. Aucune des deux : celle de
 * l'année du jour, ou une campagne vide (la plante suit son cycle annuel).
 */
function campagneAu(campagnes: ReadonlyMap<number, Campagne>, jour: DateCalendaire): EntreePerenne['campagne'] {
  const liste = [...campagnes].sort((x, y) => x[0] - y[0]).map(([annee, c]) => ({ annee, debutRecolte: c.debut, finRecolte: c.fin }));
  const enCours = liste.filter((c) => campagneEnCours(c, jour));
  const annee = Number(jour.slice(0, 4));
  return enCours.find((c) => c.debutRecolte !== null && c.debutRecolte <= jour) ?? enCours[0] ?? liste.find((c) => c.annee === annee) ?? { annee, debutRecolte: null, finRecolte: null };
}

/** La culture de la semaine dont le lundi est `jour`. Une pérenne sans campagne en cours suit son cycle annuel. */
export function cultureAu(c: CultureLue, jour: DateCalendaire): CultureDePlanche {
  if (c.perenne === null) {
    return { espece: c.espece, profil: c.profil, ecartementM: c.ecartementM, croissance: { sorte: 'annuelle', dates: c.annuelle ?? { miseEnPlace: { prevue: null, reelle: null }, debutRecolte: { prevue: null, reelle: null }, finRecolte: { prevue: null, reelle: null }, arrachage: { prevue: null, reelle: null } } } };
  }
  return {
    espece: c.espece,
    profil: c.profil,
    ecartementM: c.ecartementM,
    croissance: {
      sorte: 'perenne',
      entree: { plantation: { datePlantation: c.perenne.datePlantation, dateArrachage: c.perenne.dateArrachage }, campagne: campagneAu(c.perenne.campagnes, jour) },
    },
  };
}

/** Lit les lignes de la ferme par la porte (4 requêtes, colonnes utiles seulement) et construit les cultures. */
export async function lireCultures(porte: PorteDonnees, fermeId: string): Promise<CulturesLues> {
  const [occupations, campagnes, zones, emplacements] = await Promise.all([
    porte.lire<LigneLocale>(
      `SELECT o.id, o.plantation_id, o.prevu_du, o.prevu_au, o.reel_du, o.reel_au,
         s.parametres AS s_parametres, s.prevu_mise_en_place AS s_mise_en_place, s.prevu_debut_recolte AS s_debut_recolte, s.prevu_fin_recolte AS s_fin_recolte,
         p.date_plantation AS p_plantation, p.date_arrachage AS p_arrachage, e.nom AS e_nom, e.profil_croissance AS e_profil
       FROM occupation o
       LEFT JOIN serie s ON s.id = o.serie_id
       LEFT JOIN plantation p ON p.id = o.plantation_id
       LEFT JOIN espece e ON e.id = COALESCE(s.espece_id, p.espece_id)
       WHERE o.ferme_id = ? AND o.supprime_le IS NULL AND (o.serie_id IS NOT NULL OR o.plantation_id IS NOT NULL)`,
      [fermeId],
    ),
    porte.lire<LigneLocale>('SELECT plantation_id, annee, debut_recolte_prevu, fin_recolte_prevue FROM campagne WHERE ferme_id = ? AND supprime_le IS NULL', [fermeId]),
    porte.lire<LigneLocale>('SELECT id, zone_parente_id, type_abri FROM zone WHERE ferme_id = ?', [fermeId]),
    porte.lire<LigneLocale>('SELECT id, zone_id, sorte FROM emplacement WHERE ferme_id = ?', [fermeId]),
  ]);
  return construireCultures({ occupations, campagnes, zones, emplacements });
}
