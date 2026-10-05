// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13l — « Annuler » et gestes pendant la file des « Fait »
 * (docs/backlog/T13l-gestes-pendant-file.md).
 *
 * Constat (relecture T13g) : pendant qu'une écriture tourne, « Annuler » (bandeau et historique),
 * « Changer la date » et la récolte sont ignorés sans rien dire (`ecrire` sans `enFile` rend false
 * dans EcranAujourdhui.tsx). Avec la file, cette fenêtre dure plusieurs écritures.
 *
 * Règles du ticket :
 *   - « Annuler » passe dans la file, après le « Fait » qu'il annule ;
 *   - sinon, les autres gestes sont visiblement inactifs tant que la file tourne.
 *
 * Banc : ferme du jour (./test/ferme-du-jour.ts), aujourd'hui = 2026-09-30, journée relue (base
 * ouverte, lectures libres). Les ÉCRITURES (`porte.ecrireEnsemble`, par où passe toute saisie de
 * l'écran) sont retenues à volonté jusqu'à `liberer()` : tant qu'elles le sont, la file tourne.
 * On peut aussi faire rejeter le n-ième appel (erreur d'écriture au milieu de la file).
 *
 *   G1  Trois « Fait » (carotte, chou, radis) tapés à la suite, écritures retenues, puis
 *       « Annuler » sur le bandeau tout de suite. Le bandeau est là pendant la file et nomme le
 *       dernier « Fait » tapé (le radis) : c'est lui que le maraîcher annule. Une fois la file
 *       libérée : trois réalisés écrits dans l'ordre, PUIS l'annulation du radis ; carotte et
 *       chou restent faits ; le radis revient dans la liste ; aucune erreur.
 *   G2  « Annuler » depuis l'historique pendant la file (sur un « Fait » écrit avant, la
 *       plantation de la batavia) : pas ignoré. L'annulation est écrite après les trois « Fait »
 *       de la file, la batavia revient. (Le « Fait » encore en file n'est pas dans l'historique :
 *       il n'y entre qu'écrit et relu ; « annuler le dernier » se fait par le bandeau, G1.)
 *   G3  Erreur d'écriture au milieu de la file (le 2e « Fait », le chou, est rejeté par la
 *       porte) : le 3e (radis) s'écrit quand même ; le message d'erreur (role="alert") est
 *       encore affiché quand la file a fini ; le chou n'est pas perdu en silence (sa carte
 *       revient, active).
 *   G4  « Changer la date » pendant la file : jamais ignoré sans retour. Propriété testée, au
 *       choix du développeur : à chaque étape du geste (bouton de l'historique, puis
 *       « Enregistrer »), le bouton est soit visiblement inactif (disabled ou
 *       aria-disabled="true"), soit le geste aboutit (la correction est écrite après la file).
 *       Visiblement inactif : il redevient actif quand la file a fini, et le geste aboutit.
 *   G5  Récolte pendant la file : même propriété (« Noter une récolte », culture, « Valider »).
 *
 * Choix du testeur pour G4/G5 : la règle du ticket dit « visiblement inactifs », mais la mise en
 * file est aussi acceptable (aucun geste perdu) ; le test n'impose donc que la propriété
 * « jamais ignoré sans retour », et vérifie dans les deux cas que la saisie finit par s'écrire
 * une fois, et une seule.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_LOCAL, type PorteDonnees, type creerPorte as CreerPorte } from "@planif/sync";
