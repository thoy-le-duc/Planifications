/**
 * Tests d'acceptation T47 (docs/backlog/T47-export-tache-longue.md, docs/mesures/T47.md) — la
 * construction de l'archive dans le worker de l'export.
 *
 * Mesuré (20 passages, CPU ×4, ferme de T07) : les tâches longues de l'export de référence sont
 * des ramasse-miettes du fil principal (35 à 145 ms), dans les tranches de 8 ms de la construction ;
 * le tas de la page monte à 60 à 85 Mo (lignes lues, CSV, morceaux compressés). La construction
 * (lignes, CSV, ferme.json, ZIP) et sa compression passent donc dans le worker de l'export : le fil
 * principal ne fait plus que lire les pages de la base et les passer au worker, sans les garder.
 *
 * Contrat :
 *   lancerExport({ ..., constructionEnWorker: true }) :
 *     - l'archive est construite dans le worker (./compression.worker.ts, nommé
 *       'construction-export') : la page ne lui envoie que « bonjour », « exporter » et les pages
 *       lues (« page ») ; aucun morceau à compresser ne part de la page ;
 *     - même archive (mêmes fichiers, mêmes contenus) que la construction au fil principal ;
 *     - une lecture de la base à la fois, chaque page rendue au worker ;
 *     - barre d'avancement relayée, jamais en recul, jusqu'au total ;
 *     - worker indisponible (constructeur qui lève, script qui ne se charge pas) : l'export se
 *       fait comme avant (construction au fil principal), même archive ;
 *     - worker qui tombe en cours d'export : l'export recommence une fois sans lui, une seule
 *       archive téléchargée ;
 *     - annulation : rejet AbortError, rien téléchargé, worker arrêté ;
 *     - erreur de lecture de la base : rejet avec CETTE erreur, sans nouvelle tentative.
 *   exportEnFond.lancer passe `constructionEnWorker: true` à lancerExport.
 *
 * Faux Worker : il fait passer les messages (clonés, comme le navigateur) entre ./construction.ts
 * et le VRAI code de ./compression.worker.ts, chargé avec un `self` factice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync/export';
import { lireCsv } from '../../../../../packages/core/src/export/test/csv.ts';
import { lireZip, texteZip } from '../../../../../packages/sync/src/test/zip.ts';

// ── Faux Worker ──────────────────────────────────────────────────────────────────────────────

interface Comportement {
  /** Le constructeur lève (URL refusée, CSP…). */
  leve?: boolean;
  /** Le script ne se charge pas : événement `error` tout de suite, aucune réponse. */
  neSeChargePas?: boolean;
  /** Le worker tombe (événement `error`) après avoir reçu ce nombre de pages. */
  tombeApresPages?: number;
}

let comportement: Comportement;
/** Messages postés par la page vers le worker (type seulement). */
let postes: string[];
let noms: (string | undefined)[];
let termines: number;

const instances: FauxTravailleur[] = [];

class FauxTravailleur {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  private termine = false;
  private pages = 0;

  constructor(_url: unknown, options?: { name?: string }) {
    noms.push(options?.name);
    if (comportement.leve === true) throw new Error('Worker bloqué');
    instances.push(this);
    if (comportement.neSeChargePas === true) {
      setTimeout(() => {
        this.onerror?.({ type: 'error', message: 'chargement du script impossible', preventDefault: () => undefined });
      }, 0);
    }
  }

  postMessage(m: { type: string }): void {
    if (this.termine) return;
    postes.push(m.type);
    if (comportement.neSeChargePas === true) return;
    if (m.type === 'page') {
      this.pages++;
      if (comportement.tombeApresPages !== undefined && this.pages >= comportement.tombeApresPages) {
        setTimeout(() => {
          if (!this.termine) this.onerror?.({ type: 'error', message: 'worker tombé', preventDefault: () => undefined });
        }, 0);
        this.termine = true;
        return;
      }
    }
    const copie = structuredClone(m);
    setTimeout(() => {
      if (this.termine) return;
      const cible = (globalThis as unknown as { self: { onmessage: ((e: { data: unknown }) => void) | null } }).self;
      cible.onmessage?.({ data: copie });
    }, 0);
  }

  /** Livre à la page ce que le vrai code du worker rend. */
  livrer(r: unknown): void {
    const copie = structuredClone(r);
    setTimeout(() => {
      if (!this.termine) this.onmessage?.({ data: copie });
    }, 0);
  }

  terminate(): void {
    if (!this.termine) termines++;
    this.termine = true;
  }
}

function installerSelf(): void {
  vi.stubGlobal('self', {
    onmessage: null,
    postMessage: (r: unknown) => {
      instances.at(-1)?.livrer(r);
    },
  });
}

