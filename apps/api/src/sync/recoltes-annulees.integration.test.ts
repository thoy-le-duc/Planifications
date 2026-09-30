/**
 * Tests d'acceptation T10g — récoltes annulées (Q20), contre un vrai Postgres (même amorçage que
 * stock.integration.test.ts : DATABASE_URL, base jetable `t10g_annulees_…` supprimée à la fin ;
 * sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat (en plus de T10, T10c, T10d : en-têtes de upload, stock et stock-suites) ─────────
 *
 * Chaîne d'une récolte : l'origine (sans remplace_evenement_id), ses corrections, les
 * corrections de ses corrections, et toutes leurs annulations (comme `lireChaine` de stock.ts).
 * La chaîne est ANNULÉE dès qu'elle contient une annulation, quelle que soit la cible de
 * l'annulation (l'origine ou une correction) : c'est déjà la règle du stock (annuler retire
 * toute la chaîne, décision 3 de T10c).
 *
 * 1. Q20 : une récolte annulée ne se corrige plus.
 *    - Un PUT d'événement de récolte avec remplace_sorte = 'correction' dont la chaîne est annulée
 *      (écrite avant, ou plus haut dans le même lot) → refus de motif 'recolte_annulee' (nouveau
 *      MotifRefus). Message affiché sur le téléphone : il dit que la récolte est annulée et qu'il
 *      faut saisir une nouvelle récolte (contient « annulée » et « nouvelle récolte »).
 *    - Même motif pour une correction QUI VISE une annulation, et pour une annulation qui vise une
 *      annulation (« annuler l'annulation » ne rétablit rien : on saisit une nouvelle récolte).
 *      Une annulation redondante de l'origine sans mouvement reste acceptée (T10d, figé dans
 *      stock-suites.integration.test.ts).
 *    - Comme les autres refus de T10c : lot avec stock → refusé en entier, la correction est la
 *      fautive, stock inchangé ; lot d'événements seuls → seule la correction est refusée, les
 *      autres écritures passent (T10). Le refus est enregistré (refus_synchro) et ne bloque pas
 *      la file : le lot suivant passe.
 *    - Une correction déjà écrite AVANT l'annulation et renvoyée à l'identique (réponse perdue,
 *      PowerSync renvoie le lot) reste acceptée sans double écriture : le renvoi n'est pas une
 *      nouvelle correction.
 *    - Correction PUIS annulation dans le même lot : acceptées (la correction arrive quand la
 *      chaîne n'est pas encore annulée).
 *
 * 2. Q20, conflit : deux corrections hors ligne de la même récolte. Celle qui reste en vigueur est
 *    la plus récente selon l'heure du téléphone (`horodatage`), égalité départagée par l'id le
 *    plus grand (même ordre que `lireChaine` et la vue evenements_en_vigueur), PAS la dernière
 *    arrivée. Le stock vaut toujours la quantité en vigueur :
 *    - la plus récente arrive d'abord (acceptée) ; la plus ancienne arrive ensuite avec un
 *      mouvement → son lot est refusé en entier (rien d'écrit), le stock ne bouge pas. C'est vrai
 *      quel que soit le mouvement envoyé : celui que le téléphone a calculé sur sa chaîne locale
 *      (100 − 12 = +88) comme celui qui « tomberait juste » sur la somme du serveur
 *      (100 − 15 = +85, l'exemple de T10d). Le motif de la fautive n'est pas figé ici ;
 *    - arrivées dans l'ordre de leur heure : la seconde (plus récente) passe si son mouvement vaut
 *      nouvelle quantité − somme de la chaîne ; le stock suit la plus récente ;
 *    - une correction suivante s'appuie sur celle en vigueur.
 *    En vigueur au serveur : la vue evenements_en_vigueur montre UNE seule ligne de la chaîne,
 *    celle de la quantité du stock ; aucune si la chaîne est annulée.
 *
 * 3. Même « en vigueur » partout (serveur et téléphone) : pour une chaîne ramifiée (deux
 *    corrections de l'origine, puis une correction de la première, plus récente que tout), la vue
 *    evenements_en_vigueur montre une seule ligne, la correction la plus récente de toute la
 *    chaîne, dont la quantité est celle du stock. Le téléphone suit la même règle
 *    (apps/web/src/ecrans/aujourdhui/recoltes-annulees.test.tsx).
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const RECOLTE_ANNULEE = 'recolte_annulee';

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface RefusRecu {
  readonly table: string;
  readonly id: string;
  readonly motif: string;
}

interface ReponseUpload {
  readonly refus: readonly RefusRecu[];
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10g')('T10g : récoltes annulées et corrections concurrentes', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let theo: string;
  let fermeA: string;
  let especeA: string;

  beforeAll(async () => {
    base = await creerBaseJetable('t10g_annulees');
    cles = { active: await genererCleSignature('cle-t10g'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
    });
    fermeA = await creerFerme(base.pool, 'Jardins de Garonne');
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, fermeA, { role: 'gerant' });
    theo = u.id;
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT);

    const famille = randomUUID();
    await base.pool.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`,
      [famille, fermeA],
    );
    especeA = randomUUID();
    await base.pool.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Tomate', 'legume', false, 'kg')`,
      [especeA, fermeA, famille],
    );
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const TABLE_DE: Readonly<Record<string, string>> = { evenement: 'evenement', article_stock: 'article_stock', mouvement_stock: 'mouvement_stock' };
  const ecrites = (e: EcritureEnvoyee) => compter(`SELECT 1 FROM ${TABLE_DE[e.table] ?? 'evenement'} WHERE id = $1`, [e.id]);
  const refusDe = (id: string) => compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = $1`, [id]);

  async function stock(articleId: string): Promise<number> {
    const r = await base.pool.query<{ s: number }>(
      `SELECT coalesce(sum(quantite), 0)::float8 AS s FROM mouvement_stock WHERE article_stock_id = $1`,
      [articleId],
    );
    return r.rows[0]?.s ?? Number.NaN;
  }

  /** Refus enregistrés pour `id` : motif et message. */
  async function refusEnregistres(id: string): Promise<{ motif: string; message: string }[]> {
    const r = await base.pool.query<{ motif: string; message: string }>(`SELECT motif, message FROM refus_synchro WHERE ligne_id = $1`, [id]);
    return r.rows;
  }

  /**
   * Lignes de la vue evenements_en_vigueur parmi `ecritures` (une chaîne) : id et quantité, dans
   * l'ordre des ids.
   */
  async function enVigueur(ecritures: readonly EcritureEnvoyee[]): Promise<{ id: string; quantite: number }[]> {
    const r = await base.pool.query<{ id: string; quantite: number }>(
      `SELECT id::text AS id, (detail ->> 'quantite')::float8 AS quantite FROM evenements_en_vigueur WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [ecritures.map((e) => e.id)],
    );
    return r.rows;
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  function putRecolte(quantite = 12, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: fermeA,
        type: 'recolte',
        date: '2026-10-01',
        horodatage: '2026-10-01T03:00:00.000Z',
        auteur_id: theo,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ quantite, unite: 'kg', categorie: null }),
        ...autres,
      },
    };
  }

  /** Annulation ou correction de `cible` à l'heure `horodatage` (téléphone) ; quantité : celle de la correction. */
  function putRemplacement(cible: EcritureEnvoyee, sorte: 'annulation' | 'correction', horodatage: string, quantite = 12): EcritureEnvoyee {
    return putRecolte(quantite, {
      horodatage,
      remplace_sorte: sorte,
      remplace_evenement_id: cible.id,
    });
  }

  function putArticle(): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'article_stock',
      id: nouvelId<'ArticleStock'>(),
      donnees: { ferme_id: fermeA, espece_id: especeA, variete_id: null, unite: 'kg', categorie: null },
    };
  }

  function putMouvement(articleId: string, quantite: number, recolteId: string): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'mouvement_stock',
      id: nouvelId<'MouvementStock'>(),
      donnees: { ferme_id: fermeA, article_stock_id: articleId, date: '2026-10-01', quantite, motif: 'recolte', recolte_id: recolteId },
    };
  }

  /** Récolte de `quantite` kg + article + mouvement, acceptés en un lot (stock = quantite). */
  async function recolteAcceptee(quantite = 12): Promise<{ recolte: EcritureEnvoyee; article: string }> {
    const recolte = putRecolte(quantite);
    const article = putArticle();
    expect(await lot([recolte, article, putMouvement(article.id, quantite, recolte.id)])).toEqual({ refus: [] });
    return { recolte, article: article.id };
  }

  /** Remplacement + son mouvement, acceptés en un lot. */
  async function remplacementAccepte(
    cible: EcritureEnvoyee,
    sorte: 'annulation' | 'correction',
    horodatage: string,
    quantite: number,
    article: string,
    mouvement: number,
  ): Promise<EcritureEnvoyee> {
    const r = putRemplacement(cible, sorte, horodatage, quantite);
    expect(await lot([r, putMouvement(article, mouvement, r.id)]), `${sorte} acceptée`).toEqual({ refus: [] });
    return r;
  }

  /** Le lot est refusé EN ENTIER : rien d'écrit, chaque écriture a son refus ; la fautive a `motif` (si donné). */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive?: EcritureEnvoyee, motif?: string): Promise<void> {
    const reponse = await lot(ecritures);
    if (fautive !== undefined && motif !== undefined) {
      const siens = reponse.refus.filter((r) => r.id === fautive.id);
      expect(siens.map((r) => r.motif), `refus de la fautive dans ${JSON.stringify(reponse.refus)}`).toEqual([motif]);
    }
    for (const e of ecritures) {
      expect(reponse.refus.some((r) => r.id === e.id && r.table === e.table), `${e.table} ${e.id} figure dans les refus`).toBe(true);
      expect(await ecrites(e), `${e.table} ${e.id} non écrit`).toBe(0);
    }
  }

  const refusSeul = (e: EcritureEnvoyee, motif: string): ReponseUpload => ({ refus: [{ table: e.table, id: e.id, motif }] });

  const H = (hhmm: string) => `2026-10-01T${hhmm}:00.000Z`;

  // ── 1. Q20 : une récolte annulée ne se corrige plus ─────────────────────────────────────────

  describe('1. Q20 : une récolte annulée ne se corrige plus (motif recolte_annulee)', () => {
    it('origine annulée, correction + mouvement : refusée en entier, la correction est la fautive (recolte_annulee), stock inchangé à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'annulation', H('04:00'), 12, article, -12);
      expect(await stock(article)).toBe(0);

      const correction = putRemplacement(recolte, 'correction', H('05:00'), 40);
      const mouvement = putMouvement(article, 40, correction.id);
      await refuseEnEntier([correction, mouvement], correction, RECOLTE_ANNULEE);
      expect(await stock(article)).toBe(0);
      expect((await refusEnregistres(correction.id)).map((r) => r.motif)).toEqual([RECOLTE_ANNULEE]);
    });

    it('lot d’événements seuls : seule la correction est refusée (recolte_annulee), le reste passe ; message explicite ; le lot suivant passe', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'annulation', H('04:00'), 12, article, -12);

      const correction = putRemplacement(recolte, 'correction', H('05:00'), 40);
      const autre = putRecolte(3);
      expect(await lot([correction, autre])).toEqual(refusSeul(correction, RECOLTE_ANNULEE));
      expect(await ecrites(correction)).toBe(0);
      expect(await ecrites(autre)).toBe(1);

      const [refus] = await refusEnregistres(correction.id);
      expect(refus?.motif).toBe(RECOLTE_ANNULEE);
      expect(refus?.message ?? '', 'le message dit pourquoi et quoi faire').toMatch(/annulée/i);
      expect(refus?.message ?? '').toMatch(/nouvelle récolte/i);

      // La file n'est pas bloquée : une nouvelle récolte (la façon de rétablir) passe.
      const nouvelle = await recolteAcceptee(40);
      expect(await stock(nouvelle.article)).toBe(40);
      expect(await stock(article)).toBe(0);
    });

    it('correction annulée (12 → 15, puis annulation de la correction) : corriger la correction ou l’origine est refusé', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const c1 = await remplacementAccepte(recolte, 'correction', H('04:00'), 15, article, 3);
      await remplacementAccepte(c1, 'annulation', H('05:00'), 15, article, -15);
      expect(await stock(article)).toBe(0);

      const surLaCorrection = putRemplacement(c1, 'correction', H('06:00'), 20);
      await refuseEnEntier([surLaCorrection, putMouvement(article, 20, surLaCorrection.id)], surLaCorrection, RECOLTE_ANNULEE);
      const surLOrigine = putRemplacement(recolte, 'correction', H('06:00'), 20);
      await refuseEnEntier([surLOrigine, putMouvement(article, 20, surLOrigine.id)], surLOrigine, RECOLTE_ANNULEE);
      expect(await lot([putRemplacement(c1, 'correction', H('06:30'), 20)])).toMatchObject({ refus: [{ motif: RECOLTE_ANNULEE }] });
      expect(await stock(article)).toBe(0);
    });

    it('origine annulée après une correction (12 → 15, annulation de l’origine −15) : corriger la correction est refusé', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const c1 = await remplacementAccepte(recolte, 'correction', H('04:00'), 15, article, 3);
      await remplacementAccepte(recolte, 'annulation', H('05:00'), 12, article, -15);
      expect(await stock(article)).toBe(0);

      const c2 = putRemplacement(c1, 'correction', H('06:00'), 20);
      await refuseEnEntier([c2, putMouvement(article, 20, c2.id)], c2, RECOLTE_ANNULEE);
      expect(await lot([putRemplacement(c1, 'correction', H('06:30'), 20)])).toMatchObject({ refus: [{ motif: RECOLTE_ANNULEE }] });
      expect(await stock(article)).toBe(0);
    });

    it('même lot, annulation PUIS correction (avec stock) : refusé en entier, la correction est la fautive, le stock reste à 12', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = putRemplacement(recolte, 'annulation', H('04:00'));
      const correction = putRemplacement(recolte, 'correction', H('05:00'), 40);
      await refuseEnEntier(
        [annulation, putMouvement(article, -12, annulation.id), correction, putMouvement(article, 40, correction.id)],
        correction,
        RECOLTE_ANNULEE,
      );
      expect(await stock(article)).toBe(12);
    });

    it('même lot, annulation PUIS correction (événements seuls) : l’annulation passe, la correction est refusée (recolte_annulee)', async () => {
      const recolte = putRecolte(12);
      expect(await lot([recolte])).toEqual({ refus: [] });
      const annulation = putRemplacement(recolte, 'annulation', H('04:00'));
      const correction = putRemplacement(recolte, 'correction', H('05:00'), 40);
      expect(await lot([annulation, correction])).toEqual(refusSeul(correction, RECOLTE_ANNULEE));
      expect(await ecrites(annulation)).toBe(1);
      expect(await ecrites(correction)).toBe(0);
    });

    it('même lot, correction PUIS annulation de la correction (avec stock) : acceptées, le stock revient à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 15);
      const annulation = putRemplacement(correction, 'annulation', H('05:00'), 15);
      expect(
        await lot([correction, putMouvement(article, 3, correction.id), annulation, putMouvement(article, -15, annulation.id)]),
      ).toEqual({ refus: [] });
      expect(await stock(article)).toBe(0);
    });

    it('même lot, correction PUIS annulation (événements seuls) : acceptées toutes les deux', async () => {
      const recolte = putRecolte(12);
      expect(await lot([recolte])).toEqual({ refus: [] });
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 15);
      const annulation = putRemplacement(correction, 'annulation', H('05:00'), 15);
      expect(await lot([correction, annulation])).toEqual({ refus: [] });
      expect(await ecrites(correction)).toBe(1);
      expect(await ecrites(annulation)).toBe(1);
    });

    it('correction qui vise l’annulation elle-même : refusée (recolte_annulee)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = await remplacementAccepte(recolte, 'annulation', H('04:00'), 12, article, -12);
      const correction = putRemplacement(annulation, 'correction', H('05:00'), 40);
      expect(await lot([correction])).toEqual(refusSeul(correction, RECOLTE_ANNULEE));
      await refuseEnEntier([correction, putMouvement(article, 40, correction.id)], correction, RECOLTE_ANNULEE);
      expect(await stock(article)).toBe(0);
    });

    it('« annuler l’annulation » ne rétablit rien : refusée (recolte_annulee), avec ou sans mouvement, le stock reste à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = await remplacementAccepte(recolte, 'annulation', H('04:00'), 12, article, -12);

      const sansMouvement = putRemplacement(annulation, 'annulation', H('05:00'));
      expect(await lot([sansMouvement])).toEqual(refusSeul(sansMouvement, RECOLTE_ANNULEE));
      expect(await ecrites(sansMouvement)).toBe(0);

      const avecMouvement = putRemplacement(annulation, 'annulation', H('05:30'));
      await refuseEnEntier([avecMouvement, putMouvement(article, 12, avecMouvement.id)], avecMouvement, RECOLTE_ANNULEE);
      expect(await stock(article)).toBe(0);
      expect(await enVigueur([recolte, annulation, sansMouvement, avecMouvement]), 'rien de la chaîne n’est en vigueur').toEqual([]);
    });

    it('renvoi identique d’une correction écrite AVANT l’annulation (réponse perdue) : accepté sans double écriture', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 15);
      const ecart = putMouvement(article, 3, correction.id);
      expect(await lot([correction, ecart])).toEqual({ refus: [] });
      await remplacementAccepte(correction, 'annulation', H('05:00'), 15, article, -15);
      expect(await stock(article)).toBe(0);

      expect(await lot([correction, ecart]), 'le renvoi n’est pas une nouvelle correction').toEqual({ refus: [] });
      expect(await lot([correction]), 'renvoi de l’événement seul').toEqual({ refus: [] });
      expect(await ecrites(correction)).toBe(1);
      expect(await refusDe(correction.id)).toBe(0);
      expect(await stock(article)).toBe(0);
    });

    it('une correction d’une récolte NON annulée passe toujours (témoin)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'correction', H('04:00'), 15, article, 3);
      expect(await stock(article)).toBe(15);
    });
  });

  // ── 2. Q20, conflit : la plus récente (heure du téléphone) gagne ────────────────────────────

  describe('2. Q20, conflit : deux corrections hors ligne, la plus récente selon l’heure du téléphone reste en vigueur', () => {
    it('ordre inverse : 15 kg à 07:00 arrive d’abord, puis 100 kg à 04:00 avec +85 (juste sur la somme du serveur) → refusée en entier, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      expect(await stock(article)).toBe(15);

      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      await refuseEnEntier([ancienne, putMouvement(article, 85, ancienne.id)]);
      expect(await stock(article), 'le stock suit la correction en vigueur').toBe(15);
      expect(await enVigueur([recolte, recente, ancienne])).toEqual([{ id: recente.id, quantite: 15 }]);
    });

    it('ordre inverse, mouvement calculé par le téléphone resté hors ligne (100 − 12 = +88) : refusée en entier, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      await refuseEnEntier([ancienne, putMouvement(article, 88, ancienne.id)]);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, recente, ancienne])).toEqual([{ id: recente.id, quantite: 15 }]);
    });

    it('ordre inverse, la plus ancienne sans mouvement : quelle que soit la réponse, 15 reste en vigueur et en stock', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      await lot([ancienne]);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, recente, ancienne])).toEqual([{ id: recente.id, quantite: 15 }]);
    });

    it('ordre inverse puis correction suivante : elle s’appuie sur 15 (la plus récente), pas sur 100', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      await lot([ancienne, putMouvement(article, 85, ancienne.id)]);
      const suivante = await remplacementAccepte(recente, 'correction', H('08:00'), 18, article, 3);
      expect(await stock(article)).toBe(18);
      expect(await enVigueur([recolte, recente, ancienne, suivante])).toEqual([{ id: suivante.id, quantite: 18 }]);
    });

    it('ordre de l’heure : 100 kg à 04:00 puis 15 kg à 07:00 (15 − 100 = −85) : acceptées, stock 15, 15 en vigueur (témoin)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const ancienne = await remplacementAccepte(recolte, 'correction', H('04:00'), 100, article, 88);
      expect(await stock(article)).toBe(100);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, -85);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, ancienne, recente])).toEqual([{ id: recente.id, quantite: 15 }]);
    });

    it('même heure : l’id le plus grand gagne ; il arrive d’abord, l’autre (id plus petit) arrive ensuite avec +85 → refusée en entier, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      // Ids croissants dans l'ordre de création (générateur horodaté) : `petit` < `grand`.
      const petit = putRemplacement(recolte, 'correction', H('07:00'), 100);
      const grand = putRemplacement(recolte, 'correction', H('07:00'), 15);
      expect(petit.id < grand.id, 'ids dans l’ordre de création').toBe(true);

      expect(await lot([grand, putMouvement(article, 3, grand.id)])).toEqual({ refus: [] });
      await refuseEnEntier([petit, putMouvement(article, 85, petit.id)]);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, petit, grand])).toEqual([{ id: grand.id, quantite: 15 }]);
    });

    it('même heure, l’id le plus petit arrive d’abord puis le plus grand (15 − 100 = −85) : acceptées, stock 15 (témoin)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const petit = putRemplacement(recolte, 'correction', H('07:00'), 100);
      const grand = putRemplacement(recolte, 'correction', H('07:00'), 15);
      expect(await lot([petit, putMouvement(article, 88, petit.id)])).toEqual({ refus: [] });
      expect(await lot([grand, putMouvement(article, -85, grand.id)])).toEqual({ refus: [] });
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, petit, grand])).toEqual([{ id: grand.id, quantite: 15 }]);
    });
  });

  // ── 3. Même « en vigueur » au serveur (vue) et dans le stock ────────────────────────────────

  describe('3. en vigueur : une seule ligne par chaîne, la correction la plus récente de toute la chaîne', () => {
    it('chaîne ramifiée : 12 → 15 (06:10), 12 → 20 (06:20), puis 15 → 30 (06:30) : stock 30 et une seule ligne en vigueur, 30', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const c1 = await remplacementAccepte(recolte, 'correction', H('06:10'), 15, article, 3);
      const c2 = await remplacementAccepte(recolte, 'correction', H('06:20'), 20, article, 5);
      const c3 = await remplacementAccepte(c1, 'correction', H('06:30'), 30, article, 10);
      expect(await stock(article)).toBe(30);
      expect(await enVigueur([recolte, c1, c2, c3])).toEqual([{ id: c3.id, quantite: 30 }]);
    });

    it('chaîne ramifiée dont une branche est annulée : stock 0 et rien en vigueur', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const c1 = await remplacementAccepte(recolte, 'correction', H('06:10'), 15, article, 3);
      const c2 = await remplacementAccepte(recolte, 'correction', H('06:20'), 20, article, 5);
      // Un autre téléphone annule c1 (qu'il voyait en vigueur) : annuler retire toute la chaîne.
      const a = await remplacementAccepte(c1, 'annulation', H('06:30'), 15, article, -20);
      expect(await stock(article)).toBe(0);
      expect(await enVigueur([recolte, c1, c2, a])).toEqual([]);
    });
  });
});
