/**
 * Tests d'acceptation T15c, règle 1 (docs/backlog/T15c-export-rapide.md) — archive construite
 * table par table, au fil de la lecture, identique au bit près à celle de `construireArchive`.
 * Contrat : ./test/contrat-incremental.ts. Les mêmes règles sur la ferme de T07 (lue dans une
 * vraie base) et l'annulation sont dans packages/sync/src/export-rapide.test.ts (Node).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Compresseur, EntreeExport, LigneLocale, ValeurLocale } from './test/contrat.ts';
import { exigerConstructeur, remplir, type ModuleExportIncremental } from './test/contrat-incremental.ts';

let m: ModuleExportIncremental;

beforeAll(async () => {
  m = await exigerConstructeur();
});

const FERME = '0192f0c1-7a6e-7cc3-a000-000000000000';
const AUTRE = '0192f0c1-7a6e-7cc3-b000-000000000000';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
const DATE = '2026-09-29';
const uuid = (code: string, n: number) => `0192f0c1-7a6e-7cc3-${code}-${n.toString(16).padStart(12, '0')}`;

const TEXTES = ['Planche nord; côté "est"', 'ligne 1\nligne 2', '=SOMME(A1)', 'Fraise 🍓 « Gariguette »', '', 'simple'] as const;

function valeur(type: string, n: number): ValeurLocale {
  switch (type) {
    case 'texte':
      return TEXTES[n % TEXTES.length] ?? '';
    case 'entier':
      return n * 3 - 7;
    case 'reel':
      return n + 0.25;
    case 'booleen':
      return n % 2;
    case 'date':
      return `2026-${String(1 + (n % 12)).padStart(2, '0')}-15`;
    case 'instant':
      return `2026-09-29T06:${String(n % 60).padStart(2, '0')}:00.000Z`;
    default:
      return '{"quantite":12.5,"unite":"kg"}';
  }
}

/** `n` lignes par table pour la ferme, une de la ferme voisine et une de la bibliothèque en plus. */
function jeu(volume: (table: string) => number): EntreeExport {
  const tables: Record<string, LigneLocale[]> = {};
  let compteur = 0;
  for (const [nom, d] of Object.entries(m.TABLES_EXPORTEES)) {
    const lignes: LigneLocale[] = [];
    const fabriquer = (fermeId: string | null, imposees: Record<string, ValeurLocale> = {}) => {
      const l: Record<string, ValeurLocale> = {};
      for (const [col, desc] of Object.entries(d.colonnes)) {
        if (col in imposees) l[col] = imposees[col] ?? null;
        else if (col === 'ferme_id') l[col] = fermeId;
        else if (col === 'id' || col.endsWith('_id')) l[col] = uuid('c000', ++compteur);
        else l[col] = valeur(desc.type, compteur);
      }
      return l;
    };
    const membre = (n: number) => (nom === 'membre' ? { utilisateur_id: uuid('a111', n) } : {});
    for (let k = 0; k < volume(nom); k++) {
      lignes.push(fabriquer(FERME, nom === 'ferme' ? { id: FERME } : nom === 'utilisateur' ? { id: uuid('a111', k + 1) } : membre(k + 1)));
    }
    if (nom === 'ferme') lignes.push(fabriquer(AUTRE, { id: AUTRE }));
    else if (nom !== 'utilisateur') lignes.push(fabriquer(AUTRE));
    if (d.bibliotheque) lignes.push(fabriquer(null), fabriquer(null));
    tables[nom] = lignes;
  }
  return { fermeId: FERME, genereLe: GENERE_LE, tables };
}

/** Deflate factice mais déterministe : chaque entrée est « compressée » en elle-même, octet pour octet. */
const compresseurIdentite: Compresseur = async function* (brut) {
  for await (const morceau of brut) yield morceau;
};

const memes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

