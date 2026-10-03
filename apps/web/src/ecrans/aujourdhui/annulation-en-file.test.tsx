// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13l, relecture — « Annuler » dans la file des « Fait »
 * (docs/backlog/T13l-gestes-pendant-file.md). Même banc que ./gestes-pendant-file.test.tsx :
 * ferme du jour, aujourd'hui = 2026-09-30, journée relue ; les écritures (`porte.ecrireEnsemble`)
 * sont retenues jusqu'à `liberer()`, ou la n-ième rejetée.
 *
 *   A1  (bloquant) « Annuler » de X depuis l'historique pendant la file, puis « Changer la date »
 *       de X : aucune correction de X n'est jamais écrite (bouton inactif, dialogue fermé, ou
 *       « Enregistrer » inactif), ni pendant la file ni après ; aucune erreur. On corrigerait
 *       sinon une saisie annulée (la chaîne revivrait). Variante récolte : le stock revient à
 *       ce qu'il était avant la récolte annulée, et n'en bouge plus.
 *   A2  « Annuler » du bandeau alors que la même saisie est déjà en annulation depuis
 *       l'historique : visiblement inactif ; une seule annulation écrite.
 *   A3  Bandeau d'une annulation demandée : il ne part pas au bout de 10 s tant que
 *       l'annulation attend dans la file ; il part à l'écriture de l'annulation.
 *   A4  Deux « Fait » rapides (carotte, puis chou) : le bandeau de la carotte est remplacé par
 *       celui du chou ; « Annuler » n'annule que le chou. Écritures retenues, puis libres.
 *   A5  « Annuler » au bandeau pendant la file, et la saisie visée finit sans être écrite :
 *       (a) erreur d'écriture, (b) déjà faite (reçue par la synchro, DejaFait). Rien n'est
 *       annulé, le bandeau s'en va, l'erreur (role="alert") ou l'avis (« déjà ») reste.
 *   A6  « Valider » (récolte) et « Enregistrer » (date), inactifs pendant la file, disent
 *       pourquoi : un texte lisible du dialogue présent pendant la file et plus après (« en
 *       cours », « enregistr… », « attend… », « patient… »), ou un aria-describedby non vide.
 *       La formulation n'est pas figée.
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
import type { ModuleEcranAujourdhui } from "./test/contrat.ts";
import {
  cleTache,
  ecrireFermeDuJour,
  EMPLACEMENT,
  FERME,
  SERIE,
  UTILISATEUR,
} from "./test/ferme-du-jour.ts";

const CHEMIN_ECRAN = "./index.ts";
const AUJOURDHUI = "2026-09-30";
const DELAI_ANNULATION_MS = 10_000;

const CAROTTE = cleTache(SERIE.carotte, "semis_direct");
const CHOU = cleTache(SERIE.chou, "plantation");
const RADIS = cleTache(SERIE.radis, "semis_direct");
const BATAVIA = cleTache(SERIE.batavia, "plantation");

let ecran: ModuleEcranAujourdhui;

// ── Base, porte aux écritures retenues ───────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string;
}

let base: BaseMemoire;
let evenementsAvant = new Set<string>();

const evenements = (): LigneEvenement[] =>
  base.lireDirect<LigneEvenement>("SELECT * FROM evenement ORDER BY rowid");
const nouveaux = (): LigneEvenement[] =>
  evenements().filter((e) => !evenementsAvant.has(e.id));
function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}
const recus = new Set<string>();
const cleDe = (e: LigneEvenement): string =>
  `${String(e.serie_id ?? e.campagne_id)}:${String((JSON.parse(e.detail) as { etape?: unknown }).etape)}`;
/** Nouveaux réalisés écrits par l'écran (ni remplacements, ni reçus par la synchro). */
const realises = (): LigneEvenement[] =>
  nouveaux().filter((e) => e.type === "realise" && e.remplace_sorte === null && !recus.has(e.id));
