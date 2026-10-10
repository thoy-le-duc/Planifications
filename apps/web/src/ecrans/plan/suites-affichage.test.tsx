// @vitest-environment happy-dom
/**
 * Tests d'acceptation T11b — affichage de l'écran « Planches » dans un DOM simulé (happy-dom) :
 *   règle 1  libellé de barre collant à gauche ;
 *   règle 2  plus de deux sortes de conflit : étiquette compacte « Chevauche +2 » ;
 *   règle 4  focus rendu à la fermeture de la feuille des conflits et du détail d'une série.
 * Contrat : ./test/contrat-t11b.ts (règles 1, 2 et 4).
 *
 * happy-dom ne calcule pas la mise en page : la feuille de style plan.css est injectée dans la
 * page et on lit les styles calculés (position, left, overflow, height). La mise en page réelle
 * (le libellé qui reste à l'écran quand on défile) relève d'un essai e2e.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleEcranPlan, type Plan } from './test/contrat.ts';
import { E11B, FERME, O11B, SAISONS, remplirFermeT11b, type ModuleCalculsT11b } from './test/contrat-t11b.ts';

const CHEMIN_ECRAN = './index.ts';
const CHEMIN_CALCULS = './calculs.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranPlan;
let calculs: ModuleCalculsT11b;
let base: BaseMemoire;
let porte: PorteDonnees;
let plan: Plan;
let feuilleDeStyle: string;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranPlan;
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsT11b;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await remplirFermeT11b(base);
  porte = creerPorte(base, { utilisateurId: '0192f0c1-0000-7000-8000-0000000000aa' as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  const saison = SAISONS[1];
  if (saison === undefined) throw new Error('saison 2026 absente');
  plan = calculs.construirePlan(await calculs.lireDonneesPlan(porte, FERME), { saison, aujourdhui: AUJOURDHUI });
  // plan.css lu sur le disque (happy-dom ne traite pas les imports de feuilles de style).
  const fs = process.getBuiltinModule('node:fs');
  const chemin = process.getBuiltinModule('node:path');
  feuilleDeStyle = fs.readFileSync(chemin.join(import.meta.dirname, 'plan.css'), 'utf8');
}, 60_000);

afterAll(() => {
  base.fermer();
});

let conteneur: HTMLDivElement;
let racine: Root;
let style: HTMLStyleElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  style = document.createElement('style');
  style.textContent = feuilleDeStyle;
  document.head.append(style);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  style.remove();
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

const lignesDom = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')];
const ligneDom = (id: string): HTMLElement | undefined => lignesDom().find((l) => l.dataset.id === id);
const barreDom = (occupationId: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${occupationId}"]`);
const indexDe = (id: string): number => plan.lignes.findIndex((l) => l.id === id);

function defilement(): HTMLElement {
  const d = conteneur.querySelector<HTMLElement>('[data-testid="plan-defilement"]');
  if (d === null) throw new Error('conteneur data-testid="plan-defilement" absent');
  return d;
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranPlan porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
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

/** Défile jusqu'à la ligne `id` et attend qu'elle soit dessinée. */
async function allerALaLigne(id: string): Promise<HTMLElement> {
  const index = indexDe(id);
  expect(index, `ligne ${id} dans le plan`).toBeGreaterThanOrEqual(0);
  for (let k = 0; k < 200; k++) {
    await defilerA(Math.max(0, index - 2) * calculs.HAUTEUR_LIGNE_PX);
    const el = ligneDom(id);
    if (el !== undefined) return el;
    await laisserFinir(1);
  }
  throw new Error(`ligne ${id} jamais dessinée`);
}

async function toucher(el: HTMLElement | null | undefined): Promise<void> {
  if (el === null || el === undefined) throw new Error('élément à toucher absent');
  await act(async () => {
    el.click();
    await Promise.resolve();
  });
  await laisserFinir(5);
}

const dialogue = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[role="dialog"]');

function boutonFermer(): HTMLElement {
  const b = [...(dialogue()?.querySelectorAll<HTMLElement>('button') ?? [])].find((x) => x.textContent.trim() === 'Fermer');
  if (b === undefined) throw new Error('bouton « Fermer » absent');
  return b;
}

async function fermerParBouton(): Promise<void> {
  await toucher(boutonFermer());
  expect(dialogue(), 'feuille fermée').toBeNull();
}

async function fermerParEchap(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
  });
  await laisserFinir(5);
  expect(dialogue(), 'feuille fermée par Échap').toBeNull();
}

function requis<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('élément attendu absent');
  return v;
}

const ligneDuPlan = (id: string): LigneEmplacementPlan => {
  const l = plan.lignes.find((x) => x.id === id);
  if (l?.sorte !== 'emplacement') throw new Error(`ligne ${id} absente du plan`);
  return l;
};

