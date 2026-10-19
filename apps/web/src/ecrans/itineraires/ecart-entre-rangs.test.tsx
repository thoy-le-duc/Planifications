// @vitest-environment happy-dom
/**
 * Tests d'acceptation T43 — l'écart entre rangs, une vraie donnée de l'itinéraire, visible partout
 * où l'on voit la densité (docs/backlog/T43-ecart-entre-rangs.md, règles 2 et 3). Même banc que
 * ./ecran.test.tsx (ferme des itinéraires : planches de 0,8 m), complété d'un itinéraire de la
 * bibliothèque qui porte un écart entre rangs, reçu comme par la synchro.
 *
 * ── API attendue (apps/web/src/ecrans/itineraires/schema-rangs.ts, fonctions pures) ──────────
 *
 *   interface EcartsDensite {                // celle de T42, plus :
 *     readonly ecartSaisi: boolean;          // true : densite.ecartEntreRangsCm (la vraie donnée) ;
 *                                            // false : l'écart calculé de T42 (largeur / rangs), « ≈ »
 *   }
 *   ecartsDensite(densite, largeur)          // écart saisi s'il y en a un (même à 1 rang), sinon T42
 *   texteEcartsRangs(e)                      // saisi : « 3 rangs, 30 cm entre rangs (planche de 80 cm) » ;
 *                                            // sinon inchangé (« ≈ 27 cm ») ; 1 rang saisi :
 *                                            // « 1 rang, 120 cm entre planches (planche de 80 cm) » (T48)
 *   texteAvertissementEcart(e): string | null
 *     Écart saisi, 2 rangs ou plus, et (rangs − 1) × écart > largeur de planche (les rangs du bord
 *     sortiraient de la planche ; la marge raisonnable de la règle 1 est d'un écart) : un texte
 *     qui le dit ; sinon null. Jamais bloquant.
 *   texteDensite(densite, largeur): string | null    // résumé de la liste
 *     écartement : « 3 rangs à 30 cm · 30 cm sur le rang », sans écart : « 3 rangs à ≈ 27 cm · … » ;
 *     1 rang : « 1 rang · 50 cm sur le rang » (avec écart : « 1 rang, 120 cm entre planches · … » (T48)) ;
 *     mètre linéaire : « 4 rangs à 15 cm · 50 graines/m » ; volée : « à la volée · 2 g/m² » ;
 *     null si illisible. Centimètres comme T42 (virgule, « ≈ » arrondi).
 *   EntreeSchemaRangs gagne `ecartEntreRangsCm?: number | null` : donné (2 rangs ou plus) et les
 *     rangs tenant sur la planche, les rangs du schéma sont espacés de cette valeur, centrés ;
 *     sinon répartis comme en T35a.
 *
 * ── Écran ────────────────────────────────────────────────────────────────────────────────────
 *
 * - Liste : le résumé de chaque itinéraire contient texteDensite (planche de la ferme).
 * - Formulaire (lecture, modification, création, copie) : à l'écartement et au mètre linéaire, un
 *   champ « Écart entre rangs (cm) » (inputmode decimal, gros, au doigt), vide quand la densité
 *   n'en a pas ; désactivé en lecture seule ; data-testid="ecart-rangs" suit la saisie ; absent à
 *   la volée. Écriture : vide → clé `ecartEntreRangsCm` ABSENTE ; nombre (virgule permise) de 5 à
 *   200 → écrit ; autre → pas enregistrable. data-testid="ecart-avertissement" quand
 *   texteAvertissementEcart n'est pas null ; on enregistre quand même.
 * - « Adapter pour ma ferme » recopie la valeur.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ESPECE, ITINERAIRE, NOMS_ITINERAIRES } from './test/ferme-itineraires.ts';
import { elementItineraire, enregistrer, formulaireOuvert, harnais, ouvrirFormulaire } from './test/harnais.ts';
import { attendre, bouton, champ, desactive, itineraire, itineraireValide, itinerairesDeLaFerme, liste, parametresDe, radio, remplir, texte, toucher, type Ligne } from './test/outils.ts';

interface EcartsDensite {
  readonly rangs: number;
  readonly largeurPlancheCm: number;
  readonly ecartEntreRangsCm: number | null;
  readonly ecartEquivalentCm: number | null;
  readonly ecartSaisi: boolean;
}

interface ModuleEcarts {
  ecartsDensite(densite: unknown, largeurPlancheCm: number | null): EcartsDensite | null;
  texteEcartsRangs(e: EcartsDensite): string;
  texteAvertissementEcart(e: EcartsDensite): string | null;
  texteDensite(densite: unknown, largeurPlancheCm: number | null): string | null;
  geometrieSchemaRangs(e: {
    rangs: number;
    ecartementCm: number;
    disposition: 'alignee' | 'quinconce';
    largeurPlancheCm: number | null;
    ecartEntreRangsCm?: number | null;
  }): { largeurCm: number; rangs: readonly number[] };
}

const CHEMIN = './schema-rangs.ts';
const charger = async (): Promise<ModuleEcarts> => (await import(/* @vite-ignore */ CHEMIN)) as ModuleEcarts;

