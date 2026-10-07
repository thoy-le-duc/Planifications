/**
 * T15c, relecture : le worker de compression se charge (« pret ») puis lâche.
 *   - chien de garde : il se tait alors que des entrées attendent sa réponse → échec propre
 *     (ErreurWorkerCompression) après SILENCE_MAX_MS, jamais une attente sans fin ;
 *   - lancerExport : une erreur venue du worker fait recommencer l'export UNE fois, au fil
 *     principal ; l'archive est téléchargée une fois, la barre ne recule jamais ;
 *   - une annulation ne relance rien.
 * Faux Worker minimal : il répond « pret » à « bonjour », puis se tait ou lève une erreur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync/export';
import { lireCsv } from '../../../../../packages/core/src/export/test/csv.ts';
import { lireZip, texteZip } from '../../../../../packages/sync/src/test/zip.ts';

type Mode = 'muet' | 'erreur';
let mode: Mode;
let crees = 0;

class FauxWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  private termine = false;
  constructor() {
    crees++;
  }
  postMessage(m: { type: string }): void {
    if (this.termine) return;
    if (m.type === 'bonjour') {
      setTimeout(() => {
        this.onmessage?.({ data: { type: 'pret' } });
      }, 0);
      return;
    }
    if (mode === 'erreur' && m.type === 'morceau') {
      setTimeout(() => {
        this.onerror?.({ type: 'error', message: 'worker tombé', preventDefault: () => undefined });
      }, 0);
    }
    // muet : plus aucune réponse.
  }
  terminate(): void {
    this.termine = true;
  }
}

beforeEach(() => {
  crees = 0;
  vi.stubGlobal('Worker', FauxWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('T15c relecture : chien de garde du worker de compression', () => {
  it('worker muet après « pret » : échec ErreurWorkerCompression passé SILENCE_MAX_MS, pas avant', async () => {
    mode = 'muet';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { compresseurEnWorker, ErreurWorkerCompression, SILENCE_MAX_MS } = await import('./compression.ts');
    const cw = compresseurEnWorker();
    expect(cw).not.toBeNull();
    if (cw === null) return;
    async function* brut(): AsyncGenerator<Uint8Array> {
      yield await Promise.resolve(new Uint8Array([1, 2, 3]));
    }
    let issue: unknown = 'en attente';
    const lecture = (async () => {
      let n = 0;
      for await (const morceau of cw.compresseur(brut())) n += morceau.length;
      return n;
    })().then(
      () => {
        issue = 'résolue';
      },
      (e: unknown) => {
        issue = e;
      },
    );
    await vi.advanceTimersByTimeAsync(SILENCE_MAX_MS - 2_000);
    expect(issue, 'pas d’échec avant le délai').toBe('en attente');
    await vi.advanceTimersByTimeAsync(4_000);
    await lecture;
    expect(issue).toBeInstanceOf(ErreurWorkerCompression);
    cw.fermer();
  });
});

const FERME = '0192f0c1-7a6e-7cc3-a000-0000000000f1';
const C = '2026-01-15T08:00:00.000Z';
const LIGNES: Readonly<Record<string, readonly Readonly<Record<string, string | number | null>>[]>> = {
  ferme: [{ id: FERME, nom: 'Ferme du chien de garde', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null }],
  zone: [
    { id: '0192f0c1-7a6e-7cc3-a000-0000000000f2', ferme_id: FERME, nom: 'Tunnel 1', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240.5, cree_le: C, modifie_le: C, supprime_le: null },
  ],
};

function porte(): PorteDonnees & { lectures: () => number } {
  let n = 0;
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  return {
    lectures: () => n,
    lire: <T,>(sql: string) => {
      n++;
      const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
      return Promise.resolve((LIGNES[table] ?? []) as T[]);
    },
    ecrire: interdit('ecrire'),
    surveiller: interdit('surveiller'),
    saisirEvenement: interdit('saisirEvenement'),
    ecrireEnsemble: interdit('ecrireEnsemble'),
    preparerSaisie: interdit('preparerSaisie'),
    surveillerRefus: interdit('surveillerRefus'),
    archiverRefus: () => Promise.resolve(),
    placer: () => Promise.resolve([]),
  };
}

describe('T15c relecture : lancerExport recommence une fois sans le worker', () => {
  it('worker en échec après « pret » : export refait au fil principal, téléchargé une fois, barre jamais en recul', async () => {
    mode = 'erreur';
    const { lancerExport } = await import('./lancer.ts');
    const p = porte();
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    const barre: number[] = [];
    const archive = await lancerExport({
      porte: p,
      fermeId: FERME,
      maintenant: () => new Date('2026-09-29T06:30:00.000Z'),
      telecharger,
      avancement: (a) => barre.push(a.fait / a.total),
    });
    expect(telecharger).toHaveBeenCalledTimes(1);
    expect(crees, 'un seul worker').toBe(1);
    const zones = lireCsv(texteZip(lireZip(archive.octets), 'zone.csv'));
    expect(zones.lignes).toHaveLength(1);
    for (let k = 1; k < barre.length; k++) expect(barre[k] ?? 0).toBeGreaterThanOrEqual(barre[k - 1] ?? 0);
    expect(barre.at(-1)).toBe(1);
    // Deux lectures complètes de la base : la première, puis la nouvelle tentative.
    expect(p.lectures()).toBeGreaterThan(24);
  });

  it('annulé : aucune nouvelle tentative, rejet AbortError', async () => {
    mode = 'erreur';
    const { lancerExport } = await import('./lancer.ts');
    const p = porte();
    const ctrl = new AbortController();
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    const issue = lancerExport({
      porte: p,
      fermeId: FERME,
      maintenant: () => new Date('2026-09-29T06:30:00.000Z'),
      telecharger,
      signal: ctrl.signal,
      avancement: () => {
        ctrl.abort();
      },
    }).then(
      () => 'réussi',
      (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : String(e)),
    );
    expect(await issue).toBe('AbortError');
    expect(telecharger).not.toHaveBeenCalled();
    expect(p.lectures(), 'aucune relecture de la base').toBeLessThanOrEqual(24);
  });
});
