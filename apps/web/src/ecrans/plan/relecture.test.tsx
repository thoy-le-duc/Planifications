// @vitest-environment happy-dom
/**
 * Tests des corrections de la relecture de T11 (écran « Planches »), dans un DOM simulé
 * (happy-dom), sur la ferme de T07 lue par la porte (base mémoire de @planif/sync). Base à part
 * de celle d'ecran.test.tsx : ces tests écrivent dans la base (synchro simulée).
 * Contrat : ./test/contrat.ts (sections « Écran (DOM) » et « Corrections de la relecture »).
 *
 * B1 — un changement de données (saisie, synchro) ne ramène pas le plan en haut et ne le fait pas
 *   clignoter : pendant la relecture, le plan affiché reste le plan complet (jamais son début),
 *   la position de défilement ne bouge pas, puis les nouvelles données apparaissent. Des
 *   changements rapprochés ne déclenchent pas une relecture chacun : relectures espacées d'au
 *   moins 300 ms, et la dernière voit le dernier changement.
 *   Le changement est simulé par base.recevoir (ligne arrivée par la synchro) : il passe par
 *   onChange, que porte.surveiller (utilisé par cache.ts) écoute.
 *   Une « relecture » se compte à la base : lectures SQL de la table occupation (« FROM
 *   occupation »), regroupées quand elles se suivent à moins de 30 ms (une relecture peut faire
 *   plusieurs requêtes).
 *
 * C1 — noms de conflit lisibles : un libellé court par sorte, un bouton sur l'étiquette de la
 *   ligne qui ouvre la liste complète des conflits (noms longs, cultures en cause), y compris
 *   « Dates inversées » (periode_invalide), qui n'a pas de barre.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleCalculsPlan, type ModuleEcranPlan, type Plan, type SaisonPlan, type SorteConflit } from './test/contrat.ts';

/** Chemins tenus dans des variables : le typage ne dépend pas des modules pas encore écrits. */
const CHEMIN_ECRAN = './index.ts';
const CHEMIN_CALCULS = './calculs.ts';

const AUJOURDHUI = '2026-09-30';
const INSTANT = '2026-09-30T10:00:00.000Z';
/** Espacement minimal entre deux relectures (10 ms de tolérance pour l'horloge des minuteries). */
const ESPACEMENT_MIN_MS = 300;
const TOLERANCE_MS = 10;
/** Deux lectures à moins de 30 ms l'une de l'autre appartiennent à la même relecture. */
const GRAPPE_MS = 30;

let ecran: ModuleEcranPlan;
let calculs: ModuleCalculsPlan;
let base: BaseMemoire;
let porte: PorteDonnees;
let jeu: JeuT07;
let s2026: SaisonPlan;
/** Plan 2026 après l'ajout de la période inversée (voir beforeAll). */
let plan: Plan;
/** Emplacement dont une occupation a des dates inversées (conflit periode_invalide). */
let lignePeriodeInvalide: LigneEmplacementPlan;
let occupationInvalide: string;

