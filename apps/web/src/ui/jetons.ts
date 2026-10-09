/**
 * Jetons de design (T16) : la seule source des couleurs, polices, rayons, espacements et ombres
 * de l'appli, repris des maquettes validées (docs/maquettes/, Q16).
 *
 * Le reste du code n'écrit aucune couleur : il passe par les variables CSS que `variablesCss()`
 * génère (`var(--couleur-foret)`…). Cette règle `:root` est écrite dans src/jetons.css par
 * `pnpm --filter @planif/web jetons` (scripts/jetons-css.ts), et un test vérifie qu'elle est à
 * jour : une feuille de style, donc aucun octet de JavaScript au démarrage.
 */

/** Couleurs, '#RRGGBB'. Deux nuances ajustées pour le contraste AA : voir docs/maquettes/LISEZMOI.md. */
export const COULEURS = {
  /** Fond des écrans. */
  fond: '#EEF1E8',
  /** Cartes, barre de navigation, cases du code. */
  surface: '#FFFFFF',
  /** Texte. */
  encre: '#15201A',
  /** Texte secondaire. */
  secondaire: '#4B5A50',
  /** Onglets inactifs, flèches, bord des champs (maquettes : #6B786F, 4,05:1 ; ici 4,75:1). */
  tertiaire: '#606D64',
  /** Séparateurs, ombre des cartes. */
  trait: '#D6DDD0',
  /** Tout ce qui se touche, en-têtes. */
  foret: '#1F4D3A',
  /** Pastilles et motifs sur l'en-tête. */
  foretClair: '#2C6450',
  /** Texte sur la forêt. */
  surForet: '#F4F7EF',
  /** Texte secondaire sur la forêt. */
  surForetDoux: '#B9D3C2',
  /** Pousses du motif de l'écran de connexion (décor). */
  pousse: '#9FE0B4',
  /** Ce qui presse : bande, pastille « en retard ». */
  orange: '#E0701F',
  /** Texte de ce qui presse. */
  texteOrange: '#9A4A0F',
  /** Texte posé sur l'orange. */
  surOrange: '#1B0F05',
  /**
   * Conflits de place (T11) : nom du conflit, bordure des barres en cause. Rouge sombre, distinct
   * de la bande des solanacées (#C0392B) et lisible en texte sur le fond et la surface.
   */
  conflit: '#B3001B',
  /**
   * En-tête des écrans et bandeau de l'écran de connexion (T18). En clair, la forêt elle-même ;
   * en sombre, une forêt profonde, alors que `foret` (ce qui se touche) y devient un vert sauge
   * clair : une même couleur ne peut pas être à la fois texte lisible sur le fond sombre et fond
   * d'un texte clair.
   */
  entete: '#1F4D3A',
  /** Pastilles sur l'en-tête. */
  enteteClair: '#2C6450',
  /** Texte sur l'en-tête. */
  surEntete: '#F4F7EF',
  /** Texte secondaire sur l'en-tête (date). */
  surEnteteDoux: '#B9D3C2',
  /** Ombres portées et voile sous les feuilles : toujours sombre, quel que soit le thème. */
  ombre: '#15201A',
  /**
   * Pousses en décor sur un fond foncé (motif de la connexion, bande de la démo) : la même dans les
   * deux thèmes. `pousse`, elle, devient un vert foncé en sombre (barre du compte à rebours sur le
   * vert sauge des bandeaux) ; .zone-entete (src/ui/base.css) la remplace par celle-ci.
   */
  pousseEntete: '#9FE0B4',
} as const satisfies Record<string, string>;

export type CleCouleur = keyof typeof COULEURS;

/**
 * Thème sombre (T18), mêmes clés : une forêt de nuit plutôt qu'un noir pur. Fond vert-noir, cartes
 * un cran plus claires (la surface « monte » vers l'œil), texte blanc cassé chaud ; ce qui se
 * touche passe en vert sauge clair avec un texte forêt profonde dessus ; orange et rouge éclaircis
 * et adoucis pour rester lisibles sans éblouir. Contraste AA de toutes les PAIRES_CONTRASTE
 * vérifié par src/ui/jetons-sombres.test.ts. Appliqué par prefers-color-scheme, ou forcé par le
 * réglage « Apparence » de l'onglet Ferme (src/ui/theme.ts).
 */
