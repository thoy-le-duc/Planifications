/**
 * Tests d'acceptation T14 — validation et aperçu : `preparerImport` rend un plan d'import (lignes
 * valides, en erreur avec le motif, à décider, doublons, lignes ignorées) sans rien écrire.
 * Contrat : ./test/contrat.ts. Fichiers : ./__fixtures__/.
 *
 * Chaque fichier du jeu passe ici par tout le chemin : lecture, en-tête détecté, correspondance
 * proposée (sans correction), plan.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chargerImport,
  chargerXlsx,
  type ChoixValeur,
  type Correspondance,
  type EntreeImport,
  type LigneBrute,
  type LignePlan,
  type ModuleImport,
  type PlanImport,
  type TypeContenu,
  type ValeurImport,
} from './test/contrat.ts';
import { BIBLIOTHEQUE, geler, lireFixture, type NomFixture } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

const existante = (id: string) => ({ sorte: 'existante', id }) as const;
const aDecider = (valeur: string) => ({ sorte: 'a_decider', valeur }) as const;

interface Options {
  readonly anneeSaison?: number | null;
  readonly choix?: readonly ChoixValeur[];
}

/** Entrée complète à partir de lignes, avec la correspondance proposée par le moteur. */
function entree(lignes: readonly LigneBrute[], type: TypeContenu, options: Options = {}): EntreeImport {
  const ligneEntete = m.detecterEntete(lignes);
  if (ligneEntete === null) throw new Error('en-tête introuvable');
  const correspondance = m.proposerCorrespondance(lignes[ligneEntete] ?? [], type);
  const base = { lignes, ligneEntete, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: options.anneeSaison ?? null };
  return options.choix === undefined ? base : { ...base, choix: options.choix };
}

async function planFixture(nom: NomFixture, type: TypeContenu, options: Options = {}): Promise<PlanImport> {
  return m.preparerImport(entree(m.lireCsv(await lireFixture(nom)).lignes, type, options));
}

/** Lignes d'un petit CSV écrit dans le test (';', UTF-8). */
function csv(texte: string): readonly (readonly string[])[] {
  return texte.split('\n').map((l) => l.split(';'));
}

function ligne(plan: PlanImport, numero: number): LignePlan {
  const l = plan.lignes.find((x) => x.ligne === numero);
  if (l === undefined) throw new Error(`ligne ${String(numero)} absente du plan`);
  return l;
}

const valide = (numero: number, valeurs: Readonly<Record<string, ValeurImport>>) => ({ ligne: numero, statut: 'valide', valeurs, erreurs: [], doublonDe: null });

// ── Fichiers du jeu de test ──────────────────────────────────────────────────────────────────

describe('parcellaire à trois niveaux (Windows-1252, cellules fusionnées, lignes vides, total)', () => {
  let plan: PlanImport;
  beforeAll(async () => {
    plan = await planFixture('parcellaire-3-niveaux-cp1252.csv', 'parcellaire');
  });

  it('trois niveaux', () => {
    expect(plan.type).toBe('parcellaire');
    expect(plan.niveaux).toBe(3);
  });

  it('zone et chapelle reprises de la ligne au-dessus ; une nouvelle zone efface la chapelle ; virgules décimales et cm convertis', () => {
    const zone = 'Serre multichapelle';
    expect(plan.lignes).toStrictEqual([
      valide(2, { zone, sous_zone: 'Chapelle 1', emplacement: 'C1-P1', longueur_m: 32.5, largeur_m: 0.8, type_abri: 'serre' }),
      valide(3, { zone, sous_zone: 'Chapelle 1', emplacement: 'C1-P2', longueur_m: 32.5, largeur_m: 0.8, type_abri: 'serre' }),
      valide(4, { zone, sous_zone: 'Chapelle 2', emplacement: 'C2-P1', longueur_m: 32.5, largeur_m: 0.75, type_abri: 'serre' }),
      valide(5, { zone, sous_zone: 'Chapelle 2', emplacement: 'C2-P2', longueur_m: 32.5, largeur_m: 0.75, type_abri: 'serre' }),
      valide(7, { zone: 'Îlot Pré-Clos', sous_zone: null, emplacement: 'PC-01', longueur_m: 48, largeur_m: 1.2, type_abri: 'plein_champ' }),
    ]);
  });

  it('lignes vides et ligne de total ignorées, avec le motif', () => {
    expect(plan.ignorees).toStrictEqual([
      { ligne: 6, motif: 'vide' },
      { ligne: 8, motif: 'vide' },
      { ligne: 9, motif: 'total' },
    ]);
    expect(plan.resume).toStrictEqual({ valides: 5, erreurs: 0, aDecider: 0, doublons: 0, ignorees: 3 });
    expect(plan.decisions).toStrictEqual([]);
  });
});