import type { Id } from "@planif/core";
import {
  creerBaseMemoire,
  type BaseMemoire,
} from "../../../../../packages/sync/src/test/base-memoire.ts";
import type { ModuleEcranAujourdhui } from "./test/contrat.ts";
import {
  cleTache,
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
const BATAVIA = cleTache(SERIE.batavia, "plantation");

let ecran: ModuleEcranAujourdhui;
/**
 * Chargée après `vi.resetModules()`, comme l'écran : une seule instance de @planif/sync, sinon
 * deux classes DejaFait et `instanceof` échoue (contre-relecture T13l).
 */
let creerPorte: typeof CreerPorte;

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

/** Dans l'ordre d'insertion (rowid) : l'ordre dans lequel la file a écrit. */
const evenements = (): LigneEvenement[] =>
  base.lireDirect<LigneEvenement>("SELECT * FROM evenement ORDER BY rowid");
const nouveaux = (): LigneEvenement[] =>
  evenements().filter((e) => !evenementsAvant.has(e.id));
function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

const etapeDe = (e: LigneEvenement): string =>
  String((JSON.parse(e.detail) as { etape?: unknown }).etape);
const cleDe = (e: LigneEvenement): string =>
  `${String(e.serie_id ?? e.campagne_id)}:${etapeDe(e)}`;
/** Nouveaux réalisés (ni annulation ni correction), dans l'ordre d'écriture. */
const realises = (): LigneEvenement[] =>
  nouveaux().filter((e) => e.type === "realise" && e.remplace_sorte === null);
const clesEcrites = (): string[] => realises().map(cleDe);
const remplacements = (sorte: "annulation" | "correction"): LigneEvenement[] =>
  nouveaux().filter((e) => e.remplace_sorte === sorte);
const recoltes = (): LigneEvenement[] =>
  nouveaux().filter((e) => e.type === "recolte" && e.remplace_sorte === null);
/** Position d'écriture (rowid relatif) d'un nouvel événement. */
const rang = (id: string): number => nouveaux().findIndex((e) => e.id === id);

interface PorteTest {
  readonly porte: PorteDonnees;
  /** Les écritures suivantes attendent `liberer()`. */
  readonly retenir: () => void;
  readonly liberer: () => void;
  /** Le n-ième appel à `ecrireEnsemble` compté depuis `retenir()` (1 = le premier) est rejeté. */
  readonly rejeter: (n: number) => void;
  /** Appels à `ecrireEnsemble` depuis `retenir()`. */
  readonly appels: () => number;
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
    appels: () => appels,
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
  vi.resetModules();
  ecran = (await import(
    /* @vite-ignore */ CHEMIN_ECRAN
  )) as ModuleEcranAujourdhui;
  ({ creerPorte } = await import("@planif/sync"));
  conteneur = document.createElement("div");
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
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

async function attendre(
  condition: () => boolean,
  message: string,
  nombre = 400,
): Promise<void> {
  for (let k = 0; k < nombre && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

const texte = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Nom accessible simplifié : aria-label, aria-labelledby, <label>, puis le texte. */
function nomAccessible(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  const par = el.getAttribute("aria-labelledby");
  if (par !== null)
    return par
      .split(/\s+/)
      .map((i) => texte(document.getElementById(i)))
      .join(" ")
      .trim();
  if (el instanceof HTMLInputElement) {
    const lie =
      el.id === "" ? null : document.querySelector(`label[for="${el.id}"]`);
    return texte(lie ?? el.closest("label"));
  }
  return texte(el);
}

function boutons(dans: ParentNode): HTMLElement[] {
  return [
    ...dans.querySelectorAll<HTMLElement>(
      'button, [role="button"], [role="radio"], input[type="radio"]',
    ),
  ];
}

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const trouves = boutons(dans).filter((b) =>
    typeof nom === "string" ? nomAccessible(b) === nom : nom.test(nomAccessible(b)),
  );
  expect(
    trouves.length,
    `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(" | ")})`,
  ).toBeGreaterThan(0);
  const b = trouves[0];
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

/** Visiblement inactif : disabled ou aria-disabled="true". */
const inactif = (b: HTMLElement): boolean =>
  (b instanceof HTMLButtonElement && b.disabled) ||
  b.getAttribute("aria-disabled") === "true";

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

/** Pose la valeur d'un champ comme le ferait une saisie (React écoute input / change). */
async function remplir(champ: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(champ, valeur);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [
  ...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]'),
];
const tache = (cle: string): HTMLElement | undefined =>
  taches().find((t) => t.dataset.cle === cle);

function boutonFaitDe(cle: string): HTMLButtonElement | undefined {
  const t = tache(cle);
  return t === undefined
    ? undefined
    : [...t.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
        (x.getAttribute("aria-label") ?? x.textContent).trim().startsWith("Marquer fait"),
      );
}

/** Masquée : la carte a quitté la liste, ou son bouton « Marquer fait » est inactif. */
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
  expect(masquee(cle), `${cle} masquée dès son tap`).toBe(true);
}

const bandeau = (): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
const alertes = (): string[] =>
  [...conteneur.querySelectorAll('[role="alert"]')].map((e) => texte(e));
const dialogues = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
];
const dialogue = (debut: string): HTMLElement | undefined =>
  dialogues().find((d) => nomAccessible(d).startsWith(debut));

/** Entrée de l'historique pour l'événement `id`. */
const entreeHistorique = (id: string): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>(
    `[data-testid="saisie-historique"][data-evenement="${id}"]`,
  );

async function rendre(porte: PorteDonnees): Promise<void> {
  await act(async () => {
    racine.render(
      <ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />,
    );
    await Promise.resolve();
  });
  await attendre(
    () => [CAROTTE, CHOU, RADIS, BATAVIA].every((c) => tache(c) !== undefined),
    "journée relue dessinée (carotte, chou, radis, batavia)",
  );
}

/**
 * Plantation de la batavia marquée faite AVANT la file (écritures libres), jusqu'à son entrée
 * dans l'historique ; rend l'événement écrit. Puis plus rien de nouveau (remiseAZero).
 */
async function faitAvantLaFile(): Promise<LigneEvenement> {
  await faire(BATAVIA);
  await attendre(() => realises().length === 1, "plantation de la batavia écrite");
  const ev = realises()[0];
  if (ev === undefined) throw new Error("batavia non écrite");
  await attendre(() => entreeHistorique(ev.id) !== null, "la batavia est dans l’historique");
  // Le bandeau de la batavia s'en va de lui-même ; on ne s'en sert pas.
  remiseAZero();
  return ev;
}

/** Trois « Fait » à la suite, écritures retenues : la file tourne. */
async function troisFaitEnFile(p: PorteTest): Promise<void> {
  p.retenir();
  for (const c of [CAROTTE, CHOU, RADIS]) await faire(c);
  expect(clesEcrites(), "rien d’écrit tant que la file est retenue").toEqual([]);
}

async function finDeFile(n = 3): Promise<void> {
  await attendre(
    () => clesEcrites().length >= n,
    `${String(n)} réalisés écrits (écrits : ${clesEcrites().join(", ")})`,
  );
  await tours(40);
}

// ── G1 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, G1 : trois « Fait » puis « Annuler » (bandeau) tout de suite", () => {
  it("le dernier « Fait » est annulé après son écriture ; les deux premiers restent", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);

    const b = bandeau();
    expect(
      b,
      "un bandeau « Annuler » est là pendant la file (sinon « Annuler tout de suite » est impossible)",
    ).not.toBeNull();
    if (b === null) return;
    expect(texte(b), "le bandeau nomme le dernier « Fait » tapé : le radis").toMatch(/radis/i);
    const annuler = bouton(/^Annuler/, b);
    expect(inactif(annuler), "« Annuler » du bandeau actif pendant la file").toBe(false);
    await toucher(annuler);
    expect(remplacements("annulation"), "rien d’écrit avant la fin de la file").toEqual([]);

    p.liberer();
    await finDeFile();
    await attendre(
      () => remplacements("annulation").length >= 1,
      "l’annulation est écrite, après le « Fait » qu’elle annule",
    );
    await tours(40);

    expect(clesEcrites(), "trois réalisés, dans l’ordre des taps").toEqual([CAROTTE, CHOU, RADIS]);
    const radis = realises().find((e) => cleDe(e) === RADIS);
    const annulations = remplacements("annulation");
    expect(annulations, "une seule annulation").toHaveLength(1);
    const a = annulations[0];
    if (radis === undefined || a === undefined) return;
    expect(a.remplace_evenement_id, "l’annulation vise le réalisé du radis").toBe(radis.id);
    expect(rang(a.id), "écrite après le réalisé du radis").toBeGreaterThan(rang(radis.id));
    expect(nouveaux(), "rien d’autre : trois réalisés et une annulation").toHaveLength(4);
    expect(alertes(), "aucune erreur").toEqual([]);

    await attendre(
      () => tache(RADIS) !== undefined && !masquee(RADIS),
      "le radis, annulé, revient dans la liste",
    );
    expect(tache(CAROTTE), "la carotte reste faite").toBeUndefined();
    expect(tache(CHOU), "le chou reste fait").toBeUndefined();
  });
});

