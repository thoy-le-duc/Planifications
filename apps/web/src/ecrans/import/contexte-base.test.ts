/**
 * T14f — ce que la base locale dit des planches à l'import (./contexte-base.ts) : chaque planche
 * avec sa zone, pour que l'import la reconnaisse par zone + code (docs/backlog/T14f-import-codes-par-zone.md).
 * Comme le serveur depuis T10t (décision D) : une planche retirée (`actif_au` renseigné) ne compte
 * plus, une supprimée non plus, et jamais une planche d'une autre ferme.
 *
 * Contrat fixé par le testeur : `EmplacementConnu.zoneId` (types.ts), lu de `emplacement.zone_id`
 * dans la même requête que les autres colonnes (pas de requête par planche).
 */
import { describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { lireContexte } from './contexte-base.ts';
import { AUTRE_FERME, CREE_LE, ecrireFermeImport, EMPLACEMENT, FERME, UTILISATEUR, ZONE } from './test/ferme-import.ts';

const id = (n: number): string => `0192f0c1-14f1-7000-8000-${n.toString(16).padStart(12, '0')}`;
const P5_RETIREE = id(0x1);
const P5_NOUVELLE = id(0x2);
const P3_NORTH = id(0x3);
const P3_GRANDS_PRES = id(0x4);
const P6_SUPPRIMEE = id(0x5);
const P7_AUTRE_FERME = id(0x6);
const ZONE_AUTRE_FERME = id(0x7);

const COLONNES = ['id', 'ferme_id', 'zone_id', 'code', 'sorte', 'longueur_m', 'largeur_m', 'nombre_places', 'actif_du', 'actif_au', 'remplace', 'cree_le', 'modifie_le', 'supprime_le'] as const;

async function contexte() {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeImport(base);
  const planche = (eid: string, ferme: string, zone: string, code: string, actifAu: string | null = null, supprimeLe: string | null = null): unknown[] => [
    eid,
    ferme,
    zone,
    code,
    'planche',
    30,
    0.8,
    null,
    '2020-01-01',
    actifAu,
    '[]',
    CREE_LE,
    CREE_LE,
    supprimeLe,
  ];
  await base.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      ZONE_AUTRE_FERME,
      AUTRE_FERME,
      'North field',
      null,
      'plein_champ',
      null,
      CREE_LE,
      CREE_LE,
      null,
    ]);
    const sql = `INSERT INTO emplacement (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`;
    // P5 retirée l'an dernier, remplacée par une nouvelle P5 dans la même zone.
    await tx.execute(sql, planche(P5_RETIREE, FERME, ZONE.north, 'P5', '2026-06-30'));
    await tx.execute(sql, planche(P5_NOUVELLE, FERME, ZONE.north, 'P5'));
    // P3 dans deux zones : deux planches légitimes (Q27).
    await tx.execute(sql, planche(P3_NORTH, FERME, ZONE.north, 'P3'));
    await tx.execute(sql, planche(P3_GRANDS_PRES, FERME, ZONE.grandsPres, 'P3'));
    await tx.execute(sql, planche(P6_SUPPRIMEE, FERME, ZONE.north, 'P6', null, '2026-02-01T08:00:00.000Z'));
    await tx.execute(sql, planche(P7_AUTRE_FERME, AUTRE_FERME, ZONE_AUTRE_FERME, 'P7'));
  });
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => new Date('2027-01-15T08:00:00.000Z') });
  return lireContexte(porte, FERME);
}

/** Zone d'un emplacement connu : `zoneId` (T14f), lu sans dépendre du type d'avant le ticket. */
const zoneDe = (e: object): unknown => (e as { readonly zoneId?: unknown }).zoneId;

describe('T14f : contexte de l’import, chaque planche avec sa zone', () => {
  it('chaque emplacement porte la zone où il est rangé', async () => {
    const ctx = await contexte();
    const parId = new Map(ctx.emplacements.map((e) => [e.id, e]));
    for (const [eid, zone] of [
      [EMPLACEMENT.n3, ZONE.north],
      [EMPLACEMENT.gp1, ZONE.grandsPres],
      [EMPLACEMENT.gp5, ZONE.cote],
      [P3_NORTH, ZONE.north],
      [P3_GRANDS_PRES, ZONE.grandsPres],
    ] as const) {
      const e = parId.get(eid);
      expect(e, eid).toBeDefined();
      expect(e === undefined ? undefined : zoneDe(e), `zone de ${String(e?.code)}`).toBe(zone);
    }
  });

  it('« P3 » dans deux zones : les deux planches sont connues, chacune avec sa zone', async () => {
    const ctx = await contexte();
    const p3 = ctx.emplacements.filter((e) => e.code === 'P3').map((e) => [e.id, zoneDe(e)]);
    expect(p3).toHaveLength(2);
    expect(p3).toContainEqual([P3_NORTH, ZONE.north]);
    expect(p3).toContainEqual([P3_GRANDS_PRES, ZONE.grandsPres]);
  });

  it('planche retirée (actif_au renseigné) et nouvelle « P5 » dans la même zone : seule la nouvelle est connue', async () => {
    const ctx = await contexte();
    const p5 = ctx.emplacements.filter((e) => e.code.trim().toLowerCase() === 'p5');
    expect(p5.map((e) => e.id)).toStrictEqual([P5_NOUVELLE]);
  });

  it('ni planche supprimée, ni planche d’une autre ferme', async () => {
    const ctx = await contexte();
    const ids = ctx.emplacements.map((e) => e.id);
    expect(ids).not.toContain(P6_SUPPRIMEE);
    expect(ids).not.toContain(P7_AUTRE_FERME);
  });
});
