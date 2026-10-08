// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28d — contours de zones dans l'éditeur de placement, rendu pour de vrai
 * dans un DOM simulé (happy-dom), sur une base mémoire et la vraie porte (T28s) : choisir une zone,
 * tracer son contour point par point, le fermer (premier sommet ou Entrée), glisser un sommet,
 * ajouter le milieu d'un côté, retirer un sommet (jamais sous 3), clavier, liste des sommets dans
 * le panneau, refus en direct par validerContour (« Enregistrer » inactif), zone abritée par une
 * serre sans contour, gérant seulement, un seul porte.placer, annulation exacte, ferme qui change,
 * hors ligne (docs/backlog/T28d-contours-zones.md ; contrat : ./test/contrat-contours.ts, en plus
 * de ./test/contrat.ts). Le parcours dans un vrai navigateur : e2e/contours.e2e.ts.
 *
 * Coordonnées : dans happy-dom, la surface de dessin n'a pas de taille ; seuls les ÉCARTS en
 * pixels comptent ici (100 px vers l'est au zoom 19, à 44° N = 21,478 m), comme dans
 * ./editeur.test.tsx.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { depuisRepereZone, repereZone, validerContour, type Id } from '@planif/core';
import { creerPorte, ECRITURES_MAX_PAR_LOT, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type Point, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { BOUTONS_CONTOURS as B, MESSAGES_CONTOURS, TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { CONTOUR_CHAMP, ecrireFermePlacement, FERME, PLANCHE, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
/** m/px au zoom 19, à 44° N (voir tuiles.test.ts). */
const MPP_19 = 0.214782;
/** Seconde ferme du même utilisateur (comme robustesse.test.tsx) : point de départ posé, une zone sans contour. */
const FERME_B = '0192f0c1-28b0-7000-8000-0000000000b2';
const ZONE_B = '0192f0c1-28b0-7000-8000-0000000000b3';
const ORIGINE_B = { latitude: 45.25, longitude: 2.5 };

let m: ModuleEditeur;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

// ── Banc : base mémoire, vraie porte, écritures espionnées ───────────────────────────────────

interface PorteSuivie {
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
  readonly autresEcritures: string[];
}

function suivre(base: BaseMemoire, fermeId: string): PorteSuivie {
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const autresEcritures: string[] = [];
  const interdit =
    (nom: string) =>
    (): Promise<never> => {
      autresEcritures.push(nom);
      return Promise.reject(new Error(`l’éditeur ne doit pas appeler porte.${nom}`));
    };
  return {
    porte: {
      ...reelle,
      ecrire: interdit('ecrire'),
      ecrireEnsemble: interdit('ecrireEnsemble'),
      saisirEvenement: interdit('saisirEvenement'),
      archiverRefus: interdit('archiverRefus'),
      placer: (changements) => {
        placements.push(structuredClone(changements));
        return reelle.placer(changements);
      },
    },
    placements,
    autresEcritures,
  };
}

interface OptionsBanc extends OptionsFermePlacement {
  /** La serre M1 abrite « Tunnel 1 » (en base). */
  readonly abriter?: boolean;
  /** Ajoute la ferme B (gérant, origine posée, une zone sans contour). */
  readonly fermeB?: boolean;
  /** Lignes ajoutées avant l'ouverture (relecture du chef). */
  readonly avant?: (b: BaseMemoire) => void;
}

async function creerBase(o: OptionsBanc): Promise<BaseMemoire> {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(b, o);
  if (o.abriter === true) b.recevoir('UPDATE batiment SET zone_id = ? WHERE id = ?', [ZONE_TUNNEL, SERRE]);
  o.avant?.(b);
  if (o.fermeB === true) {
    b.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme B', 'Europe/Paris', ?, ?, '{"longueur":"m","masse":"kg"}')`, [
      FERME_B,
      JSON.stringify(ORIGINE_B),
      JSON.stringify(ORIGINE_B),
    ]);
    b.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('mb', ?, ?, 'gerant', 'accepte', NULL)`, [UTILISATEUR, FERME_B]);
    b.recevoir(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, supprime_le) VALUES (?, ?, 'Champ B', NULL, 'plein_champ', 500, NULL, NULL)`, [
      ZONE_B,
      FERME_B,
    ]);
  }
  return b;
}

type Ligne = Readonly<Record<string, string | number | null>>;
let base: BaseMemoire | null = null;
const contourEnBase = (zoneId: string): Point[] | null => {
  if (base === null) return null;
  const c = base.lireDirect<Ligne>('SELECT contour FROM zone WHERE id = ?', [zoneId])[0]?.contour ?? null;
  return c === null ? null : (JSON.parse(String(c)) as Point[]);
};

// ── Rendu ────────────────────────────────────────────────────────────────────────────────────

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
  base?.fermer();
  base = null;
});

async function rendre(p: PorteSuivie, fermeId: string, o: Partial<ProprietesEditeurPlacement> = {}): Promise<void> {
  const proprietes: ProprietesEditeurPlacement = {
    porte: p.porte,
    fermeId,
    utilisateurId: UTILISATEUR,
    surFermer: () => undefined,
    ordinateur: true,
    enLigne: true,
    ...o,
  };
  // Même racine, même composant, sans `key` : React garde l'instance (comme EcranFerme).
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
}