// ── G2 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, G2 : « Annuler » depuis l’historique pendant la file", () => {
  it("pas ignoré : l’annulation passe dans la file, après les trois « Fait »", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const batavia = await faitAvantLaFile();
    await troisFaitEnFile(p);

    const entree = entreeHistorique(batavia.id);
    expect(entree, "la batavia est dans l’historique pendant la file").not.toBeNull();
    if (entree === null) return;
    const annuler = bouton(/^Annuler/, entree);
    expect(inactif(annuler), "« Annuler » de l’historique actif : il passe dans la file").toBe(false);
    await toucher(annuler);

    p.liberer();
    await finDeFile();
    await attendre(
      () => remplacements("annulation").length >= 1,
      "l’annulation de la batavia, tapée pendant la file, est écrite (pas ignorée)",
    );
    await tours(40);

    expect(clesEcrites()).toEqual([CAROTTE, CHOU, RADIS]);
    const annulations = remplacements("annulation");
    expect(annulations).toHaveLength(1);
    const a = annulations[0];
    if (a === undefined) return;
    expect(a.remplace_evenement_id, "l’annulation vise la plantation de la batavia").toBe(batavia.id);
    for (const r of realises()) {
      expect(rang(a.id), `annulation écrite après le « Fait » ${cleDe(r)} tapé avant elle`).toBeGreaterThan(rang(r.id));
    }
    expect(alertes(), "aucune erreur").toEqual([]);
    await attendre(
      () => tache(BATAVIA) !== undefined && !masquee(BATAVIA),
      "la batavia, annulée, revient dans la liste",
    );
  });
});

