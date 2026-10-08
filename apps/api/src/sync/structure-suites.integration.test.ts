/**
 * Tests d'acceptation T10t — suites de la relecture de T10s (docs/backlog/T10t-structure-suites.md,
 * Q27), contre un vrai Postgres (même amorçage que structure.integration.test.ts : DATABASE_URL,
 * base jetable `t10t_suites_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut
 * signalé en local).
 *
 * ── Contrat (en plus de T10s : en-tête de structure.integration.test.ts) ────────────────────
 *
 * 1. Tests positifs manquants (comportement déjà en place, figé ici) :
 *    - une série terminée dont toutes les lignes sont actives (saison, espèce, itinéraire,
 *      emplacement de son occupation) repasse « prévue » ou « en cours » : accepté, statut écrit,
 *      historique « modification » ;
 *    - un lot qui rétablit l'emplacement (supprime_le nul) PUIS réactive la série dont
 *      l'occupation y est posée : accepté en entier.
 *
 * 2. Fuseau (bord de minuit à Paris) : une plantation dont l'arrachage est prévu LE JOUR MÊME
 *    (date du jour dans le fuseau de la ferme, Europe/Paris, à l'heure du serveur) n'est plus en
 *    place : elle ne retient ni sa planche ni son espèce. Prévu le lendemain : elle les retient.
 *    À 00:05 le 2 octobre à Paris (22:05 le 1er en UTC), un arrachage au 2 octobre est « le jour
 *    même » (le jour UTC dirait « demain ») ; à 23:55 le 1er à Paris, un arrachage au 2 octobre
 *    est « demain ».
 *
 * 3. Suppression douce refusée tant que des lignes actives en dépendent (décision du chef : refus,
 *    pas de cascade) → 'ecriture_invalide', rien d'écrit (lot refusé en entier), message en
 *    français sans jargon (test/jargon.ts) qui dit COMBIEN de lignes actives empêchent la
 *    suppression, nombre en chiffres suivi du nom accordé (« 1 assolement », « 2 assolements »,
 *    « 1 variété », « 2 variétés », « 1 itinéraire », « 2 itinéraires ») :
 *      zone          assolements actifs (supprime_le nul) dont zone_id est la zone ;
 *      saison        assolements actifs dont saison_id est la saison ;
 *      emplacement   assolements actifs dont emplacement_id est l'emplacement ;
 *      espèce        variétés actives ET itinéraires actifs de l'espèce (le message compte
 *                    les deux quand les deux existent).
 *    Ne comptent que les lignes actives DE LA MÊME FERME : une ligne supprimée ne compte pas, une
 *    ligne d'une autre ferme qui désignerait la ligne (écrite directement en base) non plus.
 *    Une ligne supprimée plus haut dans le même lot ne compte plus. Droits ordinaires (T10s) :
 *    même règle pour un équipier que pour le gérant.
 *
 * 4. Changer la famille d'une espèce (PATCH de famille_id vers une autre valeur) est refusé tant
 *    que des assolements actifs de la même ferme désignent cette espèce → 'ecriture_invalide',
 *    espèce inchangée, message qui parle des assolements. Sinon accepté. Un PATCH qui ne change
 *    pas la famille (nom, renvoi identique) reste accepté. Mêmes règles de comptage qu'en 3.
 *
 * 5. Q27 (réponse du 2026-10-07) : le code d'un emplacement est unique PAR ZONE parmi les
 *    emplacements non supprimés de la ferme.
 *    - Base : index unique partiel (`WHERE supprime_le IS NULL`) ; deux emplacements actifs de
 *      même code dans la même zone ne peuvent pas coexister (23505) ; un emplacement supprimé ne
 *      bloque pas ; même code dans une autre zone : permis. L'index ne mêle pas les fermes (il
 *      porte aussi ferme_id) : une ligne d'une autre ferme ne bloque jamais.
 *    - Serveur : refus PROPRE (réponse 200, 'ecriture_invalide', lot refusé en entier, message
 *      en français sans jargon qui dit que ce code existe déjà dans cette zone), jamais une
 *      erreur 500 : PUT d'un code déjà pris dans la zone ; deux PUT du même code dans la même
 *      zone dans un lot (import) ; PATCH du code vers un code pris ; PATCH qui range
 *      l'emplacement dans une zone où son code est pris ; rétablissement d'un emplacement dont
 *      le code a été repris entre-temps. Accepté : autre zone, premier emplacement supprimé
 *      (avant ou plus haut dans le même lot), renvoi identique d'un PUT.
 *    - Import (apps/web/src/ecrans/import/construction.ts, hors de ce fichier) : un doublon de
 *      code donne une ligne « doublon » dans l'aperçu (non écrite), l'import n'est pas refusé.
 *      Déjà couvert par packages/core/src/import/plan.test.ts (« même zone et même planche →
 *      doublon ») et apps/web/src/ecrans/import/regles.test.tsx (« une planche déjà dans la
 *      ferme est un doublon, pas écrite ; les autres passent »).
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
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const SUPPRIME_LE = '2026-10-01T06:30:00.000Z';

type TableLue = 'zone' | 'emplacement' | 'famille' | 'espece' | 'variete' | 'saison' | 'assolement' | 'serie' | 'occupation' | 'itineraire';
const TABLES_LUES: ReadonlySet<string> = new Set<TableLue>([
  'zone',
  'emplacement',
  'famille',
  'espece',
  'variete',
  'saison',
  'assolement',
  'serie',
  'occupation',
  'itineraire',
]);

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

/** Instantané de l'itinéraire batavia (T02), comme structure.integration.test.ts. */
const BATAVIA = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

