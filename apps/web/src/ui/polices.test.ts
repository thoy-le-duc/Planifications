/**
 * Tests d'acceptation T16 — polices hébergées avec l'appli (docs/backlog/T16-design.md).
 *
 * Contrat :
 *   - fichiers woff2 sous apps/web/public/polices/ (servis à /polices/…, même origine), sous-ensemble
 *     latin (français compris : é è à ç œ ’ « » ·), nommés par famille :
 *       archivo*.woff2                 (titres ; largeur 112 %, graisses 600 à 800)
 *       atkinson-hyperlegible*.woff2   (texte ; 400 et 700)
 *       ibm-plex-mono*.woff2           (codes de planche ; 500 et 600)
 *     chacun ≤ 120 Kio, l'ensemble ≤ 300 Kio (sous-ensemble, pas les polices complètes) ;
 *   - la licence SIL OFL des polices les accompagne (fichier OFL* ou LICEN[CS]E* dans le dossier) ;
 *   - @font-face (dans une feuille de style servie par l'appli) avec `font-display: swap`,
 *     `src: url(/polices/….woff2) format('woff2')` : vérifié dans le navigateur par
 *     e2e/polices.e2e.ts (document.fonts), comme la mise en cache par le service worker ;
 *   - aucune référence à Google Fonts (fonts.googleapis.com, fonts.gstatic.com) dans l'appli.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE_WEB = join(import.meta.dirname, '..', '..');
const DOSSIER_POLICES = join(RACINE_WEB, 'public', 'polices');

const FAMILLES = ['archivo', 'atkinson-hyperlegible', 'ibm-plex-mono'] as const;
const MAX_FICHIER_KIO = 120;
const MAX_TOTAL_KIO = 300;

function woff2(): string[] {
  if (!existsSync(DOSSIER_POLICES)) return [];
  return readdirSync(DOSSIER_POLICES).filter((n) => n.endsWith('.woff2'));
}

describe('polices hébergées (public/polices/)', () => {
  it('un woff2 au moins par famille : Archivo, Atkinson Hyperlegible, IBM Plex Mono', () => {
    const fichiers = woff2();
    for (const famille of FAMILLES) {
      expect(
        fichiers.filter((n) => new RegExp(`^${famille}[-.a-z0-9]*\\.woff2$`).test(n)),
        `public/polices/${famille}*.woff2`,
      ).not.toHaveLength(0);
    }
  });

  it('de vrais woff2 (signature wOF2), en sous-ensemble : ≤ 120 Kio chacun, ≤ 300 Kio en tout', () => {
    const fichiers = woff2();
    expect(fichiers.length).toBeGreaterThan(0);
    let total = 0;
    for (const nom of fichiers) {
      const octets = readFileSync(join(DOSSIER_POLICES, nom));
      expect(octets.subarray(0, 4).toString('latin1'), `${nom} : signature`).toBe('wOF2');
      const kio = octets.length / 1024;
      expect(kio, `${nom} : ${kio.toFixed(1)} Kio`).toBeLessThanOrEqual(MAX_FICHIER_KIO);
      total += kio;
    }
    expect(total, `total ${total.toFixed(1)} Kio`).toBeLessThanOrEqual(MAX_TOTAL_KIO);
  });

  it('la licence (SIL OFL) accompagne les polices', () => {
    const presents = existsSync(DOSSIER_POLICES) ? readdirSync(DOSSIER_POLICES) : [];
    expect(presents.some((n) => /^(OFL|LICEN[CS]E)/i.test(n))).toBe(true);
  });
});

function fichiers(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    if (!/\.(tsx?|css|html|json|webmanifest)$/.test(nom) || /\.test\.tsx?$/.test(nom)) return [];
    return [chemin];
  });
}

describe('aucune police tierce', () => {
  it('ni fonts.googleapis.com ni fonts.gstatic.com dans index.html, src/ et public/', () => {
    const tous = [join(RACINE_WEB, 'index.html'), ...fichiers(join(RACINE_WEB, 'src')), ...fichiers(join(RACINE_WEB, 'public'))];
    const fautes = tous.filter((f) => /fonts\.(googleapis|gstatic)\.com/i.test(readFileSync(f, 'utf8'))).map((f) => relative(RACINE_WEB, f));
    expect(fautes).toEqual([]);
  });
});
