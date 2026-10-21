/**
 * Recettes de fertirrigation de la ferme (T56) : lectures et écritures par la porte. Chaque
 * enregistrement est UNE transaction ; la ligne complète est vérifiée par la règle du serveur
 * (`validerRecetteFertirrigation`) avant d'être écrite. Jamais de DELETE : archiver pose
 * `supprime_le`. Jamais d'écriture dans `modification` (le serveur l'écrit).
 */
import { creerGenerateurId, validerRecetteFertirrigation, type EngraisRecette } from '@planif/core';
import { ProduitRefuse, type ContexteFertilisation, type Valeur } from './donnees.ts';

export type LigneRecette = Readonly<Record<string, Valeur>>;

export interface ValeursRecette {
  readonly nom: string;
  readonly tauxInjection: number | null;
  readonly engrais: readonly EngraisRecette[];
  readonly ecCible: number | null;
  readonly phCible: number | null;
}

const COLONNES = ['id', 'ferme_id', 'nom', 'taux_injection', 'engrais', 'ec_cible', 'ph_cible', 'cree_le', 'modifie_le', 'supprime_le'] as const;

/** Toutes les recettes de la ferme, archivées comprises. */
export const SQL_RECETTES_FERME = `SELECT ${COLONNES.join(', ')} FROM recette_fertirrigation WHERE ferme_id = ? ORDER BY nom, id`;

const INSERT = `INSERT INTO recette_fertirrigation (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`;

function colonnesDe(v: ValeursRecette): Record<string, Valeur> {
  return { nom: v.nom.trim(), taux_injection: v.tauxInjection, engrais: JSON.stringify(v.engrais), ec_cible: v.ecCible, ph_cible: v.phCible };
}

function verifier(l: Readonly<Record<string, Valeur>>): void {
  const r = validerRecetteFertirrigation({ ...l });
  if (!r.ok) throw new ProduitRefuse(r.erreur.message);
}

/** Crée la recette (une transaction) ; rend son id. */
export async function creerRecette(ctx: ContexteFertilisation, v: ValeursRecette): Promise<string> {
  const generer = creerGenerateurId({ horloge: () => ctx.maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  const iso = ctx.maintenant().toISOString();
  const l: Record<string, Valeur> = { id: generer<'RecetteFertirrigation'>(), ferme_id: ctx.fermeId, ...colonnesDe(v), cree_le: iso, modifie_le: iso, supprime_le: null };
  verifier(l);
  await ctx.porte.ecrireEnsemble([{ sql: INSERT, parametres: COLONNES.map((c) => l[c] ?? null) }]);
  return String(l.id);
}

async function changer(ctx: ContexteFertilisation, id: string, valeurs: Readonly<Record<string, Valeur>>): Promise<void> {
  const avant = (await ctx.porte.lire<LigneRecette>(`SELECT ${COLONNES.join(', ')} FROM recette_fertirrigation WHERE id = ? AND ferme_id = ?`, [id, ctx.fermeId]))[0];
  if (avant === undefined) throw new ProduitRefuse('recette introuvable sur ce téléphone');
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return;
  const iso = ctx.maintenant().toISOString();
  verifier({ ...avant, ...valeurs, modifie_le: iso });
  await ctx.porte.ecrireEnsemble([
    {
      sql: `UPDATE recette_fertirrigation SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`,
      parametres: [...changees.map((c) => valeurs[c] ?? null), iso, id, ctx.fermeId],
    },
  ]);
}

export function modifierRecette(ctx: ContexteFertilisation, id: string, v: ValeursRecette): Promise<void> {
  return changer(ctx, id, colonnesDe(v));
}

/** Archive (suppression douce) : les irrigations passées gardent leurs doses. */
export function archiverRecette(ctx: ContexteFertilisation, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: ctx.maintenant().toISOString() });
}

export function retablirRecette(ctx: ContexteFertilisation, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: null });
}
