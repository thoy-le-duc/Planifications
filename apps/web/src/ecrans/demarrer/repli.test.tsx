// @vitest-environment happy-dom
/**
 * Tests d'acceptation T65 — bandeau « Démarrer votre ferme » repliable partout
 * (docs/backlog/T65-bandeau-demarrer-repliable.md, règles 1 et 2).
 *
 * Contrat (en plus de celui de T49, ./test/contrat.ts) :
 * - la région [data-testid="demarrer-ferme"] porte `data-replie="oui"` (replié : une ligne, la
 *   prochaine étape) ou `data-replie="non"` (déplié : les 4 étapes) ;
 * - un bouton bascule : « Voir les étapes » (replié, aria-expanded="false") ou « Replier »
 *   (déplié, aria-expanded="true") ;
 * - les 4 boutons d'étape restent dans le DOM dans les deux états (le CSS cache les autres que la
 *   prochaine quand le bandeau est replié) : la prochaine étape se fait d'un tap, replié ou non ;
 * - par défaut replié sous 600 px de large, déplié au-delà ; le choix est retenu par ferme
 *   (stockage local) et survit au démontage ; un stockage qui refuse ne casse rien.
 * La hauteur (≤ 40 % de l'écran) et ce qui est caché se mesurent dans un vrai navigateur :
 * e2e/demarrer-repli.e2e.ts.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CibleDemarrage, ModuleBandeau } from './test/contrat.ts';
import { FERME } from '../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, type Banc } from '../parcellaire/test/outils.ts';
import { attendre, bouton, toucher } from '../itineraires/test/outils.ts';

const CHEMIN_BANDEAU = './BandeauDemarrer.tsx';
const CHEMIN_PLAN = '../plan/index.ts';
const CHEMIN_AUJOURDHUI = '../aujourdhui/index.ts';

interface ProprietesEcran {
  readonly porte: Banc['porte'] | null;
  readonly fermeId: string;
  readonly aujourdhui?: () => string;
  readonly surOnglet?: (o: 'ferme' | 'planches') => void;
}
interface ModulePlan {
  readonly EcranPlan: (p: ProprietesEcran) => ReactElement;
}
interface ModuleAujourdhui {
  readonly EcranAujourdhui: (p: ProprietesEcran) => ReactElement;
}

/** Fenêtre de happy-dom : la largeur d'écran simulée. */
interface FenetreHappyDom {
  readonly happyDOM: { setViewport(v: { width: number; height: number }): void };
}
const ecran = (width: number, height: number): void => {
  (window as unknown as FenetreHappyDom).happyDOM.setViewport({ width, height });
};

const AUTRE_FERME = '0192f0c1-4949-7000-8000-0000000000ff';

let bandeauM: ModuleBandeau;
let plan: ModulePlan;
let aujourdhui: ModuleAujourdhui;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  bandeauM = (await import(/* @vite-ignore */ CHEMIN_BANDEAU)) as ModuleBandeau;
  plan = (await import(/* @vite-ignore */ CHEMIN_PLAN)) as ModulePlan;
  aujourdhui = (await import(/* @vite-ignore */ CHEMIN_AUJOURDHUI)) as ModuleAujourdhui;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  try {
    localStorage.clear();
  } catch {
    // stockage indisponible : rien à vider
  }
  ecran(1024, 768);
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
  ecran(1024, 768);
});

async function rendre(e: ReactElement): Promise<void> {
  await act(async () => {
    racine.render(e);
    await Promise.resolve();
  });
}

/** Démonte puis remonte (comme un rechargement de l'écran). */
async function remonter(e: ReactElement): Promise<void> {
  act(() => {
    racine.unmount();
  });
  racine = createRoot(conteneur);
  await rendre(e);
}

const allers: CibleDemarrage[] = [];
const surAller = (c: CibleDemarrage): void => {
  allers.push(c);
};
const bandeau = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="demarrer-ferme"]');
const replie = (): string | undefined => bandeau()?.dataset.replie;
const etapesDuBandeau = (): HTMLElement[] => [...(bandeau()?.querySelectorAll<HTMLElement>('[data-testid="etape-demarrage"]') ?? [])];
const leBandeau = (fermeId: string = FERME) => createElement(bandeauM.BandeauDemarrer, { porte: b.porte, fermeId, surAller });

async function affiche(): Promise<HTMLElement> {
  await attendre(() => bandeau() !== null, 'bandeau affiché');
  const el = bandeau();
  if (el === null) throw new Error('bandeau absent');
  return el;
}

