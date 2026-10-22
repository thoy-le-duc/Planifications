/**
 * T58 : `etatsDesZones` (écrans Aujourd'hui et 3D) rend, zone par zone, exactement ce que rend
 * `etatsDeLaZone`, en une seule passe sur le journal.
 */
import { describe, expect, it } from 'vitest';
import { etatsDeLaZone, etatsDesZones, type EvenementEtatAbri, type ZoneAbri } from './index.ts';

const ZONES: readonly ZoneAbri[] = [
  { id: 'z1', nom: 'Serre 1', typeAbri: 'serre', equipementsAbri: null },
  { id: 'z2', nom: 'Tunnel 2', typeAbri: 'tunnel', equipementsAbri: ['portes', 'chauffage'] },
  { id: 'z3', nom: 'Plein champ', typeAbri: 'plein_champ', equipementsAbri: null },
];

const ev = (id: string, zoneId: string, equipement: EvenementEtatAbri['equipement'], actif: boolean, h: string, remplace: Pick<EvenementEtatAbri, 'remplaceSorte' | 'remplaceEvenementId'> = { remplaceSorte: null, remplaceEvenementId: null }): EvenementEtatAbri => ({
  id,
  zoneId,
  equipement,
  actif,
  horodatage: `2026-10-22T${h}:00.000Z`,
  ...remplace,
});

const EVENEMENTS: readonly EvenementEtatAbri[] = [
  ev('e1', 'z1', 'portes', true, '07:00'),
  ev('e2', 'z1', 'portes', false, '09:00'),
  ev('e3', 'z1', 'portes', false, '09:30', { remplaceSorte: 'annulation', remplaceEvenementId: 'e2' }),
  ev('e4', 'z2', 'chauffage', true, '05:00'),
  ev('e5', 'z2', 'chauffage', false, '06:00', { remplaceSorte: 'correction', remplaceEvenementId: 'e4' }),
  ev('e6', 'z2', 'voile', true, '05:00'),
];

describe('T58 : état de toutes les zones en une passe', () => {
  it('même résultat que etatsDeLaZone pour chaque zone, à plusieurs instants', () => {
    for (const instant of ['2026-10-22T04:00:00.000Z', '2026-10-22T08:00:00.000Z', '2026-10-22T12:00:00.000Z']) {
      const toutes = etatsDesZones(EVENEMENTS, ZONES, instant);
      expect([...toutes.keys()]).toEqual(['z1', 'z2', 'z3']);
      for (const z of ZONES) expect(toutes.get(z.id), `${z.id} à ${instant}`).toEqual(etatsDeLaZone(EVENEMENTS, z, instant));
    }
  });

  it('la porte annulée reste ouverte, le chauffage corrigé est éteint depuis 5 h, le voile non déclaré est absent', () => {
    const toutes = etatsDesZones(EVENEMENTS, ZONES, '2026-10-22T12:00:00.000Z');
    expect(toutes.get('z1')?.find((x) => x.equipement === 'portes')?.etat).toEqual({ actif: true, depuis: '2026-10-22T07:00:00.000Z', evenementId: 'e1' });
    expect(toutes.get('z2')).toEqual([
      { equipement: 'portes', etat: null },
      { equipement: 'chauffage', etat: { actif: false, depuis: '2026-10-22T05:00:00.000Z', evenementId: 'e5' } },
    ]);
    expect(toutes.get('z3')).toEqual([]);
  });
});
