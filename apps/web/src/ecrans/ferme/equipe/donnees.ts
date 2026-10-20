/**
 * Équipe de la ferme (T60, règle 1) : lectures et écritures par la porte. Chaque écriture est UNE
 * transaction ; la ligne complète est vérifiée par la règle du serveur (`validerPersonne`) avant
 * d'être écrite. Jamais de DELETE : retirer pose `supprime_le`. Réservé au gérant actif (refusé
 * ici avant le serveur, qui le refuse aussi).
 */
import { creerGenerateurId, validerPersonne } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

export type Valeur = string | number | null;
type Ligne = Readonly<Record<string, Valeur>>;

export interface PersonneLue {
  readonly id: string;
  readonly prenom: string;
  readonly membreId: string | null;
}

export interface MembreLu {
  readonly id: string;
  readonly gerant: boolean;
  /** Les 4 derniers caractères de l'id, en majuscules (plus s'ils sont ceux d'un autre membre) : ce que l'équipier dit au gérant pour être lié. */
  readonly code: string;
}

export interface EquipeLue {
  readonly personnes: readonly PersonneLue[];
  /** Membres actifs de la ferme : gérants d'abord, puis par code. */
  readonly membres: readonly MembreLu[];
  /** Mon membre dans la ferme, ou null. */
  readonly moi: MembreLu | null;
}

export interface ContexteEquipe {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant: () => Date;
}

/** Écriture refusée avant l'envoi (droits, règle du serveur), avec un message clair. */
export class EquipeRefusee extends Error {}

export const SEUL_LE_GERANT_EQUIPE = 'seul le gérant de la ferme compose l’équipe';

const COLONNES = ['id', 'ferme_id', 'prenom', 'membre_id', 'cree_le', 'modifie_le', 'supprime_le'] as const;
const SQL_MEMBRES = "SELECT id, utilisateur_id, role FROM membre WHERE ferme_id = ? AND etat = 'accepte' AND supprime_le IS NULL";

const texte = (v: Valeur | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
export const codeDuMembre = (id: string): string => id.slice(-4).toUpperCase();

/**
 * Code de chaque membre (clé : id en minuscules) : ses 4 derniers caractères, allongés tant qu'un
 * autre membre de la ferme a le même (relecture T60 : un code partagé ferait lier le mauvais compte).
 */
export function codesDesMembres(ids: readonly string[]): ReadonlyMap<string, string> {
  const nus = [...new Set(ids.map((i) => i.toLowerCase()))].map((i) => [i, i.replace(/-/g, '')] as const);
  const codes = new Map<string, string>();
  for (const [i, nu] of nus) {
    let n = 4;
    while (n < nu.length && nus.some(([j, autre]) => j !== i && autre.endsWith(nu.slice(-n)))) n++;
    codes.set(i, nu.slice(-n).toUpperCase());
  }
  return codes;
}

/** L'équipe active et les membres de la ferme, vus par l'utilisateur. Lecture seule. */
export async function lireEquipe(porte: PorteDonnees, fermeId: string, utilisateurId: string): Promise<EquipeLue> {
  const [personnes, membres] = await Promise.all([
    porte.lire<Ligne>('SELECT id, prenom, membre_id FROM personne WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY prenom, id', [fermeId]),
    porte.lire<Ligne>(SQL_MEMBRES, [fermeId]),
  ]);
  const codes = codesDesMembres(membres.map((m) => texte(m.id)));
  const lus = membres
    .map((m) => ({ id: texte(m.id).toLowerCase(), gerant: m.role === 'gerant', code: codes.get(texte(m.id).toLowerCase()) ?? codeDuMembre(texte(m.id)), utilisateur: texte(m.utilisateur_id).toLowerCase() }))
    .sort((a, b) => Number(b.gerant) - Number(a.gerant) || a.code.localeCompare(b.code));
  const moi = lus.find((m) => m.utilisateur === utilisateurId.toLowerCase());
  return {
    personnes: personnes.map((p) => ({ id: texte(p.id).toLowerCase(), prenom: texte(p.prenom), membreId: p.membre_id === null || p.membre_id === undefined ? null : texte(p.membre_id).toLowerCase() })),
    membres: lus.map(({ id, gerant, code }) => ({ id, gerant, code })),
    moi: moi === undefined ? null : { id: moi.id, gerant: moi.gerant, code: moi.code },
  };
}

async function verifierGerant(ctx: ContexteEquipe): Promise<void> {
  const l = await ctx.porte.lire<Ligne>(`${SQL_MEMBRES} AND utilisateur_id = ? AND role = 'gerant'`, [ctx.fermeId, ctx.utilisateurId]);
  if (l.length === 0) throw new EquipeRefusee(SEUL_LE_GERANT_EQUIPE);
}

function verifier(l: Readonly<Record<string, Valeur>>): void {
  const r = validerPersonne({ ...l });
  if (!r.ok) throw new EquipeRefusee(r.erreur.message);
}

/** Ajoute une personne sans compte (prénom seul) ; rend son id. */
export async function ajouterPersonne(ctx: ContexteEquipe, prenom: string): Promise<string> {
  await verifierGerant(ctx);
  const iso = ctx.maintenant().toISOString();
  const generer = creerGenerateurId({ horloge: () => ctx.maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  const l: Record<string, Valeur> = { id: generer<'Personne'>(), ferme_id: ctx.fermeId, prenom: prenom.trim(), membre_id: null, cree_le: iso, modifie_le: iso, supprime_le: null };
  verifier(l);
  await ctx.porte.ecrireEnsemble([{ sql: `INSERT INTO personne (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`, parametres: COLONNES.map((c) => l[c] ?? null) }]);
  return String(l.id);
}

/**
 * Change une personne (compte lié, retrait, rétablissement) ; rend les valeurs d'avant des colonnes
 * changées, à redonner pour annuler. Un compte déjà lié à une autre personne active est refusé.
 */
export async function changerPersonne(ctx: ContexteEquipe, id: string, valeurs: Readonly<Record<string, Valeur>>): Promise<Readonly<Record<string, Valeur>>> {
  await verifierGerant(ctx);
  const avant = (await ctx.porte.lire<Ligne>(`SELECT ${COLONNES.join(', ')} FROM personne WHERE id = ? AND ferme_id = ?`, [id, ctx.fermeId]))[0];
  if (avant === undefined) throw new EquipeRefusee('personne introuvable sur ce téléphone');
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return {};
  const apres = { ...avant, ...valeurs };
  const membre = apres.membre_id;
  if (typeof membre === 'string' && apres.supprime_le === null) {
    const autre = await ctx.porte.lire<Ligne>('SELECT id FROM personne WHERE membre_id = ? AND supprime_le IS NULL AND id <> ?', [membre, id]);
    if (autre.length > 0) throw new EquipeRefusee('ce compte est déjà celui d’une autre personne de l’équipe');
  }
  const iso = ctx.maintenant().toISOString();
  verifier({ ...apres, modifie_le: iso });
  await ctx.porte.ecrireEnsemble([
    {
      sql: `UPDATE personne SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ? AND ferme_id = ?`,
      parametres: [...changees.map((c) => valeurs[c] ?? null), iso, id, ctx.fermeId],
    },
  ]);
  return Object.fromEntries(changees.map((c) => [c, avant[c] ?? null]));
}
