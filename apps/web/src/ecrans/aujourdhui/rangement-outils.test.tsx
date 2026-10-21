// @vitest-environment happy-dom
/**
 * Tests d'acceptation T61 — la consigne du jour dit où est l'outil (docs/backlog/T61-chemins-
 * outils.md, règle 3 : « La consigne du jour (T60) affiche « Grelinette — hangar, mur nord », et
 * un tap montre le chemin dans la 3D »). Vrai écran dans un DOM simulé (happy-dom), sur la ferme
 * du jour (./test/ferme-du-jour.ts, aujourd'hui = 2026-09-30) et la porte de @planif/sync, sans
 * réseau. La suite T60 (equipe.test.tsx) reste valable : sans outil connu, la fiche montre le nom
 * du travail prévu tel quel (« grelinette »).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Le rangement se lit À LA DEMANDE, avec l'équipe (./equipe/), hors du morceau d'Aujourd'hui, dans
 * la ferme de la porte seulement (outil, lieu_rangement, place_rangement, batiment, point_plan,
 * lignes non supprimées). Le travail prévu porte le NOM de l'outil (« grelinette ») : l'outil de la
 * ferme est celui qui porte ce nom (`trouverOutil` du cœur : sans majuscules, accents ni espaces
 * autour). Texte (`libelleRangement` du cœur) : « Grelinette — hangar, mur nord » = nom de l'outil
 * (capitale), nom de son bâtiment ou de son point du plan, nom de sa place.
 *
 * Fiche du jour (T60, règle 5), colonne `outil` d'une ligne dont l'outil est rangé : un bouton
 * `montrer-rangement` (au moins 44 px, nom accessible = le texte) qui porte le texte ci-dessus.
 * Le toucher appelle UNE fois la propriété facultative `surMontrerRangement` d'EcranAujourdhui avec
 * { outilId, cle (de la tâche), plancheId (premier emplacement de la tâche, ou null) } ; rien
 * d'autre : aucun calcul de chemin, aucune écriture, aucun réseau. Outil introuvable (aucune ligne
 * du nom, outil ou lieu retiré, autre ferme) : le nom du travail prévu seul, sans bouton. Place
 * retirée ou absente : « Grelinette — hangar ».
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { EMPLACEMENT, ecrireFermeDuJour, FERME, UTILISATEUR, type FermeDuJour } from './test/ferme-du-jour.ts';
import { attendre, bouton, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

const id = (n: number) => `0192f0c1-6161-7000-8000-${n.toString(16).padStart(12, '0')}`;
const MARIE = id(0x12);
const AUTRE_FERME = id(0x99);
const HANGAR = id(0x20);
const LIEU_HANGAR = id(0x21);
const PLACE_MUR_NORD = id(0x22);
const OUTIL_GRELINETTE = id(0x23);
const POINT_ABRI = id(0x24);
const CAVE = id(0x30);
const LIEU_CAVE = id(0x31);
const OUTIL_VOISIN = id(0x32);
const horo = { cree_le: '2026-09-01T08:00:00.000Z', modifie_le: '2026-09-01T08:00:00.000Z' };

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

interface OptionsRangement {
  /** Pas de ligne d'outil du tout. */
  readonly sansOutil?: boolean;
  /** La place « mur nord » est retirée. */
  readonly placeRetiree?: boolean;
  /** L'outil est retiré. */
  readonly outilRetire?: boolean;
  /** Le lieu est un point d'eau « Abri du verger » (et non le hangar). */
  readonly lieuPoint?: boolean;
  /** Le nom de l'outil est écrit « Grelinette » (défaut) ou autre (casse, accents). */
  readonly nomOutil?: string;
}

