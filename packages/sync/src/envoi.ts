/**
 * Envoi des écritures en attente (cœur de `uploadData` du connecteur PowerSync).
 *
 * Règle de PowerSync : si l'envoi lève, la transaction reste en tête de file et repartira ;
 * `complete()` la retire. Le serveur répond 200 même quand il refuse une écriture pour une règle
 * métier (le refus redescend par la synchro) : un refus ne bloque donc jamais la file. Une panne
 * (réseau, 5xx) laisse la transaction en place.
 *
 * Jeton refusé (401) : l'horloge du téléphone peut le croire valide alors que le serveur l'a
 * déjà expiré. On l'invalide, on en demande un neuf et on renvoie la même transaction, une seule
 * fois ; un second 401 lève `SessionExpiree` (reconnexion nécessaire), la transaction reste.
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

/** Session expirée ou révoquée : seule une nouvelle connexion débloque la synchro. */
export class SessionExpiree extends Error {
  constructor() {
    super('session expirée : reconnexion nécessaire');
    this.name = 'SessionExpiree';
  }
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
  const poster = async (corps: string): Promise<number> => {
    const jeton = await options.jetonAcces();
    const reponse = await envoyer(`${options.urlApi}/sync/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
      body: corps,
    });
    return reponse.status;
  };
  for (;;) {
    const transaction = await file.getNextCrudTransaction();
    if (transaction === null) return;
    const corps = JSON.stringify({ ecritures: transaction.crud.map(versEnvoi) });
    let statut = await poster(corps);
    if (statut === 401) {
      // Un seul nouvel essai, avec un jeton neuf demandé au serveur.
      options.invaliderJeton();
      statut = await poster(corps);
      if (statut === 401) throw new SessionExpiree();
    }
    if (statut !== 200) {
      throw new EchecEnvoi(`envoi des écritures : réponse ${String(statut)}, nouvel essai plus tard`);
    }
    await transaction.complete();
  }
}
