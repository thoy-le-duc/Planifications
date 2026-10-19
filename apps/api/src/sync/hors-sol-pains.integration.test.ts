/**
 * Tests d'acceptation T51, serveur — gouttières en pains et densité « en contenants »
 * (docs/backlog/T51-hors-sol-pains.md, règles 1 à 3), contre un vrai Postgres (même amorçage que
 * structure.integration.test.ts : DATABASE_URL, base jetable supprimée à la fin).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * Emplacement (structure-lignes.ts) :
 *   - `nombre_pains` : entier de 1 à PLAFONDS_STRUCTURE.nombrePains, pour une gouttière et
 *     seulement elle (planche, rang : refusé) ;
 *   - gouttière reçue SANS `nombre_pains` (téléphone d'avant T51, import) : le serveur range la
 *     longueur arrondie, au moins 1 (`painsParDefaut` du cœur) ;
 *   - `nombre_places` devient facultatif (gardé s'il est donné, pour une gouttière seulement).
 * Itinéraire (itineraire.ts) : la densité en contenants est validée par le cœur
 *   (`validerItineraire`) ; refus en français qui nomme le champ (« trous par pain »…).
 * Série (serie.ts, fin de lot) : une série dont l'instantané compte en contenants n'occupe que
 *   des gouttières ; sur une planche → 'ecriture_invalide', message qui dit « gouttière ».
 */
import { calculerDatesSerie, creerGenerateurId, type ParametresItineraire } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import { jargon } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-19T06:00:00Z');
const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const COMMUNS = { periodeUsage: null, typeAbri: 'hors_sol', dureeAvantRecolteJours: 60, fenetreRecolteJours: 70, margeSecurite: 5, rendementAttendu: null, perenne: null };
const FRAISE = { mode: 'plant_achete', ...COMMUNS, densite: { facon: 'contenants', trousParContenant: 12 } };
const PLANTATION = '2027-02-01';
const DATES = calculerDatesSerie(FRAISE as unknown as ParametresItineraire, { type: 'plantation', date: PLANTATION as never });

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH';
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}

