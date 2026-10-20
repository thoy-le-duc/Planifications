// @vitest-environment happy-dom
/**
 * Tests d'acceptation T51 — densité « en contenants » dans le formulaire de l'itinéraire
 * (docs/backlog/T51-hors-sol-pains.md, règles 2 et 5). Même banc que ./disposition.test.tsx.
 *
 * ── Contrat (en plus de ./test/contrat.ts, « Formulaire d'itinéraire ») ──────────────────────
 *
 * Liste « Façon » (carte Densité) dans TOUS les modes : en plant maison et plant acheté,
 * « À l'écartement » et « En contenants (hors-sol) » (valeur 'contenants') ; en semis direct,
 * les quatre façons. En contenants :
 *   - champ « Trous par pain » (clavier numérique), avec « Un trou de moins » / « Un trou de
 *     plus » pour régler au doigt ;
 *   - plant maison ou acheté : champ « Plants par trou » (1 proposé) ; semis direct : champ
 *     « Graines par trou » ;
 *   - ni rangs, ni écartement, ni écart entre rangs, ni schéma des rangs.
 * Écriture : `densite = { facon: 'contenants', trousParContenant, grainesParTrou? (semis direct),
 * plantsParTrou? (écrit seulement s'il n'est pas 1) }`, la ligne passe `validerItineraire` ;
 * `grainesParPoquet` nul en semis direct. Vide ou non entier : rien d'écrit, message qui nomme
 * le champ. Rouvert : les valeurs relues.
 */
import { describe, expect, it } from 'vitest';
import { ITINERAIRE, NOMS_ITINERAIRES } from './test/ferme-itineraires.ts';
import { enregistrer, formulaire, formulaireOuvert, harnais, ouvrirFormulaire } from './test/harnais.ts';
import { aChamp, attendre, bouton, champ, itineraire, itineraireValide, liste, parametresDe, radio, remplir, texte, toucher } from './test/outils.ts';

const h = harnais();
const b = () => h.banc();
const MODIFIER = `Modifier ${NOMS_ITINERAIRES.chouAutomne}`;

const options = (l: HTMLSelectElement): string[] => [...l.options].map((o) => o.value);

describe('T51 : densité en contenants (hors-sol)', () => {
  it('plant acheté : la façon se choisit entre écartement et contenants', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    expect(options(liste('Façon', f))).toEqual(['ecartement', 'contenants']);
    await toucher(radio('Semis direct', f));
    expect(options(liste('Façon', formulaire()))).toEqual(['ecartement', 'metre_lineaire', 'volee', 'contenants']);
  });

  it('en contenants : « Trous par pain » et « Plants par trou », plus de rangs ni de schéma', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await remplir(liste('Façon', f), 'contenants');
    expect(aChamp('Trous par pain', f)).toBe(true);
    expect(champ('Trous par pain', f).getAttribute('inputmode')).toBe('numeric');
    expect(champ('Plants par trou', f).value).toBe('1');
    expect(aChamp('Graines par trou', f)).toBe(false);
    for (const absent of ['Rangs par planche', 'Écartement sur le rang (cm)', 'Écart entre rangs (cm)']) expect(aChamp(absent, f), absent).toBe(false);
    expect(f.querySelector('svg[data-testid="schema-rangs"]')).toBeNull();
  });

  it('Gariguette : 12 trous par pain, 1 plant par trou → enregistré, validé par le cœur', async () => {
    await h.ouvrir();
    const avant = parametresDe(itineraire(b(), ITINERAIRE.chouAutomne));
    let f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await remplir(liste('Façon', f), 'contenants');
    await remplir(champ('Trous par pain', f), '12');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l)).toEqual({ ...avant, densite: { facon: 'contenants', trousParContenant: 12 } });

    f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    expect(liste('Façon', f).value).toBe('contenants');
    expect(champ('Trous par pain', f).value).toBe('12');
  });

  it('au doigt : « Un trou de moins » et « Un trou de plus » règlent les trous par pain', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await remplir(liste('Façon', f), 'contenants');
    await remplir(champ('Trous par pain', f), '12');
    await toucher(bouton('Un trou de moins', f));
    await toucher(bouton('Un trou de moins', f));
    expect(champ('Trous par pain', f).value).toBe('10');
    await toucher(bouton('Un trou de plus', f));
    expect(champ('Trous par pain', f).value).toBe('11');
  });

  it('2 plants par trou : écrits dans la densité', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await remplir(liste('Façon', f), 'contenants');
    await remplir(champ('Trous par pain', f), '10');
    await remplir(champ('Plants par trou', f), '2');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l).densite).toEqual({ facon: 'contenants', trousParContenant: 10, plantsParTrou: 2 });
  });

  it('semis direct de haricots dans les pains : 12 trous, 3 graines par trou', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await toucher(radio('Semis direct', f));
    await remplir(liste('Façon', formulaire()), 'contenants');
    expect(aChamp('Plants par trou', formulaire())).toBe(false);
    await remplir(champ('Trous par pain', formulaire()), '12');
    await remplir(champ('Graines par trou', formulaire()), '3');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    const p = parametresDe(l);
    expect(p.densite).toEqual({ facon: 'contenants', trousParContenant: 12, grainesParTrou: 3 });
    expect(p.grainesParPoquet).toBeNull();
  });

  it('trous par pain vide : rien d’écrit, le message nomme le champ', async () => {
    await h.ouvrir();
    const avant = itineraire(b(), ITINERAIRE.chouAutomne);
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER);
    await remplir(liste('Façon', f), 'contenants');
    await remplir(champ('Trous par pain', f), '');
    await enregistrer();
    expect(formulaireOuvert(), 'formulaire encore ouvert').toBeDefined();
    expect(texte(formulaire())).toMatch(/Trous par pain/);
    expect(itineraire(b(), ITINERAIRE.chouAutomne)).toEqual(avant);
  });
});