export const COULEURS_SOMBRES: Readonly<Record<CleCouleur, string>> = {
  fond: '#111915',
  surface: '#1A2420',
  encre: '#E7EEE3',
  // Pas plus claire que la bande de famille la plus claire (racines) : « Autres » ne crie pas.
  secondaire: '#A3B0A7',
  tertiaire: '#93A298',
  trait: '#2D3B34',
  foret: '#8DCBA6',
  foretClair: '#A5D8B9',
  surForet: '#0D1C14',
  surForetDoux: '#21412F',
  pousse: '#164A33',
  orange: '#EE8A3C',
  texteOrange: '#F2A766',
  surOrange: '#1B0F05',
  conflit: '#FF8A8F',
  entete: '#1C3A2C',
  enteteClair: '#2A5241',
  surEntete: '#EEF4EA',
  surEnteteDoux: '#A9C9B5',
  ombre: '#040605',
  pousseEntete: '#9FE0B4',
};

/**
 * Clés des familles (T27b) : les 16 familles de la bibliothèque commune plus « autre » (famille
 * propre à la ferme, inconnue, ou culture sans famille). Les quatre premières gardent leur nom de
 * T16 (salades = Astéracées, cruciferes = Brassicacées, racines = Apiacées) ; les autres portent
 * leur nom sans accents.
 */
export type CleFamille =
  | 'salades'
  | 'solanacees'
  | 'cruciferes'
  | 'racines'
  | 'alliacees'
  | 'amaranthacees'
  | 'asparagacees'
  | 'convolvulacees'
  | 'cucurbitacees'
  | 'fabacees'
  | 'lamiacees'
  | 'paeoniacees'
  | 'poacees'
  | 'polygonacees'
  | 'rosacees'
  | 'valerianacees'
  | 'autre';

interface BandeFamille {
  readonly bande: string;
  readonly texte: string;
}

/**
 * Familles botaniques : bandes des cartes, du plan (maquette Plan) et des volumes de la vue 3D, et
 * couleur du texte posé dessus (4,5:1 au moins). Salades foncée à #2670CC (maquette #2A78D6,
 * 4,42:1 sous du blanc). Les 13 teintes de T27b sont choisies par éloignement maximal dans
 * CIE L*a*b* (ΔE CIE76 : au moins 33 entre deux familles en clair, 20 avec le neutre de la
 * planche vide #D6DDD0 ; seuils des tests : 10 et 20), « autre » étant un vert-gris discret.
 */
export const FAMILLES: Readonly<Record<CleFamille, BandeFamille>> = {
  salades: { bande: '#2670CC', texte: '#FFFFFF' },
  solanacees: { bande: '#C0392B', texte: '#FFFFFF' },
  cruciferes: { bande: '#1BAF7A', texte: '#15201A' },
  racines: { bande: '#EDA100', texte: '#15201A' },
  alliacees: { bande: '#7D32A0', texte: '#FFFFFF' },
  amaranthacees: { bande: '#C8055F', texte: '#FFFFFF' },
  asparagacees: { bande: '#A0C337', texte: '#15201A' },
  convolvulacees: { bande: '#A55F05', texte: '#FFFFFF' },
  cucurbitacees: { bande: '#0F6400', texte: '#FFFFFF' },
  fabacees: { bande: '#00C8F0', texte: '#15201A' },
  lamiacees: { bande: '#D2AAE6', texte: '#15201A' },
  paeoniacees: { bande: '#FF6ECD', texte: '#15201A' },
  poacees: { bande: '#5F5514', texte: '#FFFFFF' },
  polygonacees: { bande: '#823C5F', texte: '#FFFFFF' },
  rosacees: { bande: '#FF91AA', texte: '#15201A' },
  valerianacees: { bande: '#EBAA82', texte: '#15201A' },
  autre: { bande: '#A0AF6E', texte: '#15201A' },
};

/**
 * Bandes des familles en thème sombre (T18) : éclaircies pour se détacher des cartes sombres
 * (3:1 au moins), avec un texte forêt de nuit dessus (4,5:1 au moins). Appliquées par les mêmes
 * variables `--famille-*` (variablesCss). T27b : ΔE CIE76 d'au moins 21 entre deux familles.
 */
