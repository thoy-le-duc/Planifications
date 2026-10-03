/**
 * T13h, relecture (NB3) — contrat des portes de test enveloppées.
 *
 * Depuis T13h, `porte.ecrireEnsemble(ordres, verifier)` porte la vérification du « Fait » unique,
 * lancée dans la transaction. Une porte de test qui enveloppe la vraie et relaie
 * `(ordres) => vraie.ecrireEnsemble(ordres)` fait disparaître cette vérification EN SILENCE : le
 * test passe, mais il ne teste plus l'écriture réelle.
 *
 * Ce test lit les fichiers de test de apps/web/src et refuse toute définition d'`ecrireEnsemble`
 * par une fonction fléchée à un seul paramètre (async ou non, parenthèses ou non) : une porte
 * enveloppée doit prendre et relayer le second (`(ordres, verifier) => vraie.ecrireEnsemble(ordres, verifier)`).
 * Les portes qui interdisent l'écriture (`ecrireEnsemble: interdit(...)`) ne sont pas concernées.
 */
import { describe, expect, it } from 'vitest';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const { fileURLToPath } = process.getBuiltinModule('node:url');

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const FICHIER_TEST = /\.test\.tsx?$/;
/** Définition d'`ecrireEnsemble` par une fonction fléchée à UN seul paramètre. */
const UN_SEUL_PARAMETRE = /ecrireEnsemble\s*:\s*(?:async\s+)?(?:\(\s*[\w$]+\s*(?::[^,)]*)?\)|[\w$]+)\s*=>/g;

function fichiersDeTest(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name !== 'node_modules') trouves.push(...fichiersDeTest(chemin));
    } else if (FICHIER_TEST.test(entree.name)) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

describe('T13h : les portes de test enveloppées relaient la vérification d’ecrireEnsemble', () => {
  it('aucune porte de test ne définit ecrireEnsemble avec un seul paramètre', () => {
    const fichiers = fichiersDeTest(RACINE);
    expect(fichiers.length, 'des fichiers de test trouvés').toBeGreaterThan(10);
    const fautes: string[] = [];
    for (const f of fichiers) {
      const source = fs.readFileSync(f, 'utf8');
      for (const m of source.matchAll(UN_SEUL_PARAMETRE)) {
        const ligne = source.slice(0, m.index).split('\n').length;
        fautes.push(`${path.relative(RACINE, f)}:${String(ligne)} : ${m[0]}`);
      }
    }
    expect(fautes, 'porte enveloppée qui ne relaie pas `verifier` (la vérification T13h disparaît en silence)').toEqual([]);
  });
});