async function brancherWorker(c: Comportement = {}): Promise<void> {
  comportement = c;
  installerSelf();
  vi.stubGlobal('Worker', FauxTravailleur);
  // Le vrai code du worker, branché sur le `self` factice.
  await import('./compression.worker.ts');
}

beforeEach(() => {
  comportement = {};
  postes = [];
  noms = [];
  termines = 0;
  instances.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Ferme factice ────────────────────────────────────────────────────────────────────────────

const FERME = '0192f0c1-7a6e-7cc3-a000-000000000001';
const MAINTENANT = new Date('2026-10-19T06:30:00.000Z');
const C = '2026-01-15T08:00:00.000Z';
const id = (n: number) => `0192f0c1-7a6e-7cc3-a000-${String(n).padStart(12, '0')}`;
/** Assez de zones pour plusieurs pages (PAGE = 1 000 lignes) : la pagination passe par le worker. */
const ZONES = Array.from({ length: 2_350 }, (_, k) => ({
  id: id(100 + k),
  ferme_id: FERME,
  nom: k % 7 === 0 ? `Îlot « nord » ; n° ${String(k)}` : `Planche ${String(k)}`,
  zone_parente_id: null,
  type_abri: k % 2 === 0 ? 'tunnel' : 'plein_champ',
  surface_m2: 10 + k / 4,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
}));
const LIGNES: Readonly<Record<string, readonly Readonly<Record<string, string | number | null>>[]>> = {
  ferme: [{ id: FERME, nom: 'Ferme du worker', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null }],
  zone: ZONES,
};

interface Suivi {
  lectures: number;
  enCours: number;
  pic: number;
}

/** Porte factice : pagination par clé (`id > ?` … `LIMIT n`), comme la base ; compte les lectures simultanées. */
function porteFactice(suivi: Suivi, erreur?: Error): PorteDonnees {
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  return {
    lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
      suivi.lectures++;
      suivi.enCours++;
      suivi.pic = Math.max(suivi.pic, suivi.enCours);
      const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
      const limite = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? '1000000');
      const apres = sql.includes('id > ?') ? String(parametres?.at(-1)) : null;
      return new Promise<T[]>((ok, ko) => {
        setTimeout(() => {
          suivi.enCours--;
          if (erreur !== undefined && table === 'zone') {
            ko(erreur);
            return;
          }
          const toutes = [...(LIGNES[table] ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
          ok(toutes.filter((l) => apres === null || String(l.id) > apres).slice(0, limite) as T[]);
        }, 1);
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
    personnaliserEspece: () => Promise.resolve(''),
  };
}

function contenu(octets: Uint8Array): [string, string][] {
  const entrees = lireZip(octets);
  return entrees.map((e) => [e.chemin, texteZip(entrees, e.chemin)]);
}

/** Archive de référence : construction au fil principal, sans aucun Worker. */
async function reference(): Promise<[string, string][]> {
  const { lancerExport } = await import('./lancer.ts');
  const a = await lancerExport({ porte: porteFactice({ lectures: 0, enCours: 0, pic: 0 }), fermeId: FERME, maintenant: () => MAINTENANT, telecharger: () => undefined });
  return contenu(a.octets);
}

interface Issue {
  octets: Uint8Array;
  telechargements: number;
  avancements: { fait: number; total: number }[];
  suivi: Suivi;
}

async function exporterEnWorker(o: { signal?: AbortSignal; erreur?: Error } = {}): Promise<Issue> {
  const { lancerExport } = await import('./lancer.ts');
  const suivi: Suivi = { lectures: 0, enCours: 0, pic: 0 };
  const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
  const avancements: { fait: number; total: number }[] = [];
  const archive = await lancerExport({
    porte: porteFactice(suivi, o.erreur),
    fermeId: FERME,
    maintenant: () => MAINTENANT,
    telecharger,
    constructionEnWorker: true,
    avancement: (a) => avancements.push(a),
    ...(o.signal === undefined ? {} : { signal: o.signal }),
  });
  return { octets: archive.octets, telechargements: telecharger.mock.calls.length, avancements, suivi };
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('T47 : construction de l’archive dans le worker de l’export', () => {
  it('témoin : la ferme factice fait plusieurs pages de zones', async () => {
    const ref = await reference();
    const zones = lireCsv(ref.find(([c]) => c === 'zone.csv')?.[1] ?? '');
    expect(zones.lignes).toHaveLength(ZONES.length);
  });

  it('la page n’envoie au worker que « bonjour », « exporter » et les pages lues ; même archive qu’au fil principal', async () => {
    const ref = await reference();
    await brancherWorker();
    const r = await exporterEnWorker();
    expect(r.telechargements, 'une archive téléchargée').toBe(1);
    expect(noms, 'un worker, celui de la construction').toEqual(['construction-export']);
    expect(new Set(postes), 'messages de la page vers le worker').toEqual(new Set(['bonjour', 'exporter', 'page']));
    expect(postes.filter((t) => t === 'page').length, 'une page rendue par lecture').toBe(r.suivi.lectures);
    expect(r.suivi.lectures, 'zones lues en plusieurs pages').toBeGreaterThan(3);
    expect(r.suivi.pic, 'une lecture de la base à la fois').toBe(1);
    expect(contenu(r.octets)).toEqual(ref);
    expect(termines, 'worker arrêté à la fin').toBe(1);
  }, 30_000);

  it('barre d’avancement relayée depuis le worker : jamais en recul, jusqu’au total', async () => {
    await brancherWorker();
    const r = await exporterEnWorker();
    expect(r.avancements.length).toBeGreaterThan(2);
    for (let i = 1; i < r.avancements.length; i++) {
      const a = r.avancements[i - 1];
      const b = r.avancements[i];
      if (a === undefined || b === undefined) continue;
      expect(b.total).toBe(a.total);
      expect(b.fait).toBeGreaterThanOrEqual(a.fait);
    }
    const dernier = r.avancements.at(-1);
    expect(dernier?.fait).toBe(dernier?.total);
  }, 30_000);

  it('le constructeur de Worker lève : l’export se fait au fil principal, même archive', async () => {
    const ref = await reference();
    await brancherWorker({ leve: true });
    const r = await exporterEnWorker();
    expect(r.telechargements).toBe(1);
    expect(contenu(r.octets)).toEqual(ref);
  }, 30_000);

  it('le script du worker ne se charge pas : l’export se fait sans lui, même archive', async () => {
    const ref = await reference();
    await brancherWorker({ neSeChargePas: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await exporterEnWorker();
    expect(r.telechargements).toBe(1);
    expect(contenu(r.octets)).toEqual(ref);
  }, 30_000);

  it('le worker tombe en cours d’export : l’export recommence une fois sans lui, une seule archive', async () => {
    const ref = await reference();
    await brancherWorker({ tombeApresPages: 2 });
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await exporterEnWorker();
    expect(r.telechargements).toBe(1);
    expect(contenu(r.octets)).toEqual(ref);
    expect(avertissements).toHaveBeenCalled();
  }, 30_000);

  it('annulation pendant l’export : rejet AbortError, rien téléchargé, worker arrêté', async () => {
    await brancherWorker();
    const ctrl = new AbortController();
    const { lancerExport } = await import('./lancer.ts');
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    const suivi: Suivi = { lectures: 0, enCours: 0, pic: 0 };
    const porte = porteFactice(suivi);
    const lire = porte.lire.bind(porte);
    const espionne: PorteDonnees = {
      ...porte,
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        if (suivi.lectures === 2) ctrl.abort();
        return lire<T>(sql, parametres);
      },
    };
    const issue = await lancerExport({ porte: espionne, fermeId: FERME, maintenant: () => MAINTENANT, telecharger, constructionEnWorker: true, signal: ctrl.signal }).then(
      () => 'résolue',
      (e: unknown) => (e instanceof Error ? e.name : String(e)),
    );
    expect(issue).toBe('AbortError');
    await new Promise((ok) => setTimeout(ok, 50));
    expect(telecharger).not.toHaveBeenCalled();
    expect(termines, 'worker arrêté').toBe(1);
  }, 30_000);

  it('erreur de lecture de la base : rejet avec cette erreur, sans nouvelle tentative', async () => {
    await brancherWorker();
    const panne = new Error('base fermée');
    const issue = await exporterEnWorker({ erreur: panne }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(issue).toBe(panne);
    expect(noms, 'aucun autre worker (pas de nouvelle tentative)').toEqual(['construction-export']);
  }, 30_000);
});

describe('T47 : l’export en arrière-plan construit dans le worker', () => {
  it('exportEnFond.lancer passe constructionEnWorker: true à lancerExport', async () => {
    const options: unknown[] = [];
    vi.doMock('./lancer.ts', async (original) => {
      const vrai = await original<typeof import('./lancer.ts')>();
      return {
        ...vrai,
        lancerExport: (o: unknown) => {
          options.push(o);
          return new Promise(() => undefined);
        },
      };
    });
    const { exportEnFond } = await import('./arriere-plan.ts');
    expect(exportEnFond.lancer(porteFactice({ lectures: 0, enCours: 0, pic: 0 }), FERME)).toBe(true);
    await vi.waitFor(() => {
      expect(options).toHaveLength(1);
    });
    expect(options[0]).toMatchObject({ constructionEnWorker: true, fermeId: FERME });
    exportEnFond.reinitialiser();
    vi.doUnmock('./lancer.ts');
  });
});
