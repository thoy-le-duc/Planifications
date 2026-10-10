// @vitest-environment happy-dom
/**
 * Tests d'acceptation T32g, écran — « Personnaliser » une espèce de la bibliothèque commune dans
 * l'écran Itinéraires culturaux (Q39) : le gérant en fait une copie propre à sa ferme, dont le
 * réglage de croissance s'ouvre aussitôt ; les cultures existantes restent liées à l'espèce
 * d'origine ; l'équipier ne voit pas le bouton. Plus la suite de la relecture T32c : « Enregistrer »
 * sans rien changer n'écrit rien. Rendu pour de vrai dans un DOM simulé (happy-dom), sur la ferme
 * des itinéraires (./test/ferme-itineraires.ts : la Batavia y est de la bibliothèque) complétée
 * d'une tomate de la ferme et d'un équipier ; lue et écrite par la porte.
 * Contrats : ./test/contrat-personnaliser.ts, ./test/contrat-croissance.ts.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { profilParDefaut, type Id } from '@planif/core';
import type { ModuleItineraires } from './test/contrat.ts';
import type { ProprietesEcranItinerairesCroissance } from './test/contrat-croissance.ts';
import { MOTIF_CULTURES_RESTENT } from './test/contrat-personnaliser.ts';
import { CREE_LE, ESPECE, FAMILLE, FERME, ITINERAIRE, PARAMETRES, SERIE, UTILISATEUR } from './test/ferme-itineraires.ts';
import { aBouton, attendre, AUJOURDHUI, bouton, boutons, champ, creerBanc, desactive, dialogue, MAINTENANT, nomAccessible, remplir, texte, toucher, unTour, type Banc } from './test/outils.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module. */
const CHEMIN_ECRAN = './index.ts';

const id = (n: number) => `0192f0c1-3233-7000-8000-${n.toString(16).padStart(12, '0')}`;
const GERANT = UTILISATEUR;
const EQUIPIER = id(0x1);
const MEMBRE_EQUIPIER = id(0x2);
const TOMATE = id(0x10);
const ITINERAIRE_TOMATE = id(0x20);
/** Batavia : espèce de la bibliothèque commune (ferme_id nul), qui a des itinéraires et des séries dans le jeu. */
const BATAVIA = ESPECE.batavia;
const ECRAN = 'Mes itinéraires';
const PERSONNALISER = /^Personnaliser/;

let module: ModuleItineraires;
let banc: Banc;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleItineraires;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  banc = await creerBanc();
  transactions = 0;
  const r = (sql: string, p: readonly unknown[]) => {
    banc.base.recevoir(sql, p);
  };
  r(`INSERT INTO utilisateur (id, nom, cree_le, modifie_le, supprime_le) VALUES (?, 'Équipier (test)', ?, ?, NULL)`, [EQUIPIER, CREE_LE, CREE_LE]);
  r(
    `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'equipier', 'accepte', NULL, NULL, ?, ?, NULL)`,
    [MEMBRE_EQUIPIER, EQUIPIER, FERME, CREE_LE, CREE_LE],
  );
  r(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'Tomate', 'legume', 0, 'kg', NULL, NULL, NULL, ?, ?, NULL)`,
    [TOMATE, FERME, FAMILLE.brassicacees, CREE_LE, CREE_LE],
  );
  const p = PARAMETRES.chouAutomne;
  r(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, NULL, 'Tomate sous tunnel', ?, ?, ?, ?, NULL)`,
    [ITINERAIRE_TOMATE, FERME, TOMATE, String(p.mode), JSON.stringify(p), CREE_LE, CREE_LE],
  );
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

/** Porte de `utilisateurId` sur la base du banc, qui compte les transactions. */
function porte(utilisateurId: string): PorteDonnees {
  const base = banc.base;
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  return creerPorte(compteuse, { utilisateurId: utilisateurId as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
}

const ecran = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="ecran-itineraires"]');

const groupe = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="ecran-itineraires"] [data-testid="culture-itineraires"][data-espece="${especeId}"]`);

const reglageOuvert = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="dialog"][data-testid="reglage-croissance"][data-espece="${especeId}"]`);