async function ouvrir(o: OptionsBanc & Partial<Pick<ProprietesEditeurPlacement, 'ordinateur' | 'enLigne'>> = {}): Promise<PorteSuivie> {
  base = await creerBase(o);
  const p = suivre(base, FERME);
  await rendre(p, FERME, { ordinateur: o.ordinateur ?? true, enLigne: o.enLigne ?? true });
  await attendre(() => zoneChoix(ZONE_CHAMP) !== null && zoneChoix(ZONE_TUNNEL) !== null, 'liste des zones affichée');
  return p;
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
function editeurOuEchec(): HTMLElement {
  const e = editeur();
  if (e === null) throw new Error('éditeur absent');
  return e;
}
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const zoneChoix = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${id}"]`);
const panneau = (): HTMLElement => {
  const p = un(T.panneau);
  if (p === null) throw new Error('panneau-placement absent');
  return p;
};
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
/** Les sommets affichés, dans l'ordre de data-index (et vérifie que le DOM suit cet ordre, pour Tab). */
function sommets(): HTMLElement[] {
  const s = tous(TC.sommet);
  expect(
    s.map((el) => nombre(el, 'data-index')),
    'sommets dans l’ordre des index dans le DOM',
  ).toEqual(s.map((_, i) => i));
  return s;
}
function sommet(i: number): HTMLElement {
  const s = sommets()[i];
  if (s === undefined) throw new Error(`sommet ${String(i)} absent`);
  return s;
}
const contourAffiche = (): Point[] => sommets().map((el) => ({ x: nombre(el, 'data-x'), y: nombre(el, 'data-y') }));
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const messages = (): string[] => [...document.querySelectorAll('[role="alert"], [role="status"]')].map((el) => texte(el));
const edition = (): HTMLElement | null => un(TC.edition);

/** Même cycle de sommets (premier sommet libre), à 1 cm près. */
function memeCycle(recu: readonly Point[] | null, attendu: readonly Point[], tolerance = 0.01): boolean {
  if (recu?.length !== attendu.length) return false;
  const n = attendu.length;
  for (let k = 0; k < n; k++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const r = recu[(i + k) % n];
      const a = attendu[i];
      ok = r !== undefined && a !== undefined && Math.abs(r.x - a.x) <= tolerance && Math.abs(r.y - a.y) <= tolerance;
    }
    if (ok) return true;
  }
  return false;
}
/** Le contour tel que la porte le range : validerContour du cœur (sens antihoraire). */
function range(contour: readonly Point[]): Point[] {
  const v = validerContour(contour);
  if (!v.ok) throw new Error(`contour attendu valide : ${v.erreur.message}`);
  return [...v.valeur];
}

async function choisirZone(id: string): Promise<void> {
  const z = zoneChoix(id);
  expect(z, `zone-choix ${id}`).not.toBeNull();
  if (z === null) return;
  // Déjà choisie : on ne la touche pas (un second toucher pourrait la désélectionner).
  if (z.getAttribute('aria-pressed') !== 'true') await toucher(z);
  await attendre(() => zoneChoix(id)?.getAttribute('aria-pressed') === 'true', 'zone sélectionnée (aria-pressed)');
}

async function touche(el: Element, key: string, o: { shiftKey?: boolean; ctrlKey?: boolean } = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...o }));
    await Promise.resolve();
  });
  await unTour();
}

async function selectionner(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus'));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function pointeur(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, button = 0): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, pointerType: 'mouse' }),
    );
    await Promise.resolve();
  });
  await unTour();
}

/** Un clic comme le navigateur : pointerdown, pointerup, click au même endroit, sur l'élément. */
async function cliquer(el: Element, x: number, y: number): Promise<void> {
  await pointeur(el, 'pointerdown', x, y);
  await pointeur(el, 'pointerup', x, y);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
    await Promise.resolve();
  });
  await unTour();
}

async function cliquerPlan(x: number, y: number): Promise<void> {
  const plan = un(T.plan);
  expect(plan, 'plan-placement affiché').not.toBeNull();
  if (plan !== null) await cliquer(plan, x, y);
}

async function clicDroit(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 10, bubbles: true, cancelable: true, button: 2 }));
    await Promise.resolve();
  });
  await unTour();
}

async function enregistrer(): Promise<void> {
  await toucher(bouton('Enregistrer'));
  await unTour();
}

async function annulerDernier(): Promise<void> {
  await attendre(() => un(T.annuler) !== null, '« Annuler » après l’enregistrement');
  const a = un(T.annuler);
  if (a !== null) await toucher(a);
}

/** Le seul changement d'un appel à porte.placer : le contour de la zone. */
function contourEcrit(appel: readonly ChangementPlacement[] | undefined, zoneId: string): Point[] | null {
  const z = appel?.find((c) => c.sorte === 'zone' && c.id === zoneId);
  return z?.sorte === 'zone' && z.contour !== null ? z.contour.map((p) => ({ x: p.x, y: p.y })) : null;
}

/** Une parcelle en L, en pixels de l'écran (y vers le bas), loin des bâtiments de la ferme. */
const L_PX: readonly Point[] = [
  { x: 540, y: 500 },
  { x: 740, y: 500 },
  { x: 740, y: 420 },
  { x: 640, y: 420 },
  { x: 640, y: 300 },
  { x: 540, y: 300 },
];

/** Écarts attendus (m) entre les sommets tracés et le premier : x est, y nord (l'écran a y vers le bas). */
const ecartsAttendus = (px: readonly Point[]): Point[] => {
  const p0 = px[0] ?? { x: 0, y: 0 };
  return px.map((p) => ({ x: (p.x - p0.x) * MPP_19, y: -(p.y - p0.y) * MPP_19 }));
};

function verifierEcarts(recu: readonly Point[], px: readonly Point[]): void {
  const attendus = ecartsAttendus(px);
  const r0 = recu[0] ?? { x: Number.NaN, y: Number.NaN };
  expect(recu).toHaveLength(px.length);
  recu.forEach((p, i) => {
    const a = attendus[i] ?? { x: Number.NaN, y: Number.NaN };
    expect(Math.abs(p.x - r0.x - a.x), `sommet ${String(i + 1)} : écart est-ouest`).toBeLessThan(0.05);
    expect(Math.abs(p.y - r0.y - a.y), `sommet ${String(i + 1)} : écart nord-sud`).toBeLessThan(0.05);
  });
}

// ── Choisir une zone, voir son contour ───────────────────────────────────────────────────────

