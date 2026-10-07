// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14b — l'entrée « Importer un tableur » dans l'onglet Ferme (contrat :
 * ./test/contrat.ts, « Modules attendus »), comme « Mes itinéraires » de T24
 * (../ferme/itineraires.test.tsx) : vrai écran Ferme, DOM simulé, porte sur la base mémoire de la
 * ferme de l'import. L'empaquetage (import dynamique) : ./empaquetage.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import { NOM_ECRAN } from './test/contrat.ts';
import { FERME, UTILISATEUR } from './test/ferme-import.ts';
import { attendreDurant, bouton, creerBanc, desactive, toucher, type Banc } from './test/harnais.ts';
import { dialogue } from '../itineraires/test/outils.ts';

interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  readonly baseLocale: PoigneeDonnees;
  readonly surDeconnecte: (erreur: string | null) => void;
  readonly etatBase: EtatBase;
}

interface ModuleEcranFerme {
  readonly default: (props: ProprietesEcranFerme) => ReactElement;
}

const CHEMIN_MODULE = '../ferme/EcranFerme.tsx';
const SOURCE = readFileSync(join(import.meta.dirname, '../ferme/EcranFerme.tsx'), 'utf8');
const IMPORTER = 'Importer un tableur';

const SESSION: SessionConnexion = { utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) };
const POIGNEE: PoigneeDonnees = { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };

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

describe('T14b : « Importer un tableur » depuis l’onglet Ferme', () => {
  it('un tap ouvre l’écran d’import (étape 1) ; « Fermer » le retire ; rien n’est écrit', async () => {
    await rendre('prete', true);
    const b = bouton(IMPORTER, conteneur);
    expect(desactive(b)).toBe(false);
    banc.remiseAZero();
    await toucher(b);
    await attendreDurant(() => dialogue(NOM_ECRAN) !== undefined, 'l’écran d’import s’ouvre (import dynamique compris)');
    const ecran = dialogue(NOM_ECRAN);
    expect(ecran?.dataset.etape).toBe('depot');
    const fermer = [...(ecran?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter((x) => (x.getAttribute('aria-label') ?? x.textContent).trim() === 'Fermer');
    const f = fermer[fermer.length - 1];
    expect(f).toBeDefined();
    if (f === undefined) return;
    await toucher(f);
    await attendreDurant(() => dialogue(NOM_ECRAN) === undefined, 'l’écran se ferme');
    expect(banc.transactions()).toBe(0);
  });

  it('base pas prête ou sans ferme : « Importer un tableur » désactivé', async () => {
    for (const [etat, ferme] of [
      ['ouverture', false],
      ['sans-ferme', false],
      ['echec', false],
      ['prete', false],
    ] as const) {
      await rendre(etat, ferme);
      expect(desactive(bouton(IMPORTER, conteneur)), `${etat}, ferme ${String(ferme)}`).toBe(true);
    }
  });

  it('l’écran d’import est chargé par import dynamique, jamais par un import statique', () => {
    expect(SOURCE).toMatch(/import\(\s*['"]\.\.\/import\/index\.ts['"]\s*\)/);
    expect(SOURCE, 'aucun import statique (hors `import type`)').not.toMatch(/^\s*import\s(?!type\s)[^;]*from\s+['"]\.\.\/import\//m);
  });
});
