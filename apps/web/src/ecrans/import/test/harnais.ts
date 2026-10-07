/**
 * Harnais des tests d'écran de T14b : base mémoire de la ferme de l'import (./ferme-import.ts),
 * porte qui compte les transactions, l'écran rendu pour de vrai dans le DOM simulé (happy-dom),
 * et les gestes du parcours (déposer, dire ce que c'est, colonnes, valeurs, aperçu, importer).
 * Le module de l'écran est chargé par import dynamique (chemin tenu dans une variable) : le
 * typage ne dépend pas du code pas encore écrit. Gestes DOM communs : ../../itineraires/test/outils.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { creerPorte, ECRITURES_MAX_PAR_LOT, SCHEMA_LOCAL, TABLES_LOCALES, TAILLE_MAX_PAR_LOT, type BaseLocale, type NomTableLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import { bouton, champ, desactive, dialogue, liste, nomAccessible, radio, remplir, texte, toucher } from '../../itineraires/test/outils.ts';
import { LIBELLES_TYPES, NOM_ECRAN, type EtapeImport, type ModuleEcranImport } from './contrat.ts';
import { ecrireFermeImport, FERME, UTILISATEUR } from './ferme-import.ts';

export { bouton, champ, desactive, liste, nomAccessible, radio, remplir, texte, toucher };

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_ECRAN = '../index.ts';

/** Horloge des tests : année de saison proposée 2027 (les fichiers du jeu de T14 sont en 2027). */
export const MAINTENANT = new Date('2027-01-15T08:00:00.000Z');
export const ISO = MAINTENANT.toISOString();

export type Ligne = Readonly<Record<string, string | number | null>>;

/**
 * Un lot d'écriture (décision du chef, T14b) : une transaction passée par la porte. La porte
 * refuse plus de ECRITURES_MAX_PAR_LOT ordres par `ecrireEnsemble`, le serveur plus de 500
 * écritures (`lot_trop_gros`) ou 5 Mio par lot : un import s'écrit en lots.
 */
export interface Lot {
  /** Ordres d'écriture (INSERT, UPDATE…) exécutés dans la transaction : une ligne par ordre. */
  readonly ordres: number;
  /** Taille approchée de ce qui part au serveur : octets UTF-8 du JSON des paramètres. */
  readonly octets: number;
  /** Séries créées par ce lot. */
  readonly series: ReadonlySet<string>;
  /** Occupations créées par ce lot → leur serie_id. */
  readonly occupations: ReadonlyMap<string, string | null>;
  /** Lignes créées par ce lot, « table:id » (toutes les tables à suppression douce). */
  readonly creees: ReadonlySet<string>;
  /** Lignes qui ont reçu supprime_le dans ce lot, « table:id ». */
  readonly supprimees: ReadonlySet<string>;
}

export interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  /** Transactions d'écriture passées par la porte depuis le dernier `remiseAZero()`. */
  transactions(): number;
  /** Les lots (transactions) depuis le dernier `remiseAZero()`, dans l'ordre. */
  lots(): readonly Lot[];
  remiseAZero(): void;
  /** Ordres SQL d'écriture exécutés depuis le dernier `remiseAZero()`. */
  ordres(): string[];
}

const octetsJson = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v ?? null)).length;

export async function creerBanc(): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeImport(base);
  let lots: Lot[] = [];
  let ecrituresAvant = base.ecritures.length;
  const seriesVues = new Set(base.lireDirect<{ id: string }>('SELECT id FROM serie').map((l) => l.id));
  const occupationsVues = new Set(base.lireDirect<{ id: string }>('SELECT id FROM occupation').map((l) => l.id));
  const tablesDouces = (Object.keys(TABLES_LOCALES) as NomTableLocale[]).filter((t) => 'supprime_le' in TABLES_LOCALES[t]);
  /** « table:id » → supprimée ou non, pour attribuer à chaque lot ce qu'il crée et ce qu'il supprime. */
  const etatLignes = (): Map<string, boolean> => {
    const m = new Map<string, boolean>();
    for (const t of tablesDouces) for (const l of base.lireDirect<{ id: string; supprime_le: string | null }>(`SELECT id, supprime_le FROM "${t}"`)) m.set(`${t}:${l.id}`, l.supprime_le !== null);
    return m;
  };
  let etatAvant = etatLignes();
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: async (fn) => {
      let ordres = 0;
      let octets = 0;
      const r = await base.writeTransaction((tx) =>
        fn({
          getAll: (sql, p) => tx.getAll(sql, p),
          execute: (sql, p) => {
            if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
              ordres++;
              octets += octetsJson(p);
            }
            return tx.execute(sql, p);
          },
        }),
      );
      const series = new Set<string>();
      for (const l of base.lireDirect<{ id: string }>('SELECT id FROM serie')) {
        if (!seriesVues.has(l.id)) {
          seriesVues.add(l.id);
          series.add(l.id);
        }
      }
      const occupations = new Map<string, string | null>();
      for (const l of base.lireDirect<{ id: string; serie_id: string | null }>('SELECT id, serie_id FROM occupation')) {
        if (!occupationsVues.has(l.id)) {
          occupationsVues.add(l.id);
          occupations.set(l.id, l.serie_id);
        }
      }
      const etatApres = etatLignes();
      const creees = new Set<string>();
      const supprimees = new Set<string>();
      for (const [k, supprimee] of etatApres) {
        const avant = etatAvant.get(k);
        if (avant === undefined) creees.add(k);
        else if (!avant && supprimee) supprimees.add(k);
      }
      etatAvant = etatApres;
      lots.push({ ordres, octets, series, occupations, creees, supprimees });
      return r;
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  const porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  return {
    base,
    porte,
    transactions: () => lots.length,
    lots: () => lots,
    remiseAZero: () => {
      lots = [];
      ecrituresAvant = base.ecritures.length;
    },
    ordres: () => base.ecritures.slice(ecrituresAvant),
  };
}

