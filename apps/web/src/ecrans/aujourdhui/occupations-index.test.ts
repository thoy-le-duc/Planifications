/**
 * T13u — les occupations d'une culture se cherchent dans l'index, pas dans toute la ferme.
 *
 * Profil du premier « Fait » à froid (docs/mesures/T13u-apres.md) : dans la lecture ciblée, la
 * requête des occupations (`SQL_OCCUPATIONS`, un `OR` entre la liste des séries et celle des
 * plantations) parcourait toutes les occupations de la ferme dans l'index ferme_culture
 * (≈ 4 000 sur la grande ferme : 110 à 150 ms à froid pour une seule série). Deux branches en
 * `UNION ALL` : chacune cherche ses cultures dans l'index (ferme, série, plantation).
 *
 * Banc : la base locale telle que PowerSync la range (./test/base-powersync.ts), remplie de la
 * grande ferme (./test/grande-ferme.ts) ; plan relevé par EXPLAIN QUERY PLAN.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { calculerJournee, lireJournee, lireTacheCiblee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const INTERNE = 'ps_data__occupation';

let base: BasePowerSync;
let porte: PorteDonnees;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireGrandeFerme(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>, fermeId: FERME_GRANDE as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

interface RequeteLue {
  readonly sql: string;
  readonly parametres: readonly unknown[];
}

/** Porte espion : les requêtes envoyées, dans l'ordre. */
function espion(vues: RequeteLue[]): PorteDonnees {
  return {
    ...porte,
    lire: <T>(sql: string, parametres?: readonly unknown[]) => {
      vues.push({ sql, parametres: parametres ?? [] });
      return porte.lire<T>(sql, parametres);
    },
  };
}

/**
 * Accès aux occupations qui parcourent celles de toute la ferme : SCAN, ou SEARCH contraint par
 * la seule ferme (première colonne de l'index).
 */
function parcoursDesOccupations(plan: readonly string[]): string[] {
  return plan.filter((chemin) => {
    const ligne = chemin.split(' › ').at(-1) ?? '';
    if (!ligne.includes(INTERNE)) return false;
    if (new RegExp(`^SCAN ${INTERNE}\\b`).test(ligne)) return true;
    const m = new RegExp(`^SEARCH ${INTERNE} USING (?:COVERING )?INDEX \\S+ \\((.*)\\)`).exec(ligne);
    return m !== null && (m[1] ?? '').split(' AND ').length === 1;
  });
}

function fautes(requetes: readonly RequeteLue[]): string[] {
  return requetes
    .filter((r) => /\bFROM occupation\b/.test(r.sql))
    .flatMap((r) => parcoursDesOccupations(base.plan(r.sql, r.parametres)).map((l) => `${r.sql.replace(/\s+/g, ' ').slice(0, 80)}… : ${l}`));
}

describe('T13u : occupations cherchées par l’index de la culture', () => {
  it('lecture ciblée (premier « Fait ») : aucun parcours des occupations de toute la ferme', async () => {
    const journee = calculerJournee(await lireJournee(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    const tache = journee.taches[0];
    if (tache === undefined) throw new Error('aucune tâche');
    const vues: RequeteLue[] = [];
    const ciblee = await lireTacheCiblee(espion(vues), FERME_GRANDE, AUJOURDHUI, tache.cle);
    expect(ciblee, 'la tâche de la journée, exactement').toEqual(tache);
    expect(vues.filter((r) => /\bFROM occupation\b/.test(r.sql)).length, 'requêtes qui lisent les occupations').toBeGreaterThan(0);
    const f = fautes(vues);
    expect(f, `parcours de toutes les occupations :\n${f.join('\n')}`).toEqual([]);
  });

  it('journée relue : aucun parcours des occupations de toute la ferme non plus', async () => {
    const vues: RequeteLue[] = [];
    await lireJournee(espion(vues), FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const f = fautes(vues);
    expect(f, `parcours de toutes les occupations :\n${f.join('\n')}`).toEqual([]);
  });
});