/** Lectures de la base par la porte : heure (performance.now) et texte SQL. */
const lectures: { readonly t: number; readonly sql: string }[] = [];

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranPlan;
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  jeu = await remplirJeuT07(base);
  // La porte lit par une base qui note chaque lecture (comptage des relectures, B1).
  const baseNotee: BaseLocale = {
    getAll: <T,>(sql: string, parametres?: readonly unknown[]) => {
      lectures.push({ t: performance.now(), sql });
      return base.getAll<T>(sql, parametres);
    },
    execute: (sql, parametres) => base.execute(sql, parametres),
    writeTransaction: (fn) => base.writeTransaction(fn),
    onChange: (gestionnaire, options) => base.onChange(gestionnaire, options),
  };
  porte = creerPorte(baseNotee, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
  const saisons = await calculs.chargerSaisons(porte, jeu.principale.fermeId);
  const s = saisons.find((x) => x.nom === '2026');
  if (s === undefined) throw new Error('saison 2026 absente');
  s2026 = s;

  // Période inversée (prévu du 10 juin au 20 mai, sans réel) sur une occupation d'un emplacement
  // sans conflit, vers le début du plan : T03 y voit un conflit periode_invalide, sans barre.
  const avant = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison: s2026, aujourdhui: AUJOURDHUI });
  const hote = avant.lignes.find((l, i): l is LigneEmplacementPlan => i >= 3 && i < 40 && l.sorte === 'emplacement' && l.conflits.length === 0 && l.barres.length >= 2);
  const cible = hote?.barres[0];
  if (hote === undefined || cible === undefined) throw new Error('aucun emplacement sans conflit avec deux barres en tête du plan');
  occupationInvalide = cible.occupationId;
  await base.execute('UPDATE occupation SET prevu_du = ?, prevu_au = ?, reel_du = NULL, reel_au = NULL WHERE id = ?', ['2026-06-10', '2026-05-20', occupationInvalide]);
  plan = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison: s2026, aujourdhui: AUJOURDHUI });
  const apres = plan.lignes.find((l): l is LigneEmplacementPlan => l.id === hote.id);
  if (apres === undefined) throw new Error('emplacement hôte disparu du plan');
  lignePeriodeInvalide = apres;
}, 120_000);

afterAll(() => {
  base.fermer();
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

const attendre = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

async function laisserFinir(tours = 30): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await attendre(0);
    });
  }
}

/** Laisse passer `ms` de temps réel, par pas de 10 ms, dans act (minuteries de l'écran comprises). */
async function laisserPasser(ms: number): Promise<void> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) {
    await act(async () => {
      await attendre(10);
    });
  }
}

const lignesDom = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')];
const ligneDom = (id: string): HTMLElement | undefined => lignesDom().find((l) => l.dataset.id === id);

