/**
 * Écritures de l'écran « Vannes » (T57) : vannes créées en lot, modifiées, supprimées, et ce
 * qu'elles arrosent (liens datés vanne ↔ emplacement), toutes par la porte. Une saisie = UNE
 * transaction locale (`porte.ecrireEnsemble`), donc un envoi, accepté ou refusé en entier ; hors
 * ligne compris. Ce que le serveur refuserait (apps/api/src/sync/structure.ts, T57) est refusé ici
 * avant d'écrire, et revérifié DANS la transaction : numéro unique, planches de la ferme, vanne qui
 * arrose encore. Les règles viennent du cœur (`@planif/core/irrigation`) : rien n'est recalculé ici.
 *
 * Jamais de DELETE ni d'écriture dans `modification` (le serveur l'écrit). Chaque écriture rend de
 * quoi l'annuler (bandeau « Annuler »), en une transaction.
 */
import { creerGenerateurId } from '@planif/core/identifiants';
import { changerLiens, type ChangementLiens, type LienVanne, type SaisieVanne, type VanneDuLot } from '@planif/core/irrigation';
import type { OrdreEcriture, VerificationEcriture } from '@planif/sync';
import { ordreInsertion } from '@planif/sync/import';
import type { ContexteParcellaire, Enregistrement } from '../ecritures.ts';

/**
 * Écriture refusée avant l'envoi (règle du serveur), avec un message clair. Propre à ce morceau :
 * importer celle du parcellaire ferait du morceau du parcellaire une dépendance de celui-ci (et
 * alourdirait le JavaScript de démarrage d'un utilitaire de Vite).
 */
export class EcritureRefusee extends Error {}

type Valeur = string | number | null;
type Lire = Parameters<VerificationEcriture>[0];

/** Colonnes écrites d'une vanne : l'adresse Modbus (phase 3) n'est jamais écrite par le téléphone. */
const COLONNES_VANNE = ['id', 'ferme_id', 'numero_vanne', 'nom', 'debit_litres_heure', 'placement_x_m', 'placement_y_m', 'cree_le', 'modifie_le', 'supprime_le'] as const;
const COLONNES_LIEN = ['id', 'ferme_id', 'secteur_irrigation_id', 'emplacement_id', 'du', 'au', 'cree_le', 'modifie_le', 'supprime_le'] as const;

