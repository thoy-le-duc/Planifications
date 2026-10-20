// @vitest-environment happy-dom
/**
 * Tests d'acceptation T60 — la vue 3D numérote les travaux de la personne (docs/backlog/
 * T60-consignes-par-ouvrier.md, règle 4 ; critère « Test 3D : numérotation propre à la personne,
 * autres travaux grisés »). Sur la ferme du jour AVEC travaux (aujourd'hui = 2026-09-30), comme
 * travaux.test.ts ; les tests de T37 (sans personne) ne changent pas.
 *
 * ── Contrat (en plus de ./test/contrat-travaux.ts) ──────────────────────────────────────────
 *
 * travauxDuJour3d(taches, scene, pour) — `pour` : { parTache, personneId } (parTache :
 * personnesParTache du cœur), ou null / absent (« Tous » : comme T37).
 *   - `travaux` : les travaux de la personne seulement (attribués à elle ou à personne, travauxDe
 *     du cœur), numérotés 1, 2, 3… dans l'ordre reçu ;
 *   - `pastilles` : une par planche placée qui porte un de SES travaux (ses numéros, `autre`
 *     faux) ; une planche placée qui ne porte que des travaux des autres a une pastille grisée :
 *     `autre` vrai, `numeros` vide, `libelle` vide.
 * lireTravaux(porte, fermeId, jour, maintenant, utilisateurId) : la lecture porte aussi `equipe`
 *   ({ moi, gerant, parTache } : moi = la personne active liée au membre actif de l'utilisateur,
 *   ou null).
 * pourDe(lecture, mode) — mode de l'écran Aujourd'hui ('mes', 'tous', ou null s'il n'a pas été
 *   choisi) : 'mes', ou null pour un équipier, → { parTache, personneId: moi } ; sinon null (le
 *   gérant voit « Tous » par défaut ; sans « moi », toujours null).
 * CouchePastilles : une pastille `autre` a la classe plan3d-pastille-autre et data-autre="oui".
 */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import type { Id } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, lireJournee, type TacheJour } from '../aujourdhui/calculs.ts';
