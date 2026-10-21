/**
 * Tests d'acceptation T61 — règles des chemins, des points du plan et du rangement des outils,
 * dans le cœur (docs/backlog/T61-chemins-outils.md, règles 1 à 3 ; Q44). Aucune base, aucun
 * réseau, aucune horloge. Ce sont les règles que le serveur rejouera (apps/api/src/sync) et dont
 * la base rejoue les bornes simples (packages/db).
 *
 * ── Contrat (exporté par @planif/core, src/index.ts ; les modules sont chargés dynamiquement :
 *    tant qu'ils n'existent pas, les tests échouent sur « n'exporte pas encore », pas sur un import) ──
 *
 * Chemin (table `chemin` : `points` jsonb [{x, y}] en mètres du repère de la ferme, `largeur_m`) :
 *   CHEMIN_POINTS_MIN = 2, CHEMIN_POINTS_MAX = 200, PLAFOND_LARGEUR_CHEMIN_M = 20
 *   validerChemin(ligne: unknown): ResultatPlacement<{ points: PointLocal[]; largeur_m: number }>
 *   `ligne` : { points, largeur_m } (colonnes snake_case, `points` en tableau). Règles, DANS CET
 *   ORDRE (la première violée est rendue, `champ` = colonne) :
 *     1. ligne objet et `points` tableau                      → 'entree_invalide' (champ 'points')
 *     2. au moins 2 points                                    → 'trop_peu_de_sommets'
 *     3. au plus 200 points                                   → 'trop_de_sommets'
 *     4. chaque point {x, y} de nombres finis                 → 'coordonnee_invalide'
 *     5. chaque point à 5 000 m au plus de l'origine (borne comprise) → 'trop_loin'
 *     6. pas deux points consécutifs à moins de 1 mm          → 'sommets_confondus'
 *     7. largeur_m nombre fini > 0                            → 'dimension_invalide' (champ 'largeur_m')
 *     8. largeur_m ≤ 20 m (borne comprise)                    → 'plafond_depasse'  (champ 'largeur_m')
 *   Un chemin est une LIGNE OUVERTE : il peut se croiser ou revenir sur lui-même (une boucle de
 *   passage est un chemin valide), aucun test d'auto-intersection ni d'aire. Valide : `valeur` =
 *   les points {x, y} (seulement ces deux clés), dans l'ordre reçu (le sens d'un chemin n'a pas
 *   de sens, jamais inversé).
 *
 * Point du plan (table `point_plan` : point d'eau ou autre repère nommé) :
 *   SORTES_POINT_PLAN = ['point_eau', 'repere']
 *   validerPointPlan(ligne: unknown): ResultatPlacement<…> — { nom, sorte, x_m, y_m } :
 *     nom texte non vide après trim, 80 caractères au plus  → 'incomplet' (champ 'nom')
 *     sorte parmi SORTES_POINT_PLAN                         → 'entree_invalide' (champ 'sorte')
 *     x_m et y_m nombres finis                              → 'coordonnee_invalide'
 *     (x_m, y_m) à 5 000 m au plus de l'origine             → 'trop_loin'
 *
 * Bâtiment : TYPES_BATIMENT gagne 'local' et 'chambre_froide' (ordre : serre_tunnel,
 * serre_chapelle, hangar, local, chambre_froide, magasin, autre) ; validerPlacement les accepte.
 *
 * Rangement des outils :
 *   validerPlaceRangement(ligne) — { nom } : texte non vide après trim, 60 caractères au plus
 *     → 'incomplet' (champ 'nom').
 *   validerOutil(ligne) — { nom, lieu_rangement_id, place_rangement_id } : nom 1 à 80 caractères
 *     après trim → 'incomplet' (champ 'nom') ; lieu_rangement_id texte non vide (tout outil a un
 *     lieu de rangement) → 'incomplet' (champ 'lieu_rangement_id') ; place_rangement_id nul ou
 *     texte non vide.
 *   trouverOutil(nomTravail: string, outils: readonly { id; nom }[]): outil | null — l'outil
 *     qu'un travail prévu désigne (le travail porte le NOM, ex. « grelinette ») : égalité sans
 *     tenir compte des majuscules, des accents ni des espaces autour ; null si aucun.
 *   libelleRangement(nomOutil: string, lieu: string | null, place: string | null): string
 *     « Grelinette — hangar, mur nord » ; sans place : « Grelinette — hangar » ; sans lieu : le
 *     nom seul. Première lettre du nom en capitale, le reste tel que saisi ; lieu et place tels
 *     que saisis (ni capitale ni minuscule imposées), sans espaces autour.
 */
