/**
 * Tests d'acceptation T28c — la ferme de démo est placée (docs/backlog/T28c-jumeau-3d.md : « un
 * placement crédible : serres, magasin, plein champ »), pour que la démo en ligne montre le jumeau
 * 3D. Lignes de `lignesDeLaDemo` (sans navigateur ni base), plan construit comme la 2D, scène de
 * `versScene`. L'ouverture de la vue 3D de la démo, hors ligne, est vérifiée par
 * apps/web/e2e/vue-3d-jumeau.e2e.ts (pnpm e2e:demo).
 *
 * Contrat : la démo pose l'origine du plan (`ferme.origine_plan`, texte JSON {latitude, longitude}) AVANT tout
 * placement ; au moins une serre tunnel, une autre serre (tunnel ou chapelle) et un magasin sans
 * zone ; chaque serre abrite une zone de la démo (une zone au plus par serre, une serre au plus
 * par zone) ; au moins une zone de plein champ a un contour ; des planches de ces zones sont
 * placées ; tout est valide pour le moteur (validerPlacement, validerContour) ; rien ne se
 * recouvre dans la scène ; aucune ligne supprimée.
 */
import { validerContour, validerPlacement } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleCalculsPlan } from '../ecrans/plan/test/contrat.ts';
import type { ModuleScene } from '../ecrans/plan3d/test/contrat.ts';
import { aabb, coinsBatiment, coinsVolume, formeSocle, recouvre, dansRect } from '../ecrans/plan3d/test/geometrie.ts';
import type { ModuleJumeau, PlanJumeau, SceneJumeau } from '../ecrans/plan3d/test/contrat-jumeau.ts';
import { lignesDeLaDemo } from './remplir.ts';

const CHEMIN_CALCULS = '../ecrans/plan/calculs.ts';
const CHEMIN_SCENE = '../ecrans/plan3d/scene.ts';

let calculs: ModuleCalculsPlan;
let m: ModuleJumeau & ModuleScene;

beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleJumeau & ModuleScene;
});

const JOUR = '2026-09-30';
const tables = () => lignesDeLaDemo(JOUR, new Date('2026-09-30T08:00:00.000Z'));
const lignes = (k: string) => tables().get(k) ?? [];

function planDemo(): PlanJumeau {
  const t = tables();
  const g = (k: string) => t.get(k) ?? [];
  const s = g('saison').find((l) => l.nom === '2026');
  if (s === undefined) throw new Error('démo sans saison 2026');
  const donnees = { zone: g('zone'), emplacement: g('emplacement'), occupation: g('occupation'), serie: g('serie'), plantation: g('plantation'), espece: g('espece'), variete: g('variete'), famille: g('famille'), batiment: g('batiment') };
  return calculs.construirePlan(donnees, { saison: { id: String(s.id), nom: '2026', debut: String(s.debut), fin: String(s.fin) }, aujourdhui: JOUR }) as unknown as PlanJumeau;
}

