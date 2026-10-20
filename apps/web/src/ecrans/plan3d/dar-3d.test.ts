/**
 * Tests d'acceptation T55 — délai avant récolte (DAR) dans le jumeau 3D, partie pure : la date
 * montrée par le curseur, les repères « Ne pas récolter » (calcul du cœur, T52), la règle « le
 * DAR l'emporte sur à récolter » (recolte.ts, rendu des balises), et la couleur dédiée (jetons
 * existants, lisible en clair et en sombre). Contrat : ./test/contrat-dar3d.ts.
 */
import { readFileSync } from 'node:fs';
import { InstancedMesh, MeshBasicMaterial } from 'three';
import { ajouterJours, type DateCalendaire, type TraitementLu } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEUR_BALISE_FIN_RECOLTE_3D, COULEUR_BALISE_RECOLTE_3D, COULEURS, COULEURS_SOMBRES } from '../../ui/jetons.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type SceneFiltree, type VolumeScene } from './scene.ts';
import { plantsDePlanche, type PlantsPlanche } from './plants.ts';
import { RenduPlants } from './plants-rendu.ts';
import { aBalise, planchesARecolter } from './recolte.ts';
import { CHEMIN_DAR_3D, TEXTE_REPERE_DAR, type ModuleDar3d, type TraitementsDar, type VolumeFiltreDar } from './test/contrat-dar3d.ts';

let m: ModuleDar3d;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_DAR_3D)) as ModuleDar3d;
});

const P1 = '0192f0c1-5555-7000-8000-000000000001';
const P2 = '0192f0c1-5555-7000-8000-000000000002';
const P3 = '0192f0c1-5555-7000-8000-000000000003';
const BOUILLIE = '0192f0c1-5555-7000-8000-0000000000b1';
const SOUFRE = '0192f0c1-5555-7000-8000-0000000000b2';

const vol = (id: string, code: string, x: number, placee = true): VolumeScene => ({ id, code, zoneId: 'z', x, z: -x, longueur: 12, largeur: 0.8, hauteur: 0.3, angle: 0, placee, couleur: '#336633', cleFamille: null, culture: 'Tomate', occupationId: null });
const VOLUMES = [vol(P1, 'P1', 1), vol(P2, 'P2', 2), vol(P3, 'P3', 3, false)];

/** Traitement en vigueur fait le `date`, DAR figé à `autorisee`. */
const traitement = (id: string, date: string, autorisee: string, emplacements: readonly string[], produit = BOUILLIE, extra: Partial<TraitementLu> = {}): TraitementLu => ({
  id,
  date,
  horodatage: `${date}T07:00:00.000Z`,
  emplacementIds: emplacements,
  remplaceSorte: null,
  remplaceEvenementId: null,
  produitPhytoId: produit,
  recolteAutoriseeLe: autorisee,
  cultureId: null,
  ...extra,
});
const NOMS = new Map([
  [BOUILLIE, 'Bouillie bordelaise'],
  [SOUFRE, 'Soufre mouillable'],
]);
const lus = (traitements: readonly TraitementLu[]): TraitementsDar => ({ traitements, noms: NOMS });
/** Traité le 10/05, DAR 3 jours : récolte autorisée le 13/05. */
const LE_10_MAI = lus([traitement('0192f0c1-5555-7000-8000-000000000100', '2026-05-10', '2026-05-13', [P1])]);

