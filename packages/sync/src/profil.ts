/**
 * T32c : l'écriture du profil de croissance d'une espèce (`porte.reglerProfilCroissance`),
 * chargée à la demande (le réglage, dans l'écran Itinéraires, n'est pas au démarrage de l'appli).
 * Contrat : test/contrat-profil.ts.
 *
 * Elle rejoue avant d'écrire ce que le serveur refuserait (apps/api/src/sync/structure.ts) :
 * gérant actif de la ferme de la porte (Q35), règles du cœur (validerProfilCroissance), espèce de
 * la ferme de la porte (ni d'une autre ferme, ni de la bibliothèque commune). Le serveur reste
 * l'arbitre. Une transaction locale, un seul UPDATE : un envoi, tout ou rien.
 */
import { validerProfilCroissance } from '@planif/core';
import type { BaseLocale, TransactionLocale } from './types.ts';

export const SEUL_LE_GERANT_PROFIL = 'Seul le gérant peut régler le profil de croissance.';
export const SEUL_LE_GERANT_PERSONNALISER = 'Seul le gérant peut personnaliser une espèce.';

/** Ce que la porte sait d'elle-même. */
export interface ContexteProfil {
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant: () => Date;
}

async function estGerant(tx: TransactionLocale, ctx: ContexteProfil): Promise<boolean> {
  try {
    const lignes = await tx.getAll<{ n: number }>(
      `SELECT 1 AS n FROM membre WHERE utilisateur_id = ? AND ferme_id = ? AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL`,
      [ctx.utilisateurId, ctx.fermeId],
    );
    return lignes.length > 0;
  } catch {
    // Table des membres absente : on ne sait pas qui est gérant, rien n'est écrit.
    return false;
  }
}

/** Nom rapproché comme le cœur rapproche les noms (`profilParDefaut`) : sans casse, sans accents, espaces en trop retirés. */
function rapprocher(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface LigneEspeceOrigine {
  readonly ferme_id: unknown;
  readonly famille_id: unknown;
  readonly nom: unknown;
  readonly categorie: unknown;
  readonly perenne: unknown;
  readonly unite_recolte: unknown;
  readonly delai_retour_minimal_ans: unknown;
  readonly delai_retour_conseille_ans: unknown;
}

/**
 * T32g : copie propre à la ferme d'une espèce de la bibliothèque commune (Q39). Une transaction,
 * un seul INSERT ; profil nul (le cœur retrouve le défaut par le nom, gardé). Rend l'id de la
 * copie ; rejette sans rien écrire. Contrat : test/contrat-personnaliser.ts.
 */
export async function ecrirePersonnalisation(base: BaseLocale, ctx: ContexteProfil, id: string, especeId: string): Promise<string> {
  await base.writeTransaction(async (tx) => {
    if (!(await estGerant(tx, ctx))) throw new Error(SEUL_LE_GERANT_PERSONNALISER);
    const origines = await tx.getAll<LigneEspeceOrigine>(
      `SELECT ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans
       FROM espece WHERE id = ? AND supprime_le IS NULL`,
      [especeId],
    );
    const o = origines[0];
    if (o === undefined) throw new Error('Espèce introuvable : rien n’est copié.');
    if (o.ferme_id !== null) throw new Error('Seule une espèce de la bibliothèque commune se personnalise.');
    const nom = String(o.nom);
    const cle = rapprocher(nom);
    const deLaFerme = await tx.getAll<{ nom: unknown }>('SELECT nom FROM espece WHERE ferme_id = ? AND supprime_le IS NULL', [ctx.fermeId]);
    if (deLaFerme.some((e) => rapprocher(String(e.nom)) === cle)) throw new Error(`${nom} est déjà personnalisée.`);
    const instant = ctx.maintenant().toISOString();
    await tx.execute(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      [id, ctx.fermeId, o.famille_id, nom, o.categorie, o.perenne, o.unite_recolte, o.delai_retour_minimal_ans, o.delai_retour_conseille_ans, instant, instant],
    );
  });
  return id;
}

/** Écrit le profil (null : « Rétablir la valeur par défaut ») ; rejette sans rien écrire. */
export async function ecrireProfilCroissance(base: BaseLocale, ctx: ContexteProfil, especeId: string, profil: unknown): Promise<void> {
  const r = validerProfilCroissance(profil);
  if (!r.ok) throw new Error(r.erreur.message);
  const texte = r.valeur === null ? null : JSON.stringify(r.valeur);
  await base.writeTransaction(async (tx) => {
    if (!(await estGerant(tx, ctx))) throw new Error(SEUL_LE_GERANT_PROFIL);
    const especes = await tx.getAll<{ ferme_id: unknown }>('SELECT ferme_id FROM espece WHERE id = ? AND supprime_le IS NULL', [especeId]);
    const espece = especes[0];
    if (espece === undefined) throw new Error('Espèce introuvable : rien n’est modifié.');
    if (espece.ferme_id === null) throw new Error('Espèce de la bibliothèque : personnalisez-la pour régler sa croissance.');
    if (espece.ferme_id !== ctx.fermeId) throw new Error('Cette espèce n’est pas celle de votre ferme : rien n’est modifié.');
    await tx.execute('UPDATE espece SET profil_croissance = ?, modifie_le = ? WHERE id = ?', [texte, ctx.maintenant().toISOString(), especeId]);
  });
}
