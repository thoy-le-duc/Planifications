// @vitest-environment happy-dom
/**
 * Tests d'acceptation T10h — « en vigueur » identique partout sur le téléphone.
 *
 * Règle (T10g, décision 4), la même qu'au serveur (vue evenements_en_vigueur, `maillonEnVigueur`
 * de apps/api/src/sync/references.ts) : la chaîne d'un événement est son origine, ses
 * corrections, les corrections de ses corrections et toutes leurs annulations ;
 *   - une chaîne qui contient une annulation n'a rien en vigueur ;
 *   - sinon UNE seule saisie : la correction la plus récente de TOUTE la chaîne (horodatage, puis
 *     id le plus grand), à défaut l'origine.
 *
 * 1. Semainier : les réalisés et les interventions lus par `lireJournee` (requête SQL du
 *    semainier) suivent cette règle sur une chaîne ramifiée, comme `enVigueur` (historique) et
 *    comme le serveur. Avant T10h, la requête départageait les corrections d'un même événement
 *    seulement : sur 12 → 15 (06:10), 12 → 20 (06:20), 15 → 30 (06:30), elle gardait 20 ET 30, et
 *    l'annulation de 15 laissait 20 en vigueur.
 *    Le budget de 300 ms du semainier reste porté par apps/web/e2e/aujourdhui.e2e.ts (ferme de
 *    T07 : 3 000 séries, 30 000 événements), qui doit continuer de passer.
 *
 * 2. Historique partiel : l'historique ne lit que 7 jours. Quand l'origine et une première
 *    correction sont plus anciennes, et que la fenêtre contient une correction de cette
 *    correction ET une annulation de l'origine, la chaîne est annulée : la récolte n'apparaît ni
 *    dans l'historique ni dans la dernière récolte de la culture (le serveur refuserait ensuite
 *    toute correction, Q20).
 *
 * 3. Décision 3 du chef après la relecture (N3 — chaînes profondes) : `EN_VIGUEUR` se sert de
 *    `origine_id` quand la ligne l'a (lignes reçues du serveur) et ne remonte la chaîne que pour
 *    les saisies locales pas encore synchronisées. Une chaîne de 1 000 corrections reçue du
 *    serveur : `lireJournee` répond en moins de 100 ms (médiane de 5, node:sqlite) et donne la
 *    bonne valeur en vigueur ; une correction locale (sans `origine_id`) posée dessus l'emporte.
 *
 * Banc : la ferme du jour (./test/ferme-du-jour.ts) dans une base mémoire, aujourd'hui =
 * 2026-09-30 ; les saisies des autres téléphones arrivent par la synchro (`recevoir`).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { ajouterJours, type DateCalendaire, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, enVigueur, lireJournee, type EvenementLu } from './calculs.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable, comme ecran.test.tsx. */
const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const j = (n: number): string => ajouterJours(AUJOURDHUI as DateCalendaire, n);
const idTest = (n: number) => `0192f0c1-1010-7000-8000-0000000a${n.toString(16).padStart(4, '0')}`;
const heure = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

type Remplace = { readonly sorte: 'correction' | 'annulation'; readonly de: string } | null;

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

let base: BaseMemoire;
let porte: PorteDonnees;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
});

/** Événement reçu par la synchro (autre téléphone). */
interface Recu {
  readonly id: string;
  readonly type: 'realise' | 'recolte' | 'intervention';
  readonly date: string;
  readonly horodatage: string;
  readonly serieId: string;
  readonly remplace: Remplace;
  readonly detail: Record<string, unknown>;
  /** T10h, décision 3 : ligne reçue du serveur, qui porte l'origine de sa chaîne. */
  readonly origineId?: string;
}

