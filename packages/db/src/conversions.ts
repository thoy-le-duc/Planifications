/**
 * Conversions pures ligne SQL ↔ entité de T01, sans perte dans les deux sens.
 *
 * Les entités de T01 sont imbriquées et discriminées (ancre, taille, occupant, place, détail…),
 * une ligne SQL est plate. Une `Ligne<T>` est une ligne complète sans les horodatages
 * techniques que la base remplit (`cree_le`, `modifie_le`) : elle s'insère telle quelle, et une
 * ligne lue se relit telle quelle.
 *
 * Instants : `Date` côté ligne (timestamptz), millisecondes côté domaine.
 */
import {
  verifierExhaustif,
  type Emplacement,
  type Evenement,
  type Instant,
  type Occupation,
  type Serie,
} from '@planif/core';
import type { emplacement, evenement, occupation, serie } from './schema.ts';

/** Ligne complète d'une table, sans les horodatages remplis par la base. */
export type Ligne<T extends { $inferSelect: object }> = Omit<T['$inferSelect'], 'creeLe' | 'modifieLe'>;

export type LigneSerie = Ligne<typeof serie>;
export type LigneOccupation = Ligne<typeof occupation>;
export type LigneEmplacement = Ligne<typeof emplacement>;
/** Sans `origineId` : l'origine de la chaîne est remplie par la base (déclencheur, T10h). */
export type LigneEvenement = Omit<Ligne<typeof evenement>, 'origineId'>;

/** Ligne incohérente avec le modèle (les contraintes de la base l'empêchent normalement). */
export class LigneInvalide extends Error {
  constructor(table: string, id: string, raison: string) {
    super(`ligne ${table} ${id} invalide : ${raison}`);
    this.name = 'LigneInvalide';
  }
}

function versDate(i: Instant | null): Date | null {
  return i === null ? null : new Date(i);
}

function versInstant(d: Date | null): Instant | null {
  return d === null ? null : d.getTime();
}

// ---------------------------------------------------------------------------------------------
// Serie
// ---------------------------------------------------------------------------------------------

export function ligneDepuisSerie(s: Serie): LigneSerie {
  return {
    id: s.id,
    fermeId: s.fermeId,
    supprimeLe: versDate(s.supprimeLe),
    saisonId: s.saisonId,
    especeId: s.especeId,
    varieteId: s.varieteId,
    itineraireId: s.itineraireId,
    parametres: s.parametres,
    ancreType: s.ancre.type,
    ancreDate: s.ancre.date,
    prevuSemisPepiniere: s.datesPrevues.semisPepiniere ?? null,
    prevuMiseEnPlace: s.datesPrevues.miseEnPlace,
    prevuDebutRecolte: s.datesPrevues.debutRecolte,
    prevuFinRecolte: s.datesPrevues.finRecolte,
    longueurM: s.taille.unite === 'longueur' ? s.taille.longueurM : null,
    nombrePlants: s.taille.unite === 'plants' ? s.taille.nombrePlants : null,
    statut: s.statut,
    rotationAcceptee:
      s.rotationAcceptee === undefined
        ? null
        : { famille: s.rotationAcceptee.familleId, delai_ans: s.rotationAcceptee.delaiAns, le: new Date(s.rotationAcceptee.le).toISOString() },
  };
}

