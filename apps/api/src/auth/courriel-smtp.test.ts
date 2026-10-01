/**
 * Tests d'acceptation T09b — vrai expéditeur de courriel (SMTP), contre un serveur SMTP factice
 * local (test/smtp-factice.ts) : aucun service réel, aucun secret.
 *
 * ── Choix : SMTP générique ──────────────────────────────────────────────────────────────────
 *
 * Tous les fournisseurs hébergés en UE (Brevo, Scaleway Transactional Email, Mailjet, OVH…)
 * offrent un relais SMTP authentifié ; une API HTTP propre à chacun lierait le code à un
 * fournisseur. Le choix du fournisseur (contrat, DPA, domaine d'envoi SPF/DKIM/DMARC) revient à
 * Théophane ; le code ne dépend que de ces variables.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/auth/index.ts exporte, en plus de l'existant :
 *
 *   type SecuriteSmtp = 'tls' | 'starttls' | 'aucune';
 *   interface OptionsSmtp {
 *     readonly hote: string;
 *     readonly port: number;
 *     readonly securite: SecuriteSmtp;
 *       // 'tls'      : TLS dès la connexion (port 465 d'ordinaire)
 *       // 'starttls' : STARTTLS OBLIGATOIRE (port 587) ; si le serveur ne le propose pas, rien
 *       //              n'est envoyé (ni identifiants ni message) et `envoyer` échoue
 *       // 'aucune'   : en clair ; développement et tests seulement (lireConfig la refuse en
 *       //              production, voir config.test.ts)
 *     readonly utilisateur?: string;      // identifiants AUTH (PLAIN ou LOGIN), les deux ou aucun
 *     readonly motDePasse?: string;
 *     readonly expediteur: string;        // en-tête From, ex. « Planifications <connexion@planif.fr> »
 *     readonly delaiMs?: number;          // délai max d'un envoi (connexion comprise), défaut 10 000
 *   }
 *   expediteurSmtp(options: OptionsSmtp): ExpediteurCourriel
 *
 * `envoyer(message)` :
 *   - appelle d'abord verifierEnTetes(message) : un CR ou LF dans `a` ou `sujet` rejette la
 *     promesse SANS ouvrir de connexion ;
 *   - envoie un message text/plain en UTF-8 : MAIL FROM = adresse de `expediteur`, RCPT TO =
 *     `a`, en-têtes From, To, Subject (mots encodés RFC 2047 si non ASCII), Date, Message-ID ;
 *     le texte arrive intact (accents, lignes qui commencent par un point) ;
 *   - rejette si le serveur refuse (4xx/5xx), est injoignable, ou ne répond pas dans `delaiMs`.
 *   - relecture sécurité : `a` est UNE adresse, passée sans analyse (avec nodemailer :
 *     `to: { name: '', address: a }` et une enveloppe explicite `envelope: { from, to: [{ name:
 *     '', address: a }] }`) : un seul RCPT TO par message, exactement `a` pour une adresse
 *     ordinaire ; une liste (« a@x.fr,pirate@y.fr ») ou un nom d'affichage (« Nom <pirate@y.fr> »)
 *     glissé dans `a` n'est jamais décomposé en plusieurs destinataires ni réduit à l'adresse
 *     entre chevrons (l'API refuse déjà ces adresses : durcissement.integration.test.ts, 5).
 *
 * Implémentation libre (nodemailer, qui fait tout cela, ou client maison). index.ts construit
 * l'expéditeur choisi par lireConfig (config.test.ts : `courriel.type === 'smtp'`).
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que l'export
 * n'existe ; il échoue alors sur « expediteurSmtp n'est pas une fonction ».
 */
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExpediteurCourriel, MessageCourriel } from './index.ts';
import {
  decoderMotsEncodes,
  demarrerSmtpFactice,
  lireEnTetes,
  lireHtml,
  lireTexte,
  MARQUEUR_RELAIS,
  portFerme,
  typesDesParties,
  type ServeurSmtpFactice,
} from './test/smtp-factice.ts';

type SecuriteSmtp = 'tls' | 'starttls' | 'aucune';

interface OptionsSmtp {
  readonly hote: string;
  readonly port: number;
  readonly securite: SecuriteSmtp;
  readonly utilisateur?: string;
  readonly motDePasse?: string;
  readonly expediteur: string;
  readonly delaiMs?: number;
}

