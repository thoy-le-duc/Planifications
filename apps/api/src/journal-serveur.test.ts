/**
 * Tests d'acceptation T10m — journal du serveur : la même règle partout.
 *
 * Aucune ligne du journal du serveur ne contient de valeur saisie ni de donnée personnelle, et
 * aucune ne peut être falsifiée par un client (une entrée = une ligne).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * - Un seul journal pour toute l'API : `DependancesApp.journal` (dependances.ts, T10j), reçu par
 *   creerApp. Le gestionnaire d'erreur de app.ts écrit DANS CE JOURNAL, jamais sur la console.
 * - Chaque entrée est UNE ligne : ni \r, ni \n, ni U+0085, U+2028, U+2029, ni aucun caractère de
 *   contrôle ou de format (nettoyage de T10j, `ligneDeJournal` de journal.ts, testé dans
 *   journal.test.ts).
 * - L'entrée cite le motif de la route (`c.req.routePath`, ex. /fermes/:id ou /sync/*), jamais le
 *   chemin brut de la requête, que le client choisit.
 * - Un journal en panne (qui lève) ne change pas la réponse : 500 ou 503 quand même.
 * - Erreur inattendue (500) : journalisée par sa classe (nom du constructeur), son code s'il en a
 *   un (SQLSTATE de Postgres ; pour une DrizzleQueryError, celui de sa cause) et sa pile, JAMAIS
 *   par son message, ni par les champs de l'erreur qui recopient la saisie (detail, params,
 *   query…). La pile d'une Error commence par « Nom: message » : ce début ne doit pas passer non
 *   plus. Le client reçoit un 500 sans détail.
 * - Échec d'envoi d'e-mail (ErreurEnvoiCourriel) : 503 au client ; une entrée « [courriel] » avec
 *   la méthode, le chemin et le message déjà nettoyé par l'expéditeur SMTP (erreurPropre,
 *   courriel-smtp.ts : relais, étape, code nodemailer, code de réponse SMTP), sur une ligne.
 *   Une erreur d'expéditeur qui n'est PAS une ErreurEnvoiCourriel (texte brut d'un serveur SMTP)
 *   est une erreur inattendue : règle du 500 ci-dessus.
 * - Aucun appel `console.*` dans le code de production de apps/api/src, sauf aux points d'entrée
 *   qui fournissent la sortie par défaut (voir AUTORISES plus bas).
 *
 * Route utilisée : POST /auth/code, servie par app.request (pas de socket, donc pas de limite par
 * IP ni de base) ; la base est un faux dont `transaction` lève l'erreur voulue, ou réussit pour
 * atteindre l'envoi du courriel.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DrizzleQueryError } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import ts from 'typescript';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { creerApp } from './app.ts';
import { genererCleSignature, type TrousseauCles } from './auth/cles.ts';
import { emettreJetonAcces } from './auth/jetons.ts';
import { ErreurEnvoiCourriel, type ExpediteurCourriel } from './auth/courriel.ts';

/** Valeur piégée : saisie du client, donnée personnelle et fausse entrée de journal. */
const PIEGE = "tomate\n[synchro] refus faux 'Jean Dupont' jean@exemple.fr";
/** Morceaux qui ne doivent apparaître dans aucune ligne du journal. */
const MORCEAUX_INTERDITS = ['tomate', 'Jean Dupont', 'jean@exemple.fr', '[synchro] refus faux'];
/** Une ligne, toujours : contrôles (dont \r \n \t), U+0085, séparateurs de ligne et de paragraphe. */
const SAUT_OU_CONTROLE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

let cles: TrousseauCles;
beforeAll(async () => {
  cles = { active: await genererCleSignature('t10m'), precedentes: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fausse base : seule `transaction` est appelée par POST /auth/code. */
function fausseBase(transaction: () => Promise<unknown>): NodePgDatabase {
  return { transaction } as unknown as NodePgDatabase;
}

const expediteurMuet: ExpediteurCourriel = {
  envoyer: () => Promise.resolve(),
};

interface Essai {
  readonly status: number;
  readonly corps: string;
  readonly lignes: readonly string[];
  /** Tout ce qui est parti sur la console pendant la requête. */
  readonly console: readonly string[];
}

async function demanderCode(db: NodePgDatabase, expediteur: ExpediteurCourriel = expediteurMuet): Promise<Essai> {
  const lignes: string[] = [];
  const surConsole: string[] = [];
  const capter = (...args: unknown[]): void => {
    surConsole.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : String(a))).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(capter);
  vi.spyOn(console, 'warn').mockImplementation(capter);
  vi.spyOn(console, 'log').mockImplementation(capter);
  vi.spyOn(console, 'info').mockImplementation(capter);
  const app = creerApp({
    db,
    expediteur,
    cles,
    emetteur: 'https://api.test',
    audience: 'powersync-test',
    journal: (ligne) => {
      lignes.push(ligne);
    },
  });
  const res = await app.request('/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jean@exemple.fr' }),
  });
  return { status: res.status, corps: await res.text(), lignes, console: surConsole };
}