/** « <n> <nom> » dans un message : n en chiffres, pas précédé d'un autre chiffre, nom non prolongé (pluriel compris). */
const compte = (n: number, nom: string): RegExp => new RegExp(`(?<![\\p{N}])${String(n)} ${nom}(?![\\p{L}])`, 'u');

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

/** Horloge du serveur : avance d'une milliseconde à chaque lecture ; déplacée par les tests du fuseau. */
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T10t')('T10t : parcellaire et catalogue, suites de la relecture de T10s', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme. */
  let theo: { id: string; jeton: string };
  /** Équipier de la ferme (droits ordinaires). */
  let paul: { id: string; jeton: string };
  let ferme: string;
  let voisine: string;

  let famille: string;
  let saison: string;
  let laitue: string;
  let itineraire: string;
  let zoneFerme: string;
  let saisonVoisine: string;
  let familleVoisine: string;
  let zoneVoisine: string;

  let compteur = 0;
  const unique = (prefixe: string): string => `${prefixe}-${String(++compteur)}`;

  async function inserer(sql: string, valeurs: readonly unknown[]): Promise<void> {
    await base.pool.query(sql, [...valeurs]);
  }

  // ── Lignes écrites directement en base ──────────────────────────────────────────────────────

  async function familleEn(fermeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, $3, 2, 3)`, [
      id,
      fermeId,
      unique('Famille'),
    ]);
    return id;
  }

  async function especeEn(fermeId: string, familleId: string): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, $4, 'legume', false, 'piece')`,
      [id, fermeId, familleId, unique('Tomate')],
    );
    return id;
  }

  async function varieteEn(fermeId: string, especeId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO variete (id, ferme_id, espece_id, nom, supprime_le) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      fermeId,
      especeId,
      unique('Variété'),
      supprimee ? MAINTENANT : null,
    ]);
    return id;
  }

  async function itineraireEn(fermeId: string, especeId: string, supprime = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres, supprime_le) VALUES ($1, $2, $3, $4, 'plant_maison', $5, $6)`,
      [id, fermeId, especeId, unique('Itinéraire'), JSON.stringify(BATAVIA), supprime ? MAINTENANT : null],
    );
    return id;
  }

  async function saisonEn(fermeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, $3, '2024-01-01', '2024-12-31')`, [id, fermeId, unique('Saison')]);
    return id;
  }

  async function zoneEn(fermeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, $3, 'tunnel')`, [id, fermeId, unique('Tunnel')]);
    return id;
  }

  async function plancheEn(fermeId: string, zoneId: string, code: string = unique('P'), supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, supprime_le)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5)`,
      [id, fermeId, zoneId, code, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  interface Assolement {
    readonly fermeId: string;
    readonly saisonId: string;
    readonly zoneId?: string;
    readonly emplacementId?: string;
    readonly familleId: string;
    readonly especeId?: string;
    readonly supprime?: boolean;
  }

  async function assolementEn(a: Assolement): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO assolement (id, ferme_id, saison_id, zone_id, emplacement_id, famille_id, espece_id, nature, supprime_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'passe_saisi', $8)`,
      [id, a.fermeId, a.saisonId, a.zoneId ?? null, a.emplacementId ?? null, a.familleId, a.especeId ?? null, a.supprime === true ? MAINTENANT : null],
    );
    return id;
  }

  /** Série batavia terminée de la ferme, et son occupation de 30 m sur `emplacementId`. */
  async function serieTermineeSur(emplacementId: string): Promise<{ serie: string; occupation: string }> {
    const serie = randomUUID();
    await inserer(
      `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres, ancre_type, ancre_date,
                          prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
       VALUES ($1, $2, $3, $4, $5, $6, 'debut_recolte', '2027-05-31', '2027-03-15', '2027-04-12', '2027-05-31', '2027-06-14', 30, 'terminee')`,
      [serie, ferme, saison, laitue, itineraire, JSON.stringify(BATAVIA)],
    );
    const occupation = randomUUID();
    await inserer(
      `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, longueur_m, prevu_du, prevu_au) VALUES ($1, $2, $3, $4, 30, '2027-04-12', '2027-06-14')`,
      [occupation, ferme, emplacementId, serie],
    );
    return { serie, occupation };
  }

  /** Plantation de `especeId` (pérenne plantée en 2019), arrachage prévu `arrachage`, occupant `emplacementId`. */
  async function plantationEn(especeId: string, emplacementId: string, arrachage: string): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants, date_arrachage) VALUES ($1, $2, $3, '2019-03-15', 120, $4)`,
      [id, ferme, especeId, arrachage],
    );
    await inserer(
      `INSERT INTO occupation (id, ferme_id, emplacement_id, plantation_id, longueur_m, prevu_du, prevu_au) VALUES ($1, $2, $3, $4, 30, '2019-03-15', $5)`,
      [randomUUID(), ferme, emplacementId, id, arrachage],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10t_suites');
    cles = { active: await genererCleSignature('cle-t10t'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    voisine = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, voisine, { role: 'gerant' });
    theo = { id: u.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
    paul = { id: e.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, e.id, MAINTENANT) };

    famille = await familleEn(ferme);
    saison = await saisonEn(ferme);
    laitue = await especeEn(ferme, famille);
    itineraire = await itineraireEn(ferme, laitue);
    zoneFerme = await zoneEn(ferme);

    saisonVoisine = await saisonEn(voisine);
    familleVoisine = await familleEn(voisine);
    zoneVoisine = await zoneEn(voisine);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<void> {
    expect(await lot(ecritures, jeton)).toEqual({ refus: [] });
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const modifications = (id: string): Promise<number> => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);

  async function ligne(table: TableLue, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function derniereOperation(id: string): Promise<string | undefined> {
    const r = await base.pool.query<{ operation: string }>(`SELECT operation FROM modification WHERE ligne_id = $1 ORDER BY horodatage DESC, id DESC LIMIT 1`, [id]);
    return r.rows[0]?.operation;
  }

  /** Le dernier message enregistré pour `id` : en français, sans jargon, de la forme de T10j. */
  async function messageDe(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le`, [id]);
    expect(r.rows.length, `refus_synchro pour ${id}`).toBeGreaterThanOrEqual(1);
    const message = r.rows.at(-1)?.message ?? '';
    expect(jargon(message), `jargon dans « ${message} »`).toEqual([]);
    expect(defautsDeForme(message), `forme de « ${message} »`).toEqual([]);
    return message;
  }

  /**
   * Le lot est refusé EN ENTIER : rien d'écrit ni changé, chaque écriture a son refus, la fautive
   * le motif 'ecriture_invalide'. Rend le message (sans jargon) enregistré pour la fautive.
   */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, jeton: string = theo.jeton): Promise<string> {
    const avant = new Map<string, Ligne | null>();
    const historiques = new Map<string, number>();
    for (const e of ecritures) {
      if (TABLES_LUES.has(e.table)) avant.set(e.id, await ligne(e.table as TableLue, e.id));
      historiques.set(e.id, await modifications(e.id));
    }
    const reponse = await lot(ecritures, jeton);
    const trouves = reponse.refus.filter((r) => r.id === fautive.id);
    expect(trouves, `un refus pour ${fautive.id} dans ${JSON.stringify(reponse.refus)}`).toHaveLength(1);
    expect(trouves[0]?.motif).toBe('ecriture_invalide');
    for (const e of ecritures) {
      expect(
        reponse.refus.some((r) => r.id === e.id && r.table === e.table),
        `${e.table} ${e.id} figure dans les refus`,
      ).toBe(true);
      if (TABLES_LUES.has(e.table)) expect(await ligne(e.table as TableLue, e.id), `${e.table} ${e.id} inchangée`).toEqual(avant.get(e.id));
      expect(await modifications(e.id), `aucun historique de plus pour ${e.table} ${e.id}`).toBe(historiques.get(e.id));
    }
    return messageDe(fautive.id);
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  const patch = (table: string, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const supprimer = (table: string, id: string): EcritureEnvoyee => patch(table, id, { supprime_le: SUPPRIME_LE });
  const retablir = (table: string, id: string): EcritureEnvoyee => patch(table, id, { supprime_le: null });

  const putZone = (): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'zone',
    id: nouvelId(),
    donnees: { ferme_id: ferme, nom: unique('Tunnel'), zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240 },
  });

  const putEmplacement = (zoneId: string, code: string): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'emplacement',
    id: nouvelId(),
    donnees: {
      ferme_id: ferme,
      zone_id: zoneId,
      code,
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: '2026-01-01',
      actif_au: null,
      remplace: '[]',
    },
  });

  /** Un lot valide (zone + planche) auquel on ajoute `fautive` à la fin. */
  function lotAvec(fautive: EcritureEnvoyee): EcritureEnvoyee[] {
    const zone = putZone();
    return [zone, putEmplacement(zone.id, unique('P')), fautive];
  }

  /**
   * Exécute `f` avec l'horloge du serveur à `instant` (ISO), puis la remet où elle était. `f`
   * reçoit un jeton de théo émis à cet instant (celui de MAINTENANT y aurait expiré).
   */
  async function a<T>(instant: string, f: (jeton: string) => Promise<T>): Promise<T> {
    const avant = horloge;
    horloge = Date.parse(instant);
    try {
      return await f(await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, theo.id, new Date(instant)));
    } finally {
      horloge = avant;
    }
  }

  // ── 1. Tests positifs de la relecture de T10s ───────────────────────────────────────────────

  describe('série réactivée : tests positifs', () => {
    it.each(['prevue', 'en_cours'])('série terminée dont toutes les lignes sont actives, repassée « %s » : acceptée, historique « modification »', async (statut) => {
      const planche = await plancheEn(ferme, zoneFerme);
      const { serie } = await serieTermineeSur(planche);
      await accepte([patch('serie', serie, { statut })]);
      expect((await ligne('serie', serie))?.statut).toBe(statut);
      expect(await derniereOperation(serie)).toBe('modification');
    });

    it('un lot qui rétablit l’emplacement puis réactive la série : accepté en entier', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      const { serie } = await serieTermineeSur(planche);
      // La série terminée ne retient plus sa planche : la supprimer est accepté.
      await accepte([supprimer('emplacement', planche)]);
      await accepte([retablir('emplacement', planche), patch('serie', serie, { statut: 'prevue' })]);
      expect((await ligne('emplacement', planche))?.supprime_le).toBeNull();
      expect((await ligne('serie', serie))?.statut).toBe('prevue');
    });
  });

  // ── 2. Fuseau : arrachage le jour même, autour de minuit à Paris ────────────────────────────

  describe('fuseau : arrachage prévu le jour même, autour de minuit à Paris', () => {
    // 2026-10-01 : heure d'été, Paris = UTC + 2.
    const APRES_MINUIT = '2026-10-01T22:05:00.000Z'; // 00:05 le 2 octobre à Paris, encore le 1er en UTC
    const AVANT_MINUIT = '2026-10-01T21:55:00.000Z'; // 23:55 le 1er octobre à Paris

    it('00:05 à Paris, arrachage prévu le jour même (2 octobre) : la planche se supprime (le jour UTC dirait « demain »)', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await plantationEn(laitue, planche, '2026-10-02');
      await a(APRES_MINUIT, (j) => accepte([supprimer('emplacement', planche)], j));
      expect((await ligne('emplacement', planche))?.supprime_le).not.toBeNull();
    });

    it('00:05 à Paris, arrachage prévu le jour même (2 octobre) : l’espèce se supprime', async () => {
      const espece = await especeEn(ferme, famille);
      const planche = await plancheEn(ferme, zoneFerme);
      await plantationEn(espece, planche, '2026-10-02');
      await a(APRES_MINUIT, (j) => accepte([supprimer('espece', espece)], j));
      expect((await ligne('espece', espece))?.supprime_le).not.toBeNull();
    });

    it('00:05 à Paris, arrachage prévu le lendemain (3 octobre) : suppression de la planche refusée', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await plantationEn(laitue, planche, '2026-10-03');
      const s = supprimer('emplacement', planche);
      expect(await a(APRES_MINUIT, (j) => refuseEnEntier([s], s, j))).toMatch(/occup/iu);
    });

    it('23:55 à Paris le 1er, arrachage prévu le 2 octobre (demain) : suppression de la planche et de l’espèce refusée', async () => {
      const espece = await especeEn(ferme, famille);
      const planche = await plancheEn(ferme, zoneFerme);
      await plantationEn(espece, planche, '2026-10-02');
      const s = supprimer('emplacement', planche);
      await a(AVANT_MINUIT, (j) => refuseEnEntier([s], s, j));
      const e = supprimer('espece', espece);
      await a(AVANT_MINUIT, (j) => refuseEnEntier([e], e, j));
    });

    it('23:55 à Paris le 1er, arrachage prévu le 1er (le jour même) : la planche se supprime', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await plantationEn(laitue, planche, '2026-10-01');
      await a(AVANT_MINUIT, (j) => accepte([supprimer('emplacement', planche)], j));
    });
  });

  // ── 3. Suppression refusée tant que des assolements actifs en dépendent ─────────────────────

  interface Cible {
    /** La ligne à supprimer. */
    readonly id: string;
    /** Un assolement qui la désigne, de la ferme (par défaut) ou de la voisine, actif ou supprimé. */
    assolement(o?: { readonly voisine?: boolean; readonly supprime?: boolean }): Promise<string>;
  }

  const CIBLES: readonly (readonly [string, () => Promise<Cible>])[] = [
    [
      'zone',
      async () => {
        const id = await zoneEn(ferme);
        return {
          id,
          assolement: (o = {}) =>
            assolementEn({
              fermeId: o.voisine === true ? voisine : ferme,
              saisonId: o.voisine === true ? saisonVoisine : saison,
              zoneId: id,
              familleId: o.voisine === true ? familleVoisine : famille,
              supprime: o.supprime === true,
            }),
        };
      },
    ],
    [
      'saison',
      async () => {
        const id = await saisonEn(ferme);
        return {
          id,
          assolement: (o = {}) =>
            assolementEn({
              fermeId: o.voisine === true ? voisine : ferme,
              saisonId: id,
              zoneId: o.voisine === true ? zoneVoisine : zoneFerme,
              familleId: o.voisine === true ? familleVoisine : famille,
              supprime: o.supprime === true,
            }),
        };
      },
    ],
    [
      'emplacement',
      async () => {
        const id = await plancheEn(ferme, zoneFerme);
        return {
          id,
          assolement: (o = {}) =>
            assolementEn({
              fermeId: o.voisine === true ? voisine : ferme,
              saisonId: o.voisine === true ? saisonVoisine : saison,
              emplacementId: id,
              familleId: o.voisine === true ? familleVoisine : famille,
              supprime: o.supprime === true,
            }),
        };
      },
    ],
  ];

  describe.each(CIBLES)('%s qui a encore des assolements actifs : suppression refusée', (table, preparer) => {
    it('2 assolements actifs (un 3e supprimé ne compte pas) : refusée, le message dit « 2 assolements », rien d’écrit', async () => {
      const c = await preparer();
      await c.assolement();
      await c.assolement();
      await c.assolement({ supprime: true });
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s)).toMatch(compte(2, 'assolements'));
      expect((await ligne(table as TableLue, c.id))?.supprime_le).toBeNull();
    });

    it('1 seul assolement actif : refusée, « 1 assolement » au singulier', async () => {
      const c = await preparer();
      await c.assolement();
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'assolement'));
    });

    it('au milieu d’un lot valide : rien du lot n’est écrit', async () => {
      const c = await preparer();
      await c.assolement();
      const s = supprimer(table, c.id);
      await refuseEnEntier(lotAvec(s), s);
    });

    it('seulement des assolements supprimés : acceptée, historique « suppression »', async () => {
      const c = await preparer();
      await c.assolement({ supprime: true });
      await accepte([supprimer(table, c.id)]);
      expect((await ligne(table as TableLue, c.id))?.supprime_le).not.toBeNull();
      expect(await derniereOperation(c.id)).toBe('suppression');
    });

    it('assolements supprimés plus haut dans le même lot : acceptée', async () => {
      const c = await preparer();
      const a1 = await c.assolement();
      const a2 = await c.assolement();
      await accepte([supprimer('assolement', a1), supprimer('assolement', a2), supprimer(table, c.id)]);
      expect((await ligne(table as TableLue, c.id))?.supprime_le).not.toBeNull();
    });

    it('droits ordinaires : un équipier reçoit le même refus ; libre, il supprime', async () => {
      const c = await preparer();
      await c.assolement();
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s, paul.jeton)).toMatch(compte(1, 'assolement'));
      const libre = await preparer();
      await accepte([supprimer(table, libre.id)], paul.jeton);
    });

    it('isolement : un assolement d’une autre ferme qui la désignerait ne compte pas', async () => {
      const seule = await preparer();
      await seule.assolement({ voisine: true });
      await accepte([supprimer(table, seule.id)]);

      const c = await preparer();
      await c.assolement();
      await c.assolement({ voisine: true });
      await c.assolement({ voisine: true });
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'assolement'));
    });
  });

  describe('espèce qui a encore des variétés ou des itinéraires actifs : suppression refusée', () => {
    it('2 variétés et 1 itinéraire actifs (une variété et un itinéraire supprimés ne comptent pas) : refusée, le message compte les deux', async () => {
      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece);
      await varieteEn(ferme, espece);
      await varieteEn(ferme, espece, true);
      await itineraireEn(ferme, espece);
      await itineraireEn(ferme, espece, true);
      const s = supprimer('espece', espece);
      const message = await refuseEnEntier([s], s);
      expect(message).toMatch(compte(2, 'variétés'));
      expect(message).toMatch(compte(1, 'itinéraire'));
      expect((await ligne('espece', espece))?.supprime_le).toBeNull();
    });

    it('1 variété seule : refusée, « 1 variété »', async () => {
      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece);
      const s = supprimer('espece', espece);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'variété'));
    });

    it('2 itinéraires seuls : refusée, « 2 itinéraires »', async () => {
      const espece = await especeEn(ferme, famille);
      await itineraireEn(ferme, espece);
      await itineraireEn(ferme, espece);
      const s = supprimer('espece', espece);
      expect(await refuseEnEntier([s], s)).toMatch(compte(2, 'itinéraires'));
    });

    it('au milieu d’un lot valide : rien du lot n’est écrit', async () => {
      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece);
      const s = supprimer('espece', espece);
      await refuseEnEntier(lotAvec(s), s);
    });

    it('variétés et itinéraires tous supprimés : acceptée', async () => {
      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece, true);
      await itineraireEn(ferme, espece, true);
      await accepte([supprimer('espece', espece)]);
      expect((await ligne('espece', espece))?.supprime_le).not.toBeNull();
    });

    it('variété et itinéraire supprimés plus haut dans le même lot : acceptée', async () => {
      const espece = await especeEn(ferme, famille);
      const v = await varieteEn(ferme, espece);
      const i = await itineraireEn(ferme, espece);
      await accepte([supprimer('variete', v), supprimer('itineraire', i), supprimer('espece', espece)]);
      expect((await ligne('espece', espece))?.supprime_le).not.toBeNull();
    });

    it('droits ordinaires : un équipier reçoit le même refus ; libre, il supprime', async () => {
      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece);
      const s = supprimer('espece', espece);
      expect(await refuseEnEntier([s], s, paul.jeton)).toMatch(compte(1, 'variété'));
      const libre = await especeEn(ferme, famille);
      await accepte([supprimer('espece', libre)], paul.jeton);
    });

    it('isolement : variétés et itinéraires d’une autre ferme qui la désigneraient ne comptent pas', async () => {
      const seule = await especeEn(ferme, famille);
      await varieteEn(voisine, seule);
      await itineraireEn(voisine, seule);
      await accepte([supprimer('espece', seule)]);

      const espece = await especeEn(ferme, famille);
      await varieteEn(ferme, espece);
      await varieteEn(voisine, espece);
      await varieteEn(voisine, espece);
      const s = supprimer('espece', espece);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'variété'));
    });
  });

  // ── 4. Changer la famille d'une espèce utilisée par des assolements ─────────────────────────

  describe('changer la famille d’une espèce tant que des assolements actifs l’utilisent : refusé', () => {
    async function especeAvecAssolements(o: { readonly actifs: number; readonly supprimes?: number; readonly voisins?: number }): Promise<{ espece: string; assolements: string[] }> {
      const espece = await especeEn(ferme, famille);
      const assolements: string[] = [];
      for (let i = 0; i < o.actifs; i++) assolements.push(await assolementEn({ fermeId: ferme, saisonId: saison, zoneId: zoneFerme, familleId: famille, especeId: espece }));
      for (let i = 0; i < (o.supprimes ?? 0); i++) {
        await assolementEn({ fermeId: ferme, saisonId: saison, zoneId: zoneFerme, familleId: famille, especeId: espece, supprime: true });
      }
      for (let i = 0; i < (o.voisins ?? 0); i++) {
        await assolementEn({ fermeId: voisine, saisonId: saisonVoisine, zoneId: zoneVoisine, familleId: familleVoisine, especeId: espece });
      }
      return { espece, assolements };
    }

    it('2 assolements actifs : refusé, espèce inchangée, le message parle des assolements', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 2, supprimes: 1 });
      const p = patch('espece', espece, { famille_id: autre });
      expect(await refuseEnEntier([p], p)).toMatch(/assolement/iu);
      expect((await ligne('espece', espece))?.famille_id).toBe(famille);
    });

    it('au milieu d’un lot valide : rien du lot n’est écrit', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 1 });
      const p = patch('espece', espece, { famille_id: autre });
      await refuseEnEntier(lotAvec(p), p);
    });

    it('seulement des assolements supprimés : accepté, nouvelle famille écrite', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 0, supprimes: 2 });
      await accepte([patch('espece', espece, { famille_id: autre })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(autre);
    });

    it('aucun assolement : accepté', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 0 });
      await accepte([patch('espece', espece, { famille_id: autre })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(autre);
    });

    it('assolements supprimés plus haut dans le même lot : accepté', async () => {
      const autre = await familleEn(ferme);
      const { espece, assolements } = await especeAvecAssolements({ actifs: 2 });
      await accepte([...assolements.map((a) => supprimer('assolement', a)), patch('espece', espece, { famille_id: autre })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(autre);
    });

    it('PATCH qui ne change pas la famille (nom, ou famille renvoyée à l’identique) : accepté malgré les assolements', async () => {
      const { espece } = await especeAvecAssolements({ actifs: 1 });
      await accepte([patch('espece', espece, { famille_id: famille })]);
      await accepte([patch('espece', espece, { nom: unique('Tomate ancienne') })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(famille);
    });

    it('droits ordinaires : un équipier reçoit le même refus', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 1 });
      const p = patch('espece', espece, { famille_id: autre });
      expect(await refuseEnEntier([p], p, paul.jeton)).toMatch(/assolement/iu);
    });

    it('isolement : des assolements d’une autre ferme qui la désigneraient ne comptent pas', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 0, voisins: 2 });
      await accepte([patch('espece', espece, { famille_id: autre })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(autre);
    });
  });

  // ── 5. Q27 : code d'emplacement unique par zone ─────────────────────────────────────────────

  describe('Q27 : code d’emplacement unique par zone (base)', () => {
    const insertion = (zoneId: string, code: string, supprimee = false, fermeId = ferme): Promise<string> => plancheEn(fermeId, zoneId, code, supprimee);

    it('deux emplacements actifs de même code dans la même zone : refusé par la base (23505)', async () => {
      const zone = await zoneEn(ferme);
      await insertion(zone, 'P3');
      await expect(insertion(zone, 'P3')).rejects.toMatchObject({ code: '23505' });
    });

    it('même code dans une autre zone : permis (deux « P3 » dans deux tunnels)', async () => {
      const z1 = await zoneEn(ferme);
      const z2 = await zoneEn(ferme);
      await insertion(z1, 'P3');
      await insertion(z2, 'P3');
      expect(await compter(`SELECT 1 FROM emplacement WHERE code = 'P3' AND zone_id IN ($1, $2)`, [z1, z2])).toBe(2);
    });

    it('le premier supprimé (suppression douce) : le même code se réutilise dans la zone', async () => {
      const zone = await zoneEn(ferme);
      await insertion(zone, 'P3', true);
      await insertion(zone, 'P3', true);
      await insertion(zone, 'P3');
      expect(await compter(`SELECT 1 FROM emplacement WHERE code = 'P3' AND zone_id = $1`, [zone])).toBe(3);
    });

    it('isolement : une ligne d’une autre ferme ne bloque pas le code dans la zone', async () => {
      const zone = await zoneEn(ferme);
      await insertion(zone, 'P3', false, voisine);
      await insertion(zone, 'P3');
    });
  });

  describe('Q27 : code d’emplacement unique par zone (serveur, refus propre)', () => {
    it('PUT d’un code déjà pris dans la zone : refusé (réponse 200), rien du lot n’est écrit, message clair', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3');
      const p = putEmplacement(zone, 'P3');
      const message = await refuseEnEntier(lotAvec(p), p);
      expect(message).toMatch(/déjà/iu);
      expect(message).toMatch(/zone/iu);
      expect(await compter(`SELECT 1 FROM emplacement WHERE zone_id = $1 AND code = 'P3'`, [zone])).toBe(1);
    });

    it('import : deux PUT du même code dans la même zone neuve, dans le même lot : refusé en entier, la seconde est la fautive', async () => {
      const zone = putZone();
      const p1 = putEmplacement(zone.id, 'P3');
      const p2 = putEmplacement(zone.id, 'P3');
      await refuseEnEntier([zone, p1, p2], p2);
    });

    it('même code dans une autre zone de la ferme : accepté', async () => {
      const z1 = await zoneEn(ferme);
      const z2 = await zoneEn(ferme);
      await plancheEn(ferme, z1, 'P3');
      await accepte([putEmplacement(z2, 'P3')]);
    });

    it('le premier supprimé avant : accepté', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3', true);
      await accepte([putEmplacement(zone, 'P3')]);
    });

    it('le premier supprimé plus haut dans le même lot (planche redessinée) : accepté', async () => {
      const zone = await zoneEn(ferme);
      const ancienne = await plancheEn(ferme, zone, 'P3');
      await accepte([supprimer('emplacement', ancienne), putEmplacement(zone, 'P3')]);
    });

    it('renvoi identique d’un PUT (réponse perdue) : accepté, rien en double', async () => {
      const zone = await zoneEn(ferme);
      const p = putEmplacement(zone, 'P3');
      await accepte([p]);
      await accepte([p]);
      expect(await compter(`SELECT 1 FROM emplacement WHERE zone_id = $1 AND code = 'P3'`, [zone])).toBe(1);
    });

    it('PATCH du code vers un code pris dans la zone : refusé, inchangé', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3');
      const p4 = await plancheEn(ferme, zone, 'P4');
      const p = patch('emplacement', p4, { code: 'P3' });
      expect(await refuseEnEntier([p], p)).toMatch(/déjà/iu);
    });

    it('PATCH qui range l’emplacement dans une zone où son code est pris : refusé, inchangé', async () => {
      const z1 = await zoneEn(ferme);
      const z2 = await zoneEn(ferme);
      await plancheEn(ferme, z1, 'P3');
      const autre = await plancheEn(ferme, z2, 'P3');
      const p = patch('emplacement', autre, { zone_id: z1 });
      await refuseEnEntier([p], p);
    });

    it('rétablir un emplacement dont le code a été repris entre-temps dans sa zone : refusé, inchangé', async () => {
      const zone = await zoneEn(ferme);
      const ancienne = await plancheEn(ferme, zone, 'P3', true);
      await plancheEn(ferme, zone, 'P3');
      const r = retablir('emplacement', ancienne);
      await refuseEnEntier([r], r);
    });

    it('droits ordinaires : un équipier reçoit le même refus ; autre zone, accepté', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3');
      const p = putEmplacement(zone, 'P3');
      await refuseEnEntier([p], p, paul.jeton);
      await accepte([putEmplacement(await zoneEn(ferme), 'P3')], paul.jeton);
    });

    it('isolement : un emplacement d’une autre ferme rangé dans la zone (écrit en base) ne bloque pas le code', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(voisine, zone, 'P3');
      await accepte([putEmplacement(zone, 'P3')]);
    });
  });
});
