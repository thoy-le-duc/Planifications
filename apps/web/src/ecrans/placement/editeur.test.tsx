// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28b — l'éditeur de placement, rendu pour de vrai dans un DOM simulé
 * (happy-dom), sur une base mémoire et la vraie porte (T28s) : gérant seulement (Q31), point de
 * départ d'abord, rien n'est écrit pendant le geste, « Enregistrer » = un appel à porte.placer,
 * « Annuler » et Ctrl+Z, fond neutre hors ligne, clavier (docs/backlog/T28b-editeur-placement.md).
 * Contrat du DOM : ./test/contrat.ts. Le parcours dans un vrai navigateur, tuiles comprises :
 * e2e/placement.e2e.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, dialogues, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { CONTOUR_CHAMP, ecrireFermePlacement, FERME, HANGAR, PLANCHE, POSITION, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** m/px au zoom 19, à 44° N (voir tuiles.test.ts). */
const MPP_19 = 0.214782;

let m: ModuleEditeur;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

// ── Banc : base mémoire, vraie porte, écritures espionnées ───────────────────────────────────

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  /** Arguments de chaque appel à porte.placer. */
  readonly placements: (readonly ChangementPlacement[])[];
  /** Appels aux autres écritures de la porte (ecrire, ecrireEnsemble, saisirEvenement, archiverRefus). */
  readonly autresEcritures: string[];
}

async function creerBanc(options: OptionsFermePlacement = {}): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, options);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const autresEcritures: string[] = [];
  const interdit =
    (nom: string) =>
    (): Promise<never> => {
      autresEcritures.push(nom);
      return Promise.reject(new Error(`l’éditeur ne doit pas appeler porte.${nom}`));
    };
  const porte: PorteDonnees = {
    ...reelle,
    ecrire: interdit('ecrire'),
    ecrireEnsemble: interdit('ecrireEnsemble'),
    saisirEvenement: interdit('saisirEvenement'),
    archiverRefus: interdit('archiverRefus'),
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  return { base, porte, placements, autresEcritures };
}

type Ligne = Readonly<Record<string, string | number | null>>;
const ligne = (b: Banc, table: string, id: string): Ligne | undefined => b.base.lireDirect<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];
const origineEnBase = (b: Banc): unknown => {
  const o = b.base.lireDirect<{ o: string | null }>('SELECT origine_plan AS o FROM ferme WHERE id = ?', [FERME])[0]?.o ?? null;
  return o === null ? null : (JSON.parse(o) as unknown);
};

// ── Rendu ────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;
let espionFetch: ReturnType<typeof vi.fn>;
let bancCourant: Banc | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
  // Les tuiles passent par des <img> (CSP : img-src) ; connect-src n'est pas ouvert à l'IGN.
  espionFetch = vi.fn(() => Promise.reject(new Error('fetch interdit dans l’éditeur')));
  vi.stubGlobal('fetch', espionFetch);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  bancCourant?.base.fermer();
  bancCourant = null;
});

async function ouvrir(options: OptionsFermePlacement & Partial<Pick<ProprietesEditeurPlacement, 'ordinateur' | 'enLigne' | 'delaiAnnulationMs' | 'nouvelId'>> = {}): Promise<Banc> {
  const b = await creerBanc(options);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = {
    porte: b.porte,
    fermeId: FERME,
    utilisateurId: UTILISATEUR,
    surFermer: () => {
      fermetures++;
    },
    ordinateur: options.ordinateur ?? true,
    enLigne: options.enLigne ?? true,
    ...(options.delaiAnnulationMs === undefined ? {} : { delaiAnnulationMs: options.delaiAnnulationMs }),
    ...(options.nouvelId === undefined ? {} : { nouvelId: options.nouvelId }),
  };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => editeur() !== null && (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
  if (options.origine === true) await attendre(() => batiment(SERRE) !== null && batiment(HANGAR) !== null, 'bâtiments affichés');
  return b;
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
function editeurOuEchec(): HTMLElement {
  const e = editeur();
  if (e === null) throw new Error('éditeur absent');
  return e;
}
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const batiment = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${id}"]`);
function batimentOuEchec(id: string): HTMLElement {
  const el = batiment(id);
  expect(el, `bâtiment ${id} affiché`).not.toBeNull();
  if (el === null) throw new Error('bâtiment absent');
  return el;
}
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const poignees = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.poigneeRotation}"], [data-testid="${T.poigneeCote}"]`)];
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const panneau = (): HTMLElement => {
  const p = un(T.panneau);
  if (p === null) throw new Error('panneau-placement absent');
  return p;
};
/** Confirmation ouverte (dialog / alertdialog autre que l'éditeur) dont le texte correspond. */
const confirmation = (motif: RegExp): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && motif.test(texte(d)));

