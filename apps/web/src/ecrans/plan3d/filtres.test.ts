/**
 * Tests d'acceptation T27b — couleurs par famille et filtres de la vue 3D, côté adaptateur pur
 * (`scene.ts`). Contrat : ./test/contrat-filtres.ts. La vue (légende, cases, fluidité) est
 * vérifiée par apps/web/e2e/vue-3d-filtres.e2e.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { lignesDeLaDemo } from '../../demo/remplir.ts';
import { FAMILLES as FAMILLES_JETONS } from '../../ui/jetons.ts';
import { deltaE76 } from '../../ui/test/couleurs.ts';
import type { BarrePlan, SemainePlan } from '../plan/calculs.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import type { ModuleScene, Plan3d, Scene } from './test/contrat.ts';
import {
  CLES_FAMILLES,
  type DimensionFiltre,
  type FiltresScene,
  type ModuleFiltres,
  type SceneFiltree,
} from './test/contrat-filtres.ts';

/** Les 17 clés (T27b) : le type de jetons.ts les aura après l'implémentation, le test n'en dépend pas. */
const FAMILLES = FAMILLES_JETONS as Readonly<Record<string, { readonly bande: string; readonly texte: string }>>;

function bande(cle: string): string {
  const f = FAMILLES[cle];
  if (f === undefined) throw new Error(`FAMILLES.${cle} absente de jetons.ts`);
  return f.bande;
}

const CHEMIN_SCENE = './scene.ts';
const CHEMIN_CALCULS = '../plan/calculs.ts';

let m: ModuleScene & ModuleFiltres;
let calculs: ModuleCalculsPlan;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleScene & ModuleFiltres;
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
});

// ── Plan écrit à la main : 7 planches, 2 zones, plusieurs familles, un vide ─────────────────

const semaines: SemainePlan[] = [0, 1].map((i) => ({ annee: 2026, semaine: i + 1, libelle: `S0${String(i + 1)}`, lundi: `2026-01-${String(5 + 7 * i).padStart(2, '0')}` }));

function barre(id: string, libelle: string, cleFamille: string | null): BarrePlan {
  return {
    occupationId: id,
    serieId: null,
    plantationId: null,
    libelle,
    famille: null,
    cleFamille: cleFamille as BarrePlan['cleFamille'],
    etat: 'prevu',
    du: '2026-01-05',
    au: null,
    debutJour: 0,
    finJour: 14,
    enConflit: false,
  };
}

function planche(id: string, zoneId: string, barres: BarrePlan[]) {
  return { sorte: 'emplacement' as const, id, code: id.toUpperCase(), zoneId, chapelleId: null, barres, conflits: [], longueurM: 10, largeurM: 1 };
}

const PLAN: Plan3d = {
  saison: { id: 's', nom: '2026', debut: '2026-01-05', fin: '2026-01-18' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z1', nom: 'Tunnel 1' },
    planche('p1', 'z1', [barre('o1', 'Courgette', 'cucurbitacees')]),
    planche('p2', 'z1', [barre('o2', 'Asperge', 'asparagacees')]),
    planche('p3', 'z1', [barre('o3', 'Tomate', 'solanacees')]),
    planche('p4', 'z1', []),
    { sorte: 'zone', id: 'z2', nom: 'Serre' },
    planche('p5', 'z2', [barre('o5', 'Fraise', 'rosacees')]),
    planche('p6', 'z2', [barre('o6', 'Tomate', 'solanacees')]),
    planche('p7', 'z2', [barre('o7', 'Couverture', 'autre')]),
    // Culture dont la famille est nulle (plan écrit à la main) : neutre pour la couleur, « autre » pour le filtre.
    planche('p8', 'z2', [barre('o8', 'Mystère', null)]),
  ],
};

const scene = (): Scene => m.versScene(PLAN, 0);
const ids = (v: readonly { id: string }[]) => v.map((x) => x.id);
const estompes = (s: SceneFiltree) => ids(s.volumes.filter((v) => v.estompe));
const nonEstompes = (s: SceneFiltree) => ids(s.volumes.filter((v) => !v.estompe));
const avec = (base: FiltresScene, dim: DimensionFiltre, valeurs: readonly string[] | null): FiltresScene => ({ ...base, [dim]: valeurs === null ? null : new Set(valeurs) });
const TOUT = (): FiltresScene => m.FILTRES_TOUT;