function sortesDe(ligne: LigneEmplacementPlan): string[] {
  const sortes: string[] = [];
  for (const c of ligne.conflits) if (!sortes.includes(c.sorte)) sortes.push(c.sorte);
  return sortes;
}

// ── Règle 1 : libellé collant à gauche ───────────────────────────────────────────────────────

describe('T11b règle 1 : le libellé d’une barre reste lisible quand la barre commence avant la zone visible', () => {
  it('témoin : la feuille de style est bien appliquée (colonne des codes collée à gauche)', async () => {
    await rendre();
    const etiquette = conteneur.querySelector<HTMLElement>('.plan-etiquette');
    expect(etiquette).not.toBeNull();
    expect(getComputedStyle(requis(etiquette)).position).toBe('sticky');
    expect(getComputedStyle(requis(etiquette)).left).toBe('0px');
  });

  it('le libellé est collant (sticky), au bord droit de la colonne des codes, dans la barre', async () => {
    await rendre();
    const barres = [...conteneur.querySelectorAll<HTMLElement>('[data-testid="barre"]')];
    expect(barres.length).toBeGreaterThan(0);
    // Barres assez larges pour porter un libellé (les barres étroites le cachent exprès).
    const avecLibelle = barres.filter((b) => b.querySelector(':scope > span') !== null);
    expect(avecLibelle.length).toBeGreaterThan(0);
    for (const b of avecLibelle) {
      const libelle = b.querySelector<HTMLElement>(':scope > span');
      if (libelle === null) continue;
      const calcule = getComputedStyle(libelle);
      expect(calcule.position, `${b.dataset.occupation ?? ''} : libellé sticky`).toBe('sticky');
      const gauche = Number.parseFloat(calcule.left);
      expect(gauche, `${b.dataset.occupation ?? ''} : left du libellé (px)`).toBeGreaterThanOrEqual(calculs.LARGEUR_ETIQUETTE_PX);
      expect(gauche, 'left raisonnable (pas hors de l’écran)').toBeLessThanOrEqual(calculs.LARGEUR_ETIQUETTE_PX + 16);
    }
  });

  it('aucun ancêtre du libellé (barre, ligne, grille) ne coupe le défilement collant (overflow ≠ visible)', async () => {
    await rendre();
    const libelle = conteneur.querySelector<HTMLElement>('[data-testid="barre"] > span');
    expect(libelle).not.toBeNull();
    const defil = defilement();
    for (let el: HTMLElement | null = libelle?.parentElement ?? null; el !== null && el !== defil; el = el.parentElement) {
      const o = getComputedStyle(el);
      const desc = `${el.tagName}.${el.className}`;
      for (const axe of [o.overflow, o.overflowX, o.overflowY]) {
        expect(['', 'visible', 'clip'], `${desc} : overflow « ${axe} » ferait de cet élément le conteneur du libellé collant`).toContain(axe);
      }
    }
  });
});

// ── Règle 2 : étiquette compacte au-delà de deux sortes ──────────────────────────────────────

describe('T11b règle 2 : plus de deux sortes de conflit sur une planche', () => {
  it('le jeu contient les cas à tester : 3 sortes sur T2-P3, 2 sortes sur T2-P4', () => {
    expect(sortesDe(ligneDuPlan(E11B.triple)).length).toBeGreaterThanOrEqual(3);
    expect(sortesDe(ligneDuPlan(E11B.double))).toHaveLength(2);
  });

  it('trois sortes : une seule étiquette « Chevauche +2 », dans le bouton, sans débordement', async () => {
    await rendre();
    const ligne = ligneDuPlan(E11B.triple);
    const sortes = sortesDe(ligne);
    const el = await allerALaLigne(E11B.triple);
    const bouton = el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]');
    expect(bouton, 'étiquette-conflit').not.toBeNull();
    expect(bouton?.tagName).toBe('BUTTON');
    expect(bouton?.textContent).toContain(ligne.code);
    const libelles = [...el.querySelectorAll<HTMLElement>('[data-testid="conflit"]')];
    const premiere = ligne.conflits[0]?.sorte;
    if (premiere === undefined) throw new Error('aucun conflit');
    expect(libelles.map((l) => l.textContent.trim())).toEqual([`${LIBELLES_COURTS_ATTENDUS[premiere]} +${String(sortes.length - 1)}`]);
    expect(libelles[0]?.textContent.trim()).toBe('Chevauche +2');
    expect(bouton?.contains(libelles[0] ?? null)).toBe(true);

    // Elle ne déborde pas sur la ligne suivante : même mise en forme qu'une étiquette de ligne.
    const calcule = getComputedStyle(requis(bouton));
    expect(calcule.overflow, 'étiquette : overflow').not.toBe('visible');
    expect(calcule.height, 'étiquette : hauteur de la ligne, pas « auto »').not.toBe('auto');
    expect(el.className, 'ligne sans la classe de débordement d’avant').not.toMatch(/conflits-nombreux/);
  });

  it('trois sortes : toucher l’étiquette ouvre toujours la liste complète des conflits', async () => {
    await rendre();
    const ligne = ligneDuPlan(E11B.triple);
    const el = await allerALaLigne(E11B.triple);
    await toucher(el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]'));
    const items = [...(dialogue()?.querySelectorAll('li') ?? [])].map((li) => li.textContent.trim());
    expect(items).toEqual(ligne.conflits.map((c) => c.nom));
  });

  it('deux sortes : deux libellés courts, comme avant', async () => {
    await rendre();
    const ligne = ligneDuPlan(E11B.double);
    const el = await allerALaLigne(E11B.double);
    const libelles = [...el.querySelectorAll<HTMLElement>('[data-testid="conflit"]')].map((l) => l.textContent.trim());
    expect(libelles).toEqual(sortesDe(ligne).map((s) => LIBELLES_COURTS_ATTENDUS[s as keyof typeof LIBELLES_COURTS_ATTENDUS]));
    expect(libelles).toHaveLength(2);
  });
});

