/**
 * T10f, règle 2 — limite de débit par utilisateur sur POST /sync/upload, contre un vrai Postgres.
 *
 * Exécution : comme les autres tests d'intégration de la synchro (DATABASE_URL ; base jetable
 * `t10f_debit_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * Pourquoi : un téléphone mal programmé ou malveillant (boucle d'envoi) ne doit pas pouvoir
 * occuper le serveur et la base. Un téléphone normal n'atteint jamais la limite, sauf en vidant
 * une longue file au retour du réseau : il est alors ralenti, jamais bloqué.
 *
 * Contrat :
 *   - `ENVOIS_MAX_PAR_MINUTE` exporté par apps/api/src/sync/upload.ts : nombre de requêtes
 *     POST /sync/upload qu'un même utilisateur peut faire en une minute (fenêtre de 60 s,
 *     mesurée avec l'horloge injectée `maintenant` de creerApp, jamais Date.now()) ;
 *   - au-delà : 429 `{ erreur: 'trop_de_requetes' }`, en-tête `Retry-After` en secondes entières
 *     (1 à 60), RIEN d'écrit ni de refus enregistré : le téléphone renverra la même transaction
 *     plus tard (envoi-debit.test.ts de @planif/sync) ;
 *   - compteur par utilisateur AUTHENTIFIÉ (claim sub du jeton), pas par jeton ni par adresse IP :
 *     deux jetons du même utilisateur partagent le quota, un autre utilisateur a le sien ;
 *   - toute requête authentifiée compte, même un corps invalide (400) : sinon une boucle de corps
 *     illisibles échapperait à la limite ;
 *   - une minute plus tard, l'utilisateur repasse, et la saisie refusée en 429 s'écrit.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import * as upload from './upload.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const DEBUT = new Date('2026-10-01T06:00:00Z').getTime();

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = DEBUT - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

/** Quota lu dans le code : le test ne fixe pas la valeur, seulement qu'elle est raisonnable. */
function quota(): number {
  const max: unknown = (upload as Record<string, unknown>).ENVOIS_MAX_PAR_MINUTE;
  expect(max, 'ENVOIS_MAX_PAR_MINUTE exporté par sync/upload.ts').toBeTypeOf('number');
  return max as number;
}

decrireAvecBase('T10f')('T10f : limite de débit par utilisateur sur POST /sync/upload', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let horloge = DEBUT;
  let ferme: string;

  async function jetonPour(utilisateurId: string, emisA = horloge): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, new Date(emisA));
  }

  async function membre(): Promise<{ id: string; jeton: string }> {
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    return { id: u.id, jeton: await jetonPour(u.id) };
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10f_debit');
    cles = { active: await genererCleSignature('cle-t10f'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => new Date(horloge),
    });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  function envoyer(corps: unknown, jeton: string, entetes: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(
      app.request('/sync/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}`, ...entetes },
        body: JSON.stringify(corps),
      }),
    );
  }

  function putRecolte(auteurId: string): { op: 'PUT'; table: string; id: string; donnees: Record<string, unknown> } {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
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
        detail: JSON.stringify({ quantite: 4, unite: 'kg', categorie: null }),
      },
    };
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  /** Épuise le quota de `jeton` dans la minute courante (requêtes vides, toutes acceptées). */
  async function epuiser(jeton: string): Promise<void> {
    const max = quota();
    for (let i = 0; i < max; i++) {
      const res = await envoyer({ ecritures: [] }, jeton);
      expect(res.status, `requête ${String(i + 1)} sur ${String(max)}`).toBe(200);
    }
  }

  it('ENVOIS_MAX_PAR_MINUTE : un entier raisonnable (au moins 30, au plus 600)', () => {
    const max = quota();
    expect(Number.isInteger(max)).toBe(true);
    expect(max).toBeGreaterThanOrEqual(30);
    expect(max).toBeLessThanOrEqual(600);
  });

  it('au-delà du quota : 429 trop_de_requetes avec Retry-After, rien d’écrit ; une minute plus tard la même saisie passe', async () => {
    horloge = DEBUT;
    const theo = await membre();
    await epuiser(theo.jeton);

    const e = putRecolte(theo.id);
    const refusee = await envoyer({ ecritures: [e] }, theo.jeton);
    expect(refusee.status).toBe(429);
    expect(await refusee.json()).toEqual({ erreur: 'trop_de_requetes' });
    const attente = refusee.headers.get('retry-after');
    expect(attente, 'en-tête Retry-After').toMatch(/^\d+$/);
    expect(Number(attente)).toBeGreaterThanOrEqual(1);
    expect(Number(attente)).toBeLessThanOrEqual(60);
    expect(await compter('SELECT 1 FROM evenement WHERE id = $1', [e.id]), 'rien d’écrit').toBe(0);
    expect(await compter('SELECT 1 FROM refus_synchro WHERE ligne_id = $1', [e.id]), 'aucun refus : la saisie n’est pas perdue').toBe(0);

    horloge = DEBUT + 60_001;
    const reprise = await envoyer({ ecritures: [e] }, theo.jeton);
    expect(reprise.status).toBe(200);
    expect(await reprise.json()).toEqual({ refus: [] });
    expect(await compter('SELECT 1 FROM evenement WHERE id = $1', [e.id])).toBe(1);
  });

  it('un utilisateur ne consomme pas le quota d’un autre', async () => {
    horloge = DEBUT + 10 * 60_000;
    const theo = await membre();
    const voisin = await membre();
    await epuiser(theo.jeton);
    expect((await envoyer({ ecritures: [] }, theo.jeton)).status).toBe(429);

    const e = putRecolte(voisin.id);
    const res = await envoyer({ ecritures: [e] }, voisin.jeton);
    expect(res.status, 'le voisin n’est pas limité').toBe(200);
    expect(await compter('SELECT 1 FROM evenement WHERE id = $1', [e.id])).toBe(1);
  });

  it('compteur par utilisateur, pas par jeton ni par adresse : un second jeton ou une autre adresse ne contourne pas la limite', async () => {
    horloge = DEBUT + 20 * 60_000;
    const theo = await membre();
    await epuiser(theo.jeton);
    const autreJeton = await jetonPour(theo.id, horloge - 5_000);
    expect(autreJeton).not.toBe(theo.jeton);
    expect((await envoyer({ ecritures: [] }, autreJeton)).status, 'second jeton du même utilisateur').toBe(429);
    expect((await envoyer({ ecritures: [] }, autreJeton, { 'x-forwarded-for': '203.0.113.7' })).status, 'autre adresse annoncée').toBe(429);
  });

  it('les requêtes au corps invalide (400) comptent aussi', async () => {
    horloge = DEBUT + 30 * 60_000;
    const theo = await membre();
    const max = quota();
    for (let i = 0; i < max; i++) {
      const res = await envoyer({ pasDEcritures: true }, theo.jeton);
      expect(res.status).toBe(400);
    }
    expect((await envoyer({ ecritures: [] }, theo.jeton)).status).toBe(429);
  });

  it('une requête sans jeton reste un 401, même quand l’utilisateur est limité', async () => {
    horloge = DEBUT + 40 * 60_000;
    const theo = await membre();
    await epuiser(theo.jeton);
    const res = await app.request('/sync/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ecritures":[]}' });
    expect(res.status).toBe(401);
  });
});
