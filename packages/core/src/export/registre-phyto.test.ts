/**
 * Tests d'acceptation T52 — l'export gagne `registre-phyto.csv` (docs/backlog/T52-registre-phyto.md,
 * règle 6) : une ligne par traitement EN VIGUEUR de la ferme, sans les annulés, colonnes en
 * français (COLONNES_REGISTRE_PHYTO, ../phyto/test/contrat.ts), mêmes conventions que les autres
 * CSV (BOM, « ; », virgule décimale). Même contenu par `construireExport` (référence) et par
 * l'archive construite au fil de la lecture (`construireArchive`). Décrit dans LISEZMOI.txt.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv } from './test/csv.ts';

let m: ModuleExport;
let colonnes: readonly string[];

beforeAll(async () => {
  m = await chargerExport();
  const coeur = (await import(/* @vite-ignore */ '../index.ts')) as { COLONNES_REGISTRE_PHYTO?: readonly string[] };
  if (coeur.COLONNES_REGISTRE_PHYTO === undefined) throw new Error('@planif/core n’exporte pas COLONNES_REGISTRE_PHYTO (T52)');
  colonnes = coeur.COLONNES_REGISTRE_PHYTO;
});

const uuid = (n: number): string => `0192f0c1-5254-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const VOISINE = uuid(2);
const P01 = uuid(0x10);
const BOUILLIE = uuid(0x20);
const SERIE = uuid(0x30);
const TOMATE = uuid(0x40);
const T1 = uuid(0x100);
const T2 = uuid(0x101);
const T2_ANNULE = uuid(0x102);
const GENERE_LE = '2027-05-20T08:00:00.000Z';

function traitement(id: string, ferme: string, date: string, autres: Record<string, string | null> = {}, dose = 2.5): LigneLocale {
  return {
    id,
    ferme_id: ferme,
    type: 'traitement',
    date,
    horodatage: `${date}T08:00:00.000Z`,
    auteur_id: uuid(0x900),
    source: 'tap',
    serie_id: SERIE,
    campagne_id: null,
    emplacement_ids: JSON.stringify([P01]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: dose, unite: 'L/ha' }, surfaceTraiteeM2: 24.5, cible: '=mildiou; oïdium', operateur: 'Théo', recolteAutoriseeLe: '2027-05-13' }),
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
      ferme: [{ id: FERME, nom: 'Jardins de Garonne', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: null, unites: null, cree_le: GENERE_LE, modifie_le: GENERE_LE, supprime_le: null }],
      evenement: [
        traitement(T1, FERME, '2027-05-10'),
        traitement(T2, FERME, '2027-05-11', {}, 1),
        traitement(T2_ANNULE, FERME, '2027-05-11', { remplace_sorte: 'annulation', remplace_evenement_id: T2, horodatage: '2027-05-11T09:00:00.000Z', origine_id: T2 }, 1),
        traitement(uuid(0x103), VOISINE, '2027-05-10'),
      ],
      produit_phyto: [
        {
          id: BOUILLIE,
          ferme_id: FERME,
          nom_commercial: 'Bouillie bordelaise RSR',
          numero_amm: '9300417',
          substance_active: 'cuivre',
          delai_avant_recolte_jours: 3,
          utilisable_en_bio: 1,
          dose_maximale: null,
          cree_le: GENERE_LE,
          modifie_le: GENERE_LE,
          supprime_le: null,
        },
      ],
      emplacement: [{ id: P01, ferme_id: FERME, zone_id: uuid(0x50), code: 'T2-P01', sorte: 'planche', longueur_m: 30, largeur_m: 0.8, nombre_places: null, actif_du: '2026-01-01', actif_au: null, remplace: '[]', placement_x_m: null, placement_y_m: null, orientation_deg: null, cree_le: GENERE_LE, modifie_le: GENERE_LE, supprime_le: null }],
      serie: [{ id: SERIE, ferme_id: FERME, espece_id: TOMATE, variete_id: null }],
      espece: [{ id: TOMATE, ferme_id: null, nom: 'Tomate' }],
    },
  };
}

function fichier(fichiers: readonly { chemin: string; contenu: string }[], chemin: string): string {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin} (présents : ${fichiers.map((x) => x.chemin).join(', ')})`);
  return f.contenu;
}

describe('T52 : registre-phyto.csv dans l’export', () => {
  it('présent, en-tête en français, une ligne par traitement en vigueur de la ferme, sans les annulés', () => {
    const csv = lireCsv(fichier(m.construireExport(entree()), 'registre-phyto.csv'));
    expect(csv.entete).toEqual(colonnes);
    expect(csv.lignes).toHaveLength(1);
    const ligne = Object.fromEntries(csv.entete.map((c, i) => [c, csv.lignes[0]?.[i] ?? '']));
    expect(ligne).toMatchObject({
      date: '2027-05-10',
      produit: 'Bouillie bordelaise RSR',
      amm: '9300417',
      dose: '2,5',
      surface_traitee_m2: '24,5',
      emplacements: 'T2-P01',
      culture: 'Tomate',
      // Neutralisée comme toute cellule qui ressemble à une formule ; point-virgule protégé.
      cible: "'=mildiou; oïdium",
      operateur: 'Théo',
      recolte_autorisee_le: '2027-05-13',
    });
    // L'événement de la voisine n'apparaît nulle part.
    expect(fichier(m.construireExport(entree()), 'registre-phyto.csv')).not.toContain(uuid(0x103));
  });

  it('entrée vide : le fichier est là, réduit à son en-tête', () => {
    const csv = lireCsv(fichier(m.construireExport({ fermeId: FERME, genereLe: GENERE_LE, tables: {} }), 'registre-phyto.csv'));
    expect(csv.entete).toEqual(colonnes);
    expect(csv.lignes).toHaveLength(0);
  });

  it('les tables restent intactes : evenement.csv garde toutes les lignes de la ferme (annulation comprise)', () => {
    const csv = lireCsv(fichier(m.construireExport(entree()), 'evenement.csv'));
    expect(csv.lignes).toHaveLength(3);
  });

  it('LISEZMOI.txt décrit le registre', () => {
    const texte = fichier(m.construireExport(entree()), 'LISEZMOI.txt');
    expect(texte).toContain('registre-phyto.csv');
  });

  it('archive construite au fil de la lecture : mêmes octets que creerZip(construireExport)', async () => {
    const options = { date: '2027-05-20' };
    const reference = await m.creerZip(m.construireExport(entree()), options);
    const archive = await m.construireArchive(entree(), options);
    expect(archive.octets).toEqual(reference);
    // `lignes` ne compte que les tables (inchangé).
    expect(Object.keys(archive.lignes)).not.toContain('registre-phyto');
  });
});
