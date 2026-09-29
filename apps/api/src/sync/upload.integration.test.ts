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
 *
 * ── Corrections de la relecture (T10) ───────────────────────────────────────────────────────
 *
 *   B1  Références : un PUT d'événement de la ferme A est refusé si un identifiant qu'il porte
 *       désigne une ligne d'une autre ferme → 'ferme_interdite' ; une ligne inexistante →
 *       'ecriture_invalide'. Rien d'écrit, 200, les autres écritures du lot passent.
 *       Identifiants vérifiés : serie_id (serie), campagne_id (campagne), chaque élément de
 *       emplacement_ids (emplacement), remplace_evenement_id (evenement), et dans `detail` :
 *       secteurIrrigationId (secteur_irrigation, type 'irrigation'), produitPhytoId
 *       (produit_phyto, type 'traitement'). Seuls ces deux identifiants existent dans les
 *       Detail* de T01. Produit phyto : accepté s'il est de la ferme A OU de la bibliothèque
 *       (ferme_id nul) ; autre ferme → 'ferme_interdite' ; inexistant → 'ecriture_invalide'.
 *   C1  Jamais de 500 à cause de ce que le téléphone envoie : un caractère nul (U+0000) dans
 *       `table`, `id` (PUT ou DELETE) ou un nom de colonne de `donnees` → 200 avec un refus
 *       (enregistré dans refus_synchro), et le même lot renvoyé passe encore en 200.
 *       Textes du refus tronqués : nom_table, ligne_id et message font au plus 200 caractères
 *       dans refus_synchro, même si l'écriture reçue portait 10 000 caractères.
 *   C2  Limites : note > 4 000 caractères, plus de 20 photos, une photo > 2 000 caractères,
 *       `detail` > 8 Kio (8 192 octets UTF-8 de JSON.stringify du détail lu), clé inconnue dans
 *       `detail` (hors des clés du Detail* de T01 pour ce type) → 'ecriture_invalide'.
 *       Les bornes elles-mêmes (4 000, 20, 2 000) sont acceptées.
 *       Plus de 500 écritures dans un lot → 400 { erreur: 'requete_invalide' }, rien d'écrit
 *       (500 passent). Corps HTTP > 5 Mio (5 × 1 048 576 octets) → 413, rien d'écrit.
 *       `donnees` dont le JSON dépasse 16 Kio : le refus est enregistré, colonne donnees nulle.
 *   M1  Refus 'ferme_interdite' d'un utilisateur qui n'est pas membre actif de la ferme visée :
 *       ferme_id NUL dans refus_synchro (la ligne descend sur son téléphone : elle ne doit pas
 *       lui apprendre l'id d'une ferme qui n'est pas la sienne).
 *   M2  Un même lot renvoyé ne crée pas de refus en double : au plus une ligne refus_synchro par
 *       (utilisateur_id, ligne_id, operation, motif).
 *   M7  `date` hors de [2000-01-01, 2100-12-31] et `horodatage` hors de
 *       [2000-01-01T00:00:00Z, 2100-12-31T23:59:59.999Z] → 'ecriture_invalide' (bornes acceptées).
 *
 * ── 2e relecture (T10) ──────────────────────────────────────────────────────────────────────
 *
 *   R1  `emplacement_ids` : 200 emplacements au plus (200 acceptés s'ils sont tous valides,
 *       201 → 'ecriture_invalide'). 70 000 UUID distincts (corps < 5 Mio) → 200 avec un refus
 *       'ecriture_invalide', jamais 500 ; le même lot renvoyé → 200, sans refus en double.
 *       Doublons, y compris à la casse près (`[e, E, e]`) → 'ecriture_invalide' (décision du
 *       chef : on refuse plutôt que de dédupliquer en silence).
 *   R2  JSON très imbriqué, jamais 500 : `donnees` imbriquées sur 50 000 niveaux (table
 *       interdite) → 200, refus enregistré avec donnees NULL ; `detail` (texte JSON, comme
 *       SQLite) imbriqué sur 50 000 niveaux → 200, 'ecriture_invalide'. Le lot sain suivant passe.
 *   R4  Référence vers une ligne supprimée (`supprime_le` non nul) : série, campagne,
 *       emplacement, secteur d'irrigation, produit phyto (de la ferme ou de la bibliothèque)
 *       → 'ecriture_invalide', rien d'écrit. (Ces cinq tables ont une colonne supprime_le ;
 *       `evenement`, en ajout seul, n'en a pas.)
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
  creerProduitPhytoBibliotheque,
  creerUtilisateur,
  decrireAvecBase,
  peuplerFerme,
  type BaseJetable,
  type LignesDeFerme,
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
      // M1 (relecture) : ferme_id nul, l'utilisateur n'est pas membre actif de cette ferme.
      expect(refus).toMatchObject({
        utilisateur_id: u.id,
        ferme_id: null,
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

  // --- Corrections de la relecture (voir l'en-tête : B1, C1, C2, M1, M2, M7) ---------------------

  /** Nouveau membre actif (gérant) de `fermeId`, avec son jeton : ses refus se comptent à part. */
  async function nouveauMembre(fermeId: string = ferme): Promise<{ id: string; jeton: string }> {
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, fermeId, { role: 'gerant' });
    return { id: u.id, jeton: await jetonPour(u.id) };
  }

  const refusDeLUtilisateur = (utilisateurId: string) => compter(`SELECT 1 FROM refus_synchro WHERE utilisateur_id = $1`, [utilisateurId]);

  /** Un événement de `type` tel que le téléphone l'envoie, avec son détail. */
  function putEvenement(
    auteurId: string,
    fermeId: string,
    type: string,
    detail: Record<string, unknown>,
    autres: Record<string, unknown> = {},
  ): EcritureEnvoyee {
    return putRecolte(auteurId, fermeId, 1, { type, detail: JSON.stringify(detail), ...autres });
  }

  const irrigation = (secteur: string) => ({ secteurIrrigationId: secteur, dureeMinutes: 30 });
  const traitement = (produit: string) => ({
    produitPhytoId: produit,
    dose: { valeur: 2, unite: 'L/ha' },
    surfaceTraiteeM2: 100,
    cible: 'mildiou',
    operateur: 'Théo',
    recolteAutoriseeLe: '2026-10-22',
  });

  describe('B1 : références vers une autre ferme', () => {
    let a: LignesDeFerme;
    let b: LignesDeFerme;
    let phytoBibliotheque: string;
    /** Un événement déjà écrit dans la ferme B (par le voisin). */
    let evenementB: string;

    beforeAll(async () => {
      a = await peuplerFerme(base.pool, ferme);
      b = await peuplerFerme(base.pool, autreFerme);
      phytoBibliotheque = await creerProduitPhytoBibliotheque(base.pool);
      const e = putRecolte(voisin.id, autreFerme, 2);
      expect(await lot([e], voisin.jeton)).toEqual({ refus: [] });
      evenementB = e.id;
    });

    const inexistant = () => nouvelId<'Serie'>();

    it('toutes les références dans la ferme A (produit phyto de la ferme ou de la bibliothèque) : acceptées', async () => {
      const ecritures = [
        putRecolte(theo.id, ferme, 1, { serie_id: a.serie, emplacement_ids: JSON.stringify([a.emplacement]) }),
        putRecolte(theo.id, ferme, 1, { campagne_id: a.campagne }),
        putEvenement(theo.id, ferme, 'irrigation', irrigation(a.secteurIrrigation), { emplacement_ids: JSON.stringify([a.emplacement]) }),
        putEvenement(theo.id, ferme, 'traitement', traitement(a.produitPhyto)),
        putEvenement(theo.id, ferme, 'traitement', traitement(phytoBibliotheque)),
      ];
      expect(await lot(ecritures, theo.jeton)).toEqual({ refus: [] });
      for (const e of ecritures) expect(await evenements(e.id)).toBe(1);
    });

    it.each([
      ['serie_id', () => ({ serie_id: b.serie })],
      ['campagne_id', () => ({ campagne_id: b.campagne })],
      ['un des emplacement_ids', () => ({ emplacement_ids: JSON.stringify([a.emplacement, b.emplacement]) })],
      ['remplace_evenement_id', () => ({ remplace_sorte: 'correction', remplace_evenement_id: evenementB })],
      ['detail.secteurIrrigationId', () => ({ type: 'irrigation', detail: JSON.stringify(irrigation(b.secteurIrrigation)) })],
      ['detail.produitPhytoId', () => ({ type: 'traitement', detail: JSON.stringify(traitement(b.produitPhyto)) })],
    ])('%s d’une autre ferme : ferme_interdite, rien d’écrit, 200, le reste du lot passe', async (_cas, champs) => {
      const mauvaise = putRecolte(theo.id, ferme, 1, champs());
      const bonne = putRecolte(theo.id, ferme, 2);
      const reponse = await lot([mauvaise, bonne], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: mauvaise.id, motif: 'ferme_interdite' }]);
      expect(await evenements(mauvaise.id)).toBe(0);
      expect(await modifications(mauvaise.id)).toBe(0);
      expect(await evenements(bonne.id)).toBe(1);
      expect(await refusEnregistre(mauvaise.id)).toMatchObject({ utilisateur_id: theo.id, motif: 'ferme_interdite' });
    });

    it.each([
      ['serie_id', () => ({ serie_id: inexistant() })],
      ['campagne_id', () => ({ campagne_id: inexistant() })],
      ['un des emplacement_ids', () => ({ emplacement_ids: JSON.stringify([a.emplacement, inexistant()]) })],
      ['remplace_evenement_id', () => ({ remplace_sorte: 'correction', remplace_evenement_id: inexistant() })],
      ['detail.secteurIrrigationId', () => ({ type: 'irrigation', detail: JSON.stringify(irrigation(inexistant())) })],
      ['detail.produitPhytoId', () => ({ type: 'traitement', detail: JSON.stringify(traitement(inexistant())) })],
    ])('%s inexistant : ecriture_invalide, rien d’écrit, 200, le reste du lot passe', async (_cas, champs) => {
      const mauvaise = putRecolte(theo.id, ferme, 1, champs());
      const bonne = putRecolte(theo.id, ferme, 2);
      const reponse = await lot([mauvaise, bonne], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: mauvaise.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(mauvaise.id)).toBe(0);
      expect(await evenements(bonne.id)).toBe(1);
    });
  });

  describe('C1 : jamais de 500 à cause des données reçues', () => {
    const NUL = '\u0000';
    const MOTIFS = ['ferme_interdite', 'auteur_invalide', 'ajout_seul', 'table_interdite', 'ecriture_invalide'];

    it.each([
      ['table', (u: string) => ({ ...putRecolte(u, ferme), table: `evenement${NUL}` })],
      ['id d’un PUT', (u: string) => ({ ...putRecolte(u, ferme), id: `${nouvelId<'Evenement'>()}${NUL}` })],
      ['id d’un DELETE', () => ({ op: 'DELETE' as const, table: 'evenement', id: `${NUL}${nouvelId<'Evenement'>()}` })],
      ['nom de colonne', (u: string) => putRecolte(u, ferme, 1, { [`note${NUL}`]: 'x' })],
    ])('caractère nul dans %s : 200 avec un refus enregistré, et le lot renvoyé passe encore', async (_cas, fabriquer) => {
      const u = await nouveauMembre();
      const piege = fabriquer(u.id);
      const bonne = putRecolte(u.id, ferme, 6);
      for (let envoi = 0; envoi < 2; envoi++) {
        const res = await envoyer({ ecritures: [piege, bonne] }, u.jeton);
        expect(res.status, `envoi ${String(envoi + 1)}`).toBe(200);
        const reponse = (await res.json()) as ReponseUpload;
        expect(reponse.refus).toHaveLength(1);
        expect(MOTIFS).toContain(reponse.refus[0]?.motif);
      }
      expect(await evenements(bonne.id)).toBe(1);
      expect(await refusDeLUtilisateur(u.id)).toBe(1);
    });

    it.each([
      ['table', (u: string) => ({ ...putRecolte(u, ferme), table: 't'.repeat(10_000) })],
      ['id', (u: string) => ({ ...putRecolte(u, ferme), id: 'i'.repeat(10_000) })],
      ['nom de colonne', (u: string) => putRecolte(u, ferme, 1, { ['c'.repeat(10_000)]: 'x' })],
    ])('%s de 10 000 caractères : 200, refus enregistré avec nom_table, ligne_id et message de 200 caractères au plus', async (_cas, fabriquer) => {
      const u = await nouveauMembre();
      const res = await envoyer({ ecritures: [fabriquer(u.id)] }, u.jeton);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ReponseUpload).refus).toHaveLength(1);
      const r = await base.pool.query<{ nom_table: string; ligne_id: string; message: string }>(
        `SELECT nom_table, ligne_id, message FROM refus_synchro WHERE utilisateur_id = $1`,
        [u.id],
      );
      expect(r.rows).toHaveLength(1);
      const ligne = r.rows[0];
      expect(ligne?.nom_table.length).toBeLessThanOrEqual(200);
      expect(ligne?.ligne_id.length).toBeLessThanOrEqual(200);
      expect(ligne?.message.length).toBeLessThanOrEqual(200);
    });
  });

  describe('C2 : limites de taille', () => {
    async function refuse(e: EcritureEnvoyee): Promise<void> {
      const reponse = await lot([e], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(e.id)).toBe(0);
    }

    async function accepte(e: EcritureEnvoyee): Promise<void> {
      expect(await lot([e], theo.jeton)).toEqual({ refus: [] });
      expect(await evenements(e.id)).toBe(1);
    }

    it('note : 4 000 caractères acceptés, 4 001 refusés', async () => {
      await accepte(putRecolte(theo.id, ferme, 1, { note: 'n'.repeat(4_000) }));
      await refuse(putRecolte(theo.id, ferme, 1, { note: 'n'.repeat(4_001) }));
    });

    it('photos : 20 acceptées, 21 refusées ; une photo de 2 000 caractères acceptée, de 2 001 refusée', async () => {
      const photo = (i: number) => `https://photos.planif.test/${String(i)}.jpg`;
      await accepte(putRecolte(theo.id, ferme, 1, { photos: JSON.stringify(Array.from({ length: 20 }, (_, i) => photo(i))) }));
      await refuse(putRecolte(theo.id, ferme, 1, { photos: JSON.stringify(Array.from({ length: 21 }, (_, i) => photo(i))) }));
      await accepte(putRecolte(theo.id, ferme, 1, { photos: JSON.stringify(['p'.repeat(2_000)]) }));
      await refuse(putRecolte(theo.id, ferme, 1, { photos: JSON.stringify(['p'.repeat(2_001)]) }));
    });

    it('detail : sous 8 Kio accepté, au-delà de 8 Kio refusé', async () => {
      await accepte(putEvenement(theo.id, ferme, 'recolte', { quantite: 1, unite: 'kg', categorie: 'c'.repeat(8_000) }));
      await refuse(putEvenement(theo.id, ferme, 'recolte', { quantite: 1, unite: 'kg', categorie: 'c'.repeat(8_300) }));
    });

    it.each([
      ['recolte', { quantite: 1, unite: 'kg', categorie: null, pirate: 1 }],
      ['observation', { nature: 'ravageur', gravite: null, serieId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50' }],
      ['irrigation', { secteurIrrigationId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50', dureeMinutes: 30, commentaire: 'x' }],
    ])('clé inconnue dans le détail d’un événement %s : ecriture_invalide', async (type, detail) => {
      await refuse(putEvenement(theo.id, ferme, type, detail));
    });

    it('lot de 500 écritures : traité ; de 501 : 400 requete_invalide, rien d’écrit', async () => {
      const u = await nouveauMembre();
      const cinqCents = Array.from({ length: 500 }, () => putRecolte(u.id, ferme, 1));
      const res500 = await envoyer({ ecritures: cinqCents }, u.jeton);
      expect(res500.status).toBe(200);

      const cinqCentUn = Array.from({ length: 501 }, () => putRecolte(u.id, ferme, 1));
      const res501 = await envoyer({ ecritures: cinqCentUn }, u.jeton);
      expect(res501.status).toBe(400);
      expect(await res501.json()).toEqual({ erreur: 'requete_invalide' });
      const ids = cinqCentUn.map((e) => e.id);
      expect(await compter(`SELECT 1 FROM evenement WHERE id = ANY($1::uuid[])`, [ids])).toBe(0);
      expect(await refusDeLUtilisateur(u.id)).toBe(0);
    }, 60_000);

    it('corps de plus de 5 Mio : 413, rien d’écrit', async () => {
      const u = await nouveauMembre();
      const e = putRecolte(u.id, ferme, 1, { note: 'x'.repeat(5 * 1_048_576 + 1_000) });
      const res = await envoyer({ ecritures: [e] }, u.jeton);
      expect(res.status).toBe(413);
      expect(await evenements(e.id)).toBe(0);
      expect(await refusDeLUtilisateur(u.id)).toBe(0);
    });

    it('donnees de plus de 16 Kio : refus enregistré sans elles (donnees nulle) ; en dessous, gardées', async () => {
      const u = await nouveauMembre();
      const petit: EcritureEnvoyee = { op: 'PUT', table: 'membre', id: nouvelId<'Evenement'>(), donnees: { role: 'gerant' } };
      const gros: EcritureEnvoyee = { op: 'PUT', table: 'membre', id: nouvelId<'Evenement'>(), donnees: { role: 'g'.repeat(17_000) } };
      const reponse = await lot([petit, gros], u.jeton);
      expect(reponse.refus.map((r) => r.motif)).toEqual(['table_interdite', 'table_interdite']);
      expect(await refusEnregistre(petit.id)).toMatchObject({ donnees: { role: 'gerant' } });
      expect(await refusEnregistre(gros.id)).toMatchObject({ motif: 'table_interdite', donnees: null });
    });
  });

  describe('M1 : refus ferme_interdite d’un non-membre', () => {
    it('DELETE par un non-membre d’un événement d’une autre ferme : ferme_id nul dans le refus', async () => {
      const e = putRecolte(theo.id, ferme, 9);
      expect(await lot([e], theo.jeton)).toEqual({ refus: [] });
      const reponse = await lot([{ op: 'DELETE', table: 'evenement', id: e.id }], voisin.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ferme_interdite' }]);
      const r = await base.pool.query<{ ferme_id: string | null }>(
        `SELECT ferme_id FROM refus_synchro WHERE ligne_id = $1 AND utilisateur_id = $2`,
        [e.id, voisin.id],
      );
      expect(r.rows).toEqual([{ ferme_id: null }]);
    });
  });

  describe('M2 : pas de refus en double', () => {
    it('le même lot avec des écritures refusées, envoyé deux fois : une seule ligne refus_synchro par (utilisateur, ligne, opération, motif)', async () => {
      const u = await nouveauMembre();
      const origine = putRecolte(u.id, ferme, 4);
      expect(await lot([origine], u.jeton)).toEqual({ refus: [] });
      const ecritures: EcritureEnvoyee[] = [
        { op: 'PATCH', table: 'evenement', id: origine.id, donnees: { note: 'modifiée' } },
        { op: 'DELETE', table: 'evenement', id: origine.id },
        putRecolte(u.id, ferme, -1),
        { op: 'PUT', table: 'membre', id: nouvelId<'Evenement'>(), donnees: { role: 'gerant' } },
      ];
      const premier = await lot(ecritures, u.jeton);
      const second = await lot(ecritures, u.jeton);
      expect(premier.refus).toHaveLength(4);
      expect(second.refus).toEqual(premier.refus);
      expect(await refusDeLUtilisateur(u.id)).toBe(4);
      const doublons = await compter(
        `SELECT 1 FROM refus_synchro WHERE utilisateur_id = $1 GROUP BY ligne_id, operation, motif HAVING count(*) > 1`,
        [u.id],
      );
      expect(doublons).toBe(0);
    });
  });

  describe('M7 : dates plausibles', () => {
    it.each([
      ['date', '1999-12-31'],
      ['date', '2101-01-01'],
      ['horodatage', '1999-12-31T23:59:59.999Z'],
      ['horodatage', '2101-01-01T00:00:00.000Z'],
    ])('%s %s : ecriture_invalide', async (champ, valeur) => {
      const e = putRecolte(theo.id, ferme, 1, { [champ]: valeur });
      const reponse = await lot([e], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(e.id)).toBe(0);
    });

    it.each([
      ['date', '2000-01-01'],
      ['date', '2100-12-31'],
      ['horodatage', '2000-01-01T00:00:00.000Z'],
      ['horodatage', '2100-12-31T23:59:59.999Z'],
    ])('%s %s (borne) : acceptée', async (champ, valeur) => {
      const e = putRecolte(theo.id, ferme, 1, { [champ]: valeur });
      expect(await lot([e], theo.jeton)).toEqual({ refus: [] });
      expect(await evenements(e.id)).toBe(1);
    });
  });
  // --- 2e relecture (voir l'en-tête : R1, R2, R4) ------------------------------------------------

  /** Envoie un corps déjà sérialisé (JSON.stringify ne sait pas écrire 50 000 niveaux). */
  function envoyerTexte(texte: string, jeton: string): Promise<Response> {
    return Promise.resolve(
      app.request('/sync/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
        body: texte,
      }),
    );
  }

  describe('R1 : emplacement_ids bornés et sans doublon', () => {
    /** 201 emplacements de la ferme principale, créés d'un coup. */
    let emplacements: string[];

    beforeAll(async () => {
      const zone = nouvelId<'Zone'>();
      await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel R1', 'tunnel')`, [zone, ferme]);
      emplacements = Array.from({ length: 201 }, () => nouvelId<'Emplacement'>());
      await base.pool.query(
        `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du)
         SELECT e.id, $2, $3, 'R1-' || e.n, 'planche', 30, '2026-01-01'
         FROM unnest($1::uuid[]) WITH ORDINALITY AS e(id, n)`,
        [emplacements, ferme, zone],
      );
    });

    it('200 emplacements valides : acceptés ; 201 : ecriture_invalide, rien d’écrit', async () => {
      const deuxCents = putRecolte(theo.id, ferme, 1, { emplacement_ids: JSON.stringify(emplacements.slice(0, 200)) });
      expect(await lot([deuxCents], theo.jeton)).toEqual({ refus: [] });
      expect(await evenements(deuxCents.id)).toBe(1);

      const deuxCentUn = putRecolte(theo.id, ferme, 1, { emplacement_ids: JSON.stringify(emplacements) });
      const reponse = await lot([deuxCentUn], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: deuxCentUn.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(deuxCentUn.id)).toBe(0);
    });

    it('70 000 UUID distincts (corps < 5 Mio) : 200 avec un refus, jamais 500 ; le lot renvoyé : 200, sans refus en double', async () => {
      const u = await nouveauMembre();
      const ids = Array.from({ length: 70_000 }, () => crypto.randomUUID());
      const piege = putRecolte(u.id, ferme, 1, { emplacement_ids: JSON.stringify(ids) });
      const bonne = putRecolte(u.id, ferme, 2);
      const corps = JSON.stringify({ ecritures: [piege, bonne] });
      expect(new TextEncoder().encode(corps).length).toBeLessThan(5 * 1_048_576);
      for (let envoi = 0; envoi < 2; envoi++) {
        const res = await envoyerTexte(corps, u.jeton);
        expect(res.status, `envoi ${String(envoi + 1)}`).toBe(200);
        expect(((await res.json()) as ReponseUpload).refus).toEqual([{ table: 'evenement', id: piege.id, motif: 'ecriture_invalide' }]);
      }
      expect(await evenements(piege.id)).toBe(0);
      expect(await evenements(bonne.id)).toBe(1);
      expect(await refusDeLUtilisateur(u.id)).toBe(1);
    }, 60_000);

    it.each([
      ['le même id deux fois', (e: string) => [e, e]],
      ['le même id à la casse près [e, E, e]', (e: string) => [e, e.toUpperCase(), e]],
    ])('doublon dans emplacement_ids (%s) : ecriture_invalide, rien d’écrit', async (_cas, liste) => {
      const e = emplacements[0] ?? '';
      const doublon = putRecolte(theo.id, ferme, 1, { emplacement_ids: JSON.stringify(liste(e)) });
      const reponse = await lot([doublon], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: doublon.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(doublon.id)).toBe(0);
      expect(await modifications(doublon.id)).toBe(0);
    });
  });

  describe('R2 : JSON très imbriqué, jamais 500', () => {
    const NIVEAUX = 50_000;
    const imbrique = `${'{"a":'.repeat(NIVEAUX)}1${'}'.repeat(NIVEAUX)}`;

    it('donnees imbriquées sur 50 000 niveaux (table interdite) : 200, refus enregistré avec donnees NULL ; le lot sain suivant passe', async () => {
      const u = await nouveauMembre();
      const id = nouvelId<'Evenement'>();
      const corps = `{"ecritures":[{"op":"PUT","table":"membre","id":"${id}","donnees":${imbrique}}]}`;
      const res = await envoyerTexte(corps, u.jeton);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ReponseUpload).refus).toEqual([{ table: 'membre', id, motif: 'table_interdite' }]);
      expect(await refusEnregistre(id)).toMatchObject({ utilisateur_id: u.id, motif: 'table_interdite', donnees: null });

      const saine = putRecolte(u.id, ferme, 3);
      expect(await lot([saine], u.jeton)).toEqual({ refus: [] });
      expect(await evenements(saine.id)).toBe(1);
    });

    it('detail (texte JSON) imbriqué sur 50 000 niveaux : 200, ecriture_invalide ; le lot sain suivant passe', async () => {
      const u = await nouveauMembre();
      const piege = putRecolte(u.id, ferme, 1, { detail: imbrique });
      const res = await envoyer({ ecritures: [piege] }, u.jeton);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ReponseUpload).refus).toEqual([{ table: 'evenement', id: piege.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(piege.id)).toBe(0);
      expect(await refusDeLUtilisateur(u.id)).toBe(1);

      const saine = putRecolte(u.id, ferme, 3);
      expect(await lot([saine], u.jeton)).toEqual({ refus: [] });
      expect(await evenements(saine.id)).toBe(1);
    });
  });

  describe('R4 : référence vers une ligne supprimée (supprime_le)', () => {
    /** Lignes de la ferme principale, toutes marquées supprimées. */
    let supprimees: LignesDeFerme;
    let phytoBibliothequeSupprime: string;

    beforeAll(async () => {
      supprimees = await peuplerFerme(base.pool, ferme);
      phytoBibliothequeSupprime = await creerProduitPhytoBibliotheque(base.pool);
      const moment = new Date('2026-09-30T10:00:00Z');
      for (const [table, id] of [
        ['serie', supprimees.serie],
        ['campagne', supprimees.campagne],
        ['emplacement', supprimees.emplacement],
        ['secteur_irrigation', supprimees.secteurIrrigation],
        ['produit_phyto', supprimees.produitPhyto],
        ['produit_phyto', phytoBibliothequeSupprime],
      ] as const) {
        await base.pool.query(`UPDATE ${table} SET supprime_le = $2 WHERE id = $1`, [id, moment]);
      }
    });

    it.each([
      ['serie_id', () => ({ serie_id: supprimees.serie })],
      ['campagne_id', () => ({ campagne_id: supprimees.campagne })],
      ['un des emplacement_ids', () => ({ emplacement_ids: JSON.stringify([supprimees.emplacement]) })],
      ['detail.secteurIrrigationId', () => ({ type: 'irrigation', detail: JSON.stringify(irrigation(supprimees.secteurIrrigation)) })],
      ['detail.produitPhytoId (produit de la ferme)', () => ({ type: 'traitement', detail: JSON.stringify(traitement(supprimees.produitPhyto)) })],
      [
        'detail.produitPhytoId (produit de la bibliothèque)',
        () => ({ type: 'traitement', detail: JSON.stringify(traitement(phytoBibliothequeSupprime)) }),
      ],
    ])('%s supprimé : ecriture_invalide, rien d’écrit, 200, le reste du lot passe', async (_cas, champs) => {
      const mauvaise = putRecolte(theo.id, ferme, 1, champs());
      const bonne = putRecolte(theo.id, ferme, 2);
      const reponse = await lot([mauvaise, bonne], theo.jeton);
      expect(reponse.refus).toEqual([{ table: 'evenement', id: mauvaise.id, motif: 'ecriture_invalide' }]);
      expect(await evenements(mauvaise.id)).toBe(0);
      expect(await modifications(mauvaise.id)).toBe(0);
      expect(await evenements(bonne.id)).toBe(1);
    });
  });
});
