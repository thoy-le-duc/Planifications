// @vitest-environment happy-dom
/**
 * T11e, relecture — focus de l'écran « Planches » dans un DOM simulé (happy-dom), ferme de T07 :
 *   B1  la feuille ouverte par la carte d'alerte rend le focus à la carte (la planche en retard
 *       est souvent hors de vue, ou pas dessinée) ;
 *   N1  une ligne qui contient le focus n'est jamais réutilisée pour une autre planche quand on
 *       défile : la barre focalisée reste la même culture (Entrée ouvre ce qu'on voit focalisé).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import type { ModuleEcranPlan } from './test/contrat.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';
const HAUTEUR_LIGNE = 48;

let ecran: ModuleEcranPlan;
let base: BaseMemoire;
let porte: PorteDonnees;
let jeu: JeuT07;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranPlan;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  jeu = await remplirJeuT07(base);
  porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

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
});

const attendre = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

async function laisserFinir(tours = 10): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await attendre(0);
    });
  }
}

const q = (sel: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(sel);

/** Rend l'écran et attend le plan complet (plus de « Lecture des autres planches… »). */
async function rendreComplet(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranPlan porte={porte} fermeId={jeu.principale.fermeId} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  for (let k = 0; k < 400 && (q('[data-testid="barre"]') === null || conteneur.textContent.includes('Lecture des autres planches')); k++) await laisserFinir(1);
  expect(q('[data-testid="barre"]'), 'barres dessinées').not.toBeNull();
}

async function defilerA(px: number): Promise<void> {
  await act(async () => {
    const d = q('[data-testid="plan-defilement"]');
    if (d === null) throw new Error('plan-defilement absent');
    d.scrollTop = px;
    d.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
  });
  await laisserFinir(3);
}

describe('T11e, relecture B1 : la carte d’alerte reprend le focus', () => {
  it('toucher la carte ouvre le détail ; « Fermer » rend le focus à la carte', async () => {
    await rendreComplet();
    const carte = q('[data-testid="plan-alerte"]');
    expect(carte, 'carte d’alerte affichée').not.toBeNull();
    await act(async () => {
      carte?.click();
      await Promise.resolve();
    });
    await laisserFinir(3);
    const fermer = [...conteneur.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Fermer');
    expect(fermer, 'détail ouvert').toBeDefined();
    await act(async () => {
      fermer?.click();
      await Promise.resolve();
    });
    await laisserFinir(3);
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement, 'focus sur la carte d’alerte').toBe(q('[data-testid="plan-alerte"]'));
  });
});

describe('T11e, relecture N1 : une ligne focalisée n’est pas recyclée au défilement', () => {
  it('barre focalisée, puis défilement loin : le focus reste sur la même culture, dans sa ligne', async () => {
    await rendreComplet();
    const barre = q('[data-testid="barre"]');
    if (barre === null) throw new Error('aucune barre');
    const occupation = barre.dataset.occupation;
    const ligneId = barre.closest<HTMLElement>('[data-testid="ligne-plan"]')?.dataset.id;
    act(() => {
      barre.focus();
    });
    expect(document.activeElement).toBe(barre);
    for (let ligne = 5; ligne <= 120; ligne += 5) await defilerA(ligne * HAUTEUR_LIGNE);
    const actif = document.activeElement as HTMLElement | null;
    expect(actif?.dataset.occupation, 'la barre focalisée montre toujours sa culture').toBe(occupation);
    expect(actif?.closest<HTMLElement>('[data-testid="ligne-plan"]')?.dataset.id, 'dans sa ligne').toBe(ligneId);
    // Les lignes de la fenêtre restent uniques : la ligne gardée n'en double aucune.
    const ids = [...conteneur.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')].map((l) => l.dataset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