export const FAMILLES_SOMBRES: Readonly<Record<CleFamille, BandeFamille>> = {
  salades: { bande: '#5E9BE8', texte: '#0D1C14' },
  solanacees: { bande: '#EC7363', texte: '#0D1C14' },
  cruciferes: { bande: '#2DBE86', texte: '#0D1C14' },
  racines: { bande: '#EDA100', texte: '#0D1C14' },
  alliacees: { bande: '#9B85F2', texte: '#0D1C14' },
  amaranthacees: { bande: '#EE5F8E', texte: '#0D1C14' },
  asparagacees: { bande: '#AFD246', texte: '#0D1C14' },
  convolvulacees: { bande: '#CC7A2A', texte: '#0D1C14' },
  cucurbitacees: { bande: '#4BAA2E', texte: '#0D1C14' },
  fabacees: { bande: '#00D7F0', texte: '#0D1C14' },
  lamiacees: { bande: '#E696FF', texte: '#0D1C14' },
  paeoniacees: { bande: '#D957BC', texte: '#0D1C14' },
  poacees: { bande: '#A39A4B', texte: '#0D1C14' },
  polygonacees: { bande: '#A980BE', texte: '#0D1C14' },
  rosacees: { bande: '#FAAFDC', texte: '#0D1C14' },
  valerianacees: { bande: '#F5B97D', texte: '#0D1C14' },
  autre: { bande: '#8E9A92', texte: '#0D1C14' },
};

/**
 * Vue 3D (T27b) : neutre pâle des planches décochées par les filtres, estompées et non retirées.
 * Plus clair que `trait` (le vide) et à ΔE CIE76 d'au moins 39 de chaque bande de famille claire.
 * Une seule valeur pour les deux thèmes : la scène 3D ne suit pas le thème (COULEUR_NEUTRE non plus).
 */
export const COULEUR_ESTOMPEE = '#E9ECE6';

/** Vue 3D (T32b) : feuillage des plants stylisés ; la couleur du filtre reste sur la planche. Une seule valeur pour les deux thèmes. */
export const COULEUR_FEUILLAGE_3D = '#4FA55B';

/** Vue 3D (T32b) : bois des poteaux (pergola du kiwi, pieds des gouttières hors-sol). Une seule valeur pour les deux thèmes. */
export const COULEUR_BOIS_3D = '#8A6A48';

/** Familles de polices (hébergées sous public/polices/, voir src/ui/base.css). */
export const POLICES = {
  /** Titres : Archivo, largeur 112 % (posée par le @font-face). */
  titre: "'Archivo', system-ui, sans-serif",
  /** Texte : Atkinson Hyperlegible, lisible au soleil. */
  texte: "'Atkinson Hyperlegible', system-ui, sans-serif",
  /** Codes de planche, dates de l'en-tête. */
  code: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** Rayons, en px. */
export const RAYONS = {
  /** Étiquette de code de planche. */
  etiquette: 6,
  /** Cases du code de connexion, champs. */
  case: 14,
  carte: 16,
  bouton: 18,
  /** Haut de la carte de connexion. */
  feuille: 28,
  pastille: 999,
} as const;

/** Espacements, en px. */
export const ESPACEMENTS = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
} as const;

/** Ombres (box-shadow). */
export const OMBRES = {
  /** Bouton principal : ombre basse, il se détache sans flotter. */
  basse: '0 2px 0 color-mix(in srgb, var(--couleur-ombre) 28%, transparent)',
  /** Cartes : trait sous la carte (maquettes), qui suit le thème. */
  carte: '0 1px 0 var(--couleur-trait)',
} as const;

export type UsageContraste = 'texte' | 'grand-texte' | 'contour';

export interface PaireContraste {
  readonly texte: CleCouleur;
  readonly fond: CleCouleur;
  readonly usage: UsageContraste;
}

/**
 * Paires texte / fond utilisées par l'appli, vérifiées au seuil WCAG AA par
 * src/ui/jetons.test.ts : 4,5:1 pour le texte, 3:1 pour les grands textes et les contours.
 */