/** Règle commune : au moins une entrée, aucune ne cite la saisie, chacune sur une ligne, rien sur la console. */
function verifierJournalPropre(essai: Essai): void {
  expect(essai.lignes.length, 'au moins une entrée dans le journal injecté').toBeGreaterThan(0);
  for (const ligne of essai.lignes) {
    expect(ligne, 'entrée sur une seule ligne, sans caractère de contrôle').not.toMatch(SAUT_OU_CONTROLE);
    for (const morceau of MORCEAUX_INTERDITS) {
      expect(ligne, `l'entrée ne cite pas « ${morceau} »`).not.toContain(morceau);
    }
  }
  expect(essai.console, 'rien sur la console : tout passe par le journal injecté').toEqual([]);
}

function verifierReponseMuette(essai: Essai): void {
  for (const morceau of MORCEAUX_INTERDITS) expect(essai.corps).not.toContain(morceau);
}

describe('T10m — erreur inattendue (500) : classe, code et pile, jamais le message', () => {
  it('une Error dont le message cite la saisie : 500, une ligne propre avec la classe et la pile', async () => {
    const essai = await demanderCode(fausseBase(() => Promise.reject(new TypeError(PIEGE))));
    expect(essai.status).toBe(500);
    verifierReponseMuette(essai);
    verifierJournalPropre(essai);
    const ligne = essai.lignes.join(' ');
    expect(ligne, 'classe de l’erreur').toContain('TypeError');
    // La pile : la première frame est ce fichier, où l'erreur a été créée.
    expect(ligne, 'pile de l’erreur').toContain('journal-serveur.test.ts');
  });

  it('une erreur de Postgres (DatabaseError, SQLSTATE 23505, detail citant la saisie) : classe et code, sans message ni detail', async () => {
    const erreur = new pg.DatabaseError(`duplicate key value violates unique constraint "culture_nom" ${PIEGE}`, 0, 'error');
    erreur.code = '23505';
    erreur.detail = `Key (nom)=(${PIEGE}) already exists.`;
    erreur.constraint = 'culture_nom';
    const essai = await demanderCode(fausseBase(() => Promise.reject(erreur)));
    expect(essai.status).toBe(500);
    verifierReponseMuette(essai);
    verifierJournalPropre(essai);
    const ligne = essai.lignes.join(' ');
    expect(ligne).toContain('DatabaseError');
    expect(ligne).toContain('23505');
  });

  it('une erreur façon Postgres sans classe dédiée (objet Error portant code et detail) : code présent, detail absent', async () => {
    const erreur = Object.assign(new Error(PIEGE), { code: '23505', detail: `Key (email)=(${PIEGE}) already exists.` });
    const essai = await demanderCode(fausseBase(() => Promise.reject(erreur)));
    expect(essai.status).toBe(500);
    verifierJournalPropre(essai);
    const ligne = essai.lignes.join(' ');
    expect(ligne).toContain('Error');
    expect(ligne).toContain('23505');
  });

  it('une DrizzleQueryError (requête et paramètres saisis dans le message) : classe et code de la cause, sans paramètres', async () => {
    const cause = new pg.DatabaseError(`value too long ${PIEGE}`, 0, 'error');
    cause.code = '22001';
    const erreur = new DrizzleQueryError('insert into "culture" ("nom") values ($1)', [PIEGE], cause);
    const essai = await demanderCode(fausseBase(() => Promise.reject(erreur)));
    expect(essai.status).toBe(500);
    verifierReponseMuette(essai);
    verifierJournalPropre(essai);
    const ligne = essai.lignes.join(' ');
    expect(ligne).toContain('DrizzleQueryError');
    expect(ligne, 'SQLSTATE de la cause').toContain('22001');
  });

  it('un code qui tente d’ouvrir une fausse entrée ne casse pas la ligne', async () => {
    const erreur = Object.assign(new Error('x'), { code: `23505\n[synchro] refus faux 'Jean Dupont' jean@exemple.fr` });
    const essai = await demanderCode(fausseBase(() => Promise.reject(erreur)));
    expect(essai.status).toBe(500);
    verifierJournalPropre(essai);
  });
});

