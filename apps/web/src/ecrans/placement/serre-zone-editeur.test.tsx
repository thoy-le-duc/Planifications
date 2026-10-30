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
import { depuisRepereZone, repereZone, versLocal, type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, dialogues, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { ecrireFermePlacement, FERME, HANGAR, POSITION, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL } from './test/ferme-placement.ts';
import { deverrouiller } from './test/deverrouiller.ts';

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
  readonly ordinateur?: boolean;
  readonly role?: 'gerant' | 'equipier';
  readonly avant?: (b: BaseMemoire) => void;
}

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: o.origine ?? true, zoneTunnel: true, ...(o.role === undefined ? {} : { role: o.role }) });
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
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: o.ordinateur ?? true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
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
/** T89 : « Placer la serre » ouvre la fiche « Serre ou tunnel » ; « Créer » met la serre au brouillon (réglages facultatifs avant). */
async function creerDepuisLaFiche(reglages: Readonly<Record<string, string>> = {}): Promise<void> {
  await attendre(() => un('fiche-serre') !== null, 'fiche « Serre ou tunnel »');
  const f = un('fiche-serre') ?? document.body;
  for (const [nom, valeur] of Object.entries(reglages)) await remplir(champ(nom, f), valeur);
  await toucher(bouton('Créer', f));
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

  it('« Placer la serre » pose un rectangle nommé comme la zone, 40 × 9,6 m (fiche T89), au centre de la vue, rien d’écrit', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await creerDepuisLaFiche();
    const serre = nouveaux()[0];
    expect(serre, 'nouvelle serre au plan').toBeDefined();
    if (serre === undefined) return;
    expect(serre.getAttribute('data-id')).toMatch(MOTIF_UUID_V7);
    expect(serre.getAttribute('aria-pressed')).toBe('true');
    expect(serre.getAttribute('aria-label') ?? '').toMatch(/^Tunnel 1/);
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(40, 3);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(9.6, 3);
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
        // T89 : la dernière serre créée compte si elle a sa grille (une chapelle de 6 m, un tronçon de 40 m).
        base.recevoir('UPDATE batiment SET longueur_m = 40, largeur_m = 6, nb_chapelles = 1 WHERE id = ?', [SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await creerDepuisLaFiche();
    const serre = nouveaux()[0];
    expect(nombre(serre ?? document.body, 'data-longueur')).toBeCloseTo(40, 3);
    expect(nombre(serre ?? document.body, 'data-largeur')).toBeCloseTo(6, 3);
  });

  // T83 (Q50) : la ferme de ce banc a déjà « Serre M1 » (tunnel 30 × 8) ; sans elle, c'est la taille type.
  it('ferme sans aucun tunnel : le premier se pose en 40 × 9,6 m (taille type, Q50)', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir('DELETE FROM batiment WHERE id = ?', [SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await creerDepuisLaFiche();
    const serre = nouveaux()[0];
    expect(serre, 'nouvelle serre au plan').toBeDefined();
    expect(nombre(serre ?? document.body, 'data-longueur')).toBeCloseTo(40, 3);
    expect(nombre(serre ?? document.body, 'data-largeur')).toBeCloseTo(9.6, 3);
  });

  it('le seul tunnel supprimé en douceur (supprime_le renseigné) ne compte pas : 40 × 9,6 m', async () => {
    await ouvrir({
      avant: (base) => {
        base.recevoir("UPDATE batiment SET supprime_le = '2026-10-01T08:00:00.000Z' WHERE id = ?", [SERRE]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await creerDepuisLaFiche();
    const serre = nouveaux()[0];
    expect(serre, 'nouvelle serre au plan').toBeDefined();
    expect(nombre(serre ?? document.body, 'data-longueur')).toBeCloseTo(40, 3);
    expect(nombre(serre ?? document.body, 'data-largeur')).toBeCloseTo(9.6, 3);
  });

  it('zone de type serre : la serre posée est une serre chapelle', async () => {
    const b = await ouvrir({ avant: typeSerre });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    // T89 : le type suit le nombre de chapelles (plusieurs : serre chapelle).
    await creerDepuisLaFiche({ 'Nombre de chapelles': '2' });
    await enregistrer();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre écrite');
    expect(batimentsDeLaZone(b, ZONE_TUNNEL)[0]?.type).toBe('serre_chapelle');
  });

  it('« Enregistrer » : un seul porte.placer qui crée le bâtiment serre_tunnel ET le rattache à la zone ; « Annuler » retire les deux', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    // T89 : une chapelle de 8 m, sans planche à créer : seul le bâtiment s'écrit.
    await creerDepuisLaFiche({ 'Largeur d’une chapelle (m)': '8', 'Planches par zone': '0' });
    await remplir(champ('Longueur (m)', panneau()), '36');
    await enregistrer();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre écrite');
    expect(b.placements).toHaveLength(1);
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
    await creerDepuisLaFiche();
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

// ── Suites de la relecture : planches, contour inutilisable, doigt ───────────────────────────

const PLANCHE_A = '0192f0c1-28b0-7000-8000-0000000000e1';
const PLANCHE_B = '0192f0c1-28b0-7000-8000-0000000000e2';
const PLANCHE_C = '0192f0c1-28b0-7000-8000-0000000000e3';

function planche(b: BaseMemoire, id: string, x: number, y: number, o: number, longueur = 3): void {
  b.recevoir(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du, actif_au, remplace, placement_x_m, placement_y_m, orientation_deg, supprime_le)
     VALUES (?, ?, ?, ?, 'planche', ?, 0.8, '2020-01-01', NULL, '[]', ?, ?, ?, NULL)`,
    [id, FERME, ZONE_TUNNEL, `M-${id.slice(-1)}`, longueur, x, y, o],
  );
}
const placementDe = (b: Banc, id: string): { x: number; y: number; o: number } => {
  const l = ligne(b, 'emplacement', id);
  return { x: Number(l?.placement_x_m), y: Number(l?.placement_y_m), o: Number(l?.orientation_deg) };
};
/** Écart entre deux caps, en degrés, modulo 360. */
const ecartCap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

async function confirmerRemplacement(): Promise<void> {
  await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation du remplacement');
  const d = confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
  if (d !== undefined) await toucher(bouton('Confirmer', d));
}

describe('T81 : planches déjà placées dans la zone dont on remplace le contour', () => {
  /**
   * Repère du contour de Manon 1 (calcul à la main) : centroïde du trapèze (a ∈ [−15 ; 15], b ∈ [−4 ; 4],
   * côtés de 30 m et 28 m) à b = −4 + 8 × (30 + 2 × 28) / (3 × 58) = −0,04598 m du centre, soit
   * (99,9632 ; 50,0276) ; cap du plus long côté (30 m) 36,87°, comme le rectangle. Une planche en (0 ; 0 ; 0°) dans la
   * zone est donc au centroïde, à (−0,0368 ; +0,0276) du centre de la serre ; projeté sur l'axe de la largeur
   * (0,8 ; −0,6) : x' = −0,0368 × 0,8 − 0,0276 × 0,6 = −0,046 ; sur l'axe de la longueur (0,6 ; 0,8) :
   * y' = −0,0368 × 0,6 + 0,0276 × 0,8 ≈ 0 ; cap 0° : la planche passe à (−0,046 ; 0 ; 0°).
   */
  it('« Enregistrer » les convertit dans le repère de la serre : même point du terrain, même cap, au millimètre, en un appel', async () => {
    const b = await ouvrir({
      avant: (base) => {
        manon(base);
        planche(base, PLANCHE_A, 0, 0, 0);
        planche(base, PLANCHE_B, 2, 5, 90);
      },
    });
    const zone = repereZone({ contour: CONTOUR_MANON });
    expect(zone?.centre.x).toBeCloseTo(99.9632, 3);
    expect(zone?.centre.y).toBeCloseTo(50.0276, 3);
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await confirmerRemplacement();
    await enregistrer();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre écrite');
    await attendre(() => placementDe(b, PLANCHE_A).x !== 0, 'planche convertie');
    expect(b.placements).toHaveLength(1);
    expect(b.placements[0]?.map((c) => c.sorte)).toEqual(['zone', 'batiment', 'emplacement', 'emplacement']);

    const a = placementDe(b, PLANCHE_A);
    expect(a.x).toBeCloseTo(-0.046, 3);
    expect(a.y).toBeCloseTo(0, 3);
    expect(ecartCap(a.o, 0)).toBeLessThan(0.01);

    const serre = batimentsDeLaZone(b, ZONE_TUNNEL)[0];
    const reperSerre = { centre: { x: Number(serre?.centre_x_m), y: Number(serre?.centre_y_m) }, orientationDeg: Number(serre?.orientation_deg) };
    for (const [id, avant] of [[PLANCHE_A, { x: 0, y: 0, o: 0 }], [PLANCHE_B, { x: 2, y: 5, o: 90 }]] as const) {
      const terrainAvant = depuisRepereZone(zone ?? reperSerre, { x: avant.x, y: avant.y });
      const n = placementDe(b, id);
      const terrainApres = depuisRepereZone(reperSerre, { x: n.x, y: n.y });
      expect(Math.abs(terrainApres.x - terrainAvant.x), `${id} : x terrain`).toBeLessThan(0.002);
      expect(Math.abs(terrainApres.y - terrainAvant.y), `${id} : y terrain`).toBeLessThan(0.002);
      expect(ecartCap(reperSerre.orientationDeg + n.o, (zone?.orientationDeg ?? 0) + avant.o), `${id} : cap terrain`).toBeLessThan(0.01);
    }

    await annulerDernier();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 0, 'serre retirée');
    await attendre(() => placementDe(b, PLANCHE_B).x === 2, 'planches revenues');
    expect(placementDe(b, PLANCHE_A)).toEqual({ x: 0, y: 0, o: 0 });
    expect(placementDe(b, PLANCHE_B)).toEqual({ x: 2, y: 5, o: 90 });
  });

  it('avant d’enregistrer, la planche reste au même endroit à l’écran', async () => {
    await ouvrir({
      avant: (base) => {
        manon(base);
        planche(base, PLANCHE_A, 0, 0, 0);
      },
    });
    const avant = document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${PLANCHE_A}"]`);
    const [x0, y0, o0] = [nombre(avant ?? document.body, 'data-x'), nombre(avant ?? document.body, 'data-y'), nombre(avant ?? document.body, 'data-orientation')];
    expect(x0).toBeCloseTo(99.9632, 3);
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await confirmerRemplacement();
    await attendre(() => nouveaux().length === 1, 'serre au plan');
    const apres = document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${PLANCHE_A}"]`);
    expect(nombre(apres ?? document.body, 'data-x')).toBeCloseTo(x0, 2);
    expect(nombre(apres ?? document.body, 'data-y')).toBeCloseTo(y0, 2);
    expect(ecartCap(nombre(apres ?? document.body, 'data-orientation'), o0)).toBeLessThan(0.01);
  });

  it('une planche qui tombe hors du rectangle reste placée ; la confirmation le dit : « 2 planches hors de la serre »', async () => {
    const b = await ouvrir({
      avant: (base) => {
        manon(base);
        planche(base, PLANCHE_A, 0, 0, 0);
        planche(base, PLANCHE_B, 0, 40, 0);
        planche(base, PLANCHE_C, 0, -40, 0);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(/2 planches hors de la serre/) !== undefined, 'avertissement sur 2 planches');
    await confirmerRemplacement();
    await enregistrer();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre écrite');
    await attendre(() => placementDe(b, PLANCHE_A).x !== 0, 'planches converties');
    for (const id of [PLANCHE_A, PLANCHE_B, PLANCHE_C]) expect(ligne(b, 'emplacement', id)?.placement_x_m, `${id} reste placée`).not.toBeNull();
  });

  it('aucune planche dehors : pas d’avertissement', async () => {
    await ouvrir({
      avant: (base) => {
        manon(base);
        planche(base, PLANCHE_A, 0, 0, 0);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation');
    expect(texte(confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)))).not.toMatch(/hors de la serre/);
  });
});

describe('T81 : contour inutilisable', () => {
  it('sommets alignés : la confirmation dit que la serre est posée au centre de la vue ; confirmée, elle y est, aux mesures de départ', async () => {
    const b = await ouvrir({
      avant: (base) => {
        base.recevoir('UPDATE zone SET contour = ? WHERE id = ?', [JSON.stringify([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), ZONE_TUNNEL]);
      },
    });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(/contour inutilisable, la serre est posée au centre de la vue/i) !== undefined, 'avertissement du contour inutilisable');
    await confirmerRemplacement();
    await attendre(() => nouveaux().length === 1, 'serre au plan');
    const serre = nouveaux()[0] ?? document.body;
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(30, 3);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(8, 3);
    expect(nombre(serre, 'data-orientation')).toBeCloseTo(0, 3);
    const [lat, lon] = (un(T.editeur)?.getAttribute('data-centre') ?? '0,0').split(',').map(Number);
    const centre = versLocal(POSITION, { latitude: lat ?? 0, longitude: lon ?? 0 });
    expect(Math.abs(nombre(serre, 'data-x') - centre.x)).toBeLessThan(2);
    expect(Math.abs(nombre(serre, 'data-y') - centre.y)).toBeLessThan(2);
    expect(b.placements).toEqual([]);
  });

  it('contour utilisable : pas de mention', async () => {
    await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Remplacer par une serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation');
    expect(texte(confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)))).not.toMatch(/inutilisable/i);
  });
});

// ── Au doigt (T28k) ──────────────────────────────────────────────────────────────────────────

/** m/px au zoom 19, à 44° N. */
const MPP_19 = 0.214782;

async function doigt(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    await Promise.resolve();
  });
  await unTour();
}

describe('T81 : au doigt, sur téléphone', () => {
  it('poser la serre depuis la zone, la glisser d’un doigt, la tourner à deux doigts de 30°, enregistrer : position et cap écrits', async () => {
    const b = await ouvrir({ ordinateur: false });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await creerDepuisLaFiche();
    await attendre(() => nouveaux().length === 1, 'serre posée');
    const serre = (): HTMLElement => nouveaux()[0] ?? document.body;
    expect(serre().getAttribute('aria-pressed')).toBe('true');
    const x0 = nombre(serre(), 'data-x');

    // Un doigt sur la serre choisie la déplace de 100 px vers l'est.
    await doigt(serre(), 'pointerdown', 1, 300, 300);
    for (const x of [325, 350, 375, 400]) await doigt(serre(), 'pointermove', 1, x, 300);
    await doigt(serre(), 'pointerup', 1, 400, 300);
    expect(Math.abs(nombre(serre(), 'data-x') - (x0 + 100 * MPP_19))).toBeLessThan(0.05);
    expect(b.placements, 'rien n’est écrit pendant les gestes').toEqual([]);

    // Deux doigts qui tournent de 30° : la serre tourne sur place.
    const plan = un(T.plan) ?? document.body;
    const rad = (30 * Math.PI) / 180;
    await doigt(plan, 'pointerdown', 1, 300, 300);
    await doigt(plan, 'pointerdown', 2, 400, 300);
    for (let k = 1; k <= 6; k++) {
      const t = (rad * k) / 6;
      await doigt(plan, 'pointermove', 1, 300, 300);
      await doigt(plan, 'pointermove', 2, 300 + 100 * Math.cos(t), 300 + 100 * Math.sin(t));
    }
    await doigt(plan, 'pointerup', 2, 300 + 100 * Math.cos(rad), 300 + 100 * Math.sin(rad));
    await doigt(plan, 'pointerup', 1, 300, 300);
    expect(Math.abs(nombre(serre(), 'data-orientation') - 30)).toBeLessThanOrEqual(1);

    await enregistrer();
    await attendre(() => batimentsDeLaZone(b, ZONE_TUNNEL).length === 1, 'serre écrite');
    const ecrit = batimentsDeLaZone(b, ZONE_TUNNEL)[0];
    expect(Math.abs(Number(ecrit?.centre_x_m) - (x0 + 100 * MPP_19))).toBeLessThan(0.05);
    expect(Math.abs(Number(ecrit?.orientation_deg) - 30)).toBeLessThanOrEqual(1);
    expect(ecrit?.zone_id).toBe(ZONE_TUNNEL);
  });
});
