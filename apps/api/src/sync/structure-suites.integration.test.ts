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
 *    « 1 variété », « 2 variétés », « 1 itinéraire », « 2 itinéraires »).
 *
 *    Saison non terminée (décision du chef, révisée : l'historique ne bloque rien) : une saison
 *    est TERMINÉE quand sa date de fin (`saison.fin`, date sans heure) est strictement avant la
 *    date du jour dans le fuseau de la ferme (Europe/Paris), à l'heure du serveur ; sinon (en
 *    cours, y compris le jour de sa fin, ou future) elle est NON TERMINÉE.
 *
 *      zone          assolements actifs (supprime_le nul) dont zone_id est la zone ET dont la
 *                    saison n'est pas terminée ;
 *      emplacement   idem avec emplacement_id ;
 *      saison        assolements actifs dont saison_id est la saison, qu'elle soit terminée ou
 *                    non (c'est son plan) ;
 *      espèce        variétés actives, itinéraires actifs, et assolements actifs d'une saison
 *                    non terminée dont espece_id est l'espèce (le message compte ce qui bloque).
 *    Les assolements d'une saison terminée restent actifs et rattachés à la zone, à
 *    l'emplacement ou à l'espèce supprimés (suppression douce) : ils n'empêchent rien.
 *    Ne comptent que les lignes actives DE LA MÊME FERME : une ligne supprimée ne compte pas, une
 *    ligne d'une autre ferme qui désignerait la ligne (écrite directement en base) non plus.
 *    Une ligne supprimée plus haut dans le même lot ne compte plus. Droits ordinaires (T10s) :
 *    même règle pour un équipier que pour le gérant.
 *
 * 4. Changer la famille d'une espèce (PATCH de famille_id vers une autre valeur) est refusé tant
 *    que des assolements actifs de la même ferme, d'une saison NON TERMINÉE (critère du 3),
 *    désignent cette espèce → 'ecriture_invalide', espèce inchangée, message qui parle des
 *    assolements. Sinon accepté. La famille est COPIÉE dans l'assolement (assolement.famille_id,
 *    obligatoire) : l'historique garde la famille de l'époque, il n'est pas réécrit. Un PATCH qui
 *    ne change pas la famille (nom, renvoi identique) reste accepté. Mêmes règles de comptage.
 *
 * 5. Q27 (réponse du 2026-10-07) : le code d'un emplacement est unique PAR ZONE parmi les
 *    emplacements non supprimés de la ferme, comparé SANS CASSE et SANS ESPACES de début et de
 *    fin (« P3 » = « p3 » = « P3 »).
 *    - Base : index unique partiel sur (ferme_id, zone_id, lower(trim(code)))
 *      `WHERE supprime_le IS NULL AND actif_au IS NULL` (décision D, point 6) ; deux emplacements actifs de même code dans la même zone ne
 *      peuvent pas coexister (23505) ; un emplacement supprimé ne bloque pas ; même code dans une
 *      autre zone : permis ; une ligne d'une autre ferme ne bloque jamais.
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
 *      ferme est un doublon, pas écrite ; les autres passent »). L'import compare encore sur
 *      toute la ferme : ticket de suite (décision du chef). Risque connu : un import hors ligne
 *      qui recoupe une planche créée ailleurs et pas encore reçue est refusé en entier, proprement.
 *
 * 6. Relecture du chef.
 *    A. Un assolement actif qui passe d'une saison terminée à une saison non terminée (PATCH de
 *       saison_id) revérifie toutes ses références comme un rétablissement : zone, emplacement ou
 *       espèce supprimés → 'ecriture_invalide' ; C. famille différente de celle (actuelle) de son
 *       espèce → refusé aussi (message qui parle de la famille).
 *    B. Prolonger une saison terminée (PATCH de `fin` qui la rend non terminée, critère du 3) est
 *       refusé si des assolements actifs de la ferme, de cette saison, désignent une zone, un
 *       emplacement ou une espèce supprimés, ou une espèce dont la famille n'est plus la leur ;
 *       le message compte ces assolements. Sinon accepté.
 *    D. Une planche retirée (actif_au renseigné, non supprimée) ne réserve plus son code :
 *       l'unicité (index et serveur) ne porte que sur les emplacements non supprimés ET actifs
 *       (`actif_au IS NULL`). Remettre en service une planche retirée dont le code est repris :
 *       refusé.
 *    Échanger deux codes dans un même lot est refusé (la première modification prend un code
 *    encore pris) ; on passe par un code temporaire.
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
  /** Saison en cours (2026), passée (2024, terminée) et future (2027). */
  let saison: string;
  let saisonPassee: string;
  let saisonFuture: string;
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

  /** Saison de la ferme ; par défaut l'année en cours (2026 : non terminée au 1er octobre). */
  async function saisonEn(fermeId: string, debut = '2026-01-01', fin = '2026-12-31'): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, $3, $4, $5)`, [id, fermeId, unique('Saison'), debut, fin]);
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
    saisonPassee = await saisonEn(ferme, '2024-01-01', '2024-12-31');
    saisonFuture = await saisonEn(ferme, '2027-01-01', '2027-12-31');
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
      const planche = await plancheEn(ferme, await zoneEn(ferme));
      const { serie } = await serieTermineeSur(planche);
      await accepte([patch('serie', serie, { statut })]);
      expect((await ligne('serie', serie))?.statut).toBe(statut);
      expect(await derniereOperation(serie)).toBe('modification');
    });

    it('un lot qui rétablit l’emplacement puis réactive la série : accepté en entier', async () => {
      const planche = await plancheEn(ferme, await zoneEn(ferme));
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
    assolement(o?: { readonly voisine?: boolean; readonly supprime?: boolean; readonly saisonId?: string }): Promise<string>;
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
              saisonId: o.voisine === true ? saisonVoisine : (o.saisonId ?? saison),
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
              saisonId: o.voisine === true ? saisonVoisine : (o.saisonId ?? saison),
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

  describe.each(CIBLES.filter(([t]) => t !== 'saison'))('%s : seuls les assolements des saisons non terminées retiennent la ligne', (table, preparer) => {
    it('seulement des assolements actifs d’une saison passée : acceptée, les assolements restent actifs et rattachés à la ligne supprimée', async () => {
      const c = await preparer();
      const a1 = await c.assolement({ saisonId: saisonPassee });
      const a2 = await c.assolement({ saisonId: saisonPassee });
      await accepte([supprimer(table, c.id)]);
      expect((await ligne(table as TableLue, c.id))?.supprime_le).not.toBeNull();
      for (const a of [a1, a2]) {
        const l = await ligne('assolement', a);
        expect(l?.supprime_le, 'assolement de l’historique toujours actif').toBeNull();
        expect(l?.[table === 'zone' ? 'zone_id' : 'emplacement_id'], 'toujours rattaché à la ligne supprimée').toBe(c.id);
      }
    });

    it('assolement d’une saison future : refusée, « 1 assolement »', async () => {
      const c = await preparer();
      await c.assolement({ saisonId: saisonFuture });
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'assolement'));
    });

    it('2 assolements de la saison en cours et 3 d’une saison passée : refusée, le message dit « 2 assolements »', async () => {
      const c = await preparer();
      await c.assolement();
      await c.assolement();
      for (let i = 0; i < 3; i++) await c.assolement({ saisonId: saisonPassee });
      const s = supprimer(table, c.id);
      expect(await refuseEnEntier([s], s)).toMatch(compte(2, 'assolements'));
    });

    it('bord du fuseau : saison finie le 1er octobre ; à 23:55 à Paris le 1er elle est en cours (refusée), à 00:05 le 2 elle est terminée (acceptée ; le jour UTC dirait encore le 1er)', async () => {
      const finie = await saisonEn(ferme, '2026-01-01', '2026-10-01');
      const c = await preparer();
      await c.assolement({ saisonId: finie });
      const s = supprimer(table, c.id);
      await a('2026-10-01T21:55:00.000Z', (j) => refuseEnEntier([s], s, j));
      await a('2026-10-01T22:05:00.000Z', (j) => accepte([s], j));
      expect((await ligne(table as TableLue, c.id))?.supprime_le).not.toBeNull();
    });
  });

  describe('saison : son plan la retient, passée ou non', () => {
    it('saison passée qui a encore des assolements actifs : suppression refusée, « 1 assolement »', async () => {
      const passee = await saisonEn(ferme, '2023-01-01', '2023-12-31');
      await assolementEn({ fermeId: ferme, saisonId: passee, zoneId: zoneFerme, familleId: famille });
      const s = supprimer('saison', passee);
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

    it('assolement actif de la saison en cours qui la désigne : refusée, « 1 assolement »', async () => {
      const espece = await especeEn(ferme, famille);
      await assolementEn({ fermeId: ferme, saisonId: saison, zoneId: zoneFerme, familleId: famille, especeId: espece });
      const s = supprimer('espece', espece);
      expect(await refuseEnEntier([s], s)).toMatch(compte(1, 'assolement'));
    });

    it('assolement actif d’une saison future : refusée', async () => {
      const espece = await especeEn(ferme, famille);
      await assolementEn({ fermeId: ferme, saisonId: saisonFuture, zoneId: zoneFerme, familleId: famille, especeId: espece });
      const s = supprimer('espece', espece);
      await refuseEnEntier([s], s);
    });

    it('seulement des assolements actifs d’une saison passée (ou supprimés) : acceptée, l’historique reste actif', async () => {
      const espece = await especeEn(ferme, famille);
      const historique = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, zoneId: zoneFerme, familleId: famille, especeId: espece });
      await assolementEn({ fermeId: ferme, saisonId: saison, zoneId: zoneFerme, familleId: famille, especeId: espece, supprime: true });
      await accepte([supprimer('espece', espece)]);
      expect((await ligne('assolement', historique))?.supprime_le).toBeNull();
    });

    it('isolement : un assolement d’une autre ferme qui la désignerait ne compte pas', async () => {
      const espece = await especeEn(ferme, famille);
      await assolementEn({ fermeId: voisine, saisonId: saisonVoisine, zoneId: zoneVoisine, familleId: familleVoisine, especeId: espece });
      await accepte([supprimer('espece', espece)]);
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
    async function especeAvecAssolements(o: {
      readonly actifs: number;
      readonly supprimes?: number;
      readonly voisins?: number;
      readonly saisonId?: string;
    }): Promise<{ espece: string; assolements: string[] }> {
      const espece = await especeEn(ferme, famille);
      const assolements: string[] = [];
      for (let i = 0; i < o.actifs; i++) {
        assolements.push(await assolementEn({ fermeId: ferme, saisonId: o.saisonId ?? saison, zoneId: zoneFerme, familleId: famille, especeId: espece }));
      }
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

    it('assolement actif d’une saison future : refusé', async () => {
      const autre = await familleEn(ferme);
      const { espece } = await especeAvecAssolements({ actifs: 1, saisonId: saisonFuture });
      const p = patch('espece', espece, { famille_id: autre });
      expect(await refuseEnEntier([p], p)).toMatch(/assolement/iu);
    });

    it('seulement des assolements actifs d’une saison passée : accepté ; l’historique garde la famille de l’époque (copiée dans l’assolement)', async () => {
      const autre = await familleEn(ferme);
      const { espece, assolements } = await especeAvecAssolements({ actifs: 2, saisonId: saisonPassee });
      await accepte([patch('espece', espece, { famille_id: autre })]);
      expect((await ligne('espece', espece))?.famille_id).toBe(autre);
      for (const a of assolements) {
        const l = await ligne('assolement', a);
        expect(l?.famille_id, 'famille de l’époque').toBe(famille);
        expect(l?.supprime_le).toBeNull();
      }
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

    it.each(['p3', ' P3', 'P3 ', ' p3 '])('« P3 » puis « %s » dans la même zone : refusé par la base (sans casse ni espaces autour)', async (variante) => {
      const zone = await zoneEn(ferme);
      await insertion(zone, 'P3');
      await expect(insertion(zone, variante)).rejects.toMatchObject({ code: '23505' });
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

    it.each(['p3', ' P3 ', ' p3'])('PUT de « %s » quand « P3 » est pris dans la zone : refusé proprement (sans casse ni espaces autour)', async (variante) => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3');
      const p = putEmplacement(zone, variante);
      expect(await refuseEnEntier([p], p)).toMatch(/déjà/iu);
    });

    it('PATCH du code vers « p3 » quand « P3 » est pris dans la zone : refusé, inchangé', async () => {
      const zone = await zoneEn(ferme);
      await plancheEn(ferme, zone, 'P3');
      const p4 = await plancheEn(ferme, zone, 'P4');
      const p = patch('emplacement', p4, { code: 'p3' });
      await refuseEnEntier([p], p);
    });

    it('import : « P3 » et « p3 » dans la même zone neuve, dans le même lot : refusé en entier', async () => {
      const zone = putZone();
      const p1 = putEmplacement(zone.id, 'P3');
      const p2 = putEmplacement(zone.id, 'p3');
      await refuseEnEntier([zone, p1, p2], p2);
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

  // ── 6. Relecture du chef : failles de l'historique, prolongation, planche retirée ───────────

  /** Une ligne que l'historique seul désigne, puis supprimée (accepté), et l'assolement passé qui la désigne. */
  const SUPPRIMEES: readonly (readonly [string, () => Promise<{ assolement: string }>])[] = [
    [
      'zone',
      async () => {
        const z = await zoneEn(ferme);
        const a = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, zoneId: z, familleId: famille });
        await accepte([supprimer('zone', z)]);
        return { assolement: a };
      },
    ],
    [
      'emplacement',
      async () => {
        const e = await plancheEn(ferme, await zoneEn(ferme));
        const a = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, emplacementId: e, familleId: famille });
        await accepte([supprimer('emplacement', e)]);
        return { assolement: a };
      },
    ],
    [
      'espece',
      async () => {
        const e = await especeEn(ferme, famille);
        const a = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, zoneId: await zoneEn(ferme), familleId: famille, especeId: e });
        await accepte([supprimer('espece', e)]);
        return { assolement: a };
      },
    ],
  ];

  describe.each(SUPPRIMEES)('faille A : un assolement passé dont la ligne « %s » a été supprimée ne revient pas dans le plan', (_cible, preparer) => {
    it('PATCH qui le range dans la saison en cours : refusé, rien d’écrit', async () => {
      const { assolement } = await preparer();
      const p = patch('assolement', assolement, { saison_id: saison });
      expect(await refuseEnEntier([p], p)).toMatch(/supprim/iu);
    });

    it('PATCH qui le range dans une saison future : refusé', async () => {
      const { assolement } = await preparer();
      const p = patch('assolement', assolement, { saison_id: saisonFuture });
      await refuseEnEntier([p], p);
    });
  });

  it('faille A, témoin : zone toujours active, l’assolement passé se range dans la saison en cours', async () => {
    const z = await zoneEn(ferme);
    const a = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, zoneId: z, familleId: famille });
    await accepte([patch('assolement', a, { saison_id: saison })]);
    expect((await ligne('assolement', a))?.saison_id).toBe(saison);
  });

  describe('faille C : un assolement passé dont l’espèce a changé de famille ne revient pas tel quel dans le plan', () => {
    async function especeQuiAChangeDeFamille(): Promise<{ espece: string; assolement: string; nouvelle: string }> {
      const espece = await especeEn(ferme, famille);
      const assolement = await assolementEn({ fermeId: ferme, saisonId: saisonPassee, zoneId: await zoneEn(ferme), familleId: famille, especeId: espece });
      const nouvelle = await familleEn(ferme);
      // Seul l'historique la désigne : le changement de famille est accepté (décision du chef).
      await accepte([patch('espece', espece, { famille_id: nouvelle })]);
      return { espece, assolement, nouvelle };
    }

    it('PATCH qui le range dans la saison en cours avec l’ancienne famille : refusé (famille ≠ celle de l’espèce), rien d’écrit', async () => {
      const { assolement } = await especeQuiAChangeDeFamille();
      const p = patch('assolement', assolement, { saison_id: saison });
      expect(await refuseEnEntier([p], p)).toMatch(/famille/iu);
    });

    it('témoin : rangé dans la saison en cours avec la nouvelle famille de l’espèce : accepté', async () => {
      const { assolement, nouvelle } = await especeQuiAChangeDeFamille();
      await accepte([patch('assolement', assolement, { saison_id: saison, famille_id: nouvelle })]);
      expect((await ligne('assolement', assolement))?.famille_id).toBe(nouvelle);
    });
  });

  describe('décision B : prolonger une saison terminée dont le plan désigne des lignes supprimées ou une espèce changée de famille', () => {
    /** Saison 2024 (terminée), avec un assolement actif sur une ligne ensuite supprimée (ou une espèce changée de famille). */
    async function saisonAvec(defauts: readonly ('zone' | 'emplacement' | 'espece' | 'famille')[], sains = 0): Promise<string> {
      const s = await saisonEn(ferme, '2024-01-01', '2024-12-31');
      for (const d of defauts) {
        switch (d) {
          case 'zone': {
            const z = await zoneEn(ferme);
            await assolementEn({ fermeId: ferme, saisonId: s, zoneId: z, familleId: famille });
            await accepte([supprimer('zone', z)]);
            break;
          }
          case 'emplacement': {
            const e = await plancheEn(ferme, await zoneEn(ferme));
            await assolementEn({ fermeId: ferme, saisonId: s, emplacementId: e, familleId: famille });
            await accepte([supprimer('emplacement', e)]);
            break;
          }
          case 'espece': {
            const e = await especeEn(ferme, famille);
            await assolementEn({ fermeId: ferme, saisonId: s, zoneId: zoneFerme, familleId: famille, especeId: e });
            await accepte([supprimer('espece', e)]);
            break;
          }
          case 'famille': {
            const e = await especeEn(ferme, famille);
            await assolementEn({ fermeId: ferme, saisonId: s, zoneId: zoneFerme, familleId: famille, especeId: e });
            await accepte([patch('espece', e, { famille_id: await familleEn(ferme) })]);
            break;
          }
        }
      }
      for (let i = 0; i < sains; i++) await assolementEn({ fermeId: ferme, saisonId: s, zoneId: zoneFerme, familleId: famille });
      return s;
    }

    it.each(['zone', 'emplacement', 'espece', 'famille'] as const)(
      'un assolement actif dont le défaut est « %s » : prolongation jusqu’en 2026 refusée, « 1 assolement », saison inchangée',
      async (defaut) => {
        const s = await saisonAvec([defaut], 2);
        const p = patch('saison', s, { fin: '2026-12-31' });
        expect(await refuseEnEntier([p], p)).toMatch(compte(1, 'assolement'));
        expect((await ligne('saison', s))?.fin).toBe('2024-12-31');
      },
    );

    it('deux assolements en défaut (zone supprimée, espèce changée de famille) et des sains : le message dit « 2 assolements »', async () => {
      const s = await saisonAvec(['zone', 'famille'], 3);
      const p = patch('saison', s, { fin: '2027-06-30' });
      expect(await refuseEnEntier([p], p)).toMatch(compte(2, 'assolements'));
    });

    it('bord : fin repoussée au jour même (1er octobre 2026, à Paris) : la saison redevient en cours, refusée', async () => {
      const s = await saisonAvec(['zone']);
      const p = patch('saison', s, { fin: '2026-10-01' });
      await refuseEnEntier([p], p);
    });

    it('fin repoussée mais encore passée (30 septembre 2026) : la saison reste terminée, acceptée', async () => {
      const s = await saisonAvec(['zone']);
      await accepte([patch('saison', s, { fin: '2026-09-30' })]);
      expect((await ligne('saison', s))?.fin).toBe('2026-09-30');
    });

    it('sans assolement en défaut (ou seulement des assolements supprimés) : prolongation acceptée', async () => {
      const s = await saisonAvec([], 2);
      const z = await zoneEn(ferme);
      await assolementEn({ fermeId: ferme, saisonId: s, zoneId: z, familleId: famille, supprime: true });
      await accepte([supprimer('zone', z)]);
      await accepte([patch('saison', s, { fin: '2026-12-31' })]);
      expect((await ligne('saison', s))?.fin).toBe('2026-12-31');
    });

    it('assolement en défaut supprimé plus haut dans le même lot : prolongation acceptée', async () => {
      const s = await saisonEn(ferme, '2024-01-01', '2024-12-31');
      const z = await zoneEn(ferme);
      const a = await assolementEn({ fermeId: ferme, saisonId: s, zoneId: z, familleId: famille });
      await accepte([supprimer('zone', z)]);
      await accepte([supprimer('assolement', a), patch('saison', s, { fin: '2026-12-31' })]);
    });

    it('droits ordinaires : un équipier reçoit le même refus', async () => {
      const s = await saisonAvec(['emplacement']);
      const p = patch('saison', s, { fin: '2026-12-31' });
      expect(await refuseEnEntier([p], p, paul.jeton)).toMatch(compte(1, 'assolement'));
    });

    it('isolement : un assolement d’une autre ferme qui désignerait la saison (zone voisine supprimée) ne compte pas', async () => {
      const s = await saisonAvec([]);
      const zv = await zoneEn(voisine);
      await assolementEn({ fermeId: voisine, saisonId: s, zoneId: zv, familleId: familleVoisine });
      await base.pool.query(`UPDATE zone SET supprime_le = $2 WHERE id = $1`, [zv, MAINTENANT]);
      await accepte([patch('saison', s, { fin: '2026-12-31' })]);
    });
  });

  describe('décision D : une planche retirée (actif_au renseigné, non supprimée) ne réserve plus son code', () => {
    async function retireeEn(zoneId: string, code: string): Promise<string> {
      const id = await plancheEn(ferme, zoneId, code);
      await base.pool.query(`UPDATE emplacement SET actif_au = '2026-06-30' WHERE id = $1`, [id]);
      return id;
    }

    it('base : « P3 » retirée puis « P3 » active dans la même zone : permis ; deux retirées aussi', async () => {
      const zone = await zoneEn(ferme);
      await retireeEn(zone, 'P3');
      await retireeEn(zone, 'p3');
      await plancheEn(ferme, zone, 'P3');
      expect(await compter(`SELECT 1 FROM emplacement WHERE zone_id = $1 AND supprime_le IS NULL`, [zone])).toBe(3);
    });

    it('base : deux planches actives (actif_au nul) restent uniques', async () => {
      const zone = await zoneEn(ferme);
      await retireeEn(zone, 'P3');
      await plancheEn(ferme, zone, 'P3');
      await expect(plancheEn(ferme, zone, 'P3')).rejects.toMatchObject({ code: '23505' });
    });

    it('serveur : PUT de « P3 » quand la « P3 » de la zone est retirée (planches redessinées) : accepté', async () => {
      const zone = await zoneEn(ferme);
      await retireeEn(zone, 'P3');
      await accepte([putEmplacement(zone, 'P3')]);
    });

    it('serveur : retirer l’ancienne « P3 » (actif_au) puis créer la nouvelle dans le même lot : accepté', async () => {
      const zone = await zoneEn(ferme);
      const ancienne = await plancheEn(ferme, zone, 'P3');
      await accepte([patch('emplacement', ancienne, { actif_au: '2026-09-30' }), putEmplacement(zone, 'P3')]);
    });

    it('serveur : remettre en service (actif_au nul) une « P3 » retirée quand une « P3 » active existe : refusé', async () => {
      const zone = await zoneEn(ferme);
      const ancienne = await retireeEn(zone, 'P3');
      await plancheEn(ferme, zone, 'P3');
      const p = patch('emplacement', ancienne, { actif_au: null });
      expect(await refuseEnEntier([p], p)).toMatch(/déjà/iu);
    });
  });

  describe('échanger deux codes dans une zone', () => {
    it('« P3 » ↔ « P4 » dans le même lot : refusé (la première écriture prend un code encore pris), rien d’écrit', async () => {
      const zone = await zoneEn(ferme);
      const p3 = await plancheEn(ferme, zone, 'P3');
      const p4 = await plancheEn(ferme, zone, 'P4');
      const premier = patch('emplacement', p3, { code: 'P4' });
      await refuseEnEntier([premier, patch('emplacement', p4, { code: 'P3' })], premier);
    });

    it('en passant par un code temporaire, dans le même lot : accepté', async () => {
      const zone = await zoneEn(ferme);
      const p3 = await plancheEn(ferme, zone, 'P3');
      const p4 = await plancheEn(ferme, zone, 'P4');
      await accepte([patch('emplacement', p3, { code: 'P3-temp' }), patch('emplacement', p4, { code: 'P3' }), patch('emplacement', p3, { code: 'P4' })]);
      expect((await ligne('emplacement', p3))?.code).toBe('P4');
      expect((await ligne('emplacement', p4))?.code).toBe('P3');
    });
  });
});
