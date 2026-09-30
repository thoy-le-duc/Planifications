// @vitest-environment happy-dom
/**
 * Tests d'acceptation T16b — le bouton « Exporter toute ma ferme » de l'onglet Ferme lance
 * vraiment l'export (docs/backlog/T16b-brancher-export.md). DOM simulé (happy-dom), vrai
 * composant ; le parcours complet, hors ligne, avec la ferme de T07 : e2e/export.e2e.ts.
 *
 * ── Contrat de l'écran Ferme (ecrans/ferme/EcranFerme.tsx) ───────────────────────────────────
 *
 * Propriétés : celles d'aujourd'hui (session, baseLocale, surDeconnecte), plus
 *   readonly etatBase: EtatBase;   // src/donnees/etat-appli.ts : 'ouverture' | 'sans-ferme' | 'prete' | 'echec'
 * que App.tsx passe (donnees.base). La porte et la ferme active viennent de ContexteFerme
 * (src/donnees/contexte.ts), que la coquille fournit déjà autour de l'écran.
 *
 *   - Le texte provisoire de T16 disparaît : ni « Pas encore branché », ni « … pas encore
 *     relié … », même après un tap.
 *   - Dans la carte « Mes données » : UN SEUL bouton de nom accessible « Exporter toute ma
 *     ferme » (aria-label ou texte). Au moins 56 px de haut (vérifié dans le vrai navigateur
 *     par l'e2e).
 *   - etatBase 'prete' et ferme dans le contexte : bouton actif ; UN tap lance l'export
 *     (lecture de la base par la porte du contexte, puis téléchargement d'une archive). L'écran
 *     d'export (../export/index.ts) est chargé par import dynamique, jamais par un import
 *     statique (vérifié ici dans les sources, et dans l'empaquetage : ./empaquetage.test.ts).
 *   - Base pas prête ('ouverture', 'sans-ferme', 'echec', ou pas de ferme dans le contexte) :
 *     bouton désactivé (attribut disabled), et une explication en clair dans l'écran :
 *       'ouverture'  → le dit (texte qui contient « ouverture » ou « s’ouvre/s’ouvrent ») ;
 *       'sans-ferme' → texte qui contient « aucune ferme » ;
 *       'echec'      → texte qui contient « pas pu s’ouvrir » (ou « illisible », « échec »).
 *   - Déconnexion pendant un export : l'export est ANNULÉ AVANT que la base soit fermée
 *     (`baseLocale.fermer()`) et effacée ; aucun console.error, aucune alerte d'échec, aucun
 *     téléchargement, même si la base répond (ou lève « base fermée ») après coup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PorteDonnees } from '@planif/sync';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';

const ordre = vi.hoisted((): string[] => []);

vi.mock('../../donnees/effacer.ts', async (original) => {
  const reel = await original<typeof import('../../donnees/effacer.ts')>();
  return {
    ...reel,
    baseLocaleExiste: () => Promise.resolve(true),
    effacerDonneesLocales: async () => {
      ordre.push('effacer');
      // Quelques tours de boucle : un export encore vivant aurait le temps d'échouer.
      for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
    },
  };
});

interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  readonly baseLocale: PoigneeDonnees;
  readonly surDeconnecte: (erreur: string | null) => void;
  readonly etatBase: EtatBase;
}

interface ModuleEcranFerme {
  readonly default: (props: ProprietesEcranFerme) => ReactElement;
}

/** Chemin tenu dans une variable : le typage ne dépend pas des propriétés pas encore écrites. */
const CHEMIN_MODULE = './EcranFerme.tsx';
const SOURCE = readFileSync(join(import.meta.dirname, 'EcranFerme.tsx'), 'utf8');

let m: ModuleEcranFerme;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranFerme;
});

const EXPORTER = 'Exporter toute ma ferme';
const FERME = '0192f0c1-7a6e-7cc3-a000-000000000001';
const C = '2026-01-15T08:00:00.000Z';
const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

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

