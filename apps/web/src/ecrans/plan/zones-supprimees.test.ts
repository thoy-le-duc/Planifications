/**
 * Tests d'acceptation T11b — zones supprimées (règle 3) et hauteur réservée pendant le début du
 * plan (règle 5). Contrat : ./test/contrat-t11b.ts.
 *
 * Règle 3 : une zone dont `supprime_le` n'est pas nul n'existe plus pour le plan, ni ses planches
 * (même non supprimées elles-mêmes). `lireDonneesPlan`, `lireDebutDePlan` (début et structure
 * réservée) ne les rendent pas, et aucun plan construit dessus n'a de ligne pour elles.
 *
 * Règle 5 : la hauteur réservée pendant le début (totalLignes) égale celle du plan complet, pour
 * toutes les saisons : zone sans emplacement actif et emplacement inactif n'ont pas de ligne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { DonneesPlan, Plan } from './test/contrat.ts';
import {
  CODES_SUPPRIMES,
  E11B,
  FERME,
  NOMS_ZONES_SUPPRIMEES,
  O11B,
  SAISONS,
  Z11B,
  remplirFermeT11b,
  type ModuleCachePlan,
  type ModuleCalculsT11b,
} from './test/contrat-t11b.ts';

const CHEMIN_CALCULS = './calculs.ts';
const CHEMIN_CACHE = './cache.ts';

const AUJOURDHUI = '2026-09-30';
const IDS_ZONES_SUPPRIMEES: readonly string[] = [Z11B.supprimee, Z11B.chapelleSupprimee];
const IDS_EMPLACEMENTS_SUPPRIMES: readonly string[] = [E11B.anciensP1, E11B.anciensP2, E11B.chapelleSupprimeeP1];

let calculs: ModuleCalculsT11b;
let cache: ModuleCachePlan;
let base: BaseMemoire;
let porte: PorteDonnees;

beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsT11b;
  cache = (await import(/* @vite-ignore */ CHEMIN_CACHE)) as ModuleCachePlan;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await remplirFermeT11b(base);
  porte = creerPorte(base, { utilisateurId: '0192f0c1-0000-7000-8000-0000000000aa' as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterAll(() => {
  base.fermer();
});

const ids = (lignes: readonly Record<string, string | number | null>[]): string[] => lignes.map((l) => String(l.id));

/** Le plan ne contient ni zone ni planche supprimées (par id, nom ou code). */
function verifierSansZonesSupprimees(plan: Plan, contexte: string): void {
  const lignes = plan.lignes.map((l) => l.id);
  for (const z of IDS_ZONES_SUPPRIMEES) expect(lignes, `${contexte} : zone supprimée ${z}`).not.toContain(z);
  for (const e of IDS_EMPLACEMENTS_SUPPRIMES) expect(lignes, `${contexte} : planche d'une zone supprimée ${e}`).not.toContain(e);
  const textes = plan.lignes.map((l) => (l.sorte === 'emplacement' ? l.code : l.nom));
  for (const t of [...NOMS_ZONES_SUPPRIMEES, ...CODES_SUPPRIMES]) expect(textes, `${contexte} : « ${t} »`).not.toContain(t);
  const barres = plan.lignes.flatMap((l) => (l.sorte === 'emplacement' ? l.barres.map((b) => b.occupationId) : []));
  expect(barres, `${contexte} : barre d'une zone supprimée`).not.toContain(O11B.anciens);
  expect(barres, `${contexte} : barre d'une zone supprimée`).not.toContain(O11B.chapelleSupprimee);
}

function verifierDonneesSansZonesSupprimees(d: DonneesPlan, contexte: string): void {
  const zones = ids(d.zone);
  const emplacements = ids(d.emplacement);
  for (const z of IDS_ZONES_SUPPRIMEES) expect(zones, `${contexte} : zone supprimée lue`).not.toContain(z);
  for (const e of IDS_EMPLACEMENTS_SUPPRIMES) expect(emplacements, `${contexte} : planche d'une zone supprimée lue`).not.toContain(e);
  // Les zones vivantes, elles, sont bien là.
  expect(zones).toContain(Z11B.zeta);
}

describe('T11b : zones supprimées (zone.supprime_le non nul)', () => {
  it('le jeu contient le cas à tester : zones supprimées en base, avec des planches non supprimées', async () => {
    const zones = await base.getAll<{ id: string; supprime_le: string | null }>('SELECT id, supprime_le FROM zone WHERE supprime_le IS NOT NULL');
    expect(zones.map((z) => z.id).sort()).toEqual([...IDS_ZONES_SUPPRIMEES].sort());
    const planches = await base.getAll<{ id: string }>('SELECT id FROM emplacement WHERE supprime_le IS NULL AND zone_id IN (?, ?)', [Z11B.supprimee, Z11B.chapelleSupprimee]);
    expect(planches).toHaveLength(IDS_EMPLACEMENTS_SUPPRIMES.length);
  });

  it('lireDonneesPlan (lireStructure) : ni la zone supprimée, ni ses planches', async () => {
    const d = await calculs.lireDonneesPlan(porte, FERME);
    verifierDonneesSansZonesSupprimees(d, 'lireDonneesPlan');
  });

  it('lireDebutDePlan : ni dans le début, ni dans la structure réservée', async () => {
    const debut = await calculs.lireDebutDePlan(porte, FERME, cache.EMPLACEMENTS_DU_DEBUT);
    verifierDonneesSansZonesSupprimees(debut, 'début');
    verifierDonneesSansZonesSupprimees(debut.structure, 'structure réservée');
  });

  it('les plans construits (complet, début, structure réservée) n’ont aucune ligne pour elles', async () => {
    const saison = SAISONS[1];
    if (saison === undefined) throw new Error('saison 2026 absente');
    const options = { saison, aujourdhui: AUJOURDHUI };
    const complet = calculs.construirePlan(await calculs.lireDonneesPlan(porte, FERME), options);
    const debut = await calculs.lireDebutDePlan(porte, FERME, cache.EMPLACEMENTS_DU_DEBUT);
    verifierSansZonesSupprimees(complet, 'plan complet');
    verifierSansZonesSupprimees(calculs.construirePlan(debut, options), 'plan du début');
    verifierSansZonesSupprimees(calculs.construirePlan(debut.structure, options), 'plan de la structure réservée');
    // Le reste est intact : la zone vivante « Zeta » (14 planches) est dans le plan complet.
    expect(complet.lignes.filter((l) => l.sorte === 'emplacement' && l.code.startsWith('ZZ-'))).toHaveLength(14);
  });

  it('par le cache de l’écran : début et plan complet sans elles, de même hauteur', async () => {
    const saison = SAISONS[1];
    if (saison === undefined) throw new Error('saison 2026 absente');
    const debut = await cache.obtenirDebutDePlan(porte, FERME, saison, AUJOURDHUI);
    const complet = await cache.obtenirPlan(porte, FERME, saison, AUJOURDHUI);
    verifierSansZonesSupprimees(debut.plan, 'cache, début');
    verifierSansZonesSupprimees(complet.plan, 'cache, complet');
    expect(debut.totalLignes, 'hauteur réservée = plan complet, sans les lignes de zones supprimées').toBe(complet.plan.lignes.length);
  });
});

describe('T11b : hauteur réservée pendant le début = hauteur du plan complet', () => {
  for (const saison of SAISONS) {
    it(`saison ${saison.nom} (zone sans emplacement actif, emplacements inactifs)`, async () => {
      const debut = await cache.obtenirDebutDePlan(porte, FERME, saison, AUJOURDHUI);
      const complet = await cache.obtenirPlan(porte, FERME, saison, AUJOURDHUI);
      expect(debut.complet, 'le début n’est pas le plan complet').toBe(false);
      expect(complet.complet).toBe(true);
      expect(debut.plan.lignes.length, 'le début a moins de lignes que le plan complet').toBeLessThan(complet.plan.lignes.length);
      expect(debut.totalLignes).toBe(complet.plan.lignes.length);
      expect(complet.totalLignes).toBe(complet.plan.lignes.length);
    });
  }

  it('la zone sans emplacement actif et les emplacements inactifs n’ont pas de ligne (2026)', async () => {
    const saison = SAISONS[1];
    if (saison === undefined) throw new Error('saison 2026 absente');
    const complet = await cache.obtenirPlan(porte, FERME, saison, AUJOURDHUI);
    const codes = complet.plan.lignes.map((l) => (l.sorte === 'emplacement' ? l.code : l.nom));
    // V-P1 (fini le 1er janvier), T2-P99 (à venir), T2-P98 (supprimé) et la zone « Verger », qui n'a que V-P1.
    for (const absent of ['V-P1', 'T2-P99', 'T2-P98', 'Verger']) expect(codes, absent).not.toContain(absent);
    const debut = await cache.obtenirDebutDePlan(porte, FERME, saison, AUJOURDHUI);
    for (const absent of ['V-P1', 'T2-P99', 'T2-P98', 'Verger']) {
      expect(debut.plan.lignes.map((l) => (l.sorte === 'emplacement' ? l.code : l.nom)), `début : ${absent}`).not.toContain(absent);
    }
  });
});
