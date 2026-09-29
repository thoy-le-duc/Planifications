/**
 * Utilitaire de test (T09b) : serveur SMTP factice, local, en clair, pour tester l'expéditeur
 * réel sans aucun service extérieur. Il parle juste assez de SMTP (RFC 5321) pour un client
 * ordinaire (nodemailer ou client maison) : EHLO/HELO, AUTH PLAIN et LOGIN, MAIL, RCPT, DATA
 * (avec retrait du point doublé), RSET, NOOP, QUIT. Il ne propose jamais STARTTLS.
 *
 * Options :
 *   refuserDestinataire  RCPT TO répond 550 (adresse refusée par le fournisseur)
 *   muet                 accepte la connexion mais n'envoie jamais la bannière 220
 *   sansAuth             n'annonce pas AUTH dans la réponse à EHLO
 */
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export interface MessageRecu {
  /** Adresse de MAIL FROM, sans les chevrons. */
  readonly mailFrom: string;
  /** Adresses de RCPT TO acceptées, sans les chevrons. */
  readonly rcptTo: readonly string[];
  /** Contenu reçu après DATA (en-têtes + corps, lignes en CRLF), point doublé retiré, sans le point final. */
  readonly donnees: string;
}

export interface Identifiants {
  readonly utilisateur: string;
  readonly motDePasse: string;
}

export interface ServeurSmtpFactice {
  readonly port: number;
  readonly messages: MessageRecu[];
  /** Identifiants reçus par AUTH PLAIN ou AUTH LOGIN. */
  readonly authentifications: Identifiants[];
  /** Commandes reçues, dans l'ordre (verbe en majuscules, sans argument). */
  readonly commandes: string[];
  /** Nombre de connexions TCP reçues. */
  connexions(): number;
  fermer(): Promise<void>;
}

export interface OptionsSmtpFactice {
  readonly refuserDestinataire?: boolean;
  readonly muet?: boolean;
  readonly sansAuth?: boolean;
}

function decoder64(b64: string): string {
  return Buffer.from(b64.trim(), 'base64').toString('utf8');
}

/** « \0utilisateur\0motDePasse » (RFC 4616). */
function identifiantsPlain(b64: string): Identifiants {
  const [, utilisateur = '', motDePasse = ''] = decoder64(b64).split('\u0000');
  return { utilisateur, motDePasse };
}

function sansChevrons(argument: string): string {
  const m = /<([^>]*)>/.exec(argument);
  return (m?.[1] ?? argument).trim();
}

export async function demarrerSmtpFactice(options: OptionsSmtpFactice = {}): Promise<ServeurSmtpFactice> {
  const messages: MessageRecu[] = [];
  const authentifications: Identifiants[] = [];
  const commandes: string[] = [];
  const sockets = new Set<Socket>();
  let connexions = 0;

  const serveur = createServer((socket) => {
    connexions += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    if (options.muet === true) return;

    const repondre = (ligne: string) => {
      socket.write(`${ligne}\r\n`);
    };
    let tampon = '';
    let etat: 'commande' | 'donnees' | 'auth-plain' | 'auth-login-utilisateur' | 'auth-login-mot-de-passe' = 'commande';
    let mailFrom = '';
    let rcptTo: string[] = [];
    let lignesDonnees: string[] = [];
    let utilisateurLogin = '';

    const traiterLigne = (ligne: string) => {
      if (etat === 'donnees') {
        if (ligne === '.') {
          messages.push({ mailFrom, rcptTo, donnees: lignesDonnees.join('\r\n') });
          mailFrom = '';
          rcptTo = [];
          lignesDonnees = [];
          etat = 'commande';
          repondre('250 2.0.0 Message accepte');
        } else {
          lignesDonnees.push(ligne.startsWith('.') ? ligne.slice(1) : ligne);
        }
        return;
      }
      if (etat === 'auth-plain') {
        authentifications.push(identifiantsPlain(ligne));
        etat = 'commande';
        repondre('235 2.7.0 Authentification reussie');
        return;
      }
      if (etat === 'auth-login-utilisateur') {
        utilisateurLogin = decoder64(ligne);
        etat = 'auth-login-mot-de-passe';
        repondre('334 UGFzc3dvcmQ6');
        return;
      }
      if (etat === 'auth-login-mot-de-passe') {
        authentifications.push({ utilisateur: utilisateurLogin, motDePasse: decoder64(ligne) });
        etat = 'commande';
        repondre('235 2.7.0 Authentification reussie');
        return;
      }

      const [verbeBrut = '', ...reste] = ligne.split(' ');
      const verbe = verbeBrut.toUpperCase();
      const argument = reste.join(' ');
      commandes.push(verbe);
      switch (verbe) {
        case 'EHLO':
          repondre('250-smtp.factice.test');
          if (options.sansAuth !== true) repondre('250-AUTH PLAIN LOGIN');
          repondre('250-8BITMIME');
          repondre('250 SMTPUTF8');
          return;
        case 'HELO':
          repondre('250 smtp.factice.test');
          return;
        case 'AUTH': {
          const [mecanisme = '', initial] = argument.split(' ');
          if (mecanisme.toUpperCase() === 'PLAIN') {
            if (initial === undefined || initial === '') {
              etat = 'auth-plain';
              repondre('334 ');
            } else {
              authentifications.push(identifiantsPlain(initial));
              repondre('235 2.7.0 Authentification reussie');
            }
            return;
          }
          if (mecanisme.toUpperCase() === 'LOGIN') {
            if (initial === undefined || initial === '') {
              etat = 'auth-login-utilisateur';
              repondre('334 VXNlcm5hbWU6');
            } else {
              utilisateurLogin = decoder64(initial);
              etat = 'auth-login-mot-de-passe';
              repondre('334 UGFzc3dvcmQ6');
            }
            return;
          }
          repondre('504 5.5.4 Mecanisme inconnu');
          return;
        }
        case 'MAIL':
          mailFrom = sansChevrons(argument.replace(/^FROM:/i, ''));
          repondre('250 2.1.0 OK');
          return;
        case 'RCPT':
          if (options.refuserDestinataire === true) {
            repondre('550 5.1.1 Destinataire refuse');
            return;
          }
          rcptTo.push(sansChevrons(argument.replace(/^TO:/i, '')));
          repondre('250 2.1.5 OK');
          return;
        case 'DATA':
          if (rcptTo.length === 0) {
            repondre('554 5.5.1 Aucun destinataire valide');
            return;
          }
          etat = 'donnees';
          repondre('354 Fin par <CRLF>.<CRLF>');
          return;
        case 'RSET':
          mailFrom = '';
          rcptTo = [];
          lignesDonnees = [];
          repondre('250 2.0.0 OK');
          return;
        case 'NOOP':
          repondre('250 2.0.0 OK');
          return;
        case 'QUIT':
          repondre('221 2.0.0 Au revoir');
          socket.end();
          return;
        default:
          repondre('502 5.5.2 Commande inconnue');
      }
    };

    socket.on('data', (morceau: Buffer) => {
      tampon += morceau.toString('utf8');
      for (let fin = tampon.indexOf('\r\n'); fin >= 0; fin = tampon.indexOf('\r\n')) {
        const ligne = tampon.slice(0, fin);
        tampon = tampon.slice(fin + 2);
        traiterLigne(ligne);
      }
    });
    repondre('220 smtp.factice.test ESMTP');
  });

  await new Promise<void>((pret) => {
    serveur.listen(0, '127.0.0.1', pret);
  });
  const { port } = serveur.address() as AddressInfo;

  return {
    port,
    messages,
    authentifications,
    commandes,
    connexions: () => connexions,
    fermer() {
      for (const s of sockets) s.destroy();
      return new Promise<void>((fin) => {
        serveur.close(() => {
          fin();
        });
      });
    },
  };
}

