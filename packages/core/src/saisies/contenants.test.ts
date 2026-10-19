/**
 * Tests d'acceptation T51, côté cœur — la densité « en contenants » écrite par un téléphone
 * (docs/backlog/T51-hors-sol-pains.md, règle 2). Aucune base, aucun réseau.
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * `validerItineraire` (et donc l'instantané d'une série, `validerSerie`) accepte
 * `densite: { facon: 'contenants', trousParContenant, plantsParTrou?, grainesParTrou? }` :
 *   - trousParContenant : entier de 1 à BORNES_CONTENANTS.trousParContenantMax
 *     (champ `parametres.densite.trousParContenant`) ;
 *   - semis direct : grainesParTrou obligatoire, entier de 1 à grainesParTrouMax ; pas de
 *     plantsParTrou ;
 *   - plant maison, plant acheté : plantsParTrou facultatif (absent = 1), entier de 1 à
 *     plantsParTrouMax ; pas de grainesParTrou ;
 *   - toute autre clé (rangs, écartement, écart entre rangs…) : `cle_inconnue`.
 *
 * `verifierDensiteSurEmplacement(parametres, sorte)` : null si la densité se compte sur cette
 * sorte d'emplacement ; une densité en contenants hors d'une gouttière rend l'erreur
 * `{ code: 'incoherent', champ: 'emplacement_id', raison: 'contenants_hors_gouttiere' }`, avec
 * un message en français qui dit d'utiliser une gouttière. Les autres densités : null partout.
 */
import { describe, expect, it } from 'vitest';
import { BORNES_CONTENANTS, validerItineraire, verifierDensiteSurEmplacement, type ParametresItineraire } from '../index.ts';

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const COMMUNS = {
  periodeUsage: null,
  typeAbri: 'hors_sol',
  dureeAvantRecolteJours: 60,
  fenetreRecolteJours: 60,
  margeSecurite: 5,
  rendementAttendu: null,
  perenne: null,
};

const FRAISE_ACHETEE = { mode: 'plant_achete', ...COMMUNS, densite: { facon: 'contenants', trousParContenant: 12 } };
const HARICOT_SEME = { mode: 'semis_direct', ...COMMUNS, densite: { facon: 'contenants', trousParContenant: 12, grainesParTrou: 3 }, grainesParPoquet: null };
const FRAISE_MAISON = {
  mode: 'plant_maison',
  ...COMMUNS,
  densite: { facon: 'contenants', trousParContenant: 10, plantsParTrou: 1 },
  dureePepiniereJours: 30,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: null,
};

function ligne(parametres: Record<string, unknown>): Record<string, unknown> {
  return {
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Fraise hors-sol en gouttière',
    mode: parametres.mode,
    parametres: JSON.stringify(parametres),
    supprime_le: null,
  };
}

const avecDensite = (base: Record<string, unknown>, densite: Record<string, unknown>) => ligne({ ...base, densite });

