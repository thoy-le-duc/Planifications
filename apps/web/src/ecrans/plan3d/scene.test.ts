/**
 * Tests d'acceptation T27 — `versScene(plan, semaine)`, l'adaptateur pur entre le plan de la 2D et
 * les volumes de la vue 3D. Contrat : ./test/contrat.ts. Testable sans navigateur : ni three, ni
 * DOM. La vue (rendu, curseur, repli) est vérifiée par apps/web/e2e/vue-3d.e2e.ts, le poids du
 * morceau 3D par scripts/vue3d.test.ts.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FAMILLES } from '../../ui/jetons.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import { PETITE_FERME, SAISON_2026 } from '../plan/test/petite-ferme.ts';
import type { BarrePlan, SemainePlan } from '../plan/calculs.ts';
import type { LigneEmplacementPlan3d, ModuleScene, Plan3d, Scene, SocleScene, VolumeScene } from './test/contrat.ts';

/** Chemins tenus dans des variables : le typage ne dépend pas des modules pas encore écrits. */
const CHEMIN_SCENE = './scene.ts';
const CHEMIN_CALCULS = '../plan/calculs.ts';

let m: ModuleScene;
let calculs: ModuleCalculsPlan;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleScene;
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
});

// ── Plan écrit à la main ─────────────────────────────────────────────────────────────────────

const semaines: SemainePlan[] = [0, 1, 2, 3].map((i) => ({
  annee: 2026,
  semaine: i + 1,
  libelle: `S0${String(i + 1)}`,
  lundi: `2026-01-${String(5 + 7 * i).padStart(2, '0')}`,
}));

function barre(id: string, libelle: string, cleFamille: BarrePlan['cleFamille'], debutJour: number, finJour: number): BarrePlan {
  return {
    occupationId: id,
    serieId: null,
    plantationId: null,
    libelle,
    famille: null,
    cleFamille,
    etat: 'prevu',
    du: '2026-01-05',
    au: null,
    debutJour,
    finJour,
    enConflit: false,
  };
}

function planche(id: string, zoneId: string, longueurM: number, largeurM: number | null, barres: BarrePlan[], chapelleId: string | null = null): LigneEmplacementPlan3d {
  return { sorte: 'emplacement', id, code: id.toUpperCase(), zoneId, chapelleId, barres, conflits: [], longueurM, largeurM };
}

const PLAN: Plan3d = {
  saison: { id: 's', nom: '2026', debut: '2026-01-05', fin: '2026-02-01' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z1', nom: 'Tunnel 1' },
    // Tomate semaines 0-1, salade semaines 2-3 ; la salade commence pile au début de la semaine 2.
    planche('p1', 'z1', 30, 0.8, [barre('o1', 'Tomate Cœur de bœuf', 'solanacees', 0, 14), barre('o2', 'Laitue Batavia', 'salades', 14, 28)]),
    // Semaine 1 : radis (3 jours : 7, 8, 9) et chou (6 jours : 8 à 13) : le chou couvre le plus de jours.
    // Semaine 3 : une culture d'une famille sans couleur (neutre), mais nommée.
    planche('p2', 'z1', 20, 1.2, [barre('o3', 'Radis', 'racines', 7, 10), barre('o4', 'Chou', 'cruciferes', 8, 14), barre('o5', 'Courge', null, 21, 28)]),
    // Largeur non renseignée, aucune culture de la saison.
    planche('p3', 'z1', 10, null, []),
    { sorte: 'zone', id: 'z2', nom: 'Serre' },
    { sorte: 'chapelle', id: 'ch1', nom: 'Chapelle 1' },
    planche('c1', 'z2', 12, 1, [barre('o6', 'Tomate Roma', 'solanacees', 3, 6)], 'ch1'),
    // Zone sans aucune planche (ligne de zone seule).
    { sorte: 'zone', id: 'z3', nom: 'Verger' },
  ],
};

