/**
 * Contrat de T12 — plan de culture : créer et modifier une série (docs/backlog/T12-plan-de-
 * culture.md, « Décisions du chef »), amendé par T12b (docs/backlog/T12b-serie-suites.md :
 * sélecteur de semaine maison, libellé de l'ancre, N1, N2, N3, N5 ; voir « T12b » plus bas et
 * ../suites.test.tsx). Types et constantes seuls : les tests chargent les modules
 * par import dynamique (chemin tenu dans une variable), leur typage ne dépend pas du code pas
 * encore écrit.
 *
 * Tests : ../ecran.test.tsx (formulaire, DOM simulé, base mémoire), ../plan.test.tsx (appui long,
 * « Nouvelle série », « Modifier la série », bandeau « Annuler » depuis l'écran Planches),
 * ../empaquetage.test.ts (chargement à la demande), ../jeu.test.ts (garde du jeu de test, passe
 * déjà), apps/web/e2e/serie.e2e.ts (build des essais,
 * hors ligne, CPU ×4), et l'adaptation de ../../plan/ecran.test.tsx (détail d'une barre).
 * Données : ./ferme-serie.ts (ferme de test, attendus chiffrés en tête).
 *
 * ── Modules attendus ─────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/serie/index.ts — le formulaire (ModuleSerie). Chargé par import dynamique
 *   depuis l'écran Planches (jamais par un import statique : ni dans le JavaScript de démarrage,
 *   ni dans le morceau du plan). Il reçoit la porte : il n'importe ni PowerSync ni src/donnees.
 *   Les dates (calculerDatesSerie, T02), les besoins (besoinsSerie, T05), les conflits
 *   (detecterConflits, T03) et les alertes de rotation (alertesRotation, T04) viennent de
 *   @planif/core : aucune règle réécrite dans l'écran.
 * apps/web/src/ecrans/plan/calculs.ts — exporte en plus LARGEUR_SEMAINE_PX (largeur d'une
 *   semaine, 36 aujourd'hui) et LARGEUR_ETIQUETTE_PX (colonne des codes, 92 aujourd'hui) : les
 *   valeurs mêmes du dessin (EcranPlan.tsx les importe au lieu de ses constantes locales).
 * apps/web/src/donnees/amorcer.ts — `?jeu=serie` : voir « Amorçage ».
 *
 * ── Formulaire (DOM) ─────────────────────────────────────────────────────────────────────────
 *
 * FormulaireSerie(ProprietesFormulaireSerie), aussi en export par défaut :
 *   - racine role="dialog", aria-modal="true", data-testid="formulaire-serie", nom accessible
 *     « Nouvelle série » (création) ou « Modifier la série » (modification) ;
 *   - Culture : champ texte (<input type="search"> ou "text") nommé « Culture ». Dès un
 *     caractère tapé, un bouton data-testid="choix-culture" par culture qui correspond,
 *     data-espece=<id>, data-variete=<id ou ''> ; texte : nom de l'espèce, puis de la variété.
 *     Bibliothèque : les espèces non supprimées de la ferme et de la bibliothèque commune
 *     (ferme_id nul), chacune seule et avec chacune de ses variétés non supprimées. Recherche
 *     sans accents ni casse : chaque mot tapé commence un mot de « espèce variété » (« bat » →
 *     Batavia ; « CHO » → Chou ; « gren » → Batavia Grenobloise). Culture choisie : les choix
 *     disparaissent, data-testid="culture-choisie" dit l'espèce, la variété et la famille
 *     (maquette : « Laitue batavia Grenobloise · Astéracées ») ;
 *   - Itinéraire : <select> nommé « Itinéraire », une option par itinéraire non supprimé de
 *     l'espèce (variete_id nul ou celui de la variété choisie), value = id, texte = nom.
 *     Proposé au choix de la culture : le premier dont la période d'usage
 *     (parametres.periodeUsage, semaines ISO, peut chevaucher l'an) contient la semaine de mise
 *     en place visée (semaine du formulaire à ce moment) ; à défaut, le premier par nom.
 *     Départage : celui de la variété avant ceux de l'espèce, puis le nom ;
 *   - Ancre : role="radiogroup" nommé « Ancre », trois radios nommés « Semis », « Plantation »,
 *     « Récolte à partir de ». Au choix de la culture : « Plantation » (plant maison ou acheté),
 *     « Semis » (semis direct). « Semis » est désactivé pour un plant acheté (validerSerie le
 *     refuse). Changer d'ancre NE CHANGE PAS les dates : la semaine du formulaire devient celle
 *     de la date calculée de l'étape choisie (plantation S14 → récolte S21, maquette Serie) ;
 *   - Semaine : sélecteur de semaine maison (T12b, voir « Sélecteur de semaine » plus bas), plus
 *     AUCUN <input type="week">. ancre_date = le lundi de cette semaine (l'interface parle en
 *     semaines, le stockage en dates), sauf N1 (T12b) : une série dont l'ancre n'est pas un
 *     lundi la garde tant que la semaine n'est pas touchée ;
 *   - Emplacements : un élément data-testid="emplacement-serie", data-emplacement=<id> par
 *     planche choisie (texte : son code), avec un champ nombre nommé « Longueur <code> » (en m,
 *     par défaut la longueur de la planche) et un bouton « Retirer <code> » ; un <select> nommé
 *     « Ajouter une planche » (première option vide), une option par emplacement actif de sorte
 *     'planche' pas encore choisi, value = id, texte = code ; le choisir l'ajoute ;
 *   - Sans bouton « calculer » : dès qu'un champ change, tout se recalcule et s'affiche :
 *       · dates : data-testid="dates-serie", un data-testid="date-serie" par étape présente,
 *         data-etape="semisPepiniere|miseEnPlace|debutRecolte|finRecolte", data-date=
 *         'AAAA-MM-JJ' ; texte : « S10 · 8 mars » (semaine ISO sur deux chiffres, date lisible) ;
 *       · besoins : data-testid="besoins-serie", un data-testid="besoin" par grandeur numérique
 *         du résultat de besoinsSerie (toutes ses clés sauf mode et facon), data-cle=<clé>,
 *         data-valeur=<nombre> ; texte lisible (« 300 plants », « 4 plaques »…). Entrée du
 *         calcul (T05, conversion au bord) : l'instantané de l'itinéraire, germination =
 *         variete.taux_germination (100 sans variété ni taux), pmgMg = poids_mille_graines_g ×
 *         1000 arrondi (null si inconnu), doseMgParM2 = doseGParM2 × 1000, grainesParPoquet
 *         (1 si nul), longueurCm = longueur totale × 100 arrondie ;
 *       · conflits : detecterConflits(planche, occupations non supprimées de la planche —
 *         moins, en modification, celles de la série — plus l'occupation proposée), seuls ceux
 *         où l'occupation proposée est en cause : un data-testid="conflit-serie" par conflit,
 *         data-sorte, data-emplacement ; texte : code de la planche et libellé des autres
 *         cultures en cause (« Batavia Grenobloise ») ;
 *       · rotation : alertesRotation(culture, planche, année de la mise en place, historique
 *         de la ferme, hiérarchie ; en modification, `exclure` = les occupations de la série)
 *         par planche choisie : un data-testid="alerte-rotation" par alerte, data-niveau=
 *         "rouge|orange", data-emplacement ; texte : nom de la famille, année et lieu (code ou
 *         nom de la zone) de la première ligne en cause (« Brassicacées en 2023 sur C3 ») ;
 *   - bouton d'enregistrement : « Planifier la série » (création, maquette) ou « Enregistrer »
 *     (modification) ; désactivé tant qu'il manque la culture, l'itinéraire, la semaine ou une
 *     planche de longueur > 0 ; « Fermer » ferme sans rien écrire (pas « Annuler », réservé au
 *     retour en arrière d'une saisie) ;
 *   - alerte rouge : enregistrer ouvre d'abord une confirmation, role="alertdialog" (ou
 *     "dialog") dont le nom commence par « Alerte de rotation », qui cite la famille et
 *     l'année ; « Revenir » la ferme sans rien écrire ; « Planifier quand même » écrit la série
 *     avec rotation_acceptee = { famille: <id de la famille de l'espèce>, delai_ans: <délai
 *     MINIMAL applicable de l'alerte>, le: maintenant().toISOString() } (texte JSON). Une
 *     alerte orange seule n'ouvre rien : rotation_acceptee reste nul ;
 *   - marque de performance MARQUE_SERIE_AFFICHEE_ATTENDUE, une fois par ouverture, quand le
 *     formulaire est utilisable (bibliothèque lue, champs dessinés) ;
 *   - le focus entre dans le dialogue à l'ouverture et y reste (comme T13, dialogue.ts) ;
 *   - cibles tactiles (e2e) : toute commande ≥ 56 × 56 px (boutons, champs, <select>, radios ou
 *     leur <label>), contraste AA de leur texte ; à 360 px de large, aucun défilement horizontal.
 *
 * ── Écritures : une saisie = UNE transaction (porte.ecrireEnsemble) ──────────────────────────
 *
 * Règles du serveur : apps/api/src/sync/serie.ts (T10e). Chaque ligne écrite est acceptée par
 * validerSerie, et chaque occupation par validerOccupation(o, série) avec les dates de la série
 * (fin de lot). Jamais d'écriture dans `modification` (le serveur seul l'écrit), jamais de
 * DELETE ni de REPLACE sur `serie` ou `occupation` (suppression douce : supprime_le), jamais
 * d'écriture sur une occupation qui n'est pas celle d'une série (plantation, couverture).
 * Identifiants : UUID v7. Horodatages locaux (cree_le, modifie_le, supprime_le) :
 * maintenant().toISOString().
 *
 * Création : INSERT serie PUIS une INSERT occupation par planche, dans cet ordre :
 *   serie : ferme_id, saison_id = la saison de la ferme dont [debut, fin] contient la mise en
 *     place (à défaut, depart.saisonId), espece_id, variete_id (ou null), itineraire_id,
 *     parametres = l'instantané FIDÈLE de l'itinéraire choisi (même JSON que
 *     itineraire.parametres, jamais retouché), ancre_type ('semis' | 'plantation' |
 *     'debut_recolte'), ancre_date, prevu_* = calculerDatesSerie (semis pépinière null s'il est
 *     sans objet), longueur_m = somme des longueurs, nombre_plants null, statut 'prevue',
 *     rotation_acceptee (null, ou la décision), supprime_le null ;
 *   occupation : emplacement_id, serie_id, plantation_id et evenement_id null, longueur_m de la
 *     planche choisie, nombre_places null, position_m null, prevu_du = mise en place, prevu_au
 *     = fin de récolte, reel_* null, supprime_le null.
 * Modification : UPDATE serie (colonnes changées et modifie_le) PUIS les occupations : UPDATE
 *   (dates, longueur) de celles des planches gardées, INSERT pour une planche ajoutée, UPDATE
 *   supprime_le pour une planche retirée.
 *
 * ── Annuler ──────────────────────────────────────────────────────────────────────────────────
 *
 * Après l'enregistrement, le formulaire appelle surEnregistree({ texte, annuler }) puis
 *   surFermer(). annuler() défait la saisie en UNE transaction, même hors ligne :
 *   - création : supprime_le posé sur la série et ses occupations ;
 *   - modification : la série et ses occupations reviennent exactement à leurs valeurs d'avant
 *     (occupation ajoutée : supprimée doucement ; retirée : rétablie, supprime_le nul).
 * L'écran Planches montre alors data-testid="saisie-annulable", role="status", texte = culture,
 *   bouton « Annuler » (qui appelle annuler()), pendant DELAI_ANNULATION_SERIE_MS.
 * Historique (modification seulement) : région nommée « Historique » (role="region" ou <section
 *   aria-label>) ; une entrée data-testid="modification-historique" par ligne `modification`
 *   (reçue du serveur) de nom_table 'Serie' et ligne_id = la série, la plus récente d'abord,
 *   data-modification=<id de la ligne>, data-operation=<operation> ; texte : « Création »,
 *   « Modification » ou « Suppression », et « alerte de rotation acceptée » quand `apres`
 *   porte rotation_acceptee non nul ; un bouton dont le nom commence par « Annuler ».
 *   Annuler l'entrée E (horodatage t) ramène la série ET ses occupations à leur état juste avant
 *   t, en une transaction :
 *   - série : E.avant (format de Postgres, to_jsonb : parametres et rotation_acceptee en objets,
 *     à réécrire en texte JSON) ; E 'creation' → suppression douce de la série ;
 *   - chaque occupation de la série qui a une ligne `modification` (nom_table 'Occupation')
 *     d'horodatage ≥ t : l'`avant` de la plus ancienne de ces lignes ('creation' → suppression
 *     douce). Le téléphone écrit la série avant ses occupations : leurs lignes suivent celle de
 *     la série. Les entrées plus récentes que E sont donc défaites aussi.
 *
 * ── Écran Planches (ecrans/plan) ─────────────────────────────────────────────────────────────
 *
 * Appui long : pointerdown sur une ligne d'emplacement (data-testid="ligne-plan",
 *   data-sorte="emplacement"), hors barre et hors étiquette, tenu DELAI_APPUI_LONG_MS sans
 *   bouger de plus de 10 px → le formulaire s'ouvre en création, depart = { emplacementId: la
 *   planche, semaine: la semaine sous le doigt ('AAAA-Www'), saisonId: la saison affichée }.
 *   Semaine sous le doigt : semaines[⌊(clientX − gauche de la ligne (getBoundingClientRect) −
 *   LARGEUR_ETIQUETTE_PX) ÷ LARGEUR_SEMAINE_PX⌋]. Relâché avant : rien. Le menu contextuel
 *   du navigateur ne s'ouvre pas.
 * Bouton « Nouvelle série » (≥ 56 px, toujours visible) : formulaire en création, depart =
 *   { saisonId } (accessible sans appui long).
 * Détail d'une barre de SÉRIE : un bouton « Modifier la série » en plus de « Fermer », qui ouvre
 *   le formulaire en modification. Plantation ou couverture : lecture seule, « Fermer » seul.
 *
 * ── T12b : sélecteur de semaine ──────────────────────────────────────────────────────────────
 *
 * Remplace <input type="week"> (sans sélecteur sur iOS Safari ni Firefox Android). Aucun
 * input[type="week"] dans le document.
 *   - racine role="group", nom accessible « Semaine », data-testid="selecteur-semaine",
 *     data-semaine='AAAA-Www' (la semaine choisie) ;
 *   - libellé visible data-testid="semaine-libelle", aria-live="polite" : « S22 · 31 mai 2027 »
 *     = « S » + numéro ISO sur deux chiffres, « · », le lundi de la semaine (jour, mois court
 *     comme les dates du formulaire : « 4 janv. », « 28 déc. ») et l'année ;
 *   - trois <button type="button"> : « Semaine précédente », « Semaine suivante » (noms
 *     exacts ; passage d'année compris : 2026-W53 → 2027-W01) et un bouton dont le nom commence
 *     par « Choisir la semaine », aria-haspopup="dialog", aria-expanded="true|false" ;
 *   - choix rapide : « Choisir la semaine » ouvre role="dialog" dont le nom commence par
 *     « Choisir la semaine », data-testid="choix-semaines", data-annee=<année affichée> (celle
 *     de la semaine choisie à l'ouverture) ; boutons « Année précédente » et « Année suivante » ;
 *     un bouton data-testid="choix-semaine", data-semaine='AAAA-Www' par semaine ISO de l'année
 *     (52 ou 53), texte « S22 » et la date courte du lundi ; la semaine choisie porte
 *     aria-current="true" et reçoit le focus à l'ouverture (décision 9 : si elle n'est pas
 *     affichée, semaine vide ou invalide, le focus entre quand même dans la feuille, sur son
 *     titre ; Échap la ferme toujours). Liseré de la semaine du jour (.semaine-case-jour, et
 *     l'échantillon de la légende) : orange foncé, contraste ≥ 3:1 sur la feuille et sur la
 *     case, jamais --couleur-orange (#E0701F). Toucher une semaine la choisit, ferme
 *     le choix et rend le focus au bouton « Choisir la semaine ». Échap ferme le choix sans rien
 *     changer et SANS fermer le formulaire ;
 *   - cibles ≥ 56 × 56 px (choix rapide ouvert compris), sans défilement horizontal à 360 px
 *     (e2e).
 *
 * ── T12b : ancre, N1, N2, N3 ─────────────────────────────────────────────────────────────────
 *
 * Libellé de l'ancre : « Récolte à partir de » tient dans son bouton (e2e, 360 et 390 px) : le
 *   texte ne dépasse pas la boîte du <label>, qui garde ≥ 56 px. Le nom accessible du radio
 *   reste « Récolte à partir de ».
 * N1 : en modification, une ancre_date qui n'est pas un lundi (série importée) est gardée tant que
 *   la semaine n'est pas touchée : les dates affichées sont celles de cette ancre, et changer la
 *   longueur (ou une planche) n'écrit ni ancre_date ni prevu_*. Toucher la semaine ramène
 *   l'ancre au lundi de la semaine choisie.
 * N2 (décisions 2 et 8 du chef) : une série dont la variété a été supprimée de la bibliothèque
 *   la GARDE tant que l'itinéraire ne change pas : le formulaire l'affiche (« Grenobloise »),
 *   compte sa germination, et « Enregistrer » n'écrit pas variete_id. Si l'itinéraire change
 *   (le serveur revérifie alors la variété), le formulaire retire la variété et le dit AVANT
 *   d'enregistrer (texte « variété Grenobloise retirée : supprimée de la bibliothèque ») ; la
 *   ligne écrite a variete_id nul. La variété supprimée n'est jamais proposée à la recherche.
 * N3 : rotation_acceptee est effacé (null) à l'enregistrement quand il ne correspond plus :
 *   culture changée (autre espèce), ou plus aucune alerte rouge (orange seule ou rien). Il est
 *   gardé, sans nouvelle question, si l'alerte rouge de la même famille est toujours là.
 *
 * ── T12b : N5, bandeau « Annuler » face à un autre téléphone ─────────────────────────────────
 *
 * Même règle que T24, décision 9 (apps/web/src/ecrans/itineraires/ecritures.ts, `ramener`) :
 *   - colonne par colonne : une ligne (série ou occupation) n'est ramenée que si chaque colonne
 *     que la saisie a changée vaut encore ce qu'elle a écrit et que personne ne l'a supprimée ;
 *     ramenée, seules ces colonnes reprennent leur valeur d'avant (statut, nombre_plants… changés
 *     ailleurs restent) ;
 *   - sinon la ligne reste telle quelle (et les occupations d'une série laissée aussi) ;
 *   - une planche ajoutée ailleurs, qui ne collerait plus aux dates rétablies, bloque le retour
 *     de sa série ; ce qui reste passe toujours validerSerie / validerOccupation ;
 *   - annuler() rend alors un message contenant « modifié entre-temps », que l'écran Planches
 *     affiche (role="alert" ou role="status") ; null si tout a été défait ;
 *   - décision 7 du chef : « Annuler » ne rend jamais active une occupation dont la série n'est
 *     pas active après l'annulation (série supprimée ailleurs : une planche retirée par la
 *     saisie n'est pas ressuscitée) ; ces occupations restent telles quelles, avec le message.
 *
 * ── Amorçage des tests de bout en bout (src/donnees/amorcer.ts) ──────────────────────────────
 *
 * /diagnostic/amorcer.html?jeu=serie : mêmes garde-fous que T11 et T13 (jamais connect(), file
 *   d'envoi vidée), ouvre la base de UTILISATEUR (./ferme-serie.ts) et la remplit par
 *   ecrireFermeSerie(base) si la ferme n'y est pas déjà ; puis window.__amorcage =
 *   { utilisateurId, fermeId, lignes } (lignes = total de ferme-serie).
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

/** D'où part le formulaire. `semaine` : 'AAAA-Www' (semaine ISO, comme `data-semaine` du sélecteur). */
export type DepartSerie =
  | {
      readonly sorte: 'creation';
      readonly emplacementId?: string;
      readonly semaine?: string;
      readonly saisonId?: string;
    }
  | { readonly sorte: 'modification'; readonly serieId: string };