/** T09c : l'expéditeur SMTP sait aussi vérifier la connexion au relais (démarrage de l'API). */
interface ExpediteurSmtp extends ExpediteurCourriel {
  verifier(): Promise<void>;
}

interface ModuleAuth {
  readonly expediteurSmtp?: (options: OptionsSmtp) => ExpediteurSmtp;
}

const CHEMIN_AUTH = './index.ts';

async function expediteurSmtp(options: OptionsSmtp): Promise<ExpediteurSmtp> {
  const module = (await import(CHEMIN_AUTH)) as ModuleAuth;
  if (typeof module.expediteurSmtp !== 'function') throw new Error('expediteurSmtp n’est pas une fonction exportée par auth/index.ts');
  return module.expediteurSmtp(options);
}

const EXPEDITEUR = 'Planifications <connexion@planif.fr>';

const MESSAGE: MessageCourriel = {
  a: 'theo@ferme.fr',
  sujet: 'Votre code de connexion : 123456',
  texte: 'Votre code de connexion : 123456\n\nIl est valable 10 minutes.',
};

let serveurs: ServeurSmtpFactice[] = [];

async function serveur(options?: Parameters<typeof demarrerSmtpFactice>[0]): Promise<ServeurSmtpFactice> {
  const s = await demarrerSmtpFactice(options);
  serveurs.push(s);
  return s;
}

afterEach(async () => {
  await Promise.all(serveurs.map((s) => s.fermer()));
  serveurs = [];
});

function options(port: number, autres: Partial<OptionsSmtp> = {}): OptionsSmtp {
  return { hote: '127.0.0.1', port, securite: 'aucune', expediteur: EXPEDITEUR, delaiMs: 3_000, ...autres };
}

async function envoyer(expediteur: ExpediteurCourriel, message: MessageCourriel): Promise<void> {
  await expediteur.envoyer(message);
}

