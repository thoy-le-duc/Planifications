// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13g — « Fait » en file au lancement (docs/backlog/T13g-aujourdhui-avant-base.md).
 *
 * Règle du ticket : les « Fait » tapés pendant une lecture ciblée (celle du premier « Fait »
 * touché sur l'instantané, T13d) sont masqués tout de suite et traités dans l'ordre, chacun avec
 * sa vérification (lecture ciblée, puis la vérification « déjà fait » de T13h/T13i au moment
 * d'écrire). Aucun n'est perdu, aucun n'est écrit deux fois.
 *
 * Constat (relecture T13d) : aujourd'hui, pendant la lecture ciblée d'un premier « Fait », les
 * taps suivants ne font rien, sans message (`occupe` dans EcranAujourdhui.tsx).
 *
 * Banc : celui de ./instantane-retouches.test.tsx. Stockage de l'instantané injecté ; ferme du
 * jour (./test/ferme-du-jour.ts), aujourd'hui = 2026-09-30. Un « lancement » est un nouveau rendu
 * après `vi.resetModules()`, sur une NOUVELLE porte de la même base dont toutes les lectures
 * (`porte.lire`) sont retenues jusqu'à `ouvrir()` : tant qu'elles le sont, la lecture ciblée du
 * premier « Fait » est en cours et l'écran dessine l'instantané. Les écritures ne sont jamais
 * retenues. La base est ouverte (l'écran a sa porte) : les boutons de l'instantané sont actifs.
 *
 * Masquée = la carte quitte la liste, ou son bouton « Marquer fait » est désactivé (même règle
 * que le double « Fait » de T13, contrat.ts).
 *
 *   F1  Trois « Fait » tapés à la suite (carotte, chou, radis) pendant la lecture ciblée du
 *       premier : chacun masqué dès son tap ; une fois les lectures libérées, exactement trois
 *       réalisés, un par tâche, dans l'ordre des taps, chacun accepté par validerSaisie ; aucune
 *       erreur ; la journée relue ne les montre plus.
 *   F2  Même chose avec un tap de plus sur une carte déjà touchée (carotte, chou, carotte, radis) :
 *       toujours trois réalisés, aucun en double.
 *   F3  Le chou a été fait ailleurs depuis l'instantané (synchro) : sa vérification le refuse,
 *       les deux autres s'écrivent dans l'ordre, et un message dit « déjà » ; il est encore là
 *       quand la file a fini (le « Fait » suivant ne l'efface pas : un refus n'est jamais muet,
 *       règle R2 de T13d).
 *   F4  Le réalisé du radis arrive par la synchro pendant que la file tourne (juste après
 *       l'écriture de la carotte) : le radis n'est pas écrit une seconde fois ; carotte et chou
 *       le sont.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from "@planif/sync";
import { validerSaisie, type Id } from "@planif/core";
import {
  creerBaseMemoire,
  type BaseMemoire,
} from "../../../../../packages/sync/src/test/base-memoire.ts";
import { CLE_SESSION, type SessionConnexion } from "../../connexion/session.ts";
import type {
  ModuleEcranAujourdhui,
  StockageInstantane,
} from "./test/contrat.ts";
import {
  cleTache,
  EMPLACEMENT,
  ecrireFermeDuJour,
  FERME,
  SERIE,
  UTILISATEUR,
} from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";

const CAROTTE = cleTache(SERIE.carotte, "semis_direct");
const CHOU = cleTache(SERIE.chou, "plantation");
const RADIS = cleTache(SERIE.radis, "semis_direct");

let ecran: ModuleEcranAujourdhui;

async function chargerEcran(): Promise<void> {
  ecran = (await import(
    /* @vite-ignore */ CHEMIN_ECRAN
  )) as ModuleEcranAujourdhui;
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
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify(session(UTILISATEUR))],
  ]);
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

const horsSession = (s: StockageTest): string =>
  [...s.valeurs]
    .filter(([c]) => c !== CLE_SESSION)
    .map(([, v]) => v)
    .join("\n");

// ── Base, portes ─────────────────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly remplace_sorte: string | null;
  readonly detail: string;
  readonly [colonne: string]: unknown;
}

let base: BaseMemoire;
let evenementsAvant = new Set<string>();

/** Dans l'ordre d'insertion (rowid) : l'ordre dans lequel la file a écrit. */
const evenements = (): LigneEvenement[] =>
  base.lireDirect<LigneEvenement>("SELECT * FROM evenement ORDER BY rowid");
const nouveauxEvenements = () =>
  evenements().filter((e) => !evenementsAvant.has(e.id));
/** Réalisés écrits depuis remiseAZero (ni annulations ni corrections), dans l'ordre d'écriture. */
const nouveauxRealises = () =>
  nouveauxEvenements().filter(
    (e) => e.type === "realise" && e.remplace_sorte === null,
  );
/** « <série>:<étape> » de chaque nouveau réalisé écrit par l'écran, dans l'ordre d'écriture. */
const clesEcrites = (): string[] =>
  nouveauxRealises().filter((e) => !recus.has(e.id)).map(
    (e) =>
      `${String(e.serie_id ?? e.campagne_id)}:${String((JSON.parse(e.detail) as { etape?: unknown }).etape)}`,
  );

function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

interface PorteTest {
  readonly porte: PorteDonnees;
  readonly ouvrir: () => void;
}

function nouvellePorte(retenue: boolean): PorteTest {
  const vraie = creerPorte(base, {
    utilisateurId: UTILISATEUR as Id<"Utilisateur">,
    fermeId: FERME as Id<"Ferme">,
  });
  let liberer: () => void = () => undefined;
  let barriere: Promise<void> | null = retenue
    ? new Promise<void>((r) => {
        liberer = r;
      })
    : null;
  const porte: PorteDonnees = {
    ...vraie,
    lire: async <T,>(
      sql: string,
      parametres?: readonly unknown[],
    ): Promise<T[]> => {
      if (barriere !== null) await barriere;
      return vraie.lire<T>(sql, parametres);
    },
  };
  return {
    porte,
    ouvrir: () => {
      barriere = null;
      liberer();
    },
  };
}

let compteurRecus = 0;
/** Ids des réalisés reçus par la synchro (écrits par « un autre téléphone », pas par l'écran). */
const recus = new Set<string>();
const idRecu = () => {
  const id = `0192f0c1-13d1-7000-8000-0000000e${(++compteurRecus).toString(16).padStart(4, "0")}`;
  recus.add(id);
  return id;
};

/** Réalisé d'une étape marqué fait sur un autre téléphone, reçu par la synchro. */
function realiseRecu(serieId: string, etape: string, emplacementId: string): void {
  const id = idRecu();
  const ligne: Record<string, string | null> = {
    id,
    ferme_id: FERME,
    type: "realise",
    date: AUJOURDHUI,
    horodatage: `${AUJOURDHUI}T07:00:00.000Z`,
    auteur_id: UTILISATEUR,
    source: "tap",
    serie_id: serieId,
    campagne_id: null,
    emplacement_ids: JSON.stringify([emplacementId]),
    note: null,
    photos: "[]",
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ etape, quantiteReelle: null }),
    cree_le: `${AUJOURDHUI}T07:00:01.000Z`,
    origine_id: id,
  };
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO evenement (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`,
    c.map((k) => ligne[k] ?? null),
  );
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
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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

async function tours(n = 15): Promise<void> {
  for (let k = 0; k < n; k++) await unTour();
}

async function attendre(
  condition: () => boolean,
  message: string,
  nombre = 400,
): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

async function attendreMs(
  condition: () => boolean,
  message: string,
  ms = 2_000,
): Promise<void> {
  const fin = Date.now() + ms;
  while (!condition() && Date.now() < fin) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(condition(), message).toBe(true);
}

async function rendre(porte: PorteDonnees, stockage: StockageInstantane): Promise<void> {
  await act(async () => {
    racine.render(
      <ecran.EcranAujourdhui
        porte={porte}
        fermeId={FERME}
        aujourdhui={() => AUJOURDHUI}
        stockage={stockage}
        utilisateurId={UTILISATEUR}
      />,
    );
    await Promise.resolve();
  });
}

const taches = (): HTMLElement[] => [
  ...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]'),
];
const cles = (): string[] => taches().map((t) => String(t.dataset.cle));
const tache = (cle: string): HTMLElement | undefined =>
  taches().find((t) => t.dataset.cle === cle);

function boutonFaitDe(cle: string): HTMLButtonElement | undefined {
  const t = tache(cle);
  return t === undefined
    ? undefined
    : [...t.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
        (x.getAttribute("aria-label") ?? x.textContent)
          .trim()
          .startsWith("Marquer fait"),
      );
}

function boutonFait(cle: string): HTMLButtonElement {
  const b = boutonFaitDe(cle);
  expect(
    b,
    `bouton « Marquer fait » de ${cle} (tâches : ${cles().join(", ")})`,
  ).toBeDefined();
  if (b === undefined) throw new Error(`bouton absent pour ${cle}`);
  return b;
}

/** Masquée : la carte a quitté la liste, ou son bouton « Marquer fait » est désactivé. */
function masquee(cle: string): boolean {
  if (tache(cle) === undefined) return true;
  const b = boutonFaitDe(cle);
  return b === undefined || b.disabled || b.getAttribute("aria-disabled") === "true";
}

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

/** Tape « Fait » sur `cle` si son bouton est encore actif (un tap de plus sur une tâche masquée ne fait rien). */
async function toucherSiActif(cle: string): Promise<void> {
  const b = boutonFaitDe(cle);
  if (b === undefined || b.disabled || b.getAttribute("aria-disabled") === "true") return;
  await toucher(b);
}

const messages = (): string[] =>
  [...conteneur.querySelectorAll('[role="status"], [role="alert"]')].map((e) =>
    e.textContent.replace(/\s+/g, " ").trim(),
  );
const alertes = (): string[] =>
  [...conteneur.querySelectorAll('[role="alert"]')].map((e) =>
    e.textContent.replace(/\s+/g, " ").trim(),
  );

// ── Scénario ─────────────────────────────────────────────────────────────────────────────────

/** Ouverture ordinaire : journée relue, instantané gardé. */
async function ouvrirEtGarder(stockage: StockageTest): Promise<void> {
  const p = nouvellePorte(false);
  await rendre(p.porte, stockage);
  await attendre(() => taches().length > 0, "tâches de la journée relue");
  await attendreMs(() => horsSession(stockage) !== "", "un instantané est gardé");
  for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} dans la journée`).toBeDefined();
}