describe('T28d : choisir une zone, son contour éditable', () => {
  it('liste des zones ; Plein champ choisi : 4 sommets, 4 côtés, valide, liste des sommets dans le panneau', async () => {
    const p = await ouvrir({ origine: true });
    expect(un(TC.listeZones), 'liste-zones').not.toBeNull();
    expect(texte(zoneChoix(ZONE_CHAMP)) + (zoneChoix(ZONE_CHAMP)?.getAttribute('aria-label') ?? '')).toContain('Plein champ');
    expect(texte(zoneChoix(ZONE_TUNNEL)) + (zoneChoix(ZONE_TUNNEL)?.getAttribute('aria-label') ?? '')).toContain('Tunnel 1');
    expect(tous(TC.sommet), 'aucun sommet avant de choisir une zone').toEqual([]);

    await choisirZone(ZONE_CHAMP);
    const e = edition();
    expect(e, 'contour-edition').not.toBeNull();
    expect(e?.getAttribute('data-id')).toBe(ZONE_CHAMP);
    expect(e?.getAttribute('data-etat')).toBe('valide');
    expect(e?.getAttribute('data-sommets')).toBe('4');
    expect(contourAffiche()).toEqual(CONTOUR_CHAMP);
    sommets().forEach((s, i) => {
      expect(s.getAttribute('role')).toBe('button');
      expect(s.getAttribute('tabindex')).toBe('0');
      expect(s.getAttribute('aria-label') ?? texte(s)).toContain(`Sommet ${String(i + 1)}`);
    });
    expect(tous(TC.cote).map((c) => nombre(c, 'data-index')).sort()).toEqual([0, 1, 2, 3]);
    expect(un(TC.erreur)).toBeNull();
    CONTOUR_CHAMP.forEach((s, i) => {
      expect(Number(champ(`Sommet ${String(i + 1)} x (m)`, panneau()).value)).toBeCloseTo(s.x, 3);
      expect(Number(champ(`Sommet ${String(i + 1)} y (m)`, panneau()).value)).toBeCloseTo(s.y, 3);
    });
    expect(p.placements).toEqual([]);
  });

  it('choisir un bâtiment désélectionne la zone (et inversement)', async () => {
    await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    const serre = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`);
    if (serre === null) throw new Error('serre absente');
    await selectionner(serre);
    await attendre(() => tous(TC.sommet).length === 0, 'sommets retirés quand un bâtiment est choisi');
    expect(zoneChoix(ZONE_CHAMP)?.getAttribute('aria-pressed')).not.toBe('true');
    await choisirZone(ZONE_CHAMP);
    expect(document.querySelector(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`)?.getAttribute('aria-pressed')).not.toBe('true');
  });
});

// ── Modifier un contour ──────────────────────────────────────────────────────────────────────

describe('T28d : modifier le contour à la souris', () => {
  it('glisser un sommet : rien d’écrit pendant ni après le geste ; « Enregistrer » = UN porte.placer ; « Annuler » rend le contour exact', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    const s2 = sommet(2);
    await pointeur(s2, 'pointerdown', 300, 300);
    await pointeur(s2, 'pointermove', 350, 300);
    await pointeur(s2, 'pointermove', 400, 300);
    expect(p.placements).toEqual([]);
    await pointeur(s2, 'pointerup', 400, 300);
    expect(p.placements, 'rien n’est écrit par le geste').toEqual([]);
    const deplace = { x: 140 + 100 * MPP_19, y: 30 };
    await attendre(() => Math.abs((contourAffiche()[2]?.x ?? 0) - deplace.x) < 0.05, 'sommet 3 déplacé de 100 px vers l’est');
    expect(contourAffiche()[2]?.y).toBeCloseTo(30, 2);
    expect(contourAffiche()[0]).toEqual(CONTOUR_CHAMP[0]);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);

    expect(desactive(bouton('Enregistrer'))).toBe(false);
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel à porte.placer');
    const attendu = [CONTOUR_CHAMP[0], CONTOUR_CHAMP[1], deplace, CONTOUR_CHAMP[3]] as Point[];
    // Décision du chef : PC-01, placée dans Plein champ, est replacée dans le même appel.
    expect([...(p.placements[0] ?? [])].map((c) => c.sorte).sort()).toEqual(['emplacement', 'zone']);
    expect(memeCycle(contourEcrit(p.placements[0], ZONE_CHAMP), attendu, 0.05), `contour écrit : ${JSON.stringify(p.placements[0])}`).toBe(true);
    await attendre(() => memeCycle(contourEnBase(ZONE_CHAMP), attendu, 0.05), 'contour en base');
    // Arrondi au millimètre.
    for (const s of contourEcrit(p.placements[0], ZONE_CHAMP) ?? []) {
      expect(Math.round(s.x * 1000) / 1000).toBe(s.x);
      expect(Math.round(s.y * 1000) / 1000).toBe(s.y);
    }

    await annulerDernier();
    await attendre(() => p.placements.length === 2, 'annulation par porte.placer');
    await attendre(() => JSON.stringify(contourEnBase(ZONE_CHAMP)) === JSON.stringify(CONTOUR_CHAMP), 'contour remis à l’identique en base');
    await attendre(() => JSON.stringify(contourAffiche()) === JSON.stringify(CONTOUR_CHAMP), 'contour remis à l’affichage');
    expect(p.autresEcritures).toEqual([]);
  });

  it('clic sur un côté : son milieu devient un sommet ; clic droit sur un sommet : retiré ; puis enregistré', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    const cote1 = tous(TC.cote).find((c) => nombre(c, 'data-index') === 1);
    if (cote1 === undefined) throw new Error('côté 1 absent');
    // Le point cliqué sur le côté n'importe pas : c'est le milieu qui est inséré.
    await cliquer(cote1, 700, 380);
    await attendre(() => tous(TC.sommet).length === 5, '5 sommets');
    expect(contourAffiche()).toEqual([CONTOUR_CHAMP[0], CONTOUR_CHAMP[1], { x: 140, y: 15 }, CONTOUR_CHAMP[2], CONTOUR_CHAMP[3]]);
    expect(edition()?.getAttribute('data-sommets')).toBe('5');
    await clicDroit(sommet(3));
    await attendre(() => tous(TC.sommet).length === 4, 'clic droit : sommet retiré');
    const attendu = [CONTOUR_CHAMP[0], CONTOUR_CHAMP[1], { x: 140, y: 15 }, CONTOUR_CHAMP[3]] as Point[];
    expect(contourAffiche()).toEqual(attendu);
    expect(p.placements).toEqual([]);
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    await attendre(() => memeCycle(contourEnBase(ZONE_CHAMP), range(attendu)), 'contour écrit en base');
  });

  it('clic droit à 3 sommets : refusé, message « au moins 3 sommets »', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    await clicDroit(sommet(0));
    await attendre(() => tous(TC.sommet).length === 3, '3 sommets');
    await clicDroit(sommet(0));
    await unTour();
    expect(tous(TC.sommet)).toHaveLength(3);
    await attendre(() => messages().some((t) => t.includes(MESSAGES_CONTOURS.sommetsMin)), `message « ${MESSAGES_CONTOURS.sommetsMin} »`);
    expect(p.placements).toEqual([]);
  });
});

