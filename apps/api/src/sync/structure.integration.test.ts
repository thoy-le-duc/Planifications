/**
 * Tests d'acceptation T10s — POST /sync/upload accepte le parcellaire et le catalogue propre à la
 * ferme écrits par les téléphones (import fait hors ligne de T14b, écrans de structure), contre
 * un vrai Postgres (même amorçage que serie.integration.test.ts et itineraire.integration.test.ts :
 * DATABASE_URL, base jetable `t10s_structure_…` supprimée à la fin ; sans DATABASE_URL, échec en
 * CI et saut signalé en local).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Une ferme crée ou modifie ses zones, emplacements, saisons, assolements, et ses familles,
 * espèces et variétés à elle, même hors ligne : un import de 200 lignes fait au champ doit tenir
 * après la synchro au lieu d'être annulé (« table_interdite »). Jamais de lecture ni d'écriture
 * dans une autre ferme, jamais d'écriture dans la bibliothèque commune (ferme_id nul).
 *
 * ── Contrat (en plus de T10, T10c, T10d, T10e et T23) ───────────────────────────────────────
 *
 * Tables ouvertes : `zone`, `emplacement`, `saison`, `assolement` (toujours d'une ferme) ;
 * `famille`, `espece`, `variete` pour les lignes de la ferme seulement. Module attendu :
 * apps/api/src/sync/structure.ts (même modèle que serie.ts et itineraire.ts), branché dans
 * upload.ts (TABLES_ECRITES et TABLES_TOUT_OU_RIEN). Colonnes reçues : celles de Postgres, au
 * format PowerSync (packages/sync/src/schema.ts : booléens en entier 0/1, numeric en nombre,
 * dates 'AAAA-MM-JJ', tableau d'UUID `remplace` en texte JSON) ; `cree_le` et `modifie_le`
 * tolérées et remplies par le serveur ; `id` dans les données → 'ecriture_invalide'.
 *
 *   PUT     crée la ligne. `ferme_id` d'une ferme dont l'utilisateur n'est pas membre actif
 *           (autre ferme, membre retiré, invitation pas encore acceptée) → 'ferme_interdite'.
 *           `ferme_id` nul ou absent (écrire dans la bibliothèque commune) → 'ecriture_invalide'.
 *           Renvoi identique : accepté, rien d'écrit. Même id avec d'autres valeurs, ou id d'une
 *           ligne de la bibliothèque ou d'une autre ferme → 'ecriture_invalide', la ligne
 *           existante ne change pas.
 *   PATCH   modifie une ligne de la ferme. Ligne introuvable, d'une autre ferme OU de la
 *           bibliothèque → 'ecriture_invalide', ferme nulle dans refus_synchro (T10d). PATCH de
 *           `ferme_id` vers une autre valeur → refusé ('ecriture_invalide', ou 'ferme_interdite'
 *           vers une ferme étrangère), rien ne change.
 *   Suppression douce : PATCH de `supprime_le`. Refusée ('ecriture_invalide', message qui dit
 *           pourquoi) si la ligne sert encore :
 *             emplacement   occupation non supprimée d'une série non supprimée au statut
 *                           'prevue' ou 'en_cours', ou d'une plantation en place (sans
 *                           date d'arrachage) ;
 *             espèce        série non supprimée au statut 'prevue' ou 'en_cours' ;
 *             zone          emplacement non supprimé dans la zone.
 *           Libre (aucune occupation, occupation supprimée, série terminée ou supprimée) :
 *           acceptée. Une occupation supprimée plus haut dans le même lot libère l'emplacement.
 *   DELETE  refusé ('table_interdite' ou 'ajout_seul'), rien ne change.
 *
 * Références, relues en base dans la transaction (filtrées par ferme : une ligne d'une autre
 * ferme se comporte comme une ligne inexistante) ; supprimée, introuvable, d'une autre ferme (y
 * compris une autre ferme du même utilisateur) → 'ecriture_invalide' :
 *   de la MÊME ferme                     zone.zone_parente_id, emplacement.zone_id,
 *                                        emplacement.remplace (chaque id), assolement.saison_id,
 *                                        assolement.zone_id, assolement.emplacement_id
 *   de la ferme OU de la bibliothèque    espece.famille_id, variete.espece_id,
 *                                        assolement.famille_id, assolement.espece_id
 * Une ligne peut désigner une ligne écrite plus haut dans le même lot (import).
 *
 * Validation : les règles du schéma et du moteur, rejouées par le serveur (noms non vides et
 * bornés, valeurs des listes fermées, longueurs et surfaces > 0, gouttière ⇔ nombre de places,
 * périodes dans l'ordre, délais de retour, taux de germination 0–100, assolement à une seule
 * cible, source d'import réservée au passé importé, dates réelles du calendrier) ; violée →
 * 'ecriture_invalide', message en français sans jargon (test/jargon.ts), de la forme de T10j.
 *
 * Tout ou rien : un lot qui contient une écriture sur l'une de ces tables est accepté ou refusé
 * EN ENTIER (avec les séries, occupations, itinéraires, événements et le stock du même lot) ;
 * chaque écriture d'un lot refusé a son refus, la fautive avec son motif.
 *
 * Historique, écrit par le serveur dans la même transaction, une ligne `modification` par ligne
 * touchée : nom_table 'Zone', 'Emplacement', 'Famille', 'Espece', 'Variete', 'Saison' ou
 * 'Assolement', ferme_id, ligne_id, auteur_id = utilisateur du jeton, proposition_id NULL ;
 * operation 'creation' (avant NULL), 'modification' ou 'suppression' (supprime_le de NULL à une
 * valeur), apres = la ligne écrite (to_jsonb).
 *
 * Hors de ce fichier : « l'import redescend sur un second téléphone » relève de e2e:synchro
 * (Docker, page de diagnostic dans apps/web) ; les règles de synchro (powersync/sync-config.yaml)
 * font déjà descendre ces tables.
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

type TableStructure = 'zone' | 'emplacement' | 'famille' | 'espece' | 'variete' | 'saison' | 'assolement';
type TableLue = TableStructure | 'serie' | 'occupation' | 'itineraire' | 'evenement';

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
  'evenement',
]);

const NOM_ENTITE: Readonly<Record<TableStructure, string>> = {
  zone: 'Zone',
  emplacement: 'Emplacement',
  famille: 'Famille',
  espece: 'Espece',
  variete: 'Variete',
  saison: 'Saison',
  assolement: 'Assolement',
};

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface RefusRecu {
  readonly table: string;
  readonly id: string;
  readonly motif: string;
}

interface ReponseUpload {
  readonly refus: readonly RefusRecu[];
}

type Ligne = Record<string, unknown>;

interface LigneHistorique {
  readonly ferme_id: string;
  readonly nom_table: string;
  readonly ligne_id: string;
  readonly auteur_id: string;
  readonly operation: string;
  readonly avant: Ligne | null;
  readonly apres: Ligne | null;
  readonly proposition_id: string | null;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

/** Horloge du serveur : avance d'une milliseconde à chaque lecture. */
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const MOTIFS_DELETE = ['table_interdite', 'ajout_seul'];
/** Id d'une zone qui n'existe pas, tiré une seule fois : le PATCH et la lecture du refus visent le même. */
const ZONE_INTROUVABLE = randomUUID();
const SUPPRIME_LE = '2026-10-01T06:30:00.000Z';
/** Début du message d'un refus 'ecriture_invalide' (messages.ts), suivi de « : <précision>. ». */
const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';

