// @vitest-environment happy-dom
/**
 * Tests d'acceptation T28h — l'éditeur de placement : recherche d'adresse (Géoplateforme, fetch
 * simulé, minuteries factices), hors ligne, zoom minimal 6, départ à 6 sans origine, « Aller à »
 * et « Toute la ferme » (deux sites à 20 km), `ferme.origine_plan` jamais modifiée par la recherche.
 * Contrat du DOM et des modules : ./test/contrat-adresse.ts (et ./test/contrat.ts). Parcours dans un
 * vrai navigateur : e2e/placement-adresse.e2e.ts. Aucune requête réelle : fetch est une fausse.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, champ, desactive, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { versGeographique } from './coeur.ts';
import type { ModuleEditeur, ProprietesEditeurPlacement } from './test/contrat.ts';
import { MESSAGES_ADRESSE, MOISSAC, MOTIF_INDISPONIBLE, NOM_CHAMP_ADRESSE, NUMERO_MOISSAC, reponseGeocodage, RUE_MOISSAC, TESTID_ADRESSE as A, type ModuleAdresse, type ModuleTuilesT28h } from './test/contrat-adresse.ts';
import { ecrireFermePlacement, FERME, POSITION, UTILISATEUR, ZONE_CHAMP, ZONE_ENFANT, ZONE_SITE2, ZONE_TUNNEL, type OptionsFermePlacement } from './test/ferme-placement.ts';
import { TESTID_PLACEMENT as T } from './test/contrat.ts';

const CHEMIN = './index.ts';
const CHEMIN_ADRESSE = './adresse.ts';
const CHEMIN_TUILES = './tuiles.ts';
const MAINTENANT = new Date('2026-10-09T08:00:00.000Z');
/** Tolérance sur la latitude / longitude affichée : 1e-4° ≈ 11 m. */
const TOLERANCE_DEG = 1e-4;

let m: ModuleEditeur;
let adresse: ModuleAdresse;
let tuiles: ModuleTuilesT28h;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
  adresse = (await import(/* @vite-ignore */ CHEMIN_ADRESSE)) as ModuleAdresse;
  tuiles = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuilesT28h;
});

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

interface Banc {
  readonly base: BaseMemoire;
  readonly placements: (readonly ChangementPlacement[])[];
  readonly autresEcritures: string[];
}

let conteneur: HTMLDivElement;
let racine: Root;
let bancCourant: Banc | null = null;
let fetchSimule: Mock<(url: unknown, init?: RequestInit) => Promise<Response>>;
let erreursConsole: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fetchSimule = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(() => Promise.reject(new Error('fetch non prévu par ce test')));
  vi.stubGlobal('fetch', fetchSimule);
  erreursConsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  erreursConsole.mockRestore();
  bancCourant?.base.fermer();
  bancCourant = null;
});