describe('T28d : modifier le contour au clavier et par le panneau', () => {
  it('flèches (0,1 m, Maj 1 m), Inser, Suppr (jamais sous 3) ; rien n’est écrit avant « Enregistrer »', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    const s1 = sommet(1);
    await selectionner(s1);
    expect(sommet(1).getAttribute('aria-pressed')).toBe('true');
    await touche(sommet(1), 'ArrowUp', { shiftKey: true });
    await touche(sommet(1), 'ArrowUp', { shiftKey: true });
    await touche(sommet(1), 'ArrowRight');
    expect(contourAffiche()[1]).toEqual({ x: 140.1, y: 2 });

    await touche(sommet(1), 'Insert');
    await attendre(() => tous(TC.sommet).length === 5, 'Inser : 5 sommets');
    expect(contourAffiche()[2]).toEqual({ x: 140.05, y: 16 });
    await attendre(() => sommet(2).getAttribute('aria-pressed') === 'true', 'le nouveau sommet est sélectionné');

    const choisi = (): HTMLElement => sommets().find((s) => s.getAttribute('aria-pressed') === 'true') ?? sommet(0);
    await touche(choisi(), 'Delete');
    await attendre(() => tous(TC.sommet).length === 4, 'Suppr : 4 sommets');
    await touche(choisi(), 'Delete');
    await attendre(() => tous(TC.sommet).length === 3, 'Suppr : 3 sommets');
    await touche(choisi(), 'Delete');
    await unTour();
    expect(tous(TC.sommet), 'jamais sous 3 sommets').toHaveLength(3);
    await attendre(() => messages().some((t) => t.includes(MESSAGES_CONTOURS.sommetsMin)), `message « ${MESSAGES_CONTOURS.sommetsMin} »`);
    expect(p.placements, 'rien n’est écrit pendant les gestes').toEqual([]);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);

    const affiche = contourAffiche();
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    await attendre(() => memeCycle(contourEnBase(ZONE_CHAMP), range(affiche)), 'contour à 3 sommets écrit');
  });

  it('Ctrl+Z annule le dernier enregistrement du contour', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    await selectionner(sommet(0));
    await touche(sommet(0), 'ArrowLeft', { shiftKey: true });
    await enregistrer();
    await attendre(() => contourEnBase(ZONE_CHAMP)?.some((s) => s.x === 99) === true, 'contour écrit');
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await attendre(() => JSON.stringify(contourEnBase(ZONE_CHAMP)) === JSON.stringify(CONTOUR_CHAMP), 'Ctrl+Z : contour d’avant, à l’identique');
    expect(p.placements).toHaveLength(2);
  });

  it('liste des sommets du panneau : une saisie modifie le brouillon, écrit au tap sur « Enregistrer »', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    await remplir(champ('Sommet 3 x (m)', panneau()), '150');
    await remplir(champ('Sommet 3 y (m)', panneau()), '35.5');
    expect(contourAffiche()[2]).toEqual({ x: 150, y: 35.5 });
    expect(p.placements).toEqual([]);
    await enregistrer();
    const attendu = [CONTOUR_CHAMP[0], CONTOUR_CHAMP[1], { x: 150, y: 35.5 }, CONTOUR_CHAMP[3]] as Point[];
    await attendre(() => memeCycle(contourEnBase(ZONE_CHAMP), attendu, 0.001), 'contour écrit au millimètre');
    expect(p.placements).toHaveLength(1);
  });
});

// ── Refus en direct ──────────────────────────────────────────────────────────────────────────