const clesEcrites = (): string[] => realises().map(cleDe);
const remplacements = (sorte: "annulation" | "correction"): LigneEvenement[] =>
  nouveaux().filter((e) => e.remplace_sorte === sorte);
const recoltes = (): LigneEvenement[] =>
  nouveaux().filter((e) => e.type === "recolte" && e.remplace_sorte === null);
/** Remplacements (annulation ou correction) visant `id`, sur tout le journal. */
const remplacementsDe = (id: string, sorte: "annulation" | "correction"): LigneEvenement[] =>
  evenements().filter((e) => e.remplace_sorte === sorte && e.remplace_evenement_id === id);
const stockTotal = (): number =>
  base.lireDirect<{ s: number | null }>("SELECT SUM(quantite) AS s FROM mouvement_stock")[0]?.s ?? 0;

/** Réalisé d'une étape marqué fait sur un autre téléphone, reçu par la synchro. */
function realiseRecu(serieId: string, etape: string, emplacementId: string): void {
  const id = `0192f0c1-13e1-7000-8000-0000000e${(recus.size + 1).toString(16).padStart(4, "0")}`;
  recus.add(id);
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

interface PorteTest {
  readonly porte: PorteDonnees;
  readonly retenir: () => void;
  readonly liberer: () => void;
  /** Le n-ième appel à `ecrireEnsemble` compté depuis `retenir()` est rejeté. */
  readonly rejeter: (n: number) => void;
}

function nouvellePorte(): PorteTest {
  const vraie = creerPorte(base, {
    utilisateurId: UTILISATEUR as Id<"Utilisateur">,
    fermeId: FERME as Id<"Ferme">,
  });
  let barriere: Promise<void> | null = null;
  let ouvrir: () => void = () => undefined;
  let appels = 0;
  const rejetes = new Set<number>();
  const porte: PorteDonnees = {
    ...vraie,
    ecrireEnsemble: async (ordres, verifier) => {
      const n = ++appels;
      if (barriere !== null) await barriere;
      if (rejetes.has(n)) throw new Error("disque plein");
      return vraie.ecrireEnsemble(ordres, verifier);
    },
  };
  return {
    porte,
    retenir: () => {
      appels = 0;
      barriere = new Promise<void>((r) => {
        ouvrir = r;
      });
    },
    liberer: () => {
      barriere = null;
      ouvrir();
    },
    rejeter: (n) => {
      rejetes.add(n);
    },
  };
}

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  remiseAZero();
  recus.clear();
  vi.resetModules();
  ecran = (await import(
    /* @vite-ignore */ CHEMIN_ECRAN
  )) as ModuleEcranAujourdhui;
  conteneur = document.createElement("div");
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
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

async function attendre(condition: () => boolean, message: string, nombre = 400): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

const texte = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function nomAccessible(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  const par = el.getAttribute("aria-labelledby");
  if (par !== null)
    return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(" ").trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === "" ? null : document.querySelector(`label[for="${el.id}"]`);
    return texte(lie ?? el.closest("label"));
  }
  return texte(el);
}

function boutons(dans: ParentNode): HTMLElement[] {
  return [
    ...dans.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], input[type="radio"]'),
  ];
}

