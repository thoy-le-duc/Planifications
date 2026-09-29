/**
 * Tests d'acceptation T09 — écran de connexion (sans navigateur : rendu serveur et fonctions pures).
 * Le parcours au doigt (taille des cibles, focus, envoi automatique) est dans e2e/connexion.e2e.ts.
 *
 * Connexion utilisable avec des gants (Q9) : un seul champ par étape, gros boutons (48 px au
 * moins, vérifié en e2e), pas de saisie répétée (l'adresse n'est jamais redemandée pour saisir
 * le code, et la session est gardée sur le téléphone).
 *
 * ── API attendue (apps/web/src/connexion/index.ts) ──────────────────────────────────────────
 *
 * interface SessionConnexion {
 *   readonly utilisateurId: string; readonly email: string;
 *   readonly jetonAcces: string; readonly jetonRenouvellement: string;
 * }
 *
 * type ResultatDemande = { ok: true } | { ok: false; raison: 'trop_tot' | 'email_invalide' | 'hors_ligne' | 'erreur' };
 * type ResultatVerification =
 *   | { ok: true; session: SessionConnexion }
 *   | { ok: false; raison: 'code_invalide' | 'hors_ligne' | 'erreur' };
 * interface ClientConnexion {
 *   demanderCode(email: string): Promise<ResultatDemande>;
 *   verifierCode(email: string, code: string): Promise<ResultatVerification>;
 * }
 *
 * creerClientConnexion(options: { baseUrl: string; fetch: typeof fetch }): ClientConnexion
 *   POST `${baseUrl}/auth/code` { email } et POST `${baseUrl}/auth/verifier` { email, code }
 *   (contrat de l'API : apps/api/src/auth/auth.integration.test.ts). L'adresse est normalisée
 *   (espaces, minuscules) avant envoi. 202 → ok ; 429 → trop_tot ; 400 → email_invalide ;
 *   401 → code_invalide ; fetch qui lève (pas de réseau) → hors_ligne ; autre → erreur.
 *   Dans l'appli, baseUrl vaut import.meta.env.VITE_API_URL, sinon '/api'.
 *
 * lireSession(stockage: Pick<Storage, 'getItem'>): SessionConnexion | null
 * enregistrerSession(stockage: Pick<Storage, 'setItem'>, session: SessionConnexion): void
 * effacerSession(stockage: Pick<Storage, 'removeItem'>): void
 *   Clé localStorage : CLE_SESSION ('planif.session'). Une valeur absente, illisible ou
 *   incomplète donne null, jamais d'exception (l'appli doit toujours démarrer).
 *
 * EcranConnexion(props: {
 *   client: ClientConnexion;
 *   surConnexion: (session: SessionConnexion) => void;
 *   etapeInitiale?: { etape: 'email' } | { etape: 'code'; email: string };   // défaut : email
 * })
 *   Étape e-mail : un seul champ (type email, autocomplete "email", inputmode "email", libellé
 *   « Adresse e-mail »), un bouton « Recevoir un code ».
 *   Étape code : un seul champ (inputmode "numeric", autocomplete "one-time-code", maxlength 6,
 *   libellé contenant « code »), l'adresse affichée en texte (pas en champ), un bouton
 *   « Valider » ; les 6 chiffres saisis, la vérification part seule. Un bouton « Changer
 *   d'adresse » ramène à l'étape e-mail.
 *   Aucun champ mot de passe. Le module n'importe ni jose ni PowerSync (poids de démarrage).
 *
 * T09b, 3e relecture — normaliserEmail(email: string): string (réexporté par index.ts) :
 *   espaces de bord retirés, minuscules ET forme NFC (normalize('NFC')). Un « é » saisi
 *   décomposé (e + U+0301, certains claviers ou copier-coller) part précomposé : l'API refuse les
 *   caractères combinants, l'adresse doit être acceptée quand même. demanderCode et verifierCode
 *   envoient cette forme ; la session rendue porte la même adresse.
 *
 * Intégration dans App (apps/web/src/App.tsx) : sans session enregistrée, App affiche
 * EcranConnexion à l'intérieur de son élément data-testid="app" (la marque de performance est
 * toujours posée) ; après connexion, la session est enregistrée et l'appli s'affiche.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CLE_SESSION,
  EcranConnexion,
  creerClientConnexion,
  effacerSession,
  enregistrerSession,
  lireSession,
  normaliserEmail,
  type ClientConnexion,
  type SessionConnexion,
} from './index.ts';

const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

const CLIENT_INERTE: ClientConnexion = {
  demanderCode: () => Promise.resolve({ ok: true }),
  verifierCode: () => Promise.resolve({ ok: false, raison: 'code_invalide' }),
};

function balises(html: string, nom: string): string[] {
  return [...html.matchAll(new RegExp(`<${nom}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
}

function attribut(balise: string, nom: string): string | undefined {
  return new RegExp(`\\s${nom}="([^"]*)"`, 'i').exec(balise)?.[1];
}

function rendre(etapeInitiale?: { etape: 'email' } | { etape: 'code'; email: string }): string {
  return renderToString(
    <EcranConnexion
      client={CLIENT_INERTE}
      surConnexion={() => undefined}
      {...(etapeInitiale === undefined ? {} : { etapeInitiale })}
    />,
  );
}

describe('T09 : écran de connexion', () => {
  it('étape e-mail : un seul champ, de type e-mail, et un bouton', () => {
    const html = rendre();
    const champs = [...balises(html, 'input'), ...balises(html, 'textarea')];
    expect(champs).toHaveLength(1);
    const [champ = ''] = champs;
    expect(attribut(champ, 'type')).toBe('email');
    expect(attribut(champ, 'autocomplete')).toBe('email');
    expect(attribut(champ, 'inputmode')).toBe('email');
    expect(html).toMatch(/Adresse e-mail/);
    expect(html).toMatch(/Recevoir un code/);
    expect(balises(html, 'button').length).toBeGreaterThanOrEqual(1);
    expect(html).not.toMatch(/type="password"/i);
  });

  it('étape code : un seul champ numérique à 6 chiffres, l’adresse en texte, pas redemandée', () => {
    const html = rendre({ etape: 'code', email: 'theophane@ferme.fr' });
    const champs = [...balises(html, 'input'), ...balises(html, 'textarea')];
    expect(champs).toHaveLength(1);
    const [champ = ''] = champs;
    expect(attribut(champ, 'inputmode')).toBe('numeric');
    expect(attribut(champ, 'autocomplete')).toBe('one-time-code');
    expect(attribut(champ, 'maxlength')).toBe('6');
    expect(attribut(champ, 'type')).not.toBe('email');
    expect(attribut(champ, 'type')).not.toBe('password');
    expect(html).toContain('theophane@ferme.fr');
    expect(html).toMatch(/Valider/);
    expect(html).toMatch(/Changer d(’|'|&#x27;)adresse/);
  });

  it('le module de connexion n’importe ni jose ni PowerSync (poids de démarrage)', () => {
    const dossier = new URL('./', import.meta.url);
    const sources = readdirSync(dossier).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      const texte = readFileSync(new URL(f, dossier), 'utf8');
      expect(texte, f).not.toMatch(/from ['"](jose|@powersync\/[^'"]*|@journeyapps\/[^'"]*)['"]/);
    }
  });
});

describe('T09 : session gardée sur le téléphone', () => {
  function stockageMemoire(): Storage & { contenu: Map<string, string> } {
    const contenu = new Map<string, string>();
    return {
      contenu,
      get length() {
        return contenu.size;
      },
      clear: () => {
        contenu.clear();
      },
      getItem: (k) => contenu.get(k) ?? null,
      key: (i) => [...contenu.keys()][i] ?? null,
      removeItem: (k) => {
        contenu.delete(k);
      },
      setItem: (k, v) => {
        contenu.set(k, v);
      },
    };
  }

  it('enregistrer puis relire rend la même session ; effacer la retire', () => {
    const s = stockageMemoire();
    expect(lireSession(s)).toBeNull();
    enregistrerSession(s, SESSION);
    expect(s.contenu.has(CLE_SESSION)).toBe(true);
    expect(lireSession(s)).toEqual(SESSION);
    effacerSession(s);
    expect(lireSession(s)).toBeNull();
  });

  it('une valeur illisible ou incomplète donne null, sans exception', () => {
    const s = stockageMemoire();
    for (const brut of ['pas du json', '{}', 'null', JSON.stringify({ ...SESSION, jetonRenouvellement: 42 })]) {
      s.setItem(CLE_SESSION, brut);
      expect(lireSession(s), brut).toBeNull();
    }
  });

  it('un stockage qui lève (navigation privée) donne null', () => {
    const casse: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(lireSession(casse)).toBeNull();
  });
});

describe('T09 : client de connexion', () => {
  interface Appel {
    readonly url: string;
    readonly methode: string;
    readonly corps: unknown;
  }

  function fauxFetch(reponses: readonly (Response | Error)[]): { fetch: typeof fetch; appels: Appel[] } {
    const appels: Appel[] = [];
    let i = 0;
    const f = (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.toString() : entree.url;
      const corps = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      appels.push({ url, methode: init?.method ?? 'GET', corps });
      const r = reponses[i++];
      if (r === undefined) return Promise.reject(new Error('appel inattendu'));
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    };
    return { fetch: f, appels };
  }

  const json = (statut: number, corps: unknown) =>
    new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });

  it('demanderCode : POST /auth/code avec l’adresse normalisée', async () => {
    const { fetch, appels } = fauxFetch([json(202, { ok: true })]);
    const client = creerClientConnexion({ baseUrl: '/api', fetch });
    expect(await client.demanderCode('  Theophane@Ferme.FR ')).toEqual({ ok: true });
    expect(appels).toEqual([{ url: '/api/auth/code', methode: 'POST', corps: { email: 'theophane@ferme.fr' } }]);
  });

  it('demanderCode : trop tôt, adresse invalide, hors ligne, erreur', async () => {
    const { fetch } = fauxFetch([
      json(429, { erreur: 'trop_de_demandes' }),
      json(400, { erreur: 'email_invalide' }),
      new TypeError('Failed to fetch'),
      json(500, {}),
    ]);
    const client = creerClientConnexion({ baseUrl: '/api', fetch });
    expect(await client.demanderCode('a@b.fr')).toEqual({ ok: false, raison: 'trop_tot' });
    expect(await client.demanderCode('a@b.fr')).toEqual({ ok: false, raison: 'email_invalide' });
    expect(await client.demanderCode('a@b.fr')).toEqual({ ok: false, raison: 'hors_ligne' });
    expect(await client.demanderCode('a@b.fr')).toEqual({ ok: false, raison: 'erreur' });
  });

  it('verifierCode : rend la session complète, adresse comprise', async () => {
    const { fetch, appels } = fauxFetch([
      json(200, {
        utilisateurId: SESSION.utilisateurId,
        jetonAcces: SESSION.jetonAcces,
        jetonRenouvellement: SESSION.jetonRenouvellement,
      }),
    ]);
    const client = creerClientConnexion({ baseUrl: 'https://api.exemple.fr', fetch });
    expect(await client.verifierCode('Theophane@ferme.fr', '012345')).toEqual({ ok: true, session: SESSION });
    expect(appels).toEqual([
      {
        url: 'https://api.exemple.fr/auth/verifier',
        methode: 'POST',
        corps: { email: 'theophane@ferme.fr', code: '012345' },
      },
    ]);
  });

  it('T09b : « é » décomposé (e + U+0301) envoyé précomposé (NFC), par demanderCode et verifierCode', async () => {
    const decompose = '  Rene\u0301@Ferme.FR ';
    const attendue = 'ren\u00e9@ferme.fr';
    expect(normaliserEmail(decompose)).toBe(attendue);
    expect(normaliserEmail('RENE\u0301@ferme.fr')).toBe(attendue);

    const { fetch, appels } = fauxFetch([
      json(202, { ok: true }),
      json(200, {
        utilisateurId: SESSION.utilisateurId,
        jetonAcces: SESSION.jetonAcces,
        jetonRenouvellement: SESSION.jetonRenouvellement,
      }),
    ]);
    const client = creerClientConnexion({ baseUrl: '/api', fetch });
    expect(await client.demanderCode(decompose)).toEqual({ ok: true });
    expect(await client.verifierCode(decompose, '012345')).toEqual({ ok: true, session: { ...SESSION, email: attendue } });
    expect(appels.map((a) => a.corps)).toEqual([{ email: attendue }, { email: attendue, code: '012345' }]);
    // Aucun caractère combinant ne part.
    expect(JSON.stringify(appels)).not.toMatch(/\p{M}/u);
  });

  it('verifierCode : code invalide, hors ligne', async () => {
    const { fetch } = fauxFetch([json(401, { erreur: 'code_invalide' }), new TypeError('Failed to fetch')]);
    const client = creerClientConnexion({ baseUrl: '/api', fetch });
    expect(await client.verifierCode('a@b.fr', '000000')).toEqual({ ok: false, raison: 'code_invalide' });
    expect(await client.verifierCode('a@b.fr', '000000')).toEqual({ ok: false, raison: 'hors_ligne' });
  });
});
