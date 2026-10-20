// @vitest-environment happy-dom
/**
 * Tests d'acceptation T55 — repères « Ne pas récolter » dans la vue 3D, composant : ils vivent
 * dans le morceau des vannes chargé à part (plan3d/Vannes3d.tsx, T57), posés dans la même couche
 * que les repères des vannes (replacés par la vue à chaque image, aucun appel de dessin). Base
 * mémoire du téléphone, aucun réseau. Contrat : ./test/contrat-dar3d.ts.
 *
 * Ferme des vannes (../parcellaire/test/ferme-vannes.ts) : V12 arrose P3 et P4, V13 PC-01.
 * P3 est traitée le dimanche 10/05/2026 à la bouillie bordelaise, DAR 3 jours : récolte autorisée
 * le 13/05. Le curseur de la 3D choisit une semaine (son lundi : 4/05, 11/05, 18/05).
 */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, nomAccessible, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { ecrireFermeVannes, FERME, P3, P4, P5, PC1, PC2, UTILISATEUR } from '../parcellaire/test/ferme-vannes.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';
import { CHEMIN_COMPOSANT_VANNES_3D, TESTID_VANNES_3D } from './test/contrat-vannes.ts';
import { TESTID_DAR_3D as T, TEXTE_REPERE_DAR, type EtatVannes3d, type ProprietesVannes3d, type VolumeFiltreDar } from './test/contrat-dar3d.ts';

interface ModuleComposant {
  readonly Vannes3d: (p: ProprietesVannes3d) => ReturnType<typeof createElement>;
}

let m: ModuleComposant;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_COMPOSANT_VANNES_3D)) as ModuleComposant;
});

const BOUILLIE = '0192f0c1-5555-7000-8000-0000000000b1';
const TRAITEMENT = '0192f0c1-5555-7000-8000-000000000200';

const vol = (id: string, code: string, x: number): VolumeScene => ({ id, code, zoneId: 'z', x, z: 0, longueur: 30, largeur: 0.8, hauteur: 0.3, angle: 0, placee: true, couleur: '#336633', cleFamille: null, culture: 'Fraise', occupationId: null });
const VOLUMES: readonly VolumeScene[] = [vol(P3, 'P3', 0), vol(P4, 'P4', 2), vol(P5, 'P5', 4), vol(PC1, 'PC-01', 40), vol(PC2, 'PC-02', 42)];
const SCENE: Scene = { semaine: 0, libelleSemaine: 'S19', socles: [], batiments: [], volumes: VOLUMES };

let base: BaseMemoire;
let porte: PorteDonnees;
let conteneur: HTMLDivElement;
let racine: Root;
let etats: EtatVannes3d[];

async function traiter(id: string, date: string, autorisee: string, emplacements: readonly string[], annule?: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', ?, ?, ?, 'tap', NULL, NULL, ?, NULL, '[]', ?, ?, ?, ?)`,
      [
        id,
        FERME,
        date,
        `${date}T07:00:00.000Z`,
        UTILISATEUR,
        JSON.stringify(emplacements),
        annule === undefined ? null : 'annulation',
        annule ?? null,
        JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe: autorisee }),
        `${date}T07:00:00.000Z`,
      ],
    );
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  etats = [];
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hors ligne'))));
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, { vannes: true });
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
      [BOUILLIE, FERME],
    );
  });
  await traiter(TRAITEMENT, '2026-05-10', '2026-05-13', [P3]);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base.fermer();
});

