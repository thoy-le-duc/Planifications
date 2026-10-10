/**
 * Tests d'acceptation T32c, serveur (SÉCURITÉ) — le profil de croissance d'une espèce se règle par
 * le GÉRANT seulement (Q35, 2026-10-09 ; docs/backlog/T32c-reglage-profils.md), contre un vrai
 * Postgres (même amorçage que croissance.integration.test.ts : DATABASE_URL, base jetable
 * supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat (en plus de T10s et de T32a) ─────────────────────────────────────────────────────
 *
 * Aujourd'hui (T32a) tout membre actif règle le profil d'une espèce de sa ferme ; T32c ferme
 * cette porte. Rôle relu en base à chaque lot, ferme par ferme (être gérant d'une autre ferme ne
 * donne rien ici), comme le placement (T28s, Q31).
 *
 * « Modifier le profil » = toute écriture d'espèce dont la valeur de `profil_croissance` après
 * l'écriture diffère de celle d'avant (comparaison des profils relus par le cœur, pas des textes) :
 *   - PATCH qui porte `profil_croissance` différent de la valeur en base, y compris le retour à
 *     nul (« rétablir la valeur par défaut » EST une modification) ;
 *   - PUT (création) dont `profil_croissance` n'est pas
 *     nul (décision du testeur, à confirmer par le chef : une espèce créée par un équipier naît
 *     sans profil ; PUT sans la clé ou avec nul reste ouvert à tout membre, comme T10s).
 * Renvoi de la valeur déjà en base (même profil, ou nul sur nul) : PAS une modification ; accepté
 * pour tout membre, rien ne change (décision du testeur : un téléphone peut renvoyer la colonne
 * telle quelle avec un autre champ).
 *
 * Un équipier qui modifie le profil → 'ecriture_invalide', le LOT ENTIER refusé (rien d'écrit,
 * chaque écriture a son refus, aucun historique), message enregistré en français, sans jargon, de
 * la forme de T10j : « Saisie non enregistrée, données invalides : seul le gérant peut régler le
 * profil de croissance. » (casse de la première lettre libre après « : »).
 * Les autres champs de l'espèce (nom, unité, délais, suppression douce…) gardent leurs droits
 * ordinaires : tout membre actif (T10s).
 *
 * Le gérant : accepté, comme T32a (validation par le cœur, champ `fougereApresRecolte` de T32c
 * compris : packages/core/src/croissance/test/contrat-reglage.ts).
 *
 * ── Deux téléphones hors ligne (règle de fusion existante) ───────────────────────────────────
 *
 * docs/choix-synchro.md : « le serveur fait foi, la dernière écriture gagne champ par champ, avec
 * l'historique pour revenir en arrière ». Le profil est UN champ (une colonne jsonb) : le dernier
 * profil ARRIVÉ au serveur gagne en entier (pas de fusion clé par clé) ; un autre champ de
 * l'espèce modifié par l'autre téléphone est gardé ; chaque écriture a sa ligne `modification`,
 * la première garde son profil dans `apres`.
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
const MAINTENANT = new Date('2026-10-10T06:00:00Z');

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

const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';
/** Ce que dit le refus de droits (Q35), après « : ». */
const SEUL_LE_GERANT = /: seul le gérant peut régler le profil de croissance\.$/iu;

