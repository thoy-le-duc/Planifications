// @vitest-environment happy-dom
/**
 * Tests d'acceptation T35a — rangs alignés ou en quinconce dans le formulaire de l'itinéraire, et
 * leur schéma mis à jour pendant la saisie (docs/backlog/T35a-schema-rangs.md, Q34). Même banc que
 * ./ecran.test.tsx (ferme des itinéraires, aujourd'hui = 2026-09-30). Géométrie, texte et temps du
 * schéma : ./schema-rangs.test.tsx.
 *
 * ── Contrat (en plus de ./test/contrat.ts, « Formulaire d'itinéraire ») ──────────────────────
 *
 * Densité « écartement » (plant maison, plant acheté, semis direct à l'écartement) :
 *   - sous « Rangs par planche » et « Écartement sur le rang (cm) », le schéma SchemaRangs
 *     (<svg data-testid="schema-rangs">, voir ./schema-rangs.test.tsx), dessiné dès que les deux
 *     champs sont lisibles, redessiné à chaque frappe ;
 *   - à partir de 2 rangs : un role="radiogroup" nommé « Disposition des rangs » avec deux
 *     radios larges (≥ 56 px, gants) « Alignés » et « En quinconce » (input type=radio ou
 *     role="radio" + aria-checked) ; « Alignés » coché quand la densité n'a pas de disposition ;
 *     désactivés en lecture seule (bibliothèque) ;
 *   - 1 rang : ni groupe ni radios (le schéma montre un seul rang) ;
 *   - densité au mètre linéaire ou à la volée : ni schéma ni choix.
 * Écriture : « En quinconce » → parametres.densite.disposition = 'quinconce' ; « Alignés » →
 *   clé `disposition` ABSENTE (alignée par défaut ; une ligne d'avant T35a enregistrée sans y
 *   toucher reste identique). Le reste de la densité inchangé.
 * Largeur de la planche du schéma : celle de la planche si l'écran la connaît, sinon 1,2 m
 *   (LARGEUR_PLANCHE_DEFAUT_CM) ; le choix est laissé au développeur, à dire dans la PR.
 */
import { describe, expect, it } from 'vitest';
import { ITINERAIRE, NOMS_ITINERAIRES } from './test/ferme-itineraires.ts';
import { enregistrer, formulaire, formulaireOuvert, harnais, ouvrirFormulaire } from './test/harnais.ts';
import { attendre, champ, coche, itineraire, itineraireValide, liste, nomAccessible, parametresDe, radio, remplir, texte, toucher } from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const MODIFIER = (id: keyof typeof ITINERAIRE) => `Modifier ${NOMS_ITINERAIRES[id]}`;

const svg = (dans: ParentNode = formulaire()): SVGSVGElement | null => dans.querySelector<SVGSVGElement>('svg[data-testid="schema-rangs"]');

function schemaOuEchec(dans: ParentNode = formulaire()): SVGSVGElement {
  const s = svg(dans);
  expect(s, 'schéma des rangs (svg data-testid="schema-rangs") dans le formulaire').not.toBeNull();
  if (s === null) throw new Error('schéma absent');
  return s;
}

const groupeDisposition = (dans: ParentNode = formulaire()): HTMLElement | undefined =>
  [...dans.querySelectorAll<HTMLElement>('[role="radiogroup"]')].find((g) => nomAccessible(g) === 'Disposition des rangs');

/** cx des plants du rang `r`, triés. */
const cx = (s: SVGSVGElement, r: number): number[] =>
  [...s.querySelectorAll<SVGCircleElement>(`circle[data-testid="plant-schema"][data-rang="${String(r)}"]`)].map((p) => Number(p.getAttribute('cx'))).sort((a, c) => a - c);

const modulo = (a: number, m: number): number => ((a % m) + m) % m;

const cote = (s: SVGSVGElement): string => texte(s.querySelector('[data-testid="cote-ecartement"]'));