/**
 * Porte sur une base qu'on peut fermer : ses lectures attendent `liberer()` (pour observer
 * l'état « en cours ») ; chaque fin de lecture est notée dans `ordre` (« lecture-finie ») ; une
 * lecture qui finit sur une base fermée lève « base fermée ». `fermer()` marque la base fermée
 * et retient combien de lectures étaient encore en vol (relecture T16b : il en faut zéro) ; il
 * ne libère PAS les lectures bloquées.
 */
function porteControlee(): {
  porte: PorteDonnees;
  liberer: () => void;
  fermer: () => void;
  lectures: () => number;
  enVolALaFermeture: () => number | null;
} {
  let ouvrir: () => void = () => undefined;
  const barriere = new Promise<void>((r) => {
    ouvrir = r;
  });
  let n = 0;
  let enVol = 0;
  let enVolALaFermeture: number | null = null;
  let fermee = false;
  const interdit = (nom: string) => () => {
    throw new Error(`l'export ne doit pas appeler porte.${nom}`);
  };
  const porte: PorteDonnees = {
    lire: async <T,>(sql: string) => {
      n++;
      enVol++;
      try {
        await barriere;
        ordre.push('lecture-finie');
        if (fermee) throw new Error('base fermée');
        const table = /\bFROM\s+"?(\w+)"?/i.exec(sql)?.[1] ?? '';
        return (LIGNES[table] ?? []) as T[];
      } finally {
        enVol--;
      }
    },
    ecrire: interdit('ecrire'),
    surveiller: interdit('surveiller'),
    saisirEvenement: interdit('saisirEvenement'),
    surveillerRefus: interdit('surveillerRefus'),
    ecrireEnsemble: interdit('ecrireEnsemble'),
  };
  return {
    porte,
    liberer: ouvrir,
    fermer: () => {
      fermee = true;
      enVolALaFermeture = enVol;
    },
    lectures: () => n,
    enVolALaFermeture: () => enVolALaFermeture,
  };
}

let conteneur: HTMLDivElement;
let racine: Root;
let blobs: ReturnType<typeof vi.fn<(b: Blob) => string>>;
const createObjectURLReel = URL.createObjectURL.bind(URL);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ordre.length = 0;
  localStorage.clear();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  // Téléchargement par défaut (Blob + lien download) : on compte les Blob créés.
  blobs = vi.fn<(b: Blob) => string>(() => 'blob:planif-test');
  URL.createObjectURL = blobs;
  // API injoignable : la déconnexion se fait quand même (hors ligne, T09b).
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  URL.createObjectURL = createObjectURLReel;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function nomAccessible(b: HTMLButtonElement): string {
  return (b.getAttribute('aria-label') ?? b.textContent).trim();
}

function boutonsNommes(nom: string): HTMLButtonElement[] {
  return [...conteneur.querySelectorAll('button')].filter((b) => nomAccessible(b) === nom);
}

function boutonExporter(): HTMLButtonElement {
  const b = boutonsNommes(EXPORTER);
  expect(b, `un seul bouton « ${EXPORTER} »`).toHaveLength(1);
  const [premier] = b;
  if (premier === undefined) throw new Error('bouton introuvable');
  return premier;
}

function poignee(fermer: () => void): PoigneeDonnees {
  return {
    compterEnAttente: () => Promise.resolve(0),
    fermer: () => {
      ordre.push('fermer');
      fermer();
      return Promise.resolve();
    },
  };
}

async function rendre(o: { etatBase: EtatBase; porte: PorteDonnees | null; fermer?: () => void; surDeconnecte?: (e: string | null) => void }): Promise<void> {
  const proprietes: ProprietesEcranFerme = {
    session: SESSION,
    baseLocale: poignee(o.fermer ?? (() => undefined)),
    surDeconnecte: o.surDeconnecte ?? (() => undefined),
    etatBase: o.etatBase,
  };
  const valeur = o.porte === null ? null : { porte: o.porte, fermeId: FERME };
  await act(async () => {
    racine.render(createElement(ContexteFerme, { value: valeur }, createElement(m.default, proprietes)));
    await Promise.resolve();
  });
  await laisserFiler();
}

