// @vitest-environment happy-dom
/**
 * Tests d'acceptation T32c, écran — le réglage du profil de croissance d'une espèce dans l'écran
 * Itinéraires culturaux (Q39) : le gérant règle forme, hauteur et durée, voit la valeur par défaut
 * à côté, la rétablit en un tap ; l'équipier voit le profil en lecture seule (Q35) ; une espèce de
 * la bibliothèque commune aussi, même pour le gérant. Rendu pour de vrai dans un DOM simulé
 * (happy-dom), sur la ferme des itinéraires (./test/ferme-itineraires.ts) complétée d'une tomate,
 * d'une asperge et d'un équipier ; lue et écrite par la porte. Contrat : ./test/contrat-croissance.ts.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { profilParDefaut, type Id } from '@planif/core';
import type { ModuleItineraires } from './test/contrat.ts';
import { TEXTE_ESPECE_BIBLIOTHEQUE, type ProprietesEcranItinerairesCroissance } from './test/contrat-croissance.ts';
import { CREE_LE, ESPECE, FAMILLE, FERME, PARAMETRES, UTILISATEUR } from './test/ferme-itineraires.ts';
import {
  aBouton,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  creerBanc,
  desactive,
  dialogue,
  liste,
  MAINTENANT,
  nomAccessible,
  remplir,
  texte,
  toucher,
  type Banc,
} from './test/outils.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module. */
const CHEMIN_ECRAN = './index.ts';

const id = (n: number) => `0192f0c1-3232-7000-8000-${n.toString(16).padStart(12, '0')}`;
const GERANT = UTILISATEUR;
const EQUIPIER = id(0x1);
const MEMBRE_EQUIPIER = id(0x2);
const TOMATE = id(0x10);
const ASPERGE = id(0x11);
const ITINERAIRE_TOMATE = id(0x20);
const ITINERAIRE_ASPERGE = id(0x21);
/** Batavia : espèce de la bibliothèque commune (ferme_id nul), qui a des itinéraires dans le jeu. */
const BATAVIA_BIBLIOTHEQUE = ESPECE.batavia;
const ECRAN = 'Mes itinéraires';

/** Profil de la tomate réglée par la ferme (1,8 m). */
const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

/** Hauteur par défaut de la tomate, lue dans le cœur (3 m depuis Q33). */
const hauteurTomateDefaut = (): number => profilParDefaut('Tomate').profil.hauteurMaxM;
const enMetres = (n: number): string => `${String(n).replace('.', ',')} m`;

let module: ModuleItineraires;
let banc: Banc;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleItineraires;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  banc = await creerBanc();
  transactions = 0;
  fermetures = 0;
  const r = (sql: string, p: readonly unknown[]) => {
    banc.base.recevoir(sql, p);
  };
  r(`INSERT INTO utilisateur (id, nom, cree_le, modifie_le, supprime_le) VALUES (?, 'Équipier (test)', ?, ?, NULL)`, [EQUIPIER, CREE_LE, CREE_LE]);
  r(
    `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'equipier', 'accepte', NULL, NULL, ?, ?, NULL)`,
    [MEMBRE_EQUIPIER, EQUIPIER, FERME, CREE_LE, CREE_LE],
  );
  const espece = (eid: string, nom: string, perenne: number) => {
    r(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, 'legume', ?, 'kg', NULL, NULL, NULL, ?, ?, NULL)`,
      [eid, FERME, FAMILLE.brassicacees, nom, perenne, CREE_LE, CREE_LE],
    );
  };
  espece(TOMATE, 'Tomate', 0);
  espece(ASPERGE, 'Asperge', 1);
  const itineraire = (iid: string, especeId: string, nom: string) => {
    const p = PARAMETRES.chouAutomne;
    r(
      `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
      [iid, FERME, especeId, nom, String(p.mode), JSON.stringify(p), CREE_LE, CREE_LE],
    );
  };
  itineraire(ITINERAIRE_TOMATE, TOMATE, 'Tomate sous tunnel');
  itineraire(ITINERAIRE_ASPERGE, ASPERGE, 'Asperge verte');
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

const groupe = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="ecran-itineraires"] [data-testid="culture-itineraires"][data-espece="${especeId}"]`);

const reglageOuvert = (especeId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="dialog"][data-testid="reglage-croissance"][data-espece="${especeId}"]`);

