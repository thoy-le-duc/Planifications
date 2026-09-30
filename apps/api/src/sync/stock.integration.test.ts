/**
 * Tests d'acceptation T10c — POST /sync/upload accepte le stock des téléphones, contre un vrai
 * Postgres (même amorçage que upload.integration.test.ts : DATABASE_URL, base jetable
 * `t10c_stock_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Une récolte saisie au champ (T13) part du téléphone en UNE transaction PowerSync, donc en UN
 * appel POST /sync/upload : l'événement de récolte, l'article de stock s'il n'existait pas, et le
 * mouvement de stock (+quantité, motif 'recolte', recolte_id = l'événement). Son annulation part
 * de même : l'événement d'annulation et le mouvement inverse. Le stock n'est jamais un compteur :
 * c'est la somme des mouvements (docs/modele-donnees.md, § 6).
 *
 * ── Contrat (en plus de celui de T10, en-tête de upload.integration.test.ts) ────────────────
 *
 * Tables écrites par le téléphone : `evenement` (T10), `article_stock` et `mouvement_stock`.
 * Colonnes reçues (noms Postgres, valeurs telles que SQLite les stocke) :
 *   article_stock    ferme_id, espece_id, variete_id, unite, categorie
 *                    (+ cree_le, modifie_le tolérées, remplies par le serveur ; supprime_le
 *                    tolérée si nulle). Toute autre colonne, dont `id` → 'ecriture_invalide'.
 *   mouvement_stock  ferme_id, article_stock_id, date, quantite, motif, recolte_id
 *                    (+ cree_le tolérée, remplie par le serveur). Toute autre colonne, dont `id`
 *                    → 'ecriture_invalide'.
 *
 * Règles de `mouvement_stock` (ajout seul) :
 *   - PATCH ou DELETE → 'ajout_seul' (ferme de la ligne existante d'un autre : 'ferme_interdite',
 *     ferme_id nul dans le refus, comme M1). La ligne ne change pas.
 *   - PUT identique à la ligne existante (renvoi) : accepté, rien d'écrit en plus (ni ligne, ni
 *     historique). Même id, autres valeurs → 'ajout_seul', la ligne ne change pas.
 *   - `ferme_id` d'une ferme dont l'utilisateur n'est pas membre actif → 'ferme_interdite'.
 *   - `article_stock_id` : article de la MÊME ferme (écrit avant, ou plus haut dans le même lot),
 *     non supprimé. D'une autre ferme → 'ferme_interdite' ; introuvable ou supprimé →
 *     'ecriture_invalide'.
 *   - `quantite` : un nombre (pas un texte), fini, non nul, |quantite| ≤
 *     PLAFONDS_PROVISOIRES.recolteQuantite (100 000, borne comprise ; Q13) → sinon
 *     'ecriture_invalide'.
 *   - `date` : 'AAAA-MM-JJ' existante dans [2000-01-01, 2100-12-31] (comme un événement).
 *   - `motif` ∈ recolte | vente | perte | ajustement ; motif = 'recolte' ⇔ recolte_id non nul
 *     → sinon 'ecriture_invalide'.
 *   - `recolte_id` : événement de type 'recolte' (une récolte, ou son annulation ou sa correction,
 *     qui sont du même type) de la MÊME ferme, écrit avant ou plus haut dans le même lot.
 *     D'une autre ferme → 'ferme_interdite' ; introuvable ou d'un autre type → 'ecriture_invalide'.
 *   - Motif 'recolte' et quantite < 0 : accepté seulement si recolte_id désigne une ANNULATION ou
 *     une CORRECTION (remplace_sorte non nul). Rattaché à la récolte d'origine → 'ecriture_invalide'.
 *     (Interprétation retenue avec T13 : le mouvement inverse pointe vers l'événement d'annulation.)
 *
 * Règles de `article_stock` (création seule) :
 *   - PUT : espèce visible par la ferme (de la ferme, ou de la bibliothèque : ferme_id nul), non
 *     supprimée ; variété (facultative) visible de même ; unite ∈ kg | botte | piece | barquette.
 *     Espèce ou variété d'une autre ferme → 'ferme_interdite' ; introuvable ou supprimée, unité
 *     invalide → 'ecriture_invalide'.
 *   - PUT identique (renvoi) : accepté sans rien écrire de plus. Même id, autres valeurs, PATCH,
 *     DELETE → refusés ('ajout_seul' ou 'table_interdite' : au choix du développeur, le message
 *     doit dire que la donnée ne se modifie pas depuis le téléphone). La ligne ne change pas.
 *
 * Historique : chaque ligne créée a sa ligne `modification` dans la même transaction, comme un
 *   événement (T10) : nom_table 'ArticleStock' ou 'MouvementStock' (noms d'entité de T01),
 *   operation 'creation', auteur = utilisateur du jeton, avant NULL, apres = la ligne écrite.
 *
 * Une saisie = une transaction (INTERPRÉTATION, à confirmer par le chef) : un lot (= une
 *   transaction PowerSync) qui contient AU MOINS UNE écriture sur article_stock ou mouvement_stock
 *   est accepté ou refusé EN ENTIER. Si une écriture du lot est refusée, RIEN n'est écrit (ni
 *   l'événement, ni l'article, ni les mouvements, ni leur historique) ; la réponse `refus` et la
 *   table `refus_synchro` contiennent l'écriture fautive avec SON motif, ET chacune des autres
 *   écritures du lot (motif libre) : rien ne disparaît du téléphone en silence. Un lot sans
 *   écriture de stock garde la règle de T10 (chaque écriture à part) : les tests de T10 ne
 *   changent pas.
 */