function recevoir(e: Recu): void {
  const ligne: Record<string, string | null> = {
    id: e.id,
    ferme_id: FERME,
    type: e.type,
    date: e.date,
    horodatage: e.horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: e.serieId,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: e.remplace?.sorte ?? null,
    remplace_evenement_id: e.remplace?.de ?? null,
    detail: JSON.stringify(e.detail),
    cree_le: e.horodatage,
    origine_id: e.origineId ?? null,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

/** Le même événement tel que `enVigueur` (historique) le lit. */
function commeLu(e: Recu): EvenementLu {
  const detail: EvenementLu['detail'] =
    e.type === 'realise'
      ? { type: 'realise', etape: 'semis_direct', quantiteReelle: null }
      : e.type === 'recolte'
        ? { type: 'recolte', quantite: Number(e.detail.quantite), unite: 'kg', categorie: null }
        : { type: 'intervention', categorie: 'travail_sol', libelle: 'grelinette' };
  return {
    id: e.id,
    date: e.date,
    horodatage: e.horodatage,
    serieId: e.serieId,
    campagneId: null,
    remplaceSorte: e.remplace?.sorte ?? null,
    remplaceEvenementId: e.remplace?.de ?? null,
    detail,
  };
}

const ligneTexte = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// ── 1. Semainier : chaîne ramifiée ───────────────────────────────────────────────────────────

/**
 * Chaîne ramifiée d'un événement de la série `serieId` : O (J−5), C1 = correction de O (J−4,
 * 06:10), C2 = correction de O (J−3, 06:20), C3 = correction de C1 (J−2, 06:30). Au serveur, C3
 * seule est en vigueur. Avec `annulerC1`, une annulation de C1 (06:40) remplace C3 : toute la
 * chaîne est annulée, rien en vigueur.
 */
function chaineRamifiee(base0: number, type: Recu['type'], serieId: string, detail: Record<string, unknown>, annulerC1 = false): Recu[] {
  const O = idTest(base0 + 1);
  const C1 = idTest(base0 + 2);
  const C2 = idTest(base0 + 3);
  const commun = { type, serieId, detail };
  const chaine: Recu[] = [
    { ...commun, id: O, date: j(-5), horodatage: heure(j(-5), '06:00'), remplace: null },
    { ...commun, id: C1, date: j(-4), horodatage: heure(j(-1), '06:10'), remplace: { sorte: 'correction', de: O } },
    { ...commun, id: C2, date: j(-3), horodatage: heure(j(-1), '06:20'), remplace: { sorte: 'correction', de: O } },
  ];
  chaine.push(
    annulerC1
      ? { ...commun, id: idTest(base0 + 5), date: j(-4), horodatage: heure(j(-1), '06:40'), remplace: { sorte: 'annulation', de: C1 } }
      : { ...commun, id: idTest(base0 + 4), date: j(-2), horodatage: heure(j(-1), '06:30'), remplace: { sorte: 'correction', de: C1 } },
  );
  return chaine;
}

const SEMIS_DIRECT = { etape: 'semis_direct', quantiteReelle: null };
const GRELINETTE = { categorie: 'travail_sol', type: 'grelinette', outil: null, occurrenceVisee: null };

describe('T10h : le semainier (réalisés et interventions) suit la règle du serveur sur une chaîne ramifiée', () => {
  it('réalisé ramifié (semis direct de la carotte) : une seule date, celle de C3 (J−2), comme enVigueur et le serveur', async () => {
    const chaine = chaineRamifiee(0x100, 'realise', SERIE.carotte, SEMIS_DIRECT);
    for (const e of chaine) recevoir(e);
    const C3 = chaine[3];
    if (C3 === undefined) throw new Error('chaîne');

    // Historique (enVigueur) : C3 seule.
    expect(enVigueur(chaine.map(commeLu)).map((e) => e.id)).toEqual([C3.id]);

    // Semainier (requête SQL) : la première date de l'étape est celle de C3, pas celle de C2 (J−3).
    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    const carotte = lignes.realises.filter((l) => l.serie_id === SERIE.carotte);
    expect(carotte.map((l) => ({ etape: ligneTexte(l.etape), date: ligneTexte(l.date) }))).toEqual([{ etape: 'semis_direct', date: C3.date }]);

    // Même valeur dans l'historique de la journée.
    const journee = calculerJournee(lignes, AUJOURDHUI);
    const dansHistorique = journee.historique.map((h) => h.evenement.id).filter((id) => chaine.some((e) => e.id === id));
    expect(dansHistorique).toEqual([C3.id]);
  });

  it('réalisé ramifié dont une branche est annulée : aucun réalisé en vigueur, la tâche de semis de la carotte reste au semainier', async () => {
    const chaine = chaineRamifiee(0x200, 'realise', SERIE.carotte, SEMIS_DIRECT, true);
    for (const e of chaine) recevoir(e);

    expect(enVigueur(chaine.map(commeLu))).toEqual([]);

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.carotte)).toEqual([]);
    const journee = calculerJournee(lignes, AUJOURDHUI);
    expect(journee.taches.some((t) => t.culture.cibleId === SERIE.carotte), 'tâche de la carotte').toBe(true);
    expect(journee.historique.filter((h) => chaine.some((e) => e.id === h.evenement.id))).toEqual([]);
  });

  it('intervention ramifiée (grelinette sur la batavia) : une seule intervention en vigueur, celle de C3 (J−2)', async () => {
    const chaine = chaineRamifiee(0x300, 'intervention', SERIE.batavia, GRELINETTE);
    for (const e of chaine) recevoir(e);
    const C3 = chaine[3];
    if (C3 === undefined) throw new Error('chaîne');

    expect(enVigueur(chaine.map(commeLu)).map((e) => e.id)).toEqual([C3.id]);

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    const batavia = lignes.interventions.filter((l) => l.serie_id === SERIE.batavia);
    expect(batavia.map((l) => ligneTexte(l.date))).toEqual([C3.date]);
  });

  it('intervention ramifiée dont une branche est annulée : aucune intervention en vigueur', async () => {
    const chaine = chaineRamifiee(0x400, 'intervention', SERIE.batavia, GRELINETTE, true);
    for (const e of chaine) recevoir(e);

    expect(enVigueur(chaine.map(commeLu))).toEqual([]);

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.interventions.filter((l) => l.serie_id === SERIE.batavia)).toEqual([]);
  });

  it('témoin : chaîne simple (origine puis une correction) : la correction, dans le semainier comme dans l’historique', async () => {
    const O = idTest(0x501);
    const C = idTest(0x502);
    recevoir({ id: O, type: 'realise', date: j(-5), horodatage: heure(j(-5), '06:00'), serieId: SERIE.carotte, remplace: null, detail: SEMIS_DIRECT });
    recevoir({ id: C, type: 'realise', date: j(-4), horodatage: heure(j(-1), '06:00'), serieId: SERIE.carotte, remplace: { sorte: 'correction', de: O }, detail: SEMIS_DIRECT });
    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.carotte).map((l) => ligneTexte(l.date))).toEqual([j(-4)]);
    expect(calculerJournee(lignes, AUJOURDHUI).historique.map((h) => h.evenement.id).filter((id) => id === O || id === C)).toEqual([C]);
  });
});