/**
 * Chaque lot depuis le dernier `remiseAZero()` tient dans les limites de la porte et du serveur
 * (ECRITURES_MAX_PAR_LOT ordres, TAILLE_MAX_PAR_LOT octets), et une série n'est jamais séparée
 * de ses occupations (créées dans le même lot qu'elle).
 */
export function verifierLots(b: Banc): void {
  const lots = b.lots();
  lots.forEach((l, i) => {
    expect(l.ordres, `lot ${String(i + 1)} : au plus ${String(ECRITURES_MAX_PAR_LOT)} écritures`).toBeLessThanOrEqual(ECRITURES_MAX_PAR_LOT);
    expect(l.octets, `lot ${String(i + 1)} : au plus ${String(TAILLE_MAX_PAR_LOT)} octets`).toBeLessThanOrEqual(TAILLE_MAX_PAR_LOT);
  });
  const lotDeSerie = new Map<string, number>();
  lots.forEach((l, i) => {
    for (const s of l.series) lotDeSerie.set(s, i);
  });
  const separees: string[] = [];
  lots.forEach((l, i) => {
    for (const [o, s] of l.occupations) {
      const ls = s === null ? undefined : lotDeSerie.get(s);
      if (ls !== undefined && ls !== i) separees.push(`occupation ${o} (lot ${String(i + 1)}) séparée de sa série ${String(s)} (lot ${String(ls + 1)})`);
    }
  });
  expect(separees, 'une série toujours dans le même lot que ses occupations').toEqual([]);
}

export const lire = (b: Banc, sql: string, p: readonly unknown[] = []): Ligne[] => b.base.lireDirect<Ligne>(sql, p);

/** Toutes les tables du schéma local. */
export const TABLES = Object.keys(TABLES_LOCALES) as NomTableLocale[];

/**
 * Photographie des lignes ACTIVES de chaque table (supprime_le nul quand la colonne existe ;
 * toutes sinon), triées par id : « aucune trace » = même photographie qu'avant l'import.
 */
export function photographie(b: Banc, tables: readonly NomTableLocale[] = TABLES): Record<string, Ligne[]> {
  const r: Record<string, Ligne[]> = {};
  for (const t of tables) {
    const douce = 'supprime_le' in TABLES_LOCALES[t];
    r[t] = lire(b, `SELECT * FROM "${t}"${douce ? ' WHERE supprime_le IS NULL' : ''} ORDER BY id`);
  }
  return r;
}

/** Nombre de lignes (supprimées comprises) de chaque table. */
export function comptes(b: Banc): Record<string, number> {
  return Object.fromEntries(TABLES.map((t) => [t, Number(lire(b, `SELECT COUNT(*) AS n FROM "${t}"`)[0]?.n ?? -1)]));
}

/** UUID v7 (version 7, variante RFC 4122). */
export const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Règles d'écriture de T14b : jamais d'écriture dans `modification` (le serveur l'écrit), jamais
 * de DELETE ni de REPLACE (suppression douce).
 */
export function verifierOrdres(b: Banc): void {
  const o = b.ordres();
  expect(o.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b[^;]*\bmodification\b/i.test(sql)), 'jamais d’écriture dans modification').toEqual([]);
  expect(o.filter((sql) => /^\s*(DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\b/i.test(sql)), 'jamais de DELETE ni de REPLACE').toEqual([]);
}

// ── Fichiers ─────────────────────────────────────────────────────────────────────────────────

/**
 * Chemin sur le disque (pas `new URL('<littéral>', import.meta.url)` : sous happy-dom, Vite
 * réécrit ce littéral en http://localhost:3000/…, que readFileSync refuse).
 */
const DOSSIER_FIXTURES = join(import.meta.dirname, '../../../../../../packages/core/src/import/__fixtures__');

/** Octets d'un fichier du jeu de T14 (packages/core/src/import/__fixtures__/). */
export function fixture(nom: string): Uint8Array {
  return new Uint8Array(readFileSync(join(DOSSIER_FIXTURES, nom)));
}

export const utf8 = (t: string): Uint8Array => new TextEncoder().encode(t);

// ── Attente ──────────────────────────────────────────────────────────────────────────────────

/** Attend (en temps réel : préparation sur le fil principal, imports dynamiques) qu'une condition soit vraie. */
export async function attendreDurant(condition: () => boolean, message: string, ms = 20_000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condition() && Date.now() < limite) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(5);
      else await new Promise((r) => setTimeout(r, 5));
    });
  }
  expect(condition(), message).toBe(true);
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

