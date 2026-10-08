/**
 * Contrat de `packages/core/src/croissance` (T32a, docs/backlog/T32a-croissance-profils.md ; Q32
 * de docs/questions.md) : l'API que les tests attendent de `src/croissance/index.ts`, réexportée
 * par `@planif/core` (src/index.ts : `export * from './croissance/index.ts'`).
 *
 * Le module est chargé dynamiquement (`chargerCroissance`) : tant qu'il n'existe pas, les tests
 * échouent sur « n'exporte pas encore » au lieu de casser le typage de tout le dépôt.
 * `../types.test.ts` vérifie, lui, statiquement que le module écrit satisfait `ModuleCroissance`.
 *
 * Tout est pur et déterministe : ni base, ni réseau, ni IA, ni horloge (le jour est un argument).
 * Aucune exception, quelle que soit l'entrée de `validerProfilCroissance` et de
 * `profilEffectif`. La hauteur est une ILLUSTRATION (jumeau numérique), pas une prévision.
 *
 * ── Profil de croissance (jsonb `espece.profil_croissance`, clés camelCase) ─────────────────
 *
 *   {
 *     forme:       FormePlant           FORMES_PLANT, liste fermée
 *     hauteurMaxM: number               ]0, HAUTEUR_MAX_PROFIL_M = 6]
 *     duree:       { en: 'jours', jours: entier dans [1, DUREE_MAX_JOURS = 730] }
 *                | { en: 'fraction_cycle', fraction: nombre dans ]0, 1] }
 *                  temps pour atteindre la hauteur maximale : en jours depuis la mise en place,
 *                  OU en fraction du cycle (mise en place → fin de récolte), l'un des deux.
 *     allure:      'lineaire' | 'en-s'  ALLURES
 *     finDeCycle:  'conservee' | 'baissee'   FINS_DE_CYCLE (la tomate reste haute : conservee)
 *     cycleAnnuel: { debourrement: 'MM-JJ', repos: 'MM-JJ' } | null    (facultatif : absent = null)
 *                  pérennes seulement (Q32) : jour du débourrement et jour du repos de chaque
 *                  année, jours valides d'une année NON bissextile (pas de 02-29), débourrement
 *                  strictement avant le repos dans l'année.
 *   }
 *
 * Courbe : x = avancement dans [0, 1] ; 'lineaire' → x ; 'en-s' → x²(3 − 2x) (smoothstep :
 * 0 → 0, 0,5 → 0,5, 1 → 1, monotone).
 *
 * ── validerProfilCroissance(entree: unknown): ResultatCroissance<ProfilCroissance | null> ────
 *
 * Les règles que la base du téléphone (porte) et le serveur rejouent. Entrée : null / undefined
 * (→ ok, valeur null : profil par défaut), un objet, ou son texte JSON tel que le téléphone le
 * garde (PowerSync). Règles, DANS CET ORDRE (la première violée est rendue) :
 *   1. texte de plus de PROFIL_CARACTERES_MAX = 2 048 caractères (vérifié avant de le lire)
 *                                                        → 'trop_long'          champ null
 *   2. texte JSON illisible, ou valeur qui n'est pas un objet (tableau, nombre, texte JSON…)
 *                                                        → 'entree_invalide'    champ null
 *   3. clé inconnue au premier niveau (ordre des clés de l'objet ; la première)
 *                                                        → 'champ_inconnu'      champ = la clé
 *   4. clé obligatoire absente (ou valeur undefined), dans l'ordre forme, hauteurMaxM, duree,
 *      allure, finDeCycle                                 → 'champ_manquant'     champ = la clé
 *   5. forme hors FORMES_PLANT                           → 'forme_inconnue'     champ 'forme'
 *   6. hauteurMaxM : number fini dans ]0, 6] (un texte « 2 » est refusé)
 *                                                        → 'hauteur_invalide'   champ 'hauteurMaxM'
 *   7. duree : objet { en: 'jours', jours } ou { en: 'fraction_cycle', fraction }, sans autre
 *      clé ; jours entier dans [1, 730] ; fraction number fini dans ]0, 1]
 *                                                        → 'duree_invalide'     champ 'duree'
 *   8. allure hors ALLURES                               → 'allure_inconnue'    champ 'allure'
 *   9. finDeCycle hors FINS_DE_CYCLE                     → 'fin_de_cycle_inconnue' champ 'finDeCycle'
 *  10. cycleAnnuel : null, absent, ou objet { debourrement, repos } (sans autre clé), jours
 *      'MM-JJ' valides (année non bissextile), debourrement < repos
 *                                                        → 'cycle_annuel_invalide' champ 'cycleAnnuel'
 * Valide : `valeur` = le profil, exactement ces six clés (cycleAnnuel null s'il était absent),
 * duree avec ses deux clés seulement. Messages : en français, non vides, 200 caractères au plus.
 *
 * ── Profils par défaut (Q32 : valeurs par défaut réglables par la ferme) ─────────────────────
 *
 *   PROFILS_PAR_DEFAUT: readonly ProfilParDefaut[]
 * La bibliothèque commune des profils : une entrée par espèce de la bibliothèque, `espece` = son
 * nom (tel que la bibliothèque le porte : « Tomate », « Laitue »…), `synonymes` (autres noms
 * courants, « Salade » pour la laitue), `profil` valide, `source` non vide : une référence, ou
 * exactement MENTION_A_VERIFIER = 'valeur usuelle à vérifier'. Ordres de grandeur de départ
 * (ticket) : tomate 2 m érigée tuteurée, laitue (salade) 0,25 m en rosette, carotte 0,3 m,
 * courgette 0,6 m en buisson, fraisier 0,25 m, asperge 1,5 m (fougère). Les pérennes de la
 * ferme (asperge, kiwi, pivoine, fraisier) ont un `cycleAnnuel`.
 *
 *   PROFIL_GENERIQUE: ProfilParDefaut      espèce inconnue (profil documenté, cycleAnnuel null)
 *   profilParDefaut(nomEspece: string): ProfilParDefaut
 * Rapprochement par nom ou synonyme, sans tenir compte de la casse, des accents ni des espaces
 * en trop (« tomate », « TOMATE  », « Épinard » = « epinard ») ; aucun → PROFIL_GENERIQUE (le
 * même objet).
 *
 *   profilEffectif(espece: { nom: string; profilCroissance?: unknown }): ProfilCroissance
 * L'adaptateur : le profil réglé par la ferme (`profilCroissance`, objet ou texte JSON du
 * téléphone) s'il est valide (validerProfilCroissance), sinon (nul, absent, illisible ou hors
 * bornes) le profil par défaut de l'espèce, `profilParDefaut(nom).profil`. Ne lève jamais.
 *
 * ── croissanceA(dates: DatesCroissance, profil, jour): EtatCroissance ─────────────────────────
 *
 * Culture annuelle (occupation d'une série). Chaque repère a sa date prévue et sa date réelle ;
 * la réelle, si elle est remplie, remplace la prévue. M = mise en place, B = début de récolte,
 * F = fin de récolte, A = arrachage (jour où l'emplacement se libère : intervalle [M, A[, comme
 * les occupations). Écarts en jours entiers (dates calendaires, sans fuseau).
 *   - M inconnue, jour < M, ou A connue et jour ≥ A          → stade 'aucun', hauteur 0
 *   - durée jusqu'au maximum, Dmax (jours) :
 *       en jours : profil.duree.jours ;
 *       en fraction du cycle : fraction × (F − M) ; F inconnue : fraction × (A − M) ; ni F ni A :
 *       JOURS_REPLI_SANS_FIN = 60 (aucune fin de cycle inventée).
 *     x = Dmax > 0 ? min((jour − M) / Dmax, 1) : 1 ; h(jour) = hauteurMaxM × courbe(x).
 *   - F connue et jour ≥ F (avant A)    → 'fin' ; hauteur = h(F) si finDeCycle = 'conservee',
 *                                          h(F) × FRACTION_HAUTEUR_FIN_BAISSEE (0,5) si 'baissee'
 *   - sinon (B connue et jour ≥ B) ou x = 1 → 'pleine_production', hauteur h(jour)
 *   - sinon h(jour) < FRACTION_FIN_LEVEE (0,1) × hauteurMaxM → 'levee', hauteur h(jour)
 *   - sinon                                → 'croissance', hauteur h(jour)
 * Sans F ni A : la hauteur maximale est tenue indéfiniment ('pleine_production').
 * `cycleAnnuel` du profil est ignoré ici.
 *
 * ── croissancePerenneA(entree: EntreePerenne, profil, jour): EtatCroissance ──────────────────
 *
 * Plantation pérenne (kiwi, asperge, pivoine, fraisier conservé) : cycle annuel simple (Q32).
 * `campagne` = la campagne de l'année du jour (ou null). Y = année de `jour`.
 *   - jour < datePlantation, ou dateArrachage connue et jour ≥ dateArrachage → 'aucun', 0
 *   - profil.cycleAnnuel null (dates manquantes) : repli « touffe haute fixe » →
 *     'pleine_vegetation', hauteur maximale, toute l'année, campagne ou pas
 *   - campagne null, ou campagne.annee ≠ Y (hors campagne)  → 'repos', hauteur 0 (pas de feuillage)
 *   - fenêtre de végétation [D, R[ : D = Y-debourrement, R = Y-repos ; une récolte de la
 *     campagne hors de la fenêtre l'élargit (debutRecolte < D → D = debutRecolte ;
 *     finRecolte ≥ R → R = finRecolte + 1 jour) ; l'année de plantation, D = max(D, datePlantation).
 *   - jour < D ou jour ≥ R                         → 'repos', hauteur 0
 *   - sinon x = min((jour − D) / Dmax, 1), Dmax = duree.jours, ou fraction × (R − D) ;
 *     h = hauteurMaxM × courbe(x) ; 'debourrement' tant que x < 1, puis 'pleine_vegetation'.
 * Chaque année avec campagne, la plante repart de 0 au débourrement (repousse).
 *
 * ── Sortie : EtatCroissance ─────────────────────────────────────────────────────────────────
 *   { stade, hauteurM, fraction }   hauteurM ≥ 0 et ≤ hauteurMaxM ; fraction = hauteurM /
 *   hauteurMaxM, dans [0, 1] ; 0 et 0 aux stades 'aucun' et 'repos'. Pas d'arrondi.
 */
