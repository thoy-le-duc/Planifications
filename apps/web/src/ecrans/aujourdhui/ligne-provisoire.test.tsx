// @vitest-environment happy-dom
/**
 * Test d'acceptation T13u — la ligne provisoire de l'historique (T13t : un « Fait » tapé sur
 * l'instantané paraît en tête de son historique dès son écriture) ne disparaît JAMAIS avant
 * l'arrivée de la journée qui la contient.
 *
 * Cas (relecture T13t) : la relecture complète est dans sa dernière requête (saisies récentes)
 * au moment du « Fait » : elle ne peut plus céder la place (plus de requête suivante) ; sa
 * requête a lu la base AVANT l'écriture, sa journée arrive APRÈS, sans la saisie. Avant T13u, la
 * ligne provisoire disparaissait alors (la journée relue remplace l'instantané), puis revenait
 * avec la relecture de la culture touchée.
 *
 * Banc : ferme du jour (./test/ferme-du-jour.ts), base mémoire, instantané gardé par une
 * ouverture ordinaire, puis « lancement » (modules rechargés, nouvelle porte). La requête des
 * saisies récentes de la relecture complète (`e.ferme_id = ? AND e.date >= ?`, sans `+` : celle
 * de la journée entière, pas celle d'une culture) est lue tout de suite, et son résultat rendu
 * seulement quand le test la libère. Chaque résultat de la porte arrive dans une tâche à part,
 * comme depuis le worker de la base (l'écran se dessine entre deux). La présence de la ligne est relevée à chaque mutation du DOM
 * (MutationObserver) et à chaque tour.
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
import type { ModuleEcranAujourdhui, StockageInstantane } from "./test/contrat.ts";
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";
const CHOU = cleTache(SERIE.chou, "plantation");
/** Requête des saisies récentes de la relecture complète (pas celle d'une culture : `+e.ferme_id`). */
const RECENTS_COMPLETS = "e.ferme_id = ? AND e.date >= ?";

const SESSION: SessionConnexion = {
  utilisateurId: UTILISATEUR,
  email: "theophane@ferme.fr",
  jetonAcces: "aaa.bbb.ccc",
  jetonRenouvellement: "r".repeat(43),
};

let ecran: ModuleEcranAujourdhui;
let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;

async function chargerEcran(): Promise<void> {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
}

function stockageMemoire(): StockageInstantane & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>([[CLE_SESSION, JSON.stringify(SESSION)]]);
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

const instantaneGarde = (s: { readonly valeurs: Map<string, string> }): string =>
  [...s.valeurs]
    .filter(([c]) => c !== CLE_SESSION)
    .map(([, v]) => v)
    .join("\n");

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

async function attendre(condition: () => boolean, message: string, nombre = 300): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

async function attendreMs(condition: () => boolean, message: string, ms = 2_000): Promise<void> {
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
      <ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} stockage={stockage} utilisateurId={UTILISATEUR} />,
    );
    await Promise.resolve();
  });
}

const porteDe = (): PorteDonnees =>
  creerPorte(base, { utilisateurId: UTILISATEUR as Id<"Utilisateur">, fermeId: FERME as Id<"Ferme"> });

const tache = (cle: string): HTMLElement | undefined =>
  [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')].find((t) => t.dataset.cle === cle);

function boutonFait(cle: string): HTMLButtonElement {
  const b = [...(tache(cle)?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((x) =>
    (x.getAttribute("aria-label") ?? x.textContent).trim().startsWith("Marquer fait"),
  );
  if (b === undefined) throw new Error(`bouton « Marquer fait » absent pour ${cle}`);
  return b;
}

const saisies = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')];
const actif = (b: HTMLButtonElement): boolean => !b.disabled && b.getAttribute("aria-disabled") !== "true";
/** La saisie `id` est dessinée par une journée relue (ses boutons sont actifs : pas l'instantané, T13g). */
const dansUneJourneeRelue = (id: string): boolean =>
  saisies().some((s) => s.dataset.evenement === id && [...s.querySelectorAll<HTMLButtonElement>("button")].some(actif));

const realisesChou = (): string[] =>
  base
    .lireDirect<{ id: string }>("SELECT id FROM evenement WHERE type = 'realise' AND remplace_sorte IS NULL AND serie_id = ? ORDER BY id", [SERIE.chou])
    .map((l) => l.id);

describe("T13u : la ligne provisoire de l’historique tient jusqu’à la journée qui la contient", () => {
  it("« Fait » sur l’instantané pendant la dernière requête de la relecture complète : la ligne ne disparaît jamais", async () => {
    // Ouverture ordinaire : la journée est relue, son instantané gardé.
    const stockage = stockageMemoire();
    await rendre(porteDe(), stockage);
    await attendre(() => tache(CHOU) !== undefined, "chou dessiné par la journée relue");
    await attendreMs(() => instantaneGarde(stockage) !== "", "instantané gardé");
    fermerRacine();

    // Lancement : la requête des saisies récentes de la relecture complète lit la base tout de
    // suite (avant le « Fait ») et ne rend son résultat qu'à la libération.
    vi.resetModules();
    await chargerEcran();
    nouvelleRacine();
    const vraie = porteDe();
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((r) => {
      liberer = r;
    });
    let derniereRequeteEnCours = false;
    const porte: PorteDonnees = {
      ...vraie,
      lire: async <T,>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => {
        const lues = await vraie.lire<T>(sql, parametres);
        if (sql.includes(RECENTS_COMPLETS)) {
          derniereRequeteEnCours = true;
          await barriere;
        }
        // Comme le worker de la base : chaque résultat arrive dans une tâche à part (l'écran se
        // dessine entre deux).
        await new Promise((r) => setTimeout(r, 0));
        return lues;
      },
    };
    const avant = new Set(realisesChou());
    await rendre(porte, stockage);
    await attendre(() => tache(CHOU) !== undefined, "chou dessiné depuis l’instantané");
    await attendre(() => derniereRequeteEnCours, "relecture complète dans sa requête des saisies récentes");

    await act(async () => {
      boutonFait(CHOU).click();
      await Promise.resolve();
    });
    await attendre(() => realisesChou().some((id) => !avant.has(id)), "réalisé du chou écrit");
    const id = realisesChou().find((x) => !avant.has(x)) ?? "";
    const presente = () => saisies().some((s) => s.dataset.evenement === id);
    await attendre(() => saisies()[0]?.dataset.evenement === id, "ligne provisoire en tête de l’historique de l’instantané");

    // À partir d'ici, la ligne doit rester dessinée jusqu'à la journée relue qui la contient.
    const absences: string[] = [];
    const etat = { contenue: false };
    const relever = (quand: string) => {
      if (etat.contenue) return;
      if (dansUneJourneeRelue(id)) etat.contenue = true;
      else if (!presente()) absences.push(quand);
    };
    const observateur = new MutationObserver(() => {
      relever("mutation du DOM");
    });
    observateur.observe(conteneur, { subtree: true, childList: true, attributes: true });
    try {
      liberer();
      for (let k = 0; k < 300 && !etat.contenue; k++) {
        await unTour();
        relever(`tour ${String(k)}`);
      }
    } finally {
      observateur.disconnect();
    }
    expect(etat.contenue, "la journée relue qui contient la saisie est arrivée").toBe(true);
    expect(absences, "la ligne provisoire n’a jamais disparu avant la journée qui la contient").toEqual([]);
    expect(saisies()[0]?.dataset.evenement, "en tête de l’historique").toBe(id);
    expect(saisies().filter((s) => s.dataset.evenement === id), "une seule fois").toHaveLength(1);
  });
});