import { creerGenerateurId, PLAFONDS_PROVISOIRES } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const PLAFOND = PLAFONDS_PROVISOIRES.recolteQuantite;

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

/** Motifs acceptés pour une modification ou un effacement d'article (voir l'en-tête). */
const MOTIFS_ARTICLE_FIGE = ['ajout_seul', 'table_interdite'];

decrireAvecBase('T10c')('T10c : POST /sync/upload accepte le stock des téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Membre actif (gérant) de la ferme principale. */
  let theo: { id: string; jeton: string };
  /** Membre actif de la ferme voisine seulement. */
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;
  /** Espèces : de la ferme, de la bibliothèque (ferme_id nul), de la ferme voisine, supprimée. */
  let tomate: string;
  let courgetteBibliotheque: string;
  let especeVoisine: string;
  let especeSupprimee: string;
  /** Variétés : de la tomate de la ferme, et d'une espèce de la ferme voisine. */
  let coeurDeBoeuf: string;
  let varieteVoisine: string;
  /** Article de stock de la ferme voisine, et article supprimé de la ferme. */
  let articleVoisin: string;
  let articleSupprime: string;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function famille(fermeId: string | null): Promise<string> {
    const id = randomUUID();
    await base.pool.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`,
      [id, fermeId],
    );
    return id;
  }

  async function espece(fermeId: string | null, nom: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await base.pool.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, supprime_le)
       VALUES ($1, $2, $3, $4, 'legume', false, 'kg', $5)`,
      [id, fermeId, await famille(fermeId), nom, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  async function variete(fermeId: string | null, especeId: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Cœur de bœuf')`, [
      id,
      fermeId,
      especeId,
    ]);
    return id;
  }

  /** Article écrit directement en base (pas par le téléphone). */
  async function articleEnBase(fermeId: string, especeId: string, supprime = false): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO article_stock (id, ferme_id, espece_id, unite, supprime_le) VALUES ($1, $2, $3, 'kg', $4)`, [
      id,
      fermeId,
      especeId,
      supprime ? MAINTENANT : null,
    ]);
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10c_stock');
    cles = { active: await genererCleSignature('cle-t10c'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
    });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };

    tomate = await espece(ferme, 'Tomate');
    courgetteBibliotheque = await espece(null, 'Courgette');
    especeVoisine = await espece(autreFerme, 'Tomate voisine');
    especeSupprimee = await espece(ferme, 'Poivron', true);
    coeurDeBoeuf = await variete(ferme, tomate);
    varieteVoisine = await variete(autreFerme, especeVoisine);
    articleVoisin = await articleEnBase(autreFerme, especeVoisine);
    articleSupprime = await articleEnBase(ferme, tomate, true);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Corps brut : pour un nombre que JSON.stringify ne sait pas écrire (1e999 → Infinity). */
  async function lotBrut(corps: string): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${theo.jeton}` },
      body: corps,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const evenements = (id: string) => compter(`SELECT 1 FROM evenement WHERE id = $1`, [id]);
  const articles = (id: string) => compter(`SELECT 1 FROM article_stock WHERE id = $1`, [id]);
  const mouvements = (id: string) => compter(`SELECT 1 FROM mouvement_stock WHERE id = $1`, [id]);
  const modifications = (id: string) => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);
  const refusDe = (id: string) => compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = $1`, [id]);

  async function stock(articleId: string): Promise<number> {
    const r = await base.pool.query<{ s: number }>(
      `SELECT coalesce(sum(quantite), 0)::float8 AS s FROM mouvement_stock WHERE article_stock_id = $1`,
      [articleId],
    );
    return r.rows[0]?.s ?? Number.NaN;
  }

  /** Refus reçu pour `id` (un seul attendu). */
  function motifDe(reponse: ReponseUpload, id: string): string | undefined {
    const trouves = reponse.refus.filter((r) => r.id === id);
    expect(trouves, `un refus pour ${id} dans ${JSON.stringify(reponse.refus)}`).toHaveLength(1);
    return trouves[0]?.motif;
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  /** Récolte (événement) de `quantite` kg ; `autres` : colonnes remplacées. */
  function putRecolte(quantite = 12, autres: Record<string, unknown> = {}, auteurId = theo.id, fermeId = ferme): EcritureEnvoyee {
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

  /** Annulation (ou correction) d'une récolte : même type, même détail. */
  function putRemplacement(origine: EcritureEnvoyee, sorte: 'annulation' | 'correction' = 'annulation', detail?: unknown): EcritureEnvoyee {
    return putRecolte(12, {
      ...origine.donnees,
      horodatage: '2026-10-01T05:59:00.000Z',
      remplace_sorte: sorte,
      remplace_evenement_id: origine.id,
      ...(detail === undefined ? {} : { detail: JSON.stringify(detail) }),
    });
  }

  function putArticle(autres: Record<string, unknown> = {}, fermeId = ferme): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'article_stock',
      id: nouvelId<'ArticleStock'>(),
      donnees: { ferme_id: fermeId, espece_id: tomate, variete_id: null, unite: 'kg', categorie: null, ...autres },
    };
  }

  function putMouvement(articleId: string, quantite: unknown, recolteId: string | null, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'mouvement_stock',
      id: nouvelId<'MouvementStock'>(),
      donnees: {
        ferme_id: ferme,
        article_stock_id: articleId,
        date: '2026-10-01',
        quantite,
        motif: recolteId === null ? 'ajustement' : 'recolte',
        recolte_id: recolteId,
        ...autres,
      },
    };
  }

  /** Une récolte de `quantite` kg acceptée avec son article et son mouvement ; rend les trois. */
  async function recolteAcceptee(quantite = 12): Promise<{ recolte: EcritureEnvoyee; article: EcritureEnvoyee; mouvement: EcritureEnvoyee }> {
    const recolte = putRecolte(quantite);
    const article = putArticle();
    const mouvement = putMouvement(article.id, quantite, recolte.id);
    expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
    return { recolte, article, mouvement };
  }

  /** Le lot est refusé EN ENTIER : rien d'écrit, chaque écriture a son refus, la fautive son motif. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string): Promise<void> {
    const reponse = await lot(ecritures);
    expect(motifDe(reponse, fautive.id)).toBe(motif);
    for (const e of ecritures) {
      expect(
        reponse.refus.some((r) => r.id === e.id && r.table === e.table),
        `${e.table} ${e.id} figure dans les refus`,
      ).toBe(true);
      const compte = e.table === 'evenement' ? evenements : e.table === 'article_stock' ? articles : mouvements;
      if (e.op === 'PUT') expect(await compte(e.id), `${e.table} ${e.id} non écrit`).toBe(0);
      expect(await refusDe(e.id), `refus_synchro pour ${e.table} ${e.id}`).toBeGreaterThanOrEqual(1);
    }
  }

  // ── Une saisie complète ─────────────────────────────────────────────────────────────────────

  describe('récolte et annulation, chacune en une transaction', () => {
    it('événement + article + mouvement +12 : tout est écrit, avec l’historique de chaque ligne', async () => {
      const { recolte, article, mouvement } = await recolteAcceptee(12);
      expect(await evenements(recolte.id)).toBe(1);
      expect(await articles(article.id)).toBe(1);
      expect(await mouvements(mouvement.id)).toBe(1);
      expect(await stock(article.id)).toBe(12);

      const a = await base.pool.query<Record<string, unknown>>(`SELECT * FROM article_stock WHERE id = $1`, [article.id]);
      expect(a.rows[0]).toMatchObject({ ferme_id: ferme, espece_id: tomate, variete_id: null, unite: 'kg', categorie: null, supprime_le: null });
      const m = await base.pool.query<Record<string, unknown>>(
        `SELECT ferme_id, article_stock_id, date::text AS date, quantite::float8 AS quantite, motif, recolte_id FROM mouvement_stock WHERE id = $1`,
        [mouvement.id],
      );
      expect(m.rows).toEqual([
        { ferme_id: ferme, article_stock_id: article.id, date: '2026-10-01', quantite: 12, motif: 'recolte', recolte_id: recolte.id },
      ]);

      for (const [ligne, nomTable] of [
        [article, 'ArticleStock'],
        [mouvement, 'MouvementStock'],
      ] as const) {
        const modifs = await base.pool.query<Record<string, unknown>>(`SELECT * FROM modification WHERE ligne_id = $1`, [ligne.id]);
        expect(modifs.rows, `historique de ${nomTable}`).toHaveLength(1);
        expect(modifs.rows[0]).toMatchObject({
          ferme_id: ferme,
          nom_table: nomTable,
          ligne_id: ligne.id,
          auteur_id: theo.id,
          operation: 'creation',
          avant: null,
          proposition_id: null,
        });
        expect(modifs.rows[0]?.apres).toMatchObject({ id: ligne.id });
      }
      for (const e of [recolte, article, mouvement]) expect(await refusDe(e.id)).toBe(0);
    });

    it('annulation + mouvement −12 rattaché à l’annulation : accepté, le stock revient à 0', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = putRemplacement(recolte, 'annulation');
      const inverse = putMouvement(article.id, -12, annulation.id);
      expect(await lot([annulation, inverse])).toEqual({ refus: [] });
      expect(await evenements(annulation.id)).toBe(1);
      expect(await mouvements(inverse.id)).toBe(1);
      expect(await stock(article.id)).toBe(0);
    });

    it('correction + mouvement négatif rattaché à la correction : accepté', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', { quantite: 10, unite: 'kg', categorie: null });
      const ecart = putMouvement(article.id, -2, correction.id);
      expect(await lot([correction, ecart])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(10);
    });

    it('le même lot renvoyé (réponse perdue) : accepté, rien en double, un seul historique par ligne', async () => {
      const recolte = putRecolte(7);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 7, recolte.id);
      expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
      expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
      for (const e of [recolte, article, mouvement]) {
        expect(await modifications(e.id)).toBe(1);
        expect(await refusDe(e.id)).toBe(0);
      }
      expect(await mouvements(mouvement.id)).toBe(1);
      expect(await stock(article.id)).toBe(7);
    });

    it('cree_le et modifie_le envoyés par le téléphone : tolérés, et le renvoi identique reste accepté', async () => {
      const recolte = putRecolte(4);
      const article = putArticle({ cree_le: '2026-10-01T05:58:00.000Z', modifie_le: '2026-10-01T05:58:00.000Z', supprime_le: null });
      const mouvement = putMouvement(article.id, 4, recolte.id, { cree_le: '2026-10-01T05:58:00.000Z' });
      expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
      expect(await lot([recolte, article, mouvement])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(4);
    });

    it('mouvement vers un article déjà en base, dans un lot à part : accepté', async () => {
      const { article } = await recolteAcceptee(5);
      const recolte = putRecolte(3);
      expect(await lot([recolte])).toEqual({ refus: [] });
      const mouvement = putMouvement(article.id, 3, recolte.id);
      expect(await lot([mouvement])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(8);
    });
  });

  // ── Une saisie = une transaction ────────────────────────────────────────────────────────────

  describe('transaction à moitié invalide : rien d’écrit', () => {
    it('mouvement invalide (quantité nulle) : ni l’événement, ni l’article, ni le mouvement ; chaque écriture a son refus', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 0, recolte.id);
      await refuseEnEntier([recolte, article, mouvement], mouvement, 'ecriture_invalide');
      expect(await modifications(recolte.id)).toBe(0);
      expect(await modifications(article.id)).toBe(0);
    });

    it('événement invalide (quantité négative dans le détail) : l’article et le mouvement ne sont pas écrits ; la saisie corrigée passe ensuite', async () => {
      const invalide = putRecolte(-12);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 12, invalide.id);
      await refuseEnEntier([invalide, article, mouvement], invalide, 'ecriture_invalide');

      // La même saisie, événement corrigé (nouvel id) : l'article et le mouvement, jamais écrits, passent.
      const recolte = putRecolte(12);
      const mouvementCorrige: EcritureEnvoyee = { ...mouvement, donnees: { ...mouvement.donnees, recolte_id: recolte.id } };
      expect(await lot([recolte, article, mouvementCorrige])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(12);
    });

    it('article invalide (espèce d’une autre ferme) : l’événement et le mouvement ne sont pas écrits', async () => {
      const recolte = putRecolte(12);
      const article = putArticle({ espece_id: especeVoisine });
      const mouvement = putMouvement(article.id, 12, recolte.id);
      await refuseEnEntier([recolte, article, mouvement], article, 'ferme_interdite');
    });

    it('annulation valide mais mouvement inverse rattaché à la récolte d’origine : l’annulation n’est pas écrite', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = putRemplacement(recolte);
      const inverse = putMouvement(article.id, -12, recolte.id);
      await refuseEnEntier([annulation, inverse], inverse, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('le lot refusé, renvoyé : toujours refusé, sans refus en double', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      const mouvement = putMouvement(article.id, 0, recolte.id);
      await lot([recolte, article, mouvement]);
      const avant = await compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = ANY($1::text[])`, [[recolte.id, article.id, mouvement.id]]);
      const reponse = await lot([recolte, article, mouvement]);
      expect(motifDe(reponse, mouvement.id)).toBe('ecriture_invalide');
      expect(await compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = ANY($1::text[])`, [[recolte.id, article.id, mouvement.id]])).toBe(
        avant,
      );
      expect(await evenements(recolte.id)).toBe(0);
    });

    it('le lot suivant, valide, passe : un refus ne bloque pas la file', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      await lot([recolte, article, putMouvement(article.id, 0, recolte.id)]);
      const { mouvement } = await recolteAcceptee(2);
      expect(await mouvements(mouvement.id)).toBe(1);
    });
  });

  // ── mouvement_stock : ajout seul ────────────────────────────────────────────────────────────

  describe('mouvement_stock en ajout seul', () => {
    it('PATCH et DELETE d’un mouvement : refus ajout_seul, la ligne ne change pas', async () => {
      const { article, mouvement } = await recolteAcceptee(12);
      const patch: EcritureEnvoyee = { op: 'PATCH', table: 'mouvement_stock', id: mouvement.id, donnees: { quantite: 1000 } };
      const suppression: EcritureEnvoyee = { op: 'DELETE', table: 'mouvement_stock', id: mouvement.id };
      expect((await lot([patch])).refus).toEqual([{ table: 'mouvement_stock', id: mouvement.id, motif: 'ajout_seul' }]);
      expect((await lot([suppression])).refus).toEqual([{ table: 'mouvement_stock', id: mouvement.id, motif: 'ajout_seul' }]);
      expect(await mouvements(mouvement.id)).toBe(1);
      expect(await stock(article.id)).toBe(12);
      expect(await modifications(mouvement.id)).toBe(1);
      const refus = await base.pool.query<{ operation: string; motif: string; ferme_id: string }>(
        `SELECT operation, motif, ferme_id FROM refus_synchro WHERE ligne_id = $1 ORDER BY operation`,
        [mouvement.id],
      );
      expect(refus.rows).toEqual([
        { operation: 'DELETE', motif: 'ajout_seul', ferme_id: ferme },
        { operation: 'PATCH', motif: 'ajout_seul', ferme_id: ferme },
      ]);
    });

    it('DELETE par un membre d’une autre ferme : ferme_interdite, ferme_id nul dans le refus', async () => {
      const { mouvement } = await recolteAcceptee(12);
      const suppression: EcritureEnvoyee = { op: 'DELETE', table: 'mouvement_stock', id: mouvement.id };
      expect((await lot([suppression], voisin.jeton)).refus).toEqual([{ table: 'mouvement_stock', id: mouvement.id, motif: 'ferme_interdite' }]);
      expect(await mouvements(mouvement.id)).toBe(1);
      const refus = await base.pool.query<{ ferme_id: string | null }>(`SELECT ferme_id FROM refus_synchro WHERE ligne_id = $1`, [mouvement.id]);
      expect(refus.rows).toEqual([{ ferme_id: null }]);
    });

    it('renvoi identique d’un mouvement seul : accepté, une seule ligne, un seul historique', async () => {
      const { article, mouvement } = await recolteAcceptee(12);
      expect(await lot([mouvement])).toEqual({ refus: [] });
      expect(await mouvements(mouvement.id)).toBe(1);
      expect(await modifications(mouvement.id)).toBe(1);
      expect(await stock(article.id)).toBe(12);
    });

    it('même id, autre quantité : refus ajout_seul, la ligne garde sa valeur', async () => {
      const { article, mouvement } = await recolteAcceptee(12);
      const reecrit: EcritureEnvoyee = { ...mouvement, donnees: { ...mouvement.donnees, quantite: 120 } };
      expect((await lot([reecrit])).refus).toEqual([{ table: 'mouvement_stock', id: mouvement.id, motif: 'ajout_seul' }]);
      expect(await stock(article.id)).toBe(12);
    });
  });

  // ── mouvement_stock : ferme ─────────────────────────────────────────────────────────────────

  describe('mouvement_stock : ferme de l’écriture et de ses références', () => {
    it('mouvement pour une ferme dont l’utilisateur n’est pas membre : ferme_interdite, rien d’écrit', async () => {
      const m = putMouvement(articleVoisin, 5, null, { ferme_id: autreFerme, motif: 'perte' });
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ferme_interdite' }]);
      expect(await mouvements(m.id)).toBe(0);
      expect(await stock(articleVoisin)).toBe(0);
    });

    it('article d’une autre ferme, sous le ferme_id de la sienne : ferme_interdite', async () => {
      const m = putMouvement(articleVoisin, -5, null, { motif: 'perte' });
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ferme_interdite' }]);
      expect(await mouvements(m.id)).toBe(0);
    });

    it('article introuvable ou supprimé : ecriture_invalide', async () => {
      for (const articleId of [randomUUID(), articleSupprime]) {
        const m = putMouvement(articleId, 5, null);
        expect((await lot([m])).refus, articleId).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
        expect(await mouvements(m.id)).toBe(0);
      }
    });

    it('recolte_id d’une récolte d’une autre ferme : ferme_interdite', async () => {
      const recolteVoisine = putRecolte(3, {}, voisin.id, autreFerme);
      expect(await lot([recolteVoisine], voisin.jeton)).toEqual({ refus: [] });
      const { article } = await recolteAcceptee(1);
      const m = putMouvement(article.id, 3, recolteVoisine.id);
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ferme_interdite' }]);
      expect(await mouvements(m.id)).toBe(0);
    });

    it('recolte_id d’un événement qui n’est pas une récolte, ou introuvable : ecriture_invalide', async () => {
      const { article } = await recolteAcceptee(1);
      const observation = putRecolte(1, { type: 'observation', detail: JSON.stringify({ nature: 'ravageur', gravite: null }) });
      expect(await lot([observation])).toEqual({ refus: [] });
      for (const recolteId of [observation.id, randomUUID()]) {
        const m = putMouvement(article.id, 3, recolteId);
        expect((await lot([m])).refus, recolteId).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
        expect(await mouvements(m.id)).toBe(0);
      }
    });
  });

  // ── mouvement_stock : valeurs ───────────────────────────────────────────────────────────────

  describe('mouvement_stock : quantité, motif et récolte liée', () => {
    let article: string;
    let recolte: string;

    beforeAll(async () => {
      const r = await recolteAcceptee(1);
      article = r.article.id;
      recolte = r.recolte.id;
    });

    async function refuse(m: EcritureEnvoyee): Promise<void> {
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
      expect(await mouvements(m.id)).toBe(0);
    }

    it.each([
      ['nulle', 0],
      ['texte', '12'],
      ['absente (null)', null],
      ['au-delà du plafond', PLAFOND + 1],
      ['en deçà du plafond négatif', -(PLAFOND + 1)],
      ['NaN (texte)', 'NaN'],
    ])('quantité %s : ecriture_invalide', async (_cas, quantite) => {
      await refuse(putMouvement(article, quantite, null));
    });

    it('quantité non finie (1e999 dans le JSON reçu, lue Infinity) : ecriture_invalide, jamais 5xx', async () => {
      for (const q of ['1e999', '-1e999']) {
        const m = putMouvement(article, 1, null);
        const corps = JSON.stringify({ ecritures: [m] }).replace('"quantite":1,', `"quantite":${q},`);
        expect(corps).toContain(`"quantite":${q}`);
        expect((await lotBrut(corps)).refus, q).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
        expect(await mouvements(m.id)).toBe(0);
      }
    });

    it('plafond compris, dans les deux sens ; quantité décimale gardée telle quelle', async () => {
      const haut = putMouvement(article, PLAFOND, null);
      const bas = putMouvement(article, -PLAFOND, null, { motif: 'perte' });
      const decimale = putMouvement(article, 12.5, null);
      expect(await lot([haut])).toEqual({ refus: [] });
      expect(await lot([bas])).toEqual({ refus: [] });
      expect(await lot([decimale])).toEqual({ refus: [] });
      const r = await base.pool.query<{ q: number }>(`SELECT quantite::float8 AS q FROM mouvement_stock WHERE id = $1`, [decimale.id]);
      expect(r.rows).toEqual([{ q: 12.5 }]);
    });

    it('motif recolte sans recolte_id, ou recolte_id avec un autre motif : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, null, { motif: 'recolte' }));
      for (const motif of ['vente', 'perte', 'ajustement']) await refuse(putMouvement(article, -3, recolte, { motif }));
    });

    it('motif inconnu : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, null, { motif: 'don' }));
    });

    it('vente, perte, ajustement sans recolte_id : acceptés', async () => {
      for (const [motif, q] of [
        ['vente', -2],
        ['perte', -1],
        ['ajustement', 4],
      ] as const) {
        const m = putMouvement(article, q, null, { motif });
        expect(await lot([m]), motif).toEqual({ refus: [] });
      }
    });

    it('mouvement négatif de motif recolte rattaché à la récolte elle-même (fausse récolte) : ecriture_invalide', async () => {
      await refuse(putMouvement(article, -1, recolte));
    });

    it('date invalide ou hors de [2000-01-01, 2100-12-31] : ecriture_invalide', async () => {
      for (const date of ['2026-02-30', '01/10/2026', '1999-12-31', '2101-01-01', null]) {
        await refuse(putMouvement(article, 3, null, { date }));
      }
    });

    it('colonne inconnue, ou id glissé dans les données : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, null, { prix: 4 }));
      const m = putMouvement(article, 3, null);
      await refuse({ ...m, donnees: { ...m.donnees, id: m.id } });
    });
  });

  // ── article_stock : création seule ──────────────────────────────────────────────────────────

  describe('article_stock : création seule', () => {
    it('espèce de la ferme, avec sa variété : accepté, avec son historique', async () => {
      const a = putArticle({ variete_id: coeurDeBoeuf, categorie: 'extra' });
      expect(await lot([a])).toEqual({ refus: [] });
      expect(await articles(a.id)).toBe(1);
      expect(await modifications(a.id)).toBe(1);
    });

    it('espèce de la bibliothèque (ferme_id nul) : accepté', async () => {
      const a = putArticle({ espece_id: courgetteBibliotheque });
      expect(await lot([a])).toEqual({ refus: [] });
      expect(await articles(a.id)).toBe(1);
    });

    it('espèce ou variété d’une autre ferme : ferme_interdite', async () => {
      for (const a of [putArticle({ espece_id: especeVoisine }), putArticle({ variete_id: varieteVoisine })]) {
        expect((await lot([a])).refus).toEqual([{ table: 'article_stock', id: a.id, motif: 'ferme_interdite' }]);
        expect(await articles(a.id)).toBe(0);
      }
    });

    it('article pour une ferme dont l’utilisateur n’est pas membre : ferme_interdite', async () => {
      const a = putArticle({ espece_id: especeVoisine }, autreFerme);
      expect((await lot([a])).refus).toEqual([{ table: 'article_stock', id: a.id, motif: 'ferme_interdite' }]);
      expect(await articles(a.id)).toBe(0);
    });

    it.each([
      ['espèce introuvable', () => ({ espece_id: randomUUID() })],
      ['espèce supprimée', () => ({ espece_id: especeSupprimee })],
      ['unité invalide', () => ({ unite: 'tonne' })],
      ['créé déjà supprimé', () => ({ supprime_le: '2026-10-01T05:58:00.000Z' })],
      ['colonne inconnue', () => ({ prix: 4 })],
    ])('%s : ecriture_invalide', async (_cas, autres) => {
      const a = putArticle(autres());
      expect((await lot([a])).refus).toEqual([{ table: 'article_stock', id: a.id, motif: 'ecriture_invalide' }]);
      expect(await articles(a.id)).toBe(0);
    });

    it('renvoi identique : accepté, un seul historique', async () => {
      const a = putArticle();
      expect(await lot([a])).toEqual({ refus: [] });
      expect(await lot([a])).toEqual({ refus: [] });
      expect(await articles(a.id)).toBe(1);
      expect(await modifications(a.id)).toBe(1);
    });

    it('même id avec d’autres valeurs, PATCH, DELETE : refusés, l’article ne change pas', async () => {
      const a = putArticle();
      expect(await lot([a])).toEqual({ refus: [] });
      const ecritures: EcritureEnvoyee[] = [
        { ...a, donnees: { ...a.donnees, unite: 'botte' } },
        { op: 'PATCH', table: 'article_stock', id: a.id, donnees: { categorie: 'extra' } },
        { op: 'DELETE', table: 'article_stock', id: a.id },
      ];
      for (const e of ecritures) {
        const reponse = await lot([e]);
        expect(MOTIFS_ARTICLE_FIGE, `${e.op} : ${JSON.stringify(reponse.refus)}`).toContain(motifDe(reponse, a.id));
      }
      const r = await base.pool.query<Record<string, unknown>>(`SELECT unite, categorie, supprime_le FROM article_stock WHERE id = $1`, [a.id]);
      expect(r.rows).toEqual([{ unite: 'kg', categorie: null, supprime_le: null }]);
      expect(await modifications(a.id)).toBe(1);
    });
  });
});
