/**
 * T28i — le texte de l'invitation de la démo, affichée dans l'éditeur de placement et dans la vue
 * 3D de la démo seulement. Module sans aucun import : sans effet de bord, le bundler l'écarte du
 * build de production, où les écrans ne le lisent jamais (leur condition est fixée au build) ;
 * scripts/demo.test.ts vérifie que dist/ n'en contient pas le texte.
 */
export const TEXTE_INVITATION = 'Essayez : ajoutez une serre et posez-la sur la photo';
