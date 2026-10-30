// @vitest-environment happy-dom
/**
 * Tests d'acceptation T61 — chemins et bâtiments (hangar, local, chambre froide, magasin) dans
 * l'éditeur de placement (docs/backlog/T61-chemins-outils.md, règle 1), rendus pour de vrai dans
 * un DOM simulé (happy-dom), sur une base mémoire et la vraie porte. Complète ./test/contrat.ts
 * (T28b) et ./test/contrat-contours.ts (T28d), qui restent valables en entier.
 *
 * ── Contrat de l'écran (EditeurPlacement, mêmes props que T28b) ─────────────────────────────
 *
 * Chemins existants (lus dans la table `chemin`, de la ferme de la porte seulement, non
 * supprimés), en édition comme en lecture : un élément `chemin` (data-testid="chemin") par
 * chemin, data-id, data-points = nombre de points, data-largeur = largeur en mètres, nom
 * accessible qui contient son nom (« Chemin » à défaut). Un chemin d'une autre ferme gardé dans la
 * base locale n'est jamais montré.
 *
 * Gérant actif sur ordinateur, point de départ du plan posé :
 *   - bouton « Tracer un chemin » (désactivé sans point de départ, comme « Nouveau bâtiment »).
 *     Le toucher ouvre le tracé : `chemin-edition` data-etat="trace" ; chaque clic sur le plan
 *     (pointerdown + pointerup + click au même endroit) pose un point `point-chemin` (data-index,
 *     data-x, data-y en mètres du repère de la ferme, valeurs AFFICHÉES). Pendant le tracé,
 *     « Enregistrer » est désactivé et rien n'est écrit.
 *   - « Terminer le chemin » (ou Entrée) termine le tracé s'il a 2 points au moins (avec moins, le
 *     bouton est désactivé et Entrée ne fait rien) ; « Renoncer au tracé » (ou Échap) l'abandonne
 *     (rien au brouillon). Terminé, le chemin est au brouillon : `chemin-edition` data-etat =
 *     'valide' | 'invalide' (verdict de validerChemin du cœur), data-points = n.
 *   - champ nombre « Largeur du chemin (m) » (valeur de départ 2), actif dès le tracé ; une saisie
 *     modifie le brouillon. Chemin invalide : `chemin-erreur` (role="alert") avec le message du
 *     cœur, « Enregistrer » désactivé.
 *   - « Enregistrer » = UN appel à porte.placer, avec { sorte: 'chemin', id, valeurs: { nom,
 *     points (arrondis au millimètre), largeur_m } } ; l'id est un UUID v7 ; puis « Annuler »
 *     (`annuler-placement`) : suppression douce du chemin, exacte, comme pour un bâtiment.
 *   - « Nouveau bâtiment » : la liste « Type » propose, dans cet ordre, Serre tunnel, Serre
 *     chapelle, Hangar, Local, Chambre froide, Magasin, Autre (valeurs serre_tunnel, serre_chapelle,
 *     hangar, local, chambre_froide, magasin, autre) ; le bâtiment posé s'écrit avec ce type.
 * Lecture seule (équipier, ou téléphone) : les chemins se voient, mais ni « Tracer un chemin », ni
 * `point-chemin`, ni `chemin-edition` ; rien n'est écrit.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { ecrireFermePlacement, FERME, HANGAR, SERRE, UTILISATEUR, type OptionsFermePlacement } from './test/ferme-placement.ts';
import { deverrouiller } from './test/deverrouiller.ts';

const CHEMIN_EDITEUR = './index.ts';
const MAINTENANT = new Date('2026-10-21T08:00:00.000Z');
/** m/px au zoom 19, à 44° N (voir tuiles.test.ts). */
const MPP_19 = 0.214782;
const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FERME_B = '0192f0c1-61b0-7000-8000-0000000000b2';
const CHEMIN_EXISTANT = '0192f0c1-61b0-7000-8000-0000000000c1';
const CHEMIN_VOISIN = '0192f0c1-61b0-7000-8000-0000000000c2';
const TID = { chemin: 'chemin', point: 'point-chemin', edition: 'chemin-edition', erreur: 'chemin-erreur' } as const;

let m: ModuleEditeur;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_EDITEUR)) as ModuleEditeur;
});

interface Changement {
  readonly sorte: string;
  readonly id?: string;
  readonly valeurs?: Record<string, unknown>;
}

interface PorteSuivie {
  readonly porte: PorteDonnees;
  readonly placements: (readonly Changement[])[];
}

