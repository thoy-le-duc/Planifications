/**
 * Tests d'acceptation T10 — POST /sync/upload, contre un vrai Postgres.
 *
 * Exécution : comme T09 (DATABASE_URL ; base jetable `t10_upload_…` supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * C'est la route que le connecteur PowerSync du téléphone appelle (uploadData) pour vider sa
 * file d'écritures faites hors ligne. Elle vérifie la ferme de chaque écriture, rejoue les règles
 * de @planif/core, et écrit dans Postgres EN UNE SEULE TRANSACTION, avec la ligne de
 * `modification` (historique). Règle de PowerSync : une réponse 4xx bloquerait la file ; donc
 * un refus métier répond 200 et s'enregistre dans `refus_synchro`, qui redescend sur le
 * téléphone par la synchro.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Route montée par creerApp (apps/api/src/app.ts), code dans apps/api/src/sync/.
 *
 *   POST /sync/upload   Authorization: Bearer <jetonAcces>   (garde de T09)
 *   Corps : { ecritures: EcritureEnvoyee[] }  — une transaction PowerSync (CrudTransaction)
 *     EcritureEnvoyee = { op: 'PUT' | 'PATCH' | 'DELETE', table: string, id: string, donnees?: {…} }
 *     - PUT : création de la ligne `id` ; `donnees` = toutes ses colonnes sauf id.
 *     - PATCH : colonnes modifiées seulement. DELETE : pas de `donnees`.
 *     - `table` et clés de `donnees` : noms Postgres (snake_case), valeurs telles que SQLite les
 *       stocke côté téléphone : texte, nombre ou null ; jsonb (`detail`) et tableaux
 *       (`emplacement_ids`, `photos`) en texte JSON ; instants en ISO 8601 ; dates 'AAAA-MM-JJ'.
 *
 *   Réponses :
 *     401 { erreur: 'non_authentifie' } : jeton absent ou invalide (rien d'écrit).
 *     400 { erreur: 'requete_invalide' } : corps illisible ou sans tableau `ecritures` (rien
 *         d'écrit). Une écriture isolée mal formée n'est PAS un 400 : c'est un refus.
 *     200 { refus: [{ table, id, motif }] } : lot traité. Chaque écriture est acceptée ou refusée
 *         individuellement ; les acceptées sont écrites, les refusées ne laissent rien sauf leur
 *         ligne de refus. `refus` vide si tout est accepté.
 *     5xx : panne passagère seulement (base injoignable…) ; rien d'écrit, PowerSync renverra
 *         le lot. Jamais de 200 « ferme_interdite » parce que la base ne répond pas.
 *
 *   Règles (T10 : la table `evenement` ; les autres tables métier suivront avec leurs écrans) :
 *     - Ferme : l'utilisateur doit être membre actif (fermesDeLUtilisateur de @planif/db : membre
 *       accepté, rien de supprimé) de la ferme de l'écriture (`donnees.ferme_id` pour un PUT,
 *       ferme de la ligne existante sinon). Sinon motif 'ferme_interdite'.
 *     - Auteur : `donnees.auteur_id` d'un événement doit être l'utilisateur du jeton, sinon
 *       'auteur_invalide'.
 *     - Ajout seul : PATCH ou DELETE sur `evenement` → 'ajout_seul'. Un PUT sur un id existant
 *       avec les MÊMES valeurs n'est pas un refus (renvoi d'un lot dont la réponse s'est perdue :
 *       rien de nouveau) ; avec des valeurs différentes → 'ajout_seul', la ligne ne change pas.
 *     - Tables que le téléphone n'écrit jamais : 'table_interdite' (utilisateur, membre,
 *       code_connexion, jeton_renouvellement, modification, refus_synchro, table inconnue…).
 *     - Données refusées par @planif/core ou par une contrainte de la base (CHECK…) :
 *       'ecriture_invalide'. Jamais un 5xx.
 *
 *   Historique : pour chaque écriture acceptée qui crée une ligne, une ligne `modification`
 *   dans la même transaction : ferme_id, nom_table = nom d'entité de T01 ('Evenement'),
 *   ligne_id = id, auteur_id = utilisateur du jeton, operation 'creation', avant NULL, apres =
 *   la ligne écrite (jsonb), horodatage = maintenant(). Un renvoi identique n'en crée pas d'autre.
 *
 *   Table `refus_synchro` (nouvelle migration de @planif/db, ajoutée à la publication powersync) :
 *     id uuid PK (UUID v7 serveur), utilisateur_id uuid NOT NULL → utilisateur, ferme_id uuid
 *     (ferme visée si connue, sans clé étrangère), nom_table text NOT NULL, ligne_id text NOT
 *     NULL, operation text NOT NULL ('PUT' | 'PATCH' | 'DELETE'), motif text NOT NULL,
 *     message text NOT NULL (explication en français pour le téléphone), donnees jsonb (ce qui
 *     a été reçu), cree_le timestamptz NOT NULL (= maintenant()).
 *     Elle descend par la synchro vers l'auteur seulement (flux filtré sur utilisateur_id).
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import {
  ajouterMembre,
  creerBaseJetable,
  creerFerme,
  creerUtilisateur,
  decrireAvecBase,
  type BaseJetable,
} from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10')('T10 : POST /sync/upload', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Membre actif (gérant) de la ferme principale. */
  let theo: { id: string; jeton: string };
  /** Membre actif d'une autre ferme seulement. */
  let voisin: { id: string; jeton: string };
  /** Invité à la ferme principale, pas encore accepté. */
  let invite: { id: string; jeton: string };
  /** Retiré de la ferme principale. */
  let retire: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10_upload');
    cles = { active: await genererCleSignature('cle-t10'), precedentes: [] };
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
    const i = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, i.id, ferme, { etat: 'invite', invitePar: u.id });
    await ajouterMembre(base.pool, r.id, ferme, { retire: true });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };
    invite = { id: i.id, jeton: await jetonPour(i.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  function envoyer(corps: unknown, jeton?: string, application = app): Promise<Response> {
    const entetes: Record<string, string> = { 'content-type': 'application/json' };
    if (jeton !== undefined) entetes.authorization = `Bearer ${jeton}`;
    return Promise.resolve(application.request('/sync/upload', { method: 'POST', headers: entetes, body: JSON.stringify(corps) }));
  }

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<ReponseUpload> {
    const res = await envoyer({ ecritures }, jeton);
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Une récolte telle que le téléphone l'envoie (ligne SQLite de PowerSync). */
  function putRecolte(
    auteurId: string,
    fermeId: string,
    quantite = 12.5,
    autres: Record<string, unknown> = {},
  ): EcritureEnvoyee {
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
        note: 'rang du fond',
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ quantite, unite: 'kg', categorie: null }),
        ...autres,
      },
    };
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const evenements = (id: string) => compter(`SELECT 1 FROM evenement WHERE id = $1`, [id]);
  const modifications = (id: string) => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);
  const refusDe = (id: string) => compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = $1`, [id]);

  async function refusEnregistre(id: string): Promise<Record<string, unknown>> {
    const r = await base.pool.query<Record<string, unknown>>(`SELECT * FROM refus_synchro WHERE ligne_id = $1`, [id]);
    expect(r.rows, `un refus pour ${id}`).toHaveLength(1);
    return r.rows[0] ?? {};
  }

  // --- Authentification et forme du corps -----------------------------------------------------

  describe('accès', () => {
    it('401 sans jeton ou avec un jeton invalide, rien d’écrit', async () => {
      const e = putRecolte(theo.id, ferme);
      for (const jeton of [undefined, 'pas.un.jeton']) {
        const res = await envoyer({ ecritures: [e] }, jeton);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ erreur: 'non_authentifie' });
      }
      expect(await evenements(e.id)).toBe(0);
    });

    it('400 requete_invalide si le corps n’a pas de tableau ecritures', async () => {
      for (const corps of [{}, { ecritures: 'x' }, [], null]) {
        const res = await envoyer(corps, theo.jeton);
        expect(res.status, JSON.stringify(corps)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'requete_invalide' });
      }
    });
  });

  // --- Écriture valide --------------------------------------------------------------------------

  describe('récolte valide', () => {
    it('écrit l’événement et sa ligne d’historique, et la récolte apparaît dans la vue recoltes', async () => {
      const e = putRecolte(theo.id, ferme, 12.5);
      expect(await lot([e], theo.jeton)).toEqual({ refus: [] });

      const ev = await base.pool.query<Record<string, unknown>>(
        `SELECT e.*, e.date::text AS date_texte FROM evenement e WHERE id = $1`,
        [e.id],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0]).toMatchObject({
        ferme_id: ferme,
        type: 'recolte',
        date_texte: '2026-10-01',
        auteur_id: theo.id,
        source: 'tap',
        emplacement_ids: [],
        photos: [],
        note: 'rang du fond',
        detail: { quantite: 12.5, unite: 'kg', categorie: null },
      });
      expect((ev.rows[0]?.horodatage as Date).toISOString()).toBe('2026-10-01T05:58:00.000Z');

      const vue = await base.pool.query<{ quantite: number; unite: string }>(
        `SELECT quantite::float8 AS quantite, unite FROM recoltes WHERE id = $1`,
        [e.id],
      );
      expect(vue.rows).toEqual([{ quantite: 12.5, unite: 'kg' }]);

      const modifs = await base.pool.query<Record<string, unknown>>(`SELECT * FROM modification WHERE ligne_id = $1`, [e.id]);
      expect(modifs.rows).toHaveLength(1);
      const m = modifs.rows[0];
      expect(m).toMatchObject({
        ferme_id: ferme,
        nom_table: 'Evenement',
        ligne_id: e.id,
        auteur_id: theo.id,
        operation: 'creation',
        avant: null,
        proposition_id: null,
      });
      expect(String(m?.id)).toMatch(UUID);
      expect((m?.horodatage as Date).toISOString()).toBe(MAINTENANT.toISOString());
      expect(m?.apres).toMatchObject({ id: e.id });
      expect(await refusDe(e.id)).toBe(0);
    });

    it('le même lot envoyé deux fois ne crée qu’une ligne (et un seul historique), sans refus', async () => {
      const a = putRecolte(theo.id, ferme, 3);
      const b = putRecolte(theo.id, ferme, 4);
      expect(await lot([a, b], theo.jeton)).toEqual({ refus: [] });
      expect(await lot([a, b], theo.jeton)).toEqual({ refus: [] });
      for (const e of [a, b]) {
        expect(await evenements(e.id)).toBe(1);
        expect(await modifications(e.id)).toBe(1);
        expect(await refusDe(e.id)).toBe(0);
      }
    });
  });

  // --- Isolement entre fermes ------------------------------------------------------------------

  describe('ferme de l’écriture', () => {
    it.each([
      ['membre d’une autre ferme', () => voisin],
      ['invité pas encore accepté', () => invite],
      ['membre retiré', () => retire],
    ])('%s : refus ferme_interdite, rien d’écrit, la file continue (200)', async (_cas, qui) => {
      const u = qui();
      const e = putRecolte(u.id, ferme);
      const reponse = await lot([e], u.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ferme_interdite' }]);
      expect(await evenements(e.id)).toBe(0);
      expect(await modifications(e.id)).toBe(0);

      const refus = await refusEnregistre(e.id);
      expect(refus).toMatchObject({
        utilisateur_id: u.id,
        ferme_id: ferme,
        nom_table: 'evenement',
        ligne_id: e.id,
        operation: 'PUT',
        motif: 'ferme_interdite',
      });
      expect(String(refus.id)).toMatch(UUID);
      expect(String(refus.message).length).toBeGreaterThan(10);
      expect((refus.cree_le as Date).toISOString()).toBe(MAINTENANT.toISOString());
    });

    it('une écriture pour sa ferme et une pour une autre dans le même lot : seule la seconde est refusée', async () => {
      const bonne = putRecolte(voisin.id, autreFerme, 7);
      const mauvaise = putRecolte(voisin.id, ferme, 8);
      const reponse = await lot([bonne, mauvaise], voisin.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: mauvaise.id, motif: 'ferme_interdite' }]);
      expect(await evenements(bonne.id)).toBe(1);
      expect(await evenements(mauvaise.id)).toBe(0);
    });

    it('un événement dont l’auteur n’est pas l’utilisateur du jeton est refusé (auteur_invalide)', async () => {
      const e = putRecolte(voisin.id, ferme);
      const reponse = await lot([e], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: e.id, motif: 'auteur_invalide' }]);
      expect(await evenements(e.id)).toBe(0);
      expect(await refusEnregistre(e.id)).toMatchObject({ utilisateur_id: theo.id, motif: 'auteur_invalide' });
    });
  });

  // --- Règles métier : journal en ajout seul ------------------------------------------------------

  describe('événement modifié après coup', () => {
    it('PATCH et DELETE sur un événement : refus ajout_seul, l’événement ne change pas, les autres écritures du lot passent', async () => {
      const origine = putRecolte(theo.id, ferme, 10);
      expect(await lot([origine], theo.jeton)).toEqual({ refus: [] });

      const patch: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id: origine.id, donnees: { note: 'modifiée' } };
      const suppression: EcritureEnvoyee = { op: 'DELETE', table: 'evenement', id: origine.id };
      const suivante = putRecolte(theo.id, ferme, 11);
      const reponse = await lot([patch, suivante, suppression], theo.jeton);

      expect(reponse.refus).toEqual([
        { table: 'evenement', id: origine.id, motif: 'ajout_seul' },
        { table: 'evenement', id: origine.id, motif: 'ajout_seul' },
      ]);
      const ev = await base.pool.query<{ note: string }>(`SELECT note FROM evenement WHERE id = $1`, [origine.id]);
      expect(ev.rows).toEqual([{ note: 'rang du fond' }]);
      expect(await evenements(suivante.id)).toBe(1);
      expect(await modifications(suivante.id)).toBe(1);
      expect(await modifications(origine.id)).toBe(1);

      const refus = await base.pool.query<{ operation: string; motif: string; ferme_id: string; utilisateur_id: string }>(
        `SELECT operation, motif, ferme_id, utilisateur_id FROM refus_synchro WHERE ligne_id = $1 ORDER BY operation`,
        [origine.id],
      );
      expect(refus.rows).toEqual([
        { operation: 'DELETE', motif: 'ajout_seul', ferme_id: ferme, utilisateur_id: theo.id },
        { operation: 'PATCH', motif: 'ajout_seul', ferme_id: ferme, utilisateur_id: theo.id },
      ]);
    });

    it('un PUT sur un événement existant avec d’autres valeurs est refusé (ajout_seul) ; la ligne reste', async () => {
      const origine = putRecolte(theo.id, ferme, 5);
      expect(await lot([origine], theo.jeton)).toEqual({ refus: [] });
      const reecrit: EcritureEnvoyee = {
        ...origine,
        donnees: { ...origine.donnees, detail: JSON.stringify({ quantite: 50, unite: 'kg', categorie: null }) },
      };
      const reponse = await lot([reecrit], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: origine.id, motif: 'ajout_seul' }]);
      const ev = await base.pool.query<{ q: number }>(`SELECT (detail->>'quantite')::float8 AS q FROM evenement WHERE id = $1`, [
        origine.id,
      ]);
      expect(ev.rows).toEqual([{ q: 5 }]);
    });
  });

  // --- Données invalides et tables interdites -----------------------------------------------------

  describe('écritures refusées sans bloquer la file', () => {
    it('données invalides (quantité négative) : refus ecriture_invalide en 200, jamais 5xx', async () => {
      const invalide = putRecolte(theo.id, ferme, -3);
      const valide = putRecolte(theo.id, ferme, 3);
      const reponse = await lot([invalide, valide], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: invalide.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(invalide.id)).toBe(0);
      expect(await evenements(valide.id)).toBe(1);
    });

    it.each(['membre', 'utilisateur', 'jeton_renouvellement', 'code_connexion', 'modification', 'refus_synchro', 'table_inconnue'])(
      'table %s : refus table_interdite, rien d’écrit',
      async (table) => {
        const id = nouvelId<'Evenement'>();
        const donnees: Record<string, unknown> = {
          utilisateur_id: voisin.id,
          ferme_id: autreFerme,
          role: 'gerant',
          etat: 'accepte',
          email: 'pirate@ferme.fr',
          jeton_hache: 'x',
          expire_le: '2027-01-01T00:00:00.000Z',
        };
        const reponse = await lot([{ op: 'PUT', table, id, donnees }], voisin.jeton);
        expect(reponse.refus).toEqual([{ table, id, motif: 'table_interdite' }]);
        expect(await refusEnregistre(id)).toMatchObject({ utilisateur_id: voisin.id, motif: 'table_interdite' });
        if (table === 'membre') {
          expect(await compter(`SELECT 1 FROM membre WHERE id = $1`, [id])).toBe(0);
        }
      },
    );

    it('un PATCH sur membre ne donne jamais accès à une ferme', async () => {
      const r = await base.pool.query<{ id: string }>(`SELECT id FROM membre WHERE utilisateur_id = $1`, [invite.id]);
      const membreId = r.rows[0]?.id ?? '';
      const reponse = await lot([{ op: 'PATCH', table: 'membre', id: membreId, donnees: { etat: 'accepte' } }], invite.jeton);
      expect(reponse.refus).toEqual([{ table: 'membre', id: membreId, motif: 'table_interdite' }]);
      const etat = await base.pool.query<{ etat: string }>(`SELECT etat FROM membre WHERE id = $1`, [membreId]);
      expect(etat.rows).toEqual([{ etat: 'invite' }]);
    });
  });

  // --- Panne passagère ---------------------------------------------------------------------------

  describe('panne passagère', () => {
    it('base injoignable : 5xx (PowerSync réessaiera), pas un refus', async () => {
      const injoignable = new pg.Pool({ connectionString: 'postgres://planif:planif@127.0.0.1:1/planif', connectionTimeoutMillis: 500 });
      injoignable.on('error', () => undefined);
      const appEnPanne = creerApp({
        db: drizzle(injoignable),
        expediteur: expediteurMuet,
        cles,
        emetteur: EMETTEUR,
        audience: AUDIENCE,
        maintenant: () => MAINTENANT,
      });
      try {
        const e = putRecolte(theo.id, ferme);
        const res = await envoyer({ ecritures: [e] }, theo.jeton, appEnPanne);
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(res.status).toBeLessThan(600);
        expect(await evenements(e.id)).toBe(0);
        expect(await refusDe(e.id)).toBe(0);
      } finally {
        await injoignable.end();
      }
    });
  });
});