async function selectionner(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus'));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function touche(el: Element, key: string, o: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...o }));
    await Promise.resolve();
  });
  await unTour();
}

async function pointeur(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true }));
    await Promise.resolve();
  });
  await unTour();
}

/** Un clic sur le plan, comme le navigateur : pointerdown, pointerup, click au même endroit. */
async function cliquerPlan(x = 0, y = 0): Promise<void> {
  const plan = un(T.plan);
  expect(plan, 'plan-placement affiché').not.toBeNull();
  if (plan === null) return;
  await pointeur(plan, 'pointerdown', x, y);
  await pointeur(plan, 'pointerup', x, y);
  await act(async () => {
    plan.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function confirmer(motif: RegExp): Promise<void> {
  await attendre(() => confirmation(motif) !== undefined, `confirmation ${String(motif)}`);
  const d = confirmation(motif);
  if (d === undefined) return;
  await toucher(bouton('Confirmer', d));
}

/** Le bouton « Annuler » qui suit un enregistrement (`annuler-placement`). */
async function annulerDernier(): Promise<void> {
  const a = un(T.annuler);
  expect(a, 'bouton annuler-placement').not.toBeNull();
  if (a === null) return;
  expect((a.getAttribute('aria-label') ?? texte(a)).trim()).toMatch(/^Annuler/);
  await toucher(a);
}

async function enregistrer(): Promise<void> {
  await toucher(bouton('Enregistrer'));
  await unTour();
}

// ── Gérant, sur ordinateur, en ligne ─────────────────────────────────────────────────────────

describe('T28b : gérant sur ordinateur, ferme placée', () => {
  it('éditeur en mode édition, photo IGN par tuiles WMTS, mention « © IGN », éléments à leur place', async () => {
    await ouvrir({ origine: true });
    const e = editeurOuEchec();
    expect(e.getAttribute('role')).toBe('dialog');
    expect((e.getAttribute('aria-label') ?? '') + texte(document.getElementById(e.getAttribute('aria-labelledby') ?? ''))).toMatch(/^Placement/);
    expect(e.getAttribute('data-mode')).toBe('edition');
    expect(e.getAttribute('data-fond')).toBe('photo');
    expect(e.getAttribute('data-zoom')).toBe('19');
    expect(e.getAttribute('data-origine')).toBe('44,1.5');
    const tuiles = tous(T.tuile);
    expect(tuiles.length, 'tuiles de la photo').toBeGreaterThan(0);
    for (const t of tuiles) {
      expect(t.tagName).toBe('IMG');
      const url = new URL(t.getAttribute('src') ?? '');
      expect(url.origin).toBe('https://data.geopf.fr');
      expect(url.searchParams.get('LAYER')).toBe('ORTHOIMAGERY.ORTHOPHOTOS');
      expect(url.searchParams.get('TILEMATRIXSET')).toBe('PM');
    }
    expect(texte(un(T.mentionIgn))).toContain('© IGN');
    expect(un(T.fondNeutre)).toBeNull();

    const serre = batimentOuEchec(SERRE);
    expect(nombre(serre, 'data-x')).toBeCloseTo(40, 2);
    expect(nombre(serre, 'data-y')).toBeCloseTo(40, 2);
    expect(nombre(serre, 'data-orientation')).toBeCloseTo(0, 2);
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(30, 2);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(8, 2);
    expect(document.querySelector(`[data-testid="${T.planche}"][data-id="${PLANCHE}"]`), 'planche placée affichée').not.toBeNull();
    expect(document.querySelector(`[data-testid="${T.zoneContour}"][data-id="${ZONE_CHAMP}"]`), 'contour de Plein champ affiché').not.toBeNull();
    expect(espionFetch).not.toHaveBeenCalled();
  });

  it('accessibilité clavier : chaque bâtiment est un bouton atteignable au clavier, nommé', async () => {
    await ouvrir({ origine: true });
    for (const [id, nom] of [
      [SERRE, 'Serre M1'],
      [HANGAR, 'Hangar'],
    ] as const) {
      const el = batimentOuEchec(id);
      expect(el.getAttribute('role')).toBe('button');
      expect(el.getAttribute('tabindex')).toBe('0');
      expect(el.getAttribute('aria-label') ?? texte(el)).toContain(nom);
    }
  });

  it('focus clavier = sélection : poignées de rotation et de côtés, panneau rempli', async () => {
    await ouvrir({ origine: true });
    expect(poignees()).toEqual([]);
    const serre = batimentOuEchec(SERRE);
    await selectionner(serre);
    expect(serre.getAttribute('aria-pressed')).toBe('true');
    expect(tous(T.poigneeRotation)).toHaveLength(1);
    expect(tous(T.poigneeCote).map((p) => p.getAttribute('data-cote')).sort()).toEqual(['arriere', 'avant', 'droite', 'gauche']);
    expect(Number(champ('x (m)', panneau()).value)).toBeCloseTo(40, 2);
    expect(Number(champ('y (m)', panneau()).value)).toBeCloseTo(40, 2);
    expect(Number(champ('Orientation (°)', panneau()).value)).toBeCloseTo(0, 2);
    expect(Number(champ('Longueur (m)', panneau()).value)).toBeCloseTo(30, 2);
    expect(Number(champ('Largeur (m)', panneau()).value)).toBeCloseTo(8, 2);
    expect(Number(champ('Hauteur (m)', panneau()).value)).toBeCloseTo(3.5, 2);
  });

  it('flèches et [ ] : rien n’est écrit pendant le geste ; « Enregistrer » = UN appel à porte.placer ; « Annuler » rend l’état exact', async () => {
    const b = await ouvrir({ origine: true });
    const serre = batimentOuEchec(SERRE);
    expect(desactive(bouton('Enregistrer')), 'Enregistrer sans brouillon').toBe(true);
    await selectionner(serre);
    for (let k = 0; k < 3; k++) await touche(serre, 'ArrowRight', { shiftKey: true });
    await touche(serre, 'ArrowUp');
    await touche(serre, ']');
    await touche(serre, ']');
    expect(nombre(batimentOuEchec(SERRE), 'data-x')).toBeCloseTo(43, 2);
    expect(nombre(batimentOuEchec(SERRE), 'data-y')).toBeCloseTo(40.1, 2);
    expect(nombre(batimentOuEchec(SERRE), 'data-orientation')).toBeCloseTo(2, 1);
    expect(Number(champ('x (m)', panneau()).value)).toBeCloseTo(43, 2);
    expect(b.placements, 'rien n’est écrit pendant le geste').toEqual([]);
    expect(ligne(b, 'batiment', SERRE)?.centre_x_m).toBe(40);

    expect(desactive(bouton('Enregistrer'))).toBe(false);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const [appel] = b.placements;
    expect(appel?.map((c) => c.sorte)).toEqual(['batiment']);
    expect(appel?.[0]?.sorte === 'batiment' ? appel[0].id : null).toBe(SERRE);
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_x_m !== 40, 'serre écrite');
    const ecrite = ligne(b, 'batiment', SERRE);
    expect(Number(ecrite?.centre_x_m)).toBeCloseTo(43, 2);
    expect(Number(ecrite?.centre_y_m)).toBeCloseTo(40.1, 2);
    expect(Number(ecrite?.orientation_deg)).toBeCloseTo(2, 1);
    expect(ecrite?.longueur_m).toBe(30);
    expect(ecrite?.nom).toBe('Serre M1');

    await attendre(() => un(T.annuler) !== null, 'bouton Annuler après l’enregistrement');
    await annulerDernier();
    await attendre(() => b.placements.length === 2, 'annulation par porte.placer');
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_x_m === 40, 'serre remise');
    const remise = ligne(b, 'batiment', SERRE);
    expect(remise?.centre_y_m).toBe(40);
    expect(remise?.orientation_deg).toBe(0);
    await attendre(() => nombre(batimentOuEchec(SERRE), 'data-x') === 40, 'affichage remis');
    expect(b.autresEcritures).toEqual([]);
  });

  it('glisser à la souris : rien n’est écrit pendant ni après le geste, jusqu’à « Enregistrer »', async () => {
    const b = await ouvrir({ origine: true });
    const serre = batimentOuEchec(SERRE);
    await pointeur(serre, 'pointerdown', 300, 300);
    await pointeur(serre, 'pointermove', 350, 300);
    await pointeur(serre, 'pointermove', 400, 300);
    expect(b.placements).toEqual([]);
    await pointeur(serre, 'pointerup', 400, 300);
    expect(b.placements).toEqual([]);
    // 100 px vers l'est au zoom 19 : 21,48 m.
    expect(Math.abs(nombre(batimentOuEchec(SERRE), 'data-x') - (40 + 100 * MPP_19))).toBeLessThan(0.05);
    expect(nombre(batimentOuEchec(SERRE), 'data-y')).toBeCloseTo(40, 2);
    expect(ligne(b, 'batiment', SERRE)?.centre_x_m).toBe(40);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    await attendre(() => Math.abs(Number(ligne(b, 'batiment', SERRE)?.centre_x_m) - (40 + 100 * MPP_19)) < 0.05, 'serre déplacée en base');
  });

  it('champs du panneau : orientation, longueur, hauteur écrites au tap sur « Enregistrer »', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batimentOuEchec(SERRE));
    await remplir(champ('Orientation (°)', panneau()), '90');
    await remplir(champ('Longueur (m)', panneau()), '35');
    await remplir(champ('Hauteur (m)', panneau()), '4');
    expect(nombre(batimentOuEchec(SERRE), 'data-orientation')).toBeCloseTo(90, 1);
    expect(nombre(batimentOuEchec(SERRE), 'data-longueur')).toBeCloseTo(35, 2);
    expect(b.placements).toEqual([]);
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', SERRE)?.orientation_deg === 90, 'orientation écrite');
    expect(ligne(b, 'batiment', SERRE)).toMatchObject({ longueur_m: 35, hauteur_m: 4, largeur_m: 8, centre_x_m: 40, centre_y_m: 40 });
    expect(b.placements).toHaveLength(1);
  });

  it('Ctrl+Z annule le dernier enregistrement de la session, puis le précédent ; Annuler disparaît après le délai', async () => {
    const b = await ouvrir({ origine: true, delaiAnnulationMs: 40 });
    const serre = batimentOuEchec(SERRE);
    await selectionner(serre);
    await touche(serre, 'ArrowRight', { shiftKey: true });
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_x_m === 41, 'premier enregistrement');
    await selectionner(batimentOuEchec(SERRE));
    await touche(batimentOuEchec(SERRE), 'ArrowUp', { shiftKey: true });
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_y_m === 41, 'second enregistrement');

    await new Promise((r) => setTimeout(r, 120));
    await unTour();
    expect(un(T.annuler), 'Annuler disparaît après delaiAnnulationMs').toBeNull();

    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_y_m === 40, 'Ctrl+Z : second annulé');
    expect(ligne(b, 'batiment', SERRE)?.centre_x_m).toBe(41);
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_x_m === 40, 'Ctrl+Z : premier annulé');
    const appels = b.placements.length;
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await unTour();
    expect(b.placements.length, 'plus rien à annuler : aucun appel').toBe(appels);
  });

  it('rejet de la porte (à plus de 5 km) : message, rien d’écrit, brouillon gardé', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batimentOuEchec(SERRE));
    await remplir(champ('x (m)', panneau()), '6000');
    await enregistrer();
    await attendre(() => [...document.querySelectorAll('[role="alert"]')].some((a) => texte(a).includes('5 km')), 'message de refus (5 km)');
    expect(ligne(b, 'batiment', SERRE)?.centre_x_m).toBe(40);
    expect(nombre(batimentOuEchec(SERRE), 'data-x')).toBeCloseTo(6000, 2);
  });

  it('créer un bâtiment : type, nom, dimensions, puis le poser ; enregistré ; « Annuler » le supprime (suppression douce)', async () => {
    const b = await ouvrir({ origine: true });
    await toucher(bouton('Nouveau bâtiment'));
    const formulaire = dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && ((d.getAttribute('aria-label') ?? '') + texte(d)).includes('Nouveau bâtiment'));
    expect(formulaire, 'formulaire « Nouveau bâtiment »').toBeDefined();
    if (formulaire === undefined) return;
    await remplir(liste('Type', formulaire), 'serre_tunnel');
    await remplir(champ('Nom', formulaire), 'Serre M3');
    await remplir(champ('Longueur (m)', formulaire), '40');
    await remplir(champ('Largeur (m)', formulaire), '8');
    await remplir(champ('Hauteur (m)', formulaire), '3.5');
    await toucher(bouton('Poser', formulaire));
    expect(b.placements).toEqual([]);
    await cliquerPlan(200, 200);
    const nouveaux = (): HTMLElement[] => tous(T.batiment).filter((el) => ![SERRE, HANGAR].includes(el.getAttribute('data-id') ?? ''));
    await attendre(() => nouveaux().length === 1, 'nouveau bâtiment posé');
    const nouveau = nouveaux()[0];
    if (nouveau === undefined) return;
    const id = nouveau.getAttribute('data-id') ?? '';
    expect(id).toMatch(MOTIF_UUID_V7);
    expect(nouveau.getAttribute('aria-pressed')).toBe('true');
    expect(nombre(nouveau, 'data-orientation')).toBeCloseTo(0, 2);
    expect(b.placements, 'poser n’écrit rien').toEqual([]);
    await remplir(champ('x (m)', panneau()), '50');
    await remplir(champ('y (m)', panneau()), '30');
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', id) !== undefined, 'bâtiment créé');
    expect(ligne(b, 'batiment', id)).toMatchObject({
      ferme_id: FERME,
      nom: 'Serre M3',
      type: 'serre_tunnel',
      longueur_m: 40,
      largeur_m: 8,
      hauteur_m: 3.5,
      centre_x_m: 50,
      centre_y_m: 30,
      orientation_deg: 0,
      zone_id: null,
      supprime_le: null,
    });
    expect(b.placements).toHaveLength(1);
    await attendre(() => un(T.annuler) !== null, 'Annuler');
    await annulerDernier();
    await attendre(() => ligne(b, 'batiment', id)?.supprime_le !== null, 'création annulée');
    await attendre(() => batiment(id) === null, 'bâtiment annulé retiré de la vue');
  });

  it('lier une serre à une zone qui a un contour : confirmation, contour effacé puis serre liée, en un appel ; annulable', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batimentOuEchec(SERRE));
    await remplir(liste('Zone abritée', panneau()), ZONE_CHAMP);
    await confirmer(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
    expect(b.placements).toEqual([]);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const appel = b.placements[0] ?? [];
    expect(appel.map((c) => c.sorte)).toEqual(['zone', 'batiment']);
    expect(appel[0]).toEqual({ sorte: 'zone', id: ZONE_CHAMP, contour: null });
    await attendre(() => ligne(b, 'batiment', SERRE)?.zone_id === ZONE_CHAMP, 'serre liée');
    expect(ligne(b, 'zone', ZONE_CHAMP)?.contour).toBeNull();

    await attendre(() => un(T.annuler) !== null, 'Annuler');
    await annulerDernier();
    await attendre(() => ligne(b, 'batiment', SERRE)?.zone_id === null, 'lien annulé');
    expect(JSON.parse(String(ligne(b, 'zone', ZONE_CHAMP)?.contour)) as unknown).toEqual(CONTOUR_CHAMP);
  });

  it('lier une serre à une zone sans contour : pas de confirmation', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batimentOuEchec(SERRE));
    await remplir(liste('Zone abritée', panneau()), ZONE_TUNNEL);
    expect(confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace))).toBeUndefined();
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', SERRE)?.zone_id === ZONE_TUNNEL, 'serre liée au tunnel');
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['batiment']);
  });

  it('« Fermer » appelle surFermer', async () => {
    await ouvrir({ origine: true });
    await toucher(bouton(/^(Fermer|Retour)/, editeurOuEchec()));
    expect(fermetures).toBe(1);
  });
});

