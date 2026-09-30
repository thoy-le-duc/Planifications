/**
 * Contrat de T10e dans le cœur : les règles d'une série et de ses occupations écrites par un
 * téléphone (`validerSerie`, `validerOccupation`), et les exports que l'écran de T12 attend
 * (`calculerDatesSerie`, `besoinsSerie`, `alertesRotation`). Tout est lu dans `@planif/core`
 * (src/index.ts), tel que le serveur et le téléphone l'importent : le fichier qui les définit
 * est libre, du moment qu'il est sous `src/saisies/` pour les règles.
 *
 * Le module est chargé dynamiquement (`chargerCoeurSeries`) : tant que les fonctions n'existent
 * pas, les tests échouent sur « n'est pas une fonction » au lieu de casser le typage de tout le
 * dépôt. Une fois écrites, elles doivent satisfaire ces types (ou des types compatibles).
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * UNE SEULE définition des règles, pure (ni base, ni réseau, ni horloge, ne lève jamais), comme
 * `validerSaisie` (T10b) et `validerArticleStock` (T10c). Le serveur les rejoue à chaque PUT et à
 * chaque PATCH (sur la ligne complète : ligne existante + colonnes du PATCH) ; le téléphone peut
 * s'en servir avant d'écrire (T12). Ce qui reste à l'appelant : la ferme du jeton, l'appartenance
 * des références (saison, espèce, variété, itinéraire, emplacement, série) à la ferme.
 *
 * ── validerSerie(entree: unknown) ───────────────────────────────────────────────────────────
 *
 * `entree` : la ligne `serie` au format PowerSync, AVEC son `id` (snake_case, texte, nombre ou
 * null ; `parametres` et `rotation_acceptee` en texte JSON OU déjà en objet) :
 *
 *   id, ferme_id, saison_id, espece_id, variete_id, itineraire_id, parametres, ancre_type,
 *   ancre_date, prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte,
 *   prevu_fin_recolte, longueur_m, nombre_plants, statut, rotation_acceptee
 *   + cree_le, modifie_le (tolérées, remplies par le serveur), supprime_le (null ou instant ISO
 *   'AAAA-MM-JJTHH:MM:SS.sssZ' : la suppression douce passe par un PATCH de cette colonne).
 *
 * Toute autre colonne → 'colonne_inconnue'. Entrée qui n'est pas un objet → 'entree_invalide'.
 *
 *   id, ferme_id, saison_id, espece_id, itineraire_id   UUID obligatoires (rendus en minuscules)
 *   variete_id                                          UUID ou null
 *   ancre_type    semis | plantation | debut_recolte    → 'champ_invalide' (champ 'ancre_type')
 *   ancre_date    'AAAA-MM-JJ' existante, dans [2000-01-01, 2100-12-31]
 *   statut        prevue | en_cours | terminee | abandonnee → 'champ_invalide' (champ 'statut')
 *   longueur_m / nombre_plants : EXACTEMENT l'un des deux (les deux → 'incoherent', aucun →
 *     'champ_manquant') ; un nombre (pas un texte), fini, > 0 ; nombre_plants entier ;
 *     ≤ PLAFONDS_SERIE.longueurM / PLAFONDS_SERIE.nombrePlants (bornes comprises) → sinon refusé
 *     (code libre parmi 'champ_invalide', 'hors_bornes', 'plafond_depasse'), champ = la colonne.
 *   parametres    l'instantané de l'itinéraire, LISIBLE : un objet JSON (texte illisible →
 *     'json_illisible' ; tableau, nombre… → 'champ_invalide'), de 8 192 octets au plus en JSON
 *     (→ 'trop_volumineux'), avec ce que le calcul des dates lit : `mode` (semis_direct |
 *     plant_maison | plant_achete), `dureeAvantRecolteJours` et `fenetreRecolteJours` (entiers
 *     ≥ 0), et `dureePepiniereJours` (entier ≥ 0) en plant maison. Champ de l'erreur :
 *     'parametres' ou 'parametres.<clé>'. Durées démesurées (dates hors de [2000, 2100]) : refusé.
 *   Dates prévues (principe 2 : le serveur ne croit aucune date calculée ailleurs) :
 *     calculerDatesSerie(parametres, { type: ancre_type, date: ancre_date }) (T02) doit donner
 *     EXACTEMENT prevu_semis_pepiniere (null quand l'étape est sans objet : semis direct, plant
 *     acheté), prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte. Sinon →
 *     'incoherent', champ = la première colonne fausse dans cet ordre. Une ancre impossible
 *     (semis d'un plant acheté : RangeError de T02) → refusée sans lever, champ 'ancre_type'.
 *   rotation_acceptee (T10e, décision sur une alerte rouge de T04) : null, ou un objet avec
 *     EXACTEMENT les clés
 *       famille    UUID de la famille botanique en cause,
 *       delai_ans  entier dans [0, 100] (le délai de retour qui n'est pas respecté),
 *       le         instant ISO 'AAAA-MM-JJTHH:MM:SS.sssZ' de la décision ;
 *     texte illisible → 'json_illisible' ; autre clé → 'cle_inconnue' ; valeur invalide →
 *     'champ_invalide' ou 'hors_bornes'. Champ : 'rotation_acceptee' ou 'rotation_acceptee.<clé>'.
 *
 * Acceptée → `{ ok: true, valeur }`, `valeur` = la `Serie` de T01 (camelCase : ancre regroupée,
 * datesPrevues sans clé semisPepiniere quand elle est sans objet, taille), à laquelle le
 * développeur ajoute ce qu'il veut (rotationAcceptee, supprimeLe…).
 * Refusée → `{ ok: false, erreur }` : ErreurSaisie de T10b (code, champ, message ≤ 200 car.).
 *
 * ── validerOccupation(entree: unknown, serie) ───────────────────────────────────────────────
 *
 * `entree` : la ligne `occupation` au format PowerSync, avec son `id` :
 *   id, ferme_id, emplacement_id, serie_id, plantation_id, evenement_id, longueur_m,
 *   nombre_places, position_m, prevu_du, prevu_au, reel_du, reel_au
 *   + cree_le, modifie_le (tolérées), supprime_le (null ou instant ISO).
 * `serie` : la série de l'occupation, telle que `validerSerie` l'a rendue (`valeur`).
 *
 *   id, ferme_id, emplacement_id, serie_id   UUID obligatoires
 *   plantation_id, evenement_id  NULL obligatoirement (une occupation de série ; les plantations
 *     pérennes et les couvertures viendront avec leur ticket) → refusé, champ = la colonne.
 *   serie_id = serie.id et ferme_id = serie.fermeId → sinon 'incoherent'.
 *   longueur_m / nombre_places : exactement l'un des deux, > 0, nombre_places entier, plafonnés
 *     comme la série (PLAFONDS_SERIE.longueurM, PLAFONDS_SERIE.nombrePlants).
 *   position_m : null ou nombre fini ≥ 0.
 *   Dates cohérentes avec la série (docs/modele-donnees.md § 4, occupationDeSerie de T03) :
 *     prevu_du = serie.datesPrevues.miseEnPlace et prevu_au = serie.datesPrevues.finRecolte →
 *     sinon 'incoherent', champ 'prevu_du' ou 'prevu_au'.
 *   reel_du, reel_au : null ou 'AAAA-MM-JJ' ; reel_au sans reel_du, ou avant lui → refusé.
 *
 * Acceptée → `valeur` = l'`Occupation` de T01 (occupant { sorte: 'serie', serieId }, place,
 * positionM, prevuDu, prevuAu, reel).
 *
 * ── Plafonds ────────────────────────────────────────────────────────────────────────────────
 *
 * `PLAFONDS_SERIE` (exporté, PROVISOIRE comme PLAFONDS_PROVISOIRES : à valider par Théophane) :
 * `longueurM` et `nombrePlants`, bornes comprises. Ils arrêtent une faute de frappe (1e308 m),
 * pas une grande série : au moins 1 000 m et 100 000 plants, au plus 1 000 000 m et 100 000 000
 * plants. Valeurs proposées : 10 000 m, 1 000 000 plants.
 */