describe('T10m — échec d’envoi du courriel', () => {
  const baseOk = (): NodePgDatabase => fausseBase(() => Promise.resolve(null));

  it('ErreurEnvoiCourriel (message déjà nettoyé par erreurPropre) : 503, une ligne [courriel] dans le journal injecté', async () => {
    const expediteur: ExpediteurCourriel = {
      envoyer: () =>
        Promise.reject(new ErreurEnvoiCourriel('Relais SMTP smtp.exemple.fr:587 : courriel non envoyé (code EAUTH, réponse 535).')),
    };
    const essai = await demanderCode(baseOk(), expediteur);
    expect(essai.status).toBe(503);
    expect(JSON.parse(essai.corps)).toEqual({ erreur: 'envoi_impossible' });
    verifierJournalPropre(essai);
    const ligne = essai.lignes.join(' ');
    // Ce qui marche déjà (T09c) reste : étiquette, route, relais et codes sûrs.
    expect(ligne).toContain('[courriel]');
    expect(ligne).toContain('POST /auth/code');
    expect(ligne).toContain('smtp.exemple.fr:587');
    expect(ligne).toContain('EAUTH');
    expect(ligne).toContain('535');
  });

  it('ErreurEnvoiCourriel dont le message contient un retour à la ligne : toujours une seule ligne', async () => {
    const expediteur: ExpediteurCourriel = {
      envoyer: () => Promise.reject(new ErreurEnvoiCourriel('Relais SMTP smtp.exemple.fr:587 : courriel non envoyé.\n[synchro] refus faux')),
    };
    const essai = await demanderCode(baseOk(), expediteur);
    expect(essai.status).toBe(503);
    expect(essai.lignes.length).toBeGreaterThan(0);
    for (const ligne of essai.lignes) expect(ligne).not.toMatch(SAUT_OU_CONTROLE);
    expect(essai.console).toEqual([]);
  });

  it('erreur brute d’un serveur SMTP (pas une ErreurEnvoiCourriel) : 500, ni l’adresse ni le texte du serveur au journal', async () => {
    const brute = Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <jean@exemple.fr>: ${PIEGE}`), {
      code: 'EENVELOPE',
      responseCode: 550,
      response: `550 5.1.1 <jean@exemple.fr>: Recipient address rejected ${PIEGE}`,
    });
    const expediteur: ExpediteurCourriel = { envoyer: () => Promise.reject(brute) };
    const essai = await demanderCode(baseOk(), expediteur);
    expect(essai.status).toBe(500);
    verifierReponseMuette(essai);
    verifierJournalPropre(essai);
    expect(essai.lignes.join(' ')).toContain('EENVELOPE');
  });
});

// ── Relecture T10m : chemin de la requête, journal en panne ─────────────────────────────────

describe('T10m (relecture) — le journal cite le motif de la route, jamais le chemin brut', () => {
  /** Jeton d'accès valide : la garde va jusqu'à la base, qui lève. */
  async function jeton(): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: 'https://api.test', audience: 'powersync-test' }, '01890a5d-ac96-774b-bcce-b302099a8057', new Date());
  }

  /** Base dont toute lecture lève une erreur dont le message cite la saisie. */
  const baseQuiLeve = (): NodePgDatabase =>
    ({
      select: () => {
        throw new TypeError(PIEGE);
      },
      transaction: () => Promise.reject(new TypeError(PIEGE)),
    }) as unknown as NodePgDatabase;

  async function appeler(methode: string, chemin: string): Promise<Essai> {
    const lignes: string[] = [];
    const surConsole: string[] = [];
    const capter = (...args: unknown[]): void => {
      surConsole.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'error').mockImplementation(capter);
    vi.spyOn(console, 'log').mockImplementation(capter);
    const app = creerApp({
      db: baseQuiLeve(),
      expediteur: expediteurMuet,
      cles,
      emetteur: 'https://api.test',
      audience: 'powersync-test',
      journal: (ligne) => {
        lignes.push(ligne);
      },
    });
    const res = await app.request(chemin, {
      method: methode,
      headers: { authorization: `Bearer ${await jeton()}`, 'content-type': 'application/json' },
      ...(methode === 'POST' ? { body: '{}' } : {}),
    });
    return { status: res.status, corps: await res.text(), lignes, console: surConsole };
  }

  const CHEMINS: readonly (readonly [string, string, string])[] = [
    ['GET', '/fermes/Jean Dupont tomate', '/fermes'],
    ['GET', '/fermes/Jean%20Dupont%20tomate', '/fermes'],
    ['GET', '/fermes/jean%40exemple.fr', '/fermes'],
    ['GET', '/fermes/jean%0A%5Bsynchro%5D%20tomate', '/fermes'],
    ['POST', `/sync/${encodeURIComponent('abc\u202Etomate jean')}`, '/sync'],
    ['POST', '/sync/upload/../jean%E2%80%AEtomate', '/sync'],
  ];

  for (const [methode, chemin, motif] of CHEMINS) {
    it(`${methode} ${chemin} : 500, l'entrée cite ${motif}…, ni « jean », ni « tomate »`, async () => {
      const essai = await appeler(methode, chemin);
      expect(essai.status).toBe(500);
      expect(essai.lignes.length).toBeGreaterThan(0);
      for (const ligne of essai.lignes) {
        expect(ligne).not.toMatch(SAUT_OU_CONTROLE);
        expect(ligne).not.toMatch(/\p{Cf}/u);
        expect(ligne.toLowerCase()).not.toContain('jean');
        expect(ligne).not.toContain('tomate');
        expect(ligne).not.toContain('Dupont');
      }
      expect(essai.lignes.join(' ')).toContain(motif);
      expect(essai.console).toEqual([]);
    });
  }
});

