/**
 * Tests d'acceptation T15b, relecture (docs/backlog/T15b-export-leger.md) : export annulable,
 * source lue en entier, longue chaîne sans paire de substitution coupée.
 *
 * Contrats : packages/core/src/export/test/contrat.ts (« Relecture T15b ») pour `creerZip` et
 * `construireArchive`, et ./test/contrat-export.ts (« Annulation ») pour `exporterFerme`.
 * La mémoire de la longue chaîne se mesure dans un processus isolé : ./export-leger.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Compresseur, EntreeExport, ModuleExport } from '../../core/src/export/test/contrat.ts';
import type { PorteDonnees } from './test/contrat.ts';
import { exigerExporterFerme } from './test/contrat-export.ts';
import { compresseurNode, lireZip, texteZip, verifierAvecUnzip } from './test/zip.ts';

/** Nom tenu dans une variable : le typage ne dépend pas de l'API. */
const NOM_COEUR = '@planif/core';
const JOUR = '2026-09-29';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
/** Délai maximal entre l'annulation et le rejet (contrat). */
const REJET_MAX_MS = 200;
/** Au-delà, la promesse est déclarée « toujours en attente » (le test échoue au lieu de pendre). */
const GARDE_MS = 2_000;

let coeur: ModuleExport;

beforeAll(async () => {
  coeur = (await import(/* @vite-ignore */ NOM_COEUR)) as ModuleExport;
});

const jamais = () => new Promise<never>(() => undefined);
const pause = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** Compresseur bloqué : lit toute la source, puis ne rend plus jamais la main (flux coincé). */
const compresseurBloqueApresLecture: Compresseur = async function* (brut) {
  yield new Uint8Array(0);
  let lus = 0;
  for await (const b of brut) lus += b.length;
  if (lus >= 0) await jamais();
};

/** Compresseur bloqué avant de lire quoi que ce soit : la source attend. */
const compresseurBloqueSansLire: Compresseur = async function* () {
  yield new Uint8Array(0);
  await jamais();
};

type Issue = { readonly etat: 'resolue' } | { readonly etat: 'rejetee'; readonly erreur: unknown; readonly ms: number } | { readonly etat: 'en_attente' };

/** Issue d'une promesse (sans jamais afficher d'archive), et délai du rejet depuis `depuis()`. */
async function issue(p: Promise<unknown>, depuis: () => number): Promise<Issue> {
  const garde = pause(GARDE_MS).then((): Issue => ({ etat: 'en_attente' }));
  const suivie = p.then(
    (): Issue => ({ etat: 'resolue' }),
    (erreur: unknown): Issue => ({ etat: 'rejetee', erreur, ms: performance.now() - depuis() }),
  );
  return Promise.race([suivie, garde]);
}

function nomErreur(i: Issue): string {
  if (i.etat !== 'rejetee') return `(${i.etat})`;
  return i.erreur instanceof Error || i.erreur instanceof DOMException ? i.erreur.name : typeof i.erreur;
}

function messageErreur(i: Issue): string {
  if (i.etat !== 'rejetee') return `(${i.etat})`;
  return i.erreur instanceof Error ? i.erreur.message : String(i.erreur);
}

/** Annule `ctrl` après `ms` ; rend l'instant de l'annulation (lu après coup). */
function annulerDans(ctrl: AbortController, ms: number): () => number {
  let instant = Number.POSITIVE_INFINITY;
  setTimeout(() => {
    instant = performance.now();
    ctrl.abort();
  }, ms);
  return () => instant;
}

const FICHIERS = () => [
  { chemin: 'ferme.json', contenu: '{"format":"planifications-export"}' },
  { chemin: 'evenement.csv', contenu: '﻿id;note\r\n' + '1;récolte\r\n'.repeat(20_000) },
  { chemin: 'zone.csv', contenu: '﻿id;nom\r\n1;Tunnel\r\n' },
];

const ENTREE: EntreeExport = { fermeId: '0192f0c1-7a6e-7cc3-a000-000000000001', genereLe: GENERE_LE, tables: {} };