export type CodeErreur =
  | 'entree_invalide'
  | 'colonne_inconnue'
  | 'champ_manquant'
  | 'champ_invalide'
  | 'hors_bornes'
  | 'trop_long'
  | 'trop_nombreux'
  | 'doublon'
  | 'incoherent'
  | 'json_illisible'
  | 'trop_volumineux'
  | 'cle_inconnue'
  | 'plafond_depasse';

export interface ErreurLigne {
  readonly code: CodeErreur;
  readonly champ: string | null;
  readonly message: string;
}

export type ResultatLigne<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurLigne };

export interface DatesPrevues {
  readonly semisPepiniere?: string;
  readonly miseEnPlace: string;
  readonly debutRecolte: string;
  readonly finRecolte: string;
}

export interface AncreLue {
  readonly type: 'semis' | 'plantation' | 'debut_recolte';
  readonly date: string;
}

/** Ce que les tests lisent de la série rendue (la `Serie` de T01, au moins). */
export interface SerieLue {
  readonly id: string;
  readonly fermeId: string;
  readonly saisonId: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly itineraireId: string;
  readonly parametres: Readonly<Record<string, unknown>>;
  readonly ancre: AncreLue;
  readonly datesPrevues: DatesPrevues;
  readonly taille: { readonly unite: 'longueur'; readonly longueurM: number } | { readonly unite: 'plants'; readonly nombrePlants: number };
  readonly statut: string;
}

