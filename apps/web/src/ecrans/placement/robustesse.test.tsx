// @vitest-environment happy-dom
/**
 * Tests de la relecture du chef (T28b) — l'éditeur de placement face aux changements de ferme,
 * aux écritures lentes ou en échec, et aux tuiles qui ne se chargent pas. Contrat : ./test/contrat.ts
 * (« Relecture du chef »). Même banc que ./editeur.test.tsx : base mémoire, vraie porte (T28s).
 *
 *   B1. La ferme active change pendant l'édition (EcranFerme rend l'éditeur sans `key`, et
 *       suivreFermeActive peut basculer à la synchro) : l'éditeur reçoit une autre porte et un
 *       autre fermeId SANS être démonté. Brouillon, « Annuler » et pile Ctrl+Z repartent à vide ;
 *       rien de la ferme A n'est écrit dans la ferme B.
 *   2.  « Fermer » est désactivé tant qu'une écriture est en cours.
 *   3.  Écriture réussie, relecture en échec : message distinct d'un refus, « Annuler » annule.
 *   4.  Annulation refusée : l'enregistrement reste dans la pile, Ctrl+Z réessaie.
 *   5.  Tuiles : une seule en erreur → masquée seule ; toutes en erreur en ligne → fond neutre et
 *       « Photo aérienne indisponible pour le moment » ; hors ligne → message hors ligne.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, desactive, dialogues, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { ecrireFermePlacement, FERME, SERRE, UTILISATEUR } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
/** Seconde ferme du même utilisateur, dans la même base locale : point de départ posé, rien de placé. */
const FERME_B = '0192f0c1-28b0-7000-8000-0000000000b2';
const ORIGINE_B = { latitude: 45.25, longitude: 2.5 };

let m: ModuleEditeur;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

/** Une porte espionnée et pilotable : placer retenu ou en échec, lire en échec. */
interface PorteSuivie {
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
  /** Le prochain appel à placer attend `liberer()`. */
  retenir(): void;
  liberer(): void;
  /** Les `n` prochains appels à placer sont refusés (rien d'écrit). */
  refuser(n: number): void;
  /** Tant que vrai, porte.lire lève une erreur (la base locale ne se relit pas). */
  lectureEnPanne: boolean;
}

function suivre(base: BaseMemoire, fermeId: string): PorteSuivie {
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  let barriere: Promise<void> | null = null;
  let ouvrir: () => void = () => undefined;
  let refus = 0;
  const suivie: PorteSuivie = {
    porte: {
      ...reelle,
      lire: <R,>(sql: string, p?: readonly unknown[]): Promise<R[]> =>
        suivie.lectureEnPanne ? Promise.reject(new Error('lecture impossible (base occupée)')) : reelle.lire<R>(sql, p),
      placer: async (changements) => {
        placements.push(structuredClone(changements));
        if (barriere !== null) {
          const b = barriere;
          barriere = null;
          await b;
        }
        if (refus > 0) {
          refus--;
          throw new Error('Écriture refusée par la base du téléphone.');
        }
        return reelle.placer(changements);
      },
    },
    placements,
    retenir: () => {
      barriere = new Promise<void>((r) => {
        ouvrir = r;
      });
    },
    liberer: () => {
      ouvrir();
    },
    refuser: (n) => {
      refus = n;
    },
    lectureEnPanne: false,
  };
  return suivie;
}

async function creerBase(origineA: boolean): Promise<BaseMemoire> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: origineA });
  base.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites) VALUES (?, 'Ferme B', 'Europe/Paris', ?, ?, '{"longueur":"m","masse":"kg"}')`, [
    FERME_B,
    JSON.stringify(ORIGINE_B),
    JSON.stringify(ORIGINE_B),
  ]);
  base.recevoir(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('mb', ?, ?, 'gerant', 'accepte', NULL)`, [UTILISATEUR, FERME_B]);
  return base;
}

