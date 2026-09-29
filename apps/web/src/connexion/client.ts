/**
 * Client HTTP de connexion : POST /auth/code puis POST /auth/verifier (contrat de l'API :
 * apps/api/src/auth/auth.integration.test.ts). Ni jose ni PowerSync : poids de démarrage.
 */
import { sessionValide, type SessionConnexion } from './session.ts';

export type ResultatDemande = { ok: true } | { ok: false; raison: 'trop_tot' | 'email_invalide' | 'hors_ligne' | 'erreur' };

export type ResultatVerification =
  | { ok: true; session: SessionConnexion }
  | { ok: false; raison: 'code_invalide' | 'hors_ligne' | 'erreur' };

export interface ClientConnexion {
  demanderCode(email: string): Promise<ResultatDemande>;
  verifierCode(email: string, code: string): Promise<ResultatVerification>;
}

export interface OptionsClient {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
}

/** Nombre de chiffres d'un code de connexion. */
export const LONGUEUR_CODE = 6;

/** Adresse telle que l'API la stocke : espaces retirés, minuscules. */
export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** URL de l'API dans l'appli : VITE_API_URL, sinon '/api' (même origine). */
export function urlApi(): string {
  const url: unknown = import.meta.env.VITE_API_URL;
  return typeof url === 'string' && url !== '' ? url.replace(/\/+$/, '') : '/api';
}

type Reponse = { statut: number; corps: unknown } | 'hors_ligne';

export function creerClientConnexion(options: OptionsClient): ClientConnexion {
  // Appel détaché : window.fetch appelé comme méthode d'un autre objet lèverait « Illegal invocation ».
  const envoyer = options.fetch;

  async function poster(chemin: string, corps: unknown): Promise<Reponse> {
    let res: Response;
    try {
      res = await envoyer(`${options.baseUrl}${chemin}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      });
    } catch {
      return 'hors_ligne';
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Corps vide ou illisible : le statut suffit.
    }
    return { statut: res.status, corps: json };
  }

  return {
    async demanderCode(email) {
      const r = await poster('/auth/code', { email: normaliserEmail(email) });
      if (r === 'hors_ligne') return { ok: false, raison: 'hors_ligne' };
      if (r.statut === 202 || r.statut === 200) return { ok: true };
      if (r.statut === 429) return { ok: false, raison: 'trop_tot' };
      if (r.statut === 400) return { ok: false, raison: 'email_invalide' };
      return { ok: false, raison: 'erreur' };
    },

    async verifierCode(email, code) {
      const adresse = normaliserEmail(email);
      const r = await poster('/auth/verifier', { email: adresse, code });
      if (r === 'hors_ligne') return { ok: false, raison: 'hors_ligne' };
      if (r.statut === 401) return { ok: false, raison: 'code_invalide' };
      if (r.statut !== 200 || typeof r.corps !== 'object' || r.corps === null) return { ok: false, raison: 'erreur' };
      const session = sessionValide({ ...r.corps, email: adresse });
      return session === null ? { ok: false, raison: 'erreur' } : { ok: true, session };
    },
  };
}
