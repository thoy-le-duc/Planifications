// @vitest-environment happy-dom
/**
 * Tests d'acceptation T53 — chercher un produit dans la base e-phy depuis la fiche produit de T52
 * (docs/backlog/T53-base-e-phy.md, règles 2 à 5). Vrai écran dans un DOM simulé (happy-dom),
 * porte sur la base mémoire d'une ferme neuve ; catalogue fourni par `chargerCatalogue` (contrat :
 * ./test/contrat.ts). Aucun appel réseau.
 *
 *   - Le catalogue n'est chargé qu'au premier usage du champ « Chercher dans e-phy », jamais à
 *     l'ouverture des produits ni du formulaire.
 *   - Quelques lettres → suggestions ; un tap remplit la fiche (nom, AMM, substance, bio), qui
 *     reste modifiable, et rien n'est écrit avant « Enregistrer ».
 *   - DAR : proposé selon les usages des espèces de la ferme (séries, plantations) quand ils sont
 *     d'accord ; sinon l'utilisateur choisit l'usage, ce qui remplit DAR et dose maximale.
 *   - Produit retiré : « retiré le JJ/MM/AAAA » dans la suggestion, avertissement à la sélection.
 *   - Source et date de la base affichées sous la recherche.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coeur from '@planif/core';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import type { ModulePhyto, ProprietesEcranPhyto } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, coche, dialogue, dialogueOuEchec, radio, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let chargements: number;

let validerProduitPhyto: (l: unknown) => { readonly ok: true } | { readonly ok: false; readonly erreur: { readonly message: string } };

const usage = (culture: string, cible: string, dar: number | null, dose: { valeur: number; unite: string } | null = { valeur: 0.2, unite: 'L/ha' }) => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });

const SUCCESS: ProduitEphy = {
  amm: '2060098',
  nom: 'SUCCESS 4',
  autresNoms: ['MUSDO 4'],
  substances: ['spinosad 480 g/L'],
  bio: true,
  retire: false,
  retireLe: null,
  usages: [usage('Tomate', 'Thrips', 3), usage('Tomate', 'Chenilles phytophages', 3, { valeur: 0.015, unite: 'L/hL' }), usage('Fraisier', 'Thrips', 1), usage('Vigne', 'Thrips', 14)],
};
const SODIEX: ProduitEphy = { amm: '9200352', nom: 'SODIEX', autresNoms: [], substances: ['soufre micronisé 80 %'], bio: true, retire: true, retireLe: '2020-09-22', usages: [usage('Melon', 'Oïdium(s)', null, { valeur: 7.5, unite: 'kg/ha' })] };
const THIOVIT: ProduitEphy = { amm: '9000186', nom: 'THIOVIT JET MICROBILLES', autresNoms: [], substances: ['soufre 80 %'], bio: true, retire: false, retireLe: null, usages: [usage('Cultures légumières', 'Oïdium(s)', 3, { valeur: 7.5, unite: 'kg/ha' })] };

const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses (data.gouv.fr, « Données ouvertes du catalogue E-Phy »)',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  produits: [SODIEX, SUCCESS, THIOVIT],
};

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
  const v = (coeur as unknown as Record<string, unknown>).validerProduitPhyto;
  if (typeof v !== 'function') throw new Error('@planif/core n’exporte pas validerProduitPhyto (T52)');
  validerProduitPhyto = v as typeof validerProduitPhyto;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  chargements = 0;
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
      chargements++;
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

describe('T53 : recherche e-phy dans la fiche produit', () => {
  it('catalogue chargé à la demande : ni à l’ouverture, ni au formulaire ; une fois à la première recherche', async () => {
    const d = await ouvrirFormulaire();
    expect(chargements).toBe(0);
    await chercher(d, 'succ');
    expect(chargements).toBe(1);
    await chercher(d, 'soufre');
    expect(chargements).toBe(1);
  });

  it('quelques lettres → suggestions ; source et date de la base sous la recherche', async () => {
    const d = await ouvrirFormulaire();
    await chercher(d, 'soufre');
    expect(suggestions().map((s) => s.dataset.amm)).toEqual(['9000186', '9200352']);
    expect(texte(d)).toMatch(/E-Phy/);
    expect(texte(d)).toMatch(/Anses/);
    expect(texte(d)).toMatch(/Licence Ouverte/);
    expect(texte(d)).toMatch(/14\/10\/2026/);
  });

  it('produit retiré : « retiré le JJ/MM/AAAA » dans la suggestion, avertissement à la sélection', async () => {
    const d = await ouvrirFormulaire();
    await chercher(d, 'sodiex');
    expect(texte(suggestion('SODIEX'))).toMatch(/retiré le 22\/09\/2020/);
    await toucher(suggestion('SODIEX'));
    expect(texte(d)).toMatch(/retiré le 22\/09\/2020/);
    expect(texte(d)).toMatch(/déconseill|plus autorisé/i);
    expect(champ('Nom commercial', d).value).toBe('SODIEX');
  });

  it('un tap remplit la fiche (DAR de l’usage tomate), modifiable ; rien n’est écrit avant « Enregistrer »', async () => {
    await cultiver('Tomate');
    const d = await ouvrirFormulaire();
    await chercher(d, 'succ');
    b.remiseAZero();
    await toucher(suggestion('SUCCESS 4'));
    expect(b.transactions()).toBe(0);
    expect(champ('Nom commercial', d).value).toBe('SUCCESS 4');
    expect(champ('N° AMM', d).value).toBe('2060098');
    expect(champ('Substance active', d).value).toBe('spinosad 480 g/L');
    expect(champ('Utilisable en bio', d).checked).toBe(true);
    // Deux usages tomate, même DAR (3 j) : DAR proposé ; doses différentes : pas de dose maximale.
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    expect(champ('Dose maximale', d).value).toBe('');
    // La fiche reste modifiable.
    await remplir(champ('Délai avant récolte (jours)', d), '5');
    await remplir(champ('Nom commercial', d), 'Success 4 (stock 2026)');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => dialogue('Nouveau produit') === undefined, 'dialogue refermé après Enregistrer');
    expect(b.transactions()).toBe(1);
    const [p] = produits();
    const r = validerProduitPhyto({ ...p });
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
    expect(p).toMatchObject({ nom_commercial: 'Success 4 (stock 2026)', numero_amm: '2060098', substance_active: 'spinosad 480 g/L', utilisable_en_bio: 1, delai_avant_recolte_jours: 5 });
  });

  it('DAR différents selon les cultures (tomate 3 j, fraise 1 j) : l’utilisateur choisit l’usage, qui remplit DAR et dose', async () => {
    await cultiver('Tomate', 'Fraise');
    const d = await ouvrirFormulaire();
    await chercher(d, 'succ');
    await toucher(suggestion('SUCCESS 4'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    expect(texte(d)).toMatch(/Choisissez l’usage/);
    // Usages des cultures de la ferme proposés ; ceux d'autres cultures (vigne) pas d'emblée.
    const fraise = radio('Fraisier · Thrips · 0,2 L/ha · DAR 1 j', d);
    expect(coche(fraise)).toBe(false);
    expect(() => radio('Vigne · Thrips · 0,2 L/ha · DAR 14 j', d)).toThrow();
    await toucher(fraise);
    expect(champ('Délai avant récolte (jours)', d).value).toBe('1');
    expect(champ('Dose maximale', d).value).toBe('0,2');
    expect(champ('Unité de la dose', d).value).toBe('L/ha');
    await toucher(radio('Tomate · Chenilles phytophages · 0,015 L/hL · DAR 3 j', d));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    expect(champ('Dose maximale', d).value).toBe('0,015');
    expect(champ('Unité de la dose', d).value).toBe('L/hL');
  });

  it('aucune culture de la ferme ne correspond : tous les usages au choix, DAR à choisir', async () => {
    await cultiver('Kiwi');
    const d = await ouvrirFormulaire();
    await chercher(d, 'succ');
    await toucher(suggestion('SUCCESS 4'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('');
    await toucher(radio('Vigne · Thrips · 0,2 L/ha · DAR 14 j', d));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('14');
  });

  it('usage générique « Cultures légumières » pour une tomate : DAR proposé', async () => {
    await cultiver('Tomate');
    const d = await ouvrirFormulaire();
    await chercher(d, 'thiovit');
    await toucher(suggestion('THIOVIT JET MICROBILLES'));
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    expect(champ('Dose maximale', d).value).toBe('7,5');
    expect(champ('Unité de la dose', d).value).toBe('kg/ha');
  });

  it('base pas encore publiée (catalogue initial vide) : message clair, la saisie à la main reste possible', async () => {
    const d = await ouvrirFormulaire({ ...CATALOGUE, dateBase: null, produits: [] });
    await remplir(champ('Chercher dans e-phy', d), 'succ');
    await attendre(() => chargements === 1 && /pas encore/i.test(texte(d)), 'message « base pas encore disponible »');
    expect(suggestions()).toHaveLength(0);
    await remplir(champ('Nom commercial', d), 'Purin d’ortie');
    await remplir(champ('Délai avant récolte (jours)', d), '0');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => produits().length === 1, 'produit écrit à la main');
  });
});