async function ouvrir(options: OptionsFermePlacement & Partial<Pick<ProprietesEditeurPlacement, 'ordinateur' | 'enLigne'>> = {}): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, options);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const autresEcritures: string[] = [];
  const interdit =
    (nom: string) =>
    (): Promise<never> => {
      autresEcritures.push(nom);
      return Promise.reject(new Error(`la recherche ne doit pas appeler porte.${nom}`));
    };
  const porte: PorteDonnees = {
    ...reelle,
    ecrire: interdit('ecrire'),
    ecrireEnsemble: interdit('ecrireEnsemble'),
    saisirEvenement: interdit('saisirEvenement'),
    archiverRefus: interdit('archiverRefus'),
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  const b: Banc = { base, placements, autresEcritures };
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = {
    porte,
    fermeId: FERME,
    utilisateurId: UTILISATEUR,
    surFermer: () => undefined,
    ordinateur: options.ordinateur ?? true,
    enLigne: options.enLigne ?? true,
  };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => editeur() !== null && (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  if (options.origine === true) await attendre(() => document.querySelector(`[data-testid="${T.batiment}"]`) !== null, 'bâtiments affichés');
  return b;
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const attr = (nom: string): string => editeur()?.getAttribute(nom) ?? '';
const zoomAffiche = (): number => Number(attr('data-zoom'));
const origineEnBase = (b: Banc): unknown => b.base.lireDirect<{ o: string | null }>('SELECT origine_plan AS o FROM ferme WHERE id = ?', [FERME])[0]?.o ?? null;
const champAdresse = (): HTMLInputElement => {
  const c = champ(NOM_CHAMP_ADRESSE);
  expect(c.getAttribute('data-testid')).toBe(A.champ);
  return c;
};
const boutonZoom = (nom: 'Zoom avant' | 'Zoom arrière'): HTMLElement => {
  const b = document.querySelector<HTMLElement>(`button[aria-label="${nom}"]`);
  if (b === null) throw new Error(`bouton ${nom} absent`);
  return b;
};

/** Centre de la vue : { latitude, longitude } lus dans data-centre. */
function centre(): { latitude: number; longitude: number } {
  const [latitude = Number.NaN, longitude = Number.NaN] = attr('data-centre').split(',').map(Number);
  return { latitude, longitude };
}
function attendreCentre(attendu: { latitude: number; longitude: number }, message: string): void {
  const c = centre();
  expect(Math.abs(c.latitude - attendu.latitude), `${message} : latitude ${String(c.latitude)} ≠ ${String(attendu.latitude)}`).toBeLessThan(TOLERANCE_DEG);
  expect(Math.abs(c.longitude - attendu.longitude), `${message} : longitude ${String(c.longitude)} ≠ ${String(attendu.longitude)}`).toBeLessThan(TOLERANCE_DEG);
}

/** Réponse HTTP simulée du service de géocodage. */
const reponse = (corps: unknown, statut = 200): Response => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
const propositions = (): HTMLElement[] => tous(A.proposition);
const message = (): HTMLElement | null => un(A.message);

/** Passe aux minuteries factices (après l'ouverture, qui attend en vrai) : setTimeout seulement. */
function minuteriesFactices(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}
const avancer = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

async function taper(texteSaisi: string): Promise<void> {
  await remplir(champAdresse(), texteSaisi);
}

/** Frappe lettre à lettre (50 ms entre deux), puis attend le délai de saisie : une seule requête doit partir. */
async function frapper(mot: string): Promise<void> {
  for (let i = 1; i <= mot.length; i++) {
    await taper(mot.slice(0, i));
    await avancer(50);
  }
  await avancer(adresse.DELAI_SAISIE_MS);
}

// ── Recherche d'adresse ──────────────────────────────────────────────────────────────────────

describe('T28h : recherche d’adresse', () => {
  it('le champ « Adresse, commune ou lieu-dit » est en haut de l’éditeur, en gros caractères, même en lecture seule (téléphone)', async () => {
    await ouvrir({ origine: true, ordinateur: false });
    const c = champAdresse();
    expect(c.closest(`[data-testid="${T.editeur}"]`)).not.toBeNull();
    expect(c.type === 'search' || c.type === 'text').toBe(true);
    expect(desactive(c)).toBe(false);
    const police = Number.parseFloat(getComputedStyle(c).fontSize);
    // happy-dom ne charge pas placement.css : si la taille n'est pas calculée, le e2e la vérifie.
    if (Number.isFinite(police)) expect(police).toBeGreaterThanOrEqual(16);
  });

  it('saisie « Moissac » lettre à lettre : UNE seule requête, 300 ms après la dernière frappe, URL de la Géoplateforme', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC, RUE_MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    for (const [i, mot] of ['M', 'Mo', 'Moi', 'Mois', 'Moiss', 'Moissa', 'Moissac'].entries()) {
      await taper(mot);
      expect(fetchSimule, `après la frappe ${String(i + 1)}`).not.toHaveBeenCalled();
      await avancer(100);
    }
    expect(fetchSimule, '100 ms après la dernière frappe').not.toHaveBeenCalled();
    await avancer(adresse.DELAI_SAISIE_MS - 100 - 1);
    expect(fetchSimule, '299 ms après la dernière frappe').not.toHaveBeenCalled();
    await avancer(1);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    const premier = fetchSimule.mock.calls[0] as unknown[];
    expect(String(premier[0])).toBe(adresse.urlRechercheAdresse('Moissac'));
    expect(String(premier[0])).toBe('https://data.geopf.fr/geocodage/search?q=Moissac&limit=5');
    await attendre(() => propositions().length === 2, 'deux propositions affichées');
    expect(propositions().map((p) => texte(p))).toEqual([expect.stringContaining('Moissac'), expect.stringContaining('République')]);
    expect(un(A.propositions)).not.toBeNull();
    await avancer(5_000);
    expect(fetchSimule, 'pas de requête de plus').toHaveBeenCalledTimes(1);
  });

  it('au plus 5 propositions affichées', async () => {
    const sept = Array.from({ length: 7 }, (_, i) => ({ label: `Lieu ${String(i)}`, type: 'street', longitude: 1 + i / 100, latitude: 44 }));
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage(sept))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Lieu');
    await attendre(() => propositions().length > 0, 'propositions');
    expect(propositions()).toHaveLength(5);
  });

  it('une nouvelle frappe abandonne la requête précédente (AbortSignal) ; son abandon n’affiche aucun message', async () => {
    const signaux: AbortSignal[] = [];
    fetchSimule.mockImplementation((_url, init) => {
      const signal = init?.signal;
      if (signal) signaux.push(signal);
      return new Promise<Response>((resolve, reject) => {
        if (signaux.length === 1) {
          // La première ne répond jamais, sauf par son abandon.
          signal?.addEventListener('abort', () => {
            reject(new DOMException('abandonnée', 'AbortError'));
          });
        } else resolve(reponse(reponseGeocodage([MOISSAC])));
      });
    });
    await ouvrir({ origine: true });
    minuteriesFactices();
    await taper('Moi');
    await avancer(adresse.DELAI_SAISIE_MS);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    expect(signaux[0]?.aborted).toBe(false);
    await taper('Moissac');
    expect(signaux[0]?.aborted, 'la frappe abandonne la requête en cours').toBe(true);
    await avancer(adresse.DELAI_SAISIE_MS);
    expect(fetchSimule).toHaveBeenCalledTimes(2);
    expect(String((fetchSimule.mock.calls[1] as unknown[])[0])).toContain('q=Moissac');
    await attendre(() => propositions().length === 1, 'la seconde réponse s’affiche');
    expect(message(), 'l’abandon de la première n’est pas une erreur').toBeNull();
    expect(erreursConsole).not.toHaveBeenCalled();
  });

  it('une réponse arrivée après une frappe plus récente est ignorée (pas de proposition périmée)', async () => {
    const attentes: ((r: Response) => void)[] = [];
    fetchSimule.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          attentes.push(resolve);
        }),
    );
    await ouvrir({ origine: true });
    minuteriesFactices();
    await taper('Moi');
    await avancer(adresse.DELAI_SAISIE_MS);
    await taper('Moissac');
    await avancer(adresse.DELAI_SAISIE_MS);
    expect(attentes).toHaveLength(2);
    attentes[1]?.(reponse(reponseGeocodage([MOISSAC])));
    await attendre(() => propositions().length === 1, 'réponse récente affichée');
    attentes[0]?.(reponse(reponseGeocodage([RUE_MOISSAC, NUMERO_MOISSAC])));
    await unTour();
    expect(propositions().map((p) => p.getAttribute('data-type'))).toEqual(['municipality']);
  });

  it('champ vidé : plus de proposition, plus de message, aucune requête', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 1, 'proposition');
    await taper('');
    await avancer(adresse.DELAI_SAISIE_MS * 2);
    expect(propositions()).toHaveLength(0);
    expect(message()).toBeNull();
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });

  it('un tap sur une commune centre la carte sur les coordonnées rendues, zoom de commune', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC, RUE_MOISSAC, NUMERO_MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 3, 'trois propositions');
    const [commune] = propositions();
    expect(commune?.getAttribute('data-type')).toBe('municipality');
    expect(Number(commune?.getAttribute('data-latitude'))).toBeCloseTo(MOISSAC.latitude, 6);
    expect(Number(commune?.getAttribute('data-longitude'))).toBeCloseTo(MOISSAC.longitude, 6);
    if (commune) await toucher(commune);
    attendreCentre(MOISSAC, 'commune');
    expect(zoomAffiche()).toBe(adresse.zoomPourType('municipality'));
    expect(zoomAffiche()).toBeLessThanOrEqual(13);
    expect(propositions(), 'la liste se ferme après le tap').toHaveLength(0);
  });

  it('un tap sur un numéro de rue : vue serrée sur la parcelle (zoom ≥ 18)', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC, RUE_MOISSAC, NUMERO_MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('12 rue de la République Moissac');
    await attendre(() => propositions().length === 3, 'propositions');
    const numero = propositions()[2];
    expect(numero?.getAttribute('data-type')).toBe('housenumber');
    if (numero) await toucher(numero);
    attendreCentre(NUMERO_MOISSAC, 'numéro');
    expect(zoomAffiche()).toBe(adresse.zoomPourType('housenumber'));
    expect(zoomAffiche()).toBeGreaterThanOrEqual(18);
  });

  it('la touche Entrée dans le champ prend la première proposition', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([RUE_MOISSAC, MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 2, 'propositions');
    const c = champAdresse();
    await act(async () => {
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await unTour();
    attendreCentre(RUE_MOISSAC, 'première proposition');
    expect(zoomAffiche()).toBe(adresse.zoomPourType('street'));
    expect(propositions()).toHaveLength(0);
  });

  it('réponse sans résultat : « Aucune adresse trouvée », pas d’erreur', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Zzzzzz');
    await attendre(() => message() !== null, 'message');
    expect(texte(message())).toContain(MESSAGES_ADRESSE.aucun);
    expect(message()?.getAttribute('role')).toBe('status');
    expect(propositions()).toHaveLength(0);
  });
});

