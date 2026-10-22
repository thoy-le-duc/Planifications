/**
 * Tests d'acceptation T80 — le serveur refuse un traitement daté dans le futur
 * (docs/backlog/T80-traitement-date-future-serveur.md), contre un vrai Postgres.
 *
 * Exécution : comme T10 (DATABASE_URL ; base jetable `t80_date_future_…` supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   Interface d'injection du jour du serveur (proposition du testeur, sur le modèle de
 *   `maintenant` et `journal`, dependances.ts) :
 *
 *     DependancesApp.jourServeur?: () => string
 *
 *   Rend le jour courant à Paris en chaîne `AAAA-MM-JJ`. Les tests l'injectent (aucune horloge
 *   réelle). Sans elle, le serveur le déduit de `maintenant()` (fuseau Europe/Paris, cas limite
 *   testé plus bas). `Contexte` (Required<DependancesApp>) la porte complétée.
 *
 *   1. Un PUT `evenement` de type 'traitement' dont `date` > jourServeur + 1 jour est refusé,
 *      motif 'ecriture_invalide', par le chemin des refus existants : réponse 200, une ligne de
 *      refus_synchro, rien d'écrit (ni evenement ni modification). Le message contient
 *      « Traitement daté dans le futur (JJ/MM/AAAA) : corrigez la date » (date du traitement,
 *      majuscule initiale libre car le message est « <motif> : <précision>. »), sans jargon.
 *      Jour serveur 2026-10-22 : 23/10 accepté, 24/10 refusé.
 *   2. Correction (remplace_sorte 'correction') et annulation ('annulation') suivent la même règle
 *      sur la date portée par l'événement qui corrige ou annule le traitement.
 *   3. Les autres écritures du même envoi passent (aucun refus du lot entier).
 *   4. Seul le type 'traitement' est visé (récolte, irrigation : inchangées, hors périmètre).
 *   5. Ce qui est déjà en base n'est jamais réécrit.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp, type DependancesApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, peuplerFerme, type BaseJetable, type LignesDeFerme } from './test/base-jetable.ts';
import { defautsDeForme, jargon } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
/** Horloge du serveur : volontairement très différente du jour injecté, pour prouver que `jourServeur` fait foi. */
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const JOUR_SERVEUR = '2026-10-22';

/** Dépendances telles que T80 les attend (le champ `jourServeur` n'existe pas encore dans DependancesApp). */
type DependancesT80 = DependancesApp & { readonly jourServeur?: () => string };

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