describe('T27b : couleur par famille dans la scène', () => {
  it('chaque culture prend la bande de sa famille (17 clés), plus jamais le neutre', () => {
    const s = scene();
    const v = (id: string) => s.volumes.find((x) => x.id === id);
    expect(v('p1')).toMatchObject({ culture: 'Courgette', cleFamille: 'cucurbitacees', couleur: bande('cucurbitacees') });
    expect(v('p2')).toMatchObject({ cleFamille: 'asparagacees', couleur: bande('asparagacees') });
    expect(v('p5')).toMatchObject({ cleFamille: 'rosacees', couleur: bande('rosacees') });
    expect(v('p7')).toMatchObject({ culture: 'Couverture', cleFamille: 'autre', couleur: bande('autre') });
    for (const id of ['p1', 'p2', 'p3', 'p5', 'p6', 'p7']) expect(v(id)?.couleur, id).not.toBe(m.COULEUR_NEUTRE);
  });

  it('seule la planche vide est au neutre ; une barre à famille nulle écrite à la main reste neutre (comme en T27)', () => {
    const s = scene();
    expect(s.volumes.find((x) => x.id === 'p4')).toMatchObject({ culture: null, cleFamille: null, couleur: m.COULEUR_NEUTRE });
    expect(s.volumes.find((x) => x.id === 'p8')).toMatchObject({ culture: 'Mystère', couleur: m.COULEUR_NEUTRE });
  });

  it('les 17 bandes de FAMILLES sont distinctes du neutre de la scène (ΔE ≥ 20)', () => {
    for (const cle of CLES_FAMILLES) expect(deltaE76(bande(cle), m.COULEUR_NEUTRE), cle).toBeGreaterThanOrEqual(20);
  });
});

describe('T27b : ferme de démo — courgette, asperge, fraise ne ressemblent plus au vide', () => {
  /** Le plan de la saison 2026 de la ferme de démo (lignes de remplirDemo, plan construit comme la 2D). */
  function planDemo(): Plan3d {
    const t = lignesDeLaDemo('2026-09-30', new Date('2026-09-30T08:00:00.000Z'));
    const g = (k: string) => t.get(k) ?? [];
    const s = g('saison').find((l) => l.nom === '2026');
    if (s === undefined) throw new Error('démo sans saison 2026');
    const donnees = { zone: g('zone'), emplacement: g('emplacement'), occupation: g('occupation'), serie: g('serie'), plantation: g('plantation'), espece: g('espece'), variete: g('variete'), famille: g('famille') };
    const plan = calculs.construirePlan(donnees, { saison: { id: String(s.id), nom: '2026', debut: String(s.debut), fin: String(s.fin) }, aujourdhui: '2026-09-30' });
    return plan as unknown as Plan3d;
  }

  it('sur toutes les semaines : courgette, asperge et fraise ont la couleur de leur famille', () => {
    const plan = planDemo();
    const attendu: [RegExp, string][] = [
      [/^Courgette/, 'cucurbitacees'],
      [/^Asperge/, 'asparagacees'],
      [/^Fraise/, 'rosacees'],
    ];
    const vus = new Set<string>();
    for (let i = 0; i < plan.semaines.length; i += 1) {
      for (const v of m.versScene(plan, i).volumes) {
        for (const [motif, cle] of attendu) {
          if (v.culture === null || !motif.test(v.culture)) continue;
          vus.add(String(motif));
          expect(v.cleFamille, `${v.culture}, semaine ${String(i)}`).toBe(cle);
          expect(v.couleur, `${v.culture}, semaine ${String(i)}`).toBe(bande(cle));
          expect(v.couleur).not.toBe(m.COULEUR_NEUTRE);
        }
      }
    }
    expect(vus.size, 'les trois cultures apparaissent dans la saison de la démo').toBe(3);
  });

  it('une famille de la démo sans couleur propre n’existe plus : aucune culture de la semaine courante au neutre', () => {
    const plan = planDemo();
    const courante = plan.semaineCourante ?? 0;
    for (const v of m.versScene(plan, courante).volumes) {
      if (v.culture !== null) expect(v.couleur, v.culture).not.toBe(m.COULEUR_NEUTRE);
    }
  });
});