const PLANCHE = 80;

describe('T43 : écart entre rangs (fonctions pures)', () => {
  it('écart saisi : la vraie donnée, sans « ≈ »', async () => {
    const m = await charger();
    const e = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: 30 }, PLANCHE);
    expect(e).toEqual({ rangs: 3, largeurPlancheCm: 80, ecartEntreRangsCm: 30, ecartEquivalentCm: null, ecartSaisi: true });
    if (e === null) return;
    expect(m.texteEcartsRangs(e)).toBe('3 rangs, 30 cm entre rangs (planche de 80 cm)');
    expect(m.texteAvertissementEcart(e)).toBeNull();
  });

  it('sans écart saisi : l’écart calculé de T42, marqué « ≈ »', async () => {
    const m = await charger();
    const e = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 }, PLANCHE);
    expect(e?.ecartSaisi).toBe(false);
    expect(e?.ecartEntreRangsCm).toBeCloseTo(80 / 3, 6);
    if (e === null) return;
    expect(m.texteEcartsRangs(e)).toBe('3 rangs, ≈ 27 cm entre rangs (planche de 80 cm)');
    expect(m.texteAvertissementEcart(e)).toBeNull();
  });

  it('au mètre linéaire et à 1 rang ; décimales à la française', async () => {
    const m = await charger();
    const ml = m.ecartsDensite({ facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50, ecartEntreRangsCm: 17.5 }, null);
    expect(ml).toMatchObject({ rangs: 4, largeurPlancheCm: 75, ecartEntreRangsCm: 17.5, ecartEquivalentCm: 2, ecartSaisi: true });
    if (ml !== null) expect(m.texteEcartsRangs(ml)).toBe('4 rangs, 17,5 cm entre rangs (planche de 75 cm)');
    const un = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50, ecartEntreRangsCm: 120 }, PLANCHE);
    expect(un).toMatchObject({ rangs: 1, ecartEntreRangsCm: 120, ecartSaisi: true });
    if (un === null) return;
    expect(m.texteEcartsRangs(un)).toBe('1 rang, 120 cm entre planches (planche de 80 cm)');
    expect(m.texteAvertissementEcart(un), '1 rang : rien ne dépasse').toBeNull();
  });

  it('avertissement quand les rangs ne tiennent pas sur la planche ; jamais sans écart saisi', async () => {
    const m = await charger();
    const tient = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: 40 }, PLANCHE);
    if (tient === null) throw new Error('illisible');
    expect(m.texteAvertissementEcart(tient), '2 × 40 = 80 cm : tient sur 80 cm').toBeNull();
    const deborde = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 30, ecartEntreRangsCm: 30 }, PLANCHE);
    if (deborde === null) throw new Error('illisible');
    expect(m.texteAvertissementEcart(deborde)).toMatch(/planche/);
    const calcule = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 12, ecartementSurRangCm: 30 }, PLANCHE);
    if (calcule === null) throw new Error('illisible');
    expect(m.texteAvertissementEcart(calcule)).toBeNull();
  });

  it('résumé de la densité pour la liste', async () => {
    const m = await charger();
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: 30 }, PLANCHE)).toBe('3 rangs à 30 cm · 30 cm sur le rang');
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 }, PLANCHE)).toBe('3 rangs à ≈ 27 cm · 30 cm sur le rang');
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 2, ecartEntreRangsCm: 15 }, null)).toBe('4 rangs à 15 cm · 2 cm sur le rang');
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50 }, PLANCHE)).toBe('1 rang · 50 cm sur le rang');
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50, ecartEntreRangsCm: 120 }, PLANCHE)).toBe('1 rang, 120 cm entre planches · 50 cm sur le rang');
    expect(m.texteDensite({ facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50, ecartEntreRangsCm: 15 }, PLANCHE)).toBe('4 rangs à 15 cm · 50 graines/m');
    expect(m.texteDensite({ facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50 }, PLANCHE)).toBe('4 rangs à ≈ 20 cm · 50 graines/m');
    expect(m.texteDensite({ facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2.5 }, PLANCHE)).toBe('à la volée · 2,5 g/m²');
    expect(m.texteDensite(null, PLANCHE)).toBeNull();
    expect(m.texteDensite({ facon: 'ecartement', rangsParPlanche: 0, ecartementSurRangCm: 30 }, PLANCHE)).toBeNull();
  });

  it('schéma : rangs espacés de l’écart saisi, centrés ; trop large pour la planche : répartis comme en T35a', async () => {
    const m = await charger();
    const g = m.geometrieSchemaRangs({ rangs: 3, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: PLANCHE, ecartEntreRangsCm: 25 });
    expect(g.rangs).toHaveLength(3);
    expect((g.rangs[1] ?? 0) - (g.rangs[0] ?? 0)).toBeCloseTo(25, 6);
    expect((g.rangs[2] ?? 0) - (g.rangs[1] ?? 0)).toBeCloseTo(25, 6);
    expect((g.rangs[0] ?? 0) + (g.rangs[2] ?? 0), 'centrés').toBeCloseTo(PLANCHE, 6);
    const sans = m.geometrieSchemaRangs({ rangs: 3, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: PLANCHE });
    const trop = m.geometrieSchemaRangs({ rangs: 3, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: PLANCHE, ecartEntreRangsCm: 60 });
    expect(trop.rangs).toEqual(sans.rangs);
  });
});

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

