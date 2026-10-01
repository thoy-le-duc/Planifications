/**
 * Tests d'acceptation T09c — l'expéditeur d'e-mail est vérifié au démarrage de l'API.
 *
 * Aucun service réel, aucun identifiant réel : le relais SMTP est le serveur factice local
 * (auth/test/smtp-factice.ts), en clair (SMTP_SECURITE=aucune, donc NODE_ENV=development).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/demarrage.ts (NOUVEAU, sans effet de bord à l'import) exporte :
 *
 *   preparerExpediteur(courriel: ConfigCourriel): Promise<ExpediteurCourriel>
 *     - { type: 'console' } → expediteurConsole(), sans aucune connexion réseau ;
 *     - { type: 'smtp', … } → expediteurSmtp(courriel), puis `await verifier()`
 *       (courriel-smtp.test.ts, T09c) : connexion, STARTTLS si exigé, AUTH, rien n'est envoyé.
 *       Si la vérification échoue, la promesse est rejetée par une Error en français qui nomme
 *       le relais (hôte et port) et ne contient JAMAIS le mot de passe.
 *     L'expéditeur rendu envoie par ce relais (« l'envoi passe par le transport configuré »).
 *
 * apps/api/src/index.ts appelle preparerExpediteur(config.courriel) AVANT d'écouter : si elle
 * échoue, il écrit le message sur la sortie d'erreur et sort en code 1, sans jamais écrire
 * « API à l'écoute ». Testé ici en lançant vraiment `node src/index.ts` (Postgres n'est pas
 * nécessaire : le pool ne se connecte qu'à la première requête).
 *
 * Témoins (déjà vrais en T09b, doivent le rester) : sans SMTP_HOTE ni COURRIEL_CONSOLE, l'API
 * refuse de démarrer en nommant les deux ; le mode console ne démarre que sur demande explicite
 * (COURRIEL_CONSOLE=1, hors production).
 *
 * demarrage.ts est chargé par un chemin dynamique pour que ce test type avant qu'il n'existe.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ExpediteurCourriel } from './auth/index.ts';
import { demarrerSmtpFactice, lireTexte, portFerme, type ServeurSmtpFactice } from './auth/test/smtp-factice.ts';
import type { ConfigCourriel } from './config.ts';

interface ModuleDemarrage {
  readonly preparerExpediteur?: (courriel: ConfigCourriel) => Promise<ExpediteurCourriel>;
}

const CHEMIN_DEMARRAGE = './demarrage.ts';

async function preparerExpediteur(courriel: ConfigCourriel): Promise<ExpediteurCourriel> {
  const module = (await import(CHEMIN_DEMARRAGE)) as ModuleDemarrage;
  if (typeof module.preparerExpediteur !== 'function') throw new Error('preparerExpediteur n’est pas une fonction exportée par demarrage.ts');
  return module.preparerExpediteur(courriel);
}

const MOT_DE_PASSE = 'secret-de-test-ne-pas-afficher';
const MESSAGE = { a: 'theo@ferme.fr', sujet: 'Votre code de connexion : 123456', texte: 'Votre code : 123456' };

let serveurs: ServeurSmtpFactice[] = [];

async function serveur(options?: Parameters<typeof demarrerSmtpFactice>[0]): Promise<ServeurSmtpFactice> {
  const s = await demarrerSmtpFactice(options);
  serveurs.push(s);
  return s;
}

afterEach(async () => {
  await Promise.all(serveurs.map((s) => s.fermer()));
  serveurs = [];
});

function smtp(port: number, autres: Partial<Extract<ConfigCourriel, { type: 'smtp' }>> = {}): ConfigCourriel {
  return {
    type: 'smtp',
    hote: '127.0.0.1',
    port,
    securite: 'aucune',
    expediteur: 'Planifications <connexion@planif.fr>',
    utilisateur: 'relais-planif',
    motDePasse: MOT_DE_PASSE,
    ...autres,
  };
}

function erreurClaire(port: number) {
  return (e: unknown): boolean =>
    e instanceof Error &&
    e.message.includes('SMTP') &&
    e.message.includes('127.0.0.1') &&
    e.message.includes(String(port)) &&
    !e.message.includes(MOT_DE_PASSE);
}

describe('preparerExpediteur (T09c)', () => {
  it('SMTP joignable : vérifie la connexion (AUTH) sans rien envoyer, puis envoie par ce relais', async () => {
    const relais = await serveur();
    const expediteur = await preparerExpediteur(smtp(relais.port));

    expect(relais.connexions()).toBeGreaterThanOrEqual(1);
    expect(relais.authentifications).toContainEqual({ utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE });
    expect(relais.messages).toHaveLength(0);

    await expediteur.envoyer(MESSAGE);
    expect(relais.messages).toHaveLength(1);
    expect(relais.messages[0]?.rcptTo).toEqual([MESSAGE.a]);
    expect(lireTexte(relais.messages[0]?.donnees ?? '')).toBe(MESSAGE.texte);
  });

  it('SMTP injoignable : rejet en nommant le relais, sans le mot de passe', async () => {
    const port = await portFerme();
    await expect(preparerExpediteur(smtp(port))).rejects.toSatisfy(erreurClaire(port));
  });

  it('STARTTLS exigé mais absent : rejet, les identifiants ne partent pas', async () => {
    const relais = await serveur();
    await expect(preparerExpediteur(smtp(relais.port, { securite: 'starttls' }))).rejects.toSatisfy(erreurClaire(relais.port));
    expect(relais.authentifications).toHaveLength(0);
  });

  it('console : aucun relais contacté', async () => {
    const relais = await serveur();
    const expediteur = await preparerExpediteur({ type: 'console' });
    expect(typeof expediteur.envoyer).toBe('function');
    expect(relais.connexions()).toBe(0);
  });
});

// ── Démarrage réel : node src/index.ts ─────────────────────────────────────────────────────

const INDEX = fileURLToPath(new URL('./index.ts', import.meta.url));
const DOSSIER_API = fileURLToPath(new URL('..', import.meta.url));
const ECOUTE = /à l'écoute/;

interface Sortie {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Vrai si le processus écoutait encore au bout du délai (il a alors été arrêté). */
  readonly toujoursEnVie: boolean;
}

