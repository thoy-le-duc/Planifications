/**
 * Tests d'acceptation T88 — POST /sync/upload écrit la grille d'une serre (chapelles × tronçons, allées)
 * (docs/backlog/T88-serre-en-grille-modele.md, règle 6 et critère « Tests API et règles PowerSync »), contre un vrai Postgres
 * (même amorçage que structure-placement.integration.test.ts : DATABASE_URL, base jetable).
 *
 * ── Contrat (en plus de T28s) ───────────────────────────────────────────────────────────────
 *
 * batiment : colonnes ouvertes en plus : nb_chapelles (entier 1 à 100), nb_troncons (entier 1 à 50), largeur_allee_m (nombre ≥ 0,
 * au millimètre), facultatives et nulles par défaut. Mêmes règles que validerPlacement (@planif/core) et que la base : hors bornes ou
 * grille qui ne tient pas (longueur − (nb_troncons − 1) × largeur_allee_m ≤ 0, sur la ligne complète) → 'ecriture_invalide',
 * message en français sans jargon, lot refusé en entier. Gérant seulement (Q31) ; isolement par ferme inchangé. Historique :
 * la ligne `modification` du bâtiment porte les trois colonnes.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import { defautsDeForme, jargon } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-30T06:00:00Z');
const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';
const SEUL_LE_GERANT = /: seul le gérant peut placer les éléments de la ferme\.$/iu;

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}
interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}
type Ligne = Record<string, unknown>;

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T88')('T88 : la grille d’une serre dans POST /sync/upload', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let ferme: string;
  let fermeVoisine: string;
  let serreVoisine: string;
  let compteur = 0;
  const unique = (p: string): string => `${p}-${String(++compteur)}`;

  const jetonPour = (id: string): Promise<string> => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  async function envoyer(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }
  const accepte = async (ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<void> => {
    expect(await envoyer(ecritures, jeton)).toEqual({ refus: [] });
  };

  async function ligne(id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM batiment t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }
  async function dernierMessage(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    const message = r.rows[0]?.message ?? '';
    expect(message, `un refus enregistré pour ${id}`).not.toBe('');
    expect(jargon(message), `jargon dans « ${message} »`).toEqual([]);
    expect(defautsDeForme(message), `forme de « ${message} »`).toEqual([]);
    return message;
  }

  /** Refus 'ecriture_invalide' du lot en entier, avec un message en français qui répond à `attendu`. */
  async function refuse(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, attendu: RegExp, jeton: string = gerant.jeton): Promise<void> {
    const avant = await ligne(fautive.id);
    const reponse = await envoyer(ecritures, jeton);
    expect(reponse.refus.filter((r) => r.id === fautive.id).map((r) => r.motif)).toEqual(['ecriture_invalide']);
    for (const e of ecritures) expect(reponse.refus.some((r) => r.id === e.id), `${e.id} refusé aussi (tout ou rien)`).toBe(true);
    expect(await ligne(fautive.id)).toEqual(avant);
    const message = await dernierMessage(fautive.id);
    expect(message.startsWith(DEBUT_INVALIDE), message).toBe(true);
    expect(message).toMatch(attendu);
  }

  const putSerre = (grille: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'batiment',
    id: nouvelId(),
    donnees: {
      ferme_id: fermeId,
      nom: unique('Serre'),
      type: 'serre_chapelle',
      longueur_m: 128.8,
      largeur_m: 57.6,
      hauteur_m: 5,
      centre_x_m: 50,
      centre_y_m: 30,
      orientation_deg: 0,
      zone_id: null,
      ...grille,
    },
  });
  const patch = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'batiment', id, donnees });
  const LEGUMES = { nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 };

  beforeAll(async () => {
    base = await creerBaseJetable('t88_grille');
    cles = { active: await genererCleSignature('cle-t88'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeVoisine = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, (await creerUtilisateur(base.pool)).id, fermeVoisine, { role: 'gerant' });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    for (const f of [ferme, fermeVoisine]) await base.pool.query(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify({ latitude: 44, longitude: 1.5 })]);
    serreVoisine = randomUUID();
    await base.pool.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg)
       VALUES ($1, $2, 'Serre voisine', 'serre_chapelle', 128.8, 57.6, 5, 0, 0, 0)`,
      [serreVoisine, fermeVoisine],
    );
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  describe('le gérant écrit la grille : accepté, historique', () => {
    it('PUT d’une serre à légumes (6 × 3, allées de 4,40 m) : les trois colonnes sont écrites', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      expect(await ligne(b.id)).toMatchObject({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4, longueur_m: 128.8, ferme_id: ferme });
    });

    it('l’historique de la création porte la grille', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      const r = await base.pool.query<{ operation: string; nom_table: string; apres: Ligne | null }>(`SELECT operation, nom_table, apres FROM modification WHERE ligne_id = $1`, [b.id]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ operation: 'creation', nom_table: 'Batiment' });
      expect(r.rows[0]?.apres).toMatchObject({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 });
    });

    it('téléphone d’avant la mise à jour (aucune des trois colonnes) : accepté, grille nulle', async () => {
      const b = putSerre();
      await accepte([b]);
      expect(await ligne(b.id)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
    });

    it('colonnes envoyées à null : acceptées, nulles', async () => {
      const b = putSerre({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
      await accepte([b]);
      expect(await ligne(b.id)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
    });

    it('bornes comprises : 1 et 100 chapelles, 1 et 50 tronçons, allée de 0', async () => {
      const a = putSerre({ nb_chapelles: 1, nb_troncons: 1, largeur_allee_m: 0 });
      const b = putSerre({ nb_chapelles: 100, nb_troncons: 50, largeur_allee_m: 0 });
      await accepte([a, b]);
    });

    it('PATCH de la grille (puis retour à null) : modifié à chaque fois, historique « modification »', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      await accepte([patch(b.id, { nb_chapelles: 4 })]);
      expect(await ligne(b.id)).toMatchObject({ nb_chapelles: 4, nb_troncons: 3, largeur_allee_m: 4.4 });
      await accepte([patch(b.id, { nb_chapelles: null, nb_troncons: null, largeur_allee_m: null })]);
      expect(await ligne(b.id)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
      const r = await base.pool.query<{ operation: string }>(`SELECT operation FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`, [b.id]);
      expect(r.rows.map((x) => x.operation)).toEqual(['creation', 'modification', 'modification']);
    });

    it('renvoi identique (réponse perdue) : accepté, aucun historique de plus', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      await accepte([b]);
      const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM modification WHERE ligne_id = $1`, [b.id]);
      expect(r.rows[0]?.n).toBe(1);
    });
  });

  describe('valeurs refusées : lot refusé en entier, message en français', () => {
    it.each([
      ['0 chapelle', { nb_chapelles: 0 }],
      ['101 chapelles', { nb_chapelles: 101 }],
      ['2,5 chapelles', { nb_chapelles: 2.5 }],
      ['chapelles en texte', { nb_chapelles: 'six' }],
    ])('%s', async (_cas, grille) => {
      const b = putSerre(grille);
      await refuse([b], b, /chapelle/iu);
      expect(await ligne(b.id)).toBeNull();
    });

    it.each([
      ['0 tronçon', { nb_chapelles: 2, nb_troncons: 0 }],
      ['51 tronçons', { nb_chapelles: 2, nb_troncons: 51 }],
      ['1,5 tronçon', { nb_chapelles: 2, nb_troncons: 1.5 }],
    ])('%s', async (_cas, grille) => {
      const b = putSerre(grille);
      await refuse([b], b, /tronçon/iu);
      expect(await ligne(b.id)).toBeNull();
    });

    it.each([
      ['allée négative', { nb_chapelles: 2, nb_troncons: 3, largeur_allee_m: -1 }],
      ['allée plus fine que le millimètre', { nb_chapelles: 2, nb_troncons: 3, largeur_allee_m: 4.4005 }],
      ['allée en texte', { nb_chapelles: 2, nb_troncons: 3, largeur_allee_m: '4,4' }],
    ])('%s', async (_cas, grille) => {
      const b = putSerre(grille);
      await refuse([b], b, /allée/iu);
      expect(await ligne(b.id)).toBeNull();
    });

    it('grille impossible : 128,8 m, 3 tronçons, allées de 64,4 m → refusé ; 64,39 m accepté', async () => {
      const b = putSerre({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 64.4 });
      await refuse([b], b, /allée|tronçon/iu);
      expect(await ligne(b.id)).toBeNull();
      await accepte([putSerre({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 64.39 })]);
    });

    it('PATCH qui rend la grille impossible (longueur réduite à 8 m, ou allée élargie) : refusé, serre inchangée', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      await refuse([patch(b.id, { longueur_m: 8 })], patch(b.id, { longueur_m: 8 }), /allée|tronçon|longueur/iu);
      await refuse([patch(b.id, { largeur_allee_m: 70 })], patch(b.id, { largeur_allee_m: 70 }), /allée|tronçon/iu);
      expect(await ligne(b.id)).toMatchObject({ longueur_m: 128.8, largeur_allee_m: 4.4 });
    });

    it('un seul tronçon : une allée large ne coupe rien, acceptée', async () => {
      await accepte([putSerre({ nb_chapelles: 3, nb_troncons: 1, largeur_allee_m: 500 })]);
    });

    it('une colonne qui n’existe pas reste refusée (la liste blanche ne s’ouvre pas en grand)', async () => {
      const b = putSerre({ nb_etages: 2 });
      const reponse = await envoyer([b], gerant.jeton);
      expect(reponse.refus.map((r) => r.id)).toContain(b.id);
      expect(await ligne(b.id)).toBeNull();
    });

    it('allée à un flottant près (0,1 × 3) : acceptée et écrite au millimètre (0,3), comme la base l’accepte', async () => {
      const b = putSerre({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 0.1 * 3 });
      await accepte([b]);
      expect((await ligne(b.id))?.largeur_allee_m).toBe(0.3);
    });

    it.each([
      ['nb_troncons sans nb_chapelles', { nb_troncons: 3 }],
      ['largeur_allee_m sans nb_chapelles', { largeur_allee_m: 4.4 }],
      ['les deux sans nb_chapelles', { nb_troncons: 3, largeur_allee_m: 4.4 }],
    ])('%s : refusé, message en français, rien d’écrit', async (_cas, grille) => {
      const b = putSerre(grille);
      await refuse([b], b, /chapelle/iu);
      expect(await ligne(b.id)).toBeNull();
    });

    it('nb_chapelles seul : accepté', async () => {
      await accepte([putSerre({ nb_chapelles: 3 })]);
    });

    it('chapelle minuscule : 0,01 m en 100 chapelles → refusé ; 0,1 m en 100 chapelles → accepté', async () => {
      const b = putSerre({ nb_chapelles: 100, largeur_m: 0.01 });
      await refuse([b], b, /chapelle/iu);
      expect(await ligne(b.id)).toBeNull();
      await accepte([putSerre({ nb_chapelles: 100, largeur_m: 0.1 })]);
    });

    it('grille minuscule : 0,02 m en 50 tronçons → refusé ; 0,05 m en 50 tronçons → accepté', async () => {
      const b = putSerre({ nb_chapelles: 1, nb_troncons: 50, largeur_allee_m: 0, longueur_m: 0.02 });
      await refuse([b], b, /tronçon|allée|longueur/iu);
      expect(await ligne(b.id)).toBeNull();
      await accepte([putSerre({ nb_chapelles: 1, nb_troncons: 50, largeur_allee_m: 0, longueur_m: 0.05 })]);
    });

    it('un lot valide qui contient une grille impossible : tout est refusé (tout ou rien)', async () => {
      const bonne = putSerre(LEGUMES);
      const mauvaise = putSerre({ nb_chapelles: 0 });
      await refuse([bonne, mauvaise], mauvaise, /chapelle/iu);
      expect(await ligne(bonne.id)).toBeNull();
    });
  });

  describe('isolement par ferme et droits (Q31)', () => {
    it('un équipier qui crée une serre avec grille, ou règle la grille d’une serre : refusé avec le message du gérant, rien d’écrit', async () => {
      const b = putSerre(LEGUMES);
      await refuse([b], b, SEUL_LE_GERANT, equipier.jeton);
      expect(await ligne(b.id)).toBeNull();
      const existante = putSerre();
      await accepte([existante]);
      const p = patch(existante.id, { nb_chapelles: 3 });
      await refuse([p], p, SEUL_LE_GERANT, equipier.jeton);
      expect((await ligne(existante.id))?.nb_chapelles).toBeNull();
    });

    it('le gérant de la ferme ne règle pas la grille d’une serre d’une AUTRE ferme : refusé, grille nulle', async () => {
      const p = patch(serreVoisine, { nb_chapelles: 3, nb_troncons: 2, largeur_allee_m: 1 });
      const reponse = await envoyer([p], gerant.jeton);
      expect(reponse.refus.map((r) => r.id)).toContain(p.id);
      expect(await ligne(serreVoisine)).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
    });

    it('le gérant ne crée pas une serre avec grille dans une AUTRE ferme : refusé, rien d’écrit', async () => {
      const b = putSerre(LEGUMES, fermeVoisine);
      const reponse = await envoyer([b], gerant.jeton);
      expect(reponse.refus.map((r) => r.id)).toContain(b.id);
      expect(await ligne(b.id)).toBeNull();
    });

    it('DELETE d’une serre reste refusé (suppression douce seulement)', async () => {
      const b = putSerre(LEGUMES);
      await accepte([b]);
      const reponse = await envoyer([{ op: 'DELETE', table: 'batiment', id: b.id }], gerant.jeton);
      expect(reponse.refus.map((r) => r.motif)).toEqual(expect.arrayContaining([expect.stringMatching(/table_interdite|ajout_seul/)]));
      expect(await ligne(b.id)).not.toBeNull();
    });
  });
});
