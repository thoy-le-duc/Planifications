/**
 * Client du moteur de préparation (T14b) : dans un Web Worker (./preparation.worker.ts) quand le
 * navigateur en a, sinon sur le fil principal (même moteur, même résultat : tests sous
 * happy-dom). Une requête à la fois, dans l'ordre.
 */
import type { OrdreEcriture } from '@planif/sync';
import type { MoteurImport } from './preparation.ts';
import type { DemandePreparation, FeuilleLue, Preparateur, Reponse, Requete, ResultatLecture, ResultatPreparation } from './types.ts';

type SansNumero<T> = T extends unknown ? Omit<T, 'n'> : never;

/**
 * Sur le fil principal (sans Worker) : le moteur est chargé à la première demande (morceau à
 * part, hors de celui de l'écran), puis chaque calcul attend un tour pour laisser le rendu passer.
 */
function preparateurDirect(): Preparateur {
  const charge = import('./preparation.ts').then(({ MoteurImport }) => new MoteurImport());
  const differer = async <T,>(f: (moteur: MoteurImport) => T): Promise<T> => {
    const moteur = await charge;
    await new Promise((suite) => setTimeout(suite, 0));
    return f(moteur);
  };
  return {
    lireOctets: (nom, octets) => differer((m) => m.lireOctets(nom, octets)),
    lireFeuille: (nom, feuille) => differer((m) => m.lireFeuille(nom, feuille)),
    preparer: (d) => differer((m) => m.preparer(d)),
    lot: (i) => differer((m) => m.lot(i)),
    fermer: () => undefined,
  };
}

function preparateurWorker(worker: Worker): Preparateur {
  let suivant = 0;
  const enAttente = new Map<number, { readonly resoudre: (v: unknown) => void; readonly rejeter: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<Reponse>) => {
    const r = e.data;
    const attente = enAttente.get(r.n);
    if (attente === undefined) return;
    enAttente.delete(r.n);
    if (r.ok) attente.resoudre(r.valeur);
    else attente.rejeter(new Error(r.message));
  };
  worker.onerror = (e: ErrorEvent) => {
    for (const a of enAttente.values()) a.rejeter(new Error(e.message || 'préparation impossible'));
    enAttente.clear();
  };
  function demander<T>(requete: SansNumero<Requete>, transfert: Transferable[] = []): Promise<T> {
    const n = ++suivant;
    return new Promise<T>((resoudre, rejeter) => {
      enAttente.set(n, { resoudre: resoudre as (v: unknown) => void, rejeter });
      const message: Requete = { ...requete, n };
      worker.postMessage(message, transfert);
    });
  }
  return {
    lireOctets: (nomFichier, octets) => demander<ResultatLecture>({ quoi: 'lireOctets', nomFichier, octets }, [octets.buffer]),
    lireFeuille: (nomFichier, feuille: FeuilleLue) => demander<ResultatLecture>({ quoi: 'lireFeuille', nomFichier, feuille }),
    preparer: (demande: DemandePreparation) => demander<ResultatPreparation>({ quoi: 'preparer', demande }),
    lot: (indice) => demander<readonly OrdreEcriture[]>({ quoi: 'lot', indice }),
    fermer: () => {
      worker.terminate();
      for (const a of enAttente.values()) a.rejeter(new Error('préparation arrêtée'));
      enAttente.clear();
    },
  };
}

export function creerPreparateur(): Preparateur {
  if (typeof Worker === 'undefined') return preparateurDirect();
  try {
    return preparateurWorker(new Worker(new URL('./preparation.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    return preparateurDirect();
  }
}
