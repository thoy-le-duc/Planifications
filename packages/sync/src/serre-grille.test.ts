/**
 * Tests d'acceptation T88 — la grille d'une serre (chapelles × tronçons, allées) se synchronise
 * (docs/backlog/T88-serre-en-grille-modele.md, règle 6 et critère « API et règles PowerSync »), côté téléphone
 * (`@planif/sync`), sans réseau, sur un SQLite en mémoire. Côté serveur : apps/api/src/sync/serre-grille.integration.test.ts.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * - Schéma local : batiment + nb_chapelles ('entier'), nb_troncons ('entier'), largeur_allee_m ('reel'), facultatives
 *   (TABLES_LOCALES, packages/sync/src/schema.ts). Les règles PowerSync (`SELECT * FROM batiment …`) les descendent sans changement.
 * - `ValeursBatiment` (types.ts) : + nb_chapelles?, nb_troncons?, largeur_allee_m? (nombre ou null).
 * - `porte.placer` : mêmes règles que la base et le serveur (validerPlacement de @planif/core) ; l'annulation rend les valeurs d'avant,
 *   colonnes de la grille comprises (retour à null d'une grille créée).
 */
import { readFileSync } from 'node:fs';
import type { Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, TABLES_LOCALES, type ChangementPlacement } from './index.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

type Changement = ChangementPlacement;
type Valeurs = Record<string, unknown>;
const batimentDe = (id: string, valeurs: Valeurs): Changement => ({ sorte: 'batiment', id, valeurs }) as unknown as Changement;

