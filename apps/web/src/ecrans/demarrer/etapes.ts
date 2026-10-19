/**
 * Parcours guidé « Démarrer votre ferme » (T49) : les quatre étapes d'une ferme neuve, cochées
 * selon l'état réel de la base, et la demande de navigation d'un écran à l'autre. Pur, sans React :
 * partagé par les écrans Aujourd'hui, Planches et Ferme (morceaux chargés à la demande), jamais
 * par le JavaScript de démarrage. Contrat : ./test/contrat.ts.
 */

/** Où mène une étape : section de « Ma ferme », écran des itinéraires, formulaire de série, import. */
export type CibleDemarrage = 'saisons' | 'zones' | 'itineraires' | 'serie' | 'import';
export type CleEtape = 'saison' | 'planches' | 'itineraires' | 'serie';

export interface ComptesDemarrage {
  readonly saisons: number;
  readonly planches: number;
  readonly itineraires: number;
  readonly series: number;
}

export interface EtapeDemarrage {
  readonly cle: CleEtape;
  readonly cible: CibleDemarrage;
  readonly faite: boolean;
  readonly titre: string;
  readonly detail: string;
}

export interface EtatDemarrage {
  readonly etapes: readonly EtapeDemarrage[];
  /** Tant qu'aucune série n'existe. */
  readonly visible: boolean;
  /** Première étape pas faite, ou null. */
  readonly prochaine: EtapeDemarrage | null;
}

export function etapesDemarrage(c: ComptesDemarrage): EtatDemarrage {
  const etapes: EtapeDemarrage[] = [
    { cle: 'saison', cible: 'saisons', faite: c.saisons > 0, titre: 'Créer la saison', detail: 'L’année de culture : le plan et les tâches en partent.' },
    { cle: 'planches', cible: 'zones', faite: c.planches > 0, titre: 'Ajouter zones et planches', detail: 'Tunnels, serres, plein champ, et leurs planches en un geste.' },
    { cle: 'itineraires', cible: 'itineraires', faite: c.itineraires > 0, titre: 'Choisir vos itinéraires', detail: 'Adaptez ceux de la bibliothèque à votre façon de cultiver.' },
    { cle: 'serie', cible: 'serie', faite: c.series > 0, titre: 'Planifier une première série', detail: 'Une culture, une date, une planche : les travaux suivent.' },
  ];
  return { etapes, visible: c.series === 0, prochaine: etapes.find((e) => !e.faite) ?? null };
}

/** Requête des comptes (une ligne) : quelques EXISTS, bon marché même sur une grande ferme. */
export const SQL_DEMARRAGE = `SELECT
  EXISTS (SELECT 1 FROM saison WHERE ferme_id = ? AND supprime_le IS NULL) AS saisons,
  EXISTS (SELECT 1 FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND actif_au IS NULL) AS planches,
  EXISTS (SELECT 1 FROM itineraire WHERE ferme_id = ? AND supprime_le IS NULL) AS itineraires,
  EXISTS (SELECT 1 FROM serie WHERE ferme_id = ? AND supprime_le IS NULL) AS series`;
export const TABLES_DEMARRAGE: readonly string[] = ['saison', 'emplacement', 'itineraire', 'serie'];

/**
 * Durée de vie d'une demande : le temps d'un changement d'onglet. Au-delà (changement raté, écran
 * qui n'arrive pas), elle est oubliée : elle n'ouvrira jamais un écran plus tard par surprise.
 */
export const DUREE_DEMANDE_MS = 5_000;

let demande: { readonly cible: CibleDemarrage; readonly le: number } | null = null;

/** Note où aller ; l'écran d'arrivée la prend à son ouverture (`prendreDemande`). */
export function demander(c: CibleDemarrage): void {
  demande = { cible: c, le: Date.now() };
}

/** La demande en attente (encore valable), sans la prendre. */
export function demandeEnAttente(): CibleDemarrage | null {
  if (demande !== null && Date.now() - demande.le > DUREE_DEMANDE_MS) demande = null;
  return demande?.cible ?? null;
}

/** Prend la demande en attente si c'est l'une de `cibles` (elle est alors oubliée), sinon null. */
export function prendreDemande(...cibles: readonly CibleDemarrage[]): CibleDemarrage | null {
  const c = demandeEnAttente();
  if (c === null || !cibles.includes(c)) return null;
  demande = null;
  return c;
}