describe('T55 : la date montrée par le curseur de semaine', () => {
  it('aujourd’hui si la semaine du curseur le contient, sinon le lundi de la semaine', () => {
    // Le 10/05/2026 est un dimanche : sa semaine commence le lundi 4/05.
    expect(m.dateAffichee('2026-05-04', '2026-05-10')).toBe('2026-05-10');
    expect(m.dateAffichee('2026-05-04', '2026-05-04')).toBe('2026-05-04');
    expect(m.dateAffichee('2026-05-11', '2026-05-13')).toBe('2026-05-13');
    // Le lundi suivant n'est plus dans la semaine.
    expect(m.dateAffichee('2026-05-04', '2026-05-11')).toBe('2026-05-04');
    // Semaine passée ou à venir : son lundi.
    expect(m.dateAffichee('2026-04-27', '2026-05-13')).toBe('2026-04-27');
    expect(m.dateAffichee('2026-06-01', '2026-05-13')).toBe('2026-06-01');
  });

  it('sans semaine (plan vide) : aujourd’hui', () => {
    expect(m.dateAffichee(undefined, '2026-05-13')).toBe('2026-05-13');
  });
});

describe('T55 : repères « Ne pas récolter » (critère : traité le 10/05, DAR 3 j)', () => {
  it('repère les 10, 11 et 12/05 ; absent le 13/05 (et avant le traitement)', () => {
    for (const jour of ['2026-05-10', '2026-05-11', '2026-05-12']) {
      expect(m.reperesDar(LE_10_MAI, VOLUMES, jour).map((r) => r.planche), jour).toEqual([P1]);
    }
    expect(m.reperesDar(LE_10_MAI, VOLUMES, '2026-05-13')).toEqual([]);
    expect(m.reperesDar(LE_10_MAI, VOLUMES, '2026-05-09')).toEqual([]);
  });

  it('le repère porte la planche, sa position et le texte du cœur (« Récolte interdite jusqu’au 13/05 (Produit, …) »)', () => {
    const [r] = m.reperesDar(LE_10_MAI, VOLUMES, '2026-05-11');
    expect(r).toEqual({ planche: P1, code: 'P1', x: 1, z: -1, texte: 'Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05)', recolteAutoriseeLe: '2026-05-13' });
  });

  it('plusieurs traitements : la date autorisée la plus tardive ; produit inconnu nommé comme tel', () => {
    const t = lus([
      traitement('0192f0c1-5555-7000-8000-000000000101', '2026-05-10', '2026-05-13', [P1, P2]),
      traitement('0192f0c1-5555-7000-8000-000000000102', '2026-05-11', '2026-05-19', [P2], SOUFRE),
      traitement('0192f0c1-5555-7000-8000-000000000103', '2026-05-11', '2026-05-12', [P1], '0192f0c1-5555-7000-8000-0000000000ff'),
    ]);
    const r = m.reperesDar(t, VOLUMES, '2026-05-11');
    expect(r.map((x) => [x.planche, x.recolteAutoriseeLe])).toEqual([
      [P1, '2026-05-13'],
      [P2, '2026-05-19'],
    ]);
    expect(r[1]?.texte).toBe('Récolte interdite jusqu’au 19/05 (Soufre mouillable, traité le 11/05)');
    const inconnu = lus([traitement('0192f0c1-5555-7000-8000-000000000104', '2026-05-11', '2026-05-12', [P1], '0192f0c1-5555-7000-8000-0000000000ff')]);
    expect(m.reperesDar(inconnu, VOLUMES, '2026-05-11')[0]?.texte).toBe('Récolte interdite jusqu’au 12/05 (produit inconnu, traité le 11/05)');
  });

  it('un traitement annulé ne laisse aucun repère ; une correction recalcule', () => {
    const origine = traitement('0192f0c1-5555-7000-8000-000000000110', '2026-05-10', '2026-05-13', [P1]);
    const annulation = traitement('0192f0c1-5555-7000-8000-000000000111', '2026-05-10', '2026-05-13', [P1], BOUILLIE, { horodatage: '2026-05-10T09:00:00.000Z', remplaceSorte: 'annulation', remplaceEvenementId: origine.id });
    expect(m.reperesDar(lus([origine, annulation]), VOLUMES, '2026-05-11')).toEqual([]);
    const correction = traitement('0192f0c1-5555-7000-8000-000000000112', '2026-05-10', '2026-05-11', [P1], BOUILLIE, { horodatage: '2026-05-10T09:00:00.000Z', remplaceSorte: 'correction', remplaceEvenementId: origine.id });
    expect(m.reperesDar(lus([origine, correction]), VOLUMES, '2026-05-11')).toEqual([]);
    expect(m.reperesDar(lus([origine, correction]), VOLUMES, '2026-05-10').map((r) => r.recolteAutoriseeLe)).toEqual(['2026-05-11']);
  });

  it('une planche non placée n’a pas de repère ; aucun traitement : aucun repère', () => {
    const t = lus([traitement('0192f0c1-5555-7000-8000-000000000120', '2026-05-10', '2026-05-13', [P3])]);
    expect(m.reperesDar(t, VOLUMES, '2026-05-11')).toEqual([]);
    expect(m.reperesDar(lus([]), VOLUMES, '2026-05-11')).toEqual([]);
  });

  it('identifiants comparés sans la casse (comme le cœur)', () => {
    const t = lus([traitement('0192f0c1-5555-7000-8000-000000000130', '2026-05-10', '2026-05-13', [P1.toUpperCase()])]);
    expect(m.reperesDar(t, VOLUMES, '2026-05-10').map((r) => r.planche)).toEqual([P1]);
  });

  it('le texte visible du repère est « Ne pas récolter »', () => {
    expect(m.TEXTE_REPERE_DAR).toBe(TEXTE_REPERE_DAR);
  });
});

