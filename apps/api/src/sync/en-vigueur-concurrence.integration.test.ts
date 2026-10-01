/**
 * Tests d'acceptation T10h, décision 2 du chef après la relecture (N1 — interblocage).
 *
 * Depuis T10h, chaque correction ou annulation met à jour, par un déclencheur, la ligne de sa
 * chaîne (interne.chaine_evenement) et la garde verrouillée jusqu'à la fin de la transaction.
 * Deux lots tout ou rien (ici : un article de stock) qui corrigent des interventions dans les
 * chaînes X puis Y pour l'un, Y puis X pour l'autre, s'attendent l'un l'autre : interblocage,
 * Postgres en tue un (40P01), l'API répond 500 ou refuse.
 *
 * Contrat (décision 2) : le verrou de ferme est pris pour TOUT événement qui en remplace un autre
 * (correction ou annulation, toutes catégories), avant toute écriture, fermes triées, comme pour
 * les récoltes. Les deux lots passent l'un après l'autre : 200, aucun refus, toutes les écritures
 * en base, une seule ligne en vigueur par chaîne.
 *
 * Banc : un utilisateur gérant de deux fermes A et B ; X est une intervention de A, Y une de B.
 * Le lot 1 porte un article de A (verrou de A seulement avant la décision 2), le lot 2 un article
 * de B. Scénario répété REPETITIONS fois pour échouer de façon fiable sans la décision 2.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, peuplerFerme, type BaseJetable, type LignesDeFerme } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T08:00:00Z');
const REPETITIONS = 12;
/** Interventions neuves entre les deux corrections d'un lot : élargit la fenêtre où l'autre lot avance. */
const INTERCALEES = 6;
const DESHERBAGE = { categorie: 'entretien', type: 'désherbage', outil: null };

interface EcritureEnvoyee {
  readonly op: 'PUT';
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 3_600_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

interface Ferme {
  readonly id: string;
  readonly lignes: LignesDeFerme;
  readonly espece: string;
}

decrireAvecBase('T10h')('T10h, décision 2 : corrections croisées de deux chaînes, sans interblocage', { timeout: 120_000 }, () => {
  let base: BaseJetable;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let theo: string;
  let A: Ferme;
  let B: Ferme;

  beforeAll(async () => {
    base = await creerBaseJetable('t10h_n1');
    const cles: TrousseauCles = { active: await genererCleSignature('cle-t10h'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant: () => MAINTENANT });
    const u = await creerUtilisateur(base.pool);
    theo = u.id;
    const ferme = async (nom: string): Promise<Ferme> => {
      const id = await creerFerme(base.pool, nom);
      await ajouterMembre(base.pool, u.id, id, { role: 'gerant' });
      const lignes = await peuplerFerme(base.pool, id);
      const r = await base.pool.query<{ id: string }>(`SELECT espece_id::text AS id FROM serie WHERE id = $1`, [lignes.serie]);
      return { id, lignes, espece: r.rows[0]?.id ?? '' };
    };
    A = await ferme('Jardins de Garonne');
    B = await ferme('Vergers du Lot');
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function envoyer(ecritures: readonly EcritureEnvoyee[]): Promise<{ status: number; corps: string }> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    return { status: res.status, corps: await res.text() };
  }

  function intervention(f: Ferme, horodatage: string, remplace: EcritureEnvoyee | null = null): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: f.id,
        type: 'intervention',
        date: '2026-09-30',
        horodatage,
        auteur_id: theo,
        source: 'tap',
        serie_id: f.lignes.serie,
        campagne_id: null,
        emplacement_ids: JSON.stringify([f.lignes.emplacement]),
        note: null,
        photos: '[]',
        remplace_sorte: remplace === null ? null : 'correction',
        remplace_evenement_id: remplace?.id ?? null,
        detail: JSON.stringify(DESHERBAGE),
      },
    };
  }

  function article(f: Ferme): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'article_stock',
      id: nouvelId<'ArticleStock'>(),
      donnees: { ferme_id: f.id, espece_id: f.espece, variete_id: null, unite: 'piece', categorie: null },
    };
  }

  /** Lot tout ou rien : article de `f1`, correction de `x` (ferme f1), interventions de f1, correction de `y` (ferme f2). */
  function lotCroise(f1: Ferme, x: EcritureEnvoyee, f2: Ferme, y: EcritureEnvoyee, heure: string): EcritureEnvoyee[] {
    return [
      article(f1),
      intervention(f1, `2026-09-30T${heure}:00.000Z`, x),
      ...Array.from({ length: INTERCALEES }, () => intervention(f1, `2026-09-30T${heure}:30.000Z`)),
      intervention(f2, `2026-09-30T${heure}:00.000Z`, y),
    ];
  }

  async function ecrites(ids: readonly string[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM evenement WHERE id = ANY($1::uuid[])) + (SELECT count(*) FROM article_stock WHERE id = ANY($1::uuid[])))::int AS n`,
      [ids],
    );
    return r.rows[0]?.n ?? -1;
  }

  async function enVigueur(ids: readonly string[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM evenements_en_vigueur WHERE id = ANY($1::uuid[])`, [ids]);
    return r.rows[0]?.n ?? -1;
  }

  it(`X puis Y contre Y puis X, en parallèle, ${String(REPETITIONS)} fois : ni 500 ni interblocage, les deux lots acceptés en entier`, async () => {
    for (let k = 0; k < REPETITIONS; k++) {
      const x = intervention(A, '2026-09-30T05:00:00.000Z');
      const y = intervention(B, '2026-09-30T05:00:00.000Z');
      expect(await envoyer([x, y]), 'origines').toEqual({ status: 200, corps: JSON.stringify({ refus: [] }) });

      const lot1 = lotCroise(A, x, B, y, '06:10');
      const lot2 = lotCroise(B, y, A, x, '06:20');
      const [r1, r2] = await Promise.all([envoyer(lot1), envoyer(lot2)]);
      expect({ k, r1, r2 }).toEqual({
        k,
        r1: { status: 200, corps: JSON.stringify({ refus: [] }) },
        r2: { status: 200, corps: JSON.stringify({ refus: [] }) },
      });
      expect(await ecrites([...lot1, ...lot2].map((e) => e.id))).toBe(lot1.length + lot2.length);
      // Une seule ligne en vigueur par chaîne (X et Y), la plus récente : celle du lot 2 (06:20).
      const corrections = [lot1[1], lot1[lot1.length - 1], lot2[1], lot2[lot2.length - 1]].map((e) => e?.id ?? '');
      expect(await enVigueur([x.id, y.id, ...corrections])).toBe(2);
    }
  });
});
