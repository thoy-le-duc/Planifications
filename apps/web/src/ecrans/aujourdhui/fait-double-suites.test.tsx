// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13f — « Fait » en double : changement d'onglet et relecture partielle.
 * Règle : aucun cas, même rare, ne permet d'écrire deux réalisés pour la même tâche, ni de faire
 * réapparaître, même un instant, une tâche marquée faite.
 *
 * Banc : comme fait-double.test.tsx (T13e), DOM simulé (happy-dom), ferme du jour
 * (./test/ferme-du-jour.ts) dans une base mémoire, aujourd'hui = 2026-09-30. La porte de test sait
 * retenir les LECTURES de la ferme (`gel`) et les AVIS DE CHANGEMENT (`retenirAvis`, l'appel de
 * `surveiller` qui annonce à l'écran qu'une table lue a changé) : le test fixe ainsi l'ordre des
 * événements sans minuteur.
 *
 *   F1  « Fait » sur la plantation du chou ; la relecture qui suit est retenue ; l'utilisateur
 *       change d'onglet (l'écran se démonte), puis revient (l'écran se remonte sur la journée en
 *       cache, qui n'a pas encore le réalisé). La tâche doit rester masquée, et un second « Fait »
 *       (si le bouton était là) ne doit rien écrire : un seul réalisé dans le journal.
 *       Avant T13f, les masques vivent dans l'état de l'écran et sont perdus au démontage.
 *   F2  Relecture incrémentale d'une AUTRE culture (la batavia) lancée après la fin de
 *       l'écriture du « Fait » sur le chou, mais avant que le changement de ce « Fait » soit
 *       annoncé : elle ne relit pas le chou, sa journée n'a pas le réalisé. La tâche du chou ne
 *       doit réapparaître à AUCUN rendu (chaque mutation du DOM est observée).
 *       Ordre forcé : une synchro (récolte de tomates annulée ailleurs) lance une relecture
 *       complète, retenue ; « Fait » sur la batavia (son changement est annoncé : relecture de la
 *       batavia demandée, en attente derrière la complète) ; avis retenus ; « Fait » sur le chou
 *       (écrit, avis de changement retenu) ; la relecture complète, puis celle de la batavia,
 *       passent ; enfin l'avis du « Fait » du chou est rendu.
 *       Avant T13f, la relecture de la batavia porte un numéro plus récent que l'écriture du chou :
 *       le masque tombe et le chou réapparaît jusqu'à la relecture suivante.
 *   F3  Deux fermes : « Fait » sur le chou de la ferme A (relecture retenue), passage à la ferme B
 *       (même contenu, autres identifiants, sa propre porte, comme App.tsx), « Fait » sur le chou
 *       de B, retour à A. Les masques de A ne s'appliquent pas à B (toutes ses tâches sont là, son
 *       « Fait » s'écrit) ; ceux de A tiennent au retour (un seul réalisé par ferme).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, TABLES_LOCALES, type NomTableLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { cleTache, cleTravail, ecrireFermeDuJour, EVENEMENT, FERME, fermeDuJour, SERIE, UTILISATEUR, type LigneLocale, type OptionsFermeDuJour } from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable, comme ecran.test.tsx. */
const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';
const DEMAIN = '2026-10-01';
/** Jour du téléphone vu par l'écran (B2 le change pendant une écriture). */
let jourTest = AUJOURDHUI;

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Ferme B : la ferme du jour, identifiants remplacés (même utilisateur) ───────────────────

const PREFIXE_A = '0192f0c1-1313-';
const PREFIXE_B = '0192f0c1-13f2-';
const versB = (id: string): string => id.replace(PREFIXE_A, PREFIXE_B);
const FERME_B = versB(FERME);
const SERIE_CHOU_B = versB(SERIE.chou);

/** Copie de la ferme du jour pour la ferme B : chaque identifiant (sauf l'utilisateur) est remplacé. */
async function ecrireFermeB(base: BaseMemoire): Promise<void> {
  const remplacer = (v: string | number | null): string | number | null =>
    typeof v === 'string' ? v.replace(/0192f0c1-1313-(7000-8000-[0-9a-f]{12})/g, (tout, fin: string) => (tout === UTILISATEUR ? tout : `${PREFIXE_B}${fin}`)) : v;
  const ferme = fermeDuJour(AUJOURDHUI);
  for (const [table, liste] of Object.entries(ferme.lignes) as [NomTableLocale, readonly LigneLocale[]][]) {
    if (table === 'utilisateur') continue; // le même utilisateur, membre des deux fermes
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (const l of liste)
        await tx.execute(
          sql,
          colonnes.map((c) => remplacer(l[c] ?? null)),
        );
    });
  }
}

