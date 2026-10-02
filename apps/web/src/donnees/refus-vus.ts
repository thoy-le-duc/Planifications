/**
 * Refus de synchro « vus » (T10i) : la pastille de l'onglet Ferme s'allume tant qu'un refus de
 * l'utilisateur n'a pas été vu, c'est-à-dire montré pendant que l'onglet Ferme était ouvert.
 *
 * « Vu » se compare aux refus eux-mêmes (leurs identifiants), jamais à l'heure : le `cree_le` d'un
 * refus vient de l'horloge du serveur, qui peut retarder sur celle du téléphone ; un refus arrivé
 * après l'ouverture de l'onglet pourrait sinon passer pour déjà vu.
 *
 * Gardé sur le téléphone (localStorage), un jeu par utilisateur. Seuls les VUS_MAX refus les plus
 * récents comptent : les plus anciens sont tenus pour vus, la clé ne grossit pas sans fin.
 *
 * Du JavaScript de démarrage (la pastille vit dans la coquille) : rien d'autre que ce fichier,
 * aucun import de @planif/sync.
 */

/** Refus les plus récents suivis ; au-delà, tenus pour vus. */
export const VUS_MAX = 200;

/** Clé des refus vus d'un utilisateur ; retirée à la déconnexion (connexion/deconnexion.ts). */
export const cleRefusVus = (utilisateurId: string): string => `planif.refus-vus.${utilisateurId}`;
const cle = cleRefusVus;

/** Identifiants des refus déjà vus par cet utilisateur sur ce téléphone (vide si illisible). */
export function lireRefusVus(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): ReadonlySet<string> {
  try {
    const brut: unknown = JSON.parse(stockage.getItem(cle(utilisateurId)) ?? '[]');
    return new Set(Array.isArray(brut) ? brut.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Note comme vus les refus donnés (du plus récent au plus ancien, ceux de l'écran). Échec
 * d'écriture (stockage plein, refusé) : la pastille reviendra au prochain lancement, rien de pire.
 */
export function noterRefusVus(stockage: Pick<Storage, 'setItem'>, utilisateurId: string, ids: readonly string[]): void {
  try {
    stockage.setItem(cle(utilisateurId), JSON.stringify(ids.slice(0, VUS_MAX)));
  } catch {
    // Rien : voir ci-dessus.
  }
}

/** Vrai si l'un des refus suivis (du plus récent au plus ancien) n'a pas été vu. */
export function refusNonVus(ids: readonly string[], vus: ReadonlySet<string>): boolean {
  return ids.slice(0, VUS_MAX).some((id) => !vus.has(id));
}
