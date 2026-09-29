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
 * ── Relecture sécurité : effacement en attente (autre onglet) ──────────────────────────────
 *
 * Si l'effacement de la base échoue (base ouverte dans un autre onglet), rien du compte ne doit
 * rester lisible plus longtemps que nécessaire :
 *   OptionsDeconnexion.stockage devient Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> ;
 *   export const CLE_EFFACEMENT_EN_ATTENTE = 'planif.effacement-en-attente';
 *     valeur : tableau JSON des utilisateurId dont la base reste à effacer, sans doublon ;
 *   export const MESSAGE_EFFACEMENT_EN_ATTENTE =
 *     'Fermez les autres onglets de Planifications ; l’effacement se terminera tout seul.';
 *   - deconnecter : effacerBaseLocale rejette → l'id rejoint le marqueur (les autres ids y
 *     restent), puis la promesse rejette comme avant ; effacerBaseLocale réussit → l'id quitte le
 *     marqueur s'il y était (clé retirée quand il est vide) ;
 *   - effacementsEnAttente(stockage: Pick<Storage, 'getItem'>): readonly string[] — le
 *     marqueur lu ; absent ou illisible → [] ;
 *   - reprendreEffacements(o: { stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
 *       effacerBaseLocale: (utilisateurId: string) => Promise<void> }): Promise<readonly string[]>
 *     retente chaque id du marqueur (un appel chacun, l'un après l'autre), retire ceux qui
 *     réussissent (clé retirée quand plus rien n'attend ; marqueur illisible → clé retirée),
 *     rend les ids qui attendent encore ; ne rejette jamais ; marqueur vide → aucun appel.
 *   L'appli l'appelle au démarrage et, tant que le marqueur n'est pas vide, sur l'écran de
 *   connexion à intervalle régulier (5 s au plus) jusqu'à réussite ; tant qu'il n'est pas vide,
 *   elle affiche MESSAGE_EFFACEMENT_EN_ATTENTE (role="alert"), et le retire une fois tout effacé
 *   (e2e/deconnexion.e2e.ts, deux pages).
 *
 * ── Relecture sécurité : saisies non envoyées ──────────────────────────────────────────────
 *
 *   messagePerteSaisies(n: number): string
 *     1 → '1 saisie pas encore envoyée sera perdue' ; n ≥ 2 → '3 saisies pas encore envoyées
 *     seront perdues' (n en chiffres).
 *   deconnecterAvecConfirmation(session, options: OptionsDeconnexion & {
 *       compterEnAttente: () => Promise<number>;       // taille de la file d'envoi
 *       confirmer: (message: string) => Promise<boolean>;  // écran de confirmation en un tap
 *     }): Promise<'deconnecte' | 'annule'>
 *     - file vide (0) : pas de confirmation, deconnecter(...) puis 'deconnecte' ;
 *     - n > 0 : confirmer(message) une fois, message contenant messagePerteSaisies(n) ;
 *       false → 'annule' : AUCUN appel réseau, session et base intactes ; true → deconnecter ;
 *     - compterEnAttente rejette (file illisible) : confirmation demandée quand même (texte
 *       libre), jamais de perte silencieuse ;
 *     - rejette comme deconnecter si l'effacement échoue.
 *   Côté données : DonneesLocales.ecrituresEnAttente(): Promise<number> — nombre de saisies
 *   (transactions locales) encore dans la file d'envoi. La page de diagnostic l'utilise
 *   (e2e-synchro/deconnexion.e2e.ts) ; un écran sans base ouverte ne demande rien.
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que deconnexion.ts
 * n'existe ; il échoue alors à l'import.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION, type SessionConnexion } from './session.ts';

interface OptionsDeconnexion {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
  readonly delaiMs?: number;
}

interface OptionsConfirmation extends OptionsDeconnexion {
  readonly compterEnAttente: () => Promise<number>;
  readonly confirmer: (message: string) => Promise<boolean>;
}

interface OptionsReprise {
  readonly stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
}

interface ModuleDeconnexion {
  deconnecter(session: SessionConnexion, options: OptionsDeconnexion): Promise<void>;
}

/** Ajouts de la relecture sécurité, lus un par un : leur absence fait échouer le test, pas le typage. */
interface ModuleDeconnexionT09bRelecture {
  readonly CLE_EFFACEMENT_EN_ATTENTE: string;
  readonly MESSAGE_EFFACEMENT_EN_ATTENTE: string;
  effacementsEnAttente(stockage: Pick<Storage, 'getItem'>): readonly string[];
  reprendreEffacements(o: OptionsReprise): Promise<readonly string[]>;
  messagePerteSaisies(n: number): string;
  deconnecterAvecConfirmation(session: SessionConnexion, options: OptionsConfirmation): Promise<'deconnecte' | 'annule'>;
}