describe('T27b : COULEUR_ESTOMPEE', () => {
  it('un hexadécimal, distinct de chaque couleur de famille (ΔE ≥ 10)', () => {
    expect(m.COULEUR_ESTOMPEE).toMatch(/^#[0-9a-fA-F]{6}$/);
    for (const cle of CLES_FAMILLES) expect(deltaE76(m.COULEUR_ESTOMPEE, bande(cle)), cle).toBeGreaterThanOrEqual(10);
  });
});

describe('T27b : options de filtre de la semaine', () => {
  it('familles présentes seulement, dans l’ordre canonique, « autre » comprise ; la planche vide n’en ajoute pas', () => {
    const o = m.optionsFiltres(scene());
    expect(o.familles).toEqual(['solanacees', 'asparagacees', 'cucurbitacees', 'rosacees', 'autre']);
    expect([...o.familles].sort((a, b) => CLES_FAMILLES.indexOf(a as never) - CLES_FAMILLES.indexOf(b as never))).toEqual([...o.familles]);
  });

  it('cultures distinctes, triées ; zones dans l’ordre du plan', () => {
    const o = m.optionsFiltres(scene());
    expect(o.cultures).toEqual(['Asperge', 'Courgette', 'Couverture', 'Fraise', 'Mystère', 'Tomate']);
    expect(o.zones).toEqual([
      { id: 'z1', nom: 'Tunnel 1' },
      { id: 'z2', nom: 'Serre' },
    ]);
  });

  it('suit la semaine : sans culture, aucune famille ni culture', () => {
    const vide: Plan3d = { ...PLAN, lignes: [{ sorte: 'zone', id: 'z1', nom: 'Tunnel 1' }, planche('p1', 'z1', [])] };
    const o = m.optionsFiltres(m.versScene(vide, 0));
    expect(o.familles).toEqual([]);
    expect(o.cultures).toEqual([]);
    expect(o.zones).toEqual([{ id: 'z1', nom: 'Tunnel 1' }]);
  });
});

describe('T27b : filtres (estompé, pas retiré)', () => {
  it('tout coché : rien n’est estompé', () => {
    expect(estompes(m.appliquerFiltres(scene(), TOUT()))).toEqual([]);
  });

  it('« rien » coché : tout est estompé, planche vide comprise', () => {
    const f = m.appliquerFiltres(scene(), m.FILTRES_RIEN);
    expect(nonEstompes(f)).toEqual([]);
    expect(f.volumes).toHaveLength(8);
  });

  it('filtre famille', () => {
    const f = m.appliquerFiltres(scene(), avec(TOUT(), 'familles', ['solanacees']));
    expect(nonEstompes(f)).toEqual(['p3', 'p6']);
    expect(estompes(f)).toEqual(['p1', 'p2', 'p4', 'p5', 'p7', 'p8']);
  });

  it('filtre famille « autre » : couverture et culture à famille nulle', () => {
    expect(nonEstompes(m.appliquerFiltres(scene(), avec(TOUT(), 'familles', ['autre'])))).toEqual(['p7', 'p8']);
  });

  it('filtre culture', () => {
    expect(nonEstompes(m.appliquerFiltres(scene(), avec(TOUT(), 'cultures', ['Fraise', 'Asperge'])))).toEqual(['p2', 'p5']);
  });

  it('filtre zone : la planche vide de la zone cochée reste cochée', () => {
    const f = m.appliquerFiltres(scene(), avec(TOUT(), 'zones', ['z1']));
    expect(nonEstompes(f)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(estompes(f)).toEqual(['p5', 'p6', 'p7', 'p8']);
  });

  it('combinaison : une planche doit être cochée sur chaque dimension', () => {
    const f = m.appliquerFiltres(scene(), avec(avec(TOUT(), 'familles', ['solanacees', 'rosacees']), 'zones', ['z2']));
    expect(nonEstompes(f)).toEqual(['p5', 'p6']);
    const g = m.appliquerFiltres(scene(), avec(avec(avec(TOUT(), 'familles', ['solanacees']), 'cultures', ['Tomate']), 'zones', ['z1']));
    expect(nonEstompes(g)).toEqual(['p3']);
    // Famille et culture qui ne se recoupent pas : tout est estompé.
    expect(nonEstompes(m.appliquerFiltres(scene(), avec(avec(TOUT(), 'familles', ['solanacees']), 'cultures', ['Fraise'])))).toEqual([]);
  });

  it('un ensemble vide sur une seule dimension estompe tout', () => {
    for (const dim of ['familles', 'cultures', 'zones'] as const) expect(nonEstompes(m.appliquerFiltres(scene(), avec(TOUT(), dim, []))), dim).toEqual([]);
  });

  it('estompe(volume, filtres) est le même verdict, volume par volume', () => {
    const s = scene();
    const filtres = avec(TOUT(), 'familles', ['cucurbitacees', 'autre']);
    const f = m.appliquerFiltres(s, filtres);
    for (const [k, v] of s.volumes.entries()) expect(m.estompe(v, filtres), v.id).toBe(f.volumes[k]?.estompe);
  });
});

describe('T27b : appliquerFiltres ne change que les couleurs', () => {
  it('géométrie, ordre et socles identiques à versScene ; couleur d’origine si coché, COULEUR_ESTOMPEE sinon', () => {
    const s = scene();
    const f = m.appliquerFiltres(s, avec(TOUT(), 'familles', ['solanacees']));
    expect(f.socles).toEqual(s.socles);
    expect(f.semaine).toBe(s.semaine);
    expect(f.libelleSemaine).toBe(s.libelleSemaine);
    expect(ids(f.volumes)).toEqual(ids(s.volumes));
    for (const [k, v] of f.volumes.entries()) {
      const o = s.volumes[k];
      expect(o, v.id).toBeDefined();
      expect({ x: v.x, z: v.z, longueur: v.longueur, largeur: v.largeur, hauteur: v.hauteur }, v.id).toEqual({ x: o?.x, z: o?.z, longueur: o?.longueur, largeur: o?.largeur, hauteur: o?.hauteur });
      expect({ culture: v.culture, occupationId: v.occupationId, cleFamille: v.cleFamille, code: v.code, zoneId: v.zoneId }).toEqual({
        culture: o?.culture,
        occupationId: o?.occupationId,
        cleFamille: o?.cleFamille,
        code: o?.code,
        zoneId: o?.zoneId,
      });
      expect(v.couleur, v.id).toBe(v.estompe ? m.COULEUR_ESTOMPEE : o?.couleur);
    }
  });

  it('vide ≠ culture : la planche vide est plus basse (ou à plat), les cultures gardent leur hauteur, filtre ou pas', () => {
    for (const filtres of [TOUT(), m.FILTRES_RIEN, avec(TOUT(), 'familles', ['solanacees'])]) {
      for (const v of m.appliquerFiltres(scene(), filtres).volumes) {
        if (v.culture === null) {
          expect(v.hauteurRendue, `${v.id} vide`).toBeLessThan(v.hauteur);
          expect(v.hauteurRendue, `${v.id} vide`).toBeGreaterThanOrEqual(0);
        } else {
          expect(v.hauteurRendue, `${v.id} culture`).toBe(v.hauteur);
        }
      }
    }
  });

  it('pure : l’entrée n’est pas modifiée, même entrée → même sortie', () => {
    const s = scene();
    const copie = structuredClone(s);
    const filtres = avec(TOUT(), 'zones', ['z1']);
    const a = m.appliquerFiltres(s, filtres);
    const b = m.appliquerFiltres(s, filtres);
    expect(s).toEqual(copie);
    expect(a).toEqual(b);
    expect(filtres.zones).toEqual(new Set(['z1']));
  });
});

describe('T27b : cocher, décocher, tout, rien', () => {
  const univers = ['solanacees', 'asparagacees', 'cucurbitacees', 'rosacees', 'autre'];

  it('décocher depuis « tout » donne l’univers moins la valeur ; recocher redonne « tout »', () => {
    const f = m.basculerFiltre(TOUT(), 'familles', 'solanacees', univers);
    expect(f.familles).toEqual(new Set(['asparagacees', 'cucurbitacees', 'rosacees', 'autre']));
    expect(f.cultures).toBeNull();
    expect(f.zones).toBeNull();
    expect(m.basculerFiltre(f, 'familles', 'solanacees', univers)).toEqual(TOUT());
  });

  it('cocher une valeur depuis « rien » : un ensemble d’un seul élément', () => {
    const f = m.basculerFiltre(m.cocherRien(TOUT(), 'zones'), 'zones', 'z2', ['z1', 'z2']);
    expect(f.zones).toEqual(new Set(['z2']));
  });

  it('cocherTout / cocherRien ne touchent que la dimension demandée', () => {
    const base = avec(avec(TOUT(), 'familles', ['rosacees']), 'zones', ['z1']);
    const rien = m.cocherRien(base, 'cultures');
    expect(rien.cultures).toEqual(new Set());
    expect(rien.familles).toEqual(new Set(['rosacees']));
    expect(rien.zones).toEqual(new Set(['z1']));
    const tout = m.cocherTout(base, 'familles');
    expect(tout.familles).toBeNull();
    expect(tout.zones).toEqual(new Set(['z1']));
  });

  it('FILTRES_RIEN : trois ensembles vides ; FILTRES_TOUT : trois null', () => {
    expect(m.FILTRES_TOUT).toEqual({ familles: null, cultures: null, zones: null });
    expect(m.FILTRES_RIEN).toEqual({ familles: new Set(), cultures: new Set(), zones: new Set() });
  });

  it('pures : les filtres reçus ne sont jamais modifiés', () => {
    const base = avec(TOUT(), 'familles', ['rosacees', 'autre']);
    m.basculerFiltre(base, 'familles', 'rosacees', univers);
    m.cocherRien(base, 'familles');
    m.cocherTout(base, 'familles');
    expect(base.familles).toEqual(new Set(['rosacees', 'autre']));
    expect(m.FILTRES_TOUT).toEqual({ familles: null, cultures: null, zones: null });
  });
});
