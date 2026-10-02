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
 *   contrôle (nettoyage de T10j, `ligneDeJournal` de sync/upload.ts).
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

// ── Aucun console.* dans le code de production ──────────────────────────────────────────────

/**
 * Appels `console.<méthode>` autorisés, par fichier (chemin relatif à apps/api/src) :
 * - index.ts : point d'entrée ; il fournit les sorties par défaut (configuration invalide avant
 *   que le journal existe, « à l'écoute »), tout console.* y est permis ;
 * - generer-cles.ts : outil en ligne de commande qui écrit une clé sur la sortie standard ;
 * - dependances.ts : la valeur par défaut du journal (`deps.journal ?? console.error`), seul
 *   console.error ;
 * - auth/courriel.ts : la sortie par défaut de `expediteurConsole` (console.log), qui n'est pas
 *   un journal mais l'affichage du courriel lui-même en développement (sur demande explicite,
 *   jamais en production).
 * Tout le reste (app.ts, demarrage.ts, sync/**, auth/**…) passe par le journal injecté.
 */
const AUTORISES: Readonly<Record<string, readonly string[] | 'tout'>> = {
  'index.ts': 'tout',
  'generer-cles.ts': ['log'],
  'dependances.ts': ['error'],
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

/** Chaque `console.<méthode>` du code (commentaires et chaînes exclus) : « méthode:ligne ». */
function usagesConsole(chemin: string): { readonly methode: string; readonly ligne: number }[] {
  const source = ts.createSourceFile(chemin, readFileSync(chemin, 'utf8'), ts.ScriptTarget.Latest, true);
  const usages: { methode: string; ligne: number }[] = [];
  const visiter = (noeud: ts.Node): void => {
    if (ts.isPropertyAccessExpression(noeud) && ts.isIdentifier(noeud.expression) && noeud.expression.text === 'console') {
      usages.push({ methode: noeud.name.text, ligne: source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1 });
    } else if (ts.isElementAccessExpression(noeud) && ts.isIdentifier(noeud.expression) && noeud.expression.text === 'console') {
      usages.push({ methode: '[…]', ligne: source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1 });
    } else if (ts.isIdentifier(noeud) && noeud.text === 'console' && !ts.isPropertyAccessExpression(noeud.parent) && !ts.isElementAccessExpression(noeud.parent)) {
      // `const c = console`, `{ error } = console`… : contournement, interdit aussi.
      usages.push({ methode: '(alias)', ligne: source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1 });
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(source);
  return usages;
}

describe('T10m — un seul journal : pas de console.* dans le code de production', () => {
  it('le balayage trouve bien les fichiers de production (témoin)', () => {
    const fichiers = fichiersProduction(RACINE).map((f) => relative(RACINE, f).split('\\').join('/'));
    expect(fichiers).toContain('app.ts');
    expect(fichiers).toContain('sync/upload.ts');
    expect(fichiers).not.toContain('journal-serveur.test.ts');
    expect(fichiers.some((f) => f.startsWith('sync/test/'))).toBe(false);
  });

  it('aucun appel console.* hors des points d’entrée autorisés', () => {
    const interdits: string[] = [];
    for (const chemin of fichiersProduction(RACINE)) {
      const nom = relative(RACINE, chemin).split('\\').join('/');
      const permis = AUTORISES[nom];
      if (permis === 'tout') continue;
      for (const { methode, ligne } of usagesConsole(chemin)) {
        if (permis?.includes(methode) !== true) interdits.push(`${nom}:${String(ligne)} console.${methode}`);
      }
    }
    expect(interdits).toEqual([]);
  });
});
