// @vitest-environment happy-dom
/**
 * T13v — suites de T13u : le préchargement du plan se presse de bout en bout.
 *
 *   1. deux `prechargerPlan` en même temps (App.tsx relance à chaque nouvel objet `ferme`) : l'écran
 *      Planches presse les deux, il n'attend pas CESSION_MAX_MS ;
 *   2. une lecture levée par `presser` libère l'attente de `cederAuxSaisies` tout de suite : ni
 *      minuteur ni observateur ne reste ;
 *   3. passage « pressé » au milieu de la lecture des emplacements par pages : toutes les lignes,
 *      une seule fois.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { commencerEcriture } from '../../donnees/ecritures-en-cours.ts';
import { CESSION_MAX_MS, cederAuxSaisies, obtenirDebutDePlan, obtenirSaisons, porteQuiCede, prechargerPlan } from './cache.ts';
import { DECOUPE_FOND, lireDebutDePlan, saisonParDefaut, SANS_DECOUPE } from './calculs.ts';

const AUJOURDHUI = '2026-09-30';

let base: BaseMemoire;
let porte: PorteDonnees;
let jeu: JeuT07;
const fins: (() => void)[] = [];

beforeAll(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  jeu = await remplirJeuT07(base);
  porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

afterEach(() => {
  for (const fin of fins.splice(0)) fin();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const attendre = (ms: number) =>
  new Promise<void>((tenir) => {
    setTimeout(tenir, ms);
  });

describe('T13v : deux préchargements pour la même ferme', () => {
  it('l’écran Planches rend le plan sans attendre CESSION_MAX_MS', async () => {
    fins.push(commencerEcriture());
    // Une porte propre à ce test : le cache du plan est par porte.
    const p: PorteDonnees = { ...porte, lire: <T>(sql: string, parametres?: readonly unknown[]) => porte.lire<T>(sql, parametres) };
    const fermeId = jeu.principale.fermeId;
    const un = prechargerPlan(p, fermeId, AUJOURDHUI);
    const deux = prechargerPlan(p, fermeId, AUJOURDHUI);
    await attendre(30);
    const debut = Date.now();
    const saison = saisonParDefaut(await obtenirSaisons(p, fermeId), AUJOURDHUI);
    if (saison === null) throw new Error('aucune saison');
    const lu = await obtenirDebutDePlan(p, fermeId, saison, AUJOURDHUI);
    expect(Date.now() - debut, 'sans attendre CESSION_MAX_MS').toBeLessThan(CESSION_MAX_MS / 2);
    expect(lu.plan.lignes.length).toBeGreaterThan(0);
    await Promise.all([un, deux]);
  });
});

describe('T13v : presser libère l’attente de cederAuxSaisies', () => {
  it('aucun minuteur ni observateur ne reste après presser', async () => {
    vi.useFakeTimers();
    fins.push(commencerEcriture());
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const lecteur = porteQuiCede({ ...porte, lire: <T>() => Promise.resolve([] as T[]) }, cederAuxSaisies);
    const lue = lecteur.porte.lire('SELECT 1');
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount(), 'attente en cours : le minuteur de cession').toBeGreaterThan(0);
    lecteur.presser();
    await lue;
    expect(vi.getTimerCount(), 'aucun minuteur après presser').toBe(0);
    expect(disconnect, 'observateur déconnecté').toHaveBeenCalled();
  });
});

describe('T13v : pressé au milieu de la lecture des emplacements par pages', () => {
  it('toutes les lignes lues, une seule fois', async () => {
    const fermeId = jeu.principale.fermeId;
    const reference = await lireDebutDePlan(porte, fermeId, 12, () => SANS_DECOUPE);
    let pages = 0;
    const lues: string[] = [];
    const espion: PorteDonnees = {
      ...porte,
      lire: async <T>(sql: string, parametres?: readonly unknown[]) => {
        const rendu = await porte.lire<T>(sql, parametres);
        if (sql.includes('FROM emplacement WHERE')) {
          pages += 1;
          for (const l of rendu as readonly { id?: unknown }[]) lues.push(String(l.id));
        }
        return rendu;
      },
    };
    // Pressé après la première page : le reste d'un coup.
    const presse = () => pages >= 1;
    const d = await lireDebutDePlan(espion, fermeId, 12, () => (presse() ? SANS_DECOUPE : DECOUPE_FOND));
    expect(pages, 'au moins une page puis le reste').toBeGreaterThanOrEqual(2);
    expect(new Set(lues).size, 'chaque emplacement une seule fois').toBe(lues.length);
    expect(lues.length).toBe(reference.structure.emplacement.length);
    expect(d.structure.emplacement.map((e) => String(e.id)).sort()).toEqual(reference.structure.emplacement.map((e) => String(e.id)).sort());
  });
});