/** Lancement : modules rechargés, porte dont les lectures sont retenues, instantané dessiné. */
async function lancer(stockage: StockageTest): Promise<PorteTest> {
  fermerRacine();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  const p = nouvellePorte(true);
  await rendre(p.porte, stockage);
  await attendre(
    () => [CAROTTE, CHOU, RADIS].every((c) => tache(c) !== undefined),
    "carotte, chou et radis dessinés depuis l’instantané (lectures retenues)",
  );
  return p;
}

/**
 * Tape « Fait » sur chaque clé, à la suite, lectures retenues (la lecture ciblée du premier est
 * en cours) ; vérifie que chaque tâche touchée est masquée dès son tap, avant toute lecture.
 */
async function taperALaSuite(suite: readonly string[]): Promise<void> {
  const touchees = new Set<string>();
  for (const cle of suite) {
    if (!touchees.has(cle)) await toucher(boutonFait(cle));
    else await toucherSiActif(cle);
    touchees.add(cle);
    for (const t of touchees) {
      expect(
        masquee(t),
        `${t} masquée dès son tap, pendant la lecture ciblée du premier « Fait » (après le tap sur ${cle})`,
      ).toBe(true);
    }
  }
}

// ── F1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13g, F1 : trois « Fait » tapés à la suite au lancement", () => {
  it("chacun masqué tout de suite ; trois réalisés, un par tâche, dans l’ordre des taps, aucun perdu, aucun en double", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    const p = await lancer(stockage);
    remiseAZero();

    await taperALaSuite([CAROTTE, CHOU, RADIS]);

    p.ouvrir();
    await attendre(() => clesEcrites().length >= 3, `trois réalisés écrits (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);

    expect(clesEcrites(), "trois réalisés, dans l’ordre des taps, aucun en double").toEqual([CAROTTE, CHOU, RADIS]);
    expect(nouveauxEvenements(), "aucune autre écriture").toHaveLength(3);
    for (const e of nouveauxRealises()) {
      const r = validerSaisie({ ...e });
      expect(r.ok, r.ok ? "" : r.erreur.message).toBe(true);
      expect(e.date).toBe(AUJOURDHUI);
    }
    expect(alertes(), "aucune erreur").toEqual([]);

    // La journée relue confirme : les trois tâches sont faites, le reste est là.
    await attendre(() => tache(cleTache(SERIE.batavia, "plantation")) !== undefined, "journée relue dessinée");
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} faite, plus dans la journée relue`).toBeUndefined();
  });
});

