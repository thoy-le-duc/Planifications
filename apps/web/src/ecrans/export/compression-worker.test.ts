/**
 * Tests d'acceptation T15c (docs/backlog/T15c-export-rapide.md) — le worker de compression :
 *   3. repli sur la compression au fil principal si le worker ne se charge pas ;
 *   4. contre-pression : le producteur attend quand le worker est en retard, pic mémoire borné.
 * Pas de navigateur : un faux `Worker` fait passer les messages entre le code de ./compression.ts et
 * le VRAI code de ./compression.worker.ts (chargé avec un `self` factice), avec un worker lent.
 * Le protocole entre les deux (accusés de réception, crédits…) reste libre : seuls comptent ce qui
 * est posté vers le worker et non encore traité (le pic mesuré), et les octets rendus.
 * Le rangement du worker dans le build et le précache : apps/web/scripts/builds.test.ts.
 */
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync/export';
import { lireCsv } from '../../../../../packages/core/src/export/test/csv.ts';
import { lireZip, texteZip } from '../../../../../packages/sync/src/test/zip.ts';

// ── Faux Worker ──────────────────────────────────────────────────────────────────────────────

/** Ce qu'un test règle sur le faux worker avant de le créer. */
interface Comportement {
  /** Le constructeur lève (URL refusée, CSP…). */
  leve?: boolean;
  /** Le script ne se charge pas : un événement `error` arrive après ce délai, et le worker ne répond jamais. */
  erreurApresMs?: number;
  /** Délai de traitement de chaque message par le worker (worker « en retard »). */
  retardMs: number;
}

interface Mesure {
  /** Octets de morceaux postés vers le worker et pas encore traités. */
  enFile: number;
  pic: number;
  postes: number;
  traites: number;
}

let comportement: Comportement;
let mesure: Mesure;

type Ecouteur = (e: unknown) => void;

/** Faux workers créés, le dernier est celui dont le `self` factice répond. */
const instances: FauxTravailleur[] = [];

class FauxTravailleur {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private readonly ecouteurs: Record<string, Ecouteur[]> = {};
  private readonly file: { m: { octets?: Uint8Array } & Record<string, unknown>; taille: number }[] = [];
  private enCours = false;
  private termine = false;

  constructor() {
    instances.push(this);
    if (comportement.leve === true) throw new Error('Worker bloqué');
    if (comportement.erreurApresMs !== undefined) {
      setTimeout(() => {
        const e = { type: 'error', message: 'chargement du script impossible', preventDefault: () => undefined };
        this.onerror?.(e);
        for (const f of this.ecouteurs.error ?? []) f(e);
      }, comportement.erreurApresMs);
    }
  }

  addEventListener(type: string, f: Ecouteur): void {
    (this.ecouteurs[type] ??= []).push(f);
  }

  removeEventListener(type: string, f: Ecouteur): void {
    this.ecouteurs[type] = (this.ecouteurs[type] ?? []).filter((x) => x !== f);
  }

  /** Livre au fil principal ce que le vrai code du worker rend. */
  livrer(r: unknown): void {
    setTimeout(() => {
      if (this.termine) return;
      this.onmessage?.({ data: r });
      for (const f of this.ecouteurs.message ?? []) f({ data: r });
    }, 0);
  }

  postMessage(m: Record<string, unknown>): void {
    if (this.termine || comportement.erreurApresMs !== undefined) return;
    const taille = m.type === 'morceau' ? ((m.octets as Uint8Array | undefined)?.byteLength ?? 0) : 0;
    mesure.enFile += taille;
    mesure.pic = Math.max(mesure.pic, mesure.enFile);
    mesure.postes++;
    this.file.push({ m, taille });
    if (!this.enCours) this.suivant();
  }

  private suivant(): void {
    this.enCours = true;
    setTimeout(() => {
      const prochain = this.file.shift();
      if (prochain === undefined || this.termine) {
        this.enCours = false;
        return;
      }
      mesure.enFile -= prochain.taille;
      mesure.traites++;
      // Le vrai code du worker : il rend ses réponses par self.postMessage (voir `installerSelf`).
      const cible = (globalThis as unknown as { self: { onmessage: ((e: { data: unknown }) => void) | null } }).self;
      cible.onmessage?.({ data: prochain.m });
      this.suivant();
    }, comportement.retardMs);
  }

