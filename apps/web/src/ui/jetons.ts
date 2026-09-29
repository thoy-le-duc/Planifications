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
} as const satisfies Record<string, string>;

export type CleCouleur = keyof typeof COULEURS;

export type CleFamille = 'salades' | 'solanacees' | 'cruciferes' | 'racines';

/**
 * Familles botaniques : bandes des cartes et du plan (maquette Plan), et couleur du texte posé
 * dessus (4,5:1 au moins). Salades foncée à #2670CC (maquette #2A78D6, 4,42:1 sous du blanc).
 */
export const FAMILLES: Readonly<Record<CleFamille, { readonly bande: string; readonly texte: string }>> = {
  salades: { bande: '#2670CC', texte: '#FFFFFF' },
  solanacees: { bande: '#C0392B', texte: '#FFFFFF' },
  cruciferes: { bande: '#1BAF7A', texte: '#15201A' },
  racines: { bande: '#EDA100', texte: '#15201A' },
};

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
  basse: '0 2px 0 rgba(21, 32, 26, 0.28)',
  /** Cartes : trait sous la carte (maquettes). */
  carte: `0 1px 0 ${COULEURS.trait}`,
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
  // Contours : bouton secondaire, case active du code, bande d'alerte, bord des champs.
  { texte: 'foret', fond: 'fond', usage: 'contour' },
  { texte: 'foret', fond: 'surface', usage: 'contour' },
  { texte: 'orange', fond: 'surface', usage: 'contour' },
  { texte: 'tertiaire', fond: 'surface', usage: 'contour' },
];

function kebab(cle: string): string {
  return cle.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

/** Règle `:root{…}` qui déclare une variable CSS par jeton. */
export function variablesCss(): string {
  const lignes: string[] = [];
  const ajouter = (prefixe: string, valeurs: Readonly<Record<string, string | number>>, unite = '') => {
    for (const [cle, v] of Object.entries(valeurs)) lignes.push(`--${prefixe}-${kebab(cle)}:${String(v)}${unite};`);
  };
  ajouter('couleur', COULEURS);
  for (const [cle, f] of Object.entries(FAMILLES)) {
    lignes.push(`--famille-${kebab(cle)}:${f.bande};`, `--famille-${kebab(cle)}-texte:${f.texte};`);
  }
  ajouter('police', POLICES);
  ajouter('rayon', RAYONS, 'px');
  ajouter('espace', ESPACEMENTS, 'px');
  ajouter('ombre', OMBRES);
  return `:root{${lignes.join('')}}`;
}

/** Variable CSS d'une couleur : `couleur('foretClair')` → 'var(--couleur-foret-clair)'. */
export function couleur(cle: CleCouleur): string {
  return `var(--couleur-${kebab(cle)})`;
}
