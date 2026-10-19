/**
 * Tests d'acceptation T57 — POST /sync/upload accepte les vannes d'irrigation et leurs liens datés
 * avec les emplacements (docs/backlog/T57-vannes-irrigation.md), contre un vrai Postgres (même
 * amorçage que structure-placement.integration.test.ts : DATABASE_URL, base jetable
 * `t57_vannes_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Contrat (en plus de T10s et T28s) ──────────────────────────────────────────────────────
 *
 * Tables ouvertes au téléphone, comme le parcellaire (structure.ts) : PUT (création), PATCH
 * (modification, suppression douce, rétablissement) ; DELETE refusé. Tout ou rien avec le reste du
 * lot, sous le verrou de chaque ferme touchée. Règles d'une ligne : irrigation-lignes.test.ts.
 *
 * Droits : tout membre actif déclare ses vannes et dit ce qu'elles arrosent (comme les planches,
 * T10s). Poser une vanne sur le plan (placement_x_m, placement_y_m non nuls, ou changés) est un
 * placement (Q31) : GÉRANT seulement, et jamais sans origine du plan. Une vanne placée fige
 * l'origine du plan comme les autres placements.
 *
 * Base :
 *   - numéro de vanne unique parmi les vannes non supprimées de la ferme (création, changement de
 *     numéro, rétablissement) : « ce numéro de vanne existe déjà » ; une vanne supprimée libère
 *     son numéro ; deux créations du même numéro dans un lot : le lot est refusé ;
 *   - un lien désigne une vanne et un emplacement non supprimés DE LA FERME (une ligne d'une autre
 *     ferme est introuvable) ;
 *   - deux liens non supprimés de la même vanne au même emplacement ne se chevauchent pas ;
 *   - une vanne qui arrose encore un emplacement (lien non supprimé, sans fin ou fini aujourd'hui ou
 *     après) ne se supprime pas ; un lien fermé ou supprimé plus haut dans le même lot ne la
 *     retient plus.
 *
 * Historique : une ligne `modification` par ligne touchée, nom_table 'SecteurIrrigation' ou
 * 'SecteurEmplacement'. Changer le réseau ferme l'ancien lien (au) et en crée un nouveau : les
 * deux restent en base.
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
const MAINTENANT = new Date('2026-10-19T06:00:00Z');
const ORIGINE = { latitude: 44, longitude: 1.5 };
const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';

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

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T57')('T57 : POST /sync/upload accepte les vannes et ce qu’elles arrosent', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let theo: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let ferme: string;
  let fermeSansOrigine: string;
  let voisine: string;
  let tunnel: string;
  let champ: string;
  let p3: string;
  let p4: string;
  let pc1: string;
  let plancheVoisine: string;
  let vanneVoisine: string;
  let compteur = 1000;

  async function requete(texte: string, valeurs: readonly unknown[] = []): Promise<void> {
    await base.pool.query(texte, [...valeurs]);
  }
  async function zoneEn(fermeId: string, nom: string): Promise<string> {
    const id = randomUUID();
    await requete(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, $3, 'tunnel')`, [id, fermeId, nom]);
    return id;
  }
  async function plancheEn(fermeId: string, zoneId: string, code: string): Promise<string> {
    const id = randomUUID();
    await requete(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du) VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01')`, [id, fermeId, zoneId, code]);
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t57_vannes');
    cles = { active: await genererCleSignature('cle-t57'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Ferme de Théophane');
    fermeSansOrigine = await creerFerme(base.pool, 'Second site');
    voisine = await creerFerme(base.pool, 'Ferme voisine');
    const u = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, fermeSansOrigine, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, voisine, { role: 'gerant' });
    theo = { id: u.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
    equipier = { id: e.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, e.id, MAINTENANT) };
    for (const f of [ferme, voisine]) await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify(ORIGINE)]);
    tunnel = await zoneEn(ferme, 'Tunnel 2');
    champ = await zoneEn(ferme, 'Plein champ');
    p3 = await plancheEn(ferme, tunnel, 'P3');
    p4 = await plancheEn(ferme, tunnel, 'P4');
    pc1 = await plancheEn(ferme, champ, 'PC-01');
    const zv = await zoneEn(voisine, 'Tunnel voisin');
    plancheVoisine = await plancheEn(voisine, zv, 'P1');
    vanneVoisine = randomUUID();
    await requete(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom) VALUES ($1, $2, 1, 'V1')`, [vanneVoisine, voisine]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

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
  async function ligne(table: 'secteur_irrigation' | 'secteur_emplacement' | 'ferme', id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }
  async function compter(texte: string, valeurs: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${texte}) t`, [...valeurs]);
    return r.rows[0]?.n ?? -1;
  }
  async function message(id: string): Promise<string> {
    const r = await base.pool.query<{ message: string }>(`SELECT message FROM refus_synchro WHERE ligne_id = $1 ORDER BY cree_le DESC LIMIT 1`, [id]);
    const m = r.rows[0]?.message ?? '';
    expect(jargon(m), m).toEqual([]);
    expect(defautsDeForme(m), m).toEqual([]);
    expect(m.startsWith(DEBUT_INVALIDE), m).toBe(true);
    return m;
  }
  /** Le lot est refusé en entier : chaque écriture a son refus, la fautive 'ecriture_invalide' ; le message de la fautive répond à `motif`. */
  async function refuse(ecritures: readonly EcritureEnvoyee[], fautive: EcritureEnvoyee, motif: RegExp, jeton: string = theo.jeton): Promise<void> {
    const r = await lot(ecritures, jeton);
    for (const e of ecritures) expect(r.refus.some((x) => x.id === e.id), `${e.table} ${e.id} refusée`).toBe(true);
    expect(r.refus.find((x) => x.id === fautive.id)?.motif).toBe('ecriture_invalide');
    for (const e of ecritures) {
      if (e.op === 'PUT' && (e.table === 'secteur_irrigation' || e.table === 'secteur_emplacement')) expect(await ligne(e.table, e.id), `${e.table} ${e.id} pas écrite`).toBeNull();
    }
    expect(await message(fautive.id)).toMatch(motif);
  }

  const putVanne = (numero: number, autres: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'secteur_irrigation',
    id: nouvelId(),
    donnees: { ferme_id: fermeId, numero_vanne: numero, nom: `V${String(numero)}`, debit_litres_heure: null, placement_x_m: null, placement_y_m: null, cree_le: MAINTENANT.toISOString(), modifie_le: MAINTENANT.toISOString(), supprime_le: null, ...autres },
  });
  const putLien = (vanne: string, emplacement: string, autres: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'secteur_emplacement',
    id: nouvelId(),
    donnees: { ferme_id: fermeId, secteur_irrigation_id: vanne, emplacement_id: emplacement, du: '2026-10-19', au: null, supprime_le: null, ...autres },
  });
  const patch = (table: string, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const numeroLibre = (): number => ++compteur;

  it('60 vannes créées en un envoi (V1 à V60 d’une ferme neuve) : 60 lignes, 60 historiques', async () => {
    const neuve = await creerFerme(base.pool, 'Ferme aux 60 vannes');
    await ajouterMembre(base.pool, theo.id, neuve, { role: 'gerant' });
    const lotVannes = Array.from({ length: 60 }, (_, i) => putVanne(i + 1, {}, neuve));
    await accepte(lotVannes);
    expect(await compter(`SELECT 1 FROM secteur_irrigation WHERE ferme_id = $1`, [neuve])).toBe(60);
    expect(await compter(`SELECT DISTINCT numero_vanne FROM secteur_irrigation WHERE ferme_id = $1`, [neuve])).toBe(60);
    expect(await compter(`SELECT 1 FROM modification WHERE ferme_id = $1 AND nom_table = 'SecteurIrrigation' AND operation = 'creation' AND auteur_id = $2`, [neuve, theo.id])).toBe(60);
    // Renvoyer le même lot (réponse perdue) ne crée rien en double.
    await accepte(lotVannes);
    expect(await compter(`SELECT 1 FROM secteur_irrigation WHERE ferme_id = $1`, [neuve])).toBe(60);
  });

  it('numéro déjà pris dans la ferme : refusé ; deux fois le même dans un lot : lot refusé ; une vanne supprimée libère le sien', async () => {
    const n = numeroLibre();
    const premiere = putVanne(n);
    await accepte([premiere]);
    const doublon = putVanne(n);
    await refuse([doublon], doublon, /numéro de vanne existe déjà/);
    const a = putVanne(numeroLibre());
    const b = putVanne(Number(a.donnees?.numero_vanne));
    await refuse([a, b], b, /numéro de vanne existe déjà/);
    // Même numéro dans une autre ferme : permis.
    await accepte([putVanne(n, {}, fermeSansOrigine)]);
    // Supprimée, puis le numéro est repris ; la rétablir est alors refusé.
    await accepte([patch('secteur_irrigation', premiere.id, { supprime_le: '2026-10-19T06:10:00.000Z' })]);
    const reprise = putVanne(n);
    await accepte([reprise]);
    const retablir = patch('secteur_irrigation', premiere.id, { supprime_le: null });
    const r = await lot([retablir]);
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect(await message(premiere.id)).toMatch(/numéro de vanne existe déjà/);
  });

  it('une vanne qui arrose deux zones : deux liens acceptés, historisés', async () => {
    const v = putVanne(numeroLibre());
    const l1 = putLien(v.id, p3);
    const l2 = putLien(v.id, pc1);
    await accepte([v, l1, l2]);
    expect(await ligne('secteur_emplacement', l1.id)).toMatchObject({ secteur_irrigation_id: v.id, emplacement_id: p3, du: '2026-10-19', au: null });
    expect(await ligne('secteur_emplacement', l2.id)).toMatchObject({ secteur_irrigation_id: v.id, emplacement_id: pc1 });
    expect(await compter(`SELECT 1 FROM modification WHERE nom_table = 'SecteurEmplacement' AND ligne_id = ANY($1::uuid[])`, [[l1.id, l2.id]])).toBe(2);
  });

  it('changer le réseau garde l’historique : l’ancien lien est fermé la veille, le nouveau part du jour', async () => {
    const v = putVanne(numeroLibre());
    const ancien = putLien(v.id, p3, { du: '2026-01-01' });
    await accepte([v, ancien]);
    const fermer = patch('secteur_emplacement', ancien.id, { au: '2026-10-18' });
    const nouveau = putLien(v.id, p4);
    await accepte([fermer, nouveau]);
    expect(await ligne('secteur_emplacement', ancien.id)).toMatchObject({ emplacement_id: p3, du: '2026-01-01', au: '2026-10-18', supprime_le: null });
    expect(await ligne('secteur_emplacement', nouveau.id)).toMatchObject({ emplacement_id: p4, du: '2026-10-19', au: null });
    expect(await compter(`SELECT 1 FROM modification WHERE ligne_id = $1 AND operation = 'modification'`, [ancien.id])).toBe(1);
  });

  it('deux liens actifs de la même vanne au même emplacement qui se chevauchent : refusé', async () => {
    const v = putVanne(numeroLibre());
    await accepte([v, putLien(v.id, p3, { du: '2026-01-01' })]);
    const chevauche = putLien(v.id, p3, { du: '2026-10-19' });
    await refuse([chevauche], chevauche, /déjà arrosé/);
    // Après le lien fermé la veille : accepté.
    const v2 = putVanne(numeroLibre());
    const l = putLien(v2.id, p4, { du: '2026-01-01', au: '2026-10-18' });
    await accepte([v2, l, putLien(v2.id, p4, { du: '2026-10-19' })]);
  });

  it('isolement : vanne ou emplacement d’une autre ferme, ou emplacement supprimé, sont introuvables', async () => {
    const v = putVanne(numeroLibre());
    await accepte([v]);
    const versVoisine = putLien(v.id, plancheVoisine);
    await refuse([versVoisine], versVoisine, /emplacement introuvable/);
    const vanneEtrangere = putLien(vanneVoisine, p3);
    await refuse([vanneEtrangere], vanneEtrangere, /vanne introuvable/);
    const supprimee = await plancheEn(ferme, tunnel, `P-suppr-${String(numeroLibre())}`);
    await requete(`UPDATE emplacement SET supprime_le = now() WHERE id = $1`, [supprimee]);
    const versSupprimee = putLien(v.id, supprimee);
    await refuse([versSupprimee], versSupprimee, /emplacement supprimé/);
  });

  it('un équipier déclare une vanne et ce qu’elle arrose, mais ne la place pas sur le plan', async () => {
    const v = putVanne(numeroLibre());
    await accepte([v, putLien(v.id, p4)], equipier.jeton);
    const placer = patch('secteur_irrigation', v.id, { placement_x_m: 12, placement_y_m: 4 });
    await refuse([placer], placer, /seul le gérant peut placer/i, equipier.jeton);
    const placee = putVanne(numeroLibre(), { placement_x_m: 1, placement_y_m: 2 });
    await refuse([placee], placee, /seul le gérant peut placer/i, equipier.jeton);
  });

  it('le gérant place une vanne ; sans origine du plan : refusé ; une vanne placée fige l’origine', async () => {
    const v = putVanne(numeroLibre());
    await accepte([v]);
    await accepte([patch('secteur_irrigation', v.id, { placement_x_m: 12.5, placement_y_m: -4 })]);
    expect(await ligne('secteur_irrigation', v.id)).toMatchObject({ placement_x_m: 12.5, placement_y_m: -4 });
    const sansOrigine = putVanne(numeroLibre(), { placement_x_m: 1, placement_y_m: 1 }, fermeSansOrigine);
    await refuse([sansOrigine], sansOrigine, /point de départ|origine/i);
    // La ferme a désormais un placement (cette vanne) : l'origine ne bouge plus.
    const bouger = patch('ferme', ferme, { origine_plan: JSON.stringify({ latitude: 45, longitude: 2 }) });
    const r = await lot([bouger]);
    expect(r.refus.map((x) => x.motif)).toEqual(['ecriture_invalide']);
    expect((await ligne('ferme', ferme))?.origine_plan).toEqual(ORIGINE);
  });

  it('une vanne qui arrose encore ne se supprime pas ; son lien fermé plus haut dans le même lot ne la retient plus', async () => {
    const v = putVanne(numeroLibre());
    const l = putLien(v.id, p3, { du: '2026-01-01' });
    await accepte([v, l]);
    const supprimer = patch('secteur_irrigation', v.id, { supprime_le: '2026-10-19T07:00:00.000Z' });
    await refuse([supprimer], supprimer, /arrose encore/);
    await accepte([patch('secteur_emplacement', l.id, { au: '2026-10-18' }), supprimer]);
    expect((await ligne('secteur_irrigation', v.id))?.supprime_le).not.toBeNull();
    expect(await compter(`SELECT 1 FROM modification WHERE ligne_id = $1 AND operation = 'suppression' AND nom_table = 'SecteurIrrigation'`, [v.id])).toBe(1);
  });

  it('DELETE d’une vanne ou d’un lien : refusé, rien ne disparaît', async () => {
    const v = putVanne(numeroLibre());
    await accepte([v]);
    const r = await lot([{ op: 'DELETE', table: 'secteur_irrigation', id: v.id }]);
    expect(r.refus).toHaveLength(1);
    expect(await ligne('secteur_irrigation', v.id)).not.toBeNull();
  });

  it('une irrigation saisie sur une vanne créée dans le même envoi est acceptée', async () => {
    const v = putVanne(numeroLibre());
    const irrigation: EcritureEnvoyee = {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId(),
      donnees: {
        ferme_id: ferme,
        type: 'irrigation',
        date: '2026-10-19',
        horodatage: '2026-10-19T05:00:00.000Z',
        auteur_id: theo.id,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ secteurIrrigationId: v.id, dureeMinutes: 20 }),
      },
    };
    await accepte([v, irrigation]);
    expect(await compter(`SELECT 1 FROM evenement WHERE id = $1 AND type = 'irrigation'`, [irrigation.id])).toBe(1);
  });
});
