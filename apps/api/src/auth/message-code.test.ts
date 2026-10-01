/**
 * Tests d'acceptation T09c — message du code de connexion : français, texte brut ET HTML sobre.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/auth/courriel.ts (réexporté par auth/index.ts) :
 *
 *   interface MessageCourriel {
 *     readonly a: string; readonly sujet: string; readonly texte: string;
 *     readonly html?: string;      // NOUVEAU, facultatif : version HTML du même contenu
 *   }
 *
 *   echapperHtml(valeur: string): string
 *     Échappe & < > " ' (& d'abord : « &lt; » devient « &amp;lt; », jamais laissé tel quel).
 *     Toute valeur insérée dans un HTML de courriel passe par elle.
 *
 *   messageCode(a: string, code: string): MessageCourriel
 *     Le message que POST /auth/code envoie (routes.ts l'utilise : auth.integration.test.ts) :
 *       - `a` repris tel quel ;
 *       - `sujet` en français, contient le code, sans retour à la ligne (verifierEnTetes passe) ;
 *       - `texte` en français : le code, la durée de validité (10 minutes), aucune balise ;
 *       - `html` sobre : document `lang="fr"`, le code bien visible (seul contenu d'un élément,
 *         ex. <strong>123456</strong>), la durée de validité ; AUCUNE ressource distante ni lien
 *         (pas de <img>, <a>, <link>, <script>, <iframe>, url(…), @import, ni « http(s):// ») :
 *         rien qui charge quoi que ce soit ni ne trace l'ouverture ;
 *       - le code inséré dans le HTML est échappé (echapperHtml), même s'il n'est jamais censé
 *         contenir autre chose que des chiffres.
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que les exports
 * n'existent ; il échoue alors sur « … n'est pas une fonction ».
 */
import { describe, expect, it } from 'vitest';
import { verifierEnTetes, type MessageCourriel } from './index.ts';

type MessageAvecHtml = MessageCourriel & { readonly html?: string };

interface ModuleAuth {
  readonly echapperHtml?: (valeur: string) => string;
  readonly messageCode?: (a: string, code: string) => MessageAvecHtml;
}

const CHEMIN_AUTH = './index.ts';

async function module(): Promise<ModuleAuth> {
  return (await import(CHEMIN_AUTH)) as ModuleAuth;
}

async function echapperHtml(valeur: string): Promise<string> {
  const { echapperHtml: f } = await module();
  if (typeof f !== 'function') throw new Error('echapperHtml n’est pas une fonction exportée par auth/index.ts');
  return f(valeur);
}

async function messageCode(a: string, code: string): Promise<MessageAvecHtml> {
  const { messageCode: f } = await module();
  if (typeof f !== 'function') throw new Error('messageCode n’est pas une fonction exportée par auth/index.ts');
  return f(a, code);
}

const EMAIL = 'theo@ferme.fr';
const CODE = '482913';

describe('echapperHtml (T09c)', () => {
  it('échappe & < > " \'', async () => {
    const sortie = await echapperHtml(`a<b>&c"d'e`);
    expect(sortie).not.toMatch(/[<>"']/);
    expect(sortie).toMatch(/^a&lt;b&gt;&amp;c&quot;d&(#39|#x27|apos);e$/);
  });

  it('& d’abord : une entité déjà présente est échappée à son tour', async () => {
    expect(await echapperHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('texte ordinaire et accents inchangés', async () => {
    expect(await echapperHtml('Jardins de Garonne — été 2026')).toBe('Jardins de Garonne — été 2026');
  });
});

describe('messageCode (T09c)', () => {
  it('destinataire, sujet en français avec le code, en-têtes valides', async () => {
    const m = await messageCode(EMAIL, CODE);
    expect(m.a).toBe(EMAIL);
    expect(m.sujet).toContain(CODE);
    expect(m.sujet).toMatch(/code/i);
    expect(() => {
      verifierEnTetes(m);
    }).not.toThrow();
  });

  it('texte brut en français : le code, la validité de 10 minutes, aucune balise', async () => {
    const m = await messageCode(EMAIL, CODE);
    expect(m.texte).toContain(CODE);
    expect(m.texte).toMatch(/10 minutes/);
    expect(m.texte).toMatch(/connexion/i);
    expect(m.texte).not.toMatch(/<[a-z/!]/i);
  });

  it('HTML présent, en français, avec le code bien visible et la durée de validité', async () => {
    const m = await messageCode(EMAIL, CODE);
    expect(typeof m.html).toBe('string');
    const html = m.html ?? '';
    expect(html).toMatch(/<html[^>]*\blang="fr"/i);
    // Le code est le seul contenu d'un élément (mis en valeur), pas noyé dans une phrase.
    expect(html).toMatch(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*>\\s*${CODE}\\s*</\\1>`, 'i'));
    expect(html).toMatch(/10 minutes/);
  });

  it('HTML sobre : aucune ressource distante, aucun lien, aucun script', async () => {
    const html = (await messageCode(EMAIL, CODE)).html ?? '';
    expect(html).not.toBe('');
    for (const interdit of [/<img\b/i, /<a\b/i, /<link\b/i, /<script\b/i, /<iframe\b/i, /<object\b/i, /<embed\b/i, /url\s*\(/i, /@import/i, /https?:\/\//i, /\bsrc\s*=/i, /\bhref\s*=/i]) {
      expect(html).not.toMatch(interdit);
    }
  });

  it('le code inséré dans le HTML est échappé (pas d’injection)', async () => {
    const piege = '<img src=x onerror=alert(1)>&';
    const html = (await messageCode(EMAIL, piege)).html ?? '';
    expect(html).not.toBe('');
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&amp;');
  });
});
