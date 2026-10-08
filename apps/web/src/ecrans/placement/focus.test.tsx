// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28g — le focus revient à la fermeture de l'éditeur de placement, et l'encart de
 * la vue 3D annonce ses changements (docs/backlog/T28g-focus-editeur.md). Vrais écrans (Planches avec
 * sa vue 3D, Ferme), DOM simulé (happy-dom), base mémoire et vraie porte ; seul le moteur WebGL de
 * fiber est remplacé (aucun contexte WebGL dans happy-dom), la vue 3D et son DOM sont les vrais.
 *
 * Libellés réels (T28f), le ticket parle d'un « Ouvrir l'éditeur » qui n'existe pas :
 *   3D, ferme sans placement : « Modifier le plan » dans l'encart `encart-placement` ;
 *   3D, ferme placée : « Modifier le plan » dans la barre d'outils ; les deux ont `data-testid="modifier-plan"` ;
 *   onglet Ferme : « Placer sur la photo aérienne ».
 * Repli : « Modifier le plan », à défaut la toile `toile-3d` (tabIndex 0).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { PoigneeDonnees } from '../../donnees/etat-appli.ts';
import type { SessionConnexion } from '../../connexion/session.ts';
import { attendre, bouton, toucher, unTour } from '../itineraires/test/outils.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from './test/contrat.ts';
import { CREE_LE, ecrireFermePlacement, FERME, UTILISATEUR, type OptionsFermePlacement } from './test/ferme-placement.ts';

// Pas de WebGL dans happy-dom : la racine fiber ne dessine rien, la vue 3D (DOM, boutons, encart) est la vraie.
vi.mock('@react-three/fiber', () => ({
  createRoot: () => ({ configure: () => Promise.resolve(), render: () => undefined, unmount: () => undefined }),
  extend: () => undefined,
  useFrame: () => undefined,
  useThree: () => undefined,
}));
vi.mock('../plan3d/entree.ts', async (original) => ({
  ...(await original<typeof import('../plan3d/entree.ts')>()),
  webglDisponible: () => true,
}));

const MODIFIER_PLAN = 'modifier-plan';
const ENCART = 'encart-placement';

let EcranPlan: typeof import('../plan/EcranPlan.tsx').EcranPlan;
let EcranFerme: typeof import('../ferme/EcranFerme.tsx').default;

beforeAll(async () => {
  EcranPlan = (await import('../plan/EcranPlan.tsx')).EcranPlan;
  EcranFerme = (await import('../ferme/EcranFerme.tsx')).default;
});

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.ResizeObserver === 'undefined') {
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
  }
  // Écran d'ordinateur : « Modifier le plan » n'existe qu'à partir de 1024 px (T28f).
  vi.stubGlobal('matchMedia', (requete: string) => ({
    matches: requete.includes('min-width: 1024px'),
    media: requete,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('pas de réseau'))));
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base?.fermer();
  base = null;
});

async function creerPorteDeTest(options: OptionsFermePlacement): Promise<PorteDonnees> {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  base = b;
  await ecrireFermePlacement(b, options);
  return creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => new Date('2026-10-08T08:00:00.000Z') });
}

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
function requis(testid: string): HTMLElement {
  const el = un(testid);
  if (el === null) throw new Error(`${testid} absent`);
  return el;
}
const editeur = (): HTMLElement | null => un(T.editeur);
const focus = (): string => {
  const a: Element | null = document.activeElement;
  return a === null ? 'aucun' : `<${a.tagName.toLowerCase()} data-testid="${a.getAttribute('data-testid') ?? ''}"> « ${a.textContent.trim().slice(0, 40)} »`;
};

// ── Écran Planches, vue 3D ───────────────────────────────────────────────────────────────────

