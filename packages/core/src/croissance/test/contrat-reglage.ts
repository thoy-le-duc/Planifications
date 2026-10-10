/**
 * Contrat de T32c, cœur (docs/backlog/T32c-reglage-profils.md ; Q32, Q33, Q35) : le réglage du
 * profil de croissance par la ferme, et la règle de l'asperge portée par un VRAI CHAMP du profil.
 *
 * ── Le champ `fougereApresRecolte` ───────────────────────────────────────────────────────────
 *
 * Risque relevé à la relecture de T32b : la règle Q33 « turions seuls pendant la récolte, la
 * fougère ne monte qu'après la fin de récolte » est reconnue aujourd'hui par IDENTITÉ de l'objet
 * profil par défaut (WeakSet de defauts.ts). Un profil enregistré par la ferme, même identique au
 * défaut (copie lue de la base, texte JSON du téléphone), la perd. T32c la porte par un champ :
 *
 *   ProfilCroissance.fougereApresRecolte?: boolean      (facultatif ; absent = false)
 *
 *   - `validerProfilCroissance` l'accepte comme septième clé, FACULTATIVE (absente : profil
 *     valide, comme avant ; les profils de T32a restent valides tels quels). Présente, elle doit
 *     être un booléen ; sinon refus (ok: false) avec `champ` = 'fougereApresRecolte' et un message
 *     en français (le code d'erreur est libre : nouveau code, ou un code existant). Ordre : après
 *     la règle 10 (cycleAnnuel) de test/contrat.ts.
 *   - Valeur rendue : `fougereApresRecolte: true` est GARDÉ dans la valeur rendue (et donc dans le
 *     texte JSON écrit en base et exporté). `false` : gardé ou retiré, au choix (les tests ne
 *     regardent que le comportement). Absent : absent (la forme à six clés de T32a ne change pas).
 *   - Le profil par défaut de l'Asperge porte `fougereApresRecolte: true` ; aucun autre profil par
 *     défaut ne porte `true` (ni le générique).
 *   - `croissancePerenneA` applique la règle Q33 (contrat de q33.test.ts : jusqu'à la fin de récolte
 *     F comprise, hauteur 0 ; F = campagne.finRecolte, sinon le 15 juin ; la fougère part de 0 le
 *     lendemain de F) à TOUT profil qui porte `fougereApresRecolte: true`, quel que soit l'objet
 *     (défaut, copie, texte relu, profil modifié par la ferme), et seulement à ceux-là. La
 *     reconnaissance par identité (WeakSet) disparaît.
 *   - `croissanceA` (annuelles) l'ignore.
 *
 * Conséquences à arbitrer par le chef (tests existants qui changent, à justifier dans la PR) :
 *   - test/contrat.ts (T32a) : `ProfilCroissance` gagne `readonly fougereApresRecolte?: boolean`
 *     (et `CodeErreurCroissance` un code, si le développeur en crée un), sans quoi types.test.ts
 *     ne compile plus ;
 *   - feuillage-apres-recolte.test.ts (T32b) affirme l'inverse de T32c (« une asperge réglée par
 *     la ferme monte dès le débourrement », copie `{ ...asperge }` sans la règle) : il est remplacé
 *     par les tests de ../reglage.test.ts.
 *
 * Le module est chargé par import dynamique (test/contrat.ts : chargerCroissance) ; ce contrat
 * n'ajoute que le type élargi, pour que le typage de ces tests ne dépende pas du code pas encore
 * écrit.
 */
import type { ProfilCroissance } from './contrat.ts';

/** Profil de croissance avec le champ de T32c. */
export type ProfilReglable = ProfilCroissance & { readonly fougereApresRecolte?: boolean };

/** Nom du champ, tel qu'il apparaît dans le jsonb `espece.profil_croissance`. */
export const CHAMP_FOUGERE = 'fougereApresRecolte';

/** Lit le champ sur un profil rendu par le cœur (absent = false). */
export function fougereApresRecolte(profil: ProfilCroissance): boolean {
  return (profil as ProfilReglable).fougereApresRecolte === true;
}

/**
 * Valeur par défaut ACTUELLE de la hauteur de la tomate (defauts.ts, Q33 : 3 m, palissée haute).
 * Le ticket T32c dit « rétablir → 2 m » : il a été écrit avant Q33 ; les tests suivent le code.
 */
export const HAUTEUR_TOMATE_DEFAUT_M = 3;
