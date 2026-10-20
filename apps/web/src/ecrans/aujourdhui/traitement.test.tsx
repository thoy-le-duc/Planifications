// @vitest-environment happy-dom
/**
 * Tests d'acceptation T52 — écran Aujourd'hui : saisir un traitement au champ, alerte de délai
 * avant récolte (docs/backlog/T52-registre-phyto.md, règles 2, 4 et 5). Vrai écran dans un DOM
 * simulé (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts, aujourd'hui = 2026-09-30),
 * lue et écrite par la porte (base mémoire de @planif/sync), sans réseau.
 *
 * ── Contrat (en plus de ./test/contrat.ts) ──────────────────────────────────────────────────
 *
 * Bouton « Traitement » (à côté de « Noter une récolte ») : charge À LA DEMANDE la saisie du
 * traitement (./traitement/, hors du morceau d'Aujourd'hui) et ouvre le dialogue « Traitement » :
 *   1. la culture : boutons [data-testid="choix-traitement"][data-cible=<série ou campagne>],
 *      les cultures en place ce jour (séries prévues ou en cours dont une occupation couvre le
 *      jour, campagnes de l'année sur une plantation non arrachée) ;
 *   2. le formulaire : cases à cocher des emplacements de la culture (nom = code, toutes cochées),
 *      liste « Produit » (produits non archivés de la ferme et de la bibliothèque), « Date »
 *      (aujourd'hui par défaut), « Dose » (virgule acceptée), « Unité » (celle de la dose
 *      maximale du produit, sinon L/ha), « Surface traitée (m²) » (calculée depuis les
 *      emplacements cochés, modifiable), « Cible », « Opérateur » (facultatif), « Enregistrer ».
 *      Dose au-dessus de la dose maximale : [data-testid="avertissement-dose"], non bloquant.
 *   3. enregistré (UNE transaction, ligne acceptée par validerSaisie) : le dialogue le dit, avec
 *      « Récolte autorisée le JJ/MM », « Annuler ce traitement » et « Fermer ».
 *
 * Alerte : une récolte (carte « Peser » d'un début de récolte, ou culture choisie dans le
 * dialogue « Récolte ») dont un emplacement est sous DAR affiche [data-testid="alerte-dar"] :
 * « Récolte interdite jusqu’au JJ/MM (Produit, traité le JJ/MM) ». « Valider » demande alors une
 * confirmation explicite (role="alertdialog" « Récolter quand même ? », boutons « Récolter quand
 * même » et « Ne pas récolter ») ; confirmée, la récolte est écrite et sa note garde
 * l'avertissement.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import type { ModulePhyto } from '../ferme/phyto/test/contrat.ts';
import { CAMPAGNE, cleTache, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN_ECRAN = './index.ts';
const CHEMIN_PHYTO = '../ferme/phyto/index.ts';
const AUJOURDHUI = '2026-09-30';

const id = (n: number) => `0192f0c1-5252-7000-8000-${n.toString(16).padStart(12, '0')}`;
const BOUILLIE = id(0x10);
const SPINOSAD = id(0x11);
const ARCHIVE = id(0x12);

let ecran: ModuleEcranAujourdhui;
let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let avant: Set<string>;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly note: string | null;
  readonly source: string;
  readonly detail: string;
  readonly remplace_sorte: string | null;
}

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const nouveaux = (): LigneEvenement[] => evenements().filter((e) => !avant.has(e.id));
const mouvementsDe = (recolteId: string) => base.lireDirect<{ quantite: number }>('SELECT quantite FROM mouvement_stock WHERE recolte_id = ?', [recolteId]);

function remiseAZero(): void {
  transactions = 0;
  avant = new Set(evenements().map((e) => e.id));
}

function valide(e: LigneEvenement | undefined): void {
  if (e === undefined) throw new Error('événement absent');
  const r = validerSaisie({ ...e });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse : ${r.erreur.message}`).toBe(true);
}

const horo = { cree_le: '2026-01-01T08:00:00.000Z', modifie_le: '2026-01-01T08:00:00.000Z' };

async function ecrireProduits(): Promise<void> {
  await base.writeTransaction(async (tx) => {
    const sql = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await tx.execute(sql, [BOUILLIE, FERME, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, JSON.stringify({ valeur: 3, unite: 'L/ha' }), horo.cree_le, horo.modifie_le, null]);
    await tx.execute(sql, [SPINOSAD, null, 'Success 4', '2010513', 'spinosad', 1, 0, null, horo.cree_le, horo.modifie_le, null]);
    await tx.execute(sql, [ARCHIVE, FERME, 'Ancien produit', '1', 'x', 3, 0, null, horo.cree_le, horo.modifie_le, '2026-06-01T08:00:00.000Z']);
  });
}

/** Un traitement déjà au journal (autre téléphone), sur `emplacement`. */
async function ecrireTraitement(evenementId: string, emplacement: string, culture: { serie_id?: string; campagne_id?: string }, date: string, recolteAutoriseeLe: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', ?, ?, ?, 'tap', ?, ?, ?, NULL, '[]', NULL, NULL, ?, ?)`,
      [
        evenementId,
        FERME,
        date,
        `${date}T07:00:00.000Z`,
        UTILISATEUR,
        culture.serie_id ?? null,
        culture.campagne_id ?? null,
        JSON.stringify([emplacement]),
        JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe }),
        `${date}T07:00:00.000Z`,
      ],
    );
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  await ecrireProduits();
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
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
  // Hors ligne : aucun appel réseau n'est permis.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  remiseAZero();
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