// ── Hors ligne et service muet ───────────────────────────────────────────────────────────────

describe('T28h : hors ligne ou service muet', () => {
  it('hors ligne : aucune requête, message clair, carte toujours déplaçable et zoomable, aucune erreur', async () => {
    await ouvrir({ origine: true, enLigne: false });
    minuteriesFactices();
    await frapper('Moissac');
    expect(fetchSimule, 'aucune requête hors ligne').not.toHaveBeenCalled();
    await attendre(() => message() !== null, 'message hors ligne');
    expect(texte(message())).toMatch(MOTIF_INDISPONIBLE);
    expect(message()?.getAttribute('role')).toBe('status');
    expect(document.querySelector('[role="alert"]'), 'pas d’alerte').toBeNull();
    expect(propositions()).toHaveLength(0);
    // L'éditeur reste utilisable : zoom, plan, champ.
    expect(editeur()?.getAttribute('data-mode')).toBe('edition');
    const avant = zoomAffiche();
    await toucher(boutonZoom('Zoom arrière'));
    expect(zoomAffiche()).toBe(avant - 1);
    expect(un(T.plan)).not.toBeNull();
    expect(erreursConsole).not.toHaveBeenCalled();
  });

  it('en ligne mais réseau en échec (fetch rejeté) : même message, aucune erreur levée', async () => {
    fetchSimule.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => message() !== null, 'message');
    expect(texte(message())).toMatch(MOTIF_INDISPONIBLE);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(erreursConsole).not.toHaveBeenCalled();
  });

  it('service muet (HTTP 503) ou réponse illisible : même message', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(new Response('Service Unavailable', { status: 503 })));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => message() !== null, 'message 503');
    expect(texte(message())).toMatch(MOTIF_INDISPONIBLE);

    fetchSimule.mockImplementation(() => Promise.resolve(new Response('<html>pas du json</html>', { status: 200 })));
    await taper('Moissac 2');
    await avancer(adresse.DELAI_SAISIE_MS);
    await attendre(() => message() !== null && texte(message()).length > 0, 'message JSON illisible');
    expect(texte(message())).toMatch(MOTIF_INDISPONIBLE);
    expect(erreursConsole).not.toHaveBeenCalled();
  });

  it('le message disparaît quand une recherche suivante aboutit', async () => {
    fetchSimule.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    await ouvrir({ origine: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => message() !== null, 'message');
    await taper('Moissac ');
    await avancer(adresse.DELAI_SAISIE_MS);
    await attendre(() => propositions().length === 1, 'proposition');
    expect(message()).toBeNull();
  });
});

