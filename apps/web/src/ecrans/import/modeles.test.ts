/**
 * Tests d'acceptation T14b — garde à l'exécution sur un modèle d'import relu (suite de la
 * relecture de T14c) : ce que le rangement rend (texte JSON, ou objet relu d'IndexedDB ou du
 * JSON) passe par `relireModele` (./modeles.ts) avant appliquerModele et creerModele. Rend le
 * modèle ou null, ne lève jamais ; un modèle rendu est toujours accepté par creerModele.
 * Contrat : ./test/contrat.ts (ModuleModeles).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { appliquerModele, creerModele, serialiserModele, type Correspondance, type ModeleImport } from '@planif/core';
import type { ModuleModeles } from './test/contrat.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN = './modeles.ts';

let m: ModuleModeles;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleModeles;
});

const ENTETES = ['Lieu-dit', 'Planche', 'Culture', 'Semaine de plantation', 'Mètres'] as const;
const CORRESPONDANCE: Correspondance = {
  type: 'series',
  colonnes: [
    { champ: null, unite: null },
    { champ: 'emplacement', unite: null },
    { champ: 'espece', unite: null },
    { champ: 'date_plantation', unite: null },
    { champ: 'longueur_m', unite: 'm' },
  ],
};

function modeleValide(): ModeleImport {
  const r = creerModele(ENTETES, CORRESPONDANCE, [{ champ: 'espece', valeur: 'Salade du jardin', decision: { sorte: 'existante', id: 'esp-laitue' } }]);
  if (!r.ok) throw new Error(r.message);
  return r.modele;
}

/** Le modèle relu est sûr : creerModele l'accepte tel quel, sans lever. */
function accepteParCreerModele(modele: ModeleImport): void {
  const entetes = modele.colonnes.map((c) => c.entete);
  const correspondance = appliquerModele(modele, entetes);
  expect(correspondance, 'appliquerModele sur ses propres en-têtes').not.toBeNull();
  if (correspondance === null) return;
  const r = creerModele(entetes, correspondance, modele.choix);
  expect(r.ok, r.ok ? '' : r.message).toBe(true);
}

describe('relireModele : garde à l’exécution avant creerModele', () => {
  it('relit un modèle rangé en texte JSON ou en objet : identique, accepté par creerModele', () => {
    const modele = modeleValide();
    const texte = serialiserModele(modele);
    for (const brut of [texte, JSON.parse(texte) as unknown, structuredClone(JSON.parse(texte) as unknown)]) {
      const relu = m.relireModele(brut);
      expect(relu).toStrictEqual(modele);
      if (relu !== null) accepteParCreerModele(relu);
    }
  });

  const objet = (modif: (o: Record<string, unknown>) => void): unknown => {
    const o = JSON.parse(serialiserModele(modeleValide())) as Record<string, unknown>;
    modif(o);
    return o;
  };
  /** Colonne `i` du modèle sérialisé (elle existe : le modèle de départ en a cinq). */
  const col = (o: Record<string, unknown>, i: number): Record<string, unknown> => {
    const c = (o.colonnes as Record<string, unknown>[])[i];
    if (c === undefined) throw new Error(`colonne ${String(i)} absente`);
    return c;
  };

  const REFUSES: readonly (readonly [string, () => unknown])[] = [
    ['undefined', () => undefined],
    ['null', () => null],
    ['nombre', () => 42],
    ['texte qui n’est pas du JSON', () => '{pas du json'],
    ['tableau', () => []],
    ['objet vide', () => ({})],
    ['version 2', () => objet((o) => (o.version = 2))],
    ['type inconnu', () => objet((o) => (o.type = 'recoltes'))],
    ['colonnes pas un tableau', () => objet((o) => (o.colonnes = 'a'))],
    ['colonne nulle', () => objet((o) => ((o.colonnes as unknown[])[0] = null))],
    ['en-tête pas un texte', () => objet((o) => (col(o, 1).entete = 12))],
    ['champ inconnu', () => objet((o) => (col(o, 1).champ = 'prix'))],
    ['champ d’un autre type', () => objet((o) => (col(o, 1).champ = 'type_abri'))],
    ['champ associé à deux colonnes (ancien modèle)', () => objet((o) => (col(o, 0).champ = 'espece'))],
    ['unité refusée pour le champ', () => objet((o) => (col(o, 4).unite = 'kg'))],
    ['unité sur une colonne ignorée', () => objet((o) => (col(o, 0).unite = 'm'))],
    ['choix pas un tableau', () => objet((o) => (o.choix = {}))],
    ['choix sans décision', () => objet((o) => (o.choix = [{ champ: 'espece', valeur: 'x' }]))],
    ['choix à identifiant vide', () => objet((o) => (o.choix = [{ champ: 'espece', valeur: 'x', decision: { sorte: 'existante', id: '' } }]))],
    ['choix nouveau fait d’espaces', () => objet((o) => (o.choix = [{ champ: 'espece', valeur: 'x', decision: { sorte: 'nouvelle', nom: '   ' } }]))],
    ['choix sur un champ qui n’est pas une référence', () => objet((o) => (o.choix = [{ champ: 'zone', valeur: 'x', decision: { sorte: 'existante', id: 'z' } }]))],
    ['BigInt', () => BigInt(1)],
    ['symbole', () => Symbol('modele')],
    ['fonction', () => () => modeleValide()],
    [
      'objet circulaire',
      () => {
        const o: Record<string, unknown> = { version: 1, type: 'series', choix: [] };
        o.colonnes = [o];
        return o;
      },
    ],
    [
      'accesseur qui lève',
      () =>
        Object.defineProperty({ version: 1, type: 'series', choix: [] }, 'colonnes', {
          enumerable: true,
          get() {
            throw new Error('piège');
          },
        }),
    ],
  ];

  it.each(REFUSES)('refuse sans lever : %s', (_nom, fabrique) => {
    const brut = fabrique();
    let relu: ModeleImport | null | undefined;
    expect(() => {
      relu = m.relireModele(brut);
    }).not.toThrow();
    expect(relu).toBeNull();
  });

  it('un modèle accepté avec des champs en trop est rendu sans eux, et reste accepté par creerModele', () => {
    const brut = objet((o) => {
      o.enTrop = 'x';
      col(o, 1).note = 'y';
    });
    const relu = m.relireModele(brut);
    if (relu === null) return; // refuser est permis aussi
    expect(Object.keys(relu).sort()).toEqual(['choix', 'colonnes', 'type', 'version']);
    for (const c of relu.colonnes) expect(Object.keys(c).sort()).toEqual(['champ', 'entete', 'unite']);
    accepteParCreerModele(relu);
  });
});
