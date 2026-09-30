/**
 * Tests d'acceptation T10e — POST /sync/upload accepte les séries et leurs occupations écrites
 * par les téléphones (T12), contre un vrai Postgres (même amorçage que stock.integration.test.ts :
 * DATABASE_URL, base jetable `t10e_serie_…` supprimée à la fin ; sans DATABASE_URL, échec en CI
 * et saut signalé en local).
 *
 * ── Écrits selon les règles de T10d ─────────────────────────────────────────────────────────
 *
 * T10d (pas encore fusionné quand ces tests sont écrits) sera sur main avant T10e. Ces tests
 * suivent donc ses règles :
 *   - une ligne d'une autre ferme (référence, PATCH, DELETE) se comporte EXACTEMENT comme une
 *     ligne inexistante : motif 'ecriture_invalide' (plus jamais 'ferme_interdite' pour une
 *     référence), et `refus_synchro.ferme_id` nul ; seul un `ferme_id` étranger déclaré par
 *     l'écriture elle-même garde 'ferme_interdite' ;
 *   - le verrou FOR SHARE des références est filtré par ferme (visibleParLaFerme de references.ts) ;
 *   - un lot trop gros reçoit 200 et 'lot_trop_gros' (non repris ici).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Une série créée au téléphone (T12) part en UNE transaction PowerSync, donc en UN appel : le
 * PUT de la série et un PUT d'occupation par planche. La modifier : un PATCH de la série (les
 * colonnes changées seulement, comme PowerSync les envoie) et un PATCH de chaque occupation dont
 * les dates suivent. L'annuler : une suppression douce (PATCH de supprime_le) de la série et de
 * ses occupations. Annuler une modification : un PATCH qui rétablit les valeurs d'avant (T12).
 *
 * ── Contrat (en plus de T10, T10c et T10d) ──────────────────────────────────────────────────
 *
 * Tables ouvertes : `serie` et `occupation` (règle 1). Colonnes reçues : celles de Postgres, au
 * format PowerSync ; `cree_le` et `modifie_le` tolérées et remplies par le serveur ; `id` dans les
 * données → 'ecriture_invalide'. Règles des lignes : `validerSerie` et `validerOccupation` du cœur
 * (packages/core/src/saisies/test/contrat-serie.ts), rejouées par le serveur sur la ligne
 * COMPLÈTE (pour un PATCH : ligne existante + colonnes reçues). Toute règle violée →
 * 'ecriture_invalide'.
 *
 *   PUT     crée la ligne. `ferme_id` d'une ferme dont l'utilisateur n'est pas membre actif →
 *           'ferme_interdite'. Renvoi identique (mêmes valeurs) : accepté, rien d'écrit (ni
 *           ligne, ni historique). Même id avec d'autres valeurs (ou id d'une ligne d'une autre
 *           ferme) → 'ecriture_invalide', la ligne existante ne change pas.
 *   PATCH   modifie une ligne de la ferme. Ligne introuvable ou d'une autre ferme →
 *           'ecriture_invalide' (T10d : même réponse, ferme nulle dans refus_synchro). PATCH de
 *           `ferme_id` vers une autre valeur → refusé ('ferme_interdite' pour une ferme dont
 *           l'utilisateur n'est pas membre ; refusé aussi vers une autre de SES fermes). Un PATCH
 *           qui ne change aucune valeur (renvoi après une réponse perdue) : accepté, rien
 *           d'écrit (ni historique, ni modifie_le). modifie_le = horloge du serveur.
 *   Suppression douce : PATCH de `supprime_le` (instant ISO) ; rétablir = PATCH supprime_le NULL.
 *   DELETE  refusé ('table_interdite' ou 'ajout_seul', au choix du développeur), rien ne change.
 *
 * Références (règle 2), vérifiées dans la transaction, lignes verrouillées (FOR SHARE filtré par
 * ferme, T10d) ; supprimée, introuvable ou d'une autre ferme → 'ecriture_invalide' :
 *   de la MÊME ferme                         saison_id, emplacement_id, occupation.serie_id
 *   de la ferme OU de la bibliothèque        espece_id, variete_id, itineraire_id
 *   (ferme_id nul)
 *   refusés sur une occupation de série      plantation_id, evenement_id
 * Une occupation peut désigner une série écrite plus haut dans le même lot.
 *
 * Cohérence série ↔ occupations, à la fin du lot : chaque occupation NON supprimée d'une série
 * touchée par le lot (ou d'une occupation touchée) a prevu_du = prevu_mise_en_place et prevu_au =
 * prevu_fin_recolte de sa série, et sa série n'est pas supprimée. Déplacer une série sans ses
 * occupations, ou supprimer une série en laissant une occupation active → lot refusé.
 *
 * Une saisie = une transaction (règle 4) : un lot qui contient au moins une écriture sur `serie`
 * ou `occupation` est accepté ou refusé EN ENTIER, comme le stock (T10c) : rien d'écrit si une
 * écriture est refusée ; la fautive a son motif, chaque autre écriture du lot figure aussi dans
 * les refus et dans refus_synchro. Un verrou par ferme est pris (pg_advisory_xact_lock) : deux
 * lots sur la même série passent l'un après l'autre.
 *
 * Historique (règle 5), écrit par le serveur dans la même transaction, une ligne `modification`
 * par ligne touchée : ferme_id, nom_table 'Serie' ou 'Occupation', ligne_id, auteur_id =
 * utilisateur du jeton, horodatage = horloge du serveur, proposition_id NULL, et
 *   creation       avant NULL, apres = la ligne écrite (to_jsonb, colonnes snake_case) ;
 *   modification   avant = la ligne AVANT le PATCH, apres = la ligne APRÈS (to_jsonb exacts) ;
 *   suppression    PATCH qui passe supprime_le de NULL à une valeur : avant = la ligne avant,
 *                  apres = la ligne marquée supprimée. Rétablir (supprime_le → NULL) : 'modification'.
 *
 * Modifié par T23 (décision 9 du chef, docs/backlog/T23-itineraires-synchro.md) : supprimer un
 * itinéraire utilisé par une série est accepté, la série garde son instantané. Le refus
 * « itinéraire supprimé » ne vaut plus qu'à la création d'une série ou quand son itineraire_id
 * change. Le cas « itinéraire » du test « rétablissement refusé quand une référence a été
 * supprimée » en est retiré, et remplacé par deux tests : rétablissement accepté, et PATCH qui
 * ne touche pas itineraire_id accepté. Saison, espèce et variété restent revérifiées au
 * rétablissement.
 *
 * `serie.rotation_acceptee` (règle 6) : colonne jsonb NULLABLE, créée par une migration générée
 * de @planif/db ; validée par le cœur ; stockée en jsonb (objet, pas texte) ; présente d'elle-même
 * dans modification.apres (to_jsonb de la ligne).
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');

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

/** Horloge du serveur : avance d'une milliseconde à chaque lecture (l'historique se trie par horodatage). */
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

/** Motifs acceptés pour un DELETE (voir l'en-tête). */
const MOTIFS_DELETE = ['table_interdite', 'ajout_seul'];

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

/** La même série décalée d'une semaine (S23 : 2027-06-07), dates recalculées. */
const DATES_S23 = {
  ancre_date: '2027-06-07',
  prevu_semis_pepiniere: '2027-03-22',
  prevu_mise_en_place: '2027-04-19',
  prevu_debut_recolte: '2027-06-07',
  prevu_fin_recolte: '2027-06-21',
} as const;

const OCCUPATION_S22 = { prevu_du: '2027-04-12', prevu_au: '2027-06-14' } as const;
const OCCUPATION_S23 = { prevu_du: '2027-04-19', prevu_au: '2027-06-21' } as const;

