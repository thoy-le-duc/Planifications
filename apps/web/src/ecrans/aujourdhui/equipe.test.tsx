// @vitest-environment happy-dom
/**
 * Tests d'acceptation T60 — écran Aujourd'hui : consignes par ouvrier (docs/backlog/
 * T60-consignes-par-ouvrier.md, règles 2, 4, 5 et 6 ; critère « Tests d'écran : attribution au
 * doigt hors ligne, en lot par zone ; fiche du jour »). Vrai écran dans un DOM simulé (happy-dom),
 * sur la ferme du jour (./test/ferme-du-jour.ts, aujourd'hui = 2026-09-30), lue et écrite par la
 * porte (base mémoire de @planif/sync), sans réseau.
 *
 * ── Contrat (en plus de ./test/contrat.ts) ──────────────────────────────────────────────────
 *
 * L'équipe (tables `personne` et `attribution`, modèle dans docs/modele-donnees.md) se lit À LA
 * DEMANDE (./equipe/, hors du morceau d'Aujourd'hui), une fois la journée relue : le premier
 * affichage n'attend rien de plus. « Moi » = la personne active liée au membre actif de
 * `utilisateurId` dans la ferme.
 *
 * Filtre (règle 4), quand « moi » existe : groupe [data-testid="filtre-travaux"] de deux boutons
 * à bascule (aria-pressed) « Mes travaux » et « Tous ». Équipier : « Mes travaux » à l'ouverture ;
 * gérant : « Tous ». « Mes travaux » = travaux attribués à moi ou à personne (travauxDe du cœur),
 * dans l'ordre de l'écran. « Tous » est à un tap.
 *
 * Carte d'un travail attribué : [data-testid="attribue-a"], les prénoms triés, séparés par « , ».
 *
 * Attribuer (règle 2, gérant seulement) : bouton « Attribuer », ou appui long sur une carte
 * (500 ms ; le menu contextuel d'un appui long Android ouvre de même). Dialogue « Attribuer » :
 *   - les travaux de l'écran, cases à cocher [data-testid="choix-tache"][data-cle] (celui de
 *     l'appui long déjà coché, les autres non) ; pour chaque zone qui en porte, un bouton
 *     « Toute la zone <nom> » qui coche tous ceux de la zone (zone du premier emplacement) ;
 *   - les personnes actives de l'équipe, cases à cocher nommées par le prénom (cochées : celles
 *     qui ont déjà le travail de l'appui long) ;
 *   - « Valider » : UNE transaction locale (planAttribution du cœur : chaque travail coché reçoit
 *     exactement les personnes cochées) ; le dialogue se ferme ; un bandeau
 *     [data-testid="attribution-annulable"] (role="status") dit à qui, avec « Annuler » qui
 *     rétablit l'état d'avant (une transaction). Hors ligne : aucun appel réseau.
 * Équipier : ni bouton « Attribuer », ni dialogue à l'appui long.
 *
 * Fiche du jour (règle 5) : bouton « Fiche du jour » → dialogue « Fiche du jour », liste
 * « Personne » (l'équipe active ; moi par défaut, sinon la première), une ligne par travail de la
 * personne (même liste que « Mes travaux » pour elle) : [data-testid="ligne-fiche"] avec
 * [data-colonne="numero"] (1, 2, 3… dans l'ordre de l'écran), "planche" (codes des
 * emplacements), "travail" (la phrase de la tâche), "outil" (outil du travail prévu, sinon
 * vide). « Imprimer » appelle window.print() ; « Partager en image » est présent.
 *
 * Règle 6 : un travail marqué « Fait » par n'importe qui est soldé pour tout le monde (comme
 * avant) : la carte part, attribuée ou non.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, CAMPAGNE, UTILISATEUR, type FermeDuJour } from './test/ferme-du-jour.ts';
import { aBouton, attendre, bouton, champ, coche, dialogue, dialogueOuEchec, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

const id = (n: number) => `0192f0c1-6060-7000-8000-${n.toString(16).padStart(12, '0')}`;
/** L'équipier de la ferme (compte), et sa ligne de membre. */
const EQUIPIER = id(0x1);
const MEMBRE_EQUIPIER = id(0x2);
const MEMBRE_GERANT = '0192f0c1-1313-7000-8000-000000000003';
/** L'équipe : Théo (le gérant), Paul (l'équipier, a un compte), Marie (sans compte). */
const THEO = id(0x10);
const PAUL = id(0x11);
const MARIE = id(0x12);

