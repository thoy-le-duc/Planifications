/**
 * Tests d'acceptation T88 — export complet : les trois colonnes de la grille d'une serre sont exportées
 * (docs/backlog/T88-serre-en-grille-modele.md, règle 6 et critère « Export complet »).
 *
 *   batiment  + nb_chapelles (entier), nb_troncons (entier), largeur_allee_m (reel), décrites pour LISEZMOI.txt
 *             (la description dit l'unité, mètres, et que les dimensions d'une case se déduisent du bâtiment).
 * Contrat de l'export : ./test/contrat.ts (T15). Les colonnes nulles s'exportent vides (CSV) ou nulles (JSON).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;
beforeAll(async () => {
  m = await chargerExport();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-a880-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const CREE = '2026-10-30T08:00:00.000Z';
const horo = { cree_le: CREE, modifie_le: CREE, supprime_le: null };

const batiment = (id: string, nom: string, fermeId: string, grille: Readonly<Record<string, unknown>>): LigneLocale => ({
  id,
  ferme_id: fermeId,
  nom,
  type: 'serre_chapelle',
  longueur_m: 128.8,
  largeur_m: 57.6,
  hauteur_m: 5,
  centre_x_m: 0,
  centre_y_m: 0,
  orientation_deg: 0,
  zone_id: null,
  ...grille,
  ...horo,
});

function entree() {
  return {
    fermeId: FERME,
    genereLe: CREE,
    tables: {
      ferme: [{ id: FERME, nom: 'Ferme de Benoît', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: null, unites: '{"longueur":"m","masse":"kg"}', ...horo }],
      batiment: [
        batiment(uuid(2), 'Serre à légumes', FERME, { nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 }),
        batiment(uuid(3), 'Tunnel Manon', FERME, { nb_chapelles: null, nb_troncons: null, largeur_allee_m: null }),
        // Une autre ferme : jamais exportée.
        batiment(uuid(4), 'Serre voisine', uuid(99), { nb_chapelles: 2, nb_troncons: 2, largeur_allee_m: 1 }),
      ] as LigneLocale[],
    },
  };
}

const contenu = (fichiers: readonly { chemin: string; contenu: string }[], chemin: string): string => {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin}`);
  return f.contenu;
};

describe('T88 : la grille de la serre dans l’export', () => {
  it('liste blanche : les trois colonnes de batiment, avec leur type', () => {
    const colonnes = m.TABLES_EXPORTEES.batiment?.colonnes ?? {};
    expect(colonnes.nb_chapelles?.type).toBe('entier');
    expect(colonnes.nb_troncons?.type).toBe('entier');
    expect(colonnes.largeur_allee_m?.type).toBe('reel');
    expect(colonnes.largeur_allee_m?.description).toMatch(/mètres/i);
    expect(colonnes.nb_chapelles?.description).toMatch(/chapelle/i);
    expect(colonnes.nb_troncons?.description).toMatch(/tronçon/i);
  });

  it('batiment.csv : colonnes présentes, valeurs à virgule, vides quand la grille est nulle, ferme voisine absente', () => {
    const fichiers = m.construireExport(entree());
    const csv = lireCsv(contenu(fichiers, 'batiment.csv'));
    for (const c of ['nb_chapelles', 'nb_troncons', 'largeur_allee_m']) expect(csv.entete, c).toContain(c);
    const lignes = objetsCsv(csv);
    expect(lignes.map((l) => l.nom)).toEqual(['Serre à légumes', 'Tunnel Manon']);
    expect(lignes[0]).toMatchObject({ nb_chapelles: '6', nb_troncons: '3', largeur_allee_m: '4,4' });
    expect(lignes[1]).toMatchObject({ nb_chapelles: '', nb_troncons: '', largeur_allee_m: '' });
  });

  it('ferme.json : nombres typés, nuls pour une serre sans grille', () => {
    const json = JSON.parse(contenu(m.construireExport(entree()), 'ferme.json')) as { tables: Record<string, Record<string, unknown>[]> };
    expect(json.tables.batiment?.[0]).toMatchObject({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 });
    expect(json.tables.batiment?.[1]).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it('LISEZMOI.txt : les trois colonnes sont décrites', () => {
    const texte = contenu(m.construireExport(entree()), 'LISEZMOI.txt');
    for (const c of ['nb_chapelles', 'nb_troncons', 'largeur_allee_m']) expect(texte, c).toContain(c);
  });
});
