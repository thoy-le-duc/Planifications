// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13d — instantané de la journée (ouverture à froid sous 1 s), dans un DOM
 * simulé (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts) lue et écrite par la porte
 * (base mémoire), aujourd'hui = 2026-09-30. Contrat : ./test/contrat.ts, section T13d.
 *
 * Banc. Le stockage de l'instantané est injecté (propriété `stockage`, de la forme de
 * localStorage) : les tests ne supposent ni la clé ni le détail du format, seulement un texte
 * JSON portant `version`. Un « lancement » est simulé par un nouveau rendu, après
 * `vi.resetModules()` (plus rien en mémoire des modules de l'écran), sur une NOUVELLE porte de la
 * même base dont toutes les lectures (`porte.lire`) sont retenues jusqu'à ce que le test les
 * libère : tant qu'elles le sont, ce qui est dessiné ne peut venir que de l'instantané.
 * Les écritures (ecrireEnsemble) ne sont jamais retenues.
 *
 *   I1  Témoin : même jour, même ferme, même utilisateur : les tâches de l'instantané sont
 *       dessinées sans aucune lecture de la base (mêmes cartes que l'écran relu).
 *   I2  Instantané d'un autre jour, d'une autre ferme, d'un autre utilisateur : jamais montré ;
 *       l'écran attend la journée relue.
 *   I3  Instantané illisible, ou d'une autre version de format : ignoré sans planter.
 *   I4  Stockage indisponible (tout lève) ou plein (setItem lève) : l'écran marche comme avant
 *       T13d (tâches, « Fait »).
 *   I5  « Fait » pendant que l'instantané est affiché : tâche masquée dès le tap, UN réalisé écrit
 *       normalement (validerSaisie, emplacements relus dans la base), puis la journée relue le
 *       confirme et remplace l'instantané. Rien n'est écrit depuis l'instantané : emplacements
 *       changés depuis, ou tâche déjà faite ailleurs (aucun réalisé de plus).
 *   I6  La journée relue remplace l'instantané dès qu'elle arrive et gagne s'il diffère (réalisé
 *       fait ailleurs) ; l'instantané gardé ensuite est le sien.
 *   I7  Déconnexion (T09b, connexion/deconnexion.ts) : l'instantané est effacé, que l'API
 *       réponde ou non, même si l'effacement de la base échoue.
 *   I8  Contenu : rien de plus que l'écran (cultures absentes de l'écran, note d'événement,
 *       paramètres de série) ; taille bornée sur la grande ferme de T13b.
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
import {
  creerBasePowerSync,
  type BasePowerSync,
  type SchemaJson,
} from "./test/base-powersync.ts";
import {
  TAILLE_INSTANTANE_MAX_OCTETS,
  type ModuleEcranAujourdhui,
  type StockageInstantane,
} from "./test/contrat.ts";
import {
  CAMPAGNE,
  cleTache,
  EMPLACEMENT,
  ESPECE,
  EVENEMENT,
  ecrireFermeDuJour,
  FERME,
  PLANTATION,
  SERIE,
  UTILISATEUR,
} from "./test/ferme-du-jour.ts";
import {
  ecrireGrandeFerme,
  FERME_GRANDE,
  UTILISATEUR_GRANDE,
} from "./test/grande-ferme.ts";

/** Chemins tenus dans des variables, comme ecran.test.tsx et deconnexion.test.ts. */
const CHEMIN_ECRAN = "./index.ts";
const CHEMIN_DECONNEXION = "../../connexion/deconnexion.ts";
const AUJOURDHUI = "2026-09-30";
const DEMAIN = "2026-10-01";
const AUTRE_UTILISATEUR = "0192f0c1-13d0-7000-8000-00000000a001";
const AUTRE_FERME = "0192f0c1-13d0-7000-8000-00000000a002";

/** Écran chargé à neuf (après vi.resetModules() pour un lancement). */
let ecran: ModuleEcranAujourdhui;

