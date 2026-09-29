/**
 * Tests d'acceptation T16 — jetons de design (docs/backlog/T16-design.md), repris des maquettes
 * validées (docs/maquettes/*.dc.html ; Ferme et Dicter sur https://claude.ai/artifact/CkYjAD2qX9mxw3FNLT9miP).
 *
 * ── API attendue (apps/web/src/ui/jetons.ts) ────────────────────────────────────────────────
 *
 * Une seule source : toutes les couleurs, polices, rayons, ombres et espacements de l'appli
 * sont ici. Le reste du code n'écrit aucune couleur en dur : il passe par les variables CSS
 * générées depuis ces jetons (`var(--couleur-foret)`…), en style en ligne React ou en feuille
 * de style (fichier servi par l'appli : la CSP interdit les <style> en ligne).
 *
 * COULEURS : Readonly<Record<CleCouleur, string>>, valeurs '#RRGGBB'. Clés exigées :
 *   fond         '#EEF1E8'  fond des écrans
 *   surface      '#FFFFFF'  cartes, barre de navigation, cases du code
 *   encre        '#15201A'  texte
 *   secondaire   '#4B5A50'  texte secondaire
 *   tertiaire    (maquettes : '#6B786F', 4,05:1 sur le fond ; le chef retient '#606D64', 4,75:1 ; valeur libre)  onglets inactifs, « ou », flèches
 *   trait        '#D6DDD0'  séparateurs, ombre des cartes
 *   foret        '#1F4D3A'  tout ce qui se touche, en-têtes
 *   foretClair   '#2C6450'  pastilles sur l'en-tête
 *   surForet     '#F4F7EF'  texte sur forêt
 *   surForetDoux '#B9D3C2'  texte secondaire sur forêt
 *   orange       '#E0701F'  ce qui presse (bande, pastille « en retard »)
 *   texteOrange  '#9A4A0F'  texte de ce qui presse
 *   surOrange    '#1B0F05'  texte sur orange
 *   (d'autres clés sont permises.)
 *
 * FAMILLES : Readonly<Record<'salades' | 'solanacees' | 'cruciferes' | 'racines', { bande: string; texte: string }>>
 *   bandes des cartes et du plan (maquette Plan ; salades foncée à '#2670CC' par le chef pour le contraste AA du texte blanc,
 *   4,92:1 au lieu de 4,42:1) : salades '#2670CC', solanacees '#C0392B',
 *   cruciferes '#1BAF7A', racines '#EDA100' ; `texte` = couleur du texte posé sur la bande.
 *
 * POLICES : { titre, texte, code } (valeurs CSS font-family) : titre commence par Archivo,
 *   texte par Atkinson Hyperlegible, code par IBM Plex Mono, chacune avec une famille générique
 *   de repli (sans-serif, monospace).
 * RAYONS : Readonly<Record<string, number>> en px, dont carte 16 et bouton 18 (maquettes).
 * ESPACEMENTS : Readonly<Record<string, number>> en px (au moins un).
 * OMBRES : Readonly<Record<string, string>> (valeurs CSS box-shadow), dont `basse` (bouton
 *   principal) et `carte`.
 *
 * PAIRES_CONTRASTE : readonly { texte: CleCouleur; fond: CleCouleur; usage: 'texte' | 'grand-texte' | 'contour' }[]
 *   Toutes les paires texte / fond utilisées par l'appli. Seuils WCAG 2 (AA, lisible au soleil) :
 *   'texte' ≥ 4,5:1 ; 'grand-texte' (≥ 24 px, ou ≥ 18,66 px gras) et 'contour' (bord d'un
 *   bouton, bande d'alerte) ≥ 3:1. Les paires des maquettes listées dans PAIRES_EXIGEES (plus
 *   bas) doivent y figurer, avec au moins cet usage (une paire 'texte' ne se déclare pas
 *   'grand-texte' pour passer).
 *
 * variablesCss(): string
 *   Règle `:root{…}` : pour chaque jeton, une variable. Noms : clé en kebab-case
 *   (foretClair → foret-clair) ; `--couleur-<clé>` ; `--famille-<clé>` (bande) et
 *   `--famille-<clé>-texte` ; `--police-<clé>` ; `--rayon-<clé>: <n>px` ;
 *   `--espace-<clé>: <n>px` ; `--ombre-<clé>`. C'est ce texte (et rien d'autre) qui définit les
 *   variables dans l'appli : fichier CSS généré et vérifié, ou posé au démarrage par le CSSOM
 *   (document.documentElement.style.setProperty, permis par la CSP) — au choix du développeur.
 *   L'e2e (e2e/habillage.e2e.ts) lit `--couleur-fond` sur :root dans l'appli servie.
 *
 * couleur(cle: CleCouleur): string → 'var(--couleur-<clé kebab>)'.
 *
 * Règle « une seule source », vérifiée dans les sources : aucune couleur en dur (#rgb, #rrggbb,
 * rgb(), hsl()) dans src/App.tsx, src/ui/** (sauf jetons.ts), src/connexion/**, src/ecrans/**
 * (fichiers .ts, .tsx, .css, hors tests) ; index.html porte `theme-color` = COULEURS.foret.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type UsageContraste = 'texte' | 'grand-texte' | 'contour';

interface PaireContraste {
  readonly texte: string;
  readonly fond: string;
  readonly usage: UsageContraste;
}

interface ModuleJetons {
  readonly COULEURS: Readonly<Record<string, string>>;
  readonly FAMILLES: Readonly<Record<string, { readonly bande: string; readonly texte: string }>>;
  readonly POLICES: Readonly<Record<string, string>>;
  readonly RAYONS: Readonly<Record<string, number>>;
  readonly ESPACEMENTS: Readonly<Record<string, number>>;
  readonly OMBRES: Readonly<Record<string, string>>;
  readonly PAIRES_CONTRASTE: readonly PaireContraste[];
  variablesCss(): string;
  couleur(cle: string): string;
}

/** Chemin tenu dans une variable : le typage ne dépend pas du module (écrit par le développeur). */
const CHEMIN_MODULE = './jetons.ts';

