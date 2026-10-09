// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28j — le parcours guidé de l'éditeur de placement : bandeau de quatre
 * étapes (trouver la ferme, poser le point de départ, ajouter un bâtiment, ajuster et tracer),
 * étape en cours selon l'état de la ferme, boutons grisés qui disent pourquoi, message pendant la
 * pose, retour à une étape. Contrat du DOM : ./test/contrat-etapes.ts (et ./test/contrat.ts).
 * Rien n'est modifié dans les autres tests de l'éditeur.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, desactive, dialogues, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { MESSAGES_ETAPES, TESTID_ETAPES as E, TITRES_ETAPES, type EtatEtape } from './test/contrat-etapes.ts';
import { ecrireFermePlacement, FERME, UTILISATEUR, type OptionsFermePlacement } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-09T08:00:00.000Z');

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
  vi.unstubAllGlobals();
  base?.fermer();
  base = null;
});

async function ouvrir(options: OptionsFermePlacement = {}): Promise<void> {
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
  const proprietes: ProprietesEditeurPlacement = { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché, avec data-mode');
}

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const etapes = (): HTMLElement[] => tous(E.etape);
const etape = (n: 1 | 2 | 3 | 4): HTMLElement => {
  const el = etapes().find((e) => e.getAttribute('data-etape') === String(n));
  if (el === undefined) throw new Error(`étape ${String(n)} absente`);
  return el;
};
const etats = (): string[] => [1, 2, 3, 4].map((n) => etape(n as 1 | 2 | 3 | 4).getAttribute('data-etat') ?? '');
const ETATS = (...e: EtatEtape[]): string[] => e;

async function attendreEtats(attendus: string[]): Promise<void> {
  await attendre(() => etapes().length === 4 && etats().join() === attendus.join(), `étapes ${attendus.join(' / ')} (obtenu : ${etapes().length === 4 ? etats().join(' / ') : 'bandeau incomplet'})`);
}

async function pointeur(el: Element, type: 'pointerdown' | 'pointerup', x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true }));
    await Promise.resolve();
  });
  await unTour();
}

async function cliquerPlan(x = 0, y = 0): Promise<void> {
  const plan = un(T.plan);
  expect(plan, 'plan-placement affiché').not.toBeNull();
  if (plan === null) return;
  await pointeur(plan, 'pointerdown', x, y);
  await pointeur(plan, 'pointerup', x, y);
  await act(async () => {
    plan.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await unTour();
}

const confirmation = (): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && /point de départ/i.test(texte(d)));

async function poserOrigineParLaPosition(): Promise<void> {
  await toucher(bouton('Utiliser la position de la ferme'));
  await attendre(() => confirmation() !== undefined, 'confirmation du point de départ');
  const d = confirmation();
  if (d !== undefined) await toucher(bouton('Confirmer', d));
  await attendre(() => placements.length === 1, 'origine écrite');
  await attendre(() => (un(T.editeur)?.getAttribute('data-origine') ?? '') !== '', 'data-origine posé');
}

/** « Nouveau bâtiment » → formulaire rempli → « Poser ». Le tap sur la photo reste à faire. */
async function commencerPose(): Promise<void> {
  await toucher(bouton('Nouveau bâtiment'));
  const formulaire = dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && texte(d).includes('Nouveau bâtiment'));
  expect(formulaire, 'formulaire « Nouveau bâtiment »').toBeDefined();
  if (formulaire === undefined) return;
  await remplir(liste('Type', formulaire), 'serre_tunnel');
  await remplir(champ('Nom', formulaire), 'Serre M3');
  await remplir(champ('Longueur (m)', formulaire), '40');
  await remplir(champ('Largeur (m)', formulaire), '8');
  await remplir(champ('Hauteur (m)', formulaire), '3.5');
  await toucher(bouton('Poser', formulaire));
}

const raison = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((i) => i !== '')
    .map((i) => texte(document.getElementById(i)))
    .join(' ')
    .trim();

// ── Le bandeau ───────────────────────────────────────────────────────────────────────────────

