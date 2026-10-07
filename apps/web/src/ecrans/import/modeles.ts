/**
 * Modèles d'import de la ferme (T14b) : la correspondance validée d'un fichier, pour que le
 * suivant de même forme s'importe sans rien reprendre. Rangés dans le navigateur (localStorage),
 * par ferme, le plus récent d'abord. Tout ce qui est relu passe par `relireModele` (garde à
 * l'exécution, suite de la relecture de T14c) avant `appliquerModele` ou `creerModele`.
 */
import { appliquerModele, creerModele, lireModele, serialiserModele, type Cellule, type Correspondance, type ModeleImport } from '@planif/core';

/** Modèles gardés par ferme, au plus. */
const MODELES_MAX = 20;

const cleRangement = (fermeId: string): string => `planif:import:modeles:${fermeId}`;

/**
 * Relit un modèle rangé (texte JSON, ou objet relu d'IndexedDB ou du JSON). Rend le modèle,
 * identique à celui qu'on avait rangé et toujours accepté tel quel par `creerModele`, ou null.
 * Ne lève jamais, quelle que soit l'entrée.
 */
export function relireModele(brut: unknown): ModeleImport | null {
  try {
    let texte: string | undefined;
    if (typeof brut === 'string') texte = brut;
    else if (typeof brut === 'object' && brut !== null) texte = JSON.stringify(brut);
    if (texte === undefined) return null;
    const modele = lireModele(texte);
    if (modele === null) return null;
    // Toujours accepté par creerModele : sur ses propres en-têtes, avec ses choix.
    const entetes = modele.colonnes.map((c) => c.entete);
    const correspondance = appliquerModele(modele, entetes);
    if (correspondance === null) return null;
    const r = creerModele(entetes, correspondance, modele.choix);
    return r.ok ? modele : null;
  } catch {
    return null;
  }
}

function stockage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Modèles de la ferme, relus un à un (un modèle illisible est écarté). */
export function modelesDeLaFerme(fermeId: string): ModeleImport[] {
  try {
    const texte = stockage()?.getItem(cleRangement(fermeId)) ?? null;
    if (texte === null) return [];
    const liste: unknown = JSON.parse(texte);
    if (!Array.isArray(liste)) return [];
    return liste.map((m) => relireModele(m)).filter((m): m is ModeleImport => m !== null);
  } catch {
    return [];
  }
}

/** Le premier modèle de la ferme qui convient aux en-têtes, avec sa correspondance. */
export function modeleQuiConvient(fermeId: string, entetes: readonly Cellule[]): { readonly modele: ModeleImport; readonly correspondance: Correspondance } | null {
  for (const modele of modelesDeLaFerme(fermeId)) {
    const correspondance = appliquerModele(modele, entetes);
    if (correspondance !== null) return { modele, correspondance };
  }
  return null;
}

/** Range le modèle en tête (un modèle de mêmes en-têtes est remplacé). Rend faux si le navigateur refuse. */
export function rangerModele(fermeId: string, modele: ModeleImport): boolean {
  try {
    const s = stockage();
    if (s === null) return false;
    const memesEntetes = (m: ModeleImport) => appliquerModele(m, modele.colonnes.map((c) => c.entete)) !== null;
    const autres = modelesDeLaFerme(fermeId).filter((m) => !memesEntetes(m));
    const liste = [modele, ...autres].slice(0, MODELES_MAX).map((m) => JSON.parse(serialiserModele(m)) as unknown);
    s.setItem(cleRangement(fermeId), JSON.stringify(liste));
    return true;
  } catch {
    return false;
  }
}
