/**
 * Contrat de T24 — écran « Mes itinéraires et mes types d'intervention »
 * (docs/backlog/T24-ecran-itineraires.md). Types et constantes seuls : les tests chargent les
 * modules par import dynamique (chemin tenu dans une variable), leur typage ne dépend pas du code
 * pas encore écrit.
 *
 * Tests : ../ecran.test.tsx (liste, formulaire, aperçu, écritures d'un itinéraire), ../series.test.tsx
 * (modifier un itinéraire utilisé : séries à venir, annulation), ../types.test.tsx (types
 * d'intervention), ../empaquetage.test.ts (chargement à la demande), ../../ferme/itineraires.test.tsx
 * (entrée depuis l'onglet Ferme), apps/web/e2e/itineraires.e2e.ts (build des essais, hors ligne,
 * CPU ×4). Données : ./ferme-itineraires.ts (attendus en tête ; tests d'écran au 2026-09-30).
 *
 * Règles d'écriture : celles du serveur (apps/api/src/sync/itineraire.ts, T23), rejouées par le
 * cœur (validerItineraire, validerTypeIntervention, @planif/core). Dates : le cœur seul
 * (calculerDatesSerie, datesTravailPrevu, lundiDeSemaine…) ; aucune règle réécrite dans l'écran.
 *
 * ── Modules attendus ─────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/itineraires/index.ts — l'écran (ModuleItineraires). Chargé par import
 *   dynamique depuis l'écran Ferme (jamais par un import statique : ni dans le JavaScript de
 *   démarrage, ni dans le morceau de l'écran Ferme). Il reçoit la porte : il n'importe ni
 *   PowerSync ni src/donnees.
 * apps/web/src/ecrans/ferme/EcranFerme.tsx — une ligne (bouton) de nom accessible « Mes
 *   itinéraires » (carte au choix, ≥ 56 px). Active quand etatBase vaut 'prete' et qu'une ferme
 *   est dans ContexteFerme ; désactivée sinon. Un tap charge `import('../itineraires/index.ts')`
 *   et montre EcranItineraires (porte et ferme du contexte) ; surFermer le retire.
 * apps/web/src/donnees/amorcer.ts — `?jeu=itineraires&date=AAAA-MM-JJ` : voir « Amorçage ».
 *
 * ── Écran (DOM) ──────────────────────────────────────────────────────────────────────────────
 *
 * EcranItineraires(ProprietesEcranItineraires), aussi en export par défaut :
 *   - racine role="dialog", aria-modal="true", data-testid="ecran-itineraires", nom accessible
 *     « Mes itinéraires » ; un bouton « Fermer » (appelle surFermer, n'écrit rien) ;
 *   - marque de performance MARQUE_ITINERAIRES_AFFICHES_ATTENDUE, une fois par ouverture, quand
 *     les listes sont dessinées ;
 *   - le focus entre dans le dialogue à l'ouverture (comme T12).
 *
 * Itinéraires : région nommée « Itinéraires » (role="region" ou <section aria-label>) :
 *   - bouton « Nouvel itinéraire » ;
 *   - un élément data-testid="culture-itineraires", data-espece=<id>, par espèce qui a au moins
 *     un itinéraire actif (supprime_le nul) de la ferme ou de la bibliothèque (ferme_id nul) ;
 *     son texte commence par le nom de l'espèce ; espèces dans l'ordre alphabétique français ;
 *   - dedans, un data-testid="itineraire", data-itineraire=<id>, data-origine="ferme" |
 *     "bibliotheque", par itinéraire actif : ceux de la ferme d'abord, puis ceux de la
 *     bibliothèque, chaque groupe par nom ; texte : le nom. Jamais un itinéraire supprimé ;
 *   - itinéraire de la ferme : un bouton « Modifier <nom> » (formulaire en modification) ;
 *   - itinéraire de la bibliothèque : un bouton « Voir <nom> » (formulaire en lecture seule) et
 *     un bouton dont le nom commence par « Adapter pour ma ferme » ; aucun « Modifier ».
 *
 * « Adapter pour ma ferme » N'ÉCRIT RIEN : il ouvre le formulaire en création, prérempli avec la
 *   copie de l'itinéraire de la bibliothèque (même espèce, même variété, mêmes paramètres, travaux
 *   compris), nom « <nom> (ma ferme) » (coupé à 80 caractères au plus). L'enregistrement crée la
 *   copie dans la ferme, en une transaction, avec ce que le maraîcher a changé entre-temps. La
 *   ligne de la bibliothèque n'est jamais écrite.
 *
 * ── Formulaire d'itinéraire (DOM) ────────────────────────────────────────────────────────────
 *
 * Racine role="dialog", data-testid="formulaire-itineraire", nom accessible « Nouvel
 *   itinéraire » (création, adaptation comprise), « Modifier l’itinéraire » (modification) ou
 *   « Itinéraire de la bibliothèque » (lecture seule). Marque MARQUE_ITINERAIRE_AFFICHE_ATTENDUE
 *   une fois par ouverture, quand le formulaire est utilisable (champs et aperçu dessinés).
 *   « Fermer » ferme sans rien écrire.
 * Lecture seule : aucun bouton « Enregistrer », chaque <input>/<select> est désactivé
 *   (disabled), et un bouton dont le nom commence par « Adapter pour ma ferme » (même effet que
 *   dans la liste).
 * Champs (<input> ou <select> par leur nom accessible, <label> ou aria-label) :
 *   - « Nom » (texte) ; « Enregistrer » désactivé si vide après rognage ;
 *   - « Culture » : <select> en création depuis « Nouvel itinéraire » seulement (une option par
 *     espèce active de la ferme et de la bibliothèque, value = id ; variete_id écrit nul) ;
 *     ailleurs, un élément data-testid="culture-itineraire" qui dit l'espèce (l'espèce d'un
 *     itinéraire ne change jamais : décision 8 du chef, T23) ;
 *   - Mode : role="radiogroup" nommé « Mode », radios « Semis direct », « Plant maison »,
 *     « Plant acheté » ;
 *   - durées (jours entiers > 0) : « Pépinière (jours) » (plant maison seulement : absent
 *     sinon), « Avant récolte (jours) » (dureeAvantRecolteJours), « Récolte (jours) »
 *     (fenetreRecolteJours) ;
 *   - densité : en plant maison ou acheté (écartement) : « Rangs par planche », « Écartement sur
 *     le rang (cm) ». En semis direct, un <select> « Façon » (values 'ecartement',
 *     'metre_lineaire', 'volee') puis : écartement → « Rangs par planche », « Écartement sur le
 *     rang (cm) » ; mètre linéaire → « Rangs par planche », « Graines par mètre » ; volée →
 *     « Largeur semée (cm) », « Dose (g/m²) » ;
 *   - « Enregistrer » désactivé tant qu'un champ requis manque ou est invalide.
 * Paramètres écrits : ceux de l'itinéraire d'origine (copie, ou ligne modifiée) avec les champs
 *   du formulaire, les clés non montrées gardées telles quelles (periodeUsage, typeAbri,
 *   margeSecurite, grainesParMotte…, et outil/produit d'un travail non touché). Changer de mode
 *   retire les clés propres à l'ancien mode et pose celles du nouveau (plant maison :
 *   dureePepiniereJours, grainesParMotte 1, plantsParMotte 1, pertePepiniere 0,
 *   alveolesParPlaque null ; semis direct : grainesParPoquet, 1 à l'écartement, null sinon).
 *   Nouvel itinéraire : periodeUsage null, typeAbri null, margeSecurite 10, rendementAttendu
 *   null, perenne null. Toujours une ligne acceptée par validerItineraire (voir « Écritures »).
 *
 * Travaux prévus : région nommée « Travaux prévus » :
 *   - un role="group", data-testid="travail-prevu", data-indice=<i> (0, 1…, ordre de
 *     travauxPrevus), aria-label « Travail <i+1> », par travail ; dedans :
 *       · <select> « Type » : première option vide (value '') pour un travail sans type, puis une
 *         <option> par type d'intervention VISIBLE : ceux de la ferme non supprimés et NON
 *         masqués, et ceux de la liste de départ (ferme_id nul) non supprimés ; plus, s'il est
 *         masqué, le type du travail lui-même (un travail existant ne perd jamais son type).
 *         value = id de la ligne type_intervention, data-categorie, data-libelle ; texte : le
 *         libellé (des <optgroup> par catégorie sont bienvenus). Un travail existant a pour
 *         valeur l'id du type (catégorie, libellé exact). Choisir un type pose
 *         travail.categorie et travail.type = libellé exact de la ligne ;
 *       · « Jours » (entier ≥ 0, la valeur absolue du décalage), « Avant ou après » (<select>,
 *         values 'avant' | 'apres' ; décalage 0 → 'apres'), « Repère » (<select>, values
 *         'semis_pepiniere' (plant maison seulement), 'mise_en_place', 'debut_recolte',
 *         'fin_recolte'). decalageJours = −Jours avant, +Jours après ;
 *       · « Répéter » (case à cocher) ; cochée : « Période (jours) » (tousLesJours) et « Fin de
 *         la répétition » (<select> de repères, repereFin) ; décochée : repetition null ;
 *       · « Temps estimé (min) » (vide = tempsEstime null) et « Par » (<select>, values
 *         'cent_metres' | 'planche') ;
 *       · type en fertilisation ou amendement : « Produit » (texte), « Quantité » (nombre > 0),
 *         « Unité » (texte), obligatoires (validerSaisie les exige) ; ailleurs, absents ;
 *       · « Outil » (texte, facultatif, vide = null) ;
 *       · un bouton « Retirer ce travail » ;
 *       · s'il a un type et qu'il ne tombe JAMAIS (datesTravailPrevu vide pour la série
 *         d'exemple, ce qui ne dépend pas de la date d'ancre) : un élément
 *         data-testid="travail-jamais" dont le texte contient « jamais ». L'enregistrement reste
 *         possible (le cœur l'accepte) : l'écran signale, il ne bloque pas ;
 *   - un bouton « Ajouter un travail » : un nouveau groupe à la fin, sans type, Jours 0, après,
 *     mise en place, sans répétition ni temps. « Enregistrer » désactivé tant qu'un travail n'a
 *     pas de type.
 *
 * Aperçu (sans bouton « calculer », recalculé à chaque changement) : élément
 *   data-testid="apercu-itineraire", data-mise-en-place=<date d'ancre de la série d'exemple> :
 *   - série d'exemple : ancre 'semis' en semis direct, 'plantation' sinon ; date = le lundi de la
 *     semaine ISO periodeUsage.semaineDebut (lundiDeSemaine) de l'année d'aujourd'hui s'il est ≥
 *     aujourd'hui, sinon de l'année suivante ; sans periodeUsage : le premier lundi strictement
 *     après aujourd'hui. Au 2026-09-30 : « Batavia » (S18) → 2027-05-03 ;
 *   - un data-testid="apercu-etape", data-etape="semisPepiniere|miseEnPlace|debutRecolte|
 *     finRecolte", data-date, par étape de calculerDatesSerie ;
 *   - un data-testid="apercu-travail", data-indice=<i>, data-dates="AAAA-MM-JJ,AAAA-MM-JJ"
 *     (datesTravailPrevu, dans l'ordre ; '' s'il ne tombe jamais) par travail qui a un type ;
 *     texte : le libellé et les dates lisibles.
 *
 * ── Écritures : une saisie = UNE transaction (porte.ecrireEnsemble) ──────────────────────────
 *
 * Jamais d'écriture dans `modification` (le serveur seul), jamais de DELETE ni de REPLACE sur
 * itineraire, type_intervention, serie ou occupation (suppression douce), jamais d'écriture sur
 * une ligne à ferme_id nul (bibliothèque, liste de départ). Identifiants : UUID v7. Horodatages
 * (cree_le, modifie_le, supprime_le) : maintenant().toISOString().
 * Chaque ligne `itineraire` écrite (état final) est acceptée par validerItineraire(ligne,
 *   { typesIntervention }) avec typesIntervention = les (categorie, type: libelle) des types non
 *   supprimés de la ferme (masqués compris) et de la liste de départ ; chaque ligne
 *   `type_intervention` par validerTypeIntervention. Le texte de `parametres` est du JSON ;
 *   travauxPrevus y est rangé normalisé (toutes les clés, null pour les facultatives absentes :
 *   la sortie de validerTravauxPrevus).
 * Création (« Nouvel itinéraire » ou adaptation) : INSERT itineraire (id, ferme_id, espece_id,
 *   variete_id, nom rogné, mode, parametres, cree_le, modifie_le, supprime_le null).
 * Modification : UPDATE itineraire des colonnes changées et modifie_le, jamais espece_id ni
 *   ferme_id.
 *
 * ── Modifier un itinéraire utilisé ───────────────────────────────────────────────────────────
 *
 * Séries À VENIR d'un itinéraire : itineraire_id = lui, supprime_le nul, statut 'prevue', aucun
 *   événement en vigueur 'realise' ni 'recolte' sur la série (ni annulé, ni corrigé, ni une
 *   annulation : règle de l'écran Aujourd'hui), et première date prévue (semis en pépinière,
 *   sinon mise en place) ≥ aujourd'hui. Toutes les autres (passées, terminées, commencées,
 *   supprimées, dont la première date est passée) NE BOUGENT JAMAIS.
 * Enregistrer une modification qui change `parametres` (le nom seul ne compte pas) d'un
 *   itinéraire qui a N ≥ 1 séries à venir ouvre d'abord une confirmation : role="alertdialog"
 *   (ou "dialog"), data-testid="confirmation-series", nommée « Appliquer aux N séries à venir ? » (N = 1 : « Appliquer à la série à
 *   venir ? ») ; dedans, un data-testid="serie-a-venir", data-serie=<id>, par série à venir
 *   (texte : culture, code de planche, date de mise en place lisible), par mise en place ;
 *   trois boutons :
 *   - « Appliquer aux séries » : UNE transaction : UPDATE itineraire, puis pour chaque série à
 *     venir UPDATE serie (parametres = EXACTEMENT le texte JSON écrit dans itineraire.parametres,
 *     l'instantané fidèle ; prevu_semis_pepiniere (null sans pépinière), prevu_mise_en_place,
 *     prevu_debut_recolte, prevu_fin_recolte = calculerDatesSerie(nouveaux paramètres, ancre
 *     inchangée : ancre_type, ancre_date) ; modifie_le), et UPDATE de ses occupations actives
 *     (prevu_du = mise en place, prevu_au = fin de récolte, modifie_le). Chaque série écrite est
 *     acceptée par validerSerie, chaque occupation par validerOccupation(o, série,
 *     { datesDeLaSerie: true }) ;
 *   - « Itinéraire seul » : UNE transaction, l'itinéraire seul ; aucune série ne bouge ;
 *   - « Revenir » : rien n'est écrit, le formulaire reste ouvert.
 *   Sans série à venir (ou si seul le nom change) : pas de confirmation, l'itinéraire seul.
 *
 * ── Annuler ──────────────────────────────────────────────────────────────────────────────────
 *
 * Après chaque enregistrement (itinéraire ou type), l'écran montre data-testid="saisie-annulable",
 *   role="status" (texte : le nom de l'itinéraire ou le libellé du type), avec un bouton
 *   « Annuler », pendant DELAI_ANNULATION_ITINERAIRE_MS ; puis il disparaît. « Annuler » défait
 *   la saisie en UNE transaction, même hors ligne :
 *   - création d'un itinéraire : supprime_le posé (suppression douce) ;
 *   - modification : l'itinéraire, et les séries et occupations mises à jour avec lui, reviennent
 *     exactement à leurs valeurs d'avant (hors modifie_le) ;
 *   - type ajouté : supprime_le posé ; type renommé ou masqué : valeurs d'avant.
 *
 * ── Décisions du chef après la relecture (tests : ../relecture.test.tsx) ─────────────────────
 *
 * 9.  « Annuler » ne ramène que les colonnes que l'écriture a changées, et seulement si leur valeur
 *     actuelle est encore celle que nous avions écrite ; sinon l'annulation de CETTE ligne est
 *     refusée (les autres lignes sont défaites) et un message role="alert" (ou status) dit
 *     « modifié entre-temps sur un autre téléphone ». Itinéraire, séries et occupations.
 * 10. Série « à venir » : aucune intervention en vigueur non plus (un travail déjà fait).
 * 11. « À venir » revérifié dans la transaction : une série commencée entre-temps n'est pas écrite.
 * 12. 1 (itinéraire) + séries + occupations > ECRITURES_MAX_PAR_LOT : la confirmation contient
 *     « trop de séries » et « Itinéraire seul » avant toute écriture ; « Appliquer aux séries »
 *     n'écrit rien (désactivé ou sans effet) ; « Itinéraire seul » reste possible.
 *
 * ── Types d'intervention (DOM) ───────────────────────────────────────────────────────────────
 *
 * Région nommée « Types d’intervention » :
 *   - un data-testid="type-intervention", data-type=<id>, data-origine="ferme" | "depart",
 *     data-masque="oui" | "non", data-utilise="oui" | "non", par type non supprimé de la ferme
 *     et de la liste de départ ; texte : le libellé (et « utilisé » pour un type utilisé) ;
 *   - « Utilisé » (décision 3 du chef, T23) : (categorie, libellé exact) présent dans les
 *     travaux prévus d'un itinéraire NON SUPPRIMÉ de la ferme ;
 *   - type de la liste de départ : aucun bouton (lecture seule ; masquer un type de départ pour
 *     une ferme est hors périmètre, décision du chef) ;
 *   - type de la ferme : « Renommer <libellé> » s'il n'est pas utilisé (absent s'il l'est) ;
 *     « Masquer <libellé> » s'il est visible, « Afficher <libellé> » s'il est masqué ;
 *   - ajout : <select> « Catégorie » (values travail_sol, couverture, fertilisation, amendement,
 *     entretien), champ « Nouveau type », bouton « Ajouter le type » ;
 *   - renommer : un dialogue dont le nom commence par « Renommer », champ « Libellé » prérempli,
 *     boutons « Enregistrer » et « Fermer ».
 * Libellé (ajout et renommage), AVANT tout envoi : normalisé comme le cœur (libelleType : NFC,
 *   espaces de bord ordinaires et insécables rognés) ; refusé, sans rien écrire, avec un message
 *   role="alert" dans la région ou le dialogue :
 *   - doublon, sans tenir compte de la casse, d'un type actif de la même catégorie (ferme, masqué
 *     compris, ou liste de départ ; lui-même exclu pour un renommage) : message qui contient
 *     « existe déjà » ;
 *   - caractère de contrôle ou de largeur nulle (U+200B à U+200D, U+2060, U+FEFF) : message qui
 *     contient « caractère » ;
 *   - plus de 30 caractères une fois rogné : message qui contient « 30 » ;
 *   - vide : « Ajouter le type » (ou « Enregistrer ») désactivé.
 * Écritures : ajout = INSERT type_intervention (id, ferme_id, categorie, libelle normalisé,
 *   masque 0, cree_le, modifie_le, supprime_le null) ; renommer = UPDATE libelle, modifie_le ;
 *   masquer / afficher = UPDATE masque 1 / 0, modifie_le. Un type masqué disparaît des listes
 *   « Type » des travaux (sauf pour le travail qui l'a déjà), jamais des itinéraires.
 *
 * Cibles tactiles (e2e) : toute commande de l'écran et du formulaire ≥ 56 × 56 px (boutons,
 *   champs, <select>, cases à cocher et radios ou leur <label>), contraste AA ; à 360 px de
 *   large, aucun défilement horizontal.
 *
 * ── Amorçage des tests de bout en bout (src/donnees/amorcer.ts) ──────────────────────────────
 *
 * /diagnostic/amorcer.html?jeu=itineraires&date=AAAA-MM-JJ : mêmes garde-fous que T11, T12 et
 *   T13 (jamais connect(), file d'envoi vidée) ; date invalide → erreur publiée. Ouvre la base de
 *   UTILISATEUR (./ferme-itineraires.ts) et la remplit par ecrireFermeItineraires(base, date) si
 *   la ferme n'y est pas déjà ; puis window.__amorcage = { utilisateurId, fermeId, lignes }
 *   (lignes = fermeItineraires(date).total).
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

export interface ProprietesEcranItineraires {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** Jour du téléphone, 'AAAA-MM-JJ' (séries à venir, série d'exemple de l'aperçu). */
  readonly aujourdhui?: () => string;
  /** Horloge des horodatages et des identifiants ; par défaut () => new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModuleItineraires {
  readonly EcranItineraires: (p: ProprietesEcranItineraires) => ReactElement;
  readonly default: (p: ProprietesEcranItineraires) => ReactElement;
  readonly MARQUE_ITINERAIRES_AFFICHES: string;
  readonly MARQUE_ITINERAIRE_AFFICHE: string;
}

/** Marque posée quand l'écran (les listes) est dessiné. */
export const MARQUE_ITINERAIRES_AFFICHES_ATTENDUE = 'planif:itineraires-affiches';

/** Marque posée quand le formulaire d'un itinéraire est utilisable. */
export const MARQUE_ITINERAIRE_AFFICHE_ATTENDUE = 'planif:itineraire-affiche';

/** Durée d'affichage du bandeau « Annuler » après un enregistrement (comme T12 et T13). */
export const DELAI_ANNULATION_ITINERAIRE_MS = 10_000;
