/**
 * Tests d'acceptation T09b, 2e relecture sécurité — effacement de la base locale sans PowerSync
 * (src/donnees/effacer.ts), avec un double d'IndexedDB.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Constat de la relecture : une demande `indexedDB.deleteDatabase(nom)` bloquée (base ouverte
 * dans un autre onglet) et abandonnée après DELAI_BASE_OUVERTE_MS reste EN FILE dans IndexedDB ;
 * elle s'exécutera à la fermeture de l'autre onglet, et rien ne l'annule. Chaque essai de la
 * boucle de reprise en empilait une de plus.
 *
 *   supprimerBaseIndexedDb(nom, delaiMs?): Promise<void>
 *     - tant qu'une demande de suppression de `nom` lancée par cette page n'a pas abouti (ni
 *       succès, ni erreur), un nouvel appel N'EN EMPILE PAS d'autre : il attend la même demande
 *       (résout à son succès, rejette à son erreur) ; il rejette quand même après delaiMs si elle
 *       n'a toujours pas abouti (l'écran doit le dire) ;
 *     - une fois la demande aboutie (succès ou erreur), un appel suivant en lance une neuve ;
 *     - deux bases de noms différents ne s'attendent pas.
 *
 *   baseLocaleExiste(utilisateurId: string): Promise<boolean>  (À corriger 1)
 *     vrai si indexedDB.databases() liste nomBaseLocale(utilisateurId) (`planif-<id>.sqlite`),
 *     faux sinon ; indexedDB ou databases() absents, ou databases() qui rejette → vrai (on
 *     demande confirmation plutôt que de risquer une perte silencieuse). Ne charge pas PowerSync.
 *     App.tsx s'en sert pour décider de la confirmation avant de se déconnecter.
 *
 * `baseLocaleExiste` est chargée par un chemin dynamique : ce fichier type avant qu'elle existe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nomBaseLocale, supprimerBaseIndexedDb } from './effacer.ts';

const CHEMIN = './effacer.ts';
const U = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10';

interface DemandeSimulee {
  readonly nom: string;
  onsuccess: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onblocked: ((e: unknown) => void) | null;
  error: Error | null;
}

/** Double d'IndexedDB : chaque deleteDatabase est noté ; le test décide de son issue. */
function indexedDbSimule() {
  const demandes: DemandeSimulee[] = [];
  return {
    demandes,
    indexedDB: {
      deleteDatabase(nom: string): DemandeSimulee {
        const d: DemandeSimulee = { nom, onsuccess: null, onerror: null, onblocked: null, error: null };
        demandes.push(d);
        // Base ouverte ailleurs : bloquée, comme dans le navigateur (événement asynchrone).
        setTimeout(() => d.onblocked?.({}), 0);
        return d;
      },
    },
    reussir(d: DemandeSimulee | undefined) {
      d?.onsuccess?.({});
    },
    echouer(d: DemandeSimulee | undefined) {
      if (d === undefined) return;
      d.error = new Error('échec');
      d.onerror?.({});
    },
  };
}