const boutonSi = (nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement | undefined =>
  boutons(dans).find((b) => (typeof nom === "string" ? nomAccessible(b) === nom : nom.test(nomAccessible(b))));

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const b = boutonSi(nom, dans);
  expect(b, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(" | ")})`).toBeDefined();
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

const inactif = (b: HTMLElement): boolean =>
  (b instanceof HTMLButtonElement && b.disabled) || b.getAttribute("aria-disabled") === "true";

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

async function remplir(champ: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(champ, valeur);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);

function boutonFaitDe(cle: string): HTMLButtonElement | undefined {
  const t = tache(cle);
  return t === undefined
    ? undefined
    : [...t.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
        (x.getAttribute("aria-label") ?? x.textContent).trim().startsWith("Marquer fait"),
      );
}

function masquee(cle: string): boolean {
  const b = boutonFaitDe(cle);
  return b === undefined || inactif(b);
}

async function faire(cle: string): Promise<void> {
  const b = boutonFaitDe(cle);
  expect(b, `bouton « Marquer fait » de ${cle}`).toBeDefined();
  if (b === undefined) return;
  expect(inactif(b), `« Marquer fait » de ${cle} actif`).toBe(false);
  await toucher(b);
}

const bandeau = (): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
const alertes = (): string[] => [...conteneur.querySelectorAll('[role="alert"]')].map((e) => texte(e));
const messages = (): string[] =>
  [...conteneur.querySelectorAll('[role="status"], [role="alert"]')].map((e) => texte(e));
const dialogue = (debut: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => nomAccessible(d).startsWith(debut));
const entreeHistorique = (id: string): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>(`[data-testid="saisie-historique"][data-evenement="${id}"]`);

async function rendre(porte: PorteDonnees): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(
    () => [CAROTTE, CHOU, RADIS, BATAVIA].every((c) => tache(c) !== undefined),
    "journée relue dessinée",
  );
}

/** Plantation de la batavia marquée faite (écritures libres), jusqu'à l'historique. */
async function faitBatavia(): Promise<LigneEvenement> {
  await faire(BATAVIA);
  await attendre(() => realises().length === 1, "plantation de la batavia écrite");
  const ev = realises()[0];
  if (ev === undefined) throw new Error("batavia non écrite");
  await attendre(() => entreeHistorique(ev.id) !== null, "la batavia est dans l’historique");
  remiseAZero();
  return ev;
}

/** Récolte de 5 kg de tomate (écritures libres), jusqu'à l'historique. */
async function recolteTomate(): Promise<LigneEvenement> {
  await ouvrirRecolteTomateCinq();
  const d = dialogue("Récolte");
  if (d === undefined) throw new Error("récolte fermée");
  await toucher(bouton(/^Valider/, d));
  await attendre(() => recoltes().length === 1, "récolte de tomate écrite");
  const ev = recoltes()[0];
  if (ev === undefined) throw new Error("récolte non écrite");
  await attendre(() => entreeHistorique(ev.id) !== null, "la récolte est dans l’historique");
  remiseAZero();
  return ev;
}

async function ouvrirRecolteTomateCinq(): Promise<HTMLElement> {
  await toucher(bouton(/^Noter une récolte/));
  await attendre(() => dialogue("Récolte") !== undefined, "la récolte s’ouvre");
  const d = dialogue("Récolte");
  const tomate = d?.querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`);
  if (d === undefined || tomate === null || tomate === undefined) throw new Error("tomate indisponible");
  await toucher(tomate);
  await toucher(bouton("5", d));
  return d;
}

async function troisFaitEnFile(p: PorteTest): Promise<void> {
  p.retenir();
  for (const c of [CAROTTE, CHOU, RADIS]) await faire(c);
  expect(clesEcrites(), "rien d’écrit tant que la file est retenue").toEqual([]);
}

/**
 * Tente « Changer la date » de `id` au 2026-09-29 jusqu'au bout, sans forcer : s'arrête devant
 * un bouton absent ou visiblement inactif (le dialogue reste alors ouvert s'il l'est).
 */
async function tenterChangerDate(id: string): Promise<void> {
  let d = dialogue("Changer la date");
  if (d === undefined) {
    const entree = entreeHistorique(id);
    if (entree === null) return;
    const ouvrir = boutonSi(/^Changer la date/, entree);
    if (ouvrir === undefined || inactif(ouvrir)) return;
    await toucher(ouvrir);
    d = dialogue("Changer la date");
    if (d === undefined) return;
    const champ = [...d.querySelectorAll<HTMLInputElement>("input")].find((i) => nomAccessible(i) === "Date");
    if (champ === undefined) return;
    await remplir(champ, "2026-09-29");
  }
  const enregistrer = boutonSi("Enregistrer", d);
  if (enregistrer === undefined || inactif(enregistrer)) return;
  await toucher(enregistrer);
}

