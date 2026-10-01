/**
 * Préparation de l'expéditeur d'e-mail au démarrage de l'API (T09c). Sans effet de bord à
 * l'import : index.ts appelle `preparerExpediteur(config.courriel)` avant d'écouter.
 *
 * Une panne du relais SMTP (Brevo en production) ne doit jamais empêcher l'API, donc la synchro,
 * de démarrer : l'échec de la vérification est écrit dans le journal, l'expéditeur est rendu
 * quand même et l'envoi d'un code échouera ensuite normalement. Seule une configuration
 * incomplète (lireConfig) arrête le processus. Contrat : demarrage.test.ts.
 */
import { expediteurConsole, expediteurSmtp, type ExpediteurCourriel } from './auth/index.ts';
import type { ConfigCourriel } from './config.ts';

export async function preparerExpediteur(
  courriel: ConfigCourriel,
  journal: (ligne: string) => void = console.error,
): Promise<ExpediteurCourriel> {
  if (courriel.type === 'console') return expediteurConsole();
  const expediteur = expediteurSmtp(courriel);
  try {
    await expediteur.verifier();
  } catch (erreur) {
    // verifier() nomme déjà l'hôte et le port, sans le mot de passe.
    const detail = erreur instanceof Error ? erreur.message : String(erreur);
    journal(
      `Avertissement : vérification du relais SMTP ${courriel.hote}:${String(courriel.port)} en échec, ` +
        `l'API démarre quand même mais les codes de connexion ne partiront pas tant qu'il ne répond pas. ${detail}`,
    );
  }
  return expediteur;
}
