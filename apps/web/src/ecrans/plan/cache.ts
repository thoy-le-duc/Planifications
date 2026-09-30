/**
 * Données du plan déjà lues, par porte et par ferme (T11). Lire la ferme entière (400
 * emplacements, 3 000 occupations) prend près d'une seconde sur un téléphone moyen, bien plus que
 * les 300 ms du budget. D'où deux étages :
 *   - le début (les lignes des premières zones, avec toutes les occupations de leurs
 *     emplacements : exactes) se lit dès que la base est ouverte (`prechargerPlan`) : un tap sur
 *     « Planches » l'affiche tout de suite ;
 *   - la ferme entière se lit ensuite, une fois l'écran affiché, et remplace le début.
 * Les lignes lues ne dépendent pas de la saison : changer de saison ne relit rien, le plan se
 * recalcule.
 *
 * Changement des tables lues (saisie locale ou synchro) : la ferme entière est relue ici, puis
 * les écrans ouverts sont prévenus et prennent le plan relu, complet. Pendant la relecture, ils
 * gardent le plan affiché (jamais le début : pas de retour en haut ni de clignotement). Les
 * changements rapprochés sont regroupés : une relecture attend CALME_MS sans changement (une
 * synchro arrive en rafale), ATTENTE_MAX_MS au plus après le premier changement non relu ; deux
 * relectures commencent à au moins ESPACEMENT_RELECTURES_MS d'écart, une seule à la fois, et un
 * changement arrivé pendant l'une en relance une après elle (la dernière voit le dernier
 * changement).
 */
import type { PorteDonnees } from '@planif/sync';
import {
  chargerSaisons,
  construirePlan,
  lireDebutDePlan,
  lireDonneesPlan,
  saisonParDefaut,
  type DonneesDebutDePlan,
  type DonneesPlan,
  type Plan,
  type SaisonPlan,
} from './calculs.ts';

/** Tables dont le plan dépend. */
const TABLES_DU_PLAN = ['saison', 'zone', 'emplacement', 'occupation', 'serie', 'plantation', 'espece', 'variete', 'famille'] as const;

/** Emplacements lus pour le début du plan : de quoi remplir la vue d'un téléphone. */
export const EMPLACEMENTS_DU_DEBUT = 12;

/** Écart minimal entre le début de deux relectures après changement (synchro en rafale). */
export const ESPACEMENT_RELECTURES_MS = 300;
/** Silence attendu après un changement avant de relire (fin de la rafale). */
export const CALME_MS = 150;
/** Délai maximal entre un changement et le début de sa relecture, même si la rafale continue. */
export const ATTENTE_MAX_MS = 1_000;

/** Plan affichable : complet, ou son début (les lignes des premières zones, exactes). */
export interface PlanLu {
  readonly plan: Plan;
  readonly complet: boolean;
  /**
   * Nombre de lignes du plan complet : l'écran réserve leur hauteur dès le début, pour que le
   * défilement ne bute pas sur la fin du début pendant que le reste se lit.
   */
  readonly totalLignes: number;
}

interface Entree<T> {
  readonly promesse: Promise<T>;
  valeur: T | null;
}

interface CacheFerme {
  saisons: Entree<SaisonPlan[]> | null;
  debut: Entree<DonneesDebutDePlan> | null;
  tout: Entree<DonneesPlan> | null;
  /** Ferme entière lue avant le dernier changement : montrée tant que la relecture n'a pas abouti. */
  ancien: DonneesPlan | null;
  /** Changement pas encore relu. */
  sale: boolean;
  /** Premier et dernier changement pas encore relus (performance.now). */
  premierChangement: number;
  dernierChangement: number;
  enRelecture: boolean;
  minuterie: ReturnType<typeof setTimeout> | null;
  /** Début de la dernière relecture (performance.now), -Infinity si aucune. */
  derniere: number;
  /** Plans calculés, par données lues puis par saison et jour. */
  readonly plans: WeakMap<DonneesPlan, Map<string, Plan>>;
  readonly abonnes: Set<() => void>;
}

const caches = new WeakMap<PorteDonnees, Map<string, CacheFerme>>();

