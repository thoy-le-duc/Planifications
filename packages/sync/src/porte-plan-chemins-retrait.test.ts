/**
 * Tests d'acceptation T61 — la porte écrit les chemins, les points du plan, les lieux de rangement,
 * leurs places et les outils (docs/backlog/T61-chemins-outils.md), côté téléphone (`@planif/sync`),
 * sans réseau, sur un SQLite en mémoire. Même mécanique que porte-placement.test.ts (T28s).
 *
 * (retrait) ── Contrat (proposé par le testeur) : `porte.placer` accepte cinq sortes de changement de plus ──
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
import { type Id } from '@planif/core';
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
const SENTIER: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 25.5 },
];

describe('T61 : la porte écrit chemins, points, rangement et outils, et rend de quoi les annuler', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
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




  const RETRAIT = /déplacez d.abord les outils/iu;
  const retire = INSTANT.toISOString();
  const instantane = (): unknown => Object.fromEntries(['point_plan', 'lieu_rangement', 'place_rangement', 'outil', 'batiment'].map((t) => [t, base.lireDirect(`SELECT * FROM ${t} ORDER BY id`)]));
  const colonne = (table: string, ident: string, c: string): unknown => base.lireDirect<Record<string, unknown>>(`SELECT ${c} FROM ${table} WHERE id = ?`, [ident])[0]?.[c];

  async function rejete(changements: readonly Changement[], attendu: RegExp): Promise<void> {
    const avant = instantane();
    await expect(placer(changements)).rejects.toThrow(attendu);
    expect(instantane(), 'rien n’est écrit').toEqual(avant);
  }

  /** Grelinette rangée au hangar, mur nord. */
  const ranger = (): Promise<readonly Changement[]> => placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Grelinette', lieu_rangement_id: LIEU_HANGAR, place_rangement_id: PLACE_HANGAR } }]);

  it.each([
    ['le lieu', { sorte: 'lieu_rangement', id: LIEU_HANGAR, valeurs: { supprime_le: retire } }],
    ['le bâtiment du lieu', { sorte: 'batiment', id: HANGAR, valeurs: { supprime_le: retire } }],
  ] as const)('retirer %s alors qu’un outil y est rangé : rejet « déplacez d’abord les outils », rien ne change', async (_cas, changement) => {
    await ranger();
    await rejete([changement], RETRAIT);
  });

  it('retirer le point du plan d’un lieu qui range un outil : rejet de même', async () => {
    await placer([
      { sorte: 'point_plan', id: NOUVEAU(2), valeurs: { nom: 'Abri', sorte: 'repere', x_m: 80, y_m: 10 } },
      { sorte: 'lieu_rangement', id: NOUVEAU(4), valeurs: { batiment_id: null, point_plan_id: NOUVEAU(2) } },
      { sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Arrosoir', lieu_rangement_id: NOUVEAU(4) } },
    ]);
    await rejete([{ sorte: 'point_plan', id: NOUVEAU(2), valeurs: { supprime_le: retire } }], RETRAIT);
  });

  it('un lieu qui ne range que des places actives ne peut pas être retiré', async () => {
    await rejete([{ sorte: 'lieu_rangement', id: LIEU_HANGAR, valeurs: { supprime_le: retire } }], /outils|places/iu);
  });

  it('accepté après avoir déplacé l’outil et retiré la place (appels séparés), puis le bâtiment aussi', async () => {
    await ranger();
    await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { lieu_rangement_id: LIEU_LOCAL, place_rangement_id: null } }]);
    await placer([{ sorte: 'place_rangement', id: PLACE_HANGAR, valeurs: { supprime_le: retire } }]);
    await placer([{ sorte: 'lieu_rangement', id: LIEU_HANGAR, valeurs: { supprime_le: retire } }]);
    expect(colonne('lieu_rangement', LIEU_HANGAR, 'supprime_le')).toBe(retire);
    await placer([{ sorte: 'batiment', id: HANGAR, valeurs: { supprime_le: retire } }]);
    expect(colonne('batiment', HANGAR, 'supprime_le')).toBe(retire);
  });

  it('accepté quand l’outil est déplacé plus haut dans le même appel', async () => {
    await ranger();
    await placer([
      { sorte: 'outil', id: NOUVEAU(6), valeurs: { lieu_rangement_id: LIEU_LOCAL, place_rangement_id: null } },
      { sorte: 'place_rangement', id: PLACE_HANGAR, valeurs: { supprime_le: retire } },
      { sorte: 'lieu_rangement', id: LIEU_HANGAR, valeurs: { supprime_le: retire } },
    ]);
    expect(colonne('lieu_rangement', LIEU_HANGAR, 'supprime_le')).toBe(retire);
  });

  it('un outil existant reste renommable, y compris orphelin (son lieu déjà retiré)', async () => {
    await ranger();
    await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Grelinette large' } }]);
    expect(colonne('outil', NOUVEAU(6), 'nom')).toBe('Grelinette large');
    base.recevoir(`UPDATE place_rangement SET supprime_le = ? WHERE id = ?`, [retire, PLACE_HANGAR]);
    base.recevoir(`UPDATE lieu_rangement SET supprime_le = ? WHERE id = ?`, [retire, LIEU_HANGAR]);
    await placer([{ sorte: 'outil', id: NOUVEAU(6), valeurs: { nom: 'Grelinette orpheline' } }]);
    expect(colonne('outil', NOUVEAU(6), 'nom')).toBe('Grelinette orpheline');
  });
});
