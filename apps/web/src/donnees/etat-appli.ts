/**
 * État des données de l'appli (T11), tel que la coquille le montre : base locale, ferme active,
 * synchro. Types seuls : importé par le JavaScript de démarrage (App.tsx) sans rien charger.
 */
import type { PorteDonnees } from '@planif/sync';
import type { EtatSynchro } from './connecteur.ts';

/**
 * 'ouverture' : base en cours d'ouverture ; 'sans-ferme' : aucune ferme sur ce téléphone (pas
 * encore synchronisée, ou rien à ouvrir) ; 'prete' : ferme active connue ; 'echec' : base
 * illisible.
 */
export type EtatBase = 'ouverture' | 'sans-ferme' | 'prete' | 'echec';

/** Ce qu'un écran de données reçoit : la porte sur la ferme active, rien d'autre. */
export interface FermeOuverte {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
}

export interface EtatDonnees {
  readonly base: EtatBase;
  readonly ferme: FermeOuverte | null;
  readonly synchro: EtatSynchro;
  /** Saisies pas encore envoyées (transactions de la file d'envoi). */
  readonly enAttente: number;
}

export const ETAT_DONNEES_INITIAL: EtatDonnees = { base: 'ouverture', ferme: null, synchro: 'connexion', enAttente: 0 };

/** Base ouverte par l'appli : gardée pour les écrans, fermée à la déconnexion. */
export interface PoigneeDonnees {
  /** Saisies en attente, ou null si la base n'est pas (encore) lisible. */
  compterEnAttente(): Promise<number | null>;
  /** Ferme la base (et n'en ouvre plus) ; à attendre avant d'effacer la base IndexedDB. Ne rejette jamais. */
  fermer(): Promise<void>;
}
