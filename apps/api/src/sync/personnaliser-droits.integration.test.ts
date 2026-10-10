/**
 * Tests d'acceptation T32g, serveur (SÉCURITÉ) — la copie d'une espèce de la bibliothèque
 * (« Personnaliser », Q39) arrive au serveur comme la création d'une espèce de la ferme. La porte
 * l'écrit avec un profil NUL (décision du chef) : elle relève alors du droit ordinaire de création
 * d'espèce (T10s, tout membre actif) ; seul un profil non nul est réservé au gérant actif (Q35).
 * Le « gérant seulement » de « Personnaliser » est donc tenu par la porte et l'écran. Plus les « Suites de la
 * relecture T32c » (docs/backlog/T32g-personnaliser-espece.md) : membre retiré et invité non
 * accepté, profil équivalent écrit autrement renvoyé par un équipier. Contre un vrai Postgres
 * (même amorçage que profil-droits.integration.test.ts : DATABASE_URL, base jetable supprimée à la
 * fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * Déjà couvert par T32c, NON dupliqué ici (profil-droits.integration.test.ts) :
 *   - « un équipier ne règle pas le profil (Q35) › crée une espèce AVEC un profil (PUT) :
 *     refusée, l’espèce n’existe pas » — la copie AVEC profil envoyée par un équipier
 *     (même règle : PUT dont le profil n'est pas nul, quel que soit le nom ou la famille) ;
 *   - « le gérant règle le profil › crée une espèce avec son profil (PUT) : accepté ».
 * Ce fichier ajoute la forme de la copie (famille de la bibliothèque ; profil nul, comme l'écrit la
 * porte ; ou profil par défaut écrit en clair, asperge avec `fougereApresRecolte`), les membres qui ne sont plus ou pas encore
 * actifs, et les renvois équivalents.
 *
 * ── Contrat ajouté (décision du testeur, à confirmer par le chef) ────────────────────────────
 *
 * Renvoi équivalent : un équipier qui renvoie un profil ÉQUIVALENT à celui en base (mêmes valeurs
 * relues par le cœur : autre ordre des clés, `fougereApresRecolte: false` là où la clé est
 * absente) n'est pas refusé, ET le profil en base ne change pas (même jsonb qu'avant : l'équipier
 * n'y fait entrer aucune variante d'écriture, pas même une clé `false`) ; les autres champs de
 * son écriture sont écrits.
 */
import { profilParDefaut } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

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

let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

/** Tomate réglée à 1,8 m (exemple de T32c), forme à six clés, sans `fougereApresRecolte`. */
const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

/** La même, clés dans un autre ordre (et sous-objet `duree` aussi). */
const TOMATE_1_8_AUTRE_ORDRE = {
  cycleAnnuel: null,
  finDeCycle: 'conservee',
  duree: { jours: 90, en: 'jours' },
  hauteurMaxM: 1.8,
  allure: 'en-s',
  forme: 'erige-tuteure',
} as const;