// ── Règle 2 : le DAR l'emporte sur « à récolter » ────────────────────────────────────────────
const d = (s: string): DateCalendaire => s as DateCalendaire;
const DEBUT = d('2027-07-01');
const JOUR = ajouterJours(DEBUT, 10);
const courgette = (v: VolumeScene): PlantsPlanche | null =>
  plantsDePlanche({
    volume: v,
    culture: {
      espece: 'Courgette',
      profil: profilParDefaut('Courgette').profil,
      croissance: {
        sorte: 'annuelle',
        dates: {
          miseEnPlace: { prevue: d('2027-04-01'), reelle: null },
          debutRecolte: { prevue: DEBUT, reelle: null },
          finRecolte: { prevue: d('2027-09-15'), reelle: null },
          arrachage: { prevue: d('2027-10-15'), reelle: null },
        },
      },
      ecartementM: 0.6,
    },
    jour: JOUR,
    horsSol: false,
  });
const DEUX = [vol(P1, 'P1', 1), vol(P2, 'P2', 4)];
const SCENE: Scene = { semaine: 0, libelleSemaine: 'S28', socles: [], batiments: [], volumes: DEUX };
const PLANTS = DEUX.map(courgette);

function balisesPosees(filtree: SceneFiltree): number {
  const rendu = new RenduPlants();
  for (const forme of ['erige-tuteure', 'rosette', 'touffe', 'rampant', 'buisson', 'arbre-ou-liane', 'bulbe-ou-racine'] as const) rendu.lierMaillage(forme, new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 2048));
  rendu.lierTuteurs(new InstancedMesh(rendu.geometrieTuteur(), new MeshBasicMaterial(), 2048));
  rendu.lierFruits(new InstancedMesh(rendu.geometrieFruit(), new MeshBasicMaterial(), 4096));
  rendu.lierBalises(new InstancedMesh(rendu.geometrieBalise(), new MeshBasicMaterial(), 2048));
  rendu.choisirDetail(SCENE, PLANTS, 3, 3, 5, 800);
  return rendu.poser(SCENE, filtree, PLANTS).balises;
}