import { beforeAll, describe, expect, it } from 'vitest';

interface Erreur {
  readonly code: string;
  readonly champ: string | null;
  readonly message: string;
}
type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: Erreur };
interface Point {
  readonly x: number;
  readonly y: number;
}
interface ModuleChemins {
  CHEMIN_POINTS_MIN: number;
  CHEMIN_POINTS_MAX: number;
  PLAFOND_LARGEUR_CHEMIN_M: number;
  SORTES_POINT_PLAN: readonly string[];
  TYPES_BATIMENT: readonly string[];
  validerChemin(ligne: unknown): Resultat<{ points: Point[]; largeur_m: number }>;
  validerPointPlan(ligne: unknown): Resultat<unknown>;
  validerPlacement(entree: { table: 'batiment'; ligne: Record<string, unknown> }): Resultat<unknown>;
  validerPlaceRangement(ligne: unknown): Resultat<unknown>;
  validerOutil(ligne: unknown): Resultat<unknown>;
  trouverOutil(nomTravail: string, outils: readonly { id: string; nom: string }[]): { id: string; nom: string } | null;
  libelleRangement(nomOutil: string, lieu: string | null, place: string | null): string;
}

const CHEMIN_COEUR = '../index.ts';
let m: ModuleChemins;

beforeAll(async () => {
  const brut = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleChemins>;
  const noms = ['CHEMIN_POINTS_MIN', 'CHEMIN_POINTS_MAX', 'PLAFOND_LARGEUR_CHEMIN_M', 'SORTES_POINT_PLAN', 'validerChemin', 'validerPointPlan', 'validerPlaceRangement', 'validerOutil', 'trouverOutil', 'libelleRangement'] as const;
  const absents = noms.filter((n) => brut[n] === undefined);
  if (absents.length > 0) throw new Error(`@planif/core n’exporte pas encore : ${absents.join(', ')} (T61)`);
  m = brut as ModuleChemins;
});

const refus = (r: Resultat<unknown>): Erreur => {
  if (r.ok) throw new Error('accepté : un refus était attendu');
  return r.erreur;
};

