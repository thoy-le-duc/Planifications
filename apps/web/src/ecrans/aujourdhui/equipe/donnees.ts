/**
 * Équipe de la ferme et attribution des travaux du jour (T60) : lectures et écritures par la
 * porte, sans React. Chargé à la demande (hors du morceau d'Aujourd'hui), partagé avec la vue 3D
 * (plan3d/travaux.ts). Chaque attribution est UNE transaction locale ; ses lignes sont vérifiées
 * par la règle du serveur (`validerAttribution`) avant d'être écrites. Jamais de DELETE : retirer
 * pose `supprime_le`. Écrire est réservé au gérant (refusé ici avant le serveur, qui le refuse
 * aussi).
 */
import { creerGenerateurId, personnesParTache, planAttribution, validerAttribution, type AttributionLue } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';

export interface PersonneEquipe {
  readonly id: string;
  readonly prenom: string;
  readonly membreId: string | null;
}

/** Ce que l'écran et la 3D savent de l'équipe. */
export interface Equipe {
  /** Personnes actives, par prénom. */
  readonly personnes: readonly PersonneEquipe[];
  /** La personne de l'utilisateur (liée à son membre actif), ou null. */
  readonly moi: string | null;
  /** L'utilisateur est gérant actif de la ferme. */
  readonly gerant: boolean;
  /** Personnes actives de chaque travail attribué (personnesParTache du cœur). */
  readonly parTache: ReadonlyMap<string, readonly string[]>;
}

/** Message du refus local d'une écriture par un équipier (le serveur refuse de même). */
export const SEUL_LE_GERANT = 'Seul le gérant de la ferme attribue les travaux.';

type Valeur = string | number | null;
type Ligne = Readonly<Record<string, Valeur>>;

const SQL_PERSONNES = 'SELECT id, prenom, membre_id FROM personne WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY prenom, id';
const SQL_ATTRIBUTIONS = 'SELECT id, cle_tache, personne_id, supprime_le FROM attribution WHERE ferme_id = ?';
const SQL_MEMBRE = "SELECT id, role FROM membre WHERE ferme_id = ? AND utilisateur_id = ? AND etat = 'accepte' AND supprime_le IS NULL";

const texte = (v: Valeur | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

function attributionsLues(lignes: readonly Ligne[]): AttributionLue[] {
  return lignes.map((l) => ({ id: texte(l.id), cleTache: texte(l.cle_tache), personneId: texte(l.personne_id).toLowerCase(), supprimee: l.supprime_le !== null && l.supprime_le !== undefined }));
}

async function membreDe(porte: PorteDonnees, fermeId: string, utilisateurId: string | undefined): Promise<{ readonly id: string; readonly gerant: boolean } | null> {
  if (utilisateurId === undefined) return null;
  const l = (await porte.lire<Ligne>(SQL_MEMBRE, [fermeId, utilisateurId]))[0];
  return l === undefined ? null : { id: texte(l.id).toLowerCase(), gerant: l.role === 'gerant' };
}

/** L'équipe de la ferme, vue par `utilisateurId`. Lecture seule. */
export async function lireEquipe(porte: PorteDonnees, fermeId: string, utilisateurId: string | undefined): Promise<Equipe> {
  const [personnes, attributions, membre] = await Promise.all([porte.lire<Ligne>(SQL_PERSONNES, [fermeId]), porte.lire<Ligne>(SQL_ATTRIBUTIONS, [fermeId]), membreDe(porte, fermeId, utilisateurId)]);
  const liste: PersonneEquipe[] = personnes.map((p) => ({ id: texte(p.id).toLowerCase(), prenom: texte(p.prenom), membreId: p.membre_id === null || p.membre_id === undefined ? null : texte(p.membre_id).toLowerCase() }));
  const actives = new Set(liste.map((p) => p.id));
  // Une attribution à une personne retirée de l'équipe ne compte plus : le travail redevient pour tous.
  const parTache = personnesParTache(attributionsLues(attributions).filter((a) => actives.has(a.personneId)));
  const moi = membre === null ? null : (liste.find((p) => p.membreId === membre.id)?.id ?? null);
  return { personnes: liste, moi, gerant: membre?.gerant === true, parTache };
}

/** Suit l'équipe (écriture locale ou synchro) : `rappel` tout de suite, puis à chaque changement. Rend l'arrêt. */
export function suivreEquipe(porte: PorteDonnees, fermeId: string, utilisateurId: string | undefined, rappel: (e: Equipe) => void): () => void {
  let actif = true;
  let numero = 0;
  const lire = () => {
    const n = ++numero;
    lireEquipe(porte, fermeId, utilisateurId).then(
      (e) => {
        if (actif && n === numero) rappel(e);
      },
      (erreur: unknown) => {
        console.error('Équipe illisible', erreur);
      },
    );
  };
  // Requête vide : seul le signal de changement sert.
  const fin = porte.surveiller({ sql: 'SELECT 1 AS signal', tables: ['personne', 'attribution', 'membre'] }, lire);
  return () => {
    actif = false;
    fin();
  };
}

/**
 * Donne à chaque travail de `voulues` exactement ses personnes, en UNE transaction (planAttribution
 * du cœur). Rend l'état d'avant (les personnes de chaque travail), à redonner pour annuler.
 * Refusé sans rien écrire pour qui n'est pas gérant actif.
 */
export async function attribuer(
  porte: PorteDonnees,
  fermeId: string,
  utilisateurId: string | undefined,
  voulues: ReadonlyMap<string, readonly string[]>,
  maintenant: () => Date = () => new Date(),
): Promise<ReadonlyMap<string, readonly string[]>> {
  const membre = await membreDe(porte, fermeId, utilisateurId);
  if (membre?.gerant !== true) throw new Error(SEUL_LE_GERANT);
  const lignes = attributionsLues(await porte.lire<Ligne>(SQL_ATTRIBUTIONS, [fermeId]));
  const avantParTache = personnesParTache(lignes);
  const avant = new Map([...voulues.keys()].map((cle) => [cle, avantParTache.get(cle) ?? []]));
  const plan = planAttribution(lignes, voulues);
  const iso = maintenant().toISOString();
  const generer = creerGenerateurId({ horloge: () => maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  const ordres: OrdreEcriture[] = [];
  for (const c of plan.creer) {
    const ligne = { id: generer<'Attribution'>(), ferme_id: fermeId, personne_id: c.personneId, cle_tache: c.cleTache, cree_le: iso, modifie_le: iso, supprime_le: null };
    const r = validerAttribution(ligne);
    if (!r.ok) throw new Error(r.erreur.message);
    ordres.push({
      sql: 'INSERT INTO attribution (id, ferme_id, personne_id, cle_tache, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)',
      parametres: [ligne.id, ligne.ferme_id, ligne.personne_id, ligne.cle_tache, iso, iso],
    });
  }
  for (const id of plan.retablir) ordres.push({ sql: 'UPDATE attribution SET supprime_le = NULL, modifie_le = ? WHERE id = ? AND ferme_id = ?', parametres: [iso, id, fermeId] });
  for (const id of plan.retirer) ordres.push({ sql: 'UPDATE attribution SET supprime_le = ?, modifie_le = ? WHERE id = ? AND ferme_id = ?', parametres: [iso, iso, id, fermeId] });
  await porte.ecrireEnsemble(ordres);
  return avant;
}