describe('T55 règle 2 : le DAR l’emporte sur la balise « à récolter »', () => {
  it('témoin : les deux planches sont à récolter, deux balises', () => {
    expect(PLANTS.map((p) => p?.recolte.phase)).toEqual(['a-recolter', 'a-recolter']);
    const filtree = appliquerFiltres(SCENE, FILTRES_TOUT);
    expect(planchesARecolter(PLANTS, filtree)).toEqual([P1, P2]);
    expect(balisesPosees(filtree)).toBe(2);
  });

  it('marquerDar ne touche que le drapeau `dar` des planches visées ; ensemble vide : même objet', () => {
    const filtree = appliquerFiltres(SCENE, FILTRES_TOUT);
    expect(m.marquerDar(filtree, new Set())).toBe(filtree);
    const marquee = m.marquerDar(filtree, new Set([P1]));
    const volumes = marquee.volumes as readonly VolumeFiltreDar[];
    expect(volumes.map((v) => v.dar === true)).toEqual([true, false]);
    expect(volumes.map((v) => Object.fromEntries(Object.entries(v).filter(([cle]) => cle !== 'dar')))).toEqual(filtree.volumes);
  });

  it('planche à récolter ET sous DAR : pas de balise, pas comptée « à récolter » ; l’autre garde la sienne', () => {
    const marquee = m.marquerDar(appliquerFiltres(SCENE, FILTRES_TOUT), new Set([P1]));
    expect(aBalise(PLANTS[0] ?? null, marquee.volumes[0])).toBe(false);
    expect(aBalise(PLANTS[1] ?? null, marquee.volumes[1])).toBe(true);
    expect(planchesARecolter(PLANTS, marquee)).toEqual([P2]);
    expect(balisesPosees(marquee)).toBe(1);
  });

  it('du traitement au repère : l’emplacement traité le jour de la récolte perd sa balise', () => {
    const t = lus([traitement('0192f0c1-5555-7000-8000-000000000140', JOUR, ajouterJours(JOUR, 3), [P2])]);
    const planches = new Set(m.reperesDar(t, DEUX, JOUR).map((r) => r.planche));
    const marquee = m.marquerDar(appliquerFiltres(SCENE, FILTRES_TOUT), planches);
    expect(planchesARecolter(PLANTS, marquee)).toEqual([P1]);
    expect(balisesPosees(marquee)).toBe(1);
  });
});

// ── Couleur dédiée : jetons existants, lisible en clair et en sombre ─────────────────────────
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
const contraste = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((l1 ?? 0) + 0.05) / ((l2 ?? 0) + 0.05);
};
/** Écart de teinte (degrés, 0 à 180). */
function teinte(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const dd = max - min;
  const h = max === r ? ((g - b) / dd) % 6 : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return (h * 60 + 360) % 360;
}
const ecartTeinte = (a: string, b: string): number => {
  const e = Math.abs(teinte(a) - teinte(b));
  return Math.min(e, 360 - e);
};

describe('T55 : couleur du repère « Ne pas récolter »', () => {
  it('le style du repère passe par les jetons existants (fond conflit, texte surface), jamais par une couleur en dur', () => {
    const css = readFileSync(new URL('./dar3d.css', import.meta.url), 'utf8');
    const regle = /\.plan3d-repere-dar\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regle).toMatch(/background:\s*var\(--couleur-conflit\)/);
    expect(regle).toMatch(/(?<!-)color:\s*var\(--couleur-surface\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('texte lisible sur le repère en clair et en sombre (contraste AA, 4,5:1)', () => {
    expect(contraste(COULEURS.surface, COULEURS.conflit)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(COULEURS_SOMBRES.surface, COULEURS_SOMBRES.conflit)).toBeGreaterThanOrEqual(4.5);
  });

  it('distinct de la balise « à récolter » (vive et pâle) dans les deux thèmes', () => {
    for (const fond of [COULEURS.conflit, COULEURS_SOMBRES.conflit]) {
      for (const balise of [COULEUR_BALISE_RECOLTE_3D, COULEUR_BALISE_FIN_RECOLTE_3D]) {
        expect(ecartTeinte(fond, balise), `${fond} / ${balise}`).toBeGreaterThanOrEqual(15);
      }
    }
  });
});
