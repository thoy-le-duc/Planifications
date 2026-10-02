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
  type AvertissementImport,
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
import { classeurSimple } from './test/classeur.ts';
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
      { debut: 6, fin: 6, motif: 'vide' },
      { debut: 8, fin: 8, motif: 'vide' },
      { debut: 9, fin: 9, motif: 'total' },
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
      { debut: 7, fin: 7, motif: 'vide' },
      { debut: 8, fin: 8, motif: 'total' },
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
  // 2e relecture, point 3 : les lignes ignorées sont regroupées en plages ({ debut, fin, motif }
  // au lieu de { ligne, motif }), pour qu'un million de lignes vides ne fasse pas un million
  // d'entrées. Les cas sont inchangés ; les totaux 4 à 6, qui se suivent, forment une plage.
  // Relecture, point 10 : ce test ne voyait « Somme » qu'en total. Il garde ses cas et ajoute
  // « Somme;P3;30 » : avec une planche, « Somme » est un nom de zone (le département, la
  // rivière), pas un total ; la ligne est importée.
  it('vides (espaces compris) et totaux : « TOTAL général », « Sous-total », « Somme » sans planche ; « Totalement » n’est pas un total', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur\nT1;P1;30\n  ; ;\nTOTAL général;;30\nSous-total;;30\nSomme;;30\nTotalement bio;P2;20\nSomme;P3;30'), 'parcellaire'));
    expect(plan.ignorees).toStrictEqual([
      { debut: 3, fin: 3, motif: 'vide' },
      { debut: 4, fin: 6, motif: 'total' },
    ]);
    expect(plan.resume.ignorees).toBe(4);
    expect(plan.lignes.map((l) => [l.ligne, l.statut])).toStrictEqual([
      [2, 'valide'],
      [7, 'valide'],
      [8, 'valide'],
    ]);
    expect(ligne(plan, 8).valeurs).toStrictEqual({ zone: 'Somme', emplacement: 'P3', longueur_m: 30 });
  });

  it('seule la première cellule non vide des colonnes associées est examinée', () => {
    // Notes (colonne 3) n'est associée à rien : « Total à revoir » ne fait pas ignorer la ligne.
    const plan = m.preparerImport(entree(csv('Zone;Planche;Longueur;Notes\nT1;P1;30;Total à revoir\nT1;Total;25;\n;Total;30;\nTotal;;55;'), 'parcellaire'));
    expect(plan.ignorees).toStrictEqual([{ debut: 4, fin: 5, motif: 'total' }]);
    expect(plan.lignes.map((l) => [l.ligne, l.statut])).toStrictEqual([
      [2, 'valide'],
      [3, 'valide'],
    ]);
    expect(ligne(plan, 3).valeurs).toStrictEqual({ zone: 'T1', emplacement: 'Total', longueur_m: 25 });
  });

  it('« Somme » sans colonne emplacement associée : total', () => {
    const plan = m.preparerImport(entree(csv('Culture;Rangs\nTomate;2\nSomme;2'), 'cultures'));
    expect(plan.ignorees).toStrictEqual([{ debut: 3, fin: 3, motif: 'total' }]);
  });

  it('plages : lignes qui se suivent avec le même motif ; une ligne gardée ou un autre motif coupe la plage (2e relecture)', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche\n;\n;\n;\nT1;P1\n;\nTotal;\nTotal;\n;\n;'), 'parcellaire'));
    expect(plan.ignorees).toStrictEqual([
      { debut: 2, fin: 4, motif: 'vide' },
      { debut: 6, fin: 6, motif: 'vide' },
      { debut: 7, fin: 8, motif: 'total' },
      { debut: 9, fin: 10, motif: 'vide' },
    ]);
    expect(plan.resume.ignorees).toBe(8);
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

// ── Relecture du chef d'équipe ───────────────────────────────────────────────────────────────

const codes = (l: LignePlan) => l.erreurs.map((e) => [e.code, e.champ, e.colonne]);

describe('unités de conversion de l’en-tête (relecture, point 4)', () => {
  it('Surface (ha) → m², conversion exacte', () => {
    const plan = m.preparerImport(entree(csv('Parcelle;Surface (ha)\nPré du bas;1,5\nBois;0,25\nJardin;0,0123'), 'parcellaire'));
    expect(plan.lignes.map((l) => l.valeurs.surface_m2)).toStrictEqual([15_000, 2_500, 123]);
  });

  it('Durée pépinière (semaines) → jours × 7 ; une demi-semaine n’est pas un nombre entier de jours', () => {
    const plan = m.preparerImport(entree(csv('Culture;Durée pépinière (semaines);Fenêtre de récolte (sem)\nTomate;4;3\nPoireau;1,5;2'), 'cultures'));
    expect(ligne(plan, 2).valeurs).toMatchObject({ duree_pepiniere_jours: 28, fenetre_recolte_jours: 21 });
    expect(codes(ligne(plan, 3))).toStrictEqual([['nombre_invalide', 'duree_pepiniere_jours', 1]]);
  });
});

describe('numéros de série Excel hors de la saison (relecture, point 5)', () => {
  it('une quantité (12, 420) dans une colonne date → date_invalide ; une vraie date de la saison passe', () => {
    const plan = m.preparerImport(entree([['Culture', 'Plantation'], ['Tomate', 12], ['Chou', 420], ['Radis', 46461]], 'series', { anneeSaison: 2027 }));
    expect(codes(ligne(plan, 2))).toStrictEqual([['date_invalide', 'date_plantation', 1]]);
    expect(codes(ligne(plan, 3))).toStrictEqual([['date_invalide', 'date_plantation', 1]]);
    expect(ligne(plan, 4).valeurs.date_plantation).toBe('2027-03-15');
  });

  it('numéro d’une autre décennie que la saison → date_invalide', () => {
    const plan = m.preparerImport(entree([['Culture', 'Plantation'], ['Tomate', 44561], ['Chou', 44562]], 'series', { anneeSaison: 2027 }));
    expect(codes(ligne(plan, 2))).toStrictEqual([['date_invalide', 'date_plantation', 1]]);
    expect(ligne(plan, 3).valeurs.date_plantation).toBe('2022-01-01');
  });
});

describe('système de dates 1904 (relecture, point 6)', () => {
  it('EntreeImport.systemeDates = 1904 : 44999 → 2027-03-15 ; défaut 1900', () => {
    const lignes = [['Culture', 'Plantation'], ['Tomate', 44999]];
    expect(m.preparerImport({ ...entree(lignes, 'series', { anneeSaison: 2027 }), systemeDates: 1904 }).lignes[0]?.valeurs.date_plantation).toBe('2027-03-15');
    expect(m.preparerImport(entree(lignes, 'series', { anneeSaison: 2027 })).lignes[0]?.valeurs.date_plantation).toBe('2023-03-14');
  });

  it('classeur au système 1904 : de la feuille au plan, les dates sont justes', async () => {
    const { lecteurXlsx } = await chargerXlsx();
    const xml =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Culture</t></is></c><c r="B1" t="inlineStr"><is><t>Plantation</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Tomate</t></is></c><c r="B2"><v>44999</v></c></row>';
    const r = await lecteurXlsx.lire(classeurSimple(xml, 'date1904="1"'));
    if (!r.ok) throw new Error(r.message);
    const feuille = r.feuilles[0];
    if (feuille === undefined) throw new Error('pas de feuille');
    const plan = m.preparerImport({ ...entree(feuille.lignes, 'series', { anneeSaison: 2027 }), systemeDates: feuille.systemeDates });
    expect(plan.lignes).toStrictEqual([valide(2, { espece: existante('esp-tomate'), date_plantation: '2027-03-15' })]);
  });

  it('cellule date ISO (t="d") d’un classeur : lue comme une date', async () => {
    const { lecteurXlsx } = await chargerXlsx();
    const xml =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Culture</t></is></c><c r="B1" t="inlineStr"><is><t>Plantation</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Tomate</t></is></c><c r="B2" t="d"><v>2027-05-10T00:00:00</v></c></row>';
    const r = await lecteurXlsx.lire(classeurSimple(xml));
    if (!r.ok) throw new Error(r.message);
    const plan = m.preparerImport(entree(r.feuilles[0]?.lignes ?? [], 'series', { anneeSaison: 2027 }));
    expect(plan.lignes).toStrictEqual([valide(2, { espece: existante('esp-tomate'), date_plantation: '2027-05-10' })]);
  });
});

describe('dates JJ/MM ou MM/JJ, décidé par colonne', () => {
  it('en-têtes anglais, dates américaines : chaque colonne a une valeur qui tranche → MM/JJ', async () => {
    const plan = await planFixture('series-anglais.csv', 'series', { anneeSaison: 2027 });
    expect(plan.lignes).toStrictEqual([
      valide(2, {
        espece: existante('esp-radis'),
        variete: 'Flamboyant 5',
        emplacement: 'N3',
        date_semis: '2027-03-15',
        date_plantation: null,
        date_debut_recolte: '2027-04-19',
        date_fin_recolte: '2027-05-10',
      }),
      valide(3, {
        espece: existante('esp-tomate'),
        variete: 'Coeur de boeuf',
        emplacement: 'TA2',
        date_semis: '2027-02-20',
        date_plantation: '2027-05-10',
        date_debut_recolte: '2027-07-15',
        date_fin_recolte: '2027-10-30',
      }),
      valide(4, {
        espece: existante('esp-laitue'),
        variete: 'Grenobloise',
        emplacement: 'N1',
        date_semis: '2027-03-01',
        date_plantation: '2027-03-29',
        date_debut_recolte: '2027-05-20',
        date_fin_recolte: '2027-06-10',
      }),
    ]);
  });

  it('colonne sans valeur qui tranche → JJ/MM (défaut français) ; une colonne ne décide pas pour sa voisine', () => {
    const plan = m.preparerImport(entree(csv('Culture;Semis;Plantation\nTomate;02/03/2027;04/13/2027\nChou;05/03/2027;05/10/2027'), 'series'));
    expect(ligne(plan, 2).valeurs).toMatchObject({ date_semis: '2027-03-02', date_plantation: '2027-04-13' });
    expect(ligne(plan, 3).valeurs).toMatchObject({ date_semis: '2027-03-05', date_plantation: '2027-05-10' });
  });

  it('colonne qui contient les deux (13/01 et 01/13) → JJ/MM, la valeur impossible est date_invalide', () => {
    const plan = m.preparerImport(entree(csv('Culture;Plantation\nTomate;13/01/2027\nChou;01/13/2027'), 'series'));
    expect(ligne(plan, 2).valeurs.date_plantation).toBe('2027-01-13');
    expect(codes(ligne(plan, 3))).toStrictEqual([['date_invalide', 'date_plantation', 1]]);
  });
});

describe('champs à choix : jamais une propriété héritée (relecture, point 7)', () => {
  it.each(['constructor', '__proto__', 'toString', 'Constructor'])('« %s » → valeur_inconnue', (valeur) => {
    const parcellaire = m.preparerImport(entree(csv(`Zone;Planche;Abri;Sorte\nT1;P1;${valeur};planche\nT1;P2;tunnel;${valeur}`), 'parcellaire'));
    expect(codes(ligne(parcellaire, 2))).toStrictEqual([['valeur_inconnue', 'type_abri', 2]]);
    expect(codes(ligne(parcellaire, 3))).toStrictEqual([['valeur_inconnue', 'sorte', 3]]);
    const cultures = m.preparerImport(entree(csv(`Culture;Mode\nTomate;${valeur}`), 'cultures'));
    expect(codes(ligne(cultures, 2))).toStrictEqual([['valeur_inconnue', 'mode', 1]]);
  });
});

describe('choix d’un modèle dont l’identifiant n’est plus dans la bibliothèque (relecture, point 8)', () => {
  it('la ligne repasse « à décider », la décision est redemandée', async () => {
    const plan = await planFixture('series-semaines.tsv', 'series', {
      anneeSaison: 2027,
      choix: [{ champ: 'espece', valeur: 'Batavia blonde', decision: existante('esp-supprimee') }],
    });
    expect(ligne(plan, 3)).toMatchObject({ statut: 'a_decider', valeurs: { espece: aDecider('Batavia blonde') } });
    expect(plan.decisions.map((d) => [d.champ, d.valeur, d.lignes])).toStrictEqual([['espece', 'Batavia blonde', [3]]]);
    expect(plan.decisions[0]?.propositions[0]?.id).toBe('esp-batavia');
  });

  it('famille : même règle', () => {
    const plan = m.preparerImport(
      entree(csv('Année;Planche;Famille\n2024;N1;Solanacées'), 'assolement', { choix: [{ champ: 'famille', valeur: 'Solanacées', decision: existante('fam-inconnue') }] }),
    );
    expect(ligne(plan, 2).valeurs.famille).toStrictEqual(existante('fam-solanacees'));
  });
});

describe('dates d’une série dans le désordre (relecture, point 9)', () => {
  it('plantation avant le semis → dates_incoherentes sur la plantation', () => {
    const plan = m.preparerImport(entree(csv('Culture;Semis;Plantation;Début récolte;Fin récolte\nTomate;10/04/2027;03/04/2027;01/07/2027;30/09/2027'), 'series'));
    expect(codes(ligne(plan, 2))).toStrictEqual([['dates_incoherentes', 'date_plantation', 2]]);
    expect(ligne(plan, 2).statut).toBe('erreur');
    expect(ligne(plan, 2).erreurs[0]?.message.length).toBeGreaterThan(5);
  });

  it('fin de récolte avant le début → sur la fin ; dates absentes sautées ; une seule erreur par ligne', () => {
    const plan = m.preparerImport(
      entree(csv('Culture;Semis;Plantation;Début récolte;Fin récolte\nTomate;;03/05/2027;01/07/2027;30/06/2027\nChou;10/05/2027;;01/05/2027;\nRadis;10/05/2027;01/05/2027;01/04/2027;01/03/2027'), 'series'),
    );
    expect(codes(ligne(plan, 2))).toStrictEqual([['dates_incoherentes', 'date_fin_recolte', 4]]);
    expect(codes(ligne(plan, 3))).toStrictEqual([['dates_incoherentes', 'date_debut_recolte', 3]]);
    expect(codes(ligne(plan, 4))).toStrictEqual([['dates_incoherentes', 'date_plantation', 2]]);
  });

  it('dates égales ou dans l’ordre : valide (semis direct : semis = plantation)', () => {
    const plan = m.preparerImport(entree(csv('Culture;Semis;Plantation;Début récolte;Fin récolte\nRadis;10/04/2027;10/04/2027;15/05/2027;15/05/2027'), 'series'));
    expect(ligne(plan, 2).statut).toBe('valide');
  });

  it('semaines de la saison dans le désordre (récolte en S10 d’une plantation en S40) : passe à l’année suivante, plus une erreur (T14d, Q18)', () => {
    const plan = m.preparerImport(entree(csv('Culture;Plantation;Début récolte\nPoireau;S40;S10'), 'series', { anneeSaison: 2027 }));
    expect(ligne(plan, 2).statut).toBe('valide');
    expect(ligne(plan, 2).valeurs).toMatchObject({ date_plantation: '2027-10-04', date_debut_recolte: '2028-03-06' });
  });
});

describe('cellules au-delà des colonnes de l’en-tête (relecture, point 11)', () => {
  it('cellule non vide à droite de l’en-tête → colonnes_en_trop sur la première ; vides ou espaces : rien', () => {
    const plan = m.preparerImport(entree([['Zone', 'Planche', null], ['T1', 'P1', null, 'oubli', 'autre'], ['T1', 'P2', '', '  '], ['T1', 'P3', 12]], 'parcellaire'));
    expect(codes(ligne(plan, 2))).toStrictEqual([['colonnes_en_trop', null, 3]]);
    expect(ligne(plan, 3).statut).toBe('valide');
    expect(codes(ligne(plan, 4))).toStrictEqual([['colonnes_en_trop', null, 2]]);
  });

  it('largeur de l’en-tête : jusqu’à sa dernière cellule non vide, même ignorée', () => {
    const plan = m.preparerImport(entree(csv('Zone;Planche;Notes;;\nT1;P1;à revoir;;\nT1;P2;;x;'), 'parcellaire'));
    expect(ligne(plan, 2).statut).toBe('valide');
    expect(codes(ligne(plan, 3))).toStrictEqual([['colonnes_en_trop', null, 3]]);
  });
});

describe('messages : l’extrait cité ne coupe jamais une paire de substitution', () => {
  const orphelin = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('valeur d’abri faite de lettres et d’émojis, coupée à toutes les positions', () => {
    for (let n = 30; n <= 45; n++) {
      const valeur = `${'a'.repeat(n)}${'🌱'.repeat(20)}`;
      const plan = m.preparerImport(entree(csv(`Zone;Planche;Abri\nT1;P1;${valeur}`), 'parcellaire'));
      const e = ligne(plan, 2).erreurs[0];
      expect(e?.code).toBe('valeur_inconnue');
      expect(orphelin.test(e?.message ?? ''), `${String(n)} lettres : ${e?.message ?? ''}`).toBe(false);
      expect(e?.message.length).toBeLessThanOrEqual(200);
    }
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

describe('textes, choix et références de plus de 200 caractères (2e relecture, point 2)', () => {
  const a200 = 'a'.repeat(200);
  const a201 = 'a'.repeat(201);
  const codes = (l: LignePlan) => l.erreurs.map((e) => [e.code, e.champ, e.colonne]);

  it('texte : 200 caractères (espaces autour retirés) passent, 201 → texte_trop_long', () => {
    const plan = m.preparerImport(entree([['Zone', 'Planche'], [`  ${a200}  `, 'P1'], ['T1', a201]], 'parcellaire'));
    expect(ligne(plan, 2)).toStrictEqual(valide(2, { zone: a200, emplacement: 'P1' }));
    expect(ligne(plan, 3).statut).toBe('erreur');
    expect(codes(ligne(plan, 3))).toStrictEqual([['texte_trop_long', 'emplacement', 1]]);
  });

  it('choix de plus de 200 caractères → texte_trop_long, pas valeur_inconnue', () => {
    const plan = m.preparerImport(entree([['Zone', 'Abri', 'Sorte'], ['T1', `tunnel ${a201}`, 'planche'], ['T2', 'tunnel', `planche${a201}`]], 'parcellaire'));
    expect(codes(ligne(plan, 2))).toStrictEqual([['texte_trop_long', 'type_abri', 1]]);
    expect(codes(ligne(plan, 3))).toStrictEqual([['texte_trop_long', 'sorte', 2]]);
  });

  it('référence de plus de 200 caractères → texte_trop_long, aucune décision demandée', () => {
    const plan = m.preparerImport(entree([['Culture', 'Famille', 'Variété'], [`Tomate ${a201}`, 'Solanacées', 'Cœur de bœuf'], ['Tomate', a201, `Noire ${a201}`]], 'cultures'));
    expect(codes(ligne(plan, 2))).toStrictEqual([['texte_trop_long', 'espece', 0]]);
    expect(ligne(plan, 3).erreurs.map((e) => [e.code, e.champ, e.colonne]).sort()).toStrictEqual([
      ['texte_trop_long', 'famille', 1],
      ['texte_trop_long', 'variete', 2],
    ]);
    expect(plan.decisions).toStrictEqual([]);
    expect(plan.resume).toMatchObject({ erreurs: 2, aDecider: 0 });
  });

  it('les messages restent courts (200 caractères au plus)', () => {
    const plan = m.preparerImport(entree([['Zone', 'Planche'], ['a'.repeat(5_000), 'b'.repeat(5_000)]], 'parcellaire'));
    const erreurs = ligne(plan, 2).erreurs;
    expect(erreurs.length).toBeGreaterThan(0);
    for (const e of erreurs) expect(e.message.length).toBeLessThanOrEqual(200);
  });
});

describe('dates en numéros de semaine : « Semis (sem.) » (2e relecture)', () => {
  const entetes = ['Culture', 'Semis (sem.)', 'Plantation (semaine)', 'Harvest start (week)'];

  it('un entier de 1 à 53 est le lundi de la semaine ISO de la saison ; « S12 » et « 15/03/2027 » se lisent comme d’habitude', () => {
    const plan = m.preparerImport(
      entree(
        [
          entetes,
          ['Tomate', '10', 14, '28'],
          ['Laitue', 'S12', '15/04/2027', 20],
        ],
        'series',
        { anneeSaison: 2027 },
      ),
    );
    expect(ligne(plan, 2)).toStrictEqual(valide(2, { espece: existante('esp-tomate'), date_semis: '2027-03-08', date_plantation: '2027-04-05', date_debut_recolte: '2027-07-12' }));
    expect(ligne(plan, 3)).toStrictEqual(valide(3, { espece: existante('esp-laitue'), date_semis: '2027-03-22', date_plantation: '2027-04-15', date_debut_recolte: '2027-05-17' }));
  });

  it('semaine à virgule, qui n’existe pas (53 en 2027, 0) → date_invalide ; sans saison → annee_manquante', () => {
    const plan = m.preparerImport(entree([entetes, ['Tomate', '10,5', '53', '0']], 'series', { anneeSaison: 2027 }));
    expect(ligne(plan, 2).erreurs.map((e) => [e.code, e.champ]).sort()).toStrictEqual([
      ['date_invalide', 'date_debut_recolte'],
      ['date_invalide', 'date_plantation'],
      ['date_invalide', 'date_semis'],
    ]);
    const sans = m.preparerImport(entree([entetes, ['Tomate', '10', '', '']], 'series'));
    expect(ligne(sans, 2).erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['annee_manquante', 'date_semis']]);
  });
});

// ── 3e relecture ─────────────────────────────────────────────────────────────────────────────

describe('correspondance qui associe un champ à deux colonnes : erreur explicite (3e relecture, point 5)', () => {
  const entreeDoublee = (lignes: readonly LigneBrute[], colonnes: Correspondance['colonnes'], type: TypeContenu): EntreeImport => ({
    lignes,
    ligneEntete: 0,
    correspondance: { type, colonnes },
    bibliotheque: BIBLIOTHEQUE,
    anneeSaison: 2027,
  });

  it('emplacement sur deux colonnes : chaque ligne en champ_en_double (colonne = la deuxième), rien de lu en silence', () => {
    const lignes = csv('Zone;Planche;N° planche;Longueur\nT1;P1;P9;30\nT1;P2;;25\n;;;\nTotal;;;55');
    const plan = m.preparerImport(
      entreeDoublee(
        lignes,
        [
          { champ: 'zone', unite: null },
          { champ: 'emplacement', unite: null },
          { champ: 'emplacement', unite: null },
          { champ: 'longueur_m', unite: 'm' },
        ],
        'parcellaire',
      ),
    );
    expect(plan.lignes.map((l) => [l.ligne, l.statut, codes(l)])).toStrictEqual([
      [2, 'erreur', [['champ_en_double', 'emplacement', 2]]],
      [3, 'erreur', [['champ_en_double', 'emplacement', 2]]],
    ]);
    expect(plan.lignes[0]?.erreurs[0]?.message.trim().length).toBeGreaterThan(10);
    expect(plan.resume).toStrictEqual({ valides: 0, erreurs: 2, aDecider: 0, doublons: 0, ignorees: 2 });
  });

  it('deux champs doublés (dont un sur trois colonnes) : une erreur par champ, colonne = la deuxième qui le porte', () => {
    const plan = m.preparerImport(
      entreeDoublee(
        [
          ['Culture', 'Espèce', 'Semis', 'Date de semis', 'Légume'],
          ['Tomate', 'Tomate', '15/03/2027', '15/03/2027', 'Tomate'],
        ],
        [
          { champ: 'espece', unite: null },
          { champ: 'espece', unite: null },
          { champ: 'date_semis', unite: null },
          { champ: 'date_semis', unite: null },
          { champ: 'espece', unite: null },
        ],
        'series',
      ),
    );
    const erreurs = ligne(plan, 2)
      .erreurs.filter((e) => e.code === 'champ_en_double')
      .sort((a, b) => (a.colonne ?? 0) - (b.colonne ?? 0))
      .map((e) => [e.code, e.champ, e.colonne]);
    expect(erreurs).toStrictEqual([
      ['champ_en_double', 'espece', 1],
      ['champ_en_double', 'date_semis', 3],
    ]);
    expect(ligne(plan, 2).statut).toBe('erreur');
  });
});

// ── T14d : saison à cheval sur deux années (Q18) ─────────────────────────────────────────────

describe('T14d — une semaine qui retombe avant la précédente : année suivante, signalée dans l’aperçu', () => {
  const ENTETE = 'Culture;Semis;Plantation;Début récolte;Fin récolte';
  const plan = (lignes: string, anneeSaison: number | null = 2027) => m.preparerImport(entree(csv(`${ENTETE}\n${lignes}`), 'series', { anneeSaison }));
  const avertissements = (l: LignePlan): readonly AvertissementImport[] => l.avertissements ?? [];

  it('1. S40 → S2 → S20 (saison 2027) : semis 2027, plantation et récolte 2028 ; un avertissement « plantation en 2028 », pas d’erreur', () => {
    const l = ligne(plan('Tomate;S40;S2;S20;'), 2);
    expect(l.erreurs).toStrictEqual([]);
    expect(l.statut).toBe('valide');
    expect(l.valeurs).toMatchObject({ date_semis: '2027-10-04', date_plantation: '2028-01-10', date_debut_recolte: '2028-05-15' });
    // Un seul avertissement, à l'endroit où l'année change (la plantation) ; la récolte, qui suit
    // dans la même année, n'en ajoute pas.
    expect(avertissements(l)).toStrictEqual([{ code: 'annee_suivante', champ: 'date_plantation', colonne: 2, annee: 2028, message: expect.stringMatching(/plantation.*2028/i) as string }]);
  });

  it('1 bis. même chose avec quatre dates, et avec des numéros de semaine nus dans des colonnes « (sem.) »', () => {
    const quatre = ligne(plan('Tomate;S40;S2;S20;S30'), 2);
    expect(quatre.valeurs).toMatchObject({ date_semis: '2027-10-04', date_plantation: '2028-01-10', date_debut_recolte: '2028-05-15', date_fin_recolte: '2028-07-24' });
    expect(avertissements(quatre).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2028]]);

    const nus = m.preparerImport(entree([['Culture', 'Semis (sem.)', 'Plantation (semaine)', 'Harvest start (week)'], ['Tomate', 40, '2', 20]], 'series', { anneeSaison: 2027 }));
    expect(ligne(nus, 2).statut).toBe('valide');
    expect(ligne(nus, 2).valeurs).toMatchObject({ date_semis: '2027-10-04', date_plantation: '2028-01-10', date_debut_recolte: '2028-05-15' });
    expect(avertissements(ligne(nus, 2)).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2028]]);
  });

  it('1 ter. le résumé compte la ligne comme valide ; l’aperçu garde les autres lignes intactes', () => {
    const p = plan('Tomate;S40;S2;S20;\nChou;S10;S20;S30;');
    expect(p.resume).toMatchObject({ valides: 2, erreurs: 0 });
    expect(ligne(p, 3).statut).toBe('valide');
    expect(ligne(p, 3).avertissements).toBeUndefined();
  });

  it('2a. passage au milieu : S50 → S52 → S1 → la récolte tombe en 2028, avertissement sur la récolte', () => {
    const l = ligne(plan('Chou;S50;S52;S1;'), 2);
    expect(l.erreurs).toStrictEqual([]);
    expect(l.valeurs).toMatchObject({ date_semis: '2027-12-13', date_plantation: '2027-12-27', date_debut_recolte: '2028-01-03' });
    expect(avertissements(l).map((a) => [a.code, a.champ, a.colonne, a.annee])).toStrictEqual([['annee_suivante', 'date_debut_recolte', 3, 2028]]);
    expect(avertissements(l)[0]?.message).toMatch(/2028/);
  });

  it('2b. même semaine deux fois (S1 → S1) : pas de changement d’année, pas d’avertissement', () => {
    const l = ligne(plan('Radis;S1;S1;S1;'), 2);
    expect(l.statut).toBe('valide');
    expect(l.valeurs).toMatchObject({ date_semis: '2027-01-04', date_plantation: '2027-01-04', date_debut_recolte: '2027-01-04' });
    expect(l.avertissements).toBeUndefined();
  });

  it('2c. témoin : S10 → S20 → S30, aucun changement, aucun avertissement', () => {
    const l = ligne(plan('Tomate;S10;S20;S30;'), 2);
    expect(l.statut).toBe('valide');
    expect(l.valeurs).toMatchObject({ date_semis: '2027-03-08', date_plantation: '2027-05-17', date_debut_recolte: '2027-07-26' });
    expect(l.avertissements).toBeUndefined();
  });

  it('dates complètes dans le désordre : toujours dates_incoherentes (l’année est écrite, rien à deviner)', () => {
    const l = ligne(plan('Tomate;10/10/2027;05/01/2027;;'), 2);
    expect(codes(l)).toStrictEqual([['dates_incoherentes', 'date_plantation', 2]]);
    expect(l.statut).toBe('erreur');
  });

  it('3. S40 → S2 → S45 : plus de 52 semaines en tout → dates_incoherentes sur la date qui dépasse (début de récolte), pas d’année devinée', () => {
    const l = ligne(plan('Tomate;S40;S2;S45;'), 2);
    expect(l.statut).toBe('erreur');
    expect(codes(l)).toStrictEqual([['dates_incoherentes', 'date_debut_recolte', 3]]);
    expect(l.erreurs[0]?.message.length).toBeGreaterThan(5);
  });

  it('3 bis. deux retombées (S40 → S10 → S5) : il faudrait deux années de plus → dates_incoherentes sur la troisième date', () => {
    const l = ligne(plan('Tomate;S40;S10;S5;'), 2);
    expect(l.statut).toBe('erreur');
    expect(codes(l)).toStrictEqual([['dates_incoherentes', 'date_debut_recolte', 3]]);
  });

  it('3 ter. borne : 52 semaines pile (S40 2027 → S40 2028) passe, 53 semaines (S41 2028) reste en erreur', () => {
    const pile = ligne(plan('Tomate;S40;S2;S40;'), 2);
    expect(pile.erreurs).toStrictEqual([]);
    expect(pile.valeurs).toMatchObject({ date_semis: '2027-10-04', date_debut_recolte: '2028-10-02' });
    expect(ligne(plan('Tomate;S40;S2;S41;'), 2).statut).toBe('erreur');
    expect(codes(ligne(plan('Tomate;S40;S2;S41;'), 2))).toStrictEqual([['dates_incoherentes', 'date_debut_recolte', 3]]);
  });

  it('4a. 2026 a 53 semaines : S53 → S1 passe à 2027 (semis lundi 28/12/2026, plantation lundi 04/01/2027), signalé', () => {
    const l = ligne(plan('Tomate;S53;S1;;', 2026), 2);
    expect(l.erreurs).toStrictEqual([]);
    expect(l.valeurs).toMatchObject({ date_semis: '2026-12-28', date_plantation: '2027-01-04' });
    expect(avertissements(l).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2027]]);
  });

  it('4b. 2027 n’a que 52 semaines : S53 reste date_invalide, comme avant (et S52 → S1 y passe à 2028)', () => {
    const l = ligne(plan('Tomate;S53;S1;;', 2027), 2);
    expect(l.statut).toBe('erreur');
    expect(codes(l)).toStrictEqual([['date_invalide', 'date_semis', 1]]);
    expect(l.avertissements).toBeUndefined();

    const ok = ligne(plan('Tomate;S52;S1;;', 2027), 2);
    expect(ok.valeurs).toMatchObject({ date_semis: '2027-12-27', date_plantation: '2028-01-03' });
    expect(avertissements(ok).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2028]]);
  });

  it('sans année de saison : annee_manquante comme avant, rien n’est deviné', () => {
    const l = ligne(plan('Tomate;S40;S2;;', null), 2);
    expect(l.erreurs.map((e) => e.code)).toContain('annee_manquante');
    expect(l.avertissements).toBeUndefined();
  });

  it('retouche 1. saison 2025, S50 → S1 : la plantation est le lundi 2025-12-29, semaine 1 de 2026 → l’avertissement dit 2026 (année de la semaine, pas de la date civile)', () => {
    const l = ligne(plan('Tomate;S50;S1;;', 2025), 2);
    expect(l.erreurs).toStrictEqual([]);
    expect(l.valeurs).toMatchObject({ date_semis: '2025-12-08', date_plantation: '2025-12-29' });
    expect(avertissements(l).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2026]]);
    expect(avertissements(l)[0]?.message).toMatch(/2026/);
    expect(avertissements(l)[0]?.message).not.toMatch(/2025/);
  });

  it('retouche 2. message exact : « plantation en 2028 » (libellé court, sans « date de »)', () => {
    const l = ligne(plan('Tomate;S40;S2;;'), 2);
    expect(avertissements(l).map((a) => a.message)).toStrictEqual(['plantation en 2028']);
  });

  it('retouche 3. témoin : une ligne en erreur n’a pas de champ avertissements', () => {
    for (const saisie of ['Tomate;S40;S2;S45;', 'Tomate;S40;S10;S5;', 'Tomate;S40;S2;S41;']) {
      const l = ligne(plan(saisie), 2);
      expect(l.statut).toBe('erreur');
      expect(l.avertissements).toBeUndefined();
    }
  });

  it('retouche 4. témoin : semis en date complète 15/10/2027 + plantation S2 → plantation 2028-01-10, avertissement sur la plantation', () => {
    const l = ligne(plan('Tomate;15/10/2027;S2;;'), 2);
    expect(l.erreurs).toStrictEqual([]);
    expect(l.valeurs).toMatchObject({ date_semis: '2027-10-15', date_plantation: '2028-01-10' });
    expect(avertissements(l).map((a) => [a.champ, a.annee])).toStrictEqual([['date_plantation', 2028]]);
  });

  it('retouche 5. témoin : saison 2026 (53 semaines), S40 2026 → S2 → S40 de 2027 = 371 jours, plus de 52 semaines → erreur', () => {
    const l = ligne(plan('Tomate;S40;S2;S40;', 2026), 2);
    expect(l.statut).toBe('erreur');
    expect(codes(l)).toStrictEqual([['dates_incoherentes', 'date_debut_recolte', 3]]);
    expect(l.avertissements).toBeUndefined();
  });

  it('fonction pure : entrée gelée, même plan à chaque appel', () => {
    const e = geler(entree(csv(`${ENTETE}\nTomate;S40;S2;S20;`), 'series', { anneeSaison: 2027 }));
    expect(m.preparerImport(e)).toStrictEqual(m.preparerImport(e));
  });
});
