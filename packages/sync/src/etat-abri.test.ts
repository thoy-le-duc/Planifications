/**
 * Tests d'acceptation T58 — état des serres sur le téléphone (docs/backlog/T58-etat-serres.md,
 * règles 1 et 2) : la liste d'équipements d'une zone descend par le flux `zone` existant, les
 * changements d'état sont des événements `etat_abri` du journal, écrits HORS LIGNE par la porte
 * (SQLite en mémoire, aucun réseau) et rejoués par les mêmes règles du cœur que le serveur.
 *
 * Pas de nouvelle table : le garde-fou « publication ↔ flux » (T67) n'a rien à changer, et les
 * flux `zone` et `evenement` gardent leur découpage par ferme (isolement entre fermes).
 */
import { readFileSync } from 'node:fs';
import { validerSaisie, type Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL, TABLES_LOCALES } from './schema.ts';
import type { BaseLocale, PorteDonnees, SaisieEvenement } from './types.ts';

const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
const requetes = (): string[] => [...regles.matchAll(/query:[ \t]*(?:>-?[ \t]*\n((?:[ \t]{6,}[^\n]*\n?)+)|(SELECT[^\n]*))/g)].map((r) => (r[1] ?? r[2] ?? '').replace(/\s+/g, ' ').trim());

const UTILISATEUR = '0192f0c1-5858-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const FERME = '0192f0c1-5858-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const SERRE = '0192f0c1-5858-7cc3-9b1e-3f6a2d4c5b30';
const INSTANT = new Date('2026-10-22T07:00:00.000Z');

describe('T58 : schéma local et règles de synchro', () => {
  it('zone gagne equipements_abri (texte JSON, facultatif) sans perdre ses colonnes', () => {
    const zone = (TABLES_LOCALES as unknown as Record<string, Record<string, string>>).zone;
    expect(zone).toEqual({ ferme_id: 'texte', nom: 'texte', zone_parente_id: 'texte', type_abri: 'texte', surface_m2: 'reel', contour: 'texte', equipements_abri: 'texte', cree_le: 'texte', modifie_le: 'texte', supprime_le: 'texte' });
    expect(SCHEMA_LOCAL.tables.some((t) => t.name === 'zone')).toBe(true);
  });

  it('flux zone et evenement : une requête chacun, filtrée par ferme, sans exception (isolement)', () => {
    for (const table of ['zone', 'evenement']) {
      expect(requetes().filter((q) => new RegExp(`\\bFROM ${table}\\b`).test(q)), table).toEqual([`SELECT * FROM ${table} WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)`]);
    }
  });
});

describe('T58 : changement d’état écrit hors ligne par la porte', () => {
  let base: BaseMemoire;
  let transactions: number;
  let porte: PorteDonnees;

  beforeEach(() => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    transactions = 0;
    base.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme', 'Europe/Paris', NULL, NULL, '{}')`, [FERME]);
    base.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'equipier', 'accepte', NULL)`, [UTILISATEUR, FERME]);
    base.recevoir(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, equipements_abri, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Serre 1', NULL, 'serre', 300, NULL, ?, ?, ?, NULL)`, [
      SERRE,
      FERME,
      JSON.stringify(['ouvrants_lateraux', 'portes']),
      INSTANT.toISOString(),
      INSTANT.toISOString(),
    ]);
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => INSTANT });
  });

  afterEach(() => {
    base.fermer();
  });

  const saisie = (detail: Record<string, unknown>, remplace: unknown = null): SaisieEvenement =>
    ({ type: 'etat_abri', date: '2026-10-22', source: 'tap', culture: null, emplacementIds: [], note: null, photos: [], remplaceEvenement: remplace, detail }) as unknown as SaisieEvenement;

  type Ligne = Record<string, string | null>;
  const journal = (): Ligne[] => base.lireDirect<Ligne>(`SELECT * FROM evenement WHERE type = 'etat_abri' ORDER BY horodatage, id`);

  it('« ouvrants latéraux ouverts » : un événement etat_abri, une transaction, valide pour le cœur', async () => {
    const e = porte.preparerSaisie(saisie({ zoneId: SERRE, equipement: 'ouvrants_lateraux', actif: true }));
    expect(validerSaisie(e.ligne).ok).toBe(true);
    await porte.ecrireEnsemble([e.ordre]);
    expect(transactions).toBe(1);
    const [l, ...autres] = journal();
    expect(autres).toEqual([]);
    expect(l).toMatchObject({ ferme_id: FERME, type: 'etat_abri', date: '2026-10-22', source: 'tap', auteur_id: UTILISATEUR, serie_id: null, campagne_id: null, remplace_sorte: null });
    expect(JSON.parse(String(l?.emplacement_ids))).toEqual([]);
    expect(JSON.parse(String(l?.detail))).toEqual({ zoneId: SERRE, equipement: 'ouvrants_lateraux', actif: true });
  });

  it('saisirEvenement l’écrit aussi ; l’annulation désigne l’original et porte le même détail', async () => {
    const detail = { zoneId: SERRE, equipement: 'portes', actif: true };
    const id = await porte.saisirEvenement(saisie(detail));
    await porte.saisirEvenement(saisie(detail, { sorte: 'annulation', evenementId: id }));
    const l = journal();
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: id });
    expect(JSON.parse(String(l[1]?.detail))).toEqual(detail);
  });

  it('détail invalide (équipement inconnu, état « ouvert ») : refusé par les règles du cœur, rien d’écrit', async () => {
    for (const mauvais of [{ zoneId: SERRE, equipement: 'arrosage', actif: true }, { zoneId: SERRE, equipement: 'portes', actif: 'ouvert' }, { equipement: 'portes', actif: true }]) {
      await expect(porte.saisirEvenement(saisie(mauvais))).rejects.toThrow();
    }
    expect(journal()).toEqual([]);
  });
});
