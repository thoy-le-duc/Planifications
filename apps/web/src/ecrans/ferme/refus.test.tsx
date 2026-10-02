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
  parametresRefusArchive,
  parametresRefusResume,
  SQL_ARCHIVER_PAR_SYNCHRO,
  SQL_INSERER_REFUS,
  SQL_INSERER_REFUS_ARCHIVE,
  SQL_INSERER_REFUS_RESUME,
  UTILISATEUR_REFUS,
  type LigneRefusLocale,
  type ResumeSaisieLocal,
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

describe('T10k : la saisie refusée reconnaissable', () => {
  const SANS_RESUME: ResumeSaisieLocal = { saisie_type: null, saisie_culture: null, saisie_date: null, saisie_quantite: null, saisie_unite: null };

  function recevoirAvecResume(l: LigneRefusLocale, resume: Partial<ResumeSaisieLocal>): void {
    base.recevoir(SQL_INSERER_REFUS_RESUME, parametresRefusResume({ ...l, ...SANS_RESUME, ...resume }));
  }

  /** Jamais de valeur technique ou manquante affichée. */
  function sansTrou(t: string, id: string): void {
    expect(t, `refus ${id} : ni null, ni undefined, ni NaN`).not.toMatch(/\b(null|undefined|NaN)\b/);
    expect(t, `refus ${id} : jamais le code du type d’événement`).not.toMatch(/\b(recolte|realise|observation)\b/);
  }

  it('refus d’une récolte : la culture, le jour de la saisie et la quantité saisie, en plus du motif et de la date du refus', async () => {
    const l = refus({
      id: 'r-recolte',
      cree_le: '2025-10-01T12:00:00.000Z',
      operation: 'PUT',
      motif: 'recolte_annulee',
      message: MESSAGES_SERVEUR.recolte_annulee,
    });
    recevoirAvecResume(l, {
      saisie_type: 'recolte',
      saisie_culture: 'Laitue Batavia blonde',
      saisie_date: '2025-09-28',
      saisie_quantite: 12.5,
      saisie_unite: 'kg',
    });
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus de la récolte est affiché');
    verifierRefusSaisie(l, /récolte/i, /\b1(er)?\s+oct/i);
    const t = texte(elementRefus('r-recolte'));
    expect(t, 'le type d’événement en français').toMatch(/récolte/i);
    expect(t, 'la culture').toContain('Laitue Batavia blonde');
    expect(t, 'le jour de la saisie (28 sept.), pas seulement celui du refus').toMatch(/\b28\s+sept/i);
    expect(t, 'la quantité au format français, avec son unité').toMatch(/12,5\s*kg\b/);
    sansTrou(t, 'r-recolte');
  });

  it('unité lisible : « pièces », « bottes », « barquettes », jamais le code', async () => {
    const lignes = [
      [refus({ id: 'r-piece', cree_le: '2025-10-03T12:00:00.000Z', operation: 'PUT', motif: 'auteur_invalide', message: MESSAGES_SERVEUR.auteur_invalide }), 30, 'piece', /30\s*pièces/i],
      [refus({ id: 'r-botte', cree_le: '2025-10-02T12:00:00.000Z', operation: 'PUT', motif: 'auteur_invalide', message: MESSAGES_SERVEUR.auteur_invalide }), 4, 'botte', /4\s*bottes/i],
      [refus({ id: 'r-barq', cree_le: '2025-10-01T12:00:00.000Z', operation: 'PUT', motif: 'auteur_invalide', message: MESSAGES_SERVEUR.auteur_invalide }), 1, 'barquette', /1\s*barquette\b/i],
    ] as const;
    for (const [l, quantite, unite] of lignes) {
      recevoirAvecResume(l, { saisie_type: 'recolte', saisie_culture: 'Fraise Mara des bois', saisie_date: '2025-09-30', saisie_quantite: quantite, saisie_unite: unite });
    }
    await rendre();
    await attendre(() => elementsRefus().length === 3, 'les trois refus sont affichés');
    for (const [l, , , attendu] of lignes) {
      const t = texte(elementRefus(l.id));
      expect(t, `refus ${l.id}`).toMatch(attendu);
      expect(t, `refus ${l.id} : jamais le code de l’unité`).not.toMatch(/\bpiece\b/);
      sansTrou(t, l.id);
    }
  });

  it('refus d’un événement « réalisé » : la culture et le jour, sans quantité ni trou', async () => {
    const l = refus({ id: 'r-realise', cree_le: '2025-10-01T12:00:00.000Z', operation: 'PUT', motif: 'auteur_invalide', message: MESSAGES_SERVEUR.auteur_invalide });
    recevoirAvecResume(l, { saisie_type: 'realise', saisie_culture: 'Laitue', saisie_date: '2025-08-05' });
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
    verifierRefusSaisie(l, /saisie|événement|journal|réalis|plantation|semis/i, /\b1(er)?\s+oct/i);
    const t = texte(elementRefus('r-realise'));
    expect(t).toContain('Laitue');
    expect(t, 'le jour de la saisie').toMatch(/\b5\s+août/i);
    sansTrou(t, 'r-realise');
  });

  it('résumé partiel (culture seule absente, type inconnu) : ce qui est connu, sans trou', async () => {
    const l = refus({ id: 'r-partiel', cree_le: '2025-10-01T12:00:00.000Z', operation: 'PUT', motif: 'ecriture_invalide', message: messageServeur('ecriture_invalide', 'quantité négative') });
    recevoirAvecResume(l, { saisie_type: 'type_de_demain', saisie_date: '2025-09-12', saisie_quantite: -3, saisie_unite: 'kg' });
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
    verifierRefusSaisie(l, /saisie|événement|journal/i, /\b1(er)?\s+oct/i);
    const t = texte(elementRefus('r-partiel'));
    expect(t, 'le jour de la saisie').toMatch(/\b12\s+sept/i);
    expect(t, 'jamais le code d’un type inconnu').not.toContain('type_de_demain');
    sansTrou(t, 'r-partiel');
  });

  it('refus sans résumé (serveur d’avant T10k, écriture illisible) : affiché comme avant', async () => {
    const ancien = refus({ id: 'r-ancien', cree_le: '2025-09-14T12:00:00.000Z' });
    recevoir(ancien);
    const vide = refus({ id: 'r-vide', cree_le: '2025-09-15T12:00:00.000Z', operation: 'PUT', motif: 'ecriture_invalide', message: MESSAGES_SERVEUR.ecriture_invalide });
    recevoirAvecResume(vide, {});
    await rendre();
    await attendre(() => elementsRefus().length === 2, 'les deux refus sont affichés');
    verifierRefusSaisie(ancien, /saisie|événement|journal/i, /\b14\s+sept/i);
    verifierRefusSaisie(vide, /saisie|événement|journal/i, /\b15\s+sept/i);
    for (const id of ['r-ancien', 'r-vide']) sansTrou(texte(elementRefus(id)), id);
  });
});

