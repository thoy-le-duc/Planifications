/**
 * Tests d'acceptation T11f — zones supprimées, fin du ménage (suites de la relecture T11b).
 *
 * Règle : une zone dont `supprime_le` n'est pas nul n'existe plus, ni pour le plan, ni pour la 3D.
 *   - Bâtiment rattaché à une zone supprimée (`batiment.zone_id` = cette zone, le bâtiment
 *     lui-même NON supprimé) : absent des données lues (`lireDonneesPlan`, donc `lireStructure`,
 *     et `lireDebutDePlan`, début et structure réservée), du plan construit (`plan.batiments`) et
 *     de la scène 3D (`versScene(plan).batiments`). Un bâtiment sans zone, ou rattaché à une zone
 *     vivante, reste.
 *   - `plan3d/donnees-plants.ts` (`lireCultures`) ne lit pas les zones supprimées : une zone
 *     `hors_sol` supprimée ne rend plus ses emplacements hors-sol pour la 3D ; une zone `hors_sol`
 *     vivante, si.
 * Ferme : celle de T11b (./test/contrat-t11b.ts), plus trois bâtiments et deux zones hors-sol.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { lireCultures } from '../plan3d/donnees-plants.ts';
import { versScene } from '../plan3d/scene.ts';
import { construirePlan, lireDebutDePlan, lireDonneesPlan, type DonneesPlan, type Plan } from './calculs.ts';
import { EMPLACEMENTS_DU_DEBUT } from './cache.ts';
import { FERME, SAISONS, Z11B, remplirFermeT11b } from './test/contrat-t11b.ts';
import { Z } from './test/petite-ferme.ts';

const AUJOURDHUI = '2026-09-30';
const C = '2026-01-15T08:00:00.000Z';
const SUPPRIME = '2026-03-01T08:00:00.000Z';
const id = (n: number) => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const B11F = {
  /** Rattaché à la zone supprimée « Anciens tunnels » (bâtiment lui-même non supprimé). */
  deZoneSupprimee: id(0xf10),
  /** Rattaché au tunnel 2, vivant. */
  deZoneVivante: id(0xf11),
  /** Sans zone. */
  sansZone: id(0xf12),
} as const;

const ZH = {
  /** Zone hors-sol supprimée, avec une planche non supprimée. */
  horsSolSupprimee: id(0xf20),
  /** Zone hors-sol vivante (témoin). */
  horsSolVivante: id(0xf21),
} as const;

const EH = {
  dansHorsSolSupprimee: id(0xf30),
  dansHorsSolVivante: id(0xf31),
} as const;

function batiment(bid: string, nom: string, zoneId: string | null, x: number): Record<string, string | number | null> {
  return {
    id: bid,
    ferme_id: FERME,
    nom,
    type: 'serre_tunnel',
    longueur_m: 30,
    largeur_m: 8,
    hauteur_m: 3.5,
    centre_x_m: x,
    centre_y_m: 20,
    orientation_deg: 0,
    zone_id: zoneId,
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  };
}

let base: BaseMemoire;
let porte: PorteDonnees;

