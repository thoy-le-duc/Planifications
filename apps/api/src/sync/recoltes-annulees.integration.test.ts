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
 *    arrivée. Le stock vaut toujours la quantité en vigueur.
 *
 *    Décision 6 du chef (après les tests) : le SERVEUR calcule l'écart de stock d'une correction
 *    ou d'une annulation de récolte, sous le verrou de la ferme ; le mouvement envoyé par le
 *    téléphone (calculé sur sa chaîne locale, peut-être en retard) n'est plus comparé. La ligne
 *    mouvement_stock est écrite avec l'id reçu et la quantité du serveur :
 *      - correction : quantité en vigueur après − quantité en vigueur avant ;
 *      - annulation : − quantité en vigueur (toute la chaîne).
 *    Le renvoi identique du lot (même id, quantité du téléphone) reste accepté sans double
 *    écriture, et la ligne garde la quantité du serveur.
 *
 *    Forme figée ici (décision 5, « la plus simple ») : une correction plus ANCIENNE que celle en
 *    vigueur est REFUSÉE (motif libre), avec ou sans mouvement : lot avec stock refusé en entier,
 *    rien d'écrit, stock inchangé. Un remplacement dont l'écart du serveur est nul mais qui porte
 *    un mouvement reste refusé (annulation redondante avec −12 : T10d, inchangé).
 *
 *    - la plus récente arrive d'abord (acceptée) ; la plus ancienne arrive ensuite → refusée,
 *      quel que soit son mouvement (+88 ou +85) ;
 *    - arrivées dans l'ordre de leur heure, la seconde (plus récente) porte le mouvement de sa
 *      chaîne locale (15 − 12 = +3) : acceptée, en vigueur, mouvement écrit −85, stock 15 ;
 *    - un mouvement volontairement faux (+1 000, −50) ne gonfle ni ne vide jamais le stock :
 *      l'écart écrit est celui du serveur ; un mouvement rattaché à l'origine reste borné (B1).
 *    En vigueur au serveur : la vue evenements_en_vigueur montre UNE seule ligne de la chaîne,
 *    celle de la quantité du stock ; aucune si la chaîne est annulée.
 *
 * 3. Même « en vigueur » partout (serveur et téléphone) : pour une chaîne ramifiée (deux
 *    corrections de l'origine, puis une correction de la première, plus récente que tout), la vue
 *    evenements_en_vigueur montre une seule ligne, la correction la plus récente de toute la
 *    chaîne, dont la quantité est celle du stock. Le téléphone suit la même règle
 *    (apps/web/src/ecrans/aujourdhui/recoltes-annulees.test.tsx).
 *
 * 4. Décision 8 du chef (après la relecture) : le serveur écrit lui-même le mouvement d'écart de
 *    toute correction ou annulation de récolte ACCEPTÉE dont la chaîne a un article, que le
 *    téléphone ait envoyé un mouvement ou non :
 *    - mouvement envoyé : sa ligne porte la quantité du serveur (section 2), et le serveur n'en
 *      crée pas d'autre ;
 *    - aucun mouvement envoyé et écart non nul : le serveur crée la ligne mouvement_stock
 *      (motif 'recolte', recolte_id = l'événement, article de la chaîne, ferme de l'événement,
 *      quantité = l'écart) avec l'id DÉTERMINISTE
 *        uuidv5(ESPACE_MOUVEMENT_ECART, id de l'événement en minuscules, UTF-8),
 *        ESPACE_MOUVEMENT_ECART = '675540a1-1589-4a49-9629-84b5d41e55d2' (RFC 4122, SHA-1) ;
 *      un renvoi du lot ne le double pas ;
 *    - un mouvement du téléphone qui arrive PLUS TARD pour cet événement (autre id, quantité
 *      quelconque) est accepté sans rien écrire ; le stock reste juste ;
 *    - chaîne sans article (récolte sans stock, d'avant T13) : aucun mouvement n'est créé.
 *    Exemple : 12 (stock 12), A corrige à 15 à 05:00 (+3) ; B, hors ligne, change seulement la
 *    date à 06:00 (correction à 12 kg, sans mouvement) → acceptée, 12 en vigueur, −3 écrit par
 *    le serveur, stock 12.
 *
 * 5. Décision 9 : écart nul sur une correction acceptée (deux téléphones corrigent à la même
 *    quantité) → correction acceptée, en vigueur si plus récente ; son mouvement éventuel est
 *    accepté sans rien écrire (aucune ligne, ni la sienne ni celle du serveur). Le refus de T10d
 *    de l'annulation redondante qui porte un mouvement reste inchangé.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const RECOLTE_ANNULEE = 'recolte_annulee';
/** Décision 8 : espace de noms des mouvements d'écart créés par le serveur (contrat, en tête). */
const ESPACE_MOUVEMENT_ECART = '675540a1-1589-4a49-9629-84b5d41e55d2';

/** UUID v5 (RFC 4122 : SHA-1 de l'espace de noms puis du nom, version 5, variante RFC). */
function uuidV5(nom: string, espace: string): string {
  const octets = createHash('sha1')
    .update(Buffer.from(espace.replace(/-/g, ''), 'hex'))
    .update(Buffer.from(nom, 'utf8'))
    .digest()
    .subarray(0, 16);
  octets[6] = ((octets[6] ?? 0) & 0x0f) | 0x50;
  octets[8] = ((octets[8] ?? 0) & 0x3f) | 0x80;
  const h = octets.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Id du mouvement d'écart que le serveur crée pour l'événement `evenementId`. */
const idMouvementServeur = (evenementId: string): string => uuidV5(evenementId.toLowerCase(), ESPACE_MOUVEMENT_ECART);

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

  /** Quantité écrite en base pour le mouvement `id` (NaN s'il n'existe pas). */
  async function quantiteEcrite(id: string): Promise<number> {
    const r = await base.pool.query<{ q: number }>(`SELECT quantite::float8 AS q FROM mouvement_stock WHERE id = $1`, [id]);
    return r.rows[0]?.q ?? Number.NaN;
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

    it('ordre inverse, la plus ancienne sans mouvement : refusée (forme figée), 15 reste en vigueur et en stock', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const recente = await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      const reponse = await lot([ancienne]);
      expect(reponse.refus.map((r) => r.id)).toEqual([ancienne.id]);
      expect(await ecrites(ancienne)).toBe(0);
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

    it('décision 6 : dans l’ordre de l’heure, la plus récente porte le mouvement de sa chaîne locale (+3 au lieu de −85) : acceptée, en vigueur, −85 écrit, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      // Téléphone B (04:00) arrive d'abord ; le téléphone A (07:00) n'a jamais vu B.
      const ancienne = await remplacementAccepte(recolte, 'correction', H('04:00'), 100, article, 88);
      expect(await stock(article)).toBe(100);
      const recente = putRemplacement(recolte, 'correction', H('07:00'), 15);
      const ecartLocal = putMouvement(article, 3, recente.id);
      expect(await lot([recente, ecartLocal])).toEqual({ refus: [] });
      expect(await quantiteEcrite(ecartLocal.id), 'le mouvement écrit est celui du serveur').toBe(-85);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, ancienne, recente])).toEqual([{ id: recente.id, quantite: 15 }]);

      // Réponse perdue : PowerSync renvoie le lot tel quel (+3). Accepté, rien en double.
      expect(await lot([recente, ecartLocal])).toEqual({ refus: [] });
      expect(await refusDe(ecartLocal.id)).toBe(0);
      expect(await compter(`SELECT 1 FROM mouvement_stock WHERE id = $1`, [ecartLocal.id])).toBe(1);
      expect(await quantiteEcrite(ecartLocal.id)).toBe(-85);
      expect(await stock(article)).toBe(15);
    });

    it('décision 6 : même heure, l’id le plus petit arrive d’abord puis le plus grand avec +3 (chaîne locale) : acceptée, −85 écrit, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const petit = putRemplacement(recolte, 'correction', H('07:00'), 100);
      const grand = putRemplacement(recolte, 'correction', H('07:00'), 15);
      expect(await lot([petit, putMouvement(article, 88, petit.id)])).toEqual({ refus: [] });
      const ecartLocal = putMouvement(article, 3, grand.id);
      expect(await lot([grand, ecartLocal])).toEqual({ refus: [] });
      expect(await quantiteEcrite(ecartLocal.id)).toBe(-85);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, petit, grand])).toEqual([{ id: grand.id, quantite: 15 }]);
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

  // ── 2 bis. Décision 6 : un mouvement faux ne gonfle jamais le stock ─────────────────────────

  describe('2 bis. décision 6 : l’écart écrit est celui du serveur, un mouvement faux ne gonfle ni ne vide le stock', () => {
    it('correction 12 → 15 envoyée avec +1 000 : acceptée, +3 écrit, stock 15', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 15);
      const faux = putMouvement(article, 1_000, correction.id);
      expect(await lot([correction, faux])).toEqual({ refus: [] });
      expect(await quantiteEcrite(faux.id)).toBe(3);
      expect(await stock(article)).toBe(15);
    });

    it('correction 12 → 10 envoyée avec +1 000 : acceptée, −2 écrit, stock 10', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 10);
      const faux = putMouvement(article, 1_000, correction.id);
      expect(await lot([correction, faux])).toEqual({ refus: [] });
      expect(await quantiteEcrite(faux.id)).toBe(-2);
      expect(await stock(article)).toBe(10);
    });

    it.each([1_000, -50, -12])('annulation après 12 → 15, envoyée avec %s : acceptée, −15 écrit (moins la quantité en vigueur), stock 0', async (envoye) => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'correction', H('04:00'), 15, article, 3);
      const annulation = putRemplacement(recolte, 'annulation', H('05:00'));
      const faux = putMouvement(article, envoye, annulation.id);
      expect(await lot([annulation, faux])).toEqual({ refus: [] });
      expect(await quantiteEcrite(faux.id)).toBe(-15);
      expect(await stock(article)).toBe(0);
    });

    it('correction +1 000 puis annulation +1 000 : le stock passe de 12 à 15 puis à 0, jamais au-delà', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('04:00'), 15);
      expect(await lot([correction, putMouvement(article, 1_000, correction.id)])).toEqual({ refus: [] });
      expect(await stock(article)).toBe(15);
      const annulation = putRemplacement(correction, 'annulation', H('05:00'), 15);
      expect(await lot([annulation, putMouvement(article, 1_000, annulation.id)])).toEqual({ refus: [] });
      expect(await stock(article)).toBe(0);
    });

    it('mouvement +1 000 rattaché à la récolte d’origine : toujours refusé en entier (B1), stock 12', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const faux = putMouvement(article, 1_000, recolte.id);
      await refuseEnEntier([faux], faux, 'ecriture_invalide');
      expect(await stock(article)).toBe(12);
    });

    it('correction plus ancienne que celle en vigueur envoyée avec +1 000 : refusée en entier, stock inchangé', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'correction', H('07:00'), 15, article, 3);
      const ancienne = putRemplacement(recolte, 'correction', H('04:00'), 100);
      await refuseEnEntier([ancienne, putMouvement(article, 1_000, ancienne.id)]);
      expect(await stock(article)).toBe(15);
    });
  });

  // ── 4 et 5. Décisions 8 et 9 : le mouvement d'écart écrit par le serveur ───────────────────

  describe('4. décision 8 : le serveur écrit le mouvement d’écart, envoyé ou non par le téléphone', () => {
    interface MouvementEnBase {
      readonly id: string;
      readonly ferme_id: string;
      readonly article_stock_id: string;
      readonly quantite: number;
      readonly motif: string;
      readonly recolte_id: string;
    }

    async function mouvementsDe(evenementId: string): Promise<MouvementEnBase[]> {
      const r = await base.pool.query<MouvementEnBase>(
        `SELECT id::text AS id, ferme_id::text AS ferme_id, article_stock_id::text AS article_stock_id, quantite::float8 AS quantite, motif,
                recolte_id::text AS recolte_id
         FROM mouvement_stock WHERE recolte_id = $1 ORDER BY id`,
        [evenementId],
      );
      return r.rows;
    }

    it('uuidV5 du test : vecteur connu de la RFC 4122 (espace DNS, « www.example.com »)', () => {
      expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    });

    it('B1 : A corrige à 15 (05:00, +3), B change seulement la date (06:00, 12 kg, sans mouvement) : acceptée, 12 en vigueur, −3 écrit par le serveur, stock 12', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const a = await remplacementAccepte(recolte, 'correction', H('05:00'), 15, article, 3);
      expect(await stock(article)).toBe(15);

      const b = putRemplacement(recolte, 'correction', H('06:00'), 12);
      expect(await lot([b])).toEqual({ refus: [] });
      expect(await enVigueur([recolte, a, b])).toEqual([{ id: b.id, quantite: 12 }]);
      expect(await stock(article)).toBe(12);
      expect(await mouvementsDe(b.id)).toEqual([
        { id: idMouvementServeur(b.id), ferme_id: fermeA, article_stock_id: article, quantite: -3, motif: 'recolte', recolte_id: b.id },
      ]);

      // Renvoi du même lot (réponse perdue) : rien en double.
      expect(await lot([b])).toEqual({ refus: [] });
      expect(await mouvementsDe(b.id)).toHaveLength(1);
      expect(await stock(article)).toBe(12);

      // Le mouvement du téléphone arrive plus tard (autre id) : accepté, rien d'écrit.
      for (const quantite of [-3, 1_000]) {
        const tardif = putMouvement(article, quantite, b.id);
        expect(await lot([tardif]), `mouvement tardif ${String(quantite)}`).toEqual({ refus: [] });
        expect(await ecrites(tardif)).toBe(0);
        expect(await refusDe(tardif.id)).toBe(0);
      }
      expect(await mouvementsDe(b.id)).toHaveLength(1);
      expect(await stock(article)).toBe(12);
    });

    it('annulation envoyée sans mouvement (après 12 → 15) : acceptée, −15 écrit par le serveur (moins la quantité en vigueur), stock 0, renvoi sans doublon', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'correction', H('05:00'), 15, article, 3);
      const annulation = putRemplacement(recolte, 'annulation', H('06:00'));
      expect(await lot([annulation])).toEqual({ refus: [] });
      expect(await mouvementsDe(annulation.id)).toEqual([
        { id: idMouvementServeur(annulation.id), ferme_id: fermeA, article_stock_id: article, quantite: -15, motif: 'recolte', recolte_id: annulation.id },
      ]);
      expect(await stock(article)).toBe(0);
      expect(await lot([annulation])).toEqual({ refus: [] });
      expect(await mouvementsDe(annulation.id)).toHaveLength(1);
      expect(await stock(article)).toBe(0);
    });

    it('correction envoyée AVEC son mouvement : une seule ligne, celle du téléphone (quantité du serveur), pas de ligne à l’id déterministe', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', H('05:00'), 15);
      const ecart = putMouvement(article, 1_000, correction.id);
      expect(await lot([correction, ecart])).toEqual({ refus: [] });
      expect((await mouvementsDe(correction.id)).map((m) => [m.id, m.quantite])).toEqual([[ecart.id, 3]]);
      expect(await stock(article)).toBe(15);
    });

    it('chaîne sans article (récolte sans stock) : correction et annulation sans mouvement acceptées, aucun mouvement créé', async () => {
      const recolte = putRecolte(12);
      expect(await lot([recolte])).toEqual({ refus: [] });
      const correction = putRemplacement(recolte, 'correction', H('05:00'), 15);
      expect(await lot([correction])).toEqual({ refus: [] });
      const annulation = putRemplacement(correction, 'annulation', H('06:00'), 15);
      expect(await lot([annulation])).toEqual({ refus: [] });
      expect(
        await compter(`SELECT 1 FROM mouvement_stock WHERE recolte_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])`, [
          [recolte.id, correction.id, annulation.id],
          [idMouvementServeur(correction.id), idMouvementServeur(annulation.id)],
        ]),
      ).toBe(0);
    });
  });

  describe('5. décision 9 : écart nul sur une correction acceptée', () => {
    it('B2 : A corrige 12 → 15 (05:00, +3), B aussi 12 → 15 (06:00, +3) : acceptée, B en vigueur, stock 15, aucun mouvement écrit pour B', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const a = await remplacementAccepte(recolte, 'correction', H('05:00'), 15, article, 3);
      const b = putRemplacement(recolte, 'correction', H('06:00'), 15);
      const mouvementB = putMouvement(article, 3, b.id);
      expect(await lot([b, mouvementB])).toEqual({ refus: [] });
      expect(await ecrites(b)).toBe(1);
      expect(await ecrites(mouvementB)).toBe(0);
      expect(await compter(`SELECT 1 FROM mouvement_stock WHERE recolte_id = $1`, [b.id])).toBe(0);
      expect(await stock(article)).toBe(15);
      expect(await enVigueur([recolte, a, b])).toEqual([{ id: b.id, quantite: 15 }]);
      // Renvoi du lot : toujours accepté, toujours rien d'écrit.
      expect(await lot([b, mouvementB])).toEqual({ refus: [] });
      expect(await ecrites(mouvementB)).toBe(0);
      expect(await stock(article)).toBe(15);
    });

    it('inchangé (T10d) : la seconde annulation redondante qui porte −12 est refusée en entier, le mouvement est la fautive, stock 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      await remplacementAccepte(recolte, 'annulation', H('05:00'), 12, article, -12);
      const seconde = putRemplacement(recolte, 'annulation', H('06:00'));
      const inverse = putMouvement(article, -12, seconde.id);
      await refuseEnEntier([seconde, inverse], inverse, 'ecriture_invalide');
      expect(await stock(article)).toBe(0);
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
