/**
 * Tests d'acceptation T52 — règle de plus sur la saisie d'un traitement (validerSaisie, rejouée
 * par le serveur) : la date de récolte autorisée n'est jamais avant le jour du traitement.
 * Le reste (produit manquant, dose négative, date impossible) est déjà couvert par
 * ../saisies/saisies.test.ts (T10b).
 */
import { beforeAll, describe, expect, it } from 'vitest';

interface Resultat {
  readonly ok: boolean;
  readonly erreur?: { readonly code: string; readonly champ: string | null; readonly message: string };
}
let validerSaisie: (entree: unknown) => Resultat;

beforeAll(async () => {
  ({ validerSaisie } = (await import(/* @vite-ignore */ '../index.ts')) as { validerSaisie: typeof validerSaisie });
});

const uuid = (n: number): string => `0192f0c1-5253-7000-8000-${n.toString(16).padStart(12, '0')}`;

function ligne(date: string, recolteAutoriseeLe: string): Record<string, unknown> {
  return {
    id: uuid(1),
    ferme_id: uuid(2),
    type: 'traitement',
    date,
    horodatage: '2027-05-10T08:00:00.000Z',
    auteur_id: uuid(3),
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: JSON.stringify([uuid(4)]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ produitPhytoId: uuid(5), dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe }),
  };
}

describe('T52 : récolte autorisée au plus tôt le jour du traitement', () => {
  it('avant la date du traitement : refusé (incoherent, detail.recolteAutoriseeLe)', () => {
    const r = validerSaisie(ligne('2027-05-10', '2027-05-09'));
    expect(r.ok).toBe(false);
    expect(r.erreur?.code).toBe('incoherent');
    expect(r.erreur?.champ).toBe('detail.recolteAutoriseeLe');
  });

  it('le jour même (DAR 0) ou après : accepté', () => {
    expect(validerSaisie(ligne('2027-05-10', '2027-05-10')).ok).toBe(true);
    expect(validerSaisie(ligne('2027-05-10', '2027-05-13')).ok).toBe(true);
  });
});
