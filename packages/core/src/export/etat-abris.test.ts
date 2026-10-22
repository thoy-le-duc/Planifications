/**
 * Tests d'acceptation T58 — export complet (principe : tout est exportable, CLAUDE.md n°5) :
 * la liste d'équipements d'une zone (`zone.equipements_abri`, json) et les changements d'état
 * (événements `etat_abri` dans `evenement.csv`, détail en JSON). Contrat de l'export : ./test/
 * contrat.ts (T15).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type DescriptionTable, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;

beforeAll(async () => {
  m = await chargerExport();
});

const uuid = (n: number): string => `0192f0c1-5858-7cc3-a280-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const SERRE = uuid(2);
const TUNNEL = uuid(3);
const CREE = '2026-10-22T08:00:00.000Z';
const horodatage = { cree_le: CREE, modifie_le: CREE, supprime_le: null };

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

const DETAIL = { zoneId: SERRE, equipement: 'ouvrants_lateraux', actif: true };

function entree(): { fermeId: string; genereLe: string; tables: Record<string, LigneLocale[]> } {
  return {
    fermeId: FERME,
    genereLe: CREE,
    tables: {
      ferme: [{ id: FERME, nom: 'Ferme de Benoît', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: null, unites: '{"longueur":"m","masse":"kg"}', ...horodatage }],
      zone: [
        { id: SERRE, ferme_id: FERME, nom: 'Serre 1', zone_parente_id: null, type_abri: 'serre', surface_m2: 300, contour: null, equipements_abri: JSON.stringify(['ouvrants_lateraux', 'portes', 'chauffage']), ...horodatage },
        { id: TUNNEL, ferme_id: FERME, nom: 'Tunnel 3', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 200, contour: null, equipements_abri: null, ...horodatage },
      ],
      evenement: [
        {
          id: uuid(10),
          ferme_id: FERME,
          type: 'etat_abri',
          date: '2026-10-22',
          horodatage: '2026-10-22T07:00:00.000Z',
          auteur_id: uuid(5),
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: '[]',
          note: null,
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify(DETAIL),
          cree_le: CREE,
          origine_id: null,
        },
        // L'annulation est exportée aussi : l'historique n'est jamais réécrit.
        {
          id: uuid(11),
          ferme_id: FERME,
          type: 'etat_abri',
          date: '2026-10-22',
          horodatage: '2026-10-22T07:01:00.000Z',
          auteur_id: uuid(5),
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: '[]',
          note: null,
          photos: '[]',
          remplace_sorte: 'annulation',
          remplace_evenement_id: uuid(10),
          detail: JSON.stringify(DETAIL),
          cree_le: CREE,
          origine_id: uuid(10),
        },
        // Un événement d'une autre ferme : jamais exporté.
        {
          id: uuid(12),
          ferme_id: uuid(99),
          type: 'etat_abri',
          date: '2026-10-22',
          horodatage: '2026-10-22T07:00:00.000Z',
          auteur_id: uuid(98),
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: '[]',
          note: null,
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify({ ...DETAIL, zoneId: uuid(97) }),
          cree_le: CREE,
          origine_id: null,
        },
      ],
    },
  };
}

describe('T58 : colonnes dans la liste blanche', () => {
  it('zone.equipements_abri : colonne json, après contour, décrite en français', () => {
    const d = description('zone');
    expect(d.colonnes.equipements_abri?.type).toBe('json');
    const noms = Object.keys(d.colonnes);
    expect(noms.indexOf('equipements_abri')).toBeGreaterThan(noms.indexOf('contour'));
    const texte = d.colonnes.equipements_abri?.description ?? '';
    expect(texte).toMatch(/équipements/i);
    expect(texte).toMatch(/ouvrants|portes|chauffage|voile/i);
    expect(texte).toMatch(/type d.abri|par défaut/i);
  });

  it('evenement.type : la description cite l’état des serres', () => {
    expect(description('evenement').colonnes.type?.description ?? '').toMatch(/état des serres|état des abris/i);
    expect(description('evenement').colonnes.detail?.description ?? '').toMatch(/ouvrants|équipement|serre/i);
  });
});

describe('T58 : fichiers exportés', () => {
  it('zone.csv : la liste d’équipements en JSON, vide quand la zone prend le défaut de son type', () => {
    const zones = objetsCsv(lireCsv(contenu(m.construireExport(entree()), 'zone.csv')));
    expect(JSON.parse(zones[0]?.equipements_abri ?? 'null')).toEqual(['ouvrants_lateraux', 'portes', 'chauffage']);
    expect(zones[1]?.equipements_abri).toBe('');
  });

  it('evenement.csv : les changements d’état et leur annulation, ceux de la ferme seulement', () => {
    const evenements = objetsCsv(lireCsv(contenu(m.construireExport(entree()), 'evenement.csv')));
    expect(evenements.map((e) => [e.id, e.type, e.remplace_sorte])).toEqual([
      [uuid(10), 'etat_abri', ''],
      [uuid(11), 'etat_abri', 'annulation'],
    ]);
    expect(JSON.parse(evenements[0]?.detail ?? 'null')).toEqual(DETAIL);
  });

  it('ferme.json : équipements et détail décodés', () => {
    const json = JSON.parse(contenu(m.construireExport(entree()), 'ferme.json')) as { tables: Record<string, Record<string, unknown>[]> };
    expect(json.tables.zone?.[0]?.equipements_abri).toEqual(['ouvrants_lateraux', 'portes', 'chauffage']);
    expect(json.tables.zone?.[1]?.equipements_abri).toBeNull();
    expect(json.tables.evenement).toHaveLength(2);
    expect(json.tables.evenement?.[0]?.detail).toEqual(DETAIL);
  });

  it('LISEZMOI.txt : la nouvelle colonne est décrite', () => {
    expect(contenu(m.construireExport(entree()), 'LISEZMOI.txt')).toMatch(/^- equipements_abri : /m);
  });
});
