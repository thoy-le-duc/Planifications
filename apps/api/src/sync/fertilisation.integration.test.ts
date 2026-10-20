/**
 * Tests d'acceptation T54 — POST /sync/upload accepte les produits fertilisants de la ferme,
 * l'option « zone vulnérable nitrates » et les apports qui désignent un produit
 * (docs/backlog/T54-cahier-fertilisation.md, règles 1, 2 et 6), contre un vrai Postgres (même
 * amorçage que phyto.integration.test.ts : DATABASE_URL, base jetable `t54_fertilisation_…`).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Table ouverte : `produit_fertilisant`, lignes DE LA FERME (il n'y a pas de bibliothèque commune :
 * la liste de départ est copiée dans la ferme par le téléphone). Colonnes au format PowerSync
 * (organique et utilisable_en_bio en 0/1) ; règles de ligne : `validerProduitFertilisant` du cœur,
 * rejouée sur la ligne COMPLÈTE. Même modèle que produit_phyto (T52) :
 *
 *   PUT     crée le produit. Ferme dont l'utilisateur n'est pas membre actif → 'ferme_interdite' ;
 *           ferme_id nul → 'ecriture_invalide'. Renvoi identique : accepté. Même id, autres
 *           valeurs → 'ecriture_invalide'.
 *   PATCH   modifie (teneurs, nom…), archive (supprime_le) et rétablit. Produit introuvable ou
 *           d'une autre ferme → 'ecriture_invalide', ferme nulle (T10d).
 *   DELETE  'table_interdite'.
 * Droits : tout membre actif. Historique : une ligne `modification` par écriture
 * ('ProduitFertilisant' ; creation, modification, suppression).
 *
 * Apport (événement intervention fertilisation / amendement) : `detail.produitFertilisantId`
 * facultatif ; s'il est là, un produit de la ferme (archivé compris, comme un produit phyto), sinon
 * 'ecriture_invalide'. Sans lui (texte libre, saisies d'avant T54) : accepté comme avant.
 *
 * Option de la ferme (Q44) : PATCH `ferme` avec `zone_vulnerable_nitrates` (0/1) accepté de tout
 * membre actif (c'est un affichage : plan prévisionnel et alerte), historique 'Ferme'. Valeur
 * illisible → 'ecriture_invalide'. Une autre colonne que origine_plan et zone_vulnerable_nitrates
 * reste refusée ; une ferme dont on n'est pas membre : introuvable.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2027-03-10T06:00:00Z');

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

decrireAvecBase('T54')('T54 : produits fertilisants, zone vulnérable et apports écrits par les téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;
  let emplacement: string;
  let produitVoisin: string;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  beforeAll(async () => {
    base = await creerBaseJetable('t54_fertilisation');
    cles = { active: await genererCleSignature('cle-t54'), precedentes: [] };
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
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Plein champ', 'plein_champ')`, [zone, ferme]);
    emplacement = randomUUID();
    await base.pool.query(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du) VALUES ($1, $2, $3, 'P1', 'planche', 50, 2, '2026-01-01')`, [emplacement, ferme, zone]);
    produitVoisin = randomUUID();
    await base.pool.query(
      `INSERT INTO produit_fertilisant (id, ferme_id, nom, forme, unite, teneur_n, organique, utilisable_en_bio) VALUES ($1, $2, 'Fumier du voisin', 'solide', 't', 0.5, true, true)`,
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
    return (await base.pool.query<Record<string, unknown>>(`SELECT * FROM produit_fertilisant WHERE id = $1`, [id])).rows[0];
  }

  async function historique(id: string): Promise<{ operation: string; nom_table: string }[]> {
    const r = await base.pool.query<{ operation: string; nom_table: string }>(`SELECT operation, nom_table FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`, [id]);
    return r.rows;
  }

  function produit(fermeId: string | null, autres: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ferme_id: fermeId,
      nom: 'Compost de déchets verts',
      forme: 'solide',
      unite: 't',
      teneur_n: 1,
      teneur_p2o5: 0.4,
      teneur_k2o: null,
      organique: 1,
      utilisable_en_bio: 1,
      source: 'DRAAF Auvergne-Rhône-Alpes, 2025',
      cree_le: '2027-03-10T05:00:00.000Z',
      modifie_le: '2027-03-10T05:00:00.000Z',
      supprime_le: null,
      ...autres,
    };
  }

  const put = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PUT', table: 'produit_fertilisant', id, donnees });
  const patch = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'produit_fertilisant', id, donnees });

  async function creerProduit(autres: Record<string, unknown> = {}): Promise<string> {
    const id = nouvelId();
    expect(await lot([put(id, produit(ferme, autres))])).toEqual({ refus: [] });
    return id;
  }

  function putApport(detail: Record<string, unknown> = {}, autres: Record<string, unknown> = {}): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'intervention',
        date: '2027-03-10',
        horodatage: '2027-03-10T05:58:00.000Z',
        auteur_id: gerant.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: JSON.stringify([emplacement]),
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ categorie: 'amendement', type: 'amendement', outil: null, produit: 'Compost de déchets verts', quantite: { valeur: 2, unite: 't' }, ...detail }),
        ...autres,
      },
    };
  }

  const evenementEcrit = async (id: string) => (await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [id])).rowCount;

  // ── Produits de la ferme ──────────────────────────────────────────────────────────────────

  it('PUT : créé dans la ferme avec ses teneurs et son historique ; renvoi identique accepté sans rien écrire', async () => {
    const id = nouvelId();
    const e = put(id, produit(ferme));
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await ligne(id)).toMatchObject({ ferme_id: ferme, nom: 'Compost de déchets verts', forme: 'solide', unite: 't', organique: true, utilisable_en_bio: true, supprime_le: null });
    expect(Number((await ligne(id))?.teneur_n)).toBe(1);
    expect(await historique(id)).toEqual([{ operation: 'creation', nom_table: 'ProduitFertilisant' }]);
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await historique(id)).toHaveLength(1);
  });

  it('PUT d’un équipier, liste de départ en un lot : accepté (tout membre actif)', async () => {
    const a = nouvelId();
    const b = nouvelId();
    expect(await lot([put(a, produit(ferme, { nom: 'Corne broyée', unite: 'kg', teneur_n: 12.2, teneur_p2o5: null })), put(b, produit(ferme, { nom: 'Vinasse de betterave', forme: 'liquide', unite: 'L', teneur_n: null, teneur_p2o5: null }))], equipier.jeton)).toEqual({
      refus: [],
    });
    expect(await ligne(b)).toMatchObject({ forme: 'liquide', unite: 'L', teneur_n: null });
  });

  it.each([
    ['teneur au-delà de 100 %', { teneur_n: 120 }],
    ['nom vide', { nom: ' ' }],
    ['unité inconnue', { unite: 'brouette' }],
    ['sans ferme', { ferme_id: null }],
  ])('PUT refusé (%s) : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
    const id = nouvelId();
    expect((await lot([put(id, produit(ferme, autres))])).refus).toEqual([{ table: 'produit_fertilisant', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toBeUndefined();
  });

  it('PUT dans une ferme dont on n’est pas membre : ferme_interdite', async () => {
    const id = nouvelId();
    expect((await lot([put(id, produit(autreFerme))])).refus).toEqual([{ table: 'produit_fertilisant', id, motif: 'ferme_interdite' }]);
  });

  it('PATCH : teneur après analyse, archiver, rétablir ; historique', async () => {
    const id = await creerProduit();
    expect(await lot([patch(id, { teneur_n: 1.3, modifie_le: '2027-03-10T06:00:00.000Z' })])).toEqual({ refus: [] });
    expect(Number((await ligne(id))?.teneur_n)).toBe(1.3);
    expect(await lot([patch(id, { supprime_le: '2027-03-10T06:10:00.000Z' })])).toEqual({ refus: [] });
    expect(await lot([patch(id, { supprime_le: null })])).toEqual({ refus: [] });
    expect((await historique(id)).map((h) => h.operation)).toEqual(['creation', 'modification', 'suppression', 'modification']);
  });

  it('PATCH refusé : règle du cœur, produit d’une autre ferme (comme introuvable), voisin', async () => {
    const id = await creerProduit();
    expect((await lot([patch(id, { teneur_k2o: -1 })])).refus).toEqual([{ table: 'produit_fertilisant', id, motif: 'ecriture_invalide' }]);
    expect((await lot([patch(produitVoisin, { nom: 'Pris' })])).refus).toEqual([{ table: 'produit_fertilisant', id: produitVoisin, motif: 'ecriture_invalide' }]);
    expect((await lot([patch(id, { nom: 'Pris' })], voisin.jeton)).refus).toEqual([{ table: 'produit_fertilisant', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toMatchObject({ nom: 'Compost de déchets verts' });
  });

  it('DELETE : table_interdite', async () => {
    const id = await creerProduit();
    expect((await lot([{ op: 'DELETE', table: 'produit_fertilisant', id }])).refus).toEqual([{ table: 'produit_fertilisant', id, motif: 'table_interdite' }]);
    expect(await ligne(id)).toBeDefined();
  });

  // ── Apports ───────────────────────────────────────────────────────────────────────────────

  it('apport qui désigne un produit de la ferme : accepté ; texte libre sans produit : accepté', async () => {
    const id = await creerProduit();
    const a = putApport({ produitFertilisantId: id });
    const libre = putApport({ produit: 'Purin maison' });
    expect(await lot([a, libre])).toEqual({ refus: [] });
    expect(await evenementEcrit(a.id)).toBe(1);
    expect(await evenementEcrit(libre.id)).toBe(1);
  });

  it('apport qui désigne le produit d’une autre ferme ou un produit inexistant : refusé', async () => {
    for (const cible of [produitVoisin, nouvelId()]) {
      const e = putApport({ produitFertilisantId: cible });
      expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
      expect(await evenementEcrit(e.id)).toBe(0);
    }
  });

  it('produit archivé : un apport saisi hors ligne avant l’archivage reste accepté', async () => {
    const id = await creerProduit();
    expect(await lot([patch(id, { supprime_le: '2027-03-10T08:00:00.000Z' })])).toEqual({ refus: [] });
    const e = putApport({ produitFertilisantId: id });
    expect(await lot([e])).toEqual({ refus: [] });
  });

  // ── Zone vulnérable (Q44) ─────────────────────────────────────────────────────────────────

  const zoneVulnerable = async (): Promise<boolean | undefined> =>
    (await base.pool.query<{ z: boolean }>(`SELECT zone_vulnerable_nitrates AS z FROM ferme WHERE id = $1`, [ferme])).rows[0]?.z;

  it('option décochée par défaut ; cochée puis décochée par un équipier, historique Ferme', async () => {
    expect(await zoneVulnerable()).toBe(false);
    expect(await lot([{ op: 'PATCH', table: 'ferme', id: ferme, donnees: { zone_vulnerable_nitrates: 1 } }], equipier.jeton)).toEqual({ refus: [] });
    expect(await zoneVulnerable()).toBe(true);
    expect(await lot([{ op: 'PATCH', table: 'ferme', id: ferme, donnees: { zone_vulnerable_nitrates: 0 } }])).toEqual({ refus: [] });
    expect(await zoneVulnerable()).toBe(false);
    const h = await historique(ferme);
    expect(h.filter((x) => x.nom_table === 'Ferme')).toHaveLength(2);
  });

  it('valeur illisible, autre colonne, ferme voisine : refusé, rien ne change', async () => {
    expect((await lot([{ op: 'PATCH', table: 'ferme', id: ferme, donnees: { zone_vulnerable_nitrates: 'oui' } }])).refus).toEqual([{ table: 'ferme', id: ferme, motif: 'ecriture_invalide' }]);
    expect((await lot([{ op: 'PATCH', table: 'ferme', id: ferme, donnees: { zone_vulnerable_nitrates: 1, nom: 'Autre' } }])).refus).toEqual([{ table: 'ferme', id: ferme, motif: 'ecriture_invalide' }]);
    expect((await lot([{ op: 'PATCH', table: 'ferme', id: ferme, donnees: { zone_vulnerable_nitrates: 1 } }], voisin.jeton)).refus).toEqual([{ table: 'ferme', id: ferme, motif: 'ecriture_invalide' }]);
    expect(await zoneVulnerable()).toBe(false);
  });
});