// ── Règle 4 : focus rendu à la fermeture ─────────────────────────────────────────────────────

describe('T11b règle 4 : le focus revient à ce qui a ouvert la feuille', () => {
  for (const [nom, fermer] of [
    ['« Fermer »', fermerParBouton],
    ['Échap', fermerParEchap],
  ] as const) {
    it(`détail d’une série fermé par ${nom} : le focus revient à la barre`, async () => {
      await rendre();
      await allerALaLigne(E11B.triple);
      const barre = barreDom(O11B.tripleA);
      expect(barre, 'barre de la série').not.toBeNull();
      await toucher(barre);
      expect(dialogue()?.getAttribute('aria-labelledby') ?? dialogue()?.getAttribute('aria-label')).toBeTruthy();
      await fermer();
      expect(document.activeElement, 'focus sur la barre').toBe(barreDom(O11B.tripleA));
    });

    it(`feuille des conflits fermée par ${nom} : le focus revient à l’étiquette`, async () => {
      await rendre();
      const el = await allerALaLigne(E11B.triple);
      await toucher(el.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]'));
      expect(dialogue()).not.toBeNull();
      await fermer();
      const etiquette = ligneDom(E11B.triple)?.querySelector('[data-testid="etiquette-conflit"]');
      expect(etiquette).not.toBeNull();
      expect(document.activeElement, 'focus sur l’étiquette de conflit').toBe(etiquette);
    });
  }

  it('la virtualisation a retiré puis remis la ligne pendant que la feuille était ouverte : focus sur la nouvelle barre', async () => {
    await rendre();
    await allerALaLigne(E11B.triple);
    const ancienne = barreDom(O11B.tripleA);
    await toucher(ancienne);
    // La feuille est ouverte : on fait défiler le plan sous elle, la ligne quitte le DOM, puis revient.
    await defilerA((plan.lignes.length - 1) * calculs.HAUTEUR_LIGNE_PX);
    expect(ligneDom(E11B.triple), 'ligne retirée du DOM par la virtualisation').toBeUndefined();
    await defilerA(Math.max(0, indexDe(E11B.triple) - 2) * calculs.HAUTEUR_LIGNE_PX);
    const nouvelle = barreDom(O11B.tripleA);
    expect(nouvelle, 'barre remise dans le DOM').not.toBeNull();
    expect(nouvelle, 'c’est une nouvelle barre, pas l’ancienne').not.toBe(ancienne);
    await fermerParBouton();
    expect(document.activeElement, 'focus sur la barre actuellement dans le DOM').toBe(nouvelle);
    expect(ancienne?.isConnected, 'l’ancienne barre n’est plus dans le DOM').toBe(false);
  });

  it('la barre a disparu pendant que le détail était ouvert (série supprimée) : focus sur la ligne', async () => {
    await rendre();
    await allerALaLigne(E11B.triple);
    await toucher(barreDom(O11B.tripleB));
    expect(dialogue()).not.toBeNull();
    // Synchro : l'occupation est supprimée ailleurs ; le plan se relit (au plus ~1 s) sous la feuille.
    await base.execute('UPDATE occupation SET supprime_le = ? WHERE id = ?', ['2026-09-30T10:00:00.000Z', O11B.tripleB]);
    for (let k = 0; k < 120 && barreDom(O11B.tripleB) !== null; k++) {
      await act(async () => {
        await attendre(25);
      });
    }
    expect(barreDom(O11B.tripleB), 'barre disparue après relecture').toBeNull();
    expect(dialogue(), 'la feuille est restée ouverte').not.toBeNull();
    await fermerParBouton();
    const ligne = ligneDom(E11B.triple);
    expect(ligne, 'la ligne est toujours dessinée').toBeDefined();
    expect(ligne?.getAttribute('tabindex'), 'ligne focalisable par programme').toBe('-1');
    expect(document.activeElement, 'focus sur la ligne').toBe(ligne);
  });
});
