/**
 * T89, relecture critique (point 2) : sur une ligne déjà enregistrée, `zone_creation` et `emplacement_creation` ne servent qu'à
 * l'annulation et au rétablissement (supprime_le), et au placement d'une planche. Renommer, déplacer de zone, changer le code ou
 * les mesures : refusé, la ligne ne bouge pas. Annuler puis rétablir une création marche toujours.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement } from './index.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5${n.toString(16).padStart(3, '0')}`;
const GERANT = uuid(0x10) as Id<'Utilisateur'>;
const FERME = uuid(0x20) as Id<'Ferme'>;
const ZONE = uuid(0x41);
const AUTRE_ZONE = uuid(0x42);
const PLANCHE = uuid(0x43);
const INSTANT = new Date('2026-10-30T06:00:00.000Z');

const zone = (id: string, valeurs: Record<string, unknown>): ChangementPlacement => ({ sorte: 'zone_creation', id, valeurs });
const planche = (id: string, valeurs: Record<string, unknown>): ChangementPlacement => ({ sorte: 'emplacement_creation', id, valeurs });

describe('T89 : une ligne déjà enregistrée ne se modifie pas par les sortes de création', () => {
  let base: BaseMemoire;
  beforeEach(async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    base.recevoir(
      `INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Jardins', 'Europe/Paris', NULL, '{"latitude":44,"longitude":1.5}', '{"longueur":"m","masse":"kg"}')`,
      [FERME],
    );
    base.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    await placer([
      zone(ZONE, { nom: 'Serre', type_abri: 'tunnel' }),
      zone(AUTRE_ZONE, { nom: 'Autre', type_abri: 'tunnel' }),
      planche(PLANCHE, { zone_id: ZONE, code: 'P1', longueur_m: 30, largeur_m: 0.75, placement: null }),
    ]);
  });
  afterEach(() => {
    base.fermer();
  });
  function placer(c: readonly ChangementPlacement[]): Promise<readonly ChangementPlacement[]> {
    return creerPorte(base, { utilisateurId: GERANT, fermeId: FERME, maintenant: () => INSTANT }).placer(c);
  }
  const ligne = (table: string, id: string): Record<string, unknown> | undefined => base.lireDirect<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];

  it.each<[string, Record<string, unknown>]>([
    ['renommer', { nom: 'Renommée' }],
    ['changer de parente', { zone_parente_id: AUTRE_ZONE }],
    ['changer de type d’abri', { type_abri: 'serre' }],
    ['changer de surface', { surface_m2: 12 }],
  ])('zone : %s est refusé, la zone ne bouge pas', async (_cas, valeurs) => {
    await expect(placer([zone(ZONE, valeurs)])).rejects.toThrow(/déjà enregistrée/);
    expect(ligne('zone', ZONE)).toMatchObject({ nom: 'Serre', zone_parente_id: null, type_abri: 'tunnel', surface_m2: null });
  });

  it.each<[string, Record<string, unknown>]>([
    ['changer de zone', { zone_id: AUTRE_ZONE }],
    ['changer de code', { code: 'P9' }],
    ['changer de longueur', { longueur_m: 12 }],
    ['changer de largeur', { largeur_m: 1 }],
    ['changer de sorte', { sorte: 'rang' }],
  ])('planche : %s est refusé, la planche ne bouge pas', async (_cas, valeurs) => {
    await expect(placer([planche(PLANCHE, valeurs)])).rejects.toThrow(/déjà enregistrée/);
    expect(ligne('emplacement', PLANCHE)).toMatchObject({ zone_id: ZONE, code: 'P1', longueur_m: 30, largeur_m: 0.75, sorte: 'planche' });
  });

  it('les mêmes valeurs que la ligne, avec la suppression, passent (renvoi de la création)', async () => {
    await placer([zone(ZONE, { nom: 'Serre', type_abri: 'tunnel' })]);
    expect(ligne('zone', ZONE)?.nom).toBe('Serre');
  });

  it('placer une planche déjà enregistrée reste permis', async () => {
    await placer([planche(PLANCHE, { placement: { x: 1, y: 2, orientation_deg: 0 } })]);
    expect(ligne('emplacement', PLANCHE)).toMatchObject({ placement_x_m: 1, placement_y_m: 2 });
  });

  it('annuler puis rétablir la création marche toujours', async () => {
    const annulation = await placer([planche(PLANCHE, { supprime_le: INSTANT.toISOString() }), zone(ZONE, { supprime_le: INSTANT.toISOString() })]);
    expect(ligne('zone', ZONE)?.supprime_le).not.toBeNull();
    await placer(annulation);
    expect(ligne('zone', ZONE)?.supprime_le).toBeNull();
    expect(ligne('emplacement', PLANCHE)?.supprime_le).toBeNull();
  });
});
