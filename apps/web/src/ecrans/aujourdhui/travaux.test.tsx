// @vitest-environment happy-dom
/**
 * Tests d'acceptation T22 — écran « Aujourd'hui » : les travaux prévus des itinéraires deviennent
 * des tâches (catégorie en surtitre, libellé, temps estimé, retard), « Fait » écrit une
 * intervention en un geste (une transaction, validerSaisie), « Annuler » comme T13, et la charge
 * de la semaine s'affiche en pastille. Même harnais que ./ecran.test.tsx (T13), sur la ferme du
 * jour AVEC travaux (./test/ferme-du-jour.ts, `{ travaux: true }`, aujourd'hui = 2026-09-30).
 * Contrat : ./test/contrat.ts (section T22) et packages/core/src/planification/test/contrat-travaux.ts.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { DELAI_ANNULATION_MS, type ModuleEcranAujourdhui } from './test/contrat.ts';
import {
  cleTache,
  cleTravail,
  EMPLACEMENT,
  ecrireFermeDuJour,
  FERME,
  LIBELLES_CATEGORIES,
  SERIE,
  texteCharge,
  texteDuree,
  UTILISATEUR,
  type FermeDuJour,
} from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_ECRAN = './index.ts';

const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Base, porte, transactions ────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly ferme_id: string;
  readonly type: string;
  readonly date: string;
  readonly horodatage: string;
  readonly auteur_id: string;
  readonly source: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly note: string | null;
  readonly photos: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string;
}

interface LigneMouvement {
  readonly id: string;
  readonly ferme_id: string;
  readonly article_stock_id: string;
  readonly date: string;
  readonly quantite: number;
  readonly motif: string;
  readonly recolte_id: string | null;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let ferme: FermeDuJour;
/** Transactions d'écriture passées par la porte depuis le dernier `remiseAZero()`. */
let transactions = 0;
let evenementsAvant: Set<string>;
let mouvementsAvant: Set<string>;

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const mouvements = (): LigneMouvement[] => base.lireDirect<LigneMouvement>('SELECT * FROM mouvement_stock ORDER BY cree_le, id');
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));
const nouveauxMouvements = () => mouvements().filter((m) => !mouvementsAvant.has(m.id));

function remiseAZero(): void {
  transactions = 0;
  evenementsAvant = new Set(evenements().map((e) => e.id));
  mouvementsAvant = new Set(mouvements().map((m) => m.id));
}

/** Aucune ligne du journal ni du stock modifiée ou effacée (ajout seul). */
function verifierAjoutSeul(): void {
  const interdites = base.ecritures.filter((sql) => /^\s*(UPDATE|DELETE|REPLACE|INSERT\s+OR\s+REPLACE)\b/i.test(sql) && /\b(evenement|mouvement_stock)\b/i.test(sql));
  expect(interdites, 'jamais d’UPDATE, DELETE ni REPLACE sur evenement ou mouvement_stock').toEqual([]);
}

