/**
 * Tests d'acceptation T61 — la porte écrit les chemins, les points du plan, les lieux de rangement,
 * leurs places et les outils (docs/backlog/T61-chemins-outils.md), côté téléphone (`@planif/sync`),
 * sans réseau, sur un SQLite en mémoire. Même mécanique que porte-placement.test.ts (T28s).
 *
 * ── Contrat (proposé par le testeur) : `porte.placer` accepte cinq sortes de changement de plus ──
 *
 *   { sorte: 'chemin',          id, valeurs: { nom?, points?: readonly {x, y}[], largeur_m?, supprime_le? } }
 *   { sorte: 'point_plan',      id, valeurs: { nom?, sorte?: 'point_eau' | 'repere', x_m?, y_m?, supprime_le? } }
 *   { sorte: 'lieu_rangement',  id, valeurs: { batiment_id?, point_plan_id?, supprime_le? } }
 *   { sorte: 'place_rangement', id, valeurs: { lieu_rangement_id?, nom?, supprime_le? } }
 *   { sorte: 'outil',           id, valeurs: { nom?, lieu_rangement_id?, place_rangement_id?, supprime_le? } }
 *
 * - `id` inconnu localement → création dans la ferme de la porte (toutes les colonnes requises) ;
 *   connu → modification des seules colonnes données. Annuler une création = suppression douce
 *   (`supprime_le` = maintenant de la porte, ISO UTC) ; annuler une modification = les valeurs
 *   d'avant, lues dans la base locale. L'annulation est dans l'ordre inverse (`placer(annulation)`
 *   refait).
 * - `points` rangé en texte JSON `[{x, y}]` (x et y seulement, dans l'ordre reçu), comme PowerSync
 *   le range ; relu en tableau par l'appelant.
 * - Une seule transaction locale par appel (un seul envoi au serveur, tout ou rien).
 * - Rejet (promesse rejetée, RIEN d'écrit) dans les cas que le serveur refuserait : pas gérant
 *   actif de la ferme de la porte → « Seul le gérant peut placer les éléments de la ferme. » ;
 *   règles du cœur (validerChemin, validerPointPlan, validerPlaceRangement, validerOutil : message
 *   du cœur, en français) ; référence vers une autre ferme, une ligne supprimée ou introuvable ;
 *   place qui n'est pas celle du lieu de l'outil ; second lieu pour un même bâtiment ou point ;
 *   nom de place déjà pris dans le lieu, nom d'outil déjà pris dans la ferme ; chemin ou point
 *   posé sans origine du plan ; origine déplacée ou effacée alors qu'un chemin ou un point non
 *   supprimé existe.
 */