/** « Annuler » de l'historique pour `id`, actif. */
async function annulerDepuisHistorique(id: string): Promise<void> {
  const entree = entreeHistorique(id);
  expect(entree, "la saisie est dans l’historique").not.toBeNull();
  if (entree === null) return;
  const b = bouton(/^Annuler/, entree);
  expect(inactif(b), "« Annuler » de l’historique actif").toBe(false);
  await toucher(b);
}

// ── A1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, A1 (bloquant) : « Changer la date » d’une saisie en annulation", () => {
  it("réalisé : annulé depuis l’historique pendant la file, sa date n’est jamais corrigée", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const x = await faitBatavia();
    await troisFaitEnFile(p);
    await annulerDepuisHistorique(x.id);

    await tenterChangerDate(x.id);
    p.liberer();
    await attendre(() => remplacementsDe(x.id, "annulation").length === 1, "annulation de la batavia écrite");
    await tours(40);
    // Après la file : on retente (dialogue resté ouvert, ou historique).
    await tenterChangerDate(x.id);
    await tours(40);

    expect(remplacementsDe(x.id, "correction"), "aucune correction de la saisie annulée").toEqual([]);
    expect(remplacementsDe(x.id, "annulation"), "une seule annulation").toHaveLength(1);
    expect(clesEcrites()).toEqual([CAROTTE, CHOU, RADIS]);
    expect(alertes(), "aucune erreur").toEqual([]);
  });

  it("récolte : annulée depuis l’historique pendant la file, ni correction ni stock qui revit", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const stockAvant = stockTotal();
    const x = await recolteTomate();
    expect(stockTotal(), "la récolte entre en stock").toBe(stockAvant + 5);
    await troisFaitEnFile(p);
    await annulerDepuisHistorique(x.id);

    await tenterChangerDate(x.id);
    p.liberer();
    await attendre(() => remplacementsDe(x.id, "annulation").length === 1, "annulation de la récolte écrite");
    await tours(40);
    await tenterChangerDate(x.id);
    await tours(40);

    expect(remplacementsDe(x.id, "correction"), "aucune correction de la récolte annulée").toEqual([]);
    expect(stockTotal(), "le stock revient à son niveau d’avant la récolte, et y reste").toBe(stockAvant);
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});

// ── A2 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, A2 : « Annuler » du bandeau d’une saisie déjà en annulation depuis l’historique", () => {
  it("visiblement inactif ; une seule annulation écrite", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const x = await faitBatavia();
    const b = bandeau();
    expect(b, "le bandeau de la batavia est là").not.toBeNull();
    if (b === null) return;
    expect(texte(b)).toMatch(/batavia/i);

    p.retenir();
    await annulerDepuisHistorique(x.id);
    const annulerBandeau = bandeau() === null ? undefined : boutonSi(/^Annuler/, bandeau() ?? conteneur);
    if (annulerBandeau !== undefined) {
      expect(inactif(annulerBandeau), "« Annuler » du bandeau visiblement inactif : la saisie est déjà en annulation").toBe(true);
      await toucher(annulerBandeau);
    }

    p.liberer();
    await attendre(() => remplacements("annulation").length >= 1, "annulation écrite");
    await tours(40);
    expect(remplacementsDe(x.id, "annulation"), "une seule annulation").toHaveLength(1);
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});

// ── A3 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, A3 : bandeau d’une annulation qui attend dans la file", () => {
  it("ne part pas à 10 s tant que l’annulation attend ; part à son écriture", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    const p = nouvellePorte();
    await rendre(p.porte);
    await faitBatavia();
    const b = bandeau();
    expect(b, "le bandeau de la batavia est là").not.toBeNull();
    if (b === null) return;

    p.retenir();
    await toucher(bouton(/^Annuler/, b));
    await act(async () => {
      vi.advanceTimersByTime(DELAI_ANNULATION_MS + 1_000);
      await Promise.resolve();
    });
    await tours(5);
    expect(remplacements("annulation"), "l’annulation attend encore").toEqual([]);
    expect(bandeau(), "le bandeau reste tant que l’annulation attend dans la file").not.toBeNull();

    p.liberer();
    await attendre(() => remplacements("annulation").length === 1, "annulation écrite");
    await attendre(() => bandeau() === null, "le bandeau part à l’écriture de l’annulation");
  });
});