/** La ligne telle que la porte l'a écrite est acceptée par les règles du serveur (@planif/core). */
function verifierValide(e: LigneEvenement): void {
  const r = validerSaisie({ ...e });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse ${e.id} : ${r.erreur.message}`).toBe(true);
}

const detail = (e: LigneEvenement): unknown => JSON.parse(e.detail);
const emplacements = (e: LigneEvenement): string[] => (JSON.parse(e.emplacement_ids) as string[]).map((x) => x.toLowerCase()).sort();

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
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

/** Un tour de boucle (lectures de la base mémoire, rendu). Avance l'horloge simulée de 0 ms si elle est active. */
async function unTour(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, tours = 200): Promise<void> {
  for (let k = 0; k < tours && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Nom accessible simplifié : aria-label, aria-labelledby, <label>, puis le texte. */
function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null) return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(' ').trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    const englobant = el.closest('label');
    return texte(lie ?? englobant);
  }
  return texte(el);
}

function boutons(dans: ParentNode = conteneur): HTMLElement[] {
  return [...dans.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], input[type="radio"]')];
}

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const trouves = boutons(dans).filter((b) => (typeof nom === 'string' ? nomAccessible(b) === nom : nom.test(nomAccessible(b))));
  expect(trouves.length, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeGreaterThan(0);
  const b = trouves[0];
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

const aBouton = (nom: string | RegExp, dans: ParentNode = conteneur): boolean =>
  boutons(dans).some((b) => (typeof nom === 'string' ? nomAccessible(b) === nom : nom.test(nomAccessible(b))));

/** Compte les gestes : chaque appui passe par ici. */
let gestes = 0;
async function toucher(b: HTMLElement): Promise<void> {
  gestes++;
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const dialogues = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');

function tacheOuEchec(cle: string): HTMLElement {
  const t = tache(cle);
  expect(t, `tâche ${cle} affichée (affichées : ${taches().map((x) => String(x.dataset.cle)).join(', ')})`).toBeDefined();
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t;
}

/** La région « Historique », ouverte par son bouton si elle n'est pas déjà à l'écran. */
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

// ── Tests T22 ────────────────────────────────────────────────────────────────────────────────

const GRELINETTE = cleTravail(SERIE.batavia, 0);
const COMPOST = cleTravail(SERIE.batavia, 1);
const DESHERBAGE = cleTravail(SERIE.tomate, 0);
const PALISSAGE = cleTravail(SERIE.tomate, 1);

const pastille = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="charge-semaine"]');

describe('T22 : les travaux prévus dans Aujourd’hui', () => {
  it('mêlés aux étapes, dans l’ordre du semainier, en retard d’abord, avec leur retard', async () => {
    await rendre();
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches);
    for (const t of taches()) {
      const cle = t.dataset.cle ?? '';
      const retard = ferme.attendu.retards[cle];
      expect(t.dataset.retard, cle).toBe(retard === undefined ? 'non' : 'oui');
      if (retard !== undefined) expect(texte(t), cle).toContain(`${String(retard)} jours de retard`);
    }
  });

  it('une tâche de travail : catégorie en surtitre, libellé, culture, planche, temps estimé, « Marquer fait »', async () => {
    await rendre();
    const g = tacheOuEchec(GRELINETTE);
    expect(texte(g.querySelector('[data-testid="surtitre"]'))).toBe(LIBELLES_CATEGORIES.travail_sol);
    expect(texte(g)).toMatch(/grelinette/i);
    expect(texte(g)).toMatch(/batavia/i);
    expect(texte(g)).toContain('T2-P01');
    expect(texte(g.querySelector('[data-testid="temps-estime"]'))).toBe('6 min');
    expect(texte(g)).toContain('12 jours de retard');
    expect(aBouton(/^Marquer fait/, g)).toBe(true);

    const c = tacheOuEchec(COMPOST);
    expect(texte(c.querySelector('[data-testid="surtitre"]'))).toBe(LIBELLES_CATEGORIES.amendement);
    expect(texte(c)).toMatch(/compost/i);
    expect(texte(c.querySelector('[data-testid="temps-estime"]'))).toBe('30 min');

    const d = tacheOuEchec(DESHERBAGE);
    expect(texte(d.querySelector('[data-testid="surtitre"]'))).toBe(LIBELLES_CATEGORIES.entretien);
    expect(texte(d)).toMatch(/désherbage/i);
    expect(texte(d)).toMatch(/tomate/i);
    expect(texte(d)).toContain('T2-P07');
    expect(texte(d)).toContain('6 jours de retard');

    const p = tacheOuEchec(PALISSAGE);
    expect(p.dataset.retard).toBe('non');
    expect(texte(p.querySelector('[data-testid="temps-estime"]'))).toBe(texteDuree(3));

    for (const [cle, minutes] of Object.entries(ferme.attendu.tempsEstimes)) {
      const el = tacheOuEchec(cle).querySelector('[data-testid="temps-estime"]');
      if (minutes === null) expect(el, cle).toBeNull();
      else expect(texte(el), cle).toBe(texteDuree(minutes));
    }
    // Les étapes n'ont pas de temps estimé.
    expect(tacheOuEchec(cleTache(SERIE.chou, 'plantation')).querySelector('[data-testid="temps-estime"]')).toBeNull();
  });

  it('pastille de charge de la semaine : 6 + 30 + 45 + 3 = 84 min, « 1 h 24 de travail »', async () => {
    await rendre();
    expect(ferme.attendu.chargeMinutes).toBe(84);
    expect(texte(pastille())).toBe('1 h 24 de travail');
    expect(texteCharge(84)).toBe('1 h 24 de travail');
  });

  it('format de la charge : minutes sous l’heure, « 6 h », minutes sur deux chiffres', () => {
    expect(texteCharge(45)).toBe('45 min de travail');
    expect(texteCharge(360)).toBe('6 h de travail');
    expect(texteCharge(65)).toBe('1 h 05 de travail');
    expect(texteDuree(6)).toBe('6 min');
  });
});

describe('T22 : « Fait » sur un travail prévu écrit une intervention', () => {
  it('grelinette : un geste, une transaction, intervention valide avec l’outil ; la tâche part, la charge baisse', async () => {
    await rendre();
    gestes = 0;
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(GRELINETTE)));
    await attendre(() => nouveauxEvenements().length > 0, 'une intervention écrite');

    expect(gestes).toBe(1);
    expect(dialogues(), 'aucun écran de confirmation').toEqual([]);
    const nouveaux = nouveauxEvenements();
    expect(nouveaux).toHaveLength(1);
    const e = nouveaux[0];
    if (e === undefined) return;
    expect(e).toMatchObject({
      ferme_id: FERME,
      type: 'intervention',
      date: AUJOURDHUI,
      auteur_id: UTILISATEUR,
      source: 'tap',
      serie_id: SERIE.batavia,
      campagne_id: null,
      remplace_sorte: null,
      remplace_evenement_id: null,
    });
    expect(detail(e)).toStrictEqual({ categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette' });
    expect(emplacements(e)).toEqual([EMPLACEMENT.t2p01]);
    verifierValide(e);
    expect(transactions, 'une saisie = une transaction').toBe(1);
    expect(nouveauxMouvements()).toEqual([]);

    await attendre(() => tache(GRELINETTE) === undefined, 'la grelinette faite quitte la liste');
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches.filter((c) => c !== GRELINETTE));
    await attendre(() => texte(pastille()) === '1 h 18 de travail', 'charge recalculée : 84 − 6 = 78 min');
    const b = bandeau();
    expect(b?.getAttribute('role')).toBe('status');
    expect(texte(b)).toMatch(/grelinette/i);
    expect(texte(b)).toMatch(/batavia/i);
    expect(aBouton('Annuler', b ?? conteneur)).toBe(true);
    verifierAjoutSeul();
  });

  it('compost (amendement) : le produit et sa quantité passent dans le détail', async () => {
    await rendre();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(COMPOST)));
    await attendre(() => nouveauxEvenements().length > 0, 'une intervention écrite');
    const e = nouveauxEvenements()[0];
    if (e === undefined) return;
    expect(detail(e)).toStrictEqual({
      categorie: 'amendement',
      type: 'compost',
      outil: null,
      produit: 'compost',
      quantite: { valeur: 3, unite: 'kg/m²' },
    });
    verifierValide(e);
    await attendre(() => tache(COMPOST) === undefined, 'le compost fait quitte la liste');
  });

  it('désherbage répété : l’intervention du jour solde l’occurrence en retard ; sans outil, outil null', async () => {
    await rendre();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(DESHERBAGE)));
    await attendre(() => nouveauxEvenements().length > 0, 'une intervention écrite');
    const e = nouveauxEvenements()[0];
    if (e === undefined) return;
    expect(e.serie_id).toBe(SERIE.tomate);
    expect(detail(e)).toStrictEqual({ categorie: 'entretien', type: 'désherbage', outil: null });
    expect(emplacements(e)).toEqual([EMPLACEMENT.t2p07]);
    verifierValide(e);
    await attendre(() => tache(DESHERBAGE) === undefined, 'le désherbage quitte la liste (la prochaine occurrence est la semaine prochaine)');
    expect(tache(PALISSAGE), 'le palissage, autre travail de la même série, reste').toBeDefined();
    await attendre(() => texte(pastille()) === '39 min de travail', 'charge : 84 − 45 = 39 min');
  });

  it('plantation de la batavia marquée faite : grelinette et compost d’avant deviennent caducs (décision du chef, Q23)', async () => {
    await rendre();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(cleTache(SERIE.batavia, 'plantation'))));
    await attendre(() => nouveauxEvenements().length > 0, 'réalisé écrit');
    expect(nouveauxEvenements()[0]?.type).toBe('realise');
    await attendre(() => tache(GRELINETTE) === undefined && tache(COMPOST) === undefined, 'les travaux d’avant la plantation disparaissent');
    expect(tache(DESHERBAGE)).toBeDefined();
    await attendre(() => texte(pastille()) === '48 min de travail', 'charge : 45 + 3 = 48 min');
  });
});

describe('T22 : « Annuler » une intervention (10 s, puis l’historique), en ajout seul', () => {
  it('bandeau : annulation du même type et du même détail ; la tâche revient', async () => {
    await rendre();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(GRELINETTE)));
    await attendre(() => nouveauxEvenements().length === 1 && bandeau() !== null, 'intervention écrite, bandeau affiché');
    const fait = nouveauxEvenements()[0];
    if (fait === undefined) return;
    const copie = { ...fait };

    remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => nouveauxEvenements().length === 1, 'annulation écrite');
    const annulation = nouveauxEvenements()[0];
    if (annulation === undefined) return;
    expect(annulation).toMatchObject({
      ferme_id: FERME,
      type: 'intervention',
      serie_id: SERIE.batavia,
      remplace_sorte: 'annulation',
      remplace_evenement_id: fait.id,
    });
    expect(detail(annulation)).toStrictEqual(detail(fait));
    verifierValide(annulation);
    expect(transactions).toBe(1);
    expect(evenements().find((x) => x.id === fait.id), 'l’intervention d’origine est intacte').toEqual(copie);
    verifierAjoutSeul();

    await attendre(() => tache(GRELINETTE) !== undefined, 'la grelinette redevient à faire');
    expect(tache(GRELINETTE)?.dataset.retard).toBe('oui');
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches);
    await attendre(() => texte(pastille()) === '1 h 24 de travail', 'la charge revient');
  });

  it('après 10 s le bandeau disparaît ; l’historique montre l’intervention et permet de l’annuler', async () => {
    await rendre();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(DESHERBAGE)));
    await attendre(() => bandeau() !== null && nouveauxEvenements().length === 1, 'bandeau affiché après la saisie');
    const fait = nouveauxEvenements()[0];
    if (fait === undefined) return;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAI_ANNULATION_MS - 200);
    });
    expect(bandeau(), 'encore là à 9,8 s').not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await unTour();
    expect(bandeau(), 'disparu après 10 s').toBeNull();

    remiseAZero();
    const h = await historique();
    await attendre(() => entrees(h).some((x) => x.dataset.evenement === fait.id), 'l’intervention est dans l’historique');
    const entree = entrees(h).find((x) => x.dataset.evenement === fait.id);
    expect(entree?.dataset.type).toBe('intervention');
    expect(texte(entree)).toMatch(/désherbage/i);
    expect(texte(entree)).toMatch(/tomate/i);
    await toucher(bouton(/^Annuler/, entree));
    await attendre(() => nouveauxEvenements().length === 1, 'annulation écrite');
    const annulation = nouveauxEvenements()[0];
    if (annulation === undefined) return;
    expect(annulation).toMatchObject({ type: 'intervention', serie_id: SERIE.tomate, remplace_sorte: 'annulation', remplace_evenement_id: fait.id });
    verifierValide(annulation);
    expect(transactions).toBe(1);
    await attendre(() => tache(DESHERBAGE) !== undefined, 'le désherbage annulé redevient à faire');
    verifierAjoutSeul();
  });
});

describe('T22 : ferme sans travaux prévus', () => {
  it('pas de pastille de charge quand aucune tâche n’a de temps estimé', async () => {
    base.fermer();
    base = creerBaseMemoire(SCHEMA_LOCAL);
    ferme = await ecrireFermeDuJour(base, AUJOURDHUI);
    porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    await rendre();
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches);
    expect(pastille()).toBeNull();
  });
});
