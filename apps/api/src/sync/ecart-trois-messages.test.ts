/**
 * Tests d'acceptation T48, serveur sans base — trois erreurs de l'écart entre rangs, trois
 * messages distincts (docs/backlog/T48-libelle-un-rang.md, règle 2) : hors bornes (5 à 200 cm),
 * valeur non numérique, écart donné pour un semis à la volée.
 */
import { describe, expect, it } from 'vitest';
import { validerItineraire } from '@planif/core';
import { messageRefus, refusDuCoeur } from './messages.ts';
import { jargon } from './test/jargon.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const COMMUN = { dureeAvantRecolteJours: 49, fenetreRecolteJours: 14, margeSecurite: 10, rendementAttendu: null, perenne: null, periodeUsage: null, typeAbri: 'plein_champ' };

function messageDe(densite: unknown): string {
  const r = validerItineraire({
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Carotte',
    mode: 'semis_direct',
    parametres: JSON.stringify({ mode: 'semis_direct', ...COMMUN, densite }),
    supprime_le: null,
  });
  expect(r.ok, 'refusé par le cœur').toBe(false);
  if (r.ok) return '';
  expect(r.erreur.champ).toBe('parametres.densite.ecartEntreRangsCm');
  return messageRefus(refusDuCoeur(r.erreur, uuid(2)));
}

describe('T48 : trois messages pour l’écart entre rangs', () => {
  const ECART = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };
  const horsBornes = messageDe({ ...ECART, ecartEntreRangsCm: 250 });
  const nonNumerique = messageDe({ ...ECART, ecartEntreRangsCm: '30' });
  const volee = messageDe({ facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2, ecartEntreRangsCm: 30 });

  it('hors bornes : dit 5 et 200', () => {
    expect(horsBornes).toMatch(/(?<!\d)5(?!\d)/);
    expect(horsBornes).toMatch(/200/);
  });

  it('non numérique : demande un nombre', () => {
    expect(nonNumerique).toMatch(/nombre/);
  });

  it('semis à la volée : dit qu’un écart ne va pas avec la volée', () => {
    expect(volee).toMatch(/volée/);
  });

  it('les trois sont différents, en français, sans jargon', () => {
    expect(new Set([horsBornes, nonNumerique, volee]).size).toBe(3);
    for (const m of [horsBornes, nonNumerique, volee]) expect(jargon(m)).toEqual([]);
  });
});
