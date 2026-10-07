/**
 * Tests d'acceptation T15c (docs/backlog/T15c-export-rapide.md), côté lecture de la base :
 *   1. archive identique au bit près à celle de l'API d'avant (ferme de T07), et à celle du
 *      constructeur incrémental de @planif/core (contrat : packages/core/src/export/test/contrat-incremental.ts) ;
 *   2. lecture et construction en parallèle : l'archive est déjà en construction (le compresseur
 *      reçoit des octets) alors que la base n'a pas fini d'être lue ;
 *   5. annulation entre deux pages : plus aucune lecture, plus aucun appel au compresseur, rejet
 *      rapide ; table de 2 000 puis 2 001 lignes (bords de la page de lecture).
 * L'écran (worker, repli, contre-pression, focus) : apps/web/src/ecrans/export/ et e2e/export.e2e.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Id } from '@planif/core';
import type { EntreeExport, LigneLocale } from '../../core/src/export/test/contrat.ts';
import { lireCsv } from '../../core/src/export/test/csv.ts';
import { chargerExport } from '../../core/src/export/test/contrat.ts';
import { exigerConstructeur, remplir, type ModuleExportIncremental } from '../../core/src/export/test/contrat-incremental.ts';
import { exporterFerme } from './export.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees } from './types.ts';
import { remplirJeuT07, type JeuT07 } from './test/jeu-t07.ts';
import { compresseurNode, lireZip, texteZip } from './test/zip.ts';

const JOUR = '2026-09-29';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
const pause = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });
const memes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(a, b) === 0;

/** Porte qui compte les lectures (et laisse une fonction regarder chacune avant qu'elle parte). */
function espionner(porte: PorteDonnees, avant?: (sql: string, n: number) => void): { porte: PorteDonnees; lectures: string[] } {
  const lectures: string[] = [];
  return {
    lectures,
    porte: {
      ...porte,
      lire: <T>(sql: string, parametres?: readonly unknown[]) => {
        lectures.push(sql);
        avant?.(sql, lectures.length);
        return porte.lire<T>(sql, parametres);
      },
    },
  };
}

