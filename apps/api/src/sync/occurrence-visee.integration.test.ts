/**
 * Tests d'acceptation T22b — synchro, contre un vrai Postgres : POST /sync/upload accepte une
 * intervention qui porte une occurrence visée (`detail.occurrenceVisee`, écrite par « Fait » sur
 * une carte de travail en retard, Q24) et son annulation, et les écrit telles quelles (jsonb) ;
 * une occurrence visée invalide est refusée en 200 (ecriture_invalide), sans bloquer la file.
 *
 * Exécution : comme T10 (DATABASE_URL ; base jetable supprimée à la fin ; sans DATABASE_URL,
 * échec en CI et saut signalé en local). Harnais : ./upload.integration.test.ts.
 * Contrat : packages/core/src/planification/test/contrat-travaux.ts, section « T22b ».
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import {
  ajouterMembre,
  creerBaseJetable,
  creerFerme,
  creerUtilisateur,
  decrireAvecBase,
  peuplerFerme,
  type BaseJetable,
  type LignesDeFerme,
} from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-09-30T08:00:00Z');

interface EcritureEnvoyee {
  readonly op: 'PUT';
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

const DESHERBAGE = { categorie: 'entretien', type: 'désherbage', outil: null };

decrireAvecBase('T22b')('T22b : la synchro accepte l’occurrence visée d’une intervention', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let app: ReturnType<typeof creerApp>;
  let theo: { id: string; jeton: string };
  let ferme: string;
  let lignes: LignesDeFerme;

  beforeAll(async () => {
    base = await creerBaseJetable('t22b_occurrence');
    const cles: TrousseauCles = { active: await genererCleSignature('cle-t22b'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant: () => MAINTENANT });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    theo = { id: u.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
    lignes = await peuplerFerme(base.pool, ferme);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${theo.jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Intervention sur la série de la ferme, telle que « Fait » l'écrit depuis le téléphone. */
  function putIntervention(detail: Record<string, unknown>, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'intervention',
        date: '2026-09-30',
        horodatage: '2026-09-30T07:12:00.000Z',
        auteur_id: theo.id,
        source: 'tap',
        serie_id: lignes.serie,
        campagne_id: null,
        emplacement_ids: JSON.stringify([lignes.emplacement]),
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify(detail),
        ...autres,
      },
    };
  }

  async function detailEcrit(id: string): Promise<unknown> {
    const r = await base.pool.query<{ detail: unknown }>('SELECT detail FROM evenement WHERE id = $1', [id]);
    expect(r.rows, `événement ${id} écrit`).toHaveLength(1);
    return r.rows[0]?.detail;
  }

  it('« Fait » sur la carte du 17 puis son annulation : acceptés, écrits avec l’occurrence visée', async () => {
    const fait = putIntervention({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });
    expect(await lot([fait])).toEqual({ refus: [] });
    expect(await detailEcrit(fait.id)).toStrictEqual({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });

    const annulation = putIntervention({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' }, { remplace_sorte: 'annulation', remplace_evenement_id: fait.id });
    expect(await lot([annulation])).toEqual({ refus: [] });
    expect(await detailEcrit(annulation.id)).toStrictEqual({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });
  });

  it('une intervention sans occurrence visée (saisie libre) passe comme avant', async () => {
    const libre = putIntervention(DESHERBAGE);
    expect(await lot([libre])).toEqual({ refus: [] });
    expect(await detailEcrit(libre.id)).toStrictEqual(DESHERBAGE);
  });

  it('occurrence visée invalide : refus ecriture_invalide en 200, rien d’écrit ; la suivante du lot passe', async () => {
    const invalide = putIntervention({ ...DESHERBAGE, occurrenceVisee: '2026-02-30' });
    const valide = putIntervention({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });
    expect(await lot([invalide, valide])).toEqual({ refus: [{ table: 'evenement', id: invalide.id, motif: 'ecriture_invalide' }] });
    const n = await base.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM evenement WHERE id = $1', [invalide.id]);
    expect(n.rows[0]?.n).toBe(0);
    expect(await detailEcrit(valide.id)).toStrictEqual({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });
  });
});