decrireAvecBase('T32g')('T32g : POST /sync/upload, la copie d’une espèce de la bibliothèque et les suites de T32c', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let retire: { id: string; jeton: string };
  let invite: { id: string; jeton: string };
  let ferme: string;
  let familleFerme: string;
  let solanacees: string;
  let asparagacees: string;

  let compteur = 0;
  const unique = (prefixe: string): string => `${prefixe} ${String(++compteur)}`;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function familleEn(fermeId: string | null, nom: string): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, $3, 3, 4)`, [id, fermeId, nom]);
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
    base = await creerBaseJetable('t32g_personnaliser');
    cles = { active: await genererCleSignature('cle-t32g'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    const i = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    // Gérant retiré de la ferme, gérant invité qui n'a pas encore accepté.
    await ajouterMembre(base.pool, r.id, ferme, { role: 'gerant', retire: true });
    await ajouterMembre(base.pool, i.id, ferme, { role: 'gerant', etat: 'invite', invitePar: g.id });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
    invite = { id: i.id, jeton: await jetonPour(i.id) };
    familleFerme = await familleEn(ferme, 'Brassicacées');
    solanacees = await familleEn(null, 'Solanacées');
    asparagacees = await familleEn(null, 'Asparagacées');
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

  /** Refusée : l'écriture a son refus, la ligne et son historique ne changent pas. */
  async function refusee(e: EcritureEnvoyee, jeton: string): Promise<void> {
    const avant = await ligne(e.id);
    const historique = await modifications(e.id);
    const reponse = await lot([e], jeton);
    expect(
      reponse.refus.some((r) => r.id === e.id && r.table === e.table),
      JSON.stringify(reponse.refus),
    ).toBe(true);
    expect(await ligne(e.id), 'ligne inchangée').toEqual(avant);
    expect(await modifications(e.id), 'aucun historique de plus').toBe(historique);
  }

  // ── Écritures telles que le téléphone les envoie (PowerSync : jsonb en texte JSON) ──────────

  const texte = (profil: unknown): string | null => (profil === null ? null : JSON.stringify(profil));
  const patchEspece = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'espece', id, donnees });

  /**
   * Une copie d'espèce de la bibliothèque : espèce de la ferme, famille de la bibliothèque. Par
   * défaut avec le profil par défaut écrit en clair (le gérant en a le droit) ; `profilNul` : telle
   * que porte.personnaliserEspece l'écrit (décision du chef : profil nul, défaut retrouvé par le nom).
   */
  const copie = (nom: string, familleId: string, o: { perenne?: number; unite?: string; profilNul?: boolean } = {}): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'espece',
    id: randomUUID(),
    donnees: {
      ferme_id: ferme,
      famille_id: familleId,
      nom,
      categorie: 'legume',
      perenne: o.perenne ?? 0,
      unite_recolte: o.unite ?? 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      profil_croissance: o.profilNul === true ? null : texte(profilParDefaut(nom).profil),
    },
  });

  // ── 1. La copie envoyée par le gérant ───────────────────────────────────────────────────────

  describe('le gérant envoie la copie d’une espèce de la bibliothèque', () => {
    it('Tomate à profil nul (ce qu’écrit la porte) : acceptée, espèce de la ferme sans profil', async () => {
      const c = copie('Tomate', solanacees, { profilNul: true });
      await accepte([c], gerant.jeton);
      expect(await ligne(c.id)).toMatchObject({ ferme_id: ferme, famille_id: solanacees, nom: 'Tomate' });
      expect(await profilDe(c.id)).toBeNull();
    });

    it('Tomate (famille de la bibliothèque, profil par défaut en clair) : acceptée, espèce de la ferme avec ce profil', async () => {
      const c = copie('Tomate', solanacees);
      await accepte([c], gerant.jeton);
      expect(await ligne(c.id)).toMatchObject({ ferme_id: ferme, famille_id: solanacees, nom: 'Tomate' });
      expect(await profilDe(c.id)).toEqual(profilParDefaut('Tomate').profil);
    });

    it('Asperge : acceptée, la règle de la fougère après récolte (fougereApresRecolte: true) gardée en base', async () => {
      const c = copie('Asperge', asparagacees, { perenne: 1, unite: 'botte' });
      await accepte([c], gerant.jeton);
      expect(await profilDe(c.id)).toEqual(profilParDefaut('Asperge').profil);
      expect(await profilDe(c.id)).toMatchObject({ fougereApresRecolte: true });
    });
  });

  // ── 2. Membres qui ne sont plus, ou pas encore, actifs ─────────────────────────────────────

  describe('gérant retiré, gérant invité non accepté : refusés', () => {
    it.each([
      ['un gérant retiré', () => retire.jeton],
      ['un gérant invité, pas encore accepté', () => invite.jeton],
    ])('%s envoie la copie : refusée, l’espèce n’existe pas', async (_cas, jeton) => {
      const c = copie('Tomate', solanacees);
      await refusee(c, jeton());
      expect(await ligne(c.id)).toBeNull();
    });

    it.each([
      ['un gérant retiré', () => retire.jeton],
      ['un gérant invité, pas encore accepté', () => invite.jeton],
    ])('%s règle le profil d’une espèce de la ferme : refusé, profil inchangé', async (_cas, jeton) => {
      const t = await especeEn(ferme, familleFerme);
      await refusee(patchEspece(t, { profil_croissance: texte(TOMATE_1_8) }), jeton());
      expect(await profilDe(t)).toBeNull();
    });

    it.each([
      ['un gérant retiré', () => retire.jeton],
      ['un gérant invité, pas encore accepté', () => invite.jeton],
    ])('%s rétablit la valeur par défaut d’un profil réglé : refusé, profil inchangé', async (_cas, jeton) => {
      const t = await especeEn(ferme, familleFerme, TOMATE_1_8);
      await refusee(patchEspece(t, { profil_croissance: null }), jeton());
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });
  });

  // ── 3. Profil équivalent écrit autrement, renvoyé par un équipier ──────────────────────────

  describe('un équipier renvoie un profil équivalent écrit autrement : accepté, profil inchangé', () => {
    it('autre ordre des clés, avec un autre champ : accepté, l’autre champ écrit, le profil en base identique', async () => {
      const t = await especeEn(ferme, familleFerme, TOMATE_1_8);
      await accepte([patchEspece(t, { unite_recolte: 'piece', profil_croissance: texte(TOMATE_1_8_AUTRE_ORDRE) })], equipier.jeton);
      expect((await ligne(t))?.unite_recolte).toBe('piece');
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('`fougereApresRecolte: false` là où la clé est absente, avec un autre champ : accepté, aucune clé ajoutée au profil en base', async () => {
      const t = await especeEn(ferme, familleFerme, TOMATE_1_8);
      await accepte([patchEspece(t, { unite_recolte: 'barquette', profil_croissance: texte({ ...TOMATE_1_8, fougereApresRecolte: false }) })], equipier.jeton);
      expect((await ligne(t))?.unite_recolte).toBe('barquette');
      expect(await profilDe(t), 'même jsonb qu’avant, sans « fougereApresRecolte: false »').toEqual(TOMATE_1_8);
    });

    it('le profil seul, équivalent (`fougereApresRecolte: false`, autre ordre) : accepté, profil en base identique', async () => {
      const t = await especeEn(ferme, familleFerme, TOMATE_1_8);
      await accepte([patchEspece(t, { profil_croissance: texte({ ...TOMATE_1_8_AUTRE_ORDRE, fougereApresRecolte: false }) })], equipier.jeton);
      expect(await profilDe(t)).toEqual(TOMATE_1_8);
    });

    it('la copie de l’asperge renvoyée telle quelle (autre ordre) par un équipier : acceptée, la règle reste', async () => {
      const a = await especeEn(ferme, asparagacees, profilParDefaut('Asperge').profil, unique('Asperge'));
      const inverse = Object.fromEntries(Object.entries(profilParDefaut('Asperge').profil).reverse());
      await accepte([patchEspece(a, { unite_recolte: 'botte', profil_croissance: texte(inverse) })], equipier.jeton);
      expect(await profilDe(a)).toEqual(profilParDefaut('Asperge').profil);
    });
  });
});
