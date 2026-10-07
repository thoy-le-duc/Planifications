/**
 * Tests d'acceptation T28s — POST /sync/upload accepte le placement réel (Q30, Q31 ;
 * docs/backlog/T28s-placement-serveur.md, docs/modele-donnees.md v1.x) contre un vrai Postgres
 * (même amorçage que structure.integration.test.ts : DATABASE_URL, base jetable
 * `t28s_placement_…` supprimée à la fin ; sans DATABASE_URL, échec en CI et saut signalé en local).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Un placement fait sur l'ordinateur (même hors ligne) arrive au serveur, sans jamais toucher une
 * autre ferme, et seulement s'il vient du GÉRANT de la ferme (Q31).
 *
 * ── Contrat (en plus de T10s, structure.integration.test.ts) ────────────────────────────────
 *
 * Tables et colonnes ouvertes, au format PowerSync (packages/sync/src/schema.ts : numeric en
 * nombre, jsonb en texte JSON) :
 *   batiment        PUT (création), PATCH (modification, suppression douce, rétablissement) ;
 *                   DELETE refusé ('table_interdite' ou 'ajout_seul'). Colonnes : ferme_id, nom,
 *                   type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m,
 *                   orientation_deg, zone_id, supprime_le ; cree_le, modifie_le tolérées.
 *   zone.contour    texte JSON d'une liste de sommets {x, y}, ou nul. Rangé en jsonb, normalisé
 *                   par validerContour (sens antihoraire, x et y seulement).
 *   emplacement     placement_x_m, placement_y_m, orientation_deg (les trois ou aucun).
 *   ferme           PATCH de `origine_plan` SEULEMENT (texte JSON {latitude, longitude}). Toute
 *                   autre colonne de ferme reçue (nom, position, fuseau_horaire, unites,
 *                   supprime_le, …) → 'ecriture_invalide', rien ne change. PUT ou DELETE d'une
 *                   ferme → 'table_interdite'. Ferme dont on n'est pas membre actif (voisine,
 *                   membre retiré) → 'ecriture_invalide', comme une ligne introuvable (T10d),
 *                   ferme nulle dans refus_synchro.
 *
 * Droits (Q31) : GÉRANT seulement, rôle relu en base à chaque lot, ferme par ferme (être gérant
 * d'une autre ferme ne donne rien ici). Un équipier qui crée, modifie ou supprime un bâtiment,
 * envoie un contour non nul, un placement d'emplacement non nul, ou modifie l'un d'eux, ou pose
 * l'origine → 'ecriture_invalide', message « Saisie non enregistrée, données invalides : seul le
 * gérant peut placer les éléments de la ferme. » (casse de la première lettre libre après « : »).
 * Créer une zone ou une planche SANS placement, ou modifier une ligne placée sans toucher à son
 * placement, reste ouvert à tout membre actif (T10s).
 *
 * Origine (Q31) : `origine_plan` s'écrit si elle est nulle, ou si la ferme n'a encore AUCUN
 * placement (bâtiment non supprimé, zone non supprimée avec contour, emplacement non supprimé
 * placé). Sinon → 'ecriture_invalide', inchangée. Renvoi de la même valeur : accepté, rien
 * d'écrit. Les écritures d'un lot sont jugées dans l'ordre : un bâtiment écrit plus haut dans le
 * lot est un placement qui fige l'origine.
 *
 * Validation : validerPlacement et validerContour de @planif/core rejouées à l'identique, sur la
 * ligne complète (ligne existante + colonnes reçues). Taille bornée AVANT analyse : un contour
 * reçu de plus de 16 384 caractères de texte JSON, ou qui n'est pas un texte JSON (tableau forgé),
 * est refusé sans être parcouru. Un bâtiment par zone au plus ; zone abritée sans contour ; zone
 * d'un bâtiment de la même ferme, non supprimée. Refus 'ecriture_invalide', message en français
 * sans jargon (test/jargon.ts), forme de T10j.
 *
 * Suppression d'une zone abritée (relecture T28a n°2, décision du testeur, à confirmer par le
 * chef) : REFUSÉE tant qu'un bâtiment non supprimé l'abrite (message qui parle du bâtiment) ;
 * acceptée si le bâtiment est supprimé ou détaché plus haut dans le même lot. Supprimer le
 * bâtiment d'une zone : accepté, la zone et ses planches ne changent pas (la zone redevient
 * « pas placée »).
 *
 * Tout ou rien : batiment et ferme rejoignent les tables d'un lot tout ou rien (TABLES_TOUT_OU_RIEN),
 * écrites sous le verrou consultatif de chaque ferme touchée (`ferme:<id>`), y compris pour un
 * PATCH d'un bâtiment ou de la ferme qui ne porte pas ferme_id dans ses données. Interblocage
 * (40P01) ou échec de sérialisation (40001) : erreur 5xx renvoyée au téléphone (PowerSync
 * réessaie), JAMAIS un refus définitif ; rien d'écrit, aucun refus enregistré.
 *
 * Historique : une ligne `modification` par ligne touchée, nom_table 'Batiment', 'Zone',
 * 'Emplacement' ou 'Ferme', auteur = utilisateur du jeton, operation 'creation',
 * 'modification' ou 'suppression'.
 *
 * Hors de ce fichier : la porte du téléphone (packages/sync/src/porte-placement.test.ts),
 * e2e:synchro (un bâtiment créé sur un navigateur apparaît sur le second).
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
const MAINTENANT = new Date('2026-10-07T06:00:00Z');

type TableLue = 'zone' | 'emplacement' | 'batiment' | 'ferme' | 'saison';
const TABLES_LUES: ReadonlySet<string> = new Set<TableLue>(['zone', 'emplacement', 'batiment', 'ferme', 'saison']);

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

interface Point {
  readonly x: number;
  readonly y: number;
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({
  horloge: () => tic++,
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const MOTIFS_DELETE = ['table_interdite', 'ajout_seul'];
const SUPPRIME_LE = '2026-10-07T06:30:00.000Z';
const DEBUT_INVALIDE = 'Saisie non enregistrée, données invalides : ';
/** Ce que dit tout refus de droits (Q31), après « : ». */
const SEUL_LE_GERANT = /: seul le gérant peut placer les éléments de la ferme\.$/iu;

/** Origine du plan de la ferme principale (exemple chiffré de la v1.x). */
const ORIGINE = { latitude: 44, longitude: 1.5 };

/** Rectangle de 20 m × 10 m, sens antihoraire (forme rangée en base). */
const CARRE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];
/** Le même, en sens horaire, tel qu'un écran peut l'envoyer. */
const CARRE_HORAIRE: readonly Point[] = [...CARRE].reverse();
/** Zone en L (exemple chiffré de la v1.x). */
const EN_L: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];
/** Nœud papillon : deux côtés se croisent. */
const PAPILLON: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];

/** Polygone régulier de `n` sommets (rayon 50 m), coordonnées arrondies au millimètre. */
function polygone(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: Math.round(50 * Math.cos(a) * 1000) / 1000, y: Math.round(50 * Math.sin(a) * 1000) / 1000 };
  });
}

const texte = (contour: readonly Point[]): string => JSON.stringify(contour);

