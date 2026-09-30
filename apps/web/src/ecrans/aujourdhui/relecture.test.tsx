// @vitest-environment happy-dom
/**
 * Tests des corrections de la relecture de T13 (écran « Aujourd'hui »), dans un DOM simulé
 * (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts) lue et écrite par la porte (base
 * mémoire). Contrat : ./test/contrat.ts, section « Corrections de la relecture ».
 *
 *   B1  Saisie dont la culture est retirée (série ou campagne supprimée) : ni « Annuler » ni
 *       « Changer la date » dans l'historique, un texte le dit.
 *   B2  Emplacements supprimés ou inactifs jamais recopiés : ni dans une nouvelle saisie, ni dans
 *       une annulation ou une correction ; plus aucun emplacement actif → liste vide, acceptée
 *       par validerSaisie.
 *   B3  Le jour n'est pas figé au montage : recalculé à chaque écriture ; au retour au premier
 *       plan (visibilitychange), l'écran passe au nouveau jour. Horloge simulée qui passe minuit,
 *       sans la propriété `aujourdhui` (jour du téléphone).
 *   D1  Double « Fait » : la tâche quitte la liste (ou son bouton est désactivé) dès le tap, avant
 *       toute relecture ; un second tap n'écrit rien.
 *   S1  Récolte d'avant T13, sans aucun mouvement dans sa chaîne : changer sa date n'écrit ni
 *       article ni mouvement.
 *   F1  Dialogues « Récolte » et « Changer la date » : focus gardé dedans (Tab et Maj+Tab en
 *       boucle), rendu à l'élément d'origine à la fermeture.
 *   N1  Historique : « Annuler » et « Changer la date » nomment la saisie (« Annuler : Récolte
 *       12 kg, Tomate »).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { TEXTE_CULTURE_RETIREE, type ModuleEcranAujourdhui } from './test/contrat.ts';
import { CAMPAGNE, cleTache, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable, comme ecran.test.tsx. */
const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Base, porte ──────────────────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly [colonne: string]: unknown;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
/** Tant qu'il est posé, chaque transaction d'écriture attend qu'il soit levé. */
let verrou: Promise<void> | null = null;
let evenementsAvant = new Set<string>();
let mouvementsAvant = new Set<string>();
let articlesAvant = new Set<string>();

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const ids = (sql: string): string[] => base.lireDirect<{ id: string }>(sql).map((l) => l.id);
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));
const nouveauxMouvements = () => ids('SELECT id FROM mouvement_stock').filter((i) => !mouvementsAvant.has(i));
const nouveauxArticles = () => ids('SELECT id FROM article_stock').filter((i) => !articlesAvant.has(i));

function remiseAZero(): void {
  transactions = 0;
  evenementsAvant = new Set(evenements().map((e) => e.id));
  mouvementsAvant = new Set(ids('SELECT id FROM mouvement_stock'));
  articlesAvant = new Set(ids('SELECT id FROM article_stock'));
}

