/**
 * Tests d'acceptation T10v — refus de synchro : pas de nom de culture d'une autre ferme dans le
 * résumé, même pour une écriture forgée (docs/backlog/T10v-resume-refus-hors-ferme.md, Q25),
 * contre un vrai Postgres.
 *
 * Exécution : comme T10k (DATABASE_URL ; base jetable `t10v_hors_ferme_…` supprimée à la fin ;
 * sans DATABASE_URL, échec en CI et saut signalé en local). Les refus sont PRODUITS pour de vrai :
 * chaque scénario envoie un lot à POST /sync/upload, puis lit la ligne de refus_synchro écrite.
 *
 * ── Contrat (proposé par le testeur) ────────────────────────────────────────────────────────
 *
 * « Ferme du refus » : la colonne ferme_id de la ligne de refus_synchro écrite (après le filtre
 * des fermes de l'utilisateur, M1). « Ferme de l'événement » : ferme_id des données reçues
 * (fermeDesDonnees, UUID insensible à la casse).
 *
 *   saisie_culture n'est renseignée QUE si la ferme du refus est non nulle, égale à la ferme de
 *   l'événement, que l'utilisateur en est membre accepté au moment du lot, et que la série (ou la
 *   campagne) désignée appartient à cette ferme (règles T10k inchangées). Sinon NULL.
 *
 * Conséquences vérifiées ici, pour un utilisateur membre accepté de A ET de B :
 *   1. PATCH ou DELETE forgé sur evenement (refus 'ajout_seul'), données { ferme_id: B,
 *      serie_id ou campagne_id de B } :
 *        - id inexistant → refus sans ferme, culture NULL ;
 *        - ligne de A → refus rangé sous A, culture NULL ;
 *        - ligne d'une ferme dont il n'est pas membre → refus sans ferme, culture NULL ;
 *      et, symétrique, ligne de B avec { ferme_id: A, série de A } → refus sous B, culture NULL.
 *      Aucune colonne de la ligne de refus (données reçues comprises) ne contient un nom de
 *      culture de l'autre ferme ; type, date, quantité et unité du résumé restent remplis.
 *   2. Témoins (inchangés) : PATCH/DELETE sur une ligne de B avec { ferme_id: B, série de B }
 *      → refus sous B, culture de B (ferme_id reçu en majuscules compris) ; un PATCH sans ferme_id
 *      (ce qu'envoie PowerSync : seules les colonnes changées) → culture NULL.
 *   3. PUT : 'ajout_seul' (id existant réécrit) range le refus sous la ferme des données, qui
 *      garde sa culture ; 'ferme_interdite' → culture NULL ; 'ecriture_invalide' → culture de la
 *      ferme déclarée si la série en est, NULL sinon.
 *   4. Lot tout ou rien (avec une écriture du parcellaire) qui contient le PATCH forgé : même règle
 *      pour chaque refus du lot.
 *   5. Invité pas encore accepté dans B : culture NULL.
 *   6. Après retrait de l'adhésion à B : les refus qui lui descendent encore (sans ferme, ferme A ;
 *      même requête que le flux refus_synchro de powersync/sync-config.yaml) ne contiennent rien
 *      de B ; un PATCH forgé après le retrait non plus.
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

/** Cultures de la ferme B : jamais dans un refus qui n'est pas rangé sous B. */
const ESPECE_B = 'Fraise Mara des bois';
const VARIETE_B = 'Gariguette secrète';
const ESPECE_PERENNE_B = 'Asperge Argenteuil';
const SECRETS_B = /Fraise|Mara des bois|Gariguette|Asperge|Argenteuil/;
/** Cultures de la ferme A (« Laitue Batavia blonde », « Kiwi »). */
const VARIETE_A = 'Batavia blonde';
const SECRETS_A = /Laitue|Batavia|Kiwi/;

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: unknown;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