describe('T61 : validerChemin', () => {
  const DROIT: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 25.5 },
  ];

  it('bornes du ticket : 2 à 200 points, largeur plafonnée à 20 m', () => {
    expect([m.CHEMIN_POINTS_MIN, m.CHEMIN_POINTS_MAX, m.PLAFOND_LARGEUR_CHEMIN_M]).toEqual([2, 200, 20]);
  });

  it('un chemin de trois points, 2,5 m de large : accepté tel quel, dans l’ordre reçu', () => {
    const r = m.validerChemin({ points: DROIT, largeur_m: 2.5 });
    expect(r).toEqual({ ok: true, valeur: { points: DROIT, largeur_m: 2.5 } });
  });

  it('seules les clés x et y sont gardées', () => {
    const r = m.validerChemin({ points: [{ x: 0, y: 0, z: 9 }, { x: 5, y: 0, nom: 'a' }], largeur_m: 1 });
    expect(r.ok && r.valeur.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
  });

  it('une ligne de deux points suffit ; un seul point est refusé (trop_peu_de_sommets)', () => {
    expect(m.validerChemin({ points: DROIT.slice(0, 2), largeur_m: 1 }).ok).toBe(true);
    expect(refus(m.validerChemin({ points: DROIT.slice(0, 1), largeur_m: 1 })).code).toBe('trop_peu_de_sommets');
    expect(refus(m.validerChemin({ points: [], largeur_m: 1 })).code).toBe('trop_peu_de_sommets');
  });

  it('200 points acceptés, 201 refusés (trop_de_sommets)', () => {
    const ligne = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
    expect(m.validerChemin({ points: ligne(200), largeur_m: 1 }).ok).toBe(true);
    expect(refus(m.validerChemin({ points: ligne(201), largeur_m: 1 })).code).toBe('trop_de_sommets');
  });

  it('un chemin qui se croise ou fait une boucle est valide (ligne ouverte)', () => {
    const boucle: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(m.validerChemin({ points: boucle, largeur_m: 1 }).ok).toBe(true);
    expect(m.validerChemin({ points: [...boucle, { x: 0, y: 0 }], largeur_m: 1 }).ok, 'revenir au départ').toBe(true);
  });

  it('coordonnée absente, non numérique, NaN ou infinie : coordonnee_invalide', () => {
    for (const p of [{ x: 1 }, { x: '1', y: 2 }, { x: Number.NaN, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }, null, 'a']) {
      expect(refus(m.validerChemin({ points: [{ x: 0, y: 0 }, p], largeur_m: 1 })).code, JSON.stringify(p)).toBe('coordonnee_invalide');
    }
  });

  it('à 5 000 m de l’origine : accepté (borne comprise) ; au-delà : trop_loin', () => {
    expect(m.validerChemin({ points: [{ x: 0, y: 0 }, { x: 3000, y: 4000 }], largeur_m: 1 }).ok).toBe(true);
    expect(refus(m.validerChemin({ points: [{ x: 0, y: 0 }, { x: 3000.1, y: 4000 }], largeur_m: 1 })).code).toBe('trop_loin');
    expect(refus(m.validerChemin({ points: [{ x: -5000.5, y: 0 }, { x: 0, y: 0 }], largeur_m: 1 })).code).toBe('trop_loin');
  });

  it('deux points consécutifs à moins de 1 mm : sommets_confondus ; à 2 mm : accepté', () => {
    expect(refus(m.validerChemin({ points: [{ x: 0, y: 0 }, { x: 0.0005, y: 0 }, { x: 5, y: 5 }], largeur_m: 1 })).code).toBe('sommets_confondus');
    expect(m.validerChemin({ points: [{ x: 0, y: 0 }, { x: 0.002, y: 0 }, { x: 5, y: 5 }], largeur_m: 1 }).ok).toBe(true);
  });

  it('largeur : 0, négative, absente, texte ou NaN → dimension_invalide ; 20 m accepté, 20,01 m → plafond_depasse', () => {
    for (const l of [0, -1, undefined, '2', Number.NaN]) {
      const e = refus(m.validerChemin({ points: DROIT, largeur_m: l }));
      expect(e.code, String(l)).toBe('dimension_invalide');
      expect(e.champ).toBe('largeur_m');
    }
    expect(m.validerChemin({ points: DROIT, largeur_m: 20 }).ok).toBe(true);
    expect(refus(m.validerChemin({ points: DROIT, largeur_m: 20.01 })).code).toBe('plafond_depasse');
  });

  it('entrée qui n’est pas une ligne, ou points qui n’est pas un tableau : entree_invalide, sans exception', () => {
    for (const l of [null, undefined, 3, 'x', { largeur_m: 1 }, { points: 'a', largeur_m: 1 }, { points: { 0: { x: 0, y: 0 } }, largeur_m: 1 }]) {
      expect(refus(m.validerChemin(l)).code, JSON.stringify(l)).toBe('entree_invalide');
    }
  });

  it('plusieurs défauts : les points d’abord, la largeur ensuite (ordre des règles)', () => {
    expect(refus(m.validerChemin({ points: [{ x: 0, y: 0 }], largeur_m: 0 })).code).toBe('trop_peu_de_sommets');
    expect(refus(m.validerChemin({ points: DROIT, largeur_m: 0 })).champ).toBe('largeur_m');
  });

  it('messages en français, 200 caractères au plus', () => {
    const e = refus(m.validerChemin({ points: DROIT, largeur_m: 99 }));
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.message.length).toBeLessThanOrEqual(200);
    expect(e.message).toMatch(/largeur/i);
  });
});