type Ligne = Readonly<Record<string, string | number | null>>;
const lire = (base: BaseMemoire, sql: string, p: readonly unknown[] = []): Ligne[] => base.lireDirect<Ligne>(sql, p);
/** Centre x de la serre M1 en base. */
const xSerre = (): unknown => (base === null ? undefined : lire(base, 'SELECT centre_x_m FROM batiment WHERE id = ?', [SERRE])[0]?.centre_x_m);
const origineDe = (base: BaseMemoire, fermeId: string): unknown => {
  const o = lire(base, 'SELECT origine_plan AS o FROM ferme WHERE id = ?', [fermeId])[0]?.o ?? null;
  return o === null ? null : (JSON.parse(String(o)) as unknown);
};

// ── Rendu ────────────────────────────────────────────────────────────────────────────────────

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire | null = null;
let fermetures = 0;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base?.fermer();
  base = null;
});

async function rendre(p: PorteSuivie, fermeId: string, o: Partial<ProprietesEditeurPlacement> = {}): Promise<void> {
  const proprietes: ProprietesEditeurPlacement = {
    porte: p.porte,
    fermeId,
    utilisateurId: UTILISATEUR,
    surFermer: () => {
      fermetures++;
    },
    ordinateur: true,
    enLigne: true,
    ...o,
  };
  // Même racine, même type de composant, sans `key` : React garde l'instance (comme EcranFerme).
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (editeur()?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
}

const editeur = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.editeur}"]`);
function editeurOuEchec(): HTMLElement {
  const e = editeur();
  if (e === null) throw new Error('éditeur absent');
  return e;
}
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const batiment = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.batiment}"][data-id="${id}"]`);
const confirmation = (motif: RegExp): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && motif.test(texte(d)));
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const messages = (): string[] => [...document.querySelectorAll('[role="alert"], [role="status"]')].map((el) => texte(el));

async function tours(n = 10): Promise<void> {
  for (let k = 0; k < n; k++) await unTour();
}

async function touche(el: Element, key: string, o: { shiftKey?: boolean; ctrlKey?: boolean } = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...o }));
    await Promise.resolve();
  });
  await unTour();
}

async function selectionner(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.focus();
    await Promise.resolve();
  });
  await unTour();
}

/** Déplace la serre M1 de 1 m vers l'est (brouillon). */
async function bougerSerre(): Promise<void> {
  await attendre(() => batiment(SERRE) !== null, 'serre affichée');
  const s = batiment(SERRE);
  if (s === null) return;
  await selectionner(s);
  await touche(s, 'ArrowRight', { shiftKey: true });
}

async function confirmer(motif: RegExp): Promise<void> {
  await attendre(() => confirmation(motif) !== undefined, `confirmation ${String(motif)}`);
  const d = confirmation(motif);
  if (d !== undefined) await toucher(bouton('Confirmer', d));
}

// ── B1 : changement de ferme active pendant l'édition ────────────────────────────────────────

