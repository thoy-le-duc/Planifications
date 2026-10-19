/**
 * Tests d'acceptation T43, serveur sans base — le refus d'un écart entre rangs hors bornes se dit
 * en français, sans jargon (docs/backlog/T43-ecart-entre-rangs.md, règle 5). Le parcours complet
 * (POST /sync/upload, refus_synchro) est dans itineraire.integration.test.ts, « T43 ».
 *
 * Attendu : une erreur du cœur sur `parametres.densite.ecartEntreRangsCm` (hors bornes ou de
 * mauvaise forme) donne une précision qui nomme l'écart entre rangs et ses bornes, 5 et 200 cm.
 */
import { describe, expect, it } from 'vitest';
import { validerItineraire } from '@planif/core';
import { messageRefus, refusDuCoeur } from './messages.ts';
import { jargon } from './test/jargon.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const BATAVIA = {
  mode: 'plant_maison',
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

function messageDe(ecart: unknown): string {
  const r = validerItineraire({
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Batavia',
    mode: 'plant_maison',
    parametres: JSON.stringify({ ...BATAVIA, densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: ecart } }),
    supprime_le: null,
  });
  expect(r.ok, 'refusé par le cœur').toBe(false);
  if (r.ok) return '';
  expect(r.erreur.champ).toBe('parametres.densite.ecartEntreRangsCm');
  return messageRefus(refusDuCoeur(r.erreur, uuid(2)));
}

describe('T43 : message du refus d’un écart entre rangs', () => {
  it.each([[2], [250], ['30']])('%j : message en français qui nomme l’écart entre rangs et ses bornes, sans jargon', (ecart) => {
    const m = messageDe(ecart);
    expect(m).toMatch(/^Saisie non enregistrée, données invalides : /);
    expect(m).toMatch(/écart entre (les )?rangs/i);
    expect(m).toMatch(/(?<!\d)5(?!\d)/);
    expect(m).toMatch(/200/);
    expect(jargon(m)).toEqual([]);
  });
});
