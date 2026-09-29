/**
 * Modèle d'import (T14) : la correspondance validée d'un fichier (colonnes et choix de valeurs),
 * pour importer le fichier suivant de même forme sans rien reprendre.
 */
import { CHAMPS_IMPORT, uniteAcceptee } from './champs.ts';
import { cle, texteCellule } from './normalisation.ts';
import type { Cellule, ChoixValeur, CleChamp, ColonneAssociee, ColonneModele, Correspondance, DecisionPrise, ModeleImport, TypeContenu, UniteColonne } from './types.ts';

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

function estUniteColonne(v: unknown): v is UniteColonne {
  return v === 'm' || v === 'cm' || v === 'kg' || v === 'g' || v === 'ha' || v === 'semaine';
}

/** Colonne relue : champ du type, unité acceptée pour ce champ (aucune sur une colonne ignorée). */
function lireColonne(v: unknown, champs: ReadonlySet<CleChamp>): ColonneModele | null {
  if (!estObjet(v) || typeof v.entete !== 'string') return null;
  const { champ, unite } = v;
  let cleChamp: CleChamp | null = null;
  if (champ !== null) {
    const trouve = [...champs].find((c) => c === champ);
    if (trouve === undefined) return null;
    cleChamp = trouve;
  }
  if (unite === null) return { entete: v.entete, champ: cleChamp, unite: null };
  if (cleChamp === null || !estUniteColonne(unite) || !uniteAcceptee(cleChamp, unite)) return null;
  return { entete: v.entete, champ: cleChamp, unite };
}

function lireChoix(v: unknown): ChoixValeur | null {
  if (!estObjet(v) || (v.champ !== 'espece' && v.champ !== 'famille') || typeof v.valeur !== 'string' || !estObjet(v.decision)) return null;
  const d = v.decision;
  if (d.sorte === 'existante' && typeof d.id === 'string' && d.id !== '') return { champ: v.champ, valeur: v.valeur, decision: { sorte: 'existante', id: d.id } };
  if (d.sorte === 'nouvelle' && typeof d.nom === 'string' && d.nom.trim() !== '') return { champ: v.champ, valeur: v.valeur, decision: { sorte: 'nouvelle', nom: d.nom } };
  return null;
}

/** Relit un modèle sérialisé ; `null` si illisible, de version inconnue, de champ inconnu ou associé à deux colonnes. */
export function lireModele(texte: string): ModeleImport | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!estObjet(brut) || brut.version !== 1 || !estType(brut.type) || !Array.isArray(brut.colonnes) || !Array.isArray(brut.choix)) return null;
  const champs = new Set<CleChamp>(CHAMPS_IMPORT[brut.type].map((d) => d.cle));
  const colonnes: ColonneModele[] = [];
  const associes = new Set<CleChamp>();
  for (const c of brut.colonnes as unknown[]) {
    const lue = lireColonne(c, champs);
    if (lue === null) return null;
    // Un champ sur deux colonnes : laquelle lire ? Le modèle est refusé plutôt que deviné.
    if (lue.champ !== null) {
      if (associes.has(lue.champ)) return null;
      associes.add(lue.champ);
    }
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
  // Par en-tête normalisé : ses colonnes du modèle, et l'indice de la prochaine libre (pas de
  // `shift()`, linéaire en tout).
  const libres = new Map<string, { readonly liste: ColonneModele[]; suivante: number }>();
  for (const c of modele.colonnes) {
    const k = cle(c.entete);
    const l = libres.get(k);
    if (l === undefined) libres.set(k, { liste: [c], suivante: 0 });
    else l.liste.push(c);
  }
  const colonnes: ColonneAssociee[] = [];
  for (const e of entetes) {
    const l = libres.get(cle(texteCellule(e) ?? ''));
    const c = l?.liste[l.suivante];
    if (l === undefined || c === undefined) return null;
    l.suivante++;
    colonnes.push({ champ: c.champ, unite: c.unite });
  }
  return { type: modele.type, colonnes };
}