function defilement(): HTMLElement {
  const d = conteneur.querySelector<HTMLElement>('[data-testid="plan-defilement"]');
  if (d === null) throw new Error('conteneur data-testid="plan-defilement" absent');
  return d;
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranPlan porte={porte} fermeId={jeu.principale.fermeId} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  for (let k = 0; k < 200 && lignesDom().length === 0; k++) await laisserFinir(1);
  expect(lignesDom().length, 'lignes du plan affichées').toBeGreaterThan(0);
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

/** Défile jusqu'à la ligne d'indice `index` (deux lignes au-dessus) et attend qu'elle soit dessinée. */
async function allerALaLigne(index: number): Promise<HTMLElement> {
  const id = plan.lignes[index]?.id ?? '';
  for (let k = 0; k < 200; k++) {
    await defilerA(Math.max(0, index - 2) * calculs.HAUTEUR_LIGNE_PX);
    const el = ligneDom(id);
    if (el !== undefined) return el;
    await laisserFinir(1);
  }
  throw new Error(`ligne ${String(index)} jamais dessinée`);
}

function barreDom(occupationId: string): HTMLElement | null {
  return conteneur.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${occupationId}"]`);
}

function nomAccessible(el: Element): string {
  return (el.getAttribute('aria-label') ?? document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').trim();
}

/** Sortes distinctes des conflits de la ligne, dans l'ordre de leur première apparition. */
function sortesDe(ligne: LigneEmplacementPlan): SorteConflit[] {
  const sortes: SorteConflit[] = [];
  for (const c of ligne.conflits) if (!sortes.includes(c.sorte)) sortes.push(c.sorte);
  return sortes;
}

const indexDe = (id: string) => plan.lignes.findIndex((l) => l.id === id);

// ── C1 : noms de conflit lisibles ───────────────────────────────────────────────────────────

describe('T11, relecture C1 : conflits nommés court sur la ligne, détaillés par un bouton', () => {
  it('le jeu contient les cas à tester (plusieurs conflits sur une ligne, période inversée sans barre)', () => {
    expect(lignePeriodeInvalide.conflits.map((c) => c.sorte)).toContain('periode_invalide');
    expect(lignePeriodeInvalide.barres.map((b) => b.occupationId), 'période inversée : pas de barre').not.toContain(occupationInvalide);
    const conflits = plan.lignes.filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement' && l.conflits.length > 0);
    expect(conflits.length).toBeGreaterThan(1);
    expect(conflits.some((l) => l.conflits.length > 1), 'au moins une ligne avec plusieurs conflits').toBe(true);
  });

  it('un libellé court par sorte (« Chevauche », « Trop long », « Surcharge », « Inactif », « Dates ») dans un <button> d’au moins la hauteur de ligne', async () => {
    await rendre();
    const enConflit = plan.lignes
      .map((l, i) => ({ l, i }))
      .filter((x): x is { l: LigneEmplacementPlan; i: number } => x.l.sorte === 'emplacement' && x.l.conflits.length > 0);
    // Les 30 premières, la ligne à la période inversée et celle qui a le plus de sortes.
    const plusDeSortes = enConflit.reduce((a, b) => (sortesDe(b.l).length > sortesDe(a.l).length ? b : a));
    const aVoir = [...enConflit.slice(0, 30), plusDeSortes, { l: lignePeriodeInvalide, i: indexDe(lignePeriodeInvalide.id) }];
    for (const { l, i } of aVoir) {
      const el = await allerALaLigne(i);
      expect(el.dataset.conflit, `${l.code} : data-conflit`).toBe('oui');
      const noms = [...el.querySelectorAll<HTMLElement>('[data-testid="conflit"]')];
      const attendues = sortesDe(l);
      expect(noms.map((n) => n.textContent.trim()), `${l.code} : libellés courts`).toEqual(attendues.map((s) => LIBELLES_COURTS_ATTENDUS[s]));
      expect(noms.map((n) => n.dataset.sorte), `${l.code} : data-sorte`).toEqual(attendues);
      const bouton = el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]');
      expect(bouton, `${l.code} : étiquette data-testid="etiquette-conflit"`).not.toBeNull();
      expect(bouton?.tagName, `${l.code} : étiquette = <button>`).toBe('BUTTON');
      expect(bouton?.getAttribute('type')).toBe('button');
      expect(bouton?.textContent, `${l.code} : le bouton porte le code`).toContain(l.code);
      for (const n of noms) expect(bouton?.contains(n), `${l.code} : libellés dans le bouton`).toBe(true);
    }
    expect(calculs.HAUTEUR_LIGNE_PX, 'cible du bouton : la hauteur de ligne, au moins 48 px').toBeGreaterThanOrEqual(48);
  });

  it('ligne sans conflit : ni bouton d’étiquette, ni libellé de conflit', async () => {
    await rendre();
    const i = plan.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length === 0);
    const el = await allerALaLigne(i);
    expect(el.querySelector('[data-testid="etiquette-conflit"]')).toBeNull();
    expect(el.querySelector('[data-testid="conflit"]')).toBeNull();
  });

  it('toucher l’étiquette ouvre la liste de TOUS les conflits de la planche (noms longs, cultures en cause) ; « Fermer » la ferme', async () => {
    await rendre();
    const i = plan.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length > 1);
    const ligne = plan.lignes[i] as LigneEmplacementPlan;
    const el = await allerALaLigne(i);
    const bouton = el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]');
    expect(bouton, 'étiquette data-testid="etiquette-conflit"').not.toBeNull();
    expect(conteneur.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      bouton?.click();
      await Promise.resolve();
    });
    await laisserFinir(5);
    const detail = conteneur.querySelector<HTMLElement>('[role="dialog"]');
    expect(detail, 'détail des conflits (role="dialog")').not.toBeNull();
    if (detail === null) return;
    expect(nomAccessible(detail)).toMatch(/^Conflits/);
    expect(detail.textContent).toContain(ligne.code);
    const items = [...detail.querySelectorAll('li')].map((li) => li.textContent.trim());
    expect(items, 'un élément de liste par conflit, nom long, dans l’ordre de T03').toEqual(ligne.conflits.map((c) => c.nom));
    const boutons = [...detail.querySelectorAll<HTMLElement>('button, [role="button"]')];
    expect(boutons.map((b) => b.textContent.trim())).toEqual(['Fermer']);
    await act(async () => {
      boutons[0]?.click();
      await Promise.resolve();
    });
    await laisserFinir(3);
    expect(conteneur.querySelector('[role="dialog"]')).toBeNull();
  });

  it('« Dates inversées » (periode_invalide), sans barre : « Dates » sur la ligne, détaillé par le bouton', async () => {
    await rendre();
    const el = await allerALaLigne(indexDe(lignePeriodeInvalide.id));
    expect(barreDom(occupationInvalide), 'période inversée : aucune barre').toBeNull();
    const noms = [...el.querySelectorAll<HTMLElement>('[data-testid="conflit"]')].map((n) => n.textContent.trim());
    expect(noms).toContain('Dates');
    const bouton = el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]');
    expect(bouton).not.toBeNull();
    await act(async () => {
      bouton?.click();
      await Promise.resolve();
    });
    await laisserFinir(5);
    const detail = conteneur.querySelector<HTMLElement>('[role="dialog"]');
    expect(detail).not.toBeNull();
    const invalide = lignePeriodeInvalide.conflits.find((c) => c.sorte === 'periode_invalide');
    expect(invalide?.nom).toMatch(/^Dates inversées : /);
    expect([...(detail?.querySelectorAll('li') ?? [])].map((li) => li.textContent.trim())).toContain(invalide?.nom);
  });
});