// ── G3 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, G3 : erreur d’écriture au milieu de la file", () => {
  it("le chou est rejeté : le radis s’écrit quand même, le message reste affiché à la fin", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);
    p.rejeter(2);

    p.liberer();
    await attendre(
      () => clesEcrites().length >= 2,
      `carotte et radis écrits (écrits : ${clesEcrites().join(", ")})`,
    );
    await tours(60);

    expect(p.appels(), "trois écritures tentées, une par « Fait »").toBe(3);
    expect(clesEcrites(), "carotte puis radis ; le chou, rejeté, n’est pas écrit").toEqual([CAROTTE, RADIS]);
    expect(nouveaux()).toHaveLength(2);
    expect(
      alertes().length,
      "le message d’erreur (role=\"alert\") est encore affiché quand la file a fini",
    ).toBeGreaterThan(0);
    expect(
      tache(CHOU) !== undefined && !masquee(CHOU),
      "le chou n’est pas perdu en silence : sa carte revient, active",
    ).toBe(true);
  });
});

// ── G4 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, G4 : « Changer la date » pendant la file", () => {
  it("jamais ignoré sans retour : visiblement inactif, ou mis en file ; la correction finit écrite une fois", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    const batavia = await faitAvantLaFile();
    await troisFaitEnFile(p);

    const entree = entreeHistorique(batavia.id);
    expect(entree, "la batavia est dans l’historique pendant la file").not.toBeNull();
    if (entree === null) return;

    /** Étape où le geste a été arrêté par un bouton visiblement inactif, ou null s'il a abouti. */
    let arret: "ouvrir" | "enregistrer" | null = null;
    const ouvrir = bouton(/^Changer la date/, entree);
    if (inactif(ouvrir)) arret = "ouvrir";
    else {
      await toucher(ouvrir);
      await attendre(() => dialogue("Changer la date") !== undefined, "dialogue « Changer la date »");
      const d = dialogue("Changer la date");
      const champ = [...(d?.querySelectorAll<HTMLInputElement>("input") ?? [])].find(
        (i) => nomAccessible(i) === "Date",
      );
      expect(champ, "champ « Date »").toBeDefined();
      if (champ === undefined || d === undefined) return;
      await remplir(champ, "2026-09-29");
      const enregistrer = bouton("Enregistrer", d);
      if (inactif(enregistrer)) arret = "enregistrer";
      else await toucher(enregistrer);
    }

    p.liberer();
    await finDeFile();

    if (arret !== null) {
      // Visiblement inactif pendant la file : actif ensuite, et le geste aboutit.
      if (arret === "ouvrir") {
        await attendre(
          () => !inactif(bouton(/^Changer la date/, entreeHistorique(batavia.id) ?? conteneur)),
          "« Changer la date » redevient actif quand la file a fini",
        );
        await toucher(bouton(/^Changer la date/, entreeHistorique(batavia.id) ?? conteneur));
        await attendre(() => dialogue("Changer la date") !== undefined, "dialogue « Changer la date »");
        const champ = [
          ...(dialogue("Changer la date")?.querySelectorAll<HTMLInputElement>("input") ?? []),
        ].find((i) => nomAccessible(i) === "Date");
        if (champ === undefined) throw new Error("champ « Date » absent");
        await remplir(champ, "2026-09-29");
      }
      const d = dialogue("Changer la date");
      expect(d, "le dialogue est resté ouvert").toBeDefined();
      if (d === undefined) return;
      await attendre(
        () => !inactif(bouton("Enregistrer", d)),
        "« Enregistrer » redevient actif quand la file a fini",
      );
      await toucher(bouton("Enregistrer", d));
    }

    await attendre(
      () => remplacements("correction").length >= 1,
      "la correction de date est écrite (le geste n’a pas été ignoré)",
    );
    await tours(40);
    expect(clesEcrites(), "les trois « Fait » de la file").toEqual([CAROTTE, CHOU, RADIS]);
    const corrections = remplacements("correction");
    expect(corrections, "une seule correction").toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      remplace_evenement_id: batavia.id,
      date: "2026-09-29",
    });
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});

