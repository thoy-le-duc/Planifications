// @vitest-environment happy-dom
/**
 * Tests d'acceptation T88 — une serre à légumes se dessine en 18 cases (chapelles × tronçons) et « Ranger les planches »
 * range dans les cases (docs/backlog/T88-serre-en-grille-modele.md, règles 3 à 5 et critère « Test d'écran »), rendu pour de vrai
 * (happy-dom), base mémoire, vraie porte. Contrat : ./test/contrat-cases.ts (et ./test/contrat-bandes.ts pour le bouton).
 *
 * Ferme de test : celle de T86 (option `triTunnel`, avec `origine`), dont la serre « Tri-tunnel » devient la serre à légumes :
 * 128,8 × 57,6 m, centre (200 ; 60), cap 0°, 6 chapelles, 3 tronçons, allées de 4,40 m ; les trois « Manon » sont supprimées et
 * remplacées par « Zone 1 » à « Zone N ». Une planche de 38 × 0,75 m dans les zones 1, 7 et 18 (puis 19 et 20).
 *
 * Calcul à la main : case = 9,6 × 40 m ; centres de la serre en x −24 ; −14,4 ; −4,8 ; 4,8 ; 14,4 ; 24, en y −44,4 ; 0 ; 44,4. Dans la ferme
 * (serre en (200 ; 60), cap 0°) : x = 176 ; 185,6 ; 195,2 ; 204,8 ; 214,4 ; 224, y = 15,6 ; 60 ; 104,4.
 *   Zone 1  = chapelle 1, tronçon 1 → (176 ; 15,6)   — dans la serre (−24 ; −44,4)
 *   Zone 7  = chapelle 1, tronçon 2 → (176 ; 60)     — dans la serre (−24 ; 0)
 *   Zone 18 = chapelle 6, tronçon 3 → (224 ; 104,4)  — dans la serre (24 ; 44,4)
 * Une planche seule est centrée dans sa case.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { aBouton, attendre, bouton, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { BOUTONS_BANDES as B, TESTID_BANDES as TB } from './test/contrat-bandes.ts';
import { TESTID_CASES as TK } from './test/contrat-cases.ts';
import { deverrouiller } from './test/deverrouiller.ts';
import { ecrireFermePlacement, FERME, MANON, TRI_TUNNEL, UTILISATEUR, ZONE_TRI } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-30T08:00:00.000Z');
const HORO = '2026-01-01T08:00:00.000Z';

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

const zoneId = (k: number): string => `0192f0c1-28b0-7000-8000-${(0x1000 + k).toString(16).padStart(12, '0')}`;
const plancheId = (k: number): string => `0192f0c1-28b0-7000-8000-${(0x2000 + k).toString(16).padStart(12, '0')}`;

/** La serre à légumes : `n` sous-zones « Zone 1 » à « Zone n », une planche seule dans les zones de `avecPlanche`. */
function serreALegumes(n: number, avecPlanche: readonly number[] = [1, 7, 18]): (b: BaseMemoire) => void {
  return (b) => {
    b.recevoir('UPDATE batiment SET longueur_m = 128.8, largeur_m = 57.6, nb_chapelles = 6, nb_troncons = 3, largeur_allee_m = 4.4 WHERE id = ?', [TRI_TUNNEL]);
    b.recevoir(`UPDATE zone SET supprime_le = '2026-10-01T00:00:00.000Z' WHERE id IN (${MANON.map(() => '?').join(', ')})`, [...MANON]);
    for (let k = 1; k <= n; k++) {
      b.recevoir(
        "INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, 'tunnel', 384, NULL, ?, ?, NULL)",
        [zoneId(k), FERME, `Zone ${String(k)}`, ZONE_TRI, HORO, HORO],
      );
    }
    for (const k of avecPlanche) {
      b.recevoir(
        "INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du, remplace, cree_le, modifie_le) VALUES (?, ?, ?, ?, 'planche', 38, 0.75, '2020-01-01', '[]', ?, ?)",
        [plancheId(k), FERME, zoneId(k), `Z${String(k)}-1`, HORO, HORO],
      );
    }
  };
}

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
}
interface Options {
  readonly role?: 'gerant' | 'equipier';
  readonly avant?: (b: BaseMemoire) => void;
}

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, triTunnel: true, ...(o.role === undefined ? {} : { role: o.role }) });
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
const placementEnBase = (b: Banc, id: string): { x: number; y: number } | null => {
  const l = b.base.lireDirect<Ligne>('SELECT * FROM emplacement WHERE id = ?', [id])[0];
  return l?.placement_x_m == null ? null : { x: Number(l.placement_x_m), y: Number(l.placement_y_m) };
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
const planche = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${id}"]`);
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const cases = (): HTMLElement[] => tous(TK.casesSerre);
/** Les cases dans l'ordre de remplissage : tronçon par tronçon, chapelle par chapelle. */
const casesOrdonnees = (): HTMLElement[] => [...cases()].sort((a, b) => nombre(a, 'data-troncon') - nombre(b, 'data-troncon') || nombre(a, 'data-chapelle') - nombre(b, 'data-chapelle'));

async function ouvrir(o: Options = {}): Promise<Banc> {
  const b = await creerBanc(o);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
  await attendre(() => zoneChoix(ZONE_TRI) !== null, 'liste des zones affichée');
  return b;
}
async function ranger(): Promise<void> {
  const z = zoneChoix(ZONE_TRI);
  if (z === null) throw new Error('zone Tri-tunnel absente');
  await toucher(z);
  await toucher(bouton(B.ranger));
  await attendre(() => planche(plancheId(1)) !== null, 'planches rangées');
}

describe('T88 : la serre à légumes se dessine en 18 cases', () => {
  it('18 sous-zones : 18 cases nommées « Zone 1 » à « Zone 18 », tronçon par tronçon, et aucune bande', async () => {
    await ouvrir({ avant: serreALegumes(18) });
    await attendre(() => cases().length === 18, '18 cases');
    expect(casesOrdonnees().map((el) => texte(el))).toEqual(Array.from({ length: 18 }, (_, i) => `Zone ${String(i + 1)}`));
    expect(casesOrdonnees().map((el) => el.getAttribute('data-id'))).toEqual(Array.from({ length: 18 }, (_, i) => zoneId(i + 1)));
    expect(casesOrdonnees().map((el) => [nombre(el, 'data-chapelle'), nombre(el, 'data-troncon')])).toEqual(
      Array.from({ length: 18 }, (_, i): [number, number] => [(i % 6) + 1, Math.floor(i / 6) + 1]),
    );
    expect(tous(TB.bande)).toHaveLength(0);
    expect(cases().every((el) => el.getAttribute('data-vide') === 'false')).toBe(true);
  });

  it('chaque case fait 9,6 × 40 m ; centres de la ferme : x 176 à 224, y 15,6 ; 60 ; 104,4', async () => {
    await ouvrir({ avant: serreALegumes(18) });
    await attendre(() => cases().length === 18, '18 cases');
    expect(new Set(cases().map((el) => nombre(el, 'data-largeur')))).toEqual(new Set([9.6]));
    expect(new Set(cases().map((el) => nombre(el, 'data-longueur')))).toEqual(new Set([40]));
    const xs = [...new Set(cases().map((el) => nombre(el, 'data-x')))].sort((a, b) => a - b);
    const ys = [...new Set(cases().map((el) => nombre(el, 'data-y')))].sort((a, b) => a - b);
    xs.forEach((x, i) => {
      expect(x).toBeCloseTo([176, 185.6, 195.2, 204.8, 214.4, 224][i] ?? Number.NaN, 3);
    });
    ys.forEach((y, i) => {
      expect(y).toBeCloseTo([15.6, 60, 104.4][i] ?? Number.NaN, 3);
    });
    expect(xs).toHaveLength(6);
    expect(ys).toHaveLength(3);
  });

  it('chaque case a son contour dessiné (zone-contour de la sous-zone) ; la zone abritée n’a pas le sien', async () => {
    await ouvrir({ avant: serreALegumes(18) });
    await attendre(() => cases().length === 18, '18 cases');
    const contours = tous('zone-contour').map((el) => el.getAttribute('data-id'));
    for (let k = 1; k <= 18; k++) expect(contours).toContain(zoneId(k));
    expect(contours).not.toContain(ZONE_TRI);
  });

  it('16 sous-zones : 18 cases, les deux dernières (chapelles 5 et 6 du tronçon 3) dessinées vides', async () => {
    await ouvrir({ avant: serreALegumes(16, [1]) });
    await attendre(() => cases().length === 18, '18 cases');
    const vides = casesOrdonnees().filter((el) => el.getAttribute('data-vide') === 'true');
    expect(vides.map((el) => [nombre(el, 'data-chapelle'), nombre(el, 'data-troncon'), texte(el)])).toEqual([[5, 3, ''], [6, 3, '']]);
    expect(un(TK.avertissementSerre)).toBeNull();
  });

  it('20 sous-zones : 18 cases, les zones 19 et 20 n’ont pas de case, avertissement « 2 zones n’ont pas de place dans la serre »', async () => {
    await ouvrir({ avant: serreALegumes(20, [1, 19]) });
    await attendre(() => cases().length === 18, '18 cases');
    expect(cases().map((el) => texte(el))).not.toContain('Zone 19');
    expect(cases().map((el) => texte(el))).not.toContain('Zone 20');
    expect(texte(un(TK.avertissementSerre))).toMatch(/2 zones n.ont pas de place dans la serre/);
  });

  it('colonnes nulles (serre de T86, trois sous-zones) : toujours trois bandes, aucune case', async () => {
    await ouvrir();
    await attendre(() => tous(TB.bande).length === 3, 'trois bandes');
    expect(cases()).toHaveLength(0);
    expect(un(TK.avertissementSerre)).toBeNull();
  });

  it('équipier (lecture seule) : les cases sont là aussi, sans bouton de rangement', async () => {
    await ouvrir({ role: 'equipier', avant: serreALegumes(18) });
    await attendre(() => cases().length === 18, '18 cases');
    const z = zoneChoix(ZONE_TRI);
    if (z === null) throw new Error('zone absente');
    await toucher(z);
    expect(aBouton(B.ranger)).toBe(false);
  });
});

describe('T88 : « Ranger les planches dans les bandes » range dans les cases', () => {
  const ATTENDU: readonly (readonly [number, number, number])[] = [
    [1, 176, 15.6],
    [7, 176, 60],
    [18, 224, 104.4],
  ];
  const ATTENDU_SERRE: readonly (readonly [number, number, number])[] = [
    [1, -24, -44.4],
    [7, -24, 0],
    [18, 24, 44.4],
  ];

  it('au brouillon : chaque planche au centre de sa case (zone 1, zone 7, zone 18), rien d’écrit', async () => {
    const b = await ouvrir({ avant: serreALegumes(18) });
    await attendre(() => cases().length === 18, '18 cases');
    await ranger();
    for (const [k, x, y] of ATTENDU) {
      const p = planche(plancheId(k));
      expect(p, `planche de la zone ${String(k)}`).not.toBeNull();
      if (p === null) continue;
      expect(nombre(p, 'data-x'), `x zone ${String(k)}`).toBeCloseTo(x, 3);
      expect(nombre(p, 'data-y'), `y zone ${String(k)}`).toBeCloseTo(y, 3);
    }
    expect(b.placements).toHaveLength(0);
  });

  it('« Enregistrer » : UN appel, un placement par planche, dans le repère de la serre', async () => {
    const b = await ouvrir({ avant: serreALegumes(18) });
    await ranger();
    await toucher(bouton('Enregistrer'));
    await unTour();
    await attendre(() => placementEnBase(b, plancheId(18)) !== null, 'placements écrits');
    expect(b.placements).toHaveLength(1);
    for (const [k, x, y] of ATTENDU_SERRE) {
      const p = placementEnBase(b, plancheId(k));
      expect(p?.x, `x zone ${String(k)}`).toBeCloseTo(x, 3);
      expect(p?.y, `y zone ${String(k)}`).toBeCloseTo(y, 3);
    }
  });

  it('« Annuler » remet toutes les planches non placées', async () => {
    const b = await ouvrir({ avant: serreALegumes(18) });
    await ranger();
    await toucher(bouton('Enregistrer'));
    await unTour();
    await attendre(() => placementEnBase(b, plancheId(18)) !== null, 'placements écrits');
    await attendre(() => un(T.annuler) !== null, '« Annuler »');
    const a = un(T.annuler);
    if (a !== null) await toucher(a);
    await attendre(() => placementEnBase(b, plancheId(18)) === null, 'placements retirés');
    for (const k of [1, 7, 18]) expect(placementEnBase(b, plancheId(k)), `zone ${String(k)}`).toBeNull();
  });

  it('la planche d’une zone sans case (zone 19 sur 20) n’est pas rangée, les autres le sont', async () => {
    const b = await ouvrir({ avant: serreALegumes(20, [1, 19]) });
    await attendre(() => cases().length === 18, '18 cases');
    await ranger();
    expect(planche(plancheId(19))).toBeNull();
    await toucher(bouton('Enregistrer'));
    await unTour();
    await attendre(() => placementEnBase(b, plancheId(1)) !== null, 'placements écrits');
    expect(placementEnBase(b, plancheId(19))).toBeNull();
  });
});
