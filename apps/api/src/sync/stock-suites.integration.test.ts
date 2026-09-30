/**
 * Tests d'acceptation T10d — suites des relectures de sécurité de T10c, contre un vrai Postgres
 * (même amorçage que stock.integration.test.ts : DATABASE_URL, base jetable `t10d_suites_…`
 * supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * Hors de ce ticket : la correction antidatée (attend la réponse à Q20), non testée ici.
 *
 * ── Contrat (en plus de T10, T10c : en-têtes de upload.integration.test.ts et stock.integration.test.ts)
 *
 * 1. Une correction garde la série (ou la campagne) et l'unité de l'origine, vérifié au serveur.
 *    Un PUT d'événement de récolte avec remplace_sorte = 'correction' dont serie_id, campagne_id
 *    ou detail.unite diffère de ceux de la récolte d'ORIGINE de la chaîne (l'événement sans
 *    remplace_evenement_id tout en haut) → 'ecriture_invalide', rien d'écrit. Vaut dans un lot
 *    d'événements seuls (T10 : les autres écritures du lot passent) comme dans une saisie de
 *    stock (T10c : lot refusé en entier, la correction est la fautive). Même série, même
 *    campagne, même unité : accepté (quantité, catégorie, note… peuvent changer).
 *
 * 2. Annulation redondante (relecture T13) : deux téléphones annulent la même récolte de 12 kg
 *    hors ligne. Le premier lot (annulation + −12) passe, le stock vaut 0. Le second (autre
 *    annulation de la même origine + −12) est refusé en entier, le mouvement est la fautive
 *    ('ecriture_invalide'), le refus est enregistré (refus_synchro) et le stock reste à 0.
 *    Une annulation redondante SANS mouvement est acceptée. (Comportement déjà en place : ces
 *    tests le figent.)
 *
 * 3. Ferme vérifiée dans la même requête que le verrou FOR SHARE (stock.ts et references.ts) :
 *    une référence vers une ligne d'une AUTRE ferme se comporte exactement comme une référence
 *    vers une ligne inexistante :
 *      - même motif ('ecriture_invalide') dans la réponse ;
 *      - même message dans refus_synchro (donc même précision, ex. « série introuvable ») ;
 *      - aucune attente si une autre connexion tient un verrou sur la ligne étrangère : la
 *        ligne d'une autre ferme n'est jamais verrouillée (ni lue) par la requête du membre.
 *    Références : article_stock_id et recolte_id d'un mouvement ; espece_id et variete_id d'un
 *    article ; serie_id, campagne_id, emplacement_ids, remplace_evenement_id,
 *    detail.secteurIrrigationId et detail.produitPhytoId d'un événement. Une ligne de la
 *    bibliothèque commune (ferme_id nul) reste acceptée là où elle l'était (espèce, produit phyto).
 *    Inchangé : un ferme_id d'écriture qui n'est pas une ferme de l'utilisateur → 'ferme_interdite'.
 *
 * 4. Lot trop gros : plus de ECRITURES_MAX_PAR_LOT écritures, ou corps HTTP de plus de
 *    TAILLE_MAX_CORPS octets → 200 (plus de 400 ni de 413 : la file PowerSync ne se bloque
 *    jamais), et CHAQUE écriture du lot figure dans `refus` avec le motif 'lot_trop_gros' ;
 *    rien n'est écrit (ni événement, ni stock, ni historique) ; chaque refus est enregistré dans
 *    refus_synchro (il redescend sur le téléphone). Le lot suivant, de taille normale, passe.
 *    Un lot d'exactement ECRITURES_MAX_PAR_LOT écritures valides est accepté en entier.
 *    Limite dure (décision du chef) : corps de plus de TAILLE_MAX_CORPS_DURE = 32 Mio (exporté
 *    par upload.ts) → 413, rien d'écrit, aucun refus enregistré ; le serveur refuse dès l'en-tête
 *    Content-Length s'il est déclaré, et cesse de lire un flux sans Content-Length au-delà de
 *    la limite (jamais tout le corps en mémoire).
 *
 * 6. PATCH ou DELETE d'un membre de la ferme B sur l'id EXISTANT d'une ligne de la ferme A
 *    (evenement, article_stock, mouvement_stock) : exactement la même réponse que sur un id
 *    inexistant (même motif, même message, ferme_id nul dans refus_synchro) ; la ligne ne
 *    change pas. Aucun indice de son existence. Inchangé : un PUT dont le ferme_id déclaré
 *    n'est pas une ferme de l'utilisateur → 'ferme_interdite'.
 *
 * 5. mouvement_stock.quantite est numeric(12,6) : une nouvelle migration de packages/db (après
 *    0011) change la colonne ; information_schema dit précision 12, échelle 6 ; une quantité à
 *    6 décimales est conservée exactement.
 */
