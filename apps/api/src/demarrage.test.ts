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
 *   preparerExpediteur(courriel: ConfigCourriel, journal?: (ligne: string) => void):
 *     Promise<ExpediteurCourriel>
 *     - { type: 'console' } → expediteurConsole(), sans aucune connexion réseau ;
 *     - { type: 'smtp', … } → expediteurSmtp(courriel), et verifier() (courriel-smtp.test.ts,
 *       T09c) : connexion, STARTTLS si exigé, AUTH, rien n'est envoyé. Relecture T09c : la
 *       vérification peut partir en tâche de fond (la promesse peut se résoudre avant qu'elle
 *       finisse) ; ces tests attendent son effet (vi.waitFor) plutôt que la résolution.
 *     Décision du 2026-10-01 : une panne du relais ne doit JAMAIS arrêter l'API (ni la synchro).
 *     Si verifier() échoue, preparerExpediteur NE REJETTE PAS : elle appelle `journal` (par
 *     défaut console.error) avec un message en français qui contient « SMTP », l'hôte et le
 *     port, et JAMAIS le mot de passe, puis rend quand même l'expéditeur (l'envoi d'un code
 *     échouera ensuite normalement). Si verifier() réussit, `journal` n'est pas appelé.
 *     L'expéditeur rendu envoie par ce relais (« l'envoi passe par le transport configuré »).
 *
 * apps/api/src/index.ts (relecture T09c, décision du chef d'équipe : une panne de Brevo ne doit
 * jamais RETARDER la synchro) : l'API écoute d'abord, la vérification du relais part en tâche
 * de fond. Relais muet : « à l'écoute » en moins de 2 s, l'avertissement SMTP arrive plus tard
 * sur la sortie d'erreur. Relais joignable : connexion + AUTH ont lieu après le démarrage.
 * Relais injoignable : l'API démarre et l'erreur SMTP est sur la sortie d'erreur, sans le mot
 * de passe. Seule
 * une configuration incomplète (lireConfig) arrête le processus en code 1. Testé ici en lançant
 * vraiment `node src/index.ts` (Postgres n'est pas nécessaire : le pool ne se connecte qu'à la
 * première requête).
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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExpediteurCourriel } from './auth/index.ts';
import { demarrerSmtpFactice, lireTexte, portFerme, type ServeurSmtpFactice } from './auth/test/smtp-factice.ts';
import type { ConfigCourriel } from './config.ts';

interface ModuleDemarrage {
  readonly preparerExpediteur?: (courriel: ConfigCourriel, journal?: (ligne: string) => void) => Promise<ExpediteurCourriel>;
}

const CHEMIN_DEMARRAGE = './demarrage.ts';

async function preparerExpediteur(courriel: ConfigCourriel, journal?: (ligne: string) => void): Promise<ExpediteurCourriel> {
  const module = (await import(CHEMIN_DEMARRAGE)) as ModuleDemarrage;
  if (typeof module.preparerExpediteur !== 'function') throw new Error('preparerExpediteur n’est pas une fonction exportée par demarrage.ts');
  return module.preparerExpediteur(courriel, journal);
}