describe('T15c : creerConstructeurArchive, archive identique au bit près à construireArchive', () => {
  const volumes: readonly [string, (t: string) => number][] = [
    ['jeu varié', (t) => (t === 'ferme' ? 1 : t === 'proposition' ? 0 : (t.length % 5) + 1)],
    ['toutes les tables vides sauf la ferme', (t) => (t === 'ferme' ? 1 : 0)],
    ['2 000 événements', (t) => (t === 'ferme' ? 1 : t === 'evenement' ? 2_000 : 0)],
    ['2 001 événements', (t) => (t === 'ferme' ? 1 : t === 'evenement' ? 2_001 : 0)],
    ['4 001 événements, 2 000 modifications', (t) => (t === 'ferme' ? 1 : t === 'evenement' ? 4_001 : t === 'modification' ? 2_000 : 1)],
  ];

  for (const [nom, volume] of volumes) {
    for (const [mode, compresseur] of [
      ['stockée', undefined],
      ['compressée', compresseurIdentite],
    ] as const) {
      it(`${nom}, archive ${mode} : mêmes octets, mêmes lignes`, async () => {
        const entree = jeu(volume);
        const options = { date: DATE, ...(compresseur === undefined ? {} : { compresseur }) };
        const reference = await m.construireArchive(entree, options);
        const c = m.creerConstructeurArchive({ fermeId: FERME, genereLe: GENERE_LE, ...options });
        await remplir(m, c, entree);
        const archive = await c.terminer();
        expect(archive.lignes).toEqual(reference.lignes);
        expect(memes(archive.octets, reference.octets), 'octets de l’archive').toBe(true);
      }, 60_000);
    }
  }

  it('2 000 puis 2 001 lignes : le compte de lignes de evenement.csv suit la table, ni perte ni doublon', async () => {
    for (const n of [1_999, 2_000, 2_001]) {
      const entree = jeu((t) => (t === 'ferme' ? 1 : t === 'evenement' ? n : 0));
      const c = m.creerConstructeurArchive({ fermeId: FERME, genereLe: GENERE_LE, date: DATE });
      await remplir(m, c, entree);
      expect((await c.terminer()).lignes.evenement, `${String(n)} lignes`).toBe(n);
    }
  }, 60_000);

  it('au fil de la lecture : chaque table ajoutée est déjà envoyée au compresseur, sans attendre terminer()', async () => {
    const entree = jeu((t) => (t === 'ferme' ? 1 : 3));
    const noms = Object.keys(m.TABLES_EXPORTEES);
    let appels = 0;
    const espion: Compresseur = (brut) => {
      appels++;
      return compresseurIdentite(brut);
    };
    const c = m.creerConstructeurArchive({ fermeId: FERME, genereLe: GENERE_LE, date: DATE, compresseur: espion });
    const AJOUTEES = 12;
    for (const nom of noms.slice(0, AJOUTEES)) await c.ajouterTable(nom, entree.tables[nom] ?? []);
    // Laisse aux micro-tâches le temps de lancer le travail en attente (aucune minuterie dans le cœur).
    for (let i = 0; i < 500; i++) await Promise.resolve();
    expect(appels, `entrées déjà compressées après ${String(AJOUTEES)} tables sur ${String(noms.length)}, avant terminer()`).toBeGreaterThanOrEqual(AJOUTEES);
    for (const nom of noms.slice(AJOUTEES)) await c.ajouterTable(nom, entree.tables[nom] ?? []);
    await c.terminer();
  }, 60_000);

  it('avancement : entiers, jamais en recul, total constant, dernier appel à 100 %', async () => {
    const entree = jeu((t) => (t === 'ferme' ? 1 : 5));
    const appels: { fait: number; total: number }[] = [];
    const c = m.creerConstructeurArchive({ fermeId: FERME, genereLe: GENERE_LE, date: DATE, avancement: (a) => void appels.push({ fait: a.fait, total: a.total }) });
    await remplir(m, c, entree);
    await c.terminer();
    expect(appels.length).toBeGreaterThan(1);
    let avant = 0;
    for (const a of appels) {
      expect(Number.isInteger(a.fait) && Number.isInteger(a.total)).toBe(true);
      expect(a.total).toBe(appels[0]?.total);
      expect(a.fait).toBeGreaterThanOrEqual(avant);
      expect(a.fait).toBeLessThanOrEqual(a.total);
      avant = a.fait;
    }
    expect(appels.at(-1)?.fait).toBe(appels.at(-1)?.total);
  }, 60_000);
});