async function ouvrirLa3d(options: OptionsFermePlacement): Promise<void> {
  const porte = await creerPorteDeTest({ saison: true, ...options });
  await act(async () => {
    racine.render(createElement(EcranPlan, { porte, fermeId: FERME, utilisateurId: UTILISATEUR, aujourdhui: () => '2026-10-08' }));
    await Promise.resolve();
  });
  await attendre(() => un('voir-en-3d') !== null && !(un('voir-en-3d') as HTMLButtonElement).disabled, 'plan chargé, « Voir en 3D » actif');
  await toucher(requis('voir-en-3d'));
  await attendre(() => un('vue-3d') !== null, 'vue 3D ouverte');
  // Le rôle de gérant est lu en base après le montage.
  await attendre(() => un(MODIFIER_PLAN) !== null, '« Modifier le plan » affiché (gérant, grand écran)');
}

async function ouvrirLediteur(): Promise<void> {
  await toucher(requis(MODIFIER_PLAN));
  await attendre(() => editeur() !== null, 'éditeur ouvert');
}

async function fermerLediteur(): Promise<void> {
  const e = editeur();
  if (e === null) throw new Error('éditeur absent');
  await toucher(bouton(/^(Fermer|Retour)/, e));
  await attendre(() => editeur() === null, 'éditeur fermé');
  await unTour();
}

/** Un bâtiment posé « de l'extérieur » (comme une synchro) pendant que l'éditeur est ouvert. */
async function poserUnBatiment(b: BaseMemoire): Promise<void> {
  await b.execute(
    'INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['0192f0c1-28b0-7000-8000-0000000000b1', FERME, 'Hangar posé', 'hangar', 20, 12, 6, 10, 10, 0, null, CREE_LE, CREE_LE, null],
  );
}

describe('T28g : vue 3D, le focus revient sur le bouton d’origine', () => {
  it('ferme sans placement : « Modifier le plan » de l’encart ouvre l’éditeur, « Fermer » lui rend le focus', async () => {
    await ouvrirLa3d({});
    const origine = un(MODIFIER_PLAN);
    expect(un(ENCART)?.contains(origine), 'le bouton est celui de l’encart').toBe(true);
    await ouvrirLediteur();
    await fermerLediteur();
    expect(document.activeElement, `focus : ${focus()}`).toBe(un(MODIFIER_PLAN));
    expect(un(MODIFIER_PLAN)?.textContent.trim()).toBe('Modifier le plan');
  });

  it('ferme placée : « Modifier le plan » de la barre d’outils ouvre l’éditeur, « Fermer » lui rend le focus', async () => {
    await ouvrirLa3d({ origine: true });
    expect(un(ENCART), 'pas d’encart sur une ferme placée').toBeNull();
    await ouvrirLediteur();
    await fermerLediteur();
    expect(document.activeElement, `focus : ${focus()}`).toBe(un(MODIFIER_PLAN));
  });

  it('le focus se pose après le rendu de la fermeture, sans attendre : il est déjà là au retour du tour', async () => {
    await ouvrirLa3d({ origine: true });
    await ouvrirLediteur();
    const e = editeur();
    if (e === null) throw new Error('éditeur absent');
    await toucher(bouton(/^(Fermer|Retour)/, e));
    // Un seul tour de rendu : pas de minuterie (setTimeout) entre la fermeture et le focus.
    expect(editeur(), 'éditeur retiré').toBeNull();
    expect(document.activeElement, `focus : ${focus()}`).toBe(un(MODIFIER_PLAN));
  });

  it('repli : le bouton d’origine a disparu (le placement existe maintenant) → focus sur « Modifier le plan » de la barre d’outils', async () => {
    await ouvrirLa3d({});
    const origine = un(MODIFIER_PLAN);
    expect(un(ENCART)?.contains(origine)).toBe(true);
    await ouvrirLediteur();
    if (base === null) throw new Error('base absente');
    await poserUnBatiment(base);
    await attendre(() => un(ENCART) === null, 'l’encart disparaît : la ferme est placée');
    expect(origine?.isConnected, 'le bouton d’origine n’est plus dans le DOM').toBe(false);
    await fermerLediteur();
    const repli = un(MODIFIER_PLAN);
    expect(repli, '« Modifier le plan » de la barre d’outils').not.toBeNull();
    expect(document.activeElement, `focus : ${focus()}`).toBe(repli);
  });

  it('repli : ni bouton d’origine ni « Modifier le plan » (plus gérant) → focus sur la toile du plan', async () => {
    await ouvrirLa3d({ origine: true });
    await ouvrirLediteur();
    if (base === null) throw new Error('base absente');
    await base.execute("UPDATE membre SET role = 'equipier' WHERE ferme_id = ? AND utilisateur_id = ?", [FERME, UTILISATEUR]);
    await attendre(() => un(MODIFIER_PLAN) === null, '« Modifier le plan » disparaît (plus gérant)');
    if (editeur() !== null) await fermerLediteur();
    await unTour();
    expect(un(MODIFIER_PLAN), 'aucun « Modifier le plan »').toBeNull();
    const toile = un('toile-3d');
    expect(toile, 'toile du plan').not.toBeNull();
    expect(document.activeElement, `focus : ${focus()}`).toBe(toile);
  });
});