describe('parcellaire à deux niveaux, en-têtes anglais', () => {
  it('Field / Bed : zone et planche, point décimal, « open field » → plein champ', async () => {
    const plan = await planFixture('parcellaire-anglais.csv', 'parcellaire');
    expect(plan.niveaux).toBe(2);
    expect(plan.lignes).toStrictEqual([
      valide(2, { zone: 'North field', emplacement: 'N1', longueur_m: 30, largeur_m: 0.8, type_abri: 'plein_champ' }),
      valide(3, { zone: 'North field', emplacement: 'N2', longueur_m: 30, largeur_m: 0.8, type_abri: 'plein_champ' }),
      valide(4, { zone: 'Tunnel A', emplacement: 'TA1', longueur_m: 25.5, largeur_m: 1.2, type_abri: 'tunnel' }),
      valide(5, { zone: 'Tunnel A', emplacement: 'TA2', longueur_m: 25.5, largeur_m: 1.2, type_abri: 'tunnel' }),
    ]);
  });
});

describe('séries en semaines : une ligne invalide ne bloque pas les autres', () => {
  let plan: PlanImport;
  beforeAll(async () => {
    plan = await planFixture('series-semaines.tsv', 'series', { anneeSaison: 2027 });
  });

  it('semaines S10, sem 12, Semaine 14 converties avec l’année de la saison', () => {
    expect(ligne(plan, 2)).toStrictEqual(
      valide(2, {
        espece: existante('esp-laitue'),
        variete: 'Batavia blonde de Paris',
        emplacement: 'N1',
        date_semis: '2027-03-08',
        date_plantation: '2027-04-05',
        date_debut_recolte: '2027-05-17',
        longueur_m: 30,
      }),
    );
    expect(ligne(plan, 4)).toStrictEqual(
      valide(4, {
        espece: existante('esp-tomate'),
        variete: 'Cœur de bœuf',
        emplacement: 'TA1',
        date_semis: null,
        date_plantation: '2027-05-03',
        date_debut_recolte: '2027-07-12',
        longueur_m: 25.5,
      }),
    );
  });

  it('culture inconnue « Batavia blonde » : ligne à décider, décision demandée avec batavia en tête', () => {
    expect(ligne(plan, 3)).toStrictEqual({
      ligne: 3,
      statut: 'a_decider',
      valeurs: {
        espece: aDecider('Batavia blonde'),
        variete: 'Grenobloise',
        emplacement: 'N2',
        date_semis: '2027-03-22',
        date_plantation: '2027-04-19',
        date_debut_recolte: '2027-05-31',
        longueur_m: 30,
      },
      erreurs: [],
      doublonDe: null,
    });
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]).toMatchObject({ champ: 'espece', valeur: 'Batavia blonde', lignes: [3] });
    expect(plan.decisions[0]?.propositions[0]?.id).toBe('esp-batavia');
  });

  it('longueur « abc » : erreur nombre_invalide sur la colonne 6, avec un motif en français', () => {
    const l = ligne(plan, 5);
    expect(l.statut).toBe('erreur');
    expect(l.erreurs).toHaveLength(1);
    expect(l.erreurs[0]).toMatchObject({ code: 'nombre_invalide', champ: 'longueur_m', colonne: 6 });
    expect(l.erreurs[0]?.message.length).toBeGreaterThan(5);
    expect(l.erreurs[0]?.message.length).toBeLessThanOrEqual(200);
  });

  it('S53 n’existe pas en 2027 : erreur date_invalide sur le semis', () => {
    const l = ligne(plan, 7);
    expect(l.statut).toBe('erreur');
    expect(l.erreurs.map((e) => [e.code, e.champ, e.colonne])).toStrictEqual([['date_invalide', 'date_semis', 3]]);
  });

  it('ligne 6 identique à la ligne 4 : doublon', () => {
    expect(ligne(plan, 6)).toMatchObject({ statut: 'doublon', doublonDe: 4 });
  });

  it('résumé de l’aperçu', () => {
    expect(plan.lignes.map((l) => l.ligne)).toStrictEqual([2, 3, 4, 5, 6, 7]);
    expect(plan.resume).toStrictEqual({ valides: 2, erreurs: 2, aDecider: 1, doublons: 1, ignorees: 0 });
  });

  it('sans année de saison : chaque semaine est en erreur annee_manquante, les autres lignes passent', async () => {
    const sans = await planFixture('series-semaines.tsv', 'series');
    expect(ligne(sans, 2).erreurs.map((e) => e.code)).toStrictEqual(['annee_manquante', 'annee_manquante', 'annee_manquante']);
    expect(ligne(sans, 2).erreurs.map((e) => e.champ)).toStrictEqual(['date_semis', 'date_plantation', 'date_debut_recolte']);
  });
});

