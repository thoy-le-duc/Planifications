// @vitest-environment happy-dom
/**
 * Tests d'acceptation T32c, écran — la fiche de l'espèce : le gérant règle forme, hauteur et durée
 * du profil de croissance, voit la valeur par défaut à côté, la rétablit en un tap ; l'équipier
 * voit le profil en lecture seule (Q35). Rendu pour de vrai dans un DOM simulé (happy-dom), sur
 * une base mémoire de @planif/sync lue et écrite par la porte. Contrat : ./test/contrat.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { profilParDefaut, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { aBouton, attendre, bouton, champ, desactive, dialogue, liste, nomAccessible, region, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { chargerFicheEspece, MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE, type ModuleFicheEspece } from './test/contrat.ts';

const GERANT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b10';
const EQUIPIER = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b11';
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b20';
const FAMILLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b30';
const TOMATE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b40';
const ASPERGE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b41';
const TOMATE_REGLEE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b42';
const BATAVIA_BIBLIOTHEQUE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c8b43';
const CREE = '2026-10-01T08:00:00.000Z';
const MAINTENANT = new Date('2026-10-10T06:00:00.000Z');

/** Profil de la tomate réglée par la ferme (1,8 m). */
const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

/** Hauteur par défaut de la tomate, lue dans le cœur (3 m depuis Q33 ; le ticket dit 2 m). */
const hauteurTomateDefaut = (): number => profilParDefaut('Tomate').profil.hauteurMaxM;
const enMetres = (n: number): string => `${String(n).replace('.', ',')} m`;

let module: ModuleFicheEspece;
let base: BaseMemoire;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;

