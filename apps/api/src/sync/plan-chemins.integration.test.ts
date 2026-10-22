/**
 * Tests d'acceptation T61 — POST /sync/upload accepte les chemins, les points du plan, les lieux
 * de rangement, leurs places et les outils de la ferme, du GÉRANT seulement, sans jamais toucher
 * une autre ferme (docs/backlog/T61-chemins-outils.md, règles 1 à 3), contre un vrai Postgres
 * (même amorçage que equipe.integration.test.ts : DATABASE_URL, base jetable `t61_plan_…`
 * supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Tables et colonnes ouvertes, au format PowerSync (packages/sync/src/schema.ts : numeric en
 * nombre, jsonb en texte JSON) ; `cree_le`, `modifie_le` tolérées, remplies par le serveur ; `id`
 * dans les données → refus. Colonnes : voir packages/db/src/plan-chemins.integration.test.ts.
 *   chemin           PUT, PATCH (nom, points, largeur_m, supprime_le) ; points = texte JSON.
 *   point_plan       PUT, PATCH (nom, sorte, x_m, y_m, supprime_le).
 *   lieu_rangement   PUT ; PATCH de supprime_le SEULEMENT (un lieu ne change pas d'élément : on le
 *                    retire et on en crée un autre).
 *   place_rangement  PUT, PATCH (nom, supprime_le) ; le lieu ne change pas.
 *   outil            PUT, PATCH (nom, lieu_rangement_id, place_rangement_id, supprime_le).
 *   batiment         accepte aussi les types 'local' et 'chambre_froide'.
 *   DELETE           refusé ('table_interdite' ou 'ajout_seul'), rien ne change.
 *
 * Validation : validerChemin, validerPointPlan, validerPlaceRangement, validerOutil du cœur
 * (packages/core/src/placement/chemins.test.ts), rejouées sur la ligne COMPLÈTE (ligne existante
 * + colonnes reçues). Taille bornée AVANT analyse : `points` de plus de 16 384 caractères, ou qui
 * n'est pas un texte JSON (tableau forgé), refusé sans être parcouru. Références : l'élément d'un
 * lieu, le lieu d'une place ou d'un outil, la place d'un outil sont de LA MÊME ferme, non
 * supprimés, et la place est celle du lieu de l'outil ; un lieu par bâtiment et par point (non
 * supprimés) ; une place par nom dans son lieu, un outil par nom dans la ferme (sans tenir compte
 * des majuscules ni des espaces autour). Refus 'ecriture_invalide', message en français sans
 * jargon (test/jargon.ts), de la forme de T10j.
 *
 * Droits (comme tout placement, Q31 ; décision du testeur, à confirmer) : GÉRANT seulement, rôle
 * relu en base à chaque lot, ferme par ferme. Un équipier qui crée, modifie ou retire l'une de ces
 * lignes → 'ecriture_invalide', message « …seul le gérant peut placer les éléments de la ferme. »,
 * tout le lot refusé.
 *
 * Origine : AUCUN chemin ni point du plan tant que `ferme.origine_plan` est nulle ('ecriture_invalide',
 * message qui parle de l'origine). Un chemin ou un point NON SUPPRIMÉ fige l'origine comme un
 * bâtiment (elle ne se modifie ni ne s'efface plus). Le rangement (lieu, place, outil) n'a pas de
 * position : il ne demande pas d'origine.
 *
 * Isolement entre fermes : ferme_id d'une ferme dont on n'est pas membre actif → 'ferme_interdite' ;
 * ligne d'une autre ferme visée par un PATCH → comme un id inexistant ('ecriture_invalide', T10d) ;
 * ferme_id d'une ligne existante non modifiable. Tout ou rien : un lot refusé n'écrit rien.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import { defautsDeForme, jargon } from './test/jargon.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-21T06:00:00Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };
const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';
const SEUL_LE_GERANT = /seul le gérant peut placer les éléments de la ferme\.$/iu;
const SUPPRIME_LE = '2026-10-21T07:00:00.000Z';

type TableT61 = 'ferme' | 'chemin' | 'point_plan' | 'lieu_rangement' | 'place_rangement' | 'outil' | 'batiment';
type Ligne = Record<string, unknown>;

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

const SENTIER = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 25.5 },
];
const ligneDe = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

decrireAvecBase('T61')('T61 : chemins, rangement et outils écrits par le gérant, jamais chez une autre ferme', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let retire: { id: string; jeton: string };
  let ferme: string;
  let fermeSansOrigine: string;
  let autreFerme: string;
  // Lignes de l'autre ferme, écrites directement en base.
  let batimentVoisin: string;
  let pointVoisin: string;
  let cheminVoisin: string;
  let lieuVoisin: string;
  let placeVoisine: string;
  let outilVoisin: string;
  // Une base de rangement dans la ferme principale.
  let hangar: string;
  let lieuHangar: string;
  let local: string;
  let lieuLocal: string;
  let compteur = 0;
  const unique = (p: string): string => `${p}-${String(++compteur)}`;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);
  const requete = async (texte: string, valeurs: readonly unknown[] = []): Promise<void> => {
    await base.pool.query(texte, [...valeurs]);
  };

  beforeAll(async () => {
    base = await creerBaseJetable('t61_plan');
    cles = { active: await genererCleSignature('cle-t61'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeSansOrigine = await creerFerme(base.pool, 'Ferme sans origine');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, g.id, fermeSansOrigine, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, r.id, ferme, { role: 'gerant', retire: true });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
    for (const f of [ferme, autreFerme]) await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify(ORIGINE)]);

    const batimentEn = async (f: string, nom: string): Promise<string> => {
      const id = randomUUID();
      await requete(
        `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg) VALUES ($1, $2, $3, 'hangar', 20, 12, 6, -10, 15, 0)`,
        [id, f, nom],
      );
      return id;
    };
    hangar = await batimentEn(ferme, 'hangar');
    local = await batimentEn(ferme, 'local');
    batimentVoisin = await batimentEn(autreFerme, 'hangar voisin');
    pointVoisin = randomUUID();
    await requete(`INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m) VALUES ($1, $2, 'Puits voisin', 'point_eau', 1, 1)`, [pointVoisin, autreFerme]);
    cheminVoisin = randomUUID();
    await requete(`INSERT INTO chemin (id, ferme_id, nom, points, largeur_m) VALUES ($1, $2, 'Chemin voisin', $3::jsonb, 2)`, [cheminVoisin, autreFerme, JSON.stringify(SENTIER)]);
    lieuVoisin = randomUUID();
    await requete(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id) VALUES ($1, $2, $3)`, [lieuVoisin, autreFerme, batimentVoisin]);
    placeVoisine = randomUUID();
    await requete(`INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom) VALUES ($1, $2, $3, 'mur nord')`, [placeVoisine, autreFerme, lieuVoisin]);
    outilVoisin = randomUUID();
    await requete(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id) VALUES ($1, $2, 'Grelinette', $3)`, [outilVoisin, autreFerme, lieuVoisin]);
    lieuHangar = randomUUID();
    lieuLocal = randomUUID();
    await requete(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id) VALUES ($1, $2, $3), ($4, $2, $5)`, [lieuHangar, ferme, hangar, lieuLocal, local]);
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
  async function accepte(ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<void> {
    expect(await lot(ecritures, jeton)).toEqual({ refus: [] });
  }
  async function ligne(table: TableT61, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }
  async function message(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    const texte = r.rows[0]?.message ?? '';
    expect(jargon(texte), `jargon dans « ${texte} »`).toEqual([]);
    expect(defautsDeForme(texte), `forme de « ${texte} »`).toEqual([]);
    return texte;
  }
  /** Le lot est refusé en entier avec ce motif pour la fautive ; la ligne fautive n'existe pas (ou est inchangée). */
  async function refuse(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: string, jeton: string = gerant.jeton): Promise<void> {
    const avant = await ligne(fautive.table as TableT61, fautive.id);
    const reponse = await lot(ecritures, jeton);
    expect(reponse.refus.find((x) => x.id === fautive.id)?.motif, JSON.stringify(reponse.refus)).toBe(motif);
    for (const e of ecritures) expect(reponse.refus.some((x) => x.id === e.id), `${e.table} ${e.id} dans les refus (tout ou rien)`).toBe(true);
    expect(await ligne(fautive.table as TableT61, fautive.id)).toEqual(avant);
  }
  async function refuseAvecMessage(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, attendu: RegExp, jeton: string = gerant.jeton): Promise<void> {
    await refuse(ecritures, fautive, 'ecriture_invalide', jeton);
    const m = await message(fautive.id);
    expect(m.startsWith(DEBUT_INVALIDE), m).toBe(true);
    expect(m, attendu.source).toMatch(attendu);
  }

  const put = (table: TableT61, donnees: Record<string, unknown>, id: string = nouvelId()): EcritureEnvoyee => ({ op: 'PUT', table, id, donnees });
  const patch = (table: TableT61, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const putChemin = (autres: Record<string, unknown> = {}, f: string = ferme) => put('chemin', { ferme_id: f, nom: unique('Allée'), points: JSON.stringify(SENTIER), largeur_m: 2.5, supprime_le: null, ...autres });
  const putPoint = (autres: Record<string, unknown> = {}, f: string = ferme) => put('point_plan', { ferme_id: f, nom: unique('Point'), sorte: 'point_eau', x_m: 12.5, y_m: -40, supprime_le: null, ...autres });
  const putLieu = (autres: Record<string, unknown>, f: string = ferme) => put('lieu_rangement', { ferme_id: f, batiment_id: null, point_plan_id: null, supprime_le: null, ...autres });
  const putPlace = (lieuId: string, autres: Record<string, unknown> = {}, f: string = ferme) => put('place_rangement', { ferme_id: f, lieu_rangement_id: lieuId, nom: unique('place'), supprime_le: null, ...autres });
  const putOutil = (lieuId: string | null, autres: Record<string, unknown> = {}, f: string = ferme) =>
    put('outil', { ferme_id: f, nom: unique('Outil'), lieu_rangement_id: lieuId, place_rangement_id: null, supprime_le: null, ...autres });

  // ── Chemins ─────────────────────────────────────────────────────────────────────────────────

  it('gérant : un chemin de trois points, 2,5 m de large, posé puis relu (points en jsonb, largeur en nombre)', async () => {
    const c = putChemin({ nom: 'Allée centrale' });
    await accepte([c]);
    const l = await ligne('chemin', c.id);
    expect(l).toMatchObject({ ferme_id: ferme, nom: 'Allée centrale', points: SENTIER, supprime_le: null });
    expect(Number(l?.largeur_m)).toBe(2.5);
    // Renvoi identique (réponse perdue) : accepté, rien d'écrit en double.
    await accepte([c]);
    expect((await base.pool.query(`SELECT 1 FROM chemin WHERE id = $1`, [c.id])).rowCount).toBe(1);
  });

  it('gérant : un chemin sans nom est accepté', async () => {
    const c = putChemin({ nom: null });
    await accepte([c]);
    expect((await ligne('chemin', c.id))?.nom).toBeNull();
  });

  it('gérant : modifier les points et la largeur, retirer (suppression douce) puis rétablir', async () => {
    const c = putChemin();
    await accepte([c]);
    const autres = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    await accepte([patch('chemin', c.id, { points: JSON.stringify(autres), largeur_m: 1.2 })]);
    expect(await ligne('chemin', c.id)).toMatchObject({ points: autres });
    await accepte([patch('chemin', c.id, { supprime_le: SUPPRIME_LE })]);
    expect((await ligne('chemin', c.id))?.supprime_le).not.toBeNull();
    await accepte([patch('chemin', c.id, { supprime_le: null })]);
    expect((await ligne('chemin', c.id))?.supprime_le).toBeNull();
  });

  it.each([
    ['un seul point', JSON.stringify(ligneDe(1)), /point/i],
    ['aucun point', JSON.stringify([]), /point/i],
    ['201 points', JSON.stringify(ligneDe(201)), /point/i],
    ['un point au-delà de 5 km', JSON.stringify([{ x: 0, y: 0 }, { x: 3000, y: 4001 }]), /loin|distance|kilomètres|5 000/i],
    ['deux points confondus', JSON.stringify([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 9, y: 9 }]), /confondus|même endroit|proches/i],
    ['une coordonnée en texte', JSON.stringify([{ x: 0, y: 0 }, { x: '5', y: 1 }]), /coordonn|nombre/i],
    ['une coordonnée manquante', JSON.stringify([{ x: 0, y: 0 }, { x: 5 }]), /coordonn|nombre/i],
    ['un texte qui n’est pas du JSON', 'pas du json', /point|chemin|liste/i],
    ['un objet au lieu d’une liste', JSON.stringify({ x: 0, y: 0 }), /point|chemin|liste/i],
    ['un tableau forgé (pas un texte)', ligneDe(3), /point|chemin|liste/i],
  ])('géométrie invalide : %s → refusé, rien d’écrit', async (_cas, points, attendu) => {
    const c = putChemin({ points });
    await refuseAvecMessage([c], c, attendu);
    expect(await ligne('chemin', c.id)).toBeNull();
  });

  it('texte de points de plus de 16 384 caractères : refusé sans être parcouru', async () => {
    const long = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0, note: 'x'.repeat(100) })));
    expect(long.length).toBeGreaterThan(16_384);
    const c = putChemin({ points: long });
    await refuse([c], c, 'ecriture_invalide');
    expect(await ligne('chemin', c.id)).toBeNull();
  });

  it.each([
    ['0', 0, /largeur/i],
    ['négative', -2, /largeur/i],
    ['21 m', 21, /largeur/i],
    ['absente', null, /largeur/i],
  ])('largeur invalide : %s → refusé', async (_cas, largeur, attendu) => {
    const c = putChemin({ largeur_m: largeur });
    await refuseAvecMessage([c], c, attendu);
  });

  it('un PATCH qui rend le chemin invalide est refusé, la ligne reste comme avant (règle rejouée sur la ligne complète)', async () => {
    const c = putChemin();
    await accepte([c]);
    const p = patch('chemin', c.id, { largeur_m: 50 });
    await refuseAvecMessage([p], p, /largeur/i);
    expect(Number((await ligne('chemin', c.id))?.largeur_m)).toBe(2.5);
    const q = patch('chemin', c.id, { points: JSON.stringify(ligneDe(1)) });
    await refuse([q], q, 'ecriture_invalide');
    expect((await ligne('chemin', c.id))?.points).toEqual(SENTIER);
  });

  it('DELETE d’un chemin refusé, la ligne reste', async () => {
    const c = putChemin();
    await accepte([c]);
    const r = await lot([{ op: 'DELETE', table: 'chemin', id: c.id }]);
    expect(['table_interdite', 'ajout_seul']).toContain(r.refus[0]?.motif);
    expect(await ligne('chemin', c.id)).not.toBeNull();
  });

  // ── Bâtiments : hangar, local, chambre froide, magasin ──────────────────────────────────────

  it.each(['hangar', 'local', 'chambre_froide', 'magasin'])('gérant : un bâtiment « %s » avec son nom, posé et relu', async (type) => {
    const b = put('batiment', { ferme_id: ferme, nom: `${type} A`, type, longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: -10, centre_y_m: 15, orientation_deg: 0, zone_id: null });
    await accepte([b]);
    expect(await ligne('batiment', b.id)).toMatchObject({ ferme_id: ferme, nom: `${type} A`, type });
  });

  it('un type de bâtiment inconnu reste refusé', async () => {
    const b = put('batiment', { ferme_id: ferme, nom: 'Garage', type: 'garage', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: 0, centre_y_m: 0, orientation_deg: 0, zone_id: null });
    await refuse([b], b, 'ecriture_invalide');
  });

  // ── Points du plan ──────────────────────────────────────────────────────────────────────────

  it('gérant : un point d’eau et un repère nommés, posés, modifiés, retirés', async () => {
    const eau = putPoint({ nom: 'Point d’eau du verger' });
    const repere = putPoint({ nom: 'Portail', sorte: 'repere', x_m: 0, y_m: 0 });
    await accepte([eau, repere]);
    expect(await ligne('point_plan', eau.id)).toMatchObject({ ferme_id: ferme, nom: 'Point d’eau du verger', sorte: 'point_eau' });
    await accepte([patch('point_plan', eau.id, { x_m: 20, y_m: 5 })]);
    expect(Number((await ligne('point_plan', eau.id))?.x_m)).toBe(20);
    await accepte([patch('point_plan', repere.id, { supprime_le: SUPPRIME_LE })]);
    expect((await ligne('point_plan', repere.id))?.supprime_le).not.toBeNull();
  });

  it.each([
    ['sorte inconnue', { sorte: 'puits' }, /sorte|type/i],
    ['nom vide', { nom: '  ' }, /nom/i],
    ['au-delà de 5 km', { x_m: 4000, y_m: 3001 }, /loin|distance|kilomètres|5 000/i],
    ['coordonnée en texte', { x_m: 'ici' }, /coordonn|nombre/i],
  ])('point du plan invalide : %s → refusé', async (_cas, autres, attendu) => {
    const p = putPoint(autres);
    await refuseAvecMessage([p], p, attendu);
    expect(await ligne('point_plan', p.id)).toBeNull();
  });

  // ── Lieux de rangement, places, outils ──────────────────────────────────────────────────────

  it('gérant : lieu = un bâtiment, place « mur nord », outil Grelinette rangé là, le tout dans un seul lot', async () => {
    const b = put('batiment', { ferme_id: ferme, nom: unique('hangar'), type: 'hangar', longueur_m: 20, largeur_m: 12, hauteur_m: 6, centre_x_m: 30, centre_y_m: 15, orientation_deg: 0, zone_id: null });
    const lieu = putLieu({ batiment_id: b.id });
    const place = putPlace(lieu.id, { nom: 'mur nord' });
    const outil = putOutil(lieu.id, { nom: 'Grelinette', place_rangement_id: place.id });
    await accepte([b, lieu, place, outil]);
    expect(await ligne('lieu_rangement', lieu.id)).toMatchObject({ ferme_id: ferme, batiment_id: b.id, point_plan_id: null });
    expect(await ligne('place_rangement', place.id)).toMatchObject({ lieu_rangement_id: lieu.id, nom: 'mur nord' });
    expect(await ligne('outil', outil.id)).toMatchObject({ nom: 'Grelinette', lieu_rangement_id: lieu.id, place_rangement_id: place.id });
  });

  it('gérant : un point d’eau peut être un lieu de rangement ; un outil sans place est accepté', async () => {
    const p = putPoint({ nom: unique('Abri') });
    const lieu = putLieu({ point_plan_id: p.id });
    const outil = putOutil(lieu.id, { nom: unique('Arrosoir') });
    await accepte([p, lieu, outil]);
    expect((await ligne('outil', outil.id))?.place_rangement_id).toBeNull();
  });

  it('gérant : déplacer l’outil (autre lieu, autre place), retirer l’outil puis le rétablir', async () => {
    const place = putPlace(lieuHangar, { nom: unique('étagère') });
    const outil = putOutil(lieuHangar, { nom: unique('Bêche'), place_rangement_id: place.id });
    await accepte([place, outil]);
    await accepte([patch('outil', outil.id, { lieu_rangement_id: lieuLocal, place_rangement_id: null })]);
    expect(await ligne('outil', outil.id)).toMatchObject({ lieu_rangement_id: lieuLocal, place_rangement_id: null });
    await accepte([patch('outil', outil.id, { supprime_le: SUPPRIME_LE })]);
    await accepte([patch('outil', outil.id, { supprime_le: null })]);
    expect((await ligne('outil', outil.id))?.supprime_le).toBeNull();
  });

  it('un outil sans lieu de rangement est refusé (chacun a un lieu)', async () => {
    const o = putOutil(null);
    await refuseAvecMessage([o], o, /lieu|rangement/i);
    expect(await ligne('outil', o.id)).toBeNull();
  });

  it('un lieu doit viser un bâtiment OU un point (ni l’un ni l’autre, ni les deux)', async () => {
    const aucun = putLieu({});
    await refuse([aucun], aucun, 'ecriture_invalide');
    const p = putPoint();
    const deux = putLieu({ batiment_id: hangar, point_plan_id: p.id });
    await refuse([p, deux], deux, 'ecriture_invalide');
    expect(await ligne('point_plan', p.id)).toBeNull();
  });

  it('un seul lieu non supprimé par bâtiment ; un lieu retiré libère le bâtiment', async () => {
    const b = put('batiment', { ferme_id: ferme, nom: unique('local'), type: 'local', longueur_m: 6, largeur_m: 4, hauteur_m: 2.8, centre_x_m: 60, centre_y_m: 15, orientation_deg: 0, zone_id: null });
    const premier = putLieu({ batiment_id: b.id });
    await accepte([b, premier]);
    const doublon = putLieu({ batiment_id: b.id });
    await refuse([doublon], doublon, 'ecriture_invalide');
    await accepte([patch('lieu_rangement', premier.id, { supprime_le: SUPPRIME_LE })]);
    await accepte([putLieu({ batiment_id: b.id })]);
  });

  it('un lieu ne change pas d’élément (on le retire et on en crée un autre) ni de ferme', async () => {
    const p = putPoint();
    const lieu = putLieu({ point_plan_id: p.id });
    await accepte([p, lieu]);
    const change = patch('lieu_rangement', lieu.id, { point_plan_id: null, batiment_id: local });
    await refuse([change], change, 'ecriture_invalide');
    const deFerme = patch('lieu_rangement', lieu.id, { ferme_id: autreFerme });
    await refuse([deFerme], deFerme, 'ecriture_invalide');
    expect(await ligne('lieu_rangement', lieu.id)).toMatchObject({ ferme_id: ferme, point_plan_id: p.id });
  });

  it('deux places de même nom dans un lieu (casse et espaces ignorés) : refusé ; dans deux lieux : permis', async () => {
    const a = putPlace(lieuHangar, { nom: 'rack à gauche' });
    await accepte([a]);
    const doublon = putPlace(lieuHangar, { nom: ' Rack à GAUCHE ' });
    await refuseAvecMessage([doublon], doublon, /déjà|même nom|existe|nom/i);
    await accepte([putPlace(lieuLocal, { nom: 'rack à gauche' })]);
  });

  it('deux outils de même nom dans la ferme (casse et espaces ignorés) : refusé ; un outil retiré libère le nom', async () => {
    const a = putOutil(lieuHangar, { nom: 'Fourche-bêche' });
    await accepte([a]);
    const doublon = putOutil(lieuLocal, { nom: ' fourche-BÊCHE ' });
    await refuseAvecMessage([doublon], doublon, /déjà|même nom|existe|nom/i);
    await accepte([patch('outil', a.id, { supprime_le: SUPPRIME_LE })]);
    await accepte([putOutil(lieuLocal, { nom: 'Fourche-bêche' })]);
  });

  it('place d’un autre lieu pour un outil : refusé ; place ou lieu supprimés : refusé', async () => {
    const placeDuLocal = putPlace(lieuLocal, { nom: unique('étagère') });
    await accepte([placeDuLocal]);
    const o = putOutil(lieuHangar, { place_rangement_id: placeDuLocal.id });
    await refuse([o], o, 'ecriture_invalide');
    const retiree = putPlace(lieuHangar, { nom: unique('coin') });
    await accepte([retiree, patch('place_rangement', retiree.id, { supprime_le: SUPPRIME_LE })]);
    const o2 = putOutil(lieuHangar, { place_rangement_id: retiree.id });
    await refuse([o2], o2, 'ecriture_invalide');
    const lieuRetire = putLieu({ point_plan_id: (await accepteEtId(putPoint())) });
    await accepte([lieuRetire, patch('lieu_rangement', lieuRetire.id, { supprime_le: SUPPRIME_LE })]);
    const o3 = putOutil(lieuRetire.id);
    await refuse([o3], o3, 'ecriture_invalide');
  });

  async function accepteEtId(e: EcritureEnvoyee): Promise<string> {
    await accepte([e]);
    return e.id;
  }

  it.each([
    ['place sans nom', () => putPlace(lieuHangar, { nom: '' })],
    ['place au nom de 61 caractères', () => putPlace(lieuHangar, { nom: 'x'.repeat(61) })],
    ['outil sans nom', () => putOutil(lieuHangar, { nom: ' ' })],
    ['outil au nom de 81 caractères', () => putOutil(lieuHangar, { nom: 'x'.repeat(81) })],
  ])('rangement invalide : %s → refusé, message sur le nom', async (_cas, fabrique) => {
    const e = fabrique();
    await refuseAvecMessage([e], e, /nom/i);
  });

  it('DELETE d’un lieu, d’une place ou d’un outil refusé', async () => {
    const o = putOutil(lieuHangar);
    await accepte([o]);
    for (const [table, id] of [['outil', o.id], ['lieu_rangement', lieuHangar], ['place_rangement', randomUUID()]] as const) {
      const r = await lot([{ op: 'DELETE', table, id }]);
      expect(['table_interdite', 'ajout_seul'], table).toContain(r.refus[0]?.motif);
    }
    expect(await ligne('outil', o.id)).not.toBeNull();
    expect(await ligne('lieu_rangement', lieuHangar)).not.toBeNull();
  });

  // ── Isolement entre fermes ──────────────────────────────────────────────────────────────────

  it.each([
    ['chemin', () => putChemin({}, autreFerme)],
    ['point_plan', () => putPoint({}, autreFerme)],
    ['lieu_rangement', () => putLieu({ batiment_id: batimentVoisin }, autreFerme)],
    ['place_rangement', () => putPlace(lieuVoisin, {}, autreFerme)],
    ['outil', () => putOutil(lieuVoisin, {}, autreFerme)],
  ])('%s : écrire dans une ferme dont on n’est pas membre → ferme_interdite, rien d’écrit', async (_t, fabrique) => {
    const e = fabrique();
    await refuse([e], e, 'ferme_interdite');
    expect(await ligne(e.table as TableT61, e.id)).toBeNull();
  });

  it('un membre retiré de la ferme est refusé (ferme_interdite)', async () => {
    const c = putChemin();
    await refuse([c], c, 'ferme_interdite', retire.jeton);
  });

  it('le gérant de l’autre ferme écrit chez lui, et seulement chez lui', async () => {
    const c = putChemin({}, autreFerme);
    const o = putOutil(lieuVoisin, { nom: unique('Râteau') }, autreFerme);
    await accepte([c, o], voisin.jeton);
    const chezNous = putChemin();
    await refuse([chezNous], chezNous, 'ferme_interdite', voisin.jeton);
  });

  it('lignes de l’autre ferme visées par un PATCH : comme un id inexistant (ecriture_invalide), rien ne change', async () => {
    const cas: [TableT61, string, Record<string, unknown>][] = [
      ['chemin', cheminVoisin, { nom: 'Pirate' }],
      ['point_plan', pointVoisin, { nom: 'Pirate' }],
      ['lieu_rangement', lieuVoisin, { supprime_le: SUPPRIME_LE }],
      ['place_rangement', placeVoisine, { nom: 'Pirate' }],
      ['outil', outilVoisin, { nom: 'Pirate' }],
    ];
    for (const [table, id, donnees] of cas) {
      const avant = await ligne(table, id);
      const e = patch(table, id, donnees);
      await refuse([e], e, 'ecriture_invalide');
      expect(await ligne(table, id), table).toEqual(avant);
    }
  });

  it('référence vers une autre ferme dans sa propre ferme : lieu sur un bâtiment voisin, place sur un lieu voisin, outil sur un lieu voisin → refusés', async () => {
    const lieu = putLieu({ batiment_id: batimentVoisin });
    await refuse([lieu], lieu, 'ecriture_invalide');
    const lieuSurPoint = putLieu({ point_plan_id: pointVoisin });
    await refuse([lieuSurPoint], lieuSurPoint, 'ecriture_invalide');
    const place = putPlace(lieuVoisin);
    await refuse([place], place, 'ecriture_invalide');
    const outil = putOutil(lieuVoisin);
    await refuse([outil], outil, 'ecriture_invalide');
    const outilPlaceVoisine = putOutil(lieuHangar, { place_rangement_id: placeVoisine });
    await refuse([outilPlaceVoisine], outilPlaceVoisine, 'ecriture_invalide');
  });

  it('une ligne de la ferme ne peut pas être passée dans l’autre par un PATCH de ferme_id', async () => {
    const c = putChemin();
    await accepte([c]);
    const e = patch('chemin', c.id, { ferme_id: autreFerme });
    await refuse([e], e, 'ecriture_invalide');
    expect((await ligne('chemin', c.id))?.ferme_id).toBe(ferme);
  });

  it('un lot qui mêle une ligne valide et une écriture chez le voisin est refusé en entier (tout ou rien)', async () => {
    const bonne = putChemin();
    const mauvaise = putPoint({}, autreFerme);
    await refuse([bonne, mauvaise], mauvaise, 'ferme_interdite');
    expect(await ligne('chemin', bonne.id)).toBeNull();
  });

  // ── Droits ──────────────────────────────────────────────────────────────────────────────────

  it.each([
    ['chemin', () => putChemin()],
    ['point_plan', () => putPoint()],
    ['lieu_rangement', () => putLieu({ batiment_id: local })],
    ['place_rangement', () => putPlace(lieuHangar)],
    ['outil', () => putOutil(lieuHangar)],
  ])('équipier : créer un(e) %s est refusé (seul le gérant), rien d’écrit', async (_t, fabrique) => {
    const e = fabrique();
    await refuseAvecMessage([e], e, SEUL_LE_GERANT, equipier.jeton);
    expect(await ligne(e.table as TableT61, e.id)).toBeNull();
  });

  it('équipier : modifier ou retirer un chemin et un outil du gérant est refusé, rien ne change', async () => {
    const c = putChemin();
    const o = putOutil(lieuHangar);
    await accepte([c, o]);
    for (const e of [patch('chemin', c.id, { largeur_m: 4 }), patch('chemin', c.id, { supprime_le: SUPPRIME_LE }), patch('outil', o.id, { nom: 'Volé' }), patch('outil', o.id, { lieu_rangement_id: lieuLocal })]) {
      await refuseAvecMessage([e], e, SEUL_LE_GERANT, equipier.jeton);
    }
    expect(Number((await ligne('chemin', c.id))?.largeur_m)).toBe(2.5);
    expect((await ligne('outil', o.id))?.lieu_rangement_id).toBe(lieuHangar);
  });

  it('équipier : un lot qui mêle une écriture de ces tables et une autre est refusé en entier', async () => {
    const c = putChemin();
    const p = putPoint();
    const r = await lot([c, p], equipier.jeton);
    expect(r.refus).toHaveLength(2);
    expect(await ligne('chemin', c.id)).toBeNull();
    expect(await ligne('point_plan', p.id)).toBeNull();
  });

  // ── Origine du plan ─────────────────────────────────────────────────────────────────────────

  it('aucun chemin ni point du plan sans origine ; le rangement n’en demande pas', async () => {
    const c = putChemin({}, fermeSansOrigine);
    await refuseAvecMessage([c], c, /origine/i);
    const p = putPoint({}, fermeSansOrigine);
    await refuseAvecMessage([p], p, /origine/i);
    const lieuSansOrigine = randomUUID();
    const b = randomUUID();
    await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [fermeSansOrigine, JSON.stringify(ORIGINE)]);
    await requete(`INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg) VALUES ($1, $2, 'hangar', 'hangar', 20, 12, 6, 0, 0, 0)`, [b, fermeSansOrigine]);
    await requete(`UPDATE ferme SET origine_plan = NULL WHERE id = $1`, [fermeSansOrigine]);
    // Le bâtiment existe déjà : un lieu et un outil se rangent sans toucher au plan.
    const lieu = put('lieu_rangement', { ferme_id: fermeSansOrigine, batiment_id: b, point_plan_id: null, supprime_le: null }, lieuSansOrigine);
    const outil = putOutil(lieuSansOrigine, {}, fermeSansOrigine);
    await accepte([lieu, outil]);
  });

  it('un chemin ou un point non supprimé fige l’origine ; une fois retirés, elle se modifie de nouveau', async () => {
    const f = await creerFerme(base.pool, unique('Ferme à l’origine'));
    await ajouterMembre(base.pool, gerant.id, f, { role: 'gerant' });
    await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify(ORIGINE)]);
    const c = putChemin({}, f);
    await accepte([c]);
    const deplace = patch('ferme', f, { origine_plan: JSON.stringify({ latitude: 45, longitude: 2 }) });
    await refuseAvecMessage([deplace], deplace, /origine/i);
    const efface = patch('ferme', f, { origine_plan: null });
    await refuse([efface], efface, 'ecriture_invalide');
    await accepte([patch('chemin', c.id, { supprime_le: SUPPRIME_LE })]);
    await accepte([patch('ferme', f, { origine_plan: JSON.stringify({ latitude: 45, longitude: 2 }) })]);
    const p = putPoint({}, f);
    await accepte([p]);
    const encore = patch('ferme', f, { origine_plan: JSON.stringify(ORIGINE) });
    await refuse([encore], encore, 'ecriture_invalide');
  });
});