const GERANT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c10' as Id<'Utilisateur'>;
const EQUIPIER = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c11' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c20' as Id<'Ferme'>;
const VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c21';
const SERRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c50';
const SERRE_VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c51';
const NOUVELLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5c52';
const INSTANT = new Date('2026-10-30T06:00:00.000Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };

/** Serre à légumes : 128,8 × 57,6 m, 6 chapelles, 3 tronçons, allées de 4,40 m. */
const LEGUMES: Valeurs = {
  nom: 'Serre à légumes',
  type: 'serre_chapelle',
  longueur_m: 128.8,
  largeur_m: 57.6,
  hauteur_m: 5,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 0,
  zone_id: null,
  nb_chapelles: 6,
  nb_troncons: 3,
  largeur_allee_m: 4.4,
};

interface LigneBatiment {
  nb_chapelles: number | null;
  nb_troncons: number | null;
  largeur_allee_m: number | null;
  longueur_m: number;
}

describe('T88 : schéma local et règles PowerSync', () => {
  it('batiment descend avec les trois colonnes de la grille (entiers et réel)', () => {
    const locale = (TABLES_LOCALES as Readonly<Record<string, Readonly<Record<string, string>>>>).batiment;
    expect(locale?.nb_chapelles).toBe('entier');
    expect(locale?.nb_troncons).toBe('entier');
    expect(locale?.largeur_allee_m).toBe('reel');
  });

  it('les règles PowerSync envoient toujours batiment par ferme active, sans liste de colonnes qui oublierait la grille', () => {
    const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
    const bloc = /^ {2}batiment:\n((?: {4}[^\n]*\n)+)/m.exec(regles)?.[1] ?? '';
    expect(bloc).toMatch(/SELECT \* FROM batiment WHERE ferme_id IN \(SELECT ferme_id FROM fermes_actives\)/);
  });
});

describe('T88 : la porte écrit la grille et rend de quoi l’annuler', () => {
  let base: BaseMemoire;

  beforeEach(() => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Jardins de Garonne', 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [FERME, JSON.stringify(ORIGINE)]);
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme voisine', 'Europe/Paris', NULL, ?, '{"longueur":"m","masse":"kg"}')`, [VOISINE, JSON.stringify(ORIGINE)]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m3', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, VOISINE]);
    // Une serre d'avant la mise à jour (sans grille) et la serre d'une autre ferme.
    r(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, supprime_le)
       VALUES (?, ?, 'Tunnel Manon', 'serre_tunnel', 40, 28.8, 4, -10, 15, 0, NULL, NULL)`,
      [SERRE, FERME],
    );
    r(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, supprime_le)
       VALUES (?, ?, 'Serre voisine', 'serre_tunnel', 40, 28.8, 4, 0, 0, 0, NULL, NULL)`,
      [SERRE_VOISINE, VOISINE],
    );
  });

  afterEach(() => {
    base.fermer();
  });

  function placer(changements: readonly Changement[], utilisateurId: Id<'Utilisateur'> = GERANT): Promise<readonly Changement[]> {
    return creerPorte(base, { utilisateurId, fermeId: FERME, maintenant: () => INSTANT }).placer(changements);
  }
  const ligne = (id: string): LigneBatiment | undefined => base.lireDirect<LigneBatiment>('SELECT * FROM batiment WHERE id = ?', [id])[0];

  it('une serre d’avant la mise à jour a la grille nulle (comportement de T86)', () => {
    expect(ligne(SERRE)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it('création d’une serre à légumes : les trois colonnes sont écrites', async () => {
    await placer([batimentDe(NOUVELLE, LEGUMES)]);
    expect(ligne(NOUVELLE)).toMatchObject({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4, longueur_m: 128.8 });
  });

  it('création sans les colonnes (téléphone d’avant la mise à jour) : acceptée, grille nulle', async () => {
    const ancien: Valeurs = Object.fromEntries(Object.entries(LEGUMES).filter(([c]) => !['nb_chapelles', 'nb_troncons', 'largeur_allee_m'].includes(c)));
    await placer([batimentDe(NOUVELLE, ancien)]);
    expect(ligne(NOUVELLE)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it('modification de la grille d’une serre existante : seules les colonnes données changent', async () => {
    await placer([batimentDe(SERRE, { nb_chapelles: 3 })]);
    expect(ligne(SERRE)).toMatchObject({ nb_chapelles: 3, nb_troncons: null, largeur_allee_m: null, longueur_m: 40 });
  });

  it('annulation d’une modification : valeurs d’avant, nulles comprises', async () => {
    const annulation = await placer([batimentDe(SERRE, { nb_chapelles: 3, nb_troncons: 2, largeur_allee_m: 1.5 })]);
    expect(ligne(SERRE)).toMatchObject({ nb_chapelles: 3, nb_troncons: 2, largeur_allee_m: 1.5 });
    await placer(annulation);
    expect(ligne(SERRE)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it('retour à une serre sans grille : les trois colonnes remises à null', async () => {
    await placer([batimentDe(NOUVELLE, LEGUMES)]);
    await placer([batimentDe(NOUVELLE, { nb_chapelles: null, nb_troncons: null, largeur_allee_m: null })]);
    expect(ligne(NOUVELLE)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it.each([
    ['0 chapelle', { nb_chapelles: 0 }],
    ['101 chapelles', { nb_chapelles: 101 }],
    ['2,5 chapelles', { nb_chapelles: 2.5 }],
    ['0 tronçon', { nb_troncons: 0 }],
    ['51 tronçons', { nb_troncons: 51 }],
    ['allée négative', { largeur_allee_m: -1 }],
    ['allée plus fine que le millimètre', { largeur_allee_m: 4.4005 }],
    ['grille impossible (allées de 64,4 m)', { largeur_allee_m: 64.4 }],
  ])('hors bornes — %s : rejeté, rien d’écrit', async (_cas, grille) => {
    await expect(placer([batimentDe(NOUVELLE, { ...LEGUMES, ...grille })])).rejects.toThrow();
    expect(ligne(NOUVELLE)).toBeUndefined();
  });

  it('grille rendue impossible en réduisant la longueur d’une serre existante : rejeté, inchangée', async () => {
    await placer([batimentDe(NOUVELLE, LEGUMES)]);
    await expect(placer([batimentDe(NOUVELLE, { longueur_m: 8 })])).rejects.toThrow();
    expect(ligne(NOUVELLE)?.longueur_m).toBe(128.8);
  });

  it('allée à un flottant près (0,1 × 3) : la valeur écrite en local est l’arrondie au millimètre (0,3)', async () => {
    await placer([batimentDe(NOUVELLE, { ...LEGUMES, largeur_allee_m: 0.1 * 3 })]);
    expect(ligne(NOUVELLE)?.largeur_allee_m).toBe(0.3);
  });

  it.each([
    ['nb_troncons sans nb_chapelles', { nb_chapelles: null, nb_troncons: 3 }],
    ['allée sans nb_chapelles', { nb_chapelles: null, nb_troncons: null, largeur_allee_m: 4.4 }],
    ['grille minuscule (0,02 m en 50 tronçons)', { nb_chapelles: 1, nb_troncons: 50, largeur_allee_m: 0, longueur_m: 0.02 }],
  ])('%s : rejeté, rien d’écrit', async (_cas, grille) => {
    await expect(placer([batimentDe(NOUVELLE, { ...LEGUMES, ...grille })])).rejects.toThrow();
    expect(ligne(NOUVELLE)).toBeUndefined();
  });

  it('isolement : la serre d’une autre ferme n’est pas modifiable par la porte, sa grille reste nulle', async () => {
    await expect(placer([batimentDe(SERRE_VOISINE, { nb_chapelles: 3 })])).rejects.toThrow();
    expect(ligne(SERRE_VOISINE)?.nb_chapelles).toBeNull();
  });

  it('un équipier ne règle pas la grille : rejeté avec le message du gérant, rien d’écrit', async () => {
    await expect(placer([batimentDe(SERRE, { nb_chapelles: 3 })], EQUIPIER)).rejects.toThrow('Seul le gérant peut placer les éléments de la ferme.');
    expect(ligne(SERRE)?.nb_chapelles).toBeNull();
  });
});
