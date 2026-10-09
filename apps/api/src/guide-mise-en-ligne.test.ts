/**
 * Tests d'acceptation T38b — docs/mise-en-ligne.md.
 *
 * La liste des variables d'environnement du guide (tableau dont chaque ligne commence par
 * | `NOM` |) doit coïncider avec celle que le code lit réellement :
 *   - l'API : config.ts (lireConfig) et vercel.ts (VERCEL) ;
 *   - l'appli à la construction : vite.config.ts et import.meta.env.VITE_* dans apps/web/src.
 * Une variable ajoutée au code sans le guide, ou l'inverse, fait échouer ce test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const racine = (chemin: string): string => fileURLToPath(new URL(`../../../${chemin}`, import.meta.url));
const lire = (chemin: string): string => readFileSync(racine(chemin), 'utf8');

function fichiersSource(dossier: string): string[] {
  return readdirSync(racine(dossier), { withFileTypes: true, recursive: true })
    .filter((f) => f.isFile() && /\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name))
    .map((f) => `${f.parentPath.slice(racine('').length)}/${f.name}`);
}

function noms(texte: string, motif: RegExp): string[] {
  return [...texte.matchAll(motif)].map((m) => m[1] ?? '');
}

/** Variables lues par l'API au démarrage (config.ts) et par la fonction Vercel (vercel.ts). */
function variablesDuCode(): string[] {
  const api = [
    ...noms(lire('apps/api/src/config.ts'), /(?:\benv\.|obligatoire\(env, '|facultative\(env, ')([A-Z][A-Z0-9_]+)/g),
    ...noms(lire('apps/api/src/vercel.ts'), /\benv\.([A-Z][A-Z0-9_]+)/g),
  ];
  const web = [
    ...noms(lire('apps/web/vite.config.ts'), /\benv\.(VITE_[A-Z0-9_]+)/g),
    ...fichiersSource('apps/web/src').flatMap((f) =>
      noms(readFileSync(racine(f.replace(/^\//, '')), 'utf8'), /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g),
    ),
  ];
  return [...new Set([...api, ...web])].sort();
}

function variablesDuGuide(): string[] {
  const guide = lire('docs/mise-en-ligne.md');
  return [...new Set(noms(guide, /^\| `([A-Z][A-Z0-9_]+)` \|/gm))].sort();
}

describe('docs/mise-en-ligne.md', () => {
  it('le relevé du code trouve bien les variables connues', () => {
    expect(variablesDuCode()).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'PROXY_DE_CONFIANCE', 'SMTP_MOT_DE_PASSE', 'VERCEL', 'VITE_POWERSYNC_URL']),
    );
  });

  it('le tableau des variables coïncide avec celles que le code lit', () => {
    expect(variablesDuGuide()).toEqual(variablesDuCode());
  });

  it('donne les commandes de migration et de génération des clés', () => {
    const guide = lire('docs/mise-en-ligne.md');
    expect(guide).toContain('pnpm --filter @planif/db migrer');
    expect(guide).toContain('pnpm --filter @planif/api cles');
    expect(guide).toContain('/api/sante');
    expect(guide).toContain('/api/.well-known/jwks.json');
  });
});
