// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13l, contre-relecture — garde « saisie encore en vigueur » des
 * annulations et des changements de date (ecritures.ts : `annulerSaisie`, `changerDate`).
 * Règle (vue evenements_en_vigueur, T10g ; `enVigueur` de ./calculs.ts) : une chaîne (origine,
 * corrections, annulations) qui contient une annulation n'a plus rien en vigueur.
 *
 *   A  « Fait » X ; « Changer la date » de X → correction C1 ; puis « Annuler » de X (le bandeau
 *      garde X) → TOUTE la chaîne est annulée : plus rien en vigueur, la tâche revient ; pour une
 *      récolte, le stock revient à son niveau d'avant la récolte. Pas de faux refus : X est
 *      remplacée par une correction, pas par une annulation. (Écritures, puis écran.)
 *   B  X annulée ailleurs (annulation reçue par la synchro, avec son mouvement de stock) alors
 *      que l'écran montre encore C1 : « Changer la date » de C1 est refusé, et une 2e annulation
 *      (de C1) aussi ; rien n'est écrit, aucun mouvement de stock. (Écritures.)
 *   D  Refus de la garde à l'écran (X annulée ailleurs, « Annuler » au bandeau) : un avis clair
 *      (« annulée » ou « corrigée »), pas l'erreur générique « Réessayez… » ; le bandeau part ;
 *      aucun « Annuler » de X ne redevient actif.
 *   E  Index : chaque requête que lisent les vérifications (dans la transaction) de
 *      `changerDate` et `annulerSaisie` accède au journal par un index (SEARCH … USING INDEX ou
 *      clé primaire), jamais par un parcours complet (SCAN) ni par tout le journal de la ferme
 *      (index en tête sur ferme_id contraint par la seule ferme). Banc : schéma PowerSync réel
 *      (./test/base-powersync.ts, comme grande-ferme.test.ts). Indépendant du texte des
 *      requêtes : elles sont captées sur la fonction `lire` passée à la vérification.
 *
 * Pas de `vi.resetModules()` ici : une seule instance de @planif/sync et de l'écran (les
 * classes d'erreur comme DejaFait restent les mêmes partout).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees, type VerificationEcriture } from "@planif/sync";
import type { Id } from "@planif/core";
import {
  creerBaseMemoire,
  type BaseMemoire,
} from "../../../../../packages/sync/src/test/base-memoire.ts";
import { calculerJournee, enVigueur, lireJournee, type Culture, type DetailLu, type EvenementLu, type Journee, type MaillonChaine } from "./calculs.ts";
import { annulerSaisie, changerDate, marquerFait, noterRecolte, type ContexteEcriture } from "./ecritures.ts";
import { EcranAujourdhui } from "./EcranAujourdhui.tsx";
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from "./test/base-powersync.ts";
import { ARTICLE_TOMATE, cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from "./test/ferme-du-jour.ts";

const AUJOURDHUI = "2026-09-30";
const MAINTENANT = new Date("2026-09-30T10:00:00.000Z");
const BATAVIA = cleTache(SERIE.batavia, "plantation");

// ── Base, lecture du journal ─────────────────────────────────────────────────────────────────

type BaseTest = BaseMemoire | BasePowerSync;
let base: BaseTest;
let porte: PorteDonnees;
let ctx: ContexteEcriture;

interface Ligne {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly horodatage: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string;
  readonly emplacement_ids: string;
  readonly origine_id: string | null;
}

const lignes = (): Ligne[] => base.lireDirect<Ligne>("SELECT * FROM evenement");
const ligne = (id: string): Ligne => {
  const l = lignes().find((x) => x.id === id);
  if (l === undefined) throw new Error(`événement ${id} absent`);
  return l;
};

/** L'événement tel que l'écran le garde (bandeau, historique). */
function lu(id: string): EvenementLu {
  const l = ligne(id);
  const d = JSON.parse(l.detail) as Record<string, unknown>;
  const detail: DetailLu =
    l.type === "recolte"
      ? { type: "recolte", quantite: Number(d.quantite), unite: d.unite as "kg", categorie: (d.categorie as string | null) ?? null }
      : { type: "realise", etape: d.etape as "plantation", quantiteReelle: (d.quantiteReelle as number | null) ?? null };
  const sorte = l.remplace_sorte;
  return {
    id: l.id,
    date: l.date,
    horodatage: l.horodatage,
    serieId: l.serie_id,
    campagneId: l.campagne_id,
    remplaceSorte: sorte === "correction" || sorte === "annulation" ? sorte : null,
    remplaceEvenementId: l.remplace_evenement_id,
    detail,
  };
}

/** Ids en vigueur du journal de la série. */
function enVigueurDe(serieId: string): string[] {
  const chaine = lignes()
    .filter((l) => l.serie_id === serieId)
    .map((l): MaillonChaine => ({
      id: l.id,
      horodatage: l.horodatage,
      remplaceSorte: l.remplace_sorte === "correction" || l.remplace_sorte === "annulation" ? l.remplace_sorte : null,
      remplaceEvenementId: l.remplace_evenement_id,
    }));
  return enVigueur(chaine).map((e) => e.id);
}

const stockTomate = (): number =>
  base.lireDirect<{ s: number | null }>("SELECT SUM(quantite) AS s FROM mouvement_stock WHERE article_stock_id = ?", [ARTICLE_TOMATE])[0]?.s ?? 0;
const nombre = (table: string): number =>
  base.lireDirect<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0]?.n ?? 0;