const h = harnais();
const b = () => h.banc();

/** Itinéraire de la bibliothèque (ferme_id nul) qui porte un écart entre rangs. */
const LAITUE_T43 = '0192f0c1-4343-7000-8000-000000000001';
const NOM_LAITUE = 'Laitue batavia, rangs à 30 cm';
const PARAMETRES_LAITUE = {
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
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, disposition: 'quinconce', ecartEntreRangsCm: 30 },
} as const;

beforeEach(() => {
  b().base.recevoir(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, ?, NULL, ?, 'plant_maison', ?, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z', NULL)`,
    [LAITUE_T43, ESPECE.batavia, NOM_LAITUE, JSON.stringify(PARAMETRES_LAITUE)],
  );
});

const CHAMP_ECART = 'Écart entre rangs (cm)';
const MODIFIER_CHOU = `Modifier ${NOMS_ITINERAIRES.chouAutomne}`;
const ecartRangs = (f: ParentNode): string => texte(f.querySelector('[data-testid="ecart-rangs"]'));
const avertissement = (f: ParentNode): Element | null => f.querySelector('[data-testid="ecart-avertissement"]');

/** y des rangs dessinés (cy du premier plant de chaque rang). */
function yRangs(f: ParentNode): number[] {
  const s = f.querySelector('svg[data-testid="schema-rangs"]');
  if (s === null) throw new Error('schéma absent');
  const ys = new Map<string, number>();
  for (const c of s.querySelectorAll<SVGCircleElement>('circle[data-testid="plant-schema"]')) {
    const r = c.getAttribute('data-rang') ?? '';
    if (!ys.has(r)) ys.set(r, Number(c.getAttribute('cy')));
  }
  return [...ys.entries()].sort(([a], [c]) => Number(a) - Number(c)).map(([, y]) => y);
}