/** Un générateur par horloge : des identifiants croissants d'un geste à l'autre. */
const generateurs = new WeakMap<() => Date, () => string>();
function nouvelId(ctx: ContexteParcellaire): () => string {
  let g = generateurs.get(ctx.maintenant);
  if (g === undefined) {
    const generer = creerGenerateurId({ horloge: () => ctx.maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    g = () => generer<'SecteurIrrigation'>();
    generateurs.set(ctx.maintenant, g);
  }
  return g;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${String(n)} ${n > 1 ? plusieurs : un}`;

function miseAJour(table: 'secteur_irrigation' | 'secteur_emplacement', id: string, valeurs: Readonly<Record<string, Valeur>>, iso: string): OrdreEcriture {
  const cles = Object.keys(valeurs);
  return { sql: `UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, parametres: [...cles.map((c) => valeurs[c] ?? null), iso, id] };
}

/** Vérifie d'abord sur la base telle qu'elle est (un refus n'ouvre aucune transaction), puis DANS la transaction. */
async function ecrireVerifie(ctx: ContexteParcellaire, ordres: readonly OrdreEcriture[], verifier: VerificationEcriture): Promise<void> {
  await verifier((sql, p) => ctx.porte.lire(sql, p));
  await ctx.porte.ecrireEnsemble(ordres, verifier);
}

/** Les numéros `numeros` sont libres parmi les vannes non supprimées de la ferme, hors `sauf`. */
async function verifierNumerosLibres(lire: Lire, fermeId: string, numeros: readonly number[], sauf: string | null): Promise<void> {
  const pris = await lire<{ id: string; numero_vanne: number }>('SELECT id, numero_vanne FROM secteur_irrigation WHERE ferme_id = ? AND supprime_le IS NULL', [fermeId]);
  const occupes = new Set(pris.filter((p) => p.id !== sauf).map((p) => p.numero_vanne));
  const double = numeros.find((n) => occupes.has(n));
  if (double !== undefined) throw new EcritureRefusee(`le numéro de vanne ${String(double)} existe déjà : choisissez-en un autre`);
}

/** Liens non supprimés de la vanne, lus dans la base locale. */
async function liensDe(lire: Lire, fermeId: string, secteurId: string): Promise<LienVanne[]> {
  const l = await lire<{ id: string; emplacement_id: string; du: string; au: string | null }>(
    'SELECT id, emplacement_id, du, au FROM secteur_emplacement WHERE ferme_id = ? AND secteur_irrigation_id = ? AND supprime_le IS NULL ORDER BY du, id',
    [fermeId, secteurId],
  );
  return l.map((x) => ({ id: x.id, secteurId, emplacementId: x.emplacement_id, du: x.du, au: x.au }));
}

async function lireVanne(ctx: ContexteParcellaire, id: string): Promise<Readonly<Record<string, Valeur>>> {
  const [v] = await ctx.porte.lire<Readonly<Record<string, Valeur>>>('SELECT * FROM secteur_irrigation WHERE id = ? AND ferme_id = ?', [id, ctx.fermeId]);
  if (v === undefined) throw new EcritureRefusee('cette vanne n’existe plus sur ce téléphone');
  return v;
}

// ── Création en lot ──────────────────────────────────────────────────────────────────────────

/** « 60 vannes, V1 à V60 » : le lot en UNE transaction ; les numéros sont revérifiés dans la transaction. */
export async function creerVannes(ctx: ContexteParcellaire, lot: readonly VanneDuLot[]): Promise<Enregistrement> {
  const iso = ctx.maintenant().toISOString();
  const generer = nouvelId(ctx);
  const ids = lot.map(() => generer());
  const ordres = lot.map((v, i) =>
    ordreInsertion('secteur_irrigation', COLONNES_VANNE, {
      id: ids[i] ?? null,
      ferme_id: ctx.fermeId,
      numero_vanne: v.numeroVanne,
      nom: v.nom,
      debit_litres_heure: null,
      placement_x_m: null,
      placement_y_m: null,
      cree_le: iso,
      modifie_le: iso,
      supprime_le: null,
    }),
  );
  await ecrireVerifie(ctx, ordres, (lire) =>
    verifierNumerosLibres(
      lire,
      ctx.fermeId,
      lot.map((v) => v.numeroVanne),
      null,
    ),
  );
  const premiere = lot[0]?.nom ?? '';
  const derniere = lot[lot.length - 1]?.nom ?? '';
  return {
    texte: lot.length === 1 ? `Vanne ${premiere} ajoutée` : `${String(lot.length)} vannes ajoutées, ${premiere} à ${derniere}`,
    annuler: async () => {
      const maintenant = ctx.maintenant().toISOString();
      await ctx.porte.ecrireEnsemble(ids.map((id) => miseAJour('secteur_irrigation', id, { supprime_le: maintenant }, maintenant)));
    },
  };
}

// ── Une vanne : ses valeurs et ce qu'elle arrose ─────────────────────────────────────────────

/** Ordres qui appliquent `c` (liens de la vanne), et ceux qui le défont. */
function ordresDesLiens(ctx: ContexteParcellaire, secteurId: string, liens: readonly LienVanne[], c: ChangementLiens, iso: string): { readonly faire: OrdreEcriture[]; readonly defaire: OrdreEcriture[] } {
  const generer = nouvelId(ctx);
  const faire: OrdreEcriture[] = [];
  const defaire: OrdreEcriture[] = [];
  for (const f of c.fermer) {
    faire.push(miseAJour('secteur_emplacement', f.id, { au: f.au }, iso));
    defaire.push(miseAJour('secteur_emplacement', f.id, { au: liens.find((l) => l.id === f.id)?.au ?? null }, iso));
  }
  for (const id of c.supprimer) {
    faire.push(miseAJour('secteur_emplacement', id, { supprime_le: iso }, iso));
    defaire.push(miseAJour('secteur_emplacement', id, { supprime_le: null }, iso));
  }
  for (const emplacementId of c.creer) {
    const id = generer();
    faire.push(ordreInsertion('secteur_emplacement', COLONNES_LIEN, { id, ferme_id: ctx.fermeId, secteur_irrigation_id: secteurId, emplacement_id: emplacementId, du: ctx.aujourdhui, au: null, cree_le: iso, modifie_le: iso, supprime_le: null }));
    defaire.push(miseAJour('secteur_emplacement', id, { supprime_le: iso }, iso));
  }
  return { faire, defaire };
}

/** Les emplacements `ids` sont de la ferme et non supprimés (une planche supprimée entre-temps n'est plus arrosée). */
async function verifierEmplacements(lire: Lire, fermeId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const l = await lire<{ n: unknown }>(`SELECT COUNT(*) AS n FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND id IN (${ids.map(() => '?').join(', ')})`, [fermeId, ...ids]);
  if (Number(l[0]?.n ?? 0) !== new Set(ids).size) throw new EcritureRefusee('une des planches cochées a été supprimée entre-temps');
}

/** Les liens de la vanne n'ont pas changé depuis leur lecture (synchro, autre onglet). */
async function verifierLiensInchanges(lire: Lire, fermeId: string, secteurId: string, lus: readonly LienVanne[]): Promise<void> {
  if (JSON.stringify(await liensDe(lire, fermeId, secteurId)) !== JSON.stringify(lus)) throw new EcritureRefusee('ce que la vanne arrose a changé entre-temps : rouvrez-la');
}

/**
 * « Enregistrer » la fiche d'une vanne : ses valeurs (si elles changent) et ce qu'elle arrose à
 * partir d'aujourd'hui (`changerLiens` du cœur : lien retiré fermé la veille, nouveau lien du jour),
 * en une transaction. null : rien n'a changé.
 */
export async function enregistrerVanne(ctx: ContexteParcellaire, id: string, saisie: SaisieVanne, voulus: readonly string[]): Promise<Enregistrement | null> {
  const avant = await lireVanne(ctx, id);
  const valeurs: Record<string, Valeur> = {};
  const nouvelles: Readonly<Record<string, Valeur>> = { numero_vanne: saisie.numeroVanne, nom: saisie.nom, debit_litres_heure: saisie.debitLitresHeure };
  for (const [c, v] of Object.entries(nouvelles)) if ((avant[c] ?? null) !== v) valeurs[c] = v;
  const liens = await liensDe((sql, p) => ctx.porte.lire(sql, p), ctx.fermeId, id);
  const c = changerLiens(liens, id, voulus, ctx.aujourdhui);
  const iso = ctx.maintenant().toISOString();
  const { faire, defaire } = ordresDesLiens(ctx, id, liens, c, iso);
  const champs = Object.keys(valeurs);
  if (champs.length === 0 && faire.length === 0) return null;
  const ordres = [...(champs.length > 0 ? [miseAJour('secteur_irrigation', id, valeurs, iso)] : []), ...faire];
  const numeroChange = 'numero_vanne' in valeurs;
  await ecrireVerifie(ctx, ordres, async (lire) => {
    if (numeroChange) await verifierNumerosLibres(lire, ctx.fermeId, [saisie.numeroVanne], id);
    await verifierEmplacements(lire, ctx.fermeId, c.creer);
    await verifierLiensInchanges(lire, ctx.fermeId, id, liens);
  });
  const anciennes = Object.fromEntries(champs.map((x) => [x, avant[x] ?? null]));
  const numeroAvant = Number(avant.numero_vanne);
  return {
    texte: `${saisie.nom} enregistrée`,
    annuler: async () => {
      const maintenant = ctx.maintenant().toISOString();
      const retour = [...(champs.length > 0 ? [miseAJour('secteur_irrigation', id, anciennes, maintenant)] : []), ...defaire];
      await ecrireVerifie(ctx, retour, async (lire) => {
        if (numeroChange) await verifierNumerosLibres(lire, ctx.fermeId, [numeroAvant], id);
      });
    },
  };
}

/** Suppression douce, refusée tant que la vanne arrose encore (règle du serveur). */
export async function supprimerVanne(ctx: ContexteParcellaire, id: string): Promise<Enregistrement> {
  const avant = await lireVanne(ctx, id);
  const iso = ctx.maintenant().toISOString();
  const verifier: VerificationEcriture = async (lire) => {
    const n = (await liensDe(lire, ctx.fermeId, id)).filter((l) => l.au === null || l.au >= ctx.aujourdhui).length;
    if (n > 0) throw new EcritureRefusee(`cette vanne arrose encore ${pluriel(n, 'planche', 'planches')} : décochez-les d’abord`);
  };
  await ecrireVerifie(ctx, [miseAJour('secteur_irrigation', id, { supprime_le: iso }, iso)], verifier);
  const numero = Number(avant.numero_vanne);
  return {
    texte: `Vanne ${String(avant.nom)} supprimée`,
    annuler: async () => {
      const maintenant = ctx.maintenant().toISOString();
      await ecrireVerifie(ctx, [miseAJour('secteur_irrigation', id, { supprime_le: null }, maintenant)], (lire) => verifierNumerosLibres(lire, ctx.fermeId, [numero], id));
    },
  };
}
