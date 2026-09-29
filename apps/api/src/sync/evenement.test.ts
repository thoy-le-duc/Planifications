/**
 * Tests d'acceptation T10b côté serveur — evenement.ts n'a plus de règles propres : il appelle
 * `validerSaisie` de @planif/core (packages/core/src/saisies) et ne garde que la conversion en
 * ligne Postgres. L'appartenance des références à la ferme reste dans l'API (references.ts).
 *
 * Deux vérifications, sans base : le code source (import du cœur, plus de listes ni de limites
 * locales) et le comportement (une règle qui n'existe que dans le cœur s'applique au serveur).
 * Les tests d'upload de T10 (upload.integration.test.ts) passent sans modification.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lireEvenement } from './evenement.ts';

const SOURCE = readFileSync(new URL('./evenement.ts', import.meta.url), 'utf8');

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

function donnees(type: string, detail: Record<string, unknown>): Record<string, unknown> {
  return {
    ferme_id: uuid(2),
    type,
    date: '2026-10-01',
    horodatage: '2026-10-01T05:58:00.000Z',
    auteur_id: uuid(3),
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify(detail),
  };
}

describe('evenement.ts délègue les règles au cœur', () => {
  it('importe validerSaisie de @planif/core', () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*\bvaliderSaisie\b[^}]*\}\s*from\s*'@planif\/core'/);
  });

  it.each([
    ['limites de taille', /\bLIMITES\s*=/],
    ['clés des Detail*', /\bCLES_DETAIL\b|\bCLES_INTERVENTION\b/],
    ['bornes de dates', /\bDATE_MIN\b|\bDATE_MAX\b|\bINSTANT_MIN\b/],
    ["motif d'horodatage", /\bMOTIF_INSTANT\b/],
    ['règles du détail', /\berreurDetail\b|\bcleInconnue\b/],
    ['listes de valeurs de @planif/db', /\bUNITES_RECOLTE\b|\bETAPES_REALISEES\b|\bNATURES_OBSERVATION\b|\bCATEGORIES_INTERVENTION\b/],
  ])('plus de %s propres au serveur', (_quoi, motif) => {
    expect(SOURCE).not.toMatch(motif);
  });

  it('une saisie valide est toujours lue', () => {
    expect(lireEvenement(uuid(1), donnees('recolte', { quantite: 12.5, unite: 'kg', categorie: null })).ok).toBe(true);
  });

  it.each([
    ['récolte de 1e308 kg (plafond du cœur)', 'recolte', { quantite: 1e308, unite: 'kg', categorie: null }],
    ['irrigation de 1e308 minutes (plafond du cœur)', 'irrigation', { secteurIrrigationId: uuid(7), dureeMinutes: 1e308 }],
    ['gravité hors liste (règle du cœur)', 'observation', { nature: 'ravageur', gravite: 'enorme' }],
  ])('%s : refusée par le serveur', (_cas, type, detail) => {
    expect(lireEvenement(uuid(1), donnees(type, detail)).ok).toBe(false);
  });
});