describe('T28j : le bandeau d’étapes', () => {
  it('quatre étapes dans l’ordre, avec leur titre, chacune un bouton', async () => {
    await ouvrir();
    expect(un(E.bandeau), 'bandeau etapes-placement').not.toBeNull();
    expect(etapes().map((e) => e.getAttribute('data-etape'))).toEqual(['1', '2', '3', '4']);
    for (const n of [1, 2, 3, 4] as const) {
      expect(texte(etape(n)), `titre de l’étape ${String(n)}`).toContain(TITRES_ETAPES[n]);
      expect(etape(n).tagName === 'BUTTON' || etape(n).getAttribute('role') === 'button', `étape ${String(n)} cliquable`).toBe(true);
    }
  });

  it('le bandeau est dans l’éditeur, avant le plan', async () => {
    await ouvrir();
    const bandeau = un(E.bandeau);
    const plan = un(T.plan);
    expect(un(T.editeur)?.contains(bandeau ?? null)).toBe(true);
    expect(bandeau !== null && plan !== null && (bandeau.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'bandeau avant le plan').toBe(true);
  });

  it('ferme sans origine : étape 1 en cours, les autres à venir', async () => {
    await ouvrir();
    await attendreEtats(ETATS('en-cours', 'a-venir', 'a-venir', 'a-venir'));
  });

  it('ferme sans origine et sans position : étape 1 en cours aussi', async () => {
    await ouvrir({ sansPosition: true });
    await attendreEtats(ETATS('en-cours', 'a-venir', 'a-venir', 'a-venir'));
  });

  it('origine posée (par la position de la ferme) : étapes 1 et 2 faites, 3 en cours', async () => {
    await ouvrir();
    await poserOrigineParLaPosition();
    await attendreEtats(ETATS('faite', 'faite', 'en-cours', 'a-venir'));
  });

  it('origine posée d’un tap sur la photo : étapes 1 et 2 faites, 3 en cours', async () => {
    await ouvrir();
    await cliquerPlan(10, 10);
    await attendre(() => confirmation() !== undefined, 'confirmation du point de départ');
    const d = confirmation();
    if (d !== undefined) await toucher(bouton('Confirmer', d));
    await attendre(() => placements.length === 1, 'origine écrite');
    await attendreEtats(ETATS('faite', 'faite', 'en-cours', 'a-venir'));
  });

  it('un bâtiment posé (brouillon, pas enregistré) : étape 4 en cours, 1 à 3 faites', async () => {
    await ouvrir();
    await poserOrigineParLaPosition();
    await commencerPose();
    await cliquerPlan(200, 200);
    await attendre(() => tous(T.batiment).length === 1, 'bâtiment posé');
    expect(placements.length, 'poser n’écrit rien de plus').toBe(1);
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
  });

  it('ferme déjà placée à l’ouverture : directement l’étape 4', async () => {
    await ouvrir({ origine: true });
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
  });

  it('une seule étape en cours, et aria-current="step" sur elle seule', async () => {
    await ouvrir();
    await poserOrigineParLaPosition();
    await attendreEtats(ETATS('faite', 'faite', 'en-cours', 'a-venir'));
    expect(etapes().filter((e) => e.getAttribute('data-etat') === 'en-cours')).toHaveLength(1);
    expect(etapes().filter((e) => e.getAttribute('aria-current') === 'step').map((e) => e.getAttribute('data-etape'))).toEqual(['3']);
  });
});

// ── Pose d'un bâtiment : le message ──────────────────────────────────────────────────────────

describe('T28j : pendant la pose', () => {
  it('le message « Touchez la photo où se trouve la serre » est affiché, et l’étape 3 est en cours', async () => {
    await ouvrir({ origine: true });
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
    expect(un(E.messagePose), 'pas de message hors pose').toBeNull();
    await commencerPose();
    await attendre(() => un(E.messagePose) !== null, 'message-pose affiché');
    const message = un(E.messagePose);
    expect(message?.getAttribute('role')).toBe('status');
    expect(texte(message)).toContain(MESSAGES_ETAPES.poseSerre);
    await attendreEtats(ETATS('faite', 'faite', 'en-cours', 'a-venir'));
  });

  it('le message disparaît quand le bâtiment est posé, et l’étape 4 devient en cours', async () => {
    await ouvrir({ origine: true });
    await commencerPose();
    await attendre(() => un(E.messagePose) !== null, 'message-pose affiché');
    await cliquerPlan(200, 200);
    await attendre(() => un(E.messagePose) === null, 'message-pose retiré');
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
  });

  it('« Renoncer » retire le message et rend l’étape 4', async () => {
    await ouvrir({ origine: true });
    await commencerPose();
    await attendre(() => un(E.messagePose) !== null, 'message-pose affiché');
    await toucher(bouton('Renoncer'));
    await attendre(() => un(E.messagePose) === null, 'message-pose retiré');
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
  });
});

// ── Les boutons grisés disent pourquoi ───────────────────────────────────────────────────────

describe('T28j : un bouton grisé dit pourquoi', () => {
  it('« Nouveau bâtiment » sans origine : grisé, avec la raison reliée par aria-describedby', async () => {
    await ouvrir();
    const b = bouton('Nouveau bâtiment');
    expect(desactive(b)).toBe(true);
    const ids = (b.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((i) => i !== '');
    expect(ids.length, 'aria-describedby renseigné').toBeGreaterThan(0);
    for (const i of ids) expect(document.getElementById(i), `élément #${i} existe`).not.toBeNull();
    expect(raison(b)).toMatch(MESSAGES_ETAPES.raisonSansOrigine);
  });

  it('la raison est lisible à l’écran (pas masquée)', async () => {
    await ouvrir();
    const b = bouton('Nouveau bâtiment');
    const cible = (b.getAttribute('aria-describedby') ?? '').split(/\s+/).map((i) => document.getElementById(i)).find((el) => el !== null && MESSAGES_ETAPES.raisonSansOrigine.test(texte(el)));
    expect(cible, 'élément porteur de la raison').toBeDefined();
    expect(cible?.hidden).toBe(false);
    expect(cible?.getAttribute('aria-hidden')).not.toBe('true');
    expect(cible?.style.display).not.toBe('none');
  });

  it('sans origine, tout bouton désactivé de l’éditeur a une raison non vide', async () => {
    await ouvrir();
    const grises = [...document.querySelectorAll<HTMLElement>('[data-testid="editeur-placement"] button')].filter((b) => desactive(b));
    expect(grises.length, 'au moins « Nouveau bâtiment » et « Enregistrer » sont grisés').toBeGreaterThanOrEqual(2);
    for (const b of grises) expect(raison(b), `raison du bouton grisé « ${texte(b)} »`).not.toBe('');
  });

  it('origine posée, rien à enregistrer : « Enregistrer » grisé a sa raison ; « Nouveau bâtiment » est actif', async () => {
    await ouvrir({ origine: true });
    expect(desactive(bouton('Nouveau bâtiment'))).toBe(false);
    const enregistrer = bouton('Enregistrer');
    expect(desactive(enregistrer)).toBe(true);
    expect(raison(enregistrer)).not.toBe('');
  });

  it('une fois l’origine posée, « Nouveau bâtiment » n’affiche plus la raison « étape 2 »', async () => {
    await ouvrir();
    await poserOrigineParLaPosition();
    await attendre(() => !desactive(bouton('Nouveau bâtiment')), 'Nouveau bâtiment actif');
    expect(un(E.bandeau), 'bandeau etapes-placement').not.toBeNull();
    expect(raison(bouton('Nouveau bâtiment'))).not.toMatch(MESSAGES_ETAPES.raisonSansOrigine);
  });
});

// ── Revenir à une étape ──────────────────────────────────────────────────────────────────────

describe('T28j : on peut revenir à une étape', () => {
  it('tap sur une étape faite : elle prend aria-current, l’aide donne sa consigne, l’avancement réel ne change pas', async () => {
    await ouvrir({ origine: true });
    await attendreEtats(ETATS('faite', 'faite', 'faite', 'en-cours'));
    expect(etape(4).getAttribute('aria-current')).toBe('step');
    await toucher(etape(3));
    expect(etape(3).getAttribute('aria-current')).toBe('step');
    expect(etape(4).getAttribute('aria-current')).not.toBe('step');
    expect(texte(un(E.aide))).toContain(TITRES_ETAPES[3]);
    expect(etats()).toEqual(ETATS('faite', 'faite', 'faite', 'en-cours'));
    expect(placements, 'revenir n’écrit rien').toEqual([]);
  });

  it('un tap sur l’étape en cours rend la main à l’étape en cours', async () => {
    await ouvrir({ origine: true });
    await toucher(etape(2));
    expect(etape(2).getAttribute('aria-current')).toBe('step');
    await toucher(etape(4));
    expect(etape(4).getAttribute('aria-current')).toBe('step');
    expect(etape(2).getAttribute('aria-current')).not.toBe('step');
  });

  it('tap sur l’étape 1 faite : le focus va au champ de recherche d’adresse', async () => {
    await ouvrir({ origine: true });
    await toucher(etape(1));
    const champAdresse = champ('Adresse, commune ou lieu-dit');
    expect(document.activeElement).toBe(champAdresse);
  });

  it('une étape à venir ne fait pas sauter l’avancement : sans origine, un tap sur l’étape 3 laisse l’étape 1 en cours et n’écrit rien', async () => {
    await ouvrir();
    await toucher(etape(3));
    expect(etats()).toEqual(ETATS('en-cours', 'a-venir', 'a-venir', 'a-venir'));
    expect(placements).toEqual([]);
  });
});
