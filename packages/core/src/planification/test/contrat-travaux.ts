/**
 * Contrat de T22 dans le cœur : les travaux prévus d'un itinéraire (travail du sol, couverture,
 * fertilisation, entretien), leurs dates, leur place dans l'instantané d'une série et dans le
 * semainier de T06. Tout est lu dans `@planif/core` (src/index.ts), tel que le serveur (T23),
 * l'écran des itinéraires (T24) et l'écran Aujourd'hui (T13) l'importent : le fichier qui le
 * définit est libre (`planification/travaux.ts` pour le calcul, `saisies/` pour la validation,
 * par exemple).
 *
 * Le module est chargé dynamiquement (`chargerTravaux`) : tant que les fonctions n'existent pas,
 * les tests échouent sur « n'exporte pas encore » au lieu de casser le typage de tout le dépôt.
 * Une fois écrites, elles doivent satisfaire ces types (ou des types compatibles).
 *
 * ── Le travail prévu (type de T01 : `TravailPrevu`, dans domaine/entites.ts) ──────────────────
 *
 *   {
 *     categorie:     CategorieIntervention de T01 : travail_sol | couverture | fertilisation |
 *                    amendement | entretien ;
 *     type:          libellé du type d'intervention de la ferme ('grelinette', 'désherbage'…),
 *                    le même texte que `DetailIntervention.type` d'un événement « intervention » ;
 *     repere:        semis_pepiniere | mise_en_place | debut_recolte | fin_recolte ;
 *     decalageJours: entier, négatif avant le repère (« grelinette 10 j avant la mise en place »
 *                    = mise_en_place, −10) ;
 *     repetition:    null, ou { tousLesJours: N entier ≥ 1, repereFin: repère } ;
 *     outil:         null ou texte ;
 *     produit:       null, ou { nom: texte, quantite: { valeur > 0, unite: texte } }
 *                    (fertilisation et amendement seulement, comme DetailIntervention) ;
 *     tempsEstime:   null, ou { minutes: entier ≥ 1, par: 'cent_metres' | 'planche' }.
 *   }
 *
 * Un champ facultatif vaut `null` (convention de T01) ; en entrée, une clé facultative absente
 * est lue comme `null`, et la valeur rendue porte toutes les clés.
 *
 * ── Rangement (décision du testeur : le plus simple compatible avec T10e et PowerSync) ─────────
 *
 * Les travaux sont une clé `travauxPrevus` (tableau) DANS les paramètres de l'itinéraire :
 * `ParametresCommuns.travauxPrevus` en TypeScript (facultative : les itinéraires et les séries
 * écrits avant T22 n'en ont pas, et valent « aucun travail »), jsonb `itineraire.parametres` en
 * base. Aucune colonne nouvelle, donc :
 *   - l'instantané d'une série (`serie.parametres`, déjà en place) les copie sans rien ajouter ;
 *   - le schéma local PowerSync ne change pas (`parametres` y est déjà un texte JSON) ;
 *   - `validerSerie` (T10e) les reçoit dans `parametres`, sous sa limite de 8 192 octets.
 * Base : une migration ajoute sur `itineraire` et `serie` une contrainte CHECK : la clé
 * `travauxPrevus` est absente ou un tableau jsonb (voir packages/db/src/travaux.integration.test.ts).
 *
 * ── Validation : validerTravailPrevu(entree, options?) / validerTravauxPrevus(entree, options?)
 *
 * Pures, ne lèvent jamais, comme `validerSerie`. Rendent `{ ok: true, valeur }` (valeur
 * normalisée : toutes les clés, `null` pour les facultatives absentes) ou `{ ok: false, erreur }`
 * (ErreurSaisie de T10b : code, champ, message ≤ 200 caractères).
 *
 *   entree pas un objet                  → 'entree_invalide' (champ null)
 *   clé inconnue                         → 'cle_inconnue', champ = la clé
 *   categorie absente / hors de la liste → 'champ_manquant' / 'champ_invalide', champ 'categorie'
 *   type : texte non vide (après trim), ≤ PLAFONDS_TRAVAUX.texte caractères, champ 'type'
 *   repere : un des quatre repères, champ 'repere'
 *   decalageJours : entier (pas 1.5, pas '−10', pas NaN), |d| ≤ PLAFONDS_TRAVAUX.decalageJours
 *   repetition.tousLesJours : entier, 1 ≤ N ≤ PLAFONDS_TRAVAUX.tousLesJours
 *   repetition.repereFin : un repère, PAS AVANT le repère de début dans l'ordre chronologique
 *     (semis_pepiniere < mise_en_place < debut_recolte < fin_recolte) → 'incoherent' ; même
 *     repère avec un décalage > 0 : la fin serait avant le début → 'incoherent'.
 *     Champ 'repetition.repereFin'.
 *   outil : null ou texte non vide ≤ PLAFONDS_TRAVAUX.texte
 *   produit : null, ou nom (texte non vide ≤ texte) et quantite { valeur finie > 0, unite texte
 *     non vide ≤ texte } ; un produit sur une autre catégorie que fertilisation / amendement →
 *     'incoherent', champ 'produit'. Champs : 'produit.nom', 'produit.quantite.valeur'…
 *   tempsEstime : null, ou minutes entier dans [1, PLAFONDS_TRAVAUX.minutes] (0, négatif,
 *     décimal refusés), par 'cent_metres' | 'planche'. Champs 'tempsEstime.minutes', 'tempsEstime.par'.
 *
 *   options.mode (ModeItineraire) : quand il est donné, un repère `semis_pepiniere` (début ou
 *     fin de répétition) hors plant maison → 'incoherent', champ 'repere' ou
 *     'repetition.repereFin'. Refusé à l'écriture : le maraîcher voit l'erreur dans T24.
 *   options.typesIntervention (liste { categorie, type } de la ferme, pour T23) : quand elle est
 *     donnée, le couple (categorie, type) doit y être → refusé sinon ('champ_invalide' ou
 *     'incoherent'), champ 'type'.
 *
 *   validerTravauxPrevus : un tableau (sinon 'champ_invalide', champ null) d'au plus
 *     PLAFONDS_TRAVAUX.nombre travaux (sinon 'trop_nombreux'), chacun validé comme ci-dessus ;
 *     champ de l'erreur préfixé par l'indice : '2.decalageJours'.
 *
 *   validerSerie (T10e) : `parametres.travauxPrevus` absente → acceptée ; présente → validée
 *     avec le mode des paramètres (sans liste de types : une série garde les types de son
 *     instantané, même si la ferme en masque un plus tard), champ de l'erreur préfixé :
 *     'parametres.travauxPrevus.2.decalageJours'. Acceptée → gardée dans `valeur.parametres`.
 *
 * ── PLAFONDS_TRAVAUX ────────────────────────────────────────────────────────────────────────
 *
 *   { nombre, texte, decalageJours, tousLesJours, minutes }, bornes comprises. Ils arrêtent une
 *   faute de frappe, pas une vraie ferme : nombre ≥ 12, texte ≥ 30, decalageJours ≥ 180,
 *   tousLesJours ≥ 30, minutes ≥ 240. Et le pire cas valide (nombre travaux, tous les champs
 *   remplis, textes à la longueur maximale en caractères de 3 octets) ajouté aux paramètres de
 *   la batavia tient dans PARAMETRES_SERIE_OCTETS : un itinéraire valide donne toujours une
 *   série acceptée par le serveur. Le développeur choisit les valeurs (ou relève la limite de
 *   8 192 octets, en le justifiant dans la PR).
 *
 * ── Dates : datesTravailPrevu(travail, dates) ───────────────────────────────────────────────
 *
 *   `dates` : dates d'une série (DatesPrevuesSerie de T01, éventuellement recalées par
 *   appliquerRealises). Rend les dates du travail, croissantes :
 *   - début = date du repère + decalageJours ;
 *   - sans répétition : [début] ;
 *   - avec répétition : début, début + N, début + 2N… tant que la date est ≤ date du repère de
 *     fin (LE REPÈRE DE FIN EST COMPRIS : « sans dépasser » ; un désherbage le jour du début de
 *     récolte a du sens). Début déjà après la fin → [] (aucune occurrence : on ne prévoit pas un
 *     désherbage après le début de récolte).
 *   - repère (de début ou de fin) absent des dates (semis pépinière d'un semis direct ou d'un
 *     plant acheté) → [] : ignoré sans lever, comme les réalisés incohérents du semainier ; la
 *     validation l'a déjà refusé à l'écriture.
 *
 * ── Instantané : instantaneItineraire(itineraire) ───────────────────────────────────────────
 *
 *   Itineraire de T01 → ses ParametresItineraire (ce que `serie.parametres` fige) : sans
 *   l'identité (id, fermeId, especeId, varieteId, nom, supprimeLe), travaux prévus compris, en
 *   copie profonde : modifier l'itinéraire ensuite ne change pas l'instantané. À utiliser par
 *   l'écran de création de série (T12).
 *
 * ── Semainier (T06, étendu) ─────────────────────────────────────────────────────────────────
 *
 *   SerieSemainier gagne `travauxPrevus?: readonly TravailPrevu[]` (ceux de l'instantané de la
 *   série ; absente = aucun). RealisesSemainier gagne `interventions?: ReadonlyMap<Id<'Serie'>,
 *   readonly InterventionRealisee[]>`, InterventionRealisee = { date, categorie, type } : les
 *   événements « intervention » de la série, dérivés du journal par l'appelant (corrections et
 *   annulations déjà appliquées, comme les réalisés).
 *
 *   TacheSemainier devient une union discriminée par `etape` :
 *     - les tâches d'étape de T06, INCHANGÉES (etape: EtapeTache) ;
 *     - TacheTravail : mêmes champs (cible, culture, variete, emplacements de la série — le
 *       travail du sol tombe sur les planches de la série —, taille, datePrevue, enRetard,
 *       joursDeRetard), avec etape: 'travail', travail: le TravailPrevu (au moins categorie et
 *       type), et tempsEstimeMinutes: number | null.
 *
 *   Règles :
 *   - dates des travaux = datesTravailPrevu(travail, dates recalées par les réalisés de T02) ;
 *     séries 'prevue' et 'en_cours' seulement ; même fenêtre que T06 (dans la semaine, ou avant
 *     et en retard) ;
 *   - soldé par un événement « intervention » de la même série, même categorie et même type
 *     (texte identique). Même règle que les réalisés de T06 (Q11) : une intervention solde
 *     l'occurrence la plus proche de sa date (à égalité, la plus ancienne), ET toutes les
 *     occurrences antérieures du même travail. Sans répétition, toute intervention du type
 *     solde donc le travail, même faite en avance ou en retard, comme un réalisé de T06 ;
 *   - une seule ligne en retard par travail prévu (esprit de Q12) : l'occurrence en retard la
 *     plus RÉCENTE (une intervention aujourd'hui les solderait toutes), son retard compté depuis
 *     sa date. Les occurrences de la semaine pas encore en retard restent listées. Les retards
 *     de travaux ne comptent pas dans « une ligne en retard par série » des étapes ;
 *   - tempsEstimeMinutes = tempsEstimeMinutes(travail.tempsEstime, série).
 *
 * ── Temps : tempsEstimeMinutes(temps, { taille, nombreEmplacements }) ───────────────────────
 *
 *   null → null. 'cent_metres' : minutes × longueurM / 100, arrondi à la minute la plus proche
 *   (demi vers le haut), sans erreur de virgule flottante (29 min × 50 m → 14,5 → 15) ; série
 *   comptée en plants (pas de longueur) → null. 'planche' : minutes × nombre d'emplacements
 *   distincts de la série ; aucun emplacement → null (on n'invente pas de planche).
 *
 * ── Charge : chargeSemaine(taches) ──────────────────────────────────────────────────────────
 *
 *   Somme des tempsEstimeMinutes non nuls des tâches données (celles du semainier, retards
 *   compris), en minutes entières. 0 pour une liste vide.
 */