describe('T61 : validerPointPlan', () => {
  const EAU = { nom: 'Point d’eau du verger', sorte: 'point_eau', x_m: 12.5, y_m: -40 };

  it('sortes : point d’eau et repère', () => {
    expect([...m.SORTES_POINT_PLAN]).toEqual(['point_eau', 'repere']);
  });

  it('un point d’eau et un repère nommés : acceptés', () => {
    expect(m.validerPointPlan(EAU).ok).toBe(true);
    expect(m.validerPointPlan({ ...EAU, nom: 'Portail', sorte: 'repere' }).ok).toBe(true);
  });

  it('nom vide, blanc ou de plus de 80 caractères : incomplet (champ nom) ; 80 caractères acceptés', () => {
    for (const nom of ['', '   ', 'x'.repeat(81), null, 3]) {
      const e = refus(m.validerPointPlan({ ...EAU, nom }));
      expect([e.code, e.champ], String(nom)).toEqual(['incomplet', 'nom']);
    }
    expect(m.validerPointPlan({ ...EAU, nom: 'x'.repeat(80) }).ok).toBe(true);
  });

  it('sorte inconnue : entree_invalide (champ sorte)', () => {
    const e = refus(m.validerPointPlan({ ...EAU, sorte: 'puits' }));
    expect([e.code, e.champ]).toEqual(['entree_invalide', 'sorte']);
  });

  it('coordonnées absentes ou non finies : coordonnee_invalide ; à plus de 5 km : trop_loin', () => {
    expect(refus(m.validerPointPlan({ ...EAU, x_m: undefined })).code).toBe('coordonnee_invalide');
    expect(refus(m.validerPointPlan({ ...EAU, y_m: Number.NaN })).code).toBe('coordonnee_invalide');
    expect(refus(m.validerPointPlan({ ...EAU, x_m: 4000, y_m: 3001 })).code).toBe('trop_loin');
    expect(m.validerPointPlan({ ...EAU, x_m: 4000, y_m: 3000 }).ok).toBe(true);
  });
});

describe('T61 : bâtiments hangar, local, chambre froide, magasin', () => {
  const BATIMENT = { nom: 'Chambre froide', type: 'chambre_froide', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: -10, centre_y_m: 15, orientation_deg: 0, zone_id: null };

  it('les sortes de la liste : hangar, local, chambre froide, magasin, en plus des serres et « autre »', () => {
    expect([...m.TYPES_BATIMENT]).toEqual(['serre_tunnel', 'serre_chapelle', 'hangar', 'local', 'chambre_froide', 'magasin', 'autre']);
  });

  it.each(['hangar', 'local', 'chambre_froide', 'magasin'])('validerPlacement accepte un bâtiment « %s »', (type) => {
    expect(m.validerPlacement({ table: 'batiment', ligne: { ...BATIMENT, type } }).ok).toBe(true);
  });

  it('une sorte inconnue reste refusée', () => {
    expect(m.validerPlacement({ table: 'batiment', ligne: { ...BATIMENT, type: 'garage' } }).ok).toBe(false);
  });
});

