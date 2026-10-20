// @vitest-environment happy-dom
/**
 * Tests d'acceptation T64 — un « Fait » tapé avant que la base soit prête ne doit jamais se perdre
 * (docs/backlog/T64-fait-perdu-avant-base.md ; cause : docs/mesures/T64.md).
 *
 * Constat (T62, puis T64) : dans `e2e/aujourdhui-grande-ferme.e2e.ts`, étape T13k, un « Fait »
 * tapé avant la base revient « à faire » après un rechargement. Les trois réalisés sont pourtant
 * écrits et tiennent au rechargement (compteur des saisies en attente +3, avant et après). Ce qui
 * revient, c'est la carte de l'INSTANTANÉ : il n'est réécrit que depuis une journée relue, et la
 * relecture complète de la grande ferme (5 à 8 s à froid, CPU ×4) n'était pas arrivée quand
 * l'appli a été rechargée. Le lancement suivant dessine donc l'instantané d'avant les « Fait »,
 * qui les montre à faire, jusqu'à la journée relue.
 *
 * Règle (T64, règle 2) : un geste accepté à l'écran est écrit durablement, ou refusé de façon
 * visible ; jamais accepté puis oublié, même à l'affichage. Une fois le « Fait » écrit, le
 * lancement suivant ne le montre plus à faire, quelle que soit l'avance de la relecture.
 *
 * Banc : celui de ./fait-avant-base.test.tsx (ferme du jour, aujourd'hui = 2026-09-30, stockage
 * de l'instantané injecté). La porte retient la relecture complète (sa première requête, la page
 * des séries, ne rend jamais la main) : c'est l'appli fermée ou rechargée avant la journée relue,
 * de façon déterministe. Les lectures ciblées des « Fait » passent. « Fermer l'appli » : démonter
 * la racine et recharger les modules (le cache de la journée part avec eux).
 *
 *   R1  Trois « Fait » (carotte, chou, radis) tapés avant la base ; la porte arrive, la relecture
 *       complète est retenue ; les trois réalisés sont écrits. L'appli est fermée puis relancée
 *       avant la base : l'instantané dessiné ne montre aucune des trois tâches, montre encore la
 *       batavia (rien d'autre n'a changé), et ne dit pas qu'un « Fait » a pu se perdre.
 *   R2  Base ouverte, journée pas encore relue (instantané à l'écran, T13u) : « Fait » sur la
 *       carotte, écrit. Appli fermée et relancée avant la base : la carotte n'est plus à faire.
 *   R3  Témoin (T13k, inchangé) : appli fermée AVANT la base, rien d'écrit : les trois tâches
 *       restent dans l'instantané, et le lancement suivant dit que des « Fait » n'ont peut-être
 *       pas été enregistrés (refus visible, pas d'oubli).
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_LOCAL, type PorteDonnees, type creerPorte as CreerPorte } from "@planif/sync";
import type { Id } from "@planif/core";
import { creerBaseMemoire, type BaseMemoire } from "../../../../../packages/sync/src/test/base-memoire.ts";
import { CLE_SESSION, type SessionConnexion } from "../../connexion/session.ts";
import { noterFermeMontree } from "../../donnees/ferme-memorisee.ts";
import { cleInstantane } from "./cle-instantane.ts";
import type { ProprietesEcranAujourdhui as ProprietesAvantBase } from "./EcranAujourdhui.tsx";
import type { ModuleEcranAujourdhui, StockageInstantane } from "./test/contrat.ts";
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";

const CAROTTE = cleTache(SERIE.carotte, "semis_direct");
const CHOU = cleTache(SERIE.chou, "plantation");
const RADIS = cleTache(SERIE.radis, "semis_direct");
const BATAVIA = cleTache(SERIE.batavia, "plantation");

let ecran: ModuleEcranAujourdhui;
let creerPorte: typeof CreerPorte;

async function chargerEcran(): Promise<void> {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
  ({ creerPorte } = await import("@planif/sync"));
}

// ── Stockage (session rangée, comme dans l'appli) ────────────────────────────────────────────

const session = (utilisateurId: string): SessionConnexion => ({
  utilisateurId,
  email: "theophane@ferme.fr",
  jetonAcces: "aaa.bbb.ccc",
  jetonRenouvellement: "r".repeat(43),
});

interface StockageTest extends StockageInstantane {
  readonly valeurs: Map<string, string>;
}

function stockageMemoire(): StockageTest {
  const valeurs = new Map<string, string>([[CLE_SESSION, JSON.stringify(session(UTILISATEUR))]]);
  return {
    valeurs,
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v);
    },
    removeItem: (c) => {
      valeurs.delete(c);
    },
  };
}

/** Clés des cartes de l'instantané rangé (ce que dessinera le prochain lancement). */
function clesRangees(stockage: StockageTest): string[] {
  const brut = stockage.valeurs.get(cleInstantane(UTILISATEUR));
  if (brut === undefined) return [];
  const o = JSON.parse(brut) as { taches?: { cle: string }[] };
  return (o.taches ?? []).map((c) => c.cle);
}

