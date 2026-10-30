// @vitest-environment happy-dom
/**
 * Tests d'acceptation T91 (règle 3) — UN SEUL repère pour les planches d'une sous-zone hors serre :
 * celui de la sous-zone si elle a un contour, sinon celui de la racine, le même dans l'éditeur et dans
 * la scène 3D. Les mêmes lignes de base alimentent l'éditeur (rendu pour de vrai, base mémoire) et le
 * plan (`construirePlan`) dont `versScene` tire la scène : la planche doit être au même point.
 *
 * Ferme : « Plein champ » (contour 40 × 30 en (100 ; 0)), sous-zone « Rang 3 » (ZONE_ENFANT, contour
 * 40 × 30 en (5000 ; 0)), sous-zone « Sous-champ » sans contour. Une planche placée dans chacune, plus
 * PC-01, planche directe de la racine.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { construirePlan, type DonneesPlan } from '../plan/calculs.ts';
import { versScene } from '../plan3d/scene.ts';
import { attendre } from '../itineraires/test/outils.ts';
import { EditeurPlacement } from './index.ts';
import { TESTID_PLACEMENT as T } from './test/contrat.ts';
import { CREE_LE, ecrireFermePlacement, fermePlacement, FERME, PLANCHE, UTILISATEUR, ZONE_CHAMP, ZONE_ENFANT } from './test/ferme-placement.ts';
import { deverrouiller } from './test/deverrouiller.ts';

const MAINTENANT = new Date('2026-10-08T08:00:00.000Z');
const SOUS_CHAMP = '0192f0c1-0000-7000-8000-0000000000a1';
const P_RANG = '0192f0c1-0000-7000-8000-0000000000a2';
const P_SOUS = '0192f0c1-0000-7000-8000-0000000000a3';
const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };

type Ligne = Readonly<Record<string, string | number | null>>;

const ZONE_SANS_CONTOUR: Ligne = { id: SOUS_CHAMP, ferme_id: FERME, nom: 'Sous-champ', zone_parente_id: ZONE_CHAMP, type_abri: 'plein_champ', surface_m2: 100, contour: null, ...horo };
const planche = (id: string, zoneId: string, code: string, x: number, y: number, orientation: number): Ligne => ({
  id,
  ferme_id: FERME,
  zone_id: zoneId,
  code,
  sorte: 'planche',
  longueur_m: 12,
  largeur_m: 0.8,
  nombre_places: null,
  actif_du: '2020-01-01',
  actif_au: null,
  remplace: '[]',
  placement_x_m: x,
  placement_y_m: y,
  orientation_deg: orientation,
  ...horo,
});
const PLANCHES_AJOUTEES = [planche(P_RANG, ZONE_ENFANT, 'RG-01', 3, 4, 30), planche(P_SOUS, SOUS_CHAMP, 'SC-01', 5, 6, 90)];

function inserer(base: BaseMemoire, table: string, l: Ligne): void {
  const colonnes = Object.keys(l);
  base.recevoir(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, colonnes.map((c) => l[c]));
}

let conteneur: HTMLDivElement;
let racine: Root;
let base: BaseMemoire;
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

const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];

async function ouvrirEditeur(): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, deuxSites: true, saison: true });
  inserer(base, 'zone', ZONE_SANS_CONTOUR);
  for (const p of PLANCHES_AJOUTEES) inserer(base, 'emplacement', p);
  const porte: PorteDonnees = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  await act(async () => {
    racine.render(createElement(EditeurPlacement, { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true }));
    await Promise.resolve();
  });
  await attendre(() => (document.querySelector('[data-testid="editeur-placement"]')?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
  await attendre(() => tous(T.planche).length > 0, 'planches affichées');
}

/** Le plan de la 2D bâti sur les mêmes lignes que l'éditeur. */
function planDesMemesLignes() {
  const l = fermePlacement({ origine: true, deuxSites: true, saison: true }).lignes;
  const donnees: DonneesPlan = {
    zone: [...(l.zone ?? []), ZONE_SANS_CONTOUR],
    emplacement: [...(l.emplacement ?? []), ...PLANCHES_AJOUTEES],
    occupation: [],
    serie: [],
    plantation: [],
    espece: [],
    variete: [],
    famille: [],
    batiment: l.batiment ?? [],
  };
  return construirePlan(donnees, { saison: { id: 's', nom: '2026', debut: '2026-01-01', fin: '2026-12-31' }, aujourdhui: '2026-10-08' });
}

const mod360 = (d: number): number => ((d % 360) + 360) % 360;

describe('T91 : la planche est au même point dans l’éditeur et dans la scène 3D', () => {
  for (const [cas, id] of [
    ['sous-zone avec contour (Rang 3)', P_RANG],
    ['sous-zone sans contour (Sous-champ)', P_SOUS],
    ['planche directe de la racine (PC-01)', PLANCHE],
  ] as const) {
    it(cas, async () => {
      await ouvrirEditeur();
      const dansEditeur = tous(T.planche).find((e) => e.getAttribute('data-id') === id);
      expect(dansEditeur, 'planche affichée par l’éditeur').toBeDefined();
      const v = versScene(planDesMemesLignes(), 0).volumes.find((x) => x.id === id);
      expect(v, 'volume de la scène').toBeDefined();
      if (dansEditeur === undefined || v === undefined) return;
      expect(v.x).toBeCloseTo(Number(dansEditeur.getAttribute('data-x')), 2);
      expect(-v.z).toBeCloseTo(Number(dansEditeur.getAttribute('data-y')), 2);
      // Cap de la scène (angle de three) → cap de l'éditeur (degrés, sens horaire depuis le nord).
      const cap = mod360(90 - (v.angle * 180) / Math.PI);
      const ecart = Math.abs(mod360(cap - Number(dansEditeur.getAttribute('data-orientation')) + 180) - 180);
      expect(ecart).toBeLessThan(0.05);
    });
  }
});
