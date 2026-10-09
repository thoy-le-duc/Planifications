// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28e — suites de relecture de l'éditeur de placement (docs/backlog/T28e-editeur-suites.md) :
 * pose au clavier, zoom de départ, dimensions minimales, brouillon abandonné au changement de ferme,
 * texte de la confirmation d'abri, relance des tuiles en erreur (horloge simulée) ; plus deux points
 * de la relecture de T28d (focus après un tracé abandonné, copie locale de ECRITURES_MAX_PAR_LOT).
 * Contrat : ./test/contrat-suites.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, ECRITURES_MAX_PAR_LOT as ECRITURES_SYNC, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, dialogues, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { ECRITURES_MAX_PAR_LOT as ECRITURES_LOCAL } from './brouillon.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ModuleGestes, type ModuleTuiles, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { BOUTONS_CONTOURS as B } from './test/contrat-contours.ts';
import { BOUTON_POSER_AU_CENTRE, MESSAGES_SUITES, type ConstantesSuites } from './test/contrat-suites.ts';
import { ecrireFermePlacement, FERME, HANGAR, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const CHEMIN_TUILES = './tuiles.ts';
const CHEMIN_GESTES = './gestes.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
/** m/px au zoom 19, à 44° N (voir tuiles.test.ts). */
const MPP_19 = 0.214782;
const FERME_B = '0192f0c1-28b0-7000-8000-0000000000b2';

let m: ModuleEditeur;
let tuilesMod: ModuleTuiles & ConstantesSuites;
let gestes: ModuleGestes;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
  tuilesMod = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuiles & ConstantesSuites;
  gestes = (await import(/* @vite-ignore */ CHEMIN_GESTES)) as ModuleGestes;
});

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
}

function porteDe(base: BaseMemoire, fermeId: string): { readonly porte: PorteDonnees; readonly placements: (readonly ChangementPlacement[])[] } {
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  return {
    placements,
    porte: {
      ...reelle,
      placer: (changements) => {
        placements.push(structuredClone(changements));
        return reelle.placer(changements);
      },
    },
  };
}

async function creerBanc(options: OptionsFermePlacement = {}): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, options);
  return { base, ...porteDe(base, FERME) };
}

type Ligne = Readonly<Record<string, string | number | null>>;
const ligne = (b: Banc, table: string, id: string): Ligne | undefined => b.base.lireDirect<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];

// ── Rendu ────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;
let bancCourant: Banc | null = null;
let dernieresProprietes: ProprietesEditeurPlacement | null = null;
let observateur: MutationObserver | null = null;
/** Éléments <img> de tuile montés (ajoutés au DOM) depuis le début de l'observation, par src. */
let montages = new Map<string, number>();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch interdit dans l’éditeur'))));
});

afterEach(() => {
  observateur?.disconnect();
  observateur = null;
  if (vi.isFakeTimers()) vi.useRealTimers();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  bancCourant?.base.fermer();
  bancCourant = null;
  dernieresProprietes = null;
});

async function rendre(porte: PorteDonnees, fermeId: string, o: Partial<ProprietesEditeurPlacement> = {}): Promise<void> {
  const proprietes: ProprietesEditeurPlacement = {
    porte,
    fermeId,
    utilisateurId: UTILISATEUR,
    surFermer: () => undefined,
    ordinateur: true,
    enLigne: true,
    ...o,
  };
  dernieresProprietes = proprietes;
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
}

async function ouvrir(options: OptionsFermePlacement & Partial<Pick<ProprietesEditeurPlacement, 'enLigne' | 'ordinateur'>> = {}): Promise<Banc> {
  const b = await creerBanc(options);
  bancCourant = b;
  await rendre(b.porte, FERME, {
    ...(options.enLigne === undefined ? {} : { enLigne: options.enLigne }),
    ...(options.ordinateur === undefined ? {} : { ordinateur: options.ordinateur }),
  });
  if (options.origine === true) await attendre(() => batiment(SERRE) !== null, 'bâtiments affichés');
  return b;
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const batiment = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${id}"]`);
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const panneau = (): HTMLElement => {
  const p = un(T.panneau);
  if (p === null) throw new Error('panneau-placement absent');
  return p;
};
const confirmation = (motif: RegExp): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && motif.test(texte(d)));
const messages = (): string[] => [...document.querySelectorAll('[role="alert"], [role="status"]')].map((el) => texte(el));
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));

