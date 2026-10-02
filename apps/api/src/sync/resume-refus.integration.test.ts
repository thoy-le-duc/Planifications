/**
 * Tests d'acceptation T10k — refus de synchro : la saisie refusée reconnaissable
 * (docs/backlog/T10k-refus-saisie.md), contre un vrai Postgres.
 *
 * Exécution : comme T10 (DATABASE_URL ; base jetable `t10k_resume_…` supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local). Les refus sont PRODUITS pour de vrai :
 * chaque scénario envoie un lot à POST /sync/upload, puis lit la ligne de refus_synchro écrite.
 *
 * ── Contrat (proposé par le testeur) ────────────────────────────────────────────────────────
 *
 * Cinq colonnes NULLABLES de plus dans refus_synchro (Postgres), synchronisées vers le téléphone
 * (règles powersync/sync-config.yaml, schéma local packages/sync/src/schema.ts) : le résumé de
 * la saisie refusée, en champs séparés et typés, jamais un texte libre ni un JSON :
 *
 *   saisie_type      text              type d'événement reçu, s'il est l'un des types connus
 *                                      ('realise', 'recolte', 'intervention', 'irrigation',
 *                                      'traitement', 'observation') ; sinon NULL.
 *   saisie_culture   text              « Espèce » ou « Espèce Variété » de la série (serie_id) ou
 *                                      de la plantation de la campagne (campagne_id) désignée, LUE
 *                                      EN BASE, seulement si cette série ou campagne appartient à
 *                                      une ferme dont l'utilisateur est membre accepté (ferme de
 *                                      l'utilisateur au moment du lot) ; sinon NULL. Nettoyée :
 *                                      aucun caractère de contrôle ni séparateur de ligne
 *                                      (\p{Cc}, \p{Zl}, \p{Zp}), espaces de bord retirés,
 *                                      LONGUEUR_MAX_CULTURE (80) caractères au plus ; vide → NULL.
 *   saisie_date      date (ou text)    `date` reçue si c'est un jour valide AAAA-MM-JJ ; sinon NULL.
 *   saisie_quantite  double precision  récolte seulement : detail.quantite (detail reçu en texte
 *                                      JSON ou en objet) si c'est un nombre fini ; sinon NULL.
 *   saisie_unite     text              récolte seulement : detail.unite si elle est l'une de
 *                                      UNITES_RECOLTE ('kg', 'botte', 'piece', 'barquette') ; sinon NULL.
 *
 * Ce résumé ne s'appuie que sur ce que le téléphone a envoyé et sur les références de SES fermes :
 * jamais le nom d'une culture d'une autre ferme (même désignée par un id valide), jamais la note
 * (contenu personnel), ni aucun autre texte libre reçu. Une écriture illisible (données absentes,
 * pas un objet, champs de mauvais type, JSON cassé, nombre infini) donne un résumé vide ou partiel,
 * jamais un 500 : le refus s'enregistre quand même. Les écritures d'autres tables qu'evenement et
 * la ligne récapitulative d'un lot trop gros peuvent n'avoir aucun résumé (non exigé ici).
 *
 * Total borné : la somme des longueurs des champs texte du résumé reste sous 200 caractères.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
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

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const LONGUEUR_MAX_CULTURE = 80;
const LONGUEUR_MAX_RESUME = 200;

/** Noms des cultures de la ferme voisine : ne doivent JAMAIS apparaître dans un refus de Théo. */
const ESPECE_VOISINE = 'Pivoine Confidentielle';
const VARIETE_VOISINE = 'Sarah Bernhardt du voisin';
const VARIETE_A = 'Batavia blonde';
/** Notes personnelles : jamais dans le résumé. */
const NOTE_RECOLTE = 'Code du portail 4821, voir avec Marie';
const NOTE_REALISE = 'Planté avec Jules, mal au dos';

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: unknown;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

