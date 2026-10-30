// @vitest-environment happy-dom
/**
 * Tests d'acceptation T90 — dupliquer une serre ou une parcelle, avec ses zones et ses planches (docs/backlog/T90-dupliquer.md,
 * règles 1 à 4, critères d'acceptation 2 et 3), rendu pour de vrai (happy-dom), base mémoire, vraie porte. Contrat de l'écran :
 * ./test/contrat-dupliquer.ts ; du cœur (noms, positions) : packages/core/src/placement/duplication.test.ts.
 *
 * Tunnel de test (créé par la fiche de T89, puis enregistré) : « Tunnel Manon », préfixe « Manon », 3 chapelles de 9,6 m (28,8 × 40 m), donc 3 sous-zones
 * « Manon 1 » à « Manon 3 » de 8 planches chacune (P1…P8) : 1 + 3 zones, 24 planches, 1 bâtiment. Une copie crée donc 4 zones + 24 planches + 1 bâtiment
 * = 29 changements. Noms attendus de la première copie : « Tunnel Manon 2 », puis « Manon 4 », « Manon 5 », « Manon 6 » (2 et 3 existent).
 * Parcelle de test : « Plein champ » (ZONE_CHAMP), contour 40 × 30 m (cap 90° : son côté x positif est le sud), planche PC-01 ; copie à 30 + 1,5 m au sud.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { aBouton, attendre, bouton, champ, desactive, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { BOUTONS_SERRE as B, CHAMPS_SERRE as C, TESTID_SERRE as TS } from './test/contrat-serre.ts';
import { BOUTONS_DUPLICATION as BD, CHAMPS_DUPLICATION as CD, TESTID_DUPLICATION as TD } from './test/contrat-dupliquer.ts';
import { deverrouiller } from './test/deverrouiller.ts';
import { ecrireFermePlacement, FERME, HANGAR, MANON, SERRE, UTILISATEUR, ZONE_CHAMP, PLANCHE } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-30T08:00:00.000Z');

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
  readonly triTunnel?: boolean;
}
type Ligne = Readonly<Record<string, string | number | null>>;
type Appel = readonly { readonly sorte: string; readonly id: string; readonly valeurs?: Record<string, unknown>; readonly contour?: unknown }[];

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, ...(o.triTunnel === true ? { triTunnel: true } : {}), ...(o.role === undefined ? {} : { role: o.role }) });
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

const lignes = (b: Banc, sql: string, p: readonly unknown[] = []): Ligne[] => b.base.lireDirect<Ligne>(sql, p);
const compte = (b: Banc, sql: string, p: readonly unknown[] = []): number => Number(lignes(b, sql, p)[0]?.n ?? -1);
const zonesVivantes = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM zone WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const emplacementsVivants = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const batimentsVivants = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM batiment WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const sortes = (appel: Appel, sorte: string): Appel => appel.filter((c) => c.sorte === sorte);

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

const banc = (): Banc => {
  if (bancCourant === null) throw new Error('banc absent');
  return bancCourant;
};
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const zoneChoix = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${id}"]`);
const batiment = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${id}"]`);
const panneau = (): HTMLElement => {
  const p = un(T.panneau);
  if (p === null) throw new Error('panneau-placement absent');
  return p;
};
const fiche = (): HTMLElement => {
  const f = un(TD.fiche);
  expect(f, 'la fiche « Dupliquer » est ouverte').not.toBeNull();
  if (f === null) throw new Error('fiche absente');
  return f;
};
const aOuvrir = (): boolean => aBouton(BD.dupliquer, panneau());
const valeur = (nom: string): number => Number(champ(nom, fiche()).value);
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));

async function ouvrir(o: Options = {}): Promise<Banc> {
  const b = await creerBanc(o);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  if (o.role !== 'equipier') await deverrouiller();
  await attendre(() => zoneChoix(ZONE_CHAMP) !== null, 'liste des zones affichée');
  return b;
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
async function choisirZone(id: string): Promise<void> {
  const z = zoneChoix(id);
  if (z === null) throw new Error(`zone ${id} absente de la liste`);
  await toucher(z);
}
async function enregistrer(): Promise<void> {
  await toucher(bouton(B.enregistrer));
  await unTour();
}
async function annulerDernier(): Promise<void> {
  await attendre(() => un(T.annuler) !== null, '« Annuler » après l’enregistrement');
  const a = un(T.annuler);
  if (a !== null) await toucher(a);
}

/** Crée « Tunnel Manon » par la fiche de T89 et l'enregistre : 4 zones, 24 planches, 1 bâtiment. */
async function creerTunnel(): Promise<{ readonly b: Banc; readonly serreId: string }> {
  const b = await ouvrir();
  await toucher(bouton(B.ajouter));
  await toucher(bouton(B.serreOuTunnel));
  await attendre(() => un(TS.fiche) !== null, 'fiche « Serre ou tunnel »');
  const f = un(TS.fiche) ?? document.body;
  await remplir(champ(C.nom, f), 'Tunnel Manon');
  await remplir(champ(C.prefixe, f), 'Manon');
  await remplir(champ(C.nbChapelles, f), '3');
  await remplir(champ(C.nbPlanches, f), '8');
  await toucher(bouton(B.creer, f));
  await enregistrer();
  await attendre(() => b.placements.length === 1 && batimentsVivants(b) === 3, 'tunnel écrit');
  const serreId = String(lignes(b, "SELECT id FROM batiment WHERE nom = 'Tunnel Manon' AND supprime_le IS NULL")[0]?.id);
  return { b, serreId };
}
async function choisirTunnel(serreId: string): Promise<void> {
  await attendre(() => batiment(serreId) !== null, 'tunnel affiché');
  await selectionner(batiment(serreId) ?? document.body);
}
async function ouvrirLaFiche(): Promise<void> {
  await toucher(bouton(BD.dupliquer, panneau()));
  await attendre(() => un(TD.fiche) !== null, 'fiche « Dupliquer »');
}
async function dupliquer(copies?: string, ecart?: string): Promise<void> {
  await ouvrirLaFiche();
  if (copies !== undefined) await remplir(champ(CD.nombre, fiche()), copies);
  if (ecart !== undefined) await remplir(champ(CD.ecart, fiche()), ecart);
  await toucher(bouton(BD.dupliquer, fiche()));
  expect(un(TD.fiche), 'la fiche se ferme').toBeNull();
}
const brouillon = (): number[] => {
  const el = un(TS.brouillon);
  return el === null ? [] : ['data-batiments', 'data-zones', 'data-sous-zones', 'data-emplacements'].map((a) => nombre(el, a));
};
const centre = (b: Banc, nom: string): { x: number; y: number; cap: number } => {
  const l = lignes(b, 'SELECT centre_x_m AS x, centre_y_m AS y, orientation_deg AS cap FROM batiment WHERE nom = ? AND supprime_le IS NULL', [nom])[0];
  return { x: Number(l?.x), y: Number(l?.y), cap: Number(l?.cap) };
};

