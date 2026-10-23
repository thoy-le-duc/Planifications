// @vitest-environment happy-dom
/**
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
import { attendre, bouton, champ, dialogue, dialogueOuEchec, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

const usage = (culture: string, cible: string, dar: number | null) => ({ culture, mode: 'Trt Part.Aer.', cible, dose: null, dar });
const produit = (amm: string, nom: string, substance: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: [substance], bio: false, retire: false, retireLe: null, usages });

const SOUFRIX = produit('2000001', 'SOUFRIX', 'soufre', [usage('Tomate - Aubergine', 'Oïdium(s)', 3), usage('Tomate - Aubergine', 'Botrytis', 3), usage('Vigne', 'Oïdium(s)', 5)]);
const DELTAGARD = produit('2000002', 'DELTAGARD', 'deltaméthrine', [usage('Tomate - Aubergine', 'Pucerons', 3)]);
const CATALOGUE: CatalogueEphy = { format: 1, source: 'E-Phy, Anses', licence: 'Licence Ouverte 2.0', dateBase: '2026-10-14', produits: [SOUFRIX, DELTAGARD] };
const BEAUCOUP: CatalogueEphy = {
  ...CATALOGUE,
  produits: Array.from({ length: 10 }, (_, i) => produit(`31000${String(10 + i)}`, `CUIVRE ${String.fromCharCode(65 + i)}`, 'cuivre', [usage('Tomate - Aubergine', 'Mildiou', 2)])),
};

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

const suggestions = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="suggestion-ephy"]')];

async function ouvrirFormulaire(catalogue: CatalogueEphy): Promise<HTMLElement> {
  const p: ProprietesEcranPhyto = {
    porte: b.porte,
    fermeId: FERME,
    aujourdhui: () => AUJOURDHUI,
    maintenant: () => MAINTENANT,
    surFermer: () => undefined,
    chargerCatalogue: () => Promise.resolve(catalogue),
  };
  await act(async () => {
    racine.render(createElement(m.EcranProduitsPhyto, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Produits phyto') !== undefined, 'dialogue « Produits phyto »');
  await toucher(bouton('Nouveau produit'));
  return dialogueOuEchec('Nouveau produit');
}

async function chercher(d: HTMLElement, tape: string): Promise<void> {
  await remplir(champ('Chercher dans e-phy', d), tape);
  await attendre(() => suggestions().length > 0, `suggestions pour « ${tape} »`);
}

describe('T84 : l’usage trouvé sous le nom du produit', () => {
  it('« tomate pucerons » : la ligne de DELTAGARD montre l’usage ; un tap remplit la fiche comme avant', async () => {
    const d = await ouvrirFormulaire(CATALOGUE);
    await chercher(d, 'tomate pucerons');
    expect(suggestions().map((s) => s.dataset.amm)).toEqual(['2000002']);
    const s = suggestions()[0];
    const ligne = s?.querySelector('[data-testid="usage-trouve"]');
    expect(ligne?.textContent).toBe('Tomate - Aubergine · Pucerons · DAR 3 j');
    expect(texte(s as HTMLElement)).not.toContain('+');
    b.remiseAZero();
    await toucher(s as HTMLElement);
    expect(b.transactions()).toBe(0);
    expect(champ('Nom commercial', d).value).toBe('DELTAGARD');
    expect(champ('N° AMM', d).value).toBe('2000002');
    expect(champ('Substance active', d).value).toBe('deltaméthrine');
  });

  it('plusieurs usages qui correspondent : le premier, puis « + N usages »', async () => {
    const d = await ouvrirFormulaire(CATALOGUE);
    await chercher(d, 'tomate');
    const s = suggestions().find((x) => x.dataset.amm === '2000001');
    expect(s?.querySelector('[data-testid="usage-trouve"]')?.textContent).toBe('Tomate - Aubergine · Oïdium(s) · DAR 3 j + 1 usage');
    await chercher(d, 'oidium');
    const t = suggestions().find((x) => x.dataset.amm === '2000001');
    expect(t?.querySelector('[data-testid="usage-trouve"]')?.textContent).toBe('Tomate - Aubergine · Oïdium(s) · DAR 3 j + 1 usage');
  });

  it('trouvé par le nom : pas de ligne d’usage', async () => {
    const d = await ouvrirFormulaire(CATALOGUE);
    await chercher(d, 'deltagard');
    expect(suggestions()[0]?.querySelector('[data-testid="usage-trouve"]')).toBeNull();
  });
});

describe('T84 : plus de 8 résultats', () => {
  it('8 lignes et « 2 autres produits : précisez la recherche »', async () => {
    const d = await ouvrirFormulaire(BEAUCOUP);
    await chercher(d, 'tomate');
    expect(suggestions()).toHaveLength(8);
    expect(document.querySelector('[data-testid="autres-ephy"]')?.textContent).toBe('2 autres produits : précisez la recherche');
  });
  it('pas de message quand tout tient', async () => {
    const d = await ouvrirFormulaire(CATALOGUE);
    await chercher(d, 'tomate');
    expect(document.querySelector('[data-testid="autres-ephy"]')).toBeNull();
  });
});