import type { DateCalendaire } from '../../dates/index.ts';

export type { DateCalendaire };

export type FormePlant = 'erige-tuteure' | 'rosette' | 'touffe' | 'rampant' | 'buisson' | 'arbre-ou-liane' | 'bulbe-ou-racine';
export type AllureCroissance = 'lineaire' | 'en-s';
export type FinDeCycle = 'conservee' | 'baissee';

export type DureeCroissance = { readonly en: 'jours'; readonly jours: number } | { readonly en: 'fraction_cycle'; readonly fraction: number };

export interface CycleAnnuel {
  /** 'MM-JJ' */
  readonly debourrement: string;
  /** 'MM-JJ' */
  readonly repos: string;
}

export interface ProfilCroissance {
  readonly forme: FormePlant;
  readonly hauteurMaxM: number;
  readonly duree: DureeCroissance;
  readonly allure: AllureCroissance;
  readonly finDeCycle: FinDeCycle;
  readonly cycleAnnuel: CycleAnnuel | null;
}

export interface ProfilParDefaut {
  readonly espece: string;
  readonly synonymes: readonly string[];
  readonly profil: ProfilCroissance;
  /** Référence, ou exactement MENTION_A_VERIFIER. */
  readonly source: string;
}

export type StadeCroissance =
  | 'aucun'
  | 'levee'
  | 'croissance'
  | 'pleine_production'
  | 'fin'
  | 'debourrement'
  | 'pleine_vegetation'
  | 'repos';