decrireAvecBase('T51')('T51 : gouttières en pains et densité en contenants', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let ferme: string;
  let zone: string;
  let saison: string;
  let espece: string;
  let itineraire: string;
  let planche: string;
  let compteur = 0;
  const code = (): string => `G${String(++compteur)}`;

  beforeAll(async () => {
    base = await creerBaseJetable('t51_hors_sol');
    cles = { active: await genererCleSignature('cle-t51'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Ferme de Benoît');
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT);
    zone = randomUUID();
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Serre fraises', 'hors_sol')`, [zone, ferme]);
    saison = randomUUID();
    await base.pool.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, ferme]);
    const famille = randomUUID();
    await base.pool.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Rosacées', 3, 4)`, [famille, ferme]);
    espece = randomUUID();
    await base.pool.query(`INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Fraise', 'petit_fruit', false, 'kg')`, [
      espece,
      ferme,
      famille,
    ]);
    itineraire = randomUUID();
    await base.pool.query(`INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Gariguette en gouttière', 'plant_achete', $4)`, [
      itineraire,
      ferme,
      espece,
      JSON.stringify(FRAISE),
    ]);
    planche = randomUUID();
    await base.pool.query(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du) VALUES ($1, $2, $3, 'P1', 'planche', 30, '2026-01-01')`, [
      planche,
      ferme,
      zone,
    ]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<{ refus: { id: string; motif: string }[] }> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { refus: { id: string; motif: string }[] };
  }

  async function ligne(table: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await base.pool.query<{ l: Record<string, unknown> }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function message(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    return r.rows[0]?.message ?? '';
  }

  function gouttiere(autres: Record<string, unknown>): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'emplacement',
      id: nouvelId(),
      donnees: { ferme_id: ferme, zone_id: zone, code: code(), sorte: 'gouttiere', longueur_m: 30, largeur_m: null, actif_du: '2026-10-01', actif_au: null, remplace: '[]', ...autres },
    };
  }

  // ── Emplacement ─────────────────────────────────────────────────────────────────────────

  it('gouttière avec son nombre de pains : acceptée, rangée telle quelle, sans ancien nombre de places', async () => {
    const e = gouttiere({ nombre_pains: 30 });
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await ligne('emplacement', e.id)).toMatchObject({ nombre_pains: 30, nombre_places: null });
  });

  it('gouttière d’un téléphone d’avant T51 (nombre de places, pas de pains) : 1 pain par mètre, longueur arrondie', async () => {
    const e = gouttiere({ longueur_m: 29.6, nombre_places: 120 });
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await ligne('emplacement', e.id)).toMatchObject({ nombre_pains: 30, nombre_places: 120 });
  });

  it('nombre de pains modifié par un PATCH : accepté', async () => {
    const e = gouttiere({ nombre_pains: 30 });
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await lot([{ op: 'PATCH', table: 'emplacement', id: e.id, donnees: { nombre_pains: 28 } }])).toEqual({ refus: [] });
    expect((await ligne('emplacement', e.id))?.nombre_pains).toBe(28);
  });

  it.each([0, -1, 2.5, 'trente'])('nombre de pains %s : refusé, rien écrit, message en français', async (n) => {
    const e = gouttiere({ nombre_pains: n });
    const r = await lot([e]);
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('emplacement', e.id)).toBeNull();
    const m = await message(e.id);
    expect(m).toMatch(/pains/);
    expect(jargon(m)).toEqual([]);
  });

  it('planche avec un nombre de pains : refusée', async () => {
    const e = gouttiere({ sorte: 'planche', nombre_pains: 30 });
    expect((await lot([e])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await ligne('emplacement', e.id)).toBeNull();
  });

  // ── Itinéraire ──────────────────────────────────────────────────────────────────────────

  function itineraireEcrit(parametres: Record<string, unknown>): EcritureEnvoyee {
    return { op: 'PUT', table: 'itineraire', id: nouvelId(), donnees: { ferme_id: ferme, espece_id: espece, variete_id: null, nom: 'Dream en gouttière', mode: parametres.mode, parametres: JSON.stringify(parametres) } };
  }

  it('itinéraire en contenants (10 trous par pain) : accepté, densité rangée telle quelle', async () => {
    const e = itineraireEcrit({ ...FRAISE, densite: { facon: 'contenants', trousParContenant: 10 } });
    expect(await lot([e])).toEqual({ refus: [] });
    expect((await ligne('itineraire', e.id))?.parametres).toMatchObject({ densite: { facon: 'contenants', trousParContenant: 10 } });
  });

  it('semis direct en contenants, 3 graines par trou : accepté', async () => {
    const e = itineraireEcrit({ mode: 'semis_direct', ...COMMUNS, densite: { facon: 'contenants', trousParContenant: 12, grainesParTrou: 3 }, grainesParPoquet: null });
    expect(await lot([e])).toEqual({ refus: [] });
  });

  it('0 trou par pain : refusé, comme le cœur, message qui nomme les trous par pain', async () => {
    const e = itineraireEcrit({ ...FRAISE, densite: { facon: 'contenants', trousParContenant: 0 } });
    expect((await lot([e])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    const m = await message(e.id);
    expect(m).toMatch(/trous par pain/);
    expect(jargon(m)).toEqual([]);
  });

  it('semis direct sans graines par trou : refusé, message qui nomme les graines par trou', async () => {
    const e = itineraireEcrit({ mode: 'semis_direct', ...COMMUNS, densite: { facon: 'contenants', trousParContenant: 12 }, grainesParPoquet: null });
    expect((await lot([e])).refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await message(e.id)).toMatch(/graines par trou/);
  });

  // ── Série ───────────────────────────────────────────────────────────────────────────────

  function serieEtOccupation(emplacementId: string, place: Record<string, unknown>): [EcritureEnvoyee, EcritureEnvoyee] {
    const serieId = nouvelId();
    return [
      {
        op: 'PUT',
        table: 'serie',
        id: serieId,
        donnees: {
          ferme_id: ferme,
          saison_id: saison,
          espece_id: espece,
          variete_id: null,
          itineraire_id: itineraire,
          parametres: JSON.stringify(FRAISE),
          ancre_type: 'plantation',
          ancre_date: PLANTATION,
          prevu_semis_pepiniere: null,
          prevu_mise_en_place: DATES.miseEnPlace,
          prevu_debut_recolte: DATES.debutRecolte,
          prevu_fin_recolte: DATES.finRecolte,
          longueur_m: null,
          nombre_plants: 360,
          statut: 'prevue',
          rotation_acceptee: null,
        },
      },
      {
        op: 'PUT',
        table: 'occupation',
        id: nouvelId(),
        donnees: {
          ferme_id: ferme,
          emplacement_id: emplacementId,
          serie_id: serieId,
          plantation_id: null,
          evenement_id: null,
          longueur_m: null,
          nombre_places: null,
          position_m: null,
          prevu_du: DATES.miseEnPlace,
          prevu_au: DATES.finRecolte,
          reel_du: null,
          reel_au: null,
          ...place,
        },
      },
    ];
  }

  it('série en contenants sur une gouttière (30 pains) : acceptée', async () => {
    const g = gouttiere({ nombre_pains: 30 });
    expect(await lot([g, ...serieEtOccupation(g.id, { nombre_places: 30 })])).toEqual({ refus: [] });
  });

  it('série en contenants sur une planche : refusée, message clair qui dit « gouttière »', async () => {
    const [s, o] = serieEtOccupation(planche, { longueur_m: 30 });
    const r = await lot([s, o]);
    expect(r.refus.length).toBeGreaterThan(0);
    expect(r.refus.find((x) => x.motif !== 'ecriture_invalide')).toBeUndefined();
    expect(await ligne('serie', s.id)).toBeNull();
    const messages = `${await message(s.id)} ${await message(o.id)}`;
    expect(messages).toMatch(/gouttière/);
    expect(jargon(messages)).toEqual([]);
  });
});