/** Promesse retenue avec sa valeur ; oubliée si elle échoue (le prochain affichage réessaiera). */
function retenir<T>(lire: () => Promise<T>, oublier: (e: Entree<T>) => void): Entree<T> {
  const promesse = lire();
  const e: Entree<T> = { promesse, valeur: null };
  promesse.then(
    (v) => {
      e.valeur = v;
    },
    () => {
      oublier(e);
    },
  );
  return e;
}

function cacheDe(porte: PorteDonnees, fermeId: string): CacheFerme {
  let parFerme = caches.get(porte);
  if (parFerme === undefined) {
    parFerme = new Map();
    caches.set(porte, parFerme);
  }
  let cache = parFerme.get(fermeId);
  if (cache === undefined) {
    const neuf: CacheFerme = {
      saisons: null,
      debut: null,
      tout: null,
      ancien: null,
      sale: false,
      premierChangement: 0,
      dernierChangement: 0,
      enRelecture: false,
      minuterie: null,
      derniere: Number.NEGATIVE_INFINITY,
      plans: new WeakMap(),
      abonnes: new Set(),
    };
    cache = neuf;
    parFerme.set(fermeId, neuf);
    // Premier appel tout de suite (rien n'a changé) : ignoré ; ensuite, chaque changement fait
    // relire la ferme (regroupé, voir planifierRelecture).
    let premier = true;
    porte.surveiller({ sql: 'SELECT 1 AS temoin', tables: TABLES_DU_PLAN }, () => {
      if (premier) {
        premier = false;
        return;
      }
      const maintenant = performance.now();
      if (!neuf.sale) neuf.premierChangement = maintenant;
      neuf.sale = true;
      neuf.dernierChangement = maintenant;
      planifierRelecture(porte, fermeId, neuf);
    });
  }
  return cache;
}

/**
 * (Re)programme la relecture : après CALME_MS de silence (ATTENTE_MAX_MS au plus après le premier
 * changement non relu), jamais moins de ESPACEMENT_RELECTURES_MS après le début de la précédente,
 * une à la fois.
 */
function planifierRelecture(porte: PorteDonnees, fermeId: string, cache: CacheFerme): void {
  if (!cache.sale || cache.enRelecture) return;
  if (cache.minuterie !== null) clearTimeout(cache.minuterie);
  const quand = Math.max(
    Math.min(cache.dernierChangement + CALME_MS, cache.premierChangement + ATTENTE_MAX_MS),
    cache.derniere + ESPACEMENT_RELECTURES_MS,
  );
  const delai = Math.max(0, quand - performance.now());
  cache.minuterie = setTimeout(() => {
    cache.minuterie = null;
    relire(porte, fermeId, cache);
  }, delai);
}

function relire(porte: PorteDonnees, fermeId: string, cache: CacheFerme): void {
  cache.sale = false;
  cache.derniere = performance.now();
  // Ce qui était lu est périmé ; la ferme entière déjà lue reste montrable jusqu'à la relecture.
  cache.ancien = cache.tout?.valeur ?? cache.ancien;
  cache.saisons = null;
  cache.debut = null;
  cache.tout = null;
  if (cache.abonnes.size === 0) {
    // Aucun écran ouvert : rien à relire maintenant, le prochain affichage lira.
    cache.ancien = null;
    return;
  }
  cache.enRelecture = true;
  void Promise.allSettled([obtenirSaisons(porte, fermeId), lireTout(porte, fermeId)])
    .then(([, tout]) => {
      if (tout.status === 'fulfilled') cache.ancien = null;
      else console.error('Plan illisible après un changement', tout.reason);
      for (const rappel of [...cache.abonnes]) rappel();
    })
    .finally(() => {
      cache.enRelecture = false;
      planifierRelecture(porte, fermeId, cache);
    });
}

/** Saisons de la ferme, lues une fois tant que rien ne change. */
export function obtenirSaisons(porte: PorteDonnees, fermeId: string): Promise<SaisonPlan[]> {
  const cache = cacheDe(porte, fermeId);
  cache.saisons ??= retenir(
    () => chargerSaisons(porte, fermeId),
    (e) => {
      if (cache.saisons === e) cache.saisons = null;
    },
  );
  return cache.saisons.promesse;
}

export function saisonsEnCache(porte: PorteDonnees, fermeId: string): SaisonPlan[] | null {
  return cacheDe(porte, fermeId).saisons?.valeur ?? null;
}