// ── G5 ───────────────────────────────────────────────────────────────────────────────────────

describe("T13l, G5 : récolte pendant la file", () => {
  it("jamais ignorée sans retour : visiblement inactive, ou mise en file ; la récolte finit écrite une fois", async () => {
    const p = nouvellePorte();
    await rendre(p.porte);
    await troisFaitEnFile(p);

    const recolte = (): HTMLElement => {
      const d = dialogue("Récolte");
      if (d === undefined) throw new Error("récolte fermée");
      return d;
    };
    /** Choisit la tomate et tape 5 ; rend false si un de ces boutons est visiblement inactif. */
    async function cultureEtQuantite(): Promise<boolean> {
      const tomate = recolte().querySelector<HTMLElement>(
        `[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`,
      );
      expect(tomate, "choix de la tomate").toBeTruthy();
      if (tomate === null) return false;
      if (inactif(tomate)) return false;
      await toucher(tomate);
      const cinq = bouton("5", recolte());
      if (inactif(cinq)) return false;
      await toucher(cinq);
      return true;
    }

    let arret: "ouvrir" | "pave" | "valider" | null = null;
    const ouvrir = bouton(/^Noter une récolte/);
    if (inactif(ouvrir)) arret = "ouvrir";
    else {
      await toucher(ouvrir);
      await attendre(() => dialogue("Récolte") !== undefined, "la récolte s’ouvre");
      if (!(await cultureEtQuantite())) arret = "pave";
      else {
        const valider = bouton(/^Valider/, recolte());
        if (inactif(valider)) arret = "valider";
        else await toucher(valider);
      }
    }

    p.liberer();
    await finDeFile();

    if (arret === "ouvrir") {
      await attendre(
        () => !inactif(bouton(/^Noter une récolte/)),
        "« Noter une récolte » redevient actif quand la file a fini",
      );
      await toucher(bouton(/^Noter une récolte/));
      await attendre(() => dialogue("Récolte") !== undefined, "la récolte s’ouvre");
    }
    if (arret === "ouvrir" || arret === "pave") {
      await attendre(
        () => {
          const t = dialogue("Récolte")?.querySelector<HTMLElement>(
            `[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`,
          );
          return t !== null && t !== undefined && !inactif(t);
        },
        "le choix de la culture redevient actif quand la file a fini",
      );
      expect(await cultureEtQuantite(), "culture et quantité actives après la file").toBe(true);
    }
    if (arret !== null) {
      await attendre(
        () => !inactif(bouton(/^Valider/, recolte())),
        "« Valider » redevient actif quand la file a fini",
      );
      await toucher(bouton(/^Valider/, recolte()));
    }

    await attendre(
      () => recoltes().length >= 1,
      "la récolte est écrite (le geste n’a pas été ignoré)",
    );
    await tours(40);
    expect(clesEcrites(), "les trois « Fait » de la file").toEqual([CAROTTE, CHOU, RADIS]);
    const r = recoltes();
    expect(r, "une seule récolte").toHaveLength(1);
    expect(r[0]?.serie_id).toBe(SERIE.tomate);
    expect(JSON.parse(r[0]?.detail ?? "{}")).toMatchObject({ quantite: 5, unite: "kg" });
    expect(alertes(), "aucune erreur").toEqual([]);
  });
});
