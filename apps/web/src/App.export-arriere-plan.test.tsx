// @vitest-environment happy-dom
/**
 * Tests d'acceptation T15e — l'export de toute la ferme continue en arrière-plan quand on change
 * d'onglet (Q28, docs/backlog/T15e-export-arriere-plan.md).
 *
 * Banc : l'appli entière (App), connectée, dans un DOM simulé, comme App.lancement.test.tsx.
 * Doubles : ./donnees/appli.ts (la base « s'ouvre » tout de suite sur la ferme du jour, base
 * mémoire), ./ecrans/plan/index.ts et ./ecrans/aujourdhui/index.ts (simples titres : les autres
 * écrans ne lisent pas la porte). L'écran Ferme et l'export (lancerExport, archive ZIP,
 * téléchargement par Blob + lien `download`) sont les vrais. Les lectures de l'export passent par
 * une porte dont chaque lecture attend un « permis » (laisserPasser / tout liberer) : l'export
 * reste en cours aussi longtemps que le test le veut.
 *
 * ── Contrat du bandeau (à implémenter) ──────────────────────────────────────────────────────
 *   - Pendant un export lancé depuis l'onglet Ferme, sur CHAQUE AUTRE onglet (Aujourd'hui,
 *     Planches, Dicter) : un élément `data-testid="export-bandeau"`, `role="status"`, dont le
 *     texte contient « Export en cours » ;
 *   - dedans, l'avancement : `<progress>` (ou role="progressbar") ; valeur qui monte avec l'export ;
 *   - dedans, un bouton « Annuler » (type button) ;
 *   - le bandeau n'existe PAS sur l'onglet Ferme (l'écran Ferme montre déjà sa barre et son
 *     « Annuler » : pas de doublon), ni au repos, ni une fois l'export fini ou annulé ;
 *   - l'export continue quand on quitte l'onglet Ferme : plus d'annulation au démontage de
 *     l'écran Ferme ; le téléchargement arrive quand l'archive est prête, quel que soit l'onglet ;
 *   - un seul export à la fois : tant qu'il dure, aucun second lancement (aucune lecture de plus,
 *     un seul téléchargement) ; au retour sur Ferme, la barre reprend l'avancement en cours
 *     (`<progress>` nommé « Avancement de l’export »), « Annuler » est là et le bouton
 *     « Exporter toute ma ferme » est désactivé ;
 *   - « Annuler » (bandeau ou Ferme) : l'export s'arrête, aucun téléchargement même si la base
 *     répond ensuite, le bandeau disparaît, un message « Export annulé » (role="status") est dit,
 *     aucune alerte ; un nouvel export est ensuite possible.
 * Hors de ce fichier : la déconnexion pendant un export en arrière-plan (T09b/T16b) reste
 * couverte par ferme.test.tsx et e2e/export.e2e.ts, dont les tests ne changent pas.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { CLE_SESSION } from './connexion/session.ts';
import type { EtatDonnees, PoigneeDonnees } from './donnees/etat-appli.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './ecrans/aujourdhui/test/ferme-du-jour.ts';

interface Banc {
  porte: PorteDonnees | null;
}
const banc = vi.hoisted((): Banc => ({ porte: null }));

vi.mock('./donnees/appli.ts', () => ({
  ouvrirDonneesAppli(_utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
    const porte = banc.porte;
    if (porte === null) throw new Error('banc : porte absente');
    setTimeout(() => {
      surEtat({ base: 'prete', ferme: { porte, fermeId: FERME }, synchro: 'hors-ligne', enAttente: 0 });
    }, 0);
    return { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };
  },
}));

vi.mock('./ecrans/plan/index.ts', () => {
  function EcranPlanDouble() {
    return <h2 data-testid="planches-double">Plan des planches (double)</h2>;
  }
  return {
    default: EcranPlanDouble,
    EcranPlan: EcranPlanDouble,
    MARQUE_PLAN_AFFICHE: 'planif:plan-affiche',
    jourDuTelephone: () => '2026-09-30',
    prechargerPlan: () => Promise.resolve(),
  };
});

vi.mock('./ecrans/aujourdhui/index.ts', () => {
  function EcranAujourdhuiDouble() {
    return <h2 data-testid="aujourdhui-double">Aujourd’hui (double)</h2>;
  }
  return {
    default: EcranAujourdhuiDouble,
    EcranAujourdhui: EcranAujourdhuiDouble,
    MARQUE_AUJOURDHUI_AFFICHE: 'planif:aujourdhui-affiche',
    jourDuTelephone: () => '2026-09-30',
    prechargerJournee: () => Promise.resolve(),
  };
});

const { App } = await import('./App.tsx');

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

let base: BaseMemoire;
let conteneur: HTMLDivElement;
let racine: Root;
/** Lectures de l'export en cours d'attente ou faites, et permis restants (Infinity : tout passe). */
const lectures = { appels: 0, permis: 0 };
let clics: HTMLAnchorElement[];
let blobs: Blob[];
const createObjectURLReel = URL.createObjectURL.bind(URL);
const revokeReel = URL.revokeObjectURL.bind(URL);