const couche = createRef<HTMLDivElement>();
async function rendre(aujourdhui: string, jour: string | undefined): Promise<void> {
  await act(async () => {
    racine.render(
      createElement(m.Vannes3d, {
        porte,
        fermeId: FERME,
        volumes: VOLUMES,
        couche,
        surEtat: (e: EtatVannes3d) => {
          etats.push(e);
        },
        aujourdhui: () => aujourdhui,
        maintenant: () => new Date(`${aujourdhui}T09:00:00.000Z`),
        jour,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => document.querySelectorAll(`[data-testid="${TESTID_VANNES_3D.repere}"]`).length > 0, 'repères des vannes affichés');
  // Laisse la lecture des traitements se faire.
  for (let i = 0; i < 20; i++) await unTour();
}

const reperesDar = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.repere}"]`)];
const dernier = (): EtatVannes3d => {
  const e = etats.at(-1);
  if (e === undefined) throw new Error('surEtat jamais appelé');
  return e;
};
const marquees = (e: EtatVannes3d): string[] => (e.colorer(appliquerFiltres(SCENE, FILTRES_TOUT)).volumes as readonly VolumeFiltreDar[]).filter((v) => v.dar === true).map((v) => v.id);

describe('T55 : repère « Ne pas récolter » (traité le 10/05, DAR 3 j)', () => {
  it.each([
    ['2026-05-10', '2026-05-04'],
    ['2026-05-11', '2026-05-11'],
    ['2026-05-12', '2026-05-11'],
  ])('le %s (semaine du %s) : un repère sur P3, dans la couche des vannes, après elles', async (aujourdhui, lundi) => {
    await rendre(aujourdhui, lundi);
    await attendre(() => reperesDar().length === 1, 'repère DAR affiché');
    const r = reperesDar()[0];
    if (r === undefined) throw new Error('repère absent');
    expect(r.tagName).toBe('BUTTON');
    expect(r.dataset.planche).toBe(P3);
    expect(nomAccessible(r)).toBe('Ne pas récolter, P3');
    expect(texte(r)).toBe(TEXTE_REPERE_DAR);
    // Même couche que les vannes, après leurs repères : l'ordre des boutons est celui de `reperes`.
    expect(r.parentElement).toBe(couche.current);
    const enfants = [...(couche.current?.children ?? [])].map((e) => (e as HTMLElement).dataset.testid);
    expect(enfants).toEqual([TESTID_VANNES_3D.repere, TESTID_VANNES_3D.repere, T.repere]);
    expect(dernier().reperes.map((p) => [p.pastille.x, p.pastille.z])).toEqual([
      [-15, 0],
      [25, 0],
      [0, 0],
    ]);
    expect(dernier().actif).toBe(true);
    expect(marquees(dernier())).toEqual([P3]);
  });

  it('le 13/05 : plus de repère, rien à colorer', async () => {
    await rendre('2026-05-13', '2026-05-11');
    expect(reperesDar()).toHaveLength(0);
    expect(dernier().reperes).toHaveLength(2);
    expect(dernier().actif).toBe(false);
    expect(marquees(dernier())).toEqual([]);
  });

  it('tap : la fiche dit « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise…) » ; « Fermer » la referme', async () => {
    await rendre('2026-05-11', '2026-05-11');
    await attendre(() => reperesDar().length === 1, 'repère DAR affiché');
    const r = reperesDar()[0];
    if (r === undefined) throw new Error('repère absent');
    await toucher(r);
    const fiche = document.querySelector<HTMLElement>(`[data-testid="${T.fiche}"]`);
    expect(fiche?.getAttribute('role')).toBe('dialog');
    expect(texte(fiche)).toContain('Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)');
    const fermer = [...(fiche?.querySelectorAll('button') ?? [])].find((b) => texte(b) === 'Fermer');
    if (fermer === undefined) throw new Error('« Fermer » absent');
    await toucher(fermer);
    expect(document.querySelector(`[data-testid="${T.fiche}"]`)).toBeNull();
  });

  it('règle 4 : le curseur de semaine fait apparaître puis disparaître le repère', async () => {
    // Aujourd'hui 20/05 : plus rien. Curseur sur la semaine du 11/05 (son lundi) : P3 sous DAR.
    await rendre('2026-05-20', '2026-05-18');
    expect(reperesDar()).toHaveLength(0);
    await rendre('2026-05-20', '2026-05-11');
    await attendre(() => reperesDar().length === 1, 'repère DAR à la semaine du 11/05');
    expect(dernier().actif).toBe(true);
    // Semaine du 4/05 (lundi, avant le traitement) : rien.
    await rendre('2026-05-20', '2026-05-04');
    await attendre(() => reperesDar().length === 0, 'repère retiré à la semaine du 4/05');
    expect(dernier().actif).toBe(false);
    await rendre('2026-05-20', '2026-05-18');
    expect(reperesDar()).toHaveLength(0);
  });

  it('un traitement annulé ne laisse aucun repère', async () => {
    await traiter('0192f0c1-5555-7000-8000-000000000201', '2026-05-10', '2026-05-13', [P3], TRAITEMENT);
    await rendre('2026-05-11', '2026-05-11');
    expect(reperesDar()).toHaveLength(0);
  });

  it('relecture : une autre semaine aux mêmes repères ne redonne pas d’état à la vue (pas de second rendu de la scène)', async () => {
    // P4 traitée le 1/05, récolte autorisée le 1/06 : sous DAR les semaines du 18/05 et du 25/05.
    await traiter('0192f0c1-5555-7000-8000-000000000202', '2026-05-01', '2026-06-01', [P4]);
    const surEtat = (e: EtatVannes3d) => {
      etats.push(e);
    };
    const montrer = async (jour: string) => {
      await act(async () => {
        racine.render(createElement(m.Vannes3d, { porte, fermeId: FERME, volumes: VOLUMES, couche, surEtat, aujourdhui: () => '2026-06-10', maintenant: () => new Date('2026-06-10T09:00:00.000Z'), jour }));
        await Promise.resolve();
      });
      for (let i = 0; i < 20; i++) await unTour();
    };
    await montrer('2026-05-18');
    await attendre(() => reperesDar().length === 1, 'repère DAR sur P4');
    const avant = etats.length;
    await montrer('2026-05-25');
    expect(reperesDar().map((r) => r.dataset.planche)).toEqual([P4]);
    expect(etats.length).toBe(avant);
  });

  it('sans traitement sous DAR, les vannes ne changent pas (T57) : deux repères, rien d’actif', async () => {
    await rendre('2026-10-19', '2026-10-19');
    expect(reperesDar()).toHaveLength(0);
    expect(dernier().reperes).toHaveLength(2);
    expect(dernier().actif).toBe(false);
    expect(dernier().evidence).toBeNull();
    expect(dernier().irrigation).toBe(false);
  });
});