async function inserer(table: string, ligne: Record<string, string | number | null>): Promise<void> {
  const colonnes = Object.keys(ligne);
  await base.execute(
    `INSERT INTO ${table} (${colonnes.map((c) => `"${c}"`).join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
    colonnes.map((c) => ligne[c] ?? null),
  );
}

beforeAll(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await remplirFermeT11b(base);
  await inserer('batiment', batiment(B11F.deZoneSupprimee, 'Ancien tunnel', Z11B.supprimee, 10));
  await inserer('batiment', batiment(B11F.deZoneVivante, 'Tunnel 2', Z.tunnel2, 40));
  await inserer('batiment', batiment(B11F.sansZone, 'Hangar', null, 70));
  const zone = (zid: string, nom: string, supprimeLe: string | null) => ({
    id: zid,
    ferme_id: FERME,
    nom,
    zone_parente_id: null,
    type_abri: 'hors_sol',
    surface_m2: 100,
    cree_le: C,
    modifie_le: C,
    supprime_le: supprimeLe,
  });
  await inserer('zone', zone(ZH.horsSolSupprimee, 'Hors-sol démonté', SUPPRIME));
  await inserer('zone', zone(ZH.horsSolVivante, 'Hors-sol fraises', null));
  const planche = (eid: string, zoneId: string, code: string) => ({
    id: eid,
    ferme_id: FERME,
    zone_id: zoneId,
    code,
    sorte: 'planche',
    longueur_m: 20,
    largeur_m: 0.4,
    nombre_places: null,
    actif_du: '2022-01-01',
    actif_au: null,
    remplace: '[]',
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  });
  await inserer('emplacement', planche(EH.dansHorsSolSupprimee, ZH.horsSolSupprimee, 'HD-1'));
  await inserer('emplacement', planche(EH.dansHorsSolVivante, ZH.horsSolVivante, 'HF-1'));
  porte = creerPorte(base, { utilisateurId: '0192f0c1-0000-7000-8000-0000000000aa' as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterAll(() => {
  base.fermer();
});

const SAISON = SAISONS[1];
function options() {
  if (SAISON === undefined) throw new Error('saison 2026 absente');
  return { saison: SAISON, aujourdhui: AUJOURDHUI };
}

const idsBatimentsLus = (d: DonneesPlan): string[] => (d.batiment ?? []).map((b) => String(b.id));
const idsBatimentsPlan = (p: Plan): string[] => (p.batiments ?? []).map((b) => b.id);

function verifierIds(ids: readonly string[], contexte: string): void {
  expect(ids, `${contexte} : bâtiment d'une zone supprimée`).not.toContain(B11F.deZoneSupprimee);
  expect(ids, `${contexte} : bâtiment d'une zone vivante`).toContain(B11F.deZoneVivante);
  expect(ids, `${contexte} : bâtiment sans zone`).toContain(B11F.sansZone);
}

describe('T11f : bâtiment rattaché à une zone supprimée', () => {
  it('le jeu contient le cas : bâtiment non supprimé, rattaché à une zone supprimée', async () => {
    const lignes = await base.getAll<{ id: string; supprime_le: string | null; zone_supprimee: string | null }>(
      'SELECT b.id, b.supprime_le, z.supprime_le AS zone_supprimee FROM batiment b JOIN zone z ON z.id = b.zone_id WHERE b.id = ?',
      [B11F.deZoneSupprimee],
    );
    expect(lignes).toEqual([{ id: B11F.deZoneSupprimee, supprime_le: null, zone_supprimee: SUPPRIME }]);
  });

  it('lireDonneesPlan (lireStructure) ne le lit pas ; le plan construit ne l’a pas', async () => {
    const d = await lireDonneesPlan(porte, FERME);
    verifierIds(idsBatimentsLus(d), 'lireDonneesPlan');
    verifierIds(idsBatimentsPlan(construirePlan(d, options())), 'plan complet');
  });

  it('lireDebutDePlan : ni dans le début, ni dans la structure réservée', async () => {
    const debut = await lireDebutDePlan(porte, FERME, EMPLACEMENTS_DU_DEBUT);
    verifierIds(idsBatimentsLus(debut), 'début');
    verifierIds(idsBatimentsLus(debut.structure), 'structure réservée');
    verifierIds(idsBatimentsPlan(construirePlan(debut, options())), 'plan du début');
  });

  it('la scène 3D construite sur le plan ne l’a pas', async () => {
    const plan = construirePlan(await lireDonneesPlan(porte, FERME), options());
    const scene = versScene(plan, 0);
    verifierIds(
      scene.batiments.map((b) => b.id),
      'scène 3D',
    );
  });
});

describe('T11f : la 3D (donnees-plants.ts) ne lit pas les zones supprimées', () => {
  it('le jeu contient le cas : zone hors-sol supprimée, sa planche non supprimée', async () => {
    const lignes = await base.getAll<{ id: string }>('SELECT id FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL', [ZH.horsSolSupprimee]);
    expect(lignes.map((l) => l.id)).toEqual([EH.dansHorsSolSupprimee]);
  });

  it('une zone hors-sol supprimée ne rend plus ses planches hors-sol ; une vivante, si', async () => {
    const { horsSol } = await lireCultures(porte, FERME);
    expect(horsSol.has(EH.dansHorsSolVivante), 'témoin : planche d’une zone hors-sol vivante').toBe(true);
    expect(horsSol.has(EH.dansHorsSolSupprimee), 'planche d’une zone hors-sol supprimée').toBe(false);
  });
});
