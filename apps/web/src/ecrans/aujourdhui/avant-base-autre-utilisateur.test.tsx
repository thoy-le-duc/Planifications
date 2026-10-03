// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13l — isolement entre utilisateurs avant l'ouverture de la base
 * (docs/backlog/T13l-gestes-pendant-file.md, constat de la relecture T13g : « autre utilisateur,
 * même ferme » avant la base n'était pas testé).
 *
 * Téléphone partagé : deux comptes, MOI et AUTRE, membres de la MÊME ferme. L'instantané de la
 * journée d'AUTRE ne doit jamais être dessiné pour MOI, ni avant la base (porte null), ni après
 * (porte ouverte, journée pas encore relue). Même banc que ./avant-base.test.tsx.
 *
 *   U1  Instantané d'AUTRE rangé sous sa clé, ferme montrée = la ferme pour les deux : rien de
 *       lui pour MOI (avant la base, puis porte ouverte aux lectures retenues).
 *   U2  Copie de l'instantané d'AUTRE (il porte utilisateurId = AUTRE) rangée sous la clé de
 *       MOI : rien.
 *   U3  La session rangée est celle d'AUTRE (MOI déconnecté, AUTRE connecté dans un autre
 *       onglet) alors que l'écran est encore rendu pour MOI : l'instantané de MOI n'est pas
 *       montré au téléphone d'AUTRE. Règle miroir de R3 (T13d) : l'instantané ne s'écrit que
 *       pour l'utilisateur de la session rangée ; il ne se montre aussi qu'à lui.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { CLE_SESSION } from '../../connexion/session.ts';
import { noterFermeMontree } from '../../donnees/ferme-memorisee.ts';
import { cleInstantane } from './cle-instantane.ts';
import { EcranAujourdhui } from './EcranAujourdhui.tsx';
import { garderInstantane, type StockageInstantane } from './instantane.ts';
import type { CarteVue } from './vues.ts';

const JOUR = '2026-09-30';
const MOI = '0192f0c1-13f1-7000-8000-000000000001';
const AUTRE = '0192f0c1-13f1-7000-8000-000000000009';
const FERME = '0192f0c1-13f1-7000-8000-000000000002';
const SERIE_MOI = '0192f0c1-13f1-7000-8000-000000000004';
const SERIE_AUTRE = '0192f0c1-13f1-7000-8000-000000000005';

const carte = (serie: string, titre: string): CarteVue => ({
  cle: `${serie}:semis_direct`,
  retard: false,
  joursRetard: 0,
  surtitre: 'Semer',
  titre,
  detail: 'T1 · 2 planches',
  codes: null,
  minutes: null,
  bande: 'apiacees',
  travail: false,
  peser: false,
  action: `Marquer fait : semer ${titre.toLowerCase()}`,
});

const vue = (c: CarteVue) => ({
  semaine: 40,
  taches: [c],
  retard: 0,
  cetteSemaine: 1,
  recoltes: 0,
  charge: 0,
  historique: [],
  saisies: 0,
});

interface StockageTest extends StockageInstantane {
  readonly valeurs: Map<string, string>;
}

const session = (utilisateurId: string) =>
  JSON.stringify({ utilisateurId, email: 'a@b.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) });

function stockageMemoire(connecte: string): StockageTest {
  const valeurs = new Map<string, string>([[CLE_SESSION, session(connecte)]]);
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

/** Range l'instantané de `utilisateurId` (garderInstantane n'écrit que pour la session rangée). */
function rangerInstantane(s: StockageTest, utilisateurId: string, c: CarteVue): void {
  const avant = s.valeurs.get(CLE_SESSION);
  s.valeurs.set(CLE_SESSION, session(utilisateurId));
  garderInstantane(s, { utilisateurId, fermeId: FERME, jour: JOUR }, vue(c));
  if (avant === undefined) s.valeurs.delete(CLE_SESSION);
  else s.valeurs.set(CLE_SESSION, avant);
  expect(s.valeurs.has(cleInstantane(utilisateurId)), `instantané de ${utilisateurId} rangé`).toBe(true);
}

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

/** Porte de MOI sur la ferme, lectures retenues : la journée relue n'arrive pas. */
function porteRetenue(): PorteDonnees {
  const vraie = creerPorte(base, { utilisateurId: MOI as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  return { ...vraie, lire: () => new Promise(() => undefined) };
}

async function rendre(porte: PorteDonnees | null, stockage: StockageInstantane): Promise<void> {
  await act(async () => {
    racine.render(<EcranAujourdhui porte={porte} fermeId={porte === null ? null : FERME} aujourdhui={() => JOUR} utilisateurId={MOI} stockage={stockage} />);
    await new Promise((r) => setTimeout(r, 0));
  });
}

const cartes = (): string[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')].map((t) => String(t.dataset.cle));

describe('T13l : instantané d’un autre utilisateur sur la même ferme, avant la base', () => {
  it('U1 : celui d’AUTRE, rangé sous sa clé, n’est jamais dessiné pour MOI (avant la base, puis porte ouverte)', async () => {
    const s = stockageMemoire(MOI);
    rangerInstantane(s, AUTRE, carte(SERIE_AUTRE, 'Panais'));
    noterFermeMontree(s, AUTRE, FERME);
    noterFermeMontree(s, MOI, FERME);

    await rendre(null, s);
    expect(cartes(), 'avant la base : rien de l’instantané d’AUTRE').toEqual([]);
    expect(conteneur.textContent).not.toContain('Panais');

    await rendre(porteRetenue(), s);
    expect(cartes(), 'porte ouverte, journée pas encore relue : rien de l’instantané d’AUTRE').toEqual([]);
    expect(conteneur.textContent).not.toContain('Panais');
  });

  it('U2 : une copie de l’instantané d’AUTRE sous la clé de MOI n’est pas dessinée', async () => {
    const s = stockageMemoire(MOI);
    rangerInstantane(s, AUTRE, carte(SERIE_AUTRE, 'Panais'));
    const brut = s.valeurs.get(cleInstantane(AUTRE));
    if (brut === undefined) throw new Error('instantané d’AUTRE absent');
    s.valeurs.set(cleInstantane(MOI), brut);
    noterFermeMontree(s, MOI, FERME);

    await rendre(null, s);
    expect(cartes()).toEqual([]);
    expect(conteneur.textContent).not.toContain('Panais');
  });

  it('U3 : session rangée d’AUTRE, écran encore rendu pour MOI : l’instantané de MOI n’est pas montré', async () => {
    const s = stockageMemoire(MOI);
    rangerInstantane(s, MOI, carte(SERIE_MOI, 'Carotte'));
    noterFermeMontree(s, MOI, FERME);
    // Témoin : avec la session de MOI, son instantané est bien dessiné avant la base.
    await rendre(null, s);
    expect(cartes(), 'témoin : session de MOI, son instantané est dessiné').toEqual([`${SERIE_MOI}:semis_direct`]);
    await act(async () => {
      racine.render(<></>);
      await Promise.resolve();
    });

    // AUTRE s'est connecté entre temps (autre onglet) : la session rangée est la sienne.
    s.valeurs.set(CLE_SESSION, session(AUTRE));
    await rendre(null, s);
    expect(cartes(), 'session d’AUTRE : rien de l’instantané de MOI').toEqual([]);
    expect(conteneur.textContent).not.toContain('Carotte');
  });
});