// ── F2 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13g, F2 : un tap de plus sur une tâche déjà touchée", () => {
  it("carotte, chou, carotte, radis : trois réalisés, la carotte une seule fois", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    const p = await lancer(stockage);
    remiseAZero();

    await taperALaSuite([CAROTTE, CHOU, CAROTTE, RADIS]);

    p.ouvrir();
    await attendre(() => clesEcrites().length >= 3, `trois réalisés écrits (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);
    expect(clesEcrites(), "trois réalisés, dans l’ordre, la carotte une seule fois").toEqual([CAROTTE, CHOU, RADIS]);
    expect(nouveauxEvenements()).toHaveLength(3);
  });
});

// ── F3 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13g, F3 : chaque « Fait » de la file a sa vérification", () => {
  it("chou fait ailleurs depuis l’instantané : refusé (« déjà »), carotte et radis écrits dans l’ordre", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    realiseRecu(SERIE.chou, "plantation", EMPLACEMENT.t2p03);
    const p = await lancer(stockage);
    remiseAZero();

    await taperALaSuite([CAROTTE, CHOU, RADIS]);

    p.ouvrir();
    await attendre(() => clesEcrites().length >= 2, `carotte et radis écrits (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);
    expect(clesEcrites(), "le chou, déjà fait, n’est pas écrit ; les deux autres, dans l’ordre").toEqual([CAROTTE, RADIS]);
    expect(nouveauxEvenements()).toHaveLength(2);
    expect(
      base.lireDirect<{ n: number }>(
        "SELECT count(*) AS n FROM evenement WHERE type = 'realise' AND remplace_sorte IS NULL AND serie_id = ?",
        [SERIE.chou],
      )[0]?.n,
      "un seul réalisé pour la plantation du chou",
    ).toBe(1);
    expect(
      messages().some((m) => /déjà/i.test(m)),
      `un message dit « déjà », encore visible quand la file a fini (messages : ${messages().join(" | ")})`,
    ).toBe(true);
    expect(tache(CHOU), "le chou reste hors de la liste").toBeUndefined();
  });

  it("radis reçu par la synchro pendant que la file tourne : pas de second réalisé du radis", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    const p = await lancer(stockage);
    remiseAZero();

    await taperALaSuite([CAROTTE, CHOU, RADIS]);

    // Dès que la carotte est écrite, l'autre téléphone a déjà noté le radis : il arrive par la
    // synchro avant que la file n'en soit au radis (lecture ciblée ou écriture).
    let recu = false;
    const arreter = base.onChange(
      {
        onChange: () => {
          if (recu || !clesEcrites().includes(CAROTTE)) return;
          recu = true;
          realiseRecu(SERIE.radis, "semis_direct", EMPLACEMENT.t2p05);
        },
      },
      { tables: ["evenement"] },
    );
    try {
      p.ouvrir();
      await attendre(
        () => recu && clesEcrites().includes(CHOU),
        `carotte et chou écrits (écrits : ${clesEcrites().join(", ")})`,
      );
      await tours(60);
    } finally {
      arreter();
    }
    expect(clesEcrites(), "carotte puis chou, écrits par l’écran ; le radis, reçu entre temps, ne l’est pas").toEqual([CAROTTE, CHOU]);
    expect(
      base.lireDirect<{ n: number }>(
        "SELECT count(*) AS n FROM evenement WHERE type = 'realise' AND remplace_sorte IS NULL AND serie_id = ?",
        [SERIE.radis],
      )[0]?.n,
      "un seul réalisé pour le semis du radis (celui reçu)",
    ).toBe(1);
  });
});
