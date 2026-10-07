// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13k — « Fait » accepté avant la base
 * (docs/backlog/T13k-fait-avant-base.md ; Q26 acceptée le 2026-10-07, docs/questions.md).
 *
 * Constat (relecture T13g) : avant l'ouverture de la base (porte null), l'instantané est dessiné
 * en lecture seule ; un tap sur « Fait » entre ≈ 0,4 s et ≈ 1 s ne fait rien, sans message.
 *
 * Règles du ticket (Q26) :
 *   - « Fait » actif dès l'instantané : la carte est masquée au tap, la file attend la porte,
 *     puis lecture ciblée et vérification `DejaFait` comme aujourd'hui ;
 *   - si la vraie ferme diffère de la ferme montrée, les « Fait » en attente sont abandonnés
 *     avec un message, jamais écrits sur une autre ferme (idem si l'utilisateur change).
 *
 * Banc : celui de ./fait-en-file.test.tsx (ferme du jour, aujourd'hui = 2026-09-30, stockage de
 * l'instantané injecté). Une première ouverture, base ouverte, garde l'instantané ; la dernière
 * ferme montrée à l'utilisateur est notée (comme le fait l'appli, src/donnees/ferme-memorisee.ts).
 * Un « lancement avant la base » est un nouveau rendu après `vi.resetModules()` avec
 * `porte={null}` et `fermeId={null}` : l'écran dessine l'instantané de la ferme montrée. La porte
 * « arrive » ensuite par un nouveau rendu (même racine, même écran). `creerPorte` est rechargé
 * avec l'écran : une seule classe DejaFait (contre-relecture T13l).
 *
 * Masquée avant la base : la carte quitte la liste (l'instantané retire les tâches touchées).
 *
 *   K1  Trois « Fait » (carotte, chou, radis) tapés avant la base : chaque bouton est actif,
 *       chaque carte part dès son tap, rien n'est lu ni écrit. La porte arrivée : trois
 *       réalisés, dans l'ordre des taps, chacun accepté par validerSaisie, aucun en double ;
 *       chacun écrit avec sa vérification « déjà fait » (vérificateur passé à ecrireEnsemble)
 *       et après une lecture (lecture ciblée) ; aucune erreur ; la journée relue ne les montre
 *       plus.
 *   K2  Vérification « déjà fait » au moment d'écrire : le réalisé du radis arrive par la synchro
 *       juste avant son écriture (après sa lecture ciblée) : DejaFait, rien d'écrit pour le
 *       radis, un avis « déjà notée » ; carotte et chou écrits ; aucune erreur.
 *   K3  Le réalisé du chou arrive par la synchro APRÈS les taps et AVANT la porte : sa lecture
 *       ciblée le voit fait, rien d'écrit pour lui, un avis « déjà » ; carotte et radis écrits.
 *
 *   I1  Isolement entre fermes : trois « Fait » tapés avant la base sur la ferme montrée, puis
 *       la porte arrive sur une AUTRE ferme : rien n'est écrit (ni sur l'une ni sur l'autre),
 *       un message (role="status" ou "alert") dit que les « Fait » tapés n'ont pas été
 *       enregistrés (texte qui contient « abandonn » ou « enregistr ») ; aucune carte de la
 *       ferme montrée ne reste.
 *   I2  Idem si l'utilisateur change avant la base (session d'un autre compte, même ferme) :
 *       rien n'est écrit ; un message le dit, sans nommer les cultures touchées par l'autre.
 *
 *   N1  Non-régression des autres gestes avant la base : « Peser » (début de récolte de la
 *       fraise) reste inactif avant la base et devient actif avec la porte ; aucun bouton de
 *       l'historique n'est actif avant la base ; le bouton « Historique » reste inactif.
 *   N2  « Annuler » (bandeau) après des « Fait » tapés avant la base : jamais ignoré sans retour
 *       (T13l). S'il est présent et actif, le toucher annule le DERNIER « Fait » tapé (le radis)
 *       après son écriture, carotte et chou restent faits ; sinon (absent ou inactif), les trois
 *       sont écrits et rien n'est annulé.
 *
 * « Changer la date » n'est pas testé avant la base : l'historique n'y est pas dessiné (T13g).
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_LOCAL, type PorteDonnees, type creerPorte as CreerPorte } from "@planif/sync";
import { validerSaisie, type Id } from "@planif/core";
import {
  creerBaseMemoire,
  type BaseMemoire,
} from "../../../../../packages/sync/src/test/base-memoire.ts";
import { CLE_SESSION, type SessionConnexion } from "../../connexion/session.ts";
import { noterFermeMontree } from "../../donnees/ferme-memorisee.ts";
import { cleInstantane } from "./cle-instantane.ts";
import type { ProprietesEcranAujourdhui as ProprietesAvantBase } from "./EcranAujourdhui.tsx";
import type {
  ModuleEcranAujourdhui,
  StockageInstantane,
} from "./test/contrat.ts";
import {
  CAMPAGNE,
  cleTache,
  EMPLACEMENT,
  ecrireFermeDuJour,
  FERME,
  SERIE,
  UTILISATEUR,
} from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";
/** Une autre ferme (jamais la ferme du jour). */
const AUTRE_FERME = "0192f0c1-13ab-7000-8000-00000000f0f0";
/** Un autre compte du même téléphone. */
const AUTRE_UTILISATEUR = "0192f0c1-13ab-7000-8000-00000000a0a0";