/**
 * Lance l'API avec cet environnement (rien hérité de process.env sauf PATH), attend qu'elle
 * sorte ou écrive « à l'écoute », puis l'arrête.
 */
function demarrer(env: Record<string, string>, delaiMs = 15_000): Promise<Sortie> {
  return new Promise((fin) => {
    const enfant = spawn(process.execPath, [INDEX], {
      cwd: DOSSIER_API,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let enVie = false;
    const arreter = (): void => {
      enVie = true;
      enfant.kill('SIGKILL');
    };
    const minuterie = setTimeout(arreter, delaiMs);
    enfant.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.includes("à l'écoute")) {
        clearTimeout(minuterie);
        arreter();
      }
    });
    enfant.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    enfant.on('exit', (code) => {
      clearTimeout(minuterie);
      fin({ code, stdout, stderr, toujoursEnVie: enVie });
    });
  });
}

let jwks = '';

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  jwks = JSON.stringify({ keys: [{ ...(await exportJWK(privateKey)), kid: 'cle-test', alg: 'RS256', use: 'sig' }] });
});

async function envBase(): Promise<Record<string, string>> {
  return {
    DATABASE_URL: 'postgres://personne@127.0.0.1:1/aucune',
    JWT_CLES_PRIVEES: jwks,
    JWT_EMETTEUR: 'https://api.planif.test',
    JWT_AUDIENCE: 'powersync-planif',
    PORT: String(await portFerme()),
    NODE_ENV: 'development',
  };
}

async function envSmtp(port: number): Promise<Record<string, string>> {
  return {
    ...(await envBase()),
    SMTP_HOTE: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_SECURITE: 'aucune',
    SMTP_EXPEDITEUR: 'Planifications <connexion@planif.fr>',
    SMTP_UTILISATEUR: 'relais-planif',
    SMTP_MOT_DE_PASSE: MOT_DE_PASSE,
  };
}

describe('démarrage de l’API : node src/index.ts (T09c)', () => {
  it('relais SMTP injoignable : sortie en code 1, message clair, sans le mot de passe, jamais à l’écoute', async () => {
    const port = await portFerme();
    const sortie = await demarrer(await envSmtp(port));

    expect(sortie.toujoursEnVie, `l’API a démarré malgré un relais injoignable :\n${sortie.stdout}`).toBe(false);
    expect(sortie.code).toBe(1);
    expect(sortie.stdout).not.toMatch(ECOUTE);
    expect(sortie.stderr).toMatch(/SMTP/);
    expect(sortie.stderr).toContain(String(port));
    expect(sortie.stdout + sortie.stderr).not.toContain(MOT_DE_PASSE);
  }, 30_000);

  it('relais SMTP joignable : la connexion est vérifiée avant d’écouter', async () => {
    const relais = await serveur();
    const sortie = await demarrer(await envSmtp(relais.port));

    expect(sortie.stdout, sortie.stderr).toMatch(ECOUTE);
    expect(relais.connexions()).toBeGreaterThanOrEqual(1);
    expect(relais.authentifications).toContainEqual({ utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE });
    expect(relais.messages).toHaveLength(0);
    expect(sortie.stdout + sortie.stderr).not.toContain(MOT_DE_PASSE);
  }, 30_000);

  it('témoin : sans SMTP_HOTE ni COURRIEL_CONSOLE, refus en code 1 en nommant les deux', async () => {
    const sortie = await demarrer(await envBase());

    expect(sortie.toujoursEnVie).toBe(false);
    expect(sortie.code).toBe(1);
    expect(sortie.stderr).toMatch(/SMTP_HOTE/);
    expect(sortie.stderr).toMatch(/COURRIEL_CONSOLE/);
  }, 30_000);

  it('témoin : COURRIEL_CONSOLE=1 en développement démarre le mode console', async () => {
    const sortie = await demarrer({ ...(await envBase()), COURRIEL_CONSOLE: '1' });
    expect(sortie.stdout, sortie.stderr).toMatch(ECOUTE);
  }, 30_000);

  it('témoin : COURRIEL_CONSOLE=1 refusé en production, même avec un relais', async () => {
    const relais = await serveur();
    const sortie = await demarrer({ ...(await envSmtp(relais.port)), NODE_ENV: 'production', SMTP_SECURITE: 'starttls', COURRIEL_CONSOLE: '1' });

    expect(sortie.toujoursEnVie).toBe(false);
    expect(sortie.code).toBe(1);
    expect(sortie.stderr).toMatch(/COURRIEL_CONSOLE/);
  }, 30_000);
});
