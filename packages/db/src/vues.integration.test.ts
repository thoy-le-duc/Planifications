/**
 * Vues recoltes, interventions, traitements : seule la version en vigueur d'un événement
 * apparaît (décision du 2026-09-29). Une annulation, un événement annulé et un événement
 * corrigé sont exclus ; la correction, elle, apparaît.
 *
 * Même exécution que schema.integration.test.ts : DATABASE_URL, sinon test sauté en local
 * (l'échec clair en CI sans base est porté par schema.integration.test.ts).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliquerMigrations } from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

decrireAvecBase('vues : version en vigueur des événements', { timeout: 30_000 }, () => {
  const nom = `t08_vues_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let c: pg.Client;
  const ferme = randomUUID();
  const produit = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nom}`);
    const url = new URL(URL_BASE);
    url.pathname = `/${nom}`;
    await appliquerMigrations(url.toString());
    c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme', 'Europe/Paris')`, [ferme]);
    await c.query(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active,
                                  delai_avant_recolte_jours, utilisable_en_bio)
       VALUES ($1, $2, 'Soufre', '2000001', 'soufre', 5, true)`,
      [produit, ferme],
    );
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.end();
  });

  async function inserer(type: string, detail: object, remplace?: readonly [string, string]): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail,
                              remplace_sorte, remplace_evenement_id)
       VALUES ($1, $2, $3, '2027-05-26', now(), $4, 'tap', $5, $6, $7)`,
      [id, ferme, type, randomUUID(), JSON.stringify(detail), remplace?.[0] ?? null, remplace?.[1] ?? null],
    );
    return id;
  }

  async function ids(vue: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(`SELECT id::text AS id FROM ${vue} ORDER BY id`);
    return r.rows.map((l) => l.id);
  }

  it('annulé, corrigé et annulation exclus ; correction et saisie simple visibles', async () => {
    const recolte = { quantite: 10, unite: 'kg', categorie: null };
    const simple = await inserer('recolte', recolte);
    const corrigee = await inserer('recolte', recolte);
    const correction = await inserer('recolte', { ...recolte, quantite: 12 }, ['correction', corrigee]);
    const annulee = await inserer('recolte', recolte);
    await inserer('recolte', recolte, ['annulation', annulee]);
    expect(await ids('recoltes')).toEqual([simple, correction].sort());

    const intervention = await inserer('intervention', { categorie: 'entretien', type: 'taille', outil: null });
    await inserer('intervention', { categorie: 'entretien', type: 'taille', outil: null }, ['annulation', intervention]);
    expect(await ids('interventions')).toEqual([]);

    const traitement = {
      produitPhytoId: produit,
      dose: { valeur: 5, unite: 'kg/ha' },
      surfaceTraiteeM2: 100,
      cible: 'oïdium',
      operateur: 'Théophane',
      recolteAutoriseeLe: '2027-05-31',
    };
    const ancien = await inserer('traitement', traitement);
    const nouveau = await inserer('traitement', { ...traitement, surfaceTraiteeM2: 120 }, ['correction', ancien]);
    expect(await ids('traitements')).toEqual([nouveau]);
  });

  it('un traitement au détail mal formé est refusé : il casserait le registre phyto', async () => {
    await expect(
      inserer('traitement', { produitPhytoId: 'pas-un-uuid', dose: { valeur: 1, unite: 'L' } }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
