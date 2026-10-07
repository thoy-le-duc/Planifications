/**
 * Web Worker de préparation de l'import (T14b) : lecture du CSV, analyse, plan d'import et ordres
 * d'écriture, hors du fil principal (1 million de lignes prend environ 15 s). Ne charge jamais le
 * lecteur Excel : la page lit le classeur et envoie ses lignes. Protocole : ./types.ts (Requete,
 * Reponse), client : ./preparateur.ts.
 */
import { MoteurImport } from './preparation.ts';
import type { Reponse, Requete } from './types.ts';

const moteur = new MoteurImport();

interface PorteeWorker {
  onmessage: ((e: MessageEvent<Requete>) => void) | null;
  postMessage(message: Reponse): void;
}

const portee = globalThis as unknown as PorteeWorker;

portee.onmessage = (e: MessageEvent<Requete>) => {
  const r = e.data;
  let reponse: Reponse;
  try {
    switch (r.quoi) {
      case 'lireOctets':
        reponse = { n: r.n, ok: true, valeur: moteur.lireOctets(r.nomFichier, r.octets) };
        break;
      case 'lireFeuille':
        reponse = { n: r.n, ok: true, valeur: moteur.lireFeuille(r.nomFichier, r.feuille) };
        break;
      case 'preparer':
        reponse = { n: r.n, ok: true, valeur: moteur.preparer(r.demande) };
        break;
      case 'lot':
        reponse = { n: r.n, ok: true, valeur: moteur.lot(r.indice) };
        break;
    }
  } catch (erreur) {
    reponse = { n: r.n, ok: false, message: erreur instanceof Error ? erreur.message : String(erreur) };
  }
  portee.postMessage(reponse);
};