describe('T10m (relecture) — journal en panne : la réponse part quand même', () => {
  function appQuiJournaliseMal(db: NodePgDatabase, expediteur: ExpediteurCourriel = expediteurMuet): ReturnType<typeof creerApp> {
    return creerApp({
      db,
      expediteur,
      cles,
      emetteur: 'https://api.test',
      audience: 'powersync-test',
      journal: () => {
        throw new Error('sortie d’erreur fermée');
      },
    });
  }
  const requete = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'jean@exemple.fr' }) };

  it('erreur inattendue : 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await appQuiJournaliseMal(fausseBase(() => Promise.reject(new TypeError(PIEGE)))).request('/auth/code', requete);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('tomate');
  });

  it('échec d’envoi du courriel : 503 envoi_impossible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const expediteur: ExpediteurCourriel = {
      envoyer: () => Promise.reject(new ErreurEnvoiCourriel('Relais SMTP smtp.exemple.fr:587 : courriel non envoyé (code EAUTH).')),
    };
    const res = await appQuiJournaliseMal(
      fausseBase(() => Promise.resolve(null)),
      expediteur,
    ).request('/auth/code', requete);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ erreur: 'envoi_impossible' });
  });
});

// ── Aucune écriture directe sur la console ni sur les sorties dans le code de production ────

/**
 * Écritures directes autorisées, par fichier (chemin relatif à apps/api/src). Formes repérées :
 * `console.x` (et `globalThis.console.x`, `global.console.x`), `console[…]`, alias de `console`,
 * `process.stderr.write`, `process.stdout.write`. Nom donné : « error », « log »… pour la console,
 * « stderr.write » / « stdout.write » pour les sorties.
 * - index.ts : point d'entrée ; il fournit les sorties par défaut (configuration invalide avant
 *   que le journal existe, « à l'écoute »), tout y est permis ;
 * - generer-cles.ts : outil en ligne de commande qui écrit une clé sur la sortie standard ;
 * - dependances.ts : la sortie par défaut du journal (`journalParDefaut`), console.error ou
 *   process.stderr.write ;
 * - auth/courriel.ts : la sortie par défaut de `expediteurConsole` (console.log), qui n'est pas
 *   un journal mais l'affichage du courriel lui-même en développement (sur demande explicite,
 *   jamais en production).
 * Tout le reste (app.ts, demarrage.ts, sync/**, auth/**…) passe par le journal injecté.
 */