export const PAIRES_CONTRASTE: readonly PaireContraste[] = [
  { texte: 'encre', fond: 'fond', usage: 'texte' },
  { texte: 'encre', fond: 'surface', usage: 'texte' },
  { texte: 'secondaire', fond: 'fond', usage: 'texte' },
  { texte: 'secondaire', fond: 'surface', usage: 'texte' },
  { texte: 'tertiaire', fond: 'surface', usage: 'texte' },
  { texte: 'tertiaire', fond: 'fond', usage: 'texte' },
  { texte: 'texteOrange', fond: 'fond', usage: 'texte' },
  { texte: 'texteOrange', fond: 'surface', usage: 'texte' },
  { texte: 'foret', fond: 'fond', usage: 'texte' },
  { texte: 'foret', fond: 'surface', usage: 'texte' },
  { texte: 'surForet', fond: 'foret', usage: 'texte' },
  { texte: 'surForetDoux', fond: 'foret', usage: 'texte' },
  { texte: 'surForet', fond: 'foretClair', usage: 'texte' },
  { texte: 'surOrange', fond: 'orange', usage: 'texte' },
  // Nom du conflit sur la ligne du plan (T11), texte de 11 px au moins : seuil du texte courant.
  { texte: 'conflit', fond: 'surface', usage: 'texte' },
  { texte: 'conflit', fond: 'fond', usage: 'texte' },
  // Contours : bouton secondaire, case active du code, bande d'alerte, bord des champs.
  { texte: 'foret', fond: 'fond', usage: 'contour' },
  { texte: 'foret', fond: 'surface', usage: 'contour' },
  { texte: 'orange', fond: 'surface', usage: 'contour' },
  { texte: 'tertiaire', fond: 'surface', usage: 'contour' },
  // Bordure des barres en conflit (T11).
  { texte: 'conflit', fond: 'surface', usage: 'contour' },
  { texte: 'conflit', fond: 'fond', usage: 'contour' },
  // En-tête (T18) : titre, date, pastilles.
  { texte: 'surEntete', fond: 'entete', usage: 'texte' },
  { texte: 'surEnteteDoux', fond: 'entete', usage: 'texte' },
  { texte: 'surEntete', fond: 'enteteClair', usage: 'texte' },
  // Puce « déjà utilisée » des itinéraires : texte sur surForetDoux.
  { texte: 'encre', fond: 'surForetDoux', usage: 'texte' },
  // Bandeaux d'annulation (relecture T18) : barre du compte à rebours sur la forêt ; bandeau
  // d'échec, texte sur conflit.
  { texte: 'pousse', fond: 'foret', usage: 'contour' },
  { texte: 'surface', fond: 'conflit', usage: 'texte' },
  // Bande de la démo : texte sur l'ombre.
  { texte: 'surEntete', fond: 'ombre', usage: 'texte' },
  { texte: 'surEnteteDoux', fond: 'ombre', usage: 'texte' },
  // Bande neutre « Autres » du plan.
  { texte: 'surForet', fond: 'secondaire', usage: 'texte' },
];

function kebab(cle: string): string {
  return cle.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

/** `--famille-<clé>` (bande) et `--famille-<clé>-texte` pour chaque famille. */
function variablesFamilles(familles: Readonly<Record<string, { readonly bande: string; readonly texte: string }>>): string {
  return Object.entries(familles)
    .map(([cle, f]) => `--famille-${kebab(cle)}:${f.bande};--famille-${kebab(cle)}-texte:${f.texte};`)
    .join('');
}

/** `--couleur-<clé>:<valeur>;` pour chaque couleur. */
function variablesCouleurs(couleurs: Readonly<Record<string, string>>): string {
  return Object.entries(couleurs)
    .map(([cle, v]) => `--couleur-${kebab(cle)}:${v};`)
    .join('');
}

/**
 * Règle `:root{…}` qui déclare une variable CSS par jeton (thème clair), puis les deux surcharges
 * du thème sombre (T18), qui ne redéfinissent que les couleurs : le téléphone en sombre, sauf
 * « Clair » forcé ; « Sombre » forcé (`data-theme`, posé par public/theme-initial.js et ui/theme.ts).
 */
export function variablesCss(): string {
  const lignes: string[] = [];
  const ajouter = (prefixe: string, valeurs: Readonly<Record<string, string | number>>, unite = '') => {
    for (const [cle, v] of Object.entries(valeurs)) lignes.push(`--${prefixe}-${kebab(cle)}:${String(v)}${unite};`);
  };
  lignes.push(variablesCouleurs(COULEURS));
  lignes.push(variablesFamilles(FAMILLES));
  ajouter('police', POLICES);
  ajouter('rayon', RAYONS, 'px');
  ajouter('espace', ESPACEMENTS, 'px');
  ajouter('ombre', OMBRES);
  const sombres = variablesCouleurs(COULEURS_SOMBRES);
  // Bandes sombres dans une règle à part (sélecteur html, plus spécifique que :root) : les
  // surcharges :root ne portent que les couleurs.
  const familles = variablesFamilles(FAMILLES_SOMBRES);
  return (
    `:root{${lignes.join('')}}\n` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="clair"]){${sombres}}}\n` +
    `:root[data-theme="sombre"]{${sombres}}\n` +
    `@media (prefers-color-scheme: dark){html:not([data-theme="clair"]){${familles}}}\n` +
    `html[data-theme="sombre"]{${familles}}`
  );
}

/** Variable CSS d'une couleur : `couleur('foretClair')` → 'var(--couleur-foret-clair)'. */
export function couleur(cle: CleCouleur): string {
  return `var(--couleur-${kebab(cle)})`;
}