import { ECRITURES_MAX_PAR_LOT, type Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';

interface Point {
  readonly x: number;
  readonly y: number;
}

type Changement =
  | { readonly sorte: 'chemin'; readonly id: string; readonly valeurs: { readonly nom?: string | null; readonly points?: readonly Point[]; readonly largeur_m?: number; readonly supprime_le?: string | null } }
  | { readonly sorte: 'point_plan'; readonly id: string; readonly valeurs: { readonly nom?: string; readonly sorte?: string; readonly x_m?: number; readonly y_m?: number; readonly supprime_le?: string | null } }
  | { readonly sorte: 'lieu_rangement'; readonly id: string; readonly valeurs: { readonly batiment_id?: string | null; readonly point_plan_id?: string | null; readonly supprime_le?: string | null } }
  | { readonly sorte: 'place_rangement'; readonly id: string; readonly valeurs: { readonly lieu_rangement_id?: string; readonly nom?: string; readonly supprime_le?: string | null } }
  | { readonly sorte: 'outil'; readonly id: string; readonly valeurs: { readonly nom?: string; readonly lieu_rangement_id?: string; readonly place_rangement_id?: string | null; readonly supprime_le?: string | null } }
  | { readonly sorte: 'origine'; readonly origine: { readonly latitude: number; readonly longitude: number } | null }
  | { readonly sorte: 'batiment'; readonly id: string; readonly valeurs: Record<string, unknown> };

type PortePlan = PorteDonnees & { placer?: (changements: readonly Changement[]) => Promise<readonly Changement[]> };

const id = (n: number) => `0192f0c1-6161-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;
const GERANT = id(0x1) as Id<'Utilisateur'>;
const EQUIPIER = id(0x2) as Id<'Utilisateur'>;
const FERME = id(0x10) as Id<'Ferme'>;
const VOISINE = id(0x11);
const HANGAR = id(0x20);
const LOCAL = id(0x21);
const BATIMENT_VOISIN = id(0x22);
const LIEU_HANGAR = id(0x30);
const LIEU_LOCAL = id(0x31);
const LIEU_VOISIN = id(0x32);
const PLACE_HANGAR = id(0x40);
const PLACE_LOCAL = id(0x41);
const PLACE_VOISINE = id(0x42);
const POINT_VOISIN = id(0x50);
const CHEMIN_VOISIN = id(0x60);
const OUTIL_VOISIN = id(0x70);
const NOUVEAU = (n: number) => id(0x1000 + n);
const INSTANT = new Date('2026-10-21T06:00:00.000Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };
const SEUL_LE_GERANT = 'Seul le gérant peut placer les éléments de la ferme.';
const SENTIER: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 25.5 },
];

describe('T61 : la porte écrit chemins, points, rangement et outils, et rend de quoi les annuler', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let transactions: number;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    transactions = 0;
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    const ferme = (f: string, nom: string) => { r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, ?, 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [f, nom, JSON.stringify(ORIGINE)]); };
    ferme(FERME, 'Jardins de Garonne');
    ferme(VOISINE, 'Ferme voisine');
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m3', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, VOISINE]);
    const batiment = (b: string, f: string, nom: string) => { r(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, supprime_le) VALUES (?, ?, ?, 'hangar', 20, 12, 6, -10, 15, 0, NULL, NULL)`, [b, f, nom]); };
    batiment(HANGAR, FERME, 'hangar');
    batiment(LOCAL, FERME, 'local');
    batiment(BATIMENT_VOISIN, VOISINE, 'hangar voisin');
    const lieu = (l: string, f: string, b: string) => { r(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id, point_plan_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, NULL, ?, ?, NULL)`, [l, f, b, INSTANT.toISOString(), INSTANT.toISOString()]); };
    lieu(LIEU_HANGAR, FERME, HANGAR);
    lieu(LIEU_LOCAL, FERME, LOCAL);
    lieu(LIEU_VOISIN, VOISINE, BATIMENT_VOISIN);
    const place = (p: string, f: string, l: string, nom: string) => { r(`INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)`, [p, f, l, nom, INSTANT.toISOString(), INSTANT.toISOString()]); };
    place(PLACE_HANGAR, FERME, LIEU_HANGAR, 'mur nord');
    place(PLACE_LOCAL, FERME, LIEU_LOCAL, 'étagère');
    place(PLACE_VOISINE, VOISINE, LIEU_VOISIN, 'mur nord');
    r(`INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Puits voisin', 'point_eau', 1, 1, ?, ?, NULL)`, [POINT_VOISIN, VOISINE, INSTANT.toISOString(), INSTANT.toISOString()]);
    r(`INSERT INTO chemin (id, ferme_id, nom, points, largeur_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Chemin voisin', ?, 2, ?, ?, NULL)`, [CHEMIN_VOISIN, VOISINE, JSON.stringify(SENTIER), INSTANT.toISOString(), INSTANT.toISOString()]);
    r(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, place_rangement_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Râteau', ?, NULL, ?, ?, NULL)`, [OUTIL_VOISIN, VOISINE, LIEU_VOISIN, INSTANT.toISOString(), INSTANT.toISOString()]);
  });

  afterEach(() => {
    base.fermer();
  });

  function porte(utilisateurId: Id<'Utilisateur'> = GERANT): PortePlan {
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    return sync.creerPorte(compteuse, { utilisateurId, fermeId: FERME, maintenant: () => INSTANT });
  }

  function placer(changements: readonly Changement[], utilisateurId: Id<'Utilisateur'> = GERANT): Promise<readonly Changement[]> {
    const p = porte(utilisateurId);
    if (typeof p.placer !== 'function') throw new Error('porte.placer absente');
    return p.placer(changements);
  }

  const ligne = (table: string, ident: string): Record<string, unknown> | undefined => base.lireDirect<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [ident])[0];
  const points = (ident: string): unknown => {
    const p = ligne('chemin', ident)?.points;
    return typeof p === 'string' ? JSON.parse(p) : p;
  };
  const instantane = (): unknown =>
    Object.fromEntries(['chemin', 'point_plan', 'lieu_rangement', 'place_rangement', 'outil', 'batiment', 'ferme'].map((t) => [t, base.lireDirect(`SELECT * FROM ${t} ORDER BY id`)]));

  async function rejete(changements: readonly Changement[], attendu: RegExp | string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> {
    const avant = instantane();
    await expect(placer(changements, utilisateurId)).rejects.toThrow(attendu);
    expect(instantane(), 'rien n’est écrit').toEqual(avant);
  }

  const chemin = (n: number, valeurs: Partial<Extract<Changement, { sorte: 'chemin' }>['valeurs']> = {}): Changement => ({
    sorte: 'chemin',
    id: NOUVEAU(n),
    valeurs: { nom: 'Allée centrale', points: SENTIER, largeur_m: 2.5, ...valeurs },
  });

  // ── Chemin ──────────────────────────────────────────────────────────────────────────────────

  describe('chemin : posé, relu, annulé', () => {
    it('trois points, 2,5 m de large : écrit dans la ferme de la porte, points en texte JSON, relus à l’identique', async () => {
      await placer([chemin(1)]);
      const l = ligne('chemin', NOUVEAU(1));
      expect(l).toMatchObject({ ferme_id: FERME, nom: 'Allée centrale', largeur_m: 2.5, supprime_le: null });
      expect(typeof l?.points, 'texte JSON, comme PowerSync le range').toBe('string');
      expect(points(NOUVEAU(1))).toEqual(SENTIER);
    });

    it('seules les clés x et y sont gardées, dans l’ordre reçu', async () => {
      await placer([chemin(1, { points: [{ x: 5, y: 5, z: 9 } as Point, { x: 0, y: 0 }] })]);
      expect(points(NOUVEAU(1))).toEqual([{ x: 5, y: 5 }, { x: 0, y: 0 }]);
    });

    it('annuler la création : suppression douce à l’instant de la porte ; refaire : le chemin revient', async () => {
      const annulation = await placer([chemin(1)]);
      expect(annulation).toEqual([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { supprime_le: INSTANT.toISOString() } }]);
      const refaire = await placer(annulation);
      expect(ligne('chemin', NOUVEAU(1))?.supprime_le).toBe(INSTANT.toISOString());
      await placer(refaire);
      expect(ligne('chemin', NOUVEAU(1))?.supprime_le).toBeNull();
    });

    it('modifier les points et la largeur, puis annuler : valeurs d’avant exactes', async () => {
      await placer([chemin(1)]);
      const annulation = await placer([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { points: [{ x: 1, y: 1 }, { x: 9, y: 9 }], largeur_m: 1 } }]);
      expect(points(NOUVEAU(1))).toEqual([{ x: 1, y: 1 }, { x: 9, y: 9 }]);
      expect(annulation).toEqual([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { points: SENTIER, largeur_m: 2.5 } }]);
      await placer(annulation);
      expect(points(NOUVEAU(1))).toEqual(SENTIER);
      expect(ligne('chemin', NOUVEAU(1))?.largeur_m).toBe(2.5);
    });

    it('un chemin sans nom est permis', async () => {
      await placer([chemin(1, { nom: null })]);
      expect(ligne('chemin', NOUVEAU(1))?.nom).toBeNull();
    });
  });

  describe('chemin : géométrie invalide, rejet et rien d’écrit', () => {
    it.each([
      ['un seul point', { points: [{ x: 0, y: 0 }] }, /point/iu],
      ['201 points', { points: Array.from({ length: 201 }, (_, i) => ({ x: i, y: 0 })) }, /point/iu],
      ['un point à plus de 5 km', { points: [{ x: 0, y: 0 }, { x: 3000, y: 4001 }] }, /5 km/iu],
      ['deux points confondus', { points: [{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 4, y: 4 }] }, /confondu|même|proche/iu],
      ['une coordonnée non finie', { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }] }, /coordonn/iu],
      ['largeur nulle', { largeur_m: 0 }, /largeur/iu],
      ['largeur de 21 m', { largeur_m: 21 }, /largeur/iu],
    ] as const)('%s', async (_cas, valeurs, attendu) => {
      await rejete([chemin(1, valeurs)], attendu);
    });

    it('une modification qui rend un chemin existant invalide est rejetée', async () => {
      await placer([chemin(1)]);
      await rejete([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { largeur_m: 80 } }], /largeur/iu);
    });
  });

  // ── Points du plan ──────────────────────────────────────────────────────────────────────────

  describe('point du plan', () => {
    it('un point d’eau nommé : écrit, relu ; annuler = suppression douce', async () => {
      const annulation = await placer([{ sorte: 'point_plan', id: NOUVEAU(2), valeurs: { nom: 'Point d’eau du verger', sorte: 'point_eau', x_m: 12.5, y_m: -40 } }]);
      expect(ligne('point_plan', NOUVEAU(2))).toMatchObject({ ferme_id: FERME, nom: 'Point d’eau du verger', sorte: 'point_eau', x_m: 12.5, y_m: -40, supprime_le: null });
      await placer(annulation);
      expect(ligne('point_plan', NOUVEAU(2))?.supprime_le).toBe(INSTANT.toISOString());
    });

    it.each([
      ['sorte inconnue', { nom: 'a', sorte: 'puits', x_m: 0, y_m: 0 }, /sorte|type/iu],
      ['nom vide', { nom: ' ', sorte: 'repere', x_m: 0, y_m: 0 }, /nom/iu],
      ['hors des 5 km', { nom: 'a', sorte: 'repere', x_m: 6000, y_m: 0 }, /5 km/iu],
    ] as const)('invalide : %s → rejet', async (_cas, valeurs, attendu) => {
      await rejete([{ sorte: 'point_plan', id: NOUVEAU(2), valeurs }], attendu);
    });
  });

  // ── Rangement ───────────────────────────────────────────────────────────────────────────────

  describe('outil rangé : bâtiment, lieu, place, outil', () => {
    it('Grelinette au hangar, mur nord : le tout dans UN appel (une transaction), annulé ensemble dans l’ordre inverse', async () => {
      const annulation = await placer([
        { sorte: 'batiment', id: NOUVEAU(3), valeurs: { nom: 'abri', type: 'local', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: 30, centre_y_m: 15, orientation_deg: 0, zone_id: null } },
        { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: NOUVEAU(3), point_plan_id: null } },
        { sorte: 'place_rangement', id: NOUVEAU(5), valeurs: { lieu_rangement_id: NOUVEAU(4), nom: 'mur nord' } },
        { sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Grelinette', lieu_rangement_id: NOUVEAU(4), place_rangement_id: NOUVEAU(5) } },
      ]);
      expect(transactions).toBe(1);
      expect(ligne('batiment', NOUVEAU(3))).toMatchObject({ type: 'local', ferme_id: FERME });
      expect(ligne('lieu_rangement', NOUVEAU(4))).toMatchObject({ ferme_id: FERME, batiment_id: NOUVEAU(3), point_plan_id: null });
      expect(ligne('place_rangement', NOUVEAU(5))).toMatchObject({ lieu_rangement_id: NOUVEAU(4), nom: 'mur nord' });
      expect(ligne('outil', NOUVEAU(6))).toMatchObject({ nom: 'Grelinette', lieu_rangement_id: NOUVEAU(4), place_rangement_id: NOUVEAU(5), supprime_le: null });
      expect(annulation.map((a) => ('id' in a ? a.id : 'origine'))).toEqual([NOUVEAU(6), NOUVEAU(5), NOUVEAU(4), NOUVEAU(3)]);
      await placer(annulation);
      expect(transactions).toBe(2);
      for (const [table, ident] of [['outil', 6], ['place_rangement', 5], ['lieu_rangement', 4], ['batiment', 3]] as const) {
        expect(ligne(table, NOUVEAU(ident))?.supprime_le, table).toBe(INSTANT.toISOString());
      }
    });

    it('un lieu sur un point d’eau posé dans le même appel', async () => {
      await placer([
        { sorte: 'point_plan', id: NOUVEAU(2), valeurs: { nom: 'Abri du verger', sorte: 'repere', x_m: 80, y_m: 10 } },
        { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: null, point_plan_id: NOUVEAU(2) } },
      ]);
      expect(ligne('lieu_rangement', NOUVEAU(4))).toMatchObject({ batiment_id: null, point_plan_id: NOUVEAU(2) });
    });

    it('déplacer un outil dans un autre lieu, puis annuler : lieu et place d’avant', async () => {
      await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: PLACE_HANGAR } }]);
      const annulation = await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { lieu_rangement_id: LIEU_LOCAL, place_rangement_id: PLACE_LOCAL } }]);
      expect(ligne('outil', NOUVEAU(6))).toMatchObject({ lieu_rangement_id: LIEU_LOCAL, place_rangement_id: PLACE_LOCAL });
      await placer(annulation);
      expect(ligne('outil', NOUVEAU(6))).toMatchObject({ lieu_rangement_id: LIEU_HANGAR, place_rangement_id: PLACE_HANGAR });
    });

    it.each([
      ['outil sans lieu', [{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche' } }], /lieu|rangement/iu],
      ['outil sans nom', [{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: ' ', lieu_rangement_id: LIEU_HANGAR } }], /nom/iu],
      ['place sans nom', [{ sorte: 'place_rangement', id: NOUVEAU(5), valeurs: { lieu_rangement_id: LIEU_HANGAR, nom: '' } }], /nom/iu],
      ['lieu sans bâtiment ni point', [{ sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: {} }], /bâtiment|point/iu],
      ['lieu sur un bâtiment ET un point', [{ sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: HANGAR, point_plan_id: POINT_VOISIN } }], /bâtiment|point/iu],
      ['second lieu pour le hangar', [{ sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: HANGAR, point_plan_id: null } }], /déjà|lieu/iu],
      ['place déjà prise dans le lieu (casse et espaces ignorés)', [{ sorte: 'place_rangement', id: NOUVEAU(5), valeurs: { lieu_rangement_id: LIEU_HANGAR, nom: ' Mur NORD ' } }], /déjà|nom/iu],
      ['outil au nom déjà pris', [{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Grelinette', lieu_rangement_id: LIEU_HANGAR } }, { sorte: 'outil', id: NOUVEAU(7), valeurs: { nom: ' grelinette ', lieu_rangement_id: LIEU_LOCAL } }], /déjà|nom/iu],
      ['place d’un autre lieu', [{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: PLACE_LOCAL } }], /place|lieu/iu],
    ] as const)('%s : rejet, rien d’écrit', async (_cas, changements, attendu) => {
      await rejete(changements, attendu);
    });
  });

  // ── Isolement entre fermes ──────────────────────────────────────────────────────────────────

  describe('isolement : une autre ferme n’est ni lue ni écrite', () => {
    it.each([
      ['lieu sur le bâtiment d’une autre ferme', { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: BATIMENT_VOISIN, point_plan_id: null } }],
      ['lieu sur le point d’une autre ferme', { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: null, point_plan_id: POINT_VOISIN } }],
      ['place dans le lieu d’une autre ferme', { sorte: 'place_rangement', id: NOUVEAU(5), valeurs: { lieu_rangement_id: LIEU_VOISIN, nom: 'étagère' } }],
      ['outil dans le lieu d’une autre ferme', { sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_VOISIN } }],
      ['outil à la place d’une autre ferme', { sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: PLACE_VOISINE } }],
    ] as const)('%s : rejet, rien d’écrit', async (_cas, changement) => {
      await rejete([changement], /.+/u);
    });

    it.each([
      ['un chemin', { sorte: 'chemin', id: CHEMIN_VOISIN, valeurs: { largeur_m: 4 } }],
      ['un point', { sorte: 'point_plan', id: POINT_VOISIN, valeurs: { nom: 'Pirate' } }],
      ['un lieu', { sorte: 'lieu_rangement', id: LIEU_VOISIN, valeurs: { supprime_le: INSTANT.toISOString() } }],
      ['une place', { sorte: 'place_rangement', id: PLACE_VOISINE, valeurs: { nom: 'Pirate' } }],
      ['un outil', { sorte: 'outil', id: OUTIL_VOISIN, valeurs: { nom: 'Pirate' } }],
    ] as const)('modifier %s d’une autre ferme : rejet, rien d’écrit', async (_cas, changement) => {
      await rejete([changement], /.+/u);
    });
  });

  // ── Droits ──────────────────────────────────────────────────────────────────────────────────

  describe('droits : gérant seulement', () => {
    it.each([
      ['pose un chemin', chemin(1)],
      ['pose un point', { sorte: 'point_plan', id: NOUVEAU(2), valeurs: { nom: 'a', sorte: 'repere', x_m: 0, y_m: 0 } }],
      ['crée un lieu', { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: null, point_plan_id: null } }],
      ['crée une place', { sorte: 'place_rangement', id: NOUVEAU(5), valeurs: { lieu_rangement_id: LIEU_HANGAR, nom: 'coin' } }],
      ['crée un outil', { sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR } }],
    ] as const)('un équipier qui %s : « %s », rien d’écrit', async (_cas, changement) => {
      await rejete([changement], SEUL_LE_GERANT, EQUIPIER);
    });
  });

  // ── Origine ─────────────────────────────────────────────────────────────────────────────────

  describe('origine du plan', () => {
    const fermeVierge = (): void => {
      base.recevoir(`UPDATE ferme SET origine_plan = NULL WHERE id = ?`, [FERME]);
    };

    it('aucun chemin ni point sans origine ; origine puis chemin dans le même appel : accepté, annulable dans l’ordre inverse', async () => {
      fermeVierge();
      await rejete([chemin(1)], /origine/iu);
      await rejete([{ sorte: 'point_plan', id: NOUVEAU(2), valeurs: { nom: 'a', sorte: 'repere', x_m: 0, y_m: 0 } }], /origine/iu);
      const annulation = await placer([{ sorte: 'origine', origine: ORIGINE }, chemin(1)]);
      expect(annulation).toEqual([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { supprime_le: INSTANT.toISOString() } }, { sorte: 'origine', origine: null }]);
      await placer(annulation);
      expect(ligne('ferme', FERME)?.origine_plan).toBeNull();
    });

    it('un lieu et un outil se rangent sans origine (ils n’ont pas de position)', async () => {
      fermeVierge();
      await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Bêche', lieu_rangement_id: LIEU_HANGAR } }]);
      expect(ligne('outil', NOUVEAU(6))).toBeDefined();
    });

    it('un chemin non supprimé fige l’origine ; supprimé, elle se déplace de nouveau', async () => {
      await placer([chemin(1)]);
      await rejete([{ sorte: 'origine', origine: { latitude: 45, longitude: 2 } }], /origine/iu);
      await rejete([{ sorte: 'origine', origine: null }], /origine/iu);
      await placer([{ sorte: 'chemin', id: NOUVEAU(1), valeurs: { supprime_le: INSTANT.toISOString() } }]);
      await placer([{ sorte: 'origine', origine: { latitude: 45, longitude: 2 } }]);
      expect(JSON.parse(typeof ligne('ferme', FERME)?.origine_plan === 'string' ? (ligne('ferme', FERME)?.origine_plan as string) : 'null')).toEqual({ latitude: 45, longitude: 2 });
    });
  });

  it(`plus de ${String(ECRITURES_MAX_PAR_LOT)} changements : rejet avant d’ouvrir une transaction`, async () => {
    const trop = Array.from({ length: ECRITURES_MAX_PAR_LOT + 1 }, (_, i) => chemin(100 + i));
    await rejete(trop, /.+/u);
    expect(transactions).toBe(0);
  });
});
