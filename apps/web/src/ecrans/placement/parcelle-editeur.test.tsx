// @vitest-environment happy-dom
/**
 * Tests d'acceptation T85 — dessiner la parcelle d'une zone à partir de ses planches, puis la
 * déplacer et la tourner d'un bloc (docs/backlog/T85-parcelle-depuis-planches.md), rendu pour de
 * vrai (happy-dom), base mémoire, vraie porte. Contrat : ./test/contrat-parcelle.ts.
 *
 * Ferme de test (option `planchesTunnel`) : « Tunnel 1 » (plein champ, sans contour) a trois planches
 * P1 à P3 de 30 × 0,75 m, non placées. Calcul à la main, passe-pied 45 cm : rectangle 3,15 m × 30 m,
 * centres des planches à −1,2 ; 0 ; +1,2 m de l'axe (le même calcul est testé dans le cœur).
 *
 * Bloc : « Plein champ » a le contour (100 ; 0) (140 ; 0) (140 ; 30) (100 ; 30), centre (120 ; 15), cap
 * 90°. La planche PC-01 en (5 ; 2 ; 0°) dans ce repère est à (122 ; 10), cap 90°. Tourner la zone à
 * l'orientation 0° (−90°, sens horaire) : (dx ; dy) → (−dy ; dx) autour de (120 ; 15) : sommets
 * (135 ; −5) (135 ; 35) (105 ; 35) (105 ; −5) ; PC-01 passe en (120 + 5 ; 15 + 2) = (125 ; 17), cap 0°.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { depuisRepereZone, repereZone, versLocal, type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { BOUTONS_PARCELLE as B, CHAMPS_PARCELLE as C, PASSE_PIED_DEPART_CM, TESTID_PARCELLE as TP } from './test/contrat-parcelle.ts';
import { ecrireFermePlacement, FERME, PLANCHE, PLANCHES_TUNNEL, POSITION, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-26T08:00:00.000Z');

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
}
interface Options {
  readonly origine?: boolean;
  readonly planches?: boolean;
  readonly zoneTunnel?: boolean;
  readonly role?: 'gerant' | 'equipier';
  readonly avant?: (b: BaseMemoire) => void;
}

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, {
    origine: o.origine ?? true,
    planchesTunnel: o.planches ?? false,
    ...(o.zoneTunnel === true ? { zoneTunnel: true } : {}),
    ...(o.role === undefined ? {} : { role: o.role }),
  });
  o.avant?.(base);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const porte: PorteDonnees = {
    ...reelle,
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  return { base, porte, placements };
}

type Ligne = Readonly<Record<string, string | number | null>>;
const ligne = (b: Banc, table: string, id: string): Ligne | undefined => b.base.lireDirect<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];
const contourEnBase = (b: Banc, zoneId: string): { x: number; y: number }[] | null => {
  const c = ligne(b, 'zone', zoneId)?.contour ?? null;
  return c === null ? null : (JSON.parse(String(c)) as { x: number; y: number }[]);
};
const placementEnBase = (b: Banc, id: string): { x: number; y: number; o: number } | null => {
  const l = ligne(b, 'emplacement', id);
  return l?.placement_x_m == null ? null : { x: Number(l.placement_x_m), y: Number(l.placement_y_m), o: Number(l.orientation_deg) };
};

let conteneur: HTMLDivElement;
let racine: Root;
let bancCourant: Banc | null = null;

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
  bancCourant?.base.fermer();
  bancCourant = null;
});

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const zoneChoix = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${id}"]`);
const panneau = (): HTMLElement => {
  const p = un(T.panneau);
  if (p === null) throw new Error('panneau-placement absent');
  return p;
};
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const planche = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${id}"]`);
  if (el === null) throw new Error(`planche ${id} absente`);
  return el;
};
/** Les planches de « Tunnel 1 » à l'écran (« Plein champ » a aussi sa PC-01). */
const plancheDuTunnel = (): HTMLElement[] => tous(T.planche).filter((el) => (PLANCHES_TUNNEL as readonly string[]).includes(el.getAttribute('data-id') ?? ''));
const sommets = (): { x: number; y: number }[] => tous(TC.sommet).map((s) => ({ x: nombre(s, 'data-x'), y: nombre(s, 'data-y') }));