function suivre(b: BaseMemoire): PorteSuivie {
  const reelle = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly Changement[])[] = [];
  const brute = (c: readonly Changement[]): Promise<readonly Changement[]> => (reelle as unknown as { placer(x: readonly Changement[]): Promise<readonly Changement[]> }).placer(c);
  return {
    porte: {
      ...reelle,
      placer: ((changements: readonly Changement[]) => {
        placements.push(structuredClone(changements));
        return brute(changements);
      }) as unknown as PorteDonnees['placer'],
    },
    placements,
  };
}

let base: BaseMemoire | null = null;
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

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const nombre = (el: Element | null, a: string): number => Number(el?.getAttribute(a));

async function ouvrir(o: OptionsFermePlacement & Partial<Pick<ProprietesEditeurPlacement, 'ordinateur'>> & { readonly sansChemins?: boolean } = {}): Promise<{ p: PorteSuivie; b: BaseMemoire }> {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  base = b;
  await ecrireFermePlacement(b, o);
  if (o.sansChemins !== true) {
    const iso = MAINTENANT.toISOString();
    b.recevoir(`INSERT INTO chemin (id, ferme_id, nom, points, largeur_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Allée du verger', ?, 1.5, ?, ?, NULL)`, [
      CHEMIN_EXISTANT,
      FERME,
      JSON.stringify([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }]),
      iso,
      iso,
    ]);
    b.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme B', 'Europe/Paris', NULL, NULL, '{"longueur":"m","masse":"kg"}')`, [FERME_B]);
    b.recevoir(`INSERT INTO chemin (id, ferme_id, nom, points, largeur_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Chemin de B', ?, 2, ?, ?, NULL)`, [
      CHEMIN_VOISIN,
      FERME_B,
      JSON.stringify([{ x: 0, y: 0 }, { x: 5, y: 5 }]),
      iso,
      iso,
    ]);
  }
  const p = suivre(b);
  const proprietes: ProprietesEditeurPlacement = { porte: p.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: o.ordinateur ?? true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
  await deverrouiller();
  return { p, b };
}

async function pointeur(el: Element, type: 'pointerdown' | 'pointerup', x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, pointerType: 'mouse' }));
    await Promise.resolve();
  });
  await unTour();
}

async function cliquerPlan(x: number, y: number): Promise<void> {
  const plan = un(T.plan);
  expect(plan, 'plan-placement affiché').not.toBeNull();
  if (plan === null) return;
  await pointeur(plan, 'pointerdown', x, y);
  await pointeur(plan, 'pointerup', x, y);
  await act(async () => {
    plan.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
    await Promise.resolve();
  });
  await unTour();
}

