// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13 — écran « Aujourd'hui » : semainier de la semaine, « Fait » en un geste,
 * récolte en trois gestes, « Annuler » (10 s puis historique), en ajout seul. Rendu pour de vrai
 * dans un DOM simulé (happy-dom), sur la ferme du jour (./test/ferme-du-jour.ts, aujourd'hui =
 * 2026-09-30, mercredi de 2026-S40) lue et écrite par la porte (base mémoire de @planif/sync).
 * Contrat : ./test/contrat.ts. La mise en page réelle (56 px, contraste, temps, hors ligne,
 * rechargement, file d'envoi) est vérifiée par apps/web/e2e/aujourdhui.e2e.ts.
 *
 * Chaque test a sa propre base (ils écrivent). La porte est posée sur une enveloppe de la base
 * qui compte les transactions d'écriture : une saisie = une transaction.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { DELAI_ANNULATION_MS, LIBELLES_UNITES, type ModuleEcranAujourdhui } from './test/contrat.ts';
import {
  ARTICLE_TOMATE,
  CAMPAGNE,
  cleTache,
  EMPLACEMENT,
  ecrireFermeDuJour,
  ESPECE,
  FERME,
  SERIE,
  STOCK_TOMATE_INITIAL,
  UTILISATEUR,
  VARIETE,
  type FermeDuJour,
} from './test/ferme-du-jour.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_ECRAN = './index.ts';

const AUJOURDHUI = '2026-09-30';

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

// ── Base, porte, transactions ────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly ferme_id: string;
  readonly type: string;
  readonly date: string;
  readonly horodatage: string;
  readonly auteur_id: string;
  readonly source: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly note: string | null;
  readonly photos: string;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string;
}

interface LigneMouvement {
  readonly id: string;
  readonly ferme_id: string;
  readonly article_stock_id: string;
  readonly date: string;
  readonly quantite: number;
  readonly motif: string;
  readonly recolte_id: string | null;
}

