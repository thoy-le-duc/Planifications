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
 *     non supprimé. Introuvable, supprimé ou d'une autre ferme → 'ecriture_invalide' (T10d : une
 *     ligne d'une autre ferme se comporte comme une ligne inexistante, stock-suites.integration.test.ts).
 *   - `quantite` : un nombre (pas un texte), fini, non nul, |quantite| ≤
 *     PLAFONDS_PROVISOIRES.recolteQuantite (100 000, borne comprise ; Q13) → sinon
 *     'ecriture_invalide'.
 *   - `date` : 'AAAA-MM-JJ' existante dans [2000-01-01, 2100-12-31] (comme un événement).
 *   - `motif` : 'recolte' SEULEMENT depuis un téléphone (décision 5 du chef : vente, perte,
 *     ajustement n'ont pas d'écran, refusés → 'ecriture_invalide') ; motif inconnu, ou
 *     recolte_id nul → 'ecriture_invalide'.
 *   - `recolte_id` : événement de type 'recolte' (une récolte, ou son annulation ou sa correction,
 *     qui sont du même type) de la MÊME ferme, écrit avant ou plus haut dans le même lot.
 *     Introuvable, d'un autre type ou d'une autre ferme (T10d) → 'ecriture_invalide'.
 *   - Quantité négative : acceptée seulement si recolte_id désigne une ANNULATION ou une
 *     CORRECTION (remplace_sorte non nul). Rattachée à la récolte d'origine → 'ecriture_invalide'.
 *   - Décision 3 du chef (mouvement borné), sinon 'ecriture_invalide' :
 *       annulation : le mouvement rattaché vaut EXACTEMENT l'opposé de la somme des mouvements de
 *         la chaîne de la récolte annulée, sur le MÊME article (12 → −12 ; −50 ou −12 sur
 *         un autre article : refusé) ;
 *       correction : le mouvement rattaché vaut la nouvelle quantité − la quantité EN VIGUEUR
 *         (après les corrections précédentes) (12 → 15 : +3 accepté, +5 refusé ; 12 → 10 : −2).
 *       Chaîne : une annulation (de l'origine ou d'une de ses corrections) vaut l'opposé de la somme
 *         de TOUS les mouvements de la chaîne (origine + corrections) sur le même article :
 *         12 (+12) → 15 (+3) → annulation −15 ; récolte avec +10 et +2 → annulation −12.
 *     Le mouvement inverse pointe vers l'événement d'annulation ou de correction (comme T13).
 *
 * Règles de `article_stock` (création seule) :
 *   - PUT : espèce visible par la ferme (de la ferme, ou de la bibliothèque : ferme_id nul), non
 *     supprimée ; variété (facultative) visible de même ; unite ∈ kg | botte | piece | barquette.
 *     Espèce ou variété introuvable, supprimée ou d'une autre ferme (T10d), unité invalide →
 *     'ecriture_invalide'.
 *   - PUT identique (renvoi) : accepté sans rien écrire de plus. Même id, autres valeurs, PATCH,
 *     DELETE → refusés ('ajout_seul' ou 'table_interdite' : au choix du développeur, le message
 *     doit dire que la donnée ne se modifie pas depuis le téléphone). La ligne ne change pas.
 *
 * Historique : chaque ligne créée a sa ligne `modification` dans la même transaction, comme un
 *   événement (T10) : nom_table 'ArticleStock' ou 'MouvementStock' (noms d'entité de T01),
 *   operation 'creation', auteur = utilisateur du jeton, avant NULL, apres = la ligne écrite.
 *
 * Une saisie = une transaction (décisions 1 et 2 du chef) : un lot (= une
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
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, peuplerFerme, type BaseJetable } from './test/base-jetable.ts';

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
        motif: 'recolte',
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

  /** Une récolte seule (sans mouvement), acceptée dans son propre lot ; rend son id. */
  async function recolteSeule(quantite: number): Promise<string> {
    const recolte = putRecolte(quantite);
    expect(await lot([recolte])).toEqual({ refus: [] });
    return recolte.id;
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

    it('décision 3 : correction 12 → 15, mouvement +3 accepté ; +5 refusé (rien d’écrit)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const trop = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'kg', categorie: null });
      const cinq = putMouvement(article.id, 5, trop.id);
      await refuseEnEntier([trop, cinq], cinq, 'ecriture_invalide');
      const correction = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'kg', categorie: null });
      const trois = putMouvement(article.id, 3, correction.id);
      expect(await lot([correction, trois])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(15);
    });

    it('décision 3 : correction 12 → 10, un mouvement −3 (au lieu de −2) est refusé', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', { quantite: 10, unite: 'kg', categorie: null });
      const faux = putMouvement(article.id, -3, correction.id);
      await refuseEnEntier([correction, faux], faux, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('décision 3 : annulation d’une récolte de 12 avec −50 : refusée en entier, le stock reste à 12', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = putRemplacement(recolte, 'annulation');
      const inverse = putMouvement(article.id, -50, annulation.id);
      await refuseEnEntier([annulation, inverse], inverse, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('décision 3 : annulation avec −12 sur un autre article que celui de la récolte : refusée en entier', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const autreArticle = await articleEnBase(ferme, tomate);
      const annulation = putRemplacement(recolte, 'annulation');
      const inverse = putMouvement(autreArticle, -12, annulation.id);
      await refuseEnEntier([annulation, inverse], inverse, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
      expect(await stock(autreArticle)).toBe(0);
    });

    it.each(['la correction', 'l’origine'])(
      'décision 3 : récolte 12 (+12), correction → 15 (+3), annulation de %s : −12 refusé, −15 accepté (toute la chaîne)',
      async (cible) => {
        const { recolte, article } = await recolteAcceptee(12);
        const correction = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'kg', categorie: null });
        expect(await lot([correction, putMouvement(article.id, 3, correction.id)])).toEqual({ refus: [] });
        const annulee = cible === 'la correction' ? correction : recolte;

        const annulationFausse = putRemplacement(annulee, 'annulation', { quantite: 15, unite: 'kg', categorie: null });
        const moinsDouze = putMouvement(article.id, -12, annulationFausse.id);
        await refuseEnEntier([annulationFausse, moinsDouze], moinsDouze, 'ecriture_invalide');

        const annulation = putRemplacement(annulee, 'annulation', { quantite: 15, unite: 'kg', categorie: null });
        const moinsQuinze = putMouvement(article.id, -15, annulation.id);
        expect(await lot([annulation, moinsQuinze])).toEqual({ refus: [] });
        expect(await stock(article.id)).toBe(0);
      },
    );

    it('décision 3 : récolte 12 avec deux mouvements (+10 et +2, même article, même lot) : annulation −10 refusée, −12 acceptée', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      const dix = putMouvement(article.id, 10, recolte.id);
      const deux = putMouvement(article.id, 2, recolte.id);
      expect(await lot([recolte, article, dix, deux])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(12);

      const annulationFausse = putRemplacement(recolte, 'annulation');
      const moinsDix = putMouvement(article.id, -10, annulationFausse.id);
      await refuseEnEntier([annulationFausse, moinsDix], moinsDix, 'ecriture_invalide');

      const annulation = putRemplacement(recolte, 'annulation');
      const moinsDouze = putMouvement(article.id, -12, annulation.id);
      expect(await lot([annulation, moinsDouze])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(0);
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
      // T10d : une espèce d'une autre ferme se comporte comme une espèce inexistante.
      await refuseEnEntier([recolte, article, mouvement], article, 'ecriture_invalide');
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
      const recolteVoisine = putRecolte(5, {}, voisin.id, autreFerme);
      expect(await lot([recolteVoisine], voisin.jeton)).toEqual({ refus: [] });
      const m = putMouvement(articleVoisin, 5, recolteVoisine.id, { ferme_id: autreFerme });
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ferme_interdite' }]);
      expect(await mouvements(m.id)).toBe(0);
      expect(await stock(articleVoisin)).toBe(0);
    });

    it('article d’une autre ferme, sous le ferme_id de la sienne : ecriture_invalide, comme un article inexistant (T10d)', async () => {
      const m = putMouvement(articleVoisin, 5, await recolteSeule(5));
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
      expect(await mouvements(m.id)).toBe(0);
    });

    it('article introuvable ou supprimé : ecriture_invalide', async () => {
      for (const articleId of [randomUUID(), articleSupprime]) {
        const m = putMouvement(articleId, 5, await recolteSeule(5));
        expect((await lot([m])).refus, articleId).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
        expect(await mouvements(m.id)).toBe(0);
      }
    });

    it('recolte_id d’une récolte d’une autre ferme : ecriture_invalide, comme une récolte inexistante (T10d)', async () => {
      const recolteVoisine = putRecolte(3, {}, voisin.id, autreFerme);
      expect(await lot([recolteVoisine], voisin.jeton)).toEqual({ refus: [] });
      const { article } = await recolteAcceptee(1);
      const m = putMouvement(article.id, 3, recolteVoisine.id);
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
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

    beforeAll(async () => {
      article = (await recolteAcceptee(1)).article.id;
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
      ['NaN (texte)', 'NaN'],
    ])('quantité %s : ecriture_invalide', async (_cas, quantite) => {
      await refuse(putMouvement(article, quantite, await recolteSeule(1)));
    });

    it('au-delà du plafond négatif (annulation d’une récolte au plafond avec −plafond − 1) : refusé en entier', async () => {
      const recolte = putRecolte(PLAFOND);
      expect(await lot([recolte, putMouvement(article, PLAFOND, recolte.id)])).toEqual({ refus: [] });
      const annulation = putRemplacement(recolte, 'annulation');
      const inverse = putMouvement(article, -(PLAFOND + 1), annulation.id);
      await refuseEnEntier([annulation, inverse], inverse, 'ecriture_invalide');
    });

    it('quantité non finie (1e999 dans le JSON reçu, lue Infinity) : ecriture_invalide, jamais 5xx', async () => {
      for (const q of ['1e999', '-1e999']) {
        const m = putMouvement(article, 1, await recolteSeule(1));
        const corps = JSON.stringify({ ecritures: [m] }).replace('"quantite":1,', `"quantite":${q},`);
        expect(corps).toContain(`"quantite":${q}`);
        expect((await lotBrut(corps)).refus, q).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
        expect(await mouvements(m.id)).toBe(0);
      }
    });

    it('plafond compris, dans les deux sens (récolte au plafond puis son annulation) ; quantité décimale gardée telle quelle', async () => {
      const recolte = putRecolte(PLAFOND);
      const haut = putMouvement(article, PLAFOND, recolte.id);
      expect(await lot([recolte, haut])).toEqual({ refus: [] });
      const annulation = putRemplacement(recolte, 'annulation');
      const bas = putMouvement(article, -PLAFOND, annulation.id);
      expect(await lot([annulation, bas])).toEqual({ refus: [] });

      const petite = putRecolte(12.5);
      const decimale = putMouvement(article, 12.5, petite.id);
      expect(await lot([petite, decimale])).toEqual({ refus: [] });
      const r = await base.pool.query<{ q: number }>(`SELECT quantite::float8 AS q FROM mouvement_stock WHERE id = $1`, [decimale.id]);
      expect(r.rows).toEqual([{ q: 12.5 }]);
    });

    it('motif recolte sans recolte_id, ou recolte_id avec un autre motif : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, null));
      const recolte = await recolteSeule(3);
      for (const motif of ['vente', 'perte', 'ajustement']) await refuse(putMouvement(article, 3, recolte, { motif }));
    });

    it('motif inconnu : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, null, { motif: 'don' }));
    });

    it('décision 5 : vente, perte, ajustement refusés depuis un téléphone (pas encore d’écran), même sans recolte_id', async () => {
      // Stock relevé avant : l'article est partagé par le describe, les tests précédents y
      // laissent des mouvements acceptés (correction du chef, voir la PR).
      const avant = await stock(article);
      for (const [motif, q] of [
        ['vente', -2],
        ['perte', -1],
        ['ajustement', 4],
      ] as const) {
        await refuse(putMouvement(article, q, null, { motif }));
      }
      expect(await stock(article)).toBe(avant);
    });

    it('mouvement négatif de motif recolte rattaché à la récolte elle-même (fausse récolte) : ecriture_invalide', async () => {
      await refuse(putMouvement(article, -1, await recolteSeule(1)));
    });

    it('date invalide ou hors de [2000-01-01, 2100-12-31] : ecriture_invalide', async () => {
      for (const date of ['2026-02-30', '01/10/2026', '1999-12-31', '2101-01-01', null]) {
        await refuse(putMouvement(article, 3, await recolteSeule(3), { date }));
      }
    });

    it('colonne inconnue, ou id glissé dans les données : ecriture_invalide', async () => {
      await refuse(putMouvement(article, 3, await recolteSeule(3), { prix: 4 }));
      const m = putMouvement(article, 3, await recolteSeule(3));
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

    it('espèce ou variété d’une autre ferme : ecriture_invalide, comme une espèce ou une variété inexistante (T10d)', async () => {
      for (const a of [putArticle({ espece_id: especeVoisine }), putArticle({ variete_id: varieteVoisine })]) {
        expect((await lot([a])).refus).toEqual([{ table: 'article_stock', id: a.id, motif: 'ecriture_invalide' }]);
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

  // ── Relecture de T10c : décisions du chef (docs/backlog/T10c-stock-synchro.md) ─────────────────

  describe('relecture B1 : mouvement de la récolte d’origine borné par la quantité en vigueur', () => {
    it('récolte de 12 : +100 000 sur l’origine refusé', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      const trop = putMouvement(article.id, PLAFOND, recolte.id);
      await refuseEnEntier([recolte, article, trop], trop, 'ecriture_invalide');
    });

    it('récolte de 12 : +12 accepté, puis +1 de plus sur l’origine refusé', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const encore = putMouvement(article.id, 1, recolte.id);
      expect((await lot([encore])).refus).toEqual([{ table: 'mouvement_stock', id: encore.id, motif: 'ecriture_invalide' }]);
      expect(await stock(article.id)).toBe(12);
    });

    it('récolte de 12 : +10 puis +2 (lots séparés) acceptés, somme = 12', async () => {
      const recolte = putRecolte(12);
      const article = putArticle();
      expect(await lot([recolte, article, putMouvement(article.id, 10, recolte.id)])).toEqual({ refus: [] });
      expect(await lot([putMouvement(article.id, 2, recolte.id)])).toEqual({ refus: [] });
      expect(await stock(article.id)).toBe(12);
    });

    it('après annulation (+12, −12) : +50 sur l’origine refusé (la chaîne contient une annulation)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const annulation = putRemplacement(recolte, 'annulation');
      expect(await lot([annulation, putMouvement(article.id, -12, annulation.id)])).toEqual({ refus: [] });
      const retour = putMouvement(article.id, 50, recolte.id);
      expect((await lot([retour])).refus).toEqual([{ table: 'mouvement_stock', id: retour.id, motif: 'ecriture_invalide' }]);
      expect(await stock(article.id)).toBe(0);
    });

    it('récolte corrigée à 15 (+12 puis +3) : +1 de plus sur l’origine refusé (somme ≤ quantité en vigueur)', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'kg', categorie: null });
      expect(await lot([correction, putMouvement(article.id, 3, correction.id)])).toEqual({ refus: [] });
      const encore = putMouvement(article.id, 1, recolte.id);
      expect((await lot([encore])).refus).toEqual([{ table: 'mouvement_stock', id: encore.id, motif: 'ecriture_invalide' }]);
      expect(await stock(article.id)).toBe(15);
    });
  });

  describe('relecture B2 : un seul article par chaîne, unité et espèce de la récolte', () => {
    let serie: string;
    let especeSerie: string;

    beforeAll(async () => {
      serie = (await peuplerFerme(base.pool, ferme)).serie;
      const r = await base.pool.query<{ espece_id: string }>(`SELECT espece_id::text AS espece_id FROM serie WHERE id = $1`, [serie]);
      especeSerie = r.rows[0]?.espece_id ?? '';
    });

    it('correction 12 → 15 avec +3 sur l’article de la récolte ET +15 sur un autre article : lot refusé en entier', async () => {
      const { recolte, article } = await recolteAcceptee(12);
      const correction = putRemplacement(recolte, 'correction', { quantite: 15, unite: 'kg', categorie: null });
      const trois = putMouvement(article.id, 3, correction.id);
      const autre = putArticle();
      const quinze = putMouvement(autre.id, 15, correction.id);
      await refuseEnEntier([correction, trois, autre, quinze], quinze, 'ecriture_invalide');
      expect(await stock(article.id)).toBe(12);
    });

    it('premier mouvement sur un article d’une autre unité que detail.unite : refusé ; même unité : accepté', async () => {
      const recolte = putRecolte(12);
      const bottes = putArticle({ unite: 'botte' });
      const m = putMouvement(bottes.id, 12, recolte.id);
      await refuseEnEntier([recolte, bottes, m], m, 'ecriture_invalide');
      await recolteAcceptee(12);
    });

    it('récolte d’une série : article d’une autre espèce que la série refusé ; de son espèce accepté', async () => {
      const recolte = putRecolte(12, { serie_id: serie });
      const tomates = putArticle({ espece_id: tomate });
      const m = putMouvement(tomates.id, 12, recolte.id);
      await refuseEnEntier([recolte, tomates, m], m, 'ecriture_invalide');

      const bonne = putRecolte(12, { serie_id: serie });
      const article = putArticle({ espece_id: especeSerie });
      expect(await lot([bonne, article, putMouvement(article.id, 12, bonne.id)])).toEqual({ refus: [] });
    });
  });

  describe('relecture : verrou par ferme, deux lots concurrents sur deux chaînes', () => {
    it('lots R1 puis R2 et R2 puis R1 envoyés en même temps : jamais de 500 ni d’interblocage ; chaque lot accepté ou refusé en entier', async () => {
      // Non déterministe par nature : on répète pour rendre l'entrelacement probable (sans verrou
      // unique par ferme, Postgres détecte un interblocage 40P01 et la route répond 500).
      for (let essai = 0; essai < 15; essai++) {
        const r1 = await recolteAcceptee(12);
        const r2 = await recolteAcceptee(12);
        const lotDe = (premiere: typeof r1, seconde: typeof r1): EcritureEnvoyee[] => {
          const a = putRemplacement(premiere.recolte, 'annulation');
          const b = putRemplacement(seconde.recolte, 'annulation');
          return [a, putMouvement(premiere.article.id, -12, a.id), b, putMouvement(seconde.article.id, -12, b.id)];
        };
        const lotA = lotDe(r1, r2);
        const lotB = lotDe(r2, r1);
        const envoyer = (ecritures: readonly EcritureEnvoyee[]) =>
          Promise.resolve(
            app.request('/sync/upload', {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${theo.jeton}` },
              body: JSON.stringify({ ecritures }),
            }),
          );
        const [ra, rb] = await Promise.all([envoyer(lotA), envoyer(lotB)]);
        expect([ra.status, rb.status], `essai ${String(essai)}`).toEqual([200, 200]);
        for (const [reponse, ecritures] of [
          [(await ra.json()) as ReponseUpload, lotA],
          [(await rb.json()) as ReponseUpload, lotB],
        ] as const) {
          const refuses = new Set(reponse.refus.map((x) => x.id));
          const tout = ecritures.every((e) => refuses.has(e.id));
          const rien = reponse.refus.length === 0;
          expect(tout || rien, `essai ${String(essai)} : accepté ou refusé en entier (${JSON.stringify(reponse.refus)})`).toBe(true);
        }
        // Chaque récolte est annulée une fois au plus : son stock est 0 (une annulation passée) ou 12.
        for (const r of [r1, r2]) expect([0, 12]).toContain(await stock(r.article.id));
      }
    });
  });

  describe('relecture : précision au millionième', () => {
    it('+12,0000004 refusé ; +0,000001 accepté ; 1e-7 refusé', async () => {
      const recolte = putRecolte(13);
      const article = putArticle();
      const septDecimales = putMouvement(article.id, 12.0000004, recolte.id);
      await refuseEnEntier([recolte, article, septDecimales], septDecimales, 'ecriture_invalide');

      const petite = putRecolte(1);
      const a2 = putArticle();
      const millionieme = putMouvement(a2.id, 0.000001, petite.id);
      expect(await lot([petite, a2, millionieme])).toEqual({ refus: [] });
      const r = await base.pool.query<{ q: string }>(`SELECT quantite::text AS q FROM mouvement_stock WHERE id = $1`, [millionieme.id]);
      expect(Number(r.rows[0]?.q)).toBe(0.000001);

      const infime = putMouvement(a2.id, 1e-7, petite.id);
      expect((await lot([infime])).refus).toEqual([{ table: 'mouvement_stock', id: infime.id, motif: 'ecriture_invalide' }]);
    });
  });

  describe('relecture : chaîne de plus de 1 000 niveaux', () => {
    /**
     * Récolte d'origine de 12 et `n` corrections en chaîne, écrites directement en base (un seul
     * INSERT : 1 001 envois HTTP seraient lents). La dernière correction vaut 13. Aucun mouvement
     * dans la chaîne : le mouvement exact de la dernière correction est donc +13.
     */
    async function chaine(n: number): Promise<{ derniere: string; article: string }> {
      const ids = Array.from({ length: n + 1 }, () => nouvelId<'Evenement'>() as string);
      const quantites = ids.map((_, i) => (i === 0 ? 12 : i === n ? 13 : 12 + (i % 2)));
      await base.pool.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, remplace_sorte, remplace_evenement_id, detail)
         SELECT t.id, $1, 'recolte', '2026-10-01', '2026-10-01T05:58:00Z', $2, 'tap',
                CASE WHEN t.parent IS NULL THEN NULL ELSE 'correction' END, t.parent,
                jsonb_build_object('quantite', t.q, 'unite', 'kg', 'categorie', NULL)
         FROM unnest($3::uuid[], $4::uuid[], $5::float8[]) AS t(id, parent, q)`,
        [ferme, theo.id, ids, [null, ...ids.slice(0, -1)], quantites],
      );
      const article = putArticle();
      expect(await lot([article])).toEqual({ refus: [] });
      return { derniere: ids[n] ?? '', article: article.id };
    }

    it('50 corrections : le mouvement exact de la dernière (+13) est accepté', async () => {
      const c = await chaine(50);
      expect(await lot([putMouvement(c.article, 13, c.derniere)])).toEqual({ refus: [] });
    });

    it('1 001 corrections : refusé (ecriture_invalide), sans repli sur une somme partielle', async () => {
      const c = await chaine(1_001);
      const m = putMouvement(c.article, 13, c.derniere);
      expect((await lot([m])).refus).toEqual([{ table: 'mouvement_stock', id: m.id, motif: 'ecriture_invalide' }]);
      expect(await mouvements(m.id)).toBe(0);
    });
  });
});
