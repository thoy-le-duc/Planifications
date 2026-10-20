/**
 * Contrat de `packages/core/src/irrigation` (T57, docs/backlog/T57-vannes-irrigation.md) : les
 * règles déterministes des vannes d'irrigation, que l'écran « Vannes », la porte du téléphone et
 * le serveur rejouent. Module exposé par le sous-chemin `@planif/core/irrigation` et réexporté par
 * `@planif/core`. Pur : ni base, ni réseau, ni horloge ; aucune fonction ne lève.
 *
 * Le module est chargé dynamiquement (`chargerIrrigation`) : tant qu'il n'existe pas, les tests
 * échouent sur « n'exporte pas encore » au lieu de casser le typage du dépôt.
 *
 * ── Vannes ──────────────────────────────────────────────────────────────────────────────────
 *
 *   vannesDuLot({ nombre, prefixe }, numerosPris): Resultat<VanneDuLot[]>
 * « 60 vannes, V1 à V60 » : les `nombre` plus petits entiers ≥ 1 ABSENTS de `numerosPris`,
 * croissants ; nom = préfixe (espaces autour retirés) + numéro (« V12 »). Préfixe vide : « Vanne »
 * suivi d'une espace (« Vanne 12 »). Refus (message en français) : nombre non entier, < 1 ou >
 * PLAFONDS_VANNES.lotMax (200) ; numéro qui dépasserait PLAFONDS_VANNES.numeroMax (9 999) ; préfixe
 * de plus de 20 caractères.
 *
 *   validerVanne({ numeroVanne, nom, debitLitresHeure }, numerosPris): Resultat<SaisieVanne>
 * Numéro entier de 1 à 9 999, absent de `numerosPris` (« ce numéro de vanne existe déjà ») ; nom
 * non vide (espaces autour retirés) de 200 caractères au plus ; débit nul ou nombre fini > 0 et ≤
 * 1 000 000 L/h. Rend la saisie nettoyée (nom sans espaces autour).
 *
 *   validerPositionVanne(x, y): Resultat<{ x, y } | null>
 * Position d'une vanne posée sur le plan, dans le repère de la ferme (mètres) : les deux nulles
 * (pas placée) ou deux nombres finis, à 5 000 m au plus de l'origine (DISTANCE_MAX_ORIGINE_M).
 *
 * ── Liens datés vanne ↔ emplacements ────────────────────────────────────────────────────────
 *
 * Un lien (`secteur_emplacement`) dit qu'une vanne arrose un emplacement du jour `du` au jour `au`
 * compris (`au` nul : toujours). Il est actif le jour J si du ≤ J et (au nul ou au ≥ J).
 *
 *   emplacementsArroses(liens, secteurId, jour): string[]
 * Ids des emplacements arrosés par la vanne ce jour-là (liens actifs), dans l'ordre des liens,
 * sans doublon. Les liens d'autres vannes ne comptent pas.
 *
 *   changerLiens(liens, secteurId, voulus, jour): ChangementLiens
 * Ce qu'il faut écrire pour que, à partir de `jour`, la vanne arrose exactement `voulus` (ids, dans
 * l'ordre donné), en GARDANT l'historique :
 *   - lien actif le jour J (ou qui commence après J) dont l'emplacement n'est plus voulu :
 *       commencé avant J        → `fermer` { id, au: veille de J } (son passé reste) ;
 *       commencé J ou après     → `supprimer` id (il n'a aucun passé à garder) ;
 *   - emplacement voulu sans lien actif le jour J → `creer` (le lien neuf part de J, au nul) ;
 *   - le reste ne bouge pas (un lien déjà actif et voulu n'est pas recréé) ; les liens d'autres
 *     vannes et les liens déjà finis avant J ne sont jamais touchés.
 * `fermer` et `supprimer` dans l'ordre des liens, `creer` dans l'ordre de `voulus`.
 *
 * ── Dernière irrigation ─────────────────────────────────────────────────────────────────────
 *
 *   dernieresIrrigations(irrigations, liens): Map<emplacementId, Irrigation>
 * Pour chaque emplacement, la plus récente des irrigations (date, puis horodatage, puis id) dont la
 * vanne l'arrosait LE JOUR DE L'IRRIGATION (lien actif à `irrigation.date`) : changer le réseau ne
 * réécrit pas le passé. Les irrigations reçues sont celles en vigueur (l'appelant a retiré les
 * annulées et les corrigées).
 *
 *   derniereIrrigationDe(irrigations, secteurId): Irrigation | null — même ordre, une seule vanne.
 *
 *   classeIrrigation(date | null, aujourdhui): 'aujourdhui' | 'hier' | 'ancienne' | 'jamais'
 * Date de la dernière irrigation comparée au jour du téléphone : égale → 'aujourdhui' ; la veille →
 * 'hier' ; avant → 'ancienne' ; nulle → 'jamais'. Une date À VENIR (saisie datée de demain) compte
 * comme 'aujourdhui' : elle n'est pas plus ancienne.
 */

