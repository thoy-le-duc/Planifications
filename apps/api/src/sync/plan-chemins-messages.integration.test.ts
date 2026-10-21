/**
 * Tests d'acceptation T61 — les messages de refus du serveur parlent comme le maraîcher : un
 * refus qui touche un chemin dit « chemin », un refus qui touche un outil dit « outil » (jamais
 * « passage » ni « matériel »). Le filtre de jargon (test/jargon.ts) laisse ces deux mots permis.
 * Même amorçage que plan-chemins.integration.test.ts.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import { defautsDeForme, jargon } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-21T06:00:00Z');
const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

interface Ecriture {
  readonly op: 'PUT';
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}

const SENTIER = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
const MOT_INTERDIT = /passage|matériel/iu;

decrireAvecBase('T61')('T61 : les refus parlent de chemin et d’outil', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let ferme: string;
  let fermeSansOrigine: string;
  let lieu: string;

  beforeAll(async () => {
    base = await creerBaseJetable('t61_msg');
    const cles: TrousseauCles = { active: await genererCleSignature('cle-t61m'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeSansOrigine = await creerFerme(base.pool, 'Ferme sans origine');
    const g = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, g.id, fermeSansOrigine, { role: 'gerant' });
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, g.id, MAINTENANT);
    await base.pool.query(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [ferme, JSON.stringify({ latitude: 44, longitude: 1.5 })]);
    const b = randomUUID();
    lieu = randomUUID();
    await base.pool.query(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg) VALUES ($1, $2, 'hangar', 'hangar', 20, 12, 6, 0, 0, 0)`, [b, ferme]);
    await base.pool.query(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id) VALUES ($1, $2, $3)`, [lieu, ferme, b]);
    await base.pool.query(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id) VALUES ($1, $2, 'Grelinette', $3)`, [randomUUID(), ferme, lieu]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  const chemin = (autres: Record<string, unknown> = {}, f: string = ferme): Ecriture => ({
    op: 'PUT',
    table: 'chemin',
    id: nouvelId(),
    donnees: { ferme_id: f, nom: 'Allée', points: JSON.stringify(SENTIER), largeur_m: 2, supprime_le: null, ...autres },
  });
  const outil = (autres: Record<string, unknown> = {}): Ecriture => ({
    op: 'PUT',
    table: 'outil',
    id: nouvelId(),
    donnees: { ferme_id: ferme, nom: 'Bêche', lieu_rangement_id: lieu, place_rangement_id: null, supprime_le: null, ...autres },
  });

  async function message(e: Ecriture): Promise<string> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures: [e] }),
    });
    expect(res.status).toBe(200);
    const r = (await res.json()) as { refus: { id: string; motif: string }[] };
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    const m = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [e.id]);
    return m.rows[0]?.message ?? '';
  }

  it.each([
    ['un seul point', { points: JSON.stringify([{ x: 0, y: 0 }]) }],
    ['trop de points', { points: JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ x: i, y: 0 }))) }],
    ['un tracé illisible', { points: 'pas du json' }],
    ['un point trop loin', { points: JSON.stringify([{ x: 0, y: 0 }, { x: 6000, y: 0 }]) }],
    ['deux points confondus', { points: JSON.stringify([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 5, y: 5 }]) }],
    ['largeur nulle', { largeur_m: 0 }],
    ['largeur de 21 m', { largeur_m: 21 }],
    ['nom de 81 caractères', { nom: 'x'.repeat(81) }],
  ])('chemin refusé (%s) : le message dit « chemin », sans jargon ni « passage »', async (_cas, autres) => {
    const m = await message(chemin(autres));
    expect(m).toMatch(/chemin/iu);
    expect(m).not.toMatch(MOT_INTERDIT);
    expect(jargon(m)).toEqual([]);
    expect(defautsDeForme(m)).toEqual([]);
  });

  it('chemin posé sans origine du plan : le message dit « chemin »', async () => {
    const m = await message(chemin({}, fermeSansOrigine));
    expect(m).toMatch(/chemin/iu);
    expect(m).not.toMatch(MOT_INTERDIT);
    expect(jargon(m)).toEqual([]);
  });

  it.each([
    ['sans lieu de rangement', { lieu_rangement_id: null }],
    ['sans nom', { nom: ' ' }],
    ['nom de 81 caractères', { nom: 'x'.repeat(81) }],
    ['nom déjà pris', { nom: ' grelinette ' }],
  ])('outil refusé (%s) : le message dit « outil », sans jargon ni « matériel »', async (_cas, autres) => {
    const m = await message(outil(autres));
    expect(m).toMatch(/outil/iu);
    expect(m).not.toMatch(MOT_INTERDIT);
    expect(jargon(m)).toEqual([]);
    expect(defautsDeForme(m)).toEqual([]);
  });
});
