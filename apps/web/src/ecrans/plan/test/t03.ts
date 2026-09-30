/**
 * Aide des tests de T11 : conflits attendus, calculés par le moteur de T03 lui-même
 * (`detecterConflits`) à partir des lignes locales. Sert d'arbitre : la vue 2D ne doit pas
 * inventer de règle, elle montre ce que T03 trouve.
 */
import type { DateCalendaire, Emplacement, Id, Instant, Occupation, OccupantEmplacement, PlaceOccupee } from '@planif/core';
import { detecterConflits, type Conflit } from '../../../../../../packages/core/src/planification/conflits.ts';
import type { LigneLocale } from './contrat.ts';

const texte = (v: string | number | null | undefined): string => (typeof v === 'string' ? v : String(v));
const texteOuNul = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : texte(v));
const nombre = (v: string | number | null | undefined): number => (typeof v === 'number' ? v : Number(v));

export function versEmplacement(l: LigneLocale): Emplacement {
  const commun = {
    id: texte(l.id) as Id<'Emplacement'>,
    fermeId: texte(l.ferme_id) as Id<'Ferme'>,
    supprimeLe: texteOuNul(l.supprime_le) as Instant | null,
    zoneId: texte(l.zone_id) as Id<'Zone'>,
    code: texte(l.code),
    longueurM: nombre(l.longueur_m),
    largeurM: l.largeur_m === null || l.largeur_m === undefined ? null : (nombre(l.largeur_m)),
    actifDu: texte(l.actif_du) as DateCalendaire,
    actifAu: texteOuNul(l.actif_au) as DateCalendaire | null,
    remplace: [] as readonly Id<'Emplacement'>[],
  };
  if (l.sorte === 'gouttiere') return { ...commun, sorte: 'gouttiere', nombrePlaces: nombre(l.nombre_places) };
  return { ...commun, sorte: l.sorte === 'rang' ? 'rang' : 'planche' };
}

export function versOccupation(l: LigneLocale, emplacement: Emplacement): Occupation {
  const occupant: OccupantEmplacement =
    l.serie_id !== null && l.serie_id !== undefined
      ? { sorte: 'serie', serieId: texte(l.serie_id) as Id<'Serie'> }
      : l.plantation_id !== null && l.plantation_id !== undefined
        ? { sorte: 'plantation', plantationId: texte(l.plantation_id) as Id<'Plantation'> }
        : { sorte: 'couverture', evenementId: texte(l.evenement_id) as Id<'Evenement'> };
  const place: PlaceOccupee =
    emplacement.sorte === 'gouttiere'
      ? { unite: 'places', nombrePlaces: nombre(l.nombre_places) }
      : { unite: 'longueur', longueurM: nombre(l.longueur_m) };
  const reelDu = texteOuNul(l.reel_du);
  return {
    id: texte(l.id) as Id<'Occupation'>,
    fermeId: texte(l.ferme_id) as Id<'Ferme'>,
    supprimeLe: texteOuNul(l.supprime_le) as Instant | null,
    emplacementId: emplacement.id,
    occupant,
    place,
    positionM: l.position_m === null || l.position_m === undefined ? null : (nombre(l.position_m)),
    prevuDu: texte(l.prevu_du) as DateCalendaire,
    prevuAu: texte(l.prevu_au) as DateCalendaire,
    reel: reelDu === null ? null : { du: reelDu as DateCalendaire, au: texteOuNul(l.reel_au) as DateCalendaire | null },
  };
}

/** Conflit ramené à une forme comparable : occupations triées (l'ordre d'entrée peut différer). */
export interface ConflitComparable {
  readonly sorte: string;
  readonly occupations: readonly string[];
  readonly du: string;
  readonly au: string | null;
}

export function comparable(c: { readonly sorte: string; readonly occupations: readonly string[]; readonly du: string; readonly au: string | null }): ConflitComparable {
  return { sorte: c.sorte, occupations: [...c.occupations].sort(), du: c.du, au: c.au };
}

/** [du, au[ recoupe [debut, fin + 1 jour[ ? Dates 'AAAA-MM-JJ' (l'ordre du texte est celui des jours). */
export function recoupeSaison(du: string, au: string | null, debut: string, fin: string): boolean {
  return du <= fin && (au === null || au > debut);
}

/**
 * Conflits attendus par emplacement pour la saison : detecterConflits sur toutes les occupations
 * non supprimées de l'emplacement, puis seuls ceux qui recoupent la saison.
 */
export function conflitsAttendus(
  emplacements: readonly LigneLocale[],
  occupations: readonly LigneLocale[],
  saison: { readonly debut: string; readonly fin: string },
): Map<string, ConflitComparable[]> {
  const parEmplacement = new Map<string, LigneLocale[]>();
  for (const o of occupations) {
    const cle = texte(o.emplacement_id);
    const liste = parEmplacement.get(cle) ?? [];
    liste.push(o);
    parEmplacement.set(cle, liste);
  }
  const resultat = new Map<string, ConflitComparable[]>();
  for (const l of emplacements) {
    const emplacement = versEmplacement(l);
    const siennes = (parEmplacement.get(emplacement.id) ?? []).filter((o) => o.supprime_le === null).map((o) => versOccupation(o, emplacement));
    const conflits: Conflit[] = detecterConflits(emplacement, siennes);
    resultat.set(
      emplacement.id,
      conflits.filter((c) => recoupeSaison(c.du, c.au, saison.debut, saison.fin)).map(comparable),
    );
  }
  return resultat;
}