/** La vraie porte de la base mémoire, dont chaque lecture attend un permis. */
function porteControlee(reelle: PorteDonnees): PorteDonnees {
  return {
    ...reelle,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]) => {
      lectures.appels++;
      while (lectures.permis <= 0) await new Promise((r) => setTimeout(r, 1));
      if (Number.isFinite(lectures.permis)) lectures.permis--;
      return reelle.lire<T>(sql, parametres);
    },
  };
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, jourLocal(new Date()));
  banc.porte = porteControlee(creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> }));
  lectures.appels = 0;
  lectures.permis = 0;
  clics = [];
  blobs = [];
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:planif-test';
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download')) clics.push(this);
  });
  localStorage.setItem(
    CLE_SESSION,
    JSON.stringify({ utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
});

afterEach(() => {
  // Libère les lectures encore bloquées : plus rien ne tourne après le test.
  lectures.permis = Number.POSITIVE_INFINITY;
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  localStorage.clear();
  base.fermer();
  banc.porte = null;
  URL.createObjectURL = createObjectURLReel;
  URL.revokeObjectURL = revokeReel;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Attend `condition` en temps réel (voir App.lancement.test.tsx). */
async function attendre(condition: () => boolean, message: string, delaiMs = 3_000): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await unTour();
  expect(condition(), message).toBe(true);
}

/** Laisse passer `ms` en temps réel (un téléchargement ou un bandeau qui reviendrait à tort). */
async function laisserPasser(ms = 150): Promise<void> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) await unTour();
}

function onglet(libelle: string): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll<HTMLButtonElement>('nav button')].find((x) => x.textContent.includes(libelle));
  if (b === undefined) throw new Error(`onglet « ${libelle} » absent`);
  return b;
}

async function aller(libelle: string): Promise<void> {
  await act(async () => {
    onglet(libelle).click();
    await Promise.resolve();
  });
  await unTour();
}

const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="export-bandeau"]');
const boutonExporter = (): HTMLButtonElement | undefined =>
  [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => /exporter toute ma ferme|export en cours/i.test(b.textContent));
const boutonAnnuler = (dans: ParentNode = conteneur): HTMLButtonElement | undefined =>
  [...dans.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^annuler$/i.test(b.textContent.trim()));
const progression = (dans: ParentNode = conteneur): HTMLProgressElement | null => dans.querySelector('progress');
const statuts = (): string[] => [...conteneur.querySelectorAll('[role="status"]')].map((e) => e.textContent);