describe('T90 : le bouton « Dupliquer » (règle 1)', () => {
  it('une serre choisie sur le plan : « Dupliquer » est proposé', async () => {
    const { serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    expect(aOuvrir()).toBe(true);
  });

  it('la zone abritée par la serre, choisie dans la liste : « Dupliquer » est proposé', async () => {
    await creerTunnel();
    const racineZone = String(lignes(banc(), "SELECT id FROM zone WHERE nom = 'Tunnel Manon' AND supprime_le IS NULL")[0]?.id);
    await attendre(() => zoneChoix(racineZone) !== null, 'zone dans la liste');
    await choisirZone(racineZone);
    expect(aOuvrir()).toBe(true);
  });

  it('une zone de plein champ avec contour : « Dupliquer » est proposé', async () => {
    await ouvrir();
    await choisirZone(ZONE_CHAMP);
    expect(aOuvrir()).toBe(true);
  });

  it('un hangar : pas de « Dupliquer »', async () => {
    await ouvrir();
    await selectionner(batiment(HANGAR) ?? document.body);
    expect(batiment(HANGAR)?.getAttribute('aria-pressed')).toBe('true');
    expect(aOuvrir()).toBe(false);
  });

  it('une serre qui n’abrite aucune zone (« Serre M1 ») : pas de « Dupliquer »', async () => {
    await ouvrir();
    await selectionner(batiment(SERRE) ?? document.body);
    expect(batiment(SERRE)?.getAttribute('aria-pressed')).toBe('true');
    expect(aOuvrir()).toBe(false);
  });

  it('une sous-zone qui est une bande de serre (« Manon 1 ») : pas de « Dupliquer »', async () => {
    await ouvrir({ triTunnel: true });
    await choisirZone(MANON[0]);
    expect(aOuvrir()).toBe(false);
  });

  it('une zone sans contour (« Tunnel 1 ») : pas de « Dupliquer »', async () => {
    await ouvrir();
    const tunnel = lignes(banc(), "SELECT id FROM zone WHERE nom = 'Tunnel 1'")[0];
    await choisirZone(String(tunnel?.id));
    expect(aOuvrir()).toBe(false);
  });

  it('équipier (lecture seule) : pas de « Dupliquer »', async () => {
    await ouvrir({ role: 'equipier' });
    await choisirZone(ZONE_CHAMP);
    expect(aOuvrir()).toBe(false);
  });

  it('la fiche propose 1 copie et 1,5 m d’écart ; « Annuler » la ferme sans rien changer', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await ouvrirLaFiche();
    expect(valeur(CD.nombre)).toBe(1);
    expect(valeur(CD.ecart)).toBe(1.5);
    expect(texte(un(TD.resume))).toContain('1 copie');
    await toucher(bouton(BD.annuler, fiche()));
    expect(un(TD.fiche)).toBeNull();
    expect(un(TS.brouillon)).toBeNull();
    expect(b.placements).toHaveLength(1);
  });
});

