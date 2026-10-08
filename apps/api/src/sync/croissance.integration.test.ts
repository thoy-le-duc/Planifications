/**
 * Tests d'acceptation T32a — le serveur accepte le profil de croissance réglé par une ferme sur
 * SES espèces et refuse un profil hors bornes (docs/backlog/T32a-croissance-profils.md, critère
 * « Migration, synchro et export » ; Q32 option A), contre un vrai Postgres (même amorçage que
 * structure.integration.test.ts : DATABASE_URL, base jetable supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat (en plus de T10s) ────────────────────────────────────────────────────────────────
 *
 * `espece.profil_croissance` est une colonne écrite par le téléphone (COLONNES_STRUCTURE de
 * structure-lignes.ts), au format PowerSync : texte JSON, ou nul (profil par défaut). Clé absente
 * d'un PUT (téléphone d'avant T32a) : nul. Le serveur rejoue `validerProfilCroissance` de
 * @planif/core (mêmes bornes que la porte du téléphone) :
 *   - valide → écrit en jsonb, sous la forme rendue par le cœur (`cycleAnnuel` absent → null) ;
 *   - nul → écrit nul (retour au défaut) ;
 *   - refusé (hors bornes, champ inconnu, texte illisible, trop long, pas un objet) →
 *     'ecriture_invalide', lot refusé EN ENTIER, rien d'écrit, message en français sans jargon
 *     (test/jargon.ts) qui dit ce qui ne va pas (« hauteur » pour une hauteur hors bornes).
 * Isolement (T10s) : la bibliothèque commune et les espèces d'une autre ferme ne se règlent pas
 * ('ecriture_invalide' ou 'ferme_interdite'), rien ne change ; le profil d'une ferme ne touche
 * jamais la même espèce d'une autre ferme. Historique : `modification.apres` porte le profil.
 *
 * Hors de ce fichier : « réglé sur un téléphone, retrouvé sur l'autre » de bout en bout relève de
 * e2e:synchro (Docker) ; ici, le profil accepté est en base, et la colonne descend par les flux
 * `espece` (packages/sync/src/schema.test.ts, packages/db/src/croissance.integration.test.ts).
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
const MAINTENANT = new Date('2026-10-08T06:00:00Z');

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
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const PROFIL = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 85 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

const PERENNE = {
  forme: 'arbre-ou-liane',
  hauteurMaxM: 2.5,
  duree: { en: 'fraction_cycle', fraction: 0.3 },
  allure: 'lineaire',
  finDeCycle: 'conservee',
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
} as const;

decrireAvecBase('T32a')('T32a : POST /sync/upload, profil de croissance des espèces de la ferme', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let theo: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;
  let famille: string;
  let familleSeconde: string;
  let familleBibliotheque: string;
  /** Tomates : de la ferme, de la seconde ferme de Théophane, de la ferme voisine, de la bibliothèque. */
  let tomate: string;
  let tomateSeconde: string;
  let tomateVoisine: string;
  let tomateBibliotheque: string;

  async function familleEn(fermeId: string | null): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`, [id, fermeId]);
    return id;
  }

  async function especeEn(fermeId: string | null, familleId: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Tomate', 'legume', false, 'kg')`,
      [id, fermeId, familleId],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t32a_croissance');
    cles = { active: await genererCleSignature('cle-t32a'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site de Théophane');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    theo = { id: u.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
    famille = await familleEn(ferme);
    familleSeconde = await familleEn(secondeFerme);
    familleBibliotheque = await familleEn(null);
    tomate = await especeEn(ferme, famille);
    tomateSeconde = await especeEn(secondeFerme, familleSeconde);
    tomateVoisine = await especeEn(autreFerme, await familleEn(autreFerme));
    tomateBibliotheque = await especeEn(null, familleBibliotheque);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${theo.jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[]): Promise<void> {
    expect(await lot(ecritures)).toEqual({ refus: [] });
  }

  async function ligne(id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(e) AS l FROM espece e WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function profilDe(id: string): Promise<unknown> {
    const r = await base.pool.query<{ p: unknown }>(`SELECT profil_croissance AS p FROM espece WHERE id = $1`, [id]);
    return r.rows[0]?.p;
  }

  async function modifications(id: string): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM modification WHERE ligne_id = $1`, [id]);
    return r.rows[0]?.n ?? -1;
  }

  /** Message enregistré du dernier refus de `id` : en français, sans jargon, de la forme de T10j. */
  async function messageDe(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    const message = r.rows[0]?.message ?? '';
    expect(jargon(message), `jargon dans « ${message} »`).toEqual([]);
    expect(defautsDeForme(message), `forme de « ${message} »`).toEqual([]);
    return message;
  }

  /** Le lot est refusé en entier : chaque écriture a son refus, la fautive avec `motif`, rien ne change. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string | readonly string[]): Promise<void> {
    const avant = new Map<string, [Ligne | null, number]>();
    for (const e of ecritures) avant.set(e.id, [await ligne(e.id), await modifications(e.id)]);
    const reponse = await lot(ecritures);
    const recus = reponse.refus.filter((r) => r.id === fautive.id);
    expect(recus, JSON.stringify(reponse.refus)).toHaveLength(1);
    if (typeof motif === 'string') expect(recus[0]?.motif).toBe(motif);
    else expect(motif).toContain(recus[0]?.motif);
    for (const e of ecritures) {
      expect(reponse.refus.some((r) => r.id === e.id && r.table === e.table), `${e.table} ${e.id} figure dans les refus`).toBe(true);
      expect(await ligne(e.id), `${e.id} inchangée`).toEqual(avant.get(e.id)?.[0]);
      expect(await modifications(e.id), `aucun historique de plus pour ${e.id}`).toBe(avant.get(e.id)?.[1]);
    }
  }

  const patchProfil = (id: string, profil: unknown): EcritureEnvoyee => ({
    op: 'PATCH',
    table: 'espece',
    id,
    donnees: { profil_croissance: profil === null ? null : typeof profil === 'string' ? profil : JSON.stringify(profil) },
  });

  const putEspece = (autres: Record<string, unknown> = {}): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'espece',
    id: nouvelId(),
    donnees: {
      ferme_id: ferme,
      famille_id: famille,
      nom: `Tomate ${String(tic)}`,
      categorie: 'legume',
      perenne: 0,
      unite_recolte: 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...autres,
    },
  });

  // ── Accepté ─────────────────────────────────────────────────────────────────────────────────

  describe('profil valide, sur une espèce de la ferme', () => {
    it('PATCH (texte JSON du téléphone) : écrit en objet ; la tomate des autres fermes et de la bibliothèque ne bougent pas', async () => {
      await accepte([patchProfil(tomate, PROFIL)]);
      expect(await profilDe(tomate)).toEqual(PROFIL);
      expect(await profilDe(tomateSeconde)).toBeNull();
      expect(await profilDe(tomateVoisine)).toBeNull();
      expect(await profilDe(tomateBibliotheque)).toBeNull();
    });

    it('historique : la modification porte le profil écrit', async () => {
      const r = await base.pool.query<{ apres: Ligne | null; nom_table: string; operation: string }>(
        `SELECT apres, nom_table, operation FROM modification WHERE ligne_id = $1 ORDER BY horodatage DESC, id DESC LIMIT 1`,
        [tomate],
      );
      expect(r.rows[0]).toMatchObject({ nom_table: 'Espece', operation: 'modification' });
      expect(r.rows[0]?.apres?.profil_croissance).toEqual(PROFIL);
    });

    it('profil de pérenne (cycle annuel, durée en fraction) : accepté', async () => {
      await accepte([patchProfil(tomateSeconde, PERENNE)]);
      expect(await profilDe(tomateSeconde)).toEqual(PERENNE);
      expect(await profilDe(tomate), 'la ferme principale garde son profil').toEqual(PROFIL);
    });

    it('cycleAnnuel absent : écrit sous la forme du cœur (cycleAnnuel null)', async () => {
      const sansCycle = Object.fromEntries(Object.entries(PROFIL).filter(([cle]) => cle !== 'cycleAnnuel'));
      await accepte([patchProfil(tomate, sansCycle)]);
      expect(await profilDe(tomate)).toEqual(PROFIL);
    });

    it('nul : retour au profil par défaut', async () => {
      await accepte([patchProfil(tomateSeconde, null)]);
      expect(await profilDe(tomateSeconde)).toBeNull();
    });

    it('PUT d’une espèce avec son profil : accepté', async () => {
      const e = putEspece({ profil_croissance: JSON.stringify(PROFIL) });
      await accepte([e]);
      expect(await profilDe(e.id)).toEqual(PROFIL);
    });

    it('PUT sans la clé profil_croissance (téléphone d’avant T32a) : accepté, profil nul', async () => {
      const e = putEspece();
      await accepte([e]);
      expect(await profilDe(e.id)).toBeNull();
    });

    it('PATCH d’un autre champ : le profil réglé reste', async () => {
      await accepte([{ op: 'PATCH', table: 'espece', id: tomate, donnees: { unite_recolte: 'barquette' } }]);
      expect(await profilDe(tomate)).toEqual(PROFIL);
    });
  });

  // ── Refusé ──────────────────────────────────────────────────────────────────────────────────

  describe('profil hors bornes : refusé par le serveur, rien n’est écrit', () => {
    it.each([
      ['hauteur de 7 m', { ...PROFIL, hauteurMaxM: 7 }],
      ['hauteur nulle', { ...PROFIL, hauteurMaxM: 0 }],
      ['fraction du cycle au-dessus de 1', { ...PROFIL, duree: { en: 'fraction_cycle', fraction: 1.5 } }],
      ['durée de 0 jour', { ...PROFIL, duree: { en: 'jours', jours: 0 } }],
      ['champ inconnu', { ...PROFIL, rendement: 12 }],
      ['forme inconnue', { ...PROFIL, forme: 'arbre' }],
      ['cycle annuel inversé', { ...PERENNE, cycleAnnuel: { debourrement: '11-15', repos: '04-01' } }],
      ['champ manquant', { forme: 'rosette', hauteurMaxM: 0.25 }],
      ['tableau', '[1,2]'],
      ['texte JSON illisible', '{hauteur: 2'],
      ['texte trop long', JSON.stringify(PROFIL) + ' '.repeat(3_000)],
    ])('%s : ecriture_invalide, profil inchangé', async (_, profil) => {
      const avant = await profilDe(tomate);
      const p = patchProfil(tomate, profil);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await profilDe(tomate)).toEqual(avant);
      await messageDe(tomate);
    });

    it('le message dit ce qui ne va pas : la hauteur', async () => {
      const p = patchProfil(tomate, { ...PROFIL, hauteurMaxM: 12 });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await messageDe(tomate)).toMatch(/hauteur/i);
    });

    it('PUT d’une espèce au profil hors bornes : refusée, l’espèce n’existe pas', async () => {
      const e = putEspece({ profil_croissance: JSON.stringify({ ...PROFIL, hauteurMaxM: 6.5 }) });
      await refuseEnEntier([e], e, 'ecriture_invalide');
      expect(await ligne(e.id)).toBeNull();
    });

    it('tout ou rien : un profil valide et un profil hors bornes dans le même lot → les deux refusés', async () => {
      const bon = patchProfil(tomateSeconde, PERENNE);
      const mauvais = patchProfil(tomate, { ...PROFIL, duree: { en: 'fraction_cycle', fraction: -1 } });
      await refuseEnEntier([bon, mauvais], mauvais, 'ecriture_invalide');
      expect(await profilDe(tomateSeconde)).toBeNull();
    });
  });

  describe('isolement : ni la bibliothèque, ni une autre ferme', () => {
    it('régler la tomate de la bibliothèque commune : refusé, elle reste sans profil', async () => {
      const p = patchProfil(tomateBibliotheque, PROFIL);
      await refuseEnEntier([p], p, ['ecriture_invalide', 'ferme_interdite']);
      expect(await profilDe(tomateBibliotheque)).toBeNull();
    });

    it('régler la tomate de la ferme voisine : refusé, elle reste sans profil', async () => {
      const p = patchProfil(tomateVoisine, PROFIL);
      await refuseEnEntier([p], p, ['ecriture_invalide', 'ferme_interdite']);
      expect(await profilDe(tomateVoisine)).toBeNull();
    });

    it('le profil de la ferme principale n’a rien changé ailleurs', async () => {
      expect(await profilDe(tomate)).toEqual(PROFIL);
      expect(await profilDe(tomateVoisine)).toBeNull();
      expect(await profilDe(tomateBibliotheque)).toBeNull();
    });
  });
});