export interface Harnais {
  banc(): Banc;
  module(): ModuleEcranImport;
  fermetures(): number;
  /**
   * Rend l'écran (ferme FERME, horloge MAINTENANT, porte du banc par défaut) et attend l'étape
   * 'depot'. `porte` : une porte enveloppée (écriture retenue ou refusée) sur la même base.
   */
  ouvrir(fermeId?: string, maintenant?: Date, porte?: PorteDonnees): Promise<HTMLElement>;
  /** Démonte l'écran (même banc) : pour vérifier ce qui survit à la fermeture. */
  demonter(): void;
}

/** Pose les crochets beforeAll / beforeEach / afterEach du fichier de test ; rend les accès. */
export function harnais(): Harnais {
  let m: ModuleEcranImport | undefined;
  let b: Banc | undefined;
  let conteneur: HTMLDivElement | undefined;
  let racine: Root | undefined;
  let fermetures = 0;

  beforeAll(async () => {
    m = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranImport;
  });

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      localStorage.clear();
    } catch {
      // pas de localStorage : rien à vider
    }
    b = await creerBanc();
    fermetures = 0;
  });

  const demonter = () => {
    act(() => {
      racine?.unmount();
    });
    conteneur?.remove();
    racine = undefined;
    conteneur = undefined;
  };

  afterEach(() => {
    demonter();
    vi.useRealTimers();
    b?.base.fermer();
  });

  const banc = (): Banc => {
    if (b === undefined) throw new Error('banc absent');
    return b;
  };
  const module = (): ModuleEcranImport => {
    if (m === undefined) throw new Error('module absent');
    return m;
  };

  return {
    banc,
    module,
    fermetures: () => fermetures,
    demonter,
    async ouvrir(fermeId = FERME, maintenant = MAINTENANT, porte?: PorteDonnees) {
      demonter();
      conteneur = document.createElement('div');
      document.body.append(conteneur);
      racine = createRoot(conteneur);
      const Ecran = module().EcranImport;
      await act(async () => {
        racine?.render(
          createElement(Ecran, {
            porte: porte ?? banc().porte,
            fermeId,
            surFermer: () => {
              fermetures++;
            },
            maintenant: () => maintenant,
          }),
        );
        await Promise.resolve();
      });
      await attendreDurant(() => dialogue(NOM_ECRAN) !== undefined, `écran role="dialog" nommé « ${NOM_ECRAN} »`);
      await attendreDurant(() => etape() === 'depot', 'étape « depot » à l’ouverture');
      return ecran();
    },
  };
}

export function ecran(): HTMLElement {
  const e = document.querySelector<HTMLElement>('[data-testid="ecran-import"]');
  expect(e, 'data-testid="ecran-import"').not.toBeNull();
  if (e === null) throw new Error('écran d’import absent');
  return e;
}

export const etape = (): EtapeImport | null => (document.querySelector<HTMLElement>('[data-testid="ecran-import"]')?.dataset.etape ?? null) as EtapeImport | null;

export const alertes = (): string[] => [...ecran().querySelectorAll('[role="alert"]')].map((a) => texte(a)).filter((t) => t !== '');

// ── Gestes du parcours ───────────────────────────────────────────────────────────────────────

