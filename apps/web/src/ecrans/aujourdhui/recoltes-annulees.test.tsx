// @vitest-environment happy-dom
/**
 * Tests d'acceptation T10g (Q20) — écran « Aujourd'hui » : une récolte annulée ne se corrige plus,
 * et le téléphone montre la même saisie en vigueur que le serveur.
 *
 * Même banc que relecture.test.tsx : la ferme du jour (./test/ferme-du-jour.ts) dans une base
 * mémoire, lue et écrite par la porte ; les saisies des autres téléphones arrivent par la synchro
 * (`recevoir`).
 *
 * Règle « en vigueur » d'une chaîne de récolte (l'origine, ses corrections, les corrections de ses
 * corrections, et toutes leurs annulations), la même qu'au serveur
 * (apps/api/src/sync/recoltes-annulees.integration.test.ts) :
 *   - la chaîne contient une annulation (de l'origine ou de n'importe quelle correction) → rien
 *     n'est en vigueur : la récolte est annulée ;
 *   - sinon, UNE seule saisie en vigueur : la correction la plus récente de TOUTE la chaîne
 *     (horodatage, puis id le plus grand), à défaut l'origine.
 *
 * Écran : une récolte annulée n'a ni « Corriger » ni « Changer la date » (la correction du
 * téléphone) dans l'historique ; elle n'y figure plus du tout. Pour rétablir, on saisit une
 * nouvelle récolte.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { enVigueur, type EvenementLu } from './calculs.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable, comme ecran.test.tsx. */
const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Règle « en vigueur » (sans écran) ────────────────────────────────────────────────────────

const idTest = (n: number) => `0192f0c1-1010-7000-8000-00000000${n.toString(16).padStart(4, '0')}`;
const H = (hhmm: string) => `2026-09-29T${hhmm}:00.000Z`;

function lu(id: string, quantite: number, horodatage: string, remplace: { sorte: 'correction' | 'annulation'; de: string } | null = null): EvenementLu {
  return {
    id,
    date: '2026-09-29',
    horodatage,
    serieId: SERIE.tomate,
    campagneId: null,
    remplaceSorte: remplace?.sorte ?? null,
    remplaceEvenementId: remplace?.de ?? null,
    detail: { type: 'recolte', quantite, unite: 'kg', categorie: null },
  };
}

const idsEnVigueur = (evenements: readonly EvenementLu[]): string[] =>
  enVigueur(evenements)
    .map((e) => e.id)
    .sort();

describe('T10g : en vigueur sur le téléphone = en vigueur au serveur', () => {
  const O = idTest(1);
  const C1 = idTest(2);
  const C2 = idTest(3);
  const C3 = idTest(4);
  const A = idTest(5);

  it('deux corrections de l’origine arrivées dans l’ordre inverse de leur heure : la plus récente (07:00) reste, pas la dernière arrivée', () => {
    const origine = lu(O, 12, H('03:00'));
    const recente = lu(C1, 15, H('07:00'), { sorte: 'correction', de: O });
    const ancienne = lu(C2, 100, H('04:00'), { sorte: 'correction', de: O });
    expect(idsEnVigueur([origine, recente, ancienne])).toEqual([C1]);
    expect(idsEnVigueur([origine, ancienne, recente])).toEqual([C1]);
  });

  it('même heure : l’id le plus grand reste', () => {
    const origine = lu(O, 12, H('03:00'));
    expect(idsEnVigueur([origine, lu(C2, 15, H('07:00'), { sorte: 'correction', de: O }), lu(C1, 100, H('07:00'), { sorte: 'correction', de: O })])).toEqual([C2]);
  });

  it('chaîne ramifiée (12 → 15 à 06:10, 12 → 20 à 06:20, 15 → 30 à 06:30) : une seule saisie en vigueur, 30, comme le stock du serveur', () => {
    const chaine = [
      lu(O, 12, H('03:00')),
      lu(C1, 15, H('06:10'), { sorte: 'correction', de: O }),
      lu(C2, 20, H('06:20'), { sorte: 'correction', de: O }),
      lu(C3, 30, H('06:30'), { sorte: 'correction', de: C1 }),
    ];
    expect(idsEnVigueur(chaine)).toEqual([C3]);
  });

  it('chaîne ramifiée dont une branche est annulée (annulation de 12 → 15, alors que 12 → 20 existe) : rien en vigueur', () => {
    const chaine = [
      lu(O, 12, H('03:00')),
      lu(C1, 15, H('06:10'), { sorte: 'correction', de: O }),
      lu(C2, 20, H('06:20'), { sorte: 'correction', de: O }),
      lu(A, 15, H('06:30'), { sorte: 'annulation', de: C1 }),
    ];
    expect(idsEnVigueur(chaine)).toEqual([]);
  });

  it('origine annulée après une correction, puis correction de cette correction arrivée d’un autre téléphone : rien en vigueur', () => {
    const chaine = [
      lu(O, 12, H('03:00')),
      lu(C1, 15, H('04:00'), { sorte: 'correction', de: O }),
      lu(A, 12, H('05:00'), { sorte: 'annulation', de: O }),
      lu(C2, 20, H('06:00'), { sorte: 'correction', de: C1 }),
    ];
    expect(idsEnVigueur(chaine)).toEqual([]);
  });

  it('témoins : origine seule en vigueur ; origine annulée → rien ; autre récolte non touchée', () => {
    const autre = lu(idTest(9), 7, H('02:00'));
    expect(idsEnVigueur([lu(O, 12, H('03:00')), autre])).toEqual([O, autre.id].sort());
    expect(idsEnVigueur([lu(O, 12, H('03:00')), lu(A, 12, H('04:00'), { sorte: 'annulation', de: O }), autre])).toEqual([autre.id]);
  });
});

