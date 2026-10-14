// @vitest-environment happy-dom
/**
 * T11g — l'écran « Planches » avant la base (développeur ; s'ajoute à ./instantane.test.ts) :
 *   A1  le plan relu affiché devient l'instantané (son début seulement) ;
 *   A2  base pas encore ouverte (porte nulle) : l'instantané de la dernière ferme montrée est
 *       dessiné dès le premier rendu, en lecture seule (ni création, ni saison, ni 3D) ;
 *   A3  la base arrive sur la même ferme : le plan relu le remplace, sans redessiner l'écran ;
 *   A4  autre utilisateur connecté, autre ferme, ou aucune ferme montrée : rien de l'instantané.
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
import { cleInstantanePlan } from './cle-instantane.ts';
import { EcranPlan, MARQUE_PLAN_AFFICHE } from './EcranPlan.tsx';
import { cleFermeMontree, LIGNES_INSTANTANE, lireInstantanePlan, type StockageInstantane } from './instantane.ts';

const AUJOURDHUI = '2026-09-30';
const AUTRE_UTILISATEUR = '0192f0c1-11a0-7000-8000-00000000a001';
const AUTRE_FERME = '0192f0c1-11a0-7000-8000-00000000a0f2';

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

describe('T11g — Planches avant la base', () => {
  it('la clé de la ferme montrée lue par l’écran est celle de donnees/ferme-memorisee.ts', () => {
    expect(cleFermeMontree(jeu.utilisateurId)).toBe(cleMontree(jeu.utilisateurId));
  });

  it('A1 à A3 : instantané gardé, dessiné avant la base en lecture seule, puis remplacé par le plan relu', async () => {
    const s = stockage(jeu.utilisateurId);
    await garderUnInstantane(s);
    const lu = lireInstantanePlan(s, { utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId });
    expect(lu, 'instantané gardé').not.toBeNull();
    expect(lu?.plan.lignes.length).toBeLessThanOrEqual(LIGNES_INSTANTANE);
    expect(lu?.totalLignes).toBeGreaterThan(LIGNES_INSTANTANE);
    expect(lu?.plan.batiments).toBeUndefined();
    act(() => {
      racine.unmount();
    });

    // Lancement suivant : la base s'ouvre (porte nulle), dernière ferme montrée retenue.
    s.valeurs.set(cleMontree(jeu.utilisateurId), jeu.principale.fermeId);
    racine = createRoot(conteneur);
    performance.clearMarks(MARQUE_PLAN_AFFICHE);
    act(() => {
      racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(q('[data-testid="ligne-plan"]'), 'lignes de l’instantané dès le premier rendu').not.toBeNull();
    expect(q('[data-testid="barre"]')).not.toBeNull();
    expect(performance.getEntriesByName(MARQUE_PLAN_AFFICHE, 'mark').length).toBe(1);
    expect(conteneur.textContent).toContain('Lecture des autres planches');
    expect(bouton('Nouvelle série')?.disabled, 'pas de création sur l’instantané').toBe(true);
    expect(bouton('Voir en 3D')?.disabled).toBe(true);
    expect(conteneur.querySelector('select')?.disabled).toBe(true);
    const grille = q('.plan-grille');

    // La base arrive : même écran, plan relu.
    await act(async () => {
      racine.render(<EcranPlan porte={porte} fermeId={jeu.principale.fermeId} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    for (let k = 0; k < 400 && conteneur.textContent.includes('Lecture des autres planches'); k++) await laisserFinir(1);
    expect(conteneur.textContent).not.toContain('Lecture des autres planches');
    expect(q('.plan-grille'), 'écran pas redessiné').toBe(grille);
    expect(bouton('Nouvelle série')?.disabled).toBe(false);
    expect(conteneur.querySelector('select')?.disabled).toBe(false);
  }, 60_000);

  it('A4 : autre utilisateur connecté, autre ferme, ou aucune ferme montrée : rien de l’instantané', async () => {
    const s = stockage(jeu.utilisateurId);
    await garderUnInstantane(s);
    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);

    // Aucune ferme montrée retenue.
    act(() => {
      racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(q('[data-testid="ligne-plan"]')).toBeNull();
    expect(conteneur.textContent).toContain('Ouverture des données de ce téléphone');

    // Autre ferme montrée : rien.
    s.valeurs.set(cleMontree(jeu.utilisateurId), AUTRE_FERME);
    act(() => {
      racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(q('[data-testid="ligne-plan"]')).toBeNull();

    // Un autre compte connecté : son écran ne montre rien de l'instantané du premier.
    s.valeurs.set(cleMontree(jeu.utilisateurId), jeu.principale.fermeId);
    s.valeurs.set(cleMontree(AUTRE_UTILISATEUR), jeu.principale.fermeId);
    s.valeurs.set(cleInstantanePlan(AUTRE_UTILISATEUR), s.valeurs.get(cleInstantanePlan(jeu.utilisateurId)) ?? '');
    s.valeurs.set(CLE_SESSION, JSON.stringify({ utilisateurId: AUTRE_UTILISATEUR, email: 'y@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }));
    act(() => {
      racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={AUTRE_UTILISATEUR} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(q('[data-testid="ligne-plan"]')).toBeNull();
    // Et le premier utilisateur, sa session n'étant plus rangée, non plus.
    act(() => {
      racine.render(<EcranPlan porte={null} fermeId={null} utilisateurId={jeu.utilisateurId} stockage={s} aujourdhui={() => AUJOURDHUI} />);
    });
    expect(q('[data-testid="ligne-plan"]')).toBeNull();
  }, 60_000);
});
