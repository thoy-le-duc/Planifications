/**
 * Tests d'acceptation T35b (Q34) — la 3D pose les plants comme l'itinéraire le dit : rangs alignés
 * ou en quinconce. Écrits AVANT le code.
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 * ./plants.ts
 *   CultureDePlanche.disposition?: 'alignee' | 'quinconce'      absente → 'alignee' (comme avant T35b)
 *   plantsDePlanche : même nombre de plants dans les deux dispositions (le quinconce ne change que
 *     la place). En quinconce et à 2 rangs ou plus, les rangs pairs (le 2e, le 4e : indices 1, 3…)
 *     sont décalés d'un demi-pas le long du rang par rapport aux rangs impairs, sans qu'aucun plant
 *     ne sorte du rectangle de la planche. Les rangs (leur position en travers) ne bougent pas.
 *     À 1 rang, le quinconce n'a pas de sens : positions identiques aux alignés.
 *     Alignés (ou disposition absente) : positions IDENTIQUES à celles d'avant T35b (instantanés
 *     ci-dessous, calculés par le code de main avant ce ticket).
 * ./donnees-plants.ts
 *   cultureAu(c, jour).disposition : lue dans le jsonb `parametres` de la série
 *     (`densite.disposition === 'quinconce'`) ; absente, illisible ou inconnue → 'alignee'.
 *
 * Le nombre de rangs de la 3D vient de la largeur de la planche (un rang tous les 0,5 m, 3 au plus,
 * RANGS_MAX de T32b, inchangé) : la « planche de 4 rangs » se pose donc sur 3 rangs en 3D, et le cas
 * large ci-dessous (2 m) vérifie que le plafond tient et que les rangs pairs restent décalés.
 */
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import { construireCultures, cultureAu, type LignesPlants } from './donnees-plants.ts';
import { plantsDePlanche, type CultureDePlanche, type VolumePlant } from './plants.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const JOUR = d('2027-07-05');
const DATES = {
  miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};
const volume = (autres: Partial<VolumePlant> = {}): VolumePlant => ({ id: 'p', x: 10, z: -4, longueur: 3, largeur: 1, angle: 0, couleur: '#ffffff', ...autres });
const culture = (disposition?: 'alignee' | 'quinconce', ecartementM = 0.5): CultureDePlanche => {
  const base = { espece: 'Tomate', profil: profilParDefaut('Tomate').profil, croissance: { sorte: 'annuelle' as const, dates: DATES }, ecartementM };
  return disposition === undefined ? base : { ...base, disposition };
};
const poser = (v: VolumePlant, c: CultureDePlanche) => {
  const p = plantsDePlanche({ volume: v, culture: c, jour: JOUR, horsSol: false });
  if (p === null) throw new Error('la planche devrait porter des plants');
  return p;
};

/** Coordonnées dans le repère de la planche : dx le long du rang, dz en travers. */
function locales(v: VolumePlant, positions: readonly { readonly x: number; readonly z: number }[]): { dx: number; dz: number }[] {
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  return positions.map((q) => ({ dx: (q.x - v.x) * cos - (q.z - v.z) * sin, dz: (q.x - v.x) * sin + (q.z - v.z) * cos }));
}

/** Clé d'un rang : dz au dixième de millimètre (String(-0) vaut « 0 » : pas de rang « -0 »). */
const cleDz = (dz: number): string => String(Math.round(dz * 1e4));

/** Les rangs (par dz croissant), chacun avec ses dx croissants. */
function rangsDe(v: VolumePlant, positions: readonly { readonly x: number; readonly z: number }[]): number[][] {
  const parDz = new Map<string, number[]>();
  for (const { dx, dz } of locales(v, positions)) {
    const cle = cleDz(dz);
    parDz.set(cle, [...(parDz.get(cle) ?? []), dx]);
  }
  return [...parDz].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, dxs]) => dxs.sort((a, b) => a - b));
}

/** Instantanés de la disposition alignée : sortie de plantsDePlanche de main avant T35b (arrondis au micromètre). */
const INSTANTANES: readonly { readonly v: Partial<VolumePlant>; readonly positions: readonly (readonly [number, number])[] }[] = [
  { v: { longueur: 3, largeur: 1, angle: 0 }, positions: [[8.75, -4.25], [9.25, -4.25], [9.75, -4.25], [10.25, -4.25], [10.75, -4.25], [11.25, -4.25], [8.75, -3.75], [9.25, -3.75], [9.75, -3.75], [10.25, -3.75], [10.75, -3.75], [11.25, -3.75]] },
  { v: { longueur: 3, largeur: 1.5, angle: 0 }, positions: [[8.75, -4.5], [9.25, -4.5], [9.75, -4.5], [10.25, -4.5], [10.75, -4.5], [11.25, -4.5], [8.75, -4], [9.25, -4], [9.75, -4], [10.25, -4], [10.75, -4], [11.25, -4], [8.75, -3.5], [9.25, -3.5], [9.75, -3.5], [10.25, -3.5], [10.75, -3.5], [11.25, -3.5]] },
  { v: { longueur: 3, largeur: 1, angle: 0.5 }, positions: [[8.783165, -3.620114], [9.221957, -3.859826], [9.660748, -4.099539], [10.099539, -4.339252], [10.538331, -4.578965], [10.977122, -4.818678], [9.022878, -3.181322], [9.461669, -3.421035], [9.900461, -3.660748], [10.339252, -3.900461], [10.778043, -4.140174], [11.216835, -4.379886]] },
];

