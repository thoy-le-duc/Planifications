// @vitest-environment happy-dom
/**
 * T13g (tests du développeur, en appui de l'e2e de la grande ferme) — l'instantané montré AVANT
 * l'ouverture de la base (porte null), en lecture seule, seulement s'il est de la dernière ferme
 * choisie par cet utilisateur (src/donnees/ferme-memorisee.ts).
 *
 *   A1  Ferme mémorisée = ferme de l'instantané : cartes dessinées, boutons inactifs, marque
 *       de l'écran posée ; la porte arrivée sur cette ferme, les mêmes cartes deviennent actives.
 *   A2  Ferme mémorisée autre, ou aucune : rien de l'instantané, l'écran dit que la base s'ouvre.
 *   A3  La porte arrive sur une autre ferme que la mémorisée : l'instantané n'est plus montré.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { CLE_SESSION } from '../../connexion/session.ts';
import { memoriserFerme } from '../../donnees/ferme-memorisee.ts';
import { EcranAujourdhui, MARQUE_AUJOURDHUI_AFFICHE } from './EcranAujourdhui.tsx';
import { garderInstantane, type StockageInstantane } from './instantane.ts';
import type { CarteVue } from './vues.ts';

const JOUR = '2026-09-30';
const MOI = '0192f0c1-13f0-7000-8000-000000000001';
const FERME = '0192f0c1-13f0-7000-8000-000000000002';
const AUTRE_FERME = '0192f0c1-13f0-7000-8000-000000000003';
const SERIE = '0192f0c1-13f0-7000-8000-000000000004';

const carte: CarteVue = {
  cle: `${SERIE}:semis_direct`,
  retard: false,
  joursRetard: 0,
  surtitre: 'Semer',
  titre: 'Carotte Nantaise',
  detail: 'T1 · 2 planches',
  codes: null,
  minutes: null,
  bande: 'apiacees',
  travail: false,
  peser: false,
  action: 'Marquer fait : semer carotte nantaise',
};

function stockageMemoire(): StockageInstantane {
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify({ utilisateurId: MOI, email: 'a@b.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })],
  ]);
  return {
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v);
    },
    removeItem: (c) => {
      valeurs.delete(c);
    },
  };
}

function avecInstantane(memorisee: string | null): StockageInstantane {
  const s = stockageMemoire();
  garderInstantane(s, { utilisateurId: MOI, fermeId: FERME, jour: JOUR }, {
    semaine: 40,
    taches: [carte],
    retard: 0,
    cetteSemaine: 1,
    recoltes: 0,
    charge: 0,
    historique: [],
    saisies: 0,
  });
  if (memorisee !== null) memoriserFerme(s, MOI, memorisee);
  return s;
}

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  performance.clearMarks(MARQUE_AUJOURDHUI_AFFICHE);
  base = creerBaseMemoire(SCHEMA_LOCAL);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

/** Porte dont les lectures sont retenues : la journée relue n'arrive pas, l'instantané reste. */
function porteSur(fermeId: string): PorteDonnees {
  const vraie = creerPorte(base, { utilisateurId: MOI as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> });
  return { ...vraie, lire: () => new Promise(() => undefined) };
}

async function rendre(porte: PorteDonnees | null, fermeId: string | null, stockage: StockageInstantane): Promise<void> {
  await act(async () => {
    racine.render(<EcranAujourdhui porte={porte} fermeId={fermeId} aujourdhui={() => JOUR} utilisateurId={MOI} stockage={stockage} />);
    await new Promise((r) => setTimeout(r, 0));
  });
}

const boutonFait = () => conteneur.querySelector<HTMLButtonElement>('[data-testid="tache"] button');

describe('T13g : instantané avant l’ouverture de la base', () => {
  it('A1 : ferme mémorisée = ferme de l’instantané → dessiné en lecture seule, puis actif avec la porte', async () => {
    const s = avecInstantane(FERME);
    await rendre(null, null, s);
    expect(conteneur.querySelector('[data-testid="tache"]')?.getAttribute('data-cle')).toBe(carte.cle);
    expect(boutonFait()?.disabled, 'bouton inactif avant la base').toBe(true);
    expect(performance.getEntriesByName(MARQUE_AUJOURDHUI_AFFICHE, 'mark').length).toBe(1);

    const avant = boutonFait();
    await rendre(porteSur(FERME), FERME, s);
    expect(boutonFait()?.disabled, 'bouton actif, base ouverte').toBe(false);
    expect(boutonFait(), 'même écran, sans rechargement').toBe(avant);
  });

  it('A2 : ferme mémorisée autre, ou aucune → rien de l’instantané', async () => {
    for (const memorisee of [AUTRE_FERME, null]) {
      await rendre(null, null, avecInstantane(memorisee));
      expect(conteneur.querySelectorAll('[data-testid="tache"]'), `mémorisée : ${String(memorisee)}`).toHaveLength(0);
      expect(conteneur.textContent).toContain('Ouverture des données de ce téléphone');
      await act(async () => {
        racine.render(<></>);
        await Promise.resolve();
      });
    }
  });

  it('A3 : la porte arrive sur une autre ferme que la mémorisée → l’instantané n’est plus montré', async () => {
    const s = avecInstantane(FERME);
    await rendre(null, null, s);
    expect(conteneur.querySelectorAll('[data-testid="tache"]')).toHaveLength(1);
    await rendre(porteSur(AUTRE_FERME), AUTRE_FERME, s);
    expect(conteneur.querySelector(`[data-cle="${carte.cle}"]`)).toBeNull();
  });
});