const CHOU = cleTache(SERIE.chou, 'plantation');
const CAROTTE = cleTache(SERIE.carotte, 'semis_direct');
const FRAISE = cleTache(CAMPAGNE.fraise, 'debut_recolte');
const BATAVIA = cleTache(SERIE.batavia, 'plantation');
const RADIS = cleTache(SERIE.radis, 'semis_direct');

let ecran: ModuleEcranAujourdhui;
let base: BaseMemoire;
let porte: PorteDonnees;
let ferme: FermeDuJour;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

const horo = { cree_le: '2026-09-01T08:00:00.000Z', modifie_le: '2026-09-01T08:00:00.000Z' };

interface LigneAttribution {
  readonly id: string;
  readonly ferme_id: string;
  readonly personne_id: string;
  readonly cle_tache: string;
  readonly supprime_le: string | null;
}

const attributions = (): LigneAttribution[] => base.lireDirect<LigneAttribution>('SELECT id, ferme_id, personne_id, cle_tache, supprime_le FROM attribution ORDER BY cle_tache, personne_id, id');
const actives = (): { cle: string; personne: string }[] => attributions().filter((a) => a.supprime_le === null).map((a) => ({ cle: a.cle_tache, personne: a.personne_id.toLowerCase() }));

async function ecrireEquipe(): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO utilisateur (id, nom, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, NULL)', [EQUIPIER, 'Paul', horo.cree_le, horo.modifie_le]);
    await tx.execute(
      `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'equipier', 'accepte', NULL, NULL, ?, ?, NULL)`,
      [MEMBRE_EQUIPIER, EQUIPIER, FERME, horo.cree_le, horo.modifie_le],
    );
    const sql = 'INSERT INTO personne (id, ferme_id, prenom, membre_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)';
    await tx.execute(sql, [THEO, FERME, 'Théo', MEMBRE_GERANT, horo.cree_le, horo.modifie_le]);
    await tx.execute(sql, [PAUL, FERME, 'Paul', MEMBRE_EQUIPIER, horo.cree_le, horo.modifie_le]);
    await tx.execute(sql, [MARIE, FERME, 'Marie', null, horo.cree_le, horo.modifie_le]);
  });
}

/** Une attribution déjà là (écrite par le gérant, arrivée par la synchro). */
async function attribuerDeja(n: number, cle: string, personne: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO attribution (id, ferme_id, personne_id, cle_tache, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)', [id(0x100 + n), FERME, personne, cle, horo.cree_le, horo.modifie_le]);
  });
}

async function preparer(utilisateurId: string, options: { readonly travaux?: boolean } = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, options);
  await ecrireEquipe();
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: utilisateurId as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  // Hors ligne : aucun appel réseau n'est permis.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  transactions = 0;
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

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const cles = (): string[] => taches().map((t) => t.dataset.cle ?? '');
const tache = (cle: string): HTMLElement => {
  const t = taches().find((x) => x.dataset.cle === cle);
  if (t === undefined) throw new Error(`carte ${cle} absente (cartes : ${cles().join(', ')})`);
  return t;
};
const filtre = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="filtre-travaux"]');
const presse = (nom: string): boolean => bouton(nom, filtre() ?? conteneur).getAttribute('aria-pressed') === 'true';

async function rendre(utilisateurId: string): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} utilisateurId={utilisateurId} stockage={stockageMemoire()} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

