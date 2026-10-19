// @vitest-environment happy-dom
/**
 * Tests d'acceptation T48 — à un seul rang par planche, l'écart se lit « entre planches »
 * (entraxe), à deux rangs et plus « entre rangs » (docs/backlog/T48-libelle-un-rang.md, règle 1).
 * Même banc que ./ecart-entre-rangs.test.tsx.
 *
 * Attendu : « 1 rang, 120 cm entre planches (planche de 80 cm) » (texteEcartsRangs), « 1 rang,
 * 120 cm entre planches · 50 cm sur le rang » (texteDensite, donc la liste), même texte dans le
 * formulaire (data-testid="ecart-rangs") ; l'aide du champ (data-testid="aide-ecart-rangs") dit
 * qu'à 1 rang l'écart est la distance d'une planche à l'autre.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ESPECE, ITINERAIRE, NOMS_ITINERAIRES } from './test/ferme-itineraires.ts';
import { elementItineraire, harnais, ouvrirFormulaire } from './test/harnais.ts';
import { attendre, champ, remplir, texte } from './test/outils.ts';
import { ecartsDensite, texteDensite, texteEcartsRangs } from './schema-rangs.ts';

const PLANCHE = 80;

describe('T48 : textes purs', () => {
  it('1 rang : « entre planches » ; 2 rangs et plus : « entre rangs »', () => {
    const un = ecartsDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50, ecartEntreRangsCm: 120 }, PLANCHE);
    if (un === null) throw new Error('illisible');
    expect(texteEcartsRangs(un)).toBe('1 rang, 120 cm entre planches (planche de 80 cm)');
    const deux = ecartsDensite({ facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, ecartEntreRangsCm: 40 }, PLANCHE);
    if (deux === null) throw new Error('illisible');
    expect(texteEcartsRangs(deux)).toBe('2 rangs, 40 cm entre rangs (planche de 80 cm)');
  });

  it('résumé de la liste', () => {
    expect(texteDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50, ecartEntreRangsCm: 120 }, PLANCHE)).toBe('1 rang, 120 cm entre planches · 50 cm sur le rang');
    expect(texteDensite({ facon: 'metre_lineaire', rangsParPlanche: 1, grainesParMetre: 50, ecartEntreRangsCm: 120 }, PLANCHE)).toBe('1 rang, 120 cm entre planches · 50 graines/m');
    expect(texteDensite({ facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, ecartEntreRangsCm: 40 }, PLANCHE)).toBe('2 rangs à 40 cm · 50 cm sur le rang');
  });
});

const h = harnais();
const b = () => h.banc();

const UN_RANG = '0192f0c1-4848-7000-8000-000000000001';
const NOM = 'Courge, un rang par planche';
const PARAMETRES = {
  mode: 'plant_maison',
  periodeUsage: { semaineDebut: 14, semaineFin: 30 },
  typeAbri: 'plein_champ',
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  dureeAvantRecolteJours: 45,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: { par: 'plant', quantite: 0.4, unite: 'kg' },
  perenne: null,
  densite: { facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50, ecartEntreRangsCm: 120 },
} as const;

beforeEach(() => {
  b().base.recevoir(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, ?, NULL, ?, 'plant_maison', ?, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z', NULL)`,
    [UN_RANG, ESPECE.batavia, NOM, JSON.stringify(PARAMETRES)],
  );
});

const CHAMP_ECART = 'Écart entre rangs (cm)';
const ecartRangs = (f: ParentNode): string => texte(f.querySelector('[data-testid="ecart-rangs"]'));
const aideEcart = (f: ParentNode): string => texte(f.querySelector('[data-testid="aide-ecart-rangs"]'));

describe('T48 : écrans', () => {
  it('liste et lecture à 1 rang : « entre planches », aide du champ qui l’explique', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(UN_RANG) !== null, 'itinéraire affiché');
    expect(texte(elementItineraire(UN_RANG))).toContain('1 rang, 120 cm entre planches · 50 cm sur le rang');
    const f = await ouvrirFormulaire(UN_RANG, `Voir ${NOM}`);
    expect(ecartRangs(f)).toBe('1 rang, 120 cm entre planches (planche de 80 cm)');
    expect(aideEcart(f)).toMatch(/d’une planche à l’autre/);
  });

  it('formulaire : à 2 rangs « entre rangs » ; à 1 rang « entre planches » et l’aide l’explique', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, `Modifier ${NOMS_ITINERAIRES.chouAutomne}`);
    await remplir(champ(CHAMP_ECART, f), '35');
    expect(ecartRangs(f)).toBe('2 rangs, 35 cm entre rangs (planche de 80 cm)');
    expect(aideEcart(f)).not.toMatch(/d’une planche à l’autre/);
    await remplir(champ('Rangs par planche', f), '1');
    expect(ecartRangs(f)).toBe('1 rang, 35 cm entre planches (planche de 80 cm)');
    expect(aideEcart(f)).toMatch(/d’une planche à l’autre/);
  });
});