interface LigneRefus {
  readonly ferme_id: string | null;
  readonly motif: string;
  readonly saisie_type: string | null;
  readonly saisie_culture: string | null;
  readonly saisie_date: string | null;
  readonly saisie_quantite: number | null;
  readonly saisie_unite: string | null;
  /** La ligne entière (données reçues comprises), en texte. */
  readonly tout: string;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10v')('T10v : aucun nom de culture d’une autre ferme dans un refus', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Membre accepté de A et de B. */
  const theo = { id: '', jeton: '' };
  /** Membre de la ferme voisine seulement (pour y créer un événement). */
  const voisin = { id: '', jeton: '' };
  /** Membre de A, invité (pas encore accepté) dans B. */
  const invite = { id: '', jeton: '' };
  /** Membre de A et de B, retiré de B au dernier bloc. */
  const partant = { id: '', jeton: '' };
  let fermeA: string;
  let fermeB: string;
  let voisine: string;
  let a: LignesDeFerme;
  let b: LignesDeFerme;
  let v: LignesDeFerme;

  beforeAll(async () => {
    base = await creerBaseJetable('t10v_hors_ferme');
    cles = { active: await genererCleSignature('cle-t10v'), precedentes: [] };
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
    for (const g of [theo, voisin, invite, partant]) {
      g.id = (await creerUtilisateur(base.pool)).id;
      g.jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, g.id, MAINTENANT);
    }
    await ajouterMembre(base.pool, theo.id, fermeA, { role: 'gerant' });
    await ajouterMembre(base.pool, theo.id, fermeB, { role: 'gerant' });
    await ajouterMembre(base.pool, voisin.id, voisine, { role: 'gerant' });
    await ajouterMembre(base.pool, invite.id, fermeA);
    await ajouterMembre(base.pool, invite.id, fermeB, { etat: 'invite', invitePar: theo.id });
    await ajouterMembre(base.pool, partant.id, fermeA);
    await ajouterMembre(base.pool, partant.id, fermeB);

    // Ferme A : « Laitue Batavia blonde » (série), « Kiwi » (campagne).
    a = await peuplerFerme(base.pool, fermeA);
    const varieteA = randomUUID();
    await base.pool.query(
      `INSERT INTO variete (id, ferme_id, espece_id, nom) SELECT $1, ferme_id, espece_id, $3 FROM serie WHERE id = $2`,
      [varieteA, a.serie, VARIETE_A],
    );
    await base.pool.query(`UPDATE serie SET variete_id = $1 WHERE id = $2`, [varieteA, a.serie]);

    // Ferme B : « Fraise Mara des bois Gariguette secrète » (série), « Asperge Argenteuil » (campagne).
    b = await peuplerFerme(base.pool, fermeB);
    const varieteB = randomUUID();
    await base.pool.query(
      `INSERT INTO variete (id, ferme_id, espece_id, nom) SELECT $1, ferme_id, espece_id, $3 FROM serie WHERE id = $2`,
      [varieteB, b.serie, VARIETE_B],
    );
    await base.pool.query(`UPDATE serie SET variete_id = $1 WHERE id = $2`, [varieteB, b.serie]);
    await base.pool.query(`UPDATE espece SET nom = $1 WHERE id = (SELECT espece_id FROM serie WHERE id = $2)`, [ESPECE_B, b.serie]);
    await base.pool.query(
      `UPDATE espece SET nom = $1 WHERE id = (SELECT p.espece_id FROM campagne c JOIN plantation p ON p.id = c.plantation_id WHERE c.id = $2)`,
      [ESPECE_PERENNE_B, b.campagne],
    );

    v = await peuplerFerme(base.pool, voisine);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton = theo.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status, 'un refus n’est jamais un 500').toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Envoie `e` seule et vérifie qu'elle est refusée avec le motif `motif`. */
  async function refusee(e: EcritureEnvoyee, motif: string, jeton = theo.jeton): Promise<void> {
    const r = await lot([e], jeton);
    expect(r.refus.find((x) => x.id === e.id)?.motif, `refus de ${e.op} ${e.id}`).toBe(motif);
  }

