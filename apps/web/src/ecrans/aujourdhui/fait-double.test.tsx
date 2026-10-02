// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13e — « Fait » en double sur une relecture tardive, dans un DOM simulé
 * (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts) lue et écrite par la porte (base
 * mémoire), aujourd'hui = 2026-09-30. Mêmes outils que suites.test.tsx.
 *
 *   D1  Une relecture complète lance sa lecture du journal AVANT l'écriture du « Fait » et livre sa
 *       journée APRÈS (la porte de test retient la fin de la lecture). La journée livrée ne contient
 *       pas encore le réalisé : la tâche doit rester masquée, et un second tap sur « Fait » (si le
 *       bouton est encore là) n'écrit rien : un seul réalisé dans le journal. Avant T13e, la
 *       journée livrée fait tomber le masque : la tâche réapparaît et le second tap écrit un deuxième
 *       réalisé.
 *   D2  Témoin (T13c) : réalisé annulé depuis un autre téléphone, « Fait » redevient possible.
 *   D3  Témoin : sans relecture tardive, la tâche faite est masquée puis retirée par la journée relue.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { cleTache, ecrireFermeDuJour, EVENEMENT, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable, comme ecran.test.tsx. */
const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Base, porte à lectures retenues ──────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly horodatage: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly [colonne: string]: unknown;
}

/** Une porte que le test ouvre à la main. */
interface Barriere {
  /** Résolue quand une lecture est arrivée à la barrière. */
  readonly atteinte: Promise<void>;
  /** Libère les lectures retenues (et celles qui suivront). */
  readonly ouvrir: () => void;
}

function barriere(): { b: Barriere; passer: () => Promise<void>; nombre: () => number } {
  let ouvrir: () => void = () => undefined;
  let signaler: () => void = () => undefined;
  const ouverte = new Promise<void>((r) => {
    ouvrir = r;
  });
  const atteinte = new Promise<void>((r) => {
    signaler = r;
  });
  let n = 0;
  return {
    b: { atteinte, ouvrir },
    passer: () => {
      n++;
      signaler();
      return ouverte;
    },
    nombre: () => n,
  };
}

let base: BaseMemoire;
let porte: PorteDonnees;
let evenementsAvant = new Set<string>();
/**
 * Barrières posées par le test. `journal` retient la fin de la PREMIÈRE lecture de « récents »
 * (la dernière requête sur le journal d'une relecture complète) qui la rencontre : la lecture a
 * alors vu le journal tel qu'il est avant le « Fait ». `suivante` retient le début de toute
 * relecture qui commence ensuite (lecture des réalisés des séries), pour que le test observe la journée tardive
 * avant que la relecture suivante ne la corrige.
 */
let retenirJournal: ReturnType<typeof barriere> | null = null;
let retenirSuivante: ReturnType<typeof barriere> | null = null;

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));

function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

let compteurRecus = 0;
const idRecu = () => `0192f0c1-13c0-7000-8000-0000000b${(++compteurRecus).toString(16).padStart(4, '0')}`;

