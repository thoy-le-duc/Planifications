/**
 * Tests d'acceptation T56 — POST /sync/upload accepte les recettes de fertirrigation de la ferme et
 * les irrigations qui en portent une (docs/backlog/T56-fertirrigation.md, règles 1 et 2), contre un
 * vrai Postgres (même amorçage que fertilisation.integration.test.ts : DATABASE_URL, base jetable
 * `t56_fertirrigation_…`).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Table ouverte : `recette_fertirrigation`, lignes DE LA FERME. Colonnes au format PowerSync
 * (engrais en texte JSON) ; règles de ligne : `validerRecetteFertirrigation` du cœur, rejouée sur
 * la ligne COMPLÈTE. Même modèle que produit_fertilisant (T54) :
 *
 *   PUT     crée la recette. Ferme dont l'utilisateur n'est pas membre actif → 'ferme_interdite' ;
 *           règle du cœur violée → 'ecriture_invalide'. Renvoi identique : accepté. Chaque engrais
 *           désigne un produit fertilisant DE LA FERME (archivé compris), sinon 'ecriture_invalide'.
 *   PATCH   modifie, archive (supprime_le) et rétablit. Recette introuvable ou d'une autre ferme →
 *           'ecriture_invalide' (T10d).
 *   DELETE  'table_interdite'.
 * Droits : tout membre actif. Historique : une ligne `modification` par écriture
 * ('RecetteFertirrigation' ; creation, modification, suppression).
 *
 * Irrigation (événement) : `detail.recetteFertirrigationId`, s'il est là, désigne une recette de la
 * ferme (archivée comprise : saisie hors ligne avant l'archivage) ; chaque `detail.engrais[]`
 * désigne un produit fertilisant de la ferme. Sinon 'ecriture_invalide', rien d'écrit. Une
 * irrigation sans recette : acceptée comme avant (T57).
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

decrireAvecBase('T56')('T56 : recettes de fertirrigation et irrigations qui en portent une, écrites par les téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let ferme: string;
  let autreFerme: string;
  let vanne: string;
  let nitrate: string;
  let produitVoisin: string;
  let recetteVoisine: string;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  beforeAll(async () => {
    base = await creerBaseJetable('t56_fertirrigation');
    cles = { active: await genererCleSignature('cle-t56'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Fraises de Garonne');
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
    vanne = randomUUID();
    await base.pool.query(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, debit_litres_heure) VALUES ($1, $2, 12, 'V12', 6000)`, [vanne, ferme]);
    nitrate = randomUUID();
    produitVoisin = randomUUID();
    await base.pool.query(
      `INSERT INTO produit_fertilisant (id, ferme_id, nom, forme, unite, teneur_n, organique, utilisable_en_bio) VALUES ($1, $2, 'Nitrate de calcium', 'solide', 'kg', 15.5, false, false), ($3, $4, 'Nitrate du voisin', 'solide', 'kg', 15.5, false, false)`,
      [nitrate, ferme, produitVoisin, autreFerme],
    );
    recetteVoisine = randomUUID();
    await base.pool.query(
      `INSERT INTO recette_fertirrigation (id, ferme_id, nom, taux_injection, engrais) VALUES ($1, $2, 'Recette du voisin', 1, $3::jsonb)`,
      [recetteVoisine, autreFerme, JSON.stringify([{ produitFertilisantId: produitVoisin, quantite: { valeur: 10, unite: 'kg' } }])],
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
    return (await base.pool.query<Record<string, unknown>>(`SELECT * FROM recette_fertirrigation WHERE id = $1`, [id])).rows[0];
  }

  async function historique(id: string): Promise<{ operation: string; nom_table: string }[]> {
    const r = await base.pool.query<{ operation: string; nom_table: string }>(`SELECT operation, nom_table FROM modification WHERE ligne_id = $1 ORDER BY horodatage, id`, [id]);
    return r.rows;
  }

  function recette(fermeId: string | null, autres: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ferme_id: fermeId,
      nom: 'Fraise floraison',
      taux_injection: 1,
      engrais: JSON.stringify([{ produitFertilisantId: nitrate, quantite: { valeur: 10, unite: 'kg' } }]),
      ec_cible: 1.8,
      ph_cible: 5.8,
      cree_le: '2027-05-10T05:00:00.000Z',
      modifie_le: '2027-05-10T05:00:00.000Z',
      supprime_le: null,
      ...autres,
    };
  }

  const put = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PUT', table: 'recette_fertirrigation', id, donnees });
  const patch = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'recette_fertirrigation', id, donnees });

  async function creerRecette(autres: Record<string, unknown> = {}): Promise<string> {
    const id = nouvelId();
    expect(await lot([put(id, recette(ferme, autres))])).toEqual({ refus: [] });
    return id;
  }

  function putIrrigation(detail: Record<string, unknown>): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: ferme,
        type: 'irrigation',
        date: '2027-05-10',
        horodatage: '2027-05-10T05:58:00.000Z',
        auteur_id: gerant.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ secteurIrrigationId: vanne, dureeMinutes: 20, ...detail }),
      },
    };
  }

  const avecRecette = (recetteId: string, produitId: string = nitrate) => ({
    recetteFertirrigationId: recetteId,
    volumeM3: 2,
    ecMesuree: 1.9,
    phMesure: 5.9,
    engrais: [{ produitFertilisantId: produitId, produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' } }],
  });

  const evenementEcrit = async (id: string) => (await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [id])).rowCount;

  // ── Recettes de la ferme ──────────────────────────────────────────────────────────────────

  it('PUT : créée dans la ferme avec ses engrais et son historique ; renvoi identique accepté sans rien écrire', async () => {
    const id = nouvelId();
    const e = put(id, recette(ferme));
    expect(await lot([e])).toEqual({ refus: [] });
    const l = await ligne(id);
    expect(l).toMatchObject({ ferme_id: ferme, nom: 'Fraise floraison', supprime_le: null });
    expect(Number(l?.taux_injection)).toBe(1);
    expect(l?.engrais).toEqual([{ produitFertilisantId: nitrate, quantite: { valeur: 10, unite: 'kg' } }]);
    expect(await historique(id)).toEqual([{ operation: 'creation', nom_table: 'RecetteFertirrigation' }]);
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await historique(id)).toHaveLength(1);
  });

  it('PUT d’un équipier, recette par m³ sans EC ni pH : acceptée (tout membre actif)', async () => {
    const id = nouvelId();
    expect(await lot([put(id, recette(ferme, { nom: 'Tomate pleine terre', taux_injection: null, ec_cible: null, ph_cible: null }))], equipier.jeton)).toEqual({ refus: [] });
    expect(await ligne(id)).toMatchObject({ taux_injection: null, ec_cible: null });
  });

  it.each([
    ['nom vide', { nom: ' ' }],
    ['taux au-delà de 100 %', { taux_injection: 120 }],
    ['aucun engrais', { engrais: '[]' }],
    ['sans ferme', { ferme_id: null }],
  ])('PUT refusé (%s) : ecriture_invalide, rien d’écrit', async (_cas, autres) => {
    const id = nouvelId();
    expect((await lot([put(id, recette(ferme, autres))])).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toBeUndefined();
  });

  it('PUT dont un engrais est le produit d’une autre ferme ou un produit inexistant : ecriture_invalide', async () => {
    for (const cible of [produitVoisin, nouvelId()]) {
      const id = nouvelId();
      const engrais = JSON.stringify([{ produitFertilisantId: cible, quantite: { valeur: 10, unite: 'kg' } }]);
      expect((await lot([put(id, recette(ferme, { engrais }))])).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'ecriture_invalide' }]);
      expect(await ligne(id)).toBeUndefined();
    }
  });

  it('PUT dans une ferme dont on n’est pas membre : ferme_interdite', async () => {
    const id = nouvelId();
    expect((await lot([put(id, recette(autreFerme))])).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'ferme_interdite' }]);
  });

  it('PATCH : changer le taux, archiver, rétablir ; historique', async () => {
    const id = await creerRecette();
    expect(await lot([patch(id, { taux_injection: 1.5, modifie_le: '2027-05-10T06:00:00.000Z' })])).toEqual({ refus: [] });
    expect(Number((await ligne(id))?.taux_injection)).toBe(1.5);
    expect(await lot([patch(id, { supprime_le: '2027-05-10T06:10:00.000Z' })])).toEqual({ refus: [] });
    expect(await lot([patch(id, { supprime_le: null })])).toEqual({ refus: [] });
    expect((await historique(id)).map((h) => h.operation)).toEqual(['creation', 'modification', 'suppression', 'modification']);
  });

  it('PATCH refusé : règle du cœur, recette d’une autre ferme (comme introuvable), voisin', async () => {
    const id = await creerRecette();
    expect((await lot([patch(id, { ph_cible: 20 })])).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'ecriture_invalide' }]);
    expect((await lot([patch(recetteVoisine, { nom: 'Prise' })])).refus).toEqual([{ table: 'recette_fertirrigation', id: recetteVoisine, motif: 'ecriture_invalide' }]);
    expect((await lot([patch(id, { nom: 'Prise' })], voisin.jeton)).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'ecriture_invalide' }]);
    expect(await ligne(id)).toMatchObject({ nom: 'Fraise floraison' });
  });

  it('DELETE : table_interdite', async () => {
    const id = await creerRecette();
    expect((await lot([{ op: 'DELETE', table: 'recette_fertirrigation', id }])).refus).toEqual([{ table: 'recette_fertirrigation', id, motif: 'table_interdite' }]);
    expect(await ligne(id)).toBeDefined();
  });

  // ── Irrigations ───────────────────────────────────────────────────────────────────────────

  it('irrigation qui porte une recette de la ferme : acceptée ; sans recette : acceptée comme avant', async () => {
    const r = await creerRecette();
    const avec = putIrrigation(avecRecette(r));
    const sans = putIrrigation({});
    expect(await lot([avec, sans])).toEqual({ refus: [] });
    expect(await evenementEcrit(avec.id)).toBe(1);
    expect(await evenementEcrit(sans.id)).toBe(1);
  });

  it('recette d’une autre ferme ou inexistante : refusée, rien d’écrit', async () => {
    for (const cible of [recetteVoisine, nouvelId()]) {
      const e = putIrrigation(avecRecette(cible));
      expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
      expect(await evenementEcrit(e.id)).toBe(0);
    }
  });

  it('engrais qui désigne le produit d’une autre ferme : refusé', async () => {
    const r = await creerRecette();
    const e = putIrrigation(avecRecette(r, produitVoisin));
    expect((await lot([e])).refus).toEqual([{ table: 'evenement', id: e.id, motif: 'ecriture_invalide' }]);
    expect(await evenementEcrit(e.id)).toBe(0);
  });

  it('recette archivée : une irrigation saisie hors ligne avant l’archivage reste acceptée', async () => {
    const r = await creerRecette();
    expect(await lot([patch(r, { supprime_le: '2027-05-10T08:00:00.000Z' })])).toEqual({ refus: [] });
    const e = putIrrigation(avecRecette(r));
    expect(await lot([e])).toEqual({ refus: [] });
  });
});
