// @vitest-environment happy-dom
/**
 * (suites) Démontage et échec pendant l'indexation par tranches de la recherche e-phy.
 * Tests d'acceptation T84 — écran : recherche e-phy par culture ou cible
 * (docs/backlog/T84-ephy-recherche-culture-cible.md, règles 4 à 6).
 *
 * Contrat ajouté à ./test/contrat.ts : dans chaque suggestion trouvée par la culture ou la cible,
 * un élément [data-testid="usage-trouve"] avec « <culture> · <cible> · DAR <n> j » (« DAR non
 * précisé » si absent), suivi de « + N usage(s) » quand d'autres usages correspondent aussi ;
 * sous la liste, quand il y a plus de 8 résultats, [data-testid="autres-ephy"] :
 * « N autres produits : précisez la recherche » (« 1 autre produit » au singulier).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import type { ModulePhyto, ProprietesEcranPhyto } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, MAINTENANT, type Banc } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, remplir, toucher, unTour } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

const produit = (amm: string, nom: string, substance: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: [substance], bio: false, retire: false, retireLe: null, usages });

const CATALOGUE: CatalogueEphy = { format: 1, source: 'E-Phy, Anses', licence: 'Licence Ouverte 2.0', dateBase: '2026-10-14', produits: [] };

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModulePhyto;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
  vi.unstubAllGlobals();
});

/** Catalogue de 500 produits dont chaque lecture d'`usages` est comptée (une par produit indexé). */
function catalogueCompte(): { catalogue: CatalogueEphy; lectures: () => number } {
  let n = 0;
  const produits = Array.from({ length: 500 }, (_, i): ProduitEphy => {
    const p = produit(String(4000000 + i), `P${String(i)}`, 'cuivre', []);
    return Object.defineProperty({ ...p }, 'usages', {
      enumerable: true,
      get: () => {
        n++;
        return [];
      },
    });
  });
  return { catalogue: { ...CATALOGUE, produits }, lectures: () => n };
}

async function ouvrirAvec(charger: () => Promise<CatalogueEphy>): Promise<HTMLElement> {
  const p: ProprietesEcranPhyto = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined, chargerCatalogue: charger };
  await act(async () => {
    racine.render(createElement(m.EcranProduitsPhyto, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Produits phyto') !== undefined, 'dialogue « Produits phyto »');
  await toucher(bouton('Nouveau produit'));
  return dialogueOuEchec('Nouveau produit');
}

describe('T84 : indexation par tranches', () => {
  it('démonté pendant l’indexation : la boucle de tranches s’arrête, aucune erreur React', async () => {
    const { catalogue, lectures } = catalogueCompte();
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let livrer: (c: CatalogueEphy) => void = () => undefined;
    const d = await ouvrirAvec(() => new Promise<CatalogueEphy>((ok) => (livrer = ok)));
    await remplir(champ('Chercher dans e-phy', d), 'cuivre');
    livrer(catalogue);
    for (let k = 0; k < 5 && lectures() === 0; k++) await unTour();
    expect(lectures()).toBeGreaterThan(0);
    act(() => {
      racine.unmount();
    });
    const auDemontage = lectures();
    for (let k = 0; k < 20; k++) await unTour();
    expect(lectures()).toBeLessThanOrEqual(auDemontage + 50);
    expect(lectures()).toBeLessThan(500);
    expect(erreurs).not.toHaveBeenCalled();
    racine = createRoot(conteneur);
  });

  it('démonté avant la livraison du catalogue : rien n’est indexé', async () => {
    const { catalogue, lectures } = catalogueCompte();
    let livrer: (c: CatalogueEphy) => void = () => undefined;
    const d = await ouvrirAvec(() => new Promise<CatalogueEphy>((ok) => (livrer = ok)));
    await remplir(champ('Chercher dans e-phy', d), 'cuivre');
    act(() => {
      racine.unmount();
    });
    livrer(catalogue);
    for (let k = 0; k < 10; k++) await unTour();
    expect(lectures()).toBe(0);
    racine = createRoot(conteneur);
  });

  it('une exception pendant l’indexation mène à l’erreur, pas à un « Chargement » sans fin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const casse = Object.defineProperty({ ...produit('1', 'CASSE', 'x', []) }, 'usages', {
      enumerable: true,
      get: () => {
        throw new Error('index cassé');
      },
    });
    const d = await ouvrirAvec(() => Promise.resolve({ ...CATALOGUE, produits: [casse] }));
    await remplir(champ('Chercher dans e-phy', d), 'cuivre');
    await attendre(() => d.textContent.includes('index cassé'), 'message d’erreur');
    expect(d.textContent).not.toContain('Chargement de la base');
  });
});