const volume = (s: Scene, id: string): VolumeScene => {
  const v = s.volumes.find((x) => x.id === id);
  if (v === undefined) throw new Error(`volume ${id} absent`);
  return v;
};
const socle = (s: Scene, id: string): SocleScene => {
  const z = s.socles.find((x) => x.id === id);
  if (z === undefined) throw new Error(`socle ${id} absent`);
  return z;
};

const intervalleX = (o: { x: number; longueur?: number; largeur?: number }, taille: number): [number, number] => [o.x - taille / 2, o.x + taille / 2];
const intervalleZ = (o: { z: number }, taille: number): [number, number] => [o.z - taille / 2, o.z + taille / 2];
const dedans = (a: [number, number], b: [number, number]) => a[0] >= b[0] - 1e-9 && a[1] <= b[1] + 1e-9;
const recoupe = (a: [number, number], b: [number, number]) => a[0] < b[1] - 1e-9 && b[0] < a[1] - 1e-9;

describe('T27 : socles (une zone = un socle)', () => {
  it('un socle par ligne de zone, dans l’ordre du plan ; pas pour les chapelles', () => {
    const s = m.versScene(PLAN, 0);
    expect(s.socles.map((z) => [z.id, z.nom])).toEqual([
      ['z1', 'Tunnel 1'],
      ['z2', 'Serre'],
      ['z3', 'Verger'],
    ]);
  });

  it('une zone sans planche a quand même un socle, de taille positive, sans volume', () => {
    const s = m.versScene(PLAN, 0);
    const verger = socle(s, 'z3');
    expect(verger.largeur).toBeGreaterThan(0);
    expect(verger.profondeur).toBeGreaterThan(0);
    expect(s.volumes.filter((v) => v.zoneId === 'z3')).toEqual([]);
  });

  it('les socles ne se chevauchent pas', () => {
    const s = m.versScene(PLAN, 0);
    for (const a of s.socles) {
      for (const b of s.socles) {
        if (a.id >= b.id) continue;
        const separes = !recoupe(intervalleX(a, a.largeur), intervalleX(b, b.largeur)) || !recoupe(intervalleZ(a, a.profondeur), intervalleZ(b, b.profondeur));
        expect(separes, `${a.id} et ${b.id} se chevauchent`).toBe(true);
      }
    }
  });
});