/** Dépose un fichier dans « Choisir un fichier » (comme un choix dans le sélecteur du téléphone). */
export async function deposer(nom: string, octets: Uint8Array): Promise<void> {
  const champ = [...ecran().querySelectorAll<HTMLInputElement>('input[type="file"]')].find((c) => nomAccessible(c) === 'Choisir un fichier');
  expect(champ, 'champ fichier « Choisir un fichier »').toBeDefined();
  if (champ === undefined) return;
  const fichier = new File([new Uint8Array(octets)], nom);
  await act(async () => {
    Object.defineProperty(champ, 'files', { value: [fichier], configurable: true });
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

/** Dépose et attend la fin de la lecture : étape 2 (ou une alerte à l'étape 1). */
export async function deposerEtLire(nom: string, octets: Uint8Array): Promise<void> {
  await deposer(nom, octets);
  await attendreDurant(() => etape() !== 'depot' || alertes().length > 0, `lecture de ${nom}`);
}

export async function continuer(): Promise<void> {
  const avant = etape();
  const b = bouton('Continuer', ecran());
  expect(desactive(b), `« Continuer » actif à l’étape ${String(avant)}`).toBe(false);
  await toucher(b);
  await attendreDurant(() => etape() !== avant || alertes().length > 0, `on quitte l’étape ${String(avant)}`);
}

export const typeCoche = (): string | null => {
  const g = ecran().querySelector<HTMLElement>('[role="radiogroup"]');
  const r = [...(g?.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]') ?? [])].find((x) =>
    x instanceof HTMLInputElement ? x.checked : x.getAttribute('aria-checked') === 'true',
  );
  return r === undefined ? null : nomAccessible(r);
};

export async function choisirType(type: keyof typeof LIBELLES_TYPES): Promise<void> {
  await toucher(radio(LIBELLES_TYPES[type], ecran()));
}

export const colonnes = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="colonne-import"]')];

/** Champ choisi pour chaque colonne (value du <select>, '' = Ignorée), dans l'ordre des colonnes. */
export function champsChoisis(): string[] {
  return colonnes()
    .sort((a, c) => Number(a.dataset.colonne) - Number(c.dataset.colonne))
    .map((c) => c.querySelector('select')?.value ?? '?');
}

export async function associer(entete: string, champ: string): Promise<void> {
  await remplir(liste(`Champ pour « ${entete} »`, ecran()), champ);
}

export const decisions = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="decision-valeur"]')];

export async function decider(champ: 'espece' | 'famille', valeur: string, choix: string): Promise<void> {
  const nom = champ === 'espece' ? `Culture pour « ${valeur} »` : `Famille pour « ${valeur} »`;
  await remplir(liste(nom, ecran()), choix);
}

/** Le nombre affiché d'un compteur de l'aperçu (data-testid="compteur-…"), NaN s'il est absent. */
export function compteur(nom: 'valides' | 'erreurs' | 'doublons' | 'avertissements'): number {
  const el = ecran().querySelector(`[data-testid="compteur-${nom}"]`);
  const m = /\d[\d\s\u202f\u00a0]*/.exec(texte(el));
  return el === null || m === null ? Number.NaN : Number(m[0].replace(/[\s\u202f\u00a0]/g, ''));
}

export function ligneApercu(ligne: number): HTMLElement | null {
  return ecran().querySelector<HTMLElement>(`[data-testid="ligne-import"][data-ligne="${String(ligne)}"]`);
}

/** « Importer » puis attend l'étape 'fini' ; rend le texte du statut. */
export async function importer(): Promise<string> {
  const b = [...ecran().querySelectorAll<HTMLElement>('button')].find((x) => nomAccessible(x).startsWith('Importer') && nomAccessible(x) !== 'Importer un autre fichier');
  expect(b, 'bouton « Importer … »').toBeDefined();
  if (b === undefined) return '';
  expect(desactive(b), '« Importer » actif').toBe(false);
  await toucher(b);
  await attendreDurant(() => etape() === 'fini' || alertes().length > 0, 'import terminé');
  expect(alertes(), 'aucune alerte à l’import').toEqual([]);
  return texte(ecran().querySelector('[role="status"]'));
}

/** Nombre de lignes importées lu dans le statut (« 4 lignes importées », « 1 ligne importée »). */
export function lignesImportees(statut: string): number {
  const m = /(\d[\d\s\u202f\u00a0]*)\s+lignes?\s+import/i.exec(statut);
  return m === null ? Number.NaN : Number((m[1] ?? '').replace(/[\s\u202f\u00a0]/g, ''));
}

/** Retour à l'étape 1 après un import (« Importer un autre fichier »). */
export async function autreFichier(): Promise<void> {
  await toucher(bouton('Importer un autre fichier', ecran()));
  await attendreDurant(() => etape() === 'depot', 'retour à l’étape 1');
}

// ── Porte enveloppée (relecture T14b : écriture retenue, lot refusé) ─────────────────────────

/**
 * Porte du banc dont chaque `ecrireEnsemble` passe d'abord par `avant(n)` (n = numéro de
 * l'appel, à partir de 1) : il peut attendre (écriture en cours) ou lever (lot refusé par la base
 * locale : rien de ce lot n'est écrit).
 */
export function porteEnveloppee(b: Banc, avant: (n: number) => Promise<void> | void): PorteDonnees {
  let n = 0;
  return {
    ...b.porte,
    ecrireEnsemble: async (ordres, verifier) => {
      n++;
      await avant(n);
      await b.porte.ecrireEnsemble(ordres, verifier);
    },
  };
}
