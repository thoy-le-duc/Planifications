/**
 * Relecture de T11, C4 — base locale ouverte mais ferme active illisible.
 *
 * Contrat : si la lecture de la ferme active échoue (suivreFermeActive, ./ferme-active.ts : la
 * requête des fermes rejette), l'état publié par ouvrirBaseAppli (./base-appli.ts) passe à
 * base: 'echec' ; la coquille montre alors l'échec au lieu de « Ouverture… » sans fin.
 *
 * PowerSync ne tourne pas sous Node : ./ouvrir.ts est remplacé par une base simulée dont
 * waitForReady réussit et dont chaque lecture (getAll) rejette, ou réussit sans ferme (témoin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtatDonnees } from './etat-appli.ts';

interface BaseSimulee {
  waitForReady(): Promise<void>;
  getAll(sql: string, parametres?: readonly unknown[]): Promise<unknown[]>;
  onChange(): () => void;
}

const simulation = vi.hoisted(() => ({ lecture: (): Promise<unknown[]> => Promise.resolve([]) }));

vi.mock('./ouvrir.ts', () => ({
  ouvrirBaseLocale: () => {
    const base: BaseSimulee = {
      waitForReady: () => Promise.resolve(),
      getAll: () => simulation.lecture(),
      onChange: () => () => undefined,
    };
    return { base, fermer: () => Promise.resolve() };
  },
  compterEcrituresEnAttente: () => Promise.resolve(0),
  synchroniser: () => {
    throw new Error('synchro non attendue : urlPowerSync est null');
  },
}));

const { ouvrirBaseAppli } = await import('./base-appli.ts');

const SESSION = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

const stockage: Pick<Storage, 'getItem' | 'setItem'> = { getItem: () => null, setItem: () => undefined };

async function etatsApres(ms: number): Promise<EtatDonnees[]> {
  const etats: EtatDonnees[] = [];
  const poignee = ouvrirBaseAppli({ session: SESSION, urlApi: 'http://api.invalide', urlPowerSync: null, stockage }, (e) => etats.push(e));
  await new Promise((r) => setTimeout(r, ms));
  await poignee.fermer();
  return etats;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T11, relecture C4 : ferme active illisible', () => {
  it('témoin : lecture réussie sans ferme → base « sans-ferme »', async () => {
    simulation.lecture = () => Promise.resolve([]);
    const etats = await etatsApres(50);
    expect(etats.at(-1)?.base).toBe('sans-ferme');
  });

  it('la lecture des fermes échoue → base « echec », pas « ouverture » sans fin', async () => {
    simulation.lecture = () => Promise.reject(new Error('lecture impossible (disque plein)'));
    const etats = await etatsApres(50);
    expect(etats.map((e) => e.base), 'états publiés').toContain('echec');
    expect(etats.at(-1)?.base).toBe('echec');
    expect(etats.at(-1)?.ferme ?? null).toBeNull();
  });
});
