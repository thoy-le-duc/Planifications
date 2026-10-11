import { expect, type CDPSession, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import type { ModuleCalculsPlan, Plan } from '../src/ecrans/plan/test/contrat.ts';

/**
 * T11e — outils partagés par les mesures et les tests d'acceptation de « Planches : ouvrir la
 * base plus tôt, maquette, marges de temps » (plan-performances*.e2e.ts, t11e-mesures.e2e.ts).
 * Même amorçage que plan.e2e.ts (ferme de T07 par /diagnostic/amorcer.html) ; rien ici n'est
 * un test.
 */

/** Remplir la base PowerSync (≈ 42 000 lignes, jeu de T07) prend quelques secondes sans ralentissement. */
export const DELAI_AMORCAGE_MS = 120_000;

/** Chemin tenu dans une variable, comme plan.e2e.ts. */
const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/**
 * Le plan attendu (saison par défaut, aujourd'hui), recalculé sous Node sur le jeu de T07 par les
 * calculs de l'écran, comme plan.e2e.ts ; plus la longueur (m) de chaque emplacement, lue dans le
 * jeu (le contrat de T11 ne la porte pas).
 */
export async function planAttendu(): Promise<{ plan: Plan; calculs: ModuleCalculsPlan; aujourdhui: string; longueurs: ReadonlyMap<string, number> }> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const fermeId = jeu.principale.fermeId;
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = await calculs.chargerPlan(porte, fermeId, { saison, aujourdhui });
    const lignes = await base.getAll<{ id: string; longueur_m: number | null }>('SELECT id, longueur_m FROM emplacement WHERE ferme_id = ?', [fermeId]);
    const longueurs = new Map(lignes.map((l) => [l.id, l.longueur_m ?? 0]));
    return { plan, calculs, aujourdhui, longueurs };
  } finally {
    base.fermer();
  }
}

/** Utilisateur du jeu de T07 (remplirJeuT07, graine 7) : un identifiant de test, jamais un vrai compte. */
interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

export const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
export const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });

/** Session (jetons factices) de l'utilisateur du jeu, au format de src/connexion/session.ts. */
export function sessionDe(utilisateurId: string): string {
  return JSON.stringify({ utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) });
}

/** Amorce la base locale (jeu de T07) dans le contexte de `page` ; rend l'utilisateur et la ferme. */
export async function amorcer(page: Page): Promise<{ utilisateurId: string; fermeId: string }> {
  await page.goto('/diagnostic/amorcer.html');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as Amorcage;
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  if (a.utilisateurId === undefined || a.fermeId === undefined) throw new Error('amorçage sans utilisateur ni ferme');
  return { utilisateurId: a.utilisateurId, fermeId: a.fermeId };
}

/** Range la session dans localStorage (la page doit être sur l'origine de l'appli). */
export async function rangerSession(page: Page, utilisateurId: string): Promise<void> {
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, sessionDe(utilisateurId)] as const,
  );
}

/**
 * Comme plan.e2e.ts : base amorcée, session rangée, appli installée (service worker qui contrôle
 * la page) et base prête. Rend l'utilisateur et la ferme du jeu.
 */
export async function installerAvecBase(page: Page): Promise<{ utilisateurId: string; fermeId: string }> {
  const jeu = await amorcer(page);
  await page.goto('/');
  await rangerSession(page, jeu.utilisateurId);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(navigation(page)).toBeVisible();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  return jeu;
}

/** Marque de l'écran Planches (EcranPlan.tsx, MARQUE_PLAN_AFFICHE). */
export const MARQUE_PLAN = 'planif:plan-affiche';

/**
 * Note dans `window.__tapT11e` l'instant (performance.now) du premier appui de chaque page, dès
 * son chargement (script d'initialisation : survit aux rechargements).
 */
export async function noterPremierAppui(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener(
      'pointerdown',
      () => {
        const f = window as unknown as { __tapT11e?: number };
        f.__tapT11e ??= performance.now();
      },
      { capture: true },
    );
  });
}

/** Temps (ms) du premier appui de la page à la marque de Planches ; NaN si l'un manque. */
export async function tapJusquAuPlanDepuisPremierAppui(page: Page): Promise<{ tap: number; plan: number; ms: number }> {
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_PLAN, { timeout: 15_000 });
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tapT11e?: number }).__tapT11e ?? Number.NaN;
    const plan = performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN;
    return { tap, plan, ms: plan - tap };
  }, MARQUE_PLAN);
}