describe('décisions sur les valeurs', () => {
  it('choix « existante » : la ligne devient valide, plus de décision ; valeur comparée sans casse ni accents', async () => {
    const plan = await planFixture('series-semaines.tsv', 'series', {
      anneeSaison: 2027,
      choix: [{ champ: 'espece', valeur: 'batavia BLONDE', decision: existante('esp-batavia') }],
    });
    expect(ligne(plan, 3)).toMatchObject({ statut: 'valide', valeurs: { espece: existante('esp-batavia') } });
    expect(plan.decisions).toStrictEqual([]);
    expect(plan.resume.aDecider).toBe(0);
  });

  it('choix « nouvelle » : la culture sera créée sous le nom choisi', async () => {
    const plan = await planFixture('series-semaines.tsv', 'series', {
      anneeSaison: 2027,
      choix: [{ champ: 'espece', valeur: 'Batavia blonde', decision: { sorte: 'nouvelle', nom: 'Batavia blonde' } }],
    });
    expect(ligne(plan, 3)).toMatchObject({ statut: 'valide', valeurs: { espece: { sorte: 'nouvelle', nom: 'Batavia blonde' } } });
  });

  it('une décision par valeur, avec toutes ses lignes', () => {
    const plan = m.preparerImport(entree(csv('Culture;Planche;Semis\nBatavia blonde;N1;03/04/2027\nRutabaga;N2;03/04/2027\nbatavia  Blonde;N3;03/04/2027'), 'series'));
    expect(plan.decisions.map((d) => [d.champ, d.valeur, d.lignes])).toStrictEqual([
      ['espece', 'Batavia blonde', [2, 4]],
      ['espece', 'Rutabaga', [3]],
    ]);
    expect(plan.decisions[1]?.propositions).toStrictEqual([]);
  });
});