async function ouvrir(o: Options = {}): Promise<Banc> {
  const b = await creerBanc(o);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await attendre(() => zoneChoix(ZONE_TUNNEL) !== null && zoneChoix(ZONE_CHAMP) !== null, 'liste des zones affichée');
  return b;
}

async function choisirZone(id: string): Promise<void> {
  const z = zoneChoix(id);
  if (z === null) throw new Error('zone absente');
  await toucher(z);
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
async function dessiner(passePied?: string): Promise<void> {
  if (passePied !== undefined) await remplir(champ(C.passePied, panneau()), passePied);
  await toucher(bouton(B.dessiner));
  await attendre(() => plancheDuTunnel().length >= 1, 'planches dessinées');
}

async function pointeur(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, extra: { shiftKey?: boolean } = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, pointerType: 'mouse', ...extra }),
    );
    await Promise.resolve();
  });
  await unTour();
}
async function glisser(el: Element, de: { x: number; y: number }, vers: { x: number; y: number }, extra: { shiftKey?: boolean } = {}): Promise<void> {
  await pointeur(el, 'pointerdown', de.x, de.y, extra);
  await pointeur(el, 'pointermove', (de.x + vers.x) / 2, (de.y + vers.y) / 2, extra);
  await pointeur(el, 'pointermove', vers.x, vers.y, extra);
  await pointeur(el, 'pointerup', vers.x, vers.y, extra);
}
/** Centre à l'écran du rectangle formé par les sommets affichés (pixels). */
function centreEcran(): { x: number; y: number } {
  const s = tous(TC.sommet).map((el) => ({ x: parseFloat(el.style.left) + parseFloat(el.style.width) / 2, y: parseFloat(el.style.top) + parseFloat(el.style.height) / 2 }));
  return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s.reduce((a, p) => a + p.y, 0) / s.length };
}

const classer = (l: { x: number; y: number }[]): string[] =>
  l
    .map((p) => `${(Math.round(p.x * 100) / 100).toFixed(2)};${(Math.round(p.y * 100) / 100).toFixed(2)}`)
    .sort();

