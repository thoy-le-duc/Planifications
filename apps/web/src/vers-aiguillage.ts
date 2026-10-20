/**
 * T66 — accès au morceau d'aiguillage (./aiguillage.ts) depuis le JavaScript de démarrage : les
 * écrans, la base locale, la préparation des écrans et l'enregistrement du service worker passent
 * par lui. Le morceau d'entrée n'importe à la demande que lui et l'aide de préchargement complète
 * (src/prechargement/charger-complet.ts), demandée en même temps. Une fois (nouvel essai après un
 * échec).
 */
import { chargerComplet } from './prechargement/charger-complet.ts';

export type Aiguillage = typeof import('./aiguillage.ts');

let enCours: Promise<Aiguillage> | null = null;

/**
 * L'aiguillage, et avec lui (en parallèle) l'aide de préchargement complète : chaque écran a des
 * fichiers à précharger, l'aide est là avant le premier.
 */
export function chargerAiguillage(): Promise<Aiguillage> {
  return (enCours ??= Promise.all([import('./aiguillage.ts'), chargerComplet()]).then(
    ([aiguillage]) => aiguillage,
    (erreur: unknown) => {
      enCours = null;
      throw erreur;
    },
  ));
}

/** Les chargeurs de l'aiguillage : ceux qui ne prennent pas d'argument. */
type Chargeur = { [N in keyof Aiguillage]: Aiguillage[N] extends () => Promise<unknown> ? N : never }[keyof Aiguillage];

/** Import d'un module par l'aiguillage : `vers('planches')` charge l'écran Planches. */
export function vers<N extends Chargeur>(nom: N): Promise<Awaited<ReturnType<Aiguillage[N]>>> {
  return chargerAiguillage().then((a) => (a[nom] as () => Promise<Awaited<ReturnType<Aiguillage[N]>>>)());
}