async function journee(): Promise<Journee> {
  return calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
}

async function cultureDe(cle: string): Promise<Culture> {
  const t = (await journee()).taches.find((x) => x.cle === cle);
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t.culture;
}

async function cultureTomate(): Promise<Culture> {
  const c = (await journee()).recoltesEnCours.find((x) => x.cibleId === SERIE.tomate);
  if (c === undefined) throw new Error("récolte de tomate pas en cours");
  return c;
}

let compteur = 0;
/** Annulation de `id` reçue par la synchro (autre téléphone) ; récolte : avec son mouvement inverse. */
function annulationRecue(id: string): string {
  const x = ligne(id);
  const aid = `0192f0c1-13e2-7000-8000-0000000a${(++compteur).toString(16).padStart(4, "0")}`;
  const l: Record<string, string | null> = {
    id: aid,
    ferme_id: FERME,
    type: x.type,
    date: x.date,
    horodatage: `${AUJOURDHUI}T09:00:00.000Z`,
    auteur_id: UTILISATEUR,
    source: "tap",
    serie_id: x.serie_id,
    campagne_id: x.campagne_id,
    emplacement_ids: x.emplacement_ids,
    note: null,
    photos: "[]",
    remplace_sorte: "annulation",
    remplace_evenement_id: x.id,
    detail: x.detail,
    cree_le: `${AUJOURDHUI}T09:00:01.000Z`,
    origine_id: x.origine_id ?? x.id,
  };
  const c = Object.keys(l);
  base.recevoir(`INSERT INTO evenement (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`, c.map((k) => l[k] ?? null));
  if (x.type === "recolte") {
    const q = Number((JSON.parse(x.detail) as { quantite: unknown }).quantite);
    base.recevoir(
      "INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`0192f0c1-13e2-7000-8000-0000000b${compteur.toString(16).padStart(4, "0")}`, FERME, ARTICLE_TOMATE, x.date, -q, "recolte", aid, `${AUJOURDHUI}T09:00:01.000Z`],
    );
  }
  return aid;
}

function preparer(b: BaseTest): void {
  base = b;
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<"Utilisateur">, fermeId: FERME as Id<"Ferme"> });
  ctx = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
}

// ── A, B : écritures ─────────────────────────────────────────────────────────────────────────