export function serieDepuisLigne(l: LigneSerie): Serie {
  let taille: Serie['taille'];
  if (l.longueurM !== null) {
    taille = { unite: 'longueur', longueurM: l.longueurM };
  } else if (l.nombrePlants !== null) {
    taille = { unite: 'plants', nombrePlants: l.nombrePlants };
  } else {
    throw new LigneInvalide('serie', l.id, 'ni longueur ni nombre de plants');
  }
  return {
    id: l.id,
    fermeId: l.fermeId,
    supprimeLe: versInstant(l.supprimeLe),
    saisonId: l.saisonId,
    especeId: l.especeId,
    varieteId: l.varieteId,
    itineraireId: l.itineraireId,
    parametres: l.parametres,
    ancre: { type: l.ancreType, date: l.ancreDate },
    datesPrevues: {
      // Étape sans objet : clé absente, pas nulle (DatesPrevuesSerie).
      ...(l.prevuSemisPepiniere === null ? {} : { semisPepiniere: l.prevuSemisPepiniere }),
      miseEnPlace: l.prevuMiseEnPlace,
      debutRecolte: l.prevuDebutRecolte,
      finRecolte: l.prevuFinRecolte,
    },
    taille,
    statut: l.statut,
    // Sans décision : clé absente, pas nulle (Serie.rotationAcceptee).
    ...(l.rotationAcceptee === null
      ? {}
      : { rotationAcceptee: { familleId: l.rotationAcceptee.famille, delaiAns: l.rotationAcceptee.delai_ans, le: Date.parse(l.rotationAcceptee.le) } }),
  };
}

// ---------------------------------------------------------------------------------------------
// Occupation
// ---------------------------------------------------------------------------------------------

export function ligneDepuisOccupation(o: Occupation): LigneOccupation {
  return {
    id: o.id,
    fermeId: o.fermeId,
    supprimeLe: versDate(o.supprimeLe),
    emplacementId: o.emplacementId,
    serieId: o.occupant.sorte === 'serie' ? o.occupant.serieId : null,
    plantationId: o.occupant.sorte === 'plantation' ? o.occupant.plantationId : null,
    evenementId: o.occupant.sorte === 'couverture' ? o.occupant.evenementId : null,
    longueurM: o.place.unite === 'longueur' ? o.place.longueurM : null,
    nombrePlaces: o.place.unite === 'places' ? o.place.nombrePlaces : null,
    positionM: o.positionM,
    prevuDu: o.prevuDu,
    prevuAu: o.prevuAu,
    reelDu: o.reel?.du ?? null,
    reelAu: o.reel?.au ?? null,
  };
}

export function occupationDepuisLigne(l: LigneOccupation): Occupation {
  let occupant: Occupation['occupant'];
  if (l.serieId !== null) {
    occupant = { sorte: 'serie', serieId: l.serieId };
  } else if (l.plantationId !== null) {
    occupant = { sorte: 'plantation', plantationId: l.plantationId };
  } else if (l.evenementId !== null) {
    occupant = { sorte: 'couverture', evenementId: l.evenementId };
  } else {
    throw new LigneInvalide('occupation', l.id, 'aucun occupant');
  }
  let place: Occupation['place'];
  if (l.longueurM !== null) {
    place = { unite: 'longueur', longueurM: l.longueurM };
  } else if (l.nombrePlaces !== null) {
    place = { unite: 'places', nombrePlaces: l.nombrePlaces };
  } else {
    throw new LigneInvalide('occupation', l.id, 'ni longueur ni nombre de places');
  }
  return {
    id: l.id,
    fermeId: l.fermeId,
    supprimeLe: versInstant(l.supprimeLe),
    emplacementId: l.emplacementId,
    occupant,
    place,
    positionM: l.positionM,
    prevuDu: l.prevuDu,
    prevuAu: l.prevuAu,
    reel: l.reelDu === null ? null : { du: l.reelDu, au: l.reelAu },
  };
}

// ---------------------------------------------------------------------------------------------
// Emplacement
// ---------------------------------------------------------------------------------------------

export function ligneDepuisEmplacement(e: Emplacement): LigneEmplacement {
  return {
    id: e.id,
    fermeId: e.fermeId,
    supprimeLe: versDate(e.supprimeLe),
    zoneId: e.zoneId,
    code: e.code,
    sorte: e.sorte,
    longueurM: e.longueurM,
    largeurM: e.largeurM,
    nombrePlaces: e.sorte === 'gouttiere' ? e.nombrePlaces : null,
    actifDu: e.actifDu,
    actifAu: e.actifAu,
    remplace: e.remplace,
    placementXM: e.placementXM,
    placementYM: e.placementYM,
    orientationDeg: e.orientationDeg,
  };
}

