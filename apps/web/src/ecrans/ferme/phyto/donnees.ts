/**
 * Produits phyto de la ferme et registre (T52) : lectures et écritures par la porte. Chaque
 * enregistrement est UNE transaction ; la ligne complète est vérifiée par la règle du serveur
 * (`validerProduitPhyto`) avant d'être écrite. Jamais de DELETE : archiver pose `supprime_le`.
 * Jamais d'écriture sur un produit de la bibliothèque (ferme_id nul) ni dans `modification`.
 */
import { creerGenerateurId, lignesRegistrePhyto, validerProduitPhyto, type LigneLocaleRegistre, type LigneRegistre } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class ProduitRefuse extends Error {}

export type Valeur = string | number | null;
export type LigneProduit = Readonly<Record<string, Valeur>>;

/** Ce que le formulaire saisit (DAR déjà lu en nombre, bio en booléen, dose maximale facultative). */
export interface ValeursProduit {
  readonly nomCommercial: string;
  readonly numeroAmm: string;
  readonly substanceActive: string;
  readonly delaiAvantRecolteJours: number;
  readonly utilisableEnBio: boolean;
  readonly doseMaximale: { readonly valeur: number; readonly unite: string } | null;
}

export interface ContextePhyto {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

const COLONNES = ['id', 'ferme_id', 'nom_commercial', 'numero_amm', 'substance_active', 'delai_avant_recolte_jours', 'utilisable_en_bio', 'dose_maximale', 'cree_le', 'modifie_le', 'supprime_le'] as const;

export const SQL_PRODUITS_FERME = `SELECT ${COLONNES.join(', ')} FROM produit_phyto WHERE ferme_id = ? ORDER BY nom_commercial, id`;

function nouvelId(maintenant: () => Date): string {
  const generer = creerGenerateurId({ horloge: () => maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  return generer<'ProduitPhyto'>();
}

function colonnesDe(v: ValeursProduit): Record<string, Valeur> {
  return {
    nom_commercial: v.nomCommercial.trim(),
    numero_amm: v.numeroAmm.trim(),
    substance_active: v.substanceActive.trim(),
    delai_avant_recolte_jours: v.delaiAvantRecolteJours,
    utilisable_en_bio: v.utilisableEnBio ? 1 : 0,
    dose_maximale: v.doseMaximale === null ? null : JSON.stringify({ valeur: v.doseMaximale.valeur, unite: v.doseMaximale.unite.trim() }),
  };
}

function verifier(l: Readonly<Record<string, Valeur>>): void {
  const r = validerProduitPhyto({ ...l });
  if (!r.ok) throw new ProduitRefuse(r.erreur.message);
}

async function lire(ctx: ContextePhyto, id: string): Promise<LigneProduit> {
  const l = (await ctx.porte.lire<LigneProduit>(`SELECT ${COLONNES.join(', ')} FROM produit_phyto WHERE id = ? AND ferme_id = ?`, [id, ctx.fermeId]))[0];
  if (l === undefined) throw new ProduitRefuse('produit introuvable sur ce téléphone');
  return l;
}

/** Crée le produit (une transaction) ; rend son id. */
export async function creerProduit(ctx: ContextePhyto, v: ValeursProduit): Promise<string> {
  const iso = ctx.maintenant().toISOString();
  const l: Record<string, Valeur> = { id: nouvelId(ctx.maintenant), ferme_id: ctx.fermeId, ...colonnesDe(v), cree_le: iso, modifie_le: iso, supprime_le: null };
  verifier(l);
  await ctx.porte.ecrireEnsemble([{ sql: `INSERT INTO produit_phyto (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`, parametres: COLONNES.map((c) => l[c] ?? null) }]);
  return String(l.id);
}

/** UPDATE des colonnes qui changent (et modifie_le), après vérification de la ligne complète. */
async function changer(ctx: ContextePhyto, id: string, valeurs: Readonly<Record<string, Valeur>>): Promise<void> {
  const avant = await lire(ctx, id);
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return;
  const iso = ctx.maintenant().toISOString();
  verifier({ ...avant, ...valeurs, modifie_le: iso });
  await ctx.porte.ecrireEnsemble([
    {
      sql: `UPDATE produit_phyto SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`,
      parametres: [...changees.map((c) => valeurs[c] ?? null), iso, id, ctx.fermeId],
    },
  ]);
}

export function modifierProduit(ctx: ContextePhyto, id: string, v: ValeursProduit): Promise<void> {
  return changer(ctx, id, colonnesDe(v));
}

/** Archive (suppression douce) : les traitements passés gardent leur produit. */
export function archiverProduit(ctx: ContextePhyto, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: ctx.maintenant().toISOString() });
}

export function retablirProduit(ctx: ContextePhyto, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: null });
}

// ── Registre ─────────────────────────────────────────────────────────────────────────────────

export const SQL_TRAITEMENTS = `SELECT id, ferme_id, type, date, horodatage, serie_id, campagne_id, emplacement_ids, remplace_sorte, remplace_evenement_id, detail
  FROM evenement WHERE ferme_id = ? AND type = 'traitement'`;

/** Période du registre : la saison qui contient le jour, à défaut l'année civile. */
export async function periodeDuRegistre(porte: PorteDonnees, fermeId: string, jour: string): Promise<{ readonly nom: string; readonly debut: string; readonly fin: string }> {
  const s = (
    await porte.lire<{ nom: string; debut: string; fin: string }>(
      'SELECT nom, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL AND debut <= ? AND fin >= ? ORDER BY debut DESC, id LIMIT 1',
      [fermeId, jour, jour],
    )
  )[0];
  const annee = jour.slice(0, 4);
  return s ?? { nom: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31` };
}

/** Le registre de la ferme (traitements en vigueur), à partir des traitements lus. */
export async function lireRegistre(porte: PorteDonnees, fermeId: string, traitements: readonly LigneLocaleRegistre[]): Promise<LigneRegistre[]> {
  if (traitements.length === 0) return [];
  const f = [fermeId];
  const [produit_phyto, emplacement, serie, campagne, plantation, espece, variete] = await Promise.all([
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, nom_commercial, numero_amm, substance_active, utilisable_en_bio FROM produit_phyto WHERE ferme_id = ? OR ferme_id IS NULL', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, code FROM emplacement WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, espece_id, variete_id FROM serie WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, plantation_id FROM campagne WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, espece_id, variete_id FROM plantation WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, nom FROM espece WHERE ferme_id = ? OR ferme_id IS NULL', f),
    porte.lire<LigneLocaleRegistre>('SELECT id, ferme_id, nom FROM variete WHERE ferme_id = ? OR ferme_id IS NULL', f),
  ]);
  return lignesRegistrePhyto({ evenement: traitements, produit_phyto, emplacement, serie, campagne, plantation, espece, variete }, fermeId);
}