describe("T13l, A et B : garde des remplacements (écritures)", () => {
  beforeEach(async () => {
    preparer(creerBaseMemoire(SCHEMA_LOCAL));
    await ecrireFermeDuJour(base, AUJOURDHUI);
  });
  afterEach(() => {
    base.fermer();
  });

  it("A, réalisé : X corrigée en C1, puis « Annuler » de X → toute la chaîne est annulée", async () => {
    const x = await marquerFait(ctx, await cultureDe(BATAVIA), "plantation");
    const c1 = await changerDate(ctx, lu(x), "2026-09-29");
    expect(enVigueurDe(SERIE.batavia)).toContain(c1);

    await expect(annulerSaisie(ctx, lu(x)), "pas de faux refus : X est corrigée, pas annulée").resolves.toBeTypeOf("string");
    const vigueur = enVigueurDe(SERIE.batavia);
    expect(vigueur, "ni X ni C1 en vigueur").not.toContain(x);
    expect(vigueur).not.toContain(c1);
    expect((await journee()).taches.some((t) => t.cle === BATAVIA), "la plantation de la batavia revient à faire").toBe(true);
  });

  it("A, récolte : X corrigée en C1, puis « Annuler » de X → chaîne annulée, stock revenu à son niveau d’avant", async () => {
    const avant = stockTomate();
    const x = await noterRecolte(ctx, await cultureTomate(), 5, "kg");
    expect(stockTomate()).toBe(avant + 5);
    const c1 = await changerDate(ctx, lu(x), "2026-09-29");
    expect(stockTomate(), "changer la date ne touche pas au stock").toBe(avant + 5);

    await expect(annulerSaisie(ctx, lu(x)), "pas de faux refus").resolves.toBeTypeOf("string");
    expect(stockTomate(), "le stock revient à son niveau d’avant la récolte").toBe(avant);
    const vigueur = enVigueurDe(SERIE.tomate);
    expect(vigueur).not.toContain(x);
    expect(vigueur).not.toContain(c1);
  });

  it("B, récolte : X annulée ailleurs, l’écran montre C1 → date de C1 et 2e annulation refusées, rien d’écrit, stock intact", async () => {
    const avant = stockTomate();
    const x = await noterRecolte(ctx, await cultureTomate(), 5, "kg");
    const c1 = await changerDate(ctx, lu(x), "2026-09-29");
    const c1Garde = lu(c1); // ce que montre encore l'écran
    annulationRecue(x);
    expect(stockTomate(), "l’annulation reçue a remis le stock").toBe(avant);
    expect(enVigueurDe(SERIE.tomate), "chaîne annulée").not.toContain(c1);
    const evenements = nombre("evenement");
    const mouvements = nombre("mouvement_stock");

    await expect(changerDate(ctx, c1Garde, "2026-09-28"), "date de C1 refusée").rejects.toThrow();
    await expect(annulerSaisie(ctx, c1Garde), "2e annulation refusée").rejects.toThrow();
    expect(nombre("evenement"), "aucun événement écrit").toBe(evenements);
    expect(nombre("mouvement_stock"), "aucun mouvement de stock").toBe(mouvements);
    expect(stockTomate()).toBe(avant);
    expect(enVigueurDe(SERIE.tomate), "la chaîne ne revit pas").not.toContain(c1);
  });

  it("B, réalisé : X annulée ailleurs → date de C1 refusée, la plantation ne revit pas", async () => {
    const x = await marquerFait(ctx, await cultureDe(BATAVIA), "plantation");
    const c1 = await changerDate(ctx, lu(x), "2026-09-29");
    const c1Garde = lu(c1);
    annulationRecue(x);
    const evenements = nombre("evenement");
    await expect(changerDate(ctx, c1Garde, "2026-09-28")).rejects.toThrow();
    await expect(annulerSaisie(ctx, c1Garde)).rejects.toThrow();
    expect(nombre("evenement")).toBe(evenements);
    expect(enVigueurDe(SERIE.batavia).filter((id) => id === x || id === c1)).toEqual([]);
  });
});

// ── A, D : écran ─────────────────────────────────────────────────────────────────────────────