// ── Écran : historique ───────────────────────────────────────────────────────────────────────

let base: BaseMemoire;
let porte: PorteDonnees;

/** Ligne arrivée par la synchro (autre téléphone, bureau) : prévient les abonnés. */
function recevoir(table: string, ligne: Readonly<Record<string, string | number | null>>): void {
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

/** Récolte de tomates (ou son remplacement) reçue par la synchro, saisie hier. */
function recolteRecue(id: string, quantite: number, horodatage: string, remplace: { sorte: 'correction' | 'annulation'; de: string } | null = null): void {
  recevoir('evenement', {
    id,
    ferme_id: FERME,
    type: 'recolte',
    date: '2026-09-29',
    horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: SERIE.tomate,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: remplace?.sorte ?? null,
    remplace_evenement_id: remplace?.de ?? null,
    detail: JSON.stringify({ quantite, unite: 'kg', categorie: null }),
    cree_le: horodatage,
  });
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

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
  base.fermer();
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

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelectorAll('[data-testid="tache"]').length > 0, 'tâches affichées');
}

async function historique(): Promise<HTMLElement> {
  const trouver = () =>
    [...conteneur.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');
  if (trouver() === undefined) {
    const b = boutons(conteneur).find((x) => nomAccessible(x) === 'Historique');
    if (b !== undefined) await toucher(b);
  }
  await attendre(() => trouver() !== undefined, 'région « Historique »');
  const h = trouver();
  if (h === undefined) throw new Error('historique absent');
  return h;
}

const entrees = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')];

/** Récolte témoin (7 kg, hors de la chaîne) : l'historique est bien dessiné quand on regarde. */
const TEMOIN = idTest(0x70);

/**
 * Historique affiché, témoin compris ; rend les entrées de `chaine` et les boutons de correction
 * (« Corriger », « Changer la date ») qui nomment une quantité de la chaîne.
 */
async function vueDeLaChaine(chaine: readonly string[], quantites: readonly number[]): Promise<{ entrees: string[]; corrections: string[] }> {
  const h = await historique();
  await attendre(() => entrees(h).some((x) => x.dataset.evenement === TEMOIN), 'la récolte témoin est dans l’historique');
  const presentes = entrees(h)
    .map((x) => x.dataset.evenement ?? '')
    .filter((id) => chaine.includes(id));
  const corrections = boutons(h)
    .map(nomAccessible)
    .filter((n) => /^(Corriger|Changer la date)/.test(n) && quantites.some((q) => n.includes(`${String(q)} kg`)));
  return { entrees: presentes, corrections };
}

describe('T10g : pas de « Corriger » sur une récolte annulée (historique)', () => {
  const O = idTest(0x11);
  const C1 = idTest(0x12);
  const C2 = idTest(0x13);
  const C3 = idTest(0x14);
  const A = idTest(0x15);

  beforeEach(() => {
    recolteRecue(TEMOIN, 7, H('02:00'));
  });

  it('récolte annulée (reçue d’un autre téléphone) : absente de l’historique, aucun bouton pour la corriger (témoin)', async () => {
    recolteRecue(O, 41, H('03:00'));
    recolteRecue(A, 41, H('04:00'), { sorte: 'annulation', de: O });
    await rendre();
    expect(await vueDeLaChaine([O, A], [41])).toEqual({ entrees: [], corrections: [] });
  });

  it('origine annulée après une correction, puis correction de la correction reçue d’un autre téléphone : ni entrée ni « Corriger »', async () => {
    recolteRecue(O, 41, H('03:00'));
    recolteRecue(C1, 43, H('04:00'), { sorte: 'correction', de: O });
    recolteRecue(A, 41, H('05:00'), { sorte: 'annulation', de: O });
    recolteRecue(C2, 47, H('06:00'), { sorte: 'correction', de: C1 });
    await rendre();
    expect(await vueDeLaChaine([O, C1, A, C2], [41, 43, 47])).toEqual({ entrees: [], corrections: [] });
  });

  it('chaîne dont une branche est annulée (43 annulée alors que 47 existe) : ni entrée ni « Corriger »', async () => {
    recolteRecue(O, 41, H('03:00'));
    recolteRecue(C1, 43, H('06:10'), { sorte: 'correction', de: O });
    recolteRecue(C2, 47, H('06:20'), { sorte: 'correction', de: O });
    recolteRecue(A, 43, H('06:30'), { sorte: 'annulation', de: C1 });
    await rendre();
    expect(await vueDeLaChaine([O, C1, C2, A], [41, 43, 47])).toEqual({ entrees: [], corrections: [] });
  });

  it('chaîne ramifiée NON annulée : une seule entrée, la correction la plus récente (53 kg), comme au serveur', async () => {
    recolteRecue(O, 41, H('03:00'));
    recolteRecue(C1, 43, H('06:10'), { sorte: 'correction', de: O });
    recolteRecue(C2, 47, H('06:20'), { sorte: 'correction', de: O });
    recolteRecue(C3, 53, H('06:30'), { sorte: 'correction', de: C1 });
    await rendre();
    const vue = await vueDeLaChaine([O, C1, C2, C3], [41, 43, 47, 53]);
    expect(vue.entrees).toEqual([C3]);
    expect(vue.corrections.every((n) => n.includes('53 kg')), `boutons : ${vue.corrections.join(' | ')}`).toBe(true);
  });
});