// ── Point de départ d'abord (Q31) ────────────────────────────────────────────────────────────

describe('T28b : sans point de départ, on le pose d’abord', () => {
  it('message « point de départ », « Nouveau bâtiment » désactivé, rien d’écrit', async () => {
    const b = await ouvrir();
    const e = editeurOuEchec();
    expect(e.getAttribute('data-mode')).toBe('edition');
    expect(e.getAttribute('data-origine')).toBe('');
    const message = un(T.origineAbsente);
    expect(message).not.toBeNull();
    expect(message?.getAttribute('role')).toBe('status');
    expect(texte(message)).toMatch(/point de départ/i);
    expect(desactive(bouton('Nouveau bâtiment'))).toBe(true);
    expect(b.placements).toEqual([]);
  });

  it('« Utiliser la position de la ferme » : confirmation, puis origine = position météo, telle quelle', async () => {
    const b = await ouvrir();
    await toucher(bouton('Utiliser la position de la ferme'));
    expect(b.placements, 'rien avant la confirmation').toEqual([]);
    await confirmer(/point de départ/i);
    await attendre(() => b.placements.length === 1, 'origine écrite par porte.placer');
    expect(b.placements[0]).toEqual([{ sorte: 'origine', origine: { latitude: POSITION.latitude, longitude: POSITION.longitude } }]);
    expect(origineEnBase(b)).toEqual(POSITION);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '44,1.5', 'data-origine');
    await attendre(() => !desactive(bouton('Nouveau bâtiment')), 'Nouveau bâtiment possible');
    expect(un(T.origineAbsente)).toBeNull();
  });

  it('clic sur la photo : confirmation ; « Confirmer » pose l’origine au lieu cliqué ; refuser n’écrit rien', async () => {
    const b = await ouvrir();
    await cliquerPlan(10, 10);
    await attendre(() => confirmation(/point de départ/i) !== undefined, 'confirmation du point de départ');
    const d = confirmation(/point de départ/i);
    if (d === undefined) return;
    await toucher(bouton('Annuler', d));
    expect(confirmation(/point de départ/i)).toBeUndefined();
    expect(b.placements).toEqual([]);

    await cliquerPlan(10, 10);
    await confirmer(/point de départ/i);
    await attendre(() => b.placements.length === 1, 'origine écrite');
    const c = b.placements[0]?.[0];
    expect(c?.sorte).toBe('origine');
    const o = c?.sorte === 'origine' ? c.origine : null;
    expect(o).not.toBeNull();
    // Le lieu exact dépend de la mise en page (vérifié par l'e2e) : à moins de 1 km de la position.
    expect(Math.abs((o?.latitude ?? 0) - POSITION.latitude)).toBeLessThan(0.01);
    expect(Math.abs((o?.longitude ?? 0) - POSITION.longitude)).toBeLessThan(0.015);
  });
});