/** « Traitement », puis la culture : le formulaire du traitement. */
async function ouvrirTraitement(cible: string): Promise<HTMLElement> {
  await toucher(bouton('Traitement', conteneur));
  await attendre(() => dialogue('Traitement') !== undefined, 'dialogue « Traitement » chargé et ouvert');
  await attendre(() => dialogueOuEchec('Traitement').querySelector(`[data-testid="choix-traitement"][data-cible="${cible}"]`) !== null, `culture ${cible} proposée`);
  const choix = dialogueOuEchec('Traitement').querySelector<HTMLElement>(`[data-testid="choix-traitement"][data-cible="${cible}"]`);
  if (choix === null) throw new Error('culture absente');
  await toucher(choix);
  await attendre(() => [...dialogueOuEchec('Traitement').querySelectorAll('select')].length > 0, 'formulaire du traitement');
  return dialogueOuEchec('Traitement');
}

async function choisirRecolte(cible: string): Promise<HTMLElement> {
  await toucher(bouton(/^Noter une récolte/, conteneur));
  await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
  const choix = dialogueOuEchec('Récolte').querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${cible}"]`);
  if (choix === null) throw new Error('culture absente de la récolte');
  await toucher(choix);
  return dialogueOuEchec('Récolte');
}

describe('T52 : saisir un traitement depuis Aujourd’hui, au doigt, hors ligne', () => {
  it('culture, produit, dose, cible, Enregistrer : un traitement en une transaction, DAR figé, accepté par le serveur', async () => {
    await rendre();
    const d = await ouvrirTraitement(SERIE.tomate);
    // Emplacement de la série coché par défaut ; date du jour ; surface calculée (30 m × 0,8 m).
    const t2p07 = champ('T2-P07', d);
    expect(t2p07.type).toBe('checkbox');
    expect(t2p07.checked).toBe(true);
    expect(champ('Date', d).value).toBe(AUJOURDHUI);
    expect(champ('Surface traitée (m²)', d).value).toBe('24');
    // Produits proposés : ceux de la ferme et de la bibliothèque, pas l'archivé.
    const produits = [...liste('Produit', d).options].map((o) => o.value).filter((v) => v !== '');
    expect(produits.sort()).toEqual([BOUILLIE, SPINOSAD].sort());
    await remplir(liste('Produit', d), BOUILLIE);
    expect(champ('Unité', d).value).toBe('L/ha');
    await remplir(champ('Dose', d), '2,5');
    await remplir(champ('Cible', d), 'mildiou');
    remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(transactions).toBe(1);
    const [e] = nouveaux();
    valide(e);
    expect(e).toMatchObject({ type: 'traitement', date: AUJOURDHUI, serie_id: SERIE.tomate, source: 'tap', remplace_sorte: null });
    expect((JSON.parse(e?.emplacement_ids ?? '[]') as string[]).map((x) => x.toLowerCase())).toEqual([EMPLACEMENT.t2p07]);
    expect(JSON.parse(e?.detail ?? '{}')).toEqual({
      produitPhytoId: BOUILLIE,
      dose: { valeur: 2.5, unite: 'L/ha' },
      surfaceTraiteeM2: 24,
      cible: 'mildiou',
      operateur: '',
      recolteAutoriseeLe: '2026-10-03',
    });
    await attendre(() => texte(dialogue('Traitement')).includes('Récolte autorisée le 03/10'), 'le dialogue dit la date de récolte autorisée');
    await toucher(bouton('Fermer', dialogueOuEchec('Traitement')));
    await attendre(() => dialogue('Traitement') === undefined, 'dialogue fermé');
  });

  it('visible dans le registre phyto aussitôt (même base, sans réseau)', async () => {
    await rendre();
    const d = await ouvrirTraitement(CAMPAGNE.fraise);
    await remplir(liste('Produit', d), SPINOSAD);
    await remplir(champ('Dose', d), '0,2');
    await remplir(champ('Cible', d), 'thrips');
    await remplir(champ('Opérateur', d), 'Lucas');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    const [e] = nouveaux();
    valide(e);
    expect(e?.campagne_id).toBe(CAMPAGNE.fraise);
    expect(JSON.parse(e?.detail ?? '{}')).toMatchObject({ operateur: 'Lucas', recolteAutoriseeLe: '2026-10-01' });

    const registre = (await import(/* @vite-ignore */ CHEMIN_PHYTO)) as ModulePhyto;
    const autre = document.createElement('div');
    document.body.append(autre);
    const r2 = createRoot(autre);
    await act(async () => {
      r2.render(<registre.EcranRegistrePhyto porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} surFermer={() => undefined} />);
      await Promise.resolve();
    });
    await attendre(() => document.querySelector(`[data-testid="ligne-registre"][data-evenement="${e?.id ?? ''}"]`) !== null, 'ligne du registre');
    const ligne = document.querySelector(`[data-testid="ligne-registre"][data-evenement="${e?.id ?? ''}"]`);
    expect(texte(ligne)).toContain('Success 4');
    expect(texte(ligne)).toContain('S1-G01');
    expect(texte(ligne)).toContain('Fraise');
    expect(texte(ligne)).toContain('thrips');
    act(() => {
      r2.unmount();
    });
    autre.remove();
  });

  it('dose au-dessus de la dose maximale : avertissement, l’enregistrement reste possible', async () => {
    await rendre();
    const d = await ouvrirTraitement(SERIE.tomate);
    await remplir(liste('Produit', d), BOUILLIE);
    await remplir(champ('Cible', d), 'mildiou');
    await remplir(champ('Dose', d), '2');
    expect(d.querySelector('[data-testid="avertissement-dose"]')).toBeNull();
    await remplir(champ('Dose', d), '4');
    await attendre(() => d.querySelector('[data-testid="avertissement-dose"]') !== null, 'avertissement de dose');
    expect(texte(d.querySelector('[data-testid="avertissement-dose"]'))).toContain('3 L/ha');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit malgré l’avertissement');
    valide(nouveaux()[0]);
  });

  // T69 (relecture) : la seule planche de la culture ne se décoche plus (un traitement d'une culture
  // qui a des planches en désigne au moins une) ; le décochage d'une planche parmi deux est vérifié
  // dans dar-par-planche.test.tsx.
  it('seule planche de la culture : elle reste cochée ; la surface reste modifiable', async () => {
    await rendre();
    const d = await ouvrirTraitement(SERIE.tomate);
    expect(champ('T2-P07', d).disabled).toBe(true);
    await toucher(champ('T2-P07', d));
    expect(champ('T2-P07', d).checked).toBe(true);
    expect(champ('Surface traitée (m²)', d).value).toBe('24');
    await remplir(champ('Surface traitée (m²)', d), '12,5');
    await remplir(liste('Produit', d), BOUILLIE);
    await remplir(champ('Dose', d), '2');
    await remplir(champ('Cible', d), 'mildiou');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveaux().length === 1, 'traitement écrit');
    expect(JSON.parse(nouveaux()[0]?.detail ?? '{}')).toMatchObject({ surfaceTraiteeM2: 12.5 });
  });
});

