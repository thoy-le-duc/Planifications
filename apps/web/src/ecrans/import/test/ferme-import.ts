/**
 * Ferme de test de T14b (« ferme de l'import ») : une ferme presque neuve, où l'on importe les
 * fichiers du jeu de T14 (packages/core/src/import/__fixtures__/) et la ferme complète de T07
 * exportée en tableur. Format du schéma local de @planif/sync (snake_case, texte JSON), dates
 * fixes.
 *
 * Utilisée par les tests d'écran (base mémoire) et par /diagnostic/amorcer.html?jeu=import
 * (apps/web/e2e/import.e2e.ts).
 *
 * Bibliothèque commune (ferme_id nul, lecture seule) :
 *   - les familles de FAMILLES_PAR_DEFAUT (ids FAMILLE_PAR_NOM) ;
 *   - les 40 espèces de la ferme complète (packages/core/src/import/test/jeu-ferme.ts, mêmes ids :
 *     le serie.csv exporté de cette ferme désigne ses espèces par id) ; parmi elles Laitue,
 *     Batavia, Tomate, Carotte, Poireau, Radis, Épinard, Courgette, Betterave, Fraisier, Pivoine ;
 *   - itinéraires « Laitue », « Tomate », « Poireau » (pour les séries dont le fichier ne donne
 *     qu'une date : modele-a.csv, modele-b.csv).
 * Ferme :
 *   - espèce « Chou » (Brassicacées), absente de la bibliothèque ;
 *   - saisons 2026 et 2027 (les autres années sont créées par l'import) ;
 *   - zone « North field » (plein champ) : planches N3 et N4 (30 m × 0,8 m) — parcellaire-anglais.csv
 *     y ajoute N1 et N2 en REPRENANT la zone ;
 *   - zone « Les Grands Prés » : GP1 à GP4 ; zone « La Côte » : GP5 (planches de modele-a/b.csv).
 */
import { FAMILLES_PAR_DEFAUT } from '@planif/core';
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';
import { fermeComplete } from '../../../../../../packages/core/src/import/test/jeu-ferme.ts';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-14b0-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte). */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
/** Une autre ferme du même utilisateur : ses modèles et ses imports ne se mélangent pas. */
export const AUTRE_FERME = id(0x9);
const MEMBRE = id(0x3);
const MEMBRE_AUTRE = id(0xa);

export const SAISON = { a2026: id(0x4), a2027: id(0x5) } as const;
export const ZONE = { north: id(0x10), grandsPres: id(0x11), cote: id(0x12) } as const;
export const EMPLACEMENT = { n3: id(0x20), n4: id(0x21), gp1: id(0x22), gp2: id(0x23), gp3: id(0x24), gp4: id(0x25), gp5: id(0x26) } as const;
export const ESPECE_CHOU = id(0x40);
export const ITINERAIRE = { laitue: id(0x60), tomate: id(0x61), poireau: id(0x62) } as const;

export const CREE_LE = '2026-01-05T08:00:00.000Z';

/** Famille de la bibliothèque, par nom (FAMILLES_PAR_DEFAUT). */
export const FAMILLE_PAR_NOM: Readonly<Record<string, string>> = Object.fromEntries(FAMILLES_PAR_DEFAUT.map((f, i) => [f.nom, id(0x100 + i)]));

const ESPECES_BIBLIOTHEQUE = fermeComplete().tables.espece ?? [];

/** Espèce de la bibliothèque, par nom (ids de la ferme complète). */
export function espece(nom: string): string {
  const e = ESPECES_BIBLIOTHEQUE.find((x) => x.nom === nom);
  if (e === undefined || typeof e.id !== 'string') throw new Error(`espèce « ${nom} » absente de la bibliothèque`);
  return e.id;
}

const FAMILLE_DE: Readonly<Record<string, string>> = {
  Laitue: 'Astéracées',
  Batavia: 'Astéracées',
  Tomate: 'Solanacées',
  Carotte: 'Apiacées',
  Poireau: 'Alliacées',
  Radis: 'Brassicacées',
  Épinard: 'Amaranthacées',
  Courgette: 'Cucurbitacées',
};

const densite = (rangsParPlanche: number, ecartementSurRangCm: number) => ({ facon: 'ecartement', rangsParPlanche, ecartementSurRangCm });

/** Paramètres (texte JSON de itineraire.parametres) des itinéraires de la bibliothèque. */
export const PARAMETRES: Readonly<Record<keyof typeof ITINERAIRE, Readonly<Record<string, unknown>>>> = {
  laitue: {
    mode: 'plant_maison',
    periodeUsage: null,
    typeAbri: null,
    dureePepiniereJours: 28,
    dureeAvantRecolteJours: 45,
    fenetreRecolteJours: 21,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: densite(3, 30),
    grainesParMotte: 1,
    plantsParMotte: 1,
    pertePepiniere: 5,
    alveolesParPlaque: 104,
    travauxPrevus: [],
  },
  tomate: {
    mode: 'plant_achete',
    periodeUsage: null,
    typeAbri: null,
    dureeAvantRecolteJours: 60,
    fenetreRecolteJours: 90,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: densite(2, 50),
    travauxPrevus: [],
  },
  poireau: {
    mode: 'plant_maison',
    periodeUsage: null,
    typeAbri: null,
    dureePepiniereJours: 70,
    dureeAvantRecolteJours: 120,
    fenetreRecolteJours: 60,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: densite(4, 12),
    grainesParMotte: 1,
    plantsParMotte: 1,
    pertePepiniere: 5,
    alveolesParPlaque: 104,
    travauxPrevus: [],
  },
};

