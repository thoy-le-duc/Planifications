// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13d — retouches de la relecture du chef (code c203d3b … 3717ea8). Même banc
 * que ./instantane.test.tsx : stockage injecté, lancement simulé par `vi.resetModules()` et une
 * nouvelle porte dont les lectures sont retenues ; ferme du jour (./test/ferme-du-jour.ts),
 * aujourd'hui = 2026-09-30 (un mercredi).
 *
 *   R1  Écriture différente de l'affichage : l'itinéraire de la batavia a changé depuis
 *       l'instantané (travaux renumérotés). La carte de l'instantané dit « Grelinette », le
 *       travail relu au même numéro et à la même date est « Compost » : « Fait » n'écrit RIEN
 *       (on n'écrit pas autre chose que ce que le maraîcher a touché), et la carte n'est pas
 *       retirée en silence : elle reste, ou un message (role status ou alert) le dit.
 *   R2  Tâche déjà faite ailleurs (`lireTacheCiblee` rend null) : rien n'est écrit, ET un message
 *       le dit (role status ou alert, « Déjà notée depuis un autre téléphone » ou approchant :
 *       le texte contient « déjà »).
 *   R3  Session disparue (déconnexion ou autre compte dans un autre onglet) : l'instantané n'est
 *       plus écrit, ni par la réécriture différée en attente, ni par une journée relue ensuite.
 *       Règle : l'instantané de `utilisateurId` ne s'écrit que si la session rangée dans
 *       `stockage` (clé CLE_SESSION) est celle de cet utilisateur.
 *   R4  Garde-fou d'équivalence : `lireTacheCiblee` rend exactement la tâche de la journée
 *       (`calculerJournee(lireJournee(…))`), pour chaque tâche (travaux répétés, occurrence
 *       visée, campagne), avant et après deux « Fait », une annulation et un changement de
 *       date ; une tâche faite rend null.
 *   R5  Minuit, écran ouvert sur l'instantané : au passage au nouveau jour (visibilitychange),
 *       l'instantané de la veille n'est plus dessiné ; c'est la journée relue du nouveau jour.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from "@planif/sync";
import type { Id } from "@planif/core";
import {
  creerBaseMemoire,
  type BaseMemoire,
} from "../../../../../packages/sync/src/test/base-memoire.ts";
import { CLE_SESSION, type SessionConnexion } from "../../connexion/session.ts";
import {
  calculerJournee,
  lireJournee,
  lireTacheCiblee,
  type Journee,
} from "./calculs.ts";
import {
  annulerSaisie,
  changerDate,
  marquerFait,
  marquerTravailFait,
  type ContexteEcriture,
} from "./ecritures.ts";
import { creerBasePowerSync, type SchemaJson } from "./test/base-powersync.ts";
import type {
  ModuleEcranAujourdhui,
  StockageInstantane,
} from "./test/contrat.ts";
import {
  cleTache,
  cleTravail,
  COMPOST,
  DESHERBAGE_BATAVIA,
  EMPLACEMENT,
  ecrireFermeDuJour,
  FERME,
  GRELINETTE,
  SERIE,
  UTILISATEUR,
  type OptionsFermeDuJour,
} from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";
const DEMAIN = "2026-10-01";
const MAINTENANT = new Date("2026-09-30T10:00:00.000Z");
const AUTRE_UTILISATEUR = "0192f0c1-13d0-7000-8000-00000000a001";
const j = (n: number): string => {
  const d = new Date(`${AUJOURDHUI}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

function stockageMemoire(utilisateurId = UTILISATEUR): StockageTest {
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify(session(utilisateurId))],
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

/** Ce qui est rangé, hors session. */
const horsSession = (s: StockageTest): string =>
  [...s.valeurs]
    .filter(([c]) => c !== CLE_SESSION)
    .map(([, v]) => v)
    .join("\n");

// ── Base, portes ─────────────────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly serie_id: string | null;
  readonly remplace_sorte: string | null;
  readonly [colonne: string]: unknown;
}

let base: BaseMemoire;
let evenementsAvant = new Set<string>();
const evenements = (): LigneEvenement[] =>
  base.lireDirect<LigneEvenement>(
    "SELECT * FROM evenement ORDER BY horodatage, id",
  );
const nouveauxEvenements = () =>
  evenements().filter((e) => !evenementsAvant.has(e.id));
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
const idRecu = () =>
  `0192f0c1-13d1-7000-8000-0000000c${(++compteurRecus).toString(16).padStart(4, "0")}`;

/** Plantation du chou marquée faite sur un autre téléphone, reçue par la synchro. */
function plantationChouRecue(): void {
  const id = idRecu();
  const ligne: Record<string, string | null> = {
    id,
    ferme_id: FERME,
    type: "realise",
    date: AUJOURDHUI,
    horodatage: `${AUJOURDHUI}T07:00:00.000Z`,
    auteur_id: UTILISATEUR,
    source: "tap",
    serie_id: SERIE.chou,
    campagne_id: null,
    emplacement_ids: JSON.stringify([EMPLACEMENT.t2p03]),
    note: null,
    photos: "[]",
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ etape: "plantation", quantiteReelle: null }),
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

async function preparer(options: OptionsFermeDuJour = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI, options);
  remiseAZero();
}

let baseOuverte = false;
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  baseOuverte = false;
});

afterEach(() => {
  fermerRacine();
  if (baseOuverte) base.fermer();
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
  nombre = 300,
): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

async function pause(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function attendreMs(
  condition: () => boolean,
  message: string,
  ms = 2_000,
): Promise<void> {
  const fin = Date.now() + ms;
  while (!condition() && Date.now() < fin) await pause(20);
  expect(condition(), message).toBe(true);
}

/** Jour du téléphone, que le test fait passer minuit. */
let jourTelephone = AUJOURDHUI;

async function rendre(
  porte: PorteDonnees,
  stockage: StockageInstantane,
  utilisateurId = UTILISATEUR,
): Promise<void> {
  await act(async () => {
    racine.render(
      <ecran.EcranAujourdhui
        porte={porte}
        fermeId={FERME}
        aujourdhui={() => jourTelephone}
        stockage={stockage}
        utilisateurId={utilisateurId}
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

function boutonFait(cle: string): HTMLElement {
  const t = tache(cle);
  const b =
    t === undefined
      ? undefined
      : [...t.querySelectorAll<HTMLElement>("button")].find((x) =>
          (x.getAttribute("aria-label") ?? x.textContent)
            .trim()
            .startsWith("Marquer fait"),
        );
  expect(
    b,
    `bouton « Marquer fait » de ${cle} (tâches : ${cles().join(", ")})`,
  ).toBeDefined();
  if (b === undefined) throw new Error(`bouton absent pour ${cle}`);
  return b;
}

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

/** Textes des messages de l'écran (role status ou alert). */
const messages = (): string[] =>
  [...conteneur.querySelectorAll('[role="status"], [role="alert"]')].map((e) =>
    e.textContent.replace(/\s+/g, " ").trim(),
  );

/** Ouverture ordinaire : journée relue, instantané gardé. */
async function ouvrirEtGarder(stockage: StockageTest): Promise<string[]> {
  const p = nouvellePorte(false);
  await rendre(p.porte, stockage);
  await attendre(() => taches().length > 0, "tâches de la journée relue");
  await attendreMs(
    () => horsSession(stockage) !== "",
    "un instantané est gardé",
  );
  return cles();
}

async function relancer(stockage: StockageTest): Promise<PorteTest> {
  fermerRacine();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  const p = nouvellePorte(true);
  await rendre(p.porte, stockage);
  return p;
}

// ── R1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, R1 : « Fait » sur une carte de l’instantané que la base ne décrit plus pareil", () => {
  it("travaux renumérotés (Grelinette → Compost au même numéro et à la même date) : rien n’est écrit, la carte n’est pas retirée en silence", async () => {
    await preparer({ travaux: true });
    baseOuverte = true;
    const GRELINETTE_CLE = cleTravail(SERIE.batavia, 0, j(-12));
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    expect(
      tache(GRELINETTE_CLE)?.textContent ?? "",
      "carte de la grelinette",
    ).toMatch(/grelinette/i);

    // Depuis le bureau : l'itinéraire de la batavia est refait, le compost passe en premier, à
    // la date qu'avait la grelinette ; la grelinette passe en second.
    const travaux = [
      { ...COMPOST, decalageJours: GRELINETTE.decalageJours },
      { ...GRELINETTE, decalageJours: COMPOST.decalageJours },
    ];
    base.recevoir(
      "UPDATE serie SET parametres = json_set(parametres, '$.travauxPrevus', json(?)) WHERE id = ?",
      [JSON.stringify(travaux), SERIE.batavia],
    );

    const p = await relancer(stockage);
    await attendre(
      () => tache(GRELINETTE_CLE) !== undefined,
      "carte de l’instantané dessinée",
    );
    expect(tache(GRELINETTE_CLE)?.textContent ?? "").toMatch(/grelinette/i);
    remiseAZero();
    await toucher(boutonFait(GRELINETTE_CLE));
    p.ouvrir();
    await tours(80);

    expect(
      nouveauxEvenements().map((e) => `${e.type} ${String(e.detail)}`),
      "rien n’est écrit : le maraîcher a touché « Grelinette », la base dit « Compost »",
    ).toEqual([]);
    // Pas de retrait silencieux : la carte (relue : compost) est là, ou un message le dit.
    expect(
      tache(GRELINETTE_CLE) !== undefined || messages().some((m) => m !== ""),
      `carte présente ou message (messages : ${messages().join(" | ")})`,
    ).toBe(true);
  });
});

// ── R2 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, R2 : tâche déjà faite ailleurs, « Fait » sur l’instantané", () => {
  it("rien n’est écrit, et un message dit que la tâche est déjà notée", async () => {
    await preparer();
    baseOuverte = true;
    const CHOU = cleTache(SERIE.chou, "plantation");
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    plantationChouRecue();

    const p = await relancer(stockage);
    await attendre(
      () => tache(CHOU) !== undefined,
      "chou dessiné depuis l’instantané",
    );
    remiseAZero();
    await toucher(boutonFait(CHOU));
    p.ouvrir();
    await tours(80);
    expect(nouveauxEvenements(), "rien n’est écrit").toHaveLength(0);
    expect(
      messages().some((m) => /déjà/i.test(m)),
      `message « déjà notée » (messages : ${messages().join(" | ")})`,
    ).toBe(true);
  });
});

// ── R3 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, R3 : session disparue, l’instantané n’est plus écrit", () => {
  /** Déconnexion dans un autre onglet : session et instantané retirés du stockage. */
  function deconnexionAilleurs(s: StockageTest): void {
    for (const c of [...s.valeurs.keys()]) s.valeurs.delete(c);
  }

  it("réécriture différée en attente quand la session disparaît : rien n’est écrit", async () => {
    await preparer();
    baseOuverte = true;
    const stockage = stockageMemoire();
    const p = nouvellePorte(false);
    await rendre(p.porte, stockage);
    await attendre(() => taches().length > 0, "tâches relues");
    // Tout de suite après l'affichage (avant la réécriture différée) : déconnexion ailleurs.
    deconnexionAilleurs(stockage);
    await pause(1_000);
    expect(
      [...stockage.valeurs.keys()],
      "rien du compte n’est réécrit après la déconnexion",
    ).toEqual([]);
  });

  it("journée relue après la déconnexion (synchro) : rien n’est écrit", async () => {
    await preparer();
    baseOuverte = true;
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    deconnexionAilleurs(stockage);
    plantationChouRecue();
    await attendre(
      () => tache(cleTache(SERIE.chou, "plantation")) === undefined,
      "journée relue",
    );
    await pause(1_000);
    expect(
      [...stockage.valeurs.keys()],
      "rien du compte n’est réécrit après la déconnexion",
    ).toEqual([]);
  });

  it("autre compte connecté dans un autre onglet : l’instantané du premier n’est pas réécrit", async () => {
    await preparer();
    baseOuverte = true;
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    deconnexionAilleurs(stockage);
    stockage.valeurs.set(
      CLE_SESSION,
      JSON.stringify(session(AUTRE_UTILISATEUR)),
    );
    plantationChouRecue();
    await attendre(
      () => tache(cleTache(SERIE.chou, "plantation")) === undefined,
      "journée relue",
    );
    await pause(1_000);
    expect(
      [...stockage.valeurs.keys()],
      "seule la session de l’autre compte",
    ).toEqual([CLE_SESSION]);
  });
});

// ── R4 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, R4 : lireTacheCiblee rend la tâche de la journée, exactement", () => {
  async function journee(porte: PorteDonnees): Promise<Journee> {
    return calculerJournee(
      await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT),
      AUJOURDHUI,
    );
  }

  async function verifierChaqueTache(
    porte: PorteDonnees,
    jr: Journee,
  ): Promise<void> {
    for (const t of jr.taches) {
      const ciblee = await lireTacheCiblee(porte, FERME, AUJOURDHUI, t.cle);
      expect(ciblee, `tâche ${t.cle}`).toEqual(t);
    }
  }

  it.each([
    [
      "travaux répétés (arrosage : deux cartes du même travail)",
      { travaux: true, arrosage: true },
    ],
    [
      "occurrence visée (désherbage de la batavia, Fait en retard)",
      { travaux: true, faitEnRetard: true },
    ],
  ] as const)(
    "%s : chaque tâche, avant puis après deux « Fait », une annulation et un changement de date",
    async (_cas, options) => {
      const pb = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
      try {
        await ecrireFermeDuJour(pb, AUJOURDHUI, options);
        const porte = creerPorte(pb, {
          utilisateurId: UTILISATEUR as Id<"Utilisateur">,
          fermeId: FERME as Id<"Ferme">,
        });
        const ctx: ContexteEcriture = {
          porte,
          fermeId: FERME,
          aujourdhui: AUJOURDHUI,
        };

        const avant = await journee(porte);
        expect(
          avant.taches.some((t) => t.culture.cible.sorte === "campagne"),
          "une tâche de campagne (fraise)",
        ).toBe(true);
        expect(
          avant.taches.some((t) => t.tache.etape === "travail"),
          "des tâches de travail",
        ).toBe(true);
        await verifierChaqueTache(porte, avant);

        // Deux « Fait » : la plantation du chou, et le premier travail affiché (en retard d'abord).
        const chou = avant.taches.find(
          (t) => t.cle === cleTache(SERIE.chou, "plantation"),
        );
        const travail = avant.taches.find((t) => t.tache.etape === "travail");
        if (
          chou?.tache.etape !== "plantation" ||
          travail?.tache.etape !== "travail"
        )
          throw new Error("tâches du banc absentes");
        await marquerFait(ctx, chou.culture, "plantation");
        await marquerTravailFait(
          ctx,
          travail.culture,
          travail.tache.travail,
          travail.tache.datePrevue,
        );
        // Occurrence visée (T22b) : le désherbage de la batavia en retard, s'il est là.
        const desherbage = avant.taches.find(
          (t) => t.cle === cleTravail(SERIE.batavia, 2, j(-13)),
        );
        if (desherbage?.tache.etape === "travail" && desherbage !== travail) {
          expect(desherbage.tache.travail.type).toBe(DESHERBAGE_BATAVIA.type);
          await marquerTravailFait(
            ctx,
            desherbage.culture,
            desherbage.tache.travail,
            desherbage.tache.datePrevue,
          );
        }

        const milieu = await journee(porte);
        const faitChou = milieu.historique.find(
          (h) =>
            h.evenement.detail.type === "realise" &&
            h.culture?.cibleId === SERIE.chou,
        );
        const faitTravail = milieu.historique.find(
          (h) =>
            h.evenement.detail.type === "intervention" &&
            h.evenement.date === AUJOURDHUI,
        );
        if (faitChou === undefined || faitTravail === undefined)
          throw new Error("saisies absentes de l’historique");
        // Une annulation (le chou revient), un changement de date (le travail fait hier).
        await annulerSaisie(ctx, faitChou.evenement);
        await changerDate(ctx, faitTravail.evenement, j(-1));

        const apres = await journee(porte);
        await verifierChaqueTache(porte, apres);
        expect(
          apres.taches.some((t) => t.cle === chou.cle),
          "le chou annulé revient",
        ).toBe(true);

        // Une tâche faite (absente de la journée) rend null.
        const faites = avant.taches.filter(
          (t) => !apres.taches.some((x) => x.cle === t.cle),
        );
        expect(faites.length, "au moins une tâche faite").toBeGreaterThan(0);
        for (const t of faites)
          expect(
            await lireTacheCiblee(porte, FERME, AUJOURDHUI, t.cle),
            `tâche faite ${t.cle}`,
          ).toBeNull();
      } finally {
        pb.fermer();
      }
    },
  );
});

// ── R5 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, R5 : minuit, écran ouvert sur l’instantané", () => {
  it("passage au nouveau jour : l’instantané de la veille n’est plus dessiné, la journée relue du nouveau jour l’est", async () => {
    await preparer();
    baseOuverte = true;
    jourTelephone = AUJOURDHUI;
    try {
      // Référence : le lendemain, sans instantané.
      const ref = nouvellePorte(false);
      jourTelephone = DEMAIN;
      await rendre(
        ref.porte,
        stockageMemoire(AUTRE_UTILISATEUR),
        AUTRE_UTILISATEUR,
      );
      await attendre(() => taches().length > 0, "tâches du lendemain");
      await tours(20);
      const lendemain = cles();
      fermerRacine();
      nouvelleRacine();

      jourTelephone = AUJOURDHUI;
      const stockage = stockageMemoire();
      const veille = await ouvrirEtGarder(stockage);

      const p = await relancer(stockage);
      await tours(5);
      expect(cles(), "instantané de la veille au lancement").toEqual(veille);

      // Minuit passe, le téléphone revient au premier plan.
      jourTelephone = DEMAIN;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
      await tours(20);
      expect(
        cles(),
        "plus rien de la veille (lectures encore retenues)",
      ).toEqual([]);

      p.ouvrir();
      await attendre(
        () => taches().length > 0,
        "journée du nouveau jour relue",
      );
      await tours(20);
      expect(cles()).toEqual(lendemain);
    } finally {
      jourTelephone = AUJOURDHUI;
    }
  });
});
