/**
 * Tests d'acceptation T57 — la porte pose une vanne sur le plan (`porte.placer`, sorte 'vanne'),
 * côté téléphone, sans réseau, sur un SQLite en mémoire. Mêmes règles que le serveur
 * (apps/api/src/sync/irrigation.integration.test.ts) et que les autres placements (T28s) :
 *
 *   { sorte: 'vanne', id, position: { x, y } | null }
 *
 * - `position` (repère de la ferme, mètres) → secteur_irrigation.placement_x_m, placement_y_m ;
 *   nulle → les deux nulles (la vanne revient en tête de sa première planche).
 * - Gérant actif seulement (« Seul le gérant peut placer les éléments de la ferme. ») ; aucune
 *   position sans origine du plan ; vanne de la ferme de la porte, non supprimée ; position
 *   validée par le cœur (validerPositionVanne : finie, à 5 km au plus de l'origine).
 * - Une transaction, rend l'annulation (position d'avant) ; une vanne placée est un placement :
 *   l'origine du plan ne bouge plus tant qu'elle l'est.
 */
import type { Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';

interface ChangementVanne {
  readonly sorte: 'vanne';
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number } | null;
}
interface ChangementOrigine {
  readonly sorte: 'origine';
  readonly origine: { readonly latitude: number; readonly longitude: number } | null;
}
type Changement = ChangementVanne | ChangementOrigine;
type PorteVannes = PorteDonnees & { placer?: (changements: readonly Changement[]) => Promise<readonly Changement[]> };

const GERANT = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const EQUIPIER = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b11' as Id<'Utilisateur'>;
const FERME = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const VOISINE = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b21';
const V12 = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b30';
const V13_SUPPRIMEE = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b31';
const V_VOISINE = '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5b32';
const INSTANT = new Date('2026-10-19T06:00:00.000Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };
const SEUL_LE_GERANT = 'Seul le gérant peut placer les éléments de la ferme.';

describe('T57 : la porte pose une vanne sur le plan', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let transactions: number;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    transactions = 0;
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    for (const f of [FERME, VOISINE]) {
      r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme', 'Europe/Paris', NULL, ?, '{}')`, [f, JSON.stringify(ORIGINE)]);
    }
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m3', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, VOISINE]);
    const vanne = (id: string, ferme: string, numero: number, supprimee = false) => {
      r(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, debit_litres_heure, adresse_modbus, placement_x_m, placement_y_m, supprime_le) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`, [
        id,
        ferme,
        numero,
        `V${String(numero)}`,
        supprimee ? INSTANT.toISOString() : null,
      ]);
    };
    vanne(V12, FERME, 12);
    vanne(V13_SUPPRIMEE, FERME, 13, true);
    vanne(V_VOISINE, VOISINE, 1);
  });

  afterEach(() => {
    base.fermer();
  });

  function placer(changements: readonly Changement[], utilisateurId: Id<'Utilisateur'> = GERANT): Promise<readonly Changement[]> {
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    const p = sync.creerPorte(compteuse, { utilisateurId, fermeId: FERME, maintenant: () => INSTANT }) as PorteVannes;
    if (p.placer === undefined) throw new Error('porte.placer absente');
    return p.placer(changements);
  }

  const position = (id: string): unknown => base.lireDirect<{ x: number | null; y: number | null }>('SELECT placement_x_m AS x, placement_y_m AS y FROM secteur_irrigation WHERE id = ?', [id])[0];
  const instantane = (): unknown => ({ vannes: base.lireDirect('SELECT * FROM secteur_irrigation ORDER BY id'), fermes: base.lireDirect('SELECT * FROM ferme ORDER BY id') });

  async function rejete(changements: readonly Changement[], attendu: RegExp | string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> {
    const avant = instantane();
    await expect(placer(changements, utilisateurId)).rejects.toThrow(attendu);
    expect(instantane(), 'rien n’est écrit').toEqual(avant);
  }

  it('le gérant pose V12 en (120,5 ; 16), en une transaction ; l’annulation la remet hors du plan', async () => {
    const annulation = await placer([{ sorte: 'vanne', id: V12, position: { x: 120.5, y: 16 } }]);
    expect(transactions).toBe(1);
    expect(position(V12)).toEqual({ x: 120.5, y: 16 });
    expect(annulation).toEqual([{ sorte: 'vanne', id: V12, position: null }]);
    const refaire = await placer(annulation);
    expect(position(V12)).toEqual({ x: null, y: null });
    expect(refaire).toEqual([{ sorte: 'vanne', id: V12, position: { x: 120.5, y: 16 } }]);
  });

  it('l’équipier ne pose pas de vanne', async () => {
    await rejete([{ sorte: 'vanne', id: V12, position: { x: 1, y: 2 } }], SEUL_LE_GERANT, EQUIPIER);
  });

  it('vanne d’une autre ferme, supprimée ou inconnue : rejet', async () => {
    await rejete([{ sorte: 'vanne', id: V_VOISINE, position: { x: 1, y: 2 } }], /vanne/i);
    await rejete([{ sorte: 'vanne', id: V13_SUPPRIMEE, position: { x: 1, y: 2 } }], /vanne/i);
    await rejete([{ sorte: 'vanne', id: '0192f0c1-5757-7cc3-9b1e-3f6a2d4c5bff', position: { x: 1, y: 2 } }], /vanne/i);
  });

  it('position hors de 5 km : rejet avec le message du cœur', async () => {
    await rejete([{ sorte: 'vanne', id: V12, position: { x: 4_000, y: 4_000 } }], /5 ?000 m|5 km/);
  });

  it('sans origine du plan : rejet ; une vanne placée fige l’origine', async () => {
    base.recevoir('UPDATE ferme SET origine_plan = NULL WHERE id = ?', [FERME]);
    await rejete([{ sorte: 'vanne', id: V12, position: { x: 1, y: 2 } }], /point de départ/);
    base.recevoir('UPDATE ferme SET origine_plan = ? WHERE id = ?', [JSON.stringify(ORIGINE), FERME]);
    await placer([{ sorte: 'vanne', id: V12, position: { x: 1, y: 2 } }]);
    await rejete([{ sorte: 'origine', origine: { latitude: 45, longitude: 2 } }], /.+/);
  });
});