async function chargerEcran(): Promise<void> {
  ecran = (await import(
    /* @vite-ignore */ CHEMIN_ECRAN
  )) as ModuleEcranAujourdhui;
}

// ── Stockages ────────────────────────────────────────────────────────────────────────────────

interface StockageTest extends StockageInstantane {
  readonly valeurs: Map<string, string>;
}

/**
 * Retouche (relecture du chef, R3) : la session de l'utilisateur est rangée dans le stockage,
 * comme dans l'appli ; l'instantané ne s'écrit que pour la session rangée.
 */
function stockageMemoire(utilisateurId: string = UTILISATEUR): StockageTest {
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify({ ...SESSION, utilisateurId })],
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

/** Navigation privée stricte, stockage refusé : tout lève. */
function stockageIndisponible(): StockageInstantane {
  const refus = () => {
    throw new DOMException("Stockage refusé", "SecurityError");
  };
  return { getItem: refus, setItem: refus, removeItem: refus };
}

/** Stockage plein : la lecture marche, l'écriture lève. */
function stockagePlein(): StockageTest {
  const s = stockageMemoire();
  return {
    ...s,
    setItem: () => {
      throw new DOMException("Quota dépassé", "QuotaExceededError");
    },
  };
}

/** Tout ce qui est rangé dans le stockage, en un texte. */
/** Tout ce qui est rangé dans le stockage, hors session, en un texte. */
const toutLeTexte = (s: StockageTest): string =>
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
  readonly emplacement_ids: string;
  readonly remplace_sorte: string | null;
  readonly detail: string;
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
const realisesChou = (): LigneEvenement[] =>
  evenements().filter(
    (e) =>
      e.type === "realise" &&
      e.remplace_sorte === null &&
      e.serie_id === SERIE.chou,
  );
const nouveauxRealisesChou = () =>
  realisesChou().filter((e) => !evenementsAvant.has(e.id));

function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

/** Porte de l'appli sur la base ; `retenue` : toutes ses lectures attendent `ouvrir()`. */
interface PorteTest {
  readonly porte: PorteDonnees;
  readonly ouvrir: () => void;
  /** Lectures demandées (retenues ou non). */
  readonly lectures: () => number;
}

