/**
 * Tests d'acceptation T60 — POST /sync/upload accepte l'équipe de la ferme et l'attribution des
 * travaux du jour, du gérant seulement (docs/backlog/T60-consignes-par-ouvrier.md, règle 3 ;
 * critère « Test serveur : attribution par un équipier refusée ; par le gérant acceptée »),
 * contre un vrai Postgres (même amorçage que phyto.integration.test.ts : DATABASE_URL, base
 * jetable `t60_equipe_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en
 * local).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Tables ouvertes : `personne` (l'équipe : prénom, membre facultatif) et `attribution` (un
 * travail du jour, désigné par la clé de sa tâche, pour une personne). Colonnes reçues : celles
 * de Postgres au format PowerSync ; `cree_le`, `modifie_le` tolérées, remplies par le serveur ;
 * `id` dans les données → refus. Règles de ligne : `validerPersonne`, `validerAttribution` du
 * cœur (packages/core/src/equipe/test/contrat.ts), rejouées sur la ligne COMPLÈTE (pour un
 * PATCH : ligne existante + colonnes reçues).
 *
 * Droits (règle 3, comme le profil de croissance de T32c) : le GÉRANT actif de la ferme seul,
 * rôle relu en base dans la transaction du lot. Un équipier → 'ecriture_invalide' (précision :
 * seul le gérant), rien d'écrit, tout le lot refusé (tout ou rien). Ferme dont l'utilisateur
 * n'est pas membre actif → 'ferme_interdite'.
 *
 *   personne    PUT crée (membre_id nul : ouvrier sans compte ; sinon un membre de LA MÊME
 *               ferme, sinon 'ecriture_invalide'). Deux personnes actives pour un même membre →
 *               'ecriture_invalide'. Renvoi identique : accepté, rien d'écrit. PATCH : prénom,
 *               membre, retrait (supprime_le) et rétablissement. Ligne d'une autre ferme :
 *               comme un id inexistant ('ecriture_invalide', ferme nulle, T10d).
 *   attribution PUT crée (personne de LA MÊME ferme, sinon 'ecriture_invalide'). PATCH :
 *               supprime_le seul (retirer, rétablir) ; changer cle_tache ou personne_id →
 *               'ecriture_invalide'.
 *   DELETE      refusé ('table_interdite'), rien ne change.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-20T06:00:00Z');

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
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const CLE_GRELINETTE = '0192f0c1-1313-7000-8000-000000000050:travail:0:2026-10-08';
const CLE_CHOU = '0192f0c1-1313-7000-8000-000000000051:plantation';

decrireAvecBase('T60')('T60 : équipe et attribution des travaux, écrites par le gérant seulement', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;
  let membreEquipier: string;
  let membreVoisin: string;
  let personneVoisine: string;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  beforeAll(async () => {
    base = await creerBaseJetable('t60_equipe');
    cles = { active: await genererCleSignature('cle-t60'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };
    const idMembre = async (utilisateurId: string): Promise<string> =>
      (await base.pool.query<{ id: string }>(`SELECT id::text AS id FROM membre WHERE utilisateur_id = $1`, [utilisateurId])).rows[0]?.id ?? '';
    membreEquipier = await idMembre(e.id);
    membreVoisin = await idMembre(v.id);
    personneVoisine = randomUUID();
    await base.pool.query(`INSERT INTO personne (id, ferme_id, prenom, membre_id) VALUES ($1, $2, 'Voisin', NULL)`, [personneVoisine, autreFerme]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function ligne(table: 'personne' | 'attribution', id: string): Promise<Record<string, unknown> | undefined> {
    const r = await base.pool.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return r.rows[0];
  }

  async function messageDuRefus(ligneId: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [ligneId]);
    return r.rows[0]?.message ?? '';
  }

  const personne = (id: string, prenom: string, membreId: string | null = null, f: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'personne',
    id,
    donnees: { ferme_id: f, prenom, membre_id: membreId, supprime_le: null },
  });
  const attribution = (id: string, personneId: string, cleTache: string, f: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'attribution',
    id,
    donnees: { ferme_id: f, personne_id: personneId, cle_tache: cleTache, supprime_le: null },
  });

  it('gérant : un ouvrier sans compte (prénom seul) et un équipier qui a un compte, puis une attribution à deux personnes : acceptés', async () => {
    const paul = nouvelId<'Utilisateur'>();
    const marie = nouvelId<'Utilisateur'>();
    const a1 = nouvelId<'Utilisateur'>();
    const a2 = nouvelId<'Utilisateur'>();
    const r = await lot([personne(paul, 'Paul'), personne(marie, 'Marie', membreEquipier), attribution(a1, paul, CLE_GRELINETTE), attribution(a2, marie, CLE_GRELINETTE)]);
    expect(r.refus).toEqual([]);
    expect(await ligne('personne', paul)).toMatchObject({ ferme_id: ferme, prenom: 'Paul', membre_id: null, supprime_le: null });
    expect(await ligne('personne', marie)).toMatchObject({ membre_id: membreEquipier });
    expect(await ligne('attribution', a1)).toMatchObject({ ferme_id: ferme, personne_id: paul, cle_tache: CLE_GRELINETTE, supprime_le: null });
    expect(await ligne('attribution', a2)).toMatchObject({ personne_id: marie });
    // Renvoi identique (réponse perdue) : accepté, rien d'écrit en double.
    expect((await lot([attribution(a1, paul, CLE_GRELINETTE)])).refus).toEqual([]);
  });

  it('équipier : une attribution est REFUSÉE (seul le gérant), rien n’est écrit', async () => {
    const paul = nouvelId<'Utilisateur'>();
    expect((await lot([personne(paul, 'Paul')])).refus).toEqual([]);
    const a = nouvelId<'Utilisateur'>();
    const r = await lot([attribution(a, paul, CLE_CHOU)], equipier.jeton);
    expect(r.refus).toEqual([{ table: 'attribution', id: a, motif: 'ecriture_invalide' }]);
    expect(await ligne('attribution', a)).toBeUndefined();
    expect(await messageDuRefus(a)).toContain('seul le gérant');
  });

  it('équipier : retirer une attribution du gérant, ajouter ou renommer une personne : refusés, rien ne change', async () => {
    const paul = nouvelId<'Utilisateur'>();
    const a = nouvelId<'Utilisateur'>();
    expect((await lot([personne(paul, 'Paul'), attribution(a, paul, CLE_CHOU)])).refus).toEqual([]);
    const retrait = await lot([{ op: 'PATCH', table: 'attribution', id: a, donnees: { supprime_le: '2026-10-20T07:00:00.000Z' } }], equipier.jeton);
    expect(retrait.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect((await ligne('attribution', a))?.supprime_le).toBeNull();
    const lucas = nouvelId<'Utilisateur'>();
    expect((await lot([personne(lucas, 'Lucas')], equipier.jeton)).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('personne', lucas)).toBeUndefined();
    expect((await lot([{ op: 'PATCH', table: 'personne', id: paul, donnees: { prenom: 'Paulo' } }], equipier.jeton)).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect((await ligne('personne', paul))?.prenom).toBe('Paul');
  });

  it('équipier : un lot qui mêle une personne et une attribution est refusé en entier (tout ou rien)', async () => {
    const paul = nouvelId<'Utilisateur'>();
    expect((await lot([personne(paul, 'Paul')])).refus).toEqual([]);
    const a = nouvelId<'Utilisateur'>();
    const autre = nouvelId<'Utilisateur'>();
    const r = await lot([personne(autre, 'Autre'), attribution(a, paul, CLE_CHOU)], equipier.jeton);
    expect(r.refus).toHaveLength(2);
    expect(await ligne('personne', autre)).toBeUndefined();
  });

  it('gérant : retirer (suppression douce) puis rétablir une attribution ; elle ne change ni de travail ni de personne', async () => {
    const paul = nouvelId<'Utilisateur'>();
    const marie = nouvelId<'Utilisateur'>();
    const a = nouvelId<'Utilisateur'>();
    expect((await lot([personne(paul, 'Paul'), personne(marie, 'Marie'), attribution(a, paul, CLE_CHOU)])).refus).toEqual([]);
    expect((await lot([{ op: 'PATCH', table: 'attribution', id: a, donnees: { supprime_le: '2026-10-20T07:00:00.000Z' } }])).refus).toEqual([]);
    expect((await ligne('attribution', a))?.supprime_le).not.toBeNull();
    expect((await lot([{ op: 'PATCH', table: 'attribution', id: a, donnees: { supprime_le: null } }])).refus).toEqual([]);
    expect((await ligne('attribution', a))?.supprime_le).toBeNull();
    expect((await lot([{ op: 'PATCH', table: 'attribution', id: a, donnees: { personne_id: marie } }])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect((await lot([{ op: 'PATCH', table: 'attribution', id: a, donnees: { cle_tache: CLE_GRELINETTE } }])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('attribution', a)).toMatchObject({ personne_id: paul, cle_tache: CLE_CHOU });
  });

  it('gérant : renommer, lier à un compte, retirer et rétablir une personne', async () => {
    const lea = nouvelId<'Utilisateur'>();
    expect((await lot([personne(lea, 'Léa')])).refus).toEqual([]);
    expect((await lot([{ op: 'PATCH', table: 'personne', id: lea, donnees: { prenom: 'Léane' } }])).refus).toEqual([]);
    expect((await ligne('personne', lea))?.prenom).toBe('Léane');
    expect((await lot([{ op: 'PATCH', table: 'personne', id: lea, donnees: { supprime_le: '2026-10-20T08:00:00.000Z' } }])).refus).toEqual([]);
    expect((await ligne('personne', lea))?.supprime_le).not.toBeNull();
    expect((await lot([{ op: 'PATCH', table: 'personne', id: lea, donnees: { supprime_le: null } }])).refus).toEqual([]);
    expect((await ligne('personne', lea))?.supprime_le).toBeNull();
  });

  it('références : membre d’une autre ferme, deux personnes pour un même membre, personne d’une autre ferme : refusés', async () => {
    const x = nouvelId<'Utilisateur'>();
    expect((await lot([personne(x, 'X', membreVoisin)])).refus.map((r) => r.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('personne', x)).toBeUndefined();

    const p1 = nouvelId<'Utilisateur'>();
    const p2 = nouvelId<'Utilisateur'>();
    const autreFermeDuGerant = await creerFerme(base.pool, 'Second site');
    await ajouterMembre(base.pool, gerant.id, autreFermeDuGerant, { role: 'gerant' });
    const equipierDeux = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, equipierDeux.id, autreFermeDuGerant, { role: 'equipier' });
    const membreDeux = (await base.pool.query<{ id: string }>(`SELECT id::text AS id FROM membre WHERE utilisateur_id = $1`, [equipierDeux.id])).rows[0]?.id ?? '';
    expect((await lot([personne(p1, 'Un', membreDeux, autreFermeDuGerant)])).refus).toEqual([]);
    expect((await lot([personne(p2, 'Deux', membreDeux, autreFermeDuGerant)])).refus.map((r) => r.motif)).toEqual(['ecriture_invalide']);

    const a = nouvelId<'Utilisateur'>();
    expect((await lot([attribution(a, personneVoisine, CLE_CHOU)])).refus.map((r) => r.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('attribution', a)).toBeUndefined();
    const introuvable = nouvelId<'Utilisateur'>();
    expect((await lot([attribution(nouvelId<'Utilisateur'>(), introuvable, CLE_CHOU)])).refus.map((r) => r.motif)).toEqual(['ecriture_invalide']);
  });

  it('isolement : personne d’une autre ferme visée par un PATCH = introuvable ; ferme étrangère déclarée = ferme_interdite', async () => {
    const r = await lot([{ op: 'PATCH', table: 'personne', id: personneVoisine, donnees: { prenom: 'Pirate' } }]);
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect((await ligne('personne', personneVoisine))?.prenom).toBe('Voisin');
    const etranger = nouvelId<'Utilisateur'>();
    expect((await lot([personne(etranger, 'Étranger', null, autreFerme)])).refus.map((x) => x.motif)).toEqual(['ferme_interdite']);
    // Le gérant de l'autre ferme écrit chez lui.
    const chezLui = nouvelId<'Utilisateur'>();
    expect((await lot([personne(chezLui, 'Chez lui', null, autreFerme)], voisin.jeton)).refus).toEqual([]);
  });

  it('DELETE refusé (table_interdite) ; données invalides (prénom vide, id glissé dans les données) refusées', async () => {
    const paul = nouvelId<'Utilisateur'>();
    expect((await lot([personne(paul, 'Paul')])).refus).toEqual([]);
    expect((await lot([{ op: 'DELETE', table: 'personne', id: paul }])).refus.map((x) => x.motif)).toEqual(['table_interdite']);
    expect(await ligne('personne', paul)).toBeDefined();
    const vide = nouvelId<'Utilisateur'>();
    expect((await lot([personne(vide, '   ')])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    const glisse = nouvelId<'Utilisateur'>();
    expect((await lot([{ op: 'PUT', table: 'personne', id: glisse, donnees: { id: glisse, ferme_id: ferme, prenom: 'Glissé', membre_id: null } }])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
  });
});