/** Saisie enregistrée, que le bandeau de l'écran Planches peut défaire. */
export interface SaisieSerieAnnulable {
  /** Ce que dit le bandeau : la culture (« Batavia Grenobloise »). */
  readonly texte: string;
  /**
   * Défait la saisie, en une transaction (T12b, N5 : règle de T24, décision 9). Rend null si tout
   * a été défait, sinon le message à montrer, qui contient « modifié entre-temps ».
   */
  annuler(): Promise<string | null>;
}

export interface ProprietesFormulaireSerie {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly depart: DepartSerie;
  readonly surFermer: () => void;
  readonly surEnregistree?: (saisie: SaisieSerieAnnulable) => void;
  /** Jour du téléphone, 'AAAA-MM-JJ' (semaine par défaut sans `depart.semaine`). */
  readonly aujourdhui?: () => string;
  /** Horloge des horodatages et des identifiants ; par défaut () => new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModuleSerie {
  readonly FormulaireSerie: (p: ProprietesFormulaireSerie) => ReactElement;
  readonly default: (p: ProprietesFormulaireSerie) => ReactElement;
  readonly MARQUE_SERIE_AFFICHEE: string;
}

export const MARQUE_SERIE_AFFICHEE_ATTENDUE = 'planif:serie-affichee';

/** Durée de l'appui long sur une case vide du plan. */
export const DELAI_APPUI_LONG_MS = 500;

/** Durée d'affichage du bandeau « Annuler » après un enregistrement (comme T13). */
export const DELAI_ANNULATION_SERIE_MS = 10_000;

/** Constantes de dessin que le module de calculs du plan exporte en plus (T12). */
export interface GeometriePlan {
  readonly LARGEUR_SEMAINE_PX: number;
  readonly LARGEUR_ETIQUETTE_PX: number;
}
