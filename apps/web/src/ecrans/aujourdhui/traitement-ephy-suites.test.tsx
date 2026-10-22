// @vitest-environment happy-dom
/**
 * Tests d'acceptation T79 — suites de la relecture de T76 (docs/backlog/T79-ephy-saisie-suites.md)
 * et refus d'un traitement daté dans le futur (docs/backlog/README.md).
 * Même ferme du jour et mêmes outils que traitement-ephy.test.tsx ; sans réseau.
 *
 * ── Contrat ──
 *   1. Produit à N° AMM absent du catalogue CHARGÉ : champ « Délai avant récolte (jours) » prérempli
 *      du DAR de la fiche, et avis [data-testid="avertissement-ephy"] « AMM inconnu d'e-phy : vérifiez
 *      le DAR pour cette culture » (role="status", non bloquant : l'enregistrement reste possible).
 *   2. Catalogue en cours de chargement : l'avis dit « chargement d'e-phy… » (jamais « indisponible »).
 *      « e-phy indisponible sur ce téléphone : vérifiez le DAR pour cette culture » seulement après
 *      un échec.
 *   3. Après un échec : bouton « Réessayer » dans l'avis, qui relance `chargerCatalogue` (le dialogue
 *      ne retente pas seul). Pendant la relance : « chargement » ; si elle réussit, l'avis disparaît.
 *   4. `ecrireLotTraitement(porte, saisies, annoncer?, aujourdhui?)` : une saisie datée après
 *      `aujourdhui` → TraitementRefuse, rien d'écrit de tout le lot. Aujourd'hui même : accepté.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { CultureConcernee, Id, ProduitPourTraitement, Quantite } from '@planif/core';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ProprietesSaisieTraitement } from './traitement/index.ts';
import { CAMPAGNE, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN = './traitement/index.ts';
const AUJOURDHUI = '2026-09-30';
const id = (n: number) => `0192f0c1-5252-7000-8000-${(0x7900 + n).toString(16).padStart(12, '0')}`;
const FRAISIOR = id(1);
const RETIRE = id(2);
const DAR = 'Délai avant récolte (jours)';

const usage = (culture: string, cible: string, dar: number | null) => ({ culture, mode: 'Trt Part.Aer.', cible, dose: { valeur: 0.2, unite: 'L/ha' }, dar });
const ephy = (amm: string, nom: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['x'], bio: false, retire: false, retireLe: null, usages });
const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  // L'AMM 2069999 du produit « Retiré » n'y figure pas : retiré d'un catalogue plus récent.
  produits: [ephy('2060098', 'FRAISIOR', [usage('Fraisier', 'Thrips', 1)])],
};

interface Module {
  readonly SaisieTraitement: (p: ProprietesSaisieTraitement & { chargerCatalogue?: () => Promise<CatalogueEphy> }) => unknown;
  readonly ecrireLotTraitement: (porte: PorteDonnees, saisies: readonly SaisieLot[], annoncer?: (c: CultureConcernee) => () => void, aujourdhui?: string) => Promise<readonly { id: string }[]>;
  readonly TraitementRefuse: new (m?: string) => Error;
}
interface SaisieLot {
  readonly culture: CultureConcernee | null;
  readonly emplacementIds: readonly string[];
  readonly produit: ProduitPourTraitement;
  readonly date: string;
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  readonly operateur: string;
}
interface Evt {
  readonly id: string;
  readonly detail: string;
}

let m: Module;
let base: BaseMemoire;
let porte: PorteDonnees;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as Module;
});

const nouveaux = (): Evt[] => base.lireDirect<Evt>("SELECT id, detail FROM evenement WHERE type = 'traitement'");

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const h = '2026-01-01T08:00:00.000Z';
  await base.writeTransaction(async (tx) => {
    const sql = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`;
    await tx.execute(sql, [FRAISIOR, FERME, 'Fraisior', '2060098', 'x', 8, h, h]);
    await tx.execute(sql, [RETIRE, FERME, 'Retiré', '2069999', 'x', 6, h, h]);
  });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
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
  base.fermer();
  vi.unstubAllGlobals();
});

async function ouvrir(cible: string, chargerCatalogue: () => Promise<CatalogueEphy>): Promise<HTMLElement> {
  await act(async () => {
    racine.render(createElement(m.SaisieTraitement as never, { porte, fermeId: FERME, aujourdhui: AUJOURDHUI, surFermer: () => undefined, chargerCatalogue }));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Traitement') !== undefined, 'dialogue « Traitement »');
  await attendre(() => dialogueOuEchec('Traitement').querySelector(`[data-testid="choix-traitement"][data-cible="${cible}"]`) !== null, `culture ${cible} proposée`);
  const choix = dialogueOuEchec('Traitement').querySelector<HTMLElement>(`[data-testid="choix-traitement"][data-cible="${cible}"]`);
  if (choix === null) throw new Error('culture absente');
  await toucher(choix);
  await attendre(() => dialogueOuEchec('Traitement').querySelectorAll('select').length > 0, 'formulaire');
  return dialogueOuEchec('Traitement');
}

const avis = (): string => texte(document.querySelector('[data-testid="avertissement-ephy"]'));
const boutonReessayer = (): HTMLElement | null => [...document.querySelectorAll<HTMLElement>('button')].find((b) => /réessayer/i.test(b.textContent)) ?? null;
const reessayer = (): HTMLElement => {
  const b = boutonReessayer();
  if (b === null) throw new Error('bouton « Réessayer » absent');
  return b;
};
const pause = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe('T79 règle 1 : AMM inconnu du catalogue chargé', () => {
  it('DAR de la fiche prérempli (6 j) et avis « AMM inconnu d’e-phy », sans « indisponible » ni « chargement »', async () => {
    const d = await ouvrir(SERIE.tomate, () => Promise.resolve(CATALOGUE));
    await remplir(liste('Produit', d), RETIRE);
    await attendre(() => document.querySelector('[data-testid="avertissement-ephy"]') !== null, 'avis AMM inconnu');
    expect(avis()).toMatch(/AMM inconnu d.e-phy : vérifiez le DAR pour cette culture/i);
    expect(avis()).not.toMatch(/indisponible|chargement/i);
    expect(champ(DAR, d).value).toBe('6');
    expect(boutonReessayer()).toBeNull();
  });

  it('non bloquant : le traitement s’enregistre avec le DAR de la fiche (30/09 + 6 j = 06/10)', async () => {
    const d = await ouvrir(SERIE.tomate, () => Promise.resolve(CATALOGUE));
    await remplir(liste('Produit', d), RETIRE);
    await attendre(() => /AMM inconnu/i.test(avis()), 'avis AMM inconnu');
    await remplir(champ('Dose', d), '2');
    await remplir(champ('Cible', d), 'thrips');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect((JSON.parse(nouveaux()[0]?.detail ?? '{}') as { recolteAutoriseeLe: string }).recolteAutoriseeLe).toBe('2026-10-06');
  });

  it('garde : produit dont l’AMM est au catalogue → pas d’avis « AMM inconnu »', async () => {
    const d = await ouvrir(CAMPAGNE.fraise, () => Promise.resolve(CATALOGUE));
    await remplir(liste('Produit', d), FRAISIOR);
    expect(champ(DAR, d).value).toBe('1');
    expect(avis()).not.toMatch(/AMM inconnu/i);
  });

  it('changer pour un produit connu efface l’avis « AMM inconnu »', async () => {
    const d = await ouvrir(CAMPAGNE.fraise, () => Promise.resolve(CATALOGUE));
    await remplir(liste('Produit', d), RETIRE);
    await attendre(() => /AMM inconnu/i.test(avis()), 'avis AMM inconnu');
    await remplir(liste('Produit', d), FRAISIOR);
    expect(avis()).not.toMatch(/AMM inconnu/i);
  });
});

describe('T79 règles 2 et 3 : chargement, échec, Réessayer', () => {
  it('pendant le chargement : « chargement d’e-phy… », pas « indisponible », pas de bouton Réessayer, champ vide', async () => {
    const d = await ouvrir(SERIE.tomate, () => new Promise<CatalogueEphy>(() => undefined));
    await remplir(liste('Produit', d), FRAISIOR);
    expect(avis()).toMatch(/chargement d.e-phy/i);
    expect(avis()).not.toMatch(/indisponible/i);
    expect(boutonReessayer()).toBeNull();
    expect(champ(DAR, d).value).toBe('');
  });

  it('après un échec : « e-phy indisponible sur ce téléphone : vérifiez le DAR pour cette culture », plus de « chargement », bouton Réessayer', async () => {
    const d = await ouvrir(SERIE.tomate, () => Promise.reject(new Error('catalogue illisible')));
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => /indisponible/i.test(avis()), 'avis indisponible');
    expect(avis()).toMatch(/e-phy indisponible sur ce téléphone : vérifiez le DAR pour cette culture/i);
    expect(avis()).not.toMatch(/chargement/i);
    expect(boutonReessayer()).not.toBeNull();
    expect(champ(DAR, d).value).toBe('');
  });

  it('aucun nouvel essai automatique après l’échec : un seul appel de chargement', async () => {
    const charger = vi.fn(() => Promise.reject<CatalogueEphy>(new Error('catalogue illisible')));
    const d = await ouvrir(SERIE.tomate, charger);
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => /indisponible/i.test(avis()), 'avis indisponible');
    await pause();
    await remplir(liste('Produit', d), RETIRE);
    await pause();
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it('« Réessayer » relance le chargement : « chargement » pendant l’essai, puis succès → avis retiré, usage de la culture appliqué', async () => {
    let appels = 0;
    let finir: (c: CatalogueEphy) => void = () => undefined;
    const charger = () => {
      appels++;
      return appels === 1 ? Promise.reject<CatalogueEphy>(new Error('catalogue illisible')) : new Promise<CatalogueEphy>((r) => { finir = r; });
    };
    const d = await ouvrir(CAMPAGNE.fraise, charger);
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => boutonReessayer() !== null, 'bouton Réessayer');
    await toucher(reessayer());
    await attendre(() => appels === 2, 'second chargement lancé');
    expect(avis()).toMatch(/chargement d.e-phy/i);
    expect(avis()).not.toMatch(/indisponible/i);
    await act(async () => { finir(CATALOGUE); await Promise.resolve(); });
    await attendre(() => document.querySelector('[data-testid="avertissement-ephy"]') === null, 'avis retiré après succès');
    expect(champ(DAR, d).value).toBe('1');
    expect(appels).toBe(2);
  });

  it('« Réessayer » qui échoue de nouveau : « indisponible » et un bouton Réessayer encore là, un appel de plus seulement', async () => {
    const charger = vi.fn(() => Promise.reject<CatalogueEphy>(new Error('toujours hors ligne')));
    const d = await ouvrir(SERIE.tomate, charger);
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => boutonReessayer() !== null, 'bouton Réessayer');
    await toucher(reessayer());
    await attendre(() => charger.mock.calls.length === 2, 'second chargement');
    await attendre(() => /indisponible/i.test(avis()) && boutonReessayer() !== null, 'de nouveau indisponible');
    await pause();
    expect(charger).toHaveBeenCalledTimes(2);
  });
});

describe('T79 refus d’une date future dans ecrireLotTraitement', () => {
  const tomate = { sorte: 'serie' as const, serieId: SERIE.tomate as Id<'Serie'> };
  const fraise = { sorte: 'campagne' as const, campagneId: CAMPAGNE.fraise as Id<'Campagne'> };
  const saisie = (culture: CultureConcernee, emplacement: string, date: string): SaisieLot => ({
    culture,
    emplacementIds: [emplacement],
    produit: { id: FRAISIOR, nomCommercial: 'Fraisior', delaiAvantRecolteJours: 3, doseMaximale: null },
    date,
    dose: { valeur: 0.5, unite: 'L/ha' },
    surfaceTraiteeM2: 24,
    cible: 'thrips',
    operateur: 'Lucas',
  });
  const ecrire = (saisies: readonly SaisieLot[], annoncer?: (c: CultureConcernee) => () => void) => m.ecrireLotTraitement(porte, saisies, annoncer, AUJOURDHUI);

  it('traitement de demain → TraitementRefuse, rien d’écrit', async () => {
    await expect(ecrire([saisie(tomate, EMPLACEMENT.t2p07, '2026-10-01')])).rejects.toBeInstanceOf(m.TraitementRefuse);
    expect(nouveaux()).toHaveLength(0);
  });

  it('une seule saisie future dans un lot de deux → lot entier refusé, rien d’écrit, annonces retirées ou jamais faites', async () => {
    const actives = new Set<string>();
    const annoncer = (c: CultureConcernee) => {
      const cle = JSON.stringify(c);
      actives.add(cle);
      return () => actives.delete(cle);
    };
    await expect(ecrire([saisie(tomate, EMPLACEMENT.t2p07, '2026-09-29'), saisie(fraise, EMPLACEMENT.s1g01, '2026-10-02')], annoncer)).rejects.toBeInstanceOf(m.TraitementRefuse);
    expect(nouveaux()).toHaveLength(0);
    expect(actives.size).toBe(0);
  });

  it('année suivante et ordre des jours : « 2027-01-01 » est futur, « 2026-09-31 » n’est pas comparé comme du texte (10 > 9)', async () => {
    await expect(ecrire([saisie(tomate, EMPLACEMENT.t2p07, '2027-01-01')])).rejects.toBeInstanceOf(m.TraitementRefuse);
    await expect(m.ecrireLotTraitement(porte, [saisie(tomate, EMPLACEMENT.t2p07, '2026-09-30')], undefined, '2026-10-01')).resolves.toHaveLength(1);
  });

  it('aujourd’hui même est accepté', async () => {
    await expect(ecrire([saisie(tomate, EMPLACEMENT.t2p07, AUJOURDHUI)])).resolves.toHaveLength(1);
    expect(nouveaux()).toHaveLength(1);
  });

  it('hier et lot de deux datés d’aujourd’hui et d’hier : acceptés', async () => {
    await expect(ecrire([saisie(tomate, EMPLACEMENT.t2p07, '2026-09-29'), saisie(fraise, EMPLACEMENT.s1g01, AUJOURDHUI)])).resolves.toHaveLength(2);
    expect(nouveaux()).toHaveLength(2);
  });
});
