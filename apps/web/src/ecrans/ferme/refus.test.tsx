// @vitest-environment happy-dom
/**
 * Tests d'acceptation T10i — les refus de synchro s'affichent dans l'onglet Ferme
 * (docs/backlog/T10i-refus-affiches.md). Contrat : ./test/refus.ts. Vrai écran Ferme, DOM simulé,
 * vraie porte (@planif/sync) sur la base mémoire : les refus « arrivent » comme par la synchro
 * (`base.recevoir`). La pastille de la coquille : src/App.refus.test.tsx ; le temps d'affichage
 * avec 100 refus : e2e/refus.e2e.ts.
 *
 * « La file continue » (critère du ticket) : un refus ne bloque pas la file d'envoi, déjà couvert
 * par packages/sync/src/envoi.test.ts (« une écriture refusée par le serveur (200 avec refus) ne
 * bloque pas la file ») et, côté serveur, apps/api/src/sync/upload.integration.test.ts
 * (« écritures refusées sans bloquer la file ») ; T10i n'y touche pas.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import {
  AUTRE_UTILISATEUR,
  FERME_REFUS,
  MARQUE_REFUS_AFFICHES_ATTENDUE,
  MESSAGES_SERVEUR,
  messageServeur,
  parametresRefus,
  SQL_INSERER_REFUS,
  UTILISATEUR_REFUS,
  type LigneRefusLocale,
} from './test/refus.ts';

vi.mock('../../donnees/effacer.ts', async (original) => {
  const reel = await original<typeof import('../../donnees/effacer.ts')>();
  return { ...reel, baseLocaleExiste: () => Promise.resolve(true), effacerDonneesLocales: () => Promise.resolve() };
});

interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  readonly baseLocale: PoigneeDonnees;
  readonly surDeconnecte: (erreur: string | null) => void;
  readonly etatBase: EtatBase;
}

interface ModuleEcranFerme {
  readonly default: (props: ProprietesEcranFerme) => ReactElement;
  readonly MARQUE_REFUS_AFFICHES?: string;
}

/** Chemin tenu dans une variable : le typage ne dépend pas de l'export pas encore écrit. */
const CHEMIN_MODULE = './EcranFerme.tsx';
let m: ModuleEcranFerme;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleEcranFerme;
});

const SESSION: SessionConnexion = {
  utilisateurId: UTILISATEUR_REFUS,
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

const POIGNEE: PoigneeDonnees = { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };

/** Codes des motifs : jamais affichés tels quels. */
const CODES = [...Object.keys(MESSAGES_SERVEUR), 'motif_de_demain'];

let base: BaseMemoire;
let porte: PorteDonnees;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  base = creerBaseMemoire(SCHEMA_LOCAL);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR_REFUS as Id<'Utilisateur'>, fermeId: FERME_REFUS as Id<'Ferme'> });
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
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
  base.fermer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let compteur = 0;
/** Refus de l'utilisateur de la session, sur un événement, sauf précision contraire. */
function refus(o: Partial<LigneRefusLocale> & Pick<LigneRefusLocale, 'id' | 'cree_le'>): LigneRefusLocale {
  compteur++;
  return {
    utilisateur_id: UTILISATEUR_REFUS,
    ferme_id: FERME_REFUS,
    nom_table: 'evenement',
    ligne_id: `0192f0c1-1010-7000-b000-${compteur.toString(16).padStart(12, '0')}`,
    operation: 'PATCH',
    motif: 'ajout_seul',
    message: MESSAGES_SERVEUR.ajout_seul,
    ...o,
  };
}

function recevoir(...lignes: LigneRefusLocale[]): void {
  for (const l of lignes) base.recevoir(SQL_INSERER_REFUS, parametresRefus(l));
}

async function laisserFiler(tours = 20): Promise<void> {
  for (let k = 0; k < tours; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const limite = Date.now() + 3_000;
  while (!condition() && Date.now() < limite) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  expect(condition(), message).toBe(true);
}

async function rendre(): Promise<void> {
  const proprietes: ProprietesEcranFerme = { session: SESSION, baseLocale: POIGNEE, surDeconnecte: () => undefined, etatBase: 'prete' };
  await act(async () => {
    racine.render(createElement(ContexteFerme, { value: { porte, fermeId: FERME_REFUS } }, createElement(m.default, proprietes)));
    await Promise.resolve();
  });
  await laisserFiler();
}

const elementsRefus = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="refus"]')];
const ids = (): (string | null)[] => elementsRefus().map((e) => e.getAttribute('data-refus'));
const texte = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

