// @vitest-environment happy-dom
/**
 * Tests d'acceptation T78 — un même produit sur plusieurs cultures en une saisie
 * (docs/backlog/T78-traitement-plusieurs-cultures.md). Vrai écran dans un DOM simulé (happy-dom),
 * ferme du jour (./test/ferme-du-jour.ts, aujourd'hui = 2026-09-30) : tomate « Cœur de bœuf »
 * (série, emplacement T2-P07) et fraise « Mara des bois » (campagne, emplacement S1-G01), base
 * mémoire de @planif/sync, sans réseau. Complète traitement.test.tsx (T52) et traitement-ephy.test.tsx
 * (T76), qui restent vrais tels quels : une seule culture cochée = le comportement d'avant.
 *
 * ── Contrat de la couche données (./traitement/donnees.ts, ré-exporté par ./traitement/index.ts) ──
 *   - `ecrireLotTraitement(porte, saisies, annoncer?)` : `saisies` = des SaisieDuTraitement (une par
 *     culture ; leur `produit.delaiAvantRecolteJours` est le DAR figé de CETTE culture). Écrit UN
 *     événement `traitement` par saisie, dans l'ordre, en UNE transaction : tout ou rien (une ligne
 *     refusée par validerSaisie, ou un lot vide → TraitementRefuse, rien d'écrit, aucune annonce
 *     laissée). Rend un TraitementEcrit par saisie, même ordre. `annoncer` est appelé pour chaque culture
 *     écrite ; en cas d'échec, chaque annonce est retirée.
 *   - `annulerLotTraitement(porte, fermeId, ids, jour, annoncer?)` : annule tous les événements `ids` en UNE
 *     transaction (un événement d'annulation chacun, comme `annulerTraitement`). Tout ou rien : si l'un
 *     n'est plus en vigueur (déjà annulé ou corrigé), ou n'est pas de la ferme `fermeId`
 *     → TraitementPlusEnVigueur, aucune annulation écrite. Rend les ids des annulations, même ordre.
 *
 * ── Contrat de l'écran (./traitement/SaisieTraitement.tsx), une fois la culture choisie à l'étape 1 ──
 *   - un groupe de cases « Cultures traitées » : une case par culture en place ce jour, nommée comme la
 *     culture (« Tomate Cœur de bœuf », « Fraise Mara des bois ») ; la culture choisie à l'étape 1 est
 *     cochée, les autres non ; la dernière cochée ne se décoche pas (désactivée) ;
 *   - UNE seule culture cochée : le formulaire de T52/T76 inchangé (champs « Délai avant récolte (jours) »,
 *     « Surface traitée (m²) ») ;
 *   - PLUSIEURS cochées : produit, date, dose, unité, cible, opérateur sont communs ; en revanche, pour
 *     chaque culture cochée : « Délai avant récolte (jours) · <nom> » et « Surface traitée (m²) · <nom> »
 *     (calculée depuis les emplacements cochés de cette culture), et les champs sans suffixe disparaissent ;
 *     les cases d'emplacements (nommées par leur code) de toutes les cultures cochées sont listées, cochées par défaut ;
 *   - DAR par culture = règle T76 appliquée à CETTE culture (usage E-Phy de son espèce, champ vide si DAR
 *     absent d'E-Phy (Q47), jamais celui d'une autre culture ni de la fiche pour un produit d'E-Phy) ; avertissement
 *     non bloquant `[data-testid="avertissement-culture"][data-cible=<id culture>]` pour la seule culture
 *     non homologuée ; changer de produit recalcule tous les DAR proposés ;
 *   - « Enregistrer » : refus clair (role="alert", cite la culture fautive) tant qu'un DAR manque ou est
 *     invalide, rien n'est écrit pour AUCUNE culture ; sinon UNE transaction, un événement par culture
 *     (série_id ou campagne_id de la culture, ses emplacements, son DAR figé, sa surface), tous acceptés
 *     par validerSaisie ;
 *   - confirmation (role="status") : une ligne `[data-testid="lot-culture"][data-cible=<id culture>]` par
 *     culture : « <nom> · DAR <n> j · Récolte autorisée le JJ/MM » ; « Annuler ce traitement » annule le lot
 *     entier (une transaction), puis « Traitement annulé ».
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { interdictionRecolte, validerSaisie, type CultureConcernee, type Id, type ProduitPourTraitement, type Quantite } from '@planif/core';
import type { CatalogueEphy, ProduitEphy } from '@planif/core/ephy';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ProprietesSaisieTraitement } from './traitement/index.ts';
import { CAMPAGNE, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { aChamp, attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN = './traitement/index.ts';
const AUJOURDHUI = '2026-09-30';
const id = (n: number) => `0192f0c1-5252-7000-8000-${(0x7800 + n).toString(16).padStart(12, '0')}`;
const DECIS = id(1);
const FRAISIER_SEUL = id(2);
const TOMATE_SANS_DAR = id(3);
const AUTRE_FERME = id(0x99);
const TOMATE = 'Tomate Cœur de bœuf';
const FRAISE = 'Fraise Mara des bois';
const DAR = 'Délai avant récolte (jours)';
const SURFACE = 'Surface traitée (m²)';

const usage = (culture: string, cible: string, dar: number | null) => ({ culture, mode: 'Trt Part.Aer.', cible, dose: { valeur: 0.2, unite: 'L/ha' }, dar });
const ephy = (amm: string, nom: string, usages: ProduitEphy['usages']): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['x'], bio: false, retire: false, retireLe: null, usages });
const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  produits: [
    ephy('2060200', 'DECIS PROTECH', [usage('Tomate - Aubergine', 'Thrips', 3), usage('Fraisier', 'Thrips', 1)]),
    ephy('2060201', 'FRAISIOR', [usage('Fraisier', 'Thrips', 1)]),
    ephy('2060202', 'TOMATE SANS DAR', [usage('Tomate - Aubergine', 'Thrips', null), usage('Fraisier', 'Thrips', 1)]),
  ],
};

interface Lot {
  readonly ecrireLotTraitement: (porte: PorteDonnees, saisies: readonly SaisieLot[], annoncer?: (c: CultureConcernee) => () => void) => Promise<readonly { id: string; recolteAutoriseeLe: string }[]>;
  readonly annulerLotTraitement: (porte: PorteDonnees, fermeId: string, ids: readonly string[], jour: string, annoncer?: (c: CultureConcernee) => () => void) => Promise<readonly string[]>;
  readonly TraitementRefuse: new (m?: string) => Error;
  readonly TraitementPlusEnVigueur: new (m?: string) => Error;
  readonly SaisieTraitement: (p: ProprietesSaisieTraitement & { chargerCatalogue?: () => Promise<CatalogueEphy> }) => unknown;
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
interface Ligne {
  readonly id: string;
  readonly date: string;
  readonly horodatage: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly remplace_sorte: 'correction' | 'annulation' | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string;
}
interface Detail {
  readonly produitPhytoId: string;
  readonly dose: Quantite;
  readonly surfaceTraiteeM2: number;
  readonly cible: string;
  readonly operateur: string;
  readonly recolteAutoriseeLe: string;
}

let m: Lot;
let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as Lot;
});

const lot = (): Lot => {
  if (typeof m.ecrireLotTraitement !== 'function' || typeof m.annulerLotTraitement !== 'function') throw new Error('traitement/index.ts n’exporte pas encore ecrireLotTraitement / annulerLotTraitement (T78)');
  return m;
};

const lignes = (): Ligne[] => base.lireDirect<Ligne>("SELECT * FROM evenement WHERE type = 'traitement' ORDER BY horodatage, id");
const originaux = (): Ligne[] => lignes().filter((l) => l.remplace_sorte === null);
const annulations = (): Ligne[] => lignes().filter((l) => l.remplace_sorte === 'annulation');
const detailDe = (l: Ligne | undefined): Detail => JSON.parse(l?.detail ?? '{}') as Detail;
const emplacementsDe = (l: Ligne | undefined): string[] => (JSON.parse(l?.emplacement_ids ?? '[]') as string[]).map((x) => x.toLowerCase());
const deTomate = (): Ligne | undefined => originaux().find((l) => l.serie_id === SERIE.tomate);
const deFraise = (): Ligne | undefined => originaux().find((l) => l.campagne_id === CAMPAGNE.fraise);

/** Les traitements tels que lus pour le blocage de récolte (annulations comprises). */
function traitementsLus() {
  return lignes().map((l) => ({
    id: l.id,
    date: l.date,
    horodatage: l.horodatage,
    emplacementIds: JSON.parse(l.emplacement_ids) as string[],
    remplaceSorte: l.remplace_sorte,
    remplaceEvenementId: l.remplace_evenement_id,
    produitPhytoId: detailDe(l).produitPhytoId,
    recolteAutoriseeLe: detailDe(l).recolteAutoriseeLe,
    cultureId: l.serie_id ?? l.campagne_id,
  }));
}
const interdit = (emplacement: string, jour: string, culture: string) => interdictionRecolte(traitementsLus(), [emplacement], jour, culture);