describe('T28d : refus en direct par validerContour, « Enregistrer » inactif', () => {
  it('côtés croisés : contour en rouge, message exact de validerContour, rien d’écrit ; corrigé, le message disparaît', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    // Nœud papillon : (100, 0) (140, 30) (140, 0) (100, 30).
    await remplir(champ('Sommet 2 y (m)', panneau()), '30');
    await remplir(champ('Sommet 3 y (m)', panneau()), '0');
    const papillon = [
      { x: 100, y: 0 },
      { x: 140, y: 30 },
      { x: 140, y: 0 },
      { x: 100, y: 30 },
    ];
    expect(contourAffiche()).toEqual(papillon);
    const verdict = validerContour(papillon);
    expect(verdict.ok).toBe(false);
    const message = verdict.ok ? '' : verdict.erreur.message;
    await attendre(() => edition()?.getAttribute('data-etat') === 'invalide', 'data-etat invalide');
    const erreur = un(TC.erreur);
    expect(erreur, 'contour-erreur').not.toBeNull();
    expect(erreur?.getAttribute('role')).toBe('alert');
    expect(texte(erreur)).toContain(message);
    const enreg = bouton('Enregistrer');
    expect(desactive(enreg), '« Enregistrer » inactif sur un contour invalide').toBe(true);
    await toucher(enreg);
    await touche(editeurOuEchec(), 'Enter');
    expect(p.placements).toEqual([]);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);

    // Corrigé (retour au rectangle d'origine) : plus de message.
    await remplir(champ('Sommet 2 y (m)', panneau()), '0');
    await remplir(champ('Sommet 3 y (m)', panneau()), '30');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'corrigé : valide');
    expect(un(TC.erreur)).toBeNull();
    expect(p.placements).toEqual([]);
  });

  it('« Enregistrer » inactif même si un bâtiment du brouillon est valide', async () => {
    const p = await ouvrir({ origine: true });
    const serre = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`);
    if (serre === null) throw new Error('serre absente');
    await selectionner(serre);
    await touche(serre, 'ArrowRight', { shiftKey: true });
    await choisirZone(ZONE_CHAMP);
    await remplir(champ('Sommet 2 y (m)', panneau()), '30');
    await remplir(champ('Sommet 3 y (m)', panneau()), '0');
    await attendre(() => un(TC.erreur) !== null, 'contour-erreur');
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    await toucher(bouton('Enregistrer'));
    expect(p.placements).toEqual([]);
  });

  it('plus de 200 sommets (Inser) : message « au plus 200 sommets », « Enregistrer » inactif', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    await selectionner(sommet(0));
    for (let k = 0; k < 197; k++) {
      const choisi = document.querySelector<HTMLElement>(`[data-testid="${TC.sommet}"][aria-pressed="true"]`) ?? sommet(0);
      await touche(choisi, 'Insert');
    }
    await attendre(() => tous(TC.sommet).length === 201, '201 sommets');
    await attendre(() => texte(un(TC.erreur)).includes('au plus 200 sommets'), 'message de validerContour (trop de sommets)');
    expect(edition()?.getAttribute('data-etat')).toBe('invalide');
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    expect(p.placements).toEqual([]);
  }, 60_000);
});

// ── Tracer un nouveau contour ────────────────────────────────────────────────────────────────

describe('T28d : tracer un contour point par point', () => {
  it('zone sans contour : tracer une parcelle en L de 6 sommets, fermer sur le premier, enregistrer, annuler', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_TUNNEL);
    expect(tous(TC.sommet)).toEqual([]);
    await toucher(bouton(B.tracer));
    await attendre(() => edition()?.getAttribute('data-etat') === 'trace', 'tracé ouvert (data-etat trace)');
    expect(desactive(bouton('Enregistrer')), '« Enregistrer » inactif pendant le tracé').toBe(true);

    for (const [k, pt] of L_PX.entries()) {
      await cliquerPlan(pt.x, pt.y);
      await attendre(() => tous(TC.sommet).length === k + 1, `sommet ${String(k + 1)} posé`);
    }
    verifierEcarts(contourAffiche(), L_PX);
    expect(edition()?.getAttribute('data-etat')).toBe('trace');
    expect(p.placements, 'rien n’est écrit pendant le tracé').toEqual([]);

    // Fermer : clic sur le premier sommet.
    const premier = L_PX[0] ?? { x: 0, y: 0 };
    await cliquer(sommet(0), premier.x, premier.y);
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'tracé fermé, contour valide');
    expect(tous(TC.sommet), 'le premier sommet n’est pas répété').toHaveLength(6);
    expect(edition()?.getAttribute('data-sommets')).toBe('6');
    const trace = contourAffiche();
    expect(p.placements).toEqual([]);

    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel à porte.placer');
    expect(p.placements[0]?.map((c) => c.sorte)).toEqual(['zone']);
    await attendre(() => memeCycle(contourEnBase(ZONE_TUNNEL), range(trace)), 'contour en L écrit, sens antihoraire');
    await attendre(() => document.querySelector(`[data-testid="${T.zoneContour}"][data-id="${ZONE_TUNNEL}"]`) !== null, 'contour dessiné');

    await annulerDernier();
    await attendre(() => contourEnBase(ZONE_TUNNEL) === null, 'annulé : la zone n’a plus de contour');
    await attendre(() => boutonsNommes(new RegExp(`^${B.tracer}$`)).length === 1, '« Tracer le contour » de nouveau proposé');
    expect(p.autresEcritures).toEqual([]);
  });

  it('Entrée ferme un tracé de 3 sommets ; avec 2 sommets, Entrée ne ferme pas', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    await cliquerPlan(500, 500);
    await cliquerPlan(600, 500);
    await attendre(() => tous(TC.sommet).length === 2, '2 sommets');
    await touche(editeurOuEchec(), 'Enter');
    expect(edition()?.getAttribute('data-etat'), 'pas de fermeture à 2 sommets').toBe('trace');
    await cliquerPlan(500, 400);
    await attendre(() => tous(TC.sommet).length === 3, '3 sommets');
    await touche(editeurOuEchec(), 'Enter');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'Entrée : fermé');
    await enregistrer();
    await attendre(() => contourEnBase(ZONE_TUNNEL)?.length === 3, 'triangle écrit');
    expect(p.placements).toHaveLength(1);
  });

  it('Échap ou « Renoncer au tracé » : abandon, rien au brouillon', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    await cliquerPlan(500, 500);
    await cliquerPlan(600, 500);
    await touche(editeurOuEchec(), 'Escape');
    await attendre(() => tous(TC.sommet).length === 0, 'Échap : tracé abandonné');
    expect(desactive(bouton('Enregistrer'))).toBe(true);

    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    await cliquerPlan(500, 500);
    await toucher(bouton(B.renoncer));
    await attendre(() => tous(TC.sommet).length === 0, '« Renoncer au tracé » : abandonné');
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    expect(p.placements).toEqual([]);
    expect(contourEnBase(ZONE_TUNNEL)).toBeNull();
  });

  it('tracé fermé mais croisé : en rouge, message, « Enregistrer » inactif', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    for (const pt of [
      { x: 500, y: 500 },
      { x: 600, y: 400 },
      { x: 600, y: 500 },
      { x: 500, y: 400 },
    ]) await cliquerPlan(pt.x, pt.y);
    await attendre(() => tous(TC.sommet).length === 4, '4 sommets');
    await touche(editeurOuEchec(), 'Enter');
    await attendre(() => edition()?.getAttribute('data-etat') === 'invalide', 'nœud papillon : invalide');
    const v = validerContour(contourAffiche());
    expect(texte(un(TC.erreur))).toContain(v.ok ? '???' : v.erreur.message);
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    expect(p.placements).toEqual([]);
  });

  it('sans point de départ du plan : « Tracer le contour » désactivé', async () => {
    const p = await ouvrir({ origine: false });
    await choisirZone(ZONE_CHAMP);
    expect(desactive(bouton(B.tracer))).toBe(true);
    expect(p.placements).toEqual([]);
  });
});

// ── Zone abritée par une serre ───────────────────────────────────────────────────────────────

describe('T28d : une zone abritée suit sa serre, pas de contour à tracer', () => {
  it('zone abritée en base : message, ni « Tracer le contour » ni sommet', async () => {
    const p = await ouvrir({ origine: true, abriter: true });
    await choisirZone(ZONE_TUNNEL);
    const message = un(TC.zoneAbritee);
    expect(message, 'zone-abritee').not.toBeNull();
    expect(message?.getAttribute('role')).toBe('status');
    expect(texte(message)).toContain(MESSAGES_CONTOURS.zoneAbritee);
    expect(boutonsNommes(new RegExp(`^${B.tracer}`))).toEqual([]);
    expect(tous(TC.sommet)).toEqual([]);
    expect(tous(TC.cote)).toEqual([]);
    expect(edition()).toBeNull();
    expect(p.placements).toEqual([]);
  });

  it('zone abritée au brouillon (serre liée, pas encore enregistrée) : même message', async () => {
    await ouvrir({ origine: true });
    const serre = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`);
    if (serre === null) throw new Error('serre absente');
    await selectionner(serre);
    await remplir(liste('Zone abritée', panneau()), ZONE_TUNNEL);
    await choisirZone(ZONE_TUNNEL);
    expect(texte(un(TC.zoneAbritee))).toContain(MESSAGES_CONTOURS.zoneAbritee);
    expect(boutonsNommes(new RegExp(`^${B.tracer}`))).toEqual([]);
  });
});

// ── Gérant seulement ─────────────────────────────────────────────────────────────────────────