// ── Base, porte à lectures et avis retenus ───────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly horodatage: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly [colonne: string]: unknown;
}

/** Lectures de la ferme A retenues tant que le gel tient (toutes les requêtes de la journée portent la ferme). */
interface Gel {
  readonly lever: () => void;
  /** Lectures arrêtées au gel depuis qu'il est posé. */
  readonly retenues: () => number;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let porteB: PorteDonnees;
let gelCourant: { ouverte: Promise<void>; n: number } | null = null;
/**
 * Gel « après le journal » (F2, comme D1 de T13e) : la PREMIÈRE lecture des saisies récentes de la
 * ferme A (dernière requête d'une relecture complète) est retenue APRÈS avoir lu : la relecture a vu
 * le journal tel qu'il était, et livrera sa journée quand le test le dira.
 */
let gelJournal: { ouverte: Promise<void>; n: number } | null = null;
/** Avis de changement retenus : rendus (un seul suffit, comme la porte qui les regroupe) par `rendreAvis`. */
let avisRetenus = false;
const avisEnAttente: (() => void)[] = [];

function geler(): Gel {
  let lever: () => void = () => undefined;
  const ouverte = new Promise<void>((r) => {
    lever = r;
  });
  const g = { ouverte, n: 0 };
  gelCourant = g;
  return {
    lever: () => {
      if (gelCourant === g) gelCourant = null;
      lever();
    },
    retenues: () => g.n,
  };
}

function gelerApresJournal(): Gel {
  let lever: () => void = () => undefined;
  const ouverte = new Promise<void>((r) => {
    lever = r;
  });
  const g = { ouverte, n: 0 };
  gelJournal = g;
  return {
    lever: () => {
      if (gelJournal === g) gelJournal = null;
      lever();
    },
    retenues: () => g.n,
  };
}

/** Écriture retenue : la PROCHAINE écriture de la ferme A attend que le test la lâche (réussie ou en échec). */
interface EcritureRetenue {
  readonly atteinte: Promise<void>;
  readonly lacher: (reussie: boolean) => void;
}
let ecritureRetenue: { signaler: () => void; decision: Promise<boolean> } | null = null;

function retenirEcriture(): EcritureRetenue {
  let signaler: () => void = () => undefined;
  let lacher: (reussie: boolean) => void = () => undefined;
  const atteinte = new Promise<void>((r) => {
    signaler = r;
  });
  const decision = new Promise<boolean>((r) => {
    lacher = r;
  });
  ecritureRetenue = { signaler, decision };
  return { atteinte, lacher };
}

function retenirAvis(): void {
  avisRetenus = true;
}

function rendreAvis(): void {
  avisRetenus = false;
  const a = avisEnAttente.splice(0);
  for (const f of a) f();
}

/** La porte d'une ferme, enveloppée : lectures gelées (ferme A seulement), avis retenus. */
function envelopper(vraie: PorteDonnees, fermeGelable: string | null): PorteDonnees {
  return {
    ...vraie,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]) => {
      const g = gelCourant;
      if (g !== null && fermeGelable !== null && (parametres ?? []).includes(fermeGelable)) {
        g.n++;
        await g.ouverte;
      }
      const lignes = await vraie.lire<T>(sql, parametres);
      const j = gelJournal;
      if (j !== null && j.n === 0 && fermeGelable !== null && (parametres ?? []).includes(fermeGelable) && sql.includes('SELECT e.id, e.type, e.date, e.horodatage')) {
        j.n++;
        await j.ouverte;
      }
      return lignes;
    },
    ecrireEnsemble: async (ordres) => {
      const r = fermeGelable === null ? null : ecritureRetenue;
      if (r !== null) {
        ecritureRetenue = null;
        r.signaler();
        if (!(await r.decision)) throw new Error('écriture impossible (simulée)');
      }
      return vraie.ecrireEnsemble(ordres);
    },
    surveiller: (requete, rappel) =>
      vraie.surveiller(requete, (lignes) => {
        if (avisRetenus)
          avisEnAttente.push(() => {
            rappel(lignes);
          });
        else rappel(lignes);
      }),
  };
}

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
let evenementsAvant = new Set<string>();
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));
function remiseAZero(): void {
  evenementsAvant = new Set(evenements().map((e) => e.id));
}