export interface EtatCroissance {
  readonly stade: StadeCroissance;
  readonly hauteurM: number;
  readonly fraction: number;
}

export interface DateRepere {
  readonly prevue: DateCalendaire | null;
  readonly reelle: DateCalendaire | null;
}

export interface DatesCroissance {
  readonly miseEnPlace: DateRepere;
  readonly debutRecolte: DateRepere;
  readonly finRecolte: DateRepere;
  readonly arrachage: DateRepere;
}

export interface EntreePerenne {
  readonly plantation: { readonly datePlantation: DateCalendaire; readonly dateArrachage: DateCalendaire | null };
  readonly campagne: { readonly annee: number; readonly debutRecolte: DateCalendaire | null; readonly finRecolte: DateCalendaire | null } | null;
}

export type CodeErreurCroissance =
  | 'trop_long'
  | 'entree_invalide'
  | 'champ_inconnu'
  | 'champ_manquant'
  | 'forme_inconnue'
  | 'hauteur_invalide'
  | 'duree_invalide'
  | 'allure_inconnue'
  | 'fin_de_cycle_inconnue'
  | 'cycle_annuel_invalide';

export interface ErreurCroissance {
  readonly code: CodeErreurCroissance;
  readonly champ: string | null;
  /** En français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatCroissance<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurCroissance };

export interface ModuleCroissance {
  readonly FORMES_PLANT: readonly FormePlant[];
  readonly ALLURES: readonly AllureCroissance[];
  readonly FINS_DE_CYCLE: readonly FinDeCycle[];
  readonly HAUTEUR_MAX_PROFIL_M: number;
  readonly DUREE_MAX_JOURS: number;
  readonly PROFIL_CARACTERES_MAX: number;
  readonly FRACTION_FIN_LEVEE: number;
  readonly FRACTION_HAUTEUR_FIN_BAISSEE: number;
  readonly JOURS_REPLI_SANS_FIN: number;
  readonly MENTION_A_VERIFIER: string;
  readonly PROFILS_PAR_DEFAUT: readonly ProfilParDefaut[];
  readonly PROFIL_GENERIQUE: ProfilParDefaut;

  validerProfilCroissance(entree: unknown): ResultatCroissance<ProfilCroissance | null>;
  profilParDefaut(nomEspece: string): ProfilParDefaut;
  profilEffectif(espece: { readonly nom: string; readonly profilCroissance?: unknown }): ProfilCroissance;
  croissanceA(dates: DatesCroissance, profil: ProfilCroissance, jour: DateCalendaire): EtatCroissance;
  croissancePerenneA(entree: EntreePerenne, profil: ProfilCroissance, jour: DateCalendaire): EtatCroissance;
}

/** Chemin tenu dans une variable : TypeScript ne résout pas un export avant qu'il existe. */
const CHEMIN_COEUR = '../../index.ts';

export async function chargerCoeurCroissance(): Promise<Partial<ModuleCroissance>> {
  return (await import(/* @vite-ignore */ CHEMIN_COEUR)) as Partial<ModuleCroissance>;
}

export const ATTENDUS = [
  'FORMES_PLANT',
  'ALLURES',
  'FINS_DE_CYCLE',
  'HAUTEUR_MAX_PROFIL_M',
  'DUREE_MAX_JOURS',
  'PROFIL_CARACTERES_MAX',
  'FRACTION_FIN_LEVEE',
  'FRACTION_HAUTEUR_FIN_BAISSEE',
  'JOURS_REPLI_SANS_FIN',
  'MENTION_A_VERIFIER',
  'PROFILS_PAR_DEFAUT',
  'PROFIL_GENERIQUE',
  'validerProfilCroissance',
  'profilParDefaut',
  'profilEffectif',
  'croissanceA',
  'croissancePerenneA',
] as const satisfies readonly (keyof ModuleCroissance)[];

/** Le module complet, ou une erreur claire qui nomme les exports manquants. */
export async function chargerCroissance(): Promise<ModuleCroissance> {
  const m = await chargerCoeurCroissance();
  const manquants = ATTENDUS.filter((nom) => m[nom] === undefined);
  if (manquants.length > 0) throw new Error(`@planif/core n'exporte pas encore : ${manquants.join(', ')} (T32a)`);
  return m as ModuleCroissance;
}

// ── Aides de test ────────────────────────────────────────────────────────────────────────────

/** Date calendaire d'un littéral 'AAAA-MM-JJ' (les tests n'écrivent que des dates valides). */
export const d = (s: string): DateCalendaire => s as DateCalendaire;

/** Repère sans date réelle. */
export const prevue = (s: string | null): DateRepere => ({ prevue: s === null ? null : d(s), reelle: null });

/** Profil complet de test, modifiable champ par champ. */
export function profil(autres: Partial<ProfilCroissance> = {}): ProfilCroissance {
  return {
    forme: 'erige-tuteure',
    hauteurMaxM: 2,
    duree: { en: 'jours', jours: 90 },
    allure: 'lineaire',
    finDeCycle: 'conservee',
    cycleAnnuel: null,
    ...autres,
  };
}

/** Courbe en S du contrat (smoothstep). */
export const enS = (x: number): number => x * x * (3 - 2 * x);

/** Normalisation de nom attendue (casse, accents, espaces), pour les tests de rapprochement. */
export const sansAccents = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