describe('T28d : seul le gérant trace ou modifie un contour', () => {
  for (const cas of [
    { nom: 'équipier', options: { role: 'equipier' as const } },
    { nom: 'gérant sur téléphone', options: { ordinateur: false } },
  ]) {
    it(`${cas.nom} : zones consultables, aucun sommet ni côté, ni « Tracer le contour », les touches ne font rien`, async () => {
      const p = await ouvrir({ origine: true, ...cas.options });
      expect(editeurOuEchec().getAttribute('data-mode')).toBe('lecture');
      expect(un(TC.listeZones), 'liste-zones en lecture').not.toBeNull();
      await choisirZone(ZONE_CHAMP);
      expect(tous(TC.sommet)).toEqual([]);
      expect(tous(TC.cote)).toEqual([]);
      await choisirZone(ZONE_TUNNEL);
      expect(boutonsNommes(new RegExp(`^${B.tracer}`))).toEqual([]);
      await cliquerPlan(500, 500);
      await touche(editeurOuEchec(), 'Enter');
      expect(tous(TC.sommet)).toEqual([]);
      await choisirZone(ZONE_CHAMP);
      for (const c of panneau().querySelectorAll<HTMLInputElement>('input')) {
        expect(c.disabled || c.readOnly, `champ ${c.outerHTML} modifiable`).toBe(true);
      }
      expect(p.placements).toEqual([]);
      expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);
    });
  }
});

// ── Hors ligne ───────────────────────────────────────────────────────────────────────────────

describe('T28d : hors ligne, tracer et enregistrer marchent', () => {
  it('fond neutre ; tracé d’un triangle, enregistré par la porte', async () => {
    const p = await ouvrir({ origine: true, enLigne: false });
    expect(editeurOuEchec().getAttribute('data-fond')).toBe('neutre');
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    const px = [
      { x: 500, y: 500 },
      { x: 600, y: 500 },
      { x: 500, y: 400 },
    ];
    for (const pt of px) await cliquerPlan(pt.x, pt.y);
    await attendre(() => tous(TC.sommet).length === 3, '3 sommets');
    verifierEcarts(contourAffiche(), px);
    await touche(editeurOuEchec(), 'Enter');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'fermé');
    await enregistrer();
    await attendre(() => contourEnBase(ZONE_TUNNEL)?.length === 3, 'contour écrit hors ligne');
    expect(p.placements).toHaveLength(1);
  });
});

// ── La ferme active change sans démonter l'éditeur (comme T28b, B1) ──────────────────────────

describe('T28d : la ferme change pendant l’édition d’un contour', () => {
  it('brouillon de contour de A : rien n’est écrit dans B, ni affiché', async () => {
    base = await creerBase({ origine: true, fermeB: true });
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await attendre(() => zoneChoix(ZONE_CHAMP) !== null, 'zones de A');
    await choisirZone(ZONE_CHAMP);
    await selectionner(sommet(0));
    await touche(sommet(0), 'ArrowLeft', { shiftKey: true });
    expect(a.placements).toEqual([]);

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    await attendre(() => zoneChoix(ZONE_B) !== null, 'zones de B');
    expect(zoneChoix(ZONE_CHAMP), 'zones de A dans B').toBeNull();
    expect(tous(TC.sommet), 'sommets de A dans B').toEqual([]);
    expect(edition()).toBeNull();
    for (const e of boutonsNommes(/^Enregistrer$/)) {
      expect(desactive(e), '« Enregistrer » actif dans B avec le brouillon de A').toBe(true);
      await toucher(e);
    }
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await unTour();
    expect(b.placements).toEqual([]);
    expect(a.placements).toEqual([]);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);
  });

  it('tracé en cours dans A : abandonné en passant à B ; un clic dans B ne pose rien', async () => {
    base = await creerBase({ origine: true, fermeB: true });
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await attendre(() => zoneChoix(ZONE_TUNNEL) !== null, 'zones de A');
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    await cliquerPlan(500, 500);
    await cliquerPlan(600, 500);
    await attendre(() => tous(TC.sommet).length === 2, 'tracé commencé dans A');

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    expect(edition()).toBeNull();
    await cliquerPlan(500, 400);
    await touche(editeurOuEchec(), 'Enter');
    expect(tous(TC.sommet)).toEqual([]);
    expect(b.placements).toEqual([]);
    expect(a.placements).toEqual([]);
    expect(contourEnBase(ZONE_B)).toBeNull();
    expect(contourEnBase(ZONE_TUNNEL)).toBeNull();
  });

  it('contour enregistré dans A, puis B : « Annuler » et Ctrl+Z n’écrivent rien', async () => {
    base = await creerBase({ origine: true, fermeB: true });
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await attendre(() => zoneChoix(ZONE_CHAMP) !== null, 'zones de A');
    await choisirZone(ZONE_CHAMP);
    await selectionner(sommet(0));
    await touche(sommet(0), 'ArrowLeft', { shiftKey: true });
    await enregistrer();
    await attendre(() => contourEnBase(ZONE_CHAMP)?.some((s) => s.x === 99) === true, 'contour écrit dans A');
    const ecrit = contourEnBase(ZONE_CHAMP);

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    expect(un(T.annuler)).toBeNull();
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await unTour();
    expect(b.placements).toEqual([]);
    expect(a.placements).toHaveLength(1);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(ecrit);
  });
});

// ── Décision du chef : les planches restent en place quand le contour de leur zone change ────

/** PC-01 en base : position et cap absolus, déduits du contour de Plein champ et du placement. */
function pc01Absolue(): { x: number; y: number; cap: number; placement: { x: number; y: number; o: number } } {
  if (base === null) throw new Error('base absente');
  const l = base.lireDirect<Ligne>('SELECT placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = ?', [PLANCHE])[0];
  const r = repereZone({ contour: contourEnBase(ZONE_CHAMP) });
  if (l === undefined || r === null) throw new Error('PC-01 ou repère absent');
  const placement = { x: Number(l.x), y: Number(l.y), o: Number(l.o) };
  const c = depuisRepereZone(r, { x: placement.x, y: placement.y });
  return { x: c.x, y: c.y, cap: (((placement.o + r.orientationDeg) % 360) + 360) % 360, placement };
}
const ecartCap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
const planche = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${PLANCHE}"]`);

