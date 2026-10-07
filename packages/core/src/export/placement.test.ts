/**
 * Tests d'acceptation T28a — export du placement (docs/backlog/T28a-placement-modele.md,
 * critère 7) : `batiment.csv`, les nouvelles colonnes de `zone`, `emplacement` et `ferme`,
 * décrites pour LISEZMOI.txt. Contrat de l'export : ./test/contrat.ts (T15) ; `batiment` est
 * ajouté à TABLES_ATTENDUES.
 *
 * Colonnes attendues (types d'export du contrat T15, mêmes noms que Postgres et le schéma local) :
 *   batiment     id, ferme_id, nom (texte), type (texte), longueur_m, largeur_m, hauteur_m,
 *                centre_x_m, centre_y_m, orientation_deg (reel), zone_id (texte), cree_le,
 *                modifie_le, supprime_le (instant)
 *   ferme        + origine_plan (json)
 *   zone         + contour (json)
 *   emplacement  + placement_x_m, placement_y_m, orientation_deg (reel)
 * Les descriptions disent l'unité (mètres, degrés) et le repère (local de la ferme, ou de la
 * zone pour les planches).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type DescriptionTable, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;

beforeAll(async () => {
  m = await chargerExport();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-a280-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const ZONE = uuid(2);
const SERRE = uuid(3);
const PLANCHE = uuid(4);
const CREE = '2026-10-07T08:00:00.000Z';

/** Contenu d'un fichier de l'archive, ou échec explicite. */
function contenu(fichiers: readonly { chemin: string; contenu: string }[], chemin: string): string {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin}`);
  return f.contenu;
}

function description(table: string): DescriptionTable {
  const d = m.TABLES_EXPORTEES[table];
  if (d === undefined) throw new Error(`TABLES_EXPORTEES sans ${table}`);
  return d;
}

const CONTOUR = [
  { x: 0, y: 0 },
  { x: 40.5, y: 0 },
  { x: 40.5, y: 8 },
  { x: 0, y: 8 },
];

/** Une ferme placée : origine, une zone en polygone, une serre qui abrite une autre zone, une planche placée. */
function entree(): { fermeId: string; genereLe: string; tables: Record<string, LigneLocale[]> } {
  const horodatage = { cree_le: CREE, modifie_le: CREE, supprime_le: null };
  return {
    fermeId: FERME,
    genereLe: CREE,
    tables: {
      ferme: [
        {
          id: FERME,
          nom: 'Ferme de Benoît',
          fuseau_horaire: 'Europe/Paris',
          position: '{"latitude":44.1,"longitude":1.6}',
          origine_plan: '{"latitude":44,"longitude":1.5}',
          unites: '{"longueur":"m","masse":"kg"}',
          ...horodatage,
        },
      ],
      zone: [
        { id: ZONE, ferme_id: FERME, nom: 'Îlot nord', zone_parente_id: null, type_abri: 'plein_champ', surface_m2: 324, contour: JSON.stringify(CONTOUR), ...horodatage },
        { id: uuid(5), ferme_id: FERME, nom: 'M3', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 320, contour: null, ...horodatage },
      ],
      emplacement: [
        {
          id: PLANCHE,
          ferme_id: FERME,
          zone_id: uuid(5),
          code: 'M3-P01',
          sorte: 'planche',
          longueur_m: 38,
          largeur_m: 0.8,
          nombre_places: null,
          actif_du: '2026-01-01',
          actif_au: null,
          remplace: '[]',
          placement_x_m: 2,
          placement_y_m: -0.5,
          orientation_deg: 0,
          ...horodatage,
        },
      ],
      batiment: [
        {
          id: SERRE,
          ferme_id: FERME,
          nom: 'Serre M3',
          type: 'serre_tunnel',
          longueur_m: 40,
          largeur_m: 8,
          hauteur_m: 3.5,
          centre_x_m: 50.25,
          centre_y_m: -30,
          orientation_deg: 92.5,
          zone_id: uuid(5),
          ...horodatage,
        },
        {
          id: uuid(6),
          ferme_id: FERME,
          nom: 'Hangar',
          type: 'hangar',
          longueur_m: 20,
          largeur_m: 12,
          hauteur_m: 6,
          centre_x_m: -10,
          centre_y_m: 15,
          orientation_deg: 0,
          zone_id: null,
          ...horodatage,
        },
        // Une autre ferme : jamais exportée.
        {
          id: uuid(7),
          ferme_id: uuid(99),
          nom: 'Serre voisine',
          type: 'serre_chapelle',
          longueur_m: 50,
          largeur_m: 9.6,
          hauteur_m: 4,
          centre_x_m: 0,
          centre_y_m: 0,
          orientation_deg: 10,
          zone_id: null,
          ...horodatage,
        },
      ],
    },
  };
}

describe('T28a : colonnes du placement dans la liste blanche', () => {
  it('batiment : colonnes et types, dans l’ordre', () => {
    const d = description('batiment');
    expect(d.bibliotheque).toBe(false);
    expect(Object.fromEntries(Object.entries(d.colonnes).map(([c, x]) => [c, x.type]))).toEqual({
      id: 'texte',
      ferme_id: 'texte',
      nom: 'texte',
      type: 'texte',
      longueur_m: 'reel',
      largeur_m: 'reel',
      hauteur_m: 'reel',
      centre_x_m: 'reel',
      centre_y_m: 'reel',
      orientation_deg: 'reel',
      zone_id: 'texte',
      cree_le: 'instant',
      modifie_le: 'instant',
      supprime_le: 'instant',
    });
    expect(Object.keys(d.colonnes)[0]).toBe('id');
  });

  it('nouvelles colonnes de ferme, zone et emplacement', () => {
    expect(description('ferme').colonnes.origine_plan?.type).toBe('json');
    expect(description('zone').colonnes.contour?.type).toBe('json');
    expect(description('emplacement').colonnes.placement_x_m?.type).toBe('reel');
    expect(description('emplacement').colonnes.placement_y_m?.type).toBe('reel');
    expect(description('emplacement').colonnes.orientation_deg?.type).toBe('reel');
  });

  it('descriptions : unité et repère dits en français', () => {
    const desc = (t: string, c: string) => description(t).colonnes[c]?.description ?? '';
    expect(desc('ferme', 'origine_plan')).toMatch(/latitude|longitude/i);
    expect(desc('zone', 'contour')).toMatch(/mètres/i);
    expect(desc('emplacement', 'placement_x_m')).toMatch(/mètres/i);
    expect(desc('emplacement', 'placement_x_m')).toMatch(/zone/i);
    expect(desc('emplacement', 'orientation_deg')).toMatch(/degrés/i);
    expect(desc('batiment', 'centre_x_m')).toMatch(/mètres/i);
    expect(desc('batiment', 'orientation_deg')).toMatch(/degrés/i);
    expect(desc('batiment', 'orientation_deg')).toMatch(/nord/i);
    expect(desc('batiment', 'type')).toMatch(/tunnel/i);
    expect(desc('batiment', 'zone_id')).toMatch(/zone\.csv/);
    expect(description('batiment').description).toMatch(/serre|bâtiment/i);
  });
});

describe('T28a : fichiers exportés', () => {
  it('batiment.csv : les bâtiments de la ferme seulement, nombres à virgule', () => {
    const fichiers = m.construireExport(entree());
    const lignes = objetsCsv(lireCsv(contenu(fichiers, 'batiment.csv')));
    expect(lignes.map((l) => l.nom)).toEqual(['Serre M3', 'Hangar']);
    expect(lignes[0]).toMatchObject({ type: 'serre_tunnel', longueur_m: '40', hauteur_m: '3,5', centre_x_m: '50,25', centre_y_m: '-30', orientation_deg: '92,5', zone_id: uuid(5) });
    expect(lignes[1]?.zone_id).toBe('');
  });

  it('zone.csv, emplacement.csv : contour en JSON, placement en nombres', () => {
    const fichiers = m.construireExport(entree());
    const zones = objetsCsv(lireCsv(contenu(fichiers, 'zone.csv')));
    expect(JSON.parse(zones[0]?.contour ?? 'null')).toEqual(CONTOUR);
    expect(zones[1]?.contour).toBe('');
    const emplacements = objetsCsv(lireCsv(contenu(fichiers, 'emplacement.csv')));
    expect(emplacements[0]).toMatchObject({ placement_x_m: '2', placement_y_m: '-0,5', orientation_deg: '0' });
  });

  it('ferme.json : origine_plan et contour décodés, bâtiments typés', () => {
    const fichiers = m.construireExport(entree());
    const json = JSON.parse(contenu(fichiers, 'ferme.json')) as {
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(json.tables.ferme?.[0]?.origine_plan).toEqual({ latitude: 44, longitude: 1.5 });
    expect(json.tables.ferme?.[0]?.position).toEqual({ latitude: 44.1, longitude: 1.6 });
    expect(json.tables.zone?.[0]?.contour).toEqual(CONTOUR);
    expect(json.tables.zone?.[1]?.contour).toBeNull();
    expect(json.tables.emplacement?.[0]).toMatchObject({ placement_x_m: 2, placement_y_m: -0.5, orientation_deg: 0 });
    expect(json.tables.batiment).toHaveLength(2);
    expect(json.tables.batiment?.[0]).toMatchObject({ nom: 'Serre M3', longueur_m: 40, centre_x_m: 50.25, orientation_deg: 92.5, zone_id: uuid(5) });
  });

  it('ferme exportée sans aucun placement : colonnes vides, batiment.csv réduit à l’en-tête', () => {
    const e = entree();
    const sansPlacement = {
      ...e,
      tables: {
        ferme: e.tables.ferme?.map((l) => ({ ...l, origine_plan: null })) ?? [],
        zone: e.tables.zone?.map((l) => ({ ...l, contour: null })) ?? [],
        emplacement: e.tables.emplacement?.map((l) => ({ ...l, placement_x_m: null, placement_y_m: null, orientation_deg: null })) ?? [],
      },
    };
    const fichiers = m.construireExport(sansPlacement);
    const batiments = lireCsv(contenu(fichiers, 'batiment.csv'));
    expect(batiments.lignes).toHaveLength(0);
    expect(batiments.entete).toEqual(Object.keys(description('batiment').colonnes));
  });

  it('LISEZMOI.txt : un bloc « ## batiment.csv » et les nouvelles colonnes décrites', () => {
    const texte = contenu(m.construireExport(entree()), 'LISEZMOI.txt');
    expect(texte).toMatch(/^## batiment\.csv$/m);
    for (const c of ['origine_plan', 'contour', 'placement_x_m', 'placement_y_m', 'orientation_deg', 'centre_x_m', 'hauteur_m']) {
      expect(texte, c).toMatch(new RegExp(`^- ${c} : `, 'm'));
    }
  });
});