describe('T28b, B1 : la ferme active change sans démonter l’éditeur', () => {
  it('« Annuler » et Ctrl+Z ne rejouent pas dans B l’annulation faite dans A (origine de B intacte)', async () => {
    base = await creerBase(false);
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await toucher(bouton('Utiliser la position de la ferme'));
    await confirmer(/point de départ/i);
    await attendre(() => un(T.annuler) !== null, 'Annuler proposé dans A');

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    await tours();
    expect(un(T.annuler), '« Annuler » de A encore proposé dans B').toBeNull();
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await tours();
    expect(b.placements, 'aucune écriture par la porte de B').toEqual([]);
    expect(origineDe(base, FERME_B)).toEqual(ORIGINE_B);
  });

  it('« Enregistrer » ne crée pas dans B le brouillon fait dans A', async () => {
    base = await creerBase(true);
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await bougerSerre();
    await toucher(bouton('Nouveau bâtiment'));
    const f = dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && texte(d).includes('Nouveau bâtiment'));
    expect(f).toBeDefined();
    expect(a.placements).toEqual([]);

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    await tours();
    expect(tous(T.batiment), 'bâtiments de A affichés dans B').toEqual([]);
    const enregistrer = boutonsNommes(/^Enregistrer$/);
    for (const e of enregistrer) {
      expect(desactive(e), '« Enregistrer » actif dans B avec le brouillon de A').toBe(true);
      await toucher(e);
    }
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await tours();
    expect(b.placements, 'aucune écriture par la porte de B').toEqual([]);
    expect(lire(base, 'SELECT id FROM batiment WHERE ferme_id = ?', [FERME_B])).toEqual([]);
  });

  it('après un enregistrement dans A, passer à B vide la pile : Ctrl+Z n’écrit rien, dans A comme dans B', async () => {
    base = await creerBase(true);
    const a = suivre(base, FERME);
    const b = suivre(base, FERME_B);
    await rendre(a, FERME);
    await bougerSerre();
    await toucher(bouton('Enregistrer'));
    await attendre(() => xSerre() === 41, 'serre écrite dans A');
    const appelsA = a.placements.length;

    await rendre(b, FERME_B);
    await attendre(() => editeurOuEchec().getAttribute('data-origine') === '45.25,2.5', 'éditeur sur la ferme B');
    await tours();
    expect(un(T.annuler)).toBeNull();
    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await tours();
    expect(b.placements).toEqual([]);
    expect(a.placements.length, 'la porte de A n’est plus utilisée').toBe(appelsA);
    expect(xSerre()).toBe(41);
  });
});

// ── 2. Fermer pendant une écriture ───────────────────────────────────────────────────────────

describe('T28b : « Fermer » pendant une écriture', () => {
  it('désactivé tant que l’écriture est en cours, réactivé ensuite', async () => {
    base = await creerBase(true);
    const a = suivre(base, FERME);
    await rendre(a, FERME);
    await bougerSerre();
    a.retenir();
    await toucher(bouton('Enregistrer'));
    await attendre(() => a.placements.length === 1, 'écriture lancée');
    const fermer = bouton(/^(Fermer|Retour)/, editeurOuEchec());
    expect(desactive(fermer), '« Fermer » actif pendant l’écriture').toBe(true);
    await toucher(fermer);
    expect(fermetures).toBe(0);

    a.liberer();
    await attendre(() => !desactive(bouton(/^(Fermer|Retour)/, editeurOuEchec())), '« Fermer » réactivé après l’écriture');
    await toucher(bouton(/^(Fermer|Retour)/, editeurOuEchec()));
    expect(fermetures).toBe(1);
  });
});

// ── 3. Relecture en échec après une écriture réussie ─────────────────────────────────────────

describe('T28b : écriture réussie, relecture en échec', () => {
  it('message distinct d’un refus ; « Annuler » annule bien cette écriture', async () => {
    base = await creerBase(true);
    const a = suivre(base, FERME);
    await rendre(a, FERME);
    await bougerSerre();
    a.lectureEnPanne = true;
    await toucher(bouton('Enregistrer'));
    await attendre(() => xSerre() === 41, 'serre écrite');
    await attendre(() => messages().some((t) => t.includes(MESSAGES_PLACEMENT.enregistreSansRelecture)), `message « ${MESSAGES_PLACEMENT.enregistreSansRelecture} »`);
    const message = messages().find((t) => t.includes(MESSAGES_PLACEMENT.enregistreSansRelecture)) ?? '';
    expect(message).not.toMatch(/refus/i);
    expect(message).not.toMatch(/Rien n.a été/);

    a.lectureEnPanne = false;
    await attendre(() => un(T.annuler) !== null, '« Annuler » proposé');
    const annuler = un(T.annuler);
    if (annuler !== null) await toucher(annuler);
    await attendre(() => xSerre() === 40, 'écriture annulée');
  });
});

