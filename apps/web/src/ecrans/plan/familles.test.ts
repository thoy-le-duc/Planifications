/**
 * Tests d'acceptation T27b — `cleFamille` couvre les 16 familles de la bibliothèque commune
 * (FAMILLES_PAR_DEFAUT de @planif/core) ; le reste tombe sur « autre », jamais sur null.
 * Contrat : ../plan3d/test/contrat-filtres.ts. Remplace, pour la clé, « les autres restent neutres »
 * de calculs.test.ts (T11), dont l'assertion est mise à jour dans un commit séparé.
 */
import { FAMILLES_PAR_DEFAUT } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLES_FAMILLES } from '../plan3d/test/contrat-filtres.ts';
import { O, PETITE_FERME, SAISON_2026 } from './test/petite-ferme.ts';

interface ModuleCles {
  cleFamille(nomFamille: string | null): string;
  construirePlan(donnees: unknown, options: { saison: unknown; aujourdhui: string }): {
    lignes: readonly { sorte: string; barres?: readonly { occupationId: string; cleFamille: string | null }[] }[];
  };
}

const CHEMIN_CALCULS = './calculs.ts';
let m: ModuleCles;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCles;
});

const sansAccents = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

describe('T27b : cleFamille, bibliothèque commune', () => {
  it('la bibliothèque a bien 16 familles', () => {
    expect(FAMILLES_PAR_DEFAUT).toHaveLength(16);
  });

  it('chaque famille a sa clé, sans accents ni casse, toutes différentes, aucune « autre »', () => {
    const cles = FAMILLES_PAR_DEFAUT.map((f) => m.cleFamille(f.nom));
    for (const [i, cle] of cles.entries()) {
      expect(cle, FAMILLES_PAR_DEFAUT[i]?.nom).toMatch(/^[a-z]+$/);
      expect(cle, FAMILLES_PAR_DEFAUT[i]?.nom).not.toBe('autre');
      expect(CLES_FAMILLES as readonly string[], FAMILLES_PAR_DEFAUT[i]?.nom).toContain(cle);
    }
    expect(new Set(cles).size).toBe(16);
  });

  it('les 12 familles nouvelles ont pour clé leur nom sans accents', () => {
    const anciennes = new Set(['Astéracées', 'Solanacées', 'Brassicacées', 'Apiacées']);
    const nouvelles = FAMILLES_PAR_DEFAUT.filter((f) => !anciennes.has(f.nom));
    expect(nouvelles).toHaveLength(12);
    for (const f of nouvelles) expect(m.cleFamille(f.nom), f.nom).toBe(sansAccents(f.nom));
    expect(nouvelles.map((f) => m.cleFamille(f.nom)).sort()).toEqual(
      ['alliacees', 'amaranthacees', 'asparagacees', 'convolvulacees', 'cucurbitacees', 'fabacees', 'lamiacees', 'paeoniacees', 'poacees', 'polygonacees', 'rosacees', 'valerianacees'].sort(),
    );
  });

  it('les quatre clés de T16 sont conservées', () => {
    expect(m.cleFamille('Astéracées')).toBe('salades');
    expect(m.cleFamille('Solanacées')).toBe('solanacees');
    expect(m.cleFamille('Brassicacées')).toBe('cruciferes');
    expect(m.cleFamille('Crucifères')).toBe('cruciferes');
    expect(m.cleFamille('Apiacées')).toBe('racines');
  });

  it('insensible à la casse et aux accents', () => {
    expect(m.cleFamille('CUCURBITACÉES')).toBe('cucurbitacees');
    expect(m.cleFamille('rosacees')).toBe('rosacees');
    expect(m.cleFamille('Valérianacées')).toBe('valerianacees');
    expect(m.cleFamille('PAEONIACÉES')).toBe('paeoniacees');
  });

  it('famille propre à la ferme, inconnue, vide ou absente → « autre »', () => {
    for (const autre of ['Famille locale 1', 'Ombellifères du voisin', '', ' ']) expect(m.cleFamille(autre), autre).toBe('autre');
    expect(m.cleFamille(null)).toBe('autre');
  });
});

describe('T27b : cleFamille dans le plan', () => {
  const barres = (): Map<string, string | null> => {
    const plan = m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-06-10' });
    const par = new Map<string, string | null>();
    for (const l of plan.lignes) for (const b of l.barres ?? []) par.set(b.occupationId, b.cleFamille);
    return par;
  };

  it('la courgette (Cucurbitacées) a sa clé ; la couverture (sans famille) est « autre »', () => {
    const par = barres();
    expect(par.get(O.courgetteHiver)).toBe('cucurbitacees');
    expect(par.get(O.couverture)).toBe('autre');
    expect(par.get(O.tomateReelle)).toBe('solanacees');
  });
});
