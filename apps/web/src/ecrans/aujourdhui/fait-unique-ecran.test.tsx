// @vitest-environment happy-dom
/**
 * Test d'acceptation T13h, à l'écran — « Fait » sur une tâche déjà faite ailleurs, que l'écran
 * ne sait pas encore (DOM simulé happy-dom, ferme du jour, base mémoire, aujourd'hui = 2026-09-30).
 *
 * Scénario : l'écran affiche la plantation du chou à faire. Un second onglet (une autre porte sur la
 * même base) note la plantation du chou ; les avis de changement vers l'écran sont retenus (comme
 * une relecture qui n'est pas encore passée), donc l'écran montre toujours la tâche. Le maraîcher
 * touche « Fait ».
 *
 * Attendu (T13h, règle 6) : l'écriture rend « déjà fait » (`DejaFait`, ./ecritures.ts) ; RIEN de
 * plus n'est écrit (un seul réalisé, celui de l'autre onglet) ; la tâche disparaît ; un message
 * court le dit (role="status", texte contenant « déjà », comme le message « Déjà notée » de
 * T13d) ; pas de message d'erreur (role="alert") ni de bouton « Annuler » pour une saisie qui
 * n'a pas eu lieu. Une fois les avis rendus, la tâche reste retirée.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { DateCalendaire, Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Base, porte aux avis retenus ─────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly serie_id: string | null;
  readonly remplace_sorte: string | null;
  readonly detail: string | null;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let autreOnglet: PorteDonnees;
/** Avis de changement retenus pendant le gel, rendus au dégel. */
let gele = false;
let retenus: (() => void)[] = [];

function degeler(): void {
  gele = false;
  const r = retenus;
  retenus = [];
  for (const f of r) f();
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  gele = false;
  retenus = [];
  const options = { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> };
  const vraie = creerPorte(base, options);
  autreOnglet = creerPorte(base, options);
  porte = {
    ...vraie,
    surveiller: (requete, rappel) =>
      vraie.surveiller(requete, (lignes) => {
        if (gele) retenus.push(() => { rappel(lignes); });
        else rappel(lignes);
      }),
  };
});

const realisesChou = (): LigneEvenement[] =>
  base
    .lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id')
    .filter((e) => e.type === 'realise' && e.remplace_sorte === null && e.serie_id === SERIE.chou && (JSON.parse(e.detail ?? '{}') as { etape?: string }).etape === 'plantation');

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

async function tours(n = 15): Promise<void> {
  for (let k = 0; k < n; k++) await unTour();
}

async function attendre(condition: () => boolean, message: string, n = 200): Promise<void> {
  for (let k = 0; k < n && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const nom = (el: Element): string => el.getAttribute('aria-label')?.trim() ?? texte(el);
const boutons = (dans: ParentNode = conteneur): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];
const statuts = (): string[] => [...conteneur.querySelectorAll('[role="status"]')].map(texte).filter((t) => t !== '');
const alertes = (): string[] => [...conteneur.querySelectorAll('[role="alert"]')].map(texte).filter((t) => t !== '');
const boutonsAnnuler = (): number => boutons().filter((b) => nom(b).startsWith("Annuler")).length;

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

const CHOU = cleTache(SERIE.chou, 'plantation');

describe('T13h, à l’écran : « Fait » sur une tâche déjà faite ailleurs', () => {
  it('rien n’est écrit, la tâche disparaît, un message court dit « déjà », sans erreur ni « Annuler »', async () => {
    await rendre();
    await tours();
    const carte = tache(CHOU);
    expect(carte, 'la plantation du chou est à faire').toBeDefined();
    if (carte === undefined) throw new Error('tâche absente');
    const bouton = boutons(carte).find((b) => nom(b).startsWith('Marquer fait'));
    if (bouton === undefined) throw new Error('bouton « Marquer fait » absent');

    // Le second onglet note la plantation ; l'écran n'en est pas encore prévenu.
    gele = true;
    await autreOnglet.saisirEvenement({
      type: 'realise',
      date: AUJOURDHUI as DateCalendaire,
      source: 'tap',
      culture: { sorte: 'serie', serieId: SERIE.chou as Id<'Serie'> },
      emplacementIds: [],
      note: null,
      photos: [],
      remplaceEvenement: null,
      detail: { etape: 'plantation', quantiteReelle: null },
    });
    expect(realisesChou(), 'banc : la plantation notée par l’autre onglet').toHaveLength(1);
    await tours();
    expect(tache(CHOU), 'banc : l’écran montre encore la tâche (avis retenus)').toBeDefined();
    const annulerAvant = boutonsAnnuler();

    await act(async () => {
      bouton.focus();
      bouton.click();
      await Promise.resolve();
    });
    await tours(30);

    expect(realisesChou(), 'rien de plus n’est écrit : un seul réalisé (celui de l’autre onglet)').toHaveLength(1);
    expect(tache(CHOU), 'la tâche disparaît').toBeUndefined();
    expect(
      statuts().some((m) => /déjà/i.test(m)),
      `un message court dit « déjà » (role="status" : ${statuts().join(' | ')})`,
    ).toBe(true);
    expect(alertes(), 'pas de message d’erreur').toEqual([]);
    expect(boutonsAnnuler(), 'pas de « Annuler » pour une saisie qui n’a pas eu lieu').toBe(annulerAvant);

    // Les avis passent : la journée relue voit le réalisé, la tâche reste retirée.
    degeler();
    await tours(30);
    expect(tache(CHOU)).toBeUndefined();
    expect(realisesChou()).toHaveLength(1);
  });
});