export interface OccupationLue {
  readonly id: string;
  readonly fermeId: string;
  readonly emplacementId: string;
  readonly occupant: { readonly sorte: string; readonly serieId?: string };
  readonly place: { readonly unite: 'longueur'; readonly longueurM: number } | { readonly unite: 'places'; readonly nombrePlaces: number };
  readonly positionM: number | null;
  readonly prevuDu: string;
  readonly prevuAu: string;
  readonly reel: { readonly du: string; readonly au: string | null } | null;
}

export interface PlafondsSerie {
  readonly longueurM: number;
  readonly nombrePlants: number;
}

/** `@planif/core` tel que T10e (le serveur) et T12 (l'écran) l'importent. */
export interface ModuleSeries {
  validerSerie(entree: unknown): ResultatLigne<SerieLue>;
  validerOccupation(entree: unknown, serie: SerieLue): ResultatLigne<OccupationLue>;
  readonly PLAFONDS_SERIE: PlafondsSerie;
  /** T02 : dates prévues depuis les paramètres et l'ancre. */
  calculerDatesSerie(parametres: unknown, ancre: AncreLue): DatesPrevues;
  /** T05 : besoins en semences ou en plants d'une série. */
  besoinsSerie(itineraire: unknown, longueurCm: number): unknown;
  /** T04 : alertes de rotation. */
  alertesRotation(...args: readonly unknown[]): readonly unknown[];
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export async function chargerCoeurSeries(): Promise<Partial<ModuleSeries>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleSeries>;
}

/** Le module complet, ou une erreur claire qui nomme les exports manquants. */
export async function chargerSeries(): Promise<ModuleSeries> {
  const m = await chargerCoeurSeries();
  const attendus = ['validerSerie', 'validerOccupation', 'PLAFONDS_SERIE', 'calculerDatesSerie', 'besoinsSerie', 'alertesRotation'] as const;
  const manquants = attendus.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T10e)`);
  return m as ModuleSeries;
}
