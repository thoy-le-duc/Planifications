/**
 * Tests d'acceptation T09b — déconnexion sur le téléphone (téléphone partagé : rien du compte
 * précédent ne reste lisible).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/connexion/deconnexion.ts (réexporté par connexion/index.ts), sans import de
 * PowerSync ni de jose (JavaScript de démarrage) :
 *
 *   interface OptionsDeconnexion {
 *     readonly urlApi: string;
 *     readonly fetch: typeof fetch;
 *     readonly stockage: Pick<Storage, 'removeItem'>;
 *     // Efface la base locale PowerSync de cet utilisateur (src/donnees, chargé à la demande).
 *     readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
 *     // Attente maximale de la réponse de l'API, défaut 5 000 ms.
 *     readonly delaiMs?: number;
 *   }
 *   deconnecter(session: SessionConnexion, options: OptionsDeconnexion): Promise<void>
 *
 *   - envoie POST {urlApi}/auth/deconnexion { jetonRenouvellement } (sans en-tête
 *     Authorization : le jeton d'accès peut avoir expiré) ;
 *   - efface la session (effacerSession : clé `planif.session`) et appelle
 *     effacerBaseLocale(session.utilisateurId), QUE L'API RÉPONDE OU NON : hors ligne, erreur
 *     HTTP, ou pas de réponse avant delaiMs. Au champ, sans réseau, on doit pouvoir rendre le
 *     téléphone. (Le jeton non révoqué n'est plus nulle part sur le téléphone.)
 *   - résout une fois la session et la base effacées ; rejette si effacerBaseLocale rejette
 *     (l'écran doit le dire), la session étant quand même effacée.
 *
 * Côté données (src/donnees, testé de bout en bout par e2e-synchro/deconnexion.e2e.ts) :
 *   DonneesLocales.effacer(): Promise<void> — arrête la synchro, efface toutes les tables
 *     locales et la file d'écritures (disconnectAndClear de PowerSync) et ferme la base ;
 *   effacerDonneesLocales(utilisateurId): Promise<void> — même chose quand la base n'est pas
 *     ouverte (écran d'accueil de l'appli).
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que deconnexion.ts
 * n'existe ; il échoue alors à l'import.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION, type SessionConnexion } from './session.ts';

interface OptionsDeconnexion {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly stockage: Pick<Storage, 'removeItem'>;
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
  readonly delaiMs?: number;
}

interface ModuleDeconnexion {
  deconnecter(session: SessionConnexion, options: OptionsDeconnexion): Promise<void>;
}

const CHEMIN = './deconnexion.ts';

async function deconnecter(session: SessionConnexion, options: OptionsDeconnexion): Promise<void> {
  const module = (await import(CHEMIN)) as ModuleDeconnexion;
  await module.deconnecter(session, options);
}

const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theo@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

function stockage() {
  const valeurs = new Map<string, string>([[CLE_SESSION, JSON.stringify(SESSION)]]);
  return {
    valeurs,
    removeItem: (c: string) => {
      valeurs.delete(c);
    },
  };
}

interface Appel {
  readonly url: string;
  readonly methode: string;
  readonly autorisation: string | null;
  readonly corps: unknown;
}

function fetchSimule(reponse: () => Promise<Response>) {
  const appels: Appel[] = [];
  const f: typeof fetch = async (entree, init) => {
    const requete = new Request(entree, init);
    const texte = await requete.text();
    appels.push({
      url: requete.url,
      methode: requete.method,
      autorisation: requete.headers.get('authorization'),
      corps: texte === '' ? null : (JSON.parse(texte) as unknown),
    });
    return reponse();
  };
  return { fetch: f, appels };
}

function effaceur(echec = false) {
  const effaces: string[] = [];
  return {
    effaces,
    effacerBaseLocale: (id: string) => {
      effaces.push(id);
      return echec ? Promise.reject(new Error('base locale verrouillée')) : Promise.resolve();
    },
  };
}

describe('deconnecter (T09b)', () => {
  it('révoque le jeton auprès de l’API, efface la session et la base locale de cet utilisateur', async () => {
    const { fetch, appels } = fetchSimule(() => Promise.resolve(new Response(null, { status: 204 })));
    const s = stockage();
    const e = effaceur();
    await deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale });

    expect(appels).toEqual([
      {
        url: 'https://api/auth/deconnexion',
        methode: 'POST',
        autorisation: null,
        corps: { jetonRenouvellement: SESSION.jetonRenouvellement },
      },
    ]);
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('hors ligne (fetch rejette) : session et base locale effacées quand même', async () => {
    const { fetch } = fetchSimule(() => Promise.reject(new TypeError('Failed to fetch')));
    const s = stockage();
    const e = effaceur();
    await deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale });
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('erreur de l’API (500) : session et base locale effacées quand même', async () => {
    const { fetch } = fetchSimule(() => Promise.resolve(new Response('{}', { status: 500 })));
    const s = stockage();
    const e = effaceur();
    await deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale });
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('réseau qui ne répond pas : n’attend pas plus que delaiMs', async () => {
    const { fetch } = fetchSimule(() => new Promise<Response>(() => undefined));
    const s = stockage();
    const e = effaceur();
    const debut = Date.now();
    await deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale, delaiMs: 100 });
    expect(Date.now() - debut).toBeLessThan(2_000);
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('base locale impossible à effacer : la promesse rejette, la session est effacée quand même', async () => {
    const { fetch } = fetchSimule(() => Promise.resolve(new Response(null, { status: 204 })));
    const s = stockage();
    const e = effaceur(true);
    await expect(
      deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale }),
    ).rejects.toThrow();
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
  });

  it('est réexportée par connexion/index.ts', async () => {
    const module: Readonly<Record<string, unknown>> = await import('./index.ts');
    expect(typeof module.deconnecter).toBe('function');
  });
});