describe('T51 : densité en contenants dans un itinéraire', () => {
  it.each([
    ['plant acheté, 12 trous par pain', FRAISE_ACHETEE],
    ['semis direct, 12 trous, 3 graines par trou', HARICOT_SEME],
    ['plant maison, 10 trous, 1 plant par trou', FRAISE_MAISON],
  ])('%s : accepté, densité gardée telle quelle', (_nom, p) => {
    const r = validerItineraire(ligne(p));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.valeur.parametres.densite).toEqual(p.densite);
  });

  it('trous par pain : entier de 1 au plafond', () => {
    for (const t of [0, -1, 2.5, '12', null]) {
      const r = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants', trousParContenant: t }));
      expect(r.ok, `trousParContenant ${JSON.stringify(t)}`).toBe(false);
      if (!r.ok) expect(r.erreur.champ).toBe('parametres.densite.trousParContenant');
    }
    const trop = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants', trousParContenant: BORNES_CONTENANTS.trousParContenantMax + 1 }));
    expect(trop.ok).toBe(false);
    if (!trop.ok) expect(trop.erreur.code).toBe('hors_bornes');
  });

  it('trous par pain manquant : champ_manquant', () => {
    const r = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.erreur.code, r.erreur.champ]).toEqual(['champ_manquant', 'parametres.densite.trousParContenant']);
  });

  it('semis direct : graines par trou obligatoires, entier de 1 au plafond', () => {
    const sans = validerItineraire(avecDensite(HARICOT_SEME, { facon: 'contenants', trousParContenant: 12 }));
    expect(sans.ok).toBe(false);
    if (!sans.ok) expect([sans.erreur.code, sans.erreur.champ]).toEqual(['champ_manquant', 'parametres.densite.grainesParTrou']);
    for (const g of [0, 1.5, BORNES_CONTENANTS.grainesParTrouMax + 1]) {
      const r = validerItineraire(avecDensite(HARICOT_SEME, { facon: 'contenants', trousParContenant: 12, grainesParTrou: g }));
      expect(r.ok, `grainesParTrou ${String(g)}`).toBe(false);
      if (!r.ok) expect(r.erreur.champ).toBe('parametres.densite.grainesParTrou');
    }
  });

  it('semis direct : pas de plants par trou ; plant : pas de graines par trou', () => {
    const a = validerItineraire(avecDensite(HARICOT_SEME, { facon: 'contenants', trousParContenant: 12, grainesParTrou: 3, plantsParTrou: 1 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect([a.erreur.code, a.erreur.champ]).toEqual(['incoherent', 'parametres.densite.plantsParTrou']);
    const b = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants', trousParContenant: 12, grainesParTrou: 3 }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect([b.erreur.code, b.erreur.champ]).toEqual(['incoherent', 'parametres.densite.grainesParTrou']);
  });

  it('plants par trou : entier de 1 au plafond', () => {
    for (const n of [0, 1.5, BORNES_CONTENANTS.plantsParTrouMax + 1]) {
      const r = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants', trousParContenant: 12, plantsParTrou: n }));
      expect(r.ok, `plantsParTrou ${String(n)}`).toBe(false);
      if (!r.ok) expect(r.erreur.champ).toBe('parametres.densite.plantsParTrou');
    }
  });

  it('une clé des rangs (écart entre rangs, écartement…) n’a pas de sens en contenants : cle_inconnue', () => {
    for (const cle of ['ecartEntreRangsCm', 'rangsParPlanche', 'ecartementSurRangCm']) {
      const r = validerItineraire(avecDensite(FRAISE_ACHETEE, { facon: 'contenants', trousParContenant: 12, [cle]: 30 }));
      expect(r.ok, cle).toBe(false);
      if (!r.ok) expect(r.erreur.code, cle).toBe('cle_inconnue');
    }
  });
});

describe('T51 : densité en contenants refusée sur une planche', () => {
  const p = (x: Record<string, unknown>) => x as unknown as ParametresItineraire;

  it('sur une gouttière : acceptée', () => {
    expect(verifierDensiteSurEmplacement(p(FRAISE_ACHETEE), 'gouttiere')).toBeNull();
    expect(verifierDensiteSurEmplacement(p(HARICOT_SEME), 'gouttiere')).toBeNull();
  });

  it.each(['planche', 'rang'] as const)('sur un %s : refusée, message clair en français', (sorte) => {
    const e = verifierDensiteSurEmplacement(p(FRAISE_ACHETEE), sorte);
    expect(e).not.toBeNull();
    expect(e?.code).toBe('incoherent');
    expect(e?.champ).toBe('emplacement_id');
    expect(e?.raison).toBe('contenants_hors_gouttiere');
    expect(e?.message).toMatch(/gouttière/);
    expect(e?.message).toMatch(/trous par pain|contenants/);
    expect(e?.message.length).toBeLessThanOrEqual(200);
  });

  it('les autres façons de compter restent possibles sur une planche', () => {
    const ecartement = p({ ...FRAISE_ACHETEE, densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 30 } });
    expect(verifierDensiteSurEmplacement(ecartement, 'planche')).toBeNull();
  });
});
