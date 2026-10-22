// @vitest-environment happy-dom
/**
 * Tests d'acceptation T81 — placer une serre depuis sa zone, en un geste (docs/backlog/
 * T81-placer-serre-depuis-zone.md), rendu pour de vrai (happy-dom), base mémoire, vraie porte.
 *
 * Ferme de test : « Tunnel 1 » (zone tunnel, sans contour), « Plein champ » (plein champ, contour
 * rectangulaire), « Serre M1 » (serre tunnel 30 × 8). Pour Manon 1, le contour de « Tunnel 1 »
 * est tracé de travers : (94,8 ; 36,4) (111,6 ; 58,8) (105,8 ; 64,4) (87,8 ; 40,4), dont le
 * rectangle englobant minimal est centré en (100 ; 50), 30 × 8 m, cap 36,87° (calcul à la main :
 * packages/core/src/placement/rectangle.test.ts).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { versLocal, type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, dialogues, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { ecrireFermePlacement, FERME, HANGAR, POSITION, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTOUR_MANON = [
  { x: 94.8, y: 36.4 },
  { x: 111.6, y: 58.8 },
  { x: 105.8, y: 64.4 },
  { x: 87.8, y: 40.4 },
];
const CAP_MANON = (Math.atan2(0.6, 0.8) * 180) / Math.PI;

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
  readonly role?: 'gerant' | 'equipier';
  readonly avant?: (b: BaseMemoire) => void;
}

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: o.origine ?? true, ...(o.role === undefined ? {} : { role: o.role }) });
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

const manon = (b: BaseMemoire): void => {
  b.recevoir('UPDATE zone SET contour = ? WHERE id = ?', [JSON.stringify(CONTOUR_MANON), ZONE_TUNNEL]);
};
const typeSerre = (b: BaseMemoire): void => {
  b.recevoir("UPDATE zone SET type_abri = 'serre' WHERE id = ?", [ZONE_TUNNEL]);
};

type Ligne = Readonly<Record<string, string | number | null>>;
const ligne = (b: Banc, table: string, id: string): Ligne | undefined => b.base.lireDirect<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];
const batimentsDeLaZone = (b: Banc, zoneId: string): Ligne[] => b.base.lireDirect<Ligne>('SELECT * FROM batiment WHERE zone_id = ? AND supprime_le IS NULL', [zoneId]);

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
const confirmation = (motif: RegExp): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && motif.test(texte(d)));

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

const nouveaux = (): HTMLElement[] => tous(T.batiment).filter((el) => ![SERRE, HANGAR].includes(el.getAttribute('data-id') ?? ''));
async function enregistrer(): Promise<void> {
  await toucher(bouton('Enregistrer'));
  await unTour();
}
async function annulerDernier(): Promise<void> {
  await attendre(() => un(T.annuler) !== null, '« Annuler » après l’enregistrement');
  const a = un(T.annuler);
  if (a !== null) await toucher(a);
}

describe('T81 : zone tunnel sans bâtiment ni contour', () => {
  it('propose « Placer la serre » à la place de « Tracer le contour »', async () => {
    await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(1);
    expect(boutonsNommes(/^Tracer le contour$/)).toHaveLength(0);
    expect(boutonsNommes(/^Remplacer par une serre$/)).toHaveLength(0);
  });

  it('« Placer la serre » pose un rectangle nommé comme la zone, 30 × 8 m, au centre de la vue, rien d’écrit', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    const serre = nouveaux()[0];
    expect(serre, 'nouvelle serre au plan').toBeDefined();
    if (serre === undefined) return;
    expect(serre.getAttribute('data-id')).toMatch(MOTIF_UUID_V7);
    expect(serre.getAttribute('aria-pressed')).toBe('true');
    expect(serre.getAttribute('aria-label') ?? '').toMatch(/^Tunnel 1/);
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(30, 3);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(8, 3);
    expect(nombre(serre, 'data-orientation')).toBeCloseTo(0, 3);
    const [lat, lon] = (un(T.editeur)?.getAttribute('data-centre') ?? '0,0').split(',').map(Number);
    const centre = versLocal(POSITION, { latitude: lat ?? 0, longitude: lon ?? 0 });
    expect(Math.abs(nombre(serre, 'data-x') - centre.x)).toBeLessThan(2);
    expect(Math.abs(nombre(serre, 'data-y') - centre.y)).toBeLessThan(2);
    // Poignées pour le tourner et l'étirer, champs en mètres pour les mesures exactes.
    expect(tous(T.poigneeRotation)).toHaveLength(1);
    expect(tous(T.poigneeCote).length).toBeGreaterThanOrEqual(4);
    expect(champ('Longueur (m)', panneau())).toBeDefined();
    expect(champ('Largeur (m)', panneau())).toBeDefined();
    expect(b.placements, 'poser n’écrit rien').toEqual([]);
  });

  it('mesures de départ : celles du dernier bâtiment du même type de la ferme', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir('UPDATE batiment SET longueur_m = 40, largeur_m = 6 WHERE id = ?', [SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    const serre = nouveaux()[0];
    expect(nombre(serre ?? document.body, 'data-longueur')).toBeCloseTo(40, 3);
    expect(nombre(serre ?? document.body, 'data-largeur')).toBeCloseTo(6, 3);
  });

  it('zone de type serre : la serre posée est une serre chapelle', async () => {
    const b = await ouvrir({ avant: typeSerre });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const [ecrit] = batimentsDeLaZone(b, ZONE_TUNNEL);
    expect(ecrit?.type).toBe('serre_chapelle');
  });

  it('« Enregistrer » : un seul porte.placer qui crée le bâtiment serre_tunnel ET le rattache à la zone ; « Annuler » retire les deux', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await remplir(champ('Longueur (m)', panneau()), '36');
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const appel = b.placements[0] ?? [];
    expect(appel.map((c) => c.sorte)).toEqual(['batiment']);
    const [ecrit] = batimentsDeLaZone(b, ZONE_TUNNEL);
    expect(ecrit).toMatchObject({ ferme_id: FERME, nom: 'Tunnel 1', type: 'serre_tunnel', longueur_m: 36, largeur_m: 8, zone_id: ZONE_TUNNEL, supprime_le: null });
    expect(String(ecrit?.id)).toMatch(MOTIF_UUID_V7);
    expect(ligne(b, 'zone', ZONE_TUNNEL)?.contour).toBeNull();

    await annulerDernier();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 0, 'serre retirée');
    expect(b.placements.length, 'l’annulation est un second appel, pas deux').toBe(2);
  });

  it('le brouillon seul n’écrit ni bâtiment ni lien en base', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    expect(nouveaux()).toHaveLength(1);
    expect(b.placements).toEqual([]);
    expect(batimentsDeLaZone(b, ZONE_TUNNEL)).toHaveLength(0);
  });
});

describe('T81 : zone tunnel dont le contour est déjà tracé (Manon 1)', () => {
  it('propose « Remplacer par une serre » ; pas de « Placer la serre »', async () => {
    await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/^Remplacer par une serre$/)).toHaveLength(1);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(0);
  });

  it('confirmation d’abord, rien au plan avant ; refus de la confirmation = rien ne change', async () => {
    const b = await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation du remplacement');
    expect(nouveaux()).toHaveLength(0);
    const d = confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
    if (d !== undefined) await toucher(bouton('Annuler', d));
    expect(nouveaux()).toHaveLength(0);
    expect(b.placements).toEqual([]);
    expect(boutonsNommes(/^Remplacer par une serre$/)).toHaveLength(1);
  });

  it('confirmé : la serre part du rectangle minimal du contour (centre 100 ; 50, 30 × 8 m, cap 36,87°) ; Enregistrer efface le contour et rattache, en un appel', async () => {
    const b = await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation');
    const d = confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
    if (d !== undefined) await toucher(bouton('Confirmer', d));
    await attendre(() => nouveaux().length === 1, 'serre au plan');
    const serre = nouveaux()[0] ?? document.body;
    expect(nombre(serre, 'data-x')).toBeCloseTo(100, 2);
    expect(nombre(serre, 'data-y')).toBeCloseTo(50, 2);
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(30, 2);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(8, 2);
    expect(nombre(serre, 'data-orientation')).toBeCloseTo(CAP_MANON, 2);
    expect(b.placements).toEqual([]);

    await enregistrer();
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const appel = b.placements[0] ?? [];
    expect(appel.map((c) => c.sorte)).toEqual(['zone', 'batiment']);
    expect(appel[0]).toEqual({ sorte: 'zone', id: ZONE_TUNNEL, contour: null });
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre rattachée');
    expect(ligne(b, 'zone', ZONE_TUNNEL)?.contour).toBeNull();
    const [ecrit] = batimentsDeLaZone(b, ZONE_TUNNEL);
    expect(ecrit).toMatchObject({ nom: 'Tunnel 1', type: 'serre_tunnel', longueur_m: 30, largeur_m: 8, centre_x_m: 100, centre_y_m: 50 });
    expect(Number(ecrit?.orientation_deg)).toBeCloseTo(CAP_MANON, 2);

    await annulerDernier();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 0, 'serre retirée');
    expect(JSON.parse(String(ligne(b, 'zone', ZONE_TUNNEL)?.contour)) as unknown).toEqual(CONTOUR_MANON);
  });
});

describe('T81 : le contour libre reste pour le plein champ', () => {
  it('zone de plein champ sans contour : « Tracer le contour », pas de serre', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir('UPDATE zone SET contour = NULL WHERE id = ?', [ZONE_CHAMP]);
      },
    });
    await choisirZone(ZONE_CHAMP);
    expect(boutonsNommes(/^Tracer le contour$/)).toHaveLength(1);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(0);
    expect(boutonsNommes(/^Remplacer par une serre$/)).toHaveLength(0);
  });

  it('zone de plein champ avec contour : sommets éditables, pas de serre', async () => {
    await ouvrir();
    await choisirZone(ZONE_CHAMP);
    expect(un(TC.edition)).not.toBeNull();
    expect(boutonsNommes(/une serre$|^Placer la serre$/)).toHaveLength(0);
  });

  it('zone hors-sol : « Tracer le contour »', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir("UPDATE zone SET type_abri = 'hors_sol' WHERE id = ?", [ZONE_TUNNEL]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/^Tracer le contour$/)).toHaveLength(1);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(0);
  });
});

describe('T81 : droits et conditions', () => {
  it('équipier : ni « Placer la serre » ni « Remplacer par une serre »', async () => {
    await ouvrir({ role: 'equipier', avant: manon });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/une serre$/)).toHaveLength(0);
  });

  it('sans point de départ du plan : « Placer la serre » est désactivé', async () => {
    await ouvrir({ origine: false });
    await choisirZone(ZONE_TUNNEL);
    const b = bouton('Placer la serre');
    expect(desactive(b)).toBe(true);
  });

  it('zone déjà abritée : ni l’un ni l’autre', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir('UPDATE batiment SET zone_id = ? WHERE id = ?', [ZONE_TUNNEL, SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/une serre$/)).toHaveLength(0);
  });
});
