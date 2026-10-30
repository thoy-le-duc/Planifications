/**
 * Tests d'acceptation T89 — la fiche « Serre ou tunnel » : valeurs par défaut, résumé calculé, type du bâtiment
 * (docs/backlog/T89-ajouter-serre.md, règles 2 à 4 et critère « Test cœur »). Pur : mètres, centimètres, aucun réseau.
 *
 * ── Contrat (à fournir dans packages/core/src/placement/serre-fiche.ts, exporté par '@planif/core/placement') ──
 *
 *   interface PlanchesDeSerre { nombre: number; largeurCm: number; longueurM: number; passePiedCm: number }
 *   interface FicheSerre {
 *     nom: string; largeurChapelleM: number; nbChapelles: number; longueurTronconM: number; nbTroncons: number;
 *     largeurAlleeM: number; prefixeZones: string; planches: PlanchesDeSerre;
 *   }
 *   DEFAUTS_SERRE : { largeurChapelleM: 9.6, nbChapelles: 1, longueurTronconM: 40, nbTroncons: 1, largeurAlleeM: 4.4,
 *                     plancheLargeurCm: 75, passePiedCm: 45, retraitPlancheM: 2 }
 *   nombrePlanchesParDefaut(largeurChapelleM, largeurPlancheCm, passePiedCm): number
 *       le plus grand n tel que n × largeur + (n − 1) × passe-pied ≤ largeur de chapelle (comparaison au millimètre : pas
 *       d'erreur de virgule flottante) ; 0 si même une planche n'entre pas.
 *   defautsSerre(derniere?: Pick<FicheSerre, 'largeurChapelleM' | 'nbChapelles' | 'longueurTronconM' | 'nbTroncons' | 'largeurAlleeM'> & { planches?: PlanchesDeSerre } | null): FicheSerre
 *       sans `derniere` : DEFAUTS_SERRE ; planches = nombrePlanchesParDefaut, 75 cm, longueur = tronçon − 2 m, passe-pied 45 cm.
 *       avec `derniere` (la dernière serre créée sur la ferme) : ses mesures reprises ; ses `planches` reprises si données, sinon
 *       calculées comme ci-dessus à partir de SES mesures. nom '' et prefixeZones '' (l'écran préremplit le préfixe avec le nom).
 *   resumeSerre(f: FicheSerre): { largeurM: number; longueurM: number; nbZones: number; nbPlanches: number; texte: string }
 *       largeurM = chapelles × largeur d'une chapelle ; longueurM = tronçons × longueur d'un tronçon + (tronçons − 1) × allée
 *       (au millimètre) ; nbZones = chapelles × tronçons ; nbPlanches = nbZones × planches.nombre ;
 *       texte = « 57,6 × 128,8 m, 18 zones, 144 planches » (virgule décimale, « 1 zone », « 1 planche » au singulier,
 *       « 0 planche » au singulier aussi).
 *   typeDeSerre(nbChapelles: number): 'serre_tunnel' | 'serre_chapelle'     (1 chapelle : tunnel)
 *   nomsDesZones(prefixe: string, n: number): string[]                       (« Serre à légumes 1 » à « … n »)
 */
import { describe, expect, it } from 'vitest';
import * as placement from '@planif/core/placement';
import { casesDeSerre } from '@planif/core/placement';

// Chargé sans typage fort : le module n'existe pas encore, l'échec doit venir des assertions, pas du compilateur.
type FicheLache = Record<string, unknown> & { planches: { nombre: number; largeurCm: number; longueurM: number; passePiedCm: number } };
interface ModuleFiche {
  readonly DEFAUTS_SERRE: Record<string, number>;
  nombrePlanchesParDefaut(largeurChapelleM: number, largeurPlancheCm: number, passePiedCm: number): number;
  defautsSerre(derniere?: Record<string, unknown> | null): FicheLache;
  resumeSerre(f: FicheLache): { largeurM: number; longueurM: number; nbZones: number; nbPlanches: number; texte: string };
  typeDeSerre(nbChapelles: number): string;
  nomsDesZones(prefixe: string, n: number): string[];
}
const f = placement as unknown as Partial<ModuleFiche>;
const exige = <K extends keyof ModuleFiche>(nom: K): ModuleFiche[K] => {
  const v = f[nom];
  if (v === undefined) throw new Error(`@planif/core/placement doit exporter « ${nom} » (T89)`);
  return v;
};