export type Repere = 'semis_pepiniere' | 'mise_en_place' | 'debut_recolte' | 'fin_recolte';

export interface TravailPrevuLu {
  readonly categorie: string;
  readonly type: string;
  readonly repere: Repere;
  readonly decalageJours: number;
  readonly repetition: { readonly tousLesJours: number; readonly repereFin: Repere } | null;
  readonly outil: string | null;
  readonly produit: { readonly nom: string; readonly quantite: { readonly valeur: number; readonly unite: string } } | null;
  readonly tempsEstime: TempsEstime | null;
}

export interface TempsEstime {
  readonly minutes: number;
  readonly par: 'cent_metres' | 'planche';
}

export interface ErreurLigne {
  readonly code: string;
  readonly champ: string | null;
  readonly message: string;
}

export type ResultatLigne<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurLigne };

export interface OptionsTravaux {
  readonly mode?: 'semis_direct' | 'plant_maison' | 'plant_achete';
  readonly typesIntervention?: readonly { readonly categorie: string; readonly type: string }[];
}

export interface PlafondsTravaux {
  readonly nombre: number;
  readonly texte: number;
  readonly decalageJours: number;
  readonly tousLesJours: number;
  readonly minutes: number;
}

export interface DatesSerieLues {
  readonly semisPepiniere?: string;
  readonly miseEnPlace: string;
  readonly debutRecolte: string;
  readonly finRecolte: string;
}