import { creerGenerateurId, ECRITURES_MAX_PAR_LOT } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import * as upload from './upload.ts';
import { TAILLE_MAX_CORPS } from './upload.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
/** Au-delà, la requête du membre est jugée bloquée par le verrou d'une autre connexion. */
const ATTENTE_MAX_MS = 3_000;
/** Limite dure du corps (décision du chef) : au-delà, 413 et le serveur ne lit pas plus. */
const TAILLE_MAX_CORPS_DURE = 32 * 1_048_576;
const DOSSIER_MIGRATIONS = new URL('../../../../packages/db/migrations/', import.meta.url);

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

interface Membre {
  readonly id: string;
  readonly jeton: string;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10d')('T10d : suites de la sécurité du stock', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme A. */
  let theo: Membre;
  /** Gérant de la ferme B seulement. */
  let voisin: Membre;
  let fermeA: string;
  let fermeB: string;
  /** Lignes de la ferme A (deux jeux : deux séries, deux campagnes…) et de la ferme B. */
  let a: LignesDeFerme;
  let a2: LignesDeFerme;
  let b: LignesDeFerme;
  /** Espèces de la série a.serie et de la série a2.serie. */
  let especeSerieA: string;
  /** Espèce et variété de la ferme A, espèce de la ferme B. */
  let especeA: string;
  let varieteA: string;
  let especeB: string;
  /** Article de la ferme A (tomate, kg), et article de la ferme B (kg). */
  let articleA: string;
  let articleB: string;
  /** Récolte (événement) de la ferme A, écrite par Théo. */
  let recolteA: string;
  /** Récolte (événement) de la ferme B, écrite par le voisin. */
  let recolteB: string;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  /** Nouveau membre de la ferme A : ses refus se comptent à part. */
  async function nouveauMembre(): Promise<Membre> {
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, fermeA, { role: 'gerant' });
    return { id: u.id, jeton: await jetonPour(u.id) };
  }

  async function espece(fermeId: string | null, nom: string): Promise<string> {
    const famille = randomUUID();
    await base.pool.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`,
      [famille, fermeId],
    );
    const id = randomUUID();
    await base.pool.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, $4, 'legume', false, 'kg')`,
      [id, fermeId, famille, nom],
    );
    return id;
  }

  async function especeDeLaSerie(serie: string): Promise<string> {
    const r = await base.pool.query<{ espece_id: string }>(`SELECT espece_id::text AS espece_id FROM serie WHERE id = $1`, [serie]);
    return r.rows[0]?.espece_id ?? '';
  }

  async function articleEnBase(fermeId: string, especeId: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO article_stock (id, ferme_id, espece_id, unite) VALUES ($1, $2, $3, 'kg')`, [id, fermeId, especeId]);
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10d_suites');
    cles = { active: await genererCleSignature('cle-t10d'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
    });
    fermeA = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeB = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, fermeA, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, fermeB, { role: 'gerant' });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };

    a = await peuplerFerme(base.pool, fermeA);
    a2 = await peuplerFerme(base.pool, fermeA);
    b = await peuplerFerme(base.pool, fermeB);
    especeSerieA = await especeDeLaSerie(a.serie);
    especeA = await espece(fermeA, 'Tomate');
    especeB = await espece(fermeB, 'Tomate voisine');
    varieteA = randomUUID();
    await base.pool.query(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Cœur de bœuf')`, [varieteA, fermeA, especeA]);
    articleA = await articleEnBase(fermeA, especeA);
    articleB = await articleEnBase(fermeB, especeB);

    const rA = putRecolte(5);
    expect(await lot([rA])).toEqual({ refus: [] });
    recolteA = rA.id;
    const rB = putRecolte(5, {}, voisin.id, fermeB);
    expect(await lot([rB], voisin.jeton)).toEqual({ refus: [] });
    recolteB = rB.id;
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  function envoyer(corps: string, jeton: string = theo.jeton): Promise<Response> {
    return Promise.resolve(
      app.request('/sync/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
        body: corps,
      }),
    );
  }

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<ReponseUpload> {
    const res = await envoyer(JSON.stringify({ ecritures }), jeton);
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
  const refusDeLUtilisateur = (id: string) => compter(`SELECT 1 FROM refus_synchro WHERE utilisateur_id = $1`, [id]);

  /** Lignes écrites parmi `ecritures` (toutes tables), et leurs historiques. */
  async function traces(ecritures: readonly EcritureEnvoyee[]): Promise<number> {
    const ids = ecritures.map((e) => e.id);
    return compter(
      `SELECT id FROM evenement WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id FROM article_stock WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id FROM mouvement_stock WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id FROM modification WHERE ligne_id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async function stock(articleId: string): Promise<number> {
    const r = await base.pool.query<{ s: number }>(
      `SELECT coalesce(sum(quantite), 0)::float8 AS s FROM mouvement_stock WHERE article_stock_id = $1`,
      [articleId],
    );
    return r.rows[0]?.s ?? Number.NaN;
  }

  /** Refus enregistré pour `id` (un seul attendu) : motif et message. */
  async function refusEnregistre(id: string): Promise<{ motif: string; message: string }> {
    const r = await base.pool.query<{ motif: string; message: string }>(`SELECT motif, message FROM refus_synchro WHERE ligne_id = $1`, [id]);
    expect(r.rows, `un refus enregistré pour ${id}`).toHaveLength(1);
    return r.rows[0] ?? { motif: '', message: '' };
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  function putRecolte(quantite = 12, autres: Record<string, unknown> = {}, auteurId = theo.id, fermeId = fermeA): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: fermeId,
        type: 'recolte',
        date: '2026-10-01',
        horodatage: '2026-10-01T05:58:00.000Z',
        auteur_id: auteurId,
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

  /** Annulation ou correction de `origine` : mêmes colonnes, `autres` remplacées. */
  function putRemplacement(
    origine: EcritureEnvoyee,
    sorte: 'annulation' | 'correction',
    detail?: unknown,
    autres: Record<string, unknown> = {},
  ): EcritureEnvoyee {
    return putRecolte(12, {
      ...origine.donnees,
      horodatage: '2026-10-01T05:59:00.000Z',
      remplace_sorte: sorte,
      remplace_evenement_id: origine.id,
      ...(detail === undefined ? {} : { detail: JSON.stringify(detail) }),
      ...autres,
    });
  }

  function putArticle(autres: Record<string, unknown> = {}, fermeId = fermeA): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'article_stock',
      id: nouvelId<'ArticleStock'>(),
      donnees: { ferme_id: fermeId, espece_id: especeA, variete_id: null, unite: 'kg', categorie: null, ...autres },
    };
  }

  function putMouvement(articleId: string, quantite: unknown, recolteId: string | null, fermeId = fermeA): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'mouvement_stock',
      id: nouvelId<'MouvementStock'>(),
      donnees: { ferme_id: fermeId, article_stock_id: articleId, date: '2026-10-01', quantite, motif: 'recolte', recolte_id: recolteId },
    };
  }

  /** Récolte (de la série `serie` si donnée) + article + mouvement acceptés en un lot. */
  async function recolteAcceptee(
    quantite = 12,
    autres: Record<string, unknown> = {},
    especeArticle = especeA,
  ): Promise<{ recolte: EcritureEnvoyee; article: EcritureEnvoyee; mouvement: EcritureEnvoyee }> {
    const recolte = putRecolte(quantite, autres);
    const article = putArticle({ espece_id: especeArticle });
    const mouvement = putMouvement(article.id, quantite, recolte.id);
    expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
    return { recolte, article, mouvement };
  }

  /** Le lot est refusé EN ENTIER : rien d'écrit, chaque écriture a son refus, la fautive son motif. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string): Promise<void> {
    const reponse = await lot(ecritures);
    const siens = reponse.refus.filter((r) => r.id === fautive.id);
    expect(siens.map((r) => r.motif), `refus de la fautive dans ${JSON.stringify(reponse.refus)}`).toEqual([motif]);
    for (const e of ecritures) {
      expect(reponse.refus.some((r) => r.id === e.id && r.table === e.table), `${e.table} ${e.id} figure dans les refus`).toBe(true);
      expect(await ecrites(e), `${e.table} ${e.id} non écrit`).toBe(0);
      expect(await refusDe(e.id), `refus_synchro pour ${e.table} ${e.id}`).toBeGreaterThanOrEqual(1);
    }
  }

  const refusSeul = (e: EcritureEnvoyee, motif: string): ReponseUpload => ({ refus: [{ table: e.table, id: e.id, motif }] });

  // ── 1. Une correction garde la série (ou la campagne) et l'unité de l'origine ───────────────

  describe('1. une correction garde la série, la campagne et l’unité de l’origine', () => {
    const KG_15 = { quantite: 15, unite: 'kg', categorie: null };

    it('même série, même unité, autre quantité et autre catégorie : acceptée', async () => {
      const origine = putRecolte(12, { serie_id: a.serie });
      expect(await lot([origine])).toEqual({ refus: [] });
      const correction = putRemplacement(origine, 'correction', { quantite: 15, unite: 'kg', categorie: 'II' });
      expect(await lot([correction])).toEqual({ refus: [] });
      expect(await ecrites(correction)).toBe(1);
    });

    it.each([
      ['une autre série de la ferme', () => ({ serie_id: a2.serie })],
      ['sans série (serie_id nul)', () => ({ serie_id: null })],
      ['une campagne à la place de la série', () => ({ serie_id: null, campagne_id: a.campagne })],
    ])('origine d’une série, correction vers %s : ecriture_invalide, rien d’écrit, le reste du lot passe', async (_cas, champs) => {
      const origine = putRecolte(12, { serie_id: a.serie });
      expect(await lot([origine])).toEqual({ refus: [] });
      const correction = putRemplacement(origine, 'correction', KG_15, champs());
      const bonne = putRecolte(3);
      expect(await lot([correction, bonne])).toEqual(refusSeul(correction, 'ecriture_invalide'));
      expect(await ecrites(correction)).toBe(0);
      expect(await ecrites(bonne)).toBe(1);
    });

    it.each([
      ['une autre campagne de la ferme', () => ({ campagne_id: a2.campagne })],
      ['sans campagne', () => ({ campagne_id: null })],
      ['une série à la place de la campagne', () => ({ campagne_id: null, serie_id: a.serie })],
    ])('origine d’une campagne, correction vers %s : ecriture_invalide', async (_cas, champs) => {
      const origine = putRecolte(12, { campagne_id: a.campagne });
      expect(await lot([origine])).toEqual({ refus: [] });
      const correction = putRemplacement(origine, 'correction', KG_15, champs());
      expect(await lot([correction])).toEqual(refusSeul(correction, 'ecriture_invalide'));
      expect(await ecrites(correction)).toBe(0);
    });

    it('origine sans série ni campagne, correction rattachée à une série : ecriture_invalide', async () => {
      const origine = putRecolte(12);
      expect(await lot([origine])).toEqual({ refus: [] });
      const correction = putRemplacement(origine, 'correction', KG_15, { serie_id: a.serie });
      expect(await lot([correction])).toEqual(refusSeul(correction, 'ecriture_invalide'));
    });

    it.each(['botte', 'piece', 'barquette'])('origine en kg, correction en %s : ecriture_invalide', async (unite) => {
      const origine = putRecolte(12);
      expect(await lot([origine])).toEqual({ refus: [] });
      const correction = putRemplacement(origine, 'correction', { quantite: 12, unite, categorie: null });
      expect(await lot([correction])).toEqual(refusSeul(correction, 'ecriture_invalide'));
      expect(await ecrites(correction)).toBe(0);
    });

    it('correction d’une correction : comparée à l’origine de la chaîne (autre unité ou autre série refusée, identique acceptée)', async () => {
      const origine = putRecolte(12, { serie_id: a.serie });
      const premiere = putRemplacement(origine, 'correction', KG_15);
      expect(await lot([origine, premiere])).toEqual({ refus: [] });
      const autreUnite = putRemplacement(premiere, 'correction', { quantite: 15, unite: 'botte', categorie: null });
      const autreSerie = putRemplacement(premiere, 'correction', KG_15, { serie_id: a2.serie });
      const juste = putRemplacement(premiere, 'correction', { quantite: 14, unite: 'kg', categorie: null });
      const reponse = await lot([autreUnite, autreSerie, juste]);
      expect(reponse.refus).toEqual([
        { table: 'evenement', id: autreUnite.id, motif: 'ecriture_invalide' },
        { table: 'evenement', id: autreSerie.id, motif: 'ecriture_invalide' },
      ]);
      expect(await ecrites(juste)).toBe(1);
    });

    it('saisie de stock : correction en bottes d’une récolte en kg + mouvement : refusée en entier, la correction est la fautive', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'botte', categorie: null });
      const ecart = putMouvement(article.id, 3, correction.id);
      await refuseEnEntier([correction, ecart], correction, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('saisie de stock : correction vers une autre série + mouvement : refusée en entier, la correction est la fautive', async () => {
      const { recolte, article } = await recolteAcceptee(12, { serie_id: a.serie }, especeSerieA);
      const correction = putRemplacement(recolte, 'correction', KG_15, { serie_id: a2.serie });
      const ecart = putMouvement(article.id, 3, correction.id);
      await refuseEnEntier([correction, ecart], correction, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('saisie de stock : correction qui garde série et unité + mouvement : acceptée', async () => {
      const { recolte, article } = await recolteAcceptee(12, { serie_id: a.serie }, especeSerieA);
      const correction = putRemplacement(recolte, 'correction', KG_15);
      expect(await lot([correction, putMouvement(article.id, 3, correction.id)])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(15);
    });
  });

  // ── 2. Annulation redondante ────────────────────────────────────────────────────────────────

  describe('2. annulation redondante (deux téléphones annulent la même récolte)', () => {
    it('comportement voulu (figé) : la seconde annulation avec −12 est refusée en entier, visible, le stock reste à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      // Téléphone A.
      const annulationA = putRemplacement(recolte, 'annulation');
      expect(await lot([annulationA, putMouvement(article.id, -12, annulationA.id)])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(0);
      // Téléphone B, resté hors ligne, a annulé la même récolte.
      const annulationB = putRemplacement(recolte, 'annulation');
      const inverseB = putMouvement(article.id, -12, annulationB.id);
      await refuseEnEntier([annulationB, inverseB], inverseB, 'ecriture_invalide');
      expect(await refusEnregistre(inverseB.id)).toMatchObject({ motif: 'ecriture_invalide' });
      expect(await stock(article.id)).toBe(0);
    });

    it('comportement voulu (figé) : une annulation redondante sans mouvement est acceptée, le stock reste à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulationA = putRemplacement(recolte, 'annulation');
      expect(await lot([annulationA, putMouvement(article.id, -12, annulationA.id)])).toEqual({ refus: [] });
      const annulationB = putRemplacement(recolte, 'annulation');
      expect(await lot([annulationB])).toEqual({ refus: [] });
      expect(await ecrites(annulationB)).toBe(1);
      expect(await refusDe(annulationB.id)).toBe(0);
      expect(await stock(article.id)).toBe(0);
    });
  });

  // ── 3. Aucun indice de l'existence d'une ligne d'une autre ferme ────────────────────────────

  /**
   * Un cas : le voisin (ferme B) envoie une écriture de SA ferme qui désigne `idVise` ; `table`
   * est la table de la ligne visée (pour la verrouiller). Chaque cas compare la ligne de la
   * ferme A à un identifiant inexistant.
   */
  interface CasReference {
    readonly table: string;
    readonly etrangere: () => string;
    readonly ecriture: (idVise: string) => EcritureEnvoyee;
  }

  const recolteVoisine = (autres: Record<string, unknown>) => putRecolte(1, autres, voisin.id, fermeB);
  const irrigation = (secteur: string) => JSON.stringify({ secteurIrrigationId: secteur, dureeMinutes: 30 });
  const traitement = (produit: string) =>
    JSON.stringify({
      produitPhytoId: produit,
      dose: { valeur: 2, unite: 'L/ha' },
      surfaceTraiteeM2: 100,
      cible: 'mildiou',
      operateur: 'Théo',
      recolteAutoriseeLe: '2026-10-22',
    });

  const CAS: readonly (readonly [string, CasReference])[] = [
    [
      'mouvement : article_stock_id',
      { table: 'article_stock', etrangere: () => articleA, ecriture: (id) => putMouvement(id, 1, recolteB, fermeB) },
    ],
    [
      'mouvement : recolte_id',
      { table: 'evenement', etrangere: () => recolteA, ecriture: (id) => putMouvement(articleB, 1, id, fermeB) },
    ],
    ['article : espece_id', { table: 'espece', etrangere: () => especeA, ecriture: (id) => putArticle({ espece_id: id }, fermeB) }],
    [
      'article : variete_id',
      { table: 'variete', etrangere: () => varieteA, ecriture: (id) => putArticle({ espece_id: especeB, variete_id: id }, fermeB) },
    ],
    ['événement : serie_id', { table: 'serie', etrangere: () => a.serie, ecriture: (id) => recolteVoisine({ serie_id: id }) }],
    ['événement : campagne_id', { table: 'campagne', etrangere: () => a.campagne, ecriture: (id) => recolteVoisine({ campagne_id: id }) }],
    [
      'événement : un des emplacement_ids',
      { table: 'emplacement', etrangere: () => a.emplacement, ecriture: (id) => recolteVoisine({ emplacement_ids: JSON.stringify([b.emplacement, id]) }) },
    ],
    [
      'événement : remplace_evenement_id',
      {
        table: 'evenement',
        etrangere: () => recolteA,
        ecriture: (id) => recolteVoisine({ remplace_sorte: 'correction', remplace_evenement_id: id }),
      },
    ],
    [
      'événement : detail.secteurIrrigationId',
      {
        table: 'secteur_irrigation',
        etrangere: () => a.secteurIrrigation,
        ecriture: (id) => recolteVoisine({ type: 'irrigation', detail: irrigation(id) }),
      },
    ],
    [
      'événement : detail.produitPhytoId',
      { table: 'produit_phyto', etrangere: () => a.produitPhyto, ecriture: (id) => recolteVoisine({ type: 'traitement', detail: traitement(id) }) },
    ],
  ];

  describe('3. une ligne d’une autre ferme se comporte comme une ligne inexistante', () => {
    it.each(CAS)('%s de la ferme A : même motif et même message qu’un id inexistant', async (_cas, c) => {
      const versA = c.ecriture(c.etrangere());
      const versRien = c.ecriture(randomUUID());
      expect(await lot([versA], voisin.jeton)).toEqual(refusSeul(versA, 'ecriture_invalide'));
      expect(await lot([versRien], voisin.jeton)).toEqual(refusSeul(versRien, 'ecriture_invalide'));
      expect(await ecrites(versA)).toBe(0);
      const refusA = await refusEnregistre(versA.id);
      const refusRien = await refusEnregistre(versRien.id);
      expect(refusA, 'même motif et même message dans refus_synchro').toEqual(refusRien);
      expect(refusA.message).not.toMatch(/autre ferme/i);
    });

    it.each(CAS)(
      '%s de la ferme A verrouillée (FOR UPDATE) par une autre connexion : le membre de B a sa réponse sans attendre',
      async (_cas, c) => {
        const idA = c.etrangere();
        const versA = c.ecriture(idA);
        const verrou = await base.pool.connect();
        let requete: Promise<Response> | undefined;
        try {
          await verrou.query('BEGIN');
          const tenue = await verrou.query(`SELECT 1 FROM ${c.table} WHERE id = $1 FOR UPDATE`, [idA]);
          expect(tenue.rowCount, `ligne ${c.table} ${idA} verrouillée`).toBe(1);
          requete = envoyer(JSON.stringify({ ecritures: [versA] }), voisin.jeton);
          const bloquee = Symbol('bloquée');
          const issue = await Promise.race([requete, new Promise<typeof bloquee>((fin) => {
              setTimeout(() => {
                fin(bloquee);
              }, ATTENTE_MAX_MS);
            })]);
          expect(issue === bloquee ? `pas de réponse après ${String(ATTENTE_MAX_MS)} ms : la ligne de la ferme A est verrouillée par la requête du membre de B` : 'répondu').toBe(
            'répondu',
          );
          if (issue !== bloquee) {
            expect(issue.status).toBe(200);
            expect(await issue.json()).toEqual(refusSeul(versA, 'ecriture_invalide'));
          }
        } finally {
          await verrou.query('ROLLBACK');
          verrou.release();
          // Une requête restée bloquée finit une fois le verrou rendu : on l'attend avant le test suivant.
          if (requete !== undefined) await requete;
        }
        expect(await ecrites(versA)).toBe(0);
      },
    );

    it('bibliothèque commune (ferme_id nul) toujours acceptée : article d’une espèce de la bibliothèque', async () => {
      const bibliotheque = await espece(null, 'Courgette');
      const article = putArticle({ espece_id: bibliotheque }, fermeB);
      expect(await lot([article], voisin.jeton)).toEqual({ refus: [] });
    });

    it('inchangé : écriture sous le ferme_id d’une ferme dont l’utilisateur n’est pas membre → ferme_interdite', async () => {
      const m = putMouvement(articleA, 1, recolteA, fermeA);
      expect(await lot([m], voisin.jeton)).toEqual(refusSeul(m, 'ferme_interdite'));
    });
  });

  // ── 4. Lot trop gros : 200 avec des refus ───────────────────────────────────────────────────

  describe('4. lot trop gros : 200, un refus lot_trop_gros par écriture, rien d’écrit, la file avance', () => {
    /** Envoie le lot ; attend 200, un refus 'lot_trop_gros' pour chaque écriture, rien d'écrit, un refus_synchro par écriture. */
    async function refuseTropGros(ecritures: readonly EcritureEnvoyee[], membre: Membre, corps = JSON.stringify({ ecritures })): Promise<void> {
      const res = await envoyer(corps, membre.jeton);
      expect(res.status, 'jamais 400 ni 413 : la file PowerSync se bloquerait').toBe(200);
      const reponse = (await res.json()) as ReponseUpload;
      expect(reponse.refus).toHaveLength(ecritures.length);
      expect(new Set(reponse.refus.map((r) => r.motif))).toEqual(new Set(['lot_trop_gros']));
      expect(new Set(reponse.refus.map((r) => r.id))).toEqual(new Set(ecritures.map((e) => e.id)));
      expect(await traces(ecritures), 'rien d’écrit').toBe(0);
      expect(await refusDeLUtilisateur(membre.id)).toBe(ecritures.length);
      // La file avance : le lot suivant, normal, passe.
      const suivante = putRecolte(2, {}, membre.id);
      expect(await lot([suivante], membre.jeton)).toEqual({ refus: [] });
      expect(await ecrites(suivante)).toBe(1);
    }

    it(`événements seuls : ${String(ECRITURES_MAX_PAR_LOT + 1)} écritures`, async () => {
      const u = await nouveauMembre();
      await refuseTropGros(
        Array.from({ length: ECRITURES_MAX_PAR_LOT + 1 }, () => putRecolte(1, {}, u.id)),
        u,
      );
    });

    it(`saisie de stock : ${String(ECRITURES_MAX_PAR_LOT + 1)} écritures dont un article et un mouvement`, async () => {
      const u = await nouveauMembre();
      const recolte = putRecolte(1, {}, u.id);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 1, recolte.id);
      const autres = Array.from({ length: ECRITURES_MAX_PAR_LOT - 2 }, () => putRecolte(1, {}, u.id));
      await refuseTropGros([recolte, article, mouvement, ...autres], u);
      expect(await stock(article.id)).toBe(0);
    });

    it(`corps de plus de ${String(TAILLE_MAX_CORPS)} octets fait d’écritures valides une à une : refusé, pas de 413`, async () => {
      const u = await nouveauMembre();
      // Écriture valide au maximum de ses limites (note de 4 000 caractères, 20 photos de 2 000).
      const lourde = () => putRecolte(1, { note: 'n'.repeat(4_000), photos: JSON.stringify(Array.from({ length: 20 }, () => 'p'.repeat(2_000))) }, u.id);
      const taille = JSON.stringify(lourde()).length;
      const n = Math.ceil(TAILLE_MAX_CORPS / taille) + 1;
      expect(n, 'le lot reste sous la limite du nombre d’écritures').toBeLessThanOrEqual(ECRITURES_MAX_PAR_LOT);
      const ecritures = Array.from({ length: n }, lourde);
      const corps = JSON.stringify({ ecritures });
      expect(new TextEncoder().encode(corps).length).toBeGreaterThan(TAILLE_MAX_CORPS);
      await refuseTropGros(ecritures, u, corps);
    });

    it(`à la limite : ${String(ECRITURES_MAX_PAR_LOT)} événements acceptés en entier`, async () => {
      const u = await nouveauMembre();
      const ecritures = Array.from({ length: ECRITURES_MAX_PAR_LOT }, () => putRecolte(1, {}, u.id));
      expect(await lot(ecritures, u.jeton)).toEqual({ refus: [] });
      expect(await compter(`SELECT 1 FROM evenement WHERE id = ANY($1::uuid[])`, [ecritures.map((e) => e.id)])).toBe(ECRITURES_MAX_PAR_LOT);
    });

    it(`à la limite : saisie de stock de ${String(ECRITURES_MAX_PAR_LOT)} écritures acceptée en entier`, async () => {
      const u = await nouveauMembre();
      const recolte = putRecolte(4, {}, u.id);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 4, recolte.id);
      const autres = Array.from({ length: ECRITURES_MAX_PAR_LOT - 3 }, () => putRecolte(1, {}, u.id));
      expect(await lot([recolte, article, mouvement, ...autres], u.jeton)).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(4);
    });
  });

  describe('4 bis. limite dure du corps : 413 sans tout lire', () => {
    it('TAILLE_MAX_CORPS_DURE est exportée par upload.ts et vaut 32 Mio', () => {
      expect((upload as unknown as Record<string, unknown>).TAILLE_MAX_CORPS_DURE).toBe(TAILLE_MAX_CORPS_DURE);
    });

    it('Content-Length déclaré au-delà de 32 Mio : 413 tout de suite, rien d’écrit, aucun refus', async () => {
      const u = await nouveauMembre();
      const e = putRecolte(1, {}, u.id);
      const res = await Promise.resolve(
        app.request('/sync/upload', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${u.jeton}`,
            'content-length': String(TAILLE_MAX_CORPS_DURE + 1),
          },
          body: JSON.stringify({ ecritures: [e] }),
        }),
      );
      expect(res.status).toBe(413);
      expect(await ecrites(e)).toBe(0);
      expect(await refusDeLUtilisateur(u.id)).toBe(0);
    });

    it('flux sans Content-Length de 64 Mio : 413, et le serveur cesse de lire après 32 Mio', async () => {
      const u = await nouveauMembre();
      const morceau = new Uint8Array(1_048_576).fill(0x20);
      let lus = 0;
      const flux = new ReadableStream<Uint8Array>({
        pull(controleur) {
          if (lus >= 64 * 1_048_576) {
            controleur.close();
            return;
          }
          lus += morceau.length;
          controleur.enqueue(morceau);
        },
      });
      const requete = new Request('http://localhost/sync/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u.jeton}` },
        body: flux,
        duplex: 'half',
      });
      expect(requete.headers.has('content-length')).toBe(false);
      const res = await Promise.resolve(app.request(requete));
      expect(res.status).toBe(413);
      expect(lus, 'octets tirés du flux').toBeLessThanOrEqual(TAILLE_MAX_CORPS_DURE + 2 * 1_048_576);
      expect(await refusDeLUtilisateur(u.id)).toBe(0);
    });
  });

  // ── 6. PATCH et DELETE sur une ligne d'une autre ferme ───────────────────────────────────────

  describe('6. PATCH ou DELETE sur une ligne d’une autre ferme : comme sur un id inexistant', () => {
    /** Mouvement de la ferme A. */
    let mouvementA: string;

    beforeAll(async () => {
      mouvementA = (await recolteAcceptee(7)).mouvement.id;
    });

    async function refusDeVoisin(id: string, operation: string): Promise<{ motif: string; message: string; ferme_id: string | null }[]> {
      const r = await base.pool.query<{ motif: string; message: string; ferme_id: string | null }>(
        `SELECT motif, message, ferme_id FROM refus_synchro WHERE ligne_id = $1 AND operation = $2 AND utilisateur_id = $3`,
        [id, operation, voisin.id],
      );
      return r.rows;
    }

    async function empreinte(table: string, id: string): Promise<unknown> {
      const r = await base.pool.query(`SELECT to_jsonb(l) AS l FROM ${TABLE_DE[table] ?? 'evenement'} l WHERE id = $1`, [id]);
      return r.rows[0];
    }

    const LIGNES: readonly (readonly [string, () => string, Record<string, unknown>])[] = [
      ['evenement', () => recolteA, { note: 'piratée' }],
      ['article_stock', () => articleA, { categorie: 'extra' }],
      ['mouvement_stock', () => mouvementA, { quantite: 1000 }],
    ];
    const CAS_MODIF = LIGNES.flatMap(([table, id, donnees]) =>
      (['PATCH', 'DELETE'] as const).map((op) => [`${op} ${table}`, table, op, id, donnees] as const),
    );

    it.each(CAS_MODIF)('%s : même motif et même message qu’un id inexistant, ferme_id nul, la ligne ne change pas', async (_cas, table, op, id, donnees) => {
      const idA = id();
      const avant = await empreinte(table, idA);
      expect(avant, 'la ligne de la ferme A existe').toBeDefined();
      const inexistant = randomUUID();
      const ecriture = (cible: string): EcritureEnvoyee => (op === 'PATCH' ? { op, table, id: cible, donnees } : { op, table, id: cible });
      const versA = await lot([ecriture(idA)], voisin.jeton);
      const versRien = await lot([ecriture(inexistant)], voisin.jeton);
      expect(versA.refus).toHaveLength(1);
      expect(versRien.refus).toHaveLength(1);
      expect(versA.refus[0]?.motif, 'même motif').toBe(versRien.refus[0]?.motif);
      expect(versA.refus[0]?.motif).not.toBe('ferme_interdite');
      const refusA = await refusDeVoisin(idA, op);
      const refusRien = await refusDeVoisin(inexistant, op);
      expect(refusA).toHaveLength(1);
      expect(refusA, 'même motif, même message, ferme_id nul').toEqual(refusRien);
      expect(refusA[0]?.ferme_id).toBeNull();
      expect(await empreinte(table, idA)).toEqual(avant);
    });

    it.each([
      ['evenement', () => putRecolte(1, {}, voisin.id, fermeA)],
      ['article_stock', () => putArticle({}, fermeA)],
      ['mouvement_stock', () => putMouvement(articleA, 1, recolteA, fermeA)],
    ])('inchangé : PUT %s dont le ferme_id déclaré est la ferme A → ferme_interdite', async (_table, fabriquer) => {
      const e = fabriquer();
      expect(await lot([e], voisin.jeton)).toEqual(refusSeul(e, 'ferme_interdite'));
      expect(await ecrites(e)).toBe(0);
    });
  });

  // ── 5. Échelle numeric(12,6) ────────────────────────────────────────────────────────────────

  describe('5. mouvement_stock.quantite en numeric(12,6)', () => {
    it('information_schema : numeric, précision 12, échelle 6', async () => {
      const r = await base.pool.query<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>(
        `SELECT data_type::text AS data_type, numeric_precision::int AS numeric_precision, numeric_scale::int AS numeric_scale
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mouvement_stock' AND column_name = 'quantite'`,
      );
      expect(r.rows).toEqual([{ data_type: 'numeric', numeric_precision: 12, numeric_scale: 6 }]);
    });

    it('une migration de packages/db postérieure à 0011 fixe l’échelle de mouvement_stock.quantite', () => {
      const fichiers = readdirSync(DOSSIER_MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f));
      const numero = (f: string) => Number(f.slice(0, 4));
      const derniere = Math.max(...fichiers.map(numero));
      expect(derniere, 'une migration après 0011').toBeGreaterThan(11);
      const fixe = fichiers.filter((f) => {
        const texte = readFileSync(new URL(f, DOSSIER_MIGRATIONS), 'utf8');
        return numero(f) > 11 && texte.includes('mouvement_stock') && /numeric\s*\(\s*12\s*,\s*6\s*\)/i.test(texte);
      });
      expect(fixe, 'migration qui passe mouvement_stock.quantite en numeric(12,6)').toHaveLength(1);
      const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER_MIGRATIONS), 'utf8')) as { entries: { tag: string }[] };
      expect(journal.entries.map((e) => `${e.tag}.sql`)).toContain(fixe[0]);
    });

    it('une quantité à 6 décimales est conservée exactement (figé : déjà vrai en numeric sans échelle)', async () => {
      const recolte = putRecolte(12.345678);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 12.345678, recolte.id);
      expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
      const r = await base.pool.query<{ exacte: boolean }>(
        `SELECT quantite = '12.345678'::numeric AS exacte FROM mouvement_stock WHERE id = $1`,
        [mouvement.id],
      );
      expect(r.rows).toEqual([{ exacte: true }]);
      const annulation = putRemplacement(recolte, 'annulation');
      expect(await lot([annulation, putMouvement(article.id, -12.345678, annulation.id)])).toEqual({ refus: [] });
      const somme = await base.pool.query<{ s: string }>(`SELECT sum(quantite)::text AS s FROM mouvement_stock WHERE article_stock_id = $1`, [article.id]);
      expect(Number(somme.rows[0]?.s)).toBe(0);
    });
  });
});
