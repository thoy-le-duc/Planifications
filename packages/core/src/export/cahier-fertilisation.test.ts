/**
 * Tests d'acceptation T54 — l'export gagne `cahier-fertilisation.csv` (docs/backlog/T54-cahier-fertilisation.md,
 * règle 4) : une ligne par apport RÉALISÉ en vigueur de la ferme (fertilisation, amendement), sans
 * les annulés, colonnes en français (COLONNES_CAHIER_FERTILISATION, ../fertilisation/test/contrat.ts),
 * mêmes conventions que les autres CSV (BOM, « ; », virgule décimale). Même contenu par
 * `construireExport` (référence) et par l'archive construite au fil de la lecture. Décrit dans
 * LISEZMOI.txt. La table `produit_fertilisant` est exportée comme les autres (produit_fertilisant.csv).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv } from './test/csv.ts';

let m: ModuleExport;
let colonnes: readonly string[];

beforeAll(async () => {
  m = await chargerExport();
  const coeur = (await import(/* @vite-ignore */ '../index.ts')) as { COLONNES_CAHIER_FERTILISATION?: readonly string[] };
  if (coeur.COLONNES_CAHIER_FERTILISATION === undefined) throw new Error('@planif/core n’exporte pas COLONNES_CAHIER_FERTILISATION (T54)');
  colonnes = coeur.COLONNES_CAHIER_FERTILISATION;
});

const uuid = (n: number): string => `0192f0c1-5455-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const VOISINE = uuid(2);
const P01 = uuid(0x10);
const COMPOST = uuid(0x20);
const A1 = uuid(0x100);
const A2 = uuid(0x101);
const A2_ANNULE = uuid(0x102);
const GENERE_LE = '2027-05-20T08:00:00.000Z';

function apport(id: string, ferme: string, date: string, quantite: number, autres: Record<string, string | null> = {}): LigneLocale {
  return {
    id,
    ferme_id: ferme,
    type: 'intervention',
    date,
    horodatage: `${date}T08:00:00.000Z`,
    auteur_id: uuid(0x900),
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: JSON.stringify([P01]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ categorie: 'amendement', type: 'compost', outil: null, produit: 'Compost de déchets verts', quantite: { valeur: quantite, unite: 't' }, produitFertilisantId: COMPOST }),
    cree_le: GENERE_LE,
    origine_id: id,
    ...autres,
  };
}

function entree(): { fermeId: string; genereLe: string; tables: Record<string, LigneLocale[]> } {
  return {
    fermeId: FERME,
    genereLe: GENERE_LE,
    tables: {
      ferme: [{ id: FERME, nom: 'Jardins de Garonne', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: null, unites: null, zone_vulnerable_nitrates: 0, cree_le: GENERE_LE, modifie_le: GENERE_LE, supprime_le: null }],
      evenement: [
        apport(A1, FERME, '2027-03-10', 2),
        apport(A2, FERME, '2027-03-11', 1),
        apport(A2_ANNULE, FERME, '2027-03-11', 1, { remplace_sorte: 'annulation', remplace_evenement_id: A2, horodatage: '2027-03-11T09:00:00.000Z', origine_id: A2 }),
        apport(uuid(0x103), VOISINE, '2027-03-10', 9),
      ],
      produit_fertilisant: [
        {
          id: COMPOST,
          ferme_id: FERME,
          nom: 'Compost de déchets verts',
          forme: 'solide',
          unite: 't',
          teneur_n: 1,
          teneur_p2o5: 0.5,
          teneur_k2o: null,
          organique: 1,
          utilisable_en_bio: 1,
          source: 'test',
          cree_le: GENERE_LE,
          modifie_le: GENERE_LE,
          supprime_le: null,
        },
      ],
      emplacement: [{ id: P01, ferme_id: FERME, zone_id: uuid(0x50), code: 'T2-P01', sorte: 'planche', longueur_m: 50, largeur_m: 2, nombre_places: null, actif_du: '2026-01-01', actif_au: null, remplace: '[]', placement_x_m: null, placement_y_m: null, orientation_deg: null, cree_le: GENERE_LE, modifie_le: GENERE_LE, supprime_le: null }],
      saison: [{ id: uuid(0x40), ferme_id: FERME, nom: 'Saison 2027', debut: '2027-01-01', fin: '2027-12-31', cree_le: GENERE_LE, modifie_le: GENERE_LE, supprime_le: null }],
    },
  };
}

function fichier(fichiers: readonly { chemin: string; contenu: string }[], chemin: string): string {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin} (présents : ${fichiers.map((x) => x.chemin).join(', ')})`);
  return f.contenu;
}

