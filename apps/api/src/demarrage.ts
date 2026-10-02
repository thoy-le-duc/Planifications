/**
 * Préparation de l'expéditeur d'e-mail au démarrage de l'API (T09c). Sans effet de bord à
 * l'import : index.ts appelle `preparerExpediteur(config.courriel)`.
 *
 * Une panne du relais SMTP (Brevo en production) ne doit jamais empêcher ni retarder le
 * démarrage de l'API, donc de la synchro : la vérification part en tâche de fond, son échec est
 * écrit dans le journal, et l'envoi d'un code échouera ensuite normalement. Seule une configuration
 * incomplète (lireConfig) arrête le processus. Contrat : demarrage.test.ts.
 */
import { ErreurEnvoiCourriel, expediteurConsole, expediteurSmtp, type ExpediteurCourriel } from './auth/index.ts';
import type { ConfigCourriel } from './config.ts';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, ligneDeJournal } from './journal.ts';

export function preparerExpediteur(
  courriel: ConfigCourriel,
  journal: (ligne: string) => void = journalParDefaut,
): Promise<ExpediteurCourriel> {
  if (courriel.type === 'console') return Promise.resolve(expediteurConsole());
  const expediteur = expediteurSmtp(courriel);
  // Tâche de fond, jamais attendue : un relais muet (jusqu'à DELAI_SMTP_MS) ne retarde pas
  // l'écoute de l'API, donc la synchro.
  void expediteur.verifier().catch((erreur: unknown) => {
    // Une ErreurEnvoiCourriel (verifier()) a un message déjà nettoyé (erreurPropre) ; toute autre
    // erreur (bug, erreur brute d'une bibliothèque) est décrite sans son message (T10m).
    const detail = erreur instanceof ErreurEnvoiCourriel ? erreur.message : decrireErreur(erreur);
    try {
      journal(
        ligneDeJournal(
          `Avertissement : vérification du relais SMTP ${courriel.hote}:${String(courriel.port)} en échec, ` +
            `l'API tourne mais les codes de connexion ne partiront pas tant qu'il ne répond pas. ${detail}`,
        ),
      );
    } catch {
      // Journal en panne (sortie d'erreur fermée…) : rien, surtout pas un rejet non géré qui
      // arrêterait l'API.
    }
  });
  return Promise.resolve(expediteur);
}