  /** Le refus enregistré pour (ligne `id`, opération `op`) : exactement un. */
  async function refusDe(id: string, op: EcritureEnvoyee['op']): Promise<LigneRefus> {
    const r = await base.pool.query<LigneRefus>(
      `SELECT ferme_id::text AS ferme_id, motif, saisie_type, saisie_culture, saisie_date::text AS saisie_date,
              saisie_quantite::float8 AS saisie_quantite, saisie_unite, to_jsonb(r)::text AS tout
       FROM refus_synchro r WHERE ligne_id = $1 AND operation = $2`,
      [id, op],
    );
    expect(r.rows, `un refus enregistré pour ${op} ${id}`).toHaveLength(1);
    const l = r.rows[0];
    if (l === undefined) throw new Error('refus absent');
    return l;
  }

  function donneesEvenement(ferme: string, auteur: string, autres: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ferme_id: ferme,
      type: 'recolte',
      date: '2026-10-01',
      horodatage: '2026-10-01T03:00:00.000Z',
      auteur_id: auteur,
      source: 'tap',
      serie_id: null,
      campagne_id: null,
      emplacement_ids: '[]',
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify({ quantite: 12, unite: 'kg', categorie: null }),
      ...autres,
    };
  }

  /** Un événement accepté (récolte de la série `serie`) dans `ferme`, écrit par `g` : son id. */
  async function evenementExistant(ferme: string, serie: string, g = theo): Promise<string> {
    const id = nouvelId<'Evenement'>();
    const r = await lot([{ op: 'PUT', table: 'evenement', id, donnees: donneesEvenement(ferme, g.id, { serie_id: serie }) }], g.jeton);
    expect(r, 'événement de départ accepté').toEqual({ refus: [] });
    return id;
  }

  /** Données d'un PATCH/DELETE forgé : une récolte de 7 kg du 20 septembre, déclarée en `ferme`. */
  function forgees(ferme: string, designation: { serie_id?: string; campagne_id?: string }): Record<string, unknown> {
    return {
      ferme_id: ferme,
      type: 'recolte',
      date: '2026-09-20',
      detail: JSON.stringify({ quantite: 7, unite: 'kg', categorie: null }),
      ...designation,
    };
  }

  /** Le résumé hors culture est celui de `forgees` : type, date, quantité et unité inchangés. */
  function resteDuResumeIntact(r: LigneRefus): void {
    expect(r.saisie_type).toBe('recolte');
    expect(r.saisie_date).toBe('2026-09-20');
    expect(r.saisie_quantite).toBe(7);
    expect(r.saisie_unite).toBe('kg');
  }

  // ── 1. PATCH / DELETE forgés : la ferme du refus n'est pas celle des données ─────────────────

  describe('PATCH ou DELETE forgé qui déclare la ferme B (membre de A et de B)', () => {
    const designations = [
      ['série de B', (): { serie_id: string } => ({ serie_id: b.serie })],
      ['campagne de B', (): { campagne_id: string } => ({ campagne_id: b.campagne })],
    ] as const;

    describe.each(['PATCH', 'DELETE'] as const)('%s', (op) => {
      it.each(designations)('id inexistant, %s → refus sans ferme, culture NULL', async (_nom, designation) => {
        const e: EcritureEnvoyee = { op, table: 'evenement', id: nouvelId<'Evenement'>(), donnees: forgees(fermeB, designation()) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(e.id, op);
        expect(r.ferme_id, 'ligne inexistante : refus sans ferme').toBeNull();
        resteDuResumeIntact(r);
        expect(r.saisie_culture, 'refus sans ferme : aucune culture de B').toBeNull();
        expect(r.tout, 'aucun nom de culture de B dans la ligne de refus').not.toMatch(SECRETS_B);
      });

      it.each(designations)('ligne de la ferme A, %s → refus rangé sous A, culture NULL', async (_nom, designation) => {
        const id = await evenementExistant(fermeA, a.serie);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeB, designation()) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id, 'la ferme du refus est celle de la ligne').toBe(fermeA);
        resteDuResumeIntact(r);
        expect(r.saisie_culture, 'refus de A : aucune culture de B').toBeNull();
        expect(r.tout, 'aucun nom de culture de B dans la ligne de refus').not.toMatch(SECRETS_B);
      });

      it('ligne d’une ferme dont il n’est pas membre, série de B → refus sans ferme, culture NULL', async () => {
        const id = await evenementExistant(voisine, v.serie, voisin);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeB, { serie_id: b.serie }) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id, 'ligne d’une autre ferme : comme un id inexistant').toBeNull();
        resteDuResumeIntact(r);
        expect(r.saisie_culture).toBeNull();
        expect(r.tout).not.toMatch(SECRETS_B);
      });

      it('symétrique : ligne de B, données déclarées en A avec la série de A → refus sous B, culture NULL', async () => {
        const id = await evenementExistant(fermeB, b.serie);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeA, { serie_id: a.serie }) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id).toBe(fermeB);
        resteDuResumeIntact(r);
        expect(r.saisie_culture, 'refus de B : aucune culture de A').toBeNull();
        expect(r.tout, 'aucun nom de culture de A dans un refus de B').not.toMatch(SECRETS_A);
      });

      // ── Témoins : la ferme du refus est celle de l'événement ───────────────────────────────

      it('témoin : ligne de B, données déclarées en B avec la série de B → refus sous B, culture de B', async () => {
        const id = await evenementExistant(fermeB, b.serie);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeB, { serie_id: b.serie }) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id).toBe(fermeB);
        resteDuResumeIntact(r);
        expect(r.saisie_culture, 'écriture de B : sa culture reste').toContain(ESPECE_B);
        expect(r.saisie_culture).toContain(VARIETE_B);
      });

      it('témoin : ligne de A, données déclarées en A (ferme_id en majuscules) avec la campagne de A → culture de A', async () => {
        const id = await evenementExistant(fermeA, a.serie);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeA.toUpperCase(), { campagne_id: a.campagne.toUpperCase() }) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id).toBe(fermeA);
        expect(r.saisie_culture, 'UUID insensible à la casse').toContain('Kiwi');
      });

      it('témoin : ligne de A, déclarée en A mais série de B → culture NULL (règle T10k)', async () => {
        const id = await evenementExistant(fermeA, a.serie);
        const e: EcritureEnvoyee = { op, table: 'evenement', id, donnees: forgees(fermeA, { serie_id: b.serie }) };
        await refusee(e, 'ajout_seul');
        const r = await refusDe(id, op);
        expect(r.ferme_id).toBe(fermeA);
        expect(r.saisie_culture).toBeNull();
        expect(r.tout).not.toMatch(SECRETS_B);
      });
    });

    it('PATCH tel que PowerSync l’envoie (colonnes changées, sans ferme_id) sur une ligne de B → culture NULL', async () => {
      const id = await evenementExistant(fermeB, b.serie);
      const e: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id, donnees: { serie_id: b.serie, date: '2026-09-20' } };
      await refusee(e, 'ajout_seul');
      const r = await refusDe(id, 'PATCH');
      expect(r.ferme_id).toBe(fermeB);
      expect(r.saisie_culture, 'pas de ferme déclarée : pas de culture').toBeNull();
      expect(r.saisie_date).toBe('2026-09-20');
    });
  });

  // ── 2. PUT : la ferme du refus est déjà celle des données ───────────────────────────────────

  describe('PUT', () => {
    it('ajout_seul : id d’un événement de A réécrit en B avec la série de B → refus sous B, culture de B', async () => {
      const id = await evenementExistant(fermeA, a.serie);
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id, donnees: donneesEvenement(fermeB, theo.id, { serie_id: b.serie }) };
      await refusee(e, 'ajout_seul');
      const r = await refusDe(id, 'PUT');
      expect(r.ferme_id).toBe(fermeB);
      expect(r.saisie_culture).toContain(ESPECE_B);
      expect(r.tout, 'rien de A').not.toMatch(SECRETS_A);
    });

    it('ferme_interdite : déclarée dans la ferme voisine avec la série de B → refus sans ferme, culture NULL', async () => {
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: donneesEvenement(voisine, theo.id, { serie_id: b.serie }) };
      await refusee(e, 'ferme_interdite');
      const r = await refusDe(e.id, 'PUT');
      expect(r.ferme_id).toBeNull();
      expect(r.saisie_culture).toBeNull();
      expect(r.tout).not.toMatch(SECRETS_B);
    });

    it('ecriture_invalide : déclarée en B avec la série de B, jour impossible → refus sous B, culture de B', async () => {
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: donneesEvenement(fermeB, theo.id, { serie_id: b.serie, date: '2026-02-30' }) };
      await refusee(e, 'ecriture_invalide');
      const r = await refusDe(e.id, 'PUT');
      expect(r.ferme_id).toBe(fermeB);
      expect(r.saisie_culture).toContain(ESPECE_B);
    });

    it('ecriture_invalide : déclarée en A avec la série de B → refus sous A, culture NULL', async () => {
      const e: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: donneesEvenement(fermeA, theo.id, { serie_id: b.serie }) };
      await refusee(e, 'ecriture_invalide');
      const r = await refusDe(e.id, 'PUT');
      expect(r.ferme_id).toBe(fermeA);
      expect(r.saisie_culture).toBeNull();
      expect(r.tout).not.toMatch(SECRETS_B);
    });
  });

  // ── 3. Lot tout ou rien : chaque refus du lot suit la même règle ────────────────────────────

  describe('lot tout ou rien', () => {
    it('zone de A + PATCH forgé (ligne de A, déclaré en B) + récolte de B : aucune culture de B sous A, la récolte de B garde la sienne', async () => {
      const ligneA = await evenementExistant(fermeA, a.serie);
      const zone: EcritureEnvoyee = {
        op: 'PUT',
        table: 'zone',
        id: nouvelId<'Zone'>(),
        donnees: { ferme_id: fermeA, nom: 'Tunnel 9', zone_parente_id: null, type_abri: 'tunnel', surface_m2: null },
      };
      const patch: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id: ligneA, donnees: forgees(fermeB, { serie_id: b.serie }) };
      const recolteB: EcritureEnvoyee = { op: 'PUT', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: donneesEvenement(fermeB, theo.id, { serie_id: b.serie }) };
      const r = await lot([zone, patch, recolteB]);
      expect(r.refus.map((x) => x.id).sort(), 'tout le lot est refusé').toEqual([zone.id, patch.id, recolteB.id].sort());

      const duPatch = await refusDe(ligneA, 'PATCH');
      expect(duPatch.motif).toBe('ajout_seul');
      expect(duPatch.ferme_id).toBe(fermeA);
      resteDuResumeIntact(duPatch);
      expect(duPatch.saisie_culture, 'refus de A : aucune culture de B').toBeNull();
      expect(duPatch.tout).not.toMatch(SECRETS_B);

      const deB = await refusDe(recolteB.id, 'PUT');
      expect(deB.ferme_id).toBe(fermeB);
      expect(deB.saisie_culture, 'témoin : refus de B, culture de B').toContain(ESPECE_B);
    });
  });

  // ── 4. Invité pas encore accepté dans B ─────────────────────────────────────────────────────

  describe('invité pas encore accepté dans B', () => {
    it('PATCH forgé sur une ligne de A déclaré en B : refus sous A, culture NULL', async () => {
      const id = await evenementExistant(fermeA, a.serie, invite);
      const e: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id, donnees: forgees(fermeB, { serie_id: b.serie }) };
      await refusee(e, 'ajout_seul', invite.jeton);
      const r = await refusDe(id, 'PATCH');
      expect(r.ferme_id).toBe(fermeA);
      expect(r.saisie_culture).toBeNull();
      expect(r.tout).not.toMatch(SECRETS_B);
    });
  });

  // ── 5. Après le retrait de l'adhésion à B : rien de B ne descend plus ───────────────────────

  describe('après le retrait de l’adhésion à B', () => {
    /**
     * Les refus de `utilisateur` qui lui descendent, colonnes du flux refus_synchro de
     * powersync/sync-config.yaml (même filtre : sans ferme, ou ferme active de l'utilisateur).
     * Contre le vrai service PowerSync : refus-ferme-quittee.integration.test.ts (T10u).
     */
    async function ceQuiDescend(utilisateur: string): Promise<{ id: string; ligne_id: string; ferme_id: string | null; texte: string }[]> {
      const r = await base.pool.query<{ id: string; ligne_id: string; ferme_id: string | null; texte: string }>(
        `SELECT r.id::text AS id, r.ligne_id, r.ferme_id::text AS ferme_id,
                json_build_array(r.id, r.utilisateur_id, r.ferme_id, r.nom_table, r.ligne_id, r.operation, r.motif, r.message, r.cree_le,
                                 r.saisie_type, r.saisie_culture, r.saisie_date, r.saisie_quantite, r.saisie_unite, r.archive_le)::text AS texte
         FROM refus_synchro r
         WHERE r.utilisateur_id = $1
           AND (r.ferme_id IS NULL OR r.ferme_id IN (
             SELECT m.ferme_id FROM membre m
             JOIN ferme f ON f.id = m.ferme_id
             JOIN utilisateur u ON u.id = m.utilisateur_id
             WHERE m.utilisateur_id = $1 AND m.etat = 'accepte' AND m.supprime_le IS NULL AND f.supprime_le IS NULL AND u.supprime_le IS NULL))`,
        [utilisateur],
      );
      return r.rows;
    }

    it('les refus sans ferme et de A qui restent sur son téléphone ne contiennent rien de B', async () => {
      // Pendant qu'il est membre de A et de B : deux écritures forgées et un refus légitime de B.
      const inexistant: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id: nouvelId<'Evenement'>(), donnees: forgees(fermeB, { serie_id: b.serie }) };
      await refusee(inexistant, 'ajout_seul', partant.jeton);
      const ligneA = await evenementExistant(fermeA, a.serie, partant);
      const surA: EcritureEnvoyee = { op: 'DELETE', table: 'evenement', id: ligneA, donnees: forgees(fermeB, { campagne_id: b.campagne }) };
      await refusee(surA, 'ajout_seul', partant.jeton);
      const legitimeB: EcritureEnvoyee = {
        op: 'PUT',
        table: 'evenement',
        id: nouvelId<'Evenement'>(),
        donnees: donneesEvenement(fermeB, theo.id, { serie_id: b.serie }),
      };
      await refusee(legitimeB, 'auteur_invalide', partant.jeton);
      const avant = await ceQuiDescend(partant.id);
      expect(avant.map((l) => l.ligne_id).sort(), 'témoin : membre de B, il reçoit ses trois refus').toEqual([inexistant.id, ligneA, legitimeB.id].sort());

      await base.pool.query(`UPDATE membre SET supprime_le = now() WHERE utilisateur_id = $1 AND ferme_id = $2`, [partant.id, fermeB]);

      // Après le retrait, une nouvelle écriture forgée qui déclare B.
      const apresRetrait: EcritureEnvoyee = { op: 'PATCH', table: 'evenement', id: ligneA, donnees: { ...forgees(fermeB, { serie_id: b.serie }), date: '2026-09-21' } };
      const rep = await lot([apresRetrait], partant.jeton);
      expect(rep.refus.find((x) => x.id === ligneA)?.motif).toBe('ajout_seul');

      const apres = await ceQuiDescend(partant.id);
      expect(apres.map((l) => l.ligne_id), 'le refus de B ne descend plus (T10u)').not.toContain(legitimeB.id);
      expect(apres.map((l) => l.ligne_id), 'les refus sans ferme et de A descendent toujours').toEqual(
        expect.arrayContaining([inexistant.id, ligneA]),
      );
      expect(apres.every((l) => l.ferme_id === null || l.ferme_id === fermeA)).toBe(true);
      for (const l of apres) expect(l.texte, `rien de B dans le refus ${l.ligne_id}`).not.toMatch(SECRETS_B);
    });
  });
});