import { cleTache, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { VolumeScene } from './scene.ts';
import type { ModuleVuesAujourdhui, Travail3d } from './test/contrat-travaux.ts';
import type { PorteDonnees } from '@planif/sync';

const CHEMIN_TRAVAUX = './travaux.ts';
const CHEMIN_PASTILLES = './Pastilles.tsx';
const CHEMIN_VUES = '../aujourdhui/vues.ts';
const AUJOURDHUI = '2026-09-30';

interface Pour {
  readonly parTache: ReadonlyMap<string, readonly string[]>;
  readonly personneId: string;
}
interface Pastille {
  readonly planche: string;
  readonly x: number;
  readonly z: number;
  readonly numeros: readonly number[];
  readonly libelle: string;
  readonly autre?: boolean;
}
interface Lecture {
  readonly taches: readonly TacheJour[];
  readonly numero: number;
  readonly equipe: { readonly moi: string | null; readonly gerant: boolean; readonly parTache: ReadonlyMap<string, readonly string[]> };
}
interface ModuleTravauxPersonne {
  travauxDuJour3d(taches: readonly TacheJour[], scene: { readonly volumes: readonly unknown[] }, pour?: Pour | null): { readonly travaux: readonly Travail3d[]; readonly pastilles: readonly Pastille[] };
  lireTravaux(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date, utilisateurId?: string): Promise<Lecture>;
  pourDe(lecture: Lecture, mode: 'mes' | 'tous' | null): Pour | null;
}
interface ProprietesCouche {
  readonly pastilles: readonly { readonly pastille: Pastille; readonly retard: boolean }[];
  readonly actif: string | null;
  readonly couche: { current: HTMLDivElement | null };
}
interface ModulePastilles {
  readonly CouchePastilles: (p: ProprietesCouche) => ReactNode;
}

const id = (n: number) => `0192f0c1-6060-7000-8000-${n.toString(16).padStart(12, '0')}`;
const EQUIPIER = id(0x1);
const MEMBRE_EQUIPIER = id(0x2);
const PAUL = id(0x11);
const MARIE = id(0x12);

let m: ModuleTravauxPersonne;
let vues: ModuleVuesAujourdhui;
let ferme: FermeDuJour;
let taches: readonly TacheJour[];
let base: BaseMemoire;

const horo = { cree_le: '2026-09-01T08:00:00.000Z', modifie_le: '2026-09-01T08:00:00.000Z' };
const cleDe = (nom: string): string => ferme.attendu.cles[nom] ?? '';
const CHOU = cleTache(SERIE.chou, 'plantation');

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravauxPersonne;
  vues = (await import(/* @vite-ignore */ CHEMIN_VUES)) as ModuleVuesAujourdhui;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'equipier', 'accepte', NULL, NULL, ?, ?, NULL)`,
      [MEMBRE_EQUIPIER, EQUIPIER, FERME, horo.cree_le, horo.modifie_le],
    );
    const p = 'INSERT INTO personne (id, ferme_id, prenom, membre_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)';
    await tx.execute(p, [PAUL, FERME, 'Paul', MEMBRE_EQUIPIER, horo.cree_le, horo.modifie_le]);
    await tx.execute(p, [MARIE, FERME, 'Marie', null, horo.cree_le, horo.modifie_le]);
    const a = 'INSERT INTO attribution (id, ferme_id, personne_id, cle_tache, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)';
    await tx.execute(a, [id(0x101), FERME, PAUL, CHOU, horo.cree_le, horo.modifie_le]);
    await tx.execute(a, [id(0x102), FERME, MARIE, ferme.attendu.cles.grelinette ?? '', horo.cree_le, horo.modifie_le]);
    await tx.execute(a, [id(0x103), FERME, MARIE, ferme.attendu.cles.desherbage ?? '', horo.cree_le, horo.modifie_le]);
    await tx.execute(a, [id(0x104), FERME, MARIE, ferme.attendu.cles.palissage ?? '', horo.cree_le, horo.modifie_le]);
  });
  const lignes = await lireJournee(creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> }), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`));
  taches = vues.tachesDeLEcran(calculerJournee(lignes, AUJOURDHUI).taches);
});

const volume = (vid: string, code: string, x: number, placee: boolean): VolumeScene => ({
  id: vid,
  code,
  zoneId: 'zone',
  x,
  z: 2 * x,
  longueur: 12,
  largeur: 0.8,
  hauteur: 0.3,
  angle: 0,
  placee,
  couleur: '#888888',
  cleFamille: null,
  culture: null,
  occupationId: null,
});
const SCENE = {
  volumes: [volume(EMPLACEMENT.t2p01, 'T2-P01', 1, true), volume(EMPLACEMENT.t2p03, 'T2-P03', 2, true), volume(EMPLACEMENT.t2p07, 'T2-P07', 3, true), volume(EMPLACEMENT.pcp01, 'PC-P01', 4, false)],
};

const porteDe = (utilisateurId: string): PorteDonnees => creerPorte(base, { utilisateurId: utilisateurId as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });

describe('T60 : la 3D numérote les travaux de la personne', () => {
  it('Paul : ses travaux et ceux de personne, numérotés 1…6 dans l’ordre du jour ; ceux de Marie n’ont pas de numéro', async () => {
    const lecture = await m.lireTravaux(porteDe(EQUIPIER), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`), EQUIPIER);
    expect(lecture.equipe.moi).toBe(PAUL);
    expect(lecture.equipe.gerant).toBe(false);
    const pour = m.pourDe(lecture, null);
    expect(pour?.personneId).toBe(PAUL);
    const jour = m.travauxDuJour3d(taches, SCENE, pour);
    const marie = new Set([cleDe('grelinette'), cleDe('desherbage'), cleDe('palissage')]);
    const siens = ferme.attendu.taches.filter((c) => !marie.has(c));
    expect(jour.travaux.map((t) => t.cle)).toEqual(siens);
    expect(jour.travaux.map((t) => t.rang)).toEqual(siens.map((_, i) => i + 1));
    expect(jour.travaux.find((t) => t.cle === CHOU)?.texte.startsWith(`${String(siens.indexOf(CHOU) + 1)}. `)).toBe(true);
  });

  it('pastilles : T2-P01 et T2-P03 portent ses numéros ; T2-P07 (travaux de Marie seulement) est grisée, sans numéro', async () => {
    const lecture = await m.lireTravaux(porteDe(EQUIPIER), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`), EQUIPIER);
    const jour = m.travauxDuJour3d(taches, SCENE, m.pourDe(lecture, 'mes'));
    const par = new Map(jour.pastilles.map((p) => [p.planche, p]));
    const rangDe = (cle: string) => jour.travaux.find((t) => t.cle === cle)?.rang ?? -1;
    expect(par.get(EMPLACEMENT.t2p01)).toMatchObject({ numeros: [rangDe(cleDe('compost')), rangDe(cleTache(SERIE.batavia, 'plantation'))], autre: false });
    expect(par.get(EMPLACEMENT.t2p03)).toMatchObject({ numeros: [rangDe(CHOU)], libelle: String(rangDe(CHOU)), autre: false });
    expect(par.get(EMPLACEMENT.t2p07)).toMatchObject({ numeros: [], libelle: '', autre: true });
  });

  it('« Tous » (ou le gérant par défaut) : la numérotation de T37, sans pastille grisée', async () => {
    const equipier = await m.lireTravaux(porteDe(EQUIPIER), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`), EQUIPIER);
    expect(m.pourDe(equipier, 'tous')).toBeNull();
    const gerant = await m.lireTravaux(porteDe(UTILISATEUR), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`), UTILISATEUR);
    expect(gerant.equipe.gerant).toBe(true);
    // Le gérant n'a pas de personne dans cette équipe : jamais de filtre.
    expect(gerant.equipe.moi).toBeNull();
    expect(m.pourDe(gerant, 'mes')).toBeNull();
    const tous = m.travauxDuJour3d(taches, SCENE, null);
    expect(tous.travaux.map((t) => t.cle)).toEqual(ferme.attendu.taches);
    expect(tous.pastilles.every((p) => p.autre !== true)).toBe(true);
  });

  it('la couche dessine la pastille d’un autre grisée (classe et data-autre)', async () => {
    const p = (await import(/* @vite-ignore */ CHEMIN_PASTILLES)) as ModulePastilles;
    const lecture = await m.lireTravaux(porteDe(EQUIPIER), FERME, AUJOURDHUI, new Date(`${AUJOURDHUI}T09:00:00Z`), EQUIPIER);
    const jour = m.travauxDuJour3d(taches, SCENE, m.pourDe(lecture, 'mes'));
    const conteneur = document.createElement('div');
    document.body.append(conteneur);
    const racine = createRoot(conteneur);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const Couche = p.CouchePastilles;
    act(() => {
      racine.render(<Couche pastilles={jour.pastilles.map((pastille) => ({ pastille, retard: false }))} actif={null} couche={{ current: null }} />);
    });
    const disque = conteneur.querySelector<HTMLElement>(`[data-planche="${EMPLACEMENT.t2p07}"]`);
    expect(disque?.dataset.autre).toBe('oui');
    expect(disque?.classList.contains('plan3d-pastille-autre')).toBe(true);
    const sien = conteneur.querySelector<HTMLElement>(`[data-planche="${EMPLACEMENT.t2p03}"]`);
    expect(sien?.dataset.autre).toBe('non');
    act(() => {
      racine.unmount();
    });
    conteneur.remove();
  });
});