/** Instantané gardé en mémoire, propre à chaque test. */
function stockageMemoire(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** Appui long au doigt sur une carte : pointerdown tenu 600 ms, puis pointerup. */
async function appuiLong(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10 }));
    await new Promise((r) => setTimeout(r, 600));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10 }));
  });
  await unTour();
}

const choixTache = (d: HTMLElement, cle: string): HTMLInputElement => {
  const c = d.querySelector<HTMLInputElement>(`input[data-testid="choix-tache"][data-cle="${cle}"]`);
  if (c === null) throw new Error(`travail ${cle} absent du dialogue`);
  return c;
};

describe('T60 : « Mes travaux » et « Tous » (règle 4)', () => {
  it('équipier : Aujourd’hui s’ouvre sur « Mes travaux » (les siens et ceux de personne) ; « Tous » à un tap', async () => {
    await preparer(EQUIPIER);
    await attribuerDeja(1, CHOU, MARIE);
    await attribuerDeja(2, CAROTTE, PAUL);
    await attribuerDeja(3, RADIS, MARIE);
    await attribuerDeja(4, RADIS, PAUL);
    await rendre(EQUIPIER);
    await attendre(() => filtre() !== null, 'le filtre paraît une fois l’équipe lue');
    expect(presse('Mes travaux')).toBe(true);
    expect(presse('Tous')).toBe(false);
    await attendre(() => !cles().includes(CHOU), 'le chou de Marie n’est pas dans « Mes travaux »');
    expect(cles()).toEqual(ferme.attendu.taches.filter((c) => c !== CHOU));
    expect(texte(tache(RADIS).querySelector('[data-testid="attribue-a"]'))).toBe('Marie, Paul');
    await toucher(bouton('Tous', filtre() ?? conteneur));
    expect(presse('Tous')).toBe(true);
    expect(cles()).toEqual(ferme.attendu.taches);
    expect(texte(tache(CHOU).querySelector('[data-testid="attribue-a"]'))).toBe('Marie');
    await toucher(bouton('Mes travaux', filtre() ?? conteneur));
    expect(cles()).not.toContain(CHOU);
  });

  it('gérant : « Tous » à l’ouverture', async () => {
    await preparer(UTILISATEUR);
    await attribuerDeja(1, CHOU, MARIE);
    await rendre(UTILISATEUR);
    await attendre(() => filtre() !== null, 'filtre affiché');
    expect(presse('Tous')).toBe(true);
    expect(cles()).toEqual(ferme.attendu.taches);
  });

  it('règle 6 : un travail attribué marqué « Fait » par le gérant part aussi de « Mes travaux » de l’équipier', async () => {
    await preparer(EQUIPIER);
    await attribuerDeja(1, CAROTTE, PAUL);
    await rendre(EQUIPIER);
    await attendre(() => filtre() !== null && cles().includes(CAROTTE), 'la carotte est dans « Mes travaux »');
    await base.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
         VALUES (?, ?, 'realise', ?, ?, ?, 'tap', ?, NULL, '[]', NULL, '[]', NULL, NULL, ?, ?)`,
        [id(0x500), FERME, AUJOURDHUI, `${AUJOURDHUI}T07:00:00.000Z`, UTILISATEUR, SERIE.carotte, JSON.stringify({ etape: 'semis_direct', quantiteReelle: null }), `${AUJOURDHUI}T07:00:00.000Z`],
      );
    });
    await attendre(() => !cles().includes(CAROTTE), 'la carotte faite par le gérant est soldée pour l’équipier');
  });
});

describe('T60 : attribuer au doigt, hors ligne (règle 2)', () => {
  it('gérant : appui long sur le chou, Paul et Marie, Valider : deux attributions en UNE transaction, la carte le montre ; Annuler les retire', async () => {
    await preparer(UTILISATEUR);
    await rendre(UTILISATEUR);
    await attendre(() => filtre() !== null, 'équipe lue');
    await appuiLong(tache(CHOU));
    await attendre(() => dialogue('Attribuer') !== undefined, 'l’appui long ouvre « Attribuer »');
    const d = dialogueOuEchec('Attribuer');
    expect(choixTache(d, CHOU).checked).toBe(true);
    expect(choixTache(d, CAROTTE).checked).toBe(false);
    const paul = champ('Paul', d);
    const marie = champ('Marie', d);
    expect(paul.checked || marie.checked).toBe(false);
    await toucher(paul);
    await toucher(marie);
    transactions = 0;
    await toucher(bouton('Valider', d));
    await attendre(() => actives().length === 2, 'deux attributions écrites');
    expect(transactions).toBe(1);
    expect(actives()).toEqual([
      { cle: CHOU, personne: PAUL },
      { cle: CHOU, personne: MARIE },
    ].sort((a, b) => a.personne.localeCompare(b.personne)));
    expect(attributions().every((a) => a.ferme_id === FERME)).toBe(true);
    await attendre(() => dialogue('Attribuer') === undefined, 'le dialogue se ferme');
    await attendre(() => texte(tache(CHOU).querySelector('[data-testid="attribue-a"]')) === 'Marie, Paul', 'la carte dit à qui');
    const bandeau = conteneur.querySelector<HTMLElement>('[data-testid="attribution-annulable"]');
    expect(bandeau?.getAttribute('role')).toBe('status');
    transactions = 0;
    await toucher(bouton('Annuler', bandeau ?? conteneur));
    await attendre(() => actives().length === 0, 'Annuler retire les deux attributions');
    expect(transactions).toBe(1);
    // Suppression douce : les lignes restent.
    expect(attributions()).toHaveLength(2);
    await attendre(() => tache(CHOU).querySelector('[data-testid="attribue-a"]') === null, 'la carte n’est plus attribuée');
  });

  it('le menu contextuel (appui long Android) ouvre aussi « Attribuer », personnes déjà cochées', async () => {
    await preparer(UTILISATEUR);
    await attribuerDeja(1, CAROTTE, MARIE);
    await rendre(UTILISATEUR);
    await attendre(() => filtre() !== null, 'équipe lue');
    await act(async () => {
      tache(CAROTTE).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await attendre(() => dialogue('Attribuer') !== undefined, 'dialogue ouvert');
    const d = dialogueOuEchec('Attribuer');
    expect(coche(champ('Marie', d))).toBe(true);
    expect(coche(champ('Paul', d))).toBe(false);
  });

  it('en lot : « Attribuer », « Toute la zone Tunnel 2 », Paul, Valider : chaque travail du tunnel est à Paul', async () => {
    await preparer(UTILISATEUR);
    await attribuerDeja(1, RADIS, MARIE);
    await rendre(UTILISATEUR);
    await attendre(() => filtre() !== null, 'équipe lue');
    await toucher(bouton('Attribuer', conteneur));
    await attendre(() => dialogue('Attribuer') !== undefined, 'dialogue ouvert');
    const d = dialogueOuEchec('Attribuer');
    await toucher(bouton('Toute la zone Tunnel 2', d));
    expect(choixTache(d, CHOU).checked).toBe(true);
    expect(choixTache(d, BATAVIA).checked).toBe(true);
    expect(choixTache(d, RADIS).checked).toBe(true);
    expect(choixTache(d, CAROTTE).checked).toBe(false);
    expect(choixTache(d, FRAISE).checked).toBe(false);
    await toucher(champ('Paul', d));
    transactions = 0;
    await toucher(bouton('Valider', d));
    await attendre(() => actives().length === 3, 'trois attributions actives');
    expect(transactions).toBe(1);
    expect(actives()).toEqual([BATAVIA, CHOU, RADIS].sort().map((cle) => ({ cle, personne: PAUL })));
    // L'attribution de Marie au radis est retirée en douceur (le travail est à Paul seul).
    expect(attributions().find((a) => a.cle_tache === RADIS && a.personne_id === MARIE)?.supprime_le).not.toBeNull();
  });

  it('équipier : ni « Attribuer » ni dialogue à l’appui long', async () => {
    await preparer(EQUIPIER);
    await rendre(EQUIPIER);
    await attendre(() => filtre() !== null, 'équipe lue');
    expect(aBouton('Attribuer', conteneur)).toBe(false);
    await toucher(bouton('Tous', filtre() ?? conteneur));
    await appuiLong(tache(CHOU));
    for (let i = 0; i < 5; i++) await unTour();
    expect(dialogue('Attribuer')).toBeUndefined();
    expect(attributions()).toEqual([]);
  });
});

describe('T60 : fiche du jour par personne (règle 5)', () => {
  it('Paul : numéro, planche, travail, outil ; imprimable ; partageable en image', async () => {
    await preparer(UTILISATEUR, { travaux: true });
    const grelinette = ferme.attendu.cles.grelinette ?? '';
    await attribuerDeja(1, grelinette, PAUL);
    await attribuerDeja(2, CHOU, PAUL);
    await attribuerDeja(3, CAROTTE, MARIE);
    await rendre(UTILISATEUR);
    await attendre(() => filtre() !== null, 'équipe lue');
    await toucher(bouton('Fiche du jour', conteneur));
    await attendre(() => dialogue('Fiche du jour') !== undefined, 'fiche ouverte');
    const d = dialogueOuEchec('Fiche du jour');
    await remplir(liste('Personne', d), PAUL);
    const lignes = () => [...d.querySelectorAll<HTMLElement>('[data-testid="ligne-fiche"]')];
    const colonne = (l: HTMLElement, c: string) => texte(l.querySelector(`[data-colonne="${c}"]`));
    // Ses travaux : les siens et ceux de personne, dans l'ordre de l'écran ; pas la carotte de Marie.
    const attendues = ferme.attendu.taches.filter((c) => c !== CAROTTE);
    await attendre(() => lignes().length === attendues.length, 'une ligne par travail de Paul');
    expect(lignes().map((l) => l.dataset.cle)).toEqual(attendues);
    expect(lignes().map((l) => colonne(l, 'numero'))).toEqual(attendues.map((_, i) => String(i + 1)));
    const ligneGrelinette = lignes().find((l) => l.dataset.cle === grelinette);
    expect(ligneGrelinette).toBeDefined();
    if (ligneGrelinette === undefined) return;
    expect(colonne(ligneGrelinette, 'planche')).toBe('T2-P01');
    expect(colonne(ligneGrelinette, 'travail').toLowerCase()).toContain('grelinette');
    expect(colonne(ligneGrelinette, 'outil')).toBe('grelinette');
    const ligneChou = lignes().find((l) => l.dataset.cle === CHOU);
    expect(ligneChou === undefined ? '' : colonne(ligneChou, 'planche')).toBe('T2-P03');
    expect(ligneChou === undefined ? 'x' : colonne(ligneChou, 'outil')).toBe('');
    const imprimer = vi.fn();
    vi.stubGlobal('print', imprimer);
    window.print = imprimer;
    await toucher(bouton('Imprimer', d));
    expect(imprimer).toHaveBeenCalledTimes(1);
    expect(aBouton('Partager en image', d)).toBe(true);
  });

  it('la fiche s’ouvre sur « moi » pour l’équipier', async () => {
    await preparer(EQUIPIER);
    await rendre(EQUIPIER);
    await attendre(() => filtre() !== null, 'équipe lue');
    await toucher(bouton('Fiche du jour', conteneur));
    await attendre(() => dialogue('Fiche du jour') !== undefined, 'fiche ouverte');
    expect(liste('Personne', dialogueOuEchec('Fiche du jour')).value).toBe(PAUL);
  });
});