/** Laisse filer les promesses (import dynamique, lectures, archive) et les rendus React. */
async function laisserFiler(tours = 20): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Attend (import dynamique de l'écran d'export compris) qu'une condition soit vraie. */
async function attendre(condition: () => boolean, message: string): Promise<void> {
  // Premier import de l'écran d'export : vitest le transforme, cela peut prendre une seconde.
  const limite = Date.now() + 5_000;
  while (!condition() && Date.now() < limite) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  expect(condition(), message).toBe(true);
}

function sansTexteProvisoire(): void {
  expect(conteneur.textContent).not.toMatch(/pas encore reli/i);
  expect(conteneur.textContent).not.toContain('Pas encore branché');
}

describe('T16b : export branché dans l’onglet Ferme', () => {
  it('sources : l’écran Ferme charge l’écran d’export par import dynamique, jamais statique', () => {
    // Booléens : en cas d'échec, vitest n'affiche pas tout le fichier source.
    expect(/import\(\s*['"]\.\.\/export\/index\.ts['"]\s*\)/.test(SOURCE), 'import(\'../export/index.ts\') dans EcranFerme.tsx').toBe(true);
    // Seul un import de types (effacé à la compilation) est permis.
    expect(
      /^\s*import\s+(?!type\b)[^;]*?from\s+['"](?:\.\.\/export\/|@planif\/sync\/export)/m.test(SOURCE),
      'import statique de l’export dans EcranFerme.tsx',
    ).toBe(false);
    expect(/^\s*export\s+[^;]*?from\s+['"]\.\.\/export\//m.test(SOURCE), 'réexport de l’export dans EcranFerme.tsx').toBe(false);
  });

  it('base prête : texte provisoire disparu, un seul bouton actif, un tap lance l’export et télécharge l’archive', async () => {
    const journal = vi.spyOn(console, 'error');
    const { porte, liberer, lectures } = porteControlee();
    await rendre({ etatBase: 'prete', porte });
    sansTexteProvisoire();
    // L'écran d'export peut se charger (import dynamique) avant d'activer le bouton.
    await attendre(() => !boutonExporter().disabled, 'bouton actif, base prête');

    await act(async () => {
      boutonExporter().click();
      await Promise.resolve();
    });
    await attendre(() => lectures() > 0, 'un seul tap lit la base par la porte du contexte');
    sansTexteProvisoire();
    expect(conteneur.querySelector('progress, [role="progressbar"]'), 'barre d’avancement pendant l’export').not.toBeNull();

    liberer();
    await attendre(() => blobs.mock.calls.length > 0, 'archive téléchargée');
    expect(blobs).toHaveBeenCalledTimes(1);
    expect(blobs.mock.calls[0]?.[0].type).toBe('application/zip');
    expect(conteneur.textContent).toMatch(/\b3 événements exportés/);
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
    expect(journal).not.toHaveBeenCalled();
    sansTexteProvisoire();
  }, 20_000);

  const pasPrete: readonly (readonly [EtatBase, RegExp])[] = [
    ['ouverture', /ouverture|s[’']ouvr/i],
    ['sans-ferme', /aucune ferme/i],
    ['echec', /pas pu s[’']ouvrir|illisible|échec/i],
  ];

  for (const [etat, explication] of pasPrete) {
    it(`base « ${etat} » : bouton désactivé, avec une explication en clair`, async () => {
      await rendre({ etatBase: etat, porte: null });
      sansTexteProvisoire();
      const b = boutonExporter();
      expect(b.disabled, `bouton désactivé tant que la base est « ${etat} »`).toBe(true);
      expect(conteneur.textContent).toMatch(explication);
      await act(async () => {
        b.click();
        await Promise.resolve();
      });
      await laisserFiler();
      expect(blobs).not.toHaveBeenCalled();
      sansTexteProvisoire();
    });
  }

  /**
   * Relecture T16b, point 1 : l'annulation rejette tout de suite côté export (< 200 ms, test de
   * robustesse de @planif/sync), mais une lecture de page déjà partie dans la porte continue.
   * La base ne doit être fermée (puis effacée) qu'APRÈS la fin de cette lecture : sinon elle
   * lit une base en cours de fermeture, et son erreur « base fermée » est avalée.
   */
  it('déconnexion pendant l’export : export annulé, base fermée seulement après la fin de la lecture en cours, aucune erreur, rien de téléchargé', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rejets: unknown[] = [];
    const surRejet = (e: unknown) => rejets.push(e);
    process.on('unhandledRejection', surRejet);
    try {
      const { porte, fermer, liberer, lectures, enVolALaFermeture } = porteControlee();
      const surDeconnecte = vi.fn<(e: string | null) => void>();
      await rendre({ etatBase: 'prete', porte, fermer, surDeconnecte });
      await attendre(() => !boutonExporter().disabled, 'bouton actif, base prête');

      await act(async () => {
        boutonExporter().click();
        await Promise.resolve();
      });
      await attendre(() => lectures() > 0, 'export en cours, une lecture bloquée dans la porte');

      const deconnexion = boutonsNommes('Se déconnecter');
      expect(deconnexion, '« Se déconnecter » reste accessible pendant l’export').toHaveLength(1);
      await act(async () => {
        deconnexion[0]?.click();
        await Promise.resolve();
      });
      // Pas de saisie en attente, mais une base : la confirmation peut s'afficher.
      await laisserFiler();
      const quandMeme = boutonsNommes('Se déconnecter quand même')[0];
      if (quandMeme !== undefined) {
        await act(async () => {
          quandMeme.click();
          await Promise.resolve();
        });
      }
      // La lecture reste bloquée : la déconnexion doit l'attendre, sans fermer la base.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      expect(ordre, 'base pas encore fermée tant que la lecture en cours n’est pas finie').toEqual([]);

      liberer();
      await attendre(() => surDeconnecte.mock.calls.length > 0, 'retour à l’écran de connexion');
      await laisserFiler();

      expect(ordre, 'lecture finie, puis base fermée, puis effacée').toEqual(['lecture-finie', 'fermer', 'effacer']);
      expect(enVolALaFermeture(), 'aucune lecture en vol à la fermeture de la base').toBe(0);
      expect(surDeconnecte).toHaveBeenCalledWith(null);
      expect(
        journal.mock.calls.map((a) => a.map(String).join(' ')),
        'aucun console.error : l’export a été annulé avant la fermeture de la base',
      ).toEqual([]);
      expect(rejets, 'aucun rejet non géré').toEqual([]);
      expect(blobs, 'aucun téléchargement').not.toHaveBeenCalled();
      expect(conteneur.querySelector('[role="alert"]')).toBeNull();
    } finally {
      process.off('unhandledRejection', surRejet);
    }
  }, 20_000);

  it('relecture, point 2 : « Exporter toute ma ferme » désactivé dès que la déconnexion est décidée (révocation hors ligne en cours)', async () => {
    let repondre: (r: Response) => void = () => undefined;
    const reponse = new Promise<Response>((r) => {
      repondre = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reponse),
    );
    const { porte, lectures } = porteControlee();
    const surDeconnecte = vi.fn<(e: string | null) => void>();
    await rendre({ etatBase: 'prete', porte, surDeconnecte });
    await attendre(() => !boutonExporter().disabled, 'bouton actif, base prête');

    await act(async () => {
      boutonsNommes('Se déconnecter')[0]?.click();
      await Promise.resolve();
    });
    await laisserFiler();
    const quandMeme = boutonsNommes('Se déconnecter quand même')[0];
    if (quandMeme !== undefined) {
      await act(async () => {
        quandMeme.click();
        await Promise.resolve();
      });
      await laisserFiler();
    }
    expect(surDeconnecte, 'l’API n’a pas encore répondu').not.toHaveBeenCalled();
    expect(boutonExporter().disabled, 'désactivé pendant la révocation').toBe(true);
    await act(async () => {
      boutonExporter().click();
      await Promise.resolve();
    });
    await laisserFiler();
    expect(lectures(), 'un tap pendant la déconnexion ne lance aucun export').toBe(0);

    repondre(new Response(null, { status: 204 }));
    await attendre(() => surDeconnecte.mock.calls.length > 0, 'déconnexion terminée');
    expect(blobs).not.toHaveBeenCalled();
  }, 20_000);

  /** La carte « Mes données » et son unique zone d'annonce (role="status"). */
  function zoneAnnonce(): Element {
    const carte = conteneur.querySelector('section[aria-label="Mes données"]');
    expect(carte, 'carte « Mes données »').not.toBeNull();
    const zones = carte?.querySelectorAll('[role="status"]') ?? [];
    expect(zones, 'une seule zone role="status" dans la carte « Mes données »').toHaveLength(1);
    const [zone] = zones;
    if (zone === undefined) throw new Error('zone d’annonce introuvable');
    return zone;
  }

  it('relecture, point 3 : une zone role="status" toujours présente, le même nœud, dont seul le texte change', async () => {
    const { porte, liberer, lectures } = porteControlee();
    await rendre({ etatBase: 'prete', porte });
    await attendre(() => !boutonExporter().disabled, 'bouton actif, base prête');
    const zone = zoneAnnonce();

    await act(async () => {
      boutonExporter().click();
      await Promise.resolve();
    });
    await attendre(() => lectures() > 0, 'export en cours');
    expect(zoneAnnonce(), 'même nœud au lancement').toBe(zone);
    expect(zone.textContent).toContain('Export en cours…');

    const annuler = boutonsNommes('Annuler')[0];
    expect(annuler, 'bouton « Annuler »').toBeDefined();
    await act(async () => {
      annuler?.click();
      await Promise.resolve();
    });
    await laisserFiler();
    expect(zoneAnnonce(), 'même nœud à l’annulation').toBe(zone);
    expect(zone.textContent).toContain('Export annulé.');

    liberer();
    await attendre(() => !boutonExporter().disabled, 'bouton de nouveau actif');
    await act(async () => {
      boutonExporter().click();
      await Promise.resolve();
    });
    await attendre(() => blobs.mock.calls.length > 0, 'archive téléchargée');
    await laisserFiler();
    expect(zoneAnnonce(), 'même nœud à la fin').toBe(zone);
    expect(zone.textContent).toMatch(/Archive .+ prête/);
  }, 20_000);

  it('relecture, point 4 : au lancement, le focus clavier passe sur « Annuler » ; le bouton tapé est désactivé', async () => {
    const { porte, lectures } = porteControlee();
    await rendre({ etatBase: 'prete', porte });
    await attendre(() => !boutonExporter().disabled, 'bouton actif, base prête');
    boutonExporter().focus();
    expect(document.activeElement).toBe(boutonExporter());

    await act(async () => {
      boutonExporter().click();
      await Promise.resolve();
    });
    await attendre(() => lectures() > 0, 'export en cours');
    await laisserFiler();
    expect(boutonExporter().disabled, 'bouton tapé désactivé').toBe(true);
    const annuler = boutonsNommes('Annuler')[0];
    expect(annuler, 'bouton « Annuler »').toBeDefined();
    expect(document.activeElement, 'focus sur « Annuler »').toBe(annuler);
  }, 20_000);
});