const AUTORISES: Readonly<Record<string, readonly string[] | 'tout'>> = {
  'index.ts': 'tout',
  'generer-cles.ts': ['log', 'stdout.write'],
  'dependances.ts': ['error', 'stderr.write'],
  'auth/courriel.ts': ['log'],
};

const RACINE = fileURLToPath(new URL('.', import.meta.url));

/** Fichiers .ts de production : ni *.test.ts, ni dossier test/. */
function fichiersProduction(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name !== 'test' && entree.name !== 'node_modules') trouves.push(...fichiersProduction(chemin));
    } else if (entree.name.endsWith('.ts') && !entree.name.endsWith('.test.ts') && !entree.name.endsWith('.d.ts')) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

const GLOBAUX = new Set(['globalThis', 'global', 'window', 'self']);

/** `console`, `globalThis.console`, `global.console`… */
function estConsole(noeud: ts.Node): boolean {
  if (ts.isIdentifier(noeud)) return noeud.text === 'console';
  if (ts.isPropertyAccessExpression(noeud)) return noeud.name.text === 'console' && ts.isIdentifier(noeud.expression) && GLOBAUX.has(noeud.expression.text);
  if (ts.isElementAccessExpression(noeud)) {
    return ts.isStringLiteralLike(noeud.argumentExpression) && noeud.argumentExpression.text === 'console' && ts.isIdentifier(noeud.expression) && GLOBAUX.has(noeud.expression.text);
  }
  return false;
}

/** `process.stderr` / `process.stdout` (aussi via globalThis.process) : « stderr » ou « stdout », sinon null. */
function sortieProcessus(noeud: ts.Node): string | null {
  if (!ts.isPropertyAccessExpression(noeud) || (noeud.name.text !== 'stderr' && noeud.name.text !== 'stdout')) return null;
  const p = noeud.expression;
  const estProcess =
    (ts.isIdentifier(p) && p.text === 'process') ||
    (ts.isPropertyAccessExpression(p) && p.name.text === 'process' && ts.isIdentifier(p.expression) && GLOBAUX.has(p.expression.text));
  return estProcess ? noeud.name.text : null;
}