/** Un port local sur lequel personne n'écoute (réservé puis libéré). */
export async function portFerme(): Promise<number> {
  const serveur = createServer();
  await new Promise<void>((pret) => {
    serveur.listen(0, '127.0.0.1', pret);
  });
  const { port } = serveur.address() as AddressInfo;
  await new Promise<void>((fin) => {
    serveur.close(() => {
      fin();
    });
  });
  return port;
}

// ── Lecture d'un message MIME reçu (assez pour vérifier ce qu'on envoie) ─────────────────────

/** En-têtes dépliés (RFC 5322 §2.2.3), clés en minuscules ; la dernière occurrence gagne. */
export function lireEnTetes(donnees: string): Map<string, string> {
  const [bloc = ''] = donnees.split('\r\n\r\n');
  const deplie = bloc.replace(/\r\n[ \t]+/g, ' ');
  const enTetes = new Map<string, string>();
  for (const ligne of deplie.split('\r\n')) {
    const i = ligne.indexOf(':');
    if (i > 0) enTetes.set(ligne.slice(0, i).trim().toLowerCase(), ligne.slice(i + 1).trim());
  }
  return enTetes;
}

/** Octets d'un texte où « =XX » code un octet ; `souligneEspace` : « _ » vaut une espace (en-têtes). */
function decoderEgalHex(texte: string, charset: string, souligneEspace: boolean): string {
  const octets: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i] ?? '';
    if (souligneEspace && c === '_') octets.push(0x20);
    else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(texte.slice(i + 1, i + 3))) {
      octets.push(parseInt(texte.slice(i + 1, i + 3), 16));
      i += 2;
    } else octets.push(...Buffer.from(c, 'utf8'));
  }
  return new TextDecoder(charset).decode(new Uint8Array(octets));
}

/** Décode les mots encodés (RFC 2047, B et Q) d'une valeur d'en-tête. */
export function decoderMotsEncodes(valeur: string): string {
  return valeur
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_tout, charset: string, codage: string, texte: string) =>
      codage.toUpperCase() === 'B'
        ? new TextDecoder(charset).decode(Buffer.from(texte, 'base64'))
        : decoderEgalHex(texte, charset, true),
    );
}

/**
 * Texte d'un message simple (text/plain, non multipart, ou la première partie text/plain d'un
 * multipart), décodé (7bit, 8bit, quoted-printable, base64), lignes en \n.
 */
export function lireTexte(donnees: string): string {
  const enTetes = lireEnTetes(donnees);
  const corps = donnees.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  const type = enTetes.get('content-type') ?? 'text/plain';
  const frontiere = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && frontiere !== undefined) {
    for (const partie of corps.split(`--${frontiere}`)) {
      const p = partie.replace(/^\r\n/, '');
      if (/content-type:\s*text\/plain/i.test(p.split('\r\n\r\n')[0] ?? '')) return lireTexte(p.replace(/\r\n$/, ''));
    }
    return '';
  }
  const codage = (enTetes.get('content-transfer-encoding') ?? '7bit').toLowerCase();
  let texte: string;
  if (codage === 'base64') texte = Buffer.from(corps.replace(/\s+/g, ''), 'base64').toString('utf8');
  else if (codage === 'quoted-printable') texte = decoderEgalHex(corps.replace(/=\r\n/g, ''), 'utf-8', false);
  else texte = corps;
  return texte.replace(/\r\n/g, '\n').replace(/\n$/, '');
}