async function relecture(): Promise<ModuleDeconnexionT09bRelecture> {
  const module = (await import(CHEMIN)) as Partial<ModuleDeconnexionT09bRelecture>;
  for (const nom of ['effacementsEnAttente', 'reprendreEffacements', 'messagePerteSaisies', 'deconnecterAvecConfirmation'] as const) {
    if (typeof module[nom] !== 'function') throw new Error(`${nom} absente de deconnexion.ts`);
  }
  for (const nom of ['CLE_EFFACEMENT_EN_ATTENTE', 'MESSAGE_EFFACEMENT_EN_ATTENTE'] as const) {
    if (typeof module[nom] !== 'string') throw new Error(`${nom} absente de deconnexion.ts`);
  }
  return module as ModuleDeconnexionT09bRelecture;
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

// Adapté (relecture sécurité) : le stockage lit et écrit aussi le marqueur d'effacement en attente.
function stockage() {
  const valeurs = new Map<string, string>([[CLE_SESSION, JSON.stringify(SESSION)]]);
  return {
    valeurs,
    getItem: (c: string) => valeurs.get(c) ?? null,
    setItem: (c: string, v: string) => {
      valeurs.set(c, v);
    },
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

const AUTRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b99';

describe('effacement en attente : base ouverte dans un autre onglet (relecture sécurité)', () => {
  it('le message dit quoi faire', async () => {
    const m = await relecture();
    expect(m.MESSAGE_EFFACEMENT_EN_ATTENTE).toMatch(/^Fermez les autres onglets de Planifications ; l['’]effacement se terminera tout seul\.$/);
    expect(m.CLE_EFFACEMENT_EN_ATTENTE).toBe('planif.effacement-en-attente');
  });

  it('effacement impossible : l’utilisateur rejoint le marqueur, la promesse rejette, la session est effacée', async () => {
    const m = await relecture();
    const { fetch } = fetchSimule(() => Promise.resolve(new Response(null, { status: 204 })));
    const s = stockage();
    s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([AUTRE]));
    const e = effaceur(true);
    await expect(deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale })).rejects.toThrow();
    expect(s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(m.effacementsEnAttente(s)).toEqual([AUTRE, SESSION.utilisateurId]);

    // Deuxième échec pour le même utilisateur : pas de doublon.
    await expect(deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: e.effacerBaseLocale })).rejects.toThrow();
    expect(m.effacementsEnAttente(s)).toEqual([AUTRE, SESSION.utilisateurId]);
  });

  it('effacement réussi : l’utilisateur quitte le marqueur, la clé disparaît quand il est vide', async () => {
    const m = await relecture();
    const { fetch } = fetchSimule(() => Promise.resolve(new Response(null, { status: 204 })));
    const s = stockage();
    s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([SESSION.utilisateurId]));
    await deconnecter(SESSION, { urlApi: 'https://api', fetch, stockage: s, effacerBaseLocale: effaceur().effacerBaseLocale });
    expect(s.valeurs.has(m.CLE_EFFACEMENT_EN_ATTENTE)).toBe(false);
    expect(m.effacementsEnAttente(s)).toEqual([]);
  });

  it('effacementsEnAttente : absent ou illisible → []', async () => {
    const m = await relecture();
    for (const brut of [null, '{pas du json', '42', '"texte"', '[1, null]']) {
      const s = stockage();
      if (brut !== null) s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, brut);
      const lus = m.effacementsEnAttente(s);
      expect(lus.every((id) => typeof id === 'string' && id !== ''), String(brut)).toBe(true);
      if (brut !== '[1, null]') expect(lus, String(brut)).toEqual([]);
    }
  });

  it('reprendreEffacements : retente chaque utilisateur, garde ceux qui échouent encore, ne rejette jamais', async () => {
    const m = await relecture();
    const s = stockage();
    s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([SESSION.utilisateurId, AUTRE]));
    const appels: string[] = [];
    let autreBloque = true;
    const effacerBaseLocale = (id: string) => {
      appels.push(id);
      return id === AUTRE && autreBloque ? Promise.reject(new Error('base ouverte ailleurs')) : Promise.resolve();
    };

    expect(await m.reprendreEffacements({ stockage: s, effacerBaseLocale })).toEqual([AUTRE]);
    expect(appels).toEqual([SESSION.utilisateurId, AUTRE]);
    expect(m.effacementsEnAttente(s)).toEqual([AUTRE]);

    autreBloque = false;
    expect(await m.reprendreEffacements({ stockage: s, effacerBaseLocale })).toEqual([]);
    expect(s.valeurs.has(m.CLE_EFFACEMENT_EN_ATTENTE)).toBe(false);

    appels.length = 0;
    expect(await m.reprendreEffacements({ stockage: s, effacerBaseLocale })).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('reprendreEffacements : effaceur qui lève tout de suite, ou marqueur illisible : ni rejet, ni exception', async () => {
    const m = await relecture();
    const s = stockage();
    s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([AUTRE]));
    const leve = (): Promise<void> => {
      throw new Error('indexedDB indisponible');
    };
    expect(await m.reprendreEffacements({ stockage: s, effacerBaseLocale: leve })).toEqual([AUTRE]);

    s.valeurs.set(m.CLE_EFFACEMENT_EN_ATTENTE, '{pas du json');
    expect(await m.reprendreEffacements({ stockage: s, effacerBaseLocale: leve })).toEqual([]);
    expect(s.valeurs.has(m.CLE_EFFACEMENT_EN_ATTENTE)).toBe(false);
  });

  it('sont réexportés par connexion/index.ts', async () => {
    const module: Readonly<Record<string, unknown>> = await import('./index.ts');
    for (const nom of ['effacementsEnAttente', 'reprendreEffacements', 'messagePerteSaisies', 'deconnecterAvecConfirmation']) {
      expect(typeof module[nom], nom).toBe('function');
    }
    expect(typeof module.MESSAGE_EFFACEMENT_EN_ATTENTE).toBe('string');
  });
});

