/**
 * Tests d'acceptation T13l — la déconnexion efface les fermes retenues de l'utilisateur
 * (docs/backlog/T13l-gestes-pendant-file.md, contre-relecture T13g).
 *
 * Téléphone partagé (T09b) : rien du compte précédent ne reste lisible. En plus de la session, des
 * refus vus (T10i) et de l'instantané (T13d), `deconnecter` retire les deux clés de fermes de cet
 * utilisateur (src/donnees/ferme-memorisee.ts) :
 *   - `planif.ferme-active.<utilisateurId>` (choix de la ferme, T11) ;
 *   - `planif.ferme-montree.<utilisateurId>` (dernière ferme montrée, T13g).
 * Que l'API réponde ou non, et même si l'effacement de la base échoue. Les clés d'un autre compte
 * ne sont pas touchées (sa ferme lui reste).
 */
import { describe, expect, it } from 'vitest';
import { memoriserFerme, noterFermeMontree } from '../donnees/ferme-memorisee.ts';
import { deconnecter } from './deconnexion.ts';
import { CLE_SESSION, type SessionConnexion } from './session.ts';

const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theo@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};
const AUTRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b99';
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5f01';

function stockage() {
  const valeurs = new Map<string, string>([[CLE_SESSION, JSON.stringify(SESSION)]]);
  const s = {
    valeurs,
    getItem: (c: string) => valeurs.get(c) ?? null,
    setItem: (c: string, v: string) => {
      valeurs.set(c, v);
    },
    removeItem: (c: string) => {
      valeurs.delete(c);
    },
  };
  for (const id of [SESSION.utilisateurId, AUTRE]) {
    memoriserFerme(s, id, FERME);
    noterFermeMontree(s, id, FERME);
  }
  return s;
}

const clesDe = (s: ReturnType<typeof stockage>, utilisateurId: string): string[] =>
  [...s.valeurs.keys()].filter((c) => c.startsWith('planif.ferme-') && c.endsWith(`.${utilisateurId}`));

const reponse = (): Promise<Response> => Promise.resolve(new Response(null, { status: 204 }));
const horsLigne = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

async function deconnexion(o: { fetch: () => Promise<Response>; echecBase?: boolean }) {
  const s = stockage();
  expect(clesDe(s, SESSION.utilisateurId).sort(), 'banc : les deux clés de fermes sont là').toEqual([
    `planif.ferme-active.${SESSION.utilisateurId}`,
    `planif.ferme-montree.${SESSION.utilisateurId}`,
  ]);
  const fin = deconnecter(SESSION, {
    urlApi: 'https://api',
    fetch: () => o.fetch(),
    stockage: s,
    effacerBaseLocale: () => (o.echecBase === true ? Promise.reject(new Error('base locale verrouillée')) : Promise.resolve()),
  });
  if (o.echecBase === true) await expect(fin).rejects.toThrow();
  else await fin;
  return s;
}

describe('T13l : la déconnexion efface les fermes retenues de l’utilisateur', () => {
  it('API joignable : ni planif.ferme-active.<id> ni planif.ferme-montree.<id> ne restent', async () => {
    const s = await deconnexion({ fetch: reponse });
    expect(clesDe(s, SESSION.utilisateurId)).toEqual([]);
  });

  it('hors ligne : retirées quand même', async () => {
    const s = await deconnexion({ fetch: horsLigne });
    expect(clesDe(s, SESSION.utilisateurId)).toEqual([]);
  });

  it('base locale impossible à effacer : la promesse rejette, les clés sont retirées quand même', async () => {
    const s = await deconnexion({ fetch: reponse, echecBase: true });
    expect(clesDe(s, SESSION.utilisateurId)).toEqual([]);
  });

  it('aucune clé de l’utilisateur ne reste en dehors du marqueur d’effacement (session, refus vus, instantané, fermes)', async () => {
    const s = stockage();
    s.valeurs.set(`planif.refus-vus.${SESSION.utilisateurId}`, '[]');
    s.valeurs.set(`planif.aujourdhui.${SESSION.utilisateurId}`, '{}');
    await deconnecter(SESSION, { urlApi: 'https://api', fetch: reponse, stockage: s, effacerBaseLocale: () => Promise.resolve() });
    const restantes = [...s.valeurs.keys()].filter((c) => c.includes(SESSION.utilisateurId) || c === CLE_SESSION);
    expect(restantes).toEqual([]);
  });

  it('les clés de fermes d’un autre compte du téléphone ne sont pas touchées', async () => {
    const s = await deconnexion({ fetch: reponse });
    expect(clesDe(s, AUTRE).sort()).toEqual([`planif.ferme-active.${AUTRE}`, `planif.ferme-montree.${AUTRE}`]);
  });
});
