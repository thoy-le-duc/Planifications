// @vitest-environment happy-dom
/**
 * Tests d'acceptation T15 — écran « Exporter toute ma ferme » au doigt (relecture de T15).
 * Contrat : en-tête de ./export.test.tsx. DOM simulé (happy-dom) : l'écran n'est pas encore
 * atteignable dans l'appli, donc pas d'e2e Playwright ; on rend le vrai composant et on tape.
 *
 *   - pendant l'export : bouton désactivé (un second tap ne relance rien) et (T15b) une barre
 *     d'avancement : `<progress>` ou role="progressbar" ;
 *   - à la fin : message qui contient « <N> événements exportés » (N = lignes de evenement.csv) ;
 *   - si la porte lève : message d'échec (role="alert"), bouton de nouveau actif, et l'erreur
 *     est journalisée par `console.error` (sinon un échec au champ ne laisse aucune trace) ;
 *   - (relecture T15b) pendant l'export, un bouton « Annuler » d'au moins 48 px ; au tap :
 *     « Export annulé », bouton d'export de nouveau actif, aucun téléchargement ni alerte, même
 *     si la base répond ensuite.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync';

interface ProprietesEcranExport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant?: () => Date;
  readonly telecharger?: (nomFichier: string, octets: Uint8Array) => void;
}

interface ModuleEcranExport {
  EcranExport(props: ProprietesEcranExport): ReactElement;
}

/** Chemin tenu dans une variable : le typage ne dépend pas du module. */
const CHEMIN_MODULE = './index.ts';

let m: ModuleEcranExport;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranExport;
});

const FERME = '0192f0c1-7a6e-7cc3-a000-000000000001';
const MAINTENANT = new Date('2026-09-29T06:30:00.000Z');
const C = '2026-01-15T08:00:00.000Z';

const LIGNES: Readonly<Record<string, readonly Readonly<Record<string, string | number | null>>[]>> = {
  ferme: [{ id: FERME, nom: 'Ferme de Benoît', fuseau_horaire: 'Europe/Paris', position: null, unites: '{}', cree_le: C, modifie_le: C, supprime_le: null }],
  evenement: [1, 2, 3].map((n) => ({
    id: `0192f0c1-7a6e-7cc3-a000-00000000010${String(n)}`,
    ferme_id: FERME,
    type: 'note',
    date: '2026-09-28',
    horodatage: C,
    note: `note ${String(n)}`,
    cree_le: C,
    modifie_le: C,
    supprime_le: null,
  })),
};

/** Porte dont la lecture attend `liberer()` (pour observer l'état « en cours ») ou lève. */
function porteControlee(mode: 'ok' | 'echec'): { porte: PorteDonnees; liberer: () => void; lectures: () => number } {
  let ouvrir: () => void = () => undefined;
  const barriere = new Promise<void>((r) => {
    ouvrir = r;
  });
  let n = 0;
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  const porte: PorteDonnees = {
    lire: async <T,>(sql: string) => {
      n++;
      await barriere;
      if (mode === 'echec') throw new Error('base locale illisible');
      const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
      return (LIGNES[table] ?? []) as T[];
    },
    ecrire: interdit('ecrire'),
    surveiller: interdit('surveiller'),
    saisirEvenement: interdit('saisirEvenement'),
    surveillerRefus: interdit('surveillerRefus'),
  };
  return { porte, liberer: ouvrir, lectures: () => n };
}

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
  vi.restoreAllMocks();
});

function bouton(): HTMLButtonElement {
  const b = [...conteneur.querySelectorAll('button')].find((x) => x.type === 'button' && !/annuler/i.test(x.textContent));
  if (b === undefined) throw new Error('bouton introuvable');
  return b;
}

/** Bouton « Annuler » (relecture T15b), ou undefined. */
function boutonAnnuler(): HTMLButtonElement | undefined {
  return [...conteneur.querySelectorAll('button')].find((x) => /annuler/i.test(x.textContent));
}

async function rendre(porte: PorteDonnees, telecharger: (nomFichier: string, octets: Uint8Array) => void): Promise<void> {
  await act(async () => {
    racine.render(<m.EcranExport porte={porte} fermeId={FERME} maintenant={() => MAINTENANT} telecharger={telecharger} />);
    await Promise.resolve();
  });
}

