// @vitest-environment happy-dom
/**
 * Tests d'acceptation T76 — saisie d'un traitement : le DAR proposé est celui de l'usage E-Phy
 * de la culture RÉELLEMENT traitée (docs/backlog/T76-ephy-dar-culture-traitee.md, règles 2 et 3).
 * Vrai écran dans un DOM simulé (happy-dom), ferme du jour (./test/ferme-du-jour.ts : tomate
 * « Cœur de bœuf » en série, fraise « Mara des bois » en plantation), sans réseau.
 *
 * ── Contrat ajouté à la saisie (./traitement/SaisieTraitement.tsx, en plus de traitement.test.tsx) ──
 *   - propriété facultative `chargerCatalogue?: () => Promise<CatalogueEphy>` (défaut : le
 *     catalogue du dépôt, chargé à la demande) ; un échec de chargement n'empêche rien ;
 *   - champ « Délai avant récolte (jours) » dans le formulaire, modifiable, et SEUL source du DAR
 *     figé dans le traitement (`detail.recolteAutoriseeLe` = date + ce délai) ;
 *   - produit venu d'E-Phy = produit dont le N° AMM est dans le catalogue ; la culture traitée est
 *     celle choisie à l'étape 1 (espèce de la série ou de la campagne) ;
 *   - produit d'E-Phy : le champ est prérempli du DAR de l'usage de la culture traitée seulement
 *     s'il est unique ; usages de DAR différents : radios « <culture> · <cible> · <dose> · DAR
 *     <n> j » (champ vide jusqu'au choix) ; aucun usage pour cette culture : avertissement
 *     [data-testid="avertissement-culture"] « produit non homologué sur cette culture »
 *     (role="status", non bloquant), champ vide ; DAR absent d'E-Phy (Q47) : champ vide ;
 *   - champ vide à l'enregistrement : refus clair (role="alert"), rien n'est écrit ;
 *   - produit hors E-Phy (AMM absent du catalogue, ou catalogue indisponible) : comme avant,
 *     champ prérempli du DAR de la fiche du produit.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ProprietesSaisieTraitement } from './traitement/index.ts';
import { CAMPAGNE, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, radio, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN = './traitement/index.ts';
const AUJOURDHUI = '2026-09-30';
const id = (n: number) => `0192f0c1-5252-7000-8000-${(0x7600 + n).toString(16).padStart(12, '0')}`;
const FRAISIOR = id(1);
const ACCORD = id(2);
const SANS_DAR = id(3);
const MAISON = id(4);

const usage = (culture: string, cible: string, dar: number | null) => ({ culture, mode: 'Trt Part.Aer.', cible, dose: { valeur: 0.2, unite: 'L/ha' }, dar });
const ephy = (amm: string, nom: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['x'], bio: false, retire: false, retireLe: null, usages });
const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  produits: [
    ephy('2060098', 'FRAISIOR', [usage('Fraisier', 'Thrips', 1)]),
    ephy('2060100', 'ACCORD', [usage('Tomate - Aubergine', 'Thrips', 3), usage('Tomate - Aubergine', 'Mildiou', 7)]),
    ephy('2060101', 'SANS DAR', [usage('Tomate - Aubergine', 'Thrips', null)]),
  ],
};

interface Evt {
  readonly id: string;
  readonly detail: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
}
let m: { SaisieTraitement: (p: ProprietesSaisieTraitement & { chargerCatalogue?: () => Promise<CatalogueEphy> }) => unknown };
let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as typeof m;
});

const nouveaux = (): Evt[] => base.lireDirect<Evt>("SELECT id, detail, serie_id, campagne_id FROM evenement WHERE type = 'traitement'");

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const h = '2026-01-01T08:00:00.000Z';
  await base.writeTransaction(async (tx) => {
    const sql = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`;
    await tx.execute(sql, [FRAISIOR, FERME, 'Fraisior', '2060098', 'x', 1, h, h]);
    await tx.execute(sql, [ACCORD, FERME, 'Accord', '2060100', 'x', 5, h, h]);
    await tx.execute(sql, [SANS_DAR, FERME, 'Sans dar', '2060101', 'x', 9, h, h]);
    await tx.execute(sql, [MAISON, FERME, 'Purin maison', '0000000', 'ortie', 4, h, h]);
  });
  const compteuse: BaseLocale = {
    getAll: (s, p) => base.getAll(s, p),
    execute: (s, p) => base.execute(s, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  transactions = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

async function ouvrir(cible: string, chargerCatalogue: () => Promise<CatalogueEphy> = () => Promise.resolve(CATALOGUE)): Promise<HTMLElement> {
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

const avertissement = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="avertissement-culture"]');
const DAR = 'Délai avant récolte (jours)';

async function remplirEtEnregistrer(d: HTMLElement): Promise<void> {
  await remplir(champ('Dose', d), '2');
  await remplir(champ('Cible', d), 'thrips');
  await toucher(bouton('Enregistrer', d));
}

function recolteEcrite(): string {
  const [e] = nouveaux();
  const r = validerSaisie({ ...(base.lireDirect<Record<string, unknown>>('SELECT * FROM evenement WHERE id = ?', [e?.id])[0] ?? {}) });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse : ${r.erreur.message}`).toBe(true);
  return (JSON.parse(e?.detail ?? '{}') as { recolteAutoriseeLe: string }).recolteAutoriseeLe;
}

describe('T76 : traitement — produit homologué sur Fraisier seul', () => {
  it('sur la tomate : avertissement non bloquant, aucun DAR proposé (pas celui de la fraise), à saisir', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => avertissement() !== null, 'avertissement de culture');
    expect(texte(avertissement())).toMatch(/produit non homologué sur cette culture/i);
    expect(champ(DAR, d).value).toBe('');
  });

  it('sur la tomate : DAR vide au moment d’enregistrer → refusé, rien d’écrit ; une fois saisi, écrit avec ce DAR (maître de sa ferme)', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), FRAISIOR);
    await remplirEtEnregistrer(d);
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/délai avant récolte/i);
    expect(nouveaux()).toHaveLength(0);
    expect(transactions).toBe(0);
    await remplir(champ(DAR, d), '5');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit malgré l’avertissement');
    expect(transactions).toBe(1);
    expect(nouveaux()[0]?.serie_id).toBe(SERIE.tomate);
    expect(recolteEcrite()).toBe('2026-10-05');
  });

  it('sur la fraise : pas d’avertissement, DAR de l’usage Fraisier, figé dans le traitement', async () => {
    const d = await ouvrir(CAMPAGNE.fraise);
    await remplir(liste('Produit', d), FRAISIOR);
    expect(champ(DAR, d).value).toBe('1');
    expect(avertissement()).toBeNull();
    await remplirEtEnregistrer(d);
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(nouveaux()[0]?.campagne_id).toBe(CAMPAGNE.fraise);
    expect(recolteEcrite()).toBe('2026-10-01');
  });

  it('changer de produit efface l’avertissement et le DAR proposé', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), FRAISIOR);
    await attendre(() => avertissement() !== null, 'avertissement');
    await remplir(liste('Produit', d), MAISON);
    expect(avertissement()).toBeNull();
    expect(champ(DAR, d).value).toBe('4');
  });
});

describe('T76 : traitement — plusieurs usages pour la culture traitée', () => {
  it('deux usages de DAR différents : l’utilisateur choisit, le champ est vide jusque-là ; le DAR de la fiche du produit (5 j) n’est pas utilisé', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), ACCORD);
    await attendre(() => (() => { try { radio('Tomate - Aubergine · Mildiou · 0,2 L/ha · DAR 7 j', d); return true; } catch { return false; } })(), 'usages proposés');
    expect(champ(DAR, d).value).toBe('');
    expect(avertissement()).toBeNull();
    await toucher(radio('Tomate - Aubergine · Mildiou · 0,2 L/ha · DAR 7 j', d));
    expect(champ(DAR, d).value).toBe('7');
    await remplirEtEnregistrer(d);
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolteEcrite()).toBe('2026-10-07');
  });

  it('sans choix ni saisie : refusé, rien d’écrit', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), ACCORD);
    await remplirEtEnregistrer(d);
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(nouveaux()).toHaveLength(0);
  });
});

describe('T76 : traitement — DAR absent d’E-Phy (Q47) et produit hors E-Phy', () => {
  it('usage de la culture sans DAR en jours : champ vide (jamais deviné, pas le 9 j de la fiche), sans avertissement d’homologation', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), SANS_DAR);
    expect(champ(DAR, d).value).toBe('');
    expect(avertissement()).toBeNull();
    await remplir(champ(DAR, d), '2');
    await remplirEtEnregistrer(d);
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolteEcrite()).toBe('2026-10-02');
  });

  it('produit absent d’E-Phy (purin maison) : DAR de sa fiche, sans avertissement', async () => {
    const d = await ouvrir(SERIE.tomate);
    await remplir(liste('Produit', d), MAISON);
    expect(champ(DAR, d).value).toBe('4');
    expect(avertissement()).toBeNull();
    await remplirEtEnregistrer(d);
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolteEcrite()).toBe('2026-10-04');
  });

  it('catalogue indisponible (hors ligne, échec de chargement) : la saisie marche comme avant, DAR de la fiche du produit', async () => {
    const d = await ouvrir(SERIE.tomate, () => Promise.reject(new Error('catalogue illisible')));
    await remplir(liste('Produit', d), FRAISIOR);
    expect(champ(DAR, d).value).toBe('1');
    expect(avertissement()).toBeNull();
    await remplirEtEnregistrer(d);
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(recolteEcrite()).toBe('2026-10-01');
  });
});