describe('T28d (chef) : retoucher le contour ne déplace pas les planches de la zone', () => {
  it('le plus long côté change (cap du repère 90° → 0°) : PC-01 immobile à l’écran et en base ; UN porte.placer zone + planche ; annulation exacte', async () => {
    const p = await ouvrir({ origine: true });
    await attendre(() => planche() !== null, 'PC-01 affichée');
    expect(pc01Absolue()).toMatchObject({ x: 120, y: 15, cap: 90 });
    await choisirZone(ZONE_CHAMP);
    // Plein champ devient 40 × 60 m : son plus long côté passe nord-sud.
    await remplir(champ('Sommet 3 y (m)', panneau()), '60');
    await remplir(champ('Sommet 4 y (m)', panneau()), '60');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'contour valide');
    const pl = planche();
    expect(pl, 'PC-01 toujours affichée').not.toBeNull();
    expect(nombre(pl ?? document.body, 'data-x')).toBeCloseTo(120, 2);
    expect(nombre(pl ?? document.body, 'data-y')).toBeCloseTo(15, 2);
    expect(ecartCap(nombre(pl ?? document.body, 'data-orientation'), 90)).toBeLessThanOrEqual(0.01);
    expect(p.placements).toEqual([]);

    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un seul appel à porte.placer');
    const appel = p.placements[0] ?? [];
    expect(appel.flatMap((c) => (c.sorte === 'zone' ? [c.id] : []))).toEqual([ZONE_CHAMP]);
    expect(appel.flatMap((c) => (c.sorte === 'emplacement' ? [c.id] : []))).toEqual([PLANCHE]);
    await attendre(() => contourEnBase(ZONE_CHAMP)?.some((s) => s.y === 60) === true, 'contour écrit');
    const apres = pc01Absolue();
    expect(Math.abs(apres.x - 120), 'x absolu de PC-01').toBeLessThanOrEqual(0.002);
    expect(Math.abs(apres.y - 15), 'y absolu de PC-01').toBeLessThanOrEqual(0.002);
    expect(ecartCap(apres.cap, 90), 'cap absolu de PC-01').toBeLessThanOrEqual(0.01);
    expect(apres.placement.y).toBeCloseTo(-15, 2);

    await annulerDernier();
    await attendre(() => JSON.stringify(contourEnBase(ZONE_CHAMP)) === JSON.stringify(CONTOUR_CHAMP), 'contour remis à l’identique');
    await attendre(() => JSON.stringify(pc01Absolue().placement) === JSON.stringify({ x: 0, y: 0, o: 0 }), 'PC-01 remise exactement en (0, 0, 0°)');
    expect(p.placements).toHaveLength(2);
    expect(p.autresEcritures).toEqual([]);
  });

  it('glisser un sommet à la souris : PC-01 reste à (120, 15) en base, à 2 mm près', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_CHAMP);
    const s2 = sommet(2);
    await pointeur(s2, 'pointerdown', 300, 300);
    await pointeur(s2, 'pointermove', 400, 250);
    await pointeur(s2, 'pointerup', 400, 250);
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    await attendre(() => JSON.stringify(contourEnBase(ZONE_CHAMP)) !== JSON.stringify(CONTOUR_CHAMP), 'contour écrit');
    const a = pc01Absolue();
    expect(Math.abs(a.x - 120)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(a.y - 15)).toBeLessThanOrEqual(0.002);
    expect(ecartCap(a.cap, 90)).toBeLessThanOrEqual(0.01);
  });

  it('zone sans planche placée : le contour seul est écrit', async () => {
    const p = await ouvrir({ origine: true });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton(B.tracer));
    for (const pt of [
      { x: 500, y: 500 },
      { x: 600, y: 500 },
      { x: 500, y: 400 },
    ]) await cliquerPlan(pt.x, pt.y);
    await touche(editeurOuEchec(), 'Enter');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'fermé');
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    expect(p.placements[0]?.map((c) => c.sorte)).toEqual(['zone']);
  });
});

// ── Relecture du chef ────────────────────────────────────────────────────────────────────────

const idTest = (n: number): string => `0192f0c1-28b0-7000-8000-${n.toString(16).padStart(12, '0')}`;
const RANG = idTest(0x21);
const PLANCHE_SANS_LARGEUR = idTest(0x22);
const ZONE_2 = idTest(0x12);