  terminate(): void {
    this.termine = true;
  }
}

/** `self` du worker : ses réponses vont au dernier faux worker créé côté page. */
function installerSelf(): void {
  vi.stubGlobal('self', {
    onmessage: null,
    postMessage: (r: unknown) => {
      instances.at(-1)?.livrer(r);
    },
  });
}

beforeEach(async () => {
  comportement = { retardMs: 0 };
  mesure = { enFile: 0, pic: 0, postes: 0, traites: 0 };
  instances.length = 0;
  vi.resetModules();
  installerSelf();
  vi.stubGlobal('Worker', FauxTravailleur);
  // Le vrai code du worker, branché sur le `self` factice.
  await import('./compression.worker.ts');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 4. Contre-pression ───────────────────────────────────────────────────────────────────────

const TAILLE_MORCEAU = 64 * 1024;
const MORCEAUX = 160; // ≈ 10 Mio
/** Pic toléré d'octets postés et non traités : de quoi occuper le worker, pas toute l'entrée. */
const PIC_MAX_OCTETS = 2 * 1024 * 1024;

describe('T15c : contre-pression vers le worker de compression', () => {
  it('worker en retard : le producteur attend, le pic d’octets en file reste borné, la sortie est exacte', async () => {
    const { compresseurEnWorker } = await import('./compression.ts');
    const cw = compresseurEnWorker();
    expect(cw, 'compresseur en worker (Worker et CompressionStream présents)').not.toBeNull();
    if (cw === null) return;
    comportement.retardMs = 3;

    let produits = 0;
    const entree: Uint8Array[] = [];
    async function* brut(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < MORCEAUX; i++) {
        const m = new Uint8Array(TAILLE_MORCEAU).map((_, k) => (k * 7 + i * 13) % 251);
        entree.push(m);
        produits++;
        yield await Promise.resolve(m);
      }
    }
    const sortie: Uint8Array[] = [];
    let produitsQuandLeWorkerEstAuMilieu = -1;
    for await (const c of cw.compresseur(brut())) {
      sortie.push(c);
      if (produitsQuandLeWorkerEstAuMilieu < 0 && mesure.traites >= MORCEAUX / 2) produitsQuandLeWorkerEstAuMilieu = produits;
    }
    cw.fermer();

    // Pic mémoire (simple) : ce qui a été posté vers le worker sans qu'il l'ait encore pris.
    expect(mesure.pic, `pic d’octets en attente côté worker (${String(Math.round(mesure.pic / 1024))} Kio)`).toBeLessThanOrEqual(PIC_MAX_OCTETS);
    // Le producteur a bien suivi le rythme du worker : à mi-parcours du worker, il n'a pas déjà tout produit.
    if (produitsQuandLeWorkerEstAuMilieu >= 0) expect(produitsQuandLeWorkerEstAuMilieu, 'morceaux produits quand le worker en a traité la moitié').toBeLessThan(MORCEAUX);

    // Exactitude : décompressée, la sortie redonne l'entrée.
    const total = (l: readonly Uint8Array[]) => l.reduce((n, x) => n + x.length, 0);
    const colle = (l: readonly Uint8Array[]) => {
      const o = new Uint8Array(total(l));
      let p = 0;
      for (const x of l) {
        o.set(x, p);
        p += x.length;
      }
      return o;
    };
    const decompresse = new Uint8Array(inflateRawSync(colle(sortie)));
    expect(Buffer.compare(decompresse, colle(entree))).toBe(0);
  }, 60_000);
});

// ── 3. Repli ─────────────────────────────────────────────────────────────────────────────────

const FERME = '0192f0c1-7a6e-7cc3-a000-000000000001';
const MAINTENANT = new Date('2026-09-29T06:30:00.000Z');
const C = '2026-01-15T08:00:00.000Z';
const LIGNES: Readonly<Record<string, readonly Readonly<Record<string, string | number | null>>[]>> = {
  ferme: [{ id: FERME, nom: 'Ferme du repli', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null }],
  zone: [
    { id: '0192f0c1-7a6e-7cc3-a000-000000000002', ferme_id: FERME, nom: 'Tunnel 1', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240.5, cree_le: C, modifie_le: C, supprime_le: null },
    { id: '0192f0c1-7a6e-7cc3-a000-000000000003', ferme_id: FERME, nom: 'Îlot « nord » ; bas', zone_parente_id: null, type_abri: 'plein_champ', surface_m2: 1200, cree_le: C, modifie_le: C, supprime_le: null },
  ],
};

/** Porte factice lente : chaque lecture prend `delaiMs`, de quoi laisser arriver l'erreur du worker en cours d'export. */
function porteLente(delaiMs: number): PorteDonnees {
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  return {
    lire: <T,>(sql: string) => {
      const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
      return new Promise<T[]>((ok) => {
        setTimeout(() => {
          ok((LIGNES[table] ?? []) as T[]);
        }, delaiMs);
      });
    },
    ecrire: interdit('ecrire'),
    surveiller: interdit('surveiller'),
    saisirEvenement: interdit('saisirEvenement'),
    ecrireEnsemble: interdit('ecrireEnsemble'),
    preparerSaisie: interdit('preparerSaisie'),
    surveillerRefus: interdit('surveillerRefus'),
    archiverRefus: () => Promise.resolve(),
    placer: () => Promise.resolve([]),
    reglerProfilCroissance: () => Promise.resolve(),
  };
}

async function exporter(delaiLectureMs: number): Promise<{ octets: Uint8Array; telechargements: number }> {
  const { lancerExport } = await import('./lancer.ts');
  const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
  const archive = await lancerExport({ porte: porteLente(delaiLectureMs), fermeId: FERME, maintenant: () => MAINTENANT, telecharger });
  return { octets: archive.octets, telechargements: telecharger.mock.calls.length };
}

/** Ce que l'archive contient, décompressé : nom de chaque entrée et texte. */
function contenu(octets: Uint8Array): [string, string][] {
  const entrees = lireZip(octets);
  return entrees.map((e) => [e.chemin, texteZip(entrees, e.chemin)]);
}

describe('T15c : repli sur la compression au fil principal si le worker ne se charge pas', () => {
  it('témoin : sans Worker du tout, l’export donne l’archive de référence (compression par défaut)', async () => {
    vi.unstubAllGlobals();
    const r = await exporter(0);
    expect(r.telechargements).toBe(1);
    const zones = lireCsv(texteZip(lireZip(r.octets), 'zone.csv'));
    expect(zones.lignes).toHaveLength(2);
  });

  it('le constructeur de Worker lève : l’export va au bout, même archive que sans worker', async () => {
    vi.unstubAllGlobals();
    const reference = contenu((await exporter(0)).octets);
    installerSelf();
    vi.stubGlobal('Worker', FauxTravailleur);
    comportement = { retardMs: 0, leve: true };
    const r = await exporter(0);
    expect(r.telechargements, 'archive téléchargée').toBe(1);
    expect(contenu(r.octets)).toEqual(reference);
  });

  for (const [quand, erreurApresMs, delaiLecture] of [
    ['dès le chargement', 0, 10],
    ['pendant la lecture', 25, 15],
  ] as const) {
    it(`le script du worker ne se charge pas (événement error ${quand}) : l’export va au bout, même archive`, async () => {
      vi.unstubAllGlobals();
      const reference = contenu((await exporter(delaiLecture)).octets);
      installerSelf();
      vi.stubGlobal('Worker', FauxTravailleur);
      comportement = { retardMs: 0, erreurApresMs };
      const erreurs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const r = await exporter(delaiLecture);
        expect(r.telechargements, 'archive téléchargée').toBe(1);
        expect(contenu(r.octets)).toEqual(reference);
      } finally {
        erreurs.mockRestore();
      }
    }, 30_000);
  }
});