export type TailleLue = { readonly unite: 'longueur'; readonly longueurM: number } | { readonly unite: 'plants'; readonly nombrePlants: number };

export interface EmplacementLu {
  readonly id: string;
  readonly code: string;
  readonly zone: string;
}

export interface SerieSemainierLue {
  readonly id: string;
  readonly statut: 'prevue' | 'en_cours' | 'terminee' | 'abandonnee';
  readonly mode: 'semis_direct' | 'plant_maison' | 'plant_achete';
  readonly culture: string;
  readonly variete: string | null;
  readonly datesPrevues: DatesSerieLues;
  readonly taille: TailleLue;
  readonly emplacements: readonly EmplacementLu[];
  readonly travauxPrevus?: readonly TravailPrevuLu[];
}

export interface InterventionRealisee {
  readonly date: string;
  readonly categorie: string;
  readonly type: string;
}

export interface RealisesLus {
  readonly series: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly campagnes: ReadonlyMap<string, string>;
  readonly interventions?: ReadonlyMap<string, readonly InterventionRealisee[]>;
}

export interface TacheLue {
  readonly etape: string;
  readonly cible: { readonly sorte: string; readonly serieId?: string };
  readonly culture: string;
  readonly emplacements: readonly EmplacementLu[];
  readonly taille: TailleLue;
  readonly datePrevue: string;
  readonly enRetard: boolean;
  readonly joursDeRetard: number;
  /** Tâche de travail seulement. */
  readonly travail?: { readonly categorie: string; readonly type: string };
  /** Tâche de travail seulement. */
  readonly tempsEstimeMinutes?: number | null;
}