const avec = (mesures: Record<string, number>): FicheLache => ({ ...exige('defautsSerre')(), ...mesures });
const legumes = (): FicheLache => avec({ nbChapelles: 6, nbTroncons: 3, largeurAlleeM: 4.4 });
const manon = (): FicheLache => avec({ nbChapelles: 3 });

describe('T89 : valeurs par défaut', () => {
  it('constantes : chapelle 9,6 m, 1 chapelle, tronçon 40 m, 1 tronçon, allée 4,40 m, planche 75 cm, passe-pied 45 cm', () => {
    expect(exige('DEFAUTS_SERRE')).toMatchObject({
      largeurChapelleM: 9.6,
      nbChapelles: 1,
      longueurTronconM: 40,
      nbTroncons: 1,
      largeurAlleeM: 4.4,
      plancheLargeurCm: 75,
      passePiedCm: 45,
    });
  });

  it('9,6 m de chapelle, planches de 75 cm, passe-pied de 45 cm : 8 planches', () => {
    expect(exige('nombrePlanchesParDefaut')(9.6, 75, 45)).toBe(8);
  });

  it.each([
    // 8 × 0,75 + 7 × 0,45 = 9,15 ≤ 9,6 ; 9 × 0,75 + 8 × 0,45 = 10,35 > 9,6
    [9.6, 75, 45, 8],
    // pile : 2 × 0,75 + 0,45 = 1,95 (égalité acceptée, malgré la virgule flottante)
    [1.95, 75, 45, 2],
    // juste en dessous : 1,949 m ne contient pas deux planches
    [1.949, 75, 45, 1],
    [0.75, 75, 45, 1],
    // aucune planche n'entre
    [0.74, 75, 45, 0],
    // sans passe-pied : 9,6 / 0,8 = 12 pile
    [9.6, 80, 0, 12],
  ])('nombrePlanchesParDefaut(%s m, %s cm, passe-pied %s cm) = %s', (chapelle, planche, passePied, attendu) => {
    expect(exige('nombrePlanchesParDefaut')(chapelle, planche, passePied)).toBe(attendu);
  });

  it('sans serre précédente : 1 chapelle de 9,6 m, 1 tronçon de 40 m, allée 4,40 m, 8 planches de 75 cm × 38 m, passe-pied 45 cm', () => {
    expect(exige('defautsSerre')()).toMatchObject({
      largeurChapelleM: 9.6,
      nbChapelles: 1,
      longueurTronconM: 40,
      nbTroncons: 1,
      largeurAlleeM: 4.4,
      planches: { nombre: 8, largeurCm: 75, longueurM: 38, passePiedCm: 45 },
    });
    expect(exige('defautsSerre')(null)).toEqual(exige('defautsSerre')());
  });

  it('longueur des planches = longueur du tronçon − 2 m (tronçon de 25 m : 23 m)', () => {
    const d = exige('defautsSerre')({ largeurChapelleM: 9.6, nbChapelles: 2, longueurTronconM: 25, nbTroncons: 1, largeurAlleeM: 4.4 });
    expect(d.planches.longueurM).toBe(23);
  });

  it('les défauts reprennent la dernière serre créée (mesures), planches recalculées sur SES mesures', () => {
    const d = exige('defautsSerre')({ largeurChapelleM: 8, nbChapelles: 4, longueurTronconM: 30, nbTroncons: 2, largeurAlleeM: 3 });
    expect(d).toMatchObject({ largeurChapelleM: 8, nbChapelles: 4, longueurTronconM: 30, nbTroncons: 2, largeurAlleeM: 3 });
    // 8 m de chapelle : 6 × 0,75 + 5 × 0,45 = 6,75 ≤ 8 ; 7 × 0,75 + 6 × 0,45 = 7,95 ≤ 8 ; 8 × … = 9,15 > 8
    expect(d.planches).toEqual({ nombre: 7, largeurCm: 75, longueurM: 28, passePiedCm: 45 });
  });

  it('la dernière serre donne aussi ses planches, reprises telles quelles', () => {
    const planches = { nombre: 5, largeurCm: 80, longueurM: 20, passePiedCm: 50 };
    const d = exige('defautsSerre')({ largeurChapelleM: 8, nbChapelles: 4, longueurTronconM: 30, nbTroncons: 2, largeurAlleeM: 3, planches });
    expect(d.planches).toEqual(planches);
  });

  it('nom et préfixe vides : l’écran les préremplit, le cœur n’invente pas de nom', () => {
    expect(exige('defautsSerre')()).toMatchObject({ nom: '', prefixeZones: '' });
  });
});