// ── L'origine du plan n'est jamais touchée ───────────────────────────────────────────────────

describe('T28h : la recherche ne modifie jamais ferme.origine_plan', () => {
  it('ferme placée : après recherche et choix, origine_plan en base et data-origine inchangés, aucune écriture', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    const b = await ouvrir({ origine: true });
    const avantBase = origineEnBase(b);
    expect(avantBase).toBe(JSON.stringify(POSITION));
    const avantAttr = attr('data-origine');
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 1, 'proposition');
    const p = propositions()[0];
    if (p) await toucher(p);
    attendreCentre(MOISSAC, 'recentrée');
    expect(origineEnBase(b)).toBe(avantBase);
    expect(attr('data-origine')).toBe(avantAttr);
    expect(b.placements).toEqual([]);
    expect(b.autresEcritures).toEqual([]);
  });

  it('ferme sans origine (avec position) : la vue bouge, origine_plan reste nulle, « point de départ » toujours demandé', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    const b = await ouvrir({});
    expect(origineEnBase(b)).toBeNull();
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 1, 'proposition');
    const p = propositions()[0];
    if (p) await toucher(p);
    attendreCentre(MOISSAC, 'recentrée');
    expect(origineEnBase(b)).toBeNull();
    expect(attr('data-origine')).toBe('');
    expect(un(T.origineAbsente)).not.toBeNull();
    expect(b.placements).toEqual([]);
    expect(b.autresEcritures).toEqual([]);
  });

  it('ferme sans origine ni position : la recherche sert à retrouver le lieu, rien n’est écrit', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    const b = await ouvrir({ sansPosition: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 1, 'proposition');
    const p = propositions()[0];
    if (p) await toucher(p);
    attendreCentre(MOISSAC, 'recentrée');
    expect(zoomAffiche()).toBe(adresse.zoomPourType('municipality'));
    expect(origineEnBase(b)).toBeNull();
    expect(attr('data-origine')).toBe('');
    expect(b.placements).toEqual([]);
    expect(b.autresEcritures).toEqual([]);
  });

  it('le premier placement continue de poser l’origine, au lieu où la vue a été amenée', async () => {
    fetchSimule.mockImplementation(() => Promise.resolve(reponse(reponseGeocodage([MOISSAC]))));
    const b = await ouvrir({ sansPosition: true });
    minuteriesFactices();
    await frapper('Moissac');
    await attendre(() => propositions().length === 1, 'proposition');
    const p = propositions()[0];
    if (p) await toucher(p);
    vi.useRealTimers();
    const plan = un(T.plan);
    if (plan === null) throw new Error('plan absent');
    await act(async () => {
      plan.dispatchEvent(new PointerEvent('pointerdown', { clientX: 640, clientY: 400, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, isPrimary: true }));
      plan.dispatchEvent(new PointerEvent('pointerup', { clientX: 640, clientY: 400, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, isPrimary: true }));
      plan.dispatchEvent(new MouseEvent('click', { clientX: 640, clientY: 400, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await unTour();
    const dialogue = [...document.querySelectorAll<HTMLElement>('[role="alertdialog"], [role="dialog"]')].find((d) => d.getAttribute('data-testid') !== T.editeur && /point de départ/i.test(texte(d)));
    expect(dialogue, 'confirmation du point de départ').toBeDefined();
    const confirmer = [...(dialogue?.querySelectorAll<HTMLElement>('button') ?? [])].find((x) => texte(x).includes('Confirmer'));
    if (confirmer) await toucher(confirmer);
    await attendre(() => b.placements.length === 1, 'un placement écrit');
    expect(b.placements[0]?.[0]?.sorte).toBe('origine');
    await attendre(() => attr('data-origine') !== '', 'origine posée');
    const [lat = Number.NaN, lon = Number.NaN] = attr('data-origine').split(',').map(Number);
    expect(Math.abs(lat - MOISSAC.latitude)).toBeLessThan(0.01);
    expect(Math.abs(lon - MOISSAC.longitude)).toBeLessThan(0.01);
  });
});

// ── Recul : zoom minimal 6, départ à 6 ───────────────────────────────────────────────────────

describe('T28h : recul de la photo aérienne', () => {
  it('sans origine ni position : départ à 6 et champ d’adresse mis en avant', async () => {
    await ouvrir({ sansPosition: true });
    expect(tuiles.ZOOM_DEPART_SANS_POSITION).toBe(6);
    expect(attr('data-zoom')).toBe('6');
    expect(champAdresse().getAttribute('data-mis-en-avant')).toBe('true');
  });

  it('avec origine ou position : zoom de départ inchangé (19), champ non mis en avant', async () => {
    await ouvrir({ origine: true });
    expect(attr('data-zoom')).toBe('19');
    expect(champAdresse().getAttribute('data-mis-en-avant') ?? 'false').not.toBe('true');
    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    bancCourant?.base.fermer();
    await ouvrir({});
    expect(attr('data-zoom')).toBe('19');
    expect(champAdresse().getAttribute('data-mis-en-avant') ?? 'false').not.toBe('true');
  });

  it('au bouton « Zoom arrière » : de 19 à 6, puis le bouton est désactivé et le zoom ne descend plus', async () => {
    await ouvrir({ origine: true });
    for (let z = 19; z > 6; z--) {
      expect(zoomAffiche()).toBe(z);
      expect(desactive(boutonZoom('Zoom arrière'))).toBe(false);
      await toucher(boutonZoom('Zoom arrière'));
    }
    expect(zoomAffiche()).toBe(6);
    expect(desactive(boutonZoom('Zoom arrière'))).toBe(true);
    await toucher(boutonZoom('Zoom arrière'));
    expect(zoomAffiche()).toBe(6);
    await toucher(boutonZoom('Zoom avant'));
    expect(zoomAffiche()).toBe(7);
  });

  it('au pincement (molette, geste du pavé tactile) : descend jusqu’à 6 et pas plus', async () => {
    await ouvrir({ origine: true });
    const plan = un(T.plan);
    if (plan === null) throw new Error('plan absent');
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        plan.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true, ctrlKey: true }));
        await Promise.resolve();
      });
    }
    await unTour();
    expect(zoomAffiche()).toBe(6);
    expect(desactive(boutonZoom('Zoom arrière'))).toBe(true);
  });

  it('au-delà de la limite des tuiles : comportement actuel (data-zoom plafonné à 19, zoom avant jusqu’à 22)', async () => {
    await ouvrir({ origine: true });
    for (let i = 0; i < 5; i++) await toucher(boutonZoom('Zoom avant'));
    expect(zoomAffiche()).toBe(19);
    expect(desactive(boutonZoom('Zoom avant'))).toBe(true);
  });
});