function verifierValide(e: LigneEvenement): void {
  const r = validerSaisie({ ...e });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse ${e.id} : ${r.erreur.message}`).toBe(true);
}

const emplacements = (e: LigneEvenement): string[] => (JSON.parse(e.emplacement_ids) as string[]).map((x) => x.toLowerCase()).sort();

/** Ligne arrivée par la synchro (autre téléphone, bureau) : prévient les abonnés. */
function recevoir(table: string, ligne: Readonly<Record<string, string | number | null>>): void {
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const idTest = (n: number) => `0192f0c1-1313-7000-8000-00000000${n.toString(16).padStart(4, '0')}`;
const C = '2025-01-01T08:00:00.000Z';

/** Emplacement de la zone de T2-P03, actif ou non. */
function emplacement(id: string, code: string, extra: Readonly<Record<string, string | null>> = {}): void {
  const zone = base.lireDirect<{ zone_id: string }>('SELECT zone_id FROM emplacement WHERE id = ?', [EMPLACEMENT.t2p03])[0]?.zone_id ?? null;
  recevoir('emplacement', {
    id,
    ferme_id: FERME,
    zone_id: zone,
    code,
    sorte: 'planche',
    longueur_m: 30,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: '2024-01-01',
    actif_au: null,
    remplace: '[]',
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
    ...extra,
  });
}

/** Occupation (non supprimée) d'une série sur un emplacement. */
function occupation(id: string, serieId: string, emplacementId: string): void {
  recevoir('occupation', {
    id,
    ferme_id: FERME,
    emplacement_id: emplacementId,
    serie_id: serieId,
    plantation_id: null,
    evenement_id: null,
    longueur_m: 30,
    nombre_places: null,
    position_m: 0,
    prevu_du: '2026-09-01',
    prevu_au: '2027-01-31',
    reel_du: null,
    reel_au: null,
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  });
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  verrou = null;
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: async (fn) => {
      transactions++;
      if (verrou !== null) await verrou;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  remiseAZero();
});

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.useRealTimers();
  base.fermer();
});

/** Un tour de boucle. Seule l'horloge (Date) est simulée ici : setTimeout reste réel. */
async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, tours = 200): Promise<void> {
  for (let k = 0; k < tours && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

/** `jour` : le jour donné à l'écran ; null : pas de propriété (jour du téléphone, horloge). */
async function rendre(jour: string | null = AUJOURDHUI): Promise<void> {
  await act(async () => {
    racine.render(
      jour === null ? (
        <ecran.EcranAujourdhui porte={porte} fermeId={FERME} />
      ) : (
        <ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => jour} />
      ),
    );
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null) return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(' ').trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    return texte(lie ?? el.closest('label'));
  }
  return texte(el);
}

const boutons = (dans: ParentNode = conteneur): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];
const correspond = (b: HTMLElement, nom: string | RegExp) => (typeof nom === 'string' ? nomAccessible(b) === nom : nom.test(nomAccessible(b)));

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const b = boutons(dans).find((x) => correspond(x, nom));
  expect(b, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeDefined();
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

const aBouton = (nom: string | RegExp, dans: ParentNode = conteneur): boolean => boutons(dans).some((b) => correspond(b, nom));
const desactive = (b: HTMLElement): boolean => (b instanceof HTMLButtonElement && b.disabled) || b.getAttribute('aria-disabled') === 'true';

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const dialogue = (debutNom: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => nomAccessible(d).startsWith(debutNom));

function tacheOuEchec(cle: string): HTMLElement {
  const t = tache(cle);
  expect(t, `tâche ${cle} affichée (affichées : ${taches().map((x) => String(x.dataset.cle)).join(', ')})`).toBeDefined();
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t;
}

async function historique(): Promise<HTMLElement> {
  const trouver = () =>
    [...conteneur.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');
  if (trouver() === undefined) await toucher(bouton('Historique'));
  await attendre(() => trouver() !== undefined, 'région « Historique »');
  const h = trouver();
  if (h === undefined) throw new Error('historique absent');
  return h;
}

const entrees = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')];

async function entree(evenementId: string): Promise<HTMLElement> {
  const h = await historique();
  await attendre(() => entrees(h).some((x) => x.dataset.evenement === evenementId), `saisie ${evenementId} dans l’historique`);
  const e = entrees(h).find((x) => x.dataset.evenement === evenementId);
  if (e === undefined) throw new Error('entrée absente');
  return e;
}

async function remplir(champ: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

/** Change la date de la saisie `evenementId` depuis l'historique. */
async function changerDate(evenementId: string, date: string): Promise<void> {
  await toucher(bouton(/^Changer la date/, await entree(evenementId)));
  await attendre(() => dialogue('Changer la date') !== undefined, 'dialogue « Changer la date »');
  const d = dialogue('Changer la date');
  const champ = [...(d?.querySelectorAll<HTMLInputElement>('input') ?? [])].find((i) => nomAccessible(i) === 'Date');
  if (d === undefined || champ === undefined) throw new Error('champ Date absent');
  await remplir(champ, date);
  await toucher(bouton('Enregistrer', d));
  await attendre(() => dialogue('Changer la date') === undefined, 'le dialogue se ferme');
}

async function faitSurChou(): Promise<LigneEvenement> {
  await toucher(bouton(/^Marquer fait/, tacheOuEchec(cleTache(SERIE.chou, 'plantation'))));
  await attendre(() => nouveauxEvenements().length === 1, 'réalisé écrit');
  const e = nouveauxEvenements()[0];
  if (e === undefined) throw new Error('réalisé absent');
  return e;
}

async function recolter(cibleId: string, chiffres: string): Promise<void> {
  await toucher(bouton(/^Noter une récolte/));
  await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
  const choix = dialogue('Récolte')?.querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${cibleId}"]`);
  if (choix === null || choix === undefined) throw new Error(`culture ${cibleId} non proposée`);
  await toucher(choix);
  const d = dialogue('Récolte');
  if (d === undefined) throw new Error('récolte fermée');
  for (const c of chiffres) await toucher(bouton(c, d));
  await toucher(bouton(/^Valider/, d));
  await attendre(() => dialogue('Récolte') === undefined, 'la récolte se ferme');
}

