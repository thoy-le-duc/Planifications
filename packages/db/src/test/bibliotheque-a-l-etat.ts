/**
 * T51 : les tests d'un ticket de bibliothèque (T41, T42, T42b, T43) portent sur les lignes de SA
 * migration. Quand une migration suivante AJOUTE des lignes au JSON (T51 : Rosacées, fraise,
 * « Fraise hors-sol en gouttière »), ils lisent le JSON du dépôt réduit aux lignes de l'état de
 * leur migration : les valeurs restent celles du JSON courant, les lignes ajoutées depuis ont
 * leurs propres tests.
 */
import * as db from '../index.ts';

/** Dernier état de bibliothèque avant T51. */
export const ETAT_AVANT_T51 = '0036_bibliotheque_ecart_entre_rangs';

function etat(migration: string): db.LignesBibliotheque {
  const e = db.lireEtatsBibliotheque().find((x) => x.migration === migration);
  if (e === undefined) throw new Error(`état de bibliothèque ${migration} absent`);
  return e.lignes;
}

/** Le JSON du dépôt, réduit aux familles, espèces et itinéraires présents dans l'état `migration`. */
export function sourceALEtat(migration: string = ETAT_AVANT_T51): db.SourceBibliotheque {
  const source = db.lireBibliothequeDepart();
  const lignes = db.convertirBibliotheque(source);
  const e = etat(migration);
  const garder = <T>(liste: readonly T[], ids: readonly { readonly id: string }[], dans: readonly { readonly id: string }[]): T[] => {
    const connus = new Set(dans.map((x) => x.id));
    return liste.filter((_, i) => connus.has(ids[i]?.id ?? ''));
  };
  return {
    ...source,
    familles: garder(source.familles, lignes.familles, e.familles),
    especes: garder(source.especes, lignes.especes, e.especes),
    itineraires: garder(source.itineraires, lignes.itineraires, e.itineraires),
  };
}

/** Les lignes de l'état `migration`. */
export const lignesALEtat = (migration: string = ETAT_AVANT_T51): db.LignesBibliotheque => etat(migration);
