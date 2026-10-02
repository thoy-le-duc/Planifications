/**
 * Tests d'acceptation T10j — refus de synchro : messages sans jargon (docs/backlog/T10j-refus-suites.md).
 *
 * Filet statique, sans base : TOUS les textes que le code de apps/api/src/sync écrit dans le
 * message d'un refus (celui que le téléphone affiche tel quel), y compris ceux qu'aucun scénario
 * ne sait atteindre (chaîne de 1 000 corrections, récolte d'origine disparue…). Les refus
 * réellement produits, précisions du cœur comprises : messages-refus.integration.test.ts.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   Textes lus dans le code (fichiers .ts de apps/api/src/sync hors tests, commentaires ôtés) :
 *     - le message de chaque motif (objet dont les clés sont les codes de motif : MESSAGES
 *       d'upload.ts aujourd'hui, où qu'il soit rangé dans apps/api/src/sync) ;
 *     - le PREMIER argument littéral des fonctions `invalide(…)` et `refuser(…)` (précision
 *       affichée) ; un second argument éventuel (détail pour le journal) n'est pas lu ;
 *     - la valeur littérale des propriétés `precision:` et `raison:`, et des constantes
 *       `PRECISION_…` ;
 *     - dans un gabarit `…${x}…`, les morceaux fixes (la valeur insérée est couverte par les
 *       scénarios) ; une constante du code insérée (`${String(PROFONDEUR_MAX_CHAINE)}`) est un
 *       seuil technique, interdit comme « 500 » ou « 6 Mio ».
 *   Aucun de ces textes ne contient de jargon (test/jargon.ts : noms de tables et de colonnes du
 *   schéma, codes de motif, « colonne », « table », « contrainte », « règle de la base », « SQL »,
 *   « uuid », « écritures », « 500 », « Mio »…). Le détail technique va dans le journal.
 *
 *   Si le code range ses textes autrement (catalogue, autre nom de fonction), l'extraction
 *   ci-dessous s'adapte, justifiée dans la PR : le plancher de textes trouvés empêche qu'elle se
 *   vide en silence.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MotifRefus } from './motifs.ts';
import { jargon, MOTIFS } from './test/jargon.ts';

// La liste des motifs du test suit le type du serveur : un motif ajouté sans être testé ne compile pas.
type MotifsManquants = Exclude<MotifRefus, (typeof MOTIFS)[number]>;
type MotifsEnTrop = Exclude<(typeof MOTIFS)[number], MotifRefus>;
const motifsComplets: [MotifsManquants, MotifsEnTrop] extends [never, never] ? true : false = true;

const DOSSIER = import.meta.dirname;

/** Sources du serveur (hors tests), commentaires ôtés. */
function sources(): { fichier: string; texte: string }[] {
  return readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((fichier) => ({ fichier, texte: sansCommentaires(readFileSync(join(DOSSIER, fichier), 'utf8')) }));
}

/** Ôte les commentaires /* … *\/ et // … (hors chaînes : les sources n'ont pas de « // » dans un texte). */
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');
}

/** Chaîne littérale ('…', "…", `…`) ; dans un gabarit, les ${…} deviennent une espace. */
const LITTERAL = String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\x60(?:\\.|[^\x60\\])*\x60)`;

function contenu(litteral: string): string {
  return litteral
    .slice(1, -1)
    .replace(/\$\{[^}]*\}/gu, ' ')
    .replace(/\\(.)/gu, '$1');
}

/** Constantes du code insérées dans un gabarit (`${String(PROFONDEUR_MAX_CHAINE)}`) : un seuil technique. */
function constantesInserees(litteral: string): string[] {
  return [...litteral.matchAll(/\$\{([^}]*)\}/gu)].flatMap((m) => [...(m[1] ?? '').matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/gu)].map((c) => c[0]));
}

interface Texte {
  readonly fichier: string;
  readonly origine: string;
  readonly texte: string;
  /** Constantes du code insérées dans le texte (seuils techniques). */
  readonly constantes: readonly string[];
}

function textesAffiches(): Texte[] {
  const textes: Texte[] = [];
  const motifs = MOTIFS.join('|');
  const motifsReguliers: readonly (readonly [string, RegExp])[] = [
    ['invalide(…) / refuser(…)', new RegExp(String.raw`\b(?:invalide|refuser)\(\s*${LITTERAL}`, 'gu')],
    ['precision: / raison:', new RegExp(String.raw`\b(?:precision|raison)\s*:\s*${LITTERAL}`, 'gu')],
    ['constante PRECISION_…', new RegExp(String.raw`\bPRECISION_\w*\s*=\s*${LITTERAL}`, 'gu')],
    ['message d’un motif', new RegExp(String.raw`\b(?:${motifs})\s*:\s*${LITTERAL}`, 'gu')],
  ];
  for (const { fichier, texte } of sources()) {
    for (const [origine, regle] of motifsReguliers) {
      for (const m of texte.matchAll(regle)) {
        const litteral = m[1];
        if (litteral !== undefined) textes.push({ fichier, origine, texte: contenu(litteral), constantes: constantesInserees(litteral) });
      }
    }
  }
  return textes;
}

describe('T10j : textes des refus dans le code de la synchro', () => {
  it('la liste des motifs du test est celle du serveur (MotifRefus)', () => {
    expect(motifsComplets).toBe(true);
  });

  it('le filet lit bien les textes du code : un message par motif, et des dizaines de précisions', () => {
    const textes = textesAffiches();
    const messagesDeMotif = textes.filter((t) => t.origine === 'message d’un motif');
    expect(messagesDeMotif.length, 'un message par motif').toBeGreaterThanOrEqual(MOTIFS.length);
    // Plancher : plus de 60 textes aujourd'hui (introuvable, supprimé, autre espèce…).
    expect(textes.length, 'textes lus dans apps/api/src/sync').toBeGreaterThanOrEqual(40);
  });

  it('aucun texte affiché sur le téléphone ne contient de jargon (colonne, table, code, seuil technique)', () => {
    const fautifs = textesAffiches()
      .map((t) => ({ ...t, jargon: [...jargon(t.texte), ...t.constantes.map((c) => `seuil technique inséré (${c})`)] }))
      .filter((t) => t.jargon.length > 0)
      .map((t) => `${t.fichier} (${t.origine}) « ${t.texte} » : ${t.jargon.join(', ')}`);
    expect(fautifs).toEqual([]);
  });
});
