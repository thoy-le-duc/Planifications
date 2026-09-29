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
 *
 * Implémentation libre (nodemailer, qui fait tout cela, ou client maison). index.ts construit
 * l'expéditeur choisi par lireConfig (config.test.ts : `courriel.type === 'smtp'`).
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que l'export
 * n'existe ; il échoue alors sur « expediteurSmtp n'est pas une fonction ».
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ExpediteurCourriel, MessageCourriel } from './index.ts';
import {
  decoderMotsEncodes,
  demarrerSmtpFactice,
  lireEnTetes,
  lireTexte,
  portFerme,
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

interface ModuleAuth {
  readonly expediteurSmtp?: (options: OptionsSmtp) => ExpediteurCourriel;
}

const CHEMIN_AUTH = './index.ts';

async function expediteurSmtp(options: OptionsSmtp): Promise<ExpediteurCourriel> {
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
