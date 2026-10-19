// @vitest-environment happy-dom
/**
 * Tests d'acceptation T42 — l'écart entre rangs et l'écart équivalent sur le rang dans l'écran
 * Itinéraires (docs/backlog/T42-bibliotheque-travaux.md, règle 3). Même banc que ./ecran.test.tsx
 * (ferme des itinéraires : planches de 0,8 m).
 *
 * ── API attendue (apps/web/src/ecrans/itineraires/schema-rangs.ts, fonctions pures) ──────────
 *
 *   const LARGEUR_PLANCHE_DEFAUT_CM = 75      // largeur de planche quand la ferme n'en dit rien (T42b : une seule)
 *   interface EcartsDensite {
 *     readonly rangs: number;
 *     readonly largeurPlancheCm: number;       // celle reçue, sinon LARGEUR_PLANCHE_DEFAUT_CM
 *     readonly ecartEntreRangsCm: number | null;   // largeur / rangs (rangs au milieu de bandes égales) ; null à 1 rang
 *     readonly ecartEquivalentCm: number | null;   // au mètre linéaire : 100 / graines par mètre ; sinon null
 *   }
 *   function ecartsDensite(densite: unknown, largeurPlancheCm: number | null): EcartsDensite | null
 *     Densité à l'écartement ou au mètre linéaire, rangs entiers ≥ 1 (et graines par mètre > 0 au
 *     mètre linéaire) ; null sinon (volée, illisible).
 *   function texteEcartsRangs(e: EcartsDensite): string
 *     « 3 rangs, ≈ 25 cm entre rangs (planche de 75 cm) », « 1 rang (planche de 75 cm) ».
 *   function texteEcartEquivalent(e: EcartsDensite): string | null
 *     « ≈ 2 cm entre graines sur le rang » ; null hors mètre linéaire.
 *   Arrondi des cm affichés : à l'unité à partir de 10 cm, au dixième en dessous, virgule
 *   française, sans « ,0 » (« ≈ 27 cm », « ≈ 0,7 cm », « ≈ 2 cm »).
 *
 * ── Formulaire (lecture et modification) ────────────────────────────────────────────────────
 *
 * Dans la carte de la densité, pour l'écartement ET le mètre linéaire : un élément
 * data-testid="ecart-rangs" dont le texte est texteEcartsRangs ; au mètre linéaire, aussi
 * data-testid="ecart-equivalent" (texteEcartEquivalent). Mis à jour à chaque frappe ; absents
 * à la volée. Largeur de planche : celle des planches de la ferme (la plus fréquente parmi les
 * planches actives qui en ont une), sinon 75 cm. Rien de plus au démarrage de l'appli.
 */
import { describe, expect, it } from 'vitest';
import { ITINERAIRE, NOMS_ITINERAIRES } from './test/ferme-itineraires.ts';
import { harnais, ouvrirFormulaire } from './test/harnais.ts';
import { champ, liste, radio, remplir, texte, toucher } from './test/outils.ts';

interface EcartsDensite {
  readonly rangs: number;
  readonly largeurPlancheCm: number;
  readonly ecartEntreRangsCm: number | null;
  readonly ecartEquivalentCm: number | null;
  readonly ecartSaisi: boolean;
}

interface ModuleEcarts {
  readonly LARGEUR_PLANCHE_DEFAUT_CM: number;
  ecartsDensite(densite: unknown, largeurPlancheCm: number | null): EcartsDensite | null;
  texteEcartsRangs(e: EcartsDensite): string;
  texteEcartEquivalent(e: EcartsDensite): string | null;
}

const CHEMIN = './schema-rangs.ts';
const charger = async (): Promise<ModuleEcarts> => (await import(/* @vite-ignore */ CHEMIN)) as ModuleEcarts;

