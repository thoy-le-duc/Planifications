/**
 * Tests d'acceptation T10j — refus de synchro : messages sans jargon, détail au journal
 * (docs/backlog/T10j-refus-suites.md), contre un vrai Postgres.
 *
 * Exécution : comme T10 (DATABASE_URL ; base jetable `t10j_messages_…` supprimée à la fin ; sans
 * DATABASE_URL, échec en CI et saut signalé en local).
 *
 * Les refus sont PRODUITS pour de vrai : chaque scénario envoie un lot à POST /sync/upload, puis
 * lit les lignes de refus_synchro écrites (le `message` est ce que le téléphone affiche tel quel,
 * apps/web/src/ecrans/ferme/Refus.tsx). Les textes que nul scénario n'atteint (chaîne de 1 000
 * corrections…) sont couverts par le filet statique : messages-refus.test.ts.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   1. Aucun message de refus_synchro ne contient de jargon (test/jargon.ts) : nom de table ou de
 *      colonne du schéma (ferme_id, supprime_le, serie, evenement, id…), code de motif, « colonne »,
 *      « table », « contrainte », « règle de la base », « SQL », « uuid », « écritures », « ligne »,
 *      « clé », « JSON », « ISO 8601 », « 500 », « Mio », « octets »… Cela vaut pour TOUS les motifs
 *      et toutes les précisions, celles du serveur comme celles du cœur (@planif/core) que le
 *      serveur relaie (colonne inconnue, horodatage, détail illisible, clé inconnue du détail…).
 *   2. Forme stable : chaque message est non vide, commence par une majuscule et finit par un
 *      point ; deux motifs différents n'ont jamais le même message ; chaque motif est produit
 *      par au moins un scénario.
 *   3. Journal du serveur (proposition du testeur au chef, sur le modèle de demarrage.ts) :
 *        DependancesApp.journal?: (ligne: string) => void   — par défaut console.error.
 *      Quand un refus porte un détail technique (erreur de la base, colonne inconnue…), le
 *      serveur écrit dans le journal, au plus tard quand la réponse est rendue, au moins une
 *      ligne qui contient : le code du motif, la table de l'écriture, l'id de l'écriture, et le
 *      détail technique (pour une erreur de la base : son code SQLSTATE, ex. 22021 ; pour une
 *      colonne inconnue : le nom de la colonne). Le journal ne reçoit jamais de donnée
 *      personnelle : ni l'adresse e-mail de l'utilisateur, ni le contenu d'une note.
 *      Les comportements de T10 (motif, 200, rien d'écrit, une ligne par refus) ne changent pas.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp, type DependancesApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import type { MotifRefus } from './motifs.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, peuplerFerme, type BaseJetable, type LignesDeFerme } from './test/base-jetable.ts';
import { defautsDeForme, jargon, MOTIFS } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');

interface EcritureEnvoyee {
  readonly op: string;
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

interface LigneRefus {
  readonly nom_table: string;
  readonly ligne_id: string;
  readonly motif: string;
  readonly message: string;
}

/** Un lot à envoyer, et l'écriture dont on attend le refus (avec son motif). */
interface Envoi {
  readonly ecritures: readonly EcritureEnvoyee[];
  readonly fautive: EcritureEnvoyee;
}

interface Scenario {
  readonly nom: string;
  readonly motif: MotifRefus;
  readonly envoi: () => Promise<Envoi> | Envoi;
}

/** Contenu d'une note : une donnée personnelle qui ne doit jamais aller au journal. */
const NOTE_PERSONNELLE = 'Livraison chez Mme Josette Berthier, 06 12 34 56 78';

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

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

