/**
 * Produits fertilisants de la ferme et cahier de fertilisation (T54) : lectures et écritures par la
 * porte. Chaque enregistrement est UNE transaction ; la ligne complète est vérifiée par la règle du
 * serveur (`validerProduitFertilisant`) avant d'être écrite. Jamais de DELETE : archiver pose
 * `supprime_le`. Jamais d'écriture dans `modification` (le serveur l'écrit).
 */
import {
  alertesAzoteOrganique,
  bilanFertilisation,
  creerGenerateurId,
  FERTILISANTS_DEPART,
  validerProduitFertilisant,
  type AlerteAzote,
  type BilanFertilisation,
  type FormeFertilisant,
  type LigneLocaleFertilisation,
  type UniteFertilisant,
} from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class ProduitRefuse extends Error {}

export type Valeur = string | number | null;
export type LigneProduit = Readonly<Record<string, Valeur>>;

/** Ce que le formulaire saisit (teneurs déjà lues en nombres, facultatives). */
export interface ValeursProduit {
  readonly nom: string;
  readonly forme: FormeFertilisant;
  readonly unite: UniteFertilisant;
  readonly teneurN: number | null;
  readonly teneurP2o5: number | null;
  readonly teneurK2o: number | null;
  readonly organique: boolean;
  readonly utilisableEnBio: boolean;
  readonly source: string;
}

export interface ContexteFertilisation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

const COLONNES = ['id', 'ferme_id', 'nom', 'forme', 'unite', 'teneur_n', 'teneur_p2o5', 'teneur_k2o', 'organique', 'utilisable_en_bio', 'source', 'cree_le', 'modifie_le', 'supprime_le'] as const;

/** Tous les produits de la ferme, archivés compris. */
export const SQL_PRODUITS_FERME = `SELECT ${COLONNES.join(', ')} FROM produit_fertilisant WHERE ferme_id = ? ORDER BY nom, id`;

const INSERT = `INSERT INTO produit_fertilisant (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`;

function nouvelId(maintenant: () => Date): () => string {
  const generer = creerGenerateurId({ horloge: () => maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  return () => generer<'ProduitFertilisant'>();
}

function colonnesDe(v: ValeursProduit): Record<string, Valeur> {
  return {
    nom: v.nom.trim(),
    forme: v.forme,
    unite: v.unite,
    teneur_n: v.teneurN,
    teneur_p2o5: v.teneurP2o5,
    teneur_k2o: v.teneurK2o,
    organique: v.organique ? 1 : 0,
    utilisable_en_bio: v.utilisableEnBio ? 1 : 0,
    source: v.source.trim(),
  };
}

function verifier(l: Readonly<Record<string, Valeur>>): void {
  const r = validerProduitFertilisant({ ...l });
  if (!r.ok) throw new ProduitRefuse(r.erreur.message);
}

function ligneNeuve(ctx: ContexteFertilisation, id: string, v: ValeursProduit): Record<string, Valeur> {
  const iso = ctx.maintenant().toISOString();
  return { id, ferme_id: ctx.fermeId, ...colonnesDe(v), cree_le: iso, modifie_le: iso, supprime_le: null };
}

async function lire(ctx: ContexteFertilisation, id: string): Promise<LigneProduit> {
  const l = (await ctx.porte.lire<LigneProduit>(`SELECT ${COLONNES.join(', ')} FROM produit_fertilisant WHERE id = ? AND ferme_id = ?`, [id, ctx.fermeId]))[0];
  if (l === undefined) throw new ProduitRefuse('produit introuvable sur ce téléphone');
  return l;
}

/** Crée le produit (une transaction) ; rend son id. */
export async function creerProduit(ctx: ContexteFertilisation, v: ValeursProduit): Promise<string> {
  const l = ligneNeuve(ctx, nouvelId(ctx.maintenant)(), v);
  verifier(l);
  await ctx.porte.ecrireEnsemble([{ sql: INSERT, parametres: COLONNES.map((c) => l[c] ?? null) }]);
  return String(l.id);
}

/** Liste de départ (FERTILISANTS_DEPART) écrite dans la ferme, en UNE transaction. */
export async function ajouterListeDeDepart(ctx: ContexteFertilisation): Promise<void> {
  const id = nouvelId(ctx.maintenant);
  const lignes = FERTILISANTS_DEPART.map((p) => ligneNeuve(ctx, id(), p));
  for (const l of lignes) verifier(l);
  await ctx.porte.ecrireEnsemble(lignes.map((l) => ({ sql: INSERT, parametres: COLONNES.map((c) => l[c] ?? null) })));
}

/** UPDATE des colonnes qui changent (et modifie_le), après vérification de la ligne complète. */
async function changer(ctx: ContexteFertilisation, id: string, valeurs: Readonly<Record<string, Valeur>>): Promise<void> {
  const avant = await lire(ctx, id);
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return;
  const iso = ctx.maintenant().toISOString();
  verifier({ ...avant, ...valeurs, modifie_le: iso });
  await ctx.porte.ecrireEnsemble([
    {
      sql: `UPDATE produit_fertilisant SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`,
      parametres: [...changees.map((c) => valeurs[c] ?? null), iso, id, ctx.fermeId],
    },
  ]);
}

export function modifierProduit(ctx: ContexteFertilisation, id: string, v: ValeursProduit): Promise<void> {
  return changer(ctx, id, colonnesDe(v));
}

/** Archive (suppression douce) : les apports passés gardent leur produit. */
export function archiverProduit(ctx: ContexteFertilisation, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: ctx.maintenant().toISOString() });
}