export function emplacementDepuisLigne(l: LigneEmplacement): Emplacement {
  const commun = {
    id: l.id,
    fermeId: l.fermeId,
    supprimeLe: versInstant(l.supprimeLe),
    zoneId: l.zoneId,
    code: l.code,
    longueurM: l.longueurM,
    largeurM: l.largeurM,
    actifDu: l.actifDu,
    actifAu: l.actifAu,
    remplace: l.remplace,
    placementXM: l.placementXM,
    placementYM: l.placementYM,
    orientationDeg: l.orientationDeg,
  };
  switch (l.sorte) {
    case 'planche':
      return { ...commun, sorte: 'planche' };
    case 'rang':
      return { ...commun, sorte: 'rang' };
    case 'gouttiere':
      if (l.nombrePlaces === null) {
        throw new LigneInvalide('emplacement', l.id, 'gouttière sans nombre de places');
      }
      return { ...commun, sorte: 'gouttiere', nombrePlaces: l.nombrePlaces };
    default:
      return verifierExhaustif(l.sorte);
  }
}

// ---------------------------------------------------------------------------------------------
// Evenement
// ---------------------------------------------------------------------------------------------

export function ligneDepuisEvenement(e: Evenement): LigneEvenement {
  return {
    id: e.id,
    fermeId: e.fermeId,
    type: e.type,
    date: e.date,
    horodatage: new Date(e.horodatage),
    auteurId: e.auteurId,
    source: e.source,
    serieId: e.culture?.sorte === 'serie' ? e.culture.serieId : null,
    campagneId: e.culture?.sorte === 'campagne' ? e.culture.campagneId : null,
    emplacementIds: e.emplacementIds,
    note: e.note,
    photos: e.photos,
    remplaceSorte: e.remplaceEvenement?.sorte ?? null,
    remplaceEvenementId: e.remplaceEvenement?.evenementId ?? null,
    detail: e.detail,
  };
}

export function evenementDepuisLigne(l: LigneEvenement): Evenement {
  let culture: Evenement['culture'] = null;
  if (l.serieId !== null) {
    culture = { sorte: 'serie', serieId: l.serieId };
  } else if (l.campagneId !== null) {
    culture = { sorte: 'campagne', campagneId: l.campagneId };
  }
  let remplaceEvenement: Evenement['remplaceEvenement'] = null;
  if (l.remplaceSorte !== null && l.remplaceEvenementId !== null) {
    remplaceEvenement = { sorte: l.remplaceSorte, evenementId: l.remplaceEvenementId };
  } else if (l.remplaceSorte !== null || l.remplaceEvenementId !== null) {
    throw new LigneInvalide('evenement', l.id, 'remplacement incomplet');
  }
  const commun = {
    id: l.id,
    fermeId: l.fermeId,
    date: l.date,
    horodatage: l.horodatage.getTime(),
    auteurId: l.auteurId,
    source: l.source,
    culture,
    emplacementIds: l.emplacementIds,
    note: l.note,
    photos: l.photos,
    remplaceEvenement,
  };
  // Le jsonb n'est pas lié au type par le typage de la ligne : on les réassocie ici.
  // Le contenu du détail est celui que le client a écrit, validé par l'API (T10).
  type Detail<T extends Evenement['type']> = Extract<Evenement, { type: T }>['detail'];
  switch (l.type) {
    case 'realise':
      return { ...commun, type: l.type, detail: l.detail as Detail<'realise'> };
    case 'recolte':
      return { ...commun, type: l.type, detail: l.detail as Detail<'recolte'> };
    case 'intervention':
      return { ...commun, type: l.type, detail: l.detail as Detail<'intervention'> };
    case 'irrigation':
      return { ...commun, type: l.type, detail: l.detail as Detail<'irrigation'> };
    case 'traitement':
      return { ...commun, type: l.type, detail: l.detail as Detail<'traitement'> };
    case 'observation':
      return { ...commun, type: l.type, detail: l.detail as Detail<'observation'> };
    default:
      return verifierExhaustif(l.type);
  }
}