const realisesDe = (serieId: string): LigneEvenement[] => nouveauxEvenements().filter((e) => e.type === 'realise' && e.remplace_sorte === null && e.serie_id === serieId);

let compteurRecus = 0;
const idRecu = () => `0192f0c1-13f0-7000-8000-0000000b${(++compteurRecus).toString(16).padStart(4, '0')}`;

/** Annulation de `cible` saisie sur un autre téléphone et reçue par la synchro (comme fait-double.test.tsx). */
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

/** Base et portes : la ferme du jour (`options`) pour A, sa copie pour B. */
async function monterBase(options: OptionsFermeDuJour = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI, options);
  await ecrireFermeB(base);
  jourTest = AUJOURDHUI;
  ecritureRetenue = null;
  gelCourant = null;
  gelJournal = null;
  avisRetenus = false;
  avisEnAttente.length = 0;
  porte = envelopper(
    creerPorte(base, {
      utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
      fermeId: FERME as Id<'Ferme'>,
    }),
    FERME,
  );
  porteB = envelopper(
    creerPorte(base, {
      utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
      fermeId: FERME_B as Id<'Ferme'>,
    }),
    null,
  );
  remiseAZero();
}

beforeEach(async () => {
  await monterBase();
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
  // Rien ne doit rester retenu (sinon les lectures pendantes survivent au test).
  gelCourant = null;
  gelJournal = null;
  ecritureRetenue?.signaler();
  ecritureRetenue = null;
  rendreAvis();
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

async function tours(n = 15): Promise<void> {
  for (let k = 0; k < n; k++) await unTour();
}

async function attendre(condition: () => boolean, message: string, n = 200): Promise<void> {
  for (let k = 0; k < n && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

/** Affiche l'écran Aujourd'hui de la ferme donnée (clé par ferme, comme App.tsx). */
async function afficher(p: PorteDonnees = porte, fermeId: string = FERME): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui key={fermeId} porte={p} fermeId={fermeId} aujourdhui={() => jourTest} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

/** Un autre onglet : l'écran Aujourd'hui se démonte. */
async function autreOnglet(): Promise<void> {
  await act(async () => {
    racine.render(<p>Plan</p>);
    await Promise.resolve();
  });
  await unTour();
  expect(conteneur.querySelector('[data-testid="aujourdhui"]'), 'écran Aujourd’hui démonté').toBeNull();
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
  return texte(el);
}

const boutons = (dans: ParentNode = conteneur): HTMLElement[] => [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];

function bouton(nom: string, dans: ParentNode = conteneur): HTMLElement {
  const b = boutons(dans).find((x) => nomAccessible(x) === nom);
  expect(b, `un bouton « ${nom} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeDefined();
  if (b === undefined) throw new Error(`bouton ${nom} absent`);
  return b;
}

const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');

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
const boutonFait = (cle: string): HTMLElement | undefined => {
  const t = tache(cle);
  return t === undefined ? undefined : boutons(t).find((x) => nomAccessible(x).startsWith('Marquer fait'));
};

async function fait(cle: string): Promise<void> {
  const b = boutonFait(cle);
  expect(
    b,
    `bouton « Marquer fait » de ${cle} (affichées : ${taches()
      .map((x) => String(x.dataset.cle))
      .join(', ')})`,
  ).toBeDefined();
  if (b === undefined) throw new Error(`« Fait » absent sur ${cle}`);
  await toucher(b);
}

const CHOU = cleTache(SERIE.chou, 'plantation');
const BATAVIA = cleTache(SERIE.batavia, 'plantation');
const CHOU_B = cleTache(SERIE_CHOU_B, 'plantation');

/** Observe chaque mutation du DOM : rend les instants où la tâche `cle` était dessinée. */
function guetter(cle: string): {
  readonly vue: () => number;
  readonly arreter: () => void;
} {
  let n = 0;
  const regarder = () => {
    if (tache(cle) !== undefined) n++;
  };
  const obs = new MutationObserver(regarder);
  obs.observe(conteneur, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  return {
    vue: () => {
      regarder();
      return n;
    },
    arreter: () => {
      obs.disconnect();
    },
  };
}

describe('T13f, « Fait » en double : changement d’onglet et relecture partielle', () => {
  it('F1 : « Fait », changement d’onglet, retour avant la relecture : la tâche reste masquée, un second « Fait » n’écrit rien', async () => {
    await afficher();
    await tours(); // écran au repos
    expect(tache(CHOU), 'plantation du chou à faire').toBeDefined();

    // Les relectures de la ferme sont retenues : la journée ne verra pas le réalisé.
    const gel = geler();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou écrit');
    await attendre(() => gel.retenues() > 0, 'la relecture qui suit le « Fait » est en route (retenue)');
    expect(tache(CHOU), 'masquée dès le « Fait »').toBeUndefined();

    // Changement d'onglet, puis retour : l'écran se remonte sur la journée en cache, sans le réalisé.
    await autreOnglet();
    await afficher();
    await tours();
    expect.soft(tache(CHOU), 'retour sur Aujourd’hui avant la relecture : la tâche reste masquée').toBeUndefined();

    // Second « Fait » (si le bouton est là) : rien n'est écrit.
    const b = boutonFait(CHOU);
    if (b !== undefined) await toucher(b);
    await tours();
    expect(realisesDe(SERIE.chou), 'un seul réalisé pour la plantation du chou').toHaveLength(1);

    // Les relectures passent : la tâche reste retirée, toujours un seul réalisé.
    gel.lever();
    await tours(30);
    expect(tache(CHOU), 'journée relue : la tâche est retirée').toBeUndefined();
    expect(realisesDe(SERIE.chou)).toHaveLength(1);
  });

  it('F1 bis : deux allers-retours d’onglet avant la relecture, la tâche reste masquée à chaque retour', async () => {
    await afficher();
    await tours();
    const gel = geler();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou écrit');
    for (let k = 1; k <= 2; k++) {
      await autreOnglet();
      await afficher();
      await tours();
      expect.soft(tache(CHOU), `retour n° ${String(k)} : la tâche reste masquée`).toBeUndefined();
      const b = boutonFait(CHOU);
      if (b !== undefined) await toucher(b);
    }
    gel.lever();
    await tours(30);
    expect(realisesDe(SERIE.chou), 'un seul réalisé pour la plantation du chou').toHaveLength(1);
    expect(tache(CHOU)).toBeUndefined();
  });

  it('F2 : relecture incrémentale d’une autre culture entre l’écriture du « Fait » et son annonce : la tâche ne réapparaît à aucun rendu', async () => {
    await afficher();
    await tours();
    expect(tache(CHOU)).toBeDefined();
    expect(tache(BATAVIA), 'plantation de la batavia à faire').toBeDefined();

    // 1. Une synchro (sans rapport) lance une relecture complète, retenue après avoir lu le journal
    //    (sans aucun des deux « Fait »).
    const gel = gelerApresJournal();
    const recolte = evenements().find((x) => x.id === EVENEMENT.recolteTomate1);
    if (recolte === undefined) throw new Error('récolte de tomates absente');
    annulationRecue(recolte);
    await attendre(() => gel.retenues() > 0, 'relecture complète retenue (journal lu)');

    // 2. « Fait » sur la batavia : son changement est annoncé, sa relecture attend derrière la complète.
    await fait(BATAVIA);
    await attendre(() => realisesDe(SERIE.batavia).length === 1, 'réalisé de la batavia écrit');
    await tours();

    // 3. « Fait » sur le chou : écrit, mais l'avis de son changement est retenu.
    retenirAvis();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou écrit');
    await tours();
    expect(tache(CHOU), 'masquée dès le « Fait »').toBeUndefined();

    // 4. La relecture complète passe, puis celle de la batavia (lancée après l'écriture du chou,
    //    sans relire le chou) : le chou ne doit apparaître à aucun rendu.
    const guet = guetter(CHOU);
    gel.lever();
    await tours(30);
    expect.soft(guet.vue(), 'relecture de la batavia : la plantation du chou ne réapparaît à aucun rendu').toBe(0);

    // Second « Fait » (si le bouton est là) : rien n'est écrit.
    const b = boutonFait(CHOU);
    if (b !== undefined) await toucher(b);

    // 5. L'avis du « Fait » du chou arrive : la tâche est relue, toujours absente.
    rendreAvis();
    await tours(30);
    expect.soft(guet.vue(), 'la plantation du chou ne réapparaît à aucun rendu').toBe(0);
    guet.arreter();
    expect(tache(CHOU)).toBeUndefined();
    expect(tache(BATAVIA)).toBeUndefined();
    expect(realisesDe(SERIE.chou), 'un seul réalisé pour le chou').toHaveLength(1);
    expect(realisesDe(SERIE.batavia), 'un seul réalisé pour la batavia').toHaveLength(1);
  });

  it('F3 : changement de ferme puis retour : les masques d’une ferme ne s’appliquent pas à l’autre', async () => {
    await afficher();
    await tours();
    const clesA = taches().map((t) => String(t.dataset.cle));

    // Ferme A : « Fait » sur le chou, relectures retenues.
    const gel = geler();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou (A) écrit');
    expect(tache(CHOU)).toBeUndefined();

    // Ferme B (sa porte, ses identifiants) : toutes ses tâches, rien de masqué par A.
    await afficher(porteB, FERME_B);
    await tours();
    const clesB = taches().map((t) => String(t.dataset.cle));
    expect(clesB, 'ferme B : les mêmes tâches que la ferme A avant le « Fait », aucune masquée').toEqual(clesA.map(versB));
    await fait(CHOU_B);
    await attendre(() => realisesDe(SERIE_CHOU_B).length === 1, '« Fait » sur le chou de B écrit');
    await attendre(() => tache(CHOU_B) === undefined, 'le chou de B quitte la liste');
    expect(realisesDe(SERIE.chou), 'aucun réalisé de plus pour A').toHaveLength(1);

    // Retour à la ferme A, avant que sa relecture n'ait intégré le réalisé : le masque de A tient.
    await afficher(porte, FERME);
    await tours();
    expect.soft(tache(CHOU), 'retour à la ferme A : le chou reste masqué').toBeUndefined();
    const b = boutonFait(CHOU);
    if (b !== undefined) await toucher(b);
    await tours();
    expect(realisesDe(SERIE.chou), 'un seul réalisé pour le chou de A').toHaveLength(1);

    gel.lever();
    await tours(30);
    expect(tache(CHOU)).toBeUndefined();
    expect(realisesDe(SERIE.chou)).toHaveLength(1);
    expect(realisesDe(SERIE_CHOU_B)).toHaveLength(1);

    // Et B, à nouveau : son chou est retiré (fait), le reste de ses tâches est là.
    await afficher(porteB, FERME_B);
    await tours();
    expect(tache(CHOU_B)).toBeUndefined();
    expect(taches().map((t) => String(t.dataset.cle))).toEqual(clesA.filter((c) => c !== CHOU).map(versB));
  });
});

// ── Contre-relecture T13f (bloquants B1, B2 ; N6) ────────────────────────────────────────────

/** Interventions d'origine (pas les annulations) sur une série, d'un type de travail donné. */
const interventionsDe = (serieId: string, type: string): LigneEvenement[] =>
  nouveauxEvenements().filter((e) => e.type === 'intervention' && e.remplace_sorte === null && e.serie_id === serieId && String(e.detail).includes(`"type":"${type}"`));
const annulations = (): LigneEvenement[] => nouveauxEvenements().filter((e) => e.remplace_sorte === 'annulation');

/** Une synchro sans rapport lance une relecture complète, retenue après avoir lu le journal. */
async function relectureCompleteLente(): Promise<Gel> {
  const gel = gelerApresJournal();
  const recolte = evenements().find((x) => x.id === EVENEMENT.recolteTomate1);
  if (recolte === undefined) throw new Error('récolte de tomates absente');
  annulationRecue(recolte);
  await attendre(() => gel.retenues() > 0, 'relecture complète retenue (journal lu)');
  remiseAZero();
  return gel;
}

describe('T13f, contre-relecture : deux « Fait » sur la même culture', () => {
  beforeEach(async () => {
    base.fermer();
    await monterBase({ travaux: true });
  });

  // Batavia : grelinette J−12 et compost J−3, deux travaux prévus de la MÊME série.
  const GRELINETTE = cleTravail(SERIE.batavia, 0, '2026-09-18');
  const COMPOST = cleTravail(SERIE.batavia, 1, '2026-09-27');

  it('B1 : « Fait » sur A puis sur B (même culture), relecture complète lente, « Annuler » sur B : A ne réapparaît à aucun rendu, un seul fait pour A ; B revient', async () => {
    await afficher();
    await tours();
    expect(tache(GRELINETTE), 'grelinette à faire').toBeDefined();
    expect(tache(COMPOST), 'compost à faire').toBeDefined();

    const gel = await relectureCompleteLente();
    await fait(GRELINETTE);
    await attendre(() => interventionsDe(SERIE.batavia, 'grelinette').length === 1, 'grelinette écrite');
    await tours();
    await fait(COMPOST);
    await attendre(() => interventionsDe(SERIE.batavia, 'compost').length === 1, 'compost écrit');
    await tours();
    expect(tache(GRELINETTE)).toBeUndefined();
    expect(tache(COMPOST)).toBeUndefined();

    // « Annuler » sur le compost (bandeau), pendant que la relecture complète est retenue.
    const guet = guetter(GRELINETTE);
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => annulations().length === 1, 'annulation du compost écrite');
    await tours();
    expect.soft(guet.vue(), '« Annuler » sur le compost : la grelinette ne réapparaît pas').toBe(0);
    const b = boutonFait(GRELINETTE);
    if (b !== undefined) await toucher(b);

    // La relecture complète (sans aucun des deux) passe, puis celle de la batavia.
    gel.lever();
    await attendre(() => tache(COMPOST) !== undefined, 'annulation relue : le compost revient');
    await tours(30);
    expect.soft(guet.vue(), 'la grelinette ne réapparaît à aucun rendu').toBe(0);
    guet.arreter();
    expect(tache(GRELINETTE)).toBeUndefined();
    expect(tache(COMPOST)).toBeDefined();
    expect(interventionsDe(SERIE.batavia, 'grelinette'), 'un seul fait pour la grelinette').toHaveLength(1);
  });
});

describe('T13f, contre-relecture : changement de jour, annulation, échec', () => {
  it('B2 : « Fait » à écriture lente, le jour passe à J+1 pendant l’écriture, retour sur l’écran : la tâche reste masquée, un seul réalisé', async () => {
    await afficher();
    await tours();
    const ecriture = retenirEcriture();
    await fait(CHOU);
    await ecriture.atteinte;
    expect(tache(CHOU), 'masquée dès le tap').toBeUndefined();

    // Minuit passe pendant l'écriture ; l'utilisateur change d'onglet puis revient (écran du J+1).
    jourTest = DEMAIN;
    await autreOnglet();
    await afficher();
    await tours();
    expect.soft(tache(CHOU), 'J+1, écriture pas finie : la plantation du chou reste masquée').toBeUndefined();
    const b = boutonFait(CHOU);
    if (b !== undefined) await toucher(b);
    await tours();

    // L'écriture finit ; la culture est relue.
    ecriture.lacher(true);
    await tours(30);
    expect(realisesDe(SERIE.chou), 'un seul réalisé pour la plantation du chou').toHaveLength(1);
    expect(tache(CHOU), 'culture relue : la tâche est retirée').toBeUndefined();
  });

  it('N6 : « Annuler » sur une culture : les masques des AUTRES cultures tiennent', async () => {
    await afficher();
    await tours();
    const gel = await relectureCompleteLente();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou écrit');
    await tours();
    await fait(BATAVIA);
    await attendre(() => realisesDe(SERIE.batavia).length === 1, 'réalisé de la batavia écrit');
    await tours();

    const guet = guetter(CHOU);
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => annulations().length === 1, 'annulation de la batavia écrite');
    await tours();
    expect.soft(guet.vue(), '« Annuler » sur la batavia : le chou reste masqué').toBe(0);

    gel.lever();
    await attendre(() => tache(BATAVIA) !== undefined, 'annulation relue : la batavia revient');
    await tours(30);
    expect(guet.vue(), 'le chou ne réapparaît à aucun rendu').toBe(0);
    guet.arreter();
    expect(realisesDe(SERIE.chou)).toHaveLength(1);
  });

  it('N6 : écriture en échec après un changement d’onglet : le masque tombe, la tâche revient, rien n’est écrit', async () => {
    await afficher();
    await tours();
    const ecriture = retenirEcriture();
    await fait(CHOU);
    await ecriture.atteinte;
    await autreOnglet();
    await afficher();
    await tours();
    expect(tache(CHOU), 'écriture en cours : masquée au retour').toBeUndefined();

    ecriture.lacher(false);
    await attendre(() => tache(CHOU) !== undefined, 'écriture en échec : la tâche revient');
    await tours();
    expect(realisesDe(SERIE.chou), 'rien d’écrit').toHaveLength(0);
    expect(boutonFait(CHOU), '« Fait » de nouveau possible').toBeDefined();
  });

  it('N6 : réalisé annulé ailleurs (synchro), masque dans le cache après un aller-retour d’onglet : la tâche revient après la relecture', async () => {
    await afficher();
    await tours();
    const gel = geler();
    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 1, 'réalisé du chou écrit');
    await autreOnglet();
    await afficher();
    await tours();
    expect(tache(CHOU), 'masquée au retour').toBeUndefined();
    gel.lever();
    await tours(30);
    expect(tache(CHOU), 'relue : retirée').toBeUndefined();

    const realise = realisesDe(SERIE.chou)[0];
    if (realise === undefined) throw new Error('réalisé absent');
    annulationRecue(realise);
    await attendre(() => tache(CHOU) !== undefined, 'annulation reçue et relue : la plantation du chou revient');

    await fait(CHOU);
    await attendre(() => realisesDe(SERIE.chou).length === 2, '« Fait » écrit un nouveau réalisé');
    await attendre(() => tache(CHOU) === undefined, 'la tâche quitte de nouveau la liste');
  });
});
