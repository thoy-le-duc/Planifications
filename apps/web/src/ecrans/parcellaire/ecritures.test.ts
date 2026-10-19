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

describe('T49 : écritures relues par la règle du serveur', () => {
  it('saison, zone, sous-zone, 10 planches, modifications et annulations : chaque ligne acceptée', async () => {
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
