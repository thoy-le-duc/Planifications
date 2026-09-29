/**
 * Tests d'acceptation T14 — lecteur Excel (.xlsx), chargé à part (src/import/xlsx.ts).
 * Contrat : ./test/contrat.ts, « Lecteur Excel ». Fichier : __fixtures__/series-titre.xlsx,
 * un vrai classeur (chaînes partagées dans la première feuille, chaînes en ligne dans la seconde,
 * titre fusionné, vraies dates Excel).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerXlsx, type LecteurClasseur } from './test/contrat.ts';
import { lireFixture, sansFinFeuille, utf8 } from './test/fixtures.ts';

let lecteur: LecteurClasseur;

beforeAll(async () => {
  lecteur = (await chargerXlsx()).lecteurXlsx;
});

describe('lecteurXlsx.lire', () => {
  it('feuilles dans l’ordre du classeur, avec leur nom ; lignes et colonnes comme dans Excel', async () => {
    const r = await lecteur.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(`classeur illisible : ${r.message}`);
    expect(r.feuilles.map((f) => f.nom)).toStrictEqual(['Séries 2027', 'Notes']);
    expect(sansFinFeuille(r.feuilles[0]?.lignes ?? [])).toStrictEqual([
      ['Plan de culture 2027 — Ferme de Benoît'],
      [],
      ['Culture', 'Variété', 'N° planche', 'Date semis', 'Date plantation', 'Début récolte', 'Fin récolte', 'Longueur'],
      ['Radis', 'Flamboyant 5', 'N3', 46461, null, 46496, 46517, 30],
      ['Épinard', "Géant d'hiver", 'N4', '15/03/2027', null, 46517, 46539, '1500 cm'],
      ['Tomate', 'Cœur de bœuf', 'TA2', null, 46517, 46583, null, 25.5],
      [],
      ['Total', null, null, null, null, null, null, 85.5],
    ]);
  });

  it('seconde feuille (chaînes en ligne)', async () => {
    const r = await lecteur.lire(await lireFixture('series-titre.xlsx'));
    if (!r.ok) throw new Error(r.message);
    expect(sansFinFeuille(r.feuilles[1]?.lignes ?? [])).toStrictEqual([['Semences commandées chez Voltz'], [12]]);
  });

  it('ce qui n’est pas un classeur : résultat en échec, jamais de rejet', async () => {
    const cas = [new Uint8Array(0), utf8('Zone;Planche\r\nT1;P1\r\n'), new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), await lireFixture('parcellaire-anglais.csv')];
    for (const octets of cas) {
      const r = await lecteur.lire(octets);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('classeur_illisible');
        expect(r.message.trim().length).toBeGreaterThan(5);
      }
    }
  });

  it('classeur tronqué : échec, pas d’exception', async () => {
    const octets = await lireFixture('series-titre.xlsx');
    const r = await lecteur.lire(octets.slice(0, Math.floor(octets.length / 2)));
    expect(r.ok).toBe(false);
  });

  it('ne modifie pas les octets reçus', async () => {
    const octets = await lireFixture('series-titre.xlsx');
    const copie = octets.slice();
    await lecteur.lire(octets);
    expect(octets).toStrictEqual(copie);
  });
});
