/**
 * Tests d'acceptation T10 — envoi des écritures en attente (`envoyerEcritures`, le cœur de
 * `uploadData` du connecteur PowerSync), avec une file et un `fetch` simulés.
 *
 * Règle de PowerSync : si `uploadData` lève, la transaction reste en tête de file et sera
 * renvoyée ; si elle est marquée `complete()`, elle quitte la file. Le serveur répond 200 même
 * quand il refuse une écriture pour une règle métier (le refus redescend par la synchro) : la
 * file n'est donc jamais bloquée par un refus. Une panne (réseau, 5xx) ou un jeton refusé (401)
 * laisse la transaction dans la file.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerSync, type EcritureCrud, type FileEcritures, type ModuleSync, type OptionsEnvoi } from './test/contrat.ts';

const URL_API = 'https://api.planif.test';
const JETON = 'jeton.acces.test';

interface Appel {
  readonly url: string;
  readonly methode: string;
  readonly entetes: Headers;
  readonly corps: unknown;
}

class FileSimulee implements FileEcritures {
  readonly terminees: number[] = [];
  private position = 0;
  private readonly transactions: readonly (readonly EcritureCrud[])[];

  constructor(transactions: readonly (readonly EcritureCrud[])[]) {
    this.transactions = transactions;
  }

  getNextCrudTransaction() {
    const i = this.position;
    const crud = this.transactions[i];
    if (crud === undefined) return Promise.resolve(null);
    return Promise.resolve({
      crud,
      complete: () => {
        this.terminees.push(i);
        this.position = i + 1;
        return Promise.resolve();
      },
    });
  }
}

function fetchSimule(reponses: readonly (number | 'reseau')[]): { fetch: typeof fetch; appels: Appel[] } {
  const appels: Appel[] = [];
  let n = 0;
  const f = async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requete = new Request(entree, init);
    const texte = await requete.text();
    appels.push({
      url: requete.url,
      methode: requete.method,
      entetes: requete.headers,
      corps: texte === '' ? undefined : (JSON.parse(texte) as unknown),
    });
    const r = reponses[Math.min(n++, reponses.length - 1)];
    if (r === 'reseau' || r === undefined) throw new TypeError('Failed to fetch');
    return new Response(r === 200 ? JSON.stringify({ refus: [] }) : JSON.stringify({ erreur: 'x' }), {
      status: r,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: f, appels };
}

function options(f: typeof fetch): OptionsEnvoi {
  return { urlApi: URL_API, fetch: f, jetonAcces: () => Promise.resolve(JETON) };
}

const PUT_RECOLTE: EcritureCrud = {
  op: 'PUT',
  table: 'evenement',
  id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50',
  opData: {
    ferme_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20',
    type: 'recolte',
    date: '2026-10-01',
    detail: '{"quantite":12.5,"unite":"kg","categorie":null}',
  },
};
const PATCH_NOTE: EcritureCrud = {
  op: 'PATCH',
  table: 'evenement',
  id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50',
  opData: { note: 'modifiée' },
};
const DELETE_EVENEMENT: EcritureCrud = { op: 'DELETE', table: 'evenement', id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b51' };

describe('T10 : envoi des écritures (envoyerEcritures)', () => {
  let sync: ModuleSync;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  it('envoie chaque transaction en POST /sync/upload, avec le jeton, dans l’ordre, puis vide la file', async () => {
    const file = new FileSimulee([[PUT_RECOLTE], [PATCH_NOTE, DELETE_EVENEMENT]]);
    const { fetch, appels } = fetchSimule([200]);
    await sync.envoyerEcritures(file, options(fetch));

    expect(appels).toHaveLength(2);
    for (const a of appels) {
      expect(a.url).toBe(`${URL_API}/sync/upload`);
      expect(a.methode).toBe('POST');
      expect(a.entetes.get('authorization')).toBe(`Bearer ${JETON}`);
      expect(a.entetes.get('content-type')).toMatch(/^application\/json/);
    }
    expect(appels[0]?.corps).toEqual({
      ecritures: [{ op: 'PUT', table: 'evenement', id: PUT_RECOLTE.id, donnees: PUT_RECOLTE.opData }],
    });
    expect(appels[1]?.corps).toEqual({
      ecritures: [
        { op: 'PATCH', table: 'evenement', id: PATCH_NOTE.id, donnees: { note: 'modifiée' } },
        { op: 'DELETE', table: 'evenement', id: DELETE_EVENEMENT.id },
      ],
    });
    expect(file.terminees).toEqual([0, 1]);
  });

  it('file vide : aucun appel', async () => {
    const { fetch, appels } = fetchSimule([200]);
    await sync.envoyerEcritures(new FileSimulee([]), options(fetch));
    expect(appels).toHaveLength(0);
  });

  it('hors ligne : lève sans retirer la transaction, qui repart au prochain essai', async () => {
    const file = new FileSimulee([[PUT_RECOLTE]]);
    const horsLigne = fetchSimule(['reseau']);
    await expect(sync.envoyerEcritures(file, options(horsLigne.fetch))).rejects.toThrow();
    expect(file.terminees).toEqual([]);

    const retour = fetchSimule([200]);
    await sync.envoyerEcritures(file, options(retour.fetch));
    expect(retour.appels).toHaveLength(1);
    expect(retour.appels[0]?.corps).toEqual(horsLigne.appels[0]?.corps);
    expect(file.terminees).toEqual([0]);
  });

  it.each([500, 502, 503, 401])('réponse %i : lève sans retirer la transaction', async (statut) => {
    const file = new FileSimulee([[PUT_RECOLTE], [PATCH_NOTE]]);
    const { fetch, appels } = fetchSimule([statut]);
    await expect(sync.envoyerEcritures(file, options(fetch))).rejects.toThrow();
    expect(appels).toHaveLength(1);
    expect(file.terminees).toEqual([]);
  });

  it('une écriture refusée par le serveur (200 avec refus) ne bloque pas la file', async () => {
    const file = new FileSimulee([[PATCH_NOTE], [PUT_RECOLTE]]);
    const appels: unknown[] = [];
    const f = ((_entree: string | URL | Request, init?: RequestInit) => {
      appels.push(init?.body);
      const refus = appels.length === 1 ? [{ table: 'evenement', id: PATCH_NOTE.id, motif: 'ajout_seul' }] : [];
      return Promise.resolve(new Response(JSON.stringify({ refus }), { status: 200 }));
    }) as typeof fetch;
    await sync.envoyerEcritures(file, options(f));
    expect(appels).toHaveLength(2);
    expect(file.terminees).toEqual([0, 1]);
  });
});