/** Rend l'écran Itinéraires pour `utilisateurId`, touche « Croissance » dans le groupe de l'espèce, attend le réglage. */
async function ouvrir(especeId: string, utilisateurId: string = GERANT, nom = 'Tomate'): Promise<HTMLElement> {
  const Ecran = module.EcranItineraires as unknown as (p: ProprietesEcranItinerairesCroissance) => ReactElement;
  await act(async () => {
    racine.render(
      createElement(Ecran, {
        porte: porte(utilisateurId),
        fermeId: FERME,
        utilisateurId,
        surFermer: () => {
          fermetures++;
        },
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(ECRAN) !== undefined, `écran role="dialog" nommé « ${ECRAN} »`);
  await attendre(() => groupe(especeId) !== null, `groupe data-testid="culture-itineraires" de ${nom}`);
  const g = groupe(especeId);
  if (g === null) throw new Error(`groupe de ${nom} absent`);
  await toucher(bouton(/^Croissance/, g));
  await attendre(() => reglageOuvert(especeId) !== null, `réglage role="dialog" data-testid="reglage-croissance" data-espece de ${nom}`);
  const d = reglageOuvert(especeId);
  if (d === null) throw new Error('réglage absent');
  expect(nomAccessible(d), 'nom du réglage : celui de l’espèce').toContain(nom);
  return d;
}

const hauteur = (d: HTMLElement): HTMLInputElement => champ(/^Hauteur maximale/, d);
const duree = (d: HTMLElement): HTMLInputElement => champ(/^Durée/, d);
const forme = (d: HTMLElement): HTMLSelectElement => liste('Forme', d);
const nombre = (valeur: string): number => Number(valeur.replace(',', '.').replace(/\s*m$/, '').trim());

const ligne = (eid: string): Record<string, unknown> | undefined => banc.base.lireDirect<Record<string, unknown>>('SELECT * FROM espece WHERE id = ?', [eid])[0];
const profilDe = (eid: string): unknown => {
  const p = ligne(eid)?.profil_croissance;
  return typeof p === 'string' ? (JSON.parse(p) as unknown) : p;
};

/** Pose le profil de la tomate comme s'il venait du serveur (sans passer par l'écran). */
function tomateReglee(): void {
  banc.base.recevoir('UPDATE espece SET profil_croissance = ? WHERE id = ?', [JSON.stringify(TOMATE_1_8), TOMATE]);
}

/** Ordres d'écriture : seulement des UPDATE espece, rien dans modification, aucune autre colonne. */
function verifierOrdres(depuis: number): void {
  const ordres = banc.base.ecritures.slice(depuis);
  expect(ordres.filter((o) => !/^UPDATE\s+["`]?espece["`]?\s+SET\b/i.test(o)), 'seulement des UPDATE espece').toEqual([]);
  for (const o of ordres) {
    const set = /\bSET\s+([\s\S]*?)\bWHERE\b/i.exec(o)?.[1] ?? '';
    const colonnes = [...set.matchAll(/["`]?(\w+)["`]?\s*=/g)].map((x) => x[1]);
    expect(colonnes.filter((c) => c !== 'profil_croissance' && c !== 'modifie_le'), `colonnes de « ${o} »`).toEqual([]);
  }
}

async function enregistrer(d: HTMLElement): Promise<void> {
  const b = bouton('Enregistrer', d);
  if (!desactive(b)) await toucher(b);
}

// ── Gérant ──────────────────────────────────────────────────────────────────────────────────

describe('T32c : le gérant règle le profil depuis l’écran Itinéraires culturaux (Q39)', () => {
  it('« Croissance » dans le groupe de l’espèce ouvre le réglage ; « Fermer » n’écrit rien et l’écran reste ouvert', async () => {
    const avant = banc.base.ecritures.length;
    const d = await ouvrir(TOMATE);
    expect(d.dataset.espece).toBe(TOMATE);
    await toucher(bouton('Fermer', d));
    await attendre(() => reglageOuvert(TOMATE) === null, 'réglage fermé');
    expect(fermetures, 'l’écran Itinéraires reste ouvert').toBe(0);
    expect(dialogue(ECRAN)).toBeDefined();
    expect(banc.base.ecritures.length).toBe(avant);
  });

  it('chaque groupe d’espèce a son bouton « Croissance » (ferme et bibliothèque)', async () => {
    await ouvrir(TOMATE);
    for (const eid of [TOMATE, ASPERGE, ESPECE.chou, BATAVIA_BIBLIOTHEQUE]) {
      const g = groupe(eid);
      expect(g, `groupe de ${eid}`).not.toBeNull();
      if (g !== null) expect(aBouton(/^Croissance/, g), `bouton « Croissance » dans le groupe ${eid}`).toBe(true);
    }
  });

  it('tomate sans réglage : champs aux valeurs par défaut du cœur (3 m, Q33), la valeur par défaut affichée à côté', async () => {
    const d = await ouvrir(TOMATE);
    const defaut = profilParDefaut('Tomate').profil;
    expect(hauteurTomateDefaut(), 'tomate : 3 m par défaut (Q33)').toBe(3);
    expect(nombre(hauteur(d).value)).toBe(hauteurTomateDefaut());
    expect(forme(d).value).toBe(defaut.forme);
    expect(Number(duree(d).value)).toBe(defaut.duree.en === 'jours' ? defaut.duree.jours : Number.NaN);
    expect(texte(d.querySelector('[data-testid="defaut-hauteur"]'))).toContain(enMetres(hauteurTomateDefaut()));
    expect(texte(d.querySelector('[data-testid="defaut-duree"]'))).toContain(String(defaut.duree.en === 'jours' ? defaut.duree.jours : ''));
    expect(d.querySelector('[data-testid="defaut-forme"]'), 'valeur par défaut de la forme affichée').not.toBeNull();
    const options = [...forme(d).options].map((o) => o.value).sort();
    expect(options).toEqual(['arbre-ou-liane', 'buisson', 'bulbe-ou-racine', 'erige-tuteure', 'rampant', 'rosette', 'touffe']);
    expect(hauteur(d).type, 'champ texte décimal, pas type="number" qui efface « 1,8 »').not.toBe('number');
  });

  it('hauteur 1,8 → Enregistrer : profil écrit par la porte en UNE transaction, hauteur 1,8 m, autres clés du défaut gardées', async () => {
    const d = await ouvrir(TOMATE);
    const avant = banc.base.ecritures.length;
    await remplir(hauteur(d), '1,8');
    transactions = 0;
    await enregistrer(d);
    await attendre(() => profilDe(TOMATE) !== null, 'profil écrit');
    expect(transactions).toBe(1);
    expect(profilDe(TOMATE)).toEqual({ ...profilParDefaut('Tomate').profil, hauteurMaxM: 1.8 });
    expect(ligne(TOMATE)?.modifie_le).toBe(MAINTENANT.toISOString());
    verifierOrdres(avant);
  });

  it('saisie avec le point (« 1.8 ») : même résultat', async () => {
    const d = await ouvrir(TOMATE);
    await remplir(hauteur(d), '1.8');
    await enregistrer(d);
    await attendre(() => profilDe(TOMATE) !== null, 'profil écrit');
    expect((profilDe(TOMATE) as { hauteurMaxM: number }).hauteurMaxM).toBe(1.8);
  });

  it('forme et durée : écrites avec la hauteur', async () => {
    const d = await ouvrir(TOMATE);
    await remplir(forme(d), 'buisson');
    await remplir(duree(d), '75');
    await enregistrer(d);
    await attendre(() => profilDe(TOMATE) !== null, 'profil écrit');
    expect(profilDe(TOMATE)).toMatchObject({ forme: 'buisson', duree: { en: 'jours', jours: 75 }, hauteurMaxM: hauteurTomateDefaut() });
  });

  it('asperge réglée à 1,2 m : la règle de la fougère après récolte est gardée dans le profil écrit', async () => {
    const d = await ouvrir(ASPERGE, GERANT, 'Asperge');
    await remplir(hauteur(d), '1,2');
    await enregistrer(d);
    await attendre(() => profilDe(ASPERGE) !== null, 'profil écrit');
    expect(profilDe(ASPERGE)).toEqual({ ...profilParDefaut('Asperge').profil, hauteurMaxM: 1.2 });
    expect(profilDe(ASPERGE)).toMatchObject({ fougereApresRecolte: true, cycleAnnuel: { repos: '11-15' } });
  });

  it.each([
    ['7', /hauteur/i],
    ['6,5', /hauteur/i],
    ['0', /hauteur/i],
    ['-1', /hauteur/i],
  ])('hauteur « %s » : message en français, rien d’écrit', async (saisie, motif) => {
    const d = await ouvrir(TOMATE);
    const avant = banc.base.ecritures.length;
    await remplir(hauteur(d), saisie);
    await enregistrer(d);
    await attendre(() => [...d.querySelectorAll('[role="alert"]')].some((a) => motif.test(texte(a))), `message role="alert" qui parle de ${motif.source}`);
    expect(banc.base.ecritures.length, 'rien d’écrit').toBe(avant);
    expect(profilDe(TOMATE)).toBeNull();
  });

  it('durée « 0 » : message qui parle de la durée, rien d’écrit', async () => {
    const d = await ouvrir(TOMATE);
    const avant = banc.base.ecritures.length;
    await remplir(duree(d), '0');
    await enregistrer(d);
    await attendre(() => [...d.querySelectorAll('[role="alert"]')].some((a) => /durée/i.test(texte(a))), 'message role="alert" sur la durée');
    expect(banc.base.ecritures.length).toBe(avant);
    expect(profilDe(TOMATE)).toBeNull();
  });

  it('tomate réglée à 1,8 m : champ à 1,8, défaut affiché à côté ; « Rétablir la valeur par défaut » en un tap → profil nul, champ au défaut', async () => {
    tomateReglee();
    const d = await ouvrir(TOMATE);
    expect(nombre(hauteur(d).value)).toBe(1.8);
    expect(texte(d.querySelector('[data-testid="defaut-hauteur"]'))).toContain(enMetres(hauteurTomateDefaut()));
    const avant = banc.base.ecritures.length;
    transactions = 0;
    await toucher(bouton('Rétablir la valeur par défaut', d));
    await attendre(() => ligne(TOMATE)?.profil_croissance === null, 'profil remis à nul');
    expect(transactions, 'un tap, une transaction, sans confirmation').toBe(1);
    verifierOrdres(avant);
    await attendre(() => nombre(hauteur(d).value) === hauteurTomateDefaut(), `champ revenu à ${String(hauteurTomateDefaut())}`);
  });

  it('sans réglage, « Rétablir la valeur par défaut » est absent ou désactivé', async () => {
    const d = await ouvrir(TOMATE);
    if (aBouton('Rétablir la valeur par défaut', d)) expect(desactive(bouton('Rétablir la valeur par défaut', d))).toBe(true);
  });
});

// ── Lecture seule ───────────────────────────────────────────────────────────────────────────

/** Aucun champ modifiable, ni Enregistrer ni Rétablir actifs dans le réglage. */
function lectureSeule(d: HTMLElement): void {
  const modifiables = [...d.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')].filter(
    (c) => !c.disabled && !(c instanceof HTMLInputElement && c.readOnly),
  );
  expect(modifiables.map(nomAccessible), 'aucun champ modifiable').toEqual([]);
  for (const nom of ['Enregistrer', 'Rétablir la valeur par défaut']) {
    if (aBouton(nom, d)) expect(desactive(bouton(nom, d)), `« ${nom} » désactivé`).toBe(true);
  }
}

/** Touche tous les boutons actifs du réglage sauf « Fermer » : rien ne doit s'écrire. */
async function toutToucher(d: HTMLElement): Promise<void> {
  for (const b of [...d.querySelectorAll<HTMLElement>('button, [role="button"]')]) {
    if (nomAccessible(b) !== 'Fermer' && !desactive(b)) await toucher(b);
  }
}

describe('T32c : l’équipier voit le profil en lecture seule (Q35)', () => {
  it('profil réglé (1,8 m) lisible ; aucun champ modifiable ; le réglage dit que seul le gérant le règle', async () => {
    tomateReglee();
    const d = await ouvrir(TOMATE, EQUIPIER);
    lectureSeule(d);
    expect(texte(d)).toContain('1,8 m');
    expect(texte(d)).toMatch(/gérant/i);
  });

  it('profil par défaut lisible, lecture seule aussi', async () => {
    const d = await ouvrir(TOMATE, EQUIPIER);
    lectureSeule(d);
    expect(texte(d)).toContain(enMetres(hauteurTomateDefaut()));
  });

  it('aucune écriture possible : les boutons du réglage ne touchent pas la base', async () => {
    tomateReglee();
    const d = await ouvrir(TOMATE, EQUIPIER);
    const avant = banc.base.ecritures.length;
    await toutToucher(d);
    expect(banc.base.ecritures.length).toBe(avant);
    expect(profilDe(TOMATE)).toEqual(TOMATE_1_8);
  });
});

describe('T32c : espèce de la bibliothèque commune, lecture seule même pour le gérant (Q39)', () => {
  it('Batavia de la bibliothèque : valeurs par défaut lisibles, rien de modifiable, invitation à la personnaliser', async () => {
    const d = await ouvrir(BATAVIA_BIBLIOTHEQUE, GERANT, 'Batavia');
    lectureSeule(d);
    expect(texte(d)).toContain(enMetres(profilParDefaut('Batavia').profil.hauteurMaxM));
    expect(texte(d)).toContain(TEXTE_ESPECE_BIBLIOTHEQUE);
  });

  it('aucune écriture possible sur la ligne de la bibliothèque', async () => {
    const d = await ouvrir(BATAVIA_BIBLIOTHEQUE, GERANT, 'Batavia');
    const avant = banc.base.ecritures.length;
    await toutToucher(d);
    expect(banc.base.ecritures.length).toBe(avant);
    expect(ligne(BATAVIA_BIBLIOTHEQUE)?.profil_croissance ?? null).toBeNull();
  });
});