describe('expediteurSmtp (T09b)', () => {
  it('envoie le message : enveloppe, en-têtes From, To, Subject, Date, Message-ID, texte', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port)), MESSAGE);

    expect(smtp.messages).toHaveLength(1);
    const [recu] = smtp.messages;
    expect(recu?.mailFrom).toBe('connexion@planif.fr');
    expect(recu?.rcptTo).toEqual(['theo@ferme.fr']);
    const enTetes = lireEnTetes(recu?.donnees ?? '');
    expect(enTetes.get('from')).toContain('connexion@planif.fr');
    expect(enTetes.get('to')).toContain('theo@ferme.fr');
    expect(decoderMotsEncodes(enTetes.get('subject') ?? '')).toBe(MESSAGE.sujet);
    expect(enTetes.get('date')).toBeTruthy();
    expect(enTetes.get('message-id')).toMatch(/^<[^<>@\s]+@[^<>@\s]+>$/);
    expect(enTetes.has('bcc')).toBe(false);
    expect(lireTexte(recu?.donnees ?? '')).toBe(MESSAGE.texte);
  });

  it('UTF-8 : sujet et texte accentués arrivent intacts, une ligne réduite à un point aussi', async () => {
    const smtp = await serveur();
    const message: MessageCourriel = {
      a: 'equipier@ferme.fr',
      sujet: 'Invitation à la ferme « Jardins de Garonne » — équipe',
      texte: 'Théophane vous invite dans « Jardins de Garonne ».\n.\n..deux points\nÀ bientôt, l’équipe.',
    };
    await envoyer(await expediteurSmtp(options(smtp.port)), message);

    const donnees = smtp.messages[0]?.donnees ?? '';
    expect(decoderMotsEncodes(lireEnTetes(donnees).get('subject') ?? '')).toBe(message.sujet);
    expect(lireTexte(donnees)).toBe(message.texte);
    expect(lireEnTetes(donnees).get('content-type') ?? '').toMatch(/charset="?utf-8"?/i);
  });

  it('transmet les identifiants (AUTH PLAIN ou LOGIN) avant MAIL FROM', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port, { utilisateur: 'relais-planif', motDePasse: 'secret-de-test' })), MESSAGE);

    expect(smtp.authentifications).toEqual([{ utilisateur: 'relais-planif', motDePasse: 'secret-de-test' }]);
    expect(smtp.commandes.indexOf('AUTH')).toBeLessThan(smtp.commandes.indexOf('MAIL'));
    expect(smtp.messages).toHaveLength(1);
  });

  it('RCPT TO est exactement l’adresse donnée (adresses ordinaires, même inhabituelles)', async () => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(options(smtp.port));
    const adresses = ["o'neil+recolte@ferme.fr", 'prenom.nom-2@mail.sous-domaine.ferme.fr', '{equipe}@ferme.fr', 'a=b!c@ferme.fr'];
    for (const a of adresses) await envoyer(expediteur, { ...MESSAGE, a });
    expect(smtp.messages.map((m) => m.rcptTo)).toEqual(adresses.map((a) => [a]));
  });

  it.each([
    'victime@ferme.fr,pirate@ailleurs.fr',
    'victime@ferme.fr, pirate@ailleurs.fr',
    'victime@ferme.fr;pirate@ailleurs.fr',
    'Pirate <pirate@ailleurs.fr>',
    'victime@ferme.fr <pirate@ailleurs.fr>',
  ])('adresse jamais décomposée : « %s » ne fait partir qu’un seul RCPT TO, jamais vers pirate@ailleurs.fr', async (a) => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(options(smtp.port));
    // Refuser sans rien envoyer est permis aussi ; décomposer, jamais.
    await envoyer(expediteur, { ...MESSAGE, a }).catch(() => undefined);
    for (const m of smtp.messages) {
      expect(m.rcptTo).toHaveLength(1);
      expect(m.rcptTo).not.toContain('pirate@ailleurs.fr');
      expect(m.rcptTo).not.toContain('victime@ferme.fr');
    }
    expect(smtp.commandes.filter((c) => c === 'RCPT').length).toBeLessThanOrEqual(1);
  });

  const refuses: readonly (readonly [string, MessageCourriel])[] = [
    ['sujet avec CRLF', { ...MESSAGE, sujet: 'Invitation : Jardins\r\nBcc: pirate@exemple.fr' }],
    ['sujet avec LF', { ...MESSAGE, sujet: 'Invitation\nBcc: pirate@exemple.fr' }],
    ['destinataire avec CR', { ...MESSAGE, a: 'theo@ferme.fr\rBcc: pirate@exemple.fr' }],
    ['destinataire avec CRLF', { ...MESSAGE, a: 'theo@ferme.fr\r\nBcc: pirate@exemple.fr' }],
  ];
  for (const [cas, message] of refuses) {
    it(`verifierEnTetes : ${cas} refusé sans ouvrir de connexion`, async () => {
      const smtp = await serveur();
      const expediteur = await expediteurSmtp(options(smtp.port));
      await expect(envoyer(expediteur, message)).rejects.toThrow();
      expect(smtp.connexions()).toBe(0);
      expect(smtp.messages).toHaveLength(0);
    });
  }

  it('destinataire refusé par le serveur (550) : envoyer échoue', async () => {
    const smtp = await serveur({ refuserDestinataire: true });
    await expect(envoyer(await expediteurSmtp(options(smtp.port)), MESSAGE)).rejects.toThrow();
    expect(smtp.messages).toHaveLength(0);
  });

  it('serveur injoignable : envoyer échoue', async () => {
    const port = await portFerme();
    await expect(envoyer(await expediteurSmtp(options(port)), MESSAGE)).rejects.toThrow();
  });

  it('serveur muet : envoyer échoue après delaiMs, sans attendre indéfiniment', async () => {
    const smtp = await serveur({ muet: true });
    const debut = Date.now();
    await expect(envoyer(await expediteurSmtp(options(smtp.port, { delaiMs: 300 })), MESSAGE)).rejects.toThrow();
    expect(Date.now() - debut).toBeLessThan(5_000);
  }, 10_000);

  it('starttls obligatoire : serveur sans STARTTLS, ni identifiants ni message ne partent en clair', async () => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(
      options(smtp.port, { securite: 'starttls', utilisateur: 'relais-planif', motDePasse: 'secret-de-test' }),
    );
    await expect(envoyer(expediteur, MESSAGE)).rejects.toThrow();
    expect(smtp.authentifications).toHaveLength(0);
    expect(smtp.commandes).not.toContain('MAIL');
    expect(smtp.messages).toHaveLength(0);
  });
});

