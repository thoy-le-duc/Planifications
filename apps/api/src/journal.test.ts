/**
 * Tests unitaires de journal.ts (T10m, relecture) : `ligneDeJournal` et `decrireErreur`.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * ligneDeJournal(texte) : une ligne, au plus 1 000 unités UTF-16, sans caractère de contrôle
 * (\p{Cc}), séparateur de ligne ou de paragraphe (\p{Zl}, \p{Zp}), caractère de format (\p{Cf} :
 * U+202E, U+2066–2069, U+200B, U+FEFF… qui retournent ou masquent l'affichage d'une ligne), ni
 * substitut isolé (\p{Cs}). La troncature ne coupe jamais une paire de substitution en deux.
 *
 * decrireErreur(erreur) : classe, code sûr, cause, et positions de la pile. De la pile, il ne
 * reste que des positions `fichier:ligne:colonne` sous `node:` ou sous la racine du dépôt (calculée
 * depuis import.meta.url de journal.ts), écrites RELATIVES à cette racine (`apps/api/src/app.ts:12:3`,
 * `node_modules/pg/…`) ; une position hors de la racine (/home/jean@…, /srv/…) disparaît : ni nom
 * de fonction, ni « [as …] », ni texte qui précède la première frame (« Nom: message », dont le
 * nom et le message peuvent imiter des frames), ni frame d'une pile concaténée par une
 * bibliothèque (« \ncause: » + pile de la cause). Elle ne lève jamais, quelle que soit la valeur.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { decrireErreur, ligneDeJournal } from './journal.ts';

/** Racine du dépôt (apps/api/src → ../../../), en chemin et en URL file://. */
const URL_RACINE = new URL('../../../', import.meta.url).href;
const RACINE = fileURLToPath(URL_RACINE);

const INTERDITS = ['jean', 'exemple.fr', 'tomate', 'dupont', 'secret', 'synchro'];

function sansPiege(texte: string): void {
  const bas = texte.toLowerCase();
  for (const morceau of INTERDITS) expect(bas, `ne cite pas « ${morceau} »`).not.toContain(morceau);
  expect(texte).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u);
}

describe('ligneDeJournal — caractères de format et substituts', () => {
  for (const [nom, car] of [
    ['U+202E (retournement droite-gauche)', '‮'],
    ['U+2066 (isolat gauche-droite)', '⁦'],
    ['U+2067', '⁧'],
    ['U+2068', '⁨'],
    ['U+2069 (fin d’isolat)', '⁩'],
    ['U+200B (espace sans chasse)', '​'],
    ['U+FEFF (indicateur d’ordre)', '﻿'],
    ['U+200E (marque gauche-droite)', '‎'],
    ['U+00AD (trait d’union conditionnel)', '­'],
  ] as const) {
    it(`${nom} est neutralisé`, () => {
      const ligne = ligneDeJournal(`[synchro] refus ${car}abc${car} fin`);
      expect(ligne).not.toMatch(/\p{Cf}/u);
      expect(ligne).toContain('abc');
      expect(ligne).toContain('fin');
    });
  }

  it('substituts isolés (haut, bas, inversés) neutralisés', () => {
    const ligne = ligneDeJournal('a\uD800b\uDC00c\uDC00\uD800d');
    expect(ligne).not.toMatch(/\p{Cs}/u);
    expect(ligne).toMatch(/^a.b.c..d$/u);
  });

  it('une paire valide (emoji) est gardée telle quelle', () => {
    expect(ligneDeJournal('fraise 🍓 ok')).toBe('fraise 🍓 ok');
  });

  it('troncature à 1 000 : pas de demi-paire de substitution au bout', () => {
    for (const avant of [999, 998, 1_000]) {
      const ligne = ligneDeJournal(`${'a'.repeat(avant)}🍓🍓🍓`);
      expect(ligne.length).toBeLessThanOrEqual(1_000);
      expect(ligne).not.toMatch(/\p{Cs}/u);
      expect(ligne.startsWith('a'.repeat(Math.min(avant, 999)))).toBe(true);
    }
  });

  it('contrôles toujours neutralisés (témoin T10j)', () => {
    expect(ligneDeJournal('a\nb\r\u0085  \u0000c')).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
  });
});