describe('T43 : la liste montre l’écart entre rangs', () => {
  it('résumé : la valeur saisie, ou « ≈ » l’écart calculé sur la planche de la ferme', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(LAITUE_T43) !== null, 'itinéraire T43 de la bibliothèque affiché');
    expect(texte(elementItineraire(LAITUE_T43))).toContain('3 rangs à 30 cm · 30 cm sur le rang');
    expect(texte(elementItineraire(ITINERAIRE.chouAutomne))).toContain('2 rangs à ≈ 40 cm · 40 cm sur le rang');
    expect(texte(elementItineraire(ITINERAIRE.batavia))).toContain('3 rangs à ≈ 27 cm · 30 cm sur le rang');
  });
});

describe('T43 : la lecture montre l’écart entre rangs', () => {
  it('bibliothèque avec écart : champ rempli et désactivé, texte sans « ≈ », schéma espacé de 30 cm', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(LAITUE_T43) !== null, 'itinéraire T43 affiché');
    const f = await ouvrirFormulaire(LAITUE_T43, `Voir ${NOM_LAITUE}`);
    const c = champ(CHAMP_ECART, f);
    expect(c.value).toBe('30');
    expect(c.disabled, 'lecture seule').toBe(true);
    expect(c.getAttribute('inputmode')).toBe('decimal');
    expect(ecartRangs(f)).toBe('3 rangs, 30 cm entre rangs (planche de 80 cm)');
    const y = yRangs(f);
    expect((y[1] ?? 0) - (y[0] ?? 0)).toBeCloseTo(30, 3);
    expect((y[2] ?? 0) - (y[1] ?? 0)).toBeCloseTo(30, 3);
  });

  it('bibliothèque sans écart (Batavia) : champ vide, l’écart calculé marqué « ≈ »', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, `Voir ${NOMS_ITINERAIRES.batavia}`);
    expect(champ(CHAMP_ECART, f).value).toBe('');
    expect(ecartRangs(f)).toBe('3 rangs, ≈ 27 cm entre rangs (planche de 80 cm)');
  });
});

