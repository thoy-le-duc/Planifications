/**
 * Tests d'acceptation T09b — adresses e-mail côté API (3e relecture), sans base : fonctions de
 * apps/api/src/http.ts. Les routes (POST /auth/code, /auth/verifier, /fermes/:id/membres) sont
 * vérifiées contre Postgres dans auth/durcissement.integration.test.ts (section 5).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   normaliserEmail(v: unknown): string | null
 *     Adresse normalisée (espaces de bord retirés, minuscules), ou null. Règles de T09b
 *     (séparateurs, contrôles, \p{Cf}, combinants, formes que NFKC change, point final de
 *     domaine : refusés avant normalisation) ET, 3e relecture :
 *     - le contrôle est REFAIT APRÈS la normalisation : une adresse dont la forme normalisée
 *       contient un caractère refusé est refusée. Exemple : « İ » (U+0130) passe le premier
 *       contrôle, mais « İrem ».toLowerCase() donne « i » + U+0307 (point combinant) ;
 *     - U+2800 (blanc braille, invisible à l'écran, ni espace ni format) refusé, où qu'il soit ;
 *     - points mal placés refusés : point juste avant « @ » (« theo.@ferme.fr »), points
 *       consécutifs (« ferme..fr », « pre..nom@ »), point en tête de la partie locale ou du
 *       domaine (« .theo@ », « @.ferme.fr »).
 *   Restent acceptées : apostrophe, +, tiret, points isolés, sous-domaines, lettres accentuées
 *   précomposées (« rené@ferme.fr », forme NFC que l'appli envoie), majuscules et espaces de
 *   bord (normalisés).
 */
import { describe, expect, it } from 'vitest';
import { normaliserEmail } from './http.ts';

describe('normaliserEmail : 3e relecture', () => {
  it('« İ » (U+0130) refusé : après minuscules, il laisse un point combinant (U+0307)', () => {
    // Témoin : c'est bien la normalisation qui fait apparaître le combinant.
    expect('İrem'.toLowerCase()).toBe('i̇rem');
    for (const email of ['İrem@ferme.fr', 'irem@FERMİ.fr', '  İREM@ferme.fr  ']) {
      expect(normaliserEmail(email), JSON.stringify(email)).toBeNull();
    }
  });

  it('U+2800 (blanc braille) refusé, dans la partie locale, le domaine, en tête ou en fin', () => {
    for (const email of ['vic⠀time@ferme.fr', 'victime@fer⠀me.fr', '⠀victime@ferme.fr', 'victime@ferme.fr⠀']) {
      expect(normaliserEmail(email), JSON.stringify(email)).toBeNull();
    }
  });

  it('points mal placés refusés : avant « @ », consécutifs, en tête de partie locale ou de domaine', () => {
    for (const email of [
      'theo.@ferme.fr',
      'theo@ferme..fr',
      'pre..nom@ferme.fr',
      '.theo@ferme.fr',
      'theo@.ferme.fr',
      '  Theo.@Ferme.FR  ',
    ]) {
      expect(normaliserEmail(email), JSON.stringify(email)).toBeNull();
    }
  });

  it('les adresses ordinaires restent acceptées et normalisées', () => {
    expect(normaliserEmail("o'neil+recolte@ferme.fr")).toBe("o'neil+recolte@ferme.fr");
    expect(normaliserEmail('prenom.nom@mail.sous-domaine.ferme.fr')).toBe('prenom.nom@mail.sous-domaine.ferme.fr');
    expect(normaliserEmail('  Theo@Ferme.FR  ')).toBe('theo@ferme.fr');
    // « é » précomposé (NFC) : ce que l'appli envoie après normalisation.
    expect(normaliserEmail('René@Ferme.fr')).toBe('rené@ferme.fr');
  });
});