let j: ModuleJetons;

beforeAll(async () => {
  j = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleJetons;
});

const RACINE_WEB = join(import.meta.dirname, '..', '..');

/** Valeurs relevées dans les maquettes validées (styles en ligne). */
const COULEURS_MAQUETTES: Readonly<Record<string, string>> = {
  fond: '#EEF1E8',
  surface: '#FFFFFF',
  encre: '#15201A',
  secondaire: '#4B5A50',
  trait: '#D6DDD0',
  foret: '#1F4D3A',
  foretClair: '#2C6450',
  surForet: '#F4F7EF',
  surForetDoux: '#B9D3C2',
  orange: '#E0701F',
  texteOrange: '#9A4A0F',
  surOrange: '#1B0F05',
};

const BANDES_MAQUETTES: Readonly<Record<string, string>> = {
  salades: '#2670CC',
  solanacees: '#C0392B',
  cruciferes: '#1BAF7A',
  racines: '#EDA100',
};

/** Paires utilisées par les maquettes des écrans de T16 et les composants (texte, fond, usage minimal). */
const PAIRES_EXIGEES: readonly PaireContraste[] = [
  // Texte sur le fond des écrans et sur les cartes.
  { texte: 'encre', fond: 'fond', usage: 'texte' },
  { texte: 'encre', fond: 'surface', usage: 'texte' },
  { texte: 'secondaire', fond: 'fond', usage: 'texte' },
  { texte: 'secondaire', fond: 'surface', usage: 'texte' },
  // Onglets inactifs (sur la barre blanche), « ou » de l'écran de connexion (sur la carte claire).
  { texte: 'tertiaire', fond: 'surface', usage: 'texte' },
  { texte: 'tertiaire', fond: 'fond', usage: 'texte' },
  // Ce qui presse : « En retard », « Se déconnecter ».
  { texte: 'texteOrange', fond: 'fond', usage: 'texte' },
  { texte: 'texteOrange', fond: 'surface', usage: 'texte' },
  // Liens, onglet actif, bouton secondaire.
  { texte: 'foret', fond: 'fond', usage: 'texte' },
  { texte: 'foret', fond: 'surface', usage: 'texte' },
  // En-tête vert : titre, date, pastilles.
  { texte: 'surForet', fond: 'foret', usage: 'texte' },
  { texte: 'surForetDoux', fond: 'foret', usage: 'texte' },
  { texte: 'surForet', fond: 'foretClair', usage: 'texte' },
  { texte: 'surOrange', fond: 'orange', usage: 'texte' },
  // Contours : bord du bouton secondaire et de la case active du code, bande d'alerte.
  { texte: 'foret', fond: 'fond', usage: 'contour' },
  { texte: 'foret', fond: 'surface', usage: 'contour' },
  { texte: 'orange', fond: 'surface', usage: 'contour' },
];

const SEUILS: Readonly<Record<UsageContraste, number>> = { texte: 4.5, 'grand-texte': 3, contour: 3 };