async function lancerApp(): Promise<void> {
  await act(async () => {
    racine.render(<App />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="app"]')?.getAttribute('data-base') === 'prete', 'base « prête »');
  await attendre(() => conteneur.querySelector('[data-testid="aujourdhui-double"]') !== null, 'écran Aujourd’hui affiché');
}

/** Onglet Ferme, tap sur « Exporter toute ma ferme » ; l'export attend ses permis. */
async function lancerExportDepuisFerme(): Promise<void> {
  await aller('Ferme');
  await attendre(() => boutonExporter() !== undefined && !boutonExporter()?.disabled, 'bouton d’export actif');
  await act(async () => {
    boutonExporter()?.click();
    await Promise.resolve();
  });
  await attendre(() => lectures.appels > 0, 'l’export a commencé à lire la base');
}

describe('T15e : l’export continue quand on change d’onglet', () => {
  it('témoin : sans export, aucun bandeau sur aucun onglet', async () => {
    await lancerApp();
    for (const o of ['Aujourd’hui', 'Planches', 'Dicter', 'Ferme']) {
      await aller(o);
      expect(bandeau(), `pas de bandeau sur ${o} au repos`).toBeNull();
    }
  });

  it('témoin du banc : export mené à bout sans changer d’onglet (barre qui avance, un téléchargement)', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    const valeur = (): number => {
      const p = progression();
      return p?.hasAttribute('value') === true ? p.value / (p.max || 1) : 0;
    };
    lectures.permis = 8;
    await attendre(() => valeur() > 0, 'la barre de Ferme a avancé après 8 lectures');
    expect(clics).toHaveLength(0);
    lectures.permis = Number.POSITIVE_INFINITY;
    await attendre(() => clics.length === 1, 'archive téléchargée');
  });

  it('Aujourd’hui puis Planches : le bandeau « Export en cours » (status, avancement, Annuler) est visible, l’export continue, pas de téléchargement', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    expect(bandeau(), 'pas de bandeau sur Ferme (elle a sa propre barre)').toBeNull();
    const lecturesAvant = lectures.appels;

    for (const [o, repere] of [
      ['Aujourd’hui', 'aujourdhui-double'],
      ['Planches', 'planches-double'],
    ] as const) {
      await aller(o);
      await attendre(() => conteneur.querySelector(`[data-testid="${repere}"]`) !== null, `écran ${o} affiché`);
      const b = bandeau();
      expect(b, `bandeau « Export en cours » sur ${o}`).not.toBeNull();
      expect(b?.getAttribute('role')).toBe('status');
      expect(b?.textContent).toMatch(/Export en cours/);
      expect(b === null ? null : progression(b) ?? b.querySelector('[role="progressbar"]'), `avancement dans le bandeau sur ${o}`).not.toBeNull();
      const annuler = b === null ? undefined : boutonAnnuler(b);
      expect(annuler, `« Annuler » dans le bandeau sur ${o}`).toBeDefined();
      expect(annuler?.type).toBe('button');
    }
    await laisserPasser();
    expect(clics, 'pas de téléchargement tant que l’archive n’est pas prête').toHaveLength(0);
    expect(lectures.appels, 'aucun second lancement en changeant d’onglet').toBeLessThanOrEqual(lecturesAvant + 1);
  });

  it('l’export n’est pas annulé en quittant Ferme : l’archive se télécharge, une fois, depuis un autre onglet, et le bandeau disparaît', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    await aller('Aujourd’hui');
    expect(bandeau()).not.toBeNull();

    lectures.permis = Number.POSITIVE_INFINITY;
    await attendre(() => clics.length > 0, 'archive téléchargée en arrière-plan');
    await attendre(() => bandeau() === null, 'bandeau disparu à la fin');
    await laisserPasser();
    expect(clics, 'un seul téléchargement').toHaveLength(1);
    expect(clics[0]?.getAttribute('download')).toMatch(/^planifications-.+\.zip$/);
    expect(blobs[0]?.size ?? 0, 'archive non vide').toBeGreaterThan(0);
    expect(statuts().join(' | '), 'pas de « Export annulé » pour un export mené à bout').not.toMatch(/Export annulé/);
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
  });

  it('l’avancement du bandeau monte avec l’export', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    await aller('Planches');
    const valeur = (): number => {
      const b = bandeau();
      const p = b === null ? null : progression(b);
      return p?.hasAttribute('value') === true ? p.value / (p.max || 1) : 0;
    };
    expect(valeur(), 'avancement nul au départ').toBe(0);
    // Quelques tables lues et écrites seulement : l'export n'est pas fini.
    lectures.permis = 8;
    await attendre(() => valeur() > 0, 'la barre du bandeau a avancé');
    expect(valeur()).toBeLessThan(1);
    expect(clics).toHaveLength(0);
  });
});

