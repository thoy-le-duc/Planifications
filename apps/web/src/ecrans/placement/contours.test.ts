/**
 * Tests d'acceptation T28d — gestes sur le contour d'une zone, en fonctions pures : insérer le
 * milieu d'un côté, déplacer un sommet, le retirer (jamais sous 3), clavier (flèches, Maj, Inser,
 * Suppr), tracé point par point et fermeture, verdict en direct par validerContour du cœur
 * (docs/backlog/T28d-contours-zones.md ; contrat : ./test/contrat-contours.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { depuisRepereZone, repereZone, validerContour } from '@planif/core';
import type { ModuleContours, PlancheDansZone, Point } from './test/contrat-contours.ts';

const CHEMIN = './contours.ts';
let c: ModuleContours;

beforeAll(async () => {
  c = (await import(/* @vite-ignore */ CHEMIN)) as ModuleContours;
});

/** Le rectangle de « Plein champ » (ferme du placement), antihoraire. */
const CHAMP: readonly Point[] = [
  { x: 100, y: 0 },
  { x: 140, y: 0 },
  { x: 140, y: 30 },
  { x: 100, y: 30 },
];
const TRIANGLE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];
/** Une parcelle en L de 6 sommets, antihoraire. */
const L: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 20 },
  { x: 20, y: 20 },
  { x: 20, y: 40 },
  { x: 0, y: 40 },
];

const MM = 1e-3;
function procheListe(recu: readonly Point[] | null, attendu: readonly Point[]): void {
  expect(recu, 'contour attendu, pas null').not.toBeNull();
  if (recu === null) return;
  expect(recu.length, `nombre de sommets (${JSON.stringify(recu)})`).toBe(attendu.length);
  attendu.forEach((p, i) => {
    const r = recu[i];
    expect(r, `sommet ${String(i)}`).toBeDefined();
    if (r === undefined) return;
    expect(Math.abs(r.x - p.x), `sommet ${String(i)}.x : ${String(r.x)} au lieu de ${String(p.x)}`).toBeLessThanOrEqual(MM);
    expect(Math.abs(r.y - p.y), `sommet ${String(i)}.y : ${String(r.y)} au lieu de ${String(p.y)}`).toBeLessThanOrEqual(MM);
  });
}

const touche = (key: string, shiftKey = false) => ({ key, shiftKey });

describe('T28d : insérer le milieu d’un côté', () => {
  it('côté 1 de Plein champ : (140, 15) entre le sommet 1 et le sommet 2', () => {
    procheListe(c.insererMilieu(CHAMP, 1), [CHAMP[0], CHAMP[1], { x: 140, y: 15 }, CHAMP[2], CHAMP[3]] as Point[]);
  });

  it('dernier côté (du dernier sommet au premier) : milieu ajouté à la fin', () => {
    procheListe(c.insererMilieu(CHAMP, 3), [...CHAMP, { x: 100, y: 15 }]);
    procheListe(c.insererMilieu(TRIANGLE, 2), [...TRIANGLE, { x: 0, y: 5 }]);
  });

  it('premier côté', () => {
    procheListe(c.insererMilieu(CHAMP, 0), [CHAMP[0], { x: 120, y: 0 }, CHAMP[1], CHAMP[2], CHAMP[3]] as Point[]);
  });

  it('côté hors bornes ou non entier : copie inchangée', () => {
    for (const cote of [-1, 4, 1.5, Number.NaN]) procheListe(c.insererMilieu(CHAMP, cote), CHAMP);
  });

  it('pas de plafond ici : au-delà de 200 sommets, c’est validerContour qui refuse', () => {
    let k: Point[] = [...CHAMP];
    for (let i = 0; i < 197; i++) k = c.insererMilieu(k, 0);
    expect(k).toHaveLength(201);
    const v = c.verifierContour(k);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('trop_de_sommets');
  });
});

describe('T28d : déplacer un sommet', () => {
  it('le sommet vient au point donné, les autres ne bougent pas', () => {
    procheListe(c.deplacerSommet(CHAMP, 2, { x: 150.25, y: 35.5 }), [CHAMP[0], CHAMP[1], { x: 150.25, y: 35.5 }, CHAMP[3]] as Point[]);
  });

  it('index hors bornes : copie inchangée', () => {
    procheListe(c.deplacerSommet(CHAMP, 4, { x: 0, y: 0 }), CHAMP);
    procheListe(c.deplacerSommet(CHAMP, -1, { x: 0, y: 0 }), CHAMP);
  });
});