/** Récolte de fraises d'avant T13 (aucun mouvement de stock), saisie le 28 septembre. */
const RECOLTE_ANCIENNE = idTest(0xa1);
function recolteAncienne(): void {
  recevoir('evenement', {
    id: RECOLTE_ANCIENNE,
    ferme_id: FERME,
    type: 'recolte',
    date: '2026-09-28',
    horodatage: '2026-09-28T07:00:00.000Z',
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: null,
    campagne_id: CAMPAGNE.fraise,
    emplacement_ids: JSON.stringify([EMPLACEMENT.s1g01]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ quantite: 4, unite: 'barquette', categorie: null }),
    cree_le: '2026-09-28T07:00:01.000Z',
  });
}

const SELECTEUR_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const focusables = (d: HTMLElement): HTMLElement[] => [...d.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLE)];

async function tab(el: HTMLElement, arriere = false): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: arriere, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

/** Focus dans le dialogue à l'ouverture, Tab et Maj+Tab en boucle. */
async function verifierPiege(d: HTMLElement, nom: string): Promise<void> {
  expect(d.contains(document.activeElement), `${nom} : focus dans le dialogue à l’ouverture`).toBe(true);
  const f = focusables(d);
  expect(f.length, `${nom} : au moins deux éléments focalisables`).toBeGreaterThanOrEqual(2);
  const premier = f[0];
  const dernier = f.at(-1);
  if (premier === undefined || dernier === undefined) return;
  act(() => {
    dernier.focus();
  });
  await tab(dernier);
  expect(document.activeElement, `${nom} : Tab sur le dernier revient au premier`).toBe(premier);
  await tab(premier, true);
  expect(document.activeElement, `${nom} : Maj+Tab sur le premier va au dernier`).toBe(dernier);
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('T13, relecture B1 : culture retirée', () => {
  it('une saisie dont la série ou la campagne est supprimée n’a ni « Annuler » ni « Changer la date » ; un texte le dit', async () => {
    recolteAncienne();
    remiseAZero();
    await rendre();
    const fait = await faitSurChou();
    base.recevoir('UPDATE serie SET supprime_le = ? WHERE id = ?', ['2026-09-30T09:00:00.000Z', SERIE.chou]);
    base.recevoir('UPDATE campagne SET supprime_le = ? WHERE id = ?', ['2026-09-30T09:00:00.000Z', CAMPAGNE.fraise]);
    for (const id of [fait.id, RECOLTE_ANCIENNE]) {
      await attendre(() => texte(conteneur.querySelector(`[data-testid="saisie-historique"][data-evenement="${id}"]`)).includes(TEXTE_CULTURE_RETIREE), `${id} : « ${TEXTE_CULTURE_RETIREE} »`);
      const e = await entree(id);
      expect(aBouton(/^Annuler/, e), 'pas d’« Annuler »').toBe(false);
      expect(aBouton(/^Changer la date/, e), 'pas de « Changer la date »').toBe(false);
    }
  });
});

describe('T13, relecture B2 : emplacements supprimés ou inactifs jamais recopiés', () => {
  it('ni dans une nouvelle saisie, ni dans une correction, ni dans une annulation (liste vide acceptée)', async () => {
    const supprime = idTest(0xb1);
    const inactif = idTest(0xb2);
    const actif = idTest(0xb3);
    emplacement(supprime, 'T2-P09', { supprime_le: '2026-09-01T08:00:00.000Z' });
    emplacement(inactif, 'T2-P11', { actif_au: '2026-09-15' });
    emplacement(actif, 'T2-P13');
    for (const [n, e] of [supprime, inactif, actif].entries()) occupation(idTest(0xc1 + n), SERIE.chou, e);
    occupation(idTest(0xc9), SERIE.tomate, supprime);
    await rendre();

    // Nouvelle saisie : seuls les emplacements actifs.
    const fait = await faitSurChou();
    expect(emplacements(fait)).toEqual([EMPLACEMENT.t2p03, actif].sort());
    remiseAZero();
    await recolter(SERIE.tomate, '3');
    await attendre(() => nouveauxEvenements().length === 1, 'récolte écrite');
    const recolte = nouveauxEvenements()[0];
    expect(recolte === undefined ? [] : emplacements(recolte)).toEqual([EMPLACEMENT.t2p07]);

    // Correction : T2-P13 supprimé depuis, il n'est pas recopié.
    base.recevoir('UPDATE emplacement SET supprime_le = ? WHERE id = ?', ['2026-09-30T09:00:00.000Z', actif]);
    remiseAZero();
    await changerDate(fait.id, '2026-09-29');
    await attendre(() => nouveauxEvenements().length === 1, 'correction écrite');
    const correction = nouveauxEvenements()[0];
    if (correction === undefined) return;
    expect(correction).toMatchObject({ remplace_sorte: 'correction', remplace_evenement_id: fait.id });
    expect(emplacements(correction)).toEqual([EMPLACEMENT.t2p03]);
    verifierValide(correction);

    // Annulation : T2-P03 n'est plus actif ; plus aucun emplacement, la saisie reste possible.
    base.recevoir('UPDATE emplacement SET actif_au = ? WHERE id = ?', ['2026-09-20', EMPLACEMENT.t2p03]);
    remiseAZero();
    await toucher(bouton(/^Annuler/, await entree(correction.id)));
    await attendre(() => nouveauxEvenements().length === 1, 'annulation écrite');
    const annulation = nouveauxEvenements()[0];
    if (annulation === undefined) return;
    expect(annulation).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: correction.id });
    expect(emplacements(annulation)).toEqual([]);
    verifierValide(annulation);
  });
});

