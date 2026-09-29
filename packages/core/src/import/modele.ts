/**
 * Modèle d'import (T14) : la correspondance validée d'un fichier (colonnes et choix de valeurs),
 * pour importer le fichier suivant de même forme sans rien reprendre.
 */
import { CHAMPS_IMPORT } from './champs.ts';
import { cle, estUnite, texteCellule } from './normalisation.ts';
import type { Cellule, ChoixValeur, CleChamp, ColonneAssociee, ColonneModele, Correspondance, DecisionPrise, ModeleImport, TypeContenu } from './types.ts';

function copierChoix(c: ChoixValeur): ChoixValeur {
  const decision: DecisionPrise = c.decision.sorte === 'existante' ? { sorte: 'existante', id: c.decision.id } : { sorte: 'nouvelle', nom: c.decision.nom };
  return { champ: c.champ, valeur: c.valeur, decision };
}

/** Retient, par en-tête, le champ et l'unité validés, plus les choix de valeurs. */
export function creerModele(entetes: readonly Cellule[], correspondance: Correspondance, choix: readonly ChoixValeur[]): ModeleImport {
  const colonnes = entetes.map((e, i): ColonneModele => {
    const a = correspondance.colonnes[i];
    return { entete: texteCellule(e) ?? '', champ: a?.champ ?? null, unite: a?.unite ?? null };
  });
  return { version: 1, type: correspondance.type, colonnes, choix: choix.map(copierChoix) };
}

export function serialiserModele(modele: ModeleImport): string {
  return JSON.stringify({ version: modele.version, type: modele.type, colonnes: modele.colonnes, choix: modele.choix });
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function estType(v: unknown): v is TypeContenu {
  return v === 'parcellaire' || v === 'cultures' || v === 'series' || v === 'assolement';
}

function lireColonne(v: unknown, champs: ReadonlySet<string>): ColonneModele | null {
  if (!estObjet(v) || typeof v.entete !== 'string') return null;
  const { champ, unite } = v;
  if (champ !== null && (typeof champ !== 'string' || !champs.has(champ))) return null;
  if (unite !== null && (typeof unite !== 'string' || !estUnite(unite))) return null;
  return { entete: v.entete, champ: champ as CleChamp | null, unite };
}

function lireChoix(v: unknown): ChoixValeur | null {
  if (!estObjet(v) || (v.champ !== 'espece' && v.champ !== 'famille') || typeof v.valeur !== 'string' || !estObjet(v.decision)) return null;
  const d = v.decision;
  if (d.sorte === 'existante' && typeof d.id === 'string') return { champ: v.champ, valeur: v.valeur, decision: { sorte: 'existante', id: d.id } };
  if (d.sorte === 'nouvelle' && typeof d.nom === 'string') return { champ: v.champ, valeur: v.valeur, decision: { sorte: 'nouvelle', nom: d.nom } };
  return null;
}

/** Relit un modèle sérialisé ; `null` si illisible, de version inconnue ou de champ inconnu. */
export function lireModele(texte: string): ModeleImport | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!estObjet(brut) || brut.version !== 1 || !estType(brut.type) || !Array.isArray(brut.colonnes) || !Array.isArray(brut.choix)) return null;
  const champs = new Set<string>(CHAMPS_IMPORT[brut.type].map((d) => d.cle));
  const colonnes: ColonneModele[] = [];
  for (const c of brut.colonnes as unknown[]) {
    const lue = lireColonne(c, champs);
    if (lue === null) return null;
    colonnes.push(lue);
  }
  const choix: ChoixValeur[] = [];
  for (const c of brut.choix as unknown[]) {
    const lu = lireChoix(c);
    if (lu === null) return null;
    choix.push(lu);
  }
  return { version: 1, type: brut.type, colonnes, choix };
}

/**
 * Correspondance d'un fichier de même forme (mêmes en-têtes normalisés, dans n'importe quel
 * ordre) ; `null` sinon.
 */
export function appliquerModele(modele: ModeleImport, entetes: readonly Cellule[]): Correspondance | null {
  if (entetes.length !== modele.colonnes.length) return null;
  const libres = new Map<string, ColonneModele[]>();
  for (const c of modele.colonnes) {
    const k = cle(c.entete);
    const liste = libres.get(k);
    if (liste === undefined) libres.set(k, [c]);
    else liste.push(c);
  }
  const colonnes: ColonneAssociee[] = [];
  for (const e of entetes) {
    const c = libres.get(cle(texteCellule(e) ?? ''))?.shift();
    if (c === undefined) return null;
    colonnes.push({ champ: c.champ, unite: c.unite });
  }
  return { type: modele.type, colonnes };
}
