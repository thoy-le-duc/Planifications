/**
 * Tests d'acceptation T11f — garde-fou des mesures partout (suite de la relecture T11b).
 *
 * T11b a fait juger les séries de plan.e2e.ts par `jugerSerie` (médiane sous le budget ET plus
 * haute valeur au plus 1,5 fois le budget). Règle T11f : TOUT jeu e2e qui mesure un temps en
 * série (`repeterMesure` ou `repeterMesures`) juge par `jugerSerie` chaque série qu'il compare à
 * un budget. Lu dans les sources :
 *   - le fichier appelle `jugerSerie(` ;
 *   - plus aucune assertion sur la seule médiane (`expect(… .mediane …).toBeLessThan(…)`,
 *     `expect.soft` compris) ;
 *   - plus de maximum recalculé à la main (`Math.max(...serie.valeurs)` dans une assertion) :
 *     c'est `jugerSerie` qui le juge.
 * Les séries seulement affichées au journal (« non bloquant ») ne sont pas concernées.
 * Les mesures uniques de durée (export, import : un seul passage, pas de série) restent hors de
 * cette règle : elles n'ont ni médiane ni maximum distincts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOSSIER = import.meta.dirname;

/** Jeux e2e qui mesurent un temps en série, lus dans le dossier. */
function jeuxEnSerie(): { readonly nom: string; readonly source: string }[] {
  return readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.e2e.ts'))
    .map((nom) => ({ nom, source: readFileSync(join(DOSSIER, nom), 'utf8') }))
    .filter((j) => /\brepeterMesures?\(/.test(j.source));
}

/** Instructions `expect(...)...;` du source (une instruction peut tenir sur plusieurs lignes). */
function assertions(source: string): string[] {
  return source.match(/expect(?:\.soft)?\([^;]*;/g) ?? [];
}

describe('T11f : chaque e2e de temps juge sa série par jugerSerie', () => {
  it('la règle voit bien les jeux de temps connus', () => {
    const noms = jeuxEnSerie().map((j) => j.nom);
    for (const attendu of [
      'aujourdhui.e2e.ts',
      'aujourdhui-grande-ferme.e2e.ts',
      'demarrage.e2e.ts',
      'itineraires.e2e.ts',
      'plan.e2e.ts',
      'refus.e2e.ts',
      'serie.e2e.ts',
      'vue-3d.e2e.ts',
      'vue-3d-filtres.e2e.ts',
      'vue-3d-jumeau.e2e.ts',
    ]) {
      expect(noms, attendu).toContain(attendu);
    }
  });

  for (const { nom, source } of jeuxEnSerie()) {
    it(`${nom} : jugerSerie, ni médiane seule ni maximum à la main`, () => {
      expect(/\bjugerSerie\(/.test(source), `${nom} appelle jugerSerie`).toBe(true);
      const fautives = assertions(source).filter((a) => /\.mediane\b/.test(a) || /Math\.max\(\s*\.\.\.[\w.]+\.valeurs\s*\)/.test(a));
      expect(fautives, `${nom} : assertions sur la seule médiane ou sur un maximum recalculé`).toEqual([]);
    });
  }
});
