/**
 * T10f, règle 2 (côté téléphone) — un 429 de POST /sync/upload (limite de débit par utilisateur)
 * est une erreur TEMPORAIRE : `envoyerEcritures` lève, la transaction reste en tête de file (pas de
 * `complete()`), elle repartira au prochain essai de PowerSync, identique. Rien n'est perdu, ce
 * n'est ni un refus définitif ni une session expirée (pas de nouveau jeton demandé).
 *
 * Test de non-régression : le traitement actuel (tout statut autre que 200 lève `EchecEnvoi`)
 * le garantit déjà ; il protège contre une future règle « 4xx = refus définitif ».
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerSync, type EcritureCrud, type FileEcritures, type ModuleSync, type OptionsEnvoi } from './test/contrat.ts';

const URL_API = 'https://api.planif.test';

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

const PUT: EcritureCrud = {
  op: 'PUT',
  table: 'evenement',
  id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50',
  opData: { ferme_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20', type: 'recolte', note: 'rang du fond' },
};

describe('T10f : un 429 (trop de requêtes) laisse la transaction dans la file', () => {
  let sync: ModuleSync;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  it('429 avec Retry-After : rejet temporaire (ni SessionExpiree ni complete), puis la même transaction part au prochain essai', async () => {
    const corps: string[] = [];
    let invalidations = 0;
    let statut = 429;
    const f = async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
      corps.push(await new Request(entree, init).text());
      return statut === 429
        ? new Response(JSON.stringify({ erreur: 'trop_de_requetes' }), { status: 429, headers: { 'retry-after': '30', 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ refus: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const options: OptionsEnvoi = {
      urlApi: URL_API,
      fetch: f,
      jetonAcces: () => Promise.resolve('jeton.acces.test'),
      invaliderJeton: () => {
        invalidations++;
      },
    };
    const file = new FileSimulee([[PUT]]);

    const echec = await sync.envoyerEcritures(file, options).then(
      () => null,
      (e: unknown) => e,
    );
    expect(echec, 'envoyerEcritures doit lever sur un 429').toBeInstanceOf(Error);
    expect((echec as Error).name).not.toBe('SessionExpiree');
    expect(file.terminees, 'la transaction reste en tête de file').toEqual([]);
    expect(invalidations, 'un 429 ne demande pas de nouveau jeton').toBe(0);
    expect(corps, 'un seul envoi : pas de boucle sur le 429').toHaveLength(1);

    statut = 200;
    await sync.envoyerEcritures(file, options);
    expect(file.terminees).toEqual([0]);
    expect(corps[1], 'la même transaction, à l’identique').toBe(corps[0]);
  });
});
