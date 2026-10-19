/**
 * Tests d'acceptation T49 — les écritures de « Ma ferme » passent les règles du serveur
 * (apps/api/src/sync/structure-lignes.ts, `validerStructure`, T10s), une transaction par geste,
 * et leurs annulations aussi. Environnement node (la règle du serveur importe @planif/db, qui ne
 * se charge pas sous happy-dom) ; l'écran lui-même : ./ecran.test.tsx.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FERME } from './test/ferme-neuve.ts';
import { acceptePar, actifs, AUJOURDHUI, creerBanc, emplacements, MAINTENANT, saisons, zones, type Banc } from './test/outils.ts';

interface Enregistrement {
  readonly texte: string;
  annuler(): Promise<void>;
}
interface ModuleEcritures {
  readonly EcritureRefusee: new (m: string) => Error;
  creerSaison(ctx: unknown, s: { nom: string; debut: string; fin: string }): Promise<Enregistrement>;
  supprimerSaison(ctx: unknown, id: string): Promise<Enregistrement>;
  creerZone(ctx: unknown, z: { nom: string; typeAbri: string; parenteId: string | null }): Promise<Enregistrement & { readonly id: string }>;
  modifierZone(ctx: unknown, id: string, z: { nom: string; typeAbri: string; parenteId: string | null }): Promise<Enregistrement | null>;
  ajouterPlanches(ctx: unknown, zoneId: string, lot: { codes: readonly string[]; longueurM: number; largeurM: number }): Promise<Enregistrement>;
  modifierEmplacement(ctx: unknown, id: string, e: { code: string; sorte: string; longueurM: number; largeurM: number | null; nombrePlaces: number | null }): Promise<Enregistrement | null>;
  changerService(ctx: unknown, id: string, enService: boolean): Promise<Enregistrement | null>;
  supprimerEmplacement(ctx: unknown, id: string): Promise<Enregistrement>;
  modifierSaison(ctx: unknown, id: string, s: { nom: string; debut: string; fin: string }): Promise<Enregistrement | null>;
}

const CHEMIN = './ecritures.ts';
let m: ModuleEcritures;
let b: Banc;
const ctx = () => ({ porte: b.porte, fermeId: FERME, maintenant: () => MAINTENANT, aujourdhui: AUJOURDHUI });

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEcritures;
});
beforeEach(async () => {
  b = await creerBanc();
});
afterEach(() => {
  b.base.fermer();
});

describe('T49 : écritures relues par la règle de ligne du serveur (validerStructure)', () => {
  it('chaque ligne écrite (saison, zone, sous-zone, 10 planches, modification, hors service, annulations) passe la règle de ligne du serveur', async () => {
    const s = await m.creerSaison(ctx(), { nom: '2026', debut: '2026-01-01', fin: '2026-12-31' });
    const tunnel = await m.creerZone(ctx(), { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null });
    await m.creerZone(ctx(), { nom: 'Chapelle A', typeAbri: 'serre', parenteId: tunnel.id });
    b.remiseAZero();
    const lot = await m.ajouterPlanches(ctx(), tunnel.id, { codes: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'], longueurM: 30, largeurM: 0.8 });
    expect(b.transactions()).toBe(1);
    expect(lot.texte).toMatch(/10 planches/);
    await acceptePar('saison', saisons(b));
    await acceptePar('zone', zones(b));
    await acceptePar('emplacement', emplacements(b));

    const p3 = actifs(emplacements(b)).find((e) => e.code === 'P3');
    if (p3 === undefined) throw new Error('P3 absente');
    await m.modifierEmplacement(ctx(), String(p3.id), { code: 'G1', sorte: 'gouttiere', longueurM: 30, largeurM: null, nombrePlaces: 120 });
    const hors = await m.changerService(ctx(), String(p3.id), false);
    await acceptePar('emplacement', emplacements(b));
    await hors?.annuler();
    await lot.annuler();
    await acceptePar('emplacement', emplacements(b));
    expect(actifs(emplacements(b))).toHaveLength(0);
    await s.annuler();
    await acceptePar('saison', saisons(b));
    expect(actifs(saisons(b))).toHaveLength(0);
  });

  it('code en double dans la zone : refusé dans la transaction, rien d’écrit (deux onglets, synchro)', async () => {
    const tunnel = await m.creerZone(ctx(), { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null });
    await m.ajouterPlanches(ctx(), tunnel.id, { codes: ['P1', 'P2'], longueurM: 30, largeurM: 0.8 });
    const avant = emplacements(b).length;
    await expect(m.ajouterPlanches(ctx(), tunnel.id, { codes: ['P3', ' p2 '], longueurM: 30, largeurM: 0.8 })).rejects.toThrow(/existe déjà dans cette zone/);
    expect(emplacements(b)).toHaveLength(avant);
    const p1 = actifs(emplacements(b)).find((e) => e.code === 'P1');
    await expect(m.modifierEmplacement(ctx(), String(p1?.id), { code: 'P2', sorte: 'planche', longueurM: 30, largeurM: 0.8, nombrePlaces: null })).rejects.toBeInstanceOf(m.EcritureRefusee);
  });

  it('une zone ne se range pas dans l’une de ses sous-zones', async () => {
    const tunnel = await m.creerZone(ctx(), { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null });
    const chapelle = await m.creerZone(ctx(), { nom: 'Chapelle A', typeAbri: 'tunnel', parenteId: tunnel.id });
    await expect(m.modifierZone(ctx(), tunnel.id, { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: chapelle.id })).rejects.toThrow(/elle-même/);
    await expect(m.modifierZone(ctx(), tunnel.id, { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: tunnel.id })).rejects.toThrow(/elle-même/);
  });
});

describe('T49 (relecture) : ce qui retient, comme le serveur (structure.ts, verifierLibre, Prolonger)', () => {
  const ISO = MAINTENANT.toISOString();
  async function saisonDe(debut: string, fin: string): Promise<string> {
    await m.creerSaison(ctx(), { nom: `S ${debut}`, debut, fin });
    const s = saisons(b).find((x) => x.debut === debut);
    return String(s?.id);
  }
  async function assolementSur(saisonId: string, emplacementId: string | null, zoneId: string | null): Promise<void> {
    await b.base.execute(
      `INSERT INTO assolement (id, ferme_id, saison_id, zone_id, emplacement_id, famille_id, espece_id, nature, source_import, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, ?, '0192f0c1-4949-7000-8000-000000000030', NULL, 'prevu', NULL, ?, ?, NULL)`,
      [`0192f0c1-4949-7000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`, FERME, saisonId, zoneId, emplacementId, ISO, ISO],
    );
  }

  it('planche : suppression refusée par un assolement actif d’une saison pas terminée ; permise si la saison est terminée', async () => {
    const encours = await saisonDe('2026-01-01', '2026-12-31');
    const passee = await saisonDe('2024-01-01', '2024-12-31');
    const tunnel = await m.creerZone(ctx(), { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null });
    await m.ajouterPlanches(ctx(), tunnel.id, { codes: ['P1', 'P2'], longueurM: 30, largeurM: 0.8 });
    const [p1, p2] = actifs(emplacements(b));
    await assolementSur(encours, String(p1?.id), null);
    await assolementSur(passee, String(p2?.id), null);
    b.remiseAZero();
    await expect(m.supprimerEmplacement(ctx(), String(p1?.id))).rejects.toThrow(/1 assolement/);
    expect(b.transactions(), 'refusé avant toute transaction').toBe(0);
    expect(actifs(emplacements(b))).toHaveLength(2);
    await m.supprimerEmplacement(ctx(), String(p2?.id));
    expect(actifs(emplacements(b))).toHaveLength(1);
  });

  it('« Annuler » d’un lot de planches : refusé si un assolement actif d’une saison pas terminée y a été posé', async () => {
    const encours = await saisonDe('2026-01-01', '2026-12-31');
    const tunnel = await m.creerZone(ctx(), { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null });
    const lot = await m.ajouterPlanches(ctx(), tunnel.id, { codes: ['P1', 'P2'], longueurM: 30, largeurM: 0.8 });
    await assolementSur(encours, String(actifs(emplacements(b))[0]?.id), null);
    await expect(lot.annuler()).rejects.toThrow(/assolement/);
    expect(actifs(emplacements(b))).toHaveLength(2);
  });

  it('prolonger une saison terminée : refusé si son plan désigne une zone supprimée ; permis sinon', async () => {
    const passee = await saisonDe('2024-01-01', '2024-12-31');
    const z = await m.creerZone(ctx(), { nom: 'Ancienne', typeAbri: 'plein_champ', parenteId: null });
    await assolementSur(passee, null, z.id);
    await b.base.execute('UPDATE zone SET supprime_le = ? WHERE id = ?', [ISO, z.id]);
    b.remiseAZero();
    await expect(m.modifierSaison(ctx(), passee, { nom: 'S 2024-01-01', debut: '2024-01-01', fin: '2026-12-31' })).rejects.toThrow(/prolonger cette saison/);
    expect(b.transactions()).toBe(0);
    // Changer sa fin sans la remettre en cours : permis.
    await m.modifierSaison(ctx(), passee, { nom: 'S 2024-01-01', debut: '2024-01-01', fin: '2025-06-30' });
    expect(saisons(b).find((s) => s.id === passee)?.fin).toBe('2025-06-30');
    const autre = await saisonDe('2023-01-01', '2023-12-31');
    await m.modifierSaison(ctx(), autre, { nom: 'S 2023-01-01', debut: '2023-01-01', fin: '2026-12-31' });
    expect(saisons(b).find((s) => s.id === autre)?.fin).toBe('2026-12-31');
  });
});