/** Résumé lu dans refus_synchro (colonnes du contrat). */
interface Resume {
  readonly motif: string;
  readonly message: string;
  readonly saisie_type: string | null;
  readonly saisie_culture: string | null;
  readonly saisie_date: string | null;
  readonly saisie_quantite: number | null;
  readonly saisie_unite: string | null;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10k')('T10k : résumé de la saisie refusée', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let theo: string;
  let collegue: string;
  let fermeA: string;
  let fermeB: string;
  let voisine: string;
  let a: LignesDeFerme;
  let b: LignesDeFerme;
  let v: LignesDeFerme;

  beforeAll(async () => {
    base = await creerBaseJetable('t10k_resume');
    cles = { active: await genererCleSignature('cle-t10k'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
      envoisMaxParMinute: 1_000_000,
    });
    fermeA = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeB = await creerFerme(base.pool, 'Vergers du Lot');
    voisine = await creerFerme(base.pool, 'Ferme du voisin');
    const u = await creerUtilisateur(base.pool);
    theo = u.id;
    collegue = (await creerUtilisateur(base.pool)).id;
    await ajouterMembre(base.pool, theo, fermeA, { role: 'gerant' });
    await ajouterMembre(base.pool, theo, fermeB, { role: 'gerant' });
    await ajouterMembre(base.pool, collegue, fermeA);
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, theo, MAINTENANT);

    // Ferme A : la série est de la Laitue, variété « Batavia blonde » ; la campagne, du Kiwi.
    a = await peuplerFerme(base.pool, fermeA);
    const varieteA = randomUUID();
    await base.pool.query(
      `INSERT INTO variete (id, ferme_id, espece_id, nom) SELECT $1, ferme_id, espece_id, $3 FROM serie WHERE id = $2`,
      [varieteA, a.serie, VARIETE_A],
    );
    await base.pool.query(`UPDATE serie SET variete_id = $1 WHERE id = $2`, [varieteA, a.serie]);

    // Ferme B (aussi à Théo) : un nom d'espèce saisi avec des caractères de contrôle, très long.
    b = await peuplerFerme(base.pool, fermeB);
    await base.pool.query(`UPDATE espece SET nom = $1 WHERE id = (SELECT espece_id FROM serie WHERE id = $2)`, [
      `Tom\u0007ate\n\u2028cerise ${'très longue '.repeat(40)}`,
      b.serie,
    ]);

    // Ferme voisine : Théo n'en est pas membre ; ses cultures portent des noms reconnaissables.
    v = await peuplerFerme(base.pool, voisine);
    const varieteV = randomUUID();
    await base.pool.query(
      `INSERT INTO variete (id, ferme_id, espece_id, nom) SELECT $1, ferme_id, espece_id, $3 FROM serie WHERE id = $2`,
      [varieteV, v.serie, VARIETE_VOISINE],
    );
    await base.pool.query(`UPDATE serie SET variete_id = $1 WHERE id = $2`, [varieteV, v.serie]);
    await base.pool.query(`UPDATE espece SET nom = $1 WHERE ferme_id = $2`, [ESPECE_VOISINE, voisine]);
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
    expect(res.status, 'un refus n’est jamais un 500').toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Envoie `e` seule et vérifie qu'elle est refusée (motif `motif` si donné). */
  async function refusee(e: EcritureEnvoyee, motif?: string): Promise<void> {
    const r = await lot([e]);
    expect(r.refus.map((x) => x.id), 'écriture refusée').toContain(e.id);
    if (motif !== undefined) expect(r.refus.find((x) => x.id === e.id)?.motif).toBe(motif);
  }

  /** Le refus enregistré pour la ligne `id` (exactement un), avec son résumé. */
  async function resume(id: string): Promise<Resume> {
    const r = await base.pool.query<Resume>(
      `SELECT motif, message, saisie_type, saisie_culture, saisie_date::text AS saisie_date,
              saisie_quantite::float8 AS saisie_quantite, saisie_unite
       FROM refus_synchro WHERE ligne_id = $1`,
      [id],
    );
    expect(r.rows, `un refus enregistré pour ${id}`).toHaveLength(1);
    const l = r.rows[0];
    if (l === undefined) throw new Error('refus absent');
    return l;
  }

  /** Tout ce qui descend sur le téléphone pour ce refus (la ligne sans `donnees`), en texte. */
  async function ligneQuiDescend(id: string): Promise<string> {
    const r = await base.pool.query<{ l: unknown }>(`SELECT to_jsonb(r) - 'donnees' AS l FROM refus_synchro r WHERE ligne_id = $1`, [id]);
    return JSON.stringify(r.rows[0]?.l ?? null);
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  function putEvenement(donnees: Record<string, unknown>): EcritureEnvoyee {
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
        detail: JSON.stringify({ quantite: 12, unite: 'kg', categorie: null }),
        ...donnees,
      },
    };
  }