// ── B1 : relecture sans retour en haut ni clignotement ──────────────────────────────────────

interface Instantane {
  readonly indices: readonly number[];
  readonly scrollTop: number;
  readonly suite: boolean;
}

/** Note l'état du plan à chaque mutation du DOM ; rend l'arrêt et les instantanés. */
function observer(): { arreter: () => void; instantanes: Instantane[] } {
  const instantanes: Instantane[] = [];
  const noter = () => {
    instantanes.push({
      indices: lignesDom().map((l) => indexDe(l.dataset.id ?? '')),
      scrollTop: defilement().scrollTop,
      suite: conteneur.textContent.includes('Lecture des autres planches'),
    });
  };
  const o = new MutationObserver(noter);
  o.observe(conteneur, { childList: true, subtree: true, characterData: true, attributes: true });
  return {
    arreter: () => {
      noter();
      o.disconnect();
    },
    instantanes,
  };
}

/** Plan complet affiché (la ligne `index` dessinée, plus de « Lecture des autres planches… »). */
async function planCompletA(index: number): Promise<HTMLElement> {
  const el = await allerALaLigne(index);
  for (let k = 0; k < 200 && conteneur.textContent.includes('Lecture des autres planches'); k++) await laisserFinir(1);
  expect(conteneur.textContent).not.toContain('Lecture des autres planches');
  return el;
}

/** Relectures : lectures de la table occupation depuis `depuis`, en grappes (< 30 ms d'écart). */
function relectures(depuis: number): number[] {
  const heures = lectures.filter((l) => l.t >= depuis && /\bFROM\s+occupation\b/i.test(l.sql)).map((l) => l.t);
  const grappes: number[] = [];
  let derniere = Number.NEGATIVE_INFINITY;
  for (const t of heures) {
    if (t - derniere >= GRAPPE_MS) grappes.push(t);
    derniere = t;
  }
  return grappes;
}

/** Premier emplacement à partir de `depuis` qui a au moins `n` barres (hors ligne à période inversée). */
function emplacementAvecBarres(depuis: number, n: number): { ligne: LigneEmplacementPlan; index: number } {
  for (let i = depuis; i < plan.lignes.length; i++) {
    const l = plan.lignes[i];
    if (l?.sorte === 'emplacement' && l.id !== lignePeriodeInvalide.id && l.barres.length >= n) return { ligne: l, index: i };
  }
  throw new Error(`aucun emplacement avec ${String(n)} barres après la ligne ${String(depuis)}`);
}

