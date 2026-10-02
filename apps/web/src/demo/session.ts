/**
 * T25 — session et stockage de la démo (relecture) : la démo ne touche jamais au compte d'un
 * autre. Pur : ni React ni base. Contrat : ./session.test.ts.
 *
 * Cas réel : la démo et l'appli servies sur la même origine, un vrai compte déjà connecté dans
 * ce navigateur. La démo ne remplace alors pas sa session (ni ne remplit de base) : elle le dit.
 */
import { CLE_SESSION, enregistrerSession, lireSession, type SessionConnexion } from '../connexion/session.ts';
import { CLE_REMPLIE, UTILISATEUR_DEMO } from './identite.ts';

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Session fictive : aucun jeton réel, jamais envoyée (la synchro n'est pas branchée). */
export const SESSION_DEMO: SessionConnexion = {
  utilisateurId: UTILISATEUR_DEMO,
  email: 'visiteur@demo',
  jetonAcces: 'demo',
  jetonRenouvellement: 'demo',
};

/**
 * Pose la session de la démo, sauf si celle d'un autre utilisateur est rangée : rien n'est alors
 * écrit ('autre-compte'). Aucune session, une session illisible ou celle de la démo : 'posee'.
 */
export function poserSessionDemo(stockage: Stockage): 'posee' | 'autre-compte' {
  const actuelle = lireSession(stockage);
  if (actuelle !== null && actuelle.utilisateurId !== UTILISATEUR_DEMO) return 'autre-compte';
  enregistrerSession(stockage, SESSION_DEMO);
  return 'posee';
}

/**
 * « Réinitialiser la démo » : retire la marque de remplissage, et la session si c'est celle de la
 * démo. Rien d'autre (jamais la session d'un autre utilisateur).
 */
export function reinitialiserStockage(stockage: Stockage): void {
  try {
    stockage.removeItem(CLE_REMPLIE);
    if (lireSession(stockage)?.utilisateurId === UTILISATEUR_DEMO) stockage.removeItem(CLE_SESSION);
  } catch {
    // Stockage indisponible : la base est de toute façon remplie à chaque lancement.
  }
}