decrireAvecBase('T80')('T80 : traitement daté dans le futur refusé par le serveur', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let theo: { id: string; jeton: string };
  let ferme: string;
  let a: LignesDeFerme;

  const jeton = (utilisateurId: string): Promise<string> =>
    emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);

  function appPour(extra: Partial<DependancesT80>): ReturnType<typeof creerApp> {
    const deps: DependancesT80 = {
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
      ...extra,
    };
    return creerApp(deps);
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t80_date_future');
    cles = { active: await genererCleSignature('cle-t80'), precedentes: [] };
    app = appPour({ jourServeur: () => JOUR_SERVEUR });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    a = await peuplerFerme(base.pool, ferme);
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    theo = { id: u.id, jeton: await jeton(u.id) };
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[], application = app, jetonDuLot = theo.jeton): Promise<ReponseUpload> {
    const res = await application.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jetonDuLot}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function nombre(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }
  const evenements = (id: string) => nombre(`SELECT 1 FROM evenement WHERE id = $1`, [id]);
  const modifications = (id: string) => nombre(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);
  const refusDe = (id: string) => nombre(`SELECT 1 FROM refus_synchro WHERE ligne_id = $1`, [id]);

  /** Heure du téléphone croissante : la correction est toujours plus récente que son origine. */
  let minute = 0;
  const horodatage = (): string => `2026-10-01T05:${String(10 + minute++).padStart(2, '0')}:00.000Z`;

  /** Un événement tel que le téléphone l'envoie. */
  function put(type: string, date: string, detail: Record<string, unknown>, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type,
        date,
        horodatage: horodatage(),
        auteur_id: theo.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify(detail),
        ...autres,
      },
    };
  }

  const detailTraitement = (): Record<string, unknown> => ({
    produitPhytoId: a.produitPhyto,
    dose: { valeur: 2, unite: 'L/ha' },
    surfaceTraiteeM2: 100,
    cible: 'mildiou',
    operateur: 'Théo',
    recolteAutoriseeLe: '2031-01-01',
  });
  const traitement = (date: string, autres: Record<string, unknown> = {}): EcritureEnvoyee => put('traitement', date, detailTraitement(), autres);
  const recolte = (date: string): EcritureEnvoyee => put('recolte', date, { quantite: 3, unite: 'kg', categorie: null });
  const remplacement = (cible: EcritureEnvoyee, sorte: 'correction' | 'annulation', date: string): EcritureEnvoyee =>
    traitement(date, { remplace_sorte: sorte, remplace_evenement_id: cible.id });

  async function messageDuRefus(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string; motif: string; ferme_id: string | null }>(
      `SELECT message, motif, ferme_id FROM refus_synchro WHERE ligne_id = $1`,
      [id],
    );
    expect(r.rows, `un refus pour ${id}`).toHaveLength(1);
    expect(r.rows[0]?.motif).toBe('ecriture_invalide');
    expect(r.rows[0]?.ferme_id).toBe(ferme);
    return r.rows[0]?.message ?? '';
  }

  async function refusee(e: EcritureEnvoyee, attendu: string): Promise<void> {
    expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
    expect(await evenements(e.id)).toBe(0);
    expect(await modifications(e.id)).toBe(0);
    const message = await messageDuRefus(e.id);
    expect(message.toLowerCase()).toContain(`traitement daté dans le futur (${attendu}) : corrigez la date`);
    expect(jargon(message), message).toEqual([]);
    expect(defautsDeForme(message), message).toEqual([]);
  }

  async function acceptee(e: EcritureEnvoyee): Promise<void> {
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await evenements(e.id)).toBe(1);
    expect(await refusDe(e.id)).toBe(0);
  }

  describe('règle 1 : jour du serveur + 1 jour', () => {
    it('date de J+2 (2026-10-24) refusée, avec un message sans jargon', async () => {
      await refusee(traitement('2026-10-24'), '24/10/2026');
    });

    it('date de demain (J+1, 2026-10-23) acceptée', async () => {
      await acceptee(traitement('2026-10-23'));
    });

    it("date d'aujourd'hui (J, 2026-10-22) acceptée", async () => {
      await acceptee(traitement(JOUR_SERVEUR));
    });

    it('date passée acceptée (le jour injecté, pas l’horloge, fait foi : maintenant() est au 1er octobre)', async () => {
      await acceptee(traitement('2026-10-05'));
    });

    it('très loin dans le futur (2030-01-01) refusé', async () => {
      await refusee(traitement('2030-01-01'), '01/01/2030');
    });

    it('un autre jour injecté déplace la limite (jour serveur 2026-12-31 : 2027-01-01 accepté, 2027-01-02 refusé)', async () => {
      const finDAnnee = appPour({ jourServeur: () => '2026-12-31' });
      const ok = traitement('2027-01-01');
      expect(await lot([ok], finDAnnee)).toEqual({ refus: [] });
      expect(await evenements(ok.id)).toBe(1);
      const non = traitement('2027-01-02');
      expect((await lot([non], finDAnnee)).refus).toHaveLength(1);
      expect(await evenements(non.id)).toBe(0);
    });

    it('sans jourServeur injecté, le jour est celui de Paris tiré de maintenant() (22:30 UTC le 22/10 = 00:30 le 23/10 à Paris)', async () => {
      const tard = new Date('2026-10-22T22:30:00Z');
      const parDefaut = appPour({ maintenant: () => tard });
      const jetonTard = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, theo.id, tard);
      const ok = traitement('2026-10-24');
      expect(await lot([ok], parDefaut, jetonTard)).toEqual({ refus: [] });
      expect(await evenements(ok.id)).toBe(1);
      const non = traitement('2026-10-25');
      expect((await lot([non], parDefaut, jetonTard)).refus).toEqual([{ table: 'evenement', id: non.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(non.id)).toBe(0);
    });
  });

  describe('règle 3 : correction et annulation', () => {
    it('correction vers une date future (J+2) refusée ; l’origine reste telle quelle', async () => {
      const origine = traitement(JOUR_SERVEUR);
      await acceptee(origine);
      await refusee(remplacement(origine, 'correction', '2026-10-24'), '24/10/2026');
      expect(await nombre(`SELECT 1 FROM evenement WHERE remplace_evenement_id = $1`, [origine.id])).toBe(0);
      const r = await base.pool.query<{ date: string }>(`SELECT date::text FROM evenement WHERE id = $1`, [origine.id]);
      expect(r.rows[0]?.date).toBe(JOUR_SERVEUR);
    });

    it('correction vers demain (J+1) acceptée', async () => {
      const origine = traitement('2026-10-10');
      await acceptee(origine);
      await acceptee(remplacement(origine, 'correction', '2026-10-23'));
    });

    it('annulation portant une date de J+2 refusée', async () => {
      const origine = traitement('2026-10-12');
      await acceptee(origine);
      await refusee(remplacement(origine, 'annulation', '2026-10-24'), '24/10/2026');
    });

    it('annulation d’un traitement passé, à la date du traitement : acceptée (le registre garde la trace)', async () => {
      const origine = traitement('2026-10-12');
      await acceptee(origine);
      await acceptee(remplacement(origine, 'annulation', '2026-10-12'));
    });
  });

  describe('règle 2 : les autres saisies du même envoi ne sont pas bloquées', () => {
    it('un traitement futur au milieu d’un envoi : seul lui est refusé, récolte et traitements valides écrits', async () => {
      const avant = traitement('2026-10-20');
      const futur = traitement('2026-10-25');
      const apres = traitement('2026-10-23');
      const r = recolte('2026-10-21');
      const reponse = await lot([avant, futur, r, apres]);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: futur.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(futur.id)).toBe(0);
      for (const e of [avant, r, apres]) {
        expect(await evenements(e.id)).toBe(1);
        expect(await modifications(e.id)).toBe(1);
      }
      expect(await refusDe(futur.id)).toBe(1);
    });

    it('le renvoi du même envoi (réponse perdue) ne double rien : le refus reste un refus, les acceptés restent uniques', async () => {
      const bon = traitement('2026-10-21');
      const futur = traitement('2026-10-26');
      await lot([bon, futur]);
      const reponse = await lot([bon, futur]);
      expect(reponse.refus.map((x) => x.id)).toContain(futur.id);
      expect(reponse.refus.map((x) => x.id)).not.toContain(bon.id);
      expect(await evenements(bon.id)).toBe(1);
      expect(await evenements(futur.id)).toBe(0);
    });
  });

  describe('règle 4 et hors périmètre', () => {
    it('une récolte et une irrigation datées de J+2 ne sont pas visées par T80 : acceptées', async () => {
      const r = recolte('2026-10-24');
      const i = put('irrigation', '2026-10-24', { secteurIrrigationId: a.secteurIrrigation, dureeMinutes: 30 });
      expect(await lot([r, i])).toEqual({ refus: [] });
      expect(await evenements(r.id)).toBe(1);
      expect(await evenements(i.id)).toBe(1);
    });

    it('un traitement déjà en base à date future n’est ni réécrit ni supprimé par un envoi qui refuse un autre traitement', async () => {
      const ancien = nouvelId<'Evenement'>();
      await base.pool.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, photos, detail)
         VALUES ($1, $2, 'traitement', '2026-11-30', '2026-10-01T05:00:00Z', $3, 'tap', '{}', '{}', $4)`,
        [ancien, ferme, theo.id, JSON.stringify(detailTraitement())],
      );
      const avant = await base.pool.query(`SELECT * FROM evenement WHERE id = $1`, [ancien]);
      expect(avant.rows).toHaveLength(1);
      await refusee(traitement('2026-12-01'), '01/12/2026');
      const apres = await base.pool.query(`SELECT * FROM evenement WHERE id = $1`, [ancien]);
      expect(apres.rows).toEqual(avant.rows);
      expect(await refusDe(ancien)).toBe(0);
      expect(await modifications(ancien)).toBe(0);
    });
  });
});
