/**
 * Occupations d'un emplacement (T03) : ce qui occupe une planche, un rang ou une gouttière, et
 * quand. Fonctions pures ; l'identifiant et `supprimeLe` sont ajoutés par l'appelant.
 *
 * Convention des intervalles : [du, au[, `au` étant le jour où l'emplacement se libère.
 * Arracher et replanter le même jour ne fait donc pas de recouvrement.
 */
import { ajouterJours, ecartEnJours } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type {
  Emplacement,
  Evenement,
  IntervalleDates,
  Metres,
  Occupation,
  OccupantEmplacement,
  PlaceOccupee,
  Plantation,
  Serie,
} from '../domaine/index.ts';
import { appliquerRealises } from './dates-serie.ts';
import type { RealisesSerie } from './dates-serie.ts';

/** Ce que le moteur calcule : une occupation sans identifiant ni suppression douce. */
export type NouvelleOccupation = Omit<Occupation, 'id' | 'supprimeLe'>;

/** Fin prévue d'une plantation pérenne pas encore arrachée : « sans fin ». */
export const DATE_SANS_FIN: DateCalendaire = '9999-12-31' as DateCalendaire;

/** Période effective d'une occupation ; `au: null` = sans fin. */
export interface PeriodeOccupation {
  readonly du: DateCalendaire;
  readonly au: DateCalendaire | null;
}

/** Longueur minimale d'une place : un centimètre, la résolution du moteur. */
const LONGUEUR_MIN_M = 0.01;

/** Mètres ramenés en centimètres entiers : toutes les comparaisons de longueur se font ainsi. */
export function centimetres(metres: Metres): number {
  return Math.round(metres * 100);
}

/** Place prise sur l'emplacement : mètres (planche, rang) ou places entières (gouttière). */
function placeSur(emplacement: Emplacement, longueur: number, position: Metres | null): PlaceOccupee {
  if (!Number.isFinite(longueur)) {
    throw new RangeError(`la place occupée doit être un nombre fini : ${String(longueur)}`);
  }
  if (position !== null && (!Number.isFinite(position) || position < 0)) {
    throw new RangeError(`la position doit être un nombre positif ou nul : ${String(position)}`);
  }
  switch (emplacement.sorte) {
    case 'planche':
    case 'rang':
      if (longueur < LONGUEUR_MIN_M) {
        throw new RangeError(`la longueur doit valoir au moins un centimètre : ${String(longueur)} m`);
      }
      if (position !== null && centimetres(position) + centimetres(longueur) > centimetres(emplacement.longueurM)) {
        throw new RangeError(
          `le tronçon ${String(position)}–${String(position + longueur)} m dépasse l'emplacement de ${String(emplacement.longueurM)} m`,
        );
      }
      return { unite: 'longueur', longueurM: longueur };
    case 'gouttiere':
      if (!Number.isSafeInteger(longueur) || longueur <= 0) {
        throw new RangeError(`une gouttière se remplit par places entières : ${String(longueur)}`);
      }
      if (position !== null) {
        throw new RangeError('une gouttière ne prend pas de position');
      }
      return { unite: 'places', nombrePlaces: longueur };
    default:
      return verifierExhaustif(emplacement);
  }
}

/** Assemble une occupation après validation de la place. */
function occupation(
  fermeId: Occupation['fermeId'],
  occupant: OccupantEmplacement,
  emplacement: Emplacement,
  longueur: number,
  position: Metres | null,
  dates: { readonly prevuDu: DateCalendaire; readonly prevuAu: DateCalendaire; readonly reel: IntervalleDates | null },
): NouvelleOccupation {
  const place = placeSur(emplacement, longueur, position);
  return { fermeId, emplacementId: emplacement.id, occupant, place, positionM: position, ...dates };
}

/**
 * Occupation d'une série : de la mise en place à la fin de récolte, recalées sur le réel (T02).
 * La pépinière n'occupe pas l'emplacement.
 */
export function occupationDeSerie(
  serie: Serie,
  emplacement: Emplacement,
  longueur: number,
  position: Metres | null = null,
  realises: RealisesSerie = {},
): NouvelleOccupation {
  const dates = appliquerRealises(serie.datesPrevues, realises);
  const debutReel = realises.miseEnPlace;
  const finReelle = realises.finRecolte;
  if (debutReel !== undefined && finReelle !== undefined && ecartEnJours(debutReel, finReelle) < 0) {
    throw new RangeError(`fin réelle (${finReelle}) avant la mise en place réelle (${debutReel})`);
  }
  return occupation(serie.fermeId, { sorte: 'serie', serieId: serie.id }, emplacement, longueur, position, {
    prevuDu: dates.miseEnPlace,
    prevuAu: dates.finRecolte,
    reel: debutReel === undefined ? null : { du: debutReel, au: finReelle ?? null },
  });
}

/** Occupation d'une plantation pérenne : de la plantation à l'arrachage, sans fin avant. */
export function occupationDePlantation(
  plantation: Plantation,
  emplacement: Emplacement,
  longueur: number,
  position: Metres | null = null,
): NouvelleOccupation {
  const occupant: OccupantEmplacement = { sorte: 'plantation', plantationId: plantation.id };
  return occupation(plantation.fermeId, occupant, emplacement, longueur, position, {
    prevuDu: plantation.datePlantation,
    prevuAu: plantation.dateArrachage ?? DATE_SANS_FIN,
    reel: null,
  });
}

/** Occupation d'une couverture longue (bâche, occultation, solarisation) : de la pose à la dépose. */
export function occupationDeCouverture(
  evenement: Evenement,
  emplacement: Emplacement,
  longueur: number,
  position: Metres | null = null,
): NouvelleOccupation {
  if (evenement.type !== 'intervention' || evenement.detail.categorie !== 'couverture') {
    throw new RangeError('seule une intervention de couverture occupe un emplacement');
  }
  const duree = evenement.detail.dureeOccupationJours;
  if (duree === null || duree <= 0) {
    throw new RangeError(`couverture sans durée d'occupation positive, elle n'occupe pas l'emplacement : ${String(duree)}`);
  }
  const occupant: OccupantEmplacement = { sorte: 'couverture', evenementId: evenement.id };
  return occupation(evenement.fermeId, occupant, emplacement, longueur, position, {
    prevuDu: evenement.date,
    prevuAu: ajouterJours(evenement.date, duree),
    reel: null,
  });
}

/** Période effective : le réel prime sur le prévu ; DATE_SANS_FIN devient `au: null`. */
export function periodeOccupation(occupation: Pick<Occupation, 'prevuDu' | 'prevuAu' | 'reel'>): PeriodeOccupation {
  const au = occupation.reel?.au ?? occupation.prevuAu;
  return { du: occupation.reel?.du ?? occupation.prevuDu, au: au === DATE_SANS_FIN ? null : au };
}