const CAROTTE = cleTache(SERIE.carotte, "semis_direct");
const CHOU = cleTache(SERIE.chou, "plantation");
const RADIS = cleTache(SERIE.radis, "semis_direct");
const BATAVIA = cleTache(SERIE.batavia, "plantation");
const FRAISE = cleTache(CAMPAGNE.fraise, "debut_recolte");

let ecran: ModuleEcranAujourdhui;
let creerPorte: typeof CreerPorte;

async function chargerEcran(): Promise<void> {
  ecran = (await import(
    /* @vite-ignore */ CHEMIN_ECRAN
  )) as ModuleEcranAujourdhui;
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

// ── Base, portes ─────────────────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly ferme_id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
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
/** Ids des réalisés reçus par la synchro (écrits par « un autre téléphone », pas par l'écran). */
const recus = new Set<string>();
/** Nouveaux événements écrits par l'écran (hors réception de la synchro). */
const ecritsParLEcran = () => nouveauxEvenements().filter((e) => !recus.has(e.id));
/** Réalisés écrits par l'écran (ni annulations ni corrections), dans l'ordre d'écriture. */
const nouveauxRealises = () =>
  ecritsParLEcran().filter((e) => e.type === "realise" && e.remplace_sorte === null);
const cleDe = (e: LigneEvenement): string =>
  `${String(e.serie_id ?? e.campagne_id)}:${String((JSON.parse(e.detail) as { etape?: unknown }).etape)}`;
/** « <série>:<étape> » de chaque nouveau réalisé écrit par l'écran, dans l'ordre d'écriture. */
const clesEcrites = (): string[] => nouveauxRealises().map(cleDe);
const annulations = () => ecritsParLEcran().filter((e) => e.remplace_sorte === "annulation");

function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

const realisesDe = (serieId: string): number =>
  base.lireDirect<{ n: number }>(
    "SELECT count(*) AS n FROM evenement WHERE type = 'realise' AND remplace_sorte IS NULL AND serie_id = ?",
    [serieId],
  )[0]?.n ?? 0;

let compteurRecus = 0;
const idRecu = () => {
  const id = `0192f0c1-13ab-7000-8000-0000000e${(++compteurRecus).toString(16).padStart(4, "0")}`;
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

/** Ce que la porte a vu passer, dans l'ordre : lectures et écritures. */
type Operation =
  | { readonly sorte: "lire" }
  | { readonly sorte: "ecrire"; readonly verifiee: boolean; readonly parametres: readonly unknown[] };

interface PorteTest {
  readonly porte: PorteDonnees;
  readonly operations: Operation[];
}

/**
 * Porte de `utilisateurId` sur `fermeId`, qui note ses lectures et écritures. `avantEcriture`,
 * s'il est donné, tourne juste avant chaque `ecrireEnsemble` (après les lectures ciblées).
 */
function nouvellePorte(
  options: {
    readonly fermeId?: string;
    readonly utilisateurId?: string;
    readonly avantEcriture?: (parametres: readonly unknown[]) => void;
  } = {},
): PorteTest {
  const vraie = creerPorte(base, {
    utilisateurId: (options.utilisateurId ?? UTILISATEUR) as Id<"Utilisateur">,
    fermeId: (options.fermeId ?? FERME) as Id<"Ferme">,
  });
  const operations: Operation[] = [];
  const porte: PorteDonnees = {
    ...vraie,
    lire: <T,>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => {
      operations.push({ sorte: "lire" });
      return vraie.lire<T>(sql, parametres);
    },
    ecrireEnsemble: async (ordres, verifier) => {
      const parametres = ordres.flatMap((o) => [...(o.parametres ?? [])]);
      operations.push({ sorte: "ecrire", verifiee: verifier !== undefined, parametres });
      options.avantEcriture?.(parametres);
      return vraie.ecrireEnsemble(ordres, verifier);
    },
  };
  return { porte, operations };
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
  recus.clear();
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

async function rendre(
  porte: PorteDonnees | null,
  fermeId: string | null,
  stockage: StockageInstantane,
  utilisateurId: string = UTILISATEUR,
): Promise<void> {
  // Le contrat de test (contrat.ts) date d'avant T13g : la porte y est requise. Depuis T13g,
  // l'écran accepte porte et fermeId null (base pas encore ouverte).
  const Ecran = ecran.EcranAujourdhui as unknown as (p: ProprietesAvantBase) => ReactElement;
  await act(async () => {
    racine.render(
      <Ecran
        porte={porte}
        fermeId={fermeId}
        aujourdhui={() => AUJOURDHUI}
        stockage={stockage}
        utilisateurId={utilisateurId}
      />,
    );
    await Promise.resolve();
  });
}

const texte = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const taches = (): HTMLElement[] => [
  ...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]'),
];
const cles = (): string[] => taches().map((t) => String(t.dataset.cle));
const tache = (cle: string): HTMLElement | undefined =>
  taches().find((t) => t.dataset.cle === cle);

const inactif = (b: HTMLElement): boolean =>
  (b instanceof HTMLButtonElement && b.disabled) ||
  b.getAttribute("aria-disabled") === "true";

function boutonDe(cle: string, debut: string): HTMLButtonElement | undefined {
  const t = tache(cle);
  return t === undefined
    ? undefined
    : [...t.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
        (x.getAttribute("aria-label") ?? x.textContent).trim().startsWith(debut),
      );
}

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const messages = (): string[] =>
  [...conteneur.querySelectorAll('[role="status"], [role="alert"]')]
    .filter((e) => e.getAttribute("data-testid") !== "saisie-annulable")
    .map((e) => texte(e));
const alertes = (): string[] =>
  [...conteneur.querySelectorAll('[role="alert"]')].map((e) => texte(e));
const bandeau = (): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');

// ── Scénario ─────────────────────────────────────────────────────────────────────────────────

/** Ouverture ordinaire, base ouverte : journée relue, instantané gardé, ferme montrée notée. */
async function ouvrirEtGarder(stockage: StockageTest): Promise<void> {
  const p = nouvellePorte();
  await rendre(p.porte, FERME, stockage);
  await attendre(() => taches().length > 0, "tâches de la journée relue");
  await attendreMs(() => stockage.valeurs.has(cleInstantane(UTILISATEUR)), "un instantané est gardé");
  for (const c of [CAROTTE, CHOU, RADIS, FRAISE]) expect(tache(c), `${c} dans la journée`).toBeDefined();
  // L'appli note la ferme que la base a désignée (src/donnees/ferme-memorisee.ts, T13g).
  noterFermeMontree(stockage, UTILISATEUR, FERME);
}

/** Lancement AVANT la base : modules rechargés, porte null, instantané de la ferme montrée. */
async function lancerAvantBase(stockage: StockageTest): Promise<void> {
  fermerRacine();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  await rendre(null, null, stockage);
  await attendre(
    () => [CAROTTE, CHOU, RADIS].every((c) => tache(c) !== undefined),
    "carotte, chou et radis dessinés depuis l’instantané, avant la base",
  );
  remiseAZero();
}

/**
 * Tape « Fait » sur chaque clé, avant la base : bouton actif (Q26), carte retirée de la liste dès
 * le tap, rien d'écrit.
 */
async function taperAvantBase(suite: readonly string[]): Promise<void> {
  for (const cle of suite) {
    const b = boutonDe(cle, "Marquer fait");
    expect(b, `bouton « Marquer fait » de ${cle} (tâches : ${cles().join(", ")})`).toBeDefined();
    if (b === undefined) return;
    expect(inactif(b), `Q26 : « Marquer fait » de ${cle} actif dès l’instantané, avant la base`).toBe(false);
    await toucher(b);
    expect(tache(cle), `${cle} masquée dès son tap, avant la base`).toBeUndefined();
  }
  expect(nouveauxEvenements(), "rien d’écrit avant la base").toEqual([]);
}

// ── K1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13k, K1 : trois « Fait » tapés avant la base", () => {
  it("chacun masqué au tap ; la porte arrivée, trois réalisés dans l’ordre, chacun lu puis vérifié, aucun perdu ni doublé", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);

    await taperAvantBase([CAROTTE, CHOU, RADIS]);
    await tours(10);
    expect(nouveauxEvenements(), "toujours rien d’écrit tant que la base n’est pas là").toEqual([]);
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} reste masquée en attendant la base`).toBeUndefined();

    const p = nouvellePorte();
    await rendre(p.porte, FERME, stockage);
    await attendre(() => clesEcrites().length >= 3, `trois réalisés écrits (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);

    expect(clesEcrites(), "trois réalisés, dans l’ordre des taps, aucun en double").toEqual([CAROTTE, CHOU, RADIS]);
    expect(ecritsParLEcran(), "aucune autre écriture").toHaveLength(3);
    for (const e of nouveauxRealises()) {
      const r = validerSaisie({ ...e });
      expect(r.ok, r.ok ? "" : r.erreur.message).toBe(true);
      expect(e.date).toBe(AUJOURDHUI);
      expect(e.ferme_id, "écrit sur la ferme montrée, qui est la vraie").toBe(FERME);
    }

    const ecritures = p.operations.filter((o) => o.sorte === "ecrire");
    expect(ecritures, "trois écritures, une par « Fait »").toHaveLength(3);
    for (const o of ecritures) expect("verifiee" in o && o.verifiee, "chaque « Fait » écrit avec sa vérification « déjà fait »").toBe(true);
    expect(p.operations[0]?.sorte, "la porte arrivée, la file lit (lecture ciblée) avant d’écrire").toBe("lire");
    // Chaque « Fait » est relu avant son écriture : au moins une lecture entre deux écritures.
    const rangs = p.operations.flatMap((o, i) => (o.sorte === "ecrire" ? [i] : []));
    for (let k = 1; k < rangs.length; k++) {
      const entre = p.operations.slice((rangs[k - 1] ?? 0) + 1, rangs[k]);
      expect(entre.some((o) => o.sorte === "lire"), `lecture ciblée avant l’écriture n° ${String(k + 1)}`).toBe(true);
    }
    expect(alertes(), "aucune erreur").toEqual([]);

    await attendre(() => tache(BATAVIA) !== undefined, "journée relue dessinée");
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} faite, plus dans la journée relue`).toBeUndefined();
  });
});

// ── K2, K3 ───────────────────────────────────────────────────────────────────────────────────

describe("T13k, K2-K3 : vérification « déjà fait » des « Fait » tapés avant la base", () => {
  it("K2 : radis reçu par la synchro juste avant son écriture → DejaFait, avis « déjà notée », rien écrit pour lui", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);
    await taperAvantBase([CAROTTE, CHOU, RADIS]);

    let recu = false;
    const p = nouvellePorte({
      avantEcriture: (parametres) => {
        if (recu || !parametres.includes(SERIE.radis)) return;
        recu = true;
        // Après la lecture ciblée du radis, avant son écriture : seule la vérification le voit.
        realiseRecu(SERIE.radis, "semis_direct", EMPLACEMENT.t2p05);
      },
    });
    await rendre(p.porte, FERME, stockage);
    await attendre(() => recu && clesEcrites().length >= 2, `carotte et chou écrits, radis reçu (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);

    expect(clesEcrites(), "carotte puis chou ; le radis, déjà fait, n’est pas écrit").toEqual([CAROTTE, CHOU]);
    expect(realisesDe(SERIE.radis), "un seul réalisé du radis (celui reçu)").toBe(1);
    expect(
      messages().some((m) => /déjà notée/i.test(m)),
      `un avis « déjà notée » (messages : ${messages().join(" | ")})`,
    ).toBe(true);
    expect(alertes(), "un « déjà fait » n’est pas une erreur").toEqual([]);
    expect(tache(RADIS), "le radis reste hors de la liste").toBeUndefined();
  });

  it("K3 : chou reçu par la synchro entre les taps et la base → rien écrit pour lui, un avis « déjà »", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);
    await taperAvantBase([CAROTTE, CHOU, RADIS]);
    realiseRecu(SERIE.chou, "plantation", EMPLACEMENT.t2p03);

    const p = nouvellePorte();
    await rendre(p.porte, FERME, stockage);
    await attendre(() => clesEcrites().length >= 2, `carotte et radis écrits (écrits : ${clesEcrites().join(", ")})`);
    await tours(60);

    expect(clesEcrites(), "le chou, déjà fait, n’est pas écrit ; les deux autres, dans l’ordre").toEqual([CAROTTE, RADIS]);
    expect(realisesDe(SERIE.chou), "un seul réalisé du chou (celui reçu)").toBe(1);
    expect(
      messages().some((m) => /déjà/i.test(m)),
      `un message dit « déjà » (messages : ${messages().join(" | ")})`,
    ).toBe(true);
    expect(tache(CHOU), "le chou reste hors de la liste").toBeUndefined();
  });
});

