/**
 * T89 : règles pures de la fiche « Serre ou tunnel » ajoutées par le développeur (./serre-fiche.tsx), en plus des tests
 * d'acceptation (serre-fiche-editeur.test.tsx) : limite de 500 écritures, tunnel simple sur une zone sans sous-zone, codes libres,
 * dernière serre créée, plusieurs serres au brouillon.
 */
import { describe, expect, it } from 'vitest';
import { defautsSerre, type FicheSerre } from '@planif/core/placement';
import { ajouterCreation, avecCreation, derniereSerre, preparerCreation, raisonFiche, type ContexteFiche } from './serre-fiche.tsx';
import type { Batiment, EmplacementEnService, Zone } from './donnees.ts';

const fiche = (ecart: Partial<FicheSerre> = {}): FicheSerre => ({ ...defautsSerre(), nom: 'Serre', prefixeZones: 'Serre', ...ecart });
let n = 0;
const contexte = (ecart: Partial<ContexteFiche> = {}): ContexteFiche => ({
  zones: [],
  batiments: [],
  emplacements: [],
  zoneId: null,
  centre: { x: 10, y: 20 },
  nouvelId: () => `id-${String(++n)}`,
  ...ecart,
});
const zone = (id: string, nom: string, parenteId: string | null = null): Zone => ({ id, nom, contour: null, parenteId, typeAbri: 'tunnel' });
const planche = (id: string, zoneId: string, code: string): EmplacementEnService => ({ id, zoneId, code, longueurM: 30, largeurM: 0.75, placement: null });
const serre = (id: string, creeLe: string, ligne: Record<string, unknown>, dims: [number, number]): Batiment => ({
  id,
  nom: id,
  type: 'serre_chapelle',
  centre: { x: 0, y: 0 },
  orientationDeg: 0,
  longueurM: dims[0],
  largeurM: dims[1],
  hauteurM: 4,
  zoneId: null,
  nouveau: false,
  ligne: { cree_le: creeLe, ...ligne },
});

describe('T89 : limite de 500 écritures par enregistrement', () => {
  it('18 zones de 8 planches : 164 écritures, permis', () => {
    expect(raisonFiche(fiche({ nbChapelles: 6, nbTroncons: 3 }), contexte())).toBeNull();
  });

  it('20 zones de 25 planches : 522 écritures, refusé avec un message clair', () => {
    expect(raisonFiche(fiche({ nbChapelles: 5, nbTroncons: 4, planches: { ...defautsSerre().planches, nombre: 25 } }), contexte())).toMatch(/522 écritures.*500 au plus/);
  });
});

describe('T89 : depuis une zone existante', () => {
  it('moins de cases que de sous-zones existantes : refusé', () => {
    const zones = [zone('z', 'Tri'), zone('a', 'A', 'z'), zone('b', 'B', 'z')];
    expect(raisonFiche(fiche({ nbChapelles: 1 }), contexte({ zones, zoneId: 'z' }))).toMatch(/au moins 2 cases/);
  });

  it('zone sans sous-zone, une seule case : aucune sous-zone créée, ses planches reprises et complétées par des codes libres', () => {
    const zones = [zone('z', 'Tunnel 1')];
    const emplacements = [planche('p1', 'z', 'P1'), planche('p3', 'z', 'P3')];
    const r = preparerCreation(fiche({ planches: { ...defautsSerre().planches, nombre: 4 } }), contexte({ zones, emplacements, zoneId: 'z' }));
    expect(r.creation.zones).toEqual([]);
    expect(r.creation.planches.map((p) => p.code)).toEqual(['P2', 'P4']);
    expect(r.creation.reprises).toEqual(['p1', 'p3']);
    expect(r.planches).toHaveLength(4);
    expect(r.batiment.zoneId).toBe('z');
  });

  it('les sous-zones manquantes prennent les noms libres du préfixe', () => {
    const zones = [zone('z', 'Tri'), zone('a', 'Tri 1', 'z')];
    const r = preparerCreation(fiche({ nbChapelles: 3, prefixeZones: 'Tri', planches: { ...defautsSerre().planches, nombre: 0 } }), contexte({ zones, zoneId: 'z' }));
    expect(r.creation.zones.map((z) => z.nom)).toEqual(['Tri 2', 'Tri 3']);
    // 3 chapelles, mais la zone est un tunnel : ses sous-zones aussi.
    expect(r.creation.zones.map((z) => z.typeAbri)).toEqual(['tunnel', 'tunnel']);
  });
});

describe('T89 : la dernière serre créée', () => {
  it('la plus récente à grille et non supprimée ; sans grille ni récente supprimée', () => {
    const b = [
      serre('a', '2026-06-01', { nb_chapelles: 3, nb_troncons: 1 }, [40, 28.8]),
      serre('b', '2026-09-01', { nb_chapelles: 4, nb_troncons: 2, largeur_allee_m: 3 }, [63, 32]),
      serre('c', '2026-10-01', { nb_chapelles: null }, [40, 8]),
    ];
    expect(derniereSerre(b)).toEqual({ largeurChapelleM: 8, nbChapelles: 4, longueurTronconM: 30, nbTroncons: 2, largeurAlleeM: 3 });
    expect(derniereSerre([])).toBeNull();
  });
});

describe('T89 : deux serres avant d’enregistrer', () => {
  it('les créations s’ajoutent ; chaque bâtiment reçoit sa grille', () => {
    const a = preparerCreation(fiche({ nom: 'A', prefixeZones: 'A' }), contexte());
    const b = preparerCreation(fiche({ nom: 'B', prefixeZones: 'B', nbChapelles: 2 }), contexte());
    const c = ajouterCreation(ajouterCreation(null, a.creation), b.creation);
    expect(c.zones).toHaveLength(2 + 3);
    const changements = avecCreation(c, [
      { sorte: 'batiment', id: a.batiment.id, valeurs: { nom: 'A' } },
      { sorte: 'batiment', id: b.batiment.id, valeurs: { nom: 'B' } },
    ], new Map());
    const grilles = changements.flatMap((x) => (x.sorte === 'batiment' ? [x.valeurs.nb_chapelles] : []));
    expect(grilles).toEqual([1, 2]);
    expect(changements.findIndex((x) => x.sorte === 'batiment')).toBeGreaterThan(changements.findLastIndex((x) => x.sorte === 'zone_creation'));
  });
});