const attendre = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supprimerBaseIndexedDb : pas de nouvelle demande tant qu’une précédente est en file', () => {
  it('base bloquée : les essais suivants n’empilent pas de deleteDatabase, et rejettent après le délai', async () => {
    const idb = indexedDbSimule();
    vi.stubGlobal('indexedDB', idb.indexedDB);
    const nom = nomBaseLocale(U);

    await expect(supprimerBaseIndexedDb(nom, 20)).rejects.toThrow();
    await expect(supprimerBaseIndexedDb(nom, 20)).rejects.toThrow();
    await expect(supprimerBaseIndexedDb(nom, 20)).rejects.toThrow();
    expect(idb.demandes.map((d) => d.nom)).toEqual([nom]);
  });

  it('un appel qui attend la demande en file résout à son succès ; ensuite, un appel en lance une neuve', async () => {
    const idb = indexedDbSimule();
    vi.stubGlobal('indexedDB', idb.indexedDB);
    const nom = nomBaseLocale(U);

    await expect(supprimerBaseIndexedDb(nom, 20)).rejects.toThrow(); // abandonnée, toujours en file
    const enAttente = supprimerBaseIndexedDb(nom, 5_000);
    await attendre(5);
    expect(idb.demandes).toHaveLength(1);
    idb.reussir(idb.demandes[0]); // l'autre onglet s'est fermé : la demande en file aboutit
    await expect(enAttente).resolves.toBeUndefined();

    const suivante = supprimerBaseIndexedDb(nom, 5_000);
    await attendre(5);
    expect(idb.demandes).toHaveLength(2);
    idb.reussir(idb.demandes[1]);
    await expect(suivante).resolves.toBeUndefined();
  });

  it('demande en file qui échoue : l’appel qui l’attendait rejette, le suivant en lance une neuve', async () => {
    const idb = indexedDbSimule();
    vi.stubGlobal('indexedDB', idb.indexedDB);
    const nom = nomBaseLocale(U);

    const premier = supprimerBaseIndexedDb(nom, 5_000);
    const second = supprimerBaseIndexedDb(nom, 5_000);
    await attendre(5);
    expect(idb.demandes).toHaveLength(1);
    idb.echouer(idb.demandes[0]);
    await expect(premier).rejects.toThrow();
    await expect(second).rejects.toThrow();

    const troisieme = supprimerBaseIndexedDb(nom, 5_000);
    await attendre(5);
    expect(idb.demandes).toHaveLength(2);
    idb.reussir(idb.demandes[1]);
    await expect(troisieme).resolves.toBeUndefined();
  });

  it('deux bases différentes ne s’attendent pas', async () => {
    const idb = indexedDbSimule();
    vi.stubGlobal('indexedDB', idb.indexedDB);
    const a = supprimerBaseIndexedDb(nomBaseLocale(U), 5_000);
    const b = supprimerBaseIndexedDb(nomBaseLocale('autre'), 5_000);
    await attendre(5);
    expect(idb.demandes.map((d) => d.nom)).toEqual([nomBaseLocale(U), nomBaseLocale('autre')]);
    idb.reussir(idb.demandes[0]);
    idb.reussir(idb.demandes[1]);
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });
});

type BaseLocaleExiste = (utilisateurId: string) => Promise<boolean>;

async function baseLocaleExiste(): Promise<BaseLocaleExiste> {
  const module = (await import(CHEMIN)) as { baseLocaleExiste?: unknown };
  if (typeof module.baseLocaleExiste !== 'function') throw new Error('baseLocaleExiste absente de effacer.ts');
  return module.baseLocaleExiste as BaseLocaleExiste;
}

describe('baseLocaleExiste (À corriger 1 : confirmation avant de se déconnecter)', () => {
  it('vrai si indexedDB.databases() liste planif-<id>.sqlite, faux sinon', async () => {
    const existe = await baseLocaleExiste();
    vi.stubGlobal('indexedDB', {
      databases: () => Promise.resolve([{ name: 'autre-base', version: 1 }, { name: nomBaseLocale(U), version: 1 }]),
    });
    expect(await existe(U)).toBe(true);
    expect(await existe('0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b99')).toBe(false);

    vi.stubGlobal('indexedDB', { databases: () => Promise.resolve([]) });
    expect(await existe(U)).toBe(false);
  });

  it('databases() absent, qui rejette, ou indexedDB absent : vrai (confirmation plutôt que perte silencieuse)', async () => {
    const existe = await baseLocaleExiste();
    for (const idb of [{}, { databases: () => Promise.reject(new Error('refusé')) }, undefined]) {
      vi.stubGlobal('indexedDB', idb);
      expect(await existe(U)).toBe(true);
    }
  });
});