describe('T54 : cahier-fertilisation.csv dans l’export', () => {
  it('colonnes en français, dont date, emplacements, produit, quantité et unités N, P₂O₅, K₂O par hectare', () => {
    for (const c of ['date', 'saison', 'emplacements', 'surface_m2', 'produit', 'quantite', 'unite', 'organique', 'n_kg', 'n_kg_ha', 'p2o5_kg_ha', 'k2o_kg_ha']) expect(colonnes).toContain(c);
  });

  it('une ligne par apport réalisé en vigueur de la ferme (ni l’annulé, ni la voisine), unités calculées', () => {
    const csv = lireCsv(fichier(m.construireExport(entree()), 'cahier-fertilisation.csv'));
    expect(csv.entete).toEqual(colonnes);
    expect(csv.lignes).toHaveLength(1);
    const l = Object.fromEntries(colonnes.map((c, i) => [c, csv.lignes[0]?.[i]]));
    expect(l).toMatchObject({
      date: '2027-03-10',
      saison: 'Saison 2027',
      emplacements: 'T2-P01',
      surface_m2: '100',
      produit: 'Compost de déchets verts',
      quantite: '2',
      unite: 't',
      organique: 'oui',
      n_kg: '20',
      n_kg_ha: '2000',
      p2o5_kg_ha: '1000',
      k2o_kg_ha: '',
    });
  });

  it('entrée vide : le fichier est là, réduit à son en-tête', () => {
    const csv = lireCsv(fichier(m.construireExport({ fermeId: FERME, genereLe: GENERE_LE, tables: {} }), 'cahier-fertilisation.csv'));
    expect(csv.entete).toEqual(colonnes);
    expect(csv.lignes).toHaveLength(0);
  });

  it('produit_fertilisant.csv : les produits de la ferme, avec leurs teneurs', () => {
    const csv = lireCsv(fichier(m.construireExport(entree()), 'produit_fertilisant.csv'));
    expect(csv.entete).toEqual(expect.arrayContaining(['nom', 'forme', 'unite', 'teneur_n', 'teneur_p2o5', 'teneur_k2o', 'organique', 'utilisable_en_bio', 'source', 'densite_kg_par_l']));
    expect(csv.lignes).toHaveLength(1);
  });

  it('ferme.csv porte l’option « zone vulnérable nitrates »', () => {
    const csv = lireCsv(fichier(m.construireExport(entree()), 'ferme.csv'));
    expect(csv.entete).toContain('zone_vulnerable_nitrates');
  });

  it('LISEZMOI.txt décrit le cahier', () => {
    expect(fichier(m.construireExport(entree()), 'LISEZMOI.txt')).toContain('cahier-fertilisation.csv');
  });

  it('archive construite au fil de la lecture : mêmes octets que creerZip(construireExport)', async () => {
    const options = { date: '2027-05-20' };
    const reference = await m.creerZip(m.construireExport(entree()), options);
    const archive = await m.construireArchive(entree(), options);
    expect(archive.octets).toEqual(reference);
    expect(Object.keys(archive.lignes)).not.toContain('cahier-fertilisation');
  });
});
