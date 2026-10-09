// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28k — le placement au doigt sur le téléphone. Gestes simulés par des
 * PointerEvent (pointerType 'touch', un pointerId par doigt). Contrat : ./test/contrat-doigt.ts
 * (et ./test/contrat.ts, contrat-contours.ts, contrat-etapes.ts). Le téléphone est simulé par la
 * prop `ordinateur: false` (taille d'écran), comme dans les autres tests de l'éditeur.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, desactive, nomAccessible, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { TESTID_ETAPES as E } from './test/contrat-etapes.ts';
import { BOUTONS_DOIGT, DELAI_APPUI_LONG_MS, PAS_ROTATION_DEG, TAILLE_MIN_CIBLE_PX, TESTID_DOIGT as D } from './test/contrat-doigt.ts';
import { ecrireFermePlacement, FERME, SERRE, UTILISATEUR, ZONE_CHAMP, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-09T08:00:00.000Z');
/** Mètres par pixel au zoom 19, à 44° N. */
const MPP_19 = 0.214782;

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
let placements: (readonly ChangementPlacement[])[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  placements = [];
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch non prévu par ce test'))));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  base?.fermer();
  base = null;
});

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
  const proprietes: ProprietesEditeurPlacement = { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: options.ordinateur ?? false, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
  if (options.origine === true) await attendre(() => serre() !== null, 'serre affichée');
}

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const serre = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`);
function serreOuEchec(): HTMLElement {
  const s = serre();
  if (s === null) throw new Error('serre absente');
  return s;
}
const planOuEchec = (): HTMLElement => {
  const p = un(T.plan);
  if (p === null) throw new Error('plan absent');
  return p;
};
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const gauche = (el: HTMLElement): number => Number.parseFloat(el.style.left);
const haut = (el: HTMLElement): number => Number.parseFloat(el.style.top);
const geste = (): string | null => un(T.editeur)?.getAttribute('data-geste') ?? null;
const zoom = (): number => nombre(un(T.editeur) ?? document.body, 'data-zoom');
const ligneSerre = (): Record<string, string | number | null> | undefined => base?.lireDirect<Record<string, string | number | null>>('SELECT * FROM batiment WHERE id = ?', [SERRE])[0];
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));

// ── Doigts ───────────────────────────────────────────────────────────────────────────────────

type Type = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/** Un événement de doigt : `id` distingue les doigts (le premier posé est le principal). */
async function doigt(el: Element, type: Type, id: number, x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 }),
    );
    await Promise.resolve();
  });
  await unTour();
}

/** Un doigt qui glisse de (x0, y0) à (x1, y1) en quatre pas, puis se lève. */
async function glisser(el: Element, x0: number, y0: number, x1: number, y1: number, id = 1): Promise<void> {
  await doigt(el, 'pointerdown', id, x0, y0);
  for (let k = 1; k <= 4; k++) await doigt(el, 'pointermove', id, x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4);
  await doigt(el, 'pointerup', id, x1, y1);
}

/** Un tap : doigt posé, levé au même endroit, puis le clic que le navigateur ajoute. */
async function taper(el: Element, x = 300, y = 300, ecart = 0): Promise<void> {
  await doigt(el, 'pointerdown', 1, x, y);
  if (ecart > 0) await doigt(el, 'pointermove', 1, x + ecart, y);
  await doigt(el, 'pointerup', 1, x + ecart, y);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { clientX: x + ecart, clientY: y, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

/** Deux doigts : A reste à (ax, ay), B part de (bx, by) vers (cx, cy) ; ou les deux se déplacent. */
interface Doigts {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
}
async function deuxDoigts(el: Element, debut: Doigts, fin: Doigts, pas = 6): Promise<void> {
  await doigt(el, 'pointerdown', 1, debut.a[0], debut.a[1]);
  await doigt(el, 'pointerdown', 2, debut.b[0], debut.b[1]);
  for (let k = 1; k <= pas; k++) {
    const t = k / pas;
    await doigt(el, 'pointermove', 1, debut.a[0] + (fin.a[0] - debut.a[0]) * t, debut.a[1] + (fin.a[1] - debut.a[1]) * t);
    await doigt(el, 'pointermove', 2, debut.b[0] + (fin.b[0] - debut.b[0]) * t, debut.b[1] + (fin.b[1] - debut.b[1]) * t);
  }
}
async function leverDeuxDoigts(el: Element, fin: Doigts): Promise<void> {
  await doigt(el, 'pointerup', 2, fin.b[0], fin.b[1]);
  await doigt(el, 'pointerup', 1, fin.a[0], fin.a[1]);
}

async function selectionnerAuDoigt(): Promise<void> {
  await taper(serreOuEchec());
  await attendre(() => serreOuEchec().getAttribute('aria-pressed') === 'true', 'serre sélectionnée au tap');
}

const minuteriesFactices = (): void => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};
const avancer = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// ── Droits ───────────────────────────────────────────────────────────────────────────────────

describe('T28k : droits sur téléphone', () => {
  it('gérant sur téléphone : édition possible, plus de « à faire sur ordinateur »', async () => {
    await ouvrir({ origine: true });
    expect(un(T.editeur)?.getAttribute('data-mode')).toBe('edition');
    expect(un(T.editeur)?.getAttribute('data-ecran')).toBe('telephone');
    expect(texte(un(T.editeur))).not.toContain(MESSAGES_PLACEMENT.ordinateur);
    expect(boutonsNommes(/^Nouveau bâtiment/)).toHaveLength(1);
    expect(boutonsNommes(/^Enregistrer/)).toHaveLength(1);
    await selectionnerAuDoigt();
    expect(tous(T.poigneeRotation)).toHaveLength(1);
  });

  it('gérant sur ordinateur : data-ecran = ordinateur, édition comme avant', async () => {
    await ouvrir({ origine: true, ordinateur: true });
    expect(un(T.editeur)?.getAttribute('data-mode')).toBe('edition');
    expect(un(T.editeur)?.getAttribute('data-ecran')).toBe('ordinateur');
  });

  it('équipier sur téléphone : lecture seule, message « seul le gérant », ni barre ni bouton, rien ne bouge', async () => {
    await ouvrir({ origine: true, role: 'equipier' });
    expect(un(T.editeur)?.getAttribute('data-mode')).toBe('lecture');
    expect(texte(un(T.editeur))).toContain(MESSAGES_PLACEMENT.seulGerant);
    expect(texte(un(T.editeur))).not.toContain(MESSAGES_PLACEMENT.ordinateur);
    await taper(serreOuEchec());
    expect(tous(D.tournerMoins)).toHaveLength(0);
    expect(tous(D.tournerPlus)).toHaveLength(0);
    expect(tous(T.poigneeRotation)).toHaveLength(0);
    expect(boutonsNommes(/^(Enregistrer|Nouveau bâtiment)/)).toEqual([]);
    const x0 = nombre(serreOuEchec(), 'data-x');
    await glisser(serreOuEchec(), 300, 300, 400, 300);
    expect(nombre(serreOuEchec(), 'data-x')).toBe(x0);
    expect(placements).toEqual([]);
  });

  it('équipier : le bandeau d’étapes est visible en lecture seule (relecture T28j)', async () => {
    await ouvrir({ role: 'equipier' });
    expect(un(T.editeur)?.getAttribute('data-mode')).toBe('lecture');
    expect(un(E.bandeau), 'bandeau etapes-placement en lecture seule').not.toBeNull();
    expect(tous(E.etape).map((e) => e.getAttribute('data-etape'))).toEqual(['1', '2', '3', '4']);
  });
});

describe('T28k : étapes à venir grisées avec leur raison (relecture T28j)', () => {
  it.each([
    { nom: 'gérant', options: { role: 'gerant' as const } },
    { nom: 'équipier', options: { role: 'equipier' as const } },
  ])('$nom, sans point de départ : les étapes 2 à 4 sont aria-disabled et disent pourquoi ; l’étape 1 ne l’est pas', async ({ options }) => {
    await ouvrir(options);
    const etapes = tous(E.etape);
    expect(etapes).toHaveLength(4);
    for (const e of etapes) {
      const n = e.getAttribute('data-etape');
      const aVenir = e.getAttribute('data-etat') === 'a-venir';
      if (aVenir) {
        expect(e.getAttribute('aria-disabled'), `étape ${String(n)} à venir`).toBe('true');
        const raison = (e.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter((i) => i !== '')
          .map((i) => texte(document.getElementById(i)))
          .join(' ')
          .trim();
        expect(raison, `raison de l’étape ${String(n)}`).not.toBe('');
      } else {
        expect(e.getAttribute('aria-disabled') ?? 'false', `étape ${String(n)} pas à venir`).toBe('false');
      }
    }
    expect(etapes.filter((e) => e.getAttribute('data-etat') === 'a-venir')).toHaveLength(3);
  });
});

// ── Un doigt ─────────────────────────────────────────────────────────────────────────────────

describe('T28k : un doigt', () => {
  it('un tap sur un élément le sélectionne sans le déplacer, même avec 3 px de tremblement', async () => {
    await ouvrir({ origine: true });
    const x0 = nombre(serreOuEchec(), 'data-x');
    const y0 = nombre(serreOuEchec(), 'data-y');
    await taper(serreOuEchec(), 300, 300, 3);
    expect(serreOuEchec().getAttribute('aria-pressed')).toBe('true');
    expect(nombre(serreOuEchec(), 'data-x')).toBe(x0);
    expect(nombre(serreOuEchec(), 'data-y')).toBe(y0);
    expect(nombre(serreOuEchec(), 'data-orientation')).toBe(0);
    expect(placements).toEqual([]);
  });

  it('glisser un doigt sur l’élément sélectionné le déplace ; rien n’est écrit avant « Enregistrer »', async () => {
    await ouvrir({ origine: true });
    await selectionnerAuDoigt();
    await doigt(serreOuEchec(), 'pointerdown', 1, 300, 300);
    await doigt(serreOuEchec(), 'pointermove', 1, 350, 300);
    expect(geste(), 'geste en cours').toBe('element');
    await doigt(serreOuEchec(), 'pointermove', 1, 400, 300);
    expect(placements).toEqual([]);
    await doigt(serreOuEchec(), 'pointerup', 1, 400, 300);
    expect(geste()).toBe('aucun');
    expect(Math.abs(nombre(serreOuEchec(), 'data-x') - (40 + 100 * MPP_19))).toBeLessThan(0.05);
    expect(nombre(serreOuEchec(), 'data-y')).toBeCloseTo(40, 2);
    expect(placements).toEqual([]);
    expect(Number(ligneSerre()?.centre_x_m)).toBe(40);
    await toucher(bouton('Enregistrer'));
    await attendre(() => placements.length === 1, 'un appel à porte.placer');
    await attendre(() => Math.abs(Number(ligneSerre()?.centre_x_m) - (40 + 100 * MPP_19)) < 0.05, 'serre déplacée en base');
  });

  it('un doigt sur la carte la déplace : la serre non sélectionnée glisse à l’écran sans bouger dans la ferme', async () => {
    await ouvrir({ origine: true });
    const [g0, h0] = [gauche(serreOuEchec()), haut(serreOuEchec())];
    const [x0, y0] = [nombre(serreOuEchec(), 'data-x'), nombre(serreOuEchec(), 'data-y')];
    await doigt(planOuEchec(), 'pointerdown', 1, 200, 200);
    await doigt(planOuEchec(), 'pointermove', 1, 230, 220);
    await doigt(planOuEchec(), 'pointermove', 1, 260, 240);
    expect(geste()).toBe('carte');
    await doigt(planOuEchec(), 'pointerup', 1, 260, 240);
    expect(geste()).toBe('aucun');
    expect(gauche(serreOuEchec()) - g0).toBeCloseTo(60, 0);
    expect(haut(serreOuEchec()) - h0).toBeCloseTo(40, 0);
    expect(nombre(serreOuEchec(), 'data-x')).toBe(x0);
    expect(nombre(serreOuEchec(), 'data-y')).toBe(y0);
    expect(placements).toEqual([]);
  });

  it('un doigt qui glisse sur un élément NON sélectionné déplace la carte, pas l’élément, et ne le sélectionne pas', async () => {
    await ouvrir({ origine: true });
    const [g0, x0] = [gauche(serreOuEchec()), nombre(serreOuEchec(), 'data-x')];
    await glisser(serreOuEchec(), 300, 300, 400, 300);
    expect(nombre(serreOuEchec(), 'data-x')).toBe(x0);
    expect(gauche(serreOuEchec()) - g0).toBeCloseTo(100, 0);
    expect(serreOuEchec().getAttribute('aria-pressed')).not.toBe('true');
  });

  it('un tap sur la carte ne la déplace pas', async () => {
    await ouvrir({ origine: true });
    const g0 = gauche(serreOuEchec());
    await taper(planOuEchec(), 200, 200, 2);
    expect(gauche(serreOuEchec())).toBeCloseTo(g0, 5);
  });
});

// ── Deux doigts ──────────────────────────────────────────────────────────────────────────────

describe('T28k : deux doigts', () => {
  it('deux doigts qui s’écartent du double zooment d’un niveau, sans écrire ni tourner', async () => {
    await ouvrir({ origine: true });
    await selectionnerAuDoigt();
    // L'éditeur s'ouvre au zoom 19, et data-zoom plafonne à 19 (limite des tuiles, T28h) : on recule
    // d'abord de deux niveaux pour que le zoom avant au pincement soit lisible.
    await toucher(bouton('Zoom arrière'));
    await toucher(bouton('Zoom arrière'));
    const z0 = zoom();
    const debut: Doigts = { a: [250, 300], b: [350, 300] };
    const fin: Doigts = { a: [200, 300], b: [400, 300] };
    await deuxDoigts(planOuEchec(), debut, fin);
    expect(geste()).toBe('deux-doigts');
    await leverDeuxDoigts(planOuEchec(), fin);
    expect(geste()).toBe('aucun');
    expect(zoom()).toBe(z0 + 1);
    expect(nombre(serreOuEchec(), 'data-orientation')).toBe(0);
    expect(placements).toEqual([]);
  });

  it('deux doigts qui se rapprochent de moitié dézooment d’un niveau', async () => {
    await ouvrir({ origine: true });
    const z0 = zoom();
    const debut: Doigts = { a: [200, 300], b: [400, 300] };
    const fin: Doigts = { a: [250, 300], b: [350, 300] };
    await deuxDoigts(planOuEchec(), debut, fin);
    await leverDeuxDoigts(planOuEchec(), fin);
    expect(zoom()).toBe(z0 - 1);
    expect(placements).toEqual([]);
  });

  it('deux doigts qui tournent de 30° dans le sens horaire font tourner l’élément sélectionné de 30° (cap mis à jour)', async () => {
    await ouvrir({ origine: true });
    await selectionnerAuDoigt();
    const z0 = zoom();
    const x0 = nombre(serreOuEchec(), 'data-x');
    const rad = (30 * Math.PI) / 180;
    const debut: Doigts = { a: [300, 300], b: [400, 300] };
    const fin: Doigts = { a: [300, 300], b: [300 + 100 * Math.cos(rad), 300 + 100 * Math.sin(rad)] };
    await deuxDoigts(planOuEchec(), debut, fin);
    expect(nombre(serreOuEchec(), 'data-orientation'), 'cap pendant le geste').toBeCloseTo(30, 0);
    expect(placements, 'rien n’est écrit pendant le geste').toEqual([]);
    await leverDeuxDoigts(planOuEchec(), fin);
    expect(Math.abs(nombre(serreOuEchec(), 'data-orientation') - 30)).toBeLessThanOrEqual(1);
    expect(zoom(), 'distance inchangée : pas de zoom').toBe(z0);
    expect(nombre(serreOuEchec(), 'data-x'), 'la serre tourne sur place').toBe(x0);
    expect(placements).toEqual([]);
    await toucher(bouton('Enregistrer'));
    await attendre(() => placements.length === 1, 'un appel à porte.placer');
    await attendre(() => Math.abs(Number(ligneSerre()?.orientation_deg) - 30) <= 1, 'cap écrit en base');
  });

  it('sans élément sélectionné, deux doigts qui tournent ne tournent rien', async () => {
    await ouvrir({ origine: true });
    const rad = (45 * Math.PI) / 180;
    const debut: Doigts = { a: [300, 300], b: [400, 300] };
    const fin: Doigts = { a: [300, 300], b: [300 + 100 * Math.cos(rad), 300 + 100 * Math.sin(rad)] };
    await deuxDoigts(planOuEchec(), debut, fin);
    await leverDeuxDoigts(planOuEchec(), fin);
    expect(nombre(serreOuEchec(), 'data-orientation')).toBe(0);
  });

  it('le doigt resté sur l’écran après le geste à deux doigts ne déplace plus rien', async () => {
    await ouvrir({ origine: true });
    await selectionnerAuDoigt();
    const debut: Doigts = { a: [250, 300], b: [350, 300] };
    await deuxDoigts(planOuEchec(), debut, debut, 1);
    await doigt(planOuEchec(), 'pointerup', 2, 350, 300);
    const [g0, x0] = [gauche(serreOuEchec()), nombre(serreOuEchec(), 'data-x')];
    await doigt(planOuEchec(), 'pointermove', 1, 400, 380);
    await doigt(planOuEchec(), 'pointermove', 1, 450, 400);
    expect(nombre(serreOuEchec(), 'data-x')).toBe(x0);
    expect(gauche(serreOuEchec())).toBeCloseTo(g0, 5);
    await doigt(planOuEchec(), 'pointerup', 1, 450, 400);
    expect(geste()).toBe('aucun');
  });
});

// ── Boutons du bas ───────────────────────────────────────────────────────────────────────────

describe('T28k : boutons « Tourner −5° / +5° »', () => {
  it('absents sans sélection ; présents dans la barre du bas, après le plan, avec leur nom exact', async () => {
    await ouvrir({ origine: true });
    expect(tous(D.tournerMoins)).toHaveLength(0);
    expect(tous(D.tournerPlus)).toHaveLength(0);
    await selectionnerAuDoigt();
    const barre = un(D.barre);
    expect(barre, 'barre-doigt').not.toBeNull();
    expect(barre !== null && (planOuEchec().compareDocumentPosition(barre) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'barre après le plan').toBe(true);
    for (const [id, nom] of [
      [D.tournerMoins, BOUTONS_DOIGT.moins],
      [D.tournerPlus, BOUTONS_DOIGT.plus],
    ] as const) {
      const b = un(id);
      expect(b, id).not.toBeNull();
      expect(barre?.contains(b ?? null)).toBe(true);
      expect(b !== null && nomAccessible(b)).toBe(nom);
      expect(b !== null && desactive(b)).toBe(false);
    }
    expect(barre?.contains(bouton('Enregistrer'))).toBe(true);
  });

  it('+5° puis −5° ×2 : cap 5 puis 355, au brouillon ; « Enregistrer » écrit le cap', async () => {
    await ouvrir({ origine: true });
    await selectionnerAuDoigt();
    await toucher(un(D.tournerPlus) ?? document.body);
    expect(nombre(serreOuEchec(), 'data-orientation')).toBe(PAS_ROTATION_DEG);
    await toucher(un(D.tournerMoins) ?? document.body);
    await toucher(un(D.tournerMoins) ?? document.body);
    expect(nombre(serreOuEchec(), 'data-orientation')).toBe(360 - PAS_ROTATION_DEG);
    expect(nombre(serreOuEchec(), 'data-x')).toBe(40);
    expect(placements).toEqual([]);
    await toucher(bouton('Enregistrer'));
    await attendre(() => placements.length === 1, 'un appel à porte.placer');
    await attendre(() => Number(ligneSerre()?.orientation_deg) === 355, 'cap 355 en base');
  });
});

// ── Contours ─────────────────────────────────────────────────────────────────────────────────

describe('T28k : sommets de contour au doigt', () => {
  const sommets = (): HTMLElement[] => tous(TC.sommet);
  const cotes = (): HTMLElement[] => tous(TC.cote);
  const nSommets = (): number => nombre(un(TC.edition) ?? document.body, 'data-sommets');

  async function choisirZone(): Promise<void> {
    const z = document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_CHAMP}"]`);
    if (z === null) throw new Error('zone-choix absent');
    await toucher(z);
    await attendre(() => sommets().length === 4, 'quatre sommets affichés');
  }

  it('sur téléphone, chaque poignée de sommet fait au moins 44 px de côté (zone tactile)', async () => {
    await ouvrir({ origine: true });
    await choisirZone();
    for (const s of sommets()) {
      expect(Number.parseFloat(s.style.width), 'largeur').toBeGreaterThanOrEqual(TAILLE_MIN_CIBLE_PX);
      expect(Number.parseFloat(s.style.height), 'hauteur').toBeGreaterThanOrEqual(TAILLE_MIN_CIBLE_PX);
    }
  });

  it('un doigt sur un sommet le déplace ; rien n’est écrit', async () => {
    await ouvrir({ origine: true });
    await choisirZone();
    const x0 = nombre(sommets()[1] ?? document.body, 'data-x');
    await glisser(sommets()[1] ?? document.body, 300, 300, 360, 300);
    await attendre(() => Math.abs(nombre(sommets()[1] ?? document.body, 'data-x') - (x0 + 60 * MPP_19)) < 0.05, 'sommet 2 déplacé de 60 px');
    expect(placements).toEqual([]);
  });

  it('appui long sur un côté : un sommet de plus, au brouillon ; le clic qui suit n’en ajoute pas un second', async () => {
    await ouvrir({ origine: true });
    await choisirZone();
    minuteriesFactices();
    const cote = cotes()[0] ?? document.body;
    await doigt(cote, 'pointerdown', 1, 300, 300);
    await avancer(DELAI_APPUI_LONG_MS.max + 50);
    await doigt(cote, 'pointerup', 1, 300, 300);
    await act(async () => {
      cote.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await unTour();
    expect(nSommets()).toBe(5);
    expect(sommets()).toHaveLength(5);
    expect(placements).toEqual([]);
  });

  it('appui trop court sur un côté (tap au doigt) : aucun sommet ajouté', async () => {
    await ouvrir({ origine: true });
    await choisirZone();
    minuteriesFactices();
    const cote = cotes()[0] ?? document.body;
    await doigt(cote, 'pointerdown', 1, 300, 300);
    await avancer(DELAI_APPUI_LONG_MS.min - 100);
    await doigt(cote, 'pointerup', 1, 300, 300);
    await act(async () => {
      cote.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await avancer(DELAI_APPUI_LONG_MS.max);
    expect(nSommets()).toBe(4);
  });

  it('un doigt qui bouge pendant l’attente annule l’appui long', async () => {
    await ouvrir({ origine: true });
    await choisirZone();
    minuteriesFactices();
    const cote = cotes()[0] ?? document.body;
    await doigt(cote, 'pointerdown', 1, 300, 300);
    await doigt(cote, 'pointermove', 1, 340, 300);
    await avancer(DELAI_APPUI_LONG_MS.max + 50);
    await doigt(cote, 'pointerup', 1, 340, 300);
    expect(nSommets()).toBe(4);
  });
});

// ── Pas de défilement ────────────────────────────────────────────────────────────────────────

describe('T28k : la page ne défile pas pendant un geste sur la carte', () => {
  it.each([
    { nom: 'gérant', options: { role: 'gerant' as const } },
    { nom: 'équipier', options: { role: 'equipier' as const } },
  ])('$nom : touch-action: none en ligne sur la carte, les bâtiments et les planches', async ({ options }) => {
    await ouvrir({ origine: true, ...options });
    expect(planOuEchec().style.touchAction).toBe('none');
    for (const el of [...tous(T.batiment), ...tous(T.planche)]) expect(el.style.touchAction, el.getAttribute('data-id') ?? '').toBe('none');
    expect(tous(T.batiment).length).toBeGreaterThan(0);
  });

  it('les sommets aussi', async () => {
    await ouvrir({ origine: true });
    const z = document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_CHAMP}"]`);
    if (z === null) throw new Error('zone-choix absent');
    await toucher(z);
    await attendre(() => tous(TC.sommet).length === 4, 'sommets');
    for (const s of tous(TC.sommet)) expect(s.style.touchAction).toBe('none');
  });
});