describe('T35b : rangs alignés — positions inchangées', () => {
  for (const [i, { v, positions }] of INSTANTANES.entries()) {
    for (const disposition of [undefined, 'alignee' as const]) {
      it(`instantané ${String(i + 1)}, disposition ${disposition ?? 'absente'} : mêmes positions qu'avant`, () => {
        const p = poser(volume(v), culture(disposition));
        expect(p.positions).toHaveLength(positions.length);
        positions.forEach(([x, z], k) => {
          expect(p.positions[k]?.x, `x ${String(k)}`).toBeCloseTo(x, 5);
          expect(p.positions[k]?.z, `z ${String(k)}`).toBeCloseTo(z, 5);
        });
      });
    }
  }
});

describe('T35b : quinconce — rangs pairs décalés d’un demi-pas', () => {
  const cas: readonly { readonly nom: string; readonly v: Partial<VolumePlant>; readonly rangs: number }[] = [
    { nom: '2 rangs', v: { longueur: 3, largeur: 1 }, rangs: 2 },
    { nom: '3 rangs', v: { longueur: 3, largeur: 1.5 }, rangs: 3 },
    { nom: 'planche de 2 m (plafond de 3 rangs en 3D)', v: { longueur: 4, largeur: 2 }, rangs: 3 },
    { nom: '2 rangs, planche tournée', v: { longueur: 3, largeur: 1, angle: 0.5 }, rangs: 2 },
    { nom: '3 rangs, planche tournée', v: { longueur: 5, largeur: 1.5, angle: -1.2 }, rangs: 3 },
  ];
  for (const { nom, v, rangs } of cas) {
    it(`${nom} : même nombre de plants, mêmes rangs, rangs pairs décalés d’un demi-pas`, () => {
      const vol = volume(v);
      const alignes = poser(vol, culture('alignee'));
      const quinconce = poser(vol, culture('quinconce'));
      expect(quinconce.nombre).toBe(alignes.nombre);
      expect(quinconce.positions).toHaveLength(alignes.positions.length);

      const ra = rangsDe(vol, alignes.positions);
      const rq = rangsDe(vol, quinconce.positions);
      expect(rq).toHaveLength(rangs);
      expect(ra).toHaveLength(rangs);
      // Les rangs ne bougent pas en travers : mêmes dz, même nombre de plants par rang.
      expect(locales(vol, quinconce.positions).map((q) => cleDz(q.dz)).sort()).toEqual(locales(vol, alignes.positions).map((q) => cleDz(q.dz)).sort());
      rq.forEach((dxs) => { expect(dxs).toHaveLength(rq[0]?.length ?? -1); });

      const premier = rq[0] ?? [];
      const pas = (premier[1] ?? NaN) - (premier[0] ?? NaN);
      expect(pas).toBeGreaterThan(0);
      rq.forEach((dxs, r) => {
        // Pas régulier le long de chaque rang.
        dxs.slice(1).forEach((dx, k) => { expect(dx - (dxs[k] ?? NaN), `pas du rang ${String(r + 1)}`).toBeCloseTo(pas, 6); });
        // Rangs impairs (indice 0, 2) : sur la même ligne que le 1er ; rangs pairs (1, 3) : un demi-pas plus loin.
        const decalage = r % 2 === 1 ? pas / 2 : 0;
        dxs.forEach((dx, k) => { expect(dx - (premier[k] ?? NaN), `rang ${String(r + 1)}, plant ${String(k)}`).toBeCloseTo(decalage, 6); });
      });
    });
  }

  it('1 seul rang : le quinconce n’a pas de sens, positions identiques aux alignés', () => {
    const vol = volume({ longueur: 3, largeur: 0.4 });
    const a = poser(vol, culture('alignee'));
    const q = poser(vol, culture('quinconce'));
    expect(rangsDe(vol, a.positions)).toHaveLength(1);
    expect(q.positions).toEqual(a.positions);
  });
});

