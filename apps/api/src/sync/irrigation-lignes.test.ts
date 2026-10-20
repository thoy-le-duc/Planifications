/**
 * Tests d'acceptation T57 — règles d'une ligne de vanne (`secteur_irrigation`) et d'un lien daté
 * vanne ↔ emplacement (`secteur_emplacement`) écrits par le téléphone (structure-lignes.ts), sans
 * base. Ce que la base doit relire (numéro unique, références de la ferme, ce qui sert encore) :
 * irrigation.integration.test.ts.
 *
 * Colonnes écrites (format PowerSync : numeric en nombre, dates 'AAAA-MM-JJ') :
 *   secteur_irrigation   id, ferme_id, numero_vanne, nom, debit_litres_heure, placement_x_m,
 *                        placement_y_m, supprime_le (cree_le, modifie_le tolérées). L'adresse
 *                        Modbus (phase 3) n'est pas écrite par le téléphone : colonne inconnue.
 *   secteur_emplacement  id, ferme_id, secteur_irrigation_id, emplacement_id, du, au, supprime_le.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validerStructure, type Ligne } from './structure-lignes.ts';

type TableVanne = 'secteur_irrigation' | 'secteur_emplacement';
/** Les tables de T57, vues par validerStructure (le type de T10s ne les connaît pas encore). */
const valider = validerStructure as unknown as (table: TableVanne, ligne: Ligne) => ReturnType<typeof validerStructure>;

const FERME = randomUUID();

const vanne = (autres: Ligne = {}): Ligne => ({
  id: randomUUID(),
  ferme_id: FERME,
  numero_vanne: 12,
  nom: 'V12',
  debit_litres_heure: 850.5,
  placement_x_m: null,
  placement_y_m: null,
  supprime_le: null,
  ...autres,
});

const lien = (autres: Ligne = {}): Ligne => ({
  id: randomUUID(),
  ferme_id: FERME,
  secteur_irrigation_id: randomUUID(),
  emplacement_id: randomUUID(),
  du: '2026-10-19',
  au: null,
  supprime_le: null,
  ...autres,
});

function accepte(table: TableVanne, l: Ligne): Ligne {
  const r = valider(table, l);
  if (!r.ok) throw new Error(`refusé à tort : ${r.erreur.message} (${String(r.erreur.champ)})`);
  return r.ligne;
}

function refuse(table: TableVanne, l: Ligne, champ?: string): void {
  const r = valider(table, l);
  expect(r.ok, JSON.stringify(l).slice(0, 200)).toBe(false);
  if (!r.ok && champ !== undefined) expect(r.erreur.champ).toBe(champ);
}

describe('T57 : ligne de vanne (secteur_irrigation)', () => {
  it('une vanne V12 de 850,5 L/h, non placée, est acceptée telle quelle', () => {
    const l = vanne();
    expect(accepte('secteur_irrigation', l)).toEqual({ ...l });
  });

  it('débit facultatif ; placement : les deux coordonnées ou aucune', () => {
    accepte('secteur_irrigation', vanne({ debit_litres_heure: null }));
    expect(accepte('secteur_irrigation', vanne({ placement_x_m: 120.5, placement_y_m: 16 }))).toMatchObject({ placement_x_m: 120.5, placement_y_m: 16 });
    refuse('secteur_irrigation', vanne({ placement_x_m: 120.5 }));
    refuse('secteur_irrigation', vanne({ placement_y_m: 16 }));
    refuse('secteur_irrigation', vanne({ placement_x_m: 6_000, placement_y_m: 0 }));
  });

  it('numéro entier de 1 à 9 999, nom non vide de 200 caractères au plus, débit > 0', () => {
    accepte('secteur_irrigation', vanne({ numero_vanne: 1 }));
    accepte('secteur_irrigation', vanne({ numero_vanne: 9_999 }));
    refuse('secteur_irrigation', vanne({ numero_vanne: 0 }), 'numero_vanne');
    refuse('secteur_irrigation', vanne({ numero_vanne: 10_000 }), 'numero_vanne');
    refuse('secteur_irrigation', vanne({ numero_vanne: 2.5 }), 'numero_vanne');
    refuse('secteur_irrigation', vanne({ numero_vanne: null }), 'numero_vanne');
    refuse('secteur_irrigation', vanne({ nom: '  ' }), 'nom');
    refuse('secteur_irrigation', vanne({ nom: 'x'.repeat(201) }), 'nom');
    refuse('secteur_irrigation', vanne({ debit_litres_heure: 0 }), 'debit_litres_heure');
    refuse('secteur_irrigation', vanne({ debit_litres_heure: 1_000_001 }), 'debit_litres_heure');
  });

  it('adresse Modbus (phase 3) ou colonne inconnue : refusées', () => {
    refuse('secteur_irrigation', vanne({ adresse_modbus: 3 }));
    refuse('secteur_irrigation', vanne({ ouverte: 1 }));
  });
});

describe('T57 : lien daté vanne ↔ emplacement (secteur_emplacement)', () => {
  it('un lien du 19 octobre, sans fin, est accepté', () => {
    const l = lien();
    expect(accepte('secteur_emplacement', l)).toEqual({ ...l });
  });

  it('fin le jour du début ou après : accepté ; avant : refusé', () => {
    accepte('secteur_emplacement', lien({ du: '2026-01-01', au: '2026-01-01' }));
    accepte('secteur_emplacement', lien({ du: '2026-01-01', au: '2026-10-18' }));
    refuse('secteur_emplacement', lien({ du: '2026-10-19', au: '2026-10-18' }), 'au');
  });

  it('vanne, emplacement et début obligatoires', () => {
    refuse('secteur_emplacement', lien({ secteur_irrigation_id: null }), 'secteur_irrigation_id');
    refuse('secteur_emplacement', lien({ emplacement_id: 'P3' }), 'emplacement_id');
    refuse('secteur_emplacement', lien({ du: null }), 'du');
    refuse('secteur_emplacement', lien({ du: '2026-02-30' }), 'du');
  });
});