/** Annulation de `cible` saisie sur un autre téléphone et reçue par la synchro (comme suites.test.tsx). */
function annulationRecue(cible: LigneEvenement): void {
  const origine = typeof cible.origine_id === 'string' && cible.origine_id !== '' ? cible.origine_id : (cible.remplace_evenement_id ?? cible.id);
  const ligne: Record<string, unknown> = {
    ...cible,
    id: idRecu(),
    horodatage: new Date(Date.parse(cible.horodatage) + 60_000).toISOString(),
    cree_le: new Date(Date.parse(cible.horodatage) + 61_000).toISOString(),
    remplace_sorte: 'annulation',
    remplace_evenement_id: cible.id,
    origine_id: origine,
  };
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`,
    c.map((k) => {
      const v = ligne[k];
      return v === undefined ? null : v;
    }),
  );
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  retenirJournal = null;
  retenirSuivante = null;
  const vraie = creerPorte(base, {
    utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
    fermeId: FERME as Id<'Ferme'>,
  });
  porte = {
    ...vraie,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]) => {
      if (retenirSuivante !== null && sql.includes('SELECT e.serie_id, \'recolte\' AS type, NULL AS etape')) await retenirSuivante.passer();
      const lignes = await vraie.lire<T>(sql, parametres);
      // « Récents » : lu APRÈS les réalisés, retenu APRÈS lecture (le journal est déjà vu).
      if (retenirJournal !== null && sql.includes('SELECT e.id, e.type, e.date, e.horodatage')) {
        const r = retenirJournal;
        retenirJournal = null;
        await r.passer();
      }
      return lignes;
    },
  };
  remiseAZero();
});

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

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
  base.fermer();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, tours = 200): Promise<void> {
  for (let k = 0; k < tours && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null)
    return par
      .split(/\s+/)
      .map((i) => texte(document.getElementById(i)))
      .join(' ')
      .trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    return texte(lie ?? el.closest('label'));
  }
  return texte(el);
}

const boutons = (dans: ParentNode = conteneur): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const b = boutons(dans).find((x) => (typeof nom === 'string' ? nomAccessible(x) === nom : nom.test(nomAccessible(x))));
  expect(b, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeDefined();
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.focus();
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);

function tacheOuEchec(cle: string): HTMLElement {
  const t = tache(cle);
  expect(
    t,
    `tâche ${cle} affichée (affichées : ${taches()
      .map((x) => String(x.dataset.cle))
      .join(', ')})`,
  ).toBeDefined();
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t;
}

const CHOU = cleTache(SERIE.chou, 'plantation');
const boutonFait = (): HTMLElement | undefined => {
  const t = tache(CHOU);
  return t === undefined ? undefined : boutons(t).find((x) => nomAccessible(x).startsWith("Marquer fait"));
};
const realisesChou = (): LigneEvenement[] => nouveauxEvenements().filter((e) => e.type === 'realise' && e.remplace_sorte === null && e.serie_id === SERIE.chou);

/** Quelques tours pour laisser passer les relectures déjà en route. */
async function tours(n = 15): Promise<void> {
  for (let k = 0; k < n; k++) await unTour();
}

describe('T13e, « Fait » en double sur une relecture tardive', () => {
  it('D1 : relecture complète lue avant le « Fait » et livrée après : la tâche reste masquée, un second tap n’écrit rien', async () => {
    await rendre();
    await tours(); // l'écran est au repos

    // Une synchro apporte une ligne sans rapport avec le chou : relecture complète, retenue juste
    // avant sa livraison (elle a lu le journal sans le « Fait »).
    const gel = barriere();
    retenirJournal = gel;
    const recolte = evenements().find((x) => x.id === EVENEMENT.recolteTomate1);
    if (recolte === undefined) throw new Error('récolte de tomates absente');
    annulationRecue(recolte);
    await gel.b.atteinte;

    // « Fait » pendant que la relecture est retenue : écriture, masque.
    remiseAZero();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
    await attendre(() => realisesChou().length === 1, 'réalisé écrit');
    expect(tache(CHOU), 'tâche masquée dès le « Fait »').toBeUndefined();

    // La relecture en retard livre sa journée (sans le réalisé) ; la suivante est retenue au départ.
    const suivante = barriere();
    retenirSuivante = suivante;
    gel.b.ouvrir();
    await tours();
        expect(tache(CHOU), 'journée livrée sans le réalisé : la tâche reste masquée').toBeUndefined();

    // Second tap (si le bouton est encore là) : rien de plus n'est écrit.
    const b = boutonFait();
    if (b !== undefined) await toucher(b);
    await tours();
    expect(realisesChou(), 'un seul réalisé pour la tâche').toHaveLength(1);

    // La relecture suivante voit le réalisé : la tâche reste retirée, toujours un seul réalisé.
    suivante.b.ouvrir();
    await tours();
    expect(tache(CHOU)).toBeUndefined();
    expect(realisesChou()).toHaveLength(1);
  });

  it('D2, témoin (T13c) : réalisé annulé depuis un autre téléphone, « Fait » redevient possible et écrit un nouveau réalisé', async () => {
    await rendre();
    remiseAZero();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
    await attendre(() => realisesChou().length === 1, 'réalisé écrit');
    const fait = realisesChou()[0];
    if (fait === undefined) throw new Error('réalisé absent');
    await attendre(() => tache(CHOU) === undefined, 'la plantation du chou quitte la liste');

    annulationRecue(fait);
    await attendre(() => tache(CHOU) !== undefined, 'journée relue : la plantation du chou revient');

    await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
    await attendre(() => realisesChou().length === 2, '« Fait » écrit un nouveau réalisé');
    await attendre(() => tache(CHOU) === undefined, 'la tâche quitte de nouveau la liste');
  });

  it('D3, témoin : sans relecture tardive, « Fait » masque la tâche puis la journée relue la retire', async () => {
    await rendre();
    remiseAZero();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(CHOU)));
    expect(tache(CHOU), 'masquée dès le tap').toBeUndefined();
    await attendre(() => realisesChou().length === 1, 'réalisé écrit');
    await tours();
    expect(tache(CHOU), 'retirée par la journée relue').toBeUndefined();
    expect(realisesChou()).toHaveLength(1);
  });
});