async function touche(key: string): Promise<void> {
  await act(async () => {
    const cible = document.activeElement ?? document.body;
    cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    cible.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

const aBoutonNomme = (nom: string): boolean => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') ?? b.textContent).trim() === nom);
const ligneChemin = (b: BaseMemoire, id: string) => b.lireDirect<Record<string, string | number | null>>('SELECT * FROM chemin WHERE id = ?', [id])[0];
const panneau = (): HTMLElement => {
  const e = un(T.panneau);
  if (e === null) throw new Error('panneau-placement absent');
  return e;
};

/** Trois clics en L, 100 px vers l'est puis 100 px vers le nord (l'écran a y vers le bas). */
const TRACE_PX = [
  { x: 300, y: 400 },
  { x: 400, y: 400 },
  { x: 400, y: 300 },
] as const;

async function tracer(): Promise<void> {
  await toucher(bouton('Tracer un chemin'));
  await attendre(() => un(TID.edition)?.getAttribute('data-etat') === 'trace', 'tracé ouvert');
  for (const p of TRACE_PX) await cliquerPlan(p.x, p.y);
  await attendre(() => tous(TID.point).length === TRACE_PX.length, 'trois points posés');
}

describe('T61 : chemins dans l’éditeur de placement', () => {
  it('les chemins de la ferme se voient (points, largeur, nom) ; celui d’une autre ferme jamais', async () => {
    await ouvrir({ origine: true });
    const c = tous(TID.chemin);
    expect(c.map((e) => e.getAttribute('data-id'))).toEqual([CHEMIN_EXISTANT]);
    expect(nombre(c[0] ?? null, 'data-points')).toBe(3);
    expect(nombre(c[0] ?? null, 'data-largeur')).toBe(1.5);
    expect((c[0]?.getAttribute('aria-label') ?? texte(c[0])).includes('Allée du verger')).toBe(true);
  });

  it('sans point de départ du plan : « Tracer un chemin » désactivé, rien d’écrit', async () => {
    const { p } = await ouvrir({ origine: false });
    expect(desactive(bouton('Tracer un chemin'))).toBe(true);
    expect(p.placements).toEqual([]);
  });

  it('tracer 3 points, terminer, largeur 2,5 m, enregistrer en UN appel ; « Annuler » le supprime (suppression douce)', async () => {
    const { p, b } = await ouvrir({ origine: true });
    await tracer();
    expect(p.placements, 'rien n’est écrit pendant le tracé').toEqual([]);
    expect(desactive(bouton('Enregistrer')), 'Enregistrer inactif pendant le tracé').toBe(true);
    const pts = tous(TID.point).map((e) => ({ x: nombre(e, 'data-x'), y: nombre(e, 'data-y') }));
    // Écarts attendus : 100 px vers l'est = 21,478 m, puis 100 px vers le nord.
    expect((pts[1]?.x ?? 0) - (pts[0]?.x ?? 0)).toBeCloseTo(100 * MPP_19, 1);
    expect((pts[2]?.y ?? 0) - (pts[1]?.y ?? 0)).toBeCloseTo(100 * MPP_19, 1);

    await toucher(bouton('Terminer le chemin'));
    await attendre(() => un(TID.edition)?.getAttribute('data-etat') === 'valide', 'chemin terminé, valide');
    expect(un(TID.edition)?.getAttribute('data-points')).toBe('3');
    expect(Number(champ('Largeur du chemin (m)', panneau()).value)).toBe(2);
    await remplir(champ('Largeur du chemin (m)', panneau()), '2.5');
    expect(p.placements).toEqual([]);

    await toucher(bouton('Enregistrer'));
    await attendre(() => p.placements.length === 1, 'un appel à porte.placer');
    const ecrit = p.placements[0]?.filter((c) => c.sorte === 'chemin') ?? [];
    expect(ecrit).toHaveLength(1);
    const id = ecrit[0]?.id ?? '';
    expect(id).toMatch(MOTIF_UUID_V7);
    expect(ecrit[0]?.valeurs?.largeur_m).toBe(2.5);
    const points = ecrit[0]?.valeurs?.points as { x: number; y: number }[];
    expect(points).toHaveLength(3);
    for (const q of points) {
      expect(Math.round(q.x * 1000) / 1000, 'arrondi au millimètre').toBe(q.x);
      expect(Math.round(q.y * 1000) / 1000).toBe(q.y);
    }
    await attendre(() => ligneChemin(b, id) !== undefined, 'chemin créé en base');
    expect(ligneChemin(b, id)).toMatchObject({ ferme_id: FERME, largeur_m: 2.5, supprime_le: null });
    expect(JSON.parse(String(ligneChemin(b, id)?.points))).toEqual(points);

    await attendre(() => un(T.annuler) !== null, '« Annuler »');
    const annuler = un(T.annuler);
    if (annuler !== null) await toucher(annuler);
    await attendre(() => ligneChemin(b, id)?.supprime_le !== null, 'création annulée (suppression douce)');
    await attendre(() => !tous(TID.chemin).some((e) => e.getAttribute('data-id') === id), 'chemin annulé retiré de la vue');
  });

  it('Entrée termine le tracé ; avec un seul point, « Terminer le chemin » est inactif et Entrée ne fait rien', async () => {
    await ouvrir({ origine: true });
    await toucher(bouton('Tracer un chemin'));
    await attendre(() => un(TID.edition)?.getAttribute('data-etat') === 'trace', 'tracé ouvert');
    await cliquerPlan(300, 400);
    await attendre(() => tous(TID.point).length === 1, 'un point');
    expect(desactive(bouton('Terminer le chemin'))).toBe(true);
    await touche('Enter');
    expect(un(TID.edition)?.getAttribute('data-etat')).toBe('trace');
    await cliquerPlan(400, 400);
    await attendre(() => tous(TID.point).length === 2, 'deux points');
    await touche('Enter');
    await attendre(() => un(TID.edition)?.getAttribute('data-etat') === 'valide', 'Entrée termine le tracé');
    expect(un(TID.edition)?.getAttribute('data-points')).toBe('2');
  });

  it('Échap (ou « Renoncer au tracé ») abandonne : aucun point, aucun brouillon, rien d’écrit', async () => {
    const { p } = await ouvrir({ origine: true });
    await tracer();
    await touche('Escape');
    await attendre(() => un(TID.edition) === null, 'tracé abandonné');
    expect(tous(TID.point)).toEqual([]);
    expect(desactive(bouton('Enregistrer')), 'rien à enregistrer').toBe(true);
    await tracer();
    await toucher(bouton('Renoncer au tracé'));
    await attendre(() => un(TID.edition) === null, 'tracé abandonné par le bouton');
    expect(p.placements).toEqual([]);
  });

  it('largeur de 25 m : chemin invalide, message du cœur, « Enregistrer » inactif, rien d’écrit', async () => {
    const { p } = await ouvrir({ origine: true });
    await tracer();
    await toucher(bouton('Terminer le chemin'));
    await remplir(champ('Largeur du chemin (m)', panneau()), '25');
    await attendre(() => un(TID.edition)?.getAttribute('data-etat') === 'invalide', 'chemin invalide');
    const erreur = un(TID.erreur);
    expect(erreur?.getAttribute('role')).toBe('alert');
    expect(texte(erreur)).toMatch(/largeur/i);
    expect(desactive(bouton('Enregistrer'))).toBe(true);
    expect(p.placements).toEqual([]);
    await remplir(champ('Largeur du chemin (m)', panneau()), '3');
    await attendre(() => un(TID.erreur) === null && un(TID.edition)?.getAttribute('data-etat') === 'valide', 'de nouveau valide');
  });

  it.each([
    ['équipier', { role: 'equipier' as const }],
    ['gérant sur téléphone', { ordinateur: false }],
  ])('lecture seule (%s) : le chemin existant se voit, aucun tracé possible', async (_nom, options) => {
    const { p } = await ouvrir({ origine: true, ...options });
    expect(tous(TID.chemin)).toHaveLength(1);
    expect(aBoutonNomme('Tracer un chemin')).toBe(false);
    expect(un(TID.edition)).toBeNull();
    expect(tous(TID.point)).toEqual([]);
    expect(p.placements).toEqual([]);
  });
});

describe('T61 : bâtiments hangar, local, chambre froide, magasin dans « Nouveau bâtiment »', () => {
  it('la liste « Type » propose les sept sortes, dans l’ordre', async () => {
    await ouvrir({ origine: true, sansChemins: true });
    await toucher(bouton('Nouveau bâtiment'));
    const formulaire = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.getAttribute('data-testid') !== T.editeur && texte(d).includes('Nouveau bâtiment'));
    expect(formulaire, 'formulaire « Nouveau bâtiment »').toBeDefined();
    if (formulaire === undefined) return;
    const options = [...liste('Type', formulaire).options].map((o) => [o.value, o.textContent.trim()]);
    expect(options).toEqual([
      ['serre_tunnel', 'Serre tunnel'],
      ['serre_chapelle', 'Serre chapelle'],
      ['hangar', 'Hangar'],
      ['local', 'Local'],
      ['chambre_froide', 'Chambre froide'],
      ['magasin', 'Magasin'],
      ['autre', 'Autre'],
    ]);
  });

  it('une chambre froide de 6 × 4 m posée, enregistrée avec son type, annulable', async () => {
    const { p, b } = await ouvrir({ origine: true, sansChemins: true });
    await toucher(bouton('Nouveau bâtiment'));
    const formulaire = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.getAttribute('data-testid') !== T.editeur && texte(d).includes('Nouveau bâtiment'));
    if (formulaire === undefined) throw new Error('formulaire absent');
    await remplir(liste('Type', formulaire), 'chambre_froide');
    await remplir(champ('Nom', formulaire), 'Chambre froide');
    await remplir(champ('Longueur (m)', formulaire), '6');
    await remplir(champ('Largeur (m)', formulaire), '4');
    await remplir(champ('Hauteur (m)', formulaire), '2.8');
    await toucher(bouton('Poser', formulaire));
    await cliquerPlan(200, 200);
    const anciens = new Set([HANGAR, SERRE]);
    const nouveaux = (): HTMLElement[] => tous(T.batiment).filter((e) => !anciens.has(e.getAttribute('data-id') ?? ''));
    await attendre(() => nouveaux().length === 1, 'nouveau bâtiment posé');
    const id = nouveaux()[0]?.getAttribute('data-id') ?? '';
    await toucher(bouton('Enregistrer'));
    await attendre(() => b.lireDirect('SELECT 1 FROM batiment WHERE id = ?', [id]).length === 1, 'bâtiment créé');
    expect(b.lireDirect('SELECT * FROM batiment WHERE id = ?', [id])[0]).toMatchObject({ nom: 'Chambre froide', type: 'chambre_froide', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, ferme_id: FERME, supprime_le: null });
    expect(p.placements).toHaveLength(1);
  });
});
