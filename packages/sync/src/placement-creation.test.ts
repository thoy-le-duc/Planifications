/**
 * Tests d'acceptation T89 — `porte.placer` CRÉE la zone, les sous-zones et les emplacements d'une serre, dans le même enregistrement
 * que le bâtiment (docs/backlog/T89-ajouter-serre.md, règle 4 ; décision du chef : ticket critique, la synchro est touchée). Sans réseau,
 * sur un SQLite en mémoire. Côté serveur : apps/api/src/sync/serre-creation.integration.test.ts.
 *
 * ── Contrat (à fournir dans packages/sync/src/types.ts et placement.ts) ──────────────────────────────────────────────────────
 *
 * Deux sortes de plus dans `ChangementPlacement` :
 *
 *   { sorte: 'zone_creation';        id: string; valeurs: ValeursZoneCreation }
 *   { sorte: 'emplacement_creation'; id: string; valeurs: ValeursEmplacementCreation }
 *
 *   ValeursZoneCreation        { nom?: string; zone_parente_id?: string | null; type_abri?: string | null; surface_m2?: number | null; supprime_le?: string | null }
 *   ValeursEmplacementCreation { zone_id?: string; code?: string; sorte?: string; longueur_m?: number; largeur_m?: number | null;
 *                                placement?: { x: number; y: number; orientation_deg: number } | null; supprime_le?: string | null }
 *
 * Création : les valeurs requises sont `nom` (zone) ; `zone_id`, `code`, `longueur_m` (emplacement) ; `sorte` vaut 'planche' si absente.
 * La porte écrit la ligne avec `ferme_id` de la porte, `actif_du` = jour de la porte (AAAA-MM-JJ), `remplace` = '[]', `cree_le`/`modifie_le` =
 * instant de la porte. `placement` est écrit dans placement_x_m / placement_y_m / orientation_deg (repère de la zone, comme la sorte 'emplacement').
 *
 * Contrôles IDENTIQUES à ceux de la porte et du serveur : gérant actif seulement (SEUL_LE_GERANT) ; règles du cœur (validerPlacement pour le placement
 * d'un emplacement) ; origine du plan posée avant tout emplacement placé ; sous-zone : la zone parente est de la ferme de la porte et non supprimée ;
 * emplacement : sa zone est de la ferme de la porte et non supprimée ; code d'emplacement non vide et unique dans sa zone (Q27, sans casse ni espaces
 * autour) ; identifiant déjà pris par une ligne d'une AUTRE ferme : rejet, la ligne de l'autre ferme n'est jamais modifiée.
 * Tout se passe dans l'unique transaction de `placer` : un rejet n'écrit rien (les créations déjà faites dans l'appel sont défaites).
 *
 * Annulation (rendue par `placer`, dans l'ordre inverse des changements) : suppression douce des lignes créées, mêmes sortes :
 *   { sorte: 'emplacement_creation', id, valeurs: { supprime_le } } puis { sorte: 'zone_creation', id, valeurs: { supprime_le } } …
 * Les emplacements d'une zone sont donc retirés AVANT la zone (le serveur refuse de retirer une zone qui contient des emplacements).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type ChangementPlacement } from './index.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

type Changement = ChangementPlacement;
type Valeurs = Record<string, unknown>;
// Les nouvelles sortes n'existent pas encore dans le type : on les fabrique sans typage fort pour que l'échec vienne de la porte.
const zoneNeuve = (id: string, valeurs: Valeurs): Changement => ({ sorte: 'zone_creation', id, valeurs }) as unknown as Changement;
const emplacementNeuf = (id: string, valeurs: Valeurs): Changement => ({ sorte: 'emplacement_creation', id, valeurs }) as unknown as Changement;
const batimentDe = (id: string, valeurs: Valeurs): Changement => ({ sorte: 'batiment', id, valeurs }) as unknown as Changement;

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5${n.toString(16).padStart(3, '0')}`;
const GERANT = uuid(0x10) as Id<'Utilisateur'>;
const EQUIPIER = uuid(0x11) as Id<'Utilisateur'>;
const FERME = uuid(0x20) as Id<'Ferme'>;
const VOISINE = uuid(0x21);
const ZONE_VOISINE = uuid(0x30);
const EMPLACEMENT_VOISIN = uuid(0x31);
const ZONE_SUPPRIMEE = uuid(0x32);
const ZONE_EXISTANTE = uuid(0x33);
const SERRE = uuid(0x40);
const ZONE_SERRE = uuid(0x41);
const sousZone = (k: number): string => uuid(0x100 + k);
const planche = (zone: number, k: number): string => uuid(0x400 + zone * 0x20 + k);
const INSTANT = new Date('2026-10-30T06:00:00.000Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };
const DEBUT = '2026-10-30';

interface LigneZone {
  id: string;
  ferme_id: string;
  nom: string;
  zone_parente_id: string | null;
  type_abri: string | null;
  contour: string | null;
  supprime_le: string | null;
}
interface LigneEmplacement {
  id: string;
  ferme_id: string;
  zone_id: string;
  code: string;
  sorte: string;
  longueur_m: number;
  largeur_m: number | null;
  actif_du: string;
  remplace: string;
  placement_x_m: number | null;
  placement_y_m: number | null;
  orientation_deg: number | null;
  supprime_le: string | null;
}
interface LigneBatiment {
  id: string;
  ferme_id: string;
  zone_id: string | null;
  type: string;
  nb_chapelles: number | null;
  supprime_le: string | null;
}

/** Les changements d'une serre à `n` sous-zones de `p` planches chacune : zone, sous-zones, emplacements, puis le bâtiment qui l'abrite. */
function serre(n: number, p: number, options: { readonly parent?: string; readonly placees?: boolean } = {}): Changement[] {
  const parent = options.parent ?? ZONE_SERRE;
  const liste: Changement[] = [zoneNeuve(ZONE_SERRE, { nom: 'Serre à légumes', type_abri: 'tunnel', zone_parente_id: null })];
  for (let z = 1; z <= n; z++) {
    liste.push(zoneNeuve(sousZone(z), { nom: `Serre à légumes ${String(z)}`, type_abri: 'tunnel', zone_parente_id: parent }));
    for (let k = 1; k <= p; k++) {
      liste.push(
        emplacementNeuf(planche(z, k), {
          zone_id: sousZone(z),
          code: `P${String(k)}`,
          sorte: 'planche',
          longueur_m: 38,
          largeur_m: 0.75,
          placement: options.placees === false ? null : { x: 0.375 + (k - 1) * 1.2, y: 0, orientation_deg: 0 },
        }),
      );
    }
  }
  liste.push(
    batimentDe(SERRE, {
      nom: 'Serre à légumes',
      type: n > 1 ? 'serre_chapelle' : 'serre_tunnel',
      longueur_m: 40,
      largeur_m: 9.6 * n,
      hauteur_m: 4,
      centre_x_m: 10,
      centre_y_m: 20,
      orientation_deg: 0,
      zone_id: ZONE_SERRE,
      nb_chapelles: n,
      nb_troncons: 1,
      largeur_allee_m: 4.4,
    }),
  );
  return liste;
}