// ── 2. Historique partiel ────────────────────────────────────────────────────────────────────

/**
 * Récolte de tomates 41 kg (origine) le 2026-09-10 et sa correction à 43 kg le 2026-09-11 : hors
 * de la fenêtre de 7 jours (date et heure de saisie). Dans la fenêtre (2026-09-29) : une
 * correction de la correction (47 kg, datée du 29) et l'annulation de l'origine. Chaîne annulée.
 */
function historiquePartiel(): { chaine: Recu[]; ids: string[] } {
  const O = idTest(0x601);
  const C1 = idTest(0x602);
  const C2 = idTest(0x603);
  const A = idTest(0x604);
  const commun = { type: 'recolte' as const, serieId: SERIE.tomate };
  const chaine: Recu[] = [
    { ...commun, id: O, date: '2026-09-10', horodatage: '2026-09-10T06:00:00.000Z', remplace: null, detail: { quantite: 41, unite: 'kg', categorie: null } },
    { ...commun, id: C1, date: '2026-09-10', horodatage: '2026-09-11T06:00:00.000Z', remplace: { sorte: 'correction', de: O }, detail: { quantite: 43, unite: 'kg', categorie: null } },
    { ...commun, id: C2, date: '2026-09-29', horodatage: '2026-09-29T06:00:00.000Z', remplace: { sorte: 'correction', de: C1 }, detail: { quantite: 47, unite: 'kg', categorie: null } },
    { ...commun, id: A, date: '2026-09-29', horodatage: '2026-09-29T07:00:00.000Z', remplace: { sorte: 'annulation', de: O }, detail: { quantite: 41, unite: 'kg', categorie: null } },
  ];
  return { chaine, ids: [O, C1, C2, A] };
}