decrireAvecBase('T10j')('T10j : messages des refus de synchro', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Lignes reçues par le journal du serveur (contrat 3). */
  const journal: string[] = [];
  /** Tout ce que le journal a reçu depuis le début (jamais vidé). */
  const journalComplet: string[] = [];
  let theo: { id: string; email: string; jeton: string };
  let voisin: { id: string };
  let ferme: string;
  let autreFerme: string;
  /** Lignes de la ferme voisine (une série qu'un téléphone de la ferme ne doit pas viser). */
  let voisines: LignesDeFerme;
  let tomate: string;
  let laitue: string;
  let batavia: string;
  let itineraire: string;
  let saison: string;
  let planche: string;
  let plancheSupprimee: string;

  /** Tous les refus enregistrés par les scénarios (contrat 2 : vérifiés ensemble à la fin). */
  const vus: LigneRefus[] = [];

  async function inserer(sql: string, valeurs: readonly unknown[]): Promise<void> {
    await base.pool.query(sql, [...valeurs]);
  }

  async function especeEn(fermeId: string, nom: string, unite: string): Promise<string> {
    const famille = randomUUID();
    await inserer(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`,
      [famille, fermeId],
    );
    const id = randomUUID();
    await inserer(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, $4, 'legume', false, $5)`,
      [id, fermeId, famille, nom, unite],
    );
    return id;
  }

  async function plancheEn(code: string, supprimee: boolean): Promise<string> {
    const zone = randomUUID();
    const id = randomUUID();
    await inserer(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 3', 'tunnel')`, [zone, ferme]);
    await inserer(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, supprime_le)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5)`,
      [id, ferme, zone, code, supprimee ? MAINTENANT : null],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t10j_messages');
    cles = { active: await genererCleSignature('cle-t10j'), precedentes: [] };
    // Contrat 3 : le journal est injecté comme les autres dépendances.
    const dependances: DependancesApp & { readonly journal: (ligne: string) => void } = {
      db: drizzle(base.pool),
      expediteur: expediteurMuet,
      cles,
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant: () => MAINTENANT,
      envoisMaxParMinute: 1_000_000,
      journal: (ligne) => {
        journal.push(ligne);
        journalComplet.push(ligne);
      },
    };
    app = creerApp(dependances);
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool, 'theophane.t10j@ferme.fr');
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    theo = { ...u, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
    voisin = { id: v.id };
    voisines = await peuplerFerme(base.pool, autreFerme);
    tomate = await especeEn(ferme, 'Tomate', 'kg');
    laitue = await especeEn(ferme, 'Laitue', 'piece');
    batavia = randomUUID();
    await inserer(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Batavia blonde')`, [batavia, ferme, laitue]);
    itineraire = randomUUID();
    await inserer(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4)`,
      [itineraire, ferme, laitue, JSON.stringify(BATAVIA)],
    );
    saison = randomUUID();
    await inserer(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, ferme]);
    planche = await plancheEn('T3-P01', false);
    plancheSupprimee = await plancheEn('T3-P09', true);
    await inserer(`INSERT INTO type_intervention (id, ferme_id, categorie, libelle) VALUES ($1, $2, 'entretien', 'binage T10j')`, [randomUUID(), ferme]);
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
    expect(await lot(ecritures), 'lot de préparation accepté').toEqual({ refus: [] });
  }

  /** Envoie le lot ; rend les refus qu'il a enregistrés (refus_synchro vidée avant). */
  async function refusDe(envoi: Envoi): Promise<{ reponse: ReponseUpload; enregistres: LigneRefus[] }> {
    await base.pool.query('DELETE FROM refus_synchro');
    const reponse = await lot(envoi.ecritures);
    const r = await base.pool.query<LigneRefus>('SELECT nom_table, ligne_id, motif, message FROM refus_synchro ORDER BY cree_le, id');
    return { reponse, enregistres: r.rows };
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  function putRecolte(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'recolte',
        date: '2026-10-01',
        horodatage: '2026-10-01T05:58:00.000Z',
        auteur_id: theo.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: NOTE_PERSONNELLE,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ quantite: 12, unite: 'kg', categorie: null }),
        ...autres,
      },
    };
  }

  function putRemplacement(origine: EcritureEnvoyee, sorte: 'annulation' | 'correction', autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return putRecolte({ ...origine.donnees, horodatage: '2026-10-01T05:59:00.000Z', remplace_sorte: sorte, remplace_evenement_id: origine.id, ...autres });
  }

  function putArticle(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'article_stock',
      id: nouvelId<'ArticleStock'>(),
      donnees: { ferme_id: ferme, espece_id: tomate, variete_id: null, unite: 'kg', categorie: null, ...autres },
    };
  }

  function putMouvement(articleId: string, recolteId: string | null, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'mouvement_stock',
      id: nouvelId<'MouvementStock'>(),
      donnees: { ferme_id: ferme, article_stock_id: articleId, date: '2026-10-01', quantite: 12, motif: 'recolte', recolte_id: recolteId, ...autres },
    };
  }

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
        ancre_type: 'debut_recolte',
        ancre_date: '2027-05-31',
        prevu_semis_pepiniere: '2027-03-15',
        prevu_mise_en_place: '2027-04-12',
        prevu_debut_recolte: '2027-05-31',
        prevu_fin_recolte: '2027-06-14',
        longueur_m: 30,
        nombre_plants: null,
        statut: 'prevue',
        rotation_acceptee: null,
        ...autres,
      },
    };
  }

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
        prevu_du: '2027-04-12',
        prevu_au: '2027-06-14',
        reel_du: null,
        reel_au: null,
        ...autres,
      },
    };
  }

  function putItineraire(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'itineraire',
      id: nouvelId<'Itineraire'>(),
      donnees: { ferme_id: ferme, espece_id: laitue, variete_id: batavia, nom: 'Batavia d’été', mode: 'plant_maison', parametres: JSON.stringify(BATAVIA), ...autres },
    };
  }

  function putType(autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'type_intervention',
      id: nouvelId(),
      donnees: { ferme_id: ferme, categorie: 'entretien', libelle: `sarclage ${String(tic % 100_000)}`, masque: 0, ...autres },
    };
  }

  const seule = (e: EcritureEnvoyee): Envoi => ({ ecritures: [e], fautive: e });

  // ── Scénarios : un par chemin de refus atteignable ──────────────────────────────────────────

  const scenarios: readonly Scenario[] = [
    // Motifs sans précision.
    { nom: 'table que le téléphone n’écrit pas', motif: 'table_interdite', envoi: () => seule({ op: 'PUT', table: 'utilisateur', id: randomUUID(), donnees: { email: 'x@y.fr' } }) },
    {
      nom: 'modification d’un article de stock',
      motif: 'table_interdite',
      envoi: async () => {
        const article = putArticle();
        await accepte([putRecolte(), article]);
        return seule({ op: 'PATCH', table: 'article_stock', id: article.id, donnees: { unite: 'piece' } });
      },
    },
    { nom: 'ferme dont on n’est pas membre', motif: 'ferme_interdite', envoi: () => seule(putRecolte({ ferme_id: autreFerme })) },
    { nom: 'saisie au nom d’un autre', motif: 'auteur_invalide', envoi: () => seule(putRecolte({ auteur_id: voisin.id })) },
    {
      nom: 'modification d’un événement',
      motif: 'ajout_seul',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        return seule({ op: 'PATCH', table: 'evenement', id: r.id, donnees: { note: 'autre' } });
      },
    },
    {
      nom: 'suppression d’un événement',
      motif: 'ajout_seul',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        return seule({ op: 'DELETE', table: 'evenement', id: r.id });
      },
    },
    {
      nom: 'même événement renvoyé avec d’autres valeurs',
      motif: 'ajout_seul',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        return seule({ ...r, donnees: { ...r.donnees, detail: JSON.stringify({ quantite: 13, unite: 'kg', categorie: null }) } });
      },
    },
    {
      nom: 'correction d’une récolte annulée',
      motif: 'recolte_annulee',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        await accepte([putRemplacement(r, 'annulation')]);
        return seule(putRemplacement(r, 'correction', { horodatage: '2026-10-01T05:59:30.000Z', detail: JSON.stringify({ quantite: 10, unite: 'kg', categorie: null }) }));
      },
    },
    // Écriture mal formée, précisions du serveur.
    { nom: 'opération inconnue', motif: 'ecriture_invalide', envoi: () => seule({ op: 'MERGE', table: 'evenement', id: nouvelId(), donnees: {} }) },
    { nom: 'id glissé dans les données d’un événement', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ id: randomUUID() })) },
    { nom: 'série introuvable', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ serie_id: randomUUID() })) },
    { nom: 'emplacement supprimé', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ emplacement_ids: JSON.stringify([plancheSupprimee]) })) },
    { nom: 'série d’une autre ferme (même refus qu’une série introuvable)', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ serie_id: voisines.serie })) },
    { nom: 'campagne introuvable', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ campagne_id: randomUUID() })) },
    {
      nom: 'correction qui change l’unité de la récolte',
      motif: 'ecriture_invalide',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        return seule(putRemplacement(r, 'correction', { detail: JSON.stringify({ quantite: 12, unite: 'piece', categorie: null }) }));
      },
    },
    {
      nom: 'correction plus ancienne que celle en vigueur',
      motif: 'ecriture_invalide',
      envoi: async () => {
        const r = putRecolte();
        await accepte([r]);
        await accepte([putRemplacement(r, 'correction', { horodatage: '2026-10-01T05:59:50.000Z', detail: JSON.stringify({ quantite: 14, unite: 'kg', categorie: null }) })]);
        return seule(putRemplacement(r, 'correction', { horodatage: '2026-10-01T05:59:10.000Z', detail: JSON.stringify({ quantite: 15, unite: 'kg', categorie: null }) }));
      },
    },
    { nom: 'caractère nul dans la note (refusé par la base)', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ note: `${NOTE_PERSONNELLE}\u0000` })) },
    // Précisions du cœur relayées par le serveur (événement).
    { nom: 'colonne inconnue', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ prix_au_kilo: 4 })) },
    { nom: 'type d’événement manquant', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ type: null })) },
    { nom: 'série : identifiant invalide', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ serie_id: 'pas-un-id' })) },
    { nom: 'horodatage invalide', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ horodatage: 'hier matin' })) },
    { nom: 'date hors bornes', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ date: '1999-12-31' })) },
    { nom: 'détail illisible', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ detail: '{"quantite":' })) },
    { nom: 'détail : clé inconnue', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ detail: JSON.stringify({ quantite: 12, unite: 'kg', categorie: null, couleur: 'rouge' }) })) },
    { nom: 'détail trop volumineux', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ detail: JSON.stringify({ quantite: 12, unite: 'kg', categorie: 'x'.repeat(9_000) }) })) },
    { nom: 'détail trop imbriqué', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ detail: `{"quantite":12,"unite":"kg","categorie":${'['.repeat(50_000)}${']'.repeat(50_000)}}` })) },
    { nom: 'note trop longue', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ note: 'n'.repeat(4_001) })) },
    { nom: 'remplacement incomplet', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ remplace_sorte: 'correction' })) },
    { nom: 'quantité négative', motif: 'ecriture_invalide', envoi: () => seule(putRecolte({ detail: JSON.stringify({ quantite: -3, unite: 'kg', categorie: null }) })) },
    // Stock : saisie tout ou rien.
    {
      nom: 'mouvement sur un article introuvable (les autres écritures de la saisie aussi refusées)',
      motif: 'ecriture_invalide',
      envoi: () => {
        const r = putRecolte();
        const m = putMouvement(randomUUID(), r.id);
        return { ecritures: [r, m], fautive: m };
      },
    },
    { nom: 'article : id glissé dans les données', motif: 'ecriture_invalide', envoi: () => seule(putArticle({ id: randomUUID() })) },
    { nom: 'article : colonne inconnue', motif: 'ecriture_invalide', envoi: () => seule(putArticle({ prix: 4 })) },
    { nom: 'article : espèce introuvable', motif: 'ecriture_invalide', envoi: () => seule(putArticle({ espece_id: randomUUID() })) },
    {
      nom: 'mouvement : récolte liée introuvable',
      motif: 'ecriture_invalide',
      envoi: () => {
        const a = putArticle();
        const m = putMouvement(a.id, randomUUID());
        return { ecritures: [a, m], fautive: m };
      },
    },
    {
      nom: 'mouvement : article d’une autre unité que la récolte',
      motif: 'ecriture_invalide',
      envoi: () => {
        const r = putRecolte();
        const a = putArticle({ unite: 'piece' });
        const m = putMouvement(a.id, r.id);
        return { ecritures: [r, a, m], fautive: m };
      },
    },
    {
      nom: 'mouvement : quantité illisible',
      motif: 'ecriture_invalide',
      envoi: () => {
        const r = putRecolte();
        const a = putArticle();
        const m = putMouvement(a.id, r.id, { quantite: 'douze' });
        return { ecritures: [r, a, m], fautive: m };
      },
    },
    // Séries et occupations.
    { nom: 'série : saison introuvable', motif: 'ecriture_invalide', envoi: () => seule(putSerie({ saison_id: randomUUID() })) },
    { nom: 'série : créée déjà supprimée', motif: 'ecriture_invalide', envoi: () => seule(putSerie({ supprime_le: '2026-10-01T06:30:00.000Z' })) },
    { nom: 'série : colonne inconnue', motif: 'ecriture_invalide', envoi: () => seule(putSerie({ prix: 3 })) },
    { nom: 'série : paramètres illisibles', motif: 'ecriture_invalide', envoi: () => seule(putSerie({ parametres: '{' })) },
    { nom: 'série : id glissé dans les données', motif: 'ecriture_invalide', envoi: () => seule(putSerie({ id: randomUUID() })) },
    { nom: 'série : modification d’une série introuvable', motif: 'ecriture_invalide', envoi: () => seule({ op: 'PATCH', table: 'serie', id: randomUUID(), donnees: { longueur_m: 20 } }) },
    {
      nom: 'série renvoyée avec d’autres valeurs',
      motif: 'ecriture_invalide',
      envoi: async () => {
        const s = putSerie();
        await accepte([s, putOccupation(s, planche)]);
        return seule({ ...s, donnees: { ...s.donnees, longueur_m: 20 } });
      },
    },
    {
      nom: 'occupation : emplacement supprimé',
      motif: 'ecriture_invalide',
      envoi: () => {
        const s = putSerie();
        const o = putOccupation(s, plancheSupprimee);
        return { ecritures: [s, o], fautive: o };
      },
    },
    {
      nom: 'occupation : dates hors de celles de sa série',
      motif: 'ecriture_invalide',
      envoi: () => {
        const s = putSerie();
        const o = putOccupation(s, planche, { prevu_du: '2026-01-01', prevu_au: '2026-02-01' });
        return { ecritures: [s, o], fautive: o };
      },
    },
    // Itinéraires et types d'intervention.
    { nom: 'itinéraire : espèce introuvable', motif: 'ecriture_invalide', envoi: () => seule(putItineraire({ espece_id: randomUUID(), variete_id: null })) },
    { nom: 'itinéraire : colonne inconnue', motif: 'ecriture_invalide', envoi: () => seule(putItineraire({ couleur: 'vert' })) },
    { nom: 'itinéraire : mode inconnu', motif: 'ecriture_invalide', envoi: () => seule(putItineraire({ mode: 'hydroponie' })) },
    {
      nom: 'itinéraire : travail prévu d’un type inconnu',
      motif: 'ecriture_invalide',
      envoi: () =>
        seule(
          putItineraire({
            parametres: JSON.stringify({
              ...BATAVIA,
              travauxPrevus: [{ categorie: 'entretien', type: 'danse de la pluie', repere: 'mise_en_place', decalageJours: 0 }],
            }),
          }),
        ),
    },
    { nom: 'type d’intervention déjà existant', motif: 'ecriture_invalide', envoi: () => seule(putType({ libelle: 'Binage T10j' })) },
    { nom: 'type d’intervention : id glissé', motif: 'ecriture_invalide', envoi: () => seule(putType({ id: randomUUID() })) },
    { nom: 'modification d’une ligne introuvable', motif: 'ecriture_invalide', envoi: () => seule({ op: 'PATCH', table: 'itineraire', id: randomUUID(), donnees: { nom: 'x' } }) },
    // Lot trop gros (T10d) : un refus par écriture plausible, une ligne récapitulative pour le reste.
    {
      nom: 'lot trop gros, avec des écritures illisibles',
      motif: 'lot_trop_gros',
      envoi: () => {
        const recoltes = Array.from({ length: 501 }, () => putRecolte({ note: null }));
        const illisibles: EcritureEnvoyee[] = [{ op: 'PUT', table: 'inconnue', id: 'x', donnees: {} }];
        const premiere = recoltes[0];
        if (premiere === undefined) throw new Error('lot vide');
        return { ecritures: [...recoltes, ...illisibles], fautive: premiere };
      },
    },
  ];

  describe('1. aucun message de refus ne contient de jargon', () => {
    for (const s of scenarios) {
      it(`${s.nom} : ${s.motif}, message sans jargon`, async () => {
        const envoi = await s.envoi();
        const { reponse, enregistres } = await refusDe(envoi);
        const refusFautive = reponse.refus.filter((r) => r.id === envoi.fautive.id);
        expect(refusFautive.map((r) => r.motif), `motif de l’écriture fautive (${JSON.stringify(reponse.refus.slice(0, 3))})`).toEqual([s.motif]);
        expect(enregistres.length, 'refus enregistrés').toBeGreaterThan(0);
        vus.push(...enregistres);
        const fautifs = [...new Set(enregistres.map((r) => r.message))]
          .map((message) => ({ message, jargon: jargon(message) }))
          .filter((m) => m.jargon.length > 0)
          .map((m) => `« ${m.message} » : ${m.jargon.join(', ')}`);
        expect(fautifs).toEqual([]);
      });
    }
  });

  describe('2. forme stable de chaque message', () => {
    it('chaque motif est produit par au moins un scénario', () => {
      expect([...new Set(vus.map((r) => r.motif))].sort()).toEqual([...MOTIFS].sort());
    });

    it('chaque message est non vide, commence par une majuscule et finit par un point', () => {
      const fautifs = [...new Set(vus.map((r) => r.message))]
        .map((message) => ({ message, defauts: defautsDeForme(message) }))
        .filter((m) => m.defauts.length > 0)
        .map((m) => `« ${m.message} » : ${m.defauts.join(', ')}`);
      expect(vus.length).toBeGreaterThan(0);
      expect(fautifs).toEqual([]);
    });

    it('deux motifs différents n’ont jamais le même message', () => {
      const motifsDe = new Map<string, Set<string>>();
      for (const r of vus) motifsDe.set(r.message, (motifsDe.get(r.message) ?? new Set()).add(r.motif));
      const partages = [...motifsDe].filter(([, motifs]) => motifs.size > 1).map(([message, motifs]) => `« ${message} » : ${[...motifs].join(', ')}`);
      expect(vus.length).toBeGreaterThan(0);
      expect(partages).toEqual([]);
    });
  });

  describe('3. le détail technique reste au journal du serveur, sans donnée personnelle', () => {
    async function journalDe(e: EcritureEnvoyee, motif: MotifRefus): Promise<string[]> {
      journal.length = 0;
      const { reponse } = await refusDe(seule(e));
      expect(reponse.refus.map((r) => r.motif)).toEqual([motif]);
      return journal.filter((l) => l.includes(e.id));
    }

    it('erreur de la base (caractère nul dans une note) : motif, table, id et code SQLSTATE au journal ; ni la note, ni l’e-mail', async () => {
      const e = putRecolte({ note: `${NOTE_PERSONNELLE}\u0000` });
      const lignesDuRefus = await journalDe(e, 'ecriture_invalide');
      expect(lignesDuRefus.length, `une ligne du journal pour ${e.id} (journal : ${JSON.stringify(journal)})`).toBeGreaterThan(0);
      const texte = lignesDuRefus.join('\n');
      expect(texte).toContain('ecriture_invalide');
      expect(texte).toContain('evenement');
      expect(texte, 'code SQLSTATE de Postgres (caractère nul refusé)').toContain('22021');
      for (const l of journal) {
        expect(l, 'pas le contenu de la note').not.toContain('Berthier');
        expect(l, 'pas l’adresse e-mail').not.toContain(theo.email);
      }
    });

    it('colonne inconnue : le nom de la colonne au journal, pas dans le message du téléphone', async () => {
      const e = putRecolte({ prix_au_kilo: 4 });
      const lignesDuRefus = await journalDe(e, 'ecriture_invalide');
      const texte = lignesDuRefus.join('\n');
      expect(texte, `journal : ${JSON.stringify(journal)}`).toContain('prix_au_kilo');
      expect(texte).toContain('ecriture_invalide');
      expect(texte).toContain('evenement');
      const r = await base.pool.query<{ message: string }>('SELECT message FROM refus_synchro WHERE ligne_id = $1', [e.id]);
      expect(r.rows.map((l) => l.message.includes('prix_au_kilo'))).toEqual([false]);
      for (const l of journal) {
        expect(l, 'pas le contenu de la note').not.toContain('Berthier');
        expect(l, 'pas l’adresse e-mail').not.toContain(theo.email);
      }
    });

    it('le journal ne reçoit jamais de donnée personnelle, quel que soit le refus', () => {
      // Les scénarios ci-dessus portent presque tous une note personnelle.
      expect(vus.length).toBeGreaterThan(0);
      for (const l of journalComplet) {
        expect(l).not.toContain('Berthier');
        expect(l).not.toContain(theo.email);
      }
    });
  });
});
