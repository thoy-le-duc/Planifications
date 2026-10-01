/**
 * Tests d'acceptation T23 — POST /sync/upload accepte les itinéraires et les types d'intervention
 * écrits par les téléphones (écran de T24), contre un vrai Postgres (même amorçage que
 * serie.integration.test.ts : DATABASE_URL, base jetable `t23_itineraire_…` supprimée à la fin ;
 * sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Une ferme crée ou modifie ses itinéraires et ses types d'intervention depuis l'appli, même
 * hors ligne, sans jamais toucher à la bibliothèque commune ni à une autre ferme. Pour adapter
 * un itinéraire ou un type de la bibliothèque, on le DUPLIQUE dans la ferme (nouvel id,
 * ferme_id de la ferme). Un type déjà utilisé ne se supprime pas : il se masque.
 *
 * ── Contrat (en plus de T10, T10c, T10d et T10e) ────────────────────────────────────────────
 *
 * Tables ouvertes (en plus de celles de T10e) : `itineraire` et `type_intervention`. Colonnes
 * reçues : celles de Postgres, au format PowerSync ; `cree_le` et `modifie_le` tolérées et
 * remplies par le serveur ; `id` dans les données → 'ecriture_invalide'. Règles des lignes :
 * `validerItineraire` et `validerTypeIntervention` du cœur
 * (packages/core/src/saisies/test/contrat-itineraire.ts), rejouées sur la ligne COMPLÈTE (pour
 * un PATCH : ligne existante + colonnes reçues). Toute règle violée → 'ecriture_invalide'.
 *
 *   PUT     crée la ligne. `ferme_id` d'une ferme dont l'utilisateur n'est pas membre actif →
 *           'ferme_interdite'. `ferme_id` nul (écrire dans la bibliothèque commune) →
 *           'ecriture_invalide'. Renvoi identique : accepté, rien d'écrit. Même id avec d'autres
 *           valeurs (ou id d'une ligne de la bibliothèque ou d'une autre ferme) →
 *           'ecriture_invalide', la ligne existante ne change pas.
 *   PATCH   modifie une ligne de la ferme. Ligne introuvable, d'une autre ferme OU de la
 *           bibliothèque (ferme_id nul) → 'ecriture_invalide', ferme nulle dans refus_synchro
 *           (T10d : même réponse qu'une ligne inexistante). PATCH de `ferme_id` vers une autre
 *           valeur (ferme étrangère, autre ferme de l'utilisateur, NULL) → 'ecriture_invalide'
 *           et rien d'autre (décision 7 du chef). PATCH qui ne change rien : accepté, rien d'écrit.
 *   Suppression douce : PATCH de `supprime_le` ; rétablir = PATCH supprime_le NULL.
 *   DELETE  refusé ('table_interdite' ou 'ajout_seul', au choix du développeur), rien ne change.
 *
 * Références d'un itinéraire (lignes verrouillées FOR SHARE filtré par ferme, T10d) ; supprimée,
 * introuvable ou d'une autre ferme → 'ecriture_invalide' :
 *   espece_id, variete_id    de la ferme OU de la bibliothèque, non supprimées ; la variété est
 *                            de l'espèce de l'itinéraire.
 *   travaux prévus           chaque couple (categorie, type) de parametres.travauxPrevus est un
 *                            type_intervention NON SUPPRIMÉ de la ferme de l'itinéraire (masqué
 *                            compris) ou de la liste de départ (ferme_id nul) ; un type écrit
 *                            plus haut dans le même lot compte. Un type d'une autre ferme se
 *                            comporte comme un type inexistant (même motif, même message au
 *                            libellé près).
 *
 * Type d'intervention UTILISÉ : son couple (categorie, libelle) figure dans les travaux prévus
 * d'un itinéraire NON SUPPRIMÉ de la même ferme. Sa suppression douce → 'ecriture_invalide'
 * (précision : il faut le masquer) ; le masquer (PATCH masque = 1) est accepté.
 *
 * Décisions du chef (docs/backlog/T23-itineraires-synchro.md) :
 *   5. les itinéraires désignent un type par son libellé : renommer un type UTILISÉ, ou changer
 *      sa catégorie → 'ecriture_invalide' ; (categorie, libelle) est unique parmi les types NON
 *      SUPPRIMÉS de la ferme ET de la liste de départ (création, renommage ou rétablissement
 *      d'un doublon → 'ecriture_invalide') ; recréer après une suppression est accepté.
 *   6. nom d'un itinéraire : 1 à 80 caractères après suppression des espaces de bord.
 *   7. ferme_id nul en PUT, ou PATCH de ferme_id → 'ecriture_invalide', rien d'autre.
 *   8. l'espèce d'un itinéraire est figée : PATCH de espece_id → 'ecriture_invalide' (même si
 *      une série l'utilise) ; variete_id change vers une variété de la même espèce ou null.
 *   9. supprimer un itinéraire utilisé par une série active est accepté ; un PATCH de la série
 *      qui ne touche pas itineraire_id passe encore ; créer une série sur l'itinéraire supprimé,
 *      ou y rattacher une série, reste refusé.
 *  10. libellé d'un type et `type` d'un travail prévu : espaces de bord (ASCII et insécables)
 *      rognés, NFC, stockés normalisés ; U+200B…U+200D, U+2060, U+FEFF et contrôles refusés.
 *  11. unicité (categorie, libelle) insensible à la casse (« Grelinette » doublon de
 *      « grelinette ») ; la référence d'un travail prévu à un type reste EXACTE.
 *
 * Une saisie = une transaction : un lot qui contient une écriture sur `itineraire` ou
 * `type_intervention` est accepté ou refusé EN ENTIER, avec les séries, occupations et le stock
 * du même lot (T24 : l'itinéraire et les séries à venir mises à jour avec lui). Un verrou par
 * ferme (pg_advisory_xact_lock) : deux lots sur la même ferme passent l'un après l'autre.
 *
 * Historique, écrit par le serveur dans la même transaction, une ligne `modification` par ligne
 * touchée : nom_table 'Itineraire' ou 'TypeIntervention', ferme_id, ligne_id, auteur_id =
 * utilisateur du jeton, horodatage = horloge du serveur, proposition_id NULL, et
 *   creation       avant NULL, apres = la ligne écrite (to_jsonb) ;
 *   modification   avant / apres = la ligne avant / après le PATCH (to_jsonb exacts) ;
 *   suppression    PATCH qui passe supprime_le de NULL à une valeur. Rétablir : 'modification'.
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

type Table = 'itineraire' | 'type_intervention' | 'serie' | 'occupation';

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
  readonly horodatage: string;
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
const SUPPRIME_LE = '2026-10-01T06:30:00.000Z';

/** Paramètres de la batavia de T02 (plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j). */
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

/** Grelinette 10 jours avant la mise en place : type de la liste de départ (travail du sol). */
const GRELINETTE = { categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 };
const GRELINETTE_NORMALISEE = { ...GRELINETTE, repetition: null, outil: null, produit: null, tempsEstime: null };

/** Travail prévu d'entretien sur le type `type`, tous les 14 jours de la mise en place au début de récolte. */
function entretien(type: string): Record<string, unknown> {
  return {
    categorie: 'entretien',
    type,
    repere: 'mise_en_place',
    decalageJours: 0,
    repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
    outil: 'houe maraîchère',
    produit: null,
    tempsEstime: { minutes: 20, par: 'cent_metres' },
  };
}

/** Dates de T02 : récolte à partir de la S22 2027 (lundi 2027-05-31). */
const DATES_S22 = {
  ancre_type: 'debut_recolte',
  ancre_date: '2027-05-31',
  prevu_semis_pepiniere: '2027-03-15',
  prevu_mise_en_place: '2027-04-12',
  prevu_debut_recolte: '2027-05-31',
  prevu_fin_recolte: '2027-06-14',
} as const;