// ── I1, I2 ───────────────────────────────────────────────────────────────────────────────────

describe("T13k, isolement : les « Fait » d’avant la base ne vont jamais ailleurs", () => {
  it("I1 : la vraie ferme diffère de la ferme montrée → rien n’est écrit, un message le dit", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);
    await taperAvantBase([CAROTTE, CHOU, RADIS]);

    const p = nouvellePorte({ fermeId: AUTRE_FERME });
    await rendre(p.porte, AUTRE_FERME, stockage);
    await tours(60);

    expect(nouveauxEvenements(), "aucune écriture, ni sur la ferme montrée ni sur l’autre").toEqual([]);
    expect(p.operations.filter((o) => o.sorte === "ecrire"), "rien n’est envoyé à la porte de l’autre ferme").toEqual([]);
    expect(
      messages().some((m) => /abandonn|enregistr/i.test(m)),
      `un message dit que les « Fait » tapés n’ont pas été enregistrés (messages : ${messages().join(" | ")})`,
    ).toBe(true);
    for (const c of [CAROTTE, CHOU, RADIS]) expect(tache(c), `${c} : rien de la ferme montrée sur l’autre ferme`).toBeUndefined();
  });

  it("I2 : l’utilisateur change avant la base → rien n’est écrit, un message le dit sans nommer ses cultures", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);
    await taperAvantBase([CAROTTE, CHOU, RADIS]);

    // Un autre compte s'est connecté sur ce téléphone : sa session, sa porte, même ferme.
    stockage.valeurs.set(CLE_SESSION, JSON.stringify(session(AUTRE_UTILISATEUR)));
    const p = nouvellePorte({ utilisateurId: AUTRE_UTILISATEUR });
    await rendre(p.porte, FERME, stockage, AUTRE_UTILISATEUR);
    await tours(60);

    expect(nouveauxEvenements(), "aucune écriture au nom de l’autre utilisateur").toEqual([]);
    expect(p.operations.filter((o) => o.sorte === "ecrire"), "rien n’est envoyé à la porte de l’autre utilisateur").toEqual([]);
    const m = messages();
    expect(
      m.some((x) => /abandonn|enregistr/i.test(x)),
      `un message dit que les « Fait » tapés n’ont pas été enregistrés (messages : ${m.join(" | ")})`,
    ).toBe(true);
    for (const x of m) expect(x, "le message ne nomme pas les cultures touchées par l’autre compte").not.toMatch(/carotte|chou|radis/i);
  });
});