export const CHEMIN_IRRIGATION = '../index.ts';

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly message: string };

export interface VanneDuLot {
  readonly numeroVanne: number;
  readonly nom: string;
}

export interface SaisieVanne {
  readonly numeroVanne: number;
  readonly nom: string;
  readonly debitLitresHeure: number | null;
}

export interface LienVanne {
  readonly id: string;
  readonly secteurId: string;
  readonly emplacementId: string;
  readonly du: string;
  readonly au: string | null;
}

export interface ChangementLiens {
  readonly fermer: readonly { readonly id: string; readonly au: string }[];
  readonly supprimer: readonly string[];
  readonly creer: readonly string[];
}

export interface Irrigation {
  readonly id: string;
  readonly secteurId: string;
  readonly date: string;
  readonly horodatage: string;
  readonly dureeMinutes: number;
}

export type ClasseIrrigation = 'aujourdhui' | 'hier' | 'ancienne' | 'jamais';

export interface ModuleIrrigation {
  readonly PLAFONDS_VANNES: { readonly numeroMax: number; readonly lotMax: number; readonly debitLitresHeureMax: number; readonly nomCaracteres: number };
  vannesDuLot(entree: { readonly nombre: number; readonly prefixe: string }, numerosPris: readonly number[]): Resultat<readonly VanneDuLot[]>;
  validerVanne(v: SaisieVanne, numerosPris: readonly number[]): Resultat<SaisieVanne>;
  validerPositionVanne(x: unknown, y: unknown): Resultat<{ readonly x: number; readonly y: number } | null>;
  lienActifLe(l: LienVanne, jour: string): boolean;
  emplacementsArroses(liens: readonly LienVanne[], secteurId: string, jour: string): string[];
  changerLiens(liens: readonly LienVanne[], secteurId: string, voulus: readonly string[], jour: string): ChangementLiens;
  dernieresIrrigations(irrigations: readonly Irrigation[], liens: readonly LienVanne[]): ReadonlyMap<string, Irrigation>;
  derniereIrrigationDe(irrigations: readonly Irrigation[], secteurId: string): Irrigation | null;
  classeIrrigation(date: string | null, aujourdhui: string): ClasseIrrigation;
}

export async function chargerIrrigation(): Promise<ModuleIrrigation> {
  const m = (await import(/* @vite-ignore */ CHEMIN_IRRIGATION)) as Partial<ModuleIrrigation>;
  for (const nom of ['vannesDuLot', 'validerVanne', 'validerPositionVanne', 'lienActifLe', 'emplacementsArroses', 'changerLiens', 'dernieresIrrigations', 'derniereIrrigationDe', 'classeIrrigation'] as const) {
    if (typeof m[nom] !== 'function') throw new Error(`src/irrigation n’exporte pas encore ${nom}`);
  }
  return m as ModuleIrrigation;
}