async function selectionner(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus'));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function touche(el: Element, key: string, o: { shiftKey?: boolean } = {}): Promise<void> {
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

function planOuEchec(): HTMLElement {
  const plan = un(T.plan);
  if (plan === null) throw new Error('plan-placement absent');
  return plan;
}

/** Un clic sur le plan, comme le navigateur : pointerdown, pointerup, click au même endroit. */
async function cliquerPlan(x = 0, y = 0): Promise<void> {
  const plan = planOuEchec();
  await pointeur(plan, 'pointerdown', x, y);
  await pointeur(plan, 'pointerup', x, y);
  await act(async () => {
    plan.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

/** Glisse le fond : la vue se déplace (le contenu suit le pointeur). */
async function glisserFond(de: { x: number; y: number }, vers: { x: number; y: number }): Promise<void> {
  const plan = planOuEchec();
  await pointeur(plan, 'pointerdown', de.x, de.y);
  await pointeur(plan, 'pointermove', (de.x + vers.x) / 2, (de.y + vers.y) / 2);
  await pointeur(plan, 'pointermove', vers.x, vers.y);
  await pointeur(plan, 'pointerup', vers.x, vers.y);
}

/** Quitte le champ (blur : React écoute focusout). */
async function sortir(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function enregistrer(): Promise<void> {
  await toucher(bouton('Enregistrer'));
  await unTour();
}

/** Ouvre le formulaire « Nouveau bâtiment », le remplit et touche « Poser » : le mode pose commence. */
async function commencerPose(nom = 'Serre M3'): Promise<void> {
  await toucher(bouton('Nouveau bâtiment'));
  const formulaire = dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && ((d.getAttribute('aria-label') ?? '') + texte(d)).includes('Nouveau bâtiment'));
  expect(formulaire, 'formulaire « Nouveau bâtiment »').toBeDefined();
  if (formulaire === undefined) return;
  await remplir(liste('Type', formulaire), 'serre_tunnel');
  await remplir(champ('Nom', formulaire), nom);
  await remplir(champ('Longueur (m)', formulaire), '40');
  await remplir(champ('Largeur (m)', formulaire), '8');
  await remplir(champ('Hauteur (m)', formulaire), '3.5');
  await toucher(bouton('Poser', formulaire));
}

const nouveauxBatiments = (): HTMLElement[] => tous(T.batiment).filter((el) => ![SERRE, HANGAR].includes(el.getAttribute('data-id') ?? ''));

// ── Pose au clavier et au bouton ─────────────────────────────────────────────────────────────

describe('T28e : poser au centre de la vue', () => {
  // Vue déplacée de (+100 px, +50 px) : le centre de la vue recule à l'ouest et monte au nord.
  const ATTENDU = { x: -100 * MPP_19, y: 50 * MPP_19 };

  async function verifierPose(b: Banc): Promise<void> {
    await attendre(() => nouveauxBatiments().length === 1, 'nouveau bâtiment posé');
    const nouveau = nouveauxBatiments()[0];
    if (nouveau === undefined) return;
    expect(nombre(nouveau, 'data-x')).toBeCloseTo(ATTENDU.x, 1);
    expect(nombre(nouveau, 'data-y')).toBeCloseTo(ATTENDU.y, 1);
    expect(nombre(nouveau, 'data-orientation')).toBeCloseTo(0, 2);
    expect(nombre(nouveau, 'data-longueur')).toBeCloseTo(40, 2);
    expect(nombre(nouveau, 'data-largeur')).toBeCloseTo(8, 2);
    expect(nouveau.getAttribute('aria-label') ?? texte(nouveau)).toContain('Serre M3');
    expect(nouveau.getAttribute('aria-pressed'), 'le bâtiment posé est sélectionné').toBe('true');
    expect(b.placements, 'poser n’écrit rien').toEqual([]);
    expect(boutonsNommes(new RegExp(`^${BOUTON_POSER_AU_CENTRE}`)), 'le mode pose est terminé').toEqual([]);
    expect(desactive(bouton('Enregistrer')), 'le bâtiment posé est au brouillon').toBe(false);
  }

  it('Entrée en mode pose ajoute le bâtiment au centre de la vue (vue déplacée comprise), sélectionné, sans rien écrire', async () => {
    const b = await ouvrir({ origine: true });
    await glisserFond({ x: 300, y: 300 }, { x: 400, y: 350 });
    await commencerPose();
    await touche(planOuEchec(), 'Enter');
    await verifierPose(b);
  });

  it('le bouton « Poser au centre de la vue » fait la même chose', async () => {
    const b = await ouvrir({ origine: true });
    await glisserFond({ x: 300, y: 300 }, { x: 400, y: 350 });
    await commencerPose();
    await toucher(bouton(BOUTON_POSER_AU_CENTRE));
    await verifierPose(b);
  });

  it('au centre de la vue sans l’avoir déplacée : le point (0, 0) du plan ; le bâtiment s’enregistre', async () => {
    const b = await ouvrir({ origine: true });
    await commencerPose();
    await toucher(bouton(BOUTON_POSER_AU_CENTRE));
    await attendre(() => nouveauxBatiments().length === 1, 'nouveau bâtiment posé');
    const nouveau = nouveauxBatiments()[0];
    if (nouveau === undefined) return;
    expect(nombre(nouveau, 'data-x')).toBeCloseTo(0, 1);
    expect(nombre(nouveau, 'data-y')).toBeCloseTo(0, 1);
    const id = nouveau.getAttribute('data-id') ?? '';
    await enregistrer();
    await attendre(() => ligne(b, 'batiment', id) !== undefined, 'bâtiment créé');
    expect(b.placements).toHaveLength(1);
    expect(ligne(b, 'batiment', id)).toMatchObject({ nom: 'Serre M3', longueur_m: 40, largeur_m: 8, zone_id: null });
  });

  it('le bouton n’existe qu’en mode pose ; Entrée hors du mode pose ne pose rien', async () => {
    const b = await ouvrir({ origine: true });
    expect(boutonsNommes(new RegExp(`^${BOUTON_POSER_AU_CENTRE}`))).toEqual([]);
    await touche(planOuEchec(), 'Enter');
    expect(nouveauxBatiments()).toEqual([]);
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    await commencerPose();
    expect(boutonsNommes(new RegExp(`^${BOUTON_POSER_AU_CENTRE}`))).toHaveLength(1);
    expect(b.placements).toEqual([]);
  });

  it('lecture seule (équipier sur téléphone) : ni bouton, ni pose par Entrée', async () => {
    await ouvrir({ origine: true, ordinateur: false, role: 'equipier' });
    expect(editeur()?.getAttribute('data-mode')).toBe('lecture');
    expect(boutonsNommes(new RegExp(`^${BOUTON_POSER_AU_CENTRE}`))).toEqual([]);
    await touche(planOuEchec(), 'Enter');
    expect(nouveauxBatiments()).toEqual([]);
  });
});

// ── Zoom de départ ───────────────────────────────────────────────────────────────────────────

describe('T28e : zoom de départ', () => {
  it('constante nommée : entière, au moins deux niveaux sous le zoom actuel, dans les bornes de l’éditeur', () => {
    const z = tuilesMod.ZOOM_DEPART_SANS_POSITION;
    expect(Number.isInteger(z)).toBe(true);
    expect(z).toBeLessThanOrEqual(tuilesMod.ZOOM_INITIAL - 2);
    // T28h (Q35) : le plus petit zoom de l'éditeur descend à 6 ; la vue de départ sans position y est.
    expect(z).toBeGreaterThanOrEqual(6);
  });

  it('sans origine ni position : data-zoom vaut la constante', async () => {
    await ouvrir({ sansPosition: true });
    expect(editeur()?.getAttribute('data-origine')).toBe('');
    expect(un(T.origineAbsente), 'message « point de départ »').not.toBeNull();
    expect(editeur()?.getAttribute('data-zoom')).toBe(String(tuilesMod.ZOOM_DEPART_SANS_POSITION));
    expect(Number(editeur()?.getAttribute('data-zoom'))).toBeLessThanOrEqual(17);
  });

  it('avec une position mais sans origine, ou avec une origine : zoom 19 comme avant', async () => {
    await ouvrir({});
    expect(un(T.origineAbsente)).not.toBeNull();
    expect(editeur()?.getAttribute('data-zoom')).toBe(String(tuilesMod.ZOOM_INITIAL));
    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    bancCourant?.base.fermer();
    await ouvrir({ origine: true });
    expect(editeur()?.getAttribute('data-zoom')).toBe(String(tuilesMod.ZOOM_INITIAL));
  });
});

// ── Longueur et largeur minimales ────────────────────────────────────────────────────────────

describe('T28e : longueur et largeur bornées à 0,5 m dans le panneau', () => {
  it('constante des gestes : 0,5 m ; un redimensionnement au-delà donne le même minimum', () => {
    expect(gestes.DIMENSION_MIN_M).toBe(0.5);
    const r = { centre: { x: 0, y: 0 }, orientationDeg: 0, longueurM: 10, largeurM: 4 };
    expect(gestes.redimensionner(r, 'avant', { x: 0, y: -50 }).longueurM).toBe(0.5);
    expect(gestes.redimensionner(r, 'droite', { x: -50, y: 0 }).largeurM).toBe(0.5);
  });

  it('une saisie de 0,2 m donne 0,5 m à la sortie du champ (affichage, champ, valeur écrite) ; la largeur de même ; 0 et négatif aussi', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    await remplir(champ('Longueur (m)', panneau()), '0.2');
    await sortir(champ('Longueur (m)', panneau()));
    await remplir(champ('Largeur (m)', panneau()), '0.2');
    await sortir(champ('Largeur (m)', panneau()));
    await attendre(() => nombre(batiment(SERRE) ?? document.body, 'data-longueur') === 0.5, 'longueur ramenée à 0,5');
    expect(nombre(batiment(SERRE) ?? document.body, 'data-largeur')).toBe(0.5);
    expect(Number(champ('Longueur (m)', panneau()).value)).toBe(0.5);
    expect(Number(champ('Largeur (m)', panneau()).value)).toBe(0.5);
    await remplir(champ('Longueur (m)', panneau()), '0');
    await sortir(champ('Longueur (m)', panneau()));
    expect(nombre(batiment(SERRE) ?? document.body, 'data-longueur')).toBe(0.5);
    await remplir(champ('Largeur (m)', panneau()), '-3');
    await sortir(champ('Largeur (m)', panneau()));
    expect(nombre(batiment(SERRE) ?? document.body, 'data-largeur')).toBe(0.5);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    await attendre(() => ligne(b, 'batiment', SERRE)?.longueur_m === 0.5, 'serre écrite');
    expect(ligne(b, 'batiment', SERRE)?.largeur_m).toBe(0.5);
  });

  it('frappe caractère par caractère : le texte reste libre, « 0.8 » donne 0,8', async () => {
    await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    const c = (): HTMLInputElement => champ('Longueur (m)', panneau());
    await remplir(c(), '');
    await remplir(c(), '0');
    expect(c().value, 'pendant la frappe, « 0 » reste « 0 »').toBe('0');
    await remplir(c(), '0.8');
    expect(c().value).toBe('0.8');
    expect(nombre(batiment(SERRE) ?? document.body, 'data-longueur')).toBeCloseTo(0.8, 3);
    await sortir(c());
    expect(Number(c().value)).toBeCloseTo(0.8, 3);
    expect(nombre(batiment(SERRE) ?? document.body, 'data-longueur')).toBeCloseTo(0.8, 3);
  });

  it('frappe de 0.2 : texte libre, puis 0,5 à la sortie du champ ou à Entrée', async () => {
    await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    const c = (): HTMLInputElement => champ('Largeur (m)', panneau());
    await remplir(c(), '0');
    await remplir(c(), '0.2');
    expect(c().value, 'pendant la frappe, le texte reste libre').toBe('0.2');
    await sortir(c());
    expect(Number(c().value)).toBe(0.5);
    expect(nombre(batiment(SERRE) ?? document.body, 'data-largeur')).toBe(0.5);

    await remplir(c(), '0.3');
    expect(c().value).toBe('0.3');
    await touche(c(), 'Enter');
    expect(Number(c().value), 'Entrée borne aussi').toBe(0.5);
    expect(nombre(batiment(SERRE) ?? document.body, 'data-largeur')).toBe(0.5);
  });

  it('« Enregistrer » sans quitter le champ : 0,2 saisi n’est jamais écrit, c’est 0,5 (longueur et largeur)', async () => {
    const b = await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    await remplir(champ('Longueur (m)', panneau()), '0.2');
    await remplir(champ('Largeur (m)', panneau()), '0.2');
    // Pas de blur : le champ garde le focus, comme un clic programmatique ou Ctrl+Entrée.
    expect(desactive(bouton('Enregistrer'))).toBe(false);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    await attendre(() => ligne(b, 'batiment', SERRE)?.longueur_m !== 30, 'serre écrite');
    expect(ligne(b, 'batiment', SERRE)?.longueur_m).toBe(0.5);
    expect(ligne(b, 'batiment', SERRE)?.largeur_m).toBe(0.5);
  });

  it('une saisie valable au-dessus du minimum reste telle quelle', async () => {
    await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    await remplir(champ('Longueur (m)', panneau()), '0.5');
    await remplir(champ('Largeur (m)', panneau()), '12.5');
    expect(nombre(batiment(SERRE) ?? document.body, 'data-longueur')).toBe(0.5);
    expect(nombre(batiment(SERRE) ?? document.body, 'data-largeur')).toBe(12.5);
  });
});

// ── Brouillon abandonné au changement de ferme ───────────────────────────────────────────────

describe('T28e : la ferme active change avec un brouillon ouvert', () => {
  async function avecDeuxFermes(): Promise<{ readonly a: Banc; readonly porteB: PorteDonnees }> {
    const a = await creerBanc({ origine: true });
    bancCourant = a;
    a.base.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme B', 'Europe/Paris', ?, ?, '{"longueur":"m","masse":"kg"}')`, [
      FERME_B,
      JSON.stringify({ latitude: 45.25, longitude: 2.5 }),
      JSON.stringify({ latitude: 45.25, longitude: 2.5 }),
    ]);
    a.base.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('mb', ?, ?, 'gerant', 'accepte', NULL)`, [UTILISATEUR, FERME_B]);
    return { a, porteB: porteDe(a.base, FERME_B).porte };
  }

  it('brouillon fermé et message exact', async () => {
    const { a, porteB } = await avecDeuxFermes();
    await rendre(a.porte, FERME);
    await attendre(() => batiment(SERRE) !== null, 'serre affichée');
    const serre = batiment(SERRE);
    if (serre === null) return;
    await selectionner(serre);
    await touche(serre, 'ArrowRight', { shiftKey: true });
    expect(desactive(bouton('Enregistrer')), 'brouillon ouvert dans A').toBe(false);
    expect(messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne))).toBe(false);

    await rendre(porteB, FERME_B);
    await attendre(() => editeur()?.getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    await attendre(() => messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne)), 'message « brouillon abandonné »');
    expect(MESSAGES_SUITES.brouillonAbandonne).toBe('Le brouillon en cours a été abandonné : la ferme active a changé.');
    expect(desactive(bouton('Enregistrer')), 'plus de brouillon dans B').toBe(true);
    expect(a.placements).toEqual([]);
  });

  async function ouvrirDansB(): Promise<{ readonly a: Banc }> {
    const { a, porteB } = await avecDeuxFermes();
    a.base.recevoir(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le) VALUES ('0192f0c1-28b0-7000-8000-0000000000b4', ?, 'Hangar B', 'hangar', 20, 12, 6, 10, 10, 0, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
      [FERME_B],
    );
    await rendre(a.porte, FERME);
    await attendre(() => batiment(SERRE) !== null, 'serre affichée');
    const serre = batiment(SERRE);
    if (serre === null) return { a };
    await selectionner(serre);
    await touche(serre, 'ArrowRight', { shiftKey: true });
    await rendre(porteB, FERME_B);
    await attendre(() => messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne)), 'message « brouillon abandonné »');
    return { a };
  }

  it('le message disparaît au premier geste dans la nouvelle ferme', async () => {
    await ouvrirDansB();
    const hangar = batiment('0192f0c1-28b0-7000-8000-0000000000b4');
    expect(hangar, 'bâtiment de la ferme B').not.toBeNull();
    if (hangar === null) return;
    await selectionner(hangar);
    await touche(hangar, 'ArrowRight');
    expect(messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne))).toBe(false);
  });

  it('le message disparaît à la pose suivante', async () => {
    await ouvrirDansB();
    await commencerPose();
    await toucher(bouton(BOUTON_POSER_AU_CENTRE));
    await attendre(() => nouveauxBatiments().length === 2, 'bâtiment posé');
    expect(messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne))).toBe(false);
  });

  it('sans brouillon ouvert, pas de message', async () => {
    const { a, porteB } = await avecDeuxFermes();
    await rendre(a.porte, FERME);
    await attendre(() => batiment(SERRE) !== null, 'serre affichée');
    await rendre(porteB, FERME_B);
    await attendre(() => editeur()?.getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    for (let k = 0; k < 5; k++) await unTour();
    expect(messages().some((t) => t.includes(MESSAGES_SUITES.brouillonAbandonne))).toBe(false);
  });
});

// ── Confirmation d'abri ──────────────────────────────────────────────────────────────────────

describe('T28e : confirmation d’abri', () => {
  it('le texte dit que les planches de la zone suivront la serre, en gardant l’avertissement sur le contour', async () => {
    await ouvrir({ origine: true });
    await selectionner(batiment(SERRE) ?? document.body);
    await remplir(liste('Zone abritée', panneau()), ZONE_CHAMP);
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation d’abri');
    const t = texte(confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)));
    expect(t).toContain(MESSAGES_PLACEMENT.contourRemplace);
    expect(t).toContain('Les planches de la zone suivront la serre.');
    expect(MESSAGES_SUITES.planchesSuivent).toBe('Les planches de la zone suivront la serre.');
  });
});

// ── Tuiles en erreur ─────────────────────────────────────────────────────────────────────────

describe('T28e : une tuile en erreur est redemandée sans attendre « en ligne »', () => {
  const delai = (): number => tuilesMod.DELAI_RELANCE_TUILE_MS;
  const imgs = (): HTMLImageElement[] => tous(T.tuile).filter((el): el is HTMLImageElement => el instanceof HTMLImageElement);
  const srcs = (): string[] => imgs().map((i) => i.getAttribute('src') ?? '');
  const totalMontages = (): number => [...montages.values()].reduce((n, k) => n + k, 0);

  /** Compte chaque <img> de tuile ajouté au DOM (un montage = une demande au réseau), par src. */
  function observer(): void {
    montages = new Map();
    observateur?.disconnect();
    observateur = new MutationObserver((enregistrements) => {
      for (const e of enregistrements) {
        for (const n of e.addedNodes) {
          const cibles = n instanceof HTMLElement ? [n, ...n.querySelectorAll<HTMLElement>('img')] : [];
          for (const c of cibles) {
            if (c instanceof HTMLImageElement && c.getAttribute('data-testid') === T.tuile) {
              const s = c.getAttribute('src') ?? '';
              montages.set(s, (montages.get(s) ?? 0) + 1);
            }
          }
        }
      }
    });
    observateur.observe(conteneur, { childList: true, subtree: true });
  }

  async function echouer(img: Element): Promise<void> {
    await act(async () => {
      img.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    await unTour();
  }

  async function avancer(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** Éditeur ouvert avec ses tuiles ; horloge simulée (setTimeout seulement) ensuite. */
  async function ouvrirAvecTuiles(options: OptionsFermePlacement & Partial<Pick<ProprietesEditeurPlacement, 'enLigne'>> = { origine: true }): Promise<Banc> {
    const b = await ouvrir(options);
    if (options.enLigne !== false) await attendre(() => imgs().length > 0, 'tuiles affichées');
    observer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    return b;
  }

  it('constantes : relance en 5 s au plus, nombre d’essais borné', () => {
    expect(Number.isInteger(delai())).toBe(true);
    expect(delai()).toBeLessThanOrEqual(5000);
    expect(delai()).toBeGreaterThanOrEqual(500);
    expect(Number.isInteger(tuilesMod.ESSAIS_TUILE_MAX)).toBe(true);
    expect(tuilesMod.ESSAIS_TUILE_MAX).toBeGreaterThanOrEqual(1);
    expect(tuilesMod.ESSAIS_TUILE_MAX).toBeLessThanOrEqual(10);
  });

  it('première requête en échec : tuile masquée, puis redemandée (nouvel <img>, même src) au délai, sans événement « online »', async () => {
    await ouvrirAvecTuiles();
    const toutes = srcs();
    const premiere = imgs()[0];
    if (premiere === undefined) return;
    const src = premiere.getAttribute('src') ?? '';
    const avant = montages.get(src) ?? 0;
    await echouer(premiere);
    expect(srcs().filter((s) => s === src), 'tuile en échec masquée en attendant').toHaveLength(0);
    expect(editeur()?.getAttribute('data-fond'), 'les autres tuiles gardent la photo').toBe('photo');

    await avancer(delai() - 1);
    expect(montages.get(src) ?? 0, 'pas de relance avant le délai').toBe(avant);
    await avancer(1);
    await unTour();
    expect(montages.get(src) ?? 0, 'une relance au délai').toBe(avant + 1);
    expect(srcs().filter((s) => s === src)).toHaveLength(1);
    expect(srcs().sort()).toEqual(toutes.sort());
  });

  it('un échec qui se répète : une relance à la fois, pas de rafale, nombre d’essais borné', async () => {
    await ouvrirAvecTuiles();
    const premiere = imgs()[0];
    if (premiere === undefined) return;
    const src = premiere.getAttribute('src') ?? '';
    const debut = montages.get(src) ?? 0;
    await echouer(premiere);
    await echouer(premiere); // le même montage n'échoue qu'une fois : pas de seconde relance
    await avancer(delai());
    await unTour();
    expect((montages.get(src) ?? 0) - debut, 'une seule relance malgré deux événements error').toBe(1);

    // La tuile échoue à chaque fois : au plus ESSAIS_TUILE_MAX relances en tout, espacées du délai.
    for (let k = 0; k < tuilesMod.ESSAIS_TUILE_MAX + 5; k++) {
      const courante = imgs().find((i) => i.getAttribute('src') === src);
      if (courante !== undefined) await echouer(courante);
      await avancer(delai() * 3);
      await unTour();
    }
    await avancer(60_000);
    await unTour();
    expect((montages.get(src) ?? 0) - debut, 'relances bornées').toBe(tuilesMod.ESSAIS_TUILE_MAX);
    expect(montages.get(src) ?? 0).toBeLessThanOrEqual(1 + tuilesMod.ESSAIS_TUILE_MAX);
  });

  it('une tuile qui se charge remet son compteur d’essais à zéro : un échec plus tard est de nouveau relancé', async () => {
    await ouvrirAvecTuiles();
    const premiere = imgs()[0];
    if (premiere === undefined) return;
    const src = premiere.getAttribute('src') ?? '';
    const courante = (): HTMLImageElement | undefined => imgs().find((i) => i.getAttribute('src') === src);
    // Le budget d'essais est épuisé : la tuile échoue à chaque montage.
    for (let k = 0; k < tuilesMod.ESSAIS_TUILE_MAX; k++) {
      const c = courante();
      if (c !== undefined) await echouer(c);
      await avancer(delai());
      await unTour();
    }
    const derniere = courante();
    expect(derniere, 'dernière relance montée').toBeDefined();
    if (derniere === undefined) return;
    // Elle se charge enfin.
    await act(async () => {
      derniere.dispatchEvent(new Event('load'));
      await Promise.resolve();
    });
    await unTour();
    const avant = montages.get(src) ?? 0;
    await echouer(derniere);
    await avancer(delai());
    await unTour();
    expect((montages.get(src) ?? 0) - avant, 'nouvel échec après un chargement réussi : relancé').toBe(1);
  });

  it('plusieurs tuiles en échec ensemble : une seule relance chacune au délai, pas plus', async () => {
    await ouvrirAvecTuiles();
    const lot = imgs();
    expect(lot.length).toBeGreaterThan(1);
    const avant = totalMontages();
    for (const i of lot) await echouer(i);
    await avancer(delai());
    await unTour();
    expect(totalMontages() - avant).toBe(lot.length);
  });

  it('toutes les tuiles en échec : « indisponible pour le moment », puis la photo revient dès qu’une relance charge', async () => {
    await ouvrirAvecTuiles();
    for (const i of imgs()) await echouer(i);
    await attendre(() => editeur()?.getAttribute('data-fond') === 'neutre', 'fond neutre');
    expect(texte(un(T.fondNeutre))).toContain(MESSAGES_PLACEMENT.indisponible);
    expect(texte(un(T.fondNeutre))).not.toContain(MESSAGES_PLACEMENT.horsLigne);

    await avancer(delai());
    await unTour();
    await attendre(() => editeur()?.getAttribute('data-fond') === 'photo', 'photo de retour après la relance');
    expect(imgs().length).toBeGreaterThan(0);
    expect(un(T.fondNeutre)).toBeNull();
    expect(document.body.textContent).not.toContain(MESSAGES_PLACEMENT.indisponible);
    expect(document.body.textContent).not.toContain(MESSAGES_PLACEMENT.horsLigne);
  });

  it('« Photo aérienne indisponible hors ligne » : seulement hors ligne, et plus dès le retour du réseau', async () => {
    const b = await ouvrir({ origine: true, enLigne: false });
    expect(texte(un(T.fondNeutre))).toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(tous(T.tuile)).toEqual([]);
    await rendre(b.porte, FERME, { enLigne: true });
    await attendre(() => editeur()?.getAttribute('data-fond') === 'photo', 'photo de retour en ligne');
    expect(document.body.textContent).not.toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(dernieresProprietes?.enLigne).toBe(true);
  });
});

// ── T28d, relecture : focus après un tracé abandonné ─────────────────────────────────────────

describe('T28e : un tracé abandonné par Échap, zone absente, ne vole pas le focus plus tard', () => {
  it('le focus ne saute pas sur « Tracer le contour » quand la zone redevient affichée', async () => {
    const b = await ouvrir({ origine: true });
    const choisirZone = async (id: string): Promise<void> => {
      const choix = document.querySelector<HTMLElement>(`[data-testid="zone-choix"][data-id="${id}"]`);
      expect(choix, `zone ${id} dans la liste`).not.toBeNull();
      if (choix !== null) await toucher(choix);
    };
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    await cliquerPlan(500, 500);
    // La zone disparaît de l'écran (supprimée à distance), le tracé est abandonné par Échap, puis la zone revient.
    b.base.recevoir('UPDATE zone SET supprime_le = ? WHERE id = ?', ['2026-10-08T08:00:00.000Z', ZONE_TUNNEL]);
    await attendre(() => document.querySelector(`[data-testid="zone-choix"][data-id="${ZONE_TUNNEL}"]`) === null, 'zone retirée de la liste');
    await touche(editeur() ?? document.body, 'Escape');
    b.base.recevoir('UPDATE zone SET supprime_le = NULL WHERE id = ?', [ZONE_TUNNEL]);
    await attendre(() => document.querySelector(`[data-testid="zone-choix"][data-id="${ZONE_TUNNEL}"]`) !== null, 'zone revenue');
    await choisirZone(ZONE_TUNNEL);
    for (let k = 0; k < 5; k++) await unTour();
    const tracer = boutonsNommes(new RegExp(`^${B.tracer}$`))[0];
    expect(tracer, '« Tracer le contour » proposé').toBeDefined();
    expect(document.activeElement === tracer, 'le focus n’a pas sauté sur « Tracer le contour »').toBe(false);
  });
});

// ── T28d, relecture : la copie locale de la limite d'écritures ───────────────────────────────

describe('T28e : limite d’écritures par envoi', () => {
  it('la copie locale de brouillon.ts est celle de @planif/sync (le cœur)', () => {
    expect(ECRITURES_LOCAL).toBe(ECRITURES_SYNC);
    expect(ECRITURES_LOCAL).toBe(500);
  });
});