// ── Base, porte ──────────────────────────────────────────────────────────────────────────────

let base: BaseMemoire;
let avant = new Set<string>();

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly serie_id: string | null;
  readonly remplace_sorte: string | null;
  readonly detail: string;
}

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>("SELECT * FROM evenement ORDER BY rowid");
/** « <série>:<étape> » des réalisés écrits depuis la remise à zéro. */
const clesEcrites = (): string[] =>
  evenements()
    .filter((e) => !avant.has(e.id) && e.type === "realise" && e.remplace_sorte === null)
    .map((e) => `${String(e.serie_id)}:${String((JSON.parse(e.detail) as { etape?: unknown }).etape)}`);

function remiseAZero(): void {
  avant = new Set(evenements().map((e) => e.id));
}

/** Première requête de la relecture complète (page des séries, calculs.ts `sqlSeriesPage`). */
const estRelectureComplete = (sql: string): boolean => sql.includes("AS ferme) f");

/**
 * Porte sur la ferme du jour. `retenirRelecture` : la relecture complète ne rend jamais la main
 * (appli rechargée avant la journée relue) ; les lectures ciblées et les écritures passent.
 */
function nouvellePorte(retenirRelecture = false): PorteDonnees {
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR as Id<"Utilisateur">, fermeId: FERME as Id<"Ferme"> });
  return {
    ...vraie,
    lire: <T,>(sql: string, parametres?: readonly unknown[]): Promise<T[]> =>
      retenirRelecture && estRelectureComplete(sql) ? new Promise<T[]>(() => undefined) : vraie.lire<T>(sql, parametres),
  };
}

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;

function nouvelleRacine(): void {
  conteneur = document.createElement("div");
  document.body.append(conteneur);
  racine = createRoot(conteneur);
}

function fermerRacine(): void {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  remiseAZero();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
});

