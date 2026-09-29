/**
 * Envoi d'e-mail, injecté : un faux en test, aucun service réel ni secret dans T09.
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
 * Expéditeur de développement : écrit le message dans la console. Le code de connexion y
 * apparaît en clair : jamais en production (index.ts ne l'active que sur demande explicite).
 */
export function expediteurConsole(ecrire: (ligne: string) => void = console.log): ExpediteurCourriel {
  return {
    envoyer(message) {
      ecrire(`[courriel] à ${message.a} — ${message.sujet}\n${message.texte}`);
      return Promise.resolve();
    },
  };
}