/** Luminance relative WCAG 2 d'une couleur '#RRGGBB'. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`couleur « ${hex} » : '#RRGGBB' attendu`);
  const [r, v, b] = [m[1], m[2], m[3]].map((c) => {
    const s = parseInt(c ?? '0', 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (v ?? 0) + 0.0722 * (b ?? 0);
}

/** Ratio de contraste WCAG 2, de 1 à 21. */
function ratio(a: string, b: string): number {
  const [claire, foncee] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((claire ?? 0) + 0.05) / ((foncee ?? 0) + 0.05);
}

function kebab(cle: string): string {
  return cle.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

function echapper(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `--nom: valeur` dans la règle, espaces libres, casse des couleurs libre. */
function declare(css: string, nom: string, valeur: string): boolean {
  return new RegExp(`${echapper(nom)}\\s*:\\s*${echapper(valeur).replace(/\s+/g, '\\s*')}\\s*[;}]`, 'i').test(css);
}

describe('ratio de contraste (outil du test)', () => {
  it('noir sur blanc : 21:1 ; blanc sur blanc : 1:1 ; valeur connue #767676 sur blanc : 4,54:1', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(ratio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});

describe('jetons repris des maquettes', () => {
  it('couleurs : valeurs relevées dans les maquettes', () => {
    for (const [cle, valeur] of Object.entries(COULEURS_MAQUETTES)) {
      expect(j.COULEURS[cle]?.toUpperCase(), `COULEURS.${cle}`).toBe(valeur);
    }
    expect(j.COULEURS.tertiaire, 'COULEURS.tertiaire').toMatch(/^#[0-9a-f]{6}$/i);
    for (const [cle, valeur] of Object.entries(j.COULEURS)) expect(valeur, `COULEURS.${cle}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('familles botaniques : bandes de la maquette Plan, texte posé dessus lisible (4,5:1)', () => {
    expect(Object.keys(j.FAMILLES).sort()).toEqual(expect.arrayContaining(Object.keys(BANDES_MAQUETTES).sort()));
    for (const [cle, bande] of Object.entries(BANDES_MAQUETTES)) {
      const famille = j.FAMILLES[cle];
      expect(famille?.bande.toUpperCase(), `FAMILLES.${cle}.bande`).toBe(bande);
    }
    for (const [cle, { bande, texte }] of Object.entries(j.FAMILLES)) {
      const r = ratio(texte, bande);
      expect(r, `FAMILLES.${cle} : ${texte} sur ${bande} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('polices : Archivo (titres), Atkinson Hyperlegible (texte), IBM Plex Mono (codes), avec repli générique', () => {
    expect(j.POLICES.titre).toMatch(/^\s*["']?Archivo["']?\s*,.*\bsans-serif\s*$/);
    expect(j.POLICES.texte).toMatch(/^\s*["']?Atkinson Hyperlegible["']?\s*,.*\bsans-serif\s*$/);
    expect(j.POLICES.code).toMatch(/^\s*["']?IBM Plex Mono["']?\s*,.*\bmonospace\s*$/);
  });

  it('rayons, espacements, ombres', () => {
    expect(j.RAYONS.carte).toBe(16);
    expect(j.RAYONS.bouton).toBe(18);
    for (const [cle, v] of Object.entries(j.RAYONS)) expect(v, `RAYONS.${cle}`).toBeGreaterThan(0);
    expect(Object.keys(j.ESPACEMENTS).length).toBeGreaterThan(0);
    for (const [cle, v] of Object.entries(j.ESPACEMENTS)) expect(v, `ESPACEMENTS.${cle}`).toBeGreaterThan(0);
    expect(j.OMBRES.basse).toBeTruthy();
    expect(j.OMBRES.carte).toBeTruthy();
  });
});

describe('variables CSS générées depuis les jetons (une seule source)', () => {
  it('une règle :root qui déclare chaque jeton', () => {
    const css = j.variablesCss();
    expect(css.trim()).toMatch(/^:root\s*\{[\s\S]*\}$/);
    for (const [cle, v] of Object.entries(j.COULEURS)) expect(declare(css, `--couleur-${kebab(cle)}`, v), `--couleur-${kebab(cle)}`).toBe(true);
    for (const [cle, f] of Object.entries(j.FAMILLES)) {
      expect(declare(css, `--famille-${kebab(cle)}`, f.bande), `--famille-${kebab(cle)}`).toBe(true);
      expect(declare(css, `--famille-${kebab(cle)}-texte`, f.texte), `--famille-${kebab(cle)}-texte`).toBe(true);
    }
    for (const [cle, v] of Object.entries(j.POLICES)) expect(declare(css, `--police-${kebab(cle)}`, v), `--police-${kebab(cle)}`).toBe(true);
    for (const [cle, v] of Object.entries(j.RAYONS)) expect(declare(css, `--rayon-${kebab(cle)}`, `${String(v)}px`), `--rayon-${kebab(cle)}`).toBe(true);
    for (const [cle, v] of Object.entries(j.ESPACEMENTS)) {
      expect(declare(css, `--espace-${kebab(cle)}`, `${String(v)}px`), `--espace-${kebab(cle)}`).toBe(true);
    }
    for (const [cle, v] of Object.entries(j.OMBRES)) expect(declare(css, `--ombre-${kebab(cle)}`, v), `--ombre-${kebab(cle)}`).toBe(true);
  });

  it('couleur(cle) renvoie la variable CSS', () => {
    expect(j.couleur('foret')).toBe('var(--couleur-foret)');
    expect(j.couleur('foretClair')).toBe('var(--couleur-foret-clair)');
    expect(j.couleur('texteOrange')).toBe('var(--couleur-texte-orange)');
  });
});

describe('contraste AA (lisible au soleil)', () => {
  it('les paires des maquettes sont déclarées, avec leur usage', () => {
    for (const exigee of PAIRES_EXIGEES) {
      const declaree = j.PAIRES_CONTRASTE.find((p) => p.texte === exigee.texte && p.fond === exigee.fond && p.usage === exigee.usage);
      expect(declaree, `paire ${exigee.texte} sur ${exigee.fond} (${exigee.usage}) déclarée dans PAIRES_CONTRASTE`).toBeDefined();
    }
  });

  it('chaque paire déclarée désigne des couleurs des jetons', () => {
    for (const p of j.PAIRES_CONTRASTE) {
      expect(j.COULEURS[p.texte], `COULEURS.${p.texte}`).toBeDefined();
      expect(j.COULEURS[p.fond], `COULEURS.${p.fond}`).toBeDefined();
      expect(Object.keys(SEUILS)).toContain(p.usage);
    }
  });

  it('chaque paire déclarée atteint son seuil : 4,5:1 texte, 3:1 grand texte et contours', () => {
    const echecs: string[] = [];
    for (const p of j.PAIRES_CONTRASTE) {
      const t = j.COULEURS[p.texte] ?? '#000000';
      const f = j.COULEURS[p.fond] ?? '#000000';
      const r = ratio(t, f);
      if (r < SEUILS[p.usage]) echecs.push(`${p.texte} ${t} sur ${p.fond} ${f} (${p.usage}) : ${r.toFixed(2)}:1 < ${String(SEUILS[p.usage])}:1`);
    }
    expect(echecs).toEqual([]);
  });
});

/** Fichiers sources (hors tests) d'un dossier, récursivement. */
function sources(dossier: string): string[] {
  let entrees: string[];
  try {
    entrees = readdirSync(dossier);
  } catch {
    return [];
  }
  return entrees.flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    if (!/\.(tsx?|css)$/.test(nom) || /\.test\.tsx?$/.test(nom)) return [];
    return [chemin];
  });
}

/** Texte sans commentaires (approximation suffisante pour chercher des couleurs en dur). */
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('une seule source : aucune couleur en dur hors des jetons', () => {
  it('App.tsx, ui/, connexion/, ecrans/ : couleurs par variables CSS seulement', () => {
    const src = join(RACINE_WEB, 'src');
    const fichiers = [
      join(src, 'App.tsx'),
      ...sources(join(src, 'ui')).filter((f) => !f.endsWith(join('ui', 'jetons.ts'))),
      ...sources(join(src, 'connexion')),
      ...sources(join(src, 'ecrans')),
    ];
    expect(fichiers.some((f) => f.includes(join('src', 'ui')))).toBe(true);
    const fautes: string[] = [];
    for (const f of fichiers) {
      const texte = sansCommentaires(readFileSync(f, 'utf8'));
      for (const m of texte.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\s*\(/gi)) {
        fautes.push(`${relative(RACINE_WEB, f)} : ${m[0]}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it('index.html : theme-color = forêt', () => {
    const html = readFileSync(join(RACINE_WEB, 'index.html'), 'utf8');
    const couleur = /<meta\s+name="theme-color"\s+content="([^"]+)"/i.exec(html)?.[1];
    expect(couleur?.toUpperCase()).toBe(j.COULEURS.foret?.toUpperCase());
  });
});
