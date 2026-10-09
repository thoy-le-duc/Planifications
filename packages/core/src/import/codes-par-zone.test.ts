/**
 * T14f — moteur d'import (cœur) : un code de planche se compare dans sa zone, sans casse et sans
 * espaces autour, exactement comme le serveur depuis T10t (Q27 : `lower(trim(code))` par zone,
 * index emplacement_zone_code_actif_idx de la migration 0029). Rien de plus : la ponctuation et
 * les accents d'un code comptent (« P-3 » et « P.3 » sont deux planches pour le serveur, l'import
 * ne doit pas en écarter une comme doublon).
 *
 * Un fichier de séries peut donner la zone de chaque planche (champ `zone`, facultatif) : c'est ce
 * qui lève l'ambiguïté d'un code repris dans plusieurs zones (docs/backlog/T14f-import-codes-par-zone.md).
 */
import { describe, expect, it } from 'vitest';
import { CHAMPS_IMPORT, preparerImport, proposerCorrespondance, type LigneBrute, type PlanImport, type TypeContenu } from './index.ts';
import { BIBLIOTHEQUE } from './test/fixtures.ts';

function plan(lignes: readonly LigneBrute[], type: TypeContenu): PlanImport {
  const entetes = (lignes[0] ?? []).map((c) => (c === null ? '' : String(c)));
  return preparerImport({ lignes, ligneEntete: 0, correspondance: proposerCorrespondance(entetes, type), bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027 });
}

const statuts = (p: PlanImport): (readonly [number, string, number | null])[] => p.lignes.map((l) => [l.ligne, l.statut, l.doublonDe ?? null] as const);

describe('T14f : parcellaire, doublons du fichier par zone + code (normalisation de T10t)', () => {
  it('« p3 » et « P3 » (espaces autour) dans la même zone → doublon de la première', () => {
    const p = plan(
      [
        ['Zone', 'Planche', 'Longueur'],
        ['Tunnel 1', 'p3', '30'],
        ['Tunnel 1', '  P3  ', '30'],
      ],
      'parcellaire',
    );
    expect(statuts(p)).toStrictEqual([
      [2, 'valide', null],
      [3, 'doublon', 2],
    ]);
  });

  it('« P3 » dans deux zones → deux planches, sans doublon', () => {
    const p = plan(
      [
        ['Zone', 'Planche', 'Longueur'],
        ['Tunnel 1', 'P3', '30'],
        ['Tunnel 2', 'P3', '30'],
      ],
      'parcellaire',
    );
    expect(p.resume.doublons).toBe(0);
    expect(p.resume.valides).toBe(2);
  });

  it('« P-3 », « P 3 » et « P.3 » dans la même zone : trois codes distincts pour le serveur, aucun doublon', () => {
    const p = plan(
      [
        ['Zone', 'Planche', 'Longueur'],
        ['Tunnel 1', 'P-3', '30'],
        ['Tunnel 1', 'P 3', '30'],
        ['Tunnel 1', 'P.3', '30'],
      ],
      'parcellaire',
    );
    expect(statuts(p)).toStrictEqual([
      [2, 'valide', null],
      [3, 'valide', null],
      [4, 'valide', null],
    ]);
  });
});

describe('T14f : séries, une colonne Zone facultative', () => {
  it('le champ `zone` fait partie des séries, facultatif', () => {
    const zone = CHAMPS_IMPORT.series.find((c) => c.cle === 'zone');
    expect(zone, 'champ zone des séries').toBeDefined();
    expect(zone?.obligatoire ?? false).toBe(false);
  });

  it('l’en-tête « Zone » d’un fichier de séries est proposé sur le champ zone', () => {
    const c = proposerCorrespondance(['Culture', 'Zone', 'Planche', 'Plantation'], 'series');
    expect(c.colonnes.map((x) => x.champ)).toStrictEqual(['espece', 'zone', 'emplacement', 'date_plantation']);
  });

  it('la zone est lue sur la ligne ; la même série sur P3 de deux zones n’est pas un doublon du fichier', () => {
    const p = plan(
      [
        ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte'],
        ['Laitue', 'Tunnel 1', 'P3', '2027-04-05', '2027-05-20'],
        ['Laitue', 'Tunnel 2', 'P3', '2027-04-05', '2027-05-20'],
        ['Laitue', ' tunnel 2 ', 'p3', '2027-04-05', '2027-05-20'],
      ],
      'series',
    );
    expect(p.lignes[0]?.valeurs.zone).toBe('Tunnel 1');
    expect(statuts(p)).toStrictEqual([
      [2, 'valide', null],
      [3, 'valide', null],
      [4, 'doublon', 3],
    ]);
  });
});