decrireAvecBase('T23')('T23 : POST /sync/upload accepte les itinéraires et les types d’intervention des téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme principale, et membre aussi d'une seconde ferme. */
  let theo: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;

  let saison: string;
  let laitue: string;
  let laitueSupprimee: string;
  let batavia: string;
  let tomate: string;
  let varieteTomate: string;
  /** Bibliothèque commune (ferme_id nul). */
  let especeBibliotheque: string;
  let varieteBibliotheque: string;
  let itineraireBibliotheque: string;
  /** Un type de la liste de départ (ferme_id nul), lu en base. */
  let typeDepart: { id: string; categorie: string; libelle: string };
  /** Ferme voisine. */
  let especeVoisine: string;
  let varieteVoisine: string;
  let itineraireVoisin: string;
  let typeVoisin: string;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function inserer(sql: string, valeurs: readonly unknown[]): Promise<void> {
    await base.pool.query(sql, [...valeurs]);
  }

  async function familleEn(fermeId: string | null): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Astéracées', 2, 3)`, [
      id,
      fermeId,
    ]);
    return id;
  }

  async function especeEn(fermeId: string | null, familleId: string, nom = 'Laitue', supprimee = false): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, supprime_le)
       VALUES ($1, $2, $3, $4, 'legume', false, 'piece', $5)`,
      [id, fermeId, familleId, nom, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  async function varieteEn(fermeId: string | null, especeId: string): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Batavia blonde')`, [id, fermeId, especeId]);
    return id;
  }

  async function itineraireEn(fermeId: string | null, especeId: string, parametres: unknown): Promise<string> {
    const id = randomUUID();
    await inserer(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4)`,
      [id, fermeId, especeId, JSON.stringify(parametres)],
    );
    return id;
  }

  async function typeEn(fermeId: string, categorie: string, libelle: string, supprime = false): Promise<string> {
    const id = randomUUID();
    await inserer(`INSERT INTO type_intervention (id, ferme_id, categorie, libelle, supprime_le) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      fermeId,
      categorie,
      libelle,
      supprime ? MAINTENANT : null,
    ]);
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t23_itineraire');
    cles = { active: await genererCleSignature('cle-t23'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site de Théophane');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    theo = { id: u.id, jeton: await jetonPour(u.id) };

    const famille = await familleEn(ferme);
    saison = randomUUID();
    await inserer(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, ferme]);
    laitue = await especeEn(ferme, famille);
    laitueSupprimee = await especeEn(ferme, famille, 'Laitue abandonnée', true);
    batavia = await varieteEn(ferme, laitue);
    tomate = await especeEn(ferme, famille, 'Tomate');
    varieteTomate = await varieteEn(ferme, tomate);

    const familleBibliotheque = await familleEn(null);
    especeBibliotheque = await especeEn(null, familleBibliotheque);
    varieteBibliotheque = await varieteEn(null, especeBibliotheque);
    itineraireBibliotheque = await itineraireEn(null, especeBibliotheque, { ...BATAVIA, travauxPrevus: [GRELINETTE_NORMALISEE] });

    const familleVoisine = await familleEn(autreFerme);
    especeVoisine = await especeEn(autreFerme, familleVoisine);
    varieteVoisine = await varieteEn(autreFerme, especeVoisine);
    itineraireVoisin = await itineraireEn(autreFerme, especeVoisine, BATAVIA);
    typeVoisin = await typeEn(autreFerme, 'entretien', 'sarclage');
    await typeEn(secondeFerme, 'entretien', 'binage du second site');

    const depart = await base.pool.query<{ id: string; categorie: string; libelle: string }>(
      `SELECT id::text AS id, categorie, libelle FROM type_intervention WHERE ferme_id IS NULL AND categorie = 'travail_sol' AND libelle = 'grelinette'`,
    );
    const d = depart.rows[0];
    if (d === undefined) throw new Error('liste de départ absente : « grelinette » (travail du sol) à ferme_id nul attendue en base');
    typeDepart = d;
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

  async function ligne(table: Table, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function historique(id: string): Promise<LigneHistorique[]> {
    const r = await base.pool.query<LigneHistorique>(
      `SELECT ferme_id::text AS ferme_id, nom_table, ligne_id::text AS ligne_id, auteur_id::text AS auteur_id,
              to_char(horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS horodatage, operation, avant, apres,
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

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  /** PUT d'un itinéraire batavia de la ferme, avec la grelinette (liste de départ) ; `autres` : colonnes remplacées. */
  function putItineraire(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'itineraire',
      id: nouvelId<'Itineraire'>(),
      donnees: {
        ferme_id: ferme,
        espece_id: laitue,
        variete_id: batavia,
        nom: 'Batavia de printemps',
        mode: 'plant_maison',
        parametres: JSON.stringify({ ...BATAVIA, travauxPrevus: [GRELINETTE] }),
        ...autres,
      },
    };
  }

  /** Paramètres (texte JSON) de la batavia avec ces travaux prévus. */
  const avecTravaux = (travaux: readonly unknown[]): string => JSON.stringify({ ...BATAVIA, travauxPrevus: travaux });

  /** PUT d'un type d'intervention de la ferme ; libellé unique par défaut. */
  function putType(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'type_intervention',
      id: nouvelId(),
      donnees: { ferme_id: ferme, categorie: 'entretien', libelle: `binage ${String(tic % 100_000)}`, masque: 0, ...autres },
    };
  }

  const libelleDe = (t: EcritureEnvoyee): string => String(t.donnees?.libelle);

  const patch = (table: Table, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const supprimer = (table: Table, id: string): EcritureEnvoyee => patch(table, id, { supprime_le: SUPPRIME_LE });

  /** PUT d'une série batavia de 30 m sur l'itinéraire `itineraireId`, avec l'instantané `parametres`. */
  function putSerie(itineraireId: string, parametres: string): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'serie',
      id: nouvelId<'Serie'>(),
      donnees: {
        ferme_id: ferme,
        saison_id: saison,
        espece_id: laitue,
        variete_id: batavia,
        itineraire_id: itineraireId,
        parametres,
        ...DATES_S22,
        longueur_m: 30,
        nombre_plants: null,
        statut: 'prevue',
        rotation_acceptee: null,
      },
    };
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[]): Promise<void> {
    expect(await lot(ecritures)).toEqual({ refus: [] });
  }

  /** Type d'entretien de la ferme, accepté. */
  async function typeAccepte(autres: Record<string, unknown> = {}): Promise<EcritureEnvoyee> {
    const t = putType(autres);
    await accepte([t]);
    return t;
  }

  /** Itinéraire accepté ; rend l'écriture. */
  async function itineraireAccepte(autres: Record<string, unknown> = {}): Promise<EcritureEnvoyee> {
    const i = putItineraire(autres);
    await accepte([i]);
    return i;
  }

  /** Le lot est refusé EN ENTIER : rien d'écrit ni changé, chaque écriture a son refus, la fautive son motif. */
  async function refuseEnEntier(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string | readonly string[]): Promise<ReponseUpload> {
    const tables = new Set<string>(['itineraire', 'type_intervention', 'serie', 'occupation']);
    const avant = new Map<string, Ligne | null>();
    const historiques = new Map<string, number>();
    for (const e of ecritures) {
      if (tables.has(e.table)) avant.set(e.id, await ligne(e.table as Table, e.id));
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
      if (tables.has(e.table)) expect(await ligne(e.table as Table, e.id), `${e.table} ${e.id} inchangée`).toEqual(avant.get(e.id));
      expect(await modifications(e.id), `aucun historique de plus pour ${e.table} ${e.id}`).toBe(historiques.get(e.id));
      expect(await refusDe(e.id), `refus_synchro pour ${e.table} ${e.id}`).toBeGreaterThanOrEqual(1);
    }
    return reponse;
  }

  // ── Types d'intervention ────────────────────────────────────────────────────────────────────

  describe('types d’intervention : création (PUT)', () => {
    it('un type de la ferme : écrit, non masqué, avec son historique de création', async () => {
      const t = putType({ libelle: 'binage à la houe' });
      await accepte([t]);
      const l = await ligne('type_intervention', t.id);
      expect(l).toMatchObject({ id: t.id, ferme_id: ferme, categorie: 'entretien', libelle: 'binage à la houe', masque: false, supprime_le: null });
      const h = await historique(t.id);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ ferme_id: ferme, nom_table: 'TypeIntervention', ligne_id: t.id, auteur_id: theo.id, operation: 'creation', avant: null, proposition_id: null });
      expect(h[0]?.apres).toEqual(l);
    });

    it('masque envoyé en entier 1 (SQLite du téléphone) : rangé en booléen vrai', async () => {
      const t = await typeAccepte({ masque: 1 });
      expect((await ligne('type_intervention', t.id))?.masque).toBe(true);
    });

    it('cree_le et modifie_le envoyés : tolérés, remplis par le serveur', async () => {
      const t = await typeAccepte({ cree_le: '2020-01-01T00:00:00.000Z', modifie_le: '2020-01-01T00:00:00.000Z' });
      const l = await ligne('type_intervention', t.id);
      expect(String(l?.cree_le)).not.toContain('2020-01-01');
      expect(String(l?.modifie_le)).not.toContain('2020-01-01');
    });

    it('décision 5 : même catégorie et même libellé qu’un type de la liste de départ : refusé (doublon), la liste de départ ne change pas', async () => {
      const avant = await ligne('type_intervention', typeDepart.id);
      const t = putType({ categorie: typeDepart.categorie, libelle: typeDepart.libelle });
      await refuseEnEntier([t], t, 'ecriture_invalide');
      expect(await ligne('type_intervention', typeDepart.id)).toEqual(avant);
    });

    it('le même lot renvoyé (réponse perdue) : accepté, un seul historique', async () => {
      const t = putType();
      await accepte([t]);
      await accepte([t]);
      expect(await compter(`SELECT 1 FROM type_intervention WHERE id = $1`, [t.id])).toBe(1);
      expect(await modifications(t.id)).toBe(1);
    });

    it('même id, autres valeurs : refusé (il faut un PATCH), la ligne ne change pas', async () => {
      const t = await typeAccepte();
      await refuseEnEntier([{ ...t, donnees: { ...t.donnees, libelle: 'autre chose' } }], t, 'ecriture_invalide');
    });

    it('ferme_id nul (écrire dans la liste de départ) : ecriture_invalide, rien d’écrit', async () => {
      const t = putType({ ferme_id: null });
      await refuseEnEntier([t], t, 'ecriture_invalide');
      expect(await ligne('type_intervention', t.id)).toBeNull();
    });

    it('PUT qui reprend l’id d’un type de la liste de départ : refusé, la liste de départ ne change pas', async () => {
      const avant = await ligne('type_intervention', typeDepart.id);
      const t: EcritureEnvoyee = { ...putType({ categorie: typeDepart.categorie, libelle: typeDepart.libelle }), id: typeDepart.id };
      await refuseEnEntier([t], t, 'ecriture_invalide');
      expect(await ligne('type_intervention', typeDepart.id)).toEqual(avant);
    });

    it('PUT qui reprend l’id d’un type de la ferme voisine : refusé, le type voisin ne change pas', async () => {
      const t: EcritureEnvoyee = { ...putType({ libelle: 'sarclage' }), id: typeVoisin };
      await refuseEnEntier([t], t, 'ecriture_invalide');
      expect((await ligne('type_intervention', typeVoisin))?.ferme_id).toBe(autreFerme);
    });

    it('ferme_id d’une ferme dont l’utilisateur n’est pas membre : ferme_interdite', async () => {
      const t = putType({ ferme_id: autreFerme });
      await refuseEnEntier([t], t, 'ferme_interdite');
    });

    it.each([
      ['catégorie inconnue', { categorie: 'recolte' }],
      ['libellé vide', { libelle: ' ' }],
      ['libellé de 31 caractères', { libelle: 'b'.repeat(31) }],
      ['masque en texte', { masque: 'oui' }],
      ['colonne inconnue', { couleur: 'vert' }],
      ['id glissé dans les données', { id: randomUUID() }],
    ])('%s : ecriture_invalide (validerTypeIntervention)', async (_cas, autres) => {
      const t = putType(autres);
      await refuseEnEntier([t], t, 'ecriture_invalide');
    });
  });

  describe('types d’intervention : modification, masque, suppression douce', () => {
    it('renommer un type (PATCH libelle) : accepté, historique avant / après exacts', async () => {
      const t = await typeAccepte();
      const avant = await ligne('type_intervention', t.id);
      await accepte([patch('type_intervention', t.id, { libelle: 'binage renommé' })]);
      const apres = await ligne('type_intervention', t.id);
      expect(apres?.libelle).toBe('binage renommé');
      const modif = (await historique(t.id)).at(-1);
      expect(modif).toMatchObject({ nom_table: 'TypeIntervention', operation: 'modification', auteur_id: theo.id });
      expect(modif?.avant).toEqual(avant);
      expect(modif?.apres).toEqual(apres);
    });

    it('masquer (PATCH masque 1) puis démasquer (0) : acceptés, deux modifications', async () => {
      const t = await typeAccepte();
      await accepte([patch('type_intervention', t.id, { masque: 1 })]);
      expect((await ligne('type_intervention', t.id))?.masque).toBe(true);
      await accepte([patch('type_intervention', t.id, { masque: 0 })]);
      expect((await ligne('type_intervention', t.id))?.masque).toBe(false);
      expect((await historique(t.id)).map((h) => h.operation)).toEqual(['creation', 'modification', 'modification']);
    });

    it('PATCH qui ne change rien : accepté, rien d’écrit', async () => {
      const t = await typeAccepte();
      const avant = await ligne('type_intervention', t.id);
      await accepte([patch('type_intervention', t.id, { masque: 0 })]);
      expect(await ligne('type_intervention', t.id)).toEqual(avant);
      expect(await modifications(t.id)).toBe(1);
    });

    it('supprimer un type que rien n’utilise : suppression douce, historique « suppression »', async () => {
      const t = await typeAccepte();
      await accepte([supprimer('type_intervention', t.id)]);
      expect((await ligne('type_intervention', t.id))?.supprime_le).not.toBeNull();
      expect((await historique(t.id)).at(-1)?.operation).toBe('suppression');
      // Rétablir : une modification.
      await accepte([patch('type_intervention', t.id, { supprime_le: null })]);
      expect((await historique(t.id)).at(-1)?.operation).toBe('modification');
    });

    it('supprimer un type utilisé par un itinéraire de la ferme : refusé, il se masque', async () => {
      const t = await typeAccepte();
      await itineraireAccepte({ parametres: avecTravaux([GRELINETTE, entretien(libelleDe(t))]) });
      const suppression = supprimer('type_intervention', t.id);
      await refuseEnEntier([suppression], suppression, 'ecriture_invalide');
      await accepte([patch('type_intervention', t.id, { masque: 1 })]);
      expect(await ligne('type_intervention', t.id)).toMatchObject({ masque: true, supprime_le: null });
    });

    it('un type utilisé seulement par un itinéraire supprimé se supprime', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      await accepte([supprimer('itineraire', i.id)]);
      await accepte([supprimer('type_intervention', t.id)]);
    });

    it('même libellé dans une autre catégorie : ne compte pas comme une utilisation', async () => {
      const couverture = await typeAccepte({ categorie: 'couverture' });
      await typeAccepte({ categorie: 'entretien', libelle: libelleDe(couverture) });
      await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(couverture))]) });
      await accepte([supprimer('type_intervention', couverture.id)]);
    });

    it('type utilisé par un itinéraire écrit plus haut dans le même lot : suppression refusée, rien d’écrit', async () => {
      const t = await typeAccepte();
      const i = putItineraire({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      const suppression = supprimer('type_intervention', t.id);
      await refuseEnEntier([i, suppression], suppression, 'ecriture_invalide');
    });

    it('PATCH d’un type de la liste de départ : comme une ligne inexistante, rien ne change, ferme nulle', async () => {
      const avant = await ligne('type_intervention', typeDepart.id);
      const p = patch('type_intervention', typeDepart.id, { masque: 1 });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('type_intervention', typeDepart.id)).toEqual(avant);
      expect((await refusSynchro(typeDepart.id)).every((r) => r.ferme_id === null)).toBe(true);
    });

    it('supprimer un type de la liste de départ : refusé aussi', async () => {
      const s = supprimer('type_intervention', typeDepart.id);
      await refuseEnEntier([s], s, 'ecriture_invalide');
    });

    it('PATCH d’un type de la ferme voisine : même réponse qu’un id inexistant, rien ne change', async () => {
      const avant = await ligne('type_intervention', typeVoisin);
      const voisin = patch('type_intervention', typeVoisin, { libelle: 'volé' });
      const inconnu = patch('type_intervention', randomUUID(), { libelle: 'volé' });
      await refuseEnEntier([voisin], voisin, 'ecriture_invalide');
      await refuseEnEntier([inconnu], inconnu, 'ecriture_invalide');
      expect(await ligne('type_intervention', typeVoisin)).toEqual(avant);
      const [a, b] = [await refusSynchro(typeVoisin), await refusSynchro(inconnu.id)];
      expect(a.at(-1)?.ferme_id).toBeNull();
      expect(a.at(-1)?.message).toBe(b.at(-1)?.message);
    });

    it('décision 7 : PATCH de ferme_id vers la ferme voisine, une autre ferme de Théophane ou NULL : ecriture_invalide, rien d’autre', async () => {
      const t = await typeAccepte();
      for (const vers of [autreFerme, secondeFerme, null]) {
        const p = patch('type_intervention', t.id, { ferme_id: vers });
        await refuseEnEntier([p], p, 'ecriture_invalide');
      }
    });

    it('DELETE réel d’un type : refusé, la ligne reste', async () => {
      const t = await typeAccepte();
      const d: EcritureEnvoyee = { op: 'DELETE', table: 'type_intervention', id: t.id };
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne('type_intervention', t.id)).not.toBeNull();
    });
  });

  // ── Itinéraires ─────────────────────────────────────────────────────────────────────────────

  describe('itinéraires : création (PUT)', () => {
    it('itinéraire de la ferme avec un type de départ et un type de la ferme : écrit, travaux normalisés, historique', async () => {
      const t = await typeAccepte();
      const i = putItineraire({ parametres: avecTravaux([GRELINETTE, entretien(libelleDe(t))]) });
      await accepte([i]);
      const l = await ligne('itineraire', i.id);
      expect(l).toMatchObject({ id: i.id, ferme_id: ferme, espece_id: laitue, variete_id: batavia, nom: 'Batavia de printemps', mode: 'plant_maison', supprime_le: null });
      const parametres = l?.parametres as Record<string, unknown> | undefined;
      expect(parametres?.dureeAvantRecolteJours).toBe(49);
      // Rangé en jsonb (objet), travaux normalisés par le cœur (T22).
      expect(parametres?.travauxPrevus).toEqual([GRELINETTE_NORMALISEE, entretien(libelleDe(t))]);
      const h = await historique(i.id);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ ferme_id: ferme, nom_table: 'Itineraire', auteur_id: theo.id, operation: 'creation', avant: null, proposition_id: null });
      expect(h[0]?.apres).toEqual(l);
      expect(h[0]?.horodatage.startsWith('2026-10-01T06:')).toBe(true);
    });

    it('type et itinéraire qui l’utilise dans le même lot (type écrit en premier) : acceptés', async () => {
      const t = putType();
      await accepte([t, putItineraire({ parametres: avecTravaux([entretien(libelleDe(t))]) })]);
    });

    it('sans travaux prévus (itinéraire d’avant T22) : accepté', async () => {
      await itineraireAccepte({ parametres: JSON.stringify(BATAVIA) });
    });

    it('type masqué de la ferme : accepté (le masque cache le type des listes de choix, il ne casse pas les itinéraires)', async () => {
      const t = await typeAccepte({ masque: 1 });
      await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
    });

    it('espèce et variété de la bibliothèque commune : accepté', async () => {
      await itineraireAccepte({ espece_id: especeBibliotheque, variete_id: varieteBibliotheque });
    });

    it('dupliquer un itinéraire de la bibliothèque dans la ferme : accepté, l’original ne change pas', async () => {
      const avant = await ligne('itineraire', itineraireBibliotheque);
      const copie = putItineraire({
        espece_id: especeBibliotheque,
        variete_id: null,
        nom: 'Batavia de printemps (ma version)',
        parametres: JSON.stringify(avant?.parametres),
      });
      await accepte([copie]);
      expect((await ligne('itineraire', copie.id))?.ferme_id).toBe(ferme);
      expect(await ligne('itineraire', itineraireBibliotheque)).toEqual(avant);
    });

    it('le même lot renvoyé (réponse perdue) : accepté, rien en double', async () => {
      const i = putItineraire();
      await accepte([i]);
      await accepte([i]);
      expect(await compter(`SELECT 1 FROM itineraire WHERE id = $1`, [i.id])).toBe(1);
      expect(await modifications(i.id)).toBe(1);
    });

    it('même id, autres valeurs : refusé, la ligne ne change pas', async () => {
      const i = await itineraireAccepte();
      await refuseEnEntier([{ ...i, donnees: { ...i.donnees, nom: 'Autre nom' } }], i, 'ecriture_invalide');
    });

    it('ferme_id nul (écrire dans la bibliothèque commune) : ecriture_invalide, rien d’écrit', async () => {
      const i = putItineraire({ ferme_id: null });
      await refuseEnEntier([i], i, 'ecriture_invalide');
      expect(await ligne('itineraire', i.id)).toBeNull();
    });

    it('PUT qui reprend l’id d’un itinéraire de la bibliothèque : refusé, l’original ne change pas', async () => {
      const avant = await ligne('itineraire', itineraireBibliotheque);
      const i: EcritureEnvoyee = { ...putItineraire({ espece_id: especeBibliotheque, variete_id: null }), id: itineraireBibliotheque };
      await refuseEnEntier([i], i, 'ecriture_invalide');
      expect(await ligne('itineraire', itineraireBibliotheque)).toEqual(avant);
    });

    it('PUT qui reprend l’id d’un itinéraire de la ferme voisine : refusé, il ne change pas', async () => {
      const avant = await ligne('itineraire', itineraireVoisin);
      const i: EcritureEnvoyee = { ...putItineraire(), id: itineraireVoisin };
      await refuseEnEntier([i], i, 'ecriture_invalide');
      expect(await ligne('itineraire', itineraireVoisin)).toEqual(avant);
    });

    it('ferme_id d’une ferme dont l’utilisateur n’est pas membre : ferme_interdite', async () => {
      const i = putItineraire({ ferme_id: autreFerme, espece_id: especeVoisine, variete_id: null, parametres: JSON.stringify(BATAVIA) });
      await refuseEnEntier([i], i, 'ferme_interdite');
    });

    it('un id glissé dans les données : refusé', async () => {
      const i = putItineraire({ id: randomUUID() });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });
  });

  describe('itinéraires : références de la ferme ou de la bibliothèque', () => {
    it.each([
      ['espèce de la ferme voisine', () => ({ espece_id: especeVoisine, variete_id: null })],
      ['espèce introuvable', () => ({ espece_id: randomUUID(), variete_id: null })],
      ['espèce supprimée', () => ({ espece_id: laitueSupprimee, variete_id: null })],
      ['variété de la ferme voisine', () => ({ variete_id: varieteVoisine })],
      ['variété introuvable', () => ({ variete_id: randomUUID() })],
      ['variété d’une autre espèce de la ferme', () => ({ variete_id: varieteTomate })],
      ['variété de la bibliothèque, d’une autre espèce', () => ({ variete_id: varieteBibliotheque })],
    ])('%s : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
      const i = putItineraire(autres());
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('PATCH qui change l’espèce pour celle de la ferme voisine : refusé, rien ne change', async () => {
      const i = await itineraireAccepte({ variete_id: null });
      const p = patch('itineraire', i.id, { espece_id: especeVoisine });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('PATCH qui change l’espèce sans la variété : refusé (variété d’une autre espèce)', async () => {
      const i = await itineraireAccepte();
      const p = patch('itineraire', i.id, { espece_id: tomate });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('itinéraires : travaux prévus validés par le cœur (T22) et types de la ferme', () => {
    it.each([
      ['type d’une autre ferme', () => entretien('sarclage')],
      ['type de la seconde ferme de Théophane', () => entretien('binage du second site')],
      ['type inconnu', () => entretien('hersage de fantaisie')],
      ['type de départ dans une autre catégorie', () => ({ ...GRELINETTE, categorie: 'entretien' })],
    ])('%s : ecriture_invalide, rien d’écrit', async (_cas, travail) => {
      const i = putItineraire({ parametres: avecTravaux([GRELINETTE, travail()]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('type supprimé de la ferme : refusé', async () => {
      await typeEn(ferme, 'entretien', 'buttage manuel supprimé', true);
      const i = putItineraire({ parametres: avecTravaux([entretien('buttage manuel supprimé')]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('le refus d’un type d’une autre ferme ne dit rien d’elle (même message qu’un type inexistant, au libellé près)', async () => {
      const etranger = putItineraire({ parametres: avecTravaux([entretien('sarclage')]) });
      const inconnu = putItineraire({ parametres: avecTravaux([entretien('zzzzzzzz')]) });
      await lot([etranger]);
      await lot([inconnu]);
      const [a, b] = [(await refusSynchro(etranger.id)).at(-1), (await refusSynchro(inconnu.id)).at(-1)];
      expect(a?.motif).toBe('ecriture_invalide');
      expect(a?.motif).toBe(b?.motif);
      expect(a?.message.replaceAll('sarclage', '…')).toBe(b?.message.replaceAll('zzzzzzzz', '…'));
      expect(a?.ferme_id).toBe(ferme);
    });

    it.each([
      ['décalage en texte', { ...GRELINETTE, decalageJours: '-10' }],
      ['repère inconnu', { ...GRELINETTE, repere: 'recolte' }],
      ['répétition qui finit avant de commencer', { ...entretien('grelinette'), categorie: 'travail_sol', repere: 'debut_recolte', repetition: { tousLesJours: 7, repereFin: 'mise_en_place' } }],
      ['temps estimé au-delà du plafond', { ...GRELINETTE, tempsEstime: { minutes: 6_000, par: 'planche' } }],
      ['clé inconnue', { ...GRELINETTE, couleur: 'rouge' }],
    ])('travail invalide (%s) : ecriture_invalide', async (_cas, travail) => {
      const i = putItineraire({ parametres: avecTravaux([travail]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('repère « semis en pépinière » en semis direct : refusé', async () => {
      const radis = { mode: 'semis_direct', dureeAvantRecolteJours: 28, fenetreRecolteJours: 7, periodeUsage: null, typeAbri: null };
      const i = putItineraire({ mode: 'semis_direct', parametres: JSON.stringify({ ...radis, travauxPrevus: [{ ...GRELINETTE, repere: 'semis_pepiniere' }] }) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('fertilisation sans produit : refusée (T22 : le produit est obligatoire)', async () => {
      const i = putItineraire({ parametres: avecTravaux([{ categorie: 'fertilisation', type: 'engrais', repere: 'mise_en_place', decalageJours: -7 }]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('colonne mode différente de parametres.mode : refusé', async () => {
      const i = putItineraire({ mode: 'plant_achete' });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('treize travaux prévus : refusé (T22 : douze au plus)', async () => {
      const i = putItineraire({ parametres: avecTravaux(Array.from({ length: 13 }, () => GRELINETTE)) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });
  });

  describe('itinéraires : modification (PATCH), suppression douce, DELETE', () => {
    it('ajouter un travail (PATCH parametres) et renommer : accepté, historique avant / après exacts', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte();
      const avant = await ligne('itineraire', i.id);
      await accepte([patch('itineraire', i.id, { nom: 'Batavia d’été', parametres: avecTravaux([GRELINETTE, entretien(libelleDe(t))]) })]);
      const apres = await ligne('itineraire', i.id);
      expect(apres?.nom).toBe('Batavia d’été');
      expect((apres?.parametres as Record<string, unknown> | undefined)?.travauxPrevus).toHaveLength(2);
      const modif = (await historique(i.id)).at(-1);
      expect(modif).toMatchObject({ nom_table: 'Itineraire', operation: 'modification', auteur_id: theo.id, proposition_id: null });
      expect(modif?.avant).toEqual(avant);
      expect(modif?.apres).toEqual(apres);
    });

    it('PATCH du nom seul, les travaux utilisant un type masqué entre-temps : accepté', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      await accepte([patch('type_intervention', t.id, { masque: 1 })]);
      await accepte([patch('itineraire', i.id, { nom: 'Batavia renommée' })]);
    });

    it('PATCH qui ne change rien (renvoi) : accepté, rien d’écrit', async () => {
      const i = await itineraireAccepte();
      const avant = await ligne('itineraire', i.id);
      await accepte([patch('itineraire', i.id, { nom: 'Batavia de printemps' })]);
      expect(await ligne('itineraire', i.id)).toEqual(avant);
      expect(await modifications(i.id)).toBe(1);
    });

    it('PATCH avec un travail invalide : refusé, rien ne change', async () => {
      const i = await itineraireAccepte();
      const p = patch('itineraire', i.id, { parametres: avecTravaux([entretien('sarclage')]) });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('supprimer puis rétablir un itinéraire : suppression puis modification', async () => {
      const i = await itineraireAccepte();
      await accepte([supprimer('itineraire', i.id)]);
      expect((await ligne('itineraire', i.id))?.supprime_le).not.toBeNull();
      expect((await historique(i.id)).at(-1)?.operation).toBe('suppression');
      await accepte([patch('itineraire', i.id, { supprime_le: null })]);
      expect((await historique(i.id)).map((h) => h.operation)).toEqual(['creation', 'suppression', 'modification']);
    });

    it('PATCH d’un itinéraire de la bibliothèque : comme une ligne inexistante, rien ne change, ferme nulle', async () => {
      const avant = await ligne('itineraire', itineraireBibliotheque);
      const p = patch('itineraire', itineraireBibliotheque, { nom: 'Ma batavia' });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('itineraire', itineraireBibliotheque)).toEqual(avant);
      expect((await refusSynchro(itineraireBibliotheque)).every((r) => r.ferme_id === null)).toBe(true);
    });

    it('PATCH qui s’approprie un itinéraire de la bibliothèque (ferme_id de la ferme) : refusé, rien ne change', async () => {
      const avant = await ligne('itineraire', itineraireBibliotheque);
      const p = patch('itineraire', itineraireBibliotheque, { ferme_id: ferme });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('itineraire', itineraireBibliotheque)).toEqual(avant);
    });

    it('supprimer un itinéraire de la bibliothèque : refusé', async () => {
      const s = supprimer('itineraire', itineraireBibliotheque);
      await refuseEnEntier([s], s, 'ecriture_invalide');
    });

    it('PATCH qui verse un itinéraire de la ferme dans la bibliothèque (ferme_id NULL) : refusé', async () => {
      const i = await itineraireAccepte();
      const p = patch('itineraire', i.id, { ferme_id: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('décision 7 : PATCH de ferme_id vers la ferme voisine ou une autre ferme de Théophane : ecriture_invalide, rien ne change', async () => {
      const i = await itineraireAccepte();
      for (const vers of [autreFerme, secondeFerme]) {
        const p = patch('itineraire', i.id, { ferme_id: vers });
        await refuseEnEntier([p], p, 'ecriture_invalide');
      }
    });

    it('PATCH d’un itinéraire de la ferme voisine : même réponse qu’un id inexistant, rien ne change', async () => {
      const avant = await ligne('itineraire', itineraireVoisin);
      const voisin = patch('itineraire', itineraireVoisin, { nom: 'volé' });
      const inconnu = patch('itineraire', randomUUID(), { nom: 'volé' });
      await refuseEnEntier([voisin], voisin, 'ecriture_invalide');
      await refuseEnEntier([inconnu], inconnu, 'ecriture_invalide');
      expect(await ligne('itineraire', itineraireVoisin)).toEqual(avant);
      const [a, b] = [(await refusSynchro(itineraireVoisin)).at(-1), (await refusSynchro(inconnu.id)).at(-1)];
      expect(a?.ferme_id).toBeNull();
      expect(a?.message).toBe(b?.message);
    });

    it('DELETE réel d’un itinéraire : refusé, la ligne reste', async () => {
      const i = await itineraireAccepte();
      const d: EcritureEnvoyee = { op: 'DELETE', table: 'itineraire', id: i.id };
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne('itineraire', i.id)).not.toBeNull();
    });

    it('DELETE d’un itinéraire de la bibliothèque : refusé, il reste', async () => {
      const d: EcritureEnvoyee = { op: 'DELETE', table: 'itineraire', id: itineraireBibliotheque };
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne('itineraire', itineraireBibliotheque)).not.toBeNull();
    });
  });

  // ── Tout ou rien, verrou par ferme ──────────────────────────────────────────────────────────

  describe('tout ou rien : itinéraire, types et séries dans un même lot', () => {
    it('type juste + itinéraire invalide : rien d’écrit, pas même le type', async () => {
      const t = putType();
      const i = putItineraire({ espece_id: especeVoisine, variete_id: null, parametres: avecTravaux([entretien(libelleDe(t))]) });
      await refuseEnEntier([t, i], i, 'ecriture_invalide');
      expect(await ligne('type_intervention', t.id)).toBeNull();
    });

    it('type invalide + itinéraire juste : rien d’écrit, pas même l’itinéraire', async () => {
      const t = putType({ categorie: 'recolte' });
      const i = putItineraire();
      await refuseEnEntier([i, t], t, 'ecriture_invalide');
      expect(await ligne('itineraire', i.id)).toBeNull();
    });

    it('itinéraire créé et série qui l’utilise dans le même lot : acceptés', async () => {
      const i = putItineraire();
      const parametres = String(i.donnees?.parametres);
      const s = putSerie(i.id, parametres);
      await accepte([i, s]);
      expect((await ligne('serie', s.id))?.itineraire_id).toBe(i.id);
    });

    it('T24 : itinéraire modifié et série à venir mise à jour avec lui, en un lot : les deux écrits', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte();
      const s = putSerie(i.id, String(i.donnees?.parametres));
      await accepte([s]);
      const nouveaux = avecTravaux([GRELINETTE, entretien(libelleDe(t))]);
      await accepte([patch('itineraire', i.id, { parametres: nouveaux }), patch('serie', s.id, { parametres: nouveaux })]);
      expect((await ligne('itineraire', i.id))?.parametres).toEqual((await ligne('serie', s.id))?.parametres);
    });

    it('T24 : itinéraire modifié + série mise à jour invalide : l’itinéraire ne change pas', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte();
      const s = putSerie(i.id, String(i.donnees?.parametres));
      await accepte([s]);
      const nouveaux = avecTravaux([GRELINETTE, entretien(libelleDe(t))]);
      const pi = patch('itineraire', i.id, { parametres: nouveaux });
      // Série fausse : durée avant récolte changée sans ses dates recalculées.
      const ps = patch('serie', s.id, { parametres: JSON.stringify({ ...BATAVIA, dureeAvantRecolteJours: 56 }) });
      await refuseEnEntier([pi, ps], ps, 'ecriture_invalide');
    });

    it('itinéraire juste + série invalide (PUT) : l’itinéraire n’est pas écrit', async () => {
      const i = putItineraire();
      const s = putSerie(i.id, String(i.donnees?.parametres));
      const fausse: EcritureEnvoyee = { ...s, donnees: { ...s.donnees, prevu_fin_recolte: '2027-06-15' } };
      await refuseEnEntier([i, fausse], fausse, 'ecriture_invalide');
      expect(await ligne('itineraire', i.id)).toBeNull();
    });

    it('lot itinéraire + événement du journal : tout ou rien aussi', async () => {
      const i = putItineraire({ espece_id: especeVoisine, variete_id: null });
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
          note: 'limaces',
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify({ nature: 'ravageur', gravite: null }),
        },
      };
      const reponse = await lot([observation, i]);
      expect(motifDe(reponse, i.id)).toBe('ecriture_invalide');
      expect(reponse.refus.some((r) => r.id === observation.id)).toBe(true);
      expect(await compter(`SELECT 1 FROM evenement WHERE id = $1`, [observation.id])).toBe(0);
    });

    it('deux lots en même temps sur le même itinéraire : les deux passent, l’historique s’enchaîne', async () => {
      const i = await itineraireAccepte();
      const [r1, r2] = await Promise.all([
        lot([patch('itineraire', i.id, { nom: 'Batavia A' })]),
        lot([patch('itineraire', i.id, { variete_id: null })]),
      ]);
      expect(r1).toEqual({ refus: [] });
      expect(r2).toEqual({ refus: [] });
      const finale = await ligne('itineraire', i.id);
      expect(finale).toMatchObject({ nom: 'Batavia A', variete_id: null });
      const h = await historique(i.id);
      expect(h.map((x) => x.operation)).toEqual(['creation', 'modification', 'modification']);
      expect(h[2]?.avant).toEqual(h[1]?.apres);
      expect(h[2]?.apres).toEqual(finale);
    });

    it('en même temps : un téléphone supprime un type, l’autre crée un itinéraire qui l’utilise ; jamais les deux', async () => {
      for (let essai = 0; essai < 5; essai++) {
        const t = await typeAccepte();
        const i = putItineraire({ parametres: avecTravaux([entretien(libelleDe(t))]) });
        const s = supprimer('type_intervention', t.id);
        const [ri, rs] = await Promise.all([lot([i]), lot([s])]);
        const acceptes = [ri.refus.length === 0, rs.refus.length === 0].filter(Boolean).length;
        expect(acceptes, `essai ${String(essai)} : exactement un des deux lots passe`).toBe(1);
        const typeSupprime = (await ligne('type_intervention', t.id))?.supprime_le != null;
        const itineraireEcrit = (await ligne('itineraire', i.id)) !== null;
        expect(typeSupprime && itineraireEcrit, 'un itinéraire actif n’utilise jamais un type supprimé').toBe(false);
      }
    });
  });

  // ── Décisions du chef 5 et 6 ────────────────────────────────────────────────────────────────

  describe('décision 5 : un type est désigné par son libellé', () => {
    it('renommer un type utilisé par un itinéraire : refusé, rien ne change', async () => {
      const t = await typeAccepte();
      await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      const p = patch('type_intervention', t.id, { libelle: 'nouveau nom' });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('changer la catégorie d’un type utilisé : refusé, rien ne change', async () => {
      const t = await typeAccepte();
      await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      const p = patch('type_intervention', t.id, { categorie: 'travail_sol' });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('renommer ou changer la catégorie d’un type non utilisé : accepté', async () => {
      const t = await typeAccepte();
      await accepte([patch('type_intervention', t.id, { libelle: `${libelleDe(t)} r` })]);
      await accepte([patch('type_intervention', t.id, { categorie: 'couverture' })]);
      expect(await ligne('type_intervention', t.id)).toMatchObject({ libelle: `${libelleDe(t)} r`, categorie: 'couverture' });
    });

    it('un type utilisé seulement par un itinéraire supprimé se renomme', async () => {
      const t = await typeAccepte();
      const i = await itineraireAccepte({ parametres: avecTravaux([entretien(libelleDe(t))]) });
      await accepte([supprimer('itineraire', i.id)]);
      await accepte([patch('type_intervention', t.id, { libelle: `${libelleDe(t)} r` })]);
    });

    it('doublon d’un type actif de la ferme (même catégorie, même libellé) : refusé', async () => {
      const t = await typeAccepte();
      const doublon = putType({ libelle: libelleDe(t) });
      await refuseEnEntier([doublon], doublon, 'ecriture_invalide');
    });

    it('deux créations du même type dans un même lot : refusé en entier', async () => {
      const a = putType();
      const b = putType({ libelle: libelleDe(a) });
      await refuseEnEntier([a, b], b, 'ecriture_invalide');
    });

    it('même libellé dans une autre catégorie : accepté', async () => {
      const t = await typeAccepte();
      await typeAccepte({ categorie: 'couverture', libelle: libelleDe(t) });
    });

    it('même catégorie et même libellé qu’un type d’une autre ferme : accepté (l’unicité est par ferme)', async () => {
      await typeAccepte({ libelle: 'sarclage' });
    });

    it('renommer un type en doublon d’un autre type actif ou de la liste de départ : refusé', async () => {
      const autre = await typeAccepte();
      const t = await typeAccepte();
      const versAutre = patch('type_intervention', t.id, { libelle: libelleDe(autre) });
      await refuseEnEntier([versAutre], versAutre, 'ecriture_invalide');
      const versDepart = patch('type_intervention', t.id, { categorie: typeDepart.categorie, libelle: typeDepart.libelle });
      await refuseEnEntier([versDepart], versDepart, 'ecriture_invalide');
    });

    it('recréer un type après l’avoir supprimé : accepté', async () => {
      const t = await typeAccepte();
      await accepte([supprimer('type_intervention', t.id)]);
      await typeAccepte({ libelle: libelleDe(t) });
    });

    it('rétablir un type supprimé alors qu’un type actif a pris son libellé : refusé', async () => {
      const t = await typeAccepte();
      await accepte([supprimer('type_intervention', t.id)]);
      await typeAccepte({ libelle: libelleDe(t) });
      const p = patch('type_intervention', t.id, { supprime_le: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('décision 6 : nom d’un itinéraire de 1 à 80 caractères, espaces de bord retirés', () => {
    it('80 caractères : accepté', async () => {
      await itineraireAccepte({ nom: 'B'.repeat(80) });
    });

    it('80 caractères entourés d’espaces : accepté', async () => {
      await itineraireAccepte({ nom: `  ${'B'.repeat(80)}  ` });
    });

    it.each([
      ['81 caractères', 'B'.repeat(81)],
      ['vide', ''],
      ['que des espaces', '   '],
    ])('nom de %s : ecriture_invalide', async (_cas, nom) => {
      const i = putItineraire({ nom });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('PATCH vers un nom de 81 caractères : refusé, rien ne change', async () => {
      const i = await itineraireAccepte();
      const p = patch('itineraire', i.id, { nom: 'B'.repeat(81) });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  // ── Décisions du chef après la relecture (8 à 11) ──────────────────────────────────────────

  describe('décision 8 : l’espèce d’un itinéraire est figée', () => {
    it('PATCH de espece_id vers une autre espèce de la ferme (variété à null) : refusé, rien ne change', async () => {
      const i = await itineraireAccepte({ variete_id: null });
      const p = patch('itineraire', i.id, { espece_id: tomate });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('PATCH de espece_id vers une espèce de la bibliothèque : refusé', async () => {
      const i = await itineraireAccepte({ variete_id: null });
      const p = patch('itineraire', i.id, { espece_id: especeBibliotheque });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('scénario de la relecture : itinéraire utilisé par une série, PATCH de espece_id : refusé, l’itinéraire et la série ne changent pas', async () => {
      const i = await itineraireAccepte({ variete_id: null });
      const s = putSerie(i.id, String(i.donnees?.parametres));
      await accepte([{ ...s, donnees: { ...s.donnees, variete_id: null } }]);
      const serieAvant = await ligne('serie', s.id);
      const p = patch('itineraire', i.id, { espece_id: tomate });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('serie', s.id)).toEqual(serieAvant);
      expect((await ligne('itineraire', i.id))?.espece_id).toBe(laitue);
    });

    it('variete_id vers une autre variété de la même espèce : accepté', async () => {
      const autreBatavia = await varieteEn(ferme, laitue);
      const i = await itineraireAccepte();
      await accepte([patch('itineraire', i.id, { variete_id: autreBatavia })]);
      expect((await ligne('itineraire', i.id))?.variete_id).toBe(autreBatavia);
    });

    it('variete_id vers null : accepté', async () => {
      const i = await itineraireAccepte();
      await accepte([patch('itineraire', i.id, { variete_id: null })]);
      expect((await ligne('itineraire', i.id))?.variete_id).toBeNull();
    });

    it('variete_id vers une variété d’une autre espèce : refusé', async () => {
      const i = await itineraireAccepte();
      const p = patch('itineraire', i.id, { variete_id: varieteTomate });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('décision 9 : supprimer un itinéraire utilisé par une série', () => {
    /** Itinéraire accepté et une série active qui l'utilise. */
    async function itineraireEtSerie(): Promise<{ i: EcritureEnvoyee; s: EcritureEnvoyee }> {
      const i = await itineraireAccepte();
      const s = putSerie(i.id, String(i.donnees?.parametres));
      await accepte([s]);
      return { i, s };
    }

    it('supprimer l’itinéraire : accepté, la série garde son instantané', async () => {
      const { i, s } = await itineraireEtSerie();
      const serieAvant = await ligne('serie', s.id);
      await accepte([supprimer('itineraire', i.id)]);
      expect((await ligne('itineraire', i.id))?.supprime_le).not.toBeNull();
      expect(await ligne('serie', s.id)).toEqual(serieAvant);
    });

    it('ensuite, un PATCH de la série qui ne touche pas itineraire_id : accepté', async () => {
      const { i, s } = await itineraireEtSerie();
      await accepte([supprimer('itineraire', i.id)]);
      await accepte([patch('serie', s.id, { statut: 'en_cours' })]);
      expect((await ligne('serie', s.id))?.statut).toBe('en_cours');
    });

    it('ensuite, supprimer puis rétablir la série (itineraire_id inchangé) : accepté', async () => {
      const { i, s } = await itineraireEtSerie();
      await accepte([supprimer('itineraire', i.id)]);
      await accepte([supprimer('serie', s.id)]);
      await accepte([patch('serie', s.id, { supprime_le: null })]);
    });

    it('créer une série sur l’itinéraire supprimé : refusé', async () => {
      const { i } = await itineraireEtSerie();
      await accepte([supprimer('itineraire', i.id)]);
      const nouvelle = putSerie(i.id, String(i.donnees?.parametres));
      await refuseEnEntier([nouvelle], nouvelle, 'ecriture_invalide');
    });

    it('rattacher une série existante à l’itinéraire supprimé : refusé, la série ne change pas', async () => {
      const { i } = await itineraireEtSerie();
      const { s: autre } = await itineraireEtSerie();
      await accepte([supprimer('itineraire', i.id)]);
      const p = patch('serie', autre.id, { itineraire_id: i.id });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('décision 10 : libellés rognés et normalisés en NFC', () => {
    const NFD = (t: string): string => t.normalize('NFD');

    it.each([
      ['espace finale', (l: string) => `${l} `],
      ['espace initiale', (l: string) => ` ${l}`],
      ['espace insécable finale', (l: string) => `${l}\u00A0`],
    ])('type dont le libellé a une %s : accepté, stocké rogné', async (_cas, habiller) => {
      const base = libelleDe(putType());
      const t = putType({ libelle: habiller(base) });
      await accepte([t]);
      expect((await ligne('type_intervention', t.id))?.libelle).toBe(base);
    });

    it('type « bêchage » écrit en NFD : accepté, stocké en NFC', async () => {
      const nfc = `bêchage ${String(tic % 100_000)}`;
      const t = putType({ libelle: NFD(nfc) });
      expect(NFD(nfc)).not.toBe(nfc);
      await accepte([t]);
      expect((await ligne('type_intervention', t.id))?.libelle).toBe(nfc);
    });

    it.each([
      ['U+200B (espace de largeur nulle) en fin', (l: string) => `${l}\u200B`],
      ['U+200C au milieu', (l: string) => `${l.slice(0, 3)}\u200C${l.slice(3)}`],
      ['U+200D au milieu', (l: string) => `${l.slice(0, 3)}\u200D${l.slice(3)}`],
      ['U+2060 au milieu', (l: string) => `${l.slice(0, 3)}\u2060${l.slice(3)}`],
      ['U+FEFF au milieu', (l: string) => `${l.slice(0, 3)}\uFEFF${l.slice(3)}`],
      ['caractère de contrôle', (l: string) => `${l}\u0007`],
    ])('type dont le libellé contient %s : refusé', async (_cas, habiller) => {
      const t = putType({ libelle: habiller(libelleDe(putType())) });
      await refuseEnEntier([t], t, 'ecriture_invalide');
    });

    it('« grelinette␠ » en travail du sol : doublon de la liste de départ une fois rogné, refusé', async () => {
      const t = putType({ categorie: 'travail_sol', libelle: 'grelinette ' });
      await refuseEnEntier([t], t, 'ecriture_invalide');
    });

    it('renommer un type avec des espaces de bord : stocké rogné', async () => {
      const t = await typeAccepte();
      const nouveau = `${libelleDe(t)} n`;
      await accepte([patch('type_intervention', t.id, { libelle: `\u00A0${nouveau} ` })]);
      expect((await ligne('type_intervention', t.id))?.libelle).toBe(nouveau);
    });

    it.each([
      ['« grelinette␠ »', 'grelinette '],
      ['« ␠grelinette »', ' grelinette'],
      ['« grelinette » + espace insécable', 'grelinette\u00A0'],
    ])('travail prévu de type %s : accepté (liste de départ), stocké « grelinette »', async (_cas, type) => {
      const i = await itineraireAccepte({ parametres: avecTravaux([{ ...GRELINETTE, type }]) });
      const travaux = ((await ligne('itineraire', i.id))?.parametres as { travauxPrevus?: { type: string }[] } | undefined)?.travauxPrevus;
      expect(travaux?.[0]?.type).toBe('grelinette');
    });

    it('travail prévu de type « grélinette » en NFD, type de la ferme en NFC : accepté, stocké en NFC', async () => {
      const nfc = `grélinette ${String(tic % 100_000)}`;
      await typeAccepte({ categorie: 'travail_sol', libelle: nfc });
      const i = await itineraireAccepte({ parametres: avecTravaux([{ ...GRELINETTE, type: NFD(nfc) }]) });
      const travaux = ((await ligne('itineraire', i.id))?.parametres as { travauxPrevus?: { type: string }[] } | undefined)?.travauxPrevus;
      expect(travaux?.[0]?.type).toBe(nfc);
    });

    it('travail prévu de type « grelinette » + espace de largeur nulle : refusé', async () => {
      const i = putItineraire({ parametres: avecTravaux([{ ...GRELINETTE, type: 'grelinette\u200B' }]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('série dont l’instantané porte « grelinette␠ » : acceptée, instantané stocké rogné', async () => {
      const i = await itineraireAccepte();
      const s = putSerie(i.id, avecTravaux([{ ...GRELINETTE, type: 'grelinette ' }]));
      await accepte([s]);
      const travaux = ((await ligne('serie', s.id))?.parametres as { travauxPrevus?: { type: string }[] } | undefined)?.travauxPrevus;
      expect(travaux?.[0]?.type).toBe('grelinette');
    });
  });

  describe('décision 11 : unicité insensible à la casse, référence exacte', () => {
    it('« Grelinette » en travail du sol : doublon de « grelinette » de la liste de départ, refusé', async () => {
      const t = putType({ categorie: 'travail_sol', libelle: 'Grelinette' });
      await refuseEnEntier([t], t, 'ecriture_invalide');
    });

    it('doublon d’un type de la ferme qui ne diffère que par la casse : refusé', async () => {
      const t = await typeAccepte();
      const doublon = putType({ libelle: libelleDe(t).toUpperCase() });
      await refuseEnEntier([doublon], doublon, 'ecriture_invalide');
    });

    it('doublon insensible à la casse ET aux accents composés (NFD en majuscules) : refusé', async () => {
      const nfc = `bêchage ${String(tic % 100_000)}`;
      await typeAccepte({ libelle: nfc });
      const doublon = putType({ libelle: nfc.toUpperCase().normalize('NFD') });
      await refuseEnEntier([doublon], doublon, 'ecriture_invalide');
    });

    it('renommer un type non utilisé en changeant seulement la casse : accepté (c’est le même type)', async () => {
      const t = await typeAccepte();
      const majuscule = `B${libelleDe(t).slice(1)}`;
      await accepte([patch('type_intervention', t.id, { libelle: majuscule })]);
      expect((await ligne('type_intervention', t.id))?.libelle).toBe(majuscule);
    });

    it('renommer un type en une autre casse d’un autre type actif : refusé', async () => {
      const autre = await typeAccepte();
      const t = await typeAccepte();
      const p = patch('type_intervention', t.id, { libelle: libelleDe(autre).toUpperCase() });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('rétablir un type supprimé alors qu’un type actif a pris son libellé dans une autre casse : refusé', async () => {
      const t = await typeAccepte();
      await accepte([supprimer('type_intervention', t.id)]);
      await typeAccepte({ libelle: libelleDe(t).toUpperCase() });
      const p = patch('type_intervention', t.id, { supprime_le: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });

    it('travail prévu « Grelinette » alors que le type s’écrit « grelinette » : refusé (référence exacte)', async () => {
      const i = putItineraire({ parametres: avecTravaux([{ ...GRELINETTE, type: 'Grelinette' }]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });

    it('travail prévu dans une autre casse qu’un type de la ferme : refusé', async () => {
      const t = await typeAccepte();
      const i = putItineraire({ parametres: avecTravaux([entretien(libelleDe(t).toUpperCase())]) });
      await refuseEnEntier([i], i, 'ecriture_invalide');
    });
  });

  // ── Historique ──────────────────────────────────────────────────────────────────────────────

  describe('l’historique est écrit par le serveur seul', () => {
    it('le téléphone ne peut pas écrire dans modification : table_interdite', async () => {
      const fausse: EcritureEnvoyee = {
        op: 'PUT',
        table: 'modification',
        id: nouvelId<'Modification'>(),
        donnees: { ferme_id: ferme, nom_table: 'Itineraire', ligne_id: randomUUID(), auteur_id: theo.id, operation: 'creation', avant: null, apres: '{}' },
      };
      const reponse = await lot([fausse]);
      expect(motifDe(reponse, fausse.id)).toBe('table_interdite');
    });

    it('type : création, modification, suppression ; itinéraire : création, modification, suppression — dans l’ordre, par l’auteur du jeton', async () => {
      const t = await typeAccepte();
      await accepte([patch('type_intervention', t.id, { libelle: `${libelleDe(t)} bis` })]);
      await accepte([supprimer('type_intervention', t.id)]);
      const i = await itineraireAccepte();
      await accepte([patch('itineraire', i.id, { nom: 'Batavia tardive' })]);
      await accepte([supprimer('itineraire', i.id)]);
      for (const [id, nomTable] of [
        [t.id, 'TypeIntervention'],
        [i.id, 'Itineraire'],
      ] as const) {
        const h = await historique(id);
        expect(h.map((x) => x.operation)).toEqual(['creation', 'modification', 'suppression']);
        for (const x of h) expect(x).toMatchObject({ nom_table: nomTable, ferme_id: ferme, ligne_id: id, auteur_id: theo.id, proposition_id: null });
        expect(h[1]?.avant).toEqual(h[0]?.apres);
        expect(h[2]?.avant).toEqual(h[1]?.apres);
        expect(h[2]?.apres).toEqual(await ligne(nomTable === 'Itineraire' ? 'itineraire' : 'type_intervention', id));
      }
    });
  });
});