  const putRecolte = (quantite: number, unite: string, autres: Record<string, unknown> = {}) =>
    putEvenement({ type: 'recolte', detail: JSON.stringify({ quantite, unite, categorie: null }), ...autres });

  function sansControle(texte: string): boolean {
    return !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(texte);
  }

  // ── 1. Le résumé de la saisie refusée ───────────────────────────────────────────────────────

  describe('ce qui a été saisi', () => {
    it('récolte refusée (récolte annulée) : type, culture de la série, date et quantité saisies', async () => {
      const origine = putRecolte(10, 'kg', { serie_id: a.serie, date: '2026-09-27' });
      const annulation = putRecolte(10, 'kg', {
        serie_id: a.serie,
        date: '2026-09-27',
        horodatage: '2026-10-01T04:00:00.000Z',
        remplace_sorte: 'annulation',
        remplace_evenement_id: origine.id,
      });
      expect(await lot([origine, annulation])).toEqual({ refus: [] });
      const correction = putRecolte(12.5, 'kg', {
        serie_id: a.serie,
        date: '2026-09-28',
        horodatage: '2026-10-01T05:00:00.000Z',
        remplace_sorte: 'correction',
        remplace_evenement_id: origine.id,
        note: NOTE_RECOLTE,
      });
      await refusee(correction, 'recolte_annulee');

      const r = await resume(correction.id);
      expect(r.saisie_type).toBe('recolte');
      expect(r.saisie_culture, 'l’espèce de la série').toContain('Laitue');
      expect(r.saisie_culture, 'et sa variété').toContain(VARIETE_A);
      expect(r.saisie_date, 'la date de la saisie, pas celle du refus').toBe('2026-09-28');
      expect(r.saisie_quantite).toBe(12.5);
      expect(r.saisie_unite).toBe('kg');
      expect(await ligneQuiDescend(correction.id), 'jamais la note').not.toContain('portail');
    });

    it('récolte d’une campagne (culture pérenne) refusée : la culture de la plantation', async () => {
      const r0 = putRecolte(8, 'barquette', { campagne_id: a.campagne, auteur_id: collegue, date: '2026-09-30' });
      await refusee(r0, 'auteur_invalide');
      const r = await resume(r0.id);
      expect(r.saisie_type).toBe('recolte');
      expect(r.saisie_culture).toContain('Kiwi');
      expect(r.saisie_date).toBe('2026-09-30');
      expect(r.saisie_quantite).toBe(8);
      expect(r.saisie_unite).toBe('barquette');
    });

    it('detail reçu en objet (pas en texte JSON) : même résumé', async () => {
      const r0 = putEvenement({ serie_id: a.serie, auteur_id: collegue, detail: { quantite: 3, unite: 'botte', categorie: null } });
      await refusee(r0, 'auteur_invalide');
      const r = await resume(r0.id);
      expect(r.saisie_quantite).toBe(3);
      expect(r.saisie_unite).toBe('botte');
    });

    it('événement « réalisé » refusé : type, culture et date, sans quantité', async () => {
      const realise = putEvenement({
        type: 'realise',
        serie_id: a.serie,
        date: '2026-08-05',
        auteur_id: collegue,
        note: NOTE_REALISE,
        detail: JSON.stringify({ etape: 'plantation', quantiteReelle: 240 }),
      });
      await refusee(realise, 'auteur_invalide');
      const r = await resume(realise.id);
      expect(r.saisie_type).toBe('realise');
      expect(r.saisie_culture).toContain('Laitue');
      expect(r.saisie_date).toBe('2026-08-05');
      expect(r.saisie_quantite, 'la quantité n’est résumée que pour une récolte').toBeNull();
      expect(r.saisie_unite).toBeNull();
      expect(await ligneQuiDescend(realise.id), 'jamais la note').not.toMatch(/Jules|mal au dos/);
    });

    it('événement sans série ni campagne : type et date, culture vide', async () => {
      const obs = putEvenement({ type: 'observation', auteur_id: collegue, date: '2026-09-15', detail: JSON.stringify({}) });
      await refusee(obs, 'auteur_invalide');
      const r = await resume(obs.id);
      expect(r.saisie_type).toBe('observation');
      expect(r.saisie_culture).toBeNull();
      expect(r.saisie_date).toBe('2026-09-15');
    });
  });