describe('T90 : dupliquer un tunnel découpé en 3 zones de 8 planches (critère 2)', () => {
  it('une copie au brouillon : 1 bâtiment, 1 zone, 3 sous-zones, 24 planches ; rien d’écrit', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    expect(brouillon()).toEqual([1, 1, 3, 24]);
    expect(b.placements, 'dupliquer n’écrit rien').toHaveLength(1);
    expect(batimentsVivants(b)).toBe(3);
  });

  it('« Enregistrer » : UN seul enregistrement de 29 changements : 4 zone_creation, 24 emplacement_creation, 1 bâtiment', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await enregistrer();
    await attendre(() => b.placements.length === 2 && batimentsVivants(b) === 4, 'copie écrite');
    const appel = (b.placements[1] ?? []) as Appel;
    expect(appel).toHaveLength(29);
    expect(sortes(appel, 'zone_creation')).toHaveLength(4);
    expect(sortes(appel, 'emplacement_creation')).toHaveLength(24);
    expect(sortes(appel, 'batiment')).toHaveLength(1);
    expect(zonesVivantes(b)).toBe(2 + 4 + 4);
    expect(emplacementsVivants(b)).toBe(1 + 48);
  });

  it('noms : « Tunnel Manon 2 » pour la serre et sa zone, « Manon 4 » à « Manon 6 » pour les sous-zones (2 et 3 existent)', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 4, 'copie écrite');
    const copie = lignes(b, "SELECT * FROM batiment WHERE nom = 'Tunnel Manon 2' AND supprime_le IS NULL");
    expect(copie).toHaveLength(1);
    const zone = lignes(b, "SELECT * FROM zone WHERE nom = 'Tunnel Manon 2' AND supprime_le IS NULL");
    expect(zone).toHaveLength(1);
    expect(copie[0]?.zone_id).toBe(zone[0]?.id);
    const sous = lignes(b, 'SELECT nom FROM zone WHERE zone_parente_id = ? AND supprime_le IS NULL', [String(zone[0]?.id)]);
    expect(sous.map((z) => z.nom).sort()).toEqual(['Manon 4', 'Manon 5', 'Manon 6']);
  });

  it('la copie reprend tout : dimensions, grille, type, zone, hauteur, cap ; 8 planches P1…P8 par sous-zone, aux mêmes places que l’original', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 4, 'copie écrite');
    const [original, copie] = [
      lignes(b, "SELECT * FROM batiment WHERE nom = 'Tunnel Manon' AND supprime_le IS NULL")[0],
      lignes(b, "SELECT * FROM batiment WHERE nom = 'Tunnel Manon 2' AND supprime_le IS NULL")[0],
    ];
    for (const c of ['type', 'longueur_m', 'largeur_m', 'hauteur_m', 'orientation_deg', 'nb_chapelles', 'nb_troncons', 'largeur_allee_m'] as const) {
      expect(copie?.[c], c).toEqual(original?.[c]);
    }
    expect(copie?.zone_id).not.toBe(original?.zone_id);
    const planches = (nomZone: string): Ligne[] =>
      lignes(b, "SELECT e.code, e.longueur_m, e.largeur_m, e.sorte, e.placement_x_m AS x, e.placement_y_m AS y, e.orientation_deg AS o FROM emplacement e JOIN zone z ON z.id = e.zone_id WHERE z.nom = ? AND e.supprime_le IS NULL ORDER BY e.code", [nomZone]);
    [['Manon 1', 'Manon 4'], ['Manon 2', 'Manon 5'], ['Manon 3', 'Manon 6']].forEach(([avant, apres]) => {
      const [pa, pb] = [planches(avant ?? ''), planches(apres ?? '')];
      expect(pb.map((p) => p.code), `planches de ${String(apres)}`).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
      expect(pb, `planches de ${String(apres)} = celles de ${String(avant)}`).toEqual(pa);
      expect(pb.every((p) => p.x !== null && p.y !== null && p.o !== null && p.sorte === 'planche')).toBe(true);
    });
  });

  it('position : à côté, côté x positif, largeur 28,8 m + écart 1,5 m = 30,3 m, même cap ; surface des zones reprise', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 4, 'copie écrite');
    const [a, c] = [centre(b, 'Tunnel Manon'), centre(b, 'Tunnel Manon 2')];
    expect(c.x - a.x).toBeCloseTo(30.3, 3);
    expect(c.y).toBeCloseTo(a.y, 3);
    expect(c.cap).toBeCloseTo(a.cap, 3);
    const surface = (nom: string): number => Number(lignes(b, 'SELECT surface_m2 AS s FROM zone WHERE nom = ? AND supprime_le IS NULL', [nom])[0]?.s);
    expect(surface('Tunnel Manon 2')).toBeCloseTo(surface('Tunnel Manon'), 3);
    expect(surface('Manon 4')).toBeCloseTo(surface('Manon 1'), 3);
  });

  it('2 copies, écart 2 m : 30,8 m puis 61,6 m ; noms « Tunnel Manon 2 » et « Tunnel Manon 3 » ; un seul enregistrement de 58 changements', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer('2', '2');
    expect(brouillon()).toEqual([2, 2, 6, 48]);
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 5, 'copies écrites');
    expect(b.placements).toHaveLength(2);
    expect(b.placements[1]).toHaveLength(58);
    const a = centre(b, 'Tunnel Manon');
    expect(centre(b, 'Tunnel Manon 2').x - a.x).toBeCloseTo(30.8, 3);
    expect(centre(b, 'Tunnel Manon 3').x - a.x).toBeCloseTo(61.6, 3);
    const sous = lignes(b, "SELECT nom FROM zone WHERE nom LIKE 'Manon %' AND supprime_le IS NULL ORDER BY nom").map((z) => z.nom);
    expect(sous).toEqual(['Manon 1', 'Manon 2', 'Manon 3', 'Manon 4', 'Manon 5', 'Manon 6', 'Manon 7', 'Manon 8', 'Manon 9']);
  });

  it('la première copie est choisie, avec le bouton « Dupliquer » encore proposé', async () => {
    const { serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    const nouveaux = tous(T.batiment).filter((el) => el.getAttribute('aria-pressed') === 'true');
    expect(nouveaux).toHaveLength(1);
    expect(nouveaux[0]?.getAttribute('data-id')).not.toBe(serreId);
    expect(aOuvrir()).toBe(true);
  });

  it('« Abandonner les changements » retire toutes les copies du brouillon, rien n’est écrit', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer('3');
    expect(brouillon()).toEqual([3, 3, 9, 72]);
    await toucher(bouton(B.abandonner));
    expect(un(TS.brouillon)).toBeNull();
    expect(tous(T.batiment).filter((el) => ![SERRE, HANGAR, serreId].includes(el.getAttribute('data-id') ?? ''))).toHaveLength(0);
    expect(b.placements).toHaveLength(1);
    expect(batimentsVivants(b)).toBe(3);
  });

  it('« Annuler » après l’enregistrement retire toutes les copies : un second appel, plus aucune zone, planche ni bâtiment copiés', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer('2');
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 5, 'copies écrites');
    await annulerDernier();
    await attendre(() => batimentsVivants(b) === 3, 'copies retirées');
    expect(b.placements).toHaveLength(3);
    expect(zonesVivantes(b)).toBe(2 + 4);
    expect(emplacementsVivants(b)).toBe(1 + 24);
  });

  it('aucune culture, série ni historique n’est copiée : le brouillon ne contient ni série ni occupation', async () => {
    const { b, serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await enregistrer();
    await attendre(() => batimentsVivants(b) === 4, 'copie écrite');
    for (const table of ['serie', 'occupation', 'plantation', 'assolement']) {
      expect(compte(b, `SELECT count(*) AS n FROM ${table}`), table).toBe(0);
    }
  });
});