interface LigneArticle {
  readonly id: string;
  readonly ferme_id: string;
  readonly espece_id: string;
  readonly variete_id: string | null;
  readonly unite: string;
  readonly categorie: string | null;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let ferme: FermeDuJour;
/** Transactions d'écriture passées par la porte depuis le dernier `remiseAZero()`. */
let transactions = 0;
let evenementsAvant: Set<string>;
let mouvementsAvant: Set<string>;
let articlesAvant: Set<string>;

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const mouvements = (): LigneMouvement[] => base.lireDirect<LigneMouvement>('SELECT * FROM mouvement_stock ORDER BY cree_le, id');
const articles = (): LigneArticle[] => base.lireDirect<LigneArticle>('SELECT * FROM article_stock ORDER BY id');
const nouveauxEvenements = () => evenements().filter((e) => !evenementsAvant.has(e.id));
const nouveauxMouvements = () => mouvements().filter((m) => !mouvementsAvant.has(m.id));
const nouveauxArticles = () => articles().filter((a) => !articlesAvant.has(a.id));
const stock = (articleId: string): number =>
  base.lireDirect<{ s: number | null }>('SELECT SUM(quantite) AS s FROM mouvement_stock WHERE article_stock_id = ?', [articleId])[0]?.s ?? 0;

function remiseAZero(): void {
  transactions = 0;
  evenementsAvant = new Set(evenements().map((e) => e.id));
  mouvementsAvant = new Set(mouvements().map((m) => m.id));
  articlesAvant = new Set(articles().map((a) => a.id));
}

/** Aucune ligne du journal ni du stock modifiée ou effacée (ajout seul). */
function verifierAjoutSeul(): void {
  const interdites = base.ecritures.filter((sql) => /^\s*(UPDATE|DELETE|REPLACE|INSERT\s+OR\s+REPLACE)\b/i.test(sql) && /\b(evenement|mouvement_stock)\b/i.test(sql));
  expect(interdites, 'jamais d’UPDATE, DELETE ni REPLACE sur evenement ou mouvement_stock').toEqual([]);
}

/** La ligne telle que la porte l'a écrite est acceptée par les règles du serveur (@planif/core). */
function verifierValide(e: LigneEvenement): void {
  const r = validerSaisie({ ...e });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse ${e.id} : ${r.erreur.message}`).toBe(true);
}

const detail = (e: LigneEvenement): unknown => JSON.parse(e.detail);
const emplacements = (e: LigneEvenement): string[] => (JSON.parse(e.emplacement_ids) as string[]).map((x) => x.toLowerCase()).sort();

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI);
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
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
  vi.useRealTimers();
  base.fermer();
});

/** Un tour de boucle (lectures de la base mémoire, rendu). Avance l'horloge simulée de 0 ms si elle est active. */
async function unTour(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => setTimeout(r, 0));
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

/** Nom accessible simplifié : aria-label, aria-labelledby, <label>, puis le texte. */
function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null) return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(' ').trim();
  if (el instanceof HTMLInputElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    const englobant = el.closest('label');
    return texte(lie ?? englobant);
  }
  return texte(el);
}

function boutons(dans: ParentNode = conteneur): HTMLElement[] {
  return [...dans.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], input[type="radio"]')];
}

function bouton(nom: string | RegExp, dans: ParentNode = conteneur): HTMLElement {
  const trouves = boutons(dans).filter((b) => (typeof nom === 'string' ? nomAccessible(b) === nom : nom.test(nomAccessible(b))));
  expect(trouves.length, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeGreaterThan(0);
  const b = trouves[0];
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

const aBouton = (nom: string | RegExp, dans: ParentNode = conteneur): boolean =>
  boutons(dans).some((b) => (typeof nom === 'string' ? nomAccessible(b) === nom : nom.test(nomAccessible(b))));

const desactive = (b: HTMLElement): boolean => (b instanceof HTMLButtonElement && b.disabled) || b.getAttribute('aria-disabled') === 'true';

/** Compte les gestes : chaque appui passe par ici. */
let gestes = 0;
async function toucher(b: HTMLElement): Promise<void> {
  gestes++;
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const dialogues = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const dialogue = (debutNom: string): HTMLElement | undefined => dialogues().find((d) => nomAccessible(d).startsWith(debutNom));
const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');

function tacheOuEchec(cle: string): HTMLElement {
  const t = tache(cle);
  expect(t, `tâche ${cle} affichée (affichées : ${taches().map((x) => String(x.dataset.cle)).join(', ')})`).toBeDefined();
  if (t === undefined) throw new Error(`tâche ${cle} absente`);
  return t;
}

/** La région « Historique », ouverte par son bouton si elle n'est pas déjà à l'écran. */
async function historique(): Promise<HTMLElement> {
  const trouver = () =>
    [...conteneur.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');
  if (trouver() === undefined) await toucher(bouton('Historique'));
  await attendre(() => trouver() !== undefined, 'région « Historique »');
  const h = trouver();
  if (h === undefined) throw new Error('historique absent');
  return h;
}

const entrees = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')];

/** Pose la valeur d'un champ comme le ferait une saisie (React écoute input / change). */
async function remplir(champ: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

/** Récolte complète depuis « Noter une récolte » : culture, chiffres, Valider. */
async function recolter(cibleId: string, chiffres: string): Promise<void> {
  await toucher(bouton(/^Noter une récolte/));
  await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre (role="dialog" nommé « Récolte… »)');
  const d = dialogue('Récolte');
  const choix = d?.querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${cibleId}"]`);
  expect(choix, `choix de la culture ${cibleId}`).toBeTruthy();
  if (choix === null || choix === undefined) return;
  await toucher(choix);
  for (const c of chiffres) await toucher(bouton(c, dialogue('Récolte')));
  await toucher(bouton(/^Valider/, dialogue('Récolte')));
  await attendre(() => dialogue('Récolte') === undefined, 'la récolte se ferme après Valider');
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('T13 : écran Aujourd’hui, semainier de la semaine en cours', () => {
  it('les tâches de la semaine (T06), en retard d’abord, avec culture, planche et retard', async () => {
    await rendre();
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches);
    for (const t of taches()) {
      const cle = t.dataset.cle ?? '';
      const retard = ferme.attendu.retards[cle];
      expect(t.dataset.retard, cle).toBe(retard === undefined ? 'non' : 'oui');
      if (retard !== undefined) expect(texte(t), cle).toContain(`${String(retard)} jours de retard`);
    }
    const carotte = tacheOuEchec(cleTache(SERIE.carotte, 'semis_direct'));
    expect(texte(carotte)).toMatch(/carotte/i);
    expect(texte(carotte)).toContain('PC-P01');
    const chou = tacheOuEchec(cleTache(SERIE.chou, 'plantation'));
    expect(texte(chou)).toMatch(/chou pointu/i);
    expect(texte(chou)).toMatch(/planter/i);
    expect(texte(chou)).toContain('T2-P03');
    expect(texte(tacheOuEchec(cleTache(SERIE.batavia, 'plantation')))).toContain('T2-P01');
    expect(texte(tacheOuEchec(cleTache(CAMPAGNE.fraise, 'debut_recolte')))).toMatch(/fraise/i);

    // Groupes de la maquette Main.
    expect(texte(conteneur)).toContain('En retard');
    expect(texte(conteneur)).toContain('Cette semaine');
    // Rien d'autre : ni la semaine suivante (poireau), ni une récolte déjà commencée (tomate),
    // ni une série terminée (courgette), ni une campagne finie (asperge).
    for (const absent of [/poireau/i, /tomate/i, /courgette/i, /asperge/i]) {
      for (const t of taches()) expect(texte(t)).not.toMatch(absent);
    }
  });

  it('chaque tâche a son action : « Marquer fait », ou « Saisir une récolte » pour un début de récolte', async () => {
    await rendre();
    for (const t of taches()) {
      const recolte = t.dataset.cle?.endsWith(':debut_recolte') ?? false;
      expect(aBouton(recolte ? /^Saisir une récolte/ : /^Marquer fait/, t), String(t.dataset.cle)).toBe(true);
      if (recolte) expect(aBouton(/^Marquer fait/, t), 'pas de « Fait » sur un début de récolte').toBe(false);
    }
    expect(aBouton(/^Noter une récolte/)).toBe(true);
  });

  it('une saisie arrivée par la synchro (autre téléphone) se voit : la tâche faite disparaît', async () => {
    await rendre();
    expect(tache(cleTache(SERIE.chou, 'plantation'))).toBeDefined();
    const autre = '0192f0c1-1313-7000-8000-00000000ffff';
    base.recevoir(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'realise', ?, ?, ?, 'tap', ?, NULL, ?, NULL, '[]', NULL, NULL, ?, ?)`,
      [
        '0192f0c1-1313-7000-8000-00000000fffe',
        FERME,
        AUJOURDHUI,
        `${AUJOURDHUI}T06:00:00.000Z`,
        autre,
        SERIE.chou,
        JSON.stringify([EMPLACEMENT.t2p03]),
        JSON.stringify({ etape: 'plantation', quantiteReelle: null }),
        `${AUJOURDHUI}T06:00:01.000Z`,
      ],
    );
    await attendre(() => tache(cleTache(SERIE.chou, 'plantation')) === undefined, 'la plantation faite ailleurs quitte la liste');
    expect(tache(cleTache(SERIE.batavia, 'plantation'))).toBeDefined();
  });
});

describe('T13 : « Fait » en un geste', () => {
  it('crée le réalisé de l’étape à la date du jour, en une transaction, sans confirmation ; la tâche quitte la liste', async () => {
    await rendre();
    const cle = cleTache(SERIE.chou, 'plantation');
    gestes = 0;
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(cle)));
    await attendre(() => nouveauxEvenements().length > 0, 'un événement écrit');

    expect(gestes, 'un seul geste').toBe(1);
    expect(dialogues(), 'aucun écran de confirmation (saisie manuelle)').toEqual([]);
    const nouveaux = nouveauxEvenements();
    expect(nouveaux).toHaveLength(1);
    const e = nouveaux[0];
    if (e === undefined) return;
    expect(e).toMatchObject({
      ferme_id: FERME,
      type: 'realise',
      date: AUJOURDHUI,
      auteur_id: UTILISATEUR,
      source: 'tap',
      serie_id: SERIE.chou,
      campagne_id: null,
      remplace_sorte: null,
      remplace_evenement_id: null,
    });
    expect(detail(e)).toEqual({ etape: 'plantation', quantiteReelle: null });
    expect(emplacements(e)).toEqual([EMPLACEMENT.t2p03]);
    verifierValide(e);
    expect(transactions, 'une saisie = une transaction').toBe(1);
    expect(nouveauxMouvements(), 'un réalisé ne touche pas au stock').toEqual([]);

    await attendre(() => tache(cle) === undefined, 'la tâche faite quitte la liste');
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches.filter((c) => c !== cle));
    const b = bandeau();
    expect(b, 'bandeau data-testid="saisie-annulable"').not.toBeNull();
    expect(b?.getAttribute('role')).toBe('status');
    expect(texte(b)).toMatch(/chou pointu/i);
    expect(aBouton('Annuler', b ?? conteneur)).toBe(true);
    verifierAjoutSeul();
  });

  it('la date reste modifiable ensuite : « Changer la date » écrit une correction, rien n’est modifié', async () => {
    await rendre();
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(cleTache(SERIE.chou, 'plantation'))));
    await attendre(() => nouveauxEvenements().length === 1, 'réalisé écrit');
    const original = nouveauxEvenements()[0];
    if (original === undefined) return;
    const copie = { ...original };

    const h = await historique();
    await attendre(() => entrees(h).some((x) => x.dataset.evenement === original.id), 'la saisie est dans l’historique');
    const entree = entrees(h).find((x) => x.dataset.evenement === original.id);
    expect(entree?.dataset.type).toBe('realise');
    expect(texte(entree)).toMatch(/chou pointu/i);
    remiseAZero();
    await toucher(bouton('Changer la date', entree));
    await attendre(() => dialogue('Changer la date') !== undefined, 'dialogue « Changer la date »');
    const d = dialogue('Changer la date');
    const champ = [...(d?.querySelectorAll<HTMLInputElement>('input') ?? [])].find((i) => nomAccessible(i) === 'Date');
    expect(champ, 'champ libellé « Date »').toBeDefined();
    if (champ === undefined || d === undefined) return;
    expect(champ.type).toBe('date');
    await remplir(champ, '2026-09-28');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => nouveauxEvenements().length === 1, 'correction écrite');

    const correction = nouveauxEvenements()[0];
    if (correction === undefined) return;
    expect(correction).toMatchObject({
      type: 'realise',
      date: '2026-09-28',
      serie_id: SERIE.chou,
      source: 'tap',
      remplace_sorte: 'correction',
      remplace_evenement_id: original.id,
    });
    expect(detail(correction)).toEqual({ etape: 'plantation', quantiteReelle: null });
    expect(emplacements(correction)).toEqual([EMPLACEMENT.t2p03]);
    verifierValide(correction);
    expect(transactions).toBe(1);
    // L'original est toujours là, inchangé.
    expect(evenements().find((x) => x.id === original.id)).toEqual(copie);
    // L'historique montre la version en vigueur ; la tâche reste faite.
    await attendre(() => entrees(h).some((x) => x.dataset.evenement === correction.id), 'l’historique montre la correction');
    expect(entrees(h).some((x) => x.dataset.evenement === original.id), 'l’original corrigé n’est plus montré').toBe(false);
    expect(tache(cleTache(SERIE.chou, 'plantation'))).toBeUndefined();
    verifierAjoutSeul();
  });
});

describe('T13 : récolte en trois gestes', () => {
  it('culture proposée parmi les récoltes en cours → pavé → unité préremplie (kg) → Valider : événement et entrée en stock', async () => {
    await rendre();
    gestes = 0;
    await toucher(bouton(/^Noter une récolte/));
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre (role="dialog" nommé « Récolte… »)');
    const d = (): HTMLElement => {
      const x = dialogue('Récolte');
      if (x === undefined) throw new Error('récolte fermée');
      return x;
    };

    // Geste 1 : la culture, parmi les récoltes en cours seulement.
    const choix = [...d().querySelectorAll<HTMLElement>('[data-testid="choix-recolte"]')];
    expect(choix.map((c) => c.dataset.cible).sort()).toEqual([...ferme.attendu.recoltesEnCours].sort());
    const tomate = choix.find((c) => c.dataset.cible === SERIE.tomate);
    expect(texte(tomate)).toMatch(/tomate/i);
    expect(texte(tomate)).toContain('T2-P07');
    if (tomate === undefined) return;
    await toucher(tomate);

    // Unité préremplie depuis la culture : tomate → kg.
    const groupe = [...d().querySelectorAll<HTMLElement>('[role="radiogroup"]')].find((g) => nomAccessible(g) === 'Unité');
    expect(groupe, 'groupe « Unité » (role="radiogroup")').toBeDefined();
    if (groupe === undefined) return;
    const radios = [...groupe.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"]')];
    expect(radios.map(nomAccessible).sort()).toEqual(Object.values(LIBELLES_UNITES).sort());
    const coche = (r: HTMLElement) => (r instanceof HTMLInputElement ? r.checked : r.getAttribute('aria-checked') === 'true');
    expect(radios.filter(coche).map(nomAccessible)).toEqual([LIBELLES_UNITES.kg]);

    // Valider désactivé tant que rien n'est tapé.
    expect(desactive(bouton(/^Valider/, d())), 'Valider désactivé sans quantité').toBe(true);
    for (const c of '0123456789') expect(aBouton(c, d()), `touche « ${c} »`).toBe(true);
    expect(aBouton('Effacer', d())).toBe(true);

    // Geste 2 : la quantité, au pavé.
    await toucher(bouton('1', d()));
    await toucher(bouton('2', d()));
    expect(texte(d().querySelector('[data-testid="quantite"]'))).toContain('12');
    const valider = bouton(/^Valider/, d());
    expect(nomAccessible(valider)).toBe('Valider 12 kg');
    expect(desactive(valider)).toBe(false);
    expect(nouveauxEvenements(), 'rien d’écrit avant Valider').toEqual([]);

    // Geste 3 : Valider. Écrit tout de suite, sans confirmation.
    await toucher(valider);
    await attendre(() => dialogue('Récolte') === undefined, 'la récolte se ferme');
    await attendre(() => nouveauxMouvements().length > 0, 'mouvement de stock écrit');
    expect(gestes, 'ouvrir + culture + 2 chiffres + Valider').toBe(5);
    expect(dialogues()).toEqual([]);

    const nouveaux = nouveauxEvenements();
    expect(nouveaux).toHaveLength(1);
    const e = nouveaux[0];
    if (e === undefined) return;
    expect(e).toMatchObject({
      ferme_id: FERME,
      type: 'recolte',
      date: AUJOURDHUI,
      auteur_id: UTILISATEUR,
      source: 'tap',
      serie_id: SERIE.tomate,
      campagne_id: null,
      remplace_sorte: null,
      remplace_evenement_id: null,
    });
    expect(detail(e)).toEqual({ quantite: 12, unite: 'kg', categorie: null });
    expect(emplacements(e)).toEqual([EMPLACEMENT.t2p07]);
    verifierValide(e);

    // Entrée en stock : l'article existant (Tomate Cœur de bœuf, kg), +12, liée à la récolte.
    expect(nouveauxArticles(), 'l’article existant est réutilisé').toEqual([]);
    const m = nouveauxMouvements();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ ferme_id: FERME, article_stock_id: ARTICLE_TOMATE, quantite: 12, motif: 'recolte', recolte_id: e.id, date: AUJOURDHUI });
    expect(stock(ARTICLE_TOMATE)).toBe(STOCK_TOMATE_INITIAL + 12);
    expect(transactions, 'événement et mouvement dans une seule transaction').toBe(1);

    const b = bandeau();
    expect(texte(b)).toContain('12 kg');
    expect(aBouton('Annuler', b ?? conteneur)).toBe(true);
    const h = await historique();
    await attendre(() => entrees(h).some((x) => x.dataset.evenement === e.id), 'la récolte est dans l’historique');
    const entree = entrees(h).find((x) => x.dataset.evenement === e.id);
    expect(entree?.dataset.type).toBe('recolte');
    expect(texte(entree)).toMatch(/tomate/i);
    expect(texte(entree)).toContain('12 kg');
    expect(entrees(h)[0]?.dataset.evenement, 'la plus récente d’abord').toBe(e.id);
    verifierAjoutSeul();
  });

  it('depuis une tâche de début de récolte (fraise) : culture déjà choisie, unité Barquettes ; article créé dans la même transaction', async () => {
    await rendre();
    const cle = cleTache(CAMPAGNE.fraise, 'debut_recolte');
    await toucher(bouton(/^Saisir une récolte/, tacheOuEchec(cle)));
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
    const d = dialogue('Récolte');
    if (d === undefined) return;
    expect(d.querySelectorAll('[data-testid="choix-recolte"]'), 'culture déjà choisie : pas d’étape 1').toHaveLength(0);
    expect(texte(d)).toMatch(/fraise/i);
    const groupe = [...d.querySelectorAll<HTMLElement>('[role="radiogroup"]')].find((g) => nomAccessible(g) === 'Unité');
    const cochee = [...(groupe?.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"]') ?? [])].filter((r) =>
      r instanceof HTMLInputElement ? r.checked : r.getAttribute('aria-checked') === 'true',
    );
    expect(cochee.map(nomAccessible)).toEqual([LIBELLES_UNITES.barquette]);
    await toucher(bouton('3', d));
    await toucher(bouton(/^Valider 3 /, d));
    await attendre(() => nouveauxMouvements().length > 0, 'mouvement écrit');

    const e = nouveauxEvenements()[0];
    expect(nouveauxEvenements()).toHaveLength(1);
    if (e === undefined) return;
    expect(e).toMatchObject({ type: 'recolte', date: AUJOURDHUI, serie_id: null, campagne_id: CAMPAGNE.fraise, remplace_sorte: null });
    expect(detail(e)).toEqual({ quantite: 3, unite: 'barquette', categorie: null });
    expect(emplacements(e)).toEqual([EMPLACEMENT.s1g01]);
    verifierValide(e);

    const crees = nouveauxArticles();
    expect(crees, 'un article « Fraise Mara des bois, barquette » créé').toHaveLength(1);
    expect(crees[0]).toMatchObject({ ferme_id: FERME, espece_id: ESPECE.fraise, variete_id: VARIETE.maraDesBois, unite: 'barquette', categorie: null });
    const m = nouveauxMouvements();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ article_stock_id: crees[0]?.id, quantite: 3, motif: 'recolte', recolte_id: e.id, date: AUJOURDHUI });
    expect(transactions, 'article, événement et mouvement : une transaction').toBe(1);
    // Le début de récolte est réalisé : la tâche quitte la liste.
    await attendre(() => tache(cle) === undefined, 'la tâche de début de récolte quitte la liste');
    verifierAjoutSeul();
  });

  it('« Retour » ferme la récolte sans rien écrire ; « Effacer » corrige le dernier chiffre', async () => {
    await rendre();
    await toucher(bouton(/^Noter une récolte/));
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
    const d = dialogue('Récolte');
    const tomate = d?.querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`);
    if (d === undefined || tomate === null || tomate === undefined) throw new Error('récolte de tomate indisponible');
    await toucher(tomate);
    await toucher(bouton('5', d));
    await toucher(bouton('7', d));
    await toucher(bouton('Effacer', d));
    expect(texte(d.querySelector('[data-testid="quantite"]'))).toContain('5');
    expect(texte(d.querySelector('[data-testid="quantite"]'))).not.toContain('57');
    expect(nomAccessible(bouton(/^Valider/, d))).toBe('Valider 5 kg');
    await toucher(bouton('Retour', d));
    await attendre(() => dialogue('Récolte') === undefined, 'la récolte se ferme');
    expect(nouveauxEvenements()).toEqual([]);
    expect(nouveauxMouvements()).toEqual([]);
    expect(transactions).toBe(0);
  });
});