describe('T27 : volumes (une planche = un volume)', () => {
  it('un volume par planche, dans l’ordre du plan, vides compris', () => {
    const s = m.versScene(PLAN, 0);
    expect(s.volumes.map((v) => v.id)).toEqual(['p1', 'p2', 'p3', 'c1']);
    expect(s.volumes.map((v) => v.code)).toEqual(['P1', 'P2', 'P3', 'C1']);
    expect(s.volumes.map((v) => v.zoneId)).toEqual(['z1', 'z1', 'z1', 'z2']);
  });

  it('dimensions proportionnelles à la longueur et à la largeur, par un seul facteur d’échelle', () => {
    const s = m.versScene(PLAN, 0);
    const echelles = [
      volume(s, 'p1').longueur / 30,
      volume(s, 'p2').longueur / 20,
      volume(s, 'p3').longueur / 10,
      volume(s, 'c1').longueur / 12,
      volume(s, 'p1').largeur / 0.8,
      volume(s, 'p2').largeur / 1.2,
      volume(s, 'c1').largeur / 1,
      volume(s, 'p3').largeur / m.LARGEUR_PAR_DEFAUT_M,
    ];
    const [premiere = Number.NaN] = echelles;
    expect(premiere).toBeGreaterThan(0);
    for (const e of echelles) expect(e).toBeCloseTo(premiere, 9);
    expect(m.LARGEUR_PAR_DEFAUT_M).toBeGreaterThan(0);
  });

  it('même hauteur pour toutes les planches, strictement positive', () => {
    const s = m.versScene(PLAN, 0);
    const [h = Number.NaN] = s.volumes.map((v) => v.hauteur);
    expect(h).toBeGreaterThan(0);
    for (const v of s.volumes) expect(v.hauteur).toBe(h);
  });

  it('chaque volume est dans le socle de sa zone, et aucun ne recouvre un autre', () => {
    const s = m.versScene(PLAN, 0);
    for (const v of s.volumes) {
      const z = socle(s, v.zoneId);
      expect(dedans(intervalleX(v, v.longueur), intervalleX(z, z.largeur)), `${v.id} dépasse le socle ${z.id} (x)`).toBe(true);
      expect(dedans(intervalleZ(v, v.largeur), intervalleZ(z, z.profondeur)), `${v.id} dépasse le socle ${z.id} (z)`).toBe(true);
    }
    for (const a of s.volumes) {
      for (const b of s.volumes) {
        if (a.id >= b.id) continue;
        const separes = !recoupe(intervalleX(a, a.longueur), intervalleX(b, b.longueur)) || !recoupe(intervalleZ(a, a.largeur), intervalleZ(b, b.largeur));
        expect(separes, `${a.id} et ${b.id} se recouvrent`).toBe(true);
      }
    }
  });

  it('la position ne change pas d’une semaine à l’autre (seules les couleurs changent)', () => {
    const geometrie = (s: Scene) => s.volumes.map(({ id, x, z, longueur, largeur, hauteur }) => ({ id, x, z, longueur, largeur, hauteur }));
    expect(geometrie(m.versScene(PLAN, 3))).toEqual(geometrie(m.versScene(PLAN, 0)));
    expect(m.versScene(PLAN, 3).socles).toEqual(m.versScene(PLAN, 0).socles);
  });
});

