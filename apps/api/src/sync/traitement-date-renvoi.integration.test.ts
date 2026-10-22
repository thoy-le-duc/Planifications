/**
 * T80, règle 4 (développeur) : un traitement futur déjà en base (accepté avant T80, ou un jour où
 * il ne l'était pas encore) renvoyé à l'identique par un téléphone (réponse perdue) reste accepté
 * sans rien écrire ni refus ; le même id avec d'autres valeurs reste refusé. Même exécution que
 * traitement-date-future.integration.test.ts.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, peuplerFerme, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-22T08:00:00Z');
const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });

decrireAvecBase('T80r')('T80 : renvoi identique d’un traitement futur déjà en base', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let donnees: Record<string, unknown>;
  const id = nouvelId<'Evenement'>();

  beforeAll(async () => {
    base = await creerBaseJetable('t80_renvoi');
    const cles = { active: await genererCleSignature('cle-t80r'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant: () => MAINTENANT, jourServeur: () => '2026-10-22' });
    const ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    const a = await peuplerFerme(base.pool, ferme);
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT);
    const detail = { produitPhytoId: a.produitPhyto, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 100, cible: 'mildiou', operateur: 'Théo', recolteAutoriseeLe: '2031-01-01' };
    donnees = {
      ferme_id: ferme, type: 'traitement', date: '2026-11-30', horodatage: '2026-10-01T05:00:00.000Z', auteur_id: u.id, source: 'tap',
      serie_id: null, campagne_id: null, emplacement_ids: '[]', note: null, photos: '[]', remplace_sorte: null, remplace_evenement_id: null,
      detail: JSON.stringify(detail),
    };
    await base.pool.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, photos, detail)
       VALUES ($1, $2, 'traitement', '2026-11-30', '2026-10-01T05:00:00Z', $3, 'tap', '{}', '{}', $4)`,
      [id, ferme, u.id, JSON.stringify(detail)],
    );
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function envoyer(d: Record<string, unknown>): Promise<{ refus: readonly { id: string; motif: string }[] }> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures: [{ op: 'PUT', table: 'evenement', id, donnees: d }] }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { refus: readonly { id: string; motif: string }[] };
  }

  const compter = async (sql: string): Promise<number> => (await base.pool.query<{ n: number }>(sql, [id])).rows[0]?.n ?? -1;

  it('renvoi identique : accepté, rien d’écrit, aucun refus', async () => {
    expect(await envoyer(donnees)).toEqual({ refus: [] });
    expect(await compter(`SELECT count(*)::int AS n FROM evenement WHERE id = $1`)).toBe(1);
    expect(await compter(`SELECT count(*)::int AS n FROM modification WHERE ligne_id = $1`)).toBe(0);
    expect(await compter(`SELECT count(*)::int AS n FROM refus_synchro WHERE ligne_id = $1`)).toBe(0);
  });

  it('même id, autre date future : refusé (date future), la ligne en base reste telle quelle', async () => {
    expect((await envoyer({ ...donnees, date: '2026-12-01' })).refus).toEqual([{ table: 'evenement', id, motif: 'ecriture_invalide' }]);
    const r = await base.pool.query<{ date: string }>(`SELECT date::text FROM evenement WHERE id = $1`, [id]);
    expect(r.rows[0]?.date).toBe('2026-11-30');
  });
});
