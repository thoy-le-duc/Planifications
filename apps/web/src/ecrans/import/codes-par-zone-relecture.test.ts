/**
 * T14f, non-régression des fautes trouvées en relecture (docs/backlog/T14f-import-codes-par-zone.md) :
 *   1. parcellaire : le doublon du fichier se compare sur la zone résolue, pas sur ses noms
 *      (« Chapelle A » seule et « Tunnel 1 / Chapelle A » sont la même sous-zone) ;
 *   2. deux planches en service avec le même code dans la même zone (base locale écrite hors
 *      ligne, avant le refus du serveur) : jamais de choix silencieux, et un message juste ;
 *   3. code comparé avec le `trim()` de Postgres : espaces seulement, ni tabulation ni insécable.
 */
import { proposerCorrespondance, type TypeContenu } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { COLONNES } from './construction.ts';
import { codeDe } from './normaliser.ts';
import { MoteurImport } from './preparation.ts';
import type { ContexteBase, DemandePreparation, EmplacementConnu, LigneApercu } from './types.ts';

const id = (n: number): string => `0192f0c1-14f2-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = id(1);
const ZONE = { tunnel1: id(0x10), chapelleA: id(0x11), tunnel2: id(0x12) } as const;
const PLANCHE = { p3a: id(0x20), p3b: id(0x21), p4t2: id(0x22), p6nbsp: id(0x23) } as const;
const ESPECE_LAITUE = id(0x40);

const planche = (pid: string, zoneId: string, code: string): EmplacementConnu => ({ id: pid, zoneId, code, sorte: 'planche', longueurM: 30, nombrePlaces: null });

const CONTEXTE: ContexteBase = {
  fermeId: FERME,
  zones: [
    { id: ZONE.tunnel1, nom: 'Tunnel 1', parenteId: null },
    { id: ZONE.chapelleA, nom: 'Chapelle A', parenteId: ZONE.tunnel1 },
    { id: ZONE.tunnel2, nom: 'Tunnel 2', parenteId: null },
  ],
  emplacements: [
    // Deux « P3 » en service dans le Tunnel 1 : état local possible avant le refus du serveur.
    planche(PLANCHE.p3a, ZONE.tunnel1, 'P3'),
    planche(PLANCHE.p3b, ZONE.tunnel1, 'p3'),
    planche(PLANCHE.p4t2, ZONE.tunnel2, 'P4'),
    // Espace insécable en fin de code : pour Postgres, un autre code que « P6 ».
    planche(PLANCHE.p6nbsp, ZONE.tunnel2, 'P6 '),
  ],
  especes: [{ id: ESPECE_LAITUE, nom: 'Laitue', familleId: null }],
  familles: [],
  varietes: [],
  itineraires: [],
  saisons: [],
  series: [],
  assolements: [],
};

interface Resultat {
  readonly lignes: readonly LigneApercu[];
  readonly inserees: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

function importer(type: TypeContenu, lignes: readonly (readonly string[])[]): Resultat {
  const moteur = new MoteurImport();
  const lu = moteur.lireOctets(`${type}.csv`, new TextEncoder().encode(lignes.map((l) => l.join(';')).join('\n')));
  if (!lu.ok) throw new Error(lu.message);
  const demande: DemandePreparation = {
    correspondance: proposerCorrespondance(lu.analyse.entetes, type),
    anneeSaison: 2027,
    choix: [],
    zoneParDefaut: null,
    contexte: CONTEXTE,
    maintenant: '2027-01-15T08:00:00.000Z',
    nomFichier: `${type}.csv`,
    attributsEspeces: {},
    plafondValeurs: 2000,
  };
  const r = moteur.preparer(demande);
  if (r.sorte !== 'apercu') throw new Error(`aperçu attendu, reçu ${r.sorte}`);
  const inserees: Record<string, Record<string, unknown>[]> = {};
  for (let i = 0; i < r.apercu.lots; i++) {
    for (const o of moteur.lot(i)) {
      const table = /^INSERT INTO (\w+) /.exec(o.sql)?.[1];
      if (table === undefined) continue;
      const colonnes = COLONNES[table] ?? [];
      (inserees[table] ??= []).push(Object.fromEntries(colonnes.map((c, k) => [c, o.parametres?.[k]])));
    }
  }
  return { lignes: r.apercu.lignes, inserees };
}

const ligne = (r: Resultat, n: number): LigneApercu | undefined => r.lignes.find((l) => l.ligne === n);
const messages = (r: Resultat, n: number): string => (ligne(r, n)?.erreurs ?? []).map((e) => e.message).join(' | ');
const detail = (r: Resultat): string => JSON.stringify(r.lignes);
const SERIE = ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte', 'Longueur (m)'];
const serie = (zone: string, code: string): string[] => ['Laitue', zone, code, '2027-04-05', '2027-05-20', '2027-06-10', '20'];

describe('T14f, relecture : doublon du parcellaire sur la zone résolue', () => {
  it('« Chapelle A / – / P9 » puis « Tunnel 1 / Chapelle A / P9 » : même sous-zone → doublon, une seule P9 créée', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Sous-zone', 'Planche', 'Longueur (m)'],
      ['Chapelle A', '', 'P9', '30'],
      ['Tunnel 1', 'Chapelle A', 'P9', '30'],
    ]);
    expect(ligne(r, 3)?.statut, detail(r)).toBe('doublon');
    expect(ligne(r, 3)?.doublonDe).toBe(2);
    expect((r.inserees.emplacement ?? []).map((e) => [e.zone_id, e.code])).toStrictEqual([[ZONE.chapelleA, 'P9']]);
  });

  it('zone créée par le fichier : la même planche deux fois dans la nouvelle zone → doublon', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 5', 'P1', '30'],
      ['tunnel 5', ' p1', '30'],
    ]);
    expect(ligne(r, 3)?.statut, detail(r)).toBe('doublon');
    expect(ligne(r, 3)?.doublonDe).toBe(2);
    expect(r.inserees.emplacement ?? []).toHaveLength(1);
  });
});

describe('T14f, relecture : deux planches en service avec le même code dans la même zone', () => {
  it('avec la zone : refus « Code ambigu » qui nomme la zone, sans parler de plusieurs zones', () => {
    const r = importer('series', [SERIE, serie('Tunnel 1', 'P3')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    const m = messages(r, 2);
    expect(m).toContain('Code ambigu');
    expect(m).toContain('« P3 »');
    expect(m).toContain('Tunnel 1');
    expect(m).not.toMatch(/plusieurs (sous-)?zones/);
    expect(r.inserees.occupation ?? []).toHaveLength(0);
  });

  it('sans la zone : même refus, message juste (une seule zone en cause)', () => {
    const r = importer('series', [SERIE, serie('', 'P3')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    const m = messages(r, 2);
    expect(m).toContain('Code ambigu');
    expect(m).toContain('Tunnel 1');
    expect(m).not.toMatch(/plusieurs zones/);
    expect(r.inserees.occupation ?? []).toHaveLength(0);
  });

  it('parcellaire : « Tunnel 1 / P3 » reste un doublon contre la base', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 1', 'P3', '30'],
    ]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('doublon');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
  });
});

describe('T14f, relecture : `trim()` de Postgres, espaces seulement', () => {
  it('codeDe retire les espaces autour, pas les tabulations ni les espaces insécables', () => {
    expect(codeDe('  P3 ')).toBe('p3');
    expect(codeDe('P3 ')).toBe('p3 ');
    expect(codeDe('\tP3')).toBe('\tp3');
  });

  it('« P6 » au Tunnel 2 n’est pas la planche « P6 » + espace insécable de la base : créée, comme le serveur l’accepte', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 2', 'P6', '30'],
    ]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect((r.inserees.emplacement ?? []).map((e) => e.code)).toStrictEqual(['P6']);
  });
});
