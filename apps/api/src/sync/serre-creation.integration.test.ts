/**
 * Tests d'acceptation T89 — POST /sync/upload accepte l'enregistrement unique d'une serre créée par la fiche « Serre ou tunnel »
 * (docs/backlog/T89-ajouter-serre.md, règle 4), contre un vrai Postgres (DATABASE_URL, base jetable : sautés sans, échec en CI sans).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Aucune route nouvelle. Le téléphone envoie, en UN lot et dans cet ordre, ce que `porte.placer` vient d'écrire en local
 * (packages/sync/src/placement-creation.test.ts) : PUT zone (la serre), PUT sous-zones (zone_parente_id = la zone), PUT emplacements
 * (planches P1…Pn, placées : placement_x_m, placement_y_m, orientation_deg), PUT batiment (zone_id = la zone, grille T88). Le serveur
 * rejoue les contrôles de structure.ts / structure-origine.ts ligne à ligne, lot refusé en entier :
 *   - gérant seulement dès qu'un emplacement est placé ou qu'un bâtiment est écrit (Q31) ;
 *   - une zone parente, une zone d'emplacement, une zone abritée d'une AUTRE ferme : refus ;
 *   - un PUT dont l'identifiant est celui d'une ligne d'une autre ferme : refus, la ligne de l'autre ferme n'est pas modifiée ;
 *   - code d'emplacement unique par zone ; l'annulation (suppression douce) retire les emplacements avant leur zone.
 * Ces tests décrivent le comportement que le serveur doit déjà avoir : s'ils sont verts d'emblée, c'est une garde contre une régression,
 * pas un défaut du test. S'ils sont rouges, le développeur corrige apps/api/src/sync/ (ticket critique : le signaler au chef).
 * NON EXÉCUTÉS à l'écriture (pas de Postgres dans le conteneur du testeur).
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
const MAINTENANT = new Date('2026-10-30T06:00:00Z');

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

decrireAvecBase('T89')('T89 : une serre créée par la fiche dans POST /sync/upload', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let ferme: string;
  let fermeVoisine: string;
  let zoneVoisine: string;
  let compteur = 0;
  const unique = (p: string): string => `${p}-${String(++compteur)}`;
  const jetonPour = (id: string): Promise<string> => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  async function envoyer(ecritures: readonly EcritureEnvoyee[], jeton: string): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }
  const accepte = async (ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<void> => {
    expect(await envoyer(ecritures, jeton)).toEqual({ refus: [] });
  };
  /** Lot refusé en entier : chaque écriture du lot est dans les refus. */
  const refuse = async (ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<void> => {
    const reponse = await envoyer(ecritures, jeton);
    for (const e of ecritures) expect(reponse.refus.some((r) => r.id === e.id), `${e.table} ${e.id} refusé (tout ou rien)`).toBe(true);
  };
  const existe = async (table: string, id: string): Promise<boolean> => (await base.pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;
  const enService = async (table: string, id: string): Promise<boolean> =>
    (await base.pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND supprime_le IS NULL`, [id])).rowCount === 1;

  const putZone = (nom: string, parente: string | null, fermeId: string = ferme, id: string = nouvelId()): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'zone',
    id,
    donnees: { ferme_id: fermeId, nom, zone_parente_id: parente, type_abri: 'tunnel', surface_m2: null },
  });
  const putPlanche = (zoneId: string, code: string, fermeId: string = ferme, placee = true, id: string = nouvelId()): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'emplacement',
    id,
    donnees: {
      ferme_id: fermeId,
      zone_id: zoneId,
      code,
      sorte: 'planche',
      longueur_m: 38,
      largeur_m: 0.75,
      nombre_places: null,
      actif_du: '2026-10-30',
      actif_au: null,
      remplace: '[]',
      placement_x_m: placee ? 0.375 : null,
      placement_y_m: placee ? 0 : null,
      orientation_deg: placee ? 0 : null,
    },
  });
  const putSerre = (zoneId: string | null, fermeId: string = ferme): EcritureEnvoyee => ({
    op: 'PUT',
    table: 'batiment',
    id: nouvelId(),
    donnees: {
      ferme_id: fermeId,
      nom: unique('Serre'),
      type: 'serre_chapelle',
      longueur_m: 40,
      largeur_m: 28.8,
      hauteur_m: 4,
      centre_x_m: 10,
      centre_y_m: 20,
      orientation_deg: 0,
      zone_id: zoneId,
      nb_chapelles: 3,
      nb_troncons: 1,
      largeur_allee_m: 4.4,
    },
  });
  const retirer = (e: EcritureEnvoyee): EcritureEnvoyee => ({ op: 'PATCH', table: e.table, id: e.id, donnees: { supprime_le: MAINTENANT.toISOString() } });

  /** Tunnel Manon : la zone, 3 sous-zones, 2 planches par sous-zone, le bâtiment. */
  function manon(): { lot: EcritureEnvoyee[]; zone: EcritureEnvoyee; sousZones: EcritureEnvoyee[]; planches: EcritureEnvoyee[]; serre: EcritureEnvoyee } {
    const zone = putZone(unique('Manon'), null);
    const sousZones = [1, 2, 3].map((k) => putZone(`${donneesNom(zone)} ${String(k)}`, zone.id));
    const planches = sousZones.flatMap((z) => [putPlanche(z.id, 'P1'), putPlanche(z.id, 'P2')]);
    const serre = putSerre(zone.id);
    return { lot: [zone, ...sousZones, ...planches, serre], zone, sousZones, planches, serre };
  }
  const donneesNom = (e: EcritureEnvoyee): string => String(e.donnees?.nom);

  beforeAll(async () => {
    base = await creerBaseJetable('t89_serre');
    cles = { active: await genererCleSignature('cle-t89'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    fermeVoisine = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, (await creerUtilisateur(base.pool)).id, fermeVoisine, { role: 'gerant' });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    for (const f of [ferme, fermeVoisine]) await base.pool.query(`UPDATE ferme SET origine_plan = $2::jsonb WHERE id = $1`, [f, JSON.stringify({ latitude: 44, longitude: 1.5 })]);
    zoneVoisine = randomUUID();
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Zone voisine', 'tunnel')`, [zoneVoisine, fermeVoisine]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  it('le lot complet de la fiche (zone, 3 sous-zones, 6 planches placées, bâtiment) est accepté d’un coup', async () => {
    const m = manon();
    await accepte(m.lot);
    for (const e of m.lot) expect(await enService(e.table, e.id), `${e.table} ${e.id}`).toBe(true);
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM emplacement WHERE zone_id = ANY($1::uuid[]) AND placement_x_m IS NOT NULL`, [m.sousZones.map((z) => z.id)]);
    expect(r.rows[0]?.n).toBe(6);
  });

  it('serre à légumes : 1 + 18 zones, 144 planches, le bâtiment — un lot de 164 écritures', async () => {
    const zone = putZone(unique('Légumes'), null);
    const sousZones = Array.from({ length: 18 }, (_x, k) => putZone(`${donneesNom(zone)} ${String(k + 1)}`, zone.id));
    const planches = sousZones.flatMap((z) => Array.from({ length: 8 }, (_y, k) => putPlanche(z.id, `P${String(k + 1)}`)));
    const lot = [zone, ...sousZones, ...planches, putSerre(zone.id)];
    expect(lot).toHaveLength(164);
    await accepte(lot);
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM emplacement WHERE zone_id = ANY($1::uuid[])`, [sousZones.map((z) => z.id)]);
    expect(r.rows[0]?.n).toBe(144);
  });

  it('renvoi identique du lot (réponse perdue) : accepté, rien de dupliqué', async () => {
    const m = manon();
    await accepte(m.lot);
    await accepte(m.lot);
    const r = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM emplacement WHERE zone_id = ANY($1::uuid[])`, [m.sousZones.map((z) => z.id)]);
    expect(r.rows[0]?.n).toBe(6);
  });

  describe('refus : lot refusé en entier, rien n’est écrit', () => {
    it('un équipier ne crée pas de planche placée ni de serre', async () => {
      const m = manon();
      await refuse(m.lot, equipier.jeton);
      for (const e of m.lot) expect(await existe(e.table, e.id), `${e.table} absent`).toBe(false);
    });

    it('sous-zone dont la zone parente est d’une autre ferme', async () => {
      const zone = putZone(unique('Serre'), null);
      const intruse = putZone(unique('Intruse'), zoneVoisine);
      await refuse([zone, intruse]);
      expect(await existe('zone', zone.id)).toBe(false);
      expect(await existe('zone', intruse.id)).toBe(false);
    });

    it('emplacement dans une zone d’une autre ferme', async () => {
      const p = putPlanche(zoneVoisine, 'P1');
      await refuse([p]);
      expect(await existe('emplacement', p.id)).toBe(false);
    });

    it('emplacement écrit comme étant d’une autre ferme (ferme_id de la voisine) par un gérant qui n’en est pas membre', async () => {
      const zone = putZone(unique('Serre'), null);
      const p = putPlanche(zone.id, 'P1', fermeVoisine);
      await refuse([zone, p]);
      expect(await existe('emplacement', p.id)).toBe(false);
    });

    it('bâtiment qui abrite la zone d’une autre ferme', async () => {
      const s = putSerre(zoneVoisine);
      await refuse([s]);
      expect(await existe('batiment', s.id)).toBe(false);
    });

    it('PUT d’une zone avec l’identifiant d’une zone de l’autre ferme : refus, la zone voisine n’est pas écrasée', async () => {
      await refuse([putZone('Écrasée !', null, ferme, zoneVoisine)]);
      const r = await base.pool.query<{ ferme_id: string; nom: string }>(`SELECT ferme_id, nom FROM zone WHERE id = $1`, [zoneVoisine]);
      expect(r.rows[0]).toEqual({ ferme_id: fermeVoisine, nom: 'Zone voisine' });
    });

    it('code d’emplacement en double dans une même zone (P1, puis « p1 ») : refusé, comme Q27', async () => {
      const zone = putZone(unique('Serre'), null);
      const a = putPlanche(zone.id, 'P1');
      const b = putPlanche(zone.id, ' p1 ');
      await refuse([zone, a, b]);
      expect(await existe('zone', zone.id)).toBe(false);
    });

    it('planche placée avec une orientation hors bornes : refusée par les règles du cœur', async () => {
      const zone = putZone(unique('Serre'), null);
      const p = putPlanche(zone.id, 'P1');
      const mauvaise: EcritureEnvoyee = { ...p, donnees: { ...p.donnees, orientation_deg: 400 } };
      await refuse([zone, mauvaise]);
      expect(await existe('emplacement', p.id)).toBe(false);
    });

    it('téléphone d’avant la mise à jour : un lot sans les colonnes de la grille reste accepté (serre sans grille)', async () => {
      const zone = putZone(unique('Serre'), null);
      const s = putSerre(zone.id);
      const ancien: EcritureEnvoyee = { ...s, donnees: Object.fromEntries(Object.entries(s.donnees ?? {}).filter(([c]) => !['nb_chapelles', 'nb_troncons', 'largeur_allee_m'].includes(c))) };
      await accepte([zone, putPlanche(zone.id, 'P1'), ancien]);
      expect(await enService('batiment', s.id)).toBe(true);
    });
  });

  describe('annulation : suppression douce, emplacements avant leur zone', () => {
    it('le lot d’annulation de la fiche (planches, sous-zones, bâtiment, zone) est accepté et ne laisse rien en service', async () => {
      const m = manon();
      await accepte(m.lot);
      await accepte([...m.planches.map(retirer), retirer(m.serre), ...m.sousZones.map(retirer), retirer(m.zone)]);
      for (const e of m.lot) expect(await enService(e.table, e.id), `${e.table} ${e.id}`).toBe(false);
    });

    it('retirer une zone avant ses planches est refusé (le téléphone doit annuler dans l’ordre inverse)', async () => {
      const m = manon();
      await accepte(m.lot);
      const [premiere] = m.sousZones;
      if (premiere === undefined) throw new Error('sous-zone absente');
      await refuse([retirer(premiere), ...m.planches.map(retirer)]);
      expect(await enService('zone', premiere.id)).toBe(true);
    });
  });
});