describe('T52 : alerte sur une récolte d’un emplacement traité', () => {
  const TRAITEMENT = id(0x100);

  it('dialogue Récolte : alerte affichée, confirmation exigée, la note garde l’avertissement', async () => {
    await ecrireTraitement(TRAITEMENT, EMPLACEMENT.t2p07, { serie_id: SERIE.tomate }, '2026-09-29', '2026-10-02');
    remiseAZero();
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    const alerte = 'Récolte interdite jusqu’au 02/10 (Bouillie bordelaise, traité le 29/09)';
    await attendre(() => texte(d.querySelector('[data-testid="alerte-dar"]')).includes(alerte), 'alerte de DAR dans la récolte');
    await toucher(bouton('5', d));
    await toucher(bouton(/^Valider/, d));
    // Rien d'écrit sans confirmation explicite.
    await attendre(() => dialogue('Récolter quand même ?') !== undefined, 'confirmation demandée');
    expect(nouveaux()).toHaveLength(0);
    await toucher(bouton('Ne pas récolter', dialogueOuEchec('Récolter quand même ?')));
    await attendre(() => dialogue('Récolter quand même ?') === undefined, 'confirmation refermée');
    expect(nouveaux()).toHaveLength(0);
    expect(dialogue('Récolte')).toBeDefined();

    await toucher(bouton(/^Valider/, dialogueOuEchec('Récolte')));
    await attendre(() => dialogue('Récolter quand même ?') !== undefined, 'confirmation demandée de nouveau');
    remiseAZero();
    await toucher(bouton('Récolter quand même', dialogueOuEchec('Récolter quand même ?')));
    await attendre(() => nouveaux().length === 1, 'récolte écrite après confirmation');
    expect(transactions).toBe(1);
    const [r] = nouveaux();
    valide(r);
    expect(r?.type).toBe('recolte');
    expect(r?.note).toContain(alerte);
    expect(mouvementsDe(r?.id ?? '')).toEqual([{ quantite: 5 }]);
  });

  it('sans traitement, ou DAR écoulé : ni alerte ni confirmation', async () => {
    await ecrireTraitement(TRAITEMENT, EMPLACEMENT.t2p07, { serie_id: SERIE.tomate }, '2026-09-20', '2026-09-30');
    remiseAZero();
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await toucher(bouton('5', d));
    await toucher(bouton(/^Valider/, d));
    await attendre(() => nouveaux().length === 1, 'récolte écrite sans confirmation');
    expect(dialogue('Récolter quand même ?')).toBeUndefined();
    expect(nouveaux()[0]?.note).toBeNull();
  });

  it('carte de début de récolte (« Peser ») : l’alerte s’affiche sur la carte de l’emplacement traité seulement', async () => {
    await ecrireTraitement(TRAITEMENT, EMPLACEMENT.s1g01, { campagne_id: CAMPAGNE.fraise }, AUJOURDHUI, '2026-10-01');
    await rendre();
    const fraise = () => tache(cleTache(CAMPAGNE.fraise, 'debut_recolte'));
    await attendre(() => fraise()?.querySelector('[data-testid="alerte-dar"]') !== null && fraise() !== undefined, 'alerte sur la carte de la fraise');
    expect(texte(fraise()?.querySelector('[data-testid="alerte-dar"]'))).toBe('Récolte interdite jusqu’au 01/10 (Bouillie bordelaise, traité le 30/09)');
    for (const t of taches()) if (t !== fraise()) expect(t.querySelector('[data-testid="alerte-dar"]'), t.dataset.cle).toBeNull();
  });

  it('traitement saisi puis annulé depuis le dialogue : l’alerte apparaît puis disparaît', async () => {
    await rendre();
    const d = await ouvrirTraitement(CAMPAGNE.fraise);
    await remplir(liste('Produit', d), BOUILLIE);
    await remplir(champ('Dose', d), '2');
    await remplir(champ('Cible', d), 'botrytis');
    await toucher(bouton('Enregistrer', d));
    const fraise = () => tache(cleTache(CAMPAGNE.fraise, 'debut_recolte'));
    await attendre(() => fraise()?.querySelector('[data-testid="alerte-dar"]') != null, 'alerte après le traitement');
    remiseAZero();
    await toucher(bouton('Annuler ce traitement', dialogueOuEchec('Traitement')));
    await attendre(() => nouveaux().length === 1, 'annulation écrite');
    expect(transactions).toBe(1);
    const [a] = nouveaux();
    valide(a);
    expect(a?.remplace_sorte).toBe('annulation');
    await attendre(() => fraise()?.querySelector('[data-testid="alerte-dar"]') == null, 'alerte retirée après l’annulation');
  });
});
