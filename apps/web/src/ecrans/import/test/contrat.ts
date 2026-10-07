/**
 * Contrat de T14b — import d'un tableur, le parcours à l'écran (docs/backlog/T14b-import-ecrans.md),
 * habillé comme la maquette « Import » (docs/maquettes/Import.dc.html). Types et constantes seuls :
 * les tests chargent les modules par import dynamique (chemin tenu dans une variable), leur typage
 * ne dépend pas du code pas encore écrit.
 *
 * Tests :
 *   ../parcours.test.tsx      critère 1 : chaque fichier du jeu de T14, de bout en bout, écrit en base ;
 *   ../annulation.test.tsx    critère 2 : import annulé depuis l'historique (aucune trace), modèle
 *                             enregistré pour la ferme et réutilisé sur un second fichier ;
 *   ../regles.test.tsx        une règle par test : lots ≤ 500 écritures et 5 Mio, zone par défaut, doublons
 *                             contre la base, cellule fautive, avertissements, plafond du
 *                             rapprochement, docs/import/ ;
 *   ../modeles.test.ts        garde à l'exécution sur un modèle relu (relireModele) ;
 *   ../empaquetage.test.ts    écran et lecteur Excel chargés à la demande, Worker de préparation ;
 *   ../entree.test.tsx        l'entrée « Importer un tableur » de l'onglet Ferme ;
 *   apps/web/e2e/import.e2e.ts  critères 1 et 3 dans un vrai navigateur (CPU ×4, hors ligne).
 * Données : ./ferme-import.ts (la ferme neuve où l'on importe). Gestes : ./harnais.ts.
 *
 * Règles : le moteur de T14 (`@planif/core`, packages/core/src/import) fait TOUT le calcul
 * (lecture, en-tête, type proposé, correspondance, normalisation, rapprochement, doublons du
 * fichier, avertissements). L'écran ne réécrit aucune de ses règles ; il ajoute seulement ce qui
 * demande la base : doublons contre la base, emplacements et zones existants, saisons.
 *
 * ── Modules attendus ─────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/import/index.ts — l'écran (ModuleEcranImport). Chargé par import dynamique
 *   depuis l'écran Ferme, jamais par un import statique. Il reçoit la porte : il n'importe ni
 *   PowerSync ni src/donnees.
 * apps/web/src/ecrans/import/modeles.ts — `relireModele` (garde à l'exécution, voir plus bas).
 * apps/web/src/ecrans/import/preparation.worker.ts — le Web Worker de préparation (nom de fichier
 *   imposé : l'e2e reconnaît le Worker à son URL, /preparation/). Créé par
 *   `new Worker(new URL('./preparation.worker.ts', import.meta.url), { type: 'module' })`. Sans
 *   Worker (tests sous happy-dom : `typeof Worker === 'undefined'`), la préparation tourne sur le
 *   fil principal, même résultat.
 * Lecteur Excel : `packages/core/src/import/xlsx.ts` (`lecteurXlsx`), chargé par `import()` au
 *   dépôt d'un .xlsx seulement (par exemple via une entrée "./import-xlsx" du package.json du
 *   cœur) ; jamais dans le JavaScript de démarrage, ni dans le morceau de l'écran d'import.
 * apps/web/src/ecrans/ferme/EcranFerme.tsx — une ligne (bouton) de nom accessible « Importer un
 *   tableur » (≥ 56 px), active quand etatBase vaut 'prete' et qu'une ferme est dans
 *   ContexteFerme ; un tap charge `import('../import/index.ts')` et montre EcranImport (porte et
 *   ferme du contexte) ; surFermer le retire. (Hors du périmètre écrit du ticket : une ligne,
 *   comme « Mes itinéraires » de T24.)
 * apps/web/src/donnees/amorcer.ts — `?jeu=import` : la ferme de ./ferme-import.ts (dates fixes),
 *   mêmes garde-fous que les autres jeux (utilisateur de test, file d'envoi vidée).
 * docs/import/ — une page en français pour un maraîcher (voir ../regles.test.tsx).
 *
 * ── Écran (DOM) ──────────────────────────────────────────────────────────────────────────────
 *
 * EcranImport(ProprietesEcranImport), aussi en export par défaut :
 *   - racine role="dialog", aria-modal="true", data-testid="ecran-import", nom accessible
 *     « Importer un tableur », attribut data-etape = l'étape en cours (EtapeImport) ; un bouton
 *     « Fermer » (appelle surFermer, n'écrit rien) ; bouton « Retour » aux étapes 2 à 5 ;
 *   - en-tête « IMPORT · ÉTAPE n SUR 5 » comme la maquette (texte libre, non testé) ;
 *   - toutes les cibles ≥ 48 px (e2e), boutons principaux ≥ 56 px.
 *
 * Étape 'depot' (1) :
 *   - <input type="file"> de nom accessible « Choisir un fichier », accept contenant .csv, .tsv,
 *     .txt et .xlsx ; une zone de dépôt data-testid="depot-fichier" (glisser-déposer) ;
 *   - région nommée « Imports récents » : un élément data-testid="import-passe",
 *     data-import=<id stable>, data-etat="actif" | "annule", par import de CETTE ferme (le plus
 *     récent d'abord) ; son texte contient le nom du fichier et le nombre de lignes importées ;
 *     un import actif porte un bouton « Annuler cet import » ; un import annulé n'en a pas et
 *     son texte contient « annulé » ;
 *   - fichier illisible (binaire, trop grand, classeur illisible, aucun en-tête) : role="alert"
 *     avec le message du moteur, on reste à l'étape 1, rien n'est écrit.
 *
 * Étape 'type' (2) — « Dire ce que c'est » :
 *   - role="radiogroup" nommé « Ce fichier contient », radios « Parcellaire », « Cultures et
 *     itinéraires », « Séries », « Assolement passé » (value = TypeContenu) ; le type proposé
 *     par le moteur (proposerType) est coché ; aucun n'est coché s'il n'en propose pas, et
 *     « Continuer » est alors désactivé ;
 *   - un champ <input> « Année de la saison » (nombre), prérempli (décision du chef) avec l'année
 *     de maintenant() de janvier à août, l'année SUIVANTE de septembre à décembre (on prépare
 *     la saison qui vient) ; il sert aux dates en semaines (EntreeImport.anneeSaison) ;
 *   - un modèle d'import de la ferme qui convient aux en-têtes (appliquerModele non nul) impose
 *     son type (coché d'office) et sa correspondance à l'étape 3 ;
 *   - bouton « Continuer ».
 *
 * Étape 'colonnes' (3) — comme la maquette : une ligne par colonne du fichier,
 *   data-testid="colonne-import", data-colonne=<indice à partir de 0>, qui montre l'en-tête et
 *   deux ou trois valeurs d'exemple ; dedans un <select> de nom accessible « Champ pour
 *   « <en-tête> » » : option value="" (« Ignorée ») puis une option par champ du type
 *   (CHAMPS_IMPORT[type], value = CleChamp, texte = libellé). Préréglé sur la correspondance
 *   proposée, ou sur celle du modèle de la ferme quand il s'applique : un élément
 *   data-testid="modele-applique" est alors visible (« Correspondance reprise de votre dernier
 *   fichier »).
 *   - Parcellaire sans colonne associée à « Zone » : un <input> « Zone par défaut », prérempli
 *     d’un nom non vide (au choix : « Ma ferme », le nom de la ferme…) : toutes les lignes y
 *     sont rangées (zone reprise si la ferme en a une de ce nom). Absent dès qu'une colonne est
 *     associée à « Zone ». Vide : « Continuer » désactivé.
 *   - Correspondance refusée par creerModele (champ associé à deux colonnes…) : role="alert"
 *     avec son message, « Continuer » désactivé.
 *   - bouton « Continuer ».
 *
 * Étape 'valeurs' (4) — sautée quand le plan n'a aucune décision :
 *   - un élément data-testid="decision-valeur", data-champ="espece" | "famille",
 *     data-valeur=<valeur telle qu'écrite>, par décision du plan (PlanImport.decisions) ; dedans
 *     un <select> de nom accessible « Culture pour « <valeur> » » (ou « Famille pour
 *     « <valeur> » ») : option value="" (« À choisir »), une option par espèce (ou famille) de
 *     la bibliothèque (value = id), et l'option value="nouvelle" (« Créer « <valeur> » ») ;
 *     préréglé sur la première proposition du moteur s'il y en a une, sinon sur "" ;
 *   - « Continuer » désactivé tant qu'une décision vaut "".
 *   - Plafond (relecture de T14c) : plus de PLAFOND_VALEURS_A_RAPPROCHER valeurs distinctes
 *     (par `cle`) d'espèces ou de familles dans le fichier → role="alert" dont le texte contient
 *     le nombre (« 2 001 cultures différentes… ») ; pas d'étape 4 ni 5 pour ce fichier, rien
 *     n'est écrit, et l'écran ne gèle pas (pas de rapprochement des valeurs au-delà du plafond).
 *
 * Étape 'apercu' (5) — rien n'est écrit avant « Importer » :
 *   - data-testid="apercu-import" ; compteurs data-testid="compteur-valides",
 *     "compteur-erreurs", "compteur-doublons", chacun avec le nombre en chiffres dans son texte ;
 *     à côté des valides, data-testid="compteur-avertissements" (le nombre de lignes valides qui
 *     portent au moins un avertissement), présent seulement s'il y en a ;
 *   - un élément data-testid="ligne-import", data-ligne=<numéro de ligne du fichier>,
 *     data-statut=<StatutLigne>, par ligne en erreur, en doublon ou portant un avertissement
 *     (au moins les 100 premières de chaque sorte ; les lignes valides sans avertissement peuvent
 *     n'être que comptées) ;
 *     · erreur : un data-testid="erreur-import" par erreur, texte = message du moteur, et à côté
 *       un data-testid="cellule-fautive" dont le texte est la cellule du fichier
 *       (`lignes[ligne - 1][colonne]`, chaîne vide si vide) quand l'erreur a une colonne — y
 *       compris pour une zone reprise de la ligne du dessus (la cellule de la ligne où la zone
 *       est écrite) ;
 *     · doublon : texte qui contient « doublon » et, s'il double une ligne de la BASE et non du
 *       fichier, « déjà dans la ferme » ;
 *     · avertissement : un data-testid="avertissement-import" par avertissement, texte = message
 *       du moteur (« plantation en 2028 ») ;
 *   - bouton dont le nom commence par « Importer » (« Importer 4 lignes »), désactivé s'il n'y a
 *     aucune ligne valide ;
 *   - les lignes en erreur, en doublon (fichier ou base) et à décider ne sont PAS écrites.
 *
 * Étape 'fini' : role="status" dont le texte contient « <N> lignes importées » (N = lignes
 *   valides écrites, « 1 ligne importée » au singulier) et un bouton « Annuler cet import » ;
 *   après l'annulation, le statut contient « annulé » et le bouton disparaît ; bouton
 *   « Importer un autre fichier » (retour à l'étape 1).
 *
 * ── Écriture (« Importer ») ──────────────────────────────────────────────────────────────────
 *
 * En LOTS (décision du chef, option A) : la porte refuse plus de ECRITURES_MAX_PAR_LOT (500)
 * ordres par `ecrireEnsemble`, le serveur plus de 500 écritures par lot (`lot_trop_gros` ; plus
 * de 2 000, c'est un 413 qui bloque la synchro) et plus de TAILLE_MAX_PAR_LOT (5 Mio). Donc :
 *   - chaque lot = un `porte.ecrireEnsemble` d'au plus 500 ordres (un ordre = une ligne écrite)
 *     et d'au plus 5 Mio ; « une opération » = un lot ; un import de moins de 500 écritures
 *     tient en UN lot, un import de E écritures en ⌈E / 500⌉ lots ;
 *   - une série est toujours dans le même lot que ses occupations ;
 *   - tous les lots d'un import portent le même identifiant d'import (celui de l'historique) ;
 *   - « Annuler cet import » s'écrit en lots aussi, et nettoie TOUS les lots de l'import.
 * Jamais d'écriture dans `modification` (le serveur l'écrit), jamais de DELETE ni de REPLACE
 * (suppression douce : `supprime_le`). Ids : UUID v7 de la porte ou de @planif/core.
 * Écriture dans la base locale via @planif/sync (périmètre : packages/sync, nouveau fichier, PAS
 * porte.ts ni fait-unique.ts, pris par T13o). Vérifié par `verifierLots` (./harnais.ts).
 *
 * Ce qu'écrit chaque type (lignes valides seulement, ferme_id = la ferme) :
 *   - parcellaire : `zone` (une par nom distinct ; une zone de la ferme de même nom, comparé sans
 *     casse ni accents ni espaces doubles, est REPRISE, pas recréée) ; `sous_zone` → une zone
 *     enfant (zone_parente_id) ; `emplacement` (code, sorte — 'planche' si absente —,
 *     longueur_m, largeur_m, nombre_places, zone_id = la zone la plus basse de la ligne,
 *     actif_du non nul, remplace '[]') ; `type_abri`, `surface_m2` sur la zone de la ligne.
 *     Une ligne sans emplacement crée seulement sa zone.
 *   - cultures : `espece` nouvelle (décision « Créer ») avec sa famille ; `itineraire` de la
 *     ferme par ligne qui porte un mode ou une durée (validerItineraire l'accepte) ; une espèce
 *     existante n'est jamais modifiée.
 *   - series : `serie` + `occupation` sur l'emplacement de la ligne (code d'un emplacement
 *     actif de la ferme ; inconnu → la ligne est en ERREUR dans l'aperçu, « emplacement
 *     inconnu », pas écrite). Sans colonne d'emplacement : la série seule. validerSerie et
 *     validerOccupation acceptent chaque ligne écrite ; les dates du fichier sont les dates
 *     prévues (semis → prevu_semis_pepiniere s'il y a une plantation, sinon prevu_mise_en_place ;
 *     plantation → prevu_mise_en_place ; début et fin de récolte → prevu_debut_recolte,
 *     prevu_fin_recolte quand le fichier les donne). L'itinéraire (itineraire_id non nul) est
 *     un itinéraire de la ferme ou de la bibliothèque, ou un itinéraire de la ferme créé par
 *     l'import (validerItineraire l'accepte) ; une ligne sans durée connue reprend celles de
 *     l'itinéraire de son espèce. saison_id = saison de l'année de la mise en place (créée si
 *     la ferme ne l'a pas : nom 'AAAA', 1er janvier – 31 décembre).
 *   - assolement : `assolement` (saison de l'année, créée si besoin ; emplacement_id ou zone_id
 *     de la ferme ; famille_id et/ou espece_id ; nature 'passe_importe' ; source_import non nul).
 *
 * Doublons contre la base (règle du ticket) : parcellaire, un emplacement de même code
 * (comparé comme les zones) déjà actif dans la ferme ; séries, une série active de même espèce,
 * même emplacement et même mise en place. Statut 'doublon' dans l'aperçu, rien d'écrit.
 *
 * ── Annulation depuis l'historique ───────────────────────────────────────────────────────────
 *
 * « Annuler cet import » (étape 'fini' ou région « Imports récents », même après avoir fermé
 * et rouvert l'écran) : en lots (voir « Écriture »), chaque ligne créée par l'import reçoit supprime_le ;
 * aucune ligne d'avant l'import n'est modifiée. « Aucune trace » : pour chaque table, les lignes
 * actives (supprime_le nul) sont exactement celles d'avant l'import, et aucune ligne nouvelle
 * dans une table sans supprime_le (evenement, mouvement_stock). Le modèle d'import, lui, reste
 * (décision testeur : c'est un réglage, pas une donnée de la ferme).
 *
 * ── Modèle d'import de la ferme ──────────────────────────────────────────────────────────────
 *
 * À « Importer », la correspondance validée et les choix de valeurs sont enregistrés comme modèle
 * de la ferme (creerModele) ; il est relu au dépôt suivant (même après avoir fermé l'écran), pour
 * CETTE ferme seulement. Rangement libre (base locale ou localStorage — happy-dom n'a pas
 * d'IndexedDB), mais tout ce qui est relu passe par `relireModele` avant appliquerModele ou
 * creerModele.
 */
