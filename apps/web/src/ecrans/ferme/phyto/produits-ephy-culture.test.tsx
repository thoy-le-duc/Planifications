// @vitest-environment happy-dom
/**
 * Tests d'acceptation T76 — fiche produit (niveau ferme), règle 1 de
 * docs/backlog/T76-ephy-dar-culture-traitee.md : la recherche e-phy remplit AMM, substances et
 * mention bio, mais ne fixe PAS un DAR unique quand les cultures de la ferme ont des usages
 * différents ou absents ; elle affiche les usages par culture.
 *
 * Contrat ajouté (en plus de ./test/contrat.ts, T53) : sous la suggestion choisie, un bloc
 * [data-testid="usages-culture"][data-culture=<espèce de la ferme>] par espèce cultivée ; son
 * texte dit « non homologué » quand le produit n'a aucun usage pour elle, sinon liste ses usages
 * (« <culture> · <cible> · <dose> · DAR <n> j »). Les radios de choix de l'usage (T53) restent.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import type { ModulePhyto, ProprietesEcranPhyto } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, MAINTENANT, type Banc } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, radio, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;


const usage = (culture: string, cible: string, dar: number | null, dose: { valeur: number; unite: string } | null = { valeur: 0.2, unite: 'L/ha' }) => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });

const FRAISIER_SEUL: ProduitEphy = { amm: '2060098', nom: 'FRAISIOR', autresNoms: [], substances: ['spinosad 480 g/L'], bio: true, retire: false, retireLe: null, usages: [usage('Fraisier', 'Thrips', 1)] };
const TOMATE_FRAISE_ACCORD: ProduitEphy = { amm: '2060099', nom: 'ACCORDIOR', autresNoms: [], substances: ['soufre'], bio: false, retire: false, retireLe: null, usages: [usage('Tomate - Aubergine', 'Oïdium(s)', 3), usage('Fraisier', 'Oïdium(s)', 3)] };

const CATALOGUE: CatalogueEphy = { format: 1, source: 'E-Phy, Anses', licence: 'Licence Ouverte 2.0', dateBase: '2026-10-14', produits: [FRAISIER_SEUL, TOMATE_FRAISE_ACCORD] };

const id = (n: number) => `0192f0c1-5353-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Espèces cultivées par la ferme : une série (ou une plantation) chacune. Tables locales sans contrainte. */
async function cultiver(...noms: string[]): Promise<void> {
  for (const [i, nom] of noms.entries()) {
    await b.base.execute('INSERT INTO espece (id, ferme_id, nom, supprime_le) VALUES (?, ?, ?, NULL)', [id(0x100 + i), FERME, nom]);
    if (i % 2 === 0) await b.base.execute('INSERT INTO serie (id, ferme_id, espece_id, supprime_le) VALUES (?, ?, ?, NULL)', [id(0x200 + i), FERME, id(0x100 + i)]);
    else await b.base.execute('INSERT INTO plantation (id, ferme_id, espece_id, supprime_le) VALUES (?, ?, ?, NULL)', [id(0x300 + i), FERME, id(0x100 + i)]);
  }
}

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

async function ouvrirFormulaire(catalogue: CatalogueEphy = CATALOGUE): Promise<HTMLElement> {
  const p: ProprietesEcranPhyto = {
    porte: b.porte,
    fermeId: FERME,
    aujourdhui: () => AUJOURDHUI,
    maintenant: () => MAINTENANT,
    surFermer: () => undefined,
    chargerCatalogue: () => {
      return Promise.resolve(catalogue);
    },
  };
  await act(async () => {
    racine.render(createElement(m.EcranProduitsPhyto, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Produits phyto') !== undefined, 'dialogue « Produits phyto »');
  await toucher(bouton('Nouveau produit'));
  return dialogueOuEchec('Nouveau produit');
}

async function chercher(d: HTMLElement, texteTape: string): Promise<void> {
  await remplir(champ('Chercher dans e-phy', d), texteTape);
  await attendre(() => suggestions().length > 0, `suggestions pour « ${texteTape} »`);
}

function suggestion(nom: string): HTMLElement {
  const s = suggestions().find((x) => texte(x).startsWith(nom));
  if (s === undefined) throw new Error(`suggestion ${nom} absente (vues : ${suggestions().map(texte).join(' | ')})`);
  return s;
}


const bloc = (culture: string): HTMLElement => {
  const e = document.querySelector<HTMLElement>(`[data-testid="usages-culture"][data-culture="${culture}"]`);
  if (e === null) throw new Error(`bloc d’usages de ${culture} absent`);
  return e;
};

describe('T76 : fiche produit — le DAR ne vient pas d’une autre culture de la ferme', () => {
  it('ferme tomate + fraise, produit homologué sur Fraisier seul : DAR et dose vides, usages par culture (tomate non homologuée)', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisior');
    b.remiseAZero();
    await toucher(suggestion('FRAISIOR'));
    expect(b.transactions()).toBe(0);
    // AMM, substance et bio sont repris.
    expect(champ('N° AMM', d).value).toBe('2060098');
    expect(champ('Substance active', d).value).toBe('spinosad 480 g/L');
    expect(champ('Utilisable en bio', d).checked).toBe(true);
    // Mais pas le DAR du fraisier, qui ne vaut pas pour la tomate.
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    expect(champ('Dose maximale', d).value).toBe('');
    expect(texte(bloc('Tomate'))).toMatch(/non homologué/i);
    expect(texte(bloc('Fraise'))).toContain('Fraisier · Thrips · 0,2 L/ha · DAR 1 j');
    expect(texte(bloc('Fraise'))).not.toMatch(/non homologué/i);
  });

  it('le DAR du fraisier ne se remplit que si l’utilisateur choisit lui-même l’usage', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisior');
    await toucher(suggestion('FRAISIOR'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    await toucher(radio('Fraisier · Thrips · 0,2 L/ha · DAR 1 j', d));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('1');
  });

  it('ferme fraise seule : DAR proposé (la culture de la ferme est homologuée)', async () => {
    await cultiver('Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisior');
    await toucher(suggestion('FRAISIOR'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('1');
  });

  it('tomate + fraise, produit homologué sur les deux avec le même DAR : DAR proposé', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'accordior');
    await toucher(suggestion('ACCORDIOR'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    expect(texte(bloc('Tomate'))).not.toMatch(/non homologué/i);
  });

  it('une autre ferme ne compte pas : ses espèces ne changent pas la proposition', async () => {
    await cultiver('Fraise');
    await b.base.execute('INSERT INTO espece (id, ferme_id, nom, supprime_le) VALUES (?, ?, ?, NULL)', [id(0x900), id(0x901), 'Tomate']);
    await b.base.execute('INSERT INTO serie (id, ferme_id, espece_id, supprime_le) VALUES (?, ?, ?, NULL)', [id(0x902), id(0x901), id(0x900)]);
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisior');
    await toucher(suggestion('FRAISIOR'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('1');
  });
});