describe('T15b relecture : export annulable (signal)', () => {
  it('creerZip : compresseur bloqué après lecture, annulation → rejet AbortError en moins de 200 ms', async () => {
    const ctrl = new AbortController();
    const depuis = annulerDans(ctrl, 30);
    const i = await issue(coeur.creerZip(FICHIERS(), { date: JOUR, compresseur: compresseurBloqueApresLecture, signal: ctrl.signal }), depuis);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
    if (i.etat === 'rejetee') expect(i.ms).toBeLessThan(REJET_MAX_MS);
  });

  it('creerZip : compresseur bloqué avant de lire (la source attend), annulation → rejet AbortError en moins de 200 ms', async () => {
    const ctrl = new AbortController();
    const depuis = annulerDans(ctrl, 30);
    const i = await issue(coeur.creerZip(FICHIERS(), { compresseur: compresseurBloqueSansLire, signal: ctrl.signal }), depuis);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
    if (i.etat === 'rejetee') expect(i.ms).toBeLessThan(REJET_MAX_MS);
  });

  it('creerZip : signal déjà annulé → rejet AbortError, aucune archive, même sans compresseur', async () => {
    for (const compresseur of [undefined, compresseurNode]) {
      const ctrl = new AbortController();
      ctrl.abort();
      const debut = performance.now();
      const i = await issue(coeur.creerZip(FICHIERS(), compresseur === undefined ? { signal: ctrl.signal } : { compresseur, signal: ctrl.signal }), () => debut);
      expect(i.etat, `${compresseur === undefined ? 'stockée' : 'deflate'} : ${messageErreur(i)}`).toBe('rejetee');
      expect(nomErreur(i)).toBe('AbortError');
    }
  });

  it('creerZip : un signal jamais annulé ne change rien à l’archive', async () => {
    const ctrl = new AbortController();
    const avec = await coeur.creerZip(FICHIERS(), { date: JOUR, compresseur: compresseurNode, signal: ctrl.signal });
    const sans = await coeur.creerZip(FICHIERS(), { date: JOUR, compresseur: compresseurNode });
    expect(Buffer.compare(avec, sans)).toBe(0);
  });

  it('construireArchive : compresseur bloqué, annulation → rejet AbortError en moins de 200 ms', async () => {
    const ctrl = new AbortController();
    const depuis = annulerDans(ctrl, 30);
    const i = await issue(coeur.construireArchive(ENTREE, { date: JOUR, compresseur: compresseurBloqueApresLecture, signal: ctrl.signal }), depuis);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
    if (i.etat === 'rejetee') expect(i.ms).toBeLessThan(REJET_MAX_MS);
  });

  it('construireArchive : signal déjà annulé → rejet AbortError', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const debut = performance.now();
    const i = await issue(coeur.construireArchive(ENTREE, { date: JOUR, compresseur: compresseurNode, signal: ctrl.signal }), () => debut);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
  });

  /** Porte dont la lecture ne répond jamais (base locale coincée). */
  function porteMuette(): PorteDonnees {
    const interdit = (nom: string) => () => {
      throw new Error(`l'export ne doit pas appeler porte.${nom}`);
    };
    return {
      lire: () => jamais(),
      ecrire: interdit('ecrire'),
      surveiller: interdit('surveiller'),
      saisirEvenement: interdit('saisirEvenement'),
      surveillerRefus: interdit('surveillerRefus'),
      archiverRefus: () => Promise.resolve(),
    };
  }

  it('exporterFerme : lecture de la base qui ne répond pas, annulation → rejet AbortError en moins de 200 ms', async () => {
    const exporterFerme = await exigerExporterFerme();
    const ctrl = new AbortController();
    const depuis = annulerDans(ctrl, 30);
    const i = await issue(exporterFerme(porteMuette(), { fermeId: ENTREE.fermeId, genereLe: GENERE_LE, jour: JOUR, signal: ctrl.signal }), depuis);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
    if (i.etat === 'rejetee') expect(i.ms).toBeLessThan(REJET_MAX_MS);
  });

  it('exporterFerme : compresseur bloqué, annulation → rejet AbortError en moins de 200 ms', async () => {
    const exporterFerme = await exigerExporterFerme();
    const porte: PorteDonnees = { ...porteMuette(), lire: <T,>() => Promise.resolve([] as T[]) };
    const ctrl = new AbortController();
    const depuis = annulerDans(ctrl, 30);
    const i = await issue(
      exporterFerme(porte, { fermeId: ENTREE.fermeId, genereLe: GENERE_LE, jour: JOUR, compresseur: compresseurBloqueApresLecture, signal: ctrl.signal }),
      depuis,
    );
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
    if (i.etat === 'rejetee') expect(i.ms).toBeLessThan(REJET_MAX_MS);
  });

  it('exporterFerme : signal déjà annulé → rejet AbortError', async () => {
    const exporterFerme = await exigerExporterFerme();
    const porte: PorteDonnees = { ...porteMuette(), lire: <T,>() => Promise.resolve([] as T[]) };
    const ctrl = new AbortController();
    ctrl.abort();
    const debut = performance.now();
    const i = await issue(exporterFerme(porte, { fermeId: ENTREE.fermeId, genereLe: GENERE_LE, jour: JOUR, signal: ctrl.signal }), () => debut);
    expect(i.etat, messageErreur(i)).toBe('rejetee');
    expect(nomErreur(i)).toBe('AbortError');
  });
});