function elementRefus(id: string): HTMLElement {
  const e = conteneur.querySelector<HTMLElement>(`[data-testid="refus"][data-refus="${id}"]`);
  if (e === null) throw new Error(`refus ${id} absent de l’écran (refus affichés : ${JSON.stringify(ids())})`);
  return e;
}

function action(e: HTMLElement): string {
  const a = e.querySelector('[data-testid="refus-action"]');
  expect(a, `refus ${String(e.getAttribute('data-refus'))} : un élément data-testid="refus-action" (quoi faire)`).not.toBeNull();
  return texte(a);
}

function region(): Element | null {
  return [...conteneur.querySelectorAll('section[aria-label], [role="region"]')].find((r) => /refus/i.test(r.getAttribute('aria-label') ?? '')) ?? null;
}

/** Ce qu'un refus d'une saisie doit montrer, et ne jamais montrer. */
function verifierRefusSaisie(l: LigneRefusLocale, typeAttendu: RegExp, dateAttendue: RegExp): void {
  const e = elementRefus(l.id);
  const t = texte(e);
  expect(t, `refus ${l.id} : le motif en français, tel que le serveur l’a écrit`).toContain(l.message);
  for (const code of CODES) expect(t, `refus ${l.id} : jamais le code brut « ${code} »`).not.toContain(code);
  expect(t, `refus ${l.id} : le type de saisie en français (${String(typeAttendu)})`).toMatch(typeAttendu);
  expect(t, `refus ${l.id} : jamais le nom brut de la table`).not.toMatch(/\b(evenement|mouvement_stock|serie|nom_table)\b/);
  expect(t, `refus ${l.id} : jamais l’identifiant technique de la ligne`).not.toContain(l.ligne_id);
  expect(t, `refus ${l.id} : la date du refus, jour et mois en français`).toMatch(dateAttendue);
  const a = action(e);
  expect(a.length, `refus ${l.id} : quoi faire, une phrase`).toBeGreaterThanOrEqual(10);
  expect(a, `refus ${l.id} : quoi faire, autre chose que le motif`).not.toBe(l.message);
}

