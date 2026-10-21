// @vitest-environment happy-dom
/**
 * Tests d'acceptation T76 (docs/backlog/T76-ephy-dar-culture-traitee.md, règles 2 et 3) — saisie
 * d'un traitement (T52) : le DAR proposé est celui de l'usage e-phy de la culture TRAITÉE, pas de
 * toutes les cultures de la ferme. Vrai écran dans un DOM simulé, ferme du jour (tomate en série,
 * fraise en campagne ; aujourd'hui = 2026-09-30), sans réseau.
 *
 * ── Contrat (en plus de celui de ./traitement.test.tsx) ─────────────────────────────────────
 *
 * - `SaisieTraitement` (./traitement/index.ts) reçoit `chargerCatalogue?: () => Promise<CatalogueEphy>`
 *   (défaut : le catalogue de ../ferme/phyto/catalogue.ts, chargé à la demande, seulement quand
 *   un produit est choisi). Un produit de la ferme « vient d'e-phy » quand son `numero_amm` est
 *   celui d'un produit du catalogue.
 * - Le formulaire a un champ « Délai avant récolte (jours) » (nombre entier), modifiable. Le DAR
 *   écrit dans l'événement (`detail.recolteAutoriseeLe` = date + ce délai) est celui du champ.
 * - Produit venu d'e-phy, selon `darPourCulture(produit, espèce de la culture traitée)`
 *   (@planif/core/ephy ; l'espèce est « Tomate », pas « Tomate Cœur de bœuf ») :
 *     propose        → champ prérempli avec le DAR de l'usage ;
 *     non_homologue  → [data-testid="avertissement-homologation"] (role="status", non bloquant) :
 *                      « Produit non homologué sur cette culture » ; champ VIDE (même si la fiche
 *                      produit a un DAR) ;
 *     a_choisir      → radios « <culture> · <cible> · <dose> · DAR <n> j » (un par usage), champ vide
 *                      tant qu'aucun n'est choisi ; le choix remplit le champ ;
 *     dar_absent     → champ vide (Q47).
 *   « Enregistrer » avec le champ vide : refusé, message en role="alert" qui parle du délai avant
 *   récolte, rien d'écrit. Aucun DAR n'est jamais deviné.
 * - Produit saisi à la main (AMM absent du catalogue), ou catalogue indisponible (hors ligne sans
 *   copie) : comportement T52 inchangé, le champ est prérempli avec le DAR de la fiche produit,
 *   aucune erreur bloquante.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { CAMPAGNE, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, champ, coche, dialogue, dialogueOuEchec, liste, radio, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const AUJOURDHUI = '2026-09-30';
const id = (n: number) => `0192f0c1-7676-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FRAISIPRO = id(0x10); // fiche : DAR 1 j (copié de la fraise), AMM 2200777
const DEUXDAR = id(0x11); // tomate : DAR 3 j et 7 j selon l'usage
const SANSDAR = id(0x12); // tomate : DAR absent dans e-phy
const MAISON = id(0x13); // saisi à la main, AMM inconnue du catalogue, DAR 3 j

type ComposantSaisie = (p: {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly aujourdhui: string;
  readonly surFermer: () => void;
  readonly chargerCatalogue?: () => Promise<CatalogueEphy>;
}) => import('react').ReactElement;

let SaisieTraitement: ComposantSaisie;
let base: BaseMemoire;
let porte: PorteDonnees;
let avant: Set<string>;
let conteneur: HTMLDivElement;
let racine: Root;
let chargerCatalogue: () => Promise<CatalogueEphy>;

const u = (culture: string, cible: string, dar: number | null) => ({ culture, mode: 'Trt Part.Aer.', cible, dose: { valeur: 0.2, unite: 'L/ha' }, dar });
const produitEphy = (amm: string, nom: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['spinosad 480 g/L'], bio: true, retire: false, retireLe: null, usages });
const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses (data.gouv.fr)',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  produits: [
    produitEphy('2200777', 'FRAISIPRO', [u('Fraisier', 'Thrips', 1)]),
    produitEphy('2200778', 'DEUXDAR', [u('Tomate', 'Thrips', 3), u('Tomate', 'Mineuses', 7), u('Fraisier', 'Thrips', 1)]),
    produitEphy('2200779', 'SANSDAR', [u('Tomate', 'Oïdium(s)', null)]),
  ],
};

interface LigneEvenement {
  readonly id: string;
  readonly detail: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
}
const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>("SELECT id, detail, serie_id, campagne_id FROM evenement WHERE type = 'traitement' ORDER BY horodatage, id");
const nouveaux = (): LigneEvenement[] => evenements().filter((e) => !avant.has(e.id));
const recolte = (e: LigneEvenement | undefined): unknown => (JSON.parse(e?.detail ?? '{}') as { recolteAutoriseeLe?: unknown }).recolteAutoriseeLe;

beforeAll(async () => {
  const m = (await import(/* @vite-ignore */ './traitement/index.ts')) as { SaisieTraitement: ComposantSaisie };
  SaisieTraitement = m.SaisieTraitement;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const horo = '2026-01-01T08:00:00.000Z';
  await base.writeTransaction(async (tx) => {
    const sql = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await tx.execute(sql, [FRAISIPRO, FERME, 'FRAISIPRO', '2200777', 'spinosad', 1, 1, null, horo, horo, null]);
    await tx.execute(sql, [DEUXDAR, FERME, 'DEUXDAR', '2200778', 'spinosad', 3, 1, null, horo, horo, null]);
    await tx.execute(sql, [SANSDAR, FERME, 'SANSDAR', '2200779', 'spinosad', 2, 1, null, horo, horo, null]);
    await tx.execute(sql, [MAISON, FERME, 'Purin maison', '', 'ortie', 3, 1, null, horo, horo, null]);
  });
  avant = new Set(evenements().map((e) => e.id));
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  chargerCatalogue = () => Promise.resolve(CATALOGUE);
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