describe('cultures et itinéraires, assolement passé', () => {
  it('cultures : familles, modes, durées, cm et g', async () => {
    const plan = await planFixture('cultures-itineraires.csv', 'cultures');
    expect(plan.niveaux).toBeNull();
    expect(plan.lignes).toStrictEqual([
      valide(2, {
        espece: existante('esp-laitue'),
        famille: existante('fam-asteracees'),
        mode: 'plant_maison',
        duree_pepiniere_jours: 28,
        duree_avant_recolte_jours: 45,
        fenetre_recolte_jours: 21,
        rangs_par_planche: 3,
        ecartement_cm: 30,
        poids_mille_graines_g: 0.9,
      }),
      valide(3, {
        espece: existante('esp-carotte'),
        famille: existante('fam-apiacees'),
        mode: 'semis_direct',
        duree_pepiniere_jours: null,
        duree_avant_recolte_jours: 90,
        fenetre_recolte_jours: 60,
        rangs_par_planche: 4,
        ecartement_cm: null,
        poids_mille_graines_g: 1.2,
      }),
      valide(4, {
        espece: existante('esp-tomate'),
        famille: existante('fam-solanacees'),
        mode: 'plant_achete',
        duree_pepiniere_jours: null,
        duree_avant_recolte_jours: 60,
        fenetre_recolte_jours: 90,
        rangs_par_planche: 2,
        ecartement_cm: 50,
        poids_mille_graines_g: null,
      }),
      valide(5, {
        espece: existante('esp-poireau'),
        famille: existante('fam-alliacees'),
        mode: 'plant_maison',
        duree_pepiniere_jours: 70,
        duree_avant_recolte_jours: 120,
        fenetre_recolte_jours: 60,
        rangs_par_planche: 4,
        ecartement_cm: 12,
        poids_mille_graines_g: 2.8,
      }),
    ]);
  });

  it('assolement : colonnes en trop ignorées, colonnes dans le désordre', async () => {
    const plan = await planFixture('assolement-passe.csv', 'assolement');
    expect(plan.lignes).toStrictEqual([
      valide(2, { annee: 2024, famille: existante('fam-solanacees'), emplacement: 'TA1', espece: existante('esp-tomate') }),
      valide(3, { annee: 2024, famille: existante('fam-brassicacees'), emplacement: 'N1', espece: existante('esp-chou') }),
      valide(4, { annee: 2025, famille: existante('fam-asteracees'), emplacement: 'N1', espece: existante('esp-laitue') }),
      valide(5, { annee: 2023, famille: existante('fam-cucurbitacees'), emplacement: 'N2', espece: existante('esp-courgette') }),
    ]);
  });
});

describe('classeur Excel à ligne de titre', () => {
  it('dates Excel, date en texte, « 1500 cm », ligne vide et total ignorés ; numéros de ligne d’Excel', async () => {
    const { lecteurXlsx } = await chargerXlsx();
    const r = await lecteurXlsx.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(r.message);
    const plan = m.preparerImport(entree(r.feuilles[0]?.lignes ?? [], 'series', { anneeSaison: 2027 }));
    expect(plan.lignes).toStrictEqual([
      valide(4, {
        espece: existante('esp-radis'),
        variete: 'Flamboyant 5',
        emplacement: 'N3',
        date_semis: '2027-03-15',
        date_plantation: null,
        date_debut_recolte: '2027-04-19',
        date_fin_recolte: '2027-05-10',
        longueur_m: 30,
      }),
      valide(5, {
        espece: existante('esp-epinard'),
        variete: "Géant d'hiver",
        emplacement: 'N4',
        date_semis: '2027-03-15',
        date_plantation: null,
        date_debut_recolte: '2027-05-10',
        date_fin_recolte: '2027-06-01',
        longueur_m: 15,
      }),
      valide(6, {
        espece: existante('esp-tomate'),
        variete: 'Cœur de bœuf',
        emplacement: 'TA2',
        date_semis: null,
        date_plantation: '2027-05-10',
        date_debut_recolte: '2027-07-15',
        date_fin_recolte: null,
        longueur_m: 25.5,
      }),
    ]);
    expect(plan.ignorees).toStrictEqual([
      { ligne: 7, motif: 'vide' },
      { ligne: 8, motif: 'total' },
    ]);
  });
});