/** `@planif/core` tel que T23, T24 et l'écran Aujourd'hui l'importent. */
export interface ModuleTravaux {
  validerTravailPrevu(entree: unknown, options?: OptionsTravaux): ResultatLigne<TravailPrevuLu>;
  validerTravauxPrevus(entree: unknown, options?: OptionsTravaux): ResultatLigne<readonly TravailPrevuLu[]>;
  readonly PLAFONDS_TRAVAUX: PlafondsTravaux;
  datesTravailPrevu(travail: TravailPrevuLu, dates: DatesSerieLues): readonly string[];
  instantaneItineraire(itineraire: unknown): Readonly<Record<string, unknown>>;
  tempsEstimeMinutes(temps: TempsEstime | null, serie: { readonly taille: TailleLue; readonly nombreEmplacements: number }): number | null;
  chargeSemaine(taches: readonly TacheLue[]): number;
  semainier(
    semaine: { readonly annee: number; readonly semaine: number },
    series: readonly SerieSemainierLue[],
    campagnes: readonly unknown[],
    realises: RealisesLus,
    dateDuJour: string,
  ): readonly TacheLue[];
  /** T02, déjà là. */
  calculerDatesSerie(parametres: unknown, ancre: { readonly type: string; readonly date: string }): DatesSerieLues;
  /** T02, déjà là. */
  appliquerRealises(dates: DatesSerieLues, realises: Readonly<Record<string, string>>): DatesSerieLues;
  /** T10e, étendu par T22. */
  validerSerie(entree: unknown): ResultatLigne<{ readonly parametres: Readonly<Record<string, unknown>> }>;
  /** T10e, déjà là. */
  readonly PARAMETRES_SERIE_OCTETS: number;
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export async function chargerCoeurTravaux(): Promise<Partial<ModuleTravaux>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleTravaux>;
}

const ATTENDUS = [
  'validerTravailPrevu',
  'validerTravauxPrevus',
  'PLAFONDS_TRAVAUX',
  'datesTravailPrevu',
  'instantaneItineraire',
  'tempsEstimeMinutes',
  'chargeSemaine',
  'semainier',
  'calculerDatesSerie',
  'appliquerRealises',
  'validerSerie',
  'PARAMETRES_SERIE_OCTETS',
] as const satisfies readonly (keyof ModuleTravaux)[];

/** Le module complet, ou une erreur claire qui nomme les exports manquants. */
export async function chargerTravaux(): Promise<ModuleTravaux> {
  const m = await chargerCoeurTravaux();
  const manquants = ATTENDUS.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T22)`);
  return m as ModuleTravaux;
}