/** Tomate réglée à 1,8 m (exemple du ticket). */
const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;
/** La même, réglée autrement sur l'autre téléphone. */
const TOMATE_BUISSON = { ...TOMATE_1_8, forme: 'buisson', hauteurMaxM: 2.2 } as const;
/** Asperge réglée par la ferme, règle Q33 portée par le champ de T32c. */
const ASPERGE_REGLEE = {
  forme: 'touffe',
  hauteurMaxM: 1.3,
  duree: { en: 'jours', jours: 100 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
  fougereApresRecolte: true,
} as const;

decrireAvecBase('T32c')('T32c : POST /sync/upload, le profil de croissance se règle par le gérant seulement', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme. */
  let theo: { id: string; jeton: string };
  /** Second gérant de la ferme (deuxième téléphone de gérant). */
  let associe: { id: string; jeton: string };
  /** Équipier (membre actif, non gérant) de la ferme, gérant de sa propre ferme. */
  let equipier: { id: string; jeton: string };
  let ferme: string;
  let fermeDeLEquipier: string;
  let famille: string;
  let familleEquipier: string;

  let compteur = 0;
  const unique = (prefixe: string): string => `${prefixe} ${String(++compteur)}`;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function familleEn(fermeId: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`, [id, fermeId]);
    return id;
  }

  /** Espèce écrite directement en base, avec son profil (objet) ou nul. */
  async function especeEn(fermeId: string, familleId: string, profil: unknown = null, nom = unique('Tomate')): Promise<string> {
    const id = randomUUID();
    await base.pool.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance)
       VALUES ($1, $2, $3, $4, 'legume', false, 'kg', $5::jsonb)`,
      [id, fermeId, familleId, nom, profil === null ? null : JSON.stringify(profil)],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t32c_profil_droits');
    cles = { active: await genererCleSignature('cle-t32c'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeDeLEquipier = await creerFerme(base.pool, 'Potager de l’équipier');
    const u = await creerUtilisateur(base.pool);
    const a = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, a.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, e.id, fermeDeLEquipier, { role: 'gerant' });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    associe = { id: a.id, jeton: await jetonPour(a.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    famille = await familleEn(ferme);
    familleEquipier = await familleEn(fermeDeLEquipier);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<void> {
    expect(await lot(ecritures, jeton)).toEqual({ refus: [] });
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

  async function historique(id: string): Promise<{ auteur_id: string; operation: string; apres: Ligne | null }[]> {
    const r = await base.pool.query<{ auteur_id: string; operation: string; apres: Ligne | null }>(
      `SELECT auteur_id::text AS auteur_id, operation, apres FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`,
      [id],
    );
    return r.rows;
  }

  /** Message enregistré du dernier refus de `id` : en français, sans jargon, de la forme de T10j. */
  async function messageDe(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    const message = r.rows[0]?.message ?? '';
    expect(jargon(message), `jargon dans « ${message} »`).toEqual([]);
    expect(defautsDeForme(message), `forme de « ${message} »`).toEqual([]);
    return message;
  }

  /** Le lot est refusé EN ENTIER : chaque écriture a son refus, la fautive avec `motif`, rien ne change. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string, jeton: string): Promise<void> {
    const avant = new Map<string, [Ligne | null, number]>();
    for (const e of ecritures) avant.set(e.id, [await ligne(e.id), await modifications(e.id)]);
    const reponse = await lot(ecritures, jeton);
    const recus = reponse.refus.filter((r) => r.id === fautive.id);
    expect(recus, JSON.stringify(reponse.refus)).toHaveLength(1);
    expect(recus[0]?.motif).toBe(motif);
    for (const e of ecritures) {
      expect(reponse.refus.some((r) => r.id === e.id && r.table === e.table), `${e.table} ${e.id} figure dans les refus`).toBe(true);
      expect(await ligne(e.id), `${e.id} inchangée`).toEqual(avant.get(e.id)?.[0]);
      expect(await modifications(e.id), `aucun historique de plus pour ${e.id}`).toBe(avant.get(e.id)?.[1]);
    }
  }

  /** Refus des droits (Q35) : tout le lot, 'ecriture_invalide', message « seul le gérant… ». */
  async function refuseAuGerant(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, jeton: string = equipier.jeton): Promise<void> {
    await refuseEnEntier(ecritures, fautive, 'ecriture_invalide', jeton);
    const message = await messageDe(fautive.id);
    expect(message.startsWith(DEBUT_INVALIDE), message).toBe(true);
    expect(message, 'le message dit pourquoi : seul le gérant').toMatch(SEUL_LE_GERANT);
  }

  // ── Écritures telles que le téléphone les envoie (PowerSync : jsonb en texte JSON) ──────────

  const texte = (profil: unknown): string | null => (profil === null ? null : JSON.stringify(profil));

  const patchEspece = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'espece', id, donnees });
  const patchProfil = (id: string, profil: unknown): EcritureEnvoyee => patchEspece(id, { profil_croissance: texte(profil) });

  const putEspece = (autres: Record<string, unknown> = {}, fermeId: string = ferme, familleId: string = famille, id: string = nouvelId()): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'espece',
    id,
    donnees: {
      ferme_id: fermeId,
      famille_id: familleId,
      nom: unique('Tomate'),
      categorie: 'legume',
      perenne: 0,
      unite_recolte: 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...autres,
    },
  });

  // ── 1. Équipier : toute modification du profil est refusée, tout le lot ────────────────────

  describe('un équipier ne règle pas le profil (Q35)', () => {
    it('règle le profil d’une espèce sans profil : refusé en entier, message en français, rien d’écrit', async () => {
      const t = await especeEn(ferme, famille);
      const p = patchProfil(t, TOMATE_1_8);
      await refuseAuGerant([p], p);
      expect(await profilDe(t)).toBeNull();
    });

    it('change le profil réglé par le gérant : refusé, le profil du gérant reste', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      const p = patchProfil(t, TOMATE_BUISSON);
      await refuseAuGerant([p], p);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('change seulement la hauteur (même forme, même durée) : refusé', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      const p = patchProfil(t, { ...TOMATE_1_8, hauteurMaxM: 1.9 });
      await refuseAuGerant([p], p);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('remet le profil à nul (rétablir la valeur par défaut) : refusé aussi, c’est une modification', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      const p = patchProfil(t, null);
      await refuseAuGerant([p], p);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('retire la règle de l’asperge (fougereApresRecolte) : refusé', async () => {
      const a = await especeEn(ferme, famille, ASPERGE_REGLEE, unique('Asperge'));
      const p = patchProfil(a, { ...ASPERGE_REGLEE, fougereApresRecolte: false });
      await refuseAuGerant([p], p);
      expect(await profilDe(a)).toEqual(ASPERGE_REGLEE);
    });

    it('profil et nom dans la même écriture : refusée en entier, le nom ne change pas non plus', async () => {
      const t = await especeEn(ferme, famille, null, 'Tomate cerise');
      const p = patchEspece(t, { nom: 'Tomate cocktail', profil_croissance: texte(TOMATE_1_8) });
      await refuseAuGerant([p], p);
      expect((await ligne(t))?.nom).toBe('Tomate cerise');
    });

    it('au milieu d’un lot valide (autre espèce, autre champ) : tout le lot est refusé', async () => {
      const t = await especeEn(ferme, famille);
      const autre = await especeEn(ferme, famille, null, 'Courgette verte');
      const bon = patchEspece(autre, { unite_recolte: 'piece' });
      const fautive = patchProfil(t, TOMATE_1_8);
      await refuseAuGerant([bon, fautive], fautive);
      expect((await ligne(autre))?.unite_recolte).toBe('kg');
    });

    it('crée une espèce AVEC un profil (PUT) : refusée, l’espèce n’existe pas', async () => {
      const e = putEspece({ profil_croissance: texte(TOMATE_1_8) });
      await refuseAuGerant([e], e);
      expect(await ligne(e.id)).toBeNull();
    });

    it('reprend l’id d’une espèce existante dans un PUT qui change son profil : refusé (garde-fou ; message libre)', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      const e = putEspece({ profil_croissance: texte(TOMATE_BUISSON) }, ferme, famille, t);
      await refuseEnEntier([e], e, 'ecriture_invalide', equipier.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('gérant de SA ferme, équipier de celle-ci : le rôle est celui de la ferme visée', async () => {
      const chezLui = await especeEn(fermeDeLEquipier, familleEquipier);
      await accepte([patchProfil(chezLui, TOMATE_1_8)], equipier.jeton);
      expect(await profilDe(chezLui)).toEqual(TOMATE_1_8);
      const ici = await especeEn(ferme, famille);
      const p = patchProfil(ici, TOMATE_1_8);
      await refuseAuGerant([p], p);
    });

    it('un lot qui règle sa ferme (gérant) et celle où il est équipier : refusé en entier', async () => {
      const chezLui = await especeEn(fermeDeLEquipier, familleEquipier);
      const ici = await especeEn(ferme, famille);
      const a = patchProfil(chezLui, TOMATE_BUISSON);
      const b = patchProfil(ici, TOMATE_1_8);
      await refuseEnEntier([a, b], b, 'ecriture_invalide', equipier.jeton);
      expect(await profilDe(chezLui)).toBeNull();
      expect(await profilDe(ici)).toBeNull();
    });

    it('rôle relu à chaque lot : un gérant rétrogradé en équipier ne règle plus le profil', async () => {
      const u = await creerUtilisateur(base.pool);
      const f = await creerFerme(base.pool, unique('Ferme'));
      await ajouterMembre(base.pool, u.id, f, { role: 'gerant' });
      const fam = await familleEn(f);
      const t = await especeEn(f, fam);
      const jeton = await jetonPour(u.id);
      await accepte([patchProfil(t, TOMATE_1_8)], jeton);
      await base.pool.query(`UPDATE membre SET role = 'equipier' WHERE utilisateur_id = $1 AND ferme_id = $2`, [u.id, f]);
      const p = patchProfil(t, TOMATE_BUISSON);
      await refuseAuGerant([p], p, jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });
  });

  // ── 2. Équipier : les autres champs de l'espèce gardent leurs droits ordinaires ────────────

  describe('un équipier garde ses droits ordinaires sur les autres champs de l’espèce', () => {
    it('modifie le nom, l’unité et les délais : accepté, le profil réglé reste', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      await accepte([patchEspece(t, { nom: unique('Tomate ancienne'), unite_recolte: 'barquette', delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 4 })], equipier.jeton);
      const l = await ligne(t);
      expect(l?.unite_recolte).toBe('barquette');
      expect(l?.delai_retour_minimal_ans).toBe(3);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('crée une espèce sans profil (clé absente, ou nulle) : accepté', async () => {
      const sansCle = putEspece();
      const nul = putEspece({ profil_croissance: null });
      await accepte([sansCle, nul], equipier.jeton);
      expect(await ligne(sansCle.id)).not.toBeNull();
      expect(await profilDe(sansCle.id)).toBeNull();
      expect(await profilDe(nul.id)).toBeNull();
    });

    it('renvoie le profil tel qu’il est en base, avec un autre champ : accepté, le profil ne change pas', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      await accepte([patchEspece(t, { unite_recolte: 'piece', profil_croissance: texte(TOMATE_1_8) })], equipier.jeton);
      expect((await ligne(t))?.unite_recolte).toBe('piece');
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('renvoie nul sur un profil déjà nul : accepté', async () => {
      const t = await especeEn(ferme, famille);
      await accepte([patchEspece(t, { unite_recolte: 'botte', profil_croissance: null })], equipier.jeton);
      expect((await ligne(t))?.unite_recolte).toBe('botte');
      expect(await profilDe(t)).toBeNull();
    });
  });

  // ── 3. Le gérant règle le profil ────────────────────────────────────────────────────────────

  describe('le gérant règle le profil', () => {
    it('tomate à 1,8 m : accepté ; l’historique porte le profil et son auteur', async () => {
      const t = await especeEn(ferme, famille);
      await accepte([patchProfil(t, TOMATE_1_8)], theo.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
      const h = await historique(t);
      expect(h.at(-1)).toMatchObject({ auteur_id: theo.id, operation: 'modification' });
      expect(h.at(-1)?.apres?.profil_croissance).toEqual(TOMATE_1_8);
    });

    it('rétablir la valeur par défaut (nul) : accepté', async () => {
      const t = await especeEn(ferme, famille, TOMATE_1_8);
      await accepte([patchProfil(t, null)], theo.jeton);
      expect(await profilDe(t)).toBeNull();
    });

    it('asperge réglée, avec la règle de la fougère après récolte (champ de T32c) : acceptée, champ gardé', async () => {
      const a = await especeEn(ferme, famille, null, unique('Asperge'));
      await accepte([patchProfil(a, ASPERGE_REGLEE)], theo.jeton);
      expect(await profilDe(a)).toEqual(ASPERGE_REGLEE);
    });

    it('crée une espèce avec son profil (PUT) : accepté', async () => {
      const e = putEspece({ profil_croissance: texte(TOMATE_1_8) });
      await accepte([e], theo.jeton);
      expect(await profilDe(e.id)).toEqual(TOMATE_1_8);
    });

    it('profil hors bornes : toujours refusé (T32a), même pour le gérant', async () => {
      const t = await especeEn(ferme, famille);
      const p = patchProfil(t, { ...TOMATE_1_8, hauteurMaxM: 7 });
      await refuseEnEntier([p], p, 'ecriture_invalide', theo.jeton);
      expect(await messageDe(t)).toMatch(/hauteur/i);
    });
  });

  // ── 4. Deux téléphones hors ligne, même profil : la dernière écriture gagne, champ par champ ─

  describe('deux téléphones hors ligne qui règlent le même profil (règle de fusion des espèces)', () => {
    it('le dernier profil arrivé au serveur gagne EN ENTIER (pas de fusion clé par clé) ; les deux sont dans l’historique', async () => {
      const t = await especeEn(ferme, famille);
      // Téléphone de Théophane : hauteur 1,8 m. Téléphone de l'associé : buisson à 2,2 m. Arrivée dans cet ordre.
      await accepte([patchProfil(t, TOMATE_1_8)], theo.jeton);
      await accepte([patchProfil(t, TOMATE_BUISSON)], associe.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_BUISSON);
      const h = await historique(t);
      expect(h.map((x) => x.auteur_id)).toEqual([theo.id, associe.id]);
      expect(h[0]?.apres?.profil_croissance, 'le premier réglage reste dans l’historique').toEqual(TOMATE_1_8);
    });

    it('dans l’autre ordre d’arrivée, l’autre gagne', async () => {
      const t = await especeEn(ferme, famille);
      await accepte([patchProfil(t, TOMATE_BUISSON)], associe.jeton);
      await accepte([patchProfil(t, TOMATE_1_8)], theo.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('un téléphone règle le profil, l’autre (équipier) change l’unité : les deux sont gardés (champ par champ)', async () => {
      const t = await especeEn(ferme, famille);
      await accepte([patchProfil(t, TOMATE_1_8)], theo.jeton);
      await accepte([patchEspece(t, { unite_recolte: 'barquette' })], equipier.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
      expect((await ligne(t))?.unite_recolte).toBe('barquette');
    });

    it('l’un règle la hauteur, l’autre rétablit le défaut ; le rétablissement arrive en dernier : profil nul', async () => {
      const t = await especeEn(ferme, famille, TOMATE_BUISSON);
      await accepte([patchProfil(t, TOMATE_1_8)], theo.jeton);
      await accepte([patchProfil(t, null)], associe.jeton);
      expect(await profilDe(t)).toBeNull();
    });
  });
});