function nouvellePorte(
  retenue: boolean,
  sur: BaseMemoire | BasePowerSync = base,
  ids = { utilisateurId: UTILISATEUR, fermeId: FERME },
): PorteTest {
  const vraie = creerPorte(sur, {
    utilisateurId: ids.utilisateurId as Id<"Utilisateur">,
    fermeId: ids.fermeId as Id<"Ferme">,
  });
  let liberer: () => void = () => undefined;
  let barriere: Promise<void> | null = retenue
    ? new Promise<void>((r) => {
        liberer = r;
      })
    : null;
  let n = 0;
  const porte: PorteDonnees = {
    ...vraie,
    lire: async <T,>(
      sql: string,
      parametres?: readonly unknown[],
    ): Promise<T[]> => {
      n++;
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
    lectures: () => n,
  };
}

let compteurRecus = 0;
const idRecu = () =>
  `0192f0c1-13d0-7000-8000-0000000b${(++compteurRecus).toString(16).padStart(4, "0")}`;

/** Ligne arrivée par la synchro (autre téléphone, bureau) : prévient les abonnés. */
function recevoir(
  table: string,
  ligne: Readonly<Record<string, string | number | null>>,
): void {
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO ${table} (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`,
    c.map((k) => ligne[k] ?? null),
  );
}

/** Plantation du chou marquée faite sur un autre téléphone, reçue par la synchro. */
function plantationChouRecue(): string {
  const id = idRecu();
  recevoir("evenement", {
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
  });
  return id;
}

/** Le chou change de planche depuis le bureau : T2-P03 libérée, nouvelle planche T2-P09. */
function chouDemenage(): string {
  const C = "2026-09-29T08:00:00.000Z";
  const zone =
    base.lireDirect<{ zone_id: string }>(
      "SELECT zone_id FROM emplacement WHERE id = ?",
      [EMPLACEMENT.t2p03],
    )[0]?.zone_id ?? null;
  const nouvelle = idRecu();
  recevoir("emplacement", {
    id: nouvelle,
    ferme_id: FERME,
    zone_id: zone,
    code: "T2-P09",
    sorte: "planche",
    longueur_m: 30,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: "2024-01-01",
    actif_au: null,
    remplace: "[]",
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  });
  base.recevoir(
    "UPDATE occupation SET supprime_le = ?, modifie_le = ? WHERE serie_id = ?",
    [C, C, SERIE.chou],
  );
  recevoir("occupation", {
    id: idRecu(),
    ferme_id: FERME,
    emplacement_id: nouvelle,
    serie_id: SERIE.chou,
    plantation_id: null,
    evenement_id: null,
    longueur_m: 30,
    nombre_places: null,
    position_m: 0,
    prevu_du: "2026-09-23",
    prevu_au: "2027-01-21",
    reel_du: null,
    reel_au: null,
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  });
  return nouvelle;
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
  nombre = 300,
): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

/** Attente en temps réel (écriture de l'instantané éventuellement différée). */
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

interface Options {
  readonly jour?: string;
  readonly fermeId?: string;
  readonly utilisateurId?: string | null;
  readonly stockage: StockageInstantane;
}

async function rendre(porte: PorteDonnees, o: Options): Promise<void> {
  const jour = o.jour ?? AUJOURDHUI;
  const utilisateur =
    o.utilisateurId === undefined ? UTILISATEUR : o.utilisateurId;
  await act(async () => {
    racine.render(
      <ecran.EcranAujourdhui
        porte={porte}
        fermeId={o.fermeId ?? FERME}
        aujourdhui={() => jour}
        stockage={o.stockage}
        {...(utilisateur === null ? {} : { utilisateurId: utilisateur })}
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
const CHOU = cleTache(SERIE.chou, "plantation");
const CAROTTE = cleTache(SERIE.carotte, "semis_direct");

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

// ── Scénarios ────────────────────────────────────────────────────────────────────────────────

/**
 * Ouverture ordinaire (lectures libres) : la journée est relue, dessinée, et l'instantané gardé
 * dans `stockage`. Rend les cartes dessinées.
 */
async function ouvrirEtGarder(
  stockage: StockageTest,
  o: Partial<Options> = {},
): Promise<string[]> {
  const avant = toutLeTexte(stockage);
  const p = nouvellePorte(false);
  await rendre(p.porte, { ...o, stockage });
  await attendre(() => taches().length > 0, "tâches de la journée relue");
  await attendreMs(
    () => toutLeTexte(stockage) !== "" && toutLeTexte(stockage) !== avant,
    "un instantané est gardé dans le stockage donné à l’écran",
  );
  return cles();
}

/** Lancement : modules rechargés, nouvelle porte dont les lectures sont retenues. */
async function relancer(
  o: Options,
  sur: BaseMemoire | BasePowerSync = base,
): Promise<PorteTest> {
  fermerRacine();
  vi.resetModules();
  await chargerEcran();
  nouvelleRacine();
  const p = nouvellePorte(true, sur);
  await rendre(p.porte, o);
  return p;
}

// ── I1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I1 : l’instantané est dessiné au lancement, avant toute lecture de la base", () => {
  it("même jour, même ferme, même utilisateur : les cartes de l’instantané sont dessinées, lectures retenues", async () => {
    const stockage = stockageMemoire();
    const relues = await ouvrirEtGarder(stockage);
    expect(relues).toContain(CHOU);

    const p = await relancer({ stockage });
    await tours(5);
    expect(cles(), "cartes de l’instantané, sans lecture de la base").toEqual(
      relues,
    );

    // La journée relue arrive ensuite et remplace l'instantané, à l'identique ici.
    p.ouvrir();
    await tours(30);
    expect(p.lectures(), "la base est relue en arrière-plan").toBeGreaterThan(
      0,
    );
    expect(cles()).toEqual(relues);
  });

  it("valeur rangée : texte JSON d’un objet qui porte `version` (entier)", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    const objets = [...stockage.valeurs]
      .filter(([c]) => c !== CLE_SESSION)
      .map(([, v]) => v)
      .map((v) => JSON.parse(v) as unknown);
    expect(
      objets.some(
        (x) =>
          typeof x === "object" &&
          x !== null &&
          Number.isInteger((x as { version?: unknown }).version),
      ),
    ).toBe(true);
  });

  it("sans utilisateurId, rien n’est gardé (écran d’avant T13d)", async () => {
    const stockage = stockageMemoire();
    const p = nouvellePorte(false);
    await rendre(p.porte, { stockage, utilisateurId: null });
    await attendre(() => taches().length > 0, "tâches relues");
    await tours(30);
    expect([...stockage.valeurs.keys()]).toEqual([CLE_SESSION]);
  });
});

// ── I2 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I2 : un instantané d’un autre jour, d’une autre ferme ou d’un autre utilisateur n’est jamais montré", () => {
  it.each([
    ["d’un autre jour (le lendemain)", { jour: DEMAIN }],
    ["d’une autre ferme", { fermeId: AUTRE_FERME }],
    ["d’un autre utilisateur", { utilisateurId: AUTRE_UTILISATEUR }],
  ] as const)(
    "instantané %s : rien n’est dessiné avant la journée relue",
    async (_cas, variante) => {
      const stockage = stockageMemoire();
      await ouvrirEtGarder(stockage);

      const p = await relancer({ stockage, ...variante });
      await tours(30);
      expect(
        cles(),
        "aucune carte : l’instantané ne vaut pas pour cet écran",
      ).toEqual([]);

      // La journée relue s'affiche ensuite comme avant T13d (aucune tâche pour la ferme inconnue).
      p.ouvrir();
      if ("fermeId" in variante) {
        await tours(60);
        expect(cles()).toEqual([]);
      } else {
        await attendre(() => taches().length > 0, "tâches de la journée relue");
      }
    },
  );

  it("autre jour : la journée relue est celle du nouveau jour, sans carte de l’instantané qui ne la concerne pas", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    // Référence : le lendemain, sans aucun instantané.
    fermerRacine();
    nouvelleRacine();
    const ref = nouvellePorte(false);
    await rendre(ref.porte, { stockage: stockageMemoire(), jour: DEMAIN });
    await attendre(() => taches().length > 0, "tâches du lendemain");
    const lendemain = cles();

    const p = await relancer({ stockage, jour: DEMAIN });
    p.ouvrir();
    await attendre(() => taches().length > 0, "tâches du lendemain relues");
    await tours(30);
    expect(cles()).toEqual(lendemain);
  });
});

// ── I3 ───────────────────────────────────────────────────────────────────────────────────────

/** Valeur rangée abîmée de diverses façons (format inconnu des tests : on abîme ce qu'on voit). */
const ABIMES: readonly (readonly [string, (v: string) => string])[] = [
  ["JSON coupé en deux", (v) => v.slice(0, Math.floor(v.length / 2))],
  ["pas du JSON", () => "ceci n’est pas un instantané"],
  ["null", () => "null"],
  ["un nombre", () => "42"],
  ["un tableau", () => "[]"],
  ["objet vide", () => "{}"],
  [
    "ancienne version de format (version − 1)",
    (v) => {
      const o = JSON.parse(v) as Record<string, unknown>;
      return JSON.stringify({ ...o, version: Number(o.version) - 1 });
    },
  ],
  [
    "version future (version + 1)",
    (v) => {
      const o = JSON.parse(v) as Record<string, unknown>;
      return JSON.stringify({ ...o, version: Number(o.version) + 1 });
    },
  ],
  [
    "version qui n’est pas un nombre",
    (v) => {
      const o = JSON.parse(v) as Record<string, unknown>;
      return JSON.stringify({ ...o, version: "x" });
    },
  ],
  [
    "contenu abîmé (tableaux et objets remplacés par 42, le reste gardé)",
    (v) => {
      const o = JSON.parse(v) as Record<string, unknown>;
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(o).map(([k, x]) => [
            k,
            typeof x === "object" && x !== null ? 42 : x,
          ]),
        ),
      );
    },
  ],
  [
    "contenu abîmé (chaque tableau vidé de sens : éléments remplacés par null)",
    (v) =>
      JSON.stringify(JSON.parse(v), (_k, x: unknown) =>
        Array.isArray(x) ? x.map(() => null) : x,
      ),
  ],
];

describe("T13d, I3 : un instantané illisible ou d’une autre version est ignoré, sans planter", () => {
  it.each(ABIMES)(
    "%s : aucune carte avant la journée relue, puis l’écran marche",
    async (_cas, abimer) => {
      const stockage = stockageMemoire();
      const relues = await ouvrirEtGarder(stockage);
      for (const [cle, v] of stockage.valeurs)
        if (cle !== CLE_SESSION) stockage.valeurs.set(cle, abimer(v));
      const erreurs = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        const p = await relancer({ stockage });
        await tours(30);
        // Un contenu abîmé peut garder une partie lisible : rien n'est montré, ou alors l'instantané
        // tel quel ; jamais un écran cassé.
        expect(
          conteneur.querySelector('[data-testid="aujourdhui"]'),
          "l’écran est dessiné",
        ).not.toBeNull();
        expect(
          cles().length === 0 ||
            JSON.stringify(cles()) === JSON.stringify(relues),
          `cartes : ${cles().join(", ")}`,
        ).toBe(true);
        p.ouvrir();
        await attendre(
          () => JSON.stringify(cles()) === JSON.stringify(relues),
          "tâches de la journée relue",
        );
        // Le chou se marque fait normalement.
        remiseAZero();
        await toucher(boutonFait(CHOU));
        await attendre(
          () => nouveauxRealisesChou().length === 1,
          "réalisé écrit",
        );
      } finally {
        erreurs.mockRestore();
      }
    },
  );

  it.each(ABIMES.slice(0, 9))(
    "%s : rien n’est dessiné tant que la base n’est pas relue",
    async (_cas, abimer) => {
      const stockage = stockageMemoire();
      await ouvrirEtGarder(stockage);
      for (const [cle, v] of stockage.valeurs)
        if (cle !== CLE_SESSION) stockage.valeurs.set(cle, abimer(v));
      await relancer({ stockage });
      await tours(30);
      expect(cles()).toEqual([]);
    },
  );
});

// ── I4 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I4 : stockage indisponible ou plein, l’écran marche comme avant", () => {
  it.each([
    [
      "indisponible (getItem, setItem, removeItem lèvent)",
      stockageIndisponible,
    ],
    ["plein (setItem lève QuotaExceededError)", stockagePlein],
  ] as const)(
    "stockage %s : tâches relues, « Fait » écrit un réalisé",
    async (_cas, fabrique) => {
      const p = nouvellePorte(false);
      await rendre(p.porte, { stockage: fabrique() });
      await attendre(() => tache(CHOU) !== undefined, "tâches relues");
      await tours(30);
      remiseAZero();
      await toucher(boutonFait(CHOU));
      expect(tache(CHOU), "masquée dès le tap").toBeUndefined();
      await attendre(
        () => nouveauxRealisesChou().length === 1,
        "réalisé écrit",
      );
      await tours(30);
      expect(tache(CHOU)).toBeUndefined();
      expect(nouveauxRealisesChou()).toHaveLength(1);
    },
  );

  it("stockage plein au lancement suivant : un instantané déjà gardé se montre, l’écran relit et marche", async () => {
    const stockage = stockageMemoire();
    const relues = await ouvrirEtGarder(stockage);
    const plein: StockageTest = {
      ...stockage,
      setItem: () => {
        throw new DOMException("Quota dépassé", "QuotaExceededError");
      },
    };
    const p = await relancer({ stockage: plein });
    await tours(5);
    expect(cles()).toEqual(relues);
    p.ouvrir();
    await tours(30);
    expect(cles()).toEqual(relues);
  });
});

// ── I5 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I5 : « Fait » pendant que l’instantané est affiché", () => {
  it("le réalisé est écrit normalement (un seul), puis la journée relue le confirme et remplace l’instantané", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);

    const p = await relancer({ stockage });
    await attendre(
      () => tache(CHOU) !== undefined,
      "chou dessiné depuis l’instantané",
    );
    const gardeAvant = toutLeTexte(stockage);
    remiseAZero();
    await toucher(boutonFait(CHOU));
    expect(
      tache(CHOU),
      "tâche masquée dès le tap, avant toute lecture",
    ).toBeUndefined();

    // Un second tap éventuel (bouton encore là) n'écrit rien de plus.
    const encore = tache(CHOU);
    if (encore !== undefined) await toucher(boutonFait(CHOU));

    p.ouvrir();
    await attendre(() => nouveauxRealisesChou().length === 1, "réalisé écrit");
    await tours(40);
    const ecrits = nouveauxRealisesChou();
    expect(ecrits, "un seul réalisé").toHaveLength(1);
    const e = ecrits[0];
    if (e === undefined) throw new Error("réalisé absent");
    const r = validerSaisie({ ...e });
    expect(r.ok, r.ok ? "" : r.erreur.message).toBe(true);
    expect(e.date).toBe(AUJOURDHUI);
    expect(JSON.parse(e.detail)).toMatchObject({ etape: "plantation" });
    expect(
      (JSON.parse(e.emplacement_ids) as string[]).map((x) => x.toLowerCase()),
    ).toEqual([EMPLACEMENT.t2p03.toLowerCase()]);
    expect(nouveauxEvenements(), "aucune autre écriture").toHaveLength(1);

    // La journée relue confirme : le chou reste retiré, le reste de la semaine est là.
    expect(tache(CHOU)).toBeUndefined();
    expect(tache(CAROTTE)).toBeDefined();

    // L'instantané gardé ensuite est celui de la journée relue : le chou n'y est plus.
    await attendreMs(
      () => toutLeTexte(stockage) !== gardeAvant,
      "instantané remplacé par celui de la journée relue",
    );
    await relancer({ stockage });
    await tours(5);
    expect(
      tache(CAROTTE),
      "instantané de la journée relue dessiné",
    ).toBeDefined();
    expect(
      tache(CHOU),
      "le chou fait n’est plus dans l’instantané",
    ).toBeUndefined();
  });

  it("rien n’est écrit depuis l’instantané : le chou a changé de planche depuis, le réalisé porte la planche relue dans la base", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    const nouvelle = chouDemenage();

    const p = await relancer({ stockage });
    await attendre(
      () => tache(CHOU) !== undefined,
      "chou dessiné depuis l’instantané (encore sur T2-P03)",
    );
    remiseAZero();
    await toucher(boutonFait(CHOU));
    p.ouvrir();
    await attendre(() => nouveauxRealisesChou().length === 1, "réalisé écrit");
    await tours(40);
    const e = nouveauxRealisesChou()[0];
    if (e === undefined) throw new Error("réalisé absent");
    expect(
      (JSON.parse(e.emplacement_ids) as string[]).map((x) => x.toLowerCase()),
      "emplacements relus (B2), pas ceux de l’instantané",
    ).toEqual([nouvelle.toLowerCase()]);
    expect(nouveauxRealisesChou()).toHaveLength(1);
  });

  it("rien n’est écrit depuis l’instantané : plantation déjà faite ailleurs, « Fait » sur l’instantané n’écrit pas de second réalisé", async () => {
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    plantationChouRecue();
    expect(realisesChou()).toHaveLength(1);

    const p = await relancer({ stockage });
    await attendre(
      () => tache(CHOU) !== undefined,
      "chou dessiné depuis l’instantané (d’avant le réalisé reçu)",
    );
    remiseAZero();
    await toucher(boutonFait(CHOU));
    p.ouvrir();
    await tours(80);
    expect(tache(CHOU), "la journée relue n’a plus la tâche").toBeUndefined();
    expect(
      realisesChou(),
      "un seul réalisé de la plantation du chou : celui de l’autre téléphone",
    ).toHaveLength(1);
    expect(nouveauxEvenements()).toHaveLength(0);
  });
});

// ── I6 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I6 : la journée relue remplace l’instantané dès qu’elle arrive, et gagne", () => {
  it("réalisé fait ailleurs depuis l’instantané : la tâche dessinée disparaît à l’arrivée de la journée relue", async () => {
    const stockage = stockageMemoire();
    const avant = await ouvrirEtGarder(stockage);
    plantationChouRecue();

    // Référence : l'écran relu sans instantané.
    fermerRacine();
    nouvelleRacine();
    const ref = nouvellePorte(false);
    await rendre(ref.porte, {
      stockage: stockageMemoire(),
      utilisateurId: null,
    });
    await attendre(
      () => taches().length > 0 && tache(CHOU) === undefined,
      "référence relue",
    );
    await tours(20);
    const reference = cles();
    expect(reference).not.toContain(CHOU);

    const gardeAvant = toutLeTexte(stockage);
    const p = await relancer({ stockage });
    await tours(5);
    expect(cles(), "au lancement : l’instantané tel qu’il a été gardé").toEqual(
      avant,
    );
    p.ouvrir();
    await attendre(
      () => tache(CHOU) === undefined,
      "la journée relue gagne : le chou disparaît",
    );
    await tours(20);
    expect(cles()).toEqual(reference);

    // L'instantané gardé ensuite est celui de la journée relue.
    await attendreMs(
      () => toutLeTexte(stockage) !== gardeAvant,
      "instantané remplacé par celui de la journée relue",
    );
    await relancer({ stockage });
    await tours(5);
    expect(cles()).toEqual(reference);
  });
});

// ── I7 ───────────────────────────────────────────────────────────────────────────────────────

interface ModuleDeconnexion {
  deconnecter(
    session: SessionConnexion,
    options: {
      readonly urlApi: string;
      readonly fetch: typeof fetch;
      readonly stockage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
      readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
    },
  ): Promise<void>;
}

const SESSION: SessionConnexion = {
  utilisateurId: UTILISATEUR,
  email: "theophane@ferme.fr",
  jetonAcces: "aaa.bbb.ccc",
  jetonRenouvellement: "r".repeat(43),
};

describe("T13d, I7 : la déconnexion efface l’instantané (T09b : rien du compte ne reste lisible)", () => {
  it.each([
    [
      "API joignable",
      () => Promise.resolve(new Response(null, { status: 204 })),
      false,
    ],
    [
      "hors ligne",
      () => Promise.reject(new TypeError("Failed to fetch")),
      false,
    ],
    [
      "hors ligne, base impossible à effacer",
      () => Promise.reject(new TypeError("Failed to fetch")),
      true,
    ],
  ] as const)(
    "%s : plus rien de la journée dans le stockage, plus rien de dessiné au lancement suivant",
    async (_cas, reponse, echecBase) => {
      const stockage = stockageMemoire();
      stockage.valeurs.set(CLE_SESSION, JSON.stringify(SESSION));
      await ouvrirEtGarder(stockage);
      const deconnexion = (await import(
        /* @vite-ignore */ CHEMIN_DECONNEXION
      )) as ModuleDeconnexion;
      const fetchSimule: typeof fetch = () => reponse();
      const fin = deconnexion.deconnecter(SESSION, {
        urlApi: "https://api",
        fetch: fetchSimule,
        stockage,
        effacerBaseLocale: () =>
          echecBase
            ? Promise.reject(new Error("base ouverte ailleurs"))
            : Promise.resolve(),
      });
      if (echecBase) await expect(fin).rejects.toThrow();
      else await fin;

      const texte = toutLeTexte(stockage);
      for (const lisible of [
        "Chou",
        "Carotte",
        "T2-P03",
        SERIE.chou,
        SERIE.carotte,
      ]) {
        expect(
          texte.toLowerCase(),
          `« ${lisible} » encore lisible dans le stockage après la déconnexion`,
        ).not.toContain(lisible.toLowerCase());
      }
      await relancer({ stockage });
      await tours(30);
      expect(cles()).toEqual([]);
    },
  );
});

// ── I8 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13d, I8 : l’instantané ne contient pas plus que ce que l’écran dessine", () => {
  const NOTE =
    "NOTE-COMPLETE-JAMAIS-AFFICHEE : la tomate du fond a le mildiou, traiter jeudi avant la pluie";
  const PARAMETRE = "PARAMETRE-DE-SERIE-JAMAIS-AFFICHE";

  it("ni les cultures absentes de l’écran, ni la note d’une saisie, ni les paramètres d’une série", async () => {
    base.recevoir("UPDATE evenement SET note = ? WHERE id = ?", [
      NOTE,
      EVENEMENT.recolteTomate2,
    ]);
    base.recevoir(
      "UPDATE serie SET parametres = json_set(parametres, '$.commentaire', ?) WHERE id = ?",
      [PARAMETRE, SERIE.chou],
    );
    const stockage = stockageMemoire();
    await ouvrirEtGarder(stockage);
    await tours(20);

    // L'écran ne les montre pas…
    const affiche = conteneur.textContent;
    for (const absent of ["Poireau", "Courgette", "Asperge", NOTE, PARAMETRE])
      expect(affiche).not.toContain(absent);
    // … l'instantané non plus.
    const texte = toutLeTexte(stockage).toLowerCase();
    const absents: readonly (readonly [string, string])[] = [
      ["poireau (semaine suivante)", "Poireau"],
      ["courgette (terminée)", "Courgette"],
      ["asperge (récolte passée)", "Asperge"],
      ["série du poireau", SERIE.poireau],
      ["série de la courgette", SERIE.courgette],
      ["campagne de l’asperge", CAMPAGNE.asperge],
      ["plantation de l’asperge", PLANTATION.asperge],
      ["espèce du poireau", ESPECE.poireau],
      ["espèce de la courgette", ESPECE.courgette],
      ["espèce de l’asperge", ESPECE.asperge],
      ["planche du poireau (PC-P02)", "PC-P02"],
      ["note de la récolte de tomates", "mildiou"],
      ["paramètres de la série du chou", PARAMETRE],
      ["jeton de la session", "aaa.bbb.ccc"],
    ];
    for (const [quoi, marque] of absents)
      expect(texte, `${quoi} dans l’instantané`).not.toContain(
        marque.toLowerCase(),
      );
  });

  it("grande ferme de T13b : instantané de moins de TAILLE_INSTANTANE_MAX_OCTETS", async () => {
    const grande = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      await ecrireGrandeFerme(grande, AUJOURDHUI);
      const stockage = stockageMemoire(UTILISATEUR_GRANDE);
      const p = nouvellePorte(false, grande, {
        utilisateurId: UTILISATEUR_GRANDE,
        fermeId: FERME_GRANDE,
      });
      await rendre(p.porte, {
        stockage,
        fermeId: FERME_GRANDE,
        utilisateurId: UTILISATEUR_GRANDE,
      });
      await attendreMs(
        () => taches().length > 0,
        "tâches de la grande ferme",
        60_000,
      );
      await attendreMs(
        () => toutLeTexte(stockage) !== "",
        "instantané gardé",
        5_000,
      );
      const octets = [...stockage.valeurs]
        .filter(([c]) => c !== CLE_SESSION)
        .reduce((n, [c, v]) => n + new TextEncoder().encode(c + v).length, 0);
      console.log(
        `T13d : instantané de la grande ferme, ${String(octets)} octets (${String(taches().length)} cartes dessinées)`,
      );
      expect(octets).toBeLessThan(TAILLE_INSTANTANE_MAX_OCTETS);
    } finally {
      fermerRacine();
      nouvelleRacine();
      grande.fermer();
    }
  }, 180_000);
});