async function ouvrir(cible: string): Promise<HTMLElement> {
  await act(async () => {
    racine.render(createElement(SaisieTraitement, { porte, fermeId: FERME, aujourdhui: AUJOURDHUI, surFermer: () => undefined, chargerCatalogue: () => chargerCatalogue() }));
    await Promise.resolve();
  });
  const sel = `[data-testid="choix-traitement"][data-cible="${cible}"]`;
  await attendre(() => dialogue('Traitement')?.querySelector(sel) != null, `culture ${cible} proposée`);
  const choix = dialogueOuEchec('Traitement').querySelector<HTMLElement>(sel);
  if (choix === null) throw new Error('culture absente');
  await toucher(choix);
  await attendre(() => dialogueOuEchec('Traitement').querySelector('select') !== null, 'formulaire du traitement');
  return dialogueOuEchec('Traitement');
}

async function choisirProduit(d: HTMLElement, produitId: string): Promise<void> {
  await remplir(liste('Produit', d), produitId);
}

async function remplirLeReste(d: HTMLElement): Promise<void> {
  await remplir(champ('Dose', d), '1');
  await remplir(champ('Cible', d), 'thrips');
}

const avertissement = (d: HTMLElement): HTMLElement | null => d.querySelector<HTMLElement>('[data-testid="avertissement-homologation"]');
const dar = (d: HTMLElement): string => champ('Délai avant récolte (jours)', d).value;