  // ── 2. Écritures illisibles : pas de résumé, pas de panne ───────────────────────────────────

  describe('écriture illisible', () => {
    it('données qui ne sont pas un objet : refus enregistré, aucun résumé', async () => {
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: 'pas un objet' };
      await refusee(e);
      const r = await resume(e.id);
      expect([r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_quantite, r.saisie_unite]).toEqual([null, null, null, null, null]);
    });

    it('données absentes : refus enregistré, aucun résumé', async () => {
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>() };
      await refusee(e);
      const r = await resume(e.id);
      expect([r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_quantite, r.saisie_unite]).toEqual([null, null, null, null, null]);
    });

    it('champs de mauvais type, JSON cassé, id invalide, date impossible : champs vides, jamais la valeur brute', async () => {
      const e = putEvenement({
        type: 'piratage\u0000<script>',
        date: '2026-02-30',
        serie_id: 'pas-un-uuid',
        campagne_id: 42,
        detail: '{pas du json',
      });
      await refusee(e, 'ecriture_invalide');
      const r = await resume(e.id);
      expect(r.saisie_type, 'type inconnu').toBeNull();
      expect(r.saisie_culture).toBeNull();
      expect(r.saisie_date, 'jour impossible').toBeNull();
      expect(r.saisie_quantite).toBeNull();
      expect(r.saisie_unite).toBeNull();
    });