describe('T43 : saisie et enregistrement dans le formulaire', () => {
  it('Chou d’automne : saisir 35 cm, enregistrer, relire, puis vider retire la clé', async () => {
    await h.ouvrir();
    const avant = parametresDe(itineraire(b(), ITINERAIRE.chouAutomne));
    let f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    expect(champ(CHAMP_ECART, f).value).toBe('');
    expect(ecartRangs(f)).toBe('2 rangs, ≈ 40 cm entre rangs (planche de 80 cm)');
    await remplir(champ(CHAMP_ECART, f), '35');
    expect(ecartRangs(f), 'mis à jour à la frappe').toBe('2 rangs, 35 cm entre rangs (planche de 80 cm)');
    const y = yRangs(f);
    expect((y[1] ?? 0) - (y[0] ?? 0), 'le schéma suit la saisie').toBeCloseTo(35, 3);
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    let l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l)).toEqual({ ...avant, densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 40, ecartEntreRangsCm: 35 } });
    await attendre(() => texte(elementItineraire(ITINERAIRE.chouAutomne)).includes('2 rangs à 35 cm'), 'la liste montre la nouvelle valeur');

    f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    expect(champ(CHAMP_ECART, f).value, 'relu').toBe('35');
    await remplir(champ(CHAMP_ECART, f), '');
    expect(ecartRangs(f)).toBe('2 rangs, ≈ 40 cm entre rangs (planche de 80 cm)');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l)).toEqual(avant);
    expect(parametresDe(l).densite, 'vide : pas de clé ecartEntreRangsCm').not.toHaveProperty('ecartEntreRangsCm');
  });

  it('virgule acceptée (27,5) ; hors de 5 à 200 cm : pas enregistrable', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    for (const faux of ['3', '250', 'abc']) {
      await remplir(champ(CHAMP_ECART, f), faux);
      expect(desactive(bouton('Enregistrer', f)), `« ${faux} » : pas enregistrable`).toBe(true);
      expect(texte(f), `« ${faux} » : on dit pourquoi`).toMatch(/[ÉE]cart entre rangs/);
    }
    await remplir(champ(CHAMP_ECART, f), '27,5');
    expect(desactive(bouton('Enregistrer', f))).toBe(false);
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l).densite).toEqual({ facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 40, ecartEntreRangsCm: 27.5 });
  });

  it('rangs trop larges pour la planche : avertissement, on enregistre quand même', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    await remplir(champ('Rangs par planche', f), '4');
    await remplir(champ(CHAMP_ECART, f), '30');
    expect(avertissement(f), '3 × 30 = 90 cm > 80 cm').not.toBeNull();
    expect(desactive(bouton('Enregistrer', f)), 'simple avertissement').toBe(false);
    await remplir(champ(CHAMP_ECART, f), '25');
    expect(avertissement(f), '3 × 25 = 75 cm : tient').toBeNull();
    await remplir(champ(CHAMP_ECART, f), '30');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l).densite).toMatchObject({ rangsParPlanche: 4, ecartEntreRangsCm: 30 });
  });

  it('semis direct au mètre linéaire : champ présent, valeur gardée ; à la volée : champ absent, clé retirée', async () => {
    await h.ouvrir();
    let f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    await toucher(radio('Semis direct', f));
    await remplir(liste('Façon', f), 'metre_lineaire');
    await remplir(champ('Rangs par planche', f), '4');
    await remplir(champ('Graines par mètre', f), '50');
    await remplir(champ(CHAMP_ECART, f), '15');
    expect(ecartRangs(f)).toBe('4 rangs, 15 cm entre rangs (planche de 80 cm)');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    let l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l).densite).toEqual({ facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50, ecartEntreRangsCm: 15 });

    f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER_CHOU);
    expect(champ(CHAMP_ECART, f).value).toBe('15');
    await remplir(liste('Façon', f), 'volee');
    expect([...f.querySelectorAll('label')].map((x) => texte(x))).not.toContain(CHAMP_ECART);
    await remplir(champ('Largeur semée (cm)', f), '60');
    await remplir(champ('Dose (g/m²)', f), '2');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l).densite).toEqual({ facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2 });
  });
});

describe('T43 : « Adapter pour ma ferme » garde l’écart entre rangs', () => {
  it('la copie recopie la densité de la bibliothèque, écart entre rangs compris', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(LAITUE_T43) !== null, 'itinéraire T43 affiché');
    const avant = new Set(itinerairesDeLaFerme(b()).map((l) => String(l.id)));
    const f = await ouvrirFormulaire(LAITUE_T43, /^Adapter pour ma ferme/);
    expect(champ(CHAMP_ECART, f).value).toBe('30');
    expect(champ(CHAMP_ECART, f).disabled).toBe(false);
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const copies: Ligne[] = itinerairesDeLaFerme(b()).filter((l) => !avant.has(String(l.id)));
    expect(copies).toHaveLength(1);
    const c = copies[0];
    itineraireValide(b(), c);
    expect(parametresDe(c), 'paramètres de la bibliothèque recopiés tels quels').toEqual(PARAMETRES_LAITUE);
  });
});