describe('T10h : historique partiel, la récolte annulée n’apparaît pas', () => {
  it('journée calculée : ni dans l’historique, ni comme dernière récolte de la tomate (47 kg)', async () => {
    const { chaine, ids } = historiquePartiel();
    for (const e of chaine) recevoir(e);
    // Toute la chaîne connue : annulée (règle du serveur).
    expect(enVigueur(chaine.map(commeLu))).toEqual([]);

    const journee = calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    expect(journee.historique.map((h) => h.evenement.id).filter((id) => ids.includes(id))).toEqual([]);
    expect(journee.dernieresRecoltes.get(SERIE.tomate)?.quantite).not.toBe(47);
  });

  describe('écran', () => {
    let conteneur: HTMLDivElement;
    let racine: Root;

    beforeEach(() => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      conteneur = document.createElement('div');
      document.body.append(conteneur);
      racine = createRoot(conteneur);
    });

    afterEach(() => {
      act(() => {
        racine.unmount();
      });
      conteneur.remove();
    });

    async function unTour(): Promise<void> {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    async function attendre(condition: () => boolean, message: string, tours = 200): Promise<void> {
      for (let k = 0; k < tours && !condition(); k++) await unTour();
      expect(condition(), message).toBe(true);
    }

    const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

    function nomAccessible(el: Element): string {
      const label = el.getAttribute('aria-label');
      if (label !== null && label.trim() !== '') return label.trim();
      const par = el.getAttribute('aria-labelledby');
      if (par !== null) return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(' ').trim();
      return texte(el);
    }

    const boutons = (dans: ParentNode): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];

    async function historique(): Promise<HTMLElement> {
      const trouver = () =>
        [...conteneur.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');
      if (trouver() === undefined) {
        const b = boutons(conteneur).find((x) => nomAccessible(x) === 'Historique');
        if (b !== undefined) {
          await act(async () => {
            b.click();
            await Promise.resolve();
          });
          await unTour();
        }
      }
      await attendre(() => trouver() !== undefined, 'région « Historique »');
      const h = trouver();
      if (h === undefined) throw new Error('historique absent');
      return h;
    }

    const entrees = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')];

    it('origine et première correction hors de la fenêtre ; correction de correction et annulation de l’origine dedans : ni entrée ni « Corriger » (47 kg)', async () => {
      const temoin = idTest(0x670);
      recevoir({ id: temoin, type: 'recolte', date: '2026-09-29', horodatage: '2026-09-29T02:00:00.000Z', serieId: SERIE.tomate, remplace: null, detail: { quantite: 7, unite: 'kg', categorie: null } });
      const { chaine, ids } = historiquePartiel();
      for (const e of chaine) recevoir(e);

      await act(async () => {
        racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
        await Promise.resolve();
      });
      await attendre(() => conteneur.querySelectorAll('[data-testid="tache"]').length > 0, 'tâches affichées');
      const h = await historique();
      await attendre(() => entrees(h).some((x) => x.dataset.evenement === temoin), 'la récolte témoin est dans l’historique');

      expect(entrees(h).map((x) => x.dataset.evenement ?? '').filter((id) => ids.includes(id))).toEqual([]);
      const corrections = boutons(h)
        .map(nomAccessible)
        .filter((n) => /^(Corriger|Changer la date)/.test(n) && /4[137] kg/.test(n));
      expect(corrections).toEqual([]);
    });
  });
});

// ── 3. Décision 3 : chaîne profonde reçue du serveur ─────────────────────────────────────────