// ── T09c : envoi par Brevo (relais SMTP) ─────────────────────────────────────────────────────
//
// Contrat ajouté (courriel-smtp.ts, réexporté par auth/index.ts) :
//
//   expediteurSmtp(options): ExpediteurSmtp
//   interface ExpediteurSmtp extends ExpediteurCourriel {
//     verifier(): Promise<void>;
//       // Ouvre une connexion au relais (EHLO, STARTTLS si 'starttls', AUTH si identifiants),
//       // sans rien envoyer, puis la ferme. Rejette si le relais est injoignable, muet au-delà
//       // de delaiMs, sans STARTTLS alors qu'il est exigé, ou refuse les identifiants : Error en
//       // français qui nomme l'hôte et le port, et ne contient JAMAIS le mot de passe.
//       // (Avec nodemailer : transport.verify().)
//   }
//
//   envoyer(message) :
//     - message.html présent → multipart/alternative : une partie text/plain (message.texte)
//       puis une partie text/html (message.html), toutes deux en UTF-8 ; absent → text/plain
//       seul, comme en T09b ;
//     - en-tête From au nom de l'appli : si `expediteur` est une adresse nue
//       (« connexion@planif.fr »), le nom d'affichage « Planifications » est ajouté ; un nom
//       déjà donné (« Ferme <x@y.fr> ») est gardé. MAIL FROM reste l'adresse nue.

const MESSAGE_HTML = {
  ...MESSAGE,
  html: '<!doctype html><html lang="fr"><body><p>Votre code de connexion :</p><p><strong>123456</strong></p></body></html>',
};

describe('expediteurSmtp : texte brut et HTML (T09c)', () => {
  it('avec html : multipart/alternative, texte brut puis HTML, tous deux intacts en UTF-8', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port)), MESSAGE_HTML);

    const donnees = smtp.messages[0]?.donnees ?? '';
    expect(lireEnTetes(donnees).get('content-type') ?? '').toMatch(/^multipart\/alternative/i);
    expect(typesDesParties(donnees)).toEqual(['text/plain', 'text/html']);
    expect(lireTexte(donnees)).toBe(MESSAGE.texte);
    expect(lireHtml(donnees)).toBe(MESSAGE_HTML.html);
    expect(donnees).toMatch(/content-type:\s*text\/html;\s*charset="?utf-8"?/i);
  });

  it('témoin : sans html, le message reste en text/plain seul', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port)), MESSAGE);
    expect(typesDesParties(smtp.messages[0]?.donnees ?? '')).toEqual(['text/plain']);
  });

  it('avec html, verifierEnTetes s’applique toujours : rien ne part', async () => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(options(smtp.port));
    await expect(envoyer(expediteur, { ...MESSAGE_HTML, sujet: 'Code\r\nBcc: pirate@exemple.fr' })).rejects.toThrow();
    expect(smtp.connexions()).toBe(0);
  });
});

describe('expediteurSmtp : expéditeur au nom de l’appli (T09c)', () => {
  it('adresse nue : From porte le nom « Planifications », MAIL FROM reste l’adresse', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port, { expediteur: 'connexion@planif.fr' })), MESSAGE);

    const [recu] = smtp.messages;
    expect(recu?.mailFrom).toBe('connexion@planif.fr');
    const from = decoderMotsEncodes(lireEnTetes(recu?.donnees ?? '').get('from') ?? '');
    expect(from).toMatch(/^"?Planifications"? <connexion@planif\.fr>$/);
  });

  it('témoin : un nom d’affichage déjà donné est gardé', async () => {
    const smtp = await serveur();
    await envoyer(await expediteurSmtp(options(smtp.port, { expediteur: 'Ferme du Bois <connexion@ferme.fr>' })), MESSAGE);

    const [recu] = smtp.messages;
    expect(recu?.mailFrom).toBe('connexion@ferme.fr');
    expect(decoderMotsEncodes(lireEnTetes(recu?.donnees ?? '').get('from') ?? '')).toMatch(/^"?Ferme du Bois"? <connexion@ferme\.fr>$/);
  });
});