// ── 4. Annulation en échec ───────────────────────────────────────────────────────────────────

describe('T28b : annulation refusée', () => {
  it('l’enregistrement reste dans la pile : Ctrl+Z réessaie et annule', async () => {
    base = await creerBase(true);
    const a = suivre(base, FERME);
    await rendre(a, FERME);
    await bougerSerre();
    await toucher(bouton('Enregistrer'));
    await attendre(() => xSerre() === 41, 'serre écrite');
    await attendre(() => un(T.annuler) !== null, '« Annuler » proposé');

    a.refuser(1);
    const annuler = un(T.annuler);
    if (annuler !== null) await toucher(annuler);
    await attendre(() => a.placements.length === 2, 'annulation tentée');
    await tours();
    expect(xSerre()).toBe(41);
    expect(messages().some((t) => t.includes('Écriture refusée')), 'le refus est dit').toBe(true);

    await touche(editeurOuEchec(), 'z', { ctrlKey: true });
    await attendre(() => a.placements.length === 3, 'Ctrl+Z réessaie');
    expect(a.placements[2], 'même annulation rejouée').toEqual(a.placements[1]);
    await attendre(() => xSerre() === 40, 'annulé au second essai');
  });
});

// ── 5. Tuiles en erreur ──────────────────────────────────────────────────────────────────────

/** La tuile est masquée : retirée du DOM, attribut hidden, visibility:hidden ou display:none. */
const masquee = (img: HTMLElement): boolean => !img.isConnected || img.hidden !== false || img.style.visibility === 'hidden' || img.style.display === 'none';

async function erreur(img: HTMLElement): Promise<void> {
  await act(async () => {
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();
  });
}

describe('T28b : tuiles en erreur (relecture du chef)', () => {
  it('une seule tuile en erreur, en ligne : elle seule est masquée, pas de fond neutre ni de message', async () => {
    base = await creerBase(true);
    await rendre(suivre(base, FERME), FERME);
    const tuiles = tous(T.tuile);
    expect(tuiles.length).toBeGreaterThan(1);
    const [premiere, seconde] = tuiles;
    if (premiere === undefined || seconde === undefined) return;
    await erreur(premiere);
    await tours(3);
    expect(editeurOuEchec().getAttribute('data-fond')).toBe('photo');
    expect(un(T.fondNeutre)).toBeNull();
    expect(masquee(premiere), 'tuile en erreur masquée').toBe(true);
    expect(masquee(seconde), 'les autres tuiles restent').toBe(false);
    const t = texte(editeurOuEchec());
    expect(t).not.toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(t).not.toContain(MESSAGES_PLACEMENT.indisponible);
  });

  it('toutes les tuiles en erreur, en ligne : fond neutre et « Photo aérienne indisponible pour le moment »', async () => {
    base = await creerBase(true);
    await rendre(suivre(base, FERME), FERME);
    for (const img of tous(T.tuile)) await erreur(img);
    await attendre(() => editeurOuEchec().getAttribute('data-fond') === 'neutre', 'fond neutre quand toutes les tuiles échouent');
    expect(un(T.fondNeutre)).not.toBeNull();
    const t = texte(editeurOuEchec());
    expect(t).toContain(MESSAGES_PLACEMENT.indisponible);
    expect(t).not.toContain(MESSAGES_PLACEMENT.horsLigne);
  });

  it('hors ligne : fond neutre et message hors ligne (pas « pour le moment »)', async () => {
    base = await creerBase(true);
    await rendre(suivre(base, FERME), FERME, { enLigne: false });
    expect(editeurOuEchec().getAttribute('data-fond')).toBe('neutre');
    const t = texte(editeurOuEchec());
    expect(t).toContain(MESSAGES_PLACEMENT.horsLigne);
    expect(t).not.toContain(MESSAGES_PLACEMENT.indisponible);
  });
});