beforeAll(async () => {
  module = await chargerFicheEspece();
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  transactions = 0;
  fermetures = 0;
  const r = (sql: string, p: readonly unknown[]) => {
    base.recevoir(sql, p);
  };
  r(`INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, modifie_le) VALUES (?, 'Jardins de Garonne', 'Europe/Paris', ?, ?)`, [FERME, CREE, CREE]);
  r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
  r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m2', ?, ?, 'equipier', 'accepte', NULL)`, [EQUIPIER, FERME]);
  r(`INSERT INTO famille (id, ferme_id, nom, cree_le, modifie_le) VALUES (?, ?, 'Solanacées', ?, ?)`, [FAMILLE, FERME, CREE, CREE]);
  const espece = (id: string, ferme: string | null, nom: string, perenne: number, profil: string | null) => {
    r(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, 'legume', ?, 'kg', ?, ?, ?, NULL)`,
      [id, ferme, FAMILLE, nom, perenne, profil, CREE, CREE],
    );
  };
  espece(TOMATE, FERME, 'Tomate', 0, null);
  espece(ASPERGE, FERME, 'Asperge', 1, null);
  espece(TOMATE_REGLEE, FERME, 'Tomate', 0, JSON.stringify(TOMATE_1_8));
  espece(BATAVIA_BIBLIOTHEQUE, null, 'Batavia', 0, null);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

function porte(utilisateurId: string): PorteDonnees {
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

/** Rend la fiche de `especeId` pour `utilisateurId` et attend la région « Croissance ». */
async function ouvrir(especeId: string, utilisateurId: string = GERANT, nom = 'Tomate'): Promise<HTMLElement> {
  await act(async () => {
    racine.render(
      createElement(module.FicheEspece, {
        porte: porte(utilisateurId),
        fermeId: FERME,
        utilisateurId,
        especeId,
        surFermer: () => {
          fermetures++;
        },
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(nom) !== undefined, `fiche role="dialog" dont le nom commence par « ${nom} »`);
  const d = dialogue(nom);
  if (d === undefined) throw new Error('fiche absente');
  await attendre(() => croissanceDessinee(d), 'région « Croissance » dessinée');
  return d;
}

function croissanceDessinee(d: HTMLElement): boolean {
  return [...d.querySelectorAll('[role="region"], section[aria-label], section[aria-labelledby]')].some((x) => nomAccessible(x) === 'Croissance');
}

const croissance = (d: HTMLElement): HTMLElement => region('Croissance', d);
const hauteur = (d: HTMLElement): HTMLInputElement => champ(/^Hauteur maximale/, croissance(d));
const duree = (d: HTMLElement): HTMLInputElement => champ(/^Durée/, croissance(d));
const forme = (d: HTMLElement): HTMLSelectElement => liste('Forme', croissance(d));
const nombre = (valeur: string): number => Number(valeur.replace(',', '.').replace(/\s*m$/, '').trim());

const ligne = (id: string): Record<string, unknown> | undefined => base.lireDirect<Record<string, unknown>>('SELECT * FROM espece WHERE id = ?', [id])[0];
const profilDe = (id: string): unknown => {
  const p = ligne(id)?.profil_croissance;
  return typeof p === 'string' ? (JSON.parse(p) as unknown) : p;
};

/** Ordres d'écriture : seulement des UPDATE espece, rien dans modification, aucune autre colonne. */
function verifierOrdres(depuis: number): void {
  const ordres = base.ecritures.slice(depuis);
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

describe('T32c : le gérant règle le profil depuis la fiche de l’espèce', () => {
  it('fiche nommée par l’espèce, marque de performance posée une fois, « Fermer » n’écrit rien', async () => {
    performance.clearMarks(MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE);
    expect(module.MARQUE_FICHE_ESPECE_AFFICHEE).toBe(MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE);
    const d = await ouvrir(TOMATE);
    expect(d.dataset.testid).toBe('fiche-espece');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(performance.getEntriesByName(MARQUE_FICHE_ESPECE_AFFICHEE_ATTENDUE, 'mark')).toHaveLength(1);
    const avant = base.ecritures.length;
    await toucher(bouton('Fermer', d));
    expect(fermetures).toBe(1);
    expect(base.ecritures.length).toBe(avant);
  });

  it('tomate sans réglage : champs aux valeurs par défaut du cœur, la valeur par défaut affichée à côté', async () => {
    const d = await ouvrir(TOMATE);
    const defaut = profilParDefaut('Tomate').profil;
    expect(nombre(hauteur(d).value)).toBe(hauteurTomateDefaut());
    expect(forme(d).value).toBe(defaut.forme);
    expect(Number(duree(d).value)).toBe(defaut.duree.en === 'jours' ? defaut.duree.jours : Number.NaN);
    const r = croissance(d);
    expect(texte(r.querySelector('[data-testid="defaut-hauteur"]'))).toContain(enMetres(hauteurTomateDefaut()));
    expect(texte(r.querySelector('[data-testid="defaut-duree"]'))).toContain(String(defaut.duree.en === 'jours' ? defaut.duree.jours : ''));
    expect(r.querySelector('[data-testid="defaut-forme"]'), 'valeur par défaut de la forme affichée').not.toBeNull();
    const options = [...forme(d).options].map((o) => o.value).sort();
    expect(options).toEqual(['arbre-ou-liane', 'buisson', 'bulbe-ou-racine', 'erige-tuteure', 'rampant', 'rosette', 'touffe']);
  });

  it('hauteur 1,8 → Enregistrer : profil écrit par la porte en UNE transaction, hauteur 1,8 m, autres clés du défaut gardées', async () => {
    const d = await ouvrir(TOMATE);
    const avant = base.ecritures.length;
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
    const avant = base.ecritures.length;
    await remplir(hauteur(d), saisie);
    await enregistrer(d);
    await attendre(() => [...d.querySelectorAll('[role="alert"]')].some((a) => motif.test(texte(a))), `message role="alert" qui parle de ${motif.source}`);
    expect(base.ecritures.length, 'rien d’écrit').toBe(avant);
    expect(profilDe(TOMATE)).toBeNull();
  });

  it('durée « 0 » : message qui parle de la durée, rien d’écrit', async () => {
    const d = await ouvrir(TOMATE);
    const avant = base.ecritures.length;
    await remplir(duree(d), '0');
    await enregistrer(d);
    await attendre(() => [...d.querySelectorAll('[role="alert"]')].some((a) => /durée/i.test(texte(a))), 'message role="alert" sur la durée');
    expect(base.ecritures.length).toBe(avant);
  });

  it('tomate réglée à 1,8 m : champ à 1,8, défaut affiché à côté ; « Rétablir la valeur par défaut » en un tap → profil nul, champ au défaut', async () => {
    const d = await ouvrir(TOMATE_REGLEE);
    expect(nombre(hauteur(d).value)).toBe(1.8);
    expect(texte(croissance(d).querySelector('[data-testid="defaut-hauteur"]'))).toContain(enMetres(hauteurTomateDefaut()));
    const avant = base.ecritures.length;
    transactions = 0;
    await toucher(bouton('Rétablir la valeur par défaut', d));
    await attendre(() => ligne(TOMATE_REGLEE)?.profil_croissance === null, 'profil remis à nul');
    expect(transactions, 'un tap, une transaction, sans confirmation').toBe(1);
    verifierOrdres(avant);
    await attendre(() => nombre(hauteur(d).value) === hauteurTomateDefaut(), `champ revenu à ${String(hauteurTomateDefaut())}`);
  });

  it('sans réglage, « Rétablir la valeur par défaut » est absent ou désactivé', async () => {
    const d = await ouvrir(TOMATE);
    const r = croissance(d);
    if (aBouton('Rétablir la valeur par défaut', r)) expect(desactive(bouton('Rétablir la valeur par défaut', r))).toBe(true);
  });
});

// ── Lecture seule ───────────────────────────────────────────────────────────────────────────

/** Aucun champ modifiable, ni Enregistrer ni Rétablir actifs dans la région. */
function lectureSeule(d: HTMLElement): void {
  const r = croissance(d);
  const modifiables = [...r.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')].filter(
    (c) => !c.disabled && !(c instanceof HTMLInputElement && c.readOnly),
  );
  expect(modifiables.map(nomAccessible), 'aucun champ modifiable').toEqual([]);
  for (const nom of ['Enregistrer', 'Rétablir la valeur par défaut']) {
    if (aBouton(nom, d)) expect(desactive(bouton(nom, d)), `« ${nom} » désactivé`).toBe(true);
  }
}

describe('T32c : l’équipier voit le profil en lecture seule (Q35)', () => {
  it('profil réglé (1,8 m) lisible ; aucun champ modifiable ; la fiche dit que seul le gérant le règle', async () => {
    const d = await ouvrir(TOMATE_REGLEE, EQUIPIER);
    lectureSeule(d);
    expect(texte(croissance(d))).toContain('1,8 m');
    expect(texte(croissance(d))).toMatch(/gérant/i);
  });

  it('profil par défaut lisible, lecture seule aussi', async () => {
    const d = await ouvrir(TOMATE, EQUIPIER);
    lectureSeule(d);
    expect(texte(croissance(d))).toContain(enMetres(hauteurTomateDefaut()));
  });

  it('aucune écriture possible : les boutons de la fiche ne touchent pas la base', async () => {
    const d = await ouvrir(TOMATE_REGLEE, EQUIPIER);
    const avant = base.ecritures.length;
    for (const b of [...croissance(d).querySelectorAll<HTMLElement>('button, [role="button"]')]) if (!desactive(b)) await toucher(b);
    expect(base.ecritures.length).toBe(avant);
    expect(profilDe(TOMATE_REGLEE)).toEqual(TOMATE_1_8);
  });
});

describe('T32c : espèce de la bibliothèque commune, lecture seule même pour le gérant', () => {
  it('Batavia de la bibliothèque : valeurs par défaut lisibles, rien de modifiable', async () => {
    const d = await ouvrir(BATAVIA_BIBLIOTHEQUE, GERANT, 'Batavia');
    lectureSeule(d);
    expect(texte(croissance(d))).toContain(enMetres(profilParDefaut('Batavia').profil.hauteurMaxM));
  });
});