describe('T13, relecture B3 : le jour suit l’horloge du téléphone', () => {
  /** Horloge simulée (Date seule) à l'heure locale donnée. */
  function horloge(annee: number, mois: number, jour: number, heure: number, minute: number): void {
    vi.setSystemTime(new Date(annee, mois - 1, jour, heure, minute));
  }

  it('écran ouvert à 23 h 58, « Fait » à 0 h 02 : le réalisé porte la date du nouveau jour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    horloge(2026, 9, 30, 23, 58);
    await rendre(null);
    horloge(2026, 10, 1, 0, 2);
    const fait = await faitSurChou();
    expect(fait.date).toBe('2026-10-01');
  });

  it('retour au premier plan après minuit (lundi 5 octobre) : semainier de la nouvelle semaine, récolte datée du jour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    horloge(2026, 9, 30, 18, 0);
    await rendre(null);
    const poireau = cleTache(SERIE.poireau, 'plantation');
    expect(tache(poireau), 'semaine 40 : pas encore le poireau').toBeUndefined();
    expect(tache(cleTache(SERIE.batavia, 'plantation'))?.dataset.retard).toBe('non');

    horloge(2026, 10, 5, 6, 30);
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await attendre(() => tache(poireau) !== undefined, 'semaine 41 : la plantation du poireau apparaît');
    expect(tache(poireau)?.dataset.retard).toBe('non');
    expect(tache(cleTache(SERIE.batavia, 'plantation'))?.dataset.retard, 'la batavia du 30 septembre est en retard').toBe('oui');
    expect(texte(tache(cleTache(SERIE.batavia, 'plantation')))).toContain('5 jours de retard');

    remiseAZero();
    await recolter(SERIE.tomate, '2');
    await attendre(() => nouveauxEvenements().length === 1, 'récolte écrite');
    expect(nouveauxEvenements()[0]?.date).toBe('2026-10-05');
  });
});

describe('T13, relecture : double « Fait »', () => {
  it('la tâche quitte la liste (ou son bouton se désactive) dès le tap, avant toute relecture ; un second tap n’écrit rien', async () => {
    await rendre();
    const cle = cleTache(SERIE.chou, 'plantation');
    const b = bouton(/^Marquer fait/, tacheOuEchec(cle));
    let lever: () => void = () => undefined;
    verrou = new Promise<void>((r) => {
      lever = r;
    });
    await act(async () => {
      b.click();
      await Promise.resolve();
    });
    // L'écriture est bloquée : rien n'a pu être relu.
    expect(nouveauxEvenements()).toEqual([]);
    const encore = tache(cle);
    const boutonEncore = encore === undefined ? undefined : boutons(encore).find((x) => correspond(x, /^Marquer fait/));
    expect(encore === undefined || boutonEncore === undefined || desactive(boutonEncore), 'tâche retirée ou bouton désactivé dès le tap').toBe(true);
    if (boutonEncore !== undefined) {
      await act(async () => {
        boutonEncore.click();
        await Promise.resolve();
      });
    }
    lever();
    verrou = null;
    await attendre(() => nouveauxEvenements().length > 0, 'réalisé écrit');
    for (let k = 0; k < 10; k++) await unTour();
    expect(nouveauxEvenements(), 'un seul réalisé').toHaveLength(1);
    expect(transactions).toBe(1);
  });
});

