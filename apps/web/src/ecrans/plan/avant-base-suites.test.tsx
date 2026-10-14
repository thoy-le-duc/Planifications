// @vitest-environment happy-dom
/**
 * T11h — suites de T11g : l'instantané de « Planches » est vraiment en lecture seule.
 *   B1  base arrivée mais plan pas encore relu : pas de bouton « Modifier la série » ;
 *   B2  détail ouvert sur l'instantané, puis plan relu : le détail ne montre plus la barre ;
 *   B3  saisons lues avant le plan : le sélecteur montre la saison de l'instantané.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../../connexion/session.ts';
import { cleMontree } from '../../donnees/ferme-memorisee.ts';
import { EcranPlan } from './EcranPlan.tsx';
import { type StockageInstantane } from './instantane.ts';

const AUJOURDHUI = '2026-09-30';
const AUTRE_JOUR = '2024-06-15';

let base: BaseMemoire;
let porte: PorteDonnees;
let jeu: JeuT07;

beforeAll(async () => {
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
const bouton = (texte: string): HTMLButtonElement | undefined => [...conteneur.querySelectorAll('button')].find((b) => b.textContent.includes(texte));

function stockage(connecte: string): StockageInstantane & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>();
  valeurs.set(CLE_SESSION, JSON.stringify({ utilisateurId: connecte, email: 'x@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }));
  return {
    valeurs,
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v);
    },
    removeItem: (c) => {
      valeurs.delete(c);
    },
  };
}

/** Rend l'écran sur la base, attend le plan complet puis l'instantané gardé. */
async function garderUnInstantane(s: StockageInstantane): Promise<void> {
  await act(async () => {
    racine.render(<EcranPlan porte={porte} fermeId={jeu.principale.fermeId} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  for (let k = 0; k < 400 && (q('[data-testid="barre"]') === null || conteneur.textContent.includes('Lecture des autres planches')); k++) await laisserFinir(1);
  expect(q('[data-testid="barre"]'), 'barres dessinées').not.toBeNull();
  await act(async () => {
    await attendre(1_200);
  });
}


/** Instantané gardé, puis lancement suivant : base pas encore ouverte, instantané dessiné. */
async function relancerSurInstantane(jour: string): Promise<StockageInstantane> {
  const s = stockage(jeu.utilisateurId);
  await garderUnInstantane(s);
  act(() => {
    racine.unmount();
  });
  s.valeurs.set(cleMontree(jeu.utilisateurId), jeu.principale.fermeId);
  racine = createRoot(conteneur);
  act(() => {
    racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => jour} />);
  });
  expect(q('[data-testid="barre"]'), 'instantané dessiné').not.toBeNull();
  return s;
}

const ouvrirPremiereBarre = (): void => {
  act(() => {
    q('[data-testid="barre"]')?.click();
  });
  expect(q('.plan-detail'), 'détail ouvert').not.toBeNull();
};

describe('T11h — instantané de Planches en lecture seule', () => {
  it('B1 : base arrivée mais plan pas relu : pas de « Modifier la série »', async () => {
    const s = await relancerSurInstantane(AUJOURDHUI);
    ouvrirPremiereBarre();
    // act synchrone : la base est là, mais aucune lecture n'a encore eu le temps de finir.
    act(() => {
      racine.render(<EcranPlan porte={porte} fermeId={jeu.principale.fermeId} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(conteneur.textContent, 'toujours sur l’instantané').toContain('Lecture des autres planches');
    expect(q('.plan-detail')).not.toBeNull();
    expect(bouton('Modifier la série')).toBeUndefined();
  }, 60_000);

  it('B2 : détail ouvert sur l’instantané, puis plan relu : le détail se ferme', async () => {
    const s = await relancerSurInstantane(AUJOURDHUI);
    ouvrirPremiereBarre();
    await act(async () => {
      racine.render(<EcranPlan porte={porte} fermeId={jeu.principale.fermeId} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    for (let k = 0; k < 400 && conteneur.textContent.includes('Lecture des autres planches'); k++) await laisserFinir(1);
    expect(conteneur.textContent).not.toContain('Lecture des autres planches');
    expect(q('.plan-detail'), 'détail de la barre de l’instantané fermé').toBeNull();
  }, 60_000);

  it('B3 : saisons lues avant le plan : le sélecteur garde la saison de l’instantané', async () => {
    // Autre jour au lancement suivant : la saison par défaut lue n'est pas celle de l'instantané.
    const s = await relancerSurInstantane(AUTRE_JOUR);
    const select = conteneur.querySelector('select');
    const attendue = select?.value;
    expect(attendue, 'saison de l’instantané').toBeTruthy();
    // Chaque changement de l'écran : tant que l'instantané est dessiné, la saison montrée est la sienne.
    const vus: (string | undefined)[] = [];
    const veilleur = new MutationObserver(() => {
      if (conteneur.textContent.includes('Lecture des autres planches')) vus.push(conteneur.querySelector('select')?.value);
    });
    veilleur.observe(conteneur, { childList: true, subtree: true, attributes: true, characterData: true });
    await act(async () => {
      racine.render(<EcranPlan porte={porte} fermeId={jeu.principale.fermeId} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUTRE_JOUR} />);
      await Promise.resolve();
    });
    for (let k = 0; k < 400 && conteneur.textContent.includes('Lecture des autres planches'); k++) await laisserFinir(1);
    veilleur.disconnect();
    expect(vus.length, 'changements vus sur l’instantané').toBeGreaterThan(0);
    expect(vus.every((v) => v === attendue), `saisons montrées ${JSON.stringify(vus)}`).toBe(true);
  }, 60_000);
});
