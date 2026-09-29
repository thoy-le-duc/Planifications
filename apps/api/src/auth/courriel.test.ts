/**
 * Relecture sécurité de T09 — injection d'en-têtes dans les e-mails.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Tout ExpediteurCourriel refuse un message dont le destinataire (`a`) ou le sujet (`sujet`)
 * contient un retour chariot (\r) ou un saut de ligne (\n) : `envoyer` échoue (promesse
 * rejetée, ou exception) et n'envoie rien. Le texte, lui, peut tenir sur plusieurs lignes.
 *
 * La vérification vit dans une fonction partagée de courriel.ts, appelée par expediteurConsole
 * et que reprendra le futur expéditeur réel (ticket suivant) : c'est la dernière frontière avant
 * l'en-tête SMTP, quelle que soit la route qui compose le message (nom de ferme, adresse…).
 */
import { describe, expect, it } from 'vitest';
import { expediteurConsole, type MessageCourriel } from './index.ts';

function expediteurEspion() {
  const lignes: string[] = [];
  const expediteur = expediteurConsole((ligne) => {
    lignes.push(ligne);
  });
  return { expediteur, lignes };
}

const MESSAGE: MessageCourriel = {
  a: 'theo@ferme.fr',
  sujet: 'Votre code de connexion : 123456',
  texte: 'Votre code : 123456\n\nIl est valable 10 minutes.',
};

describe('expéditeur : pas de retour à la ligne dans les en-têtes', () => {
  it('témoin : un message ordinaire, texte sur plusieurs lignes, est envoyé', async () => {
    const { expediteur, lignes } = expediteurEspion();
    await expediteur.envoyer(MESSAGE);
    expect(lignes).toHaveLength(1);
  });

  const refuses: readonly (readonly [string, MessageCourriel])[] = [
    ['sujet avec CRLF', { ...MESSAGE, sujet: 'Invitation : Jardins\r\nBcc: pirate@exemple.fr' }],
    ['sujet avec LF', { ...MESSAGE, sujet: 'Invitation\nBcc: pirate@exemple.fr' }],
    ['sujet avec CR', { ...MESSAGE, sujet: 'Invitation\rBcc: pirate@exemple.fr' }],
    ['destinataire avec LF', { ...MESSAGE, a: 'theo@ferme.fr\nBcc: pirate@exemple.fr' }],
    ['destinataire avec CRLF', { ...MESSAGE, a: 'theo@ferme.fr\r\nBcc: pirate@exemple.fr' }],
  ];

  for (const [cas, message] of refuses) {
    it(`refuse : ${cas}, sans rien envoyer`, async () => {
      const { expediteur, lignes } = expediteurEspion();
      await expect(
        (async () => {
          await expediteur.envoyer(message);
        })(),
      ).rejects.toThrow();
      expect(lignes).toHaveLength(0);
    });
  }
});