describe('T13, relecture : récolte d’avant T13 sans mouvement', () => {
  it('changer sa date écrit la correction, sans article ni mouvement', async () => {
    recolteAncienne();
    await rendre();
    remiseAZero();
    await changerDate(RECOLTE_ANCIENNE, '2026-09-27');
    await attendre(() => nouveauxEvenements().length === 1, 'correction écrite');
    const correction = nouveauxEvenements()[0];
    if (correction === undefined) return;
    expect(correction).toMatchObject({ type: 'recolte', date: '2026-09-27', remplace_sorte: 'correction', remplace_evenement_id: RECOLTE_ANCIENNE, campagne_id: CAMPAGNE.fraise });
    verifierValide(correction);
    expect(nouveauxArticles(), 'aucun article créé').toEqual([]);
    expect(nouveauxMouvements(), 'aucun mouvement').toEqual([]);
  });
});

describe('T13, relecture : focus des dialogues', () => {
  it('« Récolte » : focus dedans, Tab en boucle, rendu au bouton d’origine à la fermeture', async () => {
    await rendre();
    const origine = bouton(/^Noter une récolte/);
    act(() => {
      origine.focus();
    });
    await toucher(origine);
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
    const d = dialogue('Récolte');
    if (d === undefined) return;
    await verifierPiege(d, 'Récolte');
    await toucher(bouton('Retour', d));
    await attendre(() => dialogue('Récolte') === undefined, 'la récolte se ferme');
    expect(document.activeElement, 'focus rendu à « Noter une récolte »').toBe(origine);
  });

  it('« Changer la date » : focus dedans, Tab en boucle, rendu au bouton de la saisie à la fermeture', async () => {
    await rendre();
    const fait = await faitSurChou();
    const origine = bouton(/^Changer la date/, await entree(fait.id));
    act(() => {
      origine.focus();
    });
    await toucher(origine);
    await attendre(() => dialogue('Changer la date') !== undefined, 'dialogue ouvert');
    const d = dialogue('Changer la date');
    if (d === undefined) return;
    await verifierPiege(d, 'Changer la date');
    await toucher(bouton('Retour', d));
    await attendre(() => dialogue('Changer la date') === undefined, 'dialogue fermé');
    expect(document.activeElement, 'focus rendu à « Changer la date »').toBe(origine);
  });
});

describe('T13, relecture : noms accessibles de l’historique', () => {
  it('« Annuler » et « Changer la date » nomment la saisie (« Annuler : Récolte 12 kg, Tomate »)', async () => {
    await rendre();
    const fait = await faitSurChou();
    remiseAZero();
    await recolter(SERIE.tomate, '12');
    await attendre(() => nouveauxEvenements().length === 1, 'récolte écrite');
    const recolte = nouveauxEvenements()[0];
    if (recolte === undefined) return;

    const r = await entree(recolte.id);
    for (const action of ['Annuler', 'Changer la date']) {
      const nom = nomAccessible(bouton(new RegExp(`^${action}`), r));
      expect(nom, `${action} de la récolte`).toMatch(new RegExp(`^${action} : `));
      expect(nom).toContain('12 kg');
      expect(nom).toMatch(/tomate/i);
    }
    const f = await entree(fait.id);
    for (const action of ['Annuler', 'Changer la date']) {
      const nom = nomAccessible(bouton(new RegExp(`^${action}`), f));
      expect(nom, `${action} du réalisé`).toMatch(new RegExp(`^${action} : `));
      expect(nom).toMatch(/chou pointu/i);
    }
    const h = await historique();
    const noms = boutons(h).map(nomAccessible).filter((n) => /^(Annuler|Changer la date)/.test(n));
    expect(new Set(noms).size, 'chaque bouton de l’historique a un nom distinct').toBe(noms.length);
  });
});
