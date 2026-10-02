/**
 * Tests d'acceptation T18 — jetons sombres (docs/backlog/T18-mode-sombre.md).
 *
 * ── API attendue (apps/web/src/ui/jetons.ts, même source unique que le thème clair) ─────────
 *
 * COULEURS_SOMBRES : Readonly<Record<CleCouleur, string>>, valeurs '#RRGGBB', EXACTEMENT les
 *   mêmes clés que COULEURS (le thème clair, inchangé). Toute paire de PAIRES_CONTRASTE (texte /
 *   fond, avec son usage) atteint son seuil dans le thème sombre comme dans le clair : 4,5:1 pour
 *   le texte, 3:1 pour les grands textes et les contours.
 *
 * variablesCss() : renvoie, en plus de la règle `:root{…}` d'aujourd'hui (thème clair, inchangée),
 *   les deux surcharges sombres, qui ne redéfinissent que les `--couleur-<clé>` :
 *     @media (prefers-color-scheme: dark){:root:not([data-theme="clair"]){…}}
 *     :root[data-theme="sombre"]{…}
 *   placées APRÈS la règle `:root` (même spécificité plus haute ou ordre : la surcharge gagne).
 *   src/jetons.css est régénéré (`pnpm --filter @planif/web jetons`) : src/ui/jetons-css.test.ts
 *   reste vrai.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHEMIN_JETONS_CSS, jetonsCss } from '../../scripts/jetons-css-contenu.ts';

type UsageContraste = 'texte' | 'grand-texte' | 'contour';

interface PaireContraste {
  readonly texte: string;
  readonly fond: string;
  readonly usage: UsageContraste;
}

interface ModuleJetons {
  readonly COULEURS: Readonly<Record<string, string>>;
  readonly COULEURS_SOMBRES: Readonly<Record<string, string>>;
  readonly PAIRES_CONTRASTE: readonly PaireContraste[];
  readonly FAMILLES: Readonly<Record<string, { readonly bande: string; readonly texte: string }>>;
  /** Facultatif : bandes propres au thème sombre (même forme que FAMILLES) ; sinon FAMILLES sert aux deux thèmes. */
  readonly FAMILLES_SOMBRES?: Readonly<Record<string, { readonly bande: string; readonly texte: string }>>;
  variablesCss(): string;
}

const CHEMIN_MODULE = './jetons.ts';

let j: ModuleJetons;

beforeAll(async () => {
  j = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleJetons;
});