afterEach(() => {
  fermerRacine();
  base.fermer();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, nombre = 400): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

/** Laisse passer `ms` de temps réel (minuteries de l'écran : instantané gardé 300 ms après). */
async function patienter(ms: number): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

async function rendre(porte: PorteDonnees | null, fermeId: string | null, stockage: StockageInstantane): Promise<void> {
  const Ecran = ecran.EcranAujourdhui as unknown as (p: ProprietesAvantBase) => ReactElement;
  await act(async () => {
    racine.render(<Ecran porte={porte} fermeId={fermeId} aujourdhui={() => AUJOURDHUI} stockage={stockage} utilisateurId={UTILISATEUR} />);
    await Promise.resolve();
  });
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const cles = (): string[] => taches().map((t) => String(t.dataset.cle));
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const messages = (): string[] =>
  [...conteneur.querySelectorAll('[role="status"], [role="alert"]')]
    .filter((e) => e.getAttribute("data-testid") !== "saisie-annulable")
    .map((e) => e.textContent.replace(/\s+/g, " ").trim());

function boutonFait(cle: string): HTMLButtonElement | undefined {
  const t = tache(cle);
  return t === undefined ? undefined : [...t.querySelectorAll<HTMLButtonElement>("button")].find((x) => (x.getAttribute("aria-label") ?? "").startsWith("Marquer fait"));
}

async function taperFait(cle: string): Promise<void> {
  const b = boutonFait(cle);
  expect(b, `bouton « Marquer fait » de ${cle} (tâches : ${cles().join(", ")})`).toBeDefined();
  if (b === undefined) return;
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
  expect(tache(cle), `${cle} masquée dès son tap`).toBeUndefined();
}

// ── Scénario ─────────────────────────────────────────────────────────────────────────────────

/** Ouverture ordinaire, base ouverte : journée relue, instantané gardé, ferme montrée notée. */
async function ouvrirEtGarder(stockage: StockageTest): Promise<void> {
  await rendre(nouvellePorte(), FERME, stockage);
  await attendre(() => tache(BATAVIA) !== undefined, "tâches de la journée relue");
  await patienter(400);
  for (const c of [CAROTTE, CHOU, RADIS, BATAVIA]) expect(clesRangees(stockage), `${c} dans l’instantané gardé`).toContain(c);
  noterFermeMontree(stockage, UTILISATEUR, FERME);
}

/** Ferme l'appli (écran démonté, modules et cache rechargés) et la relance AVANT la base. */
async function relancerAvantBase(stockage: StockageTest): Promise<void> {
  fermerRacine();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  await rendre(null, null, stockage);
  await attendre(() => taches().length > 0, "l’instantané est dessiné avant la base");
}

describe("T64, R1 : trois « Fait » tapés avant la base, appli rechargée avant la journée relue", () => {
  it("écrits, ils ne reviennent pas « à faire » au lancement suivant", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await relancerAvantBase(stockage);
    remiseAZero();
    for (const c of [CAROTTE, CHOU, RADIS]) await taperFait(c);

    // La base s'ouvre ; la relecture complète, elle, n'arrive pas avant le rechargement.
    await rendre(nouvellePorte(true), FERME, stockage);
    await attendre(() => clesEcrites().length >= 3, `trois réalisés écrits (écrits : ${clesEcrites().join(", ")})`);
    await patienter(400);
    expect(clesEcrites(), "trois réalisés, dans l’ordre des taps").toEqual([CAROTTE, CHOU, RADIS]);
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} reste masquée à l’écran`).toBeUndefined();

    await relancerAvantBase(stockage);
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} écrite : plus « à faire » au lancement suivant (tâches : ${cles().join(", ")})`).toBeUndefined();
    expect(tache(BATAVIA), "le reste de l’instantané est là").toBeDefined();
    expect(messages(), "rien à signaler : les trois sont enregistrés").toEqual([]);
    expect(clesEcrites(), "toujours trois réalisés, rien de plus").toEqual([CAROTTE, CHOU, RADIS]);
  });
});

describe("T64, R2 : « Fait » sur l’instantané base ouverte, appli rechargée avant la journée relue", () => {
  it("écrit, il ne revient pas « à faire » au lancement suivant", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await relancerAvantBase(stockage);
    await rendre(nouvellePorte(true), FERME, stockage);
    await unTour();
    remiseAZero();
    await taperFait(CAROTTE);
    await attendre(() => clesEcrites().length >= 1, "réalisé de la carotte écrit");
    await patienter(400);

    await relancerAvantBase(stockage);
    expect(tache(CAROTTE), `carotte écrite : plus « à faire » au lancement suivant (tâches : ${cles().join(", ")})`).toBeUndefined();
    expect(tache(CHOU), "le reste de l’instantané est là").toBeDefined();
    expect(messages()).toEqual([]);
  });
});

describe("T64, R3 (témoin T13k) : appli fermée avant la base, rien d’écrit", () => {
  it("les tâches restent à faire et le lancement suivant le signale", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await relancerAvantBase(stockage);
    remiseAZero();
    for (const c of [CAROTTE, CHOU, RADIS]) await taperFait(c);

    await relancerAvantBase(stockage);
    expect(clesEcrites(), "rien d’écrit").toEqual([]);
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} jamais écrite : toujours à faire`).toBeDefined();
    expect(messages().join(" "), "le lancement suivant dit que des « Fait » n’ont peut-être pas été enregistrés").toMatch(/enregistr/);
  });
});