export interface FermeImport {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  readonly total: number;
}

/** Construit la ferme de l'import, sans rien écrire. */
export function fermeImport(): FermeImport {
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };

  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test import)', ...horo });
  const ferme = (fid: string, nom: string) => {
    ajouter('ferme', { id: fid, nom, fuseau_horaire: 'Europe/Paris', position: '{"latitude":44.35,"longitude":2.57}', unites: '{"longueur":"m","masse":"kg"}', ...horo });
  };
  ferme(FERME, 'Ferme de l’import (tests)');
  ferme(AUTRE_FERME, 'Autre ferme (tests)');
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  ajouter('membre', { id: MEMBRE_AUTRE, utilisateur_id: UTILISATEUR, ferme_id: AUTRE_FERME, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  for (const [sid, a] of [
    [SAISON.a2026, 2026],
    [SAISON.a2027, 2027],
  ] as const) {
    ajouter('saison', { id: sid, ferme_id: FERME, nom: String(a), debut: `${String(a)}-01-01`, fin: `${String(a)}-12-31`, ...horo });
  }

  for (const f of FAMILLES_PAR_DEFAUT) {
    ajouter('famille', {
      id: FAMILLE_PAR_NOM[f.nom] ?? null,
      ferme_id: null,
      nom: f.nom,
      delai_retour_minimal_ans: f.delaiRetourMinimalAns,
      delai_retour_conseille_ans: f.delaiRetourConseilleAns,
      ...horo,
    });
  }
  for (const e of ESPECES_BIBLIOTHEQUE) {
    const nom = String(e.nom);
    const famille = FAMILLE_DE[nom];
    ajouter('espece', {
      id: e.id ?? null,
      ferme_id: null,
      famille_id: famille === undefined ? null : (FAMILLE_PAR_NOM[famille] ?? null),
      nom,
      categorie: 'legume',
      perenne: 0,
      unite_recolte: 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...horo,
    });
  }
  ajouter('espece', {
    id: ESPECE_CHOU,
    ferme_id: FERME,
    famille_id: FAMILLE_PAR_NOM['Brassicacées'] ?? null,
    nom: 'Chou',
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'kg',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
    ...horo,
  });

  const itineraire = (cle: keyof typeof ITINERAIRE, nom: string) => {
    const p = PARAMETRES[cle];
    ajouter('itineraire', { id: ITINERAIRE[cle], ferme_id: null, espece_id: espece(nom), variete_id: null, nom, mode: String(p.mode), parametres: JSON.stringify(p), ...horo });
  };
  itineraire('laitue', 'Laitue');
  itineraire('tomate', 'Tomate');
  itineraire('poireau', 'Poireau');

  const zone = (zid: string, nom: string, abri: string) => {
    ajouter('zone', { id: zid, ferme_id: FERME, nom, zone_parente_id: null, type_abri: abri, surface_m2: null, ...horo });
  };
  zone(ZONE.north, 'North field', 'plein_champ');
  zone(ZONE.grandsPres, 'Les Grands Prés', 'plein_champ');
  zone(ZONE.cote, 'La Côte', 'plein_champ');
  const planche = (eid: string, zid: string, code: string) => {
    ajouter('emplacement', {
      id: eid,
      ferme_id: FERME,
      zone_id: zid,
      code,
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: '2020-01-01',
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  };
  planche(EMPLACEMENT.n3, ZONE.north, 'N3');
  planche(EMPLACEMENT.n4, ZONE.north, 'N4');
  planche(EMPLACEMENT.gp1, ZONE.grandsPres, 'GP1');
  planche(EMPLACEMENT.gp2, ZONE.grandsPres, 'GP2');
  planche(EMPLACEMENT.gp3, ZONE.grandsPres, 'GP3');
  planche(EMPLACEMENT.gp4, ZONE.grandsPres, 'GP4');
  planche(EMPLACEMENT.gp5, ZONE.cote, 'GP5');

  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { utilisateurId: UTILISATEUR, fermeId: FERME, lignes, total };
}

/**
 * Écrit la ferme de l'import dans `base` (base mémoire des tests, ou PowerSync dans la page
 * d'amorçage), une transaction par table, colonnes du schéma local.
 */
export async function ecrireFermeImport(base: Pick<BaseLocale, 'writeTransaction'>): Promise<FermeImport> {
  const ferme = fermeImport();
  for (const [table, liste] of Object.entries(ferme.lignes) as [NomTableLocale, readonly LigneLocale[]][]) {
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    for (const l of liste) {
      for (const cle of Object.keys(l)) if (!colonnes.includes(cle)) throw new Error(`${table}.${cle} absente du schéma local`);
    }
    const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (const l of liste) await tx.execute(sql, colonnes.map((c) => l[c] ?? null));
    });
  }
  return ferme;
}
