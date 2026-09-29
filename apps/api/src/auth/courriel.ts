/**
 * Envoi d'e-mail, injecté : un faux en test, la console en développement, SMTP sinon
 * (courriel-smtp.ts, T09b).
 */
export interface MessageCourriel {
  readonly a: string;
  readonly sujet: string;
  readonly texte: string;
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