    it('récolte : quantité non numérique ou infinie, unité inconnue, date mal formée → vides', async () => {
      const textuelle = putEvenement({ serie_id: a.serie, auteur_id: collegue, date: 'demain\u0007', detail: JSON.stringify({ quantite: 'beaucoup', unite: 'tonne' }) });
      // 1e400 se lit Infinity : un nombre qui ne s'écrit pas n'est pas une quantité.
      const infinie = putEvenement({ serie_id: a.serie, auteur_id: collegue, date: 12, detail: '{"quantite":1e400,"unite":"<b>kg</b>"}' });
      for (const e of [textuelle, infinie]) {
        await refusee(e);
        const r = await resume(e.id);
        expect(r.saisie_type).toBe('recolte');
        expect(r.saisie_culture, 'la culture reste lisible').toContain('Laitue');
        expect(r.saisie_date).toBeNull();
        expect(r.saisie_quantite).toBeNull();
        expect(r.saisie_unite).toBeNull();
      }
    });
  });

  // ── 3. Isolement : rien d'une autre ferme ───────────────────────────────────────────────────

  describe('isolement', () => {
    const secrets = new RegExp(`${ESPECE_VOISINE}|${VARIETE_VOISINE}|Ferme du voisin`);

    it('récolte qui vise la série d’une autre ferme (ferme_interdite) : aucun nom de culture de cette ferme', async () => {
      const e = putRecolte(5, 'kg', { ferme_id: voisine, serie_id: v.serie, date: '2026-09-20' });
      await refusee(e, 'ferme_interdite');
      const r = await resume(e.id);
      expect(r.saisie_culture).toBeNull();
      expect(await ligneQuiDescend(e.id)).not.toMatch(secrets);
      // Ce que Théo a lui-même saisi reste reconnaissable.
      expect(r.saisie_date).toBe('2026-09-20');
      expect(r.saisie_quantite).toBe(5);
    });

    it('récolte de MA ferme qui désigne la série d’une autre ferme : refusée, culture vide', async () => {
      const e = putRecolte(5, 'kg', { serie_id: v.serie });
      await refusee(e, 'ecriture_invalide');
      expect((await resume(e.id)).saisie_culture).toBeNull();
      expect(await ligneQuiDescend(e.id)).not.toMatch(secrets);
    });

    it('récolte de MA ferme qui désigne la campagne d’une autre ferme : refusée, culture vide', async () => {
      const e = putRecolte(5, 'kg', { campagne_id: v.campagne });
      await refusee(e, 'ecriture_invalide');
      expect((await resume(e.id)).saisie_culture).toBeNull();
      expect(await ligneQuiDescend(e.id)).not.toMatch(secrets);
    });

    it('série d’une ferme quittée : plus de nom de culture', async () => {
      const quittee = await creerFerme(base.pool, 'Ferme quittée');
      await ajouterMembre(base.pool, theo, quittee, { retire: true });
      const q = await peuplerFerme(base.pool, quittee);
      await base.pool.query(`UPDATE espece SET nom = 'Asperge quittée' WHERE ferme_id = $1`, [quittee]);
      const e = putRecolte(5, 'kg', { ferme_id: quittee, serie_id: q.serie });
      await refusee(e, 'ferme_interdite');
      expect((await resume(e.id)).saisie_culture).toBeNull();
      expect(await ligneQuiDescend(e.id)).not.toContain('Asperge quittée');
    });
  });

  // ── 4. Pas de note, taille bornée, texte propre ─────────────────────────────────────────────

  describe('ce que le résumé ne contient jamais', () => {
    it('la note, quel que soit le motif (aucune colonne de ce qui descend)', async () => {
      const ecritures = [
        putRecolte(4, 'kg', { serie_id: a.serie, auteur_id: collegue, note: NOTE_RECOLTE }),
        putRecolte(4, 'kg', { ferme_id: voisine, note: NOTE_RECOLTE }),
        putRecolte(-4, 'kg', { serie_id: a.serie, note: NOTE_RECOLTE }),
      ];
      for (const e of ecritures) {
        await refusee(e);
        const r = await resume(e.id);
        for (const champ of [r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_unite]) {
          expect(champ ?? '').not.toContain('portail');
        }
        expect(await ligneQuiDescend(e.id)).not.toMatch(/portail|4821|Marie/);
      }
    });

    it('nom de culture avec caractères de contrôle et très long : nettoyé et borné', async () => {
      const e = putRecolte(2, 'kg', { ferme_id: fermeB, serie_id: b.serie, auteur_id: collegue });
      await refusee(e, 'auteur_invalide');
      const r = await resume(e.id);
      const culture = r.saisie_culture ?? '';
      expect(culture, 'la culture reste lisible').toMatch(/^Tom.?ate/);
      expect(culture).toContain('cerise');
      expect(sansControle(culture), `aucun caractère de contrôle (${JSON.stringify(culture)})`).toBe(true);
      expect(culture.length).toBeLessThanOrEqual(LONGUEUR_MAX_CULTURE);
      expect(culture).toBe(culture.trim());
      const total = [r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_unite].reduce((n, t) => n + (t ?? '').length, 0);
      expect(total).toBeLessThanOrEqual(LONGUEUR_MAX_RESUME);
    });

    it('tout champ texte du résumé est sans caractère de contrôle, même reçu avec', async () => {
      const e = putRecolte(2, 'kg', { serie_id: a.serie, auteur_id: collegue, type: 'recolte\n', date: '2026-09-01\u0000' });
      await refusee(e);
      const r = await resume(e.id);
      for (const champ of [r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_unite]) {
        expect(sansControle(champ ?? ''), JSON.stringify(champ)).toBe(true);
      }
      expect(r.saisie_type, 'type reçu avec un saut de ligne : pas un type connu').toBeNull();
      expect(r.saisie_date).toBeNull();
    });
  });
});