/** Instantané de l'itinéraire batavia (T02 : plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j). */
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

/** Dates de T02 : récolte à partir de la S22 2027 (lundi 2027-05-31). */
const DATES_S22 = {
  ancre_type: 'debut_recolte',
  ancre_date: '2027-05-31',
  prevu_semis_pepiniere: '2027-03-15',
  prevu_mise_en_place: '2027-04-12',
  prevu_debut_recolte: '2027-05-31',
  prevu_fin_recolte: '2027-06-14',
} as const;
const OCCUPATION_S22 = { prevu_du: '2027-04-12', prevu_au: '2027-06-14' } as const;

decrireAvecBase('T10s')('T10s : POST /sync/upload accepte le parcellaire et le catalogue de la ferme', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme principale, et membre aussi d'une seconde ferme. */
  let theo: { id: string; jeton: string };
  /** Membre retiré de la ferme principale. */
  let retire: { id: string; jeton: string };
  /** Invité de la ferme principale, invitation pas encore acceptée. */
  let invite: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;

  /** Lignes de la ferme principale, écrites directement en base. */
  let famille: string;
  let saison: string;
  let saisonSupprimee: string;
  let laitue: string;
  let itineraire: string;
  let zoneFerme: string;
  let zoneSupprimee: string;
  let plancheFerme: string;
  /** Bibliothèque commune (ferme_id nul). */
  let familleBibliotheque: string;
  let especeBibliotheque: string;
  let varieteBibliotheque: string;
  /** Seconde ferme de Théophane. */
  let zoneSeconde: string;
  let saisonSeconde: string;
  let familleSeconde: string;
  /** Ferme voisine. */
  let zoneVoisine: string;
  let plancheVoisine: string;
  let saisonVoisine: string;
  let familleVoisine: string;
  let especeVoisine: string;
  let varieteVoisine: string;

  let compteur = 0;
  const unique = (prefixe: string): string => `${prefixe}-${String(++compteur)}`;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function inserer(sql: string, valeurs: readonly unknown[]): Promise<void> {
    await base.pool.query(sql, [...valeurs]);
  }

  // ── Lignes écrites directement en base ──────────────────────────────────────────────────────

  async function familleEn(fermeId: string | null): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Astéracées', 2, 3)`, [
      id,
      fermeId,
    ]);
    return id;
  }

  async function especeEn(fermeId: string | null, familleId: string, nom = 'Laitue'): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, $4, 'legume', false, 'piece')`,
      [id, fermeId, familleId, nom],
    );
    return id;
  }

  async function varieteEn(fermeId: string | null, especeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Batavia blonde')`, [id, fermeId, especeId]);
    return id;
  }

  async function saisonEn(fermeId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO saison (id, ferme_id, nom, debut, fin, supprime_le) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31', $3)`, [
      id,
      fermeId,
      supprimee ? MAINTENANT : null,
    ]);
    return id;
  }

  async function zoneEn(fermeId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO zone (id, ferme_id, nom, type_abri, supprime_le) VALUES ($1, $2, 'Tunnel 2', 'tunnel', $3)`, [
      id,
      fermeId,
      supprimee ? MAINTENANT : null,
    ]);
    return id;
  }

  async function plancheEn(fermeId: string, zoneId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, supprime_le)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5)`,
      [id, fermeId, zoneId, unique('T2-P'), supprimee ? MAINTENANT : null],
    );
    return id;
  }

  /** Série batavia de la ferme principale, au statut donné. */
  async function serieEn(statut: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres, ancre_type, ancre_date,
                          prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut, supprime_le)
       VALUES ($1, $2, $3, $4, $5, $6, 'debut_recolte', '2027-05-31', '2027-03-15', '2027-04-12', '2027-05-31', '2027-06-14', 30, $7, $8)`,
      [id, ferme, saison, laitue, itineraire, JSON.stringify(BATAVIA), statut, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  /** Occupation de 30 m de la série sur l'emplacement, aux dates de la série. */
  async function occupationEn(emplacementId: string, serieId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, longueur_m, prevu_du, prevu_au, supprime_le)
       VALUES ($1, $2, $3, $4, 30, '2027-04-12', '2027-06-14', $5)`,
      [id, ferme, emplacementId, serieId, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10s_structure');
    cles = { active: await genererCleSignature('cle-t10s'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site de Théophane');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    const i = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, r.id, ferme, { role: 'equipier', retire: true });
    await ajouterMembre(base.pool, i.id, ferme, { role: 'equipier', etat: 'invite', invitePar: u.id });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
    invite = { id: i.id, jeton: await jetonPour(i.id) };

    famille = await familleEn(ferme);
    saison = await saisonEn(ferme);
    saisonSupprimee = await saisonEn(ferme, true);
    laitue = await especeEn(ferme, famille);
    itineraire = randomUUID();
    await inserer(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4)`,
      [itineraire, ferme, laitue, JSON.stringify(BATAVIA)],
    );
    zoneFerme = await zoneEn(ferme);
    zoneSupprimee = await zoneEn(ferme, true);
    plancheFerme = await plancheEn(ferme, zoneFerme);

    familleBibliotheque = await familleEn(null);
    especeBibliotheque = await especeEn(null, familleBibliotheque);
    varieteBibliotheque = await varieteEn(null, especeBibliotheque);

    zoneSeconde = await zoneEn(secondeFerme);
    saisonSeconde = await saisonEn(secondeFerme);
    familleSeconde = await familleEn(secondeFerme);

    zoneVoisine = await zoneEn(autreFerme);
    plancheVoisine = await plancheEn(autreFerme, zoneVoisine);
    saisonVoisine = await saisonEn(autreFerme);
    familleVoisine = await familleEn(autreFerme);
    especeVoisine = await especeEn(autreFerme, familleVoisine);
    varieteVoisine = await varieteEn(autreFerme, especeVoisine);
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

  async function accepte(ecritures: readonly EcritureEnvoyee[]): Promise<void> {
    expect(await lot(ecritures)).toEqual({ refus: [] });
  }

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const modifications = (id: string) => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);

  async function ligne(table: TableLue, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function historique(id: string): Promise<LigneHistorique[]> {
    const r = await base.pool.query<LigneHistorique>(
      `SELECT ferme_id::text AS ferme_id, nom_table, ligne_id::text AS ligne_id, auteur_id::text AS auteur_id, operation, avant, apres,
              proposition_id::text AS proposition_id
       FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`,
      [id],
    );
    return r.rows;
  }

  async function refusSynchro(id: string): Promise<{ ferme_id: string | null; motif: string; message: string }[]> {
    const r = await base.pool.query<{ ferme_id: string | null; motif: string; message: string }>(
      `SELECT ferme_id::text AS ferme_id, motif, message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le`,
      [id],
    );
    return r.rows;
  }

  function motifDe(reponse: ReponseUpload, id: string): string | undefined {
    const trouves = reponse.refus.filter((r) => r.id === id);
    expect(trouves, `un refus pour ${id} dans ${JSON.stringify(reponse.refus)}`).toHaveLength(1);
    return trouves[0]?.motif;
  }

  /** Le message enregistré pour `id` est en français, sans jargon, de la forme de T10j. */
  async function messageDe(id: string): Promise<string> {
    const lignes = await refusSynchro(id);
    expect(lignes.length, `refus_synchro pour ${id}`).toBeGreaterThanOrEqual(1);
    const message = lignes.at(-1)?.message ?? '';
    expect(jargon(message), `jargon dans « ${message} »`).toEqual([]);
    expect(defautsDeForme(message), `forme de « ${message} »`).toEqual([]);
    return message;
  }

  /**
   * Le lot est refusé EN ENTIER : rien d'écrit ni changé, chaque écriture a son refus, la fautive
   * son motif (un parmi `motif` si c'est une liste). Rend la réponse.
   */
  async function refuseEnEntier(
    ecritures: readonly EcritureEnvoyee[],
    fautive: EcritureEnvoyee,
    motif: string | readonly string[],
    jeton: string = theo.jeton,
  ): Promise<ReponseUpload> {
    const avant = new Map<string, Ligne | null>();
    const historiques = new Map<string, number>();
    for (const e of ecritures) {
      if (TABLES_LUES.has(e.table)) avant.set(e.id, await ligne(e.table as TableLue, e.id));
      historiques.set(e.id, await modifications(e.id));
    }
    const reponse = await lot(ecritures, jeton);
    const recu = motifDe(reponse, fautive.id);
    if (typeof motif === 'string') expect(recu).toBe(motif);
    else expect(motif).toContain(recu);
    for (const e of ecritures) {
      expect(
        reponse.refus.some((r) => r.id === e.id && r.table === e.table),
        `${e.table} ${e.id} figure dans les refus`,
      ).toBe(true);
      if (TABLES_LUES.has(e.table)) expect(await ligne(e.table as TableLue, e.id), `${e.table} ${e.id} inchangée`).toEqual(avant.get(e.id));
      expect(await modifications(e.id), `aucun historique de plus pour ${e.table} ${e.id}`).toBe(historiques.get(e.id));
    }
    return reponse;
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  function put(table: TableStructure, donnees: Record<string, unknown>): EcritureEnvoyee {
    return { op: 'PUT', table, id: nouvelId(), donnees };
  }

  const putZone = (autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('zone', { ferme_id: ferme, nom: unique('Tunnel'), zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240, ...autres });

  const putEmplacement = (zoneId: string, autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('emplacement', {
      ferme_id: ferme,
      zone_id: zoneId,
      code: unique('T3-P'),
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: '2026-01-01',
      actif_au: null,
      remplace: '[]',
      ...autres,
    });

  const putFamille = (autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('famille', { ferme_id: ferme, nom: unique('Brassicacées'), delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6, ...autres });

  const putEspece = (familleId: string, autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('espece', {
      ferme_id: ferme,
      famille_id: familleId,
      nom: unique('Chou'),
      categorie: 'legume',
      perenne: 0,
      unite_recolte: 'piece',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...autres,
    });

  const putVariete = (especeId: string, autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('variete', {
      ferme_id: ferme,
      espece_id: especeId,
      nom: unique('Cœur de bœuf'),
      fournisseur: 'Agrosemens',
      poids_mille_graines_g: 3.5,
      taux_germination: 85,
      ...autres,
    });

  const putSaison = (autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('saison', { ferme_id: ferme, nom: unique('Saison'), debut: '2025-01-01', fin: '2025-12-31', ...autres });

  const putAssolement = (saisonId: string, familleId: string, autres: Record<string, unknown> = {}): EcritureEnvoyee =>
    put('assolement', {
      ferme_id: ferme,
      saison_id: saisonId,
      zone_id: null,
      emplacement_id: plancheFerme,
      famille_id: familleId,
      espece_id: null,
      nature: 'passe_importe',
      source_import: 'Elzéard 2025',
      ...autres,
    });

  const patch = (table: string, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const supprimer = (table: string, id: string): EcritureEnvoyee => patch(table, id, { supprime_le: SUPPRIME_LE });
  const effacer = (table: string, id: string): EcritureEnvoyee => ({ op: 'DELETE', table, id });

  /**
   * Un import complet, dans l'ordre où le téléphone l'écrit : un tunnel et sa chapelle, deux
   * emplacements (une planche, une gouttière), une famille, une espèce et une variété de la
   * ferme, une espèce de la ferme rangée dans une famille de la bibliothèque, une variété de la
   * ferme d'une espèce de la bibliothèque, une saison passée et son assolement importé.
   */
  function importComplet() {
    const tunnel = putZone({ nom: unique('Tunnel 3'), surface_m2: 240 });
    const chapelle = putZone({ nom: unique('Chapelle 1'), zone_parente_id: tunnel.id, type_abri: 'serre', surface_m2: null });
    const planche = putEmplacement(tunnel.id);
    const gouttiere = putEmplacement(chapelle.id, { sorte: 'gouttiere', longueur_m: 12.5, largeur_m: null, nombre_places: 40 });
    const choux = putFamille();
    const chou = putEspece(choux.id, { delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6 });
    const varieteChou = putVariete(chou.id);
    const fraise = putEspece(familleBibliotheque, { nom: unique('Fraise'), categorie: 'petit_fruit', perenne: 1, unite_recolte: 'barquette' });
    const varieteBibli = putVariete(especeBibliotheque, { nom: unique('Rougette'), fournisseur: null, poids_mille_graines_g: null, taux_germination: null });
    const saison2025 = putSaison();
    const assolement = putAssolement(saison2025.id, choux.id, { emplacement_id: planche.id, espece_id: chou.id });
    const ecritures = [tunnel, chapelle, planche, gouttiere, choux, chou, varieteChou, fraise, varieteBibli, saison2025, assolement];
    return { tunnel, chapelle, planche, gouttiere, choux, chou, varieteChou, fraise, varieteBibli, saison2025, assolement, ecritures };
  }

  /** Un lot valide (zone + planche + saison) auquel on ajoute `fautive` à la fin. */
  function lotAvec(fautive: EcritureEnvoyee): EcritureEnvoyee[] {
    const zone = putZone();
    return [zone, putEmplacement(zone.id), putSaison(), fautive];
  }

  // ── 1. L'import hors ligne arrive intact ────────────────────────────────────────────────────

  describe('import hors ligne : accepté en entier', () => {
    it('zones, emplacements, famille, espèces, variétés, saison et assolement : tout est écrit, avec les valeurs reçues', async () => {
      const i = importComplet();
      await accepte(i.ecritures);

      expect(await ligne('zone', i.tunnel.id)).toMatchObject({ id: i.tunnel.id, ferme_id: ferme, zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240, supprime_le: null });
      expect(await ligne('zone', i.chapelle.id)).toMatchObject({ ferme_id: ferme, zone_parente_id: i.tunnel.id, type_abri: 'serre', surface_m2: null });
      expect(await ligne('emplacement', i.planche.id)).toMatchObject({
        ferme_id: ferme,
        zone_id: i.tunnel.id,
        code: i.planche.donnees?.code,
        sorte: 'planche',
        longueur_m: 30,
        largeur_m: 0.8,
        nombre_places: null,
        actif_du: '2026-01-01',
        actif_au: null,
        remplace: [],
        supprime_le: null,
      });
      expect(await ligne('emplacement', i.gouttiere.id)).toMatchObject({ zone_id: i.chapelle.id, sorte: 'gouttiere', longueur_m: 12.5, nombre_places: 40 });
      expect(await ligne('famille', i.choux.id)).toMatchObject({ ferme_id: ferme, delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6 });
      expect(await ligne('espece', i.chou.id)).toMatchObject({ ferme_id: ferme, famille_id: i.choux.id, categorie: 'legume', perenne: false, unite_recolte: 'piece' });
      expect(await ligne('espece', i.fraise.id), 'pérenne envoyé en entier 1 : booléen vrai').toMatchObject({
        famille_id: familleBibliotheque,
        perenne: true,
        unite_recolte: 'barquette',
      });
      expect(await ligne('variete', i.varieteChou.id)).toMatchObject({ ferme_id: ferme, espece_id: i.chou.id, poids_mille_graines_g: 3.5, taux_germination: 85 });
      expect(await ligne('variete', i.varieteBibli.id)).toMatchObject({ ferme_id: ferme, espece_id: especeBibliotheque });
      expect(await ligne('saison', i.saison2025.id)).toMatchObject({ ferme_id: ferme, debut: '2025-01-01', fin: '2025-12-31' });
      expect(await ligne('assolement', i.assolement.id)).toMatchObject({
        ferme_id: ferme,
        saison_id: i.saison2025.id,
        zone_id: null,
        emplacement_id: i.planche.id,
        famille_id: i.choux.id,
        espece_id: i.chou.id,
        nature: 'passe_importe',
        source_import: 'Elzéard 2025',
      });
    });

    it('chaque ligne créée a son historique de création, à son nom de table, au nom de l’auteur', async () => {
      const i = importComplet();
      await accepte(i.ecritures);
      for (const e of i.ecritures) {
        const h = await historique(e.id);
        expect(h, `historique de ${e.table}`).toHaveLength(1);
        expect(h[0]).toMatchObject({
          ferme_id: ferme,
          nom_table: NOM_ENTITE[e.table as TableStructure],
          ligne_id: e.id,
          auteur_id: theo.id,
          operation: 'creation',
          avant: null,
          proposition_id: null,
        });
        expect(h[0]?.apres).toEqual(await ligne(e.table as TableStructure, e.id));
      }
    });

    it('le même import renvoyé (réponse perdue) : accepté, rien en double, un seul historique par ligne', async () => {
      const i = importComplet();
      await accepte(i.ecritures);
      await accepte(i.ecritures);
      for (const e of i.ecritures) {
        expect(await compter(`SELECT 1 FROM ${e.table} WHERE id = $1`, [e.id])).toBe(1);
        expect(await modifications(e.id)).toBe(1);
      }
    });

    it('cree_le et modifie_le envoyés : tolérés, remplis par le serveur', async () => {
      const z = putZone({ cree_le: '2020-01-01T00:00:00.000Z', modifie_le: '2020-01-01T00:00:00.000Z' });
      await accepte([z]);
      const l = await ligne('zone', z.id);
      expect(String(l?.cree_le)).not.toContain('2020-01-01');
      expect(String(l?.modifie_le)).not.toContain('2020-01-01');
    });

    it('emplacement qui en remplace d’autres de la ferme (planches redessinées) : accepté', async () => {
      const zone = putZone();
      const ancienne = putEmplacement(zone.id);
      const nouvelle = putEmplacement(zone.id, { remplace: JSON.stringify([ancienne.id, plancheFerme]) });
      await accepte([zone, ancienne, nouvelle]);
      expect((await ligne('emplacement', nouvelle.id))?.remplace).toEqual([ancienne.id, plancheFerme]);
    });

    it('PATCH du nom d’une zone : modifié, historique « modification » avec avant et après', async () => {
      const z = putZone();
      await accepte([z]);
      const avant = await ligne('zone', z.id);
      await accepte([patch('zone', z.id, { nom: 'Tunnel des tomates' })]);
      const apres = await ligne('zone', z.id);
      expect(apres).toMatchObject({ nom: 'Tunnel des tomates', ferme_id: ferme });
      const h = await historique(z.id);
      expect(h).toHaveLength(2);
      expect(h[1]).toMatchObject({ operation: 'modification', nom_table: 'Zone', auteur_id: theo.id });
      expect(h[1]?.avant).toEqual(avant);
      expect(h[1]?.apres).toEqual(apres);
    });

    it('PATCH qui ne change rien (renvoi) : accepté, aucun historique de plus', async () => {
      const z = putZone();
      await accepte([z]);
      await accepte([patch('zone', z.id, { nom: z.donnees?.nom })]);
      expect(await modifications(z.id)).toBe(1);
    });

    it('une série et son occupation sur une planche créée dans le même lot (import des séries, T14e) : tout est accepté', async () => {
      const zone = putZone();
      const planche = putEmplacement(zone.id);
      const s2027 = putSaison({ debut: '2027-01-01', fin: '2027-12-31' });
      const serie: EcritureEnvoyee = {
        op: 'PUT',
        table: 'serie',
        id: nouvelId(),
        donnees: {
          ferme_id: ferme,
          saison_id: s2027.id,
          espece_id: laitue,
          variete_id: null,
          itineraire_id: itineraire,
          parametres: JSON.stringify(BATAVIA),
          ...DATES_S22,
          longueur_m: 30,
          nombre_plants: null,
          statut: 'prevue',
          rotation_acceptee: null,
        },
      };
      const occupation: EcritureEnvoyee = {
        op: 'PUT',
        table: 'occupation',
        id: nouvelId(),
        donnees: {
          ferme_id: ferme,
          emplacement_id: planche.id,
          serie_id: serie.id,
          plantation_id: null,
          evenement_id: null,
          longueur_m: 30,
          nombre_places: null,
          position_m: null,
          ...OCCUPATION_S22,
          reel_du: null,
          reel_au: null,
        },
      };
      await accepte([zone, planche, s2027, serie, occupation]);
      expect(await ligne('occupation', occupation.id)).toMatchObject({ emplacement_id: planche.id, serie_id: serie.id });
    });

    it('un itinéraire sur une espèce créée dans le même lot (copie de la bibliothèque) : accepté', async () => {
      const f = putFamille();
      const e = putEspece(f.id);
      const iti: EcritureEnvoyee = {
        op: 'PUT',
        table: 'itineraire',
        id: nouvelId(),
        donnees: { ferme_id: ferme, espece_id: e.id, variete_id: null, nom: 'Chou d’été', mode: 'plant_maison', parametres: JSON.stringify(BATAVIA) },
      };
      await accepte([f, e, iti]);
      expect(await ligne('itineraire', iti.id)).toMatchObject({ espece_id: e.id, ferme_id: ferme });
    });
  });

  // ── 2. Isolement entre fermes et bibliothèque commune ───────────────────────────────────────

  describe('isolement : écrire dans une ferme dont on n’est pas membre actif', () => {
    it('ferme_id d’une autre ferme, au milieu d’un import valide : ferme_interdite, rien du lot n’est écrit', async () => {
      const fautive = putZone({ ferme_id: autreFerme });
      await refuseEnEntier(lotAvec(fautive), fautive, 'ferme_interdite');
      expect(await ligne('zone', fautive.id)).toBeNull();
      const [r] = await refusSynchro(fautive.id);
      expect(r?.ferme_id, 'pas d’id de la ferme voisine dans refus_synchro').toBeNull();
    });

    it.each([
      ['zone', () => putZone({ ferme_id: autreFerme })],
      ['emplacement', () => putEmplacement(zoneVoisine, { ferme_id: autreFerme })],
      ['famille', () => putFamille({ ferme_id: autreFerme })],
      ['espèce', () => putEspece(familleVoisine, { ferme_id: autreFerme })],
      ['variété', () => putVariete(especeVoisine, { ferme_id: autreFerme })],
      ['saison', () => putSaison({ ferme_id: autreFerme })],
      ['assolement', () => putAssolement(saisonVoisine, familleVoisine, { ferme_id: autreFerme, emplacement_id: plancheVoisine })],
    ])('%s dans la ferme voisine : ferme_interdite, rien d’écrit', async (_cas, fabrique) => {
      const e = fabrique();
      await refuseEnEntier([e], e, 'ferme_interdite');
      expect(await ligne(e.table as TableStructure, e.id)).toBeNull();
    });

    it('membre retiré de la ferme : ferme_interdite, rien d’écrit', async () => {
      const i = importComplet();
      await refuseEnEntier(i.ecritures, i.tunnel, 'ferme_interdite', retire.jeton);
      expect(await ligne('zone', i.tunnel.id)).toBeNull();
    });

    it('invitation pas encore acceptée : ferme_interdite, rien d’écrit', async () => {
      const z = putZone();
      await refuseEnEntier([z], z, 'ferme_interdite', invite.jeton);
      expect(await ligne('zone', z.id)).toBeNull();
    });

    it('ferme_id absent : ecriture_invalide, rien d’écrit', async () => {
      const z = putZone();
      const sansFerme: EcritureEnvoyee = { ...z, donnees: { ...z.donnees, ferme_id: undefined } };
      await refuseEnEntier([sansFerme], sansFerme, 'ecriture_invalide');
    });
  });

  describe('isolement : références vers une autre ferme (y compris l’autre ferme du même utilisateur)', () => {
    it.each([
      ['zone parente de la ferme voisine', () => putZone({ zone_parente_id: zoneVoisine })],
      ['zone parente de la seconde ferme', () => putZone({ zone_parente_id: zoneSeconde })],
      ['zone parente supprimée', () => putZone({ zone_parente_id: zoneSupprimee })],
      ['zone parente introuvable', () => putZone({ zone_parente_id: randomUUID() })],
      ['emplacement dans une zone de la ferme voisine', () => putEmplacement(zoneVoisine)],
      ['emplacement dans une zone de la seconde ferme', () => putEmplacement(zoneSeconde)],
      ['emplacement dans une zone supprimée', () => putEmplacement(zoneSupprimee)],
      ['emplacement qui remplace une planche de la ferme voisine', () => putEmplacement(zoneFerme, { remplace: JSON.stringify([plancheVoisine]) })],
      ['emplacement qui remplace un emplacement introuvable', () => putEmplacement(zoneFerme, { remplace: JSON.stringify([randomUUID()]) })],
      ['espèce d’une famille de la ferme voisine', () => putEspece(familleVoisine)],
      ['espèce d’une famille de la seconde ferme', () => putEspece(familleSeconde)],
      ['variété d’une espèce de la ferme voisine', () => putVariete(especeVoisine)],
      ['assolement sur une saison de la ferme voisine', () => putAssolement(saisonVoisine, famille)],
      ['assolement sur une saison de la seconde ferme', () => putAssolement(saisonSeconde, famille)],
      ['assolement sur une saison supprimée', () => putAssolement(saisonSupprimee, famille)],
      ['assolement sur une planche de la ferme voisine', () => putAssolement(saison, famille, { emplacement_id: plancheVoisine })],
      ['assolement sur une zone de la ferme voisine', () => putAssolement(saison, famille, { emplacement_id: null, zone_id: zoneVoisine })],
      ['assolement d’une famille de la ferme voisine', () => putAssolement(saison, familleVoisine)],
      ['assolement d’une espèce de la ferme voisine', () => putAssolement(saison, famille, { espece_id: especeVoisine })],
      ['assolement d’une variété à la place d’une espèce (id d’une autre table)', () => putAssolement(saison, famille, { espece_id: varieteVoisine })],
    ])('%s : ecriture_invalide, rien du lot n’est écrit', async (_cas, fabrique) => {
      const fautive = fabrique();
      const reponse = await refuseEnEntier(lotAvec(fautive), fautive, 'ecriture_invalide');
      expect(reponse.refus).toHaveLength(4);
      expect(await ligne(fautive.table as TableStructure, fautive.id)).toBeNull();
      const message = await messageDe(fautive.id);
      expect(message.startsWith(DEBUT_INVALIDE)).toBe(true);
    });

    it('références de la bibliothèque commune : acceptées (espèce, variété, famille d’assolement)', async () => {
      const e = putEspece(familleBibliotheque);
      const v = putVariete(especeBibliotheque);
      const a = putAssolement(saison, familleBibliotheque, { espece_id: especeBibliotheque });
      await accepte([e, v, a]);
    });

    it('PATCH qui déplace un emplacement de la ferme dans une zone de la ferme voisine : refusé, inchangé', async () => {
      const zone = putZone();
      const planche = putEmplacement(zone.id);
      await accepte([zone, planche]);
      const p = patch('emplacement', planche.id, { zone_id: zoneVoisine });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('PATCH qui range une espèce de la ferme dans une famille de la ferme voisine : refusé, inchangée', async () => {
      const e = putEspece(famille);
      await accepte([e]);
      const p = patch('espece', e.id, { famille_id: familleVoisine });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('isolement : la bibliothèque commune reste en lecture seule', () => {
    it.each([
      ['famille', () => putFamille({ ferme_id: null })],
      ['espèce', () => putEspece(familleBibliotheque, { ferme_id: null })],
      ['variété', () => putVariete(especeBibliotheque, { ferme_id: null })],
      ['zone', () => putZone({ ferme_id: null })],
      ['saison', () => putSaison({ ferme_id: null })],
    ])('PUT %s à ferme_id nul : ecriture_invalide, rien d’écrit', async (_cas, fabrique) => {
      const e = fabrique();
      await refuseEnEntier(lotAvec(e), e, 'ecriture_invalide');
      expect(await ligne(e.table as TableStructure, e.id)).toBeNull();
    });

    it.each([
      ['famille', 'famille', () => familleBibliotheque, { nom: 'Ma famille' }],
      ['espèce', 'espece', () => especeBibliotheque, { nom: 'Mon espèce' }],
      ['variété', 'variete', () => varieteBibliotheque, { nom: 'Ma variété' }],
    ] as const)('PUT qui reprend l’id d’une %s de la bibliothèque : refusé, la bibliothèque ne change pas', async (_cas, table, id, valeurs) => {
      const avant = await ligne(table, id());
      const e: EcritureEnvoyee = { op: 'PUT', table, id: id(), donnees: { ...avant, ...valeurs, ferme_id: ferme, id: undefined, cree_le: undefined, modifie_le: undefined } };
      await refuseEnEntier([e], e, 'ecriture_invalide');
      expect(await ligne(table, id())).toEqual(avant);
    });

    it.each([
      ['famille', 'famille', () => familleBibliotheque, { nom: 'Brassicacées (modifiée)' }],
      ['famille (délais)', 'famille', () => familleBibliotheque, { delai_retour_minimal_ans: 0, delai_retour_conseille_ans: 0 }],
      ['espèce', 'espece', () => especeBibliotheque, { nom: 'Laitue (modifiée)' }],
      ['espèce (ferme_id vers la sienne)', 'espece', () => especeBibliotheque, { ferme_id: ferme }],
      ['variété', 'variete', () => varieteBibliotheque, { taux_germination: 10 }],
      ['famille (suppression)', 'famille', () => familleBibliotheque, { supprime_le: SUPPRIME_LE }],
      ['espèce (suppression)', 'espece', () => especeBibliotheque, { supprime_le: SUPPRIME_LE }],
      ['variété (suppression)', 'variete', () => varieteBibliotheque, { supprime_le: SUPPRIME_LE }],
    ] as const)('PATCH d’une %s de la bibliothèque : ecriture_invalide, ferme nulle dans le refus, rien ne change', async (_cas, table, id, donnees) => {
      const avant = await ligne(table, id());
      const p = patch(table, id(), donnees);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne(table, id())).toEqual(avant);
      const [r] = (await refusSynchro(id())).slice(-1);
      expect(r?.ferme_id).toBeNull();
    });

    it.each([
      ['famille', 'famille', () => familleBibliotheque],
      ['espèce', 'espece', () => especeBibliotheque],
      ['variété', 'variete', () => varieteBibliotheque],
    ] as const)('DELETE d’une %s de la bibliothèque : refusé, rien ne change', async (_cas, table, id) => {
      const avant = await ligne(table, id());
      const d = effacer(table, id());
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne(table, id())).toEqual(avant);
    });
  });

  describe('isolement : lignes d’une autre ferme, changement de ferme', () => {
    it.each([
      ['zone voisine', 'zone', () => zoneVoisine, { nom: 'à moi' }],
      ['planche voisine', 'emplacement', () => plancheVoisine, { longueur_m: 1 }],
      ['planche voisine (suppression)', 'emplacement', () => plancheVoisine, { supprime_le: SUPPRIME_LE }],
      ['saison voisine', 'saison', () => saisonVoisine, { nom: 'à moi' }],
      ['famille voisine', 'famille', () => familleVoisine, { nom: 'à moi' }],
      ['espèce voisine', 'espece', () => especeVoisine, { nom: 'à moi' }],
      ['variété voisine', 'variete', () => varieteVoisine, { nom: 'à moi' }],
      ['ligne introuvable', 'zone', () => ZONE_INTROUVABLE, { nom: 'rien' }],
    ] as const)('PATCH d’une %s : ecriture_invalide, comme une ligne inexistante, rien ne change', async (_cas, table, id, donnees) => {
      const avant = await ligne(table, id());
      const p = patch(table, id(), donnees);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne(table, id())).toEqual(avant);
      const [r] = (await refusSynchro(id())).slice(-1);
      expect(r?.ferme_id, 'ferme nulle (T10d)').toBeNull();
    });

    it('PUT qui reprend l’id d’une zone voisine : refusé, la zone voisine ne change pas', async () => {
      const avant = await ligne('zone', zoneVoisine);
      const e: EcritureEnvoyee = { op: 'PUT', table: 'zone', id: zoneVoisine, donnees: { ferme_id: ferme, nom: 'à moi', zone_parente_id: null, type_abri: 'tunnel', surface_m2: null } };
      await refuseEnEntier([e], e, 'ecriture_invalide');
      expect(await ligne('zone', zoneVoisine)).toEqual(avant);
    });

    it.each([
      ['vers la ferme voisine', (): string | null => autreFerme, ['ecriture_invalide', 'ferme_interdite']],
      ['vers la seconde ferme du même utilisateur', (): string | null => secondeFerme, ['ecriture_invalide']],
      ['vers la bibliothèque (NULL)', (): string | null => null, ['ecriture_invalide']],
    ] as const)('PATCH de ferme_id d’une zone %s : refusé, rien ne change', async (_cas, cible, motifs) => {
      const z = putZone();
      await accepte([z]);
      const p = patch('zone', z.id, { ferme_id: cible() });
      await refuseEnEntier([p], p, motifs);
      expect((await ligne('zone', z.id))?.ferme_id).toBe(ferme);
    });

    it.each([
      ['espèce', () => putEspece(famille)],
      ['famille', () => putFamille()],
      ['variété', () => putVariete(laitue)],
      ['emplacement', () => putEmplacement(zoneFerme)],
      ['saison', () => putSaison()],
    ])('PATCH de ferme_id d’une %s vers la bibliothèque (NULL) : refusé, rien ne change', async (_cas, fabrique) => {
      const e = fabrique();
      await accepte([e]);
      const p = patch(e.table, e.id, { ferme_id: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect((await ligne(e.table as TableStructure, e.id))?.ferme_id).toBe(ferme);
    });

    it('DELETE d’une zone de la ferme : refusé (suppression douce seulement), rien ne change', async () => {
      const z = putZone();
      await accepte([z]);
      const d = effacer('zone', z.id);
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne('zone', z.id)).not.toBeNull();
    });
  });

  // ── 3. Une ligne invalide : rien du lot n'est écrit ─────────────────────────────────────────

  describe('validation : une ligne invalide fait refuser tout le lot, message en français', () => {
    it.each([
      ['zone sans nom (espaces)', () => putZone({ nom: '   ' })],
      ['zone au nom démesuré', () => putZone({ nom: 'T'.repeat(10_000) })],
      ['zone d’un type d’abri inconnu', () => putZone({ type_abri: 'cabane' })],
      ['zone de surface nulle', () => putZone({ surface_m2: 0 })],
      ['zone parente d’elle-même', () => ((z) => ({ ...z, donnees: { ...z.donnees, zone_parente_id: z.id } }))(putZone())],
      ['emplacement de longueur nulle', () => putEmplacement(zoneFerme, { longueur_m: 0 })],
      ['emplacement de longueur négative', () => putEmplacement(zoneFerme, { longueur_m: -30 })],
      ['emplacement d’une sorte inconnue', () => putEmplacement(zoneFerme, { sorte: 'bac' })],
      ['emplacement sans code', () => putEmplacement(zoneFerme, { code: '' })],
      ['gouttière sans nombre de places', () => putEmplacement(zoneFerme, { sorte: 'gouttiere', nombre_places: null })],
      ['planche avec un nombre de places', () => putEmplacement(zoneFerme, { nombre_places: 12 })],
      ['emplacement actif jusqu’avant son début', () => putEmplacement(zoneFerme, { actif_du: '2026-06-01', actif_au: '2026-05-01' })],
      ['emplacement à une date qui n’existe pas', () => putEmplacement(zoneFerme, { actif_du: '2026-02-30' })],
      ['emplacement avec un « remplace » illisible', () => putEmplacement(zoneFerme, { remplace: 'pas une liste' })],
      ['famille au délai conseillé plus court que le minimal', () => putFamille({ delai_retour_minimal_ans: 5, delai_retour_conseille_ans: 2 })],
      ['famille au délai négatif', () => putFamille({ delai_retour_minimal_ans: -1 })],
      ['espèce d’une catégorie inconnue', () => putEspece(famille, { categorie: 'champignon' })],
      ['espèce d’une unité de récolte inconnue', () => putEspece(famille, { unite_recolte: 'cagette' })],
      ['espèce avec un seul des deux délais', () => putEspece(famille, { delai_retour_minimal_ans: 3, delai_retour_conseille_ans: null })],
      ['espèce pérenne « peut-être »', () => putEspece(famille, { perenne: 'peut-être' })],
      ['variété à 150 % de germination', () => putVariete(laitue, { taux_germination: 150 })],
      ['variété au poids de mille graines nul', () => putVariete(laitue, { poids_mille_graines_g: 0 })],
      ['saison qui finit avant de commencer', () => putSaison({ debut: '2025-12-31', fin: '2025-01-01' })],
      ['assolement à deux cibles (zone et planche)', () => putAssolement(saison, famille, { zone_id: zoneFerme })],
      ['assolement sans cible', () => putAssolement(saison, famille, { emplacement_id: null })],
      ['assolement d’une nature inconnue', () => putAssolement(saison, famille, { nature: 'reve', source_import: null })],
      ['assolement prévu avec une source d’import', () => putAssolement(saison, famille, { nature: 'prevu' })],
      ['colonne inconnue', () => putZone({ couleur: 'rouge' })],
      ['id glissé dans les données', () => ((z) => ({ ...z, donnees: { ...z.donnees, id: randomUUID() } }))(putZone())],
      ['créée déjà supprimée', () => putZone({ supprime_le: SUPPRIME_LE })],
    ])('%s : ecriture_invalide, rien du lot n’est écrit', async (_cas, fabrique) => {
      const fautive = fabrique();
      const ecritures = lotAvec(fautive);
      const reponse = await refuseEnEntier(ecritures, fautive, 'ecriture_invalide');
      expect(reponse.refus).toHaveLength(ecritures.length);
      for (const e of ecritures) expect(await ligne(e.table as TableStructure, e.id), `${e.table} non écrite`).toBeNull();
      const message = await messageDe(fautive.id);
      expect(message.startsWith(DEBUT_INVALIDE), message).toBe(true);
      // Les autres écritures du lot disent pourquoi elles n'ont pas été enregistrées.
      for (const e of ecritures.slice(0, -1)) await messageDe(e.id);
    });

    it('la fautive en tête d’un import complet : rien de l’import n’est écrit', async () => {
      const i = importComplet();
      const fautive = putSaison({ debut: '2025-12-31', fin: '2025-01-01' });
      await refuseEnEntier([fautive, ...i.ecritures], fautive, 'ecriture_invalide');
      for (const e of i.ecritures) expect(await ligne(e.table as TableStructure, e.id)).toBeNull();
    });

    it('PATCH invalide (longueur négative) d’un emplacement de la ferme : refusé, inchangé', async () => {
      const zone = putZone();
      const planche = putEmplacement(zone.id);
      await accepte([zone, planche]);
      const p = patch('emplacement', planche.id, { longueur_m: -1 });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  // ── 4. Suppression douce ────────────────────────────────────────────────────────────────────

  describe('suppression douce : refusée tant que la ligne sert encore', () => {
    it('emplacement occupé par une série en cours : refusé avec un message qui le dit, inchangé', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await occupationEn(planche, await serieEn('en_cours'));
      const s = supprimer('emplacement', planche);
      await refuseEnEntier([s], s, 'ecriture_invalide');
      expect((await ligne('emplacement', planche))?.supprime_le).toBeNull();
      const message = await messageDe(planche);
      expect(message.startsWith(DEBUT_INVALIDE), message).toBe(true);
      expect(message, 'le message dit que l’emplacement est occupé').toMatch(/occup/iu);
    });

    it('emplacement occupé par une série prévue : refusé', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await occupationEn(planche, await serieEn('prevue'));
      const s = supprimer('emplacement', planche);
      await refuseEnEntier([s], s, 'ecriture_invalide');
      expect(await messageDe(planche)).toMatch(/occup/iu);
    });

    it('emplacement occupé par une plantation en place (kiwis) : refusé', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      const plantation = randomUUID();
      await inserer(`INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants) VALUES ($1, $2, $3, '2019-03-15', 120)`, [
        plantation,
        ferme,
        laitue,
      ]);
      await inserer(
        `INSERT INTO occupation (id, ferme_id, emplacement_id, plantation_id, longueur_m, prevu_du, prevu_au) VALUES ($1, $2, $3, $4, 30, '2019-03-15', '2040-12-31')`,
        [randomUUID(), ferme, planche, plantation],
      );
      const s = supprimer('emplacement', planche);
      await refuseEnEntier([s], s, 'ecriture_invalide');
    });

    it('emplacement occupé, au milieu d’un import : rien du lot n’est écrit', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await occupationEn(planche, await serieEn('en_cours'));
      const s = supprimer('emplacement', planche);
      await refuseEnEntier(lotAvec(s), s, 'ecriture_invalide');
    });

    it('emplacement libre : accepté, supprime_le écrit, historique « suppression »', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      await accepte([supprimer('emplacement', planche)]);
      expect((await ligne('emplacement', planche))?.supprime_le).not.toBeNull();
      const h = await historique(planche);
      expect(h.at(-1)).toMatchObject({ operation: 'suppression', nom_table: 'Emplacement', auteur_id: theo.id, ferme_id: ferme });
    });

    it.each([
      ['dont l’occupation est supprimée', async (p: string) => occupationEn(p, await serieEn('en_cours'), true)],
      ['occupé par une série supprimée', async (p: string) => occupationEn(p, await serieEn('en_cours', true))],
      ['occupé par une série terminée', async (p: string) => occupationEn(p, await serieEn('terminee'))],
      ['occupé par une série abandonnée', async (p: string) => occupationEn(p, await serieEn('abandonnee'))],
    ])('emplacement %s : accepté', async (_cas, preparer) => {
      const planche = await plancheEn(ferme, zoneFerme);
      await preparer(planche);
      await accepte([supprimer('emplacement', planche)]);
      expect((await ligne('emplacement', planche))?.supprime_le).not.toBeNull();
    });

    it('occupation supprimée plus haut dans le même lot, puis l’emplacement : accepté', async () => {
      const planche = await plancheEn(ferme, zoneFerme);
      const serie = await serieEn('en_cours');
      const occupation = await occupationEn(planche, serie);
      await accepte([supprimer('occupation', occupation), supprimer('emplacement', planche)]);
      expect((await ligne('emplacement', planche))?.supprime_le).not.toBeNull();
    });

    it('espèce de la ferme utilisée par une série en cours : refusée, inchangée', async () => {
      const espece = await especeEn(ferme, famille, 'Mâche');
      const serie = randomUUID();
      await inserer(
        `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres, ancre_type, ancre_date,
                            prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
         VALUES ($1, $2, $3, $4, $5, $6, 'debut_recolte', '2027-05-31', '2027-03-15', '2027-04-12', '2027-05-31', '2027-06-14', 30, 'en_cours')`,
        [serie, ferme, saison, espece, itineraire, JSON.stringify(BATAVIA)],
      );
      const s = supprimer('espece', espece);
      await refuseEnEntier([s], s, 'ecriture_invalide');
      expect((await ligne('espece', espece))?.supprime_le).toBeNull();
      await messageDe(espece);
    });

    it('espèce de la ferme que rien n’utilise : acceptée', async () => {
      const e = putEspece(famille);
      await accepte([e]);
      await accepte([supprimer('espece', e.id)]);
      expect((await ligne('espece', e.id))?.supprime_le).not.toBeNull();
    });

    it('zone qui contient encore un emplacement : refusée ; vide : acceptée', async () => {
      const pleine = await zoneEn(ferme);
      await plancheEn(ferme, pleine);
      const s = supprimer('zone', pleine);
      await refuseEnEntier([s], s, 'ecriture_invalide');
      await messageDe(pleine);

      const vide = await zoneEn(ferme);
      await accepte([supprimer('zone', vide)]);
      expect((await ligne('zone', vide))?.supprime_le).not.toBeNull();
    });
  });

  // ── 5. Non-régression : les autres tables gardent leurs règles ─────────────────────────────

  describe('non-régression', () => {
    /** Observation de la ferme, sur les emplacements donnés. */
    function observation(emplacements: readonly string[], autres: Record<string, unknown> = {}): EcritureEnvoyee {
      return {
        op: 'PUT',
        table: 'evenement',
        id: nouvelId(),
        donnees: {
          ferme_id: ferme,
          type: 'observation',
          date: '2026-10-01',
          horodatage: '2026-10-01T05:58:00.000Z',
          auteur_id: theo.id,
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: JSON.stringify(emplacements),
          note: 'pucerons',
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify({ nature: 'ravageur', gravite: null }),
          ...autres,
        },
      };
    }

    it('un lot d’événements seuls reste traité écriture par écriture : un refus ne bloque pas l’autre', async () => {
      const bonne = observation([plancheFerme]);
      const mauvaise = observation([], { ferme_id: autreFerme });
      const reponse = await lot([mauvaise, bonne]);
      expect(motifDe(reponse, mauvaise.id)).toBe('ferme_interdite');
      expect(reponse.refus.some((r) => r.id === bonne.id)).toBe(false);
      expect(await ligne('evenement', bonne.id)).not.toBeNull();
    });

    it('un événement sur une planche créée dans le même lot : accepté avec elle', async () => {
      const zone = putZone();
      const planche = putEmplacement(zone.id);
      const o = observation([planche.id]);
      await accepte([zone, planche, o]);
      expect(await ligne('evenement', o.id)).not.toBeNull();
    });

    it('un événement dans un lot de structure refusé : refusé avec lui (tout ou rien)', async () => {
      const o = observation([plancheFerme]);
      const fautive = putSaison({ debut: '2025-12-31', fin: '2025-01-01' });
      await refuseEnEntier([o, putZone(), fautive], fautive, 'ecriture_invalide');
      expect(await ligne('evenement', o.id)).toBeNull();
    });

    it.each(['ferme', 'membre', 'utilisateur', 'modification'])(
      'table %s : toujours fermée au téléphone (table_interdite)',
      async (table) => {
        const e: EcritureEnvoyee = { op: 'PUT', table, id: nouvelId(), donnees: { ferme_id: ferme } };
        const reponse = await lot([e]);
        expect(motifDe(reponse, e.id)).toBe('table_interdite');
      },
    );
  });
});