describe('T28c : lignes de la ferme de démo', () => {
  it('l’origine du plan est posée sur la ferme de démo, avant tout placement', () => {
    const ferme = lignes('ferme')[0];
    expect(typeof ferme?.origine_plan).toBe('string');
    const o = JSON.parse(String(ferme?.origine_plan)) as { latitude?: unknown; longitude?: unknown };
    expect(typeof o.latitude).toBe('number');
    expect(typeof o.longitude).toBe('number');
  });

  it('des serres, un magasin sans zone, chaque serre sur une zone de la démo, tout valide pour le moteur', () => {
    const batiments = lignes('batiment');
    const zones = new Set(lignes('zone').map((z) => z.id));
    expect(batiments.every((b) => b.supprime_le === null || b.supprime_le === undefined)).toBe(true);
    const serres = batiments.filter((b) => b.type === 'serre_tunnel' || b.type === 'serre_chapelle');
    expect(batiments.filter((b) => b.type === 'serre_tunnel').length).toBeGreaterThanOrEqual(1);
    expect(serres.length).toBeGreaterThanOrEqual(2);
    const magasins = batiments.filter((b) => b.type === 'magasin');
    expect(magasins.length).toBeGreaterThanOrEqual(1);
    for (const b of magasins) expect(b.zone_id ?? null).toBeNull();
    for (const b of serres) {
      expect(zones.has(String(b.zone_id)), `zone de ${String(b.nom)}`).toBe(true);
    }
    const abritees = batiments.map((b) => b.zone_id ?? null).filter((z): z is string | number => z !== null);
    expect(new Set(abritees).size, 'une zone abritée par un seul bâtiment').toBe(abritees.length);
    const ids = batiments.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of batiments) {
      const r = validerPlacement({ table: 'batiment', ligne: b });
      expect(r.ok, `${String(b.nom)} : ${r.ok ? '' : r.erreur.message}`).toBe(true);
      expect(b.ferme_id, 'ferme de la démo').toBe(lignes('ferme')[0]?.id);
    }
    // Une zone abritée n'a pas de contour (la base le refuse).
    for (const z of lignes('zone')) if (abritees.includes(z.id ?? '')) expect(z.contour ?? null, String(z.nom)).toBeNull();
  });

  it('au moins une zone de plein champ a un contour valide, et des planches placées valides', () => {
    const avecContour = lignes('zone').filter((z) => z.contour !== null && z.contour !== undefined);
    expect(avecContour.length).toBeGreaterThanOrEqual(1);
    for (const z of avecContour) {
      const r = validerContour(JSON.parse(String(z.contour)));
      expect(r.ok, `${String(z.nom)} : ${r.ok ? '' : r.erreur.message}`).toBe(true);
    }
    const placees = lignes('emplacement').filter((e) => e.placement_x_m !== null && e.placement_x_m !== undefined);
    expect(placees.length).toBeGreaterThanOrEqual(3);
    for (const e of placees) expect(validerPlacement({ table: 'emplacement', ligne: e }).ok, String(e.code)).toBe(true);
  });
});

describe('T28c : scène de la ferme de démo', () => {
  const scene = (): SceneJumeau => m.versScene(planDemo(), (planDemo().semaineCourante ?? 0));

  it('la démo montre ses serres (arceaux), son magasin et des planches placées', () => {
    const s = scene();
    expect(s.batiments.filter((b) => b.forme === 'tunnel').length).toBeGreaterThanOrEqual(1);
    expect(s.batiments.filter((b) => b.forme !== 'volume').length).toBeGreaterThanOrEqual(2);
    expect(s.batiments.some((b) => b.type === 'magasin' && b.zoneId === null)).toBe(true);
    expect(s.batiments.reduce((n, b) => n + b.arceaux.length, 0)).toBeGreaterThan(10);
    expect(s.socles.some((z) => z.placee && z.batimentId !== null)).toBe(true);
    expect(s.socles.some((z) => z.placee && z.contour !== null)).toBe(true);
    expect(s.volumes.filter((v) => v.placee).length).toBeGreaterThanOrEqual(3);
  });

  it('rien ne se recouvre : ni planches, ni socles, ni bâtiments (hors la serre et sa zone)', () => {
    const s = scene();
    for (const a of s.volumes) {
      for (const b of s.volumes) if (a.id < b.id) expect(recouvre(coinsVolume(a), coinsVolume(b)), `${a.code} / ${b.code}`).toBe(false);
      const z = s.socles.find((x) => x.id === a.zoneId);
      if (z === undefined) throw new Error('socle manquant');
      expect(dansRect(coinsVolume(a), formeSocle(z)), `${a.code} hors de sa zone`).toBe(true);
    }
    for (const a of s.socles) {
      for (const b of s.socles) if (a.id < b.id) expect(recouvre(formeSocle(a), formeSocle(b)), `${a.nom} / ${b.nom}`).toBe(false);
      for (const b of s.batiments) if (a.batimentId !== b.id) expect(recouvre(formeSocle(a), coinsBatiment(b)), `${a.nom} / ${b.nom}`).toBe(false);
    }
    for (const a of s.batiments) for (const b of s.batiments) if (a.id < b.id) expect(recouvre(coinsBatiment(a), coinsBatiment(b)), `${a.nom} / ${b.nom}`).toBe(false);
  });

  it('les zones non placées de la démo (s’il en reste) sont rangées à côté de la partie placée', () => {
    const s = scene();
    const placee = aabb([...s.socles.filter((z) => z.placee).flatMap(formeSocle), ...s.batiments.flatMap(coinsBatiment)]);
    for (const z of s.socles.filter((x) => !x.placee)) {
      const b = aabb(formeSocle(z));
      expect(b.x1 <= placee.x0 + 1e-6 || b.x0 >= placee.x1 - 1e-6 || b.z1 <= placee.z0 + 1e-6 || b.z0 >= placee.z1 - 1e-6, z.nom).toBe(true);
    }
  });
});
