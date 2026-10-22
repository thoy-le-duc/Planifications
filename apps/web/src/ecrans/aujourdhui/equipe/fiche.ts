/**
 * T60 (règle 5) : la fiche du jour d'une personne — numéro, planche, travail, outil — et sa
 * version en image à partager. Pur pour les lignes ; l'image passe par un canvas du navigateur.
 */
import { travauxDe } from '@planif/core';
import type { TravailVu } from '../vues.ts';
import { COULEURS } from '../../../ui/jetons.ts';

export interface LigneFiche {
  readonly cle: string;
  /** 1, 2, 3… dans l'ordre de l'écran (la 3D numérote de même). */
  readonly numero: number;
  /** Codes des emplacements, ou « sans planche ». */
  readonly planche: string;
  /** « Grelinette batavia ». */
  readonly travail: string;
  /** Outil du travail prévu, sinon ''. */
  readonly outil: string;
  /** T61 : premier emplacement du travail, ou null. */
  readonly plancheId: string | null;
  /** Travail attribué à personne : pour toute l'équipe. */
  readonly pourTous: boolean;
}

/** Les travaux de la personne (les siens et ceux de personne), dans l'ordre reçu, numérotés. */
export function lignesFiche(travaux: readonly TravailVu[], parTache: ReadonlyMap<string, readonly string[]>, personneId: string): LigneFiche[] {
  return travauxDe(travaux, parTache, personneId).map((t, i) => ({
    cle: t.cle,
    numero: i + 1,
    planche: t.planche,
    travail: t.phrase,
    outil: t.outil,
    plancheId: t.plancheId,
    pourTous: (parTache.get(t.cle) ?? []).length === 0,
  }));
}

/** La fiche en image PNG (titre, puis une ligne par travail), ou null si le navigateur ne dessine pas. */
export async function ficheEnImage(titre: string, lignes: readonly LigneFiche[]): Promise<Blob | null> {
  const largeur = 1080;
  const hauteurLigne = 64;
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = 160 + Math.max(1, lignes.length) * hauteurLigne;
  const c = toile.getContext('2d');
  if (c === null) return null;
  // Image partagée hors de l'appli : thème clair, lisible sur tout écran.
  c.fillStyle = COULEURS.surface;
  c.fillRect(0, 0, toile.width, toile.height);
  c.fillStyle = COULEURS.encre;
  c.font = 'bold 44px sans-serif';
  c.fillText(titre, 40, 80);
  c.font = '32px sans-serif';
  lignes.forEach((l, i) => {
    const y = 160 + i * hauteurLigne;
    const outil = l.outil === '' ? '' : ` — ${l.outil}`;
    c.fillText(`${String(l.numero)}.  ${l.planche}  ${l.travail}${outil}${l.pourTous ? ' (pour tous)' : ''}`, 40, y, largeur - 80);
  });
  if (lignes.length === 0) c.fillText('Aucun travail aujourd’hui.', 40, 160);
  return new Promise((rendre) => {
    toile.toBlob(rendre, 'image/png');
  });
}
