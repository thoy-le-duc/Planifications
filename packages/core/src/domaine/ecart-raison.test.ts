/**
 * Tests d'acceptation T48, cœur — l'erreur de l'écart entre rangs porte une `raison` typée
 * ('hors_bornes' | 'non_numerique' | 'volee'), pour que les messages n'aient pas à lire le texte.
 */
import { describe, expect, it } from 'vitest';
import { validerItineraire } from '../index.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;
const COMMUNS = { dureeAvantRecolteJours: 49, fenetreRecolteJours: 14, margeSecurite: 10, rendementAttendu: null, perenne: null, periodeUsage: null, typeAbri: 'plein_champ' };

function raisonDe(densite: Record<string, unknown>) {
  const r = validerItineraire({
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Carotte',
    mode: 'semis_direct',
    parametres: JSON.stringify({ mode: 'semis_direct', ...COMMUNS, densite }),
    supprime_le: null,
  });
  if (r.ok) throw new Error('accepté');
  return r.erreur;
}

describe('T48 : raison de l’erreur d’écart entre rangs', () => {
  const ECART = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };
  it('hors bornes', () => {
    expect(raisonDe({ ...ECART, ecartEntreRangsCm: 250 })).toMatchObject({ code: 'hors_bornes', raison: 'hors_bornes' });
  });
  it('non numérique', () => {
    expect(raisonDe({ ...ECART, ecartEntreRangsCm: '30' })).toMatchObject({ code: 'champ_invalide', raison: 'non_numerique' });
  });
  it('à la volée', () => {
    expect(raisonDe({ facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2, ecartEntreRangsCm: 30 })).toMatchObject({ code: 'champ_invalide', raison: 'volee' });
  });
});