describe('T10l : archiver un refus vu', () => {
  const archiveLe = (id: string): string | null | undefined =>
    base.lireDirect<{ archive_le: string | null }>('SELECT archive_le FROM refus_synchro WHERE id = ?', [id])[0]?.archive_le;

  function recevoirArchive(l: LigneRefusLocale, date: string | null): void {
    base.recevoir(SQL_INSERER_REFUS_ARCHIVE, parametresRefusArchive(l, date));
  }

  function bouton(dans: ParentNode, testId: string, libelle: RegExp, quoi: string): HTMLButtonElement {
    const b = dans.querySelector<HTMLButtonElement>(`button[data-testid="${testId}"]`);
    if (b === null) throw new Error(`${quoi} : bouton data-testid="${testId}" absent`);
    expect(texte(b), quoi).toMatch(libelle);
    const hauteur = Number.parseFloat(getComputedStyle(b).minHeight || b.style.minHeight);
    expect(hauteur, `${quoi} : 56 px de haut au moins (gants)`).toBeGreaterThanOrEqual(56);
    return b;
  }

  const archiverUn = (id: string): HTMLButtonElement => bouton(elementRefus(id), 'refus-archiver', /^Archiver$/, `refus ${id}`);
  const toutArchiver = (): HTMLButtonElement => bouton(conteneur, 'refus-tout-archiver', /Tout archiver/i, '« Tout archiver »');

  async function taper(b: HTMLButtonElement): Promise<void> {
    await act(async () => {
      b.click();
      await Promise.resolve();
    });
  }

  it('« Archiver » sur une carte : ce refus disparaît, archivé dans la base (rien de supprimé), les autres restent', async () => {
    recevoir(refus({ id: 'r-1', cree_le: '2025-09-14T12:00:00.000Z' }), refus({ id: 'r-2', cree_le: '2025-09-15T12:00:00.000Z' }));
    await rendre();
    await attendre(() => elementsRefus().length === 2, 'deux refus affichés');
    expect(texte(region())).toMatch(/2 saisies refusées/);

    await taper(archiverUn('r-2'));
    await attendre(() => elementsRefus().length === 1, 'le refus archivé disparaît');
    expect(ids()).toEqual(['r-1']);
    expect(texte(region()), 'le titre se recompte').toMatch(/1 saisie refusée/);
    expect(archiveLe('r-2'), 'archive_le posé, en instant ISO').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(archiveLe('r-1'), 'l’autre refus n’est pas archivé').toBeNull();
    expect(base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM refus_synchro')[0]?.n, 'rien de supprimé').toBe(2);
  });

  it('le dernier refus archivé : plus aucune carte de refus, le reste de l’écran est là', async () => {
    recevoir(refus({ id: 'r-seul', cree_le: '2025-09-14T12:00:00.000Z' }));
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
    await taper(archiverUn('r-seul'));
    await attendre(() => elementsRefus().length === 0, 'plus aucun refus affiché');
    expect(texte(conteneur)).toContain('Exporter toute ma ferme');
  });

  it('« Tout archiver » : archive les 20 refus affichés, pas ceux cachés derrière « voir plus »', async () => {
    const lignes: LigneRefusLocale[] = [];
    for (let n = 1; n <= 25; n++) {
      lignes.push(refus({ id: `r-${String(n).padStart(2, '0')}`, cree_le: new Date(Date.UTC(2025, 8, 14, 12, 60 - n)).toISOString() }));
    }
    recevoir(...lignes);
    await rendre();
    await attendre(() => elementsRefus().length === 20, '20 refus affichés d’abord');

    await taper(toutArchiver());
    await attendre(() => elementsRefus().length === 5, `les 5 refus qui n’étaient pas affichés restent (affichés : ${String(elementsRefus().length)})`);
    expect(ids()).toEqual(lignes.slice(20).map((l) => l.id));
    for (const l of lignes.slice(0, 20)) expect(archiveLe(l.id), `${l.id} archivé`).not.toBeNull();
    for (const l of lignes.slice(20)) expect(archiveLe(l.id), `${l.id} pas encore vu : pas archivé`).toBeNull();
  });

  it('un refus archivé (sur ce téléphone ou un autre) ne s’affiche pas ; archivé par la synchro pendant que l’écran est ouvert, il disparaît', async () => {
    recevoirArchive(refus({ id: 'r-archive', cree_le: '2025-09-16T12:00:00.000Z' }), '2025-09-16T13:00:00.000Z');
    recevoir(refus({ id: 'r-1', cree_le: '2025-09-14T12:00:00.000Z' }), refus({ id: 'r-2', cree_le: '2025-09-15T12:00:00.000Z' }));
    await rendre();
    await attendre(() => elementsRefus().length === 2, 'les deux refus non archivés sont affichés');
    await laisserFiler();
    expect(ids(), 'jamais le refus archivé').toEqual(['r-2', 'r-1']);

    base.recevoir(SQL_ARCHIVER_PAR_SYNCHRO, ['2025-09-17T08:00:00.000Z', 'r-2']);
    await attendre(() => elementsRefus().length === 1, 'archivé sur un autre téléphone : il disparaît');
    expect(ids()).toEqual(['r-1']);
  });

  it('le refus d’un archivage refusé par le serveur (table refus_synchro) s’affiche sans casser l’écran ni montrer le nom de la table', async () => {
    const l = refus({
      id: 'r-archivage',
      cree_le: '2025-09-18T12:00:00.000Z',
      nom_table: 'refus_synchro',
      operation: 'PATCH',
      motif: 'table_interdite',
      message: MESSAGES_SERVEUR.table_interdite,
    });
    recevoir(l);
    await rendre();
    await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
    const t = texte(elementRefus('r-archivage'));
    expect(t).toContain(MESSAGES_SERVEUR.table_interdite);
    expect(t, 'jamais le nom brut de la table').not.toMatch(/refus_synchro|table_interdite/);
    expect(t).not.toMatch(/\b(null|undefined|NaN)\b/);
    expect(action(elementRefus('r-archivage')).length).toBeGreaterThanOrEqual(10);
    // Il s'archive comme les autres.
    await taper(archiverUn('r-archivage'));
    await attendre(() => elementsRefus().length === 0, 'archivé à son tour');
  });

  describe('relecture', () => {
    const toutArchiverAbsent = (): boolean => conteneur.querySelector('[data-testid="refus-tout-archiver"]') === null;
    const nomAccessible = (b: HTMLElement): string => (b.getAttribute('aria-label') ?? texte(b)).replace(/\s+/g, ' ').trim();
    const titreCarte = (id: string): string => texte(elementRefus(id).querySelector('strong'));

    it('« Tout archiver » absent avec un seul refus affiché, « Tout archiver (2) » dès deux', async () => {
      recevoir(refus({ id: 'r-1', cree_le: '2025-09-14T12:00:00.000Z' }));
      await rendre();
      await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
      await laisserFiler();
      expect(toutArchiverAbsent(), 'un seul refus : « Archiver » suffit').toBe(true);

      recevoir(refus({ id: 'r-2', cree_le: '2025-09-15T12:00:00.000Z' }));
      await attendre(() => elementsRefus().length === 2, 'le deuxième refus arrive');
      expect(texte(toutArchiver())).toMatch(/Tout archiver \(2\)/);
    });

    it('« Tout archiver (20) » quand 20 refus sont affichés sur 25', async () => {
      const lignes: LigneRefusLocale[] = [];
      for (let n = 1; n <= 25; n++) {
        lignes.push(refus({ id: `r-${String(n).padStart(2, '0')}`, cree_le: new Date(Date.UTC(2025, 8, 14, 12, 60 - n)).toISOString() }));
      }
      recevoir(...lignes);
      await rendre();
      await attendre(() => elementsRefus().length === 20, '20 refus affichés');
      expect(texte(toutArchiver())).toMatch(/Tout archiver \(20\)/);
    });

    it('« Tout archiver » est placé après la liste des cartes', async () => {
      recevoir(refus({ id: 'r-1', cree_le: '2025-09-14T12:00:00.000Z' }), refus({ id: 'r-2', cree_le: '2025-09-15T12:00:00.000Z' }));
      await rendre();
      await attendre(() => elementsRefus().length === 2, 'deux refus affichés');
      const derniere = elementsRefus().at(-1);
      if (derniere === undefined) throw new Error('aucune carte');
      const position = derniere.compareDocumentPosition(toutArchiver());
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING, 'après la dernière carte (ordre du DOM)').toBeTruthy();
      expect(position & Node.DOCUMENT_POSITION_CONTAINED_BY, 'hors des cartes').toBeFalsy();
    });

    it('chaque « Archiver » a un nom accessible distinct, qui contient le titre de sa carte', async () => {
      const recolte = refus({ id: 'r-recolte', cree_le: '2025-10-01T12:00:00.000Z', operation: 'PUT', motif: 'recolte_annulee', message: MESSAGES_SERVEUR.recolte_annulee });
      base.recevoir(SQL_INSERER_REFUS_RESUME, parametresRefusResume({ ...recolte, saisie_type: 'recolte', saisie_culture: 'Laitue', saisie_date: '2025-09-28', saisie_quantite: 3, saisie_unite: 'kg' }));
      recevoir(
        refus({ id: 'r-serie', cree_le: '2025-09-30T12:00:00.000Z', nom_table: 'serie', operation: 'PUT', motif: 'ecriture_invalide', message: MESSAGES_SERVEUR.ecriture_invalide }),
        // Deux refus de même titre, à des dates différentes : leurs noms doivent quand même différer.
        refus({ id: 'r-a', cree_le: '2025-09-14T12:00:00.000Z' }),
        refus({ id: 'r-b', cree_le: '2025-09-15T12:00:00.000Z' }),
      );
      await rendre();
      await attendre(() => elementsRefus().length === 4, 'quatre refus affichés');
      const noms = ['r-recolte', 'r-serie', 'r-a', 'r-b'].map((id) => {
        const b = archiverUn(id);
        const nom = nomAccessible(b);
        expect(nom, `refus ${id} : le nom commence par « Archiver »`).toMatch(/^Archiver\b/);
        expect(nom, `refus ${id} : le nom contient le titre de la carte`).toContain(titreCarte(id));
        return nom;
      });
      expect(nomAccessible(archiverUn('r-recolte'))).toMatch(/Récolte/);
      expect(new Set(noms).size, `noms distincts : ${JSON.stringify(noms)}`).toBe(noms.length);
    });

    it('refus d’un archivage refusé (refus_synchro) : action propre, jamais « responsable de la ferme »', async () => {
      recevoir(
        refus({
          id: 'r-archivage',
          cree_le: '2025-09-18T12:00:00.000Z',
          nom_table: 'refus_synchro',
          operation: 'PATCH',
          motif: 'table_interdite',
          message: MESSAGES_SERVEUR.table_interdite,
        }),
      );
      await rendre();
      await attendre(() => elementsRefus().length === 1, 'le refus est affiché');
      const a = action(elementRefus('r-archivage'));
      expect(a).toMatch(/refus n[’']a pas pu être archivé/i);
      expect(a).not.toMatch(/responsable de la ferme/i);
    });
  });
});
