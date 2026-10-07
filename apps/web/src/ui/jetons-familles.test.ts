/**
 * Tests d'acceptation T27b — une couleur par famille de la bibliothèque commune (16) + « autre »,
 * en clair et en sombre (docs/backlog/T27b-vue-3d-filtres.md). Contrat des clés :
 * ecrans/plan3d/test/contrat-filtres.ts. `jetons.ts` reste la seule source des couleurs (T16).
 *
 * Seuils (ΔE CIE76, voir ./test/couleurs.ts), fixés ici :
 *   - 10 entre deux familles quelconques (17 couleurs à séparer : en dessous, deux teintes voisines
 *     se confondent sur un écran de bureau, et la légende-filtre ne suffit plus à compenser) ;
 *   - 20 entre une famille et le neutre de la planche vide (`COULEURS.trait`, `COULEURS_SOMBRES.trait`) :
 *     une culture ne doit jamais passer pour une planche vide (Q30).
 * Si un seuil est intenable, regrouper des familles proches (le dire dans la PR), pas le baisser.
 */
import { describe, expect, it } from 'vitest';
import { CLES_FAMILLES } from '../ecrans/plan3d/test/contrat-filtres.ts';
import { COULEURS, COULEURS_SOMBRES, FAMILLES as FAMILLES_JETONS, FAMILLES_SOMBRES as SOMBRES_JETONS, variablesCss } from './jetons.ts';
import { contraste, deltaE76 } from './test/couleurs.ts';

/** Les 17 clés (T27b) : le type de jetons.ts les aura après l'implémentation, le test n'en dépend pas. */
type Bandes = Readonly<Record<string, { readonly bande: string; readonly texte: string }>>;
const FAMILLES: Bandes = FAMILLES_JETONS;
const FAMILLES_SOMBRES: Bandes = SOMBRES_JETONS;

const ECART_ENTRE_FAMILLES = 10;
const ECART_AVEC_LE_NEUTRE = 20;
const CONTRASTE_TEXTE = 4.5;

const themes = [
  { nom: 'clair', familles: FAMILLES, neutre: COULEURS.trait },
  { nom: 'sombre', familles: FAMILLES_SOMBRES, neutre: COULEURS_SOMBRES.trait },
] as const;

describe('T27b : mesure ΔE CIE76 (témoin du test)', () => {
  it('noir/blanc = 100, identique = 0, symétrique', () => {
    expect(deltaE76('#000000', '#FFFFFF')).toBeCloseTo(100, 0);
    expect(deltaE76('#2670CC', '#2670CC')).toBe(0);
    expect(deltaE76('#C0392B', '#1BAF7A')).toBeCloseTo(deltaE76('#1BAF7A', '#C0392B'), 9);
  });
});

describe.each(themes)('T27b : couleurs des familles, thème $nom', ({ nom, familles, neutre }) => {
  it('exactement 17 clés : 16 familles de la bibliothèque commune + autre', () => {
    expect(Object.keys(familles).sort()).toEqual([...CLES_FAMILLES].sort());
    expect(CLES_FAMILLES).toHaveLength(17);
  });

  it('bandes et textes en #RRGGBB', () => {
    for (const cle of CLES_FAMILLES) {
      expect(familles[cle]?.bande, `${cle}.bande`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(familles[cle]?.texte, `${cle}.texte`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it(`toutes différentes deux à deux : écart ΔE d'au moins ${String(ECART_ENTRE_FAMILLES)}`, () => {
    for (const [i, a] of CLES_FAMILLES.entries()) {
      for (const b of CLES_FAMILLES.slice(i + 1)) {
        const ecart = deltaE76(familles[a]?.bande ?? '#000000', familles[b]?.bande ?? '#000000');
        expect(ecart, `${nom} : ${a} / ${b} = ΔE ${ecart.toFixed(1)}`).toBeGreaterThanOrEqual(ECART_ENTRE_FAMILLES);
      }
    }
  });

  it(`toutes loin du neutre de la planche vide : écart ΔE d'au moins ${String(ECART_AVEC_LE_NEUTRE)}`, () => {
    for (const cle of CLES_FAMILLES) {
      const ecart = deltaE76(familles[cle]?.bande ?? '#000000', neutre);
      expect(ecart, `${nom} : ${cle} / neutre ${neutre} = ΔE ${ecart.toFixed(1)}`).toBeGreaterThanOrEqual(ECART_AVEC_LE_NEUTRE);
    }
  });

  it('texte posé sur la bande lisible à 4,5:1', () => {
    for (const cle of CLES_FAMILLES) {
      const f = familles[cle];
      const r = contraste(f?.texte ?? '#000000', f?.bande ?? '#FFFFFF');
      expect(r, `${nom} : ${cle} ${f?.texte ?? ''} sur ${f?.bande ?? ''} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(CONTRASTE_TEXTE);
    }
  });
});

describe('T27b : les 17 familles sont déclarées en variables CSS (la 2D en profite)', () => {
  it('--famille-<clé> et --famille-<clé>-texte, en clair puis en sombre', () => {
    const css = variablesCss();
    const [clair = '', ...sombre] = css.split('@media');
    for (const cle of CLES_FAMILLES) {
      expect(clair, `--famille-${cle} (clair)`).toContain(`--famille-${cle}:${FAMILLES[cle]?.bande ?? ''};`);
      expect(clair, `--famille-${cle}-texte (clair)`).toContain(`--famille-${cle}-texte:${FAMILLES[cle]?.texte ?? ''};`);
      expect(sombre.join('@media'), `--famille-${cle} (sombre)`).toContain(`--famille-${cle}:${FAMILLES_SOMBRES[cle]?.bande ?? ''};`);
      expect(sombre.join('@media'), `--famille-${cle}-texte (sombre)`).toContain(`--famille-${cle}-texte:${FAMILLES_SOMBRES[cle]?.texte ?? ''};`);
    }
  });
});

describe('T27b : le plan 2D a une règle par famille', () => {
  it('plan.css : .famille-<clé> pose --bande et --bande-texte depuis les variables de la clé', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../ecrans/plan/plan.css', import.meta.url), 'utf8');
    for (const cle of CLES_FAMILLES) {
      const regle = new RegExp(`\\.famille-${cle}\\s*\\{([^}]*)\\}`).exec(css);
      expect(regle, `règle .famille-${cle}`).not.toBeNull();
      expect(regle?.[1], `.famille-${cle} : --bande`).toMatch(new RegExp(`--bande:\\s*var\\(--famille-${cle}\\)`));
      expect(regle?.[1], `.famille-${cle} : --bande-texte`).toMatch(new RegExp(`--bande-texte:\\s*var\\(--famille-${cle}-texte\\)`));
    }
  });
});