// ── Règles, sur de petits tableaux ───────────────────────────────────────────────────────────

describe('hiérarchie du parcellaire', () => {
  it('un seul niveau : des zones', () => {
    const plan = m.preparerImport(entree(csv('Parcelle;Surface (m²);Abri\nPré du bas;1200;plein champ\nGrand tunnel;400;tunnel'), 'parcellaire'));
    expect(plan.niveaux).toBe(1);
    expect(plan.lignes).toStrictEqual([
      valide(2, { zone: 'Pré du bas', surface_m2: 1200, type_abri: 'plein_champ' }),
      valide(3, { zone: 'Grand tunnel', surface_m2: 400, type_abri: 'tunnel' }),
    ]);
  });

  it('zone vide sur la première ligne (rien à reprendre) → champ_manquant', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche\n;P1\nT1;P2\n;P3'), 'parcellaire'));
    expect(ligne(plan, 2).erreurs.map((e) => [e.code, e.champ, e.colonne])).toStrictEqual([['champ_manquant', 'zone', 0]]);
    expect(ligne(plan, 4)).toStrictEqual(valide(4, { zone: 'T1', emplacement: 'P3' }));
  });

  it('même zone et même planche (casse ignorée) → doublon de la première', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur\nT1;P1;30\nT2;P1;30\nt1;p1;25'), 'parcellaire'));
    expect(ligne(plan, 3).statut).toBe('valide');
    expect(ligne(plan, 4)).toMatchObject({ statut: 'doublon', doublonDe: 2 });
  });

  it('nombre dans un champ texte (classeur) → son écriture', () => {
    const plan = m.preparerImport(entree([['Zone', 'Planche', 'Longueur'], ['T1', 3, 30], [2, 12.5, '30']], 'parcellaire'));
    expect(plan.lignes).toStrictEqual([valide(2, { zone: 'T1', emplacement: '3', longueur_m: 30 }), valide(3, { zone: '2', emplacement: '12.5', longueur_m: 30 })]);
  });
});

describe('lignes ignorées', () => {
  it('vides (espaces compris) et totaux : « TOTAL général », « Sous-total », « Somme » ; « Totalement » n’est pas un total', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur\nT1;P1;30\n  ; ;\nTOTAL général;;30\nSous-total;;30\nSomme;;30\nTotalement bio;P2;20'), 'parcellaire'));
    expect(plan.ignorees).toStrictEqual([
      { ligne: 3, motif: 'vide' },
      { ligne: 4, motif: 'total' },
      { ligne: 5, motif: 'total' },
      { ligne: 6, motif: 'total' },
    ]);
    expect(plan.lignes.map((l) => [l.ligne, l.statut])).toStrictEqual([
      [2, 'valide'],
      [7, 'valide'],
    ]);
  });

  it('les lignes au-dessus de l’en-tête ne sont ni lues ni comptées', () => {
    const plan = m.preparerImport(entree([['Parcellaire 2027'], [], ['Zone', 'Planche'], ['T1', 'P1']], 'parcellaire'));
    expect(plan.lignes).toStrictEqual([valide(4, { zone: 'T1', emplacement: 'P1' })]);
    expect(plan.ignorees).toStrictEqual([]);
  });
});

