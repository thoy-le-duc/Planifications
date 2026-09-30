/**
 * Contrat de T13 — saisie terrain hors ligne : écran « Aujourd'hui », réalisé et récolte
 * (docs/backlog/T13-saisie-terrain.md). Types seuls : les tests chargent l'écran par import
 * dynamique (chemin tenu dans une variable), leur typage ne dépend pas du code pas encore écrit.
 *
 * Tests : ../ecran.test.tsx (DOM simulé, base mémoire), ../empaquetage.test.ts (chargement à la
 * demande), apps/web/e2e/aujourdhui.e2e.ts (build de production, hors ligne, CPU ×4).
 * Données : ./ferme-du-jour.ts (ferme datée relativement au jour, attendus chiffrés en tête).
 *
 * ── Module attendu ───────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/aujourdhui/index.ts — l'écran (ModuleEcranAujourdhui), chargé par import
 *   dynamique depuis App.tsx (onglet « Aujourd'hui », premier écran de la coquille de T16, à la
 *   place du texte « Bientôt »), jamais par un import statique. Il reçoit la porte (ContexteFerme,
 *   comme l'onglet Planches) : il n'importe ni PowerSync ni src/donnees. Sans ferme ouverte,
 *   l'onglet montre un texte d'attente propre (comme Planches), jamais « Bientôt ».
 *
 * ── Règles (lecture) ─────────────────────────────────────────────────────────────────────────
 *
 * Tâches : `semainier` de T06 (packages/core/src/planification/semainier.ts, à exporter par
 *   @planif/core ; aucune règle réécrite dans l'écran) pour la semaine ISO d'aujourd'hui, même
 *   ordre (en retard d'abord). Réalisés tirés du journal EN VIGUEUR (ni annulés, ni corrigés, ni
 *   les annulations elles-mêmes : même règle que la vue evenements_en_vigueur de @planif/db) :
 *   réalisé 'semis_pepiniere' → semisPepiniere ; 'semis_direct' ou 'plantation' → miseEnPlace ;
 *   'arrachage' → finRecolte ; première récolte d'une série → debutRecolte ; première récolte
 *   d'une campagne → sa date dans `realises.campagnes`. Mode de la série : serie.parametres.mode.
 * Récoltes en cours (proposées à l'étape 1 de la récolte) : les séries 'prevue' ou 'en_cours'
 *   dont la fenêtre de récolte contient aujourd'hui (du début de récolte recalé par les réalisés
 *   à la fin prévue) et qui ne sont pas arrachées, et les campagnes dont
 *   [debut_recolte_prevu, fin_recolte_prevue] contient aujourd'hui (plantation non arrachée).
 *   Ferme du jour : la tomate et la fraise, rien d'autre.
 * Unité préremplie : espece.unite_recolte de la culture (série → son espèce ; campagne → espèce
 *   de sa plantation). La colonne est NOT NULL dans le schéma : toujours une unité.
 *
 * ── Règles (écriture) : tout passe par la porte, en ajout seul ───────────────────────────────
 *
 * Aucune écriture ne modifie ni ne supprime une ligne de `evenement` ou de `mouvement_stock`
 * (jamais d'UPDATE ni de DELETE sur ces tables). Toutes les écritures passent par la porte de
 * @planif/sync, donc par la file d'envoi de PowerSync (ps_crud). Chaque ligne `evenement` écrite
 * est acceptée telle quelle par `validerSaisie` de @planif/core (celle que le serveur rejoue).
 * Une saisie = UNE transaction locale (c'est ce que compte « N saisies en attente »).
 *
 * « Fait » (un geste) : événement type 'realise', date = aujourd'hui, source 'tap', serie_id (ou
 *   campagne_id) de la tâche, emplacement_ids = emplacements de la tâche, detail =
 *   { etape, quantiteReelle: null }, remplace_* nuls. Pas d'écran de confirmation (saisie
 *   manuelle, principe 3) ; « Annuler » à la place. Une tâche 'debut_recolte' n'a pas de « Fait » :
 *   son bouton ouvre la récolte, culture déjà choisie (maquette : « Peser »).
 * Changer la date (après coup, depuis l'historique) : événement de CORRECTION du même type
 *   (remplace_sorte 'correction', remplace_evenement_id = l'événement en vigueur), même culture,
 *   mêmes emplacements, même détail, nouvelle date.
 * Récolte (trois gestes : culture → quantité → Valider ; l'unité est préremplie) : événement
 *   type 'recolte', date = aujourd'hui, source 'tap', culture choisie, emplacement_ids = ceux de
 *   la culture (occupations non supprimées), detail = { quantite, unite, categorie: null } ; ET,
 *   dans la MÊME transaction, un mouvement de stock : article_stock_id = l'article de la ferme de
 *   même (espece_id, variete_id, unite, categorie nulle), créé dans la même transaction s'il
 *   n'existe pas ; quantite = +quantité, motif 'recolte', recolte_id = l'événement, date =
 *   aujourd'hui.
 * Annuler (bandeau des 10 s ou historique) : événement d'ANNULATION du même type
 *   (remplace_sorte 'annulation', remplace_evenement_id = l'événement annulé), même culture et
 *   emplacements, détail valide (celui de l'événement annulé) ; pour une récolte, dans la même
 *   transaction, un mouvement inverse : même article, quantite = −quantité, motif 'recolte',
 *   recolte_id = l'événement d'ANNULATION (un mouvement par événement, voir le rapport du testeur).
 *   Effet : la saisie disparaît de l'historique ; une tâche redevient à faire ; le stock (somme
 *   des mouvements) revient à sa valeur d'avant.
 *
 * ── Écran (DOM) ──────────────────────────────────────────────────────────────────────────────
 *
 * EcranAujourdhui({ porte, fermeId, aujourdhui? }) — `aujourdhui` rend 'AAAA-MM-JJ' (défaut : jour
 *   du téléphone). Aussi en export par défaut.
 *   - racine data-testid="aujourdhui" ;
 *   - tâches : data-testid="tache", data-cle="<id série ou campagne>:<étape>", data-retard=
 *     "oui|non", dans l'ordre du semainier ; texte : nom de la culture, code(s) d'emplacement,
 *     et pour une tâche en retard « N jours de retard » (« 1 jour de retard ») ; intitulés de
 *     groupe « En retard » et « Cette semaine » (maquette Main) ; bande de couleur à gauche,
 *     data-testid="bande-famille" (CarteTache de T16), orange (COULEURS.orange) pour le retard ;
 *     bouton « Fait » sur la forêt (COULEURS.foret), texte COULEURS.surForet ;
 *   - bouton d'action de la tâche : nom accessible commençant par « Marquer fait » (étapes
 *     réalisables) ou « Saisir une récolte » (début de récolte) ;
 *   - bouton « Noter une récolte » (nom accessible commençant ainsi), toujours présent ;
 *   - récolte : role="dialog", nom accessible commençant par « Récolte » ; bouton « Retour »
 *     (ferme sans rien écrire) ;
 *       étape 1 (sautée si ouverte depuis une tâche) : un bouton data-testid="choix-recolte",
 *         data-cible=<id série ou campagne> par récolte en cours, texte = culture (et variété,
 *         code) ;
 *       étape 2 : la culture choisie est écrite dans le dialogue (maquette : « T2-P01 · RADIS
 *         FLAMBOYANT ») ; affichage data-testid="quantite" (les chiffres tapés), pavé : boutons nommés
 *         « 0 » … « 9 », « Effacer » et la virgule (bouton de texte « , », nom accessible « , » ou
 *         « Virgule », à la place du micro de la maquette) ; unité : role="radiogroup" nommé « Unité », un radio par
 *         unité, nommés « kg », « Bottes », « Pièces », « Barquettes », coché d'après la culture ;
 *         bouton de validation nommé « Valider <quantité> <unité> » (« Valider 12 kg »), désactivé
 *         tant que la quantité est vide ou nulle. Valider écrit tout de suite, sans confirmation,
 *         et ferme la récolte ;
 *       virgule : décimale à la française. 1, 2, « , », 5 affiche « 12,5 », bouton « Valider
 *         12,5 kg », écrit detail.quantite = 12.5 et un mouvement de +12.5. Une deuxième virgule
 *         est ignorée ; « , » en premier affiche « 0, » ; deux décimales au plus, les chiffres
 *         suivants sont ignorés (1,234 → « 1,23 ») : le centième de kilo (10 g) est la
 *         résolution des balances de terrain, et couvre les bottes ou pièces sans gêner (on y
 *         tape rarement une virgule). La quantité écrite est le nombre décimal exact de ce qui
 *         est affiché (jamais 12.499999…) ;
 *   - après chaque saisie (Fait, récolte) : data-testid="saisie-annulable", role="status", texte
 *     qui dit la saisie (culture ; « 12 kg » pour une récolte), avec un bouton « Annuler » ; il
 *     disparaît 10 s après la saisie (compté avec setTimeout / setInterval ou Date.now : les
 *     tests avancent une horloge simulée), une nouvelle saisie remplace la précédente ;
 *   - historique : région nommée « Historique » (role="region" ou <section aria-label>), visible
 *     sur l'écran ou ouverte par un bouton « Historique » ; au moins les saisies en vigueur des
 *     7 derniers jours, la plus récente (horodatage) d'abord ; une entrée par saisie :
 *     data-testid="saisie-historique", data-evenement=<id de l'événement en vigueur>, data-type=
 *     "realise|recolte", texte = culture (et « 12 kg » pour une récolte), boutons « Annuler » et
 *     « Changer la date » ;
 *   - « Changer la date » : role="dialog" nommé « Changer la date », champ date (<input
 *     type="date">) libellé « Date », bouton « Enregistrer » ;
 *   - cibles tactiles (e2e) : toute commande de saisie ≥ 56 × 56 px (Fait, Saisir une récolte,
 *     Noter une récolte, choix de culture, touches du pavé, unités, Valider, Annuler, Retour,
 *     Historique, Changer la date, Enregistrer) ; contraste AA de leur texte sur leur fond
 *     (4,5:1, 3:1 au-delà de 24 px ou 18,66 px gras) ; touches du pavé en police ≥ 28 px,
 *     quantité affichée ≥ 64 px (maquette Saisie : 30 px et 84 px) ;
 *   - marque de performance 'planif:aujourdhui-affiche' (une fois par ouverture de l'écran),
 *     posée quand les tâches (ou l'état « rien à faire ») sont dessinées ;
 *   - l'écran suit la base (porte.surveiller) : une saisie arrivée par la synchro s'y voit.
 *
 * ── Indicateur des saisies en attente ────────────────────────────────────────────────────────
 *
 * Celui de la coquille (T11, data-testid="etat-synchro", libelleSynchro) : hors ligne, après un
 *   « Fait » et une récolte, « Hors ligne · 2 saisies en attente » ; après une annulation,
 *   « 3 saisies en attente ». Une saisie = une transaction (événement + mouvement + article).
 *
 * ── Amorçage des tests de bout en bout (src/donnees/amorcer.ts) ──────────────────────────────
 *
 * /diagnostic/amorcer.html?jeu=aujourdhui&date=AAAA-MM-JJ : même page et mêmes garde-fous que
 *   T11 (jamais connect(), file d'envoi vidée, titre « Amorçage de la base locale (tests) »),
 *   mais ouvre la base de UTILISATEUR (./ferme-du-jour.ts) et la remplit par
 *   ecrireFermeDuJour(base, date) si la ferme n'y est pas déjà ; puis window.__amorcage =
 *   { utilisateurId, fermeId, lignes } (lignes = FermeDuJour.total). Sans paramètre `jeu` : le
 *   jeu de T07, inchangé (e2e/plan.e2e.ts).
 *
 * ── Corrections de la relecture (tests : ../relecture.test.tsx, e2e/aujourdhui.e2e.ts,
 *    e2e/habillage.e2e.ts) ────────────────────────────────────────────────────────────────────
 *
 * B1 — Culture retirée (série ou campagne supprimée, culture === null) : l'entrée de
 *   l'historique n'a ni « Annuler » ni « Changer la date », et porte le texte
 *   TEXTE_CULTURE_RETIREE.
 * B2 — Emplacements : seuls les emplacements actifs (supprime_le nul, actif_du ≤ jour, actif_au
 *   nul ou > jour) sont écrits. Nouvelle saisie : occupations non supprimées d'emplacements
 *   actifs. Annulation, correction : les emplacements de l'événement remplacé, relus dans la
 *   base locale, moins ceux qui ne sont plus actifs. Aucun actif : liste vide (validerSaisie
 *   l'accepte).
 * B3 — Jour du téléphone : recalculé à chaque écriture (date d'un « Fait », d'une récolte, borne
 *   de « Changer la date ») ; au retour au premier plan (visibilitychange, document visible),
 *   l'écran passe au nouveau jour (semainier, date par défaut).
 * Double « Fait » : la tâche quitte la liste, ou son bouton est désactivé, dès le tap, sans
 *   attendre l'écriture ni la relecture ; un second tap n'écrit rien.
 * Récolte sans aucun mouvement dans sa chaîne (saisie d'avant T13) : changer sa date n'écrit
 *   que la correction, ni article ni mouvement. (Son annulation n'en écrit pas non plus.)
 * Focus : les dialogues « Récolte » et « Changer la date » prennent le focus à l'ouverture, le
 *   gardent (Tab sur le dernier élément focalisable → le premier ; Maj+Tab sur le premier → le
 *   dernier) et le rendent à l'élément qui les a ouverts à la fermeture.
 * Noms accessibles : dans l'historique, « Annuler : <saisie> » et « Changer la date : <saisie> »,
 *   où <saisie> nomme le type, la quantité et la culture (« Annuler : Récolte 12 kg, Tomate »,
 *   « Annuler : Plantation, Chou pointu ») ; deux entrées n'ont jamais le même nom. Le bouton du
 *   bandeau reste « Annuler ».
 * e2e : temps des taps en médiane de 5 (repeterMesure, décision T20) ; la mesure « appli prête »
 *   est celle de e2e/demarrage.e2e.ts, pas répétée ici.
 *
 * ── T22 : travaux prévus des itinéraires (tests : ../travaux.test.tsx, e2e/aujourdhui.e2e.ts) ──
 *
 * Données : ferme du jour « avec travaux » (fermeDuJour(jour, { travaux: true }), en-tête de
 *   ./ferme-du-jour.ts). Les travaux sont lus dans `serie.parametres.travauxPrevus` (instantané),
 *   passés au semainier (SerieSemainier.travauxPrevus) avec les interventions en vigueur de la
 *   série (RealisesSemainier.interventions : date, detail.categorie, detail.type ; ni annulées,
 *   ni corrigées, ni les annulations elles-mêmes) ; aucune règle réécrite dans l'écran
 *   (retards, soldes, caducité, temps : le cœur, contrat-travaux.ts).
 * Tâche de travail : data-testid="tache", data-cle="<id série>:travail:<indice>:<AAAA-MM-JJ>"
 *   (cleTravail ; la date est la date prévue de l'occurrence affichée, `datePrevue` de la tâche
 *   du semainier, celle de la ligne en retard pour une tâche en retard), data-retard comme T13,
 *   dans l'ordre du semainier, mêlée aux étapes. Deux cartes n'ont jamais la même clé.
 *   Amendement de la relecture (décision du chef) : l'ancienne clé `<id série>:travail:<indice>`
 *   était la même pour les deux cartes d'un travail répété (sa ligne en retard et une occurrence
 *   plus loin dans la semaine) ; « Marquer fait » sur l'une masquait les deux. « Marquer fait »
 *   sur la carte en retard ne masque que celle-là : l'intervention du jour solde l'occurrence la
 *   plus proche et les précédentes, l'occurrence à venir reste (ferme du jour { travaux: true,
 *   arrosage: true } : arrosage de la tomate, J−1 en retard et J+2). Elle montre :
 *   - la catégorie en surtitre : élément data-testid="surtitre", texte LIBELLES_CATEGORIES
 *     (« Travail du sol », « Amendement », « Entretien »…) ;
 *   - le libellé du type (« grelinette »), la culture, le(s) code(s) d'emplacement ;
 *   - le temps estimé quand il existe : data-testid="temps-estime", texte texteDuree(minutes)
 *     (« 6 min », « 1 h 05 ») ; absent sans estimation ;
 *   - « N jours de retard » comme T13 ; bande orange du retard ;
 *   - un bouton dont le nom accessible commence par « Marquer fait ».
 * « Fait » (un geste, sans confirmation, une transaction) : événement type 'intervention', date
 *   = aujourd'hui, source 'tap', serie_id de la tâche, campagne_id nul, emplacement_ids = ceux de
 *   la tâche (règle B2), remplace_* nuls, detail = { categorie, type (le libellé), outil (ou
 *   null) }, plus { produit: produit.nom, quantite: produit.quantite } en fertilisation /
 *   amendement ; accepté par validerSaisie. La tâche quitte la liste (le semainier la solde).
 *   Bandeau « Annuler » 10 s comme T13 (texte : le libellé et la culture) ; annulation =
 *   événement 'intervention' d'annulation, même détail ; la tâche revient. Historique : entrée
 *   data-type="intervention", texte avec le libellé et la culture, bouton « Annuler » (nom
 *   accessible « Annuler : <libellé>, <culture> » ou tout nom commençant par « Annuler »).
 * Pastille de charge de la semaine : data-testid="charge-semaine", texte texteCharge(minutes)
 *   (« 1 h 24 de travail », « 45 min de travail », « 6 h de travail ») = chargeSemaine du cœur
 *   sur les tâches affichées ; recalculée après chaque saisie ; ABSENTE quand la charge vaut 0.
 * Cibles ≥ 56 × 56 px pour « Marquer fait » d'une tâche de travail (e2e).
 * Amorçage : /diagnostic/amorcer.html?jeu=aujourdhui-travaux&date=AAAA-MM-JJ : comme
 *   ?jeu=aujourdhui, avec ecrireFermeDuJour(base, date, { travaux: true }) ;
 *   window.__amorcage.lignes = fermeDuJour(date, { travaux: true }).total.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ReactElement } from 'react';

export interface ProprietesEcranAujourdhui {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui?: () => string;
}

export interface ModuleEcranAujourdhui {
  readonly EcranAujourdhui: (p: ProprietesEcranAujourdhui) => ReactElement;
  readonly default: (p: ProprietesEcranAujourdhui) => ReactElement;
  readonly MARQUE_AUJOURDHUI_AFFICHE: string;
}

export const MARQUE_AUJOURDHUI_ATTENDUE = 'planif:aujourdhui-affiche';

/** Libellés des unités de récolte dans le sélecteur (radios du groupe « Unité »). */
export const LIBELLES_UNITES: Readonly<Record<'kg' | 'botte' | 'piece' | 'barquette', string>> = {
  kg: 'kg',
  botte: 'Bottes',
  piece: 'Pièces',
  barquette: 'Barquettes',
};

/** Durée d'affichage du bouton « Annuler » après une saisie. */
export const DELAI_ANNULATION_MS = 10_000;

/** Texte d'une saisie de l'historique dont la culture est retirée (relecture B1). */
export const TEXTE_CULTURE_RETIREE = 'Culture retirée : correction impossible depuis le téléphone';
