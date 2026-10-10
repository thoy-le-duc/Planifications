/**
 * Contrat de T32e (docs/backlog/T32e-recolte-visible.md ; Q34, Q35) : l'état de récolte d'une
 * occupation, calcul PUR du cœur, à côté de `croissanceA` (T32a). Ajouté à `croissance/index.ts`
 * (donc à `@planif/core` et à `@planif/core/croissance`). Ni base, ni réseau, ni IA, ni horloge :
 * le jour est un argument. Les tests chargent le module par import dynamique (chemin tenu dans
 * une variable) : tant que les exports manquent, ils échouent sur « n'exporte pas encore ».
 *
 * ── Types ────────────────────────────────────────────────────────────────────────────────────
 *
 *   PhaseRecolte = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte'
 *   EtatRecolte  = { phase: PhaseRecolte; maturite: number }
 *   PHASES_RECOLTE: readonly PhaseRecolte[]      les quatre phases, dans cet ordre
 *
 * maturite : nombre dans [0, 1] ; 0 en phase 'aucune' ; croît linéairement de 0 à 1 pendant
 * 'fruits-en-formation' ; vaut 1 en 'a-recolter' et en 'fin-de-recolte'. Pas d'arrondi.
 *
 * ── Constantes (exportées, nommées) ──────────────────────────────────────────────────────────
 *
 *   JOURS_FORMATION_FRUITS: entier dans [7, 42]   durée de la formation des fruits avant le début de récolte
 *   JOURS_FIN_RECOLTE:      entier dans [7, 28]   « dernières semaines » de la fenêtre de récolte
 *
 * ── recolteA(dates: DatesCroissance, jour: DateCalendaire): EtatRecolte ──────────────────────
 *
 * Culture ANNUELLE (occupation d'une série). Mêmes repères que `croissanceA` : M mise en place,
 * B début de récolte, F fin de récolte, A arrachage ; pour chacun la date RÉELLE, si elle est
 * remplie, remplace la PRÉVUE. N = JOURS_FORMATION_FRUITS, Nf = JOURS_FIN_RECOLTE. Écarts en
 * jours entiers (dates calendaires, sans fuseau). Rien n'est inventé sans date :
 *   - B inconnue (même avec F connue)                  → { phase: 'aucune', maturite: 0 }
 *   - M connue et jour < M, ou A connue et jour ≥ A     → 'aucune' (la plante n'est pas là)
 *   - jour dans [B − N, B[                              → 'fruits-en-formation',
 *                                                          maturite = (jour − (B − N)) / N  (0 le premier jour, < 1 la veille de B)
 *   - jour dans [B, F − Nf[                             → 'a-recolter', maturite 1
 *   - jour dans [F − Nf, A[  (A inconnue : sans fin)    → 'fin-de-recolte', maturite 1
 *       (F connue ; la plante reste en place entre la fin de récolte et l'arrachage)
 *   - B connue, F inconnue                              → 'a-recolter' de B à A (pas de fin inventée)
 *   Fenêtre de récolte plus courte que Nf : non spécifié (les tests ne s'y aventurent pas).
 *
 * ── recoltePerenneA(entree: EntreePerenne, jour: DateCalendaire): EtatRecolte ────────────────
 *
 * PÉRENNE à récolte annuelle (fraise, asperge, kiwi…), même entrée que `croissancePerenneA`.
 * `campagne` = la campagne de l'année du jour. Y = année de `jour`.
 *   - jour < datePlantation, ou dateArrachage connue et jour ≥ dateArrachage → 'aucune'
 *   - campagne null, ou campagne.annee ≠ Y, ou debutRecolte null                → 'aucune'
 *     (la période de récolte est annuelle : l'an prochain sans campagne, rien)
 *   - sinon B = campagne.debutRecolte, F = campagne.finRecolte, mêmes intervalles que ci-dessus :
 *     [B − N, B[ formation, [B, F − Nf[ à récolter, [F − Nf, F[ fin de récolte ; F inconnue : 'a-recolter' dès B.
 *     À partir de F (même année) : non spécifié (les tests ne s'y aventurent pas).
 *   Chaque année avec campagne, le cycle recommence.
 *
 * Même entrée, même sortie ; l'entrée n'est jamais modifiée ; aucune exception.
 */
import type { DateCalendaire } from '../../dates/index.ts';
import type { DatesCroissance, EntreePerenne } from './contrat.ts';

export type { DateCalendaire, DatesCroissance, EntreePerenne };

export type PhaseRecolte = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte';

export interface EtatRecolte {
  readonly phase: PhaseRecolte;
  readonly maturite: number;
}

export interface ModuleRecolte {
  readonly PHASES_RECOLTE: readonly PhaseRecolte[];
  readonly JOURS_FORMATION_FRUITS: number;
  readonly JOURS_FIN_RECOLTE: number;
  recolteA(dates: DatesCroissance, jour: DateCalendaire): EtatRecolte;
  recoltePerenneA(entree: EntreePerenne, jour: DateCalendaire): EtatRecolte;
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export const ATTENDUS_RECOLTE = ['PHASES_RECOLTE', 'JOURS_FORMATION_FRUITS', 'JOURS_FIN_RECOLTE', 'recolteA', 'recoltePerenneA'] as const satisfies readonly (keyof ModuleRecolte)[];

/** Le module de récolte, ou une erreur claire qui nomme les exports manquants. */
export async function chargerRecolte(): Promise<ModuleRecolte> {
  const m = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleRecolte>;
  const manquants = ATTENDUS_RECOLTE.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T32e)`);
  return m as ModuleRecolte;
}
