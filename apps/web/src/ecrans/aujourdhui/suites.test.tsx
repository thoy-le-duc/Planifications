// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13c — suites de la relecture de l'écran « Aujourd'hui », dans un DOM
 * simulé (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts) lue et écrite par la porte
 * (base mémoire), aujourd'hui = 2026-09-30. Mêmes outils que relecture.test.tsx.
 *
 *   M1  Masque des tâches faites : « Fait » sur la plantation du chou, puis le réalisé est annulé
 *       depuis un autre téléphone (ligne reçue par la synchro). Dès la journée relue, la tâche
 *       revient ET « Fait » y marche de nouveau (un nouveau réalisé est écrit, la tâche quitte la
 *       liste). Avant T13c, le masque posé au premier « Fait » n'est jamais retiré : la tâche
 *       revient, mais « Fait » ne fait plus rien.
 *
 *   F2  Focus après « Changer la date » (historique) : à la fermeture, la saisie corrigée est
 *       remplacée par sa correction dans l'historique ; le focus va sur l'entrée corrigée (un
 *       élément de son entrée), jamais sur `body`. Si l'entrée n'est plus là (la chaîne est
 *       annulée depuis un autre téléphone juste après la correction), le focus va au titre de
 *       l'historique. Avant T13c, il est rendu au bouton de l'entrée d'origine, qui disparaît
 *       avec la relecture : le focus tombe sur `body`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

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
  readonly horodatage: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly [colonne: string]: unknown;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let evenementsAvant = new Set<string>();
/** Posé : juste après la prochaine transaction d'écriture, un autre téléphone annule ce qu'elle a écrit. */
let annulerApresEcriture = false;

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));

function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

let compteurRecus = 0;
const idRecu = () => `0192f0c1-13c0-7000-8000-0000000a${(++compteurRecus).toString(16).padStart(4, '0')}`;

/**
 * Annulation de `cible` saisie sur un autre téléphone et reçue par la synchro (prévient les
 * abonnés) : même ferme, même culture, même type ; origine de la chaîne portée par la ligne,
 * comme toute ligne venue du serveur.
 */
function annulationRecue(cible: LigneEvenement): void {
  const origine = typeof cible.origine_id === 'string' && cible.origine_id !== '' ? cible.origine_id : (cible.remplace_evenement_id ?? cible.id);
  const ligne: Record<string, unknown> = {
    ...cible,
    id: idRecu(),
    // Saisie après la cible, sur l'autre téléphone.
    horodatage: new Date(Date.parse(cible.horodatage) + 60_000).toISOString(),
    cree_le: new Date(Date.parse(cible.horodatage) + 61_000).toISOString(),
    remplace_sorte: 'annulation',
    remplace_evenement_id: cible.id,
    origine_id: origine,
  };
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`,
    c.map((k) => {
      const v = ligne[k];
      return v === undefined ? null : v;
    }),
  );
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  annulerApresEcriture = false;
  const avecAutreTelephone: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: async (fn) => {
      const avant = new Set(evenements().map((e) => e.id));
      const r = await base.writeTransaction(fn);
      if (annulerApresEcriture) {
        annulerApresEcriture = false;
        for (const e of evenements().filter((x) => !avant.has(x.id))) annulationRecue(e);
      }
      return r;
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(avecAutreTelephone, {
    utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
    fermeId: FERME as Id<'Ferme'>,
  });
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
  base.fermer();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
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

function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null)
    return par
      .split(/\s+/)
      .map((i) => texte(document.getElementById(i)))
      .join(' ')
      .trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    return texte(lie ?? el.closest('label'));
  }
  return texte(el);
}

const boutons = (dans: ParentNode = conteneur): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const b = boutons(dans).find((x) => (typeof nom === 'string' ? nomAccessible(x) === nom : nom.test(nomAccessible(x))));
  expect(b, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeDefined();
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const dialogue = (debutNom: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => nomAccessible(d).startsWith(debutNom));

function tacheOuEchec(cle: string): HTMLElement {
  const t = tache(cle);
  expect(
    t,
    `tâche ${cle} affichée (affichées : ${taches()
      .map((x) => String(x.dataset.cle))
      .join(', ')})`,
  ).toBeDefined();
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t;
}

const regionHistorique = (): HTMLElement | undefined =>
  [...conteneur.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');

/** Titre de l'historique : l'élément qui nomme la région (aria-labelledby), sinon la région. */
function titreHistorique(): HTMLElement | null {
  const r = regionHistorique();
  if (r === undefined) return null;
  const par = r.getAttribute('aria-labelledby');
  return (par === null ? null : document.getElementById(par.split(/\s+/)[0] ?? '')) ?? r;
}

const entreeHistorique = (evenementId: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="saisie-historique"][data-evenement="${evenementId}"]`);