// ── Profil CPU (CDP) ─────────────────────────────────────────────────────────────────────────

interface NoeudProfil {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
}
interface ProfilCpu {
  readonly nodes: readonly NoeudProfil[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

/** Temps propre (ms) par fonction, trié du plus coûteux au moins coûteux. */
export interface LigneProfil {
  readonly fonction: string;
  readonly ms: number;
}

export async function demarrerProfil(cdp: CDPSession): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}

/** Arrête le profil et rend le temps propre par fonction (fichier:ligne), plus haut d'abord. */
export async function arreterProfil(cdp: CDPSession): Promise<LigneProfil[]> {
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: ProfilCpu };
  const parId = new Map(profile.nodes.map((n) => [n.id, n]));
  const temps = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i += 1) {
    const noeud = parId.get(samples[i] ?? -1);
    if (noeud === undefined) continue;
    const { functionName, url, lineNumber } = noeud.callFrame;
    const fichier = url === '' ? '' : ` ${url.split('/').pop() ?? url}:${String(lineNumber + 1)}`;
    const cle = `${functionName === '' ? '(anonyme)' : functionName}${fichier}`;
    // Le delta i est le temps écoulé AVANT l'échantillon i : il revient à l'échantillon i.
    temps.set(cle, (temps.get(cle) ?? 0) + (deltas[i] ?? 0) / 1000);
  }
  return [...temps].map(([fonction, ms]) => ({ fonction, ms })).sort((a, b) => b.ms - a.ms);
}

/** Additionne plusieurs profils (mêmes clés). */
export function additionnerProfils(profils: readonly (readonly LigneProfil[])[]): LigneProfil[] {
  const total = new Map<string, number>();
  for (const p of profils) for (const l of p) total.set(l.fonction, (total.get(l.fonction) ?? 0) + l.ms);
  return [...total].map(([fonction, ms]) => ({ fonction, ms })).sort((a, b) => b.ms - a.ms);
}

// ── Images longues (Long Animation Frames, Chromium) ─────────────────────────────────────────

/** Une image longue, résumée : durée, part du style et de la mise en page, scripts en cause. */
export interface ImageLongue {
  readonly debut: number;
  readonly duree: number;
  /** Du début du rendu (renderStart) à la fin de l'image : style, mise en page, peinture. */
  readonly rendu: number;
  /** Du début du style et de la mise en page (styleAndLayoutStart) à la fin de l'image. */
  readonly styleEtMiseEnPage: number;
  readonly scripts: readonly { readonly source: string; readonly duree: number; readonly miseEnPageForcee: number }[];
}

/** Observe les images longues de chaque page dès son chargement (window.__imagesT11e). */
export async function observerImagesLongues(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const f = window as unknown as { __imagesT11e?: unknown[] };
    f.__imagesT11e = [];
    try {
      new PerformanceObserver((liste) => {
        for (const e of liste.getEntries()) {
          const x = e as PerformanceEntry & {
            renderStart?: number;
            styleAndLayoutStart?: number;
            scripts?: readonly { sourceURL?: string; sourceFunctionName?: string; invoker?: string; duration: number; forcedStyleAndLayoutDuration?: number }[];
          };
          const fin = x.startTime + x.duration;
          f.__imagesT11e?.push({
            debut: x.startTime,
            duree: x.duration,
            rendu: x.renderStart !== undefined && x.renderStart > 0 ? fin - x.renderStart : 0,
            styleEtMiseEnPage: x.styleAndLayoutStart !== undefined && x.styleAndLayoutStart > 0 ? fin - x.styleAndLayoutStart : 0,
            scripts: (x.scripts ?? []).map((s) => ({
              source: `${s.invoker ?? ''} ${s.sourceFunctionName ?? ''} ${(s.sourceURL ?? '').split('/').pop() ?? ''}`.trim(),
              duree: s.duration,
              miseEnPageForcee: s.forcedStyleAndLayoutDuration ?? 0,
            })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // Navigateur sans Long Animation Frames : rien d'observé.
    }
  });
}

/** Images longues observées depuis `depuis` (performance.now de la page). */
export async function imagesLonguesDepuis(page: Page, depuis: number): Promise<ImageLongue[]> {
  return page.evaluate((t) => ((window as unknown as { __imagesT11e?: ImageLongue[] }).__imagesT11e ?? []).filter((i) => i.debut >= t), depuis);
}