describe('T90 : dupliquer une parcelle de plein champ (critère 3)', () => {
  async function dupliquerLeChamp(copies?: string, ecart?: string): Promise<Banc> {
    const b = await ouvrir();
    await choisirZone(ZONE_CHAMP);
    await dupliquer(copies, ecart);
    return b;
  }

  it('une copie au brouillon : 1 zone, 0 sous-zone, 1 planche, aucun bâtiment ; rien d’écrit', async () => {
    const b = await dupliquerLeChamp();
    expect(brouillon()).toEqual([0, 1, 0, 1]);
    expect(b.placements).toEqual([]);
    expect(tous(T.planche), 'PC-01 et sa copie').toHaveLength(2);
  });

  it('« Enregistrer » : un seul appel de 3 changements (zone_creation, contour de la zone, emplacement_creation), dans cet ordre', async () => {
    const b = await dupliquerLeChamp();
    await enregistrer();
    await attendre(() => b.placements.length === 1 && zonesVivantes(b) === 3, 'copie écrite');
    const appel = (b.placements[0] ?? []) as Appel;
    expect(appel.map((c) => c.sorte)).toEqual(['zone_creation', 'emplacement_creation', 'zone']);
    expect(appel[0]?.valeurs).toMatchObject({ nom: 'Plein champ 2', type_abri: 'plein_champ', zone_parente_id: null });
    expect(appel[0]?.id).toBe(appel[2]?.id);
  });

  it('le contour est translaté de 30 m + 1,5 m vers le côté x positif du repère (cap 90° : vers le sud), planche PC-01 à la même place dans sa zone', async () => {
    const b = await dupliquerLeChamp();
    await enregistrer();
    await attendre(() => zonesVivantes(b) === 3, 'copie écrite');
    const zone = lignes(b, "SELECT id, contour, surface_m2 FROM zone WHERE nom = 'Plein champ 2' AND supprime_le IS NULL")[0];
    const contour = JSON.parse(String(zone?.contour)) as { x: number; y: number }[];
    const tri = (p: { x: number; y: number }[]): string[] => p.map((q) => `${q.x.toFixed(3)};${q.y.toFixed(3)}`).sort();
    expect(tri(contour)).toEqual(tri([{ x: 100, y: -31.5 }, { x: 140, y: -31.5 }, { x: 140, y: -1.5 }, { x: 100, y: -1.5 }]));
    expect(Number(zone?.surface_m2)).toBeCloseTo(1200, 3);
    const planche = lignes(b, "SELECT code, sorte, longueur_m, largeur_m, placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL", [String(zone?.id)]);
    const original = lignes(b, 'SELECT code, sorte, longueur_m, largeur_m, placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = ?', [PLANCHE]);
    expect(planche).toHaveLength(1);
    expect(planche).toEqual(original);
  });

  it('2 copies, écart 5 m : copies à 35 m puis 70 m au sud (30 m de large + 5 m d’écart) ; « Plein champ 2 » et « Plein champ 3 »', async () => {
    const b = await dupliquerLeChamp('2', '5');
    await enregistrer();
    await attendre(() => zonesVivantes(b) === 4, 'copies écrites');
    const sud = (nom: string): number => {
      const c = JSON.parse(String(lignes(b, 'SELECT contour FROM zone WHERE nom = ? AND supprime_le IS NULL', [nom])[0]?.contour)) as { y: number }[];
      return Math.min(...c.map((p) => p.y));
    };
    expect(sud('Plein champ')).toBeCloseTo(0, 3);
    expect(sud('Plein champ 2')).toBeCloseTo(-35, 3);
    expect(sud('Plein champ 3')).toBeCloseTo(-70, 3);
  });

  it('« Abandonner les changements » retire la copie ; « Annuler » après l’enregistrement aussi', async () => {
    const b = await dupliquerLeChamp();
    await toucher(bouton(B.abandonner));
    expect(un(TS.brouillon)).toBeNull();
    expect(tous(T.planche)).toHaveLength(1);
    await choisirZone(ZONE_CHAMP);
    await dupliquer();
    await enregistrer();
    await attendre(() => zonesVivantes(b) === 3, 'copie écrite');
    await annulerDernier();
    await attendre(() => zonesVivantes(b) === 2, 'copie retirée');
    expect(emplacementsVivants(b)).toBe(1);
  });
});