describe('T15c : ferme de T07, archive identique et construite pendant la lecture', () => {
  let base: BaseMemoire | undefined;
  let jeu: JeuT07;
  let porte: PorteDonnees;
  let coeur: ModuleExportIncremental;
  let entree: EntreeExport;

  beforeAll(async () => {
    coeur = (await chargerExport()) as ModuleExportIncremental;
    const b = creerBaseMemoire(SCHEMA_LOCAL);
    base = b;
    jeu = await remplirJeuT07(b);
    porte = creerPorte(b, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const tables: Record<string, LigneLocale[]> = {};
    for (const t of Object.keys(coeur.TABLES_EXPORTEES)) tables[t] = b.lireDirect<LigneLocale>(`SELECT * FROM "${t}" ORDER BY id`, []);
    entree = { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, tables };
  }, 60_000);

  afterAll(() => {
    base?.fermer();
  });

  it('1. mêmes octets que l’API d’avant (construireArchive sur toute la base) et que le constructeur incrémental', async () => {
    const options = { date: JOUR, compresseur: compresseurNode };
    const reference = await coeur.construireArchive(entree, options);
    const archive = await exporterFerme(porte, { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, jour: JOUR, compresseur: compresseurNode });
    expect(archive.lignes).toEqual(reference.lignes);
    expect(memes(archive.octets, reference.octets), 'exporterFerme contre construireArchive').toBe(true);

    coeur = await exigerConstructeur();
    const c = coeur.creerConstructeurArchive({ fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, ...options });
    await remplir(coeur, c, entree);
    const incremental = await c.terminer();
    expect(incremental.lignes).toEqual(reference.lignes);
    expect(memes(incremental.octets, reference.octets), 'constructeur incrémental contre construireArchive').toBe(true);
  }, 120_000);

  it('2. lecture et construction en parallèle : le compresseur reçoit des octets avant la fin de la lecture', async () => {
    let premierAppel: number | undefined;
    const { porte: espion, lectures } = espionner(porte);
    await exporterFerme(espion, {
      fermeId: jeu.principale.fermeId,
      genereLe: GENERE_LE,
      jour: JOUR,
      compresseur: (brut) => {
        premierAppel ??= lectures.length;
        return compresseurNode(brut);
      },
    });
    expect(premierAppel, 'le compresseur a été appelé').toBeDefined();
    // 30 000 événements = 15 pages à eux seuls : la première table lue est compressée bien avant la dernière lecture.
    expect(lectures.length).toBeGreaterThan(30);
    expect((premierAppel ?? Number.POSITIVE_INFINITY) * 2, `lectures faites au premier appel : ${String(premierAppel)} sur ${String(lectures.length)}`).toBeLessThan(lectures.length);
  }, 120_000);
});

describe('T15c : bords de page de la lecture (2 000 lignes) et annulation entre deux pages', () => {
  const FERME = '0192f0c1-7a6e-7cc3-a000-00000000f001';
  const UTILISATEUR = '0192f0c1-7a6e-7cc3-a111-000000000001';
  let base: BaseMemoire | undefined;

  afterAll(() => {
    base?.fermer();
  });

  const idFamille = (n: number) => `0192f0c1-7a6e-7cc3-f000-${n.toString(16).padStart(12, '0')}`;

  /** Base neuve : une ferme, et `n` familles de cette ferme (table lue page par page). */
  async function baseAvecFamilles(n: number): Promise<PorteDonnees> {
    base?.fermer();
    const b = creerBaseMemoire(SCHEMA_LOCAL);
    base = b;
    await b.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?)', [FERME, 'Ferme des pages', 'Europe/Paris', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
      for (let i = 1; i <= n; i++) {
        await tx.execute('INSERT INTO famille (id, ferme_id, nom, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?)', [idFamille(i), FERME, `Famille ${String(i)}`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
      }
    });
    return creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  }

  for (const n of [1_999, 2_000, 2_001, 4_000, 4_001]) {
    it(`5. table de ${String(n)} lignes : toutes dans le CSV, le JSON et le compte, dans l'ordre, sans doublon`, async () => {
      const porte = await baseAvecFamilles(n);
      const archive = await exporterFerme(porte, { fermeId: FERME, genereLe: GENERE_LE, jour: JOUR, compresseur: compresseurNode });
      expect(archive.lignes.famille).toBe(n);
      const entrees = lireZip(archive.octets);
      const csv = lireCsv(texteZip(entrees, 'famille.csv'));
      expect(csv.lignes).toHaveLength(n);
      const colonneId = csv.entete.indexOf('id');
      expect(csv.lignes.map((l) => l[colonneId])).toEqual(Array.from({ length: n }, (_, i) => idFamille(i + 1)));
      const json = JSON.parse(texteZip(entrees, 'ferme.json')) as { tables: Record<string, unknown[]> };
      expect(json.tables.famille).toHaveLength(n);
    }, 60_000);
  }

  it('5. annulée entre deux pages : rejet rapide (AbortError), plus aucune lecture ni octet compressé ensuite', async () => {
    const controleur = new AbortController();
    const porte = await baseAvecFamilles(4_001);
    let nCompresseur = 0;
    let pagesFamille = 0;
    let lecturesApresAnnulation = 0;
    let annuleA = 0;
    const { porte: espion, lectures } = espionner(porte, (sql) => {
      if (controleur.signal.aborted) lecturesApresAnnulation++;
      else if (sql.includes('FROM "famille"') && ++pagesFamille === 2) {
        // La première page de famille est lue ; on annule pendant la lecture de la deuxième.
        annuleA = performance.now();
        controleur.abort();
      }
    });
    const compresseur: typeof compresseurNode = (brut) => {
      nCompresseur++;
      return compresseurNode(brut);
    };
    const issue = await exporterFerme(espion, { fermeId: FERME, genereLe: GENERE_LE, jour: JOUR, compresseur, signal: controleur.signal }).then(
      () => ({ rejet: false as const, ms: 0, nom: '' }),
      (e: unknown) => ({ rejet: true as const, ms: performance.now() - annuleA, nom: e instanceof Error ? e.name : String(e) }),
    );
    expect(issue.rejet, 'promesse rejetée').toBe(true);
    expect(issue.nom).toBe('AbortError');
    expect(issue.ms, 'délai entre l’annulation et le rejet').toBeLessThan(200);
    const lecturesAuRejet = lectures.length;
    const compresseurAuRejet = nCompresseur;
    await pause(300);
    expect(lecturesApresAnnulation, 'lectures lancées après l’annulation').toBe(0);
    expect(lectures.length, 'lectures après le rejet').toBe(lecturesAuRejet);
    expect(nCompresseur, 'entrées envoyées au compresseur après le rejet').toBe(compresseurAuRejet);
    // Annulé en pleine lecture de la famille : les tables suivantes (variete, zone…) ne sont jamais lues.
    expect(lectures.some((s) => s.includes('FROM "zone"')), 'table suivante lue malgré l’annulation').toBe(false);
  }, 60_000);
});
