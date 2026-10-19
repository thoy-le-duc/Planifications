/**
 * Tests d'acceptation T52 — POST /sync/upload accepte les produits phyto de la ferme et rejoue les
 * règles d'un traitement (docs/backlog/T52-registre-phyto.md), contre un vrai Postgres (même
 * amorçage que itineraire.integration.test.ts : DATABASE_URL, base jetable `t52_phyto_…`
 * supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Table ouverte : `produit_phyto`, lignes DE LA FERME seulement. Colonnes reçues : celles de
 * Postgres au format PowerSync (utilisable_en_bio en 0/1, dose_maximale en texte JSON) ;
 * `cree_le`, `modifie_le` tolérées, remplies par le serveur ; `id` dans les données → refus.
 * Règles de ligne : `validerProduitPhyto` du cœur (packages/core/src/phyto/test/contrat.ts),
 * rejouée sur la ligne COMPLÈTE (pour un PATCH : ligne existante + colonnes reçues).
 *
 *   PUT     crée le produit. Ferme dont l'utilisateur n'est pas membre actif → 'ferme_interdite' ;
 *           ferme_id nul (la bibliothèque commune) → 'ecriture_invalide'. Renvoi identique :
 *           accepté, rien d'écrit. Même id, autres valeurs → 'ecriture_invalide'.
 *   PATCH   modifie un produit de la ferme (nom, AMM, DAR, bio, dose maximale) ; archiver =
 *           PATCH supprime_le (suppression douce), rétablir = supprime_le NULL. Produit
 *           introuvable, d'une autre ferme OU de la bibliothèque → 'ecriture_invalide', ferme
 *           nulle (T10d). ferme_id changé → 'ecriture_invalide'.
 *   DELETE  refusé ('table_interdite'), rien ne change.
 * Droits : tout membre actif de la ferme (gérant ou équipier), comme les itinéraires.
 * Historique : une ligne `modification` par écriture (nom_table 'ProduitPhyto' ; creation,
 * modification, suppression pour un archivage).
 *
 * Traitement (événement) : sans produit, avec une dose négative, une date impossible ou une date
 * de récolte autorisée avant le jour du traitement → 'ecriture_invalide', rien d'écrit. Produit
 * archivé → 'ecriture_invalide' (on ne traite plus avec). Modifier le produit ensuite ne change
 * pas un traitement passé : la vue `traitements` garde sa date de récolte autorisée.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerProduitPhytoBibliotheque, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2027-05-10T06:00:00Z');

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T52')('T52 : produits phyto de la ferme et traitements écrits par les téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;
  let emplacement: string;
  let produitBibliotheque: string;
  let produitVoisin: string;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  beforeAll(async () => {
    base = await creerBaseJetable('t52_phyto');
    cles = { active: await genererCleSignature('cle-t52'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };
    const zone = randomUUID();
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 2', 'tunnel')`, [zone, ferme]);
    emplacement = randomUUID();
    await base.pool.query(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du) VALUES ($1, $2, $3, 'T2-P01', 'planche', 30, 0.8, '2026-01-01')`,
      [emplacement, ferme, zone],
    );
    produitBibliotheque = await creerProduitPhytoBibliotheque(base.pool);
    produitVoisin = randomUUID();
    await base.pool.query(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio)
       VALUES ($1, $2, 'Produit du voisin', '1', 'x', 3, false)`,
      [produitVoisin, autreFerme],
    );
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function ligne(id: string): Promise<Record<string, unknown> | undefined> {
    const r = await base.pool.query<Record<string, unknown>>(`SELECT * FROM produit_phyto WHERE id = $1`, [id]);
    return r.rows[0];
  }

  async function historique(id: string): Promise<{ operation: string; nom_table: string; auteur_id: string }[]> {
    const r = await base.pool.query<{ operation: string; nom_table: string; auteur_id: string }>(
      `SELECT operation, nom_table, auteur_id::text AS auteur_id FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`,
      [id],
    );
    return r.rows;
  }

  async function refusFerme(id: string): Promise<string | null | undefined> {
    const r = await base.pool.query<{ ferme_id: string | null }>(`SELECT ferme_id::text AS ferme_id FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    return r.rows[0]?.ferme_id;
  }

  function produit(fermeId: string | null, autres: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ferme_id: fermeId,
      nom_commercial: 'Bouillie bordelaise RSR',
      numero_amm: '9300417',
      substance_active: 'cuivre (sulfate)',
      delai_avant_recolte_jours: 3,
      utilisable_en_bio: 1,
      dose_maximale: JSON.stringify({ valeur: 3, unite: 'L/ha' }),
      cree_le: '2027-05-10T05:00:00.000Z',
      modifie_le: '2027-05-10T05:00:00.000Z',
      supprime_le: null,
      ...autres,
    };
  }

  const put = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PUT', table: 'produit_phyto', id, donnees });
  const patch = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'produit_phyto', id, donnees });

  async function creerProduit(autres: Record<string, unknown> = {}): Promise<string> {
    const id = nouvelId<'ProduitPhyto'>();
    expect(await lot([put(id, produit(ferme, autres))])).toEqual({ refus: [] });
    return id;
  }

  function putTraitement(produitId: string, detail: Record<string, unknown> = {}, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'traitement',
        date: '2027-05-10',
        horodatage: '2027-05-10T05:58:00.000Z',
        auteur_id: gerant.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: JSON.stringify([emplacement]),
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({
          produitPhytoId: produitId,
          dose: { valeur: 2, unite: 'L/ha' },
          surfaceTraiteeM2: 24,
          cible: 'mildiou',
          operateur: '',
          recolteAutoriseeLe: '2027-05-13',
          ...detail,
        }),
        ...autres,
      },
    };
  }

  const evenementEcrit = async (id: string) => (await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [id])).rowCount;

  // ── Produits de la ferme ──────────────────────────────────────────────────────────────────

  it('PUT : le produit est créé dans la ferme, avec son historique ; renvoi identique accepté sans rien écrire', async () => {
    const id = nouvelId<'ProduitPhyto'>();
    const e = put(id, produit(ferme));
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await ligne(id)).toMatchObject({
      ferme_id: ferme,
      nom_commercial: 'Bouillie bordelaise RSR',
      numero_amm: '9300417',
      delai_avant_recolte_jours: 3,
      utilisable_en_bio: true,
      dose_maximale: { valeur: 3, unite: 'L/ha' },
      supprime_le: null,
    });
    expect(await historique(id)).toEqual([{ operation: 'creation', nom_table: 'ProduitPhyto', auteur_id: gerant.id }]);
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await historique(id)).toHaveLength(1);
  });

  it('PUT d’un équipier : accepté (tout membre actif)', async () => {
    const id = nouvelId<'ProduitPhyto'>();
    expect(await lot([put(id, produit(ferme, { nom_commercial: 'Purin d’ortie', numero_amm: '', dose_maximale: null }))], equipier.jeton)).toEqual({ refus: [] });
    expect(await ligne(id)).toMatchObject({ numero_amm: '', dose_maximale: null });
  });

  it.each([
    ['DAR négatif', { delai_avant_recolte_jours: -1 }],
    ['nom vide', { nom_commercial: '  ' }],
    ['dose maximale nulle', { dose_maximale: JSON.stringify({ valeur: 0, unite: 'L/ha' }) }],
    ['bio illisible', { utilisable_en_bio: 'oui' }],
    ['dans la bibliothèque (ferme nulle)', { ferme_id: null }],
  ])('PUT refusé (%s) : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
    const id = nouvelId<'ProduitPhyto'>();
    expect((await lot([put(id, produit(ferme, autres))])).refus).toEqual([{ table: 'produit_phyto', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toBeUndefined();
  });

  it('PUT dans une ferme dont on n’est pas membre : ferme_interdite ; même id, autres valeurs : refusé', async () => {
    const id = nouvelId<'ProduitPhyto'>();
    expect((await lot([put(id, produit(autreFerme))])).refus).toEqual([{ table: 'produit_phyto', id, motif: 'ferme_interdite' }]);
    expect(await ligne(id)).toBeUndefined();
    const existant = await creerProduit();
    expect((await lot([put(existant, produit(ferme, { nom_commercial: 'Autre nom' }))])).refus).toEqual([{ table: 'produit_phyto', id: existant, motif: 'ecriture_invalide' }]);
    expect(await ligne(existant)).toMatchObject({ nom_commercial: 'Bouillie bordelaise RSR' });
  });

  it('PATCH : modifier le DAR et la dose maximale ; archiver puis rétablir ; historique', async () => {
    const id = await creerProduit();
    expect(await lot([patch(id, { delai_avant_recolte_jours: 21, dose_maximale: null, modifie_le: '2027-05-10T06:00:00.000Z' })])).toEqual({ refus: [] });
    expect(await ligne(id)).toMatchObject({ delai_avant_recolte_jours: 21, dose_maximale: null });
    expect(await lot([patch(id, { supprime_le: '2027-05-10T06:10:00.000Z' })])).toEqual({ refus: [] });
    expect((await ligne(id))?.supprime_le).not.toBeNull();
    expect(await lot([patch(id, { supprime_le: null })])).toEqual({ refus: [] });
    expect((await historique(id)).map((h) => h.operation)).toEqual(['creation', 'modification', 'suppression', 'modification']);
    // PATCH qui ne change rien : accepté, rien d'écrit.
    expect(await lot([patch(id, { delai_avant_recolte_jours: 21 })])).toEqual({ refus: [] });
    expect(await historique(id)).toHaveLength(4);
  });

  it('PATCH refusé : règle du cœur, produit de la bibliothèque ou d’une autre ferme (comme introuvable), changement de ferme', async () => {
    const id = await creerProduit();
    expect((await lot([patch(id, { delai_avant_recolte_jours: 400 })])).refus).toEqual([{ table: 'produit_phyto', id, motif: 'ecriture_invalide' }]);
    expect((await lot([patch(id, { ferme_id: autreFerme })])).refus).toEqual([{ table: 'produit_phyto', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toMatchObject({ delai_avant_recolte_jours: 3, ferme_id: ferme });
    for (const cible of [produitBibliotheque, produitVoisin, nouvelId<'ProduitPhyto'>()]) {
      expect((await lot([patch(cible, { nom_commercial: 'Pris' })])).refus).toEqual([{ table: 'produit_phyto', id: cible, motif: 'ecriture_invalide' }]);
      expect(await refusFerme(cible)).toBeNull();
    }
    expect(await ligne(produitBibliotheque)).toMatchObject({ nom_commercial: 'Soufre mouillable' });
    expect(await ligne(produitVoisin)).toMatchObject({ nom_commercial: 'Produit du voisin' });
  });

  it('DELETE : table_interdite, rien ne change', async () => {
    const id = await creerProduit();
    expect((await lot([{ op: 'DELETE', table: 'produit_phyto', id }])).refus).toEqual([{ table: 'produit_phyto', id, motif: 'table_interdite' }]);
    expect(await ligne(id)).toBeDefined();
  });

  it('le voisin ne voit ni ne touche les produits de la ferme', async () => {
    const id = await creerProduit();
    expect((await lot([patch(id, { supprime_le: '2027-05-10T07:00:00.000Z' })], voisin.jeton)).refus).toEqual([{ table: 'produit_phyto', id, motif: 'ecriture_invalide' }]);
    expect((await ligne(id))?.supprime_le).toBeNull();
  });

  // ── Traitements ───────────────────────────────────────────────────────────────────────────

  it('traitement valide avec un produit de la ferme ou de la bibliothèque : accepté, visible dans la vue traitements', async () => {
    const id = await creerProduit();
    const t1 = putTraitement(id);
    const t2 = putTraitement(produitBibliotheque, { recolteAutoriseeLe: '2027-05-10' });
    expect(await lot([t1, t2])).toEqual({ refus: [] });
    const r = await base.pool.query<{ recolte_autorisee_le: string; nom_commercial: string }>(
      `SELECT recolte_autorisee_le::text AS recolte_autorisee_le, nom_commercial FROM traitements WHERE id = $1`,
      [t1.id],
    );
    expect(r.rows[0]).toEqual({ recolte_autorisee_le: '2027-05-13', nom_commercial: 'Bouillie bordelaise RSR' });
  });

  it.each([
    ['sans produit', { produitPhytoId: undefined }],
    ['dose négative', { dose: { valeur: -2, unite: 'L/ha' } }],
    ['date de récolte autorisée impossible', { recolteAutoriseeLe: '2027-02-30' }],
    ['récolte autorisée avant le traitement', { recolteAutoriseeLe: '2027-05-09' }],
    ['produit d’une autre ferme', { produitPhytoId: 'voisin' }],
  ])('traitement refusé (%s) : ecriture_invalide, rien d’écrit', async (_cas, detail) => {
    const d = { ...detail } as Record<string, unknown>;
    if (d.produitPhytoId === 'voisin') d.produitPhytoId = produitVoisin;
    // JSON.stringify retire une clé à undefined : « sans produit » n'a pas de produitPhytoId.
    const e = putTraitement(await creerProduit(), d);
    expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
    expect(await evenementEcrit(e.id)).toBe(0);
  });

  it('traitement à une date impossible : refusé', async () => {
    const e = putTraitement(await creerProduit(), {}, { date: '2027-13-01' });
    expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
    expect(await evenementEcrit(e.id)).toBe(0);
  });

  it('produit archivé : un nouveau traitement est refusé ; un traitement passé garde sa date quand le produit change', async () => {
    const id = await creerProduit();
    const avant = putTraitement(id);
    expect(await lot([avant])).toEqual({ refus: [] });
    expect(await lot([patch(id, { delai_avant_recolte_jours: 30 })])).toEqual({ refus: [] });
    const r = await base.pool.query<{ d: string }>(`SELECT recolte_autorisee_le::text AS d FROM traitements WHERE id = $1`, [avant.id]);
    expect(r.rows[0]?.d).toBe('2027-05-13');
    expect(await lot([patch(id, { supprime_le: '2027-05-10T08:00:00.000Z' })])).toEqual({ refus: [] });
    const apres = putTraitement(id);
    expect((await lot([apres])).refus).toEqual([{ table: 'evenement', id: apres.id, motif: 'ecriture_invalide' }]);
    expect(await evenementEcrit(apres.id)).toBe(0);
  });
});