decrireAvecBase('T10e')('T10e : POST /sync/upload accepte les séries des téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme principale, et membre aussi d'une seconde ferme. */
  let theo: { id: string; jeton: string };
  /** Membre de la ferme voisine seulement. */
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;

  /** Références de la ferme principale. */
  let famille: string;
  let saison: string;
  let saisonSupprimee: string;
  let laitue: string;
  let batavia: string;
  let itineraire: string;
  let planche1: string;
  let planche2: string;
  let plancheSupprimee: string;
  /** Bibliothèque commune (ferme_id nul). */
  let especeBibliotheque: string;
  let varieteBibliotheque: string;
  let itineraireBibliotheque: string;
  /** Ferme voisine. */
  let saisonVoisine: string;
  let especeVoisine: string;
  let varieteVoisine: string;
  let itineraireVoisin: string;
  let plancheVoisine: string;
  let serieVoisine: string;
  let occupationVoisine: string;
  /** Plantation pérenne et événement de la ferme principale (refusés sur une occupation de série). */
  let plantation: string;
  let evenementCouverture: string;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function inserer(sql: string, valeurs: readonly unknown[]): Promise<void> {
    await base.pool.query(sql, [...valeurs]);
  }

  /** Références d'une ferme (ou de la bibliothèque si fermeId est nul pour espèce, variété, itinéraire). */
  async function familleEn(fermeId: string | null): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Astéracées', 2, 3)`, [
      id,
      fermeId,
    ]);
    return id;
  }

  async function especeEn(fermeId: string | null, familleId: string, supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, supprime_le)
       VALUES ($1, $2, $3, 'Laitue', 'legume', false, 'piece', $4)`,
      [id, fermeId, familleId, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  async function varieteEn(fermeId: string | null, especeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Batavia blonde')`, [id, fermeId, especeId]);
    return id;
  }

  async function itineraireEn(fermeId: string | null, especeId: string, supprime = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres, supprime_le)
       VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4, $5)`,
      [id, fermeId, especeId, JSON.stringify(BATAVIA), supprime ? MAINTENANT : null],
    );
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

  async function plancheEn(fermeId: string, code: string, supprimee = false): Promise<string> {
    const zone = randomUUID();
    const id = randomUUID();
    await inserer(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 2', 'tunnel')`, [zone, fermeId]);
    await inserer(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, supprime_le)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5)`,
      [id, fermeId, zone, code, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10e_serie');
    cles = { active: await genererCleSignature('cle-t10e'), precedentes: [] };
    app = creerApp({
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant,
    });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site de Théophane');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };

    famille = await familleEn(ferme);
    saison = await saisonEn(ferme);
    saisonSupprimee = await saisonEn(ferme, true);
    laitue = await especeEn(ferme, famille);
    batavia = await varieteEn(ferme, laitue);
    itineraire = await itineraireEn(ferme, laitue);
    planche1 = await plancheEn(ferme, 'T2-P01');
    planche2 = await plancheEn(ferme, 'T2-P02');
    plancheSupprimee = await plancheEn(ferme, 'T2-P09', true);

    const familleBibliotheque = await familleEn(null);
    especeBibliotheque = await especeEn(null, familleBibliotheque);
    varieteBibliotheque = await varieteEn(null, especeBibliotheque);
    itineraireBibliotheque = await itineraireEn(null, especeBibliotheque);

    const familleVoisine = await familleEn(autreFerme);
    saisonVoisine = await saisonEn(autreFerme);
    especeVoisine = await especeEn(autreFerme, familleVoisine);
    varieteVoisine = await varieteEn(autreFerme, especeVoisine);
    itineraireVoisin = await itineraireEn(autreFerme, especeVoisine);
    plancheVoisine = await plancheEn(autreFerme, 'V-P01');
    serieVoisine = randomUUID();
    await inserer(
      `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres, ancre_type, ancre_date,
                          prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
       VALUES ($1, $2, $3, $4, $5, $6, 'debut_recolte', '2027-05-31', '2027-03-15', '2027-04-12', '2027-05-31', '2027-06-14', 30, 'prevue')`,
      [serieVoisine, autreFerme, saisonVoisine, especeVoisine, itineraireVoisin, JSON.stringify(BATAVIA)],
    );
    occupationVoisine = randomUUID();
    await inserer(
      `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, longueur_m, prevu_du, prevu_au)
       VALUES ($1, $2, $3, $4, 30, '2027-04-12', '2027-06-14')`,
      [occupationVoisine, autreFerme, plancheVoisine, serieVoisine],
    );

    const kiwi = await especeEn(ferme, famille);
    plantation = randomUUID();
    await inserer(`INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants) VALUES ($1, $2, $3, '2019-03-15', 120)`, [
      plantation,
      ferme,
      kiwi,
    ]);
    evenementCouverture = randomUUID();
    await inserer(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, photos, detail)
       VALUES ($1, $2, 'intervention', '2026-09-30', '2026-09-30T08:00:00Z', $3, 'tap', '{}', '{}', $4)`,
      [
        evenementCouverture,
        ferme,
        theo.id,
        JSON.stringify({ categorie: 'couverture', type: 'bachage', outil: null, dureeOccupationJours: 60 }),
      ],
    );
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

  async function compter(sql: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const refusDe = (id: string) => compter(`SELECT 1 FROM refus_synchro WHERE ligne_id = $1`, [id]);
  const modifications = (id: string) => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);

  /** La ligne telle que Postgres la rend en JSON (to_jsonb), ou null. */
  async function ligne(table: 'serie' | 'occupation', id: string): Promise<Ligne | null> {
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

  /** Refus reçu pour `id` (un seul attendu). */
  function motifDe(reponse: ReponseUpload, id: string): string | undefined {
    const trouves = reponse.refus.filter((r) => r.id === id);
    expect(trouves, `un refus pour ${id} dans ${JSON.stringify(reponse.refus)}`).toHaveLength(1);
    return trouves[0]?.motif;
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  /** PUT d'une série batavia de 60 m ancrée sur la récolte S22 2027 ; `autres` : colonnes remplacées. */
  function putSerie(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'serie',
      id: nouvelId<'Serie'>(),
      donnees: {
        ferme_id: ferme,
        saison_id: saison,
        espece_id: laitue,
        variete_id: batavia,
        itineraire_id: itineraire,
        parametres: JSON.stringify(BATAVIA),
        ...DATES_S22,
        longueur_m: 60,
        nombre_plants: null,
        statut: 'prevue',
        rotation_acceptee: null,
        ...autres,
      },
    };
  }

  /** PUT d'une occupation de 30 m de `serie` sur `emplacementId`, aux dates S22. */
  function putOccupation(serie: EcritureEnvoyee, emplacementId: string, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'occupation',
      id: nouvelId<'Occupation'>(),
      donnees: {
        ferme_id: ferme,
        emplacement_id: emplacementId,
        serie_id: serie.id,
        plantation_id: null,
        evenement_id: null,
        longueur_m: 30,
        nombre_places: null,
        position_m: null,
        ...OCCUPATION_S22,
        reel_du: null,
        reel_au: null,
        ...autres,
      },
    };
  }

  const patch = (table: 'serie' | 'occupation', id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const supprimer = (table: 'serie' | 'occupation', id: string): EcritureEnvoyee => patch(table, id, { supprime_le: '2026-10-01T06:30:00.000Z' });

  /** Série batavia sur deux planches, acceptée ; rend la série et ses deux occupations. */
  async function serieAcceptee(autres: Record<string, unknown> = {}): Promise<{ serie: EcritureEnvoyee; occupations: readonly [EcritureEnvoyee, EcritureEnvoyee] }> {
    const serie = putSerie(autres);
    const occupations = [putOccupation(serie, planche1), putOccupation(serie, planche2)] as const;
    expect(await lot([serie, ...occupations])).toEqual({ refus: [] });
    return { serie, occupations };
  }

  /** Le lot est refusé EN ENTIER : rien d'écrit ni changé, chaque écriture a son refus, la fautive son motif. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string | readonly string[]): Promise<void> {
    const avant = new Map<string, Ligne | null>();
    const historiques = new Map<string, number>();
    for (const e of ecritures) {
      if (e.table === 'serie' || e.table === 'occupation') avant.set(e.id, await ligne(e.table, e.id));
      historiques.set(e.id, await modifications(e.id));
    }
    const reponse = await lot(ecritures);
    const recu = motifDe(reponse, fautive.id);
    if (typeof motif === 'string') expect(recu).toBe(motif);
    else expect(motif).toContain(recu);
    for (const e of ecritures) {
      expect(
        reponse.refus.some((r) => r.id === e.id && r.table === e.table),
        `${e.table} ${e.id} figure dans les refus`,
      ).toBe(true);
      if (e.table === 'serie' || e.table === 'occupation') {
        expect(await ligne(e.table, e.id), `${e.table} ${e.id} inchangée`).toEqual(avant.get(e.id));
      }
      expect(await modifications(e.id), `aucun historique de plus pour ${e.table} ${e.id}`).toBe(historiques.get(e.id));
      expect(await refusDe(e.id), `refus_synchro pour ${e.table} ${e.id}`).toBeGreaterThanOrEqual(1);
    }
  }

  // ── Règle 6 : la colonne rotation_acceptee ──────────────────────────────────────────────────

  describe('règle 6 : serie.rotation_acceptee', () => {
    it('la migration crée la colonne, en jsonb nullable', async () => {
      const r = await base.pool.query<{ data_type: string; is_nullable: string }>(
        `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'serie' AND column_name = 'rotation_acceptee'`,
      );
      expect(r.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
    });

    it('une alerte rouge acceptée : rangée en jsonb (objet), et présente dans modification.apres', async () => {
      const decision = { famille, delai_ans: 4, le: '2026-10-01T05:58:00.000Z' };
      const { serie } = await serieAcceptee({ rotation_acceptee: JSON.stringify(decision) });
      const r = await base.pool.query<{ type: string; valeur: unknown }>(
        `SELECT jsonb_typeof(rotation_acceptee) AS type, rotation_acceptee AS valeur FROM serie WHERE id = $1`,
        [serie.id],
      );
      expect(r.rows).toEqual([{ type: 'object', valeur: decision }]);
      const [creation] = await historique(serie.id);
      expect(creation?.apres?.rotation_acceptee).toEqual(decision);
    });

    it('la décision prise après coup : PATCH, avant sans décision, après avec', async () => {
      const { serie } = await serieAcceptee();
      const decision = { famille, delai_ans: 6, le: '2026-10-01T06:10:00.000Z' };
      expect(await lot([patch('serie', serie.id, { rotation_acceptee: JSON.stringify(decision) })])).toEqual({ refus: [] });
      const modif = (await historique(serie.id)).at(-1);
      expect(modif?.operation).toBe('modification');
      expect(modif?.avant?.rotation_acceptee).toBeNull();
      expect(modif?.apres?.rotation_acceptee).toEqual(decision);
    });

    it.each([
      ['illisible', '{"famille":'],
      ['clé inconnue', JSON.stringify({ famille: randomUUID(), delai_ans: 4, le: '2026-10-01T05:58:00.000Z', motif: 'x' })],
      ['délai négatif', JSON.stringify({ famille: randomUUID(), delai_ans: -1, le: '2026-10-01T05:58:00.000Z' })],
      ['pas un objet', '[4]'],
    ])('décision %s : série refusée (ecriture_invalide)', async (_cas, rotation) => {
      const serie = putSerie({ rotation_acceptee: rotation });
      await refuseEnEntier([serie, putOccupation(serie, planche1)], serie, 'ecriture_invalide');
    });
  });

  // ── Règle 1 : PUT, PATCH, suppression douce, DELETE, ferme ──────────────────────────────────

  describe('règle 1 : création (PUT)', () => {
    it('série + deux occupations en un lot : tout est écrit, avec l’historique de chaque ligne', async () => {
      const { serie, occupations } = await serieAcceptee();
      expect(await ligne('serie', serie.id)).toMatchObject({
        id: serie.id,
        ferme_id: ferme,
        saison_id: saison,
        espece_id: laitue,
        variete_id: batavia,
        itineraire_id: itineraire,
        parametres: BATAVIA,
        ...DATES_S22,
        longueur_m: 60,
        nombre_plants: null,
        statut: 'prevue',
        rotation_acceptee: null,
        supprime_le: null,
      });
      for (const [o, planche] of [
        [occupations[0], planche1],
        [occupations[1], planche2],
      ] as const) {
        expect(await ligne('occupation', o.id)).toMatchObject({
          ferme_id: ferme,
          emplacement_id: planche,
          serie_id: serie.id,
          plantation_id: null,
          evenement_id: null,
          longueur_m: 30,
          ...OCCUPATION_S22,
          supprime_le: null,
        });
      }
      for (const [e, nomTable] of [
        [serie, 'Serie'],
        [occupations[0], 'Occupation'],
        [occupations[1], 'Occupation'],
      ] as const) {
        const h = await historique(e.id);
        expect(h, `historique de ${nomTable}`).toHaveLength(1);
        expect(h[0]).toMatchObject({ ferme_id: ferme, nom_table: nomTable, ligne_id: e.id, auteur_id: theo.id, operation: 'creation', avant: null, proposition_id: null });
        expect(h[0]?.apres, `apres = la ligne écrite (${nomTable})`).toEqual(await ligne(e.table as 'serie' | 'occupation', e.id));
        expect(await refusDe(e.id)).toBe(0);
      }
    });

    it('série seule, puis une occupation dans un second lot : acceptées', async () => {
      const serie = putSerie({ longueur_m: 30 });
      expect(await lot([serie])).toEqual({ refus: [] });
      expect(await lot([putOccupation(serie, planche1)])).toEqual({ refus: [] });
    });

    it('espèce, variété et itinéraire de la bibliothèque commune : acceptés', async () => {
      await serieAcceptee({ espece_id: especeBibliotheque, variete_id: varieteBibliotheque, itineraire_id: itineraireBibliotheque });
    });

    it('cree_le et modifie_le envoyés : tolérés, remplis par le serveur', async () => {
      const { serie } = await serieAcceptee({ cree_le: '2020-01-01T00:00:00.000Z', modifie_le: '2020-01-01T00:00:00.000Z' });
      const l = await ligne('serie', serie.id);
      expect(l?.cree_le).not.toContain('2020-01-01');
      expect(l?.modifie_le).not.toContain('2020-01-01');
    });

    it('un id glissé dans les données : refusé', async () => {
      const serie = putSerie();
      const glisse: EcritureEnvoyee = { ...serie, donnees: { ...serie.donnees, id: serie.id } };
      await refuseEnEntier([glisse], glisse, 'ecriture_invalide');
    });

    it('le même lot renvoyé (réponse perdue) : accepté, rien en double, un seul historique par ligne', async () => {
      const serie = putSerie();
      const occupations = [putOccupation(serie, planche1), putOccupation(serie, planche2)];
      expect(await lot([serie, ...occupations])).toEqual({ refus: [] });
      const avant = await ligne('serie', serie.id);
      expect(await lot([serie, ...occupations])).toEqual({ refus: [] });
      expect(await ligne('serie', serie.id)).toEqual(avant);
      for (const e of [serie, ...occupations]) {
        expect(await modifications(e.id)).toBe(1);
        expect(await refusDe(e.id)).toBe(0);
      }
    });

    it('même id, autres valeurs, en PUT : refusé (il faut un PATCH), la ligne ne change pas', async () => {
      const { serie } = await serieAcceptee();
      const autre: EcritureEnvoyee = { ...serie, donnees: { ...serie.donnees, statut: 'en_cours' } };
      await refuseEnEntier([autre], autre, 'ecriture_invalide');
      expect((await ligne('serie', serie.id))?.statut).toBe('prevue');
    });

    it('PUT qui reprend l’id d’une série de la ferme voisine : refusé, la série voisine ne change pas', async () => {
      const avant = await ligne('serie', serieVoisine);
      const serie: EcritureEnvoyee = { ...putSerie(), id: serieVoisine };
      await refuseEnEntier([serie], serie, 'ecriture_invalide');
      expect(await ligne('serie', serieVoisine)).toEqual(avant);
      expect(await modifications(serieVoisine)).toBe(0);
    });

    it('ferme_id d’une ferme dont l’utilisateur n’est pas membre : ferme_interdite', async () => {
      const serie = putSerie({ ferme_id: autreFerme, saison_id: saisonVoisine, espece_id: especeVoisine, variete_id: null, itineraire_id: itineraireVoisin });
      await refuseEnEntier([serie], serie, 'ferme_interdite');
    });

    it('occupation déclarée dans une ferme étrangère : ferme_interdite, la série du lot n’est pas écrite', async () => {
      const serie = putSerie();
      const occupation = putOccupation(serie, planche1, { ferme_id: autreFerme });
      await refuseEnEntier([serie, occupation], occupation, 'ferme_interdite');
    });
  });

  describe('règle 1 : modification (PATCH)', () => {
    it('décaler la série d’une semaine avec ses occupations : accepté, historique avant/après exacts', async () => {
      const { serie, occupations } = await serieAcceptee();
      const avantSerie = await ligne('serie', serie.id);
      const avantOccupations = [await ligne('occupation', occupations[0].id), await ligne('occupation', occupations[1].id)];
      const reponse = await lot([
        patch('serie', serie.id, { ...DATES_S23 }),
        patch('occupation', occupations[0].id, { ...OCCUPATION_S23 }),
        patch('occupation', occupations[1].id, { ...OCCUPATION_S23 }),
      ]);
      expect(reponse).toEqual({ refus: [] });

      const apresSerie = await ligne('serie', serie.id);
      expect(apresSerie).toMatchObject({ ...DATES_S23, ancre_type: 'debut_recolte', longueur_m: 60, statut: 'prevue' });
      const h = await historique(serie.id);
      expect(h.map((x) => x.operation)).toEqual(['creation', 'modification']);
      expect(h[1]).toMatchObject({ ferme_id: ferme, nom_table: 'Serie', auteur_id: theo.id, proposition_id: null });
      expect(h[1]?.avant, 'avant = la ligne avant le PATCH').toEqual(avantSerie);
      expect(h[1]?.apres, 'apres = la ligne après le PATCH').toEqual(apresSerie);

      for (const [i, o] of occupations.entries()) {
        const apres = await ligne('occupation', o.id);
        expect(apres).toMatchObject(OCCUPATION_S23);
        const ho = await historique(o.id);
        expect(ho.map((x) => x.operation)).toEqual(['creation', 'modification']);
        expect(ho[1]?.nom_table).toBe('Occupation');
        expect(ho[1]?.avant).toEqual(avantOccupations[i]);
        expect(ho[1]?.apres).toEqual(apres);
      }
    });

    it('modifie_le prend l’horloge du serveur', async () => {
      const { serie } = await serieAcceptee();
      const avant = String((await ligne('serie', serie.id))?.modifie_le);
      expect(await lot([patch('serie', serie.id, { statut: 'en_cours' })])).toEqual({ refus: [] });
      const apres = String((await ligne('serie', serie.id))?.modifie_le);
      expect(Date.parse(apres)).toBeGreaterThan(Date.parse(avant));
    });

    it('annuler la modification (PATCH qui rétablit les valeurs de modification.avant) : état initial retrouvé', async () => {
      const { serie, occupations } = await serieAcceptee();
      const initiale = await ligne('serie', serie.id);
      expect(
        await lot([
          patch('serie', serie.id, { ...DATES_S23 }),
          patch('occupation', occupations[0].id, { ...OCCUPATION_S23 }),
          patch('occupation', occupations[1].id, { ...OCCUPATION_S23 }),
        ]),
      ).toEqual({ refus: [] });
      // Les valeurs de modification.avant : l'ancre et les dates de la S22 (ancre_type n'a pas changé).
      const retour = Object.fromEntries(Object.entries(DATES_S22).filter(([colonne]) => colonne !== 'ancre_type'));
      expect(
        await lot([
          patch('serie', serie.id, retour),
          patch('occupation', occupations[0].id, { ...OCCUPATION_S22 }),
          patch('occupation', occupations[1].id, { ...OCCUPATION_S22 }),
        ]),
      ).toEqual({ refus: [] });
      const finale = await ligne('serie', serie.id);
      expect({ ...finale, modifie_le: null }).toEqual({ ...initiale, modifie_le: null });
      const h = await historique(serie.id);
      expect(h.map((x) => x.operation)).toEqual(['creation', 'modification', 'modification']);
      expect(h[2]?.apres).toMatchObject(DATES_S22);
      for (const o of occupations) expect((await historique(o.id)).map((x) => x.operation)).toEqual(['creation', 'modification', 'modification']);
    });

    it('PATCH qui ne change rien (renvoi après une réponse perdue) : accepté, rien d’écrit', async () => {
      const { serie } = await serieAcceptee();
      expect(await lot([patch('serie', serie.id, { statut: 'en_cours' })])).toEqual({ refus: [] });
      const avant = await ligne('serie', serie.id);
      expect(await lot([patch('serie', serie.id, { statut: 'en_cours' })])).toEqual({ refus: [] });
      expect(await ligne('serie', serie.id)).toEqual(avant);
      expect(await modifications(serie.id)).toBe(2);
    });

    it('longueur de la série et d’une occupation changées sans toucher aux dates : accepté', async () => {
      const { serie, occupations } = await serieAcceptee();
      expect(
        await lot([patch('serie', serie.id, { longueur_m: 45 }), patch('occupation', occupations[1].id, { longueur_m: 15, position_m: 0 })]),
      ).toEqual({ refus: [] });
      expect((await ligne('occupation', occupations[1].id))?.longueur_m).toBe(15);
    });

    it('PATCH d’une série introuvable : ecriture_invalide', async () => {
      const inconnue = patch('serie', nouvelId<'Serie'>(), { statut: 'en_cours' });
      await refuseEnEntier([inconnue], inconnue, 'ecriture_invalide');
    });

    it.each([
      ['série', 'serie'],
      ['occupation', 'occupation'],
    ] as const)('PATCH d’une %s de la ferme voisine : comme une ligne inexistante (T10d), rien ne change', async (_nom, table) => {
      const id = table === 'serie' ? serieVoisine : occupationVoisine;
      const avant = await ligne(table, id);
      const etrangere = patch(table, id, table === 'serie' ? { statut: 'abandonnee' } : { longueur_m: 1 });
      await refuseEnEntier([etrangere], etrangere, 'ecriture_invalide');
      expect(await ligne(table, id)).toEqual(avant);
      expect(await modifications(id)).toBe(0);
      // Refus de CE PATCH seulement : le test du PUT sur le même id (plus haut) laisse le sien.
      const r = await base.pool.query<{ ferme_id: string | null }>(
        `SELECT ferme_id::text AS ferme_id FROM refus_synchro WHERE ligne_id = $1 AND operation = 'PATCH'`,
        [id],
      );
      expect(r.rows.map((x) => x.ferme_id)).toEqual([null]);
    });

    it('PATCH du voisin sur une série de Théophane : comme une ligne inexistante, rien ne change', async () => {
      const { serie } = await serieAcceptee();
      const avant = await ligne('serie', serie.id);
      const reponse = await lot([patch('serie', serie.id, { statut: 'abandonnee' })], voisin.jeton);
      expect(motifDe(reponse, serie.id)).toBe('ecriture_invalide');
      expect(await ligne('serie', serie.id)).toEqual(avant);
      expect(await modifications(serie.id)).toBe(1);
    });

    it('ancre déplacée sans les dates recalculées : refusé (le serveur ne croit pas une date calculée ailleurs)', async () => {
      const { serie } = await serieAcceptee();
      const fausse = patch('serie', serie.id, { ancre_date: '2027-06-07' });
      await refuseEnEntier([fausse], fausse, 'ecriture_invalide');
    });

    it('date prévue fausse d’un jour : refusée', async () => {
      const { serie, occupations } = await serieAcceptee();
      const fausse = patch('serie', serie.id, { ...DATES_S23, prevu_fin_recolte: '2027-06-22' });
      await refuseEnEntier(
        [fausse, patch('occupation', occupations[0].id, { prevu_du: '2027-04-19', prevu_au: '2027-06-22' }), patch('occupation', occupations[1].id, { prevu_du: '2027-04-19', prevu_au: '2027-06-22' })],
        fausse,
        'ecriture_invalide',
      );
    });

    it('série décalée sans ses occupations : refusé en entier (occupations incohérentes)', async () => {
      const { serie } = await serieAcceptee();
      const seule = patch('serie', serie.id, { ...DATES_S23 });
      await refuseEnEntier([seule], seule, 'ecriture_invalide');
    });

    it('une occupation décalée seule, sa série restée en S22 : refusé', async () => {
      const { occupations } = await serieAcceptee();
      const seule = patch('occupation', occupations[0].id, { ...OCCUPATION_S23 });
      await refuseEnEntier([seule], seule, 'ecriture_invalide');
    });

    it('longueur et nombre de plants à la fois (PATCH de nombre_plants) : refusé', async () => {
      const { serie } = await serieAcceptee();
      const deux = patch('serie', serie.id, { nombre_plants: 600 });
      await refuseEnEntier([deux], deux, 'ecriture_invalide');
    });

    it('un id glissé dans les données d’un PATCH : refusé', async () => {
      const { serie } = await serieAcceptee();
      const glisse = patch('serie', serie.id, { id: randomUUID() });
      await refuseEnEntier([glisse], glisse, 'ecriture_invalide');
    });

    it('changer ferme_id vers une ferme étrangère : ferme_interdite, rien ne change', async () => {
      const { serie } = await serieAcceptee();
      const deplacee = patch('serie', serie.id, { ferme_id: autreFerme });
      await refuseEnEntier([deplacee], deplacee, 'ferme_interdite');
      expect((await ligne('serie', serie.id))?.ferme_id).toBe(ferme);
    });

    it('changer ferme_id vers une autre ferme de Théophane : refusé aussi, rien ne change', async () => {
      const { serie, occupations } = await serieAcceptee();
      const deplacee = patch('serie', serie.id, { ferme_id: secondeFerme });
      await refuseEnEntier([deplacee], deplacee, ['ecriture_invalide', 'ferme_interdite']);
      const occupationDeplacee = patch('occupation', occupations[0].id, { ferme_id: secondeFerme });
      await refuseEnEntier([occupationDeplacee], occupationDeplacee, ['ecriture_invalide', 'ferme_interdite']);
      expect((await ligne('serie', serie.id))?.ferme_id).toBe(ferme);
      expect((await ligne('occupation', occupations[0].id))?.ferme_id).toBe(ferme);
    });

    it('ferme_id renvoyé à l’identique dans un PATCH : accepté', async () => {
      const { serie } = await serieAcceptee();
      expect(await lot([patch('serie', serie.id, { ferme_id: ferme, statut: 'en_cours' })])).toEqual({ refus: [] });
    });
  });

  describe('règle 1 : suppression douce, rétablissement et DELETE', () => {
    it('supprimer la série et ses occupations (annuler une création) : suppression, avant et après exacts', async () => {
      const { serie, occupations } = await serieAcceptee();
      const avant = new Map([[serie.id, await ligne('serie', serie.id)]]);
      for (const o of occupations) avant.set(o.id, await ligne('occupation', o.id));
      expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
      for (const e of [serie, ...occupations]) {
        const l = await ligne(e.table as 'serie' | 'occupation', e.id);
        expect(l, `${e.table} toujours là (suppression douce)`).not.toBeNull();
        expect(l?.supprime_le, `${e.table} marquée supprimée`).not.toBeNull();
        const h = await historique(e.id);
        expect(h.map((x) => x.operation)).toEqual(['creation', 'suppression']);
        expect(h[1]?.avant).toEqual(avant.get(e.id));
        expect(h[1]?.apres, 'apres = la ligne marquée supprimée').toEqual(l);
      }
    });

    it('supprimer la série en laissant une occupation active : refusé en entier', async () => {
      const { serie, occupations } = await serieAcceptee();
      const suppression = supprimer('serie', serie.id);
      await refuseEnEntier([suppression, supprimer('occupation', occupations[0].id)], suppression, 'ecriture_invalide');
    });

    it('supprimer une seule occupation (une planche de moins) : accepté', async () => {
      const { occupations } = await serieAcceptee();
      expect(await lot([supprimer('occupation', occupations[1].id)])).toEqual({ refus: [] });
      expect((await historique(occupations[1].id)).map((x) => x.operation)).toEqual(['creation', 'suppression']);
    });

    it('rétablir une série supprimée (annuler l’annulation) : modification', async () => {
      const { serie, occupations } = await serieAcceptee();
      expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
      expect(
        await lot([patch('serie', serie.id, { supprime_le: null }), ...occupations.map((o) => patch('occupation', o.id, { supprime_le: null }))]),
      ).toEqual({ refus: [] });
      expect((await ligne('serie', serie.id))?.supprime_le).toBeNull();
      const h = await historique(serie.id);
      expect(h.map((x) => x.operation)).toEqual(['creation', 'suppression', 'modification']);
      expect(h[2]?.avant?.supprime_le).not.toBeNull();
      expect(h[2]?.apres?.supprime_le).toBeNull();
    });

    it('occupation ajoutée à une série supprimée : refusé', async () => {
      const { serie, occupations } = await serieAcceptee();
      expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
      const tardive = putOccupation(serie, planche1);
      await refuseEnEntier([tardive], tardive, 'ecriture_invalide');
    });

    it.each(['serie', 'occupation'] as const)('DELETE réel d’une ligne %s : refusé, la ligne reste', async (table) => {
      const { serie, occupations } = await serieAcceptee();
      const id = table === 'serie' ? serie.id : occupations[0].id;
      const effacement: EcritureEnvoyee = { op: 'DELETE', table, id };
      await refuseEnEntier([effacement], effacement, MOTIFS_DELETE);
      expect(await ligne(table, id)).not.toBeNull();
      expect(await modifications(id)).toBe(1);
    });

    it('DELETE d’une série de la ferme voisine : même réponse qu’un id inexistant (T10d)', async () => {
      const etrangere: EcritureEnvoyee = { op: 'DELETE', table: 'serie', id: serieVoisine };
      const inconnue: EcritureEnvoyee = { op: 'DELETE', table: 'serie', id: nouvelId<'Serie'>() };
      const r1 = await lot([etrangere]);
      const r2 = await lot([inconnue]);
      expect(motifDe(r1, serieVoisine)).toBe(motifDe(r2, inconnue.id));
      expect(MOTIFS_DELETE).toContain(motifDe(r1, serieVoisine));
      expect(await ligne('serie', serieVoisine)).not.toBeNull();
    });
  });

  // ── Règle 2 : ferme et références ───────────────────────────────────────────────────────────

  describe('règle 2 : références de la même ferme ou de la bibliothèque', () => {
    it.each([
      ['saison de la ferme voisine', () => ({ saison_id: saisonVoisine })],
      ['saison supprimée', () => ({ saison_id: saisonSupprimee })],
      ['saison introuvable', () => ({ saison_id: randomUUID() })],
      ['espèce de la ferme voisine', () => ({ espece_id: especeVoisine, variete_id: null })],
      ['espèce introuvable', () => ({ espece_id: randomUUID(), variete_id: null })],
      ['variété de la ferme voisine', () => ({ variete_id: varieteVoisine })],
      ['itinéraire de la ferme voisine', () => ({ itineraire_id: itineraireVoisin })],
      ['itinéraire introuvable', () => ({ itineraire_id: randomUUID() })],
    ])('série avec une %s : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
      const serie = putSerie(autres());
      await refuseEnEntier([serie, putOccupation(serie, planche1), putOccupation(serie, planche2)], serie, 'ecriture_invalide');
    });

    it.each([
      ['planche de la ferme voisine', () => ({ emplacement_id: plancheVoisine })],
      ['planche supprimée', () => ({ emplacement_id: plancheSupprimee })],
      ['planche introuvable', () => ({ emplacement_id: randomUUID() })],
      ['série de la ferme voisine', () => ({ serie_id: serieVoisine })],
      ['série introuvable', () => ({ serie_id: randomUUID() })],
      ['plantation pérenne (ticket suivant)', () => ({ plantation_id: plantation })],
      ['couverture (événement)', () => ({ evenement_id: evenementCouverture })],
    ])('occupation avec une %s : ecriture_invalide, la série du lot n’est pas écrite (tout ou rien)', async (_cas, autres) => {
      const serie = putSerie();
      const bonne = putOccupation(serie, planche1);
      const mauvaise = putOccupation(serie, planche2, autres());
      await refuseEnEntier([serie, bonne, mauvaise], mauvaise, 'ecriture_invalide');
    });

    it('le refus d’une référence étrangère ne dit rien de la ferme voisine (même message qu’une ligne inexistante)', async () => {
      const etrangere = putSerie({ saison_id: saisonVoisine });
      const inconnue = putSerie({ saison_id: randomUUID() });
      await lot([etrangere]);
      await lot([inconnue]);
      const messages = await base.pool.query<{ ligne_id: string; motif: string; message: string }>(
        `SELECT ligne_id::text AS ligne_id, motif, message FROM refus_synchro WHERE ligne_id = ANY($1::text[]) ORDER BY cree_le`,
        [[etrangere.id, inconnue.id]],
      );
      const [a, b] = [etrangere.id, inconnue.id].map((id) => messages.rows.find((r) => r.ligne_id === id));
      expect(a?.motif).toBe('ecriture_invalide');
      expect(a?.motif).toBe(b?.motif);
      expect(a?.message).toBe(b?.message);
    });

    it('PATCH qui fait pointer une série vers la saison de la ferme voisine : refusé, rien ne change', async () => {
      const { serie } = await serieAcceptee();
      const deplacee = patch('serie', serie.id, { saison_id: saisonVoisine });
      await refuseEnEntier([deplacee], deplacee, 'ecriture_invalide');
    });

    it('PATCH qui pose une occupation sur une planche de la ferme voisine : refusé', async () => {
      const { occupations } = await serieAcceptee();
      const deplacee = patch('occupation', occupations[0].id, { emplacement_id: plancheVoisine });
      await refuseEnEntier([deplacee], deplacee, 'ecriture_invalide');
    });

    it('PATCH qui rattache une occupation à une plantation : refusé', async () => {
      const { occupations } = await serieAcceptee();
      const rattachee = patch('occupation', occupations[0].id, { plantation_id: plantation });
      await refuseEnEntier([rattachee], rattachee, 'ecriture_invalide');
    });
  });

  // ── Règle 3 : règles du cœur rejouées par le serveur ────────────────────────────────────────

  describe('règle 3 : validerSerie et validerOccupation rejouées au serveur', () => {
    it.each([
      ['ancre inconnue', { ancre_type: 'recolte' }],
      ['statut inconnu', { statut: 'annulee' }],
      ['longueur et nombre de plants', { nombre_plants: 600 }],
      ['ni longueur ni nombre de plants', { longueur_m: null }],
      ['longueur négative', { longueur_m: -60 }],
      ['longueur démesurée', { longueur_m: 1e308 }],
      ['parametres illisibles', { parametres: '{"mode":' }],
      ['parametres sans durée avant récolte', { parametres: JSON.stringify({ ...BATAVIA, dureeAvantRecolteJours: undefined }) }],
      ['date de fin de récolte fausse', { prevu_fin_recolte: '2027-06-15' }],
      ['semis en pépinière absent en plant maison', { prevu_semis_pepiniere: null }],
      ['dates prévues d’une autre ancre', { ancre_date: '2027-06-07' }],
      ['colonne inconnue', { prix: 3 }],
    ])('série avec %s : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
      const serie = putSerie(autres);
      await refuseEnEntier([serie, putOccupation(serie, planche1)], serie, 'ecriture_invalide');
    });

    it.each([
      ['début avant la plantation', { prevu_du: '2027-03-15' }],
      ['fin décalée', { prevu_au: '2027-06-15' }],
      ['longueur et places', { nombre_places: 40 }],
      ['longueur nulle', { longueur_m: 0 }],
      ['position négative', { position_m: -1 }],
      ['fin réelle sans début', { reel_au: '2027-06-10' }],
    ])('occupation avec %s : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
      const serie = putSerie();
      const occupation = putOccupation(serie, planche1, autres);
      await refuseEnEntier([serie, occupation, putOccupation(serie, planche2)], occupation, 'ecriture_invalide');
    });

    it('série en nombre de plants, en semis direct ancré sur le semis : acceptée', async () => {
      const radis = {
        mode: 'semis_direct',
        densite: { facon: 'metre_lineaire', rangsParPlanche: 6, grainesParMetre: 60 },
        grainesParPoquet: null,
        periodeUsage: null,
        typeAbri: null,
        dureeAvantRecolteJours: 28,
        fenetreRecolteJours: 7,
        margeSecurite: 10,
        rendementAttendu: null,
        perenne: null,
      };
      const serie = putSerie({
        parametres: JSON.stringify(radis),
        ancre_type: 'semis',
        ancre_date: '2027-03-01',
        prevu_semis_pepiniere: null,
        prevu_mise_en_place: '2027-03-01',
        prevu_debut_recolte: '2027-03-29',
        prevu_fin_recolte: '2027-04-05',
        longueur_m: null,
        nombre_plants: 600,
      });
      const occupation = putOccupation(serie, planche1, { prevu_du: '2027-03-01', prevu_au: '2027-04-05' });
      expect(await lot([serie, occupation])).toEqual({ refus: [] });
    });
  });

  // ── Règle 4 : une saisie = une transaction ──────────────────────────────────────────────────

  describe('règle 4 : tout ou rien, verrou par ferme', () => {
    it('transaction à moitié invalide (série juste, 2e occupation sur une planche voisine) : rien d’écrit', async () => {
      const serie = putSerie();
      const bonne = putOccupation(serie, planche1);
      const voisine = putOccupation(serie, plancheVoisine);
      await refuseEnEntier([serie, bonne, voisine], voisine, 'ecriture_invalide');
      expect(await ligne('serie', serie.id)).toBeNull();
      expect(await ligne('occupation', bonne.id)).toBeNull();
    });

    it('transaction à moitié invalide (date prévue fausse sur la série, occupations justes) : rien d’écrit', async () => {
      const serie = putSerie({ prevu_debut_recolte: '2027-06-01' });
      await refuseEnEntier([serie, putOccupation(serie, planche1), putOccupation(serie, planche2)], serie, 'ecriture_invalide');
    });

    it('modification à moitié invalide : la série et la première occupation ne changent pas', async () => {
      const { serie, occupations } = await serieAcceptee();
      const decalage = patch('serie', serie.id, { ...DATES_S23 });
      const bonne = patch('occupation', occupations[0].id, { ...OCCUPATION_S23 });
      const mauvaise = patch('occupation', occupations[1].id, { ...OCCUPATION_S23, emplacement_id: plancheVoisine });
      await refuseEnEntier([decalage, bonne, mauvaise], mauvaise, 'ecriture_invalide');
      expect(await ligne('serie', serie.id)).toMatchObject(DATES_S22);
    });

    it('un lot série + événement du journal : tout ou rien aussi', async () => {
      const serie = putSerie({ longueur_m: -1 });
      const observation: EcritureEnvoyee = {
        op: 'PUT',
        table: 'evenement',
        id: nouvelId<'Evenement'>(),
        donnees: {
          ferme_id: ferme,
          type: 'observation',
          date: '2026-10-01',
          horodatage: '2026-10-01T05:58:00.000Z',
          auteur_id: theo.id,
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: '[]',
          note: 'pucerons',
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify({ nature: 'ravageur', gravite: null }),
        },
      };
      const reponse = await lot([observation, serie]);
      expect(motifDe(reponse, serie.id)).toBe('ecriture_invalide');
      expect(reponse.refus.some((r) => r.id === observation.id)).toBe(true);
      expect(await compter(`SELECT 1 FROM evenement WHERE id = $1`, [observation.id])).toBe(0);
    });

    it('deux lots en même temps sur la même série : les deux passent, l’historique s’enchaîne sans rien perdre', async () => {
      const { serie } = await serieAcceptee();
      const [r1, r2] = await Promise.all([
        lot([patch('serie', serie.id, { statut: 'en_cours' })]),
        lot([patch('serie', serie.id, { longueur_m: 45 })]),
      ]);
      expect(r1).toEqual({ refus: [] });
      expect(r2).toEqual({ refus: [] });
      const finale = await ligne('serie', serie.id);
      expect(finale).toMatchObject({ statut: 'en_cours', longueur_m: 45 });
      const h = await historique(serie.id);
      expect(h.map((x) => x.operation)).toEqual(['creation', 'modification', 'modification']);
      // Le second PATCH a vu l'effet du premier : son « avant » est l'« après » du premier.
      expect(h[2]?.avant).toEqual(h[1]?.apres);
      expect(h[2]?.apres).toEqual(finale);
    });
  });

  // ── Règle 5 : l'historique, écrit par le serveur seul ───────────────────────────────────────

  describe('règle 5 : l’historique est écrit par le serveur seul', () => {
    it('le téléphone ne peut pas écrire dans modification : table_interdite', async () => {
      const fausse: EcritureEnvoyee = {
        op: 'PUT',
        table: 'modification',
        id: nouvelId<'Modification'>(),
        donnees: { ferme_id: ferme, nom_table: 'Serie', ligne_id: randomUUID(), auteur_id: theo.id, operation: 'creation', avant: null, apres: '{}' },
      };
      const reponse = await lot([fausse]);
      expect(motifDe(reponse, fausse.id)).toBe('table_interdite');
      expect(await compter(`SELECT 1 FROM modification WHERE id = $1`, [fausse.id])).toBe(0);
    });

    it('création, modification, suppression : trois lignes par ligne touchée, dans l’ordre, par l’auteur du jeton', async () => {
      const { serie, occupations } = await serieAcceptee();
      expect(
        await lot([
          patch('serie', serie.id, { ...DATES_S23 }),
          patch('occupation', occupations[0].id, { ...OCCUPATION_S23 }),
          patch('occupation', occupations[1].id, { ...OCCUPATION_S23 }),
        ]),
      ).toEqual({ refus: [] });
      expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
      for (const e of [serie, ...occupations]) {
        const h = await historique(e.id);
        expect(h.map((x) => x.operation)).toEqual(['creation', 'modification', 'suppression']);
        for (const x of h) expect(x).toMatchObject({ ferme_id: ferme, auteur_id: theo.id, ligne_id: e.id, proposition_id: null });
        expect(h[0]?.avant).toBeNull();
        expect(h[1]?.avant).toEqual(h[0]?.apres);
        expect(h[2]?.avant).toEqual(h[1]?.apres);
        expect(h[2]?.apres).toEqual(await ligne(e.table as 'serie' | 'occupation', e.id));
      }
    });
  });

  // ── Décisions du chef après les tests : cohérence espèce, variété, itinéraire ──────────────

  describe('décisions du chef : cohérence espèce, variété, itinéraire ; création déjà supprimée', () => {
    /** Autre espèce de la ferme (chou), avec sa variété et son itinéraire. */
    async function chou(): Promise<{ variete: string; itineraire: string }> {
      const espece = await especeEn(ferme, famille);
      return { variete: await varieteEn(ferme, espece), itineraire: await itineraireEn(ferme, espece) };
    }

    it('variété d’une autre espèce de la ferme : ecriture_invalide, rien d’écrit', async () => {
      const { variete } = await chou();
      const serie = putSerie({ variete_id: variete });
      await refuseEnEntier([serie, putOccupation(serie, planche1)], serie, 'ecriture_invalide');
    });

    it('variété de la bibliothèque, d’une autre espèce que celle de la série : ecriture_invalide', async () => {
      const serie = putSerie({ variete_id: varieteBibliotheque });
      await refuseEnEntier([serie], serie, 'ecriture_invalide');
    });

    it('itinéraire d’une autre espèce de la ferme : ecriture_invalide, rien d’écrit', async () => {
      const { itineraire: autre } = await chou();
      const serie = putSerie({ itineraire_id: autre });
      await refuseEnEntier([serie, putOccupation(serie, planche1)], serie, 'ecriture_invalide');
    });

    it('itinéraire de la bibliothèque, d’une autre espèce que celle de la série : ecriture_invalide', async () => {
      const serie = putSerie({ itineraire_id: itineraireBibliotheque });
      await refuseEnEntier([serie], serie, 'ecriture_invalide');
    });

    it('PATCH qui change la variété pour celle d’une autre espèce : refusé, rien ne change', async () => {
      const { serie } = await serieAcceptee();
      const { variete } = await chou();
      const changee = patch('serie', serie.id, { variete_id: variete });
      await refuseEnEntier([changee], changee, 'ecriture_invalide');
    });

    it('PATCH qui change l’espèce sans changer variété ni itinéraire : refusé', async () => {
      const { serie } = await serieAcceptee();
      const changee = patch('serie', serie.id, { espece_id: especeBibliotheque });
      await refuseEnEntier([changee], changee, 'ecriture_invalide');
    });

    it('série sans variété (variete_id nul), itinéraire de son espèce : acceptée', async () => {
      await serieAcceptee({ variete_id: null });
    });

    it('série créée déjà supprimée (PUT avec supprime_le) : ecriture_invalide, rien d’écrit', async () => {
      const serie = putSerie({ supprime_le: '2026-10-01T06:30:00.000Z' });
      await refuseEnEntier([serie, putOccupation(serie, planche1, { supprime_le: '2026-10-01T06:30:00.000Z' })], serie, 'ecriture_invalide');
      expect(await ligne('serie', serie.id)).toBeNull();
    });

    it('occupation créée déjà supprimée (PUT avec supprime_le) : ecriture_invalide, la série du lot n’est pas écrite', async () => {
      const serie = putSerie();
      const occupation = putOccupation(serie, planche1, { supprime_le: '2026-10-01T06:30:00.000Z' });
      await refuseEnEntier([serie, occupation, putOccupation(serie, planche2)], occupation, 'ecriture_invalide');
    });

    it('mise en place hors de la saison (2028 dans la saison 2027) : acceptée, c’est une alerte de T12, pas un refus', async () => {
      const serie = putSerie({
        ancre_type: 'plantation',
        ancre_date: '2028-04-10',
        prevu_semis_pepiniere: '2028-03-13',
        prevu_mise_en_place: '2028-04-10',
        prevu_debut_recolte: '2028-05-29',
        prevu_fin_recolte: '2028-06-12',
      });
      const occupation = putOccupation(serie, planche1, { prevu_du: '2028-04-10', prevu_au: '2028-06-12' });
      expect(await lot([serie, occupation])).toEqual({ refus: [] });
      expect(await ligne('serie', serie.id)).toMatchObject({ saison_id: saison, prevu_mise_en_place: '2028-04-10' });
    });

    it('occupation plus longue que sa planche (45 m sur 30 m) : acceptée, c’est un conflit de T03, pas un refus', async () => {
      const serie = putSerie({ longueur_m: 45 });
      const occupation = putOccupation(serie, planche1, { longueur_m: 45 });
      expect(await lot([serie, occupation])).toEqual({ refus: [] });
      expect((await ligne('occupation', occupation.id))?.longueur_m).toBe(45);
    });

    it('tronçon qui dépasse le bout de la planche (position 20 m, 15 m sur 30 m) : accepté aussi', async () => {
      const serie = putSerie({ longueur_m: 15 });
      expect(await lot([serie, putOccupation(serie, planche1, { longueur_m: 15, position_m: 20 })])).toEqual({ refus: [] });
    });
  });

  // ── Décisions du chef après la relecture de sécurité ────────────────────────────────────────

  describe('relecture de sécurité : occupations hors série, rétablissement, fin de lot', () => {
    /** Occupation écrite directement en base (pas par le téléphone), rend son id. */
    async function occupationEnBase(colonnes: Record<string, unknown>): Promise<string> {
      const id = randomUUID();
      const valeurs = { id, ferme_id: ferme, emplacement_id: planche1, longueur_m: 30, ...colonnes };
      const noms = Object.keys(valeurs);
      await inserer(
        `INSERT INTO occupation (${noms.join(', ')}) VALUES (${noms.map((_n, i) => `$${String(i + 1)}`).join(', ')})`,
        Object.values(valeurs),
      );
      return id;
    }

    const occupationDePlantation = () =>
      occupationEnBase({ plantation_id: plantation, prevu_du: '2019-03-15', prevu_au: '9999-12-31' });
    const occupationDeCouverture = () =>
      occupationEnBase({ evenement_id: evenementCouverture, prevu_du: '2026-09-30', prevu_au: '2026-11-29' });

    describe('bloquant 1 : une occupation qui n’est pas celle d’une série ne se modifie pas', () => {
      it.each([
        ['de la plantation de kiwis', occupationDePlantation, { plantation_id: null }],
        ['de couverture (bâche)', occupationDeCouverture, { evenement_id: null }],
      ])('occupation %s transformée en occupation de série 2027 : ecriture_invalide, rien ne change', async (_cas, creer, retire) => {
        const { serie } = await serieAcceptee();
        const id = await creer();
        const sonde = patch('occupation', id, { ...retire, serie_id: serie.id, ...OCCUPATION_S22 });
        await refuseEnEntier([sonde], sonde, 'ecriture_invalide');
        expect(await modifications(id)).toBe(0);
      });

      it.each([
        ['de la plantation de kiwis', occupationDePlantation],
        ['de couverture (bâche)', occupationDeCouverture],
      ])('occupation %s : un simple PATCH (longueur) est refusé aussi, rien ne change', async (_cas, creer) => {
        const id = await creer();
        const avant = await ligne('occupation', id);
        const simple = patch('occupation', id, { longueur_m: 12 });
        await refuseEnEntier([simple], simple, 'ecriture_invalide');
        expect(await ligne('occupation', id)).toEqual(avant);
        expect(await modifications(id)).toBe(0);
      });

      it('occupation de plantation supprimée en douceur par PATCH : refusé aussi', async () => {
        const id = await occupationDePlantation();
        const suppression = supprimer('occupation', id);
        await refuseEnEntier([suppression], suppression, 'ecriture_invalide');
        expect((await ligne('occupation', id))?.supprime_le).toBeNull();
      });
    });

    describe('rétablissement : toutes les références revérifiées', () => {
      /** Série acceptée avec ses propres références (neuves), puis supprimée avec ses occupations. */
      async function serieSupprimee(): Promise<{
        serie: EcritureEnvoyee;
        occupations: readonly [EcritureEnvoyee, EcritureEnvoyee];
        refs: { saison: string; espece: string; variete: string; itineraire: string };
      }> {
        const espece = await especeEn(ferme, famille);
        const refs = { saison: await saisonEn(ferme), espece, variete: await varieteEn(ferme, espece), itineraire: await itineraireEn(ferme, espece) };
        const { serie, occupations } = await serieAcceptee({
          saison_id: refs.saison,
          espece_id: refs.espece,
          variete_id: refs.variete,
          itineraire_id: refs.itineraire,
        });
        expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
        return { serie, occupations, refs };
      }

      const retablir = (serie: EcritureEnvoyee, occupations: readonly EcritureEnvoyee[]): EcritureEnvoyee[] => [
        patch('serie', serie.id, { supprime_le: null }),
        ...occupations.map((o) => patch('occupation', o.id, { supprime_le: null })),
      ];

      it.each([
        ['saison', 'saison', 'saison'],
        ['espèce', 'espece', 'espece'],
        ['variété', 'variete', 'variete'],
      ] as const)('série dont la référence « %s » a été supprimée entre-temps : rétablissement refusé, rien ne change', async (_nom, table, cle) => {
        const { serie, occupations, refs } = await serieSupprimee();
        await base.pool.query(`UPDATE ${table} SET supprime_le = $2 WHERE id = $1`, [refs[cle], MAINTENANT]);
        const retourSerie = patch('serie', serie.id, { supprime_le: null });
        await refuseEnEntier([retourSerie, ...retablir(serie, occupations).slice(1)], retourSerie, 'ecriture_invalide');
        expect((await ligne('serie', serie.id))?.supprime_le).not.toBeNull();
      });

      it('occupation dont la planche a été supprimée entre-temps : rétablissement refusé, rien ne change', async () => {
        const planche = await plancheEn(ferme, 'T2-P07');
        const serie = putSerie({ longueur_m: 30 });
        const occupation = putOccupation(serie, planche);
        expect(await lot([serie, occupation])).toEqual({ refus: [] });
        expect(await lot([supprimer('occupation', occupation.id)])).toEqual({ refus: [] });
        await base.pool.query(`UPDATE emplacement SET supprime_le = $2 WHERE id = $1`, [planche, MAINTENANT]);
        const retour = patch('occupation', occupation.id, { supprime_le: null });
        await refuseEnEntier([retour], retour, 'ecriture_invalide');
        expect((await ligne('occupation', occupation.id))?.supprime_le).not.toBeNull();
      });

      it('T23, décision 9 : itinéraire supprimé entre-temps, le rétablissement (itineraire_id inchangé) est accepté', async () => {
        const { serie, occupations, refs } = await serieSupprimee();
        await base.pool.query(`UPDATE itineraire SET supprime_le = $2 WHERE id = $1`, [refs.itineraire, MAINTENANT]);
        expect(await lot(retablir(serie, occupations))).toEqual({ refus: [] });
        expect((await ligne('serie', serie.id))?.supprime_le).toBeNull();
      });

      it('T23, décision 9 : série dont l’itinéraire a été supprimé, PATCH qui ne touche pas itineraire_id : accepté', async () => {
        const espece = await especeEn(ferme, famille);
        const itin = await itineraireEn(ferme, espece);
        const { serie } = await serieAcceptee({ espece_id: espece, variete_id: null, itineraire_id: itin });
        await base.pool.query(`UPDATE itineraire SET supprime_le = $2 WHERE id = $1`, [itin, MAINTENANT]);
        expect(await lot([patch('serie', serie.id, { statut: 'en_cours' })])).toEqual({ refus: [] });
      });

      it('témoin : références toujours là, le rétablissement reste accepté', async () => {
        const { serie, occupations } = await serieSupprimee();
        expect(await lot(retablir(serie, occupations))).toEqual({ refus: [] });
      });
    });

    describe('fin de lot : seules les occupations de la ferme comptent', () => {
      // Seul chemin trouvé : une ligne incohérente écrite directement en base (aucune clé composée
      // (ferme_id, serie_id) ne l'empêche). Par l'API, une occupation ne désigne jamais la série
      // d'une autre ferme.
      it('une occupation d’une autre ferme qui désigne la série ne bloque ni son décalage ni sa suppression', async () => {
        const { serie, occupations } = await serieAcceptee();
        await occupationEnBase({ ferme_id: autreFerme, emplacement_id: plancheVoisine, serie_id: serie.id, prevu_du: '2020-01-01', prevu_au: '2020-02-01' });
        expect(
          await lot([
            patch('serie', serie.id, { ...DATES_S23 }),
            patch('occupation', occupations[0].id, { ...OCCUPATION_S23 }),
            patch('occupation', occupations[1].id, { ...OCCUPATION_S23 }),
          ]),
        ).toEqual({ refus: [] });
        expect(await lot([supprimer('serie', serie.id), ...occupations.map((o) => supprimer('occupation', o.id))])).toEqual({ refus: [] });
      });
    });
  });
});
