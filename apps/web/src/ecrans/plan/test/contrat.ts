/**
 * Contrat de T11 — vue 2D planches × semaines (docs/backlog/T11-vue-2d.md). Types seuls (plus
 * les libellés courts attendus des conflits, en fin de fichier) : les tests chargent les modules
 * par import dynamique (chemin tenu dans une variable), leur typage ne dépend pas du code pas
 * encore écrit.
 *
 * ── Modules attendus ─────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/plan/calculs.ts — fonctions pures (ModuleCalculsPlan) : aucun React, aucun
 *   PowerSync, aucun réseau. Les conflits viennent de `detecterConflits` de T03
 *   (packages/core/src/planification/conflits.ts, à exporter par @planif/core), jamais d'une
 *   nouvelle règle ; la période d'une occupation, de `periodeOccupation` (le réel prime).
 *   Importé aussi par apps/web/e2e/plan.e2e.ts (sous Node) : pas de DOM au chargement.
 *
 * apps/web/src/ecrans/plan/index.ts — l'écran (ModuleEcranPlan), chargé par import dynamique
 *   depuis App.tsx (onglet « Planches » de la coquille de T16), jamais par un import statique.
 *   Il reçoit la porte : il n'importe ni PowerSync ni src/donnees.
 *
 * ── Règles de calcul ─────────────────────────────────────────────────────────────────────────
 *
 * Saisons : celles de la ferme, non supprimées, triées par début. Saison par défaut
 *   (`saisonParDefaut`) : celle qui contient aujourd'hui (debut ≤ jour ≤ fin) ; sinon la plus
 *   récente commencée avant aujourd'hui ; sinon la première ; aucune → null.
 * Colonnes : les semaines ISO de celle du début de la saison à celle de la fin, sans trou
 *   (saison 2026-01-01 → 2026-12-31 : 2026-S01, lundi 2025-12-29, à 2026-S53, 53 colonnes).
 *   Libellé 'S01'…'S53' (deux chiffres). `semaineCourante` : indice de la semaine ISO
 *   d'aujourd'hui dans `semaines`, null si elle n'y est pas.
 * Emplacement actif sur la saison : non supprimé, actif_du ≤ fin de saison, et actif_au nul ou
 *   actif_au > début de saison ([actif_du, actif_au[).
 * Lignes (liste à plat, ordre d'affichage) : zones racines (zone_parente_id nul) triées par nom ;
 *   sous chacune, une ligne 'zone', puis ses emplacements directs triés par code, puis ses
 *   chapelles (sous-zones) triées par nom, chacune suivie de ses emplacements triés par code.
 *   Une sous-zone plus profonde se range sous sa chapelle (l'interface montre deux niveaux).
 *   Tri : Intl.Collator('fr', { numeric: true }) (« Tunnel 2 » avant « Tunnel 10 »). Une zone
 *   ou une chapelle sans emplacement actif n'a pas de ligne. Chaque ligne a la même hauteur,
 *   HAUTEUR_LIGNE_PX (≥ 44 px, maquette Plan).
 * Barres : une par occupation non supprimée d'un emplacement actif dont la période effective
 *   [du, au[ (periodeOccupation de T03 ; au nul = sans fin) recoupe [début, fin + 1 jour[ de la
 *   saison. `debutJour`/`finJour` : jours depuis le lundi de semaines[0], bornés à
 *   [0, 7 × semaines.length], entiers. Triées par debutJour puis occupationId.
 *   `etat` : 'reel' si reel_du est renseigné, sinon 'prevu'.
 *   `libelle` : nom de l'espèce, une espace, nom de la variété (« Espèce 3 Variété 3-1 ») ; sans
 *   variété, l'espèce seule ; couverture (evenement_id) : « Couverture ». Série → son espèce et sa
 *   variété ; plantation → les siennes.
 *   `famille` : nom de la famille de l'espèce (null si inconnue) ; `cleFamille` : cleFamille(famille).
 * Couleur (`cleFamille`, jetons FAMILLES de T16) : nom sans accents ni casse ; 'solanacees' →
 *   'solanacees' ; 'brassicacees' ou 'cruciferes' → 'cruciferes' ; 'asteracees' → 'salades' ;
 *   'apiacees' → 'racines' ; toute autre famille → null (couleur neutre).
 * Conflits : pour chaque emplacement actif, detecterConflits(emplacement, toutes ses occupations
 *   non supprimées, quelle que soit la saison), puis seuls ceux dont [du, au[ recoupe la saison ;
 *   même ordre, mêmes occupations, mêmes dates que T03. `nom` : NOMS_CONFLITS[sorte], « : », puis
 *   les libellés des occupations en cause joints par « et » : « Chevauchement : Espèce 3
 *   Variété 3-1 et Espèce 7 Variété 7-2 ». Une barre est `enConflit` si son occupation est dans
 *   un conflit de sa ligne.
 * Virtualisation : `fenetreVisible` rend les indices [debut, fin[ des lignes à dessiner : toutes
 *   celles qui recoupent [defilement, defilement + hauteurVue[, plus au plus `marge` de chaque
 *   côté, bornées à [0, total].
 *
 * ── Écran (DOM) ──────────────────────────────────────────────────────────────────────────────
 *
 * EcranPlan({ porte, fermeId, aujourdhui? }) — `aujourdhui` rend 'AAAA-MM-JJ' (défaut : jour du
 *   téléphone). Aussi en export par défaut (chargement différé de App.tsx).
 *   - sélecteur de saison : un <select> nommé « Saison » (getByLabel), une option par saison
 *     (texte = nom, value = id), sur la saison par défaut ; le changer redessine sans recharger ;
 *   - conteneur défilant data-testid="plan-defilement" (défile verticalement ; horizontalement
 *     aussi sur un écran étroit, jamais la page) ; hauteur de vue = son clientHeight, ou
 *     window.innerHeight s'il vaut 0 (DOM simulé) ;
 *   - en-tête des semaines : data-testid="semaine" par colonne (texte 'S14'), data-courante="oui"
 *     sur la semaine courante ; repère vertical data-testid="semaine-courante" (un seul, absent
 *     hors saison), visible à l'ouverture ;
 *   - lignes : data-testid="ligne-plan", data-sorte="zone|chapelle|emplacement", data-id=<id>,
 *     texte = nom (zone, chapelle) ou code (emplacement) ; seules les lignes de fenetreVisible
 *     sont dans le DOM ; ligne d'emplacement en conflit : data-conflit="oui", étiquette
 *     bouton et libellés courts (voir « Corrections de la relecture », C1) ;
 *   - barres : data-testid="barre", <button type="button"> (ou role="button"), data-occupation,
 *     data-etat="reel|prevu", data-famille=<cleFamille ou ''>, data-conflit="oui" si en conflit ;
 *     texte (et nom accessible) contenant le libellé. Réel : plein, fond = bande de la famille ;
 *     prévu : hachuré (background-image en repeating-linear-gradient) ; en conflit : bordure
 *     (border-*-color) --couleur-conflit d'au moins 2 px ;
 *   - toucher une barre ouvre le détail, role="dialog" nommé « Détail de la série » : libellé,
 *     code de l'emplacement, noms des conflits de l'occupation ; lecture seule (ni champ, ni
 *     autre bouton qu'un « Fermer » d'au moins 48 px, qui le ferme) ;
 *   - une marque de performance 'planif:plan-affiche' est posée (une fois par ouverture de
 *     l'écran) quand les premières lignes avec leurs barres sont dessinées.
 *
 * ── Appli (App.tsx, src/donnees) ─────────────────────────────────────────────────────────────
 *
 * Connecté, l'appli ouvre la base locale (src/donnees, import dynamique : PowerSync et son WASM
 *   hors du JavaScript de démarrage, voir ./empaquetage.test.ts), choisit la ferme active
 *   (src/donnees/ferme-active.ts, contrat en tête de ferme-active.test.ts), la garde ouverte pour
 *   les écrans suivants (T13, T16b, T14b) et la ferme à la déconnexion (avant l'effacement).
 *   La porte est donnée aux écrans par un contexte React (fourni par la coquille) ; un écran ne
 *   voit que { porte, fermeId }. data-testid="app" porte data-base="ouverture|sans-ferme|prete|
 *   echec". Onglet « Planches » : EcranPlan quand la base est prête ; sinon un texte d'attente
 *   propre (jamais « Bientôt »).
 * Indicateur data-testid="etat-synchro" (role="status") dans la coquille, sur chaque onglet :
 *   libelleSynchro(etat, saisies en attente) (src/donnees/libelle-synchro.ts, démarrage).
 *
 * ── Corrections de la relecture (tests : ../relecture.test.tsx, e2e/plan-relecture.e2e.ts,
 *    src/donnees/base-appli.test.ts) ──────────────────────────────────────────────────────────
 *
 * B1 — Relecture sans retour en haut ni clignotement. Un changement des tables du plan (saisie,
 *   synchro : porte.surveiller) ne remplace jamais le plan affiché par son début : le plan déjà
 *   affiché reste à l'écran (mêmes lignes, même scrollTop, pas de « Lecture des autres
 *   planches… ») jusqu'à ce que le plan relu le remplace. Des changements rapprochés sont
 *   regroupés : deux relectures sont espacées d'au moins 300 ms, et la dernière voit le dernier
 *   changement (rien n'est perdu).
 * C1 — Conflits lisibles. Sur la ligne d'un emplacement en conflit :
 *   - l'étiquette (colonne des codes) est un <button type="button"> data-testid="etiquette-conflit",
 *     de la hauteur de la ligne (≥ 48 px), qui contient le code et les libellés ;
 *   - un libellé court par sorte de conflit présente, dans l'ordre de première apparition dans
 *     `ligne.conflits` : élément data-testid="conflit", data-sorte=<sorte>, texte =
 *     LIBELLES_COURTS_ATTENDUS[sorte], jamais tronqué à 360 px, police calculée ≥ 12 px ;
 *   - toucher l'étiquette ouvre un role="dialog" dont le nom commence par « Conflits » (par
 *     exemple « Conflits de T1-P03 »), qui contient le code et un <li> par conflit de la ligne,
 *     texte = conflit.nom (nom long : « Chevauchement : Espèce 3 Variété 3-1 et … »), dans
 *     l'ordre de `ligne.conflits` ; seul bouton : « Fermer » (≥ 48 px), qui le ferme ;
 *   - « Dates inversées » (periode_invalide) n'a pas de barre : il se voit par « Dates » et se
 *     détaille par ce bouton ;
 *   - une ligne sans conflit n'a ni ce bouton ni libellé de conflit.
 * C3 — Déconnexion avec la base ouverte par l'appli (data-base="prete") : confirmée, elle ne
 *   laisse aucune base IndexedDB « planif… » ni effacement en attente (non-régression).
 * C4 — Lecture de la ferme active en échec (suivreFermeActive, src/donnees/ferme-active.ts) :
 *   l'état publié par ouvrirBaseAppli passe à base: 'echec' (jamais « Ouverture… » sans fin).
 * C6 — Cible tactile des barres : autour du centre de chaque barre, une zone d'au moins
 *   44 × 44 px répond au toucher (elementFromPoint à ±21 px du centre, verticalement et
 *   horizontalement, rend la barre, ou une barre voisine de la même ligne à l'horizontale), sans
 *   agrandir la barre dessinée (sa largeur dit ses dates).
 *
 * Jeton : COULEURS.conflit ('#RRGGBB', variable CSS --couleur-conflit), distinct de chaque bande
 *   de FAMILLES, contraste ≥ 3:1 (contour) sur le fond et sur la surface.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

export type CleFamille = 'salades' | 'solanacees' | 'cruciferes' | 'racines';
export type SorteConflit = 'chevauchement' | 'surcharge' | 'depassement' | 'emplacement_inactif' | 'periode_invalide';

/** Ligne de la base locale telle que la porte la lit (snake_case, valeurs SQLite). */
export type LigneLocale = Readonly<Record<string, string | number | null>>;