/** Rend l'écran Itinéraires pour `utilisateurId` et attend les groupes de la Batavia et de la Tomate. */
async function rendre(utilisateurId: string = GERANT): Promise<void> {
  const Ecran = module.EcranItineraires as unknown as (p: ProprietesEcranItinerairesCroissance) => ReactElement;
  await act(async () => {
    racine.render(
      createElement(Ecran, {
        porte: porte(utilisateurId),
        fermeId: FERME,
        utilisateurId,
        surFermer: () => undefined,
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(ECRAN) !== undefined, `écran role="dialog" nommé « ${ECRAN} »`);
  await attendre(() => groupe(BATAVIA) !== null && groupe(TOMATE) !== null, 'groupes data-testid="culture-itineraires" de la Batavia et de la Tomate');
}

type Ligne = Record<string, unknown>;
const lire = (sql: string, p: readonly unknown[] = []): Ligne[] => banc.base.lireDirect<Ligne>(sql, p);
const ligne = (eid: string): Ligne | undefined => lire('SELECT * FROM espece WHERE id = ?', [eid])[0];
const profilDe = (eid: string): unknown => {
  const p = ligne(eid)?.profil_croissance;
  return typeof p === 'string' ? (JSON.parse(p) as unknown) : p;
};
/** Les copies « Batavia » de la ferme, non supprimées. */
const copies = (): Ligne[] => lire('SELECT * FROM espece WHERE ferme_id = ? AND nom = ? AND supprime_le IS NULL ORDER BY id', [FERME, 'Batavia']);
const alertes = (): string[] => [...document.querySelectorAll('[role="alert"]')].map((a) => texte(a));

/** Touche « Personnaliser » dans le groupe de la Batavia, attend la copie et son réglage ; rend l'id de la copie. */
async function personnaliserBatavia(): Promise<{ copie: string; reglage: HTMLElement }> {
  const g = groupe(BATAVIA);
  if (g === null) throw new Error('groupe de la Batavia absent');
  await toucher(bouton(PERSONNALISER, g));
  await attendre(() => copies().length === 1, 'copie « Batavia » écrite dans la ferme');
  const copie = String(copies()[0]?.id);
  await attendre(() => reglageOuvert(copie) !== null, 'réglage role="dialog" data-testid="reglage-croissance" de la copie');
  const reglage = reglageOuvert(copie);
  if (reglage === null) throw new Error('réglage de la copie absent');
  return { copie, reglage };
}

// ── Le gérant personnalise ──────────────────────────────────────────────────────────────────

describe('T32g : « Personnaliser » une espèce de la bibliothèque (gérant, Q39)', () => {
  it('bouton « Personnaliser » dans le groupe de la Batavia (bibliothèque), pas dans ceux des espèces de la ferme', async () => {
    await rendre();
    const batavia = groupe(BATAVIA);
    expect(batavia).not.toBeNull();
    if (batavia !== null) expect(aBouton(PERSONNALISER, batavia), 'Batavia de la bibliothèque').toBe(true);
    for (const eid of [TOMATE, ESPECE.chou]) {
      const g = groupe(eid);
      expect(g, `groupe de ${eid}`).not.toBeNull();
      if (g !== null) expect(aBouton(PERSONNALISER, g), `espèce de la ferme ${eid} : pas de « Personnaliser »`).toBe(false);
    }
  });

  it('un tap : une transaction, un INSERT espece ; une « Batavia » de la ferme à profil nul ; son réglage s’ouvre en mode réglage, aux valeurs par défaut', async () => {
    await rendre();
    const avant = banc.base.ecritures.length;
    transactions = 0;
    const { copie, reglage } = await personnaliserBatavia();
    expect(transactions, 'une seule transaction').toBe(1);
    const ordres = banc.base.ecritures.slice(avant);
    expect(ordres).toHaveLength(1);
    expect(ordres[0]).toMatch(/^INSERT\s+INTO\s+["`]?espece["`]?\s*\(/i);
    expect(copie).not.toBe(BATAVIA);
    expect(ligne(copie)).toMatchObject({ ferme_id: FERME, nom: 'Batavia', famille_id: FAMILLE.asteracees, supprime_le: null });
    expect(ligne(copie)?.profil_croissance, 'profil nul : le défaut n’est pas figé').toBeNull();
    expect(nomAccessible(reglage), 'nom du réglage : celui de l’espèce').toContain('Batavia');
    const h = champ(/^Hauteur maximale/, reglage);
    expect(h.disabled || h.readOnly, 'copie de la ferme, gérant : champ modifiable').toBe(false);
    expect(Number(h.value.replace(',', '.')), 'hauteur par défaut de la Batavia').toBe(profilParDefaut('Batavia').profil.hauteurMaxM);
    if (aBouton('Rétablir la valeur par défaut', reglage)) expect(desactive(bouton('Rétablir la valeur par défaut', reglage)), 'rien à rétablir').toBe(true);
    expect(desactive(bouton('Enregistrer', reglage)), '« Enregistrer » actif').toBe(false);
  });

  it('le réglage de la copie dit en une phrase que les cultures existantes restent liées à l’espèce d’origine', async () => {
    await rendre();
    const { reglage } = await personnaliserBatavia();
    expect(texte(reglage)).toMatch(MOTIF_CULTURES_RESTENT);
  });

  it('itinéraires, séries et l’espèce d’origine inchangés : toujours liés à la Batavia de la bibliothèque', async () => {
    await rendre();
    const avant = {
      origine: ligne(BATAVIA),
      itineraires: lire('SELECT * FROM itineraire ORDER BY id'),
      series: lire('SELECT * FROM serie ORDER BY id'),
      occupations: lire('SELECT * FROM occupation ORDER BY id'),
    };
    await personnaliserBatavia();
    expect(ligne(BATAVIA)).toEqual(avant.origine);
    expect(lire('SELECT * FROM itineraire ORDER BY id')).toEqual(avant.itineraires);
    expect(lire('SELECT * FROM serie ORDER BY id')).toEqual(avant.series);
    expect(lire('SELECT * FROM occupation ORDER BY id')).toEqual(avant.occupations);
    for (const iid of [ITINERAIRE.batavia, ITINERAIRE.bataviaFerme]) expect(lire('SELECT espece_id FROM itineraire WHERE id = ?', [iid])[0]?.espece_id).toBe(BATAVIA);
    expect(lire('SELECT espece_id FROM serie WHERE id = ?', [SERIE.aVenir1])[0]?.espece_id).toBe(BATAVIA);
  });

  it('la copie est réglable aussitôt : hauteur 0,2 → Enregistrer écrit le profil de la copie, pas celui de la bibliothèque', async () => {
    await rendre();
    const { copie, reglage } = await personnaliserBatavia();
    await remplir(champ(/^Hauteur maximale/, reglage), '0,2');
    await toucher(bouton('Enregistrer', reglage));
    await attendre(() => (profilDe(copie) as { hauteurMaxM?: number } | null)?.hauteurMaxM === 0.2, 'profil de la copie à 0,2 m');
    expect(profilDe(copie)).toEqual({ ...profilParDefaut('Batavia').profil, hauteurMaxM: 0.2 });
    expect(ligne(BATAVIA)?.profil_croissance ?? null, 'la bibliothèque n’a toujours pas de profil').toBeNull();
  });

  it('deuxième personnalisation de la Batavia : rien d’écrit, « Batavia est déjà personnalisée »', async () => {
    await rendre();
    const { reglage } = await personnaliserBatavia();
    await toucher(bouton('Fermer', reglage));
    await attendre(() => document.querySelector('[data-testid="reglage-croissance"]') === null, 'réglage fermé');
    const g = groupe(BATAVIA);
    if (g === null) throw new Error('groupe de la Batavia absent');
    const avant = banc.base.ecritures.length;
    const actif = boutons(g).find((b) => nomAccessible(b).startsWith('Personnaliser') && !desactive(b));
    if (actif === undefined) {
      expect(texte(g), 'bouton retiré ou désactivé : le groupe le dit').toMatch(/déjà personnalisée/i);
    } else {
      await toucher(actif);
      await attendre(() => alertes().some((a) => a.includes('Batavia est déjà personnalisée')), 'message role="alert" « Batavia est déjà personnalisée »');
    }
    expect(banc.base.ecritures.length, 'rien d’écrit').toBe(avant);
    expect(copies()).toHaveLength(1);
  });
});

// ── L'équipier ──────────────────────────────────────────────────────────────────────────────

describe('T32g : l’équipier ne personnalise pas (Q35, Q39)', () => {
  it('aucun bouton « Personnaliser » dans l’écran ; l’espèce de la bibliothèque reste seule', async () => {
    await rendre(EQUIPIER);
    const e = ecran();
    expect(e).not.toBeNull();
    if (e !== null) expect(aBouton(PERSONNALISER, e), 'aucun « Personnaliser » pour l’équipier').toBe(false);
    expect(copies()).toHaveLength(0);
  });
});

// ── Suite de la relecture T32c : « Enregistrer » sans rien changer ──────────────────────────

describe('T32g (suite T32c) : « Enregistrer » sans rien changer, sur une espèce sans profil, n’écrit rien', () => {
  it('tomate de la ferme sans profil : Enregistrer sans toucher aux champs → aucune écriture, profil toujours nul', async () => {
    await rendre();
    const g = groupe(TOMATE);
    if (g === null) throw new Error('groupe de la Tomate absent');
    await toucher(bouton(/^Croissance/, g));
    await attendre(() => reglageOuvert(TOMATE) !== null, 'réglage de la Tomate');
    const reglage = reglageOuvert(TOMATE);
    if (reglage === null) throw new Error('réglage absent');
    const avant = banc.base.ecritures.length;
    transactions = 0;
    const enregistrer = bouton('Enregistrer', reglage);
    if (!desactive(enregistrer)) await toucher(enregistrer);
    // Fin du geste : le réglage se ferme, ou dit pourquoi rien n'est écrit (« ou le signaler »).
    await attendre(
      () => reglageOuvert(TOMATE) === null || reglage.querySelector('[role="alert"], [role="status"]') !== null,
      'réglage fermé, ou message dans le réglage',
    );
    for (let i = 0; i < 10; i++) await unTour();
    expect(banc.base.ecritures.length, 'aucun ordre d’écriture').toBe(avant);
    expect(transactions, 'aucune transaction').toBe(0);
    expect(ligne(TOMATE)?.profil_croissance, 'le défaut n’est pas figé en profil de la ferme').toBeNull();
  });
});