// ── Hors ligne ───────────────────────────────────────────────────────────────────────────────

describe('T28b : sans réseau, fond neutre et message ; l’éditeur marche', () => {
  it('fond neutre quadrillé, message, aucune tuile ; déplacer et enregistrer fonctionnent', async () => {
    const b = await ouvrir({ origine: true, enLigne: false });
    const e = editeurOuEchec();
    expect(e.getAttribute('data-fond')).toBe('neutre');
    expect(e.getAttribute('data-mode')).toBe('edition');
    expect(un(T.fondNeutre)).not.toBeNull();
    expect(texte(e)).toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(tous(T.tuile)).toEqual([]);
    const serre = batimentOuEchec(SERRE);
    await selectionner(serre);
    await touche(serre, 'ArrowLeft', { shiftKey: true });
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', SERRE)?.centre_x_m === 39, 'déplacement écrit hors ligne');
    expect(espionFetch).not.toHaveBeenCalled();
  });

  it('une tuile qui ne se charge pas, en ligne : elle seule est masquée, la photo reste (relecture du chef)', async () => {
    await ouvrir({ origine: true });
    const tuiles = tous(T.tuile);
    expect(tuiles.length).toBeGreaterThan(1);
    const [premiere] = tuiles;
    await act(async () => {
      premiere?.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    await unTour();
    expect(editeurOuEchec().getAttribute('data-fond')).toBe('photo');
    expect(un(T.fondNeutre)).toBeNull();
    expect(texte(editeurOuEchec())).not.toContain(MESSAGES_PLACEMENT.horsLigne);
  });
});

// ── Droits (Q31) et téléphone ────────────────────────────────────────────────────────────────

describe('T28b : seul le gérant modifie', () => {
  it('équipier : lecture seule, message, aucune poignée ni bouton d’écriture, les touches ne font rien', async () => {
    const b = await ouvrir({ origine: true, role: 'equipier' });
    const e = editeurOuEchec();
    expect(e.getAttribute('data-mode')).toBe('lecture');
    const statuts = [...document.querySelectorAll('[role="status"]')].map((s) => texte(s));
    expect(statuts.some((s) => s.includes(MESSAGES_PLACEMENT.seulGerant)), `message « ${MESSAGES_PLACEMENT.seulGerant} » (statuts : ${statuts.join(' | ')})`).toBe(true);

    const serre = batimentOuEchec(SERRE);
    await selectionner(serre);
    await pointeur(serre, 'pointerdown', 100, 100);
    await pointeur(serre, 'pointermove', 200, 100);
    await pointeur(serre, 'pointerup', 200, 100);
    await touche(serre, 'ArrowRight', { shiftKey: true });
    await touche(serre, ']');
    expect(poignees(), 'aucune poignée pour un équipier').toEqual([]);
    expect(boutonsNommes(/^(Enregistrer|Nouveau bâtiment|Utiliser la position)/), 'aucun bouton d’écriture').toEqual([]);
    expect(nombre(batimentOuEchec(SERRE), 'data-x')).toBeCloseTo(40, 2);
    expect(nombre(batimentOuEchec(SERRE), 'data-orientation')).toBeCloseTo(0, 2);
    const p = un(T.panneau);
    if (p !== null) {
      for (const c of p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
        expect(c.disabled || (c instanceof HTMLInputElement && c.readOnly), `champ ${c.outerHTML} modifiable`).toBe(true);
      }
    }
    await touche(e, 'z', { ctrlKey: true });
    expect(b.placements).toEqual([]);
  });

  it('équipier, ferme sans point de départ : un clic sur la photo n’ouvre rien', async () => {
    const b = await ouvrir({ role: 'equipier' });
    expect(editeurOuEchec().getAttribute('data-mode')).toBe('lecture');
    await cliquerPlan(10, 10);
    expect(confirmation(/point de départ/i)).toBeUndefined();
    expect(boutonsNommes(/^Utiliser la position/)).toEqual([]);
    expect(b.placements).toEqual([]);
  });

  it('équipier sur téléphone : lecture seule, « seul le gérant », sans poignée', async () => {
    const b = await ouvrir({ origine: true, ordinateur: false, role: 'equipier' });
    expect(editeurOuEchec().getAttribute('data-mode')).toBe('lecture');
    expect(texte(editeurOuEchec())).toContain(MESSAGES_PLACEMENT.seulGerant);
    const serre = batimentOuEchec(SERRE);
    await selectionner(serre);
    await touche(serre, 'ArrowRight');
    expect(poignees()).toEqual([]);
    expect(boutonsNommes(/^(Enregistrer|Nouveau bâtiment)/)).toEqual([]);
    expect(b.placements).toEqual([]);
  });
});

describe('T28b : constantes', () => {
  it('« Annuler » reste quelques secondes (entre 3 et 15 s)', () => {
    expect(m.DELAI_ANNULATION_MS).toBeGreaterThanOrEqual(3000);
    expect(m.DELAI_ANNULATION_MS).toBeLessThanOrEqual(15_000);
    expect(m.default).toBe(m.EditeurPlacement);
  });
});