describe('saisies non envoyées : confirmation avant de se déconnecter (relecture sécurité)', () => {
  it('messagePerteSaisies : singulier et pluriel', async () => {
    const m = await relecture();
    expect(m.messagePerteSaisies(1)).toBe('1 saisie pas encore envoyée sera perdue');
    expect(m.messagePerteSaisies(3)).toBe('3 saisies pas encore envoyées seront perdues');
    expect(m.messagePerteSaisies(12)).toBe('12 saisies pas encore envoyées seront perdues');
  });

  function options(o: { enAttente: () => Promise<number>; reponse: boolean }) {
    const { fetch, appels } = fetchSimule(() => Promise.resolve(new Response(null, { status: 204 })));
    const s = stockage();
    const e = effaceur();
    const questions: string[] = [];
    return {
      appels,
      s,
      e,
      questions,
      options: {
        urlApi: 'https://api',
        fetch,
        stockage: s,
        effacerBaseLocale: e.effacerBaseLocale,
        compterEnAttente: o.enAttente,
        confirmer: (message: string) => {
          questions.push(message);
          return Promise.resolve(o.reponse);
        },
      },
    };
  }

  it('file vide : aucune confirmation, déconnexion directe', async () => {
    const m = await relecture();
    const o = options({ enAttente: () => Promise.resolve(0), reponse: false });
    expect(await m.deconnecterAvecConfirmation(SESSION, o.options)).toBe('deconnecte');
    expect(o.questions).toEqual([]);
    expect(o.appels).toHaveLength(1);
    expect(o.s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(o.e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('3 saisies en attente, annulé : rien n’est fait (ni réseau, ni session, ni base)', async () => {
    const m = await relecture();
    const o = options({ enAttente: () => Promise.resolve(3), reponse: false });
    expect(await m.deconnecterAvecConfirmation(SESSION, o.options)).toBe('annule');
    expect(o.questions).toHaveLength(1);
    expect(o.questions[0]).toContain('3 saisies pas encore envoyées seront perdues');
    expect(o.appels).toEqual([]);
    expect(o.s.valeurs.has(CLE_SESSION)).toBe(true);
    expect(o.e.effaces).toEqual([]);
  });

  it('3 saisies en attente, confirmé en un tap : déconnecté, base effacée', async () => {
    const m = await relecture();
    const o = options({ enAttente: () => Promise.resolve(3), reponse: true });
    expect(await m.deconnecterAvecConfirmation(SESSION, o.options)).toBe('deconnecte');
    expect(o.questions).toHaveLength(1);
    expect(o.s.valeurs.has(CLE_SESSION)).toBe(false);
    expect(o.e.effaces).toEqual([SESSION.utilisateurId]);
  });

  it('file illisible (compterEnAttente rejette) : confirmation demandée quand même', async () => {
    const m = await relecture();
    const o = options({ enAttente: () => Promise.reject(new Error('base fermée')), reponse: false });
    expect(await m.deconnecterAvecConfirmation(SESSION, o.options)).toBe('annule');
    expect(o.questions).toHaveLength(1);
    expect(o.appels).toEqual([]);
    expect(o.s.valeurs.has(CLE_SESSION)).toBe(true);
  });
});