describe('T89 : résumé calculé', () => {
  it('serre à légumes (6 chapelles de 9,6 m, 3 tronçons de 40 m, allées de 4,40 m) : 57,6 × 128,8 m, 18 zones, 144 planches', () => {
    expect(exige('resumeSerre')(legumes())).toEqual({ largeurM: 57.6, longueurM: 128.8, nbZones: 18, nbPlanches: 144, texte: '57,6 × 128,8 m, 18 zones, 144 planches' });
  });

  it('tunnel Manon (3 chapelles de 9,6 m, 1 tronçon de 40 m) : 28,8 × 40 m, 3 zones (24 planches)', () => {
    const r = exige('resumeSerre')(manon());
    expect(r).toMatchObject({ largeurM: 28.8, longueurM: 40, nbZones: 3, nbPlanches: 24 });
    expect(r.texte).toBe('28,8 × 40 m, 3 zones, 24 planches');
  });

  it('un seul tronçon : l’allée ne compte pas, même renseignée', () => {
    expect(exige('resumeSerre')(avec({ nbChapelles: 3, nbTroncons: 1, largeurAlleeM: 9 })).longueurM).toBe(40);
  });

  it('au millimètre, sans bruit de virgule flottante (3 × 0,1 m d’allée)', () => {
    const r = exige('resumeSerre')(avec({ nbChapelles: 1, nbTroncons: 4, longueurTronconM: 10, largeurAlleeM: 0.1 }));
    expect(r.longueurM).toBe(40.3);
    expect(r.texte).toBe('9,6 × 40,3 m, 4 zones, 32 planches');
  });

  it('une zone, une planche : singulier', () => {
    const r = exige('resumeSerre')({ ...avec({}), planches: { nombre: 1, largeurCm: 75, longueurM: 38, passePiedCm: 45 } });
    expect(r.texte).toBe('9,6 × 40 m, 1 zone, 1 planche');
  });

  it('zéro planche : « 0 planche »', () => {
    const r = exige('resumeSerre')({ ...avec({}), planches: { nombre: 0, largeurCm: 75, longueurM: 38, passePiedCm: 45 } });
    expect(r.texte).toBe('9,6 × 40 m, 1 zone, 0 planche');
  });
});

describe('T89 : type du bâtiment et noms des zones', () => {
  it('1 chapelle : serre_tunnel ; 2 chapelles et plus : serre_chapelle', () => {
    const type = exige('typeDeSerre');
    expect(type(1)).toBe('serre_tunnel');
    expect(type(3)).toBe('serre_chapelle');
    expect(type(6)).toBe('serre_chapelle');
  });

  it('les zones sont numérotées 1, 2, 3… à la suite du préfixe', () => {
    expect(exige('nomsDesZones')('Serre à légumes', 3)).toEqual(['Serre à légumes 1', 'Serre à légumes 2', 'Serre à légumes 3']);
    expect(exige('nomsDesZones')('Serre à légumes', 18).at(-1)).toBe('Serre à légumes 18');
    expect(exige('nomsDesZones')('Manon', 0)).toEqual([]);
  });

  it('l’ordre naturel de T88 range « Serre à légumes 10 » après « 9 » : les 18 noms remplissent les 18 cases dans l’ordre', () => {
    const noms = exige('nomsDesZones')('Serre à légumes', 18);
    const r = casesDeSerre(
      { longueurM: 128.8, largeurM: 57.6, nbChapelles: 6, nbTroncons: 3, largeurAlleeM: 4.4 },
      noms.map((nom, i) => ({ id: `z${String(i + 1)}`, nom })),
    );
    expect(r.sansCase).toEqual([]);
    expect(r.cases.map((c) => c.nom)).toEqual(noms);
  });
});