describe('decrireErreur — pile réduite à des positions', () => {
  it('message vide et `name` piégé imitant une frame : rien de piégé', () => {
    class Piege extends Error {
      constructor() {
        super('');
      }
    }
    Object.defineProperty(Piege.prototype, 'name', {
      value: 'Erreur\n    at jean@exemple.fr (secret.js:1:1)',
      configurable: true,
    });
    const erreur = new Piege();
    expect(erreur.stack).toContain('jean@exemple.fr');
    const ligne = decrireErreur(erreur);
    sansPiege(ligne);
    expect(ligne).toContain('Piege');
  });

  it('pile concaténée par une bibliothèque (« \\ncause: » + pile de la cause piégée) : rien de piégé', () => {
    const cause = new Error(`tomate\n    at Object.<anonymous> [as jean@exemple.fr] (${URL_RACINE}apps/api/src/a.js:1:1)\n[synchro] refus faux 'Jean Dupont'`);
    cause.stack = `Error: ${cause.message}\n    at jean@exemple.fr (${URL_RACINE}apps/api/src/b.js:2:3)\n    at tomate (node:internal/x:4:5)`;
    const erreur = new Error('requête échouée');
    erreur.stack = `Error: requête échouée\n    at f (${URL_RACINE}apps/api/src/c.js:6:7)\ncause: ${cause.stack}`;
    const ligne = decrireErreur(erreur);
    sansPiege(ligne);
    expect(ligne).toContain('apps/api/src/c.js:6:7');
    expect(ligne).not.toContain(URL_RACINE);
  });

  it('frame `at Object.f [as jean@exemple.fr] (file:///…:1:1)` : ni le nom de fonction ni le [as …], la position reste, relative', () => {
    const erreur = new Error('x');
    erreur.stack = [
      'Error: x',
      `    at Object.f [as jean@exemple.fr] (${URL_RACINE}apps/api/src/a.js:1:1)`,
      '    at async tomate.Dupont (node:internal/process/task_queues:95:5)',
      `    at new Jean (${RACINE}apps/api/src/b.ts:12:34)`,
      `    at ${URL_RACINE}node_modules/pg/lib/client.js:7:8`,
    ].join('\n');
    const ligne = decrireErreur(erreur);
    sansPiege(ligne);
    expect(ligne).not.toContain('Object.f');
    expect(ligne).not.toContain('[as');
    expect(ligne).toContain('apps/api/src/a.js:1:1');
    expect(ligne).toContain('node:internal/process/task_queues:95:5');
    expect(ligne).toContain('apps/api/src/b.ts:12:34');
    expect(ligne).toContain('node_modules/pg/lib/client.js:7:8');
    expect(ligne, 'positions relatives à la racine').not.toContain(RACINE);
    expect(ligne).not.toContain('file://');
  });

  it('position hors de la racine du dépôt (chemin qui cite une personne) : disparaît', () => {
    const erreur = new Error('m');
    erreur.stack = 'Error: m\n    at f (/home/jean@exemple.fr/JeanDupont:1:1)\n    at g (file:///srv/jean/tomate.js:2:2)\n    at h (/srv/api/src/b.ts:12:34)';
    const ligne = decrireErreur(erreur);
    sansPiege(ligne);
    expect(ligne).not.toContain('JeanDupont');
    expect(ligne).not.toContain('/srv/');
  });

  it('message raccourci après lecture de la pile : la pile garde l’ancien message piégé, rien ne passe', () => {
    const erreur = new Error('x\n    at /jean@exemple.fr:1:1\n    at tomate (/home/jean/secret.js:1:1)');
    expect(erreur.stack, 'pile lue (donc figée) avant de raccourcir le message').toContain('jean@exemple.fr');
    erreur.message = 'x';
    sansPiege(decrireErreur(erreur));
  });

  it('frame réelle de ce fichier de test (sous apps/api) : gardée, relative', () => {
    const ligne = decrireErreur(new Error('x'));
    expect(ligne).toContain('apps/api/src/journal.test.ts:');
    expect(ligne).not.toContain(RACINE);
  });

  it('une frame dont la « position » n’en est pas une (texte libre) disparaît', () => {
    const erreur = new Error('x');
    erreur.stack = `Error: x\n    at f (jean@exemple.fr tomate)\n    at g (eval at h (secret.js:1:1), <anonymous>:1:1)\n    at ${URL_RACINE}apps/api/src/a.js:1:2`;
    const ligne = decrireErreur(erreur);
    sansPiege(ligne);
    expect(ligne).toContain('apps/api/src/a.js:1:2');
  });
});

describe('decrireErreur — ne lève jamais', () => {
  it('classe dont `static get name()` lève', () => {
    class Hostile extends Error {}
    Object.defineProperty(Hostile, 'name', {
      get(): string {
        throw new Error('jean@exemple.fr');
      },
    });
    const erreur = new Hostile('x');
    let ligne = '';
    expect(() => {
      ligne = decrireErreur(erreur);
    }).not.toThrow();
    sansPiege(ligne);
  });

  it('`name` qui n’est pas une chaîne', () => {
    const erreur = new Error('x');
    Object.defineProperty(erreur, 'name', { value: { toString: () => 'jean@exemple.fr' } });
    let ligne = '';
    expect(() => {
      ligne = decrireErreur(erreur);
    }).not.toThrow();
    sansPiege(ligne);
  });

  it('Proxy dont toute opération lève', () => {
    const lever = (): never => {
      throw new Error('jean@exemple.fr');
    };
    const hostile = new Proxy(new Error('x'), {
      get: lever,
      has: lever,
      ownKeys: lever,
      getPrototypeOf: lever,
      getOwnPropertyDescriptor: lever,
    });
    let ligne = '';
    expect(() => {
      ligne = decrireErreur(hostile);
    }).not.toThrow();
    sansPiege(ligne);
  });

  it('`stack`, `message`, `code` et `cause` en accesseurs qui lèvent', () => {
    const erreur = new Error('x');
    for (const nom of ['stack', 'message', 'code', 'cause']) {
      Object.defineProperty(erreur, nom, {
        get(): never {
          throw new Error('jean@exemple.fr');
        },
      });
    }
    expect(() => decrireErreur(erreur)).not.toThrow();
  });

  it('cause cyclique (a → b → a, et a → a)', () => {
    const a = new Error('tomate');
    const b = new Error('tomate');
    Object.assign(a, { cause: b, code: '23505' });
    Object.assign(b, { cause: a });
    const seule = new Error('tomate');
    Object.assign(seule, { cause: seule });
    let ligne = '';
    expect(() => {
      ligne = decrireErreur(a) + decrireErreur(seule);
    }).not.toThrow();
    sansPiege(ligne);
    expect(ligne).toContain('23505');
  });

  it('valeurs qui ne sont pas des objets : chaîne piégée, null, undefined, symbole, nombre', () => {
    for (const valeur of ["tomate jean@exemple.fr\n[synchro]", null, undefined, Symbol('jean'), 42, 10n]) {
      let ligne = '';
      expect(() => {
        ligne = decrireErreur(valeur);
      }).not.toThrow();
      sansPiege(ligne);
    }
  });
});
