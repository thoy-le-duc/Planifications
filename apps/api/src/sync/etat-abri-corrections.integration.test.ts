/**
 * Tests d'acceptation T58 (relecture) — une correction d'un changement d'état ne change que
 * `actif` ; une annulation reste toujours possible. POST /sync/upload, contre un vrai Postgres
 * (même amorçage que etat-abri.integration.test.ts).
 *
 *   - correction d'un etat_abri qui change de ZONE (même une autre zone de la même ferme) ou
 *     d'ÉQUIPEMENT : 'ecriture_invalide', rien d'écrit ;
 *   - correction qui ne change que `actif` : acceptée (témoin) ;
 *   - annulation : acceptée même si l'équipement n'est plus déclaré par la zone depuis (la liste
 *     a été modifiée entre la saisie et l'annulation).
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
const MAINTENANT = new Date('2027-05-10T06:00:00Z');

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T58')('T58 : corrections et annulations des changements d’état', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let equipier: { id: string; jeton: string };
  let ferme: string;
  let serre: string;
  let tunnel: string;
  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  async function zoneEn(typeAbri: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, $3, $4)`, [id, ferme, `Zone ${id.slice(0, 6)}`, typeAbri]);
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t58_corrections');
    cles = { active: await genererCleSignature('cle-t58c'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Fraises de Garonne');
    const e = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    serre = await zoneEn('serre');
    tunnel = await zoneEn('tunnel');
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${equipier.jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  const ecrit = async (id: string) => (await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [id])).rowCount;

  function putEtat(zoneId: string, equipement: string, actif: boolean, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'etat_abri',
        date: '2027-05-10',
        horodatage: '2027-05-10T07:00:00.000Z',
        auteur_id: equipier.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ zoneId, equipement, actif }),
        ...autres,
      },
    };
  }

  async function origine(zoneId = serre, equipement = 'portes'): Promise<EcritureEnvoyee> {
    const o = putEtat(zoneId, equipement, true);
    expect(await lot([o]), 'l’original est accepté').toEqual({ refus: [] });
    return o;
  }

  const remplace = (sorte: 'correction' | 'annulation', o: EcritureEnvoyee) => ({ remplace_sorte: sorte, remplace_evenement_id: o.id });

  it('témoin : une correction qui ne change que `actif` est acceptée', async () => {
    const o = await origine();
    const c = putEtat(serre, 'portes', false, remplace('correction', o));
    expect(await lot([c])).toEqual({ refus: [] });
    expect(await ecrit(c.id)).toBe(1);
  });

  it('une correction qui change de zone (une autre zone de la même ferme) est refusée, rien d’écrit', async () => {
    const o = await origine();
    const c = putEtat(tunnel, 'portes', false, remplace('correction', o));
    expect((await lot([c])).refus).toEqual([{ table: 'evenement', id: c.id, motif: 'ecriture_invalide' }]);
    expect(await ecrit(c.id)).toBe(0);
  });

  it('une correction qui change d’équipement est refusée, rien d’écrit', async () => {
    const o = await origine();
    const c = putEtat(serre, 'chauffage', false, remplace('correction', o));
    expect((await lot([c])).refus).toEqual([{ table: 'evenement', id: c.id, motif: 'ecriture_invalide' }]);
    expect(await ecrit(c.id)).toBe(0);
  });

  it('même zone et même équipement, état inchangé : la correction (sans effet) reste acceptée', async () => {
    const o = await origine();
    const c = putEtat(serre, 'portes', true, remplace('correction', o));
    expect(await lot([c])).toEqual({ refus: [] });
  });

  it('une annulation reste acceptée même si l’équipement n’est plus déclaré par la zone', async () => {
    const o = await origine(serre, 'voile');
    // La liste de la zone est modifiée ensuite : le voile n'y est plus.
    const patch: EcritureEnvoyee = { op: 'PATCH', table: 'zone', id: serre, donnees: { equipements_abri: JSON.stringify(['ouvrants_lateraux', 'portes']) } };
    expect(await lot([patch]), 'la liste est modifiable').toEqual({ refus: [] });
    const nouveau = putEtat(serre, 'voile', true);
    expect((await lot([nouveau])).refus, 'un nouvel état du voile est refusé').toEqual([{ table: 'evenement', id: nouveau.id, motif: 'ecriture_invalide' }]);
    const a = putEtat(serre, 'voile', true, remplace('annulation', o));
    expect(await lot([a])).toEqual({ refus: [] });
    expect(await ecrit(a.id)).toBe(1);
  });

  // ── Correction d'une correction : la zone et l'équipement restent ceux de la chaîne ─────────

  async function chaine(): Promise<{ origine: EcritureEnvoyee; premiere: EcritureEnvoyee }> {
    const o = await origine();
    const c1 = putEtat(serre, 'portes', false, remplace('correction', o));
    expect(await lot([c1]), 'la 1re correction est acceptée').toEqual({ refus: [] });
    return { origine: o, premiere: c1 };
  }

  it('2e correction qui ne change que `actif` : acceptée (témoin)', async () => {
    const { premiere } = await chaine();
    const c2 = putEtat(serre, 'portes', true, remplace('correction', premiere));
    expect(await lot([c2])).toEqual({ refus: [] });
    expect(await ecrit(c2.id)).toBe(1);
  });

  it('2e correction qui change de zone par rapport à la 1re : refusée, rien d’écrit', async () => {
    const { premiere } = await chaine();
    const c2 = putEtat(tunnel, 'portes', true, remplace('correction', premiere));
    expect((await lot([c2])).refus).toEqual([{ table: 'evenement', id: c2.id, motif: 'ecriture_invalide' }]);
    expect(await ecrit(c2.id)).toBe(0);
  });

  it('2e correction qui change d’équipement par rapport à la 1re : refusée, rien d’écrit', async () => {
    const { premiere } = await chaine();
    const c2 = putEtat(serre, 'ouvrants_lateraux', true, remplace('correction', premiere));
    expect((await lot([c2])).refus).toEqual([{ table: 'evenement', id: c2.id, motif: 'ecriture_invalide' }]);
    expect(await ecrit(c2.id)).toBe(0);
  });

  it('une 2e correction envoyée dans le même lot que la 1re est jugée sur la 1re : changer de zone est refusé', async () => {
    const o = await origine();
    const c1 = putEtat(serre, 'portes', false, remplace('correction', o));
    const c2 = putEtat(tunnel, 'portes', true, remplace('correction', c1));
    const r = await lot([c1, c2]);
    expect(r.refus.map((x) => x.id)).toContain(c2.id);
    expect(await ecrit(c2.id)).toBe(0);
  });
});