describe('expediteurSmtp.verifier : connexion au relais sans rien envoyer (T09c)', () => {
  const MOT_DE_PASSE = 'secret-de-test-ne-pas-afficher';

  it('relais joignable : se connecte, s’authentifie, n’envoie aucun message', async () => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(options(smtp.port, { utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE }));
    await expediteur.verifier();

    expect(smtp.connexions()).toBe(1);
    expect(smtp.authentifications).toEqual([{ utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE }]);
    expect(smtp.commandes).not.toContain('MAIL');
    expect(smtp.messages).toHaveLength(0);
  });

  function messageClair(port: number) {
    return (e: unknown): boolean =>
      e instanceof Error &&
      e.message.includes('SMTP') &&
      e.message.includes('127.0.0.1') &&
      e.message.includes(String(port)) &&
      !e.message.includes(MOT_DE_PASSE);
  }

  it('relais injoignable : rejette avec l’hôte et le port, sans le mot de passe', async () => {
    const port = await portFerme();
    const expediteur = await expediteurSmtp(options(port, { utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE }));
    await expect(expediteur.verifier()).rejects.toSatisfy(messageClair(port));
  });

  it('relais muet : rejette après delaiMs', async () => {
    const smtp = await serveur({ muet: true });
    const expediteur = await expediteurSmtp(options(smtp.port, { delaiMs: 300, utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE }));
    const debut = Date.now();
    await expect(expediteur.verifier()).rejects.toSatisfy(messageClair(smtp.port));
    expect(Date.now() - debut).toBeLessThan(5_000);
  }, 10_000);

  it('STARTTLS exigé mais absent : rejette, les identifiants ne partent pas en clair', async () => {
    const smtp = await serveur();
    const expediteur = await expediteurSmtp(
      options(smtp.port, { securite: 'starttls', utilisateur: 'relais-planif', motDePasse: MOT_DE_PASSE }),
    );
    await expect(expediteur.verifier()).rejects.toSatisfy(messageClair(smtp.port));
    expect(smtp.authentifications).toHaveLength(0);
  });
});

// ── Relecture T09c : le mot de passe ne fuit dans aucune erreur ───────────────────────────────
//
// Un relais bavard (ou malveillant) peut répéter dans sa réponse d'erreur la ligne AUTH reçue :
// base64(« \0utilisateur\0motDePasse ») en PLAIN, base64(motDePasse) en LOGIN. Ni le mot de passe
// en clair, ni ces deux formes base64 ne doivent apparaître dans l'erreur rejetée par verifier()
// ou envoyer(), où que ce soit : message, pile, cause, et les champs que nodemailer ajoute
// (response, command…). Mesuré par util.inspect(erreur, { depth: 5 }).

describe('relecture T09c : aucune fuite du mot de passe dans les erreurs SMTP', () => {
  const UTILISATEUR = 'relais-planif';
  const SECRET = 'Mdp-Brevo-T09c-x7Q';
  const FORMES = [
    ['en clair', SECRET],
    ['base64 PLAIN', Buffer.from(`\u0000${UTILISATEUR}\u0000${SECRET}`).toString('base64')],
    ['base64 du mot de passe', Buffer.from(SECRET).toString('base64')],
  ] as const;

  async function erreurDe(action: () => Promise<void>): Promise<unknown> {
    try {
      await action();
    } catch (erreur) {
      return erreur;
    }
    throw new Error('l’action devait échouer (le relais refuse l’authentification)');
  }

  function sansSecret(erreur: unknown): void {
    const vu = inspect(erreur, { depth: 5 });
    for (const [forme, valeur] of FORMES) {
      expect(vu.includes(valeur), `mot de passe (${forme}) visible dans l’erreur :\n${vu}`).toBe(false);
    }
  }

  for (const mecanisme of ['PLAIN', 'LOGIN'] as const) {
    it(`témoin : le relais factice répète bien le secret (AUTH ${mecanisme})`, async () => {
      const smtp = await serveur({ authEcho: true, mecanismes: mecanisme });
      const expediteur = await expediteurSmtp(options(smtp.port, { utilisateur: UTILISATEUR, motDePasse: SECRET }));
      await erreurDe(() => envoyer(expediteur, MESSAGE));
      expect(smtp.authentifications).toEqual([{ utilisateur: UTILISATEUR, motDePasse: SECRET }]);
    });

    it(`verifier() : refus AUTH ${mecanisme} qui répète la ligne reçue, aucune forme du mot de passe dans l’erreur`, async () => {
      const smtp = await serveur({ authEcho: true, mecanismes: mecanisme });
      const expediteur = await expediteurSmtp(options(smtp.port, { utilisateur: UTILISATEUR, motDePasse: SECRET }));
      sansSecret(await erreurDe(() => expediteur.verifier()));
    });

    it(`envoyer() : refus AUTH ${mecanisme} qui répète la ligne reçue, aucune forme du mot de passe dans l’erreur`, async () => {
      const smtp = await serveur({ authEcho: true, mecanismes: mecanisme });
      const expediteur = await expediteurSmtp(options(smtp.port, { utilisateur: UTILISATEUR, motDePasse: SECRET }));
      sansSecret(await erreurDe(() => envoyer(expediteur, MESSAGE)));
      expect(smtp.messages).toHaveLength(0);
    });
  }
});

