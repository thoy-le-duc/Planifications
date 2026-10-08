/**
 * Tests d'acceptation T32a — export du profil de croissance (docs/backlog/T32a-croissance-profils.md,
 * « Réglage par la ferme, stockage validé (Q32, option A) ») : colonne `profil_croissance` de
 * `espece` dans l'export JSON et CSV, décrite dans LISEZMOI.txt. Contrat de l'export :
 * ./test/contrat.ts (T15).
 *
 * Colonne attendue : espece.profil_croissance, type d'export 'json' (texte JSON dans le CSV,
 * objet dans ferme.json, vide / null quand la ferme n'a rien réglé : profil par défaut). Sa
 * description dit que vide = profil par défaut, et ce qu'elle porte (hauteur, croissance).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerExport, type DescriptionTable, type LigneLocale, type ModuleExport } from './test/contrat.ts';
import { lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;

beforeAll(async () => {
  m = await chargerExport();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-a320-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const FAMILLE = uuid(2);
const TOMATE = uuid(3);
const LAITUE = uuid(4);
const VOISINE = uuid(5);
const BIBLIO = uuid(6);
const CREE = '2026-10-08T08:00:00.000Z';

const PROFIL = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 85 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
};

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

function espece(id: string, ferme: string | null, nom: string, profil: string | null): LigneLocale {
  return {
    id,
    ferme_id: ferme,
    famille_id: FAMILLE,
    nom,
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'kg',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
    profil_croissance: profil,
    cree_le: CREE,
    modifie_le: CREE,
    supprime_le: null,
  };
}

function entree(): { fermeId: string; genereLe: string; tables: Record<string, LigneLocale[]> } {
  return {
    fermeId: FERME,
    genereLe: CREE,
    tables: {
      espece: [
        espece(TOMATE, FERME, 'Tomate', JSON.stringify(PROFIL)),
        espece(LAITUE, FERME, 'Laitue', null),
        // Une autre ferme : son profil n'apparaît jamais.
        espece(VOISINE, uuid(99), 'Tomate', JSON.stringify({ ...PROFIL, hauteurMaxM: 2.4 })),
        // Bibliothèque commune : pas de profil réglé (les défauts sont dans le code).
        espece(BIBLIO, null, 'Tomate', null),
      ],
    },
  };
}

describe('T32a : profil_croissance dans la liste blanche de l’export', () => {
  it('espece.profil_croissance : colonne JSON', () => {
    expect(description('espece').colonnes.profil_croissance?.type).toBe('json');
  });

  it('description en français : vide = profil par défaut ; hauteur de la culture', () => {
    const texte = description('espece').colonnes.profil_croissance?.description ?? '';
    expect(texte).toMatch(/défaut/i);
    expect(texte).toMatch(/hauteur|croissance/i);
  });
});

describe('T32a : fichiers exportés', () => {
  it('espece.csv : profil réglé en texte JSON, vide sinon ; jamais celui d’une autre ferme', () => {
    const fichiers = m.construireExport(entree());
    const lignes = objetsCsv(lireCsv(contenu(fichiers, 'espece.csv')));
    expect(lignes.map((l) => l.id)).toEqual([TOMATE, LAITUE]);
    expect(JSON.parse(lignes[0]?.profil_croissance ?? 'null')).toEqual(PROFIL);
    expect(lignes[1]?.profil_croissance).toBe('');
    expect(fichiers.map((f) => f.contenu).join('\n')).not.toContain(VOISINE);
  });

  it('bibliotheque/espece.csv : la colonne est là, vide', () => {
    const fichiers = m.construireExport(entree());
    const lignes = objetsCsv(lireCsv(contenu(fichiers, 'bibliotheque/espece.csv')));
    expect(lignes.map((l) => l.id)).toEqual([BIBLIO]);
    expect(lignes[0]?.profil_croissance).toBe('');
  });

  it('ferme.json : profil décodé en objet, null sans réglage', () => {
    const json = JSON.parse(contenu(m.construireExport(entree()), 'ferme.json')) as { tables: Record<string, Record<string, unknown>[]> };
    const especes = json.tables.espece ?? [];
    expect(especes.find((l) => l.id === TOMATE)?.profil_croissance).toEqual(PROFIL);
    expect(especes.find((l) => l.id === LAITUE)?.profil_croissance).toBeNull();
    expect(especes.some((l) => l.id === VOISINE)).toBe(false);
  });

  it('ferme exportée sans aucun profil réglé : colonne présente dans l’en-tête, vide partout', () => {
    const e = entree();
    const sans = { ...e, tables: { espece: (e.tables.espece ?? []).map((l) => ({ ...l, profil_croissance: null })) } };
    const csv = lireCsv(contenu(m.construireExport(sans), 'espece.csv'));
    expect(csv.entete).toContain('profil_croissance');
    expect(objetsCsv(csv).map((l) => l.profil_croissance)).toEqual(['', '']);
  });

  it('LISEZMOI.txt : la colonne profil_croissance est décrite', () => {
    const texte = contenu(m.construireExport(entree()), 'LISEZMOI.txt');
    expect(texte).toMatch(/^- profil_croissance : /m);
  });
});