function lireDebut(porte: PorteDonnees, fermeId: string): Promise<DonneesDebutDePlan> {
  const cache = cacheDe(porte, fermeId);
  const e =
    cache.debut ??
    retenir(
      () => lireDebutDePlan(porte, fermeId, EMPLACEMENTS_DU_DEBUT),
      (x) => {
        if (cache.debut === x) cache.debut = null;
      },
    );
  cache.debut = e;
  return e.promesse;
}

function lireTout(porte: PorteDonnees, fermeId: string): Promise<DonneesPlan> {
  const cache = cacheDe(porte, fermeId);
  const e =
    cache.tout ??
    retenir(
      () => lireDonneesPlan(porte, fermeId),
      (x) => {
        if (cache.tout === x) cache.tout = null;
      },
    );
  cache.tout = e;
  return e.promesse;
}

/** Plan de la saison sur ces données, calculé une fois. */
function planDe(cache: CacheFerme, donnees: DonneesPlan, saison: SaisonPlan, aujourdhui: string): Plan {
  let parSaison = cache.plans.get(donnees);
  if (parSaison === undefined) {
    parSaison = new Map();
    cache.plans.set(donnees, parSaison);
  }
  const cle = `${saison.id}|${saison.debut}|${saison.fin}|${aujourdhui}`;
  let plan = parSaison.get(cle);
  if (plan === undefined) {
    plan = construirePlan(donnees, { saison, aujourdhui });
    parSaison.set(cle, plan);
  }
  return plan;
}

function complet(cache: CacheFerme, donnees: DonneesPlan, saison: SaisonPlan, aujourdhui: string): PlanLu {
  const plan = planDe(cache, donnees, saison, aujourdhui);
  return { plan, complet: true, totalLignes: plan.lignes.length };
}

function debutDe(cache: CacheFerme, donnees: DonneesDebutDePlan, saison: SaisonPlan, aujourdhui: string): PlanLu {
  const plan = planDe(cache, donnees, saison, aujourdhui);
  // Lignes du plan complet : celles du plan construit sur la structure seule (calculé une fois).
  const totalLignes = planDe(cache, donnees.structure, saison, aujourdhui).lignes.length;
  return { plan, complet: false, totalLignes: Math.max(totalLignes, plan.lignes.length) };
}

/** Début du plan de la saison (lignes des premières zones, exactes). */
export async function obtenirDebutDePlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu> {
  const donnees = await lireDebut(porte, fermeId);
  return debutDe(cacheDe(porte, fermeId), donnees, saison, aujourdhui);
}

/** Plan complet de la saison. */
export async function obtenirPlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu> {
  const donnees = await lireTout(porte, fermeId);
  return complet(cacheDe(porte, fermeId), donnees, saison, aujourdhui);
}

/**
 * Le plan le plus complet que les données déjà lues permettent, ou null. Pendant une relecture,
 * la ferme entière lue avant le changement (complète, bientôt remplacée).
 */
export function planEnCache(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): PlanLu | null {
  const cache = cacheDe(porte, fermeId);
  const tout = cache.tout?.valeur ?? cache.ancien;
  if (tout !== null) return complet(cache, tout, saison, aujourdhui);
  const debut = cache.debut?.valeur ?? null;
  return debut === null ? null : debutDe(cache, debut, saison, aujourdhui);
}

/**
 * Appelle `rappel` quand les données du plan ont changé et que la ferme entière a été relue
 * (planEnCache rend alors le plan à jour) ; rend le désabonnement.
 */
export function surChangement(porte: PorteDonnees, fermeId: string, rappel: () => void): () => void {
  const cache = cacheDe(porte, fermeId);
  cache.abonnes.add(rappel);
  return () => {
    cache.abonnes.delete(rappel);
  };
}

/**
 * Prépare le début du plan de la saison par défaut (base ouverte, avant le premier tap sur
 * « Planches ») : saisons et lignes du début lues ensemble, plan calculé.
 */
export async function prechargerPlan(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<void> {
  const debut = lireDebut(porte, fermeId);
  const saison = saisonParDefaut(await obtenirSaisons(porte, fermeId), aujourdhui);
  await debut;
  if (saison !== null) await obtenirDebutDePlan(porte, fermeId, saison, aujourdhui);
}