export function retablirProduit(ctx: ContexteFertilisation, id: string): Promise<void> {
  return changer(ctx, id, { supprime_le: null });
}

// ── Cahier ───────────────────────────────────────────────────────────────────────────────────

/** Tables dont un changement relit le cahier. */
export const TABLES_CAHIER = ['evenement', 'produit_fertilisant', 'emplacement', 'saison', 'serie', 'occupation', 'ferme', 'secteur_emplacement'] as const;

export const SQL_FERME = 'SELECT zone_vulnerable_nitrates AS zone FROM ferme WHERE id = ?';

/**
 * Option « zone vulnérable nitrates » cochée ou non (une transaction). Cette seule colonne : le
 * serveur n'accepte de `ferme` que l'origine du plan et cette option (modifie_le est le sien).
 */
export async function ecrireZoneVulnerable(ctx: Pick<ContexteFertilisation, 'porte' | 'fermeId'>, cochee: boolean): Promise<void> {
  await ctx.porte.ecrireEnsemble([{ sql: 'UPDATE ferme SET zone_vulnerable_nitrates = ? WHERE id = ?', parametres: [cochee ? 1 : 0, ctx.fermeId] }]);
}

/** Période du cahier : la saison qui contient le jour, à défaut l'année civile (comme le registre phyto). */
export async function periodeDuCahier(porte: PorteDonnees, fermeId: string, jour: string): Promise<{ readonly nom: string; readonly debut: string; readonly fin: string }> {
  const s = (
    await porte.lire<{ nom: string; debut: string; fin: string }>(
      'SELECT nom, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL AND debut <= ? AND fin >= ? ORDER BY debut DESC, id DESC LIMIT 1',
      [fermeId, jour, jour],
    )
  )[0];
  const annee = jour.slice(0, 4);
  return s ?? { nom: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31` };
}

export interface CahierLu {
  readonly bilan: BilanFertilisation;
  readonly alertes: readonly AlerteAzote[];
  readonly zoneVulnerable: boolean;
  /** Code de chaque emplacement de la ferme, par id en minuscules. */
  readonly codes: ReadonlyMap<string, string>;
}

/** Lit ce qu'il faut et calcule le bilan (règle du cœur, la même que l'export). */
export async function lireCahier(porte: PorteDonnees, fermeId: string): Promise<CahierLu> {
  const f = [fermeId];
  const [evenement, produit_fertilisant, emplacement, saison, serie, occupation, ferme, secteur_emplacement] = await Promise.all([
    // T56 : les irrigations aussi (une fertirrigation entre au cahier).
    porte.lire<LigneLocaleFertilisation>(
      `SELECT id, ferme_id, type, date, horodatage, serie_id, campagne_id, emplacement_ids, remplace_sorte, remplace_evenement_id, detail FROM evenement WHERE ferme_id = ? AND type IN ('intervention', 'irrigation')`,
      f,
    ),
    porte.lire<LigneLocaleFertilisation>(SQL_PRODUITS_FERME, f),
    porte.lire<LigneLocaleFertilisation>('SELECT id, ferme_id, code, longueur_m, largeur_m FROM emplacement WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleFertilisation>('SELECT id, ferme_id, nom, debut, fin, supprime_le FROM saison WHERE ferme_id = ?', f),
    porte.lire<LigneLocaleFertilisation>(
      'SELECT id, ferme_id, statut, supprime_le, parametres, prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte FROM serie WHERE ferme_id = ?',
      f,
    ),
    porte.lire<LigneLocaleFertilisation>('SELECT id, ferme_id, serie_id, emplacement_id, supprime_le FROM occupation WHERE ferme_id = ? AND serie_id IS NOT NULL', f),
    porte.lire<{ zone: number | null }>(SQL_FERME, f),
    porte.lire<LigneLocaleFertilisation>('SELECT id, ferme_id, secteur_irrigation_id, emplacement_id, du, au, supprime_le FROM secteur_emplacement WHERE ferme_id = ?', f),
  ]);
  const bilan = bilanFertilisation({ evenement, produit_fertilisant, emplacement, saison, serie, occupation, secteur_emplacement }, fermeId);
  const codes = new Map(emplacement.map((e) => [String(e.id).toLowerCase(), String(e.code ?? '')]));
  return { bilan, alertes: alertesAzoteOrganique(bilan), zoneVulnerable: ferme[0]?.zone === 1, codes };
}
