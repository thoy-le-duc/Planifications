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
import type { CodeErreurSaisie } from '@planif/core';
import { messageRefus, refusDuCoeur } from './messages.ts';
import type { MotifRefus } from './motifs.ts';
import { defautsDeForme, jargon, MOTIFS } from './test/jargon.ts';

// La liste des motifs du test suit le type du serveur : un motif ajouté sans être testé ne compile pas.
type MotifsManquants = Exclude<MotifRefus, (typeof MOTIFS)[number]>;
type MotifsEnTrop = Exclude<(typeof MOTIFS)[number], MotifRefus>;
const motifsComplets: [MotifsManquants, MotifsEnTrop] extends [never, never] ? true : false = true;

/** Codes d'erreur du cœur ; la liste suit le type de @planif/core (un code ajouté sans être testé ne compile pas). */
const CODES_DU_COEUR = [
  'entree_invalide',
  'colonne_inconnue',
  'champ_manquant',
  'champ_invalide',
  'hors_bornes',
  'trop_long',
  'trop_nombreux',
  'doublon',
  'incoherent',
  'json_illisible',
  'trop_volumineux',
  'cle_inconnue',
  'plafond_depasse',
] as const;
type CodesManquants = Exclude<CodeErreurSaisie, (typeof CODES_DU_COEUR)[number]>;
type CodesEnTrop = Exclude<(typeof CODES_DU_COEUR)[number], CodeErreurSaisie>;
const codesComplets: [CodesManquants, CodesEnTrop] extends [never, never] ? true : false = true;

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

/** Clés de l'objet `const <nom> … = { … };` de `texte` (sans commentaires). */
function clesDeLObjet(texte: string, nom: string): string[] {
  const debut = texte.indexOf(`const ${nom}`);
  if (debut < 0) return [];
  const ouverture = texte.indexOf('= {', debut);
  const fin = texte.indexOf('\n};', ouverture);
  const corps = texte.slice(ouverture + 3, fin);
  return [...corps.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gmu)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

describe('T10j (relecture) : filet des tables de messages.ts et de references.ts', () => {
  const messages = sansCommentaires(readFileSync(join(DOSSIER, 'messages.ts'), 'utf8'));
  const champs = clesDeLObjet(messages, 'LIBELLES_DES_CHAMPS');

  /** Défauts (jargon, forme) d'un message affiché, ou vide. */
  const defauts = (message: string): string[] => [...jargon(message), ...defautsDeForme(message)];

  it('la liste des codes du test est celle du cœur (CodeErreurSaisie), et PRECISIONS_DU_COEUR les couvre tous', () => {
    expect(codesComplets).toBe(true);
    expect(clesDeLObjet(messages, 'PRECISIONS_DU_COEUR').sort()).toEqual([...CODES_DU_COEUR].sort());
    expect(champs.length, 'clés de LIBELLES_DES_CHAMPS lues').toBeGreaterThan(30);
  });

  it('chaque code du cœur, sans champ, avec chaque champ de LIBELLES_DES_CHAMPS et dans le détail : message sans jargon, forme stable', () => {
    const fautifs: string[] = [];
    for (const code of CODES_DU_COEUR) {
      for (const champ of [null, ...champs, ...champs.map((c) => `detail.${c}`), ...champs.map((c) => `parametres.travauxPrevus.0.${c}`), 'champ_que_personne_ne_connait']) {
        const message = messageRefus(refusDuCoeur({ code, champ, message: 'message du cœur, jamais affiché' }, null));
        const d = defauts(message);
        if (d.length > 0) fautifs.push(`${code} / ${String(champ)} : « ${message} » : ${d.join(', ')}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('chaque motif, avec et sans précision : forme stable, sans jargon', () => {
    const fautifs = MOTIFS.flatMap((motif) => [messageRefus({ motif }), messageRefus({ motif, precision: 'série introuvable' })])
      .map((m) => ({ m, d: defauts(m) }))
      .filter((x) => x.d.length > 0)
      .map((x) => `« ${x.m} » : ${x.d.join(', ')}`);
    expect(fautifs).toEqual([]);
  });

  it('references.ts : chaque « <libellé> introuvable » et chaque « supprimée » passés par messageRefus : sans jargon, forme stable', () => {
    const texte = sansCommentaires(readFileSync(join(DOSSIER, 'references.ts'), 'utf8'));
    const lire = (propriete: string): string[] =>
      [...texte.matchAll(new RegExp(String.raw`\b${propriete}\s*:\s*${LITTERAL}`, 'gu'))].map((m) => contenu(m[1] ?? ''));
    const libelles = lire('libelle');
    const supprimees = lire('supprimee');
    expect(libelles.length, 'libellés lus').toBeGreaterThanOrEqual(6);
    expect(supprimees.length, 'textes « supprimée » lus').toBeGreaterThanOrEqual(5);
    const precisions = [...libelles.map((l) => `${l} introuvable`), ...supprimees];
    const fautifs = precisions
      .map((precision) => messageRefus({ motif: 'ecriture_invalide', precision }))
      .map((m) => ({ m, d: defauts(m) }))
      .filter((x) => x.d.length > 0)
      .map((x) => `« ${x.m} » : ${x.d.join(', ')}`);
    expect(fautifs).toEqual([]);
  });
});
