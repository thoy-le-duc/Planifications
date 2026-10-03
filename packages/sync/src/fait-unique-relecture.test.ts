/**
 * Tests T13i, relecture — cas manqués par les premiers tests d'acceptation.
 *
 *   R1  Annulation reçue d'une correction qui a CHANGÉ DE CULTURE, la correction absente ici :
 *       O (série A, réalisé plantation) corrigé par C1 (passé en série B), C1 annulé par N
 *       (série B, origine_id = O, remplace_evenement_id = C1) ; C1 n'est pas dans la base locale.
 *       Règle T13h : la chaîne de O contient une annulation, plus rien n'y est en vigueur → un
 *       nouveau réalisé plantation sur A s'écrit. Variantes : O saisi ici (origine_id nul) ou reçu
 *       du serveur (origine_id = son propre id).
 *   R2  `pasDejaFait` (@planif/sync/fait-unique) : une clé de `detail` est un NOM de clé, jamais du
 *       SQL (apostrophe : pas d'injection, pas d'erreur de syntaxe SQL) ; un `detail` vide lève une
 *       erreur explicite, pas une erreur de syntaxe SQL.
 *   R3  Chaîne corrompue en cycle (A ↔ B par remplace_evenement_id) : la vérification termine.
 */
import type { DateCalendaire, Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DejaFait, pasDejaFait, type FaitVise } from './fait-unique.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees, SaisieEvenement } from './types.ts';

const UTILISATEUR = '0192f0c1-13d1-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13d1-7000-8000-000000000002' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-13d1-7000-8000-000000000010' as Id<'Emplacement'>;
const SERIE_A = '0192f0c1-13d1-7000-8000-000000000020' as Id<'Serie'>;
const SERIE_B = '0192f0c1-13d1-7000-8000-000000000021' as Id<'Serie'>;
const O = '0192f0c1-13d1-7000-8000-0000000000a0';
const C1 = '0192f0c1-13d1-7000-8000-0000000000a1';
const N = '0192f0c1-13d1-7000-8000-0000000000a2';
const AUJOURDHUI = '2026-10-01' as DateCalendaire;

let base: BaseMemoire;
let instant: number;
let porte: PorteDonnees;

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = creerPorte(base, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => new Date((instant += 1_000)) });
});

afterEach(() => {
  base.fermer();
});

const realise = (serieId: Id<'Serie'>): SaisieEvenement => ({
  type: 'realise',
  date: AUJOURDHUI,
  source: 'agent',
  culture: { sorte: 'serie', serieId },
  emplacementIds: [EMPLACEMENT],
  note: null,
  photos: [],
  remplaceEvenement: null,
  detail: { etape: 'plantation', quantiteReelle: null },
});

interface Recue {
  readonly id: string;
  readonly serie: string;
  readonly horodatage: string;
  readonly sorte: 'correction' | 'annulation' | null;
  readonly remplace: string | null;
  readonly origine: string | null;
}

/** Ligne de réalisé « plantation » arrivée par la synchro. */
function recevoir(l: Recue): void {
  const ligne: Readonly<Record<string, string | null>> = {
    id: l.id,
    ferme_id: FERME,
    type: 'realise',
    date: AUJOURDHUI,
    horodatage: l.horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: l.serie,
    campagne_id: null,
    emplacement_ids: JSON.stringify([EMPLACEMENT]),
    note: null,
    photos: '[]',
    remplace_sorte: l.sorte,
    remplace_evenement_id: l.remplace,
    detail: JSON.stringify({ etape: 'plantation', quantiteReelle: null }),
    cree_le: l.horodatage,
    origine_id: l.origine,
  };
  const colonnes = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO evenement (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
    colonnes.map((c) => ligne[c] ?? null),
  );
}

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

describe('T13i, R1 : annulation reçue d’une correction passée dans une autre culture, la correction absente ici', () => {
  it.each([
    ['O saisi sur ce téléphone (origine_id nul)', false],
    ['O reçu du serveur (origine_id = O)', true],
  ])('%s : la chaîne de O est annulée → un nouveau réalisé plantation sur la série A s’écrit', async (_cas, oRecu) => {
    let o: string = O;
    if (oRecu) recevoir({ id: O, serie: SERIE_A, horodatage: '2026-10-01T05:00:00.000Z', sorte: null, remplace: null, origine: O });
    else o = await porte.saisirEvenement(realise(SERIE_A));
    // C1 (correction de O passée en série B) n'est jamais arrivé ici ; seule son annulation N.
    recevoir({ id: N, serie: SERIE_B, horodatage: '2026-10-01T09:00:00.000Z', sorte: 'annulation', remplace: C1, origine: o });
    expect(base.lireDirect('SELECT id FROM evenement WHERE id = ?', [C1]), 'banc : C1 absent en local').toEqual([]);

    await expect(porte.saisirEvenement(realise(SERIE_A)), 'chaîne de O annulée : nouveau réalisé sur A').resolves.toBeTypeOf('string');
  });
});

