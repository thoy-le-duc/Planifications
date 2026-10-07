/**
 * Tests d'acceptation T28s — la porte écrit le placement réel (docs/backlog/T28s-placement-serveur.md),
 * côté téléphone/ordinateur (`@planif/sync`), sans réseau, sur un SQLite en mémoire.
 *
 * ── Contrat (proposé par le testeur ; l'éditeur T28b s'en sert) ─────────────────────────────
 *
 *   porte.placer(changements: readonly ChangementPlacement[]): Promise<readonly ChangementPlacement[]>
 *
 * UNE seule fonction d'écriture du placement. Elle rend l'ANNULATION : la liste de changements
 * qui remet les valeurs d'avant, dans l'ordre inverse ; `placer(annulation)` annule (et rend à
 * son tour de quoi refaire). Types ci-dessous (à exporter de packages/sync/src/types.ts, méthode
 * OBLIGATOIRE de `PorteDonnees`).
 *
 * - Une seule transaction locale par appel (un seul envoi au serveur, tout ou rien) ; liste vide :
 *   aucune transaction, rend []. Au plus ECRITURES_MAX_PAR_LOT changements, sinon rejet sans rien
 *   ouvrir. Changements appliqués dans l'ordre donné.
 * - Rejet (promesse rejetée, RIEN d'écrit) dans les cas que le serveur refuserait :
 *     · l'utilisateur de la porte n'est pas gérant actif de la ferme de la porte (ligne locale
 *       `membre` : role 'gerant', etat 'accepte', non supprimée) → message exactement
 *       « Seul le gérant peut placer les éléments de la ferme. » ;
 *     · placement invalide : validerPlacement / validerContour de @planif/core (message du cœur,
 *       en français) ;
 *     · zone, emplacement ou bâtiment d'une autre ferme que celle de la porte, ou zone ou
 *       emplacement introuvable ; zone d'un bâtiment d'une autre ferme ou supprimée ;
 *     · contour non nul sur une zone abritée par un bâtiment non supprimé ; bâtiment rattaché à
 *       une zone qui a un contour (sauf contour effacé plus haut dans le même appel) ; second
 *       bâtiment non supprimé sur une zone ;
 *     · origine déplacée alors qu'elle est posée et qu'un placement existe dans la ferme.
 * - Bâtiment : `id` inconnu localement → création dans la ferme de la porte (tous les champs
 *   requis) ; connu → modification des seules colonnes données. Annuler une création = suppression
 *   douce (`supprime_le` = maintenant de la porte, ISO UTC) : le serveur n'accepte pas de DELETE.
 * - Zone : `contour` rangé en texte JSON, normalisé par validerContour (sens antihoraire, x et y
 *   seulement) ; nul efface. Emplacement : `placement` → placement_x_m, placement_y_m,
 *   orientation_deg ; nul → les trois nuls. Origine : `ferme.origine_plan` en texte JSON
 *   {latitude, longitude}, ou nulle.
 * - Annuler rend EXACTEMENT les valeurs d'avant (colonnes du placement, nom, type, zone,
 *   suppression), lues dans la base locale au moment de l'écriture.
 */
import { ECRITURES_MAX_PAR_LOT, type Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';
import type { PorteDonnees as PorteDonneesDuModule } from './types.ts';

// ── Contrat ──────────────────────────────────────────────────────────────────────────────────

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ValeursBatiment {
  readonly nom?: string;
  readonly type?: 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre';
  readonly longueur_m?: number;
  readonly largeur_m?: number;
  readonly hauteur_m?: number;
  readonly centre_x_m?: number;
  readonly centre_y_m?: number;
  readonly orientation_deg?: number;
  readonly zone_id?: string | null;
  readonly supprime_le?: string | null;
}

type ChangementPlacement =
  | { readonly sorte: 'batiment'; readonly id: string; readonly valeurs: ValeursBatiment }
  | { readonly sorte: 'zone'; readonly id: string; readonly contour: readonly Point[] | null }
  | { readonly sorte: 'emplacement'; readonly id: string; readonly placement: { readonly x: number; readonly y: number; readonly orientation_deg: number } | null }
  | { readonly sorte: 'origine'; readonly origine: { readonly latitude: number; readonly longitude: number } | null };

type PortePlacement = PorteDonnees & { placer?: (changements: readonly ChangementPlacement[]) => Promise<readonly ChangementPlacement[]> };

// ── Jeu d'essai ──────────────────────────────────────────────────────────────────────────────

const GERANT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const EQUIPIER = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b11' as Id<'Utilisateur'>;
const INCONNU = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b12' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b21';
const ZONE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b30';
const ZONE_PLACEE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b31';
const ZONE_VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b32';
const ZONE_SUPPRIMEE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b33';
const PLANCHE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b40';
const PLANCHE_PLACEE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b41';
const PLANCHE_VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b42';
const SERRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50';
const SERRE_VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b51';
const NOUVELLE_SERRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b52';
const AUTRE_NOUVELLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b53';
const INSTANT = new Date('2026-10-07T06:00:00.000Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };

const CARRE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];
const CARRE_HORAIRE: readonly Point[] = [...CARRE].reverse();
const PAPILLON: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];
/** Contour déjà rangé de ZONE_PLACEE, tel qu'il est arrivé par la synchro (texte JSON). */
const CONTOUR_RANGE = '[{"x":0,"y":0},{"x":30,"y":0},{"x":30,"y":12},{"x":0,"y":12}]';