describe('T15e : annuler, un seul export, retour sur Ferme', () => {
  it('« Annuler » dans le bandeau : export arrêté, bandeau retiré, « Export annulé », aucun téléchargement même si la base répond ensuite', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    await aller('Planches');
    const annuler = bandeau() === null ? undefined : boutonAnnuler(bandeau() ?? conteneur);
    expect(annuler, '« Annuler » dans le bandeau').toBeDefined();
    await act(async () => {
      annuler?.click();
      await Promise.resolve();
    });
    await attendre(() => bandeau() === null || !(bandeau()?.textContent ?? '').includes('Export en cours'), 'bandeau « en cours » retiré');
    await attendre(() => statuts().some((t) => t.includes('Export annulé')), 'message « Export annulé » (role="status")');
    expect(conteneur.querySelector('[role="alert"]'), 'une annulation n’est pas un échec').toBeNull();

    lectures.permis = Number.POSITIVE_INFINITY;
    await laisserPasser(300);
    expect(clics, 'aucun téléchargement après « Annuler »').toHaveLength(0);
    expect(blobs).toHaveLength(0);
    expect(bandeau()?.textContent ?? '', 'le bandeau « en cours » ne revient pas').not.toMatch(/Export en cours/);

    // Un nouvel export est possible ensuite.
    await aller('Ferme');
    await attendre(() => boutonExporter() !== undefined && !boutonExporter()?.disabled, 'bouton d’export de nouveau actif');
    await act(async () => {
      boutonExporter()?.click();
      await Promise.resolve();
    });
    await attendre(() => clics.length === 1, 'le nouvel export va au bout et télécharge');
  });

  it('un seul export à la fois : retour sur Ferme, barre reprise, bouton désactivé, aucun second lancement', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    await aller('Aujourd’hui');
    const lecturesAvant = lectures.appels;
    await aller('Ferme');

    const bouton = boutonExporter();
    expect(bouton?.disabled, 'bouton d’export désactivé pendant l’export en arrière-plan').toBe(true);
    const barre = [...conteneur.querySelectorAll('progress, [role="progressbar"]')].find((e) => (e.getAttribute('aria-label') ?? '') === 'Avancement de l’export');
    expect(barre, 'barre « Avancement de l’export » reprise sur Ferme').toBeDefined();
    expect(boutonAnnuler(), '« Annuler » sur Ferme').toBeDefined();
    expect(statuts().join(' | ')).toMatch(/Export en cours/);
    expect(bandeau(), 'pas de bandeau sur Ferme').toBeNull();

    // Taper quand même (bouton désactivé, ou tap refusé) : aucun second export.
    await act(async () => {
      bouton?.click();
      await Promise.resolve();
    });
    await laisserPasser(50);
    expect(lectures.appels, 'aucune lecture de plus : pas de second export').toBe(lecturesAvant);

    lectures.permis = Number.POSITIVE_INFINITY;
    await attendre(() => clics.length > 0, 'archive téléchargée');
    await laisserPasser();
    expect(clics, 'un seul téléchargement').toHaveLength(1);
  });

  it('« Annuler » sur Ferme après un détour par un autre onglet : « Export annulé », rien téléchargé', async () => {
    await lancerApp();
    await lancerExportDepuisFerme();
    await aller('Planches');
    await aller('Ferme');
    await act(async () => {
      boutonAnnuler()?.click();
      await Promise.resolve();
    });
    await attendre(() => statuts().some((t) => t.includes('Export annulé')), 'message « Export annulé »');
    await attendre(() => boutonExporter() !== undefined && !boutonExporter()?.disabled, 'bouton d’export de nouveau actif');
    lectures.permis = Number.POSITIVE_INFINITY;
    await laisserPasser(300);
    expect(clics, 'aucun téléchargement après « Annuler »').toHaveLength(0);
    await aller('Aujourd’hui');
    expect(bandeau(), 'plus de bandeau ailleurs').toBeNull();
  });
});