describe('T27 : couleur et culture de la semaine', () => {
  it('la couleur est celle de la 2D pour la famille (FAMILLES[...].bande), la culture est le libellé de la barre', () => {
    const s0 = m.versScene(PLAN, 0);
    expect(volume(s0, 'p1')).toMatchObject({ culture: 'Tomate Cœur de bœuf', occupationId: 'o1', cleFamille: 'solanacees', couleur: FAMILLES.solanacees.bande });
    const s2 = m.versScene(PLAN, 2);
    expect(volume(s2, 'p1')).toMatchObject({ culture: 'Laitue Batavia', occupationId: 'o2', cleFamille: 'salades', couleur: FAMILLES.salades.bande });
  });

  it('les quatre familles ont quatre couleurs différentes, toutes différentes du neutre', () => {
    const couleurs = [FAMILLES.salades.bande, FAMILLES.solanacees.bande, FAMILLES.cruciferes.bande, FAMILLES.racines.bande];
    expect(new Set([...couleurs, m.COULEUR_NEUTRE]).size).toBe(5);
    expect(m.COULEUR_NEUTRE).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('la semaine change la culture en place : frontière d’une barre (jour 14 = début de la semaine 2)', () => {
    expect(volume(m.versScene(PLAN, 1), 'p1').occupationId).toBe('o1');
    expect(volume(m.versScene(PLAN, 2), 'p1').occupationId).toBe('o2');
  });

  it('une barre qui ne couvre qu’une partie de la semaine compte ; plusieurs barres : celle qui couvre le plus de jours', () => {
    // Semaine 1 : radis 3 jours, chou 6 jours.
    expect(volume(m.versScene(PLAN, 1), 'p2')).toMatchObject({ culture: 'Chou', cleFamille: 'cruciferes', couleur: FAMILLES.cruciferes.bande });
    // Semaine 0 : radis du jour 7 non commencé, chou du jour 8 : rien.
    expect(volume(m.versScene(PLAN, 0), 'p2').culture).toBeNull();
    // Semaine 0 pour la planche de la chapelle : tomate jours 3 à 5.
    expect(volume(m.versScene(PLAN, 0), 'c1').culture).toBe('Tomate Roma');
  });

  it('famille sans couleur : culture nommée, couleur neutre', () => {
    expect(volume(m.versScene(PLAN, 3), 'p2')).toMatchObject({ culture: 'Courge', occupationId: 'o5', cleFamille: null, couleur: m.COULEUR_NEUTRE });
  });

  it('semaine sans culture : volume vide, couleur neutre, rien d’autre', () => {
    const s = m.versScene(PLAN, 3);
    expect(volume(s, 'p3')).toMatchObject({ culture: null, occupationId: null, cleFamille: null, couleur: m.COULEUR_NEUTRE });
    expect(volume(s, 'c1')).toMatchObject({ culture: null, occupationId: null, couleur: m.COULEUR_NEUTRE });
    // Une barre qui finit pile au début de la semaine (fin exclue) ne compte pas.
    expect(volume(m.versScene(PLAN, 1), 'c1').culture).toBeNull();
  });

  it('un plan sans aucune culture donne une scène entièrement neutre', () => {
    const vide: Plan3d = { ...PLAN, lignes: PLAN.lignes.map((l) => (l.sorte === 'emplacement' ? { ...l, barres: [] } : l)) };
    const s = m.versScene(vide, 1);
    expect(s.volumes.length).toBe(4);
    for (const v of s.volumes) expect(v).toMatchObject({ culture: null, couleur: m.COULEUR_NEUTRE });
  });

  it('la scène porte la semaine : indice et libellé du plan', () => {
    expect(m.versScene(PLAN, 2)).toMatchObject({ semaine: 2, libelleSemaine: 'S03' });
  });
});

describe('T27 : entrées invalides, pureté, aucun calcul agronomique', () => {
  it('semaine hors bornes ou non entière : RangeError', () => {
    for (const i of [-1, 4, 1.5, Number.NaN]) expect(() => m.versScene(PLAN, i), `semaine ${String(i)}`).toThrow(RangeError);
  });

  it('plan sans ligne : scène vide ; plan sans semaine : RangeError', () => {
    expect(m.versScene({ ...PLAN, lignes: [] }, 0)).toMatchObject({ socles: [], volumes: [] });
    expect(() => m.versScene({ ...PLAN, lignes: [], semaines: [] }, 0)).toThrow(RangeError);
  });

  it('pure : l’entrée n’est pas modifiée (même figée) et deux appels donnent le même résultat', () => {
    const fige = structuredClone(PLAN);
    const gele = (o: unknown): void => {
      if (typeof o !== 'object' || o === null) return;
      Object.freeze(o);
      for (const v of Object.values(o)) gele(v);
    };
    gele(fige);
    const a = m.versScene(fige, 1);
    const b = m.versScene(fige, 1);
    expect(a).toEqual(b);
    expect(fige).toEqual(PLAN);
  });

  it('la scène ne contient aucune valeur agronomique : pas de date, de durée, de quantité ni de conflit', () => {
    const vu = JSON.stringify(m.versScene(PLAN, 1));
    expect(vu).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(vu).not.toMatch(/conflit|debutJour|finJour|"du"|"au"|longueurM|largeurM/i);
    for (const v of m.versScene(PLAN, 1).volumes) {
      expect(Object.keys(v).sort()).toEqual(['angle', 'cleFamille', 'code', 'couleur', 'culture', 'hauteur', 'id', 'largeur', 'longueur', 'occupationId', 'placee', 'x', 'z', 'zoneId']);
    }
  });

  it('le module n’importe du moteur que des types, ni React ni three, et n’appelle ni Date ni Math.random', () => {
    const source = readFileSync(new URL(CHEMIN_SCENE, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^(\s*import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"])/gms)].map((r) => [r[1], r[2], r[3]] as const);
    for (const [instruction, type, cible] of imports) {
      if (cible === undefined) continue;
      expect(cible, 'dépendance lourde dans l’adaptateur pur').not.toMatch(/^(react|react-dom|three|@react-three)/);
      if (!cible.startsWith('@planif/') || type !== undefined) continue;
      // T28c : le repère des zones est calculé par le moteur (T28a), pas recopié ici. Seules ces
      // fonctions pures du placement peuvent être importées comme valeurs, depuis @planif/core.
      const noms = [...(instruction?.match(/\{([^}]*)\}/s)?.[1] ?? '').split(',')].map((n) => n.trim()).filter((n) => n !== '' && !n.startsWith('type '));
      const permis = new Set(['depuisRepereZone', 'repereZone', 'coinsEmprise', 'versRepereZone']);
      expect(cible, `import de valeur depuis ${cible}`).toBe('@planif/core');
      for (const n of noms) expect(permis.has(n), `import de valeur « ${n} » depuis ${cible}`).toBe(true);
    }
    expect(source).not.toMatch(/\bnew Date\b|\bDate\.now\b|Math\.random/);
  });
});

describe('T27 : sur le plan réel de la petite ferme (construirePlan, vue 2D)', () => {
  const plan = (): Plan3d => calculs.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-06-10' }) as unknown as Plan3d;
  const indexSemaine = (p: Plan3d, jour: string) => p.semaines.findIndex((w) => w.lundi <= jour && jour < new Date(Date.parse(w.lundi) + 7 * 86_400_000).toISOString().slice(0, 10));

  it('le plan de la 2D porte la taille de chaque emplacement (longueurM, largeurM), recopiée de la base', () => {
    const lignes = plan().lignes.filter((l): l is LigneEmplacementPlan3d => l.sorte === 'emplacement');
    expect(lignes.length).toBeGreaterThan(0);
    const c1 = lignes.find((l) => l.code === 'C1-P1');
    expect(c1).toMatchObject({ longueurM: 10, largeurM: 0.8 });
    expect(lignes.find((l) => l.code === 'T2-P2')).toMatchObject({ longueurM: 30, largeurM: 0.8 });
  });

  it('un volume par emplacement du plan, un socle par zone du plan', () => {
    const p = plan();
    const s = m.versScene(p, indexSemaine(p, '2026-06-10'));
    expect(s.volumes.map((v) => v.id)).toEqual(p.lignes.filter((l) => l.sorte === 'emplacement').map((l) => l.id));
    expect(s.socles.map((z) => z.id)).toEqual(p.lignes.filter((l) => l.sorte === 'zone').map((l) => l.id));
  });

  it('en juin, T2-P2 porte la tomate (chevauchée par la laitue) ; la couleur est celle de la barre de la 2D', () => {
    const p = plan();
    const i = indexSemaine(p, '2026-06-10');
    expect(i).toBeGreaterThanOrEqual(0);
    const s = m.versScene(p, i);
    const ligne = p.lignes.find((l) => l.sorte === 'emplacement' && l.code === 'T2-P2');
    const v = s.volumes.find((x) => x.code === 'T2-P2');
    expect(ligne).toBeDefined();
    expect(v?.culture).toMatch(/^(Tomate|Laitue)/);
    const b = ligne?.sorte === 'emplacement' ? ligne.barres.find((x) => x.occupationId === v?.occupationId) : undefined;
    expect(b?.libelle).toBe(v?.culture);
    expect(v?.cleFamille).toBe(b?.cleFamille);
    expect(v?.couleur).toBe(b?.cleFamille === null || b?.cleFamille === undefined ? m.COULEUR_NEUTRE : FAMILLES[b.cleFamille].bande);
  });

  it('en janvier, la planche à plantation pérenne reste colorée ; une planche sans occupation reste neutre', () => {
    const p = plan();
    const s = m.versScene(p, 0);
    const perenne = s.volumes.find((v) => v.code === 'T10-P1');
    expect(perenne?.culture).toMatch(/^Tomate/);
    expect(s.volumes.find((v) => v.code === 'DC-P1')).toMatchObject({ culture: null, couleur: m.COULEUR_NEUTRE });
  });
});
