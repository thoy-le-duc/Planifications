/**
 * T89 : règles de `zone_creation` / `emplacement_creation` ajoutées par le développeur, en plus des tests d'acceptation
 * (placement-creation.test.ts) : ce que le serveur refuserait aussi (structure.ts), et les valeurs écrites par défaut.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement } from './index.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5${n.toString(16).padStart(3, '0')}`;
const GERANT = uuid(0x10) as Id<'Utilisateur'>;
const FERME = uuid(0x20) as Id<'Ferme'>;
const ZONE = uuid(0x41);
const SOUS_ZONE = uuid(0x42);
const PLANCHE = uuid(0x43);
const SAISON = uuid(0x44);
// 23 h 30 UTC le 30 : déjà le 31 à Paris.
const INSTANT = new Date('2026-10-30T23:30:00.000Z');

const zone = (id: string, valeurs: Record<string, unknown>): ChangementPlacement => ({ sorte: 'zone_creation', id, valeurs });
const planche = (id: string, valeurs: Record<string, unknown>): ChangementPlacement => ({ sorte: 'emplacement_creation', id, valeurs });

describe('T89 : règles de création de la porte placer', () => {
  let base: BaseMemoire;
  beforeEach(() => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    base.recevoir(
      `INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Jardins', 'Europe/Paris', NULL, '{"latitude":44,"longitude":1.5}', '{"longueur":"m","masse":"kg"}')`,
      [FERME],
    );
    base.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
  });
  afterEach(() => {
    base.fermer();
  });
  const placer = (c: readonly ChangementPlacement[]): Promise<readonly ChangementPlacement[]> =>
    creerPorte(base, { utilisateurId: GERANT, fermeId: FERME, maintenant: () => INSTANT }).placer(c);
  const lire = (sql: string, p: readonly unknown[] = []): Record<string, unknown>[] => base.lireDirect<Record<string, unknown>>(sql, p);

  it('type d’abri absent : plein_champ ; inconnu : rejet', async () => {
    await placer([zone(ZONE, { nom: 'Serre' })]);
    expect(lire('SELECT type_abri FROM zone WHERE id = ?', [ZONE])[0]?.type_abri).toBe('plein_champ');
    await expect(placer([zone(SOUS_ZONE, { nom: 'S', type_abri: 'grotte' })])).rejects.toThrow('Type d’abri inconnu.');
  });

  it('en service depuis le jour de la ferme (fuseau de la ferme, pas UTC)', async () => {
    await placer([zone(ZONE, { nom: 'Serre' }), planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, placement: null })]);
    expect(lire('SELECT actif_du FROM emplacement WHERE id = ?', [PLANCHE])[0]?.actif_du).toBe('2026-10-31');
  });

  it('une gouttière ne se crée pas ici (elle a des pains)', async () => {
    await placer([zone(ZONE, { nom: 'Serre' })]);
    await expect(placer([planche(PLANCHE, { zone_id: ZONE, code: 'G1', sorte: 'gouttiere', longueur_m: 30, placement: null })])).rejects.toThrow(/planche ou un rang/);
  });

  it('une zone ne se range pas dans elle-même', async () => {
    await expect(placer([zone(ZONE, { nom: 'Serre', zone_parente_id: ZONE })])).rejects.toThrow(/elle-même/);
  });

  it('retirer une zone qui a encore une planche : rejet (le serveur refuserait)', async () => {
    await placer([zone(ZONE, { nom: 'Serre' }), planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, placement: null })]);
    await expect(placer([zone(ZONE, { supprime_le: INSTANT.toISOString() })])).rejects.toThrow(/contient encore/);
  });

  it('retirer une planche prévue dans le plan d’une saison en cours : rejet', async () => {
    await placer([zone(ZONE, { nom: 'Serre' }), planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, placement: null })]);
    base.recevoir(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES (?, ?, '2026', '2026-01-01', '2026-12-31')`, [SAISON, FERME]);
    base.recevoir(`INSERT INTO assolement (id, ferme_id, saison_id, emplacement_id, nature) VALUES (?, ?, ?, ?, 'culture')`, [uuid(0x45), FERME, SAISON, PLANCHE]);
    await expect(placer([planche(PLANCHE, { supprime_le: INSTANT.toISOString() })])).rejects.toThrow(/plan d’une saison/);
  });

  it('annuler deux fois : l’annulation d’une annulation rétablit la zone et la planche', async () => {
    const annulation = await placer([zone(ZONE, { nom: 'Serre' }), planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, placement: null })]);
    const retablir = await placer(annulation);
    expect(lire('SELECT supprime_le FROM emplacement WHERE id = ?', [PLANCHE])[0]?.supprime_le).not.toBeNull();
    await placer(retablir);
    expect(lire('SELECT supprime_le FROM zone WHERE id = ?', [ZONE])[0]?.supprime_le).toBeNull();
    expect(lire('SELECT supprime_le FROM emplacement WHERE id = ?', [PLANCHE])[0]?.supprime_le).toBeNull();
  });

  it('modifier le placement d’une planche créée : l’annulation rend l’ancien placement', async () => {
    await placer([zone(ZONE, { nom: 'Serre' }), planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, placement: null })]);
    const annulation = await placer([planche(PLANCHE, { placement: { x: 1, y: 2, orientation_deg: 90 } })]);
    expect(lire('SELECT placement_x_m AS x, orientation_deg AS o FROM emplacement WHERE id = ?', [PLANCHE])[0]).toEqual({ x: 1, o: 90 });
    expect(annulation).toEqual([{ sorte: 'emplacement_creation', id: PLANCHE, valeurs: { placement: null } }]);
  });
});
