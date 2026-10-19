/**
 * T51 (relecture) — une série importée sur une gouttière occupe des PAINS, plus des places.
 *
 * Depuis T51, `occupation.nombre_places` d'une gouttière compte des pains, comparés au
 * `nombre_pains` de la gouttière (detecterConflits). L'import écrivait encore le nombre de plants
 * (ou l'ancien nombre de places) : 720 « pains » sur une gouttière de 30, fausse surcharge sur le
 * plan ; et, sur une gouttière créée depuis T51 (sans ancien nombre de places), une longueur en
 * mètres. Règle : toute la gouttière (ses pains, 1 par mètre s'ils ne sont pas encore connus),
 * ou, avec un nombre de plants et l'ancien nombre de places, la même part que la migration 0037
 * (max(1, min(pains, arrondi(plants × pains ÷ places)))).
 */
import { proposerCorrespondance } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { COLONNES } from './construction.ts';
import { MoteurImport } from './preparation.ts';
import type { ContexteBase, DemandePreparation, EmplacementConnu } from './types.ts';

const id = (n: number): string => `0192f0c1-51a0-7000-8000-${n.toString(16).padStart(12, '0')}`;
const ZONE = id(0x10);
const G = { ancienne: id(0x20), neuve: id(0x21), sansPains: id(0x22) } as const;

const gouttiere = (gid: string, code: string, longueurM: number, nombrePlaces: number | null, nombrePains: number | null): EmplacementConnu => ({
  id: gid,
  zoneId: ZONE,
  code,
  sorte: 'gouttiere',
  longueurM,
  nombrePlaces,
  nombrePains,
});

const CONTEXTE: ContexteBase = {
  fermeId: id(1),
  zones: [{ id: ZONE, nom: 'Hors-sol', parenteId: null }],
  emplacements: [
    // Gouttière d'avant T51 : 120 places, 30 pains (migration 0037).
    gouttiere(G.ancienne, 'G1', 30, 120, 30),
    // Gouttière créée depuis T51 : pas d'ancien nombre de places.
    gouttiere(G.neuve, 'G2', 24, null, 24),
    // Gouttière écrite hors ligne, pains pas encore revenus du serveur : 1 par mètre.
    gouttiere(G.sansPains, 'G3', 19.6, null, null),
  ],
  especes: [{ id: id(0x40), nom: 'Fraise', familleId: null }],
  familles: [],
  varietes: [],
  itineraires: [],
  saisons: [],
  series: [],
  assolements: [],
};

function occupations(lignes: readonly (readonly string[])[]): Readonly<Record<string, unknown>>[] {
  const moteur = new MoteurImport();
  const lu = moteur.lireOctets('series.csv', new TextEncoder().encode(lignes.map((l) => l.join(';')).join('\n')));
  if (!lu.ok) throw new Error(lu.message);
  const demande: DemandePreparation = {
    correspondance: proposerCorrespondance(lu.analyse.entetes, 'series'),
    anneeSaison: 2027,
    choix: [],
    zoneParDefaut: null,
    contexte: CONTEXTE,
    maintenant: '2027-01-15T08:00:00.000Z',
    nomFichier: 'series.csv',
    attributsEspeces: {},
    plafondValeurs: 2000,
  };
  const r = moteur.preparer(demande);
  if (r.sorte !== 'apercu') throw new Error(`aperçu attendu, reçu ${r.sorte}`);
  expect(r.apercu.erreurs, JSON.stringify(r.apercu.lignes)).toBe(0);
  const inserees: Record<string, unknown>[] = [];
  for (let i = 0; i < r.apercu.lots; i++) {
    for (const o of moteur.lot(i)) {
      if (!o.sql.startsWith('INSERT INTO occupation ')) continue;
      const colonnes = COLONNES.occupation ?? [];
      inserees.push(Object.fromEntries(colonnes.map((c, k) => [c, o.parametres?.[k]])));
    }
  }
  return inserees;
}

const place = (os: readonly Readonly<Record<string, unknown>>[], emplacementId: string) => {
  const o = os.find((x) => x.emplacement_id === emplacementId);
  return o === undefined ? undefined : { longueur_m: o.longueur_m, nombre_places: o.nombre_places };
};

describe('T51 : série importée sur une gouttière, place comptée en pains', () => {
  it('sans nombre de plants : toute la gouttière, en pains (1 par mètre si pas encore connus)', () => {
    const os = occupations([
      ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte'],
      ['Fraise', 'Hors-sol', 'G1', '2027-02-01', '2027-04-10', '2027-06-20'],
      ['Fraise', 'Hors-sol', 'G2', '2027-02-01', '2027-04-10', '2027-06-20'],
      ['Fraise', 'Hors-sol', 'G3', '2027-02-01', '2027-04-10', '2027-06-20'],
    ]);
    expect(place(os, G.ancienne)).toEqual({ longueur_m: null, nombre_places: 30 });
    expect(place(os, G.neuve)).toEqual({ longueur_m: null, nombre_places: 24 });
    expect(place(os, G.sansPains)).toEqual({ longueur_m: null, nombre_places: 20 });
  });

  it('avec un nombre de plants : la même part de la gouttière que la migration 0037, jamais plus que ses pains', () => {
    const os = occupations([
      ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte', 'Nombre de plants'],
      // 60 plants sur 120 places → la moitié de 30 pains.
      ['Fraise', 'Hors-sol', 'G1', '2027-02-01', '2027-04-10', '2027-06-20', '60'],
      // Pas d'ancien nombre de places : 288 plants ne disent pas combien de pains, toute la gouttière.
      ['Fraise', 'Hors-sol', 'G2', '2027-02-01', '2027-04-10', '2027-06-20', '288'],
    ]);
    expect(place(os, G.ancienne)).toEqual({ longueur_m: null, nombre_places: 15 });
    expect(place(os, G.neuve)).toEqual({ longueur_m: null, nombre_places: 24 });
  });
});
