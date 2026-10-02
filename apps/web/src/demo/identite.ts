/**
 * T25 — identité de la démo en ligne : un utilisateur et une ferme fictifs, d'identifiants fixes,
 * propres à la démo (jamais un vrai compte). Mêmes valeurs que le contrat des tests
 * (./test/contrat.ts), redéfinies ici : le code ne lit jamais le dossier test/.
 *
 * Ce module n'est importé que par le mode démo (src/main.tsx, build `vite build --mode demo`) :
 * rien de lui n'entre dans le build de production.
 */
export const UTILISATEUR_DEMO = '0192f0c1-de00-7000-8000-000000000001';
export const FERME_DEMO = '0192f0c1-de00-7000-8000-000000000002';

export const NOM_FERME_DEMO = 'Ferme de démonstration';
export const NOM_UTILISATEUR_DEMO = 'Visiteur de la démo';

export const TEXTE_BANDEAU = 'Démo — données fictives';
export const TEXTE_REINITIALISER = 'Réinitialiser la démo';

/**
 * Marque de la base remplie (localStorage) : le jour du remplissage. Absente, la base de la démo
 * est (re)créée au lancement ; « Réinitialiser la démo » l'efface.
 */
export const CLE_REMPLIE = 'planif.demo.remplie';