const SEUILS: Readonly<Record<UsageContraste, number>> = { texte: 4.5, 'grand-texte': 3, contour: 3 };

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`couleur « ${hex} » : '#RRGGBB' attendu`);
  const [r, v, b] = [m[1], m[2], m[3]].map((c) => {
    const s = parseInt(c ?? '0', 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (v ?? 0) + 0.0722 * (b ?? 0);
}

function ratio(a: string, b: string): number {
  const [claire, foncee] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((claire ?? 0) + 0.05) / ((foncee ?? 0) + 0.05);
}

function kebab(cle: string): string {
  return cle.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

describe('jetons sombres : mêmes clés que le thème clair', () => {
  it('COULEURS_SOMBRES a exactement les clés de COULEURS, en #RRGGBB', () => {
    expect(Object.keys(j.COULEURS_SOMBRES).sort()).toEqual(Object.keys(j.COULEURS).sort());
    for (const [cle, v] of Object.entries(j.COULEURS_SOMBRES)) expect(v, `COULEURS_SOMBRES.${cle}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('le thème sombre est bien sombre : fond et surface plus sombres que l’encre, fond plus sombre que le clair', () => {
    const s = j.COULEURS_SOMBRES;
    const [fond, surface, encre] = [s.fond, s.surface, s.encre].map((c) => luminance(c ?? '#000000'));
    expect(fond ?? 1, 'fond sombre').toBeLessThan(0.1);
    expect(surface ?? 1, 'surface sombre').toBeLessThan(0.15);
    expect(encre ?? 0, 'encre claire').toBeGreaterThan(0.5);
    expect(fond ?? 1).toBeLessThan(luminance(j.COULEURS.fond ?? '#FFFFFF'));
  });
});

describe('contraste AA du thème sombre (mêmes paires que le thème clair)', () => {
  it('chaque paire de PAIRES_CONTRASTE atteint son seuil dans le thème sombre', () => {
    expect(j.PAIRES_CONTRASTE.length).toBeGreaterThan(0);
    const echecs: string[] = [];
    for (const p of j.PAIRES_CONTRASTE) {
      const t = j.COULEURS_SOMBRES[p.texte];
      const f = j.COULEURS_SOMBRES[p.fond];
      if (t === undefined || f === undefined) {
        echecs.push(`${p.texte} / ${p.fond} : couleur absente de COULEURS_SOMBRES`);
        continue;
      }
      const r = ratio(t, f);
      if (r < SEUILS[p.usage]) echecs.push(`${p.texte} ${t} sur ${p.fond} ${f} (${p.usage}) : ${r.toFixed(2)}:1 < ${String(SEUILS[p.usage])}:1`);
    }
    expect(echecs).toEqual([]);
  });

  it('le thème clair garde ses valeurs (la paire encre sur fond y reste ≥ 4,5:1)', () => {
    expect(j.COULEURS.fond).toBe('#EEF1E8');
    expect(j.COULEURS.encre).toBe('#15201A');
    expect(ratio(j.COULEURS.encre ?? '', j.COULEURS.fond ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});

/** Contenu des accolades du premier bloc qui suit `entete` (sans accolade imbriquée). */
function bloc(css: string, entete: RegExp): string | null {
  const m = entete.exec(css);
  return m === null ? null : (m[1] ?? null);
}

const MEDIA_SOMBRE = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root:not\(\s*\[data-theme=["']clair["']\]\s*\)\s*\{([^}]*)\}\s*\}/;
const FORCE_SOMBRE = /:root\[data-theme=["']sombre["']\]\s*\{([^}]*)\}/;

/** Variables `--couleur-*` d'un bloc, en nom → valeur. */
function variables(contenu: string): Record<string, string> {
  return Object.fromEntries([...contenu.matchAll(/(--[\w-]+)\s*:\s*([^;}]+?)\s*(?:;|$)/g)].map((m) => [m[1] ?? '', (m[2] ?? '').toUpperCase()]));
}

function verifierSurcharge(css: string, entete: RegExp, nom: string, j: ModuleJetons): void {
  const contenu = bloc(css, entete);
  expect(contenu, `bloc ${nom} présent`).not.toBeNull();
  const v = variables(contenu ?? '');
  const attendu = Object.fromEntries(Object.entries(j.COULEURS_SOMBRES).map(([cle, val]) => [`--couleur-${kebab(cle)}`, val.toUpperCase()]));
  expect(v, `${nom} : une variable par couleur sombre, rien d’autre`).toEqual(attendu);
}

describe('CSS généré : surcharges sombres', () => {
  it('variablesCss() : thème clair d’abord, puis @media sombre (sauf data-theme="clair"), puis data-theme="sombre"', () => {
    const css = j.variablesCss();
    verifierSurcharge(css, MEDIA_SOMBRE, '@media (prefers-color-scheme: dark)', j);
    verifierSurcharge(css, FORCE_SOMBRE, ':root[data-theme="sombre"]', j);
    const iClair = css.search(/:root\s*\{/);
    expect(iClair, 'règle :root du thème clair').toBeGreaterThanOrEqual(0);
    expect(css.search(MEDIA_SOMBRE), 'surcharge @media après :root').toBeGreaterThan(iClair);
    expect(css.search(FORCE_SOMBRE), 'surcharge forcée après :root').toBeGreaterThan(iClair);
    // La règle :root du thème clair porte les couleurs claires, inchangées.
    const clair = variables(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '');
    for (const [cle, val] of Object.entries(j.COULEURS)) expect(clair[`--couleur-${kebab(cle)}`], `clair --couleur-${kebab(cle)}`).toBe(val.toUpperCase());
  });

  it('src/jetons.css (fichier servi) contient les deux surcharges avec toutes les variables', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', CHEMIN_JETONS_CSS), 'utf8');
    expect(css).toBe(jetonsCss());
    verifierSurcharge(css, MEDIA_SOMBRE, '@media (prefers-color-scheme: dark)', j);
    verifierSurcharge(css, FORCE_SOMBRE, ':root[data-theme="sombre"]', j);
  });
});

/** Paires utilisées par l'appli qui doivent figurer dans PAIRES_CONTRASTE (donc être vérifiées dans les deux thèmes). */
const PAIRES_A_DECLARER: readonly PaireContraste[] = [
  // Barre du compte à rebours (pousse) sur le fond du bandeau d'annulation (forêt). Le bandeau d'échec
  // remplace ce fond par conflit (pas de conflit posé sur forêt) : sa paire réelle est surface sur conflit.
  { texte: 'pousse', fond: 'foret', usage: 'contour' },
  // Bande de la démo : texte sur l'ombre.
  { texte: 'surEntete', fond: 'ombre', usage: 'texte' },
  { texte: 'surEnteteDoux', fond: 'ombre', usage: 'texte' },
  // Bande neutre « Autres » du plan : texte sur secondaire.
  { texte: 'surForet', fond: 'secondaire', usage: 'texte' },
  // Bandeau d'échec : texte sur conflit.
  { texte: 'surface', fond: 'conflit', usage: 'texte' },
];

describe('paires utilisées par les écrans (relecture T18)', () => {
  it('chaque paire est déclarée dans PAIRES_CONTRASTE (donc testée en clair et en sombre)', () => {
    for (const e of PAIRES_A_DECLARER) {
      const d = j.PAIRES_CONTRASTE.find((p) => p.texte === e.texte && p.fond === e.fond && p.usage === e.usage);
      expect(d, `paire ${e.texte} sur ${e.fond} (${e.usage})`).toBeDefined();
    }
  });

  it('chaque paire déclarée atteint son seuil dans le thème clair aussi', () => {
    const echecs: string[] = [];
    for (const p of j.PAIRES_CONTRASTE) {
      const r = ratio(j.COULEURS[p.texte] ?? '#000000', j.COULEURS[p.fond] ?? '#000000');
      if (r < SEUILS[p.usage]) echecs.push(`${p.texte} sur ${p.fond} (${p.usage}) : ${r.toFixed(2)}:1`);
    }
    expect(echecs).toEqual([]);
  });

  const racineWeb = join(import.meta.dirname, '..', '..');
  const lire = (chemin: string) => readFileSync(join(racineWeb, chemin), 'utf8');

  it('les barres de compte à rebours (Aujourd’hui, Planches, Itinéraires, saisies refusées) utilisent la couleur pousse, celle qui est testée', () => {
    for (const [chemin, classe] of [
      ['src/ecrans/aujourdhui/aujourdhui.css', 'auj-bandeau-temps'],
      ['src/ecrans/plan/plan.css', 'plan-bandeau-temps'],
      ['src/ecrans/itineraires/itineraires.css', 'itin-bandeau-temps'],
      ['src/ecrans/ferme/refus.css', 'refus-bandeau-temps'],
    ] as const) {
      const regle = new RegExp(`\\.${classe}\\s*\\{([^}]*)\\}`).exec(lire(chemin))?.[1] ?? '';
      expect(regle, `${chemin} .${classe}`).toMatch(/background\s*:\s*var\(--couleur-pousse\)/);
    }
  });

  it('les bandeaux d’échec (Planches, Itinéraires) utilisent la couleur conflit, celle qui est testée', () => {
    for (const [chemin, classe] of [
      ['src/ecrans/plan/plan.css', 'plan-bandeau-echec'],
      ['src/ecrans/itineraires/itineraires.css', 'itin-bandeau-echec'],
    ] as const) {
      const regle = new RegExp(`\\.${classe}\\s*\\{([^}]*)\\}`).exec(lire(chemin))?.[1] ?? '';
      expect(regle, `${chemin} .${classe}`).toMatch(/background\s*:\s*var\(--couleur-conflit\)/);
    }
  });
});

describe('bandes de familles en thème sombre (relecture T18)', () => {
  const bandes = () => j.FAMILLES_SOMBRES ?? j.FAMILLES;

  it('chaque bande se détache de la surface sombre (≥ 3:1), et son texte est lisible (≥ 4,5:1)', () => {
    const echecs: string[] = [];
    for (const [cle, f] of Object.entries(bandes())) {
      const r = ratio(f.bande, j.COULEURS_SOMBRES.surface ?? '#000000');
      if (r < 3) echecs.push(`bande ${cle} ${f.bande} sur surface sombre : ${r.toFixed(2)}:1 < 3:1`);
      const rt = ratio(f.texte, f.bande);
      if (rt < 4.5) echecs.push(`texte ${f.texte} sur bande ${cle} ${f.bande} : ${rt.toFixed(2)}:1 < 4,5:1`);
    }
    expect(echecs).toEqual([]);
  });

  it('la bordure de conflit se distingue de chaque bande (≥ 3:1), ou un liseré de surface la sépare (plan.css)', () => {
    const conflit = j.COULEURS_SOMBRES.conflit ?? '#000000';
    const faibles = Object.entries(bandes()).filter(([, f]) => ratio(conflit, f.bande) < 3).map(([cle]) => cle);
    if (faibles.length === 0) return;
    const regle = /\.barre-conflit\s*\{([^}]*)\}/.exec(readFileSync(join(import.meta.dirname, '..', 'ecrans', 'plan', 'plan.css'), 'utf8'))?.[1] ?? '';
    // Liseré : conflit trop proche de ces bandes → contour de surface autour de la bordure, vérifié ici dans la feuille de style.
    expect(regle, `conflit ${conflit} trop proche des bandes ${faibles.join(', ')} : liseré var(--couleur-surface) attendu`).toMatch(/(?:outline|box-shadow)[^;]*var\(--couleur-surface\)/);
    // Et le liseré lui-même doit se voir contre le conflit.
    expect(ratio(j.COULEURS_SOMBRES.surface ?? '#000000', conflit), 'liseré surface contre conflit').toBeGreaterThanOrEqual(3);
  });

  it('la bande neutre « Autres » (secondaire) n’est pas plus claire que la plus claire des familles', () => {
    const plusClaire = Math.max(...Object.values(bandes()).map((f) => luminance(f.bande)));
    expect(luminance(j.COULEURS_SOMBRES.secondaire ?? '#FFFFFF'), 'secondaire sombre ≤ bande de famille la plus claire').toBeLessThanOrEqual(plusClaire);
  });
});
