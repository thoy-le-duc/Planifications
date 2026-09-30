/**
 * Tests d'acceptation T22b côté serveur, sans base : la lecture d'un événement reçu du téléphone
 * (lireEvenement, qui délègue à validerSaisie du cœur) accepte l'occurrence visée d'une
 * intervention (`detail.occurrenceVisee`, écrite par « Fait » sur une tâche de travail), la garde
 * dans la ligne Postgres, et refuse une valeur invalide. Même format que ./evenement.test.ts.
 * Contrat : packages/core/src/planification/test/contrat-travaux.ts, section « T22b ».
 * Aller-retour avec Postgres : ./occurrence-visee.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { lireEvenement } from './evenement.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

/** Intervention telle que le téléphone l'envoie (ligne SQLite de PowerSync, sans `id`). */
function intervention(detail: Record<string, unknown>, autres: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ferme_id: uuid(2),
    type: 'intervention',
    date: '2026-09-30',
    horodatage: '2026-09-30T07:12:00.000Z',
    auteur_id: uuid(3),
    source: 'tap',
    serie_id: uuid(4),
    campagne_id: null,
    emplacement_ids: JSON.stringify([uuid(6)]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify(detail),
    ...autres,
  };
}

const DESHERBAGE = { categorie: 'entretien', type: 'désherbage', outil: null };

describe('T22b : le serveur accepte l’occurrence visée d’une intervention', () => {
  it('« Fait » sur la carte du 17 : lue, et gardée dans le détail de la ligne Postgres', () => {
    const r = lireEvenement(uuid(1), intervention({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' }));
    expect(r.ok ? null : r.raison, 'lue').toBeNull();
    if (!r.ok) return;
    expect(r.valeur.detail).toStrictEqual({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' });
    expect(r.valeur.date).toBe('2026-09-30');
  });

  it('en amendement (produit et quantité) aussi', () => {
    const compost = { categorie: 'amendement', type: 'compost', outil: null, produit: 'compost', quantite: { valeur: 3, unite: 'kg/m²' } };
    const r = lireEvenement(uuid(1), intervention({ ...compost, occurrenceVisee: '2026-09-27' }));
    expect(r.ok ? null : r.raison, 'lue').toBeNull();
  });

  it('son annulation, même détail : lue', () => {
    const r = lireEvenement(
      uuid(10),
      intervention({ ...DESHERBAGE, occurrenceVisee: '2026-09-17' }, { remplace_sorte: 'annulation', remplace_evenement_id: uuid(1) }),
    );
    expect(r.ok ? null : r.raison, 'lue').toBeNull();
  });

  it('null ou absente : lue, comme avant', () => {
    expect(lireEvenement(uuid(1), intervention({ ...DESHERBAGE, occurrenceVisee: null })).ok).toBe(true);
    expect(lireEvenement(uuid(1), intervention(DESHERBAGE)).ok).toBe(true);
  });

  it.each([
    ['date impossible', '2026-02-30'],
    ['format libre', '17 septembre'],
    ['hors bornes', '1999-12-31'],
    ['nombre', 20260917],
  ])('%s : refusée par le serveur', (_cas, occurrenceVisee) => {
    const r = lireEvenement(uuid(1), intervention({ ...DESHERBAGE, occurrenceVisee }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).not.toMatch(/clé inconnue/i);
  });
});