/** Chaque écriture directe du code (commentaires et chaînes exclus) : méthode et ligne. */
function ecrituresDirectes(nom: string, texte: string): { readonly methode: string; readonly ligne: number }[] {
  const source = ts.createSourceFile(nom, texte, ts.ScriptTarget.Latest, true);
  const usages: { methode: string; ligne: number }[] = [];
  const noter = (methode: string, noeud: ts.Node): void => {
    usages.push({ methode, ligne: source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1 });
  };
  const visiter = (noeud: ts.Node): void => {
    const parent = noeud.parent as ts.Node | undefined;
    if (ts.isPropertyAccessExpression(noeud) && estConsole(noeud.expression)) {
      noter(noeud.name.text, noeud);
    } else if (ts.isElementAccessExpression(noeud) && estConsole(noeud.expression)) {
      noter('[…]', noeud);
    } else if (ts.isPropertyAccessExpression(noeud) && sortieProcessus(noeud.expression) !== null) {
      noter(`${String(sortieProcessus(noeud.expression))}.${noeud.name.text}`, noeud);
    } else if (sortieProcessus(noeud) !== null && parent !== undefined && !(ts.isPropertyAccessExpression(parent) && parent.expression === noeud)) {
      // `const e = process.stderr` : contournement, interdit aussi.
      noter(`${String(sortieProcessus(noeud))} (alias)`, noeud);
    } else if (
      estConsole(noeud) &&
      parent !== undefined &&
      !((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === noeud) &&
      !(ts.isPropertyAccessExpression(parent) && parent.name === noeud && estConsole(parent))
    ) {
      // `const c = console`, `{ error } = globalThis.console`… : contournement, interdit aussi.
      noter('(alias)', noeud);
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(source);
  return usages;
}

describe('T10m — un seul journal : pas d’écriture directe dans le code de production', () => {
  it('le balayage trouve bien les fichiers de production (témoin)', () => {
    const fichiers = fichiersProduction(RACINE).map((f) => relative(RACINE, f).split('\\').join('/'));
    expect(fichiers).toContain('app.ts');
    expect(fichiers).toContain('sync/upload.ts');
    expect(fichiers).not.toContain('journal-serveur.test.ts');
    expect(fichiers.some((f) => f.startsWith('sync/test/'))).toBe(false);
  });

  it('le repérage voit toutes les formes, et ignore commentaires et chaînes (témoin)', () => {
    const texte = [
      'console.error(a);',
      'globalThis.console.warn(a);',
      'global.console.log(a);',
      "globalThis['console'].info(a);",
      "console['debug'](a);",
      'const c = console;',
      'process.stderr.write(a);',
      'process.stdout.write(a);',
      'globalThis.process.stderr.write(a);',
      'const s = process.stderr;',
      '// console.error(a); process.stderr.write(a)',
      "const t = 'console.log(a) process.stdout.write(a)';",
      'monJournal.error(a); process.exit(1); process.on("x", f);',
    ].join('\n');
    expect(ecrituresDirectes('essai.ts', texte).map((u) => `${String(u.ligne)} ${u.methode}`)).toEqual([
      '1 error',
      '2 warn',
      '3 log',
      '4 info',
      '5 […]',
      '6 (alias)',
      '7 stderr.write',
      '8 stdout.write',
      '9 stderr.write',
      '10 stderr (alias)',
    ]);
  });

  it('aucune écriture directe hors des points d’entrée autorisés', () => {
    const interdits: string[] = [];
    for (const chemin of fichiersProduction(RACINE)) {
      const nom = relative(RACINE, chemin).split('\\').join('/');
      const permis = AUTORISES[nom];
      if (permis === 'tout') continue;
      for (const { methode, ligne } of ecrituresDirectes(chemin, readFileSync(chemin, 'utf8'))) {
        if (permis?.includes(methode) !== true) interdits.push(`${nom}:${String(ligne)} ${methode}`);
      }
    }
    expect(interdits).toEqual([]);
  });
});

// ── index.ts : les erreurs hors requête passent aussi par le journal nettoyé ─────────────────

/**
 * index.ts n'est pas testable sans lancer le processus (configuration, écoute) : test statique.
 * Attendu : `pool.on('error', …)`, `process.on('unhandledRejection', …)` et
 * `process.on('uncaughtException', …)` sont branchés, et chaque gestionnaire décrit l'erreur par
 * `decrireErreur` et l'écrit par le journal (`journal(…)`, la variable qui reçoit
 * journalParDefaut), jamais par console.* ni par le message brut.
 */
describe('T10m (relecture) — index.ts branche les erreurs hors requête sur le journal', () => {
  const texte = readFileSync(join(RACINE, 'index.ts'), 'utf8');
  const source = ts.createSourceFile('index.ts', texte, ts.ScriptTarget.Latest, true);

  /** Texte du gestionnaire de `<cible>.on('<evenement>', gestionnaire)`, ou null. */
  function gestionnaire(cible: string, evenement: string): string | null {
    let trouve: string | null = null;
    const visiter = (noeud: ts.Node): void => {
      if (
        trouve === null &&
        ts.isCallExpression(noeud) &&
        ts.isPropertyAccessExpression(noeud.expression) &&
        (noeud.expression.name.text === 'on' || noeud.expression.name.text === 'once') &&
        noeud.expression.expression.getText(source) === cible &&
        noeud.arguments.length >= 2
      ) {
        const [nom, rappel] = noeud.arguments;
        if (nom !== undefined && rappel !== undefined && ts.isStringLiteralLike(nom) && nom.text === evenement) trouve = rappel.getText(source);
      }
      ts.forEachChild(noeud, visiter);
    };
    visiter(source);
    return trouve;
  }

  for (const [cible, evenement] of [
    ['pool', 'error'],
    ['process', 'unhandledRejection'],
    ['process', 'uncaughtException'],
  ] as const) {
    it(`${cible}.on('${evenement}') écrit decrireErreur(…) dans le journal`, () => {
      const corps = gestionnaire(cible, evenement);
      expect(corps, `${cible}.on('${evenement}', …) absent de index.ts`).not.toBeNull();
      expect(corps).toMatch(/\bjournal\s*\(/);
      expect(corps).toContain('decrireErreur(');
      expect(corps).not.toMatch(/\bconsole\b/);
      expect(corps).not.toMatch(/\.message\b/);
    });
  }
});
