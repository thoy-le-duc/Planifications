// @vitest-environment happy-dom
/**
 * Tests d'acceptation T87 — le plan est verrouillé (docs/backlog/T87-plan-verrouille.md) : l'éditeur
 * s'ouvre verrouillé pour tout le monde, le gérant déverrouille par « Modifier le plan » (testid
 * `deverrouiller-plan`), « Terminer » (`verrouiller-plan`) reverrouille. En modification, souris comme
 * doigt : un glisser ne déplace qu'un élément déjà choisi, sinon il fait défiler la carte.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, dialogues, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { ecrireFermePlacement, FERME, SERRE, UTILISATEUR, type OptionsFermePlacement } from './test/ferme-placement.ts';
import { DEVERROUILLER_PLAN, VERROUILLER_PLAN } from './test/deverrouiller.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
let placements: (readonly ChangementPlacement[])[] = [];
let fermetures = 0;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  placements = [];
  fermetures = 0;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch interdit'))));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base?.fermer();
  base = null;
});

async function monter(proprietes: ProprietesEditeurPlacement): Promise<void> {
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
  if (proprietes.fermeId === FERME) await attendre(() => batiment(SERRE) !== null || editeur()?.getAttribute('data-origine') === '', 'bâtiments affichés');
}

async function ouvrir(options: OptionsFermePlacement & { readonly ordinateur?: boolean } = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, options);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const porte: PorteDonnees = {
    ...reelle,
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  await monter({
    porte,
    fermeId: FERME,
    utilisateurId: UTILISATEUR,
    surFermer: () => {
      fermetures++;
    },
    ordinateur: options.ordinateur ?? true,
    enLigne: true,
    delaiAnnulationMs: 60_000,
  });
}

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const editeur = (): HTMLElement | null => un(T.editeur);
const batiment = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${id}"]`);
function serre(): HTMLElement {
  const s = batiment(SERRE);
  if (s === null) throw new Error('serre absente');
  return s;
}
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const centre = (): string | null => editeur()?.getAttribute('data-centre') ?? null;
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...(editeur()?.querySelectorAll<HTMLElement>('button, [role="button"]') ?? [])].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const confirmation = (): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur);

async function pointeur(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, pointerType = 'mouse'): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function glisser(el: Element, x0: number, y0: number, x1: number, y1: number, pointerType = 'mouse'): Promise<void> {
  await pointeur(el, 'pointerdown', x0, y0, pointerType);
  await pointeur(el, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2, pointerType);
  await pointeur(el, 'pointermove', x1, y1, pointerType);
  await pointeur(el, 'pointerup', x1, y1, pointerType);
}

async function taper(el: Element, pointerType = 'mouse'): Promise<void> {
  await pointeur(el, 'pointerdown', 300, 300, pointerType);
  await pointeur(el, 'pointerup', 300, 300, pointerType);
}

async function deverrouillerPlan(): Promise<void> {
  const b = un(DEVERROUILLER_PLAN);
  expect(b, 'bouton « Modifier le plan » (deverrouiller-plan)').not.toBeNull();
  if (b !== null) await toucher(b);
}

describe('T87 : le plan s’ouvre verrouillé', () => {
  it('gérant : aucun bouton de modification, glisser sur un bâtiment ne change rien, un tap ouvre sa fiche en lecture', async () => {
    await ouvrir({ origine: true });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(boutonsNommes(/^(Enregistrer|Nouveau bâtiment|Terminer|Abandonner|Tracer)/), 'aucun bouton qui modifie').toEqual([]);
    expect(un(DEVERROUILLER_PLAN)?.textContent.trim()).toBe('Modifier le plan');
    expect(un(VERROUILLER_PLAN)).toBeNull();

    const x0 = nombre(serre(), 'data-x');
    await glisser(serre(), 300, 300, 400, 300);
    expect(nombre(serre(), 'data-x'), 'la serre n’a pas bougé').toBe(x0);
    expect(placements).toEqual([]);
    expect(boutonsNommes(/^(Enregistrer|Abandonner)/), 'aucun brouillon').toEqual([]);

    await taper(serre());
    expect(serre().getAttribute('aria-pressed')).toBe('true');
    const fiche = un(T.panneau);
    expect(fiche?.textContent).toContain('Serre M1');
    expect(texte(fiche)).toContain('Zone abritée');
    for (const c of fiche?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? []) {
      expect(c.disabled || (c instanceof HTMLInputElement && c.readOnly), `champ ${c.outerHTML} en lecture`).toBe(true);
    }
    expect([...document.querySelectorAll(`[data-testid="${T.poigneeRotation}"], [data-testid="${T.poigneeCote}"]`)]).toEqual([]);
  });

  it('verrouillé, glisser sur un bâtiment fait défiler la carte', async () => {
    await ouvrir({ origine: true });
    const c0 = centre();
    await glisser(serre(), 300, 300, 400, 300);
    expect(centre(), 'la carte a défilé').not.toBe(c0);
  });

  it('équipier : pas de « Modifier le plan »', async () => {
    await ouvrir({ origine: true, role: 'equipier' });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(un(DEVERROUILLER_PLAN)).toBeNull();
    expect(boutonsNommes(/Modifier le plan/)).toEqual([]);
  });

  it('téléphone, gérant : « Modifier le plan » est dans la barre du bas', async () => {
    await ouvrir({ origine: true, ordinateur: false });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(un('barre-doigt')?.contains(un(DEVERROUILLER_PLAN)), 'bouton dans la barre du bas (barre-doigt)').toBe(true);
  });

  it('fermer puis rouvrir : de nouveau verrouillé', async () => {
    await ouvrir({ origine: true });
    await deverrouillerPlan();
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    await act(async () => {
      racine.render(null);
      await Promise.resolve();
    });
    expect(editeur()).toBeNull();
    if (base === null) throw new Error('base absente');
    const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
    await monter({ porte: reelle, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(un(DEVERROUILLER_PLAN)).not.toBeNull();
  });
});

describe('T87 : « Modifier le plan »', () => {
  it('bandeau « Modification du plan », le bouton devient « Terminer »', async () => {
    await ouvrir({ origine: true });
    await deverrouillerPlan();
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    expect(texte(editeur())).toContain('Modification du plan');
    expect(un(DEVERROUILLER_PLAN)).toBeNull();
    expect(un(VERROUILLER_PLAN)?.textContent.trim()).toBe('Terminer');
    expect(boutonsNommes(/^Nouveau bâtiment/)).toHaveLength(1);
  });

  it('glisser sur un bâtiment non choisi fait défiler la carte ; le choisir puis glisser le déplace (souris)', async () => {
    await ouvrir({ origine: true });
    await deverrouillerPlan();
    const x0 = nombre(serre(), 'data-x');
    const c0 = centre();
    await glisser(serre(), 300, 300, 400, 300);
    expect(nombre(serre(), 'data-x'), 'non choisie : elle ne bouge pas').toBe(x0);
    expect(centre(), 'la carte défile').not.toBe(c0);
    expect(boutonsNommes(/^Abandonner/), 'aucun brouillon').toEqual([]);

    await taper(serre());
    expect(serre().getAttribute('aria-pressed')).toBe('true');
    await glisser(serre(), 300, 300, 400, 300);
    expect(nombre(serre(), 'data-x'), 'choisie : elle se déplace').toBeGreaterThan(x0 + 10);
    expect(boutonsNommes(/^Abandonner/)).toHaveLength(1);
  });

  it('« Terminer » sans changement reverrouille aussitôt', async () => {
    await ouvrir({ origine: true });
    await deverrouillerPlan();
    await toucher(bouton('Terminer'));
    expect(confirmation()).toBeUndefined();
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(un(DEVERROUILLER_PLAN)).not.toBeNull();
  });

  async function deplacerLaSerre(): Promise<number> {
    await deverrouillerPlan();
    await taper(serre());
    await glisser(serre(), 300, 300, 400, 300);
    return nombre(serre(), 'data-x');
  }

  it('changement en cours puis « Terminer » : « Enregistrer » écrit, reverrouille, et « Annuler l’enregistrement » reste proposé', async () => {
    await ouvrir({ origine: true });
    const x1 = await deplacerLaSerre();
    await toucher(bouton('Terminer'));
    const choix = confirmation();
    expect(choix, 'choix Enregistrer / Abandonner').toBeDefined();
    expect(choix?.getAttribute('role')).toBe('alertdialog');
    expect(bouton('Abandonner les changements', choix)).toBeDefined();
    await toucher(bouton('Enregistrer', choix));
    await attendre(() => placements.length === 1, 'un appel à porte.placer');
    await attendre(() => editeur()?.getAttribute('data-mode') === 'lecture', 'reverrouillé');
    expect(confirmation()).toBeUndefined();
    expect(Math.abs(nombre(serre(), 'data-x') - x1)).toBeLessThan(0.01);
    const annuler = un(T.annuler);
    expect(annuler, '« Annuler l’enregistrement » reste proposé').not.toBeNull();
    await toucher(annuler as HTMLElement);
    await attendre(() => placements.length === 2, 'annulation écrite');
    await attendre(() => Math.abs(nombre(serre(), 'data-x') - 40) < 0.01, 'serre revenue');
  });

  it('changement en cours puis « Terminer » : « Abandonner les changements » rend l’état, rien n’est écrit, reverrouille', async () => {
    await ouvrir({ origine: true });
    await deplacerLaSerre();
    await toucher(bouton('Terminer'));
    const choix = confirmation();
    expect(choix).toBeDefined();
    await toucher(bouton('Abandonner les changements', choix));
    expect(placements).toEqual([]);
    expect(nombre(serre(), 'data-x')).toBeCloseTo(40, 2);
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(confirmation()).toBeUndefined();
  });

  it('changement en cours puis « Terminer » : on peut continuer la modification', async () => {
    await ouvrir({ origine: true });
    await deplacerLaSerre();
    await toucher(bouton('Terminer'));
    const choix = confirmation();
    await toucher(bouton(/^Continuer/, choix));
    expect(confirmation()).toBeUndefined();
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    expect(placements).toEqual([]);
  });
});

describe('T87 : le parcours guidé déverrouille de lui-même', () => {
  it('ferme neuve (point de départ à poser) : déjà en modification, sans chercher le bouton', async () => {
    await ouvrir({});
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    expect(un(DEVERROUILLER_PLAN)).toBeNull();
    expect(un(VERROUILLER_PLAN)).not.toBeNull();
  });

  it('quand le dernier bâtiment disparaît (étape « Ajouter une serre ou un bâtiment ») : passe en modification', async () => {
    await ouvrir({ origine: true });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    if (base === null) throw new Error('base absente');
    await base.execute('UPDATE batiment SET supprime_le = ? WHERE ferme_id = ?', ['2026-10-08T09:00:00.000Z', FERME]);
    await attendre(() => editeur()?.getAttribute('data-mode') === 'edition', 'passé en modification');
  });
});
