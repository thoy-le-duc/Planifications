// @vitest-environment happy-dom
/**
 * Tests d'acceptation T32h, écran — toutes les espèces de la ferme ont leur groupe dans l'écran
 * Itinéraires culturaux, même sans itinéraire (Q40) : « Aucun itinéraire » écrit dessous, et le
 * bouton « Croissance » pour régler leur profil. Les espèces supprimées n'ont pas de groupe ; celles
 * de la bibliothèque commune sans itinéraire de la ferme non plus (la liste serait immense). Une copie
 * personnalisée (T32g) sans itinéraire a son groupe et son réglage se rouvre. Rendu pour de vrai dans
 * un DOM simulé (happy-dom), sur la ferme des itinéraires (./test/ferme-itineraires.ts : Batavia de
 * la bibliothèque, Chou et Radis de la ferme) complétée de quelques espèces.
 * Contrats : ./test/contrat.ts, ./test/contrat-croissance.ts.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import type { ModuleItineraires } from './test/contrat.ts';
import type { ProprietesEcranItinerairesCroissance } from './test/contrat-croissance.ts';
import { CREE_LE, ESPECE, FAMILLE, FERME, UTILISATEUR } from './test/ferme-itineraires.ts';
import { aBouton, attendre, AUJOURDHUI, bouton, creerBanc, dialogue, MAINTENANT, texte, toucher, type Banc } from './test/outils.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module. */
const CHEMIN_ECRAN = './index.ts';

const id = (n: number) => `0192f0c1-3234-7000-8000-${n.toString(16).padStart(12, '0')}`;
/** Asperge de la ferme, sans itinéraire. */
const ASPERGE = id(0x10);
/** Pivoine de la ferme, supprimée, sans itinéraire. */
const PIVOINE = id(0x11);
/** Laitue de la bibliothèque commune, sans itinéraire de la ferme. */
const LAITUE = id(0x12);
/** Copie de la Batavia propre à la ferme (T32g), sans itinéraire. */
const BATAVIA_COPIE = id(0x13);
const ECRAN = 'Mes itinéraires';

let module: ModuleItineraires;
let banc: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleItineraires;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  banc = await creerBanc();
  const espece = (eid: string, ferme: string | null, nom: string, famille: string, supprimeLe: string | null = null) => {
    banc.base.recevoir(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, 'legume', 0, 'kg', NULL, NULL, NULL, ?, ?, ?)`,
      [eid, ferme, famille, nom, CREE_LE, CREE_LE, supprimeLe],
    );
  };
  espece(ASPERGE, FERME, 'Asperge', FAMILLE.asteracees);
  espece(PIVOINE, FERME, 'Pivoine', FAMILLE.asteracees, CREE_LE);
  espece(LAITUE, null, 'Laitue', FAMILLE.asteracees);
  espece(BATAVIA_COPIE, FERME, 'Batavia', FAMILLE.asteracees);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  banc.base.fermer();
});

function porte(): PorteDonnees {
  const base = banc.base;
  const b: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => base.writeTransaction(fn),
    onChange: (g, o) => base.onChange(g, o),
  };
  return creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
}

const groupe = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="ecran-itineraires"] [data-testid="culture-itineraires"][data-espece="${especeId}"]`);
const groupes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="ecran-itineraires"] [data-testid="culture-itineraires"]')];
const reglageOuvert = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="dialog"][data-testid="reglage-croissance"][data-espece="${especeId}"]`);

async function rendre(): Promise<void> {
  const Ecran = module.EcranItineraires as unknown as (p: ProprietesEcranItinerairesCroissance) => ReactElement;
  await act(async () => {
    racine.render(
      createElement(Ecran, {
        porte: porte(),
        fermeId: FERME,
        utilisateurId: UTILISATEUR,
        surFermer: () => undefined,
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(ECRAN) !== undefined, `écran role="dialog" nommé « ${ECRAN} »`);
  await attendre(() => groupe(ESPECE.chou) !== null, 'groupe du Chou');
}

describe('T32h : toutes les espèces de la ferme ont leur groupe (Q40)', () => {
  it('une espèce de la ferme sans itinéraire (Asperge, Radis) a son groupe, « Aucun itinéraire » et « Croissance »', async () => {
    await rendre();
    for (const [eid, nom] of [
      [ASPERGE, 'Asperge'],
      [ESPECE.radis, 'Radis'],
    ] as const) {
      const g = groupe(eid);
      expect(g, `groupe de ${nom}`).not.toBeNull();
      if (g === null) continue;
      expect(texte(g), nom).toMatch(new RegExp(`^${nom}`));
      expect(texte(g), `${nom} : dit qu'il n'y a pas d'itinéraire`).toContain('Aucun itinéraire');
      expect(g.querySelectorAll('[data-testid="itineraire"]'), `${nom} : aucun itinéraire listé`).toHaveLength(0);
      expect(aBouton('Croissance', g), `${nom} : bouton « Croissance »`).toBe(true);
    }
  });

  it('« Croissance » d’une espèce sans itinéraire ouvre son réglage', async () => {
    await rendre();
    const g = groupe(ASPERGE);
    if (g === null) throw new Error('groupe de l’Asperge absent');
    await toucher(bouton('Croissance', g));
    await attendre(() => reglageOuvert(ASPERGE) !== null, 'réglage data-testid="reglage-croissance" de l’Asperge');
  });

  it('une espèce qui a des itinéraires ne dit pas « Aucun itinéraire »', async () => {
    await rendre();
    const g = groupe(ESPECE.chou);
    expect(g).not.toBeNull();
    expect(texte(g)).not.toContain('Aucun itinéraire');
  });

  it('une espèce de la ferme supprimée n’a pas de groupe', async () => {
    await rendre();
    expect(groupe(PIVOINE)).toBeNull();
    expect(groupes().map((g) => texte(g))).not.toContainEqual(expect.stringMatching(/^Pivoine/));
  });

  it('une espèce de la bibliothèque sans itinéraire de la ferme n’a pas de groupe', async () => {
    await rendre();
    expect(groupe(LAITUE)).toBeNull();
    expect(groupe(ESPECE.batavia), 'la Batavia de la bibliothèque, elle, a des itinéraires').not.toBeNull();
  });

  it('une copie personnalisée sans itinéraire (T32g) a son groupe, et son réglage se rouvre', async () => {
    await rendre();
    const g = groupe(BATAVIA_COPIE);
    expect(g, 'groupe de la copie').not.toBeNull();
    if (g === null) return;
    expect(texte(g)).toContain('Aucun itinéraire');
    await toucher(bouton('Croissance', g));
    await attendre(() => reglageOuvert(BATAVIA_COPIE) !== null, 'réglage de la copie');
  });

  it('ordre des groupes : par nom, comme avant (Asperge, Batavia ×2, Chou, Radis), l’id départageant les homonymes', async () => {
    await rendre();
    expect(groupes().map((g) => g.dataset.espece)).toEqual([ASPERGE, ESPECE.batavia, BATAVIA_COPIE, ESPECE.chou, ESPECE.radis]);
  });
});