describe('T28d : retirer un sommet, jamais sous 3', () => {
  it('4 → 3 sommets', () => {
    procheListe(c.retirerSommet(CHAMP, 1), [CHAMP[0], CHAMP[2], CHAMP[3]] as Point[]);
    procheListe(c.retirerSommet(L, 5), L.slice(0, 5));
  });

  it('à 3 sommets : refusé (null)', () => {
    for (let i = 0; i < 3; i++) expect(c.retirerSommet(TRIANGLE, i)).toBeNull();
  });

  it('index hors bornes : copie inchangée', () => {
    procheListe(c.retirerSommet(CHAMP, 7), CHAMP);
  });
});

describe('T28d : clavier sur un sommet', () => {
  it('flèches 0,1 m, Maj 1 m, dans le repère de la ferme (nord en haut) ; index inchangé', () => {
    const cas: { key: string; maj: boolean; attendu: Point }[] = [
      { key: 'ArrowRight', maj: false, attendu: { x: 140.1, y: 30 } },
      { key: 'ArrowLeft', maj: false, attendu: { x: 139.9, y: 30 } },
      { key: 'ArrowUp', maj: false, attendu: { x: 140, y: 30.1 } },
      { key: 'ArrowDown', maj: false, attendu: { x: 140, y: 29.9 } },
      { key: 'ArrowRight', maj: true, attendu: { x: 141, y: 30 } },
      { key: 'ArrowDown', maj: true, attendu: { x: 140, y: 29 } },
    ];
    for (const { key, maj, attendu } of cas) {
      const r = c.toucheSommet(CHAMP, 2, touche(key, maj));
      expect(r, key).not.toBeNull();
      if (r === null) continue;
      expect(r.index).toBe(2);
      expect(r.refuse).toBe(false);
      procheListe(r.contour, [CHAMP[0], CHAMP[1], attendu, CHAMP[3]] as Point[]);
    }
  });

  it('dix fois 0,1 m = 1 m tout rond (arrondi au micromètre, pas de bruit de virgule flottante)', () => {
    let k: Point[] = [...CHAMP];
    for (let i = 0; i < 10; i++) {
      const r = c.toucheSommet(k, 0, touche('ArrowRight'));
      if (r === null) throw new Error('flèche ignorée');
      k = r.contour;
    }
    expect(k[0]).toEqual({ x: 101, y: 0 });
  });

  it('Inser : milieu du côté qui suit, le nouveau sommet est sélectionné', () => {
    const r = c.toucheSommet(CHAMP, 3, touche('Insert'));
    expect(r?.index).toBe(4);
    expect(r?.refuse).toBe(false);
    procheListe(r?.contour ?? null, [...CHAMP, { x: 100, y: 15 }]);
    const r1 = c.toucheSommet(CHAMP, 1, touche('Insert'));
    expect(r1?.index).toBe(2);
    procheListe(r1?.contour ?? null, [CHAMP[0], CHAMP[1], { x: 140, y: 15 }, CHAMP[2], CHAMP[3]] as Point[]);
  });

  it('Suppr et Retour arrière : retirent le sommet ; la sélection passe au suivant (ou au premier)', () => {
    const r = c.toucheSommet(CHAMP, 1, touche('Delete'));
    expect(r?.index).toBe(1);
    expect(r?.refuse).toBe(false);
    procheListe(r?.contour ?? null, [CHAMP[0], CHAMP[2], CHAMP[3]] as Point[]);
    const dernier = c.toucheSommet(CHAMP, 3, touche('Backspace'));
    expect(dernier?.index).toBe(0);
    procheListe(dernier?.contour ?? null, CHAMP.slice(0, 3));
  });

  it('Suppr à 3 sommets : refus signalé, contour et index inchangés', () => {
    const r = c.toucheSommet(TRIANGLE, 1, touche('Delete'));
    expect(r).not.toBeNull();
    expect(r?.refuse).toBe(true);
    expect(r?.index).toBe(1);
    procheListe(r?.contour ?? null, TRIANGLE);
  });

  it('toute autre touche (Tab, Entrée, lettres, crochets) : null', () => {
    for (const key of ['Tab', 'Enter', 'a', ']', '[', 'Escape']) expect(c.toucheSommet(CHAMP, 0, touche(key)), key).toBeNull();
  });
});

