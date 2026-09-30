/**
 * Données du plan déjà lues, par porte et par ferme (T11). Lire la ferme entière (400
 * emplacements, 3 000 occupations) prend près d'une seconde sur un téléphone moyen, bien plus que
 * les 300 ms du budget. D'où deux étages :
 *   - le début (les lignes des premières zones, avec toutes les occupations de leurs
 *     emplacements : exactes) se lit dès que la base est ouverte (`prechargerPlan`) : un tap sur
 *     « Planches » l'affiche tout de suite ;
 *   - la ferme entière se lit ensuite, une fois l'écran affiché, et remplace le début.
 * Les lignes lues ne dépendent pas de la saison : changer de saison ne relit rien, le plan se
 * recalcule. Tout changement des tables lues (saisie locale ou synchro) oublie ce qui est en
 * cache et prévient les écrans ouverts, qui relisent.
 */
import type { PorteDonnees } from '@planif/sync';
import { chargerSaisons, construirePlan, lireDebutDePlan, lireDonneesPlan, saisonParDefaut, type DonneesPlan, type Plan, type SaisonPlan } from './calculs.ts';

/** Tables dont le plan dépend. */
const TABLES_DU_PLAN = ['saison', 'zone', 'emplacement', 'occupation', 'serie', 'plantation', 'espece', 'variete', 'famille'] as const;

/** Emplacements lus pour le début du plan : de quoi remplir la vue d'un téléphone. */
export const EMPLACEMENTS_DU_DEBUT = 12;

/** Plan affichable : complet, ou son début (les lignes des premières zones, exactes). */
export interface PlanLu {
  readonly plan: Plan;
  readonly complet: boolean;
}

interface Entree<T> {
  readonly promesse: Promise<T>;
  valeur: T | null;
}

interface CacheFerme {
  saisons: Entree<SaisonPlan[]> | null;
  debut: Entree<DonneesPlan> | null;
  tout: Entree<DonneesPlan> | null;
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
    const neuf: CacheFerme = { saisons: null, debut: null, tout: null, plans: new WeakMap(), abonnes: new Set() };
    cache = neuf;
    parFerme.set(fermeId, neuf);
    // Premier appel tout de suite (rien n'a changé) : ignoré ; ensuite, chaque changement vide
    // le cache et prévient les écrans ouverts.
    let premier = true;
    porte.surveiller({ sql: 'SELECT 1 AS temoin', tables: TABLES_DU_PLAN }, () => {
      if (premier) {
        premier = false;
        return;
      }
      neuf.saisons = null;
      neuf.debut = null;
      neuf.tout = null;
      for (const rappel of [...neuf.abonnes]) rappel();
    });
  }
  return cache;
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

function lire(porte: PorteDonnees, fermeId: string, etage: 'debut' | 'tout'): Promise<DonneesPlan> {
  const cache = cacheDe(porte, fermeId);
  const e =
    cache[etage] ??
    retenir(
      () => (etage === 'debut' ? lireDebutDePlan(porte, fermeId, EMPLACEMENTS_DU_DEBUT) : lireDonneesPlan(porte, fermeId)),
      (x) => {
        if (cache[etage] === x) cache[etage] = null;
      },
    );
  cache[etage] = e;
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

/** Début du plan de la saison (lignes des premières zones, exactes). */
export async function obtenirDebutDePlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu> {
  const donnees = await lire(porte, fermeId, 'debut');
  return { plan: planDe(cacheDe(porte, fermeId), donnees, saison, aujourdhui), complet: false };
}

/** Plan complet de la saison. */
export async function obtenirPlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu> {
  const donnees = await lire(porte, fermeId, 'tout');
  return { plan: planDe(cacheDe(porte, fermeId), donnees, saison, aujourdhui), complet: true };
}

/** Le plan le plus complet que les données déjà lues permettent, ou null. */
export function planEnCache(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): PlanLu | null {
  const cache = cacheDe(porte, fermeId);
  const tout = cache.tout?.valeur ?? null;
  if (tout !== null) return { plan: planDe(cache, tout, saison, aujourdhui), complet: true };
  const debut = cache.debut?.valeur ?? null;
  return debut === null ? null : { plan: planDe(cache, debut, saison, aujourdhui), complet: false };
}

/** Appelle `rappel` quand les données du plan changent ; rend le désabonnement. */
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
  const debut = lire(porte, fermeId, 'debut');
  const saison = saisonParDefaut(await obtenirSaisons(porte, fermeId), aujourdhui);
  await debut;
  if (saison !== null) await obtenirDebutDePlan(porte, fermeId, saison, aujourdhui);
}