describe('T28g : encart de la vue 3D', () => {
  it('l’encart est une zone d’annonce (role="status") et ne vole pas le focus', async () => {
    await ouvrirLa3d({});
    const encart = un(ENCART);
    expect(encart, 'encart affiché').not.toBeNull();
    expect(encart?.getAttribute('role')).toBe('status');
    expect(encart?.contains(document.activeElement), `l’encart ne prend pas le focus (focus : ${focus()})`).toBe(false);
  });

  it('le texte annoncé change quand une zone est choisie (« Aller à … ») et mentionne la zone', async () => {
    await ouvrirLa3d({});
    const avant = (un(ENCART)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const zones = [...document.querySelectorAll<HTMLElement>('[data-testid="aller-zone-3d"]')];
    expect(zones.length, 'au moins une zone à choisir').toBeGreaterThan(0);
    const choisie = zones[0];
    if (choisie === undefined) throw new Error('aucune zone');
    const nom = choisie.textContent.replace(/^Aller à\s*/, '').trim();
    await toucher(choisie);
    await unTour();
    const encart = un(ENCART);
    expect(encart, 'l’encart reste là').not.toBeNull();
    const apres = (encart?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(apres, 'le texte annoncé a changé').not.toBe(avant);
    expect(apres, `le texte cite la zone « ${nom} »`).toContain(nom);
    expect(encart?.contains(document.activeElement), 'l’encart ne vole pas le focus').toBe(false);
    expect(encart?.getAttribute('role'), 'le changement est annoncé : role="status"').toBe('status');
  });
});

// ── Onglet Ferme ─────────────────────────────────────────────────────────────────────────────

describe('T28g : onglet Ferme, le focus revient sur « Placer sur la photo aérienne »', () => {
  const SESSION: SessionConnexion = { utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) };
  const POIGNEE: PoigneeDonnees = { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };

  it('ouverture par le bouton, puis « Fermer » → le focus est sur le même bouton', async () => {
    const porte = await creerPorteDeTest({});
    await act(async () => {
      racine.render(
        createElement(ContexteFerme, { value: { porte, fermeId: FERME } }, createElement(EcranFerme, { session: SESSION, baseLocale: POIGNEE, surDeconnecte: () => undefined, etatBase: 'prete' })),
      );
      await Promise.resolve();
    });
    const origine = bouton(ENTREE_PLACEMENT, conteneur);
    await toucher(origine);
    await attendre(() => editeur() !== null, 'éditeur ouvert (import dynamique compris)');
    await fermerLediteur();
    const apres = bouton(ENTREE_PLACEMENT, conteneur);
    expect(document.activeElement, `focus : ${focus()}`).toBe(apres);
  });
});