/** Journal espion : les lignes que preparerExpediteur signale. */
function journalEspion(): { readonly lignes: string[]; readonly journal: (ligne: string) => void } {
  const lignes: string[] = [];
  return {
    lignes,
    journal: (ligne) => {
      lignes.push(ligne);
    },
  };
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

/** Le journal signale le relais en panne : « SMTP », hôte, port ; jamais le mot de passe. */
function attendreSignalement(lignes: readonly string[], port: number): void {
  const tout = lignes.join('\n');
  expect(lignes.length).toBeGreaterThanOrEqual(1);
  expect(tout).toContain('SMTP');
  expect(tout).toContain('127.0.0.1');
  expect(tout).toContain(String(port));
  expect(tout).not.toContain(MOT_DE_PASSE);
}

describe('preparerExpediteur (T09c)', () => {
  it('SMTP joignable : vérifie la connexion (AUTH) sans rien envoyer, puis envoie par ce relais', async () => {
    const relais = await serveur();
    const { lignes, journal } = journalEspion();
    const expediteur = await preparerExpediteur(smtp(relais.port), journal);

    await vi.waitFor(() => {
      expect(relais.authentifications).toContainEqual({ utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE });
    });
    expect(relais.messages).toHaveLength(0);
    // Laisse finir la vérification avant de constater qu'elle n'a rien signalé.
    await new Promise((fin) => setTimeout(fin, 200));
    expect(lignes).toEqual([]);

    await expediteur.envoyer(MESSAGE);
    expect(relais.messages).toHaveLength(1);
    expect(relais.messages[0]?.rcptTo).toEqual([MESSAGE.a]);
    expect(lireTexte(relais.messages[0]?.donnees ?? '')).toBe(MESSAGE.texte);
  });

  it('SMTP injoignable : ne rejette pas, signale le relais (sans mot de passe), rend un expéditeur dont l’envoi échoue', async () => {
    const port = await portFerme();
    const { lignes, journal } = journalEspion();
    const expediteur = await preparerExpediteur(smtp(port), journal);

    await vi.waitFor(() => {
      attendreSignalement(lignes, port);
    });
    await expect(expediteur.envoyer(MESSAGE)).rejects.toThrow();
  });

  it('STARTTLS exigé mais absent : ne rejette pas, signale le relais, les identifiants ne partent pas', async () => {
    const relais = await serveur();
    const { lignes, journal } = journalEspion();
    await preparerExpediteur(smtp(relais.port, { securite: 'starttls' }), journal);

    await vi.waitFor(() => {
      attendreSignalement(lignes, relais.port);
    });
    expect(relais.authentifications).toHaveLength(0);
  });

  it('console : aucun relais contacté', async () => {
    const relais = await serveur();
    const { lignes, journal } = journalEspion();
    const expediteur = await preparerExpediteur({ type: 'console' }, journal);
    expect(typeof expediteur.envoyer).toBe('function');
    expect(relais.connexions()).toBe(0);
    expect(lignes).toEqual([]);
  });
});

// ── Démarrage réel : node src/index.ts ─────────────────────────────────────────────────────

const INDEX = fileURLToPath(new URL('./index.ts', import.meta.url));
const DOSSIER_API = fileURLToPath(new URL('..', import.meta.url));
const ECOUTE = /à l'écoute/;
const GRACE_MS = 500;

interface Sortie {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Vrai si le processus tournait encore (à l'écoute, ou au bout du délai) : il a été arrêté. */
  readonly toujoursEnVie: boolean;
  /** Délai entre le lancement et « à l'écoute » (ms), ou undefined s'il n'est jamais venu. */
  readonly ecouteApresMs: number | undefined;
}

interface OptionsDemarrer {
  /** Après « à l'écoute », continue jusqu'à ce que cette condition soit vraie (ou le délai). */
  readonly jusqua?: (sortie: { readonly stdout: string; readonly stderr: string }) => boolean;
  /** Délai total avant arrêt forcé ; 15 s par défaut. */
  readonly delaiMs?: number;
}

/**
 * Lance l'API avec cet environnement (rien hérité de process.env sauf PATH), attend qu'elle
 * sorte ou écrive « à l'écoute », puis l'arrête. Après « à l'écoute », attend en plus `jusqua`
 * (vérifiée à chaque sortie et toutes les 50 ms), ou au moins un délai de grâce de 500 ms
 * (deux tubes, ordre non garanti).
 */
function demarrer(env: Record<string, string>, options: OptionsDemarrer = {}): Promise<Sortie> {
  return new Promise((fin) => {
    const debut = Date.now();
    const enfant = spawn(process.execPath, [INDEX], {
      cwd: DOSSIER_API,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let enVie = false;
    let ecouteApresMs: number | undefined;
    let sondage: ReturnType<typeof setInterval> | undefined;
    const arreter = (): void => {
      if (enVie) return;
      enVie = true;
      clearInterval(sondage);
      enfant.kill('SIGKILL');
    };
    const minuterie = setTimeout(arreter, options.delaiMs ?? 15_000);
    const verifier = (): void => {
      if (ecouteApresMs === undefined || options.jusqua === undefined) return;
      if (options.jusqua({ stdout, stderr })) arreter();
    };
    enfant.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (ecouteApresMs === undefined && stdout.includes("à l'écoute")) {
        ecouteApresMs = Date.now() - debut;
        if (options.jusqua === undefined) {
          clearTimeout(minuterie);
          setTimeout(arreter, GRACE_MS);
        } else {
          sondage = setInterval(verifier, 50);
        }
      }
      verifier();
    });
    enfant.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      verifier();
    });
    enfant.on('exit', (code) => {
      clearTimeout(minuterie);
      clearInterval(sondage);
      fin({ code, stdout, stderr, toujoursEnVie: enVie, ecouteApresMs });
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
  it('relais SMTP injoignable : l’API démarre quand même, l’erreur SMTP est sur la sortie d’erreur, sans le mot de passe', async () => {
    const port = await portFerme();
    const sortie = await demarrer(await envSmtp(port), { jusqua: ({ stderr }) => stderr.includes(String(port)) });

    // Une panne du relais n'arrête jamais l'API (ni la synchro) : seule la config incomplète le fait.
    expect(sortie.stdout, `l’API n’a pas démarré (code ${String(sortie.code)}) :\n${sortie.stderr}`).toMatch(ECOUTE);
    expect(sortie.stderr).toMatch(/SMTP/);
    expect(sortie.stderr).toContain('127.0.0.1');
    expect(sortie.stderr).toContain(String(port));
    expect(sortie.stdout + sortie.stderr).not.toContain(MOT_DE_PASSE);
  }, 30_000);

  // Relecture T09c : remplace « relais joignable : la connexion est vérifiée avant d'écouter »
  // (décision du chef d'équipe : une panne de Brevo ne doit jamais retarder la synchro).
  it('relais SMTP joignable : la vérification a lieu (connexion + AUTH) après le démarrage', async () => {
    const relais = await serveur();
    const sortie = await demarrer(await envSmtp(relais.port), { jusqua: () => relais.authentifications.length > 0 });

    expect(sortie.stdout, sortie.stderr).toMatch(ECOUTE);
    expect(relais.connexions()).toBeGreaterThanOrEqual(1);
    expect(relais.authentifications).toContainEqual({ utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE });
    expect(relais.messages).toHaveLength(0);
    expect(sortie.stdout + sortie.stderr).not.toContain(MOT_DE_PASSE);
  }, 30_000);

  it('relecture T09c : relais MUET, l’API écoute en moins de 2 s, l’avertissement SMTP arrive ensuite', async () => {
    const relais = await serveur({ muet: true });
    const sortie = await demarrer(await envSmtp(relais.port), {
      jusqua: ({ stderr }) => stderr.includes('SMTP'),
      delaiMs: 25_000,
    });

    expect(sortie.stdout, `l’API n’a pas démarré :\n${sortie.stderr}`).toMatch(ECOUTE);
    expect(sortie.ecouteApresMs ?? Infinity).toBeLessThan(2_000);
    expect(relais.connexions()).toBeGreaterThanOrEqual(1);
    expect(sortie.stderr).toMatch(/SMTP/);
    expect(sortie.stderr).toContain(String(relais.port));
    expect(sortie.stdout + sortie.stderr).not.toContain(MOT_DE_PASSE);
  }, 40_000);

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