/** Laisse filer les promesses (lecture, construction de l'archive) et les rendus React. */
async function laisserFinir(): Promise<void> {
  for (let k = 0; k < 20; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Texte d'une erreur et de ses causes (l'écran peut l'envelopper avant de la journaliser). */
function chaineErreur(a: unknown): string {
  if (a instanceof Error) return `${a.message} ${chaineErreur(a.cause)}`;
  return typeof a === 'string' ? a : '';
}

describe('T15 : écran d’export au doigt', () => {
  it('bouton désactivé pendant l’export, puis « 3 événements exportés » et bouton réactivé', async () => {
    const { porte, liberer, lectures } = porteControlee('ok');
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    await rendre(porte, telecharger);
    expect(bouton().disabled).toBe(false);

    await act(async () => {
      bouton().click();
      await Promise.resolve();
    });
    expect(bouton().disabled, 'désactivé pendant l’export').toBe(true);
    expect(conteneur.querySelector('progress, [role="progressbar"]'), 'barre d’avancement pendant l’export (T15b)').not.toBeNull();
    const lecturesApresPremierTap = lectures();
    expect(lecturesApresPremierTap).toBeGreaterThan(0);
    await act(async () => {
      bouton().click();
      await Promise.resolve();
    });

    liberer();
    await laisserFinir();

    expect(telecharger, 'un seul téléchargement malgré le second tap').toHaveBeenCalledTimes(1);
    expect(telecharger.mock.calls[0]?.[0]).toBe('planifications-ferme-de-benoit-2026-09-29.zip');
    expect(conteneur.textContent).toMatch(/\b3 événements exportés/);
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
    expect(bouton().disabled, 'réactivé après l’export').toBe(false);
  });

  it('la porte lève : message d’échec, bouton réactivé, erreur journalisée (console.error)', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { porte, liberer } = porteControlee('echec');
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    await rendre(porte, telecharger);

    await act(async () => {
      bouton().click();
      await Promise.resolve();
    });
    expect(bouton().disabled).toBe(true);
    liberer();
    await laisserFinir();

    expect(telecharger).not.toHaveBeenCalled();
    const alerte = conteneur.querySelector('[role="alert"]');
    expect(alerte, 'message d’échec (role="alert")').not.toBeNull();
    expect(alerte?.textContent ?? '').toMatch(/export/i);
    expect(conteneur.textContent).not.toMatch(/événements exportés/);
    expect(bouton().disabled).toBe(false);
    expect(
      journal.mock.calls.flat().some((a) => chaineErreur(a).includes('base locale illisible')),
      'console.error reçoit l’erreur levée par la porte',
    ).toBe(true);
  });

  it('relecture T15b : « Annuler » (≥ 48 px) pendant l’export → « Export annulé », bouton d’export actif, aucun téléchargement', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { porte, liberer } = porteControlee('ok');
    const telecharger = vi.fn<(nomFichier: string, octets: Uint8Array) => void>();
    await rendre(porte, telecharger);
    expect(boutonAnnuler(), 'pas de bouton « Annuler » au repos').toBeUndefined();

    await act(async () => {
      bouton().click();
      await Promise.resolve();
    });
    expect(bouton().disabled).toBe(true);
    const annuler = boutonAnnuler();
    expect(annuler, 'bouton « Annuler » pendant l’export').toBeDefined();
    expect(annuler?.type).toBe('button');
    expect(annuler?.disabled).toBe(false);
    expect(Number.parseFloat(annuler?.style.minHeight ?? ''), 'min-height en ligne ≥ 48 px (gants)').toBeGreaterThanOrEqual(48);

    await act(async () => {
      annuler?.click();
      await Promise.resolve();
    });
    // La lecture de la base n'a toujours pas répondu : l'annulation n'attend pas.
    await laisserFinir();
    expect(conteneur.textContent).toMatch(/Export annulé/);
    expect(bouton().disabled, 'bouton d’export de nouveau actif').toBe(false);
    expect(conteneur.querySelector('[role="alert"]'), 'une annulation n’est pas un échec').toBeNull();

    // La base répond après coup : rien ne doit repartir.
    liberer();
    await laisserFinir();
    expect(telecharger).not.toHaveBeenCalled();
    expect(conteneur.textContent).toMatch(/Export annulé/);
    expect(conteneur.textContent).not.toMatch(/événements exportés/);
    expect(bouton().disabled).toBe(false);
    journal.mockRestore();
  });
});