// ── N1, N2 ───────────────────────────────────────────────────────────────────────────────────

describe("T13k, non-régression : les autres gestes avant la base", () => {
  it("N1 : « Peser », l’historique et son bouton restent inactifs avant la base ; « Peser » s’active avec la porte", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);

    const peser = boutonDe(FRAISE, "Saisir une récolte");
    expect(peser, `« Peser » de la fraise dessiné (tâches : ${cles().join(", ")})`).toBeDefined();
    if (peser === undefined) return;
    expect(inactif(peser), "« Peser » inactif avant la base (inchangé)").toBe(true);
    const historique = [...conteneur.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"] button')];
    expect(historique.filter((b) => !inactif(b)).map((b) => texte(b)), "aucun bouton de l’historique actif avant la base").toEqual([]);
    const versHistorique = [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === "Historique");
    expect(versHistorique === undefined || inactif(versHistorique), "bouton « Historique » inactif avant la base (inchangé)").toBe(true);

    await taperAvantBase([CAROTTE]);
    const peserApres = boutonDe(FRAISE, "Saisir une récolte");
    expect(peserApres !== undefined && inactif(peserApres), "« Peser » toujours inactif après un « Fait » avant la base").toBe(true);

    const p = nouvellePorte();
    await rendre(p.porte, FERME, stockage);
    await attendre(() => clesEcrites().length >= 1, "la carotte est écrite");
    await attendre(() => {
      const b = boutonDe(FRAISE, "Saisir une récolte");
      return b !== undefined && !inactif(b);
    }, "« Peser » actif, base ouverte");
  });

  it("N2 : « Annuler » du bandeau après des « Fait » avant la base : jamais ignoré, il annule le dernier après son écriture", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await lancerAvantBase(stockage);
    await taperAvantBase([CAROTTE, CHOU, RADIS]);

    const b = bandeau();
    const annuler = b === null ? undefined : [...b.querySelectorAll<HTMLButtonElement>("button")].find((x) => texte(x) === "Annuler");
    const annule = annuler !== undefined && !inactif(annuler);
    if (annule) {
      expect(texte(b), "le bandeau nomme le dernier « Fait » tapé (le radis)").toMatch(/radis/i);
      await toucher(annuler);
      expect(nouveauxEvenements(), "rien d’écrit avant la base, même l’annulation").toEqual([]);
    }

    const p = nouvellePorte();
    await rendre(p.porte, FERME, stockage);
    await attendre(() => clesEcrites().length >= 3, `trois réalisés écrits (écrits : ${clesEcrites().join(", ")})`);
    if (annule) await attendre(() => annulations().length >= 1, "l’annulation est écrite");
    await tours(60);

    expect(clesEcrites(), "trois réalisés, dans l’ordre des taps").toEqual([CAROTTE, CHOU, RADIS]);
    const radis = nouveauxRealises()[2];
    if (annule) {
      const a = annulations();
      expect(a, "une seule annulation").toHaveLength(1);
      expect(a[0]?.remplace_evenement_id, "elle annule le radis, le dernier « Fait » tapé").toBe(radis?.id);
      const rangAnnulation = ecritsParLEcran().findIndex((e) => e.id === a[0]?.id);
      expect(rangAnnulation, "l’annulation est écrite après le radis").toBeGreaterThan(ecritsParLEcran().findIndex((e) => e.id === radis?.id));
      await attendre(() => tache(RADIS) !== undefined, "le radis annulé revient dans la liste");
    } else {
      expect(annulations(), "rien d’annulé : le bandeau n’offrait pas « Annuler »").toEqual([]);
    }
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});
