// @vitest-environment happy-dom
/**
 * Tests d'acceptation T86 — les sous-zones d'une serre se dessinent en bandes et leurs planches s'y rangent
 * (docs/backlog/T86-sous-zones-dans-serre.md), rendu pour de vrai (happy-dom), base mémoire, vraie porte.
 * Contrat : ./test/contrat-bandes.ts.
 *
 * Ferme de test (option `triTunnel`, avec `origine`) : « Tri-tunnel » (zone tunnel) abritée par la serre « Tri-tunnel »
 * 40 × 28,8 m, centre (200 ; 60), cap 0°, avec « Manon 1 » (2 planches), « Manon 2 » (4 planches), « Manon 3 » (1 planche),
 * toutes de 38 × 0,75 m, non placées ; et une planche « T-1 » rattachée à la zone Tri-tunnel elle-même.
 *
 * Calcul à la main (passe-pied 45 cm), bandes de 28,8 / 3 = 9,6 m, centres à x = 190,4 ; 200 ; 209,6 m, y = 60 :
 *   Manon 1 : bloc de 2 × 0,75 + 0,45 = 1,95 m, centres à 190,4 ∓ 0,6 = 189,8 et 191 m ;
 *   Manon 2 : bloc de 4,35 m, centres à 198,2 ; 199,4 ; 200,6 ; 201,8 m ;
 *   Manon 3 : une planche au centre de la bande, 209,6 m.
 * Dans le repère de la serre (ce que la base garde) : x = −10,2 ; −9 / −1,8 ; −0,6 ; 0,6 ; 1,8 / 9,6, y = 0, cap 0°.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { aBouton, attendre, bouton, champ, desactive, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { BOUTONS_BANDES as B, CHAMPS_BANDES as C, PASSE_PIED_DEPART_CM, TESTID_BANDES as TB } from './test/contrat-bandes.ts';
import { DIRECTE, ecrireFermePlacement, FERME, MANON, MANON_PLANCHES, UTILISATEUR, ZONE_TRI } from './test/ferme-placement.ts';

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
const ligne = (b: Banc, table: string, id: string): Ligne | undefined => b.base.lireDirect<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];
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
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const planche = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.planche}"][data-id="${id}"]`);
const bandes = (): HTMLElement[] => tous(TB.bande);

async function ouvrir(o: Options = {}): Promise<Banc> {
  const b = await creerBanc(o);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await attendre(() => zoneChoix(ZONE_TRI) !== null, 'liste des zones affichée');
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
async function ranger(): Promise<void> {
  await choisirZone(ZONE_TRI);
  await toucher(bouton(B.ranger));
  await attendre(() => planche(MANON_PLANCHES[1][0]) !== null, 'planches rangées');
}

const TOUTES = MANON_PLANCHES.flat();
const ATTENDU: readonly (readonly [string, number])[] = [
  [MANON_PLANCHES[0][0], 189.8],
  [MANON_PLANCHES[0][1], 191],
  [MANON_PLANCHES[1][0], 198.2],
  [MANON_PLANCHES[1][1], 199.4],
  [MANON_PLANCHES[1][2], 200.6],
  [MANON_PLANCHES[1][3], 201.8],
  [MANON_PLANCHES[2][0], 209.6],
];
const ATTENDU_SERRE: readonly (readonly [string, number])[] = [
  [MANON_PLANCHES[0][0], -10.2],
  [MANON_PLANCHES[0][1], -9],
  [MANON_PLANCHES[1][0], -1.8],
  [MANON_PLANCHES[1][1], -0.6],
  [MANON_PLANCHES[1][2], 0.6],
  [MANON_PLANCHES[1][3], 1.8],
  [MANON_PLANCHES[2][0], 9.6],
];

describe('T86 : une serre découpée en bandes', () => {
  it('trois sous-zones : trois bandes nommées, de 40 × 9,6 m, côte à côte dans l’ordre des noms', async () => {
    await ouvrir();
    await attendre(() => bandes().length === 3, 'trois bandes');
    const liste = bandes();
    expect(liste.map((el) => texte(el))).toEqual(['Manon 1', 'Manon 2', 'Manon 3']);
    expect(liste.map((el) => el.getAttribute('data-id'))).toEqual([...MANON]);
    expect(liste.map((el) => [nombre(el, 'data-rang'), nombre(el, 'data-total')])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(liste.map((el) => nombre(el, 'data-longueur'))).toEqual([40, 40, 40]);
    expect(liste.map((el) => nombre(el, 'data-largeur'))).toEqual([9.6, 9.6, 9.6]);
    expect(liste.map((el) => nombre(el, 'data-x'))).toEqual([190.4, 200, 209.6]);
    expect(liste.map((el) => nombre(el, 'data-y'))).toEqual([60, 60, 60]);
  });

  it('chaque bande a son contour dessiné (zone-contour de la sous-zone) ; la zone abritée n’a pas le sien', async () => {
    await ouvrir();
    await attendre(() => bandes().length === 3, 'trois bandes');
    const contours = tous('zone-contour').map((el) => el.getAttribute('data-id'));
    for (const id of MANON) expect(contours).toContain(id);
    expect(contours).not.toContain(ZONE_TRI);
  });

  it('toucher une bande choisit la sous-zone : son panneau dit « Dans la serre Tri-tunnel, bande 2 sur 3 »', async () => {
    await ouvrir();
    await attendre(() => bandes().length === 3, 'trois bandes');
    const deux = bandes()[1];
    if (deux === undefined) throw new Error('bande 2 absente');
    await toucher(deux);
    await attendre(() => texte(panneau()).includes('Manon 2'), 'panneau de Manon 2');
    expect(texte(panneau())).toContain('Dans la serre Tri-tunnel, bande 2 sur 3');
  });

  it('équipier (lecture seule) : les bandes sont là aussi, sans bouton de rangement', async () => {
    await ouvrir({ role: 'equipier' });
    await attendre(() => bandes().length === 3, 'trois bandes');
    await choisirZone(ZONE_TRI);
    expect(aBouton(B.ranger)).toBe(false);
  });

  it('une sous-zone supprimée n’a pas de bande : deux bandes de 14,4 m', async () => {
    await ouvrir({ avant: (b) => { b.recevoir("UPDATE zone SET supprime_le = '2026-10-01T00:00:00.000Z' WHERE id = ?", [MANON[2]]); } });
    await attendre(() => bandes().length === 2, 'deux bandes');
    expect(bandes().map((el) => nombre(el, 'data-largeur'))).toEqual([14.4, 14.4]);
  });

  it('une zone non abritée avec des sous-zones : pas de bande', async () => {
    await ouvrir({ avant: (b) => { b.recevoir('UPDATE batiment SET zone_id = NULL WHERE zone_id = ?', [ZONE_TRI]); } });
    await attendre(() => zoneChoix(MANON[0]) !== null, 'liste des zones');
    expect(bandes()).toHaveLength(0);
  });
});

describe('T86 : une sous-zone d’une zone abritée', () => {
  it('ni « Tracer le contour », ni « Dessiner depuis les planches », ni « Placer la serre », ni « Ranger… »', async () => {
    await ouvrir();
    await choisirZone(MANON[1]);
    await attendre(() => texte(panneau()).includes('bande 2 sur 3'), 'panneau de la bande');
    expect(aBouton('Tracer le contour')).toBe(false);
    expect(aBouton('Dessiner depuis les planches')).toBe(false);
    expect(aBouton('Placer la serre')).toBe(false);
    expect(aBouton(B.ranger)).toBe(false);
  });
});

describe('T86 : « Ranger les planches dans les bandes »', () => {
  it('proposé sur la zone abritée, passe-pied à 45, avant tout rien n’est placé', async () => {
    await ouvrir();
    await choisirZone(ZONE_TRI);
    expect(desactive(bouton(B.ranger))).toBe(false);
    expect(champ(C.passePied, panneau()).value).toBe(String(PASSE_PIED_DEPART_CM));
    for (const id of TOUTES) expect(planche(id), `planche ${id}`).toBeNull();
  });

  it('au brouillon : chaque planche dans sa bande, aux centres calculés à la main, rien d’écrit', async () => {
    const b = await ouvrir();
    await ranger();
    for (const [id, x] of ATTENDU) {
      const p = planche(id);
      expect(p, `planche ${id}`).not.toBeNull();
      if (p === null) continue;
      expect(nombre(p, 'data-x'), `x de ${id}`).toBeCloseTo(x, 3);
      expect(nombre(p, 'data-y'), `y de ${id}`).toBeCloseTo(60, 3);
      expect(nombre(p, 'data-longueur')).toBe(38);
    }
    // La planche rattachée à la zone elle-même garde son rangement (aucune place).
    expect(planche(DIRECTE)).toBeNull();
    expect(b.placements).toHaveLength(0);
    for (const id of TOUTES) expect(placementEnBase(b, id)).toBeNull();
  });

  it('passe-pied 100 cm : le bloc de Manon 2 fait 6 m, planches de 197,375 à 202,625 m', async () => {
    await ouvrir();
    await choisirZone(ZONE_TRI);
    await remplir(champ(C.passePied, panneau()), '100');
    await toucher(bouton(B.ranger));
    await attendre(() => planche(MANON_PLANCHES[1][0]) !== null, 'planches rangées');
    // bloc = 4 × 0,75 + 3 × 1 = 6 m ; bord ouest à 197 ; centres 197,375 ; 199,125 ; 200,875 ; 202,625
    const xs = MANON_PLANCHES[1].map((id) => nombre(planche(id) ?? document.body, 'data-x'));
    expect(xs[0]).toBeCloseTo(197.375, 3);
    expect(xs[3]).toBeCloseTo(202.625, 3);
  });

  it('passe-pied invalide (501) : bouton désactivé avec sa raison', async () => {
    await ouvrir();
    await choisirZone(ZONE_TRI);
    await remplir(champ(C.passePied, panneau()), '501');
    expect(desactive(bouton(B.ranger))).toBe(true);
    expect(texte(panneau())).toMatch(/passe-pied/i);
  });

  it('« Enregistrer » : UN appel à porte.placer, un placement par emplacement rangé, dans le repère de la serre', async () => {
    const b = await ouvrir();
    await ranger();
    await enregistrer();
    await attendre(() => placementEnBase(b, MANON_PLANCHES[1][0]) !== null, 'placements écrits');
    expect(b.placements).toHaveLength(1);
    const appel = b.placements[0] ?? [];
    expect(appel.every((c) => c.sorte === 'emplacement')).toBe(true);
    expect(appel.flatMap((c) => (c.sorte === 'emplacement' ? [c.id] : [])).sort()).toEqual([...TOUTES].sort());
    for (const [id, x] of ATTENDU_SERRE) {
      const p = placementEnBase(b, id);
      expect(p, `planche ${id}`).not.toBeNull();
      if (p === null) continue;
      expect(p.x, `x de ${id}`).toBeCloseTo(x, 3);
      expect(p.y, `y de ${id}`).toBeCloseTo(0, 3);
      expect(Math.min(p.o % 360, 360 - (p.o % 360))).toBeCloseTo(0, 2);
    }
    expect(placementEnBase(b, DIRECTE)).toBeNull();
  });

  it('« Annuler » remet toutes les planches non placées', async () => {
    const b = await ouvrir();
    await ranger();
    await enregistrer();
    await attendre(() => placementEnBase(b, MANON_PLANCHES[1][0]) !== null, 'placements écrits');
    await annulerDernier();
    await attendre(() => placementEnBase(b, MANON_PLANCHES[1][0]) === null, 'placements retirés');
    for (const id of TOUTES) expect(placementEnBase(b, id), `planche ${id}`).toBeNull();
  });

  it('« Abandonner les changements » : plus de planche rangée, rien d’écrit', async () => {
    const b = await ouvrir();
    await ranger();
    await toucher(bouton('Abandonner les changements'));
    await attendre(() => planche(MANON_PLANCHES[1][0]) === null, 'planches retirées');
    expect(b.placements).toHaveLength(0);
  });

  it('une planche déjà placée de la sous-zone est rangée aussi, dans le même appel', async () => {
    const b = await ouvrir({
      avant: (base) => { base.recevoir("UPDATE emplacement SET placement_x_m = 3, placement_y_m = 4, orientation_deg = 10 WHERE id = ?", [MANON_PLANCHES[1][0]]); },
    });
    await ranger();
    await enregistrer();
    await attendre(() => placementEnBase(b, MANON_PLANCHES[1][1]) !== null, 'placements écrits');
    const p = placementEnBase(b, MANON_PLANCHES[1][0]);
    expect(p?.x).toBeCloseTo(-1.8, 3);
    expect(p?.y).toBeCloseTo(0, 3);
    expect(b.placements).toHaveLength(1);
  });

  it('les planches suivent la serre : la déplacer au clavier déplace les bandes et les planches du même vecteur', async () => {
    await ouvrir();
    await ranger();
    const avant = nombre(planche(MANON_PLANCHES[1][0]) ?? document.body, 'data-x');
    const serre = document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][aria-label^="Tri-tunnel"]`);
    if (serre === null) throw new Error('serre absente');
    await act(async () => {
      serre.focus();
      serre.dispatchEvent(new FocusEvent('focus'));
      await Promise.resolve();
    });
    await act(async () => {
      serre.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await unTour();
    expect(nombre(planche(MANON_PLANCHES[1][0]) ?? document.body, 'data-x')).toBeCloseTo(avant + 1, 3);
    expect(nombre(bandes()[1] ?? document.body, 'data-x')).toBeCloseTo(201, 3);
  });
});

describe('T86 : planches qui dépassent de la bande', () => {
  const NEUF = (base: BaseMemoire): void => {
    for (let k = 5; k <= 9; k++) {
      base.recevoir(
        "INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du, remplace, cree_le, modifie_le) VALUES (?, ?, ?, ?, 'planche', 38, 0.75, '2020-01-01', '[]', '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z')",
        [`0192f0c1-28b0-7000-8000-0000000009${String(k)}0`, FERME, MANON[1], `M2-${String(k)}`],
      );
    }
  };

  it('9 planches dans Manon 2 : « Manon 2 : 2 planches dépassent de la bande », sans bloquer « Enregistrer »', async () => {
    const b = await ouvrir({ avant: NEUF });
    await choisirZone(ZONE_TRI);
    await toucher(bouton(B.ranger));
    await attendre(() => un(TB.avertissement) !== null, 'avertissement');
    expect(texte(un(TB.avertissement))).toContain('Manon 2 : 2 planches dépassent de la bande');
    expect(texte(un(TB.avertissement))).not.toContain('Manon 1');
    expect(desactive(bouton('Enregistrer'))).toBe(false);
    await enregistrer();
    await attendre(() => b.placements.length === 1, 'enregistré');
    expect(b.placements[0]?.length).toBe(TOUTES.length + 5);
  });

  it('rien ne dépasse : pas d’avertissement', async () => {
    await ouvrir();
    await ranger();
    expect(un(TB.avertissement)).toBeNull();
  });
});

describe('T86 : sous-zone dotée d’un contour tracé à la main', () => {
  const CONTOUR = JSON.stringify([
    { x: 5000, y: 0 },
    { x: 5010, y: 0 },
    { x: 5010, y: 30 },
    { x: 5000, y: 30 },
  ]);
  const avecContour = (base: BaseMemoire): void => {
    base.recevoir('UPDATE zone SET contour = ? WHERE id = ?', [CONTOUR, MANON[1]]);
  };

  it('son contour est ignoré à l’affichage : la bande occupe la serre, pas le rectangle tracé', async () => {
    await ouvrir({ avant: avecContour });
    await attendre(() => bandes().length === 3, 'trois bandes');
    expect(nombre(bandes()[1] ?? document.body, 'data-x')).toBe(200);
    await choisirZone(MANON[1]);
    expect(tous(TC.sommet)).toHaveLength(0);
  });

  it('« Ranger… » demande d’abord s’il faut effacer le contour ; « Effacer et ranger » l’efface dans le même appel', async () => {
    const b = await ouvrir({ avant: avecContour });
    await choisirZone(ZONE_TRI);
    await toucher(bouton(B.ranger));
    await attendre(() => aBouton(B.effacerEtRanger), 'confirmation');
    expect(texte(panneau())).toContain('Manon 2');
    expect(planche(MANON_PLANCHES[1][0])).toBeNull();
    await toucher(bouton(B.effacerEtRanger));
    await attendre(() => planche(MANON_PLANCHES[1][0]) !== null, 'planches rangées');
    await enregistrer();
    await attendre(() => ligne(b, 'zone', MANON[1])?.contour === null, 'contour effacé');
    expect(b.placements).toHaveLength(1);
    expect((b.placements[0] ?? []).filter((c) => c.sorte === 'zone').map((c) => c.id)).toEqual([MANON[1]]);
    expect(placementEnBase(b, MANON_PLANCHES[1][0])?.x).toBeCloseTo(-1.8, 3);
  });

  it('« Ranger sans effacer » range sans toucher au contour', async () => {
    const b = await ouvrir({ avant: avecContour });
    await choisirZone(ZONE_TRI);
    await toucher(bouton(B.ranger));
    await toucher(bouton(B.rangerSansEffacer));
    await attendre(() => planche(MANON_PLANCHES[1][0]) !== null, 'planches rangées');
    await enregistrer();
    await attendre(() => placementEnBase(b, MANON_PLANCHES[1][0]) !== null, 'placements écrits');
    expect((b.placements[0] ?? []).some((c) => c.sorte === 'zone')).toBe(false);
    expect(ligne(b, 'zone', MANON[1])?.contour).toBe(CONTOUR);
  });

  it('« Annuler » après « Effacer et ranger » remet le contour', async () => {
    const b = await ouvrir({ avant: avecContour });
    await choisirZone(ZONE_TRI);
    await toucher(bouton(B.ranger));
    await toucher(bouton(B.effacerEtRanger));
    await attendre(() => planche(MANON_PLANCHES[1][0]) !== null, 'planches rangées');
    await enregistrer();
    await attendre(() => ligne(b, 'zone', MANON[1])?.contour === null, 'contour effacé');
    await annulerDernier();
    await attendre(() => ligne(b, 'zone', MANON[1])?.contour === CONTOUR, 'contour remis');
    expect(placementEnBase(b, MANON_PLANCHES[1][0])).toBeNull();
  });
});