describe("T13l, A et D : à l’écran", () => {
  let conteneur: HTMLDivElement;
  let racine: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    preparer(creerBaseMemoire(SCHEMA_LOCAL));
    await ecrireFermeDuJour(base, AUJOURDHUI);
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
  async function attendre(condition: () => boolean, message: string, n = 400): Promise<void> {
    for (let k = 0; k < n && !condition(); k++) await unTour();
    expect(condition(), message).toBe(true);
  }
  async function tours(n: number): Promise<void> {
    for (let k = 0; k < n; k++) await unTour();
  }
  const texte = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const nom = (b: Element): string => (b.getAttribute("aria-label") ?? texte(b)).trim();
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
  const boutonDans = (dans: ParentNode, re: RegExp): HTMLButtonElement | undefined =>
    [...dans.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(nom(b)));
  const tache = (cle: string) => conteneur.querySelector<HTMLElement>(`[data-testid="tache"][data-cle="${cle}"]`);
  const bandeau = () => conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
  const entree = (id: string) => conteneur.querySelector<HTMLElement>(`[data-testid="saisie-historique"][data-evenement="${id}"]`);
  const messages = (): string[] => [...conteneur.querySelectorAll('[role="status"], [role="alert"]')].map((e) => texte(e));
  const dialogue = (debut: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => nom(d).startsWith(debut));
  const realisesBatavia = () => lignes().filter((l) => l.serie_id === SERIE.batavia && l.type === "realise" && l.remplace_sorte === null && l.date === AUJOURDHUI);

  async function rendreEtFaire(): Promise<string> {
    await act(async () => {
      racine.render(<EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    await attendre(() => tache(BATAVIA) !== null, "batavia affichée");
    const fait = boutonDans(tache(BATAVIA) ?? conteneur, /^Marquer fait/);
    if (fait === undefined) throw new Error("« Marquer fait » absent");
    await toucher(fait);
    await attendre(() => realisesBatavia().length === 1, "plantation de la batavia écrite");
    const x = realisesBatavia()[0]?.id ?? "";
    await attendre(() => bandeau() !== null && entree(x) !== null, "bandeau et historique de la batavia");
    return x;
  }

  it("A : « Changer la date » de X depuis l’historique, puis « Annuler » au bandeau → la chaîne est annulée", async () => {
    const x = await rendreEtFaire();
    const ouvrir = boutonDans(entree(x) ?? conteneur, /^Changer la date/);
    if (ouvrir === undefined) throw new Error("« Changer la date » absent");
    await toucher(ouvrir);
    await attendre(() => dialogue("Changer la date") !== undefined, "dialogue « Changer la date »");
    const d = dialogue("Changer la date");
    const champ = d?.querySelector<HTMLInputElement>('input[type="date"]');
    if (d === undefined || champ === null || champ === undefined) throw new Error("dialogue incomplet");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(champ, "2026-09-29");
      champ.dispatchEvent(new Event("input", { bubbles: true }));
      champ.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    const enregistrer = boutonDans(d, /^Enregistrer$/);
    if (enregistrer === undefined) throw new Error("« Enregistrer » absent");
    await toucher(enregistrer);
    await attendre(() => lignes().some((l) => l.remplace_sorte === "correction" && l.remplace_evenement_id === x), "correction C1 écrite");

    const b = bandeau();
    expect(b, "le bandeau de X est encore là").not.toBeNull();
    const annuler = b === null ? undefined : boutonDans(b, /^Annuler/);
    expect(annuler !== undefined && !inactif(annuler), "« Annuler » du bandeau actif").toBe(true);
    if (annuler === undefined) return;
    await toucher(annuler);
    await tours(40);

    expect(messages().filter((m) => /Réessayez/i.test(m)), "aucune erreur").toEqual([]);
    expect(lignes().filter((l) => l.remplace_sorte === "annulation"), "une annulation écrite").toHaveLength(1);
    const chaine = new Set([x, ...lignes().filter((l) => l.remplace_evenement_id === x).map((l) => l.id)]);
    expect(enVigueurDe(SERIE.batavia).filter((id) => chaine.has(id)), "rien de la chaîne en vigueur").toEqual([]);
    await attendre(() => tache(BATAVIA) !== null, "la plantation de la batavia revient à faire");
  });

  it("D : X annulée ailleurs, « Annuler » au bandeau → avis clair, bandeau parti, « Annuler » jamais réactivé", async () => {
    const x = await rendreEtFaire();
    annulationRecue(x);
    const avant = lignes().length;
    const b = bandeau();
    const annuler = b === null ? undefined : boutonDans(b, /^Annuler/);
    if (annuler !== undefined && !inactif(annuler)) await toucher(annuler);
    await tours(60);

    expect(lignes().length, "rien d’écrit").toBe(avant);
    expect(messages().filter((m) => /Réessayez/i.test(m)), `pas l’erreur générique (messages : ${messages().join(" | ")})`).toEqual([]);
    expect(
      messages().some((m) => /annul|corrig/i.test(m)),
      `un avis dit que la saisie est déjà annulée ou corrigée (messages : ${messages().join(" | ")})`,
    ).toBe(true);
    expect(bandeau(), "le bandeau est retiré").toBeNull();
    const e = entree(x);
    const annulerHisto = e === null ? undefined : boutonDans(e, /^Annuler/);
    expect(annulerHisto === undefined || inactif(annulerHisto), "« Annuler » de X ne redevient pas actif").toBe(true);
  });
});

// ── E : index de la garde ────────────────────────────────────────────────────────────────────

describe("T13l, E : la vérification des remplacements se sert des index du journal", () => {
  const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;
  const INTERNE = "ps_data__evenement";
  let pb: BasePowerSync;

  beforeEach(async () => {
    pb = creerBasePowerSync(SCHEMA);
    preparer(pb);
    await ecrireFermeDuJour(base, AUJOURDHUI);
  });
  afterEach(() => {
    pb.fermer();
  });

  const indexFerme = new Set(
    (SCHEMA.tables.find((t) => t.name === "evenement")?.indexes ?? [])
      .filter((i) => i.columns[0]?.name === "ferme_id")
      .map((i) => `${INTERNE}__${i.name}`),
  );

  /** Accès au journal qui ne passent pas par un index utile. */
  function sansIndex(plan: readonly string[]): string[] {
    return plan.filter((chemin) => {
      const l = chemin.split(" › ").at(-1) ?? "";
      if (!l.includes(INTERNE)) return false;
      if (new RegExp(`^SCAN ${INTERNE}\\b`).test(l)) return true;
      if (new RegExp(`^SEARCH ${INTERNE} USING (?:INTEGER )?PRIMARY KEY`).test(l)) return false;
      const m = new RegExp(`^SEARCH ${INTERNE} USING (?:COVERING )?(?:AUTOMATIC )?(?:COVERING )?INDEX (\\S+) \\((.*)\\)`).exec(l);
      if (m === null) return true;
      if (l.includes("AUTOMATIC")) return true;
      return indexFerme.has(m[1] ?? "") && (m[2] ?? "").split(" AND ").length === 1;
    });
  }

  it("changerDate et annulerSaisie : chaque requête de vérification passe par un index", async () => {
    const vues: { sql: string; parametres: readonly unknown[] }[] = [];
    const espion: PorteDonnees = {
      ...porte,
      ecrireEnsemble: (ordres, verifier?: VerificationEcriture) =>
        porte.ecrireEnsemble(
          ordres,
          verifier === undefined
            ? undefined
            : (lire) =>
                verifier(<T,>(sql: string, parametres?: readonly unknown[]) => {
                  vues.push({ sql, parametres: parametres ?? [] });
                  return lire<T>(sql, parametres);
                }),
        ),
    };
    const x = await marquerFait(ctx, await cultureDe(BATAVIA), "plantation");
    vues.length = 0;
    const ctxEspion = { ...ctx, porte: espion };
    const c1 = await changerDate(ctxEspion, lu(x), "2026-09-29");
    const r = await noterRecolte(ctx, await cultureTomate(), 5, "kg");
    await annulerSaisie(ctxEspion, lu(c1));
    await annulerSaisie(ctxEspion, lu(r));

    const surLeJournal = vues.filter((v) => /\bevenement\b/.test(v.sql));
    expect(surLeJournal.length, "les vérifications lisent le journal").toBeGreaterThan(0);
    const fautes = surLeJournal.flatMap((v) =>
      sansIndex(pb.plan(v.sql, v.parametres)).map((l) => `${v.sql.replace(/\s+/g, " ").slice(0, 80)}… : ${l}`),
    );
    expect(fautes, "accès au journal sans index utile").toEqual([]);
  });
});