describe('T35a : choix alignés / en quinconce dans le formulaire', () => {
  it('Chou d’automne (2 rangs, 40 cm, sans disposition) : « Alignés » coché, schéma de 2 rangs alignés', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    const g = groupeDisposition(f);
    expect(g, 'radiogroup « Disposition des rangs »').toBeDefined();
    if (g === undefined) return;
    expect(coche(radio('Alignés', g))).toBe(true);
    expect(coche(radio('En quinconce', g))).toBe(false);
    const s = schemaOuEchec(f);
    expect(s.getAttribute('aria-label')).toBe('2 rangs alignés, un plant tous les 40 cm');
    expect(cote(s)).toBe('40 cm');
    expect(cx(s, 2)).toStrictEqual(cx(s, 1));
  });

  it('1 rang : pas de choix de disposition, le schéma montre un seul rang', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Rangs par planche', f), '1');
    expect(groupeDisposition(f), 'aucun radiogroup « Disposition des rangs » à 1 rang').toBeUndefined();
    const radios = [...f.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]')].map(nomAccessible);
    expect(radios).not.toContain('Alignés');
    expect(radios).not.toContain('En quinconce');
    const s = schemaOuEchec(f);
    expect(s.querySelectorAll('circle[data-testid="plant-schema"][data-rang="2"]')).toHaveLength(0);
    expect(cx(s, 1).length).toBeGreaterThanOrEqual(3);
    expect(s.getAttribute('aria-label')).toBe('1 rang, un plant tous les 40 cm');
  });

  it('3 rangs à 30 cm en quinconce : rang 2 décalé d’un demi-écartement, cote « 30 cm », alternative texte', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Rangs par planche', f), '3');
    await remplir(champ('Écartement sur le rang (cm)', f), '30');
    const g = groupeDisposition(f);
    expect(g, 'radiogroup « Disposition des rangs » à 3 rangs').toBeDefined();
    if (g === undefined) return;
    await toucher(radio('En quinconce', g));
    expect(coche(radio('En quinconce', groupeDisposition(f) ?? f))).toBe(true);
    expect(coche(radio('Alignés', groupeDisposition(f) ?? f))).toBe(false);
    const s = schemaOuEchec(f);
    const r1 = cx(s, 1);
    const r2 = cx(s, 2);
    expect(r1.length).toBeGreaterThanOrEqual(3);
    expect(modulo((r2[0] ?? 0) - (r1[0] ?? 0), 30), 'rang 2 décalé de 15 cm').toBeCloseTo(15, 3);
    expect(cx(s, 3)).toStrictEqual(r1);
    expect(cote(s)).toBe('30 cm');
    expect(s.getAttribute('aria-label')).toBe('3 rangs en quinconce, un plant tous les 30 cm');
  });

  it('le schéma suit la saisie de l’écartement, frappe après frappe', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await toucher(radio('En quinconce', groupeDisposition(f) ?? f));
    for (const [saisi, attendu, cm] of [
      ['2', '2 cm', 2],
      ['25', '25 cm', 25],
      ['25,5', '25,5 cm', 25.5],
    ] as const) {
      await remplir(champ('Écartement sur le rang (cm)', f), saisi);
      const s = schemaOuEchec(f);
      expect(cote(s)).toBe(attendu);
      const r1 = cx(s, 1);
      expect((r1[1] ?? 0) - (r1[0] ?? 0)).toBeCloseTo(cm, 3);
      expect(modulo((cx(s, 2)[0] ?? 0) - (r1[0] ?? 0), cm)).toBeCloseTo(cm / 2, 3);
    }
  });

  it('densité à la volée (semis direct) : ni schéma ni choix de disposition', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await toucher(radio('Semis direct', f));
    await remplir(liste('Façon', f), 'volee');
    expect(svg(f)).toBeNull();
    expect(groupeDisposition(f)).toBeUndefined();
  });

  it('itinéraire de la bibliothèque (Batavia, 3 rangs) : schéma visible, choix désactivé', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, `Voir ${NOMS_ITINERAIRES.batavia}`);
    schemaOuEchec(f);
    const g = groupeDisposition(f);
    expect(g).toBeDefined();
    for (const nom of ['Alignés', 'En quinconce']) {
      const r = radio(nom, g ?? f);
      const inactif = (r instanceof HTMLInputElement || r instanceof HTMLButtonElement ? r.disabled : false) || r.getAttribute('aria-disabled') === 'true';
      expect(inactif, `« ${nom} » désactivé en lecture seule`).toBe(true);
    }
  });
});

describe('T35a : enregistrement de la disposition', () => {
  it('« En quinconce » : écrit dans la densité ; rouvert, le choix est gardé ; « Alignés » retire la clé', async () => {
    await h.ouvrir();
    const avant = parametresDe(itineraire(b(), ITINERAIRE.chouAutomne));
    let f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await toucher(radio('En quinconce', groupeDisposition(f) ?? f));
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    let l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l)).toEqual({ ...avant, densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 40, disposition: 'quinconce' } });

    f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    expect(coche(radio('En quinconce', groupeDisposition(f) ?? f)), 'quinconce relu').toBe(true);
    expect(schemaOuEchec(f).getAttribute('aria-label')).toBe('2 rangs en quinconce, un plant tous les 40 cm');

    await toucher(radio('Alignés', groupeDisposition(f) ?? f));
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(parametresDe(l)).toEqual(avant);
    expect(parametresDe(l).densite, 'alignés : pas de clé disposition').not.toHaveProperty('disposition');
  });
});
