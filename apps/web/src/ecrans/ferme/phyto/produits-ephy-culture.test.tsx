// @vitest-environment happy-dom
/**
 * Tests d'acceptation T76 (docs/backlog/T76-ephy-dar-culture-traitee.md, règle 1) — fiche produit
 * (niveau ferme) : la recherche e-phy remplit AMM, substances et mention bio, mais ne fixe plus
 * un DAR unique quand les cultures de la ferme ont des usages différents ou absents ; elle affiche
 * les usages PAR CULTURE de la ferme.
 *
 * Contrat d'affichage ajouté (dans le dialogue « Nouveau produit », après le tap sur une suggestion,
 * dès que la ferme a au moins une espèce cultivée) : une région [data-testid="usages-par-culture"]
 * avec, par espèce cultivée (ordre alphabétique), un élément [data-testid="usage-culture"]
 * [data-culture=<nom de l'espèce>] qui contient soit « non homologué » (aucun usage du produit pour
 * l'espèce), soit un libellé par usage « <culture e-phy> · <cible> · <dose> · DAR <n> j » (ou
 * « DAR non précisé »), comme les radios existants. Les radios « Choisissez l’usage » restent.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import type { ModulePhyto, ProprietesEcranPhyto } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;


const usage = (culture: string, cible: string, dar: number | null, dose: { valeur: number; unite: string } | null = { valeur: 0.2, unite: 'L/ha' }) => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });
const produit = (amm: string, nom: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['spinosad 480 g/L'], bio: true, retire: false, retireLe: null, usages });

const FRAISIPRO = produit('2200777', 'FRAISIPRO', [usage('Fraisier', 'Thrips', 1)]);
const TOMAPRO = produit('2200778', 'TOMAPRO', [usage('Tomate', 'Thrips', 3), usage('Tomate', 'Chenilles phytophages', 3, { valeur: 0.015, unite: 'L/hL' })]);
const SANSDAR = produit('2200779', 'SANSDAR', [usage('Fraisier', 'Oïdium(s)', null)]);
const CATALOGUE: CatalogueEphy = { format: 1, source: 'E-Phy, Anses (data.gouv.fr)', licence: 'Licence Ouverte 2.0', dateBase: '2026-10-14', produits: [FRAISIPRO, TOMAPRO, SANSDAR] };

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

const produits = (): Ligne[] => lire(b, 'SELECT * FROM produit_phyto WHERE ferme_id = ? ORDER BY cree_le, id', [FERME]);
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


const zone = (d: HTMLElement): HTMLElement => {
  const z = d.querySelector<HTMLElement>('[data-testid="usages-par-culture"]');
  if (z === null) throw new Error(`région « usages par culture » absente (vue : ${texte(d)})`);
  return z;
};
const ligneCulture = (d: HTMLElement, espece: string): HTMLElement => {
  const l = [...zone(d).querySelectorAll<HTMLElement>('[data-testid="usage-culture"]')].find((x) => x.dataset.culture === espece);
  if (l === undefined) throw new Error(`culture ${espece} absente des usages par culture`);
  return l;
};

describe('T76 : fiche produit, usages par culture, pas de DAR unique trompeur', () => {
  it('ferme tomate + fraise, produit sur Fraisier seul : DAR laissé vide (pas celui de la fraise), AMM, substances, bio remplis, usages par culture affichés', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisipro');
    b.remiseAZero();
    await toucher(suggestion('FRAISIPRO'));
    expect(b.transactions()).toBe(0);
    expect(champ('Nom commercial', d).value).toBe('FRAISIPRO');
    expect(champ('N° AMM', d).value).toBe('2200777');
    expect(champ('Substance active', d).value).toBe('spinosad 480 g/L');
    expect(champ('Utilisable en bio', d).checked).toBe(true);
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    expect(texte(ligneCulture(d, 'Tomate'))).toMatch(/non homologué/i);
    expect(texte(ligneCulture(d, 'Tomate'))).not.toMatch(/DAR/);
    expect(texte(ligneCulture(d, 'Fraise'))).toContain('Fraisier · Thrips · 0,2 L/ha · DAR 1 j');
  });

  it('une culture de la ferme sans usage (kiwi) empêche de fixer le DAR de la tomate', async () => {
    await cultiver('Tomate', 'Kiwi');
    const d = await ouvrirFormulaire();
    await chercher(d, 'tomapro');
    await toucher(suggestion('TOMAPRO'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    expect(texte(ligneCulture(d, 'Kiwi'))).toMatch(/non homologué/i);
    expect(texte(ligneCulture(d, 'Tomate'))).toContain('DAR 3 j');
    expect(champ('N° AMM', d).value).toBe('2200778');
  });

  it('une seule culture, usages d’accord : DAR proposé (T53 conservé), usages par culture affichés', async () => {
    await cultiver('Tomate');
    const d = await ouvrirFormulaire();
    await chercher(d, 'tomapro');
    await toucher(suggestion('TOMAPRO'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    expect(texte(ligneCulture(d, 'Tomate'))).toContain('Tomate · Thrips · 0,2 L/ha · DAR 3 j');
    expect(texte(ligneCulture(d, 'Tomate'))).toContain('Tomate · Chenilles phytophages · 0,015 L/hL · DAR 3 j');
  });

  it('DAR absent dans e-phy (Q47) : champ laissé vide, « DAR non précisé » affiché, enregistrement refusé tant qu’il est vide', async () => {
    await cultiver('Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'sansdar');
    await toucher(suggestion('SANSDAR'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    expect(texte(ligneCulture(d, 'Fraise'))).toContain('DAR non précisé');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    expect(d.querySelector('[role="alert"]')).not.toBeNull();
    expect(texte(d)).toMatch(/Délai avant récolte/);
    expect(b.transactions()).toBe(0);
    expect(produits()).toHaveLength(0);
  });

  it('le DAR saisi à la main par le maraîcher reste possible et s’enregistre', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'fraisipro');
    await toucher(suggestion('FRAISIPRO'));
    await remplir(champ('Délai avant récolte (jours)', d), '2');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => produits().length === 1, 'produit écrit');
    expect(produits()[0]).toMatchObject({ numero_amm: '2200777', delai_avant_recolte_jours: 2, utilisable_en_bio: 1 });
  });
});