describe('T13 : « Annuler » (10 s, puis depuis l’historique), en ajout seul', () => {
  it('annuler une récolte : événement d’annulation et mouvement inverse ; rien n’est supprimé ; la saisie et son effet disparaissent', async () => {
    await rendre();
    await recolter(SERIE.tomate, '12');
    await attendre(() => nouveauxMouvements().length === 1, 'récolte écrite');
    const recolte = nouveauxEvenements()[0];
    const entreeStock = nouveauxMouvements()[0];
    if (recolte === undefined || entreeStock === undefined) return;
    const copies = { recolte: { ...recolte }, entreeStock: { ...entreeStock } };
    expect(stock(ARTICLE_TOMATE)).toBe(STOCK_TOMATE_INITIAL + 12);

    remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => nouveauxMouvements().length > 0, 'mouvement inverse écrit');

    const nouveaux = nouveauxEvenements();
    expect(nouveaux).toHaveLength(1);
    const annulation = nouveaux[0];
    if (annulation === undefined) return;
    expect(annulation).toMatchObject({
      ferme_id: FERME,
      type: 'recolte',
      serie_id: SERIE.tomate,
      auteur_id: UTILISATEUR,
      remplace_sorte: 'annulation',
      remplace_evenement_id: recolte.id,
    });
    verifierValide(annulation);
    const inverse = nouveauxMouvements();
    expect(inverse).toHaveLength(1);
    expect(inverse[0]).toMatchObject({ ferme_id: FERME, article_stock_id: ARTICLE_TOMATE, quantite: -12, motif: 'recolte', recolte_id: annulation.id });
    expect(transactions, 'annulation et mouvement inverse : une transaction').toBe(1);
    expect(stock(ARTICLE_TOMATE), 'le stock revient à sa valeur d’avant').toBe(STOCK_TOMATE_INITIAL);

    // Ajout seul : la récolte et son entrée en stock sont toujours là, inchangées.
    expect(evenements().find((x) => x.id === recolte.id)).toEqual(copies.recolte);
    expect(mouvements().find((x) => x.id === entreeStock.id)).toEqual(copies.entreeStock);
    verifierAjoutSeul();

    // La saisie disparaît des vues.
    const h = await historique();
    await attendre(() => !entrees(h).some((x) => [recolte.id, annulation.id].includes(x.dataset.evenement ?? '')), 'la récolte annulée quitte l’historique');
    expect(texte(h)).not.toContain('12 kg');
    // La tomate reste proposée à la récolte.
    await toucher(bouton(/^Noter une récolte/));
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
    const cibles = [...(dialogue('Récolte')?.querySelectorAll<HTMLElement>('[data-testid="choix-recolte"]') ?? [])].map((c) => c.dataset.cible);
    expect(cibles).toContain(SERIE.tomate);
  });

  it('« Annuler » reste affiché 10 s après la saisie puis disparaît ; l’historique permet encore d’annuler (la tâche revient)', async () => {
    await rendre();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const cle = cleTache(SERIE.chou, 'plantation');
    await toucher(bouton(/^Marquer fait/, tacheOuEchec(cle)));
    await attendre(() => bandeau() !== null && nouveauxEvenements().length === 1, 'bandeau affiché après la saisie');
    const fait = nouveauxEvenements()[0];
    if (fait === undefined) return;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAI_ANNULATION_MS - 200);
    });
    expect(bandeau(), 'encore là à 9,8 s').not.toBeNull();
    expect(aBouton('Annuler', bandeau() ?? conteneur)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await unTour();
    expect(bandeau(), 'disparu après 10 s').toBeNull();

    remiseAZero();
    const h = await historique();
    await attendre(() => entrees(h).some((x) => x.dataset.evenement === fait.id), 'le réalisé est dans l’historique');
    const entree = entrees(h).find((x) => x.dataset.evenement === fait.id);
    await toucher(bouton(/^Annuler/, entree));
    await attendre(() => nouveauxEvenements().length === 1, 'annulation écrite');
    const annulation = nouveauxEvenements()[0];
    if (annulation === undefined) return;
    expect(annulation).toMatchObject({ type: 'realise', serie_id: SERIE.chou, remplace_sorte: 'annulation', remplace_evenement_id: fait.id });
    verifierValide(annulation);
    expect(nouveauxMouvements()).toEqual([]);
    expect(transactions).toBe(1);
    verifierAjoutSeul();

    await attendre(() => tache(cle) !== undefined, 'la plantation annulée redevient à faire');
    expect(tache(cle)?.dataset.retard).toBe('oui');
    expect(taches().map((t) => t.dataset.cle)).toEqual(ferme.attendu.taches);
    await attendre(() => !entrees(h).some((x) => x.dataset.evenement === fait.id), 'le réalisé annulé quitte l’historique');
  });
});