describe('T15b relecture : la source de chaque entrée est lue en entier', () => {
  /** Compresse le premier bloc reçu, puis s'arrête sans lire le reste de la source. */
  const compresseurPresse: Compresseur = async function* (brut) {
    for await (const b of brut) {
      yield* compresseurNode(
        (async function* () {
          await Promise.resolve();
          yield b;
        })(),
      );
      break;
    }
  };

  /** Ne lit rien et ne rend rien. */
  // eslint-disable-next-line require-yield -- compresseur volontairement vide
  const compresseurVide: Compresseur = async function* () {
    await Promise.resolve();
  };

  const gros = () => '﻿id;note\r\n' + Array.from({ length: 30_000 }, (_, k) => `${String(k)};ligne ${String(k)}\r\n`).join('');

  it('compresseur qui s’arrête après le premier bloc → rejet « source non lue en entier », jamais d’archive tronquée', async () => {
    const debut = performance.now();
    const i = await issue(coeur.creerZip([{ chemin: 'evenement.csv', contenu: gros() }], { compresseur: compresseurPresse }), () => debut);
    expect(i.etat, 'archive rendue alors que la source n’a pas été lue en entier').toBe('rejetee');
    expect(messageErreur(i)).toMatch(/source non lue en entier/);
    expect(messageErreur(i)).toContain('evenement.csv');
  });

  it('compresseur qui ne lit rien → rejet « source non lue en entier » (pas d’entrée vide à sa place)', async () => {
    const debut = performance.now();
    const i = await issue(
      coeur.creerZip(
        [
          { chemin: 'ferme.json', contenu: '{"format":"planifications-export"}' },
          { chemin: 'zone.csv', contenu: '﻿id;nom\r\n' },
        ],
        { compresseur: compresseurVide },
      ),
      () => debut,
    );
    expect(i.etat, 'archive rendue alors que la source n’a pas été lue').toBe('rejetee');
    expect(messageErreur(i)).toMatch(/source non lue en entier/);
  });

  it('construireArchive : compresseur pressé → rejet « source non lue en entier »', async () => {
    // Assez de lignes pour que chaque fichier de la ferme dépasse largement un bloc.
    const evenement = Array.from({ length: 5_000 }, (_, k) => ({
      id: `0192f0c1-7a6e-7cc3-a000-${k.toString(16).padStart(12, '0')}`,
      ferme_id: ENTREE.fermeId,
      note: `note ${String(k)} `.repeat(8),
    }));
    const debut = performance.now();
    const i = await issue(coeur.construireArchive({ ...ENTREE, tables: { evenement } }, { date: JOUR, compresseur: compresseurPresse }), () => debut);
    expect(i.etat).toBe('rejetee');
    expect(messageErreur(i)).toMatch(/source non lue en entier/);
  });
});

describe('T15b relecture : longue chaîne d’un seul tenant, paires de substitution entières', () => {
  // Deux décalages : quelle que soit la coupure interne (≈ 16 000 caractères, ou une autre), l'une
  // des deux chaînes a une paire de substitution à cheval dessus.
  const CHAINES = ['🍓'.repeat(60_000), 'a' + '🍓'.repeat(60_000) + 'é'];

  it('stockée et deflate : relue à l’identique, aucun U+FFFD', async () => {
    for (const compresseur of [undefined, compresseurNode]) {
      const fichiers = CHAINES.map((contenu, k) => ({ chemin: `long-${String(k)}.txt`, contenu }));
      const zip = await coeur.creerZip(fichiers, compresseur === undefined ? {} : { compresseur });
      const entrees = lireZip(zip);
      CHAINES.forEach((attendu, k) => {
        const lu = texteZip(entrees, `long-${String(k)}.txt`);
        expect(lu.includes('�'), `long-${String(k)} ${compresseur === undefined ? 'stockée' : 'deflate'} : paire coupée`).toBe(false);
        expect(lu === attendu, `long-${String(k)} relue à l’identique`).toBe(true);
      });
      expect(verifierAvecUnzip(zip)).toHaveLength(2);
    }
  });
});
