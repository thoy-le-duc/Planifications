/**
 * Tests d'acceptation T61 — export complet (principe : tout est exportable, CLAUDE.md n°5) :
 * `chemin.csv`, `point_plan.csv`, `lieu_rangement.csv`, `place_rangement.csv`, `outil.csv`, plus
 * les nouvelles sortes de bâtiment, décrits pour LISEZMOI.txt. Contrat de l'export : ./test/
 * contrat.ts (T15) ; les cinq tables sont ajoutées à TABLES_ATTENDUES.
 *
 * Colonnes attendues (types d'export du contrat T15, mêmes noms que Postgres et le schéma local) :
 *   chemin           id, ferme_id, nom (texte), points (json), largeur_m (reel), cree_le, modifie_le,
 *                    supprime_le (instant)
 *   point_plan       id, ferme_id, nom (texte), sorte (texte), x_m, y_m (reel), horodatages
 *   lieu_rangement   id, ferme_id, batiment_id, point_plan_id (texte), horodatages
 *   place_rangement  id, ferme_id, lieu_rangement_id, nom (texte), horodatages
 *   outil            id, ferme_id, nom, lieu_rangement_id, place_rangement_id (texte), horodatages
 * Les descriptions disent l'unité (mètres) et le repère (local de la ferme), et renvoient aux
 * fichiers liés (« voir batiment.csv », « voir lieu_rangement.csv »…).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type DescriptionTable, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;

beforeAll(async () => {
  m = await chargerExport();
});

const uuid = (n: number): string => `0192f0c1-6161-7cc3-a280-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const AUTRE = uuid(99);
const HANGAR = uuid(2);
const EAU = uuid(3);
const LIEU_HANGAR = uuid(4);
const LIEU_EAU = uuid(5);
const MUR_NORD = uuid(6);
const CREE = '2026-10-21T08:00:00.000Z';
const horodatage = { cree_le: CREE, modifie_le: CREE, supprime_le: null };

const CHEMIN = [
  { x: 0, y: 0 },
  { x: 40.5, y: 0 },
  { x: 40.5, y: 25 },
];

function description(table: string): DescriptionTable {
  const d = m.TABLES_EXPORTEES[table];
  if (d === undefined) throw new Error(`TABLES_EXPORTEES sans ${table}`);
  return d;
}

function contenu(fichiers: readonly { chemin: string; contenu: string }[], chemin: string): string {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin}`);
  return f.contenu;
}

function entree(): { fermeId: string; genereLe: string; tables: Record<string, LigneLocale[]> } {
  return {
    fermeId: FERME,
    genereLe: CREE,
    tables: {
      ferme: [{ id: FERME, nom: 'Ferme de Benoît', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: '{"latitude":44,"longitude":1.5}', unites: '{"longueur":"m","masse":"kg"}', ...horodatage }],
      batiment: [
        { id: HANGAR, ferme_id: FERME, nom: 'hangar', type: 'hangar', longueur_m: 20, largeur_m: 12, hauteur_m: 6, centre_x_m: -10, centre_y_m: 15, orientation_deg: 0, zone_id: null, ...horodatage },
        { id: uuid(7), ferme_id: FERME, nom: 'chambre froide', type: 'chambre_froide', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: 5, centre_y_m: 15, orientation_deg: 90, zone_id: null, ...horodatage },
      ],
      chemin: [
        { id: uuid(10), ferme_id: FERME, nom: 'Allée centrale', points: JSON.stringify(CHEMIN), largeur_m: 2.5, ...horodatage },
        { id: uuid(11), ferme_id: FERME, nom: null, points: JSON.stringify(CHEMIN.slice(0, 2)), largeur_m: 1, ...horodatage },
        // Une autre ferme : jamais exportée.
        { id: uuid(12), ferme_id: AUTRE, nom: 'Chemin voisin', points: JSON.stringify(CHEMIN), largeur_m: 3, ...horodatage },
      ],
      point_plan: [
        { id: EAU, ferme_id: FERME, nom: 'Point d’eau du verger', sorte: 'point_eau', x_m: 12.5, y_m: -40, ...horodatage },
        { id: uuid(13), ferme_id: AUTRE, nom: 'Puits voisin', sorte: 'point_eau', x_m: 1, y_m: 1, ...horodatage },
      ],
      lieu_rangement: [
        { id: LIEU_HANGAR, ferme_id: FERME, batiment_id: HANGAR, point_plan_id: null, ...horodatage },
        { id: LIEU_EAU, ferme_id: FERME, batiment_id: null, point_plan_id: EAU, ...horodatage },
        { id: uuid(14), ferme_id: AUTRE, batiment_id: null, point_plan_id: uuid(13), ...horodatage },
      ],
      place_rangement: [
        { id: MUR_NORD, ferme_id: FERME, lieu_rangement_id: LIEU_HANGAR, nom: 'mur nord', ...horodatage },
        { id: uuid(15), ferme_id: AUTRE, lieu_rangement_id: uuid(14), nom: 'mur nord', ...horodatage },
      ],
      outil: [
        { id: uuid(16), ferme_id: FERME, nom: 'Grelinette', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: MUR_NORD, ...horodatage },
        { id: uuid(17), ferme_id: FERME, nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: null, ...horodatage },
        { id: uuid(18), ferme_id: AUTRE, nom: 'Outil voisin', lieu_rangement_id: uuid(14), place_rangement_id: null, ...horodatage },
      ],
    },
  };
}

const TABLES = ['chemin', 'point_plan', 'lieu_rangement', 'place_rangement', 'outil'] as const;

describe('T61 : liste blanche de l’export', () => {
  const types = (table: string) => Object.fromEntries(Object.entries(description(table).colonnes).map(([c, x]) => [c, x.type]));
  const HORO = { cree_le: 'instant', modifie_le: 'instant', supprime_le: 'instant' };

  it('chemin : colonnes et types dans l’ordre, points en JSON', () => {
    expect(types('chemin')).toEqual({ id: 'texte', ferme_id: 'texte', nom: 'texte', points: 'json', largeur_m: 'reel', ...HORO });
    expect(Object.keys(description('chemin').colonnes)[0]).toBe('id');
  });

  it('point_plan, lieu_rangement, place_rangement, outil : colonnes et types', () => {
    expect(types('point_plan')).toEqual({ id: 'texte', ferme_id: 'texte', nom: 'texte', sorte: 'texte', x_m: 'reel', y_m: 'reel', ...HORO });
    expect(types('lieu_rangement')).toEqual({ id: 'texte', ferme_id: 'texte', batiment_id: 'texte', point_plan_id: 'texte', ...HORO });
    expect(types('place_rangement')).toEqual({ id: 'texte', ferme_id: 'texte', lieu_rangement_id: 'texte', nom: 'texte', ...HORO });
    expect(types('outil')).toEqual({ id: 'texte', ferme_id: 'texte', nom: 'texte', lieu_rangement_id: 'texte', place_rangement_id: 'texte', ...HORO });
  });

  it('aucune de ces tables n’est de la bibliothèque (toutes à ferme_id)', () => {
    for (const t of TABLES) expect(description(t).bibliotheque, t).toBe(false);
  });

  it('descriptions en français : unité, repère et fichiers liés', () => {
    const desc = (t: string, c: string) => description(t).colonnes[c]?.description ?? '';
    expect(desc('chemin', 'points')).toMatch(/mètres/i);
    expect(desc('chemin', 'points')).toMatch(/ferme/i);
    expect(desc('chemin', 'largeur_m')).toMatch(/mètres/i);
    expect(desc('point_plan', 'x_m')).toMatch(/mètres/i);
    expect(desc('point_plan', 'sorte')).toMatch(/point_eau/);
    expect(desc('lieu_rangement', 'batiment_id')).toMatch(/batiment\.csv/);
    expect(desc('lieu_rangement', 'point_plan_id')).toMatch(/point_plan\.csv/);
    expect(desc('place_rangement', 'lieu_rangement_id')).toMatch(/lieu_rangement\.csv/);
    expect(desc('outil', 'lieu_rangement_id')).toMatch(/lieu_rangement\.csv/);
    expect(desc('outil', 'place_rangement_id')).toMatch(/place_rangement\.csv/);
    for (const t of TABLES) expect(description(t).description.length, t).toBeGreaterThan(10);
  });

  it('batiment.type décrit les nouvelles sortes : local et chambre froide', () => {
    const d = description('batiment').colonnes.type?.description ?? '';
    expect(d).toMatch(/local/);
    expect(d).toMatch(/chambre_froide/);
    expect(d).toMatch(/hangar/);
  });
});

describe('T61 : fichiers exportés', () => {
  it('chemin.csv : les chemins de la ferme seulement, points en JSON, largeur à virgule', () => {
    const lignes = objetsCsv(lireCsv(contenu(m.construireExport(entree()), 'chemin.csv')));
    expect(lignes.map((l) => l.nom)).toEqual(['Allée centrale', '']);
    expect(JSON.parse(lignes[0]?.points ?? 'null')).toEqual(CHEMIN);
    expect(lignes[0]?.largeur_m).toBe('2,5');
    expect(lignes.some((l) => l.nom === 'Chemin voisin')).toBe(false);
  });

  it('point_plan.csv, lieu_rangement.csv, place_rangement.csv, outil.csv : une ferme, ni plus ni moins', () => {
    const f = m.construireExport(entree());
    const points = objetsCsv(lireCsv(contenu(f, 'point_plan.csv')));
    expect(points.map((l) => l.nom)).toEqual(['Point d’eau du verger']);
    expect(points[0]).toMatchObject({ sorte: 'point_eau', x_m: '12,5', y_m: '-40' });
    const lieux = objetsCsv(lireCsv(contenu(f, 'lieu_rangement.csv')));
    expect(lieux.map((l) => [l.batiment_id, l.point_plan_id])).toEqual([
      [HANGAR, ''],
      ['', EAU],
    ]);
    const places = objetsCsv(lireCsv(contenu(f, 'place_rangement.csv')));
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ lieu_rangement_id: LIEU_HANGAR, nom: 'mur nord' });
    const outils = objetsCsv(lireCsv(contenu(f, 'outil.csv')));
    expect(outils.map((l) => l.nom)).toEqual(['Grelinette', 'Bêche']);
    expect(outils[0]).toMatchObject({ lieu_rangement_id: LIEU_HANGAR, place_rangement_id: MUR_NORD });
    expect(outils[1]?.place_rangement_id).toBe('');
  });

  it('batiment.csv garde la chambre froide', () => {
    const lignes = objetsCsv(lireCsv(contenu(m.construireExport(entree()), 'batiment.csv')));
    expect(lignes.map((l) => l.type)).toEqual(['hangar', 'chambre_froide']);
  });

  it('ferme.json : points décodés, tables typées, aucune ligne d’une autre ferme', () => {
    const json = JSON.parse(contenu(m.construireExport(entree()), 'ferme.json')) as { tables: Record<string, Record<string, unknown>[]> };
    expect(json.tables.chemin).toHaveLength(2);
    expect(json.tables.chemin?.[0]).toMatchObject({ nom: 'Allée centrale', points: CHEMIN, largeur_m: 2.5 });
    expect(json.tables.chemin?.[1]?.nom).toBeNull();
    expect(json.tables.point_plan?.[0]).toMatchObject({ sorte: 'point_eau', x_m: 12.5, y_m: -40 });
    expect(json.tables.outil).toHaveLength(2);
    expect(json.tables.place_rangement).toHaveLength(1);
    expect(json.tables.lieu_rangement).toHaveLength(2);
  });

  it('ferme sans chemin ni outil : cinq fichiers réduits à l’en-tête', () => {
    const e = entree();
    const f = m.construireExport({ ...e, tables: { ferme: e.tables.ferme ?? [] } });
    for (const t of TABLES) {
      const csv = lireCsv(contenu(f, `${t}.csv`));
      expect(csv.lignes, t).toHaveLength(0);
      expect(csv.entete, t).toEqual(Object.keys(description(t).colonnes));
    }
  });

  it('LISEZMOI.txt : un bloc par fichier et les colonnes décrites', () => {
    const texte = contenu(m.construireExport(entree()), 'LISEZMOI.txt');
    for (const t of TABLES) expect(texte, t).toMatch(new RegExp(`^## ${t}\\.csv$`, 'm'));
    for (const c of ['points', 'largeur_m', 'sorte', 'x_m', 'batiment_id', 'point_plan_id', 'lieu_rangement_id', 'place_rangement_id']) {
      expect(texte, c).toMatch(new RegExp(`^- ${c} : `, 'm'));
    }
  });
});
