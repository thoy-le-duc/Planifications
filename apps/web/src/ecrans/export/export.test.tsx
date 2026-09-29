/**
 * Tests d'acceptation T15 — écran « Exporter toute ma ferme » (docs/backlog/T15-export.md).
 * Sans navigateur, comme connexion.test.tsx : rendu serveur de l'écran, et la fonction que le
 * bouton appelle (`lancerExport`) testée seule avec une porte factice. Le parcours au doigt
 * (e2e) viendra quand l'écran sera atteignable : aujourd'hui aucune porte n'est ouverte après
 * la connexion sans synchro réelle.
 *
 * ── API attendue (apps/web/src/ecrans/export/index.ts) ──────────────────────────────────────
 *
 * interface ProprietesEcranExport {
 *   readonly porte: PorteDonnees;                   // @planif/sync
 *   readonly fermeId: string;
 *   readonly maintenant?: () => Date;               // défaut : () => new Date()
 *   readonly telecharger?: (nomFichier: string, octets: Uint8Array) => void;
 *                                                   // défaut : Blob 'application/zip' + <a download>
 * }
 * EcranExport(props: ProprietesEcranExport)
 *   Un bouton (type="button") « Exporter toute ma ferme », cible au doigt : style en ligne
 *   `min-height` ≥ 48 px (gants). Au tap : `lancerExport(...)`, bouton désactivé pendant
 *   l'export (un second tap ne relance rien), puis message en français : réussite contenant
 *   « <N> événements exportés » (N = lignes de evenement.csv), ou échec (role="alert"), bouton
 *   de nouveau actif. En cas d'échec, l'erreur est journalisée par `console.error` (l'erreur
 *   levée, éventuellement enveloppée dans une autre par `cause`). Testé au doigt dans un DOM
 *   simulé (happy-dom) : ./interaction.test.tsx.
 *
 * lancerExport(o: { porte; fermeId; maintenant: () => Date; telecharger; avancement? }): Promise<ArchiveExport>
 *   `exporterFerme(porte, { fermeId, genereLe: maintenant().toISOString(),
 *   jour: jourLocal(maintenant()), avancement })` de @planif/sync, puis `telecharger(nomFichier, octets)`
 *   UNE fois ; rend l'archive. Aucun réseau : tout vient de la base locale (hors ligne).
 *
 * T15b (docs/backlog/T15b-export-leger.md) :
 *   - `o.avancement?: (a: { fait: number; total: number }) => void` est transmis à
 *     `exporterFerme` (règles : packages/core/src/export/test/contrat.ts, « Avancement ») ;
 *   - l'archive est compressée (deflate) : `exporterFerme` prend par défaut
 *     `CompressionStream('deflate-raw')`, que le navigateur et Node 22 ont ;
 *   - pendant l'export, l'écran montre une BARRE D'AVANCEMENT : un élément `<progress>` (ou
 *     role="progressbar"), nourri par `avancement`, en plus du bouton désactivé
 *     (./interaction.test.tsx) ;
 *   - écran jamais gelé : le calcul lourd (`construireArchive` de @planif/core) rend la main
 *     assez souvent pour qu'aucune tâche ne dépasse 25 ms sous Node (≈ 100 ms CPU ralenti ×4) ;
 *     mesuré dans packages/sync/src/export-leger.test.ts. Web Worker non exigé (décision
 *     testeur : la porte vit sur le fil principal, envoyer les lignes à un Worker serait une
 *     copie de plus). S'il y en a un, il reste hors du JavaScript de démarrage, comme l'écran
 *     (./empaquetage.test.ts) ; le budget de démarrage ne bouge pas (70,9 Kio sur main).
 *
 * jourLocal(d: Date): string → 'AAAA-MM-JJ' à l'heure du téléphone (getFullYear, getMonth,
 *   getDate), pas en UTC : un export à 23 h 30 porte la date du jour.
 *
 * Poids de démarrage : l'écran est chargé par import dynamique, jamais par un import statique
 * depuis le reste de l'appli (App.tsx le branchera par `lazy(() => import('./ecrans/export/index.ts'))`).
 * Le budget (`pnpm budget`, 68,9 Kio sur 90 aujourd'hui) le vérifie ; ce test vérifie la règle
 * dans les sources. L'écran n'importe ni PowerSync ni `src/donnees` (ouverture de la base) :
 * il reçoit la porte. ./empaquetage.test.ts le vérifie sur l'empaquetage réel (Vite en mémoire,
 * `src/main.tsx` + import dynamique de l'écran) : le JavaScript de démarrage (entrée et imports
 * statiques) ne contient pas « Articles de stock » (texte de TABLES_EXPORTEES), et rien de ce que
 * charge l'écran ne contient de module `@powersync/*`, même indirectement par @planif/sync.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync';
import { lireCsv } from '../../../../../packages/core/src/export/test/csv.ts';
import { lireZip, texteZip } from '../../../../../packages/sync/src/test/zip.ts';

interface ArchiveExport {
  readonly nomFichier: string;
  readonly octets: Uint8Array;
  readonly lignes: Readonly<Record<string, number>>;
}

interface ProprietesEcranExport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant?: () => Date;
  readonly telecharger?: (nomFichier: string, octets: Uint8Array) => void;
}

interface ModuleEcranExport {
  EcranExport(props: ProprietesEcranExport): ReactElement;
  lancerExport(o: {
    readonly porte: PorteDonnees;
    readonly fermeId: string;
    readonly maintenant: () => Date;
    readonly telecharger: (nomFichier: string, octets: Uint8Array) => void;
    readonly avancement?: (a: { readonly fait: number; readonly total: number }) => void;
  }): Promise<ArchiveExport>;
  jourLocal(d: Date): string;
}

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_MODULE = './index.ts';

let m: ModuleEcranExport;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranExport;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Porte factice : lignes en mémoire, table lue dans la clause FROM ─────────────────────────

const FERME = '0192f0c1-7a6e-7cc3-a000-000000000001';
const FERME_VOISINE = '0192f0c1-7a6e-7cc3-b000-000000000001';
const ZONE_VOISINE = '0192f0c1-7a6e-7cc3-b000-000000000002';
const MAINTENANT = new Date('2026-09-29T06:30:00.000Z');
const C = '2026-01-15T08:00:00.000Z';

const LIGNES: Readonly<Record<string, readonly Readonly<Record<string, string | number | null>>[]>> = {
  ferme: [
    { id: FERME, nom: 'Ferme de Benoît', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null },
    { id: FERME_VOISINE, nom: 'Ferme voisine', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null },
  ],
  zone: [
    { id: '0192f0c1-7a6e-7cc3-a000-000000000002', ferme_id: FERME, nom: 'Tunnel 1', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240.5, cree_le: C, modifie_le: C, supprime_le: null },
    { id: '0192f0c1-7a6e-7cc3-a000-000000000003', ferme_id: FERME, nom: 'Îlot « nord » ; bas', zone_parente_id: null, type_abri: 'plein_champ', surface_m2: 1200, cree_le: C, modifie_le: C, supprime_le: null },
    { id: ZONE_VOISINE, ferme_id: FERME_VOISINE, nom: 'Tunnel voisin', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 100, cree_le: C, modifie_le: C, supprime_le: null },
  ],
};

function porteFactice(): { porte: PorteDonnees; requetes: string[] } {
  const requetes: string[] = [];
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  const porte: PorteDonnees = {
    lire: <T,>(sql: string) => {
      requetes.push(sql);
      const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
      return Promise.resolve((LIGNES[table] ?? []) as T[]);
    },
    ecrire: interdit('ecrire'),
    surveiller: interdit('surveiller'),
    saisirEvenement: interdit('saisirEvenement'),
    surveillerRefus: interdit('surveillerRefus'),
  };
  return { porte, requetes };
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('T15 : écran d’export', () => {
  it('un bouton « Exporter toute ma ferme », d’au moins 48 px de haut', () => {
    const { porte } = porteFactice();
    const html = renderToString(<m.EcranExport porte={porte} fermeId={FERME} />);
    const boutons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)];
    const bouton = boutons.find((b) => (b[1] ?? '').includes('Exporter toute ma ferme'));
    expect(bouton, 'bouton « Exporter toute ma ferme »').toBeDefined();
    const balise = /<button\b[^>]*>/i.exec(bouton?.[0] ?? '')?.[0] ?? '';
    expect(balise).toMatch(/type="button"/);
    expect(balise).not.toMatch(/\sdisabled/);
    const hauteur = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(balise)?.[1];
    expect(hauteur, 'style min-height en ligne').toBeDefined();
    expect(Number(hauteur)).toBeGreaterThanOrEqual(48);
  });

  it('le tap télécharge planifications-<ferme>-<AAAA-MM-JJ>.zip, une archive valide de la ferme seule', async () => {
    const { porte } = porteFactice();
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    const archive = await m.lancerExport({ porte, fermeId: FERME, maintenant: () => MAINTENANT, telecharger });
    expect(telecharger).toHaveBeenCalledTimes(1);
    const [nom, octets] = telecharger.mock.calls[0] ?? [];
    expect(nom).toBe('planifications-ferme-de-benoit-2026-09-29.zip');
    expect(octets).toBe(archive.octets);
    const entrees = lireZip(octets ?? new Uint8Array());
    const zones = lireCsv(texteZip(entrees, 'zone.csv'));
    expect(zones.lignes).toHaveLength(2);
    expect(archive.lignes.zone).toBe(2);
    const json = JSON.parse(texteZip(entrees, 'ferme.json')) as { genere_le: string; ferme_id: string };
    expect(json).toMatchObject({ genere_le: '2026-09-29T06:30:00.000Z', ferme_id: FERME });
    for (const e of entrees) {
      const texte = texteZip(entrees, e.chemin);
      expect(texte, e.chemin).not.toContain(FERME_VOISINE);
      expect(texte, e.chemin).not.toContain(ZONE_VOISINE);
    }
  });

  it('hors ligne : aucun appel réseau, lecture par la porte seulement', async () => {
    const reseau = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', reseau);
    const { porte, requetes } = porteFactice();
    await m.lancerExport({ porte, fermeId: FERME, maintenant: () => MAINTENANT, telecharger: () => undefined });
    expect(reseau).not.toHaveBeenCalled();
    expect(requetes.length).toBeGreaterThan(0);
  });

  it('T15b : archive compressée (deflate) et avancement transmis jusqu’au bout', async () => {
    const { porte } = porteFactice();
    const appels: { fait: number; total: number }[] = [];
    const archive = await m.lancerExport({
      porte,
      fermeId: FERME,
      maintenant: () => MAINTENANT,
      telecharger: () => undefined,
      avancement: (a) => appels.push({ fait: a.fait, total: a.total }),
    });
    const entrees = lireZip(archive.octets);
    for (const e of entrees) expect(e.methode, e.chemin).toBe(8);
    expect(appels.length).toBeGreaterThan(0);
    const dernier = appels.at(-1);
    expect(dernier?.total).toBeGreaterThan(0);
    expect(dernier?.fait).toBe(dernier?.total);
    for (let k = 1; k < appels.length; k++) expect(appels[k]?.fait ?? 0).toBeGreaterThanOrEqual(appels[k - 1]?.fait ?? 0);
    // Formules neutralisées dans les CSV (règle de @planif/core) : « Îlot « nord » ; bas » inchangé.
    expect(lireCsv(texteZip(entrees, 'zone.csv')).lignes.map((l) => l[2])).toEqual(['Tunnel 1', 'Îlot « nord » ; bas']);
  });

  it('jourLocal : la date du téléphone, pas celle de UTC', () => {
    expect(m.jourLocal(new Date(2026, 8, 29, 23, 30))).toBe('2026-09-29');
    expect(m.jourLocal(new Date(2027, 0, 5, 0, 5))).toBe('2027-01-05');
  });
});

describe('T15 : poids de démarrage', () => {
  const src = fileURLToPath(new URL('../../', import.meta.url));
  const ici = fileURLToPath(new URL('./', import.meta.url));

  function sources(dossier: string): string[] {
    return readdirSync(dossier).flatMap((nom) => {
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) return sources(chemin);
      return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : [];
    });
  }

  it('l’écran existe et n’importe ni PowerSync ni l’ouverture de la base (src/donnees)', () => {
    const fichiers = sources(ici);
    expect(fichiers.length).toBeGreaterThan(0);
    for (const f of fichiers) {
      const texte = readFileSync(f, 'utf8');
      expect(texte, relative(src, f)).not.toMatch(/from\s+['"](@powersync\/[^'"]*|@journeyapps\/[^'"]*)['"]/);
      expect(texte, relative(src, f)).not.toMatch(/from\s+['"][^'"]*\/donnees(\/[^'"]*)?['"]/);
    }
  });

  it('aucun import statique de l’écran d’export ailleurs dans l’appli (import dynamique seulement)', () => {
    const ailleurs = sources(src).filter((f) => !f.startsWith(ici));
    expect(ailleurs.length).toBeGreaterThan(0);
    for (const f of ailleurs) {
      const texte = readFileSync(f, 'utf8');
      expect(texte, relative(src, f)).not.toMatch(/(?:import|export)\s[^;]*?\bfrom\s+['"][^'"]*ecrans\/export[^'"]*['"]/);
      expect(texte, relative(src, f)).not.toMatch(/^\s*import\s+['"][^'"]*ecrans\/export[^'"]*['"]/m);
    }
  });
});
