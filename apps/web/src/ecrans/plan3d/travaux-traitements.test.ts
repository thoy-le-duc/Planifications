/**
 * Tests d'acceptation T55, règle 3 — les traitements du jour s'ajoutent aux travaux du jour
 * numérotés de la 3D (T37), après les cartes de l'écran Aujourd'hui (la carte n° i reste le
 * travail n° i). Ferme du jour avec travaux (../aujourdhui/test/ferme-du-jour.ts, aujourd'hui =
 * 2026-09-30, neuf cartes). Contrat : ./test/contrat-dar3d.ts (règle 3), ./test/contrat-travaux.ts.
 */
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { TacheJour } from '../aujourdhui/calculs.ts';
import type { Masques } from '../aujourdhui/cache.ts';
import { EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR, type FermeDuJour } from '../aujourdhui/test/ferme-du-jour.ts';
import type { VolumeScene } from './scene.ts';
import type { TravauxDuJour3d } from './test/contrat-travaux.ts';

const CHEMIN_TRAVAUX = './travaux.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date(`${AUJOURDHUI}T09:00:00Z`);
const BOUILLIE = '0192f0c1-5555-7000-8000-0000000000b1';
const DU_JOUR = '0192f0c1-5555-7000-8000-000000000300';

interface Lecture {
  readonly taches: readonly TacheJour[];
  readonly numero: number;
}
interface ModuleTravaux {
  lireTravaux(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant?: Date): Promise<Lecture>;
  tachesVisibles(lecture: Lecture, masques: Masques, toutVoir?: boolean): readonly unknown[];
  travauxDuJour3d(taches: readonly never[], scene: { readonly volumes: readonly unknown[] }): TravauxDuJour3d;
  lireTachesDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant?: Date): Promise<TacheJour[]>;
}

let m: ModuleTravaux;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_TRAVAUX)) as ModuleTravaux;
});

const volume = (id: string, code: string, x: number, placee: boolean): VolumeScene => ({ id, code, zoneId: 'zone', x, z: 2 * x, longueur: 12, largeur: 0.8, hauteur: 0.3, angle: 0, placee, couleur: '#888888', cleFamille: null, culture: null, occupationId: null });
const SCENE = {
  volumes: [volume(EMPLACEMENT.t2p01, 'T2-P01', 1, true), volume(EMPLACEMENT.t2p03, 'T2-P03', 2, true), volume(EMPLACEMENT.t2p07, 'T2-P07', 3, true), volume(EMPLACEMENT.pcp01, 'PC-P01', 4, false)],
};

let base: BaseMemoire;
let porte: PorteDonnees;
let ferme: FermeDuJour;

async function traiter(id: string, date: string, emplacements: readonly string[], annule?: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', ?, ?, ?, 'tap', ?, NULL, ?, NULL, '[]', ?, ?, ?, ?)`,
      [
        id,
        FERME,
        date,
        `${date}T${annule === undefined ? '07' : '08'}:00:00.000Z`,
        UTILISATEUR,
        SERIE.tomate,
        JSON.stringify(emplacements),
        annule === undefined ? null : 'annulation',
        annule ?? null,
        JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe: '2026-10-03' }),
        `${date}T07:00:00.000Z`,
      ],
    );
  });
}

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
      [BOUILLIE, FERME],
    );
  });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
});

const norme = (s: string): string => s.replace(/\s+/g, ' ').trim();
async function travaux(toutVoir = false): Promise<TravauxDuJour3d> {
  const lecture = await m.lireTravaux(porte, FERME, AUJOURDHUI, MAINTENANT);
  return m.travauxDuJour3d(m.tachesVisibles(lecture, new Map(), toutVoir) as readonly never[], SCENE);
}

describe('T55 règle 3 : le traitement du jour figure dans la liste numérotée', () => {
  it('témoin sans traitement : les neuf cartes de l’écran, numérotées 1 à 9', async () => {
    const j = await travaux();
    expect(j.travaux.map((t) => t.cle)).toEqual(ferme.attendu.taches);
  });

  it('traitement fait aujourd’hui sur T2-P07 : travail n° 10, « Traitement Bouillie bordelaise — T2-P07 », pastille sur T2-P07', async () => {
    await traiter(DU_JOUR, AUJOURDHUI, [EMPLACEMENT.t2p07]);
    const j = await travaux();
    expect(j.travaux.slice(0, ferme.attendu.taches.length).map((t) => t.cle)).toEqual(ferme.attendu.taches);
    expect(j.travaux).toHaveLength(ferme.attendu.taches.length + 1);
    const t = j.travaux.at(-1);
    expect(t?.rang).toBe(10);
    expect(t?.cle).toBe(`traitement:${DU_JOUR}`);
    expect(norme(t?.texte ?? '')).toBe('10. Traitement Bouillie bordelaise — T2-P07');
    expect(t?.planche).toBe(EMPLACEMENT.t2p07);
    expect(t?.enRetard).toBe(false);
    expect(j.pastilles.find((p) => p.planche === EMPLACEMENT.t2p07)?.numeros).toContain(10);
    // Écran déplié : toujours après toutes les cartes.
    expect((await travaux(true)).travaux.at(-1)?.cle).toBe(`traitement:${DU_JOUR}`);
  });

  it('plusieurs planches : codes comme les cartes (« T2-P01 · T2-P03 », « PC-P01 +2 ») ; la pastille va aux planches placées', async () => {
    await traiter(DU_JOUR, AUJOURDHUI, [EMPLACEMENT.t2p01, EMPLACEMENT.t2p03]);
    expect(norme((await travaux()).travaux.at(-1)?.texte ?? '')).toBe('10. Traitement Bouillie bordelaise — T2-P01 · T2-P03');
    await traiter('0192f0c1-5555-7000-8000-000000000303', AUJOURDHUI, [EMPLACEMENT.pcp01, EMPLACEMENT.t2p01, EMPLACEMENT.t2p03]);
    const j = await travaux();
    const t = j.travaux.at(-1);
    expect(norme(t?.texte ?? '')).toBe('11. Traitement Bouillie bordelaise — PC-P01 +2');
    // PC-P01 n'est pas placée : la caméra va à T2-P01, pas de pastille sur PC-P01.
    expect(t?.planche).toBe(EMPLACEMENT.t2p01);
    expect(j.pastilles.find((p) => p.planche === EMPLACEMENT.t2p03)?.numeros).toEqual(expect.arrayContaining([10, 11]));
    expect(j.pastilles.some((p) => p.planche === EMPLACEMENT.pcp01)).toBe(false);
  });

  it('un traitement d’un autre jour, ou annulé, n’est pas un travail du jour', async () => {
    await traiter('0192f0c1-5555-7000-8000-000000000301', '2026-09-29', [EMPLACEMENT.t2p07]);
    await traiter(DU_JOUR, AUJOURDHUI, [EMPLACEMENT.t2p07]);
    await traiter('0192f0c1-5555-7000-8000-000000000302', AUJOURDHUI, [EMPLACEMENT.t2p07], DU_JOUR);
    const j = await travaux();
    expect(j.travaux.map((t) => t.cle)).toEqual(ferme.attendu.taches);
  });

  it('lireTachesDuJour reste les seules cartes de l’écran Aujourd’hui', async () => {
    await traiter(DU_JOUR, AUJOURDHUI, [EMPLACEMENT.t2p07]);
    expect((await m.lireTachesDuJour(porte, FERME, AUJOURDHUI, MAINTENANT)).map((t) => t.cle)).toEqual(ferme.attendu.taches);
  });
});