describe('T28d : tracé point par point et fermeture', () => {
  const TOL = 1;

  it('chaque point s’ajoute à la fin', () => {
    let s: Point[] = [];
    for (const p of L) {
      const r = c.poserPoint(s, p, TOL);
      expect(r.ferme).toBe(false);
      s = r.sommets;
    }
    procheListe(s, L);
  });

  it('près du premier sommet, à 3 sommets ou plus : fermé, sans répéter le premier', () => {
    const r = c.poserPoint(L, { x: 0.6, y: -0.5 }, TOL);
    expect(r.ferme).toBe(true);
    procheListe(r.sommets, L);
    const t = c.poserPoint(TRIANGLE, { x: 0, y: 0 }, TOL);
    expect(t.ferme).toBe(true);
    procheListe(t.sommets, TRIANGLE);
  });

  it('près du premier sommet avec moins de 3 sommets : ignoré', () => {
    const r = c.poserPoint(L.slice(0, 2), { x: 0.2, y: 0.2 }, TOL);
    expect(r.ferme).toBe(false);
    procheListe(r.sommets, L.slice(0, 2));
  });

  it('juste hors de la tolérance : ajouté', () => {
    const r = c.poserPoint(L, { x: 1.5, y: 0 }, TOL);
    expect(r.ferme).toBe(false);
    procheListe(r.sommets, [...L, { x: 1.5, y: 0 }]);
  });

  it('double clic au même endroit que le dernier sommet : ignoré', () => {
    const r = c.poserPoint(L.slice(0, 3), { x: 40, y: 20 }, TOL);
    expect(r.ferme).toBe(false);
    procheListe(r.sommets, L.slice(0, 3));
  });

  it('tolérance de fermeture raisonnable au doigt comme à la souris (6 à 24 px)', () => {
    expect(c.TOLERANCE_FERMETURE_PX).toBeGreaterThanOrEqual(6);
    expect(c.TOLERANCE_FERMETURE_PX).toBeLessThanOrEqual(24);
  });
});

