// @vitest-environment happy-dom
/**
 * Test d'acceptation T61 — l'écran Planches ouvre la vue 3D tout seul quand on lui donne un
 * rangement à montrer (docs/backlog/T61-chemins-outils.md, règle 3 : « un tap montre le chemin
 * dans la 3D »), et la vue reçoit la cible. Le morceau 3D est remplacé par un double (WebGL
 * disponible) ; la ferme est celle de T11b.
 *
 * ── Contrat (EcranPlan, en plus de ProprietesEcranPlan) ─────────────────────────────────────
 *   rangement?        { outilId, plancheId } | null : non nul, l'écran ouvre la vue 3D sans que
 *                     l'on touche « Voir en 3D » (si WebGL manque, le repli habituel s'affiche) ;
 *   surFermerRangement?  () => void : appelé quand la vue 3D se ferme (« Retour ») ou que la vue
 *                     demande de fermer le rangement.
 *   La vue 3D (Vue3d) reçoit `rangement` tel quel et `surFermerRangement`, avec `porte` et
 *   `fermeId` de l'écran. Sans rangement, rien ne change : la 3D reste fermée jusqu'au tap.
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranPlan } from './test/contrat.ts';
import { FERME, remplirFermeT11b } from './test/contrat-t11b.ts';

interface ProprietesVueDouble {
  readonly rangement?: { outilId: string; plancheId: string | null } | null;
  readonly surFermerRangement?: () => void;
  readonly surRetour: () => void;
  readonly porte?: PorteDonnees;
  readonly fermeId?: string | null;
}

const rendus = vi.hoisted((): { proprietes: unknown[] } => ({ proprietes: [] }));

vi.mock('../plan3d/entree.ts', () => ({
  MARQUE_MODULE_3D: 'planif:vue-3d-module',
  webglDisponible: () => true,
  chargerVue3d: () => {
    function Vue3dDouble(p: unknown) {
      rendus.proprietes.push(p);
      const q = p as ProprietesVueDouble;
      return (
        <section data-testid="vue3d-double" data-rangement={JSON.stringify(q.rangement ?? null)} data-ferme={q.fermeId ?? ''} data-porte={q.porte === undefined ? 'non' : 'oui'}>
          <button type="button" data-testid="retour-double" onClick={q.surRetour}>
            Retour
          </button>
          <button type="button" data-testid="fermer-rangement-double" onClick={() => q.surFermerRangement?.()}>
            Fermer le rangement
          </button>
        </section>
      );
    }
    return Promise.resolve({ Vue3d: Vue3dDouble as ComponentType });
  },
}));

const AUJOURDHUI = '2026-09-30';
let ecran: ModuleEcranPlan;
let base: BaseMemoire;
let porte: PorteDonnees;

beforeAll(async () => {
  ecran = await import('./index.ts');
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await remplirFermeT11b(base);
  porte = creerPorte(base, { utilisateurId: '0192f0c1-0000-7000-8000-0000000000aa' as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
}, 60_000);

afterAll(() => {
  base.fermer();
});

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  rendus.proprietes = [];
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
});

async function laisserFinir(tours = 40): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function rendre(proprietes: Record<string, unknown>): Promise<void> {
  const Ecran = ecran.EcranPlan as unknown as ComponentType<Record<string, unknown>>;
  await act(async () => {
    racine.render(<Ecran porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} utilisateurId="0192f0c1-0000-7000-8000-0000000000aa" {...proprietes} />);
    await Promise.resolve();
  });
  await laisserFinir();
}

const vue = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="vue3d-double"]');

describe('T61 : l’écran Planches ouvre la 3D sur un rangement', () => {
  it('sans rangement : la 3D reste fermée', async () => {
    await rendre({});
    expect(vue()).toBeNull();
  });

  it('avec un rangement : la 3D s’ouvre seule, avec la cible, la porte et la ferme', async () => {
    await rendre({ rangement: { outilId: 'outil-1', plancheId: 'planche-1' }, surFermerRangement: () => undefined });
    expect(vue(), 'vue 3D ouverte').not.toBeNull();
    expect(JSON.parse(vue()?.getAttribute('data-rangement') ?? 'null')).toEqual({ outilId: 'outil-1', plancheId: 'planche-1' });
    expect(vue()?.getAttribute('data-porte')).toBe('oui');
    expect(vue()?.getAttribute('data-ferme')).toBe(FERME);
  });

  it('« Retour » de la 3D et la fermeture du rangement appellent surFermerRangement', async () => {
    const surFermerRangement = vi.fn();
    await rendre({ rangement: { outilId: 'outil-1', plancheId: null }, surFermerRangement });
    conteneur.querySelector<HTMLElement>('[data-testid="fermer-rangement-double"]')?.click();
    expect(surFermerRangement).toHaveBeenCalledTimes(1);
    await act(async () => {
      conteneur.querySelector<HTMLElement>('[data-testid="retour-double"]')?.click();
      await Promise.resolve();
    });
    expect(surFermerRangement).toHaveBeenCalledTimes(2);
  });
});
