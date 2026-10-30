/**
 * Contrat de T89 — « Ajouter une serre ou un tunnel » : une fiche, un tap, tout est en place (docs/backlog/T89-ajouter-serre.md).
 * Complète ./contrat.ts (éditeur), ./contrat-cases.ts (T88) et ./contrat-bandes.ts (T86). Calcul pur du cœur :
 * packages/core/src/placement/serre-fiche.test.ts ; écriture : packages/sync/src/placement-creation.test.ts.
 *
 * ── Bouton « Ajouter » (mode édition, gérant seulement) ──────────────────────────────────────
 *
 * Un bouton « Ajouter » ouvre un menu de trois boutons : « Serre ou tunnel », « Parcelle de plein champ », « Bâtiment ».
 * Désactivé tant que le plan n'a pas d'origine. Absent en lecture seule et pour un équipier.
 * « Bâtiment » ouvre le formulaire « Nouveau bâtiment » existant, dont la liste « Type » ne propose plus serre_tunnel ni serre_chapelle (règle 6).
 *
 * ── Fiche (role="dialog", nom accessible « Serre ou tunnel », data-testid `fiche-serre`) ──────
 *
 * Champs <input> trouvés par nom accessible EXACT (CHAMPS_SERRE), dans cet ordre dans le DOM : Nom, largeur d'une chapelle, nombre de
 * chapelles, longueur d'un tronçon, nombre de tronçons, allée (présente SEULEMENT si le nombre de tronçons est > 1), préfixe, puis les
 * quatre champs des planches. Valeurs initiales : celles de defautsSerre(dernière serre à grille de la ferme) (cœur). La « dernière serre créée »
 * = le bâtiment non supprimé de type serre_tunnel / serre_chapelle, à grille (nb_chapelles non nul), le plus récent par `cree_le` ;
 * un bâtiment sans grille (ancienne serre) ne compte pas. Ses mesures : chapelle = largeur / nb_chapelles, tronçon = (longueur − (nb_troncons − 1) × allée) / nb_troncons.
 * Le préfixe suit le nom tant qu'on ne l'a pas modifié à la main.
 * Élément `resume-serre` : le texte de resumeSerre (« 57,6 × 128,8 m, 18 zones, 144 planches »), mis à jour à chaque saisie.
 * Bouton « Créer » : désactivé (aria-disabled ou disabled) si le nom est vide ou si une valeur est invalide (nombre de chapelles non entier ou hors 1-100,
 * tronçons hors 1-50, dimension ≤ 0, allée < 0), avec un message role="alert" ou `aide-serre` qui dit pourquoi. Un tap sur « Créer » ferme la fiche,
 * RIEN n'est écrit : le brouillon contient la serre, sélectionnée, posée au centre de la vue.
 *
 * ── Brouillon d'une serre créée ──────────────────────────────────────────────────────────────
 *
 * Élément `brouillon-serre` (une seule fois tant que le brouillon contient des créations), attributs : data-batiments, data-zones (zones
 * de premier niveau créées), data-sous-zones, data-emplacements (nombres). Les cases (`case-serre`, T88) et les planches placées (`planche`)
 * du brouillon sont dessinées comme si elles étaient en base. « Abandonner les changements » retire tout.
 *
 * « Enregistrer » : UN SEUL porte.placer, dans cet ordre : zone_creation de la serre (zone_parente_id nul), zone_creation de chaque
 * sous-zone (parente = la serre), emplacement_creation de leurs planches (après leur sous-zone), puis le bâtiment (zone_id = la serre, grille T88).
 * Le bâtiment a hauteur_m > 0, le cap 0°, longueur/largeur totales de resumeSerre. Les emplacements sont codés P1…Pn, rangés dans leur case (règle T88).
 *
 * ── « Placer la serre » depuis une zone tunnel ou serre sans bâtiment ────────────────────────
 *
 * Ouvre LA MÊME fiche, préremplie : nom = nom de la zone, préfixe = nom de la zone, nombre de chapelles = nombre de sous-zones existantes
 * (au moins 1, 1 tronçon), nombre de planches par zone = le plus grand nombre de planches vivantes d'une sous-zone existante (sinon le défaut).
 * Les sous-zones existantes (ordre naturel des noms) occupent les premières cases ; seules les sous-zones et les planches MANQUANTES sont créées
 * (zone_creation / emplacement_creation pour elles seulement, avec des codes libres dans leur zone) ; les planches existantes sont placées
 * dans leur case. La zone existante est reprise telle quelle (aucune zone_creation à son nom) et abritée par le bâtiment créé.
 */
export const BOUTONS_SERRE = {
  ajouter: 'Ajouter',
  serreOuTunnel: 'Serre ou tunnel',
  parcelle: 'Parcelle de plein champ',
  batiment: 'Bâtiment',
  creer: 'Créer',
  placerSerre: 'Placer la serre',
  abandonner: 'Abandonner les changements',
  enregistrer: 'Enregistrer',
} as const;

export const CHAMPS_SERRE = {
  nom: 'Nom',
  largeurChapelle: 'Largeur d’une chapelle (m)',
  nbChapelles: 'Nombre de chapelles',
  longueurTroncon: 'Longueur d’un tronçon (m)',
  nbTroncons: 'Nombre de tronçons',
  allee: 'Allée entre tronçons (m)',
  prefixe: 'Préfixe du nom des zones',
  nbPlanches: 'Planches par zone',
  largeurPlanche: 'Largeur des planches (cm)',
  longueurPlanche: 'Longueur des planches (m)',
  passePied: 'Passe-pied (cm)',
} as const;

export const TESTID_SERRE = {
  fiche: 'fiche-serre',
  resume: 'resume-serre',
  aide: 'aide-serre',
  brouillon: 'brouillon-serre',
} as const;
