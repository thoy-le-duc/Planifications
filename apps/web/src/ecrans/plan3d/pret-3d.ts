/**
 * T77 — quand la vue 3D se dit « prête » (data-etat="pret", lu par les e2e et par l'écran).
 * La couche des plants (T71) arrive après la première image ; poser les plants en pleine mesure
 * d'un changement de semaine faussait les temps. La vue n'est donc prête qu'une fois la couche
 * chargée et ses plants posés, ou en échec (la vue reste utilisable sans plants), ou sans base à
 * lire (aucune couche à attendre). Pur : testable sans WebGL.
 */

export type EtatCouche = 'sans' | 'attendue' | 'chargee' | 'echec';

/** Où en est la couche des plants : base absente, en chargement, arrivée ou en échec (chargée prime : plan relu). */
export function etatDeLaCouche(e: { readonly aUneBase: boolean; readonly chargee: boolean; readonly echec: boolean }): EtatCouche {
  if (!e.aUneBase) return 'sans';
  if (e.chargee) return 'chargee';
  return e.echec ? 'echec' : 'attendue';
}

export function vueEstPrete(e: { readonly premiereImage: boolean; readonly couche: EtatCouche; readonly plantsPoses: boolean }): boolean {
  if (!e.premiereImage) return false;
  return e.couche === 'chargee' ? e.plantsPoses : e.couche !== 'attendue';
}