// ── A4 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, A4 : deux « Fait » rapides", () => {
  it("écritures retenues : le bandeau du chou remplace celui de la carotte ; « Annuler » n’annule que le chou", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    p.retenir();
    await faire(CAROTTE);
    await faire(CHOU);
    p.liberer();
    await attendre(() => clesEcrites().length === 2, "carotte et chou écrits");
    await tours(20);
    const b = bandeau();
    expect(b, "un bandeau").not.toBeNull();
    if (b === null) return;
    expect(texte(b), "le bandeau est celui du chou").toMatch(/chou/i);
    expect(texte(b)).not.toMatch(/carotte/i);
    await toucher(bouton(/^Annuler/, b));
    await attendre(() => remplacements("annulation").length === 1, "annulation écrite");
    await tours(30);
    const chou = realises().find((e) => cleDe(e) === CHOU);
    expect(remplacements("annulation").map((a) => a.remplace_evenement_id)).toEqual([chou?.id]);
    expect(remplacements("annulation"), "une seule annulation").toHaveLength(1);
    expect(tache(CAROTTE), "la carotte reste faite").toBeUndefined();
    await attendre(() => tache(CHOU) !== undefined && !masquee(CHOU), "le chou, annulé, revient");
  });

  it("écritures libres : le bandeau passe de la carotte au chou ; « Annuler » n’annule que le chou", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await faire(CAROTTE);
    await faire(CHOU);
    await attendre(() => clesEcrites().length === 2, "carotte et chou écrits");
    await attendre(() => /chou/i.test(texte(bandeau())), "le bandeau est celui du chou");
    const b = bandeau();
    if (b === null) return;
    await toucher(bouton(/^Annuler/, b));
    await attendre(() => remplacements("annulation").length === 1, "annulation écrite");
    await tours(30);
    const chou = realises().find((e) => cleDe(e) === CHOU);
    expect(remplacements("annulation").map((a) => a.remplace_evenement_id)).toEqual([chou?.id]);
  });
});

// ── A5 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, A5 : « Annuler » d’une saisie en file qui finit sans être écrite", () => {
  it("(a) erreur d’écriture du radis : rien d’annulé, bandeau parti, l’erreur reste", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);
    p.rejeter(3);
    const b = bandeau();
    expect(b, "bandeau du radis pendant la file").not.toBeNull();
    if (b === null) return;
    await toucher(bouton(/^Annuler/, b));

    p.liberer();
    await attendre(() => clesEcrites().length === 2, "carotte et chou écrits");
    await tours(60);
    expect(clesEcrites()).toEqual([CAROTTE, CHOU]);
    expect(remplacements("annulation"), "rien d’annulé").toEqual([]);
    expect(bandeau(), "le bandeau s’en va").toBeNull();
    expect(alertes().length, "l’erreur reste affichée").toBeGreaterThan(0);
  });

  it("(b) radis déjà fait (reçu par la synchro) : rien d’annulé, le reçu non plus ; bandeau parti, l’avis reste", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);
    const b = bandeau();
    expect(b, "bandeau du radis pendant la file").not.toBeNull();
    if (b === null) return;
    await toucher(bouton(/^Annuler/, b));
    realiseRecu(SERIE.radis, "semis_direct", EMPLACEMENT.t2p05);

    p.liberer();
    await attendre(() => clesEcrites().length === 2, "carotte et chou écrits");
    await tours(60);
    expect(clesEcrites(), "le radis n’est pas écrit une seconde fois").toEqual([CAROTTE, CHOU]);
    expect(remplacements("annulation"), "rien d’annulé, ni le réalisé reçu").toEqual([]);
    expect(bandeau(), "le bandeau s’en va").toBeNull();
    expect(messages().some((m) => /déjà/i.test(m)), `l’avis « déjà » reste (messages : ${messages().join(" | ")})`).toBe(true);
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});

