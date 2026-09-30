// @vitest-environment happy-dom
/**
 * Tests d'acceptation T11 — l'écran « Planches » (vue 2D) rendu pour de vrai dans un DOM simulé
 * (happy-dom), sur la ferme de T07 lue par la porte (base mémoire de @planif/sync).
 * Contrat : ./test/contrat.ts (section « Écran (DOM) »). La mise en page réelle (défilement
 * fluide, 360 px, couleurs calculées, temps) est vérifiée par apps/web/e2e/plan.e2e.ts.
 *
 * happy-dom ne calcule pas la mise en page : clientHeight vaut 0, l'écran prend alors
 * window.innerHeight comme hauteur de vue (contrat), et le défilement se simule en posant
 * scrollTop sur data-testid="plan-defilement" puis en envoyant l'événement « scroll ».
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { COULEURS, FAMILLES } from '../../ui/jetons.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleCalculsPlan, type ModuleEcranPlan, type Plan, type SaisonPlan } from './test/contrat.ts';

/** Chemins tenus dans des variables : le typage ne dépend pas des modules pas encore écrits. */
const CHEMIN_ECRAN = './index.ts';
const CHEMIN_CALCULS = './calculs.ts';

const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranPlan;
let calculs: ModuleCalculsPlan;
let base: BaseMemoire;
const aFermer: BaseMemoire[] = [];
let porte: PorteDonnees;
let jeu: JeuT07;
let saisons: SaisonPlan[];
let plan2026: Plan;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranPlan;
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  aFermer.push(base);
  jeu = await remplirJeuT07(base);
  porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
  saisons = await calculs.chargerSaisons(porte, jeu.principale.fermeId);
  const s2026 = saisons.find((s) => s.nom === '2026');
  if (s2026 === undefined) throw new Error('saison 2026 absente');
  plan2026 = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison: s2026, aujourdhui: AUJOURDHUI });
}, 120_000);

afterAll(() => {
  for (const b of aFermer) b.fermer();
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
});

async function laisserFinir(tours = 30): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function rendre(aujourdhui = AUJOURDHUI): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranPlan porte={porte} fermeId={jeu.principale.fermeId} aujourdhui={() => aujourdhui} />);
    await Promise.resolve();
  });
  // Attend les premières lignes (lecture de la base mémoire, calcul, rendu).
  for (let k = 0; k < 200 && lignesDom().length === 0; k++) await laisserFinir(1);
  expect(lignesDom().length, 'lignes du plan affichées').toBeGreaterThan(0);
}

const lignesDom = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')];
const barresDom = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="barre"]')];

function defilement(): HTMLElement {
  const d = conteneur.querySelector<HTMLElement>('[data-testid="plan-defilement"]');
  if (d === null) throw new Error('conteneur data-testid="plan-defilement" absent');
  return d;
}

async function defilerA(px: number): Promise<void> {
  await act(async () => {
    const d = defilement();
    d.scrollTop = px;
    d.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
  });
  await laisserFinir(3);
}

function lignesEmplacement(plan: Plan): LigneEmplacementPlan[] {
  return plan.lignes.filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement');
}