describe('T65 : deux états, une bascule', () => {
  it('ordinateur : déplié par défaut, « Replier » le replie, « Voir les étapes » le redéplie', async () => {
    await rendre(leBandeau());
    const el = await affiche();
    expect(replie(), 'déplié sur ordinateur').toBe('non');
    const replier = bouton('Replier', el);
    expect(replier.getAttribute('aria-expanded')).toBe('true');
    expect(etapesDuBandeau()).toHaveLength(4);

    await toucher(replier);
    expect(replie()).toBe('oui');
    const voir = bouton('Voir les étapes', el);
    expect(voir.getAttribute('aria-expanded')).toBe('false');
    expect(etapesDuBandeau(), 'les 4 étapes restent dans la page (le CSS cache les autres)').toHaveLength(4);
    expect(el.querySelector('[data-testid="etape-demarrage"].dem-etape-prochaine')?.getAttribute('data-etape'), 'la prochaine étape reste à un tap').toBe('saison');

    await toucher(voir);
    expect(replie()).toBe('non');
    expect(bouton('Replier', el).getAttribute('aria-expanded')).toBe('true');
  });

  it('téléphone (< 600 px) : replié par défaut, « Voir les étapes » le déplie', async () => {
    ecran(390, 844);
    await rendre(leBandeau());
    const el = await affiche();
    expect(replie(), 'replié sur téléphone').toBe('oui');
    await toucher(bouton('Voir les étapes', el));
    expect(replie()).toBe('non');
  });

  it('599 px : téléphone ; 600 px : ordinateur', async () => {
    ecran(599, 900);
    await rendre(leBandeau());
    await affiche();
    expect(replie()).toBe('oui');
    ecran(600, 900);
    await remonter(leBandeau(AUTRE_FERME));
    await affiche();
    expect(replie()).toBe('non');
  });
});

describe('T65 : le choix est retenu, par ferme', () => {
  it('replié sur ordinateur : il le reste au remontage ; une autre ferme garde son défaut', async () => {
    await rendre(leBandeau());
    await toucher(bouton('Replier', await affiche()));
    expect(replie()).toBe('oui');

    await remonter(leBandeau());
    await affiche();
    expect(replie(), 'choix retenu pour cette ferme').toBe('oui');

    await remonter(leBandeau(AUTRE_FERME));
    await affiche();
    expect(replie(), 'autre ferme : défaut de l’ordinateur').toBe('non');
  });

  it('déplié sur téléphone : il le reste au remontage', async () => {
    ecran(360, 800);
    await rendre(leBandeau());
    await toucher(bouton('Voir les étapes', await affiche()));
    await remonter(leBandeau());
    await affiche();
    expect(replie()).toBe('non');
  });

  it('stockage local qui refuse (navigation privée, quota) : défaut, bascule qui marche, aucune erreur', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('stockage refusé');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('stockage refusé');
    });
    ecran(390, 844);
    await rendre(leBandeau());
    const el = await affiche();
    expect(replie()).toBe('oui');
    await toucher(bouton('Voir les étapes', el));
    expect(replie()).toBe('non');
    await toucher(bouton('Replier', el));
    expect(replie()).toBe('oui');
  });
});

describe('T65 : Aujourd’hui et Planches', () => {
  const surOnglet = (): void => undefined;
  const jour = () => createElement(aujourdhui.EcranAujourdhui, { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, surOnglet });
  const planches = () => createElement(plan.EcranPlan, { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, surOnglet });

  it('téléphone : replié sur Aujourd’hui et sur Planches ; déplié dans l’un, déplié dans l’autre (même ferme)', async () => {
    ecran(390, 844);
    await rendre(jour());
    const el = await affiche();
    expect(replie(), 'Aujourd’hui, téléphone').toBe('oui');
    await toucher(bouton('Voir les étapes', el));
    expect(replie()).toBe('non');

    await remonter(planches());
    await affiche();
    expect(replie(), 'Planches : le choix fait dans Aujourd’hui').toBe('non');
    await toucher(bouton('Replier', await affiche()));
    expect(replie()).toBe('oui');

    await remonter(jour());
    await affiche();
    expect(replie(), 'Aujourd’hui : le choix fait dans Planches').toBe('oui');
  });

  it('ordinateur : déplié par défaut sur Planches aussi', async () => {
    await rendre(planches());
    await affiche();
    expect(replie()).toBe('non');
    expect(bouton('Replier', bandeau() ?? document).getAttribute('aria-expanded')).toBe('true');
  });
});
