/**
 * Créer sa ferme depuis l'appli (T39) : règles sans écran. Contrat : en-tête de
 * ./creer-ferme.test.ts. Chargé à la demande avec ./EcranCreerFerme.tsx, jamais au démarrage.
 *
 * N'importe pas @planif/sync (PowerSync) : SessionExpiree y est reconnue par son nom.
 */
import type { EtatSynchro } from '../../donnees/connecteur.ts';
import type { GestionJetons } from '../../donnees/jeton.ts';

export const NOM_FERME_MAX = 200;
export const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

/** Caractères de contrôle et de format : refusés par l'API (apps/api/src/fermes.ts, nomValide). */
const CARACTERE_INTERDIT = /[\p{Cc}\p{Cf}]/u;

export type ValidationNom = { readonly ok: true; readonly nom: string } | { readonly ok: false; readonly raison: 'vide' | 'trop_long' | 'caracteres' };

export function validerNomFerme(saisi: string): ValidationNom {
  if (CARACTERE_INTERDIT.test(saisi)) return { ok: false, raison: 'caracteres' };
  const nom = saisi.trim();
  if (nom === '') return { ok: false, raison: 'vide' };
  if (nom.length > NOM_FERME_MAX) return { ok: false, raison: 'trop_long' };
  return { ok: true, nom };
}

/** Message d'un nom refusé avant tout envoi. */
export function messageNom(raison: Extract<ValidationNom, { ok: false }>['raison']): string {
  switch (raison) {
    case 'vide':
      return 'Donnez un nom à votre ferme.';
    case 'trop_long':
      return `Le nom de la ferme fait ${String(NOM_FERME_MAX)} caractères au plus.`;
    case 'caracteres':
      return 'Le nom de la ferme contient un caractère invisible ou spécial : retapez-le.';
  }
}

export type RaisonEchecCreation = 'hors_ligne' | 'session_expiree' | 'nom_refuse' | 'erreur';
export type ResultatCreation = { readonly ok: true; readonly fermeId: string } | { readonly ok: false; readonly raison: RaisonEchecCreation };

export interface OptionsCreation {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly jetons: Pick<GestionJetons, 'jetonValide' | 'invalider'>;
  /** UUID de la ferme, choisi par le téléphone : le même à chaque essai. */
  readonly id: string;
  readonly nom: string;
}

const estSessionExpiree = (e: unknown): boolean => e instanceof Error && e.name === 'SessionExpiree';

/** POST /fermes ; ne rejette jamais. */
export async function creerFerme(o: OptionsCreation): Promise<ResultatCreation> {
  const nom = validerNomFerme(o.nom);
  if (!nom.ok) return { ok: false, raison: 'nom_refuse' };
  // Appel détaché : window.fetch appelé comme méthode d'un autre objet lèverait « Illegal invocation ».
  const envoyer = o.fetch;
  const corps = JSON.stringify({ id: o.id, nom: nom.nom, fuseauHoraire: FUSEAU_PAR_DEFAUT });

  async function essai(): Promise<number | RaisonEchecCreation> {
    let jeton: string;
    try {
      jeton = await o.jetons.jetonValide();
    } catch (erreur) {
      return estSessionExpiree(erreur) ? 'session_expiree' : 'hors_ligne';
    }
    try {
      const res = await envoyer(`${o.urlApi}/fermes`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
        body: corps,
      });
      return res.status;
    } catch {
      return 'hors_ligne';
    }
  }

  let statut = await essai();
  if (statut === 401) {
    // Jeton refusé alors que le téléphone le croyait valable : un seul nouvel essai, jeton neuf.
    o.jetons.invalider();
    statut = await essai();
    if (statut === 401) return { ok: false, raison: 'session_expiree' };
  }
  if (typeof statut === 'string') return { ok: false, raison: statut };
  // 409 : cet id existe déjà, c'est un premier envoi dont la réponse s'est perdue.
  if (statut === 201 || statut === 409) return { ok: true, fermeId: o.id };
  if (statut === 400) return { ok: false, raison: 'nom_refuse' };
  return { ok: false, raison: 'erreur' };
}

export function messageCreation(raison: RaisonEchecCreation): string {
  switch (raison) {
    case 'hors_ligne':
      return 'Pas de réseau : la ferme n’a pas été créée. Réessayez quand le téléphone capte.';
    case 'session_expiree':
      return 'Votre session a expiré : déconnectez-vous depuis l’onglet Ferme, puis reconnectez-vous.';
    case 'nom_refuse':
      return 'Ce nom de ferme n’est pas accepté : retapez-le sans caractère spécial.';
    case 'erreur':
      return 'La ferme n’a pas pu être créée. Réessayez dans un instant ; si cela recommence, signalez-le.';
  }
}

export type EcranSansFerme = 'formulaire' | 'hors-ligne' | 'premiere-synchro';

export function choisirEcranSansFerme(o: { readonly synchro: EtatSynchro; readonly enLigne: boolean }): EcranSansFerme {
  if (!o.enLigne) return 'hors-ligne';
  // Première synchro pas finie : la ferme du compte existe peut-être déjà, elle n'est pas arrivée.
  if (o.synchro === 'connexion') return 'premiere-synchro';
  return 'formulaire';
}