/** Lignes de la ferme lues par chargerPlan (bibliothèque de référence comprise : ferme_id nul). */
export interface DonneesPlan {
  readonly zone: readonly LigneLocale[];
  readonly emplacement: readonly LigneLocale[];
  readonly occupation: readonly LigneLocale[];
  readonly serie: readonly LigneLocale[];
  readonly plantation: readonly LigneLocale[];
  readonly espece: readonly LigneLocale[];
  readonly variete: readonly LigneLocale[];
  readonly famille: readonly LigneLocale[];
}

export interface SaisonPlan {
  readonly id: string;
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

export interface SemainePlan {
  readonly annee: number;
  readonly semaine: number;
  /** 'S01' … 'S53'. */
  readonly libelle: string;
  /** Lundi, 'AAAA-MM-JJ'. */
  readonly lundi: string;
}

export interface ConflitPlan {
  readonly sorte: SorteConflit;
  readonly nom: string;
  readonly occupations: readonly string[];
  readonly du: string;
  readonly au: string | null;
}

export interface BarrePlan {
  readonly occupationId: string;
  readonly serieId: string | null;
  readonly plantationId: string | null;
  readonly libelle: string;
  readonly famille: string | null;
  readonly cleFamille: CleFamille | null;
  readonly etat: 'reel' | 'prevu';
  readonly du: string;
  readonly au: string | null;
  readonly debutJour: number;
  readonly finJour: number;
  readonly enConflit: boolean;
}

export interface LigneZonePlan {
  readonly sorte: 'zone' | 'chapelle';
  readonly id: string;
  readonly nom: string;
}

export interface LigneEmplacementPlan {
  readonly sorte: 'emplacement';
  readonly id: string;
  readonly code: string;
  /** Zone racine. */
  readonly zoneId: string;
  /** Chapelle (sous-zone) de rattachement, null si l'emplacement est directement dans la zone. */
  readonly chapelleId: string | null;
  readonly barres: readonly BarrePlan[];
  readonly conflits: readonly ConflitPlan[];
}

export type LignePlan = LigneZonePlan | LigneEmplacementPlan;

export interface Plan {
  readonly saison: SaisonPlan;
  readonly semaines: readonly SemainePlan[];
  readonly semaineCourante: number | null;
  readonly lignes: readonly LignePlan[];
}

export interface OptionsPlan {
  readonly saison: SaisonPlan;
  /** 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
}

export interface ModuleCalculsPlan {
  readonly HAUTEUR_LIGNE_PX: number;
  readonly NOMS_CONFLITS: Readonly<Record<SorteConflit, string>>;
  cleFamille(nomFamille: string | null): CleFamille | null;
  saisonParDefaut(saisons: readonly SaisonPlan[], aujourdhui: string): SaisonPlan | null;
  construirePlan(donnees: DonneesPlan, options: OptionsPlan): Plan;
  chargerSaisons(porte: PorteDonnees, fermeId: string): Promise<SaisonPlan[]>;
  chargerPlan(porte: PorteDonnees, fermeId: string, options: OptionsPlan): Promise<Plan>;
  fenetreVisible(o: {
    readonly defilement: number;
    readonly hauteurVue: number;
    readonly hauteurLigne: number;
    readonly total: number;
    readonly marge: number;
  }): { readonly debut: number; readonly fin: number };
}

export interface ProprietesEcranPlan {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly aujourdhui?: () => string;
}

export interface ModuleEcranPlan {
  readonly EcranPlan: (p: ProprietesEcranPlan) => ReactElement;
  readonly default: (p: ProprietesEcranPlan) => ReactElement;
}

/**
 * Libellés courts des sortes de conflit (C1), tels que la ligne les montre. Attendus par les
 * tests : l'écran peut les tenir dans sa propre constante, les textes doivent être ceux-ci.
 */
export const LIBELLES_COURTS_ATTENDUS: Readonly<Record<SorteConflit, string>> = {
  chevauchement: 'Chevauche',
  depassement: 'Trop long',
  surcharge: 'Surcharge',
  emplacement_inactif: 'Inactif',
  periode_invalide: 'Dates',
};