// ── Contre-relecture T09c : la réponse du serveur n'est JAMAIS recopiée dans l'erreur ─────────
//
// Nettoyer le mot de passe à la main ne suffit pas : le relais peut le répéter sous une forme
// imprévue (base64 sans « = », coupé sur deux lignes de réponse, hexadécimal…). Règle : l'erreur
// rejetée par verifier() ou envoyer() ne recopie RIEN du texte libre de la réponse du serveur.
// Elle peut nommer le relais (hôte:port) et le code (« 535 », « EAUTH », « 550 »…), rien d'autre
// venu du serveur. Mesuré par util.inspect(erreur, { depth: 5 }) : ni MARQUEUR_RELAIS (texte
// libre que le relais factice insère dans chaque réponse d'erreur), ni aucune forme du secret,
// ni (refus de destinataire) l'adresse refusée.

describe('contre-relecture T09c : rien de la réponse du serveur dans l’erreur', () => {
  const UTILISATEUR = 'relais-planif';
  // 16 caractères : les formes base64 ont un « = » final, que le relais va retirer.
  const SECRET = 'Mdp-Brevo-T09c-x';
  const plain = Buffer.from(`\u0000${UTILISATEUR}\u0000${SECRET}`);
  const seul = Buffer.from(SECRET);
  const INTERDITS = [
    ['marqueur du relais', MARQUEUR_RELAIS],
    ['mot de passe en clair', SECRET],
    ['base64 PLAIN', plain.toString('base64')],
    ['base64 PLAIN sans =', plain.toString('base64').replace(/=+$/, '')],
    ['base64 du mot de passe', seul.toString('base64')],
    ['base64 du mot de passe sans =', seul.toString('base64').replace(/=+$/, '')],
    ['hex PLAIN', plain.toString('hex')],
    ['hex du mot de passe', seul.toString('hex')],
    // Deux moitiés du base64 coupé : la première suffit à trahir la fuite.
    ['moitié de base64 PLAIN', plain.toString('base64').slice(0, Math.floor(plain.toString('base64').length / 2))],
    ['moitié de base64 du mot de passe', seul.toString('base64').slice(0, Math.floor(seul.toString('base64').length / 2))],
  ] as const;

  async function erreurDe(action: () => Promise<void>): Promise<unknown> {
    try {
      await action();
    } catch (erreur) {
      return erreur;
    }
    throw new Error('l’action devait échouer (le relais refuse)');
  }

  function rienDuServeur(erreur: unknown, port: number, autres: readonly (readonly [string, string])[] = []): void {
    const vu = inspect(erreur, { depth: 5 });
    expect(erreur).toBeInstanceOf(Error);
    expect(vu).toContain(`127.0.0.1:${String(port)}`);
    for (const [nom, valeur] of [...INTERDITS, ...autres]) {
      expect(vu.includes(valeur), `${nom} visible dans l’erreur :\n${vu}`).toBe(false);
    }
  }

  for (const mecanisme of ['PLAIN', 'LOGIN'] as const) {
    for (const forme of ['ligne', 'sans-egal', 'deux-lignes', 'hex'] as const) {
      for (const action of ['verifier', 'envoyer'] as const) {
        it(`${action}() : AUTH ${mecanisme} refusée, réponse « ${forme} » : ni texte du serveur ni secret`, async () => {
          const smtp = await serveur({ authEcho: forme, mecanismes: mecanisme });
          const expediteur = await expediteurSmtp(options(smtp.port, { utilisateur: UTILISATEUR, motDePasse: SECRET }));
          const erreur = await erreurDe(() => (action === 'verifier' ? expediteur.verifier() : envoyer(expediteur, MESSAGE)));
          expect(smtp.authentifications).toEqual([{ utilisateur: UTILISATEUR, motDePasse: SECRET }]);
          rienDuServeur(erreur, smtp.port);
          expect(inspect(erreur, { depth: 5 })).toMatch(/535|EAUTH/);
        });
      }
    }
  }

  it('envoyer() : destinataire refusé (550 qui répète l’adresse) : ni l’adresse ni le texte du serveur', async () => {
    const smtp = await serveur({ refuserDestinataire: true });
    const expediteur = await expediteurSmtp(options(smtp.port));
    const a = 'destinataire-unique-t09c@ferme.fr';
    const erreur = await erreurDe(() => envoyer(expediteur, { ...MESSAGE, a }));
    rienDuServeur(erreur, smtp.port, [['adresse refusée', a]]);
  });
});