describe('T76 : DAR de la culture réellement traitée', () => {
  it('produit homologué sur Fraisier seul, traitement sur TOMATE : avertissement « non homologué sur cette culture », aucun DAR proposé (la fiche dit 1 j)', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => avertissement(d) !== null, 'avertissement d’homologation');
    expect(texte(avertissement(d))).toMatch(/non homologué sur cette culture/i);
    expect(avertissement(d)?.getAttribute('role')).toBe('status');
    expect(dar(d)).toBe('');
  });

  it('même produit, traitement sur TOMATE : l’avertissement ne bloque pas, le maraîcher saisit son DAR et la récolte autorisée suit', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => avertissement(d) !== null, 'avertissement d’homologation');
    await remplirLeReste(d);
    await remplir(champ('Délai avant récolte (jours)', d), '2');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(nouveaux()[0]?.serie_id).toBe(SERIE.tomate);
    expect(recolte(nouveaux()[0])).toBe('2026-10-02');
  });

  it('même produit, sans DAR saisi : enregistrement refusé (message sur le délai), rien d’écrit, aucun DAR deviné', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => avertissement(d) !== null, 'avertissement d’homologation');
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message d’erreur');
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/délai avant récolte/i);
    expect(nouveaux()).toHaveLength(0);
  });

  it('même produit, traitement sur FRAISE : pas d’avertissement, DAR de l’usage Fraisier (1 j), récolte autorisée le lendemain', async () => {
    const d = await ouvrir(CAMPAGNE.fraise);
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => dar(d) === '1', 'DAR de l’usage Fraisier');
    expect(avertissement(d)).toBeNull();
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(nouveaux()[0]?.campagne_id).toBe(CAMPAGNE.fraise);
    expect(recolte(nouveaux()[0])).toBe('2026-10-01');
  });

  it('deux usages de DAR différents pour la tomate : pas de choix automatique, l’utilisateur choisit (3 j ou 7 j)', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, DEUXDAR);
    await attendre(() => d.querySelector('input[type="radio"]') !== null, 'usages proposés');
    expect(dar(d)).toBe('');
    expect(avertissement(d)).toBeNull();
    const trois = radio('Tomate · Thrips · 0,2 L/ha · DAR 3 j', d);
    const sept = radio('Tomate · Mineuses · 0,2 L/ha · DAR 7 j', d);
    expect(coche(trois)).toBe(false);
    expect(coche(sept)).toBe(false);
    // L'usage Fraisier n'est pas une option pour une tomate.
    expect(() => radio('Fraisier · Thrips · 0,2 L/ha · DAR 1 j', d)).toThrow();
    // Sans choix : refusé.
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus sans DAR choisi');
    expect(nouveaux()).toHaveLength(0);
    await toucher(sept);
    expect(dar(d)).toBe('7');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolte(nouveaux()[0])).toBe('2026-10-07');
  });

  it('même produit sur FRAISE : un seul usage, DAR 1 j proposé sans choix', async () => {
    const d = await ouvrir(CAMPAGNE.fraise);
    await choisirProduit(d, DEUXDAR);
    await attendre(() => dar(d) === '1', 'DAR de l’usage Fraisier');
    expect(d.querySelector('input[type="radio"]')).toBeNull();
  });

  it('DAR absent dans e-phy (Q47) : champ vide malgré le DAR de la fiche (2 j), à saisir ; jamais deviné', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, SANSDAR);
    await attendre(() => liste('Produit', d).value === SANSDAR, 'produit choisi');
    await attendre(() => /DAR non précisé|non précisé/i.test(texte(d)) || dar(d) === '', 'catalogue lu');
    expect(dar(d)).toBe('');
    expect(avertissement(d)).toBeNull();
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus sans DAR');
    expect(nouveaux()).toHaveLength(0);
  });
});

describe('T76 : produits hors e-phy et hors ligne, comportement T52 conservé', () => {
  it('produit saisi à la main (AMM inconnue d’e-phy) : DAR de la fiche prérempli, ni avertissement ni blocage', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, MAISON);
    await attendre(() => dar(d) === '3', 'DAR de la fiche');
    expect(avertissement(d)).toBeNull();
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolte(nouveaux()[0])).toBe('2026-10-03');
  });

  it('catalogue indisponible (hors ligne, pas de copie) : DAR de la fiche prérempli, le traitement s’enregistre quand même', async () => {
    chargerCatalogue = () => Promise.reject(new Error('Base e-phy indisponible.'));
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => dar(d) === '1', 'DAR de la fiche, faute de catalogue');
    expect(avertissement(d)).toBeNull();
    await remplirLeReste(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit hors ligne');
    expect(recolte(nouveaux()[0])).toBe('2026-10-01');
    erreurs.mockRestore();
  });

  it('changer de produit ne garde pas un DAR périmé : produit e-phy non homologué après un produit à la main → champ vidé', async () => {
    const d = await ouvrir(SERIE.tomate);
    await choisirProduit(d, MAISON);
    await attendre(() => dar(d) === '3', 'DAR de la fiche');
    await choisirProduit(d, FRAISIPRO);
    await attendre(() => avertissement(d) !== null, 'avertissement d’homologation');
    expect(dar(d)).toBe('');
  });
});
