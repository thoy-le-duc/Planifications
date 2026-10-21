/**
 * Jour du téléphone (T13), dans un module à part et sans dépendance : l'écran Aujourd'hui et la
 * saisie d'un traitement (T78, morceau chargé à la demande) lisent le même jour local.
 */
const deux = (n: number) => String(n).padStart(2, '0');

/** Jour du téléphone, 'AAAA-MM-JJ' (heure locale, pas UTC). */
export function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}