decrireAvecBase('T28s')('T28s : POST /sync/upload accepte le placement réel du gérant', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  /** Gérant de la ferme principale et de la seconde ferme. */
  let theo: { id: string; jeton: string };
  /** Équipier (membre actif, non gérant) de la ferme principale, gérant de sa propre ferme. */
  let equipier: { id: string; jeton: string };
  /** Membre retiré de la ferme principale (était gérant). */
  let retire: { id: string; jeton: string };
  /** Invité (gérant) pas encore accepté de la ferme principale. */
  let invite: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;
  let fermeDeLEquipier: string;

  let zoneFerme: string;
  let zoneSeconde: string;
  let zoneVoisine: string;
  let plancheVoisine: string;
  let batimentVoisin: string;

  let compteur = 0;
  const unique = (prefixe: string): string => `${prefixe}-${String(++compteur)}`;

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, MAINTENANT);
  }

  async function requete(sqlTexte: string, valeurs: readonly unknown[] = []): Promise<void> {
    await base.pool.query(sqlTexte, [...valeurs]);
  }

  // ── Lignes écrites directement en base ──────────────────────────────────────────────────────

  async function nouvelleFerme(origine: { latitude: number; longitude: number } | null = null): Promise<string> {
    const f = await creerFerme(base.pool, unique('Ferme'));
    await ajouterMembre(base.pool, theo.id, f, { role: 'gerant' });
    if (origine !== null) await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify(origine)]);
    return f;
  }

  async function zoneEn(fermeId: string, o: { contour?: readonly Point[]; supprimee?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await requete(`INSERT INTO zone (id, ferme_id, nom, type_abri, contour, supprime_le) VALUES ($1, $2, $3, 'tunnel', $4::jsonb, $5)`, [
      id,
      fermeId,
      unique('Tunnel'),
      o.contour === undefined ? null : JSON.stringify(o.contour),
      o.supprimee === true ? MAINTENANT : null,
    ]);
    return id;
  }

  async function plancheEn(fermeId: string, zoneId: string, placement: { x: number; y: number; o: number } | null = null): Promise<string> {
    const id = randomUUID();
    await requete(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, placement_x_m, placement_y_m, orientation_deg)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5, $6, $7)`,
      [id, fermeId, zoneId, unique('P'), placement?.x ?? null, placement?.y ?? null, placement?.o ?? null],
    );
    return id;
  }

  async function batimentEn(fermeId: string, o: { zoneId?: string; supprime?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await requete(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, supprime_le)
       VALUES ($1, $2, $3, 'serre_tunnel', 40, 8, 3.5, 50, 30, 90, $4, $5)`,
      [id, fermeId, unique('Serre'), o.zoneId ?? null, o.supprime === true ? MAINTENANT : null],
    );
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t28s_placement');
    cles = { active: await genererCleSignature('cle-t28s'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site de Théophane');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    fermeDeLEquipier = await creerFerme(base.pool, 'Potager de l’équipier');
    const u = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    const i = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, u.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, e.id, fermeDeLEquipier, { role: 'gerant' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, r.id, ferme, { role: 'gerant', retire: true });
    await ajouterMembre(base.pool, i.id, ferme, { role: 'gerant', etat: 'invite', invitePar: u.id });
    theo = { id: u.id, jeton: await jetonPour(u.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
    invite = { id: i.id, jeton: await jetonPour(i.id) };
    for (const f of [ferme, secondeFerme, autreFerme, fermeDeLEquipier]) {
      await requete(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify(ORIGINE)]);
    }

    zoneFerme = await zoneEn(ferme);
    zoneSeconde = await zoneEn(secondeFerme);
    zoneVoisine = await zoneEn(autreFerme, { contour: CARRE });
    plancheVoisine = await plancheEn(autreFerme, zoneVoisine, { x: 2, y: 0, o: 0 });
    batimentVoisin = await batimentEn(autreFerme);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  // ── Envoi et lecture ────────────────────────────────────────────────────────────────────────

  function envoyer(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<Response> {
    return Promise.resolve(
      app.request('/sync/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
        body: JSON.stringify({ ecritures }),
      }),
    );
  }

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<ReponseUpload> {
    const res = await envoyer(ecritures, jeton);
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[], jeton: string = theo.jeton): Promise<void> {
    expect(await lot(ecritures, jeton)).toEqual({ refus: [] });
  }

  async function compter(sqlTexte: string, params: readonly unknown[]): Promise<number> {
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sqlTexte}) t`, [...params]);
    return r.rows[0]?.n ?? -1;
  }

  const modifications = (id: string) => compter(`SELECT 1 FROM modification WHERE ligne_id = $1`, [id]);

  async function ligne(table: TableLue, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  async function historique(id: string): Promise<{ ferme_id: string; nom_table: string; auteur_id: string; operation: string; avant: Ligne | null; apres: Ligne | null }[]> {
    const r = await base.pool.query<{ ferme_id: string; nom_table: string; auteur_id: string; operation: string; avant: Ligne | null; apres: Ligne | null }>(
      `SELECT ferme_id::text AS ferme_id, nom_table, auteur_id::text AS auteur_id, operation, avant, apres
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

  /** Le lot est refusé EN ENTIER : rien d'écrit ni changé, chaque écriture a son refus, la fautive son motif. */
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

  /** Refus 'ecriture_invalide' en entier, avec un message en français qui répond à `attendu`. */
  async function refuseAvecMessage(
    ecritures: readonly EcritureEnvoyee[],
    fautive: EcritureEnvoyee,
    attendu: RegExp,
    jeton: string = theo.jeton,
  ): Promise<string> {
    await refuseEnEntier(ecritures, fautive, 'ecriture_invalide', jeton);
    const message = await messageDe(fautive.id);
    expect(message.startsWith(DEBUT_INVALIDE), message).toBe(true);
    expect(message, `le message dit pourquoi : ${attendu.source}`).toMatch(attendu);
    return message;
  }

  // ── Écritures telles que le téléphone les envoie ────────────────────────────────────────────

  const putBatiment = (autres: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'batiment',
    id: nouvelId(),
    donnees: {
      ferme_id: fermeId,
      nom: unique('Serre M'),
      type: 'serre_tunnel',
      longueur_m: 40,
      largeur_m: 8,
      hauteur_m: 3.5,
      centre_x_m: 50,
      centre_y_m: 30,
      orientation_deg: 90,
      zone_id: null,
      ...autres,
    },
  });

  const putZone = (autres: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'zone',
    id: nouvelId(),
    donnees: { ferme_id: fermeId, nom: unique('Îlot'), zone_parente_id: null, type_abri: 'plein_champ', surface_m2: null, ...autres },
  });

  const putEmplacement = (zoneId: string, autres: Record<string, unknown> = {}, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'emplacement',
    id: nouvelId(),
    donnees: {
      ferme_id: fermeId,
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
    },
  });

  const putSaison = (): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'saison',
    id: nouvelId(),
    donnees: { ferme_id: ferme, nom: unique('Saison'), debut: '2027-01-01', fin: '2027-12-31' },
  });

  const patch = (table: string, id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table, id, donnees });
  const supprimer = (table: string, id: string): EcritureEnvoyee => patch(table, id, { supprime_le: SUPPRIME_LE });
  const origine = (fermeId: string, valeur: unknown): EcritureEnvoyee => patch('ferme', fermeId, { origine_plan: typeof valeur === 'string' ? valeur : JSON.stringify(valeur) });

  /** Un lot valide (zone + planche + saison) auquel on ajoute `fautive` à la fin. */
  function lotAvec(fautive: EcritureEnvoyee): EcritureEnvoyee[] {
    const z = putZone();
    return [z, putEmplacement(z.id), putSaison(), fautive];
  }

  const placementDe = async (id: string): Promise<unknown> => {
    const l = await ligne('emplacement', id);
    return l === null ? undefined : { x: l.placement_x_m, y: l.placement_y_m, o: l.orientation_deg };
  };

  // ── 1. Le gérant place : accepté ────────────────────────────────────────────────────────────

  describe('le gérant place sa ferme : accepté, historique', () => {
    it('PUT d’un bâtiment : écrit avec les valeurs reçues, historique « creation » au nom de Batiment', async () => {
      const b = putBatiment({ cree_le: '2020-01-01T00:00:00.000Z', modifie_le: '2020-01-01T00:00:00.000Z' });
      await accepte([b]);
      const l = await ligne('batiment', b.id);
      expect(l).toMatchObject({
        ferme_id: ferme,
        type: 'serre_tunnel',
        longueur_m: 40,
        largeur_m: 8,
        hauteur_m: 3.5,
        centre_x_m: 50,
        centre_y_m: 30,
        orientation_deg: 90,
        zone_id: null,
        supprime_le: null,
      });
      expect(String(l?.cree_le), 'cree_le rempli par le serveur').not.toContain('2020');
      const h = await historique(b.id);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ ferme_id: ferme, nom_table: 'Batiment', auteur_id: theo.id, operation: 'creation', avant: null });
      expect(h[0]?.apres).toMatchObject({ id: b.id, centre_x_m: 50 });
    });

    it.each([
      ['serre_chapelle'],
      ['hangar'],
      ['magasin'],
      ['autre'],
    ])('bâtiment de type %s : accepté', async (type) => {
      const b = putBatiment({ type, zone_id: null });
      await accepte([b]);
      expect((await ligne('batiment', b.id))?.type).toBe(type);
    });

    it('bornes comprises : 500 m × 200 m × 30 m, orientation 0 et 359,9, centre à 5 km pile', async () => {
      const b1 = putBatiment({ longueur_m: 500, largeur_m: 200, hauteur_m: 30, orientation_deg: 0, centre_x_m: 5000, centre_y_m: 0 });
      const b2 = putBatiment({ orientation_deg: 359.9, centre_x_m: -3000, centre_y_m: -4000 });
      await accepte([b1, b2]);
      expect(await ligne('batiment', b1.id)).not.toBeNull();
      expect(await ligne('batiment', b2.id)).not.toBeNull();
    });

    it('PATCH d’un bâtiment (déplacer, tourner) : modifié, historique « modification » avec avant et après', async () => {
      const b = putBatiment();
      await accepte([b]);
      await accepte([patch('batiment', b.id, { centre_x_m: 150, centre_y_m: 30, orientation_deg: 0 })]);
      expect(await ligne('batiment', b.id)).toMatchObject({ centre_x_m: 150, centre_y_m: 30, orientation_deg: 0, longueur_m: 40 });
      const h = await historique(b.id);
      expect(h.at(-1)).toMatchObject({ operation: 'modification', nom_table: 'Batiment', auteur_id: theo.id });
      expect(h.at(-1)?.avant).toMatchObject({ centre_x_m: 50, orientation_deg: 90 });
      expect(h.at(-1)?.apres).toMatchObject({ centre_x_m: 150, orientation_deg: 0 });
    });

    it('PUT d’une zone avec contour (texte JSON) : écrit en jsonb, historique « creation »', async () => {
      const z = putZone({ contour: texte(EN_L) });
      await accepte([z]);
      expect((await ligne('zone', z.id))?.contour).toEqual(EN_L);
      expect((await historique(z.id))[0]).toMatchObject({ nom_table: 'Zone', operation: 'creation' });
    });

    it('contour en sens horaire : rangé en sens antihoraire (validerContour)', async () => {
      const z = putZone({ contour: texte(CARRE_HORAIRE) });
      await accepte([z]);
      expect((await ligne('zone', z.id))?.contour).toEqual(CARRE);
    });

    it('sommets avec des clés en plus : seuls x et y sont rangés', async () => {
      const z = putZone({ contour: JSON.stringify(CARRE.map((p) => ({ ...p, note: 'piquet' }))) });
      await accepte([z]);
      expect((await ligne('zone', z.id))?.contour).toEqual(CARRE);
    });

    it('contour de 200 sommets : accepté (borne comprise)', async () => {
      const z = putZone({ contour: texte(polygone(200)) });
      await accepte([z]);
      expect(((await ligne('zone', z.id))?.contour as unknown[]).length).toBe(200);
    });

    it('PATCH du contour d’une zone (placer, puis redessiner, puis effacer) : modifié à chaque fois, historique', async () => {
      const z = await zoneEn(ferme);
      await accepte([patch('zone', z, { contour: texte(CARRE) })]);
      expect((await ligne('zone', z))?.contour).toEqual(CARRE);
      await accepte([patch('zone', z, { contour: texte(EN_L) })]);
      expect((await ligne('zone', z))?.contour).toEqual(EN_L);
      await accepte([patch('zone', z, { contour: null })]);
      expect((await ligne('zone', z))?.contour).toBeNull();
      const h = await historique(z);
      expect(h.map((l) => l.operation)).toEqual(['modification', 'modification', 'modification']);
      expect(h[0]?.avant).toMatchObject({ contour: null });
      expect(h[0]?.apres).toMatchObject({ contour: CARRE });
    });

    it('PUT d’un emplacement placé : écrit ; PATCH qui le déplace : modifié ; PATCH des trois à nul : rangement automatique', async () => {
      const p = putEmplacement(zoneFerme, { placement_x_m: 2, placement_y_m: -0.5, orientation_deg: 92.5 });
      await accepte([p]);
      expect(await placementDe(p.id)).toEqual({ x: 2, y: -0.5, o: 92.5 });
      await accepte([patch('emplacement', p.id, { placement_x_m: 4, placement_y_m: 0 })]);
      expect(await placementDe(p.id)).toEqual({ x: 4, y: 0, o: 92.5 });
      await accepte([patch('emplacement', p.id, { placement_x_m: null, placement_y_m: null, orientation_deg: null })]);
      expect(await placementDe(p.id)).toEqual({ x: null, y: null, o: null });
      const h = await historique(p.id);
      expect(h.map((l) => [l.nom_table, l.operation])).toEqual([
        ['Emplacement', 'creation'],
        ['Emplacement', 'modification'],
        ['Emplacement', 'modification'],
      ]);
    });

    it('placer une planche existante (PATCH des trois champs) : accepté', async () => {
      const e = await plancheEn(ferme, zoneFerme);
      await accepte([patch('emplacement', e, { placement_x_m: 2, placement_y_m: 0, orientation_deg: 0 })]);
      expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
    });

    it('serre qui abrite une zone créée dans le même lot, avec ses planches placées : tout est accepté', async () => {
      const z = putZone({ type_abri: 'tunnel' });
      const b = putBatiment({ zone_id: z.id });
      const p1 = putEmplacement(z.id, { placement_x_m: -2, placement_y_m: 0, orientation_deg: 0 });
      const p2 = putEmplacement(z.id, { placement_x_m: 2, placement_y_m: 0, orientation_deg: 0 });
      await accepte([z, b, p1, p2]);
      expect((await ligne('batiment', b.id))?.zone_id).toBe(z.id);
      expect(await placementDe(p2.id)).toEqual({ x: 2, y: 0, o: 0 });
    });

    it('rattacher une serre à une zone qui a un contour, en effaçant le contour plus haut dans le même lot (T28b) : accepté', async () => {
      const z = await zoneEn(ferme, { contour: CARRE });
      const b = putBatiment({ zone_id: z });
      await accepte([patch('zone', z, { contour: null }), b]);
      expect((await ligne('zone', z))?.contour).toBeNull();
      expect((await ligne('batiment', b.id))?.zone_id).toBe(z);
    });

    it('détacher une serre de sa zone (zone_id nul), puis donner un contour à la zone dans le même lot : accepté', async () => {
      const z = await zoneEn(ferme);
      const b = await batimentEn(ferme, { zoneId: z });
      await accepte([patch('batiment', b, { zone_id: null }), patch('zone', z, { contour: texte(CARRE) })]);
      expect((await ligne('batiment', b))?.zone_id).toBeNull();
      expect((await ligne('zone', z))?.contour).toEqual(CARRE);
    });

    it('suppression douce d’un bâtiment : supprime_le écrit, historique « suppression » ; rétablissement : accepté', async () => {
      const b = await batimentEn(ferme);
      await accepte([supprimer('batiment', b)]);
      expect((await ligne('batiment', b))?.supprime_le).not.toBeNull();
      expect((await historique(b)).at(-1)).toMatchObject({ operation: 'suppression', nom_table: 'Batiment' });
      await accepte([patch('batiment', b, { supprime_le: null })]);
      expect((await ligne('batiment', b))?.supprime_le).toBeNull();
    });

    it('une zone peut être abritée par un nouveau bâtiment quand l’ancien est supprimé (même lot)', async () => {
      const z = await zoneEn(ferme);
      const ancien = await batimentEn(ferme, { zoneId: z });
      const nouveau = putBatiment({ zone_id: z });
      await accepte([supprimer('batiment', ancien), nouveau]);
      expect((await ligne('batiment', nouveau.id))?.zone_id).toBe(z);
    });

    it('PATCH du nom d’une zone placée : accepté, contour inchangé', async () => {
      const z = await zoneEn(ferme, { contour: EN_L });
      await accepte([patch('zone', z, { nom: 'Îlot des asperges' })]);
      expect(await ligne('zone', z)).toMatchObject({ nom: 'Îlot des asperges', contour: EN_L });
    });
  });

  // ── 2. Renvois identiques : idempotents ─────────────────────────────────────────────────────

  describe('renvois identiques (réponse perdue) : acceptés, rien d’écrit en double', () => {
    it('PUT d’un bâtiment renvoyé : accepté, une seule ligne, un seul historique', async () => {
      const b = putBatiment();
      await accepte([b]);
      const avant = await ligne('batiment', b.id);
      await accepte([b]);
      expect(await ligne('batiment', b.id)).toEqual(avant);
      expect(await modifications(b.id)).toBe(1);
    });

    it('PUT d’un bâtiment avec le même id et d’autres valeurs : refusé, inchangé', async () => {
      const b = putBatiment();
      await accepte([b]);
      const autre: EcritureEnvoyee = { ...b, donnees: { ...b.donnees, centre_x_m: 70 } };
      await refuseEnEntier([autre], autre, 'ecriture_invalide');
      expect((await ligne('batiment', b.id))?.centre_x_m).toBe(50);
    });

    it('PATCH d’un bâtiment renvoyé : accepté, aucun historique de plus', async () => {
      const b = await batimentEn(ferme);
      const p = patch('batiment', b, { centre_x_m: 12.25, orientation_deg: 45 });
      await accepte([p]);
      const avant = await ligne('batiment', b);
      const n = await modifications(b);
      await accepte([p]);
      expect(await ligne('batiment', b)).toEqual(avant);
      expect(await modifications(b)).toBe(n);
    });

    it('PATCH du contour renvoyé, même en sens horaire (même forme une fois normalisée) : accepté, aucun historique de plus', async () => {
      const z = await zoneEn(ferme);
      await accepte([patch('zone', z, { contour: texte(CARRE) })]);
      const avant = await ligne('zone', z);
      const n = await modifications(z);
      await accepte([patch('zone', z, { contour: texte(CARRE) })]);
      await accepte([patch('zone', z, { contour: texte(CARRE_HORAIRE) })]);
      expect(await ligne('zone', z)).toEqual(avant);
      expect(await modifications(z)).toBe(n);
    });

    it('PUT d’une zone avec contour horaire renvoyé : accepté (identique une fois normalisé), un seul historique', async () => {
      const z = putZone({ contour: texte(CARRE_HORAIRE) });
      await accepte([z]);
      await accepte([z]);
      expect(await modifications(z.id)).toBe(1);
    });

    it('PATCH du placement d’une planche renvoyé : accepté, aucun historique de plus', async () => {
      const e = await plancheEn(ferme, zoneFerme);
      const p = patch('emplacement', e, { placement_x_m: 1.5, placement_y_m: 3, orientation_deg: 180 });
      await accepte([p]);
      const n = await modifications(e);
      await accepte([p]);
      expect(await modifications(e)).toBe(n);
    });

    it('origine renvoyée à l’identique alors qu’un placement existe : acceptée, aucun historique de plus', async () => {
      const f = await nouvelleFerme(ORIGINE);
      await batimentEn(f);
      const n = await modifications(f);
      await accepte([origine(f, ORIGINE)]);
      expect(await modifications(f)).toBe(n);
    });
  });

  // ── 3. Droits (Q31) : gérant seulement ──────────────────────────────────────────────────────

  describe('droits (Q31) : seul le gérant place les éléments de la ferme', () => {
    it.each([
      ['crée un bâtiment', () => putBatiment()],
      ['crée une zone avec un contour', () => putZone({ contour: texte(CARRE) })],
      ['crée une planche placée', () => putEmplacement(zoneFerme, { placement_x_m: 2, placement_y_m: 0, orientation_deg: 0 })],
    ])('un équipier qui %s : refusé avec le message du gérant, rien d’écrit', async (_cas, fabrique) => {
      const e = fabrique();
      await refuseAvecMessage([e], e, SEUL_LE_GERANT, equipier.jeton);
      expect(await ligne(e.table as TableLue, e.id)).toBeNull();
    });

    it('un équipier qui déplace une planche : refusé, placement inchangé', async () => {
      const e = await plancheEn(ferme, zoneFerme, { x: 2, y: 0, o: 0 });
      const p = patch('emplacement', e, { placement_x_m: 3 });
      await refuseAvecMessage([p], p, SEUL_LE_GERANT, equipier.jeton);
      expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
    });

    it('un équipier qui place une planche qui ne l’était pas : refusé', async () => {
      const e = await plancheEn(ferme, zoneFerme);
      const p = patch('emplacement', e, { placement_x_m: 2, placement_y_m: 0, orientation_deg: 0 });
      await refuseAvecMessage([p], p, SEUL_LE_GERANT, equipier.jeton);
      expect(await placementDe(e)).toEqual({ x: null, y: null, o: null });
    });

    it('un équipier qui efface le placement d’une planche : refusé', async () => {
      const e = await plancheEn(ferme, zoneFerme, { x: 2, y: 0, o: 0 });
      const p = patch('emplacement', e, { placement_x_m: null, placement_y_m: null, orientation_deg: null });
      await refuseAvecMessage([p], p, SEUL_LE_GERANT, equipier.jeton);
      expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
    });

    it('un équipier qui change le contour d’une zone, ou l’efface : refusé, contour inchangé', async () => {
      const z = await zoneEn(ferme, { contour: CARRE });
      const p = patch('zone', z, { contour: texte(EN_L) });
      await refuseAvecMessage([p], p, SEUL_LE_GERANT, equipier.jeton);
      const z2 = await zoneEn(ferme, { contour: CARRE });
      const p2 = patch('zone', z2, { contour: null });
      await refuseAvecMessage([p2], p2, SEUL_LE_GERANT, equipier.jeton);
      expect((await ligne('zone', z))?.contour).toEqual(CARRE);
      expect((await ligne('zone', z2))?.contour).toEqual(CARRE);
    });

    it.each([
      ['déplace', { centre_x_m: 60 }],
      ['renomme', { nom: 'Hangar du fond' }],
      ['supprime', { supprime_le: SUPPRIME_LE }],
      ['rattache à une zone', { zone_id: 'ZONE' }],
    ])('un équipier qui %s un bâtiment : refusé, inchangé', async (_cas, donnees) => {
      const b = await batimentEn(ferme);
      const z = await zoneEn(ferme);
      const d = Object.fromEntries(Object.entries(donnees).map(([c, v]) => [c, v === 'ZONE' ? z : v]));
      const p = patch('batiment', b, d);
      await refuseAvecMessage([p], p, SEUL_LE_GERANT, equipier.jeton);
    });

    it('un équipier qui pose l’origine du plan : refusé, origine inchangée', async () => {
      const f = await nouvelleFerme(null);
      await ajouterMembre(base.pool, equipier.id, f, { role: 'equipier' });
      const o = origine(f, ORIGINE);
      await refuseAvecMessage([o], o, SEUL_LE_GERANT, equipier.jeton);
      expect((await ligne('ferme', f))?.origine_plan).toBeNull();
    });

    it('le même envoi (bâtiment, planche déplacée, contour, origine) par le gérant : accepté', async () => {
      const f = await nouvelleFerme(null);
      const z = await zoneEn(f);
      const e = await plancheEn(f, z, { x: 2, y: 0, o: 0 });
      const zc = await zoneEn(f);
      const ecritures = [origine(f, ORIGINE), putBatiment({}, f), patch('emplacement', e, { placement_x_m: 3 }), patch('zone', zc, { contour: texte(CARRE) })];
      await accepte(ecritures);
      expect((await ligne('ferme', f))?.origine_plan).toEqual(ORIGINE);
      expect(await placementDe(e)).toEqual({ x: 3, y: 0, o: 0 });
      expect((await ligne('zone', zc))?.contour).toEqual(CARRE);
    });

    it('un équipier, au milieu d’un import valide : tout le lot est refusé (tout ou rien)', async () => {
      const b = putBatiment();
      const ecritures = lotAvec(b);
      await refuseAvecMessage(ecritures, b, SEUL_LE_GERANT, equipier.jeton);
      for (const e of ecritures) expect(await ligne(e.table as TableLue, e.id)).toBeNull();
    });

    it('gérant de SA ferme, équipier de celle-ci : le rôle est celui de la ferme visée, refusé', async () => {
      // Contrôle : dans sa propre ferme, il place.
      const chezLui = putBatiment({}, fermeDeLEquipier);
      await accepte([chezLui], equipier.jeton);
      const ici = putBatiment();
      await refuseAvecMessage([ici], ici, SEUL_LE_GERANT, equipier.jeton);
    });

    it('un lot qui touche sa ferme (gérant) et celle où il est équipier : refusé en entier', async () => {
      const chezLui = putBatiment({}, fermeDeLEquipier);
      const ici = patch('zone', await zoneEn(ferme), { contour: texte(CARRE) });
      await refuseEnEntier([chezLui, ici], ici, 'ecriture_invalide', equipier.jeton);
      expect(await ligne('batiment', chezLui.id)).toBeNull();
    });

    it('rôle relu à chaque lot : un gérant rétrogradé en équipier ne place plus', async () => {
      const u = await creerUtilisateur(base.pool);
      const f = await nouvelleFerme(ORIGINE);
      await ajouterMembre(base.pool, u.id, f, { role: 'gerant' });
      const jeton = await jetonPour(u.id);
      await accepte([putBatiment({}, f)], jeton);
      await requete(`UPDATE membre SET role = 'equipier' WHERE utilisateur_id = $1 AND ferme_id = $2`, [u.id, f]);
      const b = putBatiment({}, f);
      await refuseAvecMessage([b], b, SEUL_LE_GERANT, jeton);
    });

    describe('ce qui reste ouvert à tout membre actif (T10s)', () => {
      it('un équipier crée une zone sans contour et une planche sans placement : accepté', async () => {
        const z = putZone();
        const p = putEmplacement(z.id);
        await accepte([z, p], equipier.jeton);
        expect(await ligne('zone', z.id)).not.toBeNull();
        expect(await placementDe(p.id)).toEqual({ x: null, y: null, o: null });
      });

      it('un équipier crée une zone et une planche avec contour et placement explicitement nuls : accepté', async () => {
        const z = putZone({ contour: null });
        const p = putEmplacement(z.id, { placement_x_m: null, placement_y_m: null, orientation_deg: null });
        await accepte([z, p], equipier.jeton);
      });

      it('un équipier renomme une zone placée et change le code d’une planche placée : accepté, placement intact', async () => {
        const z = await zoneEn(ferme, { contour: CARRE });
        const e = await plancheEn(ferme, z, { x: 2, y: 0, o: 0 });
        await accepte([patch('zone', z, { nom: unique('Îlot') }), patch('emplacement', e, { code: unique('P-EQ') })], equipier.jeton);
        expect((await ligne('zone', z))?.contour).toEqual(CARRE);
        expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
      });
    });
  });

  // ── 4. Isolement entre fermes ───────────────────────────────────────────────────────────────

  describe('isolement : bâtiments', () => {
    it('PUT d’un bâtiment dans une ferme voisine : ferme_interdite, rien d’écrit', async () => {
      const b = putBatiment({}, autreFerme);
      await refuseEnEntier([b], b, 'ferme_interdite');
      expect(await ligne('batiment', b.id)).toBeNull();
    });

    it('PUT d’un bâtiment par un membre retiré, ou un invité pas encore accepté : ferme_interdite', async () => {
      for (const jeton of [retire.jeton, invite.jeton]) {
        const b = putBatiment();
        await refuseEnEntier([b], b, 'ferme_interdite', jeton);
        expect(await ligne('batiment', b.id)).toBeNull();
      }
    });

    it('PUT d’un bâtiment sans ferme_id : ecriture_invalide, rien d’écrit', async () => {
      const b = putBatiment({ ferme_id: null });
      await refuseEnEntier([b], b, 'ecriture_invalide');
      expect(await ligne('batiment', b.id)).toBeNull();
    });

    it.each([
      ['de la ferme voisine', () => zoneVoisine],
      ['de la seconde ferme du même utilisateur', () => zoneSeconde],
      ['introuvable', () => randomUUID()],
    ])('PUT d’un bâtiment qui abrite une zone %s : ecriture_invalide, rien d’écrit', async (_cas, zone) => {
      const b = putBatiment({ zone_id: zone() });
      await refuseEnEntier(lotAvec(b), b, 'ecriture_invalide');
      expect(await ligne('batiment', b.id)).toBeNull();
    });

    it('PUT d’un bâtiment qui abrite une zone supprimée : refusé', async () => {
      const z = await zoneEn(ferme, { supprimee: true });
      const b = putBatiment({ zone_id: z });
      await refuseEnEntier([b], b, 'ecriture_invalide');
    });

    it('PATCH qui rattache un bâtiment de la ferme à une zone voisine ou de la seconde ferme : refusé, inchangé', async () => {
      for (const z of [zoneVoisine, zoneSeconde]) {
        const b = await batimentEn(ferme);
        const p = patch('batiment', b, { zone_id: z });
        await refuseEnEntier([p], p, 'ecriture_invalide');
        expect((await ligne('batiment', b))?.zone_id).toBeNull();
      }
    });

    it.each([
      ['déplacer', { centre_x_m: 0 }],
      ['supprimer', { supprime_le: SUPPRIME_LE }],
      ['rattacher à une de mes zones', { zone_id: 'ZONE' }],
    ])('PATCH d’un bâtiment de la ferme voisine (%s) : comme une ligne introuvable, ferme nulle, inchangé', async (_cas, donnees) => {
      const avant = await ligne('batiment', batimentVoisin);
      const d = Object.fromEntries(Object.entries(donnees).map(([c, v]) => [c, v === 'ZONE' ? zoneFerme : v]));
      const p = patch('batiment', batimentVoisin, d);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('batiment', batimentVoisin)).toEqual(avant);
      expect((await refusSynchro(batimentVoisin)).at(-1)?.ferme_id, 'ferme nulle (T10d)').toBeNull();
    });

    it('PUT qui reprend l’id d’un bâtiment voisin : refusé, le bâtiment voisin ne change pas', async () => {
      const avant = await ligne('batiment', batimentVoisin);
      const b: EcritureEnvoyee = { ...putBatiment(), id: batimentVoisin };
      await refuseEnEntier([b], b, 'ecriture_invalide');
      expect(await ligne('batiment', batimentVoisin)).toEqual(avant);
      expect((await refusSynchro(batimentVoisin)).at(-1)?.ferme_id).toBeNull();
    });

    it.each([
      ['vers la ferme voisine', (): string | null => autreFerme, ['ecriture_invalide', 'ferme_interdite']],
      ['vers la seconde ferme du même utilisateur', (): string | null => secondeFerme, ['ecriture_invalide']],
      ['vers nulle part', (): string | null => null, ['ecriture_invalide']],
    ] as const)('PATCH de ferme_id d’un bâtiment %s : refusé, rien ne change', async (_cas, cible, motifs) => {
      const b = await batimentEn(ferme);
      const p = patch('batiment', b, { ferme_id: cible() });
      await refuseEnEntier([p], p, motifs);
      expect((await ligne('batiment', b))?.ferme_id).toBe(ferme);
    });

    it('DELETE d’un bâtiment de la ferme : refusé (suppression douce seulement), rien ne change', async () => {
      const b = await batimentEn(ferme);
      const d: EcritureEnvoyee = { op: 'DELETE', table: 'batiment', id: b };
      await refuseEnEntier([d], d, MOTIFS_DELETE);
      expect(await ligne('batiment', b)).not.toBeNull();
    });

    it('rétablir un bâtiment dont la zone a été supprimée : refusé', async () => {
      const z = await zoneEn(ferme);
      const b = await batimentEn(ferme, { zoneId: z, supprime: true });
      await requete(`UPDATE zone SET supprime_le = $2 WHERE id = $1`, [z, MAINTENANT]);
      const p = patch('batiment', b, { supprime_le: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
    });
  });

  describe('isolement : zones, planches et ferme', () => {
    it('PATCH du contour d’une zone voisine : comme une ligne introuvable, inchangé', async () => {
      const avant = await ligne('zone', zoneVoisine);
      const p = patch('zone', zoneVoisine, { contour: texte(EN_L) });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('zone', zoneVoisine)).toEqual(avant);
      expect((await refusSynchro(zoneVoisine)).at(-1)?.ferme_id).toBeNull();
    });

    it('PATCH du placement d’une planche voisine : comme une ligne introuvable, inchangé', async () => {
      const avant = await ligne('emplacement', plancheVoisine);
      const p = patch('emplacement', plancheVoisine, { placement_x_m: 9, placement_y_m: 9, orientation_deg: 9 });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await ligne('emplacement', plancheVoisine)).toEqual(avant);
    });

    it.each([
      ['nom', { nom: 'Ferme renommée' }],
      ['position (météo)', { position: JSON.stringify({ latitude: 45, longitude: 2 }) }],
      ['fuseau horaire', { fuseau_horaire: 'America/Cayenne' }],
      ['unités', { unites: JSON.stringify({ longueur: 'ft', masse: 'lb' }) }],
      ['suppression', { supprime_le: SUPPRIME_LE }],
      ['id glissé', { id: randomUUID() }],
      ['origine ET nom', { origine_plan: JSON.stringify(ORIGINE), nom: 'Ferme renommée' }],
    ])('PATCH de ferme : %s → ecriture_invalide, la ferme ne change pas', async (_cas, donnees) => {
      const f = await nouvelleFerme(null);
      const p = patch('ferme', f, donnees);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect(await modifications(f)).toBe(0);
    });

    it('PUT d’une ferme : table_interdite, rien d’écrit', async () => {
      const id = nouvelId();
      const r = await lot([{ op: 'PUT', table: 'ferme', id, donnees: { nom: 'Nouvelle', fuseau_horaire: 'Europe/Paris', origine_plan: JSON.stringify(ORIGINE) } }]);
      expect(motifDe(r, id)).toBe('table_interdite');
      expect(await ligne('ferme', id)).toBeNull();
    });

    it('DELETE d’une ferme : table_interdite, la ferme reste', async () => {
      const f = await nouvelleFerme(null);
      const r = await lot([{ op: 'DELETE', table: 'ferme', id: f }]);
      expect(motifDe(r, f)).toBe('table_interdite');
      expect(await ligne('ferme', f)).not.toBeNull();
    });

    it('origine d’une ferme voisine : comme une ligne introuvable, ferme nulle, inchangée', async () => {
      const f = await creerFerme(base.pool, unique('Voisine'));
      const p = origine(f, ORIGINE);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect((await ligne('ferme', f))?.origine_plan).toBeNull();
      expect((await refusSynchro(f)).at(-1)?.ferme_id).toBeNull();
    });

    it('origine posée par un membre retiré, ou un invité pas encore accepté : refusée, inchangée', async () => {
      const f = await nouvelleFerme(null);
      await ajouterMembre(base.pool, retire.id, f, { role: 'gerant', retire: true });
      await ajouterMembre(base.pool, invite.id, f, { role: 'gerant', etat: 'invite', invitePar: theo.id });
      for (const jeton of [retire.jeton, invite.jeton]) {
        const p = origine(f, ORIGINE);
        await refuseEnEntier([p], p, ['ecriture_invalide', 'ferme_interdite'], jeton);
      }
      expect((await ligne('ferme', f))?.origine_plan).toBeNull();
    });
  });

  // ── 5. Origine du plan (Q31) : figée après le premier placement ─────────────────────────────

  describe('origine du plan : posée une fois, figée dès qu’un placement existe', () => {
    it('origine nulle : posée, historique « modification » au nom de Ferme', async () => {
      const f = await nouvelleFerme(null);
      await accepte([origine(f, ORIGINE)]);
      expect((await ligne('ferme', f))?.origine_plan).toEqual(ORIGINE);
      const h = await historique(f);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ ferme_id: f, nom_table: 'Ferme', operation: 'modification', auteur_id: theo.id });
      expect(h[0]?.avant).toMatchObject({ origine_plan: null });
      expect(h[0]?.apres).toMatchObject({ origine_plan: ORIGINE });
    });

    it('origine posée, aucun placement encore : elle se déplace', async () => {
      const f = await nouvelleFerme(ORIGINE);
      await zoneEn(f);
      await plancheEn(f, await zoneEn(f));
      await accepte([origine(f, { latitude: 44.001, longitude: 1.502 })]);
      expect((await ligne('ferme', f))?.origine_plan).toEqual({ latitude: 44.001, longitude: 1.502 });
    });

    it.each([
      ['un bâtiment', async (f: string) => batimentEn(f)],
      ['une zone avec contour', async (f: string) => zoneEn(f, { contour: CARRE })],
      ['une planche placée', async (f: string) => plancheEn(f, await zoneEn(f), { x: 1, y: 1, o: 0 })],
    ])('déplacer l’origine alors que la ferme a %s : refusé, origine inchangée', async (_cas, placer) => {
      const f = await nouvelleFerme(ORIGINE);
      await placer(f);
      const p = origine(f, { latitude: 44.5, longitude: 1.5 });
      await refuseAvecMessage([p], p, /origine|point de départ/iu);
      expect((await ligne('ferme', f))?.origine_plan).toEqual(ORIGINE);
    });

    it('effacer l’origine (nulle) alors qu’un placement existe : refusé', async () => {
      const f = await nouvelleFerme(ORIGINE);
      await batimentEn(f);
      const p = patch('ferme', f, { origine_plan: null });
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect((await ligne('ferme', f))?.origine_plan).toEqual(ORIGINE);
    });

    it('origine nulle alors que des placements existent (écrits avant T28s) : posée', async () => {
      const f = await nouvelleFerme(null);
      await batimentEn(f);
      await accepte([origine(f, ORIGINE)]);
      expect((await ligne('ferme', f))?.origine_plan).toEqual(ORIGINE);
    });

    it('le placement d’une AUTRE ferme ne fige pas celle-ci', async () => {
      const f = await nouvelleFerme(ORIGINE);
      await accepte([origine(f, { latitude: 43, longitude: 1 })]);
    });

    it('même lot, dans l’ordre : origine puis premier bâtiment → accepté ; bâtiment puis nouvelle origine → refusé', async () => {
      const f = await nouvelleFerme(null);
      await accepte([origine(f, ORIGINE), putBatiment({}, f)]);
      const f2 = await nouvelleFerme(ORIGINE);
      const b = putBatiment({}, f2);
      const o = origine(f2, { latitude: 45, longitude: 2 });
      await refuseEnEntier([b, o], o, 'ecriture_invalide');
      expect(await ligne('batiment', b.id)).toBeNull();
      expect((await ligne('ferme', f2))?.origine_plan).toEqual(ORIGINE);
    });

    it.each([
      ['latitude hors du globe', JSON.stringify({ latitude: 95, longitude: 1.5 })],
      ['longitude hors du globe', JSON.stringify({ latitude: 44, longitude: 181 })],
      ['sans longitude', JSON.stringify({ latitude: 44 })],
      ['coordonnées en texte', JSON.stringify({ latitude: '44', longitude: '1.5' })],
      ['une liste', JSON.stringify([44, 1.5])],
      ['texte illisible', '{latitude: 44'],
    ])('origine invalide (%s) : refusée, inchangée', async (_cas, valeur) => {
      const f = await nouvelleFerme(null);
      const p = origine(f, valeur);
      await refuseEnEntier([p], p, 'ecriture_invalide');
      expect((await ligne('ferme', f))?.origine_plan).toBeNull();
    });
  });

  // ── 6. Validation : validerPlacement et validerContour rejoués ──────────────────────────────

  describe('validation : un placement invalide fait refuser tout le lot, message clair', () => {
    it.each([
      ['bâtiment sans hauteur (champs à moitié remplis)', () => putBatiment({ hauteur_m: null }), /manque|hauteur/iu],
      ['bâtiment sans centre', () => putBatiment({ centre_y_m: null }), /manque|position/iu],
      ['bâtiment orienté à 360°', () => putBatiment({ orientation_deg: 360 }), /orientation/iu],
      ['bâtiment orienté à -1°', () => putBatiment({ orientation_deg: -1 }), /orientation/iu],
      ['bâtiment à 6 km de l’origine', () => putBatiment({ centre_x_m: 6000, centre_y_m: 0 }), /5 km/iu],
      ['bâtiment de 501 m de long', () => putBatiment({ longueur_m: 501 }), /longueur|500/iu],
      ['bâtiment de 201 m de large', () => putBatiment({ largeur_m: 201 }), /largeur|200/iu],
      ['bâtiment de 31 m de haut', () => putBatiment({ hauteur_m: 31 }), /hauteur|30/iu],
      ['bâtiment de hauteur nulle', () => putBatiment({ hauteur_m: 0 }), /hauteur|zéro|positi/iu],
      ['bâtiment de longueur en texte', () => putBatiment({ longueur_m: '40' }), /longueur|forme|nombre/iu],
      ['bâtiment d’un type inconnu', () => putBatiment({ type: 'chateau' }), /type|forme|inconnu/iu],
      ['bâtiment sans nom', () => putBatiment({ nom: '  ' }), /nom|manque/iu],
      ['bâtiment au nom démesuré', () => putBatiment({ nom: 'S'.repeat(10_000) }), /nom|long/iu],
      ['bâtiment créé déjà supprimé', () => putBatiment({ supprime_le: SUPPRIME_LE }), /supprim/iu],
      ['bâtiment avec une colonne inconnue', () => putBatiment({ couleur: 'verte' }), /information/iu],
      ['planche à moitié placée', () => putEmplacement(zoneFerme, { placement_x_m: 2, placement_y_m: 0 }), /incomplet|manque/iu],
      ['planche orientée à 360°', () => putEmplacement(zoneFerme, { placement_x_m: 2, placement_y_m: 0, orientation_deg: 360 }), /orientation/iu],
      ['planche à 6 km du centre de sa zone', () => putEmplacement(zoneFerme, { placement_x_m: 6000, placement_y_m: 0, orientation_deg: 0 }), /5 km/iu],
      ['planche placée en texte', () => putEmplacement(zoneFerme, { placement_x_m: '2', placement_y_m: 0, orientation_deg: 0 }), /position|nombre|forme/iu],
      ['contour auto-intersectant (nœud papillon)', () => putZone({ contour: texte(PAPILLON) }), /recoupe|crois/iu],
      ['contour de 2 sommets', () => putZone({ contour: texte(CARRE.slice(0, 2)) }), /sommets/iu],
      ['contour de 201 sommets', () => putZone({ contour: texte(polygone(201)) }), /sommets/iu],
      ['contour fermé (premier sommet répété)', () => putZone({ contour: texte([...CARRE, CARRE[0] ?? { x: 0, y: 0 }]) }), /confondu|premier/iu],
      ['contour aux sommets alignés', () => putZone({ contour: texte([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]) }), /surface|recoupe/iu],
      ['contour à 6 km de l’origine', () => putZone({ contour: texte(CARRE.map((p) => ({ x: p.x + 6000, y: p.y }))) }), /5 km/iu],
      ['contour aux coordonnées en texte', () => putZone({ contour: JSON.stringify(CARRE.map((p) => ({ x: String(p.x), y: p.y }))) }), /coordonn|sommet/iu],
      ['contour illisible', () => putZone({ contour: '[{"x": 0, "y": 0}, {"x"' }), /contour|illisible/iu],
      ['contour qui n’est pas une liste', () => putZone({ contour: JSON.stringify({ x: 0, y: 0 }) }), /contour|liste/iu],
    ])('%s : ecriture_invalide, rien du lot n’est écrit', async (_cas, fabrique, attendu) => {
      const fautive = fabrique();
      const ecritures = lotAvec(fautive);
      await refuseAvecMessage(ecritures, fautive, attendu);
      for (const e of ecritures) expect(await ligne(e.table as TableLue, e.id), `${e.table} non écrite`).toBeNull();
      for (const e of ecritures.slice(0, -1)) await messageDe(e.id);
    });

    it('PATCH qui rend un bâtiment invalide (orientation 360) : refusé, inchangé', async () => {
      const b = await batimentEn(ferme);
      const p = patch('batiment', b, { orientation_deg: 360 });
      await refuseAvecMessage([p], p, /orientation/iu);
      expect((await ligne('batiment', b))?.orientation_deg).toBe(90);
    });

    it('PATCH d’une seule coordonnée sur une planche non placée (ligne complète à moitié remplie) : refusé', async () => {
      const e = await plancheEn(ferme, zoneFerme);
      const p = patch('emplacement', e, { placement_x_m: 2 });
      await refuseAvecMessage([p], p, /incomplet|manque/iu);
      expect(await placementDe(e)).toEqual({ x: null, y: null, o: null });
    });

    it('PATCH qui efface une seule coordonnée d’une planche placée : refusé', async () => {
      const e = await plancheEn(ferme, zoneFerme, { x: 2, y: 0, o: 0 });
      const p = patch('emplacement', e, { orientation_deg: null });
      await refuseAvecMessage([p], p, /incomplet|manque/iu);
      expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
    });

    it('PATCH d’un contour auto-intersectant sur une zone placée : refusé, contour inchangé', async () => {
      const z = await zoneEn(ferme, { contour: CARRE });
      const p = patch('zone', z, { contour: texte(PAPILLON) });
      await refuseAvecMessage([p], p, /recoupe|crois/iu);
      expect((await ligne('zone', z))?.contour).toEqual(CARRE);
    });

    describe('taille bornée avant analyse', () => {
      it('contour valide de plus de 16 384 caractères de texte (blancs compris) : refusé', async () => {
        const brut = texte(CARRE);
        const gros = `${brut.slice(0, -1)}${' '.repeat(16_385 - brut.length)}]`;
        expect(gros.length).toBe(16_385);
        expect(JSON.parse(gros)).toEqual(CARRE);
        const z = putZone({ contour: gros });
        await refuseAvecMessage(lotAvec(z), z, /contour|volumineu|long/iu);
        expect(await ligne('zone', z.id)).toBeNull();
      });

      it('contour de 16 384 caractères pile (blancs compris) : accepté', async () => {
        const brut = texte(CARRE);
        const juste = `${brut.slice(0, -1)}${' '.repeat(16_384 - brut.length)}]`;
        expect(juste.length).toBe(16_384);
        const z = putZone({ contour: juste });
        await accepte([z]);
        expect((await ligne('zone', z.id))?.contour).toEqual(CARRE);
      });

      it('contour forgé en tableau de 100 000 sommets (pas un texte) : refusé vite, rien d’écrit', async () => {
        const z = putZone({ contour: Array.from({ length: 100_000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) })) });
        const debut = performance.now();
        await refuseEnEntier([z], z, 'ecriture_invalide');
        expect(performance.now() - debut, 'refusé sans parcourir 100 000 sommets en géométrie').toBeLessThan(5_000);
        expect(await ligne('zone', z.id)).toBeNull();
      });

      it('contour texte de 5 000 sommets (sous 6 Mio, au-delà de 16 Kio) : refusé', async () => {
        const z = putZone({ contour: texte(polygone(5_000)) });
        await refuseEnEntier([z], z, 'ecriture_invalide');
      });
    });

    describe('serre et zone : une zone abritée n’a pas de contour, un bâtiment par zone', () => {
      it('contour posé sur une zone abritée par un bâtiment : refusé, message qui le dit', async () => {
        const z = await zoneEn(ferme);
        await batimentEn(ferme, { zoneId: z });
        const p = patch('zone', z, { contour: texte(CARRE) });
        await refuseAvecMessage([p], p, /abrit/iu);
        expect((await ligne('zone', z))?.contour).toBeNull();
      });

      it('contour posé sur une zone abritée par un bâtiment créé plus haut dans le même lot : refusé, rien d’écrit', async () => {
        const z = await zoneEn(ferme);
        const b = putBatiment({ zone_id: z });
        const p = patch('zone', z, { contour: texte(CARRE) });
        await refuseAvecMessage([b, p], p, /abrit/iu);
        expect(await ligne('batiment', b.id)).toBeNull();
      });

      it('bâtiment rattaché à une zone qui a un contour (sans l’effacer) : refusé, message qui parle du contour', async () => {
        const z = await zoneEn(ferme, { contour: CARRE });
        const b = putBatiment({ zone_id: z });
        await refuseAvecMessage([b], b, /contour/iu);
        expect(await ligne('batiment', b.id)).toBeNull();
      });

      it('second bâtiment non supprimé sur la même zone : refusé, message clair', async () => {
        const z = await zoneEn(ferme);
        await batimentEn(ferme, { zoneId: z });
        const b = putBatiment({ zone_id: z });
        await refuseAvecMessage([b], b, /bâtiment|abrit/iu);
        expect(await ligne('batiment', b.id)).toBeNull();
      });

      it('deux bâtiments sur la même zone dans le même lot : refusé en entier', async () => {
        const z = await zoneEn(ferme);
        const b1 = putBatiment({ zone_id: z });
        const b2 = putBatiment({ zone_id: z });
        await refuseEnEntier([b1, b2], b2, 'ecriture_invalide');
        expect(await ligne('batiment', b1.id)).toBeNull();
      });

      it('rétablir un bâtiment sur une zone abritée depuis par un autre : refusé', async () => {
        const z = await zoneEn(ferme);
        const ancien = await batimentEn(ferme, { zoneId: z, supprime: true });
        await batimentEn(ferme, { zoneId: z });
        const p = patch('batiment', ancien, { supprime_le: null });
        await refuseEnEntier([p], p, 'ecriture_invalide');
      });

      it('un bâtiment supprimé n’abrite plus : la zone reçoit un contour', async () => {
        const z = await zoneEn(ferme);
        await batimentEn(ferme, { zoneId: z, supprime: true });
        await accepte([patch('zone', z, { contour: texte(CARRE) })]);
      });
    });
  });

  // ── 7. Suppression d'une zone abritée (relecture T28a n°2) ──────────────────────────────────

  describe('suppression d’une zone abritée, ou du bâtiment d’une zone', () => {
    it('zone abritée par un bâtiment non supprimé : suppression refusée, message qui parle du bâtiment, inchangée', async () => {
      const z = await zoneEn(ferme);
      const b = await batimentEn(ferme, { zoneId: z });
      const p = supprimer('zone', z);
      await refuseAvecMessage([p], p, /bâtiment/iu);
      expect((await ligne('zone', z))?.supprime_le).toBeNull();
      expect((await ligne('batiment', b))?.zone_id).toBe(z);
    });

    it('même refus pour un équipier (la règle vaut pour tous)', async () => {
      const z = await zoneEn(ferme);
      await batimentEn(ferme, { zoneId: z });
      const p = supprimer('zone', z);
      await refuseEnEntier([p], p, 'ecriture_invalide', equipier.jeton);
      expect((await ligne('zone', z))?.supprime_le).toBeNull();
    });

    it('bâtiment supprimé plus haut dans le même lot, puis la zone : accepté', async () => {
      const z = await zoneEn(ferme);
      const b = await batimentEn(ferme, { zoneId: z });
      await accepte([supprimer('batiment', b), supprimer('zone', z)]);
      expect((await ligne('zone', z))?.supprime_le).not.toBeNull();
    });

    it('bâtiment détaché (zone_id nul) plus haut dans le même lot, puis la zone : accepté, le bâtiment reste', async () => {
      const z = await zoneEn(ferme);
      const b = await batimentEn(ferme, { zoneId: z });
      await accepte([patch('batiment', b, { zone_id: null }), supprimer('zone', z)]);
      expect(await ligne('batiment', b)).toMatchObject({ zone_id: null, supprime_le: null });
    });

    it('zone dont le seul bâtiment est déjà supprimé : suppression acceptée', async () => {
      const z = await zoneEn(ferme);
      await batimentEn(ferme, { zoneId: z, supprime: true });
      await accepte([supprimer('zone', z)]);
    });

    it('supprimer le bâtiment d’une zone : accepté, la zone et ses planches ne changent pas', async () => {
      const z = await zoneEn(ferme);
      const e = await plancheEn(ferme, z, { x: 2, y: 0, o: 0 });
      const b = await batimentEn(ferme, { zoneId: z });
      const zoneAvant = await ligne('zone', z);
      await accepte([supprimer('batiment', b)]);
      expect(await ligne('zone', z)).toEqual(zoneAvant);
      expect(await placementDe(e)).toEqual({ x: 2, y: 0, o: 0 });
    });
  });

  // ── 8. Tout ou rien, verrou par ferme, interblocage ─────────────────────────────────────────

  describe('tout ou rien et concurrence', () => {
    it('un bâtiment valide et un contour invalide dans le même lot : rien n’est écrit', async () => {
      const b = putBatiment();
      const z = putZone({ contour: texte(PAPILLON) });
      await refuseEnEntier([b, z], z, 'ecriture_invalide');
      expect(await ligne('batiment', b.id)).toBeNull();
    });

    it('une origine valide et un bâtiment invalide : l’origine n’est pas posée', async () => {
      const f = await nouvelleFerme(null);
      const o = origine(f, ORIGINE);
      const b = putBatiment({ orientation_deg: 360 }, f);
      await refuseEnEntier([o, b], b, 'ecriture_invalide');
      expect((await ligne('ferme', f))?.origine_plan).toBeNull();
    });

    it('un événement dans un lot de placement refusé : refusé avec lui', async () => {
      const b = putBatiment({ type: 'chateau' });
      const planche = await plancheEn(ferme, zoneFerme);
      const ev: EcritureEnvoyee = {
        op: 'PUT',
        table: 'evenement',
        id: nouvelId(),
        donnees: {
          ferme_id: ferme,
          type: 'observation',
          date: '2026-10-07',
          horodatage: '2026-10-07T05:58:00.000Z',
          auteur_id: theo.id,
          source: 'tap',
          serie_id: null,
          campagne_id: null,
          emplacement_ids: JSON.stringify([planche]),
          note: 'Bâche abîmée',
          photos: '[]',
          remplace_sorte: null,
          remplace_evenement_id: null,
          detail: JSON.stringify({ nature: 'ravageur', gravite: null }),
        },
      };
      const r = await lot([ev, b]);
      expect(motifDe(r, b.id)).toBe('ecriture_invalide');
      expect(motifDe(r, ev.id)).toBe('ecriture_invalide');
      expect(await compter(`SELECT 1 FROM evenement WHERE id = $1`, [ev.id])).toBe(0);
    });

    /**
     * Prend le verrou consultatif de la ferme sur une autre connexion, envoie `ecritures`, et
     * vérifie que l'envoi attend la fin de ce verrou (écriture sous le verrou de la ferme).
     */
    async function attendLeVerrou(fermeId: string, ecritures: readonly EcritureEnvoyee[]): Promise<void> {
      const client = await base.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ferme:${fermeId}`]);
        let fini = false;
        const envoi = envoyer(ecritures, theo.jeton).then((res) => {
          fini = true;
          return res;
        });
        await new Promise((r) => setTimeout(r, 400));
        expect(fini, 'l’envoi attend le verrou de la ferme').toBe(false);
        await client.query('COMMIT');
        const res = await envoi;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ refus: [] });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    it('PUT d’un bâtiment : écrit sous le verrou de sa ferme', async () => {
      await attendLeVerrou(ferme, [putBatiment()]);
    });

    it('PATCH d’un bâtiment sans ferme_id dans les données : écrit sous le verrou de la ferme de la ligne', async () => {
      const b = await batimentEn(ferme);
      await attendLeVerrou(ferme, [patch('batiment', b, { centre_x_m: 33 })]);
      expect((await ligne('batiment', b))?.centre_x_m).toBe(33);
    });

    it('PATCH de l’origine : écrit sous le verrou de la ferme', async () => {
      const f = await nouvelleFerme(null);
      await attendLeVerrou(f, [origine(f, ORIGINE)]);
    });

    it('PATCH du contour d’une zone : écrit sous le verrou de la ferme', async () => {
      const z = await zoneEn(ferme);
      await attendLeVerrou(ferme, [patch('zone', z, { contour: texte(CARRE) })]);
    });

    it.each([
      ['interblocage (40P01)', '40P01'],
      ['échec de sérialisation (40001)', '40001'],
    ])('%s pendant l’écriture d’un bâtiment : erreur 5xx à réessayer, jamais un refus, rien d’écrit', async (_cas, code) => {
      const nom = unique('Interblocage simulé');
      const fonction = `t28s_simuler_${code.toLowerCase()}`;
      await requete(
        `CREATE FUNCTION ${fonction}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.nom = '${nom}' THEN RAISE EXCEPTION 'simulé' USING ERRCODE = '${code}'; END IF;
           RETURN NEW;
         END; $$`,
      );
      await requete(`CREATE TRIGGER ${fonction} BEFORE INSERT OR UPDATE ON batiment FOR EACH ROW EXECUTE FUNCTION ${fonction}()`);
      try {
        const b = putBatiment({ nom });
        const z = putZone();
        const res = await envoyer([z, b], theo.jeton);
        expect(res.status, 'PowerSync réessaie le lot plus tard').toBeGreaterThanOrEqual(500);
        expect(await ligne('batiment', b.id)).toBeNull();
        expect(await ligne('zone', z.id)).toBeNull();
        expect(await refusSynchro(b.id), 'aucun refus définitif').toEqual([]);
        expect(await refusSynchro(z.id)).toEqual([]);
      } finally {
        await requete(`DROP TRIGGER IF EXISTS ${fonction} ON batiment`);
        await requete(`DROP FUNCTION IF EXISTS ${fonction}()`);
      }
    });
  });
});