describe('T28d : verdict en direct = validerContour du cœur', () => {
  it('contour valide : ok, rendu antihoraire (un tracé horaire est retourné)', () => {
    const v = c.verifierContour(L);
    expect(v).toEqual({ ok: true, contour: L });
    const horaire = [...L].reverse();
    const h = c.verifierContour(horaire);
    expect(h.ok).toBe(true);
    const attendu = validerContour(horaire);
    if (h.ok && attendu.ok) expect(h.contour).toEqual(attendu.valeur);
  });

  it.each([
    { nom: 'côtés croisés (nœud papillon)', contour: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }], code: 'auto_intersection' },
    { nom: 'deux sommets', contour: [{ x: 0, y: 0 }, { x: 10, y: 0 }], code: 'trop_peu_de_sommets' },
    { nom: 'sommets alignés', contour: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], code: 'aire_nulle' },
    { nom: 'à plus de 5 km', contour: [{ x: 6000, y: 0 }, { x: 6010, y: 0 }, { x: 6000, y: 10 }], code: 'trop_loin' },
    { nom: 'premier sommet répété', contour: [...L, { x: 0, y: 0 }], code: 'sommets_confondus' },
  ])('$nom : refus, même code et même message que validerContour', ({ contour, code }) => {
    const v = c.verifierContour(contour);
    const attendu = validerContour(contour);
    expect(attendu.ok).toBe(false);
    expect(v.ok).toBe(false);
    if (v.ok || attendu.ok) return;
    expect(attendu.erreur.code).toBe(code);
    expect(v.code).toBe(attendu.erreur.code);
    expect(v.message).toBe(attendu.erreur.message);
  });

  it('ne lève jamais, même sur un sommet non fini', () => {
    expect(() => c.verifierContour([{ x: Number.NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).not.toThrow();
    expect(c.verifierContour([{ x: Number.NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]).ok).toBe(false);
  });
});

describe('T28d : pureté', () => {
  it('aucune fonction ne modifie le contour reçu', () => {
    const copie = structuredClone(CHAMP);
    c.insererMilieu(CHAMP, 0);
    c.deplacerSommet(CHAMP, 0, { x: 1, y: 1 });
    c.retirerSommet(CHAMP, 0);
    c.toucheSommet(CHAMP, 0, touche('ArrowUp'));
    c.toucheSommet(CHAMP, 0, touche('Insert'));
    c.toucheSommet(CHAMP, 0, touche('Delete'));
    c.poserPoint(CHAMP, { x: 0, y: 0 }, 1);
    c.verifierContour([...CHAMP].reverse());
    expect(CHAMP).toEqual(copie);
  });

  it('module pur : ni React, ni DOM, ni réseau, ni horloge ; le cœur par son sous-chemin seulement', () => {
    const source = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'contours.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]react/);
    expect(source).not.toMatch(/\b(document|window|fetch|Date\.now|new Date|localStorage)\b/);
    // Le point d'entrée racine du cœur alourdirait le morceau de l'éditeur (budget jsPlacementGzKio).
    expect(source).not.toMatch(/from\s+['"]@planif\/core['"]/);
  });
});

// ── Décision du chef : les planches ne bougent pas quand le contour de leur zone change ───────

/** Position et cap absolus (repère de la ferme) d'une planche placée dans la zone de ce contour. */
function absolue(contour: readonly Point[], p: PlancheDansZone['placement']): { x: number; y: number; cap: number } {
  const r = repereZone({ contour });
  if (r === null) throw new Error('contour sans repère');
  const c = depuisRepereZone(r, { x: p.x, y: p.y });
  return { x: c.x, y: c.y, cap: (((p.orientation_deg + r.orientationDeg) % 360) + 360) % 360 };
}
const ecartCap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

const PLANCHES: readonly PlancheDansZone[] = [
  { id: 'pc-01', placement: { x: 0, y: 0, orientation_deg: 0 } },
  { id: 'pc-02', placement: { x: 5, y: -3, orientation_deg: 30 } },
  { id: 'pc-03', placement: { x: -12.5, y: 7.25, orientation_deg: 359.5 } },
];

function verifierImmobiles(ancien: readonly Point[], nouveau: readonly Point[]): void {
  const r = c.replacerPlanches(ancien, nouveau, PLANCHES);
  expect(r.map((p) => p.id)).toEqual(PLANCHES.map((p) => p.id));
  r.forEach((p, i) => {
    const avant = absolue(ancien, PLANCHES[i]?.placement ?? { x: 0, y: 0, orientation_deg: 0 });
    const apres = absolue(nouveau, p.placement);
    expect(Math.abs(apres.x - avant.x), `${p.id} : x absolu`).toBeLessThanOrEqual(MM);
    expect(Math.abs(apres.y - avant.y), `${p.id} : y absolu`).toBeLessThanOrEqual(MM);
    expect(ecartCap(apres.cap, avant.cap), `${p.id} : cap absolu`).toBeLessThanOrEqual(0.01);
    expect(p.placement.orientation_deg).toBeGreaterThanOrEqual(0);
    expect(p.placement.orientation_deg).toBeLessThan(360);
  });
}

describe('T28d (chef) : replacerPlanches garde les planches immobiles sur le terrain', () => {
  it('sommet déplacé, même plus long côté : centre du repère déplacé, planches immobiles', () => {
    verifierImmobiles(CHAMP, [CHAMP[0], CHAMP[1], { x: 161.478, y: 30 }, CHAMP[3]] as Point[]);
  });

  it('le plus long côté change : le cap du repère saute de 90° à 0°, planches immobiles', () => {
    const haut = [
      { x: 100, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 60 },
      { x: 100, y: 60 },
    ];
    expect(repereZone({ contour: CHAMP })?.orientationDeg).toBeCloseTo(90, 6);
    expect(repereZone({ contour: haut })?.orientationDeg).toBeCloseTo(0, 6);
    verifierImmobiles(CHAMP, haut);
    // PC-01, au centre de l'ancien repère (120, 15) cap 90° : dans le nouveau (centre (120, 30), cap 0°), (0, −15) à 90°.
    const [pc01] = c.replacerPlanches(CHAMP, haut, PLANCHES);
    expect(pc01?.placement.x).toBeCloseTo(0, 3);
    expect(pc01?.placement.y).toBeCloseTo(-15, 3);
    expect(pc01?.placement.orientation_deg).toBeCloseTo(90, 2);
  });

  it('nouveau contour en L, avec plus de sommets : planches immobiles', () => {
    verifierImmobiles(CHAMP, [
      { x: 90, y: -10 },
      { x: 150, y: -10 },
      { x: 150, y: 10 },
      { x: 125, y: 10 },
      { x: 125, y: 45 },
      { x: 90, y: 45 },
    ]);
  });

  it('contour identique : placements inchangés ; aucune planche : liste vide ; n’altère pas ses arguments', () => {
    const copie = structuredClone(PLANCHES);
    const r = c.replacerPlanches(CHAMP, CHAMP, PLANCHES);
    r.forEach((p, i) => {
      const a = PLANCHES[i]?.placement;
      expect(Math.abs(p.placement.x - (a?.x ?? 0))).toBeLessThanOrEqual(MM);
      expect(Math.abs(p.placement.y - (a?.y ?? 0))).toBeLessThanOrEqual(MM);
      expect(ecartCap(p.placement.orientation_deg, a?.orientation_deg ?? 0)).toBeLessThanOrEqual(0.01);
    });
    expect(c.replacerPlanches(CHAMP, L, [])).toEqual([]);
    expect(PLANCHES).toEqual(copie);
  });
});