describe('T11, relecture B1 : un changement de données ne ramène pas le plan en haut', () => {
  it('pendant la relecture, le plan complet reste affiché à la même position ; puis les nouvelles données apparaissent', async () => {
    await rendre();
    const { ligne, index } = emplacementAvecBarres(200, 1);
    await planCompletA(index);
    await laisserPasser(400);
    const scrollTop = defilement().scrollTop;
    expect(scrollTop, 'plan défilé').toBeGreaterThan(0);
    const supprimee = ligne.barres[0]?.occupationId ?? '';
    expect(barreDom(supprimee), 'barre visible avant le changement').not.toBeNull();

    const obs = observer();
    await act(async () => {
      base.recevoir('UPDATE occupation SET supprime_le = ?, modifie_le = ? WHERE id = ?', [INSTANT, INSTANT, supprimee]);
      await Promise.resolve();
    });
    // Relecture terminée : la barre supprimée par la synchro a disparu (3 s au plus).
    const fin = performance.now() + 3_000;
    while (barreDom(supprimee) !== null && performance.now() < fin) await laisserPasser(20);
    await laisserPasser(400);
    obs.arreter();

    expect(barreDom(supprimee), 'nouvelles données affichées : barre supprimée disparue').toBeNull();
    expect(ligneDom(ligne.id), 'la ligne défilée est toujours dessinée').toBeDefined();
    expect(defilement().scrollTop, 'position de défilement inchangée').toBe(scrollTop);
    expect(obs.instantanes.length).toBeGreaterThan(0);
    for (const [k, s] of obs.instantanes.entries()) {
      expect(s.scrollTop, `instantané ${String(k)} : position de défilement`).toBe(scrollTop);
      expect(s.suite, `instantané ${String(k)} : jamais « Lecture des autres planches… » (début du plan)`).toBe(false);
      expect(s.indices.length, `instantané ${String(k)} : lignes dessinées`).toBeGreaterThan(0);
      expect(Math.min(...s.indices), `instantané ${String(k)} : lignes autour de la position (jamais le début du plan)`).toBeGreaterThanOrEqual(index - 20);
      expect(s.indices, `instantané ${String(k)} : la ligne défilée reste dessinée`).toContain(index);
    }
  }, 30_000);

  it('changements rapprochés : relectures espacées d’au moins 300 ms, la dernière voit le dernier changement', async () => {
    await rendre();
    const { ligne, index } = emplacementAvecBarres(260, 2);
    await planCompletA(index);
    await laisserPasser(600);
    const scrollTop = defilement().scrollTop;

    // Six changements à 50 ms d'écart (250 ms en tout) ; le dernier supprime une barre visible.
    const touchees = plan.lignes
      .filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement' && l.id !== ligne.id && l.id !== lignePeriodeInvalide.id)
      .flatMap((l) => l.barres.map((b) => b.occupationId))
      .slice(0, 5);
    const supprimee = ligne.barres[1]?.occupationId ?? '';
    expect(barreDom(supprimee)).not.toBeNull();
    const debut = performance.now();
    for (const id of touchees) {
      await act(async () => {
        base.recevoir('UPDATE occupation SET modifie_le = ? WHERE id = ?', [INSTANT, id]);
        await attendre(50);
      });
    }
    await act(async () => {
      base.recevoir('UPDATE occupation SET supprime_le = ?, modifie_le = ? WHERE id = ?', [INSTANT, INSTANT, supprimee]);
      await Promise.resolve();
    });
    await laisserPasser(1_500);

    const r = relectures(debut);
    const ecarts = r.slice(1).map((t, k) => t - (r[k] ?? 0));
    console.log(`6 changements en 250 ms : ${String(r.length)} relecture(s), écarts ${ecarts.map((e) => e.toFixed(0)).join(', ') || '—'} ms`);
    expect(r.length, 'au moins une relecture').toBeGreaterThanOrEqual(1);
    expect(r.length, '6 changements en 250 ms : pas une relecture par changement').toBeLessThanOrEqual(2);
    for (const e of ecarts) expect(e, 'relectures espacées d’au moins 300 ms').toBeGreaterThanOrEqual(ESPACEMENT_MIN_MS - TOLERANCE_MS);
    expect(barreDom(supprimee), 'la dernière relecture voit le dernier changement').toBeNull();
    expect(defilement().scrollTop).toBe(scrollTop);
  }, 30_000);
});
