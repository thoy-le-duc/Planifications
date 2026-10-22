/**
 * Tests d'acceptation T61 (relecture critique) — contre un vrai Postgres, même amorçage que
 * plan-chemins-messages.integration.test.ts.
 *
 * 1. Retrait d'un lieu de rangement, d'un bâtiment ou d'un point du plan qui range encore des
 *    outils ou des places ACTIFS : REFUSÉ ('ecriture_invalide', message qui dit « déplacez
 *    d'abord les outils rangés ici »), tout le lot refusé, rien ne change. Accepté une fois les
 *    outils déplacés (dans un lot précédent, ou plus haut dans le même lot) et les places
 *    retirées. Un outil existant reste renommable, même si son lieu est déjà retiré (outil
 *    orphelin d'avant la règle).
 * 2. Limite des 5 km : le cœur calcule en flottants, la base en numeric exact. Un point ou un
 *    chemin à quelques nanomètres au-delà de 5 000 m est refusé PROPREMENT par le serveur (refus
 *    de validation 'ecriture_invalide' avec un message en français, réponse 200), jamais par une
 *    erreur de la base (5xx, ou refus sans message). Pile 5 000 m : accepté.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-22T06:00:00Z');
const SUPPRIME_LE = '2026-10-22T07:00:00.000Z';
const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

interface Ecriture {
  readonly op: 'PUT' | 'PATCH';
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}
interface Reponse {
  readonly status: number;
  readonly refus: readonly { id: string; motif: string }[];
}

decrireAvecBase('T61')('T61 : retrait d’un lieu qui range des outils, et limite des 5 km', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let ferme: string;
  let compteur = 0;
  const unique = (p: string): string => `${p}-${String(++compteur)}`;

  beforeAll(async () => {
    base = await creerBaseJetable('t61_retrait');
    const cles: TrousseauCles = { active: await genererCleSignature('cle-t61r'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    const g = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, g.id, MAINTENANT);
    await base.pool.query(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [ferme, JSON.stringify({ latitude: 44, longitude: 1.5 })]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  const sql = async (texte: string, valeurs: readonly unknown[] = []): Promise<void> => {
    await base.pool.query(texte, [...valeurs]);
  };

  async function lot(ecritures: readonly Ecriture[]): Promise<Reponse> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    const corps = res.status === 200 ? ((await res.json()) as { refus: { id: string; motif: string }[] }) : { refus: [] };
    return { status: res.status, refus: corps.refus };
  }
  async function accepte(ecritures: readonly Ecriture[]): Promise<void> {
    expect(await lot(ecritures)).toEqual({ status: 200, refus: [] });
  }
  async function refus(e: Ecriture): Promise<string> {
    const r = await lot([e]);
    expect(r.status, 'réponse 200 : un refus de validation, pas une erreur du serveur').toBe(200);
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    const m = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [e.id]);
    return m.rows[0]?.message ?? '';
  }
  const colonne = async (table: string, id: string, c: string): Promise<unknown> => (await base.pool.query<Record<string, unknown>>(`SELECT ${c} FROM ${table} WHERE id = $1`, [id])).rows[0]?.[c];
  const patch = (table: string, id: string, donnees: Record<string, unknown>): Ecriture => ({ op: 'PATCH', table, id, donnees });

  /** Un bâtiment, son lieu, une place « mur nord » et un outil Grelinette rangé là, écrits en base. */
  async function rangement(options: { sansOutil?: boolean; surPoint?: boolean } = {}) {
    const element = randomUUID();
    const lieu = randomUUID();
    const place = randomUUID();
    const outil = randomUUID();
    if (options.surPoint === true) {
      await sql(`INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m) VALUES ($1, $2, $3, 'repere', 5, 5)`, [element, ferme, unique('Abri')]);
      await sql(`INSERT INTO lieu_rangement (id, ferme_id, point_plan_id) VALUES ($1, $2, $3)`, [lieu, ferme, element]);
    } else {
      await sql(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg) VALUES ($1, $2, $3, 'hangar', 20, 12, 6, 0, 0, 0)`, [element, ferme, unique('hangar')]);
      await sql(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id) VALUES ($1, $2, $3)`, [lieu, ferme, element]);
    }
    await sql(`INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom) VALUES ($1, $2, $3, 'mur nord')`, [place, ferme, lieu]);
    if (options.sansOutil !== true) await sql(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, place_rangement_id) VALUES ($1, $2, $3, $4, $5)`, [outil, ferme, unique('Grelinette'), lieu, place]);
    return { element, lieu, place, outil };
  }
  async function autreLieu(): Promise<string> {
    const b = randomUUID();
    const l = randomUUID();
    await sql(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg) VALUES ($1, $2, $3, 'local', 6, 4, 2.8, 30, 0, 0)`, [b, ferme, unique('local')]);
    await sql(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id) VALUES ($1, $2, $3)`, [l, ferme, b]);
    return l;
  }

  // ── 1. Retrait d'un lieu qui range encore des outils ────────────────────────────────────────

  it.each([
    ['le lieu', 'lieu_rangement', (r: Awaited<ReturnType<typeof rangement>>) => r.lieu],
    ['le bâtiment du lieu', 'batiment', (r: Awaited<ReturnType<typeof rangement>>) => r.element],
  ])('retirer %s alors qu’un outil y est rangé : refusé, message « déplacez d’abord les outils », rien ne change', async (_cas, table, id) => {
    const r = await rangement();
    const e = patch(table, id(r), { supprime_le: SUPPRIME_LE });
    expect(await refus(e)).toMatch(/déplacez d.abord les outils/iu);
    expect(await colonne(table, id(r), 'supprime_le')).toBeNull();
    expect(await colonne('outil', r.outil, 'supprime_le')).toBeNull();
  });

  it('retirer le point du plan qui est un lieu de rangement avec un outil : refusé de même', async () => {
    const r = await rangement({ surPoint: true });
    const e = patch('point_plan', r.element, { supprime_le: SUPPRIME_LE });
    expect(await refus(e)).toMatch(/déplacez d.abord les outils/iu);
    expect(await colonne('point_plan', r.element, 'supprime_le')).toBeNull();
  });

  it('un lieu qui ne range que des places actives (aucun outil) ne peut pas non plus être retiré', async () => {
    const r = await rangement({ sansOutil: true });
    const e = patch('lieu_rangement', r.lieu, { supprime_le: SUPPRIME_LE });
    expect(await refus(e)).toMatch(/outils|places/iu);
    expect(await colonne('lieu_rangement', r.lieu, 'supprime_le')).toBeNull();
  });

  it('un lot qui mêle le retrait refusé et une autre écriture est refusé en entier', async () => {
    const r = await rangement();
    const ok = patch('outil', r.outil, { nom: unique('Renommée') });
    const mauvais = patch('lieu_rangement', r.lieu, { supprime_le: SUPPRIME_LE });
    const reponse = await lot([ok, mauvais]);
    expect(reponse.refus.map((x) => x.id).sort()).toEqual([ok.id, mauvais.id].sort());
    expect(await colonne('outil', r.outil, 'nom')).not.toMatch(/Renommée/u);
  });

  it('accepté après avoir déplacé l’outil et retiré la place (lots séparés)', async () => {
    const r = await rangement();
    const ailleurs = await autreLieu();
    await accepte([patch('outil', r.outil, { lieu_rangement_id: ailleurs, place_rangement_id: null })]);
    await accepte([patch('place_rangement', r.place, { supprime_le: SUPPRIME_LE })]);
    await accepte([patch('lieu_rangement', r.lieu, { supprime_le: SUPPRIME_LE })]);
    expect(await colonne('lieu_rangement', r.lieu, 'supprime_le')).not.toBeNull();
    await accepte([patch('batiment', r.element, { supprime_le: SUPPRIME_LE })]);
    expect(await colonne('outil', r.outil, 'lieu_rangement_id')).toBe(ailleurs);
  });

  it('accepté quand l’outil est déplacé plus haut dans le même lot', async () => {
    const r = await rangement();
    const ailleurs = await autreLieu();
    await accepte([
      patch('outil', r.outil, { lieu_rangement_id: ailleurs, place_rangement_id: null }),
      patch('place_rangement', r.place, { supprime_le: SUPPRIME_LE }),
      patch('lieu_rangement', r.lieu, { supprime_le: SUPPRIME_LE }),
    ]);
    expect(await colonne('lieu_rangement', r.lieu, 'supprime_le')).not.toBeNull();
  });

  it('un outil retiré (supprime_le) ne retient plus son lieu', async () => {
    const r = await rangement({ sansOutil: true });
    await sql(`UPDATE place_rangement SET supprime_le = now() WHERE id = $1`, [r.place]);
    await sql(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, supprime_le) VALUES ($1, $2, $3, $4, now())`, [randomUUID(), ferme, unique('Vieille'), r.lieu]);
    await accepte([patch('lieu_rangement', r.lieu, { supprime_le: SUPPRIME_LE })]);
  });

  it('un outil existant reste renommable, y compris orphelin (son lieu déjà retiré)', async () => {
    const r = await rangement();
    await accepte([patch('outil', r.outil, { nom: unique('Grelinette large') })]);
    await sql(`UPDATE place_rangement SET supprime_le = now() WHERE id = $1`, [r.place]);
    await sql(`UPDATE lieu_rangement SET supprime_le = now() WHERE id = $1`, [r.lieu]);
    const nom = unique('Grelinette orpheline');
    await accepte([patch('outil', r.outil, { nom })]);
    expect(await colonne('outil', r.outil, 'nom')).toBe(nom);
  });

  // ── 2. Limite des 5 km, flottants contre numeric exact ──────────────────────────────────────

  const point = (x: number, y: number): Ecriture => ({ op: 'PUT', table: 'point_plan', id: nouvelId(), donnees: { ferme_id: ferme, nom: unique('Point'), sorte: 'repere', x_m: x, y_m: y, supprime_le: null } });
  const chemin = (a: { x: number; y: number }, b: { x: number; y: number }): Ecriture => ({
    op: 'PUT',
    table: 'chemin',
    id: nouvelId(),
    donnees: { ferme_id: ferme, nom: unique('Allée'), points: JSON.stringify([a, b]), largeur_m: 2, supprime_le: null },
  });

  const AU_DELA = [
    ['5 000 m + 5 nm, plein est', 5000.000000005, 0],
    ['(3 000 ; 4 000 + 1 nm)', 3000, 4000.000000001],
    ['(3 000 + 3 nm ; 4 000)', 3000.000000003, 4000],
    ['plein sud + 4 nm', 0, -5000.000000004],
    ['(−3 000 − 2 nm ; −4 000 − 2 nm)', -3000.000000002, -4000.000000002],
  ] as const;

  it.each(AU_DELA)('point à %s : refus de validation en français, ligne absente', async (_cas, x, y) => {
    const e = point(x, y);
    const m = await refus(e);
    expect(m).toMatch(/loin|5 km/iu);
    expect(m.length).toBeGreaterThan(0);
    expect((await base.pool.query(`SELECT 1 FROM point_plan WHERE id = $1`, [e.id])).rowCount).toBe(0);
  });

  it.each(AU_DELA)('chemin dont un point est à %s : refus de validation en français, ligne absente', async (_cas, x, y) => {
    const e = chemin({ x: 0, y: 0 }, { x, y });
    const m = await refus(e);
    expect(m).toMatch(/loin|5 km/iu);
    expect((await base.pool.query(`SELECT 1 FROM chemin WHERE id = $1`, [e.id])).rowCount).toBe(0);
  });

  it('pile à 5 000 m (3 000 ; 4 000), (5 000 ; 0) : accepté, point et chemin', async () => {
    await accepte([point(3000, 4000), point(5000, 0), chemin({ x: 0, y: 0 }, { x: -3000, y: -4000 })]);
  });
});