describe('T89 : la porte crée zone, sous-zones et emplacements dans le même enregistrement que la serre', () => {
  let base: BaseMemoire;
  let transactions: number;
  let origine: boolean;

  function monter(avecOrigine: boolean): void {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    origine = avecOrigine;
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    const o = avecOrigine ? JSON.stringify(ORIGINE) : null;
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Jardins de Garonne', 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [FERME, o]);
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme voisine', 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [VOISINE, JSON.stringify(ORIGINE)]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m3', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, VOISINE]);
    const zone = (id: string, ferme: string, nom: string, supprimee: string | null = null): void => {
      r(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, supprime_le) VALUES (?, ?, ?, NULL, 'tunnel', NULL, NULL, ?)`, [id, ferme, nom, supprimee]);
    };
    zone(ZONE_VOISINE, VOISINE, 'Zone voisine');
    zone(ZONE_SUPPRIMEE, FERME, 'Zone retirée', INSTANT.toISOString());
    zone(ZONE_EXISTANTE, FERME, 'Zone déjà là');
    r(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, remplace, placement_x_m, placement_y_m, orientation_deg)
       VALUES (?, ?, ?, 'P1', 'planche', 30, '2026-01-01', '[]', 1, 1, 0)`,
      [EMPLACEMENT_VOISIN, VOISINE, ZONE_VOISINE],
    );
  }

  beforeEach(() => {
    transactions = 0;
    monter(true);
  });
  afterEach(() => {
    base.fermer();
  });

  function placer(changements: readonly Changement[], utilisateurId: Id<'Utilisateur'> = GERANT): Promise<readonly Changement[]> {
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    return creerPorte(compteuse, { utilisateurId, fermeId: FERME, maintenant: () => INSTANT }).placer(changements);
  }

  /**
   * Rejet par une règle de la porte, pas « sorte inconnue » : tant que les nouvelles sortes n'existent pas, ce garde-fou empêche
   * un test de refus de passer sans que la règle soit écrite.
   */
  async function refus(appel: Promise<unknown>, attendu?: RegExp): Promise<void> {
    const erreur: unknown = await appel.then(
      () => null,
      (e: unknown) => e,
    );
    expect(erreur, 'la porte devait refuser').toBeInstanceOf(Error);
    const message = (erreur as Error).message;
    expect(message, 'refus pour la bonne raison').not.toMatch(/placement inconnu/i);
    if (attendu !== undefined) expect(message).toMatch(attendu);
  }

  const zone = (id: string): LigneZone | undefined => base.lireDirect<LigneZone>('SELECT * FROM zone WHERE id = ?', [id])[0];
  const emplacement = (id: string): LigneEmplacement | undefined => base.lireDirect<LigneEmplacement>('SELECT * FROM emplacement WHERE id = ?', [id])[0];
  const batiment = (id: string): LigneBatiment | undefined => base.lireDirect<LigneBatiment>('SELECT * FROM batiment WHERE id = ?', [id])[0];
  const compte = (sql: string): number => base.lireDirect<{ n: number }>(sql)[0]?.n ?? -1;
  const zonesEnService = (): number => compte('SELECT count(*) AS n FROM zone WHERE ferme_id = ' + `'${FERME}'` + ' AND supprime_le IS NULL');
  const emplacementsEnService = (): number => compte('SELECT count(*) AS n FROM emplacement WHERE ferme_id = ' + `'${FERME}'` + ' AND supprime_le IS NULL');
  const batimentsEnService = (): number => compte('SELECT count(*) AS n FROM batiment WHERE ferme_id = ' + `'${FERME}'` + ' AND supprime_le IS NULL');
  const rienDeNouveau = (): void => {
    // Seule « Zone déjà là » est en service (la supprimée et celle de la voisine ne comptent pas) ; aucun emplacement ni bâtiment de la ferme.
    expect(zonesEnService()).toBe(1);
    expect(emplacementsEnService()).toBe(0);
    expect(batimentsEnService()).toBe(0);
  };

  describe('un seul placer écrit tout', () => {
    it('tunnel Manon : 1 zone, 3 sous-zones, 2 planches par sous-zone, le bâtiment — une transaction', async () => {
      await placer(serre(3, 2));
      expect(transactions).toBe(1);
      expect(zone(ZONE_SERRE)).toMatchObject({ ferme_id: FERME, nom: 'Serre à légumes', zone_parente_id: null, type_abri: 'tunnel', contour: null, supprime_le: null });
      for (const z of [1, 2, 3]) {
        expect(zone(sousZone(z))).toMatchObject({ ferme_id: FERME, nom: `Serre à légumes ${String(z)}`, zone_parente_id: ZONE_SERRE, contour: null, supprime_le: null });
        for (const k of [1, 2]) {
          expect(emplacement(planche(z, k))).toMatchObject({
            ferme_id: FERME,
            zone_id: sousZone(z),
            code: `P${String(k)}`,
            sorte: 'planche',
            longueur_m: 38,
            largeur_m: 0.75,
            actif_du: DEBUT,
            remplace: '[]',
            placement_x_m: 0.375 + (k - 1) * 1.2,
            placement_y_m: 0,
            orientation_deg: 0,
            supprime_le: null,
          });
        }
      }
      expect(batiment(SERRE)).toMatchObject({ ferme_id: FERME, zone_id: ZONE_SERRE, type: 'serre_chapelle', nb_chapelles: 3, supprime_le: null });
    });

    it('serre à légumes : 18 sous-zones et 144 planches (164 changements) tiennent dans un seul placer', async () => {
      await placer(serre(18, 8));
      expect(transactions).toBe(1);
      expect(zonesEnService()).toBe(1 + 1 + 18);
      expect(emplacementsEnService()).toBe(144);
      expect(base.lireDirect('SELECT 1 FROM emplacement WHERE placement_x_m IS NULL AND ferme_id = ?', [FERME])).toHaveLength(0);
    });

    it('emplacement sans placement (rangement automatique) : créé, non placé', async () => {
      await placer(serre(1, 2, { placees: false }));
      expect(emplacement(planche(1, 1))).toMatchObject({ placement_x_m: null, placement_y_m: null, orientation_deg: null });
    });

    it('sorte omise : « planche »', async () => {
      await placer([
        zoneNeuve(ZONE_SERRE, { nom: 'Serre' }),
        emplacementNeuf(planche(1, 1), { zone_id: ZONE_SERRE, code: 'P1', longueur_m: 20, placement: null }),
      ]);
      expect(emplacement(planche(1, 1))?.sorte).toBe('planche');
    });

    it('identifiants en majuscules : rangés en minuscules, comme les autres sortes', async () => {
      await placer([zoneNeuve(ZONE_SERRE.toUpperCase(), { nom: 'Serre' })]);
      expect(zone(ZONE_SERRE)?.nom).toBe('Serre');
    });
  });

  describe('refus : rien n’est écrit', () => {
    it('un équipier ne crée rien : message du gérant', async () => {
      await expect(placer(serre(3, 2), EQUIPIER)).rejects.toThrow('Seul le gérant peut placer les éléments de la ferme.');
      rienDeNouveau();
      expect(zone(ZONE_SERRE)).toBeUndefined();
    });

    it('un gérant de la ferme voisine seulement n’écrit pas dans cette ferme', async () => {
      base.recevoir("UPDATE membre SET supprime_le = '2026-10-01T00:00:00.000Z' WHERE id = 'm1'", []);
      await refus(placer(serre(1, 1)));
      rienDeNouveau();
    });

    it('sous-zone dont la zone parente est d’une autre ferme : rejet, et la zone créée plus tôt dans l’appel est défaite', async () => {
      await refus(placer([zoneNeuve(ZONE_SERRE, { nom: 'Serre' }), zoneNeuve(sousZone(1), { nom: 'Serre 1', zone_parente_id: ZONE_VOISINE })]));
      expect(zone(ZONE_SERRE)).toBeUndefined();
      expect(zone(sousZone(1))).toBeUndefined();
    });

    it('sous-zone dont la zone parente n’existe pas, ou est supprimée : rejet', async () => {
      await refus(placer([zoneNeuve(sousZone(1), { nom: 'S 1', zone_parente_id: uuid(0x999) })]));
      await refus(placer([zoneNeuve(sousZone(2), { nom: 'S 2', zone_parente_id: ZONE_SUPPRIMEE })]));
      expect(zone(sousZone(1))).toBeUndefined();
      expect(zone(sousZone(2))).toBeUndefined();
    });

    it('emplacement dans une zone d’une autre ferme : rejet', async () => {
      await refus(placer([emplacementNeuf(planche(1, 1), { zone_id: ZONE_VOISINE, code: 'P9', longueur_m: 30, placement: null })]));
      expect(emplacement(planche(1, 1))).toBeUndefined();
      expect(base.lireDirect('SELECT 1 FROM emplacement WHERE zone_id = ?', [ZONE_VOISINE])).toHaveLength(1);
    });

    it('emplacement dans une zone inexistante ou supprimée : rejet', async () => {
      await refus(placer([emplacementNeuf(planche(1, 1), { zone_id: uuid(0x998), code: 'P1', longueur_m: 30, placement: null })]));
      await refus(placer([emplacementNeuf(planche(1, 2), { zone_id: ZONE_SUPPRIMEE, code: 'P1', longueur_m: 30, placement: null })]));
      expect(emplacementsEnService()).toBe(0);
    });

    it('identifiant de zone déjà pris par une autre ferme : rejet, la zone voisine n’est pas écrasée', async () => {
      await refus(placer([zoneNeuve(ZONE_VOISINE, { nom: 'Écrasée !', type_abri: 'serre' })]));
      expect(zone(ZONE_VOISINE)).toMatchObject({ ferme_id: VOISINE, nom: 'Zone voisine', type_abri: 'tunnel' });
    });

    it('identifiant d’emplacement déjà pris par une autre ferme : rejet, la planche voisine n’est pas écrasée', async () => {
      await refus(placer([emplacementNeuf(EMPLACEMENT_VOISIN, { zone_id: ZONE_EXISTANTE, code: 'P1', longueur_m: 99, placement: null })]));
      expect(emplacement(EMPLACEMENT_VOISIN)).toMatchObject({ ferme_id: VOISINE, zone_id: ZONE_VOISINE, longueur_m: 30 });
    });

    it('même identifiant que la suppression douce de l’autre ferme : toujours un rejet', async () => {
      base.recevoir("UPDATE zone SET supprime_le = '2026-10-01T00:00:00.000Z' WHERE id = ?", [ZONE_VOISINE]);
      await refus(placer([zoneNeuve(ZONE_VOISINE, { nom: 'Reprise' })]));
      expect(zone(ZONE_VOISINE)).toMatchObject({ ferme_id: VOISINE, nom: 'Zone voisine' });
    });

    it('un échec au milieu défait tout : dernière planche vers une zone d’une autre ferme', async () => {
      const liste = serre(3, 2);
      liste.splice(liste.length - 1, 0, emplacementNeuf(planche(9, 9), { zone_id: ZONE_VOISINE, code: 'P9', longueur_m: 30, placement: null }));
      await refus(placer(liste));
      rienDeNouveau();
      expect(zone(ZONE_SERRE)).toBeUndefined();
    });

    it.each([
      ['nom de zone vide', () => zoneNeuve(ZONE_SERRE, { nom: '   ' })],
      ['nom de zone absent', () => zoneNeuve(ZONE_SERRE, { type_abri: 'tunnel' })],
      ['nom de zone trop long', () => zoneNeuve(ZONE_SERRE, { nom: 'x'.repeat(201) })],
      ['nom de zone avec un caractère nul', () => zoneNeuve(ZONE_SERRE, { nom: 'Se\u0000rre' })],
      ['identifiant de zone illisible', () => zoneNeuve('pas-un-uuid', { nom: 'Serre' })],
      ['colonne inconnue sur la zone', () => zoneNeuve(ZONE_SERRE, { nom: 'Serre', ferme_id: VOISINE })],
      ['zone créée déjà supprimée', () => zoneNeuve(ZONE_SERRE, { nom: 'Serre', supprime_le: '2026-10-30T06:00:00.000Z' })],
    ])('%s : rejet, rien d’écrit', async (_cas, fabriquer) => {
      await refus(placer([fabriquer()]));
      rienDeNouveau();
    });

    it.each([
      ['code vide', { code: '  ' }],
      ['code absent', { code: undefined }],
      ['longueur négative', { longueur_m: -1 }],
      ['longueur absente', { longueur_m: undefined }],
      ['colonne inconnue', { ferme_id: VOISINE }],
      ['orientation hors bornes', { placement: { x: 1, y: 1, orientation_deg: 400 } }],
      ['position qui n’est pas un nombre', { placement: { x: Number.NaN, y: 1, orientation_deg: 0 } }],
    ])('emplacement — %s : rejet, rien d’écrit', async (_cas, ecart) => {
      const valeurs: Valeurs = Object.fromEntries(
        Object.entries({ zone_id: ZONE_EXISTANTE, code: 'P1', longueur_m: 30, largeur_m: 0.75, placement: { x: 0, y: 0, orientation_deg: 0 }, ...ecart }).filter(([, v]) => v !== undefined),
      );
      await refus(placer([emplacementNeuf(planche(1, 1), valeurs)]));
      expect(emplacementsEnService()).toBe(0);
    });

    it('code déjà pris dans la même zone (« p1 » après « P1 », sans casse) : rejet, comme le serveur (Q27)', async () => {
      await refus(
        placer([
          emplacementNeuf(planche(1, 1), { zone_id: ZONE_EXISTANTE, code: 'P1', longueur_m: 30, placement: null }),
          emplacementNeuf(planche(1, 2), { zone_id: ZONE_EXISTANTE, code: ' p1 ', longueur_m: 30, placement: null }),
        ]),
      );
      expect(emplacementsEnService()).toBe(0);
    });

    it('le même code dans deux zones différentes est permis (P1 dans chaque sous-zone)', async () => {
      await placer(serre(2, 1));
      expect(emplacement(planche(1, 1))?.code).toBe('P1');
      expect(emplacement(planche(2, 1))?.code).toBe('P1');
    });

    it('sans origine du plan : une planche placée est refusée, un emplacement non placé et la zone passent', async () => {
      base.fermer();
      monter(false);
      await refus(placer(serre(1, 1)), /point de départ/);
      rienDeNouveau();
      await placer([zoneNeuve(ZONE_SERRE, { nom: 'Serre' }), emplacementNeuf(planche(1, 1), { zone_id: ZONE_SERRE, code: 'P1', longueur_m: 30, placement: null })]);
      expect(origine).toBe(false);
      expect(emplacement(planche(1, 1))).toMatchObject({ placement_x_m: null });
    });

    it('plus de 500 changements : rejet avant d’ouvrir une transaction', async () => {
      const trop = Array.from({ length: 501 }, (_x, i) => zoneNeuve(uuid(0x2000 + i), { nom: `Z${String(i)}` }));
      await refus(placer(trop));
      expect(transactions).toBe(0);
    });
  });

  describe('annulation', () => {
    it('annuler une serre complète ne laisse rien : zones, emplacements et bâtiment en suppression douce, le reste intact', async () => {
      const annulation = await placer(serre(3, 2));
      expect(zonesEnService()).toBe(1 + 1 + 3);
      await placer(annulation);
      rienDeNouveau();
      expect(zone(ZONE_SERRE)?.supprime_le).not.toBeNull();
      expect(zone(sousZone(2))?.supprime_le).not.toBeNull();
      expect(emplacement(planche(3, 2))?.supprime_le).not.toBeNull();
      expect(batiment(SERRE)?.supprime_le).not.toBeNull();
      // Les lignes de l'autre ferme n'ont pas bougé.
      expect(zone(ZONE_VOISINE)?.supprime_le).toBeNull();
      expect(emplacement(EMPLACEMENT_VOISIN)?.supprime_le).toBeNull();
    });

    it('l’annulation retire les emplacements AVANT leur zone, et les sous-zones AVANT leur zone parente (règle du serveur)', async () => {
      const annulation = (await placer(serre(2, 2))) as readonly { sorte: string; id: string }[];
      const rang = (sorte: string, id: string): number => annulation.findIndex((c) => c.sorte === sorte && c.id === id);
      expect(annulation.filter((c) => c.sorte === 'emplacement_creation')).toHaveLength(4);
      for (const z of [1, 2]) {
        for (const k of [1, 2]) expect(rang('emplacement_creation', planche(z, k))).toBeLessThan(rang('zone_creation', sousZone(z)));
        expect(rang('zone_creation', sousZone(z))).toBeLessThan(rang('zone_creation', ZONE_SERRE));
      }
      expect(rang('batiment', SERRE)).toBeLessThan(rang('zone_creation', ZONE_SERRE));
    });

    it('l’annulation écrit l’instant de la porte, en un seul placer', async () => {
      const annulation = await placer(serre(1, 1));
      transactions = 0;
      await placer(annulation);
      expect(transactions).toBe(1);
      expect(zone(ZONE_SERRE)?.supprime_le).toBe(INSTANT.toISOString());
      expect(emplacement(planche(1, 1))?.supprime_le).toBe(INSTANT.toISOString());
    });

    it('annuler une création refusée n’a rien à annuler : la porte a déjà tout défait', async () => {
      await refus(placer([...serre(1, 1), zoneNeuve(ZONE_VOISINE, { nom: 'x' })]));
      rienDeNouveau();
    });

    it('un équipier ne peut pas rejouer l’annulation d’un gérant', async () => {
      const annulation = await placer(serre(1, 1));
      await expect(placer(annulation, EQUIPIER)).rejects.toThrow('Seul le gérant peut placer les éléments de la ferme.');
      expect(zone(ZONE_SERRE)?.supprime_le).toBeNull();
    });
  });

  describe('isolement : la porte n’agit que sur sa ferme', () => {
    it('les sous-zones créées sont de la ferme de la porte, jamais de la voisine, même si le gérant l’est aussi', async () => {
      await placer(serre(2, 1));
      expect(base.lireDirect('SELECT 1 FROM zone WHERE ferme_id = ? AND id IN (?, ?, ?)', [VOISINE, ZONE_SERRE, sousZone(1), sousZone(2)])).toHaveLength(0);
      expect(base.lireDirect('SELECT 1 FROM emplacement WHERE ferme_id = ? AND zone_id <> ?', [VOISINE, ZONE_VOISINE])).toHaveLength(0);
    });
  });
});