describe('T42 : écarts d’une densité (fonctions pures)', () => {
  it('planche de 75 cm par défaut ; écart entre rangs = largeur / rangs', async () => {
    const m = await charger();
    expect(m.LARGEUR_PLANCHE_DEFAUT_CM).toBe(75);
    const e = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 }, null);
    // T43 : `ecartSaisi` dit si l'écart vient de la densité (ecartEntreRangsCm) ou du calcul de T42.
    expect(e).toEqual({ rangs: 3, largeurPlancheCm: 75, ecartEntreRangsCm: 25, ecartEquivalentCm: null, ecartSaisi: false });
    if (e === null) return;
    expect(m.texteEcartsRangs(e)).toBe('3 rangs, ≈ 25 cm entre rangs (planche de 75 cm)');
    expect(m.texteEcartEquivalent(e)).toBeNull();
  });

  it('largeur de la ferme quand elle est connue ; arrondi à l’unité au-delà de 10 cm', async () => {
    const m = await charger();
    const e = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30, disposition: 'quinconce' }, 80);
    expect(e?.largeurPlancheCm).toBe(80);
    expect(e?.ecartEntreRangsCm).toBeCloseTo(80 / 3, 6);
    if (e === null) return;
    expect(m.texteEcartsRangs(e)).toBe('3 rangs, ≈ 27 cm entre rangs (planche de 80 cm)');
  });

  it('1 rang : pas d’écart entre rangs', async () => {
    const m = await charger();
    const e = m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50 }, null);
    expect(e?.ecartEntreRangsCm).toBeNull();
    if (e === null) return;
    expect(m.texteEcartsRangs(e)).toBe('1 rang (planche de 75 cm)');
  });

  it('au mètre linéaire : écart moyen équivalent entre graines sur le rang', async () => {
    const m = await charger();
    const carotte = m.ecartsDensite({ facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50 }, null);
    expect(carotte).toEqual({ rangs: 4, largeurPlancheCm: 75, ecartEntreRangsCm: 18.75, ecartEquivalentCm: 2, ecartSaisi: false });
    if (carotte === null) return;
    expect(m.texteEcartsRangs(carotte)).toBe('4 rangs, ≈ 19 cm entre rangs (planche de 75 cm)');
    expect(m.texteEcartEquivalent(carotte)).toBe('≈ 2 cm entre graines sur le rang');
    const roquette = m.ecartsDensite({ facon: 'metre_lineaire', rangsParPlanche: 5, grainesParMetre: 150 }, null);
    if (roquette === null) throw new Error('roquette illisible');
    expect(m.texteEcartEquivalent(roquette)).toBe('≈ 0,7 cm entre graines sur le rang');
    expect(m.texteEcartsRangs(roquette)).toBe('5 rangs, ≈ 15 cm entre rangs (planche de 75 cm)');
  });

  it('volée ou densité illisible : null', async () => {
    const m = await charger();
    expect(m.ecartsDensite({ facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2 }, null)).toBeNull();
    expect(m.ecartsDensite({ facon: 'ecartement', rangsParPlanche: 0, ecartementSurRangCm: 30 }, null)).toBeNull();
    expect(m.ecartsDensite({ facon: 'metre_lineaire', rangsParPlanche: 2, grainesParMetre: 0 }, null)).toBeNull();
    expect(m.ecartsDensite(null, null)).toBeNull();
    expect(m.ecartsDensite('ecartement', null)).toBeNull();
  });
});

const h = harnais();

const ecartRangs = (f: ParentNode): Element | null => f.querySelector('[data-testid="ecart-rangs"]');
const ecartEquivalent = (f: ParentNode): Element | null => f.querySelector('[data-testid="ecart-equivalent"]');

describe('T42 : écarts dans le formulaire de l’itinéraire', () => {
  it('bibliothèque (Batavia, 3 rangs) : écart entre rangs sur la planche de la ferme (0,8 m)', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, `Voir ${NOMS_ITINERAIRES.batavia}`);
    expect(texte(ecartRangs(f))).toBe('3 rangs, ≈ 27 cm entre rangs (planche de 80 cm)');
    expect(ecartEquivalent(f), 'à l’écartement : pas d’écart équivalent').toBeNull();
  });

  it('modification : l’écart suit la saisie des rangs', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, `Modifier ${NOMS_ITINERAIRES.chouAutomne}`);
    expect(texte(ecartRangs(f))).toBe('2 rangs, ≈ 40 cm entre rangs (planche de 80 cm)');
    await remplir(champ('Rangs par planche', f), '4');
    expect(texte(ecartRangs(f))).toBe('4 rangs, ≈ 20 cm entre rangs (planche de 80 cm)');
    await remplir(champ('Rangs par planche', f), '1');
    expect(texte(ecartRangs(f))).toBe('1 rang (planche de 80 cm)');
  });

  it('semis direct au mètre linéaire : écart entre rangs et écart équivalent sur le rang ; à la volée : rien', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, `Modifier ${NOMS_ITINERAIRES.chouAutomne}`);
    await toucher(radio('Semis direct', f));
    await remplir(liste('Façon', f), 'metre_lineaire');
    await remplir(champ('Rangs par planche', f), '4');
    await remplir(champ('Graines par mètre', f), '50');
    expect(texte(ecartRangs(f))).toBe('4 rangs, ≈ 20 cm entre rangs (planche de 80 cm)');
    expect(texte(ecartEquivalent(f))).toBe('≈ 2 cm entre graines sur le rang');
    await remplir(champ('Graines par mètre', f), '150');
    expect(texte(ecartEquivalent(f))).toBe('≈ 0,7 cm entre graines sur le rang');
    await remplir(liste('Façon', f), 'volee');
    expect(ecartRangs(f)).toBeNull();
    expect(ecartEquivalent(f)).toBeNull();
  });
});