describe('T35b : aucun plant hors de la planche', () => {
  const longueurs = [0.3, 0.9, 1, 3, 12, 40];
  const largeurs = [0.2, 0.4, 0.8, 1, 1.5, 2, 3];
  const angles = [0, 0.7, -2.1];
  const ecartements = [0.05, 0.3, 0.5, 1.2, 6];
  for (const disposition of ['alignee', 'quinconce'] as const) {
    it(`${disposition} : tout plant est dans le rectangle de la planche (bords compris), toutes tailles, tous angles`, () => {
      let testes = 0;
      for (const longueur of longueurs) for (const largeur of largeurs) for (const angle of angles) for (const ecartementM of ecartements) {
        const vol = volume({ longueur, largeur, angle, x: -7.5, z: 3.25 });
        const p = plantsDePlanche({ volume: vol, culture: culture(disposition, ecartementM), jour: JOUR, horsSol: false });
        if (p === null) continue;
        testes += 1;
        expect(p.nombre).toBe(p.positions.length);
        for (const { dx, dz } of locales(vol, p.positions)) {
          const ou = `${disposition} L${String(longueur)} l${String(largeur)} a${String(angle)} e${String(ecartementM)}`;
          expect(Math.abs(dx), `${ou} : dx ${String(dx)}`).toBeLessThanOrEqual(longueur / 2 + 1e-9);
          expect(Math.abs(dz), `${ou} : dz ${String(dz)}`).toBeLessThanOrEqual(largeur / 2 + 1e-9);
        }
      }
      expect(testes).toBeGreaterThan(300);
    });
  }

  it('le quinconce ne change pas le nombre de plants, quel que soit le cas', () => {
    for (const longueur of longueurs) for (const largeur of largeurs) for (const ecartementM of ecartements) {
      const vol = volume({ longueur, largeur });
      const a = plantsDePlanche({ volume: vol, culture: culture('alignee', ecartementM), jour: JOUR, horsSol: false });
      const q = plantsDePlanche({ volume: vol, culture: culture('quinconce', ecartementM), jour: JOUR, horsSol: false });
      expect(q?.nombre, `L${String(longueur)} l${String(largeur)} e${String(ecartementM)}`).toBe(a?.nombre);
    }
  });
});

describe('T35b : la disposition est lue dans l’itinéraire de la série (instantané)', () => {
  const VIDE: LignesPlants = { occupations: [], campagnes: [], zones: [], emplacements: [] };
  const ligne = (parametres: string | null) => ({ id: 'o1', plantation_id: null, prevu_du: '2027-05-01', prevu_au: '2027-10-15', reel_du: null, reel_au: null, s_parametres: parametres, s_mise_en_place: '2027-05-03', s_debut_recolte: '2027-07-01', s_fin_recolte: '2027-09-15', e_nom: 'Tomate', e_profil: null });
  const densite = (extra: Record<string, unknown>) => JSON.stringify({ densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, ...extra } });
  const dispositionLue = (parametres: string | null): string | undefined => {
    const c = construireCultures({ ...VIDE, occupations: [ligne(parametres)] }).parOccupation.get('o1');
    if (c === undefined) throw new Error('culture attendue');
    return (cultureAu(c, JOUR) as { readonly disposition?: string }).disposition;
  };

  it('« quinconce » dans les paramètres figés de la série → la culture est en quinconce', () => {
    expect(dispositionLue(densite({ disposition: 'quinconce' }))).toBe('quinconce');
  });

  it('absente, « alignee », inconnue, illisible ou sans paramètres → alignés', () => {
    for (const p of [densite({}), densite({ disposition: 'alignee' }), densite({ disposition: 'zigzag' }), densite({ disposition: 3 }), '{pas du json', JSON.stringify({}), JSON.stringify({ densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 5 } }), null]) {
      expect(dispositionLue(p) ?? 'alignee', String(p)).toBe('alignee');
    }
  });

  it('de la lecture au dessin : la série en quinconce pose le rang 2 décalé, celle sans clé comme avant', () => {
    const vol = volume();
    const posee = (parametres: string) => {
      const c = construireCultures({ ...VIDE, occupations: [ligne(parametres)] }).parOccupation.get('o1');
      if (c === undefined) throw new Error('culture attendue');
      return poser(vol, cultureAu(c, JOUR));
    };
    const q = rangsDe(vol, posee(densite({ disposition: 'quinconce' })).positions);
    const a = rangsDe(vol, posee(densite({})).positions);
    expect(q).toHaveLength(2);
    const pas = (q[0]?.[1] ?? NaN) - (q[0]?.[0] ?? NaN);
    expect((q[1]?.[0] ?? NaN) - (q[0]?.[0] ?? NaN)).toBeCloseTo(pas / 2, 6);
    expect((a[1]?.[0] ?? NaN) - (a[0]?.[0] ?? NaN)).toBeCloseTo(0, 6);
  });
});