describe('T61 : rangement des outils', () => {
  it('validerPlaceRangement : nom de 1 à 60 caractères', () => {
    expect(m.validerPlaceRangement({ nom: 'mur nord' }).ok).toBe(true);
    for (const nom of ['', '  ', 'x'.repeat(61), undefined]) {
      const e = refus(m.validerPlaceRangement({ nom }));
      expect([e.code, e.champ], String(nom)).toEqual(['incomplet', 'nom']);
    }
    expect(m.validerPlaceRangement({ nom: 'x'.repeat(60) }).ok).toBe(true);
  });

  it('validerOutil : un nom et un lieu de rangement obligatoires, la place facultative', () => {
    const lieu = '0192f0c1-6161-7000-8000-000000000001';
    expect(m.validerOutil({ nom: 'Grelinette', lieu_rangement_id: lieu, place_rangement_id: null }).ok).toBe(true);
    expect(m.validerOutil({ nom: 'Grelinette', lieu_rangement_id: lieu, place_rangement_id: '0192f0c1-6161-7000-8000-000000000002' }).ok).toBe(true);
    const sansNom = refus(m.validerOutil({ nom: ' ', lieu_rangement_id: lieu, place_rangement_id: null }));
    expect([sansNom.code, sansNom.champ]).toEqual(['incomplet', 'nom']);
    const sansLieu = refus(m.validerOutil({ nom: 'Grelinette', lieu_rangement_id: null, place_rangement_id: null }));
    expect([sansLieu.code, sansLieu.champ]).toEqual(['incomplet', 'lieu_rangement_id']);
    expect(refus(m.validerOutil({ nom: 'x'.repeat(81), lieu_rangement_id: lieu, place_rangement_id: null })).champ).toBe('nom');
    expect(m.validerOutil({ nom: 'x'.repeat(80), lieu_rangement_id: lieu, place_rangement_id: null }).ok).toBe(true);
    expect(refus(m.validerOutil({ nom: 'Bêche', lieu_rangement_id: lieu, place_rangement_id: '' })).code).toBeDefined();
  });

  describe('trouverOutil : le travail prévu porte le nom de l’outil', () => {
    const OUTILS = [
      { id: 'o1', nom: 'Grelinette' },
      { id: 'o2', nom: 'Bêche' },
      { id: 'o3', nom: 'Sarcleuse à main' },
    ];
    it('sans tenir compte des majuscules, des accents ni des espaces autour', () => {
      expect(m.trouverOutil('grelinette', OUTILS)?.id).toBe('o1');
      expect(m.trouverOutil('  GRELINETTE ', OUTILS)?.id).toBe('o1');
      expect(m.trouverOutil('beche', OUTILS)?.id).toBe('o2');
      expect(m.trouverOutil('sarcleuse à main', OUTILS)?.id).toBe('o3');
    });
    it('inconnu ou vide : null (jamais l’outil le plus proche)', () => {
      expect(m.trouverOutil('serfouette', OUTILS)).toBeNull();
      expect(m.trouverOutil('', OUTILS)).toBeNull();
      expect(m.trouverOutil('grelin', OUTILS)).toBeNull();
      expect(m.trouverOutil('grelinette', [])).toBeNull();
    });
  });

  describe('libelleRangement : « Grelinette — hangar, mur nord »', () => {
    it('exemple du ticket', () => {
      expect(m.libelleRangement('grelinette', 'hangar', 'mur nord')).toBe('Grelinette — hangar, mur nord');
      expect(m.libelleRangement('Grelinette', 'hangar', 'mur nord')).toBe('Grelinette — hangar, mur nord');
    });
    it('sans place : le lieu seul ; sans lieu : le nom seul', () => {
      expect(m.libelleRangement('Bêche', 'local', null)).toBe('Bêche — local');
      expect(m.libelleRangement('Bêche', null, null)).toBe('Bêche');
      expect(m.libelleRangement('Bêche', '  ', null)).toBe('Bêche');
      expect(m.libelleRangement(' GRELINETTE ', ' hangar ', ' mur nord ')).toBe('GRELINETTE — hangar, mur nord');
    });
    it('lieu et place tels que saisis', () => {
      expect(m.libelleRangement('Bêche', 'Chambre froide', 'Étagère 2')).toBe('Bêche — Chambre froide, Étagère 2');
    });
  });
});