async function preparer(o: OptionsRangement = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  await base.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO personne (id, ferme_id, prenom, membre_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, NULL, ?, ?, NULL)', [MARIE, FERME, 'Marie', horo.cree_le, horo.modifie_le]);
    await tx.execute('INSERT INTO attribution (id, ferme_id, personne_id, cle_tache, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)', [id(0x100), FERME, MARIE, ferme.attendu.cles.grelinette ?? '', horo.cree_le, horo.modifie_le]);
    if (o.sansOutil === true) return;
    const batiment = 'INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, 20, 12, 6, -10, 15, 0, NULL, ?, ?, NULL)';
    await tx.execute(batiment, [HANGAR, FERME, 'hangar', 'hangar', horo.cree_le, horo.modifie_le]);
    await tx.execute(batiment, [CAVE, AUTRE_FERME, 'cave', 'local', horo.cree_le, horo.modifie_le]);
    await tx.execute('INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, 80, 10, ?, ?, NULL)', [POINT_ABRI, FERME, 'Abri du verger', 'repere', horo.cree_le, horo.modifie_le]);
    const lieu = 'INSERT INTO lieu_rangement (id, ferme_id, batiment_id, point_plan_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)';
    await tx.execute(lieu, [LIEU_HANGAR, FERME, o.lieuPoint === true ? null : HANGAR, o.lieuPoint === true ? POINT_ABRI : null, horo.cree_le, horo.modifie_le]);
    await tx.execute(lieu, [LIEU_CAVE, AUTRE_FERME, CAVE, null, horo.cree_le, horo.modifie_le]);
    await tx.execute('INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      PLACE_MUR_NORD,
      FERME,
      LIEU_HANGAR,
      'mur nord',
      horo.cree_le,
      horo.modifie_le,
      o.placeRetiree === true ? horo.modifie_le : null,
    ]);
    const outil = 'INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, place_rangement_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    await tx.execute(outil, [OUTIL_GRELINETTE, FERME, o.nomOutil ?? 'Grelinette', LIEU_HANGAR, PLACE_MUR_NORD, horo.cree_le, horo.modifie_le, o.outilRetire === true ? horo.modifie_le : null]);
    // Une autre ferme range sa grelinette à la cave : jamais utilisée ici.
    await tx.execute(outil, [OUTIL_VOISIN, AUTRE_FERME, 'Grelinette', LIEU_CAVE, null, horo.cree_le, horo.modifie_le, null]);
  });
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
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
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
});

