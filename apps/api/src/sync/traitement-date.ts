/**
 * T80 : le serveur refuse un traitement phyto daté dans le futur (registre légal). Le téléphone le
 * refuse déjà (`ecrireLotTraitement`), mais un téléphone pas à jour, mal réglé ou modifié pourrait
 * encore inscrire au registre un traitement à venir, avec un délai avant récolte calculé depuis
 * cette date. Contrat : traitement-date-future.integration.test.ts.
 *
 * - Limite : le jour du serveur à Paris (`Contexte.jourServeur`) + 1 jour, pour un téléphone en
 *   avance d'un fuseau ou une saisie juste après minuit. Au-delà : refus 'ecriture_invalide'.
 * - Une correction ou une annulation d'un traitement est elle-même un événement 'traitement' : la
 *   règle porte sur la date qu'elle déclare.
 * - Seul le type 'traitement' est visé (récolte, réalisé… : hors périmètre, à décider).
 */
import { ajouterJours, analyserDate } from '@planif/core';
import type { Refus } from './motifs.ts';

/** Jours de marge après le jour du serveur. */
export const MARGE_TRAITEMENT_JOURS = 1;

/** 'AAAA-MM-JJ' → 'JJ/MM/AAAA', comme le maraîcher l'écrit. */
function enFrancais(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/**
 * Refus d'un événement de type 'traitement' daté après `jourServeur` + 1 jour ; null sinon (ou si
 * l'événement n'est pas un traitement). `jourServeur` invalide : erreur (panne de configuration du
 * serveur, jamais un refus du téléphone).
 */
export function refusTraitementFutur(e: { readonly type: string; readonly date: string; readonly fermeId: string }, jourServeur: string): Refus | null {
  if (e.type !== 'traitement') return null;
  const jour = analyserDate(jourServeur);
  if (!jour.ok) throw new Error(`jour du serveur illisible : ${jourServeur}`);
  const limite = ajouterJours(jour.date, MARGE_TRAITEMENT_JOURS);
  // Dates déjà validées par le cœur (AAAA-MM-JJ) : l'ordre des chaînes est celui des jours.
  if (e.date <= limite) return null;
  return {
    motif: 'ecriture_invalide',
    precision: `traitement daté dans le futur (${enFrancais(e.date)}) : corrigez la date`,
    detail: `traitement daté après le ${limite} (jour du serveur + ${String(MARGE_TRAITEMENT_JOURS)})`,
    fermeId: e.fermeId,
  };
}
