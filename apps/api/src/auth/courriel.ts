/**
 * Envoi d'e-mail, injecté : un faux en test, la console en développement, SMTP sinon
 * (courriel-smtp.ts, T09b).
 */
export interface MessageCourriel {
  readonly a: string;
  readonly sujet: string;
  readonly texte: string;
  /**
   * Version HTML du même contenu (T09c), facultative : l'expéditeur SMTP envoie alors un
   * multipart/alternative (texte brut puis HTML). Toute valeur insérée passe par echapperHtml.
   */
  readonly html?: string;
}

/**
 * Échec d'envoi d'un expéditeur réel : message déjà nettoyé de tout secret (courriel-smtp.ts),
 * sans cause attachée. Le gestionnaire d'erreur de l'API (app.ts) n'écrit que ce message.
 */
export class ErreurEnvoiCourriel extends Error {
  override readonly name = 'ErreurEnvoiCourriel';
}

export interface ExpediteurCourriel {
  envoyer(message: MessageCourriel): Promise<void>;
}

/**
 * Dernière frontière avant l'en-tête SMTP : un retour chariot ou un saut de ligne dans le
 * destinataire ou le sujet permettrait d'injecter des en-têtes (« Bcc: … »), quelle que soit la
 * route qui compose le message (nom de ferme, adresse…). Tout expéditeur l'appelle avant d'envoyer
 * (expediteurConsole ici, expediteurSmtp dans courriel-smtp.ts). Le texte peut tenir sur plusieurs
 * lignes.
 */
export function verifierEnTetes(message: MessageCourriel): void {
  for (const [champ, valeur] of [
    ['a', message.a],
    ['sujet', message.sujet],
  ] as const) {
    if (/[\r\n]/.test(valeur)) {
      throw new Error(`Courriel refusé : retour à la ligne dans « ${champ} ».`);
    }
  }
}

/**
 * Expéditeur de développement : écrit le message dans la console. Le code de connexion y
 * apparaît en clair : jamais en production (index.ts ne l'active que sur demande explicite).
 */
export function expediteurConsole(ecrire: (ligne: string) => void = console.log): ExpediteurCourriel {
  return {
    envoyer(message) {
      try {
        verifierEnTetes(message);
      } catch (erreur) {
        return Promise.reject(erreur instanceof Error ? erreur : new Error(String(erreur)));
      }
      ecrire(`[courriel] à ${message.a} — ${message.sujet}\n${message.texte}`);
      return Promise.resolve();
    },
  };
}

/** Échappe & < > " ' pour insérer une valeur dans du HTML ; & d'abord. */
export function echapperHtml(valeur: string): string {
  return valeur
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Message du code de connexion (T09c), envoyé par POST /auth/code : français, texte brut et HTML
 * sobre. Le HTML ne charge rien (ni image, ni lien, ni police, ni feuille de style distante) :
 * rien ne trace l'ouverture et il s'affiche pareil hors ligne. La durée de validité suit
 * DUREE_CODE_MS (routes.ts). Contrat : message-code.test.ts.
 */
export function messageCode(a: string, code: string): MessageCourriel {
  const validite = '10 minutes';
  const texte =
    `Votre code de connexion à Planifications : ${code}\n\n` +
    `Il est valable ${validite}. Si vous n'avez rien demandé, ignorez ce message.`;
  const html = [
    '<!doctype html>',
    '<html lang="fr">',
    '<head><meta charset="utf-8"><title>Votre code de connexion</title></head>',
    '<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2a1f;background:#ffffff">',
    '<p style="margin:0 0 16px;font-size:16px">Votre code de connexion à Planifications :</p>',
    `<p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:6px"><strong>${echapperHtml(code)}</strong></p>`,
    `<p style="margin:0 0 8px;font-size:14px">Il est valable ${validite}.</p>`,
    '<p style="margin:0;font-size:14px;color:#5a665a">Si vous n\'avez rien demandé, ignorez ce message.</p>',
    '</body>',
    '</html>',
  ].join('\n');
  return { a, sujet: `Votre code de connexion : ${code}`, texte, html };
}