// ── Plusieurs sites : « Aller à » et « Toute la ferme » ──────────────────────────────────────

describe('T28h : plusieurs sites', () => {
  const ORIGINE = POSITION;
  const geo = (x: number, y: number): { latitude: number; longitude: number } => versGeographique(ORIGINE, { x, y });

  it('« Aller à » liste les zones de premier niveau placées (ni sous-zone, ni zone sans contour), dans l’ordre de la base', async () => {
    await ouvrir({ origine: true, deuxSites: true });
    const l = liste('Aller à');
    expect(l.getAttribute('data-testid')).toBe(A.allerA);
    const options = [...l.options].map((o) => [o.value, texte(o)] as const);
    expect(options[0]?.[0], 'première option = invite').toBe('');
    expect(options.slice(1)).toEqual([
      [ZONE_CHAMP, 'Plein champ'],
      [ZONE_SITE2, 'Verger nord'],
    ]);
    expect(options.map((o) => o[0])).not.toContain(ZONE_ENFANT);
    expect(options.map((o) => o[0])).not.toContain(ZONE_TUNNEL);
  });

  it('« Aller à » une zone centre la vue sur elle (milieu de son contour) et zoome dessus, pour chacun des deux sites', async () => {
    await ouvrir({ origine: true, deuxSites: true });
    await remplir(liste('Aller à'), ZONE_SITE2);
    attendreCentre(geo(20120, 15), 'Verger nord, à 20 km');
    expect(zoomAffiche()).toBe(19);
    await remplir(liste('Aller à'), ZONE_CHAMP);
    attendreCentre(geo(120, 15), 'Plein champ');
    expect(zoomAffiche()).toBe(19);
  });

  it('« Toute la ferme » cadre les deux sites : centre entre les deux, zoom 12 (20 km dans 1 280 px)', async () => {
    await ouvrir({ origine: true, deuxSites: true });
    const b = un(A.toutelaFerme);
    expect(b, 'bouton « Toute la ferme »').not.toBeNull();
    expect(texte(b)).toMatch(/Toute la ferme/);
    if (b) await toucher(b);
    attendreCentre(geo(10120, 15), 'milieu des deux sites');
    expect(zoomAffiche()).toBe(12);
  });

  it('depuis « Aller à » puis « Toute la ferme », on revient : le recadrage ne dépend pas de la vue courante', async () => {
    await ouvrir({ origine: true, deuxSites: true });
    await remplir(liste('Aller à'), ZONE_SITE2);
    await toucher(un(A.toutelaFerme) ?? document.body);
    attendreCentre(geo(10120, 15), 'milieu des deux sites');
    expect(zoomAffiche()).toBe(12);
  });

  it('une seule zone placée : « Toute la ferme » cadre cette zone ; aucune « Aller à » ni écriture', async () => {
    const b = await ouvrir({ origine: true });
    expect([...liste('Aller à').options].map((o) => o.value)).toEqual(['', ZONE_CHAMP]);
    await toucher(un(A.toutelaFerme) ?? document.body);
    attendreCentre(geo(120, 15), 'zone unique');
    expect(zoomAffiche()).toBe(19);
    expect(b.placements).toEqual([]);
    expect(b.autresEcritures).toEqual([]);
  });

  it('sans origine du plan : rien n’est placé, « Toute la ferme » absent ou désactivé, « Aller à » sans zone', async () => {
    await ouvrir({});
    const toute = un(A.toutelaFerme);
    expect(toute === null || desactive(toute)).toBe(true);
    const aller = document.querySelector<HTMLSelectElement>(`[data-testid="${A.allerA}"]`);
    expect(aller === null || [...aller.options].every((o) => o.value === '')).toBe(true);
  });
});
