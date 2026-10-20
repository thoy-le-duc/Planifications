/**
 * Test croisé T69 — la 3D (repères « Ne pas récolter », ../plan3d/dar3d.ts) et Aujourd'hui (alerte
 * de la récolte, ./dar.ts) donnent la même réponse, planche par planche, sur le même jeu de
 * traitements : une seule règle, celle du cœur (`interdictionRecolte`, docs/backlog/T69-dar-par-planche.md).
 *
 * Contrat de ./dar.ts (T69) : `alerteRecolte(traitements, emplacements, date, cultureId)`, où
 * `emplacements` sont ceux de la récolte avec leur code ({ id, code }) : le texte nomme les
 * planches interdites par leur code quand l'interdiction est partielle.
 */
import type { TraitementLu } from '@planif/core';
import { describe, expect, it } from 'vitest';
import type { TraitementsDar } from './dar.ts';

interface ModuleDar {
  alerteRecolte(t: TraitementsDar, emplacements: readonly { readonly id: string; readonly code: string }[], date: string, cultureId?: string | null): string | null;
}
interface ModuleDar3d {
  reperesDar(t: TraitementsDar, volumes: readonly { id: string; code: string; x: number; z: number; placee: boolean }[], date: string): { planche: string; texte: string }[];
}

const CHEMIN_DAR = './dar.ts';
const CHEMIN_DAR_3D = '../plan3d/dar3d.ts';

const uuid = (n: number): string => `0192f0c1-6969-7000-8000-${n.toString(16).padStart(12, '0')}`;
const PLANCHES = [1, 2, 3, 4, 5].map((n) => ({ id: uuid(0x10 + n), code: `P${String(n)}`, x: n, z: -n, placee: true }));
const [P1, P2, P3, P4, P5] = PLANCHES.map((p) => p.id) as [string, string, string, string, string];
const TOMATES = uuid(0x30);
const BOUILLIE = uuid(0x20);
const SOUFRE = uuid(0x21);

function traitement(n: number, date: string, autorisee: string, emplacements: readonly string[], produit = BOUILLIE, extra: Partial<TraitementLu> = {}): TraitementLu {
  return {
    id: uuid(0x100 + n),
    date,
    horodatage: `${date}T07:${String(n).padStart(2, '0')}:00.000Z`,
    emplacementIds: emplacements,
    remplaceSorte: null,
    remplaceEvenementId: null,
    produitPhytoId: produit,
    recolteAutoriseeLe: autorisee,
    cultureId: TOMATES,
    ...extra,
  };
}

const premier = traitement(1, '2026-05-10', '2026-05-13', [P3, P4]);
const JEU: TraitementsDar = {
  traitements: [
    premier,
    // Soufre sur P4, plus tard et plus long : P4 jusqu'au 20/05.
    traitement(2, '2026-05-12', '2026-05-20', [P4], SOUFRE),
    // Traitement de P5, annulé : P5 libre.
    traitement(3, '2026-05-10', '2026-05-24', [P5]),
    traitement(4, '2026-05-10', '2026-05-24', [P5], BOUILLIE, { remplaceSorte: 'annulation', remplaceEvenementId: uuid(0x103) }),
    // Traitement de P1, corrigé : P1 jusqu'au 15/05 au lieu du 30/05.
    traitement(5, '2026-05-11', '2026-05-30', [P1]),
    traitement(6, '2026-05-11', '2026-05-15', [P1], BOUILLIE, { remplaceSorte: 'correction', remplaceEvenementId: uuid(0x105) }),
  ],
  noms: new Map([
    [BOUILLIE, 'Bouillie bordelaise'],
    [SOUFRE, 'Soufre mouillable'],
  ]),
};

const JOURS = ['2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-19', '2026-05-20', '2026-05-25'];

describe('T69 : 3D et Aujourd’hui, même réponse planche par planche', () => {
  it('chaque jour, une planche a un repère dans la 3D si et seulement si sa récolte est alertée dans Aujourd’hui, avec le même texte', async () => {
    const dar = (await import(/* @vite-ignore */ CHEMIN_DAR)) as ModuleDar;
    const dar3d = (await import(/* @vite-ignore */ CHEMIN_DAR_3D)) as ModuleDar3d;
    let reperes = 0;
    for (const jour of JOURS) {
      const parPlanche = new Map(dar3d.reperesDar(JEU, PLANCHES, jour).map((r) => [r.planche, r.texte]));
      reperes += parPlanche.size;
      for (const p of PLANCHES) {
        expect(dar.alerteRecolte(JEU, [p], jour, TOMATES), `${p.code} le ${jour}`).toBe(parPlanche.get(p.id) ?? null);
      }
    }
    // Le jeu n'est pas vide : il y a bien des repères à comparer.
    expect(reperes).toBeGreaterThan(5);
  });

  it('le 11/05 : P1, P3, P4 interdites, P2 et P5 libres ; la récolte de toute la culture les nomme', async () => {
    const dar = (await import(/* @vite-ignore */ CHEMIN_DAR)) as ModuleDar;
    const dar3d = (await import(/* @vite-ignore */ CHEMIN_DAR_3D)) as ModuleDar3d;
    const reperes = dar3d.reperesDar(JEU, PLANCHES, '2026-05-11').map((r) => r.planche);
    expect(reperes).toEqual([P1, P3, P4]);
    for (const libre of [P2, P5]) {
      expect(reperes).not.toContain(libre);
      expect(dar.alerteRecolte(JEU, PLANCHES.filter((p) => p.id === libre), '2026-05-11', TOMATES)).toBeNull();
    }
    // Toutes les planches : la date la plus tardive (P1 corrigé, 15/05), les planches nommées par leur code.
    expect(dar.alerteRecolte(JEU, PLANCHES, '2026-05-11', TOMATES)).toBe('Récolte interdite sur P1, P3, P4 jusqu’au 15/05 (Bouillie bordelaise, traité le 11/05)');
    expect(dar.alerteRecolte(JEU, [], '2026-05-11', TOMATES)).not.toBeNull();
  });
});
