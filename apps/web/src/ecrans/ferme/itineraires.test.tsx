// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24 — l'entrée « Mes itinéraires » dans l'onglet Ferme
 * (docs/backlog/T24-ecran-itineraires.md ; contrat : ../itineraires/test/contrat.ts, « Modules
 * attendus »). Vrai écran Ferme, DOM simulé, porte sur la base mémoire de la ferme des
 * itinéraires. L'empaquetage (import dynamique) : ../itineraires/empaquetage.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import { FERME, ITINERAIRE, UTILISATEUR } from '../itineraires/test/ferme-itineraires.ts';
import { attendre, bouton, creerBanc, desactive, dialogue, toucher, type Banc } from '../itineraires/test/outils.ts';

/** Attend (import dynamique compris : vitest transforme le module au premier import) qu'une condition soit vraie. */
async function attendreDurant(condition: () => boolean, message: string, ms = 10_000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condition() && Date.now() < limite) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  expect(condition(), message).toBe(true);
}

interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  readonly baseLocale: PoigneeDonnees;
  readonly surDeconnecte: (erreur: string | null) => void;
  readonly etatBase: EtatBase;
}

interface ModuleEcranFerme {
  readonly default: (props: ProprietesEcranFerme) => ReactElement;
}

/** Chemin tenu dans une variable, comme ./ferme.test.tsx. */
const CHEMIN_MODULE = './EcranFerme.tsx';
const SOURCE = readFileSync(join(import.meta.dirname, 'EcranFerme.tsx'), 'utf8');
const MES_ITINERAIRES = 'Mes itinéraires';

const SESSION: SessionConnexion = {
  utilisateurId: UTILISATEUR,
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

const POIGNEE: PoigneeDonnees = {
  compterEnAttente: () => Promise.resolve(0),
  fermer: () => Promise.resolve(),
};

let m: ModuleEcranFerme;
let banc: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranFerme;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  banc = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  banc.base.fermer();
});

async function rendre(etatBase: EtatBase, avecFerme: boolean): Promise<void> {
  const proprietes: ProprietesEcranFerme = { session: SESSION, baseLocale: POIGNEE, surDeconnecte: () => undefined, etatBase };
  await act(async () => {
    racine.render(createElement(ContexteFerme, { value: avecFerme ? { porte: banc.porte, fermeId: FERME } : null }, createElement(m.default, proprietes)));
    await Promise.resolve();
  });
}

describe('T24 : « Mes itinéraires » depuis l’onglet Ferme', () => {
  it('un tap ouvre l’écran des itinéraires (porte et ferme du contexte) ; « Fermer » le retire ; rien n’est écrit', async () => {
    await rendre('prete', true);
    const b = bouton(MES_ITINERAIRES, conteneur);
    expect(desactive(b)).toBe(false);
    banc.remiseAZero();
    await toucher(b);
    await attendreDurant(() => dialogue(MES_ITINERAIRES) !== undefined, 'l’écran « Mes itinéraires » s’ouvre (import dynamique compris)');
    const ecran = dialogue(MES_ITINERAIRES);
    await attendreDurant(
      () => ecran?.querySelector(`[data-testid="itineraire"][data-itineraire="${ITINERAIRE.bataviaFerme}"]`) !== null,
      'les itinéraires de la ferme du contexte sont lus',
    );
    const fermer = [...(ecran?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter((x) => (x.getAttribute('aria-label') ?? x.textContent).trim() === 'Fermer');
    expect(fermer.length).toBeGreaterThan(0);
    const f = fermer[fermer.length - 1];
    if (f === undefined) return;
    await toucher(f);
    await attendre(() => dialogue(MES_ITINERAIRES) === undefined, 'l’écran se ferme');
    expect(banc.transactions()).toBe(0);
    expect(bouton(MES_ITINERAIRES, conteneur), 'retour à l’onglet Ferme').toBeDefined();
  });

  it('base pas prête ou sans ferme : « Mes itinéraires » désactivé', async () => {
    for (const [etat, ferme] of [
      ['ouverture', false],
      ['sans-ferme', false],
      ['echec', false],
      ['prete', false],
    ] as const) {
      await rendre(etat, ferme);
      expect(desactive(bouton(MES_ITINERAIRES, conteneur)), `${etat}, ferme ${String(ferme)}`).toBe(true);
    }
  });

  it('l’écran des itinéraires est chargé par import dynamique, jamais par un import statique', () => {
    expect(SOURCE).toMatch(/import\(\s*['"]\.\.\/itineraires\/index\.ts['"]\s*\)/);
    expect(SOURCE, 'aucun import statique (hors `import type`)').not.toMatch(/^\s*import\s(?!type\s)[^;]*from\s+['"]\.\.\/itineraires\//m);
  });
});
