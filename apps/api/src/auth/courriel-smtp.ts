/**
 * Expéditeur réel (T09b) : relais SMTP générique, authentifié, chiffré. Tous les fournisseurs
 * hébergés en UE en proposent un ; le choix du fournisseur (contrat, DPA, domaine d'envoi
 * SPF/DKIM/DMARC) revient à Théophane, le code ne dépend que de la configuration (config.ts).
 *
 * Nodemailer plutôt qu'un client maison : STARTTLS obligatoire, vérification du certificat,
 * AUTH PLAIN/LOGIN, encodage MIME (mots encodés RFC 2047, quoted-printable), point doublé, délais :
 * autant de détails de sécurité qu'un client écrit ici referait moins bien. Contrat :
 * courriel-smtp.test.ts.
 */
import { createTransport } from 'nodemailer';
import { verifierEnTetes, type ExpediteurCourriel } from './courriel.ts';

export type SecuriteSmtp = 'tls' | 'starttls' | 'aucune';

export interface OptionsSmtp {
  readonly hote: string;
  readonly port: number;
  /**
   * 'tls' : TLS dès la connexion (port 465) ; 'starttls' : STARTTLS obligatoire (port 587),
   * rien ne part si le serveur ne le propose pas ; 'aucune' : en clair, développement seulement
   * (refusé par lireConfig hors NODE_ENV=development).
   */
  readonly securite: SecuriteSmtp;
  /** Identifiants AUTH (PLAIN ou LOGIN) : les deux ou aucun. */
  readonly utilisateur?: string;
  readonly motDePasse?: string;
  /**
   * En-tête From, ex. « Planifications <connexion@planif.fr> ». Une adresse nue
   * (« connexion@planif.fr ») reçoit le nom d'affichage NOM_EXPEDITEUR (T09c).
   */
  readonly expediteur: string;
  /** Délai maximal d'un envoi, connexion comprise ; 10 s par défaut. */
  readonly delaiMs?: number;
}

export const DELAI_SMTP_MS = 10_000;

/** Nom d'affichage ajouté à une adresse d'expéditeur nue (T09c). */
export const NOM_EXPEDITEUR = 'Planifications';

export interface ExpediteurSmtp extends ExpediteurCourriel {
  /**
   * Connexion au relais (EHLO, STARTTLS si exigé, AUTH si identifiants) sans rien envoyer, puis
   * fermeture (T09c, appelée au démarrage par demarrage.ts). Rejette avec une Error qui nomme
   * l'hôte et le port, jamais le mot de passe.
   */
  verifier(): Promise<void>;
}

/** From : l'expéditeur tel quel s'il porte déjà un nom (« Nom <adresse> »), sinon nommé. */
function enTeteFrom(expediteur: string): string | { readonly name: string; readonly address: string } {
  return expediteur.includes('<') ? expediteur : { name: NOM_EXPEDITEUR, address: expediteur.trim() };
}

/** Rejette après delaiMs ; `annuler` libère la minuterie. */
function minuterieRejet(delaiMs: number, message: string): { readonly promesse: Promise<never>; annuler(): void } {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const promesse = new Promise<never>((_ok, echec) => {
    minuterie = setTimeout(() => {
      echec(new Error(message));
    }, delaiMs);
  });
  return {
    promesse,
    annuler() {
      clearTimeout(minuterie);
    },
  };
}

export function expediteurSmtp(options: OptionsSmtp): ExpediteurSmtp {
  const delaiMs = options.delaiMs ?? DELAI_SMTP_MS;
  const auth =
    options.utilisateur !== undefined && options.motDePasse !== undefined
      ? { user: options.utilisateur, pass: options.motDePasse }
      : undefined;
  const transport = createTransport({
    host: options.hote,
    port: options.port,
    secure: options.securite === 'tls',
    requireTLS: options.securite === 'starttls',
    // En clair : ne pas tenter STARTTLS (serveur de développement ou de test).
    ignoreTLS: options.securite === 'aucune',
    ...(auth === undefined ? {} : { auth }),
    connectionTimeout: delaiMs,
    greetingTimeout: delaiMs,
    socketTimeout: delaiMs,
    // Rien dans les journaux : le code de connexion est dans le message.
    logger: false,
    debug: false,
  });

  const relais = `${options.hote}:${String(options.port)}`;

  /** Jamais le mot de passe dans un message d'erreur, même renvoyé par le serveur. */
  const sansSecret = (texte: string): string =>
    options.motDePasse === undefined || options.motDePasse === '' ? texte : texte.replaceAll(options.motDePasse, '***');

  return {
    async envoyer(message) {
      // Avant toute connexion : un retour à la ligne dans un en-tête n'ouvre même pas de socket.
      verifierEnTetes(message);
      const delai = minuterieRejet(delaiMs, `Courriel non envoyé : pas de réponse du serveur SMTP en ${String(delaiMs)} ms.`);
      // `a` est UNE adresse, jamais analysée : passée en objet (en-tête To) et dans une enveloppe
      // explicite, elle ne peut pas être décomposée en liste (« a@x.fr,pirate@y.fr ») ni réduite
      // à l'adresse entre chevrons d'un nom d'affichage. Un seul RCPT TO par message.
      const destinataire = { name: '', address: message.a };
      // Avec html, nodemailer compose un multipart/alternative : text/plain puis text/html, UTF-8.
      const envoi = transport.sendMail({
        from: enTeteFrom(options.expediteur),
        to: destinataire,
        envelope: { from: options.expediteur, to: [destinataire] },
        subject: message.sujet,
        text: message.texte,
        ...(message.html === undefined ? {} : { html: message.html }),
        textEncoding: 'quoted-printable',
      });
      // Après le délai, l'échec tardif de l'envoi ne doit pas devenir un rejet non géré.
      envoi.catch(() => undefined);
      try {
        await Promise.race([envoi, delai.promesse]);
      } finally {
        delai.annuler();
      }
    },

    async verifier() {
      const delai = minuterieRejet(delaiMs, `Relais SMTP ${relais} : pas de réponse en ${String(delaiMs)} ms.`);
      const verification = transport.verify().then(
        () => undefined,
        (erreur: unknown) => {
          const cause = erreur instanceof Error ? erreur.message : String(erreur);
          throw new Error(sansSecret(`Relais SMTP ${relais} injoignable ou refusé : ${cause}`));
        },
      );
      verification.catch(() => undefined);
      try {
        await Promise.race([verification, delai.promesse]);
      } finally {
        delai.annuler();
      }
    },
  };
}