const CORRECTIONS_CHAINE_PROFONDE = 1_000;
const BUDGET_LECTURE_MS = 100;

/**
 * Semis direct de la carotte : origine (J−5) puis 1 000 corrections en ligne (chacune corrige la
 * précédente), toutes reçues du serveur avec `origine_id` = l'origine. Les 999 premières datées
 * J−4, la dernière J−2 : seule la dernière est en vigueur.
 */
function chaineProfonde(): Recu[] {
  const O = idTest(0x1000);
  const chaine: Recu[] = [{ id: O, type: 'realise', date: j(-5), horodatage: heure(j(-5), '06:00'), serieId: SERIE.carotte, remplace: null, detail: SEMIS_DIRECT, origineId: O }];
  const debut = Date.parse(heure(j(-4), '06:00'));
  for (let k = 1; k <= CORRECTIONS_CHAINE_PROFONDE; k++) {
    const precedent = chaine[k - 1];
    if (precedent === undefined) throw new Error('chaîne');
    chaine.push({
      id: idTest(0x1000 + k),
      type: 'realise',
      date: k === CORRECTIONS_CHAINE_PROFONDE ? j(-2) : j(-4),
      horodatage: new Date(debut + k * 1_000).toISOString(),
      serieId: SERIE.carotte,
      remplace: { sorte: 'correction', de: precedent.id },
      detail: SEMIS_DIRECT,
      origineId: O,
    });
  }
  return chaine;
}

const medianeDe = (valeurs: readonly number[]): number => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;

describe('T10h, décision 3 : chaîne de 1 000 corrections reçue du serveur (origine_id)', { timeout: 120_000 }, () => {
  it('lireJournee en moins de 100 ms (médiane de 5) ; une seule saisie en vigueur, la dernière correction (J−2)', async () => {
    const chaine = chaineProfonde();
    for (const e of chaine) recevoir(e);
    const derniere = chaine[chaine.length - 1];
    if (derniere === undefined) throw new Error('chaîne');

    await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    const serie: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
      serie.push(Math.round(performance.now() - t0));
    }
    expect(medianeDe(serie), `lireJournee : ${serie.join(' / ')} ms`).toBeLessThan(BUDGET_LECTURE_MS);

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.carotte).map((l) => ligneTexte(l.date))).toEqual([j(-2)]);
    const ids = new Set(chaine.map((e) => e.id));
    expect(calculerJournee(lignes, AUJOURDHUI).historique.map((h) => h.evenement.id).filter((id) => ids.has(id))).toEqual([derniere.id]);
  });

  it('témoin : une correction locale sans origine_id (pas encore synchronisée) sur la chaîne profonde l’emporte (J−1)', async () => {
    const chaine = chaineProfonde();
    for (const e of chaine) recevoir(e);
    const derniere = chaine[chaine.length - 1];
    if (derniere === undefined) throw new Error('chaîne');
    const locale = idTest(0x1fff);
    recevoir({ id: locale, type: 'realise', date: j(-1), horodatage: heure(j(-1), '09:00'), serieId: SERIE.carotte, remplace: { sorte: 'correction', de: derniere.id }, detail: SEMIS_DIRECT });

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.carotte).map((l) => ligneTexte(l.date))).toEqual([j(-1)]);
    const ids = new Set([...chaine.map((e) => e.id), locale]);
    expect(calculerJournee(lignes, AUJOURDHUI).historique.map((h) => h.evenement.id).filter((id) => ids.has(id))).toEqual([locale]);
  });

  it('témoin : une annulation locale sans origine_id de l’origine d’une chaîne profonde : plus rien en vigueur', async () => {
    const chaine = chaineProfonde();
    for (const e of chaine) recevoir(e);
    const origine = chaine[0];
    if (origine === undefined) throw new Error('chaîne');
    recevoir({ id: idTest(0x1ffe), type: 'realise', date: j(-5), horodatage: heure(j(-1), '09:00'), serieId: SERIE.carotte, remplace: { sorte: 'annulation', de: origine.id }, detail: SEMIS_DIRECT });

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.carotte)).toEqual([]);
  });
});