describe('erreurs de ligne', () => {
  it('toutes les erreurs d’une ligne sont listées, dans l’ordre des colonnes', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur;Largeur;Abri\nT1;P1;-3;abc;sous bâche'), 'parcellaire'));
    expect(ligne(plan, 2).erreurs.map((e) => [e.code, e.champ, e.colonne])).toStrictEqual([
      ['hors_bornes', 'longueur_m', 2],
      ['nombre_invalide', 'largeur_m', 3],
      ['valeur_inconnue', 'type_abri', 4],
    ]);
    for (const e of ligne(plan, 2).erreurs) {
      expect(e.message.trim().length).toBeGreaterThan(5);
      expect(e.message.length).toBeLessThanOrEqual(200);
    }
  });

  it('longueur nulle → hors_bornes ; unité d’une autre grandeur → unite_inconnue', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur\nT1;P1;0\nT1;P2;3 kg'), 'parcellaire'));
    expect(ligne(plan, 2).erreurs.map((e) => e.code)).toStrictEqual(['hors_bornes']);
    expect(ligne(plan, 3).erreurs.map((e) => e.code)).toStrictEqual(['unite_inconnue']);
  });

  it('entiers : nombre de plants à virgule, 0 rang, année 1850', () => {
    const series = m.preparerImport(entree(csv('Culture;Plantation;Nombre de plants\nTomate;03/05/2027;12,5'), 'series'));
    expect(ligne(series, 2).erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['nombre_invalide', 'nombre_plants']]);
    const cultures = m.preparerImport(entree(csv('Culture;Rangs\nTomate;0'), 'cultures'));
    expect(ligne(cultures, 2).erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['hors_bornes', 'rangs_par_planche']]);
    const assolement = m.preparerImport(entree(csv('Année;Planche;Famille\n1850;N1;Solanacées'), 'assolement'));
    expect(ligne(assolement, 2).erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['hors_bornes', 'annee']]);
  });

  it('série sans aucune date → champ_manquant (champ null)', () => {
    const plan = m.preparerImport(entree(csv('Culture;Planche;Semis\nTomate;N1;'), 'series'));
    expect(ligne(plan, 2).erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['champ_manquant', null]]);
  });

  it('assolement sans zone ni planche → champ_manquant', () => {
    const plan = m.preparerImport(entree(csv('Année;Planche;Famille\n2024;;Solanacées'), 'assolement'));
    expect(ligne(plan, 2).erreurs.map((e) => e.code)).toStrictEqual(['champ_manquant']);
  });

  it('champ obligatoire associé à aucune colonne → chaque ligne en champ_manquant, colonne null', () => {
    const lignes = csv('Planche;Longueur\nP1;30\nP2;25');
    const correspondance: Correspondance = { type: 'parcellaire', colonnes: [{ champ: 'emplacement', unite: null }, { champ: 'longueur_m', unite: 'm' }] };
    const plan = m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: null });
    expect(plan.lignes.map((l) => l.erreurs.map((e) => [e.code, e.champ, e.colonne]))).toStrictEqual([[['champ_manquant', 'zone', null]], [['champ_manquant', 'zone', null]]]);
    expect(plan.resume.erreurs).toBe(2);
  });
});

describe('rien n’est écrit : fonction pure', () => {
  it('entrée gelée en profondeur : pas d’exception, même plan à chaque appel', async () => {
    const lignes = m.lireCsv(await lireFixture('series-semaines.tsv')).lignes;
    const e = geler(entree(lignes.map((l) => [...l]), 'series', { anneeSaison: 2027, choix: [{ champ: 'espece', valeur: 'Batavia blonde', decision: existante('esp-batavia') }] }));
    const premier = m.preparerImport(e);
    expect(m.preparerImport(e)).toStrictEqual(premier);
  });

  it('ne lève jamais : cellules énormes, correspondance plus longue ou plus courte que les lignes', () => {
    const lignes: LigneBrute[] = [['Zone', 'Planche'], ['x'.repeat(100_000), 'P1', 'en trop'], ['T1'], [Number.NaN, Number.POSITIVE_INFINITY]];
    const correspondance: Correspondance = {
      type: 'parcellaire',
      colonnes: [
        { champ: 'zone', unite: null },
        { champ: 'emplacement', unite: null },
        { champ: 'longueur_m', unite: 'm' },
      ],
    };
    expect(() => m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: null })).not.toThrow();
  });
});