describe('T10i : les refus de synchro dans l’onglet Ferme', () => {
  it('les messages du contrat sont ceux du serveur, mot pour mot (apps/api/src/sync)', () => {
    // T10j : les messages peuvent quitter upload.ts (motifs.ts…) : tout le code de la synchro est lu.
    const dossier = join(import.meta.dirname, '../../../../api/src/sync');
    const source = readdirSync(dossier)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join(dossier, f), 'utf8'))
      .join('\n');
    for (const [code, message] of Object.entries(MESSAGES_SERVEUR)) {
      expect(source.includes(message), `message de « ${code} » introuvable dans apps/api/src/sync : mettre à jour test/refus.ts`).toBe(true);
    }
  });

  it('chaque refus : ce qui était saisi, la date, le motif en français et quoi faire ; du plus récent au plus ancien', async () => {
    // Midi UTC : même jour sous tous les fuseaux d'Europe et d'outre-mer.
    const correction = refus({ id: 'r-14', cree_le: '2025-09-14T12:00:00.000Z' });
    const serie = refus({
      id: 'r-13',
      cree_le: '2025-09-13T12:00:00.000Z',
      nom_table: 'serie',
      operation: 'PUT',
      motif: 'ecriture_invalide',
      message: messageServeur('ecriture_invalide', 'date de semis manquante'),
    });
    const stock = refus({
      id: 'r-15',
      cree_le: '2025-09-15T12:00:00.000Z',
      nom_table: 'mouvement_stock',
      operation: 'PUT',
      motif: 'recolte_annulee',
      message: MESSAGES_SERVEUR.recolte_annulee,
    });
    recevoir(correction, serie, stock);
    await rendre();
    await attendre(() => elementsRefus().length === 3, `trois refus affichés (écran : « ${texte(conteneur).slice(0, 200)} »)`);

    expect(region(), 'une région dont le nom contient « refus »').not.toBeNull();
    expect(ids(), 'du plus récent au plus ancien').toEqual(['r-15', 'r-14', 'r-13']);
    verifierRefusSaisie(stock, /stock|récolte/i, /\b15\s+sept/i);
    verifierRefusSaisie(correction, /saisie|événement|journal/i, /\b14\s+sept/i);
    verifierRefusSaisie(serie, /série/i, /\b13\s+sept/i);
  });

  it('un code de motif que l’appli ne connaît pas : le message reçu, jamais le code, et quoi faire quand même', async () => {
    const inconnu = refus({ id: 'r-x', cree_le: '2025-09-20T12:00:00.000Z', motif: 'motif_de_demain', message: 'Saisie non enregistrée : règle ajoutée demain.' });
    recevoir(inconnu);
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus au code inconnu est affiché');
    verifierRefusSaisie(inconnu, /saisie|événement|journal/i, /\b20\s+sept/i);
  });

  it('la ligne récapitulative d’un lot trop gros : une phrase sur l’envoi, compréhensible, et quoi faire', async () => {
    const lot = refus({
      id: 'r-lot',
      cree_le: '2025-09-21T12:00:00.000Z',
      ferme_id: null,
      nom_table: 'lot',
      operation: 'PUT',
      motif: 'lot_trop_gros',
      // Précision d'un serveur d'avant T10j : un refus déjà descendu reste dans la base du téléphone.
      message: messageServeur('lot_trop_gros', '12 autres écritures illisibles, en double ou hors des tables permises'),
    });
    recevoir(lot);
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'la ligne du lot est affichée');
    const e = elementRefus('r-lot');
    const t = texte(e);
    expect(t, 'parle de l’envoi').toMatch(/envoi/i);
    expect(t, 'dit qu’il était trop gros').toMatch(/trop (gros|volumineux|lourd)/i);
    expect(t, 'pas présentée comme une saisie').not.toContain('Saisie non enregistrée');
    expect(t, 'ni le nom brut « lot »').not.toMatch(/\blot\b/i);
    expect(t, 'ni le code brut').not.toContain('lot_trop_gros');
    expect(t, 'ni le jargon de la précision du serveur').not.toMatch(/écritures?|tables? permises?/i);
    expect(t, 'ni l’identifiant technique').not.toContain(lot.ligne_id);
    expect(t, 'la date').toMatch(/\b21\s+sept/i);
    expect(action(e).length, 'quoi faire, une phrase').toBeGreaterThanOrEqual(10);
  });

  it('jamais le refus d’un autre utilisateur présent dans la base du téléphone', async () => {
    recevoir(
      refus({ id: 'r-moi', cree_le: '2025-09-14T12:00:00.000Z' }),
      refus({ id: 'r-autre', cree_le: '2025-09-15T12:00:00.000Z', utilisateur_id: AUTRE_UTILISATEUR, message: 'Refus d’un autre compte.' }),
    );
    await rendre();
    await attendre(() => elementsRefus().length >= 1, 'le refus de l’utilisateur est affiché');
    await laisserFiler();
    expect(ids()).toEqual(['r-moi']);
    expect(texte(conteneur)).not.toContain('Refus d’un autre compte.');
  });

  it('un refus qui arrive pendant que l’écran est ouvert s’y ajoute, en tête', async () => {
    recevoir(refus({ id: 'r-ancien', cree_le: '2025-09-14T12:00:00.000Z' }));
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le premier refus est affiché');
    recevoir(refus({ id: 'r-nouveau', cree_le: '2025-09-16T12:00:00.000Z', motif: 'auteur_invalide', message: MESSAGES_SERVEUR.auteur_invalide }));
    await attendre(() => elementsRefus().length === 2, 'le refus arrivé par la synchro s’ajoute');
    expect(ids()).toEqual(['r-nouveau', 'r-ancien']);
  });

  it('ajout_seul sur un mouvement de stock : quoi faire ne renvoie pas à l’historique d’Aujourd’hui (le stock n’y figure pas)', async () => {
    const stock = refus({ id: 'r-stock', cree_le: '2025-09-22T12:00:00.000Z', nom_table: 'mouvement_stock', operation: 'PATCH', motif: 'ajout_seul' });
    recevoir(stock);
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus du mouvement de stock est affiché');
    verifierRefusSaisie(stock, /stock/i, /\b22\s+sept/i);
    expect(action(elementRefus('r-stock')), 'phrase neutre ou propre au stock, pas l’historique d’Aujourd’hui').not.toMatch(/historique|aujourd/i);
  });

  it('45 refus : 20 d’abord, puis « Voir les 20 suivants (encore 25) » → 40, puis « Voir les 5 derniers refus » → 45', async () => {
    const lignes: LigneRefusLocale[] = [];
    for (let n = 1; n <= 45; n++) {
      // Le n-ième refus a n minutes de plus que le premier : r-01 est le plus récent.
      lignes.push(refus({ id: `r-${String(n).padStart(2, '0')}`, cree_le: new Date(Date.UTC(2025, 8, 14, 12, 60 - n)).toISOString() }));
    }
    recevoir(...lignes);
    await rendre();
    await attendre(() => elementsRefus().length === 20, `20 refus affichés d’abord (affichés : ${String(elementsRefus().length)})`);
    expect(ids()).toEqual(lignes.slice(0, 20).map((l) => l.id));

    const voirPlus = (): HTMLButtonElement | undefined =>
      [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Voir les? /.test(texte(b)));
    const premier = voirPlus();
    expect(texte(premier)).toBe('Voir les 20 suivants (encore 25)');
    if (premier === undefined) throw new Error('bouton « voir plus » absent');
    const hauteur = Number.parseFloat(getComputedStyle(premier).minHeight || premier.style.minHeight);
    expect(hauteur, 'bouton « voir plus » : 56 px de haut au moins').toBeGreaterThanOrEqual(56);

    await act(async () => {
      premier.click();
      await Promise.resolve();
    });
    await attendre(() => elementsRefus().length === 40, '40 refus après le premier « voir plus »');
    expect(ids()).toEqual(lignes.slice(0, 40).map((l) => l.id));
    const second = voirPlus();
    expect(texte(second)).toBe('Voir les 5 derniers refus');

    await act(async () => {
      second?.click();
      await Promise.resolve();
    });
    await attendre(() => elementsRefus().length === 45, 'les 45 refus');
    expect(ids()).toEqual(lignes.map((l) => l.id));
    expect(voirPlus(), 'plus de bouton une fois tout affiché').toBeUndefined();
  });

  it('aucun refus : aucun élément de refus, le reste de l’écran est là', async () => {
    await rendre();
    await laisserFiler();
    expect(elementsRefus()).toHaveLength(0);
    expect(texte(conteneur)).toContain('Exporter toute ma ferme');
  });

  it('marque MARQUE_REFUS_AFFICHES une fois par ouverture, quand les refus sont dessinés', async () => {
    expect(m.MARQUE_REFUS_AFFICHES, 'EcranFerme.tsx exporte MARQUE_REFUS_AFFICHES').toBe(MARQUE_REFUS_AFFICHES_ATTENDUE);
    const marques: { nom: string; refusAffiches: number }[] = [];
    const reel = performance.mark.bind(performance);
    vi.spyOn(performance, 'mark').mockImplementation((nom: string, options?: PerformanceMarkOptions) => {
      marques.push({ nom, refusAffiches: elementsRefus().length });
      return reel(nom, options);
    });
    recevoir(refus({ id: 'r-1', cree_le: '2025-09-14T12:00:00.000Z' }), refus({ id: 'r-2', cree_le: '2025-09-15T12:00:00.000Z' }));
    await rendre();
    await attendre(() => marques.some((x) => x.nom === MARQUE_REFUS_AFFICHES_ATTENDUE), 'la marque est posée');
    // Un refus de plus, écran ouvert : pas de deuxième marque pour la même ouverture.
    recevoir(refus({ id: 'r-3', cree_le: '2025-09-16T12:00:00.000Z' }));
    await attendre(() => elementsRefus().length === 3, 'le refus suivant est affiché');
    await laisserFiler();
    const posees = marques.filter((x) => x.nom === MARQUE_REFUS_AFFICHES_ATTENDUE);
    expect(posees, 'une seule marque par ouverture').toHaveLength(1);
    expect(posees[0]?.refusAffiches, 'posée quand les refus sont dans le DOM').toBe(2);
  });
});