describe('T85 : « Dessiner depuis les planches » est proposé', () => {
  it('zone de plein champ sans contour avec des planches : le bouton, AVANT « Tracer le contour » (qui reste), et le passe-pied à 45', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    const d = bouton(B.dessiner);
    const t = bouton(B.tracer);
    expect(boutonsNommes(new RegExp(`^${B.dessiner}$`))).toHaveLength(1);
    expect(d.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING, '« Dessiner » est au-dessus de « Tracer »').toBeTruthy();
    expect(desactive(d)).toBe(false);
    expect(champ(C.passePied, panneau()).value).toBe(String(PASSE_PIED_DEPART_CM));
  });

  it('hors-sol sans abri : proposé aussi', async () => {
    await ouvrir({
      planches: true,
      avant: (base) => {
        base.recevoir("UPDATE zone SET type_abri = 'hors_sol' WHERE id = ?", [ZONE_TUNNEL]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(new RegExp(`^${B.dessiner}$`))).toHaveLength(1);
  });

  it('sans point de départ du plan : désactivé, comme « Tracer le contour »', async () => {
    await ouvrir({ origine: false, planches: true });
    await choisirZone(ZONE_TUNNEL);
    expect(desactive(bouton(B.dessiner))).toBe(true);
    expect(desactive(bouton(B.tracer))).toBe(true);
  });

  it('zone sans aucun emplacement : rien de nouveau', async () => {
    await ouvrir({ planches: false });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
    expect(boutonsNommes(new RegExp(`^${B.tracer}$`))).toHaveLength(1);
  });

  it('emplacements supprimés ou sortis de service (actif_au renseigné) : ne comptent pas', async () => {
    await ouvrir({
      planches: true,
      avant: (base) => {
        base.recevoir("UPDATE emplacement SET supprime_le = '2026-10-01T08:00:00.000Z' WHERE id = ?", [PLANCHES_TUNNEL[0]]);
        base.recevoir("UPDATE emplacement SET actif_au = '2026-09-30' WHERE id = ?", [PLANCHES_TUNNEL[1]]);
        base.recevoir("UPDATE emplacement SET supprime_le = '2026-10-01T08:00:00.000Z' WHERE id = ?", [PLANCHES_TUNNEL[2]]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
  });

  it('zone abritée par un bâtiment : rien de nouveau', async () => {
    await ouvrir({
      planches: true,
      avant: (base) => {
        base.recevoir('UPDATE batiment SET zone_id = ? WHERE id = ?', [ZONE_TUNNEL, SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    expect(un(TC.zoneAbritee)).not.toBeNull();
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
    expect(tous(TP.interieur)).toHaveLength(0);
    expect(tous(TP.poigneeRotation)).toHaveLength(0);
  });

  it('zone de type tunnel (elle reçoit une serre) : « Placer la serre » seulement', async () => {
    await ouvrir({ planches: true, zoneTunnel: true });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(1);
  });

  it('zone qui a déjà un contour : pas de « Dessiner depuis les planches »', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_CHAMP);
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
  });

  it('équipier (lecture seule) : rien de nouveau, ni bouton, ni intérieur, ni poignée', async () => {
    await ouvrir({ role: 'equipier', planches: true });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(new RegExp(B.dessiner))).toHaveLength(0);
    await choisirZone(ZONE_CHAMP);
    expect(tous(TP.interieur)).toHaveLength(0);
    expect(tous(TP.poigneeRotation)).toHaveLength(0);
    expect(boutonsNommes(/Orientation/)).toHaveLength(0);
    expect(() => champ(C.orientation, panneau())).toThrow();
  });
});

describe('T85 : annonce des planches déjà placées', () => {
  const placer = (ids: readonly string[]) => (base: BaseMemoire) => {
    for (const id of ids) base.recevoir('UPDATE emplacement SET placement_x_m = 7, placement_y_m = 3, orientation_deg = 30 WHERE id = ?', [id]);
  };

  it('aucune placée : pas d’annonce', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    expect(un(TP.annonce)).toBeNull();
  });

  it('une placée : « 1 planche déjà placée sera rangée »', async () => {
    await ouvrir({ planches: true, avant: placer([PLANCHES_TUNNEL[0]]) });
    await choisirZone(ZONE_TUNNEL);
    expect(texte(un(TP.annonce) ?? document.body)).toContain('1 planche déjà placée sera rangée');
  });

  it('deux placées : « 2 planches déjà placées seront rangées »', async () => {
    await ouvrir({ planches: true, avant: placer([PLANCHES_TUNNEL[0], PLANCHES_TUNNEL[2]]) });
    await choisirZone(ZONE_TUNNEL);
    expect(texte(un(TP.annonce) ?? document.body)).toContain('2 planches déjà placées seront rangées');
  });
});

describe('T85 : dessiner la parcelle', () => {
  it('au brouillon : rectangle 3,15 × 30 m au centre de la vue, longueur vers le nord, planches à −1,2 ; 0 ; +1,2 m, rien d’écrit', async () => {
    const b = await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    expect(plancheDuTunnel()).toHaveLength(3);
    const [p1, p2, p3] = PLANCHES_TUNNEL.map(planche);
    if (p1 === undefined || p2 === undefined || p3 === undefined) throw new Error('planches absentes');
    for (const p of [p1, p2, p3]) {
      expect(nombre(p, 'data-longueur')).toBeCloseTo(30, 3);
      expect(nombre(p, 'data-largeur')).toBeCloseTo(0.75, 3);
      expect(nombre(p, 'data-orientation')).toBeCloseTo(0, 3);
    }
    const cx = nombre(p2, 'data-x');
    const cy = nombre(p2, 'data-y');
    expect(nombre(p1, 'data-x') - cx).toBeCloseTo(-1.2, 3);
    expect(nombre(p3, 'data-x') - cx).toBeCloseTo(1.2, 3);
    expect(nombre(p1, 'data-y')).toBeCloseTo(cy, 3);
    expect(nombre(p3, 'data-y')).toBeCloseTo(cy, 3);
    // Au centre de la vue.
    const [lat, lon] = (un(T.editeur)?.getAttribute('data-centre') ?? '0,0').split(',').map(Number);
    const centre = versLocal(POSITION, { latitude: lat ?? 0, longitude: lon ?? 0 });
    expect(Math.abs(cx - centre.x)).toBeLessThan(2);
    expect(Math.abs(cy - centre.y)).toBeLessThan(2);
    // Le contour de la zone : 4 sommets, 3,15 m d'est en ouest, 30 m du sud au nord.
    expect(un(TC.edition)?.getAttribute('data-sommets')).toBe('4');
    const s = sommets();
    expect(s).toHaveLength(4);
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.15, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 3);
    expect(b.placements, 'dessiner n’écrit rien').toEqual([]);
    expect(contourEnBase(b, ZONE_TUNNEL)).toBeNull();
  });

  it('passe-pied 100 cm : la parcelle fait 4,25 m, les planches à −1,75 ; 0 ; +1,75 m', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner('100');
    const [p1, p2, p3] = PLANCHES_TUNNEL.map(planche);
    if (p1 === undefined || p2 === undefined || p3 === undefined) throw new Error('planches absentes');
    expect(nombre(p1, 'data-x') - nombre(p2, 'data-x')).toBeCloseTo(-1.75, 3);
    expect(nombre(p3, 'data-x') - nombre(p2, 'data-x')).toBeCloseTo(1.75, 3);
    const xs = sommets().map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.25, 3);
  });

  it('passe-pied invalide (501, négatif, décimal) : bouton désactivé avec sa raison, rien au brouillon', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    for (const v of ['501', '-1', '12.5']) {
      await remplir(champ(C.passePied, panneau()), v);
      expect(desactive(bouton(B.dessiner)), `passe-pied ${v}`).toBe(true);
    }
    await remplir(champ(C.passePied, panneau()), '0');
    expect(desactive(bouton(B.dessiner))).toBe(false);
    await remplir(champ(C.passePied, panneau()), '500');
    expect(desactive(bouton(B.dessiner))).toBe(false);
    expect(plancheDuTunnel()).toHaveLength(0);
  });

  it('« Enregistrer » : UN appel à porte.placer, le contour puis un placement par planche, au bon endroit du terrain', async () => {
    const b = await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    await enregistrer();
    await attendre(() => contourEnBase(b, ZONE_TUNNEL) !== null, 'contour écrit');
    expect(b.placements).toHaveLength(1);
    const appel = b.placements[0] ?? [];
    expect(appel.map((c) => c.sorte)).toEqual(['zone', 'emplacement', 'emplacement', 'emplacement']);
    expect(appel.filter((c) => c.sorte === 'emplacement').map((c) => c.id).sort()).toEqual([...PLANCHES_TUNNEL].sort());

    const contour = contourEnBase(b, ZONE_TUNNEL) ?? [];
    expect(contour).toHaveLength(4);
    const repere = repereZone({ contour });
    expect(repere).not.toBeNull();
    if (repere === null) return;
    const cap = (id: string): number => {
      const p = placementEnBase(b, id);
      return (((p?.o ?? 0) + repere.orientationDeg) % 360 + 360) % 360;
    };
    [-1.2, 0, 1.2].forEach((dx, i) => {
      const id = PLANCHES_TUNNEL[i] ?? '';
      const p = placementEnBase(b, id);
      expect(p, `planche ${id} placée`).not.toBeNull();
      if (p === null) return;
      const abs = depuisRepereZone(repere, { x: p.x, y: p.y });
      expect(abs.x - repere.centre.x).toBeCloseTo(dx, 3);
      expect(abs.y - repere.centre.y).toBeCloseTo(0, 3);
      expect(Math.min(cap(id), 360 - cap(id))).toBeCloseTo(0, 2);
    });
  });

  it('« Annuler » remet le contour nul et les planches non placées, exactement', async () => {
    const b = await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    await enregistrer();
    await attendre(() => contourEnBase(b, ZONE_TUNNEL) !== null, 'contour écrit');
    await annulerDernier();
    await attendre(() => contourEnBase(b, ZONE_TUNNEL) === null, 'contour retiré');
    for (const id of PLANCHES_TUNNEL) expect(placementEnBase(b, id), `planche ${id}`).toBeNull();
    expect(b.placements).toHaveLength(2);
  });

  it('« Abandonner les changements » : plus de planches ni de contour, rien d’écrit', async () => {
    const b = await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    expect(plancheDuTunnel()).toHaveLength(3);
    await toucher(bouton('Abandonner les changements'));
    expect(plancheDuTunnel()).toHaveLength(0);
    expect(tous(TC.sommet)).toHaveLength(0);
    expect(b.placements).toEqual([]);
    expect(boutonsNommes(new RegExp(`^${B.dessiner}$`))).toHaveLength(1);
  });

  it('une planche déjà placée est recalée avec les autres, dans le même appel', async () => {
    const b = await ouvrir({
      planches: true,
      avant: (base) => {
        base.recevoir('UPDATE emplacement SET placement_x_m = 40, placement_y_m = 50, orientation_deg = 30 WHERE id = ?', [PLANCHES_TUNNEL[0]]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    await enregistrer();
    await attendre(() => contourEnBase(b, ZONE_TUNNEL) !== null, 'contour écrit');
    expect(b.placements).toHaveLength(1);
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['zone', 'emplacement', 'emplacement', 'emplacement']);
    const repere = repereZone({ contour: contourEnBase(b, ZONE_TUNNEL) ?? [] });
    const p = placementEnBase(b, PLANCHES_TUNNEL[0] ?? '');
    expect(repere).not.toBeNull();
    expect(p).not.toBeNull();
    if (repere === null || p === null) return;
    const abs = depuisRepereZone(repere, { x: p.x, y: p.y });
    expect(abs.x - repere.centre.x).toBeCloseTo(-1.2, 3);
  });
});

// ── Déplacer et tourner le bloc ─────────────────────────────────────────────────────────────

const PC01_EN = (base: BaseMemoire): void => {
  base.recevoir('UPDATE emplacement SET placement_x_m = 5, placement_y_m = 2, orientation_deg = 0 WHERE id = ?', [PLANCHE]);
};

describe('T85 : déplacer le bloc en glissant l’intérieur', () => {
  it('l’intérieur de la zone choisie existe en édition, pas en lecture, pas pour une zone sans contour', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    expect(tous(TP.interieur)).toHaveLength(0);
    await choisirZone(ZONE_CHAMP);
    expect(tous(TP.interieur)).toHaveLength(1);
    expect(tous(TP.poigneeRotation)).toHaveLength(1);
  });

  it('le contour et la planche bougent du même vecteur ; rien d’écrit tant qu’on n’enregistre pas', async () => {
    const b = await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const avantS = sommets();
    const avantP = { x: nombre(planche(PLANCHE), 'data-x'), y: nombre(planche(PLANCHE), 'data-y') };
    expect(avantP.x).toBeCloseTo(122, 3);
    expect(avantP.y).toBeCloseTo(10, 3);
    const interieur = un(TP.interieur);
    if (interieur === null) throw new Error('intérieur absent');
    await glisser(interieur, { x: 400, y: 300 }, { x: 460, y: 270 });

    const apresS = sommets();
    const apresP = { x: nombre(planche(PLANCHE), 'data-x'), y: nombre(planche(PLANCHE), 'data-y') };
    const dx = apresP.x - avantP.x;
    const dy = apresP.y - avantP.y;
    expect(dx, 'vers l’est').toBeGreaterThan(0.5);
    expect(dy, 'vers le nord').toBeGreaterThan(0.2);
    apresS.forEach((s, i) => {
      expect(s.x - (avantS[i]?.x ?? 0)).toBeCloseTo(dx, 2);
      expect(s.y - (avantS[i]?.y ?? 0)).toBeCloseTo(dy, 2);
    });
    // La planche garde sa place dans la zone : même cap.
    expect(nombre(planche(PLANCHE), 'data-orientation')).toBeCloseTo(90, 3);
    expect(b.placements).toEqual([]);
  });

  it('« Enregistrer » : un appel (zone puis planche), la planche garde son placement dans la zone ; « Annuler » remet l’état d’avant', async () => {
    const b = await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const interieur = un(TP.interieur);
    if (interieur === null) throw new Error('intérieur absent');
    await glisser(interieur, { x: 400, y: 300 }, { x: 460, y: 270 });
    const apresS = sommets();
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['zone', 'emplacement']);
    const contour = contourEnBase(b, ZONE_CHAMP) ?? [];
    expect(classer(contour)).toEqual(classer(apresS));
    const p = placementEnBase(b, PLANCHE);
    expect(p?.x).toBeCloseTo(5, 3);
    expect(p?.y).toBeCloseTo(2, 3);
    expect(p?.o).toBeCloseTo(0, 3);

    await annulerDernier();
    await attendre(() => b.placements.length === 2, 'annulation écrite');
    await unTour();
    expect(classer(contourEnBase(b, ZONE_CHAMP) ?? [])).toEqual(classer([{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 30 }, { x: 100, y: 30 }]));
    expect(placementEnBase(b, PLANCHE)).toEqual({ x: 5, y: 2, o: 0 });
  });

  it('« Abandonner les changements » remet le contour et la planche en place', async () => {
    await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const avantS = classer(sommets());
    const interieur = un(TP.interieur);
    if (interieur === null) throw new Error('intérieur absent');
    await glisser(interieur, { x: 400, y: 300 }, { x: 460, y: 270 });
    expect(classer(sommets())).not.toEqual(avantS);
    await toucher(bouton('Abandonner les changements'));
    expect(classer(sommets())).toEqual(avantS);
    expect(nombre(planche(PLANCHE), 'data-x')).toBeCloseTo(122, 3);
    expect(nombre(planche(PLANCHE), 'data-y')).toBeCloseTo(10, 3);
  });

  it('un déplacement de sommet, lui, laisse la planche sur place (T28d inchangé)', async () => {
    await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const sommet = tous(TC.sommet)[0];
    if (sommet === undefined) throw new Error('sommet absent');
    await glisser(sommet, { x: 300, y: 300 }, { x: 340, y: 300 });
    expect(nombre(planche(PLANCHE), 'data-x')).toBeCloseTo(122, 3);
    expect(nombre(planche(PLANCHE), 'data-y')).toBeCloseTo(10, 3);
  });

  it('une zone dessinée depuis les planches se déplace aussi, planches comprises', async () => {
    await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    const avantP = PLANCHES_TUNNEL.map((id) => ({ x: nombre(planche(id), 'data-x'), y: nombre(planche(id), 'data-y') }));
    const interieur = un(TP.interieur);
    if (interieur === null) throw new Error('intérieur absent');
    await glisser(interieur, { x: 400, y: 300 }, { x: 380, y: 340 });
    const apresP = PLANCHES_TUNNEL.map((id) => ({ x: nombre(planche(id), 'data-x'), y: nombre(planche(id), 'data-y') }));
    const dx = (apresP[0]?.x ?? 0) - (avantP[0]?.x ?? 0);
    const dy = (apresP[0]?.y ?? 0) - (avantP[0]?.y ?? 0);
    expect(dx).toBeLessThan(-0.1);
    expect(dy).toBeLessThan(-0.1);
    apresP.forEach((p, i) => {
      expect(p.x - (avantP[i]?.x ?? 0)).toBeCloseTo(dx, 3);
      expect(p.y - (avantP[i]?.y ?? 0)).toBeCloseTo(dy, 3);
    });
  });
});

describe('T85 : tourner le bloc', () => {
  it('le champ « Orientation (°) » donne le cap de la zone (90° pour un rectangle est-ouest)', async () => {
    await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    expect(Number(champ(C.orientation, panneau()).value)).toBeCloseTo(90, 3);
  });

  it('de 90° : le contour et la planche tournent autour du centre (120 ; 15), la planche passe en (125 ; 17) au cap 0°', async () => {
    await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    await remplir(champ(C.orientation, panneau()), '0');
    expect(classer(sommets())).toEqual(classer([{ x: 135, y: -5 }, { x: 135, y: 35 }, { x: 105, y: 35 }, { x: 105, y: -5 }]));
    expect(nombre(planche(PLANCHE), 'data-x')).toBeCloseTo(125, 3);
    expect(nombre(planche(PLANCHE), 'data-y')).toBeCloseTo(17, 3);
    expect(nombre(planche(PLANCHE), 'data-orientation')).toBeCloseTo(0, 3);
    expect(Number(champ(C.orientation, panneau()).value)).toBeCloseTo(0, 3);
  });

  it('« Enregistrer » puis « Annuler » : le placement dans la zone est celui du départ (nouveau repère), puis tout revient', async () => {
    const b = await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    await remplir(champ(C.orientation, panneau()), '0');
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel');
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['zone', 'emplacement']);
    const contour = contourEnBase(b, ZONE_CHAMP) ?? [];
    const repere = repereZone({ contour });
    const p = placementEnBase(b, PLANCHE);
    expect(repere).not.toBeNull();
    expect(p).not.toBeNull();
    if (repere === null || p === null) return;
    const abs = depuisRepereZone(repere, { x: p.x, y: p.y });
    expect(abs.x).toBeCloseTo(125, 3);
    expect(abs.y).toBeCloseTo(17, 3);
    await annulerDernier();
    await attendre(() => b.placements.length === 2, 'annulation écrite');
    await unTour();
    expect(classer(contourEnBase(b, ZONE_CHAMP) ?? [])).toEqual(classer([{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 30 }, { x: 100, y: 30 }]));
    expect(placementEnBase(b, PLANCHE)).toEqual({ x: 5, y: 2, o: 0 });
  });

  it('la poignée de rotation : tirée vers le nord, le bloc prend le cap 0° (le même résultat que le champ)', async () => {
    const b = await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const poignee = un(TP.poigneeRotation);
    if (poignee === null) throw new Error('poignée absente');
    const c = centreEcran();
    await glisser(poignee, { x: c.x + 200, y: c.y }, { x: c.x, y: c.y - 150 });
    expect(Number(champ(C.orientation, panneau()).value)).toBeCloseTo(0, 3);
    expect(nombre(planche(PLANCHE), 'data-x')).toBeCloseTo(125, 2);
    expect(nombre(planche(PLANCHE), 'data-y')).toBeCloseTo(17, 2);
    expect(b.placements).toEqual([]);
  });

  it('la poignée avec Maj tourne par pas de 15°', async () => {
    await ouvrir({ avant: PC01_EN });
    await choisirZone(ZONE_CHAMP);
    const poignee = un(TP.poigneeRotation);
    if (poignee === null) throw new Error('poignée absente');
    const c = centreEcran();
    // Cap visé : 10° à l'est du nord ; au cran de 15°, le bloc se cale sur 15°.
    const t = (10 * Math.PI) / 180;
    await glisser(poignee, { x: c.x + 200, y: c.y }, { x: c.x + 150 * Math.sin(t), y: c.y - 150 * Math.cos(t) }, { shiftKey: true });
    // Les sommets sont au millimètre : le cap du bloc se lit à 0,001° près.
    expect(Number(champ(C.orientation, panneau()).value)).toBeCloseTo(15, 2);
  });
});

describe('T85 : un seul enregistrement pour tout', () => {
  it('dessiner, déplacer, tourner puis enregistrer : un seul appel', async () => {
    const b = await ouvrir({ planches: true });
    await choisirZone(ZONE_TUNNEL);
    await dessiner();
    const interieur = un(TP.interieur);
    if (interieur === null) throw new Error('intérieur absent');
    await glisser(interieur, { x: 400, y: 300 }, { x: 440, y: 300 });
    await remplir(champ(C.orientation, panneau()), '90');
    await enregistrer();
    await attendre(() => contourEnBase(b, ZONE_TUNNEL) !== null, 'contour écrit');
    expect(b.placements).toHaveLength(1);
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['zone', 'emplacement', 'emplacement', 'emplacement']);
    // Après le tour de 90°, les planches (30 m, cap 0°) sont est-ouest : cap absolu 90°.
    const repere = repereZone({ contour: contourEnBase(b, ZONE_TUNNEL) ?? [] });
    if (repere === null) throw new Error('repère absent');
    for (const id of PLANCHES_TUNNEL) {
      const p = placementEnBase(b, id);
      expect(p).not.toBeNull();
      const cap = ((((p?.o ?? 0) + repere.orientationDeg) % 360) + 360) % 360;
      expect(cap).toBeCloseTo(90, 2);
    }
  });
});