async function entree(evenementId: string): Promise<HTMLElement> {
  await attendre(() => entreeHistorique(evenementId) !== null, `saisie ${evenementId} dans l’historique`);
  const e = entreeHistorique(evenementId);
  if (e === null) throw new Error('entrée absente');
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

/** Ouvre « Changer la date » sur la saisie `evenementId` (focus sur son bouton), enregistre `date`. */
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

const CHOU = cleTache(SERIE.chou, 'plantation');

async function faitSurChou(): Promise<LigneEvenement> {
  remiseAZero();
  await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
  await attendre(() => nouveauxEvenements().length === 1, 'réalisé écrit');
  const e = nouveauxEvenements()[0];
  if (e === undefined) throw new Error('réalisé absent');
  return e;
}

function decrireFocus(): string {
  const a = document.activeElement;
  if (a === null) return 'aucun';
  if (a === document.body) return 'body';
  return `<${a.tagName.toLowerCase()}> « ${nomAccessible(a).slice(0, 80)} »`;
}

// ── M1. Masque des tâches faites ─────────────────────────────────────────────────────────────

describe('T13c, masque des tâches faites : un réalisé annulé ailleurs fait revenir la tâche', () => {
  it('« Fait », puis annulation reçue d’un autre téléphone : la tâche revient dès la journée relue, et « Fait » y marche de nouveau', async () => {
    await rendre();
    const fait = await faitSurChou();
    expect(fait).toMatchObject({ type: 'realise', remplace_sorte: null });
    // La journée relue après la saisie : la saisie dans l'historique, la tâche soldée.
    await entree(fait.id);
    await attendre(() => tache(CHOU) === undefined, 'la plantation du chou quitte la liste');

    // Un autre téléphone annule le réalisé ; la synchro l'apporte, la journée est relue.
    annulationRecue(fait);
    await attendre(() => entreeHistorique(fait.id) === null, 'journée relue : le réalisé annulé quitte l’historique');
    await attendre(() => tache(CHOU) !== undefined, 'journée relue : la plantation du chou revient au semainier');

    // « Fait » de nouveau : un nouveau réalisé est écrit, la tâche quitte la liste.
    remiseAZero();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
    await attendre(() => nouveauxEvenements().length === 1, '« Fait » sur la tâche revenue écrit un nouveau réalisé');
    expect(nouveauxEvenements()[0]).toMatchObject({
      type: 'realise',
      remplace_sorte: null,
      serie_id: SERIE.chou,
    });
    await attendre(() => tache(CHOU) === undefined, 'la tâche quitte de nouveau la liste');
  });

  it('témoin : sans annulation, la tâche faite reste hors de la liste après relecture', async () => {
    await rendre();
    const fait = await faitSurChou();
    await entree(fait.id);
    for (let k = 0; k < 10; k++) await unTour();
    expect(tache(CHOU)).toBeUndefined();
  });
});

// ── F2. Focus après « Changer la date » ──────────────────────────────────────────────────────

describe('T13c, focus après « Changer la date »', () => {
  it('le focus est sur l’entrée corrigée (sa correction dans l’historique), jamais sur body', async () => {
    await rendre();
    const fait = await faitSurChou();
    remiseAZero();
    await changerDate(fait.id, '2026-09-29');
    await attendre(() => nouveauxEvenements().length === 1, 'correction écrite');
    const correction = nouveauxEvenements()[0];
    if (correction === undefined) return;
    expect(correction).toMatchObject({
      remplace_sorte: 'correction',
      remplace_evenement_id: fait.id,
    });
    // Journée relue : la correction remplace l'origine dans l'historique.
    const e = await entree(correction.id);
    await attendre(() => entreeHistorique(fait.id) === null, 'l’origine quitte l’historique');
    for (let k = 0; k < 5; k++) await unTour();
    expect(document.activeElement, `focus : ${decrireFocus()}`).not.toBe(document.body);
    expect(e.contains(document.activeElement), `focus dans l’entrée corrigée (focus : ${decrireFocus()})`).toBe(true);
  });

  it('entrée disparue (chaîne annulée ailleurs juste après la correction) : le focus va au titre de l’historique, jamais sur body', async () => {
    await rendre();
    const fait = await faitSurChou();
    await entree(fait.id);
    remiseAZero();
    annulerApresEcriture = true;
    await changerDate(fait.id, '2026-09-29');
    await attendre(() => nouveauxEvenements().length === 2, 'correction écrite, puis annulée par un autre téléphone');
    const correction = nouveauxEvenements().find((x) => x.remplace_sorte === 'correction');
    const annulation = nouveauxEvenements().find((x) => x.remplace_sorte === 'annulation');
    expect(correction).toMatchObject({
      remplace_sorte: 'correction',
      remplace_evenement_id: fait.id,
    });
    expect(annulation).toMatchObject({
      remplace_sorte: 'annulation',
      remplace_evenement_id: correction?.id,
    });
    await attendre(() => entreeHistorique(fait.id) === null && entreeHistorique(correction?.id ?? '') === null, 'journée relue : ni l’origine ni la correction dans l’historique');
    for (let k = 0; k < 5; k++) await unTour();
    expect(document.activeElement, `focus : ${decrireFocus()}`).not.toBe(document.body);
    const titre = titreHistorique();
    expect(titre, 'titre de l’historique présent').not.toBeNull();
    expect(document.activeElement === titre || document.activeElement === regionHistorique(), `focus sur le titre de l’historique (focus : ${decrireFocus()})`).toBe(true);
  });
});