/** Un emplacement placé dans Plein champ. */
function emplacementPlace(b: BaseMemoire, id: string, code: string, sorte: string, largeur: number | null, placement: [number, number, number]): void {
  b.recevoir(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, remplace, placement_x_m, placement_y_m, orientation_deg, supprime_le)
     VALUES (?, ?, ?, ?, ?, 20, ?, NULL, '2020-01-01', NULL, '[]', ?, ?, ?, NULL)`,
    [id, FERME, ZONE_CHAMP, code, sorte, largeur, ...placement],
  );
}

/** Position et cap absolus d'un emplacement de Plein champ, lus en base. */
function absolueEnBase(id: string): { x: number; y: number; cap: number; placement: [number, number, number] } {
  if (base === null) throw new Error('base absente');
  const l = base.lireDirect<Ligne>('SELECT placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = ?', [id])[0];
  const r = repereZone({ contour: contourEnBase(ZONE_CHAMP) });
  if (l === undefined || r === null) throw new Error(`${id} ou repère absent`);
  const c = depuisRepereZone(r, { x: Number(l.x), y: Number(l.y) });
  return { x: c.x, y: c.y, cap: (((Number(l.o) + r.orientationDeg) % 360) + 360) % 360, placement: [Number(l.x), Number(l.y), Number(l.o)] };
}

describe('T28d, relecture B1 : tous les emplacements placés de la zone restent en place', () => {
  it('rang R-01 et planche P-02 sans largeur : réécrits dans le même porte.placer, position et cap absolus gardés ; annulation exacte', async () => {
    const p = await ouvrir({
      origine: true,
      avant: (b) => {
        emplacementPlace(b, RANG, 'R-01', 'rang', null, [5, 5, 0]);
        emplacementPlace(b, PLANCHE_SANS_LARGEUR, 'P-02', 'planche', null, [-5, 0, 45]);
      },
    });
    const avant = { rang: absolueEnBase(RANG), p02: absolueEnBase(PLANCHE_SANS_LARGEUR), pc01: absolueEnBase(PLANCHE) };
    await choisirZone(ZONE_CHAMP);
    // Contour agrandi à 40 × 60 m : centre et cap du repère changent.
    await remplir(champ('Sommet 3 y (m)', panneau()), '60');
    await remplir(champ('Sommet 4 y (m)', panneau()), '60');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'contour valide');
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un seul appel à porte.placer');
    const appel = p.placements[0] ?? [];
    expect(appel.flatMap((c) => (c.sorte === 'emplacement' ? [c.id] : [])).sort()).toEqual([PLANCHE, RANG, PLANCHE_SANS_LARGEUR].sort());
    await attendre(() => contourEnBase(ZONE_CHAMP)?.some((s) => s.y === 60) === true, 'contour écrit');
    for (const [id, a] of [
      [RANG, avant.rang],
      [PLANCHE_SANS_LARGEUR, avant.p02],
      [PLANCHE, avant.pc01],
    ] as const) {
      const n = absolueEnBase(id);
      expect(Math.abs(n.x - a.x), `${id} : x absolu`).toBeLessThanOrEqual(0.002);
      expect(Math.abs(n.y - a.y), `${id} : y absolu`).toBeLessThanOrEqual(0.002);
      expect(ecartCap(n.cap, a.cap), `${id} : cap absolu`).toBeLessThanOrEqual(0.01);
    }

    await annulerDernier();
    await attendre(() => JSON.stringify(contourEnBase(ZONE_CHAMP)) === JSON.stringify(CONTOUR_CHAMP), 'contour remis');
    await attendre(() => JSON.stringify(absolueEnBase(RANG).placement) === JSON.stringify([5, 5, 0]), 'R-01 remis exactement');
    expect(absolueEnBase(PLANCHE_SANS_LARGEUR).placement).toEqual([-5, 0, 45]);
    expect(absolueEnBase(PLANCHE).placement).toEqual([0, 0, 0]);
  });
});

describe('T28d, relecture B2 : ordre d’écriture (contours effacés, bâtiments, contours posés, emplacements)', () => {
  async function tracerTriangle(): Promise<void> {
    await toucher(bouton(B.tracer));
    for (const pt of [
      { x: 500, y: 500 },
      { x: 600, y: 500 },
      { x: 500, y: 400 },
    ]) await cliquerPlan(pt.x, pt.y);
    await touche(editeurOuEchec(), 'Enter');
    await attendre(() => edition()?.getAttribute('data-etat') === 'valide', 'triangle fermé');
  }
  const zoneDeSerre = (): unknown => base?.lireDirect<Ligne>('SELECT zone_id FROM batiment WHERE id = ?', [SERRE])[0]?.zone_id;
  const serreEl = (): HTMLElement => {
    const s = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${SERRE}"]`);
    if (s === null) throw new Error('serre absente');
    return s;
  };
  function ordreAccepte(appel: readonly ChangementPlacement[]): void {
    const iBatiment = appel.findIndex((c) => c.sorte === 'batiment' && c.id === SERRE);
    const iTunnel = appel.findIndex((c) => c.sorte === 'zone' && c.id === ZONE_TUNNEL);
    expect(iBatiment, 'serre dans l’appel').toBeGreaterThanOrEqual(0);
    expect(iTunnel, 'contour de Tunnel 1 dans l’appel').toBeGreaterThanOrEqual(0);
    expect(iBatiment, 'le bâtiment est détaché avant que le contour soit posé').toBeLessThan(iTunnel);
  }

  it('détacher la serre de Tunnel 1 (« Aucune ») puis tracer Tunnel 1 : un seul placer, accepté ; annulation exacte', async () => {
    const p = await ouvrir({ origine: true, abriter: true });
    await selectionner(serreEl());
    await remplir(liste('Zone abritée', panneau()), '');
    await choisirZone(ZONE_TUNNEL);
    expect(un(TC.zoneAbritee), 'Tunnel 1 n’est plus abritée au brouillon').toBeNull();
    await tracerTriangle();
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    ordreAccepte(p.placements[0] ?? []);
    await attendre(() => contourEnBase(ZONE_TUNNEL)?.length === 3, 'contour de Tunnel 1 écrit (appel accepté)');
    expect(zoneDeSerre()).toBeNull();

    await annulerDernier();
    await attendre(() => contourEnBase(ZONE_TUNNEL) === null, 'contour annulé');
    await attendre(() => zoneDeSerre() === ZONE_TUNNEL, 'serre de nouveau sur Tunnel 1');
    expect(p.placements).toHaveLength(2);
  });

  it('la serre passe de Tunnel 1 à une autre zone, puis on trace Tunnel 1 : un seul placer, accepté ; annulation exacte', async () => {
    const p = await ouvrir({
      origine: true,
      abriter: true,
      avant: (b) => {
        b.recevoir(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, supprime_le) VALUES (?, ?, 'Zone 2', NULL, 'tunnel', 200, NULL, NULL)`, [ZONE_2, FERME]);
      },
    });
    await selectionner(serreEl());
    await remplir(liste('Zone abritée', panneau()), ZONE_2);
    await choisirZone(ZONE_TUNNEL);
    expect(un(TC.zoneAbritee)).toBeNull();
    await tracerTriangle();
    await enregistrer();
    await attendre(() => p.placements.length === 1, 'un appel');
    ordreAccepte(p.placements[0] ?? []);
    await attendre(() => contourEnBase(ZONE_TUNNEL)?.length === 3, 'contour de Tunnel 1 écrit (appel accepté)');
    expect(zoneDeSerre()).toBe(ZONE_2);

    await annulerDernier();
    await attendre(() => contourEnBase(ZONE_TUNNEL) === null, 'contour annulé');
    await attendre(() => zoneDeSerre() === ZONE_TUNNEL, 'serre de nouveau sur Tunnel 1');
  });
});

describe('T28d, relecture : trop de changements en une fois', () => {
  it(`plus de ${String(ECRITURES_MAX_PAR_LOT)} changements : « Enregistrer » désactivé, message clair en français, rien d’écrit`, async () => {
    const p = await ouvrir({
      origine: true,
      avant: (b) => {
        // ECRITURES_MAX_PAR_LOT emplacements placés + PC-01 + le contour : au-delà de la limite.
        for (let k = 0; k < ECRITURES_MAX_PAR_LOT; k++) emplacementPlace(b, idTest(0x1000 + k), `R-${String(k)}`, 'rang', null, [(k % 20) - 10, Math.floor(k / 20) - 12, 0]);
      },
    });
    await choisirZone(ZONE_CHAMP);
    await selectionner(sommet(0));
    await touche(sommet(0), 'ArrowLeft', { shiftKey: true });
    await attendre(() => messages().some((t) => t.includes(MESSAGES_CONTOURS.tropDeChangements)), `message « ${MESSAGES_CONTOURS.tropDeChangements} »`);
    expect(messages().some((t) => t.includes('changements de placement à la fois')), 'pas le message technique de la porte').toBe(false);
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    await toucher(bouton('Enregistrer'));
    expect(p.placements).toEqual([]);
    expect(contourEnBase(ZONE_CHAMP)).toEqual(CONTOUR_CHAMP);
  }, 60_000);
});
