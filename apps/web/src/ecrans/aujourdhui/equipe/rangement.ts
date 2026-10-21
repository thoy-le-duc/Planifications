/**
 * T61 (règle 3) : où est rangé l'outil d'un travail prévu, pour la fiche du jour. Lu à la demande
 * (fiche ouverte), dans la ferme de la porte seulement, lignes non supprimées : outil, son lieu de
 * rangement (bâtiment ou point du plan) et sa place. Le travail prévu porte le NOM de l'outil :
 * `trouverOutil` du cœur le retrouve (sans majuscules, accents ni espaces autour).
 */
import { libelleRangement, trouverOutil } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';

export interface OutilRange {
  readonly id: string;
  readonly nom: string;
  /** Nom du bâtiment ou du point du plan du lieu. */
  readonly lieu: string;
  /** Nom de la place dans le lieu, ou null. */
  readonly place: string | null;
}

type Ligne = Readonly<Record<string, unknown>>;
const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const SQL_OUTILS = `SELECT o.id, o.nom, coalesce(b.nom, pp.nom) AS lieu, pr.nom AS place
  FROM outil o
  JOIN lieu_rangement l ON l.id = o.lieu_rangement_id AND l.ferme_id = o.ferme_id AND l.supprime_le IS NULL
  LEFT JOIN batiment b ON b.id = l.batiment_id AND b.ferme_id = o.ferme_id AND b.supprime_le IS NULL
  LEFT JOIN point_plan pp ON pp.id = l.point_plan_id AND pp.ferme_id = o.ferme_id AND pp.supprime_le IS NULL
  LEFT JOIN place_rangement pr ON pr.id = o.place_rangement_id AND pr.ferme_id = o.ferme_id AND pr.supprime_le IS NULL AND pr.lieu_rangement_id = o.lieu_rangement_id
  WHERE o.ferme_id = ? AND o.supprime_le IS NULL
  ORDER BY o.id`;

function outilDe(l: Ligne): OutilRange | null {
  const id = texte(l.id);
  const nom = texte(l.nom);
  const lieu = texte(l.lieu);
  // Lieu dont le bâtiment ou le point est retiré : l'outil n'a plus de place connue.
  if (id === null || nom === null || lieu === null || lieu.trim() === '') return null;
  return { id, nom, lieu, place: texte(l.place) };
}

/** Suit les outils rangés de la ferme ; rend de quoi arrêter. */
export function suivreOutils(porte: PorteDonnees, fermeId: string, surOutils: (outils: readonly OutilRange[]) => void): () => void {
  return porte.surveiller(
    { sql: SQL_OUTILS, parametres: [fermeId], tables: ['outil', 'lieu_rangement', 'place_rangement', 'batiment', 'point_plan'] },
    (lignes: readonly Ligne[]) => {
      surOutils(lignes.map(outilDe).filter((o): o is OutilRange => o !== null));
    },
  );
}

/** L'outil rangé que désigne le nom du travail prévu, et son libellé (« Grelinette — hangar, mur nord ») ; null si aucun. */
export function rangementDe(nomTravail: string, outils: readonly OutilRange[]): { readonly outil: OutilRange; readonly libelle: string } | null {
  const outil = trouverOutil(nomTravail, outils);
  return outil === null ? null : { outil, libelle: libelleRangement(outil.nom, outil.lieu, outil.place) };
}
