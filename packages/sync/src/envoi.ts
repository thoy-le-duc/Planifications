/**
 * Envoi des écritures en attente (cœur de `uploadData` du connecteur PowerSync).
 *
 * Règle de PowerSync : si l'envoi lève, la transaction reste en tête de file et repartira ;
 * `complete()` la retire. Le serveur répond 200 même quand il refuse une écriture pour une règle
 * métier (le refus redescend par la synchro) : un refus ne bloque donc jamais la file. Une panne
 * (réseau, 5xx) ou un jeton refusé (401) laisse la transaction en place.
 */
import type { EcritureCrud, FileEcritures, OptionsEnvoi } from './types.ts';

/** Écriture telle que POST /sync/upload la reçoit. */
interface EcritureEnvoyee {
  readonly op: EcritureCrud['op'];
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

function versEnvoi(e: EcritureCrud): EcritureEnvoyee {
  const { op, table, id, opData } = e;
  return op === 'DELETE' || opData === undefined ? { op, table, id } : { op, table, id, donnees: opData };
}

export class EchecEnvoi extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EchecEnvoi';
  }
}

/** Vide la file, transaction par transaction, dans l'ordre. */
export async function envoyerEcritures(file: FileEcritures, options: OptionsEnvoi): Promise<void> {
  // Appel détaché : window.fetch appelé comme méthode d'un autre objet lèverait « Illegal invocation ».
  const envoyer = options.fetch;
  for (;;) {
    const transaction = await file.getNextCrudTransaction();
    if (transaction === null) return;
    const jeton = await options.jetonAcces();
    const reponse = await envoyer(`${options.urlApi}/sync/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ecritures: transaction.crud.map(versEnvoi) }),
    });
    if (reponse.status !== 200) {
      throw new EchecEnvoi(`envoi des écritures : réponse ${String(reponse.status)}, nouvel essai plus tard`);
    }
    await transaction.complete();
  }
}