import type { ReactElement } from 'react';
import type { ModeleImport } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

export type EtapeImport = 'depot' | 'type' | 'colonnes' | 'valeurs' | 'apercu' | 'fini';

export interface ProprietesEcranImport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** Horloge (horodatages, année de saison proposée) ; défaut () => new Date(). */
  readonly maintenant?: () => Date;
}

export interface ModuleEcranImport {
  readonly EcranImport: (props: ProprietesEcranImport) => ReactElement | null;
  readonly default: (props: ProprietesEcranImport) => ReactElement | null;
  /** Nombre de valeurs distinctes (espèces + familles) au-delà duquel on ne rapproche plus. */
  readonly PLAFOND_VALEURS_A_RAPPROCHER: number;
}

/**
 * apps/web/src/ecrans/import/modeles.ts — garde à l'exécution (relecture de T14c) : `brut` est ce
 * que le rangement rend (texte JSON, ou objet relu d'IndexedDB / du JSON). Rend le modèle
 * (identique à celui qu'on avait rangé) ou null ; ne lève JAMAIS, quelle que soit l'entrée ; un
 * modèle rendu est toujours accepté tel quel par creerModele (ses en-têtes, appliquerModele sur
 * ses en-têtes, ses choix).
 */
export interface ModuleModeles {
  readonly relireModele: (brut: unknown) => ModeleImport | null;
}

/** Valeur attendue du plafond (décision testeur) : 400 000 cultures différentes prenaient 26 s. */
export const PLAFOND_VALEURS_A_RAPPROCHER_ATTENDU = 2_000;

/** Libellés des types (radios de l'étape 2). */
export const LIBELLES_TYPES = {
  parcellaire: 'Parcellaire',
  cultures: 'Cultures et itinéraires',
  series: 'Séries',
  assolement: 'Assolement passé',
} as const;

export const NOM_ECRAN = 'Importer un tableur';