describe('T11 : écran Planches, ferme de T07 (430 lignes)', () => {
  it('virtualisation : moins de 60 lignes dans le DOM, en haut comme en bas', async () => {
    await rendre();
    expect(plan2026.lignes).toHaveLength(430);
    const hautes = lignesDom();
    expect(hautes.length).toBeLessThan(60);
    expect(hautes[0]?.dataset.sorte).toBe('zone');
    expect(hautes[0]?.dataset.id).toBe(plan2026.lignes[0]?.id);

    await defilerA(430 * calculs.HAUTEUR_LIGNE_PX);
    const basses = lignesDom();
    expect(basses.length).toBeGreaterThan(0);
    expect(basses.length).toBeLessThan(60);
    const derniere = plan2026.lignes.at(-1);
    expect(basses.map((l) => l.dataset.id), 'dernière ligne dessinée en bas').toContain(derniere?.id);
    expect(basses.map((l) => l.dataset.id)).not.toContain(plan2026.lignes[0]?.id);
  });

  it('lignes : sorte, id, nom de zone ou code d’emplacement ; barres par occupation', async () => {
    await rendre();
    const parId = new Map(plan2026.lignes.map((l) => [l.id, l]));
    const barresAttendues = new Map(lignesEmplacement(plan2026).flatMap((l) => l.barres.map((b) => [b.occupationId, b] as const)));
    for (const el of lignesDom()) {
      const l = parId.get(el.dataset.id ?? '');
      expect(l, `ligne ${String(el.dataset.id)} inconnue du plan`).toBeDefined();
      if (l === undefined) continue;
      expect(el.dataset.sorte).toBe(l.sorte);
      expect(el.textContent).toContain(l.sorte === 'emplacement' ? l.code : l.nom);
      if (l.sorte === 'emplacement') {
        const dansLaLigne = [...el.querySelectorAll<HTMLElement>('[data-testid="barre"]')].map((b) => b.dataset.occupation).sort();
        expect(dansLaLigne, l.code).toEqual(l.barres.map((b) => b.occupationId).sort());
        expect(el.dataset.conflit === 'oui', `${l.code} : data-conflit`).toBe(l.conflits.length > 0);
      }
    }
    const barres = barresDom();
    expect(barres.length).toBeGreaterThan(0);
    for (const b of barres) {
      const attendue = barresAttendues.get(b.dataset.occupation ?? '');
      expect(attendue, `barre ${String(b.dataset.occupation)}`).toBeDefined();
      if (attendue === undefined) continue;
      expect(b.dataset.etat).toBe(attendue.etat);
      expect(b.dataset.famille).toBe(attendue.cleFamille ?? '');
      expect(b.dataset.conflit === 'oui').toBe(attendue.enConflit);
      expect(b.textContent).toContain(attendue.libelle);
      const bouton = b.tagName === 'BUTTON' || b.getAttribute('role') === 'button';
      expect(bouton, 'barre touchable : <button> ou role="button"').toBe(true);
    }
  });

  it('conflit visible et nommé sur sa ligne (T03)', async () => {
    await rendre();
    const index = plan2026.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length > 0);
    expect(index, 'le jeu de T07 a au moins un conflit en 2026').toBeGreaterThanOrEqual(0);
    const ligne = plan2026.lignes[index] as LigneEmplacementPlan;
    await defilerA(Math.max(0, index - 2) * calculs.HAUTEUR_LIGNE_PX);
    const el = lignesDom().find((l) => l.dataset.id === ligne.id);
    expect(el, `ligne ${ligne.code} dessinée`).toBeDefined();
    expect(el?.dataset.conflit).toBe('oui');
    // Relecture C1 : libellé court de la sorte du premier conflit (le nom long est dans le détail,
    // ouvert par l'étiquette : relecture.test.tsx).
    const nom = el?.querySelector('[data-testid="conflit"]')?.textContent ?? '';
    const sorte = ligne.conflits[0]?.sorte;
    expect(sorte).toBeDefined();
    if (sorte !== undefined) expect(nom.trim()).toBe(LIBELLES_COURTS_ATTENDUS[sorte]);
    const enConflit = el?.querySelectorAll('[data-testid="barre"][data-conflit="oui"]') ?? [];
    expect(enConflit.length).toBeGreaterThan(0);
  });

  it('semaines : 53 colonnes S01…S53, S40 marquée le 30 septembre 2026, un seul repère', async () => {
    await rendre();
    const semaines = [...conteneur.querySelectorAll<HTMLElement>('[data-testid="semaine"]')];
    expect(semaines.map((s) => s.textContent.trim())).toEqual(plan2026.semaines.map((s) => s.libelle));
    expect(semaines).toHaveLength(53);
    const courantes = semaines.filter((s) => s.dataset.courante === 'oui');
    expect(courantes.map((s) => s.textContent.trim())).toEqual(['S40']);
    expect(conteneur.querySelectorAll('[data-testid="semaine-courante"]')).toHaveLength(1);
  });

  it('hors saison (2030) : saison la plus récente, sans repère de semaine courante', async () => {
    await rendre('2030-06-01');
    const choix = conteneur.querySelector<HTMLSelectElement>('select');
    expect(choix?.selectedOptions[0]?.textContent).toBe('2026');
    expect(conteneur.querySelectorAll('[data-testid="semaine-courante"]')).toHaveLength(0);
    expect(conteneur.querySelectorAll('[data-testid="semaine"][data-courante="oui"]')).toHaveLength(0);
  });

  it('changer de saison redessine sans recharger', async () => {
    await rendre();
    const choix = [...conteneur.querySelectorAll<HTMLSelectElement>('select')].find((s) => {
      const id = s.getAttribute('id');
      const etiquette = id === null ? null : conteneur.querySelector(`label[for="${id}"]`);
      return /^saison$/i.test((s.getAttribute('aria-label') ?? etiquette?.textContent ?? s.closest('label')?.textContent ?? '').trim());
    });
    expect(choix, '<select> nommé « Saison »').toBeDefined();
    if (choix === undefined) return;
    expect([...choix.options].map((o) => o.textContent)).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect([...choix.options].map((o) => o.value)).toEqual(saisons.map((s) => s.id));
    expect(choix.value).toBe(saisons.find((s) => s.nom === '2026')?.id);

    const s2024 = saisons.find((s) => s.nom === '2024');
    if (s2024 === undefined) throw new Error('saison 2024 absente');
    const plan2024 = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison: s2024, aujourdhui: AUJOURDHUI });
    const occupations2024 = new Set(lignesEmplacement(plan2024).flatMap((l) => l.barres.map((b) => b.occupationId)));
    const adresse = window.location.href;

    await act(async () => {
      choix.value = s2024.id;
      choix.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await laisserFinir();
    const barres = barresDom();
    expect(barres.length).toBeGreaterThan(0);
    for (const b of barres) expect(occupations2024.has(b.dataset.occupation ?? ''), `barre ${String(b.dataset.occupation)} de 2024`).toBe(true);
    expect(conteneur.querySelectorAll('[data-testid="semaine-courante"]'), 'pas de semaine courante en 2024').toHaveLength(0);
    expect(window.location.href).toBe(adresse);
  });

  it('toucher une barre ouvre le détail de la série, en lecture seule ; « Fermer » le ferme', async () => {
    await rendre();
    const index = plan2026.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length > 0);
    const ligne = plan2026.lignes[index] as LigneEmplacementPlan;
    await defilerA(Math.max(0, index - 2) * calculs.HAUTEUR_LIGNE_PX);
    const cible = ligne.barres.find((b) => b.enConflit);
    expect(cible).toBeDefined();
    const el = conteneur.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${cible?.occupationId ?? ''}"]`);
    expect(el).not.toBeNull();
    expect(conteneur.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      el?.click();
      await Promise.resolve();
    });
    await laisserFinir(5);
    const detail = conteneur.querySelector<HTMLElement>('[role="dialog"]');
    expect(detail, 'panneau de détail (role="dialog")').not.toBeNull();
    if (detail === null || cible === undefined) return;
    const nomDetail = detail.getAttribute('aria-label') ?? document.getElementById(detail.getAttribute('aria-labelledby') ?? '')?.textContent ?? '';
    expect(nomDetail.trim()).toBe('Détail de la série');
    expect(detail.textContent).toContain(cible.libelle);
    expect(detail.textContent).toContain(ligne.code);
    for (const c of ligne.conflits.filter((x) => x.occupations.includes(cible.occupationId))) expect(detail.textContent).toContain(c.nom);
    // Lecture seule : ni champ, ni autre bouton que « Fermer ».
    expect(detail.querySelectorAll('input, select, textarea, [contenteditable="true"]')).toHaveLength(0);
    const boutons = [...detail.querySelectorAll<HTMLElement>('button, [role="button"]')];
    expect(boutons.map((b) => b.textContent.trim())).toEqual(['Fermer']);

    await act(async () => {
      boutons[0]?.click();
      await Promise.resolve();
    });
    await laisserFinir(3);
    expect(conteneur.querySelector('[role="dialog"]')).toBeNull();
  });

  it('marque de performance « planif:plan-affiche » posée à l’affichage', async () => {
    performance.clearMarks('planif:plan-affiche');
    await rendre();
    await laisserFinir(5);
    expect(performance.getEntriesByName('planif:plan-affiche', 'mark').length).toBeGreaterThanOrEqual(1);
  });

  it('export par défaut : l’écran lui-même (chargement différé de App.tsx)', () => {
    expect(ecran.default).toBe(ecran.EcranPlan);
  });
});

// ── Jeton du rouge des conflits ──────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

describe('T11 : jeton COULEURS.conflit', () => {
  const couleurs = COULEURS as Readonly<Record<string, string>>;

  it('défini, distinct des bandes de familles, contour lisible (3:1) sur le fond et la surface', () => {
    const conflit = couleurs.conflit ?? '';
    expect(conflit).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const f of Object.values(FAMILLES)) expect(conflit.toUpperCase()).not.toBe(f.bande.toUpperCase());
    expect(ratio(conflit, COULEURS.fond)).toBeGreaterThanOrEqual(3);
    expect(ratio(conflit, COULEURS.surface)).toBeGreaterThanOrEqual(3);
  });
});