function stockageMemoire(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

type SurMontrer = (cible: { outilId: string; cle: string; plancheId: string | null }) => void;

async function ouvrirFiche(surMontrerRangement?: SurMontrer): Promise<HTMLElement> {
  await act(async () => {
    const Ecran = ecran.EcranAujourdhui as unknown as (p: Record<string, unknown>) => React.ReactNode;
    racine.render(<Ecran porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} utilisateurId={UTILISATEUR} stockage={stockageMemoire()} surMontrerRangement={surMontrerRangement} />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelectorAll('[data-testid="tache"]').length > 0, 'tâches affichées');
  await attendre(() => conteneur.querySelector('[data-testid="filtre-travaux"]') !== null || [...conteneur.querySelectorAll('button')].some((b) => texte(b) === 'Fiche du jour'), 'équipe lue');
  await toucher(bouton('Fiche du jour', conteneur));
  await attendre(() => dialogue('Fiche du jour') !== undefined, 'fiche ouverte');
  const d = dialogueOuEchec('Fiche du jour');
  await remplir(liste('Personne', d), MARIE);
  const cle = ferme.attendu.cles.grelinette ?? '';
  await attendre(() => d.querySelector(`[data-testid="ligne-fiche"][data-cle="${cle}"]`) !== null, 'ligne de la grelinette');
  return d;
}

const celluleOutil = (d: HTMLElement): HTMLElement => {
  const l = d.querySelector<HTMLElement>(`[data-testid="ligne-fiche"][data-cle="${ferme.attendu.cles.grelinette ?? ''}"]`);
  const c = l?.querySelector<HTMLElement>('[data-colonne="outil"]');
  if (c === null || c === undefined) throw new Error('colonne outil absente');
  return c;
};

describe('T61 : la consigne du jour dit où est l’outil', () => {
  it('« Grelinette — hangar, mur nord » dans la fiche du jour, un bouton de 44 px au moins', async () => {
    await preparer();
    const d = await ouvrirFiche();
    await attendre(() => texte(celluleOutil(d)) === 'Grelinette — hangar, mur nord', 'rangement lu');
    const b = celluleOutil(d).querySelector<HTMLElement>('[data-testid="montrer-rangement"]');
    expect(b, 'bouton montrer-rangement').not.toBeNull();
    expect(b?.tagName).toBe('BUTTON');
    expect((b?.getAttribute('aria-label') ?? texte(b)).trim()).toBe('Grelinette — hangar, mur nord');
  });

  it('un tap : surMontrerRangement appelé UNE fois avec l’outil, la tâche et la première planche ; ni écriture ni réseau', async () => {
    await preparer();
    const surMontrer = vi.fn<SurMontrer>();
    const d = await ouvrirFiche(surMontrer);
    await attendre(() => celluleOutil(d).querySelector('[data-testid="montrer-rangement"]') !== null, 'rangement lu');
    const avant = transactions;
    const b = celluleOutil(d).querySelector<HTMLElement>('[data-testid="montrer-rangement"]');
    if (b === null) throw new Error('bouton absent');
    await toucher(b);
    expect(surMontrer).toHaveBeenCalledTimes(1);
    expect(surMontrer).toHaveBeenCalledWith({ outilId: OUTIL_GRELINETTE, cle: ferme.attendu.cles.grelinette, plancheId: EMPLACEMENT.t2p01 });
    expect(transactions, 'aucune écriture').toBe(avant);
  });

  it('l’outil d’une autre ferme du même nom n’est jamais utilisé (la cave n’apparaît pas)', async () => {
    await preparer();
    const d = await ouvrirFiche();
    await attendre(() => texte(celluleOutil(d)).includes('hangar'), 'rangement lu');
    expect(texte(d)).not.toContain('cave');
  });

  it('le nom saisi diffère par la casse et les accents : « GRELINETTE » rangée est trouvée, affichée avec une capitale', async () => {
    await preparer({ nomOutil: ' GRELINETTE ' });
    const d = await ouvrirFiche();
    await attendre(() => texte(celluleOutil(d)).includes('hangar'), 'rangement lu');
    expect(texte(celluleOutil(d))).toBe('GRELINETTE — hangar, mur nord');
  });

  it('un point du plan comme lieu de rangement : « Grelinette — Abri du verger, mur nord »', async () => {
    await preparer({ lieuPoint: true });
    const d = await ouvrirFiche();
    await attendre(() => texte(celluleOutil(d)).includes('Abri du verger'), 'rangement lu');
    expect(texte(celluleOutil(d))).toBe('Grelinette — Abri du verger, mur nord');
  });

  it('place retirée : « Grelinette — hangar » seul', async () => {
    await preparer({ placeRetiree: true });
    const d = await ouvrirFiche();
    await attendre(() => texte(celluleOutil(d)).includes('hangar'), 'rangement lu');
    expect(texte(celluleOutil(d))).toBe('Grelinette — hangar');
  });

  it.each([
    ['aucune ligne d’outil', { sansOutil: true }],
    ['outil retiré', { outilRetire: true }],
  ])('%s : le nom du travail prévu tel quel, sans bouton ni « — »', async (_cas, options) => {
    await preparer(options);
    const d = await ouvrirFiche();
    // Laisser à la lecture du rangement le temps d'arriver (elle ne doit rien changer).
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
    expect(texte(celluleOutil(d))).toBe('grelinette');
    expect(celluleOutil(d).querySelector('[data-testid="montrer-rangement"]')).toBeNull();
  });
});