const SERRE_M3: ValeursBatiment = {
  nom: 'Serre M3',
  type: 'serre_tunnel',
  longueur_m: 40,
  largeur_m: 8,
  hauteur_m: 3.5,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 90,
  zone_id: null,
};

/** Bâtiment nouveau à moitié rempli (pas de hauteur). */
const SERRE_SANS_HAUTEUR: ValeursBatiment = Object.fromEntries(Object.entries(SERRE_M3).filter(([c]) => c !== 'hauteur_m'));

const SEUL_LE_GERANT = 'Seul le gérant peut placer les éléments de la ferme.';

interface LigneBatiment {
  id: string;
  ferme_id: string;
  nom: string;
  type: string;
  longueur_m: number;
  largeur_m: number;
  hauteur_m: number;
  centre_x_m: number;
  centre_y_m: number;
  orientation_deg: number;
  zone_id: string | null;
  supprime_le: string | null;
}

describe('T28s : la porte écrit le placement, et rend de quoi l’annuler', () => {
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
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Jardins de Garonne', 'Europe/Paris', NULL, NULL, '{"longueur":"m","masse":"kg"}')`, [FERME]);
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme voisine', 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [VOISINE, JSON.stringify(ORIGINE)]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
    // Le gérant de la ferme est aussi gérant de la voisine (deux fermes sur le même appareil).
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m3', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, VOISINE]);
    const zone = (id: string, ferme: string, contour: string | null, supprimee = false) => {
      r(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, supprime_le) VALUES (?, ?, ?, NULL, 'tunnel', NULL, ?, ?)`, [
        id,
        ferme,
        `Zone ${id.slice(-2)}`,
        contour,
        supprimee ? INSTANT.toISOString() : null,
      ]);
    };
    zone(ZONE, FERME, null);
    zone(ZONE_PLACEE, FERME, CONTOUR_RANGE);
    zone(ZONE_VOISINE, VOISINE, null);
    zone(ZONE_SUPPRIMEE, FERME, null, true);
    const planche = (id: string, ferme: string, zoneId: string, x: number | null, y: number | null, o: number | null) => {
      r(
        `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, remplace, placement_x_m, placement_y_m, orientation_deg)
         VALUES (?, ?, ?, ?, 'planche', 30, '2026-01-01', '[]', ?, ?, ?)`,
        [id, ferme, zoneId, `P-${id.slice(-2)}`, x, y, o],
      );
    };
    planche(PLANCHE, FERME, ZONE, null, null, null);
    planche(PLANCHE_PLACEE, FERME, ZONE_PLACEE, 2, -0.5, 92.5);
    planche(PLANCHE_VOISINE, VOISINE, ZONE_VOISINE, 1, 1, 0);
    const batiment = (id: string, ferme: string, zoneId: string | null) => {
      r(
        `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, supprime_le)
         VALUES (?, ?, 'Hangar', 'hangar', 20, 12, 6, -10, 15, 0, ?, NULL)`,
        [id, ferme, zoneId],
      );
    };
    batiment(SERRE, FERME, null);
    batiment(SERRE_VOISINE, VOISINE, null);
  });

  afterEach(() => {
    base.fermer();
  });

  function porte(utilisateurId: Id<'Utilisateur'> = GERANT): PortePlacement {
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

  function placer(changements: readonly ChangementPlacement[], utilisateurId: Id<'Utilisateur'> = GERANT): Promise<readonly ChangementPlacement[]> {
    const p = porte(utilisateurId);
    expect(typeof p.placer, 'porte.placer (T28s)').toBe('function');
    if (p.placer === undefined) throw new Error('porte.placer absente');
    return p.placer(changements);
  }

  const batiment = (id: string): LigneBatiment | undefined => base.lireDirect<LigneBatiment>('SELECT * FROM batiment WHERE id = ?', [id])[0];
  const contour = (id: string): unknown => base.lireDirect<{ c: string | null }>('SELECT contour AS c FROM zone WHERE id = ?', [id])[0]?.c;
  const contourLu = (id: string): unknown => {
    const c = contour(id);
    return typeof c === 'string' ? JSON.parse(c) : c;
  };
  const placement = (id: string): unknown =>
    base.lireDirect<{ x: number | null; y: number | null; o: number | null }>(
      'SELECT placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = ?',
      [id],
    )[0];
  const origine = (id: string = FERME): unknown => {
    const o = base.lireDirect<{ o: string | null }>('SELECT origine_plan AS o FROM ferme WHERE id = ?', [id])[0]?.o;
    return typeof o === 'string' ? JSON.parse(o) : o;
  };
  /** Instantané de toutes les tables touchées par un placement, pour vérifier que rien n'a bougé. */
  const instantane = (): unknown => ({
    batiment: base.lireDirect('SELECT * FROM batiment ORDER BY id'),
    zone: base.lireDirect('SELECT * FROM zone ORDER BY id'),
    emplacement: base.lireDirect('SELECT * FROM emplacement ORDER BY id'),
    ferme: base.lireDirect('SELECT * FROM ferme ORDER BY id'),
  });

  /** Rejet attendu : rien d'écrit dans la base locale. */
  async function rejete(changements: readonly ChangementPlacement[], attendu: RegExp | string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> {
    const avant = instantane();
    await expect(placer(changements, utilisateurId)).rejects.toThrow(attendu);
    expect(instantane(), 'rien n’est écrit').toEqual(avant);
  }

  it('placer est une méthode obligatoire du type PorteDonnees du module', () => {
    expectTypeOf<PorteDonneesDuModule>().toHaveProperty('placer');
    expect(typeof porte().placer).toBe('function');
  });

  // ── Écrire, puis annuler ────────────────────────────────────────────────────────────────────

  describe('écrire puis annuler rend les valeurs d’avant', () => {
    it('déplacer et tourner un bâtiment, puis annuler : valeurs d’avant exactes', async () => {
      const avant = batiment(SERRE);
      const annulation = await placer([{ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 150, centre_y_m: 30.25, orientation_deg: 271.5 } }]);
      expect(batiment(SERRE)).toMatchObject({ centre_x_m: 150, centre_y_m: 30.25, orientation_deg: 271.5, nom: 'Hangar', longueur_m: 20 });
      expect(annulation).toEqual([{ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: -10, centre_y_m: 15, orientation_deg: 0 } }]);
      await placer(annulation);
      const sansDate = (l: LigneBatiment | undefined): unknown => ({ ...l, modifie_le: 'ignorée' });
      expect(sansDate(batiment(SERRE))).toEqual(sansDate(avant));
    });

    it('créer un bâtiment : écrit dans la ferme de la porte ; annuler = suppression douce à l’instant de la porte', async () => {
      const annulation = await placer([{ sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: SERRE_M3 }]);
      expect(batiment(NOUVELLE_SERRE)).toMatchObject({ ...SERRE_M3, id: NOUVELLE_SERRE, ferme_id: FERME, supprime_le: null });
      expect(annulation).toEqual([{ sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: { supprime_le: INSTANT.toISOString() } }]);
      await placer(annulation);
      expect(batiment(NOUVELLE_SERRE)?.supprime_le).toBe(INSTANT.toISOString());
    });

    it('placer une planche qui ne l’était pas, puis annuler : de nouveau en rangement automatique', async () => {
      const annulation = await placer([{ sorte: 'emplacement', id: PLANCHE, placement: { x: 2, y: 0, orientation_deg: 0 } }]);
      expect(placement(PLANCHE)).toEqual({ x: 2, y: 0, o: 0 });
      expect(annulation).toEqual([{ sorte: 'emplacement', id: PLANCHE, placement: null }]);
      await placer(annulation);
      expect(placement(PLANCHE)).toEqual({ x: null, y: null, o: null });
    });

    it('déplacer une planche placée, puis annuler : position d’avant exacte', async () => {
      const annulation = await placer([{ sorte: 'emplacement', id: PLANCHE_PLACEE, placement: { x: 3.1, y: 0.2, orientation_deg: 90 } }]);
      expect(placement(PLANCHE_PLACEE)).toEqual({ x: 3.1, y: 0.2, o: 90 });
      await placer(annulation);
      expect(placement(PLANCHE_PLACEE)).toEqual({ x: 2, y: -0.5, o: 92.5 });
    });

    it('contour en sens horaire : rangé antihoraire en texte JSON ; annuler rend le contour d’avant', async () => {
      const annulation = await placer([{ sorte: 'zone', id: ZONE_PLACEE, contour: CARRE_HORAIRE }]);
      expect(typeof contour(ZONE_PLACEE), 'texte JSON, comme PowerSync le range').toBe('string');
      expect(contourLu(ZONE_PLACEE)).toEqual(CARRE);
      await placer(annulation);
      expect(contourLu(ZONE_PLACEE)).toEqual(JSON.parse(CONTOUR_RANGE));
    });

    it('effacer un contour, puis annuler : contour revenu', async () => {
      const annulation = await placer([{ sorte: 'zone', id: ZONE_PLACEE, contour: null }]);
      expect(contour(ZONE_PLACEE)).toBeNull();
      await placer(annulation);
      expect(contourLu(ZONE_PLACEE)).toEqual(JSON.parse(CONTOUR_RANGE));
    });

    it('poser l’origine et le premier bâtiment ensemble, puis annuler : bâtiment supprimé PUIS origine nulle (ordre inverse)', async () => {
      const annulation = await placer([
        { sorte: 'origine', origine: ORIGINE },
        { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: SERRE_M3 },
      ]);
      expect(origine()).toEqual(ORIGINE);
      expect(annulation).toEqual([
        { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: { supprime_le: INSTANT.toISOString() } },
        { sorte: 'origine', origine: null },
      ]);
      await placer(annulation);
      expect(origine()).toBeNull();
      expect(batiment(NOUVELLE_SERRE)?.supprime_le).toBe(INSTANT.toISOString());
    });

    it('annuler l’annulation (refaire) : le placement revient', async () => {
      const annulation = await placer([{ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 80 } }]);
      const refaire = await placer(annulation);
      expect(batiment(SERRE)?.centre_x_m).toBe(-10);
      await placer(refaire);
      expect(batiment(SERRE)?.centre_x_m).toBe(80);
    });

    it('plusieurs changements : UNE seule transaction (un seul envoi), annulés ensemble', async () => {
      const annulation = await placer([
        { sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 0 } },
        { sorte: 'emplacement', id: PLANCHE, placement: { x: 1, y: 1, orientation_deg: 45 } },
        { sorte: 'zone', id: ZONE_PLACEE, contour: CARRE },
      ]);
      expect(transactions).toBe(1);
      await placer(annulation);
      expect(transactions).toBe(2);
      expect(batiment(SERRE)?.centre_x_m).toBe(-10);
      expect(placement(PLANCHE)).toEqual({ x: null, y: null, o: null });
      expect(contourLu(ZONE_PLACEE)).toEqual(JSON.parse(CONTOUR_RANGE));
    });

    it('liste vide : aucune transaction, rien à annuler', async () => {
      expect(await placer([])).toEqual([]);
      expect(transactions).toBe(0);
    });

    it(`plus de ${String(ECRITURES_MAX_PAR_LOT)} changements : rejet avant d’ouvrir une transaction`, async () => {
      const trop = Array.from({ length: ECRITURES_MAX_PAR_LOT + 1 }, (): ChangementPlacement => ({ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 1 } }));
      await rejete(trop, /.+/u);
      expect(transactions).toBe(0);
    });

    it('rattacher une serre à une zone en effaçant son contour dans le même appel : accepté, annulable', async () => {
      const annulation = await placer([
        { sorte: 'zone', id: ZONE_PLACEE, contour: null },
        { sorte: 'batiment', id: SERRE, valeurs: { zone_id: ZONE_PLACEE } },
      ]);
      expect(batiment(SERRE)?.zone_id).toBe(ZONE_PLACEE);
      expect(contour(ZONE_PLACEE)).toBeNull();
      await placer(annulation);
      expect(batiment(SERRE)?.zone_id).toBeNull();
      expect(contourLu(ZONE_PLACEE)).toEqual(JSON.parse(CONTOUR_RANGE));
    });
  });

  // ── Rejets : rien d'écrit ───────────────────────────────────────────────────────────────────

  describe('droits (Q31) : gérant seulement', () => {
    it.each([
      ['crée un bâtiment', { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: SERRE_M3 }],
      ['déplace un bâtiment', { sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 0 } }],
      ['déplace une planche', { sorte: 'emplacement', id: PLANCHE_PLACEE, placement: { x: 0, y: 0, orientation_deg: 0 } }],
      ['change un contour', { sorte: 'zone', id: ZONE, contour: CARRE }],
      ['pose l’origine', { sorte: 'origine', origine: ORIGINE }],
    ] as const)('un équipier qui %s : rejet « %s », rien d’écrit', async (_cas, changement) => {
      await rejete([changement], SEUL_LE_GERANT, EQUIPIER);
    });

    it('un utilisateur sans ligne de membre locale : rejet, rien d’écrit', async () => {
      await rejete([{ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 0 } }], SEUL_LE_GERANT, INCONNU);
    });

    it('un gérant retiré (membre supprimé) : rejet', async () => {
      base.recevoir(`UPDATE membre SET supprime_le = ? WHERE id = 'm1'`, [INSTANT.toISOString()]);
      await rejete([{ sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 0 } }], SEUL_LE_GERANT);
    });
  });

  describe('validation : les règles du cœur, rejouées avant d’écrire', () => {
    it.each([
      ['bâtiment orienté à 360°', { sorte: 'batiment', id: SERRE, valeurs: { orientation_deg: 360 } }, /orientation/iu],
      ['bâtiment à 6 km', { sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 6000, centre_y_m: 0 } }, /5 km/iu],
      ['bâtiment de 501 m', { sorte: 'batiment', id: SERRE, valeurs: { longueur_m: 501 } }, /500/u],
      ['nouveau bâtiment sans hauteur', { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: SERRE_SANS_HAUTEUR }, /hauteur|manque/iu],
      ['planche orientée à 360°', { sorte: 'emplacement', id: PLANCHE, placement: { x: 0, y: 0, orientation_deg: 360 } }, /orientation/iu],
      ['planche à 6 km', { sorte: 'emplacement', id: PLANCHE, placement: { x: 6000, y: 0, orientation_deg: 0 } }, /5 km/iu],
      ['contour auto-intersectant', { sorte: 'zone', id: ZONE, contour: PAPILLON }, /recoupe/iu],
      ['contour de 2 sommets', { sorte: 'zone', id: ZONE, contour: CARRE.slice(0, 2) }, /sommets/iu],
      ['contour de 201 sommets', { sorte: 'zone', id: ZONE, contour: Array.from({ length: 201 }, (_, i) => ({ x: 50 * Math.cos(i / 32), y: 50 * Math.sin(i / 32) })) }, /sommets/iu],
      ['origine hors du globe', { sorte: 'origine', origine: { latitude: 95, longitude: 0 } }, /.+/u],
    ] as const)('%s : rejet, rien d’écrit', async (_cas, changement, attendu) => {
      await rejete([changement], attendu);
    });

    it('un changement invalide en fin d’appel : rien des changements valides d’avant n’est écrit', async () => {
      await rejete(
        [
          { sorte: 'batiment', id: SERRE, valeurs: { centre_x_m: 0 } },
          { sorte: 'emplacement', id: PLANCHE, placement: { x: 1, y: 1, orientation_deg: 0 } },
          { sorte: 'zone', id: ZONE, contour: PAPILLON },
        ],
        /recoupe/iu,
      );
    });

    it('contour sur une zone abritée par un bâtiment : rejet', async () => {
      base.recevoir(`UPDATE batiment SET zone_id = ? WHERE id = ?`, [ZONE, SERRE]);
      await rejete([{ sorte: 'zone', id: ZONE, contour: CARRE }], /abrit/iu);
    });

    it('bâtiment rattaché à une zone qui a un contour (sans l’effacer) : rejet', async () => {
      await rejete([{ sorte: 'batiment', id: SERRE, valeurs: { zone_id: ZONE_PLACEE } }], /contour/iu);
    });

    it('second bâtiment sur une zone déjà abritée : rejet', async () => {
      base.recevoir(`UPDATE batiment SET zone_id = ? WHERE id = ?`, [ZONE, SERRE]);
      await rejete([{ sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: { ...SERRE_M3, zone_id: ZONE } }], /.+/u);
    });

    it('deux nouveaux bâtiments sur la même zone dans le même appel : rejet', async () => {
      await rejete(
        [
          { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: { ...SERRE_M3, zone_id: ZONE } },
          { sorte: 'batiment', id: AUTRE_NOUVELLE, valeurs: { ...SERRE_M3, zone_id: ZONE } },
        ],
        /.+/u,
      );
    });

    it('déplacer l’origine alors qu’un placement existe : rejet ; la poser quand elle est nulle : accepté', async () => {
      await placer([{ sorte: 'origine', origine: ORIGINE }]);
      expect(origine()).toEqual(ORIGINE);
      await rejete([{ sorte: 'origine', origine: { latitude: 45, longitude: 2 } }], /origine|point de départ/iu);
    });

    it('déplacer l’origine quand aucun placement n’existe encore : accepté', async () => {
      base.recevoir(`UPDATE ferme SET origine_plan = ? WHERE id = ?`, [JSON.stringify(ORIGINE), FERME]);
      base.recevoir(`UPDATE batiment SET supprime_le = ? WHERE ferme_id = ?`, [INSTANT.toISOString(), FERME]);
      base.recevoir(`UPDATE zone SET contour = NULL WHERE ferme_id = ?`, [FERME]);
      base.recevoir(`UPDATE emplacement SET placement_x_m = NULL, placement_y_m = NULL, orientation_deg = NULL WHERE ferme_id = ?`, [FERME]);
      await placer([{ sorte: 'origine', origine: { latitude: 45, longitude: 2 } }]);
      expect(origine()).toEqual({ latitude: 45, longitude: 2 });
    });
  });

  describe('isolement : seulement la ferme de la porte', () => {
    it.each([
      ['un bâtiment de la ferme voisine (même gérant)', { sorte: 'batiment', id: SERRE_VOISINE, valeurs: { centre_x_m: 0 } }],
      ['la zone de la ferme voisine', { sorte: 'zone', id: ZONE_VOISINE, contour: CARRE }],
      ['la planche de la ferme voisine', { sorte: 'emplacement', id: PLANCHE_VOISINE, placement: { x: 0, y: 0, orientation_deg: 0 } }],
      ['une zone introuvable', { sorte: 'zone', id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5bff', contour: CARRE }],
      ['une planche introuvable', { sorte: 'emplacement', id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5bfe', placement: null }],
      ['un bâtiment qui abrite une zone voisine', { sorte: 'batiment', id: SERRE, valeurs: { zone_id: ZONE_VOISINE } }],
      ['un nouveau bâtiment qui abrite une zone voisine', { sorte: 'batiment', id: NOUVELLE_SERRE, valeurs: { ...SERRE_M3, zone_id: ZONE_VOISINE } }],
      ['un bâtiment qui abrite une zone supprimée', { sorte: 'batiment', id: SERRE, valeurs: { zone_id: ZONE_SUPPRIMEE } }],
    ] as const)('%s : rejet, rien d’écrit (la voisine non plus)', async (_cas, changement) => {
      await rejete([changement], /.+/u);
      expect(batiment(SERRE_VOISINE)).toMatchObject({ ferme_id: VOISINE, centre_x_m: -10, zone_id: null });
      expect(contour(ZONE_VOISINE)).toBeNull();
      expect(placement(PLANCHE_VOISINE)).toEqual({ x: 1, y: 1, o: 0 });
    });

    it('l’origine posée est celle de la ferme de la porte, jamais celle de la voisine', async () => {
      await placer([{ sorte: 'origine', origine: { latitude: 43, longitude: 1 } }]);
      expect(origine(FERME)).toEqual({ latitude: 43, longitude: 1 });
      expect(origine(VOISINE)).toEqual(ORIGINE);
    });
  });
});
