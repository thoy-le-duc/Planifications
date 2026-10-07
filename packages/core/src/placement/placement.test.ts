/**
 * Tests d'acceptation T28a — validerPlacement (docs/backlog/T28a-placement-modele.md, critère 4) :
 * chaque refus, avec un message en français. Ce sont les règles que le serveur rejouera (T28s).
 * Contrat (colonnes, codes, ordre des règles) : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerPlacement, type CodeErreurPlacement, type ModulePlacement, type ResultatPlacement } from './test/contrat.ts';

let m: ModulePlacement;

beforeAll(async () => {
  m = await chargerPlacement();
});

function valide<T>(r: ResultatPlacement<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.erreur.code} (${String(r.erreur.champ)}) — ${r.erreur.message}`);
  return r.valeur;
}

function refuse<T>(r: ResultatPlacement<T>, code: CodeErreurPlacement, champ: string | null): void {
  expect(r.ok, 'le placement aurait dû être refusé').toBe(false);
  if (r.ok) return;
  expect({ code: r.erreur.code, champ: r.erreur.champ }).toEqual({ code, champ });
  expect(r.erreur.message.trim().length).toBeGreaterThan(0);
  expect(r.erreur.message.length).toBeLessThanOrEqual(200);
  expect(r.erreur.message).not.toMatch(/\b(error|invalid|must|undefined|NaN|null)\b/i);
}

// ── Emplacement ──────────────────────────────────────────────────────────────────────────────

describe('T28a : validerPlacement, emplacement (repère de sa zone)', () => {
  const PLACE = { placement_x_m: 2, placement_y_m: -12.5, orientation_deg: 0 } as const;
  const emplacement = (ligne: Readonly<Record<string, unknown>>) => m.validerPlacement({ table: 'emplacement', ligne });

  it('placé : accepté, valeurs rendues', () => {
    expect(valide(emplacement(PLACE))).toEqual(PLACE);
  });

  it('les autres colonnes de la ligne sont ignorées', () => {
    expect(valide(emplacement({ ...PLACE, code: 'T2-P03', longueur_m: 30 }))).toEqual(PLACE);
  });

  it('rien de placé (trois nulles, ou absentes) : accepté, tout à null (rangement automatique)', () => {
    const vide = { placement_x_m: null, placement_y_m: null, orientation_deg: null };
    expect(valide(emplacement(vide))).toEqual(vide);
    expect(valide(emplacement({}))).toEqual(vide);
  });

  it.each([
    [{ placement_x_m: 2, placement_y_m: null, orientation_deg: 0 }, 'placement_y_m'],
    [{ placement_x_m: null, placement_y_m: 3, orientation_deg: 0 }, 'placement_x_m'],
    [{ placement_x_m: 2, placement_y_m: 3, orientation_deg: null }, 'orientation_deg'],
    [{ placement_x_m: 2, placement_y_m: 3 }, 'orientation_deg'],
    [{ orientation_deg: 90 }, 'placement_x_m'],
  ] as const)('tout ou rien : %o → incomplet (%s)', (ligne, champ) => {
    refuse(emplacement(ligne), 'incomplet', champ);
  });

  it.each([
    [{ ...PLACE, placement_x_m: Number.NaN }, 'placement_x_m'],
    [{ ...PLACE, placement_y_m: Number.POSITIVE_INFINITY }, 'placement_y_m'],
    [{ ...PLACE, placement_x_m: '2' }, 'placement_x_m'],
  ] as const)('coordonnée non finie ou mal typée : %o → coordonnee_invalide (%s)', (ligne, champ) => {
    refuse(emplacement(ligne), 'coordonnee_invalide', champ);
  });

  it.each([360, -1, 400, -0.0001, Number.NaN, '90'])('orientation %s → orientation_invalide', (o) => {
    refuse(emplacement({ ...PLACE, orientation_deg: o }), 'orientation_invalide', 'orientation_deg');
  });

  it.each([0, 90, 180, 270, 359.999])('orientation %s : acceptée', (o) => {
    expect(valide(emplacement({ ...PLACE, orientation_deg: o })).orientation_deg).toBe(o);
  });

  it('à plus de 5 km du centre de sa zone → trop_loin ; à 5 km pile : accepté', () => {
    refuse(emplacement({ ...PLACE, placement_x_m: 3_000, placement_y_m: 4_001 }), 'trop_loin', 'placement_x_m');
    valide(emplacement({ ...PLACE, placement_x_m: 3_000, placement_y_m: 4_000 }));
  });
});

// ── Bâtiment ─────────────────────────────────────────────────────────────────────────────────

describe('T28a : validerPlacement, bâtiment', () => {
  const TUNNEL = { longueur_m: 40, largeur_m: 8, hauteur_m: 3.5, centre_x_m: -120, centre_y_m: 48.5, orientation_deg: 17 } as const;
  const batiment = (ligne: Readonly<Record<string, unknown>>) => m.validerPlacement({ table: 'batiment', ligne });

  it('tunnel de 40 × 8 m : accepté, valeurs rendues', () => {
    expect(valide(batiment({ ...TUNNEL, nom: 'M3', type: 'serre_tunnel' }))).toEqual(TUNNEL);
  });

  it('plafonds atteints pile (500 × 200 × 30 m) : acceptés', () => {
    valide(batiment({ ...TUNNEL, longueur_m: 500, largeur_m: 200, hauteur_m: 30 }));
  });

  it.each(['longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg'] as const)(
    'colonne %s manquante ou nulle → incomplet (un bâtiment est toujours placé)',
    (colonne) => {
      refuse(batiment({ ...TUNNEL, [colonne]: null }), 'incomplet', colonne);
      refuse(batiment(Object.fromEntries(Object.entries(TUNNEL).filter(([c]) => c !== colonne))), 'incomplet', colonne);
    },
  );

  it.each([
    ['centre_x_m', Number.NaN],
    ['centre_y_m', Number.NEGATIVE_INFINITY],
    ['centre_x_m', '12'],
  ] as const)('%s = %s → coordonnee_invalide', (colonne, valeur) => {
    refuse(batiment({ ...TUNNEL, [colonne]: valeur }), 'coordonnee_invalide', colonne);
  });

  it.each([
    ['longueur_m', 0],
    ['largeur_m', -8],
    ['hauteur_m', 0],
    ['hauteur_m', Number.NaN],
    ['longueur_m', Number.POSITIVE_INFINITY],
    ['largeur_m', '8'],
  ] as const)('%s = %s → dimension_invalide', (colonne, valeur) => {
    refuse(batiment({ ...TUNNEL, [colonne]: valeur }), 'dimension_invalide', colonne);
  });

  it.each([
    ['longueur_m', 500.01],
    ['largeur_m', 200.5],
    ['hauteur_m', 31],
  ] as const)('%s = %s → plafond_depasse', (colonne, valeur) => {
    refuse(batiment({ ...TUNNEL, [colonne]: valeur }), 'plafond_depasse', colonne);
  });

  it.each([360, -90, 720, Number.NaN])('orientation %s → orientation_invalide', (o) => {
    refuse(batiment({ ...TUNNEL, orientation_deg: o }), 'orientation_invalide', 'orientation_deg');
  });

  it('centre à plus de 5 km de l’origine → trop_loin ; à 5 km pile : accepté', () => {
    refuse(batiment({ ...TUNNEL, centre_x_m: -4_000, centre_y_m: 3_001 }), 'trop_loin', 'centre_x_m');
    valide(batiment({ ...TUNNEL, centre_x_m: -4_000, centre_y_m: 3_000 }));
  });

  it('ordre des règles : incomplet avant le reste, puis colonnes dans l’ordre du contrat', () => {
    refuse(batiment({ ...TUNNEL, longueur_m: -1, orientation_deg: null }), 'incomplet', 'orientation_deg');
    refuse(batiment({ ...TUNNEL, centre_x_m: Number.NaN, longueur_m: 0 }), 'coordonnee_invalide', 'centre_x_m');
    refuse(batiment({ ...TUNNEL, longueur_m: 0, hauteur_m: 99 }), 'dimension_invalide', 'longueur_m');
  });
});

// ── Zone ─────────────────────────────────────────────────────────────────────────────────────

describe('T28a : validerPlacement, zone', () => {
  const CONTOUR = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ];
  const zone = (ligne: Readonly<Record<string, unknown>>, abritee = false) => m.validerPlacement({ table: 'zone', ligne, abritee });

  it('zone sans bâtiment, avec son polygone : acceptée', () => {
    expect(valide(zone({ contour: CONTOUR }))).toEqual({ contour: CONTOUR });
  });

  it('contour en texte JSON (tel que le téléphone le garde) : accepté, rendu en tableau', () => {
    expect(valide(zone({ contour: JSON.stringify(CONTOUR) }))).toEqual({ contour: CONTOUR });
  });

  it('contour horaire : rendu antihoraire', () => {
    const r = valide(zone({ contour: [...CONTOUR].reverse() }));
    expect(r.contour).not.toBeNull();
    const c = r.contour ?? [];
    let s = 0;
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a !== undefined && b !== undefined) s += a.x * b.y - b.x * a.y;
    }
    expect(s).toBeGreaterThan(0);
  });

  it('zone pas placée (contour nul ou absent) : acceptée, abritée ou non', () => {
    expect(valide(zone({ contour: null }))).toEqual({ contour: null });
    expect(valide(zone({}))).toEqual({ contour: null });
    expect(valide(zone({ contour: null }, true))).toEqual({ contour: null });
  });

  it('zone abritée par un bâtiment avec un contour à elle → zone_abritee_avec_contour', () => {
    refuse(zone({ contour: CONTOUR }, true), 'zone_abritee_avec_contour', 'contour');
  });

  it('les refus de validerContour remontent avec le champ « contour »', () => {
    refuse(zone({ contour: CONTOUR.slice(0, 2) }), 'trop_peu_de_sommets', 'contour');
    refuse(
      zone({
        contour: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
      }),
      'auto_intersection',
      'contour',
    );
    refuse(zone({ contour: CONTOUR.map((p) => ({ x: p.x + 6_000, y: p.y })) }), 'trop_loin', 'contour');
  });

  it('texte JSON illisible ou pas un tableau → entree_invalide', () => {
    refuse(zone({ contour: '[{"x":0,' }), 'entree_invalide', 'contour');
    refuse(zone({ contour: { x: 0, y: 0 } }), 'entree_invalide', 'contour');
  });
});

describe('T28a : validerPlacement ne lève jamais', () => {
  it('lignes étranges', () => {
    const lignes: Readonly<Record<string, unknown>>[] = [Object.create(null) as Record<string, unknown>, { placement_x_m: {}, placement_y_m: [], orientation_deg: true }, { contour: 12 }];
    for (const ligne of lignes) {
      expect(() => m.validerPlacement({ table: 'emplacement', ligne })).not.toThrow();
      expect(() => m.validerPlacement({ table: 'batiment', ligne })).not.toThrow();
      expect(() => m.validerPlacement({ table: 'zone', ligne, abritee: false })).not.toThrow();
    }
  });
});