describe('T90 : refus de la demande', () => {
  it.each([
    ['0 copie', CD.nombre, '0'],
    ['21 copies', CD.nombre, '21'],
    ['1,5 copie', CD.nombre, '1.5'],
    ['nombre vidé', CD.nombre, ''],
    ['écart négatif', CD.ecart, '-1'],
    ['écart vidé', CD.ecart, ''],
  ])('%s : « Dupliquer » est désactivé et dit pourquoi, rien n’est changé', async (_cas, nomChamp, saisie) => {
    const b = await ouvrir();
    await choisirZone(ZONE_CHAMP);
    await ouvrirLaFiche();
    await remplir(champ(nomChamp, fiche()), saisie);
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(true);
    expect(texte(un(TD.aide)).length).toBeGreaterThan(0);
    expect(b.placements).toEqual([]);
    expect(un(TS.brouillon)).toBeNull();
  });

  it('20 copies d’une parcelle (3 changements chacune : 60) sont acceptées', async () => {
    await ouvrir();
    await choisirZone(ZONE_CHAMP);
    await ouvrirLaFiche();
    await remplir(champ(CD.nombre, fiche()), '20');
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(false);
  });

  it('au-delà de 500 changements : message clair en français avec le total, « Dupliquer » bloqué ; 17 copies (493) passent', async () => {
    const { serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await ouvrirLaFiche();
    await remplir(champ(CD.nombre, fiche()), '17');
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(false);
    await remplir(champ(CD.nombre, fiche()), '18');
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(true);
    const aide = texte(un(TD.aide));
    expect(aide).toContain('522');
    expect(aide).toContain('500');
    await toucher(bouton(BD.dupliquer, fiche()));
    expect(un(TD.fiche), 'le bouton bloqué ne fait rien').not.toBeNull();
    expect(un(TS.brouillon)).toBeNull();
  });

  it('le total compte le brouillon : une copie au brouillon (29) + 17 copies (493) = 522, bloqué, et le message parle du brouillon', async () => {
    const { serreId } = await creerTunnel();
    await choisirTunnel(serreId);
    await dupliquer();
    await choisirTunnel(serreId);
    await ouvrirLaFiche();
    await remplir(champ(CD.nombre, fiche()), '17');
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(true);
    expect(texte(un(TD.aide))).toMatch(/brouillon/);
    expect(texte(un(TD.aide))).toContain('522');
    await remplir(champ(CD.nombre, fiche()), '16');
    expect(desactive(bouton(BD.dupliquer, fiche()))).toBe(false);
  });
});

describe('T90 : pendant un enregistrement', () => {
  it('« Dupliquer » est désactivé tant que l’enregistrement dure', async () => {
    const b = await ouvrir();
    await choisirZone(ZONE_CHAMP);
    await dupliquer();
    let libere: () => void = () => undefined;
    const attente = new Promise<void>((resolve) => {
      libere = resolve;
    });
    const placer = b.porte.placer.bind(b.porte);
    (b.porte as { placer: PorteDonnees['placer'] }).placer = async (c) => {
      await attente;
      return placer(c);
    };
    await toucher(bouton(B.enregistrer));
    await attendre(() => desactive(bouton(BD.dupliquer, panneau())), '« Dupliquer » désactivé');
    libere();
    await attendre(() => zonesVivantes(b) === 3, 'copie écrite');
  });
});