describe('T13i, R2 : pasDejaFait, les clés du detail ne sont jamais du SQL', () => {
  const lire = <T>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => base.getAll<T>(sql, parametres);
  const fait = (detail: Readonly<Record<string, string>>): FaitVise => ({ fermeId: FERME, colonne: 'serie_id', cibleId: SERIE_A, type: 'realise', detail });
  const texte = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'string' ? e : JSON.stringify(e));
  const SYNTAXE_SQL = /syntax|near "|unrecognized token|incomplete input/i;

  /** Lance la vérification ; rend l'erreur levée (à la construction ou à l'exécution), ou null. */
  async function verifier(detail: Readonly<Record<string, string>>): Promise<unknown> {
    try {
      await pasDejaFait(fait(detail))(lire);
      return null;
    } catch (e) {
      return e;
    }
  }

  it('clé contenant une apostrophe : traitée comme un nom de clé (aucun réalisé n’a cette clé → pas DejaFait), jamais une erreur SQL', async () => {
    await porte.saisirEvenement(realise(SERIE_A));
    const avant = nombreEvenements();
    // Recopiée telle quelle dans le SQL, cette clé ferait : json_extract(e.detail, '$.etape') IS NOT NULL OR json_extract(e.detail, '$.etape') = ?
    // — vrai pour le réalisé du banc : DejaFait à tort.
    const cle = "etape') IS NOT NULL OR json_extract(e.detail, '$.etape";
    const erreur = await verifier({ [cle]: 'jamais' });
    expect(erreur, 'pas de DejaFait : aucun réalisé n’a de clé de ce nom').not.toBeInstanceOf(DejaFait);
    if (erreur !== null) {
      expect(erreur, 'erreur propre, pas une erreur de syntaxe SQL').toBeInstanceOf(Error);
      expect(texte(erreur), 'erreur propre, pas une erreur de syntaxe SQL').not.toMatch(SYNTAXE_SQL);
    }
    expect(nombreEvenements(), 'aucun effet de bord').toBe(avant);
  });

  it('clé avec une apostrophe simple : jamais une erreur de syntaxe SQL', async () => {
    const erreur = await verifier({ "l'étape": 'plantation' });
    if (erreur !== null) expect(texte(erreur), 'erreur propre, pas une erreur de syntaxe SQL').not.toMatch(SYNTAXE_SQL);
  });

  it('detail vide : erreur explicite, pas une erreur de syntaxe SQL', async () => {
    const erreur = await verifier({});
    expect(erreur, 'un detail vide est refusé').toBeInstanceOf(Error);
    expect(erreur, 'pas DejaFait').not.toBeInstanceOf(DejaFait);
    expect(texte(erreur), 'erreur explicite, pas une erreur de syntaxe SQL').not.toMatch(SYNTAXE_SQL);
  });
});

describe('T13i, R3 : chaîne corrompue en cycle', () => {
  it.each([
    ['origine_id nul', false],
    ['origine_id = son propre id', true],
  ])('A ↔ B par remplace_evenement_id (%s) : la vérification termine', async (_cas, origineSoi) => {
    const A = '0192f0c1-13d1-7000-8000-0000000000b0';
    const B = '0192f0c1-13d1-7000-8000-0000000000b1';
    recevoir({ id: A, serie: SERIE_A, horodatage: '2026-10-01T05:00:00.000Z', sorte: 'correction', remplace: B, origine: origineSoi ? A : null });
    recevoir({ id: B, serie: SERIE_A, horodatage: '2026-10-01T05:30:00.000Z', sorte: 'correction', remplace: A, origine: origineSoi ? B : null });
    // Résultat libre (écrit ou DejaFait) : il faut seulement que la vérification rende la main.
    const [issue] = await Promise.allSettled([porte.saisirEvenement(realise(SERIE_A))]);
    if (issue.status === 'rejected') expect(issue.reason, 'seul refus admis : DejaFait').toBeInstanceOf(DejaFait);
  }, 10_000);
});