function valide(l: Ligne | undefined): void {
  if (l === undefined) throw new Error('événement absent');
  const r = validerSaisie({ ...l });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse : ${r.erreur.message}`).toBe(true);
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const h = '2026-01-01T08:00:00.000Z';
  await base.writeTransaction(async (tx) => {
    const sql = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`;
    // Les DAR des fiches (5, 8, 9) diffèrent de tous ceux d'E-Phy : toute reprise de la fiche se voit.
    await tx.execute(sql, [DECIS, FERME, 'Decis Protech', '2060200', 'deltaméthrine', 5, h, h]);
    await tx.execute(sql, [FRAISIER_SEUL, FERME, 'Fraisior', '2060201', 'x', 8, h, h]);
    await tx.execute(sql, [TOMATE_SANS_DAR, FERME, 'Tomate sans dar', '2060202', 'x', 9, h, h]);
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

// ───────────────────────────── couche données ─────────────────────────────

const decis = (dar: number): ProduitPourTraitement => ({ id: DECIS, nomCommercial: 'Decis Protech', delaiAvantRecolteJours: dar, doseMaximale: null });
const saisieLot = (culture: CultureConcernee, emplacement: string, dar: number, surface: number, date = '2026-09-10'): SaisieLot => ({
  culture,
  emplacementIds: [emplacement],
  produit: decis(dar),
  date,
  dose: { valeur: 0.5, unite: 'L/ha' },
  surfaceTraiteeM2: surface,
  cible: 'thrips',
  operateur: 'Lucas',
});
const LOT = (): SaisieLot[] => [
  saisieLot({ sorte: 'serie', serieId: SERIE.tomate as Id<'Serie'> }, EMPLACEMENT.t2p07, 3, 24),
  saisieLot({ sorte: 'campagne', campagneId: CAMPAGNE.fraise as Id<'Campagne'> }, EMPLACEMENT.s1g01, 1, 40),
];

describe('T78 données : ecrireLotTraitement — un événement par culture, une transaction', () => {
  it('tomate DAR 3 et fraise DAR 1 traitées le 10/09 : deux événements, DAR figé dans chacun, une seule transaction', async () => {
    const ecrits = await lot().ecrireLotTraitement(porte, LOT());
    expect(transactions).toBe(1);
    expect(ecrits.map((e) => e.recolteAutoriseeLe)).toEqual(['2026-09-13', '2026-09-11']);
    expect(originaux()).toHaveLength(2);
    expect(detailDe(deTomate()).recolteAutoriseeLe).toBe('2026-09-13');
    expect(detailDe(deFraise()).recolteAutoriseeLe).toBe('2026-09-11');
    expect(emplacementsDe(deTomate())).toEqual([EMPLACEMENT.t2p07]);
    expect(emplacementsDe(deFraise())).toEqual([EMPLACEMENT.s1g01]);
    expect(ecrits.map((e) => e.id)).toEqual([deTomate()?.id, deFraise()?.id]);
    valide(deTomate());
    valide(deFraise());
  });

  it('récolte : tomate autorisée le 13/09 (interdite le 12), fraise le 11/09 (interdite le 10) ; chacune sur son emplacement seulement', async () => {
    await lot().ecrireLotTraitement(porte, LOT());
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-12', SERIE.tomate)?.recolteAutoriseeLe).toBe('2026-09-13');
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-13', SERIE.tomate)).toBeNull();
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-10', CAMPAGNE.fraise)?.recolteAutoriseeLe).toBe('2026-09-11');
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-11', CAMPAGNE.fraise)).toBeNull();
    // Le 11/09 : la fraise est libre alors que la tomate est encore sous DAR.
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-11', SERIE.tomate)).not.toBeNull();
  });

  it('tout ou rien : une ligne refusée par le serveur (récolte autorisée avant le traitement) = rien d’écrit pour aucune culture, aucune annonce restante', async () => {
    const [tomate, fraise] = LOT();
    if (tomate === undefined || fraise === undefined) throw new Error('lot attendu');
    const mauvais = [tomate, { ...fraise, produit: decis(-2) }];
    const annonces = new Set<number>();
    let n = 0;
    const annoncer = () => {
      const k = n++;
      annonces.add(k);
      return () => annonces.delete(k);
    };
    await expect(lot().ecrireLotTraitement(porte, mauvais, annoncer)).rejects.toBeInstanceOf(lot().TraitementRefuse);
    expect(lignes()).toHaveLength(0);
    expect(annonces.size).toBe(0);
  });

  it('lot vide : refusé, rien d’écrit', async () => {
    await expect(lot().ecrireLotTraitement(porte, [])).rejects.toBeInstanceOf(lot().TraitementRefuse);
    expect(lignes()).toHaveLength(0);
  });

  it('annonce à la journée : une par culture écrite', async () => {
    const vues: string[] = [];
    await lot().ecrireLotTraitement(porte, LOT(), (c) => {
      vues.push(c.sorte === 'serie' ? c.serieId : c.campagneId);
      return () => undefined;
    });
    expect(vues).toEqual([SERIE.tomate, CAMPAGNE.fraise]);
  });
});

describe('T78 données : annulerLotTraitement — tous les événements du lot, ou aucun', () => {
  it('annule tous les événements du lot en une transaction : tous les emplacements redeviennent libres', async () => {
    const ecrits = await lot().ecrireLotTraitement(porte, LOT());
    transactions = 0;
    const anns = await lot().annulerLotTraitement(porte, FERME, ecrits.map((e) => e.id), '2026-09-11');
    expect(transactions).toBe(1);
    expect(anns).toHaveLength(2);
    expect(annulations().map((a) => a.remplace_evenement_id).sort()).toEqual(ecrits.map((e) => e.id).sort());
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-10', SERIE.tomate)).toBeNull();
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-10', CAMPAGNE.fraise)).toBeNull();
    for (const a of annulations()) valide(a);
  });

  it('un événement du lot déjà annulé ailleurs : TraitementPlusEnVigueur, l’autre n’est pas annulé non plus', async () => {
    const ecrits = await lot().ecrireLotTraitement(porte, LOT());
    await lot().annulerLotTraitement(porte, FERME, [ecrits[0]?.id ?? ''], '2026-09-11');
    expect(annulations()).toHaveLength(1);
    await expect(lot().annulerLotTraitement(porte, FERME, ecrits.map((e) => e.id), '2026-09-11')).rejects.toBeInstanceOf(lot().TraitementPlusEnVigueur);
    expect(annulations()).toHaveLength(1);
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-10', CAMPAGNE.fraise)).not.toBeNull();
  });

  it('isolement : un événement d’une autre ferme dans la liste = refusé en entier, rien d’annulé (ni chez l’autre ferme, ni chez nous)', async () => {
    const ecrits = await lot().ecrireLotTraitement(porte, LOT());
    const etranger = id(0x500);
    await base.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
         VALUES (?, ?, 'traitement', '2026-09-10', '2026-09-10T07:00:00.000Z', ?, 'tap', NULL, NULL, '[]', NULL, '[]', NULL, NULL, ?, '2026-09-10T07:00:00.000Z')`,
        [etranger, AUTRE_FERME, UTILISATEUR, JSON.stringify({ produitPhytoId: DECIS, dose: { valeur: 1, unite: 'L/ha' }, surfaceTraiteeM2: 10, cible: 'x', operateur: '', recolteAutoriseeLe: '2026-09-20' })],
      );
    });
    await expect(lot().annulerLotTraitement(porte, FERME, [...ecrits.map((e) => e.id), etranger], '2026-09-11')).rejects.toBeInstanceOf(lot().TraitementPlusEnVigueur);
    expect(annulations()).toHaveLength(0);
  });
});

// ───────────────────────────── écran ─────────────────────────────

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

/** Tomate choisie, fraise cochée en plus : le formulaire du lot. */
async function ouvrirLot(chargerCatalogue?: () => Promise<CatalogueEphy>): Promise<HTMLElement> {
  const d = await ouvrir(SERIE.tomate, chargerCatalogue);
  await toucher(champ(FRAISE, d));
  await attendre(() => aChamp(`${DAR} · ${FRAISE}`, d), 'DAR de la fraise');
  return d;
}

const darDe = (nom: string, d: HTMLElement): string => champ(`${DAR} · ${nom}`, d).value;
const avertissements = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="avertissement-culture"]')];

async function communs(d: HTMLElement, date = '2026-09-10'): Promise<void> {
  await remplir(champ('Date', d), date);
  await remplir(champ('Dose', d), '0,5');
  await remplir(champ('Cible', d), 'thrips');
}

describe('T78 écran : cocher plusieurs cultures', () => {
  it('une culture cochée : le formulaire de T52/T76 inchangé ; la culture choisie est cochée, les autres non', async () => {
    const d = await ouvrir(SERIE.tomate);
    expect(champ(TOMATE, d).checked).toBe(true);
    expect(champ(FRAISE, d).checked).toBe(false);
    expect(champ(TOMATE, d).disabled).toBe(true);
    expect(aChamp(DAR, d)).toBe(true);
    expect(aChamp(`${DAR} · ${TOMATE}`, d)).toBe(false);
  });

  it('deux cultures cochées : un DAR et une surface par culture, les champs sans suffixe disparaissent, produit/dose/cible restent uniques', async () => {
    const d = await ouvrirLot();
    expect(aChamp(DAR, d)).toBe(false);
    expect(aChamp(SURFACE, d)).toBe(false);
    expect(aChamp(`${DAR} · ${TOMATE}`, d)).toBe(true);
    expect(aChamp(`${SURFACE} · ${TOMATE}`, d)).toBe(true);
    expect(aChamp(`${SURFACE} · ${FRAISE}`, d)).toBe(true);
    expect(champ(`${SURFACE} · ${TOMATE}`, d).value).toBe('24');
    expect(champ('T2-P07', d).checked).toBe(true);
    expect(champ('S1-G01', d).checked).toBe(true);
    expect(d.querySelectorAll('select')).toHaveLength(1);
  });

  it('décocher la culture d’origine : seule la fraise est traitée (un événement, campagne de la fraise) ; la dernière cochée ne se décoche pas', async () => {
    const d = await ouvrirLot();
    await toucher(champ(TOMATE, d));
    expect(champ(FRAISE, d).disabled).toBe(true);
    await attendre(() => aChamp(DAR, d), 'retour au formulaire d’une culture');
    await remplir(liste('Produit', d), DECIS);
    expect(champ(DAR, d).value).toBe('1');
    await communs(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 1, 'traitement écrit');
    expect(deTomate()).toBeUndefined();
    expect(deFraise()).toBeDefined();
  });
});

describe('T78 écran : produit homologué sur tomate (DAR 3) et fraise (DAR 1), traité le 10/09', () => {
  it('DAR proposé par culture, sans avertissement ; Enregistrer : un événement par culture, DAR figé, une transaction', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    expect(darDe(TOMATE, d)).toBe('3');
    expect(darDe(FRAISE, d)).toBe('1');
    expect(avertissements()).toHaveLength(0);
    await communs(d);
    const surfaceFraise = champ(`${SURFACE} · ${FRAISE}`, d).value;
    transactions = 0;
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 2, 'deux traitements écrits');
    expect(transactions).toBe(1);
    valide(deTomate());
    valide(deFraise());
    expect(detailDe(deTomate())).toEqual({ produitPhytoId: DECIS, dose: { valeur: 0.5, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'thrips', operateur: '', recolteAutoriseeLe: '2026-09-13' });
    expect(detailDe(deFraise())).toMatchObject({ produitPhytoId: DECIS, dose: { valeur: 0.5, unite: 'L/ha' }, surfaceTraiteeM2: Number(surfaceFraise.replace(',', '.')), recolteAutoriseeLe: '2026-09-11' });
    expect(emplacementsDe(deTomate())).toEqual([EMPLACEMENT.t2p07]);
    expect(emplacementsDe(deFraise())).toEqual([EMPLACEMENT.s1g01]);
    expect(deTomate()?.date).toBe('2026-09-10');
    expect(deFraise()?.date).toBe('2026-09-10');
    // Blocage de récolte par emplacement : tomate libre le 13/09, fraise le 11/09.
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-12', SERIE.tomate)).not.toBeNull();
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-13', SERIE.tomate)).toBeNull();
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-10', CAMPAGNE.fraise)).not.toBeNull();
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-11', CAMPAGNE.fraise)).toBeNull();
  });

  it('l’écran de confirmation liste chaque culture avec son propre DAR et sa date de récolte autorisée', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => document.querySelector('[data-testid="lot-culture"]') !== null, 'confirmation du lot');
    const ligne = (cible: string): string => texte(document.querySelector(`[data-testid="lot-culture"][data-cible="${cible}"]`));
    expect(document.querySelectorAll('[data-testid="lot-culture"]')).toHaveLength(2);
    expect(ligne(SERIE.tomate)).toContain(TOMATE);
    expect(ligne(SERIE.tomate)).toContain('DAR 3 j');
    expect(ligne(SERIE.tomate)).toContain('13/09');
    expect(ligne(CAMPAGNE.fraise)).toContain(FRAISE);
    expect(ligne(CAMPAGNE.fraise)).toContain('DAR 1 j');
    expect(ligne(CAMPAGNE.fraise)).toContain('11/09');
  });

  it('annuler le lot : une transaction, une annulation par événement, « Traitement annulé », tous les emplacements libres', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 2, 'deux traitements écrits');
    await attendre(() => dialogueOuEchec('Traitement').querySelector('[data-testid="lot-culture"]') !== null, 'confirmation');
    transactions = 0;
    await toucher(bouton('Annuler ce traitement', dialogueOuEchec('Traitement')));
    await attendre(() => annulations().length === 2, 'deux annulations');
    expect(transactions).toBe(1);
    expect(annulations().map((a) => a.remplace_evenement_id).sort()).toEqual(originaux().map((o) => o.id).sort());
    expect(texte(dialogue('Traitement'))).toContain('Traitement annulé');
    expect(interdit(EMPLACEMENT.t2p07, '2026-09-10', SERIE.tomate)).toBeNull();
    expect(interdit(EMPLACEMENT.s1g01, '2026-09-10', CAMPAGNE.fraise)).toBeNull();
    expect(() => bouton('Annuler ce traitement', dialogueOuEchec('Traitement'))).toThrow();
  });
});

describe('T78 écran : une culture non homologuée (produit sur Fraisier seul)', () => {
  it('avertissement pour la tomate seule, DAR demandé pour elle, la fraise inchangée (DAR 1) et sans avertissement', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), FRAISIER_SEUL);
    await attendre(() => avertissements().length > 0, 'avertissement');
    expect(avertissements()).toHaveLength(1);
    expect(avertissements()[0]?.dataset.cible).toBe(SERIE.tomate);
    expect(texte(avertissements()[0])).toMatch(/produit non homologué sur cette culture/i);
    expect(darDe(TOMATE, d)).toBe('');
    expect(darDe(FRAISE, d)).toBe('1');
  });

  it('DAR de la tomate vide : enregistrement refusé (message qui nomme la tomate), rien d’écrit pour aucune culture ; une fois saisi, les deux sont écrits, chacun avec son DAR', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), FRAISIER_SEUL);
    await communs(d, AUJOURDHUI);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/délai avant récolte/i);
    expect(texte(d.querySelector('[role="alert"]'))).toContain(TOMATE);
    expect(lignes()).toHaveLength(0);
    expect(transactions).toBe(0);
    await remplir(champ(`${DAR} · ${TOMATE}`, d), '5');
    expect(darDe(FRAISE, d)).toBe('1');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 2, 'lot écrit malgré l’avertissement');
    expect(transactions).toBe(1);
    expect(detailDe(deTomate()).recolteAutoriseeLe).toBe('2026-10-05');
    expect(detailDe(deFraise()).recolteAutoriseeLe).toBe('2026-10-01');
  });

  it('DAR invalide pour une culture (décimal, au-delà d’un an) : refusé, rien d’écrit', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d, AUJOURDHUI);
    for (const mauvais of ['1,5', '400', '-2', 'trois']) {
      await remplir(champ(`${DAR} · ${FRAISE}`, d), mauvais);
      await toucher(bouton('Enregistrer', d));
      await attendre(() => d.querySelector('[role="alert"]') !== null, `refus de « ${mauvais} »`);
      expect(texte(d.querySelector('[role="alert"]')), mauvais).toContain(FRAISE);
      expect(lignes(), mauvais).toHaveLength(0);
    }
  });

  it('changer de produit recalcule les DAR de toutes les cultures et efface ce qui avait été saisi', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), FRAISIER_SEUL);
    await remplir(champ(`${DAR} · ${TOMATE}`, d), '9');
    await remplir(liste('Produit', d), DECIS);
    expect(darDe(TOMATE, d)).toBe('3');
    expect(darDe(FRAISE, d)).toBe('1');
    expect(avertissements()).toHaveLength(0);
  });
});

describe('T78 écran : Q47 par culture et catalogue indisponible', () => {
  it('DAR absent d’E-Phy pour la tomate : champ vide (ni le 9 j de la fiche, ni le DAR de la fraise), sans avertissement d’homologation ; la fraise reste à 1', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), TOMATE_SANS_DAR);
    expect(darDe(TOMATE, d)).toBe('');
    expect(darDe(FRAISE, d)).toBe('1');
    expect(avertissements()).toHaveLength(0);
    await communs(d, AUJOURDHUI);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(lignes()).toHaveLength(0);
  });

  it('catalogue indisponible : produit à N° AMM, les DAR de toutes les cultures restent vides (jamais ceux de la fiche), avis e-phy indisponible', async () => {
    const d = await ouvrirLot(() => Promise.reject(new Error('catalogue illisible')));
    await remplir(liste('Produit', d), DECIS);
    expect(darDe(TOMATE, d)).toBe('');
    expect(darDe(FRAISE, d)).toBe('');
    expect(document.querySelector('[data-testid="avertissement-ephy"]')).not.toBeNull();
    await communs(d, AUJOURDHUI);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(lignes()).toHaveLength(0);
  });
});

// ───────────────────────────── relecture critique (correctifs) ─────────────────────────────

/**
 * Correctifs de relecture, règles retenues (les plus simples pour le maraîcher) :
 *   1. En lot, un DAR est lu comme dans le formulaire d'une culture : jours entiers en chiffres seulement
 *      (« 5 »), rien d'autre. « 1e1 », « 0x5 », « 5. », « -1 », « 2,5 » sont refusés pour la culture
 *      concernée (message qui la nomme), rien n'est écrit pour aucune culture.
 *   2. Dose commune : une unité qui n'est pas « par hectare » (ni « /ha », ni « /hL ») est une quantité
 *      totale ; en lot (2 cultures cochées ou plus), l'écran le dit : avis visible, non bloquant,
 *      [data-testid="avertissement-unite-lot"] (role="status", cite « quantité totale » et « chaque culture »).
 *      Aucun avis avec une seule culture, ni avec une unité par hectare (« L/ha », « kg/ha »).
 *   3. Un emplacement supprimé ou désactivé (actif_au passé) entre l'affichage et l'écriture est revérifié
 *      DANS la transaction du lot : lot entier refusé (TraitementRefuse côté données ; message role="alert"
 *      qui cite « emplacement » côté écran), rien d'écrit à moitié.
 */
describe('T78 relecture 1 : DAR du lot lu comme celui d’une culture seule', () => {
  it.each(['1e1', '0x5', '5.', '-1', '2,5', ' ', '+3', '1_0'])('« %s » refusé pour la tomate, rien d’écrit', async (mauvais) => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d, AUJOURDHUI);
    await remplir(champ(`${DAR} · ${TOMATE}`, d), mauvais);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, `refus de « ${mauvais} »`);
    expect(texte(d.querySelector('[role="alert"]'))).toContain(TOMATE);
    expect(lignes()).toHaveLength(0);
    expect(transactions).toBe(0);
  });

  it('la même saisie valide (« 5 ») passe, DAR figé à 5 jours', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d, AUJOURDHUI);
    await remplir(champ(`${DAR} · ${TOMATE}`, d), '5');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 2, 'lot écrit');
    expect(detailDe(deTomate()).recolteAutoriseeLe).toBe('2026-10-05');
  });
});

describe('T78 relecture 2 : dose commune et unité en quantité totale', () => {
  const avis = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="avertissement-unite-lot"]');

  it('lot et unité « L » ou « kg » : avis visible qui parle de quantité totale et de chaque culture ; l’enregistrement reste possible', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    expect(avis()).toBeNull();
    for (const unite of ['L', 'kg']) {
      await remplir(champ('Unité', d), unite);
      await attendre(() => avis() !== null, `avis pour « ${unite} »`);
      expect(texte(avis())).toMatch(/quantité totale/i);
      expect(texte(avis())).toMatch(/chaque culture/i);
    }
    await communs(d);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => originaux().length === 2, 'non bloquant : lot écrit');
  });

  it('pas d’avis avec une unité par hectare, ni avec une seule culture', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await remplir(champ('Unité', d), 'kg/ha');
    expect(avis()).toBeNull();
    await remplir(champ('Unité', d), 'L');
    await attendre(() => avis() !== null, 'avis en lot');
    await toucher(champ(FRAISE, d));
    await attendre(() => avis() === null, 'avis retiré avec une seule culture');
  });
});

describe('T78 relecture 3 : emplacement supprimé ou désactivé avant l’écriture', () => {
  it('données : emplacement de la fraise supprimé juste avant l’écriture → lot entier refusé, rien d’écrit pour la tomate non plus', async () => {
    await base.execute('UPDATE emplacement SET supprime_le = ? WHERE id = ?', ['2026-09-09T08:00:00.000Z', EMPLACEMENT.s1g01]);
    await expect(lot().ecrireLotTraitement(porte, LOT())).rejects.toBeInstanceOf(lot().TraitementRefuse);
    expect(lignes()).toHaveLength(0);
  });

  it('données : emplacement de la tomate désactivé avant la date du traitement (actif_au passé) → lot entier refusé', async () => {
    await base.execute('UPDATE emplacement SET actif_au = ? WHERE id = ?', ['2026-09-01', EMPLACEMENT.t2p07]);
    await expect(lot().ecrireLotTraitement(porte, LOT())).rejects.toBeInstanceOf(lot().TraitementRefuse);
    expect(lignes()).toHaveLength(0);
  });

  it('données : emplacements intacts → lot écrit (la revérification ne bloque pas le cas normal)', async () => {
    await expect(lot().ecrireLotTraitement(porte, LOT())).resolves.toHaveLength(2);
  });

  it('écran : emplacement de la fraise supprimé entre l’affichage et « Enregistrer » → refus du lot entier, message sur l’emplacement, rien d’écrit', async () => {
    const d = await ouvrirLot();
    await remplir(liste('Produit', d), DECIS);
    await communs(d);
    await base.execute('UPDATE emplacement SET supprime_le = ? WHERE id = ?', ['2026-09-09T08:00:00.000Z', EMPLACEMENT.s1g01]);
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/emplacement/i);
    expect(lignes()).toHaveLength(0);
    expect(document.querySelector('[data-testid="lot-culture"]')).toBeNull();
  });
});