// ── A6 ───────────────────────────────────────────────────────────────────────────────────────

/** Textes « feuilles » du dialogue, hors boutons. */
function textesHorsBoutons(d: HTMLElement): Set<string> {
  const res = new Set<string>();
  for (const el of d.querySelectorAll<HTMLElement>("*")) {
    if (el.closest("button") !== null || el.children.length > 0) continue;
    const t = texte(el);
    if (t !== "") res.add(t);
  }
  return res;
}

const RAISON = /en cours|enregistr|attend|patient/i;

/** Raison d'un bouton inactif : aria-describedby non vide, ou textes nouveaux qui disent l'attente. */
function raison(b: HTMLElement, pendant: Set<string>, apres: Set<string>): string {
  const par = b.getAttribute("aria-describedby");
  const decrit = par === null ? "" : par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(" ").trim();
  if (decrit !== "") return decrit;
  return [...pendant].filter((t) => !apres.has(t) && RAISON.test(t)).join(" | ");
}

describe("T13l, A6 : boutons inactifs pendant la file, avec une raison lisible", () => {
  it("« Valider » (récolte) : inactif pendant la file, il dit pourquoi", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);
    const d = await ouvrirRecolteTomateCinq();
    const valider = bouton(/^Valider/, d);
    expect(inactif(valider), "« Valider » inactif pendant la file").toBe(true);
    const decritPendant = valider.getAttribute("aria-describedby");
    const pendant = textesHorsBoutons(d);
    const texteDecrit =
      decritPendant === null ? "" : decritPendant.split(/\s+/).map((i) => texte(document.getElementById(i))).join(" ").trim();

    p.liberer();
    await attendre(() => clesEcrites().length === 3, "file écrite");
    await attendre(() => !inactif(bouton(/^Valider/, d)), "« Valider » redevient actif");
    const apres = textesHorsBoutons(d);
    const r = texteDecrit !== "" ? texteDecrit : raison(valider, pendant, apres);
    expect(r, `une raison lisible pendant la file (textes pendant : ${[...pendant].join(" | ")})`).not.toBe("");
  });

  it("« Enregistrer » (date) : inactif pendant la file, il dit pourquoi", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const x = await faitBatavia();
    await troisFaitEnFile(p);
    const entree = entreeHistorique(x.id);
    if (entree === null) throw new Error("batavia absente de l’historique");
    await toucher(bouton(/^Changer la date/, entree));
    await attendre(() => dialogue("Changer la date") !== undefined, "dialogue « Changer la date »");
    const d = dialogue("Changer la date");
    if (d === undefined) return;
    const champ = [...d.querySelectorAll<HTMLInputElement>("input")].find((i) => nomAccessible(i) === "Date");
    if (champ === undefined) throw new Error("champ « Date » absent");
    await remplir(champ, "2026-09-29");
    const enregistrer = bouton("Enregistrer", d);
    expect(inactif(enregistrer), "« Enregistrer » inactif pendant la file").toBe(true);
    const decritPendant = enregistrer.getAttribute("aria-describedby");
    const texteDecrit =
      decritPendant === null ? "" : decritPendant.split(/\s+/).map((i) => texte(document.getElementById(i))).join(" ").trim();
    const pendant = textesHorsBoutons(d);

    p.liberer();
    await attendre(() => clesEcrites().length === 3, "file écrite");
    await attendre(() => !inactif(bouton("Enregistrer", d)), "« Enregistrer » redevient actif");
    const apres = textesHorsBoutons(d);
    const r = texteDecrit !== "" ? texteDecrit : raison(enregistrer, pendant, apres);
    expect(r, `une raison lisible pendant la file (textes pendant : ${[...pendant].join(" | ")})`).not.toBe("");
  });
});
