/**
 * Tests d'acceptation T10l — archiver un refus vu (docs/backlog/T10l-refus-archives.md), côté
 * serveur, contre un vrai Postgres.
 *
 * Exécution : comme T10 (DATABASE_URL ; base jetable `t10l_archiver_…` supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat (conçu par le chef d'équipe, précisé par le testeur) ────────────────────────────
 *
 * Colonne `refus_synchro.archive_le` (timestamptz, NULL par défaut ; migration 0024), synchronisée
 * vers le téléphone de l'auteur (archivés compris : powersync/sync-config.yaml, vérifié par
 * packages/sync/src/schema.test.ts). Le téléphone archive un refus par une écriture
 *
 *   { op: 'PATCH', table: 'refus_synchro', id: <id du refus>, donnees: { archive_le: <instant ISO> } }
 *
 * POST /sync/upload l'accepte (aucun refus dans la réponse) seulement si :
 *   - le refus `id` appartient à l'utilisateur du jeton (utilisateur_id), quelle que soit la casse
 *     de l'id envoyé ;
 *   - `donnees` ne porte QUE `archive_le`, un instant lisible (ISO 8601).
 * Alors `archive_le` prend cet instant ; aucune autre colonne ne bouge. Déjà archivé : la PREMIÈRE
 * date est gardée (décision du testeur), et le PATCH est accepté quand même (idempotent : la file
 * du téléphone avance, aucun refus créé).
 *
 * Sinon, refus métier (200, enregistré dans refus_synchro au nom de l'envoyeur, nom_table
 * 'refus_synchro', ligne_id = l'id visé), et RIEN n'est modifié :
 *   - refus d'un AUTRE utilisateur (même collègue de la même ferme, même en connaissant l'id), ou
 *     id inconnu : 'table_interdite', exactement la même réponse pour les deux (T10d : une ligne
 *     d'autrui se comporte comme une ligne inexistante) ;
 *   - une autre colonne que archive_le dans le PATCH (message, utilisateur_id, motif…) :
 *     'table_interdite' ;
 *   - PUT ou DELETE sur refus_synchro : 'table_interdite' (un refus ne se crée ni ne s'efface
 *     depuis le téléphone) ;
 *   - archive_le illisible ou nul : 'ecriture_invalide'.
 * Un archivage refusé renvoyé (file du téléphone) ne crée pas un second refus (contrainte
 * refus_synchro_sans_doublon) : pas de boucle. Refus_synchro n'est pas une table « tout ou
 * rien » : dans un même lot (« Tout archiver »), un archivage refusé ne bloque pas les autres.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const ARCHIVE_1 = '2026-10-01T05:30:00.000Z';
const ARCHIVE_2 = '2026-10-01T05:45:00.000Z';

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: unknown;
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

decrireAvecBase('T10l')('T10l : archiver un refus vu', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let theo: string;
  let collegue: string;
  let jetonTheo: string;
  let jetonCollegue: string;
  let fermeA: string;

  beforeAll(async () => {
    base = await creerBaseJetable('t10l_archiver');
    cles = { active: await genererCleSignature('cle-t10l'), precedentes: [] };
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
    theo = (await creerUtilisateur(base.pool)).id;
    collegue = (await creerUtilisateur(base.pool)).id;
    // Le collègue est membre de la MÊME ferme : être de la ferme ne donne aucun droit sur les refus d'autrui.
    await ajouterMembre(base.pool, theo, fermeA, { role: 'gerant' });
    await ajouterMembre(base.pool, collegue, fermeA);
    jetonTheo = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, theo, MAINTENANT);
    jetonCollegue = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, collegue, MAINTENANT);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Outils ─────────────────────────────────────────────────────────────────────────────────

  async function lot(jeton: string, ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status, 'un refus n’est jamais un 500 ni une 4xx (la file du téléphone avance)').toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  /** Un refus déjà enregistré pour `utilisateur` (comme le serveur l'aurait écrit). */
  async function refusExistant(utilisateur: string): Promise<string> {
    const id = nouvelId<'Evenement'>();
    await base.pool.query(
      `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, donnees, cree_le,
                                  saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite)
       VALUES ($1, $2, $3, 'evenement', $4, 'PUT', 'recolte_annulee', 'Cette récolte a été annulée.', '{"note":"x"}', $5,
               'recolte', 'Laitue', '2026-09-28', 12.5, 'kg')`,
      [id, utilisateur, fermeA, nouvelId<'Evenement'>(), new Date('2026-09-30T06:00:00Z')],
    );
    return id;
  }

  /** La ligne entière (en JSON, donnees comprises), pour vérifier que rien d'autre n'a bougé. */
  async function ligne(id: string): Promise<Record<string, unknown> | undefined> {
    const r = await base.pool.query<{ l: Record<string, unknown> }>(`SELECT to_jsonb(r) AS l FROM refus_synchro r WHERE id = $1`, [id]);
    return r.rows[0]?.l;
  }

  /** archive_le en ISO (null si non archivé ; null aussi tant que la colonne n'existe pas). */
  async function archiveLe(id: string): Promise<string | null> {
    const v = (await ligne(id))?.archive_le;
    return typeof v === 'string' ? new Date(v).toISOString() : null;
  }

  const sansArchive = (l: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (l === undefined) return undefined;
    return Object.fromEntries(Object.entries(l).filter(([c]) => c !== 'archive_le'));
  };

  /** Refus enregistrés au nom de `utilisateur` pour la ligne visée `ligneId`. */
  async function refusPour(utilisateur: string, ligneId: string): Promise<{ nom_table: string; operation: string; motif: string; ferme_id: string | null }[]> {
    const r = await base.pool.query<{ nom_table: string; operation: string; motif: string; ferme_id: string | null }>(
      `SELECT nom_table, operation, motif, ferme_id::text AS ferme_id FROM refus_synchro WHERE utilisateur_id = $1 AND lower(ligne_id) = lower($2)`,
      [utilisateur, ligneId],
    );
    return r.rows;
  }

  async function compterRefus(utilisateur: string): Promise<number> {
    const r = await base.pool.query<{ n: string }>(`SELECT count(*) AS n FROM refus_synchro WHERE utilisateur_id = $1`, [utilisateur]);
    return Number(r.rows[0]?.n ?? -1);
  }

  const archivage = (id: string, donnees: unknown = { archive_le: ARCHIVE_1 }): EcritureEnvoyee => ({ op: 'PATCH', table: 'refus_synchro', id, donnees });

  // ── 1. Archiver son propre refus ────────────────────────────────────────────────────────────

  describe('son propre refus', () => {
    it('PATCH { archive_le } : accepté, archive_le posé, rien d’autre ne bouge, aucun refus créé', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const refusAvant = await compterRefus(theo);

      const r = await lot(jetonTheo, [archivage(id)]);

      expect(r.refus, 'archivage accepté').toEqual([]);
      expect(await archiveLe(id)).toBe(ARCHIVE_1);
      expect(sansArchive(await ligne(id)), 'aucune autre colonne modifiée').toEqual(sansArchive(avant));
      expect(await compterRefus(theo), 'aucun refus créé, la ligne n’est pas supprimée').toBe(refusAvant);
    });

    it('id envoyé en majuscules : accepté de même', async () => {
      const id = await refusExistant(theo);
      const r = await lot(jetonTheo, [archivage(id.toUpperCase())]);
      expect(r.refus).toEqual([]);
      expect(await archiveLe(id)).toBe(ARCHIVE_1);
    });

    it('déjà archivé (autre téléphone, ou envoi rejoué) : accepté, la PREMIÈRE date est gardée, aucun refus', async () => {
      const id = await refusExistant(theo);
      expect((await lot(jetonTheo, [archivage(id, { archive_le: ARCHIVE_1 })])).refus).toEqual([]);
      const refusAvant = await compterRefus(theo);
      const r = await lot(jetonTheo, [archivage(id, { archive_le: ARCHIVE_2 })]);
      expect(r.refus, 'idempotent : la file avance sans refus').toEqual([]);
      expect(await archiveLe(id), 'première date gardée').toBe(ARCHIVE_1);
      expect(await compterRefus(theo)).toBe(refusAvant);
    });

    it('« Tout archiver » : un lot de plusieurs archivages, tous posés ; un refusé ne bloque pas les autres', async () => {
      const ids = [await refusExistant(theo), await refusExistant(theo), await refusExistant(theo)];
      const etranger = await refusExistant(collegue);
      const r = await lot(jetonTheo, [archivage(ids[0] ?? ''), archivage(etranger), archivage(ids[1] ?? ''), archivage(ids[2] ?? '')]);
      expect(r.refus.map((x) => x.id), 'seul l’archivage du refus d’autrui est refusé').toEqual([etranger]);
      for (const id of ids) expect(await archiveLe(id), id).toBe(ARCHIVE_1);
      expect(await archiveLe(etranger), 'le refus du collègue reste intact').toBeNull();
    });
  });

  // ── 2. Isolement : jamais le refus d'un autre ──────────────────────────────────────────────

  describe('isolement entre utilisateurs', () => {
    it('le collègue de la même ferme connaît l’id du refus de Théo : refusé, comme un id inconnu ; la ligne de Théo est intacte', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const inconnu = nouvelId<'Evenement'>();

      const r = await lot(jetonCollegue, [archivage(id)]);
      const rInconnu = await lot(jetonCollegue, [archivage(inconnu)]);

      expect(r.refus).toEqual([{ table: 'refus_synchro', id, motif: 'table_interdite' }]);
      expect(rInconnu.refus, 'même réponse qu’un id inexistant').toEqual([{ table: 'refus_synchro', id: inconnu, motif: 'table_interdite' }]);
      expect(await ligne(id), 'la ligne de Théo n’a pas bougé').toEqual(avant);
      expect(await archiveLe(id)).toBeNull();

      // Le refus de l'archivage est au nom du collègue, jamais rattaché à Théo, sans ferme.
      expect(await refusPour(collegue, id)).toEqual([{ nom_table: 'refus_synchro', operation: 'PATCH', motif: 'table_interdite', ferme_id: null }]);
      expect(await refusPour(theo, id), 'rien n’arrive chez Théo').toEqual([]);
    });

    it('id de Théo en majuscules, ou PATCH qui se réattribue le refus : toujours refusé', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const r1 = await lot(jetonCollegue, [archivage(id.toUpperCase())]);
      const r2 = await lot(jetonCollegue, [archivage(id, { archive_le: ARCHIVE_1, utilisateur_id: collegue })]);
      expect(r1.refus.map((x) => x.motif)).toEqual(['table_interdite']);
      expect(r2.refus.map((x) => x.motif)).toEqual(['table_interdite']);
      expect(await ligne(id)).toEqual(avant);
    });

    it('PUT d’un refus portant l’id de celui de Théo : refusé, la ligne de Théo est intacte', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const r = await lot(jetonCollegue, [
        {
          op: 'PUT',
          table: 'refus_synchro',
          id,
          donnees: { utilisateur_id: collegue, ferme_id: fermeA, nom_table: 'evenement', ligne_id: 'x', operation: 'PUT', motif: 'x', message: 'x', archive_le: ARCHIVE_1 },
        },
      ]);
      expect(r.refus.map((x) => x.motif)).toEqual(['table_interdite']);
      expect(await ligne(id)).toEqual(avant);
    });

    it('DELETE du refus de Théo par le collègue : refusé, la ligne reste', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const r = await lot(jetonCollegue, [{ op: 'DELETE', table: 'refus_synchro', id }]);
      expect(r.refus.map((x) => x.motif)).toEqual(['table_interdite']);
      expect(await ligne(id)).toEqual(avant);
    });
  });

  // ── 3. Seul l'archivage, sous sa seule forme ────────────────────────────────────────────────

  describe('seule la date d’archivage se modifie', () => {
    it.each([
      ['message', { archive_le: ARCHIVE_1, message: 'Réécrit par le téléphone' }],
      ['motif', { archive_le: ARCHIVE_1, motif: 'ajout_seul' }],
      ['utilisateur_id', { archive_le: ARCHIVE_1, utilisateur_id: '00000000-0000-4000-8000-000000000000' }],
      ['ferme_id', { archive_le: ARCHIVE_1, ferme_id: null }],
      ['message seul', { message: 'Réécrit' }],
    ])('PATCH avec %s : refusé (table_interdite), rien ne bouge', async (_cas, donnees) => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const r = await lot(jetonTheo, [archivage(id, donnees)]);
      expect(r.refus).toEqual([{ table: 'refus_synchro', id, motif: 'table_interdite' }]);
      expect(await ligne(id)).toEqual(avant);
    });

    it.each([
      ['nul', { archive_le: null }],
      ['illisible', { archive_le: 'hier soir' }],
      ['nombre', { archive_le: 1_727_762_400_000 }],
    ])('archive_le %s : refusé (ecriture_invalide), rien ne bouge', async (_cas, donnees) => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const r = await lot(jetonTheo, [archivage(id, donnees)]);
      expect(r.refus).toEqual([{ table: 'refus_synchro', id, motif: 'ecriture_invalide' }]);
      expect(await ligne(id)).toEqual(avant);
    });

    it('un refus archivé ne se « désarchive » pas : archive_le nul refusé, la date reste', async () => {
      const id = await refusExistant(theo);
      expect((await lot(jetonTheo, [archivage(id)])).refus).toEqual([]);
      const r = await lot(jetonTheo, [archivage(id, { archive_le: null })]);
      expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
      expect(await archiveLe(id)).toBe(ARCHIVE_1);
    });

    it('PUT ou DELETE de son propre refus : refusé (table_interdite), le refus reste tel quel', async () => {
      const id = await refusExistant(theo);
      const avant = await ligne(id);
      const nouveau = nouvelId<'Evenement'>();
      const r = await lot(jetonTheo, [
        { op: 'DELETE', table: 'refus_synchro', id },
        {
          op: 'PUT',
          table: 'refus_synchro',
          id: nouveau,
          donnees: { utilisateur_id: theo, ferme_id: fermeA, nom_table: 'evenement', ligne_id: 'x', operation: 'PUT', motif: 'x', message: 'x' },
        },
      ]);
      expect(r.refus.map((x) => [x.id, x.motif])).toEqual([
        [id, 'table_interdite'],
        [nouveau, 'table_interdite'],
      ]);
      expect(await ligne(id)).toEqual(avant);
      expect(await ligne(nouveau), 'aucun refus créé à l’id choisi par le téléphone').toBeUndefined();
    });
  });

  // ── 4. Pas de boucle ───────────────────────────────────────────────────────────────────────

  it('un archivage refusé renvoyé par la file : un seul refus enregistré, pas de boucle', async () => {
    const id = await refusExistant(theo);
    await lot(jetonCollegue, [archivage(id)]);
    await lot(jetonCollegue, [archivage(id)]);
    await lot(jetonCollegue, [archivage(id, { archive_le: ARCHIVE_2 })]);
    expect(await refusPour(collegue, id), 'dédupliqué (utilisateur, ligne, opération, motif)').toHaveLength(1);
    // Archiver ce refus-là (celui de l'archivage refusé) est permis : il appartient au collègue.
    const [refusArchivage] = (
      await base.pool.query<{ id: string }>(`SELECT id::text AS id FROM refus_synchro WHERE utilisateur_id = $1 AND lower(ligne_id) = lower($2)`, [collegue, id])
    ).rows;
    if (refusArchivage === undefined) throw new Error('refus de l’archivage absent');
    expect((await lot(jetonCollegue, [archivage(refusArchivage.id)])).refus).toEqual([]);
    expect(await archiveLe(refusArchivage.id)).toBe(ARCHIVE_1);
  });
});
